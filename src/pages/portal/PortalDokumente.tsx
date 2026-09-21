import { Navigate } from 'react-router-dom'
import { FileText, Download } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { usePortalAuth } from '../../context/PortalAuthContext'
import { Card, EmptyState } from '../../components/ui'
import { fmtDate } from '../../lib/dates'
import type { FondsDokument, FondsDokumentKategorie } from '../../types'

const KATEGORIEN: FondsDokumentKategorie[] = ['Zeichnungsschein', 'Quartalsreport', 'Steuerbescheinigung', 'Prospekt', 'Sonstiges']

const KATEGORIE_LABEL: Record<FondsDokumentKategorie, string> = {
  Zeichnungsschein: 'Zeichnungsscheine',
  Quartalsreport: 'Quartalsreports',
  Steuerbescheinigung: 'Steuerbescheinigungen',
  Prospekt: 'Prospekt',
  Sonstiges: 'Sonstige Dokumente',
}

function DokumentGruppe({ titel, dokumente }: { titel: string; dokumente: FondsDokument[] }) {
  if (dokumente.length === 0) return null
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{titel}</h2>
      <Card className="divide-y divide-slate-100">
        {dokumente.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                <FileText size={15} />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-800">{d.name}</div>
                <div className="text-xs text-slate-500">
                  {fmtDate(d.datum)} · {d.groesse}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => alert('Demo-Dokument: In der Live-Version steht hier der echte Download bereit.')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Download size={13} /> Herunterladen
            </button>
          </div>
        ))}
      </Card>
    </div>
  )
}

export function PortalDokumente() {
  const { state } = useApp()
  const { investorId } = usePortalAuth()
  const investor = state.fondsInvestoren.find((i) => i.id === investorId)
  if (!investor) return <Navigate to="/portal/login" replace />

  const alle = [...investor.dokumente, ...state.fondsDokumenteAllgemein]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Dokumente</h1>
        <p className="text-sm text-slate-500">Zeichnungsscheine, Quartalsreports und weitere Unterlagen zu Ihrer Investition</p>
      </div>

      {alle.length === 0 ? (
        <EmptyState text="Für Sie sind noch keine Dokumente hinterlegt." />
      ) : (
        KATEGORIEN.map((k) => (
          <DokumentGruppe key={k} titel={KATEGORIE_LABEL[k]} dokumente={alle.filter((d) => d.kategorie === k)} />
        ))
      )}
    </div>
  )
}
