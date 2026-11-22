// Assistent-Werkzeuge für Seminartermine der Akademie (22.11.2026; Oberfläche: Akademie → Seminare und
// Seite /akademie/termine/:id, src/lib/seminarTermine.ts). Tabellen seminar_termine und seminar_anmeldungen.
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregel der
// Datenbank nach: darf_bereich('akademie') → darfBereich. Löschen gibt es hier bewusst nicht.
// Automatische Mails an Teilnehmer (Bestätigung, Warteliste, Erinnerung, Absage) merkt die Datenbank selbst
// vor, nur wenn die jeweilige Regel an ist.

import { darfBereich, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type SeminarKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const SEMINAR_WERKZEUGE = [
  {
    name: 'seminartermine_zeigen',
    description:
      'Listet Termine der Akademie-Seminare mit Datum, Ort, Status, belegten und freien Plätzen, Warteliste und ob die Anmeldung über das Internet offen ist. Für Fragen wie „Welche Seminare stehen an?“, „Wann ist das nächste Rhetorik-Seminar?“, „Ist der Termin am 3. Dezember schon voll?“. Ohne Angabe: kommende Termine. Liefert die IDs für teilnehmer_zeigen und teilnehmer_anmelden.',
    input_schema: {
      type: 'object',
      properties: {
        seminar: { type: 'string', description: 'Optional: Teil des Seminartitels oder Bereichs, z. B. "Rhetorik".' },
        vergangene: { type: 'boolean', description: 'true = auch vergangene Termine (sonst nur ab heute).' },
      },
    },
  },
  {
    name: 'seminartermin_anlegen',
    description:
      'Legt einen neuen Termin für ein Seminar aus dem Akademie-Katalog an („Leg einen Termin für Rhetorik am 3.12. um 9 Uhr in Ulm an, 12 Plätze“). Das Seminar per Titel (seminar) oder seminar_id angeben; passen mehrere, kommt eine Auswahl zurück. Die Anmeldung über das Internet ist zunächst aus (oeffentlich=false), außer der Mitarbeiter will es ausdrücklich.',
    input_schema: {
      type: 'object',
      properties: {
        seminar: { type: 'string', description: 'Titel oder Teil des Titels, z. B. "Rhetorik".' },
        seminar_id: { type: 'string', description: 'Kennung des Seminars (beginnt mit sem_), wenn bekannt.' },
        beginn: { type: 'string', description: 'Beginn in deutscher Zeit als JJJJ-MM-TTTHH:MM, z. B. 2026-12-03T09:00.' },
        ende: { type: 'string', description: 'Optional: Ende als JJJJ-MM-TTTHH:MM.' },
        ort: { type: 'string', description: 'Optional: Ort oder Adresse.' },
        online_link: { type: 'string', description: 'Optional: Zugang für eine Teilnahme online.' },
        plaetze: { type: 'integer', minimum: 1, maximum: 1000, description: 'Optional: Höchstzahl der Teilnehmer. Leer = unbegrenzt.' },
        preis: { type: 'number', minimum: 0, description: 'Optional: Preis netto in Euro je Teilnehmer. Leer = Preis aus dem Katalog.' },
        referent: { type: 'string', description: 'Optional: Referent.' },
        anmeldeschluss: { type: 'string', description: 'Optional: Anmeldeschluss als JJJJ-MM-TT (bis 23:59 Uhr) oder JJJJ-MM-TTTHH:MM.' },
        oeffentlich: { type: 'boolean', description: 'true = Anmeldung über den öffentlichen Link sofort möglich. Vorgabe false.' },
        verantwortlich: { type: 'string', description: 'Optional: Mitarbeiter, der die Anmeldungen betreut. Vorgabe: der Fragende.' },
      },
      required: ['beginn'],
    },
  },
  {
    name: 'teilnehmer_zeigen',
    description: 'Zeigt die Teilnehmerliste eines Seminartermins mit Status (angemeldet, bestätigt, Warteliste, storniert, teilgenommen), Kontaktdaten und ob über das Formular oder von Hand eingetragen. Die termin_id kommt aus seminartermine_zeigen.',
    input_schema: {
      type: 'object',
      properties: { termin_id: { type: 'string', description: 'ID des Termins.' } },
      required: ['termin_id'],
    },
  },
  {
    name: 'teilnehmer_anmelden',
    description:
      'Trägt von Hand einen Teilnehmer für einen Seminartermin ein („Melde Frau Muster für Rhetorik am 3.12. an“). Entweder mit kunde_id einer Akademie-Akte (mit kunden_suchen ermitteln; Name, E-Mail und Telefon kommen aus der Akte) oder frei mit name und möglichst email. Ist der Termin voll, kommt der Teilnehmer auf die Warteliste, außer status ist ausdrücklich angegeben.',
    input_schema: {
      type: 'object',
      properties: {
        termin_id: { type: 'string', description: 'ID des Termins (aus seminartermine_zeigen).' },
        kunde_id: { type: 'string', description: 'Optional: Akademie-Akte des Teilnehmers.' },
        name: { type: 'string', description: 'Name, wenn ohne Akte.' },
        firma: { type: 'string', description: 'Optional: Firma.' },
        email: { type: 'string', description: 'Optional: E-Mail-Adresse.' },
        telefon: { type: 'string', description: 'Optional: Telefon.' },
        status: { type: 'string', enum: ['angemeldet', 'bestaetigt', 'warteliste'], description: 'Optional: Stand der Anmeldung. Vorgabe angemeldet (bei vollem Termin Warteliste).' },
        notiz: { type: 'string', description: 'Optional: Notiz.' },
      },
      required: ['termin_id'],
    },
  },
]

export function istSeminarWerkzeug(name: string): boolean {
  return SEMINAR_WERKZEUGE.some((w) => w.name === name)
}

export const BELEGT = ['angemeldet', 'bestaetigt', 'teilgenommen']
const STATUS_NAME: Record<string, string> = { angemeldet: 'angemeldet', bestaetigt: 'bestätigt', warteliste: 'Warteliste', storniert: 'storniert', teilgenommen: 'teilgenommen' }
const TERMIN_NAME: Record<string, string> = { geplant: 'geplant', abgesagt: 'abgesagt', durchgefuehrt: 'durchgeführt' }
const ADRESSE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Versatz der deutschen Zeit gegenüber UTC zu einem Zeitpunkt, in Minuten (60 im Winter, 120 im Sommer). */
function berlinVersatz(utcMs: number): number {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  )
  const alsUtc = Date.UTC(Number(teile.year), Number(teile.month) - 1, Number(teile.day), Number(teile.hour), Number(teile.minute))
  return Math.round((alsUtc - Math.floor(utcMs / 60000) * 60000) / 60000)
}

/** "2026-12-03T09:00" (deutsche Zeit) → ISO in UTC; undefined, wenn kein gültiger Zeitpunkt. */
export function berlinZuIso(v: unknown, standardUhrzeit?: string): string | undefined {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/)
  if (!m) return undefined
  const uhr = m[4] !== undefined ? [Number(m[4]), Number(m[5])] : standardUhrzeit ? standardUhrzeit.split(':').map(Number) : undefined
  if (!uhr) return undefined
  const [j, mo, t] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const roh = Date.UTC(j, mo - 1, t, uhr[0], uhr[1])
  const probe = new Date(roh)
  if (probe.getUTCFullYear() !== j || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== t || uhr[0] > 23 || uhr[1] > 59) return undefined
  // Zweimal angleichen, damit es auch an den Tagen der Zeitumstellung stimmt.
  let utc = roh - berlinVersatz(roh) * 60000
  utc = roh - berlinVersatz(utc) * 60000
  return new Date(utc).toISOString()
}

const DATUM = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })
export function wann(beginn: string, ende?: string | null): string {
  const b = new Date(beginn)
  let t = `${DATUM.format(b)}, ${UHR.format(b)} Uhr`
  if (ende) {
    const e = new Date(ende)
    t += DATUM.format(e) === DATUM.format(b) ? ` bis ${UHR.format(e)} Uhr` : ` bis ${DATUM.format(e)}, ${UHR.format(e)} Uhr`
  }
  return t
}

const euro = (n: number) => `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const text = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

function keinZugang(m: SeminarKontext['mitarbeiter']): string | null {
  if (m.nurPrivat === true) return 'Seminartermine gibt es nur im Assistenten der Holding, nicht im privaten Assistenten.'
  if (!darfBereich(m, 'akademie')) return nichtFreigegeben('akademie', m.name)
  return null
}

// deno-lint-ignore no-explicit-any
type Termin = any

async function ladeTermin(supabase: Supa, id: string): Promise<{ t?: Termin; seminar?: { id: string; titel: string; preis_netto: number | null }; fehler?: string }> {
  if (!UUID.test(id)) return { fehler: 'Fehler: termin_id fehlt oder ist ungültig. Ermittle sie mit seminartermine_zeigen.' }
  const { data: t, error } = await supabase.from('seminar_termine').select('*').eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden: ${error.message}` }
  if (!t) return { fehler: 'Fehler: Diesen Termin gibt es nicht. Ermittle die termin_id mit seminartermine_zeigen.' }
  const { data: s } = await supabase.from('seminare').select('id, titel, preis_netto').eq('id', t.seminar_id).maybeSingle()
  return { t, seminar: s ?? { id: t.seminar_id, titel: t.seminar_id, preis_netto: null } }
}

async function anmeldungenVon(supabase: Supa, terminIds: string[]): Promise<Map<string, { status: string }[]>> {
  const map = new Map<string, { status: string }[]>()
  if (!terminIds.length) return map
  const { data } = await supabase.from('seminar_anmeldungen').select('id, termin_id, status').in('termin_id', terminIds)
  for (const a of (data ?? []) as { termin_id: string; status: string }[]) map.set(a.termin_id, [...(map.get(a.termin_id) ?? []), a])
  return map
}

/** Seminare einer Akte: Eintrag ergänzen oder von „interessiert“ auf „angemeldet“ heben (wie email-gateway/seminarAnmeldung.ts). */
export function seminareMit(liste: unknown, seminar: { id: string; titel: string }, stand: 'interessiert' | 'angemeldet' = 'angemeldet') {
  const alt = Array.isArray(liste) ? (liste as { id: string; titel: string; stand: string }[]).filter((x) => x && typeof x.id === 'string') : []
  const rang: Record<string, number> = { interessiert: 0, angemeldet: 1, teilgenommen: 2 }
  if (!alt.some((x) => x.id === seminar.id)) return [...alt, { id: seminar.id, titel: seminar.titel, stand }]
  return alt.map((x) => (x.id === seminar.id && (rang[x.stand] ?? 0) < rang[stand] ? { ...x, stand } : x))
}

// deno-lint-ignore no-explicit-any
export async function fuehreSeminarWerkzeugAus(name: string, input: any, k: SeminarKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const sperre = keinZugang(mitarbeiter)
  if (sperre) return sperre

  if (name === 'seminartermine_zeigen') {
    const { data: seminare } = await supabase.from('seminare').select('id, titel, bereich, preis_netto')
    const katalog = new Map(((seminare ?? []) as { id: string; titel: string; bereich: string; preis_netto: number | null }[]).map((s) => [s.id, s]))
    let q = supabase.from('seminar_termine').select('*')
    if (input?.vergangene !== true) q = q.gte('beginn', `${heute}T00:00:00Z`)
    const { data, error } = await q.order('beginn', { ascending: true }).limit(500)
    if (error) return `Fehler beim Laden: ${error.message}`
    let liste = (data ?? []) as Termin[]
    const such = text(input?.seminar, 100).toLowerCase()
    if (such) liste = liste.filter((t) => [katalog.get(t.seminar_id)?.titel, katalog.get(t.seminar_id)?.bereich].some((x) => String(x ?? '').toLowerCase().includes(such)))
    const kopf = `${input?.vergangene === true ? 'Alle' : 'Kommende'} Seminartermine${such ? ` zu „${such}“` : ''}`
    if (!liste.length) return `${kopf}: keine. Neue Termine legst du mit seminartermin_anlegen an.`
    const anm = await anmeldungenVon(supabase, liste.map((t) => t.id))
    const zeilen = liste.slice(0, 60).map((t) => {
      const a = anm.get(t.id) ?? []
      const belegt = a.filter((x) => BELEGT.includes(x.status)).length
      const warte = a.filter((x) => x.status === 'warteliste').length
      const s = katalog.get(t.seminar_id)
      const preis = t.preis ?? s?.preis_netto
      const teile = [
        wann(t.beginn, t.ende),
        `„${s?.titel ?? t.seminar_id}“`,
        TERMIN_NAME[t.status] ?? t.status,
        t.plaetze === null || t.plaetze === undefined ? `${belegt} angemeldet (ohne Begrenzung)` : `${belegt} von ${t.plaetze} Plätzen belegt${belegt >= t.plaetze ? ' (voll)' : `, ${t.plaetze - belegt} frei`}`,
      ]
      if (warte) teile.push(`${warte} auf der Warteliste`)
      if (t.ort) teile.push(`Ort: ${t.ort}`)
      if (t.online_link) teile.push('auch online')
      if (preis !== null && preis !== undefined) teile.push(`${euro(Number(preis))} netto`)
      if (t.referent) teile.push(`Referent: ${t.referent}`)
      teile.push(t.oeffentlich ? 'Anmeldung über das Internet offen' : 'nur Anmeldung von Hand')
      return `- ${teile.join(' | ')} (termin_id=${t.id})`
    })
    return [`${kopf}: ${liste.length}.`, ...zeilen, liste.length > 60 ? `… und ${liste.length - 60} weitere.` : ''].filter(Boolean).join('\n').slice(0, 16000)
  }

  if (name === 'seminartermin_anlegen') {
    // Seminar finden.
    const { data: seminare, error: sFehler } = await supabase.from('seminare').select('id, titel, bereich, preis_netto, dozent')
    if (sFehler) return `Fehler beim Laden des Katalogs: ${sFehler.message}`
    const katalog = (seminare ?? []) as { id: string; titel: string; bereich: string; preis_netto: number | null; dozent: string | null }[]
    let seminar = input?.seminar_id ? katalog.find((s) => s.id === String(input.seminar_id).trim()) : undefined
    if (!seminar) {
      const such = text(input?.seminar, 100).toLowerCase()
      if (!such) return 'Fehler: Welches Seminar? Gib seminar (Titel) oder seminar_id an.'
      const genau = katalog.filter((s) => s.titel.toLowerCase() === such)
      const treffer = genau.length ? genau : katalog.filter((s) => s.titel.toLowerCase().includes(such))
      if (!treffer.length) return `Fehler: Im Seminarkatalog gibt es kein Seminar „${such}“. Neue Seminare legt man im CRM unter Akademie → Seminare an.`
      if (treffer.length > 1) return `Mehrere Seminare passen — frag nach, welches gemeint ist, und gib dann seminar_id an:\n${treffer.slice(0, 15).map((s) => `- ${s.titel} (${s.bereich}) seminar_id=${s.id}`).join('\n')}`
      seminar = treffer[0]
    }
    const beginn = berlinZuIso(input?.beginn)
    if (!beginn) return 'Fehler: beginn ist kein gültiger Zeitpunkt (JJJJ-MM-TTTHH:MM, deutsche Zeit).'
    const ende = input?.ende ? berlinZuIso(input.ende) : undefined
    if (input?.ende && !ende) return 'Fehler: ende ist kein gültiger Zeitpunkt (JJJJ-MM-TTTHH:MM).'
    if (ende && ende < beginn) return 'Fehler: Das Ende liegt vor dem Beginn.'
    const schluss = input?.anmeldeschluss ? berlinZuIso(input.anmeldeschluss, '23:59') : undefined
    if (input?.anmeldeschluss && !schluss) return 'Fehler: anmeldeschluss ist kein gültiges Datum (JJJJ-MM-TT).'
    const plaetzeRoh = input?.plaetze === undefined || input?.plaetze === null || input?.plaetze === '' ? null : Number(input.plaetze)
    if (plaetzeRoh !== null && (!Number.isInteger(plaetzeRoh) || plaetzeRoh < 1)) return 'Fehler: plaetze muss eine ganze Zahl ab 1 sein.'
    const preisRoh = input?.preis === undefined || input?.preis === null || input?.preis === '' ? null : Number(input.preis)
    if (preisRoh !== null && (!Number.isFinite(preisRoh) || preisRoh < 0)) return 'Fehler: preis muss eine Zahl ab 0 sein.'
    const zeile = {
      seminar_id: seminar.id,
      beginn,
      ende: ende ?? null,
      ort: text(input?.ort, 300) || null,
      online_link: text(input?.online_link, 500) || null,
      plaetze: plaetzeRoh,
      preis: preisRoh,
      referent: text(input?.referent, 120) || null,
      anmeldeschluss: schluss ?? null,
      oeffentlich: input?.oeffentlich === true,
      verantwortlich: text(input?.verantwortlich, 120) || mitarbeiter.name,
      status: 'geplant',
      erstellt_von: mitarbeiter.name,
      geaendert_von: mitarbeiter.name,
    }
    const { data, error } = await supabase.from('seminar_termine').insert(zeile).select('id').single()
    if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde angelegt.`
    protokolliere(`Seminartermin „${seminar.titel}“ am ${wann(beginn, ende)} angelegt`)
    const hinweis = beginn < new Date().toISOString() ? ' Achtung: Der Beginn liegt in der Vergangenheit.' : ''
    return `Angelegt: „${seminar.titel}“ am ${wann(beginn, ende)}${zeile.ort ? `, ${zeile.ort}` : ''}${zeile.plaetze ? `, ${zeile.plaetze} Plätze` : ', ohne Platzgrenze'}${preisRoh !== null ? `, ${euro(preisRoh)} netto` : seminar.preis_netto !== null && seminar.preis_netto !== undefined ? `, Katalogpreis ${euro(Number(seminar.preis_netto))} netto` : ''}. Anmeldung über das Internet: ${zeile.oeffentlich ? 'offen (den Link gibt es im CRM auf der Seite des Termins)' : 'aus — einschalten im CRM auf der Seite des Termins'}. Betreut von ${zeile.verantwortlich}.${hinweis} termin_id=${data?.id ?? ''}`
  }

  if (name === 'teilnehmer_zeigen') {
    const r = await ladeTermin(supabase, String(input?.termin_id ?? '').trim())
    if (r.fehler) return r.fehler
    const { t, seminar } = r
    const { data, error } = await supabase.from('seminar_anmeldungen').select('*').eq('termin_id', t.id).order('erstellt_am', { ascending: true })
    if (error) return `Fehler beim Laden: ${error.message}`
    const liste = (data ?? []) as Termin[]
    const belegt = liste.filter((a) => BELEGT.includes(a.status)).length
    const kopf = `„${seminar!.titel}“ am ${wann(t.beginn, t.ende)} (${TERMIN_NAME[t.status] ?? t.status}): ${belegt}${t.plaetze ? ` von ${t.plaetze}` : ''} Plätzen belegt`
    if (!liste.length) return `${kopf}. Noch keine Anmeldungen.`
    const reihenfolge = ['bestaetigt', 'angemeldet', 'teilgenommen', 'warteliste', 'storniert']
    liste.sort((a, b) => reihenfolge.indexOf(a.status) - reihenfolge.indexOf(b.status))
    return [
      `${kopf}.`,
      ...liste.map((a) => {
        const teile = [a.name, STATUS_NAME[a.status] ?? a.status]
        if (a.firma) teile.push(a.firma)
        if (a.email) teile.push(a.email)
        if (a.telefon) teile.push(a.telefon)
        teile.push(a.quelle === 'formular' ? 'über das Formular' : 'von Hand')
        if (a.kunde_id) teile.push(`Akte ${a.kunde_id}`)
        if (a.notiz) teile.push(`Notiz: ${String(a.notiz).slice(0, 150)}`)
        return `- ${teile.join(' | ')}`
      }),
    ].join('\n').slice(0, 16000)
  }

  if (name === 'teilnehmer_anmelden') {
    const r = await ladeTermin(supabase, String(input?.termin_id ?? '').trim())
    if (r.fehler) return r.fehler
    const { t, seminar } = r
    if (t.status !== 'geplant') return `Fehler: Der Termin steht auf „${TERMIN_NAME[t.status] ?? t.status}“ — dafür meldet man niemanden mehr an.`

    let akte: Termin = null
    const kundeId = text(input?.kunde_id, 60)
    if (kundeId) {
      const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, email, telefon, seminare, activities').eq('id', kundeId).maybeSingle()
      if (!data) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
      if (data.bereich !== 'akademie') return 'Fehler: Diese Akte gehört nicht zur Akademie. Nimm eine Akademie-Akte oder trag den Teilnehmer frei mit name und email ein.'
      akte = data
    }
    const nameWert = text(input?.name, 120) || text(akte?.ansprechpartner, 120) || text(akte?.firma, 120)
    if (!nameWert) return 'Fehler: name fehlt (oder kunde_id einer Akademie-Akte angeben).'
    const email = (text(input?.email, 200) || text(akte?.email, 200)).toLowerCase()
    if (email && !ADRESSE.test(email)) return 'Fehler: Die E-Mail-Adresse ist ungültig.'
    const firmaWert = text(input?.firma, 160) || (akte && text(akte.firma, 160) !== nameWert ? text(akte.firma, 160) : '')
    const telefon = text(input?.telefon, 40) || text(akte?.telefon, 40)

    const { data: bisher } = await supabase.from('seminar_anmeldungen').select('id, email, kunde_id, status, name').eq('termin_id', t.id)
    const aktiv = ((bisher ?? []) as Termin[]).filter((a) => a.status !== 'storniert')
    const doppelt = aktiv.find((a) => (email && String(a.email ?? '').toLowerCase() === email) || (akte && a.kunde_id === akte.id))
    if (doppelt) return `${doppelt.name} ist für diesen Termin schon eingetragen (${STATUS_NAME[doppelt.status] ?? doppelt.status}). Nichts geändert.`
    const belegt = aktiv.filter((a) => BELEGT.includes(a.status)).length
    const voll = t.plaetze !== null && t.plaetze !== undefined && belegt >= Number(t.plaetze)
    const gewuenscht = ['angemeldet', 'bestaetigt', 'warteliste'].includes(input?.status) ? String(input.status) : ''
    const status = gewuenscht || (voll ? 'warteliste' : 'angemeldet')

    const { data: neu, error } = await supabase
      .from('seminar_anmeldungen')
      .insert({
        termin_id: t.id,
        kunde_id: akte?.id ?? null,
        name: nameWert,
        firma: firmaWert || null,
        email: email || null,
        telefon: telefon || null,
        status,
        quelle: 'hand',
        notiz: text(input?.notiz, 1000) || null,
        erstellt_von: mitarbeiter.name,
        geaendert_von: mitarbeiter.name,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return 'Diese E-Mail-Adresse ist für den Termin schon angemeldet. Nichts geändert.'
      return `Fehler beim Speichern: ${error.message}. Nichts wurde eingetragen.`
    }

    if (akte) {
      const verlauf = Array.isArray(akte.activities) ? akte.activities : []
      await supabase
        .from('kunden')
        .update({
          activities: [{ id: crypto.randomUUID(), date: heute, text: `Für das Seminar „${seminar!.titel}“ am ${wann(t.beginn)} eingetragen (${STATUS_NAME[status]}).`, user: mitarbeiter.name }, ...verlauf],
          letzte_aktivitaet: heute,
          seminare: seminareMit(akte.seminare, seminar!, status === 'warteliste' ? 'interessiert' : 'angemeldet'),
        })
        .eq('id', akte.id)
    }
    protokolliere(`${nameWert} für „${seminar!.titel}“ am ${wann(t.beginn)} eingetragen (${STATUS_NAME[status]})`)
    const hinweisVoll = voll && status !== 'warteliste' ? ' Achtung: Der Termin war schon voll, der Teilnehmer ist trotzdem angemeldet (überbucht).' : ''
    const hinweisWarte = voll && !gewuenscht ? ' Der Termin ist voll, deshalb steht er auf der Warteliste.' : ''
    return `Eingetragen: ${nameWert} für „${seminar!.titel}“ am ${wann(t.beginn, t.ende)} — ${STATUS_NAME[status]}.${hinweisWarte}${hinweisVoll}${akte ? ' In der Akte vermerkt.' : email ? '' : ' Ohne E-Mail-Adresse bekommt er keine automatischen Mails.'} id=${neu?.id ?? ''}`
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
