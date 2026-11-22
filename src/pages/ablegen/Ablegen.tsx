import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, Camera, CheckCircle2, FileText, FolderInput, HelpCircle, Inbox, Search, Smartphone, Trash2, Users, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../../data/kundenBereiche'
import { AKTE_UNGEKLAERT, PFAD_UNGEKLAERT } from '../../data/sammelakten'
import { CURRENT_USER } from '../../data/constants'
import { Card, Field, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { ladeKundenDokumentHoch } from '../../lib/kundenDokumenteStorage'
import { ladeObjektDokumentHoch } from '../../lib/objektDokumenteStorage'
import { entferneGeteilteDateien, entferneGeteilteTexte, ladeGeteilte, notizAusStapel, sichererDateiname } from '../../lib/geteilteDateien'
import { istNurLesen, meldeGesperrt, NUR_LESEN_MELDUNG } from '../../lib/nurLesen'
import { uid, today } from '../../lib/dates'
import { DOKUMENT_ORDNER } from '../../types'
import type { ActivityEntry, Dokument, DokumentOrdnerName, KundeBereich } from '../../types'

// „Datei ablegen" — vor allem fürs Handy. Zwei Wege hinein:
//  1. Android: „Teilen → Mayer Holding" bei installierter App. Der Service-Worker (public/teilen-sw.js)
//     legt die Dateien zwischen und öffnet #/ablegen?geteilt=…; diese Seite liest sie von dort.
//  2. Überall (auch iPhone, das kein Teilen-Ziel für Web-Apps kennt): Foto aufnehmen oder Datei wählen.
// Danach Kundenakte oder Objekt suchen (bei Objekten den Ordner wählen) und ablegen — hochgeladen wird
// genau wie in der Akte (DokumenteSection.tsx) bzw. im Objekt (ObjektDetail.tsx): gleiche Eimer, gleiche
// Pfade, gleiche Einträge. Wer nicht weiß, wohin, legt in die Ungeklärten Eingänge. Geteilter Text oder
// eine Internetadresse wird als Notiz in den Verlauf geschrieben.

type Eintrag = { id: string; datei: File; name: string; vorschau?: string; schluessel?: string }

type Ziel =
  | { art: 'kunde'; bereich: KundeBereich; id: string; titel: string; untertitel: string }
  | { art: 'objekt'; id: string; privat: boolean; titel: string; untertitel: string }

type Erfolg = { text: string; pfad: string; zielName: string }

const MAX_TREFFER = 12

function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function istIphone(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS meldet sich als Mac — erkennbar an den Berührungspunkten.
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function istAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

function istInstalliert(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function neuerEintrag(datei: File, schluessel?: string): Eintrag {
  return {
    id: uid('abl'),
    datei,
    name: datei.name || 'Datei',
    schluessel,
    vorschau: datei.type.startsWith('image/') ? URL.createObjectURL(datei) : undefined,
  }
}

function dateienText(n: number): string {
  return n === 1 ? '1 Datei' : `${n} Dateien`
}

export function Ablegen() {
  const { state, dispatch } = useApp()
  const [params, setParams] = useSearchParams()
  const geteiltKennung = params.get('geteilt')
  const teilenFehler = params.get('teilenFehler') === '1'

  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [notiz, setNotiz] = useState('')
  const [notizStapel, setNotizStapel] = useState<string[]>([])
  const [notizOffen, setNotizOffen] = useState(false)
  const [ladeFehler, setLadeFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [ziel, setZiel] = useState<Ziel | null>(null)
  const [ordnerWahl, setOrdnerWahl] = useState<DokumentOrdnerName | null>(null)
  const [arbeitet, setArbeitet] = useState('')
  const [fehler, setFehler] = useState<string[]>([])
  const [erfolg, setErfolg] = useState<Erfolg | null>(null)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Vorschaubilder wieder freigeben, wenn die Seite verlassen wird.
  const eintraegeRef = useRef(eintraege)
  useEffect(() => {
    eintraegeRef.current = eintraege
  }, [eintraege])
  useEffect(() => () => eintraegeRef.current.forEach((e) => e.vorschau && URL.revokeObjectURL(e.vorschau)), [])

  // Geteiltes aus dem Zwischenspeicher holen (beim Öffnen und bei jedem neuen Teilen).
  useEffect(() => {
    let abgebrochen = false
    void (async () => {
      try {
        const stapel = await ladeGeteilte()
        if (abgebrochen) return
        setEintraege((alt) => {
          const bekannt = new Set(alt.map((e) => e.schluessel).filter(Boolean))
          const neu = stapel.flatMap((s) => s.dateien).filter((d) => !bekannt.has(d.schluessel)).map((d) => neuerEintrag(d.datei, d.schluessel))
          return [...alt, ...neu]
        })
        const mitText = stapel.filter((s) => notizAusStapel(s))
        if (mitText.length > 0) {
          setNotizStapel(mitText.map((s) => s.stapel))
          setNotiz(mitText.map((s) => notizAusStapel(s)).join('\n\n'))
        }
      } catch (err) {
        if (!abgebrochen) setLadeFehler(err instanceof Error ? err.message : 'Die geteilten Dateien ließen sich nicht lesen.')
      }
    })()
    return () => {
      abgebrochen = true
    }
  }, [geteiltKennung])

  // Ordner fürs Objekt: selbst gewählt, sonst Vorschlag — nur Bilder → „Bilder", alles andere → „Sonstiges".
  const ordner: DokumentOrdnerName =
    ordnerWahl ?? (eintraege.length > 0 && eintraege.every((e) => e.datei.type.startsWith('image/')) ? 'Bilder' : 'Sonstiges')

  const treffer = useMemo<Ziel[]>(() => {
    const text = suche.trim().toLowerCase()
    if (text.length < 2) return []
    const passt = (...felder: (string | undefined)[]) => felder.some((f) => f?.toLowerCase().includes(text))
    const liste: Ziel[] = []
    // Wie die globale Suche (GlobaleSuche.tsx): alles, was schon im App-Zustand liegt; die Datenbank hat die Rechte bereits angewendet.
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        if (k.id === AKTE_UNGEKLAERT) continue
        if (passt(k.firma, k.ansprechpartner, k.email, k.telefon)) {
          liste.push({ art: 'kunde', bereich: b.id, id: k.id, titel: k.firma || k.ansprechpartner, untertitel: `${k.ansprechpartner} · ${b.label}` })
        }
      }
    }
    for (const o of state.objekte) {
      if (passt(o.bezeichnung, o.adresse)) liste.push({ art: 'objekt', id: o.id, privat: false, titel: o.bezeichnung, untertitel: `Objekt · ${o.adresse}` })
    }
    for (const o of state.privatObjekte ?? []) {
      if (passt(o.bezeichnung, o.adresse)) liste.push({ art: 'objekt', id: o.id, privat: true, titel: o.bezeichnung, untertitel: `Eigenes Objekt · ${o.adresse}` })
    }
    return liste.slice(0, MAX_TREFFER)
  }, [state, suche])

  const ungeklaertAkte = state.kunden.find((k) => k.id === AKTE_UNGEKLAERT)
  const iphone = istIphone()
  const android = istAndroid()
  const installiert = istInstalliert()
  const nurLesen = istNurLesen()
  const etwasDa = eintraege.length > 0 || notiz.trim().length > 0

  function dateienGewaehlt(e: React.ChangeEvent<HTMLInputElement>) {
    const dateien = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (dateien.length === 0) return
    setErfolg(null)
    setEintraege((alt) => [...alt, ...dateien.map((d) => neuerEintrag(d))])
  }

  async function eintragEntfernen(e: Eintrag) {
    if (e.vorschau) URL.revokeObjectURL(e.vorschau)
    setEintraege((alt) => alt.filter((x) => x.id !== e.id))
    if (e.schluessel) await entferneGeteilteDateien([e.schluessel]).catch(() => undefined)
  }

  async function allesVerwerfen() {
    if (!window.confirm('Alle Dateien und die Notiz von dieser Seite entfernen? In keiner Akte wird etwas gespeichert.')) return
    eintraege.forEach((e) => e.vorschau && URL.revokeObjectURL(e.vorschau))
    await entferneGeteilteDateien(eintraege.map((e) => e.schluessel).filter((s): s is string => !!s)).catch(() => undefined)
    await entferneGeteilteTexte(notizStapel).catch(() => undefined)
    setEintraege([])
    setNotiz('')
    setNotizStapel([])
    setNotizOffen(false)
    setFehler([])
    if (geteiltKennung || teilenFehler) setParams({}, { replace: true })
  }

  async function ablegen(wohin: Ziel | 'ungeklaert') {
    if (nurLesen) {
      meldeGesperrt()
      return
    }
    setFehler([])
    setErfolg(null)

    // Ziel festlegen: Kundenakte (auch die Sammelakte „Ungeklärte Eingänge" in der Unternehmensberatung) oder Objekt.
    const z: Ziel | null =
      wohin === 'ungeklaert'
        ? ungeklaertAkte
          ? { art: 'kunde', bereich: 'beratung', id: AKTE_UNGEKLAERT, titel: 'Ungeklärte Eingänge', untertitel: '' }
          : null
        : wohin
    if (!z) {
      setFehler(['Die Ungeklärten Eingänge sind für dich nicht sichtbar. Bitte eine Akte suchen oder die Datei per Telegram an den Assistenten schicken.'])
      return
    }

    const neu: Dokument[] = []
    const abgelegt: Eintrag[] = []
    const probleme: string[] = []
    for (let i = 0; i < eintraege.length; i++) {
      const e = eintraege[i]
      setArbeitet(`Wird hochgeladen … ${i + 1} von ${eintraege.length}`)
      try {
        const datei = new File([e.datei], sichererDateiname(e.name.trim() || e.datei.name), { type: e.datei.type })
        const { pfad, groesse } = z.art === 'objekt' ? await ladeObjektDokumentHoch(z.id, datei) : await ladeKundenDokumentHoch(z.id, datei)
        neu.push({ id: uid('dok'), name: e.name.trim() || e.datei.name, typ: e.datei.type || 'Datei', datum: today(), groesse, url: pfad })
        abgelegt.push(e)
      } catch (err) {
        probleme.push(`„${e.name}": ${err instanceof Error ? err.message : 'Hochladen fehlgeschlagen.'}`)
      }
    }

    const notizText = notiz.trim()
    const heute = today()
    const verlauf: ActivityEntry[] = []
    if (notizText) verlauf.push({ id: uid('act'), date: heute, text: `Vom Handy geteilt: ${notizText}`, user: CURRENT_USER })
    // In der Sammelakte festhalten, wer es abgelegt hat — dort weiß sonst niemand, woher es kommt.
    if (z.id === AKTE_UNGEKLAERT && neu.length > 0) {
      verlauf.push({ id: uid('act'), date: heute, text: `Vom Handy abgelegt: ${neu.map((d) => d.name).join(', ')}`, user: CURRENT_USER })
    }

    const aktuell = stateRef.current
    if (z.art === 'kunde') {
      const def = KUNDEN_BEREICHE.find((b) => b.id === z.bereich)!
      const kunde = def.get(aktuell).find((k) => k.id === z.id)
      if (kunde && (neu.length > 0 || verlauf.length > 0)) {
        dispatch({
          type: 'UPDATE_KUNDE_IN_BEREICH',
          bereich: z.bereich,
          id: z.id,
          patch: {
            ...(neu.length > 0 ? { dokumente: [...(kunde.dokumente ?? []), ...neu] } : {}),
            ...(verlauf.length > 0 ? { activities: [...verlauf, ...(kunde.activities ?? [])], letzteAktivitaet: heute } : {}),
          },
        })
        // Wie in DokumenteSection.tsx: verknüpfte Kunden bekommen neue Dokumente mit.
        if (neu.length > 0) {
          for (const link of kunde.verknuepfteKunden ?? []) {
            const zielKunde = KUNDEN_BEREICHE.find((b) => b.id === link.bereich)!.get(aktuell).find((k) => k.id === link.id)
            if (!zielKunde) continue
            dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: link.bereich, id: link.id, patch: { dokumente: [...(zielKunde.dokumente ?? []), ...neu] } })
          }
        }
      }
    } else {
      // Wie in ObjektDetail.tsx (dokumentGespeichert): jede Datei in den gewählten Ordner.
      for (const d of neu) dispatch({ type: 'ADD_DOKUMENT', objektId: z.id, ordner, dokument: d })
      const objekt = [...aktuell.objekte, ...(aktuell.privatObjekte ?? [])].find((o) => o.id === z.id)
      if (objekt && verlauf.length > 0) dispatch({ type: 'UPDATE_OBJEKT', id: z.id, patch: { activities: [...verlauf, ...(objekt.activities ?? [])] } })
    }

    // Aufräumen: Abgelegtes aus der Liste und aus dem Zwischenspeicher nehmen; Fehlgeschlagenes bleibt stehen.
    const weg = new Set(abgelegt.map((e) => e.id))
    abgelegt.forEach((e) => e.vorschau && URL.revokeObjectURL(e.vorschau))
    await entferneGeteilteDateien(abgelegt.map((e) => e.schluessel).filter((s): s is string => !!s)).catch(() => undefined)
    setEintraege((alt) => alt.filter((e) => !weg.has(e.id)))
    if (notizText) {
      await entferneGeteilteTexte(notizStapel).catch(() => undefined)
      setNotiz('')
      setNotizStapel([])
      setNotizOffen(false)
    }
    setArbeitet('')
    setFehler(probleme)

    if (neu.length > 0 || notizText) {
      const teile: string[] = []
      if (neu.length > 0) teile.push(`${dateienText(neu.length)} abgelegt${z.art === 'objekt' ? ` (Ordner „${ordner}")` : ''}`)
      if (notizText) teile.push('Notiz im Verlauf gespeichert')
      const pfad =
        z.id === AKTE_UNGEKLAERT ? PFAD_UNGEKLAERT : z.art === 'kunde' ? kundeDetailPfad(z.bereich, z.id) : z.privat ? `/privat/immobilien/objekte/${z.id}` : `/immobilien/objekte/${z.id}`
      setErfolg({ text: teile.join(' · '), pfad, zielName: z.titel })
      // Ist etwas liegen geblieben, bleibt das Ziel gewählt — dann reicht ein zweiter Tipp auf „Ablegen".
      if (probleme.length === 0) {
        setZiel(null)
        setSuche('')
        setOrdnerWahl(null)
      }
      if (geteiltKennung || teilenFehler) setParams({}, { replace: true })
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Datei ablegen</h1>
        <p className="text-sm text-slate-500">Foto, PDF oder Dokument vom Handy direkt in eine Kundenakte oder ein Objekt legen.</p>
      </div>

      {nurLesen && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{NUR_LESEN_MELDUNG}</p>}
      {teilenFehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Das Teilen hat nicht geklappt. Bitte die Datei hier unten auswählen.</p>}
      {ladeFehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ladeFehler}</p>}

      {erfolg && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{erfolg.text}</p>
            <p>
              in „{erfolg.zielName}" ·{' '}
              <Link to={erfolg.pfad} className="font-medium underline">
                Öffnen
              </Link>
            </p>
          </div>
          <button onClick={() => setErfolg(null)} className="text-emerald-600 hover:text-emerald-800" aria-label="Hinweis schließen">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Schritt 1: Dateien */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-accent-200 bg-accent-50 px-3 py-5 text-center text-sm font-medium text-accent-700 hover:bg-accent-100">
            <Camera size={26} />
            Foto aufnehmen
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={dateienGewaehlt} disabled={!!arbeitet} />
          </label>
          <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-medium text-slate-700 hover:bg-slate-100">
            <FolderInput size={26} />
            Datei wählen
            <input type="file" multiple className="hidden" onChange={dateienGewaehlt} disabled={!!arbeitet} />
          </label>
        </div>

        {eintraege.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100">
            {eintraege.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                {e.vorschau ? (
                  <img src={e.vorschau} alt="" className="h-14 w-14 flex-shrink-0 rounded-md border border-slate-200 object-cover" />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
                    <FileText size={22} />
                    {e.datei.type === 'application/pdf' && <span className="sr-only">PDF</span>}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <input
                    className={`${inputClass} py-1.5`}
                    value={e.name}
                    onChange={(ev) => setEintraege((alt) => alt.map((x) => (x.id === e.id ? { ...x, name: ev.target.value } : x)))}
                    aria-label="Dateiname"
                    disabled={!!arbeitet}
                  />
                  <p className="mt-0.5 text-xs text-slate-400">
                    {groesseText(e.datei.size)}
                    {e.schluessel ? ' · geteilt' : ''}
                  </p>
                </div>
                <button
                  onClick={() => void eintragEntfernen(e)}
                  disabled={!!arbeitet}
                  className="flex-shrink-0 rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Datei entfernen"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {(notizOffen || notiz || notizStapel.length > 0) && (
          <div className="mt-4">
            <Field label="Notiz (kommt in den Verlauf der Akte)">
              <textarea className={`${inputClass} min-h-[80px]`} value={notiz} onChange={(e) => setNotiz(e.target.value)} disabled={!!arbeitet} />
            </Field>
          </div>
        )}
        {!notizOffen && !notiz && notizStapel.length === 0 && eintraege.length > 0 && (
          <button onClick={() => setNotizOffen(true)} className="mt-3 text-xs font-medium text-accent-600 hover:underline">
            + Notiz dazuschreiben
          </button>
        )}
      </Card>

      {/* Schritt 2: Wohin */}
      {etwasDa && (
        <Card className="mb-4 p-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Wohin damit?</p>
          {ziel ? (
            <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2">
              {ziel.art === 'kunde' ? <Users size={16} className="flex-shrink-0 text-accent-600" /> : <Building2 size={16} className="flex-shrink-0 text-accent-600" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{ziel.titel}</span>
                <span className="block truncate text-xs text-slate-500">{ziel.untertitel}</span>
              </span>
              <button onClick={() => setZiel(null)} className="text-xs font-medium text-accent-700 hover:underline" disabled={!!arbeitet}>
                Ändern
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${inputClass} pl-9`}
                  value={suche}
                  onChange={(e) => setSuche(e.target.value)}
                  placeholder="Kunde, Mandant oder Objekt suchen — mind. 2 Zeichen"
                />
              </div>
              {suche.trim().length >= 2 && (
                <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
                  {treffer.length === 0 && <p className="px-1 py-3 text-sm text-slate-400">Keine Treffer.</p>}
                  {treffer.map((t) => (
                    <button
                      key={`${t.art}-${t.id}-${t.art === 'kunde' ? t.bereich : ''}`}
                      onClick={() => setZiel(t)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50"
                    >
                      {t.art === 'kunde' ? <Users size={14} className="flex-shrink-0 text-slate-400" /> : <Building2 size={14} className="flex-shrink-0 text-slate-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-800">{t.titel}</span>
                        <span className="block truncate text-xs text-slate-400">{t.untertitel}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {ziel?.art === 'objekt' && eintraege.length > 0 && (
            <Field label="Ordner im Objekt">
              <select
                className={inputClass}
                value={ordner}
                onChange={(e) => setOrdnerWahl(e.target.value as DokumentOrdnerName)}
                disabled={!!arbeitet}
              >
                {DOKUMENT_ORDNER.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {fehler.length > 0 && (
            <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {fehler.map((f) => (
                <p key={f}>{f}</p>
              ))}
              {eintraege.length > 0 && <p className="mt-1 text-xs">Die übrigen Dateien bleiben hier stehen — einfach noch einmal ablegen.</p>}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => ziel && void ablegen(ziel)} disabled={!ziel || !!arbeitet || nurLesen} className="flex-1 justify-center py-2.5 sm:flex-none">
              <Inbox size={15} /> {arbeitet || 'Ablegen'}
            </PrimaryButton>
            <SecondaryButton onClick={() => void ablegen('ungeklaert')} disabled={!!arbeitet || nurLesen || (eintraege.length === 0 && !notiz.trim())} className="flex-1 justify-center py-2.5 sm:flex-none">
              <HelpCircle size={15} /> Ich weiß nicht wohin
            </SecondaryButton>
          </div>
          <p className="mt-2 text-xs text-slate-400">„Ich weiß nicht wohin" legt alles in die Ungeklärten Eingänge — dort sortiert es später jemand ein.</p>
          <button onClick={() => void allesVerwerfen()} disabled={!!arbeitet} className="mt-3 text-xs font-medium text-slate-400 hover:text-rose-600">
            Alles verwerfen
          </button>
        </Card>
      )}

      {/* Hinweise je Gerät */}
      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
        <Smartphone size={15} className="mt-0.5 flex-shrink-0 text-slate-400" />
        {iphone ? (
          <p>
            Auf dem iPhone gibt es kein „Teilen → Mayer Holding" — Apple lässt das für solche Apps nicht zu. Am schnellsten: hier „Foto aufnehmen" oder „Datei
            wählen" tippen. Oder die Datei wie bisher im Teilen-Menü an den Telegram-Assistenten schicken; er legt sie ebenfalls in die passende Akte.
          </p>
        ) : android && !installiert ? (
          <p>
            Tipp: Die App über das Menü des Browsers zum Startbildschirm hinzufügen („App installieren"). Danach erscheint „Mayer Holding" direkt im Teilen-Menü —
            Fotos, PDFs und Texte landen dann ohne Umweg auf dieser Seite.
          </p>
        ) : android ? (
          <p>Aus jeder App: Teilen → „Mayer Holding" wählen. Die Dateien erscheinen dann hier. Langes Drücken auf das App-Symbol öffnet diese Seite direkt.</p>
        ) : (
          <p>
            Auf dem Handy: Android kann Dateien direkt an die installierte App teilen („Teilen → Mayer Holding"). Auf dem iPhone hier „Foto aufnehmen" oder
            „Datei wählen" nutzen oder die Datei an den Telegram-Assistenten schicken.
          </p>
        )}
      </div>
    </div>
  )
}
