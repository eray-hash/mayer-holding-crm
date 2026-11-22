// Prüft die Partner-Werkzeuge mit der Test-Datenbank (ohne Netz): Suche mit Summen, Dubletten beim
// Anlegen, Zuordnen und Ändern (nur geänderte Felder), offene Provisionen, Rechte je Bereich und private Akten.
import { assert, assertEquals, assertMatch, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank } from '../_shared/testDoppel.ts'
import { fuehrePartnerWerkzeugAus, istPartnerWerkzeug, type PartnerKontext } from './partnerWerkzeuge.ts'

function db() {
  return falscheDatenbank({
    partner: [
      { id: 'p_hd', name: 'Helmut Dick', firma: 'HD-IMMO', art: 'makler', email: 'info@hdimmo.de', telefon: '07162 45569', adresse: null, notiz: null, provision_vereinbarung: null, provision_satz: null, akte_id: null, aktiv: true },
      { id: 'p_azad', name: 'Azad', firma: '', art: 'vermittler', email: null, telefon: null, adresse: null, notiz: null, provision_vereinbarung: '10 % vom Honorar', provision_satz: 10, akte_id: 'k_azad', aktiv: true },
      { id: 'p_alt', name: 'Alt', firma: 'Alt GmbH', art: 'notar', email: null, telefon: null, adresse: null, notiz: null, provision_vereinbarung: null, provision_satz: null, akte_id: null, aktiv: false },
    ],
    partner_bezug: [
      { id: 'pb_1', partner_id: 'p_azad', kunde_id: 'k_baeckerei', objekt_id: null, rolle: 'vermittelt', provision_vereinbart: null, provision_status: 'offen', betrag: 500, notiz: null },
      { id: 'pb_2', partner_id: 'p_azad', kunde_id: 'k_erben', objekt_id: null, rolle: 'vermittelt', provision_vereinbart: null, provision_status: 'offen', betrag: 300, notiz: null },
      { id: 'pb_3', partner_id: 'p_hd', kunde_id: null, objekt_id: 'o_remstal', rolle: 'angeboten', provision_vereinbart: '3,57 %', provision_status: 'abgerechnet', betrag: null, notiz: null },
      { id: 'pb_4', partner_id: 'p_azad', kunde_id: 'k_privat', objekt_id: null, rolle: 'vermittelt', provision_vereinbart: null, provision_status: 'offen', betrag: 99, notiz: null },
    ],
    kunden: [
      { id: 'k_baeckerei', bereich: 'beratung', firma: 'Anders Bäckerei', ansprechpartner: 'Mark Anders', verantwortlich_email: null },
      { id: 'k_erben', bereich: 'erben', firma: 'Familie Huber', ansprechpartner: '', verantwortlich_email: null },
      { id: 'k_azad', bereich: 'beratung', firma: 'Azad (Vermittler)', ansprechpartner: 'Azad', verantwortlich_email: null },
      { id: 'k_privat', bereich: 'privat', firma: 'Privatkontakt', ansprechpartner: '', verantwortlich_email: 'andere@x.de' },
    ],
    objekte: [{ id: 'o_remstal', bezeichnung: 'Boarding House Remstal', adresse: 'Lorch', privat_besitzer: null }],
  })
}

function kontext(d: ReturnType<typeof db>, m: Record<string, unknown> = {}): PartnerKontext & { log: string[] } {
  const log: string[] = []
  return {
    supabase: d,
    mitarbeiter: { name: 'Hasan Süslü', email: 'hasan@x.de', rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung', 'immobilien'], ...m },
    protokolliere: (t: string) => void log.push(t),
    heute: '2026-11-22',
    log,
  }
}

Deno.test('Werkzeugnamen', () => {
  for (const n of ['partner_suchen', 'partner_anlegen', 'partner_zuordnen', 'provisionen_offen']) assert(istPartnerWerkzeug(n))
  assert(!istPartnerWerkzeug('kunden_suchen'))
})

Deno.test('partner_suchen: Treffer mit sichtbaren Summen; fremde Bereiche und private Akten zählen nicht', async () => {
  const d = db()
  const r = await fuehrePartnerWerkzeugAus('partner_suchen', { suchbegriff: 'azad' }, kontext(d))
  assertStringIncludes(r, 'Azad | Vermittler')
  assertStringIncludes(r, 'gebracht: 1 Akte(n)')
  assertStringIncludes(r, 'offene Provision: 500,00 €')
  assertStringIncludes(r, 'partner_id=p_azad')
  // Geschäftsführung sieht auch Erben, aber nie den privaten Kontakt eines anderen
  const gf = await fuehrePartnerWerkzeugAus('partner_suchen', { suchbegriff: 'azad' }, kontext(d, { rolle: 'geschaeftsfuehrung' }))
  assertStringIncludes(gf, 'offene Provision: 800,00 €')
  // Suche über die Telefonnummer, inaktive nur auf Wunsch
  assertStringIncludes(await fuehrePartnerWerkzeugAus('partner_suchen', { suchbegriff: '07162/45569' }, kontext(d)), 'Helmut Dick (HD-IMMO)')
  assertStringIncludes(await fuehrePartnerWerkzeugAus('partner_suchen', { suchbegriff: 'Alt' }, kontext(d)), 'Kein Partner gefunden')
  assertStringIncludes(await fuehrePartnerWerkzeugAus('partner_suchen', { suchbegriff: 'Alt', mit_inaktiven: true }, kontext(d)), 'nicht mehr aktiv')
})

Deno.test('partner_suchen: Einzelansicht und Partner einer Akte/eines Objekts', async () => {
  const d = db()
  const r = await fuehrePartnerWerkzeugAus('partner_suchen', { partner_id: 'p_azad' }, kontext(d))
  assertStringIncludes(r, 'hat vermittelt: Akte Anders Bäckerei (Mark Anders)')
  assert(!r.includes('Familie Huber'))
  assert(!r.includes('Privatkontakt'))
  const o = await fuehrePartnerWerkzeugAus('partner_suchen', { objekt_id: 'o_remstal' }, kontext(d))
  assertStringIncludes(o, 'Helmut Dick (HD-IMMO) (Makler) hat angeboten')
  assertStringIncludes(o, 'Provision abgerechnet, vereinbart: 3,57 %')
  assertMatch(await fuehrePartnerWerkzeugAus('partner_suchen', { kunde_id: 'k_erben' }, kontext(d)), /^Nicht freigegeben/)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_suchen', { kunde_id: 'k_privat' }, kontext(d)), /^Fehler: Es gibt keine Akte/)
})

Deno.test('partner_anlegen: Dublette blockiert, trotzdem legt an', async () => {
  const d = db()
  const k = kontext(d)
  const r = await fuehrePartnerWerkzeugAus('partner_anlegen', { firma: 'HD IMMO GmbH', art: 'makler' }, k)
  assertMatch(r, /^Nicht angelegt/)
  assertStringIncludes(r, 'partner_id=p_hd')
  assertEquals(d.tabelle('partner').length, 3)
  const n = await fuehrePartnerWerkzeugAus('partner_anlegen', { name: 'Petra Notar', art: 'Notarin', telefon: '0731 1', provision_satz: 2 }, k)
  assertMatch(n, /^Angelegt: Petra Notar als Notar/)
  const neu = d.tabelle('partner').find((p) => p.name === 'Petra Notar')!
  assertEquals(neu.art, 'notar')
  assertEquals(neu.provision_satz, 2)
  assertEquals(neu.quelle, 'assistent')
  assertEquals(neu.erstellt_von, 'Hasan Süslü')
  assertEquals(k.log.length, 1)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_anlegen', { art: 'bank' }, k), /^Fehler: name oder firma/)
})

Deno.test('partner_zuordnen: neu, dann nur geänderte Felder; Rechte', async () => {
  const d = db()
  const k = kontext(d)
  const r = await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', kunde_id: 'k_baeckerei', rolle: 'beraten' }, k)
  assertMatch(r, /^Eingetragen: Helmut Dick \(HD-IMMO\) hat beraten bei der Akte Anders Bäckerei/)
  const zeile = d.tabelle('partner_bezug').find((b) => b.partner_id === 'p_hd' && b.kunde_id === 'k_baeckerei')!
  assertEquals(zeile.provision_status, 'keine')
  // Gleiche Zuordnung erneut mit Betrag → Änderung, Stand wird offen
  const a = await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', kunde_id: 'k_baeckerei', rolle: 'beraten', betrag: '1.000,00' }, k)
  assertMatch(a, /^Geändert:.*Provision offen, 1\.000,00 €/)
  assertEquals(d.tabelle('partner_bezug').filter((b) => b.partner_id === 'p_hd' && b.kunde_id === 'k_baeckerei').length, 1)
  // Bezahlt markieren
  const b = await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_azad', kunde_id: 'k_baeckerei', provision_status: 'bezahlt' }, k)
  assertMatch(b, /^Geändert: Azad hat vermittelt/)
  assertEquals(d.tabelle('partner_bezug').find((x) => x.id === 'pb_1')!.provision_status, 'bezahlt')
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_azad', kunde_id: 'k_baeckerei', provision_status: 'bezahlt' }, k), /^Schon so eingetragen/)
  // Objekt: Vorgabe-Rolle angeboten; Hinweis auf allgemeine Vereinbarung
  const o = await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_azad', objekt_id: 'o_remstal' }, k)
  assertMatch(o, /hat angeboten bei dem Objekt Boarding House Remstal/)
  assertStringIncludes(o, 'allgemein „10 %, 10 % vom Honorar“ vereinbart')
  // Rechte
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', kunde_id: 'k_erben' }, k), /^Nicht freigegeben/)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', kunde_id: 'k_privat' }, k), /^Fehler: Es gibt keine Akte/)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', objekt_id: 'o_remstal' }, kontext(d, { bereiche: ['beratung'] })), /^Nicht freigegeben/)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_x', kunde_id: 'k_baeckerei' }, k), /^Fehler: Diesen Partner gibt es nicht/)
  assertMatch(await fuehrePartnerWerkzeugAus('partner_zuordnen', { partner_id: 'p_hd', kunde_id: 'k_baeckerei', betrag: 'viel' }, k), /^Fehler: betrag/)
  assertEquals(k.log.length, 4)
})

Deno.test('provisionen_offen: je Partner, nur sichtbare; privater Assistent ausgeschlossen', async () => {
  const d = db()
  const r = await fuehrePartnerWerkzeugAus('provisionen_offen', {}, kontext(d))
  assertMatch(r, /^Offene Provisionen an Partner: 500,00 € aus 2 Fall\/Fällen, davon 1 noch ohne Betrag/)
  assertStringIncludes(r, 'Azad: 500,00 €')
  assertStringIncludes(r, 'Helmut Dick (HD-IMMO): 0,00 € + 1 ohne Betrag')
  assert(!r.includes('Huber'))
  const nurHd = await fuehrePartnerWerkzeugAus('provisionen_offen', { partner_id: 'p_hd' }, kontext(d))
  assert(!nurHd.includes('Azad'))
  assertMatch(await fuehrePartnerWerkzeugAus('provisionen_offen', {}, kontext(d, { nurPrivat: true })), /^Fehler: Das Partner-Verzeichnis gibt es nur/)
})
