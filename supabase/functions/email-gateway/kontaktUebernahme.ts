// Privater Kontakt → Mayer-CRM: beim „In den öffentlichen Bereich übernehmen“ die Mails mitnehmen.
//
// Bisher wanderte nur die Akte (Zeile in `kunden`); Mails, die beim privaten Kontakt abgelegt waren (eigenes Postfach
// oder aus Hotmail), blieben privat und hingen weiter an „privat“. Jetzt werden alle eigenen privaten Mails dieses
// Kontakts freigegeben (wie „in den öffentlichen Bereich holen“, samt Anhängen) und dem Kontakt im Zielbereich zugeordnet.
// Nur Mails des Aufrufers selbst (besitzer_email), nie fremde.
import { ermittleAufrufer, holeInOeffentlich } from './postfach.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export async function kontaktMailsUebernehmen(req: Request, admin: Db, body: Record<string, unknown>, headers: Record<string, string>): Promise<Response> {
  const antwort = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers })
  const a = await ermittleAufrufer(req, admin, body)
  if (!a) return antwort({ error: 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.' }, 401)
  const kundeId = String(body.kundeId ?? '')
  const bereich = String(body.bereich ?? '')
  const name = String(body.name ?? '').slice(0, 200)
  if (!kundeId || !bereich || bereich === 'privat') return antwort({ error: 'Kontakt oder Zielbereich fehlt.' }, 400)
  const kunde = { id: kundeId, bereich, name }

  const [{ data: ein }, { data: aus }] = await Promise.all([
    admin.from('eingegangene_emails').select('message_id').eq('besitzer_email', a.email).eq('zugewiesener_kunde_id', kundeId),
    admin.from('gesendete_emails').select('id').eq('besitzer_email', a.email).eq('kunde_id', kundeId),
  ])
  let uebernommen = 0
  const fehler: string[] = []
  for (const m of (ein ?? []) as { message_id: string }[]) {
    const r = await holeInOeffentlich(admin, a, { art: 'eingang', id: m.message_id, kunde })
    if (r.ok) uebernommen++
    else fehler.push(r.fehler)
  }
  for (const m of (aus ?? []) as { id: string }[]) {
    const r = await holeInOeffentlich(admin, a, { art: 'gesendet', id: m.id, kunde })
    if (r.ok) uebernommen++
    else fehler.push(r.fehler)
  }
  // Protokolle des privaten Kontakts mitnehmen — sonst sieht sie nach der Übernahme niemand mehr.
  const { error: protFehler } = await admin.from('protokolle').update({ bereich, besitzer_email: null }).eq('kunde_id', kundeId).eq('bereich', 'privat').eq('besitzer_email', a.email)
  if (protFehler) fehler.push(`Protokolle: ${protFehler.message}`)
  return antwort({ ok: fehler.length === 0, uebernommen, fehler: fehler.slice(0, 5) })
}
