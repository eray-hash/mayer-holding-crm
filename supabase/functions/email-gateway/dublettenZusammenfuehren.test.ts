// Tests für die Aktion `dubletten` (dublettenZusammenfuehren.ts) mit der Testdatenbank: Liste mit Zahlen,
// Zusammenführen über das vorhandene kunden_zusammenfuehren (mit Feldwahl und Verweisen, die das Werkzeug
// nicht kennt), Rechte, verschiedene Bereiche, „keine Dublette“, Bereich wechseln.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, type FalscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'
import { dublettenAktion, fuerDieSeite } from './dublettenZusammenfuehren.ts'

// Die Testdatenbank kennt .not() und .ilike() nicht (pflegeWerkzeuge.ts nutzt .not für Verknüpfungen) und keine
// eindeutigen Regeln außer dem Schlüssel — für diese Tests nachgerüstet und danach wieder entfernt.
// deno-lint-ignore no-explicit-any
function mitNachruestung(db: FalscheDatenbank, eindeutig: Record<string, string> = {}): () => void {
  // deno-lint-ignore no-explicit-any
  const proto = Object.getPrototypeOf(db.from('kunden')) as any
  const alt = { not: proto.not, ilike: proto.ilike, ausfuehren: proto.ausfuehren }
  proto.not = function (s: string, op: string, w: unknown) {
    this.filter.push((z: Zeile) => (op === 'is' && (w === null || w === 'null') ? z[s] !== null && z[s] !== undefined : z[s] !== w))
    return this
  }
  proto.ilike = function (s: string, w: string) {
    this.filter.push((z: Zeile) => String(z[s] ?? '').toLowerCase() === String(w).toLowerCase())
    return this
  }
  proto.ausfuehren = function () {
    const spalte = eindeutig[this.tabelle]
    if (this.art === 'update' && spalte && this.nutzlast && spalte in this.nutzlast) {
      const tab = this.db.tabelle(this.tabelle) as Zeile[]
      const betroffen = tab.filter((z) => this.passt(z))
      if (betroffen.length > 0 && tab.some((z) => z[spalte] === this.nutzlast[spalte] && !betroffen.includes(z))) {
        return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.tabelle}_${spalte}_key"` } }
      }
    }
    return alt.ausfuehren.call(this)
  }
  return () => Object.assign(proto, alt)
}

const GF = { name: 'Bernd Chef', email: 'bernd@firma.de', aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], ist_superuser: false }
const MA = { name: 'Carl Mitarbeiter', email: 'carl@firma.de', aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], ist_superuser: false }

function daten(): Record<string, Zeile[]> {
  return {
    mitarbeiter: [GF, MA],
    kunden: [
      {
        id: 'k_alt', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: 'Max Muster', email: 'max@muster.de', telefon: '0731 111111',
        anschrift: '', branche: '', status: 'lead', prioritaet: 'mittel', verantwortlich: 'Bernd Chef', verantwortlich_email: 'bernd@firma.de',
        activities: [{ id: 'a1', date: '2026-10-01', text: 'Erstkontakt', user: 'Bernd' }], dokumente: [{ id: 'd1', name: 'Vertrag.pdf', url: 'x/1' }],
        follow_up: null, verknuepfte_kunden: null, seminare: null,
      },
      {
        id: 'k_neu', bereich: 'beratung', firma: 'Muster', ansprechpartner: 'Muster, Max', email: 'max@muster.de', telefon: '+49 731 222222',
        anschrift: 'Hauptstraße 1, 89073 Ulm', branche: 'Handel', status: 'erstkontakt', prioritaet: 'hoch', verantwortlich: '', verantwortlich_email: null,
        activities: [{ id: 'a2', date: '2026-11-01', text: 'Mail gekommen', user: 'Carl' }], dokumente: [{ id: 'd2', name: 'Angebot.pdf', url: 'x/2' }],
        follow_up: null, verknuepfte_kunden: null, seminare: [{ id: 's1', titel: 'Kurs' }],
      },
      { id: 'k_erben', bereich: 'erben', firma: 'Muster GmbH', email: 'max@muster.de', telefon: '', activities: [], dokumente: [] },
      { id: 'k_dritt', bereich: 'beratung', firma: 'Völlig Anders', email: 'x@anders.de', activities: [], dokumente: [] },
      { id: 'k_privat', bereich: 'privat', firma: 'Muster GmbH', email: 'max@muster.de', verantwortlich_email: 'carl@firma.de', activities: [], dokumente: [] },
    ],
    rechnungen: [{ id: 'r1', kunde_id: 'k_neu' }],
    protokolle: [],
    wiedervorlagen: [{ id: 'wv1', kunde_id: 'k_neu', titel: 'Nachfassen', regel: null }],
    willkommen_nachrichten: [{ id: 'w1', kunde_id: 'k_alt' }, { id: 'w2', kunde_id: 'k_neu' }],
    partner_bezug: [{ id: 'pb1', kunde_id: 'k_neu', partner_id: 'p1' }],
    dubletten_ausnahmen: [],
  }
}

async function rufe(db: FalscheDatenbank, wer: Zeile, body: Zeile) {
  const protokoll: string[] = []
  const r = await dublettenAktion({ admin: db, aufrufer: { email: String(wer.email), name: String(wer.name) }, heute: '2026-11-22', protokolliere: (t) => protokoll.push(t) }, body)
  // deno-lint-ignore no-explicit-any
  return { status: r.status, daten: r.daten as any, protokoll }
}

Deno.test('Liste: Gruppe mit Zahlen und Vorschlag; private Kontakte nie; nur Geschäftsführung', async () => {
  const db = falscheDatenbank(daten())
  const weg = mitNachruestung(db)
  try {
    const r = await rufe(db, GF, { modus: 'liste' })
    assertEquals(r.status, 200)
    assertEquals(r.daten.kunden.length, 1)
    const g = r.daten.kunden[0]
    assertEquals(g.ids, ['k_alt', 'k_erben', 'k_neu'])
    assert(g.bereichsuebergreifend)
    const neu = g.akten.find((a: Zeile) => a.id === 'k_neu')
    assertEquals(neu.zaehler.rechnungen, 1)
    assertEquals(neu.zaehler.wiedervorlagen, 1)
    assertEquals(neu.zaehler.dokumente, 1)
    assertEquals(neu.bereichName, 'Unternehmensberatung')
    assert(!JSON.stringify(r.daten).includes('k_privat'))
    assertEquals((await rufe(db, MA, { modus: 'liste' })).status, 403)
  } finally {
    weg()
  }
})

Deno.test('Zusammenführen: Feldwahl, Verweise umgehängt, doppelte Akte gelöscht', async () => {
  const db = falscheDatenbank(daten())
  const weg = mitNachruestung(db, { willkommen_nachrichten: 'kunde_id' })
  try {
    const r = await rufe(db, GF, { modus: 'zusammenfuehren', behalte_id: 'k_alt', entferne_ids: ['k_neu'], felder: { telefon: 'k_neu', status: 'k_alt', prioritaet: 'k_neu' } })
    assertEquals(r.status, 200)
    assert(r.daten.ok, JSON.stringify(r.daten))
    assertStringIncludes(r.daten.ergebnisse[0].text, 'Zusammengeführt')
    const kunden = db.tabelle('kunden')
    assert(!kunden.some((k) => k.id === 'k_neu'))
    const b = kunden.find((k) => k.id === 'k_alt')!
    assertEquals(b.telefon, '+49 731 222222')
    assertEquals(b.status, 'lead')
    assertEquals(b.prioritaet, 'hoch')
    assertEquals(b.anschrift, 'Hauptstraße 1, 89073 Ulm') // leer → aus der doppelten Akte
    assertEquals(b.branche, 'Handel')
    assertEquals(b.seminare, [{ id: 's1', titel: 'Kurs' }])
    assertEquals((b.dokumente as Zeile[]).map((d) => d.id).sort(), ['d1', 'd2'])
    const verlauf = (b.activities as Zeile[]).map((a) => String(a.text)).join('\n')
    assertStringIncludes(verlauf, 'Telefon (bisher: 0731 111111)')
    assertStringIncludes(verlauf, 'Doppelte Akte „Muster')
    assertEquals(db.tabelle('rechnungen')[0].kunde_id, 'k_alt')
    assertEquals(db.tabelle('wiedervorlagen')[0].kunde_id, 'k_alt')
    assertEquals(db.tabelle('partner_bezug')[0].kunde_id, 'k_alt')
    // Willkommensbrief: die bleibende Akte hat schon einen; der doppelte bleibt zurück (verschwindet in der echten DB mit der Akte).
    assertEquals(db.tabelle('willkommen_nachrichten').find((w) => w.id === 'w2')!.kunde_id, 'k_neu')
    assertStringIncludes(r.protokoll.join('\n'), 'Akten zusammengeführt')
  } finally {
    weg()
  }
})

Deno.test('Zusammenführen: verschiedene Bereiche und private Kontakte werden abgelehnt, ohne etwas zu ändern', async () => {
  const db = falscheDatenbank(daten())
  const weg = mitNachruestung(db)
  try {
    const vorher = structuredClone(db.tabellen)
    const r = await rufe(db, GF, { modus: 'zusammenfuehren', behalte_id: 'k_alt', entferne_ids: ['k_erben'], felder: { telefon: 'k_erben' } })
    assert(!r.daten.ok)
    assertStringIncludes(r.daten.ergebnisse[0].text, 'Beide müssen im selben Bereich liegen')
    assert(!r.daten.ergebnisse[0].text.includes('Biete an'))
    const p = await rufe(db, GF, { modus: 'zusammenfuehren', behalte_id: 'k_alt', entferne_ids: ['k_privat'] })
    assert(!p.daten.ok)
    assertEquals(db.tabellen.kunden, vorher.kunden)
    assertEquals((await rufe(db, MA, { modus: 'zusammenfuehren', behalte_id: 'k_alt', entferne_ids: ['k_neu'] })).status, 403)
  } finally {
    weg()
  }
})

Deno.test('Keine Dublette: Paare gemerkt, Gruppe kommt nicht wieder', async () => {
  const db = falscheDatenbank(daten())
  const weg = mitNachruestung(db)
  try {
    const r = await rufe(db, GF, { modus: 'keine_dublette', art: 'kunde', ids: ['k_neu', 'k_alt', 'k_erben'] })
    assertEquals(r.daten, { ok: true, anzahl: 3 })
    assertEquals(db.tabelle('dubletten_ausnahmen').map((z) => z.id).sort(), ['kunde:k_alt|k_erben', 'kunde:k_alt|k_neu', 'kunde:k_erben|k_neu'])
    assertEquals((await rufe(db, GF, { modus: 'liste' })).daten.kunden.length, 0)
    assertEquals((await rufe(db, GF, { modus: 'keine_dublette', art: 'kunde', ids: ['k_neu'] })).status, 400)
  } finally {
    weg()
  }
})

Deno.test('Bereich wechseln über kunde_bereich_wechseln, mit Statusliste von der Seite', async () => {
  const db = falscheDatenbank(daten())
  const weg = mitNachruestung(db)
  try {
    const netz = { lead: 'Lead / Neuanfrage', erstkontakt: 'Erstkontakt hergestellt' }
    const r = await rufe(db, GF, { modus: 'bereich_wechseln', kunde_id: 'k_erben', nach_bereich: 'beratung', status_netz: netz, start_status: 'lead' })
    assert(r.daten.ok, JSON.stringify(r.daten))
    const k = db.tabelle('kunden').find((x) => x.id === 'k_erben')!
    assertEquals(k.bereich, 'beratung')
    assertEquals(k.status, 'lead')
    assertEquals((await rufe(db, GF, { modus: 'bereich_wechseln', kunde_id: 'k_erben', nach_bereich: 'erben', status_netz: { 'x y': 1 }, start_status: 'x' })).status, 400)
  } finally {
    weg()
  }
})

Deno.test('Texte des Werkzeugs für die Seite ohne Anweisungen an den Assistenten', () => {
  assertEquals(
    fuerDieSeite('Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'),
    'Es gibt keinen Kunden mit dieser kunde_id.',
  )
})
