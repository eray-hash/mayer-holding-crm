// Knopf „Gespräch aufnehmen“ im CRM (Runde 5): öffnet die Gesprächs-App mit Direkt-Link — Akte bzw. Termin sind
// vorgewählt, die App geht gleich zur Einwilligung (siehe supabase/functions/_shared/gespraechLink.ts).
// Benutzt im Abschnitt „Aufnahmen“ der Akte (GespraechAufnahmenListe) und in der Terminansicht des Kalenders.
import { Mic } from 'lucide-react'
import { aufnehmenLink, type AufnehmenArt } from '../../supabase/functions/_shared/gespraechLink.ts'

/** Adresse des CRM (HashRouter: Ursprung + Pfad), unter der auch die App liegt (…/gespraech/). */
export function crmBasis(): string {
  try {
    return new URL('.', `${window.location.origin}${window.location.pathname}`).href
  } catch {
    return 'https://eray-hash.github.io/mayer-holding-crm/'
  }
}

export function GespraechAufnehmenKnopf({
  termin,
  kunde,
  objekt,
  art,
  className,
}: {
  termin?: string | null
  kunde?: string | null
  objekt?: string | null
  art?: AufnehmenArt
  className?: string
}) {
  const href = aufnehmenLink(crmBasis(), { termin: termin ?? undefined, kunde: kunde ?? undefined, objekt: objekt ?? undefined, art })
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Öffnet die App „Mayer Gespräch“ mit dieser Akte — dort zuerst die Einwilligung bestätigen"
      className={className ?? 'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-accent-300 hover:text-accent-700'}
    >
      <Mic size={13} /> Gespräch aufnehmen
    </a>
  )
}
