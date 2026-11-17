import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus, Search, Trash2, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from '../../components/ui'
import { useFragenRechte } from '../../components/ObjektFragenSection'
import { EmpfaengerFelder, EmpfaengerName, VereinbarungMarke, VereinbarungWahl, angabenText, empfaengerAus, neuesteZuerst, type Vereinbarung } from '../../components/ObjektWeitergabenSection'
import { fmtDate, today, uid } from '../../lib/dates'
import type { Kunde, Objekt, Weitergabe } from '../../types'

/** Alle Weitergaben auf einen Blick — wer hat welche Objekte wann bekommen, und mit welcher Vereinbarung.
 *  Die Einträge entstehen in der Objektliste („Liste zum Weitergeben" mit Empfänger); was früher oder auf
 *  anderem Weg herausging, lässt sich hier von Hand nachtragen. Löschen dürfen nur Geschäftsführung und Admins. */
export function Weitergaben() {
  const { state, dispatch } = useApp()
  const { wer, darfAntworten: darfLoeschen } = useFragenRechte()
  const [suche, setSuche] = useState('')
  const [offen, setOffen] = useState<string | null>(null)
  const [neu, setNeu] = useState(false)

  const objektNachId = useMemo(() => new Map(state.objekte.map((o) => [o.id, o])), [state.objekte])

  const zeilen = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    return neuesteZuerst(state.weitergaben).filter((w) => {
      if (!begriff) return true
      const namen = w.objektIds.flatMap((id) => [w.bezeichnungen[id] ?? '', objektNachId.get(id)?.bezeichnung ?? ''])
      return [w.an, w.notiz ?? '', ...namen].join(' ').toLowerCase().includes(begriff)
    })
  }, [state.weitergaben, objektNachId, suche])

  function loeschen(w: Weitergabe) {
    if (!window.confirm(`Weitergabe an „${w.an}“ vom ${fmtDate(w.datum)} löschen?\n\nDamit geht der Nachweis verloren. Das lässt sich nicht rückgängig machen.`)) return
    dispatch({ type: 'LOESCHE_WEITERGABE', id: w.id })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Weitergaben</h1>
          <p className="text-sm text-slate-500">
            {state.weitergaben.length} {state.weitergaben.length === 1 ? 'Weitergabe' : 'Weitergaben'} · wer hat welches Objekt wann bekommen
          </p>
        </div>
        <PrimaryButton onClick={() => setNeu(true)}>
          <Plus size={15} /> Weitergabe nachtragen
        </PrimaryButton>
      </div>

      <Card className="mb-4 p-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Empfänger, Objekt, Notiz …" aria-label="Weitergaben durchsuchen" />
        </div>
      </Card>

      {zeilen.length === 0 ? (
        <EmptyState
          text={
            state.weitergaben.length === 0
              ? 'Noch keine Weitergabe festgehalten. Sie entsteht, wenn du in der Objektliste eine Liste mit Empfänger kopierst oder druckst.'
              : 'Keine Weitergabe passt zu dieser Suche.'
          }
        />
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {zeilen.map((w) => {
            const auf = offen === w.id
            const mitBezeichnung = w.angaben.includes('Bezeichnung')
            return (
              <div key={w.id}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="break-words text-sm">
                      <EmpfaengerName weitergabe={w} />
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(w.datum)} · von {w.von || 'unbekannt'}
                      {w.weg ? ` · ${w.weg}` : ''}
                    </div>
                  </div>
                  <VereinbarungMarke wert={w.vereinbarung} />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOffen(auf ? null : w.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                      aria-expanded={auf}
                    >
                      {w.objektIds.length} {w.objektIds.length === 1 ? 'Objekt' : 'Objekte'}
                      <ChevronDown size={13} className={auf ? 'rotate-180' : ''} />
                    </button>
                    {darfLoeschen && (
                      <button
                        onClick={() => loeschen(w)}
                        className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Weitergabe löschen"
                        aria-label={`Weitergabe an ${w.an} löschen`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {auf && (
                  <div className="bg-slate-50 px-4 py-3">
                    <ul className="space-y-1">
                      {w.objektIds.map((id) => {
                        const objekt = objektNachId.get(id)
                        const gezeigtAls = w.bezeichnungen[id]?.trim()
                        return (
                          <li key={id} className="break-words text-sm">
                            {objekt ? (
                              <Link to={`/immobilien/objekte/${objekt.id}`} className="font-medium text-accent-600 hover:underline">
                                {objekt.bezeichnung}
                              </Link>
                            ) : (
                              <>
                                <span className="font-medium text-slate-700">{gezeigtAls || 'Objekt ohne Bezeichnung'}</span>
                                <span className="text-xs text-slate-400"> · nicht mehr im Bestand</span>
                              </>
                            )}
                            {objekt && mitBezeichnung && gezeigtAls && gezeigtAls !== objekt.bezeichnung && <span className="text-xs text-slate-500"> · gezeigt als „{gezeigtAls}“</span>}
                          </li>
                        )
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-slate-500">{angabenText(w)}</p>
                    {w.notiz?.trim() && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700">{w.notiz}</p>}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <Modal open={neu} onClose={() => setNeu(false)} title="Weitergabe nachtragen" width="max-w-2xl">
        {neu && (
          <Nachtragen
            kontakte={state.immobilienKunden}
            objekte={state.objekte}
            von={wer}
            onAbbrechen={() => setNeu(false)}
            onSpeichern={(weitergabe) => {
              dispatch({ type: 'SPEICHERE_WEITERGABE', weitergabe })
              setNeu(false)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

/** Eine frühere Weitergabe von Hand festhalten — etwa eine Liste, die per E-Mail oder im Gespräch herausging,
 *  bevor es den Nachweis gab. Welche Angaben damals mitgingen, bleibt offen; die Notiz ist dafür da. */
function Nachtragen({
  kontakte,
  objekte,
  von,
  onSpeichern,
  onAbbrechen,
}: {
  kontakte: Kunde[]
  objekte: Objekt[]
  von: string
  onSpeichern: (weitergabe: Weitergabe) => void
  onAbbrechen: () => void
}) {
  const [datum, setDatum] = useState(today())
  const [kontaktId, setKontaktId] = useState('')
  const [name, setName] = useState('')
  const [gewaehlt, setGewaehlt] = useState<string[]>([])
  const [objektSuche, setObjektSuche] = useState('')
  const [vereinbarung, setVereinbarung] = useState<Vereinbarung>('keine')
  const [weg, setWeg] = useState('')
  const [notiz, setNotiz] = useState('')

  const empfaenger = empfaengerAus(kontakte, kontaktId, name)
  const sortiert = useMemo(() => [...objekte].sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de')), [objekte])
  const begriff = objektSuche.trim().toLowerCase()
  const sichtbar = begriff ? sortiert.filter((o) => `${o.bezeichnung} ${o.adresse} ${o.typ}`.toLowerCase().includes(begriff)) : sortiert
  const gewaehlteObjekte = gewaehlt.map((id) => objekte.find((o) => o.id === id)).filter((o): o is Objekt => !!o)
  const fehlt = !datum ? 'Bitte das Datum eintragen.' : !empfaenger ? 'Bitte einen Empfänger wählen oder einen Namen eintragen.' : gewaehlteObjekte.length === 0 ? 'Bitte mindestens ein Objekt ankreuzen.' : ''

  function umschalten(id: string) {
    setGewaehlt((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : [...alt, id]))
  }

  function speichern() {
    if (!empfaenger || !datum || gewaehlteObjekte.length === 0) return
    onSpeichern({
      id: uid('wg'),
      datum,
      an: empfaenger.an,
      kontaktId: empfaenger.kontaktId,
      objektIds: gewaehlteObjekte.map((o) => o.id),
      bezeichnungen: Object.fromEntries(gewaehlteObjekte.map((o) => [o.id, o.bezeichnung])),
      angaben: [],
      weg: weg.trim() || 'nachgetragen',
      vereinbarung,
      notiz: notiz.trim() || undefined,
      von,
    })
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Datum der Weitergabe">
          <input type="date" className={inputClass} value={datum} max={today()} onChange={(e) => setDatum(e.target.value)} />
        </Field>
        <Field label="Auf welchem Weg?">
          <input className={inputClass} value={weg} onChange={(e) => setWeg(e.target.value)} placeholder="z. B. per E-Mail, im Gespräch, per Post" />
        </Field>
        <EmpfaengerFelder kontakte={kontakte} kontaktId={kontaktId} name={name} onKontakt={setKontaktId} onName={setName} />
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-slate-500">
          Welche Objekte? {gewaehlteObjekte.length > 0 ? `(${gewaehlteObjekte.length} gewählt)` : ''}
        </span>
        {gewaehlteObjekte.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {gewaehlteObjekte.map((o) => (
              <span key={o.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent-300 bg-accent-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-accent-700">
                <span className="truncate">{o.bezeichnung}</span>
                <button type="button" onClick={() => umschalten(o.id)} className="rounded-full p-0.5 hover:bg-accent-100" aria-label={`${o.bezeichnung} aus der Auswahl nehmen`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative mb-2">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={objektSuche} onChange={(e) => setObjektSuche(e.target.value)} placeholder="Objekt suchen (Bezeichnung, Ort, Objektart) …" aria-label="Objekte durchsuchen" />
        </div>
        <div className="max-h-52 overflow-auto rounded-lg border border-slate-200">
          {sichtbar.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-400">{objekte.length === 0 ? 'Es ist noch kein Objekt angelegt.' : 'Kein Objekt passt zu dieser Suche.'}</p>
          ) : (
            sichtbar.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-start gap-2 border-b border-slate-50 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5" checked={gewaehlt.includes(o.id)} onChange={() => umschalten(o.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium text-slate-700">{o.bezeichnung}</span>
                  <span className="block break-words text-xs text-slate-400">{[o.typ, o.adresse].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            ))
          )}
        </div>
      </div>

      <VereinbarungWahl wert={vereinbarung} onChange={setVereinbarung} />
      <Field label="Notiz (freiwillig)">
        <textarea className={`${inputClass} min-h-20`} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. welche Angaben mitgingen, wo die unterschriebene Vereinbarung liegt" />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-amber-600">{fehlt}</p>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={onAbbrechen}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={speichern} disabled={fehlt !== ''}>
            Festhalten
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
