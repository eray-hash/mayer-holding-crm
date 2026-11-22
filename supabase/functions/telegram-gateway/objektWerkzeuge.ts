// Assistent-Werkzeuge zum Anlegen und Ändern von Immobilien-Objekten und zum Ablegen von Dateien in der
// Objektakte (22.11.2026). Anlass: Die Geschäftsführung wollte per Telegram eine Objektakte anlegen
// („Boarding House Remstal“, von einem Makler angeboten); der Assistent konnte nur lesen
// (objekte_suchen / objektakte_lesen, objektakte.ts), legte ersatzweise eine Kundenakte an und parkte
// Exposé und Prospekt dort.
//
// Spalten und Formen genau wie das CRM sie liest (src/types/index.ts `Objekt`, src/lib/crmSync.ts
// objektToRow/rowToObjekt):
//  - follow_up {date, note, done}, activities [{id, date, text, user}] (neueste zuerst),
//    eigentuemer {name, telefon, email, ansprechpartner?}, dokumente { Ordner: Dokument[] }.
//  - Objekt-Dokumente liegen im privaten Eimer "objekt-dokumente" unter "<objektId>/<dokId>_<name>"
//    (wie src/lib/objektDokumenteStorage.ts); die url ist dort der Pfad. Der erste Pfadteil muss die
//    objekt_id sein — daran hängt die Speicherregel für private Objekte (fremder_privater_ordner).
//  - Private Objekte: objekte.privat_besitzer = Adresse des Besitzers, klein geschrieben (wie
//    ObjektListe.tsx im privaten Bereich). Leer = Objekt der Holding.
//  - Ein Feld für den anbietenden Makler gibt es nicht; das Verkaufsdatenblatt (verkaufsdaten) darf nicht
//    halb gefüllt werden (das Blatt erwartet alle Teile). Der Anbieter kommt deshalb in den Verlauf.
//
// Geschrieben werden immer nur die geänderten Spalten — nie die ganze Zeile. Verlauf und Dokumente
// führt das Browserfenster beim nächsten Speichern mit dem Stand der Datenbank zusammen
// (schreibeObjekt in crmSync.ts), deshalb gehen Einträge des Servers dort nicht verloren.
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregeln der
// Datenbank nach: Objekte der Holding nur mit Rechten für Immobilien (darfObjekte), private Objekte nur
// ihr Besitzer (darfObjekt), Kundenakten nach darfAkte. Löschen gibt es hier bewusst nicht.

import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { speicherOrt } from './dateiSenden.ts'
import { OBJEKT_STATUS, objektStatus, type ObjektDokument, type ObjektRow, sucheObjekte } from './objektakte.ts'
import { adresse, darfAkte, darfObjekt, darfObjekte, istFremdePrivatakte, istPrivat, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type ObjektKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

/** Genau die Ordner der Objektakte (DOKUMENT_ORDNER in src/types/index.ts, auch email-gateway/eingang.ts). */
export const OBJEKT_ORDNER = [
  'Aktennotiz', 'Angebote', 'Baulastenauskunft', 'Betriebskostenabrechnung', 'Bilder', 'Energieausweis', 'Exposé',
  'Finanzierung', 'Flurkarte', 'Gebäudeversicherung', 'Genehmigung', 'Grundbuch', 'Grundrisse', 'Gutachten',
  'Kostenaufstellung', 'Lageplan', 'Leistungsverzeichnisse', 'Mieterliste', 'Mietverträge', 'Notarielle Dokumente',
  'Persönliche Daten des Eigentümers', 'Pläne', 'Protokolle', 'Sanierungsunterlagen', 'Sonstiges', 'Teilungserklärung',
  'Verträge', 'Wohnflächenberechnung',
] as const

/** Objektarten und Listen wie im CRM (OBJEKT_TYPEN / OBJEKT_GRUPPEN in src/data/constants.ts). */
export const OBJEKT_TYPEN = ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Neubauprojekt'] as const
export const OBJEKT_GRUPPEN: Record<string, string> = {
  aktuell: 'Aktuelle Objekte',
  ausland: 'Auslandsobjekte',
  'verkauf-intern': 'Verkaufsobjekte – Intern',
  'verkauf-extern': 'Verkaufsobjekte – Extern',
  projektierung: 'Projektierungen / Neubau',
}
const PRIORITAETEN = ['Hoch', 'Mittel', 'Niedrig']

const OBJEKT_EIMER = 'objekt-dokumente'
const TELEGRAM_EIMER = 'email-anhaenge'
const TELEGRAM_ORDNER = 'telegram'
const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'

const KEIN_OBJEKT = 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
const KEIN_KUNDE = 'Es gibt keine Kundenakte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'

const SPALTEN_AENDERN = 'id, bezeichnung, adresse, gruppe, typ, kaufpreis, prioritaet, status, follow_up, verantwortlich, activities, eigentuemer, off_market, privat_besitzer'

const STATUS_TEXT = Object.entries(OBJEKT_STATUS).map(([id, l]) => `${id} (${l})`).join(', ')

const eigentuemerSchema = {
  type: 'object',
  description: 'Optional: der Eigentümer (nicht der Makler).',
  properties: { name: { type: 'string' }, telefon: { type: 'string' }, email: { type: 'string' }, ansprechpartner: { type: 'string', description: 'Falls im Alltag eine andere Person als der Eigentümer zuständig ist.' } },
}

export const OBJEKT_SCHREIB_WERKZEUGE = [
  {
    name: 'objekt_anlegen',
    description:
      'Legt eine NEUE Objektakte (Immobilien-Objekt) an — immer dann, wenn jemand ein Objekt, eine Immobilie oder eine Objektakte anlegen will (auch wenn es von einem Makler angeboten wird). Nie stattdessen eine Kundenakte anlegen. ' +
      'Vorher wird nach einem schon vorhandenen gleichen Objekt (gleiche Adresse oder Bezeichnung) gesucht; gibt es eines, wird nichts angelegt und die objekt_id des vorhandenen genannt. Nur wenn der Mitarbeiter bestätigt, dass es wirklich ein anderes Objekt ist, erneut mit trotzdem=true. ' +
      'Im privaten Assistenten entsteht ein privates Objekt, das nur er sieht. Dateien (Exposé, Grundbuch …) danach mit dateien_ins_objekt in die Akte legen.',
    input_schema: {
      type: 'object',
      properties: {
        bezeichnung: { type: 'string', description: 'Name des Objekts, z. B. "Boarding House Remstal" oder "MFH Lorch".' },
        adresse: { type: 'string', description: 'Straße, Hausnummer, PLZ Ort, z. B. "Teckstraße 62, 73547 Lorch".' },
        typ: { type: 'string', enum: [...OBJEKT_TYPEN], description: 'Objektart. Boarding House, Hotel, Büro, Laden, Halle → Gewerbe; Mehrfamilien-, Einfamilien-, Wohn- und Geschäftshaus → Haus.' },
        kaufpreis: { type: ['number', 'string'], description: 'Kaufpreis in Euro, z. B. 1200000 oder "1,2 Mio".' },
        status: { type: 'string', enum: Object.keys(OBJEKT_STATUS), description: `Vorgabe akquise. Möglich: ${STATUS_TEXT}.` },
        gruppe: { type: 'string', enum: Object.keys(OBJEKT_GRUPPEN), description: 'Liste in der Objektübersicht, Vorgabe aktuell (Aktuelle Objekte).' },
        prioritaet: { type: 'string', enum: PRIORITAETEN, description: 'Vorgabe Mittel.' },
        verantwortlich: { type: 'string', description: 'Name eines Mitarbeiters; ohne Angabe der Mitarbeiter selbst.' },
        anbieter: {
          type: 'object',
          description: 'Optional: wer das Objekt angeboten hat (Makler, Tippgeber, Vermittler). Wird im Verlauf der Akte vermerkt.',
          properties: { art: { type: 'string', description: 'z. B. Makler, Tippgeber, Vermittler.' }, name: { type: 'string' }, firma: { type: 'string' }, telefon: { type: 'string' }, email: { type: 'string' } },
        },
        eigentuemer: eigentuemerSchema,
        follow_up_datum: { type: 'string', description: 'Optional: nächster Schritt fällig am (JJJJ-MM-TT), Vorgabe heute.' },
        follow_up_notiz: { type: 'string', description: 'Optional: was als Nächstes zu tun ist, Vorgabe "Objekt aufgenommen".' },
        nicht_oeffentlich: { type: 'boolean', description: 'true = wird nicht öffentlich angeboten (Off-Market).' },
        notiz: { type: 'string', description: 'Optional: weitere Angaben für den Verlauf (Eckdaten, Herkunft, Absprachen).' },
        privat: { type: 'boolean', description: 'true = privates Objekt des Mitarbeiters (nur er sieht es). Im privaten Assistenten immer.' },
        trotzdem: { type: 'boolean', description: 'true = trotz eines gefundenen ähnlichen Objekts anlegen (nur nach Bestätigung des Mitarbeiters).' },
      },
      required: ['bezeichnung', 'typ'],
    },
  },
  {
    name: 'objekt_aendern',
    description:
      'Ändert Eckdaten einer vorhandenen Objektakte: Bezeichnung, Adresse, Objektart, Liste, Kaufpreis, Status, Priorität, Verantwortlicher, Follow-up, Eigentümer, nicht öffentlich. Gib nur an, was sich ändert. Jede Änderung wird im Verlauf der Akte vermerkt; eine notiz allein schreibt nur einen Verlaufseintrag. objekt_id aus objekte_suchen.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string' },
        bezeichnung: { type: 'string' },
        adresse: { type: 'string' },
        typ: { type: 'string', enum: [...OBJEKT_TYPEN] },
        gruppe: { type: 'string', enum: Object.keys(OBJEKT_GRUPPEN) },
        kaufpreis: { type: ['number', 'string'], description: 'Kaufpreis in Euro.' },
        status: { type: 'string', enum: Object.keys(OBJEKT_STATUS), description: `Möglich: ${STATUS_TEXT}.` },
        prioritaet: { type: 'string', enum: PRIORITAETEN },
        verantwortlich: { type: 'string', description: 'Name eines aktiven Mitarbeiters.' },
        follow_up_datum: { type: 'string', description: 'JJJJ-MM-TT.' },
        follow_up_notiz: { type: 'string' },
        follow_up_erledigt: { type: 'boolean' },
        eigentuemer: { ...eigentuemerSchema, description: 'Nur die genannten Angaben werden geändert; ein leerer Text löscht die Angabe.' },
        nicht_oeffentlich: { type: 'boolean' },
        notiz: { type: 'string', description: 'Optional: Notiz für den Verlauf.' },
      },
      required: ['objekt_id'],
    },
  },
  {
    name: 'dateien_ins_objekt',
    description:
      'Legt Dateien in einen Ordner einer Objektakte: per Telegram geschickte Dateien (pfad="telegram/…" aus dem Datei-Eingang oder unzugeordnete_dateien) oder ein Dokument, das schon in einer Kundenakte liegt (kunde_id + dokument_id aus kundenakte_lesen). Die Datei wird in die Objektakte kopiert. ' +
      'Exposés, Prospekte, Grundbuchauszüge, Flächenaufstellungen, Pläne, Fotos, Mieterlisten zu einem Objekt gehören hierher, nicht in eine Kundenakte. Den Ordner wählst du nach dem Inhalt. Gleicher Name im selben Ordner: die Datei kommt als weitere Fassung „Name (2)“ dazu, nichts wird überschrieben. ' +
      'Mit aus_kundenakte_entfernen=true verschwindet ein aus einer Kundenakte übernommenes Dokument dort (nur der Eintrag, wie dokument_aus_akte_nehmen) — z. B. wenn es dort nur geparkt war. Aus „Ungeklärte Eingänge“ zieht es immer um.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string' },
        dateien: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pfad: { type: 'string', description: 'Per Telegram geschickte Datei, exakt wie angegeben, beginnt mit "telegram/".' },
              kunde_id: { type: 'string', description: 'Kundenakte, in der das Dokument liegt.' },
              dokument_id: { type: 'string', description: 'Dokument in dieser Kundenakte.' },
              ordner: { type: 'string', enum: [...OBJEKT_ORDNER], description: 'Ordner der Objektakte.' },
              name: { type: 'string', description: 'Optional: sprechender Dateiname, z. B. "Exposé Boarding House Remstal.pdf".' },
            },
            required: ['ordner'],
          },
        },
        aus_kundenakte_entfernen: { type: 'boolean', description: 'true = übernommene Dokumente danach aus der Kundenakte nehmen.' },
      },
      required: ['objekt_id', 'dateien'],
    },
  },
]

export function istObjektSchreibWerkzeug(name: string): boolean {
  return OBJEKT_SCHREIB_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Hilfen (rein, ohne Datenbank) ----------

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

function ohneZeichen(s: unknown): string {
  return norm(s).replace(/[^a-z0-9]/g, '')
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

export function deDatum(iso: unknown): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

export function euro(n: unknown): string {
  const z = typeof n === 'string' ? Number(n) : n
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(z)} €` : 'nicht eingetragen'
}

/** Datum JJJJ-MM-TT oder TT.MM.JJJJ, nur wenn es den Tag gibt; sonst undefined. */
export function pruefeDatum(v: unknown): string | undefined {
  const s = String(v ?? '').trim()
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  const iso = de ? `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}` : s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : ''
  if (!iso) return undefined
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso
}

/** Kaufpreis aus Zahl oder Text („1.200.000 €“, „1,2 Mio“, „950 Tsd.“). undefined = nicht lesbar. */
export function leseBetrag(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined
  let s = String(v ?? '').toLowerCase().replace(/€|eur(o)?|\s/g, '')
  if (!s) return undefined
  let faktor = 1
  if (/(mio|millionen?)\.?$/.test(s)) {
    faktor = 1_000_000
    s = s.replace(/(mio|millionen?)\.?$/, '')
  } else if (/(tsd|tausend|t)\.?$/.test(s)) {
    faktor = 1_000
    s = s.replace(/(tsd|tausend|t)\.?$/, '')
  }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  else s = s.replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined
  return Math.round(Number(s) * faktor)
}

/** Straße + Hausnummer als Vergleichsschlüssel („Teckstraße 62“ = „Teckstr. 62“ → "teckstr62"); leer ohne Hausnummer. */
export function strassenSchluessel(adr: unknown): string {
  const s = norm(adr).replace(/strasse\b/g, 'str').replace(/str\./g, 'str').replace(/\bstr\b/g, 'str')
  const m = s.match(/([a-z][a-z .-]*?)\s*(\d{1,4})(?!\d)\s*([a-z])?(?![a-z])/)
  if (!m) return ''
  return `${m[1].replace(/[^a-z]/g, '')}${m[2]}${m[3] ?? ''}`
}

function plzVon(adr: unknown): string {
  return String(adr ?? '').match(/\b\d{5}\b/)?.[0] ?? ''
}

function hausnummerVon(adr: unknown): string {
  const k = strassenSchluessel(adr)
  return k.match(/\d+[a-z]?$/)?.[0] ?? ''
}

function objektAdressen(o: ObjektRow): string[] {
  const ue = o.verkaufsdaten?.uebersicht
  return [o.adresse, ue ? `${ue.strasse ?? ''} ${ue.plzOrt ?? ''}` : ''].filter((a) => text(a))
}

/**
 * Wahrscheinlich dasselbe Objekt? Gleiche Bezeichnung oder gleiche Straße mit Hausnummer (bei bekannter,
 * gleicher PLZ). Zusätzlich über sucheObjekte: gleiche PLZ und Hausnummer bei anders geschriebener Straße.
 */
export function findeDublette(objekte: ObjektRow[], neu: { bezeichnung: string; adresse: string }): ObjektRow | undefined {
  const bez = ohneZeichen(neu.bezeichnung)
  const schluessel = strassenSchluessel(neu.adresse)
  const plz = plzVon(neu.adresse)
  const passtPlz = (a: string) => !plz || !plzVon(a) || plzVon(a) === plz
  const streng = objekte.find(
    (o) => (bez.length >= 4 && ohneZeichen(o.bezeichnung) === bez) || (!!schluessel && objektAdressen(o).some((a) => strassenSchluessel(a) === schluessel && passtPlz(a))),
  )
  if (streng || !plz || !schluessel) return streng
  const nummer = hausnummerVon(neu.adresse)
  return sucheObjekte(objekte, neu.adresse).find((o) => objektAdressen(o).some((a) => plzVon(a) === plz && hausnummerVon(a) === nummer))
}

/** Dateiname für den Speicher: ohne Umlaute und Sonderzeichen (die Ablage lehnt sie ab, vgl. speicherName in outlookWerkzeuge.ts). */
export function speicherName(name: string): string {
  const s = String(name ?? '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
  return s.slice(-120) || 'datei'
}

/** Anzeigename einer per Telegram gespeicherten Datei (ohne Zeitstempel und Inhaltsabdruck, wie anzeigeName in index.ts). */
export function telegramAnzeigeName(dateiImOrdner: string): string {
  return dateiImOrdner.replace(/^\d{10,}_(h[0-9a-f]{12}(?:p\d+-\d+)?)_/, '').replace(/^\d{10,}_/, '')
}

function endung(name: string): string {
  return name.match(/(\.[A-Za-z0-9]{1,6})$/)?.[1] ?? ''
}

/** Gewünschter Name; fehlt ihm die Endung der Quelle, wird sie angehängt. */
export function mitEndung(gewuenscht: string, quelle: string): string {
  const g = text(gewuenscht)
  if (!g) return quelle
  const e = endung(quelle)
  return e && !endung(g) ? `${g}${e}` : g
}

/** Freier Name im Ordner: bei gleichem Namen „Name (2).pdf“, „Name (3).pdf“ … */
export function freierName(name: string, vorhandene: { name: string }[]): string {
  const belegt = new Set(vorhandene.map((d) => norm(d.name).trim()))
  if (!belegt.has(norm(name).trim())) return name
  const e = endung(name)
  const stamm = (e ? name.slice(0, -e.length) : name).replace(/\s\(\d+\)$/, '')
  for (let i = 2; i < 1000; i++) {
    const kandidat = `${stamm} (${i})${e}`
    if (!belegt.has(norm(kandidat).trim())) return kandidat
  }
  return `${stamm} (${Date.now()})${e}`
}

export function formatGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const TYP_NACH_ENDUNG: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
}

function dateiTyp(...kandidaten: (string | null | undefined)[]): string {
  for (const k of kandidaten) if (k && k.includes('/') && k !== 'application/octet-stream') return k
  return 'application/octet-stream'
}

function neueId(vorsatz: string): string {
  return `${vorsatz}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/** Ordnername aus der Eingabe, tolerant bei Schreibweise („Expose“ → „Exposé“). */
export function ordnerVon(eingabe: unknown): string | undefined {
  const s = ohneZeichen(eingabe)
  if (!s) return undefined
  return OBJEKT_ORDNER.find((o) => ohneZeichen(o) === s)
}

function objektName(o: { bezeichnung?: string | null; adresse?: string | null }): string {
  const b = text(o.bezeichnung) || 'Objekt ohne Bezeichnung'
  const a = text(o.adresse)
  return a && ohneZeichen(a) !== ohneZeichen(b) ? `„${b}“ (${a})` : `„${b}“`
}

function akteName(a: { firma?: string | null; ansprechpartner?: string | null }): string {
  const f = text(a.firma)
  const p = text(a.ansprechpartner)
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

function anbieterText(a: unknown): string {
  // Das Modell schickt manchmal nur einen Namen statt des Objekts — auch das vermerken.
  if (typeof a === 'string') return text(a) ? `Angeboten von ${text(a)}.` : ''
  if (!a || typeof a !== 'object') return ''
  const x = a as Record<string, unknown>
  const wer = [text(x.name), text(x.firma) && (text(x.name) ? `(${text(x.firma)})` : text(x.firma))].filter(Boolean).join(' ')
  if (!wer) return ''
  const kontakt = [text(x.telefon) && `Tel. ${text(x.telefon)}`, text(x.email)].filter(Boolean).join(', ')
  return `Angeboten von ${text(x.art) ? `${text(x.art)} ` : ''}${wer}${kontakt ? `, ${kontakt}` : ''}.`
}

function eigentuemerVon(e: unknown, alt?: Record<string, unknown> | null): { name: string; telefon: string; email: string; ansprechpartner?: string } | null {
  if (!e || typeof e !== 'object') return null
  const x = e as Record<string, unknown>
  const basis = { name: text(alt?.name), telefon: text(alt?.telefon), email: text(alt?.email), ansprechpartner: text(alt?.ansprechpartner) }
  for (const feld of ['name', 'telefon', 'email', 'ansprechpartner'] as const) if (typeof x[feld] === 'string') basis[feld] = text(x[feld])
  const { ansprechpartner, ...rest } = basis
  return ansprechpartner ? { ...rest, ansprechpartner } : rest
}

function eigentuemerText(e: { name?: string; telefon?: string; email?: string; ansprechpartner?: string } | null | undefined): string {
  if (!e?.name && !e?.telefon && !e?.email && !e?.ansprechpartner) return '(keiner)'
  return [e.name, e.ansprechpartner && `Ansprechpartner ${e.ansprechpartner}`, e.telefon && `Tel. ${e.telefon}`, e.email].filter(Boolean).join(', ')
}

async function aktiveMitarbeiter(supabase: Supa): Promise<string[]> {
  const { data } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
  return ((data ?? []) as { name: string }[]).map((m) => m.name).filter(Boolean)
}

/** Name eines aktiven Mitarbeiters zur Eingabe (genau, sonst Teil des Namens, z. B. Vorname). */
function findeMitarbeiter(namen: string[], eingabe: string): string | undefined {
  const s = norm(eingabe).trim()
  if (!s) return undefined
  return namen.find((n) => norm(n) === s) ?? namen.find((n) => norm(n).split(/\s+/).includes(s)) ?? namen.find((n) => norm(n).includes(s))
}

/** Lädt ein Objekt samt Rechteprüfung: fremde private Objekte gibt es nicht, Holding-Objekte nur mit Immobilien-Rechten. */
async function ladeObjekt(supabase: Supa, m: RechteMitarbeiter & { name: string }, id: string, spalten: string): Promise<{ o?: ObjektRow; fehler?: string }> {
  if (!id) return { fehler: 'Fehler: objekt_id fehlt. Ermittle sie mit objekte_suchen.' }
  const { data, error } = await supabase.from('objekte').select(spalten).eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden des Objekts: ${error.message}` }
  if (!data || istUnsichtbaresObjekt(m, data)) return { fehler: KEIN_OBJEKT }
  if (!darfObjekt(m, data)) return { fehler: nichtFreigegeben('immobilien', m.name) }
  return { o: data as ObjektRow }
}

// ---------- Werkzeuge ----------

// deno-lint-ignore no-explicit-any
export async function fuehreObjektSchreibWerkzeugAus(name: string, input: any, k: ObjektKontext): Promise<string> {
  try {
    if (name === 'objekt_anlegen') return await objektAnlegen(input ?? {}, k)
    if (name === 'objekt_aendern') return await objektAendern(input ?? {}, k)
    if (name === 'dateien_ins_objekt') return await dateienInsObjekt(input ?? {}, k)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
  return `Fehler: unbekanntes Werkzeug ${name}.`
}

// deno-lint-ignore no-explicit-any
async function objektAnlegen(input: any, k: ObjektKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const bezeichnung = text(input.bezeichnung).slice(0, 200)
  const adr = text(input.adresse).slice(0, 300)
  if (!bezeichnung) return 'Fehler: bezeichnung fehlt.'
  const typ = text(input.typ)
  if (!typ) return `Fehler: Objektart fehlt. Bitte typ angeben: ${OBJEKT_TYPEN.join(', ')}.`
  if (!(OBJEKT_TYPEN as readonly string[]).includes(typ)) return `Fehler: ungültige Objektart. Erlaubt: ${OBJEKT_TYPEN.join(', ')}.`

  // Privat: im privaten Assistenten immer, sonst auf Wunsch. Besitzer = eigene Adresse, klein (wie im CRM).
  const privat = mitarbeiter.nurPrivat === true || input.privat === true
  const ich = adresse(mitarbeiter.email)
  if (privat && !ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt — ein privates Objekt lässt sich ihm nicht zuordnen.'
  if (!privat && !darfObjekte(mitarbeiter)) return `${nichtFreigegeben('immobilien', mitarbeiter.name)} Ein Objekt der Holding kann er deshalb nicht anlegen.`

  const status = text(input.status) || 'akquise'
  if (!OBJEKT_STATUS[status]) return `Fehler: ungültiger Status. Möglich: ${STATUS_TEXT}.`
  const gruppe = text(input.gruppe) || 'aktuell'
  if (!OBJEKT_GRUPPEN[gruppe]) return `Fehler: ungültige Liste. Möglich: ${Object.keys(OBJEKT_GRUPPEN).join(', ')}.`
  const prioritaet = text(input.prioritaet) || 'Mittel'
  if (!PRIORITAETEN.includes(prioritaet)) return 'Fehler: prioritaet muss Hoch, Mittel oder Niedrig sein.'
  let kaufpreis = 0
  if (input.kaufpreis !== undefined && input.kaufpreis !== null && input.kaufpreis !== '') {
    const b = leseBetrag(input.kaufpreis)
    if (b === undefined) return `Fehler: Kaufpreis „${input.kaufpreis}“ ist nicht lesbar. Bitte als Zahl in Euro angeben, z. B. 1200000.`
    kaufpreis = b
  }
  const fuDatum = input.follow_up_datum ? pruefeDatum(input.follow_up_datum) : heute
  if (!fuDatum) return 'Fehler: follow_up_datum ist kein gültiges Datum (JJJJ-MM-TT).'

  let verantwortlich = mitarbeiter.name
  const gewuenscht = text(input.verantwortlich)
  if (gewuenscht && norm(gewuenscht) !== norm(mitarbeiter.name)) {
    if (privat) return 'Fehler: Bei einem privaten Objekt ist der Mitarbeiter selbst verantwortlich.'
    const namen = await aktiveMitarbeiter(supabase)
    const treffer = findeMitarbeiter(namen, gewuenscht)
    if (!treffer) return `Fehler: „${gewuenscht}“ ist kein aktiver Mitarbeiter. Möglich: ${namen.join(', ')}.`
    verantwortlich = treffer
  }

  // Dubletten: alle Objekte, die der Mitarbeiter sehen darf (Holding mit Rechten, eigene private) —
  // private Objekte von Kollegen zählen nicht und werden nie erwähnt.
  if (input.trotzdem !== true) {
    const { data: alle, error } = await supabase.from('objekte').select('id, bezeichnung, adresse, typ, status, verantwortlich, eigentuemer, verkaufsdaten, privat_besitzer')
    if (error) return `Fehler beim Prüfen auf vorhandene Objekte: ${error.message}. Nichts wurde angelegt.`
    const sichtbar = ((alle ?? []) as ObjektRow[]).filter((o) => darfObjekt(mitarbeiter, { privat_besitzer: o.privat_besitzer }))
    const doppelt = findeDublette(sichtbar, { bezeichnung, adresse: adr })
    if (doppelt) {
      return `Nicht angelegt: Es gibt schon ein Objekt, das passt: ${objektName(doppelt)}, Objektart ${doppelt.typ || '—'}, Status „${objektStatus(doppelt.status)}“, verantwortlich ${doppelt.verantwortlich || '—'}${doppelt.privat_besitzer ? ', privates Objekt (nur für ihn sichtbar)' : ''} (objekt_id=${doppelt.id}). Frag den Mitarbeiter, ob er dieses meint (dann mit objekt_aendern / dateien_ins_objekt weiterarbeiten). Nur wenn es wirklich ein anderes Objekt ist, rufe objekt_anlegen mit trotzdem=true erneut auf.`
    }
  }

  const id = neueId('o')
  const anbieter = anbieterText(input.anbieter)
  const notiz = text(input.notiz).slice(0, 2000)
  const eigentuemer = eigentuemerVon(input.eigentuemer)
  const verlauf = [`Objekt per Telegram von ${mitarbeiter.name} angelegt.`, anbieter, notiz && `Notiz: ${notiz}`].filter(Boolean).join(' ')
  const zeile: Record<string, unknown> = {
    id,
    bezeichnung,
    adresse: adr,
    gruppe,
    typ,
    kaufpreis,
    prioritaet,
    status,
    follow_up: { date: fuDatum, note: text(input.follow_up_notiz) || 'Objekt aufgenommen', done: false },
    verantwortlich,
    activities: [{ id: neueId('act'), date: heute, text: verlauf, user: mitarbeiter.name }],
    dokumente: {},
    off_market: input.nicht_oeffentlich === true,
    privat_besitzer: privat ? ich : null,
    updated_at: new Date().toISOString(),
  }
  if (eigentuemer && (eigentuemer.name || eigentuemer.telefon || eigentuemer.email)) zeile.eigentuemer = eigentuemer
  const { error } = await supabase.from('objekte').insert(zeile)
  if (error) return `Fehler beim Anlegen: ${error.message}. Nichts wurde angelegt.`

  protokolliere(`Objekt ${objektName({ bezeichnung, adresse: adr })} angelegt${privat ? ' (privat)' : ''} (objekt_id=${id})`)
  const wo = privat ? 'Im CRM unter Privat → Immobilien (nur für ihn sichtbar).' : 'Im CRM unter Immobilien → Objekte.'
  return `Angelegt: Objektakte ${objektName({ bezeichnung, adresse: adr })}, Objektart ${typ}, Kaufpreis ${euro(kaufpreis)}, Status „${OBJEKT_STATUS[status]}“, Liste ${OBJEKT_GRUPPEN[gruppe]}, verantwortlich ${verantwortlich}.${anbieter ? ` ${anbieter}` : ''} ${wo} Dateien jetzt mit dateien_ins_objekt ablegen. objekt_id=${id}`
}

// deno-lint-ignore no-explicit-any
async function objektAendern(input: any, k: ObjektKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const r = await ladeObjekt(supabase, mitarbeiter, text(input.objekt_id), SPALTEN_AENDERN)
  if (r.fehler) return r.fehler
  const o = r.o!
  const patch: Record<string, unknown> = {}
  const geaendert: string[] = []

  for (const [feld, anzeige, max] of [['bezeichnung', 'Bezeichnung', 200], ['adresse', 'Adresse', 300]] as const) {
    if (typeof input[feld] !== 'string') continue
    const neu = text(input[feld]).slice(0, max)
    if (feld === 'bezeichnung' && !neu) return 'Fehler: Die Bezeichnung darf nicht leer sein.'
    if (neu !== text(o[feld])) {
      patch[feld] = neu
      geaendert.push(`${anzeige}: ${text(o[feld]) || '(leer)'} → ${neu || '(leer)'}`)
    }
  }
  if (typeof input.typ === 'string') {
    if (!(OBJEKT_TYPEN as readonly string[]).includes(input.typ)) return `Fehler: ungültige Objektart. Erlaubt: ${OBJEKT_TYPEN.join(', ')}.`
    if (input.typ !== o.typ) {
      patch.typ = input.typ
      geaendert.push(`Objektart: ${o.typ || '—'} → ${input.typ}`)
    }
  }
  if (typeof input.gruppe === 'string') {
    if (!OBJEKT_GRUPPEN[input.gruppe]) return `Fehler: ungültige Liste. Möglich: ${Object.keys(OBJEKT_GRUPPEN).join(', ')}.`
    if (input.gruppe !== o.gruppe) {
      patch.gruppe = input.gruppe
      geaendert.push(`Liste: ${OBJEKT_GRUPPEN[o.gruppe] ?? o.gruppe ?? '—'} → ${OBJEKT_GRUPPEN[input.gruppe]}`)
    }
  }
  if (input.kaufpreis !== undefined && input.kaufpreis !== null && input.kaufpreis !== '') {
    const b = leseBetrag(input.kaufpreis)
    if (b === undefined) return `Fehler: Kaufpreis „${input.kaufpreis}“ ist nicht lesbar. Bitte als Zahl in Euro angeben.`
    if (b !== Number(o.kaufpreis ?? 0)) {
      patch.kaufpreis = b
      geaendert.push(`Kaufpreis: ${euro(o.kaufpreis)} → ${euro(b)}`)
    }
  }
  if (typeof input.status === 'string') {
    if (!OBJEKT_STATUS[input.status]) return `Fehler: ungültiger Status. Möglich: ${STATUS_TEXT}.`
    if (input.status !== o.status) {
      patch.status = input.status
      geaendert.push(`Status: ${objektStatus(o.status)} → ${OBJEKT_STATUS[input.status]}`)
    }
  }
  if (typeof input.prioritaet === 'string') {
    if (!PRIORITAETEN.includes(input.prioritaet)) return 'Fehler: prioritaet muss Hoch, Mittel oder Niedrig sein.'
    if (input.prioritaet !== o.prioritaet) {
      patch.prioritaet = input.prioritaet
      geaendert.push(`Priorität: ${o.prioritaet || '—'} → ${input.prioritaet}`)
    }
  }
  if (typeof input.verantwortlich === 'string' && text(input.verantwortlich)) {
    const namen = await aktiveMitarbeiter(supabase)
    const treffer = findeMitarbeiter(namen, input.verantwortlich)
    if (o.privat_besitzer && norm(treffer ?? input.verantwortlich) !== norm(o.verantwortlich)) return 'Nicht geändert: Bei einem privaten Objekt bleibt der Mitarbeiter selbst verantwortlich.'
    if (!treffer) return `Fehler: „${input.verantwortlich}“ ist kein aktiver Mitarbeiter. Möglich: ${namen.join(', ')}.`
    if (treffer !== o.verantwortlich) {
      patch.verantwortlich = treffer
      geaendert.push(`verantwortlich: ${o.verantwortlich || '—'} → ${treffer}`)
    }
  }
  // Follow-up ist eine Spalte (jsonb): nur die genannten Teile ändern, den Rest übernehmen.
  const fuAlt = (o.follow_up && typeof o.follow_up === 'object' ? o.follow_up : {}) as { date?: string; note?: string; done?: boolean }
  const fuNeu = { date: fuAlt.date ?? heute, note: fuAlt.note ?? '', done: fuAlt.done === true }
  const fuTeile: string[] = []
  if (input.follow_up_datum !== undefined && input.follow_up_datum !== null && input.follow_up_datum !== '') {
    const d = pruefeDatum(input.follow_up_datum)
    if (!d) return 'Fehler: follow_up_datum ist kein gültiges Datum (JJJJ-MM-TT).'
    if (d !== fuAlt.date) {
      fuNeu.date = d
      fuTeile.push(`fällig ${deDatum(d)}`)
    }
  }
  if (typeof input.follow_up_notiz === 'string' && text(input.follow_up_notiz) !== text(fuAlt.note)) {
    fuNeu.note = text(input.follow_up_notiz)
    fuTeile.push(`„${fuNeu.note || '(leer)'}“`)
  }
  if (typeof input.follow_up_erledigt === 'boolean' && input.follow_up_erledigt !== (fuAlt.done === true)) {
    fuNeu.done = input.follow_up_erledigt
    fuTeile.push(input.follow_up_erledigt ? 'erledigt' : 'wieder offen')
  }
  if (fuTeile.length) {
    patch.follow_up = fuNeu
    geaendert.push(`Follow-up: ${fuTeile.join(', ')}`)
  }
  if (input.eigentuemer && typeof input.eigentuemer === 'object') {
    const alt = (o.eigentuemer && typeof o.eigentuemer === 'object' ? o.eigentuemer : null) as Record<string, unknown> | null
    const neu = eigentuemerVon(input.eigentuemer, alt)
    if (neu && JSON.stringify(eigentuemerVon({}, alt)) !== JSON.stringify(neu)) {
      patch.eigentuemer = neu
      geaendert.push(`Eigentümer: ${eigentuemerText(neu)}`)
    }
  }
  if (typeof input.nicht_oeffentlich === 'boolean' && input.nicht_oeffentlich !== (o.off_market === true)) {
    patch.off_market = input.nicht_oeffentlich
    geaendert.push(input.nicht_oeffentlich ? 'jetzt nicht öffentlich angeboten (Off-Market)' : 'nicht mehr als „nicht öffentlich“ gekennzeichnet')
  }
  const notiz = text(input.notiz).slice(0, 2000)
  if (!geaendert.length && !notiz) return `Nichts geändert: Die Angaben entsprechen schon dem Stand der Objektakte ${objektName(o)}. objekt_id=${o.id}`

  const verlauf = [geaendert.length ? `Per Telegram geändert — ${geaendert.join('; ')}.` : '', notiz && (geaendert.length ? `Notiz: ${notiz}` : notiz)].filter(Boolean).join(' ')
  patch.activities = [{ id: neueId('act'), date: heute, text: verlauf, user: mitarbeiter.name }, ...(Array.isArray(o.activities) ? o.activities : [])]
  patch.updated_at = new Date().toISOString()
  const { error } = await supabase.from('objekte').update(patch).eq('id', o.id)
  if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde geändert.`
  protokolliere(`Objekt ${objektName(o)} ${geaendert.length ? `geändert — ${geaendert.join('; ')}` : 'Notiz eingetragen'}`)
  return `${geaendert.length ? `Bei ${objektName(o)} geändert — ${geaendert.join('; ')}.` : `Notiz bei ${objektName(o)} eingetragen.`} objekt_id=${o.id}`
}

type KundeZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null; dokumente: ObjektDokument[] | null; activities: unknown[] | null }
const KUNDE_SPALTEN = 'id, bereich, firma, ansprechpartner, verantwortlich_email, dokumente, activities'

type Vorhaben = { anzeige: string; herkunft: string; bytes: Uint8Array; typ: string; ordner: string; name: string; ausAkte?: { kundeId: string; dokId: string }; ausUngeklaert?: string; fertig?: boolean }

// deno-lint-ignore no-explicit-any
async function dateienInsObjekt(input: any, k: ObjektKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const r = await ladeObjekt(supabase, mitarbeiter, text(input.objekt_id), 'id, bezeichnung, adresse, dokumente, activities, privat_besitzer')
  if (r.fehler) return r.fehler
  const o = r.o!
  // deno-lint-ignore no-explicit-any
  const gewuenscht: any[] = Array.isArray(input.dateien) ? input.dateien : []
  if (!gewuenscht.length) return 'Fehler: keine Dateien angegeben.'
  if (gewuenscht.length > 30) return 'Fehler: höchstens 30 Dateien auf einmal.'

  const dokumente: Record<string, ObjektDokument[]> = { ...((o.dokumente && typeof o.dokumente === 'object' ? o.dokumente : {}) as Record<string, ObjektDokument[]>) }
  const imObjekt = () => Object.values(dokumente).flatMap((l) => (Array.isArray(l) ? l : []))
  const meldungen: string[] = []
  const vorhaben: Vorhaben[] = []
  const kunden = new Map<string, KundeZeile | string>()
  // Wo die Telegram-Datei sonst schon liegt (nur zum Prüfen der Rechte), einmal je Aufruf geladen.
  let referenzen: { kunden: KundeZeile[]; objekte: ObjektRow[] } | null = null

  for (const g of gewuenscht) {
    const ordner = ordnerVon(g?.ordner)
    const pfad = text(g?.pfad)
    const kundeId = text(g?.kunde_id)
    const dokId = text(g?.dokument_id)
    const bezeichner = pfad || (dokId ? `Dokument ${dokId}` : '(ohne Angabe)')
    if (!ordner) {
      meldungen.push(`„${bezeichner}“: Ordner „${text(g?.ordner)}“ gibt es in der Objektakte nicht. Möglich: ${OBJEKT_ORDNER.join(', ')}.`)
      continue
    }

    if (pfad) {
      // (a) Per Telegram geschickte Datei im Eimer "email-anhaenge", Ordner "telegram/".
      const dateiName = pfad.startsWith(`${TELEGRAM_ORDNER}/`) ? pfad.slice(TELEGRAM_ORDNER.length + 1) : ''
      if (!dateiName || dateiName.includes('/') || !istSichererPfad(pfad)) {
        meldungen.push(`„${pfad}“: kein gültiger Pfad (er beginnt mit "telegram/" und wird exakt übernommen).`)
        continue
      }
      const url = supabase.storage.from(TELEGRAM_EIMER).getPublicUrl(pfad).data.publicUrl as string
      const quellName = telegramAnzeigeName(dateiName)
      const anzeige = mitEndung(g?.name, quellName)
      if (imObjekt().some((d) => d.url === url || (d as { herkunft?: string }).herkunft === url) || vorhaben.some((v) => v.herkunft === url)) {
        meldungen.push(`„${anzeige}“: liegt bereits in dieser Objektakte.`)
        continue
      }
      // Liegt die Datei schon in einer Akte oder einem Objekt, das er nicht sehen darf? Dann nicht anfassen.
      if (!referenzen) {
        const [{ data: kz }, { data: oz }] = await Promise.all([supabase.from('kunden').select(KUNDE_SPALTEN), supabase.from('objekte').select('id, dokumente, privat_besitzer')])
        referenzen = { kunden: (kz ?? []) as KundeZeile[], objekte: (oz ?? []) as ObjektRow[] }
      }
      const enthaelt = (liste: unknown) => (Array.isArray(liste) ? liste : []).some((d: { url?: string; herkunft?: string }) => d?.url === url || d?.herkunft === url)
      const fremdeAkte = referenzen.kunden.find((x) => enthaelt(x.dokumente) && !darfAkte(mitarbeiter, x))
      const fremdesObjekt = referenzen.objekte.find((x) => x.id !== o.id && Object.values(x.dokumente ?? {}).some(enthaelt) && !darfObjekt(mitarbeiter, { privat_besitzer: x.privat_besitzer }))
      if (fremdeAkte || fremdesObjekt) {
        meldungen.push(
          (fremdeAkte && (istPrivat(fremdeAkte) || mitarbeiter.nurPrivat === true)) || (fremdesObjekt && (fremdesObjekt.privat_besitzer || mitarbeiter.nurPrivat === true))
            ? `„${anzeige}“: ist bereits abgelegt — nicht übernommen.`
            : `„${anzeige}“: liegt bereits in einer Akte aus einem Bereich, der für ${mitarbeiter.name} nicht freigegeben ist — nicht übernommen.`,
        )
        continue
      }
      const { data: blob, error } = await supabase.storage.from(TELEGRAM_EIMER).download(pfad)
      if (error || !blob) {
        meldungen.push(`„${pfad}“: Diese Datei gibt es in der Ablage nicht (pfad exakt übernehmen).`)
        continue
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ungeklaert = referenzen.kunden.find((x) => x.id === AKTE_UNGEKLAERT && enthaelt(x.dokumente))
      vorhaben.push({ anzeige, herkunft: url, bytes, typ: dateiTyp(blob.type, TYP_NACH_ENDUNG[endung(quellName).toLowerCase()]), ordner, name: anzeige, ausUngeklaert: ungeklaert ? url : undefined })
      continue
    }

    if (kundeId && dokId) {
      // (b) Dokument aus einer Kundenakte.
      if (!kunden.has(kundeId)) {
        const { data: akte } = await supabase.from('kunden').select(KUNDE_SPALTEN).eq('id', kundeId).maybeSingle()
        kunden.set(kundeId, !akte || istFremdePrivatakte(mitarbeiter, akte) ? KEIN_KUNDE : !darfAkte(mitarbeiter, akte) ? nichtFreigegeben(akte.bereich, mitarbeiter.name) : (akte as KundeZeile))
      }
      const akte = kunden.get(kundeId)!
      if (typeof akte === 'string') {
        meldungen.push(`Dokument ${dokId}: ${akte}`)
        continue
      }
      const dok = (akte.dokumente ?? []).find((d) => d?.id === dokId)
      if (!dok) {
        meldungen.push(`Dokument ${dokId}: liegt nicht in der Akte von ${akteName(akte)}. Lies die Akte neu (kundenakte_lesen).`)
        continue
      }
      const anzeige = mitEndung(g?.name, dok.name)
      const herkunft = String(dok.url ?? '')
      if (herkunft && (imObjekt().some((d) => d.url === herkunft || (d as { herkunft?: string }).herkunft === herkunft) || vorhaben.some((v) => v.herkunft === herkunft))) {
        meldungen.push(`„${anzeige}“: liegt bereits in dieser Objektakte.`)
        continue
      }
      const ort = speicherOrt(herkunft)
      if (!ort) {
        meldungen.push(`„${dok.name}“: Zu diesem Dokument ist keine Datei im eigenen Speicher hinterlegt — nicht übernommen.`)
        continue
      }
      const { data: blob, error } = await supabase.storage.from(ort.eimer).download(ort.pfad)
      if (error || !blob) {
        meldungen.push(`„${dok.name}“: Die Datei ist im Speicher nicht (mehr) vorhanden — nicht übernommen.`)
        continue
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      vorhaben.push({ anzeige, herkunft, bytes, typ: dateiTyp(dok.typ, blob.type, TYP_NACH_ENDUNG[endung(dok.name).toLowerCase()]), ordner, name: anzeige, ausAkte: { kundeId, dokId } })
      continue
    }

    meldungen.push(`„${bezeichner}“: Bitte entweder pfad (per Telegram geschickte Datei) oder kunde_id und dokument_id angeben.`)
  }

  if (!vorhaben.length) return [`Nichts in die Objektakte ${objektName(o)} gelegt.`, ...meldungen, `objekt_id=${o.id}`].join('\n')

  // Dateien in den Objekt-Speicher kopieren; geht danach das Speichern der Akte schief, wieder entfernen.
  const hochgeladen: string[] = []
  const abgelegt: string[] = []
  for (const v of vorhaben) {
    const dokId = neueId('dok')
    const speicherPfad = `${o.id}/${dokId}_${speicherName(v.name)}`
    if (!istSichererPfad(speicherPfad)) {
      meldungen.push(`„${v.anzeige}“: Dateiname nicht verwendbar — nicht übernommen.`)
      continue
    }
    const { error } = await supabase.storage.from(OBJEKT_EIMER).upload(speicherPfad, v.bytes, { contentType: v.typ, upsert: false })
    if (error) {
      meldungen.push(`„${v.anzeige}“: konnte nicht gespeichert werden (${error.message}).`)
      continue
    }
    hochgeladen.push(speicherPfad)
    const liste = Array.isArray(dokumente[v.ordner]) ? dokumente[v.ordner] : []
    const name = freierName(v.name, liste)
    const neu: ObjektDokument & { herkunft: string } = { id: dokId, name, typ: v.typ, datum: heute, groesse: formatGroesse(v.bytes.length), url: speicherPfad, herkunft: v.herkunft }
    dokumente[v.ordner] = [neu, ...liste]
    abgelegt.push(`${name} (Ordner ${v.ordner}${name !== v.name ? ', weitere Fassung' : ''})`)
    v.name = name
    v.fertig = true
  }
  if (!abgelegt.length) return [`Nichts in die Objektakte ${objektName(o)} gelegt.`, ...meldungen, `objekt_id=${o.id}`].join('\n')

  // Nur Dokumente und Verlauf schreiben — nie die ganze Zeile.
  const eintrag = { id: neueId('act'), date: heute, text: `Per Telegram von ${mitarbeiter.name} in die Objektakte gelegt: ${abgelegt.map((n) => `„${n}“`).join(', ')}`, user: mitarbeiter.name }
  const { error: schreibFehler } = await supabase
    .from('objekte')
    .update({ dokumente, activities: [eintrag, ...(Array.isArray(o.activities) ? o.activities : [])], updated_at: new Date().toISOString() })
    .eq('id', o.id)
  if (schreibFehler) {
    if (hochgeladen.length) await supabase.storage.from(OBJEKT_EIMER).remove(hochgeladen)
    return `Fehler beim Speichern der Objektakte: ${schreibFehler.message}. Nichts wurde abgelegt. objekt_id=${o.id}`
  }
  protokolliere(`${abgelegt.length} Datei(en) in die Objektakte ${objektName(o)} gelegt: ${abgelegt.join(', ')}`)

  // Danach aus Kundenakten nehmen: aus „Ungeklärte Eingänge“ immer (die Datei zieht um), aus anderen Akten nur auf Wunsch.
  const erledigt = vorhaben.filter((v) => v.fertig)
  const ausAkten = new Map<string, Set<string>>()
  const ungeklaertUrls = new Set<string>()
  for (const v of erledigt) {
    if (v.ausUngeklaert) ungeklaertUrls.add(v.ausUngeklaert)
    if (v.ausAkte && (input.aus_kundenakte_entfernen === true || v.ausAkte.kundeId === AKTE_UNGEKLAERT)) {
      ausAkten.set(v.ausAkte.kundeId, new Set([...(ausAkten.get(v.ausAkte.kundeId) ?? []), v.ausAkte.dokId]))
    }
  }
  if (ungeklaertUrls.size) {
    const { data: sammel } = await supabase.from('kunden').select('id, dokumente').eq('id', AKTE_UNGEKLAERT).maybeSingle()
    const vorher = (sammel?.dokumente ?? []) as ObjektDokument[]
    const nachher = vorher.filter((d) => !ungeklaertUrls.has(d.url))
    if (sammel && nachher.length !== vorher.length) await supabase.from('kunden').update({ dokumente: nachher }).eq('id', AKTE_UNGEKLAERT)
  }
  for (const [kundeId, ids] of ausAkten) {
    // Frisch laden, damit zwischenzeitlich Abgelegtes nicht verloren geht.
    const { data: akte } = await supabase.from('kunden').select(KUNDE_SPALTEN).eq('id', kundeId).maybeSingle()
    if (!akte || !darfAkte(mitarbeiter, akte)) continue
    const weg = ((akte.dokumente ?? []) as ObjektDokument[]).filter((d) => ids.has(d.id))
    if (!weg.length) continue
    const { error } = await supabase
      .from('kunden')
      .update({
        dokumente: ((akte.dokumente ?? []) as ObjektDokument[]).filter((d) => !ids.has(d.id)),
        activities: [{ id: crypto.randomUUID(), date: heute, text: `Per Telegram aus der Akte genommen und in die Objektakte ${objektName(o)} gelegt: ${weg.map((d) => `„${d.name}“`).join(', ')}`, user: mitarbeiter.name }, ...((akte.activities ?? []) as unknown[])],
      })
      .eq('id', kundeId)
    if (error) meldungen.push(`Aus der Akte von ${akteName(akte)} ließ es sich nicht herausnehmen (${error.message}); es liegt jetzt an beiden Stellen.`)
    else {
      protokolliere(`${weg.length} Dokument(e) aus der Akte von ${akteName(akte)} genommen (liegen jetzt in der Objektakte)`)
      meldungen.push(`Aus der Akte von ${akteName(akte)} genommen: ${weg.map((d) => `„${d.name}“`).join(', ')}.`)
    }
  }

  return [`In die Objektakte ${objektName(o)} gelegt (${abgelegt.length}): ${abgelegt.join(', ')}.`, ...meldungen, `objekt_id=${o.id}`].join('\n')
}
