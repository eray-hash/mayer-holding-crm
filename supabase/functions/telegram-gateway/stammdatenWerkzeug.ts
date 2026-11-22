// Assistent-Werkzeug für Stammdaten-Vorschläge aus Mail-Signaturen (22.11.2026).
//
// Der Server (email-gateway/stammdatenErgaenzen.ts) füllt leere Felder einer Akte (Telefon, Anschrift,
// E-Mail-Adresse) selbst aus den Signaturen der Kunden-Mails. Steht in der Akte schon etwas anderes, legt er
// nur einen Vorschlag in kunden.stammdaten_vorschlaege ab. Dieses Werkzeug listet die offenen Vorschläge und
// übernimmt oder verwirft sie — wie der Hinweis in der Akte (src/components/StammdatenVorschlaege.tsx).
//
// Der Assistent arbeitet mit vollen Datenbankrechten; die Zeilenregel der Datenbank (Bereich der Akte,
// private Akten nur ihr Besitzer) bildet rechte.ts nach.

import {
  alsVorschlaege,
  erledige,
  FELD_NAME,
  offeneVorschlaege,
  type StammdatenVorschlag,
  uebernommenText,
  vorschlagText,
} from '../_shared/stammdatenVorschlag.ts'
import { darfAkte, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type StammdatenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const STAMMDATEN_WERKZEUGE = [
  {
    name: 'stammdaten_vorschlaege',
    description:
      'Vorschläge für Stammdaten aus E-Mail-Signaturen: Das CRM liest die Signaturen in den Mails der Kunden und füllt leere Felder (Telefon, Anschrift, E-Mail-Adresse) selbst. Nennt die Signatur etwas anderes als die Akte, entsteht ein Vorschlag. aktion "auflisten" zeigt die offenen Vorschläge (optional nur einer Akte), "uebernehmen" trägt den Wert in die Akte ein (überschreibt den bisherigen, mit Verlaufseintrag), "verwerfen" lehnt ihn ab. Für Fragen wie „Gibt es neue Telefonnummern aus Mails?“ oder „Übernimm die neue Nummer von Herrn X“. Vor dem Übernehmen den Wert nennen und nur auf ausdrücklichen Wunsch übernehmen.',
    input_schema: {
      type: 'object',
      properties: {
        aktion: { type: 'string', enum: ['auflisten', 'uebernehmen', 'verwerfen'], description: 'Was getan werden soll (Vorgabe: auflisten).' },
        kunde_id: { type: 'string', description: 'Optional: nur diese Akte (mit kunden_suchen ermitteln).' },
        id: { type: 'string', description: 'Für uebernehmen/verwerfen: ID des Vorschlags (beginnt mit sv_, aus auflisten).' },
      },
    },
  },
]

export function istStammdatenWerkzeug(name: string): boolean {
  return STAMMDATEN_WERKZEUGE.some((w) => w.name === name)
}

const SPALTEN = 'id, bereich, firma, ansprechpartner, verantwortlich_email, telefon, anschrift, email, stammdaten_vorschlaege'

type AkteZeile = {
  id: string
  bereich: string | null
  firma: string | null
  ansprechpartner: string | null
  verantwortlich_email: string | null
  telefon: string | null
  anschrift: string | null
  email: string | null
  stammdaten_vorschlaege: unknown
}

function aktenName(a: AkteZeile): string {
  return String(a.firma ?? '').trim() || String(a.ansprechpartner ?? '').trim() || a.id
}

/** Akten mit Vorschlägen, die der Mitarbeiter sehen darf (eine bestimmte oder alle). */
async function ladeAkten(supabase: Supa, mitarbeiter: RechteMitarbeiter, kundeId: string): Promise<AkteZeile[] | string> {
  if (kundeId) {
    const { data, error } = await supabase.from('kunden').select(SPALTEN).eq('id', kundeId).maybeSingle()
    if (error) return `Fehler beim Laden: ${error.message}`
    if (!data || !darfAkte(mitarbeiter, data)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    return [data as AkteZeile]
  }
  const { data, error } = await supabase.from('kunden').select(SPALTEN).neq('bereich', 'privat')
  if (error) return `Fehler beim Laden: ${error.message}`
  return ((data ?? []) as AkteZeile[]).filter((a) => offeneVorschlaege(a.stammdaten_vorschlaege).length > 0 && darfAkte(mitarbeiter, a))
}

export async function fuehreStammdatenWerkzeugAus(name: string, input: Record<string, unknown>, k: StammdatenKontext): Promise<string> {
  if (name !== 'stammdaten_vorschlaege') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (mitarbeiter.nurPrivat === true) return 'Für private Kontakte gibt es keine Vorschläge aus Signaturen.'
  const aktion = String(input?.aktion ?? 'auflisten').trim() || 'auflisten'
  const kundeId = String(input?.kunde_id ?? '').trim()

  if (aktion === 'auflisten') {
    const akten = await ladeAkten(supabase, mitarbeiter, kundeId)
    if (typeof akten === 'string') return akten
    const zeilen: string[] = []
    for (const a of akten) {
      for (const v of offeneVorschlaege(a.stammdaten_vorschlaege)) zeilen.push(`- ${v.id} · ${aktenName(a)} (${a.id}): ${vorschlagText(v)}`)
    }
    if (!zeilen.length) return kundeId ? 'Für diese Akte gibt es keine offenen Vorschläge aus Signaturen.' : 'Es gibt keine offenen Vorschläge aus Signaturen.'
    const mehr = zeilen.length > 25 ? `\n… und ${zeilen.length - 25} weitere.` : ''
    return `Offene Vorschläge aus E-Mail-Signaturen (${zeilen.length}):\n${zeilen.slice(0, 25).join('\n')}${mehr}`
  }

  if (aktion !== 'uebernehmen' && aktion !== 'verwerfen') return 'Fehler: aktion muss "auflisten", "uebernehmen" oder "verwerfen" sein.'
  const id = String(input?.id ?? '').trim()
  if (!id) return 'Fehler: id des Vorschlags fehlt (aus auflisten).'
  const akten = await ladeAkten(supabase, mitarbeiter, kundeId)
  if (typeof akten === 'string') return akten
  const akte = akten.find((a) => alsVorschlaege(a.stammdaten_vorschlaege).some((v) => v.id === id))
  if (!akte) return 'Fehler: Diesen Vorschlag gibt es nicht (mehr). Mit aktion "auflisten" die offenen ansehen.'

  // Liste direkt vor dem Schreiben frisch lesen.
  const { data: frisch, error } = await supabase.from('kunden').select('id, telefon, anschrift, email, activities, stammdaten_vorschlaege').eq('id', akte.id).maybeSingle()
  if (error || !frisch) return `Fehler beim Laden der Akte: ${error?.message ?? 'nicht gefunden'}`
  const liste = alsVorschlaege(frisch.stammdaten_vorschlaege)
  const vorschlag = liste.find((v) => v.id === id) as StammdatenVorschlag | undefined
  if (!vorschlag || vorschlag.status !== 'offen') return `Fehler: Dieser Vorschlag ist schon erledigt (${vorschlag?.status === 'uebernommen' ? 'übernommen' : 'verworfen'}).`
  const neu = erledige(liste, id, aktion === 'uebernehmen' ? 'uebernommen' : 'verworfen', mitarbeiter.name, heute)!

  if (aktion === 'verwerfen') {
    const { error: e } = await supabase.from('kunden').update({ stammdaten_vorschlaege: neu }).eq('id', akte.id)
    if (e) return `Fehler beim Speichern: ${e.message}`
    protokolliere(`Stammdaten-Vorschlag verworfen: ${aktenName(akte)} · ${FELD_NAME[vorschlag.feld]}`)
    return `Verworfen: ${vorschlagText(vorschlag)} — Akte ${aktenName(akte)} bleibt unverändert.`
  }

  const verlauf = Array.isArray(frisch.activities) ? frisch.activities : []
  const eintrag = { id: crypto.randomUUID(), date: heute, text: uebernommenText(vorschlag, mitarbeiter.name), user: mitarbeiter.name }
  const { error: e } = await supabase
    .from('kunden')
    .update({ [vorschlag.feld]: vorschlag.wert, stammdaten_vorschlaege: neu, activities: [eintrag, ...verlauf] })
    .eq('id', akte.id)
  if (e) return `Fehler beim Speichern: ${e.message}`
  protokolliere(`Stammdaten-Vorschlag übernommen: ${aktenName(akte)} · ${FELD_NAME[vorschlag.feld]}`)
  return `Übernommen in Akte ${aktenName(akte)} (${akte.id}): ${eintrag.text}`
}
