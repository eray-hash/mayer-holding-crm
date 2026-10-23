import type { MailVorlage } from '../types'

// Ersetzt {{firma}}/{{ansprechpartner}} durch den übergebenen Kunden-Kontext. Ohne Kunden-Kontext
// (freies Verfassen im Postfach, kein konkreter Kunde ausgewählt) bleiben die Platzhalter sichtbar
// stehen, statt sie leer oder unbemerkt falsch zu befüllen.
export function applyMailVorlage(vorlage: MailVorlage, kunde?: { firma?: string; ansprechpartner?: string }): { betreff: string; text: string } {
  const replace = (s: string) =>
    s.replaceAll('{{firma}}', kunde?.firma ?? '{{firma}}').replaceAll('{{ansprechpartner}}', kunde?.ansprechpartner ?? '{{ansprechpartner}}')
  return { betreff: replace(vorlage.betreff), text: replace(vorlage.text) }
}
