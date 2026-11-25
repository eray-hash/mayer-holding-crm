// Test-Doppel für Edge-Funktionen: eine Datenbank im Speicher statt des Supabase-Admin-Clients und ein
// falsches Microsoft statt login.microsoftonline.com / graph.microsoft.com. Nur für Tests — kein Netz,
// kein echtes Konto. Unterstützt genau die Aufrufketten, die microsoft.ts und email-gateway/outlook.ts nutzen.
import { verschluessele } from './geheim.ts'

export type Zeile = Record<string, unknown>
type Ergebnis = { data: unknown; error: { code?: string; message: string } | null }
type Filter = (z: Zeile) => boolean

/** Fester Dienst-Schlüssel für Tests (daraus leitet geheim.ts den AES-Schlüssel ab). */
export const TEST_DIENST_SCHLUESSEL = 'test-dienst-schluessel-nur-fuer-tests'

/** Primärschlüssel je Tabelle: login_email für ms_* und privat_einstellungen, sonst id. */
function primaerschluessel(tabelle: string): string {
  return tabelle.startsWith('ms_') || tabelle === 'privat_einstellungen' ? 'login_email' : 'id'
}

/** Zusätzlich eindeutige Spalten. */
const EINDEUTIG: Record<string, string[]> = {
  eingegangene_emails: ['message_id'],
  ms_anmeldungen: ['kennung'],
}

function leer(x: unknown): boolean {
  return x === null || x === undefined
}

function gleich(a: unknown, b: unknown): boolean {
  if (leer(a) || leer(b)) return false
  return a === b || String(a) === String(b)
}

/** Vergleich wie in SQL: mit NULL ist nichts kleiner oder größer. */
function vergleiche(a: unknown, b: unknown): number | null {
  if (leer(a) || leer(b)) return null
  if (typeof a === 'number' && !Number.isNaN(Number(b))) return a - Number(b)
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function filterAus(spalte: string, op: string, wert: unknown): Filter {
  const mitVergleich = (bedingung: (v: number) => boolean): Filter => (z) => {
    const v = vergleiche(z[spalte], wert)
    return v !== null && bedingung(v)
  }
  switch (op) {
    case 'eq':
      return (z) => gleich(z[spalte], wert)
    case 'neq':
      return (z) => !leer(z[spalte]) && !gleich(z[spalte], wert)
    case 'lt':
      return mitVergleich((v) => v < 0)
    case 'lte':
      return mitVergleich((v) => v <= 0)
    case 'gt':
      return mitVergleich((v) => v > 0)
    case 'gte':
      return mitVergleich((v) => v >= 0)
    case 'is': {
      const w = String(wert)
      if (w === 'null') return (z) => leer(z[spalte])
      if (w === 'true') return (z) => z[spalte] === true
      if (w === 'false') return (z) => z[spalte] === false
      throw new Error(`Testdatenbank: is.${w} wird nicht unterstützt`)
    }
    case 'ilike': {
      // PostgREST-ilike: % = beliebig viele Zeichen, _ = genau eins, ohne Groß/klein.
      const muster = new RegExp(`^${String(wert).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
      return (z) => !leer(z[spalte]) && muster.test(String(z[spalte]))
    }
    case 'in': {
      const liste = Array.isArray(wert) ? wert : String(wert).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim())
      return (z) => liste.some((w) => gleich(z[spalte], w))
    }
    default:
      throw new Error(`Testdatenbank: Operator ${op} wird nicht unterstützt`)
  }
}

/** PostgREST-`or`: 'a.is.null,a.lt.2026-11-20T10:00:00.000Z' (Kommas auf oberster Ebene trennen). */
function oderFilter(ausdruck: string): Filter {
  const teile: string[] = []
  let tiefe = 0
  let aktuell = ''
  for (const c of ausdruck) {
    if (c === '(') tiefe++
    if (c === ')') tiefe--
    if (c === ',' && tiefe === 0) {
      teile.push(aktuell)
      aktuell = ''
    } else aktuell += c
  }
  if (aktuell) teile.push(aktuell)
  const filter = teile.map((t) => {
    const p1 = t.indexOf('.')
    const p2 = t.indexOf('.', p1 + 1)
    if (p1 < 0 || p2 < 0) throw new Error(`Testdatenbank: or-Teil nicht lesbar: ${t}`)
    return filterAus(t.slice(0, p1).trim(), t.slice(p1 + 1, p2), t.slice(p2 + 1))
  })
  return (z) => filter.some((f) => f(z))
}

function auswahl(z: Zeile, spalten: string | null): Zeile {
  if (!spalten || spalten.trim() === '*' || spalten.includes('(')) return structuredClone(z)
  const aus: Zeile = {}
  for (const s of spalten.split(',').map((x) => x.trim()).filter(Boolean)) aus[s] = s in z ? structuredClone(z[s]) : null
  return aus
}

export type AbfrageInfo = { tabelle: string; art: 'select' | 'insert' | 'upsert' | 'update' | 'delete'; anzahl: number }

class Abfrage implements PromiseLike<Ergebnis> {
  private art: AbfrageInfo['art'] = 'select'
  private filter: Filter[] = []
  private spalten: string | null = '*'
  private mitRueckgabe = false
  private nutzlast: unknown
  private konflikt: string | null = null
  private sortierung: { spalte: string; auf: boolean }[] = []
  private grenze: number | null = null
  private einzel: 'vielleicht' | 'genau' | null = null

  constructor(private db: FalscheDatenbank, private tabelle: string) {}

  select(spalten = '*'): this {
    if (this.art === 'select') this.spalten = spalten
    else {
      this.mitRueckgabe = true
      this.spalten = spalten
    }
    return this
  }
  insert(zeilen: Zeile | Zeile[]): this {
    this.art = 'insert'
    this.nutzlast = zeilen
    return this
  }
  upsert(zeilen: Zeile | Zeile[], o: { onConflict?: string } = {}): this {
    this.art = 'upsert'
    this.nutzlast = zeilen
    this.konflikt = o.onConflict ?? null
    return this
  }
  update(aenderung: Zeile): this {
    this.art = 'update'
    this.nutzlast = aenderung
    return this
  }
  delete(): this {
    this.art = 'delete'
    return this
  }
  eq(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'eq', w))
    return this
  }
  neq(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'neq', w))
    return this
  }
  lt(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'lt', w))
    return this
  }
  lte(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'lte', w))
    return this
  }
  gt(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'gt', w))
    return this
  }
  gte(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'gte', w))
    return this
  }
  is(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'is', w === null ? 'null' : w))
    return this
  }
  in(s: string, w: unknown[]): this {
    this.filter.push(filterAus(s, 'in', w))
    return this
  }
  ilike(s: string, w: unknown): this {
    this.filter.push(filterAus(s, 'ilike', w))
    return this
  }
  /** Verneinung eines einfachen Filters, z. B. not('spalte', 'is', null). */
  not(s: string, op: string, w: unknown): this {
    const f = filterAus(s, op, op === 'is' && w === null ? 'null' : w)
    this.filter.push((z) => !f(z))
    return this
  }
  or(ausdruck: string): this {
    this.filter.push(oderFilter(ausdruck))
    return this
  }
  order(spalte: string, o: { ascending?: boolean } = {}): this {
    this.sortierung.push({ spalte, auf: o.ascending !== false })
    return this
  }
  limit(n: number): this {
    this.grenze = n
    return this
  }
  maybeSingle(): this {
    this.einzel = 'vielleicht'
    return this
  }
  single(): this {
    this.einzel = 'genau'
    return this
  }

  then<A = Ergebnis, B = never>(ok?: ((e: Ergebnis) => A | PromiseLike<A>) | null, fehler?: ((g: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve()
      .then(async () => {
        const e = this.ausfuehren()
        if (this.db.nachAbfrage) await this.db.nachAbfrage({ tabelle: this.tabelle, art: this.art, anzahl: Array.isArray(e.data) ? e.data.length : e.data ? 1 : 0 })
        return e
      })
      .then(ok, fehler)
  }

  private passt(z: Zeile): boolean {
    return this.filter.every((f) => f(z))
  }

  private ergebnis(zeilen: Zeile[], rueckgabe: boolean): Ergebnis {
    if (!rueckgabe) return { data: null, error: null }
    let aus = zeilen.map((z) => auswahl(z, this.spalten))
    for (const s of [...this.sortierung].reverse()) {
      aus = [...aus].sort((a, b) => {
        const v = vergleiche(a[s.spalte], b[s.spalte])
        const w = v === null ? (leer(a[s.spalte]) ? 1 : -1) : v
        return s.auf ? w : -w
      })
    }
    if (this.grenze !== null) aus = aus.slice(0, this.grenze)
    if (this.einzel) {
      if (aus.length > 1) return { data: null, error: { code: 'PGRST116', message: `Testdatenbank: ${aus.length} Zeilen statt einer` } }
      if (aus.length === 0) return this.einzel === 'genau' ? { data: null, error: { code: 'PGRST116', message: 'Testdatenbank: keine Zeile' } } : { data: null, error: null }
      return { data: aus[0], error: null }
    }
    return { data: aus, error: null }
  }

  private ausfuehren(): Ergebnis {
    const tab = this.db.tabelle(this.tabelle)
    const pk = this.konflikt ?? primaerschluessel(this.tabelle)
    this.db.protokoll.push({ tabelle: this.tabelle, art: this.art })

    if (this.art === 'select') return this.ergebnis(tab.filter((z) => this.passt(z)), true)

    if (this.art === 'insert' || this.art === 'upsert') {
      const neu = (Array.isArray(this.nutzlast) ? this.nutzlast : [this.nutzlast]).map((z) => structuredClone(z as Zeile))
      const betroffen: Zeile[] = []
      const ersatz = new Map<Zeile, Zeile>()
      const anzuhaengen: Zeile[] = []
      for (const z of neu) {
        if (pk === 'id' && leer(z.id)) z.id = crypto.randomUUID()
        if (!('erstellt_am' in z)) z.erstellt_am = new Date().toISOString()
        const vorhanden = [...tab, ...anzuhaengen].find((x) => gleich(x[pk], z[pk]))
        if (vorhanden && this.art === 'upsert') {
          const zusammen = { ...(ersatz.get(vorhanden) ?? vorhanden), ...z, erstellt_am: vorhanden.erstellt_am }
          ersatz.set(vorhanden, zusammen)
          betroffen.push(zusammen)
          continue
        }
        if (vorhanden) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.tabelle}_pkey"` } }
        for (const s of EINDEUTIG[this.tabelle] ?? []) {
          if (!leer(z[s]) && [...tab, ...anzuhaengen].some((x) => gleich(x[s], z[s]))) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.tabelle}_${s}_key"` } }
          }
        }
        anzuhaengen.push(z)
        betroffen.push(z)
      }
      for (const [alt, zusammen] of ersatz) tab[tab.indexOf(alt)] = zusammen
      tab.push(...anzuhaengen)
      return this.ergebnis(betroffen, this.mitRueckgabe)
    }

    if (this.art === 'update') {
      const betroffen: Zeile[] = []
      for (let i = 0; i < tab.length; i++) {
        if (!this.passt(tab[i])) continue
        tab[i] = { ...tab[i], ...structuredClone(this.nutzlast as Zeile) }
        betroffen.push(tab[i])
      }
      return this.ergebnis(betroffen, this.mitRueckgabe)
    }

    // delete
    const weg = tab.filter((z) => this.passt(z))
    const bleibt = tab.filter((z) => !this.passt(z))
    tab.length = 0
    tab.push(...bleibt)
    return this.ergebnis(weg, this.mitRueckgabe)
  }
}

export type Datei = { bytes: Uint8Array<ArrayBuffer>; contentType: string }

async function alsBytes(inhalt: unknown): Promise<Uint8Array<ArrayBuffer>> {
  if (inhalt instanceof Uint8Array) return new Uint8Array(inhalt)
  if (inhalt instanceof ArrayBuffer) return new Uint8Array(inhalt.slice(0))
  if (inhalt instanceof Blob) return new Uint8Array(await inhalt.arrayBuffer())
  if (typeof inhalt === 'string') return new TextEncoder().encode(inhalt)
  throw new Error('Testablage: unbekannter Inhalt')
}

export class FalscheDatenbank {
  /** Tabellen im Speicher (direkt prüfbar und änderbar). */
  readonly tabellen: Record<string, Zeile[]>
  /** Speicher-Eimer → Pfad → Datei. */
  readonly ablage = new Map<string, Map<string, Datei>>()
  /** Jede ausgeführte Abfrage (Tabelle, Art) in Reihenfolge. */
  readonly protokoll: { tabelle: string; art: string }[] = []
  /** Haken nach jeder Abfrage, vor dem Zurückgeben — z. B. um Abläufe gezielt zu verzögern. */
  nachAbfrage?: (info: AbfrageInfo) => void | Promise<void>

  constructor(tabellen: Record<string, Zeile[]> = {}) {
    this.tabellen = structuredClone(tabellen)
  }

  tabelle(name: string): Zeile[] {
    return (this.tabellen[name] ??= [])
  }

  from(tabelle: string): Abfrage {
    return new Abfrage(this, tabelle)
  }

  readonly storage = {
    from: (eimer: string) => {
      const fach = () => {
        if (!this.ablage.has(eimer)) this.ablage.set(eimer, new Map())
        return this.ablage.get(eimer)!
      }
      return {
        upload: async (pfad: string, inhalt: unknown, o: { contentType?: string; upsert?: boolean } = {}) => {
          if (fach().has(pfad) && !o.upsert) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
          fach().set(pfad, { bytes: await alsBytes(inhalt), contentType: o.contentType ?? 'application/octet-stream' })
          return { data: { path: pfad, fullPath: `${eimer}/${pfad}` }, error: null }
        },
        download: (pfad: string) => {
          const d = fach().get(pfad)
          if (!d) return Promise.resolve({ data: null, error: { statusCode: '404', message: 'Object not found' } })
          return Promise.resolve({ data: new Blob([d.bytes], { type: d.contentType }), error: null })
        },
        remove: (pfade: string[]) => {
          const weg = pfade.filter((p) => fach().delete(p))
          return Promise.resolve({ data: weg.map((name) => ({ name })), error: null })
        },
        getPublicUrl: (pfad: string) => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/${eimer}/${pfad}` } }),
      }
    },
  }
}

/** In-Speicher-Ersatz für den Supabase-Admin-Client. */
export function falscheDatenbank(tabellen?: Record<string, Zeile[]>): FalscheDatenbank {
  return new FalscheDatenbank(tabellen)
}

// ---------- Falsches Microsoft ----------

export type MsAnfrage = {
  art: 'token' | 'graph'
  methode: string
  /** Volle Adresse, wie sie an fetch ging. */
  url: string
  /** Graph: Pfad nach /v1.0 ohne Abfrage (z. B. '/me/messages/X'); Anmeldung: '/token'. */
  weg: string
  /** Graph: Pfad nach /v1.0 samt entschlüsselter Abfrage (zum Lesen in Prüfungen). */
  pfad: string
  /** Abfrage-Parameter (entschlüsselt). */
  abfrage: URLSearchParams
  /** Kopfzeilen, Namen klein. */
  kopf: Record<string, string>
  text: string
  /** Formularfelder (Anmeldung). */
  form: URLSearchParams
  /** JSON-Körper (Graph), falls vorhanden. */
  json: unknown
}

export type MsRouter = (a: MsAnfrage) => Response | Record<string, unknown> | undefined | Promise<Response | Record<string, unknown> | undefined>

/** JSON-Antwort für den Router. */
export function jsonAntwort(daten: unknown, status = 200, kopf: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(daten), { status, headers: { 'content-type': 'application/json', ...kopf } })
}

/**
 * Ersetzt globalThis.fetch: Anfragen an login.microsoftonline.com/…/oauth2/v2.0/token und graph.microsoft.com/v1.0/…
 * gehen an `router`, jede andere Adresse wirft (beweist: kein echtes Netz). Gibt eine Funktion zurück, die das
 * echte fetch wiederherstellt; an ihr hängen die mitgeschriebenen `aufrufe`.
 */
export function falschesMicrosoft(router: MsRouter): (() => void) & { aufrufe: MsAnfrage[] } {
  const echt = globalThis.fetch
  const aufrufe: MsAnfrage[] = []
  globalThis.fetch = (async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const roh = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url
    const url = new URL(roh)
    let art: MsAnfrage['art']
    let weg: string
    if (url.hostname === 'login.microsoftonline.com' && /^\/[^/]+\/oauth2\/v2\.0\/token$/.test(url.pathname)) {
      art = 'token'
      weg = '/token'
    } else if (url.hostname === 'graph.microsoft.com' && url.pathname.startsWith('/v1.0/')) {
      art = 'graph'
      weg = decodeURIComponent(url.pathname.slice('/v1.0'.length))
    } else {
      throw new Error(`Test: unerlaubter Netzzugriff auf ${url.origin}${url.pathname}`)
    }
    const kopf: Record<string, string> = {}
    new Headers(init.headers ?? (eingabe instanceof Request ? eingabe.headers : undefined)).forEach((w, k) => (kopf[k] = w))
    const text = init.body === undefined || init.body === null ? '' : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body)
    let json: unknown = undefined
    if (text && (kopf['content-type'] ?? '').includes('json')) json = JSON.parse(text)
    let lesbar = url.search
    try {
      lesbar = decodeURIComponent(url.search)
    } catch { /* bleibt roh */ }
    const anfrage: MsAnfrage = {
      art,
      methode: (init.method ?? 'GET').toUpperCase(),
      url: roh,
      weg,
      pfad: weg + lesbar,
      abfrage: url.searchParams,
      kopf,
      text,
      form: new URLSearchParams(art === 'token' ? text : ''),
      json,
    }
    aufrufe.push(anfrage)
    const antwort = await router(anfrage)
    if (antwort === undefined) throw new Error(`Test: kein Weg für ${anfrage.methode} ${anfrage.pfad}`)
    return antwort instanceof Response ? antwort : jsonAntwort(antwort)
  }) as typeof fetch
  const zurueck = () => {
    globalThis.fetch = echt
  }
  return Object.assign(zurueck, { aufrufe })
}

/** Gültiger Zugang (Erneuerungsschlüssel r1, Zugangsschlüssel z1, eine Stunde gültig). */
export function testZugang(): { erneuerung: string; zugang: string; ablauf: number } {
  return { erneuerung: 'r1', zugang: 'z1', ablauf: Date.now() + 3600e3 }
}

/**
 * Legt ein verbundenes Microsoft-Konto an: Zeile in ms_konten und verschlüsselter Zugang in ms_geheimnisse
 * (Standard {erneuerung:'r1', zugang:'z1', ablauf: in einer Stunde}). Setzt vorher den Test-Dienst-Schlüssel.
 */
export async function verbundenesKonto(
  db: FalscheDatenbank,
  email: string,
  o: { zugang?: Record<string, unknown>; konto?: Zeile } = {},
): Promise<void> {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)
  const login = email.toLowerCase()
  const jetzt = new Date().toISOString()
  const konten = db.tabelle('ms_konten').filter((z) => z.login_email !== login)
  konten.push({ login_email: login, ms_adresse: login, ms_name: 'Test Person', verbunden_am: jetzt, letzter_fehler: null, letzter_erfolg: null, erneuerung_seit: null, stand: {}, ...(o.konto ?? {}) })
  db.tabellen.ms_konten = konten
  const geheim = db.tabelle('ms_geheimnisse').filter((z) => z.login_email !== login)
  geheim.push({ login_email: login, verschluesselt: await verschluessele(JSON.stringify(o.zugang ?? testZugang())), geaendert_am: jetzt })
  db.tabellen.ms_geheimnisse = geheim
}
