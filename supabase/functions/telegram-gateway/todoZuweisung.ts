// Reine Helfer für To-dos über den Assistenten (Wünsche aus der Telegram-Nutzung vom 23.11.2026):
// - Aufgabe direkt einem Kollegen zuweisen: Der Name kam bisher nur als Text in „zuständig“, die Aufgabe blieb in
//   der eigenen Liste und der Kollege erfuhr nichts. findeKollege entscheidet, ob ein Name genau einen aktiven
//   Kollegen meint (sonst Rückfrage mit der Liste des Teams).
// - Aufgabe wirklich löschen statt nur abhaken: Gelöscht wird nur, wenn der Mitarbeiter selbst in seiner Nachricht
//   (oder als Antwort auf die Rückfrage in der Nachricht davor) ums Löschen/Entfernen gebeten hat — loeschWunsch.
// Ohne Datenbank, damit sie sich ohne Netz prüfen lassen.

function einfach(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type KollegenTreffer = { art: 'eindeutig'; name: string } | { art: 'mehrdeutig'; namen: string[] } | { art: 'keiner' }

/**
 * Welcher Kollege ist mit der Angabe gemeint? Zuerst genau: ganzer Name, Vorname, Nachname oder „Initiale.Nachname“
 * (wie ordneZu in _shared/aufgabenKern.ts). Passt so niemand, ein Teil des Namens ab drei Buchstaben
 * (Hörfehler/Kurzformen aus Sprachnachrichten). Mehrere Treffer → mehrdeutig (nachfragen), nie raten.
 */
export function findeKollege(angabe: string, namen: readonly string[]): KollegenTreffer {
  const t = einfach(angabe).replace(/^(herr|hr|frau|fr)\.? /, '')
  if (!t) return { art: 'keiner' }
  const genau = namen.filter((name) => {
    const n = einfach(name)
    const w = n.split(' ')
    const vor = w[0]
    const nach = w[w.length - 1]
    if (t === n || t === vor || (w.length > 1 && t === nach)) return true
    const initial = t.match(/^([a-z])\.? ?([a-z]+)$/)
    return !!initial && w.length > 1 && initial[1] === vor[0] && initial[2] === nach
  })
  const eindeutigOderNicht = (liste: string[]): KollegenTreffer | null =>
    liste.length === 1 ? { art: 'eindeutig', name: liste[0] } : liste.length > 1 ? { art: 'mehrdeutig', namen: [...new Set(liste)] } : null
  const a = eindeutigOderNicht(genau)
  if (a) return a
  if (t.length < 3) return { art: 'keiner' }
  const teil = namen.filter((name) => einfach(name).includes(t))
  return eindeutigOderNicht(teil) ?? { art: 'keiner' }
}

/** Fehlertext, wenn ein Kollege nicht eindeutig ist — mit den aktiven Kollegen zur Auswahl. */
export function kollegeUnklar(angabe: string, treffer: KollegenTreffer, team: readonly string[]): string {
  const auswahl = treffer.art === 'mehrdeutig' ? `Passen würden: ${treffer.namen.join(', ')}. ` : ''
  return `„${angabe}" ist kein eindeutiger Kollege. ${auswahl}Aktive Kollegen: ${team.join(', ')}. Frag kurz nach, wer gemeint ist.`
}

// Markierungen von Eingängen, die nicht der Mitarbeiter getippt hat (Datei, weitergeleitete Nachricht, Systemmeldung).
const NICHT_GETIPPT = /^\[(Datei-Eingang|Weitergeleitete Nachricht|Systemmeldung)/

// lösch…, entfern…, streich…, „weg“, „raus“, „runter“, „von/aus der Liste“, „delete“.
const LOESCH_WORT = /l(oe|ö)sch|entfern|\bstreich|\bgestrichen|\bweg\b|\bweg(machen|nehmen|haben)\b|\braus\b|\brausnehmen|\brunter\b|\b(von|aus) (der|meiner|deiner|seiner|unserer) (to-?do-?|aufgaben)?liste\b|\bdelete\b/i

/**
 * Hat der Mitarbeiter ausdrücklich ums Löschen gebeten? Geprüft werden seine aktuelle Nachricht und — für die
 * Antwort „ja“ auf eine Rückfrage — seine Nachricht davor. Dateien, weitergeleitete Nachrichten und
 * Systemmeldungen zählen nie (darin kann „löschen“ stehen, ohne dass er es will).
 */
export function loeschWunsch(texte: readonly (string | null | undefined)[]): boolean {
  return texte.some((roh) => {
    const text = String(roh ?? '').replace(/^\[Sprachnachricht[^\]]*\]\s*/, '')
    return !!text.trim() && !NICHT_GETIPPT.test(text) && LOESCH_WORT.test(text)
  })
}

/** Text der Telegram-Mitteilung an den Kollegen, dem ein To-do zugewiesen wurde. */
export function zuweisungsMitteilung(o: { von: string; aufgabe: string; faellig?: string | null; liste?: string | null; neu: boolean }): string {
  const bis = o.faellig ? ` (bis ${o.faellig})` : ''
  const wo = o.liste ? `Es steht in der ${o.liste}, zuständig bist du.` : 'Es steht in deiner To-do-Liste im CRM.'
  return `${o.neu ? 'Neues To-do' : 'To-do'} von ${o.von} für dich: „${o.aufgabe}"${bis}. ${wo}`
}

/** Hängt „(von X)“ an, außer es steht schon ein Absender in Klammern am Ende. */
export function mitAbsender(aufgabe: string, von: string): string {
  return /\(von [^()]+\)\s*$/.test(aufgabe) ? aufgabe : `${aufgabe} (von ${von})`
}
