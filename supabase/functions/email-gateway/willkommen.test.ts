import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { fuelleWillkommen, heuteBerlin, hochladeLink, neuesToken, versendeWillkommen } from './willkommen.ts'

// Kleine nachgebaute Datenbank: from(t).select().eq().lte().order().limit().maybeSingle(), update().eq().select(), insert().
// deno-lint-ignore no-explicit-any
// `scheitert(tabelle, werte)` → Fehlermeldung: diese Änderung schlägt fehl (nichts wird geschrieben).
// deno-lint-ignore no-explicit-any
function fakeAdmin(tabellen: Record<string, any[]>, scheitert?: (t: string, werte: any) => string | null) {
  // deno-lint-ignore no-explicit-any
  function abfrage(t: string, art: 'select' | 'update', werte?: any) {
    // deno-lint-ignore no-explicit-any
    const filter: ((z: any) => boolean)[] = []
    let grenze = Infinity
    let mitAntwort = art === 'select'
    const ausfuehren = () => {
      const fehler = art === 'update' ? scheitert?.(t, werte) ?? null : null
      if (fehler) return { data: null, error: { message: fehler } }
      const treffer = (tabellen[t] ?? []).filter((z) => filter.every((f) => f(z))).slice(0, grenze)
      if (art === 'update') for (const z of treffer) Object.assign(z, structuredClone(werte))
      return { data: mitAntwort ? structuredClone(treffer) : null, error: null }
    }
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => ((mitAntwort = true), q),
      // deno-lint-ignore no-explicit-any
      eq: (f: string, v: any) => (filter.push((z) => z[f] === v), q),
      lte: (f: string, v: string) => (filter.push((z) => z[f] <= v), q),
      order: () => q,
      limit: (n: number) => ((grenze = n), q),
      maybeSingle: () => Promise.resolve({ data: ausfuehren().data?.[0] ?? null, error: null }),
      // deno-lint-ignore no-explicit-any
      then: (ok: any, nein: any) => Promise.resolve(ausfuehren()).then(ok, nein),
    }
    return q
  }
  return {
    from: (t: string) => ({
      select: () => abfrage(t, 'select'),
      // deno-lint-ignore no-explicit-any
      update: (w: any) => abfrage(t, 'update', w),
      // deno-lint-ignore no-explicit-any
      insert: (z: any) => ((tabellen[t] ??= []).push(z), Promise.resolve({ error: null })),
    }),
  }
}

function stand(aktiv = true) {
  return {
    willkommen_einstellung: [{ id: 1, aktiv, link_basis: 'https://beispiel.test/crm/' }],
    willkommen_nachrichten: [{ id: 'w1', kunde_id: 'k1', status: 'geplant', senden_ab: new Date(Date.now() - 60_000).toISOString() }],
    kunden: [{ id: 'k1', bereich: 'beratung', status: 'erstkontakt', email: 'kunde@beispiel.de', firma: 'Muster GmbH', ansprechpartner: 'Thomas Beispiel', verantwortlich: 'Hasan Süslü', unterlagen_anforderungen: [], activities: [{ id: 'a0', text: 'alt' }] }],
    mail_vorlagen: [{ id: 'mv-willkommen-auto', betreff: 'Willkommen', text: 'Guten Tag {{ansprechpartner}},\n\n{{ansprechpartner_satz}}\n{{link}}\n\n{{gruss}}' }],
    gesendete_emails: [] as unknown[],
  }
}

Deno.test('Token: 43 Zeichen base64url', () => {
  const t = neuesToken()
  assertMatch(t, /^[A-Za-z0-9_-]{43}$/)
  assertEquals(hochladeLink('https://x.test/a', t), `https://x.test/a/#/formular/unterlagen/${t}`)
})

Deno.test('Platzhalter: ohne Berater fällt der Ansprechpartner-Satz weg', () => {
  const mit = fuelleWillkommen('Hallo {{ansprechpartner}}\n{{ansprechpartner_satz}}\nLink: {{link}}\n{{gruss}}', { ansprechpartner: 'Frau Muster', berater: 'Hasan Süslü', link: 'L' })
  assertEquals(mit, 'Hallo Frau Muster\nIhr persönlicher Ansprechpartner ist Hasan Süslü.\nLink: L\nHasan Süslü')
  const ohne = fuelleWillkommen('Hallo {{ansprechpartner}}\n{{ansprechpartner_satz}}\n{{gruss}}', { ansprechpartner: '', link: 'L' })
  assertEquals(ohne, 'Hallo Damen und Herren\nIhr Team der Mayer Holding')
})

Deno.test('Datum in Deutschland', () => {
  assertEquals(heuteBerlin(new Date('2026-11-20T23:30:00Z')), '2026-11-21')
})

Deno.test('Schalter aus: Zeitplan schickt nichts', async () => {
  const t = stand(false)
  const gesendet: string[] = []
  const r = await versendeWillkommen(fakeAdmin(t), async (to) => void gesendet.push(to))
  assertEquals(r.gesendet, 0)
  assertEquals(gesendet.length, 0)
  assertEquals(t.willkommen_nachrichten[0].status, 'geplant')
})

Deno.test('Versand: Mail, Link-Anforderung, Verlauf, gesendete Mail, kein zweites Mal', async () => {
  const t = stand(true)
  const mails: { to: string; subject: string; text: string }[] = []
  const admin = fakeAdmin(t)
  const r = await versendeWillkommen(admin, async (to, subject, text) => void mails.push({ to, subject, text }))
  assertEquals(r.gesendet, 1)
  assertEquals(mails.length, 1)
  assertEquals(mails[0].to, 'kunde@beispiel.de')
  assertMatch(mails[0].text, /Guten Tag Thomas Beispiel/)
  assertMatch(mails[0].text, /Ansprechpartner ist Hasan Süslü/)
  const anf = t.kunden[0].unterlagen_anforderungen as { token: string; art: string; an: string }[]
  assertEquals(anf.length, 1)
  assertEquals(anf[0].art, 'anforderung')
  assert(mails[0].text.includes(`https://beispiel.test/crm/#/formular/unterlagen/${anf[0].token}`))
  assertEquals(t.willkommen_nachrichten[0].status, 'gesendet')
  assertEquals((t.gesendete_emails[0] as { quelle: string; kunde_id: string }).quelle, 'willkommen')
  assertMatch((t.kunden[0].activities as { text: string }[])[0].text, /Willkommensnachricht automatisch gesendet/)
  assertEquals((t.kunden[0].activities as unknown[]).length, 2)
  const nochmal = await versendeWillkommen(admin, async (to, subject, text) => void mails.push({ to, subject, text }))
  assertEquals(nochmal.gesendet, 0)
  assertEquals(mails.length, 1)
})

Deno.test('Fall verloren oder ohne Adresse: nichts senden', async () => {
  const t = stand(true)
  t.kunden[0].status = 'verloren'
  const mails: string[] = []
  await versendeWillkommen(fakeAdmin(t), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(t.willkommen_nachrichten[0].status, 'abgebrochen')
  const t2 = stand(true)
  t2.kunden[0].email = 'keine-adresse'
  await versendeWillkommen(fakeAdmin(t2), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(t2.willkommen_nachrichten[0].status, 'ohne_adresse')
})

Deno.test('Versandfehler: Zeile auf fehler, kein Verlaufseintrag', async () => {
  const t = stand(true)
  const r = await versendeWillkommen(fakeAdmin(t), async () => {
    throw new Error('SMTP weg')
  })
  assertEquals(r.fehler, 1)
  assertEquals(t.willkommen_nachrichten[0].status, 'fehler')
  assertEquals((t.kunden[0].activities as unknown[]).length, 1)
})

Deno.test('Jetzt senden: auch bei ausgeschaltetem Schalter, nur diese Akte', async () => {
  const t = stand(false)
  const mails: string[] = []
  const r = await versendeWillkommen(fakeAdmin(t), async (to) => void mails.push(to), { kundeId: 'k1' })
  assertEquals(r.gesendet, 1)
  assertEquals(mails, ['kunde@beispiel.de'])
})

Deno.test('Link zum Hochladen lässt sich nicht anlegen: fehler ohne Sendezeit, keine Mail', async () => {
  const t = stand(true)
  const mails: string[] = []
  // deno-lint-ignore no-explicit-any
  const admin = fakeAdmin(t, (tabelle, werte: any) => (tabelle === 'kunden' && 'unterlagen_anforderungen' in werte ? 'Zeile gesperrt' : null))
  const r = await versendeWillkommen(admin, async (to) => void mails.push(to))
  assertEquals(r.fehler, 1)
  assertEquals(mails.length, 0)
  const z = t.willkommen_nachrichten[0] as { status: string; gesendet_am?: string | null; grund?: string }
  assertEquals(z.status, 'fehler')
  assertEquals(z.gesendet_am, null)
  assertMatch(String(z.grund), /Link zum Hochladen/)
})

Deno.test('Älter als 7 Tage: verfällt statt zu senden, Jetzt senden geht weiter', async () => {
  const t = stand(true)
  t.willkommen_nachrichten[0].senden_ab = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const mails: string[] = []
  const r = await versendeWillkommen(fakeAdmin(t), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(r.uebersprungen, 1)
  assertEquals(t.willkommen_nachrichten[0].status, 'abgebrochen')
  assertMatch(String((t.willkommen_nachrichten[0] as { grund?: string }).grund), /Älter als 7 Tage/)

  const t2 = stand(false)
  t2.willkommen_nachrichten[0].senden_ab = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const r2 = await versendeWillkommen(fakeAdmin(t2), async (to) => void mails.push(to), { kundeId: 'k1' })
  assertEquals(r2.gesendet, 1)
})
