// Aktion `dubletten` (22.11.2026) für die Seite „Dubletten“ im CRM (src/pages/admin/Dubletten.tsx), nur
// Geschäftsführung, Admins und Superuser. Dünne Schicht über vorhandenem Code:
//  - liste:            mögliche Dubletten (Kern: _shared/dublettenKern.ts, Laden: _shared/dublettenLaden.ts)
//                      mit Angaben und Zahlen (Dokumente, Verlauf, Rechnungen …) je Akte bzw. Objekt.
//  - zusammenfuehren:  ruft das vorhandene kunden_zusammenfuehren des Assistenten auf
//                      (telegram-gateway/pflegeWerkzeuge.ts) — erst als Prüfung (erster Aufruf ändert nichts),
//                      dann bestätigt. Die Bestätigung ist hier der Knopf „Zusammenführen“ mit Rückfrage auf der
//                      Seite. Davor: gewählte Angaben je Feld in die bleibende Akte (alter Wert in den Verlauf),
//                      leere Felder füllen, die das Werkzeug nicht kennt (Anschrift, Branche …), und Verweise
//                      umhängen, die das Werkzeug nicht kennt (_shared/aktenVerweise.ts) — sonst löschte die
//                      Datenbank z. B. Wiedervorlagen der doppelten Akte mit.
//  - bereich_wechseln: ruft kunde_bereich_wechseln (ebenda) auf — für Dubletten in verschiedenen Bereichen,
//                      die erst in denselben Bereich müssen.
//  - keine_dublette:   merkt die Paare einer Gruppe in dubletten_ausnahmen; sie werden nicht mehr vorgeschlagen.
// Objekte werden nur erkannt und verglichen; Zusammenführen von Objekten gibt es (noch) nicht.

import { fuehrePflegeWerkzeugAus, type PflegeAnfrage, type PflegeKontext } from '../telegram-gateway/pflegeWerkzeuge.ts'
import { bereichName, type RechteMitarbeiter } from '../telegram-gateway/rechte.ts'
import { allePaare, type DublettenGruppe, gruppenText } from '../_shared/dublettenKern.ts'
import { type AktenZaehler, AUSNAHMEN_TABELLE, findeDublettenInDb, type ObjektZaehler, zaehleAkten, zaehleObjekte } from '../_shared/dublettenLaden.ts'
import { weitereVerweiseUmhaengen } from '../_shared/aktenVerweise.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type DublettenUmgebung = {
  admin: Db
  aufrufer: { email: string; name: string }
  heute: string
  protokolliere?: (text: string) => void
}

export type DublettenAntwort = { status: number; daten: unknown }

type Mitarbeiter = RechteMitarbeiter & { name: string; ist_superuser?: boolean | null }

/** Felder, bei denen die Seite je Feld wählen lässt, welche Akte gewinnt. */
export const WAEHLBARE_FELDER = ['firma', 'ansprechpartner', 'email', 'telefon', 'anschrift', 'branche', 'verantwortlich', 'status', 'prioritaet'] as const
export const FELD_NAME: Record<string, string> = {
  firma: 'Name',
  ansprechpartner: 'Ansprechpartner',
  email: 'E-Mail',
  telefon: 'Telefon',
  anschrift: 'Anschrift',
  branche: 'Branche',
  verantwortlich: 'Verantwortlich',
  status: 'Status',
  prioritaet: 'Priorität',
}
// Was kunden_zusammenfuehren nicht mitnimmt: leere Textfelder füllen, Listen anhängen, Einzelnes übernehmen, wenn leer.
const LEER_AUFFUELLEN = ['anschrift', 'branche', 'sachverhalt', 'naechste_schritte']
const LISTEN_ANHAENGEN = ['seminare', 'dienstleistungen']
const WENN_LEER_UEBERNEHMEN = ['vermittler', 'auftrag_chance', 'ampel_manuell']

const MAX_JE_AUFRUF = 10

function leer(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

function gleich(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

function ohneDoppelte(eintraege: unknown[]): unknown[] {
  const gesehen = new Set<string>()
  return eintraege.filter((x) => {
    const s = x && typeof x === 'object' && 'id' in (x as Zeile) ? `id:${(x as Zeile).id}` : JSON.stringify(x)
    if (gesehen.has(s)) return false
    gesehen.add(s)
    return true
  })
}

function zeichenkette(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function fehler(status: number, text: string): DublettenAntwort {
  return { status, daten: { error: text } }
}

/**
 * Die Antworten des Werkzeugs sind an den Assistenten gerichtet („Sag dem Mitarbeiter …“, „mit kunden_suchen“).
 * Für die Seite bleiben nur die Sätze, die den Sachstand beschreiben.
 */
export function fuerDieSeite(text: string): string {
  const saetze = text.split(/(?<=[.!])\s+/)
  const weg = /kunden_suchen|kunden_zusammenfuehren|kunde_bereich_wechseln|in_oeffentlich_holen|Sag dem Mitarbeiter|Sag das dem Mitarbeiter|Frage den Mitarbeiter|Biete an|frag nach|Nur wenn er/i
  return saetze.filter((s) => !weg.test(s)).join(' ').replace(/^Fehler:\s*/, '').trim()
}

async function ladeMitarbeiter(admin: Db, email: string): Promise<(Mitarbeiter & { aktiv?: boolean }) | null> {
  const spalten = 'name, email, rolle, ist_admin, bereiche, ist_superuser, aktiv'
  const { data } = await admin.from('mitarbeiter').select(spalten).eq('email', email).maybeSingle()
  if (data) return data as Mitarbeiter
  const muster = email.toLowerCase().replace(/[\\%_]/g, (z: string) => `\\${z}`)
  const { data: z } = await admin.from('mitarbeiter').select(spalten).ilike('email', muster).maybeSingle()
  return (z as Mitarbeiter | null) ?? null
}

export function darfDubletten(m: Partial<Mitarbeiter> | null | undefined): boolean {
  return !!m && (m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true || m.ist_superuser === true)
}

export async function dublettenAktion(umg: DublettenUmgebung, body: Zeile): Promise<DublettenAntwort> {
  const m = await ladeMitarbeiter(umg.admin, umg.aufrufer.email)
  if (!m || m.aktiv === false) return fehler(401, 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.')
  if (!darfDubletten(m)) return fehler(403, 'Die Dubletten-Suche ist nur für die Geschäftsführung freigegeben.')
  const modus = zeichenkette(body.modus) || 'liste'
  if (modus === 'liste') return await liste(umg)
  if (modus === 'zusammenfuehren') return await zusammenfuehren(umg, m, body)
  if (modus === 'bereich_wechseln') return await bereichWechseln(umg, m, body)
  if (modus === 'keine_dublette') return await keineDublette(umg, m, body)
  return fehler(400, 'Unbekannter Modus — erwartet liste, zusammenfuehren, bereich_wechseln oder keine_dublette.')
}

// ---------- Liste ----------

export type AkteAnsicht = {
  id: string
  bereich: string
  bereichName: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string
  anschrift: string
  branche: string
  status: string
  prioritaet: string
  verantwortlich: string
  letzte_aktivitaet: string
  zaehler: AktenZaehler
}

export type ObjektAnsicht = {
  id: string
  bezeichnung: string
  adresse: string
  typ: string
  status: string
  kaufpreis: number | null
  verantwortlich: string
  zaehler: ObjektZaehler
}

export type GruppeMitAkten = DublettenGruppe & { text: string; vorschlag: string; akten: AkteAnsicht[] }
export type GruppeMitObjekten = DublettenGruppe & { text: string; vorschlag: string; objekte: ObjektAnsicht[] }

function t(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

/** Vollständigste Akte (Vorschlag „bleibt bestehen“): ausgefüllte Felder und angehängte Daten. */
function vollstaendigkeit(a: AkteAnsicht): number {
  const felder = [a.firma, a.ansprechpartner, a.email, a.telefon, a.anschrift, a.branche].filter((x) => x.trim()).length
  const z = a.zaehler
  return felder * 2 + z.dokumente + z.verlauf + 3 * (z.rechnungen + z.protokolle) + z.termine + z.mails + z.wiedervorlagen + 2 * z.kostenvoranschlaege
}

async function liste(umg: DublettenUmgebung): Promise<DublettenAntwort> {
  let lage
  try {
    lage = await findeDublettenInDb(umg.admin)
  } catch (e) {
    return fehler(500, `Die Daten ließen sich nicht laden: ${(e as Error).message}`)
  }
  const aktenIds = [...new Set(lage.kunden.flatMap((g) => g.ids))]
  const objektIds = [...new Set(lage.objekte.flatMap((g) => g.ids))]
  const [za, zo] = await Promise.all([zaehleAkten(umg.admin, aktenIds), zaehleObjekte(umg.admin, objektIds)])
  const leerA: AktenZaehler = { dokumente: 0, verlauf: 0, rechnungen: 0, protokolle: 0, termine: 0, mails: 0, wiedervorlagen: 0, kostenvoranschlaege: 0 }
  const leerO: ObjektZaehler = { dokumente: 0, verlauf: 0, besichtigungen: 0, anfragen: 0, vorschlaege: 0 }

  const kunden: GruppeMitAkten[] = lage.kunden.map((g) => {
    const akten = g.ids.map((id): AkteAnsicht => {
      const z = lage.akten.get(id) ?? {}
      return {
        id,
        bereich: t(z.bereich),
        bereichName: bereichName(z.bereich),
        firma: t(z.firma),
        ansprechpartner: t(z.ansprechpartner),
        email: t(z.email),
        telefon: t(z.telefon),
        anschrift: t(z.anschrift),
        branche: t(z.branche),
        status: t(z.status),
        prioritaet: t(z.prioritaet),
        verantwortlich: t(z.verantwortlich),
        letzte_aktivitaet: t(z.letzte_aktivitaet),
        zaehler: za[id] ?? leerA,
      }
    })
    const vorschlag = [...akten].sort((x, y) => vollstaendigkeit(y) - vollstaendigkeit(x))[0]?.id ?? g.ids[0]
    return { ...g, text: gruppenText(g), vorschlag, akten }
  })

  const objekte: GruppeMitObjekten[] = lage.objekte.map((g) => {
    const liste = g.ids.map((id): ObjektAnsicht => {
      const z = lage.objektZeilen.get(id) ?? {}
      return {
        id,
        bezeichnung: t(z.bezeichnung),
        adresse: t(z.adresse),
        typ: t(z.typ),
        status: t(z.status),
        kaufpreis: typeof z.kaufpreis === 'number' ? z.kaufpreis : z.kaufpreis ? Number(z.kaufpreis) : null,
        verantwortlich: t(z.verantwortlich),
        zaehler: zo[id] ?? leerO,
      }
    })
    const vorschlag = [...liste].sort((x, y) => y.zaehler.dokumente + y.zaehler.verlauf - (x.zaehler.dokumente + x.zaehler.verlauf))[0]?.id ?? g.ids[0]
    return { ...g, text: gruppenText(g), vorschlag, objekte: liste }
  })

  return { status: 200, daten: { kunden, objekte, ausnahmen: lage.ausnahmen } }
}

// ---------- Zusammenführen ----------

export type EinzelErgebnis = { entferne_id: string; ok: boolean; text: string; umgehaengt?: Record<string, number> }

async function zusammenfuehren(umg: DublettenUmgebung, m: Mitarbeiter, body: Zeile): Promise<DublettenAntwort> {
  const behalte = zeichenkette(body.behalte_id)
  const roh = Array.isArray(body.entferne_ids) ? body.entferne_ids : body.entferne_id ? [body.entferne_id] : []
  const entferne = [...new Set(roh.map(zeichenkette).filter(Boolean))].filter((id) => id !== behalte)
  if (!behalte || entferne.length === 0) return fehler(400, 'Es fehlt, welche Akte bleibt (behalte_id) und welche eingearbeitet wird (entferne_ids).')
  if (entferne.length > MAX_JE_AUFRUF) return fehler(400, `Höchstens ${MAX_JE_AUFRUF} Akten auf einmal.`)
  const felder: Record<string, string> = {}
  if (body.felder && typeof body.felder === 'object') {
    for (const [feld, id] of Object.entries(body.felder as Zeile)) {
      if ((WAEHLBARE_FELDER as readonly string[]).includes(feld) && typeof id === 'string') felder[feld] = id
    }
  }
  const ergebnisse: EinzelErgebnis[] = []
  for (const id of entferne) {
    const r = await einarbeiten(umg, m, behalte, id, felder)
    ergebnisse.push(r)
    if (!r.ok) break
  }
  return { status: 200, daten: { ok: ergebnisse.length === entferne.length && ergebnisse.every((r) => r.ok), ergebnisse } }
}

function pflegeKontext(umg: DublettenUmgebung, m: Mitarbeiter, merke: (a: PflegeAnfrage) => void, vorherige?: PflegeAnfrage, status?: { netz: Record<string, Record<string, string>>; start: Record<string, string> }): PflegeKontext {
  return {
    supabase: umg.admin,
    mitarbeiter: m,
    vorherige,
    merkeAnfrage: merke,
    protokolliere: umg.protokolliere ?? ((text) => console.log(`[dubletten] ${umg.aufrufer.email}: ${text}`)),
    heute: umg.heute,
    statusJeBereich: status?.netz ?? {},
    startStatus: status?.start ?? {},
  }
}

async function einarbeiten(umg: DublettenUmgebung, m: Mitarbeiter, behalte: string, entferne: string, felder: Record<string, string>): Promise<EinzelErgebnis> {
  const eingabe = { behalte_id: behalte, entferne_id: entferne }
  // 1. Prüfen über das Werkzeug selbst (Rechte, privat, Sammelakte, gleicher Bereich). Ändert nichts.
  let gemerkt: PflegeAnfrage | undefined
  const pruefung = await fuehrePflegeWerkzeugAus('kunden_zusammenfuehren', eingabe, pflegeKontext(umg, m, (a) => (gemerkt = a)))
  if (!gemerkt) return { entferne_id: entferne, ok: false, text: fuerDieSeite(pruefung) }

  // 2. Gewählte Angaben und was das Werkzeug nicht mitnimmt.
  const felderFehler = await felderUebernehmen(umg, m, behalte, entferne, felder)
  if (felderFehler) return { entferne_id: entferne, ok: false, text: `Nicht zusammengeführt: ${felderFehler}` }

  // 3. Verweise, die das Werkzeug nicht umhängt — vor dem Löschen.
  const u = await weitereVerweiseUmhaengen(umg.admin, entferne, behalte)
  if (u.fehler.length > 0) {
    return {
      entferne_id: entferne,
      ok: false,
      text: `Nicht zusammengeführt: Einige Verweise ließen sich nicht umhängen (${u.fehler.join('; ')}). Die gewählten Angaben stehen schon in der bleibenden Akte; gelöscht ist nichts.`,
      umgehaengt: u.umgehaengt,
    }
  }

  // 4. Bestätigter Aufruf: führt zusammen, hängt die übrigen Verweise um und löscht die doppelte Akte.
  const text = await fuehrePflegeWerkzeugAus('kunden_zusammenfuehren', eingabe, pflegeKontext(umg, m, () => {}, gemerkt))
  return { entferne_id: entferne, ok: text.startsWith('Zusammengeführt'), text: fuerDieSeite(text), umgehaengt: u.umgehaengt }
}

/** Schreibt gewählte Angaben der doppelten Akte in die bleibende (nur geänderte Spalten). Fehlertext oder null. */
async function felderUebernehmen(umg: DublettenUmgebung, m: Mitarbeiter, behalteId: string, entferneId: string, felder: Record<string, string>): Promise<string | null> {
  const [{ data: b, error: eb }, { data: e, error: ee }] = await Promise.all([
    umg.admin.from('kunden').select('*').eq('id', behalteId).maybeSingle(),
    umg.admin.from('kunden').select('*').eq('id', entferneId).maybeSingle(),
  ])
  if (eb || ee || !b || !e) return `Die Akten ließen sich nicht lesen${eb || ee ? ` (${(eb ?? ee).message})` : ''}.`
  const patch: Zeile = {}
  const ersetzt: string[] = []
  const gefuellt: string[] = []
  for (const feld of WAEHLBARE_FELDER) {
    if (felder[feld] !== entferneId || leer(e[feld]) || gleich(b[feld], e[feld]) || !(feld in b)) continue
    patch[feld] = e[feld]
    if (feld === 'verantwortlich' && 'verantwortlich_email' in b) patch.verantwortlich_email = e.verantwortlich_email ?? null
    if (leer(b[feld])) gefuellt.push(FELD_NAME[feld])
    else ersetzt.push(`${FELD_NAME[feld]} (bisher: ${String(b[feld]).trim()})`)
  }
  for (const feld of LEER_AUFFUELLEN) {
    if (feld in patch || !(feld in b) || felder[feld] === behalteId) continue
    if (leer(b[feld]) && !leer(e[feld])) {
      patch[feld] = e[feld]
      gefuellt.push(FELD_NAME[feld] ?? feld)
    }
  }
  for (const feld of LISTEN_ANHAENGEN) {
    if (!(feld in b) || !Array.isArray(e[feld]) || e[feld].length === 0) continue
    patch[feld] = Array.isArray(b[feld]) && b[feld].length > 0 ? ohneDoppelte([...b[feld], ...e[feld]]) : e[feld]
  }
  for (const feld of WENN_LEER_UEBERNEHMEN) {
    if (feld in b && leer(b[feld]) && !leer(e[feld])) patch[feld] = e[feld]
  }
  if (Object.keys(patch).length === 0) return null
  if (ersetzt.length > 0 || gefuellt.length > 0) {
    const teile = [
      ersetzt.length > 0 ? `ersetzt: ${ersetzt.join(', ')}` : '',
      gefuellt.length > 0 ? `ergänzt: ${gefuellt.join(', ')}` : '',
    ].filter(Boolean)
    const eintrag = {
      id: crypto.randomUUID(),
      date: umg.heute,
      text: `Vor dem Zusammenführen Angaben aus der doppelten Akte übernommen durch ${m.name} (Seite Dubletten) — ${teile.join('; ')}.`,
      user: m.name,
    }
    patch.activities = [eintrag, ...(Array.isArray(b.activities) ? b.activities : [])]
  }
  const { error } = await umg.admin.from('kunden').update(patch).eq('id', behalteId)
  return error ? `Die gewählten Angaben ließen sich nicht speichern (${error.message}); nichts geändert.` : null
}

// ---------- Bereich wechseln ----------

function istStatusNetz(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const eintraege = Object.entries(v as Zeile)
  return eintraege.length > 0 && eintraege.length <= 40 && eintraege.every(([k, w]) => /^[a-z_]{1,40}$/.test(k) && typeof w === 'string' && w.length <= 80)
}

async function bereichWechseln(umg: DublettenUmgebung, m: Mitarbeiter, body: Zeile): Promise<DublettenAntwort> {
  const kundeId = zeichenkette(body.kunde_id)
  const nach = zeichenkette(body.nach_bereich)
  const start = zeichenkette(body.start_status)
  if (!kundeId || !nach) return fehler(400, 'Es fehlt, welche Akte (kunde_id) in welchen Bereich (nach_bereich) soll.')
  // Statuslisten kommen aus src/data/statusNetworks.ts der Seite (der Server kennt sie nur im Telegram-Assistenten).
  if (!istStatusNetz(body.status_netz) || !start || !(start in (body.status_netz as Zeile))) return fehler(400, 'Die Statusliste des Ziel-Bereichs fehlt oder ist ungültig.')
  const status = { netz: { [nach]: body.status_netz as Record<string, string> }, start: { [nach]: start } }
  const eingabe = { kunde_id: kundeId, nach_bereich: nach }
  let gemerkt: PflegeAnfrage | undefined
  const pruefung = await fuehrePflegeWerkzeugAus('kunde_bereich_wechseln', eingabe, pflegeKontext(umg, m, (a) => (gemerkt = a), undefined, status))
  if (!gemerkt) return { status: 200, daten: { ok: false, text: fuerDieSeite(pruefung) } }
  const text = await fuehrePflegeWerkzeugAus('kunde_bereich_wechseln', eingabe, pflegeKontext(umg, m, () => {}, gemerkt, status))
  return { status: 200, daten: { ok: text.startsWith('Verschoben'), text: fuerDieSeite(text) } }
}

// ---------- Keine Dublette ----------

async function keineDublette(umg: DublettenUmgebung, m: Mitarbeiter, body: Zeile): Promise<DublettenAntwort> {
  const art = zeichenkette(body.art)
  if (art !== 'kunde' && art !== 'objekt') return fehler(400, 'art muss kunde oder objekt sein.')
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(zeichenkette).filter(Boolean))] : []
  if (ids.length < 2 || ids.length > 20) return fehler(400, 'Es braucht zwei bis zwanzig Ids.')
  const zeilen = allePaare(ids).map((s) => ({ id: `${art}:${s}`, art, schluessel: s, erstellt_von: m.name }))
  const { error } = await umg.admin.from(AUSNAHMEN_TABELLE).upsert(zeilen, { onConflict: 'id' })
  if (error) return fehler(500, `Nicht gespeichert: ${error.message}`)
  umg.protokolliere?.(`Keine Dublette gemerkt (${art}): ${ids.join(', ')}`)
  return { status: 200, daten: { ok: true, anzahl: zeilen.length } }
}
