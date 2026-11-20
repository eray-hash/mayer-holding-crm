import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, FilePlus2, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, type AppData } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../data/kundenBereiche'
import { privatAktePfad } from '../data/privatArten'
import { useBereichsRechte } from '../lib/bereichsRechte'
import { supabase } from '../lib/supabaseClient'
import { brauchtDateiLink, holeAnhangUrl } from '../lib/emailGateway'
import { erzeugeKundenDownloadUrl } from '../lib/kundenDokumenteStorage'
import { addDays, fmtDate, fmtEURCent, today, uid } from '../lib/dates'
import { briefkopfAus } from '../data/briefkopf'
import { herunterladen } from '../lib/briefe'
import { ladeKundenDokumentHoch } from '../lib/kundenDokumenteStorage'
import { erzeugeKvPdf, kvPdfDateiname, type AngebotAngaben, type KvArt } from '../lib/kostenvoranschlagPdf'
import { KvPositionenEditor, euroText, type KvPositionenWert } from './KvPositionenEditor'
import {
  KV_STATUS,
  aendereKostenvoranschlag,
  berechneKv,
  kvGesamt,
  kvSumme,
  ladeKostenvoranschlaegeFuerKunde,
  legeKostenvoranschlagAn,
  loescheKostenvoranschlag,
  zuordnungFuer,
  type KvDokument,
  type KvStatus,
  type Kostenvoranschlag,
} from '../lib/kostenvoranschlaege'
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import type { Dokument, Kunde, KundeBereich } from '../types'

// Kostenvoranschläge (20.11.2026): Reiter in jeder Kundenakte. Die gemeinsamen Bausteine (Liste,
// Bearbeiten-Fenster, Datei öffnen) nutzt auch die Übersichtsseite pages/kostenvoranschlaege.

export const KV_FARBE: Record<KvStatus, string> = {
  offen: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  angenommen: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  abgelehnt: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
  bezahlt: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
}

export const kvStatusLabel = (s: KvStatus) => KV_STATUS.find((x) => x.id === s)?.label ?? s

export function fmtBetrag(betrag?: number): string {
  return betrag === undefined || betrag === null ? '–' : fmtEURCent(betrag)
}

/** Name einer Akte, wie er in Listen erscheint. */
export function akteName(k: Pick<Kunde, 'firma' | 'ansprechpartner'>): string {
  const firma = (k.firma ?? '').trim()
  const person = (k.ansprechpartner ?? '').trim()
  if (firma && person && firma !== person) return `${firma} (${person})`
  return firma || person || 'Ohne Namen'
}

export function aktePfad(bereich: KundeBereich, k: Pick<Kunde, 'id' | 'privatArt'>): string {
  return bereich === 'privat' ? privatAktePfad(k.id, k.privatArt) : kundeDetailPfad(bereich, k.id)
}

export type KvAkte = { kunde: Kunde; bereich: KundeBereich; bereichLabel: string }

/** Akte zu einer kunde_id aus dem App-Zustand (alle Bereiche einschließlich der eigenen privaten). */
export function findeAkte(state: AppData, kundeId?: string): KvAkte | undefined {
  if (!kundeId) return undefined
  for (const b of KUNDEN_BEREICHE) {
    const kunde = b.get(state).find((k) => k.id === kundeId)
    if (kunde) return { kunde, bereich: b.id, bereichLabel: b.label }
  }
  return undefined
}

/** Öffnet die verknüpfte Datei (liegt in den Dokumenten der Akte dokument.kundeId). */
export async function oeffneKvDokument(state: AppData, dok: KvDokument): Promise<void> {
  // Fenster sofort öffnen (sonst blockt der Browser es nach dem Warten), Adresse danach setzen.
  const fenster = window.open('', '_blank')
  try {
    let datei: Dokument | undefined = findeAkte(state, dok.kundeId)?.kunde.dokumente?.find((d) => d.id === dok.dokumentId)
    // Die Datei kann inzwischen in einer anderen Akte liegen (z. B. aus den Ungeklärten Eingängen
    // abgelegt; sie behält dabei ihre Kennung) — erst in allen geladenen Akten, dann in der Datenbank suchen.
    if (!datei) {
      for (const b of KUNDEN_BEREICHE) {
        for (const k of b.get(state)) {
          datei = k.dokumente?.find((d) => d.id === dok.dokumentId)
          if (datei) break
        }
        if (datei) break
      }
    }
    if (!datei && supabase) {
      const { data, error } = await supabase.from('kunden').select('dokumente').contains('dokumente', [{ id: dok.dokumentId }]).limit(1)
      if (error) throw new Error('Die Datei ließ sich nicht suchen. Bitte noch einmal versuchen.')
      const liste = Array.isArray(data?.[0]?.dokumente) ? (data![0].dokumente as Dokument[]) : []
      datei = liste.find((d) => d.id === dok.dokumentId)
    }
    if (!datei?.url) throw new Error(`Die Datei „${dok.name}“ wurde in der Akte nicht gefunden.`)
    const url = datei.url
    const ziel = brauchtDateiLink(url) ? await holeAnhangUrl(url) : url.startsWith('http') ? url : await erzeugeKundenDownloadUrl(url)
    if (fenster) fenster.location.href = ziel
    else window.location.href = ziel
  } catch (err) {
    fenster?.close()
    throw err instanceof Error ? err : new Error('Die Datei ließ sich nicht öffnen.')
  }
}

/** Name des angemeldeten Mitarbeiters und ob nur gelesen werden darf („Ansehen als …“). */
export function useKvNutzer() {
  const { mitarbeiter, ansichtAls, session } = useAuth()
  return {
    name: mitarbeiter?.name ?? CURRENT_USER,
    email: (session?.user.email ?? '').toLowerCase(),
    nurLesen: !!ansichtAls,
  }
}

// ---------------------------------------------------------------------------------------------
// Bearbeiten / Neu anlegen

const OHNE_AKTE = ''
const OHNE_AKTE_PRIVAT = '__privat'

function auswahlFuer(e?: Kostenvoranschlag): string {
  if (!e) return OHNE_AKTE
  if (e.kundeId) return e.kundeId
  return e.bereich === 'privat' ? OHNE_AKTE_PRIVAT : OHNE_AKTE
}

function betragAusText(text: string): number | null {
  const t = text.trim().replace(/€/g, '').replace(/\s/g, '').replace(/,[-–]$/, ',00')
  if (!t) return null
  // Deutsches Format: Punkt = Tausender, Komma = Dezimal. Nur ein Punkt ohne Komma gilt als Dezimalpunkt, wenn danach nicht genau drei Ziffern stehen.
  let norm = t
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '')
  const n = Number(norm)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

function betragAlsText(b?: number): string {
  return b === undefined ? '' : b.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false })
}

export function KvBearbeitenModal({
  open,
  onClose,
  eintrag,
  festeAkte,
  nurPrivat,
  onGespeichert,
}: {
  open: boolean
  onClose: () => void
  /** Vorhandener Eintrag (Bearbeiten) oder leer (Neu). */
  eintrag?: Kostenvoranschlag
  /** In einer Akte: neue Einträge gehören immer zu dieser Akte, keine Auswahl. */
  festeAkte?: KvAkte
  /** Auf der privaten Übersicht: nur eigene private Akten bzw. „privat ohne Akte“ zur Wahl. */
  nurPrivat?: boolean
  onGespeichert: (kv: Kostenvoranschlag) => void
}) {
  const { state, dispatch } = useApp()
  const { kundenBereiche } = useBereichsRechte()
  const nutzer = useKvNutzer()
  const [name, setName] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [betrag, setBetrag] = useState('')
  const [status, setStatus] = useState<KvStatus>('offen')
  const [datum, setDatum] = useState(today())
  const [notiz, setNotiz] = useState('')
  const [akte, setAkte] = useState(OHNE_AKTE)
  const [akteSuche, setAkteSuche] = useState('')
  // Berechnet aus Positionen der Preisliste (mit Auf-/Abschlag) oder Betrag von Hand.
  const [mitPositionen, setMitPositionen] = useState(false)
  const [pos, setPos] = useState<KvPositionenWert>({ positionen: [], aufschlagProzent: 0, ustSatz: 19 })
  const [fehler, setFehler] = useState('')
  const [speichert, setSpeichert] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(eintrag?.name ?? (festeAkte ? akteName(festeAkte.kunde) : ''))
    setBeschreibung(eintrag?.beschreibung ?? '')
    setBetrag(betragAlsText(eintrag?.betrag))
    setStatus(eintrag?.status ?? 'offen')
    setDatum(eintrag ? eintrag.datum ?? '' : today())
    setNotiz(eintrag?.notiz ?? '')
    setAkte(eintrag ? auswahlFuer(eintrag) : festeAkte ? festeAkte.kunde.id : nurPrivat ? OHNE_AKTE_PRIVAT : OHNE_AKTE)
    setAkteSuche('')
    setMitPositionen(!!eintrag?.positionen?.length)
    setPos({ positionen: eintrag?.positionen ?? [], aufschlagProzent: eintrag?.aufschlagProzent ?? 0, ustSatz: eintrag?.ustSatz ?? 19 })
    setFehler('')
    setSpeichert(false)
    // Nur beim Öffnen bzw. Wechsel des Eintrags zurücksetzen — lädt die App im Hintergrund neu,
    // entstehen neue Objekte für Akte/Eintrag, und die Eingaben dürfen dann nicht verloren gehen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, eintrag?.id])

  const gruppen = useMemo(() => {
    const such = akteSuche.trim().toLowerCase()
    return kundenBereiche
      .filter((b) => !nurPrivat || b.id === 'privat')
      .map((b) => ({
        id: b.id,
        label: b.id === 'privat' ? 'Privat (nur für dich)' : b.label,
        akten: b
          .get(state)
          .filter((k) => !such || akteName(k).toLowerCase().includes(such) || k.id === akte)
          .sort((x, y) => akteName(x).localeCompare(akteName(y), 'de')),
      }))
      .filter((g) => g.akten.length > 0)
  }, [kundenBereiche, nurPrivat, state, akteSuche, akte])

  // Die bisher zugeordnete Akte kann außerhalb der Auswahl liegen (z. B. Bereich ohne Freigabe) — dann trotzdem anzeigen.
  const bisherigeAkteFehlt = !!eintrag?.kundeId && akte === eintrag.kundeId && !gruppen.some((g) => g.akten.some((k) => k.id === akte))

  function zuordnungAusAuswahl(wert: string): ReturnType<typeof zuordnungFuer> {
    if (wert === OHNE_AKTE) return zuordnungFuer(undefined)
    if (wert === OHNE_AKTE_PRIVAT) return { kunde_id: null, bereich: 'privat', privat_besitzer: nutzer.email || null }
    const gefunden = findeAkte(state, wert)
    if (!gefunden) throw new Error('Die gewählte Akte wurde nicht gefunden.')
    return zuordnungZuAkte(gefunden)
  }

  // Private Akte ohne hinterlegte Besitzer-Adresse: sonst wäre der Eintrag für alle sichtbar — dann gehört er dem Angemeldeten.
  function zuordnungZuAkte(a: KvAkte): ReturnType<typeof zuordnungFuer> {
    const z = zuordnungFuer({ ...a.kunde, bereich: a.bereich })
    if (z.bereich === 'privat' && !z.privat_besitzer) {
      if (!nutzer.email) throw new Error('Private Einträge gehen nur angemeldet.')
      z.privat_besitzer = nutzer.email
    }
    return z
  }

  async function speichern(alsPdf = false) {
    setFehler('')
    if (!name.trim()) return setFehler('Bitte einen Namen angeben.')
    let zahl = betragAusText(betrag)
    if (mitPositionen) {
      if (!pos.positionen.length) return setFehler('Bitte mindestens eine Position anlegen oder „Betrag von Hand“ wählen.')
      if (pos.positionen.some((p) => !p.bezeichnung.trim())) return setFehler('Jede Position braucht eine Bezeichnung.')
      zahl = berechneKv(pos.positionen, pos.aufschlagProzent, pos.ustSatz).brutto
    } else if (Number.isNaN(zahl)) return setFehler('Der Betrag ist keine Zahl. Beispiel: 1.250,50')
    if (akte === OHNE_AKTE_PRIVAT && !nutzer.email) return setFehler('Privat ohne Akte geht nur angemeldet.')
    // Wechsel zwischen privat und für alle sichtbar nur bewusst (Prüfung vom 20.11.2026).
    let neueZuordnung: ReturnType<typeof zuordnungFuer> | undefined
    let dokumentLoesen = false
    if (eintrag && akte !== auswahlFuer(eintrag)) {
      try {
        neueZuordnung = zuordnungAusAuswahl(akte)
      } catch (err) {
        return setFehler(err instanceof Error ? err.message : 'Die gewählte Akte wurde nicht gefunden.')
      }
      const warPrivat = eintrag.bereich === 'privat' || !!eintrag.privatBesitzer
      const wirdPrivat = neueZuordnung.bereich === 'privat'
      if (!warPrivat && wirdPrivat) {
        if (eintrag.erstelltVon && eintrag.erstelltVon !== nutzer.name) return setFehler(`Nur ${eintrag.erstelltVon}, der den Eintrag angelegt hat, kann ihn privat machen.`)
        if (!window.confirm('Der Eintrag wird privat: Danach sieht ihn niemand außer dir. Fortfahren?')) return
      }
      if (warPrivat && !wirdPrivat) {
        if (!window.confirm('Der Eintrag ist bisher privat. Danach sehen ihn alle Mitarbeiter mit Zugriff auf diesen Bereich. Fortfahren?')) return
        // Die verknüpfte Datei liegt in einer privaten Akte — der Verweis darauf soll nicht mitwandern.
        dokumentLoesen = !!eintrag.dokument && findeAkte(state, eintrag.dokument.kundeId)?.bereich === 'privat'
      }
    }
    setSpeichert(true)
    try {
      const betragGeaendert = !eintrag || mitPositionen || betrag !== betragAlsText(eintrag.betrag)
      const felder = {
        name,
        beschreibung,
        ...(betragGeaendert ? { betrag: zahl } : {}),
        ...(dokumentLoesen ? { dokument: null } : {}),
        status,
        datum: datum || null,
        notiz,
        positionen: mitPositionen ? pos.positionen.map((p) => ({ ...p, bezeichnung: p.bezeichnung.trim() })) : null,
        aufschlagProzent: mitPositionen ? pos.aufschlagProzent : null,
        ustSatz: mitPositionen ? pos.ustSatz : null,
      }
      let kv: Kostenvoranschlag
      if (eintrag) {
        kv = await aendereKostenvoranschlag(eintrag.id, felder, neueZuordnung)
      } else {
        kv = await legeKostenvoranschlagAn(felder, festeAkte ? zuordnungZuAkte(festeAkte) : zuordnungAusAuswahl(akte), nutzer.name)
      }
      if (alsPdf) kv = (await kvPdfAblegen(kv, { state, dispatch, nutzerName: nutzer.name })).kv
      onGespeichert(kv)
      onClose()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Speichern hat nicht geklappt.')
      setSpeichert(false)
    }
  }

  const akteFest = !!festeAkte && !eintrag

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={eintrag ? 'Kostenvoranschlag bearbeiten' : 'Neuer Kostenvoranschlag'}
      aktionen={
        <>
          {mitPositionen && (
            <SecondaryButton onClick={() => speichern(true)} disabled={speichert || nutzer.nurLesen}>
              Speichern und PDF erstellen
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => speichern()} disabled={speichert || nutzer.nurLesen}>
            {speichert ? 'Speichert …' : 'Speichern'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Name (für wen bzw. von wem)">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Beschreibung (worum es geht)">
        <input className={inputClass} value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} placeholder="z. B. Küche, Bad" />
      </Field>
      <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
        <button type="button" onClick={() => setMitPositionen(false)} className={`rounded-md px-3 py-1.5 ${!mitPositionen ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          Betrag von Hand
        </button>
        <button type="button" onClick={() => setMitPositionen(true)} className={`rounded-md px-3 py-1.5 ${mitPositionen ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          Aus Preisliste berechnen
        </button>
      </div>
      {mitPositionen && <KvPositionenEditor wert={pos} onChange={setPos} nurLesen={nutzer.nurLesen} />}
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
        {mitPositionen ? (
          <Field label="Gesamtbetrag (berechnet)">
            <input className={`${inputClass} bg-slate-50`} value={euroText(berechneKv(pos.positionen, pos.aufschlagProzent, pos.ustSatz).brutto)} readOnly />
          </Field>
        ) : (
          <Field label="Betrag in Euro">
            <input className={inputClass} value={betrag} onChange={(e) => setBetrag(e.target.value)} inputMode="decimal" placeholder="leer = noch offen" />
          </Field>
        )}
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as KvStatus)}>
            {KV_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Datum">
          <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
        </Field>
      </div>
      <Field label="Notiz">
        <textarea className={inputClass} rows={3} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
      </Field>
      {akteFest ? (
        <p className="mb-3 text-xs text-slate-500">
          Wird der Akte <span className="font-medium text-slate-700">{akteName(festeAkte!.kunde)}</span> zugeordnet.
        </p>
      ) : (
        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium text-slate-500">Akte zuordnen</span>
          <input className={`${inputClass} mb-2`} value={akteSuche} onChange={(e) => setAkteSuche(e.target.value)} placeholder="Akte suchen …" />
          <select className={inputClass} value={akte} onChange={(e) => setAkte(e.target.value)}>
            {!nurPrivat && <option value={OHNE_AKTE}>Keine Akte (für alle Mitarbeiter sichtbar)</option>}
            <option value={OHNE_AKTE_PRIVAT}>Keine Akte, privat (nur für dich sichtbar)</option>
            {bisherigeAkteFehlt && <option value={akte}>Bisherige Akte behalten</option>}
            {gruppen.map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.akten.map((k) => (
                  <option key={k.id} value={k.id}>
                    {akteName(k)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {eintrag?.dokument && (
            <p className="mt-1.5 text-xs text-slate-400">Die verknüpfte Datei „{eintrag.dokument.name}“ bleibt verknüpft, auch wenn du die Akte wechselst.</p>
          )}
        </div>
      )}
      {fehler && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Liste (Tabelle ab Tablet-Breite, Karten auf dem Handy)

function StatusWahl({ kv, nurLesen, onStatus }: { kv: Kostenvoranschlag; nurLesen: boolean; onStatus: (kv: Kostenvoranschlag, s: KvStatus) => void }) {
  if (nurLesen) {
    return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${KV_FARBE[kv.status]}`}>{kvStatusLabel(kv.status)}</span>
  }
  return (
    <select
      value={kv.status}
      onChange={(e) => onStatus(kv, e.target.value as KvStatus)}
      title="Status ändern"
      aria-label="Status ändern"
      className={`cursor-pointer rounded-full border-0 py-0.5 pl-2.5 pr-7 text-xs font-medium outline-none focus:ring-2 focus:ring-accent-200 ${KV_FARBE[kv.status]}`}
    >
      {KV_STATUS.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

function AkteVerweis({ kv }: { kv: Kostenvoranschlag }) {
  const { state } = useApp()
  if (!kv.kundeId) {
    return <span className="text-xs text-slate-400">{kv.bereich === 'privat' ? 'Keiner Akte zugeordnet (privat)' : 'Keiner Akte zugeordnet'}</span>
  }
  const akte = findeAkte(state, kv.kundeId)
  if (!akte) return <span className="text-xs text-slate-400">Akte nicht geladen</span>
  return (
    <Link to={aktePfad(akte.bereich, akte.kunde)} className="text-sm text-accent-700 hover:underline">
      {akteName(akte.kunde)}
      <span className="ml-1 text-xs text-slate-400">· {akte.bereich === 'privat' ? 'Privat' : akte.bereichLabel}</span>
    </Link>
  )
}

export function KvListe({
  eintraege,
  zeigeAkte = true,
  nurLesen,
  onBearbeiten,
  onStatus,
  onLoeschen,
}: {
  eintraege: Kostenvoranschlag[]
  zeigeAkte?: boolean
  nurLesen: boolean
  onBearbeiten: (kv: Kostenvoranschlag) => void
  onStatus: (kv: Kostenvoranschlag, s: KvStatus) => void
  onLoeschen: (kv: Kostenvoranschlag) => void
}) {
  const { state } = useApp()
  const [dateiFehler, setDateiFehler] = useState('')

  async function datei(kv: Kostenvoranschlag) {
    if (!kv.dokument) return
    setDateiFehler('')
    try {
      await oeffneKvDokument(state, kv.dokument)
    } catch (err) {
      setDateiFehler(err instanceof Error ? err.message : 'Die Datei ließ sich nicht öffnen.')
    }
  }

  const dateiKnopf = (kv: Kostenvoranschlag) =>
    kv.dokument ? (
      <button onClick={() => datei(kv)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-accent-700 hover:bg-accent-50" title={`Datei öffnen: ${kv.dokument.name}`}>
        <FileText size={14} /> Datei
      </button>
    ) : null

  const knoepfe = (kv: Kostenvoranschlag) =>
    nurLesen ? null : (
      <>
        <button onClick={() => onBearbeiten(kv)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Bearbeiten" aria-label="Bearbeiten">
          <Pencil size={15} />
        </button>
        <button onClick={() => onLoeschen(kv)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Löschen" aria-label="Löschen">
          <Trash2 size={15} />
        </button>
      </>
    )

  return (
    <>
      {dateiFehler && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{dateiFehler}</p>}

      {/* Handy: Karten */}
      <div className="space-y-2 md:hidden">
        {eintraege.map((kv) => (
          <Card key={kv.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800">{kv.name}</div>
                {kv.beschreibung && <div className="text-sm text-slate-600">{kv.beschreibung}</div>}
              </div>
              <div className="whitespace-nowrap text-sm font-semibold text-slate-800">{fmtBetrag(kv.betrag)}</div>
            </div>
            {kv.notiz && <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{kv.notiz}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusWahl kv={kv} nurLesen={nurLesen} onStatus={onStatus} />
              <span className="text-xs text-slate-500">{kv.datum ? fmtDate(kv.datum) : 'ohne Datum'}</span>
            </div>
            {zeigeAkte && (
              <div className="mt-1.5">
                <AkteVerweis kv={kv} />
              </div>
            )}
            <div className="mt-2 flex items-center justify-end gap-1 border-t border-slate-100 pt-2">
              {dateiKnopf(kv)}
              {knoepfe(kv)}
            </div>
          </Card>
        ))}
      </div>

      {/* Tablet und größer: Tabelle */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-400">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Beschreibung</th>
              <th className="px-3 py-2 text-right">Betrag</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Datum</th>
              {zeigeAkte && <th className="px-3 py-2">Akte</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {eintraege.map((kv) => (
              <tr key={kv.id} className="border-b border-slate-50 align-top last:border-0 hover:bg-slate-50/60">
                <td className="px-3 py-2.5 font-medium text-slate-800">{kv.name}</td>
                <td className="px-3 py-2.5 text-slate-600">
                  {kv.beschreibung || <span className="text-slate-300">–</span>}
                  {kv.notiz && <div className="mt-0.5 whitespace-pre-line text-xs text-slate-400">{kv.notiz}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-800">{fmtBetrag(kv.betrag)}</td>
                <td className="px-3 py-2.5">
                  <StatusWahl kv={kv} nurLesen={nurLesen} onStatus={onStatus} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{kv.datum ? fmtDate(kv.datum) : '–'}</td>
                {zeigeAkte && (
                  <td className="px-3 py-2.5">
                    <AkteVerweis kv={kv} />
                  </td>
                )}
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  {dateiKnopf(kv)}
                  {knoepfe(kv)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}

/** Gemeinsame Abläufe für Liste + Fenster: Status schnell ändern, Löschen mit Rückfrage, Speichern übernehmen. */
export function useKvAktionen(setListe: React.Dispatch<React.SetStateAction<Kostenvoranschlag[]>>, setFehler: (t: string) => void) {
  const statusAendern = useCallback(
    async (kv: Kostenvoranschlag, status: KvStatus) => {
      setFehler('')
      setListe((l) => l.map((x) => (x.id === kv.id ? { ...x, status } : x)))
      try {
        const neu = await aendereKostenvoranschlag(kv.id, { status })
        setListe((l) => l.map((x) => (x.id === kv.id ? neu : x)))
      } catch (err) {
        setListe((l) => l.map((x) => (x.id === kv.id ? kv : x)))
        setFehler(err instanceof Error ? err.message : 'Status ließ sich nicht ändern.')
      }
    },
    [setListe, setFehler],
  )
  const loeschen = useCallback(
    async (kv: Kostenvoranschlag) => {
      const text = `Kostenvoranschlag „${kv.name}${kv.beschreibung ? ` – ${kv.beschreibung}` : ''}“ wirklich löschen? Das lässt sich nicht rückgängig machen.${kv.dokument ? ' Die verknüpfte Datei bleibt in der Akte erhalten.' : ''}`
      if (!window.confirm(text)) return
      setFehler('')
      try {
        await loescheKostenvoranschlag(kv.id)
        setListe((l) => l.filter((x) => x.id !== kv.id))
      } catch (err) {
        setFehler(err instanceof Error ? err.message : 'Löschen hat nicht geklappt.')
      }
    },
    [setListe, setFehler],
  )
  const uebernehmen = useCallback(
    (kv: Kostenvoranschlag) => setListe((l) => (l.some((x) => x.id === kv.id) ? l.map((x) => (x.id === kv.id ? kv : x)) : [kv, ...l])),
    [setListe],
  )
  return { statusAendern, loeschen, uebernehmen }
}

// ---------------------------------------------------------------------------------------------
// PDF erstellen (Kostenvoranschlag oder Angebot) und in die Akte legen

type Dispatch = ReturnType<typeof useApp>['dispatch']

/**
 * Erzeugt das PDF mit dem Briefkopf der Holding (bei privaten Einträgen schlicht mit dem eigenen Namen),
 * lädt es herunter und legt es — wenn der Eintrag einer geladenen Akte zugeordnet ist — dort unter
 * Dokumente ab. Ein Kostenvoranschlag wird mit seinem PDF verknüpft.
 */
export async function kvPdfAblegen(
  kv: Kostenvoranschlag,
  p: { state: AppData; dispatch: Dispatch; nutzerName: string; art?: KvArt; angebot?: AngebotAngaben },
): Promise<{ kv: Kostenvoranschlag; akte?: KvAkte; name: string }> {
  const art = p.art ?? 'kostenvoranschlag'
  const akte = findeAkte(p.state, kv.kundeId)
  const privat = kv.bereich === 'privat' || akte?.bereich === 'privat'
  const briefkopf = privat ? { name: p.nutzerName, unterzeilen: [], seitenleiste: [], fusszeilen: [p.nutzerName] } : briefkopfAus(p.state.vorlagenBeratung)
  const blob = erzeugeKvPdf(kv, { briefkopf, art, angebot: p.angebot })
  const name = kvPdfDateiname(kv, art, p.angebot?.datum)
  herunterladen(blob, name)
  if (!akte) return { kv, name }
  const { pfad, groesse } = await ladeKundenDokumentHoch(akte.kunde.id, new File([blob], name, { type: 'application/pdf' }))
  const dok: Dokument = { id: uid('dok'), name, typ: 'application/pdf', datum: today(), groesse, url: pfad }
  const aktuell = findeAkte(p.state, akte.kunde.id)?.kunde ?? akte.kunde
  p.dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: akte.bereich, id: akte.kunde.id, patch: { dokumente: [...(aktuell.dokumente ?? []), dok] } })
  let neu = kv
  if (art === 'kostenvoranschlag') neu = await aendereKostenvoranschlag(kv.id, { dokument: { kundeId: akte.kunde.id, dokumentId: dok.id, name } })
  return { kv: neu, akte, name }
}

const ANGEBOT_EINLEITUNG = 'vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen die folgenden Leistungen an:'
const ANGEBOT_SCHLUSS = 'Für Rückfragen stehen wir Ihnen gerne zur Verfügung. Wir freuen uns auf Ihren Auftrag.'

/** Positionen für das Angebot: die des Kostenvoranschlags oder — ohne Positionen — eine Pauschale über den Betrag. */
function startPositionen(kv: Kostenvoranschlag): KvPositionenWert {
  if (kv.positionen?.length) return { positionen: kv.positionen.map((x) => ({ ...x })), aufschlagProzent: kv.aufschlagProzent ?? 0, ustSatz: kv.ustSatz ?? 19 }
  return {
    positionen: [{ id: uid('p'), bezeichnung: kv.beschreibung || kv.name, menge: 1, einheit: 'Pauschal', einzelpreis: kv.betrag ?? 0 }],
    aufschlagProzent: 0,
    ustSatz: 19,
  }
}

/** Fenster „Angebot erstellen“: Kostenvoranschlag wählen, Anschreiben und Positionen anpassen, PDF auf dem Briefkopf. */
export function KvAngebotModal({
  open,
  onClose,
  eintraege,
  vorauswahl,
}: {
  open: boolean
  onClose: () => void
  eintraege: Kostenvoranschlag[]
  vorauswahl?: string
}) {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const [kvId, setKvId] = useState('')
  const [empfaenger, setEmpfaenger] = useState('')
  const [betreff, setBetreff] = useState('')
  const [anrede, setAnrede] = useState('Sehr geehrte Damen und Herren,')
  const [einleitung, setEinleitung] = useState(ANGEBOT_EINLEITUNG)
  const [schluss, setSchluss] = useState(ANGEBOT_SCHLUSS)
  const [gueltigBis, setGueltigBis] = useState(addDays(today(), 30))
  const [absender, setAbsender] = useState('')
  const [pos, setPos] = useState<KvPositionenWert>({ positionen: [], aufschlagProzent: 0, ustSatz: 19 })
  const [arbeitet, setArbeitet] = useState(false)
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')

  const waehlbar = useMemo(() => eintraege.filter((k) => k.status !== 'abgelehnt'), [eintraege])
  const kv = waehlbar.find((k) => k.id === kvId)

  function vorbelegen(id: string) {
    setKvId(id)
    setMeldung('')
    setFehler('')
    const k = waehlbar.find((x) => x.id === id)
    if (!k) return
    const akte = findeAkte(state, k.kundeId)?.kunde
    const zeilen = akte
      ? [akte.firma, akte.ansprechpartner && akte.ansprechpartner !== akte.firma ? akte.ansprechpartner : '', ...(akte.immoStammdaten?.adresse ?? '').split(/\n|,\s*/)]
      : [k.name]
    setEmpfaenger(zeilen.map((z) => (z ?? '').trim()).filter(Boolean).join('\n'))
    setBetreff(`Angebot${k.beschreibung ? `: ${k.beschreibung}` : ''}`)
    setPos(startPositionen(k))
  }

  useEffect(() => {
    if (!open) return
    setAnrede('Sehr geehrte Damen und Herren,')
    setEinleitung(ANGEBOT_EINLEITUNG)
    setSchluss(ANGEBOT_SCHLUSS)
    setGueltigBis(addDays(today(), 30))
    setAbsender(nutzer.name)
    setArbeitet(false)
    const start = vorauswahl && waehlbar.some((k) => k.id === vorauswahl) ? vorauswahl : waehlbar.length === 1 ? waehlbar[0].id : ''
    if (start) vorbelegen(start)
    else {
      setKvId('')
      setEmpfaenger('')
      setBetreff('Angebot')
      setPos({ positionen: [], aufschlagProzent: 0, ustSatz: 19 })
      setMeldung('')
      setFehler('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vorauswahl])

  async function erstellen() {
    setFehler('')
    setMeldung('')
    if (!kv) return setFehler('Bitte einen Kostenvoranschlag wählen.')
    if (!pos.positionen.length) return setFehler('Das Angebot braucht mindestens eine Position.')
    if (pos.positionen.some((x) => !x.bezeichnung.trim())) return setFehler('Jede Position braucht eine Bezeichnung.')
    if (!empfaenger.trim()) return setFehler('Bitte einen Empfänger angeben.')
    setArbeitet(true)
    try {
      const basis: Kostenvoranschlag = { ...kv, positionen: pos.positionen, aufschlagProzent: pos.aufschlagProzent, ustSatz: pos.ustSatz }
      const angebot: AngebotAngaben = { empfaenger: empfaenger.split('\n'), betreff: betreff.trim() || 'Angebot', anrede, einleitung, schluss, gueltigBis, absender: absender.trim() || nutzer.name, datum: today() }
      const r = await kvPdfAblegen(basis, { state, dispatch, nutzerName: nutzer.name, art: 'angebot', angebot })
      setMeldung(r.akte ? `„${r.name}“ wurde heruntergeladen und liegt in der Akte ${akteName(r.akte.kunde)} unter Dokumente.` : `„${r.name}“ wurde heruntergeladen. Der Kostenvoranschlag hat keine Akte, deshalb wurde nichts abgelegt.`)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Angebot ließ sich nicht erstellen.')
    } finally {
      setArbeitet(false)
    }
  }

  const summe = berechneKv(pos.positionen, pos.aufschlagProzent, pos.ustSatz)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Angebot aus Kostenvoranschlag erstellen"
      width="max-w-3xl"
      aktionen={
        <PrimaryButton onClick={erstellen} disabled={arbeitet || nutzer.nurLesen || !kv}>
          {arbeitet ? 'Wird erstellt …' : 'Angebot als PDF erstellen'}
        </PrimaryButton>
      }
    >
      <Field label="Kostenvoranschlag">
        <select className={inputClass} value={kvId} onChange={(e) => vorbelegen(e.target.value)}>
          <option value="">Bitte wählen …</option>
          {waehlbar.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
              {k.beschreibung ? ` – ${k.beschreibung}` : ''}
              {k.betrag !== undefined ? ` · ${euroText(k.betrag)}` : ''}
            </option>
          ))}
        </select>
      </Field>
      {kv && (
        <>
          {!kv.positionen?.length && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Dieser Kostenvoranschlag hat keine Positionen. Der Betrag wurde als eine Pauschale (netto) übernommen — bitte prüfen oder Positionen aus der Preisliste wählen.
            </p>
          )}
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Empfänger (eine Zeile je Angabe)">
              <textarea className={inputClass} rows={4} value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} />
            </Field>
            <div>
              <Field label="Betreff">
                <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
              </Field>
              <Field label="Gültig bis">
                <input type="date" className={inputClass} value={gueltigBis} onChange={(e) => setGueltigBis(e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label="Anrede">
            <input className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)} />
          </Field>
          <Field label="Text vor der Aufstellung">
            <textarea className={inputClass} rows={2} value={einleitung} onChange={(e) => setEinleitung(e.target.value)} />
          </Field>
          <KvPositionenEditor wert={pos} onChange={setPos} nurLesen={nutzer.nurLesen} />
          <Field label="Text nach der Aufstellung">
            <textarea className={inputClass} rows={2} value={schluss} onChange={(e) => setSchluss(e.target.value)} />
          </Field>
          <Field label="Unterschrift (Name unter dem Gruß)">
            <input className={inputClass} value={absender} onChange={(e) => setAbsender(e.target.value)} />
          </Field>
          <p className="mb-2 text-xs text-slate-500">
            Gesamtbetrag im Angebot: <span className="font-semibold text-slate-800">{euroText(summe.brutto)}</span>. Der Kostenvoranschlag selbst bleibt unverändert. Briefkopf:{' '}
            {kv.bereich === 'privat' ? 'dein Name (privat)' : 'Andreas Mayer Holding'}.
          </p>
        </>
      )}
      {meldung && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{meldung}</p>}
      {fehler && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Reiter „Kostenvoranschläge“ in der Akte

export function KostenvoranschlaegeSection({ kunde, bereich }: { kunde: Kunde; bereich: KundeBereich }) {
  const nutzer = useKvNutzer()
  const [liste, setListe] = useState<Kostenvoranschlag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [fenster, setFenster] = useState<{ eintrag?: Kostenvoranschlag } | null>(null)
  const [angebot, setAngebot] = useState(false)
  const { statusAendern, loeschen, uebernehmen } = useKvAktionen(setListe, setFehler)
  const festeAkte = useMemo<KvAkte>(() => ({ kunde, bereich, bereichLabel: KUNDEN_BEREICHE.find((b) => b.id === bereich)?.label ?? bereich }), [kunde, bereich])

  useEffect(() => {
    let aktiv = true
    setLaedt(true)
    setFehler('')
    ladeKostenvoranschlaegeFuerKunde(kunde.id)
      .then((l) => aktiv && setListe(l))
      .catch((err) => aktiv && setFehler(err instanceof Error ? err.message : 'Kostenvoranschläge ließen sich nicht laden.'))
      .finally(() => aktiv && setLaedt(false))
    return () => {
      aktiv = false
    }
  }, [kunde.id])

  const offen = kvSumme(liste.filter((k) => k.status === 'offen'))
  const angenommen = kvSumme(liste.filter((k) => k.status === 'angenommen'))
  const bezahlt = kvSumme(liste.filter((k) => k.status === 'bezahlt'))
  const uebersichtPfad = bereich === 'privat' ? '/privat/kostenvoranschlaege' : '/kostenvoranschlaege'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Calculator size={16} className="text-accent-600" />
          <span>
            {liste.length} {liste.length === 1 ? 'Eintrag' : 'Einträge'} · Summe <span className="font-semibold text-slate-800">{fmtEURCent(kvGesamt(liste).summe)}</span>
            <span className="text-xs text-slate-400">
              {' '}(ohne Abgelehnte{kvGesamt(liste).ohneBetrag ? `; ${kvGesamt(liste).ohneBetrag} ohne Betrag` : ''})
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={uebersichtPfad} className="text-sm text-accent-700 hover:underline">
            Alle Kostenvoranschläge
          </Link>
          {!nutzer.nurLesen && liste.some((k) => k.status !== 'abgelehnt') && (
            <SecondaryButton onClick={() => setAngebot(true)}>
              <FilePlus2 size={15} /> Angebot erstellen
            </SecondaryButton>
          )}
          {!nutzer.nurLesen && (
            <PrimaryButton onClick={() => setFenster({})}>
              <Plus size={15} /> Neuer Kostenvoranschlag
            </PrimaryButton>
          )}
        </div>
      </div>

      {liste.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>Offen: <span className="font-medium text-slate-700">{fmtEURCent(offen)}</span></span>
          <span>Angenommen: <span className="font-medium text-slate-700">{fmtEURCent(angenommen)}</span></span>
          <span>Bezahlt: <span className="font-medium text-slate-700">{fmtEURCent(bezahlt)}</span></span>
        </div>
      )}

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      {laedt ? (
        <p className="text-sm text-slate-400">Wird geladen …</p>
      ) : liste.length === 0 ? (
        <EmptyState text="Zu dieser Akte gibt es noch keine Kostenvoranschläge." />
      ) : (
        <KvListe eintraege={liste} zeigeAkte={false} nurLesen={nutzer.nurLesen} onBearbeiten={(kv) => setFenster({ eintrag: kv })} onStatus={statusAendern} onLoeschen={loeschen} />
      )}

      <KvAngebotModal open={angebot} onClose={() => setAngebot(false)} eintraege={liste} />

      <KvBearbeitenModal
        open={!!fenster}
        onClose={() => setFenster(null)}
        eintrag={fenster?.eintrag}
        festeAkte={festeAkte}
        onGespeichert={(kv) => {
          // Wurde der Eintrag einer anderen Akte zugeordnet, verschwindet er hier.
          if (kv.kundeId !== kunde.id) setListe((l) => l.filter((x) => x.id !== kv.id))
          else uebernehmen(kv)
        }}
      />
    </div>
  )
}
