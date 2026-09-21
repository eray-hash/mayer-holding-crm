import type { Kunde, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-21'
const rel = (days: number) => addDays(REF, days)

export const seedAkademieTeilnehmer: Kunde[] = [
  {
    id: 'a1',
    firma: 'Sabine Kürner',
    ansprechpartner: 'Sabine Kürner',
    email: 's.kuerner@web.de',
    telefon: '+49 731 44 12 908',
    prioritaet: 'Mittel',
    status: 'kurs_laeuft',
    followUp: { date: rel(2), note: 'Zwischenfeedback nach Modul 2 einholen', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-5),
    activities: [
      { id: uid('act'), date: rel(-20), text: 'Kursplatz "Nachfolge-Planung Grundlagenseminar" bestätigt', user: 'Julia Hartmann' },
      { id: uid('act'), date: rel(-5), text: 'Modul 1 abgeschlossen', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'a2',
    firma: 'Deniz Aydın',
    ansprechpartner: 'Deniz Aydın',
    email: 'd.aydin@gmx.de',
    telefon: '+49 176 55 20 634',
    prioritaet: 'Niedrig',
    status: 'platz_bestaetigt',
    followUp: { date: rel(6), note: 'Terminbestätigung Kursstart zusenden', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-3), text: 'Anmeldung "Praxisseminar Rechtsformwahl" bestätigt', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'a3',
    firma: 'Holger Maucher',
    ansprechpartner: 'Holger Maucher',
    email: 'h.maucher@t-online.de',
    telefon: '+49 731 77 45 112',
    prioritaet: 'Mittel',
    status: 'anmeldung_eingegangen',
    followUp: { date: rel(3), note: 'Rechnung zusenden, Platz freigeben', done: false },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-1),
    activities: [{ id: uid('act'), date: rel(-1), text: 'Anmeldung online eingegangen', user: 'System' }],
  },
  {
    id: 'a4',
    firma: 'Nicole Frey',
    ansprechpartner: 'Nicole Frey',
    email: 'n.frey@gmail.com',
    telefon: '+49 176 90 11 224',
    prioritaet: 'Niedrig',
    status: 'interessent',
    followUp: { date: rel(9), note: 'Infomaterial zum nächsten Kurstermin zusenden', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-2),
    activities: [{ id: uid('act'), date: rel(-2), text: 'Anfrage über Website eingegangen', user: 'System' }],
  },
  {
    id: 'a5',
    firma: 'Robert Kienzle',
    ansprechpartner: 'Robert Kienzle',
    email: 'r.kienzle@web.de',
    telefon: '+49 731 12 88 456',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-30), note: 'Zertifikat "Nachfolge-Planung Grundlagenseminar" ausgestellt', done: true },
    verantwortlich: 'Andreas Mayer',
    letzteAktivitaet: rel(-28),
    activities: [
      { id: uid('act'), date: rel(-28), text: 'Status: Kurs läuft → Abgeschlossen / Zertifikat ausgestellt am ' + rel(-28) + ' durch Andreas Mayer', user: 'Andreas Mayer' },
    ],
  },
]

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt für den jeweiligen Akademie-Kurs.'

export const seedVorlagenAkademie: Vorlage[] = [
  { id: uid('vla'), kategorie: 'vollmacht', name: 'Einverständniserklärung Bild-/Tonaufnahmen (Kurs)', typ: 'Vollmacht', zuletztGeaendert: rel(-20), text: vorlageText },
  { id: uid('vla'), kategorie: 'schreiben', name: 'Anschreiben Kursbestätigung', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vla'), kategorie: 'schreiben', name: 'Teilnahmebestätigung / Zertifikat-Vorlage', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vla'), kategorie: 'schreiben', name: 'Feedbackbogen Kursabschluss', typ: 'Schreiben', zuletztGeaendert: rel(-15), text: vorlageText },
  { id: uid('vla'), kategorie: 'vertraege', name: 'Kursvertrag / AGB Akademie (Muster)', typ: 'Vertrag', zuletztGeaendert: rel(-30), text: vorlageText },
]
