// Unscharfe Dateisuche (dateiSucheKern.ts): Wortteile, Umlaute, Tippfehler, zusammengesetzte Wörter,
// Dateiart, Zeitraum, Rangfolge. Ohne Netz, nur erfundene Namen.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type DateiKandidat, dateinameAusUrl, findeDateien, inhaltSchluessel, isoTag, suchWoerter, wortWert, woerterVon, zeitraumAusText } from './dateiSucheKern.ts'

function k(id: string, name: string, extra: Partial<DateiKandidat> = {}): DateiKandidat {
  return { dokument_id: id, name, ort_art: 'akte', ort_id: 'k_test', ort_name: 'Musterfirma GmbH', datum: '2026-11-20', ...extra }
}

const LISTE = [
  k('d_liste', 'Liste Beträge mit Vermittler und Abteilung (24.11.2026).xlsx', { typ: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', datum: '2026-11-24' }),
  k('d_uebersicht', 'Übersichtsliste Objekte Süd.xlsx', { datum: '2026-11-23' }),
  k('d_miet', 'Mietvertrag Teckstraße 2024.pdf', { typ: 'application/pdf', datum: '2026-10-01' }),
  k('d_foto', 'IMG_4711.jpg', { typ: 'image/jpeg', datum: '2026-11-24' }),
  k('d_grundbuch', 'Auszug.pdf', { typ: 'application/pdf', ordner: 'Grundbuch', ort_art: 'objekt', ort_id: 'o_test', ort_name: 'Wohnhaus Musterweg 1', kurzinhalt: 'Grundbuchauszug Blatt 123, Eigentümer Erbengemeinschaft' }),
]

const ids = (t: { dokument_id: string }[]) => t.map((x) => x.dokument_id)

Deno.test('Wörter: Umlaute, Endung, Binnengroßbuchstaben', () => {
  assertEquals(woerterVon('ÜbersichtsListe_Straße.xlsx'), ['uebersichts', 'liste', 'strasse'])
  assertEquals(suchWoerter('die Übersichtsliste von gestern'), ['uebersichtsliste'])
  assertEquals(suchWoerter('die'), ['die'])
})

Deno.test('Genaues Wort, Umlaut ausgeschrieben, Groß/klein egal', () => {
  assertEquals(findeDateien('uebersichtsliste', LISTE)[0].dokument_id, 'd_uebersicht')
  assertEquals(findeDateien('ÜBERSICHTSLISTE', LISTE)[0].dokument_id, 'd_uebersicht')
})

Deno.test('Wortanfang und Wortteil', () => {
  assertEquals(findeDateien('Übersicht', LISTE)[0].dokument_id, 'd_uebersicht')
  assertEquals(findeDateien('Teckstr', LISTE)[0].dokument_id, 'd_miet')
  assertEquals(findeDateien('vertrag', LISTE)[0].dokument_id, 'd_miet') // steckt in „Mietvertrag“
})

Deno.test('Tippfehler', () => {
  assertEquals(findeDateien('Mitvertrag', LISTE)[0].dokument_id, 'd_miet')
  assertEquals(findeDateien('Ubersichtliste', LISTE)[0].dokument_id, 'd_uebersicht')
  assertEquals(findeDateien('Vermitler', LISTE)[0].dokument_id, 'd_liste')
})

Deno.test('Zusammengesetztes Suchwort findet Teil im Namen („Übersichtsliste“ → „Liste …“)', () => {
  const ohneGenau = LISTE.filter((x) => x.dokument_id !== 'd_uebersicht')
  assertEquals(findeDateien('Übersichtsliste', ohneGenau)[0].dokument_id, 'd_liste')
})

Deno.test('Kurzinhalt und Ordner zählen mit, Aktenname allein nicht', () => {
  assertEquals(findeDateien('Grundbuchauszug', LISTE)[0].dokument_id, 'd_grundbuch')
  assertEquals(findeDateien('Grundbuch', LISTE)[0].dokument_id, 'd_grundbuch')
  assertEquals(findeDateien('Musterfirma', LISTE), [])
})

Deno.test('Dateiart: „Foto von heute“ findet das Bild', () => {
  assertEquals(ids(findeDateien('Foto', LISTE, { ab: '2026-11-24', bis: '2026-11-24' })), ['d_foto'])
  // Ohne Zeitraum reicht die Art allein nicht (sonst käme jedes Bild).
  assertEquals(ids(findeDateien('Foto', LISTE)), [])
  // Zeitraum ohne Namen: alles des Tages, einen Tag daneben hinten an.
  assertEquals(ids(findeDateien('', LISTE, { ab: '2026-11-24', bis: '2026-11-24' })), ['d_liste', 'd_foto', 'd_uebersicht'])
})

Deno.test('Zeitraum filtert, einen Tag daneben gilt als knapp daneben', () => {
  const gestern = findeDateien('Liste', LISTE, { ab: '2026-11-23', bis: '2026-11-23' })
  assertEquals(ids(gestern), ['d_uebersicht', 'd_liste'])
  assert(gestern[1].knapp_daneben)
  assert(!gestern[0].knapp_daneben)
  assertEquals(ids(findeDateien('Mietvertrag', LISTE, { ab: '2026-11-20' })), [])
})

Deno.test('Gleich gute Treffer: der neuere zuerst', () => {
  const zwei = [k('alt', 'Liste A.xlsx', { datum: '2026-01-01' }), k('neu', 'Liste B.xlsx', { datum: '2026-11-01' })]
  assertEquals(ids(findeDateien('Liste', zwei)), ['neu', 'alt'])
})

Deno.test('Nichts Ähnliches → leer', () => {
  assertEquals(findeDateien('Steuerbescheid', LISTE), [])
})

Deno.test('wortWert: Stufen', () => {
  assertEquals(wortWert('liste', ['liste']), 1)
  assert(wortWert('lis', ['liste']) >= 0.85)
  assert(wortWert('lsite', ['liste']) >= 0.6)
  assertEquals(wortWert('xyz', ['liste']), 0)
})

Deno.test('Datum, Zeitraum aus Text, Speicherschlüssel, Dateiname', () => {
  assertEquals(isoTag('24.11.2026'), '2026-11-24')
  assertEquals(isoTag('2026-11-24T08:00:00Z'), '2026-11-24')
  assertEquals(isoTag(''), null)
  assertEquals(zeitraumAusText('die Liste von gestern', '2026-11-25'), { ab: '2026-11-24', bis: '2026-11-24' })
  assertEquals(zeitraumAusText('letzte Woche hochgeladen', '2026-11-25'), { ab: '2026-11-12', bis: '2026-11-25' })
  assertEquals(zeitraumAusText('Liste', '2026-11-25'), null)
  assertEquals(inhaltSchluessel('k_x/dok_1.pdf'), 'kunden-dokumente/k_x/dok_1.pdf')
  assertEquals(inhaltSchluessel('objekt-dokumente:o_x/a.pdf'), 'objekt-dokumente/o_x/a.pdf')
  assertEquals(inhaltSchluessel('https://x.supabase.co/storage/v1/object/public/email-anhaenge/telegram/a%20b.pdf'), 'email-anhaenge/telegram/a b.pdf')
  assertEquals(dateinameAusUrl('k_intern_holding/dok_2d0c7005cf38_Liste_Betraege.xlsx'), 'Liste_Betraege.xlsx')
})
