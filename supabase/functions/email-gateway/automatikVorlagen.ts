// Bearbeitbare Texte der automatischen Mails an Kunden und Termin-Gäste (24.11.2026, Seite „Automatische Nachrichten“).
//
// Bis heute standen diese Texte fest im Programm (kalender.ts, buchung.ts, unterschrift.ts). Jetzt liegen sie als
// Zeilen in mail_vorlagen (supabase/sql/2026-11-24_automatik_vorlagen.sql) und sind im CRM bearbeitbar. Die
// Vorgabe-Texte hier sind Wort für Wort die bisherigen festen Texte, nur mit Platzhaltern {{Name}} (Schreibweise wie
// bei den Immobilien-Nachrichten, auto_nachricht_fuellen). Fehlt die Zeile, ist ihr Text leer oder lässt sie sich nicht
// lesen, geht der bisherige feste Text hinaus — der Versand hängt nie an der Vorlage.
//
// Regel beim Einsetzen: Eine Zeile, die nur aus Platzhaltern besteht, die alle leer sind, fällt ganz weg (z. B. eine
// Zeile „{{Ort}}“ ohne Ort). Unbekannte Platzhalter bleiben stehen, damit Tippfehler auffallen.

// deno-lint-ignore no-explicit-any
type Db = any

export type MailText = { betreff: string; text: string }

export const VORLAGE = {
  gastEinladung: 'mv-auto-gast-einladung',
  gastAenderung: 'mv-auto-gast-aenderung',
  gastAbsage: 'mv-auto-gast-absage',
  gastErinnerung: 'mv-auto-gast-erinnerung',
  buchungBestaetigung: 'mv-auto-buchung-bestaetigung',
  unterschriftKopie: 'mv-auto-unterschrift-kopie',
} as const

export type VorlageId = (typeof VORLAGE)[keyof typeof VORLAGE]

const GRUSS = 'Mit freundlichen Grüßen\n{{Absender}}\nAndreas Mayer Holding'

/** Vorgabe-Texte (= bisherige feste Texte). Aus genau diesen Werten ist die SQL-Datei erzeugt. */
export const STANDARD_VORLAGEN: Record<VorlageId, MailText & { name: string }> = {
  [VORLAGE.gastEinladung]: {
    name: 'Termin-Einladung an Gäste (automatisch)',
    betreff: 'Einladung: {{Titel}} – {{Zeit}}',
    text: `{{Anrede}}\n\nhiermit laden wir Sie zu folgendem Termin ein:\n\n{{Eckdaten}}\n\nMit der angehängten Kalenderdatei können Sie den Termin in Ihren Kalender übernehmen. Sollte der Termin für Sie nicht passen, antworten Sie gern einfach auf diese Mail.\n\n${GRUSS}`,
  },
  [VORLAGE.gastAenderung]: {
    name: 'Termin geändert, an Gäste (automatisch)',
    betreff: 'Geänderter Termin: {{Titel}} – {{Zeit}}',
    text: `{{Anrede}}\n\nunser gemeinsamer Termin hat sich geändert. Hier die aktuellen Angaben:\n\n{{Eckdaten}}\n\nMit der angehängten Kalenderdatei können Sie Ihren Kalender aktualisieren.\n\n${GRUSS}`,
  },
  [VORLAGE.gastAbsage]: {
    name: 'Termin abgesagt, an Gäste (automatisch)',
    betreff: 'Abgesagt: {{Titel}} – {{Zeit}}',
    text: `{{Anrede}}\n\nleider müssen wir den folgenden Termin absagen:\n\n{{Eckdaten}}\n\nMit der angehängten Kalenderdatei können Sie den Termin aus Ihrem Kalender entfernen. Für einen neuen Termin melden wir uns gern bei Ihnen.\n\n${GRUSS}`,
  },
  [VORLAGE.gastErinnerung]: {
    name: 'Terminerinnerung an Gäste (automatisch)',
    betreff: 'Erinnerung: {{Titel}} – {{Zeit}}',
    text: `{{Anrede}}\n\nwir möchten Sie an unseren {{Wann}} erinnern:\n\n{{Eckdaten}}\n\nSollte etwas dazwischengekommen sein, antworten Sie gern einfach auf diese Mail.\n\n${GRUSS}`,
  },
  [VORLAGE.buchungBestaetigung]: {
    name: 'Terminbestätigung nach Online-Buchung (automatisch)',
    betreff: 'Terminbestätigung: {{Titel}} am {{Datum}} um {{Uhrzeit}} Uhr',
    text: `{{Anrede}}\n\nvielen Dank für Ihre Buchung. Hiermit bestätigen wir Ihren Termin:\n\n{{Eckdaten}}\n\nIm Anhang finden Sie den Termin als Kalenderdatei. Mit einem Klick darauf können Sie ihn in Ihren Kalender übernehmen.\n\nFalls Sie den Termin absagen oder verschieben möchten, antworten Sie einfach auf diese E-Mail oder rufen Sie uns an.\n\n${GRUSS}`,
  },
  [VORLAGE.unterschriftKopie]: {
    name: 'Kopie des unterschriebenen Dokuments (automatisch)',
    betreff: 'Ihre unterschriebene {{Dokument}}',
    text: '{{Anrede}}\n\nvielen Dank für Ihre Unterschrift. Im Anhang finden Sie „{{Dokument}}“ mit Ihrer elektronischen Unterschrift für Ihre Unterlagen.\n\nMit freundlichen Grüßen\nAndreas Mayer Holding',
  },
}

/** Platzhalter je Vorlage (für die Seite und den Bericht). */
export const VORLAGE_PLATZHALTER: Record<VorlageId, string[]> = {
  [VORLAGE.gastEinladung]: ['Anrede', 'Name', 'Titel', 'Zeit', 'Ort', 'Eckdaten', 'Absender'],
  [VORLAGE.gastAenderung]: ['Anrede', 'Name', 'Titel', 'Zeit', 'Ort', 'Eckdaten', 'Absender'],
  [VORLAGE.gastAbsage]: ['Anrede', 'Name', 'Titel', 'Zeit', 'Ort', 'Eckdaten', 'Absender'],
  [VORLAGE.gastErinnerung]: ['Anrede', 'Name', 'Titel', 'Zeit', 'Ort', 'Eckdaten', 'Absender', 'Wann'],
  [VORLAGE.buchungBestaetigung]: ['Anrede', 'Name', 'Titel', 'Tag', 'Datum', 'Uhrzeit', 'Bis', 'Zeit', 'Ort', 'Hinweis', 'Eckdaten', 'Absender'],
  [VORLAGE.unterschriftKopie]: ['Anrede', 'Name', 'Dokument'],
}

const PLATZHALTER = /\{\{\s*([A-Za-zÄÖÜäöüß0-9_-]+)\s*\}\}/g
const NUR_PLATZHALTER = /^\s*(\{\{\s*[A-Za-zÄÖÜäöüß0-9_-]+\s*\}\}\s*)+$/

/** Setzt die Platzhalter ein (ein Durchgang — Werte mit „{{…}}“ werden nicht noch einmal ersetzt). */
export function fuellePlatzhalter(vorlage: string, werte: Record<string, string>): string {
  return String(vorlage ?? '')
    .split('\n')
    .flatMap((zeile) => {
      if (NUR_PLATZHALTER.test(zeile)) {
        const namen = [...zeile.matchAll(PLATZHALTER)].map((m) => m[1])
        if (namen.every((n) => n in werte && String(werte[n] ?? '') === '')) return []
      }
      return [zeile.replace(PLATZHALTER, (ganz, name: string) => (name in werte ? String(werte[name] ?? '') : ganz))]
    })
    .join('\n')
}

export function anredeText(name: string | null | undefined): string {
  const n = String(name ?? '').trim()
  return n ? `Guten Tag ${n},` : 'Guten Tag,'
}

/** Werte für die Gast-Mails (Einladung, Änderung, Absage, Erinnerung). `zeit` = zeitraumText(termin). */
export function gastWerte(w: { titel: string; zeit: string; ort?: string | null; gastName?: string | null; absender: string; vorlauf?: number }): Record<string, string> {
  const ort = String(w.ort ?? '')
  return {
    Anrede: w.gastName ? `Guten Tag ${w.gastName},` : 'Guten Tag,',
    Name: String(w.gastName ?? ''),
    Titel: w.titel,
    Zeit: w.zeit,
    Ort: ort,
    Eckdaten: [w.titel, w.zeit, ort ? `Ort: ${ort}` : ''].filter(Boolean).join('\n'),
    Absender: w.absender,
    Wann: (w.vorlauf ?? 1440) >= 1440 ? 'bevorstehenden Termin' : 'Termin in einer Stunde',
  }
}

/** Werte für die Buchungsbestätigung. `tag` wie „Dienstag, 01.12.2026“, `von`/`bis` wie „14:00“. */
export function buchungWerte(w: { name: string; titel: string; tag: string; von: string; bis: string; ort?: string | null; hinweis?: string | null; absender: string }): Record<string, string> {
  const ort = String(w.ort ?? '')
  const hinweis = String(w.hinweis ?? '')
  const zeit = `${w.tag}, ${w.von}–${w.bis} Uhr (deutsche Zeit)`
  return {
    Anrede: anredeText(w.name),
    Name: w.name,
    Titel: w.titel,
    Tag: w.tag,
    Datum: w.tag.replace(/^[^,]+,\s*/, ''),
    Uhrzeit: w.von,
    Bis: w.bis,
    Zeit: zeit,
    Ort: ort,
    Hinweis: hinweis,
    Eckdaten: [w.titel, zeit, ort ? `Ort: ${ort}` : null, `Gesprächspartner: ${w.absender}`, hinweis ? `\n${hinweis}` : null].filter((z) => z !== null).join('\n'),
    Absender: w.absender,
  }
}

/** Werte für die Kopie des unterschriebenen Dokuments. */
export function unterschriftWerte(w: { anName: string; dokument: string }): Record<string, string> {
  return { Anrede: anredeText(w.anName), Name: String(w.anName ?? '').trim(), Dokument: w.dokument }
}

/** Füllt eine geladene Vorlage; ohne Vorlage der bisherige feste Text (`ersatz`). */
export function rendere(vorlage: MailText | null, werte: Record<string, string>, ersatz: () => MailText): MailText {
  if (!vorlage) return ersatz()
  // Ein Betreff ist eine Zeile: Zeilenumbrüche (z. B. aus {{Eckdaten}}) werden zu Leerzeichen.
  return { betreff: fuellePlatzhalter(vorlage.betreff, werte).replace(/\s*\n\s*/g, ' '), text: fuellePlatzhalter(vorlage.text, werte) }
}

// ---------- Laden (mit kurzem Zwischenspeicher) ----------

const MERKEN_MS = 60_000
const merker = new Map<string, { vorlage: MailText | null; bis: number }>()

/** Nur für Tests: Zwischenspeicher leeren. */
export function vergissVorlagen(): void {
  merker.clear()
}

/**
 * Vorlage aus mail_vorlagen. null = keine nutzbare Vorlage (Zeile fehlt, Text leer, Lesefehler) → fester Text.
 * Leerer Betreff → Betreff der Vorgabe. Höchstens eine Minute zwischengespeichert. Wirft nie.
 */
export async function ladeMailVorlage(admin: Db, id: VorlageId, jetzt = Date.now()): Promise<MailText | null> {
  const gemerkt = merker.get(id)
  if (gemerkt && gemerkt.bis > jetzt) return gemerkt.vorlage
  try {
    const { data, error } = await admin.from('mail_vorlagen').select('betreff, text').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message ?? String(error))
    const text = typeof data?.text === 'string' && data.text.trim() ? data.text : ''
    const betreff = typeof data?.betreff === 'string' && data.betreff.trim() ? data.betreff : STANDARD_VORLAGEN[id].betreff
    const vorlage = text ? { betreff, text } : null
    merker.set(id, { vorlage, bis: jetzt + MERKEN_MS })
    return vorlage
  } catch (err) {
    console.error('Mail-Vorlage nicht lesbar, fester Text', id, err instanceof Error ? err.message : err)
    return null
  }
}
