import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  ABGELAUFEN,
  BEENDET,
  beantworteKundenPortal,
  fehlendMitLink,
  kundenPortalDokument,
  kundenPortalLaden,
  kundenPortalNachricht,
  NACHRICHT_MAX_JE_TAG,
  speicherOrt,
  standFuerKunden,
  UNGUELTIG,
  type KundenPortalSeite,
} from './kundenPortal.ts'
import { falscheDatenbank, type Zeile } from '../_shared/testDoppel.ts'

const BASIS = 'https://projekt.supabase.co'
const T = (z: string) => z.repeat(43)
const TOK = T('A')
const TOK_WIDERRUFEN = T('B')
const TOK_ABGELAUFEN = T('C')
const TOK_PRIVAT = T('D')
const TOK_K2 = T('E')
const TOK_ANF = T('F')
const TOK_ANF_ALT = T('G')
const TOK_U = T('H')
const TOK_U_ALT = T('I')

const JETZT = new Date()
const tag = (n: number) => new Date(JETZT.getTime() + n * 86400000).toISOString().slice(0, 10)
const zeit = (stunden: number) => new Date(JETZT.getTime() + stunden * 3600000).toISOString()
const HEUTE = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(JETZT)

function stand(): Record<string, Zeile[]> {
  return {
    kunden_portal_zugaenge: [
      { id: 'z1', token: TOK, kunde_id: 'k1', kunde_bereich: 'beratung', status: 'aktiv', gueltig_bis: zeit(24 * 100), zugriffe: 0, nachrichten_zaehler: 0, nachricht_fenster: null, letzte_nachricht_am: null },
      { id: 'z2', token: TOK_WIDERRUFEN, kunde_id: 'k1', kunde_bereich: 'beratung', status: 'widerrufen', gueltig_bis: zeit(24 * 100), zugriffe: 0, nachrichten_zaehler: 0 },
      { id: 'z3', token: TOK_ABGELAUFEN, kunde_id: 'k1', kunde_bereich: 'beratung', status: 'aktiv', gueltig_bis: zeit(-1), zugriffe: 0, nachrichten_zaehler: 0 },
      { id: 'z4', token: TOK_PRIVAT, kunde_id: 'kp', kunde_bereich: 'beratung', status: 'aktiv', gueltig_bis: zeit(24 * 100), zugriffe: 0, nachrichten_zaehler: 0 },
      { id: 'z5', token: TOK_K2, kunde_id: 'k2', kunde_bereich: 'erben', status: 'aktiv', gueltig_bis: zeit(24 * 100), zugriffe: 0, nachrichten_zaehler: 0 },
    ],
    kunden: [
      {
        id: 'k1', bereich: 'beratung', firma: 'Muster GmbH', ansprechpartner: 'Erika Muster', email: 'erika@example.de', telefon: '0170 111',
        verantwortlich: 'Hasan Süslü', verantwortlich_email: 'Hasan@Amayer-Holding.com', status: 'aktives_mandat',
        naechste_schritte: 'Konzept fertigstellen\nProvision mit Walter klären GEHEIM_A\nHonorar 5.000 € abrechnen GEHEIM_B',
        dienstleistungen: ['Gründungsberatung'],
        activities: [{ id: 'a1', date: HEUTE, text: 'Interne Notiz: Kunde zahlt schlecht GEHEIM_C', user: 'Hasan Süslü' }],
        dokumente: [
          { id: 'd_frei', name: 'Konzept.pdf', typ: 'application/pdf', datum: tag(-3), groesse: '1 MB', url: 'k1/konzept.pdf', fuerKunde: true },
          { id: 'd_intern', name: 'Bonität GEHEIM_D.pdf', typ: 'application/pdf', datum: tag(-2), groesse: '1 MB', url: 'k1/bonitaet.pdf' },
          { id: 'd_rech', name: 'Rechnung R-1.pdf', typ: 'application/pdf', datum: tag(-1), groesse: '50 KB', url: 'k1/r1.pdf' },
          { id: 'd_privat', name: 'Privat GEHEIM_E.pdf', typ: 'application/pdf', datum: tag(-1), groesse: '1 KB', url: 'privat:hasan/x.pdf', fuerKunde: true },
          { id: 'd_fremd', name: 'Fremd GEHEIM_F.pdf', typ: 'application/pdf', datum: tag(-1), groesse: '1 KB', url: 'https://boese.example/x.pdf', fuerKunde: true },
          { id: 'd_pfad', name: 'Trick GEHEIM_G.pdf', typ: 'application/pdf', datum: tag(-1), groesse: '1 KB', url: '../../rest/v1/mitarbeiter', fuerKunde: true },
        ],
        unterlagen_anforderungen: [
          { id: 'an1', datum: tag(-5), punkte: ['Personalausweis'], token: TOK_ANF, eingang: [] },
          { id: 'an0', datum: tag(-100), punkte: ['Grundbuchauszug'], token: TOK_ANF_ALT, eingang: [] },
        ],
        unterlagen_checkliste: null,
      },
      { id: 'k2', bereich: 'erben', firma: 'Fremd', ansprechpartner: 'Otto Fremd', email: 'otto@example.de', status: 'erstkontakt', activities: [], dokumente: [{ id: 'd_k2', name: 'Testament Otto.pdf', url: 'k2/testament.pdf', fuerKunde: true }] },
      { id: 'kp', bereich: 'privat', firma: 'Privatkontakt', ansprechpartner: 'Privat', activities: [], dokumente: [] },
    ],
    mitarbeiter: [
      { name: 'Hasan Süslü', email: 'hasan@amayer-holding.com', telefon: '0731 123 45', telegram_chat_id: 42, aktiv: true },
      { name: 'Walter Meier', email: 'walter@amayer-holding.com', telefon: '', telegram_chat_id: 43, aktiv: true },
    ],
    wiedervorlagen: [
      { id: 'w1', kunde_id: 'k1', regel: null, titel: 'Geldeingang prüfen GEHEIM_H', faellig: tag(1), erledigt_am: null },
      { id: 'w2', kunde_id: 'k1', regel: 'ber_erste_sitzung', titel: 'Erste Sitzung', faellig: tag(2), erledigt_am: null },
    ],
    gesendete_emails: [
      { id: 'm1', kunde_id: 'k1', an: 'Erika Muster <erika@example.de>', betreff: 'Ihre Unterlagen', gesendet_am: zeit(-24), besitzer_email: null },
      { id: 'm2', kunde_id: 'k1', an: 'notar@kanzlei.de', betreff: 'Steuerfrage GEHEIM_I', gesendet_am: zeit(-24), besitzer_email: null },
    ],
    termine: [
      { id: 't1', kunde_id: 'k1', titel: 'Besprechung Konzept', beginn: zeit(48), ende: zeit(49), ganztags: false, ort: 'Ulm', gast: { email: 'erika@example.de', eingeladen: true } },
      { id: 't2', kunde_id: 'k1', titel: 'Erika anrufen GEHEIM_J', beginn: zeit(30), ende: zeit(31), ganztags: false, ort: '', gast: null },
      { id: 't3', kunde_id: 'k1', titel: 'Abgesagt GEHEIM_K', beginn: zeit(50), ende: zeit(51), ganztags: false, ort: '', gast: { email: 'erika@example.de', eingeladen: false } },
    ],
    rechnungen: [
      { id: 'r1', kunde_id: 'k1', nummer: 'R-1', datum: tag(-1), betrag_brutto: 1190, status: 'Versendet', zahlungsziel: tag(13), versendet_am: tag(-1), bezahlt_am: null, dokument: { kundeId: 'k1', dokumentId: 'd_rech', name: 'Rechnung R-1.pdf' } },
      { id: 'r_entwurf', kunde_id: 'k1', nummer: 'GEHEIM_L', datum: tag(0), betrag_brutto: 999, status: 'Entwurf', dokument: { kundeId: 'k1', dokumentId: 'd_rech', name: 'x' } },
      { id: 'r2', kunde_id: 'k2', nummer: 'R-2', datum: tag(-1), betrag_brutto: 500, status: 'Versendet', dokument: { kundeId: 'k2', dokumentId: 'd_k2', name: 'x' } },
    ],
    kostenvoranschlaege: [{ id: 'kv1', kunde_id: 'k1', beschreibung: 'Angebot GEHEIM_M', status: 'offen', betrag: 7000, dokument: null }],
    unterschrift_anfragen: [
      { id: 'u1', kunde_id: 'k1', token: TOK_U, titel: 'Beratungsvertrag', status: 'offen', gueltig_bis: zeit(24 * 10), erstellt_am: zeit(-2) },
      { id: 'u2', kunde_id: 'k1', token: TOK_U_ALT, titel: 'Zurückgezogen GEHEIM_N', status: 'zurueckgezogen', gueltig_bis: zeit(24 * 10), erstellt_am: zeit(-3) },
    ],
  }
}

function fakeAdmin(t = stand()) {
  const db = falscheDatenbank(t)
  const links: string[] = []
  return {
    db,
    links,
    from: (tab: string) => db.from(tab),
    storage: {
      from: (eimer: string) => ({
        createSignedUrl: (pfad: string) => {
          links.push(`${eimer}/${pfad}`)
          return Promise.resolve({ data: { signedUrl: `https://speicher.test/${eimer}/${pfad}?sig` }, error: null })
        },
      }),
    },
  }
}

function telegramFake() {
  const gesendet: { chat: number | string; text: string }[] = []
  return { gesendet, sendeTelegram: (chat: number | string, text: string) => Promise.resolve(gesendet.push({ chat, text })) }
}

const ctx = { speicherBasis: BASIS }

function frei(s: KundenPortalSeite) {
  if (s.stufe !== 'frei') throw new Error(`erwartet frei, bekam ${JSON.stringify(s)}`)
  return s
}

Deno.test('Kundenbereich: zeigt alles Freigegebene und nichts Internes', async () => {
  const admin = fakeAdmin()
  const s = frei(await kundenPortalLaden(admin, TOK, JETZT, ctx))
  const json = JSON.stringify(s)
  for (const geheim of ['GEHEIM_', 'aktives_mandat', 'k1/', 'privat:', 'boese.example', 'Walter', 'Provision', '5.000', '7.000', 'kv1']) {
    assertFalse(json.includes(geheim), `Internes sichtbar: ${geheim} in ${json}`)
  }
  assertEquals(s.anrede, 'Guten Tag Erika Muster,')
  assertEquals(s.bereich, 'Unternehmensberatung')
  assertEquals(s.stand, { text: 'Die Beratung läuft.', schritt: 8, schritte: 10, abgeschlossen: false })
  assertEquals(s.dokumente.map((d) => d.id), ['d_frei'])
  assertEquals(s.termine.map((t) => t.id), ['t1'])
  assertEquals(s.termine[0].ort, 'Ulm')
  assertEquals(s.rechnungen.map((r) => [r.id, r.stand, r.betrag, r.mitPdf]), [['r1', 'offen', 1190, true]])
  assertEquals(s.unterschriften.map((u) => [u.id, u.token]), [['u1', TOK_U]])
  assertEquals(s.unterlagen.fehlend, [{ name: 'Personalausweis', token: TOK_ANF }, { name: 'Grundbuchauszug', token: null }])
  assertEquals(s.unterlagen.hochladenToken, TOK_ANF)
  assert(s.erledigt.some((z) => z.includes('Ihre Unterlagen')), 'Mail an den Kunden fehlt')
  assert(s.naechste.includes('Konzept fertigstellen.'))
  assert(s.naechste.includes('Wir vereinbaren mit Ihnen die erste Sitzung.'))
  assert(s.vonIhnen.includes('Ihre Unterschrift: „Beratungsvertrag“'))
  assertEquals(s.ampel, 'gelb')
  assertEquals(s.kontakt, { name: 'Hasan Süslü', telefon: '0731 123 45', email: 'hasan@amayer-holding.com' })
  assertEquals(s.nachricht.moeglich, true)
  assertEquals(admin.db.tabelle('kunden_portal_zugaenge')[0].zugriffe, 1)
})

Deno.test('Kundenbereich: widerrufene, abgelaufene, falsche Links und private Akten', async () => {
  const admin = fakeAdmin()
  assertEquals(await kundenPortalLaden(admin, TOK_WIDERRUFEN, JETZT, ctx), { stufe: 'ungueltig', grund: BEENDET })
  assertEquals(await kundenPortalLaden(admin, TOK_ABGELAUFEN, JETZT, ctx), { stufe: 'ungueltig', grund: ABGELAUFEN })
  assertEquals(await kundenPortalLaden(admin, 'kurz', JETZT, ctx), { stufe: 'ungueltig', grund: UNGUELTIG })
  assertEquals(await kundenPortalLaden(admin, T('Z'), JETZT, ctx), { stufe: 'ungueltig', grund: UNGUELTIG })
  assertEquals((await kundenPortalLaden(admin, TOK_PRIVAT, JETZT, ctx)).stufe, 'ungueltig')
  assertEquals((await kundenPortalLaden(admin, { token: TOK }, JETZT, ctx)).stufe, 'ungueltig')
  // Nichts davon zählt als Zugriff oder liefert Dateien.
  assertEquals(admin.db.tabelle('kunden_portal_zugaenge').filter((z) => z.zugriffe).length, 0)
  const d = await kundenPortalDokument(admin, TOK_WIDERRUFEN, 'dokument', 'd_frei', JETZT, ctx)
  assertEquals(d.body, { stufe: 'ungueltig', grund: BEENDET })
  assertEquals(admin.links, [])
})

Deno.test('Kundenbereich: Dateien nur freigegeben und nur aus der eigenen Akte', async () => {
  const admin = fakeAdmin()
  const ok = await kundenPortalDokument(admin, TOK, 'dokument', 'd_frei', JETZT, ctx)
  assertEquals(ok.status, 200)
  assertEquals(ok.body.url, 'https://speicher.test/kunden-dokumente/k1/konzept.pdf?sig')
  for (const id of ['d_intern', 'd_k2', 'd_privat', 'd_fremd', 'd_pfad', 'gibtsnicht', 'd_rech']) {
    const r = await kundenPortalDokument(admin, TOK, 'dokument', id, JETZT, ctx)
    assertEquals(r.status, 403, `${id} hätte gesperrt sein müssen`)
  }
  const rech = await kundenPortalDokument(admin, TOK, 'rechnung', 'r1', JETZT, ctx)
  assertEquals(rech.body.url, 'https://speicher.test/kunden-dokumente/k1/r1.pdf?sig')
  assertEquals((await kundenPortalDokument(admin, TOK, 'rechnung', 'r2', JETZT, ctx)).status, 403) // fremde Akte
  assertEquals((await kundenPortalDokument(admin, TOK, 'rechnung', 'r_entwurf', JETZT, ctx)).status, 403) // Entwurf
  assertEquals((await kundenPortalDokument(admin, TOK, 'irgendwas', 'd_frei', JETZT, ctx)).status, 400)
  // Der Zugang des anderen Kunden sieht dessen Dokument, aber nicht unseres.
  assertEquals((await kundenPortalDokument(admin, TOK_K2, 'dokument', 'd_k2', JETZT, ctx)).status, 200)
  assertEquals((await kundenPortalDokument(admin, TOK_K2, 'dokument', 'd_frei', JETZT, ctx)).status, 403)
  assertEquals(admin.links, ['kunden-dokumente/k1/konzept.pdf', 'kunden-dokumente/k1/r1.pdf', 'kunden-dokumente/k2/testament.pdf'])
})

Deno.test('Kundenbereich: Nachricht landet im Verlauf und als Telegram beim Verantwortlichen, mit Grenzen', async () => {
  const admin = fakeAdmin()
  const tg = telegramFake()
  const c = { ...ctx, sendeTelegram: tg.sendeTelegram, crmBasis: 'https://crm.test/' }
  const r = await kundenPortalNachricht(admin, TOK, '  Wann ist der nächste Termin?  ', JETZT, c)
  assertEquals(r.status, 200)
  assertEquals((r.body as KundenPortalSeite & { hinweis?: string }).hinweis?.startsWith('Danke!'), true)
  const verlauf = admin.db.tabelle('kunden').find((k) => k.id === 'k1')!.activities as { text: string; user: string }[]
  assertEquals(verlauf[0].text, 'Nachricht aus dem Kundenbereich: „Wann ist der nächste Termin?“')
  assertEquals(verlauf[0].user, 'Erika Muster (Kundenbereich)')
  assertEquals(verlauf.length, 2)
  assertEquals(tg.gesendet.length, 1)
  assertEquals(tg.gesendet[0].chat, 42)
  assert(tg.gesendet[0].text.includes('„Wann ist der nächste Termin?“'))
  assert(tg.gesendet[0].text.includes('https://crm.test/#/beratung/kunden/k1'))

  // Gleich danach: zu schnell.
  const zuSchnell = await kundenPortalNachricht(admin, TOK, 'Noch eine Frage', new Date(JETZT.getTime() + 30_000), c)
  assertEquals(zuSchnell.status, 429)
  // Nach drei Minuten geht es wieder.
  const spaeter = await kundenPortalNachricht(admin, TOK, 'Noch eine Frage', new Date(JETZT.getTime() + 3 * 60_000), c)
  assertEquals(spaeter.status, 200)
  assertEquals(admin.db.tabelle('kunden_portal_zugaenge')[0].nachrichten_zaehler, 2)
  // Tagesgrenze erreicht.
  admin.db.tabelle('kunden_portal_zugaenge')[0].nachrichten_zaehler = NACHRICHT_MAX_JE_TAG
  const genug = await kundenPortalNachricht(admin, TOK, 'Dritte Frage', new Date(JETZT.getTime() + 10 * 60_000), c)
  assertEquals(genug.status, 429)
  // Am nächsten Tag zählt es neu.
  const morgen = await kundenPortalNachricht(admin, TOK, 'Neue Frage', new Date(JETZT.getTime() + 25 * 3600_000), c)
  assertEquals(morgen.status, 200)
  assertEquals(admin.db.tabelle('kunden_portal_zugaenge')[0].nachrichten_zaehler, 1)
  assertEquals(tg.gesendet.length, 3)
})

Deno.test('Kundenbereich: Nachricht über beendeten Link wird nicht angenommen; Telegram abschaltbar', async () => {
  const admin = fakeAdmin()
  const tg = telegramFake()
  const c = { ...ctx, sendeTelegram: tg.sendeTelegram }
  const r = await kundenPortalNachricht(admin, TOK_WIDERRUFEN, 'Hallo zusammen', JETZT, c)
  assertEquals(r.body, { stufe: 'ungueltig', grund: BEENDET })
  assertEquals((admin.db.tabelle('kunden').find((k) => k.id === 'k1')!.activities as unknown[]).length, 1)
  assertEquals((await kundenPortalNachricht(admin, TOK, 'x', JETZT, c)).status, 400)
  assertEquals((await kundenPortalNachricht(admin, TOK, 'a'.repeat(2001), JETZT, c)).status, 400)
  assertEquals(tg.gesendet.length, 0)

  admin.db.tabelle('kundenportal_einstellungen').push({ email: 'hasan@amayer-holding.com', nachricht_telegram: false })
  const ok = await kundenPortalNachricht(admin, TOK, 'Bitte um Rückruf', JETZT, c)
  assertEquals(ok.status, 200)
  assertEquals(tg.gesendet.length, 0)
  assertEquals((admin.db.tabelle('kunden').find((k) => k.id === 'k1')!.activities as unknown[]).length, 2)
})

Deno.test('Kundenbereich: Stand nur aus der festen Liste', () => {
  assertEquals(standFuerKunden('beratung', 'verloren'), null)
  assertEquals(standFuerKunden('beratung', 'wiedervorlage'), null)
  assertEquals(standFuerKunden('beratung', 'nicht_qualifiziert'), null)
  assertEquals(standFuerKunden('privat', 'neu'), null)
  assertEquals(standFuerKunden('erben', 'abgeschlossen')?.abgeschlossen, true)
  assertEquals(standFuerKunden('akademie', 'kurs_laeuft')?.text, 'Ihr Kurs läuft.')
})

Deno.test('Kundenbereich: Speicherort und Hochlade-Links', () => {
  assertEquals(speicherOrt('k1/a.pdf', BASIS), { eimer: 'kunden-dokumente', pfad: 'k1/a.pdf' })
  assertEquals(speicherOrt(`${BASIS}/storage/v1/object/public/email-anhaenge/x/y.pdf`, BASIS), { eimer: 'email-anhaenge', pfad: 'x/y.pdf' })
  assertEquals(speicherOrt(`${BASIS}/storage/v1/object/public/briefboegen/x.png`, BASIS), null)
  assertEquals(speicherOrt('privat:a/b', BASIS), null)
  assertEquals(speicherOrt('../geheim', BASIS), null)
  assertEquals(speicherOrt('https://anderswo.de/x.pdf', BASIS), null)
  const r = fehlendMitLink(
    [
      { datum: tag(-2), punkte: ['A'], weitere: 'Zeile 1', token: TOK_ANF },
      { datum: tag(-90), punkte: ['B'], token: TOK_ANF_ALT },
      { datum: tag(-1), punkte: ['C'], token: 'kaputt' },
    ],
    { punkte: ['A', 'B', 'C'], weitere: ['Zeile 1'] },
    JETZT,
  )
  assertEquals(r.fehlend, [{ name: 'A', token: TOK_ANF }, { name: 'B', token: null }, { name: 'C', token: null }, { name: 'Zeile 1', token: TOK_ANF }])
  assertEquals(r.hochladenToken, TOK_ANF)
})

Deno.test('Kundenbereich: Einstieg beantwortet unbekannte Aktionen und fängt Fehler ab', async () => {
  const admin = fakeAdmin()
  assertEquals((await beantworteKundenPortal(admin, 'public_kundenportal_xyz', {})).status, 400)
  const kaputt = { from: () => { throw new Error('weg') }, storage: admin.storage }
  const r = await beantworteKundenPortal(kaputt, 'public_kundenportal_laden', { token: TOK }, ctx, JETZT)
  assertEquals(r.status, 500)
  assertFalse(JSON.stringify(r.body).includes('weg'))
})
