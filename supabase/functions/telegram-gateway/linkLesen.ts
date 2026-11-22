// Links öffnen (Wunsch aus der Wunsch-Auswertung vom 22.11.2026: Andreas schickte einen Link auf eine
// Word-Datei, der Assistent konnte ihn nicht öffnen). Das Werkzeug link_oeffnen holt eine öffentliche
// Adresse ab:
// - Ist es eine Datei (PDF, Word, Excel, Bild …), wird sie wie ein Telegram-Eingang unter "telegram/…"
//   gespeichert. Danach funktionieren datei_lesen, dateien_ablegen und dateien_ins_objekt wie gewohnt.
// - Ist es eine Webseite, kommt der lesbare Text zurück (gekürzt).
// Freigabe-Links von Google Drive und Dropbox werden auf den direkten Download umgestellt.
// Schutz: nur https, keine IP-Adressen, keine internen Namen, höchstens 3 Weiterleitungen (jede neu
// geprüft), 20 MB, 20 Sekunden. Angemeldete Seiten (Google-Konto, Outlook) lassen sich nicht öffnen —
// das Ergebnis sagt dann, dass der Mitarbeiter die Datei direkt schicken soll.

export const LINK_WERKZEUGE = [
  {
    name: 'link_oeffnen',
    description:
      'Öffnet einen Link, den der Mitarbeiter schickt (z. B. auf eine Word- oder PDF-Datei, einen Google-Drive- oder Dropbox-Freigabelink oder eine Webseite). Eine Datei wird gespeichert wie ein Datei-Eingang und liefert einen pfad="telegram/…" — danach mit datei_lesen lesen und auf Wunsch mit dateien_ablegen bzw. dateien_ins_objekt ablegen. Bei einer Webseite kommt der lesbare Text zurück. Links, die eine Anmeldung brauchen, gehen nicht.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Der Link genau wie geschickt.' },
      },
      required: ['url'],
    },
  },
]

export const istLinkWerkzeug = (name: string) => name === 'link_oeffnen'

export type LinkKontext = {
  /** Speichert Bytes wie einen Telegram-Eingang und liefert den pfad (oder null bei Fehler). */
  speichere: (bytes: Uint8Array, dateiname: string, contentType: string) => Promise<string | null>
  protokolliere: (text: string) => void
  abruf?: typeof fetch
}

const MAX_BYTES = 20 * 1024 * 1024
const MAX_TEXT = 15000

/** Macht aus der Eingabe eine abrufbare https-Adresse oder liefert eine Fehlermeldung. */
export function pruefeLink(eingabe: string): { ok: true; url: string } | { ok: false; fehler: string } {
  let roh = String(eingabe ?? '').trim().replace(/^<|>$/g, '')
  if (!roh) return { ok: false, fehler: 'Es fehlt der Link.' }
  if (roh.length > 4000) return { ok: false, fehler: 'Der Link ist zu lang.' }
  if (!/^[a-z]+:\/\//i.test(roh)) roh = `https://${roh}`
  roh = roh.replace(/^http:\/\//i, 'https://')
  let u: URL
  try {
    u = new URL(roh)
  } catch {
    return { ok: false, fehler: 'Das ist kein gültiger Link.' }
  }
  if (u.protocol !== 'https:') return { ok: false, fehler: 'Nur Links mit https:// lassen sich öffnen.' }
  if (u.username || u.password) return { ok: false, fehler: 'Links mit Benutzername oder Passwort werden nicht unterstützt.' }
  if (u.port && u.port !== '443') return { ok: false, fehler: 'Dieser Link wird nicht unterstützt (ungewöhnlicher Anschluss).' }
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) {
    return { ok: false, fehler: 'Links auf IP-Adressen werden nicht geöffnet.' }
  }
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host) || host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) {
    return { ok: false, fehler: 'Dieser Link ist nicht erreichbar.' }
  }
  return { ok: true, url: direkterDownload(u).toString() }
}

/** Freigabe-Links auf den direkten Download umstellen (Google Drive/Docs, Dropbox). */
export function direkterDownload(u: URL): URL {
  const host = u.hostname.toLowerCase()
  if (host === 'drive.google.com') {
    const id = /\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id')
    if (id) return new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`)
  }
  if (host === 'docs.google.com') {
    const m = /\/(document|spreadsheets|presentation)\/d\/([^/]+)/.exec(u.pathname)
    if (m) {
      const format = m[1] === 'document' ? 'docx' : m[1] === 'spreadsheets' ? 'xlsx' : 'pptx'
      return new URL(`https://docs.google.com/${m[1]}/d/${encodeURIComponent(m[2])}/export?format=${format}`)
    }
  }
  if (host.endsWith('dropbox.com')) {
    const n = new URL(u.toString())
    n.searchParams.set('dl', '1')
    return n
  }
  return u
}

/** Dateiname aus Content-Disposition, sonst aus der Adresse, sonst „Datei“ + passende Endung. */
export function dateinameVon(url: string, disposition: string | null, contentType: string): string {
  const d = disposition ?? ''
  const stern = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(d)?.[1]
  const einfach = /filename\s*=\s*"?([^";]+)"?/i.exec(d)?.[1]
  let name = ''
  try {
    name = stern ? decodeURIComponent(stern.trim().replace(/^"|"$/g, '')) : (einfach ?? '').trim()
  } catch {
    name = (einfach ?? '').trim()
  }
  if (!name) {
    try {
      const letzt = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
      if (/\.[a-z0-9]{2,5}$/i.test(letzt)) name = letzt
    } catch { /* bleibt leer */ }
  }
  if (!name) name = `Datei${ENDUNG[contentType.split(';')[0].trim().toLowerCase()] ?? ''}`
  return name.replace(/[\\/\0]/g, '_').slice(0, 150)
}

const ENDUNG: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'text/plain': '.txt',
  'text/csv': '.csv',
}

/** Lesbarer Text einer HTML-Seite (ohne Skripte, Stile, Navigation). */
export function textAusHtml(html: string): { titel: string; text: string } {
  const titel = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
  return { titel: entitaeten(titel), text }
}

const entitaeten = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

/** Zeichen einer Anmeldeseite (Google, Microsoft …) — dann ist der Link nicht öffentlich. */
function istAnmeldeseite(url: string, titel: string): boolean {
  return /accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|\/signin|\/login/i.test(url) || /^(anmelden|sign in|login)\b/i.test(titel)
}

async function holeMitWeiterleitung(start: string, abruf: typeof fetch): Promise<Response | { fehler: string; url?: string }> {
  let url = start
  for (let i = 0; i <= 3; i++) {
    const antwort = await abruf(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (CRM-Assistent)', accept: '*/*' } })
    if (antwort.status >= 300 && antwort.status < 400 && antwort.headers.get('location')) {
      const ziel = new URL(antwort.headers.get('location')!, url).toString()
      await antwort.body?.cancel().catch(() => undefined)
      const p = pruefeLink(ziel)
      if (!p.ok) return { fehler: p.fehler, url: ziel }
      if (istAnmeldeseite(ziel, '')) return { fehler: 'Der Link führt auf eine Anmeldeseite — die Datei ist nicht öffentlich.', url: ziel }
      url = p.url
      continue
    }
    return antwort
  }
  return { fehler: 'Zu viele Weiterleitungen.' }
}

async function leseBegrenzt(antwort: Response): Promise<Uint8Array | null> {
  const laenge = Number(antwort.headers.get('content-length') ?? '0')
  if (laenge > MAX_BYTES) return null
  const leser = antwort.body?.getReader()
  if (!leser) return new Uint8Array()
  const teile: Uint8Array[] = []
  let summe = 0
  while (true) {
    const { done, value } = await leser.read()
    if (done) break
    summe += value.length
    if (summe > MAX_BYTES) {
      await leser.cancel().catch(() => undefined)
      return null
    }
    teile.push(value)
  }
  const alles = new Uint8Array(summe)
  let pos = 0
  for (const t of teile) {
    alles.set(t, pos)
    pos += t.length
  }
  return alles
}

const DIREKT_SCHICKEN = 'Sag dem Mitarbeiter, dass er die Datei direkt hier im Chat schicken soll (oder den Text hineinkopiert).'

// deno-lint-ignore no-explicit-any
export async function fuehreLinkWerkzeugAus(_name: string, input: any, k: LinkKontext): Promise<string> {
  const p = pruefeLink(String(input?.url ?? ''))
  if (!p.ok) return `Fehler: ${p.fehler}`
  const abruf = k.abruf ?? fetch
  let antwort: Response | { fehler: string; url?: string }
  try {
    antwort = await holeMitWeiterleitung(p.url, abruf)
  } catch (e) {
    const zeit = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
    return `Fehler: Der Link ließ sich nicht öffnen (${zeit ? 'keine Antwort in 20 Sekunden' : 'nicht erreichbar'}). ${DIREKT_SCHICKEN}`
  }
  if (!(antwort instanceof Response)) return `Fehler: ${antwort.fehler} ${DIREKT_SCHICKEN}`
  if (!antwort.ok) {
    await antwort.body?.cancel().catch(() => undefined)
    const grund = antwort.status === 401 || antwort.status === 403 ? 'Der Link ist nicht öffentlich oder abgelaufen' : antwort.status === 404 ? 'Unter dem Link gibt es nichts (mehr)' : `Der Server antwortet mit Fehler ${antwort.status}`
    return `Fehler: ${grund}. ${DIREKT_SCHICKEN}`
  }
  const typ = (antwort.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
  const bytes = await leseBegrenzt(antwort)
  if (!bytes) return `Fehler: Die Datei ist größer als 20 MB. Sag dem Mitarbeiter, dass er sie im CRM direkt in der Akte hochladen soll.`
  if (bytes.length === 0) return `Fehler: Unter dem Link kam nichts an. ${DIREKT_SCHICKEN}`

  if (typ === 'text/html' || typ === 'application/xhtml+xml') {
    const html = new TextDecoder().decode(bytes)
    const { titel, text } = textAusHtml(html)
    if (istAnmeldeseite(antwort.url || p.url, titel)) return `Fehler: Der Link führt auf eine Anmeldeseite — die Datei ist nicht öffentlich. ${DIREKT_SCHICKEN}`
    if (text.length < 40) return `Fehler: Die Seite enthält keinen lesbaren Text (sie wird vermutlich erst im Browser aufgebaut). ${DIREKT_SCHICKEN}`
    k.protokolliere(`Link geöffnet (Webseite): ${titel || p.url}`)
    return `Webseite${titel ? ` „${titel}“` : ''} (${p.url}):\n\n${text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)} … (gekürzt)` : text}`
  }

  const name = dateinameVon(antwort.url || p.url, antwort.headers.get('content-disposition'), typ)
  const pfad = await k.speichere(bytes, name, typ)
  if (!pfad) return 'Fehler: Die Datei kam an, ließ sich aber nicht speichern. Bitte noch einmal versuchen.'
  k.protokolliere(`Link geöffnet und Datei gespeichert: ${name}`)
  return `Datei aus dem Link gespeichert, noch keiner Akte zugeordnet:\npfad=${pfad} | Name: ${name} | Art: ${typ} | ${Math.round(bytes.length / 1024)} KB\nLies sie jetzt mit datei_lesen und lege sie danach wie einen Datei-Eingang ab, wenn der Mitarbeiter das möchte.`
}
