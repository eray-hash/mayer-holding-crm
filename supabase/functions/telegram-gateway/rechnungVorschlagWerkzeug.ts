// Assistent-Werkzeug „rechnung_vorschlaege“ (22.11.2026): Welche Rechnungen sind noch zu stellen? Listet die
// Rechnungsvorschläge (Tabelle rechnung_vorschlaege, Regeln in _shared/rechnungVorschlagKern.ts, angelegt vom
// Minutentakt email-gateway/rechnungVorschlaege.ts). Anlegen der Rechnung bleibt im CRM (Link je Vorschlag);
// hier wird nur gelesen — und auf Wunsch der Wochenhinweis des Mitarbeiters an- oder abgeschaltet.
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregel nach:
// nur mit dem Bereich Unternehmensberatung (wie Rechnungen), dazu der Bereich der Akte; Provisionen nur mit
// Immobilien-Rechten. Im privaten Assistenten gibt es das Werkzeug nicht (keine Zahlen der Holding).

import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { ART_NAME, euroCent, faelligSatz, vorschlagLink, type VorschlagZeile } from '../_shared/rechnungVorschlagKern.ts'
import { darfBereich, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type RechnungVorschlagKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const RECHNUNG_VORSCHLAG_WERKZEUGE = [
  {
    name: 'rechnung_vorschlaege',
    description:
      'Zeigt, welche Rechnungen noch zu stellen sind: angenommene Kostenvoranschläge ohne Rechnung, erledigte Aufträge (Akte abgeschlossen) ohne Rechnung, Seminarteilnahmen ohne Rechnung und Provisionen beurkundeter Objekte — mit Betrag (netto), Grund und Link zum Anlegen im CRM. Für Fragen wie „Welche Rechnungen müssen noch raus?“, „Haben wir etwas vergessen abzurechnen?“, „Was ist noch nicht in Rechnung gestellt?“. Angelegt wird die Rechnung im CRM (Link), nicht hier. Mit wochenhinweis=true/false schaltet der Mitarbeiter seinen Wochenhinweis „N Rechnungen sind fällig zu stellen“ (montags per Telegram) an oder aus.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['offen', 'erledigt', 'alle'], description: 'offen = noch zu stellen (Vorgabe); erledigt = schon angelegt oder verworfen (die letzten 20); alle = beides.' },
        wochenhinweis: { type: 'boolean', description: 'Nur wenn der Mitarbeiter es ausdrücklich will: true schaltet den Wochenhinweis an, false aus.' },
      },
    },
  },
]

export function istRechnungVorschlagWerkzeug(name: string): boolean {
  return RECHNUNG_VORSCHLAG_WERKZEUGE.some((w) => w.name === name)
}

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

function akteName(k: { firma?: unknown; ansprechpartner?: unknown }): string {
  const f = text(k.firma)
  const p = text(k.ansprechpartner)
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

/** Darf der Mitarbeiter den Vorschlag sehen (Zeilenregel nachgebildet)? */
export function darfVorschlag(m: RechteMitarbeiter, v: Pick<VorschlagZeile, 'art' | 'kunde_bereich'>): boolean {
  if (!darfBereich(m, 'beratung')) return false
  if (v.art === 'provision' && !darfBereich(m, 'immobilien')) return false
  const b = text(v.kunde_bereich)
  if (!b || b === 'intern') return true
  return darfBereich(m, b)
}

const STATUS_TEXT: Record<string, string> = { erstellt: 'Rechnung angelegt', verworfen: 'verworfen', offen: 'offen' }

export async function fuehreRechnungVorschlagWerkzeugAus(name: string, input: Record<string, unknown>, ctx: RechnungVorschlagKontext): Promise<string> {
  if (name !== 'rechnung_vorschlaege') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter: m } = ctx
  if (m.nurPrivat === true) return 'Fehler: Rechnungsvorschläge der Mayer Holding gibt es nur im Mayer-Assistenten.'
  if (!darfBereich(m, 'beratung')) return nichtFreigegeben('beratung', m.name)
  const zeilen: string[] = []

  // Wochenhinweis an/aus (eigene Einstellung).
  if (typeof input.wochenhinweis === 'boolean') {
    const email = text(m.email).toLowerCase()
    if (!email) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt — die Einstellung lässt sich nicht speichern.'
    const { error } = await supabase.from('rechnung_vorschlag_hinweis').upsert({ email, aktiv: input.wochenhinweis, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
    if (error) return `Fehler: Einstellung ließ sich nicht speichern: ${error.message}`
    ctx.protokolliere(`Wochenhinweis Rechnungen ${input.wochenhinweis ? 'an' : 'aus'} (${email})`)
    zeilen.push(input.wochenhinweis ? 'Wochenhinweis Rechnungen ist an: montags zwischen 9 und 12 Uhr kommt eine Nachricht, wenn Rechnungen fällig zu stellen sind.' : 'Wochenhinweis Rechnungen ist aus.')
  }

  const status = text(input.status) === 'erledigt' || text(input.status) === 'alle' ? text(input.status) : 'offen'
  const [offenRes, erledigtRes, basisRes] = await Promise.all([
    status !== 'erledigt' ? supabase.from('rechnung_vorschlaege').select('*').eq('status', 'offen').order('erstellt_am', { ascending: true }).limit(500) : Promise.resolve({ data: [], error: null }),
    status !== 'offen' ? supabase.from('rechnung_vorschlaege').select('*').in('status', ['erstellt', 'verworfen']).order('erledigt_am', { ascending: false }).limit(60) : Promise.resolve({ data: [], error: null }),
    supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle(),
  ])
  if (offenRes.error) return `Fehler: Vorschläge ließen sich nicht laden: ${offenRes.error.message}`
  if (erledigtRes.error) return `Fehler: Vorschläge ließen sich nicht laden: ${erledigtRes.error.message}`
  const basis = text(basisRes?.data?.link_basis) || CRM_BASIS_STANDARD
  const offen = ((offenRes.data ?? []) as VorschlagZeile[]).filter((v) => darfVorschlag(m, v))
  const erledigt = ((erledigtRes.data ?? []) as VorschlagZeile[]).filter((v) => darfVorschlag(m, v)).slice(0, 20)

  const ids = [...new Set([...offen, ...erledigt].map((v) => text(v.kunde_id)).filter(Boolean))]
  const namen = new Map<string, string>()
  if (ids.length) {
    const { data } = await supabase.from('kunden').select('id, firma, ansprechpartner').in('id', ids)
    for (const k of (data ?? []) as Record<string, unknown>[]) namen.set(text(k.id), akteName(k))
  }
  const betrag = (v: VorschlagZeile) => (Number(v.betrag_netto) > 0 ? `${euroCent(Number(v.betrag_netto))} netto` : 'Betrag offen')
  const wer = (v: VorschlagZeile) => (v.kunde_id ? namen.get(v.kunde_id) ?? 'Akte' : 'ohne Akte')

  if (status !== 'erledigt') {
    if (offen.length === 0) zeilen.push('Keine offenen Rechnungsvorschläge — es ist nichts vergessen.')
    else {
      const summe = offen.reduce((s, v) => s + (Number(v.betrag_netto) > 0 ? Number(v.betrag_netto) : 0), 0)
      zeilen.push(`${faelligSatz(offen.length)}${summe > 0 ? ` (zusammen ${euroCent(summe)} netto)` : ''}:`)
      for (const v of offen) {
        zeilen.push(`• [${v.id}] ${ART_NAME[v.art]} · ${wer(v)} · ${v.titel} · ${betrag(v)}\n  ${v.grund}\n  Anlegen im CRM: ${vorschlagLink(basis, v.id)}`)
      }
    }
  }
  if (status !== 'offen') {
    zeilen.push(erledigt.length ? 'Erledigte Vorschläge (zuletzt):' : 'Keine erledigten Vorschläge.')
    for (const v of erledigt) {
      zeilen.push(`• [${v.id}] ${ART_NAME[v.art]} · ${wer(v)} · ${v.titel} · ${betrag(v)} — ${STATUS_TEXT[v.status] ?? v.status}${v.erledigt_von ? ` von ${v.erledigt_von}` : ''}${v.erledigt_am ? ` am ${text(v.erledigt_am).slice(0, 10)}` : ''}`)
    }
  }
  zeilen.push('Rechnungen legt der Mitarbeiter im CRM an (Link) — dort lassen sich Vorschläge auch verwerfen.')
  return zeilen.join('\n')
}
