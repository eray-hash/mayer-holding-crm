// Tests für die Zuordnung von Kostenvoranschlägen zu Akten: Abkürzungen, Vermittler vor dem Namen, angeklebtes
// Initial, Wortanfang, Tippfehler, häufige Namen, allgemeine Wörter, Sichtbarkeit (privat/öffentlich),
// verknüpfte Datei, Text der Datei (nur bei Einzel-Dateien), Eindeutigkeit von „sicher“. Alle Namen erfunden.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { type AkteFuerZuordnung, findeKvKandidaten, type KvFuerZuordnung, kvWoerter, kvZaehler, kvZuordnungsVorschlaege, passtSichtbarkeit } from './kvZuordnung.ts'

const AKTEN: AkteFuerZuordnung[] = [
  { id: 'k_brenner', bereich: 'beratung', firma: 'Rolf Brenner', ansprechpartner: 'Rolf Brenner', email: 'r.brenner71@gmx.de' },
  { id: 'k_klee', bereich: 'beratung', firma: 'B. Klee Bau AG', ansprechpartner: 'B. Klee Bau AG' },
  { id: 'k_dornfeld1', bereich: 'beratung', firma: 'Dornfelder', ansprechpartner: 'Dornfelder' },
  { id: 'k_wasmeier', bereich: 'beratung', firma: 'Wassermaier', ansprechpartner: 'Wassermaier' },
  { id: 'k_wasmeier2', bereich: 'immobilienkunden', firma: 'Wassermeier', ansprechpartner: 'Wassermeier' },
  { id: 'k_zabel', bereich: 'beratung', firma: 'Versicherung Daniel Zabelski', ansprechpartner: 'Daniel Zabelski' },
  { id: 'k_nova', bereich: 'akademie', firma: 'nova Schule GmbH', ansprechpartner: 'Maria Kunz' },
  { id: 'k_novak', bereich: 'beratung', firma: 'Noval Trading', ansprechpartner: 'Ilse Brandt' },
  { id: 'k_huber1', bereich: 'beratung', firma: 'Anna Huber', ansprechpartner: 'Anna Huber' },
  { id: 'k_huber2', bereich: 'finanzierungen', firma: 'Peter Huber', ansprechpartner: 'Peter Huber' },
  { id: 'k_huber3', bereich: 'erben', firma: 'Karl Huber', ansprechpartner: 'Karl Huber' },
  { id: 'k_huber4', bereich: 'beratung', firma: 'Eva Huber', ansprechpartner: 'Eva Huber' },
  { id: 'k_seidl', bereich: 'beratung', firma: 'Marta Seidl', ansprechpartner: 'Marta Seidl' },
  { id: 'k_privat_seidl', bereich: 'privat', firma: 'Marta Seidl privat', ansprechpartner: 'Marta Seidl', verantwortlich_email: 'chef@firma.test' },
  { id: 'k_immo', bereich: 'beratung', firma: 'Nord Immo Invest', ansprechpartner: 'Nord' },
  { id: 'k_eingang_ungeklaert', bereich: 'beratung', firma: 'Ungeklärte Eingänge', ansprechpartner: 'Ungeklärte Eingänge' },
  { id: 'k_gans1', bereich: 'beratung', firma: 'Gänsewirt GmbH', ansprechpartner: 'Otto Lang' },
  { id: 'k_gans2', bereich: 'beratung', firma: 'Gänsewirt GmbH', ansprechpartner: 'Ute Lang' },
]

function kv(name: string, mehr: Partial<KvFuerZuordnung> = {}): KvFuerZuordnung {
  return { id: `kv_${name.replace(/\W/g, '')}`, name, ...mehr }
}

function erster(name: string, mehr: Partial<KvFuerZuordnung> = {}) {
  return findeKvKandidaten(kv(name, mehr), AKTEN)[0]
}

Deno.test('kvWoerter: Abkürzung mit Punkt, Füllwörter und Rechtsformen fallen weg', () => {
  assertEquals(kvWoerter('Dr. Wasserm. GmbH'), [{ wort: 'wasserm', abgekuerzt: true }])
  assertEquals(kvWoerter('Müller Bad'), [{ wort: 'mueller', abgekuerzt: false }, { wort: 'bad', abgekuerzt: false }])
})

Deno.test('Abkürzung „Bren.“ passt zum Nachnamen, wahrscheinlich', () => {
  const k = erster('Bren.')
  assertEquals(k?.kunde_id, 'k_brenner')
  assertEquals(k?.stufe, 'wahrscheinlich')
})

Deno.test('Abkürzung, die genau dem Nachnamen entspricht („Brenner.“), und Vermittler davor', () => {
  assertEquals(erster('Brenner.')?.kunde_id, 'k_brenner')
  const k = erster('Azim Brenner')
  assertEquals(k?.kunde_id, 'k_brenner')
  assertEquals(k?.stufe, 'wahrscheinlich')
  assert(k!.gruende[0].includes('brenner'))
})

Deno.test('Initial angeklebt: „Bklee“ = „B. Klee“', () => {
  const k = erster('Bklee Erbe')
  assertEquals(k?.kunde_id, 'k_klee')
  assert(k!.gruende[0].includes('Initial'))
})

Deno.test('Wortanfang: „Dornfeld“ passt zu „Dornfelder“', () => {
  assertEquals(erster('Steffi Dornfeld')?.kunde_id, 'k_dornfeld1')
})

Deno.test('Abkürzung mit Tippfehler trifft zwei ähnliche Akten — beide nur wahrscheinlich', () => {
  const liste = findeKvKandidaten(kv('Hans Wassen.'), AKTEN)
  assertEquals(liste.map((k) => k.kunde_id).sort(), ['k_wasmeier', 'k_wasmeier2'])
  assert(liste.every((k) => k.stufe === 'wahrscheinlich'))
})

Deno.test('Vor- und Nachname gleich → sicher', () => {
  const k = erster('Daniel Zabelski')
  assertEquals(k?.kunde_id, 'k_zabel')
  assertEquals(k?.stufe, 'sicher')
})

Deno.test('kurze Wörter („Nov“) und Tippfehler unter 6 Buchstaben zählen nicht', () => {
  assertEquals(findeKvKandidaten(kv('Nov'), AKTEN), [])
  const l = findeKvKandidaten(kv('Nova'), AKTEN)
  assertEquals(l.map((k) => k.kunde_id), ['k_nova'])
})

Deno.test('häufiger Nachname (vier Akten) ist kein Hinweis', () => {
  assertEquals(findeKvKandidaten(kv('Huber'), AKTEN), [])
  // mit Vorname aber schon
  assertEquals(erster('Peter Huber')?.kunde_id, 'k_huber2')
})

Deno.test('allgemeine Wörter allein („Immo Invest“) schlagen nichts vor', () => {
  assertEquals(findeKvKandidaten(kv('Immo Invest'), AKTEN), [])
  assertEquals(findeKvKandidaten(kv('Dachdecker Fenster'), AKTEN), [])
})

Deno.test('Sichtbarkeit: öffentlich nur zu öffentlichen Akten, privat nur zu eigenen privaten', () => {
  const oeff = findeKvKandidaten(kv('Marta Seidl'), AKTEN)
  assertEquals(oeff.map((k) => k.kunde_id), ['k_seidl'])
  assertEquals(oeff[0].stufe, 'sicher')
  const priv = findeKvKandidaten(kv('Marta Seidl', { bereich: 'privat', privat_besitzer: 'chef@firma.test' }), AKTEN)
  assertEquals(priv.map((k) => k.kunde_id), ['k_privat_seidl'])
  assertEquals(findeKvKandidaten(kv('Marta Seidl', { bereich: 'privat', privat_besitzer: 'andere@firma.test' }), AKTEN), [])
  assertEquals(passtSichtbarkeit({}, { id: 'k_eingang_ungeklaert', bereich: 'beratung' }), false)
})

Deno.test('gleiche Firma in mehreren Akten: beide nur wahrscheinlich', () => {
  const l = findeKvKandidaten(kv('Gänsewirt'), AKTEN)
  assertEquals(l.length, 2)
  assert(l.every((k) => k.stufe === 'wahrscheinlich'))
})

Deno.test('verknüpfte Datei in einer echten Akte → sicher; in der Sammelakte zählt sie nicht', () => {
  const k = erster('Unbekannt XY', { dokumentKundeId: 'k_nova', dokumentId: 'd1' })
  assertEquals(k?.kunde_id, 'k_nova')
  assertEquals(k?.stufe, 'sicher')
  assertEquals(findeKvKandidaten(kv('Unbekannt XY', { dokumentKundeId: 'k_eingang_ungeklaert' }), AKTEN), [])
})

Deno.test('Text der Datei zählt nur, wenn die Datei zu genau einem Eintrag gehört', () => {
  const text = 'Kostenvoranschlag für Daniel Zabelski, Fenster'
  const einzeln = kvZuordnungsVorschlaege([kv('Fenster', { dokumentId: 'd9', dokumentText: text })], AKTEN)
  assertEquals(einzeln[0].kandidaten[0]?.kunde_id, 'k_zabel')
  const liste = kvZuordnungsVorschlaege(
    [kv('Fenster', { dokumentId: 'd9', dokumentText: text }), kv('Bad', { dokumentId: 'd9', dokumentText: text })],
    AKTEN,
  )
  assertEquals(liste.every((v) => v.kandidaten.length === 0), true)
})

Deno.test('kvZaehler zählt sicher / wahrscheinlich / ohne', () => {
  const v = kvZuordnungsVorschlaege([kv('Daniel Zabelski'), kv('Bren.'), kv('Niemand Bekannt')], AKTEN)
  assertEquals(kvZaehler(v), { gesamt: 3, sicher: 1, wahrscheinlich: 1, ohne: 1 })
})
