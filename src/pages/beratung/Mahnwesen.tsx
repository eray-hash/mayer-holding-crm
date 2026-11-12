import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState } from '../../components/ui'
import { daysSince, fmtDate, fmtEURCent } from '../../lib/dates'
import { istUnbezahlt, istUeberfaellig } from '../../lib/rechnungen'
import { MAHNSTUFEN, mahnstufeLabel, nextMahnstufe } from '../../data/constants'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../../data/kundenBereiche'
import type { Kunde, KundeBereich, MahnstufeId } from '../../types'

// Ins Mahnwesen gehört nur, was überfällig ist. Offene Rechnungen, deren Zahlungsziel noch läuft,
// stehen in der Rechnungsübersicht unter "Offen" — vorher tauchte jede versendete Rechnung sofort
// hier auf, als müsste sie schon gemahnt werden.
export function Mahnwesen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const kundenNachId = useMemo(() => {
    const map = new Map<string, { kunde: Kunde; bereich: KundeBereich }>()
    for (const b of KUNDEN_BEREICHE) for (const kunde of b.get(state)) map.set(kunde.id, { kunde, bereich: b.id })
    return map
  }, [state])

  const ueberfaellig = state.rechnungen.filter(istUeberfaellig).sort((a, b) => a.zahlungsziel.localeCompare(b.zahlungsziel))
  const nochNichtFaellig = state.rechnungen.filter((r) => istUnbezahlt(r) && !istUeberfaellig(r)).length

  function erhoehen(id: string, current: MahnstufeId | undefined) {
    const next = nextMahnstufe(current)
    if (next) dispatch({ type: 'UPDATE_RECHNUNG', id, patch: { mahnstufe: next, status: 'Überfällig' } })
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mahnwesen</h1>
      <p className="mb-5 text-sm text-slate-500">Überfällige Rechnungen aller Kunden — das Zahlungsziel ist verstrichen und es ist noch nicht bezahlt.</p>

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          Noch nicht gemahnt: <span className="font-semibold text-slate-700">{ueberfaellig.filter((r) => !r.mahnstufe).length}</span>
        </div>
        {MAHNSTUFEN.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {m.label}: <span className="font-semibold text-slate-700">{ueberfaellig.filter((r) => r.mahnstufe === m.id).length}</span>
          </div>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Rechnungsnr.</th>
              <th className="px-4 py-3">Betrag</th>
              <th className="px-4 py-3">Zahlungsziel</th>
              <th className="px-4 py-3">Fällig seit</th>
              <th className="px-4 py-3">Mahnstufe</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {ueberfaellig.map((r) => {
              const treffer = kundenNachId.get(r.kundeId)
              const tage = daysSince(r.zahlungsziel)
              const next = nextMahnstufe(r.mahnstufe)
              return (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td
                    className={`px-4 py-3 font-medium text-slate-700 ${treffer ? 'cursor-pointer hover:text-accent-700' : ''}`}
                    onClick={() => treffer && navigate(kundeDetailPfad(treffer.bereich, treffer.kunde.id))}
                  >
                    {treffer?.kunde.firma ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.nummer}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{fmtEURCent(r.betragBrutto)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(r.zahlungsziel)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 ${tage > 0 ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                    {tage > 0 ? `${tage} ${tage === 1 ? 'Tag' : 'Tagen'}` : '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{mahnstufeLabel(r.mahnstufe)}</td>
                  <td className="px-4 py-3 text-right">
                    {next && (
                      <button
                        onClick={() => erhoehen(r.id, r.mahnstufe)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
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
        {ueberfaellig.length === 0 && <div className="p-4"><EmptyState text="Keine überfälligen Rechnungen." /></div>}
      </Card>

      {nochNichtFaellig > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {nochNichtFaellig === 1 ? '1 offene Rechnung ist' : `${nochNichtFaellig} offene Rechnungen sind`} noch nicht fällig und{' '}
          {nochNichtFaellig === 1 ? 'steht' : 'stehen'} unter{' '}
          <Link to="/beratung/rechnungen" className="font-medium text-accent-600 hover:text-accent-700">Rechnungen</Link> im Filter „Offen“.
        </p>
      )}
    </div>
  )
}
