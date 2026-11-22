// Assistent-Werkzeug „export_steuerberater_status“ (22.11.2026): Was fehlt noch für die Übergabe an den
// Steuerberater für Monat/Quartal X? Zählt Ausgangsrechnungen und Eingangsrechnungen (Verbindlichkeiten)
// des Zeitraums, summiert sie und nennt die offenen Punkte: Rechnungen ohne gespeichertes PDF,
// Eingangsrechnungen ohne Beleg, noch nicht geprüfte automatisch erkannte Einträge, fehlende Beträge,
// Rechnungsnummern, Kategorien, fehlende Berater-/Mandantennummer. Nur lesen — die ZIP-Datei selbst
// lädt man im CRM (Rechnungen → „Export für Steuerberater“). Rechenkern: _shared/datevExport.ts,
// derselbe wie im CRM (src/components/rechnungen/SteuerberaterExport.tsx).
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten. Zeilenregeln rechnungen/verbindlichkeiten
// und steuerberater_einstellung: darf_bereich('beratung'). Dazu wie rechnungen_offen: Rechnungen zu
// Akten, die der Mitarbeiter nicht sehen darf (fremde private Akten, nicht freigegebene Bereiche),
// zählen nicht mit. Im privaten Assistenten gibt es das Werkzeug nicht (nicht in PRIVAT_BOT_WERKZEUGE).

import {
  ausRechnungZeile, ausVerbindlichkeitZeile, einstellungAusZeile, leseZeitraum, pruefeExport, statusText,
} from '../_shared/datevExport.ts'
import { darfAkte, darfBereich, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type DatevKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const DATEV_WERKZEUGE = [
  {
    name: 'export_steuerberater_status',
    description:
      'Prüft, was für die Übergabe an den Steuerberater (DATEV-Buchungsstapel mit Rechnungen und Belegen) für einen Monat oder ein Quartal noch fehlt: Anzahl und Summen der Ausgangs- und Eingangsrechnungen, Rechnungen ohne gespeichertes PDF, Eingangsrechnungen ohne Beleg, noch nicht geprüfte automatisch erkannte Eingangsrechnungen, fehlende Beträge oder Rechnungsnummern, fehlende Berater-/Mandantennummer. Für „Was fehlt noch für den Steuerberater?“, „Können wir den Oktober abgeben?“, „Ist das 3. Quartal vollständig?“. Nur lesen; die Datei selbst lädt man im CRM unter Rechnungen → „Export für Steuerberater“.',
    input_schema: {
      type: 'object',
      properties: {
        zeitraum: {
          type: 'string',
          description: 'Monat oder Quartal, z. B. "2026-10", "Oktober", "Oktober 2026", "Q3 2026", "3. Quartal", "letztes Quartal". Ohne Angabe: der Vormonat (üblicher Abgabemonat).',
        },
        mit_hinweisen: { type: 'boolean', description: 'true = auch die Punkte „zur Kenntnis“ (z. B. 0 %-Rechnungen, nur Bruttobetrag) auflisten. Vorgabe: false, nur was noch zu erledigen ist.' },
      },
    },
  },
]

export function istDatevWerkzeug(name: string): boolean {
  return DATEV_WERKZEUGE.some((w) => w.name === name)
}

type AkteKurz = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }

function akteName(a: AkteKurz | undefined): string {
  if (!a) return ''
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && f && p !== f ? `${f} (${p})` : f || p
}

// deno-lint-ignore no-explicit-any
export async function fuehreDatevWerkzeugAus(name: string, input: any, k: DatevKontext): Promise<string> {
  const { supabase, mitarbeiter, heute } = k
  if (name !== 'export_steuerberater_status') return `Fehler: unbekanntes Werkzeug ${name}.`
  if (!darfBereich(mitarbeiter, 'beratung')) return nichtFreigegeben('beratung', mitarbeiter.name)

  const roh = String(input?.zeitraum ?? '').trim()
  const zeitraum = leseZeitraum(roh, heute)
  if (!zeitraum) return `Fehler: Den Zeitraum „${roh}“ verstehe ich nicht. Bitte als Monat ("2026-10", "Oktober 2026") oder Quartal ("Q3 2026") angeben.`

  const [rech, verb, einst] = await Promise.all([
    supabase
      .from('rechnungen')
      .select('id, nummer, datum, kunde_id, betrag_netto, betrag_brutto, ust_satz, status, leistung_bezeichnung, bezahlt_am, zahlungen, dokument')
      .gte('datum', zeitraum.von)
      .lte('datum', zeitraum.bis)
      .limit(5000),
    supabase
      .from('verbindlichkeiten')
      .select('id, lieferant, rechnungsnummer, datum, betrag_netto, betrag_brutto, kategorie, status, bezahlt_am, quelle, quell_email_id, geprueft, beleg')
      .gte('datum', zeitraum.von)
      .lte('datum', zeitraum.bis)
      .limit(5000),
    supabase.from('steuerberater_einstellung').select('*').eq('id', 1).maybeSingle(),
  ])
  if (rech.error) return `Fehler beim Laden der Rechnungen: ${rech.error.message}`
  if (verb.error) return `Fehler beim Laden der Verbindlichkeiten: ${verb.error.message}`
  // Fehlt die Tabelle der Einstellungen (noch nicht eingerichtet), gelten die Vorgaben.
  const einstellung = einstellungAusZeile(einst?.error ? null : einst?.data)

  const rechnungsZeilen = (rech.data ?? []) as Record<string, unknown>[]
  const ids = [...new Set(rechnungsZeilen.map((r) => String(r.kunde_id ?? '')).filter(Boolean))]
  const akten = new Map<string, AkteKurz>()
  if (ids.length) {
    const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', ids)
    for (const a of (data ?? []) as AkteKurz[]) akten.set(a.id, a)
  }
  const rechnungen = rechnungsZeilen
    .filter((r) => {
      const a = akten.get(String(r.kunde_id ?? ''))
      return !a || darfAkte(mitarbeiter, a)
    })
    .map((r) => ausRechnungZeile(r, akteName(akten.get(String(r.kunde_id ?? '')))))

  // Hat die Original-Mail einer Verbindlichkeit ohne eigenen Beleg Anhänge? (die legt das CRM dann bei)
  const verbZeilen = (verb.data ?? []) as Record<string, unknown>[]
  const mailIds = [...new Set(verbZeilen.filter((v) => !v.beleg && v.quell_email_id).map((v) => String(v.quell_email_id)))]
  const mitAnhang = new Set<string>()
  if (mailIds.length) {
    const { data } = await supabase.from('eingegangene_emails').select('message_id, anhaenge').in('message_id', mailIds)
    for (const m of (data ?? []) as { message_id: string; anhaenge: unknown }[]) {
      if (Array.isArray(m.anhaenge) && m.anhaenge.some((a) => a && typeof a === 'object' && (a as { url?: unknown }).url)) mitAnhang.add(m.message_id)
    }
  }
  const belege = verbZeilen.map((v) => ausVerbindlichkeitZeile(v, mitAnhang.has(String(v.quell_email_id ?? ''))))

  const pruefung = pruefeExport(rechnungen, belege, einstellung, zeitraum)
  return `${statusText(pruefung, { ohneHinweise: input?.mit_hinweisen !== true })}\nDie Übergabe-Datei (ZIP mit DATEV-Buchungsstapel, lesbaren Listen und allen Belegen) lädt man im CRM unter Rechnungen → „Export für Steuerberater“.`.slice(0, 12000)
}
