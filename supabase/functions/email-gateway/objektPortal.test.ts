import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { alleDokumente, fuelleText, ortAus, portalDokument, portalLaden, portalZustimmen } from './objektPortal.ts'

const TOKEN = 'A'.repeat(43)

// deno-lint-ignore no-explicit-any
function fakeAdmin(t: Record<string, any[]>) {
  // deno-lint-ignore no-explicit-any
  function q(tab: string, art: 'select' | 'update', werte?: any) {
    // deno-lint-ignore no-explicit-any
    const f: ((z: any) => boolean)[] = []
    let antwort = art === 'select'
    const lauf = () => {
      const treffer = (t[tab] ?? []).filter((z) => f.every((x) => x(z)))
      if (art === 'update') for (const z of treffer) Object.assign(z, structuredClone(werte))
      return { data: antwort ? structuredClone(treffer) : null, error: null }
    }
    // deno-lint-ignore no-explicit-any
    const o: any = {
      select: () => ((antwort = true), o),
      // deno-lint-ignore no-explicit-any
      eq: (k: string, v: any) => (f.push((z) => z[k] === v), o),
      // deno-lint-ignore no-explicit-any
      in: (k: string, v: any[]) => (f.push((z) => v.includes(z[k])), o),
      maybeSingle: () => Promise.resolve({ data: lauf().data?.[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (a: any, b: any) => Promise.resolve(lauf()).then(a, b),
    }
    return o
  }
  return {
    // deno-lint-ignore no-explicit-any
    from: (tab: string) => ({ select: () => q(tab, 'select'), update: (w: any) => q(tab, 'update', w) }),
    storage: { from: () => ({ createSignedUrl: (pfad: string) => Promise.resolve({ data: { signedUrl: `https://speicher.test/${pfad}?sig` }, error: null }) }) },
  }
}

function stand() {
  return {
    objekt_freigaben: [{ id: 'f1', token: TOKEN, objekt_id: 'o1', kunde_id: 'k1', name: 'Erika Muster', provision: '3 % zzgl. USt.', status: 'eingeladen', gueltig_bis: '2099-01-01T00:00:00Z', zugriffe: 0 }],
    objekte: [{
      id: 'o1', bezeichnung: 'Wohnung Kissing', adresse: 'Am alten Sportplatz 6, 86438 Kissing', typ: 'Wohnung', kaufpreis: 289000, expose_text: 'Helle 3-Zimmer-Wohnung',
      dokumente: { 'Exposé': [{ id: 'd1', name: 'Exposé.pdf', typ: 'application/pdf', groesse: '1 MB', url: 'o1/d1_Expose.pdf' }], Grundbuch: [{ id: 'd2', name: 'Grundbuch.pdf', typ: 'application/pdf', groesse: '1 MB', url: 'o1/d2_Grundbuch.pdf' }] },
      interessenten_dokumente: ['d1'], verantwortlich: 'Quirin Lutzenberger', activities: [],
    }],
    kunden: [{ id: 'k1', activities: [] }],
    vorlagen: [
      { id: 'vl_immo_portal_agb', text: 'AGB für {{Name Interessent}}' },
      { id: 'vl_immo_portal_provision', text: 'Provision {{Provision}} für {{Objekt}} am {{Datum}}' },
      { id: 'vl_immo_portal_widerruf', text: 'Widerruf' },
    ],
  }
}

Deno.test('Ort ohne Hausnummer', () => {
  assertEquals(ortAus('Am alten Sportplatz 6, 86438 Kissing'), '86438 Kissing')
  assertEquals(ortAus('Geislingen'), 'Geislingen')
})

Deno.test('Platzhalter und Dokumentliste', () => {
  assertEquals(fuelleText('{{Name Interessent}} / {{Provision}}', { name: 'A', objekt: 'B', provision: 'C', datum: 'D' }), 'A / C')
  assertEquals(alleDokumente({ X: [{ id: 'a', name: 'n' }], Y: [{ id: 'b' }] }).map((d) => d.id), ['a', 'b'])
})

Deno.test('Ungültige oder abgelaufene Links', async () => {
  const t = stand()
  assertEquals((await portalLaden(fakeAdmin(t), 'kurz')).stufe, 'ungueltig')
  t.objekt_freigaben[0].gueltig_bis = '2000-01-01T00:00:00Z'
  assertEquals((await portalLaden(fakeAdmin(t), TOKEN)).stufe, 'ungueltig')
})

Deno.test('Vor der Zustimmung: nur Ort, keine Adresse, keine Dokumente', async () => {
  const r = await portalLaden(fakeAdmin(stand()), TOKEN)
  assertEquals(r.stufe, 'zustimmung')
  if (r.stufe !== 'zustimmung') return
  assertEquals(r.objekt.ort, '86438 Kissing')
  assert(!JSON.stringify(r).includes('Sportplatz'))
  assertMatch(r.texte.provision, /3 % zzgl\. USt\./)
})

Deno.test('Zustimmung nur mit allen Haken und Namen; danach nur freigegebene Dokumente', async () => {
  const t = stand()
  const admin = fakeAdmin(t)
  const ohne = await portalZustimmen(admin, TOKEN, { name: 'Erika Muster', agb: true, provision: true, sofortBeginn: false }, { ip: '1.2.3.4', geraet: 'Test' })
  assertEquals(ohne.stufe, 'fehler')
  assertEquals((await portalDokument(admin, TOKEN, 'd1') as { fehler?: string }).fehler !== undefined, true)
  const meldungen: string[] = []
  const r = await portalZustimmen(admin, TOKEN, { name: 'Erika Muster', agb: true, provision: true, sofortBeginn: true }, { ip: '1.2.3.4', geraet: 'Test' }, async (_wer, text) => void meldungen.push(text))
  assertEquals(r.stufe, 'frei')
  if (r.stufe !== 'frei') return
  assertEquals(r.dokumente.map((d) => d.id), ['d1'])
  assertEquals(r.objekt.adresse, 'Am alten Sportplatz 6, 86438 Kissing')
  assertEquals(t.objekt_freigaben[0].status, 'zugestimmt')
  assertMatch((t.objekt_freigaben[0] as unknown as { zustimmung: { texte: { provision: string } } }).zustimmung.texte.provision, /Wohnung Kissing/)
  assertEquals(t.objekte[0].activities.length, 1)
  assertEquals(t.kunden[0].activities.length, 1)
  assertEquals(meldungen.length, 1)
  const url = await portalDokument(admin, TOKEN, 'd1')
  assertMatch((url as { url: string }).url, /o1\/d1_Expose\.pdf/)
  const gesperrt = await portalDokument(admin, TOKEN, 'd2')
  assertEquals('fehler' in gesperrt, true)
})

Deno.test('Widerrufener Zugang zeigt nichts mehr', async () => {
  const t = stand()
  t.objekt_freigaben[0].status = 'widerrufen'
  assertEquals((await portalLaden(fakeAdmin(t), TOKEN)).stufe, 'ungueltig')
})
