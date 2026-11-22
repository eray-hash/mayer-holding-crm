// Prüft den Aufräum-Kern: Doppel (gleich/fast gleich, Zahlen trennen), alte und überfällige Aufgaben,
// „sieht erledigt aus“ (Marken, vergangene Termine, „vom …“ zählt nicht), abgeschlossene Akten, Vorrang der Arten,
// und was beim Anwenden geändert wird (weich erledigen mit Vermerk, verschieben, löschen nur auf Wunsch).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  aenderungenFuer,
  analysiereTodos,
  type AufraeumTodo,
  buendele,
  gruppenCode,
  letzteBewegung,
  naechsterWerktag,
  normalisiere,
  siehtErledigtAus,
  vergangenerTermin,
  zusammenfassen,
} from './todoAufraeumen.ts'

const HEUTE = '2026-11-22' // Sonntag

function t(id: string, aufgabe: string, mehr: Partial<AufraeumTodo> = {}): AufraeumTodo {
  return { id, aufgabe, besitzer_email: 'a@x.de', bereich: null, erstellt_am: '2026-11-20', ...mehr }
}

Deno.test('normalisiere: klein, ohne Umlaute/Satzzeichen, ohne AW:/WG:', () => {
  assertEquals(normalisiere('AW: WG: Größe prüfen!'), 'grosse prufen')
  assertEquals(normalisiere('  Rückruf   Müller  '), 'ruckruf muller')
})

Deno.test('naechsterWerktag springt über das Wochenende', () => {
  assertEquals(naechsterWerktag('2026-11-28'), '2026-11-30') // Samstag → Montag
  assertEquals(naechsterWerktag('2026-11-25'), '2026-11-25')
})

Deno.test('letzteBewegung: Microsoft-Aufgaben nach ms_geaendert, sonst erstellt/erhalten', () => {
  assertEquals(letzteBewegung(t('1', 'x', { ms_id: 'm1', ms_geaendert: '2021-03-04T10:00:00Z' })), '2021-03-04')
  assertEquals(letzteBewegung(t('2', 'x', { erstellt_am: '2026-01-01', erhalten_am: '2026-02-01' })), '2026-02-01')
})

Deno.test('vergangenerTermin: Termin/Frist mit Stichwort, nicht „vom“, nicht wiederkehrend', () => {
  assertEquals(vergangenerTermin('Bestätigung für Telefon-Termin am Freitag, den 31.01.2025', null, HEUTE), '2025-01-31')
  assertEquals(vergangenerTermin('Abwesenheit bis 08.04.2024', null, HEUTE), '2024-04-08')
  assertEquals(vergangenerTermin('Ihre Rechnung 2404462579 vom 20.04.2024, Kundennummer 24476307', null, HEUTE), null)
  assertEquals(vergangenerTermin('Einspruch, Ihr Schreiben vom 17.02.2026', null, HEUTE), null)
  assertEquals(vergangenerTermin('Offene Forderung AZ: S.20.2275919.01.3', null, HEUTE), null)
  assertEquals(vergangenerTermin('Jährlich: Wartung bis 01.03.2024', null, HEUTE), null)
  // Noch nicht 7 Tage vorbei
  assertEquals(vergangenerTermin('Termin am 20.11.2026', null, HEUTE), null)
  // Ohne Jahr: nur mit Stichwort, Jahr aus der letzten Bewegung
  assertEquals(vergangenerTermin('Treffen am 12.03.', '2023-03-01', HEUTE), '2023-03-12')
  assertEquals(vergangenerTermin('Ordner 12.03. sortieren', '2023-03-01', HEUTE), null)
  // Künftiger Termin
  assertEquals(vergangenerTermin('Seminar am 15.01.2027', null, HEUTE), null)
})

Deno.test('siehtErledigtAus: Marken am Anfang/Ende und im Stand, nicht mitten im Satz', () => {
  assert(siehtErledigtAus(t('1', 'Erledigt: Steuerunterlagen'), HEUTE))
  assert(siehtErledigtAus(t('2', 'Mietkautionsbürgschaft ✔'), HEUTE))
  assert(siehtErledigtAus(t('3', 'Unterlagen', { aktueller_stand: 'erledigt am Montag' }), HEUTE))
  assertEquals(siehtErledigtAus(t('4', '3 Dinge, die ich erledigt habe, auf die ich stolz bin'), HEUTE), null)
})

Deno.test('Doppel: gleicher und fast gleicher Text je Liste, Zahlen trennen, reichste bleibt', () => {
  const todos = [
    t('a1', 'Ihre Post vom 13.08.2026 — Caras Immobilien GmbH', { ms_id: 'm1', ms_liste_name: 'Gekennzeichnet' }),
    t('a2', 'Ihre Post vom 13.08.2026 – Caras Immobilien GmbH!', { ms_id: 'm2', ms_liste_name: 'Gekennzeichnet', erledigen_bis: '2026-12-01' }),
    // andere Liste: kein Doppel mit a1/a2
    t('a3', 'Ihre Post vom 13.08.2026 — Caras Immobilien GmbH', { ms_id: 'm3', ms_liste_name: 'Aufgaben' }),
    // fast gleich
    t('b1', 'Angebot für Dach Sanierung Haus Ulm prüfen', { erstellt_am: '2026-11-01' }),
    t('b2', 'Angebot Dach Sanierung Haus Ulm prüfen lassen', { erstellt_am: '2026-11-02' }),
    // gleiche Wörter, andere Zahlen → kein Doppel
    t('c1', 'Ihre Rechnung 2404462579 vom 20.04.2024, Kundennummer 24476307'),
    t('c2', 'Ihre Rechnung 2403464606 vom 20.03.2024, Kundennummer 24476307'),
  ]
  const v = analysiereTodos(todos, { heute: HEUTE }).filter((x) => x.art === 'doppelt')
  assertEquals(v.length, 2)
  const post = v.find((x) => x.todo_ids.includes('a1'))!
  assertEquals(post.behalten_id, 'a2') // hat eine Frist
  assertEquals(post.todo_ids.sort(), ['a1', 'a2'])
  assertEquals(post.vorschlag, 'zusammenfuehren')
  const dach = v.find((x) => x.todo_ids.includes('b1'))!
  assertEquals(dach.todo_ids.length, 2)
  assert(!v.some((x) => x.todo_ids.includes('c1')))
})

Deno.test('alt und überfällig: Grenzen, Prio A, künftige Erinnerung, Microsoft-Datum', () => {
  const todos = [
    t('alt1', 'Garage aufräumen', { ms_id: 'm1', ms_geaendert: '2022-05-01T00:00:00Z' }),
    t('jung', 'Neues Thema', { ms_id: 'm2', ms_geaendert: '2026-10-01T00:00:00Z' }),
    t('wichtig', 'Wichtig, alt', { ms_id: 'm3', ms_geaendert: '2022-05-01T00:00:00Z', prio: 'A' }),
    t('erinnert', 'Mit Erinnerung', { erstellt_am: '2024-01-01', erinnern_um: '2026-12-01T08:00:00Z' }),
    t('u1', 'Bericht schreiben', { erledigen_bis: '2026-11-01' }), // 21 Tage → verschieben
    t('u2', 'Steuer 2023', { erledigen_bis: '2025-01-10' }), // > 180 → erledigen
    t('u3', 'Knapp', { erledigen_bis: '2026-11-15' }), // 7 Tage → nichts
    t('fertig', 'Schon erledigt', { erledigt_am: '2026-11-01', erledigen_bis: '2024-01-01' }),
  ]
  const v = analysiereTodos(todos, { heute: HEUTE })
  const art = (id: string) => v.find((x) => x.todo_ids.includes(id))
  assertEquals(art('alt1')?.art, 'alt')
  assertEquals(art('jung'), undefined)
  assertEquals(art('wichtig'), undefined)
  assertEquals(art('erinnert'), undefined)
  assertEquals(art('u1')?.vorschlag, 'verschieben')
  assertEquals(art('u1')?.datum, '2026-11-30') // heute + 7 = Sonntag → Montag
  assertEquals(art('u2')?.vorschlag, 'erledigen')
  assertEquals(art('u3'), undefined)
  assertEquals(art('fertig'), undefined)
  // Schwelle 60 Tage
  assert(analysiereTodos([t('x', 'y', { ms_id: 'm', ms_geaendert: '2026-08-01T00:00:00Z' })], { heute: HEUTE, tageAlt: 60 }).length === 1)
})

Deno.test('Akte abgeschlossen nur bei eindeutigem Namen; Vorrang: erledigt-aussehend vor allem anderen', () => {
  const todos = [
    t('k1', 'Unterlagen nachreichen', { kunde_projekt: 'Muster GmbH', erledigen_bis: '2024-01-01' }),
    t('k2', 'Rückruf', { kunde_projekt: 'Doppelname AG' }),
    t('k3', 'Erledigt: Vertrag', { kunde_projekt: 'Muster GmbH' }),
  ]
  const akten = [
    { name: 'Muster GmbH', abgeschlossen: true },
    { name: 'Doppelname AG', abgeschlossen: true },
    { name: 'Doppelname AG', abgeschlossen: false },
  ]
  const v = analysiereTodos(todos, { heute: HEUTE, akten })
  assertEquals(v.find((x) => x.todo_ids.includes('k1'))?.art, 'akte_abgeschlossen')
  assertEquals(v.find((x) => x.todo_ids.includes('k2')), undefined)
  assertEquals(v.find((x) => x.todo_ids.includes('k3'))?.art, 'wohl_erledigt')
  // jede Aufgabe nur einmal
  const ids = v.flatMap((x) => x.todo_ids)
  assertEquals(ids.length, new Set(ids).size)
  assertEquals(zusammenfassen(v).map((z) => z.art), ['wohl_erledigt', 'akte_abgeschlossen'])
})

Deno.test('Anwenden: weich erledigen mit Vermerk, verschieben, zusammenführen, löschen nur auf Wunsch', () => {
  const todos = [
    t('a1', 'Post Caras', { aktueller_stand: 'Notiz A' }),
    t('a2', 'Post Caras', { erledigen_bis: '2026-12-01' }),
    t('u1', 'Bericht', { erledigen_bis: '2026-11-01' }),
    t('alt', 'Alt', { ms_id: 'm', ms_geaendert: '2020-01-01T00:00:00Z', aktueller_stand: 'Mailtext' }),
  ]
  const karte = new Map(todos.map((x) => [x.id, x]))
  const v = analysiereTodos(todos, { heute: HEUTE })
  const doppelt = v.find((x) => x.art === 'doppelt')!
  const zf = aenderungenFuer(doppelt, karte, { heute: HEUTE })
  assertEquals(zf.find((a) => a.id === 'a2')?.felder, { aktueller_stand: 'Notiz A' })
  assertEquals(zf.find((a) => a.id === 'a1')?.felder?.erledigt_am, HEUTE)
  assert(zf.find((a) => a.id === 'a1')?.felder?.aktueller_stand?.startsWith('Notiz A\naufgeräumt am 22.11.2026: doppelt'))
  // Löschen beim Doppel: behaltene bleibt
  const lo = aenderungenFuer(doppelt, karte, { heute: HEUTE, aktion: 'loeschen' })
  assertEquals(lo.filter((a) => a.loeschen).map((a) => a.id), ['a1'])

  const alt = v.find((x) => x.art === 'alt')!
  assertEquals(aenderungenFuer(alt, karte, { heute: HEUTE }), [{ id: 'alt', felder: { erledigt_am: HEUTE, aktueller_stand: 'Mailtext\naufgeräumt am 22.11.2026: lange unberührt' } }])
  assertEquals(aenderungenFuer(alt, karte, { heute: HEUTE, aktion: 'loeschen' }), [{ id: 'alt', loeschen: true }])

  const ueber = v.find((x) => x.art === 'ueberfaellig')!
  assertEquals(aenderungenFuer(ueber, karte, { heute: HEUTE }), [{ id: 'u1', felder: { erledigen_bis: '2026-11-30' } }])
  assertEquals(aenderungenFuer(ueber, karte, { heute: HEUTE, aktion: 'verschieben', datum: '2027-01-15' }), [{ id: 'u1', felder: { erledigen_bis: '2027-01-15' } }])

  // Schon erledigt → nichts
  const erledigt = new Map(karte)
  erledigt.set('u1', { ...karte.get('u1')!, erledigt_am: '2026-11-21' })
  assertEquals(aenderungenFuer(ueber, erledigt, { heute: HEUTE }), [])
})

Deno.test('buendele fasst gleiche Felder zusammen; gruppenCode hängt nur von der Menge ab', () => {
  const b = buendele([
    { id: '1', felder: { erledigt_am: HEUTE, aktueller_stand: 'x' } },
    { id: '2', felder: { aktueller_stand: 'x', erledigt_am: HEUTE } },
    { id: '3', felder: { erledigt_am: HEUTE, aktueller_stand: 'y' } },
    { id: '4', loeschen: true },
    { id: '4', loeschen: true },
  ])
  assertEquals(b.buendel.length, 2)
  assertEquals(b.buendel[0].ids, ['1', '2'])
  assertEquals(b.loeschen, ['4'])
  assertEquals(gruppenCode(['b', 'a']), gruppenCode(['a', 'b']))
  assert(gruppenCode(['a']) !== gruppenCode(['a', 'b']))
})

Deno.test('Geschwindigkeit: 2.000 Aufgaben in einer Liste in unter 3 Sekunden', () => {
  const viele: AufraeumTodo[] = []
  for (let i = 0; i < 2000; i++) viele.push(t(`t${i}`, `Aufgabe Nummer ${i % 700} zum Thema ${['Haus', 'Steuer', 'Auto', 'Bank'][i % 4]} erledigen bitte`, { ms_id: `m${i}`, ms_liste_name: 'L', ms_geaendert: '2023-01-01T00:00:00Z' }))
  const start = Date.now()
  analysiereTodos(viele, { heute: HEUTE })
  assert(Date.now() - start < 3000)
})
