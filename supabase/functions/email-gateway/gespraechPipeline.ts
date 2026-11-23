// Gesprächs-App „Mayer Gespräch“ — Server-Seite (Aufnahme, Abschrift, Sprecher, Auswertung, Löschfrist).
//
// Ablauf:
// 1. gespraech_anlegen legt eine Zeile in gespraech_aufnahmen an (Besitzer = angemeldeter Mitarbeiter).
// 2. Die App nimmt in Abschnitten auf. Je Abschnitt holt sie mit gespraech_upload_url eine signierte
//    Upload-Adresse (privater Speicher „gespraech-aufnahmen“, Pfad <email>/<id>/seg_<nr>.<ext>), lädt hoch
//    und meldet gespraech_segment_fertig. Daraufhin wird genau dieser Abschnitt im Hintergrund abgeschrieben
//    (Groq whisper-large-v3-turbo, Sprache Deutsch, Namen aus Akte und Team als Schreibhilfe).
// 3. gespraech_abschliessen: Sobald alle Abschnitte abgeschrieben sind, wird die Abschrift in Reihenfolge
//    zusammengesetzt, Sonnet 5.5 ordnet die Sätze Sprechern zu (in Fenstern zu je FENSTER_SAETZE Sätzen) und
//    füllt danach das Auswertungs-Schema (_shared/gespraechSchema.ts) — nur aus dem Gesagten, samt Entwurf
//    einer Nachfass-Mail. Danach Status „fertig“ und eine Telegram-Nachricht an den Besitzer mit Link in die App.
// 4. Audio wird nach aufbewahren_bis gelöscht (Standard 30 Tage, je Aufnahme einstellbar); Abschrift und
//    Auswertung bleiben.
//
// Zeitgrenze der Plattform (siehe Kommentar zu WORKER_LEBENSDAUER_MS in index.ts): Jede Arbeit läuft in
// kurzen Schritten mit Sperren in der Datenbank — je Abschnitt (segmente[].seit) und je Zeile
// (bearbeitung.seit). Eine Sperre gilt SPERRE_MS; danach darf ein anderer Lauf übernehmen. Reicht die Zeit eines
// Laufs nicht, stößt er sich als neue Anfrage selbst an (gespraech_weiter, nur Dienst-Schlüssel). Der Minutentakt
// (gespraechMinutentakt) holt hängende Arbeit nach. Jede Änderung an der Zeile geht über `aendere` (Vergleich auf
// die Spalte `stand`), damit nichts doppelt läuft und Listen nicht überschrieben werden.
//
// Rechte: Schreiben darf nur der Besitzer. Lesen (gespraech_stand/gespraech_liste/Fotos) darf zusätzlich, wer die
// verknüpfte Akte sehen darf — Audio aber nur der Besitzer. Die Übernahme in die Akte (gespraech_uebernehmen)
// liegt in gespraechUebernehmen.ts.
//
// Runde 5 (22.11.2026):
// - Sprachen: Jede Aufnahme hat eine Sprache (Spalte sprache: deutsch | automatisch | tuerkisch | englisch …, siehe
//   SPRACHEN in _shared/gespraechSchema.ts). Bei „automatisch“ bestimmt die Spracherkennung die Sprache selbst; die
//   erkannte Sprache steht je Abschnitt (segmente[].sprache) und als Hauptsprache in sprache_erkannt. Auswertung,
//   Protokoll und Mail-Entwurf sind immer Deutsch. gespraech_uebersetzen liefert auf Anforderung die deutsche
//   Fassung der Abschrift (in Teilen, zwischengespeichert in uebersetzung) bzw. Mail-Entwurf/Gesprächsnotiz in der
//   Sprache des Kunden. gespraech_neu_auswerten {sprache} schreibt mit einer anderen Sprache neu ab.
// - Fragebogen: Hat der Bereich der Akte eine Fragebogen-Vorlage (vorlagen.typ 'Fragebogen'), füllt die Auswertung
//   zusätzlich `fragebogen` (nur Gesagtes) und `aktenfelder` (Sachverhalt, Branche, Dienstleistungen) als Vorschläge.
// - Teilen: gespraech_teilen schickt Zusammenfassung + Link per Telegram an Kollegen, die die Akte sehen dürfen
//   ({pruefen:true} nennt die möglichen Empfänger). gespraech_kundennotiz_vermerken trägt eine über den normalen
//   Versand (Aktion send) verschickte Gesprächsnotiz in den Verlauf der Akte und in geteilt ein.

import { kiAufruf, setzeAnlass, setzePerson, setzePrivat } from '../_shared/kiVerbrauch.ts'
import { type Abschrift, AbschriftFehler, schreibeAb, TRANSKRIPTION_MAX_BYTES } from '../_shared/transkription.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'
import {
  GESPRAECH_ARTEN,
  type GespraechAbsatz,
  type GespraechAnalyse,
  type GespraechArt,
  type GespraechFoto,
  type GespraechMarker,
  type GespraechSegment,
  type GespraechGeteilt,
  type GespraechUebersetzung,
  fragenAusVorlage,
  hauptsprache,
  leereAnalyse,
  normalisiereAnalyse,
  normalisiereSprachwahl,
  ordneFragebogenZu,
  spracheAusErkennung,
  sprachName,
  type SprecherRolle,
  whisperSprache,
} from '../_shared/gespraechSchema.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export const GESPRAECH_TABELLE = 'gespraech_aufnahmen'
export const GESPRAECH_BUCKET = 'gespraech-aufnahmen'
export const GESPRAECH_APP_LINK = 'https://eray-hash.github.io/mayer-holding-crm/gespraech/#/aufnahme/'

/** So lange gilt eine Sperre (Abschnitt oder Zeile); entspricht SCHRITT_HOECHSTENS_MS in index.ts. */
export const SPERRE_MS = 150_000
export const SEGMENT_MAX_VERSUCHE = 4
export const SCHRITT_MAX_VERSUCHE = 3
/** Nach einem Fehlschlag frühestens so spät erneut versuchen (Mengengrenze des Abschrift-Dienstes: 20 je Minute). */
export const WIEDERHOLEN_NACH_MS = 60_000
/**
 * Mengengrenze des Abschrift-Dienstes (Antwort 429): Groq begrenzt auch die Tonsekunden je Stunde und Tag (kostenloser
 * Schlüssel: 2 Stunden Ton je Stunde, geteilt mit den Sprachnachrichten). Mit vier Versuchen im Minutenabstand wäre
 * bei einem langen Gespräch der Rest endgültig „fehler“ — darum zählt eine 429 nicht als Versuch, sondern wartet so
 * lange, wie der Dienst sagt (sonst 5 Minuten, höchstens 30), höchstens MENGENGRENZE_MAX_WARTEN-mal je Abschnitt.
 */
export const MENGENGRENZE_MAX_WARTEN = 12
const MENGENGRENZE_STANDARD_MS = 5 * 60_000
const MENGENGRENZE_HOECHSTENS_MS = 30 * 60_000

/** Wartezeit aus der Meldung des Dienstes („Please try again in 1m5.5s“), begrenzt auf 1–30 Minuten. */
export function wartezeitMengengrenze(meldung: string): number {
  const m = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i.exec(meldung)
  const ms = m && (m[1] || m[2] || m[3]) ? ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 + 5_000 : MENGENGRENZE_STANDARD_MS
  return Math.max(60_000, Math.min(MENGENGRENZE_HOECHSTENS_MS, Math.round(ms)))
}

/** Hat der Abschrift-Dienst diesen Abschnitt auf später vertröstet (Mengengrenze)? */
function vertroestet(s: GespraechSegment, jetzt: number): boolean {
  const t = typeof s.naechster_versuch === 'string' ? Date.parse(s.naechster_versuch) : NaN
  return Number.isFinite(t) && t > jetzt
}
/** Nach dem Abschließen höchstens so lange auf fehlende Abschnitte warten, dann ohne sie auswerten. */
export const WARTEN_AUF_TEILE_MS = 3 * 3600_000
/** Sätze je Aufruf der Sprecher-Zuordnung. */
export const FENSTER_SAETZE = 350
export const STANDARD_AUFBEWAHREN_TAGE = 30
const SEITE = 30
const MODELL = 'claude-sonnet-5-5'

const AUDIO_ENDUNG: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
}
const BILD_ENDUNG: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }

// ---------- Hilfen von außen (Tests setzen eigene ein) ----------

export type GespraechAufrufer = { email: string; name: string; istGf?: boolean }

export type KiWerkzeug = { name: string; description: string; input_schema: Record<string, unknown> }
/** Ein KI-Aufruf mit genau einem Werkzeug; gibt dessen Eingabe zurück oder wirft. */
export type KiFunktion = (a: { system: string; prompt: string; werkzeug: KiWerkzeug; maxTokens: number; timeoutMs: number }) => Promise<Record<string, unknown>>

export type GespraechHilfen = {
  /** Aufruf mit dem Dienst-Schlüssel ohne imAuftragVon (eigene Fortsetzung, Zeitplan). */
  dienst?: boolean
  darfKunde?: (kundeId: string) => Promise<boolean>
  darfObjekt?: (objektId: string) => Promise<boolean>
  /** Arbeit nach der Antwort weiterlaufen lassen (EdgeRuntime.waitUntil). */
  imHintergrund?: (arbeit: Promise<unknown>) => void
  /** Garantierte Restlaufzeit dieses Workers in ms. */
  restMs?: () => number
  /** Warten, bis dieser Worker keine neuen Anfragen mehr annimmt (dann landet die Fortsetzung auf einem frischen). */
  warteAufNeuenWorker?: () => Promise<void>
  /** Fortsetzung als neue Anfrage anstoßen (gespraech_weiter). */
  stosseAn?: (id: string) => Promise<void>
  /** `sprache`: Kürzel für die Spracherkennung, null = automatisch erkennen (undefined = Vorgabe des Dienstes). Die
   *  Antwort darf die erkannte Sprache mitliefern (`sprache`). */
  schreibeAb?: (bytes: Uint8Array, dateiname: string, mime: string, hinweis: string, timeoutMs: number, sprache?: string | null) => Promise<Abschrift & { sprache?: string }>
  ki?: KiFunktion
  /** Teilen mit Kollegen: darf diese Person (E-Mail) die Akte bzw. das Objekt sehen? Fehlt es, ist Teilen aus. */
  darfKundeFuer?: (email: string, kundeId: string) => Promise<boolean>
  darfObjektFuer?: (email: string, objektId: string) => Promise<boolean>
  sendeTelegram?: (chat: number | string | null, text: string) => Promise<boolean>
  sendePrivat?: (chat: number | string | null, text: string) => Promise<boolean>
  privatBotAktiv?: (email: string) => Promise<boolean>
  jetzt?: () => number
}

type Optional = 'dienst' | 'darfKunde' | 'darfObjekt' | 'darfKundeFuer' | 'darfObjektFuer'
type H = Required<Omit<GespraechHilfen, Optional>> & Pick<GespraechHilfen, Optional>

function mitStandard(admin: Db, h: GespraechHilfen): H {
  return {
    ...h,
    imHintergrund: h.imHintergrund ?? ((p) => void p.catch((e) => console.error('Gespräch: Hintergrundarbeit fehlgeschlagen:', e))),
    restMs: h.restMs ?? (() => 130_000),
    warteAufNeuenWorker: h.warteAufNeuenWorker ?? (() => Promise.resolve()),
    stosseAn: h.stosseAn ?? stosseGespraechAn,
    schreibeAb: h.schreibeAb ?? schreibeAb,
    ki: h.ki ?? sonnetWerkzeug,
    sendeTelegram: h.sendeTelegram ?? (async () => false),
    sendePrivat: h.sendePrivat ?? (async (chat, text) => !!(await sendePrivat(chat, text))),
    privatBotAktiv: h.privatBotAktiv ?? ((email) => privatBotAktiv(admin, email)),
    jetzt: h.jetzt ?? (() => Date.now()),
  }
}

/** Fortsetzung als eigene Anfrage an email-gateway (Dienst-Schlüssel, ohne imAuftragVon). */
export async function stosseGespraechAn(id: string): Promise<void> {
  const secret = Deno.env.get('CRM_SHARED_SECRET')
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/email-gateway`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, ...(secret ? { 'x-crm-secret': secret } : {}) },
    body: JSON.stringify({ action: 'gespraech_weiter', id }),
  }).catch((err) => console.error('Gespräch: Fortsetzung konnte nicht angestoßen werden:', err))
}

/** Sonnet 5.5 mit einem Werkzeug. Sonnet lehnt ein erzwungenes Werkzeug ab → tool_choice auto + Anweisung im Text.
 *  Ohne Nachdenken vor der Antwort (sonst frisst es max_tokens, siehe Gedächtnis zur Zeitgrenze). */
async function sonnetWerkzeug(a: { system: string; prompt: string; werkzeug: KiWerkzeug; maxTokens: number; timeoutMs: number }): Promise<Record<string, unknown>> {
  const schluessel = Deno.env.get('ANTHROPIC_API_KEY')
  if (!schluessel) throw new Error('Die KI ist nicht eingerichtet (kein Schlüssel hinterlegt).')
  const res = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(a.timeoutMs),
    body: JSON.stringify({
      model: MODELL,
      max_tokens: a.maxTokens,
      thinking: { type: 'between_tools' },
      system: a.system,
      tools: [a.werkzeug],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: a.prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Der KI-Dienst antwortet mit ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  const t = (data.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === a.werkzeug.name)
  if (!t) throw new Error(data.stop_reason === 'max_tokens' ? 'Die Antwort der KI war zu lang.' : 'Die KI hat keine verwertbare Antwort geliefert.')
  return t.input as Record<string, unknown>
}

// ---------- Kleine Hilfen ----------

function txt(x: unknown, max = 500): string {
  return typeof x === 'string' ? x.trim().slice(0, max) : typeof x === 'number' && Number.isFinite(x) ? String(x) : ''
}

function zahl(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function heuteBerlin(ms: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(ms))
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

function mmss(sek: number): string {
  const s = Math.max(0, Math.round(sek))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

function frisch(seit: unknown, jetzt: number): boolean {
  const t = typeof seit === 'string' ? Date.parse(seit) : NaN
  return Number.isFinite(t) && jetzt - t < SPERRE_MS
}

function segmenteVon(z: Zeile): GespraechSegment[] {
  return (Array.isArray(z.segmente) ? z.segmente : []).filter((s: unknown) => s && typeof s === 'object') as GespraechSegment[]
}

function ersetzeSegment(liste: GespraechSegment[], seg: GespraechSegment): GespraechSegment[] {
  const neu = liste.filter((s) => s.nr !== seg.nr)
  neu.push(seg)
  return neu.sort((a, b) => a.nr - b.nr)
}

type Antwort = { status: number; daten: unknown }
const ok = (daten: unknown): Antwort => ({ status: 200, daten })
const fehler = (status: number, error: string): Antwort => ({ status, daten: { error } })

/**
 * Ändert eine Zeile mit Vergleich auf `stand`: liest frisch, `f` berechnet die Änderung (null = nichts tun),
 * schreibt nur, wenn niemand dazwischen geschrieben hat — sonst von vorn. Gibt die neue Zeile zurück (null,
 * wenn es die Zeile nicht gibt oder `f` abbricht).
 */
export async function aendere(admin: Db, id: string, f: (z: Zeile) => Zeile | null, jetzt = Date.now()): Promise<Zeile | null> {
  for (let versuch = 0; versuch < 6; versuch++) {
    const { data: z, error } = await admin.from(GESPRAECH_TABELLE).select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`Aufnahme nicht lesbar: ${error.message}`)
    if (!z) return null
    const aenderung = f(z)
    if (!aenderung) return null
    const stand = Number(z.stand ?? 0)
    const { data, error: e2 } = await admin
      .from(GESPRAECH_TABELLE)
      .update({ ...aenderung, stand: stand + 1, geaendert_am: new Date(jetzt).toISOString() })
      .eq('id', id)
      .eq('stand', stand)
      .select('*')
    if (e2) throw new Error(`Aufnahme nicht gespeichert: ${e2.message}`)
    if (Array.isArray(data) && data.length === 1) return data[0]
  }
  throw new Error('Die Aufnahme wird gerade an anderer Stelle geändert — bitte gleich noch einmal versuchen.')
}

// ---------- Akte, Team, Namen ----------

type Kontext = {
  besitzerName: string
  besitzerChat: number | string | null
  team: string[]
  kunde: Zeile | null
  objekt: Zeile | null
  terminTitel: string
  akteName: string
  privat: boolean
}

async function ladeKontext(admin: Db, z: Zeile): Promise<Kontext> {
  const [team, kunde, objekt, termin]: [Zeile[], Zeile | null, Zeile | null, Zeile | null] = await Promise.all([
    admin.from('mitarbeiter').select('name, email, telegram_chat_id, aktiv').eq('aktiv', true).then((r: Zeile) => (r.data ?? []) as Zeile[]),
    z.kunde_id ? admin.from('kunden').select('id, bereich, firma, ansprechpartner, email, telefon, anschrift, sachverhalt, branche, dienstleistungen').eq('id', z.kunde_id).maybeSingle().then((r: Zeile) => r.data ?? null) : null,
    z.objekt_id ? admin.from('objekte').select('id, bezeichnung, privat_besitzer').eq('id', z.objekt_id).maybeSingle().then((r: Zeile) => r.data ?? null) : null,
    z.termin_id ? admin.from('termine').select('id, titel').eq('id', z.termin_id).maybeSingle().then((r: Zeile) => r.data ?? null) : null,
  ])
  const ich = team.find((m) => String(m.email ?? '').toLowerCase() === String(z.mitarbeiter_email).toLowerCase())
  const firma = txt(kunde?.firma, 200)
  const ansprech = txt(kunde?.ansprechpartner, 200)
  const akteName = kunde ? (ansprech && firma && !firma.toLowerCase().includes(ansprech.toLowerCase()) ? `${ansprech} (${firma})` : firma || ansprech) : txt(objekt?.bezeichnung, 200)
  return {
    besitzerName: txt(ich?.name, 120) || String(z.mitarbeiter_email),
    besitzerChat: ich?.telegram_chat_id ?? null,
    team: team.map((m) => txt(m.name, 120)).filter(Boolean),
    kunde,
    objekt,
    terminTitel: txt(termin?.titel, 200),
    akteName,
    // Wie die Regel für private Termine in kalender.ts: ohne Mayer-Akte oder mit privater Akte → privat.
    privat: (!z.kunde_id && !z.objekt_id) || z.kunde_bereich === 'privat' || !!objekt?.privat_besitzer,
  }
}

/** Schreibhilfe für die Spracherkennung: Namen aus Akte und Team, danach das Ende des vorigen Abschnitts. Ist die
 *  Sprache nicht Deutsch (oder automatisch), ohne deutschen Satz — der würde die Erkennung Richtung Deutsch ziehen. */
export function abschriftHinweis(k: Pick<Kontext, 'besitzerName' | 'team' | 'kunde' | 'objekt'>, vorher: string, deutsch = true): string {
  const namen = [...new Set([txt(k.kunde?.ansprechpartner, 120), txt(k.kunde?.firma, 120), txt(k.objekt?.bezeichnung, 120), k.besitzerName, ...k.team].filter(Boolean))]
  let kopf = namen.length ? (deutsch ? `Gespräch der Mayer Holding. Namen: ${namen.join(', ')}.` : `${namen.join(', ')}.`) : ''
  if (kopf.length > 300) kopf = kopf.slice(0, 299).replace(/,[^,]*$/, '') + '.'
  const ende = vorher.trim().slice(-280)
  return [kopf, ende].filter(Boolean).join(' ')
}

// ---------- Abschrift zusammensetzen ----------

export type Einheit = { sek: number; text: string }

/** Ist ein Abschnitt endgültig ohne Abschrift (Fehler oder Versuche aufgebraucht, keine laufende Sperre)? */
function segmentGescheitert(s: GespraechSegment, jetzt: number): boolean {
  return s.status === 'fehler' || (s.status === 'hochgeladen' && (s.versuche ?? 0) >= SEGMENT_MAX_VERSUCHE && !frisch(s.seit, jetzt))
}

/**
 * Setzt die Abschnitte in Reihenfolge (nr) zu Sätzen mit ungefährer Startsekunde zusammen. Ein Satz, der über
 * die Grenze zweier Abschnitte geht, bleibt ein Satz. Abschnitte ohne Abschrift werden als Lücke gemeldet.
 */
export function zerlegeInSaetze(segmente: GespraechSegment[]): { saetze: Einheit[]; luecken: number[]; text: string } {
  const saetze: Einheit[] = []
  const luecken: number[] = []
  const texte: string[] = []
  let versatz = 0
  let puffer = ''
  let pufferSek = 0
  const raus = () => {
    if (puffer.trim()) saetze.push({ sek: Math.round(pufferSek), text: puffer.trim() })
    puffer = ''
  }
  for (const s of [...segmente].sort((a, b) => a.nr - b.nr)) {
    const dauer = zahl(s.dauer_s) ?? 0
    if (s.status !== 'transkribiert') {
      raus()
      luecken.push(s.nr)
      texte.push(`[Teil ${s.nr} konnte nicht abgeschrieben werden]`)
      versatz += dauer
      continue
    }
    const t = txt(s.text, 1_000_000)
    if (t) texte.push(t)
    const stuecke = Array.isArray(s.stuecke) && s.stuecke.length ? s.stuecke : t ? [{ ab: 0, text: t }] : []
    stuecke.forEach((st, i) => {
      const ab = zahl(st.ab) ?? 0
      const bis = zahl(stuecke[i + 1]?.ab) ?? Math.max(ab, dauer || ab)
      const teile = String(st.text ?? '').trim().split(/(?<=[.!?…])\s+/).filter(Boolean)
      const gesamt = teile.reduce((n, p) => n + p.length, 0) || 1
      let bisher = 0
      for (const teil of teile) {
        if (!puffer) pufferSek = versatz + ab + ((bis - ab) * bisher) / gesamt
        puffer = puffer ? `${puffer} ${teil}` : teil
        bisher += teil.length
        if (/[.!?…]["“”»]?$/.test(teil) || puffer.length > 400) raus()
      }
    })
    const letztes = zahl(stuecke[stuecke.length - 1]?.ab) ?? 0
    versatz += dauer || letztes + 5
  }
  raus()
  return { saetze, luecken, text: texte.join(' ').trim() }
}

// ---------- Was ist als Nächstes zu tun? ----------

export type Arbeit =
  | { art: 'transkribieren'; nrs: number[] }
  | { art: 'sprecher' }
  | { art: 'analyse' }
  | { art: 'aufgeben'; grund: string }
  | { art: 'warten' }
  | null

/** Reine Entscheidung (ohne Datenbank), was für eine Aufnahme gerade zu tun ist. */
export function naechsteArbeit(z: Zeile, jetzt: number): Arbeit {
  if (!['aufnahme', 'hochladen', 'transkription', 'analyse'].includes(z.status)) return null
  const segmente = segmenteVon(z)
  const offenZumAbschreiben = segmente.filter((s) => {
    if (s.status !== 'hochgeladen' || frisch(s.seit, jetzt) || (s.versuche ?? 0) >= SEGMENT_MAX_VERSUCHE || vertroestet(s, jetzt)) return false
    if ((s.versuche ?? 0) > 0 && s.letzter_versuch && jetzt - Date.parse(s.letzter_versuch) < WIEDERHOLEN_NACH_MS) return false
    return true
  })
  if (offenZumAbschreiben.length) return { art: 'transkribieren', nrs: offenZumAbschreiben.map((s) => s.nr) }
  // Vor dem Abschließen gibt es nur Abschriften zu tun.
  if (!z.abgeschlossen_am) return null
  const laeuft = segmente.some((s) => s.status === 'hochgeladen' && !segmentGescheitert(s, jetzt))
  if (laeuft) return { art: 'warten' }
  const fehlend = segmente.some((s) => s.status === 'offen')
  if (fehlend && jetzt - Date.parse(z.abgeschlossen_am) < WARTEN_AUF_TEILE_MS) return { art: 'warten' }
  const b = (z.bearbeitung ?? {}) as Bearbeitung
  if (frisch(b.seit, jetzt)) return { art: 'warten' }
  const schritt: 'sprecher' | 'analyse' = b.schritt === 'analyse' ? 'analyse' : 'sprecher'
  if ((b.versuche ?? 0) >= SCHRITT_MAX_VERSUCHE) return { art: 'aufgeben', grund: b.fehler || 'Abbruch bei der Auswertung' }
  if ((b.versuche ?? 0) > 0 && b.letzter_versuch && jetzt - Date.parse(b.letzter_versuch) < WIEDERHOLEN_NACH_MS) return { art: 'warten' }
  return { art: schritt }
}

type Bearbeitung = {
  schritt?: 'sprecher' | 'analyse' | 'fertig'
  seit?: string | null
  versuche?: number
  letzter_versuch?: string | null
  fehler?: string | null
  /** So viele Sätze sind den Sprechern schon zugeordnet. */
  saetze_bis?: number
  /** Kürzel je Satz (M, K, K2, S …). */
  labels?: string[]
  /** Kürzel → Person. */
  personen?: Record<string, { name?: string; rolle?: SprecherRolle }>
}

// ---------- Einen Abschnitt abschreiben ----------

/** Schreibt einen hochgeladenen Abschnitt ab (mit Sperre je Abschnitt). 'ok' = abgeschrieben, 'fehlschlag' = Versuch
 *  gezählt, 'nichts' = nicht dran (gesperrt, schon fertig) oder Datenbankfehler. Wirft nie. */
export async function transkribiereSegment(admin: Db, id: string, nr: number, hilfen: GespraechHilfen, timeoutMs = 100_000): Promise<'ok' | 'fehlschlag' | 'nichts'> {
  const h = mitStandard(admin, hilfen)
  const jetzt = h.jetzt()
  const stempel = new Date(jetzt).toISOString()
  let versuche = 0
  try {
    const z = await aendere(admin, id, (r) => {
      if (['verworfen', 'fertig'].includes(r.status)) return null
      const s = segmenteVon(r).find((x) => x.nr === nr)
      if (!s || s.status !== 'hochgeladen' || frisch(s.seit, jetzt) || (s.versuche ?? 0) >= SEGMENT_MAX_VERSUCHE || vertroestet(s, jetzt)) return null
      versuche = (s.versuche ?? 0) + 1
      return { segmente: ersetzeSegment(segmenteVon(r), { ...s, seit: stempel, versuche, letzter_versuch: stempel }) }
    }, jetzt)
    if (!z) return 'nichts'
    const seg = segmenteVon(z).find((x) => x.nr === nr)!
    try {
      if ((zahl(seg.bytes) ?? 0) > TRANSKRIPTION_MAX_BYTES) throw new AbschriftFehler('Der Abschnitt ist für die Abschrift zu groß (über 24 MB).', 413)
      const k = await ladeKontext(admin, z)
      const vorher = segmenteVon(z).filter((x) => x.nr < nr && x.status === 'transkribiert').pop()?.text ?? ''
      const { data: blob, error } = await admin.storage.from(GESPRAECH_BUCKET).download(seg.pfad)
      if (error || !blob) throw new Error('Der Abschnitt ist im Speicher nicht zu finden (Hochladen unvollständig?).')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (bytes.length === 0) throw new Error('Der Abschnitt ist leer.')
      // Sprache laut Einstellung der Aufnahme: Kürzel oder null (= automatisch erkennen lassen).
      const code = whisperSprache(z.sprache)
      const ab = await h.schreibeAb(bytes, seg.pfad.split('/').pop() || `seg_${nr}`, seg.mime, abschriftHinweis(k, vorher, code === 'de'), timeoutMs, code)
      const sprache = spracheAusErkennung(ab.sprache) ?? code ?? undefined
      await aendere(admin, id, (r) => {
        const s = segmenteVon(r).find((x) => x.nr === nr)
        if (!s || s.status !== 'hochgeladen') return null
        const dauer = zahl(s.dauer_s) ?? (ab.dauer ? Math.round(ab.dauer) : undefined)
        return { segmente: ersetzeSegment(segmenteVon(r), { ...s, status: 'transkribiert', text: ab.text, stuecke: ab.stuecke, ...(dauer !== undefined ? { dauer_s: dauer } : {}), ...(sprache ? { sprache } : {}), seit: null, fehler: null, naechster_versuch: null }) }
      }, h.jetzt())
      return 'ok'
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err)
      // Ohne Schlüssel oder zu groß hilft kein weiterer Versuch.
      const endgueltig = versuche >= SEGMENT_MAX_VERSUCHE || (err instanceof AbschriftFehler && (err.status === 0 || err.status === 413))
      const mengengrenze = err instanceof AbschriftFehler && err.status === 429
      console.error(`Gespräch ${id}: Abschnitt ${nr} nicht abgeschrieben (Versuch ${versuche}):`, meldung)
      await aendere(admin, id, (r) => {
        const s = segmenteVon(r).find((x) => x.nr === nr)
        if (!s || s.status !== 'hochgeladen') return null
        // Mengengrenze: kein Versuch verbraucht, später erneut (siehe MENGENGRENZE_MAX_WARTEN).
        if (mengengrenze && (s.mengengrenze ?? 0) < MENGENGRENZE_MAX_WARTEN) {
          return {
            segmente: ersetzeSegment(segmenteVon(r), {
              ...s,
              seit: null,
              fehler: meldung.slice(0, 300),
              versuche: Math.max(0, (s.versuche ?? 1) - 1),
              mengengrenze: (s.mengengrenze ?? 0) + 1,
              naechster_versuch: new Date(h.jetzt() + wartezeitMengengrenze(meldung)).toISOString(),
            }),
          }
        }
        return { segmente: ersetzeSegment(segmenteVon(r), { ...s, seit: null, fehler: meldung.slice(0, 300), status: endgueltig ? 'fehler' : 'hochgeladen' }) }
      }, h.jetzt())
      return 'fehlschlag'
    }
  } catch (err) {
    console.error(`Gespräch ${id}: Abschrift von Abschnitt ${nr} fehlgeschlagen:`, err)
    return 'nichts'
  }
}

// ---------- Sprecher-Zuordnung ----------

const SPRECHER_WERKZEUG: KiWerkzeug = {
  name: 'sprecher_zuordnen',
  description: 'Speichert, welcher Sprecher welche Sätze gesagt hat.',
  input_schema: {
    type: 'object',
    properties: {
      personen: {
        type: 'array',
        description: 'Je Kürzel die Person. Name nur, wenn er im Gespräch fällt oder aus den Angaben eindeutig ist.',
        items: {
          type: 'object',
          properties: { kuerzel: { type: 'string' }, name: { type: 'string' }, rolle: { type: 'string', enum: ['mitarbeiter', 'kunde', 'sonstige'] } },
          required: ['kuerzel'],
        },
      },
      wechsel: {
        type: 'array',
        description: 'Nur die Stellen, an denen der Sprecher wechselt, als „Satznummer Kürzel“, z. B. „12 M“, „15 K“. Die erste Nummer des Ausschnitts immer angeben.',
        items: { type: 'string' },
      },
    },
    required: ['wechsel'],
  },
}

const KUERZEL = /^(M|K|S)(\d{0,2})$/

function kuerzelLabel(k: string): { label: string; rolle: SprecherRolle } {
  const m = KUERZEL.exec(k) ?? ['', 'S', '']
  const zusatz = m[2] && m[2] !== '1' ? ` ${m[2]}` : ''
  if (m[1] === 'M') return { label: `Mitarbeiter${zusatz}`, rolle: 'mitarbeiter' }
  if (m[1] === 'K') return { label: `Kunde${zusatz}`, rolle: 'kunde' }
  return { label: `Weitere Person${zusatz}`, rolle: 'sonstige' }
}

/** Liest die Sprecherwechsel („12 M“, „15: K2“, {nr, kuerzel}) und füllt die Kürzel der Sätze von..bis-1. */
export function wendeWechselAn(wechsel: unknown, von: number, bis: number, vorher: string): string[] {
  const punkte = new Map<number, string>()
  for (const w of Array.isArray(wechsel) ? wechsel : []) {
    let nr: number | null = null
    let k = ''
    if (typeof w === 'string') {
      const m = /^\s*(\d+)\s*[:=.\-–]?\s*([MKS]\d{0,2})\b/i.exec(w)
      if (m) {
        nr = Number(m[1])
        k = m[2].toUpperCase()
      }
    } else if (w && typeof w === 'object') {
      // deno-lint-ignore no-explicit-any
      const o = w as any
      nr = zahl(o.nr ?? o.satz)
      k = String(o.kuerzel ?? o.sprecher ?? '').toUpperCase()
    }
    if (nr === null || !KUERZEL.test(k)) continue
    // Satznummern im Text beginnen bei 1.
    const i = nr - 1
    if (i >= von && i < bis) punkte.set(i, k)
  }
  const labels: string[] = []
  let aktuell = KUERZEL.test(vorher) ? vorher : 'M'
  for (let i = von; i < bis; i++) {
    if (punkte.has(i)) aktuell = punkte.get(i)!
    labels.push(aktuell)
  }
  return labels
}

/** Fügt Sätze mit gleichem Sprecher zu Absätzen zusammen. */
export function baueAbsaetze(saetze: Einheit[], labels: string[], personen: Bearbeitung['personen'], besitzerName: string): GespraechAbsatz[] {
  const aus: GespraechAbsatz[] = []
  saetze.forEach((s, i) => {
    const k = labels[i] ?? 'M'
    const { label, rolle } = kuerzelLabel(k)
    const name = personen?.[k]?.name || (k === 'M' ? besitzerName : '')
    const letzter = aus[aus.length - 1]
    if (letzter && letzter.label === label) {
      letzter.text = `${letzter.text} ${s.text}`
      return
    }
    aus.push({ label, ...(name ? { name } : {}), rolle, sek: s.sek, text: s.text })
  })
  return aus
}

/** Hauptsprache der Abschrift (Kürzel) — aus den abgeschriebenen Abschnitten, sonst aus der Einstellung. */
export function erkannteSprache(z: Zeile): string | null {
  return hauptsprache(segmenteVon(z).filter((s) => s.status === 'transkribiert'), whisperSprache(z.sprache))
}

/** Deutscher Name der Hauptsprache, wenn sie nicht Deutsch ist (sonst leer). */
function sprachHinweis(z: Zeile): string {
  const c = erkannteSprache(z)
  return c && c !== 'de' ? sprachName(c) : ''
}

function artText(art: GespraechArt): string {
  return art === 'telefon' ? 'ein Telefonat (über Lautsprecher aufgenommen)' : art === 'notiz' ? 'eine gesprochene Notiz des Mitarbeiters' : 'ein Gespräch vor Ort'
}

function akteZeilen(k: Kontext): string {
  const z: string[] = []
  if (k.kunde) {
    z.push(`Akte: ${txt(k.kunde.firma, 200) || '(ohne Namen)'}${k.kunde.ansprechpartner ? `, Ansprechpartner: ${txt(k.kunde.ansprechpartner, 200)}` : ''}`)
    for (const [feld, wert] of [['Telefon', k.kunde.telefon], ['E-Mail', k.kunde.email], ['Anschrift', k.kunde.anschrift]]) if (txt(wert)) z.push(`${feld} laut Akte: ${txt(wert, 200)}`)
  }
  if (k.objekt) z.push(`Objekt: ${txt(k.objekt.bezeichnung, 200)}`)
  if (k.terminTitel) z.push(`Termin: ${k.terminTitel}`)
  return z.join('\n')
}

async function sprecherSchritt(admin: Db, z: Zeile, h: H, timeoutMs: number): Promise<void> {
  const k = await ladeKontext(admin, z)
  const { saetze } = zerlegeInSaetze(segmenteVon(z))
  const b = (z.bearbeitung ?? {}) as Bearbeitung
  const von = Math.max(0, Math.min(b.saetze_bis ?? 0, saetze.length))
  const bis = Math.min(saetze.length, von + FENSTER_SAETZE)
  let labels = [...(b.labels ?? [])].slice(0, von)
  const personen: NonNullable<Bearbeitung['personen']> = { ...(b.personen ?? {}) }
  if (z.art === 'notiz' || saetze.length === 0) {
    // Gesprochene Notiz: nur der Mitarbeiter spricht — keine KI nötig.
    labels = saetze.map(() => 'M')
  } else {
    const rueckblick = saetze.slice(Math.max(0, von - 5), von).map((s, i) => `${von - Math.min(5, von) + i + 1} [${labels[von - Math.min(5, von) + i] ?? 'M'}]: ${s.text}`)
    const bekannt = Object.entries(personen).map(([kz, p]) => `${kz} = ${p.name || 'Name unbekannt'} (${p.rolle ?? kuerzelLabel(kz).rolle})`)
    const prompt = [
      `Art: ${artText(z.art)}. Mitarbeiter der Mayer Holding, der aufgenommen hat: ${k.besitzerName}.`,
      akteZeilen(k),
      k.team.length ? `Weitere Mitarbeiter der Mayer Holding (können dabei sein): ${k.team.filter((n) => n !== k.besitzerName).join(', ')}` : '',
      bekannt.length ? `Bisher zugeordnete Personen: ${bekannt.join('; ')}` : '',
      rueckblick.length ? `Schon zugeordnet (nur zur Orientierung, nicht erneut angeben):\n${rueckblick.join('\n')}` : '',
      `Zuzuordnen sind die Sätze ${von + 1} bis ${bis}:`,
      saetze.slice(von, bis).map((s, i) => `${von + i + 1}: ${s.text}`).join('\n'),
    ].filter(Boolean).join('\n\n')
    const system = [
      'Du bekommst die Abschrift eines Gesprächs, aufgeteilt in nummerierte Sätze. Die Spracherkennung hat keine Sprecher getrennt.',
      'Ordne jeden Satz einem Sprecher zu. Kürzel: M = der aufnehmende Mitarbeiter (M2 = ein weiterer Mitarbeiter), K = Kunde bzw. Gesprächspartner (K2, K3 bei mehreren), S = sonstige Person (S2 …).',
      'Achte auf Fragen und Antworten, Anreden, Sie/Du und darauf, wer berät und wer erzählt. Ein Satz kann auch eine kurze Rückmeldung sein („Ja.“, „Genau.“).',
      'Gib nur die Stellen an, an denen der Sprecher wechselt, und die erste Satznummer des Ausschnitts. Namen nur, wenn sie im Gespräch fallen oder aus den Angaben eindeutig sind — nichts erfinden.',
      sprachHinweis(z) ? `Die Abschrift ist ganz oder teilweise auf ${sprachHinweis(z)}; ordne trotzdem genauso zu.` : '',
      'Antworte ausschließlich, indem du das Werkzeug sprecher_zuordnen aufrufst, ohne weiteren Text.',
    ].filter(Boolean).join('\n')
    const antwort = await h.ki({ system, prompt, werkzeug: SPRECHER_WERKZEUG, maxTokens: 4000, timeoutMs })
    labels = [...labels, ...wendeWechselAn(antwort.wechsel, von, bis, labels[von - 1] ?? 'M')]
    for (const p of Array.isArray(antwort.personen) ? antwort.personen : []) {
      // deno-lint-ignore no-explicit-any
      const o = p as any
      const kz = String(o?.kuerzel ?? '').toUpperCase()
      if (!KUERZEL.test(kz)) continue
      const name = txt(o.name, 120)
      personen[kz] = { ...(personen[kz] ?? {}), ...(name && !/^(unbekannt|kunde|mitarbeiter)$/i.test(name) ? { name } : {}), rolle: kuerzelLabel(kz).rolle }
    }
  }
  const fertig = labels.length >= saetze.length
  const stempel = new Date(h.jetzt()).toISOString()
  await aendere(admin, z.id, (r) => {
    const rb = (r.bearbeitung ?? {}) as Bearbeitung
    // Hat inzwischen jemand anderes den Schritt übernommen (Sperre abgelaufen)? Dann nichts überschreiben.
    if (rb.seit !== b.seit) return null
    return {
      bearbeitung: { ...rb, schritt: fertig ? 'analyse' : 'sprecher', saetze_bis: labels.length, labels, personen, seit: null, versuche: 0, fehler: null, letzter_versuch: stempel },
      ...(fertig ? { sprecher: baueAbsaetze(saetze, labels, personen, k.besitzerName) } : {}),
    }
  }, h.jetzt())
}

// ---------- Auswertung ----------

const ANALYSE_WERKZEUG: KiWerkzeug = {
  name: 'auswertung_speichern',
  description: 'Speichert die Auswertung des Gesprächs. Nur Gesagtes; leere Listen, wenn nichts dazu gesagt wurde.',
  input_schema: {
    type: 'object',
    properties: {
      zusammenfassung: { type: 'string', description: '3–8 Sätze in einfachem Deutsch: worum ging es, was kam heraus.' },
      kernthemen: { type: 'array', items: { type: 'string' } },
      vereinbarungen: { type: 'array', items: { type: 'string' }, description: 'Was fest vereinbart wurde.' },
      offene_punkte: { type: 'array', items: { type: 'string' }, description: 'Was offen blieb oder noch zu klären ist.' },
      naechste_schritte: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, faellig: { type: 'string', description: 'JJJJ-MM-TT, nur wenn genannt' }, wer: { type: 'string' } }, required: ['text'] } },
      termine: { type: 'array', description: 'Nur fest verabredete neue Termine mit Tag.', items: { type: 'object', properties: { titel: { type: 'string' }, datum: { type: 'string', description: 'JJJJ-MM-TT' }, uhrzeit: { type: 'string', description: 'HH:MM' }, ort: { type: 'string' }, mit: { type: 'string' } }, required: ['titel', 'datum'] } },
      todos: { type: 'array', description: 'Aufgaben für die Mayer Holding.', items: { type: 'object', properties: { text: { type: 'string' }, faellig: { type: 'string', description: 'JJJJ-MM-TT' }, zustaendig: { type: 'string', description: 'Name eines Mitarbeiters, wenn genannt' } }, required: ['text'] } },
      wiedervorlagen: { type: 'array', description: 'Wann wieder melden oder nachfassen (mit Tag).', items: { type: 'object', properties: { titel: { type: 'string' }, faellig: { type: 'string', description: 'JJJJ-MM-TT' } }, required: ['titel', 'faellig'] } },
      zahlen: { type: 'array', description: 'Genannte Beträge und Werte (Kaufpreis, Miete, Umsatz, Darlehen, Fläche …).', items: { type: 'object', properties: { was: { type: 'string' }, betrag: { type: 'number' }, einheit: { type: 'string', description: '€, %, m², Jahre …' } }, required: ['was', 'betrag'] } },
      kundenfragen: { type: 'array', items: { type: 'string' }, description: 'Fragen des Kunden, vor allem unbeantwortete.' },
      einwaende: { type: 'array', items: { type: 'string' }, description: 'Bedenken oder Einwände des Kunden.' },
      stimmung: { type: 'string', description: 'Ein kurzer Satz zur Stimmung des Kunden.' },
      risiken: { type: 'array', items: { type: 'string' } },
      stammdaten: { type: 'array', description: 'Nur neue oder von der Akte abweichende Angaben, die ausdrücklich genannt wurden.', items: { type: 'object', properties: { feld: { type: 'string', enum: ['telefon', 'email', 'anschrift', 'firma', 'ansprechpartner', 'sonstiges'] }, wert: { type: 'string' } }, required: ['feld', 'wert'] } },
      unterlagen_fehlen: { type: 'array', items: { type: 'string' }, description: 'Unterlagen, die noch fehlen oder nachgereicht werden sollen.' },
      mail_entwurf: { type: 'object', properties: { betreff: { type: 'string' }, text: { type: 'string' } }, required: ['betreff', 'text'] },
      chance_hinweis: { type: 'object', description: 'Nur wenn das Gespräch klare Hinweise auf die Auftragschance gibt.', properties: { prozent: { type: 'number' }, begruendung: { type: 'string' } }, required: ['begruendung'] },
    },
    required: ['zusammenfassung', 'mail_entwurf'],
  },
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** Höchstzahl der Fragen, die an die Auswertung gehen (Rest der Vorlage bleibt unbeantwortet). */
export const FRAGEN_AN_KI = 150

export type FragebogenKontext = { vorlage: { id: string; name: string } | null; fragen: string[]; leistungen: string[]; aktenfelder: boolean }

/**
 * Fragebogen der Akte: Vorlage des Bereichs (vorlagen.typ 'Fragebogen', bevorzugt „Mandantenfragebogen“) und die
 * Bezeichnungen der Preisliste für die Dienstleistungen. Ohne Akte oder bei privaten Akten nichts. Wirft nie.
 */
export async function ladeFragebogenKontext(admin: Db, kunde: Zeile | null): Promise<FragebogenKontext> {
  const leer: FragebogenKontext = { vorlage: null, fragen: [], leistungen: [], aktenfelder: false }
  const bereich = txt(kunde?.bereich, 40)
  if (!kunde || !bereich || bereich === 'privat') return leer
  try {
    const [vorlagen, leistungen]: [Zeile[], Zeile[]] = await Promise.all([
      admin.from('vorlagen').select('id, name, text').eq('bereich', bereich).eq('typ', 'Fragebogen').limit(20).then((r: Zeile) => (r.data ?? []) as Zeile[]),
      admin.from('leistungen_preisliste').select('bezeichnung').order('sortierung', { ascending: true }).limit(100).then((r: Zeile) => (r.data ?? []) as Zeile[]),
    ])
    const mitText = vorlagen.filter((v) => txt(v.text, 50))
    const v = mitText.find((x) => /mandantenfragebogen/i.test(String(x.name ?? ''))) ?? mitText[0]
    const fragen = v ? fragenAusVorlage(String(v.text)).slice(0, FRAGEN_AN_KI) : []
    return {
      vorlage: v && fragen.length ? { id: String(v.id), name: txt(v.name, 200) || 'Fragebogen' } : null,
      fragen,
      leistungen: [...new Set(leistungen.map((l) => txt(l.bezeichnung, 150)).filter(Boolean))],
      aktenfelder: true,
    }
  } catch (err) {
    console.error('Gespräch: Fragebogen nicht geladen:', err)
    return { ...leer, aktenfelder: true }
  }
}

/** Werkzeug der Auswertung, bei Bedarf um Fragebogen und Aktenfelder erweitert. */
export function analyseWerkzeug(fk: Pick<FragebogenKontext, 'fragen' | 'aktenfelder'>): KiWerkzeug {
  const props: Record<string, unknown> = { ...(ANALYSE_WERKZEUG.input_schema.properties as Record<string, unknown>) }
  if (fk.fragen.length) {
    props.fragebogen = {
      type: 'array',
      description: 'Nur Fragen aus der Fragenliste, zu denen im Gespräch ausdrücklich etwas gesagt wurde.',
      items: {
        type: 'object',
        properties: {
          nr: { type: 'integer', description: 'Nummer der Frage in der Liste' },
          frage: { type: 'string', description: 'Die Frage genau wie in der Liste' },
          antwort: { type: 'string', description: 'Kurz und sachlich auf Deutsch, nur Gesagtes' },
          sicher: { type: 'boolean', description: 'true nur, wenn die Antwort eindeutig gesagt wurde' },
        },
        required: ['nr', 'antwort', 'sicher'],
      },
    }
  }
  if (fk.aktenfelder) {
    props.aktenfelder = {
      type: 'object',
      description: 'Vorschläge für die Akte, nur aus dem Gesagten; Felder weglassen, zu denen nichts gesagt wurde.',
      properties: {
        sachverhalt: { type: 'string', description: 'Zwei, drei Sätze: worum es bei diesem Auftrag geht' },
        branche: { type: 'string', description: 'Branche des Kunden' },
        dienstleistungen: { type: 'array', items: { type: 'string' }, description: 'Gewünschte Leistungen der Mayer Holding, möglichst Bezeichnungen aus der Preisliste' },
      },
    }
  }
  return { ...ANALYSE_WERKZEUG, input_schema: { ...ANALYSE_WERKZEUG.input_schema, properties: props } }
}

function aktenfeldZeile(kunde: Zeile | null): string {
  if (!kunde) return ''
  const dl = Array.isArray(kunde.dienstleistungen) ? kunde.dienstleistungen.map((x: unknown) => txt(x, 100)).filter(Boolean).join(', ') : ''
  return `Felder der Akte (leer = noch nicht ausgefüllt): Sachverhalt: ${txt(kunde.sachverhalt, 600) || 'leer'} · Branche: ${txt(kunde.branche, 120) || 'leer'} · Dienstleistungen: ${dl || 'leer'}`
}

async function analyseSchritt(admin: Db, z: Zeile, h: H, timeoutMs: number): Promise<void> {
  const k = await ladeKontext(admin, z)
  const sprache = erkannteSprache(z)
  const fremdsprache = sprache && sprache !== 'de' ? sprachName(sprache) : ''
  const b = (z.bearbeitung ?? {}) as Bearbeitung
  const { saetze, luecken } = zerlegeInSaetze(segmenteVon(z))
  const absaetze: GespraechAbsatz[] = Array.isArray(z.sprecher) && z.sprecher.length ? z.sprecher : baueAbsaetze(saetze, b.labels ?? [], b.personen, k.besitzerName)
  const tag = heuteBerlin(Date.parse(z.erstellt_am) || h.jetzt())
  const sprecherListe: GespraechAnalyse['sprecher'] = []
  for (const a of absaetze) if (!sprecherListe.some((s) => s.label === a.label)) sprecherListe.push({ label: a.label, ...(a.name ? { name: a.name } : {}), ...(a.rolle ? { rolle: a.rolle } : {}) })

  let analyse: GespraechAnalyse
  if (absaetze.length === 0) {
    analyse = { ...leereAnalyse(), zusammenfassung: 'In der Aufnahme war nichts Verständliches zu hören.' }
  } else {
    let abschrift = absaetze.map((a) => `[${mmss(a.sek)}] ${a.label}${a.name ? ` (${a.name})` : ''}: ${a.text}`).join('\n')
    if (abschrift.length > 350_000) abschrift = `${abschrift.slice(0, 200_000)}\n[… Mitte gekürzt …]\n${abschrift.slice(-150_000)}`
    const marker = (Array.isArray(z.marker) ? z.marker : []) as GespraechMarker[]
    const d = new Date(`${tag}T12:00:00Z`)
    const fk = await ladeFragebogenKontext(admin, k.kunde)
    const prompt = [
      `Datum des Gesprächs: ${WOCHENTAGE[d.getUTCDay()]}, ${tag}. Art: ${artText(z.art)}.`,
      `Mitarbeiter, der aufgenommen hat: ${k.besitzerName}.`,
      akteZeilen(k),
      k.team.length ? `Mitarbeiter der Mayer Holding (für „zuständig“): ${k.team.join(', ')}` : '',
      z.titel ? `Titel der Aufnahme: ${txt(z.titel, 200)}` : '',
      marker.length ? `Markierungen des Mitarbeiters während des Gesprächs:\n${marker.map((m) => `[${mmss(m.sek)}] ${m.art}: ${txt(m.text, 300)}`).join('\n')}` : '',
      txt(z.notizen) ? `Notizen des Mitarbeiters:\n${txt(z.notizen, 5000)}` : '',
      luecken.length ? `Hinweis: Teil ${luecken.join(', ')} der Aufnahme fehlt in der Abschrift.` : '',
      fk.aktenfelder ? aktenfeldZeile(k.kunde) : '',
      fk.aktenfelder && fk.leistungen.length ? `Dienstleistungen laut Preisliste: ${fk.leistungen.join(', ')}` : '',
      fk.vorlage ? `Fragebogen „${fk.vorlage.name}“ — beantworte nur Fragen, zu denen im Gespräch etwas gesagt wurde:\n${fk.fragen.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
      `Abschrift (Sprecher automatisch zugeordnet, kann Fehler enthalten):\n${abschrift}`,
    ].filter(Boolean).join('\n\n')
    const system = [
      'Du wertest ein aufgenommenes Kundengespräch für das CRM der Mayer Holding aus.',
      'Grundregel: Nur was im Gespräch gesagt wurde (oder in den Markierungen/Notizen des Mitarbeiters steht). Nichts erfinden, nichts ergänzen, nicht schätzen. Wenn zu einem Feld nichts gesagt wurde: leere Liste bzw. weglassen.',
      'Schreibe in einfachem, klarem Deutsch ohne englische Wörter und ohne Fachjargon.',
      `Daten immer als JJJJ-MM-TT. Rechne Angaben wie „nächsten Dienstag“ oder „Ende des Monats“ vom Gesprächsdatum aus um; ist kein Tag erkennbar, lass das Datum weg (Termine und Wiedervorlagen ohne Tag ganz weglassen).`,
      'Stammdaten nur, wenn sie ausdrücklich genannt wurden und in der Akte fehlen oder abweichen.',
      fremdsprache ? `Die Abschrift ist ganz oder teilweise auf ${fremdsprache}. Schreibe trotzdem alle Felder auf Deutsch (auch Zusammenfassung, Listen und Mail-Entwurf); Namen, Orte und Beträge unverändert übernehmen.` : '',
      fk.vorlage ? 'fragebogen: nur Fragen aus der Fragenliste, zu denen im Gespräch ausdrücklich etwas gesagt wurde; nr = Nummer der Frage; antwort kurz und sachlich; sicher = true nur, wenn die Antwort eindeutig gesagt wurde. Nichts schließen oder schätzen — lieber weglassen.' : '',
      fk.aktenfelder ? 'aktenfelder: sachverhalt = zwei, drei Sätze, worum es bei dem Auftrag geht; branche = Branche des Kunden; dienstleistungen = gewünschte Leistungen der Mayer Holding (möglichst Bezeichnungen aus der Preisliste). Nur aus dem Gesagten; Felder weglassen, zu denen nichts gesagt wurde.' : '',
      z.art === 'notiz'
        ? 'Es ist eine gesprochene Notiz ohne Kunden: mail_entwurf mit leerem Betreff und leerem Text.'
        : `mail_entwurf: kurze Nachfass-Mail an den Kunden in der Sie-Form, freundlich und schlicht; fasst Vereinbarungen, nächste Schritte und fehlende Unterlagen zusammen, nur Gesagtes. Anrede mit Namen, wenn bekannt („Sehr geehrte Frau …“/„Sehr geehrter Herr …“, sonst „Guten Tag“). Schluss: „Mit freundlichen Grüßen“, darunter „${k.besitzerName}“. Keine Platzhalter in eckigen Klammern.`,
      'Antworte ausschließlich, indem du das Werkzeug auswertung_speichern aufrufst, ohne weiteren Text.',
    ].filter(Boolean).join('\n')
    const roh = await h.ki({ system, prompt, werkzeug: analyseWerkzeug(fk), maxTokens: fk.vorlage ? 12000 : 8000, timeoutMs })
    analyse = normalisiereAnalyse(roh, tag)
    if (z.art === 'notiz') analyse.mail_entwurf = { betreff: '', text: '' }
    // Fragebogen nur auf die Fragen der Vorlage (Frage genau wie dort), Aktenfelder nur bei einer Akte.
    delete analyse.fragebogen
    delete analyse.fragebogen_vorlage
    if (fk.vorlage) {
      const fb = ordneFragebogenZu(roh.fragebogen, fk.fragen)
      if (fb.length) {
        analyse.fragebogen = fb
        analyse.fragebogen_vorlage = fk.vorlage
      }
    }
    if (!fk.aktenfelder) delete analyse.aktenfelder
  }
  analyse.sprecher = sprecherListe
  const stempel = new Date(h.jetzt()).toISOString()
  const fertig = await aendere(admin, z.id, (r) => {
    const rb = (r.bearbeitung ?? {}) as Bearbeitung
    if (rb.seit !== b.seit || r.status === 'verworfen') return null
    return {
      analyse,
      sprecher: absaetze,
      sprache_erkannt: sprache,
      status: 'fertig',
      fehler: null,
      bearbeitung: { ...rb, schritt: 'fertig', seit: null, versuche: 0, fehler: null, letzter_versuch: stempel },
    }
  }, h.jetzt())
  if (fertig) await meldeBesitzer(admin, z.id, h)
}

// ---------- Der Lauf (Abschrift → Sprecher → Auswertung) ----------

/**
 * Arbeitet eine Aufnahme so weit ab, wie die Zeit dieses Laufs reicht, und stößt sich bei Bedarf selbst neu an.
 * Wirft nie.
 */
export async function arbeiteGespraech(admin: Db, id: string, hilfen: GespraechHilfen): Promise<void> {
  const h = mitStandard(admin, hilfen)
  const start = h.jetzt()
  const budget = Math.min(SPERRE_MS - 20_000, h.restMs() - 10_000)
  const bleibt = () => budget - (h.jetzt() - start)
  const weiterreichen = async () => {
    await h.warteAufNeuenWorker()
    await h.stosseAn(id)
  }
  try {
    setzeAnlass('gespraech_auswertung')
    for (let runde = 0; runde < 50; runde++) {
      const { data: z } = await admin.from(GESPRAECH_TABELLE).select('*').eq('id', id).maybeSingle()
      if (!z) return
      if (runde === 0) {
        setzePerson(z.mitarbeiter_email)
        if (z.kunde_bereich === 'privat') setzePrivat()
      }
      const arbeit = naechsteArbeit(z, h.jetzt())
      if (!arbeit || arbeit.art === 'warten') return
      if (arbeit.art === 'transkribieren') {
        let bewegt = false
        for (const nr of arbeit.nrs) {
          if (bleibt() < 40_000) return await weiterreichen()
          if ((await transkribiereSegment(admin, id, nr, h, Math.min(100_000, bleibt() - 10_000))) !== 'nichts') bewegt = true
        }
        // Nichts ging voran (alles gesperrt oder Datenbankfehler): nicht im Kreis laufen, der Minutentakt holt nach.
        if (!bewegt) return
        continue
      }
      if (arbeit.art === 'aufgeben') {
        const meldung = `Die Auswertung ist nach mehreren Versuchen nicht gelungen (${arbeit.grund}). Bitte in der App „Neu auswerten“ wählen.`
        const r = await aendere(admin, id, (x) => (['transkription', 'analyse', 'hochladen'].includes(x.status) ? { status: 'fehler', fehler: meldung, bearbeitung: { ...(x.bearbeitung ?? {}), seit: null } } : null), h.jetzt())
        if (r) await meldeBesitzer(admin, id, h)
        return
      }
      const bedarf = arbeit.art === 'sprecher' ? 60_000 : 100_000
      if (bleibt() < bedarf) return await weiterreichen()
      const stempel = new Date(h.jetzt()).toISOString()
      const belegt = await aendere(admin, id, (x) => {
        const a = naechsteArbeit(x, h.jetzt())
        if (!a || a.art !== arbeit.art) return null
        const b = (x.bearbeitung ?? {}) as Bearbeitung
        const zusammen = zerlegeInSaetze(segmenteVon(x))
        return {
          status: 'analyse',
          // Rohe Abschrift, sobald alle Abschnitte da sind — die App zeigt sie schon während der Auswertung.
          ...(!x.transkript ? { transkript: zusammen.text } : {}),
          bearbeitung: { ...b, schritt: arbeit.art, seit: stempel, versuche: (b.versuche ?? 0) + 1, letzter_versuch: stempel },
        }
      }, h.jetzt())
      if (!belegt) return
      const timeoutMs = Math.max(20_000, Math.min(bleibt() - 8_000, SPERRE_MS - 15_000))
      try {
        if (arbeit.art === 'sprecher') await sprecherSchritt(admin, belegt, h, timeoutMs)
        else await analyseSchritt(admin, belegt, h, timeoutMs)
      } catch (err) {
        const meldung = (err instanceof Error ? err.message : String(err)).slice(0, 300)
        console.error(`Gespräch ${id}: Schritt ${arbeit.art} fehlgeschlagen:`, meldung)
        const versuche = Number((belegt.bearbeitung as Bearbeitung)?.versuche ?? 1)
        const endgueltig = versuche >= SCHRITT_MAX_VERSUCHE
        const r = await aendere(admin, id, (x) => {
          const b = (x.bearbeitung ?? {}) as Bearbeitung
          if (b.seit !== stempel) return null
          return {
            bearbeitung: { ...b, seit: null, fehler: meldung },
            ...(endgueltig ? { status: 'fehler', fehler: `Die Auswertung ist nicht gelungen: ${meldung}` } : {}),
          }
        }, h.jetzt())
        if (r && endgueltig) await meldeBesitzer(admin, id, h)
        // Nächster Versuch frühestens nach WIEDERHOLEN_NACH_MS — über den Minutentakt.
        return
      }
    }
  } catch (err) {
    console.error(`Gespräch ${id}: Lauf fehlgeschlagen:`, err)
  }
}

// ---------- Nachricht an den Besitzer ----------

/** Einmal je Ergebnis (gemeldet_am), nur mit eingeschalteter Einstellung kalender_einstellungen.gespraech_meldung
 *  (Standard an). Privat (ohne Mayer-Akte oder private Akte) über den privaten Bot, wenn der aktiv ist. Wirft nie. */
export async function meldeBesitzer(admin: Db, id: string, hilfen: GespraechHilfen): Promise<boolean> {
  const h = mitStandard(admin, hilfen)
  try {
    const stempel = new Date(h.jetzt()).toISOString()
    const z = await aendere(admin, id, (r) => (['fertig', 'fehler'].includes(r.status) && !r.gemeldet_am ? { gemeldet_am: stempel } : null), h.jetzt())
    if (!z) return false
    const { data: einst } = await admin.from('kalender_einstellungen').select('email, gespraech_meldung').eq('email', z.mitarbeiter_email).maybeSingle()
    if (einst && einst.gespraech_meldung === false) return false
    const k = await ladeKontext(admin, z)
    const wer = k.akteName ? `zum Gespräch mit ${k.akteName}` : z.titel ? `zur Aufnahme „${txt(z.titel, 120)}“` : `zu deiner Aufnahme vom ${heuteBerlin(Date.parse(z.erstellt_am) || h.jetzt()).split('-').reverse().join('.')}`
    const link = `${GESPRAECH_APP_LINK}${z.id}`
    const text = z.status === 'fertig'
      ? `🎙️ Die Auswertung ${wer} ist fertig — prüfen und übernehmen:\n${link}`
      : `🎙️ Die Auswertung ${wer} ist leider nicht gelungen. In der App kannst du sie neu starten:\n${link}`
    if (k.privat && (await h.privatBotAktiv(z.mitarbeiter_email))) {
      if (await h.sendePrivat(k.besitzerChat, text)) return true
      // Privat und nicht zugestellt: beim nächsten Minutentakt erneut, nie ersatzweise über den Mayer-Bot.
      await aendere(admin, id, (r) => (r.gemeldet_am === stempel ? { gemeldet_am: null } : null), h.jetzt())
      return false
    }
    return await h.sendeTelegram(k.besitzerChat, text)
  } catch (err) {
    console.error(`Gespräch ${id}: Nachricht an den Besitzer fehlgeschlagen:`, err)
    return false
  }
}

// ---------- Minutentakt: Nachholen und Löschfrist ----------

/** Löscht Audio, dessen Aufbewahrungsfrist abgelaufen ist (aufbewahren_bis vor heute). Abschrift und Auswertung bleiben. */
export async function loescheAbgelaufeneAudios(admin: Db, jetzt = Date.now(), hoechstens = 20): Promise<number> {
  const heute = heuteBerlin(jetzt)
  const { data, error } = await admin
    .from(GESPRAECH_TABELLE)
    .select('id, segmente, bearbeitung, aufbewahren_bis, audio_geloescht_am')
    .is('audio_geloescht_am', null)
    .lt('aufbewahren_bis', heute)
    .order('aufbewahren_bis', { ascending: true })
    .limit(hoechstens)
  if (error) throw new Error(error.message)
  let geloescht = 0
  for (const z of (data ?? []) as Zeile[]) {
    if (frisch(z.bearbeitung?.seit, jetzt)) continue
    const pfade = segmenteVon(z).map((s) => s.pfad).filter((p) => typeof p === 'string' && p)
    if (pfade.length) {
      const { error: e } = await admin.storage.from(GESPRAECH_BUCKET).remove(pfade)
      if (e) {
        console.error(`Gespräch ${z.id}: Audio nicht gelöscht:`, e.message)
        continue
      }
    }
    await admin.from(GESPRAECH_TABELLE).update({ audio_geloescht_am: new Date(jetzt).toISOString() }).eq('id', z.id).is('audio_geloescht_am', null)
    geloescht++
  }
  return geloescht
}

/**
 * Für den Minutentakt (termin_erinnerungen): hängende Abschriften/Auswertungen als eigene Anfragen anstoßen
 * (höchstens 5 je Minute), nicht zugestellte Meldungen nachholen, abgelaufenes Audio löschen. Ohne KI. Wirft nie.
 */
export async function gespraechMinutentakt(admin: Db, hilfen: GespraechHilfen): Promise<{ angestossen: number; gemeldet: number; geloescht: number }> {
  const h = mitStandard(admin, hilfen)
  const jetzt = h.jetzt()
  const aus = { angestossen: 0, gemeldet: 0, geloescht: 0 }
  try {
    const { data } = await admin
      .from(GESPRAECH_TABELLE)
      .select('id, status, art, segmente, bearbeitung, abgeschlossen_am, geaendert_am')
      .in('status', ['aufnahme', 'hochladen', 'transkription', 'analyse'])
      .gte('geaendert_am', new Date(jetzt - 3 * 86400e3).toISOString())
      .order('geaendert_am', { ascending: true })
      .limit(200)
    for (const z of (data ?? []) as Zeile[]) {
      if (aus.angestossen >= 5) break
      const a = naechsteArbeit(z, jetzt)
      if (!a || a.art === 'warten') continue
      await h.stosseAn(z.id)
      aus.angestossen++
    }
  } catch (err) {
    console.error('Gespräch: Nachholen im Minutentakt fehlgeschlagen:', err)
  }
  try {
    const { data } = await admin
      .from(GESPRAECH_TABELLE)
      .select('id')
      .in('status', ['fertig', 'fehler'])
      .is('gemeldet_am', null)
      .gte('geaendert_am', new Date(jetzt - 86400e3).toISOString())
      .limit(10)
    for (const z of (data ?? []) as Zeile[]) if (await meldeBesitzer(admin, z.id, h)) aus.gemeldet++
  } catch (err) {
    console.error('Gespräch: Meldungen im Minutentakt fehlgeschlagen:', err)
  }
  try {
    aus.geloescht = await loescheAbgelaufeneAudios(admin, jetzt)
  } catch (err) {
    console.error('Gespräch: Löschfrist im Minutentakt fehlgeschlagen:', err)
  }
  return aus
}

// ---------- Antworten an die App ----------

/** Zeile für die App: ohne interne Felder; für Leser (nicht Besitzer) ohne Speicherpfade. */
export function fuerAntwort(z: Zeile, besitzer: boolean): Zeile {
  const { stand: _s, bearbeitung, ...rest } = z
  const b = (bearbeitung ?? {}) as Bearbeitung
  return {
    ...rest,
    besitzer,
    segmente: segmenteVon(z).map(({ stuecke: _st, seit, ...s }) => ({ ...s, pfad: besitzer ? s.pfad : '', in_arbeit: !!seit })),
    fotos: (Array.isArray(z.fotos) ? z.fotos : []).map((f: GespraechFoto) => (besitzer ? f : { ...f, pfad: '' })),
    fortschritt: {
      schritt: b.schritt ?? null,
      saetze_bis: b.saetze_bis ?? 0,
      versuche: b.versuche ?? 0,
      fehler: b.fehler ?? null,
    },
  }
}

const LISTEN_SPALTEN = 'id, mitarbeiter_email, kunde_id, kunde_bereich, objekt_id, termin_id, titel, art, status, fehler, dauer_s, erstellt_am, geaendert_am, aufbewahren_bis, audio_geloescht_am, analyse, uebernommen'

// ---------- Aktionen ----------

export const GESPRAECH_AKTIONEN = new Set([
  'gespraech_anlegen',
  'gespraech_upload_url',
  'gespraech_segment_fertig',
  'gespraech_marker',
  'gespraech_notiz',
  'gespraech_abschliessen',
  'gespraech_neu_auswerten',
  'gespraech_stand',
  'gespraech_liste',
  'gespraech_datei_url',
  'gespraech_verwerfen',
  'gespraech_weiter',
  'gespraech_uebersetzen',
  'gespraech_teilen',
  'gespraech_kundennotiz_vermerken',
  'gespraech_loeschen',
])

async function ladeZeile(admin: Db, id: unknown): Promise<Zeile | null> {
  const s = txt(id, 60)
  if (!UUID.test(s)) return null
  const { data } = await admin.from(GESPRAECH_TABELLE).select('*').eq('id', s).maybeSingle()
  return data ?? null
}

function istBesitzer(z: Zeile, a: GespraechAufrufer | null): boolean {
  return !!a && String(z.mitarbeiter_email).toLowerCase() === a.email.toLowerCase()
}

/** Gibt es die Akte bzw. das Objekt (noch)? Nötig, weil die Rechteprüfung in index.ts (darfKundeServer,
 *  darfObjektServer) eine fehlende Akte durchlässt — nach dem Löschen oder Zusammenführen einer Akte hätte sonst jeder
 *  Mitarbeiter die daran hängenden Aufnahmen lesen können. */
async function gibtEs(admin: Db, tabelle: 'kunden' | 'objekte', id: unknown): Promise<boolean> {
  const s = txt(id, 120)
  if (!s) return false
  const { data, error } = await admin.from(tabelle).select('id').eq('id', s).maybeSingle()
  return !error && !!data
}

async function darfLesen(admin: Db, z: Zeile, a: GespraechAufrufer | null, h: H): Promise<boolean> {
  if (istBesitzer(z, a)) return true
  if (!a || z.status === 'verworfen') return false
  if (z.kunde_id && h.darfKunde && (await gibtEs(admin, 'kunden', z.kunde_id)) && (await h.darfKunde(z.kunde_id))) return true
  // Hängt die Aufnahme an einer privaten Akte, zählt allein diese (wie der Zeilenschutz der Datenbank) — nicht das Objekt.
  if (z.kunde_bereich === 'privat') return false
  if (z.objekt_id && h.darfObjekt && (await gibtEs(admin, 'objekte', z.objekt_id)) && (await h.darfObjekt(z.objekt_id))) return true
  return false
}

/** Akte/Objekt/Termin prüfen und auflösen (für Anlegen und Umhängen). */
async function pruefeVerknuepfung(admin: Db, a: GespraechAufrufer, h: H, ein: { kundeId?: unknown; objektId?: unknown; terminId?: unknown }): Promise<{ ok: true; werte: Zeile; termin: Zeile | null } | { ok: false; antwort: Antwort }> {
  const werte: Zeile = {}
  let termin: Zeile | null = null
  const terminId = txt(ein.terminId, 60)
  if (terminId) {
    if (!UUID.test(terminId)) return { ok: false, antwort: fehler(400, 'Der Termin ist ungültig.') }
    const { data } = await admin.from('termine').select('id, titel, besitzer_email, teilnehmer, kunde_id, kunde_bereich').eq('id', terminId).maybeSingle()
    if (!data) return { ok: false, antwort: fehler(404, 'Diesen Termin gibt es nicht (mehr).') }
    const beteiligt = String(data.besitzer_email ?? '').toLowerCase() === a.email.toLowerCase() || (Array.isArray(data.teilnehmer) && data.teilnehmer.map((t: string) => String(t).toLowerCase()).includes(a.email.toLowerCase()))
    if (!beteiligt) return { ok: false, antwort: fehler(403, 'Bei diesem Termin bist du nicht eingetragen.') }
    termin = data
    werte.termin_id = terminId
  }
  const kundeId = txt(ein.kundeId, 80) || txt(termin?.kunde_id, 80)
  if (kundeId) {
    const { data: kunde } = await admin.from('kunden').select('id, bereich').eq('id', kundeId).maybeSingle()
    if (!kunde) return { ok: false, antwort: fehler(404, 'Diese Akte gibt es nicht.') }
    if (!h.darfKunde || !(await h.darfKunde(kundeId))) return { ok: false, antwort: fehler(403, 'Diese Akte ist für dich nicht freigegeben.') }
    werte.kunde_id = kundeId
    werte.kunde_bereich = kunde.bereich ?? null
  }
  const objektId = txt(ein.objektId, 80)
  if (objektId) {
    const { data: objekt } = await admin.from('objekte').select('id').eq('id', objektId).maybeSingle()
    if (!objekt) return { ok: false, antwort: fehler(404, 'Dieses Objekt gibt es nicht.') }
    if (!h.darfObjekt || !(await h.darfObjekt(objektId))) return { ok: false, antwort: fehler(403, 'Dieses Objekt ist für dich nicht freigegeben.') }
    werte.objekt_id = objektId
  }
  return { ok: true, werte, termin }
}

function aufbewahrenBis(x: unknown, jetzt: number): string | undefined {
  const t = zahl(x)
  if (t === null) return undefined
  return plusTage(heuteBerlin(jetzt), Math.max(1, Math.min(3650, Math.round(t))))
}

/**
 * Alle Aktionen der Gesprächs-App außer gespraech_uebernehmen. `aufrufer` = angemeldeter Mitarbeiter (null nur
 * beim Dienst-Schlüssel, dann ist allein gespraech_weiter erlaubt). Antwort { status, daten } — daten ist
 * bei Fehlern { error }.
 */
// deno-lint-ignore no-explicit-any
export async function gespraechAktion(admin: Db, aufrufer: GespraechAufrufer | null, body: Record<string, any>, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  const aktion = String(body?.action ?? '')
  const jetzt = h.jetzt()
  const stempel = new Date(jetzt).toISOString()

  if (aktion === 'gespraech_weiter') {
    if (!h.dienst) return fehler(403, 'Nur für den Server selbst.')
    const id = txt(body.id, 60)
    if (!UUID.test(id)) return fehler(400, 'id fehlt.')
    h.imHintergrund(arbeiteGespraech(admin, id, h))
    return ok({ ok: true })
  }
  if (!aufrufer) return fehler(401, 'Bitte neu anmelden — die Anmeldung fehlt oder ist abgelaufen.')
  setzePerson(aufrufer.email)
  const ich = aufrufer.email.toLowerCase()
  if (aktion === 'gespraech_liste') return await gespraechListe(admin, aufrufer, body, h)

  if (aktion === 'gespraech_anlegen') {
    const art = txt(body.art, 20) as GespraechArt
    if (!(GESPRAECH_ARTEN as readonly string[]).includes(art)) return fehler(400, 'Unbekannte Art — erwartet termin, telefon oder notiz.')
    // Wiederholter Aufruf mit derselben Kennung (App war offline): dieselbe Aufnahme zurückgeben.
    const eigeneId = txt(body.id, 60)
    if (eigeneId) {
      if (!UUID.test(eigeneId)) return fehler(400, 'Die Kennung der Aufnahme ist ungültig.')
      const vorhanden = await ladeZeile(admin, eigeneId)
      if (vorhanden) return istBesitzer(vorhanden, aufrufer) ? ok({ id: vorhanden.id }) : fehler(409, 'Diese Kennung ist schon vergeben.')
    }
    // deno-lint-ignore no-explicit-any
    const e: any = body.einwilligung && typeof body.einwilligung === 'object' ? body.einwilligung : null
    if (art !== 'notiz' && e?.bestaetigt !== true) return fehler(400, 'Bitte zuerst bestätigen, dass der Gesprächspartner mit der Aufnahme einverstanden ist.')
    const einwilligung = e?.bestaetigt === true ? { bestaetigt: true, am: txt(e.am, 40) && Number.isFinite(Date.parse(e.am)) ? new Date(e.am).toISOString() : stempel, text: txt(e.text, 1000), ...(txt(e.wer, 200) ? { wer: txt(e.wer, 200) } : {}) } : null
    let v = await pruefeVerknuepfung(admin, aufrufer, h, { kundeId: body.kundeId, objektId: body.objektId, terminId: body.terminId })
    const weggelassen: string[] = []
    if (!v.ok) {
      // Die App legt die Aufnahme oft erst nach dem Gespräch an (ohne Netz aufgenommen, Link aus dem Kalender). Ist der
      // Termin inzwischen gelöscht (z. B. vom Outlook-Abgleich neu angelegt) oder die Akte nicht mehr freigegeben, darf das
      // den Ton nicht für immer auf dem Handy festhalten (die App versucht es sonst endlos): ungültige Verknüpfungen
      // einzeln weglassen — die Akte lässt sich danach in der App zuordnen.
      const werte: Zeile = {}
      let termin: Zeile | null = null
      const teile: [string, { kundeId?: unknown; objektId?: unknown; terminId?: unknown }][] = [
        ['den Termin', { terminId: body.terminId }],
        ['die Akte', { kundeId: body.kundeId }],
        ['das Objekt', { objektId: body.objektId }],
      ]
      for (const [name, ein] of teile) {
        if (!txt(Object.values(ein)[0], 80)) continue
        const einzeln = await pruefeVerknuepfung(admin, aufrufer, h, ein)
        if (einzeln.ok) {
          Object.assign(werte, einzeln.werte)
          termin = termin ?? einzeln.termin
        } else weggelassen.push(name)
      }
      v = { ok: true, werte, termin }
    }
    const zeile: Zeile = {
      ...(eigeneId ? { id: eigeneId } : {}),
      mitarbeiter_email: ich,
      kunde_id: null,
      kunde_bereich: null,
      objekt_id: null,
      termin_id: null,
      ...v.werte,
      titel: txt(body.titel, 200) || txt(v.termin?.titel, 200) || null,
      art,
      status: 'aufnahme',
      segmente: [],
      marker: [],
      fotos: [],
      einwilligung,
      // Sprache nur, wenn die App sie schickt (ältere Fassungen: Vorgabe der Tabelle = deutsch).
      ...(body.sprache !== undefined && body.sprache !== null ? { sprache: normalisiereSprachwahl(body.sprache) } : {}),
      aufbewahren_bis: aufbewahrenBis(body.aufbewahrenTage, jetzt) ?? plusTage(heuteBerlin(jetzt), STANDARD_AUFBEWAHREN_TAGE),
      bearbeitung: {},
      stand: 0,
      erstellt_am: stempel,
      geaendert_am: stempel,
    }
    const { data, error } = await admin.from(GESPRAECH_TABELLE).insert(zeile).select('id').single()
    if (error) return fehler(500, `Die Aufnahme konnte nicht angelegt werden: ${error.message}`)
    if (weggelassen.length) console.log(`Gespräch ${data.id}: ohne ${weggelassen.join(', ')} angelegt (nicht gefunden oder nicht freigegeben).`)
    return ok({ id: data.id, ...(weggelassen.length ? { hinweis: `Angelegt ohne ${weggelassen.join(', ')} (nicht gefunden oder nicht freigegeben) — bitte in der App eine Akte zuordnen.` } : {}) })
  }

  const z = await ladeZeile(admin, body.id)
  if (!z) return fehler(404, 'Diese Aufnahme gibt es nicht.')
  const besitzer = istBesitzer(z, aufrufer)

  // ---- Lesen (Besitzer oder wer die Akte sehen darf) ----
  if (aktion === 'gespraech_stand') {
    if (!(await darfLesen(admin, z, aufrufer, h))) return fehler(403, 'Diese Aufnahme ist für dich nicht freigegeben.')
    // Fragt der Besitzer nach dem Stand und hängt etwas (Worker abgebrochen, Wartezeit nach Fehler vorbei)? Dann
    // gleich von hier fortsetzen statt bis zum nächsten Minutentakt zu warten. Die Sperren verhindern Doppelarbeit.
    const arbeit = besitzer ? naechsteArbeit(z, jetzt) : null
    if (arbeit && arbeit.art !== 'warten') h.imHintergrund(arbeiteGespraech(admin, z.id, h))
    return ok({ aufnahme: fuerAntwort(z, besitzer) })
  }
  if (aktion === 'gespraech_datei_url') {
    if (!(await darfLesen(admin, z, aufrufer, h))) return fehler(403, 'Diese Aufnahme ist für dich nicht freigegeben.')
    let pfad = ''
    if (body.nr !== undefined && body.nr !== null) {
      // Audio hört nur der Besitzer.
      if (!besitzer) return fehler(403, 'Die Tonaufnahme kann nur anhören, wer sie aufgenommen hat.')
      if (z.audio_geloescht_am) return fehler(410, 'Die Tonaufnahme ist nach Ablauf der Frist gelöscht worden.')
      pfad = segmenteVon(z).find((s) => s.nr === zahl(body.nr))?.pfad ?? ''
    } else {
      pfad = (Array.isArray(z.fotos) ? (z.fotos as GespraechFoto[]) : []).find((f) => f.pfad === txt(body.pfad, 400))?.pfad ?? ''
    }
    if (!pfad) return fehler(404, 'Diese Datei gibt es nicht.')
    const { data, error } = await admin.storage.from(GESPRAECH_BUCKET).createSignedUrl(pfad, 3600)
    if (error || !data?.signedUrl) return fehler(500, 'Die Datei lässt sich gerade nicht öffnen.')
    return ok({ url: data.signedUrl })
  }

  if (aktion === 'gespraech_uebersetzen' && txt(body.art, 20) !== 'mail' && txt(body.art, 20) !== 'notiz') {
    if (!(await darfLesen(admin, z, aufrufer, h))) return fehler(403, 'Diese Aufnahme ist für dich nicht freigegeben.')
    return await uebersetzeAbschrift(admin, z, h)
  }

  // ---- Ab hier nur der Besitzer ----
  if (!besitzer) return (await darfLesen(admin, z, aufrufer, h)) ? fehler(403, 'Ändern kann nur, wer die Aufnahme gemacht hat.') : fehler(403, 'Diese Aufnahme ist für dich nicht freigegeben.')
  // Verworfenen Eintrag endgültig aus der Liste löschen („Meine Aufnahmen“). Der Browser darf die Tabelle nicht selbst
  // löschen (kein Recht dazu) — darum hier. Ton und Fotos sind beim Verwerfen schon gelöscht.
  if (aktion === 'gespraech_loeschen') {
    if (z.status !== 'verworfen') return fehler(409, 'Bitte die Aufnahme zuerst verwerfen.')
    const { error } = await admin.from(GESPRAECH_TABELLE).delete().eq('id', z.id).eq('status', 'verworfen')
    if (error) return fehler(500, `Der Eintrag ließ sich nicht löschen: ${error.message}`)
    return ok({ ok: true })
  }
  if (z.status === 'verworfen') return fehler(409, 'Diese Aufnahme wurde verworfen.')
  const id = z.id as string

  if (aktion === 'gespraech_upload_url') {
    const nr = zahl(body.nr)
    if (nr === null || !Number.isInteger(nr) || nr < 0 || nr > 9999) return fehler(400, 'nr fehlt oder ist ungültig.')
    const mime = txt(body.mime, 100).toLowerCase().split(';')[0].trim()
    if (BILD_ENDUNG[mime]) {
      const pfad = `${ich}/${id}/foto_${nr}.${BILD_ENDUNG[mime]}`
      const { data, error } = await admin.storage.from(GESPRAECH_BUCKET).createSignedUploadUrl(pfad, { upsert: true })
      if (error || !data) return fehler(500, `Upload-Adresse nicht erstellt: ${error?.message ?? 'unbekannt'}`)
      return ok({ pfad, signedUrl: data.signedUrl, token: data.token })
    }
    const endung = AUDIO_ENDUNG[mime]
    if (!endung) return fehler(400, `Dieses Tonformat (${mime || 'unbekannt'}) wird nicht unterstützt.`)
    if (z.status === 'fertig') return fehler(409, 'Die Auswertung ist schon fertig — weitere Abschnitte sind nicht mehr möglich.')
    const pfad = `${ich}/${id}/seg_${nr}.${endung}`
    let abgelehnt = ''
    const r = await aendere(admin, id, (x) => {
      const s = segmenteVon(x).find((y) => y.nr === nr)
      if (s && (s.status === 'transkribiert' || (s.status === 'hochgeladen' && frisch(s.seit, jetzt)))) {
        abgelehnt = 'Dieser Abschnitt ist schon hochgeladen.'
        return null
      }
      return { segmente: ersetzeSegment(segmenteVon(x), { nr, pfad, mime, status: 'offen' }) }
    }, jetzt)
    if (!r) return fehler(409, abgelehnt || 'Diese Aufnahme gibt es nicht mehr.')
    const { data, error } = await admin.storage.from(GESPRAECH_BUCKET).createSignedUploadUrl(pfad, { upsert: true })
    if (error || !data) return fehler(500, `Upload-Adresse nicht erstellt: ${error?.message ?? 'unbekannt'}`)
    return ok({ pfad, signedUrl: data.signedUrl, token: data.token })
  }

  if (aktion === 'gespraech_segment_fertig') {
    const nr = zahl(body.nr)
    const s = segmenteVon(z).find((y) => y.nr === nr)
    if (!s) return fehler(404, 'Diesen Abschnitt kennt der Server nicht — bitte zuerst die Upload-Adresse holen.')
    if (s.status === 'transkribiert' || s.status === 'hochgeladen') return ok({ ok: true, status: s.status })
    const bytes = zahl(body.bytes)
    const dauer = zahl(body.dauer_s)
    const r = await aendere(admin, id, (x) => {
      const t = segmenteVon(x).find((y) => y.nr === nr)
      if (!t || t.status === 'transkribiert' || t.status === 'hochgeladen') return null
      const zuGross = bytes !== null && bytes > TRANSKRIPTION_MAX_BYTES
      const neu: GespraechSegment = {
        ...t,
        status: zuGross ? 'fehler' : 'hochgeladen',
        ...(bytes !== null ? { bytes: Math.round(bytes) } : {}),
        ...(dauer !== null ? { dauer_s: Math.round(dauer * 10) / 10 } : {}),
        versuche: 0,
        seit: null,
        fehler: zuGross ? 'Der Abschnitt ist für die Abschrift zu groß (über 24 MB).' : null,
      }
      const segmente = ersetzeSegment(segmenteVon(x), neu)
      // Alle hochgeladen, nachdem schon abgeschlossen war → weiter mit der Abschrift.
      const status = x.status === 'hochladen' && !segmente.some((y) => y.status === 'offen') ? 'transkription' : x.status
      return { segmente, status }
    }, jetzt)
    if (r) h.imHintergrund(arbeiteGespraech(admin, id, h))
    return ok({ ok: true, status: r ? segmenteVon(r).find((y) => y.nr === nr)?.status : s.status })
  }

  if (aktion === 'gespraech_marker') {
    const neu: GespraechMarker[] = []
    for (const m of Array.isArray(body.marker) ? body.marker : []) {
      const sek = zahl(m?.sek)
      const t = txt(m?.text, 300)
      if (sek === null || sek < 0) continue
      const art = ['wichtig', 'aufgabe', 'frage'].includes(m?.art) ? m.art : 'wichtig'
      neu.push({ sek: Math.round(sek * 10) / 10, text: t, art })
    }
    const r = await aendere(admin, id, (x) => {
      const liste = (Array.isArray(x.marker) ? x.marker : []) as GespraechMarker[]
      const schluessel = (m: GespraechMarker) => `${Math.round(m.sek)}|${m.art}|${m.text}`
      const vorhanden = new Set(liste.map(schluessel))
      const dazu = neu.filter((m) => !vorhanden.has(schluessel(m)) && vorhanden.add(schluessel(m)))
      if (!dazu.length) return null
      return { marker: [...liste, ...dazu].sort((a, b) => a.sek - b.sek).slice(0, 500) }
    }, jetzt)
    return ok({ ok: true, marker: (r ?? z).marker ?? [] })
  }

  if (aktion === 'gespraech_notiz') {
    const aenderung: Zeile = {}
    if (typeof body.notizen === 'string') aenderung.notizen = body.notizen.slice(0, 20_000)
    if (typeof body.titel === 'string') aenderung.titel = txt(body.titel, 200) || null
    // Gilt für Abschnitte, die noch nicht abgeschrieben sind (sonst „Neu auswerten“ mit Sprache).
    if (typeof body.sprache === 'string') aenderung.sprache = normalisiereSprachwahl(body.sprache)
    const bis = aufbewahrenBis(body.aufbewahrenTage, jetzt)
    if (bis) aenderung.aufbewahren_bis = bis
    if (body.kundeId !== undefined || body.objektId !== undefined || body.terminId !== undefined) {
      const v = await pruefeVerknuepfung(admin, aufrufer, h, { kundeId: body.kundeId, objektId: body.objektId, terminId: body.terminId })
      if (!v.ok) return v.antwort
      if (body.kundeId !== undefined || v.werte.kunde_id) Object.assign(aenderung, { kunde_id: v.werte.kunde_id ?? null, kunde_bereich: v.werte.kunde_bereich ?? null })
      if (body.objektId !== undefined) aenderung.objekt_id = v.werte.objekt_id ?? null
      if (body.terminId !== undefined) aenderung.termin_id = v.werte.termin_id ?? null
    }
    const fotos: GespraechFoto[] = []
    for (const f of Array.isArray(body.fotos) ? body.fotos : []) {
      const pfad = txt(f?.pfad, 400)
      if (!pfad.startsWith(`${ich}/${id}/foto_`)) continue
      const sek = zahl(f?.sek)
      fotos.push({ pfad, name: txt(f?.name, 200) || pfad.split('/').pop()!, ...(sek !== null ? { sek } : {}) })
    }
    const r = await aendere(admin, id, (x) => {
      const liste = (Array.isArray(x.fotos) ? x.fotos : []) as GespraechFoto[]
      const dazu = fotos.filter((f) => !liste.some((g) => g.pfad === f.pfad))
      const a = { ...aenderung, ...(dazu.length ? { fotos: [...liste, ...dazu] } : {}) }
      return Object.keys(a).length ? a : null
    }, jetzt)
    return ok({ ok: true, aufnahme: fuerAntwort(r ?? z, true) })
  }

  if (aktion === 'gespraech_abschliessen' || aktion === 'gespraech_neu_auswerten') {
    const neu = aktion === 'gespraech_neu_auswerten' || z.status === 'fehler'
    if (z.status === 'fertig' && !neu) return ok({ ok: true, aufnahme: fuerAntwort(z, true) })
    if (neu && !['fehler', 'fertig'].includes(z.status) && z.abgeschlossen_am) return fehler(409, 'Die Auswertung läuft noch.')
    const nummern = (Array.isArray(body.nummern) ? body.nummern : []).map(zahl).filter((n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n <= 9999)
    const dauer = zahl(body.dauer_s)
    const neueSprache = neu && typeof body.sprache === 'string' ? normalisiereSprachwahl(body.sprache) : null
    if (neueSprache && neueSprache !== normalisiereSprachwahl(z.sprache) && z.audio_geloescht_am) return fehler(410, 'Der Ton ist schon gelöscht — mit einer anderen Sprache lässt sich nicht mehr neu abschreiben.')
    const r = await aendere(admin, id, (x) => {
      let segmente = segmenteVon(x)
      // Abschnitte, die die App aufgenommen, aber noch nicht angemeldet hat: als „offen“ vormerken.
      for (const nr of nummern) if (!segmente.some((s) => s.nr === nr)) segmente = ersetzeSegment(segmente, { nr, pfad: '', mime: '', status: 'offen' })
      if (neu) {
        segmente = segmente.map((s) => (s.status === 'fehler' && s.pfad && !x.audio_geloescht_am ? { ...s, status: 'hochgeladen', versuche: 0, seit: null, fehler: null, mengengrenze: 0, naechster_versuch: null } : s))
      }
      // Andere Sprache gewählt: alle Abschnitte mit Ton noch einmal abschreiben.
      const sprachWechsel = !!neueSprache && neueSprache !== normalisiereSprachwahl(x.sprache) && !x.audio_geloescht_am
      if (sprachWechsel) {
        segmente = segmente.map((s) => {
          if (s.status !== 'transkribiert' || !s.pfad) return s
          const { text: _t, stuecke: _s, sprache: _sp, ...rest } = s
          return { ...rest, status: 'hochgeladen' as const, versuche: 0, seit: null, fehler: null, mengengrenze: 0, naechster_versuch: null }
        })
      }
      return {
        segmente,
        ...(dauer !== null ? { dauer_s: Math.round(dauer) } : {}),
        abgeschlossen_am: x.abgeschlossen_am ?? stempel,
        status: segmente.some((s) => s.status === 'offen') ? 'hochladen' : 'transkription',
        fehler: null,
        ...(neueSprache ? { sprache: neueSprache } : {}),
        ...(neu ? { bearbeitung: {}, gemeldet_am: null, transkript: null, uebersetzung: null, sprache_erkannt: null } : {}),
      }
    }, jetzt)
    if (!r) return fehler(404, 'Diese Aufnahme gibt es nicht mehr.')
    h.imHintergrund(arbeiteGespraech(admin, id, h))
    return ok({ ok: true, aufnahme: fuerAntwort(r, true) })
  }

  if (aktion === 'gespraech_uebersetzen') return await uebersetzeMail(admin, z, body, h)
  if (aktion === 'gespraech_teilen') return await teileMitKollegen(admin, z, aufrufer, body, h)
  if (aktion === 'gespraech_kundennotiz_vermerken') return await vermerkeKundennotiz(admin, z, aufrufer, body, h)

  if (aktion === 'gespraech_verwerfen') {
    const pfade = [...segmenteVon(z).map((s) => s.pfad), ...((Array.isArray(z.fotos) ? z.fotos : []) as GespraechFoto[]).map((f) => f.pfad)].filter((p) => typeof p === 'string' && p)
    if (pfade.length) {
      const { error } = await admin.storage.from(GESPRAECH_BUCKET).remove(pfade)
      if (error) return fehler(500, `Die Aufnahme konnte nicht gelöscht werden: ${error.message}`)
    }
    await aendere(admin, id, (x) => ({
      status: 'verworfen',
      audio_geloescht_am: x.audio_geloescht_am ?? stempel,
      segmente: segmenteVon(x).map(({ text: _t, stuecke: _s, ...s }) => ({ ...s, seit: null })),
      fotos: [],
      transkript: null,
      sprecher: null,
      analyse: null,
      bearbeitung: {},
    }), jetzt)
    return ok({ ok: true })
  }

  return fehler(400, `Unbekannte Aktion „${aktion}“.`)
}

/** gespraech_liste (ohne id): eigene Aufnahmen, oder mit kundeId/objektId alle Aufnahmen dieser Akte (mit Recht darauf). */
// deno-lint-ignore no-explicit-any
export async function gespraechListe(admin: Db, aufrufer: GespraechAufrufer, body: Record<string, any>, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  const seite = Math.max(0, Math.min(30, Math.floor(zahl(body.seite) ?? 0)))
  let q = admin.from(GESPRAECH_TABELLE).select(LISTEN_SPALTEN)
  const kundeId = txt(body.kundeId, 80)
  const objektId = txt(body.objektId, 80)
  if (kundeId) {
    if (!h.darfKunde || !(await gibtEs(admin, 'kunden', kundeId)) || !(await h.darfKunde(kundeId))) return fehler(403, 'Diese Akte ist für dich nicht freigegeben.')
    q = q.eq('kunde_id', kundeId).neq('status', 'verworfen')
  } else if (objektId) {
    if (!h.darfObjekt || !(await gibtEs(admin, 'objekte', objektId)) || !(await h.darfObjekt(objektId))) return fehler(403, 'Dieses Objekt ist für dich nicht freigegeben.')
    q = q.eq('objekt_id', objektId).neq('status', 'verworfen')
  } else {
    q = q.eq('mitarbeiter_email', aufrufer.email.toLowerCase())
    if (body.mitVerworfenen !== true) q = q.neq('status', 'verworfen')
    const terminId = txt(body.terminId, 60)
    if (terminId && UUID.test(terminId)) q = q.eq('termin_id', terminId)
  }
  // Höchstens 31 Seiten à 30 — bleibt unter der Grenze von 1000 Zeilen je Abfrage.
  const { data, error } = await q.order('erstellt_am', { ascending: false }).limit((seite + 1) * SEITE + 1)
  if (error) return fehler(500, `Liste nicht lesbar: ${error.message}`)
  const alle = (data ?? []) as Zeile[]
  const zeilen = alle.slice(seite * SEITE, (seite + 1) * SEITE).map(({ analyse, uebernommen, ...z }) => ({
    ...z,
    besitzer: String(z.mitarbeiter_email).toLowerCase() === aufrufer.email.toLowerCase(),
    zusammenfassung: typeof analyse?.zusammenfassung === 'string' ? analyse.zusammenfassung : '',
    uebernommen: !!uebernommen,
  }))
  return ok({ zeilen, weitere: alle.length > (seite + 1) * SEITE })
}

// ---------- Übersetzen (nur auf Anforderung) ----------

/** So viele Zeichen Abschrift gehen höchstens in einen Übersetzungs-Aufruf. */
export const UEBERSETZUNG_ZEICHEN = 12_000

const ABSCHRIFT_UEBERSETZEN: KiWerkzeug = {
  name: 'uebersetzung_speichern',
  description: 'Speichert die deutsche Übersetzung der nummerierten Absätze.',
  input_schema: {
    type: 'object',
    properties: {
      absaetze: {
        type: 'array',
        items: { type: 'object', properties: { nr: { type: 'integer' }, text: { type: 'string' } }, required: ['nr', 'text'] },
      },
    },
    required: ['absaetze'],
  },
}

const MAIL_UEBERSETZEN: KiWerkzeug = {
  name: 'mail_uebersetzen',
  description: 'Speichert die übersetzte Mail.',
  input_schema: { type: 'object', properties: { betreff: { type: 'string' }, text: { type: 'string' } }, required: ['betreff', 'text'] },
}

/** Kurze Prüfsumme (FNV-1a) — erkennt, ob sich der deutsche Text seit der letzten Übersetzung geändert hat. */
export function pruefsumme(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function absaetzeVon(z: Zeile): GespraechAbsatz[] {
  return (Array.isArray(z.sprecher) ? z.sprecher : []).filter((a: unknown) => a && typeof a === 'object' && typeof (a as GespraechAbsatz).text === 'string') as GespraechAbsatz[]
}

/** Hat die Abschrift Teile, die nicht Deutsch sind? */
function hatFremdsprache(z: Zeile): boolean {
  const erkannt = txt(z.sprache_erkannt, 10) || erkannteSprache(z)
  if (erkannt && erkannt !== 'de') return true
  return segmenteVon(z).some((s) => s.status === 'transkribiert' && !!s.sprache && spracheAusErkennung(s.sprache) !== 'de' && txt(s.text, 10) !== '')
}

/**
 * gespraech_uebersetzen {id} (bzw. art 'abschrift'): deutsche Fassung der Abschrift, Absatz für Absatz (Spalte sprecher).
 * Übersetzt in Teilen von höchstens UEBERSETZUNG_ZEICHEN Zeichen, so viele die Zeit dieses Aufrufs erlaubt, und speichert
 * nach jedem Teil (uebersetzung.abschrift). `fertig: false` = die App ruft noch einmal auf. Lesen dürfen alle, die die
 * Aufnahme sehen dürfen.
 */
export async function uebersetzeAbschrift(admin: Db, z: Zeile, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  if (!['fertig', 'fehler'].includes(z.status)) return fehler(409, 'Die Abschrift ist noch nicht fertig.')
  const absaetze = absaetzeVon(z)
  if (!absaetze.length) return fehler(409, 'Es gibt keine Abschrift zum Übersetzen.')
  if (!hatFremdsprache(z)) return fehler(400, 'Die Abschrift ist schon auf Deutsch.')
  const u = (z.uebersetzung && typeof z.uebersetzung === 'object' ? z.uebersetzung : {}) as GespraechUebersetzung
  const fertigListe: string[] = u.abschrift && u.abschrift.quelle === absaetze.length && Array.isArray(u.abschrift.absaetze) ? u.abschrift.absaetze.slice(0, absaetze.length).map(String) : []
  if (fertigListe.length >= absaetze.length) return ok({ absaetze: fertigListe, fertig: true })
  setzeAnlass('gespraech_uebersetzung')
  setzePerson(z.mitarbeiter_email)
  if (z.kunde_bereich === 'privat') setzePrivat()
  const start = h.jetzt()
  const budget = Math.min(110_000, h.restMs() - 15_000)
  const system = [
    'Du übersetzt die Abschrift eines Kundengesprächs der Mayer Holding ins Deutsche.',
    'Übersetze jeden nummerierten Absatz vollständig und sinngetreu in einfaches Deutsch — nichts weglassen, nichts zusammenfassen, nichts ergänzen. Absätze, die schon Deutsch sind, unverändert übernehmen. Namen, Orte, Zahlen und Beträge unverändert.',
    'Antworte ausschließlich, indem du das Werkzeug uebersetzung_speichern aufrufst, ohne weiteren Text.',
  ].join('\n')
  let hinweis = ''
  while (fertigListe.length < absaetze.length) {
    const bleibt = budget - (h.jetzt() - start)
    if (bleibt < 30_000) break
    const von = fertigListe.length
    let bis = von
    let zeichen = 0
    while (bis < absaetze.length && (bis === von || zeichen + absaetze[bis].text.length <= UEBERSETZUNG_ZEICHEN)) {
      zeichen += absaetze[bis].text.length
      bis++
    }
    const prompt = absaetze.slice(von, bis).map((a, i) => `${von + i + 1}: ${a.text}`).join('\n')
    let antwort: Record<string, unknown>
    try {
      antwort = await h.ki({ system, prompt, werkzeug: ABSCHRIFT_UEBERSETZEN, maxTokens: 16000, timeoutMs: Math.max(20_000, Math.min(100_000, bleibt - 5_000)) })
    } catch (err) {
      const meldung = err instanceof Error ? err.message : String(err)
      if (fertigListe.length === 0) return fehler(502, `Die Übersetzung ist nicht gelungen: ${meldung}`)
      hinweis = `Ein Teil der Übersetzung fehlt noch (${meldung}). Bitte später noch einmal versuchen.`
      break
    }
    const nachNr = new Map<number, string>()
    for (const e of Array.isArray(antwort.absaetze) ? antwort.absaetze : []) {
      // deno-lint-ignore no-explicit-any
      const o = e as any
      const nr = zahl(o?.nr)
      const t = typeof o?.text === 'string' ? o.text.trim() : ''
      if (nr !== null && t) nachNr.set(nr - 1, t)
    }
    for (let i = von; i < bis; i++) fertigListe.push(nachNr.get(i) ?? `[nicht übersetzt] ${absaetze[i].text}`)
    const stempel = new Date(h.jetzt()).toISOString()
    const stand = [...fertigListe]
    await aendere(admin, z.id, (r) => {
      const ru = (r.uebersetzung && typeof r.uebersetzung === 'object' ? r.uebersetzung : {}) as GespraechUebersetzung
      const alt = ru.abschrift && ru.abschrift.quelle === absaetze.length ? ru.abschrift.absaetze ?? [] : []
      if (alt.length >= stand.length) return null
      return { uebersetzung: { ...ru, abschrift: { absaetze: stand, quelle: absaetze.length, fertig: stand.length >= absaetze.length, am: stempel } } }
    }, h.jetzt()).catch((err) => console.error(`Gespräch ${z.id}: Übersetzung nicht gespeichert:`, err))
  }
  return ok({ absaetze: fertigListe, fertig: fertigListe.length >= absaetze.length, ...(hinweis ? { hinweis } : {}) })
}

/**
 * gespraech_uebersetzen {id, art: 'mail' | 'notiz', sprache, betreff, text}: deutschen Mail-Entwurf bzw. die
 * Gesprächsnotiz in die Sprache des Kunden übersetzen (nur der Besitzer). Gleicher Text → gespeicherte Übersetzung.
 */
// deno-lint-ignore no-explicit-any
export async function uebersetzeMail(admin: Db, z: Zeile, body: Record<string, any>, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  const art: 'mail' | 'notiz' = body.art === 'notiz' ? 'notiz' : 'mail'
  const ziel = spracheAusErkennung(body.sprache) ?? whisperSprache(body.sprache)
  if (!ziel || ziel === 'de') return fehler(400, 'Bitte eine andere Sprache als Deutsch wählen.')
  const betreff = txt(body.betreff, 300)
  const text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').trim().slice(0, 8000) : ''
  if (!text) return fehler(400, 'Es gibt keinen Text zum Übersetzen.')
  const schluessel = pruefsumme(`${ziel}|${betreff}|${text}`)
  const u = (z.uebersetzung && typeof z.uebersetzung === 'object' ? z.uebersetzung : {}) as GespraechUebersetzung
  const gespeichert = u[art]
  if (gespeichert && gespeichert.schluessel === schluessel) return ok({ betreff: gespeichert.betreff, text: gespeichert.text, sprache: ziel })
  setzeAnlass('gespraech_uebersetzung')
  setzePerson(z.mitarbeiter_email)
  if (z.kunde_bereich === 'privat') setzePrivat()
  const name = sprachName(ziel)
  let antwort: Record<string, unknown>
  try {
    antwort = await h.ki({
      system: [
        `Du übersetzt eine Mail der Mayer Holding an einen Kunden aus dem Deutschen in die Sprache „${name}“.`,
        'Höflich, sinngetreu und vollständig; Absätze, Aufzählungen, Anrede und Gruß beibehalten. Namen, Daten, Uhrzeiten, Beträge und Adressen unverändert. Nichts ergänzen, nichts weglassen.',
        'Antworte ausschließlich, indem du das Werkzeug mail_uebersetzen aufrufst, ohne weiteren Text.',
      ].join('\n'),
      prompt: `Betreff: ${betreff || '(ohne)'}\n\nText:\n${text}`,
      werkzeug: MAIL_UEBERSETZEN,
      maxTokens: 6000,
      timeoutMs: Math.max(20_000, Math.min(90_000, h.restMs() - 15_000)),
    })
  } catch (err) {
    return fehler(502, `Die Übersetzung ist nicht gelungen: ${err instanceof Error ? err.message : String(err)}`)
  }
  const neuBetreff = txt(antwort.betreff, 300)
  const neuText = typeof antwort.text === 'string' ? antwort.text.trim().slice(0, 12000) : ''
  if (!neuText) return fehler(502, 'Die Übersetzung ist leer zurückgekommen. Bitte noch einmal versuchen.')
  const stempel = new Date(h.jetzt()).toISOString()
  await aendere(admin, z.id, (r) => {
    const ru = (r.uebersetzung && typeof r.uebersetzung === 'object' ? r.uebersetzung : {}) as GespraechUebersetzung
    return { uebersetzung: { ...ru, [art]: { sprache: ziel, schluessel, betreff: neuBetreff, text: neuText, am: stempel } } }
  }, h.jetzt()).catch((err) => console.error(`Gespräch ${z.id}: Übersetzung nicht gespeichert:`, err))
  return ok({ betreff: neuBetreff, text: neuText, sprache: ziel })
}

// ---------- Teilen ----------

const ART_KURZ: Record<string, string> = { termin: 'Kundentermin', telefon: 'Telefonat', notiz: 'Gesprächsnotiz' }
/** Derselbe Kollege bekommt dieselbe Aufnahme frühestens nach so langer Zeit noch einmal (gegen versehentliches Doppeltippen). */
export const TEILEN_SPERRE_MS = 10 * 60_000
const HOECHSTENS_EMPFAENGER = 5

function geteiltVon(z: Zeile): GespraechGeteilt[] {
  return (Array.isArray(z.geteilt) ? z.geteilt : []).filter((g: unknown) => g && typeof g === 'object') as GespraechGeteilt[]
}

function deTag(iso: string): string {
  return iso.split('-').reverse().join('.')
}

/** Text der Telegram-Nachricht an einen Kollegen (Zusammenfassung, nächste Schritte, Link). */
export function teilenText(z: Zeile, k: Pick<Kontext, 'besitzerName' | 'akteName'>, notiz: string, jetzt: number): string {
  const a = (z.analyse ?? {}) as Partial<GespraechAnalyse>
  const tag = deTag(heuteBerlin(Date.parse(z.erstellt_am) || jetzt))
  const worum = k.akteName || txt(z.titel, 120) || 'Aufnahme'
  let zusammenfassung = typeof a.zusammenfassung === 'string' ? a.zusammenfassung.trim() : ''
  if (zusammenfassung.length > 900) zusammenfassung = `${zusammenfassung.slice(0, 899).trimEnd()}…`
  const schritte = (Array.isArray(a.naechste_schritte) ? a.naechste_schritte : []).slice(0, 5).map((s) => `- ${txt(s?.text, 200)}${s?.faellig ? ` (bis ${deTag(String(s.faellig))})` : ''}`).filter((x) => x.length > 2)
  return [
    `🎙️ ${k.besitzerName} teilt ein Gespräch mit dir: ${worum} — ${ART_KURZ[z.art] ?? 'Gespräch'} vom ${tag}`,
    notiz ? `„${notiz}“` : '',
    zusammenfassung,
    schritte.length ? `Nächste Schritte:\n${schritte.join('\n')}` : '',
    `Ansehen: ${GESPRAECH_APP_LINK}${z.id}`,
  ].filter(Boolean).join('\n\n')
}

/**
 * gespraech_teilen {id, pruefen: true} → { empfaenger: [{email, name, darf, telegram}] }
 * gespraech_teilen {id, an: [email…], notiz?} → schickt Zusammenfassung + Link per Telegram (Mayer-Bot) an Kollegen, die
 * die Akte sehen dürfen; vermerkt jede Sendung in `geteilt`. Nur fertige Aufnahmen mit (nicht privater) Akte.
 */
// deno-lint-ignore no-explicit-any
export async function teileMitKollegen(admin: Db, z: Zeile, aufrufer: GespraechAufrufer, body: Record<string, any>, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  if (z.status !== 'fertig' || !z.analyse) return fehler(409, 'Teilen geht erst, wenn die Auswertung fertig ist.')
  if (!z.kunde_id && !z.objekt_id) return fehler(409, 'Bitte zuerst eine Akte zuordnen — geteilt wird nur, was an einer Akte hängt.')
  const k = await ladeKontext(admin, z)
  if (k.privat) return fehler(409, 'Private Aufnahmen lassen sich nicht mit Kollegen teilen.')
  // Akte gelöscht oder zusammengeführt: die Rechteprüfung ließe sonst jeden Kollegen als „darf“ durch.
  if ((z.kunde_id && !k.kunde) || (!z.kunde_id && z.objekt_id && !k.objekt)) return fehler(409, 'Die zugeordnete Akte gibt es nicht mehr — bitte zuerst eine andere zuordnen.')
  const pruefer = z.kunde_id ? h.darfKundeFuer : h.darfObjektFuer
  if (!pruefer) return fehler(501, 'Teilen ist auf dem Server noch nicht eingerichtet.')
  const darf = (email: string) => pruefer(email, z.kunde_id ? String(z.kunde_id) : String(z.objekt_id)).catch(() => false)
  const ich = aufrufer.email.toLowerCase()
  const { data: teamRoh } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id, aktiv').eq('aktiv', true)
  const team = ((teamRoh ?? []) as Zeile[])
    .map((m) => ({ name: txt(m.name, 120), email: String(m.email ?? '').trim().toLowerCase(), chat: m.telegram_chat_id ?? null }))
    .filter((m) => m.email && m.email !== ich)

  if (body.pruefen === true) {
    const empfaenger = []
    for (const m of team) empfaenger.push({ email: m.email, name: m.name || m.email, darf: await darf(m.email), telegram: !!m.chat })
    empfaenger.sort((a, b) => Number(b.darf && b.telegram) - Number(a.darf && a.telegram) || a.name.localeCompare(b.name, 'de'))
    return ok({ empfaenger })
  }

  const an = [...new Set((Array.isArray(body.an) ? body.an : typeof body.an === 'string' ? [body.an] : []).map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter(Boolean))] as string[]
  if (!an.length) return fehler(400, 'Bitte mindestens einen Kollegen auswählen.')
  if (an.length > HOECHSTENS_EMPFAENGER) return fehler(400, `Bitte höchstens ${HOECHSTENS_EMPFAENGER} Kollegen auf einmal auswählen.`)
  const notiz = txt(body.notiz, 500).replace(/\s+/g, ' ')
  const jetzt = h.jetzt()
  const text = teilenText(z, k, notiz, jetzt)
  const bisher = geteiltVon(z)
  const gesendet: string[] = []
  const nicht: { name: string; grund: string }[] = []
  const neu: GespraechGeteilt[] = []
  for (const email of an) {
    const m = team.find((x) => x.email === email)
    if (!m) {
      nicht.push({ name: email, grund: email === ich ? 'das bist du selbst' : 'kein aktiver Mitarbeiter' })
      continue
    }
    const name = m.name || m.email
    if (!(await darf(m.email))) {
      nicht.push({ name, grund: 'darf diese Akte nicht sehen' })
      continue
    }
    if (!m.chat) {
      nicht.push({ name, grund: 'hat Telegram nicht verbunden' })
      continue
    }
    if (bisher.some((g) => g.art === 'kollege' && g.an === m.email && g.ok && jetzt - Date.parse(g.am) < TEILEN_SPERRE_MS)) {
      nicht.push({ name, grund: 'hat sie gerade eben schon bekommen' })
      continue
    }
    const zugestellt = await h.sendeTelegram(m.chat, text).catch(() => false)
    neu.push({ art: 'kollege', an: m.email, name, am: new Date(jetzt).toISOString(), von: aufrufer.name || ich, ok: zugestellt })
    if (zugestellt) gesendet.push(name)
    else nicht.push({ name, grund: 'Telegram hat die Nachricht nicht angenommen' })
  }
  if (neu.length) {
    await aendere(admin, z.id, (r) => ({ geteilt: [...geteiltVon(r), ...neu].slice(-100) }), h.jetzt()).catch((err) => console.error(`Gespräch ${z.id}: Teilen nicht vermerkt:`, err))
  }
  return ok({ gesendet, nicht })
}

/**
 * gespraech_kundennotiz_vermerken {id, an, betreff, sprache?}: Die App hat die Gesprächsnotiz über den normalen
 * Versand des CRM (Aktion send, mit Signatur, landet in gesendete_emails) verschickt; hier kommt der Eintrag in den
 * Verlauf der Akte und in `geteilt`. Ein zweiter gleicher Aufruf binnen zwei Minuten trägt nichts doppelt ein.
 */
// deno-lint-ignore no-explicit-any
export async function vermerkeKundennotiz(admin: Db, z: Zeile, aufrufer: GespraechAufrufer, body: Record<string, any>, hilfen: GespraechHilfen): Promise<Antwort> {
  const h = mitStandard(admin, hilfen)
  const kundeId = txt(z.kunde_id, 80)
  if (!kundeId) return fehler(409, 'Die Aufnahme hängt an keiner Akte.')
  if (!h.darfKunde || !(await h.darfKunde(kundeId))) return fehler(403, 'Diese Akte ist für dich nicht freigegeben.')
  const an = txt(body.an, 300)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an.split(/[,;]/)[0].trim())) return fehler(400, 'Die Empfänger-Adresse fehlt oder ist ungültig.')
  const betreff = txt(body.betreff, 300) || 'Gesprächsnotiz'
  const sprache = spracheAusErkennung(body.sprache)
  const jetzt = h.jetzt()
  if (geteiltVon(z).some((g) => g.art === 'kunde' && g.an === an && g.betreff === betreff && jetzt - Date.parse(g.am) < 120_000)) return ok({ ok: true, schon: true })
  const heute = heuteBerlin(jetzt)
  const worum = txt(z.titel, 120) || `${ART_KURZ[z.art] ?? 'Gespräch'} vom ${deTag(heuteBerlin(Date.parse(z.erstellt_am) || jetzt))}`
  const eintrag = {
    id: crypto.randomUUID(),
    date: heute,
    text: `Gesprächsnotiz zur Aufnahme „${worum}“ an ${an} geschickt — Betreff: ${betreff}${sprache && sprache !== 'de' ? ` (auf ${sprachName(sprache)})` : ''}.`,
    user: aufrufer.name || aufrufer.email,
  }
  // Verlauf frisch lesen und nur ihn (plus letzte Aktivität) schreiben.
  const { data: akte, error } = await admin.from('kunden').select('id, activities').eq('id', kundeId).maybeSingle()
  if (error || !akte) return fehler(500, `Die Akte ließ sich nicht lesen: ${error?.message ?? 'nicht gefunden'}. Die Mail ist trotzdem verschickt.`)
  const { error: e2 } = await admin.from('kunden').update({ activities: [eintrag, ...(Array.isArray(akte.activities) ? akte.activities : [])], letzte_aktivitaet: heute }).eq('id', kundeId)
  if (e2) return fehler(500, `Der Verlaufseintrag ließ sich nicht speichern: ${e2.message}. Die Mail ist trotzdem verschickt.`)
  const vermerk: GespraechGeteilt = { art: 'kunde', an, betreff, am: new Date(jetzt).toISOString(), von: aufrufer.name || aufrufer.email, ...(sprache ? { sprache } : {}) }
  await aendere(admin, z.id, (r) => ({ geteilt: [...geteiltVon(r), vermerk].slice(-100) }), h.jetzt()).catch((err) => console.error(`Gespräch ${z.id}: Kundennotiz nicht vermerkt:`, err))
  return ok({ ok: true })
}
