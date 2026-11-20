// Misst den Verbrauch jedes Aufrufs des KI-Dienstes (Anthropic) und schreibt ihn in die Tabelle
// `ki_verbrauch` — nur Zahlen (Funktion, Anlass, Modell, Token, Websuchen, Kosten), nie Inhalte.
// Zweck: sehen, welche Funktion des CRM wie viel kostet, bevor an Modellen oder Abläufen gespart wird.
// Die Tabelle hat keine Lese- oder Schreibregel für angemeldete Nutzer; nur der Server schreibt sie.
import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient } from 'npm:@supabase/supabase-js@2.119.1'

const ANLASS = new AsyncLocalStorage<{ anlass: string; person: string; privat: boolean }>()

/** Führt eine Anfrage in einem eigenen Rahmen aus; jeder KI-Aufruf darin (auch im Hintergrund) wird ihrem Anlass zugerechnet. */
export function mitAnlass<T>(arbeit: () => T): T {
  return ANLASS.run({ anlass: '', person: '', privat: false }, arbeit)
}

/** Setzt den Anlass der laufenden Anfrage, z. B. ihre Aktion — erst bekannt, wenn der Inhalt gelesen ist. */
export function setzeAnlass(anlass: unknown): void {
  const rahmen = ANLASS.getStore()
  if (rahmen && typeof anlass === 'string' && anlass) rahmen.anlass = anlass.slice(0, 80)
}

/** Setzt, für wen die laufende Anfrage arbeitet (Login-Adresse des Mitarbeiters). Ohne Person gilt der
 *  Aufruf als automatisch (Zeitplan, Mail-Eingang). Gespeichert wird nur die Adresse, nie Inhalte. */
export function setzePerson(email: unknown): void {
  const rahmen = ANLASS.getStore()
  if (rahmen && typeof email === 'string' && email.includes('@')) rahmen.person = email.trim().toLowerCase().slice(0, 200)
}

/** Kennzeichnet die laufende Anfrage als privat (Bereich Privat, Microsoft-Konto, Briefe auf eigenem Briefbogen).
 *  Diese Kosten werden getrennt ausgewiesen und dem Mitarbeiter privat berechnet (Entscheidung vom 20.11.2026). */
export function setzePrivat(): void {
  const rahmen = ANLASS.getStore()
  if (rahmen) rahmen.privat = true
}

/** Die Person der laufenden Anfrage, z. B. um sie bei einem Aufruf der eigenen Server-Funktionen weiterzugeben. */
export function aktuellePerson(): string {
  return ANLASS.getStore()?.person ?? ''
}

// US-Dollar je Million Token (Preisliste, abgerufen am 18.11.2026); unbekannte Modelle wie Sonnet 5.5.
const PREISE: Record<string, { ein: number; aus: number; cacheSchreiben: number; cacheLesen: number }> = {
  'claude-sonnet-5-5': { ein: 2, aus: 10, cacheSchreiben: 2.5, cacheLesen: 0.1 },
  'claude-haiku-5-5': { ein: 0.1, aus: 0.5, cacheSchreiben: 0.125, cacheLesen: 0.01 },
  'claude-haiku-4-5-20251001': { ein: 1, aus: 5, cacheSchreiben: 1.25, cacheLesen: 0.1 },
}

// deno-lint-ignore no-explicit-any
let datenbank: any = null

// deno-lint-ignore no-explicit-any
function db(): any {
  if (!datenbank) datenbank = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  return datenbank
}

/** Wie `fetch` an die Messages-Schnittstelle, schreibt danach den gemeldeten Verbrauch mit. Die Antwort bleibt unverändert lesbar. */
export async function kiAufruf(funktion: string, url: string, init: RequestInit): Promise<Response> {
  const antwort = await fetch(url, init)
  try {
    const kopie = antwort.clone()
    // Im Hintergrund auswerten, damit der eigentliche Ablauf nicht wartet.
    const anlass = ANLASS.getStore()?.anlass ?? ''
    const person = ANLASS.getStore()?.person || null
    const privat = ANLASS.getStore()?.privat ?? false
    const modell = (() => {
      try {
        return String(JSON.parse(String(init.body ?? '{}')).model ?? '')
      } catch {
        return ''
      }
    })()
    void kopie
      .json()
      .then(async (daten) => {
        const u = daten?.usage
        if (!u) return
        const ein = Number(u.input_tokens) || 0
        const aus = Number(u.output_tokens) || 0
        const cacheSchreiben = Number(u.cache_creation_input_tokens) || 0
        const cacheLesen = Number(u.cache_read_input_tokens) || 0
        const suchen = Number(u.server_tool_use?.web_search_requests) || 0
        // Haiku 5.5 kostet bei Anfragen über 100.000 Token das Fünffache — vorsichtig mit dem höheren Satz rechnen.
        const p = modell === 'claude-haiku-5-5' && ein + cacheSchreiben + cacheLesen > 100_000 ? { ein: 0.5, aus: 2.5, cacheSchreiben: 0.625, cacheLesen: 0.05 } : (PREISE[modell] ?? PREISE['claude-sonnet-5-5'])
        const kosten = (ein * p.ein + aus * p.aus + cacheSchreiben * p.cacheSchreiben + cacheLesen * p.cacheLesen) / 1_000_000 + suchen * 0.01
        const { error } = await db().from('ki_verbrauch').insert({ funktion, anlass, person, privat, modell, ein, aus, cache_schreiben: cacheSchreiben, cache_lesen: cacheLesen, suchen, kosten_usd: Math.round(kosten * 1_000_000) / 1_000_000 })
        if (error) console.error('KI-Verbrauch nicht gespeichert:', error.message)
      })
      .catch(() => undefined)
  } catch {
    // Messen darf den eigentlichen Ablauf nie stören.
  }
  return antwort
}
