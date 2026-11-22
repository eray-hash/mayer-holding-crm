import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { aendereStand, datensicherungAktion, erstelleSicherung, imNachtfenster, leseStand, listeSicherungen, pruefeNaechtlicheSicherung, STAND_ID, type DateiZeile, type TabellenInfo } from './datensicherung.ts'
import { akteSpalte, isoWoche, lesePaket, sicherungsName, stabil, vergleiche, zuBehalten, SICHERUNG_EIMER, type Zeile } from '../_shared/sicherungKern.ts'
import { TEST_DIENST_SCHLUESSEL } from '../_shared/testDoppel.ts'

// ---------------------------------------------------------------------------------------------
// Testdatenbank: gibt wie PostgREST höchstens 1000 Zeilen je Abfrage zurück (beweist das Blättern),
// kennt die beiden Datenbankfunktionen der Sicherung und einen Speicher-Eimer.
// ---------------------------------------------------------------------------------------------

const HOECHSTENS = 1000

function wert(z: Zeile, spalte: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(spalte)
  if (m) {
    const o = z[m[1]] as Zeile | null
    return o && typeof o === 'object' ? (o[m[2]] === undefined || o[m[2]] === null ? null : String(o[m[2]])) : null
  }
  return z[spalte]
}

function vgl(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

class Abfrage {
  private filter: ((z: Zeile) => boolean)[] = []
  private sortierung: string[] = []
  private grenze = Infinity
  private von = 0
  private art: 'select' | 'insert' | 'update' = 'select'
  private nutzlast: Zeile | null = null
  private einzel = false
  private rueckgabe = false
  constructor(private db: TestDb, private tabelle: string) {}
  select(_s = '*') {
    if (this.art !== 'select') this.rueckgabe = true
    return this
  }
  insert(z: Zeile) {
    this.art = 'insert'
    this.nutzlast = z
    return this
  }
  update(z: Zeile) {
    this.art = 'update'
    this.nutzlast = z
    return this
  }
  eq(s: string, w: unknown) {
    this.filter.push((z) => wert(z, s) !== null && wert(z, s) !== undefined && String(wert(z, s)) === String(w))
    return this
  }
  ilike(s: string, w: string) {
    const muster = w.replace(/\\(.)/g, '$1').toLowerCase()
    this.filter.push((z) => String(z[s] ?? '').toLowerCase() === muster)
    return this
  }
  gt(s: string, w: unknown) {
    this.filter.push((z) => vgl(z[s], w) > 0)
    return this
  }
  gte(s: string, w: unknown) {
    this.filter.push((z) => vgl(z[s], w) >= 0)
    return this
  }
  order(s: string) {
    this.sortierung.push(s)
    return this
  }
  limit(n: number) {
    this.grenze = n
    return this
  }
  range(a: number, b: number) {
    this.von = a
    this.grenze = b - a + 1
    return this
  }
  maybeSingle() {
    this.einzel = true
    return this
  }
  then<A>(ok: (e: { data: unknown; error: { message: string } | null }) => A) {
    return Promise.resolve(this.fuehreAus()).then(ok)
  }
  private fuehreAus(): { data: unknown; error: { message: string } | null } {
    if (this.db.kaputt.has(this.tabelle)) return { data: null, error: { message: `Verbindung zu ${this.tabelle} abgebrochen` } }
    const tab = (this.db.t[this.tabelle] ??= [])
    this.db.abfragen.push(`${this.art}:${this.tabelle}`)
    if (this.art === 'insert') {
      if (tab.some((z) => z.id === this.nutzlast!.id)) return { data: null, error: { message: 'doppelt' } }
      tab.push(structuredClone(this.nutzlast!))
      return { data: null, error: null }
    }
    const passend = tab.filter((z) => this.filter.every((f) => f(z)))
    if (this.art === 'update') {
      for (const z of passend) Object.assign(z, structuredClone(this.nutzlast!))
      return { data: this.rueckgabe ? passend.map((z) => ({ id: z.id })) : null, error: null }
    }
    let aus = [...passend]
    for (const s of [...this.sortierung].reverse()) aus.sort((a, b) => vgl(a[s], b[s]))
    aus = aus.slice(this.von, this.von + Math.min(this.grenze, HOECHSTENS)).map((z) => structuredClone(z))
    if (this.einzel) return { data: aus[0] ?? null, error: null }
    return { data: aus, error: null }
  }
}

class TestDb {
  t: Record<string, Zeile[]>
  abfragen: string[] = []
  kaputt = new Set<string>()
  eimer = new Map<string, { bytes: Uint8Array; typ: string; erstellt: string }>()
  infos: TabellenInfo[]
  dateien: DateiZeile[]
  constructor(t: Record<string, Zeile[]>, infos: TabellenInfo[], dateien: DateiZeile[] = []) {
    this.t = t
    this.infos = infos
    this.dateien = dateien
  }
  from(t: string) {
    return new Abfrage(this, t)
  }
  rpc(name: string, a: Record<string, unknown> = {}) {
    this.abfragen.push(`rpc:${name}`)
    if (name === 'sicherung_tabellen') return Promise.resolve({ data: structuredClone(this.infos), error: null })
    if (name === 'sicherung_dateiliste') {
      const nach = a.p_nach as string | null
      const grenze = Math.min(Number(a.p_grenze ?? 1000), 1000)
      const liste = [...this.dateien].sort((x, y) => vgl(x.id, y.id)).filter((d) => !nach || d.id > nach).slice(0, grenze)
      return Promise.resolve({ data: liste, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unbekannte Funktion ${name}` } })
  }
  storage = {
    from: (b: string) => {
      assertEquals(b, SICHERUNG_EIMER)
      return {
        upload: async (pfad: string, inhalt: Uint8Array, o: { contentType?: string } = {}) => {
          this.eimer.set(pfad, { bytes: new Uint8Array(inhalt), typ: o.contentType ?? '', erstellt: new Date().toISOString() })
          return { data: { path: pfad }, error: null }
        },
        download: (pfad: string) => {
          const d = this.eimer.get(pfad)
          return Promise.resolve(d ? { data: new Blob([d.bytes as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: 'Object not found' } })
        },
        list: () => Promise.resolve({ data: [...this.eimer.entries()].map(([name, d]) => ({ name, created_at: d.erstellt, metadata: { size: d.bytes.length } })), error: null }),
        remove: (pfade: string[]) => {
          for (const p of pfade) this.eimer.delete(p)
          return Promise.resolve({ data: pfade.map((name) => ({ name })), error: null })
        },
        createSignedUrl: (pfad: string, s: number, o: { download?: string } = {}) => Promise.resolve({ data: { signedUrl: `https://speicher.test/${pfad}?s=${s}&name=${o.download}` }, error: null }),
      }
    },
  }
}

function uuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
}

const JETZT = new Date('2026-11-23T01:30:00Z') // 2:30 Uhr in Berlin (Winterzeit)

function testDaten(): TestDb {
  const kunden: Zeile[] = Array.from({ length: 2500 }, (_, i) => ({ id: `k_${String(i).padStart(5, '0')}`, firma: `Firma ${i}`, activities: [{ text: 'Anruf', datum: '2026-11-01' }], dokumente: i === 7 ? [{ name: 'Vertrag.pdf' }] : [] }))
  const termine: Zeile[] = Array.from({ length: 30 }, (_, i) => ({ id: uuid(i), kunde_id: i < 3 ? 'k_00007' : null, titel: `Termin ${i}` }))
  const nutzung: Zeile[] = Array.from({ length: 2300 }, (_, i) => ({ email: i % 2 ? 'a@x.de' : 'b@x.de', minute: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }))
  const ki: Zeile[] = [
    { id: 1, am: '2026-01-01T00:00:00Z', kosten_usd: 0.1 },
    { id: 2, am: '2026-11-20T00:00:00Z', kosten_usd: 0.2 },
  ]
  const ohneSchluessel: Zeile[] = Array.from({ length: 1200 }, (_, i) => ({ todo_id: `t${String(i).padStart(4, '0')}`, prio: i % 5 }))
  const mitarbeiter: Zeile[] = [
    { id: 'm1', name: 'Eray', email: 'eray@test.de', aktiv: true, ist_superuser: true, ist_admin: true, rolle: 'geschaeftsfuehrung', telegram_chat_id: 111 },
    { id: 'm2', name: 'Hasan', email: 'hasan@test.de', aktiv: true, ist_superuser: false, ist_admin: true, rolle: 'geschaeftsfuehrung', telegram_chat_id: 222 },
    { id: 'm3', name: 'Quirin', email: 'quirin@test.de', aktiv: true, ist_superuser: false, ist_admin: false, rolle: 'mitarbeiter', telegram_chat_id: 333 },
  ]
  const infos: TabellenInfo[] = [
    { tabelle: 'kunden', schluessel: ['id'], spalten: ['id', 'firma', 'activities', 'dokumente'], sortierung: ['id'] },
    { tabelle: 'termine', schluessel: ['id'], spalten: ['id', 'kunde_id', 'titel'], sortierung: ['id'] },
    { tabelle: 'nutzung_minuten', schluessel: ['email', 'minute'], spalten: ['email', 'minute'], sortierung: ['email', 'minute'] },
    { tabelle: 'ki_verbrauch', schluessel: ['id'], spalten: ['id', 'am', 'kosten_usd'], sortierung: ['id'] },
    { tabelle: 'todos_prio_sicherung', schluessel: [], spalten: ['todo_id', 'prio'], sortierung: ['todo_id', 'prio'] },
    { tabelle: 'formular_zaehler', schluessel: ['id'], spalten: ['id'], sortierung: ['id'] },
    { tabelle: 'mitarbeiter', schluessel: ['id'], spalten: ['id', 'name', 'email'], sortierung: ['id'] },
    { tabelle: 'abteilung_eintraege', schluessel: ['id'], spalten: ['id', 'art', 'daten'], sortierung: ['id'] },
  ]
  const dateien: DateiZeile[] = Array.from({ length: 1500 }, (_, i) => ({ id: uuid(i), eimer: i % 3 ? 'kunden-dokumente' : 'objekt-dokumente', pfad: `k/${i}.pdf`, groesse: 1000, typ: 'application/pdf', erstellt: null }))
  dateien.push({ id: uuid(9999), eimer: SICHERUNG_EIMER, pfad: 'alt.zip', groesse: 5, typ: null, erstellt: null })
  return new TestDb({ kunden, termine, nutzung_minuten: nutzung, ki_verbrauch: ki, todos_prio_sicherung: ohneSchluessel, formular_zaehler: [{ id: 1 }], mitarbeiter, abteilung_eintraege: [] }, infos, dateien)
}

function anfrage(token = 'login-token-0123456789012345678901234567890'): Request {
  return new Request('https://x.test', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
}

/** ermittleAufrufer mit Dienstschlüssel + imAuftragVon (wie die Server-Aufrufe). */
function alsDienst(): Request {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)
  return anfrage(TEST_DIENST_SCHLUESSEL)
}

// ---------------------------------------------------------------------------------------------
// Kern
// ---------------------------------------------------------------------------------------------

Deno.test('Name in Berliner Zeit, ISO-Woche', () => {
  assertEquals(sicherungsName(JETZT), '2026-11-23_0230')
  assertEquals(sicherungsName(new Date('2026-07-01T00:45:00Z')), '2026-07-01_0245') // Sommerzeit
  assertEquals(isoWoche('2026-11-23'), '2026-W48')
  assertEquals(isoWoche('2027-01-01'), '2026-W53')
})

Deno.test('Aufbewahrung: 14 Tage, 8 Wochen, 12 Monate; fremde Dateien bleiben', () => {
  const namen: string[] = []
  const start = Date.UTC(2025, 0, 1)
  for (let i = 0; i < 700; i++) namen.push(sicherungsName(new Date(start + i * 86400_000 + 3600_000)))
  namen.push('2026-11-30_1415') // zweite Sicherung am letzten Tag (von Hand)
  namen.push('notiz')
  const bleibt = zuBehalten(namen)
  assert(bleibt.has('notiz'))
  const tage = [...bleibt].filter((n) => n !== 'notiz').map((n) => n.slice(0, 10))
  const letzte14 = [...new Set(namen.filter((n) => n !== 'notiz').map((n) => n.slice(0, 10)))].sort().slice(-14)
  for (const t of letzte14) assert(tage.includes(t), `Tag ${t} fehlt`)
  assert(bleibt.has('2026-11-30_1415'))
  const monate = new Set(tage.map((t) => t.slice(0, 7)))
  assert(monate.size >= 12 && monate.size <= 13, `Monate: ${monate.size}`)
  // Gesamtzahl: höchstens 14 Tage (+1 zweite am selben Tag) + 8 + 12 (Überschneidungen zählen einmal).
  assert(bleibt.size - 1 <= 15 + 8 + 12, `zu viele: ${bleibt.size}`)
  assert(bleibt.size - 1 >= 26, `zu wenige: ${bleibt.size}`)
  // Stabil: Am nächsten Tag fällt nur heraus, was aus allen Fenstern fällt; die Monatssicherung bleibt dieselbe.
  const monatsErster = [...bleibt].filter((n) => n.startsWith('2026-06'))
  assertEquals(monatsErster, ['2026-06-01_0300']) // Sommerzeit: 1 Uhr UTC = 3 Uhr Berlin
})

Deno.test('Vergleich und Akte-Spalte', () => {
  const v = vergleiche(
    [{ id: 'a', x: 1, j: { b: 1, a: 2 } }, { id: 'b', x: 2 }, { id: 'c', x: 3 }],
    [{ id: 'a', x: 1, j: { a: 2, b: 1 }, neu: 5 }, { id: 'b', x: 9 }, { id: 'd', x: 4 }],
    ['id'],
  )
  assertEquals(v.gleich, 1)
  assertEquals(v.geaendert.map((g) => [g.schluessel, g.felder]), [['"b"', ['x']]])
  assertEquals(v.neu.map((z) => z.id), ['c'])
  assertEquals(v.nurLive.map((z) => z.id), ['d'])
  assertEquals(stabil({ b: 1, a: [1, { d: 1, c: 2 }] }), '{"a":[1,{"c":2,"d":1}],"b":1}')
  assertEquals(akteSpalte('kunden', ['id']), 'id')
  assertEquals(akteSpalte('eingegangene_emails', ['id', 'zugewiesener_kunde_id']), 'zugewiesener_kunde_id')
  assertEquals(akteSpalte('todos', ['id', 'kunde_projekt']), null)
})

// ---------------------------------------------------------------------------------------------
// Sicherung
// ---------------------------------------------------------------------------------------------

Deno.test('Sicherung: alle Zeilen trotz 1000er-Grenze, Ausschlüsse, Zeitgrenze, Paket lesbar', async () => {
  const db = testDaten()
  const e = await erstelleSicherung(db, { jetzt: JETZT })
  const m = e.manifest
  const zeilen = Object.fromEntries(m.tabellen.map((t) => [t.tabelle, t.zeilen]))
  assertEquals(zeilen.kunden, 2500)
  assertEquals(zeilen.nutzung_minuten, 2300)
  assertEquals(zeilen.todos_prio_sicherung, 1200)
  assertEquals(zeilen.ki_verbrauch, 1) // nur die letzten 90 Tage
  assertEquals(zeilen.formular_zaehler, undefined)
  assertEquals(m.ausgelassen.map((a) => a.tabelle), ['formular_zaehler'])
  assertEquals(m.dateien.anzahl, 1500) // ohne den Sicherungs-Eimer
  assertEquals(m.dateien.jeEimer['objekt-dokumente'].anzahl, 500)
  assert(m.warnungen.some((w) => w.includes('todos_prio_sicherung')))
  // Hochgeladen: Paket + Manifest
  assert(db.eimer.has('2026-11-23_0230.zip'))
  assertEquals(db.eimer.get('2026-11-23_0230.zip')!.typ, 'application/zip')
  const einzel = JSON.parse(new TextDecoder().decode(db.eimer.get('2026-11-23_0230.json')!.bytes))
  assertEquals(einzel.paketBytes, e.paketBytes)
  // Paket zurücklesen, Prüfsummen prüfen, Inhalt vergleichen
  const p = lesePaket(db.eimer.get('2026-11-23_0230.zip')!.bytes)
  const k = await p.zeilen('kunden')
  assertEquals(k!.length, 2500)
  assertEquals(new Set(k!.map((z) => z.id)).size, 2500)
  assertEquals(k!.find((z) => z.id === 'k_00007')!.dokumente, [{ name: 'Vertrag.pdf' }])
  assertEquals((await p.zeilen('nutzung_minuten'))!.length, 2300)
  assertEquals(await p.zeilen('formular_zaehler'), null)
  assertEquals((await p.dateiliste()).length, 1500)
})

Deno.test('Sicherung: Probelauf schreibt nichts', async () => {
  const db = testDaten()
  const e = await erstelleSicherung(db, { jetzt: JETZT, schreiben: false, art: 'probe' })
  assertEquals(db.eimer.size, 0)
  assert(e.paketBytes > 0)
  assert(!db.abfragen.some((a) => a.startsWith('insert') || a.startsWith('update')))
})

Deno.test('Sicherung: beschädigtes Paket fällt auf', async () => {
  const db = testDaten()
  await erstelleSicherung(db, { jetzt: JETZT })
  const zip = db.eimer.get('2026-11-23_0230.zip')!.bytes
  // Ein Byte mitten in den Daten ändern
  const kaputt = new Uint8Array(zip)
  kaputt[Math.floor(kaputt.length / 2)] ^= 0xff
  let fehler = ''
  try {
    const p = lesePaket(kaputt)
    for (const t of p.manifest.tabellen) await p.zeilen(t.tabelle)
  } catch (err) {
    fehler = String(err)
  }
  assertMatch(fehler, /beschädigt|ZIP|JSON|gzip|Daten|corrupt|invalid/i)
})

Deno.test('Drehung beim Schreiben: alte Sicherungen außerhalb der Aufbewahrung verschwinden', async () => {
  const db = testDaten()
  for (let i = 1; i <= 40; i++) {
    const n = sicherungsName(new Date(JETZT.getTime() - i * 86400_000))
    db.eimer.set(`${n}.zip`, { bytes: new Uint8Array(3), typ: 'application/zip', erstellt: '' })
    db.eimer.set(`${n}.json`, { bytes: new Uint8Array(3), typ: 'application/json', erstellt: '' })
  }
  db.eimer.set('LIESMICH.txt', { bytes: new Uint8Array(1), typ: 'text/plain', erstellt: '' })
  const e = await erstelleSicherung(db, { jetzt: JETZT })
  assert(e.entfernt.length > 0)
  const rest = await listeSicherungen(db)
  assertEquals(rest[0].name, '2026-11-23_0230')
  assert(db.eimer.has('LIESMICH.txt'))
  for (const n of e.entfernt) assert(!db.eimer.has(`${n}.zip`) && !db.eimer.has(`${n}.json`))
  assertEquals(rest.length, zuBehalten([...rest.map((r) => r.name)]).size)
})

// ---------------------------------------------------------------------------------------------
// Nachtlauf
// ---------------------------------------------------------------------------------------------

Deno.test('Nachtfenster 2:30–5:59 Berlin', () => {
  assert(!imNachtfenster(new Date('2026-11-23T01:29:00Z')))
  assert(imNachtfenster(new Date('2026-11-23T01:30:00Z')))
  assert(imNachtfenster(new Date('2026-11-23T04:59:00Z')))
  assert(!imNachtfenster(new Date('2026-11-23T05:00:00Z')))
})

Deno.test('Nachtlauf: außerhalb ohne Datenbankzugriff; einmal je Nacht; keine Nachricht bei Erfolg', async () => {
  const db = testDaten()
  const gesendet: [unknown, string][] = []
  const sende = (c: number | string, t: string) => (gesendet.push([c, t]), Promise.resolve(true))
  assertEquals((await pruefeNaechtlicheSicherung(db, sende, new Date('2026-11-23T12:00:00Z'))).grund, 'außerhalb')
  assertEquals(db.abfragen.length, 0)
  const r = await pruefeNaechtlicheSicherung(db, sende, JETZT)
  assertEquals(r, { gelaufen: true, ok: true })
  const { stand } = await leseStand(db)
  assertEquals(stand.nacht, '2026-11-23')
  assertEquals(stand.nachtErfolg, true)
  assertEquals(stand.laeuftSeit, null)
  assertEquals(stand.letzte!.zeilen, 2500 + 30 + 2300 + 1 + 1200 + 3 + 1 /* abteilung_eintraege: der Stand selbst */)
  const nochmal = await pruefeNaechtlicheSicherung(db, sende, new Date(JETZT.getTime() + 60_000))
  assertEquals(nochmal.grund, 'erledigt')
  assertEquals(gesendet.length, 0)
  assertEquals([...db.eimer.keys()].filter((k) => k.endsWith('.zip')).length, 1)
})

Deno.test('Nachtlauf: drei Fehlschläge im Abstand, dann genau eine Nachricht an Superuser', async () => {
  const db = testDaten()
  db.kaputt.add('termine')
  const gesendet: [unknown, string][] = []
  const sende = (c: number | string, t: string) => (gesendet.push([c, t]), Promise.resolve(true))
  let t = JETZT.getTime()
  assertEquals((await pruefeNaechtlicheSicherung(db, sende, new Date(t))).ok, false)
  assertEquals((await pruefeNaechtlicheSicherung(db, sende, new Date(t + 5 * 60_000))).grund, 'warten')
  t += 21 * 60_000
  assertEquals((await pruefeNaechtlicheSicherung(db, sende, new Date(t))).ok, false)
  assertEquals(gesendet.length, 0)
  t += 21 * 60_000
  const dritter = await pruefeNaechtlicheSicherung(db, sende, new Date(t))
  assertEquals(dritter.gemeldet, 1)
  assertEquals(gesendet.length, 1)
  assertEquals(gesendet[0][0], 111) // nur der Superuser
  assertMatch(gesendet[0][1], /Datensicherung der Nacht 23\.11\.2026 ist 3-mal fehlgeschlagen/)
  assertMatch(gesendet[0][1], /termine: Verbindung zu termine abgebrochen/)
  t += 21 * 60_000
  await pruefeNaechtlicheSicherung(db, sende, new Date(t))
  await pruefeNaechtlicheSicherung(db, sende, new Date(t + 60 * 60_000))
  assertEquals(gesendet.length, 1) // nie doppelt
  assertEquals(db.eimer.size, 0)
  // Nächste Nacht: wieder von vorn, klappt.
  db.kaputt.clear()
  const naechste = await pruefeNaechtlicheSicherung(db, sende, new Date(JETZT.getTime() + 86400_000))
  assertEquals(naechste, { gelaufen: true, ok: true })
  assertEquals((await leseStand(db)).stand.letzterFehler, null)
})

Deno.test('Nachtlauf: Sperre eines laufenden Takts wird geachtet; abgebrochener Lauf zählt als Versuch', async () => {
  const db = testDaten()
  const sende = () => Promise.resolve(true)
  // Ein anderer Takt hat vor 2 Minuten begonnen.
  await aendereStand(db, () => ({ nacht: '2026-11-23', versuche: 1, letzterVersuch: new Date(JETZT.getTime() - 120_000).toISOString(), laeuftSeit: new Date(JETZT.getTime() - 120_000).toISOString(), laeuftArt: 'nacht' }))
  assertEquals((await pruefeNaechtlicheSicherung(db, sende, JETZT)).grund, 'läuft')
  // 20 Minuten später: Sperre abgelaufen (Server hat den Lauf beendet) → zweiter Versuch, mit Vermerk.
  const spaeter = new Date(JETZT.getTime() + 20 * 60_000)
  assertEquals(await pruefeNaechtlicheSicherung(db, sende, spaeter), { gelaufen: true, ok: true })
  assertEquals((await leseStand(db)).stand.versuche, 2)
})

Deno.test('Nachtlauf: zwei gleichzeitige Takte — nur einer sichert', async () => {
  const db = testDaten()
  const sende = () => Promise.resolve(true)
  const [a, b] = await Promise.all([pruefeNaechtlicheSicherung(db, sende, JETZT), pruefeNaechtlicheSicherung(db, sende, JETZT)])
  assertEquals([a.gelaufen, b.gelaufen].filter(Boolean).length, 1)
  assertEquals([...db.eimer.keys()].filter((k) => k.endsWith('.zip')).length, 1)
})

// ---------------------------------------------------------------------------------------------
// Aktion
// ---------------------------------------------------------------------------------------------

Deno.test('Aktion: nur Geschäftsführung und Superuser; Stand, Link, Meldung aus', async () => {
  const db = testDaten()
  const req = alsDienst()
  const hintergrund: Promise<unknown>[] = []
  const warte = (p: Promise<unknown>) => void hintergrund.push(p)

  const nein = await datensicherungAktion(req, db, { imAuftragVon: 'quirin@test.de' }, warte, JETZT)
  assertEquals(nein.status, 403)

  const leer = await datensicherungAktion(req, db, { imAuftragVon: 'hasan@test.de' }, warte, JETZT)
  assertEquals(leer.status, 200)
  assertEquals((leer.daten as { neueste: unknown }).neueste, null)
  assertEquals((await datensicherungAktion(req, db, { imAuftragVon: 'eray@test.de', aufgabe: 'herunterladen' }, warte, JETZT)).status, 404)

  const los = await datensicherungAktion(req, db, { imAuftragVon: 'eray@test.de', aufgabe: 'jetzt' }, warte, JETZT)
  assertEquals(los.status, 200)
  // Während sie läuft: zweiter Start wird abgelehnt.
  const doppelt = await datensicherungAktion(req, db, { imAuftragVon: 'hasan@test.de', aufgabe: 'jetzt' }, warte, JETZT)
  assertEquals(doppelt.status, 409)
  await Promise.all(hintergrund)

  const st = await datensicherungAktion(req, db, { imAuftragVon: 'eray@test.de' }, warte, JETZT)
  // deno-lint-ignore no-explicit-any
  const d = st.daten as any
  assertEquals(d.laeuft, null)
  assertEquals(d.letzte.art, 'hand')
  assertEquals(d.neueste.name, '2026-11-23_0230')
  assertEquals(d.neueste.tabellen.find((t: { tabelle: string }) => t.tabelle === 'kunden').zeilen, 2500)
  assertEquals(d.sicherungen.length, 1)
  assertEquals(d.meldungAn, true)

  const link = await datensicherungAktion(req, db, { imAuftragVon: 'hasan@test.de', aufgabe: 'herunterladen' }, warte, JETZT)
  assertEquals(link.status, 200)
  assertMatch((link.daten as { url: string }).url, /2026-11-23_0230\.zip\?s=600&name=crm-sicherung-2026-11-23_0230\.zip/)
  assertEquals((await leseStand(db)).stand.downloads![0].von, 'hasan@test.de')

  const aus = await datensicherungAktion(req, db, { imAuftragVon: 'eray@test.de', aufgabe: 'meldung', an: false }, warte, JETZT)
  assertEquals((aus.daten as { meldungAn: boolean }).meldungAn, false)
  assertEquals((await leseStand(db)).stand.ohneMeldung, ['eray@test.de'])
  // Mit abgeschalteter Meldung: kein Superuser bekommt die Fehlermeldung.
  db.kaputt.add('kunden')
  const gesendet: unknown[] = []
  const sende = (c: number | string) => (gesendet.push(c), Promise.resolve(true))
  let t = JETZT.getTime() + 86400_000
  for (let i = 0; i < 3; i++, t += 21 * 60_000) await pruefeNaechtlicheSicherung(db, sende, new Date(t))
  assertEquals(gesendet.length, 0)
  assertEquals((await leseStand(db)).stand.gemeldet, '2026-11-24')
})

Deno.test('Aktion: ohne Anmeldung 401', async () => {
  const db = testDaten()
  const r = await datensicherungAktion(new Request('https://x.test', { method: 'POST' }), db, {}, () => {}, JETZT)
  assertEquals(r.status, 401)
  assertEquals(db.t.abteilung_eintraege.filter((z) => z.id === STAND_ID).length, 0)
})
