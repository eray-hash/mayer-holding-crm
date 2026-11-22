// To-dos aufräumen: gemeinsamer Kern für das Feld „Aufräumen“ in der To-Do-Liste (src/pages/todo/ToDoListe.tsx),
// das Werkzeug todos_aufraeumen des Assistenten (telegram-gateway/todoAufraeumenWerkzeug.ts) und den monatlichen
// Hinweis (email-gateway/todoAufraeumenHinweis.ts). Bewusst ohne Importe und ohne Deno- oder Browser-Funktionen.
//
// Anlass (22.11.2026): 2.659 offene To-dos, fast alle aus Hasans Microsoft To Do (seit dem Abgleich vom 20.11.),
// viele davon jahrelang unberührt. Die Prüfung schlägt nur vor; geändert wird erst nach einem Klick bzw. nach
// ausdrücklicher Bestätigung im Assistenten.
//
// Arten von Vorschlägen (jede Aufgabe steht höchstens in einem Vorschlag, außer der behaltenen eines Doppels):
// - wohl_erledigt: Text sieht erledigt aus („erledigt“, „✓“ am Anfang/Ende) oder nennt einen einmaligen Termin bzw.
//   eine Frist, die seit mehr als 7 Tagen vorbei ist („Termin am 31.01.2025“, „Abwesenheit bis 08.04.2024“).
//   „vom 20.04.2024“ (Datum eines Schreibens) zählt nicht.
// - akte_abgeschlossen: „Kunde/Projekt“ ist genau der Name einer Akte, eines Objekts oder Projekts im Endstand
//   (abgeschlossen, verloren, archiviert …) und es gibt keine offene Akte gleichen Namens.
// - doppelt: in derselben Liste gleicher Text (nach Vereinheitlichung) oder fast gleicher Text (mindestens 3 Wörter,
//   80 % gleiche Wörter, gleiche Zahlen — „Rechnung 123 vom März“ und „Rechnung 124 vom April“ sind KEINE Doppel).
// - ueberfaellig: Frist seit mehr als 14 Tagen vorbei → auf den Werktag in einer Woche verschieben; seit über einem
//   halben Jahr vorbei → erledigen.
// - alt: ohne Frist, ohne künftige Erinnerung/Wiedervorlage, nicht Prio A, seit über 90 Tagen unberührt.
//   „Unberührt“: bei Microsoft-Aufgaben die letzte Änderung in Microsoft (ms_geaendert) — erstellt_am ist dort nur
//   der Tag des ersten Abgleichs; sonst erstellt/erhalten. updated_at taugt nicht (die automatische Priorisierung
//   schreibt jeden Morgen die Reihenfolge).
//
// Anwenden: „erledigen“ ist weich (erledigt_am = heute, Vermerk „aufgeräumt am …“ im aktuellen Stand). Löschen nur,
// wenn der Mitarbeiter es ausdrücklich wählt. Bei Microsoft-Aufgaben trägt der vorhandene Abgleich
// (email-gateway/todoAbgleich.ts) die Änderung zurück: erledigt/Frist/Stand über den Abgleich-Hash, Löschen über
// den Auslöser todo_ms_loeschung (ms_loeschungen).

export type AufraeumArt = 'wohl_erledigt' | 'akte_abgeschlossen' | 'doppelt' | 'ueberfaellig' | 'alt'
export type AufraeumAktion = 'zusammenfuehren' | 'erledigen' | 'verschieben' | 'loeschen'

export const AUFRAEUM_ARTEN: readonly AufraeumArt[] = ['wohl_erledigt', 'akte_abgeschlossen', 'doppelt', 'ueberfaellig', 'alt']

export const ART_NAME: Record<AufraeumArt, string> = {
  wohl_erledigt: 'Sieht erledigt aus',
  akte_abgeschlossen: 'Akte abgeschlossen',
  doppelt: 'Doppelt',
  ueberfaellig: 'Lange überfällig',
  alt: 'Lange unberührt',
}

export const AKTION_NAME: Record<AufraeumAktion, string> = {
  zusammenfuehren: 'Zusammenführen',
  erledigen: 'Erledigen',
  verschieben: 'Verschieben',
  loeschen: 'Löschen',
}

/** Kurzer Grund im Vermerk „aufgeräumt am …: …“. */
const VERMERK: Record<AufraeumArt, string> = {
  wohl_erledigt: 'sah erledigt aus',
  akte_abgeschlossen: 'Akte abgeschlossen',
  doppelt: 'doppelt',
  ueberfaellig: 'lange überfällig',
  alt: 'lange unberührt',
}

/** Endstände der Statusabläufe (src/data/statusNetworks.ts: isTerminal) — Akte, Objekt oder Projekt ist zu. */
export const ENDSTATUS: readonly string[] = ['abgeschlossen', 'verloren', 'nicht_qualifiziert', 'archiv', 'erledigt', 'abgebrochen', 'storniert', 'verkauft']

export function istEndstatus(status: string | null | undefined): boolean {
  return ENDSTATUS.includes(String(status ?? '').trim().toLowerCase())
}

/** Eine To-do-Zeile in Datenbankform (Spalten der Tabelle todos). ms_id darf auch nur true/false sein. */
export type AufraeumTodo = {
  id: string
  aufgabe: string
  besitzer_email?: string | null
  bereich?: string | null
  kunde_projekt?: string | null
  prio?: string | null
  erledigen_bis?: string | null
  erledigt_am?: string | null
  erstellt_am?: string | null
  erhalten_am?: string | null
  aktueller_stand?: string | null
  erinnern_um?: string | null
  geplante_wiedervorlage?: string | null
  ms_id?: string | boolean | null
  ms_liste_name?: string | null
  ms_geaendert?: string | null
}

/** Spalten, die die Prüfung braucht (für select). */
export const AUFRAEUM_SPALTEN =
  'id, aufgabe, besitzer_email, bereich, kunde_projekt, prio, erledigen_bis, erledigt_am, erstellt_am, erhalten_am, aktueller_stand, erinnern_um, geplante_wiedervorlage, ms_id, ms_liste_name, ms_geaendert'

/** Name einer Akte/eines Objekts/Projekts und ob sie im Endstand ist. */
export type AkteName = { name: string; abgeschlossen: boolean }

export type AufraeumVorschlag = {
  /** Eindeutig je Vorschlag (Art + erste ID), für Schlüssel in der Oberfläche. */
  schluessel: string
  art: AufraeumArt
  /** Liste, in der die Aufgaben stehen: `bereich:<id>` oder `eigen:<besitzer>|<Microsoft-Liste>`. */
  liste: string
  liste_name: string
  todo_ids: string[]
  vorschlag: AufraeumAktion
  /** Bei verschieben: neues Datum (JJJJ-MM-TT). */
  datum?: string
  /** Bei doppelt: die Aufgabe, die bleibt. */
  behalten_id?: string
  grund: string
}

export type AufraeumOptionen = {
  /** Heute (JJJJ-MM-TT, deutsche Zeit). */
  heute: string
  /** Ab wie vielen Tagen ohne Bewegung „alt“ (Vorgabe 90). */
  tageAlt?: number
  /** Ab wie vielen Tagen über der Frist „überfällig“ (Vorgabe 14). */
  tageUeberfaellig?: number
  /** Ab wie vielen Tagen über der Frist erledigen statt verschieben (Vorgabe 180). */
  tageUeberfaelligErledigen?: number
  /** Wie lange ein Termin im Text vorbei sein muss (Vorgabe 7). */
  tageNachTermin?: number
  akten?: AkteName[]
  /** Anzeigename eines Bereichs (Vorgabe: die ID). */
  bereichName?: (bereich: string) => string
}

// ---------- Hilfen: Datum ----------

const ISO = /^\d{4}-\d{2}-\d{2}/

function gueltigesIso(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim()
  if (!ISO.test(t)) return null
  const d = t.slice(0, 10)
  return Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? null : d
}

/** Tage von a bis b (beide JJJJ-MM-TT); positiv, wenn b später ist. */
export function tageZwischen(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function plusTage(datum: string, tage: number): string {
  return new Date(Date.parse(`${datum}T00:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10)
}

/** Erster Werktag (Mo–Fr) ab `datum`. */
export function naechsterWerktag(datum: string): string {
  let d = datum
  for (let i = 0; i < 3; i++) {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay()
    if (w !== 0 && w !== 6) return d
    d = plusTage(d, 1)
  }
  return d
}

export function deDatum(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

/** Letzte Bewegung einer Aufgabe (JJJJ-MM-TT) — siehe Kopf der Datei. */
export function letzteBewegung(t: AufraeumTodo): string | null {
  if (t.ms_id) {
    const ms = gueltigesIso(t.ms_geaendert)
    if (ms) return ms
  }
  const kandidaten = [gueltigesIso(t.erstellt_am), gueltigesIso(t.erhalten_am)].filter((x): x is string => !!x)
  return kandidaten.length ? kandidaten.sort().at(-1)! : null
}

// ---------- Hilfen: Text ----------

/** Vereinheitlichter Text: klein, ohne Akzente, ß→ss, ohne „AW:/WG:“-Vorsätze, nur Buchstaben/Ziffern. */
export function normalisiere(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(\s*(re|aw|wg|fw|fwd|antw)\s*:\s*)+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const FUELLWOERTER = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'und', 'oder', 'mit', 'von', 'vom', 'im', 'in', 'an', 'am', 'zu', 'zum', 'zur', 'fur', 'auf', 'ein', 'eine', 'einen', 'ist', 'bei', 'ihr', 'ihre', 'ihren'])

function woerter(norm: string): string[] {
  return norm.split(' ').filter((w) => w.length >= 2 && !FUELLWOERTER.has(w))
}

function zahlenSchluessel(ws: string[]): string {
  return ws.filter((w) => /\d/.test(w)).sort().join(' ')
}

/** Anteil gleicher Wörter (Jaccard) zweier Wortmengen. */
export function aehnlichkeit(a: string, b: string): number {
  const x = new Set(woerter(normalisiere(a)))
  const y = new Set(woerter(normalisiere(b)))
  if (x.size === 0 && y.size === 0) return 1
  let gemeinsam = 0
  for (const w of x) if (y.has(w)) gemeinsam++
  return gemeinsam / (x.size + y.size - gemeinsam)
}

// ---------- Erkennung: sieht erledigt aus ----------

const MARKE_ANFANG = /^\s*(✓|✔|☑|✅|\[x\]|erledigt\b|erl\.|fertig\b|done\b)/i
const MARKE_ENDE = /(✓|✔|☑|✅|\berledigt|\(erl\.?\)|\berl\.)\s*[.!]*\s*$/i
const MARKE_STAND = /^\s*(✓|✔|☑|✅|erledigt\b|fertig\b|erl\.)/i
const WIEDERKEHREND = /\b(jahrlich|jaehrlich|monatlich|wochentlich|woechentlich|taglich|taeglich|jeden|jede|immer|regelmassig)\b/
const EREIGNIS_WORT = /\b(termin|einladung|veranstaltung|webinar|seminar|messe|meeting|treffen|abwesenheit|abwesend|urlaub|frist|ablauf|besichtigung|telefontermin|videokonferenz|konferenz)\b/
// Wort direkt vor dem Datum (höchstens 20 Zeichen davor, ohne Ziffern/Punkte): Ereignis oder Frist.
const VOR_DATUM_EREIGNIS = /\b(am|bis|zum|endet|endete|frist|termin|treffen|den|spatestens|spaetestens|faellig|fallig|ablauf)\b[^\d.]{0,20}$/
const VOR_DATUM_KEIN_EREIGNIS = /\b(vom|seit|stand|ab|datum|geboren|geb)\b[^\d.]{0,6}$/

/** Termine/Fristen im Text, die vorbei sind; liefert das späteste solche Datum oder null. */
export function vergangenerTermin(text: string, bezug: string | null, heute: string, tageNachTermin = 7): string | null {
  const roh = String(text ?? '')
  const klein = roh.toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  if (WIEDERKEHREND.test(klein)) return null
  const ereignisWort = EREIGNIS_WORT.test(klein)
  const muster = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])/g
  let spaetestes: string | null = null
  for (const m of klein.matchAll(muster)) {
    const tag = Number(m[1])
    const monat = Number(m[2])
    if (tag < 1 || tag > 31 || monat < 1 || monat > 12) continue
    const davor = klein.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0)
    if (VOR_DATUM_KEIN_EREIGNIS.test(davor)) continue
    const stichwort = VOR_DATUM_EREIGNIS.test(davor)
    let jahr: number
    if (m[3]) {
      jahr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      if (!stichwort && !ereignisWort) continue
    } else {
      // Ohne Jahr nur mit Stichwort direkt davor; Jahr aus der letzten Bewegung der Aufgabe.
      if (!stichwort || !bezug) continue
      jahr = Number(bezug.slice(0, 4))
    }
    let datum = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`
    if (Number.isNaN(Date.parse(`${datum}T00:00:00Z`)) || new Date(`${datum}T00:00:00Z`).getUTCDate() !== tag) continue
    if (!m[3] && bezug && tageZwischen(bezug, datum) < -60) {
      datum = `${jahr + 1}${datum.slice(4)}`
    }
    if (!spaetestes || datum > spaetestes) spaetestes = datum
  }
  if (!spaetestes) return null
  return tageZwischen(spaetestes, heute) > tageNachTermin ? spaetestes : null
}

/** Grund, warum die Aufgabe erledigt aussieht, oder null. */
export function siehtErledigtAus(t: AufraeumTodo, heute: string, tageNachTermin = 7): string | null {
  const text = String(t.aufgabe ?? '')
  if (MARKE_ANFANG.test(text) || MARKE_ENDE.test(text)) return 'Der Text ist als erledigt markiert.'
  if (MARKE_STAND.test(String(t.aktueller_stand ?? ''))) return 'Im aktuellen Stand steht, dass sie erledigt ist.'
  const termin = vergangenerTermin(text, letzteBewegung(t), heute, tageNachTermin)
  if (termin) return `Der Termin bzw. die Frist im Text (${deDatum(termin)}) ist vorbei.`
  return null
}

// ---------- Listen ----------

export function listenSchluessel(t: AufraeumTodo): string {
  if (t.bereich) return `bereich:${t.bereich}`
  return `eigen:${String(t.besitzer_email ?? '').toLowerCase()}|${t.ms_id ? String(t.ms_liste_name ?? '') : ''}`
}

export function listenName(t: AufraeumTodo, bereichName?: (b: string) => string): string {
  if (t.bereich) return `Liste ${bereichName ? bereichName(t.bereich) : t.bereich}`
  if (t.ms_id) return t.ms_liste_name ? `Microsoft-Liste „${t.ms_liste_name}“` : 'Microsoft To Do'
  return 'Eigene Liste'
}

/** Wie viel eine Aufgabe trägt — die reichste eines Doppels bleibt. */
function gehalt(t: AufraeumTodo): number {
  return (t.erledigen_bis ? 4 : 0) + (t.prio ? 2 : 0) + (String(t.aktueller_stand ?? '').trim() ? 2 : 0) + (t.erinnern_um ? 1 : 0) + (t.kunde_projekt ? 1 : 0)
}

// ---------- Prüfung ----------

/** Alle Vorschläge für die offenen Aufgaben in `todos` (Erledigtes wird übersprungen). */
export function analysiereTodos(todos: AufraeumTodo[], o: AufraeumOptionen): AufraeumVorschlag[] {
  const heute = o.heute
  const tageAlt = o.tageAlt ?? 90
  const tageUeber = o.tageUeberfaellig ?? 14
  const tageUeberErl = o.tageUeberfaelligErledigen ?? 180
  const tageTermin = o.tageNachTermin ?? 7
  const offen = todos.filter((t) => !t.erledigt_am && t.id)
  const vergeben = new Set<string>()
  const vorschlaege: AufraeumVorschlag[] = []
  const neu = (art: AufraeumArt, t: AufraeumTodo, rest: Omit<AufraeumVorschlag, 'schluessel' | 'art' | 'liste' | 'liste_name'>) => {
    vorschlaege.push({ schluessel: `${art}:${rest.todo_ids[0]}`, art, liste: listenSchluessel(t), liste_name: listenName(t, o.bereichName), ...rest })
    for (const id of rest.todo_ids) if (id !== rest.behalten_id) vergeben.add(id)
  }

  // 1) Sieht erledigt aus
  for (const t of offen) {
    const grund = siehtErledigtAus(t, heute, tageTermin)
    if (grund) neu('wohl_erledigt', t, { todo_ids: [t.id], vorschlag: 'erledigen', grund })
  }

  // 2) Akte abgeschlossen: Name eindeutig nur bei abgeschlossenen Akten
  if (o.akten?.length) {
    const zu = new Map<string, string>()
    const offeneNamen = new Set<string>()
    for (const a of o.akten) {
      const n = normalisiere(a.name)
      if (n.length < 4) continue
      if (a.abgeschlossen) zu.set(n, a.name)
      else offeneNamen.add(n)
    }
    for (const t of offen) {
      if (vergeben.has(t.id) || !t.kunde_projekt) continue
      const n = normalisiere(t.kunde_projekt)
      const name = zu.get(n)
      if (name && !offeneNamen.has(n)) neu('akte_abgeschlossen', t, { todo_ids: [t.id], vorschlag: 'erledigen', grund: `Die Akte „${name}“ ist abgeschlossen.` })
    }
  }

  // 3) Doppelt — je Liste
  const jeListe = new Map<string, AufraeumTodo[]>()
  for (const t of offen) {
    if (vergeben.has(t.id)) continue
    const k = listenSchluessel(t)
    if (!jeListe.has(k)) jeListe.set(k, [])
    jeListe.get(k)!.push(t)
  }
  for (const liste of jeListe.values()) {
    const eltern = new Map<string, string>()
    const finde = (x: string): string => {
      let r = x
      while (eltern.get(r) !== r) r = eltern.get(r)!
      eltern.set(x, r)
      return r
    }
    const vereine = (a: string, b: string) => eltern.set(finde(a), finde(b))
    const info = liste.map((t) => {
      eltern.set(t.id, t.id)
      const norm = normalisiere(t.aufgabe)
      const ws = woerter(norm)
      return { t, norm, menge: new Set(ws), zahlen: zahlenSchluessel(ws) }
    })
    // Gleicher Text
    const nachText = new Map<string, string>()
    for (const i of info) {
      if (!i.norm) continue
      const erster = nachText.get(i.norm)
      if (erster) vereine(i.t.id, erster)
      else nachText.set(i.norm, i.t.id)
    }
    // Fast gleicher Text: nach Wortzahl sortiert, nur Paare mit ähnlicher Länge vergleichen (80 % ⇒ Länge ≥ 80 %).
    const lang = info.filter((i) => i.menge.size >= 3).sort((a, b) => a.menge.size - b.menge.size)
    for (let a = 0; a < lang.length; a++) {
      const x = lang[a]
      for (let b = a + 1; b < lang.length; b++) {
        const y = lang[b]
        if (x.menge.size < 0.8 * y.menge.size) break
        if (x.zahlen !== y.zahlen || x.norm === y.norm) continue
        let gemeinsam = 0
        for (const w of x.menge) if (y.menge.has(w)) gemeinsam++
        if (gemeinsam / (x.menge.size + y.menge.size - gemeinsam) >= 0.8) vereine(x.t.id, y.t.id)
      }
    }
    const gruppen = new Map<string, AufraeumTodo[]>()
    for (const i of info) {
      const r = finde(i.t.id)
      if (!gruppen.has(r)) gruppen.set(r, [])
      gruppen.get(r)!.push(i.t)
    }
    for (const g of gruppen.values()) {
      if (g.length < 2) continue
      const sortiert = [...g].sort((a, b) => gehalt(b) - gehalt(a) || String(letzteBewegung(b) ?? '').localeCompare(String(letzteBewegung(a) ?? '')) || a.id.localeCompare(b.id))
      const behalten = sortiert[0]
      const gleich = new Set(g.map((t) => normalisiere(t.aufgabe))).size === 1
      neu('doppelt', behalten, {
        todo_ids: sortiert.map((t) => t.id),
        vorschlag: 'zusammenfuehren',
        behalten_id: behalten.id,
        grund: `${g.length}× ${gleich ? 'gleicher' : 'fast gleicher'} Text in derselben Liste — eine bleibt, die anderen werden abgehakt.`,
      })
    }
  }

  // 4) Lange überfällig  5) Lange unberührt
  const inEinerWoche = naechsterWerktag(plusTage(heute, 7))
  for (const t of offen) {
    if (vergeben.has(t.id)) continue
    const bis = gueltigesIso(t.erledigen_bis)
    if (bis) {
      const drueber = tageZwischen(bis, heute)
      if (drueber > tageUeberErl) neu('ueberfaellig', t, { todo_ids: [t.id], vorschlag: 'erledigen', grund: `Seit ${drueber} Tagen überfällig (Frist ${deDatum(bis)}).` })
      else if (drueber > tageUeber) neu('ueberfaellig', t, { todo_ids: [t.id], vorschlag: 'verschieben', datum: inEinerWoche, grund: `Seit ${drueber} Tagen überfällig (Frist ${deDatum(bis)}).` })
      continue
    }
    if (String(t.prio ?? '').trim().toUpperCase() === 'A') continue
    if (t.erinnern_um && String(t.erinnern_um).slice(0, 10) >= heute) continue
    const wv = gueltigesIso(t.geplante_wiedervorlage)
    if (wv && wv >= heute) continue
    const bewegt = letzteBewegung(t)
    if (!bewegt) continue
    const alter = tageZwischen(bewegt, heute)
    if (alter > tageAlt) {
      neu('alt', t, { todo_ids: [t.id], vorschlag: 'erledigen', grund: `Ohne Frist und seit ${alter} Tagen unberührt (zuletzt ${deDatum(bewegt)}).` })
    }
  }
  return vorschlaege
}

/** Zahlen je Art: Vorschläge und Aufgaben, die aufgeräumt würden (bei Doppeln ohne die behaltene). */
export function zusammenfassen(v: AufraeumVorschlag[]): { art: AufraeumArt; vorschlaege: number; todos: number }[] {
  return AUFRAEUM_ARTEN.map((art) => {
    const liste = v.filter((x) => x.art === art)
    return { art, vorschlaege: liste.length, todos: liste.reduce((s, x) => s + x.todo_ids.filter((id) => id !== x.behalten_id).length, 0) }
  }).filter((z) => z.vorschlaege > 0)
}

/** Kurzer, fester Code für eine Menge von IDs (FNV-1a) — damit eine Bestätigung genau die gezeigte Menge trifft. */
export function gruppenCode(ids: string[]): string {
  let h = 0x811c9dc5
  for (const c of [...ids].sort().join(',')) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `G${h.toString(36)}`
}

// ---------- Anwenden ----------

export type TodoAenderung = { id: string; loeschen?: true; felder?: { erledigt_am?: string; erledigen_bis?: string; aktueller_stand?: string } }

export function vermerk(art: AufraeumArt, heute: string, zusatz = ''): string {
  return `aufgeräumt am ${deDatum(heute)}: ${VERMERK[art]}${zusatz}`
}

function mitVermerk(stand: string | null | undefined, text: string): string {
  const alt = String(stand ?? '').trim()
  return (alt ? `${alt}\n${text}` : text).slice(0, 4000)
}

/**
 * Was bei einem Vorschlag zu ändern ist. `aktion` überschreibt den Vorschlag (z. B. „loeschen“ auf ausdrücklichen
 * Wunsch). Erledigte oder unbekannte Aufgaben bleiben unberührt.
 * - zusammenfuehren (nur Doppel): die behaltene bekommt den Stand der anderen (falls noch nicht drin) und deren
 *   früheste Frist, wenn sie selbst keine hat; die anderen werden weich erledigt.
 * - loeschen bei einem Doppel: wie zusammenführen, nur werden die anderen gelöscht (die behaltene bleibt).
 */
export function aenderungenFuer(
  v: AufraeumVorschlag,
  todos: Map<string, AufraeumTodo>,
  o: { heute: string; aktion?: AufraeumAktion; datum?: string },
): TodoAenderung[] {
  const aktion = o.aktion ?? v.vorschlag
  const offen = (id: string) => {
    const t = todos.get(id)
    return t && !t.erledigt_am ? t : null
  }
  const ergebnis: TodoAenderung[] = []
  if (v.art === 'doppelt' && v.behalten_id && (aktion === 'zusammenfuehren' || aktion === 'loeschen')) {
    const behalten = offen(v.behalten_id)
    const andere = v.todo_ids.filter((id) => id !== v.behalten_id).map(offen).filter((t): t is AufraeumTodo => !!t)
    if (!behalten || andere.length === 0) return []
    let stand = String(behalten.aktueller_stand ?? '').trim()
    for (const t of andere) {
      const s = String(t.aktueller_stand ?? '').trim()
      if (s && !stand.includes(s)) stand = stand ? `${stand}\n${s}` : s
    }
    const felder: NonNullable<TodoAenderung['felder']> = {}
    if (stand !== String(behalten.aktueller_stand ?? '').trim()) felder.aktueller_stand = stand.slice(0, 4000)
    if (!gueltigesIso(behalten.erledigen_bis)) {
      const fristen = andere.map((t) => gueltigesIso(t.erledigen_bis)).filter((x): x is string => !!x).sort()
      if (fristen.length) felder.erledigen_bis = fristen[0]
    }
    if (Object.keys(felder).length) ergebnis.push({ id: behalten.id, felder })
    for (const t of andere) {
      if (aktion === 'loeschen') ergebnis.push({ id: t.id, loeschen: true })
      else ergebnis.push({ id: t.id, felder: { erledigt_am: o.heute, aktueller_stand: mitVermerk(t.aktueller_stand, vermerk('doppelt', o.heute, ` (bleibt: ${behalten.id})`)) } })
    }
    return ergebnis
  }
  for (const id of v.todo_ids) {
    const t = offen(id)
    if (!t) continue
    if (aktion === 'loeschen') ergebnis.push({ id, loeschen: true })
    else if (aktion === 'verschieben') {
      const datum = gueltigesIso(o.datum) ?? v.datum ?? naechsterWerktag(plusTage(o.heute, 7))
      if (datum !== t.erledigen_bis) ergebnis.push({ id, felder: { erledigen_bis: datum } })
    } else ergebnis.push({ id, felder: { erledigt_am: o.heute, aktueller_stand: mitVermerk(t.aktueller_stand, vermerk(v.art, o.heute)) } })
  }
  return ergebnis
}

/** Bündelt Änderungen mit gleichen Feldern (eine Abfrage je Bündel statt je Aufgabe) und sammelt die Löschungen. */
export function buendele(aenderungen: TodoAenderung[]): { buendel: { felder: NonNullable<TodoAenderung['felder']>; ids: string[] }[]; loeschen: string[] } {
  const nachFeldern = new Map<string, { felder: NonNullable<TodoAenderung['felder']>; ids: string[] }>()
  const loeschen: string[] = []
  const gesehen = new Set<string>()
  for (const a of aenderungen) {
    if (gesehen.has(a.id)) continue
    gesehen.add(a.id)
    if (a.loeschen) {
      loeschen.push(a.id)
      continue
    }
    if (!a.felder || Object.keys(a.felder).length === 0) continue
    const k = JSON.stringify(Object.entries(a.felder).sort(([x], [y]) => x.localeCompare(y)))
    if (!nachFeldern.has(k)) nachFeldern.set(k, { felder: a.felder, ids: [] })
    nachFeldern.get(k)!.ids.push(a.id)
  }
  return { buendel: [...nachFeldern.values()], loeschen }
}

/**
 * Offene Aufgaben einer Liste, seitenweise nach id (die Datenbank liefert höchstens 1000 Zeilen je Abfrage).
 * `wo.besitzer` = eigene Liste (bereich leer), `wo.bereich` = Bereichsliste. `supabase` = Server- oder Browser-Client.
 */
export async function ladeOffeneTodos(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  wo: { besitzer: string } | { bereich: string },
): Promise<AufraeumTodo[]> {
  const alle: AufraeumTodo[] = []
  let letzte = ''
  for (let seite = 0; seite < 50; seite++) {
    let q = supabase.from('todos').select(AUFRAEUM_SPALTEN)
    q = 'besitzer' in wo ? q.eq('besitzer_email', wo.besitzer.toLowerCase()).is('bereich', null) : q.eq('bereich', wo.bereich)
    q = q.is('erledigt_am', null).order('id', { ascending: true }).limit(1000)
    if (letzte) q = q.gt('id', letzte)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const zeilen = (data ?? []) as AufraeumTodo[]
    alle.push(...zeilen)
    if (zeilen.length < 1000) break
    letzte = zeilen[zeilen.length - 1].id
  }
  return alle
}

/** Teilt eine Liste in Stücke (für `.in('id', …)` mit begrenzter Adresslänge). */
export function stuecke<T>(liste: T[], groesse = 150): T[][] {
  const r: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) r.push(liste.slice(i, i + groesse))
  return r
}
