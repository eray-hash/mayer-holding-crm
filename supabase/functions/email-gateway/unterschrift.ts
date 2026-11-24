// Online-Unterschrift (22.11.2026): die öffentliche Seite /formular/unterschrift/:token
// (src/pages/formulare/PublicUnterschrift.tsx), ohne Login.
//
// Ablauf: Ein Mitarbeiter füllt im CRM eine Vorlage aus und schickt sie zum Unterschreiben
// (src/components/UnterschriftAnfordern.tsx). Die Anfrage steht in unterschrift_anfragen mit dem Schnappschuss
// des Texts (siehe _shared/unterschriftKern.ts) und einer geheimen Kennung. Der Kunde öffnet den Link, liest,
// füllt seine Felder aus, bestätigt „gelesen“, tippt seinen Namen und unterschreibt. Der Server
//  - prüft alles (Kennung, Status, Frist, Pflichtfelder, Name, Unterschrift als echtes PNG),
//  - erzeugt das unterschriebene PDF (unterschriftPdf.ts) mit Nachweis (Zeit, Name, IP, Gerät, Prüfsumme),
//  - hält den Nachweis in der Anfrage fest (nur wenn sie noch offen ist — doppelt Absenden ändert nichts),
//  - legt das PDF in die Dokumente der Akte (Eimer kunden-dokumente, Pfad <kundeId>/dok_…), schreibt den
//    Verlauf und trägt die Unterschrift in kunden.signaturen ein (damit schließt die Datenbank-Regel
//    „unterschrift“ offene Wiedervorlagen wie „Beratungsvereinbarung unterschrieben zurück?“),
//  - meldet es dem Verantwortlichen der Akte per Telegram,
//  - schickt dem Kunden eine Kopie nur, wenn der Schalter unterschrift_einstellung.kopie_an_kunde an ist.
// Der Kunde kann auch ablehnen (mit Grund); dann Verlauf + Telegram, sonst nichts.
//
// Der Datenbank-Zugang wird übergeben (Dienstschlüssel); keine Abhängigkeit von index.ts.
import {
  type KundenFeld, kundenFelderAus, pruefeKundenwerte, pruefsumme, setzeKundenwerte, UNTERSCHRIFT_TOKEN, wertSauber, zeitDe,
} from '../_shared/unterschriftKern.ts'
import { erzeugeUnterschriftPdf } from './unterschriftPdf.ts'
import { ladeMailVorlage, type MailText, rendere, unterschriftWerte, VORLAGE } from './automatikVorlagen.ts'
import { protokolliereNachricht } from '../_shared/nachrichtenProtokoll.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

export const UNTERSCHRIFT_BUCKET = 'kunden-dokumente'
/** Größte erlaubte Unterschrift (PNG-Bytes). Ein Bild vom Unterschriftenfeld hat meist 5–30 KB. */
export const MAX_UNTERSCHRIFT_BYTES = 400_000
/** So lange nach der Unterschrift kann der Kunde seine Kopie über den Link herunterladen. */
const KOPIE_TAGE = 30
const TAG_MS = 86400000

export type Antwort = { status: number; body: Record<string, unknown> }

export type LadenErgebnis =
  | { stufe: 'ungueltig'; grund: string }
  | { stufe: 'offen'; titel: string; text: string; kopfstil: string; felder: KundenFeld[]; anrede: string; gueltigBis: string }
  | { stufe: 'unterschrieben'; titel: string; am: string; name: string; kopieUrl?: string }
  | { stufe: 'abgelehnt'; titel: string }

export type Meta = { ip: string; geraet: string }

export type Helfer = {
  /** Telegram an einen Mitarbeiter (nach E-Mail, sonst Name). */
  melde?: (an: { name?: string | null; email?: string | null }, text: string) => Promise<void>
  /** Mail mit Anhang an den Kunden (nur wenn der Schalter an ist). */
  sendeKopie?: (
    an: string,
    betreff: string,
    text: string,
    anhang: { filename: string; contentBase64: string; contentType: string },
    kontext: { kundeId: string; bereich: string; kundeName: string; anName: string },
  ) => Promise<void>
  jetzt?: Date
}

type Anfrage = {
  id: string
  token: string
  kunde_id: string
  bereich: string
  titel: string
  kopfstil: string | null
  ausgefuellter_text: string
  felder_kunde: unknown
  email: string | null
  an_name: string | null
  status: string
  gueltig_bis: string
  zugriffe: number | null
  unterschrieben_am: string | null
  name_getippt: string | null
  dokument: string | null
  erstellt_von: string | null
  erstellt_am: string
}

const UNGUELTIG = 'Dieser Link ist ungültig. Bitte prüfen Sie, ob Sie ihn vollständig geöffnet haben, oder fragen Sie bei uns nach.'
const ABGELAUFEN = 'Dieser Link ist abgelaufen. Bitte fordern Sie bei uns einen neuen an.'
const ZURUECK = 'Diese Anfrage haben wir zurückgezogen. Bitte wenden Sie sich bei Fragen an uns.'
const FEHLER = 'Da ist bei uns etwas schiefgegangen. Bitte versuchen Sie es in ein paar Minuten noch einmal.'

const heuteBerlin = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)
const datumDe = (d: Date) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)

function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Dateiname ohne Sonderzeichen für den Speicherpfad. */
export function pfadName(titel: string): string {
  const s = titel
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)
  return `${s || 'Dokument'}_unterschrieben.pdf`
}

/** Prüft die Unterschrift: data-URL eines PNG, nicht leer, nicht zu groß. Liefert die Bytes oder einen Fehlertext. */
export function pruefeUnterschrift(v: unknown): { bytes: Uint8Array } | { fehler: string } {
  const praefix = 'data:image/png;base64,'
  if (typeof v !== 'string' || !v.startsWith(praefix)) return { fehler: 'Bitte unterschreiben Sie im Feld unten.' }
  const b64 = v.slice(praefix.length)
  if (b64.length > Math.ceil((MAX_UNTERSCHRIFT_BYTES * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { fehler: 'Die Unterschrift ließ sich nicht lesen. Bitte noch einmal unterschreiben.' }
  let bytes: Uint8Array
  try {
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return { fehler: 'Die Unterschrift ließ sich nicht lesen. Bitte noch einmal unterschreiben.' }
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 100 || !png.every((b, i) => bytes[i] === b)) return { fehler: 'Die Unterschrift ließ sich nicht lesen. Bitte noch einmal unterschreiben.' }
  return { bytes }
}

/** Vollständiger Name: mindestens zwei Wörter, 4–120 Zeichen. */
export function pruefeName(v: unknown): string | null {
  const n = wertSauber(v).slice(0, 120)
  if (n.length < 4 || n.split(' ').filter((t) => t.length >= 1).length < 2 || !/\p{L}/u.test(n)) return null
  return n
}

async function ladeAnfrage(admin: Admin, token: unknown, jetzt: Date): Promise<{ a: Anfrage } | { grund: string }> {
  if (typeof token !== 'string' || !UNTERSCHRIFT_TOKEN.test(token)) return { grund: UNGUELTIG }
  const { data, error } = await admin.from('unterschrift_anfragen').select('*').eq('token', token).maybeSingle()
  if (error) throw new Error(`Anfrage nicht lesbar: ${error.message}`)
  if (!data) return { grund: UNGUELTIG }
  const a = data as Anfrage
  if (a.status === 'zurueckgezogen') return { grund: ZURUECK }
  if (a.status === 'abgelaufen') return { grund: ABGELAUFEN }
  if (a.status === 'offen' && new Date(a.gueltig_bis).getTime() < jetzt.getTime()) {
    await admin.from('unterschrift_anfragen').update({ status: 'abgelaufen' }).eq('id', a.id).eq('status', 'offen')
    return { grund: ABGELAUFEN }
  }
  return { a }
}

async function kopieUrl(admin: Admin, a: Anfrage, jetzt: Date): Promise<string | undefined> {
  if (!a.dokument || !a.unterschrieben_am) return undefined
  if (jetzt.getTime() - new Date(a.unterschrieben_am).getTime() > KOPIE_TAGE * TAG_MS) return undefined
  if (!a.dokument.startsWith(`${a.kunde_id}/`) || a.dokument.includes('..')) return undefined
  const { data } = await admin.storage.from(UNTERSCHRIFT_BUCKET).createSignedUrl(a.dokument, 60 * 10, { download: pfadName(a.titel) })
  return data?.signedUrl ?? undefined
}

function anredeAus(name: string | null): string {
  const n = String(name ?? '').trim()
  return n ? `Guten Tag ${n},` : 'Guten Tag,'
}

/** Bisheriger fester Text der Kopie — Ersatz, wenn die Vorlage mv-auto-unterschrift-kopie fehlt. */
export function kopieMailText(anName: string, dokument: string): MailText {
  return {
    betreff: `Ihre unterschriebene ${dokument}`,
    text: `${anredeAus(anName)}\n\nvielen Dank für Ihre Unterschrift. Im Anhang finden Sie „${dokument}“ mit Ihrer elektronischen Unterschrift für Ihre Unterlagen.\n\nMit freundlichen Grüßen\nAndreas Mayer Holding`,
  }
}

/** Kopie-Mail aus der Vorlage (bearbeitbar unter „Automatische Nachrichten“), sonst der feste Text. */
export function kopieMail(anName: string, dokument: string, vorlage: MailText | null): MailText {
  return rendere(vorlage, unterschriftWerte({ anName, dokument }), () => kopieMailText(anName, dokument))
}

/** Seite laden. */
export async function unterschriftLaden(admin: Admin, token: unknown, jetzt = new Date()): Promise<LadenErgebnis> {
  const r = await ladeAnfrage(admin, token, jetzt)
  if ('grund' in r) return { stufe: 'ungueltig', grund: r.grund }
  const { a } = r
  if (a.status === 'unterschrieben') return { stufe: 'unterschrieben', titel: a.titel, am: a.unterschrieben_am ?? '', name: a.name_getippt ?? '', kopieUrl: await kopieUrl(admin, a, jetzt) }
  if (a.status === 'abgelehnt') return { stufe: 'abgelehnt', titel: a.titel }
  await admin.from('unterschrift_anfragen').update({ zugriffe: (a.zugriffe ?? 0) + 1, letzter_zugriff: jetzt.toISOString() }).eq('id', a.id)
  return {
    stufe: 'offen',
    titel: a.titel,
    text: a.ausgefuellter_text,
    kopfstil: a.kopfstil ?? '',
    felder: kundenFelderAus(a.felder_kunde),
    anrede: anredeAus(a.an_name),
    gueltigBis: a.gueltig_bis,
  }
}

export type AbsendenEingabe = { gelesen?: unknown; name?: unknown; unterschrift?: unknown; werte?: unknown; ablehnen?: unknown; grund?: unknown }

type AkteZeile = { id: string; bereich: string; firma: string | null; ansprechpartner: string | null; email: string | null; verantwortlich: string | null; verantwortlich_email: string | null }

/** Ergänzt die Akte (frisch lesen, vorn anfügen, schreiben, nachlesen; höchstens dreimal). */
async function ergaenzeAkte(
  admin: Admin,
  kundeId: string,
  neu: { dokument?: Record<string, unknown>; aktivitaet: Record<string, unknown>; signatur?: Record<string, unknown> },
  heute: string,
): Promise<boolean> {
  for (let versuch = 0; versuch < 3; versuch++) {
    const { data: z, error } = await admin.from('kunden').select('dokumente, activities, signaturen').eq('id', kundeId).maybeSingle()
    if (error || !z) return false
    const dok = Array.isArray(z.dokumente) ? z.dokumente : []
    const akt = Array.isArray(z.activities) ? z.activities : []
    const sig = Array.isArray(z.signaturen) ? z.signaturen : []
    const hat = (liste: { id?: string }[], e?: Record<string, unknown>) => !e || liste.some((x) => x?.id === e.id)
    const patch: Record<string, unknown> = { letzte_aktivitaet: heute }
    if (!hat(dok, neu.dokument)) patch.dokumente = [neu.dokument, ...dok]
    if (!hat(akt, neu.aktivitaet)) patch.activities = [neu.aktivitaet, ...akt]
    if (!hat(sig, neu.signatur)) patch.signaturen = [neu.signatur, ...sig]
    if (Object.keys(patch).length === 1) return true
    const { error: schreibFehler } = await admin.from('kunden').update(patch).eq('id', kundeId)
    if (schreibFehler) return false
    const { data: n } = await admin.from('kunden').select('dokumente, activities, signaturen').eq('id', kundeId).maybeSingle()
    if (n && hat(n.dokumente ?? [], neu.dokument) && hat(n.activities ?? [], neu.aktivitaet) && hat(n.signaturen ?? [], neu.signatur)) return true
  }
  return false
}

function akteName(k: AkteZeile | null): string {
  if (!k) return 'unbekannte Akte'
  const f = String(k.firma ?? '').trim()
  const p = String(k.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

async function meldeVerantwortlichem(helfer: Helfer, akte: AkteZeile | null, a: Anfrage, text: string) {
  if (!helfer.melde) return
  const an = akte?.verantwortlich_email || akte?.verantwortlich ? { name: akte?.verantwortlich, email: akte?.verantwortlich_email } : { name: a.erstellt_von }
  await helfer.melde(an, text).catch((e) => console.warn('Unterschrift: Telegram nicht gesendet', e instanceof Error ? e.message : e))
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Unterschreiben oder ablehnen. */
export async function unterschriftAbsenden(admin: Admin, token: unknown, e: AbsendenEingabe, meta: Meta, helfer: Helfer = {}): Promise<Antwort> {
  const jetzt = helfer.jetzt ?? new Date()
  const r = await ladeAnfrage(admin, token, jetzt)
  if ('grund' in r) return { status: 200, body: { stufe: 'ungueltig', grund: r.grund } }
  const { a } = r
  if (a.status !== 'offen') return { status: 200, body: await unterschriftLaden(admin, token, jetzt) }
  const heute = heuteBerlin(jetzt)
  const ip = String(meta.ip ?? '').slice(0, 64)
  const geraet = String(meta.geraet ?? '').slice(0, 300)
  const { data: akteDaten } = await admin
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, email, verantwortlich, verantwortlich_email')
    .eq('id', a.kunde_id)
    .maybeSingle()
  const akte = (akteDaten ?? null) as AkteZeile | null

  // ---------- Ablehnen ----------
  if (e.ablehnen === true) {
    const grund = wertSauber(e.grund)
    const { data: geschrieben } = await admin
      .from('unterschrift_anfragen')
      .update({ status: 'abgelehnt', abgelehnt_am: jetzt.toISOString(), ablehnung_grund: grund || null, ip, geraet })
      .eq('id', a.id)
      .eq('status', 'offen')
      .select('id')
    if (!geschrieben || geschrieben.length === 0) return { status: 200, body: await unterschriftLaden(admin, token, jetzt) }
    const text = `Online-Unterschrift abgelehnt: „${a.titel}“${grund ? ` — Grund: ${grund}` : ' (ohne Grund)'}.`
    await ergaenzeAkte(admin, a.kunde_id, { aktivitaet: { id: crypto.randomUUID(), date: heute, text, user: 'Kunde (Online-Unterschrift)' } }, heute)
    await meldeVerantwortlichem(helfer, akte, a, `✋ ${akteName(akte)} möchte „${a.titel}“ nicht unterschreiben.${grund ? ` Grund: ${grund}` : ''} Bitte Kontakt aufnehmen.`)
    return { status: 200, body: { stufe: 'abgelehnt', titel: a.titel } }
  }

  // ---------- Unterschreiben: prüfen ----------
  if (e.gelesen !== true) return { status: 400, body: { error: 'Bitte bestätigen Sie, dass Sie das Dokument gelesen haben.' } }
  const name = pruefeName(e.name)
  if (!name) return { status: 400, body: { error: 'Bitte geben Sie Ihren vollständigen Vor- und Nachnamen ein.' } }
  const bild = pruefeUnterschrift(e.unterschrift)
  if ('fehler' in bild) return { status: 400, body: { error: bild.fehler } }
  const felder = kundenFelderAus(a.felder_kunde)
  const geprueft = pruefeKundenwerte(felder, e.werte)
  if ('fehler' in geprueft) return { status: 400, body: { error: geprueft.fehler } }
  const endText = setzeKundenwerte(a.ausgefuellter_text, geprueft.werte)
  const summe = await pruefsumme(endText)

  // Erst das PDF (scheitert es, bleibt die Anfrage offen und der Kunde kann es erneut versuchen) …
  let pdf: Uint8Array
  try {
    pdf = (await erzeugeUnterschriftPdf({
      titel: a.titel, text: endText, kopfstil: a.kopfstil, unterschriftPng: bild.bytes, name, am: jetzt, ip, geraet, vorgang: a.id, pruefsumme: summe,
      linkAn: a.email, linkVom: a.erstellt_am,
    })).bytes
  } catch (err) {
    console.error('Unterschrift: PDF nicht erzeugt', err)
    return { status: 500, body: { error: FEHLER } }
  }

  // … dann den Nachweis festhalten — nur wenn die Anfrage noch offen ist.
  const dataUrl = e.unterschrift as string
  const { data: geschrieben, error: claimFehler } = await admin
    .from('unterschrift_anfragen')
    .update({
      status: 'unterschrieben', unterschrieben_am: jetzt.toISOString(), unterschrift: dataUrl, name_getippt: name,
      kunden_werte: geprueft.werte, endgueltiger_text: endText, pruefsumme: summe, ip, geraet,
    })
    .eq('id', a.id)
    .eq('status', 'offen')
    .select('id')
  if (claimFehler) {
    console.error('Unterschrift: Nachweis nicht gespeichert', claimFehler.message)
    return { status: 500, body: { error: FEHLER } }
  }
  if (!geschrieben || geschrieben.length === 0) return { status: 200, body: await unterschriftLaden(admin, token, jetzt) }

  // PDF in die Akte.
  const dokumentId = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const pfad = `${a.kunde_id}/${dokumentId}_${pfadName(a.titel)}`
  const anzeige = `${a.titel} – unterschrieben ${datumDe(jetzt)}.pdf`
  let abgelegt = false
  const { error: hochFehler } = await admin.storage.from(UNTERSCHRIFT_BUCKET).upload(pfad, pdf, { contentType: 'application/pdf', upsert: false })
  if (hochFehler) console.error('Unterschrift: PDF nicht hochgeladen', hochFehler.message)
  else {
    abgelegt = await ergaenzeAkte(admin, a.kunde_id, {
      dokument: { id: dokumentId, name: anzeige, typ: 'application/pdf', datum: heute, groesse: groesseText(pdf.length), url: pfad, quelle: 'unterschrift' },
      aktivitaet: { id: crypto.randomUUID(), date: heute, text: `Online unterschrieben: „${a.titel}“ von ${name} am ${zeitDe(jetzt)}. Das PDF liegt in den Dokumenten.`, user: `${name} (Online-Unterschrift)` },
      signatur: { id: `sig_${a.id}`, name, dataUrl, datum: heute, kontext: a.titel },
    }, heute)
    if (abgelegt) await admin.from('unterschrift_anfragen').update({ dokument: pfad, dokument_id: dokumentId }).eq('id', a.id)
    else console.error('Unterschrift: Akte nicht ergänzt', a.kunde_id)
  }

  await meldeVerantwortlichem(
    helfer, akte, a,
    abgelegt
      ? `✍️ ${name} hat „${a.titel}“ online unterschrieben (Akte ${akteName(akte)}). Das PDF liegt in den Dokumenten der Akte.`
      : `✍️ ${name} hat „${a.titel}“ online unterschrieben (Akte ${akteName(akte)}). Achtung: Das PDF ließ sich nicht in der Akte ablegen — die Unterschrift selbst ist gespeichert (im CRM unter „Zum Unterschreiben verschickt“).`,
  )

  // Kopie an den Kunden — nur mit eingeschaltetem Schalter.
  if (abgelegt && helfer.sendeKopie) {
    const { data: schalter } = await admin.from('unterschrift_einstellung').select('kopie_an_kunde').eq('id', 1).maybeSingle()
    const an = String(a.email || akte?.email || '').trim()
    if (schalter?.kopie_an_kunde === true && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(an)) {
      const anName = String(a.an_name ?? '').trim() || name
      const mail = kopieMail(anName, a.titel, await ladeMailVorlage(admin, VORLAGE.unterschriftKopie))
      const eintrag = { art: 'unterschrift_kopie', kanal: 'mail' as const, an_email: an, an_name: anName, betreff: mail.betreff, text: mail.text, bezug: { kunde_id: a.kunde_id, anfrage_id: a.id } }
      let kopieRaus = false
      try {
        await helfer.sendeKopie(
          an,
          mail.betreff,
          mail.text,
          { filename: pfadName(a.titel), contentBase64: base64(pdf), contentType: 'application/pdf' },
          { kundeId: a.kunde_id, bereich: a.bereich, kundeName: akte?.firma ?? '', anName },
        )
        kopieRaus = true
        await protokolliereNachricht(eintrag)
        await ergaenzeAkte(admin, a.kunde_id, { aktivitaet: { id: crypto.randomUUID(), date: heute, text: `Kopie von „${a.titel}“ (unterschrieben) automatisch an ${an} gesendet.`, user: 'System (automatisiert)' } }, heute)
      } catch (err) {
        console.error('Unterschrift: Kopie nicht gesendet', err instanceof Error ? err.message : err)
        if (!kopieRaus) await protokolliereNachricht({ ...eintrag, status: 'fehler' })
      }
    }
  }

  const fertig = { ...a, status: 'unterschrieben', unterschrieben_am: jetzt.toISOString(), dokument: abgelegt ? pfad : null }
  return { status: 200, body: { stufe: 'unterschrieben', titel: a.titel, am: jetzt.toISOString(), name, kopieUrl: await kopieUrl(admin, fertig, jetzt) } }
}

/** Ein Einstieg für index.ts: beantwortet die beiden öffentlichen Aktionen. */
export async function beantworteUnterschrift(admin: Admin, action: string, body: Record<string, unknown>, meta: Meta, helfer: Helfer = {}): Promise<Antwort> {
  try {
    if (action === 'public_unterschrift_laden') return { status: 200, body: await unterschriftLaden(admin, body.token, helfer.jetzt) }
    if (action === 'public_unterschrift_absenden') return await unterschriftAbsenden(admin, body.token, body as AbsendenEingabe, meta, helfer)
    return { status: 400, body: { error: 'Unbekannte Aktion.' } }
  } catch (err) {
    console.error('Online-Unterschrift:', err)
    return { status: 500, body: { error: FEHLER } }
  }
}
