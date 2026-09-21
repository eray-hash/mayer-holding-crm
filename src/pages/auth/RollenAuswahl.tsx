import { useNavigate } from 'react-router-dom'
import { Briefcase, Users, UserCircle } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import type { Rolle } from '../../context/AppContext'

export function RollenAuswahl() {
  const { dispatch } = useApp()
  const navigate = useNavigate()

  function waehlen(rolle: Rolle) {
    dispatch({ type: 'SET_ROLLE', rolle })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-slate-800">Mayer Holding CRM</h1>
          <p className="mt-1 text-sm text-slate-500">Wer meldet sich an?</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <button
            onClick={() => waehlen('geschaeftsfuehrung')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition hover:border-accent-300 hover:shadow"
          >
            <Briefcase size={32} className="text-accent-600" />
            <span className="text-sm font-semibold text-slate-800">Geschäftsführung</span>
            <span className="text-xs text-slate-500">Voller Zugriff auf alle Bereiche</span>
          </button>
          <button
            onClick={() => waehlen('mitarbeiter')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition hover:border-accent-300 hover:shadow"
          >
            <Users size={32} className="text-accent-600" />
            <span className="text-sm font-semibold text-slate-800">Mitarbeiter</span>
            <span className="text-xs text-slate-500">Zugriff auf zugewiesene Bereiche</span>
          </button>
          <button
            onClick={() => navigate('/portal/login')}
            className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm transition hover:border-accent-300 hover:shadow"
          >
            <UserCircle size={32} className="text-accent-600" />
            <span className="text-sm font-semibold text-slate-800">Kunde</span>
            <span className="text-xs text-slate-500">Zum Kundenportal</span>
          </button>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Vereinfachte Auswahl für die Demo-Phase — löst später den echten Mitarbeiter-Login ab, sobald alle
          Zugänge angelegt sind.
        </p>
      </div>
    </div>
  )
}
