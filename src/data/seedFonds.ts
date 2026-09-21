import type { FondsDokument, FondsInvestor } from '../types'
import { addDays, uid } from '../lib/dates'

// Referenzdatum der Demo (siehe seedBeratung.ts)
const REF = '2026-09-08'
const rel = (days: number) => addDays(REF, days)

export const seedFondsInvestoren: FondsInvestor[] = [
  {
    id: 'fi1',
    name: 'Dr. Michael Ostermann',
    email: 'michael.ostermann@web.de',
    telefon: '+49 731 55 12 887',
    seit: '2021-06-01',
    zeichnungen: [
      { id: uid('fz'), investorId: 'fi1', betrag: 500000, datum: '2021-06-01', laufzeitJahre: 10, status: 'Aktiv' },
    ],
    ausschuettungen: [
      { id: uid('fa'), investorId: 'fi1', datum: '2022-06-01', betrag: 10000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi1', datum: '2023-06-01', betrag: 15000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi1', datum: '2024-06-01', betrag: 17500, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi1', datum: '2025-06-01', betrag: 20000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi1', datum: '2026-06-01', betrag: 20000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi1', datum: '2027-06-01', betrag: 22500, turnus: 'Jährlich', status: 'Geplant' },
    ],
    dokumente: [
      { id: uid('fd'), investorId: 'fi1', name: 'Zeichnungsschein_Ostermann_2021.pdf', kategorie: 'Zeichnungsschein', datum: '2021-06-01', groesse: '412 KB' },
      { id: uid('fd'), investorId: 'fi1', name: 'Steuerbescheinigung_2025.pdf', kategorie: 'Steuerbescheinigung', datum: '2026-02-15', groesse: '188 KB' },
      { id: uid('fd'), investorId: 'fi1', name: 'Quartalsreport_2026_Q2.pdf', kategorie: 'Quartalsreport', datum: rel(-70), groesse: '1,1 MB' },
      { id: uid('fd'), investorId: 'fi1', name: 'Quartalsreport_2026_Q3.pdf', kategorie: 'Quartalsreport', datum: rel(-5), groesse: '1,2 MB' },
    ],
  },
  {
    id: 'fi2',
    name: 'Family Office Vogt-Lindner',
    email: 'kontakt@vogt-lindner-fo.de',
    telefon: '+49 89 45 67 210',
    seit: '2023-01-10',
    zeichnungen: [
      { id: uid('fz'), investorId: 'fi2', betrag: 1000000, datum: '2023-01-10', laufzeitJahre: 10, status: 'Aktiv' },
    ],
    ausschuettungen: [
      { id: uid('fa'), investorId: 'fi2', datum: '2024-01-10', betrag: 60000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi2', datum: '2025-01-10', betrag: 70000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi2', datum: '2026-01-10', betrag: 80000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi2', datum: '2027-01-10', betrag: 80000, turnus: 'Jährlich', status: 'Geplant' },
    ],
    dokumente: [
      { id: uid('fd'), investorId: 'fi2', name: 'Zeichnungsschein_VogtLindner_2023.pdf', kategorie: 'Zeichnungsschein', datum: '2023-01-10', groesse: '398 KB' },
      { id: uid('fd'), investorId: 'fi2', name: 'Steuerbescheinigung_2025.pdf', kategorie: 'Steuerbescheinigung', datum: '2026-02-15', groesse: '201 KB' },
      { id: uid('fd'), investorId: 'fi2', name: 'Quartalsreport_2026_Q3.pdf', kategorie: 'Quartalsreport', datum: rel(-5), groesse: '1,3 MB' },
    ],
  },
  {
    id: 'fi3',
    name: 'Rehnert Beteiligungs GmbH',
    email: 'j.rehnert@rehnert-beteiligungen.de',
    telefon: '+49 711 22 89 143',
    seit: '2024-03-15',
    zeichnungen: [
      { id: uid('fz'), investorId: 'fi3', betrag: 150000, datum: '2024-03-15', laufzeitJahre: 5, status: 'Aktiv' },
    ],
    ausschuettungen: [
      { id: uid('fa'), investorId: 'fi3', datum: '2025-03-15', betrag: 9000, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi3', datum: '2026-03-15', betrag: 10500, turnus: 'Jährlich', status: 'Ausgezahlt' },
      { id: uid('fa'), investorId: 'fi3', datum: '2027-03-15', betrag: 12000, turnus: 'Jährlich', status: 'Geplant' },
    ],
    dokumente: [
      { id: uid('fd'), investorId: 'fi3', name: 'Zeichnungsschein_Rehnert_2024.pdf', kategorie: 'Zeichnungsschein', datum: '2024-03-15', groesse: '405 KB' },
      { id: uid('fd'), investorId: 'fi3', name: 'Quartalsreport_2026_Q3.pdf', kategorie: 'Quartalsreport', datum: rel(-5), groesse: '1,1 MB' },
    ],
  },
  {
    id: 'fi4',
    name: 'Sabrina Kellermann',
    email: 'sabrina.kellermann@gmx.de',
    telefon: '+49 176 33 44 552',
    seit: '2026-02-01',
    zeichnungen: [
      { id: uid('fz'), investorId: 'fi4', betrag: 75000, datum: '2026-02-01', laufzeitJahre: 3, status: 'Kapital eingezahlt' },
    ],
    ausschuettungen: [
      { id: uid('fa'), investorId: 'fi4', datum: '2027-02-01', betrag: 3000, turnus: 'Jährlich', status: 'Geplant' },
    ],
    dokumente: [
      { id: uid('fd'), investorId: 'fi4', name: 'Zeichnungsschein_Kellermann_2026.pdf', kategorie: 'Zeichnungsschein', datum: '2026-02-01', groesse: '399 KB' },
      { id: uid('fd'), investorId: 'fi4', name: 'Quartalsreport_2026_Q3.pdf', kategorie: 'Quartalsreport', datum: rel(-5), groesse: '1,0 MB' },
    ],
  },
]

// Dokumente, die für alle Investoren sichtbar sind (kein investorId)
export const seedFondsDokumenteAllgemein: FondsDokument[] = [
  { id: uid('fd'), name: 'AMH_Investitionsfonds_2026_Prospekt.pdf', kategorie: 'Prospekt', datum: '2026-01-15', groesse: '2,4 MB' },
]
