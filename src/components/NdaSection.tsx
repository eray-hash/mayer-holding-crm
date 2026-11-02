import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card } from './ui'
import { FormularLinkButtons } from './FormularLink'
import { fmtDate } from '../lib/dates'
import type { KundeBereich } from '../types'

// Signatur mit diesem kontext-Wert gilt als "NDA bereits unterschrieben" — kein eigenes
// dediziertes Feld am Kunde-Typ nötig, genau wie die bestehenden Vollmacht-Signaturen auch nur
// generisch in kunde.signaturen landen (siehe sendePublicFormular in src/lib/emailGateway.ts).
const NDA_KONTEXT = 'NDA – Geheimhaltungsvereinbarung'

// Zeigt entweder den Link zum NDA-Formular (wenn noch nicht unterschrieben) oder die geleistete
// Unterschrift an — in allen sechs KundeBereich-Detailseiten einbindbar, analog zu
// SelbstauskunftSection.
export function NdaSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  if (!kunde) return null

  const signatur = kunde.signaturen?.find((s) => s.kontext === NDA_KONTEXT)

  if (!signatur) {
    return (
      <div>
        <p className="mb-3 text-sm text-slate-500">
          Noch keine Geheimhaltungsvereinbarung (NDA) unterschrieben. Diesen Link an {kunde.ansprechpartner} schicken.
        </p>
        <FormularLinkButtons pfad={`/formular/nda/${bereich}/${kundeId}`} />
      </div>
    )
  }

  return (
    <Card className="p-4">
      <p className="mb-2 text-xs text-slate-400">Unterschrieben am {fmtDate(signatur.datum)}</p>
      <img src={signatur.dataUrl} alt="Unterschrift NDA" className="h-20 rounded bg-white" />
    </Card>
  )
}
