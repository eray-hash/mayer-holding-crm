// Tests für die Erweiterungen des Auswertungs-Schemas der Gesprächs-App (Runde 5): Sprachen, Fragebogen,
// Aktenfelder, Gesprächsnotiz. Die älteren Schema-Tests stehen in email-gateway/gespraechPipeline.test.ts.
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  fragenAusVorlage,
  gespraechsnotizText,
  hauptsprache,
  normalisiereAnalyse,
  normalisiereSprachwahl,
  ordneFragebogenZu,
  spracheAusErkennung,
  sprachName,
  whisperSprache,
} from './gespraechSchema.ts'

Deno.test('Sprachen: Einstellung, Kürzel für die Spracherkennung, erkannte Sprache, Namen', () => {
  assertEquals(normalisiereSprachwahl('türkisch'), 'tuerkisch')
  assertEquals(normalisiereSprachwahl('Türkisch'), 'tuerkisch')
  assertEquals(normalisiereSprachwahl('tr'), 'tuerkisch')
  assertEquals(normalisiereSprachwahl('Automatisch'), 'automatisch')
  assertEquals(normalisiereSprachwahl('klingonisch'), 'deutsch')
  assertEquals(normalisiereSprachwahl(undefined), 'deutsch')
  assertEquals(whisperSprache('automatisch'), null)
  assertEquals(whisperSprache('englisch'), 'en')
  assertEquals(whisperSprache(null), 'de')
  assertEquals(spracheAusErkennung('Turkish'), 'tr')
  assertEquals(spracheAusErkennung('german'), 'de')
  assertEquals(spracheAusErkennung('EN'), 'en')
  assertEquals(spracheAusErkennung('elbisch'), null)
  assertEquals(sprachName('tr'), 'Türkisch')
  assertEquals(sprachName('ku'), 'Kurdisch')
  assertEquals(sprachName(''), '')
})

Deno.test('Hauptsprache: der meiste Text entscheidet, Abschnitte ohne Angabe zählen zur Vorgabe', () => {
  assertEquals(hauptsprache([{ sprache: 'turkish', text: 'Merhaba, nasılsınız? Çok iyiyim.' }, { sprache: 'de', text: 'Gut.' }], null), 'tr')
  assertEquals(hauptsprache([{ text: 'Guten Tag, wie geht es Ihnen?' }, { sprache: 'en', text: 'Fine.' }], 'de'), 'de')
  assertEquals(hauptsprache([], 'de'), 'de')
  assertEquals(hauptsprache([{ text: '' }], null), null)
})

const MANDANTENBOGEN = `# MANDANTENFRAGEBOGEN
## A. Allgemeine Angaben
Name / Vorname: {{Name / Vorname}}
Familienstand / Kinder: {{Familienstand / Kinder}}
☐ Aufenthaltstitel vorhanden   Ablaufdatum: {{Ablaufdatum Aufenthaltstitel}}
☐ Duldung
**Zahlenwerk (bitte beifügen)**
☐ Jahresabschlüsse der letzten 3 Jahre
☐ Sonstige Einkünfte: {{Sonstige Einkünfte}}
Weitere Informationen: {{Auskunftsstelle Datenschutz=Andreas Mayer Holding UG}}
Status | Unterlage / Angabe | Erforderlich | Quelle | Bemerkung
☐ | Testament oder Erbvertrag | Ja / falls vorhanden | {{Quelle: Testament oder Erbvertrag}} | {{Bemerkung: Testament oder Erbvertrag}}
Mandant/in: | {{Mandant/in}} | Bearbeiter: | {{Bearbeiter}}`

Deno.test('Fragebogen: Fragen aus der Vorlage (Felder, Ankreuz-Zeilen, Tabellenzeilen), ohne Vorgaben und Doppelte', () => {
  const fragen = fragenAusVorlage(MANDANTENBOGEN)
  assertEquals(fragen, [
    'Name / Vorname',
    'Familienstand / Kinder',
    'Aufenthaltstitel vorhanden Ablaufdatum',
    'Ablaufdatum Aufenthaltstitel',
    'Duldung',
    'Jahresabschlüsse der letzten 3 Jahre',
    'Sonstige Einkünfte',
    'Testament oder Erbvertrag',
    'Mandant/in',
  ])
})

Deno.test('Fragebogen: Antworten über Nummer oder Fragetext zugeordnet, Fremdes entfällt, Frage wie in der Vorlage', () => {
  const fragen = ['Name / Vorname', 'Familienstand / Kinder', 'Testament oder Erbvertrag']
  const fb = ordneFragebogenZu([
    { nr: 3, antwort: 'Testament von 2019 liegt beim Notar', sicher: true },
    { nr: 99, frage: 'Lieblingsfarbe', antwort: 'Blau', sicher: true },
    { frage: 'familienstand/kinder', antwort: 'verheiratet, zwei Kinder' },
    { nr: '1', antwort: '' },
    { nr: 1, frage: 'Name / Vorname', antwort: 'Huber, Franz', sicher: 'ja' },
  ], fragen)
  assertEquals(fb, [
    { frage: 'Name / Vorname', antwort: 'Huber, Franz', sicher: false },
    { frage: 'Familienstand / Kinder', antwort: 'verheiratet, zwei Kinder', sicher: false },
    { frage: 'Testament oder Erbvertrag', antwort: 'Testament von 2019 liegt beim Notar', sicher: true },
  ])
})

Deno.test('Normalisieren: Fragebogen und Aktenfelder nur, wenn etwas da ist; ältere Auswertungen unverändert', () => {
  const alt = normalisiereAnalyse({ zusammenfassung: 'Kurz.', mail_entwurf: { betreff: '', text: '' } })
  assert(!('fragebogen' in alt) && !('aktenfelder' in alt) && !('fragebogen_vorlage' in alt))
  const a = normalisiereAnalyse({
    zusammenfassung: 'Kurz.',
    fragebogen: [{ frage: 'Name', antwort: 'Huber', sicher: true }, { frage: 'name', antwort: 'doppelt' }, { frage: 'Leer', antwort: 'unbekannt' }],
    fragebogen_vorlage: { id: 'vl_1', name: 'Mandantenfragebogen' },
    aktenfelder: { sachverhalt: '  Nachfolge der Bäckerei regeln.  ', branche: '-', dienstleistungen: 'Nachfolgeberatung; Unternehmensbewertung, Nachfolgeberatung' },
  })
  assertEquals(a.fragebogen, [{ frage: 'Name', antwort: 'Huber', sicher: true }])
  assertEquals(a.fragebogen_vorlage, { id: 'vl_1', name: 'Mandantenfragebogen' })
  assertEquals(a.aktenfelder, { sachverhalt: 'Nachfolge der Bäckerei regeln.', dienstleistungen: ['Nachfolgeberatung', 'Unternehmensbewertung'] })
  // Ohne Antworten keine Vorlage.
  const b = normalisiereAnalyse({ fragebogen: [], fragebogen_vorlage: { id: 'vl_1', name: 'X' }, aktenfelder: {} })
  assert(!('fragebogen_vorlage' in b) && !('aktenfelder' in b))
})

Deno.test('Gesprächsnotiz: Zusammenfassung, Vereinbarungen, Schritte, Unterlagen; mit Signatur ohne Namen', () => {
  const a = {
    zusammenfassung: 'Wir haben über die Nachfolge gesprochen.',
    vereinbarungen: ['Bewertung bis Monatsende'],
    naechste_schritte: [{ text: 'Bilanz schicken', faellig: '2026-11-27', wer: 'Herr Huber' }],
    unterlagen_fehlen: ['Bilanz 2025'],
  }
  const n = gespraechsnotizText(a, { anrede: 'Sehr geehrter Herr Huber,', datum: '2026-11-22', absender: 'Hasan Yilmaz' })
  assertEquals(n.betreff, 'Gesprächsnotiz vom 22.11.2026')
  assertStringIncludes(n.text, 'Sehr geehrter Herr Huber,')
  assertStringIncludes(n.text, 'Gespräch am 22.11.2026')
  assertStringIncludes(n.text, '- Bilanz schicken (Herr Huber, bis 27.11.2026)')
  assertStringIncludes(n.text, 'Bitte senden Sie uns noch:\n- Bilanz 2025')
  assert(n.text.endsWith('Mit freundlichen Grüßen\nHasan Yilmaz'))
  const m = gespraechsnotizText({ ...a, vereinbarungen: [], unterlagen_fehlen: [] }, { absender: 'Hasan Yilmaz', mitSignatur: true })
  assert(m.text.startsWith('Guten Tag,'))
  assert(!m.text.includes('Vereinbart:'))
  assert(m.text.endsWith('Mit freundlichen Grüßen'))
})
