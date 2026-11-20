// Prüft die Microsoft-Anbindung (Outlook/Hotmail im Bereich Privat) ohne echtes Microsoft-Konto:
// Microsoft wird über ein falsches fetch nachgestellt, die Datenbank liegt im Speicher (_shared/testDoppel.ts).
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { entschluessele } from '../_shared/geheim.ts'
import { graph, graphAlle, MsFehler, MsNichtVerbunden, msZugang } from '../_shared/microsoft.ts'
import { falscheDatenbank, falschesMicrosoft, jsonAntwort, type MsAnfrage, type MsRouter, TEST_DIENST_SCHLUESSEL, verbundenesKonto, type FalscheDatenbank } from '../_shared/testDoppel.ts'
import { outlookAktion } from './outlook.ts'

Deno.env.set('MS_CLIENT_ID', 'test-client-id')
Deno.env.set('MS_CLIENT_SECRET', 'test-client-geheim')
Deno.env.set('SUPABASE_URL', 'https://test-projekt.supabase.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)

const ICH = 'hasan.test@hotmail.com'
const KOLLEGE = 'kollege@amayer-holding.com'

// ---------- Hilfen ----------

function adr(address: string, name = '') {
  return { emailAddress: { name: name || address, address } }
}

function mail(id: string, von: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: `K-${id}`,
    internetMessageId: `<${id}@test.invalid>`,
    subject: 'Hallo',
    from: adr(von),
    sender: adr(von),
    toRecipients: [adr(ICH)],
    ccRecipients: [],
    receivedDateTime: '2026-11-19T10:00:00Z',
    bodyPreview: 'Vorschau',
    hasAttachments: false,
    isRead: false,
    inferenceClassification: 'focused',
    flag: { flagStatus: 'notFlagged' },
    webLink: `https://outlook.live.com/owa/?ItemID=${id}`,
    ...extra,
  }
}

/** Gesendete Elemente: eine Unterhaltung ging an info@ (Mayer), eine per Cc an IMMO@ (Großschreibung), eine privat. */
function gesendet() {
  return [
    { conversationId: 'K-MAYER', toRecipients: [adr('info@amayer-holding.com')] },
    { conversationId: 'K-MAYER-CC', toRecipients: [adr('jemand@beispiel.de')], ccRecipients: [adr('IMMO@amayer-holding.com')] },
    { conversationId: 'K-PRIVAT', toRecipients: [adr('freund@gmx.de')] },
  ]
}

async function grundDb(extra: Record<string, Record<string, unknown>[]> = {}): Promise<FalscheDatenbank> {
  const db = falscheDatenbank({
    postfaecher: [
      { id: 'pf-info', adresse: 'info@amayer-holding.com' },
      { id: 'pf-immo', adresse: 'immo@amayer-holding.com' },
    ],
    mitarbeiter: [
      { id: 'ma-ich', email: ICH },
      { id: 'ma-kollege', email: KOLLEGE },
      { id: 'ma-leer', email: null },
    ],
    ...extra,
  })
  await verbundenesKonto(db, ICH)
  return db
}

/** Router mit „Gesendete Elemente“; Erneuern ist hier nicht erwartet (der Zugang ist gültig). */
function mitGesendet(weiter: MsRouter): MsRouter {
  return (a) => {
    if (a.art === 'token') throw new Error('Unerwartete Erneuerung des Zugangs')
    if (a.methode === 'GET' && a.weg === '/me/mailFolders/sentitems/messages') return { value: gesendet() }
    return weiter(a)
  }
}

async function mitMicrosoft(router: MsRouter, fn: (aufrufe: MsAnfrage[]) => Promise<void>): Promise<void> {
  const ms = falschesMicrosoft(router)
  try {
    await fn(ms.aufrufe)
  } finally {
    ms()
  }
}

const graphAufrufe = (aufrufe: MsAnfrage[], weg: string, methode = 'GET') => aufrufe.filter((a) => a.art === 'graph' && a.weg === weg && a.methode === methode)
const tokenAufrufe = (aufrufe: MsAnfrage[]) => aufrufe.filter((a) => a.art === 'token')

// ---------- Testdoppel selbst ----------

Deno.test('Testdoppel: unbekannte Adressen werfen (kein echtes Netz)', async () => {
  await mitMicrosoft(() => ({}), async () => {
    await assertRejects(() => fetch('https://example.com/'), Error, 'unerlaubter Netzzugriff')
    await assertRejects(() => fetch('https://test-projekt.supabase.invalid/rest/v1/x'), Error, 'unerlaubter Netzzugriff')
  })
})

Deno.test('Testdoppel: or(is.null, lt) wie in msZugang, Eindeutigkeit, update…select', async () => {
  const db = falscheDatenbank({
    ms_konten: [
      { login_email: 'a@x.de', erneuerung_seit: null },
      { login_email: 'b@x.de', erneuerung_seit: '2026-11-20T09:00:00.000Z' },
      { login_email: 'c@x.de', erneuerung_seit: '2026-11-20T11:00:00.000Z' },
    ],
  })
  const { data } = await db.from('ms_konten').select('login_email').or('erneuerung_seit.is.null,erneuerung_seit.lt.2026-11-20T10:00:00.000Z')
  assertEquals((data as { login_email: string }[]).map((z) => z.login_email), ['a@x.de', 'b@x.de'])
  const r = await db.from('ms_konten').update({ erneuerung_seit: 'jetzt' }).eq('login_email', 'c@x.de').or('erneuerung_seit.is.null,erneuerung_seit.lt.2026-11-20T10:00:00.000Z').select('login_email')
  assertEquals(r.data, [])
  await db.from('eingegangene_emails').insert({ message_id: 'm1' })
  const doppelt = await db.from('eingegangene_emails').insert({ message_id: 'm1' })
  assertEquals(doppelt.error?.code, '23505')
  assertEquals(db.tabellen.eingegangene_emails.length, 1)
})

// ---------- Zugang ----------

Deno.test('Zugang: gültiger Schlüssel → keine Erneuerung', async () => {
  const db = await grundDb()
  await mitMicrosoft((a) => (a.weg === '/me' ? { displayName: 'Test' } : undefined), async (aufrufe) => {
    await graph(db, ICH, '/me')
    assertEquals(tokenAufrufe(aufrufe).length, 0)
    assertEquals(aufrufe[0].kopf.authorization, 'Bearer z1')
  })
})

Deno.test('Zugang: abgelaufen → genau eine Erneuerung, neuer Erneuerungsschlüssel gespeichert, Sperre wieder frei', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: Date.now() - 1000 } })
  await mitMicrosoft((a) => {
    if (a.art === 'token') return { access_token: 'z2', refresh_token: 'r2', expires_in: 3600 }
    if (a.weg === '/me') return { displayName: 'Test' }
  }, async (aufrufe) => {
    const vorher = Date.now()
    await graph(db, ICH.toUpperCase(), '/me')
    const t = tokenAufrufe(aufrufe)
    assertEquals(t.length, 1)
    assertEquals(t[0].methode, 'POST')
    assertEquals(t[0].url, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token')
    assertEquals(t[0].form.get('grant_type'), 'refresh_token')
    assertEquals(t[0].form.get('refresh_token'), 'r1')
    assertEquals(t[0].form.get('client_id'), 'test-client-id')
    assertEquals(t[0].form.get('client_secret'), 'test-client-geheim')
    assert(t[0].form.get('scope')!.split(' ').includes('offline_access'))
    assertEquals(graphAufrufe(aufrufe, '/me')[0].kopf.authorization, 'Bearer z2')

    const geheim = db.tabellen.ms_geheimnisse.find((z) => z.login_email === ICH)!
    const z = JSON.parse(await entschluessele(String(geheim.verschluesselt)))
    assertEquals(z.erneuerung, 'r2')
    assertEquals(z.zugang, 'z2')
    assert(z.ablauf >= vorher + (3600 - 120) * 1000 && z.ablauf <= Date.now() + (3600 - 120) * 1000)
    assertEquals(db.tabellen.ms_konten.find((k) => k.login_email === ICH)!.erneuerung_seit, null)
  })
})

Deno.test('Zugang: Microsoft gibt keinen neuen Erneuerungsschlüssel → der alte bleibt', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 } })
  await mitMicrosoft((a) => (a.art === 'token' ? { access_token: 'z2', expires_in: 3600 } : undefined), async () => {
    assertEquals(await msZugang(db, ICH), 'z2')
    const z = JSON.parse(await entschluessele(String(db.tabellen.ms_geheimnisse[0].verschluesselt)))
    assertEquals(z.erneuerung, 'r1')
  })
})

Deno.test('Zugang: invalid_grant → letzter_fehler vermerkt, MsNichtVerbunden, Sperre frei, Geheimnis unverändert', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 } })
  const vorher = db.tabellen.ms_geheimnisse[0].verschluesselt
  await mitMicrosoft(
    (a) => (a.art === 'token' ? jsonAntwort({ error: 'invalid_grant', error_description: 'AADSTS70000: The refresh token has expired.\r\nTrace ID: x' }, 400) : undefined),
    async (aufrufe) => {
      await assertRejects(() => msZugang(db, ICH), MsNichtVerbunden)
      assertEquals(tokenAufrufe(aufrufe).length, 1)
      const konto = db.tabellen.ms_konten.find((k) => k.login_email === ICH)!
      assert(String(konto.letzter_fehler).includes('abgelaufen'))
      assertEquals(konto.erneuerung_seit, null)
      assertEquals(db.tabellen.ms_geheimnisse[0].verschluesselt, vorher)
    },
  )
})

Deno.test('Zugang: anderer Fehler beim Erneuern (500) wird weitergereicht, Konto nicht als getrennt markiert', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 } })
  await mitMicrosoft((a) => (a.art === 'token' ? jsonAntwort({ error: 'temporarily_unavailable' }, 500) : undefined), async () => {
    const e = await assertRejects(() => msZugang(db, ICH), MsFehler)
    assertEquals(e.status, 500)
    const konto = db.tabellen.ms_konten[0]
    assertEquals(konto.letzter_fehler, null)
    assertEquals(konto.erneuerung_seit, null)
  })
})

Deno.test('Zugang: kein Geheimnis gespeichert → MsNichtVerbunden ohne Netz', async () => {
  const db = falscheDatenbank()
  await mitMicrosoft(() => undefined, async (aufrufe) => {
    await assertRejects(() => msZugang(db, ICH), MsNichtVerbunden)
    assertEquals(aufrufe.length, 0)
  })
})

Deno.test('Zugang: zwei gleichzeitige Aufrufe mit abgelaufenem Schlüssel → nur eine Erneuerung', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 } })
  let aktuell = 'r1'
  let n = 1
  await mitMicrosoft((a) => {
    if (a.art !== 'token') return undefined
    if (a.form.get('refresh_token') !== aktuell) return jsonAntwort({ error: 'invalid_grant' }, 400)
    n++
    aktuell = `r${n}`
    return { access_token: `z${n}`, refresh_token: aktuell, expires_in: 3600 }
  }, async (aufrufe) => {
    const [x, y] = await Promise.all([msZugang(db, ICH), msZugang(db, ICH)])
    assertEquals([x, y], ['z2', 'z2'])
    assertEquals(tokenAufrufe(aufrufe).length, 1)
    assertEquals(db.tabellen.ms_konten[0].letzter_fehler, null)
  })
})

Deno.test('Zugang: Sperre eines anderen (frisch) → warten und dessen Schlüssel nehmen, selbst nicht erneuern', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 }, konto: { erneuerung_seit: new Date().toISOString() } })
  await mitMicrosoft(() => undefined, async (aufrufe) => {
    // Der „andere“ wird nach 300 ms fertig.
    const fertig = new Promise<void>((ok) =>
      setTimeout(async () => {
        await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r9', zugang: 'z9', ablauf: Date.now() + 3600e3 } })
        ok()
      }, 300)
    )
    assertEquals(await msZugang(db, ICH), 'z9')
    await fertig
    assertEquals(tokenAufrufe(aufrufe).length, 0)
  })
})

Deno.test('Zugang: alte Sperre (älter als 1 Minute) wird übernommen', async () => {
  const db = await grundDb()
  await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 }, konto: { erneuerung_seit: new Date(Date.now() - 120_000).toISOString() } })
  await mitMicrosoft((a) => (a.art === 'token' ? { access_token: 'z2', refresh_token: 'r2', expires_in: 3600 } : undefined), async (aufrufe) => {
    assertEquals(await msZugang(db, ICH), 'z2')
    assertEquals(tokenAufrufe(aufrufe).length, 1)
    assertEquals(db.tabellen.ms_konten[0].erneuerung_seit, null)
  })
})

// FEHLER (nicht behoben, nur belegt): msZugang (_shared/microsoft.ts:211–227) liest den Zugang VOR dem Holen der
// Sperre und erneuert danach mit diesem alten Erneuerungsschlüssel. Ist ein zweiter Aufruf zwischen „Zugang lesen“
// und „Sperre holen“, während der erste seine Erneuerung abschließt und die Sperre freigibt, bekommt der zweite die
// Sperre und schickt den inzwischen ersetzten Schlüssel r1 → invalid_grant → Konto wird fälschlich als „abgelaufen,
// bitte neu verbinden“ markiert und der Aufruf wirft MsNichtVerbunden. Richtig wäre: nach dem Holen der Sperre den
// Zugang neu lesen (und ihn nehmen, wenn er inzwischen gültig ist).
Deno.test({
  name: 'BEHOBEN Zugang: Wettlauf — zweiter Aufruf erneuert mit veraltetem Erneuerungsschlüssel',
  fn: async () => {
    const db = await grundDb()
    await verbundenesKonto(db, ICH, { zugang: { erneuerung: 'r1', zugang: 'z1', ablauf: 0 } })
    let aktuell = 'r1'
    let n = 1
    let geheimLesen = 0
    // Der zweite Lesezugriff auf ms_geheimnisse (Aufruf B) kommt mit dem alten Stand erst nach 150 ms zurück —
    // bis dahin hat Aufruf A erneuert, gespeichert und die Sperre freigegeben.
    db.nachAbfrage = async (i) => {
      if (i.tabelle === 'ms_geheimnisse' && i.art === 'select' && ++geheimLesen === 2) await new Promise((r) => setTimeout(r, 150))
    }
    await mitMicrosoft((a) => {
      if (a.art !== 'token') return undefined
      if (a.form.get('refresh_token') !== aktuell) return jsonAntwort({ error: 'invalid_grant', error_description: 'AADSTS70000: token already redeemed' }, 400)
      n++
      aktuell = `r${n}`
      return { access_token: `z${n}`, refresh_token: aktuell, expires_in: 3600 }
    }, async (aufrufe) => {
      const ergebnisse = await Promise.allSettled([msZugang(db, ICH), msZugang(db, ICH)])
      assertEquals(ergebnisse.map((e) => e.status), ['fulfilled', 'fulfilled'])
      assertEquals(db.tabellen.ms_konten[0].letzter_fehler, null)
      assertEquals(tokenAufrufe(aufrufe).length, 1)
    })
  },
})

// ---------- graph() ----------

Deno.test('graph: 429 mit Retry-After 0 wird wiederholt', async () => {
  const db = await grundDb()
  let n = 0
  await mitMicrosoft((a) => {
    if (a.weg !== '/me') return undefined
    return ++n === 1 ? jsonAntwort({ error: { code: 'TooManyRequests', message: 'langsamer' } }, 429, { 'retry-after': '0' }) : { displayName: 'Hasan' }
  }, async (aufrufe) => {
    const ich = await graph<{ displayName: string }>(db, ICH, '/me')
    assertEquals(ich.displayName, 'Hasan')
    assertEquals(graphAufrufe(aufrufe, '/me').length, 2)
    assertEquals(tokenAufrufe(aufrufe).length, 0)
  })
})

Deno.test('graph: 401 → einmal erzwungen erneuern, dann klappt es', async () => {
  const db = await grundDb()
  await mitMicrosoft((a) => {
    if (a.art === 'token') return { access_token: 'z2', refresh_token: 'r2', expires_in: 3600 }
    if (a.weg !== '/me') return undefined
    return a.kopf.authorization === 'Bearer z2' ? { displayName: 'Hasan' } : jsonAntwort({ error: { code: 'InvalidAuthenticationToken', message: 'abgelaufen' } }, 401)
  }, async (aufrufe) => {
    assertEquals((await graph<{ displayName: string }>(db, ICH, '/me')).displayName, 'Hasan')
    const me = graphAufrufe(aufrufe, '/me')
    assertEquals(me.map((a) => a.kopf.authorization), ['Bearer z1', 'Bearer z2'])
    assertEquals(tokenAufrufe(aufrufe).length, 1)
    assertEquals(tokenAufrufe(aufrufe)[0].form.get('refresh_token'), 'r1')
    assertEquals(db.tabellen.ms_konten[0].erneuerung_seit, null)
  })
})

Deno.test('graph: zweimal 401 → MsFehler 401, Fehler am Konto vermerkt', async () => {
  const db = await grundDb()
  await mitMicrosoft((a) => {
    if (a.art === 'token') return { access_token: 'z2', refresh_token: 'r2', expires_in: 3600 }
    return jsonAntwort({ error: { code: 'InvalidAuthenticationToken', message: 'Zugang ungültig' } }, 401)
  }, async (aufrufe) => {
    const e = await assertRejects(() => graph(db, ICH, '/me'), MsFehler)
    assertEquals(e.status, 401)
    assertEquals(tokenAufrufe(aufrufe).length, 1)
    assertEquals(db.tabellen.ms_konten[0].letzter_fehler, 'Zugang ungültig')
  })
})

Deno.test('graph: nur Graph-Adressen (auch ein nextLink auf fremden Server wird abgelehnt)', async () => {
  const db = await grundDb()
  await mitMicrosoft((a) => (a.weg === '/me/messages' ? { value: [{ id: 1 }], '@odata.nextLink': 'https://boese.example/v1.0/me/messages?$skiptoken=x' } : undefined), async (aufrufe) => {
    await assertRejects(() => graph(db, ICH, 'https://boese.example/v1.0/me'), Error, 'Nur Microsoft-Graph')
    await assertRejects(() => graphAlle(db, ICH, '/me/messages'), Error, 'Nur Microsoft-Graph')
    assertEquals(aufrufe.length, 1)
  })
})

// ---------- outlook_liste / Mayer-Regel ----------

function posteingang() {
  return [
    mail('MAIL-FREUND-01', 'freund@gmx.de', { receivedDateTime: '2026-11-19T12:00:00Z' }),
    mail('MAIL-KOLLEGE-1', KOLLEGE, { receivedDateTime: '2026-11-19T11:00:00Z' }),
    mail('MAIL-KUNDE-001', 'kunde@firma-beispiel.de', { conversationId: 'K-MAYER', receivedDateTime: '2026-11-19T10:00:00Z' }),
    mail('MAIL-SELBST-01', ICH, { conversationId: 'K-PRIVAT', receivedDateTime: '2026-11-19T09:00:00Z' }),
    mail('MAIL-HOTMAIL-1', 'nachbar@hotmail.com', { receivedDateTime: '2026-11-19T08:00:00Z' }),
  ]
}

Deno.test('outlook_liste: Mayer-Mails und Mayer-Unterhaltungen ausgeblendet, eigene Hotmail-Adresse/-Domain nicht', async () => {
  const db = await grundDb()
  await mitMicrosoft(
    mitGesendet((a) => (a.weg === '/me/mailFolders/inbox/messages' ? { value: posteingang(), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x' } : undefined)),
    async (aufrufe) => {
      const r = (await outlookAktion(db, ICH, { action: 'outlook_liste' })) as { mails: { id: string; von: { adresse: string } }[]; ausgeblendet: number; weiter: boolean; naechstesAb: number }
      assertEquals(r.mails.map((m) => m.id), ['MAIL-FREUND-01', 'MAIL-SELBST-01', 'MAIL-HOTMAIL-1'])
      assertEquals(r.ausgeblendet, 2)
      assertEquals(r.weiter, true)
      assertEquals(r.naechstesAb, 30)
      const liste = graphAufrufe(aufrufe, '/me/mailFolders/inbox/messages')[0]
      assertEquals(liste.abfrage.get('$top'), '30')
      assertEquals(liste.abfrage.get('$skip'), '0')
      assertEquals(liste.abfrage.get('$orderby'), 'receivedDateTime desc')
      // Erster Abgleich mit „Gesendet“: das letzte Jahr.
      const s = graphAufrufe(aufrufe, '/me/mailFolders/sentitems/messages')[0]
      const ab = Date.parse(s.abfrage.get('$filter')!.replace('sentDateTime ge ', ''))
      assert(Math.abs(ab - (Date.now() - 365 * 24 * 3600e3)) < 60_000)
    },
  )
})

Deno.test('outlook_liste: Mayer-Unterhaltungen werden gemerkt, zweiter Aufruf binnen 20 Min. liest „Gesendet“ nicht erneut', async () => {
  const db = await grundDb()
  await mitMicrosoft(mitGesendet((a) => (a.weg === '/me/mailFolders/inbox/messages' ? { value: posteingang() } : undefined)), async (aufrufe) => {
    await outlookAktion(db, ICH, { action: 'outlook_liste' })
    const stand = db.tabellen.ms_konten.find((k) => k.login_email === ICH)!.stand as { mayerUnterhaltungen: string[]; mayerStand: string }
    assertEquals([...stand.mayerUnterhaltungen].sort(), ['K-MAYER', 'K-MAYER-CC'])
    assert(Date.now() - Date.parse(stand.mayerStand) < 5000)
    const r2 = (await outlookAktion(db, ICH, { action: 'outlook_liste', nurUngelesen: true })) as { ausgeblendet: number }
    assertEquals(r2.ausgeblendet, 2)
    assertEquals(graphAufrufe(aufrufe, '/me/mailFolders/sentitems/messages').length, 1)
    assertEquals(graphAufrufe(aufrufe, '/me/mailFolders/inbox/messages')[1].abfrage.get('$filter'), 'isRead eq false')
  })
})

Deno.test('outlook_liste: nach 20 Min. nur ab dem letzten Stand (minus 1 h) nachlesen, alte Kennungen bleiben', async () => {
  const db = await grundDb()
  const vor30 = new Date(Date.now() - 30 * 60_000).toISOString()
  db.tabellen.ms_konten[0].stand = { mayerUnterhaltungen: ['K-ALT'], mayerStand: vor30, anderes: 1 }
  await mitMicrosoft(mitGesendet((a) => (a.weg === '/me/mailFolders/inbox/messages' ? { value: [] } : undefined)), async (aufrufe) => {
    await outlookAktion(db, ICH, { action: 'outlook_liste' })
    const s = graphAufrufe(aufrufe, '/me/mailFolders/sentitems/messages')[0]
    assertEquals(s.abfrage.get('$filter'), `sentDateTime ge ${new Date(Date.parse(vor30) - 3600e3).toISOString()}`)
    const stand = db.tabellen.ms_konten[0].stand as Record<string, unknown>
    assertEquals(stand.mayerUnterhaltungen, ['K-ALT', 'K-MAYER', 'K-MAYER-CC'])
    assertEquals(stand.anderes, 1)
  })
})

Deno.test('outlook_liste: „Gesendet“ nicht lesbar → Liste trotzdem, Absender-Regel greift weiter', async () => {
  const db = await grundDb()
  await mitMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/sentitems/messages') return jsonAntwort({ error: { code: 'ErrorAccessDenied', message: 'nein' } }, 403)
    if (a.weg === '/me/mailFolders/inbox/messages') return { value: posteingang() }
  }, async () => {
    const r = (await outlookAktion(db, ICH, { action: 'outlook_liste' })) as { mails: { id: string }[]; ausgeblendet: number }
    assertEquals(r.ausgeblendet, 1) // nur der Kollege; K-MAYER ist unbekannt
    assertEquals(r.mails.length, 4)
  })
})

Deno.test('outlook_mayer_regel: Vorgabe-Domain amayer-holding.com, ohne Freemail und ohne eigene Adresse', async () => {
  const db = await grundDb()
  await mitMicrosoft(() => undefined, async (aufrufe) => {
    const r = (await outlookAktion(db, ICH, { action: 'outlook_mayer_regel' })) as { domains: string[]; crmAdressen: number }
    assertEquals(r.domains, ['amayer-holding.com'])
    assertEquals(r.crmAdressen, 3) // info@, immo@, kollege@ — nicht die eigene Hotmail-Adresse
    assertEquals(aufrufe.length, 0)
  })
})

// FEHLER (nicht behoben, nur belegt): email-gateway/outlook.ts:64–69 nimmt die Domain des eigenen CRM-Logins aus den
// Mayer-Domains heraus. Meldet sich ein Mitarbeiter mit einer @amayer-holding.com-Adresse im CRM an (und verbindet
// privat ein Hotmail-Konto), fällt amayer-holding.com komplett aus der Regel: Mails von Mayer-Adressen, die nicht in
// postfaecher/mitarbeiter stehen (z. B. buchhaltung@amayer-holding.com), erscheinen dann im privaten Bereich.
// Erwartet: Firmen-Domains aus postfaecher bleiben Mayer-Domains; ausgenommen werden sollte nur die eigene Adresse.
Deno.test({
  name: 'BEHOBEN outlook_mayer_regel: CRM-Login bei amayer-holding.com entfernt die Mayer-Domain',
  fn: async () => {
    const login = 'mitarbeiter@amayer-holding.com'
    // Ohne Hasans Zeile in mitarbeiter, damit nur die Domain-Regel greifen könnte.
    const db = falscheDatenbank({ postfaecher: [{ id: 'pf-info', adresse: 'info@amayer-holding.com' }], mitarbeiter: [{ id: 'ma-kollege', email: KOLLEGE }] })
    await verbundenesKonto(db, login, { konto: { ms_adresse: 'mitarbeiter.privat@hotmail.com' } })
    await mitMicrosoft(
      (a) => {
        if (a.weg === '/me/mailFolders/sentitems/messages') return { value: [] }
        if (a.weg === '/me/mailFolders/inbox/messages') return { value: [mail('MAIL-BUCHH-01', 'buchhaltung@amayer-holding.com', { toRecipients: [adr('mitarbeiter.privat@hotmail.com')] })] }
      },
      async () => {
        const r = (await outlookAktion(db, login, { action: 'outlook_liste' })) as { mails: unknown[]; ausgeblendet: number }
        assertEquals(r.ausgeblendet, 1)
        assertEquals(r.mails.length, 0)
      },
    )
  },
})

// ---------- outlook_mail ----------

Deno.test('outlook_mail: Mayer-Mail → 404, normale Mail → Text (Kopf Prefer: Text)', async () => {
  const db = await grundDb()
  const mails: Record<string, unknown> = {
    'MAIL-KOLLEGE-1': mail('MAIL-KOLLEGE-1', KOLLEGE),
    'MAIL-KUNDE-001': mail('MAIL-KUNDE-001', 'kunde@firma-beispiel.de', { conversationId: 'K-MAYER' }),
    'MAIL-FREUND-01': mail('MAIL-FREUND-01', 'freund@gmx.de', { body: { contentType: 'text', content: 'Hallo Hasan,\r\n\r\n\r\n\r\nbis bald\r\n' } }),
  }
  await mitMicrosoft(
    mitGesendet((a) => {
      const m = a.weg.match(/^\/me\/messages\/([^/]+)$/)
      if (m && a.methode === 'GET') return mails[m[1]] as Record<string, unknown>
      if (m && a.methode === 'PATCH') return jsonAntwort({}, 200)
    }),
    async (aufrufe) => {
      const e1 = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_mail', id: 'MAIL-KOLLEGE-1' }), MsFehler)
      assertEquals(e1.status, 404)
      const e2 = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_mail', id: 'MAIL-KUNDE-001' }), MsFehler)
      assertEquals(e2.status, 404)
      const r = (await outlookAktion(db, ICH, { action: 'outlook_mail', id: 'MAIL-FREUND-01' })) as { mail: { text: string; id: string } }
      assertEquals(r.mail.text, 'Hallo Hasan,\n\nbis bald')
      const abruf = graphAufrufe(aufrufe, '/me/messages/MAIL-FREUND-01')[0]
      assertEquals(abruf.kopf.prefer, 'outlook.body-content-type="text"')
      assert(abruf.abfrage.get('$select')!.split(',').includes('body'))
      assertEquals(graphAufrufe(aufrufe, '/me/messages/MAIL-FREUND-01', 'PATCH').length, 0)
      // Mit alsGelesen: genau ein PATCH isRead=true.
      await outlookAktion(db, ICH, { action: 'outlook_mail', id: 'MAIL-FREUND-01', alsGelesen: true })
      const patch = graphAufrufe(aufrufe, '/me/messages/MAIL-FREUND-01', 'PATCH')
      assertEquals(patch.length, 1)
      assertEquals(patch[0].json, { isRead: true })
      // Ungültige Kennung geht gar nicht erst zu Microsoft.
      const vorher = aufrufe.length
      const e3 = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_mail', id: '../me/sendMail' }), MsFehler)
      assertEquals(e3.status, 400)
      assertEquals(aufrufe.length, vorher)
    },
  )
})

// ---------- outlook_suche ----------

Deno.test('outlook_suche: $search, Seiten über nextLink, neueste zuerst, Mayer ausgeblendet', async () => {
  const db = await grundDb()
  await mitMicrosoft(
    mitGesendet((a) => {
      if (a.weg !== '/me/messages') return undefined
      assertEquals(a.abfrage.get('$search'), '"Steuerbescheid"')
      if (!a.abfrage.get('$skiptoken')) {
        return {
          value: [mail('SUCHE-ALT-0001', 'amt@finanzamt.invalid', { receivedDateTime: '2026-11-01T08:00:00Z' }), mail('SUCHE-IMMO-001', 'immo@amayer-holding.com', { receivedDateTime: '2026-11-18T08:00:00Z' })],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$search=%22Steuerbescheid%22&$top=50&$skiptoken=SEITE2',
        }
      }
      assertEquals(a.abfrage.get('$skiptoken'), 'SEITE2')
      return { value: [mail('SUCHE-NEU-0001', 'berater@stb.invalid', { receivedDateTime: '2026-11-15T08:00:00Z' }), mail('SUCHE-KMAY-001', 'kunde@x.invalid', { conversationId: 'K-MAYER', receivedDateTime: '2026-11-19T08:00:00Z' })] }
    }),
    async (aufrufe) => {
      const r = (await outlookAktion(db, ICH, { action: 'outlook_suche', begriff: ' Steuerbescheid ' })) as { mails: { id: string }[]; ausgeblendet: number }
      assertEquals(r.mails.map((m) => m.id), ['SUCHE-NEU-0001', 'SUCHE-ALT-0001'])
      assertEquals(r.ausgeblendet, 2)
      assertEquals(graphAufrufe(aufrufe, '/me/messages').length, 2)
      await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_suche', begriff: '"' }), MsFehler, 'mindestens zwei Zeichen')
    },
  )
})

// ---------- outlook_offene_punkte ----------

Deno.test('outlook_offene_punkte: Mahnung (Sonstige) ja, Code nein, erledigt nein, Doppelte einmal, Mayer ausgeblendet', async () => {
  const db = await grundDb()
  const zurueckrufen = mail('OFFEN-RUECK-01', 'freund@gmx.de', { subject: 'Bitte zurückrufen', flag: { flagStatus: 'flagged' }, receivedDateTime: '2026-11-17T08:00:00Z' })
  await mitMicrosoft(
    mitGesendet((a) => {
      if (a.weg === '/me/mailFolders/inbox/messages') {
        return {
          value: [
            mail('OFFEN-MAHN-001', 'inkasso@firma.invalid', { subject: 'Mahnung: Ihre Rechnung 4711', inferenceClassification: 'other', receivedDateTime: '2026-11-18T08:00:00Z' }),
            mail('OFFEN-CODE-001', 'noreply@bank.invalid', { subject: 'Ihr Bestätigungscode 123456', flag: { flagStatus: 'flagged' }, receivedDateTime: '2026-11-19T08:00:00Z' }),
            mail('OFFEN-ERLED-01', 'shop@firma.invalid', { subject: 'Rechnung Oktober', flag: { flagStatus: 'complete' }, receivedDateTime: '2026-11-16T08:00:00Z' }),
            mail('OFFEN-NEWS-001', 'news@firma.invalid', { subject: 'Neuigkeiten der Woche', receivedDateTime: '2026-11-15T08:00:00Z' }),
            mail('OFFEN-MAYER-01', KOLLEGE, { subject: 'Rechnung Kunde Müller', receivedDateTime: '2026-11-14T08:00:00Z' }),
            zurueckrufen,
          ],
        }
      }
      if (a.weg === '/me/messages' && a.abfrage.get('$filter') === "flag/flagStatus eq 'flagged'") {
        return { value: [zurueckrufen, mail('OFFEN-TERMIN-1', 'arzt@praxis.invalid', { subject: 'Termin', flag: { flagStatus: 'flagged' }, receivedDateTime: '2026-11-10T08:00:00Z' })] }
      }
    }),
    async () => {
      const r = (await outlookAktion(db, ICH, { action: 'outlook_offene_punkte' })) as { mails: { id: string; art: string }[]; ausgeblendet: number; tage: number }
      assertEquals(r.mails.map((m) => m.id), ['OFFEN-MAHN-001', 'OFFEN-RUECK-01', 'OFFEN-TERMIN-1'])
      assertEquals(r.mails[0].art, 'dringend')
      assertEquals(r.ausgeblendet, 1)
      assertEquals(r.tage, 60)
    },
  )
})

// ---------- outlook_verschieben ----------

Deno.test('outlook_verschieben: Papierkorb wird abgelehnt (kein Verschieben), Archiv geht', async () => {
  const db = await grundDb()
  await mitMicrosoft(
    mitGesendet((a) => {
      if (a.weg === '/me/messages/MAIL-FREUND-01' && a.methode === 'GET') return mail('MAIL-FREUND-01', 'freund@gmx.de')
      if (a.weg === '/me/messages/MAIL-FREUND-01/move') return { id: 'MAIL-FREUND-NEU' }
    }),
    async (aufrufe) => {
      for (const ordner of ['deleteditems', 'DeletedItems']) {
        const e = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_verschieben', id: 'MAIL-FREUND-01', ordner }), MsFehler)
        assertEquals(e.status, 400)
      }
      assertEquals(aufrufe.filter((a) => a.methode !== 'GET').length, 0)
      const r = (await outlookAktion(db, ICH, { action: 'outlook_verschieben', id: 'MAIL-FREUND-01', ordner: 'archive' })) as { id: string }
      assertEquals(r.id, 'MAIL-FREUND-NEU')
      assertEquals(graphAufrufe(aufrufe, '/me/messages/MAIL-FREUND-01/move', 'POST')[0].json, { destinationId: 'archive' })
    },
  )
})

// FEHLER (nicht behoben, nur belegt): email-gateway/outlook.ts:280 prüft nur den Namen 'deleteditems'. Mit der echten
// Kennung des Ordners „Gelöschte Elemente“ (die outlook_ordner selbst liefert) wird die Mail ohne Bestätigung in den
// Papierkorb verschoben. Erwartet: auch die Kennung des Papierkorbs ablehnen (z. B. einmal
// /me/mailFolders/deleteditems?$select=id abfragen und vergleichen) — dann auch Unterordner des Papierkorbs bedenken.
Deno.test({
  name: 'BEHOBEN outlook_verschieben: Papierkorb über seine Ordner-Kennung wird nicht abgelehnt',
  fn: async () => {
    const db = await grundDb()
    await mitMicrosoft(
      mitGesendet((a) => {
        if (a.weg === '/me/messages/MAIL-FREUND-01' && a.methode === 'GET') return mail('MAIL-FREUND-01', 'freund@gmx.de')
        if (a.weg === '/me/mailFolders/deleteditems') return { id: 'ORDNER-PAPIERKORB-1' }
        if (a.weg === '/me/messages/MAIL-FREUND-01/move') return { id: 'MAIL-FREUND-NEU' }
      }),
      async (aufrufe) => {
        await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_verschieben', id: 'MAIL-FREUND-01', ordner: 'ORDNER-PAPIERKORB-1' }), MsFehler)
        assertEquals(graphAufrufe(aufrufe, '/me/messages/MAIL-FREUND-01/move', 'POST').length, 0)
      },
    )
  },
})

// ---------- outlook_ablegen ----------

function ablegenDb() {
  return grundDb({
    kunden: [
      { id: 'k-fremd', firma: 'Fremder Kontakt', bereich: 'privat', verantwortlich_email: KOLLEGE },
      { id: 'k-beratung', firma: 'Beratungskunde', bereich: 'beratung', verantwortlich_email: ICH },
      { id: 'k-eigen', firma: null, ansprechpartner: 'Familie Test', bereich: 'privat', verantwortlich_email: 'Hasan.Test@Hotmail.com' },
    ],
  })
}

function ablegenRouter(): MsRouter {
  return mitGesendet((a) => {
    if (a.weg === '/me/messages/MAIL-ABLEGEN-01') {
      return mail('MAIL-ABLEGEN-01', 'freund@gmx.de', {
        internetMessageId: '<abc123@gmx.de>',
        subject: 'Unterlagen Hauskauf',
        hasAttachments: true,
        toRecipients: [adr(ICH)],
        ccRecipients: [adr('Partner@gmx.de')],
        body: { contentType: 'text', content: 'Anbei der Vertrag.' },
      })
    }
    if (a.weg === '/me/messages/MAIL-KOLLEGE-1') return mail('MAIL-KOLLEGE-1', KOLLEGE)
    if (a.weg === '/me/messages/MAIL-ABLEGEN-01/attachments') {
      return {
        value: [
          { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANHANG-0001', name: 'Vertrag März.pdf', contentType: 'application/pdf', size: 5, isInline: false },
          { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANHANG-INLINE', name: 'logo.png', contentType: 'image/png', size: 3, isInline: true },
          { '@odata.type': '#microsoft.graph.itemAttachment', id: 'ANHANG-ITEM01', name: 'Weitergeleitet', size: 10, isInline: false },
          { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANHANG-GROSS1', name: 'Film.mp4', contentType: 'video/mp4', size: 13 * 1024 * 1024, isInline: false },
        ],
      }
    }
    if (a.weg === '/me/messages/MAIL-ABLEGEN-01/attachments/ANHANG-0001') {
      return { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANHANG-0001', name: 'Vertrag März.pdf', contentType: 'application/pdf', size: 5, contentBytes: btoa('hallo') }
    }
  })
}

Deno.test('outlook_ablegen: nur bei eigenen privaten Kontakten (sonst 403, nichts gespeichert, Mail nicht geladen)', async () => {
  const db = await ablegenDb()
  await mitMicrosoft(ablegenRouter(), async (aufrufe) => {
    for (const kundeId of ['k-fremd', 'k-beratung', 'gibt-es-nicht', '']) {
      const e = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_ablegen', id: 'MAIL-ABLEGEN-01', kundeId }), MsFehler)
      assertEquals(e.status, 403)
    }
    assertEquals(db.tabelle('eingegangene_emails').length, 0)
    assertEquals(aufrufe.filter((a) => a.weg.startsWith('/me/messages')).length, 0)
    assertEquals(db.ablage.size, 0)
  })
})

Deno.test('outlook_ablegen: Mayer-Mail lässt sich nicht ablegen (404)', async () => {
  const db = await ablegenDb()
  await mitMicrosoft(ablegenRouter(), async () => {
    const e = await assertRejects(() => outlookAktion(db, ICH, { action: 'outlook_ablegen', id: 'MAIL-KOLLEGE-1', kundeId: 'k-eigen' }), MsFehler)
    assertEquals(e.status, 404)
    assertEquals(db.tabelle('eingegangene_emails').length, 0)
  })
})

Deno.test('outlook_ablegen: eigener Kontakt → eine Zeile mit Besitzer, Anhang in privater Ablage; zweiter Aufruf ohne Doppel', async () => {
  const db = await ablegenDb()
  await mitMicrosoft(ablegenRouter(), async (aufrufe) => {
    const r = (await outlookAktion(db, ICH, { action: 'outlook_ablegen', id: 'MAIL-ABLEGEN-01', kundeId: 'k-eigen' })) as { ok: boolean; anhaenge: number; ausgelassen: string[] }
    assertEquals(r.ok, true)
    assertEquals(r.anhaenge, 1)
    assertEquals(r.ausgelassen, ['Film.mp4 (13.0 MB)'])

    const zeilen = db.tabelle('eingegangene_emails')
    assertEquals(zeilen.length, 1)
    // deno-lint-ignore no-explicit-any
    const z = zeilen[0] as Record<string, any>
    assertEquals(z.besitzer_email, ICH)
    assert(String(z.postfach_id).startsWith('ms_'))
    assertEquals(z.message_id, `${z.postfach_id}:<abc123@gmx.de>`)
    assertEquals(z.zugewiesener_bereich, 'privat')
    assertEquals(z.zugewiesener_kunde_id, 'k-eigen')
    assertEquals(z.zugewiesener_kunde_name, 'Familie Test')
    assertEquals(z.relevanz, 'kunde')
    assertEquals(z.von, 'freund@gmx.de')
    assertEquals(z.betreff, 'Unterlagen Hauskauf')
    assertEquals(z.rohdaten.quelle, 'microsoft')
    assertEquals(z.rohdaten.cc, 'partner@gmx.de')
    assert(String(z.ausschnitt).startsWith('Anbei der Vertrag.'))
    assert(String(z.ausschnitt).includes('Film.mp4'))

    assertEquals(z.anhaenge.length, 1)
    const anhang = z.anhaenge[0]
    assertEquals(anhang.filename, 'Vertrag März.pdf')
    assertEquals(anhang.size, 5)
    assert(String(anhang.url).startsWith('privat:'))
    const pfad = String(anhang.url).slice('privat:'.length)
    assertEquals(pfad.split('/')[0], z.postfach_id)
    assert(pfad.endsWith('/1_Vertrag_März.pdf'))
    const datei = db.ablage.get('postfach-anhaenge')?.get(pfad)
    assert(datei, 'Anhang liegt nicht in postfach-anhaenge')
    assertEquals(new TextDecoder().decode(datei.bytes), 'hallo')
    assertEquals(datei.contentType, 'application/pdf')
    // Inline-Bild, Element-Anhang und der zu große Film wurden nicht geladen.
    assertEquals(aufrufe.filter((a) => /\/attachments\/.+/.test(a.weg)).map((a) => a.weg), ['/me/messages/MAIL-ABLEGEN-01/attachments/ANHANG-0001'])

    const r2 = (await outlookAktion(db, ICH, { action: 'outlook_ablegen', id: 'MAIL-ABLEGEN-01', kundeId: 'k-eigen' })) as { schonAbgelegt?: boolean }
    assertEquals(r2.schonAbgelegt, true)
    assertEquals(db.tabelle('eingegangene_emails').length, 1)
    assertEquals(db.ablage.get('postfach-anhaenge')!.size, 1)
  })
})
