import type { Kunde, Rechnung, Protokoll, Konzept, Beratungsvertrag, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

// Referenzdatum der Demo: 08.09.2026
const REF = '2026-09-08'

const rel = (days: number) => addDays(REF, days)

export const seedKunden: Kunde[] = [
  {
    id: 'k1',
    firma: 'Nordwind Maschinenbau GmbH',
    ansprechpartner: 'Sabine Kellermann',
    email: 's.kellermann@nordwind-maschinen.de',
    telefon: '+49 421 55 12 340',
    prioritaet: 'Hoch',
    status: 'lead',
    followUp: { date: rel(3), note: 'Erstkontakt-Anruf vereinbaren', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-2),
    activities: [
      { id: uid('act'), date: rel(-2), text: 'Anfrage über Website eingegangen', user: 'System' },
    ],
  },
  {
    id: 'k2',
    firma: 'Lindenhof Textilhandel KG',
    ansprechpartner: 'Michael Groß',
    email: 'm.gross@lindenhof-textil.de',
    telefon: '+49 30 88 21 904',
    prioritaet: 'Mittel',
    status: 'erstkontakt',
    followUp: { date: rel(-4), note: 'Rückruf zur Terminfindung', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-9), text: 'Status: Lead / Neuanfrage → Erstkontakt hergestellt am ' + rel(-9) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k3',
    firma: 'Bergmann & Schuster Logistik AG',
    ansprechpartner: 'Christine Bergmann',
    email: 'c.bergmann@bs-logistik.de',
    telefon: '+49 211 77 43 210',
    prioritaet: 'Hoch',
    status: 'termin',
    followUp: { date: rel(2), note: 'Erstgespräch vorbereiten (Unterlagen)', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-1),
    activities: [
      { id: uid('act'), date: rel(-6), text: 'Status: Erstkontakt hergestellt → Erstgespräch terminiert am ' + rel(-6) + ' durch Thomas Berger', user: 'Thomas Berger' },
      { id: uid('act'), date: rel(-1), text: 'Termin für ' + rel(2) + ' bestätigt', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k4',
    firma: 'Falkenstein Immobilienverwaltung GmbH',
    ansprechpartner: 'Andreas Falkenstein',
    email: 'a.falkenstein@falkenstein-iv.de',
    telefon: '+49 69 90 12 887',
    prioritaet: 'Mittel',
    status: 'durchgefuehrt',
    followUp: { date: rel(5), note: 'Konzept ausarbeiten', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-3), text: 'Status: Erstgespräch terminiert → Erstgespräch durchgeführt am ' + rel(-3) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k5',
    firma: 'Rheinquell Getränke GmbH',
    ansprechpartner: 'Peter Winkelmann',
    email: 'p.winkelmann@rheinquell.de',
    telefon: '+49 221 33 56 771',
    prioritaet: 'Hoch',
    status: 'konzept',
    followUp: { date: rel(-2), note: 'Feedback zum Konzept einholen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-7),
    activities: [
      { id: uid('act'), date: rel(-7), text: 'Status: Erstgespräch durchgeführt → Konzeptvorstellung am ' + rel(-7) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k6',
    firma: 'Wiesengrund Agrarhandel eG',
    ansprechpartner: 'Katrin Voss',
    email: 'k.voss@wiesengrund-agrar.de',
    telefon: '+49 511 22 98 034',
    prioritaet: 'Niedrig',
    status: 'angebot',
    followUp: { date: rel(6), note: 'Nachfassen zum Angebot', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-4), text: 'Status: Konzeptvorstellung → Angebot / Beratungsvertrag versendet am ' + rel(-4) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k7',
    firma: 'Amberger Feinmechanik GmbH',
    ansprechpartner: 'Robert Amberger',
    email: 'r.amberger@amberger-feinmechanik.de',
    telefon: '+49 941 44 21 665',
    prioritaet: 'Mittel',
    status: 'unterschrieben',
    followUp: { date: rel(1), note: 'Mandat starten, Kickoff planen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-1),
    activities: [
      { id: uid('act'), date: rel(-1), text: 'Status: Angebot / Beratungsvertrag versendet → Beratungsvertrag unterschrieben am ' + rel(-1) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k8',
    firma: 'Hoffmann & Cie. Vermögensverwaltung',
    ansprechpartner: 'Elisabeth Hoffmann',
    email: 'e.hoffmann@hoffmann-vv.de',
    telefon: '+49 89 66 43 219',
    prioritaet: 'Hoch',
    status: 'aktives_mandat',
    followUp: { date: rel(-6), note: 'Quartalsreview durchführen', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-12),
    activities: [
      { id: uid('act'), date: rel(-30), text: 'Status: Beratungsvertrag unterschrieben → Aktives Mandat / laufende Beratung am ' + rel(-30) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
      { id: uid('act'), date: rel(-12), text: 'Zwischenbericht versendet', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k9',
    firma: 'Seidel Bau- und Projektentwicklung',
    ansprechpartner: 'Frank Seidel',
    email: 'f.seidel@seidel-bau.de',
    telefon: '+49 351 77 88 902',
    prioritaet: 'Mittel',
    status: 'rechnung_gestellt',
    followUp: { date: rel(10), note: 'Zahlungseingang prüfen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-5),
    activities: [
      { id: uid('act'), date: rel(-5), text: 'Status: Aktives Mandat / laufende Beratung → Leistung erbracht / Rechnung gestellt am ' + rel(-5) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k10',
    firma: 'Brandt & Möller Consulting Partner',
    ansprechpartner: 'Nicole Brandt',
    email: 'n.brandt@brandt-moeller.de',
    telefon: '+49 40 12 34 567',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-20), note: 'Mandat abgeschlossen', done: true },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-15),
    activities: [
      { id: uid('act'), date: rel(-15), text: 'Status: Leistung erbracht / Rechnung gestellt → Abgeschlossen am ' + rel(-15) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
]

export const seedRechnungen: Rechnung[] = [
  { id: uid('r'), nummer: 'RE-2026-1001', kundeId: 'k7', datum: rel(-40), betragNetto: 4200, betragBrutto: 4998, status: 'Bezahlt', zahlungsziel: rel(-26) },
  { id: uid('r'), nummer: 'RE-2026-1014', kundeId: 'k8', datum: rel(-35), betragNetto: 6800, betragBrutto: 8092, status: 'Bezahlt', zahlungsziel: rel(-21) },
  { id: uid('r'), nummer: 'RE-2026-1022', kundeId: 'k8', datum: rel(-12), betragNetto: 3400, betragBrutto: 4046, status: 'Versendet', zahlungsziel: rel(16) },
  { id: uid('r'), nummer: 'RE-2026-1031', kundeId: 'k9', datum: rel(-5), betragNetto: 9600, betragBrutto: 11424, status: 'Versendet', zahlungsziel: rel(9) },
  { id: uid('r'), nummer: 'RE-2026-0987', kundeId: 'k9', datum: rel(-52), betragNetto: 2100, betragBrutto: 2499, status: 'Überfällig', zahlungsziel: rel(-24) },
  { id: uid('r'), nummer: 'RE-2026-1035', kundeId: 'k10', datum: rel(-16), betragNetto: 12500, betragBrutto: 14875, status: 'Bezahlt', zahlungsziel: rel(-2) },
  { id: uid('r'), nummer: 'RE-2026-0965', kundeId: 'k10', datum: rel(-70), betragNetto: 5400, betragBrutto: 6426, status: 'Überfällig', zahlungsziel: rel(-40) },
  { id: uid('r'), nummer: 'RE-2026-1040', kundeId: 'k7', datum: rel(-1), betragNetto: 1800, betragBrutto: 2142, status: 'Entwurf', zahlungsziel: rel(29) },
]

export const seedProtokolle: Protokoll[] = [
  { id: uid('p'), kundeId: 'k3', datum: rel(-1), teilnehmer: 'Christine Bergmann, Thomas Berger', betreff: 'Vorgespräch Erstgespräch', text: 'Themen für das Erstgespräch abgestimmt, Fokus auf Prozessoptimierung Lager.' },
  { id: uid('p'), kundeId: 'k5', datum: rel(-7), teilnehmer: 'Peter Winkelmann, Thomas Berger', betreff: 'Konzeptvorstellung', text: 'Konzept zur Neuausrichtung Vertrieb vorgestellt, positives Feedback.' },
  { id: uid('p'), kundeId: 'k8', datum: rel(-12), teilnehmer: 'Elisabeth Hoffmann, Julia Hartmann', betreff: 'Quartalsgespräch Q3', text: 'Laufendes Mandat besprochen, Zwischenbericht übergeben.' },
  { id: uid('p'), kundeId: 'k8', datum: rel(-45), teilnehmer: 'Elisabeth Hoffmann, Julia Hartmann', betreff: 'Kickoff aktives Mandat', text: 'Startbesprechung zur laufenden Vermögensberatung.' },
]

export const seedKonzepte: Konzept[] = [
  { id: uid('c'), kundeId: 'k5', datum: rel(-7), titel: 'Konzept Vertriebsneuausrichtung', version: 'v1.2', status: 'Vorgestellt' },
  { id: uid('c'), kundeId: 'k6', datum: rel(-9), titel: 'Konzept Prozessdigitalisierung', version: 'v1.0', status: 'Angebot erstellt' },
  { id: uid('c'), kundeId: 'k7', datum: rel(-14), titel: 'Konzept Nachfolgeplanung', version: 'v2.0', status: 'Angenommen' },
]

export const seedVertraege: Beratungsvertrag[] = [
  { id: uid('v'), kundeId: 'k7', vertragsnr: 'BV-2026-044', datum: rel(-1), laufzeit: '12 Monate', volumen: 48000, datei: 'Beratungsvertrag_Amberger.pdf' },
  { id: uid('v'), kundeId: 'k8', vertragsnr: 'BV-2025-198', datum: rel(-30), laufzeit: '24 Monate', volumen: 96000, datei: 'Beratungsvertrag_Hoffmann.pdf' },
  { id: uid('v'), kundeId: 'k9', vertragsnr: 'BV-2025-176', datum: rel(-60), laufzeit: '6 Monate', volumen: 27000, datei: 'Beratungsvertrag_Seidel.pdf' },
  { id: uid('v'), kundeId: 'k10', vertragsnr: 'BV-2025-140', datum: rel(-90), laufzeit: '12 Monate', volumen: 42000, datei: 'Beratungsvertrag_BrandtMoeller.pdf' },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt inklusive Empfänger, Datum, Betreff und individueller Textbausteine.'

export const seedVorlagen: Vorlage[] = [
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Allgemeine Vertretungsvollmacht', typ: 'Vollmacht', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Vollmacht Steuerangelegenheiten', typ: 'Vollmacht', zuletztGeaendert: rel(-60), text: vorlageText },
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Bankvollmacht', typ: 'Vollmacht', zuletztGeaendert: rel(-14), text: vorlageText },
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Prozessvollmacht', typ: 'Vollmacht', zuletztGeaendert: rel(-90), text: vorlageText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Anschreiben Erstkontakt', typ: 'Schreiben', zuletztGeaendert: rel(-10), text: vorlageText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Terminbestätigung', typ: 'Schreiben', zuletztGeaendert: rel(-5), text: vorlageText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Nachfassschreiben Angebot', typ: 'Schreiben', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Abschlussschreiben Mandat', typ: 'Schreiben', zuletztGeaendert: rel(-40), text: vorlageText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Zwischenbericht Vorlage', typ: 'Schreiben', zuletztGeaendert: rel(-25), text: vorlageText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Beratungsvertrag Standard', typ: 'Vertrag', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Beratungsvertrag Projektbasis', typ: 'Vertrag', zuletztGeaendert: rel(-35), text: vorlageText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Geheimhaltungsvereinbarung (NDA)', typ: 'Vertrag', zuletztGeaendert: rel(-50), text: vorlageText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Rahmenvertrag Dauermandat', typ: 'Vertrag', zuletztGeaendert: rel(-70), text: vorlageText },
]
