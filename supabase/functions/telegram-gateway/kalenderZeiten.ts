// Assistent-Werkzeug `freie_zeiten`: Wann haben der Mitarbeiter (und auf Wunsch Kollegen) Zeit?
//
// Berücksichtigt werden
// - die CRM-Termine (Tabelle termine) — beim Mitarbeiter selbst alle, auch die aus dem Outlook-Abgleich
//   (email-gateway/kalenderAbgleich.ts legt Outlook-Termine dort ab, Spalte ms_id);
// - die belegten Zeiten aus dem eigenen Kalender (Tabelle kalender_fremd, siehe email-gateway/fremdKalender.ts).
//
// Für Kollegen gilt dieselbe Regel wie in der Datenbankfunktion kalender_belegt: nur wenn sie
// „Kollegen sehen, wann ich belegt bin“ eingeschaltet haben, ohne Outlook-Termine und ohne Termine zu
// eigenen privaten Kontakten — gemeinsam gebuchte Termine (mit dem Fragenden) immer. Von fremden Terminen
// nennt das Werkzeug nie den Inhalt, nur „belegt“.
//
// Ganztägige Einträge sperren keine Uhrzeiten (wie im übrigen Kalender) — außer ganztägige Einträge aus dem
// eigenen Kalender, die dort ausdrücklich als belegt/abwesend markiert sind (Urlaub). Sie werden als
// Hinweis genannt. Nur lesend; nichts wird angelegt.

import { ortszeitZuUtc } from '../_shared/icsBelegt.ts'
import type { RechteMitarbeiter } from './rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type KalenderZeitenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Nur für Tests: aktueller Zeitpunkt. */
  jetzt?: number
}

export const KALENDER_ZEITEN_WERKZEUGE = [
  {
    name: 'freie_zeiten',
    description:
      'Sucht freie Zeiten im Kalender des Mitarbeiters, mit dem du sprichst — auf Wunsch gemeinsam mit Kollegen. Berücksichtigt CRM-Termine (beim Mitarbeiter selbst auch die aus Outlook übernommenen) und die belegten Zeiten aus dem eigenen Kalender, den er im CRM verbunden hat. Mit vorschlag prüfst du genau einen Zeitpunkt (z. B. den Termin, den ein Kunde in einer Mail vorschlägt). Nur lesend — trägt nichts ein.',
    input_schema: {
      type: 'object',
      properties: {
        von: { type: 'string', description: 'Erster Tag, JJJJ-MM-TT (Standard: heute bzw. der Tag des Vorschlags).' },
        bis: { type: 'string', description: 'Letzter Tag, JJJJ-MM-TT (Standard: wie von; höchstens 31 Tage).' },
        dauer_minuten: { type: 'integer', minimum: 15, maximum: 600, description: 'Wie lange der Termin dauert (Standard 60).' },
        personen: { type: 'array', items: { type: 'string' }, description: 'Namen von Kollegen, die auch Zeit haben müssen (ohne den Mitarbeiter selbst).' },
        ohne_mich: { type: 'boolean', description: 'true = nur die genannten Kollegen prüfen, nicht den Mitarbeiter selbst.' },
        tag_beginn: { type: 'string', description: 'Frühester Beginn am Tag, HH:MM (Standard 08:00).' },
        tag_ende: { type: 'string', description: 'Spätestes Ende am Tag, HH:MM (Standard 18:00).' },
        wochenende: { type: 'boolean', description: 'true = auch Samstag und Sonntag (Standard: nur Montag bis Freitag).' },
        vorschlag: { type: 'string', description: 'Genau diesen Zeitpunkt prüfen, JJJJ-MM-TTTHH:MM (deutsche Zeit); Dauer aus dauer_minuten.' },
      },
    },
  },
]

export function istKalenderZeitenWerkzeug(name: string): boolean {
  return KALENDER_ZEITEN_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Helfer ----------

const MINUTE = 60000
const TAG = 86400000
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const p2 = (n: number) => String(n).padStart(2, '0')

function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function gueltigerTag(v: string): { j: number; mo: number; t: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null
  return { j: +m[1], mo: +m[2], t: +m[3] }
}

function uhrzeit(v: unknown, standard: number): number | null {
  if (v === undefined || v === null || v === '') return standard
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim())
  if (!m || +m[1] > 24 || +m[2] > 59) return null
  return +m[1] * 60 + +m[2]
}

const berlin = (j: number, mo: number, t: number, minuten = 0) => {
  const d = new Date(Date.UTC(j, mo - 1, t))
  return ortszeitZuUtc({ j: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, t: d.getUTCDate(), h: Math.floor(minuten / 60), mi: minuten % 60, s: 0 }, 'Europe/Berlin')
}

const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const uhr = (ms: number) => UHR.format(new Date(ms))
const tagText = (j: number, mo: number, t: number) => `${WT[new Date(Date.UTC(j, mo - 1, t)).getUTCDay()]} ${p2(t)}.${p2(mo)}.${j}`
const BERLIN_TAG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
const berlinTagVon = (ms: number) => BERLIN_TAG.format(new Date(ms))
const STAND = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

type Belegung = { von: number; bis: number; person: string; text: string; ganztags: boolean; sperrt: boolean }

type TerminZeile = {
  id: string
  titel: string | null
  beginn: string
  ende: string
  ganztags: boolean | null
  besitzer_email: string | null
  teilnehmer: string[] | null
  ms_id: string | null
  kunde_bereich: string | null
}

/** Freie Abschnitte eines Fensters nach Abzug der Belegungen (Beginn auf die Viertelstunde aufgerundet). */
export function freieAbschnitte(vonMs: number, bisMs: number, belegt: { von: number; bis: number }[], dauerMs: number): [number, number][] {
  const sortiert = belegt.filter((b) => b.bis > vonMs && b.von < bisMs).sort((a, b) => a.von - b.von)
  const frei: [number, number][] = []
  let zeiger = vonMs
  const nimm = (a: number, b: number) => {
    const start = Math.ceil(a / (15 * MINUTE)) * 15 * MINUTE
    if (b - start >= dauerMs) frei.push([start, b])
  }
  for (const b of sortiert) {
    if (b.von > zeiger) nimm(zeiger, Math.min(b.von, bisMs))
    zeiger = Math.max(zeiger, b.bis)
    if (zeiger >= bisMs) break
  }
  if (zeiger < bisMs) nimm(zeiger, bisMs)
  return frei
}

// ---------- Ausführen ----------

// deno-lint-ignore no-explicit-any
export async function fuehreKalenderZeitenWerkzeugAus(name: string, input: any, k: KalenderZeitenKontext): Promise<string> {
  if (name !== 'freie_zeiten') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = k
  const jetzt = k.jetzt ?? Date.now()
  const ich = String(mitarbeiter.email ?? '').trim().toLowerCase()
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  const nurPrivat = mitarbeiter.nurPrivat === true

  // Eingaben
  const dauer = Math.round(Number(input?.dauer_minuten ?? 60))
  if (!Number.isFinite(dauer) || dauer < 15 || dauer > 600) return 'Fehler: dauer_minuten muss zwischen 15 und 600 liegen.'
  const tagBeginn = uhrzeit(input?.tag_beginn, 8 * 60)
  const tagEnde = uhrzeit(input?.tag_ende, 18 * 60)
  if (tagBeginn === null || tagEnde === null || tagEnde <= tagBeginn) return 'Fehler: tag_beginn und tag_ende im Format HH:MM, Ende nach Beginn.'
  let vorschlag: { von: number; bis: number; tag: string } | null = null
  if (input?.vorschlag) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})$/.exec(String(input.vorschlag).trim())
    const tag = m ? gueltigerTag(m[1]) : null
    if (!m || !tag || +m[2] > 23 || +m[3] > 59) return 'Fehler: vorschlag im Format JJJJ-MM-TTTHH:MM (deutsche Zeit).'
    const von = berlin(tag.j, tag.mo, tag.t, +m[2] * 60 + +m[3])
    vorschlag = { von, bis: von + dauer * MINUTE, tag: m[1] }
  }
  const vonText = String(input?.von || vorschlag?.tag || k.heute).trim()
  const bisText = String(input?.bis || input?.von || vorschlag?.tag || k.heute).trim()
  const vonTag = gueltigerTag(vonText)
  const bisTag = gueltigerTag(bisText)
  if (!vonTag || !bisTag) return 'Fehler: von und bis im Format JJJJ-MM-TT.'
  const tage = Math.round((Date.UTC(bisTag.j, bisTag.mo - 1, bisTag.t) - Date.UTC(vonTag.j, vonTag.mo - 1, vonTag.t)) / TAG) + 1
  if (tage < 1) return 'Fehler: bis liegt vor von.'
  if (tage > 31) return 'Fehler: Höchstens 31 Tage auf einmal — bitte den Zeitraum verkleinern.'

  // Personen
  const { data: teamZeilen, error: teamFehler } = await supabase.from('mitarbeiter').select('name, email').eq('aktiv', true)
  if (teamFehler) return `Fehler beim Laden der Kollegen: ${teamFehler.message}`
  const team = ((teamZeilen ?? []) as { name: string | null; email: string | null }[])
    .filter((m) => m.email)
    .map((m) => ({ name: String(m.name ?? m.email), email: String(m.email).toLowerCase() }))
  const angaben: string[] = Array.isArray(input?.personen) ? input.personen.map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : []
  if (nurPrivat && angaben.length > 0) return 'Kalender von Kollegen zeigt der private Assistent nicht — dafür den Mayer-Assistenten nutzen.'
  const kollegen: { name: string; email: string }[] = []
  for (const angabe of angaben) {
    const n = norm(angabe)
    if (/^(ich|mir|mich|selbst)$/.test(n)) continue
    const treffer = team.filter((m) => m.email !== ich && (norm(m.name) === n || norm(m.name).split(' ').includes(n) || norm(m.name).includes(n)))
    if (treffer.length !== 1) {
      return `Fehler: „${angabe}“ ist kein eindeutiger Kollege. Aktive Kollegen: ${team.filter((m) => m.email !== ich).map((m) => m.name).join(', ')}.`
    }
    if (!kollegen.some((x) => x.email === treffer[0].email)) kollegen.push(treffer[0])
  }
  const mitMir = input?.ohne_mich !== true || kollegen.length === 0
  const personen = [...(mitMir ? [{ name: 'du', email: ich }] : []), ...kollegen]
  const nameVon = (email: string) => personen.find((p) => p.email === email)?.name ?? email

  // Zeitraum (UTC)
  const fensterVon = berlin(vonTag.j, vonTag.mo, vonTag.t)
  const fensterBis = berlin(bisTag.j, bisTag.mo, bisTag.t + 1)
  const abfrageVon = Math.min(fensterVon, vorschlag?.von ?? fensterVon)
  const abfrageBis = Math.max(fensterBis, vorschlag?.bis ?? fensterBis)

  // Sichtbarkeit der Kollegen
  const emails = personen.map((p) => p.email)
  const { data: einstZeilen } = await supabase.from('kalender_einstellungen').select('email, sichtbar').in('email', emails)
  const verborgen = new Set(((einstZeilen ?? []) as { email: string; sichtbar: boolean | null }[]).filter((e) => e.sichtbar === false).map((e) => String(e.email).toLowerCase()))
  const darfSehen = (email: string) => email === ich || !verborgen.has(email)

  const belegungen: Belegung[] = []

  // CRM-Termine
  // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage).
  const { data: terminZeilen, error: terminFehler } = await alleZeilen(() =>
    supabase
      .from('termine')
      .select('id, titel, beginn, ende, ganztags, besitzer_email, teilnehmer, ms_id, kunde_bereich')
      .lt('beginn', new Date(abfrageBis).toISOString())
      .gt('ende', new Date(abfrageVon).toISOString())
      .order('beginn'),
  )
  if (terminFehler) return `Fehler beim Laden der Termine: ${terminFehler.message}`
  for (const t of (terminZeilen ?? []) as TerminZeile[]) {
    const beteiligte = [String(t.besitzer_email ?? '').toLowerCase(), ...(t.teilnehmer ?? []).map((x) => String(x).toLowerCase())]
    const mitIch = beteiligte.includes(ich)
    for (const p of personen) {
      if (!beteiligte.includes(p.email)) continue
      if (p.email !== ich) {
        // Wie kalender_belegt — außer der Termin ist gemeinsam mit dem Fragenden gebucht.
        if (!mitIch && (!darfSehen(p.email) || t.ms_id || t.kunde_bereich === 'privat')) continue
      }
      // Privater Assistent: Termine mit Kollegen belegen trotzdem, aber ohne Titel.
      const titel = mitIch && !(nurPrivat && (t.teilnehmer ?? []).length > 0) ? `„${String(t.titel ?? '').trim() || 'Termin'}“` : 'belegt'
      belegungen.push({ von: Date.parse(t.beginn), bis: Date.parse(t.ende), person: p.email, text: titel, ganztags: !!t.ganztags, sperrt: false })
    }
  }

  // Eigener Kalender (kalender_fremd)
  const { data: fremdZeilen } = await supabase.from('kalender_fremd').select('email, belegt, stand, fehler').in('email', emails)
  const quellen: string[] = []
  for (const f of (fremdZeilen ?? []) as { email: string; belegt: { b: string; e: string; g?: boolean; a?: boolean }[] | null; stand: string | null; fehler: string | null }[]) {
    const email = String(f.email).toLowerCase()
    if (!darfSehen(email)) continue
    for (const x of f.belegt ?? []) {
      const von = Date.parse(x.b)
      const bis = Date.parse(x.e)
      if (!(bis > abfrageVon && von < abfrageBis)) continue
      belegungen.push({ von, bis, person: email, text: 'belegt im eigenen Kalender', ganztags: !!x.g, sperrt: !!x.a })
    }
    const wer = email === ich ? 'Dein eigener Kalender' : `Eigener Kalender von ${nameVon(email)}`
    const stand = f.stand ? `Stand ${STAND.format(new Date(f.stand))} Uhr` : 'noch nie gelesen'
    if (f.fehler) quellen.push(`${wer}: zuletzt nicht lesbar (${f.fehler}) — ${stand}.`)
    else if (f.stand && jetzt - Date.parse(f.stand) > 6 * 3600000) quellen.push(`${wer}: ${stand} (älter als 6 Stunden).`)
  }

  const sperrend = belegungen.filter((b) => !b.ganztags || b.sperrt)
  const hinweisGanztags = belegungen.filter((b) => b.ganztags && !b.sperrt)

  const zeilen: string[] = []
  const wer = personen.map((p) => p.name).join(', ')

  // Bestimmten Vorschlag prüfen
  if (vorschlag) {
    const tag = gueltigerTag(vorschlag.tag)!
    const kopf = `Vorschlag ${tagText(tag.j, tag.mo, tag.t)}, ${uhr(vorschlag.von)}–${uhr(vorschlag.bis)} Uhr`
    const konflikte = sperrend.filter((b) => b.von < vorschlag!.bis && b.bis > vorschlag!.von)
    if (vorschlag.von < jetzt) zeilen.push(`${kopf}: liegt in der Vergangenheit.`)
    else if (konflikte.length === 0) zeilen.push(`${kopf}: frei (${wer}).`)
    else {
      zeilen.push(`${kopf}: überschneidet sich mit`)
      for (const b of konflikte) {
        zeilen.push(`- ${nameVon(b.person)}: ${b.text}, ${b.ganztags ? 'ganztägig' : `${uhr(b.von)}–${uhr(b.bis)} Uhr`}`)
      }
    }
    const ganzAmTag = hinweisGanztags.filter((b) => b.von < vorschlag!.bis && b.bis > vorschlag!.von)
    for (const b of ganzAmTag) zeilen.push(`Hinweis: ${nameVon(b.person)} hat an dem Tag einen ganztägigen Eintrag (${b.text}).`)
    zeilen.push('')
  }

  // Freie Zeiten je Tag
  const dauerMs = dauer * MINUTE
  const fruehestens = Math.ceil(jetzt / (15 * MINUTE)) * 15 * MINUTE
  zeilen.push(`Freie Zeiten (mindestens ${dauer} Min., ${p2(Math.floor(tagBeginn / 60))}:${p2(tagBeginn % 60)}–${p2(Math.floor(tagEnde / 60))}:${p2(tagEnde % 60)} Uhr) für ${wer}:`)
  let ausgelassen = 0
  let irgendwas = false
  for (let i = 0; i < tage; i++) {
    const d = new Date(Date.UTC(vonTag.j, vonTag.mo - 1, vonTag.t + i))
    const j = d.getUTCFullYear()
    const mo = d.getUTCMonth() + 1
    const t = d.getUTCDate()
    const wtag = d.getUTCDay()
    if (input?.wochenende !== true && (wtag === 0 || wtag === 6)) {
      ausgelassen++
      continue
    }
    const von = Math.max(berlin(j, mo, t, tagBeginn), fruehestens)
    const bis = berlin(j, mo, t, tagEnde)
    const tagKey = `${j}-${p2(mo)}-${p2(t)}`
    const ganz = hinweisGanztags.filter((b) => berlinTagVon(b.von) <= tagKey && berlinTagVon(b.bis - 1) >= tagKey)
    const ganzText = ganz.length > 0 ? ` (ganztägig: ${[...new Set(ganz.map((b) => `${nameVon(b.person)} – ${b.text}`))].join('; ')})` : ''
    if (bis <= von) {
      if (bis > jetzt - TAG) zeilen.push(`${tagText(j, mo, t)}: vorbei`)
      continue
    }
    const frei = freieAbschnitte(von, bis, sperrend, dauerMs)
    if (frei.length > 0) irgendwas = true
    zeilen.push(`${tagText(j, mo, t)}: ${frei.length > 0 ? frei.map(([a, b]) => `${uhr(a)}–${uhr(b)}`).join(', ') : 'nichts frei'}${ganzText}`)
  }
  if (ausgelassen > 0) zeilen.push(`(${ausgelassen} Tag(e) Wochenende ausgelassen.)`)
  if (!irgendwas) zeilen.push('Im Zeitraum ist keine passende Lücke frei — einen anderen Zeitraum oder kürzere Dauer versuchen.')

  for (const p of personen) if (!darfSehen(p.email)) quellen.push(`${p.name} zeigt Kollegen den Kalender nicht — nur gemeinsam gebuchte Termine sind berücksichtigt.`)
  if (quellen.length > 0) zeilen.push('', ...quellen)
  return zeilen.join('\n').trim()
}
