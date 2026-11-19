import { useState } from 'react'
import { ShieldCheck, Mail, CheckCircle2, AlertTriangle } from 'lucide-react'
import { fordrePortalLinkAn, isEmailGatewayConfigured } from '../../lib/emailGateway'
import { inputClass } from '../../components/ui'

// Magic-Link-Login: kein Passwort, kein Demo-Zugänge-Dropdown mehr (das hätte mit echten
// Investoren-Daten jedem Website-Besucher Namen+E-Mail aller Investoren offengelegt — siehe
// Audit-Fund vom 2026-11-02). Zeigt nach dem Absenden bewusst immer dieselbe Bestätigung an, egal
// ob die E-Mail wirklich zu einem Investor gehört (keine Auskunft, wer Investor ist).
export function PortalLogin() {
  const [email, setEmail] = useState('')
  const [senden, setSenden] = useState(false)
  const [abgeschickt, setAbgeschickt] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const adresse = email.trim()
    if (!adresse) return
    setSenden(true)
    setError(null)
    try {
      // Der Server erzeugt den Link und verschickt ihn (19.11.2026) — der Browser bekommt das Zeichen nie zu sehen.
      await fordrePortalLinkAn(adresse)
      // Bewusst immer dieselbe Bestätigung, unabhängig davon, ob die Adresse zu einem Investor gehört.
      setAbgeschickt(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link konnte nicht verschickt werden.')
    } finally {
      setSenden(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400 text-slate-900">
            <ShieldCheck size={24} strokeWidth={2.5} />
          </div>
          <div className="text-base font-semibold tracking-wide text-white">ANDREAS MAYER HOLDING</div>
          <div className="text-sm text-slate-400">Investoren-Portal · Investitionsfonds 2026</div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          {abgeschickt ? (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <p className="text-sm font-medium text-slate-800">Link verschickt</p>
              <p className="text-xs text-slate-500">
                Falls diese E-Mail-Adresse bei uns als Investor hinterlegt ist, haben wir Ihnen gerade einen Anmelde-Link
                geschickt. Bitte prüfen Sie Ihr Postfach (ggf. auch den Spam-Ordner).
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="mb-4 block">
                <span className="mb-1 block text-xs font-medium text-slate-500">E-Mail-Adresse</span>
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@beispiel.de"
                  className={inputClass}
                />
              </label>
              {error && <p className="mb-3 text-xs text-rose-600">{error}</p>}
              {!isEmailGatewayConfigured && (
                <div className="mb-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> Mailversand ist noch nicht konfiguriert.
                </div>
              )}
              <button
                type="submit"
                disabled={senden || !email.trim() || !isEmailGatewayConfigured}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
              >
                <Mail size={15} /> {senden ? 'Wird verschickt …' : 'Anmelde-Link zuschicken'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Zielrendite, keine Garantie. Keine Anlageberatung. Investitionen sind mit Risiken bis zum vollständigen
          Kapitalverlust verbunden.
        </p>
      </div>
    </div>
  )
}
