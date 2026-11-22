// Test des Wiederherstellungs-Programms mit falschem Supabase (fetch ersetzt): Probelauf schreibt nie, Akte samt
// zugehöriger Zeilen, umgehängte Zeilen bleiben, Rückfalldatei und Umkehren.
//   npx -y deno test --allow-all scripts/sicherung-wiederherstellen.test.ts
import { assert, assertEquals, assertMatch, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { hauptprogramm, leseArgumente, type Umgebung } from './sicherung-wiederherstellen.ts'
import { baueZipPaket, gzip, sha256Hex, tabellenDatei, type Manifest, type Zeile } from '../supabase/functions/_shared/sicherungKern.ts'

const SCHEMA: Record<string, { schluessel: string[]; spalten: string[] }> = {
  kunden: { schluessel: ['id'], spalten: ['id', 'firma', 'bereich', 'activities', 'dokumente'] },
  termine: { schluessel: ['id'], spalten: ['id', 'kunde_id', 'titel'] },
  eingegangene_emails: { schluessel: ['id'], spalten: ['id', 'zugewiesener_kunde_id', 'betreff'] },
  todos: { schluessel: ['id'], spalten: ['id', 'text'] },
}

async function paket(tabellen: Record<string, Zeile[]>): Promise<Uint8Array> {
  const teile = new Map<string, Uint8Array>()
  const eintraege: Manifest['tabellen'] = []
  for (const [t, zeilen] of Object.entries(tabellen)) {
    const gz = await gzip(zeilen.map((z) => JSON.stringify(z)).join('\n') + '\n')
    teile.set(tabellenDatei(t), gz)
    eintraege.push({ tabelle: t, datei: tabellenDatei(t), zeilen: zeilen.length, bytes: gz.length, sha256: await sha256Hex(gz), schluessel: SCHEMA[t].schluessel, spalten: SCHEMA[t].spalten })
  }
  const dateien = await gzip('')
  teile.set('dateien.ndjson.gz', dateien)
  const m: Manifest = { format: 1, name: '2026-11-17_0230', erstellt: '2026-11-17T01:30:00Z', dauerMs: 1000, art: 'nacht', tabellen: eintraege, ausgelassen: [], dateien: { datei: 'dateien.ndjson.gz', anzahl: 0, bytes: 0, sha256: await sha256Hex(dateien), jeEimer: {} }, gesamtZeilen: 0, warnungen: [] }
  return baueZipPaket(m, teile)
}

const SICHERUNG: Record<string, Zeile[]> = {
  kunden: [
    { id: 'k1', firma: 'Muster GmbH', bereich: 'beratung', activities: [{ text: 'A' }, { text: 'B' }], dokumente: [{ name: 'Vertrag.pdf' }] },
    { id: 'k2', firma: 'Andere AG', bereich: 'beratung', activities: [], dokumente: [] },
  ],
  termine: [
    { id: 't1', kunde_id: 'k1', titel: 'Erstgespräch' },
    { id: 't2', kunde_id: 'k1', titel: 'Folgetermin' },
    { id: 't9', kunde_id: 'k2', titel: 'Fremd' },
  ],
  eingegangene_emails: [
    { id: 'm1', zugewiesener_kunde_id: 'k1', betreff: 'Anfrage' },
    { id: 'm2', zugewiesener_kunde_id: 'k1', betreff: 'Unterlagen' },
  ],
  todos: [{ id: 'x1', text: 'alt' }],
}

function liveStand(): Record<string, Zeile[]> {
  return {
    // Der Fall vom 17.11.: ein altes Fenster hat Verlauf und Dokumente überschrieben.
    kunden: [
      { id: 'k1', firma: 'Muster GmbH', bereich: 'beratung', activities: [{ text: 'A' }], dokumente: [] },
      { id: 'k2', firma: 'Andere AG (neu)', bereich: 'beratung', activities: [], dokumente: [] },
    ],
    termine: [
      { id: 't1', kunde_id: 'k1', titel: 'Erstgespräch' },
      { id: 't3', kunde_id: 'k1', titel: 'Neu seit der Sicherung' },
      { id: 't9', kunde_id: 'k2', titel: 'Fremd' },
    ],
    eingegangene_emails: [
      { id: 'm1', zugewiesener_kunde_id: 'k9', betreff: 'Anfrage' }, // inzwischen an anderer Akte
      { id: 'm2', zugewiesener_kunde_id: 'k1', betreff: 'Unterlagen' },
    ],
    todos: [{ id: 'x1', text: 'neu' }, { id: 'x2', text: 'seit Sicherung' }],
  }
}

function filterAus(q: URLSearchParams): ((z: Zeile) => boolean)[] {
  const f: ((z: Zeile) => boolean)[] = []
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    if (v.startsWith('eq.')) f.push((z) => String(z[k]) === v.slice(3))
    else if (v.startsWith('in.(')) {
      const werte = [...v.slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))
      f.push((z) => werte.includes(String(z[k])))
    } else throw new Error(`Filter ${k}=${v} unbekannt`)
  }
  return f
}

function falschesSupabase(live: Record<string, Zeile[]>, zip: Uint8Array) {
  const echt = globalThis.fetch
  const aufrufe: { methode: string; pfad: string; body?: unknown }[] = []
  globalThis.fetch = (async (eingabe: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(eingabe))
    assertEquals(url.origin, 'https://projekt.test')
    assertEquals(new Headers(init.headers).get('apikey'), 'dienst')
    const methode = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    aufrufe.push({ methode, pfad: url.pathname, body })
    const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/storage/v1/object/list/sicherungen') return json([{ name: '2026-11-17_0230.zip', metadata: { size: zip.length } }, { name: '2026-11-17_0230.json' }])
    if (url.pathname === '/storage/v1/object/sicherungen/2026-11-17_0230.zip') return new Response(zip as Uint8Array<ArrayBuffer>)
    if (url.pathname === '/rest/v1/rpc/sicherung_tabellen') return json(Object.entries(SCHEMA).map(([tabelle, s]) => ({ tabelle, ...s, sortierung: s.schluessel })))
    if (url.pathname === '/rest/v1/rpc/sicherung_zeilen_einspielen') {
      const { p_tabelle, p_zeilen, p_spalten } = body as { p_tabelle: string; p_zeilen: Zeile[]; p_spalten: string[] | null }
      const tab = live[p_tabelle]
      for (const z of p_zeilen) {
        const da = tab.find((x) => x.id === z.id)
        if (!da) tab.push(structuredClone(z))
        else for (const [k, v] of Object.entries(z)) if (k !== 'id' && (!p_spalten || p_spalten.includes(k))) da[k] = structuredClone(v)
      }
      return json(p_zeilen.length)
    }
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)
    if (m) {
      const tab = live[m[1]]
      const f = filterAus(url.searchParams)
      if (methode === 'DELETE') {
        live[m[1]] = tab.filter((z) => !f.every((x) => x(z)))
        return new Response(null, { status: 204 })
      }
      const von = Number(url.searchParams.get('offset') ?? 0)
      const grenze = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000)
      return json(tab.filter((z) => f.every((x) => x(z))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(von, von + grenze))
    }
    throw new Error(`unerwartet: ${methode} ${url.pathname}`)
  }) as typeof fetch
  return { aufrufe, zurueck: () => (globalThis.fetch = echt) }
}

function umgebung(dateien: Map<string, string>, antwort = true): Umgebung & { log: string[] } {
  const log: string[] = []
  return {
    url: 'https://projekt.test',
    schluessel: 'dienst',
    log,
    ausgabe: (z) => log.push(z),
    frage: () => antwort,
    schreibeDatei: (p, i) => (dateien.set(p, i), Promise.resolve()),
    leseDatei: (p) => Promise.resolve(new TextEncoder().encode(dateien.get(p) ?? '')),
    jetzt: () => new Date('2026-11-23T10:00:00Z'),
  }
}

const schreibt = (a: { methode: string; pfad: string; body?: unknown }[]) => a.filter((x) => x.pfad.endsWith('sicherung_zeilen_einspielen') || x.methode === 'DELETE')

Deno.test('Argumente', () => {
  assertEquals(leseArgumente(['akte', '--id', 'k1', '--ausfuehren']), { befehl: 'akte', o: { id: 'k1', ausfuehren: true } })
})

Deno.test('Akte: Probelauf schreibt nichts und zeigt den Plan', async () => {
  const live = liveStand()
  const f = falschesSupabase(live, await paket(SICHERUNG))
  try {
    const u = umgebung(new Map())
    await hauptprogramm(['akte', '--id', 'k1', '--werte'], u)
    const text = u.log.join('\n')
    assertEquals(schreibt(f.aufrufe).length, 0)
    assertMatch(text, /zurücksetzen "k1": activities, dokumente/)
    assertMatch(text, /neu anlegen "t2"/)
    assertMatch(text, /übersprungen "m1": zugewiesener_kunde_id — hängt inzwischen an Akte k9/)
    assertMatch(text, /PROBELAUF/)
    assert(!text.includes('t9'), 'fremde Akte darf nicht auftauchen')
    assert(!text.includes('todos'), 'Tabellen ohne Bezug zur Akte bleiben draußen')
    assertEquals(live, liveStand())
  } finally {
    f.zurueck()
  }
})

Deno.test('Akte: einspielen, Rückfalldatei, umkehren', async () => {
  const live = liveStand()
  const f = falschesSupabase(live, await paket(SICHERUNG))
  try {
    const dateien = new Map<string, string>()
    const u = umgebung(dateien)
    await hauptprogramm(['akte', '--id', 'k1', '--ausfuehren'], u)
    const k1 = live.kunden.find((z) => z.id === 'k1')!
    assertEquals(k1.activities, [{ text: 'A' }, { text: 'B' }])
    assertEquals(k1.dokumente, [{ name: 'Vertrag.pdf' }])
    assertEquals(live.kunden.find((z) => z.id === 'k2')!.firma, 'Andere AG (neu)') // andere Akte unberührt
    assert(live.termine.some((z) => z.id === 't2'))
    assert(live.termine.some((z) => z.id === 't3')) // neu seit der Sicherung, bleibt
    assertEquals(live.eingegangene_emails.find((z) => z.id === 'm1')!.zugewiesener_kunde_id, 'k9') // umgehängt, bleibt
    assertEquals(live.todos, liveStand().todos)
    // Reihenfolge: kunden vor den abhängigen Tabellen
    const rpc = schreibt(f.aufrufe).map((a) => (a.body as { p_tabelle: string }).p_tabelle)
    assertEquals(rpc, ['kunden', 'termine'])
    assertEquals((schreibt(f.aufrufe)[0].body as { p_ohne_ausloeser: boolean }).p_ohne_ausloeser, true)
    const datei = [...dateien.keys()][0]
    assertMatch(datei, /^wiederherstellung-2026-11-23T10-00-00-000Z-rueckfall\.ndjson$/)
    // Umkehren
    await hauptprogramm(['rueckgaengig', '--datei', datei, '--ausfuehren'], umgebung(dateien))
    assertEquals(live.kunden.find((z) => z.id === 'k1')!.activities, [{ text: 'A' }])
    assert(!live.termine.some((z) => z.id === 't2'))
    assertEquals(live, liveStand())
  } finally {
    f.zurueck()
  }
})

Deno.test('Akte: nur bestimmte Spalten; Rückfrage verneint = nichts geschrieben', async () => {
  const live = liveStand()
  const f = falschesSupabase(live, await paket(SICHERUNG))
  try {
    await hauptprogramm(['akte', '--id', 'k1', '--nur-akte', '--spalten', 'activities', '--ausfuehren'], umgebung(new Map(), false))
    assertEquals(schreibt(f.aufrufe).length, 0)
    await hauptprogramm(['akte', '--id', 'k1', '--nur-akte', '--spalten', 'activities', '--ausfuehren'], umgebung(new Map()))
    const k1 = live.kunden.find((z) => z.id === 'k1')!
    assertEquals(k1.activities, [{ text: 'A' }, { text: 'B' }])
    assertEquals(k1.dokumente, []) // nicht angefasst
    assertEquals(live.termine, liveStand().termine)
  } finally {
    f.zurueck()
  }
})

Deno.test('Tabelle: Probelauf mit --loeschen, dann eine einzelne Zeile', async () => {
  const live = liveStand()
  const f = falschesSupabase(live, await paket(SICHERUNG))
  try {
    const u = umgebung(new Map())
    await hauptprogramm(['tabelle', '--tabelle', 'todos', '--loeschen'], u)
    assertMatch(u.log.join('\n'), /löschen "x2"/)
    assertEquals(schreibt(f.aufrufe).length, 0)
    await hauptprogramm(['tabelle', '--tabelle', 'todos', '--id', 'x1', '--ausfuehren'], umgebung(new Map()))
    assertEquals(live.todos, [{ id: 'x1', text: 'alt' }, { id: 'x2', text: 'seit Sicherung' }])
    await hauptprogramm(['tabelle', '--tabelle', 'todos', '--loeschen', '--ausfuehren'], umgebung(new Map()))
    assertEquals(live.todos, [{ id: 'x1', text: 'alt' }])
    await assertRejects(() => hauptprogramm(['tabelle', '--tabelle', 'gibtsnicht'], umgebung(new Map())), Error, 'nicht in der Sicherung')
    await assertRejects(() => hauptprogramm(['akte', '--id', 'k404'], umgebung(new Map())), Error, 'nicht in der Sicherung')
  } finally {
    f.zurueck()
  }
})
