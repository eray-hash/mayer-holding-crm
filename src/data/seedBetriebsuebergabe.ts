import type { Kunde, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-21'
const rel = (days: number) => addDays(REF, days)

export const seedBetriebsuebergabeMandanten: Kunde[] = [
  {
    id: 'b1',
    firma: 'Schreinerei Haug GmbH',
    ansprechpartner: 'Reinhold Haug',
    email: 'r.haug@schreinerei-haug.de',
    telefon: '+49 731 66 12 450',
    prioritaet: 'Hoch',
    status: 'nachfolgersuche',
    followUp: { date: rel(-1), note: 'Rückmeldung zu zwei Kaufinteressenten einholen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-5),
    activities: [
      { id: uid('act'), date: rel(-40), text: 'Unternehmensbewertung abgeschlossen', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-5), text: 'Nachfolgekonzept vorgestellt, externe Käufersuche gestartet', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'b2',
    firma: 'Autohaus Renz KG',
    ansprechpartner: 'Bernd Renz',
    email: 'b.renz@autohaus-renz.de',
    telefon: '+49 731 40 88 210',
    prioritaet: 'Mittel',
    status: 'unternehmensbewertung',
    followUp: { date: rel(3), note: 'Bilanzunterlagen der letzten drei Jahre noch ausstehend', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-8),
    activities: [
      { id: uid('act'), date: rel(-8), text: 'Bedarfsanalyse durchgeführt, Bewertung beauftragt', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'b3',
    firma: 'Café Lindenhof e.K.',
    ansprechpartner: 'Petra Wimmer',
    email: 'p.wimmer@cafe-lindenhof.de',
    telefon: '+49 731 20 55 671',
    prioritaet: 'Hoch',
    status: 'verhandlung',
    followUp: { date: rel(-3), note: 'Übergabevertrag mit Tochter final abstimmen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-6),
    activities: [
      { id: uid('act'), date: rel(-20), text: 'Familieninterne Nachfolge (Tochter) als bevorzugte Lösung festgelegt', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-6), text: 'Erster Vertragsentwurf an beide Parteien versendet', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'b4',
    firma: 'Elektro Baumann GmbH',
    ansprechpartner: 'Frank Baumann',
    email: 'f.baumann@elektro-baumann.de',
    telefon: '+49 7351 44 90 12',
    prioritaet: 'Mittel',
    status: 'bedarfsanalyse',
    followUp: { date: rel(5), note: 'Erstgespräch mit beiden Söhnen (potenzielle Nachfolger)', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-2),
    activities: [
      { id: uid('act'), date: rel(-2), text: 'Erstkontakt über Handwerkskammer-Empfehlung', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'b5',
    firma: 'Gasthof Krone',
    ansprechpartner: 'Manfred Stölzle',
    email: 'info@gasthof-krone-ulm.de',
    telefon: '+49 731 77 34 209',
    prioritaet: 'Niedrig',
    status: 'erstkontakt',
    followUp: { date: rel(10), note: 'Rückruf zur Terminfindung Erstgespräch', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-1),
    activities: [{ id: uid('act'), date: rel(-1), text: 'Anfrage telefonisch eingegangen', user: 'System' }],
  },
  {
    id: 'b6',
    firma: 'Metallbau Fink GmbH',
    ansprechpartner: 'Werner Fink',
    email: 'w.fink@metallbau-fink.de',
    telefon: '+49 731 55 60 933',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-60), note: 'Notarielle Übergabe an Nachfolger vollzogen', done: true },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-55),
    activities: [
      { id: uid('act'), date: rel(-55), text: 'Status: Notartermin/Übergabe vollzogen → Abgeschlossen am ' + rel(-55) + ' durch Andreas Mayer', user: 'Andreas Mayer' },
    ],
  },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt, angepasst an die jeweilige Betriebsübergabe-Situation.'

export const seedVorlagenBetriebsuebergabe: Vorlage[] = [
  { id: uid('vlb'), kategorie: 'vollmacht', name: 'Vollmacht Unternehmensbewertung', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vlb'), kategorie: 'vollmacht', name: 'Vollmacht Verhandlungsführung', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vlb'), kategorie: 'schreiben', name: 'Anschreiben Erstkontakt Betriebsübergabe', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlb'), kategorie: 'schreiben', name: 'Fragebogen Unternehmensnachfolge', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlb'), kategorie: 'schreiben', name: 'Nachfolgekonzept-Vorlage', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlb'), kategorie: 'vertraege', name: 'Übergabevertrag (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlb'), kategorie: 'vertraege', name: 'Beratungsvereinbarung Betriebsübergabe', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlb'), kategorie: 'vertraege', name: 'Geheimhaltungsvereinbarung (NDA) für Käuferprozess', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
]
