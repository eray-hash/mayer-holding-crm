import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp, type AppData } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../data/kundenBereiche'
import { privatAktePfad } from '../data/privatArten'
import { useBereichsRechte } from '../lib/bereichsRechte'
import { supabase } from '../lib/supabaseClient'
import { brauchtDateiLink, holeAnhangUrl } from '../lib/emailGateway'
import { erzeugeKundenDownloadUrl } from '../lib/kundenDokumenteStorage'
import { fmtDate, fmtEURCent, today } from '../lib/dates'
import {
  KV_STATUS,
  aendereKostenvoranschlag,
  kvSumme,
  ladeKostenvoranschlaegeFuerKunde,
  legeKostenvoranschlagAn,
  loescheKostenvoranschlag,
  zuordnungFuer,
  type KvDokument,
  type KvStatus,
  type Kostenvoranschlag,
} from '../lib/kostenvoranschlaege'
import { Card, EmptyState, Field, Modal, PrimaryButton, inputClass } from './ui'
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
    if (!datei && supabase) {
      // Die Akte ist (noch) nicht im App-Zustand geladen — direkt nachsehen.
      const { data, error } = await supabase.from('kunden').select('dokumente').eq('id', dok.kundeId).maybeSingle()
      if (error) throw new Error(error.message)
      const liste = Array.isArray(data?.dokumente) ? (data!.dokumente as Dokument[]) : []
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
  const t = text.trim().replace(/€/g, '').replace(/\s/g, '')
  if (!t) return null
  // Deutsches Format: Punkt = Tausender, Komma = Dezimal. Nur ein Punkt ohne Komma gilt als Dezimalpunkt, wenn danach nicht genau drei Ziffern stehen.
  let norm = t
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '')
  const n = Number(norm)
  return Number.isFinite(n) ? n : NaN
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
  const { state } = useApp()
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
    setFehler('')
    setSpeichert(false)
  }, [open, eintrag, festeAkte, nurPrivat])

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

  async function speichern() {
    setFehler('')
    if (!name.trim()) return setFehler('Bitte einen Namen angeben.')
    const zahl = betragAusText(betrag)
    if (Number.isNaN(zahl)) return setFehler('Der Betrag ist keine Zahl. Beispiel: 1.250,50')
    if (akte === OHNE_AKTE_PRIVAT && !nutzer.email) return setFehler('Privat ohne Akte geht nur angemeldet.')
    setSpeichert(true)
    try {
      const felder = { name, beschreibung, betrag: zahl, status, datum: datum || null, notiz }
      let kv: Kostenvoranschlag
      if (eintrag) {
        const geaendert = akte !== auswahlFuer(eintrag)
        kv = await aendereKostenvoranschlag(eintrag.id, felder, geaendert ? zuordnungAusAuswahl(akte) : undefined)
      } else {
        kv = await legeKostenvoranschlagAn(felder, festeAkte ? zuordnungZuAkte(festeAkte) : zuordnungAusAuswahl(akte), nutzer.name)
      }
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
        <PrimaryButton onClick={speichern} disabled={speichert || nutzer.nurLesen}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </PrimaryButton>
      }
    >
      <Field label="Name (für wen bzw. von wem)">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Beschreibung (worum es geht)">
        <input className={inputClass} value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} placeholder="z. B. Küche, Bad" />
      </Field>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
        <Field label="Betrag in Euro">
          <input className={inputClass} value={betrag} onChange={(e) => setBetrag(e.target.value)} inputMode="decimal" placeholder="leer = noch offen" />
        </Field>
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
// Reiter „Kostenvoranschläge“ in der Akte

export function KostenvoranschlaegeSection({ kunde, bereich }: { kunde: Kunde; bereich: KundeBereich }) {
  const nutzer = useKvNutzer()
  const [liste, setListe] = useState<Kostenvoranschlag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [fenster, setFenster] = useState<{ eintrag?: Kostenvoranschlag } | null>(null)
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
            {liste.length} {liste.length === 1 ? 'Eintrag' : 'Einträge'} · Summe <span className="font-semibold text-slate-800">{fmtEURCent(kvSumme(liste))}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={uebersichtPfad} className="text-sm text-accent-700 hover:underline">
            Alle Kostenvoranschläge
          </Link>
          {!nutzer.nurLesen && (
            <PrimaryButton onClick={() => setFenster({})}>
              <Plus size={15} /> Neu
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
