// „Ihr Kundenbereich“ (22.11.2026): ein persönlicher Link je Akte (Tabelle kunden_portal_zugaenge), der alles
// bündelt, was der Kunde braucht — Stand seines Vorgangs, fehlende Unterlagen mit Hochladen, offene
// Unterschriften, für ihn freigegebene Dokumente, Termine mit ihm als Gast, seine Rechnungen (PDF), eine
// Nachricht an uns und den Ansprechpartner mit Telefon. Öffentliche Seite: /formular/kunde/:token
// (src/pages/formulare/PublicKundenPortal.tsx), ohne Login.
//
// Schutz (wie Interessenten-Portal objektPortal.ts und Hochlade-Link kundenUnterlagen.ts):
// - Der Link ist der einzige Schlüssel: 32 Zufallsbytes base64url (43 Zeichen), widerrufbar, 180 Tage gültig.
// - Alles läuft mit dem Dienstschlüssel; die Kunden-Kennung kommt immer aus der Zugangszeile, nie vom Aufrufer.
// - Was der Kunde sieht, folgt den Regeln des Statusberichts (_shared/kundenberichtKern.ts — nichts Internes):
//   kein Verlauf im Wortlaut, keine internen Wiedervorlagen, keine Namen von Kollegen, keine Beträge außer aus
//   verschickten Rechnungen und bekannten Angeboten. Dazu hier strenger als im Bericht (der Bericht wird vor dem
//   Senden gelesen, die Seite nicht):
//     · gesendete Mails nur, wenn sie wirklich an die Adresse des Kunden gingen (nicht an Notar, Steuerberater …);
//     · Termine nur, wenn der Kunde als Gast eingeladen ist (termine.gast.eingeladen), mit Titel und Ort wie in
//       seiner Einladung;
//     · Dokumente nur mit ausdrücklicher Freigabe (kunden.dokumente[].fuerKunde === true) — ohne Speicherpfad;
//     · der Stand im Ablauf nur über eine feste Liste kundengerechter Sätze (STAND_FUER_KUNDEN); „Wiedervorlage /
//       On Hold“, „Verloren“, „Nicht qualifiziert“ usw. erscheinen nie, auch nicht als Kennung.
// - Private Akten (Bereich „privat“) bekommen nie einen Kundenbereich.
// - Nachricht an uns: Verlaufseintrag in der Akte + Telegram-Notiz an den Verantwortlichen (abschaltbar je
//   Mitarbeiter in kundenportal_einstellungen). Höchstens 5 Nachrichten je Link in 24 Stunden und eine je
//   2 Minuten (bedingtes Schreiben, auch bei gleichzeitigen Klicks); dazu die Mengengrenze je Gerät in index.ts.
// - Automatische Mails an Kunden: keine. Der Link geht nur per ausdrücklichem Knopf aus der Akte raus.
import {
  aktePfad,
  akteAusZeile,
  CRM_BASIS_STANDARD,
  erstelleKundenbericht,
  fehlendeUnterlagen,
  ladeBerichtDaten,
  plusTage,
  type BerichtAnforderung,
  type KundenAmpel,
} from '../_shared/kundenberichtKern.ts'
import { eigenerSpeicher, istSichererPfad } from '../_shared/speicherPfad.ts'
import { nochGueltig } from './kundenUnterlagen.ts'
import { telefonFuerMitarbeiter } from '../_shared/profilKern.ts'
import {
  ABGELAUFEN,
  BEENDET,
  BEREICH_FUER_KUNDEN,
  NACHRICHT_ABSTAND_MS,
  NACHRICHT_MAX_JE_TAG,
  NACHRICHT_MAX_ZEICHEN,
  PORTAL_BEREICHE,
  standFuerKunden,
  TOKEN_MUSTER,
  UNGUELTIG,
  ZEITRAUM_TAGE,
  type KundenPortalSeite,
  type PortalUnterlage,
} from '../_shared/kundenPortalKern.ts'

export * from '../_shared/kundenPortalKern.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

const FEHLER = 'Da ist bei uns etwas schiefgegangen. Bitte versuchen Sie es in ein paar Minuten noch einmal.'
/** Eimer, aus denen ein freigegebenes Dokument kommen darf (privat:-Anhänge nie). */
const DOKUMENT_EIMER = ['kunden-dokumente', 'email-anhaenge', 'postfach-anhaenge']

export type Antwort = { status: number; body: Record<string, unknown> }

export type PortalKontext = {
  /** Telegram an einen Mitarbeiter (email-gateway/kalender.ts sendeTelegram). */
  sendeTelegram?: (chat: number | string, text: string) => Promise<unknown>
  /** Basis für eigene Speicher-Adressen (Standard: SUPABASE_URL). */
  speicherBasis?: string
  /** Link-Basis des CRM für die Telegram-Notiz. */
  crmBasis?: string
}

// ---------------------------------------------------------------------------------------------
// Kleine Helfer

const heuteBerlin = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)
const ISO = /^\d{4}-\d{2}-\d{2}/

type Zugang = {
  id: string
  token: string
  kunde_id: string
  kunde_bereich: string
  status: string
  gueltig_bis: string
  zugriffe?: number | null
  nachrichten_zaehler?: number | null
  nachricht_fenster?: string | null
  letzte_nachricht_am?: string | null
}

type Dok = { id?: string; name?: string | null; typ?: string | null; datum?: string | null; groesse?: string | null; url?: string | null; fuerKunde?: boolean }

async function ladeZugang(admin: Admin, token: unknown, jetzt: Date): Promise<{ z: Zugang } | { grund: string }> {
  if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) return { grund: UNGUELTIG }
  const { data, error } = await admin.from('kunden_portal_zugaenge').select('*').eq('token', token).maybeSingle()
  if (error) throw new Error(`Zugang nicht lesbar: ${error.message}`)
  if (!data) return { grund: UNGUELTIG }
  const z = data as Zugang
  if (z.status !== 'aktiv') return { grund: BEENDET }
  if (!z.gueltig_bis || new Date(z.gueltig_bis).getTime() < jetzt.getTime()) return { grund: ABGELAUFEN }
  if (!(PORTAL_BEREICHE as readonly string[]).includes(z.kunde_bereich)) return { grund: UNGUELTIG }
  return { z }
}

const KUNDE_SPALTEN =
  'id, bereich, firma, ansprechpartner, email, telefon, verantwortlich, verantwortlich_email, status, naechste_schritte, dienstleistungen, activities, dokumente, unterlagen_anforderungen, unterlagen_checkliste, sa_am:selbstauskunft->>eingereichtAm'

// deno-lint-ignore no-explicit-any
async function ladeKunde(admin: Admin, z: Zugang): Promise<any | null> {
  const { data, error } = await admin.from('kunden').select(KUNDE_SPALTEN).eq('id', z.kunde_id).maybeSingle()
  if (error) throw new Error(`Akte nicht lesbar: ${error.message}`)
  if (!data) return null
  // Private Akten nie; Bereich muss zur Zugangszeile passen.
  if (!(PORTAL_BEREICHE as readonly string[]).includes(String(data.bereich ?? ''))) return null
  return data
}

function personName(k: { ansprechpartner?: string | null; firma?: string | null }): string {
  return String(k.ansprechpartner ?? '').trim() || String(k.firma ?? '').trim()
}

type Mitarbeiter = { name: string; email: string; telefon: string; chat: number | string | null }

async function verantwortlicher(admin: Admin, k: { verantwortlich?: string | null; verantwortlich_email?: string | null }): Promise<Mitarbeiter | null> {
  const { data } = await admin.from('mitarbeiter').select('name, email, telefon, telegram_chat_id').eq('aktiv', true)
  const alle = ((data ?? []) as { name?: string; email?: string; telefon?: string; telegram_chat_id?: number | string | null }[]).map((m) => ({
    name: String(m.name ?? '').trim(),
    email: String(m.email ?? '').trim().toLowerCase(),
    telefon: String(m.telefon ?? '').trim(),
    chat: m.telegram_chat_id ?? null,
  }))
  const mail = String(k.verantwortlich_email ?? '').trim().toLowerCase()
  const name = String(k.verantwortlich ?? '').trim().toLowerCase()
  return (mail && alle.find((m) => m.email === mail)) || (name && alle.find((m) => m.name.toLowerCase() === name)) || null
}

/** Speicherort eines Dokuments der Akte: Pfad in "kunden-dokumente" oder eigene Speicher-Adresse; sonst null. */
export function speicherOrt(url: unknown, basis: string): { eimer: string; pfad: string } | null {
  if (typeof url !== 'string' || !url || url.startsWith('privat:')) return null
  if (/^https?:\/\//i.test(url)) {
    const e = eigenerSpeicher(url, basis)
    return e && DOKUMENT_EIMER.includes(e.eimer) ? e : null
  }
  return istSichererPfad(url) ? { eimer: 'kunden-dokumente', pfad: url } : null
}

/** Für den Kunden freigegebene Dokumente (nur mit ausdrücklicher Freigabe und lesbarem Speicherort). */
export function freigegebeneDokumente(dokumente: unknown, basis: string): Dok[] {
  if (!Array.isArray(dokumente)) return []
  return (dokumente as Dok[]).filter((d) => d && typeof d.id === 'string' && d.fuerKunde === true && !!speicherOrt(d.url, basis))
}

const SICHTBARE_RECHNUNG = (r: { status?: string | null }) => !!r.status && r.status !== 'Entwurf'

function rechnungStand(r: { status?: string | null; bezahlt_am?: string | null }): 'offen' | 'ueberfaellig' | 'bezahlt' {
  if (r.status === 'Bezahlt' || r.bezahlt_am) return 'bezahlt'
  if (r.status === 'Überfällig') return 'ueberfaellig'
  return 'offen'
}

/** Fehlende Unterlagen mit dem jüngsten noch gültigen Hochlade-Link, der sie enthält. */
export function fehlendMitLink(anforderungen: BerichtAnforderung[], fehlend: { punkte: string[]; weitere: string[] }, jetzt: Date): { fehlend: PortalUnterlage[]; hochladenToken: string | null } {
  const gueltig = [...anforderungen]
    .filter((a) => a && typeof a.token === 'string' && TOKEN_MUSTER.test(a.token) && nochGueltig(String(a.datum ?? ''), jetzt))
    .sort((a, b) => String(b.datum ?? '').localeCompare(String(a.datum ?? '')))
  const fuerPunkt = (p: string) => gueltig.find((a) => (a.punkte ?? []).includes(p))?.token ?? null
  const fuerZeile = (z: string) => gueltig.find((a) => String(a.weitere ?? '').split('\n').map((x) => x.trim()).includes(z))?.token ?? null
  return {
    fehlend: [...fehlend.punkte.map((name) => ({ name, token: fuerPunkt(name) })), ...fehlend.weitere.map((name) => ({ name, token: fuerZeile(name) }))],
    hochladenToken: gueltig[0]?.token ?? null,
  }
}

function nachrichtMoeglich(z: Zugang, jetzt: Date): { moeglich: boolean; grund?: string } {
  const t = jetzt.getTime()
  if (z.letzte_nachricht_am && t - Date.parse(z.letzte_nachricht_am) < NACHRICHT_ABSTAND_MS) {
    return { moeglich: false, grund: 'Ihre Nachricht ist angekommen. Eine weitere können Sie in ein paar Minuten schicken.' }
  }
  const fensterLaeuft = !!z.nachricht_fenster && t - Date.parse(z.nachricht_fenster) < 86400000
  if (fensterLaeuft && Number(z.nachrichten_zaehler ?? 0) >= NACHRICHT_MAX_JE_TAG) {
    return { moeglich: false, grund: 'Sie haben uns heute schon mehrere Nachrichten geschickt. Bitte rufen Sie uns an, wenn es eilt.' }
  }
  return { moeglich: true }
}

// ---------------------------------------------------------------------------------------------
// Seite laden

// deno-lint-ignore no-explicit-any
async function baueSeite(admin: Admin, z: Zugang, k: any, jetzt: Date, ctx: PortalKontext, hinweis?: string): Promise<KundenPortalSeite> {
  const basis = ctx.speicherBasis ?? (Deno.env.get('SUPABASE_URL') ?? '')
  const heute = heuteBerlin(jetzt)
  const akte = akteAusZeile(k)
  const kundenMail = String(k.email ?? '').trim().toLowerCase()

  const [daten, mailZeilen, terminZeilen, rechnungZeilen, unterschriftZeilen, kontakt] = await Promise.all([
    ladeBerichtDaten(admin, akte.id, { akte }),
    admin.from('gesendete_emails').select('id, an').eq('kunde_id', akte.id).is('besitzer_email', null).order('gesendet_am', { ascending: false }).limit(200),
    admin.from('termine').select('id, titel, beginn, ende, ganztags, ort, gast').eq('kunde_id', akte.id).gte('ende', jetzt.toISOString()).order('beginn', { ascending: true }).limit(50),
    admin.from('rechnungen').select('id, nummer, datum, betrag_brutto, status, zahlungsziel, versendet_am, bezahlt_am, dokument').eq('kunde_id', akte.id).order('datum', { ascending: false }).limit(100),
    admin.from('unterschrift_anfragen').select('id, token, titel, status, gueltig_bis, unterschrieben_am').eq('kunde_id', akte.id).in('status', ['offen', 'unterschrieben']).order('erstellt_am', { ascending: false }).limit(50),
    verantwortlicher(admin, k),
  ])
  if (!daten) throw new Error('Akte verschwunden')
  const kontaktTelefon = kontakt ? await telefonFuerMitarbeiter(admin, { email: kontakt.email, name: kontakt.name, telefon: kontakt.telefon }) : ''

  // Nur Mails, die wirklich an den Kunden gingen.
  const anKunden = new Set(
    ((mailZeilen.data ?? []) as { id: string; an?: string | null }[])
      .filter((m) => kundenMail && String(m.an ?? '').toLowerCase().includes(kundenMail))
      .map((m) => String(m.id)),
  )
  const rechnungen = ((rechnungZeilen.data ?? []) as Record<string, unknown>[]).filter((r) => SICHTBARE_RECHNUNG(r as { status?: string }))
  const bericht = erstelleKundenbericht({
    ...daten,
    mails: daten.mails.filter((m) => !!m.id && anKunden.has(m.id)),
    // Termine stehen unten als eigener Abschnitt.
    termine: [],
    rechnungen: daten.rechnungen.filter((r) => SICHTBARE_RECHNUNG(r)),
    heute,
    seit: plusTage(heute, -(ZEITRAUM_TAGE - 1)),
  })

  const fehlend = fehlendMitLink(akte.unterlagenAnforderungen ?? [], fehlendeUnterlagen(akte), jetzt)

  const dokumente = Array.isArray(k.dokumente) ? (k.dokumente as Dok[]) : []
  const rechnungsDoks = new Set(rechnungen.map((r) => (r.dokument as { dokumentId?: string } | null)?.dokumentId).filter(Boolean) as string[])
  const pdfDa = (r: Record<string, unknown>) => {
    const d = r.dokument as { kundeId?: string; dokumentId?: string } | null
    if (!d?.dokumentId || (d.kundeId && d.kundeId !== akte.id)) return false
    const dok = dokumente.find((x) => x?.id === d.dokumentId)
    return !!dok && !!speicherOrt(dok.url, basis)
  }

  const termine = ((terminZeilen.data ?? []) as Record<string, unknown>[])
    .filter((t) => {
      const g = t.gast as { eingeladen?: boolean; email?: string } | null
      return !!g && g.eingeladen === true
    })
    .slice(0, 10)
    .map((t) => ({
      id: String(t.id),
      titel: String(t.titel ?? '').trim() || 'Termin',
      beginn: String(t.beginn ?? ''),
      ende: String(t.ende ?? ''),
      ganztags: !!t.ganztags,
      ort: String(t.ort ?? ''),
    }))

  const unterschriften = ((unterschriftZeilen.data ?? []) as Record<string, unknown>[])
    .filter((u) => typeof u.token === 'string' && TOKEN_MUSTER.test(u.token as string))
    .filter((u) => u.status === 'unterschrieben' || (u.status === 'offen' && Date.parse(String(u.gueltig_bis)) > jetzt.getTime()))
    .map((u) => ({
      id: String(u.id),
      titel: String(u.titel ?? 'Dokument'),
      status: u.status as 'offen' | 'unterschrieben',
      token: String(u.token),
      ...(u.status === 'offen' ? { gueltigBis: String(u.gueltig_bis) } : { unterschriebenAm: String(u.unterschrieben_am ?? '') }),
    }))

  const offeneUnterschriften = unterschriften.filter((u) => u.status === 'offen')
  const vonIhnen = [...bericht.vonIhnen, ...offeneUnterschriften.map((u) => `Ihre Unterschrift: „${u.titel}“`)]
  const ampel: KundenAmpel = vonIhnen.length > 0 ? 'gelb' : 'gruen'

  return {
    stufe: 'frei',
    anrede: bericht.anrede,
    bereich: BEREICH_FUER_KUNDEN[akte.bereich] ?? '',
    leistungen: (akte.dienstleistungen ?? []).map((x) => String(x).trim()).filter(Boolean),
    stand: standFuerKunden(akte.bereich, akte.status),
    ampel,
    ampelText: ampel === 'gelb' ? 'Wir warten noch auf Unterlagen oder eine Rückmeldung von Ihnen.' : 'Alles läuft nach Plan.',
    erledigt: [...bericht.erledigt].reverse(),
    naechste: bericht.naechste,
    vonIhnen,
    unterlagen: fehlend,
    unterschriften,
    dokumente: freigegebeneDokumente(dokumente, basis)
      .filter((d) => !rechnungsDoks.has(String(d.id)))
      .map((d) => ({ id: String(d.id), name: String(d.name ?? 'Dokument'), datum: ISO.test(String(d.datum ?? '')) ? String(d.datum).slice(0, 10) : '', groesse: String(d.groesse ?? '') })),
    termine,
    rechnungen: rechnungen.map((r) => ({
      id: String(r.id),
      nummer: String(r.nummer ?? ''),
      datum: String(r.datum ?? ''),
      betrag: r.betrag_brutto === null || r.betrag_brutto === undefined ? null : Number(r.betrag_brutto),
      stand: rechnungStand(r as { status?: string; bezahlt_am?: string }),
      faelligAm: ISO.test(String(r.zahlungsziel ?? '')) ? String(r.zahlungsziel).slice(0, 10) : '',
      mitPdf: pdfDa(r),
    })),
    kontakt: kontakt ? { name: kontakt.name, telefon: kontaktTelefon, email: kontakt.email } : null,
    nachricht: nachrichtMoeglich(z, jetzt),
    gueltigBis: z.gueltig_bis,
    ...(hinweis ? { hinweis } : {}),
  }
}

export async function kundenPortalLaden(admin: Admin, token: unknown, jetzt = new Date(), ctx: PortalKontext = {}): Promise<KundenPortalSeite> {
  const r = await ladeZugang(admin, token, jetzt)
  if ('grund' in r) return { stufe: 'ungueltig', grund: r.grund }
  const k = await ladeKunde(admin, r.z)
  if (!k) return { stufe: 'ungueltig', grund: BEENDET }
  await admin.from('kunden_portal_zugaenge').update({ zugriffe: Number(r.z.zugriffe ?? 0) + 1, letzter_zugriff: jetzt.toISOString() }).eq('id', r.z.id)
  return await baueSeite(admin, r.z, k, jetzt, ctx)
}

// ---------------------------------------------------------------------------------------------
// Nachricht an uns

/** Eintrag oben in den Verlauf der Akte — frisch gelesen, nachgelesen, höchstens dreimal. */
async function verlaufErgaenzen(admin: Admin, kundeId: string, eintrag: { id: string; date: string; text: string; user: string }): Promise<boolean> {
  for (let versuch = 0; versuch < 3; versuch++) {
    const { data: k } = await admin.from('kunden').select('activities').eq('id', kundeId).maybeSingle()
    if (!k) return false
    const liste = Array.isArray(k.activities) ? k.activities : []
    if (liste.some((a: { id?: string }) => a?.id === eintrag.id)) return true
    const { error } = await admin.from('kunden').update({ activities: [eintrag, ...liste], letzte_aktivitaet: eintrag.date }).eq('id', kundeId)
    if (error) continue
    const { data: nachher } = await admin.from('kunden').select('activities').eq('id', kundeId).maybeSingle()
    if (Array.isArray(nachher?.activities) && nachher.activities.some((a: { id?: string }) => a?.id === eintrag.id)) return true
  }
  return false
}

export function saubererText(v: unknown): string {
  if (typeof v !== 'string') return ''
  // deno-lint-ignore no-control-regex
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

export async function kundenPortalNachricht(admin: Admin, token: unknown, text: unknown, jetzt = new Date(), ctx: PortalKontext = {}): Promise<Antwort> {
  const r = await ladeZugang(admin, token, jetzt)
  if ('grund' in r) return { status: 200, body: { stufe: 'ungueltig', grund: r.grund } }
  const { z } = r
  const k = await ladeKunde(admin, z)
  if (!k) return { status: 200, body: { stufe: 'ungueltig', grund: BEENDET } }
  const nachricht = saubererText(text)
  if (nachricht.length < 3) return { status: 400, body: { error: 'Bitte schreiben Sie uns ein paar Worte.' } }
  if (nachricht.length > NACHRICHT_MAX_ZEICHEN) return { status: 400, body: { error: `Bitte fassen Sie sich etwas kürzer (höchstens ${NACHRICHT_MAX_ZEICHEN} Zeichen).` } }
  const darf = nachrichtMoeglich(z, jetzt)
  if (!darf.moeglich) return { status: 429, body: { error: darf.grund } }

  // Zähler bedingt hochsetzen: Nur wer den gelesenen Stand noch vorfindet, darf schreiben (gleichzeitige Klicks).
  const fensterLaeuft = !!z.nachricht_fenster && jetzt.getTime() - Date.parse(z.nachricht_fenster) < 86400000
  const zaehler = Number(z.nachrichten_zaehler ?? 0)
  let abfrage = admin
    .from('kunden_portal_zugaenge')
    .update({
      nachrichten_zaehler: fensterLaeuft ? zaehler + 1 : 1,
      nachricht_fenster: fensterLaeuft ? z.nachricht_fenster : jetzt.toISOString(),
      letzte_nachricht_am: jetzt.toISOString(),
    })
    .eq('id', z.id)
    .eq('status', 'aktiv')
    .eq('nachrichten_zaehler', zaehler)
  abfrage = z.letzte_nachricht_am ? abfrage.eq('letzte_nachricht_am', z.letzte_nachricht_am) : abfrage.is('letzte_nachricht_am', null)
  const { data: geschrieben, error } = await abfrage.select('id')
  if (error) throw new Error(`Zähler nicht gesetzt: ${error.message}`)
  if (!geschrieben || geschrieben.length === 0) return { status: 429, body: { error: 'Ihre Nachricht ist schon unterwegs. Eine weitere können Sie in ein paar Minuten schicken.' } }

  const name = personName(k) || 'Kunde'
  const eintrag = { id: crypto.randomUUID(), date: heuteBerlin(jetzt), text: `Nachricht aus dem Kundenbereich: „${nachricht}“`, user: `${name} (Kundenbereich)` }
  const imVerlauf = await verlaufErgaenzen(admin, k.id, eintrag)
  if (!imVerlauf) console.error('Kundenbereich: Nachricht nicht im Verlauf gelandet', k.id)

  const m = await verantwortlicher(admin, k)
  if (m?.chat && ctx.sendeTelegram) {
    const { data: einst } = await admin.from('kundenportal_einstellungen').select('nachricht_telegram').eq('email', m.email).maybeSingle()
    if (einst?.nachricht_telegram !== false) {
      const bereich = BEREICH_FUER_KUNDEN[String(k.bereich)] ?? ''
      const basis = ctx.crmBasis ?? CRM_BASIS_STANDARD
      const link = `${basis.endsWith('/') ? basis : basis + '/'}#${aktePfad(String(k.bereich), String(k.id))}`
      const kurz = nachricht.length > 600 ? `${nachricht.slice(0, 600)} …` : nachricht
      const zeilen = ['✉️ Nachricht im Kundenbereich', '', `${name}${bereich ? ` (${bereich})` : ''}`, `„${kurz}“`]
      const erreichbar = [k.telefon ? `Telefon: ${k.telefon}` : '', k.email ? `E-Mail: ${k.email}` : ''].filter(Boolean)
      if (erreichbar.length) zeilen.push(erreichbar.join(' · '))
      zeilen.push('', link)
      await Promise.resolve(ctx.sendeTelegram(m.chat, zeilen.join('\n'))).catch(() => undefined)
    }
  }
  if (!imVerlauf) return { status: 500, body: { error: FEHLER } }

  const frisch = await ladeZugang(admin, token, jetzt)
  if ('grund' in frisch) return { status: 200, body: { stufe: 'ungueltig', grund: frisch.grund } }
  const seite = await baueSeite(admin, frisch.z, k, jetzt, ctx, 'Danke! Ihre Nachricht ist bei uns angekommen. Wir melden uns so bald wie möglich bei Ihnen.')
  return { status: 200, body: seite as unknown as Record<string, unknown> }
}

// ---------------------------------------------------------------------------------------------
// Dokument oder Rechnung herunterladen

export async function kundenPortalDokument(admin: Admin, token: unknown, art: unknown, id: unknown, jetzt = new Date(), ctx: PortalKontext = {}): Promise<Antwort> {
  const r = await ladeZugang(admin, token, jetzt)
  if ('grund' in r) return { status: 200, body: { stufe: 'ungueltig', grund: r.grund } }
  const k = await ladeKunde(admin, r.z)
  if (!k) return { status: 200, body: { stufe: 'ungueltig', grund: BEENDET } }
  if (typeof id !== 'string' || !id || id.length > 200) return { status: 400, body: { error: 'Dieses Dokument gibt es nicht.' } }
  const basis = ctx.speicherBasis ?? (Deno.env.get('SUPABASE_URL') ?? '')
  const dokumente = Array.isArray(k.dokumente) ? (k.dokumente as Dok[]) : []
  let dok: Dok | undefined
  let name = ''

  if (art === 'dokument') {
    dok = freigegebeneDokumente(dokumente, basis).find((d) => d.id === id)
    if (!dok) return { status: 403, body: { error: 'Dieses Dokument ist nicht für Sie freigegeben.' } }
    name = String(dok.name ?? 'Dokument')
  } else if (art === 'rechnung') {
    const { data: rech } = await admin.from('rechnungen').select('id, nummer, kunde_id, status, dokument').eq('id', id).eq('kunde_id', k.id).maybeSingle()
    const verweis = rech?.dokument as { kundeId?: string; dokumentId?: string } | null
    if (!rech || !SICHTBARE_RECHNUNG(rech) || !verweis?.dokumentId || (verweis.kundeId && verweis.kundeId !== k.id)) {
      return { status: 403, body: { error: 'Zu dieser Rechnung liegt kein PDF vor. Bitte fragen Sie bei uns nach.' } }
    }
    dok = dokumente.find((d) => d?.id === verweis.dokumentId)
    if (!dok) return { status: 403, body: { error: 'Zu dieser Rechnung liegt kein PDF vor. Bitte fragen Sie bei uns nach.' } }
    name = String(dok.name ?? `Rechnung ${rech.nummer ?? ''}`.trim())
  } else {
    return { status: 400, body: { error: 'Unbekannte Art.' } }
  }

  const ort = speicherOrt(dok.url, basis)
  if (!ort) return { status: 403, body: { error: 'Dieses Dokument lässt sich hier nicht öffnen. Bitte fragen Sie bei uns nach.' } }
  const { data, error } = await admin.storage.from(ort.eimer).createSignedUrl(ort.pfad, 60 * 10, { download: name })
  if (error || !data?.signedUrl) return { status: 500, body: { error: 'Das Dokument lässt sich gerade nicht öffnen. Bitte versuchen Sie es später erneut.' } }
  return { status: 200, body: { url: data.signedUrl } }
}

// ---------------------------------------------------------------------------------------------
// Ein Einstieg für index.ts

export const KUNDENPORTAL_AKTIONEN = ['public_kundenportal_laden', 'public_kundenportal_nachricht', 'public_kundenportal_dokument'] as const

export async function beantworteKundenPortal(admin: Admin, action: string, body: Record<string, unknown>, ctx: PortalKontext = {}, jetzt = new Date()): Promise<Antwort> {
  try {
    if (action === 'public_kundenportal_laden') return { status: 200, body: (await kundenPortalLaden(admin, body.token, jetzt, ctx)) as unknown as Record<string, unknown> }
    if (action === 'public_kundenportal_nachricht') return await kundenPortalNachricht(admin, body.token, body.text, jetzt, ctx)
    if (action === 'public_kundenportal_dokument') return await kundenPortalDokument(admin, body.token, body.art, body.id, jetzt, ctx)
    return { status: 400, body: { error: 'Unbekannte Aktion.' } }
  } catch (err) {
    console.error('Kundenbereich:', err)
    return { status: 500, body: { error: FEHLER } }
  }
}
