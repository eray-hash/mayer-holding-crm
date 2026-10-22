// Client für die Supabase Edge Function "email-gateway" (siehe
// supabase/functions/email-gateway/index.ts). Liest URL + geteiltes Secret aus Vite-Env-Variablen,
// damit nirgends ein echtes Postfach-Passwort im Frontend-Code landet.

const FUNCTION_URL = import.meta.env.VITE_EMAIL_GATEWAY_URL as string | undefined
const SHARED_SECRET = import.meta.env.VITE_EMAIL_GATEWAY_SECRET as string | undefined

export const isEmailGatewayConfigured = Boolean(FUNCTION_URL)

export type EingegangeneMail = {
  messageId: string
  von: string
  vonName: string
  betreff: string
  datum: string
  ausschnitt: string
}

async function call(body: Record<string, unknown>): Promise<any> {
  if (!FUNCTION_URL) throw new Error('E-Mail-Postfach ist noch nicht konfiguriert (VITE_EMAIL_GATEWAY_URL fehlt).')
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SHARED_SECRET ? { 'x-crm-secret': SHARED_SECRET } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `Fehler beim Abruf (${res.status})`)
  return data
}

export async function syncPosteingang(limit = 20): Promise<EingegangeneMail[]> {
  const data = await call({ action: 'sync', limit })
  return data.mails ?? []
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  await call({ action: 'send', to, subject, text, html })
}
