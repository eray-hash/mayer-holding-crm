import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { consumeMagicLink } from '../../lib/portalAuthDb'
import { usePortalAuth } from '../../context/PortalAuthContext'

// Zielseite des per E-Mail verschickten Anmelde-Links (siehe PortalLogin.tsx) — löst den
// Einmal-Token server-seitig ein und wandelt ihn in eine länger laufende Session um.
export function PortalMagicLink() {
  const { token } = useParams<{ token: string }>()
  const { login } = usePortalAuth()
  const navigate = useNavigate()
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    if (!token) {
      setFehler(true)
      return
    }
    let cancelled = false
    consumeMagicLink(token)
      .then((ergebnis) => {
        if (cancelled) return
        if (ergebnis.status === 'ok') {
          login(ergebnis.token, ergebnis.investor)
          navigate('/portal', { replace: true })
        } else {
          setFehler(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFehler(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        {fehler ? (
          <>
            <ShieldAlert size={28} className="mx-auto mb-2 text-rose-500" />
            <p className="mb-1 text-sm font-medium text-slate-800">Link ungültig oder abgelaufen</p>
            <p className="mb-4 text-xs text-slate-500">Anmelde-Links sind nur 15 Minuten gültig und nur einmal einlösbar.</p>
            <button
              onClick={() => navigate('/portal/login', { replace: true })}
              className="text-sm font-medium text-accent-600 hover:underline"
            >
              Neuen Link anfordern
            </button>
          </>
        ) : (
          <>
            <Loader2 size={28} className="mx-auto mb-2 animate-spin text-accent-600" />
            <p className="text-sm text-slate-500">Anmeldung wird geprüft …</p>
          </>
        )}
      </div>
    </div>
  )
}
