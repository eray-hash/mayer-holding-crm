// Namensliste als Schreibhilfe für die Abschrift von Sprachnachrichten (Wunsch 23.11.2026).
//
// Whisper schreibt Namen nach Gehör („Herr Bossler“ statt „Herr Bosler“). Bekommt es vorab eine
// kurze Liste der Namen, die vorkommen können (Feld `prompt`), trifft es die Schreibweise deutlich
// öfter. Die Liste ist bewusst knapp (Whisper liest nur rund 220 Wörter Vorlauf).
//
// Mayer-Bot: Namen der Kolleginnen und Kollegen.
// Privater Assistent: dazu die eigenen privaten Kontakte und die häufigsten Mail-Partner aus dem
// verbundenen Postfach. Die Mail-Partner werden höchstens einmal am Tag neu ermittelt und in
// privat_einstellungen.briefing.abschriftNamen zwischengespeichert — die Sprachnachricht wartet
// nie auf das Postfach (Auffrischung läuft nach der Antwort weiter).
//
// Es werden nur Namen an den Abschrift-Dienst gegeben, keine Adressen oder Inhalte.

// deno-lint-ignore no-explicit-any
type Supa = any

export type MailPartner = { name?: string; adresse?: string }
export type HoleMails = (ich: string, ordner: 'inbox' | 'sentitems') => Promise<{ von?: MailPartner; an?: MailPartner[]; cc?: MailPartner[] }[]>

const MAX_ZEICHEN = 560
const AUFFRISCHEN_MS = 24 * 3600_000
const MAX_PARTNER = 30

// Absender, die keine Personen sind.
const KEINE_PERSON = /(no-?reply|noreply|nicht-?antworten|newsletter|news@|info@|service@|support@|kontakt@|mailer|notification|benachrichtigung|rechnung@|billing|team@|hello@|hallo@|marketing|postmaster)/i
const KEIN_PERSONENNAME = /(gmbh|\bag\b|\bug\b|\bkg\b|team|service|newsletter|support|kundenservice|redaktion|online|shop|bank|versicherung|verlag|amazon|paypal|linkedin|xing|microsoft|google|apple)/i

/** Bereinigt einen Anzeigenamen; liefert '' wenn es kein brauchbarer Personenname ist. */
export function personenName(roh: string | null | undefined, adresse = ''): string {
  let n = String(roh ?? '').replace(/["'<>()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!n || n.includes('@')) return ''
  // „Nachname, Vorname“ → „Vorname Nachname“
  const komma = n.match(/^([^,]+),\s*([^,]+)$/)
  if (komma) n = `${komma[2]} ${komma[1]}`
  if (n.length < 3 || n.length > 40) return ''
  if (KEINE_PERSON.test(adresse) || KEIN_PERSONENNAME.test(n)) return ''
  if (/\d/.test(n)) return ''
  // Mindestens ein Wort, das mit einem Großbuchstaben beginnt.
  if (!/(^|\s)[A-ZÄÖÜ]/.test(n)) return ''
  return n
}

/** Zählt Mail-Partner (gesendet und empfangen) und liefert die Namen nach Häufigkeit. */
export function haeufigeNamen(
  mails: { von?: MailPartner; an?: MailPartner[]; cc?: MailPartner[] }[],
  eigeneAdressen: string[],
  max = MAX_PARTNER,
): string[] {
  const eigene = new Set(eigeneAdressen.map((a) => a.trim().toLowerCase()).filter(Boolean))
  const zaehler = new Map<string, { name: string; anzahl: number }>()
  for (const m of mails) {
    for (const p of [m.von, ...(m.an ?? []), ...(m.cc ?? [])]) {
      const adr = String(p?.adresse ?? '').toLowerCase()
      if (!adr || eigene.has(adr)) continue
      const name = personenName(p?.name, adr)
      if (!name) continue
      const alt = zaehler.get(adr)
      zaehler.set(adr, { name: alt?.name ?? name, anzahl: (alt?.anzahl ?? 0) + 1 })
    }
  }
  return [...zaehler.values()].sort((a, b) => b.anzahl - a.anzahl).map((x) => x.name).slice(0, max)
}

/** Baut den Schreibhilfe-Text aus Namen (ohne Doppel, in der Reihenfolge der Wichtigkeit, gekürzt). */
export function hinweisAusNamen(namen: string[], max = MAX_ZEICHEN): string {
  const gesehen = new Set<string>()
  const teile: string[] = []
  let laenge = 'Namen: .'.length
  for (const roh of namen) {
    const n = String(roh ?? '').replace(/\s+/g, ' ').trim()
    const k = n.toLowerCase()
    if (!n || gesehen.has(k)) continue
    const zusatz = (teile.length ? 2 : 0) + n.length
    if (laenge + zusatz > max) break
    gesehen.add(k)
    teile.push(n)
    laenge += zusatz
  }
  return teile.length ? `Namen: ${teile.join(', ')}.` : ''
}

function kontaktName(k: { firma?: string | null; ansprechpartner?: string | null }): string[] {
  return [k.ansprechpartner, k.firma].map((x) => String(x ?? '').trim()).filter((x) => x.length >= 3 && x.length <= 40)
}

/**
 * Schreibhilfe für eine Sprachnachricht. Wirft nie (ohne Liste wird einfach ohne Hilfe abgeschrieben).
 * `auffrischen` (optional) bekommt die Arbeit, die nach der Antwort weiterlaufen darf
 * (EdgeRuntime.waitUntil); ohne sie läuft die Auffrischung nicht.
 */
export async function namensHinweis(
  supabase: Supa,
  mitarbeiter: { email?: string | null; name?: string | null },
  privat: boolean,
  holeMails?: HoleMails,
  auffrischen?: (arbeit: Promise<unknown>) => void,
  jetzt = new Date(),
): Promise<string> {
  try {
    const ich = String(mitarbeiter?.email ?? '').trim().toLowerCase()
    const namen: string[] = []
    if (privat && ich) {
      const { data: kontakte } = await supabase
        .from('kunden')
        .select('firma, ansprechpartner')
        .eq('bereich', 'privat')
        .eq('verantwortlich_email', ich)
        .limit(60)
      for (const k of kontakte ?? []) namen.push(...kontaktName(k))
      const { data: einst } = await supabase.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
      const zwischen = einst?.briefing?.abschriftNamen
      const gespeichert: string[] = Array.isArray(zwischen?.namen) ? zwischen.namen.map(String) : []
      namen.push(...gespeichert)
      const alt = !zwischen?.stand || jetzt.getTime() - new Date(zwischen.stand).getTime() > AUFFRISCHEN_MS
      if (alt && holeMails && auffrischen) auffrischen(frischeMailPartner(supabase, ich, holeMails, jetzt))
    }
    // Kolleginnen und Kollegen (ohne die Person selbst).
    const { data: team } = await supabase.from('mitarbeiter').select('name, email').eq('aktiv', true).limit(40)
    for (const m of team ?? []) {
      if (String(m.email ?? '').toLowerCase() === ich) continue
      if (m.name && !/test/i.test(m.name)) namen.push(String(m.name))
    }
    return hinweisAusNamen(namen)
  } catch (e) {
    console.error('Namensliste für die Abschrift nicht verfügbar:', e)
    return ''
  }
}

/** Ermittelt die häufigsten Mail-Partner neu und speichert sie zwischen. Wirft nie. */
export async function frischeMailPartner(supabase: Supa, ich: string, holeMails: HoleMails, jetzt = new Date()): Promise<string[]> {
  try {
    const [rein, raus] = await Promise.all([holeMails(ich, 'inbox').catch(() => []), holeMails(ich, 'sentitems').catch(() => [])])
    // Gesendete Mails zählen doppelt: Wem man selbst schreibt, der ist sicher eine echte Person.
    const namen = haeufigeNamen([...rein, ...raus, ...raus], [ich])
    const { data } = await supabase.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
    const alt = data?.briefing && typeof data.briefing === 'object' ? data.briefing : {}
    await supabase
      .from('privat_einstellungen')
      .upsert({ login_email: ich, briefing: { ...alt, abschriftNamen: { stand: jetzt.toISOString(), namen } }, geaendert_am: jetzt.toISOString() })
    return namen
  } catch (e) {
    console.error('Mail-Partner für die Namensliste nicht ermittelt:', e)
    return []
  }
}
