// Assistent-Werkzeug „Neuanfrage einstufen“ (Runde 6, 23.11.2026).
//
// Anlass: Alle 69 Akten der Unternehmensberatung standen auf „lead“ (Neuanfrage), und in der Beratung gab es keine
// einzige Wiedervorlage — die Regeln begannen erst bei „erstkontakt“. Seit Runde 6 legt das CRM für jede
// Neuanfrage der Beratung nach 2 Tagen die Wiedervorlage „Neuanfrage prüfen“ an (Regel ber_neuanfrage_pruefen,
// supabase/sql/runde6_klein.sql). Das Team arbeitet fast nur per Telegram und antwortet darauf kurz mit
// „qualifiziert“, „passt nicht“ oder „später“ — dieses Werkzeug macht daraus den Statuswechsel:
//
//   qualifiziert → Erstkontakt hergestellt (erstkontakt)   — das CRM legt dann „Erstgespräch vereinbaren“ an
//   passt nicht  → Nicht qualifiziert (nicht_qualifiziert)
//   später       → Wiedervorlage / zurückgestellt (wiedervorlage) + Wiedervorlage „Zurückgestellte Anfrage
//                  erneut prüfen“ in 14 Tagen (Regel ber_zurueckgestellt; fehlt die Regel noch, legt das
//                  Werkzeug denselben Eintrag von Hand an)
//
// Nur Status aus src/data/statusNetworks.ts (BERATUNG_STATUS: lead → erstkontakt | nicht_qualifiziert | verloren;
// erstkontakt → wiedervorlage). Nur für Akten der Beratung im Stand „lead“ oder „wiedervorlage“ (eine
// zurückgestellte Anfrage wird beim erneuten Prüfen genauso eingestuft). Die offene „Neuanfrage prüfen“ schließt
// der Auslöser der Datenbank beim Statuswechsel selbst; das Werkzeug schließt sie zur Sicherheit zusätzlich.
//
// Rechte wie überall im Assistenten über rechte.ts (der Assistent arbeitet mit vollen Datenbankrechten).
// Geschrieben werden nur status, activities (frisch gelesen) und letzte_aktivitaet.

import { darfAkte, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { deDatum, plusTage } from './wiedervorlageWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type LeadKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export type LeadErgebnis = 'qualifiziert' | 'passt_nicht' | 'spaeter'

/** Ziel-Status je Antwort (nur Status der Beratung, siehe src/data/statusNetworks.ts). */
export const ZIEL_STATUS: Record<LeadErgebnis, string> = {
  qualifiziert: 'erstkontakt',
  passt_nicht: 'nicht_qualifiziert',
  spaeter: 'wiedervorlage',
}

/** Bezeichnungen nach src/data/statusNetworks.ts (BERATUNG_STATUS), ohne englische Wörter. */
const STATUS_TEXT: Record<string, string> = {
  lead: 'Neuanfrage',
  erstkontakt: 'Erstkontakt hergestellt',
  nicht_qualifiziert: 'Nicht qualifiziert',
  wiedervorlage: 'Wiedervorlage (zurückgestellt)',
}

/** Von hier aus darf eingestuft werden. */
const START_STATUS = ['lead', 'wiedervorlage']

export const REGEL_NEUANFRAGE = 'ber_neuanfrage_pruefen'
export const REGEL_ZURUECKGESTELLT = 'ber_zurueckgestellt'
export const TITEL_ZURUECKGESTELLT = 'Zurückgestellte Anfrage erneut prüfen'
export const SPAETER_TAGE = 14

export const LEAD_WERKZEUGE = [
  {
    name: 'lead_einstufen',
    description:
      'Stuft eine Neuanfrage der Unternehmensberatung ein (Akte im Stand „Lead / Neuanfrage“ oder zurückgestellt), meist als Antwort auf die Wiedervorlage „Neuanfrage prüfen“. ' +
      'ergebnis="qualifiziert" (passt, wir kümmern uns) → Stand Erstkontakt, das CRM legt dann „Erstgespräch vereinbaren“ an; ' +
      'ergebnis="passt_nicht" → Stand „Nicht qualifiziert“; ergebnis="spaeter" → Stand „Wiedervorlage“ mit erneuter Prüfung in 14 Tagen (oder nach tage). ' +
      'Nimm das bei kurzen Antworten wie „qualifiziert“, „passt“, „passt nicht“, „kein Interesse für uns“, „später“, „in zwei Wochen nochmal“ zu einer Neuanfrage.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (aus der Wiedervorlage oder mit kunden_suchen).' },
        ergebnis: { type: 'string', enum: ['qualifiziert', 'passt_nicht', 'spaeter'] },
        grund: { type: 'string', description: 'Optional: kurzer Grund in seinen Worten (kommt in den Verlauf der Akte).' },
        tage: { type: 'integer', minimum: 1, maximum: 180, description: 'Nur bei spaeter: in wie vielen Tagen erneut prüfen (Vorgabe 14).' },
      },
      required: ['kunde_id', 'ergebnis'],
    },
  },
]

export function istLeadWerkzeug(name: string): boolean {
  return LEAD_WERKZEUGE.some((w) => w.name === name)
}

/** Antwort in eigenen Worten → Ergebnis (für Werkzeug-Eingaben wie „passt nicht“ oder „später“). */
export function ergebnisAus(roh: unknown): LeadErgebnis | undefined {
  const t = String(roh ?? '').trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[\s-]+/g, '_')
  if (t === 'qualifiziert' || t === 'passt' || t === 'ja') return 'qualifiziert'
  if (t === 'passt_nicht' || t === 'nicht_qualifiziert' || t === 'nein') return 'passt_nicht'
  if (t === 'spaeter' || t === 'zurueckgestellt' || t === 'wiedervorlage') return 'spaeter'
  return undefined
}

type Akte = {
  id: string
  bereich: string | null
  firma: string | null
  ansprechpartner: string | null
  status: string | null
  verantwortlich: string | null
  verantwortlich_email: string | null
  activities: unknown
}

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

// deno-lint-ignore no-explicit-any
export async function fuehreLeadWerkzeugAus(name: string, input: any, k: LeadKontext): Promise<string> {
  if (name !== 'lead_einstufen') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const kundeId = String(input?.kunde_id ?? '').trim()
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen oder aus der Wiedervorlage.'
  const ergebnis = ergebnisAus(input?.ergebnis)
  if (!ergebnis) return 'Fehler: ergebnis muss "qualifiziert", "passt_nicht" oder "spaeter" sein.'
  const tageRoh = Number(input?.tage)
  const tage = ergebnis === 'spaeter' && Number.isFinite(tageRoh) && tageRoh >= 1 ? Math.min(180, Math.round(tageRoh)) : SPAETER_TAGE
  const grund = String(input?.grund ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)

  const SPALTEN = 'id, bereich, firma, ansprechpartner, status, verantwortlich, verantwortlich_email, activities'
  const { data: akte, error } = await supabase.from('kunden').select(SPALTEN).eq('id', kundeId).maybeSingle()
  if (error) return `Fehler beim Laden der Akte: ${error.message}`
  if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
  if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
  if (istPrivat(akte) || akte.bereich !== 'beratung') {
    return `Fehler: Einstufen gibt es nur für Neuanfragen der Unternehmensberatung. Diese Akte liegt in einem anderen Bereich — ändere den Stand dort mit kunde_aendern (status).`
  }
  const status = String(akte.status ?? '')
  const ziel = ZIEL_STATUS[ergebnis]
  if (!START_STATUS.includes(status)) {
    return `Nicht geändert: Die Akte ${akteName(akte)} steht schon auf „${STATUS_TEXT[status] ?? status}“ und ist keine offene Neuanfrage mehr. Soll der Stand trotzdem geändert werden, nimm kunde_aendern.`
  }
  if (status === ziel && ergebnis !== 'spaeter') return `Die Akte ${akteName(akte)} steht schon auf „${STATUS_TEXT[ziel]}“.`

  const erklaerung = { qualifiziert: 'qualifiziert', passt_nicht: 'passt nicht zu uns', spaeter: `zurückgestellt, erneut prüfen in ${tage} Tagen` }[ergebnis]
  const eintrag = {
    id: crypto.randomUUID(),
    date: heute,
    text: `Neuanfrage per Telegram eingestuft: ${erklaerung}${grund ? ` — ${grund}` : ''}. Stand: ${STATUS_TEXT[ziel]}`,
    user: mitarbeiter.name,
  }
  const patch: Record<string, unknown> = {
    activities: [eintrag, ...(Array.isArray(akte.activities) ? akte.activities : [])],
    letzte_aktivitaet: heute,
  }
  if (status !== ziel) patch.status = ziel
  const { error: speicherFehler } = await supabase.from('kunden').update(patch).eq('id', akte.id)
  if (speicherFehler) return `Fehler beim Speichern: ${speicherFehler.message}. Nichts wurde geändert.`

  // Die offene „Neuanfrage prüfen“ schließt der Auslöser beim Statuswechsel; zur Sicherheit auch hier.
  await supabase
    .from('wiedervorlagen')
    .update({ erledigt_am: new Date().toISOString(), erledigt_von: mitarbeiter.name, erledigt_grund: `Eingestuft: ${erklaerung}` })
    .eq('kunde_id', akte.id)
    .eq('regel', REGEL_NEUANFRAGE)
    .is('erledigt_am', null)

  let wvText = ''
  if (ergebnis === 'spaeter') {
    const faellig = plusTage(heute, tage)
    // Legt die Regel ber_zurueckgestellt den Eintrag an (Auslöser), nur das Datum anpassen; sonst von Hand anlegen.
    const { data: offen } = await supabase.from('wiedervorlagen').select('id, regel, faellig').eq('kunde_id', akte.id).is('erledigt_am', null)
    const vorhanden = ((offen ?? []) as { id: string; regel: string | null; faellig: string }[]).find((w) => w.regel === REGEL_ZURUECKGESTELLT)
    if (vorhanden) {
      if (String(vorhanden.faellig).slice(0, 10) !== faellig) await supabase.from('wiedervorlagen').update({ faellig }).eq('id', vorhanden.id)
    } else {
      const { error: wvFehler } = await supabase.from('wiedervorlagen').insert({
        kunde_id: akte.id,
        bereich: akte.bereich,
        titel: TITEL_ZURUECKGESTELLT,
        faellig,
        notiz: grund || null,
        verantwortlich: String(akte.verantwortlich ?? '').trim() || null,
        quelle: 'hand',
        erstellt_von: mitarbeiter.name,
      })
      if (wvFehler) return `Stand auf „${STATUS_TEXT[ziel]}“ gesetzt, aber die Wiedervorlage ließ sich nicht anlegen (${wvFehler.message}). Leg sie mit wiedervorlage_anlegen an.`
    }
    wvText = ` Wiedervorlage „${TITEL_ZURUECKGESTELLT}“ am ${deDatum(faellig)}.`
  } else if (ergebnis === 'qualifiziert') {
    const { data: neu } = await supabase.from('wiedervorlagen').select('titel, faellig').eq('kunde_id', akte.id).is('erledigt_am', null).order('faellig', { ascending: true })
    const liste = ((neu ?? []) as { titel: string; faellig: string }[]).map((w) => `„${w.titel}“ am ${deDatum(String(w.faellig).slice(0, 10))}`)
    if (liste.length) wvText = ` Offene Wiedervorlage(n): ${liste.slice(0, 3).join(', ')}.`
  }

  protokolliere(`Neuanfrage ${akteName(akte)} eingestuft: ${erklaerung} (Stand ${STATUS_TEXT[ziel]})`)
  return `Erledigt: ${akteName(akte)} — ${erklaerung}. Stand jetzt „${STATUS_TEXT[ziel]}“.${wvText} (kunde_id=${akte.id})`
}
