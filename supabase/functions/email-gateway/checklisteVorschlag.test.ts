import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { baueChecklistePrompt, bereinigeVorschlag, checklisteWerkzeug, rundeProzent, type ChecklisteKontext } from './checklisteVorschlag.ts'

const PREISE = ['Unternehmensbewertung', 'Nachfolgeberatung', 'Rechtsformwahl']

function kontext(teil: Partial<ChecklisteKontext> = {}): ChecklisteKontext {
  return {
    heute: '2026-11-20',
    kunde: { id: 'k1', firma: 'Muster Bau GmbH', bereich: 'betriebsuebergabe', status: 'interessent' },
    protokolle: [],
    kostenvoranschlaege: [],
    gesendet: [],
    eingegangen: [],
    termineVergangen: [],
    termineKommend: [],
    preisliste: PREISE,
    ...teil,
  }
}

// ---------- Bereinigen ----------

Deno.test('Prozent: begrenzt auf 0–100 und auf 5er-Schritte gerundet', () => {
  assertEquals(rundeProzent(42), 40)
  assertEquals(rundeProzent(43), 45)
  assertEquals(rundeProzent(-10), 0)
  assertEquals(rundeProzent(140), 100)
  assertEquals(rundeProzent('35 %'), 35)
  assertEquals(rundeProzent('12,6'), 15)
  assertEquals(rundeProzent('viel'), 0)
  assertEquals(rundeProzent(undefined), 0)
  assertEquals(rundeProzent(Number.NaN), 0)
})

Deno.test('Dienstleistungen: nur aus der Leistungsliste, in deren Schreibweise, ohne Doppelte', () => {
  const v = bereinigeVorschlag({ dienstleistungen: ['  unternehmensbewertung ', 'Steuerberatung', 'Unternehmensbewertung', 7, 'Nachfolge  beratung', 'Nachfolgeberatung'] }, PREISE)
  assertEquals(v.dienstleistungen, ['Unternehmensbewertung', 'Nachfolgeberatung'])
})

Deno.test('Texte werden getrimmt, Leeres und „unbekannt“ wird null bzw. leer', () => {
  const v = bereinigeVorschlag({
    sachverhalt: '  Der Kunde will seinen Betrieb übergeben.  ',
    branche: 'unbekannt',
    vermittler: '   ',
    chance_prozent: 23,
    chance_begruendung: ' Nur eine Mail. ',
    naechste_schritte: '',
    dienstleistungen: 'kein Array',
  }, PREISE)
  assertEquals(v, {
    sachverhalt: 'Der Kunde will seinen Betrieb übergeben.',
    branche: null,
    dienstleistungen: [],
    chance: { prozent: 25, begruendung: 'Nur eine Mail.' },
    naechsteSchritte: '',
    vermittler: null,
  })
})

Deno.test('Unbrauchbare Antwort ergibt einen leeren, gültigen Vorschlag', () => {
  for (const roh of [null, undefined, 'Text', 42, []]) {
    const v = bereinigeVorschlag(roh, PREISE)
    assertEquals(v.chance.prozent, 0)
    assertEquals(v.sachverhalt, '')
    assertEquals(v.branche, null)
    assertEquals(v.vermittler, null)
    assertEquals(v.dienstleistungen, [])
  }
})

Deno.test('Verschachtelte Antwortform chance { prozent, begruendung } wird ebenfalls angenommen', () => {
  const v = bereinigeVorschlag({ chance: { prozent: 61, begruendung: 'KV angenommen.' }, branche: 'Bauhauptgewerbe', vermittler: 'Herr Huber' }, PREISE)
  assertEquals(v.chance, { prozent: 60, begruendung: 'KV angenommen.' })
  assertEquals(v.branche, 'Bauhauptgewerbe')
  assertEquals(v.vermittler, 'Herr Huber')
})

Deno.test('Zu lange Texte werden gekürzt', () => {
  const v = bereinigeVorschlag({ sachverhalt: 'a'.repeat(5000), branche: 'b'.repeat(500) }, PREISE)
  assert(v.sachverhalt.length <= 1200)
  assert((v.branche ?? '').length <= 120)
})

// ---------- Werkzeug ----------

Deno.test('Werkzeug begrenzt Dienstleistungen auf die Leistungsliste, ohne Liste kein enum', () => {
  const mit = checklisteWerkzeug(PREISE)
  // deno-lint-ignore no-explicit-any
  const props = (mit.input_schema as any).properties
  assertEquals(props.dienstleistungen.items.enum, PREISE)
  // deno-lint-ignore no-explicit-any
  const ohne = (checklisteWerkzeug([]).input_schema as any).properties
  assertEquals(ohne.dienstleistungen.items.enum, undefined)
})

// ---------- Auftragstext ----------

Deno.test('Auftragstext: Bereich auf Deutsch, Regeln und Leistungsliste enthalten', () => {
  const text = baueChecklistePrompt(kontext())
  assertStringIncludes(text, 'Bereich: Betriebsübergabe')
  assertStringIncludes(text, 'Muster Bau GmbH')
  assertStringIncludes(text, 'höchstens 20 %')
  assertStringIncludes(text, '- Nachfolgeberatung')
  assertStringIncludes(text, 'Heute ist 2026-11-20.')
  assertStringIncludes(text, '<akte>')
  // Leere Abschnitte werden ausdrücklich als leer gezeigt, damit die KI nichts hineindeutet.
  assertStringIncludes(text, '## Kostenvoranschläge\n(nichts vorhanden)')
})

Deno.test('Auftragstext: Verlauf neueste zuerst, höchstens 25 Einträge', () => {
  const activities = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`, text: `Eintrag ${i + 1}`, user: 'Hasan' }))
  const text = baueChecklistePrompt(kontext({ kunde: { firma: 'X', bereich: 'beratung', activities } }))
  assertStringIncludes(text, 'Verlauf (neueste zuerst, 25 von 30)')
  assert(text.indexOf('Eintrag 30') < text.indexOf('Eintrag 29'))
  assert(!text.includes('Eintrag 5\n') && !text.includes(': Eintrag 1\n'))
  assertStringIncludes(text, 'Bereich: Unternehmensberatung')
})

Deno.test('Auftragstext: Protokolle, KV, Wiedervorlage, Mails, Termine und bisherige Checkliste', () => {
  const text = baueChecklistePrompt(kontext({
    kunde: {
      firma: 'Muster Bau GmbH',
      bereich: 'finanzierungen',
      status: 'zeichnung_eingegangen',
      follow_up: { date: '2026-11-01', note: 'Nachfassen', done: false },
      vermittler: { name: 'Herr Huber', kundeId: 'k9' },
      auftrag_chance: { prozent: 40, bestaetigt: true, begruendung: 'Termin vereinbart' },
      signaturen: [{ id: 's1', name: 'Max', dataUrl: 'data:image/png;base64,GEHEIM', datum: '2026-11-02', kontext: 'Beratungsvertrag' }],
      unterlagen_anforderungen: [{ id: 'u1', datum: '2026-11-03', an: 'a@b.de', von: 'Eray', punkte: ['BWA 2025'], art: 'anforderung', token: 'GEHEIMESZEICHEN', eingang: [{ punkt: 'BWA 2025', datum: '2026-11-04', dokumentId: 'd1', name: 'bwa.pdf' }] }],
      unternehmensbewertung_recherche: { status: 'fertig', bericht: 'B'.repeat(5000) },
    },
    protokolle: [{ datum: '2026-11-05', betreff: 'Erstgespräch', ki_zusammenfassung: 'Kunde will verkaufen.', kernthemen: ['Verkauf'], vereinbarungen: ['Unterlagen schicken'], offene_punkte: [] }],
    kostenvoranschlaege: [{ name: 'Bewertung', betrag: 4500, status: 'angenommen', datum: '2026-11-06', aufschlag_prozent: 10 }],
    gesendet: [{ an: 'kunde@x.de', an_name: 'Max Muster', betreff: 'Angebot', text: 'Hallo', gesendet_am: '2026-11-07T09:00:00Z' }],
    eingegangen: [{ von: 'kunde@x.de', von_name: 'Max Muster', betreff: 'Re: Angebot', ausschnitt: 'Passt so', mail_datum: '2026-11-08T09:00:00Z' }],
    termineVergangen: [{ titel: 'Erstgespräch', beginn: '2026-11-05T10:00:00Z', sichtbar: true }],
    termineKommend: [{ titel: 'Privat', beginn: '2026-11-25T10:00:00Z', sichtbar: false }],
  }))
  assertStringIncludes(text, 'Bereich: Finanzierungen/Vermögensanlage')
  assertStringIncludes(text, '2026-11-01: Nachfassen (offen) — ÜBERFÄLLIG')
  assertStringIncludes(text, 'Vermittler: Herr Huber')
  assertStringIncludes(text, 'Auftragschance: 40 % (von einem Berater bestätigt) — Termin vereinbart')
  assertStringIncludes(text, '2026-11-02: Beratungsvertrag')
  assertStringIncludes(text, 'BWA 2025')
  assertStringIncludes(text, 'Eingang: bwa.pdf')
  assertStringIncludes(text, 'Vereinbarungen: Unterlagen schicken')
  assertStringIncludes(text, 'Stand: angenommen, Aufschlag 10 %')
  assertStringIncludes(text, '„Re: Angebot“ — Passt so')
  assertStringIncludes(text, '(Termin eines Kollegen, Inhalt nicht sichtbar)')
  // Unterschriftsbilder und Link-Kennungen gehören nie in den Auftrag; der Bericht wird gekürzt.
  assert(!text.includes('GEHEIM'))
  assert(!text.includes('B'.repeat(3001)))
})
