// Aktionen für das Microsoft-Konto im Bereich „Privat“ (Anmeldung, Status, Trennen; später Outlook, To Do, Kalender).
// Alles gilt nur für den eigenen Login (ermittleAufrufer) und nur, wenn er in MS_ERLAUBT steht.
import { ermittleAufrufer } from './postfach.ts'
import { OUTLOOK_AKTIONEN, outlookAktion } from './outlook.ts'
import { AUSFUEHRER, bestaetige, merkeVor, offeneVormerkungen, verwerfe } from './vormerkungen.ts'
import { istDienstSchluessel } from './tagesmeldung.ts'
import { gleicheTodosAb } from './todoAbgleich.ts'
import { anmeldungAbschliessen, anmeldungStarten, MsFehler, msErlaubt, MsNichtVerbunden, msStatus, msTrennen } from '../_shared/microsoft.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const ABGLEICH_AKTIONEN = new Set(['ms_abgleich_jetzt'])
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
  const todo = await gleicheTodosAb(admin, ich, budgetMs)
  return { todo }
}

/** Zeitplan (alle 3 Minuten): alle verbundenen, freigegebenen Konten abgleichen. Fehler je Konto werden vermerkt, nicht geworfen. */
export async function msAbgleichAlle(admin: Db): Promise<{ konten: number; fehler: string[] }> {
  const { data } = await admin.from('ms_konten').select('login_email')
  const konten = ((data ?? []) as { login_email: string }[]).map((k) => k.login_email).filter(msErlaubt)
  const fehler: string[] = []
  for (const ich of konten) {
    try {
      const r = await gleicheAb(admin, ich, 45_000)
      fehler.push(...r.todo.fehler.map((f) => `${ich}: ${f}`))
    } catch (e) {
      fehler.push(`${ich}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { konten: konten.length, fehler: fehler.slice(0, 20) }
}
