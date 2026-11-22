import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { alleDokumente, fuelleText, ortAus, portalBesichtigung, portalDokument, portalLaden, portalZustimmen } from './objektPortal.ts'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { einzelZeit, serienZeiten } from '../_shared/besichtigungZeiten.ts'

const TOKEN = 'A'.repeat(43)

/** Testdatenbank (_shared/testDoppel.ts) plus Speicher-Links und die Datenbankfunktion besichtigung_portal_buchen,
 *  hier in JavaScript nachgebaut (gleiche Prüfreihenfolge wie im SQL; ein Aufruf läuft am Stück = eine Transaktion). */
// deno-lint-ignore no-explicit-any
function fakeAdmin(t: Record<string, any[]>) {
  const db = falscheDatenbank()
  // Dieselben Listen wie im Test (keine Kopie), damit die Tests den Stand direkt an `t` prüfen können.
  for (const [k, v] of Object.entries(t)) db.tabellen[k] = v as Zeile[]
  const rpcAufrufe: string[] = []
  // deno-lint-ignore no-explicit-any
  const rpc = (name: string, a: any) => {
    rpcAufrufe.push(name)
    if (name !== 'besichtigung_portal_buchen') return Promise.resolve({ data: null, error: { message: `unbekannte Funktion ${name}` } })
    const antwort = (data: string) => Promise.resolve({ data, error: null })
    const f = db.tabelle('objekt_freigaben').find((x) => x.id === a.p_freigabe)
    if (!f || f.status !== 'zugestimmt' || Date.parse(String(f.gueltig_bis)) < Date.now()) return antwort('ungueltig')
    const bes = db.tabelle('besichtigungen')
    if (bes.some((b) => b.freigabe_id === f.id && b.status === 'geplant' && Date.parse(String(b.beginn)) > Date.now())) return antwort('schon_gebucht')
    const z = db.tabelle('besichtigung_zeiten').find((x) => x.id === a.p_zeit && x.objekt_id === f.objekt_id)
    if (!z || z.status !== 'offen') return antwort('weg')
    if (Date.parse(String(z.beginn)) <= Date.now()) return antwort('vorbei')
    if (bes.filter((b) => b.besichtigung_zeit_id === z.id && b.status === 'geplant').length >= Number(z.plaetze)) return antwort('voll')
    bes.push({
      id: a.p_zeile.id, objekt_id: f.objekt_id, kunde_id: f.kunde_id ?? null, kunde_bereich: f.kunde_id ? f.kunde_bereich ?? 'immobilienkunden' : null,
      interessent: a.p_zeile.interessent ?? '', telefon: a.p_zeile.telefon ?? '', email: a.p_zeile.email ?? '', beginn: z.beginn,
      dauer_min: Math.max(15, Math.round((Date.parse(String(z.ende)) - Date.parse(String(z.beginn))) / 60000)), durchgefuehrt_von: a.p_zeile.durchgefuehrt_von || z.makler || '',
      status: 'geplant', erstellt_von: 'Interessenten-Portal', besichtigung_zeit_id: z.id, freigabe_id: f.id, kalender_termin_id: null,
    })
    return antwort('ok')
  }
  return {
    db,
    rpcAufrufe,
    from: (tab: string) => db.from(tab),
    rpc,
    storage: { from: () => ({ createSignedUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/${pfad}?sig` }, error: null }) }) },
  }
}

function stand() {
  return {
    objekt_freigaben: [{ id: 'f1', token: TOKEN, objekt_id: 'o1', kunde_id: 'k1', name: 'Erika Muster', provision: '3 % zzgl. USt.', status: 'eingeladen', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 0 }],
    objekte: [{
      id: 'o1', bezeichnung: 'Wohnung Kissing', adresse: 'Am alten Sportplatz 6, 86438 Kissing', typ: 'Wohnung', kaufpreis: 289000, expose_text: 'Helle 3-Zimmer-Wohnung',
      dokumente: { 'Exposé': [{ id: 'd1', name: 'Exposé.pdf', typ: 'application/pdf', groesse: '1 MB', url: 'o1/d1_Expose.pdf' }], Grundbuch: [{ id: 'd2', name: 'Grundbuch.pdf', typ: 'application/pdf', groesse: '1 MB', url: 'o1/d2_Grundbuch.pdf' }] },
      interessenten_dokumente: ['d1'], verantwortlich: 'Quirin Lutzenberger', activities: [],
    }],
    kunden: [{ id: 'k1', activities: [] }],
    vorlagen: [
      { id: 'vl_immo_portal_agb', text: 'AGB für {{Name Interessent}}' },
      { id: 'vl_immo_portal_provision', text: 'Provision {{Provision}} für {{Objekt}} am {{Datum}}' },
      { id: 'vl_immo_portal_widerruf', text: 'Widerruf' },
    ],
  }
}

Deno.test('Ort ohne Hausnummer', () => {
  assertEquals(ortAus('Am alten Sportplatz 6, 86438 Kissing'), '86438 Kissing')
  assertEquals(ortAus('Geislingen'), 'Geislingen')
})

Deno.test('Platzhalter und Dokumentliste', () => {
  assertEquals(fuelleText('{{Name Interessent}} / {{Provision}}', { name: 'A', objekt: 'B', provision: 'C', datum: 'D' }), 'A / C')
  assertEquals(alleDokumente({ X: [{ id: 'a', name: 'n' }], Y: [{ id: 'b' }] }).map((d) => d.id), ['a', 'b'])
})

Deno.test('Ungültige oder abgelaufene Links', async () => {
  const t = stand()
  assertEquals((await portalLaden(fakeAdmin(t), 'kurz')).stufe, 'ungueltig')
  t.objekt_freigaben[0].gueltig_bis = '2000-01-01T00:00:00Z'
  assertEquals((await portalLaden(fakeAdmin(t), TOKEN)).stufe, 'ungueltig')
})

Deno.test('Vor der Zustimmung: nur Ort, keine Adresse, keine Dokumente', async () => {
  const r = await portalLaden(fakeAdmin(stand()), TOKEN)
  assertEquals(r.stufe, 'zustimmung')
  if (r.stufe !== 'zustimmung') return
  assertEquals(r.objekt.ort, '86438 Kissing')
  assert(!JSON.stringify(r).includes('Sportplatz'))
  assertMatch(r.texte.provision, /3 % zzgl\. USt\./)
})

Deno.test('Zustimmung nur mit allen Haken und Namen; danach nur freigegebene Dokumente', async () => {
  const t = stand()
  const admin = fakeAdmin(t)
  const ohne = await portalZustimmen(admin, TOKEN, { name: 'Erika Muster', agb: true, provision: true, sofortBeginn: false }, { ip: '1.2.3.4', geraet: 'Test' })
  assertEquals(ohne.stufe, 'fehler')
  assertEquals((await portalDokument(admin, TOKEN, 'd1') as { fehler?: string }).fehler !== undefined, true)
  const meldungen: string[] = []
  const r = await portalZustimmen(admin, TOKEN, { name: 'Erika Muster', agb: true, provision: true, sofortBeginn: true }, { ip: '1.2.3.4', geraet: 'Test' }, (_wer, text) => Promise.resolve(void meldungen.push(text)))
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assertEquals(r.dokumente.map((d) => d.id), ['d1'])
  assertEquals(r.objekt.adresse, 'Am alten Sportplatz 6, 86438 Kissing')
  assertEquals(t.objekt_freigaben[0].status, 'zugestimmt')
  assertMatch((t.objekt_freigaben[0] as unknown as { zustimmung: { texte: { provision: string } } }).zustimmung.texte.provision, /Wohnung Kissing/)
  assertEquals(t.objekte[0].activities.length, 1)
  assertEquals(t.kunden[0].activities.length, 1)
  assertEquals(meldungen.length, 1)
  const url = await portalDokument(admin, TOKEN, 'd1')
  assertMatch((url as { url: string }).url, /o1\/d1_Expose\.pdf/)
  const gesperrt = await portalDokument(admin, TOKEN, 'd2')
  assertEquals('fehler' in gesperrt, true)
})

Deno.test('Widerrufener Zugang zeigt nichts mehr', async () => {
  const t = stand()
  t.objekt_freigaben[0].status = 'widerrufen'
  assertEquals((await portalLaden(fakeAdmin(t), TOKEN)).stufe, 'ungueltig')
})

// ---------- Besichtigung vereinbaren ----------

const TOKEN2 = 'B'.repeat(43)
const STUNDE = 3600000
/** Volle Stunde, n Tage ab jetzt (immer weit genug über dem Vorlauf von 2 Stunden). */
const inTagen = (n: number, stunde = 10) => {
  const d = new Date(Date.now() + n * 86400000)
  d.setUTCHours(stunde, 0, 0, 0)
  return d.toISOString()
}
const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60000).toISOString()
const zid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function standBesichtigung() {
  const s = stand()
  const zugestimmt = { am: '2026-11-21T10:00:00Z', name: 'Erika Muster' }
  Object.assign(s.objekt_freigaben[0], { status: 'zugestimmt', zustimmung: zugestimmt, email: 'erika@example.test', kunde_bereich: 'immobilienkunden' })
  s.objekt_freigaben.push({ id: 'f2', token: TOKEN2, objekt_id: 'o1', kunde_id: null, name: 'Max Probe', provision: '3 %', status: 'zugestimmt', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 0, zustimmung: { am: zugestimmt.am, name: 'Max Probe' }, telefon: '0731 12345' } as never)
  const z = (n: number, beginn: string, extra: Record<string, unknown> = {}) => ({ id: zid(n), objekt_id: 'o1', beginn, ende: plus(beginn, 30), plaetze: 1, makler: 'Quirin Lutzenberger', treffpunkt: 'Vor dem Haus', status: 'offen', ...extra })
  return {
    ...s,
    objekt_freigaben: s.objekt_freigaben as unknown as Zeile[],
    besichtigung_zeiten: [
      z(1, inTagen(2, 9)),
      z(2, inTagen(2, 11)), // überschneidet einen CRM-Termin des Maklers
      z(3, inTagen(3, 9)), // überschneidet den eigenen Kalender des Maklers
      z(4, inTagen(4, 9)), // ganztägiger Eintrag im eigenen Kalender, sperrt nicht
      z(5, inTagen(5, 9), { plaetze: 2 }),
      z(6, inTagen(6, 9), { status: 'abgesagt' }),
      z(7, new Date(Date.now() + STUNDE).toISOString()), // zu kurzfristig
      z(8, inTagen(2, 9), { objekt_id: 'o2' }), // anderes Objekt
    ],
    besichtigungen: [] as Zeile[],
    termine: [{ id: 't-alt', titel: 'Notar', beginn: inTagen(2, 11), ende: plus(inTagen(2, 11), 60), ganztags: false, besitzer_email: 'quirin@example.test', teilnehmer: [] }] as Zeile[],
    kalender_fremd: [{ email: 'quirin@example.test', belegt: [{ b: inTagen(3, 8), e: inTagen(3, 10) }, { b: inTagen(4, 0), e: inTagen(5, 0), g: true }] }],
    mitarbeiter: [{ name: 'Quirin Lutzenberger', email: 'Quirin@example.test', telegram_chat_id: 1, aktiv: true }],
  }
}

Deno.test('Serie „jeden Di 16–18 Uhr, 30 Minuten, 3 Wochen“ in deutscher Zeit', () => {
  const jetzt = new Date('2026-11-22T12:00:00Z') // Sonntag
  const z = serienZeiten({ wochentage: [2], von: '16:00', bis: '18:00', dauerMin: 30, wochen: 3 }, jetzt)
  assertEquals(z.length, 12)
  assertEquals(z[0], { beginn: '2026-11-24T15:00:00.000Z', ende: '2026-11-24T15:30:00.000Z' })
  assertEquals(z[3].beginn, '2026-11-24T16:30:00.000Z')
  assertEquals(z[11].beginn, '2026-12-08T16:30:00.000Z')
  // Am selben Tag nur, was noch in der Zukunft liegt.
  const amDienstag = serienZeiten({ wochentage: [2], von: '16:00', bis: '18:00', dauerMin: 30, wochen: 1 }, new Date('2026-11-24T15:20:00Z'))
  assertEquals(amDienstag.map((x) => x.beginn), ['2026-11-24T15:30:00.000Z', '2026-11-24T16:00:00.000Z', '2026-11-24T16:30:00.000Z'])
  // Sommerzeit und die fehlende Stunde bei der Umstellung
  assertEquals(einzelZeit('2027-06-01', '16:00', 45), { beginn: '2027-06-01T14:00:00.000Z', ende: '2027-06-01T14:45:00.000Z' })
  assertEquals(einzelZeit('2027-03-28', '02:30', 30), null)
  assertEquals(serienZeiten({ wochentage: [2], von: '18:00', bis: '16:00', dauerMin: 30, wochen: 3 }, jetzt), [])
})

Deno.test('Portal zeigt nur freie Zeiten (Kalender, Plätze, Vorlauf, abgesagt, anderes Objekt)', async () => {
  const r = await portalLaden(fakeAdmin(standBesichtigung()), TOKEN)
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assertEquals(r.besichtigung.zeiten.map((z) => z.id), [zid(1), zid(4), zid(5)])
  assertEquals(r.besichtigung.zeiten[2].freiePlaetze, 2)
  assertEquals(r.besichtigung.meine, null)
})

Deno.test('Vor der Zustimmung: keine Besichtigung, kein Buchen', async () => {
  const t = standBesichtigung()
  t.objekt_freigaben[0].status = 'eingeladen'
  const admin = fakeAdmin(t)
  const seite = await portalLaden(admin, TOKEN)
  assertEquals(seite.stufe, 'zustimmung')
  assert(!('besichtigung' in seite))
  const r = await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(1) })
  assertEquals(r.stufe, 'fehler')
  assertEquals(t.besichtigungen.length, 0)
  assertEquals((await portalBesichtigung(admin, 'falsch', { art: 'buchen', zeitId: zid(1) })).stufe, 'ungueltig')
  t.objekt_freigaben[1].status = 'widerrufen'
  assertEquals((await portalBesichtigung(admin, TOKEN2, { art: 'buchen', zeitId: zid(1) })).stufe, 'ungueltig')
  // Zeit eines anderen Objekts lässt sich nicht buchen.
  t.objekt_freigaben[0].status = 'zugestimmt'
  assertEquals((await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(8) })).stufe, 'fehler')
  assertEquals(t.besichtigungen.length, 0)
})

Deno.test('Buchen legt Besichtigung, Kalendertermin, Verlauf und Meldung an', async () => {
  const t = standBesichtigung()
  const admin = fakeAdmin(t)
  const meldungen: { wer: string; text: string }[] = []
  const r = await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(1), telefon: '0176 1234567' }, (wer, text) => Promise.resolve(void meldungen.push({ wer, text })))
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assertMatch(r.hinweis ?? '', /eingetragen/)
  assertEquals(r.besichtigung.meine?.beginn, t.besichtigung_zeiten[0].beginn)
  assertEquals(r.besichtigung.meine?.treffpunkt, 'Vor dem Haus')
  assertEquals(r.besichtigung.zeiten, [])
  assertEquals(t.besichtigungen.length, 1)
  const b = t.besichtigungen[0]
  assertEquals([b.status, b.interessent, b.email, b.telefon, b.kunde_id, b.kunde_bereich, b.durchgefuehrt_von, b.freigabe_id], ['geplant', 'Erika Muster', 'erika@example.test', '0176 1234567', 'k1', 'immobilienkunden', 'Quirin Lutzenberger', 'f1'])
  const termin = t.termine.find((x) => x.id === b.kalender_termin_id)!
  assertEquals([termin.besitzer_email, termin.beginn, termin.quelle, termin.gast ?? null], ['quirin@example.test', b.beginn, 'portal', null])
  assertEquals(t.objekte[0].activities.length, 1)
  assertEquals(t.kunden[0].activities.length, 1)
  assertEquals(meldungen.length, 1)
  assertEquals(meldungen[0].wer, 'Quirin Lutzenberger')
  assertEquals(t.objekt_freigaben[0].telefon, '0176 1234567')
  // Zweiter Termin für denselben Interessenten: erst absagen.
  const nochmal = await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(4) })
  assertEquals(nochmal.stufe, 'fehler')
  assertEquals(t.besichtigungen.length, 1)
})

Deno.test('Gleichzeitig auf den letzten Platz: genau eine Buchung', async () => {
  const t = standBesichtigung()
  const admin = fakeAdmin(t)
  // Jede Abfrage gibt die Kontrolle ab, damit beide Anfragen ihre Vorprüfung bestehen, bevor eine bucht.
  admin.db.nachAbfrage = () => new Promise((fertig) => setTimeout(fertig, 0))
  const [a, b] = await Promise.all([
    portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(1) }),
    portalBesichtigung(admin, TOKEN2, { art: 'buchen', zeitId: zid(1) }),
  ])
  assertEquals(admin.rpcAufrufe.length, 2)
  assertEquals([a.stufe, b.stufe].sort(), ['fehler', 'frei'])
  const verlierer = (a.stufe === 'fehler' ? a : b) as { grund: string }
  assertMatch(verlierer.grund, /nicht mehr frei/)
  assertEquals(t.besichtigungen.length, 1)
  assertEquals(t.termine.filter((x) => x.quelle === 'portal').length, 1)
})

Deno.test('Zeit mit zwei Plätzen: der eigene Termin der ersten Buchung sperrt die zweite nicht', async () => {
  const t = standBesichtigung()
  const admin = fakeAdmin(t)
  assertEquals((await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(5) })).stufe, 'frei')
  const zweite = await portalLaden(admin, TOKEN2)
  if (zweite.stufe !== 'frei') throw new Error('erwartet frei')
  assertEquals(zweite.besichtigung.zeiten.find((z) => z.id === zid(5))?.freiePlaetze, 1)
  assertEquals((await portalBesichtigung(admin, TOKEN2, { art: 'buchen', zeitId: zid(5) })).stufe, 'frei')
  const danach = await portalLaden(admin, TOKEN2)
  if (danach.stufe !== 'frei') throw new Error('erwartet frei')
  assertEquals(danach.besichtigung.meine?.id, t.besichtigungen[1].id)
  // Für einen dritten wäre die Zeit voll.
  t.besichtigungen[1].freigabe_id = 'f-anders'
  const dritter = await portalLaden(admin, TOKEN2)
  if (dritter.stufe !== 'frei') throw new Error('erwartet frei')
  assert(!dritter.besichtigung.zeiten.some((z) => z.id === zid(5)))
})

Deno.test('Absagen: Besichtigung abgesagt, Kalendertermin weg, Zeit wieder frei; fremde Buchung nicht absagbar', async () => {
  const t = standBesichtigung()
  const admin = fakeAdmin(t)
  const meldungen: string[] = []
  const melde = (_w: string, text: string) => Promise.resolve(void meldungen.push(text))
  await portalBesichtigung(admin, TOKEN, { art: 'buchen', zeitId: zid(1) }, melde)
  const id = String(t.besichtigungen[0].id)
  const fremd = await portalBesichtigung(admin, TOKEN2, { art: 'absagen', besichtigungId: id }, melde)
  assertEquals(fremd.stufe, 'fehler')
  assertEquals(t.besichtigungen[0].status, 'geplant')
  const r = await portalBesichtigung(admin, TOKEN, { art: 'absagen', besichtigungId: id }, melde)
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assertMatch(r.hinweis ?? '', /abgesagt/)
  assertEquals(t.besichtigungen[0].status, 'abgesagt')
  assertEquals(t.besichtigungen[0].kalender_termin_id, null)
  assertEquals(t.termine.filter((x) => x.quelle === 'portal').length, 0)
  assertEquals(r.besichtigung.meine, null)
  assert(r.besichtigung.zeiten.some((z) => z.id === zid(1)))
  assertEquals(meldungen.length, 2)
  assertEquals(t.objekte[0].activities.length, 2)
  // Zweimal absagen geht nicht.
  assertEquals((await portalBesichtigung(admin, TOKEN, { art: 'absagen', besichtigungId: id })).stufe, 'fehler')
})

Deno.test('Rückrufwunsch: Telefon nötig, höchstens einmal je Tag gemeldet', async () => {
  const t = standBesichtigung()
  const admin = fakeAdmin(t)
  const meldungen: string[] = []
  const melde = (_w: string, text: string) => Promise.resolve(void meldungen.push(text))
  assertEquals((await portalBesichtigung(admin, TOKEN, { art: 'rueckruf' }, melde)).stufe, 'fehler')
  assertEquals((await portalBesichtigung(admin, TOKEN, { art: 'rueckruf', telefon: 'abc' }, melde)).stufe, 'fehler')
  const r = await portalBesichtigung(admin, TOKEN, { art: 'rueckruf', telefon: '+49 731 555', nachricht: 'Gern abends' }, melde)
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assert(r.besichtigung.rueckrufAm)
  assertEquals(meldungen.length, 1)
  assertMatch(meldungen[0], /\+49 731 555/)
  assertEquals(t.objekte[0].activities.length, 1)
  const zweiter = await portalBesichtigung(admin, TOKEN, { art: 'rueckruf', telefon: '+49 731 555' }, melde)
  if (zweiter.stufe !== 'frei') throw new Error('erwartet frei')
  assertMatch(zweiter.hinweis ?? '', /schon vor/)
  assertEquals(meldungen.length, 1)
})
