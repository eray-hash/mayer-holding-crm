// Fristen-Radar gegen nachgebautes Microsoft, Datenbank im Speicher und eine KI-Attrappe — ohne Netz.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { falscheDatenbank, falschesMicrosoft, TEST_DIENST_SCHLUESSEL, verbundenesKonto } from '../_shared/testDoppel.ts'
import {
  erinnerungFuer, type FristMail, fristenZeilen, fristTodoAusfuehrer, KI_HOECHSTENS, MARKE, pruefeFristen, vorfilter, werteKiAntwort, zaehlt,
} from './fristenRadar.ts'

Deno.env.set('MS_CLIENT_ID', 'test-client-id')
Deno.env.set('MS_CLIENT_SECRET', 'test-client-geheim')
Deno.env.set('SUPABASE_URL', 'https://test-projekt.supabase.invalid')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', TEST_DIENST_SCHLUESSEL)

const ICH = 'hasan.test@hotmail.com'
const JETZT = new Date('2026-11-23T06:00:00Z') // Montag, 7 Uhr in Berlin
const adr = (a: string, name = a) => ({ emailAddress: { name, address: a } })
const mail = (id: string, von: string, subject: string, extra: Partial<FristMail> = {}): FristMail => ({
  id,
  internetMessageId: `<${id}@test>`,
  conversationId: `K-${id}`,
  subject,
  from: adr(von),
  sender: adr(von),
  toRecipients: [adr(ICH)],
  ccRecipients: [],
  receivedDateTime: '2026-11-22T08:00:00Z',
  bodyPreview: '',
  inferenceClassification: 'focused',
  attachments: [],
  ...extra,
})

// ---------- Vorfilter ----------

Deno.test('Vorfilter: Ämter, Kassen und Bescheide ja — Werbung, Codes und Privates nein', () => {
  assertEquals(vorfilter(mail('1', 'poststelle@finanzamt-ulm.bwl.de', 'Ihre Steuersache')).kandidat, true)
  assertEquals(vorfilter(mail('2', 'service@aok.de', 'Nachricht von Ihrer Krankenkasse')).grund, 'absender')
  assertEquals(vorfilter(mail('3', 'info@jobcenter-ge.de', 'Einladung')).kandidat, true)
  const anhang = vorfilter(mail('4', 'freund@gmx.de', 'Weitergeleitet', { attachments: [{ name: 'Anhörung_Bußgeld.pdf' }] }))
  assertEquals([anhang.kandidat, anhang.stark], [true, true])
  assertEquals(vorfilter(mail('5', 'x@shop.de', 'Mahnung zu Ihrer Bestellung')).stark, true)
  assertEquals(vorfilter(mail('6', 'news@sparkasse.de', 'Newsletter: 20 % Rabatt')).kandidat, false)
  assertEquals(vorfilter(mail('7', 'konto@sparkasse.de', 'Ihr Bestätigungscode 123456')).grund, 'code')
  assertEquals(vorfilter(mail('8', 'freund@gmx.de', 'Treffen am Samstag?')).kandidat, false)
  assertEquals(vorfilter(mail('9', 'info@allianz.de', 'Gute Nachrichten für Sie', { inferenceClassification: 'other' })).kandidat, false)
})

// ---------- KI-Antwort ----------

Deno.test('KI-Antwort: JSON im Text, in Codeblock, als Objekt; kaputtes JSON → null', () => {
  const gut = werteKiAntwort('Hier:\n```json\n{"hat_frist": true, "frist_datum": "2026-12-05", "was_tun": "Belege über 1.234,56 € nachreichen. Danach warten.", "absender_kurz": "Finanzamt Ulm", "sicherheit": "hoch"}\n```')
  assert(gut)
  assertEquals(gut.frist_datum, '2026-12-05')
  assertEquals(gut.was_tun, 'Belege über [Betrag] nachreichen.')
  assertEquals(gut.absender_kurz, 'Finanzamt Ulm')
  assert(zaehlt(gut))
  assertEquals(werteKiAntwort('{"hat_frist": true, "frist_datum": "2026-12-05", "was_tun": "x"'), null)
  assertEquals(werteKiAntwort('Keine Frist erkennbar.'), null)
  assertEquals(werteKiAntwort('{"frist_datum": "2026-12-05"}'), null)
  assertEquals(werteKiAntwort('[1,2]'), null)
  const ohneDatum = werteKiAntwort({ hat_frist: true, frist_datum: '2026-02-30', was_tun: 'Zahlen', absender_kurz: 'AOK', sicherheit: 'hoch' })
  assertEquals([ohneDatum?.hat_frist, ohneDatum?.frist_datum], [false, null])
  const komisch = werteKiAntwort({ hat_frist: 'ja', frist_datum: '2026-12-01', was_tun: 'Antworten', absender_kurz: '', sicherheit: 'sehr hoch' })
  assertEquals([komisch?.hat_frist, komisch?.sicherheit, komisch?.absender_kurz], [true, 'niedrig', 'Absender unbekannt'])
  assertEquals(zaehlt(komisch), false)
  assertEquals(zaehlt(werteKiAntwort({ hat_frist: true, frist_datum: '2026-12-01', was_tun: 'Antworten', absender_kurz: 'AOK', sicherheit: 'mittel' })), true)
})

// ---------- Erinnerung ----------

Deno.test('Erinnerung: 2 Tage vorher 9 Uhr Berlin, nie in der Vergangenheit', () => {
  assertEquals(erinnerungFuer('2026-12-05', JETZT), '2026-12-03T08:00:00.000Z')
  assertEquals(erinnerungFuer('2027-07-10', JETZT), '2027-07-08T07:00:00.000Z') // Sommerzeit
  // Regeltermin vorbei → heute 9 Uhr (es ist 7 Uhr)
  assertEquals(erinnerungFuer('2026-11-24', JETZT), '2026-11-23T08:00:00.000Z')
  // 10 Uhr: heute 9 Uhr ist vorbei → morgen 9 Uhr, solange nicht nach der Frist
  const zehn = new Date('2026-11-23T09:00:00Z')
  assertEquals(erinnerungFuer('2026-11-24', zehn), '2026-11-24T08:00:00.000Z')
  // Frist heute, 9 Uhr vorbei → in einer Stunde, auf die Viertelstunde gerundet
  assertEquals(erinnerungFuer('2026-11-23', new Date('2026-11-23T09:07:00Z')), '2026-11-23T10:15:00.000Z')
  assertEquals(erinnerungFuer('2026-11-22', JETZT), null)
  for (const frist of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) {
    const e = erinnerungFuer(frist, JETZT)
    assert(e && Date.parse(e) > JETZT.getTime(), `${frist}: ${e}`)
  }
})

// ---------- Ganzer Lauf ----------

type Vorgemerkt = { art: string; beschreibung: string; parameter: Record<string, unknown>; quelle?: string }

async function aufbau(mails: FristMail[], antworten: Record<string, unknown>) {
  Deno.env.set('MS_ERLAUBT', ICH)
  const d = falscheDatenbank({ postfaecher: [{ id: 'standard', adresse: 'info@amayer-holding.com' }], mitarbeiter: [{ email: ICH }, { email: 'kollege@amayer-holding.com' }], privat_einstellungen: [] })
  await verbundenesKonto(d, ICH, { konto: { stand: { mayerStand: new Date().toISOString(), mayerUnterhaltungen: [] } } })
  const ms = falschesMicrosoft((a) => {
    if (a.weg === '/me/mailFolders/inbox/messages') return { value: mails }
    const m = a.weg.match(/^\/me\/messages\/(.+)$/)
    if (m) return { body: { contentType: 'text', content: `Text der Mail ${m[1]}` } }
  })
  const fragen: string[] = []
  const vorgemerkt: Vorgemerkt[] = []
  const abhaengig = {
    jetzt: JETZT,
    frageKi: (prompt: string) => {
      fragen.push(prompt)
      const id = prompt.match(/Text der Mail (\S+)/)?.[1] ?? ''
      const a = antworten[id]
      if (a instanceof Error) return Promise.reject(a)
      return Promise.resolve(a ?? '{"hat_frist": false, "frist_datum": null, "was_tun": "", "absender_kurz": "", "sicherheit": "hoch"}')
    },
    // deno-lint-ignore no-explicit-any
    merkeVor: (_admin: any, ich: string, e: Vorgemerkt) => {
      assertEquals(ich, ICH)
      vorgemerkt.push(e)
      return Promise.resolve({ id: `vm_${vorgemerkt.length}`, telegram: true })
    },
  }
  return { d, ms, fragen, vorgemerkt, abhaengig }
}

const frist = (datum: string, was: string, wer: string, sicherheit = 'hoch') => JSON.stringify({ hat_frist: true, frist_datum: datum, was_tun: was, absender_kurz: wer, sicherheit })

Deno.test('Lauf: nur Kandidaten zur KI, ohne Mayer; Frist wird vorgemerkt; jede Mail nur einmal', async () => {
  const mails = [
    mail('A1', 'poststelle@finanzamt-ulm.bwl.de', 'Anforderung von Unterlagen 2025'),
    mail('A2', 'freund@gmx.de', 'Grillen am Samstag'),
    mail('A3', 'kollege@amayer-holding.com', 'Mahnung Kunde Müller'),
    mail('A4', 'service@aok.de', 'Ihr Beitragsbescheid'),
    mail('A5', 'info@allianz.de', 'Ihre Police', { attachments: [{ name: 'Mahnung.pdf' }] }),
  ]
  const t = await aufbau(mails, {
    A1: frist('2026-12-05', 'Belege für die Steuererklärung nachreichen', 'Finanzamt Ulm'),
    A4: frist('2026-12-10', 'Bescheid prüfen', 'AOK', 'niedrig'),
    A5: 'kaputt {',
  })
  try {
    const r = await pruefeFristen(t.d, ICH, t.abhaengig)
    assertEquals(r.fehler, [])
    assertEquals(r.mails, 4) // Mayer-Mail ausgeblendet
    assertEquals([r.kandidaten, r.geprueft, r.fristen], [3, 3, 1])
    assertEquals(t.fragen.length, 3)
    assert(!t.fragen.some((p) => p.includes('Müller') || p.includes('Grillen')))
    assert(t.fragen.some((p) => p.includes('Anhänge: Mahnung.pdf')), 'Anhang-Namen gehen mit')
    assertEquals(t.vorgemerkt.length, 1)
    const v = t.vorgemerkt[0]
    assertEquals(v.art, 'frist_todo')
    assertEquals(v.beschreibung, 'Frist 05.12.: Finanzamt Ulm — Belege für die Steuererklärung nachreichen')
    assertEquals(v.parameter.erledigen_bis, '2026-12-05')
    assertEquals(v.parameter.erinnern_um, '2026-12-03T08:00:00.000Z')
    assertEquals(v.parameter.mailId, 'A1')
    assertEquals(v.parameter.absender, 'Finanzamt Ulm')
    const zeilen = t.d.tabelle('privat_fristen')
    assertEquals(zeilen.map((z) => z.ergebnis).sort(), ['frist', 'unlesbar', 'unsicher'])
    assertEquals(zeilen.find((z) => z.ergebnis === 'frist')?.vormerkung_id, 'vm_1')

    // Zweiter Lauf: nichts mehr zur KI, nichts doppelt vorgemerkt.
    const r2 = await pruefeFristen(t.d, ICH, t.abhaengig)
    assertEquals([r2.kandidaten, r2.geprueft, r2.fristen], [0, 0, 0])
    assertEquals(t.fragen.length, 3)
    assertEquals(t.vorgemerkt.length, 1)
  } finally {
    t.ms()
  }
})

Deno.test('Lauf: höchstens 15 KI-Prüfungen; Fehler werden beim nächsten Lauf wiederholt; gleiche Frist zweier Mails nur einmal', async () => {
  const viele = Array.from({ length: 20 }, (_, i) => mail(`B${i}`, 'post@finanzamt.de', `Schreiben ${i}`, { receivedDateTime: `2026-11-22T${String(i).padStart(2, '0')}:00:00Z` }))
  const t = await aufbau(viele, {
    B19: frist('2026-12-01', 'Einspruch prüfen', 'Finanzamt'),
    B18: frist('2026-12-01', 'Einspruch prüfen', 'Finanzamt'), // Erinnerungsschreiben zur selben Frist
    B17: new Error('KI-Dienst antwortet mit 529'),
    B16: frist('2026-11-20', 'Zahlen', 'Finanzamt'), // schon vorbei
  })
  try {
    const r = await pruefeFristen(t.d, ICH, t.abhaengig)
    assertEquals(t.fragen.length, KI_HOECHSTENS)
    assertEquals([r.kandidaten, r.geprueft, r.uebrig, r.fristen], [20, 14, 5, 1])
    assertEquals(r.fehler.length, 1)
    assertEquals(t.vorgemerkt.length, 1)
    const zeilen = t.d.tabelle('privat_fristen')
    assertEquals(zeilen.length, 14) // die fehlgeschlagene Mail ist wieder freigegeben
    assertEquals(zeilen.filter((z) => z.ergebnis === 'doppelt').length, 1)
    assertEquals(zeilen.filter((z) => z.ergebnis === 'vergangen').length, 1)

    // Nächster Lauf: die 5 übrigen und die fehlgeschlagene (jetzt ohne Fehler) — sonst nichts.
    const vorher = t.fragen.length
    const r2 = await pruefeFristen(t.d, ICH, { ...t.abhaengig, frageKi: (p: string) => t.abhaengig.frageKi(p.replace('B17', 'B17-ok')) })
    assertEquals(t.fragen.length - vorher, 6)
    assertEquals(r2.geprueft, 6)
    assertEquals(t.vorgemerkt.length, 1)
  } finally {
    t.ms()
  }
})

Deno.test('Lauf: ohne Freischaltung oder ohne Konto passiert nichts', async () => {
  Deno.env.set('MS_ERLAUBT', 'jemand@anders.de')
  const d = falscheDatenbank()
  const r = await pruefeFristen(d, ICH, { frageKi: () => Promise.reject(new Error('darf nicht')) })
  assertEquals(r.hinweis, 'Microsoft für diesen Login nicht freigeschaltet.')
  Deno.env.set('MS_ERLAUBT', ICH)
  const r2 = await pruefeFristen(d, ICH, { frageKi: () => Promise.reject(new Error('darf nicht')) })
  assertEquals(r2.hinweis, 'Kein Microsoft-Konto verbunden.')
})

// ---------- Ausführer ----------

Deno.test('Ausführer: legt genau ein To-do in der eigenen Liste an, auch bei zweitem Klick', async () => {
  const d = falscheDatenbank({ todos: [{ id: 'todo_alt', besitzer_email: ICH, bereich: null, reihenfolge: 7, aufgabe: 'Altes' }, { id: 'todo_ber', besitzer_email: ICH, bereich: 'beratung', reihenfolge: 50 }] })
  const p = {
    aufgabe: 'Finanzamt Ulm: Belege nachreichen',
    erledigen_bis: '2026-12-05',
    erinnern_um: '2026-11-20T08:00:00.000Z', // inzwischen vorbei → neu gerechnet
    mailId: 'A1',
    mailSchluessel: '<A1@test>',
    absender: 'Finanzamt Ulm',
    betreff: 'Anforderung von Unterlagen über 500 €',
    eingang: '2026-11-22',
  }
  const text = await fristTodoAusfuehrer(d, ICH, p, JETZT)
  assertStringIncludes(text, 'To-do angelegt')
  assertStringIncludes(text, '05.12.2026')
  const zweit = await fristTodoAusfuehrer(d, ICH.toUpperCase(), p, JETZT)
  assertStringIncludes(zweit, 'Schon in deiner To-do-Liste')
  const neu = d.tabelle('todos').filter((z) => String(z.id).startsWith('todo_frist'))
  assertEquals(neu.length, 1)
  const t = neu[0]
  assertEquals([t.besitzer_email, t.bereich, t.reihenfolge, t.prio, t.erledigen_bis], [ICH, null, 8, 'A', '2026-12-05'])
  assertEquals(t.erinnern_um, '2026-12-03T08:00:00.000Z')
  assertStringIncludes(String(t.aktueller_stand), `${MARKE}Finanzamt Ulm vom 22.11.2026`)
  assert(!String(t.aktueller_stand).includes('500'), 'kein Betrag')
})

// ---------- Morgenplan ----------

Deno.test('Morgenplan: nur Radar-Fristen der nächsten 14 Tage, offen, eigene Liste, höchstens 5 Zeilen', async () => {
  const radar = (id: string, bis: string, extra: Record<string, unknown> = {}) => ({ id, besitzer_email: ICH, bereich: null, erledigt_am: null, aufgabe: `Aufgabe ${id}`, erledigen_bis: bis, aktueller_stand: `${MARKE}AOK`, ...extra })
  const d = falscheDatenbank({
    todos: [
      radar('t1', '2026-11-25'),
      radar('t2', '2026-11-23'),
      radar('t3', '2026-12-20'), // zu weit weg
      radar('t4', '2026-11-30', { erledigt_am: '2026-11-22' }),
      radar('t5', '2026-11-26', { aktueller_stand: 'Telefonat' }), // nicht aus dem Radar
      radar('t6', '2026-11-26', { bereich: 'beratung' }),
      radar('t7', '2026-11-20'), // überfällig
      radar('t8', '2026-11-24', { besitzer_email: 'anders@x.de' }),
    ],
  })
  const zeilen = await fristenZeilen(d, ICH, JETZT)
  assertEquals(zeilen, [
    '• Fr 20.11. (überfällig seit 20.11.): Aufgabe t7',
    '• Mo 23.11. (heute): Aufgabe t2',
    '• Mi 25.11. (in 2 Tagen): Aufgabe t1',
  ])
  const viele = falscheDatenbank({ todos: Array.from({ length: 8 }, (_, i) => radar(`v${i}`, `2026-11-2${i + 2}`)) })
  const z2 = await fristenZeilen(viele, ICH, JETZT)
  assertEquals(z2.length, 5)
  assertEquals(z2[4], '… und 4 weitere in der To-do-Liste')
  assertEquals(await fristenZeilen(falscheDatenbank(), ICH, JETZT), [])
})
