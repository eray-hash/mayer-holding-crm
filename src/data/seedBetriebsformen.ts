import type { Kunde, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-21'
const rel = (days: number) => addDays(REF, days)

export const seedBetriebsformenMandanten: Kunde[] = [
  {
    id: 'f1',
    firma: 'Weber & Partner GbR',
    ansprechpartner: 'Claudia Weber',
    email: 'c.weber@weber-partner-gbr.de',
    telefon: '+49 731 90 44 220',
    prioritaet: 'Hoch',
    status: 'umsetzung',
    followUp: { date: rel(-1), note: 'Gründungsunterlagen GmbH zur Unterschrift vorbereiten', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-25), text: 'Rechtsformvergleich GbR vs. GmbH vs. GmbH & Co. KG erstellt', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-3), text: 'Beratungsgespräch geführt, Umwandlung in GmbH beschlossen', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'f2',
    firma: 'Nachtwey Handel e.K.',
    ansprechpartner: 'Sven Nachtwey',
    email: 's.nachtwey@nachtwey-handel.de',
    telefon: '+49 731 15 66 802',
    prioritaet: 'Mittel',
    status: 'konzept_erstellt',
    followUp: { date: rel(4), note: 'Konzept zur Umwandlung in UG (haftungsbeschränkt) vorstellen', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-7),
    activities: [
      { id: uid('act'), date: rel(-7), text: 'Ist-Analyse Einzelunternehmen abgeschlossen', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'f3',
    firma: 'Rieger Fahrzeugtechnik GmbH',
    ansprechpartner: 'Thomas Rieger',
    email: 't.rieger@rieger-fahrzeugtechnik.de',
    telefon: '+49 731 33 77 145',
    prioritaet: 'Niedrig',
    status: 'bedarfsanalyse',
    followUp: { date: rel(6), note: 'Unterlagen zur Holding-Struktur (GmbH & Co. KG) anfordern', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-2),
    activities: [
      { id: uid('act'), date: rel(-2), text: 'Erstgespräch zu Holding-Struktur für Vermögensschutz geführt', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'f4',
    firma: 'Bühler Consulting',
    ansprechpartner: 'Katrin Bühler',
    email: 'k.buehler@buehler-consulting.de',
    telefon: '+49 176 22 90 441',
    prioritaet: 'Mittel',
    status: 'erstkontakt',
    followUp: { date: rel(8), note: 'Rückruf zur Terminfindung Erstgespräch', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-1),
    activities: [{ id: uid('act'), date: rel(-1), text: 'Anfrage über Website eingegangen', user: 'System' }],
  },
  {
    id: 'f5',
    firma: 'Maler Sattler GmbH',
    ansprechpartner: 'Jürgen Sattler',
    email: 'j.sattler@maler-sattler.de',
    telefon: '+49 731 61 20 933',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-50), note: 'Handelsregistereintrag GmbH vollzogen', done: true },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-45),
    activities: [
      { id: uid('act'), date: rel(-45), text: 'Status: Notartermin/Handelsregistereintrag → Abgeschlossen am ' + rel(-45) + ' durch Andreas Mayer', user: 'Andreas Mayer' },
    ],
  },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt, angepasst an die jeweilige Rechtsformberatung.'

export const seedVorlagenBetriebsformen: Vorlage[] = [
  { id: uid('vlf'), kategorie: 'vollmacht', name: 'Vollmacht Handelsregisteranmeldung', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vlf'), kategorie: 'schreiben', name: 'Anschreiben Erstkontakt Rechtsformberatung', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlf'), kategorie: 'schreiben', name: 'Rechtsformvergleich-Vorlage (GbR/UG/GmbH/KG)', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlf'), kategorie: 'vertraege', name: 'Gesellschaftsvertrag GmbH (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlf'), kategorie: 'vertraege', name: 'Umwandlungsbeschluss (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlf'), kategorie: 'vertraege', name: 'Beratungsvereinbarung Betriebsformen', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
]
