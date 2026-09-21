import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, LogIn } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { usePortalAuth } from '../../context/PortalAuthContext'
import { inputClass } from '../../components/ui'

export function PortalLogin() {
  const { state } = useApp()
  const { login } = usePortalAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const investor = state.fondsInvestoren.find((i) => i.email.toLowerCase() === email.trim().toLowerCase())
    if (!investor) {
      setError('Kein Zugang mit dieser E-Mail-Adresse gefunden.')
      return
    }
    login(investor.id)
    navigate('/portal')
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

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-xl">
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
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
          >
            <LogIn size={15} /> Anmelden
          </button>

          <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <div className="mb-1.5 font-medium text-slate-600">Demo-Zugänge (Klick zum Übernehmen):</div>
            <div className="flex flex-col gap-1">
              {state.fondsInvestoren.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setEmail(i.email)}
                  className="truncate text-left text-accent-700 underline hover:text-accent-900"
                >
                  {i.name} — {i.email}
                </button>
              ))}
            </div>
          </div>
        </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-500">
          Zielrendite, keine Garantie. Keine Anlageberatung. Investitionen sind mit Risiken bis zum vollständigen
          Kapitalverlust verbunden.
        </p>
      </div>
    </div>
  )
}
