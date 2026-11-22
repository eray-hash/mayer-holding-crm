// Prüft die Online-Unterschrift mit einer nachgebauten Datenbank (ohne Netz): Laden, Frist, Pflichtfelder,
// Unterschreiben (Nachweis, PDF in der Akte, Signatur, Telegram), doppelt Absenden, Ablehnen, Kopie-Schalter.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { beantworteUnterschrift, pfadName, pruefeName, pruefeUnterschrift, unterschriftAbsenden, unterschriftLaden } from './unterschrift.ts'
import { erzeugeUnterschriftPdf } from './unterschriftPdf.ts'
import { offeneFelderIn, schnappschuss, setzeKundenwerte, zerlegeText } from '../_shared/unterschriftKern.ts'

const TOKEN = 'B'.repeat(43)
const META = { ip: '203.0.113.7', geraet: 'Testbrowser/1.0' }

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

function fakeAdmin(t: Record<string, Zeile[]>) {
  const hochgeladen: { pfad: string; bytes: Uint8Array }[] = []
  function q(tab: string, art: 'select' | 'update', werte?: Zeile) {
    const f: ((z: Zeile) => boolean)[] = []
    let antwort = art === 'select'
    const lauf = () => {
      const treffer = (t[tab] ?? []).filter((z) => f.every((x) => x(z)))
      if (art === 'update') for (const z of treffer) Object.assign(z, structuredClone(werte))
      return { data: antwort ? structuredClone(treffer) : null, error: null }
    }
    // deno-lint-ignore no-explicit-any
    const o: any = {
      select: () => ((antwort = true), o),
      eq: (k: string, v: unknown) => (f.push((z) => z[k] === v), o),
      maybeSingle: () => Promise.resolve({ data: lauf().data?.[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (a: any, b: any) => Promise.resolve(lauf()).then(a, b),
    }
    return o
  }
  return {
    hochgeladen,
    admin: {
      from: (tab: string) => ({ select: () => q(tab, 'select'), update: (w: Zeile) => q(tab, 'update', w) }),
      storage: {
        from: () => ({
          upload: (pfad: string, bytes: Uint8Array) => (hochgeladen.push({ pfad, bytes }), Promise.resolve({ data: { path: pfad }, error: null })),
          createSignedUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/${pfad}?sig` }, error: null }),
        }),
      },
    },
  }
}

const VORLAGE = `# Beratungsvereinbarung
**Mandant / Auftraggeber:** {{Mandant / Auftraggeber}}
Anschrift: {{Anschrift}}
Telefon: {{Telefon}}
Honorar: **{{Honorar in Euro=3.250,00}} Euro**
☐ Erstberatung ☒ Folgeberatung
Ort / Datum: {{Ort, Datum}}
**Berater** || **Auftraggeber**
Name: {{Name Berater}} || Name: {{Name Auftraggeber}}`

function stand(): Record<string, Zeile[]> {
  const text = schnappschuss(VORLAGE, { 'Mandant / Auftraggeber': 'Erika Muster', 'Honorar in Euro': '3.250,00', 'Name Berater': 'Hasan Süslü', 'Name Auftraggeber': 'Erika Muster' }, [0], ['Anschrift', 'Telefon', 'Ort, Datum'])
  return {
    unterschrift_anfragen: [{
      id: '11111111-2222-3333-4444-555555555555', token: TOKEN, kunde_id: 'k1', bereich: 'beratung', titel: 'Beratungsvereinbarung', kopfstil: 'vertrag',
      ausgefuellter_text: text, felder_kunde: [{ name: 'Anschrift', pflicht: true }, { name: 'Telefon', pflicht: false }, { name: 'Ort, Datum', pflicht: true }],
      email: 'erika@example.com', an_name: 'Erika Muster', status: 'offen', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 0,
      unterschrieben_am: null, name_getippt: null, dokument: null, erstellt_von: 'Hasan Süslü', erstellt_am: '2026-11-22T09:00:00Z',
    }],
    kunden: [{ id: 'k1', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: 'Erika Muster', email: 'erika@example.com', verantwortlich: 'Hasan Süslü', verantwortlich_email: 'h@x.de', dokumente: [{ id: 'alt', name: 'alt.pdf' }], activities: [], signaturen: [] }],
    unterschrift_einstellung: [{ id: 1, kopie_an_kunde: false }],
  }
}

// Echtes kleines PNG (40×12, ein Strich) wie vom Unterschriftenfeld.
function pngDataUrl(): Promise<string> {
  return Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAMCAYAAAAQw/9NAAAALElEQVR4nGOQ07RmGMx4wB0w6sBRB0IZ/6F40LFHHUgtBw5aPOAOGHUgrTEAodBBgtso6fEAAAAASUVORK5CYII=')
}

Deno.test('Schnappschuss: Werte eingesetzt, Kundenfelder offen, Kästchen gesetzt, leere Felder als Linie', () => {
  const s = schnappschuss('A {{X}} B {{Y=v}} C {{Z}} ☐ ☐', { X: 'eins', Y: '' }, [1], ['Z'])
  assertEquals(s, 'A eins B ____________________ C {{Z}} ☐ ☒')
  assertEquals(offeneFelderIn(s), ['Z'])
  assertEquals(setzeKundenwerte(s, { Z: 'a{{b}}**c | d\n#e' }), 'A eins B ____________________ C abc / d, #e ☐ ☒')
  const b = zerlegeText('# T\n## U\n  x **y**\na || b\nc | d\ne | f')
  assertEquals(b.map((x) => x.art), ['titel', 'ueberschrift', 'zeile', 'tabelle', 'tabelle'])
})

Deno.test('Name und Unterschrift werden streng geprüft', async () => {
  assertEquals(pruefeName('Erika'), null)
  assertEquals(pruefeName('  Erika   Muster '), 'Erika Muster')
  assert('fehler' in pruefeUnterschrift('data:image/jpeg;base64,AAAA'))
  assert('fehler' in pruefeUnterschrift('data:image/png;base64,' + btoa('kein png, aber lang genug '.repeat(10))))
  assert('bytes' in pruefeUnterschrift(await pngDataUrl()))
  assertEquals(pfadName('Allgemeine Vollmacht (über den Tod hinaus)'), 'Allgemeine_Vollmacht_ueber_den_Tod_hinaus_unterschrieben.pdf')
})

Deno.test('Laden: ungültig, abgelaufen, zurückgezogen, offen', async () => {
  const t = stand()
  assertEquals((await unterschriftLaden(fakeAdmin(t).admin, 'kurz')).stufe, 'ungueltig')
  const r = await unterschriftLaden(fakeAdmin(t).admin, TOKEN)
  assertEquals(r.stufe, 'offen')
  if (r.stufe !== 'offen') return
  assertEquals(r.felder.map((f) => f.name), ['Anschrift', 'Telefon', 'Ort, Datum'])
  assertStringIncludes(r.text, '{{Anschrift}}')
  assertStringIncludes(r.text, 'Erika Muster')
  assertEquals(r.anrede, 'Guten Tag Erika Muster,')
  assertEquals(t.unterschrift_anfragen[0].zugriffe, 1)
  t.unterschrift_anfragen[0].gueltig_bis = '2000-01-01T00:00:00Z'
  const ab = await unterschriftLaden(fakeAdmin(t).admin, TOKEN)
  assertEquals(ab.stufe, 'ungueltig')
  assertEquals(t.unterschrift_anfragen[0].status, 'abgelaufen')
  const t2 = stand()
  t2.unterschrift_anfragen[0].status = 'zurueckgezogen'
  const z = await unterschriftLaden(fakeAdmin(t2).admin, TOKEN)
  assert(z.stufe === 'ungueltig' && z.grund.includes('zurückgezogen'))
})

Deno.test('Absenden: Pflichtangaben fehlen → nichts gespeichert', async () => {
  const t = stand()
  const { admin } = fakeAdmin(t)
  const png = await pngDataUrl()
  assertEquals((await unterschriftAbsenden(admin, TOKEN, { gelesen: false, name: 'Erika Muster', unterschrift: png, werte: {} }, META)).status, 400)
  const ohneFeld = await unterschriftAbsenden(admin, TOKEN, { gelesen: true, name: 'Erika Muster', unterschrift: png, werte: { Anschrift: 'Weg 1' } }, META)
  assertEquals(ohneFeld.status, 400)
  assertStringIncludes(String(ohneFeld.body.error), 'Ort, Datum')
  assertEquals((await unterschriftAbsenden(admin, TOKEN, { gelesen: true, name: 'Erika', unterschrift: png, werte: { Anschrift: 'Weg 1', 'Ort, Datum': 'Ulm' } }, META)).status, 400)
  assertEquals(t.unterschrift_anfragen[0].status, 'offen')
})

Deno.test('Absenden: Nachweis, PDF in der Akte, Signatur, Telegram; doppelt ändert nichts; keine Kopie bei Schalter aus', async () => {
  const t = stand()
  const { admin, hochgeladen } = fakeAdmin(t)
  const gemeldet: { an: unknown; text: string }[] = []
  const kopien: string[] = []
  const helfer = {
    jetzt: new Date('2026-11-22T13:05:00Z'),
    melde: (an: unknown, text: string) => (gemeldet.push({ an, text }), Promise.resolve()),
    sendeKopie: (an: string) => (kopien.push(an), Promise.resolve()),
  }
  const eingabe = { gelesen: true, name: ' Erika  Muster ', unterschrift: await pngDataUrl(), werte: { Anschrift: 'Hauptstraße 1, 89073 Ulm', 'Ort, Datum': 'Ulm, 22.11.2026', Fremd: 'x' } }
  const r = await unterschriftAbsenden(admin, TOKEN, eingabe, META, helfer)
  assertEquals(r.status, 200)
  assertEquals(r.body.stufe, 'unterschrieben')
  assertMatch(String(r.body.kopieUrl), /^https:\/\/speicher\.test\/k1\/dok_/)
  const a = t.unterschrift_anfragen[0]
  assertEquals(a.status, 'unterschrieben')
  assertEquals(a.name_getippt, 'Erika Muster')
  assertEquals(a.ip, '203.0.113.7')
  assertEquals(a.kunden_werte, { Anschrift: 'Hauptstraße 1, 89073 Ulm', 'Ort, Datum': 'Ulm, 22.11.2026' })
  assertStringIncludes(a.endgueltiger_text, 'Anschrift: Hauptstraße 1, 89073 Ulm')
  assertStringIncludes(a.endgueltiger_text, 'Telefon: ____________________')
  assertEquals(a.pruefsumme.length, 64)
  assertEquals(hochgeladen.length, 1)
  assertMatch(hochgeladen[0].pfad, /^k1\/dok_[0-9a-f]{16}_Beratungsvereinbarung_unterschrieben\.pdf$/)
  assertEquals(a.dokument, hochgeladen[0].pfad)
  const pdf = await PDFDocument.load(hochgeladen[0].bytes)
  assert(pdf.getPageCount() >= 1)
  const k = t.kunden[0]
  assertEquals(k.dokumente.length, 2)
  assertEquals(k.dokumente[0].url, hochgeladen[0].pfad)
  assertEquals(k.signaturen.length, 1)
  assertEquals(k.signaturen[0].kontext, 'Beratungsvereinbarung')
  assertStringIncludes(k.activities[0].text, 'Online unterschrieben')
  assertEquals(gemeldet.length, 1)
  assertEquals(gemeldet[0].an, { name: 'Hasan Süslü', email: 'h@x.de' })
  assertEquals(kopien.length, 0)

  const nochmal = await unterschriftAbsenden(admin, TOKEN, eingabe, META, helfer)
  assertEquals(nochmal.body.stufe, 'unterschrieben')
  assertEquals(hochgeladen.length, 1)
  assertEquals(k.signaturen.length, 1)
})

Deno.test('Kopie an den Kunden nur mit eingeschaltetem Schalter', async () => {
  const t = stand()
  t.unterschrift_einstellung[0].kopie_an_kunde = true
  const { admin } = fakeAdmin(t)
  const kopien: { an: string; name: string }[] = []
  await unterschriftAbsenden(admin, TOKEN, { gelesen: true, name: 'Erika Muster', unterschrift: await pngDataUrl(), werte: { Anschrift: 'Weg 1', 'Ort, Datum': 'Ulm' } }, META, {
    sendeKopie: (an, _b, _t, anhang) => (kopien.push({ an, name: anhang.filename }), Promise.resolve()),
  })
  assertEquals(kopien, [{ an: 'erika@example.com', name: 'Beratungsvereinbarung_unterschrieben.pdf' }])
  assertStringIncludes(t.kunden[0].activities[0].text, 'Kopie')
})

Deno.test('Ablehnen: Status, Verlauf, Telegram — keine Unterschrift', async () => {
  const t = stand()
  const { admin, hochgeladen } = fakeAdmin(t)
  const gemeldet: string[] = []
  const r = await beantworteUnterschrift(admin, 'public_unterschrift_absenden', { token: TOKEN, ablehnen: true, grund: 'Honorar zu hoch' }, META, { melde: (_a, text) => (gemeldet.push(text), Promise.resolve()) })
  assertEquals(r.body.stufe, 'abgelehnt')
  assertEquals(t.unterschrift_anfragen[0].status, 'abgelehnt')
  assertEquals(t.unterschrift_anfragen[0].ablehnung_grund, 'Honorar zu hoch')
  assertEquals(hochgeladen.length, 0)
  assertEquals(t.kunden[0].signaturen.length, 0)
  assertStringIncludes(t.kunden[0].activities[0].text, 'abgelehnt')
  assertStringIncludes(gemeldet[0], 'Honorar zu hoch')
  assertEquals((await unterschriftLaden(admin, TOKEN)).stufe, 'abgelehnt')
})

Deno.test('PDF: lange Texte, Tabellen und Sonderzeichen gehen durch', async () => {
  const text = `# Allgemeine Vollmacht\n${'Langer Absatz mit Umlauten äöü ß und € und „Anführung“ – Strich. '.repeat(80)}\n## Abschnitt\na | b | c\n1 | 2 | 3\nOrt || Unterschrift\n  • eingerückt → Pfeil ☒ ✓ 😀`
  for (const kopfstil of ['vertrag', 'schlichtSerif', 'fragebogen', 'unbekannt']) {
    const { bytes, seiten } = await erzeugeUnterschriftPdf({
      titel: 'Test', text, kopfstil, unterschriftPng: pruefeUnterschriftBytes(await pngDataUrl()), name: 'Erika Muster', am: new Date('2026-11-22T13:05:00Z'),
      ip: '1.2.3.4', geraet: 'X', vorgang: 'v1', pruefsumme: 'a'.repeat(64), linkAn: 'e@x.de', linkVom: '2026-11-20T08:00:00Z',
    })
    assert(seiten >= 2, kopfstil)
    assertEquals((await PDFDocument.load(bytes)).getPageCount(), seiten)
  }
})

function pruefeUnterschriftBytes(u: string): Uint8Array {
  const r = pruefeUnterschrift(u)
  if (!('bytes' in r)) throw new Error('kein PNG')
  return r.bytes
}
