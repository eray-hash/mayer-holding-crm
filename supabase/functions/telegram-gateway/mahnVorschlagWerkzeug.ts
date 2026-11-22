// Assistent-Werkzeug „mahn_vorschlaege“ (22.11.2026): Welche überfälligen Rechnungen sind heute dran? Nur lesen.
// Rechnet mit denselben Regeln wie der Tageslauf (email-gateway/mahnVorschlag.ts, Regeln in
// _shared/mahnVorschlagKern.ts): wie viele Rechnungen heute einen Mahnvorschlag bekämen, welche Vorschläge offen
// oder zurückgestellt sind und welche bewusst übersprungen werden (Zahlung eingegangen, Kontoauszug-Abgleich offen).
// Erstellt und gesendet wird das Schreiben im CRM (Link), nie hier.
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb wie die Zeilenregel: nur mit dem Bereich
// Unternehmensberatung (Rechnungen), dazu die Akte der Rechnung (darfAkte). Im privaten Assistenten nicht.

import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { akteName, deDatum, euro, ladeMahnLage, mahnLink, STUFE_NAME, tageText, type AkteKurz, type MahnRechnung } from '../_shared/mahnVorschlagKern.ts'
import { darfAkte, darfBereich, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type MahnVorschlagKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Für Tests: gelesene Kontoauszüge ersetzen. */
  // deno-lint-ignore no-explicit-any
  ladeAuszuege?: (admin: any, heute: string) => Promise<any[][]>
}

export const MAHN_VORSCHLAG_WERKZEUGE = [
  {
    name: 'mahn_vorschlaege',
    description:
      'Zeigt das Mahnwesen von heute (nur lesen): wie viele überfällige Rechnungen heute einen Mahnvorschlag bekommen (Zahlungserinnerung, 1. oder 2. Mahnung nach den eingestellten Tagen), welche Vorschläge noch offen oder zurückgestellt sind (z. B. Ratenzahlung) und welche Rechnungen bewusst übersprungen werden (Zahlung in den letzten Tagen, Kontoauszug noch nicht bestätigt). Für Fragen wie „Wen müssen wir mahnen?“, „Welche Mahnungen stehen an?“, „Wie viele Rechnungen bekommen heute eine Zahlungserinnerung?“. Gesendet wird hier nichts — das Schreiben wird im CRM auf der Seite Mahnwesen geprüft und gesendet (Link im Ergebnis).',
    input_schema: { type: 'object', properties: {} },
  },
]

export function istMahnVorschlagWerkzeug(name: string): boolean {
  return MAHN_VORSCHLAG_WERKZEUGE.some((w) => w.name === name)
}

export async function fuehreMahnVorschlagWerkzeugAus(name: string, _input: Record<string, unknown>, ctx: MahnVorschlagKontext): Promise<string> {
  if (name !== 'mahn_vorschlaege') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter: m, heute } = ctx
  if (m.nurPrivat === true) return 'Fehler: Das Mahnwesen der Mayer Holding gibt es nur im Mayer-Assistenten.'
  if (!darfBereich(m, 'beratung')) return nichtFreigegeben('beratung', m.name)

  let lage
  try {
    lage = await ladeMahnLage(supabase, heute, { ohneTabelleOk: true, ladeAuszuege: ctx.ladeAuszuege })
  } catch (err) {
    return `Fehler: Mahnwesen ließ sich nicht laden (${err instanceof Error ? err.message : String(err)}).`
  }
  const { plan, akten, einstellung, vorhandene } = lage
  const akteVon = (kundeId: string | null | undefined): AkteKurz | undefined => (kundeId ? akten.get(kundeId) : undefined)
  const sichtbar = (kundeId: string | null | undefined) => {
    const a = akteVon(kundeId)
    return !a || darfAkte(m, a)
  }
  const rechnungJe = new Map(lage.rechnungen.map((r) => [r.id, r]))
  const wer = (r: Pick<MahnRechnung, 'kunde_id'>) => akteName(akteVon(r.kunde_id))
  const { data: wk } = await supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
  const basis = String(wk?.link_basis ?? '').trim() || CRM_BASIS_STANDARD

  const heuteFaellig = [...plan.neu, ...plan.reaktivieren].filter((f) => sichtbar(f.rechnung.kunde_id))
  const offen = vorhandene.filter((z) => z.status === 'offen' && sichtbar(z.kunde_id) && !plan.abschliessen.some((a) => a.zeile.id === z.id))
  const zurueck = plan.zurueckgestellt.filter((z) => sichtbar(z.rechnung.kunde_id))
  const uebersprungen = plan.uebersprungen.filter((u) => sichtbar(u.rechnung.kunde_id))

  const zeilen: string[] = []
  if (!einstellung.aktiv) zeilen.push('Hinweis: Die täglichen Mahnvorschläge sind ausgeschaltet (Seite Mahnwesen → Einstellungen).')
  zeilen.push(
    heuteFaellig.length === 0
      ? 'Heute bekommt keine weitere Rechnung einen Mahnvorschlag.'
      : `Heute ${heuteFaellig.length === 1 ? 'bekäme 1 Rechnung' : `bekämen ${heuteFaellig.length} Rechnungen`} einen Mahnvorschlag:`,
  )
  for (const f of heuteFaellig) zeilen.push(`• ${f.rechnung.nummer} (${wer(f.rechnung)}): ${tageText(f.tage)} überfällig — ${STUFE_NAME[f.stufe]}, offen ${euro(f.offen)}${'zeile' in f ? ' (Zurückstellung abgelaufen)' : ''} [${f.rechnung.id}]`)
  if (heuteFaellig.length) zeilen.push(`Der Tageslauf legt sie ab 9 Uhr als Vorschlag an und meldet sie dem Zuständigen.`)

  if (offen.length) {
    zeilen.push('', `Offene Vorschläge (${offen.length}), im CRM zu prüfen und zu senden:`)
    for (const z of offen) {
      const r = rechnungJe.get(z.rechnung_id)
      zeilen.push(`• ${z.rechnung_nummer ?? r?.nummer ?? z.rechnung_id} (${r ? wer(r) : akteName(akteVon(z.kunde_id))}): ${STUFE_NAME[z.stufe]}, vorgeschlagen am ${deDatum(String(z.erstellt_am ?? '').slice(0, 10))} — ${mahnLink(basis, z.id)}`)
    }
  }
  if (zurueck.length) {
    zeilen.push('', `Zurückgestellt (${zurueck.length}):`)
    for (const z of zurueck) zeilen.push(`• ${z.rechnung.nummer} (${wer(z.rechnung)}): bis ${deDatum(z.zeile.zurueckgestellt_bis)}${z.zeile.notiz ? ` — ${z.zeile.notiz}` : ''}`)
  }
  if (uebersprungen.length) {
    zeilen.push('', `Übersprungen (${uebersprungen.length}):`)
    for (const u of uebersprungen) zeilen.push(`• ${u.rechnung.nummer} (${wer(u.rechnung)}): ${STUFE_NAME[u.stufe]} wäre fällig, aber ${u.grund}`)
  }
  zeilen.push('', `Regel: Zahlungserinnerung ${einstellung.tage.erinnerung} Tage nach dem Zahlungsziel, 1. Mahnung nach ${einstellung.tage.mahnung1}, 2. Mahnung nach ${einstellung.tage.mahnung2} Tagen (jeweils erst nach Ablauf der Frist aus dem letzten Schreiben). Mahnwesen im CRM: ${mahnLink(basis)}`)
  return zeilen.join('\n')
}
