// Täglicher Kontrollbericht „Mitarbeiter X an Empfänger Y“ per Telegram (Entscheidung Eray, 23.11.2026; erster
// Eintrag: Quirin Lutzenberger → Hasan Süslü, der Quirins Arbeit kontrolliert). Quirin ist informiert — das regelt die
// Geschäftsführung selbst, nicht dieser Code.
//
// Was: werktags ab der eingestellten Stunde (Vorgabe 18 Uhr Berliner Zeit) einmal am Tag eine KURZE Nachricht (höchstens
// rund zehn Zeilen) nur aus Zahlen des Tages:
//   - Mails im Bereichspostfach, das der Mitarbeiter betreut (postfaecher.verantwortlich_email): heute eingegangen,
//     heute daraus beantwortet (gesendete_emails dieses Postfachs), unbeantwortet älter als 2 Tage (letzte 30 Tage,
//     ohne Rundschreiben/Systemabsender/Kollegen; „beantwortet“ = danach ging irgendeine Mail an diese Adresse);
//   - To-dos: heute erledigt / überfällig (eigene Liste ohne Microsoft-Aufgaben + Bereichslisten, wo er zuständig ist —
//     wie die Morgen-Übersicht in tagesmeldung.ts);
//   - Objekte heute bearbeitet (Verlaufseinträge von ihm, Kurzprüfung mit heutigem Datum an seinen Objekten, Bewertung
//     von ihm gestartet, Exposé laut Verlauf) — private Objekte zählen nie;
//   - Zeiterfassung und Tagesablauf von heute;
//   - Aktivität: Minuten im CRM (Messung im Browser, nutzung_minuten) und Anfragen an den Telegram-Assistenten
//     (ki_verbrauch, person = seine Adresse, anlass 'telegram'; Aufrufe mit weniger als 90 s Abstand zählen als eine Anfrage).
// Keine KI, keine Kosten, keine Kundennamen.
//
// Einstellung: abteilung_eintraege id `kontrollbericht_einstellung`
//   daten = { an: boolean, stunde: number, eintraege: [{ mitarbeiter: E-Mail, empfaenger: E-Mail, an: boolean }] }
// Fehlt die Zeile oder ist nichts eingeschaltet, geht NICHTS raus. Gesendet wird über den Mayer-Bot (sendeTelegram aus
// kalender.ts, mitarbeiter.telegram_chat_id des Empfängers) — nie über einen privaten Bot.
// Einmal je Tag: Buchhaltungszeile id `kontrollbericht_stand` daten = { datum, zustand, versuche, am, gesendet: [...] },
// beansprucht mit bedingter Änderung auf updated_at (wie wochenrueckblick.ts). Beide Zeilen liest und schreibt nur der
// Server; angemeldete Nutzer sperrt eine einschränkende Regel aus (supabase/sql/runde6_immo_postfach.sql).
// Vorschau ohne Senden: Aktion `kontrollbericht_test` (nur Dienstschlüssel oder Superuser).
// Wirft nie im Minutentakt.

import { berlinTagesbeginn, berlinZeit, gehoertZu } from './tagesmeldung.ts'
import { alsIso, lageVon } from '../_shared/aufgabenKern.ts'
import { rundschreibenHinweise } from './mailZuordnung.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Db = any
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

const TABELLE = 'abteilung_eintraege'
export const EINSTELLUNG_ID = 'kontrollbericht_einstellung'
export const STAND_ID = 'kontrollbericht_stand'
const NEUER_VERSUCH_NACH_MS = 10 * 60_000
const HOECHSTENS_VERSUCHE = 3
const EINSTELLUNG_CACHE_MS = 10 * 60_000
const UNBEANTWORTET_NACH_TAGE = 2
const UNBEANTWORTET_FENSTER_TAGE = 30
const TELEGRAM_ABSTAND_MS = 90_000
const INTERNE_DOMAINS = ['amayer-holding.com', 'fundament-it.de']

export type Eintrag = { mitarbeiter: string; empfaenger: string; an: boolean }
export type Einstellung = { an: boolean; stunde: number; eintraege: Eintrag[] }

function alsObjekt(w: unknown): Record<string, unknown> | null {
  return w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>) : null
}
function text(w: unknown): string {
  return typeof w === 'string' ? w : w == null ? '' : String(w)
}
function adresse(w: unknown): string {
  return text(w).trim().toLowerCase()
}

export function normalisiereEinstellung(roh: unknown): Einstellung {
  const o = alsObjekt(roh) ?? {}
  const stunde = Number(o.stunde)
  const eintraege = (Array.isArray(o.eintraege) ? o.eintraege : [])
    .map((x) => alsObjekt(x))
    .filter((x): x is Record<string, unknown> => !!x)
    .map((x) => ({ mitarbeiter: adresse(x.mitarbeiter), empfaenger: adresse(x.empfaenger), an: x.an !== false }))
    .filter((x) => x.mitarbeiter.includes('@') && x.empfaenger.includes('@'))
  return { an: o.an === true, stunde: Number.isInteger(stunde) && stunde >= 0 && stunde <= 23 ? stunde : 18, eintraege }
}

export async function ladeEinstellung(admin: Db): Promise<Einstellung> {
  const { data, error } = await admin.from(TABELLE).select('daten').eq('id', EINSTELLUNG_ID).maybeSingle()
  if (error) throw new Error(`Einstellung nicht lesbar: ${error.message}`)
  return normalisiereEinstellung(data?.daten)
}

let cache: { am: number; e: Einstellung } | null = null
async function einstellungImTakt(admin: Db, jetzt: Date): Promise<Einstellung> {
  if (cache && jetzt.getTime() - cache.am < EINSTELLUNG_CACHE_MS) return cache.e
  const e = await ladeEinstellung(admin)
  cache = { am: jetzt.getTime(), e }
  return e
}
/** Nur für Tests. */
export function vergissEinstellung(): void {
  cache = null
}

/** Werktag (Mo–Fr) ab der eingestellten Stunde bis Mitternacht. */
export function imFenster(e: Einstellung, jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return e.an && b.wochentag >= 1 && b.wochentag <= 5 && b.stunde >= e.stunde
}

// ---------------------------------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------------------------------

export type Person = { name: string; email: string }

export type KontrollDaten = {
  datum: string
  /** Adressen der Bereichspostfächer, die die Person betreut (leer = kein Mail-Teil). */
  postfaecher: string[]
  mailsNeu: number
  mailsBeantwortet: number
  mailsOffen: number
  /** Älteste unbeantwortete Mail (Tage seit Eingang), null wenn keine. */
  aeltesteOffenTage: number | null
  todosErledigt: number
  todosUeberfaellig: number
  objekte: { bearbeitet: number; kurzpruefung: number; bewertung: number; expose: number; verlauf: number }
  zeit: { eintraege: number; minuten: number }
  tagesplan: { punkte: number; erledigt: number } | null
  crmMinuten: number
  crmVon: string | null
  crmBis: string | null
  telegramAnfragen: number
}

const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

/** Aufrufe mit weniger als 90 s Abstand gehören zu einer Anfrage (der Assistent ruft je Nachricht oft mehrmals auf). */
export function zaehleAnfragen(zeiten: number[]): number {
  const s = [...zeiten].filter(Number.isFinite).sort((a, b) => a - b)
  let n = 0
  let letzte = -Infinity
  for (const t of s) {
    if (t - letzte > TELEGRAM_ABSTAND_MS) n++
    letzte = t
  }
  return n
}

/** Steht die Adresse unter den Empfängern (an kann mehrere, durch Komma getrennte Adressen enthalten)? */
function anAdresse(an: unknown, ziel: string): boolean {
  return text(an).toLowerCase().split(/[,;\s<>]+/).some((x) => x === ziel)
}

export async function ladeKontrollDaten(admin: Db, p: Person, jetzt: Date): Promise<KontrollDaten> {
  const heute = berlinZeit(jetzt).datum
  const beginnIso = berlinTagesbeginn(heute).toISOString()
  const ich = adresse(p.email)
  const fensterIso = new Date(jetzt.getTime() - UNBEANTWORTET_FENSTER_TAGE * 86_400_000).toISOString()
  const grenzeMs = jetzt.getTime() - UNBEANTWORTET_NACH_TAGE * 86_400_000

  const [faecherErg, teamErg] = await Promise.all([
    admin.from('postfaecher').select('id, adresse, verantwortlich_email, bereich').eq('verantwortlich_email', ich),
    admin.from('mitarbeiter').select('name, email'),
  ])
  if (faecherErg.error) throw new Error(`Postfächer nicht lesbar: ${faecherErg.error.message}`)
  const faecher = ((faecherErg.data ?? []) as { id: string; adresse: string; bereich: string | null }[]).filter((f) => f.bereich)
  const ids = faecher.map((f) => f.id)
  const kollegen = new Set(((teamErg.data ?? []) as { email: string | null }[]).map((m) => adresse(m.email)))

  // ---- Mails ----
  let mailsNeu = 0
  let mailsBeantwortet = 0
  let mailsOffen = 0
  let aeltesteOffenTage: number | null = null
  if (ids.length > 0) {
    const [eingang, gesendet] = await Promise.all([
      alleZeilen(() => admin.from('eingegangene_emails').select('id, von, betreff, ausschnitt, rohdaten, relevanz, ignoriert, mail_datum, besitzer_email').in('postfach_id', ids).gte('mail_datum', fensterIso)),
      alleZeilen(() => admin.from('gesendete_emails').select('id, an, gesendet_am, postfach_id').gte('gesendet_am', fensterIso)),
    ])
    if (eingang.error) throw new Error(`Eingegangene Mails nicht lesbar: ${eingang.error.message}`)
    if (gesendet.error) throw new Error(`Gesendete Mails nicht lesbar: ${gesendet.error.message}`)
    // deno-lint-ignore no-explicit-any
    const ausgang = (gesendet.data ?? []) as any[]
    mailsBeantwortet = ausgang.filter((g) => ids.includes(text(g.postfach_id)) && text(g.gesendet_am) >= beginnIso).length
    // deno-lint-ignore no-explicit-any
    for (const m of (eingang.data ?? []) as any[]) {
      if (m.besitzer_email) continue
      if (m.ignoriert === true || m.relevanz === 'nicht_relevant') continue
      const datum = Date.parse(text(m.mail_datum))
      if (text(m.mail_datum) >= beginnIso) mailsNeu++
      if (!Number.isFinite(datum) || datum > grenzeMs) continue
      const von = adresse(m.von)
      if (!von.includes('@') || kollegen.has(von) || INTERNE_DOMAINS.includes(von.split('@')[1])) continue
      const h = rundschreibenHinweise(m)
      if (h.system || h.liste.length > 0) continue
      const beantwortet = ausgang.some((g) => anAdresse(g.an, von) && Date.parse(text(g.gesendet_am)) >= datum)
      if (beantwortet) continue
      mailsOffen++
      const tage = Math.floor((jetzt.getTime() - datum) / 86_400_000)
      aeltesteOffenTage = aeltesteOffenTage == null ? tage : Math.max(aeltesteOffenTage, tage)
    }
  }

  // ---- To-dos (wie die Morgen-Übersicht: eigene Liste ohne Microsoft, Bereichslisten nur wo zuständig) ----
  const { data: todos, error: todoFehler } = await alleZeilen(() =>
    admin.from('todos').select('id, aufgabe, zustaendig, erledigen_bis, geplante_wiedervorlage, erledigt_am, bereich, besitzer_email, ms_id'),
  )
  if (todoFehler) throw new Error(`To-dos nicht lesbar: ${todoFehler.message}`)
  let todosErledigt = 0
  let todosUeberfaellig = 0
  // deno-lint-ignore no-explicit-any
  for (const t of (todos ?? []) as any[]) {
    const zustaendig = text(t.zustaendig).trim()
    const meine = t.bereich ? gehoertZu(zustaendig, p.name) : adresse(t.besitzer_email) === ich && !text(t.ms_id) && (!zustaendig || gehoertZu(zustaendig, p.name))
    if (!meine) continue
    const erledigt = alsIso(text(t.erledigt_am))
    if (erledigt) {
      if (erledigt === heute) todosErledigt++
      continue
    }
    if (text(t.erledigt_am).trim()) continue
    if (lageVon(alsIso(text(t.erledigen_bis || t.geplante_wiedervorlage)), heute) === 'ueberfaellig') todosUeberfaellig++
  }

  // ---- Objekte (nur Mayer-Objekte) ----
  const { data: objekte, error: objektFehler } = await alleZeilen(() => admin.from('objekte').select('id, verantwortlich, activities, kurzpruefung, bewertung, privat_besitzer'))
  if (objektFehler) throw new Error(`Objekte nicht lesbar: ${objektFehler.message}`)
  const o = { bearbeitet: 0, kurzpruefung: 0, bewertung: 0, expose: 0, verlauf: 0 }
  // deno-lint-ignore no-explicit-any
  for (const ob of (objekte ?? []) as any[]) {
    if (ob.privat_besitzer) continue
    let beruehrt = false
    // deno-lint-ignore no-explicit-any
    const heutigeEintraege = (Array.isArray(ob.activities) ? ob.activities : []).filter((a: any) => alsIso(text(a?.date)) === heute && gehoertZu(text(a?.user), p.name))
    if (heutigeEintraege.length > 0) {
      o.verlauf++
      beruehrt = true
      // deno-lint-ignore no-explicit-any
      if (heutigeEintraege.some((a: any) => /expos/i.test(text(a?.text)))) o.expose++
    }
    const kp = alsObjekt(ob.kurzpruefung)
    if (kp && alsIso(text(kp.datum)) === heute && gehoertZu(text(ob.verantwortlich), p.name)) {
      o.kurzpruefung++
      beruehrt = true
    }
    const bw = alsObjekt(ob.bewertung)
    const vonIhm = bw && (adresse(bw.gestartetVon) === ich || gehoertZu(text(bw.gestartetVon), p.name))
    if (bw && vonIhm && text(bw.gestartetAm) >= beginnIso) {
      o.bewertung++
      beruehrt = true
    }
    if (beruehrt) o.bearbeitet++
  }

  // ---- Zeiterfassung und Tagesablauf ----
  const { data: abteilung, error: abtFehler } = await admin.from(TABELLE).select('id, art, daten').in('art', ['zeit', 'tagesplan'])
  if (abtFehler) throw new Error(`Zeiterfassung nicht lesbar: ${abtFehler.message}`)
  const zeit = { eintraege: 0, minuten: 0 }
  const plan = { angelegt: false, punkte: 0, erledigt: 0 }
  for (const z of (abteilung ?? []) as { art: string; daten: unknown }[]) {
    const d = alsObjekt(z.daten)
    if (!d || alsIso(text(d.datum)) !== heute || !gehoertZu(text(d.mitarbeiter), p.name)) continue
    if (z.art === 'zeit') {
      zeit.eintraege++
      zeit.minuten += Math.max(0, Number(d.dauerMin) || 0)
    } else {
      const zeilen = (Array.isArray(d.zeilen) ? d.zeilen : []).map((x) => alsObjekt(x)).filter((x) => x && text(x.was).trim())
      plan.angelegt = true
      plan.punkte += zeilen.length
      plan.erledigt += zeilen.filter((x) => x!.erledigt === true).length
    }
  }

  // ---- Aktivität ----
  const [minuten, ki] = await Promise.all([
    alleZeilen(() => admin.from('nutzung_minuten').select('email, minute').eq('email', ich).gte('minute', beginnIso), { ordnung: ['email', 'minute'] }),
    alleZeilen(() => admin.from('ki_verbrauch').select('id, am').eq('person', ich).eq('anlass', 'telegram').gte('am', beginnIso)),
  ])
  const minutenListe = ((minuten.data ?? []) as { minute: string }[]).map((m) => Date.parse(m.minute)).filter(Number.isFinite).sort((a, b) => a - b)
  return {
    datum: heute,
    postfaecher: faecher.map((f) => f.adresse),
    mailsNeu,
    mailsBeantwortet,
    mailsOffen,
    aeltesteOffenTage,
    todosErledigt,
    todosUeberfaellig,
    objekte: o,
    zeit,
    tagesplan: plan.angelegt ? { punkte: plan.punkte, erledigt: plan.erledigt } : null,
    crmMinuten: minutenListe.length,
    crmVon: minutenListe.length ? UHR.format(new Date(minutenListe[0])) : null,
    crmBis: minutenListe.length ? UHR.format(new Date(minutenListe[minutenListe.length - 1])) : null,
    telegramAnfragen: zaehleAnfragen(((ki.data ?? []) as { am: string }[]).map((k) => Date.parse(k.am))),
  }
}

// ---------------------------------------------------------------------------------------------
// Text (rein)
// ---------------------------------------------------------------------------------------------

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function stunden(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} Std.`
}

/** Höchstens zehn Zeilen, nur Zahlen. */
export function kontrollText(name: string, d: KontrollDaten): string {
  const [j, m, t] = d.datum.split('-')
  const tag = WOCHENTAG[new Date(Date.UTC(Number(j), Number(m) - 1, Number(t))).getUTCDay()]
  const zeilen = [`Tagesbericht ${name} – ${tag} ${t}.${m}.`]
  if (d.postfaecher.length > 0) {
    const kurz = d.postfaecher.map((a) => a.split('@')[0] + '@').join(', ')
    zeilen.push(`Mails (${kurz}): ${d.mailsNeu} neu · ${d.mailsBeantwortet} beantwortet · ${d.mailsOffen} offen > 2 Tage${d.aeltesteOffenTage != null && d.mailsOffen > 0 ? ` (älteste ${d.aeltesteOffenTage} Tage)` : ''}`)
  }
  zeilen.push(`To-dos: ${d.todosErledigt} erledigt · ${d.todosUeberfaellig} überfällig`)
  const teile = [
    d.objekte.kurzpruefung ? `Kurzprüfung ${d.objekte.kurzpruefung}` : '',
    d.objekte.bewertung ? `Bewertung ${d.objekte.bewertung}` : '',
    d.objekte.expose ? `Exposé ${d.objekte.expose}` : '',
    d.objekte.verlauf ? `Verlauf ${d.objekte.verlauf}` : '',
  ].filter(Boolean)
  zeilen.push(`Objekte: ${d.objekte.bearbeitet} bearbeitet${teile.length ? ` (${teile.join(', ')})` : ''}`)
  zeilen.push(`Zeiterfassung: ${d.zeit.eintraege ? `${d.zeit.eintraege} Einträge, ${stunden(d.zeit.minuten)}` : 'keine Einträge'}`)
  zeilen.push(`Tagesablauf: ${d.tagesplan ? `${d.tagesplan.punkte} Punkte, ${d.tagesplan.erledigt} abgehakt` : 'nicht angelegt'}`)
  zeilen.push(`CRM: ${d.crmMinuten ? `${d.crmMinuten} Min. aktiv (${d.crmVon}–${d.crmBis})` : 'heute nicht geöffnet'}`)
  zeilen.push(`Telegram-Assistent: ${d.telegramAnfragen} ${d.telegramAnfragen === 1 ? 'Anfrage' : 'Anfragen'}`)
  return zeilen.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Minutentakt
// ---------------------------------------------------------------------------------------------

type Stand = { datum?: string; zustand?: 'laeuft' | 'gesendet' | 'fehler'; versuche?: number; am?: string; gesendet?: string[]; fehler?: string }

async function beanspruche(admin: Db, datum: string, jetzt: Date): Promise<number> {
  const jetztIso = jetzt.toISOString()
  const { data: zeile, error } = await admin.from(TABELLE).select('daten, updated_at').eq('id', STAND_ID).maybeSingle()
  if (error) throw new Error(`Stand nicht lesbar: ${error.message}`)
  if (!zeile) {
    const { error: e } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: { datum, zustand: 'laeuft', versuche: 1, am: jetztIso }, updated_at: jetztIso })
    return e ? 0 : 1
  }
  const s = (alsObjekt(zeile.daten) ?? {}) as Stand
  let versuche = 1
  if (s.datum === datum) {
    if (s.zustand === 'gesendet') return 0
    if ((s.versuche ?? 0) >= HOECHSTENS_VERSUCHE) return 0
    const seit = Date.parse(text(s.am))
    if (Number.isFinite(seit) && jetzt.getTime() - seit < NEUER_VERSUCH_NACH_MS) return 0
    versuche = (s.versuche ?? 0) + 1
  }
  let q = admin.from(TABELLE).update({ daten: { datum, zustand: 'laeuft', versuche, am: jetztIso }, updated_at: jetztIso }).eq('id', STAND_ID)
  q = zeile.updated_at == null ? q.is('updated_at', null) : q.eq('updated_at', zeile.updated_at)
  const { data: beansprucht } = await q.select('id')
  return Array.isArray(beansprucht) && beansprucht.length > 0 ? versuche : 0
}

type TeamZeile = { name: string; email: string; aktiv: boolean | null; telegram_chat_id: number | string | null }

async function ladeTeam(admin: Db): Promise<Map<string, TeamZeile>> {
  const { data, error } = await admin.from('mitarbeiter').select('name, email, aktiv, telegram_chat_id')
  if (error) throw new Error(`Mitarbeiter nicht lesbar: ${error.message}`)
  return new Map(((data ?? []) as TeamZeile[]).map((m) => [adresse(m.email), m]))
}

export type LaufErgebnis = { gesendet: number; grund?: string }

let heuteErledigt: string | null = null

/** Vom Minutentakt gerufen. Außerhalb des Fensters liest sie höchstens alle zehn Minuten die Einstellung. Wirft nie. */
export async function pruefeKontrollberichte(admin: Db, sende: SendeFunktion, jetzt = new Date()): Promise<LaufErgebnis> {
  try {
    const b = berlinZeit(jetzt)
    if (b.wochentag < 1 || b.wochentag > 5 || heuteErledigt === b.datum) return { gesendet: 0, grund: 'ausserhalb' }
    const e = await einstellungImTakt(admin, jetzt)
    if (!imFenster(e, jetzt)) return { gesendet: 0, grund: 'ausserhalb' }
    const aktive = e.eintraege.filter((x) => x.an)
    if (aktive.length === 0) return { gesendet: 0, grund: 'keine Einträge' }
    const versuche = await beanspruche(admin, b.datum, jetzt)
    if (!versuche) {
      heuteErledigt = b.datum
      return { gesendet: 0, grund: 'schon beansprucht' }
    }
    const team = await ladeTeam(admin)
    let gesendet = 0
    const an: string[] = []
    const fehler: string[] = []
    for (const x of aktive) {
      try {
        const person = team.get(x.mitarbeiter)
        const empfaenger = team.get(x.empfaenger)
        if (!person?.aktiv || !empfaenger?.aktiv || empfaenger.telegram_chat_id == null) continue
        const daten = await ladeKontrollDaten(admin, { name: person.name, email: person.email }, jetzt)
        if ((await sende(empfaenger.telegram_chat_id, kontrollText(person.name, daten))) === true) {
          gesendet++
          an.push(`${person.name} → ${empfaenger.name}`)
        }
      } catch (err) {
        fehler.push(err instanceof Error ? err.message : String(err))
      }
    }
    const zustand = fehler.length > 0 && gesendet === 0 ? 'fehler' : 'gesendet'
    await admin.from(TABELLE).update({ daten: { datum: b.datum, zustand, versuche, am: jetzt.toISOString(), gesendet: an, ...(fehler.length ? { fehler: fehler.join(' | ').slice(0, 300) } : {}) }, updated_at: jetzt.toISOString() }).eq('id', STAND_ID)
    if (zustand === 'gesendet') heuteErledigt = b.datum
    if (fehler.length) console.error('Kontrollbericht mit Fehlern:', fehler.join(' | '))
    return { gesendet }
  } catch (err) {
    console.error('Kontrollbericht fehlgeschlagen:', err instanceof Error ? err.message : err)
    return { gesendet: 0, grund: 'fehler' }
  }
}

/** Nur für Tests. */
export function vergissTag(): void {
  heuteErledigt = null
}

// ---------------------------------------------------------------------------------------------
// Vorschau (Aktion kontrollbericht_test): Text je Eintrag, ohne zu senden und ohne die Buchhaltung anzufassen.
// ---------------------------------------------------------------------------------------------

export type TestEingabe = { mitarbeiter?: unknown; jetzt?: unknown }
export type TestErgebnis = { ok: true; berichte: { mitarbeiter: string; empfaenger: string | null; an: boolean; text: string }[]; einstellung: Einstellung } | { ok: false; status: number; fehler: string }

export async function kontrollberichtTest(admin: Db, eingabe: TestEingabe): Promise<TestErgebnis> {
  let jetzt = new Date()
  if (eingabe.jetzt != null) {
    jetzt = new Date(text(eingabe.jetzt))
    if (Number.isNaN(jetzt.getTime())) return { ok: false, status: 400, fehler: 'jetzt ist kein gültiger Zeitpunkt.' }
  }
  try {
    const e = await ladeEinstellung(admin)
    const team = await ladeTeam(admin)
    const nur = adresse(eingabe.mitarbeiter)
    const liste: { mitarbeiter: string; empfaenger: string | null; an: boolean }[] = nur
      ? [{ mitarbeiter: nur, empfaenger: e.eintraege.find((x) => x.mitarbeiter === nur)?.empfaenger ?? null, an: e.eintraege.some((x) => x.mitarbeiter === nur && x.an) }]
      : e.eintraege
    if (liste.length === 0) return { ok: false, status: 404, fehler: 'Kein Eintrag in der Einstellung (kontrollbericht_einstellung) — und kein Mitarbeiter angegeben.' }
    const berichte = []
    for (const x of liste) {
      const person = team.get(x.mitarbeiter)
      if (!person) return { ok: false, status: 404, fehler: `Kein Mitarbeiter mit der Adresse ${x.mitarbeiter}.` }
      const daten = await ladeKontrollDaten(admin, { name: person.name, email: person.email }, jetzt)
      berichte.push({ mitarbeiter: person.name, empfaenger: x.empfaenger ? team.get(x.empfaenger)?.name ?? x.empfaenger : null, an: e.an && x.an, text: kontrollText(person.name, daten) })
    }
    return { ok: true, berichte, einstellung: e }
  } catch (err) {
    return { ok: false, status: 500, fehler: err instanceof Error ? err.message : String(err) }
  }
}

