// Assistent-Werkzeuge für Besichtigungen von Objekten (Tabelle besichtigungen, 21.11.2026;
// Oberfläche: Reiter „Besichtigungen“ der Objektakte, src/components/ObjektBesichtigungenSection.tsx,
// Datenformen in src/lib/besichtigungen.ts).
//
// Eine Besichtigung gehört zu einem Objekt, nennt den Interessenten (frei oder als Kontakt aus den
// Immobilien-Kontakten, kunde_bereich 'immobilienkunden') und hat einen Stand: geplant, durchgefuehrt,
// abgesagt, nicht_erschienen. Nach dem Termin kommen Interesse, Rückmeldung, Kaufpreisangebot und
// nächster Schritt dazu. Jede wichtige Änderung steht wie im CRM im Verlauf des Objekts und, falls
// verknüpft, des Kontakts.
//
// Automatische Nachrichten: Auslöser in der Datenbank (an_besichtigungen_ausloeser →
// auto_nachricht_vormerken) merken bei neuem/geändertem Stand Nachrichten an den Interessenten vor.
// Deshalb schreibt diese Datei genau wie das CRM: neue Besichtigung per insert (das CRM nutzt upsert,
// beim neuen Datensatz ist das dasselbe INSERT), Änderungen per update auf derselben Zeile. Nichts
// wird an den Regeln vorbei verschickt oder vorgemerkt.
//
// Kalender: Das CRM trägt Besichtigungen auf Wunsch über die Mail-Funktion (termin_speichern) in den
// eigenen Kalender ein. Das macht diese Datei nicht selbst; der Assistent nimmt dafür termin_anlegen /
// termin_aendern / termin_absagen und verknüpft den Termin über termin_id.
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten. Zeilenregel besichtigungen:
// darf_bereich('immobilien'); dazu muss das Objekt selbst sichtbar sein (Zeilenregel objekte:
// private Objekte nur für ihren Besitzer) → darfObjekte(m) && darfObjekt(m, objekt). Löschen gibt es hier nicht.

import { darfAkte, darfObjekt, darfObjekte, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type BesichtigungKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Nur für Tests: feste Uhrzeit. */
  jetzt?: () => Date
}

export const STATUS = [
  { id: 'geplant', label: 'Geplant' },
  { id: 'durchgefuehrt', label: 'Durchgeführt' },
  { id: 'abgesagt', label: 'Abgesagt' },
  { id: 'nicht_erschienen', label: 'Nicht erschienen' },
] as const

export const INTERESSE = [
  { id: 'hoch', label: 'Großes Interesse' },
  { id: 'mittel', label: 'Mittleres Interesse' },
  { id: 'gering', label: 'Wenig Interesse' },
  { id: 'kein', label: 'Kein Interesse' },
] as const

export const statusLabel = (s: string) => STATUS.find((x) => x.id === s)?.label ?? s
export const interesseLabel = (i?: string | null) => (i ? INTERESSE.find((x) => x.id === i)?.label ?? i : '')

export type BesichtigungZeile = {
  id: string
  objekt_id: string
  kunde_id: string | null
  kunde_bereich: string | null
  interessent: string
  telefon: string
  email: string
  beginn: string
  dauer_min: number
  durchgefuehrt_von: string
  status: string
  interesse: string | null
  rueckmeldung: string
  angebot: number | string | null
  naechster_schritt: string
  kalender_termin_id: string | null
  erstellt_von: string
  erstellt_am?: string
  geaendert_am?: string
}

type ObjektZeile = { id: string; bezeichnung: string | null; adresse: string | null; privat_besitzer: string | null; activities?: unknown[] | null }

/** Darf der Mitarbeiter die Besichtigungen dieses Objekts sehen und ändern? Wie die Zeilenregeln besichtigungen + objekte. */
export function darfBesichtigungen(m: RechteMitarbeiter, objekt: { privat_besitzer?: string | null }): boolean {
  return darfObjekte(m) && darfObjekt(m, objekt)
}

/** Fehlertext für ein Objekt, dessen Besichtigungen der Mitarbeiter nicht sehen darf — oder null. */
function objektSperre(m: RechteMitarbeiter & { name: string }, objekt: ObjektZeile | null | undefined): string | null {
  if (!objekt || istUnsichtbaresObjekt(m, objekt)) return 'Fehler: Dieses Objekt gibt es nicht. Ermittle die objekt_id mit objekte_suchen.'
  if (!darfBesichtigungen(m, objekt)) return nichtFreigegeben('immobilien', m.name)
  return null
}

// ---------------------------------------------------------------------------------------------
// Zeit (deutsche Ortszeit)

/** "JJJJ-MM-TTTHH:MM" (oder mit Leerzeichen) in deutscher Ortszeit → Zeitpunkt; ohne Uhrzeit null. */
export function berlinZuZeitpunkt(lokal: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(lokal ?? '').trim())
  if (!m) return null
  const alsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  const probe = new Date(alsUtc)
  if (probe.getUTCMonth() !== +m[2] - 1 || probe.getUTCDate() !== +m[3] || +m[4] > 23 || +m[5] > 59) return null
  const teile = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(probe)
  const wert = (art: string) => Number(teile.find((t) => t.type === art)?.value ?? 0)
  const berlinAlsUtc = Date.UTC(wert('year'), wert('month') - 1, wert('day'), wert('hour') % 24, wert('minute'))
  return new Date(alsUtc - (berlinAlsUtc - alsUtc))
}

/** „Sa., 21.11.2026, 14:30 Uhr“ in deutscher Zeit — wie zeitText in src/lib/besichtigungen.ts. */
export function zeitText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const tag = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' })
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
  return `${tag}, ${uhr} Uhr`
}

function euro(n: unknown): string {
  const z = Number(n)
  return Number.isFinite(z) ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(z)} €` : ''
}

/** Kennung wie uid() im CRM: prefix_ + 7 Zufallszeichen + 4 Zeichen Zeit. */
export function neueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

// ---------------------------------------------------------------------------------------------
// Verlauf — wie verlaufText in ObjektBesichtigungenSection.tsx

type BesichtigungFuerVerlauf = Pick<BesichtigungZeile, 'interessent' | 'beginn' | 'status' | 'interesse' | 'angebot'>

/** Was sich Erwähnenswertes geändert hat, als ein Satz für den Verlauf — leer, wenn nichts. */
export function besichtigungVerlaufText(vorher: BesichtigungFuerVerlauf | undefined, b: BesichtigungFuerVerlauf): string {
  const teile: string[] = []
  const angebot = b.angebot === null || b.angebot === undefined ? undefined : Number(b.angebot)
  const angebotVorher = vorher?.angebot === null || vorher?.angebot === undefined ? undefined : Number(vorher.angebot)
  if (!vorher) teile.push(`Besichtigung mit ${b.interessent} für ${zeitText(b.beginn)} eingetragen`)
  else if (new Date(vorher.beginn).getTime() !== new Date(b.beginn).getTime() && b.status === 'geplant') teile.push(`Besichtigung mit ${b.interessent} verschoben auf ${zeitText(b.beginn)}`)
  if (vorher && vorher.status !== b.status && b.status !== 'geplant') teile.push(`Besichtigung mit ${b.interessent}: ${statusLabel(b.status)}`)
  if (!vorher && b.status !== 'geplant') teile.push(statusLabel(b.status))
  if (b.interesse && b.interesse !== vorher?.interesse) teile.push(interesseLabel(b.interesse))
  if (angebot && angebot !== angebotVorher) teile.push(`Kaufpreisangebot ${euro(angebot)}`)
  return teile.join(' · ')
}

/** Eintrag im Verlauf des Objekts und — falls verknüpft und ein Immobilien-Kontakt — des Kontakts (frisch gelesen, vorne angefügt). */
async function verlaufEintragen(supabase: Supa, objekt: ObjektZeile, kundeId: string | null, text: string, wer: string, heute: string): Promise<void> {
  const { data: o } = await supabase.from('objekte').select('id, activities').eq('id', objekt.id).maybeSingle()
  if (o) {
    const eintrag = { id: neueId('act'), date: heute, text, user: wer }
    await supabase.from('objekte').update({ activities: [eintrag, ...(Array.isArray(o.activities) ? o.activities : [])] }).eq('id', objekt.id)
  }
  if (kundeId) {
    const { data: k } = await supabase.from('kunden').select('id, bereich, activities').eq('id', kundeId).maybeSingle()
    if (k && k.bereich === 'immobilienkunden') {
      const eintrag = { id: neueId('act'), date: heute, text: `${text} (Objekt: ${objekt.bezeichnung ?? objekt.id})`, user: wer }
      await supabase.from('kunden').update({ activities: [eintrag, ...(Array.isArray(k.activities) ? k.activities : [])], letzte_aktivitaet: heute }).eq('id', kundeId)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Werkzeuge

const STATUS_IDS = STATUS.map((s) => s.id)
const INTERESSE_IDS = INTERESSE.map((s) => s.id)

export const BESICHTIGUNG_WERKZEUGE = [
  {
    name: 'besichtigungen_zeigen',
    description:
      'Zeigt Besichtigungen von Immobilien-Objekten: mit objekt_id alle Besichtigungen dieses Objekts (anstehende zuerst, dann die bisherigen mit Rückmeldung, Interesse und Kaufpreisangebot); ohne objekt_id die anstehenden geplanten Besichtigungen aller Objekte der nächsten Tage. Für „Welche Besichtigungen stehen an?“, „Wie war die Besichtigung bei Objekt X?“. Liefert die IDs für besichtigung_aendern.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Das Objekt (mit objekte_suchen ermitteln).' },
        tage: { type: 'integer', minimum: 1, maximum: 120, description: 'Ohne objekt_id: wie viele Tage vorausschauen (Vorgabe 14).' },
      },
    },
  },
  {
    name: 'besichtigung_anlegen',
    description:
      'Trägt eine Besichtigung für ein Objekt ein (Stand „geplant“). Interessent entweder als Kontakt aus den Immobilien-Kontakten (kunde_id, dann kommen Name, Telefon und E-Mail aus dem Kontakt) oder frei mit Name und Telefon/E-Mail. Achtung: Das CRM kann daraufhin automatisch eine Bestätigung und eine Erinnerung an den Interessenten vormerken, wenn diese Regeln eingeschaltet sind. Ein Kalendertermin entsteht dabei nicht — dafür vorher termin_anlegen und dessen termin_id mitgeben.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string' },
        beginn: { type: 'string', description: 'Datum und Uhrzeit in deutscher Zeit, Form JJJJ-MM-TTTHH:MM, z. B. 2026-11-28T14:30.' },
        dauer_min: { type: 'integer', minimum: 15, maximum: 240, description: 'Dauer in Minuten (Vorgabe 30).' },
        kunde_id: { type: 'string', description: 'Interessent aus den Immobilien-Kontakten (mit kunden_suchen ermitteln).' },
        interessent: { type: 'string', description: 'Name des Interessenten, wenn er kein Kontakt im CRM ist, z. B. "Familie Müller".' },
        telefon: { type: 'string' },
        email: { type: 'string' },
        durchgefuehrt_von: { type: 'string', description: 'Wer die Besichtigung macht (Vorgabe: der Fragende).' },
        naechster_schritt: { type: 'string', description: 'Nächster Schritt oder kurze Notiz zum Termin (das CRM hat dafür nur dieses Feld).' },
        termin_id: { type: 'string', description: 'Optional: Kalendertermin aus termin_anlegen, der zu dieser Besichtigung gehört.' },
      },
      required: ['objekt_id', 'beginn'],
    },
  },
  {
    name: 'besichtigung_aendern',
    description:
      'Ändert eine Besichtigung: verschieben (beginn), absagen (status "abgesagt"), als durchgeführt vermerken (status "durchgefuehrt") oder „nicht_erschienen“, dazu nach dem Termin Interesse, Rückmeldung des Interessenten, Kaufpreisangebot und nächsten Schritt. Nur die genannten Felder ändern sich. Achtung: Bei Absage, Durchführung, Verschieben oder einem Angebot kann das CRM automatisch Nachrichten an den Interessenten vormerken, wenn diese Regeln eingeschaltet sind. Steht die Besichtigung im Kalender, sagt das Ergebnis, ob der Termin mit termin_aendern oder termin_absagen nachgezogen werden muss.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID der Besichtigung (aus besichtigungen_zeigen, beginnt mit bes_).' },
        beginn: { type: 'string', description: 'Neuer Zeitpunkt JJJJ-MM-TTTHH:MM (deutsche Zeit).' },
        dauer_min: { type: 'integer', minimum: 15, maximum: 240 },
        status: { type: 'string', enum: STATUS_IDS, description: 'geplant, durchgefuehrt, abgesagt oder nicht_erschienen.' },
        interesse: { type: 'string', enum: [...INTERESSE_IDS, ''], description: 'hoch, mittel, gering, kein; leer = noch offen.' },
        rueckmeldung: { type: 'string', description: 'Rückmeldung des Interessenten — ersetzt die bisherige. Zum Ergänzen den bisherigen Text (aus besichtigungen_zeigen) mitgeben.' },
        angebot: { type: 'number', description: 'Kaufpreisangebot in Euro; 0 = Angebot entfernen.' },
        naechster_schritt: { type: 'string' },
        durchgefuehrt_von: { type: 'string' },
        interessent: { type: 'string' },
        telefon: { type: 'string' },
        email: { type: 'string' },
        termin_id: { type: 'string', description: 'Kalendertermin verknüpfen (aus termin_anlegen); leer = Verknüpfung lösen.' },
      },
      required: ['id'],
    },
  },
]

export function istBesichtigungWerkzeug(name: string): boolean {
  return BESICHTIGUNG_WERKZEUGE.some((w) => w.name === name)
}

const OBJEKT_SPALTEN = 'id, bezeichnung, adresse, privat_besitzer'

function zeileText(b: BesichtigungZeile, objekte?: Map<string, ObjektZeile>): string {
  const teile = [zeitText(b.beginn), statusLabel(b.status)]
  if (objekte) {
    const o = objekte.get(b.objekt_id)
    teile.push(`Objekt: ${o?.bezeichnung ?? b.objekt_id}${o?.adresse ? `, ${o.adresse}` : ''}`)
  }
  teile.push(`Interessent: ${b.interessent}${b.kunde_id ? ' (Kontakt im CRM)' : ''}`)
  const kontakt = [b.telefon, b.email].filter(Boolean).join(', ')
  if (kontakt) teile.push(kontakt)
  if (b.durchgefuehrt_von) teile.push(`durch: ${b.durchgefuehrt_von}`)
  if (b.interesse) teile.push(interesseLabel(b.interesse))
  if (b.angebot !== null && b.angebot !== undefined && Number(b.angebot) > 0) teile.push(`Angebot: ${euro(b.angebot)}`)
  if (b.rueckmeldung) teile.push(`Rückmeldung: ${b.rueckmeldung.slice(0, 300)}`)
  if (b.naechster_schritt) teile.push(`Nächster Schritt: ${b.naechster_schritt.slice(0, 200)}`)
  if (b.kalender_termin_id) teile.push(`im Kalender (termin_id=${b.kalender_termin_id})`)
  return `- ${teile.join(' | ')} (id=${b.id})`
}

async function ladeObjekt(supabase: Supa, id: string): Promise<ObjektZeile | null> {
  if (!id) return null
  const { data } = await supabase.from('objekte').select(OBJEKT_SPALTEN).eq('id', id).maybeSingle()
  return (data as ObjektZeile) ?? null
}

/** Kalendertermin prüfen: muss es geben und dem Fragenden gehören (das CRM trägt in den eigenen Kalender ein). */
async function pruefeTermin(supabase: Supa, m: RechteMitarbeiter, terminId: string): Promise<string | null> {
  const { data } = await supabase.from('termine').select('id, besitzer_email').eq('id', terminId).maybeSingle()
  if (!data) return 'Fehler: Diesen Kalendertermin gibt es nicht. Ermittle die termin_id mit termine_zeigen.'
  if (String(data.besitzer_email ?? '').trim().toLowerCase() !== String(m.email ?? '').trim().toLowerCase()) return 'Fehler: Verknüpfen lässt sich nur ein Termin aus dem eigenen Kalender.'
  return null
}

function text(v: unknown): string {
  return String(v ?? '').trim()
}

// deno-lint-ignore no-explicit-any
export async function fuehreBesichtigungWerkzeugAus(name: string, input: any, k: BesichtigungKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const jetzt = k.jetzt ? k.jetzt() : new Date()

  if (name === 'besichtigungen_zeigen') {
    const objektId = text(input?.objekt_id)
    if (objektId) {
      const objekt = await ladeObjekt(supabase, objektId)
      const sperre = objektSperre(mitarbeiter, objekt)
      if (sperre) return sperre
      const { data, error } = await supabase.from('besichtigungen').select('*').eq('objekt_id', objektId).order('beginn', { ascending: false }).limit(200)
      if (error) return `Fehler beim Laden: ${error.message}`
      const liste = (data ?? []) as BesichtigungZeile[]
      const kopf = `Besichtigungen für ${objekt!.bezeichnung ?? objektId}${objekt!.adresse ? ` (${objekt!.adresse})` : ''}`
      if (!liste.length) return `${kopf}: noch keine eingetragen.`
      // Wie im CRM: anstehend (geplant, ab einer Stunde vor jetzt) zuerst, nächste zuerst; dann alles andere, neueste zuerst.
      const grenze = jetzt.getTime() - 3600000
      const kommend = liste.filter((b) => b.status === 'geplant' && new Date(b.beginn).getTime() >= grenze).sort((a, b) => a.beginn.localeCompare(b.beginn))
      const rest = liste.filter((b) => !kommend.includes(b))
      const angebote = liste.map((b) => Number(b.angebot)).filter((n) => Number.isFinite(n) && n > 0)
      const zusammen = [
        `${kommend.length} anstehend`,
        `${liste.filter((b) => b.status === 'durchgefuehrt').length} durchgeführt`,
        angebote.length ? `${angebote.length} Angebot(e), höchstes ${euro(Math.max(...angebote))}` : 'kein Angebot',
      ].join(', ')
      return [
        `${kopf}: ${liste.length} (${zusammen}).`,
        kommend.length ? 'Anstehend:' : '',
        ...kommend.map((b) => zeileText(b)),
        rest.length ? 'Bisher:' : '',
        ...rest.slice(0, 40).map((b) => zeileText(b)),
        rest.length > 40 ? `… und ${rest.length - 40} ältere (im CRM ansehen).` : '',
      ].filter(Boolean).join('\n').slice(0, 16000)
    }

    if (!darfObjekte(mitarbeiter)) return nichtFreigegeben('immobilien', mitarbeiter.name)
    const tageRoh = Number(input?.tage)
    const tage = Number.isFinite(tageRoh) && tageRoh > 0 ? Math.min(120, Math.round(tageRoh)) : 14
    const von = new Date(jetzt.getTime() - 3600000).toISOString()
    const bis = new Date(jetzt.getTime() + tage * 86400000).toISOString()
    const { data, error } = await supabase.from('besichtigungen').select('*').eq('status', 'geplant').gte('beginn', von).lte('beginn', bis).order('beginn', { ascending: true }).limit(500)
    if (error) return `Fehler beim Laden: ${error.message}`
    const roh = (data ?? []) as BesichtigungZeile[]
    const ids = [...new Set(roh.map((b) => b.objekt_id))]
    const objekte = new Map<string, ObjektZeile>()
    if (ids.length) {
      const { data: o } = await supabase.from('objekte').select(OBJEKT_SPALTEN).in('id', ids)
      for (const z of (o ?? []) as ObjektZeile[]) objekte.set(z.id, z)
    }
    // Erst nach Rechten filtern: Besichtigungen nicht sichtbarer Objekte tauchen weder auf noch zählen sie mit.
    const liste = roh.filter((b) => {
      const o = objekte.get(b.objekt_id)
      return !!o && darfBesichtigungen(mitarbeiter, o)
    })
    const kopf = `Anstehende Besichtigungen in den nächsten ${tage} Tagen`
    if (!liste.length) return `${kopf}: keine.`
    return [`${kopf}: ${liste.length}.`, ...liste.slice(0, 80).map((b) => zeileText(b, objekte)), liste.length > 80 ? `… und ${liste.length - 80} weitere.` : '']
      .filter(Boolean).join('\n').slice(0, 16000)
  }

  if (name === 'besichtigung_anlegen') {
    const objektId = text(input?.objekt_id)
    if (!objektId) return 'Fehler: objekt_id fehlt. Ermittle sie mit objekte_suchen.'
    const objekt = await ladeObjekt(supabase, objektId)
    const sperre = objektSperre(mitarbeiter, objekt)
    if (sperre) return sperre
    const beginn = berlinZuZeitpunkt(text(input?.beginn))
    if (!beginn) return 'Fehler: beginn muss Datum und Uhrzeit haben, Form JJJJ-MM-TTTHH:MM (deutsche Zeit).'
    const dauerRoh = Number(input?.dauer_min)
    const dauer = Number.isFinite(dauerRoh) && dauerRoh > 0 ? Math.max(15, Math.min(240, Math.round(dauerRoh))) : 30

    let interessent = text(input?.interessent)
    let telefon = text(input?.telefon)
    let email = text(input?.email)
    let kundeId: string | null = null
    const kundeAngabe = text(input?.kunde_id)
    if (kundeAngabe) {
      const { data: kunde } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, email, telefon, verantwortlich_email').eq('id', kundeAngabe).maybeSingle()
      if (!kunde || !darfAkte(mitarbeiter, kunde)) return 'Fehler: Diesen Kontakt gibt es für dich nicht. Ermittle die kunde_id mit kunden_suchen oder gib den Interessenten frei mit Namen an.'
      if (kunde.bereich !== 'immobilienkunden') return 'Fehler: Verknüpfen lassen sich nur Kontakte aus den Immobilien-Kontakten. Gib den Interessenten sonst frei mit Namen an.'
      // Wie kontaktWaehlen im CRM: Name aus dem Kontakt, Telefon/E-Mail nur, wenn nicht angegeben.
      kundeId = kunde.id
      interessent = String(kunde.firma ?? '').trim() || String(kunde.ansprechpartner ?? '').trim() || interessent
      telefon = telefon || String(kunde.telefon ?? '').trim()
      email = email || String(kunde.email ?? '').trim()
    }
    if (!interessent) return 'Fehler: Bitte den Interessenten angeben (interessent oder kunde_id).'
    const terminId = text(input?.termin_id)
    if (terminId) {
      const f = await pruefeTermin(supabase, mitarbeiter, terminId)
      if (f) return f
    }
    // Doppelt eingetragen? Gleiches Objekt, gleicher Zeitpunkt, gleicher Interessent.
    const { data: gleiche } = await supabase.from('besichtigungen').select('id, interessent, beginn, status').eq('objekt_id', objektId).eq('beginn', beginn.toISOString())
    const doppelt = ((gleiche ?? []) as BesichtigungZeile[]).find((b) => b.interessent.trim().toLowerCase() === interessent.toLowerCase() && b.status !== 'abgesagt')
    if (doppelt) return `Nicht angelegt: Diese Besichtigung mit ${doppelt.interessent} am ${zeitText(doppelt.beginn)} steht schon drin (id=${doppelt.id}).`

    const durch = text(input?.durchgefuehrt_von)
    // Genau die Spalten wie zuZeile() in src/lib/besichtigungen.ts.
    const zeile: BesichtigungZeile & { geaendert_am: string } = {
      id: neueId('bes'),
      objekt_id: objektId,
      kunde_id: kundeId,
      kunde_bereich: kundeId ? 'immobilienkunden' : null,
      interessent,
      telefon,
      email,
      beginn: beginn.toISOString(),
      dauer_min: dauer,
      durchgefuehrt_von: !durch || /^(ich|mir|mich|selbst)$/i.test(durch) ? mitarbeiter.name : durch,
      status: 'geplant',
      interesse: null,
      rueckmeldung: '',
      angebot: null,
      naechster_schritt: text(input?.naechster_schritt),
      kalender_termin_id: terminId || null,
      erstellt_von: mitarbeiter.name,
      geaendert_am: jetzt.toISOString(),
    }
    const { error } = await supabase.from('besichtigungen').insert(zeile)
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    const verlauf = besichtigungVerlaufText(undefined, zeile)
    await verlaufEintragen(supabase, objekt!, kundeId, verlauf, mitarbeiter.name, heute)
    protokolliere(`Besichtigung für ${objekt!.bezeichnung ?? objektId} mit ${interessent} am ${zeitText(zeile.beginn)} eingetragen`)
    const hinweise = [
      beginn.getTime() < jetzt.getTime() ? 'Achtung: Der Zeitpunkt liegt in der Vergangenheit.' : '',
      terminId ? 'Mit dem Kalendertermin verknüpft.' : 'Nicht im Kalender — auf Wunsch mit termin_anlegen eintragen und danach mit besichtigung_aendern (termin_id) verknüpfen.',
      !telefon && !email ? 'Telefon und E-Mail des Interessenten fehlen noch.' : '',
    ].filter(Boolean)
    return `Eingetragen: Besichtigung ${objekt!.bezeichnung ?? objektId} mit ${interessent}, ${zeitText(zeile.beginn)} (${dauer} Minuten), durch ${zeile.durchgefuehrt_von}. ${hinweise.join(' ')} id=${zeile.id}`
  }

  if (name === 'besichtigung_aendern') {
    const id = text(input?.id)
    if (!id) return 'Fehler: id fehlt. Ermittle sie mit besichtigungen_zeigen.'
    const { data: alt, error: ladeFehler } = await supabase.from('besichtigungen').select('*').eq('id', id).maybeSingle()
    if (ladeFehler) return `Fehler beim Laden: ${ladeFehler.message}`
    if (!alt) return 'Fehler: Diese Besichtigung gibt es nicht. Ermittle die id mit besichtigungen_zeigen.'
    const vorher = alt as BesichtigungZeile
    const objekt = await ladeObjekt(supabase, vorher.objekt_id)
    const sperre = objektSperre(mitarbeiter, objekt)
    if (sperre) return sperre.replace('Dieses Objekt gibt es nicht. Ermittle die objekt_id mit objekte_suchen.', 'Diese Besichtigung gibt es nicht.')

    const neu: Record<string, unknown> = {}
    const setze = (spalte: keyof BesichtigungZeile, wert: unknown) => {
      const v = vorher[spalte]
      const gleich = spalte === 'beginn' ? new Date(String(v)).getTime() === new Date(String(wert)).getTime() : spalte === 'angebot' ? (v === null ? null : Number(v)) === wert : (v ?? null) === wert
      if (!gleich) neu[spalte] = wert
    }
    if (input?.beginn !== undefined && text(input.beginn)) {
      const b = berlinZuZeitpunkt(text(input.beginn))
      if (!b) return 'Fehler: beginn muss Datum und Uhrzeit haben, Form JJJJ-MM-TTTHH:MM (deutsche Zeit).'
      setze('beginn', b.toISOString())
    }
    if (input?.dauer_min !== undefined) {
      const d = Number(input.dauer_min)
      if (!Number.isFinite(d) || d <= 0) return 'Fehler: dauer_min ist keine gültige Zahl.'
      setze('dauer_min', Math.max(15, Math.min(240, Math.round(d))))
    }
    if (input?.status !== undefined && text(input.status)) {
      const s = text(input.status)
      if (!(STATUS_IDS as readonly string[]).includes(s)) return `Fehler: Ungültiger Stand „${s}“. Möglich: ${STATUS_IDS.join(', ')}.`
      setze('status', s)
    }
    if (input?.interesse !== undefined) {
      const i = text(input.interesse)
      if (i && !(INTERESSE_IDS as readonly string[]).includes(i)) return `Fehler: Ungültiges Interesse „${i}“. Möglich: ${INTERESSE_IDS.join(', ')}.`
      setze('interesse', i || null)
    }
    if (input?.angebot !== undefined) {
      const a = input.angebot === null || input.angebot === '' ? 0 : Number(input.angebot)
      if (!Number.isFinite(a) || a < 0) return 'Fehler: angebot ist kein gültiger Betrag.'
      // Wie im CRM: 0 oder leer = kein Angebot.
      setze('angebot', a > 0 ? Math.round(a * 100) / 100 : null)
    }
    for (const f of ['rueckmeldung', 'naechster_schritt', 'durchgefuehrt_von', 'telefon', 'email'] as const) {
      if (input?.[f] !== undefined) setze(f, text(input[f]))
    }
    if (input?.interessent !== undefined) {
      const n = text(input.interessent)
      if (!n) return 'Fehler: Der Name des Interessenten darf nicht leer sein.'
      setze('interessent', n)
    }
    if (input?.termin_id !== undefined) {
      const t = text(input.termin_id)
      if (t) {
        const f = await pruefeTermin(supabase, mitarbeiter, t)
        if (f) return f
      }
      setze('kalender_termin_id', t || null)
    }

    const hinweise: string[] = []
    const status = (neu.status as string | undefined) ?? vorher.status
    const terminVorher = vorher.kalender_termin_id
    // Wie im CRM: Bei Absage oder Nichterscheinen fliegt der Kalendertermin raus — hier entfernt der
    // Assistent ihn selbst mit termin_absagen; die Verknüpfung wird gelöst.
    if ((status === 'abgesagt' || status === 'nicht_erschienen') && terminVorher && neu.kalender_termin_id === undefined && neu.status !== undefined) {
      neu.kalender_termin_id = null
      hinweise.push(`Der Kalendertermin (termin_id=${terminVorher}) steht noch im Kalender — mit termin_absagen entfernen.`)
    } else if (status === 'geplant' && terminVorher && (neu.beginn !== undefined || neu.dauer_min !== undefined || neu.interessent !== undefined) && neu.kalender_termin_id === undefined) {
      hinweise.push(`Der Kalendertermin (termin_id=${terminVorher}) hat noch die alte Zeit bzw. den alten Namen — mit termin_aendern nachziehen.`)
    }
    if (!Object.keys(neu).length) return `Nichts geändert: Die Besichtigung mit ${vorher.interessent} (${zeitText(vorher.beginn)}) hat diese Angaben schon.`
    if (neu.beginn !== undefined && status === 'geplant' && new Date(String(neu.beginn)).getTime() < jetzt.getTime()) hinweise.push('Achtung: Der neue Zeitpunkt liegt in der Vergangenheit.')

    // Nur die geänderten Spalten, dazu geaendert_am — dieselbe Zeile wie im CRM, damit die Auslöser gleich reagieren.
    const { error } = await supabase.from('besichtigungen').update({ ...neu, geaendert_am: jetzt.toISOString() }).eq('id', vorher.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    const nachher = { ...vorher, ...neu } as BesichtigungZeile
    const verlauf = besichtigungVerlaufText(vorher, nachher)
    if (verlauf) await verlaufEintragen(supabase, objekt!, nachher.kunde_id, verlauf, mitarbeiter.name, heute)
    const NAMEN: Record<string, string> = {
      beginn: 'Zeit', dauer_min: 'Dauer', status: 'Stand', interesse: 'Interesse', angebot: 'Angebot', rueckmeldung: 'Rückmeldung',
      naechster_schritt: 'Nächster Schritt', durchgefuehrt_von: 'Durchgeführt von', telefon: 'Telefon', email: 'E-Mail', interessent: 'Interessent', kalender_termin_id: 'Kalendertermin',
    }
    const wert = (s: string, v: unknown) =>
      v === null || v === undefined || v === '' ? '(leer)' : s === 'beginn' ? zeitText(String(v)) : s === 'status' ? statusLabel(String(v)) : s === 'interesse' ? interesseLabel(String(v)) : s === 'angebot' ? euro(v) : s === 'dauer_min' ? `${v} Minuten` : String(v).slice(0, 120)
    const teile = Object.keys(neu).map((s) => `${NAMEN[s] ?? s}: ${wert(s, vorher[s as keyof BesichtigungZeile])} → ${wert(s, neu[s])}`)
    protokolliere(`Besichtigung ${objekt!.bezeichnung ?? vorher.objekt_id} mit ${vorher.interessent} geändert: ${teile.join('; ')}`.slice(0, 500))
    return `Geändert: Besichtigung ${objekt!.bezeichnung ?? vorher.objekt_id} mit ${nachher.interessent} — ${teile.join('; ')}.${hinweise.length ? ` ${hinweise.join(' ')}` : ''} id=${vorher.id}`
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
