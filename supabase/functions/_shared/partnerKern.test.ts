// Prüft den Partner-Kern ohne Netz: Lesen von „Angeboten von …“, Vermittler-Hinweisen im Verlauf,
// Dubletten-Erkennung, offene Summen und den Erst-Vorschlag aus Akten und Objekten (nachgebaut nach den
// echten Fällen HD-IMMO / Helmut Dick und Vermittler Azad).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { aehnlichePartner, artAus, findePartnerKandidaten, leseAngebotenVon, leseBetrag, leseVermittlerAusVerlauf, offeneProvision, partnerName } from './partnerKern.ts'

Deno.test('Angeboten von: Makler mit Firma, Telefon und Mail; Eigentümer zählt nicht', () => {
  const t = 'Objekt per Telegram angelegt. Angeboten von Makler Helmut Dick (HD-IMMO), Tel. 07162 45569, info@hdimmo.de. Notiz: Auf Wunsch von Andreas.'
  assertEquals(leseAngebotenVon(t), { art: 'makler', name: 'Helmut Dick', firma: 'HD-IMMO', telefon: '07162 45569', email: 'info@hdimmo.de' })
  assertEquals(leseAngebotenVon('Angeboten von Eigentümer Hans Maier.'), null)
  assertEquals(leseAngebotenVon('Angeboten von HD-IMMO.')?.firma, 'HD-IMMO')
  assertEquals(leseAngebotenVon('Kein Hinweis'), null)
})

Deno.test('Vermittler-Hinweise im Verlauf', () => {
  const v = leseVermittlerAusVerlauf('Laut Liste des Vermittlers Azad (handschriftliche Liste) an uns vermittelt.')
  assertEquals(v, [{ name: 'Azad', sicher: true, art: 'vermittler' }])
  const e = leseVermittlerAusVerlauf('Angebot - auf Empfehlung von Lipert Finance aus Augsburg')
  assertEquals(e, [{ name: 'Lipert Finance', sicher: false, art: 'tippgeber' }])
  assertEquals(leseVermittlerAusVerlauf('vermittelt durch Klaus Berger am Telefon')[0].name, 'Klaus Berger')
})

Deno.test('Art, Betrag, Name, Dubletten, Summen', () => {
  assertEquals(artAus('Maklerin'), 'makler')
  assertEquals(artAus('Steuerbüro'), 'steuerberater')
  assertEquals(artAus('Sparkasse Ulm'), 'bank')
  assertEquals(artAus('xyz'), undefined)
  assertEquals(leseBetrag('1.200,50 €'), 1200.5)
  assertEquals(leseBetrag('1.200'), 1200)
  assertEquals(leseBetrag('abc'), undefined)
  assertEquals(partnerName({ name: 'Helmut Dick', firma: 'HD-IMMO' }), 'Helmut Dick (HD-IMMO)')
  const vorhanden = [{ id: 'p1', name: 'Helmut Dick', firma: 'HD-IMMO', email: 'info@hdimmo.de', telefon: '07162 45569' }, { id: 'p2', name: 'Azad', firma: '' }]
  assertEquals(aehnlichePartner(vorhanden, { firma: 'HD IMMO GmbH' }).map((p) => p.id), ['p1'])
  assertEquals(aehnlichePartner(vorhanden, { telefon: '07162/45569' }).map((p) => p.id), ['p1'])
  assertEquals(aehnlichePartner(vorhanden, { name: 'azad' }).map((p) => p.id), ['p2'])
  assertEquals(aehnlichePartner(vorhanden, { email: 'x@gmx.de' }), [])
  assertEquals(offeneProvision([{ provision_status: 'offen', betrag: 100 }, { provision_status: 'abgerechnet', betrag: '50.5' }, { provision_status: 'offen', betrag: null }, { provision_status: 'bezahlt', betrag: 999 }, { provision_status: 'keine' }]), { summe: 150.5, anzahl: 3, ohneBetrag: 1 })
})

const AKTEN = [
  { id: 'k_hirsch', bereich: 'immobilienkunden', firma: 'Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)', ansprechpartner: 'Helmut Dick', email: 'info@hdimmo.de', telefon: '07162  45569', activities: [{ text: 'OFFMARKET-Objekt. Makler Helmut Dick (HD-IMMO, Süßen) bietet …' }] },
  { id: 'k_remstal', bereich: 'immobilienkunden', firma: 'Boarding House Remstal (HD-IMMO, Lorch)', ansprechpartner: 'Marc Ziegler', email: 'ziegler@rbh-info.de', telefon: '+49 7172 9110346', activities: [] },
  { id: 'k_azad', bereich: 'beratung', firma: 'Azad (Vermittler)', ansprechpartner: 'Azad', email: '', telefon: '', activities: [{ text: 'Vermittler. Laut handschriftlicher Liste …' }] },
  { id: 'k_baeckerei', bereich: 'beratung', firma: 'Anders Bäckerei', ansprechpartner: 'Mark Anders', activities: [{ text: 'Laut Liste des Vermittlers Azad (handschriftliche Liste) an uns vermittelt.' }] },
  { id: 'k_reupert', bereich: 'beratung', firma: 'Alexander Reupert', ansprechpartner: 'Alexander Reupert', email: 'a.r@outlook.com', activities: [{ text: 'Als Lead aus E-Mail-Analyse übernommen: „Vermittler/Geschäftspartner mit mehreren Mandanten"' }] },
  { id: 'k_geno', bereich: 'beratung', firma: 'Geno-Immobilien GmbH', ansprechpartner: 'Georg Mägerlein', email: 'g@geno-immobilien.com', activities: [] },
  { id: 'k_kunde', bereich: 'erben', firma: 'Familie Huber', ansprechpartner: 'Eva Huber', vermittler: { name: 'Azad (Vermittler) (Azad)', kundeId: 'k_azad' }, activities: [] },
  { id: 'k_privat', bereich: 'privat', firma: 'Privat (Vermittler)', activities: [] },
]
const OBJEKTE = [
  { id: 'o_remstal', bezeichnung: 'Boarding House Remstal', activities: [{ text: 'Objekt angelegt. Angeboten von Makler Helmut Dick (HD-IMMO), Tel. 07162 45569, info@hdimmo.de. Notiz: …' }] },
  { id: 'o_privat', bezeichnung: 'Privat', privat_besitzer: 'x@y.de', activities: [{ text: 'Angeboten von Makler Fremd Person (Fremd-IMMO).' }] },
]

Deno.test('Vorschlag: zusammengeführt, angehakt nur Eindeutiges, private Einträge außen vor', () => {
  const { kandidaten, schonErledigt } = findePartnerKandidaten({ akten: AKTEN, objekte: OBJEKTE, partner: [], bezuege: [] })
  assertEquals(schonErledigt, 0)
  const hd = kandidaten.find((k) => k.firma === 'HD-IMMO')!
  assert(hd.sicher)
  assertEquals(hd.name, 'Helmut Dick')
  assertEquals(hd.art, 'makler')
  assertEquals(hd.email, 'info@hdimmo.de')
  assertEquals(hd.bezuege.map((b) => `${b.kunde_id ?? b.objekt_id}:${b.rolle}`).sort(), ['k_hirsch:angeboten', 'k_remstal:angeboten', 'o_remstal:angeboten'])

  const azad = kandidaten.find((k) => k.name === 'Azad')!
  assert(azad.sicher)
  assertEquals(azad.akte_id, 'k_azad')
  assertEquals(azad.art, 'vermittler')
  assertEquals(azad.bezuege.map((b) => b.kunde_id).sort(), ['k_baeckerei', 'k_kunde'])

  const reupert = kandidaten.find((k) => k.name === 'Alexander Reupert')!
  assert(reupert.sicher)
  const geno = kandidaten.find((k) => k.firma === 'Geno-Immobilien GmbH')!
  assertEquals(geno.sicher, false)
  assert(!kandidaten.some((k) => /Fremd|Privat/.test(`${k.name}${k.firma}`)))
  assertEquals(new Set(kandidaten.map((k) => k.schluessel)).size, kandidaten.length)
})

Deno.test('Vorschlag: vorhandener Partner → nur fehlende Zuordnungen, vollständige zählen als erledigt', () => {
  const partner = [{ id: 'p_hd', name: 'Helmut Dick', firma: 'HD-IMMO', email: 'info@hdimmo.de' }, { id: 'p_azad', name: 'Azad', firma: '', akte_id: 'k_azad' }]
  const bezuege = [
    { partner_id: 'p_hd', objekt_id: 'o_remstal', rolle: 'angeboten' },
    { partner_id: 'p_azad', kunde_id: 'k_baeckerei', rolle: 'vermittelt' },
    { partner_id: 'p_azad', kunde_id: 'k_kunde', rolle: 'vermittelt' },
  ]
  const { kandidaten, schonErledigt } = findePartnerKandidaten({ akten: AKTEN, objekte: OBJEKTE, partner, bezuege })
  const hd = kandidaten.find((k) => k.vorhanden?.id === 'p_hd')!
  assertEquals(hd.bezuege.map((b) => b.kunde_id).sort(), ['k_hirsch', 'k_remstal'])
  assert(!kandidaten.some((k) => k.vorhanden?.id === 'p_azad'))
  assertEquals(schonErledigt, 1)
})
