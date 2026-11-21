import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Check, Search, ChevronRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, EmptyState, inputClass } from '../../components/ui'
import { RechnungStatusBadge } from './KundenDetail'
import { fmtDate, today, uid, fmtEURCent } from '../../lib/dates'
import { istUnbezahlt, istUeberfaellig, angezeigterStatus, offenerBetrag, faelligkeitText, bezahlteSumme } from '../../lib/rechnungen'
import { akteName, findeAkte, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { RechnungDetail } from '../../components/rechnungen/RechnungDetail'
import { RechnungFormular } from '../../components/rechnungen/RechnungFormular'
import type { Rechnung } from '../../types'

type FilterId = 'alle' | 'offen' | 'ueberfaellig' | 'bezahlt' | 'entwurf'

const FILTER: { id: FilterId; label: string; leer: string; passt: (r: Rechnung) => boolean }[] = [
  { id: 'alle', label: 'Alle', leer: 'Noch keine Rechnungen erfasst.', passt: () => true },
  { id: 'offen', label: 'Offen', leer: 'Keine offenen Rechnungen.', passt: istUnbezahlt },
  { id: 'ueberfaellig', label: 'Überfällig', leer: 'Keine überfälligen Rechnungen.', passt: istUeberfaellig },
  { id: 'bezahlt', label: 'Bezahlt', leer: 'Keine bezahlten Rechnungen.', passt: (r) => r.status === 'Bezahlt' },
  { id: 'entwurf', label: 'Entwurf', leer: 'Keine Entwürfe.', passt: (r) => r.status === 'Entwurf' },
]

// Seit 21.11.2026: Jede Zeile (auf dem Handy jede Karte) öffnet das Detailfenster mit Senden, PDF,
// Zahlung erfassen, Mahnen, Bearbeiten. ?rechnung=<id> öffnet eine Rechnung direkt (z. B. aus der Akte),
// ?neu=<kundeId> eine neue Rechnung für diesen Kunden.
export function Rechnungen() {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<FilterId>('alle')
  const [suche, setSuche] = useState('')
  const [neuOffen, setNeuOffen] = useState(false)
  const detailId = params.get('rechnung')
  const neuFuerKunde = params.get('neu')

  function detailOeffnen(id: string | null) {
    const p = new URLSearchParams(params)
    p.delete('neu')
    if (id) p.set('rechnung', id)
    else p.delete('rechnung')
    setParams(p, { replace: true })
  }

  const kpis = useMemo(() => {
    const now = new Date()
    const quarter = Math.floor(now.getMonth() / 3)
    const bezahltQ = state.rechnungen
      .filter((r) => r.status === 'Bezahlt')
      .filter((r) => {
        const d = new Date(r.bezahltAm ?? r.datum)
        return Math.floor(d.getMonth() / 3) === quarter && d.getFullYear() === now.getFullYear()
      })
    return {
      offen: state.rechnungen.filter(istUnbezahlt).reduce((s, r) => s + offenerBetrag(r), 0),
      ueberfaellig: state.rechnungen.filter(istUeberfaellig).reduce((s, r) => s + offenerBetrag(r), 0),
      bezahltQ: bezahltQ.reduce((s, r) => s + r.betragBrutto, 0),
    }
  }, [state.rechnungen])

  const aktiverFilter = FILTER.find((f) => f.id === filter)!
  const suchtext = suche.trim().toLowerCase()
  const kundeName = (r: Rechnung) => {
    const a = findeAkte(state, r.kundeId)
    return a ? akteName(a.kunde) : '–'
  }
  const sichtbar = state.rechnungen
    .filter(aktiverFilter.passt)
    .filter((r) => !suchtext || `${r.nummer} ${kundeName(r)} ${r.leistungBezeichnung ?? ''}`.toLowerCase().includes(suchtext))
    .sort((a, b) => b.datum.localeCompare(a.datum) || b.nummer.localeCompare(a.nummer))

  // Schnellknopf in der Liste: restlichen Betrag als heute gezahlt erfassen.
  function alsBezahltMarkieren(r: Rechnung) {
    const rest = offenerBetrag(r)
    const zahlungen = rest > 0 ? [...(r.zahlungen ?? []), { id: uid('zahl'), datum: today(), betrag: rest, erfasstVon: nutzer.name }] : r.zahlungen
    dispatch({ type: 'UPDATE_RECHNUNG', id: r.id, patch: { status: 'Bezahlt', bezahltAm: today(), mahnstufe: undefined, zahlungen } })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Rechnungen</h1>
          <p className="text-sm text-slate-500">Alle Rechnungen an Kunden, über alle Bereiche — zum Öffnen antippen</p>
        </div>
        <PrimaryButton onClick={() => setNeuOffen(true)} disabled={nutzer.nurLesen}>
          <Plus size={15} /> Neue Rechnung
        </PrimaryButton>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        <Kpi label="Offen (noch nicht bezahlt)" value={fmtEURCent(kpis.offen)} onClick={() => setFilter('offen')} />
        <Kpi label="Davon überfällig" value={fmtEURCent(kpis.ueberfaellig)} accent="text-rose-600" onClick={() => setFilter('ueberfaellig')} />
        <Kpi label="Bezahlt dieses Quartal" value={fmtEURCent(kpis.bezahltQ)} accent="text-emerald-600" onClick={() => setFilter('bezahlt')} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER.map((f) => {
            const anzahl = state.rechnungen.filter(f.passt).length
            const aktiv = f.id === filter
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  aktiv ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label} <span className={aktiv ? 'text-white/80' : 'text-slate-400'}>{anzahl}</span>
              </button>
            )
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} placeholder="Nummer, Kunde oder Leistung suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>

      {/* Breite Bildschirme: Tabelle, jede Zeile anklickbar */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Nr.</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Leistung</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3 text-right">Betrag</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Fälligkeit</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((r) => {
              const ueberfaellig = istUeberfaellig(r)
              const gezahlt = bezahlteSumme(r)
              return (
                <tr key={r.id} onClick={() => detailOeffnen(r.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-accent-50/40">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{r.nummer}</td>
                  <td className="px-4 py-3 text-slate-600">{kundeName(r)}</td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-slate-500">{r.leistungBezeichnung || '–'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(r.datum)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                    {fmtEURCent(r.betragBrutto)}
                    {gezahlt > 0 && r.status !== 'Bezahlt' && <div className="text-xs text-emerald-700">offen {fmtEURCent(offenerBetrag(r))}</div>}
                  </td>
                  <td className="px-4 py-3"><RechnungStatusBadge status={angezeigterStatus(r)} /></td>
                  <td className={`whitespace-nowrap px-4 py-3 text-xs ${ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-500'}`}>{faelligkeitText(r)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-slate-400">
                      {istUnbezahlt(r) && !nutzer.nurLesen && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            alsBezahltMarkieren(r)
                          }}
                          title="Restbetrag als heute bezahlt erfassen"
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        >
                          <Check size={13} /> Bezahlt
                        </button>
                      )}
                      <ChevronRight size={16} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sichtbar.length === 0 && (
          <div className="p-4">
            <EmptyState text={suchtext ? 'Keine Rechnung passt zur Suche.' : aktiverFilter.leer} />
          </div>
        )}
      </Card>

      {/* Handy: Karten zum Antippen */}
      <div className="space-y-2 lg:hidden">
        {sichtbar.map((r) => {
          const ueberfaellig = istUeberfaellig(r)
          return (
            <button key={r.id} type="button" onClick={() => detailOeffnen(r.id)} className="block w-full rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{kundeName(r)}</div>
                  <div className="truncate text-xs text-slate-500">
                    {r.nummer} · {fmtDate(r.datum)}
                    {r.leistungBezeichnung ? ` · ${r.leistungBezeichnung}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold text-slate-800">{fmtEURCent(r.betragBrutto)}</div>
                  <RechnungStatusBadge status={angezeigterStatus(r)} />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className={ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-500'}>{faelligkeitText(r)}</span>
                <span className="inline-flex items-center text-accent-700">
                  Öffnen <ChevronRight size={14} />
                </span>
              </div>
            </button>
          )
        })}
        {sichtbar.length === 0 && (
          <Card className="p-4">
            <EmptyState text={suchtext ? 'Keine Rechnung passt zur Suche.' : aktiverFilter.leer} />
          </Card>
        )}
      </div>

      {detailId && <RechnungDetail rechnungId={detailId} onClose={() => detailOeffnen(null)} />}
      {(neuOffen || neuFuerKunde) && (
        <RechnungFormular
          vorKundeId={neuFuerKunde ?? undefined}
          onClose={() => {
            setNeuOffen(false)
            if (neuFuerKunde) {
              const p = new URLSearchParams(params)
              p.delete('neu')
              setParams(p, { replace: true })
            }
          }}
          onGespeichert={(id) => setTimeout(() => detailOeffnen(id), 0)}
        />
      )}
    </div>
  )
}

function Kpi({ label, value, accent, onClick }: { label: string; value: string; accent?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5 text-left shadow-sm hover:border-accent-300 sm:p-4">
      <div className="text-[11px] font-medium leading-tight text-slate-400 sm:text-xs">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold sm:text-lg ${accent ?? 'text-slate-800'}`}>{value}</div>
    </button>
  )
}
