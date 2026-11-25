// Assistent-Werkzeug termin_briefing (22.11.2026): dasselbe Briefing, das der Zeitplan etwa eine Stunde vor
// einem Kundentermin schickt (email-gateway/terminBriefing.ts, Kern _shared/terminBriefingKern.ts) — auf Abruf.
//
// - Mit termin_id: dieser Termin (nur eigene Termine oder solche, bei denen der Mitarbeiter Teilnehmer ist).
// - Mit kunde_id bzw. objekt_id: der nächste eigene Termin zu dieser Akte bzw. diesem Objekt in den nächsten
//   60 Tagen; gibt es keinen, das Briefing zur Akte ohne Termin.
// - Ohne Angabe: der nächste eigene Termin (ab 15 Minuten zurück, 14 Tage voraus), der einen Bezug zu einer
//   Akte oder einem Objekt hat.
// Rechte wie überall im Assistenten (rechte.ts); private Akten und Objekte nur für ihren Besitzer, im privaten
// Assistenten nur eigene Termine ohne Kollegen. Schreibt nichts und sendet nichts.

import {
  akteText,
  type Bezug,
  type BriefingTermin,
  briefingText,
  findeBezug,
  gespraechspunkte,
  istAbgesagterTitel,
  kandidatenLader,
  type KiFunktion,
  ladeBriefingDaten,
  ladeLinkBasis,
  SAMMELAKTEN,
  TERMIN_SPALTEN,
} from '../_shared/terminBriefingKern.ts'
import { darfAkte, darfObjekt, istFremdePrivatakte, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { istPrivaterTermin } from '../_shared/privatGrenze.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type BriefingKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Nur für Tests: KI-Aufruf und Schlüssel ersetzen (null = ohne Gesprächspunkte). */
  ki?: KiFunktion
  apiKey?: string | null
  jetzt?: Date
}

export const BRIEFING_WERKZEUGE = [
  {
    name: 'termin_briefing',
    description:
      'Briefing zur Vorbereitung auf einen Kundentermin: wer, wann, wo; Stand der Akte; Sachverhalt; die letzten drei Kontakte (Mails, Gesprächsprotokolle, Notizen); offene Wiedervorlagen; angeforderte, noch fehlende Unterlagen; offene Rechnungen und Angebote; dazu 2–3 vorgeschlagene Gesprächspunkte. ' +
      'Für „Was muss ich für den Termin mit X wissen?“, „Bereite mich auf meinen nächsten Termin vor“, „Briefing für Familie Y“. Mit termin_id (aus termine_zeigen) für einen bestimmten Termin, mit kunde_id oder objekt_id für den nächsten Termin zu dieser Akte (gibt es keinen, das Briefing zur Akte), ohne Angabe für den nächsten eigenen Termin mit Bezug zu einer Akte. Liest nur, sendet nichts.',
    input_schema: {
      type: 'object',
      properties: {
        termin_id: { type: 'string', description: 'Optional: der Termin (aus termine_zeigen).' },
        kunde_id: { type: 'string', description: 'Optional: die Kundenakte (mit kunden_suchen ermitteln).' },
        objekt_id: { type: 'string', description: 'Optional: das Objekt (mit objekte_suchen ermitteln).' },
      },
    },
  },
]

export function istBriefingWerkzeug(name: string): boolean {
  return BRIEFING_WERKZEUGE.some((w) => w.name === name)
}

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

function beteiligt(t: BriefingTermin, ich: string): boolean {
  return adresse(t.besitzer_email) === ich || (t.teilnehmer ?? []).map(adresse).includes(ich)
}

/** Im privaten Assistenten gibt es nur eigene Termine ohne Kollegen; im Mayer-Assistenten keine privaten Termine
 *  (_shared/privatGrenze.ts — wie termine_zeigen). */
function sichtbarerTermin(m: RechteMitarbeiter, t: BriefingTermin, ich: string): boolean {
  if (!beteiligt(t, ich)) return false
  if (m.nurPrivat === true) return adresse(t.besitzer_email) === ich && (t.teilnehmer ?? []).length === 0
  return !istPrivaterTermin(t)
}

/** Fehlertext, wenn der Mitarbeiter den Bezug nicht sehen darf — sonst null. */
async function sperre(k: BriefingKontext, b: Bezug): Promise<string | null> {
  const m = k.mitarbeiter
  if (b.art === 'kunde') {
    const akte = { id: b.id, bereich: b.bereich, verantwortlich_email: b.verantwortlichEmail }
    if (SAMMELAKTEN.includes(b.id)) return 'Fehler: Für die Sammelakten (Ungeklärte Eingänge, Intern) gibt es kein Briefing.'
    if (istFremdePrivatakte(m, akte)) return 'Fehler: Diese Akte gibt es für dich nicht.'
    if (!darfAkte(m, akte)) return nichtFreigegeben(b.bereich, m.name)
    return null
  }
  const objekt = { privat_besitzer: b.privatBesitzer }
  if (istUnsichtbaresObjekt(m, objekt)) return 'Fehler: Dieses Objekt gibt es nicht. Ermittle die objekt_id mit objekte_suchen.'
  if (!darfObjekt(m, objekt)) return nichtFreigegeben('immobilien', m.name)
  return null
}

// deno-lint-ignore no-explicit-any
export async function fuehreBriefingWerkzeugAus(name: string, input: any, k: BriefingKontext): Promise<string> {
  if (name !== 'termin_briefing') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const ich = adresse(mitarbeiter.email)
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  const jetzt = k.jetzt ?? new Date()
  const terminId = String(input?.termin_id ?? '').trim()
  const kundeId = String(input?.kunde_id ?? '').trim()
  const objektId = String(input?.objekt_id ?? '').trim()

  const { data: teamZeilen } = await supabase.from('mitarbeiter').select('name, email').eq('aktiv', true)
  const teamListe = ((teamZeilen ?? []) as { name: string; email: string }[]).map((x) => ({ name: String(x.name ?? ''), email: adresse(x.email) }))
  const team = new Set(teamListe.map((x) => x.email).filter(Boolean))
  const namen = new Map(teamListe.map((x) => [x.email, x.name]))
  const lader = kandidatenLader(supabase)
  const bezugVon = (t: BriefingTermin) => findeBezug(supabase, t, { team, teamNamen: teamListe.map((x) => x.name), lader })

  let termin: BriefingTermin | null = null
  let bezug: Bezug | null = null

  if (terminId) {
    const { data: t, error } = await supabase.from('termine').select(TERMIN_SPALTEN).eq('id', terminId).maybeSingle()
    if (error) return `Fehler beim Laden des Termins: ${error.message}`
    if (!t || !sichtbarerTermin(mitarbeiter, t, ich)) return 'Fehler: Diesen Termin gibt es nicht (mehr). Ermittle die termin_id mit termine_zeigen.'
    termin = t
    bezug = await bezugVon(t)
    if (!bezug) return `Der Termin „${t.titel}“ ist mit keiner Akte und keinem Objekt verknüpft, und aus Titel oder Gast-Adresse ergibt sich keine eindeutige Akte. Frag nach, um welchen Kunden es geht, und ruf termin_briefing dann mit kunde_id auf.`
  } else if (kundeId) {
    const { data: akte, error } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (error) return `Fehler beim Laden der Akte: ${error.message}`
    if (!akte) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    bezug = { art: 'kunde', id: String(akte.id), bereich: String(akte.bereich ?? ''), verantwortlichEmail: akte.verantwortlich_email ?? null, wie: 'verknuepft' }
  } else if (objektId) {
    const { data: o, error } = await supabase.from('objekte').select('id, privat_besitzer').eq('id', objektId).maybeSingle()
    if (error) return `Fehler beim Laden des Objekts: ${error.message}`
    if (!o) return 'Fehler: Dieses Objekt gibt es nicht. Ermittle die objekt_id mit objekte_suchen.'
    bezug = { art: 'objekt', id: String(o.id), privatBesitzer: o.privat_besitzer ?? null, wie: 'besichtigung' }
  }

  if (bezug) {
    const s = await sperre(k, bezug)
    if (s) return s
  }

  // Nächster eigener Termin: zur Akte/zum Objekt, oder (ohne Angabe) der erste mit einem sichtbaren Bezug.
  if (!termin) {
    const ab = new Date(jetzt.getTime() - 15 * 60000).toISOString()
    const bis = new Date(jetzt.getTime() + (bezug ? 60 : 14) * 86400000).toISOString()
    let abfrage = supabase.from('termine').select(TERMIN_SPALTEN).eq('ganztags', false).gte('beginn', ab).lte('beginn', bis)
    if (bezug?.art === 'kunde') abfrage = abfrage.eq('kunde_id', bezug.id)
    const { data, error } = await abfrage.order('beginn', { ascending: true }).limit(300)
    if (error) return `Fehler beim Laden der Termine: ${error.message}`
    const eigene = ((data ?? []) as BriefingTermin[]).filter((t) => sichtbarerTermin(mitarbeiter, t, ich) && !istAbgesagterTitel(String(t.titel ?? '')))
    if (bezug?.art === 'objekt') {
      const { data: bes } = await supabase.from('besichtigungen').select('kalender_termin_id').eq('objekt_id', bezug.id).limit(200)
      const ids = new Set(((bes ?? []) as { kalender_termin_id?: string | null }[]).map((b) => String(b.kalender_termin_id ?? '')).filter(Boolean))
      termin = eigene.find((t) => ids.has(String(t.id))) ?? null
    } else if (bezug) {
      termin = eigene[0] ?? null
    } else {
      for (const t of eigene.slice(0, 40)) {
        const b = await bezugVon(t)
        if (b && !(await sperre(k, b))) {
          termin = t
          bezug = b
          break
        }
      }
      if (!termin || !bezug) return 'In den nächsten 14 Tagen hast du keinen Termin, der mit einer Akte oder einem Objekt verknüpft ist. Nenne den Kunden, dann gibt es das Briefing zur Akte.'
    }
  }

  if (!bezug) return 'Fehler: Kein Bezug gefunden.'
  const s = await sperre(k, bezug)
  if (s) return s

  const linkBasis = await ladeLinkBasis(supabase)
  let daten
  try {
    daten = await ladeBriefingDaten(supabase, bezug, heute, { linkBasis })
  } catch (err) {
    return `Fehler: ${err instanceof Error ? err.message : String(err)}`
  }
  if (!daten) return 'Fehler: Die Akte bzw. das Objekt ließ sich nicht laden.'
  const punkte = await gespraechspunkte(akteText(daten), { funktion: 'telegram-gateway', ki: k.ki, apiKey: k.apiKey })
  const minutenBis = termin ? (new Date(termin.beginn).getTime() - jetzt.getTime()) / 60000 : undefined
  const text = briefingText(daten, { termin, minutenBis, namen, gespraechspunkte: punkte })
  protokolliere(`Termin-Briefing angesehen: ${bezug.art === 'kunde' ? 'Akte' : 'Objekt'} ${bezug.id}${termin ? `, Termin ${termin.id}` : ''}`)

  return [
    termin ? '' : 'Kein anstehender Termin zu dieser Akte gefunden — hier das Briefing zur Akte.',
    'Gib das Briefing dem Mitarbeiter so wieder (gern etwas gekürzt, aber ohne etwas hinzuzufügen).',
    daten.fehler.length ? `Hinweis (nicht alles geladen): ${daten.fehler.join('; ')}` : '',
    '---',
    text,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000)
}
