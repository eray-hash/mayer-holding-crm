// Bonitätseinschätzung eines Kunden — erste Stufe ohne Vertrag mit einer Auskunftei (Schufa,
// Creditreform, CRIF). Aufgerufen über die Aktion `bonitaet_pruefen` (nur mit eigenem Login); die
// Oberfläche dazu ist src/components/BonitaetSection.tsx.
//
// Grundlage sind ausschließlich:
// - Unterlagen, die der Kunde selbst gegeben hat und die in seiner Akte liegen (Schufa-Selbstauskunft,
//   BWA, Jahresabschluss, Kontoauszüge, Gehaltsabrechnungen …) samt der ausgefüllten Selbstauskunft.
//   Verwendet wird, was der Server schon gelesen hat (Tabelle dokument_inhalte); höchstens fünf noch
//   ungelesene, passende Unterlagen werden zum Lesen angestoßen und zählen erst beim nächsten Lauf.
// - NUR bei Firmen: kostenlose öffentliche Registerangaben (Handelsregister, Insolvenzbekanntmachungen,
//   veröffentlichte Jahresabschlüsse) über eine Websuche mit höchstens fünf Suchen.
//
// Rechtliche Leitplanke: Über Privatpersonen wird NIE im Internet gesucht. Ob Person oder Firma, schlägt
// das Programm aus der Akte vor (Rechtsform im Firmennamen); die Mitarbeiterin bestätigt oder korrigiert
// das vor dem Start. Auch bei einer Firma geht nur der Firmenname in die Suche — nie Name oder E-Mail der
// Ansprechperson. Steht als Firma nur der Name der Person in der Akte, wird gar nicht gesucht.
//
// Das Ergebnis ist eine interne Einschätzung, keine Auskunft einer Auskunftei. Es steht als ein
// JSON-Objekt in kunden.bonitaet; die Spalte schreibt nur der Server.
//
// Keine Importe aus index.ts: Datenbank-Zugang und die gemeinsamen Helfer kommen als Parameter.

// deno-lint-ignore no-explicit-any
type Db = any

export type KundenArt = 'person' | 'firma'
export type Ampel = 'gruen' | 'gelb' | 'rot' | 'nicht_beurteilbar'

export type BonitaetPunkt = {
  text: string
  /** Name der Unterlage, „Selbstauskunft" oder die Adresse der öffentlichen Quelle. */
  quelle: string
  url?: string
  art: 'dokument' | 'selbstauskunft' | 'oeffentlich'
}

export type BonitaetDokument = {
  name: string
  url?: string
  stand: 'verwendet' | 'wird_eingelesen' | 'nicht_lesbar' | 'nicht_verwendet'
  hinweis?: string
}

/** So steht das Ergebnis in kunden.bonitaet (gleiche Form wie Bonitaetseinschaetzung in src/types/index.ts). */
export type Bonitaetseinschaetzung = {
  version: 1
  ampel: Ampel
  begruendung: string
  positiv: BonitaetPunkt[]
  negativ: BonitaetPunkt[]
  fehlt: string[]
  art: KundenArt
  artErkannt: KundenArt
  artGrund: string
  webRecherche: 'nicht_erlaubt' | 'ok' | 'fehlgeschlagen' | 'kein_firmenname'
  dokumente: BonitaetDokument[]
  selbstauskunftVerwendet: boolean
  erstelltAm: string
  erstelltVon: string
}

export type BonitaetErgebnis =
  | { ok: true; bonitaet: Bonitaetseinschaetzung; angestossen: number }
  | { ok: false; fehler: string; status: number }

type DokumentRef = { url: string; name: string; typ?: string }
type AkteDokument = { id?: string; name: string; typ?: string; datum?: string; url?: string }

export type BonitaetHelfer = {
  /** callClaudeResearch aus index.ts (Websuche, Verbrauch wird dort gemessen). */
  callClaudeResearch: (prompt: string, opts: { model: 'claude-haiku-5-5'; maxSearches: number; maxTokens?: number; timeoutMs?: number }) => Promise<string>
  /** callClaudeTool aus index.ts (strukturierte Antwort, Verbrauch wird dort gemessen). */
  callClaudeTool: <T>(
    prompt: string,
    tool: { name: string; description: string; input_schema: Record<string, unknown> },
    maxTokens: number,
    model: 'claude-sonnet-5-5',
    toolChoice: 'tool' | 'auto',
    timeoutMs: number,
  ) => Promise<T>
  dokumentSchluessel: (url: string) => string
  lesbareArt: (name: string, typ?: string) => string | null
  stosseDokumentLesenAn: (ref: DokumentRef) => Promise<void>
  /** Wie lange dieser Worker noch sicher lebt (Millisekunden). */
  restMs: () => number
}

// ---------------------------------------------------------------------------------------------------
// Person oder Firma
// ---------------------------------------------------------------------------------------------------

// Rechtsformen. Kurze Kürzel nur in genau dieser Schreibweise (sonst träfe „ag" jedes Wort mit „ag").
const RECHTSFORM_KUERZEL = ['GmbH', 'gGmbH', 'mbH', 'UG', 'AG', 'KG', 'KGaA', 'OHG', 'oHG', 'GbR', 'eG', 'SE', 'PartG', 'PartGmbB', 'Ltd', 'Inc', 'LLC', 'Co. KG', 'e.K.', 'e.Kfm.', 'e.Kfr.', 'e. K.', 'e.V.', 'e. V.']
const RECHTSFORM_WOERTER = /(gesellschaft|holding|stiftung|genossenschaft|haftungsbeschr[aä]nkt|aktiengesellschaft|kommanditgesellschaft|verein)/i

function rechtsformIn(text: string): string | null {
  const t = ` ${text.replace(/\s+/g, ' ')} `
  for (const k of RECHTSFORM_KUERZEL) {
    const i = t.indexOf(k)
    if (i < 0) continue
    const vor = t[i - 1]
    const nach = t[i + k.length]
    const grenze = (z: string | undefined) => !z || !/[A-Za-z0-9ÄÖÜäöüß]/.test(z)
    if (grenze(vor) && grenze(nach)) return k.trim()
  }
  const w = text.match(RECHTSFORM_WOERTER)
  return w ? w[0] : null
}

function vergleichsName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')
}

/** Ist im Feld „Firma" nur der Name der Person eingetragen (oder nichts)? */
export function firmaIstNurPersonenname(firma: string, ansprechpartner: string): boolean {
  const f = vergleichsName(firma)
  if (!f) return true
  const p = vergleichsName(ansprechpartner)
  if (p && (f === p || f.replace(/^(herr|frau)/, '') === p)) return true
  // „Privat", „Privatperson", „Privatkunde" u. ä.
  return /^privat/.test(f)
}

/** Vorschlag, ob die Akte eine Privatperson oder eine Firma beschreibt — die Mitarbeiterin kann ihn ändern. */
export function erkenneKundenArt(firma: string, ansprechpartner: string): { art: KundenArt; grund: string } {
  const f = String(firma ?? '').trim()
  const rf = f ? rechtsformIn(f) : null
  if (rf) return { art: 'firma', grund: `Rechtsform „${rf}" im Firmennamen` }
  if (firmaIstNurPersonenname(f, ansprechpartner)) return { art: 'person', grund: f ? 'Im Feld „Firma" steht nur der Name der Person' : 'Kein Firmenname in der Akte' }
  // Ein Firmenname ohne erkennbare Rechtsform (z. B. ein Einzelunternehmen): im Zweifel Person — dann
  // wird nicht im Internet gesucht. Die Mitarbeiterin kann auf „Firma" umstellen.
  return { art: 'person', grund: 'Keine Rechtsform im Firmennamen erkannt — bitte prüfen' }
}

/** Darf im Internet gesucht werden? Nur bei einer Firma und nur mit einem echten Firmennamen. */
export function rechercheErlaubt(art: KundenArt, firma: string, ansprechpartner: string): 'ja' | 'nicht_erlaubt' | 'kein_firmenname' {
  if (art !== 'firma') return 'nicht_erlaubt'
  if (firmaIstNurPersonenname(firma, ansprechpartner)) return 'kein_firmenname'
  return 'ja'
}

// ---------------------------------------------------------------------------------------------------
// Unterlagen auswählen
// ---------------------------------------------------------------------------------------------------

export type Kategorie = 'schufa' | 'bwa' | 'abschluss' | 'einkommen' | 'konto' | 'vermoegen' | 'selbstauskunft'

// Reihenfolge = Vorrang. Geprüft wird der Dateiname, klein geschrieben und mit Leerzeichen statt
// Trennzeichen (sonst scheitert z. B. „BWA_2025.pdf").
const KATEGORIEN: { id: Kategorie; muster: RegExp; hoechstens: number }[] = [
  { id: 'schufa', muster: /schufa|bonit[aä]t|creditreform|crif|b[uü]rgel|auskunftei|datenkopie/, hoechstens: 2 },
  { id: 'bwa', muster: / bwa |betriebswirtschaftliche auswertung|summen (und |u )?salden| susa /, hoechstens: 2 },
  { id: 'abschluss', muster: /jahresabschluss|bilanz| guv |gewinn (und |u )?verlust| e[uü]r |einnahmen? ?[uü]berschuss/, hoechstens: 2 },
  { id: 'einkommen', muster: /gehalt|lohn|verdienst|bez[uü]ge|einkommen|rentenbescheid|rentenanpassung|steuerbescheid/, hoechstens: 3 },
  { id: 'konto', muster: /kontoausz|kontoums[aä]tz|ums[aä]tzliste|umsatzliste|finanzstatus|kontostand/, hoechstens: 3 },
  { id: 'vermoegen', muster: /verm[oö]gen|eigenkapital|depot|darlehen|kredit|finanzierungsbest[aä]tigung|liquidit[aä]t/, hoechstens: 2 },
  { id: 'selbstauskunft', muster: /selbstauskunft/, hoechstens: 1 },
]

// Unterlagen über Gesundheit, Familie, Herkunft und Ausweise werden nie verwendet — auch wenn ihr Name
// sonst passen würde (z. B. „Krankenkasse Beitragsbescheid").
const PRIVATE_UNTERLAGE = /arzt|[aä]rztlich|kranken|attest|diagnose|befund|gesundheit|pflegegrad|reha|therapie|geburtsurkunde|heiratsurkunde|eheurkunde|scheidung|sterbeurkunde|testament|erbschein|personalausweis|reisepass|ausweis|f[uü]hrerschein|meldebescheinigung|aufenthalt/

export const HOECHSTENS_UNTERLAGEN = 10
export const HOECHSTENS_ANSTOSSEN = 5

function normalerName(name: string): string {
  return ` ${String(name ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ')} `
}

export function kategorieVon(name: string): Kategorie | null {
  const n = normalerName(name)
  if (PRIVATE_UNTERLAGE.test(n)) return null
  return KATEGORIEN.find((k) => k.muster.test(n))?.id ?? null
}

/** Die passenden Unterlagen der Akte, wichtigste zuerst, je Art die neuesten; höchstens HOECHSTENS_UNTERLAGEN. */
export function waehleUnterlagen(dokumente: AkteDokument[]): { dokument: AkteDokument; kategorie: Kategorie }[] {
  const mitUrl = (Array.isArray(dokumente) ? dokumente : []).filter((d) => d && typeof d.name === 'string' && typeof d.url === 'string' && d.url)
  const auswahl: { dokument: AkteDokument; kategorie: Kategorie }[] = []
  for (const k of KATEGORIEN) {
    const passend = mitUrl
      .filter((d) => kategorieVon(d.name) === k.id)
      .sort((a, b) => String(b.datum ?? '').localeCompare(String(a.datum ?? '')))
      .slice(0, k.hoechstens)
    for (const d of passend) auswahl.push({ dokument: d, kategorie: k.id })
  }
  return auswahl.slice(0, HOECHSTENS_UNTERLAGEN)
}

// ---------------------------------------------------------------------------------------------------
// Was für eine bessere Einschätzung fehlt (ohne KI, aus Art und Alter der Unterlagen)
// ---------------------------------------------------------------------------------------------------

function tageAlt(datum: string | undefined, heute: string): number | null {
  if (!datum || !/^\d{4}-\d{2}-\d{2}/.test(datum)) return null
  const a = Date.parse(datum.slice(0, 10))
  const b = Date.parse(heute.slice(0, 10))
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

function deutschesDatum(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

export function fehlendeUnterlagen(art: KundenArt, auswahl: { dokument: AkteDokument; kategorie: Kategorie }[], heute: string): string[] {
  const neueste = (k: Kategorie) => auswahl.find((a) => a.kategorie === k)?.dokument
  const fehlt: string[] = []
  const alt = (k: Kategorie, tage: number, text: string) => {
    const d = neueste(k)
    const t = tageAlt(d?.datum, heute)
    if (d && t !== null && t > tage) fehlt.push(`${text} (abgelegt am ${deutschesDatum(d.datum!)})`)
  }
  if (art === 'person') {
    if (!neueste('schufa')) fehlt.push('Aktuelle Schufa-Selbstauskunft des Kunden fehlt')
    else alt('schufa', 92, 'Schufa-Selbstauskunft älter als drei Monate')
    if (!neueste('einkommen')) fehlt.push('Einkommensnachweise fehlen (z. B. die letzten drei Gehaltsabrechnungen oder der letzte Steuerbescheid)')
    if (!neueste('konto')) fehlt.push('Kontoauszüge der letzten drei Monate fehlen')
  } else {
    if (!neueste('bwa')) fehlt.push('Aktuelle BWA mit Summen- und Saldenliste fehlt')
    else alt('bwa', 365, 'BWA älter als 12 Monate')
    if (!neueste('abschluss')) fehlt.push('Jahresabschluss (Bilanz mit Gewinn- und Verlustrechnung) fehlt')
    else alt('abschluss', 548, 'Jahresabschluss älter als 18 Monate')
    if (!neueste('konto')) fehlt.push('Auszüge der Geschäftskonten der letzten drei Monate fehlen')
  }
  return fehlt
}

// ---------------------------------------------------------------------------------------------------
// Selbstauskunft: nur Angaben zu Geld, nichts Privates
// ---------------------------------------------------------------------------------------------------

// Trifft auf Angaben zu Gesundheit, Familie, Religion, Herkunft. Solche Fragen gehen gar nicht erst an
// die KI, und Sätze mit solchen Wörtern werden aus dem Ergebnis entfernt.
export const PRIVATES = /krank|gesundheit|diagnose|schwanger|behinder|pflegegrad|pflegebed|therapie|religi|konfession|kirchensteuer|familienstand|verheiratet|geschieden|verwitwet|\bledig\b|ehefrau|ehemann|ehepartner|lebenspartner|kinder|\bkind\b|steuerklasse|scheidung|unterhalt|staatsangeh|nationalit|geburtsort|geburtsdatum|\balter\b/i

type SelbstauskunftRoh = { antworten?: { frageText?: string; antwort?: string }[] } | null | undefined

export function selbstauskunftZeilen(sa: SelbstauskunftRoh): string[] {
  const antworten = Array.isArray(sa?.antworten) ? sa!.antworten! : []
  return antworten
    .filter((a) => a && String(a.antwort ?? '').trim() && String(a.frageText ?? '').trim())
    .filter((a) => !PRIVATES.test(`${a.frageText} ${a.antwort}`))
    .slice(0, 40)
    .map((a) => `- ${String(a.frageText).slice(0, 200)}: ${String(a.antwort).slice(0, 400)}`)
}

// ---------------------------------------------------------------------------------------------------
// Öffentliche Registerangaben (nur Firmen)
// ---------------------------------------------------------------------------------------------------

export type WebFund = { text: string; quelle_url: string; art: 'register' | 'insolvenz' | 'abschluss' | 'sonstiges'; sicherheit: 'gesichert' | 'wahrscheinlich' | 'unsicher' }

// Eigener, enger Auftrag statt umfeldAuftrag aus index.ts: Der sucht ausdrücklich die handelnden Personen
// nach weiteren Firmen ab — genau das soll die Bonitätsprüfung nicht tun —, und er braucht acht Suchen.
export function baueRechercheAuftrag(firma: string, webseite?: string): string {
  return `Du trägst für eine interne Bonitätseinschätzung öffentlich und kostenlos zugängliche Registerangaben über eine FIRMA zusammen.

Firma laut Kundenakte: ${firma}
Internetseite laut Akte: ${webseite || '(nicht angegeben)'}

Suche nur nach dieser Firma, und nur nach:
1. Handelsregister: genaue Firma, Rechtsform, Sitz, Registergericht und Registernummer, Eintragung oder Gründung, Stammkapital, Status (aktiv, in Liquidation, gelöscht) und jüngste Änderungen (Sitzverlegung, Wechsel der Geschäftsführung, Kapitalherabsetzung).
2. Insolvenzbekanntmachungen (insolvenzbekanntmachungen.de) sowie Bekanntmachungen zu Liquidation oder Löschung.
3. Veröffentlichte Jahresabschlüsse (unternehmensregister.de, bundesanzeiger.de): letztes veröffentlichtes Geschäftsjahr, Bilanzsumme, Eigenkapital (auch ein nicht durch Eigenkapital gedeckter Fehlbetrag), Jahresergebnis, Verbindlichkeiten — soweit veröffentlicht. Vermerke, wenn ein fälliger Abschluss nicht veröffentlicht ist.
Geeignet sind auch frei einsehbare Firmenprofile (z. B. northdata.de, handelsregister.de, openregister.de). Keine kostenpflichtigen Abrufe.

Grenzen: Suche nicht nach Privatpersonen und nicht nach weiteren Firmen der Geschäftsführer oder Gesellschafter. Nichts über Privatleben, Wohnanschrift, Familie oder Gesundheit. Erfinde nichts — was du nicht findest, steht nicht in der Antwort. Viele Firmennamen gibt es mehrfach: Prüfe anhand von Ort, Internetseite und Branche, ob es wirklich diese Firma ist, und gib die Sicherheit der Zuordnung an (gesichert / wahrscheinlich / unsicher).

Antworte auf Deutsch, kurz. Gib GANZ AM ENDE einen einzelnen Codeblock mit reinem JSON zurück (danach nichts mehr), jeder Fund ein vollständiger Satz mit Quelle:
\`\`\`json
{"funde": [{"text": "…", "quelle_url": "https://…", "art": "register", "sicherheit": "gesichert"}]}
\`\`\`
"art" ist "register", "insolvenz", "abschluss" oder "sonstiges". Findest du nichts Belastbares, gib eine leere Liste zurück.`
}

export function leseRechercheAntwort(text: string): WebFund[] {
  const m = String(text ?? '').match(/```json\s*([\s\S]*?)```/)
  if (!m) return []
  let roh: unknown
  try {
    roh = JSON.parse(m[1])
  } catch {
    return []
  }
  const liste = Array.isArray(roh) ? roh : Array.isArray((roh as { funde?: unknown })?.funde) ? (roh as { funde: unknown[] }).funde : []
  const arten = ['register', 'insolvenz', 'abschluss', 'sonstiges'] as const
  const sicher = ['gesichert', 'wahrscheinlich', 'unsicher'] as const
  const funde: WebFund[] = []
  for (const f of liste as Record<string, unknown>[]) {
    const t = typeof f?.text === 'string' ? f.text.trim() : ''
    const u = typeof f?.quelle_url === 'string' ? f.quelle_url.trim() : ''
    // Nur echte Web-Adressen — die Angabe stammt aus einer KI-Antwort.
    if (!t || !/^https?:\/\/\S+$/i.test(u)) continue
    funde.push({
      text: t.slice(0, 600),
      quelle_url: u.slice(0, 500),
      art: (arten as readonly string[]).includes(String(f.art)) ? (f.art as WebFund['art']) : 'sonstiges',
      sicherheit: (sicher as readonly string[]).includes(String(f.sicherheit)) ? (f.sicherheit as WebFund['sicherheit']) : 'unsicher',
    })
  }
  return funde.slice(0, 12)
}

// ---------------------------------------------------------------------------------------------------
// Auftrag an die KI und Auswertung der Antwort
// ---------------------------------------------------------------------------------------------------

export type Quelle = { id: string; art: BonitaetPunkt['art']; name: string; url?: string; text: string }

export function baueBewertungsAuftrag(e: { art: KundenArt; firma?: string; heute: string; quellen: Quelle[]; webRecherche: Bonitaetseinschaetzung['webRecherche'] }): string {
  const dok = e.quellen.filter((q) => q.art === 'dokument')
  const sa = e.quellen.filter((q) => q.art === 'selbstauskunft')
  const web = e.quellen.filter((q) => q.art === 'oeffentlich')
  const wer =
    e.art === 'firma'
      ? `eine Firma („${e.firma ?? ''}")`
      : 'eine Privatperson. Über Privatpersonen wurde bewusst NICHT im Internet gesucht; es zählen nur Unterlagen, die der Kunde selbst gegeben hat'
  const webAbschnitt =
    e.art !== 'firma'
      ? ''
      : `\n\n=== Öffentliche Registerangaben zur Firma ===\n${
          web.length > 0
            ? web.map((q) => `[${q.id}] ${q.text} (Quelle: ${q.url})`).join('\n')
            : e.webRecherche === 'ok'
              ? '(Die Suche hat nichts Belastbares gefunden.)'
              : '(Keine Registerangaben verfügbar.)'
        }`
  return `Du erstellst für eine Beratungsholding eine INTERNE Bonitätseinschätzung. Es ist keine Auskunft einer Auskunftei und keine Kreditentscheidung, sondern eine erste Einordnung für die Mitarbeiter. Heute ist der ${e.heute}.

Geprüft wird ${wer}.

=== Unterlagen aus der Akte (vom Kunden gegeben) ===
${dok.length > 0 ? dok.map((q) => `[${q.id}] Unterlage „${q.name}":\n${q.text}`).join('\n\n') : '(Keine gelesene Unterlage verfügbar.)'}

=== Selbstauskunft des Kunden ===
${sa.length > 0 ? sa.map((q) => `[${q.id}]\n${q.text}`).join('\n') : '(Keine ausgefüllte Selbstauskunft.)'}${webAbschnitt}

So bewertest du (Feld „ampel"):
- "gruen": aktuelle Unterlagen zeigen geordnete Verhältnisse, z. B. Schufa ohne Negativmerkmale, regelmäßiges Einkommen deutlich über den laufenden Verpflichtungen, positive Ergebnisse und Eigenkapital in BWA oder Abschluss, keine negativen Bekanntmachungen.
- "gelb": gemischtes Bild, einzelne Warnzeichen (Verluste, hohe Verschuldung, Konto dauerhaft im Minus, Rücklastschriften) oder Unterlagen alt bzw. lückenhaft.
- "rot": harte Negativmerkmale, z. B. Insolvenzverfahren, Zahlungsausfälle, Inkasso oder Vollstreckung in der Schufa, Pfändung, gehäufte Rücklastschriften, nicht durch Eigenkapital gedeckter Fehlbetrag, Liquidation oder Löschung.
- "nicht_beurteilbar": zu wenig belastbare Grundlage für eine Einordnung.

Regeln:
- Jeder Punkt in "positiv" und "negativ" nennt in "quelle" genau eine Kennung aus den eckigen Klammern oben (z. B. "D1", "S1", "W2"). Punkte ohne passende Kennung sind nicht erlaubt. Erfinde nichts; Zahlen nur, wie sie in der Quelle stehen, mit Zeitraum.
- Öffentliche Angaben mit der Sicherheit "unsicher" nur mit diesem Hinweis verwenden.
- Schreibe NICHTS über Gesundheit, Familie (Familienstand, Kinder, Unterhalt, Steuerklasse), Religion oder Kirchensteuer, Herkunft oder andere private Dinge — auch wenn es in den Unterlagen steht. Keine Kontonummern, keine Steuer- oder Versicherungsnummern, keine Namen von Personen.
- "begruendung": zwei bis vier kurze Sätze, warum diese Ampel.
- "fehlt": was für eine bessere Einschätzung fehlt, konkret (z. B. "aktuelle Schufa-Selbstauskunft fehlt", "BWA älter als 12 Monate", "Kontoauszüge nur für einen Monat").
- Einfache, klare Sprache ohne englische Begriffe. Höchstens sechs Punkte je Liste, die wichtigsten zuerst.

Antworte mit dem Werkzeug „bonitaet_einschaetzung".`
}

export const BEWERTUNGS_WERKZEUG = {
  name: 'bonitaet_einschaetzung',
  description: 'Gibt die interne Bonitätseinschätzung strukturiert zurück.',
  input_schema: {
    type: 'object',
    properties: {
      ampel: { type: 'string', enum: ['gruen', 'gelb', 'rot', 'nicht_beurteilbar'] },
      begruendung: { type: 'string', description: 'Zwei bis vier kurze Sätze.' },
      positiv: {
        type: 'array',
        items: { type: 'object', properties: { text: { type: 'string' }, quelle: { type: 'string', description: 'Kennung wie D1, S1 oder W1' } }, required: ['text', 'quelle'] },
      },
      negativ: {
        type: 'array',
        items: { type: 'object', properties: { text: { type: 'string' }, quelle: { type: 'string', description: 'Kennung wie D1, S1 oder W1' } }, required: ['text', 'quelle'] },
      },
      fehlt: { type: 'array', items: { type: 'string' } },
    },
    required: ['ampel', 'begruendung', 'positiv', 'negativ', 'fehlt'],
  },
}

function ohnePrivates(text: string): string {
  // Satzweise: Sätze mit privaten Angaben fallen weg, der Rest bleibt.
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && !PRIVATES.test(s))
    .join(' ')
    .trim()
}

const STICHWORTE_FEHLT = ['schufa', 'bwa', 'jahresabschluss', 'kontoausz', 'gehalt', 'einkommen', 'geschäftskont', 'bilanz']

/** Prüft die Antwort der KI: unbekannte Quellen und private Angaben fallen heraus. */
export function werteAntwortAus(
  roh: unknown,
  quellen: Quelle[],
  fehltOhneKi: string[],
): Pick<Bonitaetseinschaetzung, 'ampel' | 'begruendung' | 'positiv' | 'negativ' | 'fehlt'> {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>
  const nachId = new Map(quellen.map((q) => [q.id.toUpperCase(), q]))
  const punkte = (liste: unknown): BonitaetPunkt[] => {
    const aus: BonitaetPunkt[] = []
    for (const p of Array.isArray(liste) ? liste : []) {
      const text = typeof p?.text === 'string' ? p.text.trim() : ''
      const id = typeof p?.quelle === 'string' ? p.quelle.replace(/[[\]\s]/g, '').toUpperCase() : ''
      const q = nachId.get(id)
      // Eine erfundene Quelle wäre schlimmer als keine: solche Punkte fallen weg.
      if (!text || !q || PRIVATES.test(text)) continue
      aus.push({ text: text.slice(0, 500), quelle: q.art === 'oeffentlich' ? q.url ?? q.name : q.name, ...(q.url ? { url: q.url } : {}), art: q.art })
    }
    return aus.slice(0, 8)
  }
  const positiv = punkte(r.positiv)
  const negativ = punkte(r.negativ)
  let ampel: Ampel = (['gruen', 'gelb', 'rot', 'nicht_beurteilbar'] as const).includes(r.ampel as Ampel) ? (r.ampel as Ampel) : 'nicht_beurteilbar'
  // Ohne einen einzigen belegten Punkt gibt es keine Ampel.
  if (positiv.length + negativ.length === 0) ampel = 'nicht_beurteilbar'
  const begruendung = ohnePrivates(typeof r.begruendung === 'string' ? r.begruendung : '').slice(0, 1200)
  const vonKi = (Array.isArray(r.fehlt) ? r.fehlt : [])
    .filter((f): f is string => typeof f === 'string' && !!f.trim() && !PRIVATES.test(f))
    .map((f) => f.trim().slice(0, 300))
  const abgedeckt = (f: string) => STICHWORTE_FEHLT.some((w) => f.toLowerCase().includes(w) && fehltOhneKi.some((d) => d.toLowerCase().includes(w)))
  const fehlt = [...fehltOhneKi, ...vonKi.filter((f) => !abgedeckt(f))]
  return {
    ampel,
    begruendung: begruendung || (ampel === 'nicht_beurteilbar' ? 'Die vorliegenden Unterlagen reichen für eine Einordnung nicht aus.' : ''),
    positiv,
    negativ,
    fehlt: [...new Set(fehlt)].slice(0, 12),
  }
}

// ---------------------------------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------------------------------

// Alles muss in rund 100 Sekunden fertig sein (die Anfrage wartet synchron auf das Ergebnis).
const GESAMT_MS = 95_000
const RECHERCHE_HOECHSTENS_MS = 50_000
const BEWERTUNG_MINDESTENS_MS = 30_000
const ZEICHEN_JE_UNTERLAGE = 12_000

function hostVon(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function heuteInBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

type InhaltZeile = { schluessel: string; status: string; inhalt?: string | null; zusammenfassung?: string | null; versuche?: number | null; fehler?: string | null; aktualisiert_am?: string | null }

export async function pruefeBonitaet(
  admin: Db,
  auftrag: { bereich: unknown; kundeId: unknown; art: unknown },
  wer: { name: string; email: string },
  h: BonitaetHelfer,
): Promise<BonitaetErgebnis> {
  const start = Date.now()
  const bereich = typeof auftrag.bereich === 'string' ? auftrag.bereich.trim() : ''
  const kundeId = typeof auftrag.kundeId === 'string' ? auftrag.kundeId.trim() : ''
  if (!bereich || !kundeId) return { ok: false, fehler: 'Es fehlt die Angabe, welcher Kunde gemeint ist.', status: 400 }
  if (auftrag.art !== 'person' && auftrag.art !== 'firma') return { ok: false, fehler: 'Bitte wählen, ob es um eine Privatperson oder eine Firma geht.', status: 400 }
  const art: KundenArt = auftrag.art

  const { data: kunde, error: ladeFehler } = await admin
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, dokumente, selbstauskunft, verantwortlich_email, unternehmensbewertung, immo_stammdaten')
    .eq('id', kundeId)
    .eq('bereich', bereich)
    .maybeSingle()
  if (ladeFehler) return { ok: false, fehler: `Die Akte ließ sich nicht laden: ${ladeFehler.message}`, status: 500 }
  if (!kunde) return { ok: false, fehler: 'Diese Akte gibt es nicht (mehr).', status: 404 }
  // Private Kontakte sieht nur, wem sie gehören (gleiche Regel wie in der Datenbank).
  if (bereich === 'privat' && kunde.verantwortlich_email && String(kunde.verantwortlich_email).toLowerCase() !== wer.email.toLowerCase()) {
    return { ok: false, fehler: 'Dieser private Kontakt gehört einem anderen Mitarbeiter.', status: 403 }
  }

  const firma = String(kunde.firma ?? '')
  const ansprechpartner = String(kunde.ansprechpartner ?? '')
  const erkannt = erkenneKundenArt(firma, ansprechpartner)
  const heute = heuteInBerlin()

  // ---- Unterlagen: Gelesenes verwenden, höchstens fünf Ungelesene zum Lesen anstoßen ----
  const auswahl = waehleUnterlagen(Array.isArray(kunde.dokumente) ? kunde.dokumente : [])
  const schluessel = auswahl.map((a) => h.dokumentSchluessel(a.dokument.url!))
  const zeilen = new Map<string, InhaltZeile>()
  if (schluessel.length > 0) {
    const { data, error } = await admin.from('dokument_inhalte').select('schluessel, status, inhalt, zusammenfassung, versuche, fehler, aktualisiert_am').in('schluessel', schluessel)
    if (error) return { ok: false, fehler: `Die gelesenen Unterlagen ließen sich nicht laden: ${error.message}`, status: 500 }
    for (const z of (data ?? []) as InhaltZeile[]) zeilen.set(z.schluessel, z)
  }
  const dokumente: BonitaetDokument[] = []
  const quellen: Quelle[] = []
  const anstossen: DokumentRef[] = []
  auswahl.forEach((a, i) => {
    const d = a.dokument
    const z = zeilen.get(schluessel[i])
    const basis = { name: d.name, url: d.url }
    const text = String(z?.inhalt ?? '').trim() || String(z?.zusammenfassung ?? '').trim()
    if (z?.status === 'gelesen' && text) {
      quellen.push({ id: `D${quellen.filter((q) => q.art === 'dokument').length + 1}`, art: 'dokument', name: d.name, text: text.slice(0, ZEICHEN_JE_UNTERLAGE) + (text.length > ZEICHEN_JE_UNTERLAGE ? '\n[… gekürzt]' : '') })
      dokumente.push({ ...basis, stand: 'verwendet' })
      return
    }
    if (!h.lesbareArt(d.name, d.typ)) {
      dokumente.push({ ...basis, stand: 'nicht_lesbar', hinweis: 'Dateiart kann nicht gelesen werden' })
      return
    }
    const haengt = z?.status === 'laeuft' && Date.now() - new Date(z.aktualisiert_am ?? 0).getTime() > 6 * 60_000
    if (z?.status === 'laeuft' && !haengt) {
      dokumente.push({ ...basis, stand: 'wird_eingelesen' })
      return
    }
    const darfLesen = !z || haengt || (z.status === 'fehler' && (z.versuche ?? 0) < 3)
    if (darfLesen && anstossen.length < HOECHSTENS_ANSTOSSEN) {
      anstossen.push({ url: d.url!, name: d.name, typ: d.typ })
      dokumente.push({ ...basis, stand: 'wird_eingelesen' })
      return
    }
    if (z?.status === 'fehler' && (z.versuche ?? 0) >= 3) {
      dokumente.push({ ...basis, stand: 'nicht_lesbar', hinweis: z.fehler ? String(z.fehler).slice(0, 200) : 'Lesen mehrfach gescheitert' })
      return
    }
    dokumente.push({ ...basis, stand: 'nicht_verwendet', hinweis: z?.status === 'gelesen' ? 'Kein lesbarer Inhalt' : 'Mehr als fünf ungelesene Unterlagen — beim nächsten Lauf' })
  })
  await Promise.all(anstossen.map((r) => h.stosseDokumentLesenAn(r).catch(() => {})))

  const saZeilen = selbstauskunftZeilen(kunde.selbstauskunft)
  if (saZeilen.length > 0) quellen.push({ id: 'S1', art: 'selbstauskunft', name: 'Selbstauskunft', text: saZeilen.join('\n') })

  // ---- Öffentliche Registerangaben: nur Firmen, nur mit Firmennamen ----
  const erlaubt = rechercheErlaubt(art, firma, ansprechpartner)
  let webRecherche: Bonitaetseinschaetzung['webRecherche'] = erlaubt === 'ja' ? 'ok' : erlaubt
  if (erlaubt === 'ja') {
    const vergangen = Date.now() - start
    const zeit = Math.min(RECHERCHE_HOECHSTENS_MS, GESAMT_MS - BEWERTUNG_MINDESTENS_MS - vergangen, h.restMs() - BEWERTUNG_MINDESTENS_MS - 10_000)
    if (zeit < 15_000) {
      webRecherche = 'fehlgeschlagen'
    } else {
      const webseite = String(kunde.unternehmensbewertung?.webseite ?? kunde.immo_stammdaten?.webseite ?? '').trim()
      try {
        const antwort = await h.callClaudeResearch(baueRechercheAuftrag(firma, webseite), { model: 'claude-haiku-5-5', maxSearches: 5, maxTokens: 4096, timeoutMs: zeit })
        leseRechercheAntwort(antwort).forEach((f, i) =>
          quellen.push({ id: `W${i + 1}`, art: 'oeffentlich', name: hostVon(f.quelle_url), url: f.quelle_url, text: `${f.text} [${f.art}; Sicherheit der Zuordnung: ${f.sicherheit}]` }),
        )
      } catch (err) {
        console.error('Bonität: Registerrecherche gescheitert', err)
        webRecherche = 'fehlgeschlagen'
      }
    }
  }

  // ---- Bewertung ----
  // Was gerade eingelesen wird, gilt nicht als fehlend (dafür steht unten ein eigener Hinweis).
  const fehltOhneKi = fehlendeUnterlagen(art, auswahl.filter((_a, i) => dokumente[i]?.stand === 'verwendet' || dokumente[i]?.stand === 'wird_eingelesen'), heute)
  const imLesen = dokumente.filter((d) => d.stand === 'wird_eingelesen').length
  if (imLesen > 0) fehltOhneKi.unshift(`${imLesen} ${imLesen === 1 ? 'Unterlage wird' : 'Unterlagen werden'} gerade eingelesen — in einigen Minuten neu prüfen`)
  if (webRecherche === 'fehlgeschlagen') fehltOhneKi.push('Die Suche nach öffentlichen Registerangaben hat nicht geklappt — bitte neu prüfen')
  if (webRecherche === 'kein_firmenname') fehltOhneKi.push('Für die Suche im Handelsregister fehlt ein Firmenname in der Akte')

  let bewertung: Pick<Bonitaetseinschaetzung, 'ampel' | 'begruendung' | 'positiv' | 'negativ' | 'fehlt'>
  if (quellen.length === 0) {
    // Nichts zum Beurteilen: keine KI, kein Verbrauch.
    bewertung = {
      ampel: 'nicht_beurteilbar',
      begruendung:
        imLesen > 0
          ? 'Die passenden Unterlagen werden gerade erst eingelesen. Bitte in einigen Minuten neu prüfen.'
          : 'In der Akte liegt keine Unterlage, aus der sich die Zahlungsfähigkeit ablesen lässt.',
      positiv: [],
      negativ: [],
      fehlt: fehltOhneKi,
    }
  } else {
    const vergangen = Date.now() - start
    const zeit = Math.max(BEWERTUNG_MINDESTENS_MS, Math.min(GESAMT_MS - vergangen, h.restMs() - 5_000))
    try {
      const roh = await h.callClaudeTool<unknown>(
        baueBewertungsAuftrag({ art, firma: art === 'firma' ? firma : undefined, heute, quellen, webRecherche }),
        BEWERTUNGS_WERKZEUG,
        6000,
        'claude-sonnet-5-5',
        'auto',
        zeit,
      )
      bewertung = werteAntwortAus(roh, quellen, fehltOhneKi)
    } catch (err) {
      const zeitUm = err instanceof Error && /abort|timeout|timed out/i.test(`${err.name} ${err.message}`)
      return {
        ok: false,
        fehler: zeitUm ? 'Die Einschätzung hat zu lange gedauert. Bitte noch einmal versuchen.' : `Die Einschätzung ist fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        status: zeitUm ? 504 : 500,
      }
    }
  }

  const bonitaet: Bonitaetseinschaetzung = {
    version: 1,
    ...bewertung,
    art,
    artErkannt: erkannt.art,
    artGrund: erkannt.grund,
    webRecherche,
    dokumente,
    selbstauskunftVerwendet: saZeilen.length > 0,
    erstelltAm: new Date().toISOString(),
    erstelltVon: wer.name || wer.email,
  }
  // Nur diese eine Spalte schreiben — alles andere an der Akte bleibt unberührt.
  const { error: schreibFehler } = await admin.from('kunden').update({ bonitaet }).eq('id', kundeId).eq('bereich', bereich)
  if (schreibFehler) return { ok: false, fehler: `Die Einschätzung ließ sich nicht speichern: ${schreibFehler.message}`, status: 500 }
  return { ok: true, bonitaet, angestossen: anstossen.length }
}
