// Was der Mitarbeiter im CRM gerade geöffnet hat — damit der Assistent „diese Mail" oder „dieser Kunde"
// versteht. Übergeben werden nur Kennungen, nie Betreff oder Inhalt: Texte aus einer fremden Mail haben
// in einer Anweisung an den Assistenten nichts zu suchen.

export type OffenerKontext = { art: 'mail' | 'akte'; kennung: string }

let offeneMail: string | null = null

/** Vom gemeinsamen Postfach gesetzt, sobald dort eine Mail geöffnet ist (null beim Schließen/Verlassen). */
export function setzeOffeneMail(kennung: string | null): void {
  offeneMail = kennung
}

const AKTEN_PFAD = /^#\/(?:beratung|erben|betriebsuebergabe|betriebsformen|akademie|finanzierungen|immobilien)\/(?:kunden|mandanten|teilnehmer)\/([^/?#]+)/

export function offenerKontext(): OffenerKontext | null {
  const hash = window.location.hash
  if (offeneMail && hash.startsWith('#/postfach')) return { art: 'mail', kennung: offeneMail }
  const akte = hash.match(AKTEN_PFAD)
  if (akte) return { art: 'akte', kennung: decodeURIComponent(akte[1]) }
  return null
}
