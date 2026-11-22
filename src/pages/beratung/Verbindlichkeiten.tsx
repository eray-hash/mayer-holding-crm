import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Mail, Trash2, Search, Paperclip, Upload, FileText, CheckCircle2, AlertTriangle, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, SecondaryButton, Modal, Field, inputClass, StatusBadge, EmptyState } from '../../components/ui'
import { fmtDate, fmtDateTime, fmtEURCent, today, uid } from '../../lib/dates'
import { zahlAusText } from '../../components/KvPositionenEditor'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { supabase } from '../../lib/supabaseClient'
import { brauchtDateiLink, holeAnhangUrl } from '../../lib/emailGateway'
import { ladeKundenDokumentHoch, erzeugeKundenDownloadUrl } from '../../lib/kundenDokumenteStorage'
import { KontoauszugAbgleichKnopf } from '../../components/rechnungen/KontoauszugAbgleich'
import { SteuerberaterExportKnopf } from '../../components/rechnungen/SteuerberaterExport'
import type { Verbindlichkeit, VerbindlichkeitStatus } from '../../types'

// Gegenstück zur Rechnungen-Seite: Geld, das Mayer Holding selbst schuldet (Lieferanten-/
// Kostenrechnungen) statt Geld, das Kunden schulden. Wird sowohl automatisch aus eingehenden
// E-Mails befüllt (quelle 'email-automatisch', siehe inbound-email Edge Function und
// _shared/mailEingang.ts) als auch manuell angelegt — Nutzer-Entscheidung 2026-11-06.
// Seit 21.11.2026 (Eray: „Ich kann nichts anklicken"): jede Zeile öffnet die Akte der Verbindlichkeit
// mit allen Angaben zum Bearbeiten, der Original-Mail samt Anhängen, eigenem Beleg und „Bezahlt am".
// Automatisch erkannte Einträge sind „zu prüfen", bis jemand die Angaben bestätigt (geprueft).

function istUeberfaellig(v: Verbindlichkeit): boolean {
  return v.status !== 'bezahlt' && !!v.zahlungsziel && v.zahlungsziel < today()
}

function effektiverStatus(v: Verbindlichkeit): VerbindlichkeitStatus {
  if (v.status === 'bezahlt') return 'bezahlt'
  return istUeberfaellig(v) ? 'ueberfaellig' : 'offen'
}

function zuPruefen(v: Verbindlichkeit): boolean {
  return v.quelle === 'email-automatisch' && !v.geprueft
}

/** Was bei einem Eintrag fehlt oder verdächtig ist (für den Prüfhinweis). */
function luecken(v: Pick<Verbindlichkeit, 'rechnungsnummer' | 'betragBrutto' | 'betragNetto' | 'zahlungsziel'>): string[] {
  const l: string[] = []
  if (!v.rechnungsnummer?.trim()) l.push('Rechnungsnummer fehlt')
  if (!v.betragBrutto && !v.betragNetto) l.push(v.betragBrutto === 0 || v.betragNetto === 0 ? 'Betrag ist 0 €' : 'Betrag fehlt')
  if (!v.zahlungsziel) l.push('Zahlungsziel fehlt')
  return l
}

const STATUS_LABEL: Record<VerbindlichkeitStatus, string> = { offen: 'Offen', bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig' }
const STATUS_FARBE: Record<VerbindlichkeitStatus, string> = {
  offen: 'bg-sky-50 text-sky-700',
  bezahlt: 'bg-emerald-50 text-emerald-700',
  ueberfaellig: 'bg-rose-50 text-rose-700',
}

const KATEGORIEN = [
  'Miete',
  'Software & Hosting',
  'Telefon & Internet',
  'Bürobedarf',
  'Fahrzeug & Reise',
  'Beratung & Dienstleister',
  'Versicherung',
  'Werbung',
  'Sonstiges',
]

type FilterId = 'alle' | 'offen' | 'ueberfaellig' | 'pruefen' | 'bezahlt'

const FILTER: { id: FilterId; label: string; leer: string; passt: (v: Verbindlichkeit) => boolean }[] = [
  { id: 'alle', label: 'Alle', leer: 'Keine Verbindlichkeiten.', passt: () => true },
  { id: 'offen', label: 'Offen', leer: 'Nichts offen.', passt: (v) => effektiverStatus(v) !== 'bezahlt' },
  { id: 'ueberfaellig', label: 'Überfällig', leer: 'Nichts überfällig.', passt: (v) => effektiverStatus(v) === 'ueberfaellig' },
  { id: 'pruefen', label: 'Zu prüfen', leer: 'Nichts zu prüfen.', passt: zuPruefen },
  { id: 'bezahlt', label: 'Bezahlt', leer: 'Noch nichts als bezahlt markiert.', passt: (v) => v.status === 'bezahlt' },
]

/** Reihenfolge: zu prüfen, überfällig, offen (nach Zahlungsziel), bezahlt. */
function rang(v: Verbindlichkeit): number {
  if (v.status === 'bezahlt') return 3
  if (zuPruefen(v)) return 0
  return istUeberfaellig(v) ? 1 : 2
}

function betragText(v: Verbindlichkeit): string | null {
  if (v.betragBrutto !== undefined) return fmtEURCent(v.betragBrutto)
  if (v.betragNetto !== undefined) return `${fmtEURCent(v.betragNetto)} netto`
  return null
}

export function Verbindlichkeiten() {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [filter, setFilter] = useState<FilterId>('alle')
  const [suche, setSuche] = useState('')
  const [offenId, setOffenId] = useState<string | null>(null)
  const [neu, setNeu] = useState(false)

  const liste = state.verbindlichkeiten

  const kpis = useMemo(() => {
    const offen = liste.filter((v) => effektiverStatus(v) !== 'bezahlt').reduce((s, v) => s + (v.betragBrutto ?? 0), 0)
    const ueberfaellig = liste.filter((v) => effektiverStatus(v) === 'ueberfaellig').reduce((s, v) => s + (v.betragBrutto ?? 0), 0)
    return { offen, ueberfaellig, zuPruefen: liste.filter(zuPruefen).length }
  }, [liste])

  const aktiverFilter = FILTER.find((f) => f.id === filter)!
  const suchtext = suche.trim().toLowerCase()
  const sichtbar = useMemo(
    () =>
      liste
        .filter(aktiverFilter.passt)
        .filter((v) => !suchtext || `${v.lieferant} ${v.lieferantEmail ?? ''} ${v.rechnungsnummer ?? ''} ${v.kategorie ?? ''}`.toLowerCase().includes(suchtext))
        .sort((a, b) => {
          const r = rang(a) - rang(b)
          if (r) return r
          if (rang(a) === 2) return (a.zahlungsziel || '9999').localeCompare(b.zahlungsziel || '9999') || b.datum.localeCompare(a.datum)
          if (rang(a) === 1) return (a.zahlungsziel ?? '').localeCompare(b.zahlungsziel ?? '')
          return (b.bezahltAm ?? b.datum).localeCompare(a.bezahltAm ?? a.datum)
        }),
    [liste, aktiverFilter, suchtext],
  )

  const offeneV = offenId ? liste.find((v) => v.id === offenId) : undefined

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Verbindlichkeiten</h1>
          <p className="text-sm text-slate-500">Eingehende Rechnungen, die Mayer Holding selbst bezahlen muss — zum Öffnen antippen</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <KontoauszugAbgleichKnopf />
          <SteuerberaterExportKnopf />
          {!nutzer.nurLesen && <PrimaryButton onClick={() => setNeu(true)}><Plus size={15} /> Neue Verbindlichkeit</PrimaryButton>}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        <Kpi label="Offen" value={fmtEURCent(kpis.offen)} />
        <Kpi label="Überfällig" value={fmtEURCent(kpis.ueberfaellig)} accent="text-rose-600" />
        <Kpi label="Zu prüfen" value={String(kpis.zuPruefen)} accent="text-amber-600" onClick={() => setFilter('pruefen')} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER.map((f) => {
            const anzahl = liste.filter(f.passt).length
            const aktiv = f.id === filter
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${aktiv ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {f.label} <span className={aktiv ? 'text-white/80' : 'text-slate-400'}>{anzahl}</span>
              </button>
            )
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} placeholder="Lieferant, Nummer oder Kategorie …" value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>

      {/* Breite Ansicht: Tabelle, jede Zeile anklickbar */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Lieferant</th>
              <th className="px-4 py-3">Rechnungs-Nr.</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Betrag</th>
              <th className="px-4 py-3">Zahlungsziel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Kategorie</th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((v) => {
              const status = effektiverStatus(v)
              const betrag = betragText(v)
              return (
                <tr key={v.id} onClick={() => setOffenId(v.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/80">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700">{v.lieferant || '–'}</div>
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      {v.quelle === 'email-automatisch' ? <><Mail size={11} /> aus E-Mail</> : 'von Hand'}
                      {v.beleg && <><span>·</span><Paperclip size={11} /> Beleg</>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{v.rechnungsnummer || <span className="text-amber-600">fehlt</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(v.datum)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{betrag ?? <span className="text-amber-600">fehlt</span>}</td>
                  <td className={`whitespace-nowrap px-4 py-3 ${status === 'ueberfaellig' ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                    {v.status === 'bezahlt' ? (v.bezahltAm ? `bezahlt ${fmtDate(v.bezahltAm)}` : '–') : v.zahlungsziel ? fmtDate(v.zahlungsziel) : '–'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge label={STATUS_LABEL[status]} color={STATUS_FARBE[status]} />
                      {zuPruefen(v) && <StatusBadge label="Zu prüfen" color="bg-amber-50 text-amber-700" />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{v.kategorie || '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sichtbar.length === 0 && <div className="p-4"><EmptyState text={suchtext ? 'Nichts passt zur Suche.' : aktiverFilter.leer} /></div>}
      </Card>

      {/* Schmale Ansicht (Handy): Karten */}
      <div className="space-y-2 lg:hidden">
        {sichtbar.map((v) => {
          const status = effektiverStatus(v)
          const betrag = betragText(v)
          return (
            <button key={v.id} type="button" onClick={() => setOffenId(v.id)} className="block w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{v.lieferant || '–'}</div>
                  <div className="text-xs text-slate-500">
                    {v.rechnungsnummer ? `Nr. ${v.rechnungsnummer}` : <span className="text-amber-600">Nr. fehlt</span>} · {fmtDate(v.datum)}
                  </div>
                </div>
                <div className="shrink-0 text-right font-semibold text-slate-800">{betrag ?? <span className="text-sm font-normal text-amber-600">Betrag fehlt</span>}</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <StatusBadge label={STATUS_LABEL[status]} color={STATUS_FARBE[status]} />
                {zuPruefen(v) && <StatusBadge label="Zu prüfen" color="bg-amber-50 text-amber-700" />}
                <span className={status === 'ueberfaellig' ? 'font-medium text-rose-600' : 'text-slate-500'}>
                  {v.status === 'bezahlt' ? (v.bezahltAm ? `bezahlt am ${fmtDate(v.bezahltAm)}` : '') : v.zahlungsziel ? `fällig ${fmtDate(v.zahlungsziel)}` : 'ohne Zahlungsziel'}
                </span>
                {v.kategorie && <span className="text-slate-400">· {v.kategorie}</span>}
              </div>
            </button>
          )
        })}
        {sichtbar.length === 0 && <EmptyState text={suchtext ? 'Nichts passt zur Suche.' : aktiverFilter.leer} />}
      </div>

      {offeneV && <VerbindlichkeitDetail key={offeneV.id} v={offeneV} onClose={() => setOffenId(null)} />}
      {neu && <VerbindlichkeitDetail onClose={() => setNeu(false)} />}
    </div>
  )
}

function Kpi({ label, value, accent, onClick }: { label: string; value: string; accent?: string; onClick?: () => void }) {
  const inhalt = (
    <>
      <div className="text-[11px] font-medium leading-tight text-slate-400 sm:text-xs">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold sm:text-lg ${accent ?? 'text-slate-800'}`}>{value}</div>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm hover:bg-slate-50 sm:p-4">{inhalt}</button>
  ) : (
    <Card className="min-w-0 p-2.5 sm:p-4">{inhalt}</Card>
  )
}

// ---------------------------------------------------------------------------------------------
// Detail / Neu anlegen

const betragAlsText = (n?: number) => (n === undefined || n === null ? '' : n.toFixed(2).replace('.', ','))
const rund = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

type MailAnhangInfo = { filename: string; size?: number; contentType?: string; url?: string }
type QuellMail = { id: string; von: string; vonName: string; betreff: string; datum?: string; ausschnitt: string; anhaenge: MailAnhangInfo[] }

async function oeffneInNeuemFenster(holeUrl: () => Promise<string>) {
  // Fenster sofort öffnen (sonst blockt der Browser es nach dem Warten), Adresse danach setzen.
  const fenster = window.open('', '_blank')
  try {
    const ziel = await holeUrl()
    if (fenster) fenster.location.href = ziel
    else window.location.href = ziel
  } catch (err) {
    fenster?.close()
    throw err
  }
}

function VerbindlichkeitDetail({ v, onClose }: { v?: Verbindlichkeit; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const nurLesen = nutzer.nurLesen
  const neu = !v

  const [lieferant, setLieferant] = useState(v?.lieferant ?? '')
  const [lieferantEmail, setLieferantEmail] = useState(v?.lieferantEmail ?? '')
  const [rechnungsnummer, setRechnungsnummer] = useState(v?.rechnungsnummer ?? '')
  const [datum, setDatum] = useState(v?.datum ?? today())
  const [netto, setNetto] = useState(betragAlsText(v?.betragNetto))
  const [brutto, setBrutto] = useState(betragAlsText(v?.betragBrutto))
  const [zahlungsziel, setZahlungsziel] = useState(v?.zahlungsziel ?? '')
  const [kategorie, setKategorie] = useState(v?.kategorie ?? '')
  const [notiz, setNotiz] = useState(v?.notiz ?? '')
  const [bezahltAm, setBezahltAm] = useState(v?.bezahltAm ?? today())
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [laedtHoch, setLaedtHoch] = useState(false)
  const [loeschenFrage, setLoeschenFrage] = useState(false)
  const dateiRef = useRef<HTMLInputElement>(null)

  const kategorien = useMemo(() => {
    const eigene = state.verbindlichkeiten.map((x) => x.kategorie?.trim()).filter((k): k is string => !!k)
    return Array.from(new Set([...KATEGORIEN, ...eigene]))
  }, [state.verbindlichkeiten])

  // Eingaben auswerten
  const nettoZahl = netto.trim() ? zahlAusText(netto) : undefined
  const bruttoZahl = brutto.trim() ? zahlAusText(brutto) : undefined
  const zahlFehler =
    (nettoZahl !== undefined && (!Number.isFinite(nettoZahl) || nettoZahl < 0)) || (bruttoZahl !== undefined && (!Number.isFinite(bruttoZahl) || bruttoZahl < 0))
  const eingabeFehler = !lieferant.trim() ? 'Bitte einen Lieferanten eintragen.' : !datum ? 'Bitte ein Datum eintragen.' : zahlFehler ? 'Bitte gültige Beträge eintragen (z. B. 1.250,50).' : ''

  function werte(): Partial<Verbindlichkeit> {
    return {
      lieferant: lieferant.trim(),
      lieferantEmail: lieferantEmail.trim() || undefined,
      rechnungsnummer: rechnungsnummer.trim() || undefined,
      datum,
      betragNetto: nettoZahl !== undefined ? rund(nettoZahl) : undefined,
      betragBrutto: bruttoZahl !== undefined ? rund(bruttoZahl) : undefined,
      zahlungsziel: zahlungsziel || undefined,
      kategorie: kategorie.trim() || undefined,
      notiz: notiz.trim() || undefined,
    }
  }

  const geaendert =
    !!v &&
    JSON.stringify(werte()) !==
      JSON.stringify({
        lieferant: v.lieferant,
        lieferantEmail: v.lieferantEmail,
        rechnungsnummer: v.rechnungsnummer,
        datum: v.datum,
        betragNetto: v.betragNetto,
        betragBrutto: v.betragBrutto,
        zahlungsziel: v.zahlungsziel,
        kategorie: v.kategorie,
        notiz: v.notiz,
      })

  function speichern(zusatz: Partial<Verbindlichkeit> = {}, schliessen = true): boolean {
    setFehler('')
    if (eingabeFehler) {
      setFehler(eingabeFehler)
      return false
    }
    if (v) {
      dispatch({ type: 'UPDATE_VERBINDLICHKEIT', id: v.id, patch: { ...werte(), ...zusatz } })
    } else {
      dispatch({
        type: 'ADD_VERBINDLICHKEIT',
        verbindlichkeit: { id: uid('verb'), status: 'offen', quelle: 'manuell', ...werte(), ...zusatz } as Verbindlichkeit,
      })
    }
    if (schliessen) onClose()
    return true
  }

  function alsGeprueft() {
    if (speichern({ geprueft: true }, false)) setMeldung('Als geprüft markiert.')
  }

  function bezahlt() {
    if (!bezahltAm) return setFehler('Bitte das Datum der Zahlung eintragen.')
    if (speichern({ status: 'bezahlt', bezahltAm }, false)) setMeldung(`Als bezahlt am ${fmtDate(bezahltAm)} vermerkt.`)
  }

  function wiederOffen() {
    if (!v) return
    dispatch({ type: 'UPDATE_VERBINDLICHKEIT', id: v.id, patch: { status: 'offen', bezahltAm: undefined } })
    setMeldung('Wieder auf offen gesetzt.')
  }

  function loeschen() {
    if (!v) return
    dispatch({ type: 'DELETE_VERBINDLICHKEIT', id: v.id })
    onClose()
  }

  async function belegHochladen(datei: File) {
    if (!v) return
    setFehler('')
    setLaedtHoch(true)
    try {
      const { pfad } = await ladeKundenDokumentHoch('verbindlichkeiten', datei)
      dispatch({ type: 'UPDATE_VERBINDLICHKEIT', id: v.id, patch: { beleg: { name: datei.name, url: pfad, typ: datei.type || undefined } } })
      setMeldung(`Beleg „${datei.name}“ gespeichert.`)
    } catch (err) {
      setFehler(`Der Beleg ließ sich nicht hochladen${err instanceof Error && err.message ? ` (${err.message})` : ''}.`)
    } finally {
      setLaedtHoch(false)
      if (dateiRef.current) dateiRef.current.value = ''
    }
  }

  async function belegOeffnen() {
    if (!v?.beleg) return
    const url = v.beleg.url
    try {
      await oeffneInNeuemFenster(() => (url.startsWith('http') ? Promise.resolve(url) : erzeugeKundenDownloadUrl(url)))
    } catch {
      setFehler('Der Beleg ließ sich nicht öffnen. Bitte noch einmal versuchen.')
    }
  }

  const status = v ? effektiverStatus(v) : 'offen'
  const offeneLuecken = luecken(werte())
  const pruefen = !!v && zuPruefen(v)

  return (
    <Modal
      open
      onClose={onClose}
      title={neu ? 'Neue Verbindlichkeit' : `${v!.lieferant || 'Verbindlichkeit'}${v!.rechnungsnummer ? ` · Nr. ${v!.rechnungsnummer}` : ''}`}
      width="max-w-2xl"
      aktionen={
        !nurLesen && (neu || geaendert) ? (
          <PrimaryButton onClick={() => speichern()} disabled={!!eingabeFehler}>{neu ? 'Anlegen' : 'Speichern'}</PrimaryButton>
        ) : undefined
      }
    >
      {v && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge label={STATUS_LABEL[status]} color={STATUS_FARBE[status]} />
          {pruefen && <StatusBadge label="Zu prüfen" color="bg-amber-50 text-amber-700" />}
          {v.geprueft && v.quelle === 'email-automatisch' && <StatusBadge label="Geprüft" color="bg-emerald-50 text-emerald-700" />}
          <span className="text-xs text-slate-500">
            {v.quelle === 'email-automatisch' ? 'Automatisch aus einer E-Mail erkannt' : 'Von Hand angelegt'}
            {status === 'ueberfaellig' && v.zahlungsziel ? ` · seit ${fmtDate(v.zahlungsziel)} fällig` : ''}
          </span>
        </div>
      )}

      {pruefen && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Automatisch erkannt — bitte prüfen.</p>
              <p className="mt-0.5 text-xs">
                Die Angaben stammen nur aus dem Text der E-Mail; in angehängte Rechnungen kann die Erkennung nicht hineinsehen. Bitte mit dem Original unten vergleichen und ergänzen.
              </p>
              {offeneLuecken.length > 0 && (
                <ul className="mt-1.5 list-inside list-disc text-xs font-medium">
                  {offeneLuecken.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
              {!nurLesen && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={alsGeprueft} className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
                    <CheckCircle2 size={13} /> Angaben stimmen – als geprüft markieren
                  </button>
                  <button type="button" onClick={() => setLoeschenFrage(true)} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
                    Keine Rechnung? Eintrag löschen
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <fieldset disabled={nurLesen}>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Lieferant">
            <input className={inputClass} value={lieferant} onChange={(e) => setLieferant(e.target.value)} autoFocus={neu} />
          </Field>
          <Field label="E-Mail des Lieferanten">
            <input className={inputClass} type="email" value={lieferantEmail} onChange={(e) => setLieferantEmail(e.target.value)} />
          </Field>
          <Field label="Rechnungsnummer">
            <input className={`${inputClass} ${pruefen && !rechnungsnummer.trim() ? 'ring-2 ring-amber-300' : ''}`} value={rechnungsnummer} onChange={(e) => setRechnungsnummer(e.target.value)} />
          </Field>
          <Field label="Rechnungsdatum">
            <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
          </Field>
          <Field label="Betrag netto (€)">
            <input inputMode="decimal" placeholder="0,00" className={`${inputClass} ${pruefen && !nettoZahl && !bruttoZahl ? 'ring-2 ring-amber-300' : ''}`} value={netto} onChange={(e) => setNetto(e.target.value)} />
          </Field>
          <Field label="Betrag brutto (€)">
            <input inputMode="decimal" placeholder="0,00" className={`${inputClass} ${pruefen && !nettoZahl && !bruttoZahl ? 'ring-2 ring-amber-300' : ''}`} value={brutto} onChange={(e) => setBrutto(e.target.value)} />
          </Field>
        </div>
        {!nurLesen && (
          <div className="-mt-1 mb-3 flex flex-wrap gap-2 text-xs">
            {bruttoZahl !== undefined && Number.isFinite(bruttoZahl) && (
              <button type="button" onClick={() => setNetto(betragAlsText(rund(bruttoZahl / 1.19)))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50">
                Netto aus Brutto berechnen (19 %)
              </button>
            )}
            {nettoZahl !== undefined && Number.isFinite(nettoZahl) && (
              <button type="button" onClick={() => setBrutto(betragAlsText(rund(nettoZahl * 1.19)))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50">
                Brutto aus Netto berechnen (19 %)
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Zahlungsziel (fällig am)">
            <input type="date" className={`${inputClass} ${pruefen && !zahlungsziel ? 'ring-2 ring-amber-300' : ''}`} value={zahlungsziel} onChange={(e) => setZahlungsziel(e.target.value)} />
          </Field>
          <Field label="Kategorie">
            <input className={inputClass} list="verbindlichkeit-kategorien" value={kategorie} onChange={(e) => setKategorie(e.target.value)} placeholder="z. B. Software & Hosting" />
            <datalist id="verbindlichkeit-kategorien">
              {kategorien.map((k) => <option key={k} value={k} />)}
            </datalist>
          </Field>
        </div>
        <Field label="Notiz">
          <textarea className={inputClass} rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
        </Field>
      </fieldset>

      {neu && (
        <p className="mb-2 text-xs text-slate-400">Einen Beleg kannst du nach dem Anlegen in der geöffneten Verbindlichkeit hochladen.</p>
      )}

      {v && (
        <>
          {/* Bezahlt */}
          <div className="mb-4 rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">Zahlung</div>
            {v.status === 'bezahlt' ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 size={15} /> Bezahlt{v.bezahltAm ? ` am ${fmtDate(v.bezahltAm)}` : ''}
                </span>
                {!nurLesen && (
                  <button type="button" onClick={wiederOffen} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                    <RotateCcw size={12} /> Wieder auf offen setzen
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">
                  Bezahlt am
                  <input type="date" className={`${inputClass} w-44`} value={bezahltAm} disabled={nurLesen} onChange={(e) => setBezahltAm(e.target.value)} />
                </label>
                {!nurLesen && (
                  <button type="button" onClick={bezahlt} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    <CheckCircle2 size={14} /> Als bezahlt markieren
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Beleg */}
          <div className="mb-4 rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-700">Beleg</div>
            {v.beleg ? (
              <button type="button" onClick={belegOeffnen} className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-accent-700 hover:bg-slate-100">
                <FileText size={14} className="shrink-0" /> <span className="truncate">{v.beleg.name}</span>
              </button>
            ) : (
              <p className="mb-2 text-xs text-slate-400">
                {v.quellEmailId ? 'Kein eigener Beleg hochgeladen — die Rechnung hängt ggf. an der Original-Mail unten.' : 'Noch kein Beleg hinterlegt.'}
              </p>
            )}
            {!nurLesen && (
              <div>
                <input ref={dateiRef} type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => e.target.files?.[0] && belegHochladen(e.target.files[0])} />
                <button type="button" disabled={laedtHoch} onClick={() => dateiRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <Upload size={12} /> {laedtHoch ? 'Wird hochgeladen …' : v.beleg ? 'Anderen Beleg hochladen' : 'Beleg hochladen (PDF oder Foto)'}
                </button>
              </div>
            )}
          </div>

          {v.quellEmailId && <OriginalMail messageId={v.quellEmailId} onFehler={setFehler} />}

          {!nurLesen && !pruefen && (
            <div className="mt-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setLoeschenFrage(true)} className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700">
                <Trash2 size={13} /> Eintrag löschen
              </button>
            </div>
          )}

          {loeschenFrage && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
              <span className="flex-1">„{v.lieferant}“ wirklich löschen? Das lässt sich nicht rückgängig machen.</span>
              <button type="button" onClick={loeschen} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">Ja, löschen</button>
              <button type="button" onClick={() => setLoeschenFrage(false)} className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700">Abbrechen</button>
            </div>
          )}
        </>
      )}

      {meldung && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{meldung}</p>}
      {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      {!nurLesen && (neu || geaendert) && (
        <div className="mt-4 flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={() => speichern()} disabled={!!eingabeFehler}>{neu ? 'Anlegen' : 'Änderungen speichern'}</PrimaryButton>
        </div>
      )}
    </Modal>
  )
}

/** Die E-Mail, aus der die Verbindlichkeit erkannt wurde — mit Anhängen zum Öffnen. */
function OriginalMail({ messageId, onFehler }: { messageId: string; onFehler: (t: string) => void }) {
  const [mail, setMail] = useState<QuellMail | null | undefined>(undefined)
  const [aufgeklappt, setAufgeklappt] = useState(false)

  useEffect(() => {
    let aktiv = true
    async function laden() {
      if (!supabase) return setMail(null)
      const { data, error } = await supabase
        .from('eingegangene_emails')
        .select('id, von, von_name, betreff, mail_datum, erstellt_am, ausschnitt, anhaenge')
        .eq('message_id', messageId)
        .order('erstellt_am', { ascending: true })
        .limit(1)
      if (!aktiv) return
      const z = !error ? data?.[0] : undefined
      setMail(
        z
          ? {
              id: z.id,
              von: z.von ?? '',
              vonName: z.von_name ?? '',
              betreff: z.betreff ?? '',
              datum: z.mail_datum ?? z.erstellt_am ?? undefined,
              ausschnitt: z.ausschnitt ?? '',
              anhaenge: Array.isArray(z.anhaenge) ? (z.anhaenge as MailAnhangInfo[]) : [],
            }
          : null,
      )
    }
    laden().catch(() => aktiv && setMail(null))
    return () => {
      aktiv = false
    }
  }, [messageId])

  async function anhangOeffnen(a: MailAnhangInfo) {
    if (!a.url) return
    const url = a.url
    try {
      await oeffneInNeuemFenster(() => (brauchtDateiLink(url) ? holeAnhangUrl(url) : Promise.resolve(url)))
    } catch {
      onFehler(`Der Anhang „${a.filename}“ ließ sich nicht öffnen. Bitte noch einmal versuchen.`)
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Mail size={14} /> Original-E-Mail
      </div>
      {mail === undefined && <p className="text-xs text-slate-400">Wird geladen …</p>}
      {mail === null && <p className="text-xs text-slate-400">Die E-Mail ist im Postfach nicht (mehr) zu finden.</p>}
      {mail && (
        <div className="text-sm">
          <div className="font-medium text-slate-800">{mail.betreff || '(ohne Betreff)'}</div>
          <div className="text-xs text-slate-500">
            von {mail.vonName && mail.vonName !== mail.von ? `${mail.vonName} <${mail.von}>` : mail.von}
            {mail.datum ? ` · ${fmtDateTime(mail.datum)}` : ''}
          </div>
          {mail.anhaenge.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {mail.anhaenge.map((a, i) => (
                <button
                  key={`${a.filename}-${i}`}
                  type="button"
                  onClick={() => anhangOeffnen(a)}
                  disabled={!a.url}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-accent-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:text-slate-400"
                >
                  <Paperclip size={12} className="shrink-0" /> <span className="truncate">{a.filename}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-400">Ohne Anhang.</p>
          )}
          {mail.ausschnitt.trim() && (
            <div className="mt-2">
              <button type="button" onClick={() => setAufgeklappt((x) => !x)} className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700">
                {aufgeklappt ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {aufgeklappt ? 'Text ausblenden' : 'Text der E-Mail anzeigen'}
              </button>
              {aufgeklappt && (
                <pre className="mt-1.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 font-sans text-xs text-slate-600">{mail.ausschnitt}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
