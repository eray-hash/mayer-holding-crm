import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card, EmptyState } from './ui'
import { FormularLinkButtons } from './FormularLink'
import { fmtDateTime } from '../lib/dates'
import type { KundeBereich } from '../types'

// Zeigt entweder den Link zum Selbstauskunft-Formular (wenn noch nicht ausgefüllt) oder die
// eingereichten Antworten + Unterschrift an — in allen sechs KundeBereich-Detailseiten einbindbar,
// analog zu KaeuferprofilSection/PotenzialAnalyseSection.
export function SelbstauskunftSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string; kundeName: string }) {
  const { state } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  if (!kunde) return null

  if (!kunde.selbstauskunft) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-500">
          Noch keine Selbstauskunft eingereicht. Diesen Link an {kunde.ansprechpartner} schicken, damit er/sie den Fragenkatalog digital ausfüllt und unterschreibt.
        </p>
        <FormularLinkButtons pfad={`/formular/selbstauskunft/${bereich}/${kundeId}`} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Eingereicht am {fmtDateTime(kunde.selbstauskunft.eingereichtAm)}</p>
      <Card className="p-4">
        <dl className="space-y-3">
          {kunde.selbstauskunft.antworten.map((a) => (
            <div key={a.frageId}>
              <dt className="text-xs text-slate-400">{a.frageText}</dt>
              <dd className="text-sm text-slate-700">{a.antwort || '—'}</dd>
            </div>
          ))}
          {kunde.selbstauskunft.antworten.length === 0 && <EmptyState text="Keine Antworten erfasst." />}
        </dl>
      </Card>
      <Card className="p-4">
        <p className="mb-2 text-xs font-semibold text-slate-500">Unterschrift</p>
        <img src={kunde.selbstauskunft.signaturDataUrl} alt="Unterschrift" className="h-20 rounded bg-white" />
      </Card>
    </div>
  )
}
