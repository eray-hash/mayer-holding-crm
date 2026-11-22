// Assistent-Werkzeug „verbindlichkeiten_pruefen“ (22.11.2026): Welche Eingangsrechnungen (Verbindlichkeiten)
// sind unvollständig — Beleg, Betrag oder Rechnungsnummer fehlen, oder es ist wohl gar keine Rechnung?
// Nennt je Eintrag, was fehlt, und ob Angaben automatisch ergänzt wurden (bitte prüfen). Nur lesen; die
// Regeln sind dieselben wie im CRM (Verbindlichkeiten → Filter „Unvollständig“): _shared/belegLuecken.ts.
// Belege aus den Original-Mails ergänzt der Server von selbst (email-gateway/belegErgaenzen.ts).
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten. Zeilenregel verbindlichkeiten:
// darf_bereich('beratung') — hier nachgebildet. Im privaten Assistenten gibt es das Werkzeug nicht
// (nicht in PRIVAT_BOT_WERKZEUGE).

import { angabenAusZeile, belegLuecken, erkanntAus } from '../_shared/belegLuecken.ts'
import { darfBereich, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type VerbindlichkeitenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const VERBINDLICHKEITEN_WERKZEUGE = [
  {
    name: 'verbindlichkeiten_pruefen',
    description:
      'Listet unvollständige Eingangsrechnungen (Verbindlichkeiten): bei welchen der Beleg, der Betrag oder die Rechnungsnummer fehlt, welche wohl gar keine echte Rechnung sind (Werbung, Betrugsversuch) und welche Angaben automatisch ergänzt wurden und noch bestätigt werden müssen. Für „Welche Rechnungen sind unvollständig?“, „Wo fehlen Belege?“, „Was muss ich bei den Verbindlichkeiten noch nachtragen?“. Nur lesen.',
    input_schema: {
      type: 'object',
      properties: {
        mit_bezahlten: { type: 'boolean', description: 'true = auch bereits bezahlte Verbindlichkeiten prüfen. Vorgabe: true (für den Steuerberater zählen alle).' },
        mit_hinweisen: { type: 'boolean', description: 'true = auch Einträge nennen, die nur Hinweise haben (Betrag 0 €, nur Bruttobetrag, automatisch ergänzt). Vorgabe: false.' },
      },
    },
  },
]

export function istVerbindlichkeitenWerkzeug(name: string): boolean {
  return VERBINDLICHKEITEN_WERKZEUGE.some((w) => w.name === name)
}

const SPALTEN = 'id, lieferant, rechnungsnummer, datum, betrag_netto, betrag_brutto, status, quelle, quell_email_id, geprueft, beleg, automatisch_erkannt'

const datumDe = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)
const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Alle Verbindlichkeiten, seitenweise nach id (mehr als 1000 Zeilen möglich). Ohne Spalte automatisch_erkannt noch einmal ohne sie. */
async function ladeAlle(supabase: Supa): Promise<{ zeilen: Record<string, unknown>[]; fehler?: string }> {
  const zeilen: Record<string, unknown>[] = []
  let spalten = SPALTEN
  let ab = ''
  for (let i = 0; i < 50; i++) {
    let q = supabase.from('verbindlichkeiten').select(spalten).order('id', { ascending: true }).limit(500)
    if (ab) q = q.gt('id', ab)
    const { data, error } = await q
    if (error) {
      // Spalte noch nicht angelegt (Datenbank-Änderung ausstehend): ohne sie weiter.
      if (spalten === SPALTEN && /automatisch_erkannt/.test(error.message ?? '')) {
        spalten = SPALTEN.replace(', automatisch_erkannt', '')
        i--
        continue
      }
      return { zeilen, fehler: error.message }
    }
    const seite = (data ?? []) as Record<string, unknown>[]
    zeilen.push(...seite)
    if (seite.length < 500) break
    ab = String(seite[seite.length - 1].id)
  }
  return { zeilen }
}

// deno-lint-ignore no-explicit-any
export async function fuehreVerbindlichkeitenWerkzeugAus(name: string, input: any, k: VerbindlichkeitenKontext): Promise<string> {
  const { supabase, mitarbeiter } = k
  if (name !== 'verbindlichkeiten_pruefen') return `Fehler: unbekanntes Werkzeug ${name}.`
  if (!darfBereich(mitarbeiter, 'beratung')) return nichtFreigegeben('beratung', mitarbeiter.name)
  const mitBezahlten = input?.mit_bezahlten !== false
  const mitHinweisen = input?.mit_hinweisen === true

  const { zeilen, fehler } = await ladeAlle(supabase)
  if (fehler) return `Fehler beim Laden der Verbindlichkeiten: ${fehler}`
  const geprueft = zeilen.filter((v) => mitBezahlten || v.status !== 'bezahlt')
  const treffer: { v: Record<string, unknown>; fehlt: string[]; hinweise: string[] }[] = []
  let zuBestaetigen = 0
  for (const v of geprueft) {
    const erkannt = erkanntAus(v.automatisch_erkannt)
    const luecken = belegLuecken(angabenAusZeile(v), erkannt)
    const fehlt = luecken.filter((l) => l.schwere === 'fehlt').map((l) => l.text)
    const hinweise = luecken.filter((l) => l.schwere === 'hinweis').map((l) => l.text)
    if (v.quelle === 'email-automatisch' && v.geprueft !== true) zuBestaetigen++
    if (fehlt.length || (mitHinweisen && hinweise.length)) treffer.push({ v, fehlt, hinweise })
  }
  if (!geprueft.length) return 'Es sind keine Verbindlichkeiten erfasst.'

  const kopf = `${geprueft.length} Verbindlichkeit${geprueft.length === 1 ? '' : 'en'} geprüft${mitBezahlten ? '' : ' (nur offene)'}: ${
    treffer.filter((t) => t.fehlt.length).length
  } unvollständig, ${zuBestaetigen} automatisch erkannt und noch nicht als „Angaben stimmen“ bestätigt.`
  if (!treffer.length) return `${kopf}\nAlles Wichtige ist vorhanden.`
  treffer.sort((a, b) => b.fehlt.length - a.fehlt.length || String(b.v.datum ?? '').localeCompare(String(a.v.datum ?? '')))
  const zeilenText = treffer.slice(0, 40).map(({ v, fehlt, hinweise }) => {
    const brutto = v.betrag_brutto ?? v.betrag_netto
    const betrag = brutto !== null && brutto !== undefined && brutto !== '' ? `, ${euro(Number(brutto))}` : ''
    const nr = String(v.rechnungsnummer ?? '').trim() ? ` Nr. ${v.rechnungsnummer}` : ''
    const teile = [...(fehlt.length ? [`fehlt: ${fehlt.join('; ')}`] : []), ...(mitHinweisen || !fehlt.length ? hinweise : hinweise.filter((h) => h.startsWith('Automatisch')))]
    return `• ${String(v.lieferant ?? '').trim() || 'ohne Lieferant'}${nr} vom ${datumDe(String(v.datum ?? ''))}${betrag}${v.status === 'bezahlt' ? ' (bezahlt)' : ''} — ${teile.join('; ')} (Verbindlichkeit id=${v.id})`
  })
  const mehr = treffer.length > 40 ? `\n… und ${treffer.length - 40} weitere — im CRM unter Verbindlichkeiten mit dem Filter „Unvollständig“.` : ''
  const fussnote = '\nBelege aus den Original-Mails übernimmt das CRM von selbst. Automatisch ergänzte Angaben bitte im CRM in der Verbindlichkeit prüfen und mit „Angaben stimmen – als geprüft markieren“ bestätigen.'
  return `${kopf}\n${zeilenText.join('\n')}${mehr}${fussnote}`.slice(0, 12000)
}
