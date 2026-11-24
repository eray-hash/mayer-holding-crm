import { Link, useLocation } from 'react-router-dom'
import { MessagesSquare } from 'lucide-react'
import { useAutomatikZugang } from '../pages/automatik/useAutomatikZugang'

// Eintrag „Automatische Nachrichten“ in der Seitenleiste jedes Bereichs — nur für Geschäftsführung, Admin und
// Superuser (dieselbe Regel wie die Seite selbst).
export function AutomatikSideLink({ collapsed }: { collapsed: boolean }) {
  const location = useLocation()
  const { zugang } = useAutomatikZugang()
  if (!zugang) return null
  const active = location.pathname === '/automatische-nachrichten'
  return (
    <Link
      to="/automatische-nachrichten"
      title={collapsed ? 'Automatische Nachrichten' : 'Alle Nachrichten, die das CRM von selbst verschickt'}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      <MessagesSquare size={17} />
      {!collapsed && <span>Automatische Nachrichten</span>}
    </Link>
  )
}
