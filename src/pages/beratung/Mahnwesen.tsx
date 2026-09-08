import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState } from '../../components/ui'
import { fmtEUR, daysSince } from '../../lib/dates'
import { MAHNSTUFEN, mahnstufeLabel, nextMahnstufe } from '../../data/constants'

export function Mahnwesen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const offen = state.rechnungen.filter((r) => r.status === 'Versendet' || r.status === 'Überfällig')

  function erhoehen(id: string, current: string | undefined) {
    const next = nextMahnstufe(current as any)
    if (next) dispatch({ type: 'UPDATE_RECHNUNG', id, patch: { mahnstufe: next, status: 'Überfällig' } })
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mahnwesen</h1>
      <p className="mb-5 text-sm text-slate-500">Offene und überfällige Rechnungen aller Kunden</p>

      <div className="mb-5 flex flex-wrap gap-3">
        {MAHNSTUFEN.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {m.label}: <span className="font-semibold text-slate-700">{offen.filter((r) => r.mahnstufe === m.id).length}</span>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Rechnungsnr.</th>
              <th className="px-4 py-3">Betrag</th>
              <th className="px-4 py-3">Fällig seit</th>
              <th className="px-4 py-3">Mahnstufe</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {offen.map((r) => {
              const kunde = state.kunden.find((k) => k.id === r.kundeId)
              const tage = daysSince(r.zahlungsziel)
              const next = nextMahnstufe(r.mahnstufe)
              return (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-700 cursor-pointer" onClick={() => kunde && navigate(`/beratung/kunden/${kunde.id}`)}>
                    {kunde?.firma ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.nummer}</td>
                  <td className="px-4 py-3 text-slate-700">{fmtEUR(r.betragBrutto)}</td>
                  <td className={`px-4 py-3 ${tage > 0 ? 'font-medium text-rose-600' : 'text-slate-500'}`}>{tage} Tage</td>
                  <td className="px-4 py-3 text-slate-600">{mahnstufeLabel(r.mahnstufe)}</td>
                  <td className="px-4 py-3 text-right">
                    {next && (
                      <button
                        onClick={() => erhoehen(r.id, r.mahnstufe)}
                        className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Mahnstufe erhöhen <ArrowRight size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {offen.length === 0 && <div className="p-4"><EmptyState text="Keine offenen Rechnungen." /></div>}
      </Card>
    </div>
  )
}
