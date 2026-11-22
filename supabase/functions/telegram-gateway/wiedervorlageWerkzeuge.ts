// Assistent-Werkzeuge für Wiedervorlagen (Tabelle wiedervorlagen, 20.11.2026; Oberfläche: Reiter
// „Wiedervorlagen“ in jeder Akte und Übersicht im CRM, src/lib/wiedervorlagen.ts).
//
// Eine Wiedervorlage gehört immer zu einer Kundenakte und trägt deren Bereich. Viele entstehen und
// erledigen sich von selbst über Regeln in der Datenbank (Statuswechsel der Akte, Kostenvoranschlag,
// Unterlagen angefordert/erhalten, Rechnung, Termin, Unterschrift; Katalog wiedervorlage_regeln) —
// quelle 'regel'. Von Hand angelegte tragen quelle 'hand'. Private Kontakte (bereich "privat") haben
// keine Wiedervorlagen. Das alte einzelne Follow-up (kunden.follow_up) ist davon getrennt.
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregel der
// Datenbank nach: darf_bereich(bereich) der Zeile → darfBereich. Löschen gibt es hier bewusst nicht.

import { alsIso, ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { darfAkte, darfBereich, istEigene, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type WvKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const WV_WERKZEUGE = [
  {
    name: 'wiedervorlagen_auflisten',
    description:
      'Listet offene Wiedervorlagen aus den Kundenakten mit Fälligkeit, Akte, Titel, Zuständigem und ob sie automatisch vom CRM angelegt wurde. Für Fragen wie „Was ist heute fällig?“, „Welche Wiedervorlagen habe ich diese Woche?“, „Was liegt bei Akte X noch an?“. Überfälliges ist immer dabei. Liefert die IDs für wiedervorlage_erledigen und wiedervorlage_verschieben.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Nur die Wiedervorlagen dieser Akte (dann ohne Angabe von tage alle offenen dieser Akte).' },
        nur_faellig: { type: 'boolean', description: 'true = nur heute fällige und überfällige.' },
        zustaendig: { type: 'string', description: 'Name oder Vorname des Zuständigen, z. B. "Quirin"; "ich" für den Fragenden selbst.' },
        tage: { type: 'integer', minimum: 0, maximum: 365, description: 'Wie viele Tage vorausschauen (Vorgabe 7). Überfälliges zählt immer dazu.' },
      },
    },
  },
  {
    name: 'wiedervorlage_anlegen',
    description:
      'Legt von Hand eine Wiedervorlage in einer Kundenakte an („Leg mir eine Wiedervorlage an: Akte X am Freitag nachfassen“). Bereich und Zuständiger kommen aus der Akte. Nicht für private Kontakte. Viele Wiedervorlagen legt das CRM selbst an — vorher mit wiedervorlagen_auflisten (kunde_id) prüfen, ob es schon eine passende gibt.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen ermitteln).' },
        titel: { type: 'string', description: 'Was zu tun ist, kurz, z. B. "Wegen Unterlagen nachfassen".' },
        faellig: { type: 'string', description: 'Fälligkeit als JJJJ-MM-TT (z. B. 2026-11-27).' },
        notiz: { type: 'string', description: 'Optional: Zusatz.' },
      },
      required: ['kunde_id', 'titel', 'faellig'],
    },
  },
  {
    name: 'wiedervorlage_erledigen',
    description: 'Hakt eine offene Wiedervorlage ab, wenn der Mitarbeiter sagt, dass sie erledigt ist. Die id kommt aus wiedervorlagen_auflisten.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'ID der Wiedervorlage (beginnt meist mit wv_).' } },
      required: ['id'],
    },
  },
  {
    name: 'wiedervorlage_verschieben',
    description: 'Verschiebt eine offene Wiedervorlage auf ein neues Fälligkeitsdatum („schieb das auf nächsten Montag“). Die id kommt aus wiedervorlagen_auflisten.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID der Wiedervorlage.' },
        faellig: { type: 'string', description: 'Neue Fälligkeit als JJJJ-MM-TT.' },
      },
      required: ['id', 'faellig'],
    },
  },
]

export function istWvWerkzeug(name: string): boolean {
  return WV_WERKZEUGE.some((w) => w.name === name)
}

export type WvZeile = {
  id: string
  kunde_id: string
  bereich: string
  regel: string | null
  titel: string
  notiz: string | null
  faellig: string
  verantwortlich: string | null
  quelle: string
  erledigt_am: string | null
}

const WV_SPALTEN = 'id, kunde_id, bereich, regel, titel, notiz, faellig, verantwortlich, quelle, erledigt_am'

/** Darf der Mitarbeiter diese Wiedervorlage sehen und ändern? Wie die Zeilenregel darf_bereich(bereich); privat nie. */
export function darfWv(m: RechteMitarbeiter, wv: { bereich?: string | null }): boolean {
  return darfBereich(m, wv.bereich)
}

/** Datum aus JJJJ-MM-TT oder TT.MM.JJJJ, nur wenn es den Tag wirklich gibt; sonst undefined. */
export function pruefeDatum(v: unknown): string | undefined {
  const iso = alsIso(String(v ?? ''))
  if (!iso) return undefined
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso
}

export function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

export function deDatum(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

type Akte = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich: string | null; verantwortlich_email: string | null }

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

async function aktenNamen(supabase: Supa, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const eindeutig = [...new Set(ids.filter(Boolean))]
  if (!eindeutig.length) return map
  const { data } = await supabase.from('kunden').select('id, firma, ansprechpartner').in('id', eindeutig)
  for (const a of data ?? []) map.set(a.id, akteName(a))
  return map
}

function zeileText(w: WvZeile, akten: Map<string, string>, heute: string): string {
  const lage = w.faellig < heute ? ' (überfällig)' : w.faellig === heute ? ' (heute)' : ''
  const teile = [`${deDatum(w.faellig)}${lage}`, w.titel, `Akte: ${akten.get(w.kunde_id) ?? w.kunde_id}`, w.quelle === 'regel' ? 'automatisch' : 'von Hand']
  if (w.verantwortlich) teile.push(`zuständig: ${w.verantwortlich}`)
  if (w.notiz) teile.push(`Notiz: ${w.notiz.slice(0, 200)}`)
  return `- ${teile.join(' | ')} (id=${w.id})`
}

/** Lädt eine Wiedervorlage samt Rechteprüfung. Fremde Bereiche: Hinweis ohne Inhalt. */
async function ladeWv(supabase: Supa, m: RechteMitarbeiter & { name: string }, id: string): Promise<{ wv?: WvZeile; fehler?: string }> {
  if (!id) return { fehler: 'Fehler: id fehlt. Ermittle sie mit wiedervorlagen_auflisten.' }
  const { data, error } = await supabase.from('wiedervorlagen').select(WV_SPALTEN).eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden: ${error.message}` }
  if (!data) return { fehler: 'Fehler: Diese Wiedervorlage gibt es nicht. Ermittle die id mit wiedervorlagen_auflisten.' }
  if (m.nurPrivat === true) return { fehler: 'Fehler: Diese Wiedervorlage gibt es nicht.' }
  if (!darfWv(m, data)) return { fehler: nichtFreigegeben(data.bereich, m.name) }
  return { wv: data }
}

// deno-lint-ignore no-explicit-any
export async function fuehreWvWerkzeugAus(name: string, input: any, k: WvKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k

  if (name === 'wiedervorlagen_auflisten') {
    if (mitarbeiter.nurPrivat === true) return 'Private Kontakte haben keine Wiedervorlagen.'
    const kundeId = String(input?.kunde_id ?? '').trim()
    const tageRoh = input?.tage === null || input?.tage === undefined || input?.tage === '' ? NaN : Number(input.tage)
    const tageAngabe = Number.isFinite(tageRoh) ? Math.max(0, Math.min(365, Math.round(tageRoh))) : undefined
    // Mit Akte und ohne tage: alle offenen dieser Akte. Sonst Vorschau von tage (Vorgabe 7) Tagen.
    const bis = input?.nur_faellig === true ? heute : kundeId && tageAngabe === undefined ? undefined : plusTage(heute, tageAngabe ?? 7)
    if (kundeId) {
      const { data: akte } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
      if (!akte) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
      if (istPrivat(akte)) return istEigene(mitarbeiter, akte.verantwortlich_email) ? 'Private Kontakte haben keine Wiedervorlagen.' : 'Fehler: Diese Akte gibt es für dich nicht.'
      if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
    }
    // Seitenweise: offene Wiedervorlagen können mehr als 1000 werden (Grenze der Datenbank je Abfrage).
    const baue = () => {
      let q = supabase.from('wiedervorlagen').select(WV_SPALTEN).is('erledigt_am', null)
      if (kundeId) q = q.eq('kunde_id', kundeId)
      if (bis) q = q.lte('faellig', bis)
      return q.order('faellig', { ascending: true })
    }
    const { data, error } = await alleZeilen(baue)
    if (error) return `Fehler beim Laden: ${error.message}`
    let liste: WvZeile[] = ((data ?? []) as WvZeile[]).filter((w) => darfWv(mitarbeiter, w))

    let werText = ''
    const gefragt = String(input?.zustaendig ?? '').trim()
    if (gefragt) {
      const { data: team } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
      const namen = personenNamen(((team ?? []) as { name: string }[]).map((t) => t.name).filter(Boolean))
      const ich = /^(ich|mir|mich|meine?|selbst)$/i.test(gefragt)
      const personen = ich ? [mitarbeiter.name] : ordneZu(gefragt, namen).personen
      if (personen.length) {
        liste = liste.filter((w) => {
          const z = ordneZu(w.verantwortlich, namen).personen
          return personen.some((p) => z.includes(p) || String(w.verantwortlich ?? '').trim().toLowerCase() === p.toLowerCase())
        })
        werText = `, zuständig: ${personen.join(', ')}`
      } else {
        const t = gefragt.toLowerCase()
        liste = liste.filter((w) => String(w.verantwortlich ?? '').toLowerCase().includes(t))
        werText = `, zuständig enthält „${gefragt}“ (kein eindeutiger Mitarbeiter)`
      }
    }

    liste.sort((a, b) => a.faellig.localeCompare(b.faellig) || a.titel.localeCompare(b.titel, 'de'))
    const zeitraum = input?.nur_faellig === true ? 'heute fällig oder überfällig' : bis ? `fällig bis ${deDatum(bis)} (inkl. überfällig)` : 'alle offenen'
    const kopfBasis = `Heute: ${deDatum(heute)}. Offene Wiedervorlagen, ${zeitraum}${werText}`
    if (!liste.length) return `${kopfBasis}: keine.`
    const ueber = liste.filter((w) => w.faellig < heute).length
    const heuteAnz = liste.filter((w) => w.faellig === heute).length
    const akten = await aktenNamen(supabase, liste.map((w) => w.kunde_id))
    const max = 60
    const gezeigt = liste.slice(0, max)
    return [
      `${kopfBasis}: ${liste.length}${ueber ? `, davon ${ueber} überfällig` : ''}${heuteAnz ? `, ${heuteAnz} heute fällig` : ''}. „automatisch“ = vom CRM selbst angelegt.`,
      ...gezeigt.map((w) => zeileText(w, akten, heute)),
      liste.length > max ? `… und ${liste.length - max} weitere (eingrenzen oder im CRM ansehen).` : '',
    ].filter(Boolean).join('\n').slice(0, 16000)
  }

  if (name === 'wiedervorlage_anlegen') {
    const kundeId = String(input?.kunde_id ?? '').trim()
    const titel = String(input?.titel ?? '').replace(/\s+/g, ' ').trim()
    if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
    if (!titel) return 'Fehler: titel fehlt.'
    const faellig = pruefeDatum(input?.faellig)
    if (!faellig) return 'Fehler: faellig ist kein gültiges Datum (JJJJ-MM-TT).'
    const { data: akte, error: akteFehler } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (akteFehler) return `Fehler beim Laden der Akte: ${akteFehler.message}`
    if (!akte) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    if (istPrivat(akte) || mitarbeiter.nurPrivat === true) {
      return darfAkte(mitarbeiter, akte) ? 'Private Kontakte haben keine Wiedervorlagen. Nimm dafür todo_anlegen (eigene To-do-Liste).' : 'Fehler: Diese Akte gibt es für dich nicht.'
    }
    if (SAMMELAKTEN.includes(akte.id)) return 'Fehler: In den Sammelakten (Ungeklärte Eingänge, Intern) gibt es keine Wiedervorlagen. Ordne die Sache erst einer echten Akte zu oder nimm todo_anlegen.'
    if (!darfAkte(mitarbeiter, akte) || !darfWv(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
    const zeile = {
      kunde_id: akte.id,
      bereich: akte.bereich,
      titel: titel.slice(0, 300),
      faellig,
      notiz: String(input?.notiz ?? '').trim() || null,
      verantwortlich: String(akte.verantwortlich ?? '').trim() || null,
      quelle: 'hand',
      erstellt_von: mitarbeiter.name,
    }
    const { data, error } = await supabase.from('wiedervorlagen').insert(zeile).select('id').single()
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    protokolliere(`Wiedervorlage „${zeile.titel}“ zum ${deDatum(faellig)} in der Akte von ${akteName(akte)} angelegt`)
    const hinweis = faellig < heute ? ' Achtung: Das Datum liegt in der Vergangenheit, sie ist damit schon überfällig.' : ''
    return `Angelegt: Wiedervorlage „${zeile.titel}“ zum ${deDatum(faellig)} in der Akte von ${akteName(akte)}${zeile.verantwortlich ? `, zuständig ${zeile.verantwortlich}` : ', ohne Zuständigen (in der Akte ist keiner eingetragen)'}. Im CRM im Reiter „Wiedervorlagen“ der Akte.${hinweis} id=${data?.id ?? ''}`
  }

  if (name === 'wiedervorlage_erledigen' || name === 'wiedervorlage_verschieben') {
    const r = await ladeWv(supabase, mitarbeiter, String(input?.id ?? '').trim())
    if (r.fehler) return r.fehler
    const wv = r.wv!
    if (wv.erledigt_am) return `Diese Wiedervorlage („${wv.titel}“) ist schon erledigt.`
    const akten = await aktenNamen(supabase, [wv.kunde_id])
    const akte = akten.get(wv.kunde_id) ?? wv.kunde_id

    if (name === 'wiedervorlage_erledigen') {
      const { error } = await supabase.from('wiedervorlagen').update({ erledigt_am: new Date().toISOString(), erledigt_von: mitarbeiter.name, erledigt_grund: null }).eq('id', wv.id)
      if (error) return `Fehler beim Speichern: ${error.message}`
      protokolliere(`Wiedervorlage „${wv.titel}“ (Akte ${akte}) erledigt`)
      return `Erledigt: „${wv.titel}“ in der Akte von ${akte}.`
    }

    const faellig = pruefeDatum(input?.faellig)
    if (!faellig) return 'Fehler: faellig ist kein gültiges Datum (JJJJ-MM-TT).'
    if (faellig === wv.faellig) return `„${wv.titel}“ ist schon zum ${deDatum(faellig)} fällig.`
    const { error } = await supabase.from('wiedervorlagen').update({ faellig }).eq('id', wv.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`Wiedervorlage „${wv.titel}“ (Akte ${akte}) auf ${deDatum(faellig)} verschoben`)
    return `Verschoben: „${wv.titel}“ in der Akte von ${akte} vom ${deDatum(wv.faellig)} auf den ${deDatum(faellig)}.${faellig < heute ? ' Achtung: Das Datum liegt in der Vergangenheit.' : ''}`
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
