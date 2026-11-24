// Gesprächs-App „Mayer Gespräch“: eine Aufnahme auf mehrere Akten verteilen (24.11.2026). Anlass: Ein
// Geschäftsführer ging in einer 14-minütigen Sprachnotiz rund 30 Kunden nacheinander durch (Stand, bezahlte und
// erwartete Beträge, Wiedervorlagen, To-dos) — die App konnte eine Aufnahme aber nur in GENAU EINE Akte übernehmen.
//
// Diese Datei rechnet ohne Netz: Werkzeug-Beschreibung für die KI, Prüfen der KI-Antwort, Abgleich der Abschnitte
// mit den vorhandenen Akten (unscharf, mehrere Treffer = Auswahl), Texte für Protokoll und Verlauf, Chance. Den
// Ablauf (KI-Aufruf, Datenbank) macht email-gateway/gespraechVerteilen.ts, die Telegram-Seite
// telegram-gateway/aufnahmeVerteilen.ts, die App src/gespraech/auswertung/Verteilen.tsx.
//
// Gespeichert wird alles in gespraech_aufnahmen.verteilung (Verteilung unten). Wiederholbar ohne Doppelte:
// - Gesprächsprotokoll mit fester Kennung je Aufnahme + Akte (protokollIdFuer) — gibt es sie schon (auch von einem
//   Skript angelegt), wird für diese Akte nichts mehr angelegt;
// - neue Akten mit fester Kennung je Aufnahme + Name (neueAkteId);
// - Wiedervorlagen und To-dos mit einem Schlüssel aus Inhalt und Datum (wvSchluessel, todoSchluessel).

import { abstand, grundform, namensWoerter } from './dublettenKern.ts'
import { euro, monatName } from './umsatzKern.ts'
import type { ChanceVorschlag, GespeicherteChance } from './chanceKern.ts'

// ─── Typen ───────────────────────────────────────────────────────────────────────────────────────

export type VerteilWv = { titel: string; faellig: string }
export type VerteilTodo = { text: string; faellig?: string; zustaendig?: string; zustaendig_email?: string }

/** Ein Abschnitt der Aufnahme: ein Kunde bzw. Vorgang. */
export type VerteilAbschnitt = {
  /** Fortlaufend ab 0, in der Reihenfolge der Aufnahme. */
  nr: number
  /** Name, wie er genannt wurde („Familie Keller“). */
  name: string
  firma?: string
  person?: string
  /** Weitere Schreibweisen für den Abgleich (Spracherkennung schreibt Namen oft falsch). */
  suchnamen?: string[]
  /** Akten, die die KI in der Liste für passend hielt (nur Vorschlag, wird geprüft). */
  akteIds?: string[]
  bereichVorschlag?: string
  /** Woher der Kunde kommt, z. B. „kommt über Vermittler Schmidt“. */
  bezug?: string
  /** Name des Vermittlers, falls genannt. */
  vermittler?: string
  /** Kurzfassung, sachlich, in seinen Worten. */
  stand: string
  bezahlt?: number
  erwartetNetto?: number
  /** JJJJ-MM */
  erwartetMonat?: string
  chance?: { prozent: number; begruendung: string }
  wiedervorlagen: VerteilWv[]
  todos: VerteilTodo[]
  offeneFragen: string[]
  /** Wortlaut des Teils der Abschrift, der diesen Kunden betrifft. */
  auszug?: string
}

/** Was für eine Akte angelegt wurde (Schlüssel = kunde_id). */
export type VerteilErgebnis = {
  kundeId: string
  name: string
  bereich: string
  nrs: number[]
  am: string
  neuAngelegt?: boolean
  protokollId?: string
  /** Protokoll gab es schon (anderer Weg, z. B. Skript) — für diese Akte wurde nichts angelegt. */
  extern?: boolean
  verlauf?: boolean
  wiedervorlagen?: Record<string, string>
  todos?: Record<string, string>
  chance?: 'gesetzt' | 'vorschlag'
  vermittler?: boolean
  hinweise?: string[]
}

export type Verteilung = {
  version: 1
  status: 'laeuft' | 'fertig' | 'fehler'
  /** Seit wann der Vorschlag berechnet wird (bei status laeuft). */
  seit?: string
  erstellt_am?: string
  von?: string
  fehler?: string
  hinweis?: string
  abschnitte: VerteilAbschnitt[]
  ergebnisse: Record<string, VerteilErgebnis>
}

/** Akte für den Abgleich (nur, was der Aufrufer sehen darf). */
export type VerteilAkte = {
  id: string
  bereich: string
  firma: string | null
  ansprechpartner: string | null
  email?: string | null
  verantwortlich_email?: string | null
}

export type VerteilTreffer = { id: string; name: string; bereich: string; punkte: number; grund: string }

export type VerteilVorschlag =
  | { art: 'akte'; kundeId: string; sicher: boolean }
  | { art: 'neu'; bereich: string }
  | { art: 'ueberspringen' }

export type TeamKurz = { name: string; email: string }

// ─── Feste Werte ─────────────────────────────────────────────────────────────────────────────────

export const SAMMELAKTEN_VERTEILEN = ['k_intern_holding', 'k_eingang_ungeklaert']
export const NEUANLAGE_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
export const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}
/** Ab so vielen Punkten und klarem Abstand zum Zweiten gilt ein Treffer als sicher. */
export const SICHER_AB = 80
const ABSTAND_SICHER = 15
const MINDEST_PUNKTE = 45
const HOECHSTENS_TREFFER = 5
/** Läuft die Berechnung länger, gilt sie als abgebrochen (Worker beendet) und darf neu starten. */
export const LAEUFT_HOECHSTENS_MS = 7 * 60_000

// ─── Kleine Helfer ───────────────────────────────────────────────────────────────────────────────

function txt(x: unknown, n = 500): string {
  return typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : typeof x === 'number' && Number.isFinite(x) ? String(x) : ''
}

function langtext(x: unknown, n: number): string {
  return typeof x === 'string' ? x.replace(/[ \t]+/g, ' ').trim().slice(0, n) : ''
}

/** Betrag in Euro (Zahl oder „1.234,50“) → Zahl > 0, sonst undefined. */
export function betrag(x: unknown): number | undefined {
  let n: number
  if (typeof x === 'number') n = x
  else if (typeof x === 'string') {
    let s = x.replace(/[^\d,.-]/g, '')
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '')
    n = Number(s)
  } else return undefined
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

export function istDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function istMonat(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
}

export function deDatum(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

/** Anzeigename einer Akte wie im CRM. */
export function akteName(a: { firma?: string | null; ansprechpartner?: string | null; id?: string }): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  if (f && p && f !== p && !f.toLowerCase().includes(p.toLowerCase())) return `${p} (${f})`
  return f || p || String(a.id ?? '')
}

/** Kurzer, stabiler Streuwert (FNV-1a, 32 Bit) als Hex. */
export function streuwert(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function aufnahmeKurz(aufnahmeId: string): string {
  return aufnahmeId.replace(/-/g, '').slice(0, 12)
}

/** Feste Kennung des Gesprächsprotokolls je Aufnahme und Akte (auch das Skript vom 24.11.2026 nutzt sie). */
export function protokollIdFuer(aufnahmeId: string, kundeId: string): string {
  return `p_vert_${aufnahmeKurz(aufnahmeId)}_${kundeId}`
}

/** Feste Kennung einer neuen Akte je Aufnahme und Name — ein zweiter Aufruf legt sie nicht noch einmal an. */
export function neueAkteId(aufnahmeId: string, name: string): string {
  const schluessel = namensWoerter(name).join(' ') || grundform(name).trim()
  return `k_${aufnahmeKurz(aufnahmeId).slice(0, 4)}${streuwert(schluessel)}`
}

function norm(s: string): string {
  return grundform(s).replace(/[^a-z0-9]+/g, ' ').trim()
}

export function wvSchluessel(w: VerteilWv): string {
  return `wv:${norm(w.titel).slice(0, 80)}|${w.faellig}`
}

export function todoSchluessel(t: VerteilTodo): string {
  return `td:${norm(t.text).slice(0, 80)}`
}

/** Teammitglied zu einem genannten Namen (voller Name, Vor- oder Nachname; nur eindeutig). */
export function teamMitgliedZu(name: string | undefined, team: TeamKurz[]): TeamKurz | undefined {
  const n = norm(String(name ?? ''))
  if (!n) return undefined
  const teile = n.split(' ')
  const treffer = team.filter((m) => {
    const voll = norm(m.name)
    const w = voll.split(' ')
    return voll === n || teile.every((t) => w.includes(t))
  })
  return treffer.length === 1 ? treffer[0] : undefined
}

// ─── KI: Werkzeug und Antwort prüfen ────────────────────────────────────────────────────────────

export const VERTEIL_WERKZEUG_NAME = 'abschnitte_speichern'

export function verteilWerkzeug(): { name: string; description: string; input_schema: Record<string, unknown> } {
  const s = { type: 'string' }
  return {
    name: VERTEIL_WERKZEUG_NAME,
    description: 'Speichert die Abschnitte der Aufnahme, je Kunde bzw. Vorgang einer.',
    input_schema: {
      type: 'object',
      properties: {
        abschnitte: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name des Kunden bzw. Vorgangs, wie er genannt wurde.' },
              firma: { type: 'string', description: 'Firma, falls genannt.' },
              person: { type: 'string', description: 'Person (Vor- und Nachname), falls genannt.' },
              suchnamen: { type: 'array', items: s, description: 'Andere mögliche Schreibweisen des Namens (die Abschrift schreibt Namen oft falsch).' },
              akte_ids: { type: 'array', items: s, description: 'Kennungen (k_…) passender Akten aus der Liste — nur, wenn Name eindeutig passt; sonst leer.' },
              bereich: { type: 'string', enum: NEUANLAGE_BEREICHE, description: 'Bereich, in den eine neue Akte gehören würde.' },
              bezug: { type: 'string', description: 'Woher der Kunde kommt (z. B. Vermittler, Empfehlung), nur wenn gesagt.' },
              vermittler: { type: 'string', description: 'Name des Vermittlers bzw. Tippgebers, nur wenn genannt.' },
              stand: { type: 'string', description: 'Stand in ein bis drei Sätzen, sachlich, in seinen Worten.' },
              bezahlt: { type: 'number', description: 'Schon bezahlter Betrag in Euro, nur wenn gesagt.' },
              erwartet_netto: { type: 'number', description: 'Noch erwarteter Betrag netto in Euro, nur wenn gesagt.' },
              erwartet_monat: { type: 'string', description: 'Monat, in dem der erwartete Betrag kommt, als JJJJ-MM, nur wenn erkennbar.' },
              chance_prozent: { type: 'number', description: 'Chance auf den Auftrag bzw. das Geld in Prozent (0–100), nur aus seinen Aussagen.' },
              chance_begruendung: { type: 'string', description: 'Begründung der Chance aus seinen Aussagen (ein Satz).' },
              wiedervorlagen: { type: 'array', items: { type: 'object', properties: { titel: s, faellig: { type: 'string', description: 'JJJJ-MM-TT' } }, required: ['titel'] } },
              todos: { type: 'array', items: { type: 'object', properties: { text: s, zustaendig: { type: 'string', description: 'Name des Zuständigen, wenn genannt.' }, faellig: { type: 'string', description: 'JJJJ-MM-TT' } }, required: ['text'] } },
              offene_fragen: { type: 'array', items: s, description: 'Was unklar ist oder er selbst offenlässt.' },
              auszug: { type: 'string', description: 'Wortlaut der Abschrift zu diesem Kunden (unverändert, zusammenhängend).' },
            },
            required: ['name', 'stand'],
          },
        },
        hinweis: { type: 'string', description: 'Kurzer Hinweis, falls etwas an der Aufnahme auffällt (z. B. Teile unverständlich). Sonst leer.' },
      },
      required: ['abschnitte'],
    },
  }
}

export function verteilSystem(): string {
  return [
    'Du zerlegst eine gesprochene Notiz eines Mitarbeiters der Mayer Holding, in der er nacheinander mehrere Kunden bzw. Vorgänge durchgeht, in Abschnitte: je Kunde bzw. Vorgang einer, in der Reihenfolge der Aufnahme.',
    'Grundregel: Nur was gesagt wurde. Nichts erfinden, nichts schätzen. Felder, zu denen nichts gesagt wurde, weglassen bzw. leere Liste.',
    'Werden zwei Personen unter einer Nummer genannt, die erkennbar zwei verschiedene Akten sind (z. B. „einmal die Eltern und einmal der Sohn“), sind es zwei Abschnitte mit gleichem Stand.',
    'Schreibe in einfachem, klarem Deutsch ohne englische Wörter. Daten als JJJJ-MM-TT, Monate als JJJJ-MM; rechne Angaben wie „nächste Woche“ oder „Anfang Dezember“ vom Datum der Aufnahme aus um. Ohne erkennbaren Tag: Wiedervorlage ohne Datum.',
    'Beträge als Zahl in Euro. „bezahlt“ = schon eingegangen; „erwartet_netto“ = noch erwartet (netto; sagt er brutto, rechne nicht um, sondern nenne es in der Begründung).',
    'Chance nur, wenn er etwas dazu sagt, woraus sie sich ableiten lässt (z. B. „das kommt sicher“ = 90, „aufgeschoben“ = 20, „abgesagt“ = 0); die Begründung zitiert sinngemäß seine Aussage.',
    'akte_ids: Vergleiche den Namen mit der Liste der Akten; nimm nur Akten, die eindeutig dieselbe Person bzw. Firma sind (auch bei abweichender Schreibweise). Im Zweifel leer lassen — der Mitarbeiter wählt dann selbst.',
    'zustaendig bei To-dos: nur ein Name aus der Liste der Mitarbeiter oder weglassen (dann macht es der Sprecher selbst).',
    `Antworte ausschließlich, indem du das Werkzeug ${VERTEIL_WERKZEUG_NAME} aufrufst, ohne weiteren Text.`,
  ].join('\n')
}

export function verteilPrompt(a: { tag: string; wochentag: string; titel?: string | null; sprecher: string; team: string[]; akten: VerteilAkte[]; abschrift: string; notizen?: string | null }): string {
  const aktenListe = a.akten.map((k) => `${k.id} | ${akteName(k).slice(0, 120)} | ${BEREICH_NAME[k.bereich] ?? k.bereich}`).join('\n')
  return [
    `Datum der Aufnahme: ${a.wochentag}, ${a.tag}.`,
    `Sprecher: ${a.sprecher}.`,
    a.titel ? `Titel der Aufnahme: ${txt(a.titel, 200)}` : '',
    a.team.length ? `Mitarbeiter der Mayer Holding: ${a.team.join(', ')}` : '',
    `Vorhandene Akten (Kennung | Name | Bereich):\n${aktenListe || '(keine)'}`,
    txt(a.notizen) ? `Notizen des Mitarbeiters:\n${langtext(a.notizen, 5000)}` : '',
    `Abschrift:\n${a.abschrift}`,
  ].filter(Boolean).join('\n\n')
}

/** KI-Antwort → geprüfte Abschnitte (unbrauchbare fallen weg, Daten und Beträge werden geprüft). */
// deno-lint-ignore no-explicit-any
export function normalisiereAbschnitte(roh: any, gueltigeIds: Set<string>): { abschnitte: VerteilAbschnitt[]; hinweis?: string } {
  const liste = Array.isArray(roh?.abschnitte) ? roh.abschnitte : []
  const aus: VerteilAbschnitt[] = []
  for (const x of liste.slice(0, 120)) {
    const name = txt(x?.name, 200)
    const stand = langtext(x?.stand, 2000)
    if (!name || !stand) continue
    const p = Number(x?.chance_prozent)
    const chance = Number.isFinite(p) && x?.chance_prozent !== null && x?.chance_prozent !== undefined
      ? { prozent: Math.max(0, Math.min(100, Math.round(p / 5) * 5)), begruendung: txt(x?.chance_begruendung, 500) }
      : undefined
    const wv = (Array.isArray(x?.wiedervorlagen) ? x.wiedervorlagen : [])
      .map((w: unknown) => ({ titel: txt((w as Record<string, unknown>)?.titel, 300), faellig: istDatum((w as Record<string, unknown>)?.faellig) ? String((w as Record<string, unknown>).faellig) : '' }))
      .filter((w: VerteilWv) => w.titel)
      .slice(0, 10)
    const todos = (Array.isArray(x?.todos) ? x.todos : [])
      .map((t: unknown) => {
        const r = t as Record<string, unknown>
        const aus: VerteilTodo = { text: txt(r?.text, 400) }
        if (istDatum(r?.faellig)) aus.faellig = String(r.faellig)
        const z = txt(r?.zustaendig, 80)
        if (z) aus.zustaendig = z
        return aus
      })
      .filter((t: VerteilTodo) => t.text)
      .slice(0, 10)
    const a: VerteilAbschnitt = {
      nr: aus.length,
      name,
      stand,
      wiedervorlagen: wv,
      todos,
      offeneFragen: (Array.isArray(x?.offene_fragen) ? x.offene_fragen : []).map((f: unknown) => txt(f, 300)).filter(Boolean).slice(0, 10),
    }
    const firma = txt(x?.firma, 200)
    const person = txt(x?.person, 200)
    const suchnamen = (Array.isArray(x?.suchnamen) ? x.suchnamen : []).map((s: unknown) => txt(s, 200)).filter(Boolean).slice(0, 6)
    const ids = [...new Set((Array.isArray(x?.akte_ids) ? x.akte_ids : []).map((s: unknown) => txt(s, 80)).filter((id: string) => gueltigeIds.has(id)))].slice(0, 5) as string[]
    const bereich = txt(x?.bereich, 40)
    if (firma) a.firma = firma
    if (person) a.person = person
    if (suchnamen.length) a.suchnamen = suchnamen
    if (ids.length) a.akteIds = ids
    if (NEUANLAGE_BEREICHE.includes(bereich)) a.bereichVorschlag = bereich
    const bezug = txt(x?.bezug, 300)
    const vermittler = txt(x?.vermittler, 120)
    if (bezug) a.bezug = bezug
    if (vermittler) a.vermittler = vermittler
    const bez = betrag(x?.bezahlt)
    const erw = betrag(x?.erwartet_netto)
    if (bez) a.bezahlt = bez
    if (erw) a.erwartetNetto = erw
    if (istMonat(x?.erwartet_monat)) a.erwartetMonat = x.erwartet_monat
    if (chance) a.chance = chance
    const auszug = langtext(x?.auszug, 8000)
    if (auszug) a.auszug = auszug
    aus.push(a)
  }
  const hinweis = txt(roh?.hinweis, 500)
  return hinweis ? { abschnitte: aus, hinweis } : { abschnitte: aus }
}

// ─── Abgleich mit den Akten ──────────────────────────────────────────────────────────────────────

/** Akten, die für den Abgleich in Frage kommen: ohne Sammelakten, ohne private Akten anderer, nur sichtbare Bereiche. */
export function aktenFuerAbgleich(akten: VerteilAkte[], ich: string, sichtbar: (bereich: string) => boolean): VerteilAkte[] {
  const mail = ich.trim().toLowerCase()
  return akten.filter((a) => {
    if (SAMMELAKTEN_VERTEILEN.includes(a.id)) return false
    if (a.bereich === 'privat') return String(a.verantwortlich_email ?? '').trim().toLowerCase() === mail
    return sichtbar(a.bereich)
  })
}

// Wörter, die in gesprochenen Notizen vor Namen stehen und nichts über die Person sagen.
const FUELLWOERTER = new Set(['eltern', 'sohn', 'tochter', 'mutter', 'vater', 'bruder', 'schwester', 'ehepaar', 'paar', 'kunde', 'kundin', 'mandant', 'mandantin', 'position', 'nummer', 'einmal', 'auch', 'noch'])

function woerter(s: string | null | undefined): string[] {
  return namensWoerter(s).filter((w) => w.length >= 3 && !FUELLWOERTER.has(w) && !/^\d+$/.test(w))
}

type WortTreffer = 'genau' | 'unscharf' | null

function wortTrifft(q: string, k: string): WortTreffer {
  if (q === k) return 'genau'
  if (q.length >= 4 && k.length >= 4) {
    const grenze = Math.min(q.length, k.length) >= 8 ? 2 : 1
    if (abstand(q, k, grenze) <= grenze) return 'unscharf'
    // „Müllers“ ↔ „Müller“, „Kellermann“ nicht ↔ „Keller“ (nur ein, zwei Zeichen Endung)
    const [kurz, lang] = q.length <= k.length ? [q, k] : [k, q]
    if (kurz.length >= 5 && lang.startsWith(kurz) && lang.length - kurz.length <= 2) return 'unscharf'
  }
  return null
}

/** Punkte für einen genannten Namen gegen die Namenswörter einer Akte (0 = passt nicht). */
export function namensPunkte(genannt: string, akteWoerter: string[]): { punkte: number; grund: string } {
  const qw = woerter(genannt)
  if (qw.length === 0 || akteWoerter.length === 0) return { punkte: 0, grund: '' }
  let genau = 0
  let unscharf = 0
  let langerTreffer = false
  for (const q of qw) {
    let bester: WortTreffer = null
    for (const k of akteWoerter) {
      const t = wortTrifft(q, k)
      if (t === 'genau') {
        bester = 'genau'
        break
      }
      if (t === 'unscharf') bester = 'unscharf'
    }
    if (bester === 'genau') genau++
    if (bester === 'unscharf') unscharf++
    if (bester && q.length >= 4) langerTreffer = true
  }
  const getroffen = genau + unscharf
  if (getroffen === 0 || !langerTreffer) return { punkte: 0, grund: '' }
  if (getroffen === qw.length) {
    const basis = qw.length >= 2 ? 100 : 85
    const p = basis - unscharf * 15
    return { punkte: p, grund: unscharf ? 'Name passt, anders geschrieben' : qw.length >= 2 ? 'gleicher Name' : 'gleicher Nachname bzw. Firmenname' }
  }
  return { punkte: 50 + 10 * (getroffen - 1) - unscharf * 10, grund: 'Teil des Namens passt' }
}

function akteWoerter(a: VerteilAkte): string[] {
  const klammer = [...String(a.firma ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
  return [...new Set([...woerter(a.firma), ...woerter(a.ansprechpartner), ...klammer.flatMap((k) => woerter(k))])]
}

/** Passende Akten zu einem Abschnitt, beste zuerst (höchstens fünf). */
export function findeTreffer(ab: Pick<VerteilAbschnitt, 'name' | 'firma' | 'person' | 'suchnamen' | 'akteIds'>, akten: VerteilAkte[]): VerteilTreffer[] {
  const genannt = [ab.name, ab.firma, ab.person, ...(ab.suchnamen ?? [])].filter((s): s is string => !!s && !!s.trim())
  const kiIds = new Set(ab.akteIds ?? [])
  const aus: VerteilTreffer[] = []
  for (const a of akten) {
    const aw = akteWoerter(a)
    let best = { punkte: 0, grund: '' }
    for (const g of genannt) {
      const r = namensPunkte(g, aw)
      if (r.punkte > best.punkte) best = r
    }
    if (kiIds.has(a.id)) best = best.punkte > 0 ? { punkte: Math.min(100, best.punkte + 10), grund: `${best.grund}; auch vom KI-Abgleich vorgeschlagen` } : { punkte: 70, grund: 'vom KI-Abgleich vorgeschlagen' }
    if (best.punkte >= MINDEST_PUNKTE) aus.push({ id: a.id, name: akteName(a), bereich: a.bereich, punkte: best.punkte, grund: best.grund })
  }
  return aus.sort((x, y) => y.punkte - x.punkte || x.name.localeCompare(y.name, 'de')).slice(0, HOECHSTENS_TREFFER)
}

/** Vorschlag für einen Abschnitt: sichere Akte, beste Akte zur Prüfung oder neue Akte im passenden Bereich. */
export function vorschlagFuer(ab: Pick<VerteilAbschnitt, 'bereichVorschlag'>, treffer: VerteilTreffer[], erlaubteBereiche: string[]): VerteilVorschlag {
  const [erster, zweiter] = treffer
  if (erster) {
    const sicher = erster.punkte >= SICHER_AB && (!zweiter || zweiter.punkte <= erster.punkte - ABSTAND_SICHER)
    return { art: 'akte', kundeId: erster.id, sicher }
  }
  const bereich = ab.bereichVorschlag && erlaubteBereiche.includes(ab.bereichVorschlag) ? ab.bereichVorschlag : erlaubteBereiche[0]
  return bereich ? { art: 'neu', bereich } : { art: 'ueberspringen' }
}

// ─── Bearbeitete Fassung ─────────────────────────────────────────────────────────────────────────

/** Gespeicherten Abschnitt mit den Änderungen des Mitarbeiters überlagern (nur bekannte Felder). */
// deno-lint-ignore no-explicit-any
export function wirksamerAbschnitt(ab: VerteilAbschnitt, e: any): VerteilAbschnitt {
  if (!e || typeof e !== 'object') return ab
  const aus: VerteilAbschnitt = { ...ab }
  if (typeof e.stand === 'string' && e.stand.trim()) aus.stand = langtext(e.stand, 2000)
  if ('bezahlt' in e) aus.bezahlt = betrag(e.bezahlt)
  if ('erwartetNetto' in e) aus.erwartetNetto = betrag(e.erwartetNetto)
  if ('erwartetMonat' in e) aus.erwartetMonat = istMonat(e.erwartetMonat) ? e.erwartetMonat : undefined
  if ('vermittler' in e) aus.vermittler = txt(e.vermittler, 120) || undefined
  if ('chance' in e) {
    const p = Number(e.chance?.prozent)
    aus.chance = e.chance && Number.isFinite(p) ? { prozent: Math.max(0, Math.min(100, Math.round(p / 5) * 5)), begruendung: txt(e.chance.begruendung, 500) } : undefined
  }
  if (Array.isArray(e.wiedervorlagen)) {
    aus.wiedervorlagen = e.wiedervorlagen.map((w: Record<string, unknown>) => ({ titel: txt(w?.titel, 300), faellig: istDatum(w?.faellig) ? String(w.faellig) : '' })).filter((w: VerteilWv) => w.titel).slice(0, 20)
  }
  if (Array.isArray(e.todos)) {
    aus.todos = e.todos
      .map((t: Record<string, unknown>) => {
        const x: VerteilTodo = { text: txt(t?.text, 400) }
        if (istDatum(t?.faellig)) x.faellig = String(t.faellig)
        const z = txt(t?.zustaendig, 80)
        const m = txt(t?.zustaendig_email, 200).toLowerCase()
        if (z) x.zustaendig = z
        if (m) x.zustaendig_email = m
        return x
      })
      .filter((t: VerteilTodo) => t.text)
      .slice(0, 20)
  }
  if (Array.isArray(e.offeneFragen)) aus.offeneFragen = e.offeneFragen.map((f: unknown) => txt(f, 300)).filter(Boolean).slice(0, 20)
  return aus
}

// ─── Texte ───────────────────────────────────────────────────────────────────────────────────────

export function betraegeText(ab: Pick<VerteilAbschnitt, 'bezahlt' | 'erwartetNetto' | 'erwartetMonat'>): string {
  return [
    ab.bezahlt ? `bezahlt ${euro(ab.bezahlt)}` : '',
    ab.erwartetNetto ? `erwartet ${euro(ab.erwartetNetto)} netto${ab.erwartetMonat ? ` im ${monatName(ab.erwartetMonat)}` : ''}` : '',
  ].filter(Boolean).join(', ')
}

/** Gegliederter Protokolltext für eine Akte (ein oder mehrere Abschnitte derselben Akte). */
export function protokollText(teile: VerteilAbschnitt[], m: { sprecher: string; datum: string; titel?: string | null; link: string }): string {
  const zeilen: string[] = [`Aus der Sprachnotiz${m.titel ? ` „${txt(m.titel, 200)}“` : ''} von ${m.sprecher} vom ${deDatum(m.datum)} — nur der Teil zu ${teile.map((t) => t.name).join(' und ')}.`]
  for (const t of teile) {
    const block = [
      teile.length > 1 ? `${t.name}:` : '',
      t.bezug ? `Bezug: ${t.bezug}` : '',
      t.vermittler ? `Vermittler: ${t.vermittler}` : '',
      `Stand: ${t.stand}`,
      t.bezahlt ? `Bezahlt: ${euro(t.bezahlt)}` : '',
      t.erwartetNetto ? `Erwartet: ${euro(t.erwartetNetto)} netto${t.erwartetMonat ? ` im ${monatName(t.erwartetMonat)}` : ''}` : '',
      t.chance ? `Chance: ${t.chance.prozent} %${t.chance.begruendung ? ` — ${t.chance.begruendung}` : ''}` : '',
      t.wiedervorlagen.length ? `Wiedervorlagen:\n${t.wiedervorlagen.map((w) => `- ${w.titel}${w.faellig ? ` (${deDatum(w.faellig)})` : ''}`).join('\n')}` : '',
      t.todos.length ? `To-dos:\n${t.todos.map((x) => `- ${x.text}${x.zustaendig ? ` (${x.zustaendig})` : ''}${x.faellig ? `, bis ${deDatum(x.faellig)}` : ''}`).join('\n')}` : '',
      t.offeneFragen.length ? `Offene Fragen:\n${t.offeneFragen.map((f) => `- ${f}`).join('\n')}` : '',
      t.auszug ? `Wortlaut aus der Aufnahme:\n${t.auszug}` : '',
    ].filter(Boolean)
    zeilen.push(block.join('\n'))
  }
  if (m.link) zeilen.push(`Aufnahme in der App: ${m.link}`)
  return zeilen.join('\n\n')
}

/** Verlaufseintrag in der Akte. */
export function verlaufText(teile: VerteilAbschnitt[], m: { sprecher: string; datum: string; angelegt: string[] }): string {
  const stand = teile.map((t) => {
    const b = betraegeText(t)
    return `${teile.length > 1 ? `${t.name}: ` : ''}${t.stand}${b ? ` (${b})` : ''}`
  }).join(' ')
  return `Sprachnotiz von ${m.sprecher} vom ${deDatum(m.datum)}: ${stand}${m.angelegt.length ? ` — angelegt: ${m.angelegt.join(', ')}` : ''}`.slice(0, 4000)
}

/** Kurze Zeile je Abschnitt (Telegram, Liste). */
export function kurzText(ab: VerteilAbschnitt): string {
  const b = betraegeText(ab)
  return [
    ab.stand.length > 220 ? `${ab.stand.slice(0, 219).trimEnd()}…` : ab.stand,
    b,
    ab.chance ? `Chance ${ab.chance.prozent} %` : '',
    ab.wiedervorlagen.length ? `${ab.wiedervorlagen.length} Wiedervorlage${ab.wiedervorlagen.length === 1 ? '' : 'n'}` : '',
    ab.todos.length ? `${ab.todos.length} To-do${ab.todos.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')
}

// ─── Chance ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Was für die Chance geschrieben wird. Eine bestätigte Chance wird nie überschrieben — dann nur ein Vorschlag
 * (chance_vorschlag). Immobilien-Kunden ohne Umsatz (die Provision zählt über das Objekt, Regel aus chanceKern.ts).
 * Private Kontakte und Abschnitte ohne Angabe zur Chance: nichts.
 */
export function chanceFuer(
  teile: Pick<VerteilAbschnitt, 'chance' | 'erwartetNetto' | 'erwartetMonat'>[],
  akte: { bereich: string; auftrag_chance?: unknown },
  wer: { name: string; am: string },
): { feld: 'auftrag_chance'; wert: GespeicherteChance } | { feld: 'chance_vorschlag'; wert: ChanceVorschlag } | null {
  if (akte.bereich === 'privat' || akte.bereich === 'intern') return null
  const mitChance = teile.filter((t) => t.chance)
  if (mitChance.length === 0) return null
  const prozent = Math.max(...mitChance.map((t) => t.chance!.prozent))
  const begruendung = mitChance.map((t) => t.chance!.begruendung).filter(Boolean).join(' ').slice(0, 500) || 'Aus der Sprachnotiz.'
  const immo = akte.bereich === 'immobilienkunden'
  const summe = teile.reduce((s, t) => s + (t.erwartetNetto ?? 0), 0)
  const umsatz = !immo && summe > 0 ? Math.round(summe * 100) / 100 : undefined
  const monat = umsatz ? teile.map((t) => t.erwartetMonat).filter((x): x is string => !!x).sort()[0] : undefined
  const alt = akte.auftrag_chance && typeof akte.auftrag_chance === 'object' ? (akte.auftrag_chance as Record<string, unknown>) : null
  if (alt?.bestaetigt === true) {
    return {
      feld: 'chance_vorschlag',
      wert: { prozent, umsatzNetto: umsatz ?? null, monat: monat ?? null, begruendung: `Aus der Sprachnotiz: ${begruendung}`, umsatzQuelle: umsatz ? 'ki' : immo ? 'objekt' : 'keine', quelle: 'ki', am: wer.am, chanceBestaetigt: true },
    }
  }
  const wert: GespeicherteChance = { prozent, bestaetigt: false, begruendung, von: wer.name, am: wer.am }
  if (umsatz) {
    wert.umsatzNetto = umsatz
    if (monat) wert.monat = monat
  }
  return { feld: 'auftrag_chance', wert }
}

// ─── Gruppieren ──────────────────────────────────────────────────────────────────────────────────

/** Abschnitte nach Ziel-Akte zusammenfassen (zwei Abschnitte derselben Akte = ein Protokoll). */
export function nachAkte<T extends { kundeId: string; abschnitt: VerteilAbschnitt }>(liste: T[]): Map<string, T[]> {
  const aus = new Map<string, T[]>()
  for (const x of liste) aus.set(x.kundeId, [...(aus.get(x.kundeId) ?? []), x])
  return aus
}

/** Pfad der Akte im CRM (HashRouter), wie src/App.tsx. */
export function aktePfadVerteilen(bereich: string, id: string): string {
  const basis: Record<string, string> = {
    beratung: '/beratung/kunden/',
    immobilienkunden: '/immobilien/kunden/',
    erben: '/erben/mandanten/',
    betriebsuebergabe: '/betriebsuebergabe/mandanten/',
    betriebsformen: '/betriebsformen/mandanten/',
    finanzierungen: '/finanzierungen/mandanten/',
    akademie: '/akademie/teilnehmer/',
    privat: '/privat/kontakte/',
  }
  return `${basis[bereich] ?? '/beratung/kunden/'}${encodeURIComponent(id)}`
}

export function akteLinkVerteilen(basis: string, bereich: string, id: string): string {
  return `${basis.endsWith('/') ? basis : `${basis}/`}#${aktePfadVerteilen(bereich, id)}`
}

/** Leere Verteilung (Spalte noch leer oder unbekanntes Format). */
// deno-lint-ignore no-explicit-any
export function leseVerteilung(roh: any): Verteilung | null {
  if (!roh || typeof roh !== 'object' || !['laeuft', 'fertig', 'fehler'].includes(roh.status)) return null
  return {
    version: 1,
    status: roh.status,
    seit: typeof roh.seit === 'string' ? roh.seit : undefined,
    erstellt_am: typeof roh.erstellt_am === 'string' ? roh.erstellt_am : undefined,
    von: typeof roh.von === 'string' ? roh.von : undefined,
    fehler: typeof roh.fehler === 'string' ? roh.fehler : undefined,
    hinweis: typeof roh.hinweis === 'string' ? roh.hinweis : undefined,
    abschnitte: Array.isArray(roh.abschnitte) ? roh.abschnitte : [],
    ergebnisse: roh.ergebnisse && typeof roh.ergebnisse === 'object' ? roh.ergebnisse : {},
  }
}
