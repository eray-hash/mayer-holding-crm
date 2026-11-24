// Mahnen komplett in Telegram (24.11.2026) — das Follow-up nach einer Rechnung läuft ohne CRM-Fenster durch.
//
// Werkzeuge:
//  - mahnung_erstellen: Zahlungserinnerung, 1. oder 2. Mahnung zu einer Rechnung. Stufe = die nächste fällige
//    (mahnVorschlagKern.naechsteStufe) oder die angegebene. PDF auf dem Holding-Briefbogen (_shared/mahnungHoldingPdf.ts,
//    Texte/Fristen/Gebühren wie der Mahn-Dialog im CRM, _shared/mahnungKern.ts), Ablage in der Akte (legeAb), Mail an den
//    Kunden mit dem PDF nur VORBEREITET (merkeMailEntwurf → mail_senden erst nach dem Ja, wie rechnung_versenden).
//    Nach dem tatsächlichen Versand (fuehreMailSchrittAus in index.ts → mahnungNachVersand): Eintrag an der Rechnung wie
//    das CRM (mahnungen + mahnstufe + Status „Überfällig“), offene Mahnvorschläge dieser und niedrigerer Stufen auf
//    „gesendet“ (wie die Seite Mahnwesen), Vermerk in der Akte; die Abschlussnachricht nennt die nächsten Schritte
//    (folgeNachMahnung). Mit nur_pdf (Versand per Post) wird sofort eingetragen, wie „Nur PDF“ im CRM.
//  - followup_durchspielen: führt den ganzen Ablauf einer Rechnung vor, OHNE etwas zu senden oder zu ändern (nur Lesen):
//    je Schritt Datum, was passiert, die echte Telegram-Nachricht (Morgen-Übersicht mit „Geldeingang prüfen“ aus
//    email-gateway/tagesmeldung.ts, Mahnhinweis des Tageslaufs aus mahnVorschlagKern.hinweisText — mit angenommenem
//    Datum) und was man antworten kann; dazu Vorschau-PDFs der kommenden Stufen mit Wasserzeichen „VORSCHAU – nicht
//    versendet“, die nur als Datei in den Chat gehen (nie in die Akte). Auch als interne Aktion (index.ts,
//    body.intern === 'followup_durchspielen', nur mit Dienst-Schlüssel).
//
// Rechte wie rechnung_versenden: Bereich Unternehmensberatung (Zeilenregel rechnungen) und die Akte (darfAkte); nicht im
// privaten Assistenten. Die Mahnung nach der 2. (Inkasso) entscheidet ein Mensch — dafür gibt es hier kein Schreiben.

import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { berechneFolgeSchritte, folgeText, ladeFolgeDaten } from '../_shared/followupKern.ts'
import {
  aktuelleFrist,
  einstellungAus,
  hinweisText,
  type MahnEinstellung,
  type MahnRechnung,
  type MahnStufe,
  naechsteStufe,
  offenerBetrag,
  plusTage,
  pruefeRechnung,
  stufeErreicht,
  tageZwischen,
  vorschlagId,
} from '../_shared/mahnVorschlagKern.ts'
import { erzeugeHoldingMahnungPdf } from '../_shared/mahnungHoldingPdf.ts'
import {
  deDatum,
  euro,
  leseStufe,
  type MahnEintrag,
  mahnBetraege,
  mahnstufeName,
  mahnungBetreff,
  mahnungDateiname,
  mahnungMailText,
  mahnVermerk,
  mahnVorlage,
  type MahnRechnungDaten,
  neueMahnId,
  rechnungNachMahnung,
} from '../_shared/mahnungKern.ts'
import { anschriftFuer, type AkteFuerRechnung, empfaengerZeilen, hatPlzOrt } from '../_shared/rechnungAusstellenKern.ts'
import { berlinTagesbeginn, type Daten, morgenText, type Person } from '../email-gateway/tagesmeldung.ts'
import { type DokumentKontext, ladeZiel, legeAb } from './dokumentErstellen.ts'
import type { RechnungAnhang, RechnungMailEmpfaenger } from './rechnungErstellen.ts'
import { darfAkte, darfBereich, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Was nach dem Versand an der Rechnung einzutragen ist (liegt im Mail-Entwurf / Mail-Auftrag). */
export type MahnungBezug = { rechnung_id: string; nummer: string; kunde_id: string; stufe: MahnStufe; eintrag: MahnEintrag; summe: number }
/** Passt auf MailEntwurf in index.ts (mail_anfrage) — ohne `rechnung`, damit weder XRechnung noch Rechnungs-Status anspringen. */
export type MahnungMailEntwurf = { id: string; betreff: string; text: string; empfaenger: RechnungMailEmpfaenger[]; z: string; anhaenge: RechnungAnhang[]; mahnung: MahnungBezug }

export type MahnungKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; email?: string | null; id?: string | null }
  protokolliere: (text: string) => void
  heute: string
  merkeMailEntwurf?: (e: MahnungMailEntwurf) => void
  mailText?: (text: string, e: RechnungMailEmpfaenger) => string
  /** Für die Vorschau-PDFs von followup_durchspielen: Bot-Schlüssel (undefined = TELEGRAM_BOT_TOKEN, null = keiner → nur protokolliert). */
  botToken?: string | null
  chatId?: number | string | null
  abruf?: typeof fetch
}

const EIMER = 'kunden-dokumente'
const AKTE_SPALTEN = 'id, bereich, status, firma, ansprechpartner, anschrift, email, immo_stammdaten, verantwortlich, verantwortlich_email, dokumente, follow_up, unterlagen_anforderungen'

type Akte = AkteFuerRechnung & {
  bereich: string | null
  status?: string | null
  verantwortlich?: string | null
  verantwortlich_email?: string | null
  dokumente?: { id: string; name: string; url?: string }[] | null
  follow_up?: unknown
  unterlagen_anforderungen?: unknown
}

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

export const MAHNUNG_WERKZEUGE = [
  {
    name: 'mahnung_erstellen',
    description:
      'Erstellt zu einer offenen Rechnung die Zahlungserinnerung, 1. oder 2. Mahnung („Zahlungserinnerung LSA-001 senden“, „mahne LSA-001“): PDF auf dem Briefbogen der Holding mit den Texten, Fristen und Gebühren wie im CRM (Erinnerung: 7 Tage Frist, keine Gebühr; 1. und 2. Mahnung: 10 Tage, je 5 € Gebühr), legt es in der Kundenakte ab und bereitet die E-Mail an den Kunden mit dem PDF vor — OHNE zu senden. Ohne Angabe nimmt es die nächste fällige Stufe. Zeige danach Empfänger, Betreff, Anhang, Betrag, Frist und Text und frag, ob du so senden sollst; erst nach seinem klaren Ja in der nächsten Nachricht rufst du mail_senden auf. Nach dem Versand steht die Mahnung an der Rechnung (wie im CRM) und der Mahnvorschlag ist erledigt. Soll das Schreiben per Post gehen, nur_pdf=true.',
    input_schema: {
      type: 'object',
      properties: {
        rechnung_id: { type: 'string' },
        nummer: { type: 'string', description: 'Rechnungsnummer, z. B. "LSA-001", wenn die id nicht bekannt ist.' },
        stufe: { type: 'string', enum: ['erinnerung', 'mahnung1', 'mahnung2'], description: 'Nur wenn der Mitarbeiter eine bestimmte Stufe nennt; sonst die nächste fällige.' },
        erneut: { type: 'boolean', description: 'Nur wenn er ausdrücklich eine schon verschickte Stufe noch einmal schicken will.' },
        gebuehr: { type: 'number', description: 'Nur wenn er eine andere Mahngebühr in Euro nennt (0 = keine).' },
        an: { type: 'string', description: 'Nur wenn er eine andere E-Mail-Adresse nennt als die der Akte.' },
        nur_pdf: { type: 'boolean', description: 'true = keine Mail, nur PDF in der Akte (Versand per Post); wird sofort an der Rechnung vermerkt.' },
      },
    },
  },
  {
    name: 'followup_durchspielen',
    description:
      'Führt den kompletten Follow-up-Ablauf einer Rechnung vor, OHNE etwas zu senden oder zu ändern („Spiel mir den Ablauf für LSA-001 durch“, „Was passiert, wenn der Kunde nicht zahlt?“): je Schritt Datum, was passiert, welche Telegram-Nachricht dann kommt (echter Text mit angenommenem Datum) und was man darauf antworten kann; dazu Vorschau-PDFs von Zahlungserinnerung, 1. und 2. Mahnung (Wasserzeichen „VORSCHAU – nicht versendet“) als Dateien hier in den Chat, nicht in die Akte.',
    input_schema: {
      type: 'object',
      properties: {
        rechnung_id: { type: 'string' },
        nummer: { type: 'string', description: 'Rechnungsnummer, z. B. "LSA-001".' },
      },
    },
  },
]

export function istMahnungWerkzeug(name: string): boolean {
  return MAHNUNG_WERKZEUGE.some((w) => w.name === name)
}

// ---------------------------------------------------------------------------------------------
// Laden (nur lesen)

type RechnungZeile = MahnRechnungDaten & { kunde_id: string | null; versendet_am?: string | null; anschrift?: string | null }

async function findeRechnung(supabase: Supa, id: string, nummer: string): Promise<RechnungZeile | null> {
  if (id) return ((await supabase.from('rechnungen').select('*').eq('id', id).maybeSingle()).data ?? null) as RechnungZeile | null
  for (const n of [...new Set([nummer, nummer.toUpperCase()])]) {
    const { data } = await supabase.from('rechnungen').select('*').eq('nummer', n).limit(1)
    if (data?.length) return data[0] as RechnungZeile
  }
  return null
}

/** Rechnung und Akte mit Rechteprüfung; Fehlertext für den Assistenten. */
export async function ladeRechnungMitAkte(
  supabase: Supa,
  m: RechteMitarbeiter & { name: string },
  input: { rechnung_id?: unknown; nummer?: unknown },
): Promise<{ r: RechnungZeile; akte: Akte } | string> {
  if ((m as { nurPrivat?: boolean }).nurPrivat === true) return 'Fehler: Rechnungen und Mahnungen der Mayer Holding gibt es nur im Mayer-Assistenten.'
  if (!darfBereich(m, 'beratung')) return nichtFreigegeben('beratung', m.name)
  const id = String(input?.rechnung_id ?? '').trim()
  const nummer = String(input?.nummer ?? '').trim()
  if (!id && !nummer) return 'Fehler: rechnung_id oder nummer fehlt.'
  const r = await findeRechnung(supabase, id, nummer)
  const keine = `Es gibt keine Rechnung ${nummer || id}. Offene Rechnungen stehen in rechnungen_offen.`
  if (!r) return keine
  const { data: akte, error } = await supabase.from('kunden').select(AKTE_SPALTEN).eq('id', String(r.kunde_id ?? '')).maybeSingle()
  if (error) return `Fehler beim Laden der Akte: ${error.message}`
  if (!akte || istFremdePrivatakte(m, akte)) return keine
  if (!darfAkte(m, akte)) return nichtFreigegeben(akte.bereich, m.name)
  if (SAMMELAKTEN.includes(akte.id) || istPrivat(akte)) return `Rechnung ${r.nummer} hängt an keiner Kundenakte der Holding — mahnen geht nur im CRM.`
  return { r, akte: akte as Akte }
}

async function ladeEinstellung(supabase: Supa): Promise<MahnEinstellung> {
  const { data, error } = await supabase.from('mahn_einstellung').select('*').eq('id', 1).maybeSingle()
  return einstellungAus(error ? null : data)
}

function alsMahnRechnung(r: RechnungZeile): MahnRechnung {
  return { ...r, kunde_id: r.kunde_id, datum: r.datum, mahnungen: (r.mahnungen ?? []) as MahnRechnung['mahnungen'] }
}

function dokKontext(k: MahnungKontext): DokumentKontext {
  return { supabase: k.supabase, mitarbeiter: k.mitarbeiter, protokolliere: k.protokolliere, heute: k.heute }
}

// ---------------------------------------------------------------------------------------------
// Ausführen

// deno-lint-ignore no-explicit-any
export async function fuehreMahnungWerkzeugAus(name: string, input: any, k: MahnungKontext): Promise<string> {
  if (name === 'followup_durchspielen') {
    const geladen = await ladeRechnungMitAkte(k.supabase, k.mitarbeiter, input ?? {})
    if (typeof geladen === 'string') return geladen
    const ablauf = await spieleFollowupDurch(k.supabase, k.mitarbeiter, geladen.r, geladen.akte, k.heute)
    const chat = await chatVon(k)
    const gesendet = chat ? await sendeVorschauen({ botToken: k.botToken, abruf: k.abruf }, chat, ablauf.vorschauen) : { ok: 0, fehler: ['kein Telegram-Chat verbunden'] }
    k.protokolliere(`Follow-up für Rechnung ${geladen.r.nummer} durchgespielt (nichts gesendet, nichts geändert; ${gesendet.ok} Vorschau-PDF in den Chat)`)
    return [
      'NUR VORFÜHRUNG — nichts wurde gesendet oder geändert. Gib dem Mitarbeiter den Ablauf unten vollständig und unverändert weiter (er hat ausdrücklich darum gebeten), danach höchstens einen Satz.',
      ablauf.vorschauen.length
        ? gesendet.ok === ablauf.vorschauen.length
          ? `Die ${gesendet.ok} Vorschau-PDF (${ablauf.vorschauen.map((v) => v.stufeName).join(', ')}) sind ihm schon als Dateien in den Telegram-Chat geschickt worden; sie liegen NICHT in der Akte.`
          : `Vorschau-PDF: ${gesendet.ok} von ${ablauf.vorschauen.length} in den Chat geschickt (${gesendet.fehler.join('; ')}). Sag ihm das.`
        : '',
      '',
      ablauf.text,
    ]
      .filter((z, i) => z !== '' || i > 1)
      .join('\n')
  }
  if (name === 'mahnung_erstellen') return await mahnungErstellen(input ?? {}, k)
  return `Fehler: unbekanntes Werkzeug ${name}.`
}

// deno-lint-ignore no-explicit-any
async function mahnungErstellen(input: any, k: MahnungKontext): Promise<string> {
  const { supabase, mitarbeiter, heute, protokolliere } = k
  const geladen = await ladeRechnungMitAkte(supabase, mitarbeiter, input)
  if (typeof geladen === 'string') return geladen
  const { r, akte } = geladen
  if (r.status === 'Entwurf') return `Rechnung ${r.nummer} ist noch ein Entwurf — der Kunde hat sie noch nicht. Erst mit rechnung_versenden verschicken; gemahnt wird frühestens nach dem Zahlungsziel.`
  if (r.status !== 'Versendet' && r.status !== 'Überfällig') return `Rechnung ${r.nummer} steht auf „${r.status}“ — da gibt es nichts zu mahnen.`
  const mr = alsMahnRechnung(r)
  if (offenerBetrag(mr) < 0.01) return `Rechnung ${r.nummer} ist vollständig bezahlt — keine Mahnung nötig.`

  const gewuenscht = input?.stufe ? leseStufe(input.stufe) : null
  if (input?.stufe && !gewuenscht) return 'Fehler: stufe muss erinnerung, mahnung1 oder mahnung2 sein.'
  const stufe = gewuenscht ?? naechsteStufe(r.mahnstufe)
  if (!stufe) {
    return `Rechnung ${r.nummer} hat schon die ${mahnstufeName(String(r.mahnstufe))}. Danach gibt es kein weiteres Schreiben aus dem Assistenten — über Inkasso oder gerichtliches Mahnverfahren entscheidet die Geschäftsführung (Vermerk im CRM unter Mahnwesen).`
  }
  const vorher = (r.mahnungen ?? []).filter((m) => m?.stufe === stufe)
  if (stufeErreicht(r.mahnstufe, stufe) && input?.erneut !== true) {
    return `Rechnung ${r.nummer} hat die ${mahnstufeName(stufe)} schon${vorher.length ? ` (am ${deDatum(vorher[vorher.length - 1].datum)})` : ''}; aktuelle Stufe: ${mahnstufeName(String(r.mahnstufe))}. Frag, ob die nächste Stufe gemeint ist oder ob dieselbe noch einmal raus soll (dann erneut=true).`
  }

  const anschrift = anschriftFuer(String(r.anschrift ?? ''), akte)
  if (!hatPlzOrt(anschrift)) return `Nicht erstellt: Für ${akteName(akte)} fehlt die Anschrift (Straße und PLZ Ort) — auf einem Mahnschreiben ist sie Pflicht. Frag danach und trag sie in der Akte ein (kunde_aktualisieren), dann noch einmal.`
  const nurPdf = input?.nur_pdf === true
  const an = String(input?.an ?? '').trim().toLowerCase() || String(akte.email ?? '').trim().toLowerCase()
  if (!nurPdf) {
    if (!an) return `Nicht erstellt: In der Akte ${akteName(akte)} steht keine E-Mail-Adresse. Frag nach der Adresse (dann mit an) oder ob das Schreiben per Post gehen soll (nur_pdf=true).`
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(an)) return `Fehler: „${an}“ ist keine gültige E-Mail-Adresse.`
    if (!k.merkeMailEntwurf) return 'Fehler: Der Mailversand ist hier nicht eingerichtet.'
  }

  const vorlage = mahnVorlage(r, stufe)
  const gebuehrRoh = input?.gebuehr === undefined || input?.gebuehr === null || input?.gebuehr === '' ? vorlage.gebuehr : Number(input.gebuehr)
  if (!Number.isFinite(gebuehrRoh) || gebuehrRoh < 0 || gebuehrRoh > 100) return 'Fehler: gebuehr muss zwischen 0 und 100 Euro liegen.'
  const gebuehr = Math.round(gebuehrRoh * 100) / 100
  const datum = heute
  const frist = plusTage(datum, vorlage.tage)
  const betraege = mahnBetraege(r, gebuehr)

  // Hinweis, wenn die Stufe laut Mahnregel noch nicht dran wäre (gesendet wird trotzdem nur nach dem Ja).
  let regelHinweis = ''
  const p = pruefeRechnung(mr, heute, await ladeEinstellung(supabase))
  if (p.ergebnis === 'warten' && p.stufe === stufe) regelHinweis = `Hinweis: Laut Mahnregel wäre die ${mahnstufeName(stufe)} erst ab ${deDatum(p.ab)} dran. Sag ihm das; wenn er trotzdem jetzt will, ist das in Ordnung.`
  if (p.ergebnis === 'uebersprungen') regelHinweis = `Achtung: ${p.grund}. Sag ihm das, bevor er sendet.`

  let pdf: Uint8Array
  try {
    pdf = (await erzeugeHoldingMahnungPdf({ rechnung: r, stufe, datum, neueFrist: frist, gebuehr, empfaenger: empfaengerZeilen(akte, anschrift), text: vorlage.text, schluss: vorlage.schluss, absender: mitarbeiter.name })).bytes
  } catch (err) {
    return `Nicht erstellt: Das PDF ließ sich nicht erzeugen (${err instanceof Error ? err.message : String(err)}).`
  }
  const ziel = await ladeZiel(dokKontext(k), { kunde_id: akte.id }, 'Sonstiges')
  if (typeof ziel === 'string') return ziel
  const dateiName = mahnungDateiname(r.nummer, stufe, datum)
  const name = mahnstufeName(stufe)
  const abgelegt = await legeAb(dokKontext(k), ziel, heute, {
    bytes: pdf,
    dateiName,
    typ: 'application/pdf',
    aktivitaet: (anzeige, groesse) => `${name} zu Rechnung ${r.nummer} erstellt${nurPdf ? ' (für den Postversand)' : ' (noch nicht versendet)'}: „${anzeige}“ (${groesse})`,
  })
  if (typeof abgelegt === 'string') return abgelegt

  const eintrag: MahnEintrag = { id: neueMahnId(), datum, stufe, gebuehr, neueFrist: frist, weg: nurPdf ? 'pdf' : 'email', dokumentName: abgelegt.name, von: mitarbeiter.name }
  const bezug: MahnungBezug = { rechnung_id: r.id, nummer: r.nummer, kunde_id: akte.id, stufe, eintrag, summe: betraege.summe }
  const zusatz = `${betraege.fruehere > 0 ? ` + frühere Mahngebühren ${euro(betraege.fruehere)}` : ''}${betraege.gebuehr > 0 ? ` + Mahngebühr ${euro(betraege.gebuehr)}` : ''}`
  const aufstellung = `offen ${euro(betraege.offen)}${zusatz ? `${zusatz} = ${euro(betraege.summe)}` : ''}, neue Frist ${deDatum(frist)}`

  if (nurPdf) {
    await trageMahnungEin(supabase, bezug, { weg: 'pdf' }, mitarbeiter.name, heute)
    protokolliere(`${name} zu Rechnung ${r.nummer} als PDF erstellt und an der Rechnung vermerkt (Postversand)`)
    return [
      `${name} zu Rechnung ${r.nummer} als PDF erstellt (für den Postversand) und an der Rechnung vermerkt: ${aufstellung}.`,
      `Das PDF liegt in der Akte ${akteName(akte)} unter Dokumente: „${abgelegt.name}“ (mit datei_senden hier zeigen, wenn er es ausdrucken will).`,
      '',
      'Nächste Schritte:',
      await folgeFuerAkte(supabase, akte, heute),
    ].join('\n')
  }

  const { data: frisch } = await supabase.from('kunden').select('dokumente').eq('id', akte.id).maybeSingle()
  const neu = ((frisch?.dokumente ?? []) as { id: string; url?: string }[]).find((d) => d.id === abgelegt.id)
  const anhang: RechnungAnhang = { eimer: EIMER, pfad: String(neu?.url ?? ''), dateiname: abgelegt.name, typ: 'application/pdf' }
  const empfaenger: RechnungMailEmpfaenger = { kunde_id: akte.id, bereich: String(akte.bereich ?? ''), name: String(akte.ansprechpartner ?? '').trim(), firma: String(akte.firma ?? '').trim(), email: an, status: String(akte.status ?? '') }
  const text = mahnungMailText(r, stufe, betraege.summe, frist)
  const entwurf: MahnungMailEntwurf = { id: crypto.randomUUID().slice(0, 8), betreff: mahnungBetreff(r.nummer, stufe), text, empfaenger: [empfaenger], z: new Date().toISOString(), anhaenge: [anhang], mahnung: bezug }
  k.merkeMailEntwurf!(entwurf)
  protokolliere(`${name} zu Rechnung ${r.nummer} an ${an} vorbereitet (noch nicht gesendet)`)
  return [
    'NOCH NICHT GESENDET. Zeige dem Mitarbeiter jetzt Stufe, Betrag, Frist, Empfänger, Betreff, Anhang und den Text unten vollständig und frag, ob du so senden sollst. Erst wenn er in seiner nächsten Nachricht klar zustimmt, rufst du mail_senden auf.',
    regelHinweis,
    `${name} zu Rechnung ${r.nummer} (${akteName(akte)}): ${aufstellung}.`,
    `Empfänger: ${empfaenger.name || empfaenger.firma} <${an}>`,
    `Betreff: ${entwurf.betreff}`,
    `Anhang: ${anhang.dateiname} (liegt schon in der Akte unter Dokumente)`,
    'Nach dem Versand steht die Mahnung an der Rechnung (wie im CRM), der Mahnvorschlag ist erledigt, und er bekommt die nächsten Schritte.',
    '-----',
    k.mailText ? k.mailText(text, empfaenger) : text.replace('{{anrede}}', empfaenger.name ? `Guten Tag ${empfaenger.name}` : 'Sehr geehrte Damen und Herren'),
    '-----',
  ]
    .filter(Boolean)
    .join('\n')
}

async function folgeFuerAkte(supabase: Supa, akte: { id: string; bereich: string | null; follow_up?: unknown; unterlagen_anforderungen?: unknown }, heute: string): Promise<string> {
  try {
    return folgeText(berechneFolgeSchritte(await ladeFolgeDaten(supabase, akte, heute, true)), heute)
  } catch (err) {
    return `(Follow-up-Schritte ließen sich nicht berechnen: ${err instanceof Error ? err.message : String(err)})`
  }
}

// ---------------------------------------------------------------------------------------------
// Nach dem Versand (aus fuehreMailSchrittAus in index.ts)

/**
 * Eintrag an der Rechnung wie das CRM (mahnungen, mahnstufe, Status), offene Mahnvorschläge erledigen, Vermerk in der
 * Akte. Doppelt aufgerufen passiert nichts (der Eintrag hat eine feste Kennung). Wirft nie.
 */
export async function trageMahnungEin(supabase: Supa, b: MahnungBezug, versand: { weg: 'email' | 'pdf'; an?: string }, von: string, heute: string): Promise<void> {
  try {
    const { data: r } = await supabase.from('rechnungen').select('id, status, mahnungen').eq('id', b.rechnung_id).maybeSingle()
    if (!r) return
    if (((r.mahnungen ?? []) as { id?: string }[]).some((m) => m?.id === b.eintrag.id)) return
    const eintrag: MahnEintrag = { ...b.eintrag, weg: versand.weg, ...(versand.an ? { an: versand.an } : {}), von }
    const { error } = await supabase.from('rechnungen').update(rechnungNachMahnung(r, eintrag)).eq('id', b.rechnung_id)
    if (error) throw new Error(`rechnungen: ${error.message}`)

    // Offene/zurückgestellte Vorschläge dieser und niedrigerer Stufen sind damit gesendet (wie die Seite Mahnwesen).
    try {
      const { data: offen } = await supabase.from('mahn_vorschlaege').select('id, stufe, status').eq('rechnung_id', b.rechnung_id).in('status', ['offen', 'zurueckgestellt'])
      const jetzt = new Date().toISOString()
      for (const z of (offen ?? []) as { id: string; stufe: MahnStufe; status: string }[]) {
        if (!stufeErreicht(b.stufe, z.stufe)) continue
        await supabase.from('mahn_vorschlaege').update({ status: 'gesendet', erledigt_am: jetzt, erledigt_von: von, geaendert_am: jetzt }).eq('id', z.id).eq('status', z.status)
      }
    } catch (err) {
      console.error('Mahnvorschlag nicht abgehakt:', err)
    }

    const { data: k } = await supabase.from('kunden').select('activities').eq('id', b.kunde_id).maybeSingle()
    if (k) {
      const vermerk = { id: crypto.randomUUID(), date: heute, text: mahnVermerk(b.nummer, b.stufe, versand.weg, versand.an, String(b.eintrag.neueFrist ?? ''), b.summe), user: von }
      await supabase.from('kunden').update({ activities: [vermerk, ...((k.activities ?? []) as unknown[])], letzte_aktivitaet: heute }).eq('id', b.kunde_id)
    }
  } catch (err) {
    console.error(`Mahnung zu Rechnung ${b.nummer} nicht eingetragen:`, err)
  }
}

export async function mahnungNachVersand(supabase: Supa, b: MahnungBezug, an: string, von: string, heute: string): Promise<void> {
  await trageMahnungEin(supabase, b, { weg: 'email', an }, von, heute)
}

/** Zeilen für die Abschlussnachricht nach dem Versand. Wirft nie. */
export async function folgeNachMahnung(supabase: Supa, b: MahnungBezug, heute: string): Promise<string> {
  try {
    const { data: akte } = await supabase.from('kunden').select('id, bereich, follow_up, unterlagen_anforderungen').eq('id', b.kunde_id).maybeSingle()
    if (!akte) return ''
    return `${mahnstufeName(b.stufe)} zu Rechnung ${b.nummer} ist an der Rechnung vermerkt (neue Frist ${deDatum(b.eintrag.neueFrist)}, offen ${euro(b.summe)}).\nNächste Schritte im Follow-up:\n${await folgeFuerAkte(supabase, akte, heute)}`
  } catch (err) {
    console.error('Follow-up nach Mahnung nicht berechnet:', err)
    return ''
  }
}

// ---------------------------------------------------------------------------------------------
// Durchspielen — liest nur, schreibt nichts.

export type Vorschau = { stufe: MahnStufe; stufeName: string; dateiname: string; bytes: Uint8Array }

const TELEGRAM_GRENZE = 3900

/** Nächster Werktag (Mo–Fr) ab `datum` — die Morgen-Übersicht kommt nur an Werktagen. */
export function naechsterWerktag(datum: string): string {
  let d = datum
  for (let i = 0; i < 7; i++) {
    const tag = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (tag !== 0 && tag !== 6) return d
    d = plusTage(d, 1)
  }
  return d
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const tagText = (d: string) => `${WOCHENTAG[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${deDatum(d)}`
const zitat = (t: string) => t.split('\n').map((z) => `» ${z}`).join('\n')
const max = (a: string, b: string) => (a > b ? a : b)

/**
 * Baut den vorgeführten Ablauf und die Vorschau-PDFs. Nur lesende Abfragen; die Annahme: Der Kunde zahlt nicht, und der
 * Mitarbeiter schickt jedes Schreiben am Tag des Vorschlags.
 */
export async function spieleFollowupDurch(
  supabase: Supa,
  m: RechteMitarbeiter & { name: string; email?: string | null },
  r: RechnungZeile,
  akte: Akte,
  heute: string,
): Promise<{ text: string; vorschauen: Vorschau[] }> {
  const [einstellung, regelnRoh, wvRoh, vorschlaegeRoh, wk] = await Promise.all([
    ladeEinstellung(supabase),
    supabase.from('wiedervorlage_regeln').select('id, titel, tage, aktiv, bereich').eq('ausloeser', 'ereignis:rechnung').eq('aktiv', true),
    supabase.from('wiedervorlagen').select('regel, titel, faellig').eq('kunde_id', akte.id).is('erledigt_am', null),
    supabase.from('mahn_vorschlaege').select('stufe, status, zurueckgestellt_bis').eq('rechnung_id', r.id).in('status', ['offen', 'zurueckgestellt']),
    supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle(),
  ])
  const basis = String(wk?.data?.link_basis ?? '').trim() || CRM_BASIS_STANDARD
  const regeln = ((regelnRoh?.data ?? []) as { id: string; titel: string; tage: number; bereich: string | null }[]).filter((x) => !x.bereich || x.bereich === akte.bereich)
  const offeneWv = (wvRoh?.data ?? []) as { regel: string | null; titel: string; faellig: string }[]
  const vorschlaege = (vorschlaegeRoh?.data ?? []) as { stufe: string; status: string; zurueckgestellt_bis: string | null }[]
  const kunde = akteName(akte)
  const zeilen: string[] = [`Follow-up Rechnung ${r.nummer} (${kunde}) — VORFÜHRUNG: nichts wird gesendet oder geändert. Annahme: Der Kunde zahlt nicht, und du schickst jedes Schreiben am Tag des Vorschlags.`]
  const ziel = /^\d{4}-\d{2}-\d{2}/.test(String(r.zahlungsziel ?? '')) ? String(r.zahlungsziel).slice(0, 10) : ''
  const offen = offenerBetrag({ ...alsMahnRechnung(r), status: r.status === 'Entwurf' ? 'Versendet' : r.status })
  let nr = 0
  const schritt = (datum: string, titel: string) => zeilen.push('', `${++nr}. ${tagText(datum)}: ${titel}`)

  if (r.status === 'Bezahlt' || offen < 0.01) {
    zeilen.push('', 'Die Rechnung ist bezahlt — es folgt kein weiterer Schritt.')
    return { text: zeilen.join('\n'), vorschauen: [] }
  }
  if (r.status === 'Entwurf') {
    schritt(heute, `Rechnung versenden (noch Entwurf).`)
    zeilen.push(`Antwort: „Rechnung ${r.nummer} senden“ → ich bereite die Mail mit PDF vor, gesendet wird nach deinem Ja; danach steht sie auf Versendet.`)
  } else if (r.status !== 'Versendet' && r.status !== 'Überfällig') {
    zeilen.push('', `Die Rechnung steht auf „${r.status}“ — dafür gibt es keinen Ablauf.`)
    return { text: zeilen.join('\n'), vorschauen: [] }
  }
  if (!ziel) {
    zeilen.push('', 'Die Rechnung hat kein Zahlungsziel bzw. keinen Prüftag — ohne Datum schlägt das CRM keine Mahnung vor.')
    return { text: zeilen.join('\n'), vorschauen: [] }
  }

  // Wiedervorlage „Geldeingang prüfen“ (Regel ereignis:rechnung) → Morgen-Übersicht.
  const person: Person = { email: String(m.email ?? '').toLowerCase(), name: m.name, chat: null, gf: m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [] }
  const verantwortlich = String(akte.verantwortlich ?? '').trim()
  for (const regel of regeln) {
    const vorhanden = offeneWv.find((w) => w.regel === regel.id)
    const faellig = vorhanden ? String(vorhanden.faellig).slice(0, 10) : plusTage(ziel, Number(regel.tage) || 0)
    const ankunft = naechsterWerktag(max(faellig, heute))
    const daten: Daten = {
      kunden: [{ id: akte.id, bereich: akte.bereich, firma: akte.firma, ansprechpartner: akte.ansprechpartner, verantwortlich: m.name }],
      objekte: [],
      termine: [],
      todos: [],
      treffer: [],
      fragen: [],
      ungeklaert: 0,
      trefferErststand: null,
      wiedervorlagen: [{ id: 'vorschau', kunde_id: akte.id, bereich: akte.bereich, titel: regel.titel, faellig, verantwortlich: m.name }],
    }
    const jetzt = new Date(berlinTagesbeginn(ankunft).getTime() + 8 * 3600_000)
    const morgen = morgenText(person, daten, jetzt)
    const wer = verantwortlich
      ? `den Verantwortlichen der Akte (${verantwortlich})`
      : 'die Geschäftsführung (in der Akte ist kein Verantwortlicher eingetragen)'
    schritt(ankunft, `${r.ohne_zahlungsfrist ? 'Interner Prüftag (auf der Rechnung steht keine Frist)' : 'Zahlungsziel'} — Wiedervorlage „${regel.titel}“${vorhanden ? ' (liegt schon an)' : ' (legt das CRM beim Versand an)'}${faellig !== ankunft ? `, fällig ${deDatum(faellig)}` : ''}.`)
    zeilen.push(`Telegram ab 8 Uhr an ${wer}, als Teil der Morgen-Übersicht (Mo–Fr):`)
    if (morgen) zeilen.push(zitat(morgen))
    zeilen.push(`Antwort: „${r.nummer} ist bezahlt, ${euro(offen)} am …“ → Zahlung erfasst, Ablauf endet.`)
  }

  // Mahnstufen
  const vorschauen: Vorschau[] = []
  if (!einstellung.aktiv) {
    zeilen.push('', 'Die täglichen Mahnvorschläge sind im CRM ausgeschaltet (Automatische Nachrichten / Mahnwesen) — dann kommt nach dem Zahlungsziel keine Nachricht.')
  } else {
    const sim: RechnungZeile = { ...r, status: r.status === 'Entwurf' ? 'Versendet' : r.status, mahnungen: [...(r.mahnungen ?? [])] }
    const anschrift = anschriftFuer(String(r.anschrift ?? ''), akte)
    const empfaenger = empfaengerZeilen(akte, anschrift)
    let stufe = naechsteStufe(sim.mahnstufe)
    while (stufe) {
      const fristVorher = aktuelleFrist(alsMahnRechnung(sim))
      const vorschlag = vorschlaege.find((v) => v.stufe === stufe)
      let ab = max(plusTage(ziel, einstellung.tage[stufe]), /^\d{4}-\d{2}-\d{2}/.test(fristVorher) ? plusTage(fristVorher, 1) : ziel)
      if (vorschlag?.status === 'zurueckgestellt' && vorschlag.zurueckgestellt_bis) ab = max(ab, plusTage(String(vorschlag.zurueckgestellt_bis).slice(0, 10), 1))
      ab = max(ab, heute)
      const name = mahnstufeName(stufe)
      const vorlage = mahnVorlage(sim, stufe)
      const frist = plusTage(ab, vorlage.tage)
      const betraege = mahnBetraege(sim, vorlage.gebuehr)
      schritt(ab, `${name} fällig (${tageZwischen(ziel, ab)} Tage nach dem ${r.ohne_zahlungsfrist ? 'Prüftag' : 'Zahlungsziel'}${vorschlag?.status === 'offen' ? ', Vorschlag liegt schon vor' : ''}).`)
      if (vorschlag?.status === 'offen') zeilen.push('Der Vorschlag ist schon gemeldet; eine neue Nachricht kommt dafür nicht.')
      else {
        zeilen.push(`Telegram ab 9 Uhr (Tageslauf Mahnwesen) an ${akte.verantwortlich_email ? 'den Verantwortlichen der Akte' : 'die Geschäftsführung'}:`)
        zeilen.push(zitat(hinweisText([{ id: vorschlagId(r.id, stufe), nummer: r.nummer, kunde, stufe, tage: tageZwischen(ziel, ab), offen: offenerBetrag(alsMahnRechnung(sim)) }], basis)))
      }
      zeilen.push(`Auf „${name} ${r.nummer} senden“: PDF in die Akte, Mail vorbereitet, raus nach deinem Ja — ${euro(betraege.summe)}${betraege.gebuehr ? ` inkl. ${euro(betraege.gebuehr)} Gebühr` : ''}, neue Frist ${deDatum(frist)} (Vorschau-PDF im Chat).`)
      try {
        const { bytes } = await erzeugeHoldingMahnungPdf({ rechnung: sim, stufe, datum: ab, neueFrist: frist, gebuehr: vorlage.gebuehr, empfaenger, text: vorlage.text, schluss: vorlage.schluss, absender: m.name, vorschau: true })
        vorschauen.push({ stufe, stufeName: name, dateiname: `VORSCHAU ${mahnungDateiname(r.nummer, stufe, ab)}`, bytes })
      } catch (err) {
        zeilen.push(`(Vorschau-PDF nicht erzeugt: ${err instanceof Error ? err.message : String(err)})`)
      }
      sim.mahnungen = [...(sim.mahnungen ?? []), { id: `sim_${stufe}`, datum: ab, stufe, gebuehr: vorlage.gebuehr, neueFrist: frist, weg: 'email' }]
      sim.mahnstufe = stufe
      stufe = naechsteStufe(stufe)
    }
    if (sim.mahnstufe === 'mahnung2') {
      const nachFrist = max(plusTage(aktuelleFrist(alsMahnRechnung(sim)), 1), heute)
      schritt(nachFrist, 'Frist der 2. Mahnung abgelaufen — kein automatischer Vorschlag mehr. Über Inkasso oder gerichtliches Mahnverfahren entscheidet die Geschäftsführung (im CRM unter Mahnwesen vermerken).')
    }
    zeilen.push('', `Regeln: Erinnerung ${einstellung.tage.erinnerung}, 1. Mahnung ${einstellung.tage.mahnung1}, 2. Mahnung ${einstellung.tage.mahnung2} Tage nach dem ${r.ohne_zahlungsfrist ? 'Prüftag' : 'Zahlungsziel'}, jeweils erst nach Ablauf der Frist des vorigen Schreibens. Geht in den ${einstellung.ruheTage} Tagen davor eine Zahlung ein oder liegt ein passender Kontoauszug vor, wird der Schritt zurückgehalten; ist alles bezahlt, endet der Ablauf. „${r.nummer} zurückstellen bis …“ (z. B. Ratenzahlung) geht im CRM unter Mahnwesen.`)
  }
  let text = zeilen.join('\n')
  if (text.length > TELEGRAM_GRENZE) text = `${text.slice(0, TELEGRAM_GRENZE - 2)} …`
  return { text, vorschauen }
}

async function chatVon(k: MahnungKontext): Promise<number | string | null> {
  if (k.chatId) return k.chatId
  const m = k.mitarbeiter
  const { data } = m.id
    ? await k.supabase.from('mitarbeiter').select('telegram_chat_id').eq('id', m.id).maybeSingle()
    : await k.supabase.from('mitarbeiter').select('telegram_chat_id').ilike('email', String(m.email ?? '')).maybeSingle()
  return data?.telegram_chat_id ?? null
}

/** Vorschau-PDFs per sendDocument in den Chat (ohne Bot-Schlüssel nur protokolliert). */
export async function sendeVorschauen(k: { botToken?: string | null; abruf?: typeof fetch }, chatId: number | string, vorschauen: Vorschau[]): Promise<{ ok: number; fehler: string[] }> {
  const token = k.botToken === undefined ? Deno.env.get('TELEGRAM_BOT_TOKEN') : k.botToken
  const abruf = k.abruf ?? fetch
  const aus = { ok: 0, fehler: [] as string[] }
  for (const v of vorschauen) {
    if (!token) {
      console.log(`[Telegram-Datei -> ${chatId}] ${v.dateiname} (${v.bytes.length} Bytes, Vorschau)`)
      aus.ok++
      continue
    }
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('document', new Blob([v.bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), v.dateiname)
    form.append('caption', `VORSCHAU – nicht versendet: ${v.stufeName}`)
    try {
      const res = await abruf(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
      // deno-lint-ignore no-explicit-any
      const j: any = await res.json().catch(() => null)
      if (j?.ok) aus.ok++
      else aus.fehler.push(`${v.stufeName}: ${j?.description ?? res.status}`)
    } catch (e) {
      aus.fehler.push(`${v.stufeName}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return aus
}
