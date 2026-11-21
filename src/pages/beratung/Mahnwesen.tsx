import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, ChevronRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState } from '../../components/ui'
import { fmtDate, fmtEURCent } from '../../lib/dates'
import { istUnbezahlt, istUeberfaellig, offenerBetrag, mahngebuehren, tageBisFrist, aktuelleFrist } from '../../lib/rechnungen'
import { MAHNSTUFEN, mahnstufeLabel, nextMahnstufe } from '../../data/constants'
import { akteName, findeAkte, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { RechnungDetail } from '../../components/rechnungen/RechnungDetail'
import { MahnungModal } from '../../components/rechnungen/RechnungDialoge'
import { mahnstufeName } from '../../lib/rechnungPdf'
import type { Rechnung } from '../../types'

// Ins Mahnwesen gehört nur, was überfällig ist. Offene Rechnungen, deren Zahlungsziel noch läuft,
// stehen in der Rechnungsübersicht unter "Offen".
// Seit 21.11.2026: Je Rechnung den nächsten Schritt (Zahlungserinnerung, 1. und 2. Mahnung) als PDF auf
// dem Briefbogen erstellen oder per E-Mail senden; jeder Schritt wird an der Rechnung und in der Akte
// vermerkt. Antippen einer Zeile öffnet die Rechnung.
export function Mahnwesen() {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [mahnenId, setMahnenId] = useState<string | null>(null)

  const ueberfaellig = state.rechnungen.filter(istUeberfaellig).sort((a, b) => aktuelleFrist(a).localeCompare(aktuelleFrist(b)))
  const nochNichtFaellig = state.rechnungen.filter((r) => istUnbezahlt(r) && !istUeberfaellig(r)).length
  const summeOffen = ueberfaellig.reduce((s, r) => s + offenerBetrag(r) + mahngebuehren(r), 0)

  const verlauf = useMemo(
    () =>
      state.rechnungen
        .flatMap((r) => (r.mahnungen ?? []).map((m) => ({ m, r })))
        .sort((a, b) => b.m.datum.localeCompare(a.m.datum))
        .slice(0, 30),
    [state.rechnungen],
  )

  const kunde = (r: Rechnung) => {
    const a = findeAkte(state, r.kundeId)
    return a ? akteName(a.kunde) : '–'
  }
  const letzterSchritt = (r: Rechnung) => [...(r.mahnungen ?? [])].pop()
  const fristText = (r: Rechnung) => {
    const t = tageBisFrist(r)
    if (t === null) return '–'
    if (t < 0) return `seit ${-t} ${t === -1 ? 'Tag' : 'Tagen'} überfällig`
    if (t === 0) return 'Frist endet heute'
    return `neue Frist läuft noch ${t} ${t === 1 ? 'Tag' : 'Tage'}`
  }
  const schrittKnopf = (r: Rechnung) => {
    const next = nextMahnstufe(r.mahnstufe)
    if (!next) return null
    return (
      <button
        type="button"
        disabled={nutzer.nurLesen}
        onClick={(e) => {
          e.stopPropagation()
          setMahnenId(r.id)
        }}
        className="inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 disabled:opacity-50"
      >
        <BellRing size={13} /> {next === 'inkasso' ? 'An Inkasso übergeben' : `${mahnstufeName(next)} erstellen`}
      </button>
    )
  }
  const mahnen = mahnenId ? state.rechnungen.find((r) => r.id === mahnenId) : undefined

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mahnwesen</h1>
      <p className="mb-5 text-sm text-slate-500">Überfällige Rechnungen aller Kunden — das Zahlungsziel ist verstrichen und es ist noch nicht (vollständig) bezahlt.</p>

      <div className="mb-5 flex flex-wrap gap-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          Offen insgesamt: <span className="font-semibold text-rose-600">{fmtEURCent(summeOffen)}</span>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          Noch nicht gemahnt: <span className="font-semibold text-slate-700">{ueberfaellig.filter((r) => !r.mahnstufe).length}</span>
        </div>
        {MAHNSTUFEN.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            {m.label}: <span className="font-semibold text-slate-700">{ueberfaellig.filter((r) => r.mahnstufe === m.id).length}</span>
          </div>
        ))}
      </div>

      {/* Breite Bildschirme */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Rechnungsnr.</th>
              <th className="px-4 py-3 text-right">Offen</th>
              <th className="px-4 py-3">Zahlungsziel</th>
              <th className="px-4 py-3">Stand</th>
              <th className="px-4 py-3">Letzter Schritt</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {ueberfaellig.map((r) => {
              const letzter = letzterSchritt(r)
              const t = tageBisFrist(r)
              return (
                <tr key={r.id} onClick={() => setDetailId(r.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-accent-50/40">
                  <td className="px-4 py-3 font-medium text-slate-700">{kunde(r)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{r.nummer}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                    {fmtEURCent(offenerBetrag(r) + mahngebuehren(r))}
                    {mahngebuehren(r) > 0 && <div className="text-xs text-slate-400">inkl. {fmtEURCent(mahngebuehren(r))} Gebühren</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(r.zahlungsziel)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-xs ${t !== null && t < 0 ? 'font-medium text-rose-600' : 'text-amber-700'}`}>{fristText(r)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {letzter ? (
                      <>
                        <div className="font-medium">{mahnstufeLabel(letzter.stufe)}</div>
                        <div className="text-slate-400">
                          {fmtDate(letzter.datum)} · {letzter.weg === 'email' ? 'per E-Mail' : letzter.weg === 'pdf' ? 'als PDF' : 'vermerkt'}
                        </div>
                      </>
                    ) : r.mahnstufe ? (
                      mahnstufeLabel(r.mahnstufe)
                    ) : (
                      <span className="text-slate-400">noch keiner</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 text-slate-400">
                      {schrittKnopf(r)}
                      <ChevronRight size={16} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {ueberfaellig.length === 0 && (
          <div className="p-4">
            <EmptyState text="Keine überfälligen Rechnungen." />
          </div>
        )}
      </Card>

      {/* Handy */}
      <div className="space-y-2 lg:hidden">
        {ueberfaellig.map((r) => {
          const letzter = letzterSchritt(r)
          const t = tageBisFrist(r)
          return (
            <div key={r.id} onClick={() => setDetailId(r.id)} className="cursor-pointer rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800">{kunde(r)}</div>
                  <div className="text-xs text-slate-500">
                    {r.nummer} · Ziel {fmtDate(r.zahlungsziel)}
                  </div>
                </div>
                <div className="shrink-0 text-right font-semibold text-rose-600">{fmtEURCent(offenerBetrag(r) + mahngebuehren(r))}</div>
              </div>
              <div className={`mt-1 text-xs ${t !== null && t < 0 ? 'font-medium text-rose-600' : 'text-amber-700'}`}>{fristText(r)}</div>
              <div className="mt-1 text-xs text-slate-500">
                Letzter Schritt: {letzter ? `${mahnstufeLabel(letzter.stufe)} am ${fmtDate(letzter.datum)}` : r.mahnstufe ? mahnstufeLabel(r.mahnstufe) : 'noch keiner'}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                {schrittKnopf(r) ?? <span />}
                <span className="inline-flex items-center text-xs text-accent-700">
                  Rechnung öffnen <ChevronRight size={14} />
                </span>
              </div>
            </div>
          )
        })}
        {ueberfaellig.length === 0 && (
          <Card className="p-4">
            <EmptyState text="Keine überfälligen Rechnungen." />
          </Card>
        )}
      </div>

      {nochNichtFaellig > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {nochNichtFaellig === 1 ? '1 offene Rechnung ist' : `${nochNichtFaellig} offene Rechnungen sind`} noch nicht fällig und {nochNichtFaellig === 1 ? 'steht' : 'stehen'} unter{' '}
          <Link to="/beratung/rechnungen" className="font-medium text-accent-600 hover:text-accent-700">
            Rechnungen
          </Link>{' '}
          im Filter „Offen“.
        </p>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">Verlauf der Mahnschreiben</h2>
      <Card>
        {verlauf.length === 0 ? (
          <div className="p-4">
            <EmptyState text="Noch keine Zahlungserinnerung oder Mahnung erstellt." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {verlauf.map(({ m, r }) => (
              <button key={m.id} type="button" onClick={() => setDetailId(r.id)} className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="font-medium text-slate-700">{mahnstufeLabel(m.stufe)}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {kunde(r)} · {r.nummer}
                  </span>
                </span>
                <span className="text-xs text-slate-500">
                  {fmtDate(m.datum)} · {m.weg === 'email' ? `per E-Mail an ${m.an}` : m.weg === 'pdf' ? 'als PDF' : 'vermerkt'}
                  {m.neueFrist ? ` · Frist ${fmtDate(m.neueFrist)}` : ''}
                  {r.status === 'Bezahlt' ? ' · inzwischen bezahlt' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {detailId && <RechnungDetail rechnungId={detailId} onClose={() => setDetailId(null)} />}
      {mahnen && <MahnungModal rechnung={mahnen} onClose={() => setMahnenId(null)} />}
    </div>
  )
}
