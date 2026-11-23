// deno test src/lib/tests/syncZusammenfuehren.test.ts
// Prüft die Dreiwege-Zusammenführung, mit der seit 23.11.2026 alle übrigen Tabellen speichern (Projekte mit
// Meilensteinen/Aufgaben, Tagespläne, Rechnungs-Zahlungen …), und dass die Kundenakten-Logik unverändert ist.
import { dreiWegeListe, dreiWegeObjekt, fuehreListeZusammen } from '../syncZusammenfuehren.ts'
import { gleich, test } from './syncDoppel.ts'

const ids = (l: { id: string }[]) => l.map((x) => x.id)

test('Liste: ohne Änderung in der Datenbank kommt genau der Stand des Fensters heraus', () => {
  const vorher = [{ id: 'a', t: 1 }, { id: 'b', t: 1 }, { id: 'c', t: 1 }]
  const nachher = [{ id: 'c', t: 1 }, { id: 'a', t: 2 }, { id: 'd', t: 1 }]
  gleich(dreiWegeListe(vorher, nachher, vorher), nachher)
})

test('Liste: fremde neue Einträge bleiben an ihrer Stelle aus der Datenbank (Tagesplan-Blöcke)', () => {
  const vorher = [{ id: 'z1', block: 'A' }, { id: 'z2', block: 'B' }]
  // Telegram hat zwischen z1 und z2 eine Zeile eingefügt und ganz vorne eine Frist
  const server = [{ id: 'f', block: 'frist' }, { id: 'z1', block: 'A' }, { id: 't', block: 'A' }, { id: 'z2', block: 'B' }]
  // Fenster hakt z2 ab
  const nachher = [{ id: 'z1', block: 'A' }, { id: 'z2', block: 'B', erledigt: true }]
  const r = dreiWegeListe(vorher, nachher, server)
  gleich(ids(r), ['f', 'z1', 't', 'z2'])
  gleich(r[3], { id: 'z2', block: 'B', erledigt: true })
})

test('Liste: hier unverändert und anderswo gelöscht → weg; hier gelöscht → weg; anderswo geändert → Fassung der Datenbank', () => {
  const vorher = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }]
  const server = [{ id: 'b', v: 9 }, { id: 'c', v: 1 }]
  const nachher = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }]
  gleich(dreiWegeListe(vorher, nachher, server), [{ id: 'b', v: 9 }])
})

test('Liste: hier geänderter Eintrag — nur die eigenen Felder, Listen darin werden zusammengeführt (Meilenstein/Aufgaben)', () => {
  const a1 = { id: 'a1', titel: 'Angebot', status: 'offen' }
  const a2 = { id: 'a2', titel: 'Vertrag', status: 'offen' }
  const vorher = [{ id: 'm1', titel: 'Start', eta: null, aufgaben: [a1, a2] }]
  // Kollege: Aufgabe a2 erledigt, neue Aufgabe a3, Meilenstein-Termin gesetzt
  const server = [{ id: 'm1', titel: 'Start', eta: '2026-12-01', aufgaben: [a1, { ...a2, status: 'erledigt' }, { id: 'a3', titel: 'Rechnung', status: 'offen' }] }]
  // Dieses Fenster: Aufgabe a1 in Arbeit
  const nachher = [{ id: 'm1', titel: 'Start', eta: null, aufgaben: [{ ...a1, status: 'in_arbeit' }, a2] }]
  gleich(dreiWegeListe(vorher, nachher, server), [
    { id: 'm1', titel: 'Start', eta: '2026-12-01', aufgaben: [{ ...a1, status: 'in_arbeit' }, { ...a2, status: 'erledigt' }, { id: 'a3', titel: 'Rechnung', status: 'offen' }] },
  ])
})

test('Liste: hier geänderter Eintrag, den es in der Datenbank nicht mehr gibt, bleibt (eigene Änderung gilt)', () => {
  const hier = [{ id: 'x', v: 2 }]
  const alt = [{ id: 'x', v: 1 }]
  gleich(dreiWegeListe(alt, hier, []), [{ id: 'x', v: 2 }])
})

test('Objekt: Tagesplan, den der Server inzwischen angelegt hat, wird beim ersten Speichern nicht überschrieben', () => {
  const server = { id: 'Quirin|2026-11-23', zeilen: [{ id: 's1', was: 'Morgens per Telegram' }], anrufe: 'Herr B.', vorgeschlagenAm: '07:00' }
  const nachher = { id: 'Quirin|2026-11-23', zeilen: [{ id: 'h1', was: 'Von Hand eingeplant' }], anrufe: '', aktualisiertAm: 'x' }
  gleich(dreiWegeObjekt(undefined, nachher, server), {
    id: 'Quirin|2026-11-23',
    zeilen: [{ id: 's1', was: 'Morgens per Telegram' }, { id: 'h1', was: 'Von Hand eingeplant' }],
    anrufe: '',
    vorgeschlagenAm: '07:00',
    aktualisiertAm: 'x',
  })
})

test('Objekt: nur geänderte Felder; entfernte Felder fallen weg; verschachtelte Objekte als Ganzes', () => {
  const vorher = { frage: 'Preis?', prio: 'B', ort: 'Ulm', beleg: { pfad: 'a', groesse: 1 } }
  const server = { frage: 'Preis?', prio: 'B', ort: 'Ulm', antwort: 'Ja', beantwortetVon: 'GF', beleg: { pfad: 'a', groesse: 1, seiten: 3 } }
  const nachher = { frage: 'Preis? (neu)', prio: 'B', beleg: { pfad: 'b', groesse: 2 } }
  gleich(dreiWegeObjekt(vorher, nachher, server), { frage: 'Preis? (neu)', prio: 'B', antwort: 'Ja', beantwortetVon: 'GF', beleg: { pfad: 'b', groesse: 2 } })
})

test('Kundenakten-Zusammenführung unverändert: fremde neue oben, Rückmeldung neu/weg/frisch', () => {
  const vorher = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }]
  const server = [{ id: 'n', v: 1 }, { id: 'a', v: 2 }]
  const nachher = [{ id: 'x', v: 1 }, { id: 'a', v: 1 }, { id: 'b', v: 1 }]
  const r = fuehreListeZusammen(vorher, nachher, server)
  gleich(ids(r.liste), ['x', 'n', 'a'])
  gleich(r.weg, ['b'])
  gleich(r.frisch, [{ id: 'a', v: 2 }])
  gleich(ids(r.neu), ['n'])
})
