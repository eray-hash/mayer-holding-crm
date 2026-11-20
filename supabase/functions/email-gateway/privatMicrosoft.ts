// Aktionen für das Microsoft-Konto im Bereich „Privat“ (Anmeldung, Status, Trennen; später Outlook, To Do, Kalender).
// Alles gilt nur für den eigenen Login (ermittleAufrufer) und nur, wenn er in MS_ERLAUBT steht.
import { ermittleAufrufer } from './postfach.ts'
import { OUTLOOK_AKTIONEN, outlookAktion } from './outlook.ts'
import { anmeldungAbschliessen, anmeldungStarten, MsFehler, msErlaubt, MsNichtVerbunden, msStatus, msTrennen } from '../_shared/microsoft.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const MS_AKTIONEN = new Set(['ms_status', 'ms_anmelden_start', 'ms_trennen', ...OUTLOOK_AKTIONEN])

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
