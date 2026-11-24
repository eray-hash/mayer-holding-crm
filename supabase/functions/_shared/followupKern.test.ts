// Nächste Follow-up-Schritte aus Regeln und Daten (followupKern.ts): Vorschau direkt nach dem Erstellen, nach dem
// Versand, Mahnstufen nach mahn_einstellung, offene Wiedervorlagen, Follow-up der Akte. Kein Netz.
//
//   npx -y deno test _shared/followupKern.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { berechneFolgeSchritte, type FolgeDaten, type FolgeRechnung, folgeText } from './followupKern.ts'
import { STANDARD_EINSTELLUNG } from './mahnVorschlagKern.ts'

const HEUTE = '2026-11-24'
const rechnung = (z: Partial<FolgeRechnung> = {}): FolgeRechnung => ({
  id: 'r_1', nummer: 'LSA-001', status: 'Entwurf', datum: HEUTE, zahlungsziel: '2026-12-08', mahnstufe: null, betrag_brutto: 5950, zahlungen: null, mahnungen: null, ...z,
})
const daten = (z: Partial<FolgeDaten> = {}): FolgeDaten => ({
  heute: HEUTE,
  rechnungen: [rechnung()],
  rechnungsRegeln: [{ id: 'allg_geldeingang', titel: 'Geldeingang prüfen', tage: 0, aktiv: true, bereich: null }],
  wiedervorlagen: [],
  followUp: null,
  mahn: STANDARD_EINSTELLUNG,
  mahnVorschlaege: [],
  unterlagen: null,
  ...z,
})

Deno.test('Direkt nach dem Erstellen (Versand heute angenommen): Senden, Zahlungsziel + Wiedervorlage, Erinnerung, Mahnungen', () => {
  const e = berechneFolgeSchritte(daten(), { versandHeute: 'r_1' })
  assertEquals(e.schritte.map((s) => s.datum), ['2026-11-24', '2026-12-08', '2026-12-08', '2026-12-11', '2026-12-22', '2027-01-05'])
  assertStringIncludes(e.schritte[2].text, 'Geldeingang prüfen')
  assertStringIncludes(e.schritte[3].text, 'Zahlungserinnerung')
  assertStringIncludes(e.schritte[4].text, '1. Mahnung')
  assertStringIncludes(e.schritte[5].text, '2. Mahnung')
  const t = folgeText(e, HEUTE)
  assertStringIncludes(t, '- 24.11. (heute) Rechnung LSA-001 an den Kunden senden')
  assertStringIncludes(t, '- 08.12. Zahlungsziel Rechnung LSA-001: 5.950,00 € offen; Wiedervorlage „Geldeingang prüfen“')
  assertStringIncludes(t, '- 05.01.2027 2. Mahnung')
})

Deno.test('Entwurf ohne Versand-Vorschau: nur „versenden“', () => {
  const e = berechneFolgeSchritte(daten())
  assertEquals(e.schritte.length, 1)
  assertStringIncludes(e.schritte[0].text, 'versenden (noch Entwurf')
})

Deno.test('Nach dem Versand: echte Wiedervorlage aus der Tabelle, keine vorausgesagte doppelt', () => {
  const e = berechneFolgeSchritte(daten({ rechnungen: [rechnung({ status: 'Versendet' })], wiedervorlagen: [{ titel: 'Geldeingang prüfen', faellig: '2026-12-08', regel: 'allg_geldeingang', quelle: 'regel' }] }))
  assertEquals(e.schritte.filter((s) => s.text.includes('Geldeingang')).length, 1)
  assertStringIncludes(folgeText(e, HEUTE), 'Wiedervorlage: Geldeingang prüfen (automatisch)')
})

Deno.test('Schon offene Geldeingang-Wiedervorlage: Hinweis statt zweiter', () => {
  const e = berechneFolgeSchritte(daten({ wiedervorlagen: [{ titel: 'Geldeingang prüfen', faellig: '2026-11-30', regel: 'allg_geldeingang', quelle: 'regel' }] }), { versandHeute: 'r_1' })
  assert(e.hinweise.some((h) => h.includes('schon offen')))
})

Deno.test('Mahnstufen: eingestellte Tage, nach Erinnerung frühestens nach deren Frist, offener Vorschlag, ausgeschaltet', () => {
  // Erinnerung am 01.12. mit neuer Frist 08.12. → 1. Mahnung frühestens 09.12. bzw. Ziel + 14.
  const r = rechnung({ status: 'Überfällig', zahlungsziel: '2026-11-20', mahnstufe: 'erinnerung', mahnungen: [{ datum: '2026-11-23', stufe: 'erinnerung', neueFrist: '2026-11-30' }] })
  const e = berechneFolgeSchritte(daten({ rechnungen: [r], rechnungsRegeln: [] }))
  const m1 = e.schritte.find((s) => s.text.includes('1. Mahnung'))!
  assertEquals(m1.datum, '2026-12-04') // max(20.11.+14, 30.11.+1)
  const offen = berechneFolgeSchritte(daten({ rechnungen: [rechnung({ status: 'Versendet', zahlungsziel: '2026-11-10' })], mahnVorschlaege: [{ rechnung_id: 'r_1', stufe: 'erinnerung', status: 'offen', zurueckgestellt_bis: null }], rechnungsRegeln: [] }))
  assertStringIncludes(offen.schritte.find((s) => s.text.includes('Zahlungserinnerung'))!.text, 'liegt als Vorschlag bereit')
  assertStringIncludes(folgeText(offen, HEUTE), '(überfällig) Zahlungsziel')
  const aus = berechneFolgeSchritte(daten({ mahn: { ...STANDARD_EINSTELLUNG, aktiv: false } }), { versandHeute: 'r_1' })
  assert(!aus.schritte.some((s) => s.text.includes('Mahnung')))
  assert(aus.hinweise.some((h) => h.includes('ausgeschaltet')))
})

Deno.test('Bezahlt zählt nicht; Wiedervorlagen, Follow-up und Unterlagen der Akte', () => {
  const e = berechneFolgeSchritte(daten({
    rechnungen: [rechnung({ status: 'Bezahlt' })],
    wiedervorlagen: [{ titel: 'Erstgespräch vereinbaren', faellig: '2026-11-24', regel: 'x', quelle: 'regel' }],
    followUp: { date: '2026-11-26', note: 'Erstkontakt aufnehmen', done: false },
    unterlagen: { angefordert: 5, da: 3 },
  }))
  assertEquals(e.schritte.map((s) => s.datum), ['2026-11-24', '2026-11-26'])
  assertStringIncludes(folgeText(e, HEUTE), 'Hinweis: 2 von 5 angeforderten Unterlagen fehlen noch.')
  assertEquals(folgeText({ schritte: [], hinweise: [] }, HEUTE), 'Keine offenen Follow-up-Schritte in dieser Akte.')
})
