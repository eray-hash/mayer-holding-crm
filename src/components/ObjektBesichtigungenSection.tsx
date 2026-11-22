// Reiter „Besichtigungen" der Objektakte: Termine mit Interessenten, Rückmeldung, Interesse und
// Kaufpreisangebote (21.11.2026). Daten: Tabelle `besichtigungen` (lib/besichtigungen.ts). Jede
// wichtige Änderung steht zusätzlich im Verlauf des Objekts und, falls verknüpft, des Kontakts.
// Seit 22.11.2026: „Termine für Interessenten freigeben“ — Zeiten (Tabelle besichtigung_zeiten), die
// Interessenten im Portal nach ihrer Zustimmung selbst buchen (email-gateway/objektPortal.ts).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarClock, CalendarPlus, Globe, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import { kundeDetailPfad } from '../data/kundenBereiche'
import { fmtEUR, today, uid } from '../lib/dates'
import { ladeKollegen, type Kollege } from '../lib/kalenderDb'
import {
  BESICHTIGUNG_INTERESSE,
  BESICHTIGUNG_STATUS,
  KalenderBelegt,
  besichtigungAusKalender,
  besichtigungInKalender,
  interesseLabel,
  ladeBesichtigungen,
  loescheBesichtigung,
  speichereBesichtigung,
  statusLabel,
  zeitText,
  type Besichtigung,
  type BesichtigungInteresse,
  type BesichtigungStatus,
} from '../lib/besichtigungen'
import {
  ladeBesichtigungsZeiten,
  ladeMaklerBelegt,
  legeBesichtigungsZeitenAn,
  loescheBesichtigungsZeit,
  sageBesichtigungsZeitAb,
  type BesichtigungsZeit,
} from '../lib/objektPortal'
import {
  DAUER_WAHL as ZEIT_DAUER_WAHL,
  einzelZeit,
  serienZeiten,
  spanne,
  tagKurz,
  uhr,
  ueberschneidet,
  type BelegtBlock,
  type Zeitfenster,
} from '../../supabase/functions/_shared/besichtigungZeiten.ts'
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from './ui'
import type { ActivityEntry, Objekt } from '../types'

const DAUER_WAHL = [15, 30, 45, 60, 90, 120]

/** datetime-local-Wert (Ortszeit des Browsers) aus einem ISO-Zeitpunkt und zurück. */
function alsEingabe(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function ausEingabe(wert: string): string {
  const d = new Date(wert)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function morgenZehnUhr(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

export function ObjektBesichtigungenSection({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const [liste, setListe] = useState<Besichtigung[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [bearbeiten, setBearbeiten] = useState<{ b: Besichtigung; neu: boolean } | null>(null)
  const [kollegen, setKollegen] = useState<Kollege[]>([])
  const team = useMemo(() => kollegen.map((k) => k.name), [kollegen])

  const laden = useCallback(async () => {
    setLaedt(true)
    try {
      setListe(await ladeBesichtigungen(objekt.id))
      setFehler('')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Besichtigungen konnten nicht geladen werden.')
    } finally {
      setLaedt(false)
    }
  }, [objekt.id])

  useEffect(() => {
    void laden()
  }, [laden])

  useEffect(() => {
    ladeKollegen()
      .then(setKollegen)
      .catch(() => setKollegen([]))
  }, [])

  const kennzahlen = useMemo(() => {
    const geplant = liste.filter((b) => b.status === 'geplant' && new Date(b.beginn).getTime() >= Date.now() - 3600000).length
    const durchgefuehrt = liste.filter((b) => b.status === 'durchgefuehrt').length
    const angebote = liste.filter((b) => typeof b.angebot === 'number' && b.angebot > 0)
    const hoechstes = angebote.reduce((m, b) => Math.max(m, b.angebot ?? 0), 0)
    const interessiert = liste.filter((b) => b.interesse === 'hoch' || b.interesse === 'mittel').length
    return { geplant, durchgefuehrt, angebote: angebote.length, hoechstes, interessiert }
  }, [liste])

  function neu() {
    setHinweis('')
    setBearbeiten({
      neu: true,
      b: {
        id: uid('bes'),
        objektId: objekt.id,
        interessent: '',
        telefon: '',
        email: '',
        beginn: morgenZehnUhr(),
        dauerMin: 30,
        durchgefuehrtVon: wer,
        status: 'geplant',
        rueckmeldung: '',
        naechsterSchritt: '',
        erstelltVon: wer,
      },
    })
  }

  function oeffnen(b: Besichtigung, status?: BesichtigungStatus) {
    setHinweis('')
    setBearbeiten({ neu: false, b: status ? { ...b, status } : b })
  }

  function verlaufEintragen(text: string, b: Besichtigung) {
    const eintrag: ActivityEntry = { id: uid('act'), date: today(), text, user: wer }
    dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { activities: [eintrag, ...objekt.activities] } })
    if (b.kundeId) {
      const kontakt = state.immobilienKunden.find((k) => k.id === b.kundeId)
      if (kontakt) {
        const k: ActivityEntry = { id: uid('act'), date: today(), text: `${text} (Objekt: ${objekt.bezeichnung})`, user: wer }
        dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: kontakt.id, patch: { activities: [k, ...kontakt.activities], letzteAktivitaet: today() } })
      }
    }
  }

  /** Was sich Erwähnenswertes geändert hat, als ein Satz für den Verlauf — leer, wenn nichts. */
  function verlaufText(vorher: Besichtigung | undefined, b: Besichtigung): string {
    const teile: string[] = []
    if (!vorher) teile.push(`Besichtigung mit ${b.interessent} für ${zeitText(b.beginn)} eingetragen`)
    else if (vorher.beginn !== b.beginn && b.status === 'geplant') teile.push(`Besichtigung mit ${b.interessent} verschoben auf ${zeitText(b.beginn)}`)
    if (vorher && vorher.status !== b.status && b.status !== 'geplant') teile.push(`Besichtigung mit ${b.interessent}: ${statusLabel(b.status)}`)
    if (!vorher && b.status !== 'geplant') teile.push(statusLabel(b.status))
    if (b.interesse && b.interesse !== vorher?.interesse) teile.push(interesseLabel(b.interesse))
    if (b.angebot && b.angebot !== vorher?.angebot) teile.push(`Kaufpreisangebot ${fmtEUR(b.angebot)}`)
    return teile.join(' · ')
  }

  async function loeschen(b: Besichtigung) {
    if (!window.confirm(`Besichtigung mit ${b.interessent} (${zeitText(b.beginn)}) löschen?`)) return
    try {
      await loescheBesichtigung(b.id)
      if (b.kalenderTerminId) await besichtigungAusKalender(b.kalenderTerminId).catch(() => undefined)
      setListe((l) => l.filter((x) => x.id !== b.id))
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Löschen hat nicht geklappt.')
    }
  }

  async function gespeichert(b: Besichtigung, vorher: Besichtigung | undefined, meldung: string) {
    const text = verlaufText(vorher, b)
    if (text) verlaufEintragen(text, b)
    setBearbeiten(null)
    setHinweis(meldung)
    await laden()
  }

  const sortiert = useMemo(() => {
    // Anstehende Termine oben (nächster zuerst), danach alles Vergangene (neuestes zuerst).
    const jetzt = Date.now()
    const kommend = liste.filter((b) => b.status === 'geplant' && new Date(b.beginn).getTime() >= jetzt - 3600000).sort((a, b) => a.beginn.localeCompare(b.beginn))
    const rest = liste.filter((b) => !kommend.includes(b)).sort((a, b) => b.beginn.localeCompare(a.beginn))
    return { kommend, rest }
  }, [liste])

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Besichtigungen</h3>
            <p className="mt-1 text-xs text-slate-500">Wer hat das Objekt wann angesehen, wie war die Rückmeldung, gab es ein Angebot? Das fließt auch in den Eigentümerbericht.</p>
          </div>
          <PrimaryButton onClick={neu}>
            <Plus size={14} /> Besichtigung eintragen
          </PrimaryButton>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kennzahl label="Anstehend" wert={String(kennzahlen.geplant)} />
          <Kennzahl label="Durchgeführt" wert={String(kennzahlen.durchgefuehrt)} />
          <Kennzahl label="Mit Interesse" wert={String(kennzahlen.interessiert)} />
          <Kennzahl label={kennzahlen.angebote === 1 ? '1 Angebot, Höhe' : `${kennzahlen.angebote} Angebote, höchstes`} wert={kennzahlen.hoechstes ? fmtEUR(kennzahlen.hoechstes) : '–'} />
        </div>
        {hinweis && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{hinweis}</p>}
        {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{fehler}</p>}
      </Card>

      {!objekt.privatBesitzer && <PortalZeitenKarte objekt={objekt} kollegen={kollegen} wer={wer} />}

      {laedt && liste.length === 0 ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : liste.length === 0 ? (
        <EmptyState text="Noch keine Besichtigung eingetragen." />
      ) : (
        <>
          {sortiert.kommend.length > 0 && <Liste titel="Anstehend" eintraege={sortiert.kommend} onOeffnen={oeffnen} onLoeschen={loeschen} />}
          {sortiert.rest.length > 0 && <Liste titel="Bisher" eintraege={sortiert.rest} onOeffnen={oeffnen} onLoeschen={loeschen} />}
        </>
      )}

      {bearbeiten && (
        <BesichtigungFormular
          key={bearbeiten.b.id}
          objekt={objekt}
          start={bearbeiten.b}
          vorher={bearbeiten.neu ? undefined : liste.find((x) => x.id === bearbeiten.b.id)}
          team={team}
          onClose={() => setBearbeiten(null)}
          onGespeichert={gespeichert}
        />
      )}
    </div>
  )
}

function Kennzahl({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-base font-semibold text-slate-700">{wert}</div>
    </div>
  )
}

function Liste({
  titel,
  eintraege,
  onOeffnen,
  onLoeschen,
}: {
  titel: string
  eintraege: Besichtigung[]
  onOeffnen: (b: Besichtigung, status?: BesichtigungStatus) => void
  onLoeschen: (b: Besichtigung) => void
}) {
  return (
    <Card className="p-0">
      <div className="border-b border-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{titel}</div>
      <ul className="divide-y divide-slate-100">
        {eintraege.map((b) => {
          const status = BESICHTIGUNG_STATUS.find((s) => s.id === b.status)
          const interesse = BESICHTIGUNG_INTERESSE.find((i) => i.id === b.interesse)
          return (
            <li key={b.id} className="px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{zeitText(b.beginn)}</span>
                    {status && <StatusBadge label={status.label} color={status.farbe} />}
                    {interesse && <StatusBadge label={interesse.label} color={interesse.farbe} />}
                    {b.erstelltVon === 'Interessenten-Portal' && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400" title="Vom Interessenten im Portal gebucht">
                        <Globe size={12} /> über das Portal
                      </span>
                    )}
                    {b.kalenderTerminId && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400" title="Steht im Kalender">
                        <CalendarCheck size={12} /> im Kalender
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {b.kundeId ? (
                      <Link to={kundeDetailPfad('immobilienkunden', b.kundeId)} className="font-medium text-accent-700 hover:underline">
                        {b.interessent}
                      </Link>
                    ) : (
                      <span className="font-medium">{b.interessent}</span>
                    )}
                    {(b.telefon || b.email) && <span className="text-xs text-slate-400"> · {[b.telefon, b.email].filter(Boolean).join(' · ')}</span>}
                  </div>
                  {b.rueckmeldung && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{b.rueckmeldung}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    {b.angebot ? <span className="font-medium text-slate-700">Angebot: {fmtEUR(b.angebot)}</span> : null}
                    {b.naechsterSchritt && <span>Nächster Schritt: {b.naechsterSchritt}</span>}
                    {b.durchgefuehrtVon && <span>Durch: {b.durchgefuehrtVon}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {b.status === 'geplant' && (
                    <>
                      <button onClick={() => onOeffnen(b, 'durchgefuehrt')} className="rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                        Durchgeführt …
                      </button>
                      <button onClick={() => onOeffnen(b, 'abgesagt')} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                        Abgesagt …
                      </button>
                    </>
                  )}
                  <button onClick={() => onOeffnen(b)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Bearbeiten">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => onLoeschen(b)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Löschen">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function BesichtigungFormular({
  objekt,
  start,
  vorher,
  team,
  onClose,
  onGespeichert,
}: {
  objekt: Objekt
  start: Besichtigung
  vorher?: Besichtigung
  team: string[]
  onClose: () => void
  onGespeichert: (b: Besichtigung, vorher: Besichtigung | undefined, meldung: string) => Promise<void>
}) {
  const { state } = useApp()
  const [b, setB] = useState<Besichtigung>(start)
  const [inKalender, setInKalender] = useState(!start.kalenderTerminId && start.status === 'geplant')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState('')
  const kontakte = useMemo(() => [...state.immobilienKunden].sort((x, y) => x.firma.localeCompare(y.firma, 'de')), [state.immobilienKunden])

  const setze = <K extends keyof Besichtigung>(feld: K, wert: Besichtigung[K]) => setB((x) => ({ ...x, [feld]: wert }))

  function kontaktWaehlen(id: string) {
    if (!id) {
      setB((x) => ({ ...x, kundeId: undefined, kundeBereich: undefined }))
      return
    }
    const k = kontakte.find((x) => x.id === id)
    if (!k) return
    setB((x) => ({
      ...x,
      kundeId: k.id,
      kundeBereich: 'immobilienkunden',
      interessent: k.firma,
      telefon: x.telefon || k.telefon || '',
      email: x.email || k.email || '',
    }))
  }

  async function speichern(trotzUeberschneidung = false) {
    if (!b.interessent.trim()) {
      setFehler('Bitte den Interessenten angeben.')
      return
    }
    if (!b.beginn) {
      setFehler('Bitte Datum und Uhrzeit angeben.')
      return
    }
    setSpeichert(true)
    setFehler('')
    const meldungen: string[] = []
    let zuSpeichern: Besichtigung = { ...b, angebot: b.angebot && b.angebot > 0 ? b.angebot : undefined }
    try {
      // Kalender: neu eintragen, verschieben oder bei Absage entfernen. Scheitert das, bleibt die Besichtigung trotzdem gespeichert.
      const zeitGeaendert = !vorher || vorher.beginn !== zuSpeichern.beginn || vorher.dauerMin !== zuSpeichern.dauerMin || vorher.interessent !== zuSpeichern.interessent
      if (zuSpeichern.status === 'geplant' && (inKalender || (zuSpeichern.kalenderTerminId && zeitGeaendert))) {
        try {
          const terminId = await besichtigungInKalender(zuSpeichern, objekt, trotzUeberschneidung)
          zuSpeichern = { ...zuSpeichern, kalenderTerminId: terminId }
          meldungen.push(inKalender ? 'Im Kalender eingetragen.' : 'Kalendertermin angepasst.')
        } catch (err) {
          if (err instanceof KalenderBelegt) {
            setSpeichert(false)
            if (window.confirm(`${err.message}\n\nTrotzdem in den Kalender eintragen?`)) return speichern(true)
            setSpeichert(true)
            meldungen.push('Nicht in den Kalender eingetragen (Zeit schon belegt).')
          } else {
            meldungen.push(`Kalender: ${err instanceof Error ? err.message : 'nicht geklappt'}`)
          }
        }
      } else if ((zuSpeichern.status === 'abgesagt' || zuSpeichern.status === 'nicht_erschienen') && zuSpeichern.kalenderTerminId) {
        try {
          await besichtigungAusKalender(zuSpeichern.kalenderTerminId)
          zuSpeichern = { ...zuSpeichern, kalenderTerminId: undefined }
          meldungen.push('Aus dem Kalender genommen.')
        } catch (err) {
          meldungen.push(`Kalender: ${err instanceof Error ? err.message : 'nicht geklappt'}`)
        }
      }
      await speichereBesichtigung(zuSpeichern)
      await onGespeichert(zuSpeichern, vorher, ['Besichtigung gespeichert.', ...meldungen].join(' '))
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Speichern hat nicht geklappt.')
      setSpeichert(false)
    }
  }

  const angebotText = b.angebot === undefined || Number.isNaN(b.angebot) ? '' : String(b.angebot)

  return (
    <Modal
      open
      onClose={onClose}
      title={vorher ? `Besichtigung bearbeiten` : 'Besichtigung eintragen'}
      width="max-w-2xl"
      aktionen={
        <PrimaryButton onClick={() => void speichern()} disabled={speichert}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </PrimaryButton>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Interessent aus den Kontakten">
          <select className={inputClass} value={b.kundeId ?? ''} onChange={(e) => kontaktWaehlen(e.target.value)}>
            <option value="">Nicht in den Kontakten – Namen eintragen …</option>
            {kontakte.map((k) => (
              <option key={k.id} value={k.id}>
                {k.firma}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name des Interessenten">
          <input className={inputClass} value={b.interessent} onChange={(e) => setze('interessent', e.target.value)} placeholder="z. B. Familie Müller" />
        </Field>
        <Field label="Telefon">
          <input className={inputClass} value={b.telefon} onChange={(e) => setze('telefon', e.target.value)} />
        </Field>
        <Field label="E-Mail">
          <input className={inputClass} type="email" value={b.email} onChange={(e) => setze('email', e.target.value)} />
        </Field>
        <Field label="Datum und Uhrzeit">
          <input className={inputClass} type="datetime-local" value={alsEingabe(b.beginn)} onChange={(e) => setze('beginn', ausEingabe(e.target.value))} />
        </Field>
        <Field label="Dauer">
          <select className={inputClass} value={b.dauerMin} onChange={(e) => setze('dauerMin', Number(e.target.value))}>
            {DAUER_WAHL.map((d) => (
              <option key={d} value={d}>
                {d} Minuten
              </option>
            ))}
          </select>
        </Field>
        <Field label="Durchgeführt von">
          <input className={inputClass} list="besichtigung-team" value={b.durchgefuehrtVon} onChange={(e) => setze('durchgefuehrtVon', e.target.value)} />
          <datalist id="besichtigung-team">
            {team.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Field label="Stand">
          <select className={inputClass} value={b.status} onChange={(e) => setze('status', e.target.value as BesichtigungStatus)}>
            {BESICHTIGUNG_STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {b.status === 'geplant' && !b.kalenderTerminId && (
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={inKalender} onChange={(e) => setInKalender(e.target.checked)} />
          <CalendarPlus size={14} className="text-slate-400" /> In meinen Kalender eintragen (der Interessent bekommt keine Einladung)
        </label>
      )}
      {b.kalenderTerminId && (
        <p className="mt-3 text-xs text-slate-500">
          Steht im Kalender. Wird die Zeit geändert, wandert der Termin mit; bei „Abgesagt“ oder „Nicht erschienen“ wird er entfernt.
        </p>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Nach der Besichtigung</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Interesse">
            <select className={inputClass} value={b.interesse ?? ''} onChange={(e) => setze('interesse', (e.target.value || undefined) as BesichtigungInteresse | undefined)}>
              <option value="">– noch offen –</option>
              {BESICHTIGUNG_INTERESSE.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kaufpreisangebot (Euro)">
            <input
              className={inputClass}
              type="number"
              min={0}
              step={1000}
              value={angebotText}
              onChange={(e) => setze('angebot', e.target.value === '' ? undefined : Number(e.target.value))}
              placeholder="leer = kein Angebot"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Rückmeldung des Interessenten">
            <textarea
              className={inputClass}
              rows={3}
              value={b.rueckmeldung}
              onChange={(e) => setze('rueckmeldung', e.target.value)}
              placeholder="Was hat gefallen, was nicht? Fragen, Bedenken, Finanzierung …"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Nächster Schritt">
            <input className={inputClass} value={b.naechsterSchritt} onChange={(e) => setze('naechsterSchritt', e.target.value)} placeholder="z. B. Unterlagen schicken, zweite Besichtigung, Finanzierungsnachweis anfordern" />
          </Field>
        </div>
      </div>

      {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{fehler}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={() => void speichern()} disabled={speichert}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}

// ---------- Termine für Interessenten freigeben ----------

function PortalZeitenKarte({ objekt, kollegen, wer }: { objekt: Objekt; kollegen: Kollege[]; wer: string }) {
  const [zeiten, setZeiten] = useState<BesichtigungsZeit[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [offen, setOffen] = useState(false)

  const laden = useCallback(async () => {
    setLaedt(true)
    try {
      setZeiten(await ladeBesichtigungsZeiten(objekt.id))
      setFehler('')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die freigegebenen Termine konnten nicht geladen werden.')
    } finally {
      setLaedt(false)
    }
  }, [objekt.id])

  useEffect(() => {
    void laden()
  }, [laden])

  const kommend = useMemo(() => zeiten.filter((z) => new Date(z.ende).getTime() > Date.now()), [zeiten])
  const vergangen = zeiten.length - kommend.length

  async function absagen(z: BesichtigungsZeit) {
    const text =
      z.gebucht.length > 0
        ? `Diese Zeit ist schon gebucht (${z.gebucht.map((g) => g.interessent).join(', ')}). Sie wird im Portal nicht mehr angeboten, die Buchung bleibt aber bestehen — bitte die Besichtigung unten selbst absagen oder verschieben.\n\nTrotzdem nicht mehr anbieten?`
        : `${tagKurz(z.beginn)}, ${uhr(z.beginn)} Uhr nicht mehr anbieten?`
    if (!window.confirm(text)) return
    try {
      if (z.gebucht.length === 0) await loescheBesichtigungsZeit(z.id)
      else await sageBesichtigungsZeitAb(z.id)
      setHinweis('Die Zeit wird im Portal nicht mehr angeboten.')
      await laden()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CalendarClock size={16} className="text-slate-400" /> Termine für Interessenten freigeben
          </h3>
          <p className="mt-1 max-w-xl text-xs text-slate-500">
            Interessenten mit Zugang zum Interessenten-Portal sehen diese Zeiten nach ihrer Zustimmung und buchen selbst. Die Besichtigung erscheint dann unten,
            der Termin steht im Kalender des Maklers und er bekommt eine Telegram-Nachricht. Ist der Makler zu einer Zeit anderweitig belegt, wird sie im Portal nicht angezeigt.
          </p>
        </div>
        <SecondaryButton onClick={() => setOffen(true)}>
          <Plus size={14} /> Termine freigeben
        </SecondaryButton>
      </div>
      {hinweis && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{hinweis}</p>}
      {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{fehler}</p>}
      {laedt && zeiten.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Lädt …</p>
      ) : kommend.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Zurzeit sind keine Termine freigegeben. Interessenten können im Portal nur um einen Rückruf bitten.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {kommend.map((z) => {
            const voll = z.gebucht.length >= z.plaetze
            const stand =
              z.status === 'abgesagt'
                ? { label: 'Nicht mehr angeboten', farbe: 'bg-slate-100 text-slate-500' }
                : voll
                  ? { label: z.plaetze > 1 ? `Voll (${z.gebucht.length}/${z.plaetze})` : 'Gebucht', farbe: 'bg-sky-100 text-sky-700' }
                  : z.gebucht.length > 0
                    ? { label: `${z.gebucht.length} von ${z.plaetze} gebucht`, farbe: 'bg-amber-100 text-amber-700' }
                    : { label: z.plaetze > 1 ? `Frei (${z.plaetze} Plätze)` : 'Frei', farbe: 'bg-emerald-100 text-emerald-700' }
            return (
              <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-slate-800">
                    {tagKurz(z.beginn)}, {uhr(z.beginn)}–{uhr(z.ende)} Uhr
                  </span>
                  <span className="ml-2">
                    <StatusBadge label={stand.label} color={stand.farbe} />
                  </span>
                  <div className="text-xs text-slate-500">
                    {[z.makler && `Makler: ${z.makler}`, z.treffpunkt && `Treffpunkt: ${z.treffpunkt}`, z.gebucht.length > 0 && `Gebucht von: ${z.gebucht.map((g) => g.interessent).join(', ')}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {z.status === 'offen' && (
                  <button onClick={() => void absagen(z)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Nicht mehr anbieten">
                    <X size={14} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {vergangen > 0 && <p className="mt-2 text-xs text-slate-400">{vergangen === 1 ? '1 vergangene Zeit ausgeblendet.' : `${vergangen} vergangene Zeiten ausgeblendet.`}</p>}
      {offen && (
        <ZeitenFreigeben
          objekt={objekt}
          kollegen={kollegen}
          wer={wer}
          vorhanden={zeiten.filter((z) => z.status === 'offen').map((z) => z.beginn)}
          onClose={() => setOffen(false)}
          onGespeichert={async (anzahl) => {
            setOffen(false)
            setHinweis(anzahl === 1 ? '1 Termin freigegeben.' : `${anzahl} Termine freigegeben.`)
            await laden()
          }}
        />
      )}
    </Card>
  )
}

const WOCHENTAGE = [
  { nr: 1, kurz: 'Mo' },
  { nr: 2, kurz: 'Di' },
  { nr: 3, kurz: 'Mi' },
  { nr: 4, kurz: 'Do' },
  { nr: 5, kurz: 'Fr' },
  { nr: 6, kurz: 'Sa' },
  { nr: 7, kurz: 'So' },
]

function morgenDatum(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function ZeitenFreigeben({
  objekt,
  kollegen,
  wer,
  vorhanden,
  onClose,
  onGespeichert,
}: {
  objekt: Objekt
  kollegen: Kollege[]
  wer: string
  vorhanden: string[]
  onClose: () => void
  onGespeichert: (anzahl: number) => Promise<void>
}) {
  const [art, setArt] = useState<'serie' | 'einzeln'>('serie')
  const [makler, setMakler] = useState(objekt.verantwortlich || wer)
  const [treffpunkt, setTreffpunkt] = useState(objekt.adresse || '')
  const [plaetze, setPlaetze] = useState(1)
  const [dauer, setDauer] = useState(30)
  const [datum, setDatum] = useState(morgenDatum())
  const [uhrzeit, setUhrzeit] = useState('16:00')
  const [wochentage, setWochentage] = useState<number[]>([2])
  const [von, setVon] = useState('16:00')
  const [bis, setBis] = useState('18:00')
  const [wochen, setWochen] = useState(3)
  const [belegt, setBelegt] = useState<BelegtBlock[]>([])
  const [kalenderStand, setKalenderStand] = useState<'' | 'laedt' | 'ok' | 'unvollstaendig' | 'ohne'>('')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState('')

  const kandidaten: Zeitfenster[] = useMemo(() => {
    if (art === 'einzeln') {
      const z = einzelZeit(datum, uhrzeit, dauer)
      return z && new Date(z.beginn).getTime() > Date.now() ? [z] : []
    }
    return serienZeiten({ wochentage, von, bis, dauerMin: dauer, wochen }, new Date())
  }, [art, datum, uhrzeit, dauer, wochentage, von, bis, wochen])

  const maklerEmail = useMemo(() => kollegen.find((k) => k.name.trim().toLowerCase() === makler.trim().toLowerCase())?.email ?? '', [kollegen, makler])
  const bereich = useMemo(() => spanne(kandidaten), [kandidaten])

  // Kalender des Maklers für den Zeitraum laden (CRM-Termine und eigener Kalender).
  useEffect(() => {
    if (!bereich) return
    if (!maklerEmail) {
      setBelegt([])
      setKalenderStand('ohne')
      return
    }
    let aktuell = true
    setKalenderStand('laedt')
    const t = setTimeout(() => {
      ladeMaklerBelegt(maklerEmail, bereich.von, bereich.bis)
        .then((r) => {
          if (!aktuell) return
          setBelegt(r.belegt)
          setKalenderStand(r.unvollstaendig ? 'unvollstaendig' : 'ok')
        })
        .catch(() => {
          if (!aktuell) return
          setBelegt([])
          setKalenderStand('unvollstaendig')
        })
    }, 300)
    return () => {
      aktuell = false
      clearTimeout(t)
    }
  }, [maklerEmail, bereich?.von, bereich?.bis]) // eslint-disable-line react-hooks/exhaustive-deps

  const schonDa = useMemo(() => new Set(vorhanden.map((v) => new Date(v).getTime())), [vorhanden])
  const vorschau = useMemo(
    () =>
      kandidaten.map((z) => ({
        z,
        grund: schonDa.has(new Date(z.beginn).getTime()) ? 'schon freigegeben' : ueberschneidet(z, belegt) ? 'Kalender belegt' : '',
      })),
    [kandidaten, belegt, schonDa],
  )
  const neu = vorschau.filter((v) => !v.grund).map((v) => v.z)

  async function speichern() {
    if (!makler.trim()) return setFehler('Bitte den Makler angeben.')
    if (neu.length === 0) return setFehler('Es bleibt keine Zeit zum Freigeben übrig.')
    setSpeichert(true)
    setFehler('')
    try {
      await legeBesichtigungsZeitenAn(objekt.id, neu, { makler, treffpunkt, plaetze, von: wer })
      await onGespeichert(neu.length)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Speichern hat nicht geklappt.')
      setSpeichert(false)
    }
  }

  const knopf = (aktiv: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${aktiv ? 'bg-accent-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`

  return (
    <Modal
      open
      onClose={onClose}
      title="Termine für Interessenten freigeben"
      width="max-w-2xl"
      aktionen={
        <PrimaryButton onClick={() => void speichern()} disabled={speichert || neu.length === 0}>
          {speichert ? 'Speichert …' : neu.length === 1 ? '1 Termin freigeben' : `${neu.length} Termine freigeben`}
        </PrimaryButton>
      }
    >
      <div className="mb-3 flex gap-2">
        <button className={knopf(art === 'serie')} onClick={() => setArt('serie')}>
          Wiederkehrend
        </button>
        <button className={knopf(art === 'einzeln')} onClick={() => setArt('einzeln')}>
          Einzelner Termin
        </button>
      </div>

      {art === 'serie' ? (
        <div className="space-y-3">
          <Field label="Wochentage">
            <div className="flex flex-wrap gap-1.5">
              {WOCHENTAGE.map((w) => (
                <button
                  key={w.nr}
                  className={knopf(wochentage.includes(w.nr))}
                  onClick={() => setWochentage((x) => (x.includes(w.nr) ? x.filter((n) => n !== w.nr) : [...x, w.nr].sort()))}
                >
                  {w.kurz}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Von">
              <input type="time" className={inputClass} value={von} onChange={(e) => setVon(e.target.value)} />
            </Field>
            <Field label="Bis">
              <input type="time" className={inputClass} value={bis} onChange={(e) => setBis(e.target.value)} />
            </Field>
            <Field label="Takt / Dauer">
              <select className={inputClass} value={dauer} onChange={(e) => setDauer(Number(e.target.value))}>
                {ZEIT_DAUER_WAHL.map((d) => (
                  <option key={d} value={d}>
                    {d} Minuten
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Für die nächsten">
              <select className={inputClass} value={wochen} onChange={(e) => setWochen(Number(e.target.value))}>
                {[1, 2, 3, 4, 6, 8].map((w) => (
                  <option key={w} value={w}>
                    {w === 1 ? '1 Woche' : `${w} Wochen`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Datum">
            <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
          </Field>
          <Field label="Uhrzeit">
            <input type="time" className={inputClass} value={uhrzeit} onChange={(e) => setUhrzeit(e.target.value)} />
          </Field>
          <Field label="Dauer">
            <select className={inputClass} value={dauer} onChange={(e) => setDauer(Number(e.target.value))}>
              {ZEIT_DAUER_WAHL.map((d) => (
                <option key={d} value={d}>
                  {d} Minuten
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Makler">
          <input className={inputClass} list="portal-zeiten-team" value={makler} onChange={(e) => setMakler(e.target.value)} />
          <datalist id="portal-zeiten-team">
            {kollegen.map((k) => (
              <option key={k.email} value={k.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Treffpunkt">
          <input className={inputClass} value={treffpunkt} onChange={(e) => setTreffpunkt(e.target.value)} placeholder="z. B. vor dem Haus" />
        </Field>
        <Field label="Interessenten je Termin">
          <select className={inputClass} value={plaetze} onChange={(e) => setPlaetze(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 (Einzeltermin)' : `${n} (Sammeltermin)`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Vorschau</div>
        {kalenderStand === 'laedt' && <p className="text-xs text-slate-400">Kalender des Maklers wird geprüft …</p>}
        {kalenderStand === 'ohne' && <p className="text-xs text-amber-700">Zu „{makler}“ gibt es keinen Kalender im CRM — Überschneidungen werden nicht geprüft.</p>}
        {kalenderStand === 'unvollstaendig' && <p className="text-xs text-amber-700">Der Kalender ließ sich nicht vollständig lesen; das Portal prüft beim Anzeigen trotzdem noch einmal.</p>}
        {vorschau.length === 0 ? (
          <p className="text-sm text-slate-500">Mit diesen Angaben entsteht keine Zeit in der Zukunft.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto text-sm">
            {vorschau.map(({ z, grund }) => (
              <li key={z.beginn} className={`flex justify-between gap-2 py-0.5 ${grund ? 'text-slate-400' : 'text-slate-700'}`}>
                <span className={grund ? 'line-through' : ''}>
                  {tagKurz(z.beginn)}, {uhr(z.beginn)}–{uhr(z.ende)} Uhr
                </span>
                {grund && <span className="text-xs">{grund} – wird ausgelassen</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{fehler}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={() => void speichern()} disabled={speichert || neu.length === 0}>
          {speichert ? 'Speichert …' : neu.length === 1 ? '1 Termin freigeben' : `${neu.length} Termine freigeben`}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
