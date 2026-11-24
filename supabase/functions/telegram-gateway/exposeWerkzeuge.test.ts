// Prüft expose_erstellen und dokument_erstellen/tabelle_erstellen mit objekt_id an einer nachgebauten
// Datenbank und Ablage (ohne Netz): Ablage im Ordner der Objektakte, nur Dokumente/Verlauf geschrieben,
// Freigabe fürs Interessenten-Portal, Rechte, Vermittler-Kasten, keine Eigentümerdaten im PDF, Bilder
// mit und ohne Bildbearbeitung des Speichers, gedrehte Fotos.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { decodeBase64 } from 'jsr:@std/encoding@1/base64'
import { fuehreDokumentWerkzeugAus } from './dokumentErstellen.ts'
import { falscheHoldingVorlage } from './holdingVorlageTestDoppel.ts'
import { erstelleExposePdf } from './exposePdf.ts'
import { exposeFakten, type ExposeKontext, fuehreExposeWerkzeugAus, istExposeWerkzeug, objektSpeicherOrt, ortVon } from './exposeWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

const JPG = decodeBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+hPPCrek/wDISi/H+RqpVvSf+QlF+P8AI1z4v/d5+j/I1ofxY+q/M6OiiiviD6YKKKKAMj+w/wDp5/8AHP8A69H9h/8ATz/45/8AXrXorv8A7Uxf8/4L/I5PqND+X8WZH9h/9PP/AI5/9eprTSvs1yk3n7tueNmO2PWtGipnmWJnFxlLR+S/yHHB0YtNR1XmwoooriOoKKKKACiiigAooooAKKKKACiiigD/2Q==')
const JPG6 = decodeBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+hPPCrek/wDISi/H+RqpVvSf+QlF+P8AI1z4v/d5+j/I1ofxY+q/M6OiiiviD6YKKKKAMj+w/wDp5/8AHP8A69H9h/8ATz/45/8AXrXorv8A7Uxf8/4L/I5PqND+X8WZH9h/9PP/AI5/9eprTSvs1yk3n7tueNmO2PWtGipnmWJnFxlLR+S/yHHB0YtNR1XmwoooriOoKKKKACiiigAooooAKKKKACiiigD/2Q==')
const PNG = decodeBase64('iVBORw0KGgoAAAANSUhEUgAAAB4AAAAKCAYAAACjd+4vAAAAJklEQVR4nGNkYGD4zzAAgGkgLAWBUYvpBpjoZxUqGLWYbmDALAYA5YQBE0qe3sYAAAAASUVORK5CYII=')

/** Nachbildung des Supabase-Clients für genau die Aufrufketten dieser Werkzeuge. */
function falscheDb(tabellen: Record<string, Zeile[]>, dateien: Record<string, Uint8Array>, o: { ohneBildbearbeitung?: boolean } = {}) {
  const geschrieben: { tabelle: string; werte: Zeile; id?: string }[] = []
  const hochgeladen: { eimer: string; pfad: string; typ: string; bytes: Uint8Array }[] = []
  const bearbeitet: string[] = []
  function abfrage(tabelle: string) {
    const filter: ((z: Zeile) => boolean)[] = []
    let werte: Zeile | null = null
    const lauf = () => {
      const treffer = (tabellen[tabelle] ?? []).filter((z) => filter.every((f) => f(z)))
      if (werte) {
        for (const z of treffer) Object.assign(z, structuredClone(werte))
        geschrieben.push({ tabelle, werte: structuredClone(werte), id: treffer[0]?.id })
        return { data: null, error: null }
      }
      return { data: structuredClone(treffer), error: null }
    }
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => b,
      // deno-lint-ignore no-explicit-any
      eq: (k: string, v: any) => (filter.push((z) => z[k] === v), b),
      // deno-lint-ignore no-explicit-any
      not: (k: string, _op: string, _v: any) => (filter.push((z) => z[k] !== null && z[k] !== undefined), b),
      order: () => b,
      maybeSingle: () => Promise.resolve({ data: lauf().data?.[0] ?? null, error: null }),
      update: (w: Zeile) => ((werte = w), b),
      // deno-lint-ignore no-explicit-any
      then: (a: any, c: any) => Promise.resolve(lauf()).then(a, c),
    }
    return b
  }
  const supabase = {
    from: (t: string) => abfrage(t),
    storage: {
      from: (eimer: string) => ({
        // deno-lint-ignore no-explicit-any
        download: (pfad: string, opt?: { transform?: any }) => {
          const d = dateien[`${eimer}/${pfad}`]
          if (opt?.transform) {
            if (o.ohneBildbearbeitung) return Promise.resolve({ data: null, error: { message: 'Image transformation is not enabled' } })
            bearbeitet.push(`${eimer}/${pfad}`)
          }
          return Promise.resolve(d ? { data: new Blob([d as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } })
        },
        upload: (pfad: string, bytes: Uint8Array, opt: { contentType?: string }) => {
          hochgeladen.push({ eimer, pfad, typ: opt?.contentType ?? '', bytes })
          dateien[`${eimer}/${pfad}`] = bytes
          return Promise.resolve({ data: { path: pfad }, error: null })
        },
        remove: () => Promise.resolve({ data: null, error: null }),
      }),
    },
  }
  return { supabase, geschrieben, hochgeladen, bearbeitet, tabellen }
}

const GF = { id: 'm_gf', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }
const BERATER = { id: 'm_bea', name: 'Bea Berater', email: 'bea@mayer.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'] }

function kontext(db: ReturnType<typeof falscheDb>, mitarbeiter: ExposeKontext['mitarbeiter']): ExposeKontext & { protokoll: string[] } {
  const protokoll: string[] = []
  return { supabase: db.supabase, mitarbeiter, protokolliere: (t) => protokoll.push(t), heute: '2026-11-22', protokoll }
}

function stand(): Record<string, Zeile[]> {
  return {
    objekte: [
      {
        id: 'o_rems', bezeichnung: 'Boarding House Remstal', adresse: 'Teckstraße 62, 73547 Lorch-Weitmars', typ: 'Gewerbe', kaufpreis: 1200000,
        expose_text: '## Lage\nRuhige Lage im Remstal.\n\n- 12 Apartments\n- voll vermietet', off_market: false, privat_besitzer: null,
        eigentuemer: { name: 'Erwin Geheimbauer', telefon: '0711 1', email: 'e@g.de' },
        verkaufsdaten: { kennzahlen: { baujahr: '1994', wohnflaeche: '640', einheiten: '12', jahresnettokaltmiete: 96000, kaufpreisvorstellung: 1500000 }, uebersicht: { objektart: 'Boarding House', strasse: 'Teckstraße 62', plzOrt: '73547 Lorch-Weitmars' }, auftraggeber: { name: 'Erwin Geheimbauer' } },
        activities: [{ id: 'a0', date: '2026-11-22', text: 'Objekt angelegt', user: 'Andreas Mayer' }],
        interessenten_dokumente: ['d_alt'],
        dokumente: {
          'Exposé': [{ id: 'd_alt', name: 'Exposé.pdf', typ: 'application/pdf', datum: '2026-11-20', groesse: '1 MB', url: 'o_rems/d_alt_Expose.pdf' }],
          Bilder: [
            { id: 'b1', name: 'Front.jpg', typ: 'image/jpeg', datum: '2026-11-22', groesse: '1 KB', url: 'o_rems/b1_Front.jpg' },
            { id: 'b2', name: 'Zimmer.jpg', typ: 'image/jpeg', datum: '2026-11-22', groesse: '1 KB', url: 'o_rems/b2_Zimmer.jpg' },
            { id: 'b3', name: 'Plan.png', typ: 'image/png', datum: '2026-11-22', groesse: '1 KB', url: 'o_rems/b3_Plan.png' },
            { id: 'b4', name: 'Handy.heic', typ: 'image/heic', datum: '2026-11-22', groesse: '1 KB', url: 'o_rems/b4_Handy.heic' },
            { id: 'b5', name: 'Grundriss.pdf', typ: 'application/pdf', datum: '2026-11-22', groesse: '1 KB', url: 'o_rems/b5_Grundriss.pdf' },
          ],
        },
      },
      { id: 'o_privat', bezeichnung: 'Villa Carl', adresse: 'Seeweg 1, 89073 Ulm', typ: 'Haus', kaufpreis: 0, privat_besitzer: 'carl@mayer.de', dokumente: {}, activities: [] },
    ],
    mitarbeiter: [
      { id: 'm_gf', name: 'Andreas Mayer', email: 'andreas@mayer.de', telefon: '0731 123456', aktiv: true },
      { id: 'm_ql', name: 'Quirin Lutzenberger', email: 'quirin@mayer.de', telefon: '0731 999', aktiv: true },
    ],
    vorlagen: [
      { id: 'briefkopf', bereich: 'beratung', text: JSON.stringify({ name: 'Andreas Mayer Holding', unterzeilen: [], fusszeilen: [] }), datei: null },
      { id: 'v_logo', bereich: 'immobilien', name: 'Logo Andreas Mayer Holding', text: '', datei: { name: 'Logo.png', typ: 'image/png', pfad: 'vorlagen/immobilien/v_logo_Logo.png' } },
      { id: 'v_ql_8c0d7da428d', bereich: 'immobilien', name: 'Briefbogen Holding', text: '', datei: { name: 'Briefbogen.docx', typ: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pfad: 'vorlagen/immobilien/v_briefbogen.docx' } },
    ],
    kunden: [{ id: 'k_dick', bereich: 'immobilienkunden', firma: 'HD-IMMO', ansprechpartner: 'Helmut Dick', verantwortlich_email: null, activities: [], dokumente: [] }],
    briefboegen: [],
  }
}

function dateien(): Record<string, Uint8Array> {
  return {
    'objekt-dokumente/o_rems/b1_Front.jpg': JPG,
    'objekt-dokumente/o_rems/b2_Zimmer.jpg': JPG6,
    'objekt-dokumente/o_rems/b3_Plan.png': PNG,
    'objekt-dokumente/o_rems/b4_Handy.heic': new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]),
    'kunden-dokumente/vorlagen/immobilien/v_logo_Logo.png': PNG,
    'kunden-dokumente/vorlagen/immobilien/v_briefbogen.docx': falscheHoldingVorlage(),
  }
}

/** Texte im PDF: pdf-lib packt die Seiteninhalte (Deflate) und schreibt Text als Hex-Zeichenketten <...> in WinAnsi. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const roh = new TextDecoder('latin1').decode(bytes)
  const teile: string[] = []
  for (const m of roh.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    // Je Byte ein Zeichen: die Stelle im Text ist die Stelle in den Bytes (die Zeichen selbst nicht, siehe windows-1252).
    const start = m.index! + m[0].indexOf(m[1])
    const daten = bytes.slice(start, start + m[1].length)
    let inhalt = ''
    try {
      inhalt = new TextDecoder('latin1').decode(await new Response(new Blob([daten]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
    } catch {
      continue
    }
    for (const t of inhalt.matchAll(/<([0-9A-Fa-f]{2,})>\s*Tj/g)) teile.push(new TextDecoder('windows-1252').decode(new Uint8Array(t[1].match(/../g)!.map((h) => parseInt(h, 16)))))
  }
  return teile.join(' ')
}

Deno.test('Werkzeugname und Hilfen', () => {
  assert(istExposeWerkzeug('expose_erstellen') && !istExposeWerkzeug('dokument_erstellen'))
  assertEquals(objektSpeicherOrt('o_rems/b1_Front.jpg'), { eimer: 'objekt-dokumente', pfad: 'o_rems/b1_Front.jpg' })
  assertEquals(objektSpeicherOrt('../../rest/v1/mitarbeiter'), null)
  const o = stand().objekte[0] as Zeile & { id: string }
  assertEquals(ortVon(o), 'Lorch-Weitmars')
  const fakten = exposeFakten(o, [{ label: 'Wohnfläche', wert: 'ca. 650 m²' }, { label: 'Kaufpreis', wert: '1 €' }, { label: 'Zustand', wert: 'gepflegt' }], '3,57 % inkl. MwSt.')
  assertEquals(fakten.find((f) => f.label === 'Wohnfläche')?.wert, 'ca. 650 m²')
  assertEquals(fakten.at(-1), { label: 'Kaufpreis', wert: '1.200.000 €' })
  assertEquals(fakten.at(-2), { label: 'Käuferprovision', wert: '3,57 % inkl. MwSt.' })
  assert(fakten.some((f) => f.label === 'Zustand'))
  assertEquals(fakten.find((f) => f.label === 'Kaufpreis-Faktor')?.wert, '12,5-fach')
  // Kaufpreisvorstellung (Bewertung) kommt nie hinein.
  assert(!fakten.some((f) => f.wert.includes('1.500.000')))
})

Deno.test('expose_erstellen: Objektakte, Ordner Exposé, Portal, Vermittler, ohne Eigentümer', async () => {
  const db = falscheDb(stand(), dateien())
  const k = kontext(db, GF)
  const r = await fuehreExposeWerkzeugAus('expose_erstellen', {
    objekt_id: 'o_rems', provision: '3,57 % inkl. MwSt.', portal_freigeben: true,
    vermittler: { name: 'Helmut Dick', firma: 'HD-IMMO', telefon: '0171 555', email: 'dick@hd-immo.de' },
  }, k)
  assertMatch(r, /^Exposé erstellt und in der Objektakte „Boarding House Remstal“/)
  assertStringIncludes(r, 'Für das Interessenten-Portal freigegeben.')
  assertStringIncludes(r, 'Nicht ins Exposé gekommen (Format oder Größe): Handy.heic')
  assertStringIncludes(r, '3 Bilder')
  const id = r.match(/dokument_id=(dok_[0-9a-f]{12})/)![1]

  // Hochgeladen in den Objekt-Speicher unter der objekt_id.
  assertEquals(db.hochgeladen.length, 1)
  assertEquals(db.hochgeladen[0].eimer, 'objekt-dokumente')
  assertMatch(db.hochgeladen[0].pfad, new RegExp(`^o_rems/${id}_Expose_Boarding_House_in_Lorch-Weitmars_22.11.2026_.pdf$`))
  const pdf = db.hochgeladen[0].bytes
  assertEquals(new TextDecoder().decode(pdf.slice(0, 5)), '%PDF-')

  // Nur dokumente/activities/updated_at und danach interessenten_dokumente geschrieben.
  assertEquals(db.geschrieben.map((g) => Object.keys(g.werte).sort().join(',')), ['activities,dokumente,updated_at', 'interessenten_dokumente'])
  const o = db.tabellen.objekte[0]
  assertEquals(o.dokumente['Exposé'][0].id, id)
  assertEquals(o.dokumente['Exposé'][0].quelle, 'assistent')
  assertEquals(o.dokumente['Exposé'][1].id, 'd_alt')
  assertEquals(o.dokumente.Bilder.length, 5)
  assertEquals(o.interessenten_dokumente, ['d_alt', id])
  assertMatch(o.activities[0].text, /^Exposé „Exposé Boarding House in Lorch-Weitmars \(22\.11\.2026\)\.pdf“ \(PDF, \d Seiten/)
  assertEquals(k.protokoll.length, 2)

  // Inhalt: Kontakt aus dem CRM, Vermittler, Provision, Adresse — nie der Eigentümer oder die Kaufpreisvorstellung.
  const t = await pdfText(pdf)
  for (const s of ['Ihr Ansprechpartner', 'Andreas Mayer', '0731 123456', 'Vermittler', 'Helmut Dick', 'HD-IMMO', 'dick@hd-immo.de', 'Käuferprovision', 'Teckstraße 62', 'Ruhige Lage im Remstal.', '1.200.000', 'Boarding House']) assertStringIncludes(t, s)
  assert(!t.includes('Geheimbauer'), 'Eigentümer im PDF')
  assert(!t.includes('1.500.000'), 'Kaufpreisvorstellung im PDF')
  // Bilder über die Bildbearbeitung geholt, das Logo ebenfalls.
  assert(db.bearbeitet.includes('objekt-dokumente/o_rems/b1_Front.jpg'))
  assert(db.bearbeitet.includes('kunden-dokumente/vorlagen/immobilien/v_logo_Logo.png'))
})

Deno.test('expose_erstellen: anonym, Kollege als Ansprechpartner, ohne Bildbearbeitung, Warnung bei Eigentümername', async () => {
  const db = falscheDb(stand(), dateien(), { ohneBildbearbeitung: true })
  const r = await fuehreExposeWerkzeugAus('expose_erstellen', {
    objekt_id: 'o_rems', adresse_zeigen: false, ansprechpartner: 'Quirin', beschreibung: 'Angeboten von Herrn Geheimbauer in der Teckstraße.', max_bilder: 1,
  }, kontext(db, GF))
  assertStringIncludes(r, 'Ihr Ansprechpartner Quirin Lutzenberger')
  assertStringIncludes(r, 'nur Ort (Lorch-Weitmars)')
  assertStringIncludes(r, '1 Bild)')
  assertStringIncludes(r, 'Achtung, im Text steht: Name des Eigentümers („Geheimbauer“), Straße („Teckstraße“)')
  assert(!r.includes('Interessenten-Portal'))
  const t = await pdfText(db.hochgeladen[0].bytes)
  assertStringIncludes(t, '0731 999')
  assert(!t.includes('Teckstraße 62'))
  assertEquals(db.tabellen.objekte[0].interessenten_dokumente, ['d_alt'])
})

Deno.test('expose_erstellen: Rechte und Fehler', async () => {
  const db = falscheDb(stand(), dateien())
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_rems' }, kontext(db, BERATER)), /^Nicht freigegeben: Der Bereich Immobilien/)
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_privat' }, kontext(db, GF)), /^Fehler: Es gibt kein Objekt/)
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_gibtsnicht' }, kontext(db, GF)), /^Fehler: Es gibt kein Objekt/)
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', {}, kontext(db, GF)), /^Fehler: objekt_id fehlt/)
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_rems', ansprechpartner: 'Niemand' }, kontext(db, GF)), /^Fehler: Einen aktiven Mitarbeiter „Niemand“/)
  assertMatch(await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_rems', ohne_ansprechpartner: true }, kontext(db, GF)), /^Fehler: Ohne Ansprechpartner/)
  assertEquals(db.hochgeladen.length, 0)
  assertEquals(db.geschrieben.length, 0)
})

Deno.test('expose_erstellen: nur Vermittler, Objekt ohne Text und Bilder', async () => {
  const s = stand()
  s.objekte[0].expose_text = null
  s.objekte[0].dokumente = {}
  s.objekte[0].verkaufsdaten = null
  const db = falscheDb(s, dateien())
  const r = await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o_rems', ohne_ansprechpartner: true, vermittler: { name: 'Helmut Dick', telefon: '0171 555' } }, kontext(db, GF))
  assertStringIncludes(r, 'Ansprechpartner: Vermittler Helmut Dick.')
  assertStringIncludes(r, 'Ohne Beschreibung')
  assertStringIncludes(r, 'Ohne Bilder')
  assertEquals(db.tabellen.objekte[0].dokumente['Exposé'].length, 1)
})

Deno.test('dokument_erstellen mit objekt_id: Ordner Exposé bzw. Sonstiges, falscher Ordner', async () => {
  const db = falscheDb(stand(), dateien())
  const k = kontext(db, GF)
  const r1 = await fuehreDokumentWerkzeugAus('dokument_erstellen', { objekt_id: 'o_rems', titel: 'Exposé Boarding House Remstal', inhalt: '## Lage\nRemstal' }, k)
  assertMatch(r1, /^Erstellt und abgelegt: „Exposé Boarding House Remstal \(22\.11\.2026\)\.pdf" \(PDF, 1 Seite, .*\) in der Objektakte „Boarding House Remstal“ \(Teckstraße 62, 73547 Lorch-Weitmars\) im Ordner Exposé\./)
  assertMatch(r1, /objekt_id=o_rems, dokument_id=dok_[0-9a-f]{12}$/)
  const r2 = await fuehreDokumentWerkzeugAus('dokument_erstellen', { objekt_id: 'o_rems', titel: 'Notiz Besichtigung', inhalt: 'Text', format: 'word' }, k)
  assertStringIncludes(r2, 'im Ordner Sonstiges')
  const r3 = await fuehreDokumentWerkzeugAus('dokument_erstellen', { objekt_id: 'o_rems', titel: 'Protokoll', inhalt: 'Text', ordner: 'protokolle' }, k)
  assertStringIncludes(r3, 'im Ordner Protokolle')
  assertMatch(await fuehreDokumentWerkzeugAus('dokument_erstellen', { objekt_id: 'o_rems', titel: 'X', inhalt: 'Text', ordner: 'Keller' }, k), /^Fehler: Den Ordner „Keller“ gibt es in der Objektakte nicht/)
  assertMatch(await fuehreDokumentWerkzeugAus('dokument_erstellen', { titel: 'X', inhalt: 'Text' }, k), /^Fehler: kunde_id oder objekt_id fehlt/)
  assertMatch(await fuehreDokumentWerkzeugAus('dokument_erstellen', { objekt_id: 'o_rems', titel: 'X', inhalt: 'Text' }, kontext(db, BERATER)), /^Nicht freigegeben/)
  const o = db.tabellen.objekte[0]
  assertEquals(o.dokumente['Exposé'].length, 2)
  assertEquals(o.dokumente.Sonstiges[0].typ, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assertEquals(o.dokumente.Protokolle.length, 1)
  assert(db.hochgeladen.every((h) => h.eimer === 'objekt-dokumente' && h.pfad.startsWith('o_rems/')))
  // Kundenakten gehen weiter wie bisher.
  const r4 = await fuehreDokumentWerkzeugAus('dokument_erstellen', { kunde_id: 'k_dick', titel: 'Merkblatt', inhalt: 'Text' }, k)
  assertStringIncludes(r4, 'in der Akte von HD-IMMO (Helmut Dick) unter Dokumente')
  assertEquals(db.tabellen.kunden[0].dokumente.length, 1)
})

Deno.test('tabelle_erstellen mit objekt_id', async () => {
  const db = falscheDb(stand(), dateien())
  const r = await fuehreDokumentWerkzeugAus('tabelle_erstellen', { objekt_id: 'o_rems', ordner: 'Mieterliste', titel: 'Mieterliste Remstal', blaetter: [{ spalten: ['Einheit', 'Miete'], zeilen: [['A1', 650]] }] }, kontext(db, GF))
  assertStringIncludes(r, 'im Ordner Mieterliste')
  assertEquals(db.tabellen.objekte[0].dokumente.Mieterliste.length, 1)
})

Deno.test('Exposé-PDF: gedrehtes Foto, PNG, langer Text, kaputtes Bild', async () => {
  const r = await erstelleExposePdf({
    titel: 'Sehr langer Titel '.repeat(8), ortZeile: 'Ulm', objektart: 'Haus', preisText: 'Preis auf Anfrage',
    fakten: [{ label: 'Wohnfläche', wert: '120 m²' }, { label: 'Kaufpreis', wert: 'Preis auf Anfrage' }],
    beschreibung: ('Ein Absatz mit Text und Sonderzeichen → ✓ 😀. '.repeat(40) + '\n\n').repeat(6) + '| a | b |\n| 1 | 2 |\n---\n1. erster Punkt',
    titelbild: { bytes: JPG6 }, bilder: [{ bytes: JPG }, { bytes: PNG }, { bytes: new Uint8Array([1, 2, 3]) }],
    firma: 'Andreas Mayer Holding', kontakte: [{ titel: 'Ihr Ansprechpartner', name: 'Andreas Mayer', telefon: '0731', email: 'a@b.de', firma: 'Andreas Mayer Holding' }],
    vertraulich: true, stand: '22.11.2026',
  })
  assert(r.seiten >= 3)
  assertEquals(r.bilderImPdf, 3)
  assertEquals(r.nichtLesbar, 1)
  assertStringIncludes(await pdfText(r.bytes), 'Vertrauliches Angebot')
})
