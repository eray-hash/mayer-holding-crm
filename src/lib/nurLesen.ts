// Nur-Lesen-Schutz für „Ansehen als …“ (Superuser, seit 19.11.2026): Solange der Superuser das CRM
// so ansieht, wie ein Kollege es sähe, darf NICHTS gespeichert werden — weder über den Supabase-Client
// (Tabellen, Ablage, Funktionen) noch über direkte Aufrufe der Server-Funktionen.
//
// Der Schutz sitzt an der Stelle, durch die jeder Netzwerkaufruf muss: `fetch`. Der Supabase-Client
// bekommt die geschützte Fassung beim Anlegen (supabaseClient.ts, global.fetch), alle direkten
// fetch-Aufrufe (emailGateway.ts, assistentServer.ts, eingang.ts, …) laufen über das ersetzte
// window.fetch. Erlaubt bleibt nur, was nichts verändert:
// - GET/HEAD/OPTIONS (Lesen in Tabellen und Ablage),
// - Anmeldung erneuern und Abmelden,
// - signierte Ablage-Links und Ordner-Listen (POST, aber nur lesend),
// - die Lese-RPC kalender_belegt,
// - eine kleine Liste rein lesender Server-Aktionen.
// Alles andere bekommt sofort die Antwort 423 („gesperrt“) und eine kurze Meldung — es geht kein
// Byte an den Server.

let aktiv = false
type Hoerer = (meldung: string) => void
const hoerer = new Set<Hoerer>()

export const NUR_LESEN_MELDUNG = 'Nur Ansicht – im Modus ‚Ansehen als‘ wird nichts gespeichert.'

export function setzeNurLesen(an: boolean): void {
  aktiv = an
}

export function istNurLesen(): boolean {
  return aktiv
}

/** Meldet jeden abgewiesenen Speicherversuch (für einen kurzen Hinweis in der Oberfläche). */
export function beiGesperrt(f: Hoerer): () => void {
  hoerer.add(f)
  return () => hoerer.delete(f)
}

let zuletztGemeldet = 0
/** Für Sperren außerhalb von fetch (z. B. lokale Änderungen im CRM-Stand). */
export function meldeGesperrt(): void {
  melde()
}
function melde(): void {
  // Höchstens alle 2 Sekunden — ein Klick löst oft mehrere Aufrufe aus.
  if (Date.now() - zuletztGemeldet < 2000) return
  zuletztGemeldet = Date.now()
  for (const f of hoerer) {
    try {
      f(NUR_LESEN_MELDUNG)
    } catch {
      // Ein Hinweis darf nie etwas anderes stören.
    }
  }
}

const LESENDE_RPC = new Set(['kalender_belegt'])
const LESENDE_AKTIONEN = new Set(['postfaecher_liste', 'postfach_ordner', 'dokument_inhalte', 'mail_anhang_url', 'worker_stand'])
const LESENDE_WEB = new Set(['mail_status', 'faehigkeiten', 'datei_status'])

function textVon(body: unknown): string | null {
  return typeof body === 'string' ? body : null
}

/** Darf diese Anfrage im Nur-Lesen-Modus raus? Exportiert für den Test. */
export function erlaubtImNurLesen(url: string, methode: string, body: unknown): boolean {
  const m = methode.toUpperCase()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true
  let pfad: string
  try {
    pfad = new URL(url, 'http://x').pathname
  } catch {
    return false
  }
  // Fremde Seiten (keine Supabase-Pfade): betrifft das CRM nicht.
  if (!/\/(rest|storage|functions|auth)\/v1\//.test(pfad)) return true
  if (pfad.includes('/auth/v1/')) return /\/auth\/v1\/(token|logout)\b/.test(pfad)
  if (pfad.includes('/rest/v1/rpc/')) return LESENDE_RPC.has(pfad.split('/rest/v1/rpc/')[1]?.split(/[/?]/)[0] ?? '')
  if (pfad.includes('/rest/v1/')) return false
  if (pfad.includes('/storage/v1/')) return /\/storage\/v1\/object\/(sign|list)\//.test(pfad)
  if (pfad.includes('/functions/v1/')) {
    const text = textVon(body)
    if (!text) return false
    try {
      const daten = JSON.parse(text) as { action?: unknown; web?: unknown; volltext?: unknown }
      if (typeof daten.action === 'string') return LESENDE_AKTIONEN.has(daten.action)
      if (typeof daten.web === 'string') return LESENDE_WEB.has(daten.web)
    } catch {
      return false
    }
    return false
  }
  return false
}

function gesperrteAntwort(): Response {
  return new Response(JSON.stringify({ error: NUR_LESEN_MELDUNG, message: NUR_LESEN_MELDUNG }), {
    status: 423,
    headers: { 'content-type': 'application/json' },
  })
}

function angaben(eingabe: RequestInfo | URL, init?: RequestInit): { url: string; methode: string; body: unknown } {
  if (typeof Request !== 'undefined' && eingabe instanceof Request) {
    // Ein Request-Objekt mit Inhalt lässt sich nicht synchron lesen — im Nur-Lesen-Modus wird ein
    // schreibender Request-Aufruf deshalb vorsichtshalber abgewiesen (body = undefined).
    return { url: eingabe.url, methode: init?.method ?? eingabe.method ?? 'GET', body: init?.body }
  }
  return { url: String(eingabe), methode: init?.method ?? 'GET', body: init?.body }
}

/** Umhüllt eine fetch-Funktion mit dem Nur-Lesen-Schutz. */
export function geschuetzt(original: typeof fetch): typeof fetch {
  return (eingabe: RequestInfo | URL, init?: RequestInit) => {
    if (aktiv) {
      const a = angaben(eingabe, init)
      if (!erlaubtImNurLesen(a.url, a.methode, a.body)) {
        melde()
        return Promise.resolve(gesperrteAntwort())
      }
    }
    return original(eingabe, init)
  }
}

let installiert = false
/** Ersetzt window.fetch einmalig durch die geschützte Fassung (für direkte fetch-Aufrufe im CRM). */
export function installiereFetchSchutz(): void {
  if (installiert || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installiert = true
  const original = window.fetch.bind(window)
  window.fetch = geschuetzt(original)
}
