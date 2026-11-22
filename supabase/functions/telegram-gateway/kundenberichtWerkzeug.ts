// Assistent-Werkzeug: Entwurf des Statusberichts an den Kunden („Stand Ihres Projekts“, 22.11.2026).
// Liefert denselben Text wie das Fenster „Statusbericht an Kunden“ im CRM (Kern
// _shared/kundenberichtKern.ts). Gesendet wird NUR im CRM nach Prüfung — das Werkzeug schreibt nichts
// und verschickt nichts; es nennt den Link, der das Fenster in der Akte gleich öffnet.
// Rechte wie bei jeder Akte (rechte.ts); private Kontakte haben keinen Statusbericht.

import { akteLink, berichtAlsText, CRM_BASIS_STANDARD, deDatum, erstelleKundenbericht, ladeBerichtDaten, standardSeit } from '../_shared/kundenberichtKern.ts'
import { darfAkte, istEigene, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type BerichtKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const BERICHT_WERKZEUGE = [
  {
    name: 'statusbericht_entwurf',
    description:
      'Zeigt den Entwurf des Statusberichts an den Kunden („Stand Ihres Projekts“) für eine Kundenakte: was seit dem letzten Bericht (sonst in den letzten 7 Tagen) passiert ist, die nächsten Schritte, was wir noch vom Kunden brauchen, und eine Ampel. Für Fragen wie „Wie sähe der Statusbericht für X aus?“ oder „Mach mir einen Statusbericht für Familie Y“. Sendet NICHTS — verschickt wird nur im CRM über den Link in der Antwort, nach Prüfung durch den Mitarbeiter. Interne Notizen, Namen von Kollegen und Beträge (außer aus verschickten Rechnungen und Angeboten) stehen nie im Bericht.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen ermitteln).' },
        seit: { type: 'string', description: 'Optional: erster Tag des Zeitraums als JJJJ-MM-TT. Ohne Angabe: Tag nach dem letzten Bericht, sonst die letzten 7 Tage.' },
      },
      required: ['kunde_id'],
    },
  },
]

export function istBerichtWerkzeug(name: string): boolean {
  return BERICHT_WERKZEUGE.some((w) => w.name === name)
}

// deno-lint-ignore no-explicit-any
export async function fuehreBerichtWerkzeugAus(name: string, input: any, k: BerichtKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (name !== 'statusbericht_entwurf') return `Fehler: unbekanntes Werkzeug ${name}.`
  const kundeId = String(input?.kunde_id ?? '').trim()
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
  const { data: akte, error } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (error) return `Fehler beim Laden der Akte: ${error.message}`
  if (!akte) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
  if (istPrivat(akte) || mitarbeiter.nurPrivat === true) {
    return istPrivat(akte) && istEigene(mitarbeiter, akte.verantwortlich_email) ? 'Für private Kontakte gibt es keinen Statusbericht.' : 'Fehler: Diese Akte gibt es für dich nicht.'
  }
  if (SAMMELAKTEN.includes(akte.id)) return 'Fehler: Für die Sammelakten (Ungeklärte Eingänge, Intern) gibt es keinen Statusbericht.'
  if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)

  const daten = await ladeBerichtDaten(supabase, kundeId)
  if (!daten) return 'Fehler: Die Akte ließ sich nicht laden.'
  const seitAngabe = String(input?.seit ?? '').trim()
  const seit = /^\d{4}-\d{2}-\d{2}$/.test(seitAngabe) && seitAngabe <= heute ? seitAngabe : standardSeit(daten.akte, daten.letzterVersand, heute)
  const bericht = erstelleKundenbericht({ ...daten, heute, seit })
  const { data: wk } = await supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
  const link = akteLink(wk?.link_basis || CRM_BASIS_STANDARD, daten.akte.bereich, kundeId)
  protokolliere(`Statusbericht-Entwurf für Akte ${kundeId} angesehen (Zeitraum ab ${deDatum(seit)})`)

  const text = berichtAlsText(bericht, bericht.vonIhnen.length ? '[Link zum Hochladen — wird beim Senden im CRM erzeugt]' : undefined)
  return [
    `ENTWURF (nicht gesendet). Zeitraum ${deDatum(seit)} bis ${deDatum(heute)}. Betreff: ${bericht.betreff}`,
    'Gib dem Mitarbeiter den Text so wieder und sag ihm, dass er ihn im CRM prüfen, ändern und von dort senden kann (als E-Mail mit PDF oder nur als PDF). Selbst senden kannst du ihn nicht.',
    '---',
    text,
    '---',
    bericht.hinweise.length ? `Nur für den Mitarbeiter (nicht im Bericht): ${bericht.hinweise.join(' | ')}` : '',
    `Im CRM öffnen und senden: ${link}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 12000)
}
