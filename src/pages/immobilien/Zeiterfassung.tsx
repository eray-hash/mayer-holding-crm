import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Clock, Pencil, Trash2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from '../../components/ui'
import { CURRENT_USER, MITARBEITER } from '../../data/constants'
import { addDays, fmtDate, today, uid } from '../../lib/dates'
import type { Objekt, Zeiteintrag } from '../../types'

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

type ZeitraumArt = 'tag' | 'woche' | 'monat' | 'frei'

const ZEITRAUM_ARTEN: { id: ZeitraumArt; label: string }[] = [
  { id: 'tag', label: 'Tag' },
  { id: 'woche', label: 'Woche' },
  { id: 'monat', label: 'Monat' },
  { id: 'frei', label: 'Zeitraum' },
]

// Auswahl "wessen Einträge": '' = meine eigenen, '*' = alle, sonst der Name eines Mitarbeiters.
const NUR_ICH = ''
const ALLE = '*'

/* ───────── Datum und Dauer ───────── */

/** 0 = Montag … 6 = Sonntag (lokales Kalenderdatum). */
function wochentagIndex(iso: string): number {
  return (new Date(iso + 'T00:00:00').getDay() + 6) % 7
}

function montagVon(iso: string): string {
  return addDays(iso, -wochentagIndex(iso))
}

function zweistellig(n: number): string {
  return String(n).padStart(2, '0')
}

function monatsErster(iso: string): string {
  return `${iso.slice(0, 8)}01`
}

function monatsLetzter(iso: string): string {
  const [jahr, monat] = iso.split('-').map(Number)
  return `${iso.slice(0, 8)}${zweistellig(new Date(jahr, monat, 0).getDate())}`
}

function verschiebeMonat(iso: string, um: number): string {
  const [jahr, monat] = iso.split('-').map(Number)
  const d = new Date(jahr, monat - 1 + um, 1)
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-01`
}

/** Kalenderwoche nach deutscher Zählung: die Woche gehört zu dem Jahr, in dem ihr Donnerstag liegt. */
function kalenderwoche(iso: string): number {
  const donnerstag = addDays(montagVon(iso), 3)
  const neujahr = `${donnerstag.slice(0, 4)}-01-01`
  const tage = Math.round((new Date(donnerstag + 'T00:00:00').getTime() - new Date(neujahr + 'T00:00:00').getTime()) / 86_400_000)
  return Math.floor(tage / 7) + 1
}

/** "09:30" → 570. Leere oder unlesbare Angabe → null. */
function minutenAus(zeit: string | undefined): number | null {
  const treffer = /^(\d{1,2}):(\d{2})/.exec(zeit ?? '')
  return treffer ? Number(treffer[1]) * 60 + Number(treffer[2]) : null
}

function dauerVon(e: Zeiteintrag): number {
  return Math.max(0, Math.round(Number(e.dauerMin) || 0))
}

/** 150 → "2 Std. 30 Min." */
function fmtDauer(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} Min.`
  if (m === 0) return `${h} Std.`
  return `${h} Std. ${m} Min.`
}

/** 150 → "2,5 Std." */
function fmtStunden(min: number): string {
  return `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`
}

/** Eingabe wie "1,5" oder "90" als Zahl; leer = 0, Unlesbares = NaN. */
function zahl(text: string): number {
  const t = text.trim().replace(',', '.')
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/* ───────── Seite ───────── */

/** Tägliche Zeiterfassung der Immobilienabteilung — Vorlage ist die Tabelle „Arbeitszeiterfassung – Stunden-
 *  und Tätigkeitsnachweis": eine Zeile je Tätigkeit, dazu die Auswertung. Ziel: sehen, wer an welchem Tag wie
 *  lange woran gearbeitet hat, damit Aufwand und Erlös eines Projekts am Ende gerecht verteilt werden können. */
export function Zeiterfassung() {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const ich = mitarbeiter?.name ?? CURRENT_USER
  // Geschäftsführung und Verwaltung dürfen alle Einträge ändern, alle anderen nur die eigenen.
  const darfAlleAendern = mitarbeiter ? mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin : state.rolle === 'geschaeftsfuehrung'

  const [art, setArt] = useState<ZeitraumArt>('woche')
  const [anker, setAnker] = useState(today())
  const [freiVon, setFreiVon] = useState(today())
  const [freiBis, setFreiBis] = useState(today())
  const [person, setPerson] = useState<string>(NUR_ICH)
  const [ansicht, setAnsicht] = useState<'eintraege' | 'auswertung'>('eintraege')
  const [bearbeite, setBearbeite] = useState<Zeiteintrag | null>(null)

  const [von, bis] = useMemo<[string, string]>(() => {
    if (art === 'tag') return [anker, anker]
    if (art === 'woche') return [montagVon(anker), addDays(montagVon(anker), 6)]
    if (art === 'monat') return [monatsErster(anker), monatsLetzter(anker)]
    const a = freiVon || freiBis || today()
    const b = freiBis || freiVon || today()
    return a <= b ? [a, b] : [b, a]
  }, [art, anker, freiVon, freiBis])

  const objektNach = useMemo(() => new Map(state.objekte.map((o) => [o.id, o])), [state.objekte])

  const weitereNamen = useMemo(
    () => [...new Set([...MITARBEITER, ...state.zeiteintraege.map((e) => e.mitarbeiter)])].filter((n) => n && n !== ich).sort((a, b) => a.localeCompare(b, 'de')),
    [state.zeiteintraege, ich],
  )

  function passtZurAuswahl(e: Zeiteintrag): boolean {
    if (e.datum < von || e.datum > bis) return false
    if (person === ALLE) return true
    return e.mitarbeiter === (person === NUR_ICH ? ich : person)
  }

  const gefiltert = state.zeiteintraege.filter(passtZurAuswahl)
  const summe = gefiltert.reduce((s, e) => s + dauerVon(e), 0)
  const heuteVonMir = state.zeiteintraege.filter((e) => e.mitarbeiter === ich && e.datum === today()).reduce((s, e) => s + dauerVon(e), 0)

  // Neuester Tag oben, innerhalb des Tages nach Uhrzeit; Einträge ohne Uhrzeit ans Ende.
  const nachTag = new Map<string, Zeiteintrag[]>()
  for (const e of gefiltert) nachTag.set(e.datum, [...(nachTag.get(e.datum) ?? []), e])
  const tage = [...nachTag.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([datum, eintraege]) => ({
      datum,
      eintraege: [...eintraege].sort((a, b) => (a.start || '99').localeCompare(b.start || '99') || a.mitarbeiter.localeCompare(b.mitarbeiter, 'de')),
      summe: eintraege.reduce((s, e) => s + dauerVon(e), 0),
    }))

  function bezugText(e: Zeiteintrag): string {
    if (e.objektId) return objektNach.get(e.objektId)?.bezeichnung ?? 'Objekt nicht mehr vorhanden'
    return e.bezug?.trim() ?? ''
  }

  function wechsleArt(neu: ZeitraumArt) {
    if (neu === 'frei') {
      setFreiVon(von)
      setFreiBis(bis)
    } else if (art === 'frei') {
      setAnker(today())
    }
    setArt(neu)
  }

  function blaettere(richtung: 1 | -1) {
    if (art === 'tag') setAnker(addDays(anker, richtung))
    else if (art === 'woche') setAnker(addDays(anker, 7 * richtung))
    else if (art === 'monat') setAnker(verschiebeMonat(anker, richtung))
  }

  function loesche(e: Zeiteintrag) {
    if (!window.confirm(`Eintrag „${e.taetigkeit}" vom ${fmtDate(e.datum)} löschen?`)) return
    dispatch({ type: 'LOESCHE_ZEITEINTRAG', id: e.id })
  }

  const zeitraumText =
    art === 'tag'
      ? `${WOCHENTAGE[wochentagIndex(von)]}, ${fmtDate(von)}`
      : art === 'woche'
        ? `KW ${kalenderwoche(von)} · ${fmtDate(von)} – ${fmtDate(bis)}`
        : new Date(von + 'T00:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const istAktuell = today() >= von && today() <= bis
  const personText = person === ALLE ? 'alle' : person === NUR_ICH ? 'du' : person

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-800">Zeiterfassung</h1>
        <p className="text-sm text-slate-500">
          Stunden- und Tätigkeitsnachweis · heute hast du {heuteVonMir > 0 ? `${fmtDauer(heuteVonMir)} erfasst` : 'noch nichts erfasst'}
        </p>
      </div>

      <Card className="mb-4 p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Clock size={14} /> Neuer Eintrag für {ich}
        </h2>
        <EintragFormular
          wer={ich}
          objekte={state.objekte}
          onSpeichern={(e) => {
            dispatch({ type: 'SPEICHERE_ZEITEINTRAG', eintrag: e })
            return passtZurAuswahl(e) ? '' : 'Der Eintrag liegt außerhalb der Auswahl unten und ist dort gerade nicht zu sehen.'
          }}
        />
      </Card>

      <Card className="mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Zeitraum">
            {ZEITRAUM_ARTEN.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => wechsleArt(z.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${art === z.id ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                aria-pressed={art === z.id}
              >
                {z.label}
              </button>
            ))}
          </div>
          <select className={`${inputClass} ml-auto w-auto max-w-full`} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Wessen Einträge">
            <option value={NUR_ICH}>Meine Einträge</option>
            <option value={ALLE}>Alle Mitarbeiter</option>
            {weitereNamen.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {art === 'frei' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <input type="date" className={`${inputClass} w-auto`} value={freiVon} onChange={(e) => setFreiVon(e.target.value)} aria-label="Von" />
            <span>bis</span>
            <input type="date" className={`${inputClass} w-auto`} value={freiBis} onChange={(e) => setFreiBis(e.target.value)} aria-label="Bis" />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => blaettere(-1)} className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Zurück blättern">
              <ChevronLeft size={15} />
            </button>
            <button type="button" onClick={() => blaettere(1)} className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="Vor blättern">
              <ChevronRight size={15} />
            </button>
            <span className="text-sm font-medium text-slate-700">{zeitraumText}</span>
            {!istAktuell && (
              <button type="button" onClick={() => setAnker(today())} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                Heute
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-800">{fmtStunden(summe)}</span> in {gefiltert.length} {gefiltert.length === 1 ? 'Eintrag' : 'Einträgen'} · {personText}
          </p>
          <div className="flex gap-1" role="group" aria-label="Ansicht">
            {(
              [
                { id: 'eintraege', label: 'Einträge' },
                { id: 'auswertung', label: 'Auswertung' },
              ] as const
            ).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAnsicht(a.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${ansicht === a.id ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                aria-pressed={ansicht === a.id}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {gefiltert.length === 0 ? (
        <EmptyState text="In diesem Zeitraum ist noch nichts erfasst. Oben ist ein Eintrag in wenigen Sekunden angelegt." />
      ) : ansicht === 'eintraege' ? (
        <div className="space-y-4">
          {tage.map((tag) => (
            <Card key={tag.datum} className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {WOCHENTAGE[wochentagIndex(tag.datum)]}, {fmtDate(tag.datum)}
                </h3>
                <span className="text-xs font-medium text-slate-500">
                  {fmtDauer(tag.summe)} · {fmtStunden(tag.summe)}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {tag.eintraege.map((e) => {
                  const bezug = bezugText(e)
                  const aenderbar = e.mitarbeiter === ich || darfAlleAendern
                  return (
                    <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                      <div className="w-28 shrink-0 text-xs text-slate-500">
                        <div className="tabular-nums">{e.start || e.ende ? `${e.start || '–'} bis ${e.ende || '–'}` : 'ohne Uhrzeit'}</div>
                        <div className="text-sm font-medium text-slate-800">{fmtDauer(dauerVon(e))}</div>
                      </div>
                      <div className="min-w-40 flex-1">
                        <div className="text-sm font-medium text-slate-800">{e.taetigkeit}</div>
                        <div className="text-xs text-slate-500">
                          {e.objektId && objektNach.has(e.objektId) ? (
                            <Link to={`/immobilien/objekte/${e.objektId}`} className="font-medium text-accent-600 hover:underline">
                              {bezug}
                            </Link>
                          ) : (
                            bezug || 'ohne Zuordnung'
                          )}
                          {(person !== NUR_ICH || e.mitarbeiter !== ich) && <span className="text-slate-400"> · {e.mitarbeiter}</span>}
                        </div>
                        {e.notiz && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{e.notiz}</p>}
                      </div>
                      {aenderbar && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setBearbeite(e)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                            title="Eintrag bearbeiten"
                            aria-label={`${e.taetigkeit} bearbeiten`}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => loesche(e)}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Eintrag löschen"
                            aria-label={`${e.taetigkeit} löschen`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Auswertung eintraege={gefiltert} bezugText={bezugText} />
      )}

      <Modal open={bearbeite !== null} onClose={() => setBearbeite(null)} title={bearbeite && bearbeite.mitarbeiter !== ich ? `Eintrag von ${bearbeite.mitarbeiter} bearbeiten` : 'Eintrag bearbeiten'}>
        {bearbeite && (
          <EintragFormular
            key={bearbeite.id}
            eintrag={bearbeite}
            wer={bearbeite.mitarbeiter}
            objekte={state.objekte}
            onAbbrechen={() => setBearbeite(null)}
            onSpeichern={(e) => {
              dispatch({ type: 'SPEICHERE_ZEITEINTRAG', eintrag: e })
              setBearbeite(null)
              return ''
            }}
          />
        )}
      </Modal>
    </div>
  )
}

/* ───────── Formular (Schnellerfassung und Bearbeiten) ───────── */

type Entwurf = {
  datum: string
  start: string
  ende: string
  std: string
  min: string
  taetigkeit: string
  objektId: string
  bezug: string
  notiz: string
}

function entwurfAus(e: Zeiteintrag | undefined, datum: string): Entwurf {
  const dauer = e ? dauerVon(e) : 0
  return {
    datum: e?.datum ?? datum,
    start: e?.start ?? '',
    ende: e?.ende ?? '',
    std: dauer >= 60 ? String(Math.floor(dauer / 60)) : '',
    min: dauer % 60 > 0 ? String(dauer % 60) : '',
    taetigkeit: e?.taetigkeit ?? '',
    objektId: e?.objektId ?? '',
    bezug: e?.bezug ?? '',
    notiz: e?.notiz ?? '',
  }
}

/** Ohne `eintrag` ist es die Schnellerfassung: nach dem Speichern leert sich das Formular, das Datum bleibt.
 *  `onSpeichern` darf einen Hinweis zurückgeben, der neben „Gespeichert" erscheint. */
function EintragFormular({
  eintrag,
  wer,
  objekte,
  onSpeichern,
  onAbbrechen,
}: {
  eintrag?: Zeiteintrag
  wer: string
  objekte: Objekt[]
  onSpeichern: (e: Zeiteintrag) => string
  onAbbrechen?: () => void
}) {
  const [entwurf, setEntwurf] = useState<Entwurf>(() => entwurfAus(eintrag, today()))
  const [gespeichert, setGespeichert] = useState<{ dauer: number; hinweis: string } | null>(null)
  const [geprueft, setGeprueft] = useState(false)

  const sortiert = useMemo(() => [...objekte].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de')), [objekte])

  function setze<K extends keyof Entwurf>(feld: K, wert: Entwurf[K]) {
    setEntwurf((e) => ({ ...e, [feld]: wert }))
    setGespeichert(null)
  }

  // Sind Start und Ende eingetragen, ergibt sich die Dauer von selbst. Fehlt eines davon (z. B. noch kein
  // Ende), wird die Dauer von Hand in Stunden und/oder Minuten eingetragen.
  const startMin = minutenAus(entwurf.start)
  const endeMin = minutenAus(entwurf.ende)
  const ausUhrzeiten = startMin !== null && endeMin !== null ? endeMin - startMin : null
  const dauerMin = ausUhrzeiten !== null ? ausUhrzeiten : Math.round(zahl(entwurf.std) * 60 + zahl(entwurf.min))

  const fehler: string[] = []
  if (!entwurf.datum) fehler.push('Bitte ein Datum wählen.')
  if (ausUhrzeiten !== null && ausUhrzeiten <= 0) fehler.push('Das Ende muss nach dem Start liegen.')
  else if (Number.isNaN(dauerMin)) fehler.push('Bitte die Dauer als Zahl eintragen, z. B. 1,5 Stunden oder 90 Minuten.')
  else if (dauerMin <= 0) fehler.push('Bitte Start und Ende eintragen oder die Dauer von Hand.')
  else if (dauerMin > 24 * 60) fehler.push('Ein Eintrag kann höchstens 24 Stunden lang sein.')
  if (entwurf.taetigkeit.trim() === '') fehler.push('Bitte eintragen, was du gemacht hast.')

  function speichern(ev: FormEvent) {
    ev.preventDefault()
    if (fehler.length > 0) {
      setGeprueft(true)
      return
    }
    const fertig: Zeiteintrag = {
      id: eintrag?.id ?? uid('zeit'),
      mitarbeiter: eintrag?.mitarbeiter ?? wer,
      datum: entwurf.datum,
      start: entwurf.start || undefined,
      ende: entwurf.ende || undefined,
      dauerMin,
      taetigkeit: entwurf.taetigkeit.trim(),
      objektId: entwurf.objektId || undefined,
      bezug: entwurf.objektId ? undefined : entwurf.bezug.trim() || undefined,
      notiz: entwurf.notiz.trim() || undefined,
    }
    const hinweis = onSpeichern(fertig)
    if (!eintrag) {
      setEntwurf(entwurfAus(undefined, entwurf.datum))
      setGespeichert({ dauer: dauerMin, hinweis })
      setGeprueft(false)
    }
  }

  const dauerFest = ausUhrzeiten !== null
  const festStd = dauerFest && ausUhrzeiten > 0 ? String(Math.floor(ausUhrzeiten / 60)) : ''
  const festMin = dauerFest && ausUhrzeiten > 0 ? String(ausUhrzeiten % 60) : ''

  return (
    <form onSubmit={speichern} noValidate>
      <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="col-span-2 sm:col-span-1">
          <Field label="Datum">
            <input type="date" className={inputClass} value={entwurf.datum} onChange={(e) => setze('datum', e.target.value)} />
          </Field>
        </div>
        <Field label="Start">
          <input type="time" className={inputClass} value={entwurf.start} onChange={(e) => setze('start', e.target.value)} />
        </Field>
        <Field label="Ende">
          <input type="time" className={inputClass} value={entwurf.ende} onChange={(e) => setze('ende', e.target.value)} />
        </Field>
        <Field label="Dauer: Stunden">
          <input
            className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
            inputMode="decimal"
            value={dauerFest ? festStd : entwurf.std}
            onChange={(e) => setze('std', e.target.value)}
            disabled={dauerFest}
            placeholder="z. B. 1,5"
          />
        </Field>
        <Field label="Dauer: Minuten">
          <input
            className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
            inputMode="numeric"
            value={dauerFest ? festMin : entwurf.min}
            onChange={(e) => setze('min', e.target.value)}
            disabled={dauerFest}
            placeholder="z. B. 45"
          />
        </Field>
      </div>
      <p className="-mt-1 mb-3 text-xs text-slate-400">
        {dauerFest
          ? ausUhrzeiten > 0
            ? `Dauer aus Start und Ende: ${fmtDauer(ausUhrzeiten)}`
            : 'Die Dauer wird aus Start und Ende berechnet.'
          : 'Noch kein Ende? Dann trag die Dauer von Hand ein — in Stunden, in Minuten oder beides.'}
      </p>

      <Field label="Tätigkeit / Aufgabe">
        <input className={inputClass} value={entwurf.taetigkeit} onChange={(e) => setze('taetigkeit', e.target.value)} placeholder="z. B. Besichtigung, Unterlagen prüfen, Telefonat mit Eigentümer" />
      </Field>

      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Objekt">
          <select className={inputClass} value={entwurf.objektId} onChange={(e) => setze('objektId', e.target.value)}>
            <option value="">kein Objekt</option>
            {entwurf.objektId && !sortiert.some((o) => o.id === entwurf.objektId) && <option value={entwurf.objektId}>Objekt nicht mehr vorhanden</option>}
            {sortiert.map((o) => (
              <option key={o.id} value={o.id}>
                {o.bezeichnung}
              </option>
            ))}
          </select>
        </Field>
        {entwurf.objektId === '' && (
          <Field label="Projekt / Kunde (statt Objekt)">
            <input className={inputClass} value={entwurf.bezug} onChange={(e) => setze('bezug', e.target.value)} placeholder="frei eintragen" />
          </Field>
        )}
      </div>

      <Field label="Notiz">
        <textarea className={`${inputClass} min-h-16`} value={entwurf.notiz} onChange={(e) => setze('notiz', e.target.value)} />
      </Field>

      {geprueft && fehler.length > 0 && (
        <p className="mb-3 text-xs text-amber-600" role="alert">
          {fehler.join(' ')}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {gespeichert && (
          <span className="mr-auto text-xs text-slate-500" role="status">
            <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
              <Check size={13} /> Gespeichert ({fmtDauer(gespeichert.dauer)})
            </span>
            {gespeichert.hinweis && ` ${gespeichert.hinweis}`}
          </span>
        )}
        {onAbbrechen && <SecondaryButton onClick={onAbbrechen}>Abbrechen</SecondaryButton>}
        <PrimaryButton type="submit">{eintrag ? 'Änderung speichern' : 'Eintrag speichern'}</PrimaryButton>
      </div>
    </form>
  )
}

/* ───────── Auswertung ───────── */

type BalkenZeile = { schluessel: string; name: string; min: number; zusatz?: string }

function Auswertung({ eintraege, bezugText }: { eintraege: Zeiteintrag[]; bezugText: (e: Zeiteintrag) => string }) {
  const summe = eintraege.reduce((s, e) => s + dauerVon(e), 0)
  const schnitt = eintraege.length > 0 ? Math.round(summe / eintraege.length) : 0

  const jeWochentag: BalkenZeile[] = WOCHENTAGE.map((name, i) => ({
    schluessel: WOCHENTAGE_KURZ[i],
    name,
    min: eintraege.filter((e) => wochentagIndex(e.datum) === i).reduce((s, e) => s + dauerVon(e), 0),
  }))

  const personen = new Map<string, number>()
  // Je Objekt/Projekt: Gesamtzeit und wer wie viel davon geleistet hat (für die Verteilung am Projektende).
  const projekte = new Map<string, { name: string; min: number; wer: Map<string, number> }>()
  for (const e of eintraege) {
    const dauer = dauerVon(e)
    personen.set(e.mitarbeiter, (personen.get(e.mitarbeiter) ?? 0) + dauer)
    const name = bezugText(e)
    const schluessel = e.objektId ? `objekt:${e.objektId}` : name ? `frei:${name.toLowerCase()}` : 'ohne'
    const p = projekte.get(schluessel) ?? { name: name || 'ohne Zuordnung', min: 0, wer: new Map<string, number>() }
    p.min += dauer
    p.wer.set(e.mitarbeiter, (p.wer.get(e.mitarbeiter) ?? 0) + dauer)
    projekte.set(schluessel, p)
  }

  const jePerson: BalkenZeile[] = [...personen.entries()].map(([name, min]) => ({ schluessel: name, name, min })).sort((a, b) => b.min - a.min)
  const mehrerePersonen = personen.size > 1
  const jeProjekt: BalkenZeile[] = [...projekte.entries()]
    .map(([schluessel, p]) => ({
      schluessel,
      name: p.name,
      min: p.min,
      zusatz: mehrerePersonen
        ? [...p.wer.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([wer, min]) => `${wer} ${fmtStunden(min)}`)
            .join(' · ')
        : undefined,
    }))
    .sort((a, b) => b.min - a.min)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kennzahl titel="Stunden gesamt" wert={fmtStunden(summe)} zusatz={fmtDauer(summe)} />
        <Kennzahl titel="Einträge" wert={String(eintraege.length)} />
        <Kennzahl titel="Schnitt je Eintrag" wert={fmtStunden(schnitt)} zusatz={fmtDauer(schnitt)} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BalkenKarte titel="Stunden je Wochentag" zeilen={jeWochentag} summe={summe} />
        <BalkenKarte titel="Stunden je Mitarbeiter" zeilen={jePerson} summe={summe} />
      </div>
      <BalkenKarte titel="Stunden je Objekt / Projekt" zeilen={jeProjekt} summe={summe} />
    </div>
  )
}

function Kennzahl({ titel, wert, zusatz }: { titel: string; wert: string; zusatz?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{titel}</div>
      <div className="text-xl font-semibold text-slate-800">{wert}</div>
      {zusatz && <div className="text-xs text-slate-400">{zusatz}</div>}
    </Card>
  )
}

function BalkenKarte({ titel, zeilen, summe }: { titel: string; zeilen: BalkenZeile[]; summe: number }) {
  const groesster = Math.max(1, ...zeilen.map((z) => z.min))
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">{titel}</h3>
      <ul className="space-y-3">
        {zeilen.map((z) => (
          <li key={z.schluessel}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className={`min-w-0 break-words ${z.min > 0 ? 'text-slate-700' : 'text-slate-400'}`}>{z.name}</span>
              <span className={`shrink-0 tabular-nums ${z.min > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
                {fmtStunden(z.min)}
                {z.min > 0 && summe > 0 && <span className="text-xs text-slate-400"> · {Math.round((z.min / summe) * 100)} %</span>}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
              <div className="h-2 rounded-full bg-accent-400" style={{ width: `${(z.min / groesster) * 100}%` }} />
            </div>
            {z.zusatz && <div className="mt-1 text-xs text-slate-400">{z.zusatz}</div>}
          </li>
        ))}
      </ul>
    </Card>
  )
}
