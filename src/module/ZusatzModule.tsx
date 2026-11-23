// Abschnitt „Zusatzmodule“ in „Profil & Einstellungen“ (23.11.2026): alle Zeilen aus crm_module mit
// Schalter. Nur die Geschäftsführung darf schalten (bei „Ansehen als …“ niemand); alle anderen sehen den Stand.
import { useState } from 'react'
import { Puzzle } from 'lucide-react'
import { Card } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { fmtDateTime } from '../lib/dates'
import { schalteModul, useModule } from './modulSchalter'

export function ZusatzModuleAbschnitt() {
  const { echterMitarbeiter, ansichtAls } = useAuth()
  const { liste, laedt, fehler } = useModule()
  const [arbeitet, setArbeitet] = useState<string | null>(null)
  const [meldung, setMeldung] = useState('')
  const darfSchalten = !ansichtAls && echterMitarbeiter?.rolle === 'geschaeftsfuehrung'

  async function umschalten(id: string, aktiv: boolean) {
    setMeldung('')
    setArbeitet(id)
    try {
      await schalteModul(id, aktiv, echterMitarbeiter?.name ?? 'Geschäftsführung')
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Das Umschalten hat nicht geklappt.')
    } finally {
      setArbeitet(null)
    }
  }

  return (
    <Card className="mt-5 p-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Puzzle size={14} /> Zusatzmodule
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        {darfSchalten
          ? 'Zusätzliche Funktionen, die sich für alle ein- und ausschalten lassen. Ausgeschaltete Module verschwinden aus der Oberfläche; gespeicherte Daten bleiben erhalten.'
          : 'Zusätzliche Funktionen, die die Geschäftsführung ein- und ausschalten kann. Hier siehst du den aktuellen Stand.'}
      </p>
      {laedt && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {fehler && <p className="text-sm text-rose-600">Die Zusatzmodule ließen sich nicht laden ({fehler}). Alle gelten so lange als ausgeschaltet.</p>}
      {!laedt && !fehler && liste.length === 0 && <p className="text-sm text-slate-400">Keine Zusatzmodule eingerichtet.</p>}
      {liste.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {liste.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700">{m.name}</div>
                <div className="text-xs text-slate-400">
                  {m.aktiv ? 'eingeschaltet' : 'ausgeschaltet'}
                  {m.geaendertAm ? ` · zuletzt geändert ${fmtDateTime(m.geaendertAm)}${m.geaendertVon ? ` von ${m.geaendertVon}` : ''}` : ''}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={m.aktiv}
                aria-label={`${m.name} ${m.aktiv ? 'ausschalten' : 'einschalten'}`}
                disabled={!darfSchalten || arbeitet !== null}
                onClick={() => umschalten(m.id, !m.aktiv)}
                title={darfSchalten ? (m.aktiv ? 'Ausschalten' : 'Einschalten') : 'Nur die Geschäftsführung kann das ändern'}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${m.aktiv ? 'bg-emerald-500' : 'bg-slate-300'} ${!darfSchalten ? 'opacity-60' : ''}`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${m.aktiv ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {meldung && <p className="mt-2 text-sm text-rose-600">{meldung}</p>}
    </Card>
  )
}
