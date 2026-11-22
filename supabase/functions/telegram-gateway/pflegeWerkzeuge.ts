// Aktenpflege für Geschäftsführung und Admins (früher der „Pflege-Modus" im Assistenten-Fenster des
// CRM, der im Browser lief, siehe AppContext PFLEGE_VERSCHIEBE_KUNDE / PFLEGE_MERGE_KUNDEN):
// - kunde_bereich_wechseln: eine Akte komplett in einen anderen Bereich verschieben
// - kunden_zusammenfuehren: zwei Akten desselben Kunden (Dublette) zu einer zusammenführen
// Löschen gibt es schon als kunde_loeschen in index.ts.
//
// Beides geht wie das Löschen nur in zwei Schritten: Der erste Aufruf beschreibt nur, was passieren
// würde, und merkt sich die Anfrage (state.pflege_anfrage). Erst wenn der Mitarbeiter in seiner
// direkt folgenden Nachricht bestätigt und das Werkzeug mit denselben Angaben erneut aufgerufen wird,
// wird geschrieben. index.ts setzt die gemerkte Anfrage zu Beginn jedes Gesprächszugs zurück.
//
// Die Datei kennt index.ts nicht (kein Kreis-Import): Status-Listen und Gesprächszustand reicht der
// Aufrufer herein.

import { bereichName, darfAkte, darfBereich, istPrivat, SAMMELAKTEN, siehtAlleBereiche, type RechteMitarbeiter } from './rechte.ts'
import { weitereVerweiseUmhaengen } from '../_shared/aktenVerweise.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type PflegeAnfrage =
  | { art: 'bereich'; kunde_id: string; nach_bereich: string; name: string; z: string }
  | { art: 'zusammen'; behalte_id: string; entferne_id: string; name: string; z: string }

export type PflegeKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  // Die Anfrage aus dem vorigen Gesprächszug (nur sie kann bestätigt werden).
  vorherige: PflegeAnfrage | undefined
  merkeAnfrage: (a: PflegeAnfrage) => void
  protokolliere: (text: string) => void
  heute: string
  // Gültige Status je Kundenakten-Bereich und der Anfangsstatus (aus index.ts).
  statusJeBereich: Record<string, Record<string, string>>
  startStatus: Record<string, string>
}

// Kundenakten-Bereiche (kunden.bereich), in die verschoben werden darf. "immobilienkunden" = Immobilien.
const ZIEL_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

const GUELTIG_MS = 10 * 60 * 1000

export const PFLEGE_WERKZEUGE = [
  {
    name: 'kunde_bereich_wechseln',
    description:
      'Nur Geschäftsführung und Admins: Verschiebt eine Kundenakte mit allem (Verlauf, Dokumente, Gesprächsprotokolle, Termine, Mails) in einen anderen Bereich, z. B. "verschiebe Müller nach Erben". Der erste Aufruf verschiebt nie, sondern beschreibt nur, was passieren würde; frag dann den Mitarbeiter ausdrücklich. Erst wenn er in seiner nächsten Nachricht klar bestätigt, rufst du das Werkzeug mit denselben Angaben erneut auf.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string' },
        nach_bereich: { type: 'string', enum: ZIEL_BEREICHE, description: 'beratung = Unternehmensberatung, immobilienkunden = Immobilien.' },
      },
      required: ['kunde_id', 'nach_bereich'],
    },
  },
  {
    name: 'kunden_zusammenfuehren',
    description:
      'Nur Geschäftsführung und Admins: Führt zwei Akten desselben Kunden (Dublette) zusammen. Die Akte behalte_id bleibt bestehen und bekommt Verlauf, Dokumente, Notizen, Follow-up, fehlende Kontaktangaben, Gesprächsprotokolle, Rechnungen, Termine und Mails der Akte entferne_id; diese wird danach gelöscht. Beide Akten müssen im selben Bereich liegen. Ist unklar, welche bleiben soll, frag nach. Der erste Aufruf ändert nichts, sondern beschreibt nur, was passieren würde; frag dann den Mitarbeiter ausdrücklich. Erst wenn er in seiner nächsten Nachricht klar bestätigt, rufst du das Werkzeug mit denselben Angaben erneut auf.',
    input_schema: {
      type: 'object',
      properties: {
        behalte_id: { type: 'string', description: 'kunde_id der Akte, die bestehen bleibt.' },
        entferne_id: { type: 'string', description: 'kunde_id der Akte, die eingearbeitet und danach gelöscht wird.' },
      },
      required: ['behalte_id', 'entferne_id'],
    },
  },
]

export function istPflegeWerkzeug(name: string): boolean {
  return name === 'kunde_bereich_wechseln' || name === 'kunden_zusammenfuehren'
}

function name(k: Zeile): string {
  const firma = String(k.firma ?? '')
  const ap = String(k.ansprechpartner ?? '')
  return ap && ap !== firma ? `${firma} (${ap})` : firma
}

function leer(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
}

function frisch(z: string): boolean {
  return Date.now() - new Date(z).getTime() < GUELTIG_MS
}

// Private Kontakte werden hier weder verschoben noch zusammengeführt (aus dem privaten Bereich holt sie
// in_oeffentlich_holen in index.ts). Den privaten Kontakt eines Kollegen gibt es für den Mitarbeiter nicht.
async function ladeGanzeAkte(supabase: Supa, id: unknown): Promise<Zeile | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await supabase.from('kunden').select('*').eq('id', id).maybeSingle()
  return (data as Zeile | null) ?? null
}

const KEIN_KUNDE = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'

/** Meldung für einen privaten Kontakt: dem Besitzer der Weg über in_oeffentlich_holen, allen anderen „gibt es nicht". */
function privatMeldung(mitarbeiter: RechteMitarbeiter, k: Zeile, was: string): string {
  if (!darfAkte(mitarbeiter, k)) return KEIN_KUNDE
  return `Nicht möglich: ${name(k)} ist ein privater Kontakt; ${was} geht hier nicht. In einen Bereich der Holding holst du ihn mit in_oeffentlich_holen (art=kontakt).`
}

function nichtErlaubt(was: string): string {
  return `Nicht erlaubt: ${was} darf nur die Geschäftsführung oder ein Admin. Sag dem Mitarbeiter, dass er die Geschäftsführung darum bitten kann.`
}

export async function fuehrePflegeWerkzeugAus(werkzeug: string, input: Zeile, ctx: PflegeKontext): Promise<string> {
  if (werkzeug === 'kunde_bereich_wechseln') return await bereichWechseln(input, ctx)
  if (werkzeug === 'kunden_zusammenfuehren') return await zusammenfuehren(input, ctx)
  return `Fehler: unbekanntes Werkzeug ${werkzeug}.`
}

// ---------- Bereich wechseln ----------

async function bereichWechseln(input: Zeile, ctx: PflegeKontext): Promise<string> {
  const { supabase, mitarbeiter, heute } = ctx
  if (!siehtAlleBereiche(mitarbeiter)) return nichtErlaubt('Akten in einen anderen Bereich verschieben')
  let nach = String(input.nach_bereich ?? '').trim()
  if (nach === 'immobilien') nach = 'immobilienkunden'
  if (!ZIEL_BEREICHE.includes(nach)) return `Fehler: unbekannter Ziel-Bereich. Möglich: ${ZIEL_BEREICHE.map((b) => `${b} (${bereichName(b)})`).join(', ')}.`
  const k = await ladeGanzeAkte(supabase, input.kunde_id)
  if (!k) return KEIN_KUNDE
  if (istPrivat(k)) return privatMeldung(mitarbeiter, k, 'Verschieben')
  if (SAMMELAKTEN.includes(k.id)) return 'Nicht möglich: Das ist eine Sammelakte für Eingänge, kein Kunde. Sie bleibt, wo sie ist; einzelne Dokumente daraus legst du beim richtigen Kunden ab.'
  if (!darfAkte(mitarbeiter, k) || !darfBereich(mitarbeiter, nach)) return nichtErlaubt('Akten in einen anderen Bereich verschieben')
  const von = String(k.bereich)
  if (von === nach) return `${name(k)} liegt schon im Bereich ${bereichName(nach)}. Es gibt nichts zu verschieben.`

  const zielStatus = ctx.statusJeBereich[nach] ?? {}
  const statusBleibt = !!k.status && !!zielStatus[k.status]
  const neuerStatus = statusBleibt ? String(k.status) : ctx.startStatus[nach]
  const statusText = statusBleibt
    ? `Der Status „${zielStatus[neuerStatus]}" bleibt.`
    : `Den bisherigen Status gibt es dort nicht; er wird auf „${zielStatus[neuerStatus] ?? neuerStatus}" gesetzt.`

  const anfrage = ctx.vorherige
  const bestaetigt = anfrage?.art === 'bereich' && anfrage.kunde_id === k.id && anfrage.nach_bereich === nach && frisch(anfrage.z)
  if (!bestaetigt) {
    ctx.merkeAnfrage({ art: 'bereich', kunde_id: k.id, nach_bereich: nach, name: name(k), z: new Date().toISOString() })
    return `NOCH NICHT VERSCHOBEN. Frage den Mitarbeiter jetzt ausdrücklich, ob ${name(k)} vom Bereich ${bereichName(von)} in den Bereich ${bereichName(nach)} verschoben werden soll (mit ${(k.dokumente ?? []).length} Dokumenten und ${(k.activities ?? []).length} Verlaufseinträgen). ${statusText} Nur wenn er das in seiner nächsten Nachricht klar bestätigt, rufe kunde_bereich_wechseln erneut mit denselben Angaben auf.`
  }

  const eintrag = {
    id: crypto.randomUUID(),
    date: heute,
    text: `Vom Bereich „${bereichName(von)}" in den Bereich „${bereichName(nach)}" verschoben durch ${mitarbeiter.name} (über den Assistenten).${statusBleibt ? '' : ` Status auf „${zielStatus[neuerStatus] ?? neuerStatus}" gesetzt.`}`,
    user: mitarbeiter.name,
  }
  const patch: Zeile = {
    bereich: nach,
    status: neuerStatus,
    activities: [eintrag, ...(Array.isArray(k.activities) ? k.activities : [])],
    letzte_aktivitaet: heute,
  }
  // Wie „Verschieben" im Prüfhinweis der Akte: Ein Hinweis, der genau diesen Bereich vorschlug, ist damit erledigt.
  if (k.pruef_hinweis && k.pruef_hinweis.vorschlagBereich === nach) patch.pruef_hinweis = null
  const { error } = await supabase.from('kunden').update(patch).eq('id', k.id)
  if (error) return `Fehler beim Verschieben: ${error.message}`

  // Alles, was den Bereich der Akte mitführt, zieht mit um — sonst fänden Akte und Protokolle,
  // Termine, Mails und Objekt-Vorschläge einander nicht mehr.
  const fehler = await bereichNachziehen(supabase, k.id, nach)
  ctx.protokolliere(`Kunde ${name(k)} vom Bereich ${bereichName(von)} in den Bereich ${bereichName(nach)} verschoben (kunde_id=${k.id})`)
  return `Verschoben: ${name(k)} liegt jetzt im Bereich ${bereichName(nach)}.${statusBleibt ? '' : ` Status: ${zielStatus[neuerStatus] ?? neuerStatus}.`}${fehler.length > 0 ? ` Achtung, nicht alles zog mit um: ${fehler.join('; ')}.` : ''}`
}

async function bereichNachziehen(supabase: Supa, id: string, nach: string): Promise<string[]> {
  const fehler: string[] = []
  const schritte: [string, Zeile, string][] = [
    ['protokolle', { bereich: nach }, 'kunde_id'],
    ['objekt_vorschlaege', { kunde_bereich: nach }, 'kunde_id'],
    ['termine', { kunde_bereich: nach }, 'kunde_id'],
    ['gesendete_emails', { kunde_bereich: nach }, 'kunde_id'],
    ['eingegangene_emails', { zugewiesener_bereich: nach }, 'zugewiesener_kunde_id'],
  ]
  for (const [tabelle, aenderung, spalte] of schritte) {
    const { error } = await supabase.from(tabelle).update(aenderung).eq(spalte, id)
    if (error) fehler.push(`${tabelle}: ${error.message}`)
  }
  fehler.push(...(await verknuepfungenUmschreiben(supabase, id, { id, bereich: nach })))
  return fehler
}

// Andere Akten, die mit dieser verknüpft sind ("in beiden Bereichen führen"), zeigen auf {id, bereich}.
async function verknuepfungenUmschreiben(supabase: Supa, alteId: string, neu: { id: string; bereich: string }): Promise<string[]> {
  const { data, error } = await alleZeilen(() => supabase.from('kunden').select('id, verknuepfte_kunden').not('verknuepfte_kunden', 'is', null))
  if (error) return [`Verknüpfungen: ${error.message}`]
  const fehler: string[] = []
  for (const z of (data ?? []) as Zeile[]) {
    const liste = Array.isArray(z.verknuepfte_kunden) ? (z.verknuepfte_kunden as Zeile[]) : []
    if (!liste.some((v) => v?.id === alteId)) continue
    const gesehen = new Set<string>()
    const neueListe = liste
      .map((v) => (v?.id === alteId ? { ...v, id: neu.id, bereich: neu.bereich } : v))
      .filter((v) => v?.id && v.id !== z.id && !gesehen.has(v.id) && gesehen.add(v.id))
    const { error: e } = await supabase.from('kunden').update({ verknuepfte_kunden: neueListe.length > 0 ? neueListe : null }).eq('id', z.id)
    if (e) fehler.push(`Verknüpfung bei ${z.id}: ${e.message}`)
  }
  return fehler
}

// ---------- Zusammenführen ----------

async function zusammenfuehren(input: Zeile, ctx: PflegeKontext): Promise<string> {
  const { supabase, mitarbeiter, heute } = ctx
  if (!siehtAlleBereiche(mitarbeiter)) return nichtErlaubt('Akten zusammenführen')
  const [b, e] = await Promise.all([ladeGanzeAkte(supabase, input.behalte_id), ladeGanzeAkte(supabase, input.entferne_id)])
  if (!b || !e) return KEIN_KUNDE
  if (istPrivat(b)) return privatMeldung(mitarbeiter, b, 'Zusammenführen')
  if (istPrivat(e)) return privatMeldung(mitarbeiter, e, 'Zusammenführen')
  if (b.id === e.id) return 'Das ist zweimal dieselbe Akte. Es gibt nichts zusammenzuführen.'
  if (SAMMELAKTEN.includes(b.id) || SAMMELAKTEN.includes(e.id)) return 'Nicht möglich: Eine der beiden ist eine Sammelakte für Eingänge, kein Kunde. Einzelne Dokumente daraus legst du beim richtigen Kunden ab.'
  if (!darfAkte(mitarbeiter, b) || !darfAkte(mitarbeiter, e)) return nichtErlaubt('Akten zusammenführen')
  if (b.bereich !== e.bereich) {
    return `Nicht zusammengeführt: ${name(b)} liegt im Bereich ${bereichName(b.bereich)}, ${name(e)} im Bereich ${bereichName(e.bereich)}. Beide müssen im selben Bereich liegen. Biete an, zuerst eine der beiden zu verschieben.`
  }

  const [rechnungen, protokolle] = await Promise.all([
    supabase.from('rechnungen').select('id', { count: 'exact', head: true }).eq('kunde_id', e.id),
    supabase.from('protokolle').select('id', { count: 'exact', head: true }).eq('kunde_id', e.id),
  ])
  const zaehle = (r: { count?: number | null }) => r?.count ?? 0

  const anfrage = ctx.vorherige
  const bestaetigt = anfrage?.art === 'zusammen' && anfrage.behalte_id === b.id && anfrage.entferne_id === e.id && frisch(anfrage.z)
  if (!bestaetigt) {
    ctx.merkeAnfrage({ art: 'zusammen', behalte_id: b.id, entferne_id: e.id, name: `${name(b)} + ${name(e)}`, z: new Date().toISOString() })
    const zeile = (k: Zeile) => `${name(k)} (${[k.email, k.telefon].filter((x) => !leer(x)).join(', ') || 'ohne Kontaktangaben'}; ${(k.dokumente ?? []).length} Dokumente, ${(k.activities ?? []).length} Verlaufseinträge)`
    return `NOCH NICHT ZUSAMMENGEFÜHRT. Frage den Mitarbeiter jetzt ausdrücklich, ob das so passieren soll: Bestehen bleibt ${zeile(b)}. Eingearbeitet und danach unwiderruflich gelöscht wird ${zeile(e)}${zaehle(rechnungen) + zaehle(protokolle) > 0 ? `; dessen ${zaehle(rechnungen)} Rechnung(en) und ${zaehle(protokolle)} Gesprächsprotokoll(e) wandern mit` : ''}. Beide liegen im Bereich ${bereichName(b.bereich)}. Nur wenn er das in seiner nächsten Nachricht klar bestätigt, rufe kunden_zusammenfuehren erneut mit denselben Angaben auf.`
  }

  const { patch, hinweise } = zusammengefuehrt(b, e, mitarbeiter.name, heute)
  const { error } = await supabase.from('kunden').update(patch).eq('id', b.id)
  if (error) return `Fehler beim Zusammenführen (nichts geändert): ${error.message}`

  // Alles, was auf die entfernte Akte zeigt, auf die bleibende umhängen — erst dann löschen.
  const fehler = await verweiseUmhaengen(supabase, e.id, b)
  if (fehler.length > 0) {
    ctx.protokolliere(`Akte ${name(e)} in ${name(b)} eingearbeitet, aber nicht gelöscht (Fehler beim Umhängen) (kunde_id=${b.id})`)
    return `Teilweise erledigt: Verlauf, Dokumente und Angaben von ${name(e)} stehen jetzt auch bei ${name(b)}. ${name(e)} habe ich aber NICHT gelöscht, weil nicht alles umgehängt werden konnte (${fehler.join('; ')}). Sag das dem Mitarbeiter; die Geschäftsführung kann die Akte danach von Hand löschen.`
  }
  const { error: loeschFehler } = await supabase.from('kunden').delete().eq('id', e.id)
  if (loeschFehler) {
    ctx.protokolliere(`Akte ${name(e)} in ${name(b)} eingearbeitet, Löschen fehlgeschlagen (kunde_id=${b.id})`)
    return `Teilweise erledigt: Alles von ${name(e)} steht jetzt bei ${name(b)}, aber das Löschen von ${name(e)} schlug fehl (${loeschFehler.message}).`
  }
  ctx.protokolliere(`Akten zusammengeführt: ${name(e)} in ${name(b)} eingearbeitet und gelöscht (kunde_id=${b.id})`)
  return `Zusammengeführt: ${name(b)} enthält jetzt auch Verlauf, Dokumente und Angaben von ${name(e)}; ${name(e)} ist gelöscht.${hinweise.length > 0 ? ` Hinweise: ${hinweise.join(' ')}` : ''}`
}

// Baut die Änderung für die bleibende Akte. Schreibt nur Spalten, die es in der Zeile gibt.
function zusammengefuehrt(b: Zeile, e: Zeile, wer: string, heute: string): { patch: Zeile; hinweise: string[] } {
  const patch: Zeile = {}
  const hinweise: string[] = []
  const setze = (spalte: string, wert: unknown) => {
    if (spalte in b) patch[spalte] = wert
  }
  const liste = (v: unknown): Zeile[] => (Array.isArray(v) ? (v as Zeile[]) : [])
  const ohneDoppelte = (eintraege: Zeile[]) => {
    const gesehen = new Set<string>()
    return eintraege.filter((x) => {
      const schluessel = x?.id ? `${x.id}|${x.url ?? ''}` : JSON.stringify(x)
      if (gesehen.has(schluessel)) return false
      gesehen.add(schluessel)
      return true
    })
  }

  // Kontaktangaben: Leeres in der bleibenden Akte wird aus der anderen gefüllt; abweichende Angaben
  // gehen nicht verloren, sondern kommen in den Verlaufseintrag.
  const zusatz: string[] = []
  for (const [spalte, label] of [['ansprechpartner', 'Ansprechpartner'], ['email', 'E-Mail'], ['telefon', 'Telefon'], ['verantwortlich', 'Verantwortlich']] as const) {
    if (leer(e[spalte])) continue
    if (leer(b[spalte])) setze(spalte, e[spalte])
    else if (String(b[spalte]).trim().toLowerCase() !== String(e[spalte]).trim().toLowerCase()) zusatz.push(`${label} der entfernten Akte: ${String(e[spalte]).trim()}`)
  }
  if (!leer(e.firma) && String(e.firma).trim().toLowerCase() !== String(b.firma ?? '').trim().toLowerCase()) zusatz.push(`Name der entfernten Akte: ${String(e.firma).trim()}`)

  // Follow-up: ein offenes gewinnt gegen ein erledigtes oder fehlendes; sind beide offen, bleibt das
  // eigene und das andere wird im Verlauf festgehalten.
  const fuB = b.follow_up as Zeile | null
  const fuE = e.follow_up as Zeile | null
  const offen = (f: Zeile | null) => !!f && !f.done && (!leer(f.note) || !leer(f.date))
  if (offen(fuE)) {
    if (!offen(fuB)) setze('follow_up', fuE)
    else zusatz.push(`Follow-up der entfernten Akte: ${fuE!.note || 'ohne Text'}${fuE!.date ? ` (fällig ${fuE!.date})` : ''}`)
  }

  const eintrag = {
    id: crypto.randomUUID(),
    date: heute,
    text: `Doppelte Akte „${name(e)}" hier eingearbeitet und gelöscht durch ${wer} (über den Assistenten).${zusatz.length > 0 ? ` ${zusatz.join('. ')}.` : ''}`,
    user: wer,
  }
  // Verlauf: neuester zuerst, wie überall im CRM.
  const verlauf = ohneDoppelte([...liste(b.activities), ...liste(e.activities)]).sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? '')))
  setze('activities', [eintrag, ...verlauf])
  setze('dokumente', ohneDoppelte([...liste(b.dokumente), ...liste(e.dokumente)]))
  setze('signaturen', leer(e.signaturen) ? b.signaturen ?? null : ohneDoppelte([...liste(b.signaturen), ...liste(e.signaturen)]))
  setze('gesuche', leer(e.gesuche) ? b.gesuche ?? null : ohneDoppelte([...liste(b.gesuche), ...liste(e.gesuche)]))
  // Hochlade-Links der entfernten Akte bleiben gültig: Der Server findet die Akte über das Zeichen in dieser Liste.
  setze('unterlagen_anforderungen', leer(e.unterlagen_anforderungen) ? b.unterlagen_anforderungen ?? null : ohneDoppelte([...liste(b.unterlagen_anforderungen), ...liste(e.unterlagen_anforderungen)]))
  if (e.unterlagen_checkliste && typeof e.unterlagen_checkliste === 'object') {
    const zusammen: Record<string, boolean> = { ...(b.unterlagen_checkliste ?? {}) }
    for (const [punkt, da] of Object.entries(e.unterlagen_checkliste as Record<string, boolean>)) zusammen[punkt] = !!zusammen[punkt] || !!da
    setze('unterlagen_checkliste', zusammen)
  }
  const verknuepft = liste(b.verknuepfte_kunden)
    .concat(liste(e.verknuepfte_kunden))
    .filter((v, i, alle) => v?.id && v.id !== b.id && v.id !== e.id && alle.findIndex((w) => w?.id === v.id) === i)
  if ('verknuepfte_kunden' in b) setze('verknuepfte_kunden', verknuepft.length > 0 ? verknuepft : null)
  // Einzelne Auswertungen und Profile: Was in der bleibenden Akte fehlt, kommt aus der anderen.
  for (const spalte of ['kaeuferprofil', 'immo_stammdaten', 'unternehmensbewertung', 'selbstauskunft', 'potenzial_analyse', 'bonitaet', 'steuer_analyse', 'unternehmensbewertung_recherche']) {
    if (leer(b[spalte]) && !leer(e[spalte])) setze(spalte, e[spalte])
  }
  setze('letzte_aktivitaet', heute)
  if (zusatz.length > 0) hinweise.push('Abweichende Angaben der entfernten Akte stehen im Verlauf.')
  return { patch, hinweise }
}

// Alle Verweise anderer Tabellen von der entfernten auf die bleibende Akte umhängen.
async function verweiseUmhaengen(supabase: Supa, alteId: string, b: Zeile): Promise<string[]> {
  const fehler: string[] = []
  const neuerName = name(b)
  const schritte: [string, Zeile, string][] = [
    ['protokolle', { kunde_id: b.id, bereich: b.bereich }, 'kunde_id'],
    ['rechnungen', { kunde_id: b.id }, 'kunde_id'],
    ['konzepte', { kunde_id: b.id }, 'kunde_id'],
    ['vertraege', { kunde_id: b.id }, 'kunde_id'],
    ['objekt_vorschlaege', { kunde_id: b.id, kunde_bereich: b.bereich }, 'kunde_id'],
    ['termine', { kunde_id: b.id, kunde_bereich: b.bereich, kunde_name: neuerName }, 'kunde_id'],
    ['gesendete_emails', { kunde_id: b.id, kunde_bereich: b.bereich, kunde_name: neuerName }, 'kunde_id'],
    ['eingegangene_emails', { zugewiesener_kunde_id: b.id, zugewiesener_bereich: b.bereich, zugewiesener_kunde_name: neuerName }, 'zugewiesener_kunde_id'],
    ['projekte', { verknuepft_kunde_id: b.id }, 'verknuepft_kunde_id'],
  ]
  for (const [tabelle, aenderung, spalte] of schritte) {
    const { error } = await supabase.from(tabelle).update(aenderung).eq(spalte, alteId)
    if (error) fehler.push(`${tabelle}: ${error.message}`)
  }
  fehler.push(...(await verknuepfungenUmschreiben(supabase, alteId, { id: b.id, bereich: b.bereich })))
  // Neuere Tabellen (Wiedervorlagen, Unterschriften, Partner, Kostenvoranschläge, Besichtigungen …) — ohne das gingen sie beim
  // Löschen der alten Akte verloren oder verwaisten (gefunden 22.11.2026, _shared/aktenVerweise.ts).
  fehler.push(...(await weitereVerweiseUmhaengen(supabase, alteId, b.id)).fehler)
  return fehler
}
