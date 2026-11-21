import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { versendeAutoNachrichten } from './autoNachrichten.ts'

// Kleine nachgebaute Datenbank (wie in willkommen.test.ts) plus rpc('auto_nachricht_bauen').
// deno-lint-ignore no-explicit-any
function fakeAdmin(tabellen: Record<string, any[]>, bauen: (args: any) => any) {
  // deno-lint-ignore no-explicit-any
  function abfrage(t: string, art: 'select' | 'update', werte?: any) {
    // deno-lint-ignore no-explicit-any
    const filter: ((z: any) => boolean)[] = []
    let grenze = Infinity
    let mitAntwort = art === 'select'
    const ausfuehren = () => {
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
    // deno-lint-ignore no-explicit-any
    rpc: (name: string, args: any) => Promise.resolve(name === 'auto_nachricht_bauen' ? { data: bauen(args), error: null } : { data: null, error: { message: 'unbekannt' } }),
  }
}

const IN_3_TAGEN = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()

function stand(aktiv = true) {
  return {
    auto_nachricht_regeln: [
      { id: 'immo_besichtigung_bestaetigung', titel: 'Besichtigung bestätigen', aktiv },
      { id: 'immo_portal_zustimmung', titel: 'Kopie der Provisionsvereinbarung', aktiv },
    ],
    auto_nachrichten: [
      { id: 'n1', regel: 'immo_besichtigung_bestaetigung', bezug: 'bs1', objekt_id: 'o1', kunde_id: 'k1', besichtigung_id: 'bs1', freigabe_id: null, status: 'geplant', senden_ab: '2000-01-01T00:00:00Z', betreff: 'alt', text: 'alt' },
    ] as Record<string, unknown>[],
    objekte: [{ id: 'o1', privat_besitzer: null, activities: [{ id: 'a0', text: 'alt' }] }],
    besichtigungen: [{ id: 'bs1', status: 'geplant', beginn: IN_3_TAGEN, angebot: null }],
    objekt_freigaben: [{ id: 'f1', status: 'zugestimmt', widerrufen_am: null }],
    kunden: [{ id: 'k1', activities: [] as unknown[] }],
    gesendete_emails: [] as Record<string, unknown>[],
  }
}

// deno-lint-ignore no-explicit-any
const bauenOk = (_args: any) => ({ objekt_id: 'o1', kunde_id: 'k1', an: 'max@beispiel.de', an_name: 'Max Muster', betreff: 'Ihr Besichtigungstermin', text: 'Guten Tag Max Muster, frisch', privat: false, hindernis: null })

Deno.test('Versand: frischer Text, beansprucht, gesendete Mail, Verlauf an Objekt und Kontakt, kein zweites Mal', async () => {
  const t = stand()
  const mails: { to: string; subject: string; text: string }[] = []
  const admin = fakeAdmin(t, bauenOk)
  const r = await versendeAutoNachrichten(admin, async (to, subject, text) => void mails.push({ to, subject, text }))
  assertEquals(r.gesendet, 1)
  assertEquals(mails.length, 1)
  assertEquals(mails[0].to, 'max@beispiel.de')
  assertEquals(mails[0].text, 'Guten Tag Max Muster, frisch')
  assertEquals(t.auto_nachrichten[0].status, 'gesendet')
  assertEquals(t.auto_nachrichten[0].text, 'Guten Tag Max Muster, frisch')
  assertEquals(t.gesendete_emails[0].quelle, 'auto:immo_besichtigung_bestaetigung')
  assertEquals(t.gesendete_emails[0].kunde_id, 'k1')
  assertEquals(t.gesendete_emails[0].kunde_bereich, 'immobilienkunden')
  assertMatch((t.objekte[0].activities as { text: string }[])[0].text, /Automatische Nachricht „Besichtigung bestätigen“ gesendet an max@beispiel.de/)
  assertEquals(t.objekte[0].activities.length, 2)
  assertEquals(t.kunden[0].activities.length, 1)
  const nochmal = await versendeAutoNachrichten(admin, async (to, subject, text) => void mails.push({ to, subject, text }))
  assertEquals(nochmal.gesendet, 0)
  assertEquals(mails.length, 1)
})

Deno.test('Regel aus: fällige Nachricht wird abgebrochen, nichts gesendet', async () => {
  const t = stand(false)
  const mails: string[] = []
  const r = await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async (to) => void mails.push(to))
  assertEquals(r.gesendet, 0)
  assertEquals(mails.length, 0)
  assertEquals(t.auto_nachrichten[0].status, 'abgebrochen')
  assertEquals(t.auto_nachrichten[0].grund, 'Regel wurde ausgeschaltet')
})

Deno.test('„Jetzt senden“ geht auch bei ausgeschalteter Regel, nur diese eine Nachricht', async () => {
  const t = stand(false)
  t.auto_nachrichten.push({ ...t.auto_nachrichten[0], id: 'n2', bezug: 'bs2', besichtigung_id: 'bs1' })
  const mails: string[] = []
  const r = await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async (to) => void mails.push(to), { id: 'n1' })
  assertEquals(r.gesendet, 1)
  assertEquals(mails.length, 1)
  assertEquals(t.auto_nachrichten[0].status, 'gesendet')
  assertEquals(t.auto_nachrichten[1].status, 'geplant')
  assertMatch(String(t.gesendete_emails[0].quelle), /^auto:/)
})

Deno.test('Besichtigung inzwischen abgesagt oder vorbei: abbrechen statt senden', async () => {
  const t = stand()
  t.besichtigungen[0].status = 'abgesagt'
  const mails: string[] = []
  await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(t.auto_nachrichten[0].status, 'abgebrochen')
  assertMatch(String(t.auto_nachrichten[0].grund), /abgesagt/)

  const t2 = stand()
  t2.besichtigungen[0].beginn = '2020-01-01T10:00:00Z'
  await versendeAutoNachrichten(fakeAdmin(t2, bauenOk), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(t2.auto_nachrichten[0].grund, 'Termin ist schon vorbei')
})

Deno.test('Portal-Zugang beendet: Kopie der Provisionsvereinbarung geht nicht raus', async () => {
  const t = stand()
  t.auto_nachrichten[0] = { id: 'n1', regel: 'immo_portal_zustimmung', bezug: 'f1', objekt_id: 'o1', kunde_id: null, besichtigung_id: null, freigabe_id: 'f1', status: 'geplant', senden_ab: '2000-01-01T00:00:00Z' }
  t.objekt_freigaben[0].status = 'widerrufen'
  const mails: string[] = []
  await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async (to) => void mails.push(to))
  assertEquals(mails.length, 0)
  assertEquals(t.auto_nachrichten[0].status, 'abgebrochen')
  assertEquals(t.auto_nachrichten[0].grund, 'Zugang zum Portal wurde beendet')
})

Deno.test('Privates Objekt, fehlende Adresse, fehlende Vorlage: nichts senden', async () => {
  const mails: string[] = []
  const t = stand()
  t.objekte[0].privat_besitzer = 'jemand@beispiel.de' as unknown as null
  await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async (to) => void mails.push(to))
  assertEquals(t.auto_nachrichten[0].status, 'abgebrochen')

  const t2 = stand()
  await versendeAutoNachrichten(fakeAdmin(t2, () => ({ ...bauenOk(null), an: null })), async (to) => void mails.push(to))
  assertEquals(t2.auto_nachrichten[0].status, 'ohne_adresse')

  const t3 = stand()
  await versendeAutoNachrichten(fakeAdmin(t3, () => ({ ...bauenOk(null), hindernis: 'Die Mail-Vorlage fehlt.' })), async (to) => void mails.push(to))
  assertEquals(t3.auto_nachrichten[0].status, 'fehler')
  assertEquals(mails.length, 0)
})

Deno.test('Versandfehler: Zeile auf fehler, keine gesendete Mail, kein Verlauf', async () => {
  const t = stand()
  const r = await versendeAutoNachrichten(fakeAdmin(t, bauenOk), async () => {
    throw new Error('SMTP weg')
  })
  assertEquals(r.fehler, 1)
  assertEquals(t.auto_nachrichten[0].status, 'fehler')
  assertEquals(t.auto_nachrichten[0].gesendet_am, null)
  assertMatch(String(t.auto_nachrichten[0].grund), /SMTP weg/)
  assertEquals(t.gesendete_emails.length, 0)
  assertEquals(t.objekte[0].activities.length, 1)
})
