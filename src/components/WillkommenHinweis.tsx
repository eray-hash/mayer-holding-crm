// Hinweis in der Akte zur automatischen Willkommensnachricht (20.11.2026): geplant (mit „Jetzt senden“ und
// „Nicht senden“), gesendet, wartet auf Adresse, abgebrochen oder Fehler. Ohne vorgemerkte Nachricht: nichts.
import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { brichWillkommenAb, ladeWillkommen, sendeWillkommenJetzt, willkommenText, type WillkommenNachricht } from '../lib/willkommen'

export function WillkommenHinweis({ kundeId, nutzerName, nurLesen = false }: { kundeId: string; nutzerName: string; nurLesen?: boolean }) {
  const [w, setW] = useState<WillkommenNachricht | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [meldung, setMeldung] = useState('')

  const laden = () => ladeWillkommen(kundeId).then(setW).catch(() => setW(null))
  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kundeId])

  if (!w) return null

  async function aktion(f: () => Promise<string | void>) {
    setLaeuft(true)
    setMeldung('')
    try {
      const m = await f()
      if (m) setMeldung(m)
      await laden()
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft(false)
    }
  }

  const farbe =
    w.status === 'fehler' ? 'bg-rose-50 text-rose-700' : w.status === 'geplant' ? 'bg-sky-50 text-sky-800' : w.status === 'gesendet' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'

  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${farbe}`}>
      <p className="flex items-start gap-2">
        <Mail size={15} className="mt-0.5 shrink-0" />
        <span>
          Willkommensnachricht{w.an ? ` an ${w.an}` : ''}: {willkommenText(w)}
          {w.status === 'geplant' && <span className="block text-xs opacity-80">Mit Link zum Hochladen von Unterlagen. Bis dahin lässt sie sich hier noch abbrechen.</span>}
          {w.status === 'ohne_adresse' && <span className="block text-xs opacity-80">Sobald in der Akte eine E-Mail-Adresse steht, wird sie eingeplant.</span>}
        </span>
      </p>
      {!nurLesen && (w.status === 'geplant' || w.status === 'ohne_adresse') && (
        <div className="mt-2 flex flex-wrap gap-3 pl-6 text-xs font-medium">
          {w.status === 'geplant' && (
            <button
              disabled={laeuft}
              onClick={() =>
                aktion(async () => {
                  const r = await sendeWillkommenJetzt(kundeId)
                  return r.gesendet > 0 ? 'Willkommensnachricht gesendet.' : r.meldungen[0] ?? 'Nicht gesendet.'
                })
              }
              className="hover:underline disabled:opacity-50"
            >
              {laeuft ? 'Sendet …' : 'Jetzt senden'}
            </button>
          )}
          <button disabled={laeuft} onClick={() => aktion(() => brichWillkommenAb(w.id, nutzerName))} className="hover:underline disabled:opacity-50">
            Nicht senden
          </button>
        </div>
      )}
      {meldung && <p className="mt-1 pl-6 text-xs">{meldung}</p>}
    </div>
  )
}
