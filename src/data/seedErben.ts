import type { Kunde, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-21'
const rel = (days: number) => addDays(REF, days)

export const seedErbenMandanten: Kunde[] = [
  {
    id: 'e1',
    firma: 'Familie Lehle',
    ansprechpartner: 'Josef Lehle',
    email: 'j.lehle@web.de',
    telefon: '+49 8252 99 41 02',
    prioritaet: 'Hoch',
    status: 'umsetzung',
    followUp: { date: rel(-2), note: 'Testamentsentwurf zur Unterschrift vorlegen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-30), text: 'Mandantenmemo Vermögensschutz erstellt', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-4), text: 'Beratungsgespräch geführt, Testament + Vorsorgevollmacht besprochen', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'e2',
    firma: 'Familie Keller',
    ansprechpartner: 'Markus Keller',
    email: 'm.keller@gmx.de',
    telefon: '+49 731 55 21 340',
    prioritaet: 'Mittel',
    status: 'unterlagen_angefordert',
    followUp: { date: rel(-1), note: 'Erinnerung: Mandantenfragebogen noch nicht zurück', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-10),
    activities: [
      { id: uid('act'), date: rel(-10), text: 'Mandantenfragebogen Vermögens-/Familien-/Nachfolgeplanung versendet', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'e3',
    firma: 'Familie Ostermann',
    ansprechpartner: 'Dr. Michael Ostermann',
    email: 'michael.ostermann@web.de',
    telefon: '+49 731 22 87 561',
    prioritaet: 'Hoch',
    status: 'konzept_erstellt',
    followUp: { date: rel(2), note: 'Mandantenmemo vor dem Gespräch final gegenlesen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-3), text: 'Entscheidungsmatrix Instrumente (Stiftung/Ehevertrag/Testament) erstellt', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'e4',
    firma: 'Familie Voigt-Lindner',
    ansprechpartner: 'Sabrina Voigt-Lindner',
    email: 'kontakt@voigt-lindner-familie.de',
    telefon: '+49 176 33 40 771',
    prioritaet: 'Mittel',
    status: 'bedarfsanalyse',
    followUp: { date: rel(4), note: 'Erstgespräch terminiert', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-1),
    activities: [
      { id: uid('act'), date: rel(-1), text: 'Erstkontakt telefonisch, Termin vereinbart', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'e5',
    firma: 'Rehnert Beteiligungs GmbH (Familienstamm)',
    ansprechpartner: 'J. Rehnert',
    email: 'j.rehnert@rehnert-beteiligungen.de',
    telefon: '+49 731 88 12 004',
    prioritaet: 'Niedrig',
    status: 'erstkontakt',
    followUp: { date: rel(9), note: 'Rückruf wg. Unternehmensnachfolge-Themen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-1),
    activities: [{ id: uid('act'), date: rel(-1), text: 'Anfrage über Website eingegangen', user: 'System' }],
  },
  {
    id: 'e6',
    firma: 'Familie Brandner',
    ansprechpartner: 'Elke Brandner',
    email: 'e.brandner@t-online.de',
    telefon: '+49 731 40 22 918',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-45), note: 'Testament notariell beurkundet', done: true },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-40),
    activities: [
      { id: uid('act'), date: rel(-40), text: 'Status: Umsetzung → Abgeschlossen am ' + rel(-40) + ' durch Andreas Mayer', user: 'Andreas Mayer' },
    ],
  },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt, angepasst an Erb- und Nachfolgefragen der jeweiligen Mandantschaft.'

export const seedVorlagenErben: Vorlage[] = [
  { id: uid('vle'), kategorie: 'vollmacht', name: 'Allgemeine Vollmacht (über den Tod hinaus)', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vle'), kategorie: 'vollmacht', name: 'Vorsorgevollmacht', typ: 'Vollmacht', zuletztGeaendert: rel(-25), text: vorlageText },
  { id: uid('vle'), kategorie: 'vollmacht', name: 'Patientenverfügung', typ: 'Vollmacht', zuletztGeaendert: rel(-25), text: vorlageText },
  { id: uid('vle'), kategorie: 'schreiben', name: 'Anschreiben Erstkontakt Erben', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vle'), kategorie: 'schreiben', name: 'Mandantenfragebogen – Vermögens-, Familien- und Nachfolgeplanung', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vle'), kategorie: 'schreiben', name: 'Mandantenmemo-Vorlage', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vle'), kategorie: 'vertraege', name: 'Testament / Erbvertrag (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vle'), kategorie: 'vertraege', name: 'Familienstiftung errichten (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vle'), kategorie: 'vertraege', name: 'Beratungsvereinbarung Erben', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
]

// Checkliste aus dem echten Mandantenfragebogen (Vermögens-, Familien- und Nachfolgeplanung)
export const ERBEN_CHECKLISTE: { kategorie: string; punkte: string[] }[] = [
  {
    kategorie: '1. Persönliche Angaben',
    punkte: [
      'Vollständiger Name, Geburtsname, Geburtsdatum und -ort',
      'Aktuelle Wohnanschrift und gewöhnlicher Aufenthalt',
      'Staatsangehörigkeit(en)',
      'Familienstand',
      'Güterstand / Ehevertrag',
    ],
  },
  {
    kategorie: '2. Familie und mögliche Erben',
    punkte: [
      'Ehegatte bzw. eingetragener Lebenspartner',
      'Kinder einschließlich Adoptiv-, Stief- und Pflegekinder',
      'Enkelkinder und weitere Abkömmlinge',
      'Gewünschte Erben oder Begünstigte',
      'Personen, die bewusst nicht bedacht werden sollen',
    ],
  },
  {
    kategorie: '3. Testamente und Vorsorge',
    punkte: [
      'Eigenhändiges oder notarielles Testament vorhanden',
      'Vorsorgevollmacht',
      'Patientenverfügung',
      'Betreuungsverfügung',
    ],
  },
  {
    kategorie: '4. Vermögensübersicht',
    punkte: [
      'Immobilien und Grundbuchauszüge',
      'Unternehmens-/Gesellschaftsbeteiligungen',
      'Bankguthaben, Wertpapierdepots',
      'Lebens- und Rentenversicherungen',
    ],
  },
  {
    kategorie: '5. Frühere Übertragungen und Steuerdaten',
    punkte: [
      'Schenkungen der vergangenen zehn Jahre',
      'Steuerbescheide zur Schenkung-/Erbschaftsteuer',
    ],
  },
  {
    kategorie: '6. Ziele und offene Fragen',
    punkte: ['Wichtigste Ziele und Prioritäten für die geplante Nachfolgegestaltung'],
  },
]
