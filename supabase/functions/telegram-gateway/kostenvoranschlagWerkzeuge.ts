// Assistent-Werkzeuge für Kostenvoranschläge (Tabelle kostenvoranschlaege, Wunsch von Eray am
// 20.11.2026; Oberfläche: /kostenvoranschlaege und Reiter in jeder Akte, src/lib/kostenvoranschlaege.ts).
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet darfKv die Zeilenregeln der
// Datenbank nach: Einträge ohne Bereich sehen alle, sonst nur wer den Bereich darf; private Einträge
// (bereich "privat" / privat_besitzer) nur ihr Besitzer — auch nicht Geschäftsführung oder Admins.
// Beim Zuordnen zu einer Akte übernimmt der Eintrag deren Bereich und bei privaten Akten den Besitzer.
// Die Sammelakten (Ungeklärte Eingänge, Intern) geben keinen Bereich vor.
//
// Löschen gibt es hier bewusst nicht (nur in der Oberfläche mit Rückfrage).

import { darfAkte, darfBereich, istEigene, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type KvKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

const STATUS = ['offen', 'angenommen', 'abgelehnt', 'bezahlt'] as const
type Status = (typeof STATUS)[number]
const STATUS_NAME: Record<Status, string> = { offen: 'offen', angenommen: 'angenommen', abgelehnt: 'abgelehnt', bezahlt: 'bezahlt' }

const EINTRAG_FELDER = {
  name: { type: 'string', description: 'Für wen bzw. von wem (Name so wie notiert, Abkürzungen nicht raten).' },
  beschreibung: { type: 'string', description: 'Worum es geht, z. B. "Küche, Bad", "Fenster", "Dach". Optional.' },
  betrag: { type: 'number', description: 'Betrag in Euro als Zahl (3850 für 3.850 €). Weglassen, wenn keiner genannt ist.' },
  status: { type: 'string', enum: [...STATUS], description: 'offen (Vorgabe), angenommen, abgelehnt oder bezahlt ("bez." auf einem Zettel = bezahlt).' },
  datum: { type: 'string', description: 'Datum JJJJ-MM-TT (z. B. vom Zettel); ohne Angabe heute.' },
  notiz: { type: 'string', description: 'Optional: Zusatz, z. B. unsichere Lesung.' },
}

export const KV_WERKZEUGE = [
  {
    name: 'kostenvoranschlag_anlegen',
    description:
      'Legt einen oder mehrere Kostenvoranschläge an (CRM-Seite „Kostenvoranschläge“ und Reiter in der Akte). Nimm es, wenn jemand Kostenvoranschläge erfassen will oder ein Foto/Dokument mit einer Liste von Kostenvoranschlägen schickt und sie eingetragen haben möchte — jede Zeile ein Eintrag. Mit kunde_id landen sie in dieser Akte (Bereich und bei privaten Akten der Besitzer werden übernommen), ohne kunde_id stehen sie ohne Akte in der Übersicht. Summen- oder Zwischensummenzeilen nicht als Eintrag anlegen.',
    input_schema: {
      type: 'object',
      properties: {
        eintraege: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: EINTRAG_FELDER, required: ['name'] } },
        kunde_id: { type: 'string', description: 'Optional: Akte, zu der alle Einträge gehören.' },
        privat: {
          type: 'boolean',
          description: 'Nur ohne kunde_id: true = private Einträge, die nur der Mitarbeiter selbst sieht (z. B. wenn er im Bereich Privat arbeitet oder es um seine privaten Geschäfte geht). Ohne Angabe sehen alle Mitarbeiter die Einträge.',
        },
        quelle: { type: 'string', description: 'Optional: Herkunft, z. B. "Notizzettel vom 17.11.2026 (Foto per Telegram)".' },
      },
      required: ['eintraege'],
    },
  },
  {
    name: 'kostenvoranschlaege_auflisten',
    description: 'Listet Kostenvoranschläge mit Betrag, Status und Akte, dazu Summen. Optional gefiltert nach Suchbegriff (Name, Beschreibung, Notiz), Status oder Akte. Liefert die IDs für kostenvoranschlag_aendern.',
    input_schema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string' },
        status: { type: 'string', enum: [...STATUS] },
        kunde_id: { type: 'string', description: 'Nur die einer Akte.' },
        ohne_akte: { type: 'boolean', description: 'Nur die, die noch keiner Akte zugeordnet sind.' },
      },
    },
  },
  {
    name: 'kostenvoranschlag_aendern',
    description:
      'Ändert einen vorhandenen Kostenvoranschlag: Status (z. B. bezahlt), Betrag, Name, Beschreibung, Datum, Notiz, oder ordnet ihn einer Akte zu (kunde_id; leer = Zuordnung lösen). Mit kv_id (aus kostenvoranschlaege_auflisten) oder Suchbegriff; bei mehreren Treffern kommt eine Liste zum Nachfragen. Nur Felder angeben, die sich ändern.',
    input_schema: {
      type: 'object',
      properties: {
        kv_id: { type: 'string' },
        suchbegriff: { type: 'string' },
        ...EINTRAG_FELDER,
        kunde_id: { type: 'string', description: 'Akte zuordnen; leerer Text = keiner Akte mehr zugeordnet.' },
      },
    },
  },
]

export function istKvWerkzeug(name: string): boolean {
  return KV_WERKZEUGE.some((w) => w.name === name)
}

type KvZeile = {
  id: string
  kunde_id: string | null
  bereich: string | null
  privat_besitzer: string | null
  name: string
  beschreibung: string | null
  betrag: number | string | null
  status: string
  datum: string | null
  notiz: string | null
}

/** Darf der Mitarbeiter diesen Eintrag sehen/ändern? (Nachbildung der Zeilenregeln.) */
export function darfKv(m: RechteMitarbeiter, kv: Pick<KvZeile, 'bereich' | 'privat_besitzer'>): boolean {
  if (kv.privat_besitzer || kv.bereich === 'privat') return istEigene(m, kv.privat_besitzer)
  if (!kv.bereich || kv.bereich === 'intern') return true
  return darfBereich(m, kv.bereich)
}

type Akte = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }

/** bereich/privat_besitzer, die zu einer Akte gehören. */
export function zuordnungVon(akte: Akte | null): { kunde_id: string | null; bereich: string | null; privat_besitzer: string | null } {
  if (!akte) return { kunde_id: null, bereich: null, privat_besitzer: null }
  if (SAMMELAKTEN.includes(akte.id)) return { kunde_id: akte.id, bereich: null, privat_besitzer: null }
  const privat = akte.bereich === 'privat'
  return { kunde_id: akte.id, bereich: akte.bereich, privat_besitzer: privat ? String(akte.verantwortlich_email ?? '').trim().toLowerCase() || null : null }
}

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

export function euro(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`
}

function zahl(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined
}

function datum(v: unknown, heute: string): string | null {
  const s = String(v ?? '').trim()
  if (!s) return heute
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return heute
}

function zeileText(k: KvZeile, akten: Map<string, string>): string {
  const betrag = k.betrag === null || k.betrag === undefined || k.betrag === '' ? 'ohne Betrag' : euro(Number(k.betrag))
  const teile = [`${k.name}${k.beschreibung ? ` – ${k.beschreibung}` : ''}`, betrag, STATUS_NAME[k.status as Status] ?? k.status]
  if (k.datum) teile.push(k.datum.split('-').reverse().join('.'))
  teile.push(k.kunde_id ? `Akte: ${akten.get(k.kunde_id) ?? k.kunde_id}` : 'ohne Akte')
  if (k.notiz) teile.push(`Notiz: ${k.notiz}`)
  return `- ${teile.join(' | ')} (kv_id=${k.id})`
}

async function ladeAkte(supabase: Supa, m: RechteMitarbeiter & { name: string }, kundeId: string): Promise<{ akte?: Akte; fehler?: string }> {
  const { data, error } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden der Akte: ${error.message}` }
  if (!data) return { fehler: 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.' }
  if (!darfAkte(m, data)) return { fehler: data.bereich === 'privat' ? 'Fehler: Diese Akte gibt es für dich nicht.' : nichtFreigegeben(data.bereich, m.name) }
  return { akte: data }
}

async function aktenNamen(supabase: Supa, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const eindeutig = [...new Set(ids.filter(Boolean))]
  if (!eindeutig.length) return map
  const { data } = await supabase.from('kunden').select('id, firma, ansprechpartner').in('id', eindeutig)
  for (const a of data ?? []) map.set(a.id, akteName(a))
  return map
}

// deno-lint-ignore no-explicit-any
export async function fuehreKvWerkzeugAus(name: string, input: any, k: KvKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k

  if (name === 'kostenvoranschlag_anlegen') {
    const liste = Array.isArray(input?.eintraege) ? input.eintraege : []
    if (!liste.length) return 'Fehler: eintraege ist leer.'
    if (liste.length > 100) return 'Fehler: höchstens 100 Einträge auf einmal.'
    let akte: Akte | null = null
    const kundeId = String(input?.kunde_id ?? '').trim()
    if (kundeId) {
      const r = await ladeAkte(supabase, mitarbeiter, kundeId)
      if (r.fehler) return r.fehler
      akte = r.akte!
    }
    const zuordnung = zuordnungVon(akte)
    if (!akte && input?.privat === true) {
      if (!mitarbeiter.email) return 'Fehler: Private Einträge gehen nur mit hinterlegter E-Mail-Adresse des Mitarbeiters.'
      zuordnung.bereich = 'privat'
      zuordnung.privat_besitzer = String(mitarbeiter.email).trim().toLowerCase()
    }
    const quelle = String(input?.quelle ?? '').trim() || 'Über den Assistenten erfasst'
    const zeilen = []
    for (const e of liste) {
      const n = String(e?.name ?? '').replace(/\s+/g, ' ').trim()
      if (!n) return 'Fehler: Jeder Eintrag braucht einen Namen.'
      const status: Status = STATUS.includes(e?.status) ? e.status : 'offen'
      zeilen.push({
        id: `kv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        name: n.slice(0, 200),
        beschreibung: String(e?.beschreibung ?? '').trim() || null,
        betrag: zahl(e?.betrag) ?? null,
        status,
        datum: datum(e?.datum, heute),
        notiz: String(e?.notiz ?? '').trim() || null,
        quelle,
        erstellt_von: mitarbeiter.name,
        ...zuordnung,
      })
    }
    const { error } = await supabase.from('kostenvoranschlaege').insert(zeilen)
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    const summe = zeilen.reduce((s, z) => s + (z.betrag ?? 0), 0)
    const ohne = zeilen.filter((z) => z.betrag === null).length
    const wo = akte ? `in der Akte von ${akteName(akte)}` : zuordnung.privat_besitzer ? 'ohne Akte, privat (nur für dich sichtbar)' : 'ohne Akte (für alle Mitarbeiter sichtbar)'
    protokolliere(`${zeilen.length} Kostenvoranschl${zeilen.length === 1 ? 'ag' : 'äge'} ${wo} angelegt`)
    return `Angelegt: ${zeilen.length} Kostenvoranschl${zeilen.length === 1 ? 'ag' : 'äge'} ${wo}, Summe ${euro(summe)}${ohne ? ` (${ohne} ohne Betrag)` : ''}. Im CRM unter „Kostenvoranschläge“${akte ? ' und im Reiter der Akte' : ''}. IDs: ${zeilen.map((z) => z.id).join(', ')}`
  }

  if (name === 'kostenvoranschlaege_auflisten') {
    let q = supabase.from('kostenvoranschlaege').select('id, kunde_id, bereich, privat_besitzer, name, beschreibung, betrag, status, datum, notiz').order('datum', { ascending: false, nullsFirst: false }).limit(500)
    const kundeId = String(input?.kunde_id ?? '').trim()
    if (kundeId) q = q.eq('kunde_id', kundeId)
    if (input?.ohne_akte === true) q = q.is('kunde_id', null)
    if (STATUS.includes(input?.status)) q = q.eq('status', input.status)
    const { data, error } = await q
    if (error) return `Fehler beim Laden: ${error.message}`
    const such = String(input?.suchbegriff ?? '').trim().toLowerCase()
    const liste: KvZeile[] = (data ?? []).filter((z: KvZeile) => darfKv(mitarbeiter, z)).filter((z: KvZeile) => !such || [z.name, z.beschreibung, z.notiz].some((t) => String(t ?? '').toLowerCase().includes(such)))
    if (!liste.length) return 'Keine passenden Kostenvoranschläge gefunden.'
    const akten = await aktenNamen(supabase, liste.map((z) => z.kunde_id ?? ''))
    const summe = (s?: Status) => liste.filter((z) => !s || z.status === s).reduce((a, z) => a + (z.betrag === null || z.betrag === '' ? 0 : Number(z.betrag)), 0)
    const kopf = `${liste.length} Kostenvoranschläge, Summe ${euro(summe())} (offen ${euro(summe('offen'))}, angenommen ${euro(summe('angenommen'))}, bezahlt ${euro(summe('bezahlt'))}).`
    const gezeigt = liste.slice(0, 60)
    return [kopf, ...gezeigt.map((z) => zeileText(z, akten)), liste.length > gezeigt.length ? `… und ${liste.length - gezeigt.length} weitere (Suchbegriff eingrenzen).` : ''].filter(Boolean).join('\n')
  }

  if (name === 'kostenvoranschlag_aendern') {
    const id = String(input?.kv_id ?? '').trim()
    const such = String(input?.suchbegriff ?? '').trim().toLowerCase()
    if (!id && !such) return 'Fehler: kv_id oder suchbegriff angeben.'
    const { data, error } = id
      ? await supabase.from('kostenvoranschlaege').select('*').eq('id', id)
      : await supabase.from('kostenvoranschlaege').select('*').limit(500)
    if (error) return `Fehler beim Laden: ${error.message}`
    const treffer: KvZeile[] = (data ?? [])
      .filter((z: KvZeile) => darfKv(mitarbeiter, z))
      .filter((z: KvZeile) => id || [z.name, z.beschreibung, z.notiz].some((t) => String(t ?? '').toLowerCase().includes(such)))
    if (!treffer.length) return 'Kein passender Kostenvoranschlag gefunden.'
    if (treffer.length > 1) {
      const akten = await aktenNamen(supabase, treffer.map((z) => z.kunde_id ?? ''))
      return `Mehrere Treffer, bitte nachfragen welcher gemeint ist:\n${treffer.slice(0, 20).map((z) => zeileText(z, akten)).join('\n')}`
    }
    const alt = treffer[0]
    // deno-lint-ignore no-explicit-any
    const neu: Record<string, any> = {}
    if (input?.name !== undefined && String(input.name).trim()) neu.name = String(input.name).replace(/\s+/g, ' ').trim().slice(0, 200)
    if (input?.beschreibung !== undefined) neu.beschreibung = String(input.beschreibung).trim() || null
    if (input?.betrag !== undefined) {
      const b = zahl(input.betrag)
      if (b === undefined) return 'Fehler: betrag ist keine Zahl.'
      neu.betrag = b
    }
    if (input?.status !== undefined) {
      if (!STATUS.includes(input.status)) return 'Fehler: status muss offen, angenommen, abgelehnt oder bezahlt sein.'
      neu.status = input.status
    }
    if (input?.datum !== undefined && String(input.datum).trim()) neu.datum = datum(input.datum, k.heute)
    if (input?.notiz !== undefined) neu.notiz = String(input.notiz).trim() || null
    let akteText = ''
    if (input?.kunde_id !== undefined) {
      const kid = String(input.kunde_id).trim()
      if (kid) {
        const r = await ladeAkte(supabase, mitarbeiter, kid)
        if (r.fehler) return r.fehler
        Object.assign(neu, zuordnungVon(r.akte!))
        akteText = ` und der Akte von ${akteName(r.akte!)} zugeordnet`
      } else if (alt.privat_besitzer || alt.bereich === 'privat') {
        // Ein privater Eintrag bleibt beim Lösen von der Akte privat.
        Object.assign(neu, { kunde_id: null, bereich: 'privat', privat_besitzer: alt.privat_besitzer })
        akteText = ' und von der Akte gelöst (bleibt privat)'
      } else {
        Object.assign(neu, zuordnungVon(null))
        akteText = ' und von der Akte gelöst'
      }
    }
    if (!Object.keys(neu).length) return 'Es wurde nichts zum Ändern angegeben.'
    neu.geaendert_am = new Date().toISOString()
    const { error: fehler } = await supabase.from('kostenvoranschlaege').update(neu).eq('id', alt.id)
    if (fehler) return `Fehler beim Speichern: ${fehler.message}`
    protokolliere(`Kostenvoranschlag „${alt.name}" geändert${akteText}`)
    const felder = Object.keys(neu).filter((f) => !['geaendert_am', 'kunde_id', 'bereich', 'privat_besitzer'].includes(f))
    return `Geändert: „${neu.name ?? alt.name}"${felder.length ? ` (${felder.join(', ')})` : ''}${akteText}. kv_id=${alt.id}`
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
