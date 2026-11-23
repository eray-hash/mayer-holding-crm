// deno test src/lib/tests/zeilenSchreiben.test.ts
// Prüft das Speichern aus dem Browser (zeilenSchreiben.ts) mit einer Datenbank im Speicher:
// feldweise Änderungen, Zusammenführen frisch gelesener Listen, keine Wiederauferstehung anderswo gelöschter
// Zeilen, Nachholen nach Netzfehlern, Schutz vor Massenlöschung.
import {
  _zuruecksetzen,
  anzahlAusstehend,
  holeNach,
  istNetzFehler,
  loescheZeilen,
  merkeInDatenbank,
  schreibeSpaeter,
  schreibtGerade,
  setzeMelder,
  warteAufSchreibvorgaenge,
} from '../zeilenSchreiben.ts'
import { Datenbank, gleich, test, wahr } from './syncDoppel.ts'

let meldungen: string[] = []
function neu(): Datenbank {
  _zuruecksetzen()
  meldungen = []
  setzeMelder((art, tabelle) => meldungen.push(`${art}:${tabelle}`))
  return new Datenbank()
}

const todo = (felder: Record<string, unknown> = {}) => ({ id: 't1', aufgabe: 'Anrufen', prio: 'B', reihenfolge: 3, notiz: null, ...felder })

test('To-do: nur das geänderte Feld wird geschrieben — die Priorität vom Server bleibt', async () => {
  const db = neu()
  db.lege('todos', todo({ prio: 'A', reihenfolge: 1 })) // automatische Priorisierung auf dem Server
  merkeInDatenbank('todos', ['t1'])
  const ausgang = await schreibeSpaeter(db.client(), { tabelle: 'todos', id: 't1', kontext: 'Aufgabe' }, todo(), todo({ aufgabe: 'Anrufen (Rückruf)' }))
  gleich(ausgang, 'ok')
  gleich(db.zeile('todos', 't1'), todo({ prio: 'A', reihenfolge: 1, aufgabe: 'Anrufen (Rückruf)' }))
  gleich(db.aufrufe.map((a) => a.vorgang), ['update'])
})

test('Projekt: Meilensteine werden mit dem frischen Stand zusammengeführt (Kollege hat Aufgabe ergänzt)', async () => {
  const db = neu()
  const a1 = { id: 'a1', titel: 'Angebot', status: 'offen' }
  const vorher = { id: 'p1', name: 'Umbau', verknuepft_kunde_id: 'k-alt', meilensteine: [{ id: 'm1', titel: 'Start', aufgaben: [a1] }] }
  // In der Datenbank: Kollege hat a2 angelegt; Zusammenführen der Akten hat die Verknüpfung umgehängt
  db.lege('projekte', { ...vorher, verknuepft_kunde_id: 'k-neu', meilensteine: [{ id: 'm1', titel: 'Start', aufgaben: [a1, { id: 'a2', titel: 'Plan', status: 'offen' }] }] })
  merkeInDatenbank('projekte', ['p1'])
  const nachher = { ...vorher, meilensteine: [{ id: 'm1', titel: 'Start', aufgaben: [{ ...a1, status: 'erledigt' }] }] }
  gleich(await schreibeSpaeter(db.client(), { tabelle: 'projekte', id: 'p1', kontext: 'Projekt' }, vorher, nachher), 'ok')
  gleich(db.zeile('projekte', 'p1'), {
    id: 'p1',
    name: 'Umbau',
    verknuepft_kunde_id: 'k-neu',
    meilensteine: [{ id: 'm1', titel: 'Start', aufgaben: [{ ...a1, status: 'erledigt' }, { id: 'a2', titel: 'Plan', status: 'offen' }] }],
  })
})

test('Anderswo gelöscht: Änderung wird verworfen, die Zeile kommt nicht zurück', async () => {
  const db = neu()
  merkeInDatenbank('todos', ['t1']) // beim Laden gesehen, inzwischen per Telegram gelöscht
  const ausgang = await schreibeSpaeter(db.client(), { tabelle: 'todos', id: 't1', kontext: 'Aufgabe' }, todo(), todo({ prio: 'A' }))
  gleich(ausgang, 'verworfen')
  gleich(db.zeile('todos', 't1'), undefined)
  gleich(db.anzahl('upsert'), 0)
  gleich(meldungen, ['verworfen:todos'])
})

test('Nie angekommen (z. B. offline angelegt): wird beim nächsten Speichern vollständig nachgetragen', async () => {
  const db = neu()
  const ausgang = await schreibeSpaeter(db.client(), { tabelle: 'todos', id: 't1', kontext: 'Aufgabe' }, todo(), todo({ prio: 'A' }))
  gleich(ausgang, 'ok')
  gleich(db.zeile('todos', 't1'), todo({ prio: 'A' }))
})

test('Netzfehler: Änderung wird gemerkt und mit späteren Änderungen zusammen nachgeholt', async () => {
  const db = neu()
  db.lege('todos', todo())
  merkeInDatenbank('todos', ['t1'])
  let offline = true
  db.fehler = (v) => (offline && v !== 'select' ? 'TypeError: Failed to fetch' : null)
  const c = db.client()
  const auftrag = { tabelle: 'todos', id: 't1', kontext: 'Aufgabe' }
  gleich(await schreibeSpaeter(c, auftrag, todo(), todo({ prio: 'A' })), 'nachholen')
  wahr(schreibtGerade(), 'wartet aufs Nachholen')
  // Zweite Änderung, während noch offline: vorher (aus Sicht des Fensters) enthält schon prio A
  gleich(await schreibeSpaeter(c, auftrag, todo({ prio: 'A' }), todo({ prio: 'A', notiz: 'zurückrufen' })), 'nachholen')
  gleich(anzahlAusstehend(), 1)
  gleich(db.zeile('todos', 't1'), todo())
  offline = false
  gleich(await holeNach(), ['ok'])
  gleich(db.zeile('todos', 't1'), todo({ prio: 'A', notiz: 'zurückrufen' }), 'beide Änderungen angekommen')
  gleich(anzahlAusstehend(), 0)
  gleich(schreibtGerade(), false)
  gleich(meldungen, [], 'Netzfehler werden nicht als Fehler gemeldet')
})

test('Frischer Stand nicht lesbar: es wird nichts geschrieben (früher: ganze eigene Liste überschrieb fremde Einträge)', async () => {
  const db = neu()
  db.lege('rechnungen', { id: 'r1', zahlungen: [{ id: 'z-bank', betrag: 100 }] })
  merkeInDatenbank('rechnungen', ['r1'])
  db.fehler = (v) => (v === 'select' ? 'canceling statement due to statement timeout' : null)
  const ausgang = await schreibeSpaeter(db.client(), { tabelle: 'rechnungen', id: 'r1', kontext: 'Rechnung' }, { id: 'r1', zahlungen: [] }, { id: 'r1', zahlungen: [{ id: 'z-hand', betrag: 50 }] })
  gleich(ausgang, 'nachholen')
  gleich(db.anzahl('update'), 0)
  db.fehler = () => null
  await holeNach()
  gleich(db.zeile('rechnungen', 'r1'), { id: 'r1', zahlungen: [{ id: 'z-bank', betrag: 100 }, { id: 'z-hand', betrag: 50 }] })
})

test('Andere Datenbankfehler: gemeldet, nicht endlos nachgeholt', async () => {
  const db = neu()
  db.lege('notizen', { id: 'n1', text: 'a' })
  db.fehler = (v) => (v === 'update' ? 'new row violates row-level security policy' : null)
  gleich(await schreibeSpaeter(db.client(), { tabelle: 'notizen', id: 'n1', kontext: 'Notiz' }, { id: 'n1', text: 'a' }, { id: 'n1', text: 'b' }), 'fehler')
  gleich(anzahlAusstehend(), 0)
  gleich(meldungen, ['fehler:notizen'])
})

test('Tagesplan mit fester Kennung: vom Server angelegter Plan wird beim ersten Speichern zusammengeführt', async () => {
  const db = neu()
  const id = 'Quirin|2026-11-23'
  db.lege('abteilung_eintraege', { id, art: 'tagesplan', daten: { id, zeilen: [{ id: 's1', was: 'Telegram' }], anrufe: 'B.' }, updated_at: '1' })
  const nachher = { id, art: 'tagesplan', daten: { id, zeilen: [{ id: 'h1', was: 'Hand' }], anrufe: 'B.' }, updated_at: '2' }
  const auftrag = { tabelle: 'abteilung_eintraege', id, kontext: 'Tagesablauf', festeIds: true, objektFelder: ['daten'] }
  gleich(await schreibeSpaeter(db.client(), auftrag, undefined, nachher), 'ok')
  gleich(db.zeile('abteilung_eintraege', id)?.daten, { id, zeilen: [{ id: 's1', was: 'Telegram' }, { id: 'h1', was: 'Hand' }], anrufe: 'B.' })
  // Ein neuer Zeiteintrag (noch nicht in der Datenbank) wird ganz angelegt
  const z = { id: 'zeit1', art: 'zeit', daten: { id: 'zeit1', minuten: 30 }, updated_at: '3' }
  gleich(await schreibeSpaeter(db.client(), { ...auftrag, id: 'zeit1' }, undefined, z), 'ok')
  gleich(db.zeile('abteilung_eintraege', 'zeit1'), z)
})

test('Frage an die GF: Antwort vom Server bleibt, wenn das Fenster die Frage bearbeitet', async () => {
  const db = neu()
  const vorher = { id: 'f1', art: 'frage', daten: { id: 'f1', frage: 'Preis?', prio: 'B' }, updated_at: '1' }
  db.lege('abteilung_eintraege', { ...vorher, daten: { ...vorher.daten, antwort: 'Ja', beantwortetVon: 'GF' } })
  merkeInDatenbank('abteilung_eintraege', ['f1'])
  const nachher = { ...vorher, daten: { id: 'f1', frage: 'Preis? (genauer)', prio: 'A' }, updated_at: '2' }
  await schreibeSpaeter(db.client(), { tabelle: 'abteilung_eintraege', id: 'f1', kontext: 'Frage', festeIds: true, objektFelder: ['daten'] }, vorher, nachher)
  gleich(db.zeile('abteilung_eintraege', 'f1')?.daten, { id: 'f1', frage: 'Preis? (genauer)', prio: 'A', antwort: 'Ja', beantwortetVon: 'GF' })
})

test('Schnell hintereinander: Anlegen und Ändern laufen in der Reihenfolge, die Änderung geht nicht verloren', async () => {
  const db = neu()
  const c = db.client()
  const auftrag = { tabelle: 'notizen', id: 'n1', kontext: 'Notiz' }
  const a = schreibeSpaeter(c, auftrag, undefined, { id: 'n1', text: 'a', erledigt: false })
  const b = schreibeSpaeter(c, auftrag, { id: 'n1', text: 'a', erledigt: false }, { id: 'n1', text: 'a', erledigt: true })
  gleich(await Promise.all([a, b]), ['ok', 'ok'])
  gleich(db.zeile('notizen', 'n1'), { id: 'n1', text: 'a', erledigt: true })
  gleich(db.aufrufe.map((x) => x.vorgang), ['upsert', 'update'])
})

test('Löschen: mehr als drei Zeilen auf einmal wird gesperrt (z. B. „Daten zurücksetzen“)', async () => {
  const db = neu()
  for (const id of ['k1', 'k2', 'k3', 'k4']) db.lege('kunden', { id })
  gleich(await loescheZeilen(db.client(), 'kunden', ['k1', 'k2', 'k3', 'k4'], 'Kunde'), 'fehler')
  gleich(db.tabelle('kunden').size, 4)
  gleich(meldungen, ['loeschen_gesperrt:kunden'])
  gleich(await loescheZeilen(db.client(), 'kunden', ['k1'], 'Kunde'), 'ok')
  gleich(db.tabelle('kunden').size, 3)
})

test('Löschen am Netz gescheitert: wird nachgeholt (sonst käme die Zeile beim nächsten Laden zurück)', async () => {
  const db = neu()
  db.lege('todos', todo())
  db.fehler = (v) => (v === 'delete' ? 'Load failed' : null)
  gleich(await loescheZeilen(db.client(), 'todos', ['t1'], 'Aufgabe'), 'nachholen')
  wahr(schreibtGerade())
  db.fehler = () => null
  await holeNach()
  gleich(db.zeile('todos', 't1'), undefined)
  gleich(schreibtGerade(), false)
})

test('Gelöscht, während das Anlegen noch aufs Nachholen wartete: wird nicht wieder angelegt', async () => {
  const db = neu()
  db.fehler = (v) => (v === 'upsert' ? 'Failed to fetch' : null)
  const c = db.client()
  gleich(await schreibeSpaeter(c, { tabelle: 'notizen', id: 'n1', kontext: 'Notiz' }, undefined, { id: 'n1', text: 'a' }), 'nachholen')
  db.fehler = () => null
  await loescheZeilen(c, 'notizen', ['n1'], 'Notiz')
  await holeNach()
  gleich(db.zeile('notizen', 'n1'), undefined)
  gleich(db.anzahl('upsert'), 1)
})

test('Warten aufs Speichern vor dem Neuladen', async () => {
  const db = neu()
  const p = schreibeSpaeter(db.client(), { tabelle: 'notizen', id: 'n1', kontext: 'Notiz' }, undefined, { id: 'n1', text: 'a' })
  await warteAufSchreibvorgaenge(1000)
  gleich(db.zeile('notizen', 'n1'), { id: 'n1', text: 'a' })
  await p
})

test('Netzfehler erkennen', () => {
  wahr(istNetzFehler({ message: 'TypeError: Failed to fetch' }))
  wahr(istNetzFehler(new TypeError('Load failed')))
  wahr(istNetzFehler({ message: 'JWT expired' }))
  gleich(istNetzFehler({ message: 'duplicate key value violates unique constraint' }), false)
})
