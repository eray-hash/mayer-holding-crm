import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { baueSvg, pruefeEingabe, umbrechen } from './diagramm.ts'
import { fuehreDiagrammAus } from './diagrammWerkzeug.ts'

const beispiele = {
  mindmap: { art: 'mindmap', titel: 'Thema', knoten: { text: 'Mitte', kinder: [{ text: 'A', kinder: [{ text: 'A1' }] }, { text: 'B' }, { text: 'C' }] } },
  baum: { art: 'baum', titel: 'Baum', knoten: { text: 'Wurzel', kinder: [{ text: 'Ja' }, { text: 'Nein' }] } },
  organigramm: { art: 'organigramm', titel: 'Aufbau', knoten: { text: 'Leitung', kinder: [{ text: 'Team 1' }, { text: 'Team 2' }] } },
  ablauf: { art: 'ablauf', titel: 'Ablauf', schritte: [{ art: 'start', text: 'Los' }, { text: 'Prüfen' }, { art: 'frage', text: 'Gut?', nein: 'Nacharbeiten', nein_weiter_bei: 2 }, { art: 'ende', text: 'Fertig' }] },
  struktogramm: { art: 'struktogramm', titel: 'Struktur', bloecke: [{ art: 'anweisung', text: 'Start' }, { art: 'verzweigung', text: 'Bedingung?', ja: [{ art: 'anweisung', text: 'X' }], nein: [] }, { art: 'schleife', text: 'Solange', inhalt: [{ art: 'anweisung', text: 'Y' }] }] },
  zeitstrahl: { art: 'zeitstrahl', titel: 'Verlauf', ereignisse: [{ datum: 'Jan', text: 'Beginn' }, { text: 'Ende' }] },
  tafel: { art: 'tafel', titel: 'Ideen', spalten: [{ titel: 'Pro', punkte: ['a', 'b'] }, { titel: 'Contra', punkte: [] }] },
}

Deno.test('alle Arten ergeben ein gültiges SVG mit Titel und Texten', () => {
  for (const [art, roh] of Object.entries(beispiele)) {
    const e = pruefeEingabe(roh)
    if (typeof e === 'string') throw new Error(`${art}: ${e}`)
    const { svg, b, h } = baueSvg(e)
    assert(svg.startsWith('<svg') && svg.endsWith('</svg>'), art)
    assert(b > 100 && h > 50 && Number.isFinite(b) && Number.isFinite(h), art)
    assertStringIncludes(svg, `>${e.titel}<`)
    assert(!svg.includes('NaN'), `${art} enthält NaN`)
  }
})

Deno.test('Prüfung: falsche Art, fehlender Inhalt, Sonderzeichen werden maskiert, Grenze', () => {
  assertStringIncludes(pruefeEingabe({ art: 'kuchen' }) as string, 'Fehler')
  assertStringIncludes(pruefeEingabe({ art: 'mindmap', titel: 'x' }) as string, 'knoten fehlt')
  const e = pruefeEingabe({ art: 'baum', titel: 'A & B <C>', knoten: { text: 'x' } })
  if (typeof e === 'string') throw new Error(e)
  assertStringIncludes(baueSvg(e).svg, 'A &amp; B &lt;C&gt;')
  const viele = { text: 'Wurzel', kinder: Array.from({ length: 300 }, (_, i) => ({ text: `K${i}` })) }
  const g = pruefeEingabe({ art: 'mindmap', titel: 't', knoten: viele })
  if (typeof g === 'string') throw new Error(g)
  assert((g.knoten?.kinder?.length ?? 0) < 120)
})

Deno.test('Umbruch hält Zeilen schmal', () => {
  const zeilen = umbrechen('ein ziemlich langer Text mit vielen Wörtern darin', 100, 14)
  assert(zeilen.length > 2)
})

// Datenbank-Doppel: kennt nur die Mitarbeiter-Zeile (Chat) und keine Akten.
const db = {
  from: () => {
    const k = { select: () => k, eq: () => k, ilike: () => k, maybeSingle: () => Promise.resolve({ data: { telegram_chat_id: 42 } }) }
    return k
  },
}

Deno.test('Werkzeug ohne Akte: zeichnet, schickt Foto über den übergebenen Bot, legt nichts ab', async () => {
  const aufrufe: string[] = []
  const abruf = ((url: string) => {
    aufrufe.push(String(url))
    return Promise.resolve(new Response(JSON.stringify({ ok: true })))
  }) as unknown as typeof fetch
  const log: string[] = []
  const text = await fuehreDiagrammAus(beispiele.mindmap, {
    supabase: db,
    mitarbeiter: { name: 'Max Muster', email: 'max@beispiel.de', id: 'm1' } as never,
    protokolliere: (t) => log.push(t),
    heute: '2026-11-23',
    botToken: 'PRIVAT',
    abruf,
    zeichne: () => Promise.resolve({ png: new Uint8Array([1, 2, 3]), pdf: new Uint8Array([4]) }),
  })
  assertStringIncludes(text, 'Das Bild ist im Chat')
  assertStringIncludes(text, 'in keiner Akte abgelegt')
  assertEquals(aufrufe.length, 1)
  assertStringIncludes(aufrufe[0], '/botPRIVAT/sendPhoto')
  assertEquals(log.length, 1)
})

Deno.test('Werkzeug: unbekannte Akte → Fehler, es wird nicht gezeichnet', async () => {
  let gezeichnet = false
  const leer = { from: () => { const k = { select: () => k, eq: () => k, maybeSingle: () => Promise.resolve({ data: null }) }; return k } }
  const text = await fuehreDiagrammAus({ ...beispiele.baum, kunde_id: 'k_gibtsnicht' }, {
    supabase: leer,
    mitarbeiter: { name: 'Max Muster', email: 'max@beispiel.de' } as never,
    protokolliere: () => {},
    botToken: null,
    zeichne: () => { gezeichnet = true; return Promise.resolve({ png: new Uint8Array(), pdf: new Uint8Array() }) },
  })
  assertStringIncludes(text, 'Fehler')
  assertEquals(gezeichnet, false)
})
