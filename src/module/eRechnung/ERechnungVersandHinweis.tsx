// Modul E-Rechnung: kurzer Hinweis im Fenster „Rechnung senden“ — ob die XRechnung beim Versand per
// E-Mail zusätzlich angehängt wird oder warum nicht (dann geht die Rechnung nur als PDF hinaus).
import { FileCode } from 'lucide-react'
import type { XRechnungErgebnis } from './ausRechnung'

export function ERechnungVersandHinweis({ ergebnis }: { ergebnis: XRechnungErgebnis }) {
  if (ergebnis.ok) {
    return (
      <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        <FileCode size={14} className="mt-0.5 shrink-0" />
        <span>Beim Versand per E-Mail wird zusätzlich die E-Rechnung „{ergebnis.dateiname}“ (XRechnung) angehängt.</span>
      </p>
    )
  }
  return (
    <div className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <div className="flex items-start gap-1.5">
        <FileCode size={14} className="mt-0.5 shrink-0" />
        <span>Ohne E-Rechnung (XRechnung) — die Rechnung geht nur als PDF hinaus, weil:</span>
      </div>
      <ul className="ml-5 mt-1 list-disc space-y-0.5">
        {ergebnis.fehler.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </div>
  )
}
