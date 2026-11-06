import { useMemo, useState } from 'react'
import { Phone, Search } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Modal, Field, inputClass, SecondaryButton } from './ui'
import { CallRecorder } from './CallRecorder'
import { suggestKundeByTelefon, suggestKundeKandidaten, type KundeMatch } from '../lib/matchKunde'
import { today, uid } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'

// Globaler "Gespräch aufzeichnen"-Button (in der Topbar, unabhängig von der gerade geöffneten
// Kundenakte) — löst den Kunden anhand der eingegebenen Telefonnummer oder des Namens auf,
// bevor der eigentliche Rekorder (siehe CallRecorder.tsx) angezeigt wird.
export function GespraechAufzeichnenGlobal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const [suche, setSuche] = useState('')
  const [ausgewaehlt, setAusgewaehlt] = useState<KundeMatch | null>(null)

  const kandidaten = useMemo<KundeMatch[]>(() => {
    const text = suche.trim()
    if (!text) return []
    const perTelefon = suggestKundeByTelefon(state, text)
    if (perTelefon.length > 0) return perTelefon
    return suggestKundeKandidaten(state, text)
  }, [state, suche])

  function schliessen() {
    setSuche('')
    setAusgewaehlt(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={schliessen} title="Gespräch aufzeichnen" width="max-w-2xl">
      {!ausgewaehlt ? (
        <div>
          <Field label="Telefonnummer oder Name des Kunden">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputClass} pl-9`}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="z.B. 0731 123456 oder Mustermann"
                autoFocus
              />
            </div>
          </Field>
          {suche.trim() && (
            <div className="mt-2 space-y-1.5">
              {kandidaten.length === 0 && <p className="px-1 text-sm text-slate-400">Kein Kunde gefunden.</p>}
              {kandidaten.map((k) => (
                <button
                  key={`${k.bereich}-${k.kundeId}`}
                  onClick={() => setAusgewaehlt(k)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-accent-300 hover:bg-accent-50"
                >
                  <Phone size={14} className="flex-shrink-0 text-slate-400" />
                  <span className="text-slate-700">{k.kundeName}</span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <SecondaryButton onClick={schliessen}>Abbrechen</SecondaryButton>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-between rounded-lg bg-slate-50 p-3">
            <span className="text-sm font-medium text-slate-700">{ausgewaehlt.kundeName}</span>
            <button onClick={() => setAusgewaehlt(null)} className="text-xs text-accent-600 hover:underline">
              anderen Kunden wählen
            </button>
          </div>
          <CallRecorder
            onCancel={schliessen}
            onSave={({ transcript, summary, dauerSekunden }) => {
              dispatch({
                type: 'ADD_PROTOKOLL',
                protokoll: {
                  id: uid('p'),
                  bereich: ausgewaehlt.bereich,
                  kundeId: ausgewaehlt.kundeId,
                  datum: today(),
                  teilnehmer: `${ausgewaehlt.kundeName}, ${CURRENT_USER}`,
                  betreff: summary ? 'Telefonat (KI-zusammengefasst)' : 'Telefonat (automatisch transkribiert)',
                  text: transcript,
                  kernthemen: summary?.kernthemen,
                  vereinbarungen: summary?.vereinbarungen,
                  offenePunkte: summary?.offene_punkte,
                  stimmung: summary?.stimmung,
                  kiZusammenfassung: summary?.zusammenfassung,
                  dauerSekunden,
                },
              })
              schliessen()
            }}
          />
        </div>
      )}
    </Modal>
  )
}
