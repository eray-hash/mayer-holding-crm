// Prüft link_oeffnen ohne Netz: Linkprüfung, Freigabe-Links, Weiterleitungen, Datei vs. Webseite.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { dateinameVon, direkterDownload, fuehreLinkWerkzeugAus, pruefeLink, textAusHtml } from './linkLesen.ts'

Deno.test('Linkprüfung: nur öffentliche https-Adressen', () => {
  assertEquals(pruefeLink('http://beispiel.de/a.pdf').ok, true)
  assertEquals(pruefeLink('beispiel.de/a.pdf').ok, true)
  assertEquals(pruefeLink('https://127.0.0.1/x').ok, false)
  assertEquals(pruefeLink('https://localhost/x').ok, false)
  assertEquals(pruefeLink('https://abc.supabase.co/storage').ok, false)
  assertEquals(pruefeLink('https://nutzer:pw@beispiel.de').ok, false)
  assertEquals(pruefeLink('ftp://beispiel.de/a').ok, false)
})

Deno.test('Freigabe-Links werden zum Download', () => {
  assertEquals(direkterDownload(new URL('https://drive.google.com/file/d/ABC123/view?usp=sharing')).toString(), 'https://drive.google.com/uc?export=download&id=ABC123')
  assertEquals(direkterDownload(new URL('https://docs.google.com/document/d/XYZ/edit')).toString(), 'https://docs.google.com/document/d/XYZ/export?format=docx')
  assertMatch(direkterDownload(new URL('https://www.dropbox.com/s/k/a.pdf?dl=0')).toString(), /dl=1/)
})

Deno.test('Dateiname aus Kopf, Adresse oder Art', () => {
  assertEquals(dateinameVon('https://x.de/d', 'attachment; filename="Bewertung Lorch.docx"', 'application/octet-stream'), 'Bewertung Lorch.docx')
  assertEquals(dateinameVon('https://x.de/d', "attachment; filename*=UTF-8''Gr%C3%BCndung.pdf", 'application/pdf'), 'Gründung.pdf')
  assertEquals(dateinameVon('https://x.de/pfad/Expose.pdf', null, 'application/pdf'), 'Expose.pdf')
  assertEquals(dateinameVon('https://x.de/download', null, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'Datei.docx')
})

Deno.test('Text aus HTML ohne Skripte', () => {
  const r = textAusHtml('<html><head><title>Lorch &amp; Remstal</title><script>x()</script></head><body><nav>Menü</nav><p>Erster Absatz</p><p>Zweiter</p></body></html>')
  assertEquals(r.titel, 'Lorch & Remstal')
  assert(r.text.includes('Erster Absatz') && !r.text.includes('x()') && !r.text.includes('Menü'))
})

function antwortMit(body: string | Uint8Array, kopf: Record<string, string>, status = 200): Response {
  return new Response(body as BodyInit, { status, headers: kopf })
}

Deno.test('Datei wird gespeichert und liefert pfad', async () => {
  const gespeichert: string[] = []
  const r = await fuehreLinkWerkzeugAus('link_oeffnen', { url: 'https://beispiel.de/datei' }, {
    protokolliere: () => {},
    speichere: (b, n, t) => (gespeichert.push(`${n}|${t}|${b.length}`), Promise.resolve('telegram/1_hab_Bewertung.docx')),
    abruf: () => Promise.resolve(antwortMit(new Uint8Array([1, 2, 3]), { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-disposition': 'attachment; filename="Bewertung.docx"' })),
  })
  assertMatch(r, /pfad=telegram\/1_hab_Bewertung\.docx/)
  assertEquals(gespeichert, ['Bewertung.docx|application/vnd.openxmlformats-officedocument.wordprocessingml.document|3'])
})

Deno.test('Weiterleitung auf Anmeldeseite wird erkannt', async () => {
  let n = 0
  const r = await fuehreLinkWerkzeugAus('link_oeffnen', { url: 'https://lens.usercontent.google.com/banana?x=1' }, {
    protokolliere: () => {},
    speichere: () => Promise.resolve(null),
    abruf: () => Promise.resolve(n++ === 0 ? antwortMit('', { location: 'https://accounts.google.com/ServiceLogin?continue=x' }, 302) : antwortMit('nie', {})),
  })
  assertMatch(r, /^Fehler: .*Anmeldeseite.*direkt/)
})

Deno.test('Weiterleitung auf interne Adresse wird abgelehnt', async () => {
  const r = await fuehreLinkWerkzeugAus('link_oeffnen', { url: 'https://beispiel.de/a' }, {
    protokolliere: () => {},
    speichere: () => Promise.resolve(null),
    abruf: () => Promise.resolve(antwortMit('', { location: 'https://10.0.0.1/geheim' }, 302)),
  })
  assertMatch(r, /^Fehler: /)
})

Deno.test('Webseite liefert Text, 403 liefert verständlichen Fehler', async () => {
  const seite = await fuehreLinkWerkzeugAus('link_oeffnen', { url: 'https://beispiel.de/' }, {
    protokolliere: () => {},
    speichere: () => Promise.resolve(null),
    abruf: () => Promise.resolve(antwortMit(`<title>Boardinghouse</title><p>${'Ein langer Text über das Haus. '.repeat(5)}</p>`, { 'content-type': 'text/html; charset=utf-8' })),
  })
  assertMatch(seite, /^Webseite „Boardinghouse“/)
  const zu = await fuehreLinkWerkzeugAus('link_oeffnen', { url: 'https://beispiel.de/x' }, {
    protokolliere: () => {},
    speichere: () => Promise.resolve(null),
    abruf: () => Promise.resolve(antwortMit('nein', {}, 403)),
  })
  assertMatch(zu, /nicht öffentlich oder abgelaufen/)
})
