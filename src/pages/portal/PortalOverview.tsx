import { Navigate } from 'react-router-dom'
import { TrendingUp, Wallet, CalendarClock, PiggyBank } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { usePortalAuth } from '../../context/PortalAuthContext'
import { Card } from '../../components/ui'
import { fmtDate, fmtEUR, today } from '../../lib/dates'
import { aktuellerWert, renditeSeitBeginnProzent } from '../../lib/fonds'

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-semibold text-slate-800">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}

export function PortalOverview() {
  const { state } = useApp()
  const { investorId } = usePortalAuth()
  const investor = state.fondsInvestoren.find((i) => i.id === investorId)
  if (!investor) return <Navigate to="/portal/login" replace />

  const ref = today()
  const gesamtEingezahlt = investor.zeichnungen.reduce((sum, z) => sum + z.betrag, 0)
  const gesamtAktuellerWert = investor.zeichnungen.reduce((sum, z) => sum + aktuellerWert(z.betrag, z.datum, ref), 0)
  const renditeProzent = gesamtEingezahlt > 0 ? ((gesamtAktuellerWert - gesamtEingezahlt) / gesamtEingezahlt) * 100 : 0
  const naechsteAusschuettung = investor.ausschuettungen
    .filter((a) => a.status === 'Geplant')
    .sort((a, b) => a.datum.localeCompare(b.datum))[0]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Willkommen, {investor.name}</h1>
        <p className="text-sm text-slate-500">Ihre persönliche Übersicht im AMH Investitionsfonds 2026 · Investor seit {fmtDate(investor.seit)}</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Wallet size={14} />} label="Eingezahltes Kapital" value={fmtEUR(gesamtEingezahlt)} />
        <StatCard
          icon={<PiggyBank size={14} />}
          label="Aktueller Wert"
          value={fmtEUR(gesamtAktuellerWert)}
          sub="Zielrendite-Modellrechnung, keine Garantie"
        />
        <StatCard
          icon={<TrendingUp size={14} />}
          label="Rendite seit Beginn"
          value={`${renditeProzent >= 0 ? '+' : ''}${renditeProzent.toFixed(1).replace('.', ',')} %`}
        />
        <StatCard
          icon={<CalendarClock size={14} />}
          label="Nächste Ausschüttung"
          value={naechsteAusschuettung ? fmtEUR(naechsteAusschuettung.betrag) : '–'}
          sub={naechsteAusschuettung ? `geplant am ${fmtDate(naechsteAusschuettung.datum)}` : 'derzeit keine geplant'}
        />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-700">Ihre Zeichnungen</h2>
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Zeichnungsdatum</th>
              <th className="px-4 py-2.5 font-medium">Betrag</th>
              <th className="px-4 py-2.5 font-medium">Aktueller Wert</th>
              <th className="px-4 py-2.5 font-medium">Rendite</th>
              <th className="px-4 py-2.5 font-medium">Laufzeit</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {investor.zeichnungen.map((z) => {
              const wert = aktuellerWert(z.betrag, z.datum, ref)
              const rendite = renditeSeitBeginnProzent(z.betrag, z.datum, ref)
              return (
                <tr key={z.id}>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(z.datum)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{fmtEUR(z.betrag)}</td>
                  <td className="px-4 py-2.5 text-slate-800">{fmtEUR(wert)}</td>
                  <td className={`px-4 py-2.5 font-medium ${rendite >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {rendite >= 0 ? '+' : ''}
                    {rendite.toFixed(1).replace('.', ',')} %
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{z.laufzeitJahre} Jahre</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-700">
                      {z.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        Alle Wertangaben sind Modellrechnungen auf Basis des Zielrenditepfads (4 % bis 10 % p.a., gestaffelt über 10 Jahre) und
        stellen keine garantierte oder zugesicherte Rendite dar. Abweichungen nach oben und unten sind möglich.
      </p>
    </div>
  )
}
