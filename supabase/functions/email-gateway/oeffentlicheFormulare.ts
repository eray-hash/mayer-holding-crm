// Öffentliche Formulare ohne Login (Nachtschicht 23.11.2026): Mengengrenzen und Eingabeprüfung für die
// älteren `public_*`-Aktionen in index.ts, die bisher ohne beides liefen.
//
// Hintergrund: public_get_kunde / public_submit_formular (Vollmacht, Selbstauskunft, NDA, Mandantenfragebogen)
// haben als einzigen Schlüssel die Kunden-Kennung aus dem Link. Ein Teil davon ist erratbar (k_ql_vorname_nachname,
// k_intern_holding …), der Rest stammt aus Math.random. Ohne Mengengrenze ließ sich beliebig oft raten und
// schreiben; ohne Prüfung ließen sich beliebig große Unterschrift-Bilder und Texte in die Akte schreiben (die
// Akte lädt jedes CRM-Fenster vollständig) und Verlaufseinträge unter fremdem Namen („Andreas Mayer“) anlegen.
// Die neueren Module (objektPortal.ts, kundenPortal.ts, unterschrift.ts, seminarAnmeldung.ts) prüfen selbst
// und haben ihre Grenzen bereits in index.ts — die fasst diese Datei nicht an.
//
// Reine Funktionen ohne Datenbank; die Zählung macht grenzeErreicht in index.ts.

export type Grenze = { schluessel: string; hoechstens: number }

/** Netzadresse des Aufrufers für die Mengengrenzen. Bevorzugt die Kopfzeilen, die der vorgelagerte Dienst
 *  selbst setzt (cf-connecting-ip, x-real-ip); x-forwarded-for kann der Aufrufer am Anfang selbst befüllen. */
export function netzadresse(kopf: { get(name: string): string | null }): string {
  const sauber = (v: string | null) => String(v ?? '').split(',')[0].trim().slice(0, 64)
  return sauber(kopf.get('cf-connecting-ip')) || sauber(kopf.get('x-real-ip')) || sauber(kopf.get('x-forwarded-for')) || 'unbekannt'
}

const kurz = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

/**
 * Mengengrenzen je Stunde für die öffentlichen Aktionen, die bisher keine hatten. null = diese Aktion hat
 * keine Grenze von hier (entweder gar nicht öffentlich oder mit eigener Grenze an anderer Stelle).
 * Großzügig genug für echte Kunden (mehrere Dateien, mehrere Geräte im selben WLAN), eng genug gegen Raten.
 */
export function oeffentlicheGrenzen(aktion: string, ip: string, body: Record<string, unknown>): Grenze[] | null {
  switch (aktion) {
    case 'public_get_kunde':
      return [{ schluessel: `formular:lesen:${ip}`, hoechstens: 120 }]
    case 'public_submit_formular':
      return [
        { schluessel: `formular:senden:${ip}`, hoechstens: 20 },
        { schluessel: `formular:senden:kunde:${kurz(body.kundeId, 80)}`, hoechstens: 10 },
      ]
    case 'public_get_vorschlag':
      return [{ schluessel: `expose:lesen:${ip}`, hoechstens: 120 }]
    case 'public_entscheide_vorschlag':
      return [{ schluessel: `expose:entscheiden:${ip}`, hoechstens: 20 }]
    case 'public_get_objekt':
      return [{ schluessel: `eigentuemer:lesen:${ip}`, hoechstens: 120 }]
    case 'public_objekt_upload_url':
    case 'public_submit_objekt_formular':
      return [{ schluessel: `eigentuemer:schreiben:${ip}`, hoechstens: 300 }]
    case 'public_get_unterlagen':
      return [{ schluessel: `unterlagen:lesen:${ip}`, hoechstens: 300 }]
    case 'public_unterlagen_upload_url':
    case 'public_unterlagen_eingang':
      return [{ schluessel: `unterlagen:schreiben:${ip}`, hoechstens: 300 }]
    case 'public_buchung_info':
      return [{ schluessel: `buchung:lesen:${ip}`, hoechstens: 300 }]
    case 'public_portal_link':
      // Verschickt eine Mail — je Adresse und je Gerät begrenzen (sonst Mail-Flut an einen Investor).
      return [
        { schluessel: `portallink:${ip}`, hoechstens: 20 },
        { schluessel: `portallink:mail:${kurz(body.email, 200).toLowerCase()}`, hoechstens: 5 },
      ]
    default:
      return null
  }
}

/** Interne Sammel-Akten, für die es nie einen Formular-Link gibt. */
export function istInterneAkte(kundeId: unknown): boolean {
  const id = String(kundeId ?? '')
  return id === 'k_intern_holding' || id === 'k_eingang_ungeklaert'
}

// ---------- Eingabe von public_submit_formular ----------

/** Größtes Unterschrift-Bild (Zeichen der data-URL). Ein Bild vom Unterschriftenfeld hat meist 5–40 KB. */
export const MAX_UNTERSCHRIFT_ZEICHEN = 600_000
/** Größtes mitgeschicktes Behörden-PDF (Zeichen base64, rund 7,5 MB). */
export const MAX_PDF_ZEICHEN = 10_000_000
export const MAX_TEXT_ZEICHEN = 20_000

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
// deno-lint-ignore no-control-regex
const STEUERZEICHEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(STEUERZEICHEN, '').trim().slice(0, max) : ''
}

function pngOk(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 100 && v.length <= MAX_UNTERSCHRIFT_ZEICHEN && PNG_DATA_URL.test(v)
}

export type FormularAbgabe = {
  aktivitaetText: string
  aktivitaetUser: string
  signatur?: { name: string; dataUrl: string; kontext: string }
  selbstauskunft?: { antworten: { frageId: string; frageText: string; antwort: string }[]; signaturDataUrl: string; eingereichtAm: string }
  unterlagenCheckliste?: Record<string, boolean>
  behoerde?: { email: string; name?: string; sig?: string; pdfBase64?: string; pdfFilename?: string }
}

const UNLESBAR = 'Die Unterschrift ließ sich nicht lesen. Bitte noch einmal unterschreiben.'

/**
 * Prüft und bereinigt, was ein öffentliches Formular schickt. Nur bekannte Felder, begrenzte Längen,
 * Unterschriften nur als PNG. Der Name im Verlauf muss wie bei allen Formularen auf „(Formular)“ enden —
 * sonst steht „Kunde (Formular)“ da (niemand kann Einträge unter einem Mitarbeiternamen anlegen).
 */
export function pruefeFormularAbgabe(body: Record<string, unknown>): { werte: FormularAbgabe } | { fehler: string } {
  const aktivitaetText = text(body.aktivitaetText, MAX_TEXT_ZEICHEN)
  if (!aktivitaetText) return { fehler: 'Das Formular ist unvollständig. Bitte laden Sie die Seite neu.' }
  const user = text(body.aktivitaetUser, 160).replace(/\s+/g, ' ')
  const aktivitaetUser = /\(Formular\)$/.test(user) && user.length > '(Formular)'.length ? user : 'Kunde (Formular)'
  const werte: FormularAbgabe = { aktivitaetText, aktivitaetUser }

  if (body.signatur !== undefined && body.signatur !== null) {
    const s = body.signatur as Record<string, unknown>
    if (typeof s !== 'object' || !pngOk(s.dataUrl)) return { fehler: UNLESBAR }
    werte.signatur = { name: text(s.name, 200), dataUrl: s.dataUrl, kontext: text(s.kontext, 200) }
  }

  if (body.selbstauskunft !== undefined && body.selbstauskunft !== null) {
    const sa = body.selbstauskunft as Record<string, unknown>
    if (typeof sa !== 'object' || !Array.isArray(sa.antworten) || sa.antworten.length > 300) return { fehler: 'Die Selbstauskunft ist unvollständig. Bitte laden Sie die Seite neu.' }
    if (!pngOk(sa.signaturDataUrl)) return { fehler: UNLESBAR }
    const antworten = (sa.antworten as unknown[])
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => ({ frageId: text(a.frageId, 100), frageText: text(a.frageText, 1000), antwort: text(a.antwort, 5000) }))
      .filter((a) => a.frageId)
    const eingereichtAm = typeof sa.eingereichtAm === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sa.eingereichtAm) ? sa.eingereichtAm : ''
    werte.selbstauskunft = { antworten, signaturDataUrl: sa.signaturDataUrl, eingereichtAm }
  }

  if (body.unterlagenCheckliste !== undefined && body.unterlagenCheckliste !== null) {
    const c = body.unterlagenCheckliste
    if (typeof c !== 'object' || Array.isArray(c)) return { fehler: 'Das Formular ist unvollständig. Bitte laden Sie die Seite neu.' }
    const liste: Record<string, boolean> = {}
    for (const [schluessel, wert] of Object.entries(c as Record<string, unknown>).slice(0, 300)) {
      const k = text(schluessel, 300)
      if (k) liste[k] = wert === true
    }
    werte.unterlagenCheckliste = liste
  }

  if (body.behoerde && typeof body.behoerde === 'object') {
    const b = body.behoerde as Record<string, unknown>
    const pdf = typeof b.pdfBase64 === 'string' && b.pdfBase64.length <= MAX_PDF_ZEICHEN && /^[A-Za-z0-9+/]+={0,2}$/.test(b.pdfBase64) ? b.pdfBase64 : undefined
    const datei = text(b.pdfFilename, 120).replace(/[\\/:*?"<>|]/g, '_')
    werte.behoerde = {
      email: text(b.email, 200),
      ...(text(b.name, 120) ? { name: text(b.name, 120) } : {}),
      ...(typeof b.sig === 'string' ? { sig: b.sig.slice(0, 64) } : {}),
      ...(pdf ? { pdfBase64: pdf, pdfFilename: datei || 'dokument.pdf' } : {}),
    }
  }
  return { werte }
}

/** Was public_get_kunde von einer gespeicherten Selbstauskunft herausgibt: nur, DASS sie vorliegt
 *  (die Seite zeigt dann „Vielen Dank“) — nie die Antworten (Einkommen, Vermögen …) oder die Unterschrift. */
export function selbstauskunftFuerFormular(gespeichert: unknown): { eingereicht: true; eingereichtAm?: string } | undefined {
  if (!gespeichert || typeof gespeichert !== 'object') return undefined
  const am = (gespeichert as { eingereichtAm?: unknown }).eingereichtAm
  return { eingereicht: true, ...(typeof am === 'string' && am ? { eingereichtAm: am.slice(0, 10) } : {}) }
}
