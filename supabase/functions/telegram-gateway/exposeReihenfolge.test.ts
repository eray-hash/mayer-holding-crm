// Exposé vom Assistenten (expose_erstellen) und die Foto-Reihenfolge aus objekte.bilder_reihenfolge:
// Titelbild = erstes Foto der Reihenfolge, „nicht im Exposé“ wird gar nicht erst geladen, ein gedrehtes Foto
// wird hochkant zugeschnitten (damit es nach dem Drehen das Feld füllt). Ohne Netz, mit der Testdatenbank.
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { decodeBase64 } from 'jsr:@std/encoding@1/base64'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehreExposeWerkzeugAus } from './exposeWerkzeuge.ts'

const JPG = decodeBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoADwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+hPPCrek/wDISi/H+RqpVvSf+QlF+P8AI1z4v/d5+j/I1ofxY+q/M6OiiiviD6YKKKKAMj+w/wDp5/8AHP8A69H9h/8ATz/45/8AXrXorv8A7Uxf8/4L/I5PqND+X8WZH9h/9PP/AI5/9eprTSvs1yk3n7tueNmO2PWtGipnmWJnFxlLR+S/yHHB0YtNR1XmwoooriOoKKKKACiiigAooooAKKKKACiiigD/2Q==')
const GF = { id: 'm_gf', name: 'Andreas Mayer', email: 'andreas@mayer.de', rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [] }

function aufbau(reihenfolge: unknown) {
  const foto = (id: string) => ({ id, name: `${id}.jpg`, typ: 'image/jpeg', datum: '2026-11-01', groesse: '1 KB', url: `o1/${id}.jpg` })
  const db = falscheDatenbank({
    objekte: [{ id: 'o1', bezeichnung: 'Remstal', adresse: 'Remsstraße 1, 73614 Schorndorf', typ: 'Gewerbe', kaufpreis: 1000000, privat_besitzer: null, dokumente: { Bilder: [foto('d3'), foto('d2'), foto('d1')] }, activities: [], bilder_reihenfolge: reihenfolge }],
    vorlagen: [],
    mitarbeiter: [{ id: 'm_gf', name: 'Andreas Mayer', email: 'andreas@mayer.de', telefon: '0731 1', aktiv: true }],
  })
  db.ablage.set('objekt-dokumente', new Map(['d1', 'd2', 'd3'].map((id) => [`o1/${id}.jpg`, { bytes: new Uint8Array(JPG), contentType: 'image/jpeg' }])))
  const geladen: { pfad: string; masse?: { width: number; height: number } }[] = []
  const supabase = {
    from: (t: string) => db.from(t),
    storage: {
      from: (eimer: string) => {
        const fach = db.storage.from(eimer)
        return {
          ...fach,
          download: (pfad: string, o?: { transform?: { width: number; height: number } }) => {
            if (o?.transform) geladen.push({ pfad, masse: { width: o.transform.width, height: o.transform.height } })
            return fach.download(pfad)
          },
        }
      },
    },
  }
  return { db, supabase, geladen }
}

Deno.test('expose_erstellen folgt der Foto-Reihenfolge: Titelbild, ohne „nicht im Exposé“, gedreht hochkant zugeschnitten', async () => {
  const { supabase, geladen } = aufbau([{ id: 'd2', drehung: 90 }, { id: 'd3', im_expose: false }])
  const r = await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o1' }, { supabase, mitarbeiter: GF, protokolliere: () => undefined, heute: '2026-11-22' })
  assertStringIncludes(r, '2 Bilder')
  assertEquals(geladen.map((g) => g.pfad), ['o1/d2.jpg', 'o1/d1.jpg'])
  assertEquals(geladen[0].masse, { width: 1067, height: 1600 })
  assertEquals(geladen[1].masse, { width: 1000, height: 750 })
})

Deno.test('expose_erstellen ohne festgelegte Reihenfolge: wie bisher die Reihenfolge des Ordners', async () => {
  const { supabase, geladen } = aufbau([])
  const r = await fuehreExposeWerkzeugAus('expose_erstellen', { objekt_id: 'o1', max_bilder: 2 }, { supabase, mitarbeiter: GF, protokolliere: () => undefined, heute: '2026-11-22' })
  assertStringIncludes(r, '2 Bilder')
  assertEquals(geladen.map((g) => g.pfad), ['o1/d3.jpg', 'o1/d2.jpg'])
  assertEquals(geladen[0].masse, { width: 1600, height: 1067 })
})
