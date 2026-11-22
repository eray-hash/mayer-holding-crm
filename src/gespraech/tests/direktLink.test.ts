// deno test src/gespraech/tests/direktLink.test.ts
import { HINWEIS, loeseDirektLinkAuf, nimmtGeradeAuf, type DirektAkte, type DirektLader, type DirektTermin } from '../direktLink.ts'
import { leseAufnehmenZiel } from '../../../supabase/functions/_shared/gespraechLink.ts'
import { gleich, test, wahr } from './hilfe.ts'

const LEHLE: DirektAkte = { art: 'kunde', id: 'k_lehle', bereich: 'erben', name: 'Josef Lehle' }
const LAGER: DirektAkte = { art: 'objekt', id: 'o_lager', name: 'Lagerhalle Neu-Ulm' }
const TERMIN: DirektTermin = { id: 't1', titel: 'Erstgespräch Lehle' }

type Daten = { termine?: DirektTermin[]; akten?: DirektAkte[]; akteZuTermin?: Record<string, DirektAkte>; jetzt?: { termin: DirektTermin; akte: DirektAkte | null } | null; offline?: boolean }

function lader(d: Daten = {}): DirektLader & { aufrufe: string[] } {
  const aufrufe: string[] = []
  const netz = () => {
    if (d.offline) throw new Error('Failed to fetch')
  }
  return {
    aufrufe,
    termin: async (id) => (aufrufe.push(`termin:${id}`), netz(), (d.termine ?? [TERMIN]).find((t) => t.id === id) ?? null),
    akteZuTermin: async (id) => (aufrufe.push(`akteZuTermin:${id}`), d.akteZuTermin?.[id] ?? null),
    kunde: async (id) => (aufrufe.push(`kunde:${id}`), netz(), (d.akten ?? [LEHLE, LAGER]).find((a) => a.art === 'kunde' && a.id === id) ?? null),
    objekt: async (id) => (aufrufe.push(`objekt:${id}`), netz(), (d.akten ?? [LEHLE, LAGER]).find((a) => a.art === 'objekt' && a.id === id) ?? null),
    aktuellerTermin: async () => (aufrufe.push('aktuellerTermin'), netz(), d.jetzt ?? null),
  }
}

async function loese(suche: string, d: Daten = {}, standard: 'termin' | 'telefon' | 'notiz' = 'telefon') {
  const l = lader(d)
  const ziel = leseAufnehmenZiel(suche)
  wahr(ziel, 'Direkt-Link erkannt')
  return { ...(await loeseDirektLinkAuf(ziel!, l, standard)), aufrufe: l.aufrufe }
}

test('termin=… : Titel des Termins, Akte des Termins, Art Termin', async () => {
  const r = await loese('?termin=t1', { akteZuTermin: { t1: LEHLE } })
  gleich(r.hinweis, null)
  gleich(r.vorbereitung, { art: 'termin', titel: 'Erstgespräch Lehle', terminId: 't1', kundeId: 'k_lehle', kundeBereich: 'erben', kundeName: 'Josef Lehle' })
})

test('termin + kunde: Akte aus dem Link, keine Suche über den Termin', async () => {
  const r = await loese('?termin=t1&kunde=k_lehle')
  gleich(r.vorbereitung.kundeId, 'k_lehle')
  gleich(r.aufrufe.includes('akteZuTermin:t1'), false)
})

test('kunde=… ohne art: Art aus den App-Einstellungen, Titel = Name der Akte', async () => {
  const r = await loese('?kunde=k_lehle', {}, 'telefon')
  gleich(r.vorbereitung, { art: 'telefon', titel: 'Josef Lehle', kundeId: 'k_lehle', kundeBereich: 'erben', kundeName: 'Josef Lehle' })
  gleich(r.aufrufe.includes('aktuellerTermin'), false)
})

test('objekt=…&art=notiz', async () => {
  const r = await loese('?objekt=o_lager&art=notiz')
  gleich(r.vorbereitung, { art: 'notiz', titel: 'Lagerhalle Neu-Ulm', objektId: 'o_lager', objektName: 'Lagerhalle Neu-Ulm' })
  gleich(r.hinweis, null)
})

test('Akte oder Termin nicht gefunden → Hinweis (die App zeigt dann die Startseite vorbelegt)', async () => {
  const r = await loese('?kunde=k_weg&art=termin')
  gleich(r.hinweis, HINWEIS.kunde)
  gleich(r.vorbereitung.kundeId, undefined)
  const t = await loese('?termin=t_weg')
  gleich(t.hinweis, HINWEIS.termin)
  gleich(t.vorbereitung.terminId, undefined)
  gleich(t.vorbereitung.art, 'termin')
  gleich(t.vorbereitung.titel, 'Termin')
})

test('Ohne Netz: Nummern ungeprüft übernehmen, kein Hinweis — aufnehmen geht trotzdem', async () => {
  const r = await loese('?termin=t1&kunde=k_lehle', { offline: true })
  gleich(r.hinweis, null)
  gleich(r.vorbereitung, { art: 'termin', titel: 'Termin', terminId: 't1', kundeId: 'k_lehle' })
})

test('Schnellaktion „Termin aufnehmen“ (nur art=termin): laufender Termin samt Akte', async () => {
  const r = await loese('?art=termin', { jetzt: { termin: TERMIN, akte: LEHLE } })
  gleich(r.vorbereitung, { art: 'termin', titel: 'Erstgespräch Lehle', terminId: 't1', kundeId: 'k_lehle', kundeBereich: 'erben', kundeName: 'Josef Lehle' })
  const ohne = await loese('?art=termin', { jetzt: null })
  gleich(ohne.vorbereitung, { art: 'termin', titel: 'Termin' })
  gleich(ohne.hinweis, null)
  const offline = await loese('?art=termin', { offline: true })
  gleich(offline.vorbereitung, { art: 'termin', titel: 'Termin' })
})

test('Schnellaktionen Telefonat und Notiz: ohne Terminsuche', async () => {
  const t = await loese('?art=telefon')
  gleich(t.vorbereitung, { art: 'telefon', titel: 'Telefonat' })
  gleich(t.aufrufe, [])
  const n = await loese('?art=notiz')
  gleich(n.vorbereitung, { art: 'notiz', titel: 'Notiz' })
})

test('Unvollständiger Link → Hinweis, Rest bleibt', async () => {
  const r = await loese('?kunde=k_lehle&art=video', {}, 'notiz')
  gleich(r.hinweis, HINWEIS.fehlerhaft)
  gleich(r.vorbereitung.art, 'notiz')
  gleich(r.vorbereitung.kundeId, 'k_lehle')
})

test('Laufende Aufnahme wird von Direkt-Links nicht angetastet', () => {
  for (const p of ['startet', 'laeuft', 'pausiert', 'unterbrochen']) gleich(nimmtGeradeAuf(p), true, p)
  for (const p of ['bereit', 'einwilligung', 'beendet', 'fehler']) gleich(nimmtGeradeAuf(p), false, p)
})
