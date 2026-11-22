import { assert, assertEquals } from 'jsr:@std/assert@1'
import { eingabeAusZeile, fehlendKurz, hatPlz, istUnvollstaendig, phaseVon, pruefeVollstaendigkeit, type VollstaendigkeitEingabe } from './objektVollstaendigkeit.ts'

const bild = (i: number) => ({ id: `dok_b${i}`, name: `foto${i}.jpg`, typ: 'image/jpeg', datum: '2026-11-20', groesse: '1 MB', url: `o1/dok_b${i}_foto.jpg` })

/** Ein Objekt, dem in der Vermarktung nichts fehlt. */
function vollstaendig(): VollstaendigkeitEingabe {
  return {
    status: 'vermarktung',
    typ: 'Haus',
    kaufpreis: 850000,
    adresse: 'Teckstraße 62, 73547 Lorch',
    verantwortlich: 'Quirin Lutzenberger',
    eigentuemer: { name: 'Erika Muster', telefon: '0711 123', email: '' },
    verkaufsdaten: { kennzahlen: { wohnflaeche: '240', zimmer: '9' }, uebersicht: { objektart: 'Mehrfamilienhaus', strasse: '', plzOrt: '' }, auftraggeber: {} },
    dokumente: {
      Bilder: [1, 2, 3, 4, 5].map(bild),
      'Exposé': [{ id: 'dok_ex', name: 'Expose.pdf', typ: 'application/pdf' }],
      Energieausweis: [{ id: 'dok_en', name: 'Energieausweis.pdf', typ: 'application/pdf' }],
      Grundbuch: [{ id: 'dok_gb', name: 'Grundbuch.pdf', typ: 'application/pdf' }],
    },
    bilderReihenfolge: [{ id: 'dok_b3' }, { id: 'dok_b1' }],
    exposeText: 'Gepflegtes Mehrfamilienhaus mit neun Zimmern in ruhiger Lage von Lorch, voll vermietet, mit Garten und Stellplätzen.',
    anfrageKennungen: ['169235244'],
    interessentenDokumente: ['dok_ex'],
  }
}

Deno.test('vollständiges Objekt in der Vermarktung: 100 %, nichts fehlt', () => {
  const v = pruefeVollstaendigkeit(vollstaendig())
  assertEquals(v.phase, 'vermarktung')
  assertEquals(v.prozent, 100)
  assertEquals(v.fehlend, [])
  assertEquals(istUnvollstaendig(v), false)
  assertEquals(v.punkte.length, 14)
})

Deno.test('leeres Objekt in der Akquise braucht weniger als in der Vermarktung', () => {
  const leer: VollstaendigkeitEingabe = { status: 'akquise', typ: 'Haus', kaufpreis: 0, adresse: 'Geislingen', verantwortlich: 'Quirin Lutzenberger', dokumente: {} }
  const akquise = pruefeVollstaendigkeit(leer)
  const vermarktung = pruefeVollstaendigkeit({ ...leer, status: 'vermarktung' })
  // Akquise: keine Fotos, kein Exposé, kein Inserat
  const schluesselAkquise = akquise.punkte.map((p) => p.schluessel)
  assert(!schluesselAkquise.includes('fotos'))
  assert(!schluesselAkquise.includes('inserat'))
  assert(!schluesselAkquise.includes('exposePdf'))
  assert(vermarktung.punkte.map((p) => p.schluessel).includes('inserat'))
  // Verantwortlicher ist da, alles andere fehlt
  assertEquals(akquise.prozent, Math.round((2 / (3 + 2 + 1 + 1 + 2 + 2 + 1)) * 100))
  // wichtigste zuerst
  assertEquals(akquise.fehlend[0].schluessel, 'kaufpreis')
  assertEquals(akquise.fehlend[0].reiter, 'verkaufsdaten')
  assert(akquise.fehlend.every((p) => p.hinweis.length > 10 && p.assistent.length > 5))
})

Deno.test('Archiv, verkauft und abgebrochen werden nicht bewertet', () => {
  for (const status of ['archiv', 'verkauft', 'abgebrochen']) {
    const v = pruefeVollstaendigkeit({ ...vollstaendig(), status, kaufpreis: 0 })
    assertEquals(v.gilt, false)
    assertEquals(v.prozent, null)
    assertEquals(istUnvollstaendig(v), false)
  }
  assertEquals(phaseVon('on_hold'), 'akquise')
  assertEquals(phaseVon('reserviert'), 'verkauf')
  assertEquals(phaseVon('unbekannt'), 'akquise')
})

Deno.test('Fotos: weniger als fünf, PDFs im Ordner Bilder zählen nicht, Titelbild nur mit vorhandenem Foto', () => {
  const e = vollstaendig()
  e.dokumente = { ...(e.dokumente as Record<string, unknown>), Bilder: [bild(1), bild(2), { id: 'dok_p', name: 'Plan.pdf', typ: 'application/pdf' }] }
  e.bilderReihenfolge = [{ id: 'dok_weg' }]
  const v = pruefeVollstaendigkeit(e)
  const fotos = v.fehlend.find((p) => p.schluessel === 'fotos')!
  assertEquals(fotos.detail, '2 von 5 Fotos')
  assertEquals(fotos.ordner, 'Bilder')
  assert(v.fehlend.some((p) => p.schluessel === 'titelbild'))
  assert(fehlendKurz(v).includes('Fotos (2 von 5 Fotos)'))
})

Deno.test('Kaufpreis aus dem Verkaufsdatenblatt und Adresse aus der Übersicht zählen', () => {
  const e = vollstaendig()
  e.kaufpreis = '0'
  e.adresse = 'Lorch'
  e.verkaufsdaten = { kennzahlen: { wohnflaeche: '240', kaufpreisvorstellung: 900000 }, uebersicht: { objektart: 'Mehrfamilienhaus', strasse: 'Teckstraße 62', plzOrt: '73547 Lorch' } }
  const v = pruefeVollstaendigkeit(e)
  assertEquals(v.fehlend.map((p) => p.schluessel), [])
  e.verkaufsdaten = {}
  const ohne = pruefeVollstaendigkeit(e)
  assertEquals(ohne.fehlend.find((p) => p.schluessel === 'adresse')?.detail, 'Straße oder PLZ fehlt')
  assert(ohne.fehlend.some((p) => p.schluessel === 'kaufpreis'))
})

Deno.test('Grundstück ohne Energieausweis, Wohnung braucht Zimmer, Off-Market ohne Inserat, privat ohne Portal', () => {
  const g = pruefeVollstaendigkeit({ ...vollstaendig(), typ: 'Grundstück', verkaufsdaten: { kennzahlen: { grundstuecksflaeche: '800' } } })
  assert(!g.punkte.some((p) => p.schluessel === 'energieausweis'))
  assert(!g.fehlend.some((p) => p.schluessel === 'flaeche' || p.schluessel === 'objektart'))

  const w = pruefeVollstaendigkeit({ ...vollstaendig(), typ: 'Wohnung', verkaufsdaten: { kennzahlen: { wohnflaeche: '80' } } })
  assertEquals(w.fehlend.find((p) => p.schluessel === 'flaeche')?.detail, 'Zimmerzahl fehlt')

  const off = pruefeVollstaendigkeit({ ...vollstaendig(), offMarket: true, anfrageKennungen: [] })
  assert(!off.punkte.some((p) => p.schluessel === 'inserat'))
  assertEquals(off.prozent, 100)

  const privat = pruefeVollstaendigkeit({ ...vollstaendig(), privat: true, anfrageKennungen: null, interessentenDokumente: null })
  assert(!privat.punkte.some((p) => p.schluessel === 'portal' || p.schluessel === 'inserat'))
})

Deno.test('Portal: freigegebene Kennungen zählen nur, wenn das Dokument noch existiert', () => {
  const v = pruefeVollstaendigkeit({ ...vollstaendig(), interessentenDokumente: ['dok_geloescht'] })
  assertEquals(v.fehlend.map((p) => p.schluessel), ['portal'])
  assertEquals(v.fehlend[0].reiter, 'interessenten')
})

Deno.test('Eingabe aus einer Datenbankzeile', () => {
  const v = pruefeVollstaendigkeit(eingabeAusZeile({
    id: 'o1', status: 'vorbereitung', typ: 'Haus', kaufpreis: '0', adresse: '', verantwortlich: null,
    eigentuemer: null, verkaufsdaten: null, dokumente: { Grundbuch: [{ id: 'g', name: 'gb.pdf', typ: 'application/pdf' }] },
    bilder_reihenfolge: [], expose_text: null, anfrage_kennungen: null, interessenten_dokumente: null, off_market: false, privat_besitzer: 'a@b.de',
  }))
  assertEquals(v.phase, 'vorbereitung')
  assert(v.fehlend.some((p) => p.schluessel === 'verantwortlich'))
  assert(!v.fehlend.some((p) => p.schluessel === 'grundbuch'))
  assert(v.prozent! > 0 && v.prozent! < 20)
})

Deno.test('PLZ erkennen', () => {
  assert(hatPlz('Teckstraße 62, 73547 Lorch'))
  assert(!hatPlz('Geislingen'))
  assert(!hatPlz('Tel 0711123456'))
})
