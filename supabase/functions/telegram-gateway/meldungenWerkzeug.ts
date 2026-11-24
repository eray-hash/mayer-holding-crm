// Werkzeug "meldungen_einstellen" (24.11.2026): schaltet die automatischen Nachrichten des privaten Assistenten
// an oder aus — Morgenplan, Abend-Rückblick, Kurz-Briefing vor Terminen, Sonntags-Wochenrückblick. Gespeichert in
// privat_einstellungen.briefing (fehlender Schlüssel = an, nur false = aus; gelesen in privatTagesplan.ts und
// privatWoche.ts). Andere Schlüssel in briefing bleiben erhalten. Nur die eigene Zeile (login_email = Login).

// deno-lint-ignore no-explicit-any
type Supa = any

const SCHLUESSEL = { morgenplan: 'Morgenplan', abendrueckblick: 'Abend-Rückblick', terminBriefing: 'Kurz-Briefing vor Terminen', wochenrueckblick: 'Sonntags-Wochenrückblick' } as const
type Schluessel = keyof typeof SCHLUESSEL

export const MELDUNGEN_WERKZEUG = {
  name: 'meldungen_einstellen',
  description:
    'Schaltet seine automatischen Nachrichten an oder aus oder zeigt, was an ist: morgenplan (Morgenplan), abendrueckblick (Abend-Rückblick), terminBriefing (Kurz-Briefing etwa 30 Minuten vor Terminen mit einer Person), wochenrueckblick (Sonntags-Wochenrückblick). Verwenden bei „Briefing aus“, „keinen Wochenrückblick mehr“, „Morgenplan wieder an“ usw. Ohne Angaben nur den Stand zeigen.',
  input_schema: {
    type: 'object',
    properties: {
      morgenplan: { type: 'boolean' },
      abendrueckblick: { type: 'boolean' },
      terminBriefing: { type: 'boolean' },
      wochenrueckblick: { type: 'boolean' },
    },
  },
}

export function istMeldungenWerkzeug(name: string): boolean {
  return name === MELDUNGEN_WERKZEUG.name
}

export async function fuehreMeldungenAus(
  // deno-lint-ignore no-explicit-any
  input: any,
  k: { supabase: Supa; mitarbeiter: { email?: string | null }; protokolliere: (t: string) => void },
): Promise<string> {
  const ich = String(k.mitarbeiter?.email ?? '').trim().toLowerCase()
  if (!ich) return 'Kein Login bekannt.'
  const { data, error } = await k.supabase.from('privat_einstellungen').select('briefing').eq('login_email', ich).maybeSingle()
  if (error) return `Einstellungen nicht lesbar: ${error.message}`
  const alt = data?.briefing && typeof data.briefing === 'object' ? data.briefing : {}
  const aenderung: Partial<Record<Schluessel, boolean>> = {}
  for (const s of Object.keys(SCHLUESSEL) as Schluessel[]) if (typeof input?.[s] === 'boolean') aenderung[s] = input[s]
  const neu = { ...alt, ...aenderung }
  if (Object.keys(aenderung).length) {
    const jetzt = new Date().toISOString()
    const { error: f } = data
      ? await k.supabase.from('privat_einstellungen').update({ briefing: neu, geaendert_am: jetzt }).eq('login_email', ich)
      : await k.supabase.from('privat_einstellungen').insert({ login_email: ich, briefing: neu, geaendert_am: jetzt })
    if (f) return `Nicht gespeichert: ${f.message}`
    k.protokolliere(`Automatische Nachrichten geändert: ${Object.entries(aenderung).map(([s, w]) => `${SCHLUESSEL[s as Schluessel]} ${w ? 'an' : 'aus'}`).join(', ')}`)
  }
  const stand = (Object.keys(SCHLUESSEL) as Schluessel[]).map((s) => `${SCHLUESSEL[s]}: ${neu[s] === false ? 'aus' : 'an'}`).join('\n')
  return `${Object.keys(aenderung).length ? 'Gespeichert.' : 'Aktueller Stand:'}\n${stand}`
}
