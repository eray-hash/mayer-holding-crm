// Seite „Automatische Nachrichten“ (automatik.ts): Stand lesen, Eingaben streng prüfen, nur Erlaubtes schreiben —
// und die bearbeitbaren Mail-Texte (automatikVorlagen.ts): Die Vorgabe-Vorlage ergibt Wort für Wort den bisherigen
// festen Text, fehlt sie, geht der feste Text hinaus.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  alleSchalter, automatikSchalter, automatikStand, pruefeEmpfaenger, pruefeSchalterEingabe, pruefeUhrzeit, regelAusZeile, SCHALTER,
  spaltenFuer, standAusZeilen, telegramArtNachText, vorschlagDatenNeu, wvAusZeile,
} from './automatik.ts'
import { fuellePlatzhalter, ladeMailVorlage, rendere, STANDARD_VORLAGEN, VORLAGE, vergissVorlagen } from './automatikVorlagen.ts'
import { erinnerungsMail, erinnerungsMailText, gastMail, gastMailText, type Termin } from './kalender.ts'
import { buchungMail, buchungMailText } from './buchung.ts'
import { kopieMail, kopieMailText } from './unterschrift.ts'
import { protokollZeile } from '../_shared/nachrichtenProtokoll.ts'

// ---------------------------------------------------------------------------------------------
// Stand

Deno.test('Stand: alle Schalter aus den Zeilen, fehlende Zeile = aus', () => {
  const s = alleSchalter({
    willkommen_einstellung: { id: 1, aktiv: true, verzoegerung_minuten: 45, geaendert_von: 'Test GF', geaendert_am: '2026-11-22T17:57:49Z' },
    unterschrift_einstellung: { id: 1, kopie_an_kunde: false, geaendert_von: null, geaendert_am: null },
    kundenbericht_schalter: null,
    mahn_einstellung: { id: 1, aktiv: true },
    assistent_hinweis_einstellung: { id: 1, abend_rueckblick: 'alle', abend_rueckblick_uhrzeit: '18:15', kontakt_nachfrage: 'superuser', kurzpruefung_hinweis: 'quatsch' },
    vorschlagDaten: { zuordnung_an: true, status_an: false, empfaenger: ['*'], geaendert_von: 'Test GF' },
  })
  assertEquals(Object.keys(s).sort(), Object.keys(SCHALTER).sort())
  assertEquals(s.willkommen, { wert: true, wartezeitMinuten: 45, geaendertVon: 'Test GF', geaendertAm: '2026-11-22T17:57:49Z' })
  assertEquals(s.unterschrift_kopie, { wert: false })
  assertEquals(s.kundenbericht, { wert: false })
  assertEquals(s.mahn, { wert: true })
  assertEquals(s.abend_rueckblick, { wert: 'alle', uhrzeit: '18:15' })
  assertEquals(s.kontakt_nachfrage, { wert: 'superuser' })
  assertEquals(s.kurzpruefung_hinweis, { wert: 'aus' })
  assertEquals(s.bitte_bestaetigen, { wert: true, empfaenger: ['*'], geaendertVon: 'Test GF' })
  assertEquals(s.status_vorschlag, { wert: false, empfaenger: ['*'], geaendertVon: 'Test GF' })
})

Deno.test('Stand: kaputte Uhrzeit → Vorgabe 17:30 (wie der Lauf selbst)', () => {
  assertEquals(standAusZeilen('abend_rueckblick', { assistent_hinweis_einstellung: { abend_rueckblick: 'aus', abend_rueckblick_uhrzeit: '07:00' } }), { wert: 'aus', uhrzeit: '17:30' })
  assertEquals(standAusZeilen('gibt_es_nicht', {}), null)
})

Deno.test('Regeln und Wiedervorlage-Regeln in der Form der Seite', () => {
  assertEquals(regelAusZeile({ id: 'r1', bereich: 'immobilien', titel: 'T', aktiv: true, wartezeit_minuten: null, an_wen: 'interessent', vorlage_id: 'mv-x', reihenfolge: 3 }), {
    id: 'r1', bereich: 'immobilien', titel: 'T', aktiv: true, wartezeitMinuten: null, anWen: 'interessent', vorlageId: 'mv-x',
  })
  assertEquals(wvAusZeile({ id: 'w1', bereich: 'beratung', ausloeser: 'status', titel: 'Nachfassen', tage: 7, schliesst: ['status'], aktiv: false, sortierung: 2 }), {
    id: 'w1', bereich: 'beratung', ausloeser: 'status', titel: 'Nachfassen', tage: 7, schliesst: ['status'], aktiv: false, sortierung: 2,
  })
})

// ---------------------------------------------------------------------------------------------
// Prüfung der Eingaben

Deno.test('Prüfung: nur bekannte Schalter, regel:<id> und wv:<id>', () => {
  assertEquals(pruefeSchalterEingabe({ id: 'mitarbeiter', wert: true }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'regel:', wert: true }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'regel:a b', wert: true }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: '__proto__', wert: true }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen' }).ok, false) // nichts geändert
  const r = pruefeSchalterEingabe({ id: 'regel:immo_besichtigung_danke', wert: false, wartezeitMinuten: 90 })
  assert(r.ok)
  assertEquals(r.ziel, { art: 'regel', regelId: 'immo_besichtigung_danke' })
  assertEquals(r.werte, { wert: false, wartezeitMinuten: 90 })
})

Deno.test('Prüfung: Werte streng', () => {
  // an/aus nur echte Wahrheitswerte
  assertEquals(pruefeSchalterEingabe({ id: 'mahn', wert: 'true' }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'mahn', wert: 1 }).ok, false)
  // Stufen nur aus/superuser/alle
  assertEquals(pruefeSchalterEingabe({ id: 'kontakt_nachfrage', wert: true }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'kontakt_nachfrage', wert: 'Alle' }).ok, false)
  assert(pruefeSchalterEingabe({ id: 'kontakt_nachfrage', wert: 'superuser' }).ok)
  // Felder, die zum Schalter nicht passen
  assertEquals(pruefeSchalterEingabe({ id: 'kontakt_nachfrage', uhrzeit: '18:00' }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'mahn', wartezeitMinuten: 5 }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen', empfaenger: ['*'] }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'regel:x', tage: 3 }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'wv:x', wartezeitMinuten: 3 }).ok, false)
  // Wartezeit: Willkommen 0–1440 (wie die Datenbank), Regeln 0–10080, nur ganze Zahlen
  assert(pruefeSchalterEingabe({ id: 'willkommen', wartezeitMinuten: 1440 }).ok)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen', wartezeitMinuten: 1441 }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen', wartezeitMinuten: -1 }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen', wartezeitMinuten: 2.5 }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'willkommen', wartezeitMinuten: '60' }).ok, false)
  assert(pruefeSchalterEingabe({ id: 'regel:x', wartezeitMinuten: 10080 }).ok)
  assertEquals(pruefeSchalterEingabe({ id: 'regel:x', wartezeitMinuten: 10081 }).ok, false)
  // Uhrzeit 12:00–22:00
  assert(pruefeSchalterEingabe({ id: 'abend_rueckblick', uhrzeit: '17:30' }).ok)
  assertEquals(pruefeSchalterEingabe({ id: 'abend_rueckblick', uhrzeit: '7:30' }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'abend_rueckblick', uhrzeit: '23:00' }).ok, false)
  // Wiedervorlage
  const wv = pruefeSchalterEingabe({ id: 'wv:allg_angebot_nachfassen', tage: 10, titel: '  Angebot   nachfassen ' })
  assert(wv.ok)
  assertEquals(wv.werte, { tage: 10, titel: 'Angebot nachfassen' })
  assertEquals(pruefeSchalterEingabe({ id: 'wv:x', titel: '   ' }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'wv:x', titel: 'x'.repeat(201) }).ok, false)
  assertEquals(pruefeSchalterEingabe({ id: 'wv:x', tage: 366 }).ok, false)
})

Deno.test('Prüfung: Empfängerliste', () => {
  assertEquals(pruefeEmpfaenger([' Chef@Firma.de ', 'superuser', '*', 'chef@firma.de']), ['chef@firma.de', 'superuser', '*'])
  assertEquals(pruefeEmpfaenger([]), [])
  assertEquals(pruefeEmpfaenger(['keine-adresse']), null)
  assertEquals(pruefeEmpfaenger('*'), null)
  assertEquals(pruefeEmpfaenger([1]), null)
  assertEquals(pruefeEmpfaenger(Array.from({ length: 51 }, (_, i) => `p${i}@firma.de`)), null)
  assertEquals(pruefeUhrzeit('12:00'), '12:00')
  assertEquals(pruefeUhrzeit('22:01'), null)
})

Deno.test('Schreiben: nur die Spalten des Schalters, mit Name und Zeitpunkt', () => {
  const jetzt = '2026-11-24T10:00:00.000Z'
  const w = pruefeSchalterEingabe({ id: 'willkommen', wert: false, wartezeitMinuten: 30 })
  assert(w.ok)
  assertEquals(spaltenFuer(w.ziel, w.werte, 'Test GF', jetzt), { aktiv: false, verzoegerung_minuten: 30, geaendert_von: 'Test GF', geaendert_am: jetzt })
  const a = pruefeSchalterEingabe({ id: 'abend_rueckblick', wert: 'superuser', uhrzeit: '18:00' })
  assert(a.ok)
  assertEquals(spaltenFuer(a.ziel, a.werte, 'Test GF', jetzt), { abend_rueckblick: 'superuser', abend_rueckblick_uhrzeit: '18:00', geaendert_von: 'Test GF', geaendert_am: jetzt })
  const wv = pruefeSchalterEingabe({ id: 'wv:x', wert: false })
  assert(wv.ok)
  assertEquals(spaltenFuer(wv.ziel, wv.werte, 'Test GF', jetzt), { aktiv: false })
  // Empfänger-Schalter: übrige Felder in daten bleiben, fehlende Liste wird mit der Vorgabe festgeschrieben
  assertEquals(vorschlagDatenNeu({ zuordnung_an: false, status_an: true, empfaenger: ['*'], anderes: 1 }, 'zuordnung_an', { wert: true }, 'Test GF', jetzt), {
    zuordnung_an: true, status_an: true, empfaenger: ['*'], anderes: 1, geaendert_von: 'Test GF', geaendert_am: jetzt,
  })
  const neu = vorschlagDatenNeu(null, 'status_an', { empfaenger: ['superuser'] }, 'Test GF', jetzt)
  assertEquals(neu.empfaenger, ['superuser'])
  assertEquals(neu.status_an, undefined)
})

Deno.test('Telegram-Verlauf: Katalog-Kennung am Textanfang', () => {
  assertEquals(telegramArtNachText('tagesmeldung', 'Wochenbericht vom 16.11. bis 20.11.'), 'wochenbericht_gf')
  assertEquals(telegramArtNachText('tagesmeldung', 'Guten Morgen …'), 'morgen_uebersicht')
  assertEquals(telegramArtNachText('tagesplan', '☀️ Dein Tag – Dienstag, 24.11.'), 'tagesplan_morgen')
  assertEquals(telegramArtNachText('tagesplan', 'Offen geblieben …'), 'tagesplan_abend')
  assertEquals(telegramArtNachText('anfragen', 'Mögliche Anfrage über ImmoScout24 …'), 'anfrage_unklar')
  assertEquals(telegramArtNachText('anfragen', 'Neue Anfrage zu „…“'), 'anfrage_neu')
  assertEquals(telegramArtNachText('briefing', '📋 Briefing zum Termin in 1 Stunde'), 'termin_briefing')
  assertEquals(telegramArtNachText('briefing', '🎙️ Dein Termin „X“ (14:00 Uhr) beginnt.'), 'aufnahme_erinnerung')
  assertEquals(telegramArtNachText('briefing', '☀️ Deine Kundentermine heute (2)'), 'termin_briefing_morgen')
})

// ---------------------------------------------------------------------------------------------
// Rechte (mit nachgebauter Datenbank)

type Zeile = Record<string, unknown>
function fakeDb(tabellen: Record<string, Zeile[]>, nutzerEmail: string | null) {
  const geschrieben: { tabelle: string; art: string; werte: Zeile }[] = []
  return {
    geschrieben,
    tabellen,
    auth: { getUser: async () => (nutzerEmail ? { data: { user: { email: nutzerEmail } }, error: null } : { data: null, error: { message: 'nein' } }) },
    from(tabelle: string) {
      const filter: ((z: Zeile) => boolean)[] = []
      let aenderung: Zeile | null = null
      const zeilen = () => (tabellen[tabelle] ?? []).filter((z) => filter.every((f) => f(z)))
      const kette: Record<string, unknown> = {
        select: () => kette,
        order: () => kette,
        eq: (s: string, w: unknown) => (filter.push((z) => z[s] === w), kette),
        ilike: (s: string, w: string) => (filter.push((z) => String(z[s]).toLowerCase() === w.toLowerCase()), kette),
        maybeSingle: async () => ({ data: zeilen()[0] ?? null, error: null }),
        update: (w: Zeile) => ((aenderung = w), kette),
        insert: async (w: Zeile) => {
          geschrieben.push({ tabelle, art: 'insert', werte: w })
          ;(tabellen[tabelle] ??= []).push({ ...w })
          return { error: null }
        },
        then: (fertig: (x: unknown) => void) => {
          if (aenderung) {
            const treffer = zeilen()
            for (const z of treffer) Object.assign(z, aenderung)
            geschrieben.push({ tabelle, art: 'update', werte: aenderung })
            return fertig({ data: treffer.map((z) => ({ ...z })), error: null })
          }
          return fertig({ data: zeilen(), error: null })
        },
      }
      return kette
    },
  }
}

const anfrage = () => new Request('https://x.test', { method: 'POST', headers: { authorization: 'Bearer nutzer-token' } })
const TEAM = [
  { name: 'Test GF', email: 'gf@firma.test', aktiv: true, rolle: 'geschaeftsfuehrung', ist_admin: false, bereiche: [], ist_superuser: false },
  { name: 'Test Super', email: 'su@firma.test', aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: [], ist_superuser: true },
  { name: 'Test Mitarbeiter', email: 'ma@firma.test', aktiv: true, rolle: 'mitarbeiter', ist_admin: false, bereiche: ['beratung'], ist_superuser: false },
]
function grunddaten(): Record<string, Zeile[]> {
  return {
    mitarbeiter: structuredClone(TEAM),
    willkommen_einstellung: [{ id: 1, aktiv: true, verzoegerung_minuten: 60 }],
    unterschrift_einstellung: [{ id: 1, kopie_an_kunde: false }],
    kundenbericht_schalter: [{ id: 1, aktiv: false }],
    mahn_einstellung: [{ id: 1, aktiv: true, tage_erinnerung: 3 }],
    assistent_hinweis_einstellung: [{ id: 1, abend_rueckblick: 'alle', abend_rueckblick_uhrzeit: '17:30', kontakt_nachfrage: 'aus', kurzpruefung_hinweis: 'aus' }],
    telegram_vorschlaege: [{ id: 'einstellung', daten: { zuordnung_an: true, status_an: true, empfaenger: ['*'] } }],
    auto_nachricht_regeln: [
      { id: 'r_fest', bereich: 'immobilien', titel: 'Erinnerung', aktiv: true, wartezeit_minuten: null, an_wen: 'interessent', vorlage_id: 'mv-a' },
      { id: 'r_warten', bereich: 'immobilien', titel: 'Danke', aktiv: true, wartezeit_minuten: 120, an_wen: 'interessent', vorlage_id: 'mv-b' },
    ],
    wiedervorlage_regeln: [{ id: 'w1', bereich: 'beratung', ausloeser: 'status', titel: 'Nachfassen', tage: 7, schliesst: [], aktiv: true, sortierung: 1 }],
  }
}

Deno.test('Rechte: ohne Login 401, Mitarbeiter 403, Geschäftsführung und Superuser dürfen', async () => {
  assertEquals((await automatikStand(anfrage(), fakeDb(grunddaten(), null), {})).status, 401)
  const ma = fakeDb(grunddaten(), 'ma@firma.test')
  assertEquals((await automatikStand(anfrage(), ma, {})).status, 403)
  assertEquals((await automatikSchalter(anfrage(), ma, { id: 'mahn', wert: false })).status, 403)
  assertEquals(ma.geschrieben.length, 0)
  const gf = await automatikStand(anfrage(), fakeDb(grunddaten(), 'gf@firma.test'), {})
  assertEquals(gf.status, 200)
  const d = gf.daten as { schalter: Record<string, unknown>; regeln: unknown[]; wvRegeln: unknown[] }
  assertEquals(d.schalter.mahn, { wert: true })
  assertEquals(d.regeln.length, 2)
  assertEquals(d.wvRegeln.length, 1)
  assertEquals((await automatikStand(anfrage(), fakeDb(grunddaten(), 'su@firma.test'), {})).status, 200)
})

Deno.test('Schalter ändern: schreibt nur das Erlaubte und liefert den neuen Stand', async () => {
  const jetzt = new Date('2026-11-24T10:00:00Z')
  const db = fakeDb(grunddaten(), 'gf@firma.test')
  const r = await automatikSchalter(anfrage(), db, { id: 'mahn', wert: false }, jetzt)
  assertEquals(r, { status: 200, daten: { ok: true, stand: { wert: false, geaendertVon: 'Test GF', geaendertAm: '2026-11-24T10:00:00.000Z' } } })
  assertEquals(db.tabellen.mahn_einstellung[0].tage_erinnerung, 3) // nichts anderes angefasst

  const e = await automatikSchalter(anfrage(), db, { id: 'status_vorschlag', wert: false, empfaenger: ['superuser'] }, jetzt)
  assertEquals((e.daten as { stand: unknown }).stand, { wert: false, empfaenger: ['superuser'], geaendertVon: 'Test GF', geaendertAm: '2026-11-24T10:00:00.000Z' })
  assertEquals((db.tabellen.telegram_vorschlaege[0].daten as Zeile).zuordnung_an, true)

  const fest = await automatikSchalter(anfrage(), db, { id: 'regel:r_fest', wartezeitMinuten: 10 }, jetzt)
  assertEquals(fest.status, 400)
  const warten = await automatikSchalter(anfrage(), db, { id: 'regel:r_warten', wartezeitMinuten: 30 }, jetzt)
  assertEquals((warten.daten as { stand: unknown }).stand, { wert: true, wartezeitMinuten: 30, geaendertVon: 'Test GF', geaendertAm: '2026-11-24T10:00:00.000Z' })
  assertEquals((await automatikSchalter(anfrage(), db, { id: 'regel:gibts_nicht', wert: true }, jetzt)).status, 404)

  const wv = await automatikSchalter(anfrage(), db, { id: 'wv:w1', tage: 14 }, jetzt)
  assertEquals((wv.daten as { stand: unknown }).stand, { wert: true, tage: 14, titel: 'Nachfassen' })
  assertEquals((await automatikSchalter(anfrage(), db, { id: 'kontakt_nachfrage', wert: 'vielleicht' }, jetzt)).status, 400)
})

// ---------------------------------------------------------------------------------------------
// Bearbeitbare Mail-Texte: Vorgabe = bisheriger fester Text

const TERMINE: Termin[] = [
  {
    id: 't1', titel: 'Erstgespräch Nachfolge', beschreibung: 'intern', ort: 'Büro Ulm', beginn: '2026-12-01T13:00:00.000Z', ende: '2026-12-01T14:30:00.000Z',
    ganztags: false, besitzer_email: 'gf@firma.test', teilnehmer: [], kunde_id: null, kunde_bereich: null, kunde_name: null, quelle: 'crm', erinnert: {},
  },
  {
    id: 't2', titel: 'Notartermin', beschreibung: '', ort: '', beginn: '2026-12-03T23:00:00.000Z', ende: '2026-12-04T23:00:00.000Z',
    ganztags: true, besitzer_email: 'gf@firma.test', teilnehmer: [], kunde_id: null, kunde_bereich: null, kunde_name: null, quelle: 'crm', erinnert: {},
  },
]

Deno.test('Gast-Mails: Vorgabe-Vorlage ergibt genau den bisherigen Text', () => {
  for (const t of TERMINE) {
    for (const gastName of ['Max Muster', undefined, '']) {
      for (const [art, id] of [['neu', VORLAGE.gastEinladung], ['geaendert', VORLAGE.gastAenderung], ['abgesagt', VORLAGE.gastAbsage]] as const) {
        assertEquals(gastMail(art, t, gastName || undefined, 'Test GF', STANDARD_VORLAGEN[id]), gastMailText(art, t, gastName || undefined, 'Test GF'))
      }
      for (const vorlauf of [1440, 60]) {
        assertEquals(erinnerungsMail(t, gastName || undefined, 'Test GF', vorlauf, STANDARD_VORLAGEN[VORLAGE.gastErinnerung]), erinnerungsMailText(t, gastName || undefined, 'Test GF', vorlauf))
      }
    }
  }
  // ohne Vorlage: fester Text
  assertEquals(gastMail('neu', TERMINE[0], 'Max Muster', 'Test GF', null), gastMailText('neu', TERMINE[0], 'Max Muster', 'Test GF'))
  // eine geänderte Vorlage wirkt
  const eigen = gastMail('neu', TERMINE[0], 'Max Muster', 'Test GF', { betreff: 'Termin {{Titel}}', text: '{{Anrede}}\nam {{Zeit}}\n{{Ort}}\nGruß {{Absender}}' })
  assertEquals(eigen.betreff, 'Termin Erstgespräch Nachfolge')
  assertEquals(eigen.text, 'Guten Tag Max Muster,\nam Di., 01.12.2026, 14:00–15:30 Uhr\nBüro Ulm\nGruß Test GF')
  // leerer Ort: Zeile nur aus dem Platzhalter fällt weg
  assertEquals(gastMail('neu', TERMINE[1], undefined, 'Test GF', { betreff: 'x', text: 'A\n{{Ort}}\nB' }).text, 'A\nB')
})

Deno.test('Buchungsbestätigung: Vorgabe-Vorlage ergibt genau den bisherigen Text', () => {
  const faelle = [
    { name: 'Max Muster', titel: 'Erstberatung', tag: 'Dienstag, 01.12.2026', von: '14:00', bis: '14:30', ort: 'Büro Ulm', hinweis: 'Bitte Unterlagen mitbringen.', absender: 'Test GF' },
    { name: 'Erika Beispiel', titel: 'Telefonat', tag: 'Freitag, 04.12.2026', von: '09:00', bis: '09:15', ort: '', hinweis: '', absender: 'Test Mitarbeiter' },
  ]
  for (const d of faelle) {
    assertEquals(buchungMail(d, STANDARD_VORLAGEN[VORLAGE.buchungBestaetigung]), buchungMailText(d))
    assertEquals(buchungMail(d, null), buchungMailText(d))
  }
  assertEquals(buchungMailText(faelle[0]).betreff, 'Terminbestätigung: Erstberatung am 01.12.2026 um 14:00 Uhr')
})

Deno.test('Kopie der Unterschrift: Vorgabe-Vorlage ergibt genau den bisherigen Text', () => {
  for (const name of ['Max Muster', '']) {
    assertEquals(kopieMail(name, 'Beratungsvereinbarung', STANDARD_VORLAGEN[VORLAGE.unterschriftKopie]), kopieMailText(name, 'Beratungsvereinbarung'))
  }
})

Deno.test('Platzhalter: ein Durchgang, Unbekanntes bleibt, Betreff einzeilig', () => {
  assertEquals(fuellePlatzhalter('{{A}} {{B}} {{Unbekannt}}', { A: '{{B}}', B: 'b' }), '{{B}} b {{Unbekannt}}')
  assertEquals(fuellePlatzhalter('x\n{{A}} {{B}}\ny', { A: '', B: '' }), 'x\ny')
  assertEquals(fuellePlatzhalter('x\n{{A}} {{B}}\ny', { A: '', B: '1' }), 'x\n 1\ny')
  assertEquals(rendere({ betreff: '{{E}}', text: '' }, { E: 'a\nb' }, () => ({ betreff: '', text: '' })).betreff, 'a b')
})

Deno.test('Vorlage laden: Zeile fehlt, Text leer oder Fehler → null (fester Text); leerer Betreff → Vorgabe', async () => {
  const db = (zeile: Zeile | null, fehler = false) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (fehler ? { data: null, error: { message: 'kaputt' } } : { data: zeile, error: null }) }) }) }),
  })
  vergissVorlagen()
  assertEquals(await ladeMailVorlage(db(null), VORLAGE.gastAbsage), null)
  vergissVorlagen()
  assertEquals(await ladeMailVorlage(db({ betreff: 'B', text: '   ' }), VORLAGE.gastAbsage), null)
  vergissVorlagen()
  assertEquals(await ladeMailVorlage(db(null, true), VORLAGE.gastAbsage), null)
  vergissVorlagen()
  assertEquals(await ladeMailVorlage(db({ betreff: '', text: 'T' }), VORLAGE.gastAbsage), { betreff: STANDARD_VORLAGEN[VORLAGE.gastAbsage].betreff, text: 'T' })
  // zwischengespeichert: dieselbe Vorlage ohne neue Abfrage
  assertEquals(await ladeMailVorlage(db(null, true), VORLAGE.gastAbsage), { betreff: STANDARD_VORLAGEN[VORLAGE.gastAbsage].betreff, text: 'T' })
  vergissVorlagen()
  // ganz kaputter Datenbankzugang wirft nicht
  assertEquals(await ladeMailVorlage({ from: () => { throw new Error('weg') } }, VORLAGE.gastAbsage), null)
  vergissVorlagen()
})

Deno.test('Protokoll-Zeile: Text gekürzt, leere Werte null', () => {
  const z = protokollZeile({ art: 'gast_einladung', kanal: 'mail', an_email: 'a@b.test', text: 'x'.repeat(5000), an_chat: 123 })
  assertEquals((z.text as string).length, 2000)
  assertEquals(z.an_chat, '123')
  assertEquals(z.status, 'gesendet')
  assertEquals(z.betreff, null)
  assertEquals(protokollZeile({ kanal: 'telegram' }).art, 'unbekannt')
})
