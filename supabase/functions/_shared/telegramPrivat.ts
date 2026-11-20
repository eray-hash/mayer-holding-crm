// Privater Telegram-Assistent (zweiter Bot, gleicher Code wie der Mayer-Bot in telegram-gateway).
//
// - Schlüssel: Function-Secret PRIVAT_TELEGRAM_BOT_TOKEN. Ohne ihn bleibt alles wie bisher (nur der Mayer-Bot).
// - Webhook: `${SUPABASE_URL}/functions/v1/telegram-gateway?bot=privat`. Das Geheimnis, das Telegram dabei
//   mitschickt, wird aus dem Dienst-Schlüssel abgeleitet (kein weiteres Secret): HMAC-SHA256 über
//   „privat-telegram-webhook“, hexadezimal, die ersten 48 Zeichen. Ändert sich der Dienst-Schlüssel, muss
//   die Einrichtung (telegram-gateway, intern „privat_bot_einrichten“) noch einmal laufen.
// - „Aktiv“ ist der private Bot für jemanden, sobald er ihm einmal geschrieben hat (privat_einstellungen.briefing.privatBot)
//   und er für den Bereich Privat freigeschaltet ist (MS_ERLAUBT). Nur dann gehen private Meldungen
//   (Bestätigungen, Hotmail-Teil der Morgen-Übersicht, private Treffer) über den privaten Bot, sonst wie bisher.
// - Telegram-Chats mit einer Person haben in jedem Bot dieselbe Kennung (die der Person): mitarbeiter.telegram_chat_id gilt für beide.

// deno-lint-ignore no-explicit-any
type Db = any

export function privatBotToken(): string | undefined {
  return Deno.env.get('PRIVAT_TELEGRAM_BOT_TOKEN') || undefined
}

function msErlaubt(email: string): boolean {
  return (Deno.env.get('MS_ERLAUBT') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase())
}

/** Geheimnis für den Webhook des privaten Bots (aus dem Dienst-Schlüssel abgeleitet). null ohne Dienst-Schlüssel. */
export async function privatWebhookGeheimnis(): Promise<string | null> {
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!schluessel) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(schluessel), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('privat-telegram-webhook')))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48)
}

/** Vergleich ohne frühen Abbruch (Länge darf verraten werden). */
export function gleichesGeheimnis(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false
  let unterschied = 0
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return unterschied === 0
}

/** Gehen private Meldungen dieser Person über den privaten Bot? Ohne Schlüssel oder Freischaltung nie (dann ohne Datenbankzugriff). */
export async function privatBotAktiv(admin: Db, email: string | null | undefined): Promise<boolean> {
  const ich = String(email ?? '').trim().toLowerCase()
  if (!ich || !privatBotToken() || !msErlaubt(ich)) return false
  try {
    const { data } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
    return data?.briefing?.privatBot === true
  } catch {
    return false
  }
}

/** Merkt, dass die Person den privaten Bot benutzt (privat_einstellungen.briefing.privatBot). Schreibt nur, wenn es sich ändert. */
export async function merkePrivatBotAktiv(admin: Db, email: string): Promise<void> {
  const ich = email.trim().toLowerCase()
  if (!ich) return
  const { data } = await admin.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
  const briefing = data?.briefing && typeof data.briefing === 'object' ? data.briefing : {}
  if (briefing.privatBot === true) return
  const { error } = await admin.from('privat_einstellungen').upsert({ login_email: ich, briefing: { ...briefing, privatBot: true }, geaendert_am: new Date().toISOString() })
  if (error) console.error('Privater Bot nicht als aktiv vermerkbar:', error.message)
}

/** Ruft eine Methode der Telegram-Schnittstelle mit dem privaten Bot auf. Liefert `result` oder null (ohne Schlüssel, bei Fehlern). */
export async function telegramPrivat(methode: string, daten: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = privatBotToken()
  if (!token) return null
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${methode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) {
      console.error(`Privater Bot: ${methode} fehlgeschlagen`, r.status, j?.description)
      return null
    }
    return (j.result ?? {}) as Record<string, unknown>
  } catch (e) {
    console.error(`Privater Bot: ${methode} fehlgeschlagen`, e)
    return null
  }
}

/** Nachricht über den privaten Bot (Text höchstens 4000 Zeichen). Liefert die gesendete Nachricht oder null. */
export async function sendePrivat(chatId: number | string | null | undefined, text: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  if (chatId == null || chatId === '') return null
  return await telegramPrivat('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...extra })
}
