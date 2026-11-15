// Mehrere Postfächer: das gemeinsame Postfach (Zugang liegt als Function-Secret vor) und beliebig
// viele weitere — gemeinsame (z. B. eine zweite Firmenadresse) oder persönliche eines Mitarbeiters.
//
// - Tabelle `postfaecher`: Adresse, Besitzer (leer = gemeinsam), Server, Abruf-Stand.
// - Tabelle `postfach_geheimnisse`: das Mail-Passwort, verschlüsselt. Kein Zugriff aus dem Browser
//   (Zeilenschutz ohne Regel), nur diese Funktion liest sie. Der Schlüssel wird aus dem
//   Dienst-Schlüssel des Projekts abgeleitet und liegt nirgends in der Datenbank — wird der
//   Dienst-Schlüssel einmal getauscht, müssen die Postfächer neu verbunden werden.
// - Persönliche Postfächer werden per IMAP abgeholt (Zeitplan), ihre Mails tragen `besitzer_email`
//   und sind nur für den Besitzer sichtbar, bis er sie in den öffentlichen Bereich holt.
// - Anhänge persönlicher Mails liegen in einem nicht öffentlichen Ablageort; einen Link gibt es nur
//   über `anhangUrl`, das vorher prüft, ob der Fragende die Mail sehen darf.
import { ImapFlow } from 'npm:imapflow@1'
import { simpleParser } from 'npm:mailparser@3'
import nodemailer from 'npm:nodemailer@6'

// deno-lint-ignore no-explicit-any
type Db = any

export type Postfach = {
  id: string
  adresse: string
  anzeige_name: string
  besitzer_email: string | null
  smtp_host: string
  smtp_port: number
  imap_host: string
  imap_port: number
  benutzer: string | null
  geheimnis_name: string | null
  aktiv: boolean
  letzter_abruf: string | null
  letzter_fehler: string | null
  letzte_uid: number | null
  uid_gueltigkeit: number | null
}

export type Aufrufer = { email: string; name: string; istGf: boolean }
export type MailAbsender = { adresse: string; anzeigeName?: string; host: string; port: number; benutzer: string; passwort: string }

export const STANDARD_ID = 'standard'
const ANHANG_ABLAGE = 'postfach-anhaenge'
const ANHANG_VORSATZ = 'privat:'

function zeitlimit<T>(versprechen: Promise<T>, ms: number, meldung: string): Promise<T> {
  let uhr: ReturnType<typeof setTimeout> | undefined
  const grenze = new Promise<T>((_, ablehnen) => {
    uhr = setTimeout(() => ablehnen(new Error(meldung)), ms)
  })
  return Promise.race([versprechen, grenze]).finally(() => clearTimeout(uhr))
}

// ---------- Verschlüsselung des Mail-Passworts ----------

async function schluessel(): Promise<CryptoKey> {
  const dienst = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!dienst) throw new Error('Fehlende Konfiguration: SUPABASE_SERVICE_ROLE_KEY')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mh-postfach-v1:${dienst}`))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function zuBase64(bytes: Uint8Array): string {
  let roh = ''
  for (const b of bytes) roh += String.fromCharCode(b)
  return btoa(roh)
}

function vonBase64(text: string): Uint8Array {
  const roh = atob(text)
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return bytes
}

async function verschluessele(klartext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const geheim = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await schluessel(), new TextEncoder().encode(klartext)))
  const alles = new Uint8Array(iv.length + geheim.length)
  alles.set(iv)
  alles.set(geheim, iv.length)
  return zuBase64(alles)
}

async function entschluessele(text: string): Promise<string> {
  const alles = vonBase64(text)
  const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: alles.slice(0, 12) }, await schluessel(), alles.slice(12))
  return new TextDecoder().decode(klar)
}

// ---------- Wer fragt? ----------

// Das geteilte x-crm-secret steckt im öffentlichen Seiten-Code und beweist nichts. Für alles, was
// ein persönliches Postfach betrifft, zählt nur der eigene Login (oder ein Aufruf der eigenen
// Telegram-Funktion, die sich mit dem Dienst-Schlüssel ausweist und sagt, für wen sie handelt).
// Der Dienst-Schlüssel des Projekts in alter (JWT) oder neuer Schreibweise (sb_secret_…).
function istDienstSchluessel(token: string): boolean {
  if (token.length < 30) return false
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return true
  try {
    const sammle = (wert: unknown): string[] =>
      typeof wert === 'string' ? [wert] : wert && typeof wert === 'object' ? Object.values(wert as Record<string, unknown>).flatMap(sammle) : []
    return sammle(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')).includes(token)
  } catch {
    return false
  }
}

export async function ermittleAufrufer(req: Request, admin: Db, body: Record<string, unknown>): Promise<Aufrufer | null> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  let email = ''
  if (istDienstSchluessel(token)) {
    email = String(body.imAuftragVon ?? '').trim()
  } else {
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data?.user?.email) return null
    email = data.user.email
  }
  if (!email) return null
  const muster = email.toLowerCase().replace(/[\\%_]/g, (z: string) => `\\${z}`)
  const { data: zeile } = await admin.from('mitarbeiter').select('name, email, aktiv, rolle, ist_admin').ilike('email', muster).maybeSingle()
  if (!zeile?.aktiv) return null
  return { email: String(zeile.email).toLowerCase(), name: zeile.name ?? '', istGf: zeile.rolle === 'geschaeftsfuehrung' || !!zeile.ist_admin }
}

// ---------- Postfächer lesen ----------

// Das bisherige gemeinsame Postfach bekommt beim ersten Aufruf von selbst einen Eintrag; sein
// Passwort bleibt das vorhandene Function-Secret.
export async function stelleStandardSicher(admin: Db): Promise<void> {
  const adresse = Deno.env.get('SMTP_USER')
  if (!adresse) return
  const { data } = await admin.from('postfaecher').select('id').eq('id', STANDARD_ID).maybeSingle()
  if (data) return
  await admin.from('postfaecher').insert({
    id: STANDARD_ID,
    adresse: adresse.toLowerCase(),
    anzeige_name: '',
    besitzer_email: null,
    smtp_host: Deno.env.get('SMTP_HOST') ?? 'smtp.ionos.de',
    smtp_port: Number(Deno.env.get('SMTP_PORT') ?? '587'),
    imap_host: Deno.env.get('IMAP_HOST') ?? 'imap.ionos.de',
    imap_port: Number(Deno.env.get('IMAP_PORT') ?? '143'),
    benutzer: adresse,
    geheimnis_name: 'SMTP_PASSWORD',
  })
}

export async function ladePostfach(admin: Db, id: string): Promise<Postfach | null> {
  const { data } = await admin.from('postfaecher').select('*').eq('id', id).maybeSingle()
  return (data as Postfach | null) ?? null
}

export function darfNutzen(p: Postfach, a: Aufrufer | null): boolean {
  if (!p.besitzer_email) return true
  return !!a && a.email === p.besitzer_email.toLowerCase()
}

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

export async function absenderVon(admin: Db, p: Postfach): Promise<MailAbsender> {
  return {
    adresse: p.adresse,
    anzeigeName: p.anzeige_name || undefined,
    host: p.smtp_host,
    port: p.smtp_port,
    benutzer: p.benutzer || p.adresse,
    passwort: await passwortVon(admin, p),
  }
}

export type PostfachInfo = {
  id: string
  adresse: string
  anzeigeName: string
  gemeinsam: boolean
  eigenes: boolean
  besitzer: string | null
  bereit: boolean
  holtAb: boolean
  letzterAbruf: string | null
  letzterFehler: string | null
}

export async function listePostfaecher(admin: Db, a: Aufrufer, alle: boolean): Promise<PostfachInfo[]> {
  await stelleStandardSicher(admin)
  const { data: zeilen } = await admin.from('postfaecher').select('*').eq('aktiv', true).order('erstellt_am')
  const { data: geheim } = await admin.from('postfach_geheimnisse').select('postfach_id')
  const mitPasswort = new Set(((geheim ?? []) as { postfach_id: string }[]).map((g) => g.postfach_id))
  return ((zeilen ?? []) as Postfach[])
    .filter((p) => darfNutzen(p, a) || (alle && a.istGf))
    .map((p) => ({
      id: p.id,
      adresse: p.adresse,
      anzeigeName: p.anzeige_name ?? '',
      gemeinsam: !p.besitzer_email,
      eigenes: !!p.besitzer_email && p.besitzer_email.toLowerCase() === a.email,
      besitzer: p.besitzer_email,
      bereit: p.geheimnis_name ? !!Deno.env.get(p.geheimnis_name) : mitPasswort.has(p.id),
      holtAb: !!p.besitzer_email,
      letzterAbruf: p.letzter_abruf,
      letzterFehler: p.letzter_fehler,
    }))
}

// ---------- Mail-Server zur Adresse finden ----------

type ServerVorschlag = { imap: string; smtp: string }

const BEKANNTE_ANBIETER: { muster: RegExp; name: string; imap?: string; smtp?: string }[] = [
  { muster: /ionos|kundenserver|1and1|1und1|perfora|schlund/, name: 'IONOS', imap: 'imap.ionos.de', smtp: 'smtp.ionos.de' },
  { muster: /strato|rzone\.de/, name: 'Strato', imap: 'imap.strato.de', smtp: 'smtp.strato.de' },
  { muster: /gmx\./, name: 'GMX', imap: 'imap.gmx.net', smtp: 'mail.gmx.net' },
  { muster: /web\.de/, name: 'WEB.DE', imap: 'imap.web.de', smtp: 'smtp.web.de' },
  { muster: /t-online|telekom/, name: 'Telekom', imap: 'secureimap.t-online.de', smtp: 'securesmtp.t-online.de' },
  // Bei diesen Anbietern ist der Posteingangs-Server zugleich der Server für Abruf und Versand.
  { muster: /netcup|kasserver|all-inkl/, name: 'Hosting-Anbieter' },
]

const NUR_MIT_ANMELDEFENSTER = /outlook\.|hotmail\.|live\.|msn\.|microsoft|gmail\.|googlemail\.|google\./

async function mxVon(domain: string): Promise<string[]> {
  for (const url of [`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`]) {
    try {
      const antwort = await zeitlimit(fetch(url, { headers: { accept: 'application/dns-json' } }), 6000, 'Namensauflösung antwortet nicht.')
      if (!antwort.ok) continue
      const daten = await antwort.json()
      const eintraege = ((daten?.Answer ?? []) as { type: number; data: string }[])
        .filter((e) => e.type === 15)
        .map((e) => {
          const [rang, name] = String(e.data).trim().split(/\s+/)
          return { rang: Number(rang) || 0, name: (name ?? '').replace(/\.$/, '').toLowerCase() }
        })
        .filter((e) => e.name)
        .sort((x, y) => x.rang - y.rang)
      if (eintraege.length > 0) return eintraege.map((e) => e.name)
    } catch {
      // nächster Auskunftsdienst
    }
  }
  return []
}

async function findeServer(adresse: string): Promise<{ vorschlaege: ServerVorschlag[] } | { fehler: string }> {
  const domain = adresse.split('@')[1] ?? ''
  const mx = await mxVon(domain)
  const kennung = `${domain} ${mx.join(' ')}`
  if (NUR_MIT_ANMELDEFENSTER.test(kennung)) {
    return {
      fehler:
        'Diese Adresse liegt bei Microsoft (Outlook/Hotmail) oder Google. Beide lassen eine Anbindung nur mit Passwort nicht mehr zu. Bitte eine Firmenadresse verwenden — die lässt sich sofort verbinden.',
    }
  }
  const vorschlaege: ServerVorschlag[] = []
  const bekannt = BEKANNTE_ANBIETER.find((b) => b.muster.test(kennung))
  if (bekannt?.imap && bekannt.smtp) vorschlaege.push({ imap: bekannt.imap, smtp: bekannt.smtp })
  if (mx[0]) vorschlaege.push({ imap: mx[0], smtp: mx[0] })
  vorschlaege.push({ imap: `imap.${domain}`, smtp: `smtp.${domain}` }, { imap: `mail.${domain}`, smtp: `mail.${domain}` })
  return { vorschlaege: vorschlaege.filter((v, i) => vorschlaege.findIndex((w) => w.imap === v.imap && w.smtp === v.smtp) === i).slice(0, 3) }
}

// ---------- Anmeldung prüfen ----------

type Pruefung = { ok: true; port: number } | { ok: false; falschesPasswort: boolean; meldung: string }

// Port 143 mit STARTTLS zuerst — Port 993 hängt in dieser Laufzeitumgebung bei manchen Anbietern.
async function pruefeImap(host: string, benutzer: string, passwort: string): Promise<Pruefung> {
  let letzte = 'keine Verbindung'
  for (const port of [143, 993]) {
    const client = new ImapFlow({ host, port, secure: port === 993, auth: { user: benutzer, pass: passwort }, logger: false })
    client.on('error', () => {})
    try {
      await zeitlimit(client.connect(), 12000, 'Zeitüberschreitung')
      await client.logout().catch(() => {})
      return { ok: true, port }
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const e = err as any
      try {
        client.close()
      } catch {
        // schon geschlossen
      }
      if (e?.authenticationFailed) return { ok: false, falschesPasswort: true, meldung: 'Der Mail-Server hat das Passwort abgelehnt.' }
      letzte = e?.message ?? String(err)
    }
  }
  return { ok: false, falschesPasswort: false, meldung: letzte }
}

async function pruefeSmtp(host: string, benutzer: string, passwort: string): Promise<Pruefung> {
  let letzte = 'keine Verbindung'
  for (const port of [587, 465]) {
    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: benutzer, pass: passwort }, connectionTimeout: 10000, greetingTimeout: 10000 })
    try {
      await zeitlimit(transporter.verify(), 14000, 'Zeitüberschreitung')
      transporter.close()
      return { ok: true, port }
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const e = err as any
      transporter.close()
      if (e?.code === 'EAUTH') return { ok: false, falschesPasswort: true, meldung: 'Der Mail-Server hat das Passwort abgelehnt.' }
      letzte = e?.message ?? String(err)
    }
  }
  return { ok: false, falschesPasswort: false, meldung: letzte }
}

// ---------- Verbinden / Trennen ----------

function postfachId(adresse: string): string {
  return `pf_${adresse.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
}

export type VerbindenEingabe = { adresse?: string; passwort?: string; gemeinsam?: boolean; anzeigeName?: string; imapHost?: string; smtpHost?: string }

export async function verbindePostfach(admin: Db, a: Aufrufer, eingabe: VerbindenEingabe): Promise<{ ok: true; id: string; adresse: string } | { ok: false; fehler: string }> {
  const adresse = String(eingabe.adresse ?? a.email).trim().toLowerCase()
  const passwort = String(eingabe.passwort ?? '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse)) return { ok: false, fehler: 'Bitte eine vollständige E-Mail-Adresse angeben.' }
  if (!passwort) return { ok: false, fehler: 'Bitte das Passwort des Postfachs eingeben.' }
  const gemeinsam = eingabe.gemeinsam === true
  if (gemeinsam && !a.istGf) return { ok: false, fehler: 'Ein gemeinsames Postfach darf nur die Geschäftsführung verbinden.' }

  await stelleStandardSicher(admin)
  const { data: vorhanden } = await admin.from('postfaecher').select('*').eq('adresse', adresse).maybeSingle()
  const alt = vorhanden as Postfach | null
  if (alt?.id === STANDARD_ID) return { ok: false, fehler: 'Diese Adresse ist bereits das gemeinsame Postfach des Unternehmens.' }
  if (alt?.besitzer_email && alt.besitzer_email.toLowerCase() !== a.email && !(gemeinsam && a.istGf)) {
    return { ok: false, fehler: 'Dieses Postfach ist bereits mit einem anderen Mitarbeiter verbunden.' }
  }
  if (alt && !alt.besitzer_email && !a.istGf) return { ok: false, fehler: 'Diese Adresse ist ein gemeinsames Postfach — das verwaltet die Geschäftsführung.' }

  const eigeneAngabe = eingabe.imapHost?.trim() && eingabe.smtpHost?.trim() ? [{ imap: eingabe.imapHost.trim(), smtp: eingabe.smtpHost.trim() }] : null
  const suche = eigeneAngabe ? { vorschlaege: eigeneAngabe } : await findeServer(adresse)
  if ('fehler' in suche) return { ok: false, fehler: suche.fehler }

  let treffer: { imap: string; imapPort: number; smtp: string; smtpPort: number } | null = null
  let grund = ''
  for (const v of suche.vorschlaege) {
    const imap = await pruefeImap(v.imap, adresse, passwort)
    if (!imap.ok) {
      if (imap.falschesPasswort) return { ok: false, fehler: 'Das Passwort stimmt nicht — der Mail-Server hat die Anmeldung abgelehnt. Gemeint ist das Passwort des Postfachs, nicht das fürs CRM.' }
      grund = `${v.imap}: ${imap.meldung}`
      continue
    }
    const smtp = await pruefeSmtp(v.smtp, adresse, passwort)
    if (!smtp.ok) {
      grund = `${v.smtp}: ${smtp.meldung}`
      continue
    }
    treffer = { imap: v.imap, imapPort: imap.port, smtp: v.smtp, smtpPort: smtp.port }
    break
  }
  if (!treffer) return { ok: false, fehler: `Der Mail-Server zu dieser Adresse war nicht erreichbar (${grund || 'kein Server gefunden'}).` }

  const id = alt?.id ?? postfachId(adresse)
  const zeile = {
    id,
    adresse,
    anzeige_name: (eingabe.anzeigeName ?? '').trim() || (gemeinsam ? alt?.anzeige_name ?? '' : a.name),
    besitzer_email: gemeinsam ? null : a.email,
    smtp_host: treffer.smtp,
    smtp_port: treffer.smtpPort,
    imap_host: treffer.imap,
    imap_port: treffer.imapPort,
    benutzer: adresse,
    geheimnis_name: null,
    aktiv: true,
    letzter_fehler: null,
  }
  const { error: zeilenFehler } = await admin.from('postfaecher').upsert(zeile)
  if (zeilenFehler) return { ok: false, fehler: `Postfach konnte nicht gespeichert werden: ${zeilenFehler.message}` }
  const { error: geheimFehler } = await admin
    .from('postfach_geheimnisse')
    .upsert({ postfach_id: id, verschluesselt: await verschluessele(passwort), geaendert_am: new Date().toISOString() })
  if (geheimFehler) {
    if (!alt) await admin.from('postfaecher').delete().eq('id', id)
    return { ok: false, fehler: `Passwort konnte nicht gesichert werden: ${geheimFehler.message}` }
  }
  return { ok: true, id, adresse }
}

export async function trennePostfach(admin: Db, a: Aufrufer, id: string): Promise<{ ok: true } | { ok: false; fehler: string }> {
  if (id === STANDARD_ID) return { ok: false, fehler: 'Das gemeinsame Hauptpostfach kann nicht getrennt werden.' }
  const p = await ladePostfach(admin, id)
  if (!p) return { ok: false, fehler: 'Postfach nicht gefunden.' }
  const eigenes = !!p.besitzer_email && p.besitzer_email.toLowerCase() === a.email
  if (!eigenes && !a.istGf) return { ok: false, fehler: 'Das darf nur der Besitzer oder die Geschäftsführung.' }
  // Bereits abgeholte Mails bleiben erhalten (beim Besitzer bzw. im öffentlichen Bereich).
  const { error } = await admin.from('postfaecher').delete().eq('id', id)
  if (error) return { ok: false, fehler: error.message }
  return { ok: true }
}

// ---------- Abruf ----------

function sicherername(name: string): string {
  const sauber = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 120)
  return sauber || 'anhang'
}

let ablageGeprueft = false
async function stelleAblageSicher(admin: Db): Promise<void> {
  if (ablageGeprueft) return
  const { data } = await admin.storage.getBucket(ANHANG_ABLAGE)
  if (!data) await admin.storage.createBucket(ANHANG_ABLAGE, { public: false })
  ablageGeprueft = true
}

function textAusHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

const ERSTER_ABRUF = 30

// Holt neue Mails eines Postfachs ab. `nurPruefen` liest nur, schreibt nichts (für Tests).
export async function rufePostfachAb(
  admin: Db,
  p: Postfach,
  hoechstens = 25,
  budgetMs = 90000,
  nurPruefen = false,
): Promise<{ neu: number; gesehen: number; fehler?: string }> {
  const beginn = Date.now()
  let neu = 0
  let gesehen = 0
  let hoechsteUid = p.letzte_uid ?? 0
  let gueltigkeit = p.uid_gueltigkeit
  let client: InstanceType<typeof ImapFlow> | null = null
  try {
    client = new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: await passwortVon(admin, p) }, logger: false })
    client.on('error', () => {})
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')
    const sperre = await client.getMailboxLock('INBOX')
    try {
      // deno-lint-ignore no-explicit-any
      const fach = client.mailbox as any
      const aktuelleGueltigkeit = Number(fach?.uidValidity ?? 0)
      const anzahl = Number(fach?.exists ?? 0)
      const neuStart = !p.letzte_uid || (gueltigkeit != null && aktuelleGueltigkeit !== Number(gueltigkeit))
      gueltigkeit = aktuelleGueltigkeit
      let uids: number[] = []
      if (anzahl > 0) {
        if (neuStart) {
          hoechsteUid = 0
          const ab = Math.max(1, anzahl - ERSTER_ABRUF + 1)
          for await (const n of client.fetch(`${ab}:*`, { uid: true })) uids.push(Number(n.uid))
        } else {
          const gefunden = await client.search({ uid: `${hoechsteUid + 1}:*` }, { uid: true })
          uids = (gefunden || []).map(Number).filter((u: number) => u > hoechsteUid)
        }
      }
      uids.sort((x, y) => x - y)
      gesehen = uids.length
      if (nurPruefen) return { neu: 0, gesehen }
      if (uids.length > 0) await stelleAblageSicher(admin)
      for (const uid of uids.slice(0, hoechstens)) {
        if (Date.now() - beginn > budgetMs) break
        const nachricht = await client.fetchOne(String(uid), { source: true }, { uid: true })
        // deno-lint-ignore no-explicit-any
        const quelle = (nachricht as any)?.source
        if (!quelle) {
          hoechsteUid = uid
          continue
        }
        const mail = await simpleParser(quelle)
        const absender = mail.from?.value?.[0]
        const kennung = `${p.id}:${mail.messageId ?? uid}`
        const { data: schonDa } = await admin.from('eingegangene_emails').select('id').eq('message_id', kennung).maybeSingle()
        if (!schonDa) {
          const anhaenge: { filename: string; size: number; contentType: string; url: string }[] = []
          for (const anhang of mail.attachments ?? []) {
            if (!anhang.content || anhang.size > 25 * 1024 * 1024) continue
            const name = sicherername(anhang.filename ?? 'anhang')
            const pfad = `${p.id}/${uid}/${name}`
            const { error: ladeFehler } = await admin.storage.from(ANHANG_ABLAGE).upload(pfad, anhang.content, { contentType: anhang.contentType || 'application/octet-stream', upsert: true })
            if (ladeFehler) {
              console.error('Anhang konnte nicht abgelegt werden', pfad, ladeFehler.message)
              continue
            }
            anhaenge.push({ filename: anhang.filename ?? name, size: anhang.size, contentType: anhang.contentType || 'application/octet-stream', url: `${ANHANG_VORSATZ}${pfad}` })
          }
          const text = (mail.text ?? '').trim() || (typeof mail.html === 'string' ? textAusHtml(mail.html) : '')
          // deno-lint-ignore no-explicit-any
          const an = (mail.to as any)?.text ?? ''
          // deno-lint-ignore no-explicit-any
          const cc = (mail.cc as any)?.text ?? ''
          const { error } = await admin.from('eingegangene_emails').insert({
            message_id: kennung,
            von: (absender?.address ?? 'unbekannt').toLowerCase(),
            von_name: absender?.name || absender?.address || 'Unbekannt',
            betreff: mail.subject ?? '(ohne Betreff)',
            mail_datum: (mail.date ?? new Date()).toISOString(),
            ausschnitt: text.slice(0, 20000),
            rohdaten: { quelle: 'imap', uid, an, cc },
            anhaenge: anhaenge.length > 0 ? anhaenge : null,
            postfach_id: p.id,
            besitzer_email: p.besitzer_email,
          })
          if (error) throw new Error(`Mail konnte nicht gespeichert werden: ${error.message}`)
          neu++
        }
        hoechsteUid = uid
      }
    } finally {
      sperre.release()
    }
    await client.logout().catch(() => {})
    client = null
    await admin.from('postfaecher').update({ letzte_uid: hoechsteUid || null, uid_gueltigkeit: gueltigkeit, letzter_abruf: new Date().toISOString(), letzter_fehler: null }).eq('id', p.id)
    return { neu, gesehen }
  } catch (err) {
    // deno-lint-ignore no-explicit-any
    const e = err as any
    const meldung = e?.authenticationFailed ? 'Anmeldung abgelehnt — das Passwort des Postfachs wurde offenbar geändert. Bitte neu verbinden.' : e?.message ?? String(err)
    try {
      client?.close()
    } catch {
      // schon geschlossen
    }
    if (!nurPruefen) {
      await admin
        .from('postfaecher')
        .update({ ...(hoechsteUid ? { letzte_uid: hoechsteUid, uid_gueltigkeit: gueltigkeit } : {}), letzter_abruf: new Date().toISOString(), letzter_fehler: String(meldung).slice(0, 500) })
        .eq('id', p.id)
    }
    return { neu, gesehen, fehler: String(meldung) }
  }
}

// Alle persönlichen Postfächer der Reihe nach, das am längsten nicht abgerufene zuerst.
export async function rufeAlleAb(admin: Db, budgetMs = 110000): Promise<{ postfaecher: number; neu: number; fehler: string[] }> {
  const beginn = Date.now()
  const { data } = await admin.from('postfaecher').select('*').eq('aktiv', true).not('besitzer_email', 'is', null).order('letzter_abruf', { ascending: true, nullsFirst: true })
  let neu = 0
  let anzahl = 0
  const fehler: string[] = []
  for (const p of (data ?? []) as Postfach[]) {
    const rest = budgetMs - (Date.now() - beginn)
    if (rest < 25000) break
    const ergebnis = await rufePostfachAb(admin, p, 25, Math.min(rest - 15000, 60000))
    anzahl++
    neu += ergebnis.neu
    if (ergebnis.fehler) fehler.push(`${p.adresse}: ${ergebnis.fehler}`)
  }
  return { postfaecher: anzahl, neu, fehler }
}

// ---------- Aus dem privaten in den öffentlichen Bereich ----------

export type FreigabeEingabe = { art?: string; id?: string; kunde?: { bereich?: string; id?: string; name?: string } }

export async function holeInOeffentlich(admin: Db, a: Aufrufer, eingabe: FreigabeEingabe): Promise<{ ok: true; betreff: string } | { ok: false; fehler: string }> {
  const id = String(eingabe.id ?? '')
  if (!id) return { ok: false, fehler: 'Es fehlt die Angabe, welche Mail gemeint ist.' }
  const kunde = eingabe.kunde?.id && eingabe.kunde.bereich && eingabe.kunde.bereich !== 'privat' ? eingabe.kunde : null
  if (eingabe.art === 'gesendet') {
    const { data } = await admin.from('gesendete_emails').select('id, betreff, besitzer_email').eq('id', id).maybeSingle()
    if (!data || String(data.besitzer_email ?? '').toLowerCase() !== a.email) return { ok: false, fehler: 'Diese Mail liegt nicht in deinem privaten Postfach.' }
    const { error } = await admin
      .from('gesendete_emails')
      .update({ besitzer_email: null, ...(kunde ? { kunde_bereich: kunde.bereich, kunde_id: kunde.id, kunde_name: kunde.name ?? null } : {}) })
      .eq('id', id)
    if (error) return { ok: false, fehler: error.message }
    return { ok: true, betreff: data.betreff ?? '' }
  }
  const { data } = await admin.from('eingegangene_emails').select('id, betreff, besitzer_email').eq('message_id', id).maybeSingle()
  if (!data || String(data.besitzer_email ?? '').toLowerCase() !== a.email) return { ok: false, fehler: 'Diese Mail liegt nicht in deinem privaten Postfach.' }
  const { error } = await admin
    .from('eingegangene_emails')
    .update({
      besitzer_email: null,
      ignoriert: false,
      ...(kunde ? { zugewiesener_bereich: kunde.bereich, zugewiesener_kunde_id: kunde.id, zugewiesener_kunde_name: kunde.name ?? null } : {}),
    })
    .eq('id', data.id)
  if (error) return { ok: false, fehler: error.message }
  return { ok: true, betreff: data.betreff ?? '' }
}

// Zeitlich begrenzter Link auf einen Anhang — nur wenn der Fragende die zugehörige Mail sehen darf.
export async function anhangUrl(admin: Db, a: Aufrufer, verweis: string): Promise<string | null> {
  if (!verweis.startsWith(ANHANG_VORSATZ)) return null
  const pfad = verweis.slice(ANHANG_VORSATZ.length)
  const fach = pfad.split('/')[0]
  const { data } = await admin.from('eingegangene_emails').select('besitzer_email').eq('postfach_id', fach).contains('anhaenge', JSON.stringify([{ url: verweis }]))
  const sichtbar = ((data ?? []) as { besitzer_email: string | null }[]).some((m) => !m.besitzer_email || m.besitzer_email.toLowerCase() === a.email)
  if (!sichtbar) return null
  const { data: link } = await admin.storage.from(ANHANG_ABLAGE).createSignedUrl(pfad, 3600)
  return link?.signedUrl ?? null
}
