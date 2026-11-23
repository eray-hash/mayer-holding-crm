// Modul E-Rechnung: Knopf „E-Rechnung (XRechnung)“ im Detailfenster einer Ausgangsrechnung. Prüft die
// Pflichtangaben; fehlt etwas, erscheint eine Liste, sonst wird die Datei <Nummer>_XRechnung.xml gespeichert.
import { useState } from 'react'
import { AlertTriangle, FileCode } from 'lucide-react'
import { Modal, PrimaryButton } from '../../components/ui'
import { findeAkte } from '../../components/KostenvoranschlaegeSection'
import { useRechnungAktionen } from '../../components/rechnungen/aktionen'
import { herunterladen } from '../../lib/briefe'
import type { Rechnung } from '../../types'
import { useModulAktiv } from '../modulSchalter'
import { MODUL_E_RECHNUNG } from './kern'
import { xRechnungFuer } from './ausRechnung'

export function XRechnungKnopf({ rechnung, className }: { rechnung: Rechnung; className: string }) {
  const aktiv = useModulAktiv(MODUL_E_RECHNUNG)
  const { state, briefkopf, nutzer } = useRechnungAktionen()
  const [fehler, setFehler] = useState<string[] | null>(null)
  const [fertig, setFertig] = useState('')
  if (!aktiv) return null

  function erstellen() {
    setFertig('')
    const ergebnis = xRechnungFuer(rechnung, findeAkte(state, rechnung.kundeId), briefkopf, nutzer.name)
    if (!ergebnis.ok) return setFehler(ergebnis.fehler)
    herunterladen(new Blob([ergebnis.xml], { type: 'application/xml' }), ergebnis.dateiname)
    setFertig(ergebnis.dateiname)
    window.setTimeout(() => setFertig(''), 4000)
  }

  return (
    <>
      <button type="button" onClick={erstellen} className={className} title="Rechnung als E-Rechnung im Format XRechnung speichern">
        <FileCode size={15} /> {fertig ? 'Gespeichert' : 'E-Rechnung (XRechnung)'}
      </button>
      {fehler && (
        <Modal open onClose={() => setFehler(null)} title="E-Rechnung noch nicht möglich">
          <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Für die XRechnung fehlen noch Angaben. Bitte ergänzen und dann noch einmal versuchen:</span>
          </div>
          <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-slate-700">
            {fehler.map((f) => <li key={f}>{f}</li>)}
          </ul>
          <p className="mb-4 text-xs text-slate-500">
            Angaben zum Kunden (E-Mail-Adresse, Anschrift) stehen in der Akte bzw. unter „Bearbeiten“; Angaben zum Absender (Anschrift, Steuernummer, IBAN, Telefon) im Briefkopf unter den Vorlagen.
          </p>
          <div className="flex justify-end">
            <PrimaryButton onClick={() => setFehler(null)}>Verstanden</PrimaryButton>
          </div>
        </Modal>
      )}
    </>
  )
}
