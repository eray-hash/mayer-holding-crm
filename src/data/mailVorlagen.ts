import type { MailVorlage } from '../types'

// Platzhalter {{firma}} und {{ansprechpartner}} werden beim Anwenden auf einen Kunden-Kontext
// ersetzt (siehe applyMailVorlage in lib/mailVorlagen.ts) — ohne Kunden-Kontext (freies Verfassen)
// bleiben sie als Text stehen, damit nichts unbemerkt leer versendet wird.
export const seedMailVorlagen: MailVorlage[] = [
  {
    id: 'mv-terminbestaetigung',
    name: 'Terminbestätigung',
    betreff: 'Terminbestätigung',
    text: 'Guten Tag {{ansprechpartner}},\n\nhiermit bestätigen wir den vereinbarten Termin. Bei Rückfragen oder falls der Termin nicht passt, melden Sie sich gerne jederzeit bei uns.\n\nMit freundlichen Grüßen\nMayer Holding',
  },
  {
    id: 'mv-unterlagenanfrage',
    name: 'Unterlagenanfrage',
    betreff: 'Unterlagen benötigt',
    text: 'Guten Tag {{ansprechpartner}},\n\nfür die weitere Bearbeitung benötigen wir noch folgende Unterlagen von Ihnen:\n- \n\nVielen Dank im Voraus für die kurzfristige Zusendung.\n\nMit freundlichen Grüßen\nMayer Holding',
  },
  {
    id: 'mv-angebot-nachfassen',
    name: 'Angebot nachfassen',
    betreff: 'Rückfrage zu unserem Angebot',
    text: 'Guten Tag {{ansprechpartner}},\n\nwir wollten kurz nachfragen, ob Sie unser Angebot für {{firma}} bereits prüfen konnten und ob noch Fragen offen sind.\n\nWir freuen uns auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen\nMayer Holding',
  },
  {
    id: 'mv-willkommen',
    name: 'Willkommen als Interessent',
    betreff: 'Vielen Dank für Ihre Anfrage',
    text: 'Guten Tag {{ansprechpartner}},\n\nvielen Dank für Ihre Anfrage bei der Mayer Holding. Wir melden uns in Kürze bei Ihnen, um die nächsten Schritte zu besprechen.\n\nMit freundlichen Grüßen\nMayer Holding',
  },
]
