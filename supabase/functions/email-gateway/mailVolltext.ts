// Einmaliges Nachladen des vollen Mailtexts für alte Mails im gemeinsamen Postfach (22.11.2026).
//
// Zwei Wege haben den Text eingehender Mails bisher nach 500 Zeichen abgeschnitten (`ausschnitt`):
// - der IMAP-Umzug vom Oktober/November 2026 (scripts/migrate-inbox.mjs, `rohdaten.quelle = 'imap-migration'`,
//   `rohdaten.uid` = Nummer der Mail im Posteingang von info@amayer-holding.com),
// - der Eingang über den Weiterleitungsdienst (supabase/functions/inbound-email, `rohdaten` ohne `quelle`) —
//   dort liegt der volle Text aber noch in `rohdaten.plain` / `rohdaten.html`.
// Signaturen (Telefon, Anschrift) und der eigentliche Inhalt fehlten deshalb in Postfach, Akte, Assistent
// und Stammdaten-Ergänzung.
//
// Dieses Modul holt den vollen Text nach: Umzugs-Mails per IMAP aus dem Hauptpostfach (nur lesend, der
// Ordner wird schreibgeschützt geöffnet; Zugang genau wie beim Postfach-Abruf), Weiterleitungs-Mails aus
// ihren eigenen Rohdaten (ohne Netz). Geändert wird nur `ausschnitt` (bis 20 000 Zeichen wie beim
// Postfach-Abruf) und ein Vermerk `rohdaten.volltext` — der Vermerk sorgt dafür, dass jede Mail genau
// einmal drankommt (fortsetzbar, beliebig oft aufrufbar). Eine HTML-Spalte hat die Tabelle nicht.
//
// Abgeschnitten heißt: der Text ist genau 499 oder 500 Zeichen lang (in JavaScript gezählt, so wie
// `slice(0, 500)` ihn erzeugt hat). Mails, die von Natur aus so kurz sind, bekommen nur den Vermerk.
import { ImapFlow } from 'npm:imapflow@1'
import { entschluessele } from '../_shared/geheim.ts'
import { gliedereGesendet, textAusHtml } from './gesendetAbruf.ts'
import { kennungNorm } from './mailZuordnung.ts'
import { ladePostfach, STANDARD_ID, stelleStandardSicher, type Postfach } from './postfach.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Teil = any

/** Höchstlänge des gespeicherten Texts — wie beim Postfach-Abruf (postfach.ts). */
export const TEXT_HOECHSTENS = 20000
/** So viele Bytes des Textteils werden höchstens geladen (wie postfach.ts). */
const TEXTTEIL_BYTES = 300 * 1024
/** Vorauswahl in der Datenbank: 470 bis 500 Zeichen (Postgres zählt Emojis als ein Zeichen, JavaScript als zwei).
 *  Längere Texte sind nie gekürzt — so fallen auch künftige, ungekürzt gespeicherte Mails gar nicht erst hinein. */
export const VORAUSWAHL_MUSTER = `${'_'.repeat(470)}%`
export const ZU_LANG_MUSTER = `${'_'.repeat(501)}%`
/** Weiterleitungs-Mails erst nach zehn Minuten anfassen — dann ist der Eingang mit Zuordnung sicher durch. */
const WEITERLEITUNG_MINDESTALTER_MS = 10 * 60 * 1000

export type Art = 'migration' | 'weiterleitung'
export type Kandidat = { id: string; art: Art; message_id: string; betreff: string; ausschnitt: string; uid: number | null }
export type Ergebnis = 'ergaenzt' | 'unveraendert' | 'vollstaendig' | 'nicht_gefunden' | 'ohne_text' | 'fehler'
export type Vermerk = { am: string; ergebnis: Ergebnis; vorher: number; nachher: number }

/** Wurde dieser Text beim Speichern auf 500 Zeichen gekürzt? */
export function istAbgeschnitten(ausschnitt: string | null | undefined): boolean {
  const n = String(ausschnitt ?? '').length
  return n === 499 || n === 500
}

/** Voller Text einer Weiterleitungs-Mail aus ihren Rohdaten (gleiche Reihenfolge wie inbound-email: plain, reply_plain, html). */
export function textAusWeiterleitung(roh: { plain?: string | null; reply?: string | null; html?: string | null } | null | undefined): string {
  const plain = String(roh?.plain ?? '').trim() || String(roh?.reply ?? '').trim()
  if (plain) return plain
  const html = String(roh?.html ?? '')
  return html ? textAusHtml(html) : ''
}

/** Neuer Text für `ausschnitt` — nur wenn er wirklich länger ist als der gespeicherte (sonst null). */
export function besserer(alt: string, neu: string): string | null {
  const n = neu.trim().slice(0, TEXT_HOECHSTENS)
  return n.length > alt.trim().length ? n : null
}

// ---------------------------------------------------------------------------------------------------
// Datenbank
// ---------------------------------------------------------------------------------------------------

export type VolltextSpeicher = {
  /** Noch nicht vermerkte Mails der Art mit 470 bis 500 Zeichen, älteste zuerst. */
  kandidaten(art: Art, grenze: number, ab?: number): Promise<Kandidat[]>
  /** Wie viele davon noch offen sind (ohne Prüfung auf genau 499/500). */
  offen(art: Art): Promise<number>
  /** Rohtext einer Weiterleitungs-Mail. */
  weiterleitung(id: string): Promise<{ plain?: string | null; reply?: string | null; html?: string | null } | null>
  /** Vermerk setzen und wahlweise den Text ersetzen (Rohdaten frisch gelesen und zusammengeführt). */
  vermerke(id: string, vermerk: Vermerk, ausschnitt?: string): Promise<void>
}

export function datenbankSpeicher(admin: Db, jetzt: () => number = Date.now): VolltextSpeicher {
  const basis = (spalten: string, opts?: { count: 'exact'; head: true }) =>
    admin.from('eingegangene_emails').select(spalten, opts).is('besitzer_email', null).is('rohdaten->volltext', null).like('ausschnitt', VORAUSWAHL_MUSTER).not('ausschnitt', 'like', ZU_LANG_MUSTER)
  // deno-lint-ignore no-explicit-any
  const nachArt = (q: any, art: Art) =>
    art === 'migration'
      ? q.eq('rohdaten->>quelle', 'imap-migration')
      : q.is('rohdaten->>quelle', null).lt('erstellt_am', new Date(jetzt() - WEITERLEITUNG_MINDESTALTER_MS).toISOString())
  return {
    async kandidaten(art, grenze, ab = 0) {
      const { data, error } = await nachArt(basis('id, message_id, betreff, ausschnitt, uid:rohdaten->>uid'), art).order('erstellt_am').order('id').range(ab, ab + grenze - 1)
      if (error) throw new Error(`Mails nicht lesbar: ${error.message}`)
      return ((data ?? []) as { id: string; message_id: string | null; betreff: string | null; ausschnitt: string | null; uid: string | null }[]).map((z) => ({
        id: z.id,
        art,
        message_id: String(z.message_id ?? ''),
        betreff: String(z.betreff ?? ''),
        ausschnitt: String(z.ausschnitt ?? ''),
        uid: Number(z.uid) > 0 ? Number(z.uid) : null,
      }))
    },
    async offen(art) {
      const { count, error } = await nachArt(basis('id', { count: 'exact', head: true }), art)
      if (error) throw new Error(`Mails nicht zählbar: ${error.message}`)
      return Number(count ?? 0)
    },
    async weiterleitung(id) {
      const { data, error } = await admin.from('eingegangene_emails').select('plain:rohdaten->>plain, reply:rohdaten->>reply_plain, html:rohdaten->>html').eq('id', id).maybeSingle()
      if (error) throw new Error(`Mail nicht lesbar: ${error.message}`)
      return data ?? null
    },
    async vermerke(id, vermerk, ausschnitt) {
      // Rohdaten unmittelbar vor dem Schreiben frisch lesen und nur den Vermerk ergänzen.
      const { data, error } = await admin.from('eingegangene_emails').select('rohdaten').eq('id', id).maybeSingle()
      if (error) throw new Error(`Mail nicht lesbar: ${error.message}`)
      if (!data) return
      const roh = data.rohdaten && typeof data.rohdaten === 'object' && !Array.isArray(data.rohdaten) ? data.rohdaten : {}
      if (roh.volltext) return // ein gleichzeitiger Lauf war schneller
      const aenderung: Record<string, unknown> = { rohdaten: { ...roh, volltext: vermerk } }
      if (ausschnitt !== undefined) aenderung.ausschnitt = ausschnitt
      const { error: schreibFehler } = await admin.from('eingegangene_emails').update(aenderung).eq('id', id).is('rohdaten->volltext', null)
      if (schreibFehler) throw new Error(`Mail nicht gespeichert: ${schreibFehler.message}`)
    },
  }
}

// ---------------------------------------------------------------------------------------------------
// Mail-Server (nur lesend)
// ---------------------------------------------------------------------------------------------------

export type Fund = { text: string } | { fehlt: true }
export type TextQuelle = { hole(k: Kandidat): Promise<Fund>; schliesse(): Promise<void>; nutzbar(): boolean }

function zeitlimit<T>(versprechen: Promise<T>, ms: number, meldung: string): Promise<T> {
  let uhr: ReturnType<typeof setTimeout> | undefined
  const grenze = new Promise<T>((_, ablehnen) => {
    uhr = setTimeout(() => ablehnen(new Error(meldung)), ms)
  })
  return Promise.race([versprechen, grenze]).finally(() => clearTimeout(uhr))
}

// Passwort genau wie postfach.ts (passwortVon, dort nicht exportiert): Function-Secret beim Hauptpostfach,
// sonst verschlüsselt in postfach_geheimnisse. Wird nie protokolliert oder zurückgegeben.
async function passwortVon(admin: Db, p: Postfach): Promise<string> {
  if (p.geheimnis_name) {
    const wert = Deno.env.get(p.geheimnis_name)
    if (!wert) throw new Error(`Für das Postfach ${p.adresse} ist kein Passwort hinterlegt.`)
    return wert
  }
  const { data } = await admin.from('postfach_geheimnisse').select('verschluesselt').eq('postfach_id', p.id).maybeSingle()
  if (!data?.verschluesselt) throw new Error(`Für das Postfach ${p.adresse} ist kein Passwort hinterlegt — bitte neu verbinden.`)
  try {
    return await entschluessele(data.verschluesselt)
  } catch {
    throw new Error(`Das hinterlegte Passwort für ${p.adresse} ist nicht mehr lesbar — bitte das Postfach neu verbinden.`)
  }
}

function alsText(bytes: Uint8Array, zeichensatz?: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder(zeichensatz || 'windows-1252').decode(bytes)
    } catch {
      return new TextDecoder('windows-1252').decode(bytes)
    }
  }
}

// deno-lint-ignore no-explicit-any
async function ladeText(client: any, uid: number, teil: Teil): Promise<string> {
  const antwort = await client.download(String(uid), teil.part ?? '1', { uid: true, maxBytes: TEXTTEIL_BYTES })
  if (!antwort?.content) return ''
  const stuecke: Uint8Array[] = []
  let laenge = 0
  for await (const stueck of antwort.content) {
    const b = stueck instanceof Uint8Array ? stueck : new TextEncoder().encode(String(stueck))
    stuecke.push(b)
    laenge += b.length
  }
  const bytes = new Uint8Array(laenge)
  let stelle = 0
  for (const b of stuecke) {
    bytes.set(b, stelle)
    stelle += b.length
  }
  return alsText(bytes, antwort.meta?.charset ?? teil.parameters?.charset)
}

/** Nur für Tests: nachgebauter Mail-Server statt ImapFlow. */
// deno-lint-ignore no-explicit-any
export type ImapFabrik = (p: Postfach, passwort: string) => any

/** Öffnet den Posteingang des Hauptpostfachs schreibgeschützt (aus ihm stammen alle Umzugs-Mails). */
export async function oeffneImapQuelle(admin: Db, fabrik?: ImapFabrik): Promise<TextQuelle> {
  await stelleStandardSicher(admin)
  const p = await ladePostfach(admin, STANDARD_ID)
  if (!p) throw new Error('Das Hauptpostfach ist nicht eingerichtet.')
  const passwort = await passwortVon(admin, p)
  const client = fabrik
    ? fabrik(p, passwort)
    : new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: passwort }, logger: false })
  client.on?.('error', () => {})
  try {
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')
  } catch (err) {
    // deno-lint-ignore no-explicit-any
    const e = err as any
    try {
      client.close?.()
    } catch {
      // schon zu
    }
    throw new Error(e?.authenticationFailed ? 'Anmeldung am Hauptpostfach abgelehnt.' : String(e?.message ?? err))
  }
  const sperre = await zeitlimit(client.getMailboxLock('INBOX', { readOnly: true }), 20000, 'Der Posteingang ließ sich nicht öffnen.') as { release(): void }

  const lies = async (uid: number) => {
    type Gelesen = { uid: number; envelope?: { messageId?: string }; bodyStructure?: Teil }
    const n = await zeitlimit<Gelesen | false | null>(client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true }), 20000, 'Der Mail-Server hat die Mail nicht rechtzeitig geliefert.')
    return n && n.uid ? n : null
  }

  return {
    nutzbar: () => client.usable !== false,
    async hole(k) {
      const soll = kennungNorm(k.message_id)
      const ohneKennung = !soll || k.message_id.startsWith('imap-uid-')
      const passt = (n: { envelope?: { messageId?: string } } | null) =>
        !!n && (ohneKennung ? !n.envelope?.messageId || k.message_id === `imap-uid-${(n as { uid?: number }).uid}` : kennungNorm(n.envelope?.messageId) === soll)
      // Erst über die gemerkte Nummer, bei Abweichung (Mail verschoben, Nummern neu vergeben) über die Message-ID.
      let n = k.uid ? await lies(k.uid) : null
      if (!passt(n)) {
        n = null
        if (!ohneKennung) {
          const treffer = await zeitlimit(client.search({ header: { 'message-id': k.message_id } }, { uid: true }), 20000, 'Die Suche auf dem Mail-Server dauerte zu lange.') as number[] | false
          for (const uid of [...(treffer || [])].reverse()) {
            const kandidat = await lies(Number(uid))
            if (passt(kandidat)) {
              n = kandidat
              break
            }
          }
        }
      }
      if (!n) return { fehlt: true }
      const { text, html } = gliedereGesendet(n.bodyStructure)
      const quelle = text ?? html
      if (!quelle) return { text: '' }
      const roh = await zeitlimit(ladeText(client, n.uid, quelle), 30000, 'Der Mail-Server hat den Text der Mail nicht rechtzeitig geliefert.')
      return { text: quelle === text ? roh.trim() : textAusHtml(roh) }
    },
    async schliesse() {
      try {
        sperre.release()
      } catch {
        // schon freigegeben
      }
      await client.logout?.().catch?.(() => {})
    },
  }
}

// ---------------------------------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------------------------------

export type LaufOptionen = {
  /** Nur lesen: zählen und eine Probe nachladen, nichts schreiben (Vorgabe false). */
  trockenlauf?: boolean
  /** Höchstens so viele Weiterleitungs-Mails je Lauf (ohne Netz). */
  weiterleitungen?: number
  /** Höchstens so viele Umzugs-Mails je Lauf (je Mail ein Abruf beim Mail-Server). */
  migrationen?: number
  /** Zeit für den Lauf. */
  budgetMs?: number
  /** Trockenlauf: so viele Mails je Art probeweise nachladen (Vorgabe 5, höchstens 20). */
  probe?: number
  speicher?: VolltextSpeicher
  /** Statt des echten Mail-Servers (Tests). */
  quelle?: () => Promise<TextQuelle>
  jetzt?: () => Date
}

export type Probe = { id: string; art: Art; betreff: string; ergebnis: Ergebnis; vorher: number; nachher: number; ende?: string }

export type LaufErgebnis = {
  trockenlauf: boolean
  /** Nur Trockenlauf: wie viele Mails abgeschnitten sind (und nachgeladen würden). */
  abgeschnitten?: { migration: number; weiterleitung: number }
  /** Nur Trockenlauf: Mails mit 470–498 Zeichen — vollständig, bekommen nur den Vermerk. */
  vollstaendig?: { migration: number; weiterleitung: number }
  probe?: Probe[]
  ergaenzt: number
  unveraendert: number
  nichtGefunden: number
  fehler: string[]
  /** Danach noch offen (beide Arten zusammen, grob). */
  offen: number
}

function istVerbindungsfehler(err: unknown, quelle: TextQuelle | null): boolean {
  const meldung = String((err as Error)?.message ?? err)
  return (quelle !== null && !quelle.nutzbar()) || /rechtzeitig|dauerte zu lange|nicht geantwortet|Zeitüberschreitung/.test(meldung)
}

async function bearbeite(
  k: Kandidat,
  speicher: VolltextSpeicher,
  holeQuelle: () => Promise<TextQuelle>,
  schreiben: boolean,
  am: string,
): Promise<{ ergebnis: Ergebnis; nachher: number; text?: string }> {
  const vorher = k.ausschnitt.length
  let ergebnis: Ergebnis
  let neu: string | null = null
  if (!istAbgeschnitten(k.ausschnitt)) {
    ergebnis = 'vollstaendig'
  } else {
    let fund: Fund
    if (k.art === 'weiterleitung') fund = { text: textAusWeiterleitung(await speicher.weiterleitung(k.id)) }
    else fund = await (await holeQuelle()).hole(k)
    if ('fehlt' in fund) ergebnis = 'nicht_gefunden'
    else if (!fund.text.trim()) ergebnis = 'ohne_text'
    else {
      neu = besserer(k.ausschnitt, fund.text)
      ergebnis = neu ? 'ergaenzt' : 'unveraendert'
    }
  }
  const nachher = neu ? neu.length : vorher
  if (schreiben) await speicher.vermerke(k.id, { am, ergebnis, vorher, nachher }, neu ?? undefined)
  return { ergebnis, nachher, text: neu ?? undefined }
}

/** Ein Schritt des Nachladens. Wirft nie; Fehler stehen in `fehler`. */
export async function ladeVolltexteNach(admin: Db, opts: LaufOptionen = {}): Promise<LaufErgebnis> {
  const beginn = Date.now()
  const trockenlauf = opts.trockenlauf === true
  const budgetMs = opts.budgetMs ?? 40000
  const speicher = opts.speicher ?? datenbankSpeicher(admin)
  const jetzt = opts.jetzt ?? (() => new Date())
  const ergebnis: LaufErgebnis = { trockenlauf, ergaenzt: 0, unveraendert: 0, nichtGefunden: 0, fehler: [], offen: 0 }
  let quelle: TextQuelle | null = null
  let quelleKaputt = false
  const holeQuelle = async (): Promise<TextQuelle> => {
    if (quelleKaputt) throw new Error('Mail-Server nicht erreichbar.')
    if (!quelle) {
      try {
        quelle = await (opts.quelle ? opts.quelle() : oeffneImapQuelle(admin))
      } catch (err) {
        quelleKaputt = true
        throw err
      }
    }
    return quelle
  }
  const zaehle = (e: Ergebnis) => {
    if (e === 'ergaenzt') ergebnis.ergaenzt++
    else if (e === 'nicht_gefunden') ergebnis.nichtGefunden++
    else if (e !== 'fehler') ergebnis.unveraendert++
  }

  try {
    if (trockenlauf) {
      // Zählen über alle offenen Mails (seitenweise, Supabase liefert höchstens 1000 Zeilen je Abfrage).
      ergebnis.abgeschnitten = { migration: 0, weiterleitung: 0 }
      ergebnis.vollstaendig = { migration: 0, weiterleitung: 0 }
      ergebnis.probe = []
      const probeJe = Math.max(0, Math.min(Number(opts.probe ?? 5), 20))
      for (const art of ['weiterleitung', 'migration'] as const) {
        const proben: Kandidat[] = []
        for (let ab = 0; ; ab += 500) {
          const seite = await speicher.kandidaten(art, 500, ab)
          for (const k of seite) {
            if (istAbgeschnitten(k.ausschnitt)) {
              ergebnis.abgeschnitten[art]++
              if (proben.length < probeJe) proben.push(k)
            } else ergebnis.vollstaendig[art]++
          }
          if (seite.length < 500) break
        }
        for (const k of proben) {
          if (Date.now() - beginn > budgetMs) break
          try {
            const r = await bearbeite(k, speicher, holeQuelle, false, jetzt().toISOString())
            zaehle(r.ergebnis)
            ergebnis.probe.push({ id: k.id, art, betreff: k.betreff, ergebnis: r.ergebnis, vorher: k.ausschnitt.length, nachher: r.nachher, ende: r.text ? r.text.slice(-120) : undefined })
          } catch (err) {
            ergebnis.fehler.push(`${art} ${k.id}: ${String((err as Error)?.message ?? err)}`)
            if (art === 'migration' && (quelleKaputt || istVerbindungsfehler(err, quelle))) break
          }
        }
      }
      ergebnis.offen = ergebnis.abgeschnitten.migration + ergebnis.abgeschnitten.weiterleitung + ergebnis.vollstaendig.migration + ergebnis.vollstaendig.weiterleitung
      return ergebnis
    }

    // Erst die Weiterleitungs-Mails (ohne Netz), dann die Umzugs-Mails über den Mail-Server.
    const grenzen: Record<Art, number> = { weiterleitung: Math.max(0, opts.weiterleitungen ?? 40), migration: Math.max(0, opts.migrationen ?? 8) }
    for (const art of ['weiterleitung', 'migration'] as const) {
      if (grenzen[art] === 0) continue
      const liste = await speicher.kandidaten(art, grenzen[art])
      for (const k of liste) {
        if (Date.now() - beginn > budgetMs) break
        try {
          zaehle((await bearbeite(k, speicher, holeQuelle, true, jetzt().toISOString())).ergebnis)
        } catch (err) {
          const meldung = String((err as Error)?.message ?? err)
          // Verbindung weg oder Zeitgrenze: nichts vermerken, der nächste Lauf versucht es erneut.
          if (art === 'migration' && (quelleKaputt || istVerbindungsfehler(err, quelle))) {
            ergebnis.fehler.push(`Mail-Server: ${meldung}`)
            break
          }
          // Liegt es an der Mail selbst: vermerken, damit sie den Lauf nicht immer wieder aufhält.
          ergebnis.fehler.push(`${art} ${k.id}: ${meldung}`)
          try {
            await speicher.vermerke(k.id, { am: jetzt().toISOString(), ergebnis: 'fehler', vorher: k.ausschnitt.length, nachher: k.ausschnitt.length })
          } catch {
            // dann eben beim nächsten Lauf
          }
        }
      }
    }
    ergebnis.offen = (await speicher.offen('weiterleitung')) + (await speicher.offen('migration'))
  } catch (err) {
    ergebnis.fehler.push(String((err as Error)?.message ?? err))
  } finally {
    if (quelle) await (quelle as TextQuelle).schliesse().catch(() => {})
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------------
// Minutentakt
// ---------------------------------------------------------------------------------------------------

let laeuft = false
let ruhtBis = 0

/**
 * Schritt im Minutentakt (termin_erinnerungen): ein paar Mails je Lauf, bis nichts mehr offen ist. Danach
 * schaut der Schritt nur noch alle 30 Minuten nach (neue gekürzte Weiterleitungs-Mails, solange inbound-email
 * noch kürzt). Nach einem Fehler des Mail-Servers zehn Minuten Pause. Nie zwei Läufe gleichzeitig in einem
 * Arbeiter. Wirft nie.
 */
export async function volltextMinutenSchritt(admin: Db, opts: LaufOptionen = {}): Promise<LaufErgebnis | null> {
  const jetzt = Date.now()
  if (laeuft || jetzt < ruhtBis) return null
  laeuft = true
  try {
    const r = await ladeVolltexteNach(admin, { weiterleitungen: 40, migrationen: 8, budgetMs: 35000, ...opts, trockenlauf: false })
    if (r.fehler.some((f) => f.startsWith('Mail-Server:'))) ruhtBis = Date.now() + 10 * 60 * 1000
    else if (r.offen === 0) ruhtBis = Date.now() + 30 * 60 * 1000
    return r
  } catch {
    return null
  } finally {
    laeuft = false
  }
}

/** Nur für Tests: Zustand des Minutentakts zurücksetzen. */
export function _setzeMinutenZustandZurueck(): void {
  laeuft = false
  ruhtBis = 0
}
