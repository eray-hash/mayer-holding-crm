// Assistent-Werkzeug „Was ist neu im CRM?“ (23.11.2026). Dieselben Einträge wie die Seite /neuigkeiten
// (Tabelle neuigkeiten, Kern _shared/neuigkeitenKern.ts) und derselbe Schalter wie der Tipp der Woche
// (email-gateway/neuigkeitenTipp.ts, Tabelle neuigkeiten_einstellung; keine Zeile = an).
//
// - Ohne Angaben: die für den Fragenden relevanten, noch ungelesenen Neuerungen (wichtigste zuerst, höchstens 8),
//   je mit Satz, Ort im CRM und Beispiel für Telegram.
// - alle=true: auch schon gelesene. als_gelesen=true: die gezeigten als gelesen vermerken (wie „Gelesen“ auf der Seite).
// - tipp_der_woche=true/false: den Dienstags-Tipp für den Fragenden an- oder abschalten.
//
// Die Einträge sind für alle Mitarbeiter sichtbar (keine Kundendaten); geschrieben wird nur die eigene Zeile.

import { crmAdresse, istRelevant, NEUIGKEIT_SPALTEN, neuigkeitAusZeile, sortiereNeuigkeiten } from '../_shared/neuigkeitenKern.ts'
import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { adresse, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type NeuigkeitenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

const HOECHSTENS = 8

export const NEUIGKEITEN_WERKZEUGE = [
  {
    name: 'neuigkeiten_im_crm',
    description:
      'Zeigt, was im CRM in letzter Zeit neu dazugekommen ist und den Fragenden betrifft (je Neuerung: was sie bringt, wo im CRM, wie per Telegram) — wie die Seite „Neu im CRM“. ' +
      'Für „Was ist neu?“, „Was kann das CRM inzwischen?“, „Gibt es was Neues für mich?“. Vorgabe: nur Ungelesenes. ' +
      'Mit als_gelesen=true werden die gezeigten Einträge als gelesen vermerkt (nur, wenn der Mitarbeiter das will oder sie ausdrücklich durchgehen wollte). ' +
      'Mit tipp_der_woche=true/false schaltet der Mitarbeiter seinen wöchentlichen Tipp per Telegram (dienstags 10 Uhr) an oder ab, z. B. „Tipp der Woche aus“.',
    input_schema: {
      type: 'object',
      properties: {
        alle: { type: 'boolean', description: 'true = auch schon gelesene Neuerungen zeigen.' },
        als_gelesen: { type: 'boolean', description: 'true = die gezeigten Neuerungen als gelesen vermerken.' },
        tipp_der_woche: { type: 'boolean', description: 'Nur wenn der Mitarbeiter es ausdrücklich will: true = Tipp der Woche an, false = aus.' },
      },
    },
  },
]

export function istNeuigkeitenWerkzeug(name: string): boolean {
  return NEUIGKEITEN_WERKZEUGE.some((w) => w.name === name)
}

async function setzeTipp(k: NeuigkeitenKontext, email: string, an: boolean): Promise<string> {
  const { error } = await k.supabase.from('neuigkeiten_einstellung').upsert({ email, telegram_tipp: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
  if (error) return `Fehler beim Speichern: ${error.message}`
  k.protokolliere(`Tipp der Woche ${an ? 'eingeschaltet' : 'ausgeschaltet'} (${email})`)
  return an
    ? 'Tipp der Woche ist an: dienstags gegen 10 Uhr kommt höchstens eine kurze Nachricht mit einer Neuerung, die du noch nicht kennst.'
    : 'Tipp der Woche ist aus. Wieder einschalten: „Tipp der Woche an“ oder auf der Seite „Neu im CRM“.'
}

export async function fuehreNeuigkeitenWerkzeugAus(name: string, input: Record<string, unknown>, k: NeuigkeitenKontext): Promise<string> {
  if (!istNeuigkeitenWerkzeug(name)) return `Fehler: unbekanntes Werkzeug ${name}`
  const email = adresse(k.mitarbeiter.email)
  if (!email) return 'Fehler: Zu deinem Zugang ist keine E-Mail-Adresse hinterlegt.'
  try {
    const teile: string[] = []
    if (typeof input.tipp_der_woche === 'boolean') {
      teile.push(await setzeTipp(k, email, input.tipp_der_woche))
      // Nur umschalten gewollt: keine Liste hinterher.
      if (input.alle !== true && input.als_gelesen !== true) return teile.join('\n')
    }

    const { data: zeilen, error } = await k.supabase.from('neuigkeiten').select(NEUIGKEIT_SPALTEN).eq('aktiv', true).order('datum', { ascending: false }).limit(500)
    if (error) return `Fehler beim Lesen der Neuigkeiten: ${error.message}`
    const relevant = ((zeilen ?? []) as Record<string, unknown>[]).map(neuigkeitAusZeile).filter((n) => n.id && n.titel && istRelevant(n, k.mitarbeiter))
    const ids = relevant.map((n) => n.id)
    let gelesen = new Set<string>()
    if (ids.length > 0) {
      const { data: gel, error: gelFehler } = await k.supabase.from('neuigkeiten_gelesen').select('schluessel').eq('email', email).in('schluessel', ids)
      if (gelFehler) return `Fehler beim Lesen: ${gelFehler.message}`
      gelesen = new Set(((gel ?? []) as { schluessel: string }[]).map((g) => String(g.schluessel)))
    }
    const { data: einst } = await k.supabase.from('neuigkeiten_einstellung').select('schwerpunkte, telegram_tipp').eq('email', email).maybeSingle()
    const schwerpunkte = Array.isArray(einst?.schwerpunkte) ? (einst.schwerpunkte as string[]) : []
    const auswahl = sortiereNeuigkeiten(input.alle === true ? relevant : relevant.filter((n) => !gelesen.has(n.id)), schwerpunkte)
    const ungelesen = relevant.filter((n) => !gelesen.has(n.id)).length

    const { data: wk } = await k.supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const basis = String(wk?.link_basis ?? '').trim() || CRM_BASIS_STANDARD

    if (auswahl.length === 0) {
      teile.push(input.alle === true ? 'Zurzeit sind keine Neuerungen eingetragen.' : `Du kennst schon alles Neue — keine ungelesenen Neuerungen. Alle ansehen: ${crmAdresse(basis, '/neuigkeiten')}`)
      return teile.join('\n')
    }
    const gezeigt = auswahl.slice(0, HOECHSTENS)
    teile.push(
      `${input.alle === true ? `Neuerungen im CRM (${relevant.length}, davon ${ungelesen} ungelesen)` : `${ungelesen} ungelesene Neuerung${ungelesen === 1 ? '' : 'en'} für dich`}${auswahl.length > gezeigt.length ? `, hier die ${gezeigt.length} wichtigsten` : ''}:`,
    )
    for (const n of gezeigt) {
      teile.push(
        [
          `- ${n.titel}${gelesen.has(n.id) ? ' (gelesen)' : ''} [id=${n.id}, ${n.datum}]: ${n.text}`,
          n.link ? `  Im CRM: ${crmAdresse(basis, n.link)}` : '',
          n.telegram_beispiel ? `  Per Telegram: „${n.telegram_beispiel}“` : '',
        ].filter(Boolean).join('\n'),
      )
    }
    teile.push(`Alle Neuerungen: ${crmAdresse(basis, '/neuigkeiten')}`)
    if (typeof input.tipp_der_woche !== 'boolean') teile.push(`Tipp der Woche per Telegram: ${einst?.telegram_tipp === false ? 'aus' : 'an'}.`)

    if (input.als_gelesen === true) {
      const neu = gezeigt.filter((n) => !gelesen.has(n.id)).map((n) => ({ email, schluessel: n.id, gelesen_am: new Date().toISOString() }))
      if (neu.length > 0) {
        const { error: schreibFehler } = await k.supabase.from('neuigkeiten_gelesen').upsert(neu, { onConflict: 'email,schluessel' })
        if (schreibFehler) teile.push(`Fehler: als gelesen vermerken ging nicht (${schreibFehler.message}).`)
        else {
          k.protokolliere(`Neuigkeiten als gelesen vermerkt: ${neu.map((z) => z.schluessel).join(', ')}`)
          teile.push(`${neu.length} als gelesen vermerkt.`)
        }
      }
    }
    return teile.join('\n')
  } catch (err) {
    return `Fehler: ${err instanceof Error ? err.message : String(err)}`
  }
}
