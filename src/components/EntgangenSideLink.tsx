import { Link, useLocation } from 'react-router-dom'
import { UserX } from 'lucide-react'

// Eintrag „Entgangene Klienten“ in der Seitenleiste jedes Bereichs (24.11.2026). Für alle: Die Seite zeigt
// ohnehin nur die Akten der freigegebenen Bereiche (Geschäftsführung und Admins sehen alles).
export function EntgangenSideLink({ collapsed }: { collapsed: boolean }) {
  const location = useLocation()
  const active = location.pathname === '/entgangen'
  return (
    <Link
      to="/entgangen"
      title={collapsed ? 'Entgangene Klienten' : 'Wer uns entgangen ist und warum — und wer zu entgehen droht'}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'
      } ${collapsed ? 'justify-center' : ''}`}
    >
      <UserX size={17} />
      {!collapsed && <span>Entgangene Klienten</span>}
    </Link>
  )
}
