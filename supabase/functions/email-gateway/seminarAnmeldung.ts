// Öffentliche Anmeldung zu Seminarterminen der Akademie (22.11.2026). Seite /formular/seminar/:token —
// token ist seminar_termine.anmelde_token (eine Zufalls-UUID, getrennt von der id des Termins).
//
// public_seminar_termin   → Termin, Seminar, freie Plätze und die Texte zum Zustimmen.
// public_seminar_anmelden → prüfen, Platz vergeben (voll → Warteliste), Akademie-Akte per E-Mail finden oder
//                           anlegen, Verlauf, Seminar in der Akte vermerken, Telegram an den Zuständigen.
// Die Anmeldebestätigung bzw. die Warteliste-Nachricht merkt die Datenbank selbst vor (Auslöser
// an_seminar_anmeldungen), nur wenn die Regel in auto_nachricht_regeln an ist — anfangs aus.
// Die Zustimmung (Teilnahmebedingungen, Datenschutz) wird mit Zeitpunkt, Gerät und genauem Wortlaut gespeichert.
// Alles läuft mit dem Dienstschlüssel; der Link ist der einzige Schlüssel.

import { alleZeilen } from '../_shared/alleZeilen.ts'

export const BEDINGUNGEN_VORLAGE = 'vl_akademie_seminar_bedingungen'
export const DATENSCHUTZ_TEXT =
  'Ich habe die Datenschutzhinweise gelesen und bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anmeldung gespeichert werden.'
/** Wer die Anmeldungen betreut, wenn am Termin niemand eingetragen ist (wie public_create_lead). */
export const ZUSTAENDIG_VORGABE = 'Andreas Mayer'
/** Diese Stände belegen einen Platz. */
export const BELEGT = ['angemeldet', 'bestaetigt', 'teilgenommen']

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADRESSE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// deno-lint-ignore no-explicit-any
type Admin = any

export type TerminSeite =
  | { stufe: 'ungueltig'; grund: string }
  | {
      stufe: 'offen'
      seminar: { titel: string; beschreibung: string; dauer: string; bereich: string }
      termin: { beginn: string; ende: string | null; ort: string; online: boolean; referent: string; preis: number | null; anmeldeschluss: string | null }
      /** null = ohne Begrenzung. */
      freiePlaetze: number | null
      texte: { teilnahmebedingungen: string; datenschutz: string }
    }

export type AnmeldeErgebnis =
  | { stufe: 'ungueltig'; grund: string }
  | { stufe: 'fehler'; grund: string }
  | { stufe: 'angemeldet' | 'warteliste'; name: string; seminar: string; beginn: string; schonAngemeldet?: boolean }

export type AnmeldeEingabe = {
  name?: unknown
  firma?: unknown
  email?: unknown
  telefon?: unknown
  teilnahmebedingungen?: unknown
  datenschutz?: unknown
  /** Für Menschen unsichtbares Feld — füllen nur Programme aus. */
  webseite?: unknown
}

const BERLIN_DATUM = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const BERLIN_UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

/** "Donnerstag, 03.12.2026, 09:00 Uhr" */
export function terminText(beginn: string): string {
  const d = new Date(beginn)
  return `${BERLIN_DATUM.format(d)}, ${BERLIN_UHR.format(d)} Uhr`
}

export const heuteBerlin = (jetzt = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt)

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** Seminare einer Akte: Eintrag ergänzen oder von „interessiert“ auf „angemeldet“ heben. */
export function seminareMit(liste: unknown, seminar: { id: string; titel: string }, stand: 'angemeldet' | 'teilgenommen' = 'angemeldet') {
  const alt = Array.isArray(liste) ? (liste as { id: string; titel: string; stand: string }[]).filter((x) => x && typeof x.id === 'string') : []
  const rang: Record<string, number> = { interessiert: 0, angemeldet: 1, teilgenommen: 2 }
  const vorhanden = alt.find((x) => x.id === seminar.id)
  if (!vorhanden) return [...alt, { id: seminar.id, titel: seminar.titel, stand }]
  return alt.map((x) => (x.id === seminar.id && (rang[x.stand] ?? 0) < rang[stand] ? { ...x, stand } : x))
}

async function ladeTermin(admin: Admin, token: unknown, jetzt: number) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return { fehler: 'Dieser Anmeldelink ist ungültig.' }
  const { data: t } = await admin.from('seminar_termine').select('*').eq('anmelde_token', token.toLowerCase()).maybeSingle()
  if (!t) return { fehler: 'Dieser Anmeldelink ist ungültig.' }
  if (!t.oeffentlich) return { fehler: 'Für diesen Termin ist die Anmeldung über das Internet nicht freigeschaltet. Bitte wenden Sie sich direkt an uns.' }
  if (t.status === 'abgesagt') return { fehler: 'Dieser Termin wurde leider abgesagt. Gerne nennen wir Ihnen einen anderen Termin.' }
  if (t.status === 'durchgefuehrt' || new Date(t.beginn).getTime() <= jetzt) return { fehler: 'Dieser Termin hat bereits stattgefunden.' }
  if (t.anmeldeschluss && new Date(t.anmeldeschluss).getTime() < jetzt) return { fehler: 'Die Anmeldefrist für diesen Termin ist leider abgelaufen. Bitte wenden Sie sich direkt an uns.' }
  const { data: s } = await admin.from('seminare').select('id, titel, beschreibung, dauer, bereich, preis_netto, dozent').eq('id', t.seminar_id).maybeSingle()
  if (!s) return { fehler: 'Dieses Seminar wird nicht mehr angeboten.' }
  return { t, s }
}

async function belegtePlaetze(admin: Admin, terminId: string): Promise<number> {
  const { data } = await admin.from('seminar_anmeldungen').select('id, status').eq('termin_id', terminId)
  return ((data ?? []) as { status: string }[]).filter((a) => BELEGT.includes(a.status)).length
}

async function ladeBedingungen(admin: Admin): Promise<string> {
  const { data } = await admin.from('vorlagen').select('id, text').eq('id', BEDINGUNGEN_VORLAGE).maybeSingle()
  return String(data?.text ?? '').trim()
}

/** Seite laden: Eckdaten des Termins, freie Plätze und die Texte. Online-Zugang und Teilnehmer nie. */
export async function seminarTerminLaden(admin: Admin, token: unknown, jetzt = Date.now()): Promise<TerminSeite> {
  const r = await ladeTermin(admin, token, jetzt)
  if ('fehler' in r) return { stufe: 'ungueltig', grund: r.fehler ?? 'Dieser Anmeldelink ist ungültig.' }
  const { t, s } = r
  const belegt = await belegtePlaetze(admin, t.id)
  const preis = t.preis ?? s.preis_netto
  return {
    stufe: 'offen',
    seminar: { titel: s.titel, beschreibung: s.beschreibung ?? '', dauer: s.dauer ?? '', bereich: s.bereich ?? '' },
    termin: {
      beginn: t.beginn,
      ende: t.ende ?? null,
      ort: t.ort ?? '',
      online: !!String(t.online_link ?? '').trim(),
      referent: t.referent || s.dozent || '',
      preis: preis === null || preis === undefined ? null : Number(preis),
      anmeldeschluss: t.anmeldeschluss ?? null,
    },
    freiePlaetze: t.plaetze === null || t.plaetze === undefined ? null : Math.max(0, Number(t.plaetze) - belegt),
    texte: { teilnahmebedingungen: await ladeBedingungen(admin), datenschutz: DATENSCHUTZ_TEXT },
  }
}

/** Anmeldung speichern. melde(zustaendig, text) schickt die Telegram-Meldung an den Mitarbeiter. */
export async function seminarAnmelden(
  admin: Admin,
  token: unknown,
  e: AnmeldeEingabe,
  meta: { ip: string; geraet: string },
  melde?: (zustaendig: string, text: string) => Promise<void>,
  jetztDatum = new Date(),
): Promise<AnmeldeErgebnis> {
  const jetzt = jetztDatum.getTime()
  const r = await ladeTermin(admin, token, jetzt)
  if ('fehler' in r) return { stufe: 'ungueltig', grund: r.fehler ?? 'Dieser Anmeldelink ist ungültig.' }
  const { t, s } = r

  const name = text(e.name, 120)
  const firma = text(e.firma, 160)
  const email = text(e.email, 200).toLowerCase()
  const telefon = text(e.telefon, 40)
  if (name.length < 3) return { stufe: 'fehler', grund: 'Bitte geben Sie Ihren vollständigen Namen ein.' }
  if (!ADRESSE.test(email)) return { stufe: 'fehler', grund: 'Bitte geben Sie eine gültige E-Mail-Adresse ein. Dorthin schicken wir die Bestätigung.' }
  const bedingungen = await ladeBedingungen(admin)
  if (bedingungen && e.teilnahmebedingungen !== true) return { stufe: 'fehler', grund: 'Bitte stimmen Sie den Teilnahmebedingungen zu.' }
  if (e.datenschutz !== true) return { stufe: 'fehler', grund: 'Bitte bestätigen Sie die Datenschutzhinweise.' }

  // Programme füllen das unsichtbare Feld aus: still „angemeldet“ melden, nichts speichern.
  if (typeof e.webseite === 'string' && e.webseite.trim()) return { stufe: 'angemeldet', name, seminar: s.titel, beginn: t.beginn }

  // Schon angemeldet (gleiche Adresse, nicht storniert)? Dann nichts doppelt anlegen.
  const { data: bisher } = await admin.from('seminar_anmeldungen').select('id, email, status').eq('termin_id', t.id)
  // deno-lint-ignore no-explicit-any
  const doppelt = ((bisher ?? []) as any[]).find((a) => a.status !== 'storniert' && String(a.email ?? '').trim().toLowerCase() === email)
  if (doppelt) return { stufe: doppelt.status === 'warteliste' ? 'warteliste' : 'angemeldet', name, seminar: s.titel, beginn: t.beginn, schonAngemeldet: true }

  // deno-lint-ignore no-explicit-any
  const belegt = ((bisher ?? []) as any[]).filter((a) => BELEGT.includes(a.status)).length
  const voll = t.plaetze !== null && t.plaetze !== undefined && belegt >= Number(t.plaetze)
  const heute = heuteBerlin(jetztDatum)
  const wann = terminText(t.beginn)
  const zustaendig = String(t.verantwortlich ?? '').trim() || ZUSTAENDIG_VORGABE

  // Akademie-Akte mit dieser Adresse suchen, sonst anlegen. „Automatisch angelegt“ im ersten Verlaufseintrag:
  // Daran erkennt die Datenbank (wk_kunden_ausloeser) vom CRM selbst angelegte Akten — keine Willkommensnachricht.
  let kundeId: string | null = null
  let akteNeu = false
  let akteFehler = ''
  const { data: kunden } = await alleZeilen(() => admin.from('kunden').select('id, email').eq('bereich', 'akademie'))
  // deno-lint-ignore no-explicit-any
  const vorhanden = ((kunden ?? []) as any[]).find((k) => String(k.email ?? '').trim().toLowerCase() === email)
  if (vorhanden) kundeId = String(vorhanden.id)
  else {
    const id = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const { error } = await admin.from('kunden').insert({
      id,
      bereich: 'akademie',
      firma: firma || name,
      ansprechpartner: name,
      email,
      telefon,
      prioritaet: 'Mittel',
      status: 'anmeldung_eingegangen',
      follow_up: { date: heute, note: `Anmeldung zu „${s.titel}“ bestätigen`, done: false },
      verantwortlich: zustaendig,
      letzte_aktivitaet: heute,
      activities: [{ id: crypto.randomUUID(), date: heute, text: `Automatisch angelegt aus einer Anmeldung über das Internet zum Seminar „${s.titel}“ (${wann}).`, user: `${name} (Formular)` }],
      seminare: [],
    })
    if (error) akteFehler = error.message
    else {
      kundeId = id
      akteNeu = true
    }
  }

  const zustimmung = {
    am: jetztDatum.toISOString(),
    teilnahmebedingungen: bedingungen ? true : null,
    datenschutz: true,
    ip: meta.ip.slice(0, 64),
    geraet: meta.geraet.slice(0, 300),
    texte: { teilnahmebedingungen: bedingungen || null, datenschutz: DATENSCHUTZ_TEXT },
  }
  const { data: neu, error: anmeldeFehler } = await admin
    .from('seminar_anmeldungen')
    .insert({
      termin_id: t.id,
      kunde_id: kundeId,
      name,
      firma: firma || null,
      email,
      telefon: telefon || null,
      status: voll ? 'warteliste' : 'angemeldet',
      zustimmung,
      quelle: 'formular',
      erstellt_von: `${name} (Formular)`,
    })
    .select('id, status')
    .single()
  if (anmeldeFehler || !neu) {
    // Gleichzeitig doppelt abgeschickt: die eindeutige Adresse je Termin greift.
    if (anmeldeFehler?.code === '23505') return { stufe: 'angemeldet', name, seminar: s.titel, beginn: t.beginn, schonAngemeldet: true }
    throw new Error(`Anmeldung ließ sich nicht speichern: ${anmeldeFehler?.message ?? 'keine Antwort'}`)
  }
  // Die Datenbank kann beim Eintragen auf Warteliste umstellen (letzter Platz gleichzeitig vergeben).
  const warteliste = neu.status === 'warteliste'

  // Verlauf und Seminar in der Akte (frisch lesen, damit nichts überschrieben wird).
  if (kundeId) {
    const { data: k } = await admin.from('kunden').select('id, status, telefon, activities, seminare').eq('id', kundeId).maybeSingle()
    if (k) {
      const verlauf = Array.isArray(k.activities) ? k.activities : []
      const eintrag = `Anmeldung über das Internet zum Seminar „${s.titel}“ am ${wann}: ${warteliste ? 'auf der Warteliste, der Termin ist voll' : 'Platz vergeben (angemeldet)'}.`
      const felder: Record<string, unknown> = {
        activities: [{ id: crypto.randomUUID(), date: heute, text: eintrag, user: `${name} (Formular)` }, ...verlauf],
        letzte_aktivitaet: heute,
      }
      if (!warteliste) felder.seminare = seminareMit(k.seminare, s)
      else if (!(Array.isArray(k.seminare) && k.seminare.some((x: { id?: string }) => x?.id === s.id))) {
        felder.seminare = [...(Array.isArray(k.seminare) ? k.seminare : []), { id: s.id, titel: s.titel, stand: 'interessiert' }]
      }
      if (!akteNeu && !String(k.telefon ?? '').trim() && telefon) felder.telefon = telefon
      if (!akteNeu && k.status === 'interessent') felder.status = 'anmeldung_eingegangen'
      await admin.from('kunden').update(felder).eq('id', kundeId)
    }
  }

  if (melde) {
    const frei = t.plaetze === null || t.plaetze === undefined ? '' : `, noch ${Math.max(0, Number(t.plaetze) - belegt - (warteliste ? 0 : 1))} Plätze frei`
    const akte = akteNeu ? 'Akademie-Akte neu angelegt' : kundeId ? 'zur bestehenden Akademie-Akte gelegt' : `Akte ließ sich nicht anlegen${akteFehler ? ` (${akteFehler})` : ''}`
    const zeile = `🎓 Neue Seminar-Anmeldung über das Internet: ${name}${firma ? ` (${firma})` : ''}, ${email}${telefon ? `, ${telefon}` : ''} — „${s.titel}“ am ${wann}. ${warteliste ? 'Der Termin ist voll, deshalb steht die Anmeldung auf der Warteliste.' : `Angemeldet${frei}.`} ${akte}.`
    await melde(zustaendig, zeile).catch(() => undefined)
  }

  return { stufe: warteliste ? 'warteliste' : 'angemeldet', name, seminar: s.titel, beginn: t.beginn }
}
