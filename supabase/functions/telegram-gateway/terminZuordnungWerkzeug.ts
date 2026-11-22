// Assistent-Werkzeug termin_zuordnen (22.11.2026): einen Kalendertermin einer Kundenakte zuordnen, die Verknüpfung
// lösen oder einen Vorschlag ablehnen. Dieselben Regeln wie im CRM-Kalender (Aktion termin_zuordnen in email-gateway),
// Kern in _shared/terminZuordnungKern.ts (ordneVonHandZu):
// - Besitzer und Teilnehmer des Termins dürfen; die Akte muss der Mitarbeiter sehen dürfen (Bereichsrechte),
//   einen privaten Kontakt nur an einem eigenen Termin ohne Kollegen; im privaten Assistenten nur eigene Termine ohne Kollegen.
// - Eine gelöste oder abgelehnte Akte schlägt die automatische Zuordnung für diesen Termin nie wieder vor.
// - Ohne kunde_id übernimmt das Werkzeug den offenen Vorschlag des Termins (aus termine_zeigen: akte_vorschlag).
// Schreibt nur kunde_id/kunde_bereich/kunde_name und die Zuordnungs-Spalten; sendet nichts.

import { ordneVonHandZu, vorschlagSichtbar, type ZuordnungTermin } from '../_shared/terminZuordnungKern.ts'
import type { RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type ZuordnungKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const ZUORDNUNG_WERKZEUGE = [
  {
    name: 'termin_zuordnen',
    description:
      'Ordnet einen Kalendertermin (termin_id aus termine_zeigen) einer Kundenakte zu, damit Briefing, Nachfrage nach dem Termin und Wochenrückblick die Akte kennen. Für „Der Termin morgen gehört zu Familie X“, „Ja, der Vorschlag stimmt“. Ohne kunde_id wird der offene Vorschlag des Termins übernommen (akte_vorschlag in termine_zeigen). Mit loesen=true wird eine falsche Verknüpfung entfernt, mit vorschlag_ablehnen=true ein falscher Vorschlag verworfen — beides kommt für diesen Termin nicht wieder. Sendet nichts.',
    input_schema: {
      type: 'object',
      properties: {
        termin_id: { type: 'string', description: 'Der Termin (aus termine_zeigen).' },
        kunde_id: { type: 'string', description: 'Optional: die Akte (mit kunden_suchen ermitteln). Ohne Angabe: der offene Vorschlag.' },
        loesen: { type: 'boolean', description: 'true = bestehende Verknüpfung mit der Akte entfernen.' },
        vorschlag_ablehnen: { type: 'boolean', description: 'true = den offenen Vorschlag verwerfen, ohne etwas zuzuordnen.' },
        gleiche_titel: { type: 'boolean', description: 'true = auch die anderen eigenen Termine mit genau diesem Titel ohne Akte (Serientermine) derselben Akte zuordnen. Nur auf ausdrücklichen Wunsch („alle Caras-Termine“).' },
      },
      required: ['termin_id'],
    },
  },
]

export function istZuordnungWerkzeug(name: string): boolean {
  return ZUORDNUNG_WERKZEUGE.some((w) => w.name === name)
}

function person(m: ZuordnungKontext['mitarbeiter']) {
  return { email: String(m.email ?? ''), name: m.name, rolle: m.rolle ?? null, ist_admin: m.ist_admin ?? null, bereiche: m.bereiche ?? [], nurPrivat: m.nurPrivat ?? null }
}

export async function fuehreZuordnungWerkzeugAus(name: string, input: Record<string, unknown>, ctx: ZuordnungKontext): Promise<string> {
  if (name !== 'termin_zuordnen') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere } = ctx
  if (!String(mitarbeiter.email ?? '').trim()) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  const terminId = String(input.termin_id ?? '').trim()
  if (!terminId) return 'Fehler: termin_id fehlt. Ermittle sie mit termine_zeigen.'
  const p = person(mitarbeiter)

  let kundeId = String(input.kunde_id ?? '').trim() || null
  const loesen = input.loesen === true
  const ablehnen = input.vorschlag_ablehnen === true
  if (loesen && (kundeId || ablehnen)) return 'Fehler: loesen nicht zusammen mit kunde_id oder vorschlag_ablehnen angeben.'
  if (!kundeId && !loesen && !ablehnen) {
    // Ohne Angabe: den offenen Vorschlag übernehmen (nur wenn der Mitarbeiter ihn sehen darf).
    const { data: t } = await supabase.from('termine').select('id, besitzer_email, kunde_id, zuordnung_vorschlag').eq('id', terminId).maybeSingle()
    const v = t ? vorschlagSichtbar(p, t as ZuordnungTermin) : null
    if (!v?.kunde_id) return 'Fehler: Für diesen Termin gibt es keinen offenen Vorschlag — gib kunde_id an (mit kunden_suchen ermitteln).'
    kundeId = v.kunde_id
  }

  const ergebnis = await ordneVonHandZu(supabase, p, { terminId, kundeId: loesen ? null : kundeId, vorschlagAblehnen: ablehnen, gleicheTitel: input.gleiche_titel === true })
  if (!ergebnis.ok) return `Fehler: ${ergebnis.fehler}`
  protokolliere(`${ergebnis.text} (termin_id=${terminId})`)
  return `${ergebnis.text} termin_id=${terminId}`
}

/**
 * Für termine_zeigen: offener Vorschlag als kurzer Text, nur bei eigenen/gemeinsamen Terminen ohne Akte und nur,
 * wenn der Mitarbeiter die vorgeschlagene Akte sehen darf.
 */
export function akteVorschlagText(m: ZuordnungKontext['mitarbeiter'], t: Pick<ZuordnungTermin, 'besitzer_email' | 'kunde_id' | 'zuordnung_vorschlag'>): string | undefined {
  const v = vorschlagSichtbar(person(m), t)
  return v ? `${v.name ?? v.kunde_id} (kunde_id=${v.kunde_id}) — wahrscheinlich, noch nicht bestätigt; mit termin_zuordnen übernehmen` : undefined
}
