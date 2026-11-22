// deno test src/gespraech/komponenten/leitfadenText.test.ts
// Ausschnitte im Aufbau der echten Vorlagen (Mandantenfragebogen, Professionelle Beratungsfragen,
// Fragen an den Steuerberater, Unterlagen-Checkliste, Erben-Fragebogen mit Tabellen).
import { frageMarkerText, leitfadenAusText, leitfadenAusVorlage, leitfadenMarkerText, saeubere, vorlagenBereich, vorschlag, type Leitfaden } from './leitfadenText.ts'
import { gleich, test, wahr } from '../tests/hilfe.ts'

const MANDANT = `# MANDANTENFRAGEBOGEN – UNTERNEHMEN & PRIVAT

## A. Allgemeine Angaben

Name / Vorname: {{Name / Vorname}}
Telefon / Mobil: {{Telefon / Mobil}}

Aufenthaltsstatus (falls nicht EU):
☐ Aufenthaltstitel vorhanden   Ablaufdatum: {{Ablaufdatum Aufenthaltstitel}}
☐ Duldung

## B. Unternehmen / berufliche Situation

**Zahlenwerk (bitte beifügen)**
☐ Aktuelle BWA + Summen- und Saldenliste
☐ Bankkonten (Bank, IBAN, Kontostände per {{Kontostände per}})

## F. Ziele und Erwartungen

Was ist Ihnen besonders wichtig? (Mehrfachauswahl möglich)

☐ Steuerliche Entlastung
☐ Sonstiges: {{Sonstiges}}
`

const BERATUNG = `# Professionelle Beratungsfragen

Bereich: {{Bereich=Unternehmensberatung}}   Datum: {{Datum}}
Kunde: {{Kunde}}   Telefon: {{Telefon}}

Firmenform: {{Firmenform}}

**Interessen/ Motive:**
{{Interessen / Motive}}

**• Wie ist Ihr Unternehmen aktuell strukturiert?**
{{Antwort: Struktur des Unternehmens}}

**• Gibt es Überlegungen zur Unternehmensnachfolge?**
{{Antwort: Unternehmensnachfolge}}

**Ihre Fragen bzw Notizen**
{{Fragen bzw. Notizen}}
`

const STEUERBERATER = `# Fragen an den Steuerberater

**• Aktueller Status der Buchhaltung:**
    o Welche Buchhaltung ist abgegeben an das Finanzamt?
      {{Antwort: abgegebene Buchhaltung}}
    o Ist die Buchhaltung für das laufende Jahr ({{Laufendes Jahr=2025/2026}}) vollständig?
      {{Antwort: Buchhaltung laufendes Jahr}}

**• Liquiditätsprognose:**
    o Liegt eine aktuelle Liquiditätsplanung (3–6 Monate) vor?
      {{Antwort: Liquiditätsplanung}}
`

const CHECKLISTE = `## B. Buchhaltung & Finanzen

☐ **Jahresabschlüsse:** Bilanz und GuV der letzten 2–3 Jahre.
☐ **Kontoauszüge:**
    ☐ Geschäftskonto: Letzten 12 Monate (vollständig).
    ☐ Privatkonto: Letzten 6–12 Monate.

**Notizen**
{{Notizen}}
`

const ERBEN = `# MANDANTENFRAGEBOGEN
## Vermögens-, Familien- und Nachfolgeplanung

Dieser Fragebogen dient der Vorbereitung einer ganzheitlichen Beratung.

## Mandatsdaten

Mandant/in bzw. betroffene Person: | {{Mandant/in}} | Objekt / Projekt: | {{Objekt / Projekt}}

## Datenschutzhinweis

Weitere Informationen erhalten Sie bei: {{Auskunftsstelle Datenschutz=Andreas Mayer Holding UG}}.

## 1. Persönliche Angaben

Status | Unterlage / Angabe | Erforderlich | Quelle | Bemerkung
☐ | Familienstand | Ja / falls vorhanden | {{Quelle: Familienstand}} | {{Bemerkung: Familienstand}}
☐ | Familienstand | Ja / falls vorhanden | {{Quelle: Familienstand}} | {{Bemerkung: Familienstand}}

## 4. Vermögensübersicht

Vermögensgegenstand | Eigentümer / Anteil | Quote
{{Vermögen 1: Gegenstand}} | {{Vermögen 1: Eigentümer / Anteil}} | {{Vermögen 1: Quote}}

Relevante Vermögensbereiche: Immobilien, Betriebsvermögen, Bankguthaben, Wertpapierdepots, digitales Vermögen.

## 7. Ziele und offene Fragen

Bitte beschreiben Sie Ihre wichtigsten Ziele und Prioritäten für die geplante Vermögens-, Erb- oder Nachfolgegestaltung:

{{Ziele und Prioritäten}}

Ort / Datum: {{Ort, Datum}}   Unterschrift: ______________________________
`

const texte = (t: string) => leitfadenAusText(t).map((a) => [a.titel, a.punkte.map((p) => p.text)])

test('Platzhalter werden lesbar', () => {
  gleich(saeubere('Bankkonten (Bank, IBAN, Kontostände per {{Kontostände per}})'), 'Bankkonten (Bank, IBAN, Kontostände per …)')
  gleich(saeubere('Ist die Buchhaltung für das laufende Jahr ({{Laufendes Jahr=2025/2026}}) vollständig?'), 'Ist die Buchhaltung für das laufende Jahr (2025/2026) vollständig?')
  gleich(saeubere('Aufenthaltstitel vorhanden   Ablaufdatum: {{Ablaufdatum Aufenthaltstitel}}'), 'Aufenthaltstitel vorhanden – Ablaufdatum')
  gleich(saeubere('Sonstiges: {{Sonstiges}}'), 'Sonstiges')
})

test('Mandantenfragebogen: Felder, Kästchen, Unterabschnitte, Frage im Fließtext', () => {
  gleich(texte(MANDANT), [
    ['A. Allgemeine Angaben', ['Name / Vorname', 'Telefon / Mobil']],
    ['Aufenthaltsstatus (falls nicht EU)', ['Aufenthaltstitel vorhanden – Ablaufdatum', 'Duldung']],
    ['Zahlenwerk (bitte beifügen)', ['Aktuelle BWA + Summen- und Saldenliste', 'Bankkonten (Bank, IBAN, Kontostände per …)']],
    ['F. Ziele und Erwartungen', ['Was ist Ihnen besonders wichtig? (Mehrfachauswahl möglich)', 'Steuerliche Entlastung', 'Sonstiges']],
  ])
  const a = leitfadenAusText(MANDANT)
  gleich(a[2].ober, 'B. Unternehmen / berufliche Situation', 'Oberabschnitt bleibt erhalten')
})

test('Beratungsfragen: Kopfzeilen und Notizfeld fallen weg, fette Frage mit Antwortfeld wird Punkt', () => {
  gleich(texte(BERATUNG), [['Allgemein', ['Firmenform', 'Interessen/ Motive', 'Wie ist Ihr Unternehmen aktuell strukturiert?', 'Gibt es Überlegungen zur Unternehmensnachfolge?']]])
})

test('Steuerberater: Aufzählung mit Doppelpunkt wird Abschnitt, eingerückte Fragen sind keine Unterpunkte', () => {
  gleich(texte(STEUERBERATER), [
    ['Aktueller Status der Buchhaltung', ['Welche Buchhaltung ist abgegeben an das Finanzamt?', 'Ist die Buchhaltung für das laufende Jahr (2025/2026) vollständig?']],
    ['Liquiditätsprognose', ['Liegt eine aktuelle Liquiditätsplanung (3–6 Monate) vor?']],
  ])
  wahr(leitfadenAusText(STEUERBERATER).every((a) => a.punkte.every((p) => !p.unter)), 'keine Unterpunkte')
})

test('Checkliste: fettes Stichwort + Hinweis, eingerückte Kästchen sind Unterpunkte', () => {
  const [b] = leitfadenAusText(CHECKLISTE)
  gleich(b.punkte.map((p) => [p.text, p.hinweis ?? null, p.unter === true]), [
    ['Jahresabschlüsse', 'Bilanz und GuV der letzten 2–3 Jahre.', false],
    ['Kontoauszüge', null, false],
    ['Geschäftskonto: Letzten 12 Monate (vollständig).', null, true],
    ['Privatkonto: Letzten 6–12 Monate.', null, true],
  ])
})

test('Erben: Tabellenzeilen mit Kästchen, Aufzählung nach Doppelpunkt, Zielfrage; Hinweise/Kopf/Unterschrift weg', () => {
  const a = leitfadenAusText(ERBEN)
  gleich(texte(ERBEN), [
    ['1. Persönliche Angaben', ['Familienstand', 'Familienstand']],
    ['Relevante Vermögensbereiche', ['Immobilien', 'Betriebsvermögen', 'Bankguthaben', 'Wertpapierdepots', 'Digitales Vermögen']],
    ['7. Ziele und offene Fragen', ['Bitte beschreiben Sie Ihre wichtigsten Ziele und Prioritäten für die geplante Vermögens-, Erb- oder Nachfolgegestaltung']],
  ])
  const ids = a.flatMap((x) => x.punkte.map((p) => p.id))
  gleich(new Set(ids).size, ids.length, 'Kennungen eindeutig, auch bei doppeltem Text')
})

test('Vorlage ohne verwertbaren Text liefert keinen Leitfaden', () => {
  gleich(leitfadenAusVorlage({ id: 'x', name: 'Leer', bereich: 'beratung', typ: 'Fragebogen', text: '# Nur ein Titel\n\nDatum: {{Datum}}' }), null)
  gleich(leitfadenAusVorlage({ id: 'x', name: 'Leer', bereich: 'beratung', typ: 'Fragebogen', text: null }), null)
})

test('Vorschlag je Bereich und Art', () => {
  const l = (id: string, name: string, bereich: string, text: string): Leitfaden => leitfadenAusVorlage({ id, name, bereich, typ: 'Fragebogen', text })!
  const liste = [
    l('m', 'Mandantenfragebogen – Unternehmen & Privat', 'beratung', MANDANT),
    l('b', 'Professionelle Beratungsfragen', 'beratung', BERATUNG),
    l('s', 'Fragen an den Steuerberater', 'beratung', STEUERBERATER),
    l('e', 'Mandantenfragebogen – Nachfolge', 'erben', ERBEN),
  ]
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'termin' }), 'm')
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'telefon' }), 'b', 'Telefonat: Fragen, kein Bogen für Dritte')
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'notiz' }), null)
  gleich(vorschlag(liste, { bereich: 'erben', art: 'telefon' }), null, 'Erben-Bogen hat kaum echte Fragen')
  gleich(vorschlag(liste, { bereich: 'akademie', art: 'termin' }), null)
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'termin', zuletzt: 's' }), 's', 'zuletzt gewählt gewinnt')
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'termin', zuletzt: '' }), null, 'zuletzt „keiner“')
  gleich(vorschlag(liste, { bereich: 'beratung', art: 'termin', zuletzt: 'weg' }), 'm', 'gelöschte Vorlage → Regel')
  gleich(vorlagenBereich('immobilienkunden'), 'immobilien')
  gleich(vorlagenBereich(undefined, true), 'immobilien')
  gleich(vorlagenBereich('erben'), 'erben')
})

test('Markierungstexte', () => {
  gleich(frageMarkerText('Familienstand', ' verheiratet, 2 Kinder '), 'Familienstand: verheiratet, 2 Kinder')
  const lang = frageMarkerText('F'.repeat(200), 'N'.repeat(400))
  wahr(lang.length === 300 && lang.startsWith(`${'F'.repeat(139)}…: N`), 'gekürzt auf 300, Frage auf 140')
  gleich(leitfadenMarkerText({ id: 'vl_1', name: 'Beratungsfragen' }), 'Leitfaden: Beratungsfragen [vl_1]')
})
