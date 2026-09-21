import { Navigate } from 'react-router-dom'
import { CheckCircle2, Clock } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { usePortalAuth } from '../../context/PortalAuthContext'
import { Card, EmptyState } from '../../components/ui'
import { fmtDate, fmtEUR } from '../../lib/dates'

export function PortalAuszahlungen() {
  const { state } = useApp()
  const { investorId } = usePortalAuth()
  const investor = state.fondsInvestoren.find((i) => i.id === investorId)
  if (!investor) return <Navigate to="/portal/login" replace />

  const sorted = [...investor.ausschuettungen].sort((a, b) => b.datum.localeCompare(a.datum))
  const gesamtAusgezahlt = investor.ausschuettungen.filter((a) => a.status === 'Ausgezahlt').reduce((s, a) => s + a.betrag, 0)
  const gesamtGeplant = investor.ausschuettungen.filter((a) => a.status === 'Geplant').reduce((s, a) => s + a.betrag, 0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Ausschüttungen</h1>
        <p className="text-sm text-slate-500">Halbjährliche oder jährliche Ausschüttung gemäß Investmentprozess</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Bereits ausgezahlt</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{fmtEUR(gesamtAusgezahlt)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Geplante Ausschüttungen</div>
          <div className="mt-1 text-xl font-semibold text-slate-800">{fmtEUR(gesamtGeplant)}</div>
        </Card>
      </div>

      {sorted.length === 0 ? (
        <EmptyState text="Für Sie sind noch keine Ausschüttungen hinterlegt." />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Datum</th>
                <th className="px-4 py-2.5 font-medium">Betrag</th>
                <th className="px-4 py-2.5 font-medium">Turnus</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(a.datum)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{fmtEUR(a.betrag)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.turnus}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        a.status === 'Ausgezahlt' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {a.status === 'Ausgezahlt' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-4 text-xs text-slate-400">
        Geplante Ausschüttungen sind Planwerte auf Basis des Zielrenditepfads und keine zugesicherte Zahlung.
      </p>
    </div>
  )
}
