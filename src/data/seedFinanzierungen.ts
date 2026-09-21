import type { Kunde, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-21'
const rel = (days: number) => addDays(REF, days)

// Interne Vertriebs-/Beratungspipeline für die Vermögensanlage "Ulmer Cash" (AMH Fonds) —
// Gegenstück zum kundenseitigen Investoren-Portal (seedFonds.ts): hier laufen Interessenten,
// bevor sie als gezeichnete Investoren im Portal auftauchen.
export const seedFinanzierungenMandanten: Kunde[] = [
  {
    id: 'fi_l1',
    firma: 'Wolfgang Herrmann',
    ansprechpartner: 'Wolfgang Herrmann',
    email: 'w.herrmann@web.de',
    telefon: '+49 731 66 90 214',
    prioritaet: 'Hoch',
    status: 'zeichnung_eingegangen',
    followUp: { date: rel(-1), note: 'Zahlungseingang Kapital prüfen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-18), text: 'Beratungsgespräch geführt, Beratungsprotokoll erstellt', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-4), text: 'Zeichnungsschein "Ulmer Cash" (100.000 €, 10 Jahre) eingegangen', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'fi_l2',
    firma: 'Andrea Schmidtke',
    ansprechpartner: 'Andrea Schmidtke',
    email: 'a.schmidtke@gmx.de',
    telefon: '+49 176 44 20 887',
    prioritaet: 'Mittel',
    status: 'beratungsgespraech',
    followUp: { date: rel(2), note: 'Beratungsprotokoll gegenzeichnen lassen', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-2),
    activities: [
      { id: uid('act'), date: rel(-9), text: 'Risikoprofil/Geeignetheitsprüfung durchgeführt', user: 'Andreas Mayer' },
      { id: uid('act'), date: rel(-2), text: 'Beratungsgespräch zur Vermögensanlage "Ulmer Cash" geführt', user: 'Andreas Mayer' },
    ],
  },
  {
    id: 'fi_l3',
    firma: 'Peter Konrad',
    ansprechpartner: 'Peter Konrad',
    email: 'p.konrad@t-online.de',
    telefon: '+49 731 30 55 671',
    prioritaet: 'Mittel',
    status: 'risikoprofil_erstellt',
    followUp: { date: rel(5), note: 'Termin für Beratungsgespräch vereinbaren', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-3), text: 'Risikoprofilbogen ausgefüllt zurückerhalten', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'fi_l4',
    firma: 'Ute Brandenburg',
    ansprechpartner: 'Ute Brandenburg',
    email: 'u.brandenburg@web.de',
    telefon: '+49 176 60 33 129',
    prioritaet: 'Niedrig',
    status: 'interessent',
    followUp: { date: rel(7), note: 'Prospekt und VIB zusenden', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-1),
    activities: [{ id: uid('act'), date: rel(-1), text: 'Anfrage über Website eingegangen', user: 'System' }],
  },
  {
    id: 'fi_l5',
    firma: 'Rainer Häussler',
    ansprechpartner: 'Rainer Häussler',
    email: 'r.haeussler@gmx.de',
    telefon: '+49 731 88 21 405',
    prioritaet: 'Niedrig',
    status: 'verloren',
    followUp: { date: rel(-15), note: 'Absage — Anlagehorizont zu lang', done: true },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-15),
    activities: [
      { id: uid('act'), date: rel(-15), text: 'Status: Beratungsgespräch geführt (Beratungsprotokoll) → Verloren am ' + rel(-15) + ' durch Andreas Mayer', user: 'Andreas Mayer' },
    ],
  },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt zur Vermögensanlage "Ulmer Cash" (AMH Fonds).'

export const seedVorlagenFinanzierungen: Vorlage[] = [
  { id: uid('vlz'), kategorie: 'vollmacht', name: 'Vollmacht Dateneinsicht Zeichnungsunterlagen', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vlz'), kategorie: 'schreiben', name: 'Anschreiben Erstkontakt Vermögensanlage', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlz'), kategorie: 'schreiben', name: 'Risikoprofilbogen / Geeignetheitsprüfung', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlz'), kategorie: 'schreiben', name: 'Beratungsprotokoll (Muster)', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlz'), kategorie: 'schreiben', name: 'Widerrufsbelehrung Vermögensanlage', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vlz'), kategorie: 'vertraege', name: 'Zeichnungsschein "Ulmer Cash" (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlz'), kategorie: 'vertraege', name: 'Vermögensanlagen-Informationsblatt (VIB)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
  { id: uid('vlz'), kategorie: 'vertraege', name: 'Verkaufsprospekt "Ulmer Cash" (Referenz)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
]
