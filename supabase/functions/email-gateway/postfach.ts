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
import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { ImapFlow } from 'npm:imapflow@1'
import nodemailer from 'npm:nodemailer@6'
import { pruefeNeueMail } from '../_shared/mailEingang.ts'
import { uebernehmeEinladung } from '../_shared/einladung.ts'
import { entschluessele, verschluessele } from '../_shared/geheim.ts'

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
  ordner_stand?: Record<string, { uid: number; g: number }> | null
  in_arbeit_ordner?: string | null
  uid_gueltigkeit: number | null
  in_arbeit_uid?: number | null
  abruf_laeuft_seit?: string | null
}

export type Aufrufer = { email: string; name: string; istGf: boolean }
export type MailAbsender = { adresse: string; anzeigeName?: string; host: string; port: number; benutzer: string; passwort: string }

export const STANDARD_ID = 'standard'
const ANHANG_ABLAGE = 'postfach-anhaenge'
const ANHANG_VORSATZ = 'privat:'
// Anhänge öffentlicher Mails liegen dort, wo sie der Rest des CRM erwartet (Zuordnung zur Akte,
// Einlesen von Dokumenten): im selben Ablageort wie die per Weiterleitung eingegangenen Mails.
const OEFFENTLICHE_ABLAGE = 'email-anhaenge'
// Der Weiterleitungsdienst des gemeinsamen Postfachs lehnt Mails über 512 KB ab ("552 Message size
// exceeds the allowed size", gesehen am 11. und 13.11.2026) — sie kamen bisher nie im CRM an. Aus
// dem Hauptpostfach holt der Abruf deshalb genau diese großen Mails; die kleinen kommen weiterhin über
// die Weiterleitung (mit Einordnung und Zuordnung). Weitere gemeinsame Postfächer werden ganz
// abgeholt und hier genauso geprüft (pruefeNeueMail).
const WEITERLEITUNGS_GRENZE = 450 * 1024

function zeitlimit<T>(versprechen: Promise<T>, ms: number, meldung: string): Promise<T> {
  let uhr: ReturnType<typeof setTimeout> | undefined
  const grenze = new Promise<T>((_, ablehnen) => {
    uhr = setTimeout(() => ablehnen(new Error(meldung)), ms)
  })
  return Promise.race([versprechen, grenze]).finally(() => clearTimeout(uhr))
}

// ---------- Verschlüsselung des Mail-Passworts: siehe _shared/geheim.ts ----------

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
  if (!p.smtp_host) throw new Error(`Von ${p.adresse} kann das CRM nicht senden — der Anbieter lässt den Versand von unserem Server nicht zu. Dieses Postfach ist nur für den Empfang angebunden.`)
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
  kannSenden: boolean
  holtAb: boolean
  letzterAbruf: string | null
  letzterFehler: string | null
  /** Eigene Ordner, aus denen Mails abgeholt werden — nur beim eigenen Postfach gefüllt. */
  ordner: string[]
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
      kannSenden: !!p.smtp_host,
      holtAb: !!p.besitzer_email || p.id !== STANDARD_ID,
      letzterAbruf: p.letzter_abruf,
      letzterFehler: p.letzter_fehler,
      ordner: !!p.besitzer_email && p.besitzer_email.toLowerCase() === a.email ? Object.keys(p.ordner_stand ?? {}).sort((x, y) => x.localeCompare(y, 'de')) : [],
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
  const versuche: string[] = []
  for (const port of [993, 143]) {
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
      if (e?.authenticationFailed) return { ok: false, falschesPasswort: true, meldung: `Port ${port}: Anmeldung abgelehnt${e?.responseText ? ` (${String(e.responseText).slice(0, 160)})` : ''}` }
      versuche.push(`Port ${port}: ${e?.responseText ?? e?.message ?? String(err)}`)
    }
  }
  return { ok: false, falschesPasswort: false, meldung: versuche.join('; ') }
}

async function pruefeSmtp(host: string, benutzer: string, passwort: string): Promise<Pruefung> {
  const versuche: string[] = []
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
      if (e?.code === 'EAUTH') return { ok: false, falschesPasswort: true, meldung: `Port ${port}: Anmeldung abgelehnt${e?.response ? ` (${String(e.response).slice(0, 160)})` : ''}` }
      versuche.push(`Port ${port}: ${e?.response ?? e?.message ?? String(err)}`)
    }
  }
  return { ok: false, falschesPasswort: false, meldung: versuche.join('; ') }
}

// Nur zur Fehlersuche (Geschäftsführung): Welche Server gehören zur Adresse, und was antworten sie
// auf einen Anmeldeversuch? Mit erfundenen Zugangsdaten aufrufbar — "Anmeldung abgelehnt" heißt dann:
// Server erreichbar, alles in Ordnung.
export async function diagnostizierePostfach(adresse: string, passwort: string): Promise<unknown> {
  const suche = await findeServer(adresse.trim().toLowerCase())
  if ('fehler' in suche) return { fehler: suche.fehler }
  const ergebnis = []
  for (const v of suche.vorschlaege) {
    const imap = await pruefeImap(v.imap, adresse, passwort)
    const smtp = await pruefeSmtp(v.smtp, adresse, passwort)
    ergebnis.push({ imap: v.imap, imapErgebnis: imap.ok ? `ok (Port ${imap.port})` : imap.meldung, smtp: v.smtp, smtpErgebnis: smtp.ok ? `ok (Port ${smtp.port})` : smtp.meldung })
  }
  return { server: ergebnis }
}

// ---------- Verbinden / Trennen ----------

// Manche Anbieter verlangen für Mail-Programme ein eigenes Passwort.
function hinweisZumAnbieter(adresse: string): string {
  if (/@(t-online|magenta)\.de$/.test(adresse)) {
    return ' Hinweis für Telekom-Adressen: Für die Anbindung braucht es das eigene „E-Mail-Passwort“ für Mail-Programme (im Telekom-Kundencenter unter „Passwörter“ einzurichten), nicht das normale Telekom-Login-Passwort.'
  }
  if (/@(gmx|web)\./.test(adresse)) return ' Hinweis: Bei GMX und WEB.DE muss in den Einstellungen des Postfachs „POP3/IMAP-Abruf“ einmal eingeschaltet werden.'
  return ''
}

function postfachId(adresse: string): string {
  return `pf_${adresse.toLowerCase().replace(/[^a-z0-9]/g, (z) => `-${z.charCodeAt(0).toString(16)}-`)}`
}

export type VerbindenEingabe = { adresse?: string; passwort?: string; gemeinsam?: boolean; anzeigeName?: string; imapHost?: string; smtpHost?: string }

export async function verbindePostfach(
  admin: Db,
  a: Aufrufer,
  eingabe: VerbindenEingabe,
): Promise<{ ok: true; id: string; adresse: string; nurEmpfang: boolean } | { ok: false; fehler: string }> {
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

  // smtp leer = nur Empfang: Der Abruf klappt, aber der Versand-Server des Anbieters nimmt von unserem
  // Server keine Verbindung an (die Telekom etwa sperrt Rechenzentrums-Adressen: "421 Your address is
  // blocked", gesehen am 16.11.2026). Dann wird das Postfach trotzdem angebunden — Mails kommen an,
  // als Absender steht es nicht zur Wahl.
  let treffer: { imap: string; imapPort: number; smtp: string; smtpPort: number } | null = null
  const gruende: string[] = []
  for (const v of suche.vorschlaege) {
    const imap = await pruefeImap(v.imap, adresse, passwort)
    if (!imap.ok) {
      if (imap.falschesPasswort) return { ok: false, fehler: `Das Passwort stimmt nicht — der Mail-Server hat die Anmeldung abgelehnt. Gemeint ist das Passwort des Postfachs, nicht das fürs CRM.${hinweisZumAnbieter(adresse)}` }
      gruende.push(`Abruf ${v.imap} — ${imap.meldung}`)
      continue
    }
    const smtp = await pruefeSmtp(v.smtp, adresse, passwort)
    if (!smtp.ok) {
      // Der Abruf-Server hat die Anmeldung angenommen — dann liegt es am Versand-Server, nicht an der
      // Adresse. Weitere Abruf-Server durchzuprobieren würde nur zusätzliche Anmeldeversuche erzeugen.
      if (smtp.falschesPasswort) {
        gruende.push(`Versand ${v.smtp} — Anmeldung abgelehnt`)
        break
      }
      console.error('Postfach nur für Empfang angebunden', adresse.split('@')[1], v.smtp, smtp.meldung)
      treffer = { imap: v.imap, imapPort: imap.port, smtp: '', smtpPort: 587 }
      break
    }
    treffer = { imap: v.imap, imapPort: imap.port, smtp: v.smtp, smtpPort: smtp.port }
    break
  }
  if (!treffer) return { ok: false, fehler: `Das Postfach ließ sich nicht verbinden. ${gruende.join(' | ') || 'Kein Mail-Server gefunden.'}${hinweisZumAnbieter(adresse)}` }

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
  return { ok: true, id, adresse, nurEmpfang: !treffer.smtp }
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

function sicheresDatum(wert: unknown): string {
  const d = wert instanceof Date ? wert : new Date(typeof wert === 'string' || typeof wert === 'number' ? wert : Date.now())
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const ERSTER_ABRUF = 30
// Persönliche Postfächer: beim ersten Abholen je Ordner die neuesten 100 Mails, höchstens ein Jahr alt.
const ERSTER_ABRUF_EIGENES = 100
const ERSTER_ABRUF_HOECHSTALTER = 365 * 86400000
const POSTEINGANG = 'INBOX'
// Ordner, die nicht ins Postfach des CRM gehören.
const NICHT_ABHOLEN = new Set(['\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\All', '\\Flagged'])
const NICHT_ABHOLEN_NAMEN = /^(gesendet|gesendete (objekte|elemente)|sent([ -]?(items|messages|mail))?|entw(ü|ue)rfe|drafts?|papierkorb|trash|gel(ö|oe)schte? (objekte|elemente)|gel(ö|oe)scht|deleted([ -]?(items|messages))?|spam|spambucket|spamverdacht|junk([ -]?e-?mail)?|unerw(ü|ue)nscht(e (e-?mails?|werbung))?|virus(es)?|quarant(ä|ae)ne|quarantine|postausgang|outbox|vorlagen|templates)$/i

// Gehört dieser Ordner ins Postfach des CRM? Der Posteingang wird gesondert abgeholt.
// deno-lint-ignore no-explicit-any
function istEigenerOrdner(o: any): boolean {
  const pfad = String(o?.path ?? '')
  if (!pfad || pfad.toUpperCase() === POSTEINGANG) return false
  if (o.flags instanceof Set && o.flags.has('\\Noselect')) return false
  if (NICHT_ABHOLEN.has(String(o.specialUse ?? ''))) return false
  // Manche Anbieter hängen alles unter den Posteingang ("INBOX.Spam"): nur der letzte Teil zählt.
  const letzterTeil = o.delimiter ? pfad.split(String(o.delimiter)).pop() ?? pfad : pfad
  return !NICHT_ABHOLEN_NAMEN.test(letzterTeil.trim())
}
type OrdnerStand = { uid: number; g: number }
const ZU_GROSS = 30 * 1024 * 1024
// Größere Anhänge sprengen die Rechenzeit eines Aufrufs — der Lauf bricht dann ab und blockiert das
// Postfach für mehrere Minuten. Sie werden ausgelassen und im Mailtext vermerkt.
const ANHANG_HOECHSTENS = 12 * 1024 * 1024
const ANHAENGE_JE_MAIL = 16 * 1024 * 1024
const BYTES_JE_LAUF = 10 * 1024 * 1024

// deno-lint-ignore no-explicit-any
type Teil = any

// Läuft die Gliederung der Mail ab und sammelt Textteil(e) und Anhänge ein — und Kalender-Einladungen
// (`kalender`): der text/calendar-Teil, den Outlook/Google/Apple neben den Mailtext legen, oder eine
// angehängte .ics-Datei. Ein Teil kann zugleich Anhang und Einladung sein.
function gliedere(wurzel: Teil): { text?: Teil; html?: Teil; anhaenge: Teil[]; kalender: Teil[] } {
  const ergebnis: { text?: Teil; html?: Teil; anhaenge: Teil[]; kalender: Teil[] } = { anhaenge: [], kalender: [] }
  const gehe = (knoten: Teil) => {
    if (!knoten) return
    if (Array.isArray(knoten.childNodes) && knoten.childNodes.length > 0) {
      knoten.childNodes.forEach(gehe)
      return
    }
    const art = String(knoten.type ?? '').toLowerCase()
    const name = knoten.dispositionParameters?.filename ?? knoten.parameters?.name
    if (art === 'text/calendar' || art === 'application/ics' || /\.ics$/i.test(String(name ?? ''))) ergebnis.kalender.push(knoten)
    const alsAnhang = String(knoten.disposition ?? '').toLowerCase() === 'attachment' || (!!name && !art.startsWith('text/'))
    if (alsAnhang) ergebnis.anhaenge.push(knoten)
    else if (art === 'text/plain' && !ergebnis.text) ergebnis.text = knoten
    else if (art === 'text/html' && !ergebnis.html) ergebnis.html = knoten
    // Eingebettete Bilder ohne Dateinamen (Logos in Signaturen) werden nicht als Anhang geführt.
  }
  gehe(wurzel)
  return ergebnis
}

// Lädt genau einen Teil der Mail, vom Server bereits dekodiert — die Mail wird nie als Ganzes im
// Speicher zerlegt (das hat bei großen Mails die Rechenzeit-Grenze gesprengt).
// deno-lint-ignore no-explicit-any
async function ladeTeil(client: any, uid: number, teil: Teil, hoechstens?: number): Promise<{ bytes: Uint8Array; meta: any } | null> {
  const antwort = await client.download(String(uid), teil.part ?? '1', { uid: true, ...(hoechstens ? { maxBytes: hoechstens } : {}) })
  if (!antwort?.content) return null
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
  return { bytes, meta: antwort.meta ?? {} }
}

// Anhänge: in einem Stück abrufen und mit der eingebauten Entschlüsselung umwandeln. Der Weg über
// `download` holt die Datei in vielen kleinen Häppchen und wandelt sie in JavaScript um — das kostet bei
// großen Anhängen so viel Rechenzeit, dass der Aufruf abgebrochen wird (ab etwa 8 MB, 17.11.2026).
// deno-lint-ignore no-explicit-any
async function ladeAnhang(client: any, uid: number, teil: Teil): Promise<{ bytes: Uint8Array; meta: any } | null> {
  const nummer = String(teil.part ?? '')
  if (!nummer || String(teil.encoding ?? '').toLowerCase() !== 'base64') return ladeTeil(client, uid, teil)
  try {
    const antwort = await client.fetchOne(String(uid), { bodyParts: [nummer] }, { uid: true })
    const teile: Map<string, Uint8Array> | undefined = antwort?.bodyParts
    const roh = teile?.get(nummer) ?? (teile ? [...teile.values()][0] : undefined)
    if (!roh || roh.length === 0) return ladeTeil(client, uid, teil)
    const binaer = atob(new TextDecoder('latin1').decode(roh).replace(/[^A-Za-z0-9+/=]/g, ''))
    const bytes = new Uint8Array(binaer.length)
    for (let i = 0; i < binaer.length; i++) bytes[i] = binaer.charCodeAt(i)
    return { bytes, meta: {} }
  } catch (err) {
    // deno-lint-ignore no-explicit-any
    if (!client?.usable) throw err as any
    return ladeTeil(client, uid, teil)
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

// Kalender-Einladungen einer Mail (persönliches Postfach) in den CRM-Kalender des Besitzers übernehmen.
// Wirft nie: Jeder Fehler wird nur protokolliert, der Abruf der Mail läuft weiter. Was übernommen wurde,
// steht zur Nachverfolgung in `rohdaten.einladung` der Mail.
const KALENDER_HOECHSTENS = 512 * 1024
async function uebernimmKalenderTeile(admin: Db, client: unknown, uid: number, teile: Teil[], besitzer: string, zeile: Record<string, unknown>): Promise<void> {
  const summe = { angelegt: 0, geaendert: 0, abgesagt: 0, uebersprungen: 0 }
  const schonGelesen = new Set<string>()
  for (const teil of teile.slice(0, 4)) {
    try {
      // Größe in Übertragungsform; eine echte Einladung hat wenige KB.
      if (Number(teil.size ?? 0) > KALENDER_HOECHSTENS * 1.4) continue
      const geladen = await zeitlimit(ladeTeil(client, uid, teil, KALENDER_HOECHSTENS), 20000, 'Der Mail-Server hat die Kalender-Einladung nicht rechtzeitig geliefert.')
      if (!geladen || geladen.bytes.length === 0) continue
      const ics = alsText(geladen.bytes, geladen.meta?.charset ?? teil.parameters?.charset)
      // Outlook legt dieselbe Einladung als Mailteil UND als Anhang bei.
      if (schonGelesen.has(ics)) continue
      schonGelesen.add(ics)
      const z = await uebernehmeEinladung(admin, besitzer, ics)
      summe.angelegt += z.angelegt
      summe.geaendert += z.geaendert
      summe.abgesagt += z.abgesagt
      summe.uebersprungen += z.uebersprungen
    } catch (err) {
      console.error('Kalender-Einladung nicht übernommen', besitzer, uid, (err as Error)?.message ?? err)
    }
  }
  if (summe.angelegt + summe.geaendert + summe.abgesagt > 0) {
    zeile.rohdaten = { ...((zeile.rohdaten as Record<string, unknown> | undefined) ?? {}), einladung: summe }
  }
}

// Holt neue Mails eines Postfachs ab. `nurPruefen` liest nur, schreibt nichts (für Tests).
//
// Bewusst in kleinen Portionen: Rechenzeit und Speicher je Aufruf sind begrenzt, der Zeitplan kommt
// alle paar Minuten wieder. Vor jeder Mail wird vermerkt, an welcher gerade gearbeitet wird — bricht
// der Lauf genau dort ab, wird diese eine Mail beim nächsten Mal nur mit Absender und Betreff
// übernommen, statt das Postfach für immer zu blockieren.
export async function rufePostfachAb(
  admin: Db,
  p: Postfach,
  hoechstens = 8,
  budgetMs = 60000,
  nurPruefen = false,
): Promise<{ neu: number; gesehen: number; offen: number; fehler?: string }> {
  const beginn = Date.now()
  let neu = 0
  let gesehen = 0
  let erledigt = 0

  // Nie zwei Läufe gleichzeitig auf demselben Postfach (Zeitplan, "Jetzt abholen", erster Abruf nach
  // dem Verbinden): Wer anfängt, trägt sich ein; ein anderer Lauf kehrt sofort um. Stirbt ein Lauf,
  // verfällt der Eintrag nach drei Minuten (länger lebt kein Aufruf). `letzter_abruf` wird schon hier
  // gesetzt, damit ein Postfach, an dem der Lauf stirbt, nicht bei jedem Zeitplan-Lauf wieder vorn steht.
  if (!nurPruefen) {
    const jetzt = new Date()
    const { data: belegt, error: sperrFehler } = await admin
      .from('postfaecher')
      .update({ abruf_laeuft_seit: jetzt.toISOString(), letzter_abruf: jetzt.toISOString() })
      .eq('id', p.id)
      .or(`abruf_laeuft_seit.is.null,abruf_laeuft_seit.lt.${new Date(jetzt.getTime() - 180000).toISOString()}`)
      .select('letzte_uid, uid_gueltigkeit, in_arbeit_uid, in_arbeit_ordner, ordner_stand')
    if (sperrFehler) return { neu: 0, gesehen: 0, offen: 0, fehler: sperrFehler.message }
    if (!belegt || belegt.length === 0) return { neu: 0, gesehen: 0, offen: 0 }
    // Mit dem frisch gelesenen Stand arbeiten, nicht mit dem, den der Aufrufer vorher geladen hat.
    p = { ...p, ...belegt[0] }
  }

  // Stand je Ordner: Der Posteingang steht in eigenen Spalten, alle weiteren Ordner in `ordner_stand`.
  let posteingangUid = p.letzte_uid ?? 0
  let posteingangGueltig = p.uid_gueltigkeit
  const ordnerStand: Record<string, OrdnerStand> = { ...(p.ordner_stand ?? {}) }
  const abgebrochenBei = Number(p.in_arbeit_uid ?? 0)
  const abgebrochenIn = p.in_arbeit_ordner ?? POSTEINGANG
  const gemeinsam = !p.besitzer_email
  const standSpalten = () => ({ ...(posteingangUid ? { letzte_uid: posteingangUid, uid_gueltigkeit: posteingangGueltig } : {}), ordner_stand: ordnerStand })
  let bytes = 0
  let bearbeitet = 0
  // Die Portion dieses Laufs ist ausgeschöpft, es liegt aber noch etwas auf dem Server.
  let voll = false
  // deno-lint-ignore no-explicit-any
  let client: any = null

  // Holt einen Ordner ab dem gemerkten Stand ab. Der Fortschritt wird laufend über `merke` festgehalten,
  // damit er auch bei einem Abbruch mitten im Ordner nicht verloren geht.
  const holeOrdner = async (pfad: string, standUid: number, standGueltig: number | null, merke: (uid: number, gueltig: number) => void): Promise<void> => {
    const istPosteingang = pfad === POSTEINGANG
    const sperre = await client.getMailboxLock(pfad)
    try {
      const fach = client.mailbox
      const gueltig = Number(fach?.uidValidity ?? 0)
      const anzahl = Number(fach?.exists ?? 0)
      const neuStart = !standUid || (standGueltig != null && gueltig !== Number(standGueltig))
      let hoechste = neuStart ? 0 : standUid
      // deno-lint-ignore no-explicit-any
      const liste: { uid: number; size: number; envelope: any; bodyStructure: Teil }[] = []
      if (anzahl > 0) {
        const felder = { uid: true, size: true, envelope: true, bodyStructure: true }
        const auflisten = async () => {
          if (neuStart) {
            const ab = Math.max(1, anzahl - (gemeinsam ? ERSTER_ABRUF : ERSTER_ABRUF_EIGENES) + 1)
            for await (const n of client.fetch(`${ab}:*`, felder)) liste.push({ uid: Number(n.uid), size: Number(n.size ?? 0), envelope: n.envelope, bodyStructure: n.bodyStructure })
          } else {
            for await (const n of client.fetch(`${hoechste + 1}:*`, felder, { uid: true })) {
              // "n:*" liefert laut IMAP immer mindestens die letzte Nachricht — auch wenn sie älter ist.
              if (Number(n.uid) > hoechste) liste.push({ uid: Number(n.uid), size: Number(n.size ?? 0), envelope: n.envelope, bodyStructure: n.bodyStructure })
            }
          }
        }
        await zeitlimit(auflisten(), 40000, 'Der Mail-Server hat die Liste der neuen Mails nicht rechtzeitig geliefert.')
      }
      liste.sort((x, y) => x.uid - y.uid)
      gesehen += liste.length
      if (nurPruefen) return
      if (liste.length === 0) {
        // Nichts Neues: Stand auf die zuletzt vergebene Nummer vorziehen. Sonst würde ein Ordner, dessen
        // neueste Mails gelöscht wurden, bei jedem Lauf wieder geöffnet.
        merke(Math.max(hoechste, Number(fach?.uidNext ?? 1) - 1), gueltig)
        return
      }
      await stelleAblageSicher(admin)

      for (const n of liste) {
        if (Date.now() - beginn > budgetMs) {
          voll = true
          break
        }
        const umschlag = n.envelope ?? {}
        // Kleine Mails des Hauptpostfachs kommen über die Weiterleitung — nur weiterzählen. Weitere
        // gemeinsame Postfächer (z. B. info@coach-es.de, seit 19.11.2026) haben keine Weiterleitung:
        // Bei ihnen wird jede Mail hier abgeholt und unten genauso geprüft wie eine weitergeleitete.
        if (gemeinsam && p.id === STANDARD_ID && n.size <= WEITERLEITUNGS_GRENZE) {
          hoechste = n.uid
          merke(hoechste, gueltig)
          erledigt++
          continue
        }
        // Beim ersten Abholen eines Ordners nichts, was älter als ein Jahr ist.
        if (neuStart && !gemeinsam && umschlag.date && Date.now() - new Date(umschlag.date).getTime() > ERSTER_ABRUF_HOECHSTALTER) {
          hoechste = n.uid
          merke(hoechste, gueltig)
          erledigt++
          continue
        }
        if (bearbeitet >= hoechstens || (bearbeitet > 0 && bytes + n.size > BYTES_JE_LAUF)) {
          voll = true
          break
        }
        bytes += n.size
        bearbeitet++
        // Gemeinsam: dieselbe Kennung wie bei der Weiterleitung, damit nichts doppelt erscheint.
        const kennung = gemeinsam && umschlag.messageId ? String(umschlag.messageId) : `${p.id}:${umschlag.messageId ?? (istPosteingang ? n.uid : `${pfad}/${n.uid}`)}`
        const { data: schonDa } = await admin.from('eingegangene_emails').select('id').eq('message_id', kennung).limit(1).maybeSingle()
        if (!schonDa) {
          const von = umschlag.from?.[0]
          // deno-lint-ignore no-explicit-any
          const adressen = (wer: any) => (Array.isArray(wer) ? wer.map((x: any) => x?.address).filter(Boolean).join(', ') : '')
          const zeile: Record<string, unknown> = {
            message_id: kennung,
            von: String(von?.address ?? 'unbekannt').toLowerCase(),
            von_name: von?.name || von?.address || 'Unbekannt',
            betreff: umschlag.subject ?? '(ohne Betreff)',
            mail_datum: sicheresDatum(umschlag.date),
            rohdaten: { quelle: 'imap', uid: n.uid, an: adressen(umschlag.to), cc: adressen(umschlag.cc), ...(istPosteingang ? {} : { ordner: pfad }) },
            postfach_id: p.id,
            besitzer_email: p.besitzer_email,
          }
          const hierAbgebrochen = n.uid === abgebrochenBei && pfad === abgebrochenIn
          if (n.size > ZU_GROSS || hierAbgebrochen) {
            zeile.ausschnitt = hierAbgebrochen
              ? '(Der Inhalt dieser Mail ließ sich nicht ins CRM übernehmen. Bitte im Mail-Programm öffnen.)'
              : `(Diese Mail ist mit ${(n.size / 1024 / 1024).toFixed(0)} MB zu groß für das CRM. Inhalt und Anhänge bitte im Mail-Programm öffnen.)`
          } else try {
            await admin.from('postfaecher').update({ in_arbeit_uid: n.uid, in_arbeit_ordner: pfad, ...standSpalten() }).eq('id', p.id)
            const { text: textTeil, html: htmlTeil, anhaenge: anhangTeile, kalender: kalenderTeile } = gliedere(n.bodyStructure)
            let text = ''
            const quelle = textTeil ?? htmlTeil
            if (quelle) {
              const geladen = await zeitlimit(ladeTeil(client, n.uid, quelle, 300000), 30000, 'Der Mail-Server hat den Text der Mail nicht rechtzeitig geliefert.')
              if (geladen) {
                const roh = alsText(geladen.bytes, geladen.meta?.charset ?? quelle.parameters?.charset)
                text = quelle === textTeil ? roh.trim() : textAusHtml(roh)
              }
            }
            const anhaenge: { filename: string; size: number; contentType: string; url: string }[] = []
            const ausgelassen: string[] = []
            let anhangBytes = 0
            for (const teil of anhangTeile) {
              // Die Gliederung nennt die Größe in der Übertragungsform (etwa ein Drittel mehr als die Datei).
              const etwa = Math.round(Number(teil.size ?? 0) / 1.37)
              if (etwa > ANHANG_HOECHSTENS || anhangBytes + etwa > ANHAENGE_JE_MAIL) {
                ausgelassen.push(`${String(teil.dispositionParameters?.filename ?? teil.parameters?.name ?? 'Anhang')} (${(etwa / 1024 / 1024).toFixed(1)} MB)`)
                continue
              }
              const geladen = await zeitlimit(ladeAnhang(client, n.uid, teil), 50000, 'Der Mail-Server hat einen Anhang nicht rechtzeitig geliefert.')
              if (!geladen || geladen.bytes.length === 0) continue
              anhangBytes += geladen.bytes.length
              const anzeige = String(geladen.meta?.filename ?? teil.dispositionParameters?.filename ?? teil.parameters?.name ?? 'anhang')
              const inhaltsart = String(teil.type ?? geladen.meta?.contentType ?? 'application/octet-stream')
              // Unterordner bekommen einen eigenen Abschnitt im Pfad: Nummern beginnen in jedem Ordner neu.
              const pfadTeil = istPosteingang ? `${n.uid}` : `${sicherername(pfad)}/${n.uid}`
              const ablagePfadPrivat = `${p.id}/${pfadTeil}/${anhaenge.length + 1}_${sicherername(anzeige)}`
              const ablage = gemeinsam ? OEFFENTLICHE_ABLAGE : ANHANG_ABLAGE
              // Öffentliche Ablage: Pfad mit Zufallsanteil, damit sich Adressen nicht erraten lassen.
              const ablagePfad = gemeinsam ? `postfach/${crypto.randomUUID()}/${anhaenge.length + 1}_${sicherername(anzeige)}` : ablagePfadPrivat
              const { error: ladeFehler } = await admin.storage.from(ablage).upload(ablagePfad, geladen.bytes, { contentType: inhaltsart, upsert: true })
              if (ladeFehler) {
                console.error('Anhang konnte nicht abgelegt werden', ablagePfadPrivat, ladeFehler.message)
                continue
              }
              const url = gemeinsam ? admin.storage.from(ablage).getPublicUrl(ablagePfad).data.publicUrl : `${ANHANG_VORSATZ}${ablagePfadPrivat}`
              anhaenge.push({ filename: anzeige, size: geladen.bytes.length, contentType: inhaltsart, url })
            }
            // Persönliches Postfach: Kalender-Einladungen in den CRM-Kalender des Besitzers übernehmen.
            // Gemeinsame Postfächer nicht (kein Besitzer). Ein Fehler hier darf den Abruf nie aufhalten.
            if (!gemeinsam && p.besitzer_email && kalenderTeile.length > 0) {
              await uebernimmKalenderTeile(admin, client, n.uid, kalenderTeile, p.besitzer_email, zeile)
            }
            const vermerk = ausgelassen.length > 0 ? `\n\n[Nicht ins CRM übernommen, weil zu groß: ${ausgelassen.join(', ')}. Bitte im Mail-Programm öffnen.]` : ''
            zeile.ausschnitt = text.slice(0, 20000 - vermerk.length) + vermerk
            zeile.anhaenge = anhaenge.length > 0 ? anhaenge : null
          } catch (mailFehler) {
            // Verbindung weg oder Zeitgrenze: nichts speichern, der nächste Lauf versucht dieselbe Mail
            // noch einmal vollständig. Liegt es an der Mail selbst, bleibt wenigstens die Kurzfassung.
            // deno-lint-ignore no-explicit-any
            const m = mailFehler as any
            if (!client?.usable || /rechtzeitig|Zeitüberschreitung/.test(String(m?.message ?? ''))) throw mailFehler
            console.error('Mail-Inhalt nicht übernehmbar', p.id, pfad, n.uid, m?.message)
            zeile.ausschnitt = '(Der Inhalt dieser Mail ließ sich nicht ins CRM übernehmen. Bitte im Mail-Programm öffnen.)'
            zeile.anhaenge = null
          }
          // Gemeinsame Postfächer: dieselbe Prüfung wie beim Eingang über die Weiterleitung (inbound-email) —
          // Newsletter/Werbung ausblenden, eindeutige Absender der Akte zuordnen, Lieferantenrechnungen
          // als Verbindlichkeit. Ein Fehler dort verhindert das Speichern der Mail nicht.
          if (gemeinsam) {
            const pruefung = await pruefeNeueMail(admin, {
              messageId: kennung,
              von: String(zeile.von),
              vonName: String(zeile.von_name),
              betreff: String(zeile.betreff),
              text: String(zeile.ausschnitt ?? ''),
              anhaenge: (zeile.anhaenge as { filename: string; size: number; contentType: string; url: string }[] | null) ?? [],
            })
            zeile.relevanz = pruefung.relevanz
            if (pruefung.zuordnung) {
              zeile.zugewiesener_kunde_id = pruefung.zuordnung.kundeId
              zeile.zugewiesener_bereich = pruefung.zuordnung.bereich
              zeile.zugewiesener_kunde_name = pruefung.zuordnung.kundeName
            }
          }
          const { error } = await admin.from('eingegangene_emails').insert(zeile)
          // 23505 = dieselbe Mail wurde gerade von einem gleichzeitigen Lauf gespeichert — kein Fehler.
          if (error && error.code !== '23505') throw new Error(`Mail konnte nicht gespeichert werden: ${error.message}`)
          if (!error) neu++
        }
        hoechste = n.uid
        merke(hoechste, gueltig)
        erledigt++
      }
      // Ordner ganz durch, aber nichts Neues gespeichert (alles schon da): Stand trotzdem festhalten.
      if (!voll) merke(hoechste, gueltig)
    } finally {
      sperre.release()
    }
  }

  try {
    client = new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: await passwortVon(admin, p) }, logger: false })
    client.on('error', () => {})
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')

    await holeOrdner(POSTEINGANG, posteingangUid, posteingangGueltig, (uid, gueltig) => {
      posteingangUid = uid
      posteingangGueltig = gueltig
    })

    // Persönliche Postfächer: auch die eigenen Ordner, in die der Besitzer seine Mails sortiert.
    // Gesendet, Entwürfe, Papierkorb und Spam bleiben außen vor. Gemeinsame Postfächer: nur Posteingang.
    if (!gemeinsam && !nurPruefen && !voll) {
      // deno-lint-ignore no-explicit-any
      const ordner: any[] = await zeitlimit(client.list({ statusQuery: { messages: true, uidNext: true, uidValidity: true } }), 30000, 'Der Mail-Server hat die Ordnerliste nicht rechtzeitig geliefert.')
      const vorhandene = new Set<string>()
      for (const o of ordner) {
        if (!istEigenerOrdner(o)) continue
        const pfad = String(o.path)
        vorhandene.add(pfad)
        const stand = ordnerStand[pfad]
        const naechste = Number(o.status?.uidNext ?? 0)
        const gueltig = Number(o.status?.uidValidity ?? 0)
        // Nichts Neues in diesem Ordner: gar nicht erst öffnen.
        if (stand && naechste > 0 && stand.g === gueltig && stand.uid >= naechste - 1) continue
        if (Number(o.status?.messages ?? 0) === 0) {
          ordnerStand[pfad] = { uid: 0, g: gueltig }
          continue
        }
        if (voll || Date.now() - beginn > budgetMs) {
          voll = true
          break
        }
        await holeOrdner(pfad, stand?.uid ?? 0, stand ? stand.g : null, (uid, g) => {
          ordnerStand[pfad] = { uid, g }
        })
      }
      // Auf dem Server gelöschte oder umbenannte Ordner aus dem Stand nehmen.
      if (!voll) for (const pfad of Object.keys(ordnerStand)) if (!vorhandene.has(pfad)) delete ordnerStand[pfad]
    }

    await client.logout().catch(() => {})
    client = null
    if (nurPruefen) return { neu: 0, gesehen, offen: gesehen }
    await admin
      .from('postfaecher')
      .update({ letzte_uid: posteingangUid || null, uid_gueltigkeit: posteingangGueltig, ordner_stand: ordnerStand, in_arbeit_uid: null, in_arbeit_ordner: null, abruf_laeuft_seit: null, letzter_abruf: new Date().toISOString(), letzter_fehler: null })
      .eq('id', p.id)
    return { neu, gesehen, offen: voll ? Math.max(1, gesehen - erledigt) : 0 }
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
        .update({ ...standSpalten(), in_arbeit_uid: null, in_arbeit_ordner: null, abruf_laeuft_seit: null, letzter_abruf: new Date().toISOString(), letzter_fehler: String(meldung).slice(0, 500) })
        .eq('id', p.id)
    }
    return { neu, gesehen, offen: Math.max(0, gesehen - erledigt), fehler: String(meldung) }
  }
}

// Welche Ordner hat das Postfach auf dem Mail-Server, und wie viele Mails liegen darin? Dient der
// Klärung, wenn im CRM weniger Mails erscheinen als erwartet (abgeholt wird der Posteingang).
// `mitNamen` nur für den Besitzer: Ordnernamen eines fremden Postfachs sind privat, andere sehen
// nur die Art des Ordners und die Anzahl.
export async function listeOrdner(admin: Db, p: Postfach, mitNamen: boolean): Promise<{ ordner: { name: string; art: string; mails: number; wirdAbgeholt: boolean }[] } | { fehler: string }> {
  // deno-lint-ignore no-explicit-any
  let client: any = null
  try {
    client = new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: await passwortVon(admin, p) }, logger: false })
    client.on('error', () => {})
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')
    // deno-lint-ignore no-explicit-any
    const liste: any[] = await zeitlimit(client.list({ statusQuery: { messages: true } }), 30000, 'Der Mail-Server hat die Ordnerliste nicht rechtzeitig geliefert.')
    await client.logout().catch(() => {})
    client = null
    const arten: Record<string, string> = { '\\Inbox': 'Posteingang', '\\Sent': 'Gesendet', '\\Drafts': 'Entwürfe', '\\Trash': 'Papierkorb', '\\Junk': 'Spam', '\\Archive': 'Archiv', '\\All': 'Alle Mails' }
    let eigene = 0
    const ordner = liste
      .filter((o) => !(o.flags instanceof Set && o.flags.has('\\Noselect')))
      .map((o) => {
        const art = String(o.path).toUpperCase() === 'INBOX' ? 'Posteingang' : arten[String(o.specialUse ?? '')] ?? 'eigener Ordner'
        const name = mitNamen || art !== 'eigener Ordner' ? String(o.path) : `Ordner ${++eigene}`
        const posteingang = String(o.path).toUpperCase() === POSTEINGANG
        return { name, art, mails: Number(o.status?.messages ?? 0), wirdAbgeholt: posteingang || (!!p.besitzer_email && istEigenerOrdner(o)) }
      })
    return { ordner }
  } catch (err) {
    try {
      client?.close()
    } catch {
      // schon geschlossen
    }
    // deno-lint-ignore no-explicit-any
    return { fehler: (err as any)?.message ?? String(err) }
  }
}

// Aufbau der ersten Mails eines Ordners — nur Größen und Dateiarten, keine Namen, kein Inhalt. Dient
// der Klärung, wenn der Abruf an einer bestimmten Mail hängen bleibt. `nr` zählt die Ordner so, wie
// listeOrdner sie ausgibt (ab 0).
export async function pruefeOrdnerAufbau(admin: Db, p: Postfach, nr: number, abUid = 1): Promise<unknown> {
  // deno-lint-ignore no-explicit-any
  let client: any = null
  try {
    client = new ImapFlow({ host: p.imap_host, port: p.imap_port, secure: p.imap_port === 993, auth: { user: p.benutzer || p.adresse, pass: await passwortVon(admin, p) }, logger: false })
    client.on('error', () => {})
    await zeitlimit(client.connect(), 20000, 'Der Mail-Server hat nach 20 Sekunden nicht geantwortet.')
    // deno-lint-ignore no-explicit-any
    const liste: any[] = (await client.list()).filter((o: any) => !(o.flags instanceof Set && o.flags.has('\\Noselect')))
    const ordner = liste[nr]
    if (!ordner) return { fehler: 'Diesen Ordner gibt es nicht.' }
    const sperre = await client.getMailboxLock(ordner.path)
    const mails: unknown[] = []
    try {
      for await (const n of client.fetch(`${abUid}:${abUid + 4}`, { uid: true, size: true, bodyStructure: true }, { uid: true })) {
        const teile: string[] = []
        // deno-lint-ignore no-explicit-any
        const gehe = (k: any, tiefe: number) => {
          if (!k) return
          teile.push(`${'>'.repeat(tiefe)}${k.part ?? '-'} ${k.type} ${k.encoding ?? ''} ${Math.round(Number(k.size ?? 0) / 1024)}KB ${k.disposition ?? ''}${k.dispositionParameters?.filename || k.parameters?.name ? ' mit-Namen' : ''}`)
          // deno-lint-ignore no-explicit-any
          if (Array.isArray(k.childNodes)) k.childNodes.forEach((c: any) => gehe(c, tiefe + 1))
        }
        gehe(n.bodyStructure, 0)
        mails.push({ uid: Number(n.uid), kb: Math.round(Number(n.size ?? 0) / 1024), teile })
      }
    } finally {
      sperre.release()
    }
    await client.logout().catch(() => {})
    return { mails }
  } catch (err) {
    try {
      client?.close()
    } catch {
      // schon geschlossen
    }
    // deno-lint-ignore no-explicit-any
    return { fehler: (err as any)?.message ?? String(err) }
  }
}

// Welche Postfächer sind abzuholen? Das am längsten nicht abgerufene zuerst; persönliche nur, solange
// ihr Besitzer ein aktiver Mitarbeiter ist.
export async function abzuholendePostfaecher(admin: Db): Promise<Postfach[]> {
  const { data } = await admin.from('postfaecher').select('*').eq('aktiv', true).order('letzter_abruf', { ascending: true, nullsFirst: true })
  const { data: team } = await admin.from('mitarbeiter').select('email').eq('aktiv', true)
  const aktive = new Set(((team ?? []) as { email: string }[]).map((m) => String(m.email).toLowerCase()))
  return ((data ?? []) as Postfach[]).filter((p) => !p.besitzer_email || aktive.has(p.besitzer_email.toLowerCase()))
}

// Holt die Postfächer der Reihe nach ab (Hauptpostfach: nur große Mails) — alle oder nur das genannte.
// Der Zeitplan ruft je Postfach einzeln auf: Jeder Aufruf hat nur begrenzte Rechenzeit, und ein
// Postfach mit großen Anhängen soll sie nicht mit den anderen teilen müssen.
export async function rufeAlleAb(admin: Db, budgetMs = 110000, nurId?: string): Promise<{ postfaecher: number; neu: number; offen: boolean; fehler: string[] }> {
  const beginn = Date.now()
  let neu = 0
  let anzahl = 0
  let offen = false
  const fehler: string[] = []
  for (const p of await abzuholendePostfaecher(admin)) {
    if (nurId && p.id !== nurId) continue
    const rest = budgetMs - (Date.now() - beginn)
    if (rest < 25000) break
    const ergebnis = await rufePostfachAb(admin, p, 8, Math.min(rest - 15000, 45000))
    anzahl++
    neu += ergebnis.neu
    // Nur wo es voranging und noch etwas liegt — ein Postfach mit Fehler stößt keine Kette an.
    if (!ergebnis.fehler && ergebnis.neu > 0 && ergebnis.offen > 0) offen = true
    if (ergebnis.fehler) fehler.push(`${p.adresse}: ${ergebnis.fehler}`)
  }
  return { postfaecher: anzahl, neu, offen, fehler }
}

// ---------- Öffentliche Mails Kundenakten zuordnen ----------

type MailAnhang = { filename?: string; size?: number; contentType?: string; url?: string }

// Ordnet eine Mail aus dem gemeinsamen Postfach einer Kundenakte zu und legt ihre Anhänge in die
// Dokumente der Akte — erst dort kann der Assistent sie lesen und kann eine Analyse darauf zugreifen.
// `mailId` ist die Zeilen-Kennung oder die Message-ID der Mail.
export async function ordneMailZu(
  admin: Db,
  mailId: string,
  kundeId: string,
  wer: string,
): Promise<{ ok: true; betreff: string; kundeName: string; abgelegt: number } | { ok: false; fehler: string }> {
  const spalten = 'id, message_id, von_name, betreff, anhaenge, relevanz, zugewiesener_kunde_id'
  let { data: mail } = await admin.from('eingegangene_emails').select(spalten).eq('message_id', mailId).is('besitzer_email', null).limit(1).maybeSingle()
  if (!mail && /^[0-9a-f-]{36}$/i.test(mailId)) {
    mail = (await admin.from('eingegangene_emails').select(spalten).eq('id', mailId).is('besitzer_email', null).maybeSingle()).data
  }
  if (!mail) return { ok: false, fehler: 'Diese Mail liegt nicht im gemeinsamen Postfach.' }
  const { data: kunde } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, dokumente, activities').eq('id', kundeId).neq('bereich', 'privat').maybeSingle()
  if (!kunde) return { ok: false, fehler: 'Diese Kundenakte gibt es nicht.' }

  const heute = new Date().toISOString().slice(0, 10)
  const vorhanden = new Set(((kunde.dokumente ?? []) as { url?: string }[]).map((d) => d.url).filter(Boolean))
  const neueDokumente = ((mail.anhaenge ?? []) as MailAnhang[])
    // Nur was öffentlich abgelegt ist; winzige Bilder sind Logos aus der Signatur, keine Unterlagen.
    .filter((a) => typeof a.url === 'string' && /^https?:/.test(a.url) && !vorhanden.has(a.url))
    .filter((a) => !(String(a.contentType ?? '').startsWith('image/') && Number(a.size ?? 0) < 15 * 1024))
    .map((a) => {
      const bytes = Number(a.size ?? 0)
      return {
        id: crypto.randomUUID(),
        name: a.filename || 'Anhang',
        typ: a.contentType || 'application/octet-stream',
        datum: heute,
        groesse: bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
        url: a.url,
      }
    })
  const kundeName = kunde.ansprechpartner && kunde.ansprechpartner !== kunde.firma ? `${kunde.firma} (${kunde.ansprechpartner})` : kunde.firma
  const schonHier = mail.zugewiesener_kunde_id === kunde.id
  if (!schonHier || neueDokumente.length > 0) {
    const text = `E-Mail zugeordnet: „${mail.betreff ?? '(ohne Betreff)'}" von ${mail.von_name ?? 'unbekannt'}${neueDokumente.length > 0 ? ` (${neueDokumente.length} ${neueDokumente.length === 1 ? 'Anhang' : 'Anhänge'} in Dokumente abgelegt)` : ''}`
    const { error: kundeFehler } = await admin
      .from('kunden')
      .update({
        dokumente: [...neueDokumente, ...((kunde.dokumente ?? []) as unknown[])],
        activities: [{ id: crypto.randomUUID(), date: heute, text, user: wer }, ...((kunde.activities ?? []) as unknown[])],
        letzte_aktivitaet: heute,
      })
      .eq('id', kunde.id)
    if (kundeFehler) return { ok: false, fehler: `Die Akte ließ sich nicht ergänzen: ${kundeFehler.message}` }
  }
  const { error } = await admin
    .from('eingegangene_emails')
    .update({ zugewiesener_kunde_id: kunde.id, zugewiesener_bereich: kunde.bereich, zugewiesener_kunde_name: kundeName, ...(mail.relevanz ? {} : { relevanz: 'kunde' }) })
    .eq('id', mail.id)
  if (error) return { ok: false, fehler: `Die Zuordnung ließ sich nicht speichern: ${error.message}` }
  return { ok: true, betreff: mail.betreff ?? '', kundeName, abgelegt: neueDokumente.length }
}

// Läuft mit dem Zeitplan: Mails der letzten Tage im gemeinsamen Postfach, die noch keiner Akte
// zugeordnet sind, kommen zur Akte ihres Absenders — sofern dessen Adresse zu genau einer Akte gehört.
// Schließt zwei Lücken: Mails, die über den Postfach-Abruf kommen (die großen, mit Anhängen), und die
// erste Mail eines Absenders, aus der die Akte erst danach automatisch angelegt wurde.
export async function ordneOffeneMailsZu(admin: Db, tage = 3): Promise<{ zugeordnet: number; fehler: string[] }> {
  const seit = new Date(Date.now() - tage * 86400000).toISOString()
  const { data: mails } = await admin
    .from('eingegangene_emails')
    .select('id, von, ignoriert')
    .is('besitzer_email', null)
    .is('zugewiesener_kunde_id', null)
    .or('relevanz.is.null,relevanz.neq.nicht_relevant')
    .gte('erstellt_am', seit)
    .order('erstellt_am', { ascending: true })
    .limit(60)
  const offene = ((mails ?? []) as { id: string; von: string | null; ignoriert: boolean | null }[]).filter((m) => !m.ignoriert && m.von)
  if (offene.length === 0) return { zugeordnet: 0, fehler: [] }
  const [{ data: kunden }, { data: team }] = await Promise.all([
    admin.from('kunden').select('id, email').neq('bereich', 'privat'),
    admin.from('mitarbeiter').select('email'),
  ])
  const intern = new Set(((team ?? []) as { email: string | null }[]).map((m) => String(m.email ?? '').trim().toLowerCase()))
  const jeAdresse = new Map<string, string[]>()
  for (const k of (kunden ?? []) as { id: string; email: string | null }[]) {
    const adresse = String(k.email ?? '').trim().toLowerCase()
    if (!adresse.includes('@')) continue
    jeAdresse.set(adresse, [...(jeAdresse.get(adresse) ?? []), k.id])
  }
  let zugeordnet = 0
  const fehler: string[] = []
  for (const m of offene) {
    const von = String(m.von).trim().toLowerCase()
    if (intern.has(von)) continue
    const akten = jeAdresse.get(von) ?? []
    if (akten.length !== 1) continue
    const ergebnis = await ordneMailZu(admin, m.id, akten[0], 'System (automatische E-Mail-Zuordnung)')
    if (ergebnis.ok) zugeordnet++
    else fehler.push(ergebnis.fehler)
  }
  return { zugeordnet, fehler }
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
  const { data } = await admin.from('eingegangene_emails').select('id, betreff, besitzer_email, anhaenge').eq('message_id', id).maybeSingle()
  if (!data || String(data.besitzer_email ?? '').toLowerCase() !== a.email) return { ok: false, fehler: 'Diese Mail liegt nicht in deinem privaten Postfach.' }
  const anhaenge = await veroeffentlicheAnhaenge(admin, data.anhaenge)
  const { error } = await admin
    .from('eingegangene_emails')
    .update({
      besitzer_email: null,
      ignoriert: false,
      anhaenge,
      ...(kunde ? { zugewiesener_bereich: kunde.bereich, zugewiesener_kunde_id: kunde.id, zugewiesener_kunde_name: kunde.name ?? null } : {}),
    })
    .eq('id', data.id)
  if (error) return { ok: false, fehler: error.message }
  return { ok: true, betreff: data.betreff ?? '' }
}

// Wechselt ein Mitarbeiter seine Login-Adresse, zieht alles Private mit um — sonst wäre sein privater
// Bereich leer, und wer die alte Adresse später bekommt, würde ihn erben.
export async function zieheBesitzUm(admin: Db, alt: string, neu: string): Promise<void> {
  const von = alt.trim().toLowerCase()
  const nach = neu.trim().toLowerCase()
  if (!von || !nach || von === nach) return
  for (const tabelle of ['postfaecher', 'eingegangene_emails', 'gesendete_emails']) {
    const { error } = await admin.from(tabelle).update({ besitzer_email: nach }).eq('besitzer_email', von)
    if (error) console.error('Besitz-Umzug fehlgeschlagen', tabelle, error.message)
  }
  const { error } = await admin.from('kunden').update({ verantwortlich_email: nach }).eq('bereich', 'privat').eq('verantwortlich_email', von)
  if (error) console.error('Besitz-Umzug fehlgeschlagen', 'kunden', error.message)
}

// Zieht die Anhänge einer Mail aus der privaten Ablage in die der öffentlichen Mails um, damit sie
// danach wie jeder andere Mail-Anhang funktionieren (Akte, Einlesen, Assistent).
// deno-lint-ignore no-explicit-any
export async function veroeffentlicheAnhaenge(admin: Db, anhaenge: any): Promise<any> {
  if (!Array.isArray(anhaenge) || anhaenge.length === 0) return anhaenge ?? null
  const ergebnis = []
  for (const anhang of anhaenge) {
    const verweis = String(anhang?.url ?? '')
    if (!verweis.startsWith(ANHANG_VORSATZ)) {
      ergebnis.push(anhang)
      continue
    }
    const pfad = verweis.slice(ANHANG_VORSATZ.length)
    const ziel = `postfach/${crypto.randomUUID()}/${pfad.split('/').pop()}`
    const { data: datei, error: leseFehler } = await admin.storage.from(ANHANG_ABLAGE).download(pfad)
    if (leseFehler || !datei) {
      console.error('Anhang konnte nicht umgezogen werden', pfad, leseFehler?.message)
      ergebnis.push(anhang)
      continue
    }
    const { error: schreibFehler } = await admin.storage.from(OEFFENTLICHE_ABLAGE).upload(ziel, datei, { contentType: anhang.contentType || 'application/octet-stream', upsert: true })
    if (schreibFehler) {
      console.error('Anhang konnte nicht umgezogen werden', pfad, schreibFehler.message)
      ergebnis.push(anhang)
      continue
    }
    await admin.storage.from(ANHANG_ABLAGE).remove([pfad])
    ergebnis.push({ ...anhang, url: admin.storage.from(OEFFENTLICHE_ABLAGE).getPublicUrl(ziel).data.publicUrl })
  }
  return ergebnis
}

// Dateien der gemeinsamen Ablage (Anhänge des gemeinsamen Postfachs, Dateien aus Telegram und aus dem
// Assistenten) tragen in Akten und Mails ihre frühere, offen abrufbare Adresse. Die Ablage ist nicht mehr
// offen; die Adresse dient nur noch als Kennung, aus der hier der Pfad in der Ablage wird.
export function gemeinsamerAblagePfad(url: string): string | null {
  const basis = `${Deno.env.get('SUPABASE_URL') ?? ''}/storage/v1/object/`
  if (typeof url !== 'string' || basis.length < 30 || !url.startsWith(basis)) return null
  const treffer = url.slice(basis.length).split(/[?#]/)[0].match(/^(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
  if (!treffer || treffer[1] !== OEFFENTLICHE_ABLAGE) return null
  try {
    const pfad = decodeURIComponent(treffer[2])
    return istSichererPfad(pfad) ? pfad : null
  } catch {
    return null
  }
}

export async function ladeGemeinsameDatei(admin: Db, pfad: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(OEFFENTLICHE_ABLAGE).download(pfad)
  if (error || !data) throw new Error(`Datei nicht abrufbar (${error?.message ?? 'unbekannt'})`)
  return new Uint8Array(await data.arrayBuffer())
}

// Zeitlich begrenzter Link auf eine Datei. Gemeinsame Ablage: jeder angemeldete Mitarbeiter, zehn
// Minuten. Persönliches Postfach: nur wenn der Fragende die zugehörige Mail sehen darf.
export async function anhangUrl(admin: Db, a: Aufrufer, verweis: string): Promise<string | null> {
  const gemeinsam = gemeinsamerAblagePfad(verweis)
  if (gemeinsam) {
    const { data: link } = await admin.storage.from(OEFFENTLICHE_ABLAGE).createSignedUrl(gemeinsam, 600)
    return link?.signedUrl ?? null
  }
  if (!verweis.startsWith(ANHANG_VORSATZ)) return null
  const pfad = verweis.slice(ANHANG_VORSATZ.length)
  const fach = pfad.split('/')[0]
  const { data } = await admin.from('eingegangene_emails').select('besitzer_email').eq('postfach_id', fach).contains('anhaenge', JSON.stringify([{ url: verweis }]))
  const sichtbar = ((data ?? []) as { besitzer_email: string | null }[]).some((m) => !m.besitzer_email || m.besitzer_email.toLowerCase() === a.email)
  if (!sichtbar) return null
  const { data: link } = await admin.storage.from(ANHANG_ABLAGE).createSignedUrl(pfad, 3600)
  return link?.signedUrl ?? null
}
