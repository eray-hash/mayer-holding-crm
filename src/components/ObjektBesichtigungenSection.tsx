// Reiter „Besichtigungen" der Objektakte: Termine mit Interessenten, Rückmeldung, Interesse und
// Kaufpreisangebote (21.11.2026). Daten: Tabelle `besichtigungen` (lib/besichtigungen.ts). Jede
// wichtige Änderung steht zusätzlich im Verlauf des Objekts und, falls verknüpft, des Kontakts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarCheck, CalendarPlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import { kundeDetailPfad } from '../data/kundenBereiche'
import { fmtEUR, today, uid } from '../lib/dates'
import { ladeKollegen } from '../lib/kalenderDb'
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
  const [team, setTeam] = useState<string[]>([])

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
      .then((k) => setTeam(k.map((x) => x.name)))
      .catch(() => setTeam([]))
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
