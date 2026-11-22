// Kleiner Hinweis „Neu: …“ neben einem neuen Knopf (23.11.2026) — erscheint je Mitarbeiter, bis er ihn
// wegklickt (gespeichert in neuigkeiten_gelesen als 'hinweis:<name>', also auf jedem Gerät weg). Optional
// verschwindet er von selbst nach einem Datum (bis) und verweist mit „Mehr“ auf den Eintrag in „Neu im CRM“.
//
// Einsatz:  <NeuHinweis name="partner" text="Partner und Provisionen an einem Ort" neuigkeit="partner" />
// Gemeinsamer Stand mit Kopfleiste und Seite: lib/neuigkeiten.ts. Solange der Stand nicht geladen ist oder die
// Tabellen fehlen, wird nichts gezeigt (kein Aufblitzen).

import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { hinweisSchluessel, markiereGelesen, useNeuigkeiten } from '../lib/neuigkeiten'

function heute(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function NeuHinweis({
  name,
  text,
  neuigkeit,
  bis,
  className = '',
}: {
  /** Eindeutiger, fester Name des Hinweises (z. B. 'volltextsuche'). Nicht ändern, sonst erscheint er erneut. */
  name: string
  /** Kurzer Satz hinter „Neu:“ — wenige Wörter. */
  text: string
  /** id des Eintrags in „Neu im CRM“ für den Verweis „Mehr“. */
  neuigkeit?: string
  /** Letzter Tag (yyyy-mm-dd), an dem der Hinweis erscheint. */
  bis?: string
  className?: string
}) {
  const { geladen, verfuegbar, gelesen } = useNeuigkeiten()
  const schluessel = hinweisSchluessel(name)
  if (!geladen || !verfuegbar || gelesen.has(schluessel)) return null
  if (bis && heute() > bis) return null
  const weg = () => void markiereGelesen([schluessel])
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 py-0.5 pl-2 pr-0.5 text-[11px] font-medium leading-4 text-amber-800 ${className}`}
      role="note"
    >
      <span className="truncate">Neu: {text}</span>
      {neuigkeit && (
        <Link
          to={`/neuigkeiten?zeige=${encodeURIComponent(neuigkeit)}`}
          onClick={weg}
          className="flex-shrink-0 underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
        >
          Mehr
        </Link>
      )}
      <button
        type="button"
        onClick={(e) => {
          // Der Hinweis sitzt oft neben einem Knopf oder in einem Link — der soll nicht mit ausgelöst werden.
          e.preventDefault()
          e.stopPropagation()
          weg()
        }}
        className="flex-shrink-0 rounded-full p-0.5 text-amber-600 hover:bg-amber-100 hover:text-amber-900"
        aria-label="Hinweis ausblenden"
        title="Ausblenden"
      >
        <X size={11} />
      </button>
    </span>
  )
}
