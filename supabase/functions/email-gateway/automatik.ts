// Seite „Automatische Nachrichten“ (24.11.2026): Schalter aller automatischen Nachrichten an einer Stelle lesen und
// ändern. Was es gibt, steht im Katalog src/lib/automatik/katalog.ts (Schalter-Kennungen = Schlüssel hier).
//
//   { action: "automatik_stand" }    -> { schalter: { [id]: Stand }, regeln: [...], wvRegeln: [...] }
//   { action: "automatik_schalter", id, wert?, uhrzeit?, wartezeitMinuten?, empfaenger?, tage?, titel? }
//                                    -> { ok: true, stand: Stand }
//
// Beide nur für Geschäftsführung/Admin (mitarbeiter.rolle/ist_admin) oder Superuser (mitarbeiter.ist_superuser).
// Geändert wird ausschließlich, was hier ausdrücklich erlaubt ist (feste Liste + Regeln `regel:<id>` und `wv:<id>`);
// jede Eingabe wird streng geprüft. Wo die Tabelle es kann, stehen Name und Zeitpunkt der Änderung dabei
// (geaendert_von/geaendert_am; beim Schalter in telegram_vorschlaege im Feld daten).

import { ermittleAufrufer } from './postfach.ts'
import { EINSTELLUNG_ID, leseEinstellung, TABELLE as VORSCHLAG_TABELLE } from '../_shared/bestaetigenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Stufe = 'aus' | 'superuser' | 'alle'
export const STUFEN: Stufe[] = ['aus', 'superuser', 'alle']

export type Stand = {
  wert: boolean | Stufe
  uhrzeit?: string
  wartezeitMinuten?: number | null
  empfaenger?: string[]
  geaendertVon?: string
  geaendertAm?: string
  /** nur bei `wv:<id>` */
  tage?: number
  titel?: string
}

export type Regel = { id: string; bereich: string; titel: string; aktiv: boolean; wartezeitMinuten: number | null; anWen: string; vorlageId: string }
export type WvRegel = { id: string; bereich: string; ausloeser: string; titel: string; tage: number; schliesst: string[]; aktiv: boolean; sortierung: number }

type SchalterDef =
  | { art: 'an_aus'; tabelle: string; spalte: string; wartezeitSpalte?: string; wartezeitMax?: number }
  | { art: 'stufe'; tabelle: string; spalte: string; uhrzeitSpalte?: string }
  | { art: 'empfaenger'; spalte: 'zuordnung_an' | 'status_an' }

/** Die einzigen festen Schalter, die die Seite lesen und ändern darf. */
export const SCHALTER: Record<string, SchalterDef> = {
  willkommen: { art: 'an_aus', tabelle: 'willkommen_einstellung', spalte: 'aktiv', wartezeitSpalte: 'verzoegerung_minuten', wartezeitMax: 1440 },
  unterschrift_kopie: { art: 'an_aus', tabelle: 'unterschrift_einstellung', spalte: 'kopie_an_kunde' },
  kundenbericht: { art: 'an_aus', tabelle: 'kundenbericht_schalter', spalte: 'aktiv' },
  mahn: { art: 'an_aus', tabelle: 'mahn_einstellung', spalte: 'aktiv' },
  abend_rueckblick: { art: 'stufe', tabelle: 'assistent_hinweis_einstellung', spalte: 'abend_rueckblick', uhrzeitSpalte: 'abend_rueckblick_uhrzeit' },
  kontakt_nachfrage: { art: 'stufe', tabelle: 'assistent_hinweis_einstellung', spalte: 'kontakt_nachfrage' },
  kurzpruefung_hinweis: { art: 'stufe', tabelle: 'assistent_hinweis_einstellung', spalte: 'kurzpruefung_hinweis' },
  bitte_bestaetigen: { art: 'empfaenger', spalte: 'zuordnung_an' },
  status_vorschlag: { art: 'empfaenger', spalte: 'status_an' },
}

export const REGEL_WARTEZEIT_MAX = 10080
export const WV_TAGE_MAX = 365
export const WV_TITEL_MAX = 200
export const EMPFAENGER_MAX = 50
/** Wie abendRueckblick.ts: andere Uhrzeiten würden dort stillschweigend durch 17:30 ersetzt. */
export const UHRZEIT_VON = 12 * 60
export const UHRZEIT_BIS = 22 * 60
const VORGABE_UHRZEIT = '17:30'
const ADRESSE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/
const KENNUNG = /^[A-Za-z0-9_.-]{1,100}$/

// ---------------------------------------------------------------------------------------------
// Lesen (rein)

function text(x: unknown): string {
  return x === null || x === undefined ? '' : String(x)
}

function geaendert(z: Record<string, unknown> | null | undefined): Pick<Stand, 'geaendertVon' | 'geaendertAm'> {
  const von = text(z?.geaendert_von).trim()
  const am = text(z?.geaendert_am).trim()
  return { ...(von ? { geaendertVon: von } : {}), ...(am ? { geaendertAm: am } : {}) }
}

export function alsStufe(x: unknown): Stufe {
  return x === 'superuser' || x === 'alle' ? x : 'aus'
}

/** „HH:MM“ zwischen 12:00 und 22:00, sonst null. */
export function pruefeUhrzeit(x: unknown): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text(x).trim())
  if (!m) return null
  const min = Number(m[1]) * 60 + Number(m[2])
  return min >= UHRZEIT_VON && min <= UHRZEIT_BIS ? `${m[1]}:${m[2]}` : null
}

export type StandZeilen = {
  willkommen_einstellung?: Record<string, unknown> | null
  unterschrift_einstellung?: Record<string, unknown> | null
  kundenbericht_schalter?: Record<string, unknown> | null
  mahn_einstellung?: Record<string, unknown> | null
  assistent_hinweis_einstellung?: Record<string, unknown> | null
  /** daten der Zeile telegram_vorschlaege 'einstellung' */
  vorschlagDaten?: unknown
}

/** Stand eines festen Schalters aus den gelesenen Zeilen. Fehlende Zeile = aus (wie die Läufe selbst). */
export function standAusZeilen(id: string, z: StandZeilen): Stand | null {
  const def = SCHALTER[id]
  if (!def) return null
  if (def.art === 'empfaenger') {
    const e = leseEinstellung(z.vorschlagDaten)
    const d = (z.vorschlagDaten && typeof z.vorschlagDaten === 'object' ? z.vorschlagDaten : {}) as Record<string, unknown>
    return { wert: def.spalte === 'zuordnung_an' ? e.zuordnungAn : e.statusAn, empfaenger: e.empfaenger, ...geaendert(d) }
  }
  const zeile = (z as Record<string, Record<string, unknown> | null | undefined>)[def.tabelle] ?? null
  if (def.art === 'stufe') {
    const stand: Stand = { wert: alsStufe(zeile?.[def.spalte]), ...geaendert(zeile) }
    if (def.uhrzeitSpalte) stand.uhrzeit = pruefeUhrzeit(zeile?.[def.uhrzeitSpalte]) ?? VORGABE_UHRZEIT
    return stand
  }
  const stand: Stand = { wert: zeile?.[def.spalte] === true, ...geaendert(zeile) }
  if (def.wartezeitSpalte) {
    const w = zeile?.[def.wartezeitSpalte]
    stand.wartezeitMinuten = typeof w === 'number' ? w : 60
  }
  return stand
}

export function alleSchalter(z: StandZeilen): Record<string, Stand> {
  const aus: Record<string, Stand> = {}
  for (const id of Object.keys(SCHALTER)) aus[id] = standAusZeilen(id, z)!
  return aus
}

export function regelAusZeile(r: Record<string, unknown>): Regel {
  return {
    id: text(r.id),
    bereich: text(r.bereich),
    titel: text(r.titel),
    aktiv: r.aktiv === true,
    wartezeitMinuten: typeof r.wartezeit_minuten === 'number' ? r.wartezeit_minuten : null,
    anWen: text(r.an_wen),
    vorlageId: text(r.vorlage_id),
  }
}

export function regelStand(r: Record<string, unknown>): Stand {
  return { wert: r.aktiv === true, wartezeitMinuten: typeof r.wartezeit_minuten === 'number' ? r.wartezeit_minuten : null, ...geaendert(r) }
}

export function wvAusZeile(r: Record<string, unknown>): WvRegel {
  return {
    id: text(r.id),
    bereich: text(r.bereich),
    ausloeser: text(r.ausloeser),
    titel: text(r.titel),
    tage: typeof r.tage === 'number' ? r.tage : 0,
    schliesst: Array.isArray(r.schliesst) ? r.schliesst.map((s) => text(s)) : [],
    aktiv: r.aktiv === true,
    sortierung: typeof r.sortierung === 'number' ? r.sortierung : 0,
  }
}

export function wvStand(r: Record<string, unknown>): Stand {
  const w = wvAusZeile(r)
  return { wert: w.aktiv, tage: w.tage, titel: w.titel }
}

// ---------------------------------------------------------------------------------------------
// Ändern: Eingabe prüfen (rein)

export type Ziel =
  | { art: 'fest'; id: string; def: SchalterDef }
  | { art: 'regel'; regelId: string }
  | { art: 'wv'; regelId: string }

export type Werte = { wert?: boolean | Stufe; uhrzeit?: string; wartezeitMinuten?: number; empfaenger?: string[]; tage?: number; titel?: string }

export type Pruefung = { ok: true; ziel: Ziel; werte: Werte } | { ok: false; fehler: string }

const FELDER = ['wert', 'uhrzeit', 'wartezeitMinuten', 'empfaenger', 'tage', 'titel'] as const

function ganzzahl(x: unknown, max: number): number | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max ? x : null
}

/** Empfängerliste: Adressen, 'superuser' (alle Superuser) oder '*' (alle). Klein geschrieben, ohne Doppelte. */
export function pruefeEmpfaenger(x: unknown): string[] | null {
  if (!Array.isArray(x) || x.length > EMPFAENGER_MAX) return null
  const aus: string[] = []
  for (const roh of x) {
    if (typeof roh !== 'string') return null
    const e = roh.trim().toLowerCase()
    if (!(e === '*' || e === 'superuser' || ADRESSE.test(e))) return null
    if (!aus.includes(e)) aus.push(e)
  }
  return aus
}

export function zielAusId(id: unknown): Ziel | null {
  if (typeof id !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(SCHALTER, id)) return { art: 'fest', id, def: SCHALTER[id] }
  const m = /^(regel|wv):(.+)$/.exec(id)
  if (m && KENNUNG.test(m[2])) return m[1] === 'regel' ? { art: 'regel', regelId: m[2] } : { art: 'wv', regelId: m[2] }
  return null
}

/** Prüft die Eingabe von automatik_schalter. Felder, die zum Schalter nicht passen, sind ein Fehler. */
export function pruefeSchalterEingabe(body: Record<string, unknown>): Pruefung {
  const ziel = zielAusId(body.id)
  if (!ziel) return { ok: false, fehler: 'Diesen Schalter gibt es nicht.' }
  const gegeben = FELDER.filter((f) => body[f] !== undefined)
  if (gegeben.length === 0) return { ok: false, fehler: 'Es wurde nichts geändert.' }

  let erlaubt: readonly string[]
  if (ziel.art === 'regel') erlaubt = ['wert', 'wartezeitMinuten']
  else if (ziel.art === 'wv') erlaubt = ['wert', 'tage', 'titel']
  else if (ziel.def.art === 'an_aus') erlaubt = ziel.def.wartezeitSpalte ? ['wert', 'wartezeitMinuten'] : ['wert']
  else if (ziel.def.art === 'stufe') erlaubt = ziel.def.uhrzeitSpalte ? ['wert', 'uhrzeit'] : ['wert']
  else erlaubt = ['wert', 'empfaenger']
  const falsch = gegeben.filter((f) => !erlaubt.includes(f))
  if (falsch.length > 0) return { ok: false, fehler: `Für diesen Schalter nicht änderbar: ${falsch.join(', ')}.` }

  const werte: Werte = {}
  if (body.wert !== undefined) {
    if (ziel.art === 'fest' && ziel.def.art === 'stufe') {
      if (!STUFEN.includes(body.wert as Stufe)) return { ok: false, fehler: 'Erlaubt sind nur „aus“, „superuser“ (Probelauf) oder „alle“.' }
      werte.wert = body.wert as Stufe
    } else {
      if (typeof body.wert !== 'boolean') return { ok: false, fehler: 'Der Schalter kennt nur an oder aus.' }
      werte.wert = body.wert
    }
  }
  if (body.wartezeitMinuten !== undefined) {
    const max = ziel.art === 'fest' && ziel.def.art === 'an_aus' ? ziel.def.wartezeitMax ?? 0 : REGEL_WARTEZEIT_MAX
    const w = ganzzahl(body.wartezeitMinuten, max)
    if (w === null) return { ok: false, fehler: `Die Wartezeit muss eine ganze Zahl von 0 bis ${max} Minuten sein.` }
    werte.wartezeitMinuten = w
  }
  if (body.uhrzeit !== undefined) {
    const u = pruefeUhrzeit(body.uhrzeit)
    if (!u) return { ok: false, fehler: 'Die Uhrzeit muss zwischen 12:00 und 22:00 liegen (Form 17:30).' }
    werte.uhrzeit = u
  }
  if (body.empfaenger !== undefined) {
    const e = pruefeEmpfaenger(body.empfaenger)
    if (!e) return { ok: false, fehler: `Empfänger: höchstens ${EMPFAENGER_MAX} E-Mail-Adressen, „superuser“ oder „*“ (alle).` }
    werte.empfaenger = e
  }
  if (body.tage !== undefined) {
    const t = ganzzahl(body.tage, WV_TAGE_MAX)
    if (t === null) return { ok: false, fehler: `Die Tage müssen eine ganze Zahl von 0 bis ${WV_TAGE_MAX} sein.` }
    werte.tage = t
  }
  if (body.titel !== undefined) {
    const t = typeof body.titel === 'string' ? body.titel.replace(/\s+/g, ' ').trim() : ''
    if (!t || t.length > WV_TITEL_MAX) return { ok: false, fehler: `Der Titel darf nicht leer und höchstens ${WV_TITEL_MAX} Zeichen lang sein.` }
    werte.titel = t
  }
  return { ok: true, ziel, werte }
}

/** Spalten für die Änderung einer Tabellenzeile (nicht für die Empfänger-Schalter). */
export function spaltenFuer(ziel: Ziel, werte: Werte, von: string, jetztIso: string): Record<string, unknown> {
  const f: Record<string, unknown> = {}
  if (ziel.art === 'regel') {
    if (werte.wert !== undefined) f.aktiv = werte.wert
    if (werte.wartezeitMinuten !== undefined) f.wartezeit_minuten = werte.wartezeitMinuten
    return { ...f, geaendert_von: von, geaendert_am: jetztIso }
  }
  if (ziel.art === 'wv') {
    // wiedervorlage_regeln hat keine Spalten für Name/Zeitpunkt der Änderung.
    if (werte.wert !== undefined) f.aktiv = werte.wert
    if (werte.tage !== undefined) f.tage = werte.tage
    if (werte.titel !== undefined) f.titel = werte.titel
    return f
  }
  const def = ziel.def
  if (def.art === 'empfaenger') throw new Error('Empfänger-Schalter liegen in telegram_vorschlaege.daten')
  if (werte.wert !== undefined) f[def.spalte] = werte.wert
  if (def.art === 'an_aus' && def.wartezeitSpalte && werte.wartezeitMinuten !== undefined) f[def.wartezeitSpalte] = werte.wartezeitMinuten
  if (def.art === 'stufe' && def.uhrzeitSpalte && werte.uhrzeit !== undefined) f[def.uhrzeitSpalte] = werte.uhrzeit
  return { ...f, geaendert_von: von, geaendert_am: jetztIso }
}

/** Neue daten der Zeile telegram_vorschlaege 'einstellung' (alles andere darin bleibt). */
export function vorschlagDatenNeu(alt: unknown, spalte: 'zuordnung_an' | 'status_an', werte: Werte, von: string, jetztIso: string): Record<string, unknown> {
  const basis = alt && typeof alt === 'object' && !Array.isArray(alt) ? { ...(alt as Record<string, unknown>) } : {}
  // Fehlte die Empfängerliste, gilt die Vorgabe aus leseEinstellung — die wird festgeschrieben, damit sie sichtbar bleibt.
  if (!Array.isArray(basis.empfaenger)) basis.empfaenger = leseEinstellung(alt).empfaenger
  if (werte.wert !== undefined) basis[spalte] = werte.wert === true
  if (werte.empfaenger !== undefined) basis.empfaenger = werte.empfaenger
  return { ...basis, geaendert_von: von, geaendert_am: jetztIso }
}

// ---------------------------------------------------------------------------------------------
// Verlauf: Katalog-Kennung für Module, die mehrere Arten Telegram-Nachrichten über dieselbe Sendefunktion schicken.
// Unterschieden am festen Anfang des Texts (siehe die jeweiligen Module).

export type TelegramGruppe = 'tagesmeldung' | 'tagesplan' | 'anfragen' | 'briefing'

export function telegramArtNachText(gruppe: TelegramGruppe, nachricht: string): string {
  const t = String(nachricht ?? '')
  switch (gruppe) {
    case 'tagesmeldung':
      return t.startsWith('Wochenbericht') ? 'wochenbericht_gf' : 'morgen_uebersicht' // tagesmeldung.ts wochenText
    case 'tagesplan':
      return t.startsWith('☀️ Dein Tag') ? 'tagesplan_morgen' : 'tagesplan_abend' // _shared/tagesplanKern.ts morgenText
    case 'anfragen':
      return t.startsWith('Mögliche Anfrage') ? 'anfrage_unklar' : 'anfrage_neu' // anfragenManager.ts
    case 'briefing':
      // terminBriefing.ts: Briefing „📋 Briefing zum Termin…“, Erinnerung zum Beginn „🎙️ Dein Termin…“, sonst Morgenübersicht.
      return t.startsWith('🎙️ Dein Termin') ? 'aufnahme_erinnerung' : t.startsWith('📋 Briefing') ? 'termin_briefing' : 'termin_briefing_morgen'
  }
}

// ---------------------------------------------------------------------------------------------
// Datenbank

export type Ergebnis = { status: number; daten: unknown }

async function darf(req: Request, admin: Db, body: Record<string, unknown>): Promise<{ name: string; email: string } | Ergebnis> {
  const aufrufer = await ermittleAufrufer(req, admin, body)
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  if (aufrufer.istGf) return { name: aufrufer.name || aufrufer.email, email: aufrufer.email }
  const muster = aufrufer.email.replace(/[\\%_]/g, (z) => `\\${z}`)
  const { data } = await admin.from('mitarbeiter').select('ist_superuser, aktiv').ilike('email', muster).maybeSingle()
  if (data?.aktiv && data?.ist_superuser) return { name: aufrufer.name || aufrufer.email, email: aufrufer.email }
  return { status: 403, daten: { error: 'Nur für Geschäftsführung und Superuser.' } }
}

function istErgebnis(x: unknown): x is Ergebnis {
  return !!x && typeof x === 'object' && 'status' in x && 'daten' in x
}

async function eineZeile(admin: Db, tabelle: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from(tabelle).select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(`${tabelle}: ${error.message}`)
  return data ?? null
}

async function vorschlagDaten(admin: Db): Promise<{ da: boolean; daten: unknown }> {
  const { data, error } = await admin.from(VORSCHLAG_TABELLE).select('daten').eq('id', EINSTELLUNG_ID).maybeSingle()
  if (error) throw new Error(`${VORSCHLAG_TABELLE}: ${error.message}`)
  return { da: !!data, daten: data?.daten ?? null }
}

async function ladeZeilen(admin: Db): Promise<StandZeilen> {
  const [w, u, k, m, a, v] = await Promise.all([
    eineZeile(admin, 'willkommen_einstellung'),
    eineZeile(admin, 'unterschrift_einstellung'),
    eineZeile(admin, 'kundenbericht_schalter'),
    eineZeile(admin, 'mahn_einstellung'),
    eineZeile(admin, 'assistent_hinweis_einstellung'),
    vorschlagDaten(admin),
  ])
  return { willkommen_einstellung: w, unterschrift_einstellung: u, kundenbericht_schalter: k, mahn_einstellung: m, assistent_hinweis_einstellung: a, vorschlagDaten: v.daten }
}

export async function automatikStand(req: Request, admin: Db, body: Record<string, unknown>): Promise<Ergebnis> {
  const wer = await darf(req, admin, body)
  if (istErgebnis(wer)) return wer
  try {
    const [zeilen, regeln, wv] = await Promise.all([
      ladeZeilen(admin),
      admin.from('auto_nachricht_regeln').select('id, bereich, titel, aktiv, wartezeit_minuten, an_wen, vorlage_id, reihenfolge').order('reihenfolge', { ascending: true }).order('id', { ascending: true }),
      admin.from('wiedervorlage_regeln').select('id, bereich, ausloeser, titel, tage, schliesst, aktiv, sortierung').order('bereich', { ascending: true }).order('sortierung', { ascending: true }).order('id', { ascending: true }),
    ])
    if (regeln.error) throw new Error(`auto_nachricht_regeln: ${regeln.error.message}`)
    if (wv.error) throw new Error(`wiedervorlage_regeln: ${wv.error.message}`)
    return {
      status: 200,
      daten: {
        schalter: alleSchalter(zeilen),
        regeln: ((regeln.data ?? []) as Record<string, unknown>[]).map(regelAusZeile),
        wvRegeln: ((wv.data ?? []) as Record<string, unknown>[]).map(wvAusZeile),
      },
    }
  } catch (err) {
    console.error('automatik_stand:', err)
    return { status: 500, daten: { error: `Stand der automatischen Nachrichten nicht lesbar: ${err instanceof Error ? err.message : String(err)}` } }
  }
}

export async function automatikSchalter(req: Request, admin: Db, body: Record<string, unknown>, jetzt = new Date()): Promise<Ergebnis> {
  const wer = await darf(req, admin, body)
  if (istErgebnis(wer)) return wer
  const p = pruefeSchalterEingabe(body)
  if (!p.ok) return { status: 400, daten: { error: p.fehler } }
  const { ziel, werte } = p
  const jetztIso = jetzt.toISOString()
  try {
    if (ziel.art === 'regel') {
      if (werte.wartezeitMinuten !== undefined) {
        const { data: alt, error } = await admin.from('auto_nachricht_regeln').select('wartezeit_minuten').eq('id', ziel.regelId).maybeSingle()
        if (error) throw new Error(error.message)
        if (!alt) return { status: 404, daten: { error: 'Diese Regel gibt es nicht.' } }
        // Ohne Wartezeit = fester Zeitpunkt (z. B. am Vortag um 9 Uhr) — der lässt sich hier nicht in Minuten ändern.
        if (alt.wartezeit_minuten === null) return { status: 400, daten: { error: 'Diese Nachricht geht zu einem festen Zeitpunkt hinaus; die Wartezeit ist nicht änderbar.' } }
      }
      const { data, error } = await admin.from('auto_nachricht_regeln').update(spaltenFuer(ziel, werte, wer.name, jetztIso)).eq('id', ziel.regelId).select('aktiv, wartezeit_minuten, geaendert_von, geaendert_am')
      if (error) throw new Error(error.message)
      if (!Array.isArray(data) || data.length === 0) return { status: 404, daten: { error: 'Diese Regel gibt es nicht.' } }
      return { status: 200, daten: { ok: true, stand: regelStand(data[0]) } }
    }
    if (ziel.art === 'wv') {
      const { data, error } = await admin.from('wiedervorlage_regeln').update(spaltenFuer(ziel, werte, wer.name, jetztIso)).eq('id', ziel.regelId).select('aktiv, tage, titel')
      if (error) throw new Error(error.message)
      if (!Array.isArray(data) || data.length === 0) return { status: 404, daten: { error: 'Diese Wiedervorlage-Regel gibt es nicht.' } }
      return { status: 200, daten: { ok: true, stand: wvStand(data[0]) } }
    }
    const def = ziel.def
    if (def.art === 'empfaenger') {
      const alt = await vorschlagDaten(admin)
      const daten = vorschlagDatenNeu(alt.daten, def.spalte, werte, wer.name, jetztIso)
      const { error } = alt.da
        ? await admin.from(VORSCHLAG_TABELLE).update({ daten }).eq('id', EINSTELLUNG_ID)
        : await admin.from(VORSCHLAG_TABELLE).insert({ id: EINSTELLUNG_ID, empfaenger_email: '-', art: 'lauf', bezug_id: '-', code: '-', status: 'erledigt', daten })
      if (error) throw new Error(error.message)
    } else {
      const spalten = spaltenFuer(ziel, werte, wer.name, jetztIso)
      const { data, error } = await admin.from(def.tabelle).update(spalten).eq('id', 1).select('id')
      if (error) throw new Error(error.message)
      if (!Array.isArray(data) || data.length === 0) {
        const { error: neuFehler } = await admin.from(def.tabelle).insert({ id: 1, ...spalten })
        if (neuFehler) throw new Error(neuFehler.message)
      }
    }
    const stand = standAusZeilen(ziel.id, await ladeZeilen(admin))
    return { status: 200, daten: { ok: true, stand } }
  } catch (err) {
    console.error('automatik_schalter:', body.id, err)
    return { status: 500, daten: { error: `Schalter nicht gespeichert: ${err instanceof Error ? err.message : String(err)}` } }
  }
}
