import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  aktenFuerAbgleich,
  betrag,
  chanceFuer,
  findeTreffer,
  namensPunkte,
  neueAkteId,
  normalisiereAbschnitte,
  protokollIdFuer,
  protokollText,
  teamMitgliedZu,
  todoSchluessel,
  type VerteilAbschnitt,
  type VerteilAkte,
  verlaufText,
  vorschlagFuer,
  wirksamerAbschnitt,
  wvSchluessel,
} from './gespraechVerteilenKern.ts'

const AKTEN: VerteilAkte[] = [
  { id: 'k_keller', bereich: 'beratung', firma: 'Familie Keller', ansprechpartner: 'Peter Keller' },
  { id: 'k_kellermann', bereich: 'beratung', firma: 'Kellermann Bau GmbH', ansprechpartner: 'Ute Kellermann' },
  { id: 'k_meier1', bereich: 'erben', firma: 'Hans Meier', ansprechpartner: 'Hans Meier' },
  { id: 'k_meier2', bereich: 'beratung', firma: 'Meier Logistik GmbH', ansprechpartner: 'Klara Meier' },
  { id: 'k_schulze', bereich: 'immobilienkunden', firma: 'Schulze Immobilien', ansprechpartner: 'Jan Schulze' },
  { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: '' },
  { id: 'k_privat_fremd', bereich: 'privat', firma: 'Kurt Keller', ansprechpartner: 'Kurt Keller', verantwortlich_email: 'kollege@mayer.test' },
  { id: 'k_privat_eigen', bereich: 'privat', firma: 'Otto Privat', ansprechpartner: 'Otto Privat', verantwortlich_email: 'ich@mayer.test' },
  { id: 'k_akademie', bereich: 'akademie', firma: 'Seminar Mustermann', ansprechpartner: 'Max Mustermann' },
]

function abschnitt(teil: Partial<VerteilAbschnitt>): VerteilAbschnitt {
  return { nr: 0, name: 'X', stand: 'Stand', wiedervorlagen: [], todos: [], offeneFragen: [], ...teil }
}

Deno.test('Akten für den Abgleich: ohne Sammelakten, ohne fremde private, nur sichtbare Bereiche', () => {
  const ids = aktenFuerAbgleich(AKTEN, 'ICH@mayer.test', (b) => b !== 'akademie').map((a) => a.id)
  assert(!ids.includes('k_eingang_ungeklaert'))
  assert(!ids.includes('k_privat_fremd'))
  assert(ids.includes('k_privat_eigen'))
  assert(!ids.includes('k_akademie'))
  assert(ids.includes('k_keller'))
})

Deno.test('Abgleich: Nachname genau, unscharf geschrieben, Keller ≠ Kellermann, mehrere Meier = Auswahl', () => {
  const akten = aktenFuerAbgleich(AKTEN, 'ich@mayer.test', () => true)
  // „Familie Keller“ → genau eine Akte, sicher (Kellermann zählt nicht, fremder privater Kurt Keller ist ausgeschlossen)
  const keller = findeTreffer({ name: 'Familie Keller' }, akten)
  assertEquals(keller.map((t) => t.id), ['k_keller'])
  assertEquals(vorschlagFuer({}, keller, ['beratung']), { art: 'akte', kundeId: 'k_keller', sicher: true })
  // Spracherkennung: „Schultze“ statt „Schulze“
  const schulze = findeTreffer({ name: 'Herr Schultze' }, akten)
  assertEquals(schulze[0]?.id, 'k_schulze')
  assert(schulze[0].punkte < 85)
  // Zwei Meier → beide als Auswahl, nicht sicher
  const meier = findeTreffer({ name: 'Meier' }, akten)
  assertEquals(meier.map((t) => t.id).sort(), ['k_meier1', 'k_meier2'])
  const v = vorschlagFuer({}, meier, ['beratung'])
  assertEquals(v.art === 'akte' && v.sicher, false)
  // Vor- und Nachname entscheidet
  const hans = findeTreffer({ name: 'Hans Meier' }, akten)
  assertEquals(hans[0].id, 'k_meier1')
  assertEquals(vorschlagFuer({}, hans, ['beratung']).art, 'akte')
  // Nichts passt → neue Akte im vorgeschlagenen (erlaubten) Bereich, sonst im ersten erlaubten
  assertEquals(findeTreffer({ name: 'Familie Zimmermann' }, akten), [])
  assertEquals(vorschlagFuer({ bereichVorschlag: 'erben' }, [], ['beratung', 'erben']), { art: 'neu', bereich: 'erben' })
  assertEquals(vorschlagFuer({ bereichVorschlag: 'akademie' }, [], ['beratung']), { art: 'neu', bereich: 'beratung' })
  // Kurze Vornamen allein reichen nicht
  assertEquals(namensPunkte('Ben', ['ben', 'freitag']).punkte, 0)
})

Deno.test('Abgleich: Vorschlag der KI zählt nur für gültige Akten und hebt an', () => {
  const akten = aktenFuerAbgleich(AKTEN, 'ich@mayer.test', () => true)
  const t = findeTreffer({ name: 'die Eltern', akteIds: ['k_meier1'] }, akten)
  assertEquals(t[0].id, 'k_meier1')
  assertEquals(t[0].punkte, 70)
  const roh = { abschnitte: [{ name: 'Eltern', stand: 'aufgeschoben', akte_ids: ['k_meier1', 'k_gibtsnicht'] }] }
  const { abschnitte } = normalisiereAbschnitte(roh, new Set(akten.map((a) => a.id)))
  assertEquals(abschnitte[0].akteIds, ['k_meier1'])
})

Deno.test('KI-Antwort prüfen: Daten, Beträge, Chance, leere Abschnitte', () => {
  const roh = {
    abschnitte: [
      {
        name: 'Familie Keller', stand: 'Aufgeschoben, kommt über Schmidt.', bezug: 'über Vermittler', vermittler: 'Schmidt',
        bezahlt: '1.500', erwartet_netto: 4200.5, erwartet_monat: '2027-01', chance_prozent: 23, chance_begruendung: 'aufgeschoben',
        wiedervorlagen: [{ titel: 'Nachfassen', faellig: '2026-12-01' }, { titel: 'ohne Datum', faellig: 'Anfang Dezember' }, { titel: '' }],
        todos: [{ text: 'Unterlagen anfordern', zustaendig: 'Hasan', faellig: '2026-13-01' }],
        offene_fragen: ['Wer zahlt?'], auszug: 'Auf Position 3 ist die Familie Keller …', bereich: 'beratung',
      },
      { name: '', stand: 'ohne Namen' },
      { name: 'Ohne Stand' },
    ],
    hinweis: 'Teile unverständlich',
  }
  const { abschnitte, hinweis } = normalisiereAbschnitte(roh, new Set())
  assertEquals(hinweis, 'Teile unverständlich')
  assertEquals(abschnitte.length, 1)
  const a = abschnitte[0]
  assertEquals(a.nr, 0)
  assertEquals(a.bezahlt, 1500)
  assertEquals(a.erwartetNetto, 4200.5)
  assertEquals(a.erwartetMonat, '2027-01')
  assertEquals(a.chance, { prozent: 25, begruendung: 'aufgeschoben' })
  assertEquals(a.wiedervorlagen, [{ titel: 'Nachfassen', faellig: '2026-12-01' }, { titel: 'ohne Datum', faellig: '' }])
  assertEquals(a.todos, [{ text: 'Unterlagen anfordern', zustaendig: 'Hasan' }])
  assertEquals(a.vermittler, 'Schmidt')
  assertEquals(a.bereichVorschlag, 'beratung')
  assertEquals(betrag('1.234,50'), 1234.5)
  assertEquals(betrag('12.000 €'), 12000)
  assertEquals(betrag(0), undefined)
  assertEquals(betrag('abc'), undefined)
})

Deno.test('Bearbeitete Fassung überlagert nur bekannte Felder', () => {
  const a = abschnitt({ name: 'Keller', stand: 'alt', bezahlt: 100, chance: { prozent: 50, begruendung: 'x' }, wiedervorlagen: [{ titel: 'A', faellig: '2026-12-01' }] })
  const w = wirksamerAbschnitt(a, { stand: 'neu', bezahlt: null, chance: null, wiedervorlagen: [{ titel: 'B', faellig: 'kaputt' }], name: 'Fremd' })
  assertEquals(w.stand, 'neu')
  assertEquals(w.bezahlt, undefined)
  assertEquals(w.chance, undefined)
  assertEquals(w.wiedervorlagen, [{ titel: 'B', faellig: '' }])
  assertEquals(w.name, 'Keller')
  assertEquals(wirksamerAbschnitt(a, undefined), a)
})

Deno.test('Feste Kennungen und Schlüssel', () => {
  const id = 'e66342cc-0d8e-46e9-9fb3-c47bd38de8cf'
  assertEquals(protokollIdFuer(id, 'k_abc'), 'p_vert_e66342cc0d8e_k_abc')
  assertEquals(neueAkteId(id, 'Familie Keller'), neueAkteId(id, 'familie  KELLER'))
  assert(neueAkteId(id, 'Familie Keller') !== neueAkteId(id, 'Familie Meier'))
  assertEquals(neueAkteId(id, 'X Y').length, 14)
  assertEquals(wvSchluessel({ titel: 'Nachfassen!', faellig: '2026-12-01' }), wvSchluessel({ titel: 'nachfassen', faellig: '2026-12-01' }))
  assert(wvSchluessel({ titel: 'Nachfassen', faellig: '2026-12-01' }) !== wvSchluessel({ titel: 'Nachfassen', faellig: '2026-12-02' }))
  assertEquals(todoSchluessel({ text: 'Unterlagen  anfordern' }), todoSchluessel({ text: 'unterlagen anfordern' }))
})

Deno.test('Teammitglied nur eindeutig', () => {
  const team = [{ name: 'Hasan Yilmaz', email: 'h@x' }, { name: 'Quirin Lang', email: 'q@x' }, { name: 'Hans Lang', email: 'hl@x' }]
  assertEquals(teamMitgliedZu('Hasan', team)?.email, 'h@x')
  assertEquals(teamMitgliedZu('Quirin Lang', team)?.email, 'q@x')
  assertEquals(teamMitgliedZu('Lang', team), undefined)
  assertEquals(teamMitgliedZu('', team), undefined)
})

Deno.test('Chance: bestätigte nie überschreiben, Immobilien ohne Umsatz, privat nichts', () => {
  const wer = { name: 'Andreas', am: '2026-11-24T10:00:00Z' }
  const teile = [{ chance: { prozent: 60, begruendung: 'kommt wohl' }, erwartetNetto: 5000, erwartetMonat: '2027-01' }]
  const neu = chanceFuer(teile, { bereich: 'beratung', auftrag_chance: null }, wer)
  assertEquals(neu, { feld: 'auftrag_chance', wert: { prozent: 60, bestaetigt: false, begruendung: 'kommt wohl', von: 'Andreas', am: wer.am, umsatzNetto: 5000, monat: '2027-01' } })
  const unbestaetigt = chanceFuer(teile, { bereich: 'beratung', auftrag_chance: { prozent: 10, bestaetigt: false } }, wer)
  assertEquals(unbestaetigt?.feld, 'auftrag_chance')
  const bestaetigt = chanceFuer(teile, { bereich: 'beratung', auftrag_chance: { prozent: 90, bestaetigt: true } }, wer)
  assertEquals(bestaetigt?.feld, 'chance_vorschlag')
  assertEquals(bestaetigt?.wert.prozent, 60)
  assertEquals((bestaetigt?.wert as { chanceBestaetigt?: boolean }).chanceBestaetigt, true)
  const immo = chanceFuer(teile, { bereich: 'immobilienkunden' }, wer)
  assertEquals(immo?.feld, 'auftrag_chance')
  assertEquals((immo?.wert as { umsatzNetto?: number }).umsatzNetto, undefined)
  assertEquals((immo?.wert as { monat?: string }).monat, undefined)
  assertEquals(chanceFuer(teile, { bereich: 'privat' }, wer), null)
  assertEquals(chanceFuer([{ erwartetNetto: 100 }], { bereich: 'beratung' }, wer), null)
})

Deno.test('Texte: Protokoll nur mit dem Teil des Kunden, Verlauf mit Beträgen', () => {
  const a = abschnitt({
    name: 'Familie Keller', stand: 'Aufgeschoben.', bezug: 'über Vermittler', vermittler: 'Schmidt', bezahlt: 1500, erwartetNetto: 4200, erwartetMonat: '2027-01',
    chance: { prozent: 20, begruendung: 'aufgeschoben' }, wiedervorlagen: [{ titel: 'Nachfassen', faellig: '2026-12-01' }], todos: [{ text: 'Anrufen', zustaendig: 'Hasan' }],
    offeneFragen: ['Wer zahlt?'], auszug: 'Auf Position 3 …',
  })
  const t = protokollText([a], { sprecher: 'Andreas', datum: '2026-11-24', titel: 'Offene Posten', link: 'https://crm.test/gespraech/#/aufnahme/x' })
  assertStringIncludes(t, 'nur der Teil zu Familie Keller')
  assertStringIncludes(t, 'Stand: Aufgeschoben.')
  assertStringIncludes(t, 'Vermittler: Schmidt')
  assertStringIncludes(t, 'Bezahlt: 1.500 €')
  assertStringIncludes(t, 'Erwartet: 4.200 € netto im Januar 2027')
  assertStringIncludes(t, 'Chance: 20 % — aufgeschoben')
  assertStringIncludes(t, '- Nachfassen (01.12.2026)')
  assertStringIncludes(t, '- Anrufen (Hasan)')
  assertStringIncludes(t, 'Wortlaut aus der Aufnahme:\nAuf Position 3 …')
  const v = verlaufText([a], { sprecher: 'Andreas', datum: '2026-11-24', angelegt: ['Gesprächsprotokoll'] })
  assertStringIncludes(v, 'Sprachnotiz von Andreas vom 24.11.2026: Aufgeschoben. (bezahlt 1.500 €, erwartet 4.200 € netto im Januar 2027)')
  assertStringIncludes(v, 'angelegt: Gesprächsprotokoll')
})
