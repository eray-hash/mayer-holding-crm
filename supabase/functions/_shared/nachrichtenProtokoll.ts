// Aufzeichnung automatischer Nachrichten (24.11.2026) für die Seite „Automatische Nachrichten“: was tatsächlich
// hinausging (Telegram-Meldungen des Mayer-Bots, Mails an Termin-Gäste, Buchungsbestätigung, Kopie der Unterschrift).
// Tabelle nachrichten_protokoll (supabase/sql/2026-11-24_automatik.sql), lesen nur Geschäftsführung/Superuser.
//
// Regeln:
//  - Nachrichten über den PRIVATEN Bot (telegramPrivat.ts / sendePrivat) werden nie hier aufgezeichnet.
//  - Schreiben direkt über die REST-Schnittstelle mit dem Dienstschlüssel; ohne SUPABASE_URL/Schlüssel (Tests,
//    lokale Läufe) passiert nichts.
//  - Wirft nie und wartet höchstens 3 Sekunden: Ein Fehler beim Aufzeichnen darf nie den Versand stören.

export type ProtokollEintrag = {
  /** Kennung aus dem Katalog (src/lib/automatik/katalog.ts), z. B. 'gast_einladung'. */
  art?: string | null
  kanal: 'telegram' | 'mail'
  an_email?: string | null
  an_name?: string | null
  an_chat?: string | number | null
  betreff?: string | null
  text?: string | null
  status?: 'gesendet' | 'fehler'
  bezug?: Record<string, unknown> | null
}

export const HOECHSTENS_ZEICHEN = 2000

/** Zeile für die Tabelle: Text gekürzt, leere Werte als null. */
export function protokollZeile(e: ProtokollEintrag): Record<string, unknown> {
  const kurz = (s: unknown, n: number) => {
    const t = s === null || s === undefined ? '' : String(s)
    if (!t) return null
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
  }
  return {
    art: kurz(e.art, 100) ?? 'unbekannt',
    kanal: e.kanal,
    an_email: kurz(e.an_email, 320),
    an_name: kurz(e.an_name, 200),
    an_chat: e.an_chat === null || e.an_chat === undefined || e.an_chat === '' ? null : String(e.an_chat),
    betreff: kurz(e.betreff, 500),
    text: kurz(e.text, HOECHSTENS_ZEICHEN),
    status: e.status === 'fehler' ? 'fehler' : 'gesendet',
    bezug: e.bezug && typeof e.bezug === 'object' ? e.bezug : null,
  }
}

/** Zeichnet eine Nachricht auf. Wirft nie; ohne Zugangsdaten tut sie nichts. */
export async function protokolliereNachricht(e: ProtokollEintrag): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !schluessel) return
    const antwort = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/nachrichten_protokoll`, {
      method: 'POST',
      headers: {
        apikey: schluessel,
        authorization: `Bearer ${schluessel}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(protokollZeile(e)),
      signal: AbortSignal.timeout(3000),
    })
    if (!antwort.ok) console.error('Nachrichten-Protokoll: nicht gespeichert', antwort.status, (await antwort.text().catch(() => '')).slice(0, 200))
    else await antwort.body?.cancel().catch(() => undefined)
  } catch (err) {
    console.error('Nachrichten-Protokoll: nicht gespeichert', err instanceof Error ? err.message : err)
  }
}
