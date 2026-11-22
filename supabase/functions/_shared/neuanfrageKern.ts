// Neuanfragen sichten (22.11.2026): reiner Kern ohne Importe und ohne Deno- oder Browser-Funktionen —
// benutzt von der Seite „Neuanfragen sichten“ im CRM (src/pages/neuanfragen/) und von der Aktion
// `neuanfrage_einschaetzung` im email-gateway (neuanfrageTriage.ts).
//
// Gespeichert wird alles in kunden.triage_vorschlag (jsonb), geschrieben NUR vom Server:
//   { vorschlag?:    Einschätzung der KI (ein Satz + vorgeschlagene Handlung), mit `stand`, damit sie neu
//                    entsteht, sobald neue Mails, Verlaufseinträge oder Dokumente dazukommen,
//     entscheidung?: was ein Mitarbeiter beim Sichten entschieden hat, mit dem Stand (Status) der Akte zu
//                    dem Zeitpunkt — wird die Akte später wieder auf diesen Stand gesetzt, zählt sie nicht neu,
//     spaeter?:      zurückgestellt bis zu einem Tag }
// Der Status selbst (Erstkontakt, verloren …) wird wie in der Projekt-Checkliste über den normalen Weg der
// Seite gespeichert (dispatch → crmSync, nur geänderte Felder).

export type TriageAktion = 'qualifizieren' | 'archivieren' | 'unklar'
export type ArchivGrund = 'spam' | 'kein_kundenanliegen' | 'kein_interesse'
export type EntscheidungsArt = 'qualifiziert' | 'archiviert' | 'gesichtet'

export type TriageVorschlag = {
  /** Ein Satz in einfachem Deutsch. */
  satz: string
  aktion: TriageAktion
  /** Nur bei aktion „archivieren“. */
  grund?: ArchivGrund
  /** Kundenakten-Schlüssel, wenn die Anfrage eher in einen anderen Bereich gehört. */
  bereichVorschlag?: string
  /** Stand der Grundlage (Mails|Verlauf|Dokumente), aus der die Einschätzung entstand. */
  stand: string
  /** ISO-Zeitpunkt. */
  am: string
}

export type TriageEntscheidung = { art: EntscheidungsArt; status: string; am: string; von: string; grund?: ArchivGrund }
export type TriageSpaeter = { bis: string; am: string; von: string }
export type TriageDaten = { vorschlag?: TriageVorschlag; entscheidung?: TriageEntscheidung; spaeter?: TriageSpaeter }

export const AKTIONEN: readonly TriageAktion[] = ['qualifizieren', 'archivieren', 'unklar']
export const ARCHIV_GRUENDE: readonly ArchivGrund[] = ['spam', 'kein_kundenanliegen', 'kein_interesse']
export const ENTSCHEIDUNGS_ARTEN: readonly EntscheidungsArt[] = ['qualifiziert', 'archiviert', 'gesichtet']
/** Kundenakten-Bereiche, in die eine Neuanfrage gehören kann (ohne Privat). */
export const BEREICHE: readonly string[] = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'immobilienkunden']
export const SAMMELAKTEN: readonly string[] = ['k_eingang_ungeklaert', 'k_intern_holding']

export const AKTION_TEXT: Record<TriageAktion, string> = {
  qualifizieren: 'echte Anfrage – Erstkontakt aufnehmen',
  archivieren: 'kein Kunde – archivieren',
  unklar: 'unklar – bitte selbst ansehen',
}
export const GRUND_TEXT: Record<ArchivGrund, string> = {
  spam: 'Werbung oder Spam',
  kein_kundenanliegen: 'kein Kundenanliegen (Lieferant, Behörde, Bestandskontakt …)',
  kein_interesse: 'kein Interesse',
}

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

const istDatum = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const text = (v: unknown, n: number): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

/** Liest einen gespeicherten Vorschlag; null, wenn er unbrauchbar ist. */
export function leseVorschlag(roh: unknown): TriageVorschlag | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Zeile
  const aktion = AKTIONEN.includes(r.aktion) ? (r.aktion as TriageAktion) : null
  const satz = text(r.satz, 240)
  if (!aktion || !satz) return null
  return {
    satz,
    aktion,
    ...(aktion === 'archivieren' && ARCHIV_GRUENDE.includes(r.grund) ? { grund: r.grund as ArchivGrund } : {}),
    ...(typeof r.bereichVorschlag === 'string' && BEREICHE.includes(r.bereichVorschlag) ? { bereichVorschlag: r.bereichVorschlag } : {}),
    stand: typeof r.stand === 'string' ? r.stand : '',
    am: typeof r.am === 'string' ? r.am : '',
  }
}

/** Liest kunden.triage_vorschlag tolerant (fehlende oder kaputte Teile fallen weg). */
export function leseTriage(roh: unknown): TriageDaten {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return {}
  const r = roh as Zeile
  const aus: TriageDaten = {}
  const v = leseVorschlag(r.vorschlag)
  if (v) aus.vorschlag = v
  const e = r.entscheidung as Zeile | undefined
  if (e && typeof e === 'object' && ENTSCHEIDUNGS_ARTEN.includes(e.art) && typeof e.status === 'string') {
    aus.entscheidung = {
      art: e.art,
      status: e.status,
      am: typeof e.am === 'string' ? e.am : '',
      von: typeof e.von === 'string' ? e.von : '',
      ...(ARCHIV_GRUENDE.includes(e.grund) ? { grund: e.grund as ArchivGrund } : {}),
    }
  }
  const s = r.spaeter as Zeile | undefined
  if (s && typeof s === 'object' && istDatum(s.bis)) aus.spaeter = { bis: s.bis, am: typeof s.am === 'string' ? s.am : '', von: typeof s.von === 'string' ? s.von : '' }
  return aus
}

/** Stand der Grundlage einer Einschätzung: ändert er sich, wird neu eingeschätzt. */
export function triageStand(x: { mails: number; verlauf: number; dokumente: number }): string {
  return `${x.mails}|${x.verlauf}|${x.dokumente}`
}

export type Lage = 'offen' | 'zurueckgestellt' | 'entschieden'

/**
 * Wo steht eine Akte der ersten Stufe beim Sichten? Entschieden, wenn beim jetzigen Status schon jemand
 * entschieden hat (z. B. „gesichtet“ bei einer Erben-Akte, die im Erstkontakt bleibt); zurückgestellt bis
 * zum gemerkten Tag (an dem Tag selbst ist sie wieder offen).
 */
export function lageVon(status: string, t: TriageDaten, heute: string): Lage {
  if (t.entscheidung && t.entscheidung.status === status) return 'entschieden'
  if (t.spaeter && t.spaeter.bis > heute) return 'zurueckgestellt'
  return 'offen'
}

export type HerkunftArt = 'mail' | 'telegram' | 'assistent' | 'formular' | 'altbestand' | 'hand'
export const HERKUNFT_TEXT: Record<HerkunftArt, string> = {
  mail: 'aus einer Mail',
  telegram: 'per Telegram',
  assistent: 'vom Assistenten',
  formular: 'über ein Formular',
  altbestand: 'aus einem Altbestand übernommen',
  hand: 'von Hand angelegt',
}

/** Ältester Verlaufseintrag (der Verlauf steht meist neueste zuerst, ist aber nicht immer sortiert). */
function aeltester(activities: unknown): Zeile | null {
  const liste = (Array.isArray(activities) ? activities : []).filter((a) => a && typeof a === 'object') as Zeile[]
  if (liste.length === 0) return null
  return liste.reduce((alt, a) => (String(a.date ?? '') < String(alt.date ?? '') ? a : alt), liste[liste.length - 1])
}

/** Woher kommt die Akte? Aus dem ältesten Verlaufseintrag geschlossen. */
export function herkunftVon(activities: unknown): HerkunftArt {
  const a = aeltester(activities)
  if (!a) return 'hand'
  const wer = String(a.user ?? '')
  const was = String(a.text ?? '')
  if (/KI-Lead-Analyse/i.test(wer) || /aus eingehender Mail|E-Mail-Analyse/i.test(was)) return 'mail'
  if (/^(Import|Übernahme)$/i.test(wer.trim())) return 'altbestand'
  if (/Formular/i.test(wer)) return 'formular'
  if (/per Telegram/i.test(was)) return 'telegram'
  if (/^Assistent/i.test(wer)) return 'assistent'
  return 'hand'
}

/** Angelegt am (JJJJ-MM-TT): Datum des ältesten Verlaufseintrags, sonst der Ersatzwert. */
export function angelegtAm(activities: unknown, ersatz = ''): string {
  const d = String(aeltester(activities)?.date ?? '').slice(0, 10)
  return istDatum(d) ? d : ersatz.slice(0, 10)
}

/**
 * Macht aus der KI-Antwort einen gültigen Vorschlag. Unbekannte Handlung → „unklar“, Grund nur beim
 * Archivieren, Bereich nur, wenn er bekannt ist und vom jetzigen abweicht.
 */
export function bereinigeVorschlag(roh: unknown, x: { bereich: string; stand: string; am: string }): TriageVorschlag | null {
  if (!roh || typeof roh !== 'object') return null
  const r = roh as Zeile
  const satz = text(r.satz, 240)
  if (!satz) return null
  const aktion: TriageAktion = AKTIONEN.includes(r.aktion) ? r.aktion : 'unklar'
  const grund: ArchivGrund | undefined = aktion === 'archivieren' ? (ARCHIV_GRUENDE.includes(r.grund) ? r.grund : 'kein_kundenanliegen') : undefined
  const b = typeof r.bereich === 'string' ? r.bereich.trim() : ''
  return {
    satz,
    aktion,
    ...(grund ? { grund } : {}),
    ...(b && BEREICHE.includes(b) && b !== x.bereich ? { bereichVorschlag: b } : {}),
    stand: x.stand,
    am: x.am,
  }
}

/** Gültiges Datum für „Später“: nach heute und höchstens ein Jahr voraus. */
export function istGueltigesSpaeter(bis: unknown, heute: string): bis is string {
  if (!istDatum(bis) || bis <= heute) return false
  const grenze = new Date(`${heute}T12:00:00Z`)
  grenze.setUTCFullYear(grenze.getUTCFullYear() + 1)
  return bis <= grenze.toISOString().slice(0, 10)
}
