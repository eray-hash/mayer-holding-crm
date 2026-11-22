// Werkzeug-Gruppen (werkzeugGruppen.ts): jede Zuordnung eindeutig, Kern deckt die meistgenutzten
// Werkzeuge, privater Assistent behält seine Liste, Stichwörter, Hinweistext und Zwischenspeicher-Marken.
// Kein Netz, keine Datenbank.
//
//   npx -y deno test --allow-env --allow-read --allow-net=localhost telegram-gateway/werkzeugGruppen.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  ABSATZ_GRUPPE,
  benutzteWerkzeuge,
  GRUPPEN,
  GRUPPEN_REIHENFOLGE,
  type GruppenName,
  gruppeVon,
  hinweiseFuer,
  KERN,
  LADE_WERKZEUG_NAME,
  mitNachrichtenCache,
  starteAuswahl,
  waehleGruppen,
  zerlegeHinweise,
} from './werkzeugGruppen.ts'
import { PRIVAT_BOT_WERKZEUGE } from './privatBot.ts'

// index.ts startet beim Laden seinen Server; für den Test genügt ein stiller Ersatz (wie privatBot.test.ts).
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = () => ({ finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: 'localhost', port: 0 } })
const { werkzeugListe } = await import('./index.ts')

// Der Hinweistext ist in index.ts nicht exportiert — aus dem Quelltext lesen.
const QUELLE = await Deno.readTextFile(new URL('./index.ts', import.meta.url))
const ANFANG = 'const SYSTEM_PROMPT = `'
const SYSTEM_PROMPT = QUELLE.slice(QUELLE.indexOf(ANFANG) + ANFANG.length).split('`\n')[0]

const VOLL = werkzeugListe({ briefe: true, outlook: true }, false)
const OHNE_PRIVAT = werkzeugListe({ briefe: false, outlook: false }, false)
const PRIVAT = werkzeugListe({ briefe: true, outlook: true }, true)
const namen = (l: { name: string }[]) => l.map((w) => w.name)
const ohneVerlauf = { verlauf: [], privatBot: false }

Deno.test('Zuordnung: jedes Werkzeug gehört genau einer Gruppe, keine Tippfehler', () => {
  const zuordnungen = [...KERN.map((n) => [n, 'kern']), ...GRUPPEN_REIHENFOLGE.flatMap((g) => GRUPPEN[g].werkzeuge.map((n) => [n, g]))]
  const gesehen = new Map<string, string>()
  for (const [n, g] of zuordnungen) {
    assert(!gesehen.has(n), `${n} steht in ${gesehen.get(n)} und in ${g}`)
    gesehen.set(n, g)
  }
  for (const n of namen(VOLL)) assert(gesehen.has(n), `${n} ist keiner Gruppe zugeordnet — in werkzeugGruppen.ts eintragen (KERN oder GRUPPEN)`)
  // Zugeordnet, aber (noch) nicht eingebunden ist erlaubt, solange ein Modul das Werkzeug definiert.
  const definiert = new Set<string>()
  for (const d of Deno.readDirSync(new URL('.', import.meta.url))) {
    if (!d.name.endsWith('.ts') || d.name.endsWith('.test.ts')) continue
    for (const m of Deno.readTextFileSync(new URL(`./${d.name}`, import.meta.url)).matchAll(/name: '([a-z_]+)'/g)) definiert.add(m[1])
  }
  for (const n of gesehen.keys()) assert(namen(VOLL).includes(n) || definiert.has(n), `${n} gibt es nicht (Tippfehler oder entfernt)`)
  assertEquals(Object.keys(GRUPPEN).sort(), [...GRUPPEN_REIHENFOLGE].sort())
  assert(!namen(VOLL).includes(LADE_WERKZEUG_NAME))
})

Deno.test('Kern: deckt die meistgenutzten Werkzeuge', () => {
  // Gezählt in den gespeicherten Gesprächen am 22.11.2026 (Mayer-Bot und privater Assistent),
  // ergänzt nach Urteil auf 20 (siehe Kommentar an KERN).
  const meistgenutzt = [
    'kunden_suchen',
    'kundenakte_lesen',
    'todo_anlegen',
    'dokument_inhalt',
    'dateien_ablegen',
    'datei_lesen',
    'dokument_erstellen',
    'objekte_suchen',
    'dokument_aus_akte_nehmen',
    'notiz_speichern',
    'termine_zeigen',
    'todo_aendern',
    'datei_senden',
    'wunsch_notieren',
    'kollegen_benachrichtigen',
    'kunde_anlegen',
    'objektakte_lesen',
    'aufgaben_uebersicht',
    'alles_durchsuchen',
    'termin_anlegen',
  ]
  assertEquals(meistgenutzt.length, 20)
  for (const n of meistgenutzt) assertEquals(gruppeVon(n), 'kern', `${n} gehört in den Kern`)
  // Ohne jedes Stichwort sind genau diese Werkzeuge und das Ladewerkzeug da.
  const a = starteAuswahl(OHNE_PRIVAT, { eingang: 'Hallo', ...ohneVerlauf }, true)
  for (const n of meistgenutzt) assert(namen(a.werkzeuge()).includes(n), `${n} fehlt ohne Stichwort`)
  // Häufig im privaten Assistenten: Hotmail — dort immer geladen.
  const p = starteAuswahl(PRIVAT, { eingang: 'Hallo', verlauf: [], privatBot: true }, true)
  for (const n of ['outlook_anhang_lesen', 'outlook_mail', 'outlook_suche', 'outlook_mail_vorbereiten']) assert(namen(p.werkzeuge()).includes(n), `${n} fehlt im privaten Assistenten`)
})

Deno.test('Privater Assistent: Auswahl bleibt in seiner Liste, auch nach Nachladen', () => {
  const erlaubt = new Set([...namen(PRIVAT), LADE_WERKZEUG_NAME])
  const a = starteAuswahl(PRIVAT, { eingang: 'Schreib eine Mail und leg die Rechnung ab, Termin verschieben', verlauf: [], privatBot: true }, true)
  for (const g of GRUPPEN_REIHENFOLGE) a.lade({ gruppen: [g] })
  for (const n of namen(a.werkzeuge())) assert(erlaubt.has(n), `${n} darf der private Assistent nicht haben`)
  // Alles geladen = genau seine Liste.
  assertEquals(new Set(namen(a.werkzeuge())), erlaubt)
  for (const n of ['gemeinsames_postfach', 'mail_senden', 'mail_vorbereiten', 'rechnung_erfassen', 'kunde_bereich_wechseln', 'kollegen_benachrichtigen', 'firmenueberblick']) {
    assert(!namen(a.werkzeuge()).includes(n), `${n} darf nie auftauchen`)
  }
  // merke() bringt kein fremdes Werkzeug zurück.
  a.merke('gemeinsames_postfach')
  assert(!namen(a.werkzeuge()).includes('gemeinsames_postfach'))
  // Die angepassten Kopien (ohne Sammelakten, kunde_anlegen nur privat) bleiben erhalten.
  // deno-lint-ignore no-explicit-any
  const schema = (n: string) => (a.werkzeuge().find((w) => w.name === n) as any).input_schema.properties
  assert(!('ziel' in schema('dateien_ablegen')))
  assertEquals(schema('kunde_anlegen').bereich.enum, ['privat'])
  // Gruppen ohne ein einziges erlaubtes Werkzeug werden nicht angeboten.
  assert(!a.verfuegbar.has('buecher') && !a.verfuegbar.has('rechnungen'))
  assertStringIncludes(a.lade({ gruppen: ['buecher'] }), 'Nicht verfügbar')
  for (const n of PRIVAT_BOT_WERKZEUGE) assert(erlaubt.has(n), `${n} fehlt`)
})

Deno.test('Stichwörter: typische Bitten laden die passende Gruppe', () => {
  const faelle: [string, GruppenName[]][] = [
    ['Mach mir ein Exposé für Remstal', ['objekte']],
    ['Leg die Objektakte Söflingen an', ['objekte']],
    ['Welche Käufer passen zu dem Objekt?', ['vermarktung', 'objekte']],
    ['Rechne mir die Rendite für Remstal', ['vermarktung']],
    ['Hat die Bäckerei Maier die Rechnung schon bezahlt?', ['rechnungen']],
    ['Was kommt diesen Monat rein?', ['vertrieb']],
    ['Setz die Chance bei Huber auf 40 %', ['vertrieb']],
    ['Leg einen neuen Seminartermin für das Führungsseminar an', ['akademie']],
    ['Wie weit ist das Buch von Herrn Mayer?', ['buecher']],
    ['Schreib ihm eine Mail mit dem Angebot', ['postfach', 'rechnungen']],
    ['Was ist neu im Postfach?', ['postfach']],
    ['Verschieb den Termin mit Lipps auf 15:30', ['kalender']],
    ['Wann hast du nächste Woche frei?', ['kalender']],
    ['Benenn die Datei in Kaufvertrag um', ['dateien']],
    ['Schau dir das an: https://example.org/datei.pdf', ['dateien']],
    ['Huber und Huber GmbH sind dieselbe Firma', ['aktenpflege']],
    ['Gibt es Akten doppelt?', ['aktenpflege']],
    ['Was ist mit meinen Wiedervorlagen?', ['nachfassen']],
    ['Räum meine To-dos auf', ['nachfassen']],
    ['Hat Lipps die Vollmacht schon unterschrieben?', ['nachfassen']],
    ['Was steht in meinem Hotmail?', ['hotmail']],
  ]
  for (const [text, erwartet] of faelle) {
    const g = waehleGruppen({ eingang: text, ...ohneVerlauf })
    for (const e of erwartet) assert(g.has(e), `„${text}“ lädt ${e} nicht (geladen: ${[...g].join(', ') || 'nichts'})`)
  }
  // Alltägliches bleibt beim Kern.
  for (const text of ['Was weißt du über Lipps?', 'Notier bei Simpfendörfer: hat angerufen', 'Leg ein To-do für Quirin an: Unterlagen anfordern']) {
    assertEquals([...waehleGruppen({ eingang: text, ...ohneVerlauf })], [], `„${text}“ sollte nur den Kern brauchen`)
  }
})

Deno.test('Gesprächszustand: Verlauf, offene Rückfragen und Datei-Eingänge', () => {
  // „ja, schick sie ab“ nach einem Mail-Entwurf: Werkzeug im Verlauf → Gruppe bleibt geladen.
  const verlaufMail = [
    { role: 'user', content: 'Schreib allen Interessenten von Remstal' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mail_vorbereiten', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Entwurf …' }] },
    { role: 'assistant', content: 'Soll ich sie so abschicken?' },
  ]
  assertEquals(benutzteWerkzeuge(verlaufMail), ['mail_vorbereiten'])
  assert(waehleGruppen({ eingang: 'ja', verlauf: verlaufMail, privatBot: false }).has('postfach'))
  assert(waehleGruppen({ eingang: 'ja', verlauf: [], privatBot: false, offen: { mail: true } }).has('postfach'))
  assert(waehleGruppen({ eingang: 'die linke bleibt', verlauf: [], privatBot: false, offen: { pflege: true } }).has('aktenpflege'))
  // Nachfrage nach einem Kundentermin steht als Text im Verlauf; die Antwort nennt kein Stichwort.
  const nachfrage = [{ role: 'assistant', content: 'Wie lief der Termin mit Herrn Lipps (Erstgespräch, 10:00)?' }]
  assert(waehleGruppen({ eingang: 'Gut, er will bis Freitag die Unterlagen schicken', verlauf: nachfrage, privatBot: false }).has('kalender'))
  // Datei-Eingang: Dateien und Objekte (Fotos können ins Objekt gehören), Rechnung per Stichwort.
  const eingang = '[Datei-Eingang per Telegram — Systemmeldung, nicht vom Mitarbeiter getippt]\nOriginaldatei: „IMG_1.jpg"\nBildunterschrift des Mitarbeiters: (keine)\n1. pfad=telegram/x.jpg | Rechnung erkannt'
  const g = waehleGruppen({ eingang, ...ohneVerlauf })
  for (const e of ['dateien', 'objekte', 'rechnungen'] as GruppenName[]) assert(g.has(e), `Datei-Eingang lädt ${e} nicht`)
})

Deno.test('Werkzeugliste: Kern, Ladewerkzeug mit Marke, Gruppen in fester Reihenfolge, gleiche Bytes', () => {
  const eingabe = { eingang: 'Rechnung für das Exposé Remstal', ...ohneVerlauf }
  const a = starteAuswahl(OHNE_PRIVAT, eingabe, true)
  const liste = a.werkzeuge()
  const lader = liste.findIndex((w) => w.name === LADE_WERKZEUG_NAME)
  assert(lader > 0)
  for (const w of liste.slice(0, lader)) assertEquals(gruppeVon(w.name), 'kern')
  for (const w of liste.slice(lader + 1)) assert(gruppeVon(w.name) !== 'kern')
  // Genau eine Marke, am Ladewerkzeug.
  // deno-lint-ignore no-explicit-any
  assertEquals(liste.filter((w: any) => w.cache_control).map((w) => w.name), [LADE_WERKZEUG_NAME])
  // Gruppen in GRUPPEN_REIHENFOLGE.
  const folge = [...new Set(liste.slice(lader + 1).map((w) => gruppeVon(w.name)))]
  assertEquals(folge, GRUPPEN_REIHENFOLGE.filter((g) => folge.includes(g)))
  // Gleiche Eingabe → gleiche Bytes (sonst trifft der Zwischenspeicher nie).
  assertEquals(JSON.stringify(starteAuswahl(OHNE_PRIVAT, eingabe, true).werkzeuge()), JSON.stringify(liste))
  // Die Liste aus index.ts bleibt unverändert (keine Marke hineingeschrieben).
  // deno-lint-ignore no-explicit-any
  assert(!OHNE_PRIVAT.some((w: any) => w.cache_control))
})

Deno.test('Nachladen und merke(): Gruppe kommt im nächsten Schritt dazu', () => {
  const a = starteAuswahl(OHNE_PRIVAT, { eingang: 'Hallo', ...ohneVerlauf }, true)
  assert(!namen(a.werkzeuge()).includes('buch_anlegen'))
  assertStringIncludes(a.lade({ gruppen: ['buecher'] }), 'Geladen: Bücher & Verlag')
  assert(namen(a.werkzeuge()).includes('buch_anlegen'))
  assertStringIncludes(a.lade({ gruppen: ['buecher'] }), 'Schon geladen')
  assertStringIncludes(a.lade({ gruppen: ['gibtsnicht'] }), 'Nicht verfügbar')
  assert(a.lade({}).startsWith('Fehler: '))
  assert(!namen(a.werkzeuge()).includes('rendite_rechnen'))
  a.merke('rendite_rechnen')
  assert(namen(a.werkzeuge()).includes('rendite_rechnen'))
  // Hotmail ohne Freischaltung gibt es nicht.
  assertStringIncludes(a.lade({ gruppen: ['hotmail'] }), 'Nicht verfügbar')
})

Deno.test('Abgeschaltet (TELEGRAM_WERKZEUGGRUPPEN=aus): alles wie vorher', () => {
  const a = starteAuswahl(VOLL, { eingang: 'Hallo', ...ohneVerlauf }, false)
  assertEquals(namen(a.werkzeuge()), namen(VOLL))
  assertEquals(a.hinweise(SYSTEM_PROMPT), SYSTEM_PROMPT)
})

Deno.test('Hinweistext: jede Zuordnung trifft genau einen Absatz, alles geladen = unverändert', () => {
  assert(SYSTEM_PROMPT.length > 10000, 'Hinweistext in index.ts nicht gefunden')
  const absaetze = zerlegeHinweise(SYSTEM_PROMPT)
  for (const [anfang] of ABSATZ_GRUPPE) {
    assertEquals(absaetze.filter((a) => a.text.startsWith(anfang)).length, 1, `Absatz „${anfang}“ gibt es nicht (mehr) genau einmal`)
  }
  assertEquals(absaetze.map((a) => a.text).join('\n'), SYSTEM_PROMPT)
  const alle = new Set(GRUPPEN_REIHENFOLGE)
  assertEquals(hinweiseFuer(SYSTEM_PROMPT, alle, alle), SYSTEM_PROMPT)
  const nurKern = hinweiseFuer(SYSTEM_PROMPT, new Set(), alle)
  assert(!nurKern.includes('- Bücher & Verlag:') && !nurKern.includes('- Fotos zu Objekten:'))
  for (const muss of ['So arbeitest du:', '- Dateien:', '  3. Betrifft die Datei', 'Ton und Form:', 'Weitere Werkzeuge:', '  buecher: ', LADE_WERKZEUG_NAME]) assertStringIncludes(nurKern, muss)
  // Jedes Werkzeug, das ein Kern-Absatz nennt, ist entweder im Kern oder steht in der Nachladeliste.
  for (const w of nurKern.match(/\b[a-z]+_[a-z_]+\b/g) ?? []) {
    if (gruppeVon(w) !== 'kern') assertStringIncludes(nurKern.split('Weitere Werkzeuge:')[1], w)
  }
})

Deno.test('Zwischenspeicher-Marke am letzten Nachrichtenblock, Zustand bleibt unberührt', () => {
  const verlauf: { role: string; content: unknown }[] = [
    { role: 'user', content: 'Hallo' },
    { role: 'assistant', content: 'Hallo!' },
    { role: 'user', content: 'Was weißt du über Lipps?' },
  ]
  const mit = mitNachrichtenCache(verlauf)
  assertEquals(mit.at(-1)!.content, [{ type: 'text', text: 'Was weißt du über Lipps?', cache_control: { type: 'ephemeral' } }])
  assertEquals(verlauf[2].content, 'Was weißt du über Lipps?')
  assertEquals(JSON.stringify(mit).split('cache_control').length - 1, 1)
  const ergebnisse: { role: string; content: unknown }[] = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }, { type: 'tool_result', tool_use_id: 'b', content: 'y' }] }]
  const m2 = mitNachrichtenCache(ergebnisse)
  // deno-lint-ignore no-explicit-any
  assertEquals((m2[0].content as any[]).map((b) => !!b.cache_control), [false, true])
  // deno-lint-ignore no-explicit-any
  assert(!(ergebnisse[0].content as any[])[1].cache_control)
  assertEquals(mitNachrichtenCache([]), [])
})

Deno.test('Umfang: ohne Gruppen höchstens die Hälfte von Werkzeugen und Hinweistext', () => {
  const voll = JSON.stringify(VOLL).length + SYSTEM_PROMPT.length
  const kern = starteAuswahl(VOLL, { eingang: 'Hallo', ...ohneVerlauf }, true)
  const k = JSON.stringify(kern.werkzeuge()).length + kern.hinweise(SYSTEM_PROMPT).length
  // Zeichen ÷ 2 ≈ Tokens (geeicht mit count_tokens am 22.11.2026: 177.515 Zeichen = 88.584 Tokens).
  console.log(`Werkzeuge + Hinweistext: alles ${voll} Zeichen (~${Math.round(voll / 2)} Tokens), nur Kern ${k} Zeichen (~${Math.round(k / 2)} Tokens)`)
  for (const g of GRUPPEN_REIHENFOLGE) {
    const a = starteAuswahl(VOLL, { eingang: 'Hallo', ...ohneVerlauf }, true)
    a.lade({ gruppen: [g] })
    const z = JSON.stringify(a.werkzeuge()).length + a.hinweise(SYSTEM_PROMPT).length
    console.log(`  + ${g}: ~${Math.round((z - k) / 2)} Tokens`)
  }
  assert(k < voll / 2, `Kern ist zu groß: ${k} von ${voll} Zeichen`)
})
