// Ordnet eine Mail aus dem gemeinsamen Postfach einem Immobilien-Objekt zu: Der Server legt ihre
// Anhänge in die Dokumente des Objekts (passender Ordner je Dateiname) und schreibt einen Eintrag in
// den Verlauf — siehe supabase/functions/email-gateway/objektMail.ts.
import { supabase } from './supabaseClient'

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

export type ObjektZuordnungErgebnis = { abgelegt: number; uebersprungen: number; ordner: string[]; betreff: string }

/** `mailId` ist die Message-ID der Mail (oder ihre Zeilen-Kennung in der Datenbank). */
export async function ordneMailObjektZu(mailId: string, objektId: string): Promise<ObjektZuordnungErgebnis> {
  if (!FUNCTION_URL) throw new Error('Das Postfach ist noch nicht eingerichtet (VITE_EMAIL_GATEWAY_URL fehlt).')
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Du bist nicht angemeldet.')
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify({ action: 'mail_objekt_zuordnen', mailId, objektId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data?.error === 'string') throw new Error(data?.error ?? `Die Zuordnung ist fehlgeschlagen (${res.status}).`)
  return {
    abgelegt: Number(data?.abgelegt ?? 0),
    uebersprungen: Number(data?.uebersprungen ?? 0),
    ordner: Array.isArray(data?.ordner) ? data.ordner.map(String) : [],
    betreff: String(data?.betreff ?? ''),
  }
}
