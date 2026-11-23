// Aktionen für das Microsoft-Konto im Bereich „Privat“ (Anmeldung, Status, Trennen; später Outlook, To Do, Kalender).
// Alles gilt nur für den eigenen Login (ermittleAufrufer) und nur, wenn er in MS_ERLAUBT steht.
import { ermittleAufrufer } from './postfach.ts'
import { OUTLOOK_AKTIONEN, outlookAktion } from './outlook.ts'
import { AUSFUEHRER, bestaetige, merkeVor, offeneVormerkungen, verwerfe } from './vormerkungen.ts'
import { istDienstSchluessel } from './tagesmeldung.ts'
import { gleicheTodosAb, setzeListenWahl } from './todoAbgleich.ts'
import { gleicheKalenderAb } from './kalenderAbgleich.ts'
import { anmeldungAbschliessen, anmeldungStarten, graph, msEingerichtet, MsFehler, msErlaubt, MsNichtVerbunden, msStatus, msTrennen } from '../_shared/microsoft.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const ABGLEICH_AKTIONEN = new Set(['ms_abgleich_jetzt', 'privat_systemcheck', 'ms_todo_listen_setzen'])
export const VORMERK_AKTIONEN = new Set(['vormerkungen_liste', 'vormerkung_anlegen', 'vormerkung_bestaetigen', 'vormerkung_verwerfen', 'outlook_senden'])
export const MS_AKTIONEN = new Set(['ms_status', 'ms_anmelden_start', 'ms_trennen', ...OUTLOOK_AKTIONEN, ...VORMERK_AKTIONEN, ...ABGLEICH_AKTIONEN])

const antwort = (daten: unknown, headers: Record<string, string>, status = 200) => new Response(JSON.stringify(daten), { status, headers })

export async function msAktion(req: Request, admin: Db, body: Record<string, unknown>, headers: Record<string, string>): Promise<Response> {
  const aufrufer = await ermittleAufrufer(req, admin, body)
  if (!aufrufer) return antwort({ error: 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.' }, headers, 401)
  const ich = aufrufer.email
  try {
    if (body.action === 'ms_status') return antwort(await msStatus(admin, ich), headers)
    if (!msErlaubt(ich)) return antwort({ error: 'Die Microsoft-Anbindung ist für dieses Konto nicht freigeschaltet.' }, headers, 403)
    if (body.action === 'ms_anmelden_start') {
      return antwort({ url: await anmeldungStarten(admin, ich, String(body.basis ?? '')) }, headers)
    }
    if (body.action === 'ms_trennen') {
      await msTrennen(admin, ich)
      return antwort({ ok: true }, headers)
    }
    if (OUTLOOK_AKTIONEN.has(String(body.action))) return antwort(await outlookAktion(admin, ich, body), headers)
    if (body.action === 'ms_abgleich_jetzt') return antwort(await gleicheAb(admin, ich), headers)
    // Welche To-Do-Listen abgeglichen werden (Runde 6): `aus` = Kennungen der ausgeschlossenen Listen. Nichts wird gelöscht.
    if (body.action === 'ms_todo_listen_setzen') return antwort({ ok: true, todoListen: await setzeListenWahl(admin, ich, body.aus) }, headers)
    if (body.action === 'privat_systemcheck') return antwort(await systemcheck(admin, ich), headers)
    if (VORMERK_AKTIONEN.has(String(body.action))) {
      // Mit dem Dienst-Schlüssel ruft nur die eigene Telegram-Funktion auf (Assistent oder Knopf). Bestätigen geht
      // dann nur mit dem Code aus der Telegram-Nachricht des Besitzers; Sofort-Senden gar nicht.
      const dienst = istDienstSchluessel((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim())
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : typeof body.id === 'string' ? [body.id] : []
      if (body.action === 'vormerkungen_liste') return antwort({ vormerkungen: await offeneVormerkungen(admin, ich) }, headers)
      if (body.action === 'vormerkung_anlegen') {
        const p = (body.parameter && typeof body.parameter === 'object' ? body.parameter : {}) as Record<string, unknown>
        return antwort(await merkeVor(admin, ich, { art: String(body.art ?? ''), beschreibung: String(body.beschreibung ?? ''), parameter: p, quelle: dienst ? 'assistent' : 'crm' }), headers)
      }
      if (body.action === 'vormerkung_bestaetigen' || body.action === 'vormerkung_verwerfen') {
        const code = dienst ? String(body.code ?? '') : undefined
        if (dienst && !code) return antwort({ error: 'Bestätigen geht nur per Knopf oder im CRM.' }, headers, 403)
        if (body.action === 'vormerkung_verwerfen') return antwort({ verworfen: await verwerfe(admin, ich, ids, code) }, headers)
        return antwort({ ergebnisse: await bestaetige(admin, ich, ids, code) }, headers)
      }
      if (body.action === 'outlook_senden') {
        // Direkt aus dem CRM-Fenster: der Klick auf „Senden“ mit Rückfrage IST die Bestätigung — nur mit eigenem Login.
        if (dienst) return antwort({ error: 'Senden ohne Bestätigung nur aus dem CRM.' }, headers, 403)
        const art = String(body.art ?? '')
        if (!['mail_senden', 'mail_antworten', 'mail_weiterleiten'].includes(art)) return antwort({ error: 'Unbekannte Art.' }, headers, 400)
        const p = (body.parameter && typeof body.parameter === 'object' ? body.parameter : {}) as Record<string, unknown>
        return antwort({ ok: true, meldung: await AUSFUEHRER[art](admin, ich, p) }, headers)
      }
    }
    return antwort({ error: 'Unbekannte Aktion' }, headers, 400)
  } catch (e) {
    if (e instanceof MsNichtVerbunden) return antwort({ error: e.message, nichtVerbunden: true }, headers, 409)
    if (e instanceof MsFehler) return antwort({ error: e.message }, headers, e.status >= 400 && e.status < 600 ? e.status : 502)
    console.error('Microsoft-Aktion fehlgeschlagen', body.action, e instanceof Error ? e.message : e)
    return antwort({ error: e instanceof Error ? e.message : String(e) }, headers, 500)
  }
}

function seite(text: string, status: number): Response {
  const sicher = text.replace(/[&<>"]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[z]!)
  return new Response(`<!doctype html><meta charset="utf-8"><title>Microsoft-Anmeldung</title><p style="font-family:sans-serif;margin:2rem">${sicher}</p>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** GET email-gateway/ms-rueckruf — hierher leitet Microsoft nach der Anmeldung zurück. */
export async function msRueckrufAntwort(admin: Db, url: URL): Promise<Response> {
  const ergebnis = await anmeldungAbschliessen(admin, url.searchParams)
  if (!ergebnis) return seite('Diese Anmeldung ist ungültig oder schon verwendet. Bitte im CRM unter Privat → Einstellungen neu verbinden.', 400)
  const ziel = `${ergebnis.ruecksprung.replace(/\/?$/, '/')}#/privat/einstellungen?ms=${ergebnis.ok ? 'ok' : 'fehler'}&meldung=${encodeURIComponent(ergebnis.meldung)}`
  return new Response(null, { status: 302, headers: { location: ziel, 'cache-control': 'no-store' } })
}

/** Ein Abgleich (To Do; später Kalender) für einen Login. */
async function gleicheAb(admin: Db, ich: string, budgetMs = 60_000) {
  const todo = await gleicheTodosAb(admin, ich, budgetMs / 2)
  const kalender = await gleicheKalenderAb(admin, ich, budgetMs / 2)
  return { todo, kalender }
}

/** Zeitplan (alle 3 Minuten): alle verbundenen, freigegebenen Konten abgleichen. Fehler je Konto werden vermerkt, nicht geworfen. */
export async function msAbgleichAlle(admin: Db): Promise<{ konten: number; fehler: string[] }> {
  const { data } = await admin.from('ms_konten').select('login_email')
  const konten = ((data ?? []) as { login_email: string }[]).map((k) => k.login_email).filter(msErlaubt)
  const fehler: string[] = []
  for (const ich of konten) {
    try {
      const r = await gleicheAb(admin, ich, 45_000)
      fehler.push(...[...r.todo.fehler, ...r.kalender.fehler].map((f) => `${ich}: ${f}`))
    } catch (e) {
      fehler.push(`${ich}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { konten: konten.length, fehler: fehler.slice(0, 20) }
}

type Pruefung = { name: string; ok: boolean | null; text: string }

/** Systemcheck des privaten Bereichs (Ersatz für systemcheck.py des Desktop-Assistenten). Nur Zustände, keine Inhalte. */
async function systemcheck(admin: Db, ich: string): Promise<{ pruefungen: Pruefung[] }> {
  const p: Pruefung[] = []
  const status = await msStatus(admin, ich)
  p.push({ name: 'Microsoft-App eingerichtet', ok: msEingerichtet(), text: msEingerichtet() ? 'Anwendungs-ID und Geheimnis sind hinterlegt.' : 'MS_CLIENT_ID/MS_CLIENT_SECRET fehlen.' })
  if (!status.verbunden) p.push({ name: 'Microsoft-Konto', ok: false, text: 'Nicht verbunden — unter Einstellungen verbinden.' })
  else {
    try {
      const ichMs = await graph<{ mail?: string; userPrincipalName?: string }>(admin, ich, '/me?$select=mail,userPrincipalName')
      p.push({ name: 'Microsoft-Konto', ok: true, text: `Verbunden und erreichbar (${ichMs.mail || ichMs.userPrincipalName || status.adresse}).` })
    } catch (e) {
      p.push({ name: 'Microsoft-Konto', ok: false, text: e instanceof Error ? e.message : String(e) })
    }
    for (const [name, lauf] of [['Abgleich To Do', status.abgleich?.todo], ['Abgleich Kalender', status.abgleich?.kalender]] as const) {
      const l = lauf as { am?: string; fehler?: string[] } | undefined
      const alt = l?.am ? (Date.now() - Date.parse(l.am)) / 60000 : Infinity
      p.push({ name, ok: !l ? null : !l.fehler?.length && alt < 15, text: !l ? 'Noch kein Lauf.' : l.fehler?.length ? `Probleme: ${l.fehler.join(' | ')}` : alt < 15 ? `Zuletzt vor ${Math.round(alt)} Min.` : `Letzter Lauf vor ${Math.round(alt)} Min. — der Zeitplan sollte alle 3 Min. laufen.` })
    }
  }
  const muster = ich.replace(/[\\%_]/g, (z) => `\\${z}`)
  const { data: m } = await admin.from('mitarbeiter').select('telegram_chat_id').ilike('email', muster).maybeSingle()
  p.push({ name: 'Telegram', ok: !!m?.telegram_chat_id, text: m?.telegram_chat_id ? 'Verbunden — Briefing, Erinnerungen und Bestätigungs-Knöpfe kommen dort an.' : 'Nicht verbunden — unter „Mein Profil“ mit Telegram verbinden.' })
  const { data: e } = await admin.from('kalender_einstellungen').select('morgen_uebersicht').eq('email', ich).maybeSingle()
  p.push({ name: 'Morgen-Übersicht', ok: e?.morgen_uebersicht !== false, text: e?.morgen_uebersicht === false ? 'Ausgeschaltet (Kalender → Einstellungen).' : 'An (Mo–Fr ab 8 Uhr per Telegram).' })
  const { data: b } = await admin.from('briefboegen').select('name, pdf_pfad').eq('besitzer_email', ich)
  const boegen = (b ?? []) as { name: string; pdf_pfad: string | null }[]
  p.push({ name: 'Briefbogen', ok: boegen.length > 0 && boegen.every((x) => x.pdf_pfad), text: boegen.length ? boegen.map((x) => `${x.name}${x.pdf_pfad ? '' : ' (ohne PDF-Hintergrund)'}`).join(', ') : 'Noch keiner hinterlegt.' })
  p.push({ name: 'Spracherkennung', ok: !!Deno.env.get('GROQ_API_KEY'), text: Deno.env.get('GROQ_API_KEY') ? 'Eingerichtet (Groq).' : 'Nicht eingerichtet — Diktat nutzt die Browser-Erkennung.' })
  p.push({ name: 'KI', ok: !!Deno.env.get('ANTHROPIC_API_KEY'), text: Deno.env.get('ANTHROPIC_API_KEY') ? 'Eingerichtet.' : 'Kein Schlüssel hinterlegt.' })
  const { count } = await admin.from('vormerkungen').select('id', { count: 'exact', head: true }).eq('besitzer_email', ich).eq('status', 'offen')
  p.push({ name: 'Zu bestätigen', ok: null, text: count ? `${count} Aktion(en) warten auf deine Bestätigung.` : 'Nichts offen.' })
  return { pruefungen: p }
}
