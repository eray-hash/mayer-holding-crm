// Ablauf-Tests für den Kalender-Abgleich Outlook → CRM (gleicheKalenderAb) ohne echtes Microsoft-Konto (22.11.2026):
// - Zeitfenster der vollen Runde (calendarView/delta startDateTime/endDateTime),
// - Seiten über @odata.nextLink bis zum @odata.deltaLink, auch über mehrere Läufe hinweg (stand.kalenderWeiter),
// - mehr als 1000 eigene Termine im CRM (die echte Datenbank liefert höchstens 1000 Zeilen je Abfrage).
// Microsoft ist ein kleiner Nachbau; die Datenbank liegt im Speicher (_shared/testDoppel.ts) und bekommt hier die
// 1000-Zeilen-Grenze und den eindeutigen Index termine_ms_id der echten Tabelle dazu.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { GRAPH } from '../_shared/microsoft.ts'
import { type FalscheDatenbank, falscheDatenbank, falschesMicrosoft, jsonAntwort, type MsAnfrage, TEST_DIENST_SCHLUESSEL, verbundenesKonto, type Zeile } from '../_shared/testDoppel.ts'
import { ausOutlook, fensterAdresse, gleicheKalenderAb, type MsTermin, terminHash } from './kalenderAbgleich.ts'

Deno.env.set('MS_CLIENT_ID', 'test-client-id')
Deno.env.set('MS_CLIENT_SECRET', 'test-client-geheim')
Deno.env.set('SUPABASE_URL', 'https://test-projekt.supabase.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)

const ICH = 'hasan.test@hotmail.com'
const SEITE = 100
const TAG = 86400000

/** Wie die echte Datenbank: höchstens 1000 Zeilen je Abfrage, (besitzer_email, ms_id) eindeutig. */
function mitDatenbankGrenzen(db: FalscheDatenbank): void {
  const echtFrom = db.from.bind(db)
  db.from = ((t: string) => {
    const q = echtFrom(t)
    if (t !== 'termine') return q
    // deno-lint-ignore no-explicit-any
    const a = q as any
    const echtThen = a.then.bind(a)
    const echtInsert = a.insert.bind(a)
    let doppelt = false
    a.insert = (z: Zeile | Zeile[]) => {
      const neu = Array.isArray(z) ? z : [z]
      doppelt = neu.some((n) => n.ms_id && db.tabelle('termine').some((x) => x.ms_id === n.ms_id && String(x.besitzer_email).toLowerCase() === String(n.besitzer_email).toLowerCase()))
      return echtInsert(z)
    }
    // deno-lint-ignore no-explicit-any
    a.then = (ok?: any, fehler?: any) => {
      if (doppelt) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "termine_ms_id"' } }).then(ok, fehler)
      if (a.art === 'select' && (a.grenze == null || a.grenze > 1000)) a.limit(1000)
      return echtThen(ok, fehler)
    }
    return q
  }) as typeof db.from
}

/** Outlook-Termin in deutscher Zeit, `tage` ab heute um 10 Uhr. */
function termin(id: string, tage: number, titel = `Termin ${id}`, geaendert = '2026-11-01T08:00:00Z'): MsTermin {
  const tag = new Date(Date.now() + tage * TAG).toISOString().slice(0, 10)
  return {
    id,
    subject: titel,
    type: 'singleInstance',
    start: { dateTime: `${tag}T10:00:00.0000000`, timeZone: 'W. Europe Standard Time' },
    end: { dateTime: `${tag}T11:00:00.0000000`, timeZone: 'W. Europe Standard Time' },
    lastModifiedDateTime: geaendert,
  }
}

/** Nachbau von /me/calendarView/delta: volle Runde in Seiten zu 100, danach Änderungen über $deltatoken. */
class FalscherKalender {
  termine: MsTermin[] = []
  aenderungen: MsTermin[] = []
  verzoegerung = 0
  fehlerBeiSeite: number | null = null
  abfragen: MsAnfrage[] = []
  private runde = 0

  router = async (a: MsAnfrage) => {
    if (a.weg !== '/me/calendarView/delta' || a.methode !== 'GET') return jsonAntwort({ error: { message: `unerwartet: ${a.methode} ${a.weg}` } }, 400)
    this.abfragen.push(a)
    if (this.verzoegerung) await new Promise((r) => setTimeout(r, this.verzoegerung))
    if (a.abfrage.has('$deltatoken')) {
      const value = this.aenderungen
      this.aenderungen = []
      return { value, '@odata.deltaLink': `${GRAPH}/me/calendarView/delta?$deltatoken=t${++this.runde}` }
    }
    const seite = a.abfrage.has('$skiptoken') ? Number(a.abfrage.get('$skiptoken')) : 0
    if (!a.abfrage.has('$skiptoken') && !a.abfrage.has('startDateTime')) return jsonAntwort({ error: { message: 'Fenster fehlt' } }, 400)
    if (this.fehlerBeiSeite === seite) {
      this.fehlerBeiSeite = null
      return jsonAntwort({ error: { message: 'kaputt' } }, 500)
    }
    const value = this.termine.slice(seite * SEITE, (seite + 1) * SEITE)
    const weiter = (seite + 1) * SEITE < this.termine.length
    return weiter ? { value, '@odata.nextLink': `${GRAPH}/me/calendarView/delta?$skiptoken=${seite + 1}` } : { value, '@odata.deltaLink': `${GRAPH}/me/calendarView/delta?$deltatoken=t${++this.runde}` }
  }
}

async function lauf(db: FalscheDatenbank, k: FalscherKalender, budgetMs?: number) {
  const ms = falschesMicrosoft(k.router)
  const ab = k.abfragen.length
  try {
    const bericht = await gleicheKalenderAb(db, ICH, budgetMs)
    return { bericht, abfragen: k.abfragen.slice(ab), schreibend: ms.aufrufe.filter((x) => x.art === 'graph' && x.methode !== 'GET') }
  } finally {
    ms()
  }
}

async function neueWelt(anzahl: number): Promise<{ db: FalscheDatenbank; k: FalscherKalender }> {
  const db = falscheDatenbank({ termine: [], ms_loeschungen: [] })
  mitDatenbankGrenzen(db)
  await verbundenesKonto(db, ICH)
  const k = new FalscherKalender()
  for (let i = 0; i < anzahl; i++) k.termine.push(termin(`E${String(i).padStart(4, '0')}`, 1 + (i % 400)))
  return { db, k }
}

const stand = (db: FalscheDatenbank) => db.tabelle('ms_konten').find((z) => z.login_email === ICH)!.stand as Record<string, unknown>
const eigene = (db: FalscheDatenbank) => db.tabelle('termine').filter((z) => z.besitzer_email === ICH)

Deno.test('Fenster: 60 Tage zurück bis 548 Tage (18 Monate) voraus', () => {
  const jetzt = Date.parse('2026-11-22T20:00:00Z')
  const f = fensterAdresse(jetzt)
  assertEquals(f.vonTag, '2026-09-23T20:00:00.000Z')
  assertEquals(f.bisTag, '2028-05-23T20:00:00.000Z')
  assertEquals(f.url, '/me/calendarView/delta?startDateTime=2026-09-23T20:00:00.000Z&endDateTime=2028-05-23T20:00:00.000Z')
})

Deno.test('Volle Runde: alle Seiten bis zum deltaLink, Fenster in der ersten Abfrage, nichts doppelt', async () => {
  const { db, k } = await neueWelt(250)
  const r = await lauf(db, k)
  assertEquals(r.bericht.fehler, [])
  assertEquals(r.bericht.vonMicrosoft, 250)
  assertEquals(eigene(db).length, 250)
  assertEquals(r.abfragen.map((a) => a.abfrage.get('$skiptoken') ?? (a.abfrage.has('startDateTime') ? 'fenster' : '?')), ['fenster', '1', '2'])
  const von = Date.parse(r.abfragen[0].abfrage.get('startDateTime')!)
  const bis = Date.parse(r.abfragen[0].abfrage.get('endDateTime')!)
  assert(Math.abs(von - (Date.now() - 60 * TAG)) < 60_000, 'Fensterbeginn 60 Tage zurück')
  assert(Math.abs(bis - (Date.now() + 548 * TAG)) < 60_000, 'Fensterende 548 Tage voraus')
  assert(String((stand(db).kalenderDelta as { link: string }).link).includes('$deltatoken='))
  assertEquals(stand(db).kalenderWeiter, null)
  assertEquals(r.schreibend, [])
  // Nächster Lauf: nur die Änderungsabfrage, keine neuen Zeilen
  const r2 = await lauf(db, k)
  assertEquals(r2.abfragen.length, 1)
  assert(r2.abfragen[0].abfrage.has('$deltatoken'))
  assertEquals(eigene(db).length, 250)
})

Deno.test('Zeit reicht nicht für alle Seiten: nächster Lauf macht bei der gemerkten Seite weiter statt von vorn', async () => {
  const { db, k } = await neueWelt(250)
  k.verzoegerung = 120
  const r1 = await lauf(db, k, 180)
  assertEquals(r1.abfragen.length, 2)
  assertEquals(eigene(db).length, 200)
  assertEquals(stand(db).kalenderDelta, null)
  const weiter = stand(db).kalenderWeiter as { link: string; voll: boolean; seit: string }
  assert(weiter.link.endsWith('$skiptoken=2'))
  assertEquals(weiter.voll, true)
  k.verzoegerung = 0
  const r2 = await lauf(db, k)
  assertEquals(r2.bericht.fehler, [])
  assertEquals(r2.abfragen.length, 1)
  assertEquals(r2.abfragen[0].abfrage.get('$skiptoken'), '2')
  assertEquals(eigene(db).length, 250)
  assert(String((stand(db).kalenderDelta as { link: string }).link).includes('$deltatoken='))
  assertEquals((stand(db).kalenderDelta as { seit: string }).seit, weiter.seit)
  assertEquals(stand(db).kalenderWeiter, null)
})

Deno.test('Fehler mitten in der Runde: die fehlgeschlagene Seite wird beim nächsten Lauf erneut geholt', async () => {
  const { db, k } = await neueWelt(250)
  k.fehlerBeiSeite = 1
  const r1 = await lauf(db, k)
  assertEquals(r1.bericht.fehler.length, 1)
  assertEquals(eigene(db).length, 100)
  assert((stand(db).kalenderWeiter as { link: string }).link.endsWith('$skiptoken=1'))
  const r2 = await lauf(db, k)
  assertEquals(r2.bericht.fehler, [])
  assertEquals(r2.abfragen.map((a) => a.abfrage.get('$skiptoken')), ['1', '2'])
  assertEquals(eigene(db).length, 250)
})

Deno.test('Mehr als 1000 eigene Termine: Änderung und Löschung aus Outlook erreichen auch Termin Nr. 1001 und folgende', async () => {
  const db = falscheDatenbank({ termine: [], ms_loeschungen: [] })
  mitDatenbankGrenzen(db)
  await verbundenesKonto(db, ICH, { konto: { stand: { kalenderDelta: { link: `${GRAPH}/me/calendarView/delta?$deltatoken=alt`, seit: new Date().toISOString() } } } })
  for (let i = 0; i < 1100; i++) {
    const nr = String(i).padStart(4, '0')
    const t = termin(`E${nr}`, 1 + (i % 400))
    const f = ausOutlook(t)
    db.tabelle('termine').push({ id: `t${nr}`, ...f, beschreibung: '', besitzer_email: ICH, teilnehmer: [], kunde_id: null, kunde_bereich: null, gast: null, quelle: 'outlook', ms_id: t.id, ms_hash: await terminHash(f), ms_geaendert: t.lastModifiedDateTime, ms_teilnehmer: [], ms_serie: false, ms_vorgemerkt: null, geaendert_am: '2026-11-01T08:00:00Z' })
  }
  const k = new FalscherKalender()
  k.aenderungen = [termin('E1050', 1 + (1050 % 400), 'Verschoben und umbenannt', new Date().toISOString()), { id: 'E1099', '@removed': { reason: 'deleted' } }]
  const r = await lauf(db, k)
  assertEquals(r.bericht.fehler, [])
  assertEquals(r.bericht.vonMicrosoft, 1)
  assertEquals(r.bericht.geloescht, 1)
  assertEquals(eigene(db).length, 1099)
  assertEquals(eigene(db).find((z) => z.id === 't1050')!.titel, 'Verschoben und umbenannt')
  assert(!eigene(db).some((z) => z.id === 't1099'))
  // Unveränderte Termine gehen nicht zurück an Outlook
  assertEquals(r.schreibend, [])
})
