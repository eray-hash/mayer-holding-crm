import { Navigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { usePortalAuth } from '../../context/PortalAuthContext'
import { Card } from '../../components/ui'
import { fmtEUR, today } from '../../lib/dates'
import { INDEXPFAD, RENDITEPFAD, SZENARIEN, aktuellerWert, jahreSeit } from '../../lib/fonds'

const CHART_W = 640
const CHART_H = 260
const PAD_L = 40
const PAD_B = 28
const PAD_T = 16
const PAD_R = 16

function RenditeChart({ investorJahre }: { investorJahre: number[] }) {
  const maxIndex = Math.max(...INDEXPFAD.map((p) => p.index)) * 1.05
  const plotW = CHART_W - PAD_L - PAD_R
  const plotH = CHART_H - PAD_T - PAD_B

  const x = (jahr: number) => PAD_L + (jahr / 10) * plotW
  const y = (index: number) => PAD_T + plotH - (index / maxIndex) * plotH

  const linePath = INDEXPFAD.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.jahr)} ${y(p.index)}`).join(' ')
  const areaPath = `${linePath} L ${x(10)} ${y(0)} L ${x(0)} ${y(0)} Z`

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-auto w-full" role="img" aria-label="Zielrenditepfad über 10 Jahre">
      {[0, 50, 100, 150, 200, 250, 300, 350].map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={CHART_W - PAD_R} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD_L - 8} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {v}
          </text>
        </g>
      ))}
      {INDEXPFAD.map((p) => (
        <text key={p.jahr} x={x(p.jahr)} y={CHART_H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
          {p.jahr}
        </text>
      ))}
      <path d={areaPath} fill="#eef2ff" />
      <path d={linePath} fill="none" stroke="#4f46e5" strokeWidth={2} />
      {INDEXPFAD.map((p) => (
        <circle key={p.jahr} cx={x(p.jahr)} cy={y(p.index)} r={2.5} fill="#4f46e5" />
      ))}
      {investorJahre.map((jahre, i) => (
        <line key={i} x1={x(jahre)} x2={x(jahre)} y1={PAD_T} y2={CHART_H - PAD_B} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
      ))}
      <text x={CHART_W / 2} y={CHART_H - 1} textAnchor="middle" fontSize="9" fill="#94a3b8">
        Jahr seit Zeichnung
      </text>
    </svg>
  )
}

export function PortalRendite() {
  const { state } = useApp()
  const { investorId } = usePortalAuth()
  const investor = state.fondsInvestoren.find((i) => i.id === investorId)
  if (!investor) return <Navigate to="/portal/login" replace />

  const ref = today()
  const investorJahre = investor.zeichnungen.map((z) => jahreSeit(z.datum, ref))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Rendite &amp; Wertentwicklung</h1>
        <p className="text-sm text-slate-500">Zielrendite, gestaffelt über 10 Jahre (4 % bis 10 % p.a.) · keine Garantie</p>
      </div>

      <Card className="mb-8 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Zielrenditepfad (Indexwert, Start = 100)</h2>
        <p className="mb-4 text-xs text-slate-500">
          Die gestrichelte Linie markiert, wo Ihre Zeichnung(en) heute auf dem Zielpfad stehen.
        </p>
        <RenditeChart investorJahre={investorJahre} />
      </Card>

      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Renditepfad im Detail</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Jahr</th>
                <th className="px-4 py-2 font-medium">Zielrendite</th>
                <th className="px-4 py-2 font-medium">Phase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {RENDITEPFAD.map((r) => (
                <tr key={r.jahr}>
                  <td className="px-4 py-2 text-slate-600">{r.jahr}</td>
                  <td className="px-4 py-2 font-medium text-slate-800">{r.renditeProzent} %</td>
                  <td className="px-4 py-2 text-slate-500">{r.kommentar}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            Kumuliert über 10 Jahre: rund 2,12-faches Kapital (Zielrendite, keine Garantie).
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Szenarien (Modellrechnung)</h2>
          <div className="space-y-3">
            {SZENARIEN.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-slate-800">{s.label}</div>
                  <div className="text-xs text-slate-500">Wahrscheinlichkeit ca. {s.anteil} %</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-800">{s.renditeProzent.toFixed(1).replace('.', ',')} % p.a.</div>
                  <div className="text-xs text-slate-500">aus 100 werden {s.endindex}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-400">Alle Werte Modellrechnungen auf Basis von Marktannahmen. Keine Zusicherung. Keine Garantie.</p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Ihre aktuelle Position</h2>
        <div className="space-y-2">
          {investor.zeichnungen.map((z) => (
            <div key={z.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Zeichnung vom {new Date(z.datum + 'T00:00:00').toLocaleDateString('de-DE')} · {fmtEUR(z.betrag)}
              </span>
              <span className="font-medium text-slate-800">{fmtEUR(aktuellerWert(z.betrag, z.datum, ref))} aktueller Wert</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
