import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { falscheDatenbank, type FalscheDatenbank } from '../_shared/testDoppel.ts'
import {
  akteZuObjektAktion,
  bezeichnungAusAktenname,
  findeAdressen,
  kaufpreisAus,
  leiteEckdatenAb,
  ordnerNachRegel,
  typAus,
  umzugStarten,
  umzugVorschau,
  umzugWeiter,
  type KiOrdner,
  type UmzugUmgebung,
  type UmzugZeile,
} from './akteZuObjekt.ts'

const BASIS = 'https://test.supabase.co'
Deno.env.set('SUPABASE_URL', BASIS)
const mailUrl = (id: string, name: string) => `${BASIS}/storage/v1/object/public/email-anhaenge/postfach/${id}/${name}`
const bytes = (n: number) => new Uint8Array(n).fill(7)

// ---------- reine Teile ----------

Deno.test('Objektname aus dem Aktennamen', () => {
  assertEquals(bezeichnungAusAktenname('Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)'), { bezeichnung: 'Hotel Gasthof Hirsch Alfdorf', klammer: 'HD-IMMO, Helmut Dick', personen: '' })
  assertEquals(bezeichnungAusAktenname('Christine Schebeck und Michael Bauer – Objekt Bären Böblingen'), { bezeichnung: 'Bären Böblingen', klammer: '', personen: 'Christine Schebeck und Michael Bauer' })
  assertEquals(bezeichnungAusAktenname('Boarding House Remstal (HD-IMMO, Lorch)').bezeichnung, 'Boarding House Remstal')
  assertEquals(bezeichnungAusAktenname('MFH Lorch').bezeichnung, 'MFH Lorch')
})

Deno.test('Adressen in Texten', () => {
  assertEquals(findeAdressen('Hotel in 73553 Alfdorf, Untere Schloßstraße 46 (Kontakt vor Ort)').map((a) => a.adresse), ['Untere Schloßstraße 46, 73553 Alfdorf'])
  assertEquals(findeAdressen('Boarding House in der Teckstraße 62 in 73547 Lorch, Baujahr 2005').map((a) => a.adresse), ['Teckstraße 62, 73547 Lorch'])
  assertEquals(findeAdressen('für das Objekt Teckstraße 62, 73547 Lorch (Hotel Nr. 8)').map((a) => a.schluessel), ['teckstr62'])
  assertEquals(findeAdressen('kein Ort hier, nur 15 Appartements'), [])
})

Deno.test('Kaufpreis und Objektart', () => {
  assertEquals(kaufpreisAus('Der Kaufpreis beträgt € 1.200.000,- zuzüglich 3,57 %'), 1_200_000)
  assertEquals(kaufpreisAus('der Kaufpreis beträgt 2.980.000,00 EUR, die Käuferprovision 3 %'), 2_980_000)
  assertEquals(kaufpreisAus('Kaufpreis von 1,2 Mio'), 1_200_000)
  assertEquals(kaufpreisAus('Provision 3,57 %'), undefined)
  assertEquals(typAus('Hotel Gasthof Hirsch Alfdorf', []), 'Gewerbe')
  assertEquals(typAus('Bären Böblingen', ['Checkliste zu einer Gewerbeimmobilie (Verkehrswert rund 7 Mio. €)']), 'Gewerbe')
  assertEquals(typAus('MFH Lorch', []), 'Haus')
  assertEquals(typAus('Irgendwas', []), 'Haus')
})

// deno-lint-ignore no-explicit-any
const ordnerVon = (r: any): string | undefined => r?.ordner

Deno.test('Ordner nach Regeln', () => {
  assertEquals(ordnerNachRegel({ name: 'DSCN6090.jpg', typ: 'image/jpeg', groesse: '131 KB' }), { ordner: 'Bilder', grund: 'Foto' })
  assert('bleibt' in ordnerNachRegel({ name: 'image001.jpg', typ: 'image/jpeg', groesse: '9 KB' })!)
  assert('bleibt' in ordnerNachRegel({ name: 'image002.png', typ: 'image/png', groesse: '4 KB', zusammenfassung: 'QR-Code. Die Datei zeigt …' })!)
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'EXPOSÉ 2602.pdf', typ: 'application/pdf', groesse: '3.4 MB' })), 'Exposé')
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'Flächen.pdf', groesse: '39 KB', zusammenfassung: 'Flächenaufstellung (Tabelle). Zur Teilungserklärung …' })), 'Wohnflächenberechnung')
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'Broschüre Boarding House k.pdf', zusammenfassung: 'Werbebroschüre / Flyer. …' })), 'Exposé')
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'Widerrufsbelehrung.pdf' })), 'Verträge')
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'Grundbuchauszug_Blatt_123.pdf' })), 'Grundbuch')
  assertEquals(ordnerVon(ordnerNachRegel({ name: 'Mail vom 12.11.eml' })), 'Aktennotiz')
  assertEquals(ordnerNachRegel({ name: 'Mandanten-Anforderungsliste-Nachfolgeprojekt.docx', zusammenfassung: 'Dies ist eine Mandanten-Anforderungsliste' }), null)
})

Deno.test('Eckdaten: die Adresse des Hotels gewinnt, nicht die des Boarding House aus derselben Akte', () => {
  const e = leiteEckdatenAb(
    {
      firma: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)',
      ansprechpartner: 'Helmut Dick',
      email: 'info@hdimmo.de',
      telefon: '07162 45569',
      activities: [
        { text: 'E-Mail automatisch zugeordnet: „Boarding House Lorch-Weitmars“', user: 'System (automatische E-Mail-Zuordnung)' },
        { text: 'OFFMARKET-Objekt. Makler Helmut Dick (HD-IMMO, Süßen) bietet der Holding ein Metageschäft an. Objekt: Hotel, 73553 Alfdorf, Untere Schloßstraße 46. Kaufpreis 2.980.000 €, Käuferprovision 3 %.', user: 'Andreas Mayer' },
      ],
    },
    [
      { name: 'EXPOSÉ 2602.pdf', zusammenfassung: 'Immobilienexposé. Boarding House in der Teckstraße 62 in 73547 Lorch. Der Kaufpreis beträgt € 1.200.000,-.' },
      { name: 'Flächen.pdf', zusammenfassung: 'Flächenaufstellung. Objekt Teckstraße 62, 73547 Lorch.' },
      { name: 'Expose_HD-IMMO_Hotel-Gasthof-Hirsch.pdf', zusammenfassung: 'Immobilienexposé. Hotel in 73553 Alfdorf, Untere Schloßstraße 46; der Kaufpreis beträgt 2.980.000,00 EUR.' },
    ],
  )
  assertEquals(e.bezeichnung, 'Hotel Gasthof Hirsch Alfdorf')
  assertEquals(e.adresse, 'Untere Schloßstraße 46, 73553 Alfdorf')
  assertEquals(e.kaufpreis, 2_980_000)
  assertEquals(e.typ, 'Gewerbe')
  assertEquals(e.nichtOeffentlich, true)
  assertEquals(e.anbieter, { art: 'Makler', name: 'Helmut Dick', firma: 'HD-IMMO', telefon: '07162 45569', email: 'info@hdimmo.de' })
  assertEquals(e.eigentuemer, null)
})

Deno.test('Eckdaten: Personen – Objekt X → Eigentümer statt Makler', () => {
  const e = leiteEckdatenAb({ firma: 'Christine Schebeck und Michael Bauer – Objekt Bären Böblingen', ansprechpartner: 'Christine Schebeck, Michael Bauer', email: 'c@example.org', telefon: '', activities: [] }, [])
  assertEquals(e.bezeichnung, 'Bären Böblingen')
  assertEquals(e.anbieter, null)
  assertEquals(e.eigentuemer?.name, 'Christine Schebeck und Michael Bauer')
})

// ---------- Ablauf mit Testdatenbank ----------

type Fall = { db: FalscheDatenbank; kiAufrufe: number[] }

async function hirschFall(): Promise<Fall> {
  const dok = (id: string, name: string, typ: string, groesse: string, url: string) => ({ id, name, typ, groesse, url, datum: '2026-11-22' })
  const fotos = Array.from({ length: 30 }, (_, i) => dok(`f${i}`, `DSCN${6090 + i}.jpg`, 'image/jpeg', '120 KB', mailUrl(`m2f${i}`, `${i + 7}_DSCN${6090 + i}.jpg`)))
  const doks = [
    dok('l1', 'image001.jpg', 'image/jpeg', '9 KB', mailUrl('m1a', '1_image001.jpg')),
    dok('h1', 'Expose Hotel Gasthof Hirsch Juli 2026 298 HD.pdf', 'application/pdf', '3.8 MB', mailUrl('m1b', '3_Expose_Hotel_Gasthof_Hirsch.pdf')),
    dok('l2', 'image001.jpg', 'image/jpeg', '9 KB', mailUrl('m2a', '1_image001.jpg')),
    dok('b1', 'EXPOSÉ 2602.pdf', 'application/pdf', '3.4 MB', mailUrl('m2b', '3_EXPOSE__2602.pdf')),
    dok('b2', 'Flächen.pdf', 'application/pdf', '39 KB', mailUrl('m2c', '5_Fla_chen.pdf')),
    ...fotos,
    dok('b3', 'EXPOSÉ 2602.pdf', 'application/pdf', '3.4 MB', mailUrl('m3b', '3_EXPOSE__2602.pdf')),
    dok('t1', 'Expose_HD-IMMO_Hotel-Gasthof-Hirsch.pdf', 'application/pdf', '3.7 MB', `${BASIS}/storage/v1/object/public/email-anhaenge/telegram/1795_h7_Expose_HD-IMMO_Hotel-Gasthof-Hirsch.pdf`),
    dok('x1', 'Arbeitspapier_Nachfolge.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '20 KB', 'k_hirsch/x1_Arbeitspapier.docx'),
    dok('x2', 'ohne_datei.pdf', 'application/pdf', '1 KB', ''),
  ]
  const db = falscheDatenbank({
    kunden: [{
      id: 'k_hirsch',
      bereich: 'immobilienkunden',
      firma: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)',
      ansprechpartner: 'Helmut Dick',
      email: 'info@hdimmo.de',
      telefon: '07162 45569',
      verantwortlich: 'Andreas Mayer',
      dokumente: doks,
      activities: [{ id: 'a1', date: '2026-11-20', text: 'Makler Helmut Dick (HD-IMMO) bietet an: Hotel, 73553 Alfdorf, Untere Schloßstraße 46. Kaufpreis 2.980.000 €.', user: 'Andreas Mayer' }],
    }],
    objekte: [{
      id: 'o_remstal',
      bezeichnung: 'Boarding House Remstal',
      adresse: 'Teckstraße 62, 73547 Lorch-Weitmars',
      typ: 'Gewerbe',
      privat_besitzer: null,
      activities: [],
      dokumente: { 'Exposé': [{ id: 'dok_alt', name: 'Expose_HD-IMMO.pdf', groesse: '3.4 MB', url: 'o_remstal/dok_alt_Expose.pdf', herkunft: `${BASIS}/storage/v1/object/public/email-anhaenge/telegram/alt.pdf` }] },
    }],
    eingegangene_emails: [
      { id: 'mail1', message_id: 'a', betreff: 'Hotel / Boarding House Alfdorf', zugewiesener_kunde_id: 'k_hirsch', anhaenge: [{ url: doks[0].url }, { url: doks[1].url }] },
      { id: 'mail2', message_id: 'b', betreff: 'Boarding House Lorch-Weitmars', zugewiesener_kunde_id: 'k_hirsch', anhaenge: [doks[2], doks[3], doks[4], ...fotos].map((d) => ({ url: d.url })) },
      { id: 'mail3', message_id: 'c', betreff: 'Boarding House Lorch-Weitmars', zugewiesener_kunde_id: 'k_hirsch', anhaenge: [{ url: doks[doks.length - 4].url }] },
    ],
    dokument_inhalte: [
      { schluessel: 'email-anhaenge/postfach/m2b/3_EXPOSE__2602.pdf', zusammenfassung: 'Immobilienexposé. Boarding House in der Teckstraße 62 in 73547 Lorch. Der Kaufpreis beträgt € 1.200.000,-.', status: 'gelesen', inhalt: 'voll' },
      { schluessel: 'email-anhaenge/postfach/m2c/5_Fla_chen.pdf', zusammenfassung: 'Flächenaufstellung (Tabelle). Objekt Teckstraße 62, 73547 Lorch.', status: 'gelesen', inhalt: 'voll' },
      { schluessel: 'email-anhaenge/telegram/1795_h7_Expose_HD-IMMO_Hotel-Gasthof-Hirsch.pdf', zusammenfassung: 'Immobilienexposé. Hotel in 73553 Alfdorf, Untere Schloßstraße 46; der Kaufpreis beträgt 2.980.000,00 EUR.', status: 'gelesen', inhalt: 'voll' },
      { schluessel: 'email-anhaenge/postfach/m1a/1_image001.jpg', zusammenfassung: 'Firmenlogo. HD-IMMO.', status: 'gelesen', inhalt: '' },
      { schluessel: 'kunden-dokumente/k_hirsch/x1_Arbeitspapier.docx', zusammenfassung: 'Arbeitspapier zu einem Nachfolgeprojekt.', status: 'gelesen', inhalt: '' },
    ],
    mitarbeiter: [{ id: 'm1', name: 'Andreas Mayer', email: 'andreas@example.org', aktiv: true, telegram_chat_id: 42 }, { id: 'm2', name: 'Eray Yesil', email: 'eray@example.org', aktiv: true, telegram_chat_id: 7 }],
    akte_umzug: [],
  })
  for (const d of doks) {
    if (!d.url) continue
    const eimer = d.url.startsWith('http') ? 'email-anhaenge' : 'kunden-dokumente'
    const pfad = d.url.startsWith('http') ? decodeURIComponent(d.url.split('/object/public/email-anhaenge/')[1]) : d.url
    await db.storage.from(eimer).upload(pfad, bytes(d.id.startsWith('f') ? 1000 : 3000), { contentType: d.typ })
  }
  return { db, kiAufrufe: [] }
}

function umgebung(f: Fall, extra: Partial<UmzugUmgebung> = {}): UmzugUmgebung {
  const ki: KiOrdner = ({ dokumente }) => {
    f.kiAufrufe.push(dokumente.length)
    return Promise.resolve(Object.fromEntries(dokumente.map((d) => [d.nr, 'Sonstiges'])))
  }
  return { admin: f.db, aufrufer: { email: 'eray@example.org', name: 'Eray Yesil' }, heute: '2026-11-22', ki, ...extra }
}

Deno.test('Vorschau: Ordner, Umleitung zum Boarding House, Logos bleiben, doppelte einmal, KI nur für den Rest', async () => {
  const f = await hirschFall()
  const r = await umzugVorschau(umgebung(f), 'k_hirsch')
  assert(r.ok)
  const a = r.antwort
  assertEquals(a.eckdaten.bezeichnung, 'Hotel Gasthof Hirsch Alfdorf')
  assertEquals(a.eckdaten.adresse, 'Untere Schloßstraße 46, 73553 Alfdorf')
  assertEquals(a.eckdaten.kaufpreis, 2_980_000)
  assertEquals(a.eckdaten.typ, 'Gewerbe')
  assertEquals(a.eckdaten.anbieter?.firma, 'HD-IMMO')
  // Neues Objekt: die beiden Hirsch-Exposés und das Arbeitspapier (KI → Sonstiges)
  assertEquals(a.ordnerZahlen, { 'Exposé': 2, Sonstiges: 1 })
  // Boarding House: 30 Fotos + Exposé + Flächen (Exposé doppelt nur einmal)
  assertEquals(a.andereZiele, [{ id: 'o_remstal', name: 'Boarding House Remstal', anzahl: 32 }])
  assertEquals(a.doppelt, 1)
  assertEquals(a.bleiben, 3) // zwei Logos, ein Eintrag ohne Datei
  assertEquals(f.kiAufrufe, [1])
  const b1 = a.dokumente.find((d) => d.id === 'b1')!
  assertMatch(b1.grund, /liegt dort schon/)
  assert(a.hinweise.some((h) => /Boarding House Remstal/.test(h)))
  // Zweiter Aufruf nimmt dieselbe Vorschau (keine neue KI)
  const r2 = await umzugVorschau(umgebung(f), 'k_hirsch')
  assert(r2.ok && r2.antwort.umzugId === a.umzugId)
  assertEquals(f.kiAufrufe, [1])
})

Deno.test('Start + Weiter in Blöcken: wiederaufnehmbar, Akte erst am Ende geleert, Inhalte mitgenommen', async () => {
  const f = await hirschFall()
  let uhr = 1_800_000_000_000
  const gesendet: string[] = []
  const u = umgebung(f, { jetzt: () => uhr, sendeTelegram: (chat, t) => (gesendet.push(`${chat}:${t}`), Promise.resolve(true)) })
  const v = await umzugVorschau(u, 'k_hirsch')
  assert(v.ok)
  const s = await umzugStarten(u, { umzugId: v.antwort.umzugId, eckdaten: { kaufpreis: '2,98 Mio' }, quelle: 'telegram' })
  assert(s.ok, !s.ok ? s.fehler : '')
  assertEquals(s.antwort.status, 'laeuft')
  const objektId = s.antwort.objektId!
  assertMatch(objektId, /^o_/)
  const neu = f.db.tabelle('objekte').find((o) => o.id === objektId)!
  assertEquals(neu.status, 'akquise')
  assertEquals(neu.verantwortlich, 'Andreas Mayer')
  assertEquals(neu.kaufpreis, 2_980_000)
  assertMatch(String((neu.activities as { text: string }[])[0].text), /Angeboten von Makler Helmut Dick \(HD-IMMO\)/)
  // Doppelter Start legt nichts doppelt an
  const s2 = await umzugStarten(u, { umzugId: v.antwort.umzugId })
  assert(s2.ok && s2.antwort.objektId === objektId)
  assertEquals(f.db.tabelle('objekte').length, 2)

  // Erster Aufruf: Zeit reicht nur für einen Block (die Uhr springt beim zweiten Blick über das Budget)
  let blicke = 0
  const uKurz = { ...u, jetzt: () => (blicke++ < 3 ? uhr : uhr + 200_000) }
  const w1 = await umzugWeiter(uKurz, v.antwort.umzugId)
  assertEquals(w1.weitere, true)
  assert(w1.antwort!.erledigt > 0 && w1.antwort!.erledigt < w1.antwort!.gesamt)
  // Kundenakte unverändert, solange noch Dateien offen sind
  assertEquals((f.db.tabelle('kunden')[0].dokumente as unknown[]).length, 39)

  // Während der Sperre arbeitet kein zweiter Aufruf
  const zeile = f.db.tabelle('akte_umzug')[0] as unknown as UmzugZeile
  f.db.tabelle('akte_umzug')[0].sperre_bis = new Date(uhr + 60_000).toISOString()
  const gesperrt = await umzugWeiter(u, zeile.id)
  assertEquals(gesperrt.weitere, false)
  assertEquals(gesperrt.antwort!.erledigt, w1.antwort!.erledigt)
  f.db.tabelle('akte_umzug')[0].sperre_bis = null

  uhr += 1000
  const w2 = await umzugWeiter(u, v.antwort.umzugId)
  assertEquals(w2.weitere, false)
  assertEquals(w2.antwort!.status, 'fertig')
  assertEquals(w2.antwort!.erledigt, w2.antwort!.gesamt)

  // Neues Objekt: 3 Dateien, Pfade beginnen mit der objekt_id
  const neuDoks = Object.values(f.db.tabelle('objekte').find((o) => o.id === objektId)!.dokumente as Record<string, { url: string }[]>).flat()
  assertEquals(neuDoks.length, 3)
  assert(neuDoks.every((d) => d.url.startsWith(`${objektId}/`)))
  assert(neuDoks.every((d) => f.db.ablage.get('objekt-dokumente')!.has(d.url)))
  // Boarding House: 30 Fotos + Flächen neu, das Exposé lag schon dort (nicht noch einmal)
  const remstal = f.db.tabelle('objekte').find((o) => o.id === 'o_remstal')!
  const rd = remstal.dokumente as Record<string, { url: string }[]>
  assertEquals(rd.Bilder.length, 30)
  assertEquals(rd['Exposé'].length, 1)
  assertEquals(rd['Wohnflächenberechnung'].length, 1)
  assertMatch(String((remstal.activities as { text: string }[])[0].text), /als zu diesem Objekt gehörig erkannt/)
  // Kurzfassung unter dem neuen Speicherort
  const flaechenPfad = rd['Wohnflächenberechnung'][0].url
  assert(f.db.tabelle('dokument_inhalte').some((r) => r.schluessel === `objekt-dokumente/${flaechenPfad}`))
  // Kundenakte: nur Logos und der Eintrag ohne Datei bleiben; Verlauf
  const akte = f.db.tabelle('kunden')[0]
  assertEquals((akte.dokumente as { id: string }[]).map((d) => d.id).sort(), ['l1', 'l2', 'x2'])
  assertMatch(String((akte.activities as { text: string }[])[0].text), /^Objekt umgezogen nach Objektakte „Hotel Gasthof Hirsch Alfdorf“/)
  // Telegram an den Starter (Eray, chat 7), genau einmal
  assertEquals(gesendet.length, 1)
  assertMatch(gesendet[0], /^7:Umzug fertig/)
  // Noch ein Aufruf: nichts passiert mehr
  const w3 = await umzugWeiter(u, v.antwort.umzugId)
  assertEquals(w3.weitere, false)
  assertEquals((f.db.tabelle('kunden')[0].activities as unknown[]).length, 2)
})

Deno.test('behalten=true lässt die Dokumente in der Kundenakte; fehlende Datei bleibt dort und wird gemeldet', async () => {
  const f = await hirschFall()
  // Eine Datei verschwindet aus dem Speicher
  await f.db.storage.from('email-anhaenge').remove(['postfach/m2c/5_Fla_chen.pdf'])
  const u = umgebung(f)
  const v = await umzugVorschau(u, 'k_hirsch')
  assert(v.ok)
  const s = await umzugStarten(u, { umzugId: v.antwort.umzugId, allesInsNeue: true })
  assert(s.ok)
  assertEquals(s.antwort.andereZiele, [])
  const w = await umzugWeiter(u, v.antwort.umzugId)
  assertEquals(w.antwort!.status, 'fertig')
  assertEquals(w.antwort!.fehler.map((x) => x.name), ['Flächen.pdf'])
  const akte = f.db.tabelle('kunden')[0]
  assertEquals((akte.dokumente as unknown[]).length, 39 - (w.antwort!.gesamt - 1))
  assert((akte.dokumente as { id: string }[]).some((d) => d.id === 'b2'))

  const f2 = await hirschFall()
  const u2 = umgebung(f2)
  const v2 = await umzugVorschau(u2, 'k_hirsch')
  assert(v2.ok)
  await umzugStarten(u2, { umzugId: v2.antwort.umzugId, behalten: true })
  await umzugWeiter(u2, v2.antwort.umzugId)
  assertEquals((f2.db.tabelle('kunden')[0].dokumente as unknown[]).length, 39)
  assertMatch(String((f2.db.tabelle('kunden')[0].activities as { text: string }[])[0].text), /liegen zusätzlich weiter hier/)
})

Deno.test('Aktion: vorhandenes Objekt wird erkannt (Dublette), Start mit objekt_id legt dort ab; Hintergrund und Anstoß', async () => {
  const f = await hirschFall()
  // Eine Akte, die das Boarding House selbst ist
  f.db.tabelle('kunden').push({ id: 'k_remstal', bereich: 'immobilienkunden', firma: 'Boarding House Remstal (HD-IMMO, Lorch)', ansprechpartner: 'Marc Ziegler', email: 'z@example.org', telefon: '', verantwortlich: 'Andreas Mayer', dokumente: [], activities: [] })
  const im: Promise<unknown>[] = []
  const angestossen: string[] = []
  const h = { imHintergrund: (p: Promise<unknown>) => void im.push(p), stosseAn: (id: string) => (angestossen.push(id), Promise.resolve()) }
  const u = umgebung(f)
  const v = await akteZuObjektAktion(u, { modus: 'vorschau', kunde_id: 'k_remstal' }, h)
  assertEquals(v.status, 200)
  // deno-lint-ignore no-explicit-any
  const a = v.daten as any
  assertEquals(a.dublette, { id: 'o_remstal', name: 'Boarding House Remstal' })
  const ohne = await akteZuObjektAktion(u, { modus: 'start', umzug_id: a.umzugId }, h)
  assertEquals(ohne.status, 409)
  const mit = await akteZuObjektAktion(u, { modus: 'start', umzug_id: a.umzugId, objekt_id: 'o_remstal' }, h)
  assertEquals(mit.status, 200)
  await Promise.all(im)
  assertEquals(f.db.tabelle('objekte').length, 1)
  // deno-lint-ignore no-explicit-any
  const stand = (await akteZuObjektAktion(u, { modus: 'stand', umzug_id: a.umzugId }, h)).daten as any
  assertEquals(stand.status, 'fertig')
  assertEquals(angestossen, [])
  const falsch = await akteZuObjektAktion(u, { modus: 'quatsch' }, h)
  assertEquals(falsch.status, 400)
})

Deno.test('Rechte und Grenzen', async () => {
  const f = await hirschFall()
  const nein = await umzugVorschau(umgebung(f, { darfKunde: () => Promise.resolve(false) }), 'k_hirsch')
  assert(!nein.ok && nein.status === 403)
  const sammel = await umzugVorschau(umgebung(f), 'k_eingang_ungeklaert')
  assert(!sammel.ok && sammel.status === 400)
  f.db.tabelle('kunden').push({ id: 'k_privat', bereich: 'privat', firma: 'Privat', dokumente: [], activities: [] })
  const privat = await umzugVorschau(umgebung(f), 'k_privat')
  assert(!privat.ok && privat.status === 400)
  const fehlt = await umzugVorschau(umgebung(f), 'k_gibtsnicht')
  assert(!fehlt.ok && fehlt.status === 404)
})
