// Scan-Eingang (23.11.2026): Ein Kollege scannt Papier-Kundenakten am Bürokopierer und schickt sie an info@ — der Betreff
// ist der Name der Akte („Max Muster“). Der Kopierer schickt meist mehrere Mails je Ordner, jede mit einer PDF, oft mit
// vielen verschiedenen Schriftstücken darin. Hier, ohne Zutun eines Mitarbeiters:
//  1. Nur Mails von den Scanner-Adressen in scan_eingang.absender (Einstellung in der Datenbank).
//  2. Jede PDF wird gelesen und in ihre einzelnen Schriftstücke aufgeteilt (splitScanDokument, wie bei Telegram) —
//     mit kurzem Inhalt je Teil.
//  3. Welche Akte? Kandidaten sind die Akten, deren Name zum Betreff passt (betreffIstAktenName). Genau eine → alles dorthin.
//     Mehrere (dieselbe Person in mehreren Bereichen) → die KI wählt je Teil nach dem Inhalt. Keine → die KI wählt den
//     Bereich, und eine neue Akte mit dem Namen aus dem Betreff wird angelegt.
//  4. Die Teile kommen als eigene PDFs in die Dokumente der Akte(n), mit Verlaufseintrag; die Mail selbst gilt als der Akte
//     mit den meisten Teilen zugeordnet.
// Jede Mail wird einmal bearbeitet (scan_status, beansprucht wie bei der Post-Zuordnung). Geht etwas schief, bleibt die Mail
// mit scan_status 'fehler' liegen und die gewöhnliche Post-Zuordnung (mailZuordnung.ts) kümmert sich um sie.
import { degrees, PDFDocument } from 'npm:pdf-lib@1.17.1'
import { entschlackeSeiten } from './pdfSeiten.ts'
import { akteName, betreffIstAktenName, betreffNenntTeilDesNamens, normBetreff, type AkteZeile } from './mailZuordnung.ts'
import { heuteBerlin } from '../_shared/heuteBerlin.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Admin = any

export const WER = 'System (Scan-Eingang)'
const ABLAGE = 'email-anhaenge'
const HOECHSTENS_BYTES = 30 * 1024 * 1024
const HOECHSTENS_SEITEN = 100
const HOECHSTENS_VERSUCHE = 2
const NEU_VERSUCHEN_NACH_MS = 10 * 60_000

export const BEREICHE: Record<string, string> = {
  beratung: 'Unternehmensberatung (Mayer Consulting: Beratung, Gesprächsprotokolle, Konzepte, Steuer- und Nachfolgeberatung von Firmen)',
  erben: 'Erben (Erbschaft, Nachlass, Testament, Schenkung, Vermögensübertragung in der Familie, Erbschaftsteuer)',
  immobilienkunden: 'Immobilien (Objekte, Kauf/Verkauf, Exposé, Grundbuch, Lagepläne, Bewertung eines Gebäudes)',
  finanzierungen: 'Finanzierungen (Kredite, Darlehen bei Banken, Selbstauskunft, Gehaltsnachweise für die Bank)',
  betriebsuebergabe: 'Betriebsübergabe (Übergabe/Verkauf eines Betriebs an Nachfolger)',
  betriebsformen: 'Betriebsformen (Gründung, Rechtsform, Gesellschaftsvertrag, Umwandlung)',
  akademie: 'Akademie (Seminare, Schulungen, Teilnehmer)',
}

export type ScanTeil = {
  start_seite: number
  end_seite: number
  kategorie: string
  kurzinhalt?: string
  erkanntes_datum?: string
  vorgeschlagener_dateiname: string
}
export type ScanAufteilung = { erkannter_name?: string; erkannte_firma?: string; dokumente: ScanTeil[]; seiten_drehung?: { seite: number; grad: number }[] }
export type Wahl = { neue_akte_bereich?: string; zuordnung: { teil: number; akte: number }[]; begruendung?: string }

export type ScanDienste = {
  /** Erkennt die Schriftstücke in einer PDF (splitScanDokument in index.ts). */
  teile: (pdfBase64: string, dateiname: string, seiten: number) => Promise<ScanAufteilung>
  /** Wählt je Teil die Akte (Nummer aus der Liste, 0 = neue Akte) und ggf. den Bereich der neuen Akte. */
  waehle: (aufgabe: string) => Promise<Wahl>
}

type MailZeile = {
  id: string
  von: string | null
  betreff: string | null
  anhaenge: unknown
  zugewiesener_kunde_id: string | null
  scan_versuche: number | null
  scan_ergebnis?: { mappen?: unknown[]; verteilung?: { kundeId?: unknown }[] } | null
}
type Anhang = { filename?: string; size?: number; contentType?: string; url?: string }

// ---------------------------------------------------------------------------------------------------
// Reine Hilfen
// ---------------------------------------------------------------------------------------------------

/** Name für eine neue Akte aus dem Betreff: „bauer schebek“ → „Bauer Schebek“. */
export function nameAusBetreff(betreff: string | null | undefined): string {
  const b = normBetreff(betreff).replace(/\b(teil|scan|scans|akte|kundenakte|ordner)\b\s*\d*/gi, ' ').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return b.split(' ').filter(Boolean).map((w) => (/^(von|van|de|zu|und)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}

export function dateiSicher(name: string): string {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 90)
  return /\.pdf$/i.test(n) ? n : `${n || 'Dokument'}.pdf`
}

/** Sieht der Betreff nach dem Namen einer Akte aus? Nicht: leer, Standard-Betreff des Kopierers („Message from KM_C3350i“,
 *  „Scan“, „Dokument“), Nummern, Dateinamen. Ohne Namen weiß niemand, wohin der Scan gehört — dann bleibt er im Postfach. */
export function betreffIstName(betreff: string | null | undefined): boolean {
  const b = normBetreff(betreff)
  if (!b) return false
  if (/message from|km_|bizhub|konica|scan(ned)? (from|von)|^scan\b|^dokument\b|^document\b|^image\b|^img|\.pdf$|^test$/i.test(b)) return false
  const woerter = b.replace(/[^a-zäöüß .,-]/gi, ' ').split(/[\s.,]+/).filter((w) => w.length >= 2)
  return woerter.length >= 1 && woerter.length <= 8 && woerter.some((w) => w.length >= 3) && !/\d{3,}/.test(b)
}

/** Erst ab Einführung des Scan-Eingangs (ältere Kopierer-Mails wurden schon von Hand sortiert). */
export const SCAN_EINGANG_AB = '2026-11-23T13:00:00Z'

/** Pfad im Speicher aus der öffentlichen Adresse eines Mail-Anhangs. */
export function pfadAusUrl(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/email-anhaenge\/([^?]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Aufgabe für die Wahl der Akte (Text an die KI). */
export function wahlAufgabe(betreff: string, kandidaten: AkteZeile[], teile: { kategorie: string; kurzinhalt?: string; datei: string }[]): string {
  const akten = kandidaten.length > 0
    ? kandidaten.map((a, i) => `${i + 1}. Bereich ${a.bereich}: ${akteName(a)}`).join('\n')
    : '(keine — es gibt noch keine Akte mit diesem Namen)'
  const liste = teile.map((t, i) => `${i + 1}. ${t.kategorie}${t.kurzinhalt ? ` — ${t.kurzinhalt}` : ''} (Datei ${t.datei})`).join('\n')
  const bereiche = Object.entries(BEREICHE).map(([id, text]) => `- ${id}: ${text}`).join('\n')
  return `Ein Mitarbeiter hat eine Papier-Kundenakte eingescannt und mit dem Betreff „${betreff}“ (= Name des Kunden) geschickt. Die Mayer Holding hat diese Bereiche:
${bereiche}

Vorhandene Akten mit diesem Namen:
${akten}

Erkannte Schriftstücke im Scan:
${liste}

Ordne JEDES Schriftstück der Akte zu, zu deren Bereich es inhaltlich am besten passt (Nummer aus der Aktenliste). Gibt es vorhandene Akten, wähle immer eine davon (auch wenn keine perfekt passt: die nächstliegende; allgemeine Unterlagen wie Gesprächsprotokolle, Anschreiben, Kontaktdaten, To-do-Listen der Beratung gehören in die Beratungs-Akte, falls es eine gibt). Gibt es KEINE vorhandene Akte, setze bei jedem Schriftstück akte = 0 und wähle unter neue_akte_bereich den EINEN Bereich, zu dem die Unterlagen insgesamt am besten passen. Begründe kurz auf Deutsch.`
}

// ---------------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------------

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function schneide(quelle: PDFDocument, von: number, bis: number, drehung: Map<number, number>): Promise<Uint8Array> {
  const ziel = await PDFDocument.create()
  const nummern: number[] = []
  for (let s = von; s <= bis; s++) nummern.push(s - 1)
  const seiten = await ziel.copyPages(quelle, nummern)
  seiten.forEach((seite, i) => {
    const grad = drehung.get(nummern[i] + 1)
    if (grad) seite.setRotation(degrees((seite.getRotation().angle + grad) % 360))
    ziel.addPage(seite)
  })
  return await ziel.save()
}

// ---------------------------------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------------------------------

export type ScanErgebnis = { bearbeitet: number; teile: number; neueAkten: number; fehler: string[] }

export async function scanAbsender(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('scan_eingang').select('aktiv, absender').eq('id', 'standard').maybeSingle()
  if (!data?.aktiv) return []
  return ((data.absender ?? []) as string[]).map((a) => String(a).trim().toLowerCase()).filter(Boolean)
}

/**
 * Bearbeitet höchstens `hoechstens` Scan-Mails (Standard 1 — ein großer Ordner braucht eine Minute KI-Zeit).
 * `mailIds` + `ersetzen`: bestimmte, schon von Hand zugeordnete Mails nachträglich aufteilen; die ganze PDF wird dann
 * aus den Akten genommen und durch die Teile ersetzt. Wirft nie.
 */
export async function verarbeiteScanEingang(
  admin: Admin,
  dienste: ScanDienste,
  opts: { hoechstens?: number; budgetMs?: number; mailIds?: string[]; ersetzen?: boolean } = {},
): Promise<ScanErgebnis> {
  const ergebnis: ScanErgebnis = { bearbeitet: 0, teile: 0, neueAkten: 0, fehler: [] }
  const beginn = Date.now()
  try {
    const absender = await scanAbsender(admin)
    if (absender.length === 0 && !opts.mailIds) return ergebnis
    let abfrage = admin.from('eingegangene_emails').select('id, von, betreff, anhaenge, zugewiesener_kunde_id, scan_versuche, scan_status, scan_beansprucht_am, scan_ergebnis').is('besitzer_email', null)
    if (opts.mailIds) {
      abfrage = abfrage.in('id', opts.mailIds)
    } else {
      abfrage = abfrage
        .in('von', absender)
        .is('zugewiesener_kunde_id', null)
        .gte('erstellt_am', new Date(Math.max(Date.parse(SCAN_EINGANG_AB), Date.now() - 14 * 86_400_000)).toISOString())
        .or(`scan_status.is.null,and(scan_status.eq.laeuft,scan_beansprucht_am.lt.${new Date(Date.now() - NEU_VERSUCHEN_NACH_MS).toISOString()})`)
        .lt('scan_versuche', HOECHSTENS_VERSUCHE)
    }
    const { data: offen, error } = await abfrage.order('erstellt_am', { ascending: true }).limit(opts.mailIds ? 50 : Math.max(1, opts.hoechstens ?? 1))
    if (error) throw new Error(`Postfach nicht lesbar: ${error.message}`)
    for (const m of (offen ?? []) as (MailZeile & { scan_status: string | null; scan_beansprucht_am: string | null })[]) {
      if (Date.now() - beginn > (opts.budgetMs ?? 200_000)) break
      // Beanspruchen: nur wer den Stand von „frei“ (oder „hängt seit 10 Minuten“) auf „läuft“ setzt, bearbeitet die Mail.
      const jetzt = new Date().toISOString()
      let anspruch = admin.from('eingegangene_emails').update({ scan_status: 'laeuft', scan_beansprucht_am: jetzt, scan_versuche: (m.scan_versuche ?? 0) + 1 }).eq('id', m.id)
      anspruch = m.scan_status ? anspruch.eq('scan_status', m.scan_status).eq('scan_beansprucht_am', m.scan_beansprucht_am) : anspruch.is('scan_status', null)
      const { data: geholt } = await anspruch.select('id')
      if (!geholt || geholt.length === 0) continue
      try {
        const r = await bearbeiteMail(admin, dienste, m, !!opts.ersetzen)
        ergebnis.bearbeitet++
        ergebnis.teile += r.teile
        ergebnis.neueAkten += r.neueAkte ? 1 : 0
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        console.error('Scan-Eingang: Mail nicht bearbeitet', m.id, text)
        ergebnis.fehler.push(`${m.id}: ${text}`)
        // Liegen lassen für die gewöhnliche Post-Zuordnung (zuordnung_geprueft_am frei → wird dort geprüft).
        await admin.from('eingegangene_emails').update({ scan_status: 'fehler', scan_ergebnis: { fehler: text }, zuordnung_geprueft_am: null }).eq('id', m.id)
      }
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err)
    console.error('Scan-Eingang fehlgeschlagen:', text)
    ergebnis.fehler.push(text)
  }
  return ergebnis
}

type FertigerTeil = { name: string; bytes: Uint8Array; kategorie: string; kurzinhalt?: string; seiten: string; quelleUrl: string }

async function bearbeiteMail(admin: Admin, dienste: ScanDienste, m: MailZeile, ersetzen: boolean): Promise<{ teile: number; neueAkte: boolean }> {
  const betreff = String(m.betreff ?? '').trim()
  if (!betreffIstName(betreff)) throw new Error('Kein Name im Betreff — der Scan bleibt im Postfach zum Zuordnen von Hand.')
  const anhaenge = ((m.anhaenge ?? []) as Anhang[]).filter((a) => typeof a.url === 'string' && (/pdf/i.test(String(a.contentType ?? '')) || /\.pdf$/i.test(String(a.filename ?? ''))))
  if (anhaenge.length === 0) throw new Error('Keine PDF im Anhang.')

  // 1. Aufteilen und lesen.
  const teile: FertigerTeil[] = []
  for (const a of anhaenge) {
    const pfad = pfadAusUrl(String(a.url))
    if (!pfad) throw new Error(`Anhang nicht im Speicher: ${a.filename}`)
    const { data: blob, error } = await admin.storage.from(ABLAGE).download(pfad)
    if (error || !blob) throw new Error(`Anhang nicht ladbar: ${error?.message ?? a.filename}`)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const seiten = doc.getPageCount()
    const name = String(a.filename ?? 'Scan.pdf')
    if (bytes.length > HOECHSTENS_BYTES || seiten > HOECHSTENS_SEITEN) {
      // Zu groß für das Lesen in einem Stück: als Ganzes ablegen, Akte nur nach dem Namen.
      teile.push({ name, bytes, kategorie: 'Scan (nicht aufgeteilt, zu groß)', seiten: `1–${seiten}`, quelleUrl: String(a.url) })
      continue
    }
    const aufteilung = await dienste.teile(base64(bytes), name, seiten)
    const drehung = new Map<number, number>()
    for (const d of aufteilung.seiten_drehung ?? []) if ([90, 180, 270].includes(d?.grad)) drehung.set(d.seite, d.grad)
    const bereiche = (aufteilung.dokumente ?? []).filter((t) => t.start_seite >= 1 && t.end_seite <= seiten && t.start_seite <= t.end_seite)
    if (bereiche.length === 0) bereiche.push({ start_seite: 1, end_seite: seiten, kategorie: 'Scan', vorgeschlagener_dateiname: name })
    // Nur EIN Teil über alle Seiten und nichts zu drehen: die Datei unverändert übernehmen.
    const ganz = bereiche.length === 1 && bereiche[0].start_seite === 1 && bereiche[0].end_seite === seiten && drehung.size === 0
    if (!ganz) entschlackeSeiten(doc)
    for (const t of bereiche) {
      const teilBytes = ganz ? bytes : await schneide(doc, t.start_seite, t.end_seite, drehung)
      teile.push({
        name: dateiSicher(t.vorgeschlagener_dateiname || `${t.kategorie}_${t.start_seite}-${t.end_seite}`),
        bytes: teilBytes,
        kategorie: t.kategorie,
        kurzinhalt: t.kurzinhalt,
        seiten: t.start_seite === t.end_seite ? `${t.start_seite}` : `${t.start_seite}–${t.end_seite}`,
        quelleUrl: String(a.url),
      })
    }
  }

  // 2. Welche Akte?
  const akten = (await alleZeilen<AkteZeile>(() => admin.from('kunden').select('id, bereich, firma, ansprechpartner, email').neq('bereich', 'privat'))).data ?? []
  // Erst die Akten, deren Name zum Betreff passt; dazu Akten, die nur einen der Namen tragen (gemeinsame Kunden wie
  // „Bauer Schebek“ haben oft auch Einzel-Akten). Bei zu vielen Teiltreffern (häufiger Nachname) zählen nur die ganzen.
  const ganz = (akten as AkteZeile[]).filter((a) => betreffIstAktenName(betreff, a))
  const teilweise = (akten as AkteZeile[]).filter((a) => !ganz.includes(a) && betreffNenntTeilDesNamens(betreff, a))
  const kandidaten = (ganz.length + teilweise.length <= 6 ? [...ganz, ...teilweise] : ganz).slice(0, 6)
  let ziel: (AkteZeile | null)[] = teile.map(() => kandidaten.length === 1 ? kandidaten[0] : null)
  let neuerBereich = ''
  let begruendung = kandidaten.length === 1 ? 'Betreff ist der Name genau einer Akte' : ''
  if (kandidaten.length !== 1) {
    const wahl = await dienste.waehle(wahlAufgabe(betreff, kandidaten, teile.map((t) => ({ kategorie: t.kategorie, kurzinhalt: t.kurzinhalt, datei: t.name }))))
    begruendung = String(wahl.begruendung ?? '')
    const nachTeil = new Map((wahl.zuordnung ?? []).map((z) => [Number(z.teil), Number(z.akte)]))
    ziel = teile.map((_, i) => {
      const nr = nachTeil.get(i + 1) ?? 0
      if (kandidaten.length > 0) return kandidaten[nr - 1] ?? kandidaten[0]
      return null
    })
    if (kandidaten.length === 0) neuerBereich = BEREICHE[String(wahl.neue_akte_bereich)] ? String(wahl.neue_akte_bereich) : 'beratung'
  }

  // 3. Neue Akte, falls keine passt.
  const heute = heuteBerlin()
  let neueAkte: AkteZeile | null = null
  if (kandidaten.length === 0) {
    const name = nameAusBetreff(betreff) || 'Unbekannt (Scan)'
    const id = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const { error } = await admin.from('kunden').insert({
      id,
      bereich: neuerBereich,
      firma: name,
      ansprechpartner: name,
      email: '',
      telefon: '',
      prioritaet: 'Mittel',
      status: 'lead',
      follow_up: { date: heute, note: 'Akte aus eingescannter Papierakte angelegt – Daten ergänzen', done: false },
      verantwortlich: '',
      letzte_aktivitaet: heute,
      activities: [{ id: crypto.randomUUID(), date: heute, text: `Automatisch angelegt aus eingescannter Papierakte (Betreff „${betreff}“). Bereich nach Inhalt gewählt${begruendung ? `: ${begruendung}` : ''}.`, user: WER }],
    })
    if (error) throw new Error(`Akte nicht anlegbar: ${error.message}`)
    neueAkte = { id, bereich: neuerBereich, firma: name, ansprechpartner: name, email: '' }
    ziel = teile.map(() => neueAkte)
  }

  // 4. Teile ablegen, je Akte gesammelt.
  const jeAkte = new Map<string, { akte: AkteZeile; dokumente: Record<string, unknown>[]; zeilen: string[] }>()
  const mappe = crypto.randomUUID()
  for (const [i, t] of teile.entries()) {
    const akte = ziel[i]!
    const pfad = `scan/${mappe}/${i + 1}_${t.name}`
    const { error } = await admin.storage.from(ABLAGE).upload(pfad, t.bytes, { contentType: 'application/pdf', upsert: true })
    if (error) throw new Error(`Teil nicht speicherbar: ${error.message}`)
    const url = admin.storage.from(ABLAGE).getPublicUrl(pfad).data.publicUrl
    const groesse = t.bytes.length < 1024 * 1024 ? `${Math.round(t.bytes.length / 1024)} KB` : `${(t.bytes.length / (1024 * 1024)).toFixed(1)} MB`
    if (!jeAkte.has(akte.id)) jeAkte.set(akte.id, { akte, dokumente: [], zeilen: [] })
    const eintrag = jeAkte.get(akte.id)!
    eintrag.dokumente.push({ id: crypto.randomUUID(), name: t.name, typ: 'application/pdf', datum: heute, groesse, url })
    eintrag.zeilen.push(`${t.name} (${t.kategorie}, Seite ${t.seiten})`)
  }
  const quellen = new Set(teile.map((t) => t.quelleUrl))
  // Beim erneuten Aufteilen: Teile aus früheren Läufen dieser Mail entfernen (überall, wo sie liegen).
  const frueher: string[] = ersetzen && Array.isArray(m.scan_ergebnis?.mappen) ? m.scan_ergebnis!.mappen!.map(String) : []
  if (frueher.length > 0) {
    const betroffen = new Set<string>((m.scan_ergebnis?.verteilung ?? []).map((v) => String(v.kundeId)))
    for (const kid of betroffen) {
      if (jeAkte.has(kid)) continue
      const { data: k } = await admin.from('kunden').select('dokumente').eq('id', kid).maybeSingle()
      if (k) await admin.from('kunden').update({ dokumente: ((k.dokumente ?? []) as { url?: string }[]).filter((d) => !(d.url && frueher.some((f) => d.url!.includes(`/scan/${f}/`)))) }).eq('id', kid)
    }
  }
  for (const { akte, dokumente, zeilen } of jeAkte.values()) {
    // Frisch lesen und nur ergänzen — Mitarbeiter können die Akte gleichzeitig bearbeiten.
    const { data: k, error } = await admin.from('kunden').select('dokumente, activities').eq('id', akte.id).maybeSingle()
    if (error || !k) throw new Error(`Akte nicht lesbar: ${error?.message ?? akte.id}`)
    const alt = ((k.dokumente ?? []) as { url?: string }[]).filter((d) => !(ersetzen && d.url && (quellen.has(d.url) || frueher.some((f) => d.url!.includes(`/scan/${f}/`)))))
    const text = `Eingescannte Unterlagen aus der Papierakte (Betreff „${betreff}“) aufgeteilt und abgelegt: ${zeilen.join('; ')}`
    const { error: e2 } = await admin.from('kunden').update({
      dokumente: [...dokumente, ...alt],
      activities: [{ id: crypto.randomUUID(), date: heute, text, user: WER }, ...((k.activities ?? []) as unknown[])],
      letzte_aktivitaet: heute,
    }).eq('id', akte.id)
    if (e2) throw new Error(`Akte nicht ergänzbar: ${e2.message}`)
  }
  // Beim nachträglichen Aufteilen: die ganze PDF auch aus Akten nehmen, die keine Teile bekommen haben.
  if (ersetzen && m.zugewiesener_kunde_id && !jeAkte.has(m.zugewiesener_kunde_id)) {
    const { data: k } = await admin.from('kunden').select('dokumente').eq('id', m.zugewiesener_kunde_id).maybeSingle()
    if (k) await admin.from('kunden').update({ dokumente: ((k.dokumente ?? []) as { url?: string }[]).filter((d) => !(d.url && quellen.has(d.url))) }).eq('id', m.zugewiesener_kunde_id)
  }

  // 5. Mail gilt als der Akte mit den meisten Teilen zugeordnet.
  const haupt = [...jeAkte.values()].sort((a, b) => b.dokumente.length - a.dokumente.length)[0].akte
  const verteilung = [...jeAkte.values()].map((x) => ({ kundeId: x.akte.id, name: akteName(x.akte), bereich: x.akte.bereich, teile: x.zeilen }))
  const { error: e3 } = await admin.from('eingegangene_emails').update({
    zugewiesener_kunde_id: haupt.id,
    zugewiesener_bereich: haupt.bereich,
    zugewiesener_kunde_name: akteName(haupt),
    relevanz: 'kunde',
    zuordnung_vorschlag: { status: 'automatisch', erstellt_am: new Date().toISOString(), kundeId: haupt.id, weg: 'scan', grund: begruendung || 'Scan-Eingang' },
    scan_status: 'fertig',
    scan_ergebnis: { verteilung, neueAkte: neueAkte?.id ?? null, begruendung, mappen: [mappe] },
  }).eq('id', m.id)
  if (e3) throw new Error(`Mail nicht aktualisierbar: ${e3.message}`)
  return { teile: teile.length, neueAkte: !!neueAkte }
}
