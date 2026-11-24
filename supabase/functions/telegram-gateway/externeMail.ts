// Mails an Adressen ohne Kundenakte (Wunsch aus der Nutzung, 23.11.2026): Ein Mitarbeiter wollte einem externen
// Termingast die Termindaten mailen, ohne vorher eine Akte anzulegen — mail_vorbereiten kannte nur Kunden.
// Jetzt nimmt es zusätzlich an_adressen („Name <adresse@firma.de>“ oder nur die Adresse). Der Ablauf bleibt
// gleich: vorbereiten → Fassung zeigen → senden erst nach seinem ausdrücklichen Ja (mail_senden).
// Gehört eine Adresse zu einer Akte, die er sehen darf, wird die Mail dort vermerkt (wie bei kunden_ids).
// Reine Helfer ohne Datenbank.

/** Höchstens so viele Adressen ohne Akte in einer Mail — für Rundschreiben gibt es die Auswahl über Kunden. */
export const HOECHSTENS_EXTERNE = 10

const GUELTIG = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/
const SAMMELADRESSE = /^(no-?reply|noreply|do-?not-?reply|mailer-daemon|postmaster)@/

export type ExterneAdresse = { email: string; name: string }

/** „Name <adresse>“, „<adresse>“ oder „adresse“ → Adresse (klein) und Name; ungültig → null. */
export function zerlegeAdresse(roh: string): ExterneAdresse | null {
  const s = String(roh ?? '').trim()
  if (!s) return null
  const klammer = s.match(/^(.*?)<\s*([^<>]+?)\s*>\s*$/)
  const email = (klammer ? klammer[2] : s).replace(/^mailto:/i, '').trim().toLowerCase()
  if (!GUELTIG.test(email)) return null
  const name = (klammer ? klammer[1] : '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ').trim()
  return { email, name: name.toLowerCase() === email ? '' : name.slice(0, 120) }
}

/** Text mit mehreren Adressen an Komma, Semikolon oder Zeilenumbruch trennen — nicht in "…" und nicht in <…>. */
function trenne(text: string): string[] {
  const teile: string[] = []
  let aktuell = ''
  let inAnfuehrung = false
  let inKlammer = false
  for (const z of text) {
    if (z === '"') inAnfuehrung = !inAnfuehrung
    else if (z === '<' && !inAnfuehrung) inKlammer = true
    else if (z === '>' && !inAnfuehrung) inKlammer = false
    if (!inAnfuehrung && !inKlammer && (z === ',' || z === ';' || z === '\n')) {
      teile.push(aktuell)
      aktuell = ''
    } else aktuell += z
  }
  teile.push(aktuell)
  return teile
}

/**
 * Liest an_adressen aus der Werkzeug-Eingabe (Liste oder ein Text mit Komma/Semikolon/Zeilen getrennt).
 * Ungültige Angaben, die eigene Absenderadresse und Sammeladressen (no-reply …) kommen in `fehler`;
 * doppelte Adressen zählen einmal.
 */
export function leseExterneAdressen(eingabe: unknown, eigene = ''): { adressen: ExterneAdresse[]; fehler: string[] } {
  const roh: string[] = Array.isArray(eingabe)
    ? eingabe.map((x) => String(x ?? ''))
    : typeof eingabe === 'string'
      ? trenne(eingabe)
      : []
  const adressen: ExterneAdresse[] = []
  const fehler: string[] = []
  const gesehen = new Set<string>()
  for (const teil of roh.map((t) => t.trim()).filter(Boolean)) {
    const a = zerlegeAdresse(teil)
    if (!a) fehler.push(`„${teil}" ist keine gültige E-Mail-Adresse`)
    else if (eigene && a.email === eigene.toLowerCase()) fehler.push(`${a.email} ist die eigene Absenderadresse`)
    else if (SAMMELADRESSE.test(a.email)) fehler.push(`${a.email} liest niemand (Sammeladresse)`)
    else if (!gesehen.has(a.email)) {
      gesehen.add(a.email)
      adressen.push(a)
    }
  }
  return { adressen, fehler }
}
