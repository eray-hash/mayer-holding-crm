import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, EmptyState, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from './ui'
import { GesuchFormular } from './GesuchFormular'
import { budgetText, eckdatenTexte, passendeObjekte } from '../lib/gesuche'
import { bonitaetKurztext } from '../lib/bonitaet'
import { fmtDate, fmtEUR, today } from '../lib/dates'
import type { Gesuch, ImmoAuftragsart, ImmoRolle, ImmoStammdaten, Kunde } from '../types'

export const IMMO_ROLLEN: { id: ImmoRolle; label: string }[] = [
  { id: 'vermittler', label: 'Vermittler' },
  { id: 'eigentuemer', label: 'Eigentümer' },
  { id: 'makler', label: 'Makler' },
  { id: 'empfehler', label: 'Empfehler' },
]

export const IMMO_AUFTRAGSARTEN: { id: ImmoAuftragsart; label: string }[] = [
  { id: 'alleinauftrag', label: 'Alleinauftrag' },
  { id: 'qualifizierter_alleinauftrag', label: 'Qualifizierter Alleinauftrag' },
  { id: 'einfacher_maklerauftrag', label: 'Einfacher Maklerauftrag' },
  { id: 'vermittlungsauftrag', label: 'Vermittlungsauftrag' },
]

const LEER: ImmoStammdaten = { rollen: [], bietetAn: '', sonstiges: '' }

/** Das Stammdatenblatt der Immobilienabteilung als Reiter in der Akte eines Kontakts: wer ist die Person,
 *  in welcher Rolle, mit welchem Auftrag — was sucht sie (Gesuche, mit Abgleich gegen den Objektbestand),
 *  was bietet sie an. Vorlage: Papierformular „Stammdaten", Version 1 vom 21.10.26. */
export function ImmoStammdatenblatt({ kunde }: { kunde: Kunde }) {
  const { state, dispatch } = useApp()
  const [entwurf, setEntwurf] = useState<ImmoStammdaten>(kunde.immoStammdaten ?? LEER)
  const [gespeichert, setGespeichert] = useState(false)
  const [gesuchOffen, setGesuchOffen] = useState<Gesuch | 'neu' | null>(null)

  const gesuche = kunde.gesuche ?? []
  const geaendert = JSON.stringify(entwurf) !== JSON.stringify(kunde.immoStammdaten ?? LEER)

  function setze<K extends keyof ImmoStammdaten>(feld: K, wert: ImmoStammdaten[K]) {
    setEntwurf((e) => ({ ...e, [feld]: wert }))
    setGespeichert(false)
  }

  function aendereKunde(patch: Partial<Kunde>) {
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: kunde.id, patch: { ...patch, letzteAktivitaet: today() } })
  }

  function speichern() {
    aendereKunde({ immoStammdaten: entwurf })
    setGespeichert(true)
  }

  function speichereGesuch(g: Gesuch) {
    aendereKunde({ gesuche: gesuche.some((x) => x.id === g.id) ? gesuche.map((x) => (x.id === g.id ? g : x)) : [g, ...gesuche] })
    setGesuchOffen(null)
  }

  function loescheGesuch(g: Gesuch) {
    if (!window.confirm(`Gesuch „${g.titel}" löschen?`)) return
    aendereKunde({ gesuche: gesuche.filter((x) => x.id !== g.id) })
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Stammdaten</h3>
            <p className="text-xs text-slate-400">Name, Telefon und E-Mail stehen im Reiter „Übersicht".</p>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Priorität">
            <span className="mr-1 text-xs font-medium text-slate-500">Prio</span>
            {(['A', 'B', 'C'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setze('prio', entwurf.prio === p ? undefined : p)}
                className={`h-8 w-8 rounded-lg border text-sm font-semibold ${entwurf.prio === p ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}
                aria-pressed={entwurf.prio === p}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {IMMO_ROLLEN.map((r) => {
            const an = entwurf.rollen.includes(r.id)
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setze('rollen', an ? entwurf.rollen.filter((x) => x !== r.id) : [...entwurf.rollen, r.id])}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                aria-pressed={an}
              >
                {r.label}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Auftragsart">
            <select className={inputClass} value={entwurf.auftragsart ?? ''} onChange={(e) => setze('auftragsart', (e.target.value || undefined) as ImmoAuftragsart | undefined)}>
              <option value="">kein Auftrag</option>
              {IMMO_AUFTRAGSARTEN.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Startdatum">
            <input type="date" className={inputClass} value={entwurf.startdatum ?? ''} onChange={(e) => setze('startdatum', e.target.value || undefined)} />
          </Field>
          <Field label="Position">
            <input className={inputClass} value={entwurf.position ?? ''} onChange={(e) => setze('position', e.target.value)} placeholder="z. B. Geschäftsführer, Eigentümer" />
          </Field>
          <Field label="Adresse">
            <input className={inputClass} value={entwurf.adresse ?? ''} onChange={(e) => setze('adresse', e.target.value)} />
          </Field>
          <Field label="Telefon Büro">
            <input className={inputClass} value={entwurf.telefonBuero ?? ''} onChange={(e) => setze('telefonBuero', e.target.value)} />
          </Field>
          <Field label="Direkte E-Mail">
            <input className={inputClass} value={entwurf.emailDirekt ?? ''} onChange={(e) => setze('emailDirekt', e.target.value)} />
          </Field>
          <Field label="Internetseite">
            <input className={inputClass} value={entwurf.webseite ?? ''} onChange={(e) => setze('webseite', e.target.value)} />
          </Field>
          <Field label="Bonität">
            <input className={inputClass} value={entwurf.bonitaet ?? ''} onChange={(e) => setze('bonitaet', e.target.value)} />
            {/* Nur auf Klick in den Entwurf übernehmen — gespeichert wird erst mit „Stammdatenblatt speichern". */}
            {kunde.bonitaet && (entwurf.bonitaet ?? '') !== bonitaetKurztext(kunde.bonitaet) && (
              <button type="button" onClick={() => setze('bonitaet', bonitaetKurztext(kunde.bonitaet!))} className="mt-1 text-xs font-medium text-accent-600 hover:underline">
                aus der Bonitätseinschätzung übernehmen
              </button>
            )}
          </Field>
          <Field label="Bearbeiter">
            <input className={inputClass} value={entwurf.bearbeiter ?? ''} onChange={(e) => setze('bearbeiter', e.target.value)} placeholder={kunde.verantwortlich} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
          <Field label="Bietet an (angebotene Objekte)">
            <textarea className={`${inputClass} min-h-28`} value={entwurf.bietetAn} onChange={(e) => setze('bietetAn', e.target.value)} />
          </Field>
          <Field label="Sonstiges">
            <textarea className={`${inputClass} min-h-28`} value={entwurf.sonstiges} onChange={(e) => setze('sonstiges', e.target.value)} />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3">
          {gespeichert && !geaendert && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={13} /> Gespeichert
            </span>
          )}
          <PrimaryButton onClick={speichern} disabled={!geaendert}>
            Stammdatenblatt speichern
          </PrimaryButton>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <Search size={14} /> Sucht (Gesuche)
            </h3>
            <p className="text-xs text-slate-400">Jedes Gesuch wird automatisch mit dem Objektbestand abgeglichen.</p>
          </div>
          <SecondaryButton onClick={() => setGesuchOffen('neu')}>
            <Plus size={14} /> Gesuch
          </SecondaryButton>
        </div>

        {gesuche.length === 0 && <EmptyState text="Noch kein Gesuch erfasst." />}
        <div className="space-y-3">
          {gesuche.map((g) => {
            const treffer = passendeObjekte(g, state.objekte)
            return (
              <div key={g.id} className={`rounded-lg border border-slate-100 p-3 ${g.erledigt ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800">
                      {g.titel} {g.erledigt && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">erledigt</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[g.objekttypen.join(', ') || 'Objektart egal', g.lage || 'Lage egal', budgetText(g), ...eckdatenTexte(g), g.nutzung !== 'Unklar' ? g.nutzung : '']
                        .filter((x) => x && x !== '–')
                        .join(' · ')}
                      <span className="text-slate-400"> · erfasst {fmtDate(g.erstelltAm)}</span>
                    </div>
                    {g.notizen && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{g.notizen}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => speichereGesuch({ ...g, erledigt: !g.erledigt })}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      {g.erledigt ? 'wieder aktiv' : 'erledigt'}
                    </button>
                    <button onClick={() => setGesuchOffen(g)} className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600" title="Gesuch bearbeiten" aria-label={`${g.titel} bearbeiten`}>
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => loescheGesuch(g)} className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Gesuch löschen" aria-label={`${g.titel} löschen`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {!g.erledigt && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <div className="mb-1 text-xs font-medium text-slate-500">
                      {treffer.length === 0
                        ? 'Zurzeit kein passendes Objekt im Bestand.'
                        : `${treffer.filter((t) => t.offen.length === 0).length} passend, ${treffer.filter((t) => t.offen.length > 0).length} zu prüfen (dort fehlt beim Objekt eine Angabe):`}
                    </div>
                    <ul className="space-y-1">
                      {treffer.map((t) => (
                        <li key={t.objekt.id} className="text-sm">
                          <Link to={`/immobilien/objekte/${t.objekt.id}`} className="font-medium text-accent-600 hover:underline">
                            {t.objekt.bezeichnung}
                          </Link>
                          <span className="text-xs text-slate-500">
                            {' '}
                            · {t.objekt.typ}
                            {t.objekt.kaufpreis > 0 ? ` · ${fmtEUR(t.objekt.kaufpreis)}` : ''} · {t.passt.join(', ')}
                          </span>
                          {t.offen.length > 0 && <span className="text-xs text-amber-600"> · {t.offen.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <Modal open={gesuchOffen !== null} onClose={() => setGesuchOffen(null)} title={gesuchOffen === 'neu' ? 'Neues Gesuch' : 'Gesuch bearbeiten'}>
        {gesuchOffen !== null && (
          <GesuchFormular key={gesuchOffen === 'neu' ? 'neu' : gesuchOffen.id} gesuch={gesuchOffen === 'neu' ? undefined : gesuchOffen} onSpeichern={speichereGesuch} onAbbrechen={() => setGesuchOffen(null)} />
        )}
      </Modal>
    </div>
  )
}
