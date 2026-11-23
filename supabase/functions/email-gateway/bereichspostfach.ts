// Persönliches Postfach → Bereichspostfach (Entscheidung Eray, 23.11.2026): immo@amayer-holding.com war das persönliche
// Postfach von Quirin Lutzenberger und wird das Postfach des Bereichs Immobilien (postfaecher.bereich, siehe postfach.ts).
// Diese einmalige, wiederholbare Aktion (nur Dienstschlüssel oder Superuser, Aktion `bereichspostfach_ueberfuehren`)
//  1. stellt das Postfach um: bereich gesetzt, besitzer_email leer, der bisherige Besitzer wird verantwortlich_email
//     (darf weiter von dort senden);
//  2. überführt die vorhandenen Mails (eingegangene_emails mit besitzer_email = bisheriger Besitzer und diesem
//     Postfach): ohne Besitzer, postfach_bereich gesetzt, Anhänge in die gemeinsame Ablage KOPIERT (die privaten
//     Dateien bleiben liegen — es wird nichts gelöscht). Die privaten Zuordnungsvorschläge (zuordnung_vorschlag mit
//     art 'privat') werden geleert: sie können Namen privater Kontakte enthalten und gelten im Bereich nicht mehr.
//     Mails, die einem privaten Kontakt zugeordnet sind, bleiben privat beim bisherigen Besitzer;
//  3. überführt die gesendeten Mails dieses Postfachs genauso (außer an private Kontakte);
//  4. schickt die überführten Mails einmal durch die Post-Zuordnung des gemeinsamen Postfachs (mailZuordnung.ts:
//     nur eindeutige Treffer automatisch, unsichere als Vorschlag im Postfach, Rundschreiben ausgeblendet; ohne KI).
//     Der Rest bleibt unzugeordnet und sichtbar.
//
// Altbestand, damit aus alten Mails keine neuen Vorgänge entstehen (sonst würden sie wie frisch eingegangene Mails
// behandelt): Jede überführte Mail bekommt VOR dem Überführen einen Eintrag „vor_start“ beim Anfragenmanager
// (objekt_anfragen — sonst Akte, Portal-Zugang, Telegram und ggf. Mail an Interessenten für alte Anfragen), und
// Absender ohne Akte und ohne Lead-Eintrag bekommen einen Vermerk „nicht_relevant“ in vorgeschlagene_leads (sonst
// legt classify_new_leads aus ihnen automatisch neue Akten an). Schreibt ein solcher Absender künftig neu, prüft
// classify_new_leads ihn wie jeden anderen (neue Mail nach dem Vermerk).
//
// `trocken: true` (Vorgabe) schreibt nichts und rechnet nur aus, was passieren würde — samt Zuordnungs-Vorschau.
// Ein echter Lauf bearbeitet je Aufruf höchstens `hoechstens` Mails (Rechenzeit); `offen` sagt, ob noch etwas liegt.
// Wiederholen ist gefahrlos: Was schon überführt ist, wird nicht noch einmal angefasst. Wirft nie.

import { ladePostfach, postfachArt, veroeffentlicheAnhaenge, type Postfach } from './postfach.ts'
import { akteName, entscheide, ladeKontext, type MailZeile, ordneNeueMailsZu } from './mailZuordnung.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const PRIVAT_VORSATZ = 'privat:'
const MAIL_SPALTEN =
  'id, message_id, von, von_name, betreff, ausschnitt, rohdaten, relevanz, ignoriert, besitzer_email, zugewiesener_kunde_id, zugewiesener_bereich, mail_datum, erstellt_am, anhaenge, zuordnung_vorschlag, postfach_id'
const INTERNE_DOMAINS = ['amayer-holding.com', 'fundament-it.de']
/** Alle Mails des Postfachs sind höchstens so alt (erstellt_am = Zeitpunkt des Abholens). */
const ZUORDNUNG_TAGE = 800

export const ALTBESTAND_GRUND = 'Altbestand aus dem Bereichspostfach — beim Überführen nicht automatisch bearbeitet'
export const ALTBESTAND_LEAD_NOTIZ =
  'Absender aus dem Altbestand des Bereichspostfachs (vor der Umstellung). Nicht automatisch als Akte angelegt — schreibt er neu, wird er wie jeder Absender geprüft.'

export type UeberfuehrenEingabe = {
  postfachId: string
  bereich: string
  /** Vorgabe true: nichts schreiben, nur ausrechnen. */
  trocken?: boolean
  /** Höchstens so viele Mails je Aufruf überführen (Vorgabe 60). */
  hoechstens?: number
  zeitBudgetMs?: number
  jetzt?: Date
}

type Beispiel = { betreff: string; von: string; akte?: string; grund: string }

export type UeberfuehrenErgebnis = {
  ok: boolean
  trocken: boolean
  postfach: { id: string; adresse: string; bereich: string; verantwortlich: string | null; vorher: string; umgestellt: boolean }
  mails: { privat: number; ueberfuehrt: number; privatBelassen: number; offen: number }
  anhaenge: { privatAbgelegt: number; kopiert: number; nichtKopiert: number }
  /** Aufgelöste private Zuordnungsvorschläge nach Status (privat_offen, privat_keiner, …). */
  privateVorschlaege: Record<string, number>
  gesendet: { privat: number; ueberfuehrt: number; privatBelassen: number }
  altbestand: { anfragenVermerkt: number; absenderVermerkt: number }
  zuordnung: { geprueft: number; zugeordnet: number; vorschlaege: number; rundschreiben: number; ohneTreffer: number; offen: number; beispiele: Beispiel[] }
  fehler: string[]
  hinweis?: string
}

function leeresErgebnis(trocken: boolean, p: Postfach | null, bereich: string): UeberfuehrenErgebnis {
  return {
    ok: false,
    trocken,
    postfach: { id: p?.id ?? '', adresse: p?.adresse ?? '', bereich, verantwortlich: null, vorher: p ? postfachArt(p) : '', umgestellt: false },
    mails: { privat: 0, ueberfuehrt: 0, privatBelassen: 0, offen: 0 },
    anhaenge: { privatAbgelegt: 0, kopiert: 0, nichtKopiert: 0 },
    privateVorschlaege: {},
    gesendet: { privat: 0, ueberfuehrt: 0, privatBelassen: 0 },
    altbestand: { anfragenVermerkt: 0, absenderVermerkt: 0 },
    zuordnung: { geprueft: 0, zugeordnet: 0, vorschlaege: 0, rundschreiben: 0, ohneTreffer: 0, offen: 0, beispiele: [] },
    fehler: [],
  }
}

type Anhang = { url?: string; [k: string]: unknown }

function privateAnhaenge(anhaenge: unknown): number {
  return Array.isArray(anhaenge) ? (anhaenge as Anhang[]).filter((a) => String(a?.url ?? '').startsWith(PRIVAT_VORSATZ)).length : 0
}

/** Absenderadresse wie in classify_new_leads (index.ts): „Name <a@b.de>“ → a@b.de, klein geschrieben. */
export function absenderAdresse(von: string | null | undefined): string {
  const roh = String(von ?? '').trim().toLowerCase()
  return (/<([^<>\s]+@[^<>\s]+)>/.exec(roh)?.[1] ?? roh).trim()
}

type MailRoh = MailZeile & { zugewiesener_bereich?: string | null; anhaenge?: unknown; zuordnung_vorschlag?: { status?: string } | null }

/** Ist die Mail einem privaten Kontakt zugeordnet? Dann bleibt sie beim bisherigen Besitzer. */
function bleibtPrivat(m: { zugewiesener_bereich?: string | null }): boolean {
  return m.zugewiesener_bereich === 'privat'
}

/** Absender, für die ein Altbestand-Vermerk in vorgeschlagene_leads nötig ist (keine Akte, kein Lead, kein Mitarbeiter). */
async function absenderOhneEintrag(admin: Db, adressen: string[]): Promise<string[]> {
  const kandidaten = [...new Set(adressen.filter((a) => a.includes('@') && !INTERNE_DOMAINS.includes(a.split('@')[1])))]
  if (kandidaten.length === 0) return []
  const [kunden, leads, team] = await Promise.all([
    alleZeilen<{ email: string | null }>(() => admin.from('kunden').select('id, email')),
    alleZeilen<{ email: string | null }>(() => admin.from('vorgeschlagene_leads').select('id, email')),
    admin.from('mitarbeiter').select('email'),
  ])
  if (kunden.error) throw new Error(`Akten nicht lesbar: ${kunden.error.message}`)
  if (leads.error) throw new Error(`Lead-Vorschläge nicht lesbar: ${leads.error.message}`)
  const bekannt = new Set<string>()
  for (const z of [...(kunden.data ?? []), ...(leads.data ?? []), ...((team.data ?? []) as { email: string | null }[])]) bekannt.add(String(z.email ?? '').trim().toLowerCase())
  return kandidaten.filter((a) => !bekannt.has(a))
}

/** Mail-Kennungen ohne Eintrag beim Anfragenmanager. */
async function ohneAnfrageEintrag(admin: Db, ids: string[]): Promise<string[]> {
  const schon = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('objekt_anfragen').select('email_id').in('email_id', ids.slice(i, i + 200))
    if (error) throw new Error(`Anfragenmanager-Stand nicht lesbar: ${error.message}`)
    for (const z of (data ?? []) as { email_id: string }[]) schon.add(String(z.email_id))
  }
  return ids.filter((id) => !schon.has(id))
}

/** Vorschau der Zuordnung für Mails, als lägen sie schon im Bereichspostfach (ohne zu schreiben). */
async function zuordnungsVorschau(admin: Db, mails: MailRoh[], jetzt: Date, e: UeberfuehrenErgebnis): Promise<void> {
  const offen = mails.filter((m) => !m.zugewiesener_kunde_id)
  if (offen.length === 0) return
  const alsBereich = offen.map((m) => ({ ...m, besitzer_email: null }))
  const kontext = await ladeKontext(admin, alsBereich, jetzt)
  const akten = new Map(kontext.akten.map((a) => [a.id, a]))
  for (const m of alsBereich) {
    const d = entscheide(m, kontext, jetzt)
    e.zuordnung.geprueft++
    const grund = { betreff: String(m.betreff ?? ''), von: String(m.von ?? '') }
    if (d.art === 'zuordnen') {
      e.zuordnung.zugeordnet++
      const a = akten.get(d.kundeId)
      e.zuordnung.beispiele.push({ ...grund, akte: a ? akteName(a) : d.kundeId, grund: d.grund })
    } else if (d.art === 'vorschlag') e.zuordnung.vorschlaege++
    else if (d.art === 'rundschreiben') e.zuordnung.rundschreiben++
    else e.zuordnung.ohneTreffer++
  }
  e.zuordnung.beispiele = e.zuordnung.beispiele.slice(0, 30)
}

export async function ueberfuehreInsBereichspostfach(admin: Db, eingabe: UeberfuehrenEingabe): Promise<UeberfuehrenErgebnis> {
  const trocken = eingabe.trocken !== false
  const jetzt = eingabe.jetzt ?? new Date()
  const beginn = Date.now()
  const budget = eingabe.zeitBudgetMs ?? 100_000
  const bereich = String(eingabe.bereich ?? '').trim()
  let p: Postfach | null = null
  let e = leeresErgebnis(trocken, null, bereich)
  try {
    if (!bereich) throw new Error('Es fehlt der Bereich (z. B. „immobilien“).')
    p = await ladePostfach(admin, String(eingabe.postfachId ?? ''))
    e = leeresErgebnis(trocken, p, bereich)
    if (!p) throw new Error('Dieses Postfach gibt es nicht.')
    const art = postfachArt(p)
    if (art === 'gemeinsam') throw new Error('Das ist ein gemeinsames Postfach ohne Bereich — überführt wird nur ein persönliches Postfach.')
    if (art === 'bereich' && p.bereich !== bereich) throw new Error(`Das Postfach ist schon Bereichspostfach von „${p.bereich}“.`)
    const besitzer = String((art === 'persoenlich' ? p.besitzer_email : p.verantwortlich_email) ?? '').trim().toLowerCase()
    if (!besitzer) throw new Error('Der bisherige Besitzer des Postfachs ist unbekannt.')
    e.postfach.verantwortlich = besitzer

    // ---- 1. Postfach umstellen ----
    if (art === 'persoenlich' && !trocken) {
      const { data, error } = await admin
        .from('postfaecher')
        .update({ bereich, verantwortlich_email: besitzer, besitzer_email: null })
        .eq('id', p.id)
        .eq('besitzer_email', p.besitzer_email)
        .select('id')
      if (error) throw new Error(`Postfach nicht umstellbar: ${error.message}`)
      e.postfach.umgestellt = Array.isArray(data) && data.length > 0
    }

    // ---- 2. Eingegangene Mails ----
    const { data: privatRoh, error: leseFehler } = await alleZeilen<MailRoh>(() => admin.from('eingegangene_emails').select(MAIL_SPALTEN).eq('postfach_id', p!.id).eq('besitzer_email', besitzer))
    if (leseFehler) throw new Error(`Mails nicht lesbar: ${leseFehler.message}`)
    const privat = (privatRoh ?? []) as MailRoh[]
    const belassen = privat.filter(bleibtPrivat)
    const zuUeberfuehren = privat.filter((m) => !bleibtPrivat(m)).sort((a, b) => String(a.mail_datum ?? '').localeCompare(String(b.mail_datum ?? '')))
    e.mails.privat = privat.length
    e.mails.privatBelassen = belassen.length
    for (const m of zuUeberfuehren) {
      e.anhaenge.privatAbgelegt += privateAnhaenge(m.anhaenge)
      const status = String(m.zuordnung_vorschlag?.status ?? '')
      if (status.startsWith('privat_')) e.privateVorschlaege[status] = (e.privateVorschlaege[status] ?? 0) + 1
    }

    // ---- 3. Gesendete Mails ----
    const { data: gesendetRoh, error: gesendetFehler } = await alleZeilen<{ id: string; kunde_bereich: string | null }>(() =>
      admin.from('gesendete_emails').select('id, kunde_bereich').eq('postfach_id', p!.id).eq('besitzer_email', besitzer),
    )
    if (gesendetFehler) throw new Error(`Gesendete Mails nicht lesbar: ${gesendetFehler.message}`)
    const gesendet = (gesendetRoh ?? []) as { id: string; kunde_bereich: string | null }[]
    const gesendetUeber = gesendet.filter((g) => g.kunde_bereich !== 'privat')
    e.gesendet.privat = gesendet.length
    e.gesendet.privatBelassen = gesendet.length - gesendetUeber.length

    if (trocken) {
      e.mails.offen = zuUeberfuehren.length
      e.anhaenge.kopiert = 0
      e.altbestand.anfragenVermerkt = (await ohneAnfrageEintrag(admin, zuUeberfuehren.map((m) => m.id))).length
      e.altbestand.absenderVermerkt = (await absenderOhneEintrag(admin, zuUeberfuehren.map((m) => absenderAdresse(m.von)))).length
      await zuordnungsVorschau(admin, zuUeberfuehren, jetzt, e)
      e.zuordnung.offen = e.zuordnung.geprueft
      e.ok = true
      e.hinweis = 'Trockenlauf — nichts geändert. Für den echten Lauf { trocken: false } schicken.'
      return e
    }

    const hoechstens = Math.max(1, Math.min(eingabe.hoechstens ?? 60, 300))
    const portion: MailRoh[] = []
    for (const m of zuUeberfuehren) {
      if (portion.length >= hoechstens) break
      portion.push(m)
    }
    if (portion.length > 0) {
      // Altbestand vermerken, BEVOR die Mails ohne Besitzer sind (sonst greifen Anfragenmanager und Lead-Anlage im
      // Minutentakt dazwischen).
      for (const id of await ohneAnfrageEintrag(admin, portion.map((m) => m.id))) {
        const zeit = jetzt.toISOString()
        const { error } = await admin.from('objekt_anfragen').insert({ email_id: id, status: 'vor_start', versuche: 0, grund: ALTBESTAND_GRUND, erstellt_am: zeit, aktualisiert_am: zeit })
        if (error && error.code !== '23505') throw new Error(`Anfragenmanager-Vermerk nicht möglich: ${error.message}`)
        if (!error) e.altbestand.anfragenVermerkt++
      }
      for (const adresse of await absenderOhneEintrag(admin, portion.map((m) => absenderAdresse(m.von)))) {
        const name = portion.find((m) => absenderAdresse(m.von) === adresse)?.von_name ?? null
        const { error } = await admin
          .from('vorgeschlagene_leads')
          .insert({ quelle: 'email-analyse', email: adresse, name, status: 'nicht_relevant', notiz: ALTBESTAND_LEAD_NOTIZ, erstellt_am: jetzt.toISOString() })
        if (error && error.code !== '23505') throw new Error(`Lead-Vermerk nicht möglich: ${error.message}`)
        if (!error) e.altbestand.absenderVermerkt++
      }
    }
    for (const m of portion) {
      if (Date.now() - beginn > budget * 0.6) break
      try {
        const vorher = privateAnhaenge(m.anhaenge)
        const anhaenge = vorher > 0 ? await veroeffentlicheAnhaenge(admin, m.anhaenge, { privatBehalten: true }) : m.anhaenge ?? null
        const nachher = privateAnhaenge(anhaenge)
        const { data, error } = await admin
          .from('eingegangene_emails')
          .update({ besitzer_email: null, postfach_bereich: bereich, anhaenge, zuordnung_vorschlag: null, zuordnung_geprueft_am: null })
          .eq('id', m.id)
          .eq('besitzer_email', besitzer)
          .select('id')
        if (error) throw new Error(error.message)
        if (Array.isArray(data) && data.length > 0) {
          e.mails.ueberfuehrt++
          e.anhaenge.kopiert += vorher - nachher
          e.anhaenge.nichtKopiert += nachher
        }
      } catch (err) {
        e.fehler.push(`Mail ${m.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    e.mails.offen = Math.max(0, zuUeberfuehren.length - e.mails.ueberfuehrt)

    for (const g of gesendetUeber) {
      const { data, error } = await admin.from('gesendete_emails').update({ besitzer_email: null, postfach_bereich: bereich }).eq('id', g.id).eq('besitzer_email', besitzer).select('id')
      if (error) e.fehler.push(`Gesendete Mail ${g.id}: ${error.message}`)
      else if (Array.isArray(data) && data.length > 0) e.gesendet.ueberfuehrt++
    }

    // ---- 4. Zuordnung (erst, wenn alles überführt ist; danach bei jedem weiteren Aufruf die noch ungeprüften) ----
    if (e.mails.offen === 0) {
      while (Date.now() - beginn < budget - 15_000) {
        const r = await ordneNeueMailsZu(admin, { postfachId: p.id, tage: ZUORDNUNG_TAGE, hoechstens: 100, zeitBudgetMs: Math.max(5_000, budget - 15_000 - (Date.now() - beginn)), jetzt })
        e.zuordnung.geprueft += r.geprueft
        e.zuordnung.zugeordnet += r.zugeordnet
        e.zuordnung.vorschlaege += r.vorschlaege
        e.zuordnung.rundschreiben += r.rundschreiben
        e.fehler.push(...r.fehler)
        if (r.geprueft === 0 || r.fehler.length > 0) break
      }
      e.zuordnung.ohneTreffer = Math.max(0, e.zuordnung.geprueft - e.zuordnung.zugeordnet - e.zuordnung.vorschlaege - e.zuordnung.rundschreiben)
      const { data: rest } = await admin.from('eingegangene_emails').select('id').eq('postfach_id', p.id).is('besitzer_email', null).is('zugewiesener_kunde_id', null).is('zuordnung_geprueft_am', null).limit(1000)
      e.zuordnung.offen = Array.isArray(rest) ? rest.length : 0
    }
    e.ok = e.fehler.length === 0
    if (e.mails.offen > 0 || e.zuordnung.offen > 0) e.hinweis = 'Noch nicht fertig — dieselbe Aktion noch einmal aufrufen (oder mit { weiter: true } selbst weiterlaufen lassen).'
    return e
  } catch (err) {
    e.fehler.push(err instanceof Error ? err.message : String(err))
    e.ok = false
    return e
  }
}
