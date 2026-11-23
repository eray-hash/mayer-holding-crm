// Tests für dokumentLesen.ts — Datenbank als Test-Doppel, kein Netz, keine KI.
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import {
  ersterOffenerTeil,
  fehlerNachAbbruch,
  GLEICHZEITIG,
  istVoruebergehenderFehler,
  istWeiteresTextFormat,
  MAX_VERSUCHE,
  nameZumLesen,
  reiheDokumentEin,
  gruppiereSeiten,
  setzeHaengendeDokumenteFort,
  teileFuer,
  urlAusSchluessel,
  WARTESCHLANGE_ZEIT,
  weitererDateiText,
} from './dokumentLesen.ts'

const BASIS = 'https://abc.supabase.co'
const JETZT = Date.parse('2026-11-23T03:00:00.000Z')
const vor = (min: number) => new Date(JETZT - min * 60_000).toISOString()

// ---------- Teile ----------

Deno.test('teileFuer: bis 6 Seiten am Stück, darüber Teile zu 4 Seiten, höchstens 16', () => {
  assertEquals(teileFuer(0), 1)
  assertEquals(teileFuer(6), 1)
  assertEquals(teileFuer(7), 2)
  assertEquals(teileFuer(12), 3)
  assertEquals(teileFuer(48), 12)
  assertEquals(teileFuer(106), 16)
})

Deno.test('gruppiereSeiten: nach tatsächlicher Seitengröße, höchstens 4 Seiten und etwa 12 MB je Teil', () => {
  const mb = 1024 * 1024
  // Ungleich große Scans: kleine Seiten zusammen, große allein.
  assertEquals(gruppiereSeiten([1, 1, 1, 9, 8, 7, 1, 1].map((x) => x * mb)), [[0, 4], [4, 5], [5, 8]])
  // Höchstens 4 Seiten je Teil.
  assertEquals(gruppiereSeiten(Array(9).fill(0.5 * mb)), [[0, 4], [4, 8], [8, 9]])
  // Eine einzelne übergroße Seite bildet einen eigenen Teil.
  assertEquals(gruppiereSeiten([2 * mb, 25 * mb, 2 * mb]), [[0, 1], [1, 2], [2, 3]])
  assertEquals(gruppiereSeiten([]), [])
})

Deno.test('ersterOffenerTeil: setzt beim ersten fehlenden Teil fort, sonst von vorn', () => {
  assertEquals(ersterOffenerTeil({ teile: null, teile_gesamt: null, seiten: null }), 0)
  assertEquals(ersterOffenerTeil({ teile: { '0': 'a', '1': 'b' }, teile_gesamt: 12, seiten: 48 }), 2)
  assertEquals(ersterOffenerTeil({ teile: { '0': 'a', '2': 'c' }, teile_gesamt: 3, seiten: 12 }), 1)
  // Mit der alten Aufteilung (8 Seiten je Teil: 48 Seiten → 6 Teile) begonnen: von vorn.
  assertEquals(ersterOffenerTeil({ teile: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, teile_gesamt: 6, seiten: 48 }), 0)
  // Alle Teile da, nur der Abschluss fehlte: letzten Teil wiederholen.
  assertEquals(ersterOffenerTeil({ teile: { '0': 'a', '1': 'b', '2': 'c' }, teile_gesamt: 3, seiten: 12 }), 2)
  // Großes PDF (mehr, kleinere Teile): weiter beim offenen Teil.
  assertEquals(ersterOffenerTeil({ teile: { '0': 'a' }, teile_gesamt: 4, seiten: 10 }), 1)
})

// ---------- Fehler ----------

Deno.test('istVoruebergehenderFehler: Zeitgrenze, Überlastung, Netz ja — Dateityp, Größe, leere Antwort nein', () => {
  assert(istVoruebergehenderFehler('Signal timed out.'))
  assert(istVoruebergehenderFehler('The signal has been aborted'))
  assert(istVoruebergehenderFehler('Anthropic-API-Fehler (529): {"type":"overloaded_error"}'))
  assert(istVoruebergehenderFehler('Anthropic-API-Fehler (429): rate_limit_error'))
  assert(istVoruebergehenderFehler('error sending request for url (https://api.anthropic.com/v1/messages): connection reset'))
  assert(!istVoruebergehenderFehler('Dateityp kann nicht gelesen werden'))
  assert(!istVoruebergehenderFehler('Datei größer als 20 MB'))
  assert(!istVoruebergehenderFehler('Anthropic-API-Fehler (400): invalid_request_error'))
  assert(!istVoruebergehenderFehler('Keine Textantwort von der Anthropic-API erhalten (stop_reason: max_tokens).'))
})

Deno.test('fehlerNachAbbruch: Zeitüberschreitung zurück in die Schlange, nach MAX_VERSUCHE endgültig, Rest sofort', () => {
  const iso = vor(0)
  assertEquals(fehlerNachAbbruch('Signal timed out.', 1, iso), { status: 'laeuft', fehler: 'Wird später erneut versucht: Zeitüberschreitung beim Lesen', aktualisiert_am: iso })
  const endgueltig = fehlerNachAbbruch('Signal timed out.', MAX_VERSUCHE, iso)
  assertEquals(endgueltig.status, 'fehler')
  assertStringIncludes(endgueltig.fehler, `${MAX_VERSUCHE} Versuche`)
  assert(!/timed out/.test(endgueltig.fehler), 'keine englische Meldung')
  assertEquals(fehlerNachAbbruch('Datei größer als 20 MB', 1, iso).status, 'fehler')
})

// ---------- Schlüssel → Datei ----------

Deno.test('urlAusSchluessel: Umkehrung von dokumentSchluessel für alle drei Ablagen', () => {
  assertEquals(urlAusSchluessel('kunden-dokumente/k_1/dok_a_BWA.pdf', BASIS), 'k_1/dok_a_BWA.pdf')
  assertEquals(urlAusSchluessel('objekt-dokumente/o_1/expose.pdf', BASIS), 'objekt-dokumente:o_1/expose.pdf')
  const url = urlAusSchluessel('email-anhaenge/DADE_hxcore.ol/Gesellschaftsvertrag v3 › Straße.pdf', BASIS)!
  assertEquals(url, `${BASIS}/storage/v1/object/public/email-anhaenge/DADE_hxcore.ol/Gesellschaftsvertrag%20v3%20%E2%80%BA%20Stra%C3%9Fe.pdf`)
  // dokumentSchluessel (index.ts) dekodiert den Teil nach /object/public/ — ergibt wieder den Schlüssel.
  assertEquals(decodeURIComponent(url.split('/object/public/')[1]), 'email-anhaenge/DADE_hxcore.ol/Gesellschaftsvertrag v3 › Straße.pdf')
  assertEquals(urlAusSchluessel('https://fremd.de/datei.pdf', BASIS), null)
  assertEquals(urlAusSchluessel('kunden-dokumente/../geheim', BASIS), null)
  assertEquals(urlAusSchluessel('unbekannt/x.pdf', BASIS), null)
})

Deno.test('nameZumLesen: ohne Dateiendung den Namen aus dem Speicherort nehmen', () => {
  assertEquals(nameZumLesen('Bank/BWA/BWA.pdf', 'kunden-dokumente/k/x.pdf'), 'Bank/BWA/BWA.pdf')
  assertEquals(nameZumLesen('Foto vom Haus', 'email-anhaenge/telegram/123_foto.jpg'), '123_foto.jpg')
  assertEquals(nameZumLesen('anhang', 'email-anhaenge/a/anhang'), 'anhang')
})

// ---------- Minutentakt ----------

type Zeile = Record<string, unknown>
function zeile(schluessel: string, felder: Zeile): Zeile {
  return { id: schluessel, schluessel, name: schluessel.split('/').pop(), status: 'laeuft', versuche: 1, teile: null, teile_gesamt: null, seiten: null, fehler: null, inhalt: '', ...felder }
}

function aufzeichner() {
  const aufrufe: { url: string; name: string; teil: number; fortsetzen: boolean }[] = []
  return { aufrufe, stosseAn: async (ref: { url: string; name: string }, x: { teil: number; fortsetzen: true }) => { aufrufe.push({ url: ref.url, name: ref.name, teil: x.teil, fortsetzen: x.fortsetzen }) } }
}

Deno.test('Minutentakt: hängende Zeile (Befund 16.11.) wird beansprucht und beim offenen Teil fortgesetzt', async () => {
  const db = falscheDatenbank({
    dokument_inhalte: [
      zeile('email-anhaenge/A/Gesellschaftsvertrag_v3.pdf', { aktualisiert_am: '2026-11-20T16:00:30.330Z', teile: { '0': 'Seite 1–4' }, teile_gesamt: 3, seiten: 12 }),
      zeile('kunden-dokumente/k/frisch.pdf', { aktualisiert_am: vor(20) }),
      zeile('kunden-dokumente/k/gelesen.pdf', { status: 'gelesen', aktualisiert_am: vor(9000) }),
    ],
  })
  const a = aufzeichner()
  const r = await setzeHaengendeDokumenteFort(db, { stosseAn: a.stosseAn, basisUrl: BASIS, jetzt: JETZT })
  assertEquals(r, { angestossen: 2, aufgegeben: 0, laufend: 0 })
  assertEquals(a.aufrufe[0], { url: `${BASIS}/storage/v1/object/public/email-anhaenge/A/Gesellschaftsvertrag_v3.pdf`, name: 'Gesellschaftsvertrag_v3.pdf', teil: 1, fortsetzen: true })
  assertEquals(a.aufrufe[1].teil, 0)
  const z = db.tabelle('dokument_inhalte').find((x) => x.schluessel === 'email-anhaenge/A/Gesellschaftsvertrag_v3.pdf')!
  assertEquals(z.versuche, 2)
  assertEquals(z.aktualisiert_am, vor(0))
  // Gleich danach noch ein Takt: beide gelten jetzt als laufend → nichts doppelt angestoßen.
  const r2 = await setzeHaengendeDokumenteFort(db, { stosseAn: a.stosseAn, basisUrl: BASIS, jetzt: JETZT + 60_000 })
  assertEquals(r2.angestossen, 0)
  assertEquals(a.aufrufe.length, 2)
})

Deno.test('Minutentakt: höchstens GLEICHZEITIG Läufe, Warteschlange kommt zuerst dran', async () => {
  const db = falscheDatenbank({
    dokument_inhalte: [
      zeile('kunden-dokumente/k/laeuft.pdf', { aktualisiert_am: vor(2) }),
      zeile('kunden-dokumente/k/haengt.pdf', { aktualisiert_am: vor(60) }),
      zeile('kunden-dokumente/k/wartet1.pdf', { aktualisiert_am: WARTESCHLANGE_ZEIT, versuche: 0 }),
      zeile('kunden-dokumente/k/wartet2.pdf', { aktualisiert_am: WARTESCHLANGE_ZEIT, versuche: 0 }),
    ],
  })
  const a = aufzeichner()
  const r = await setzeHaengendeDokumenteFort(db, { stosseAn: a.stosseAn, basisUrl: BASIS, jetzt: JETZT })
  assertEquals(GLEICHZEITIG, 2)
  assertEquals(r.laufend, 1)
  assertEquals(r.angestossen, 1)
  assertEquals(a.aufrufe.map((x) => x.url), ['k/wartet1.pdf'])
})

Deno.test('Minutentakt: nach MAX_VERSUCHE endgültig „fehler“ (keine Endlosschleife), unbekannter Ort ebenso', async () => {
  const db = falscheDatenbank({
    dokument_inhalte: [
      zeile('kunden-dokumente/k/gift.pdf', { aktualisiert_am: vor(30), versuche: MAX_VERSUCHE, fehler: 'Wird später erneut versucht: Zeitüberschreitung beim Lesen' }),
      zeile('https://fremd.de/x.pdf', { aktualisiert_am: vor(30) }),
    ],
  })
  const a = aufzeichner()
  const r = await setzeHaengendeDokumenteFort(db, { stosseAn: a.stosseAn, basisUrl: BASIS, jetzt: JETZT })
  assertEquals(r.aufgegeben, 2)
  assertEquals(a.aufrufe.length, 0)
  const gift = db.tabelle('dokument_inhalte').find((x) => x.schluessel === 'kunden-dokumente/k/gift.pdf')!
  assertEquals(gift.status, 'fehler')
  assertStringIncludes(String(gift.fehler), `${MAX_VERSUCHE}-mal abgebrochen (zuletzt: Zeitüberschreitung beim Lesen)`)
  assertEquals(db.tabelle('dokument_inhalte').find((x) => x.schluessel === 'https://fremd.de/x.pdf')!.status, 'fehler')
})

Deno.test('Minutentakt: Datenbankfehler wirft nicht', async () => {
  // deno-lint-ignore no-explicit-any
  const kaputt: any = { from: () => { throw new Error('weg') } }
  const r = await setzeHaengendeDokumenteFort(kaputt, { stosseAn: async () => {}, basisUrl: BASIS, jetzt: JETZT })
  assertEquals(r, { angestossen: 0, aufgegeben: 0, laufend: 0 })
})

Deno.test('reiheDokumentEin: Platz in der Warteschlange, der Takt startet ihn', async () => {
  const db = falscheDatenbank({ dokument_inhalte: [] })
  await reiheDokumentEin(db, 'kunden-dokumente/k/neu.pdf', 'neu.pdf', 0)
  const a = aufzeichner()
  const r = await setzeHaengendeDokumenteFort(db, { stosseAn: a.stosseAn, basisUrl: BASIS, jetzt: JETZT })
  assertEquals(r.angestossen, 1)
  assertEquals(a.aufrufe[0], { url: 'k/neu.pdf', name: 'neu.pdf', teil: 0, fortsetzen: true })
})

// ---------- Weitere Formate ----------

Deno.test('istWeiteresTextFormat: die bisher „nicht lesbaren“ Formate', () => {
  for (const n of ['a.txt', 'a.odt', 'a.ods', 'a.odp', 'a.pptx', 'a.eml', 'a.html']) assert(istWeiteresTextFormat(n), n)
  assert(istWeiteresTextFormat('ohne', 'application/vnd.oasis.opendocument.text'))
  assert(istWeiteresTextFormat('ohne', 'text/plain; charset=utf-8'))
  assert(!istWeiteresTextFormat('a.doc', 'application/msword'))
  assert(!istWeiteresTextFormat('a.pdf'))
  assert(!istWeiteresTextFormat('a.docx'))
})

Deno.test('Textdatei: UTF-8 und Windows-1252 (Umlaute)', async () => {
  assertStringIncludes((await weitererDateiText('a.txt', undefined, new TextEncoder().encode('Größe: 5 €\r\nZeile 2'), 1000))!, 'Größe: 5 €\nZeile 2')
  const ansi = new Uint8Array([0x47, 0x72, 0xf6, 0xdf, 0x65]) // „Größe“ in Windows-1252
  assertStringIncludes((await weitererDateiText('a.txt', undefined, ansi, 1000))!, 'Größe')
  assertStringIncludes((await weitererDateiText('a.txt', undefined, new TextEncoder().encode('x'.repeat(50)), 10))!, 'gekürzt')
})

Deno.test('OpenDocument-Text: Absätze, Tabulatoren, Tabellen, Leerzeichen', async () => {
  const content = `<?xml version="1.0"?><office:document-content><office:body><office:text>
<text:h>Bauprojekt Madeira</text:h><text:p>Unsere&#160;Meinung:<text:s text:c="2"/>positiv &amp; klar</text:p>
<table:table table:name="Kosten"><table:table-row><table:table-cell><text:p>Grundstück</text:p></table:table-cell><table:table-cell><text:p>120.000 €</text:p><text:p>netto</text:p></table:table-cell><table:table-cell/><table:table-cell><text:p>x</text:p></table:table-cell></table:table-row></table:table>
<office:annotation><text:p>Kommentar weg</text:p></office:annotation></office:text></office:body></office:document-content>`
  const odt = zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.text'), 'content.xml': strToU8(content) })
  const text = (await weitererDateiText('meinung.odt', undefined, odt, 10_000))!
  assertStringIncludes(text, 'Bauprojekt Madeira')
  assertStringIncludes(text, 'Unsere Meinung: positiv & klar')
  assertStringIncludes(text, '=== Tabellenblatt: Kosten ===')
  assertStringIncludes(text, 'Grundstück\t120.000 € netto\t\tx')
  assert(!text.includes('Kommentar weg'))
})

Deno.test('PowerPoint: Folien in richtiger Reihenfolge (10 nach 2)', async () => {
  const folie = (t: string) => strToU8(`<p:sld><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p><a:p><a:r><a:t>Punkt &amp; mehr</a:t></a:r></a:p></p:txBody></p:sld>`)
  const pptx = zipSync({ 'ppt/slides/slide10.xml': folie('Zehn'), 'ppt/slides/slide2.xml': folie('Zwei'), 'ppt/slides/slide1.xml': folie('Eins') })
  const text = (await weitererDateiText('vortrag.pptx', undefined, pptx, 10_000))!
  assert(text.indexOf('Eins') < text.indexOf('Zwei') && text.indexOf('Zwei') < text.indexOf('Zehn'))
  assertStringIncludes(text, '=== Folie 3 ===\nZehn\nPunkt & mehr')
})

Deno.test('Gespeicherte Mail (.eml): Kopf, Anhang, Text (quoted-printable)', async () => {
  const eml = [
    'From: Max Muster <max@example.com>',
    'To: info@example.org',
    'Subject: =?UTF-8?Q?Unterlagen_f=C3=BCr_die_Pr=C3=BCfung?=',
    'Date: Mon, 16 Nov 2026 10:00:00 +0100',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="X"',
    '',
    '--X',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Guten Tag, anbei die Gr=C3=B6=C3=9Fe.',
    '--X',
    'Content-Type: application/pdf; name="bwa.pdf"',
    'Content-Disposition: attachment; filename="bwa.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQK',
    '--X--',
    '',
  ].join('\r\n')
  const text = (await weitererDateiText('mail.eml', undefined, new TextEncoder().encode(eml), 10_000))!
  assertStringIncludes(text, 'Von: "Max Muster" <max@example.com>')
  assertStringIncludes(text, 'Betreff: Unterlagen für die Prüfung')
  assertStringIncludes(text, 'Datum: 2026-11-16')
  assertStringIncludes(text, 'Anhänge: bwa.pdf')
  assertStringIncludes(text, 'anbei die Größe.')
})

Deno.test('Webseite: Text ohne Skripte und Gestaltung', async () => {
  const html = '<html><head><style>p{}</style></head><body><h1>Angebot</h1><p>Preis:&nbsp;5&euro;</p><script>x()</script><table><tr><td>A</td><td>B</td></tr></table></body></html>'
  const text = (await weitererDateiText('seite.html', undefined, new TextEncoder().encode(html), 10_000))!
  assertStringIncludes(text, 'Angebot\nPreis: 5€')
  assertStringIncludes(text, 'A\tB')
  assert(!text.includes('x()'))
})

Deno.test('entschlackeSeiten: jede Seite behält nur die Bilder, die sie zeichnet', async () => {
  const { PDFDocument, PDFName, PDFDict } = await import('npm:pdf-lib@1.17.1')
  const { entschlackeSeiten } = await import('./pdfSeiten.ts')
  const doc = await PDFDocument.create()
  // Zwei Seiten mit einem gemeinsamen Verzeichnis zweier „Bilder“ (leere Formulare), jede zeichnet nur eins.
  const form = (n: number) => doc.context.register(doc.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, n, n] }))
  const gemeinsam = doc.context.obj({ XObject: { Im1: form(1), Im2: form(2) } })
  for (const name of ['Im1', 'Im2']) {
    const seite = doc.addPage()
    seite.node.set(PDFName.of('Resources'), gemeinsam)
    seite.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(`q /${name} Do Q`)))
  }
  assertEquals(entschlackeSeiten(doc), 2)
  const namen = doc.getPages().map((s) => ((s.node.lookup(PDFName.of('Resources')) as InstanceType<typeof PDFDict>).lookup(PDFName.of('XObject')) as InstanceType<typeof PDFDict>).keys().map((k) => k.decodeText()))
  assertEquals(namen, [['Im1'], ['Im2']])
})
