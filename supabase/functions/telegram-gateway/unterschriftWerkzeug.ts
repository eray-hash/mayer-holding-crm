// Assistent-Werkzeug zur Online-Unterschrift (22.11.2026; Tabelle unterschrift_anfragen, Oberfläche im CRM:
// „Zum Unterschreiben schicken“ beim Ausfüllen einer Vorlage, Liste „Zum Unterschreiben verschickt“ in der Akte).
// Nur lesen: Anfragen anlegen und zurückziehen bleibt im CRM (dort sieht man den Text vor dem Versand).
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregeln nach:
// eine Anfrage sieht nur, wer die Akte sehen darf (darfAkte: Bereichsrechte, private Akten nur ihr Besitzer).
import { darfAkte, istFremdePrivatakte, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { STATUS_TEXT, type UnterschriftStatus } from '../_shared/unterschriftKern.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type UnterschriftKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const UNTERSCHRIFT_WERKZEUGE = [
  {
    name: 'unterschrift_status',
    description:
      'Zeigt, welche Dokumente (z. B. Beratungsvereinbarung, Vollmacht) zur Online-Unterschrift an Kunden verschickt wurden und wie der Stand ist: wartet, unterschrieben (mit Zeitpunkt und Name), abgelehnt (mit Grund), abgelaufen oder zurückgezogen. Für Fragen wie „Hat Frau X die Vereinbarung schon unterschrieben?“ oder „Welche Unterschriften stehen noch aus?“. Mit kunde_id alle Anfragen dieser Akte, ohne kunde_id alle noch offenen. Verschicken und Zurückziehen geht nur im CRM (beim Ausfüllen der Vorlage „Zum Unterschreiben schicken“); das unterschriebene PDF liegt danach in den Dokumenten der Akte.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Nur die Anfragen dieser Akte (mit kunden_suchen ermitteln).' },
        alle: { type: 'boolean', description: 'Ohne kunde_id: true = auch erledigte der letzten 30 Tage zeigen, nicht nur offene.' },
      },
    },
  },
]

export function istUnterschriftWerkzeug(name: string): boolean {
  return UNTERSCHRIFT_WERKZEUGE.some((w) => w.name === name)
}

type AnfrageZeile = {
  id: string
  kunde_id: string
  bereich: string
  titel: string
  email: string | null
  status: UnterschriftStatus
  gueltig_bis: string
  zugriffe: number | null
  letzter_zugriff: string | null
  unterschrieben_am: string | null
  name_getippt: string | null
  dokument: string | null
  abgelehnt_am: string | null
  ablehnung_grund: string | null
  erstellt_von: string | null
  erstellt_am: string
}

type Akte = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }

const SPALTEN = 'id, kunde_id, bereich, titel, email, status, gueltig_bis, zugriffe, letzter_zugriff, unterschrieben_am, name_getippt, dokument, abgelehnt_am, ablehnung_grund, erstellt_von, erstellt_am'

function deDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

function deZeit(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) + ' Uhr'
}

function akteName(a: Akte | undefined): string {
  if (!a) return 'unbekannte Akte'
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

/** Status, wie ihn der Kunde gerade erlebt: offen mit abgelaufener Frist gilt als abgelaufen. */
export function wirklicherStatus(z: Pick<AnfrageZeile, 'status' | 'gueltig_bis'>, jetzt = new Date()): UnterschriftStatus {
  return z.status === 'offen' && new Date(z.gueltig_bis).getTime() < jetzt.getTime() ? 'abgelaufen' : z.status
}

export function zeileText(z: AnfrageZeile, akte: Akte | undefined, jetzt = new Date()): string {
  const st = wirklicherStatus(z, jetzt)
  const teile = [`„${z.titel}“`, STATUS_TEXT[st] ?? st, `Akte: ${akteName(akte)}`]
  teile.push(`verschickt ${deDatum(z.erstellt_am)}${z.erstellt_von ? ` von ${z.erstellt_von}` : ''}${z.email ? ` an ${z.email}` : ' (nur Link)'}`)
  if (st === 'offen') {
    teile.push(`gültig bis ${deDatum(z.gueltig_bis)}`)
    teile.push(z.zugriffe ? `vom Kunden ${z.zugriffe}× geöffnet, zuletzt ${deZeit(z.letzter_zugriff)}` : 'vom Kunden noch nicht geöffnet')
  }
  if (st === 'unterschrieben') teile.push(`am ${deZeit(z.unterschrieben_am)} als „${z.name_getippt ?? ''}“${z.dokument ? ', PDF in den Dokumenten der Akte' : ', PDF fehlt in der Akte'}`)
  if (st === 'abgelehnt') teile.push(`am ${deZeit(z.abgelehnt_am)}${z.ablehnung_grund ? `, Grund: ${z.ablehnung_grund}` : ', ohne Grund'}`)
  return `- ${teile.join(' | ')} (id=${z.id})`
}

// deno-lint-ignore no-explicit-any
export async function fuehreUnterschriftWerkzeugAus(name: string, input: any, k: UnterschriftKontext): Promise<string> {
  const { supabase, mitarbeiter } = k
  if (name !== 'unterschrift_status') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const kundeId = String(input?.kunde_id ?? '').trim()
  const jetzt = new Date()

  if (kundeId) {
    const { data: akte, error: akteFehler } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (akteFehler) return `Fehler beim Laden der Akte: ${akteFehler.message}`
    const keine = 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    if (!akte) return keine
    if (!darfAkte(mitarbeiter, akte)) return istFremdePrivatakte(mitarbeiter, akte) ? keine : nichtFreigegeben(akte.bereich, mitarbeiter.name)
    const { data, error } = await supabase.from('unterschrift_anfragen').select(SPALTEN).eq('kunde_id', kundeId).order('erstellt_am', { ascending: false }).limit(50)
    if (error) return `Fehler beim Laden: ${error.message}`
    const liste = (data ?? []) as AnfrageZeile[]
    if (!liste.length) return `In der Akte von ${akteName(akte)} wurde noch nichts zur Online-Unterschrift verschickt. Verschicken geht im CRM: Vorlage ausfüllen → „Zum Unterschreiben schicken“.`
    return [`Online-Unterschriften in der Akte von ${akteName(akte)} (${liste.length}, neueste zuerst):`, ...liste.map((z) => zeileText(z, akte, jetzt))].join('\n').slice(0, 12000)
  }

  const seit = new Date(jetzt.getTime() - 30 * 86400000).toISOString()
  let q = supabase.from('unterschrift_anfragen').select(SPALTEN)
  q = input?.alle === true ? q.gte('erstellt_am', seit) : q.eq('status', 'offen')
  const { data, error } = await q.order('erstellt_am', { ascending: false }).limit(500)
  if (error) return `Fehler beim Laden: ${error.message}`
  const roh = (data ?? []) as AnfrageZeile[]
  const ids = [...new Set(roh.map((z) => z.kunde_id))]
  const akten = new Map<string, Akte>()
  if (ids.length) {
    const { data: ak } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', ids)
    for (const a of (ak ?? []) as Akte[]) akten.set(a.id, a)
  }
  // Nur Akten, die der Mitarbeiter sehen darf; Anfragen zu gelöschten Akten fallen weg.
  const liste = roh.filter((z) => {
    const a = akten.get(z.kunde_id)
    return !!a && darfAkte(mitarbeiter, a)
  })
  const offen = input?.alle === true ? liste : liste.filter((z) => wirklicherStatus(z, jetzt) === 'offen')
  const was = input?.alle === true ? 'Online-Unterschriften der letzten 30 Tage' : 'Offene Online-Unterschriften (warten auf den Kunden)'
  if (!offen.length) return `${was}: keine.`
  const max = 40
  return [
    `${was}: ${offen.length}.`,
    ...offen.slice(0, max).map((z) => zeileText(z, akten.get(z.kunde_id), jetzt)),
    offen.length > max ? `… und ${offen.length - max} weitere (mit kunde_id eingrenzen).` : '',
  ].filter(Boolean).join('\n').slice(0, 12000)
}
