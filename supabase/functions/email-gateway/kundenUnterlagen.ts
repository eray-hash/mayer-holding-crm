// Unterlagen vom Kunden: die öffentliche Hochlade-Seite /formular/unterlagen/:token
// (src/pages/formulare/PublicKundenUnterlagen.tsx), ohne Login.
//
// Ablauf: Ein Mitarbeiter fordert in der Kundenakte Unterlagen an (KundeUnterlagenAnfordern.tsx). Die
// Anforderung steht in kunden.unterlagen_anforderungen (Liste, neueste zuerst) und trägt eine geheime
// Kennung `token`. Der Link in der Mail enthält nur diese Kennung, nie die Kunden-Kennung.
//
// Schutz:
// - Die Kennung hat mindestens 32 Zufallsbytes (base64url, 43 Zeichen). Sie ist der einzige Schlüssel.
// - Unbekannte, falsch geformte und abgelaufene Kennungen (älter als 60 Tage) bekommen alle dieselbe
//   neutrale Antwort — von außen ist nicht zu unterscheiden, ob es die Kennung je gab.
// - public_get_unterlagen gibt nur heraus: Vornamen für die Anrede, Firmennamen (nur wenn er nicht der
//   Personenname ist), die angeforderten Punkte mit erledigt/offen und den freien Text. Sonst nichts
//   aus der Akte — keine Dokumente, keine Notizen, keine Adressen, nicht die Kunden-Kennung.
// - Hochgeladen wird direkt in die private Ablage "kunden-dokumente" über eine einmalige
//   Hochlade-Adresse für genau einen Pfad unter <kundeId>/kundenupload_… . Den Pfad bildet der Server,
//   die Kunden-Kennung kommt aus der Datenbank, nie vom Aufrufer.
// - Beim Eintragen prüft der Server die Datei selbst: Pfad muss zu dieser Akte und zu einem eigenen
//   Hochlade-Vorgang passen, höchstens 20 MB, und der Dateianfang muss PDF, JPEG oder PNG sein.
//   Sonst wird die Datei wieder gelöscht.
// - Die Dokumentliste der Akte wird nur ergänzt (frisch gelesen, andere Einträge bleiben), danach
//   nachgelesen; ist der eigene Eintrag durch einen gleichzeitigen Schreibvorgang verloren gegangen,
//   wird er erneut eingetragen.
//
// Der Datenbank-Zugang wird übergeben (Dienst-Schlüssel); keine Abhängigkeit von index.ts.

// deno-lint-ignore no-explicit-any
type Db = any

export const UNTERLAGEN_BUCKET = 'kunden-dokumente'
export const GUELTIG_TAGE = 60
export const MAX_BYTES = 20 * 1024 * 1024
/** Obergrenze je Link, damit ein weitergereichter Link die Ablage nicht beliebig füllen kann. */
export const MAX_DATEIEN_JE_LINK = 100
/** Muss zu SONSTIGE_UNTERLAGE in src/data/kundenUnterlagen.ts passen. */
export const SONSTIGE_UNTERLAGE = 'Sonstige Unterlage'
/** Muss zu SELBSTAUSKUNFT in src/data/kundenUnterlagen.ts passen: gilt auch als da, wenn der Kunde das
 *  Online-Formular der Selbstauskunft seit der Anforderung ausgefüllt hat. */
export const SELBSTAUSKUNFT = 'Selbstauskunft (ausgefüllt und unterschrieben)'
export const NEUTRALE_MELDUNG = 'Dieser Link ist nicht mehr gültig. Bitte fragen Sie bei uns nach einem neuen Link.'

const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43,128}$/
const ENDUNGEN = /\.(pdf|jpe?g|png)$/i
const TAG_MS = 86400000

export type Antwort = { status: number; body: Record<string, unknown> }

type Eingang = { punkt: string; datum: string; dokumentId: string; name: string }
type Anforderung = {
  id: string
  datum: string
  punkte?: unknown
  weitere?: unknown
  token?: unknown
  eingang?: Eingang[]
  [feld: string]: unknown
}
type KundenZeile = {
  id: string
  /** Nur der Zeitpunkt aus kunden.selbstauskunft — die Antworten und die Unterschrift werden nie gelesen. */
  sa_eingereicht?: string | null
  firma?: string | null
  ansprechpartner?: string | null
  unterlagen_anforderungen?: Anforderung[] | null
}

function heuteIso(jetzt: Date): string {
  return jetzt.toISOString().slice(0, 10)
}

function nichtGefunden(): Antwort {
  return { status: 404, body: { error: NEUTRALE_MELDUNG } }
}

function fehler(status: number, text: string): Antwort {
  return { status, body: { error: text } }
}

/** Ist die Anforderung vom `datum` am Tag `jetzt` noch gültig (höchstens 60 Tage alt)? */
export function nochGueltig(datum: string, jetzt: Date): boolean {
  const start = Date.parse(`${String(datum).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(start)) return false
  const heute = Date.parse(`${heuteIso(jetzt)}T00:00:00Z`)
  return heute - start <= GUELTIG_TAGE * TAG_MS && heute >= start - TAG_MS
}

function punkteVon(a: Anforderung): string[] {
  return Array.isArray(a.punkte) ? a.punkte.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : []
}

/** Gilt ein Punkt seit dem Datum der Anforderung als eingegangen? Gezählt wird jeder Eingang über
 *  irgendeinen Link dieser Akte — eine Erinnerung hat einen neuen Link, der alte bleibt aber nutzbar. */
function eingegangenSeit(alle: Anforderung[], punkt: string, seit: string, saEingereicht?: string | null): boolean {
  if (punkt === SELBSTAUSKUNFT && saEingereicht && String(saEingereicht).slice(0, 10) >= String(seit).slice(0, 10)) return true
  return alle.some((a) => (Array.isArray(a.eingang) ? a.eingang : []).some((e) => e.punkt === punkt && String(e.datum) >= String(seit).slice(0, 10)))
}

/** Sucht die Akte zu einer Kennung. Gibt null zurück bei falscher Form, unbekannt, mehrdeutig oder abgelaufen. */
export async function findeAnforderung(
  admin: Db,
  token: unknown,
  jetzt: Date,
): Promise<{ kunde: KundenZeile; anforderung: Anforderung; alle: Anforderung[] } | null> {
  if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) return null
  const { data, error } = await admin
    .from('kunden')
    .select('id, firma, ansprechpartner, unterlagen_anforderungen, sa_eingereicht:selbstauskunft->>eingereichtAm')
    .contains('unterlagen_anforderungen', [{ token }])
    .limit(2)
  if (error) throw new Error(`Akte nicht lesbar: ${error.message}`)
  const zeilen = (Array.isArray(data) ? data : []) as KundenZeile[]
  // Doppelt vergeben kann eine 32-Byte-Kennung praktisch nicht sein — wenn doch, lieber gar nichts zeigen.
  const treffer = zeilen
    .map((kunde) => {
      const alle = Array.isArray(kunde.unterlagen_anforderungen) ? kunde.unterlagen_anforderungen : []
      return { kunde, alle, anforderung: alle.find((a) => a && a.token === token) }
    })
    .filter((t) => !!t.anforderung)
  if (treffer.length !== 1) return null
  const { kunde, alle, anforderung } = treffer[0]
  if (!anforderung || !nochGueltig(String(anforderung.datum ?? ''), jetzt)) return null
  return { kunde, anforderung, alle }
}

function vornameAus(ansprechpartner: string): string | null {
  const ohneAnrede = ansprechpartner.replace(/^(herr|frau|dr\.?|prof\.?)\s+/gi, '').trim()
  const erstes = ohneAnrede.split(/\s+/)[0] ?? ''
  return erstes && erstes.length <= 40 ? erstes : null
}

// ---------- public_get_unterlagen ----------

export async function holeUnterlagen(admin: Db, token: unknown, jetzt = new Date()): Promise<Antwort> {
  const fund = await findeAnforderung(admin, token, jetzt)
  // Wie public_get_objekt: unbekannt = 200 mit null, damit die Seite "Link ungültig" zeigt.
  if (!fund) return { status: 200, body: { unterlagen: null } }
  const { kunde, anforderung, alle } = fund
  const person = String(kunde.ansprechpartner ?? '').trim()
  const firma = String(kunde.firma ?? '').trim()
  const weitere = typeof anforderung.weitere === 'string' && anforderung.weitere.trim() ? anforderung.weitere.trim() : null
  return {
    status: 200,
    body: {
      unterlagen: {
        vorname: person ? vornameAus(person) : null,
        // Bei Privatpersonen steht oft der Name auch als "Firma" — dann keinen Firmennamen zeigen.
        firma: firma && firma.toLowerCase() !== person.toLowerCase() ? firma : null,
        punkte: punkteVon(anforderung).map((name) => ({ name, erledigt: eingegangenSeit(alle, name, anforderung.datum, kunde.sa_eingereicht) })),
        weitere,
      },
    },
  }
}

// ---------- public_unterlagen_upload_url ----------

function erlaubterPunkt(anforderung: Anforderung, punkt: unknown): punkt is string {
  return typeof punkt === 'string' && (punkt === SONSTIGE_UNTERLAGE || punkteVon(anforderung).includes(punkt))
}

function sichererDateiname(name: string): string {
  const endung = (name.match(ENDUNGEN)?.[0] ?? '').toLowerCase().replace('.jpeg', '.jpg')
  const stamm = name
    .slice(0, name.length - (name.match(ENDUNGEN)?.[0].length ?? 0))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 60)
  return `${stamm || 'datei'}${endung}`
}

export async function unterlagenUploadUrl(
  admin: Db,
  eingabe: { token?: unknown; punkt?: unknown; dateiname?: unknown; groesse?: unknown },
  jetzt = new Date(),
): Promise<Antwort> {
  const fund = await findeAnforderung(admin, eingabe.token, jetzt)
  if (!fund) return nichtGefunden()
  const { kunde, anforderung } = fund
  if (!erlaubterPunkt(anforderung, eingabe.punkt)) return fehler(400, 'Diese Unterlage gehört nicht zu dieser Anfrage.')
  const dateiname = typeof eingabe.dateiname === 'string' ? eingabe.dateiname.trim() : ''
  if (!dateiname || !ENDUNGEN.test(dateiname)) return fehler(400, 'Bitte nur PDF-Dateien oder Fotos (JPG oder PNG) hochladen.')
  const groesse = Number(eingabe.groesse)
  if (Number.isFinite(groesse) && groesse > MAX_BYTES) return fehler(400, 'Die Datei ist größer als 20 MB. Bitte verkleinern oder in mehreren Teilen schicken.')
  if ((Array.isArray(anforderung.eingang) ? anforderung.eingang : []).length >= MAX_DATEIEN_JE_LINK) return fehler(429, 'Über diesen Link können keine weiteren Dateien mehr hochgeladen werden. Bitte melden Sie sich bei uns.')

  const pfad = `${kunde.id}/kundenupload_${crypto.randomUUID()}_${sichererDateiname(dateiname)}`
  const { data, error } = await admin.storage.from(UNTERLAGEN_BUCKET).createSignedUploadUrl(pfad)
  if (error || !data?.token) return fehler(500, 'Das Hochladen konnte nicht vorbereitet werden. Bitte versuchen Sie es gleich noch einmal.')
  return { status: 200, body: { pfad: data.path ?? pfad, token: data.token } }
}

// ---------- public_unterlagen_eingang ----------

function regexSicher(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Erkennt die Dateiart am Dateianfang — der angegebene Typ oder die Endung zählen nicht. */
export function dateiArt(kopf: Uint8Array): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (kopf.length >= 5 && kopf[0] === 0x25 && kopf[1] === 0x50 && kopf[2] === 0x44 && kopf[3] === 0x46 && kopf[4] === 0x2d) return 'application/pdf'
  if (kopf.length >= 3 && kopf[0] === 0xff && kopf[1] === 0xd8 && kopf[2] === 0xff) return 'image/jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (kopf.length >= 8 && png.every((b, i) => kopf[i] === b)) return 'image/png'
  return null
}

function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function anzeigeName(name: unknown, pfad: string): string {
  // deno-lint-ignore no-control-regex
  const sauber = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 120) : ''
  return sauber || pfad.split('/').pop() || 'Datei'
}

/** Trägt den Eingang bei der Anforderung mit dieser Kennung ein — nur einmal je Dokument. */
function mitEingang(anforderungen: Anforderung[], token: string, eingang: Eingang): Anforderung[] {
  return anforderungen.map((a) => {
    if (!a || a.token !== token) return a
    const bisher = Array.isArray(a.eingang) ? a.eingang : []
    return bisher.some((e) => e?.dokumentId === eingang.dokumentId) ? a : { ...a, eingang: [...bisher, eingang] }
  })
}

export async function unterlagenEingang(
  admin: Db,
  eingabe: { token?: unknown; punkt?: unknown; dokument?: unknown },
  jetzt = new Date(),
): Promise<Antwort> {
  const fund = await findeAnforderung(admin, eingabe.token, jetzt)
  if (!fund) return nichtGefunden()
  const { kunde, anforderung } = fund
  const punkt = eingabe.punkt
  if (!erlaubterPunkt(anforderung, punkt)) return fehler(400, 'Diese Unterlage gehört nicht zu dieser Anfrage.')
  const dok = (eingabe.dokument && typeof eingabe.dokument === 'object' ? eingabe.dokument : {}) as Record<string, unknown>
  const pfad = typeof dok.pfad === 'string' ? dok.pfad : typeof dok.url === 'string' ? dok.url : ''
  // Nur Dateien, die über public_unterlagen_upload_url für genau diese Akte vorbereitet wurden.
  const muster = new RegExp(`^${regexSicher(kunde.id)}/kundenupload_[0-9a-f-]{36}_[A-Za-z0-9._-]{1,80}$`)
  if (!muster.test(pfad)) return fehler(400, 'Die Datei gehört nicht zu diesem Link.')

  const ablage = admin.storage.from(UNTERLAGEN_BUCKET)
  const { data: datei, error: ladeFehler } = await ablage.download(pfad)
  if (ladeFehler || !datei) return fehler(400, 'Die Datei ist bei uns nicht angekommen. Bitte laden Sie sie noch einmal hoch.')
  const bytes = Number(datei.size ?? 0)
  const kopf = new Uint8Array(await datei.slice(0, 8).arrayBuffer())
  const typ = dateiArt(kopf)
  if (bytes > MAX_BYTES || bytes === 0 || !typ) {
    await ablage.remove([pfad]).catch(() => undefined)
    return fehler(400, bytes > MAX_BYTES ? 'Die Datei ist größer als 20 MB.' : 'Bitte nur PDF-Dateien oder Fotos (JPG oder PNG) hochladen.')
  }

  const heute = heuteIso(jetzt)
  const name = anzeigeName(dok.name, pfad)
  const dokumentId = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
  const aktivitaetId = crypto.randomUUID()
  const dokument = { id: dokumentId, name, typ, datum: heute, groesse: groesseText(bytes), url: pfad }
  const aktivitaet = {
    id: aktivitaetId,
    date: heute,
    text: `Vom Kunden hochgeladen: „${name}“ (${punkt})`,
    user: 'Kunde (Hochlade-Link)',
  }
  const eingang: Eingang = { punkt, datum: heute, dokumentId, name }

  // Frisch lesen, ergänzen, schreiben, nachlesen. Geht der eigene Eintrag durch einen gleichzeitigen
  // Schreibvorgang verloren, beginnt es von vorn — höchstens dreimal.
  for (let versuch = 0; versuch < 3; versuch++) {
    const { data: zeile, error: lesefehler } = await admin
      .from('kunden')
      .select('dokumente, activities, unterlagen_anforderungen')
      .eq('id', kunde.id)
      .maybeSingle()
    if (lesefehler || !zeile) return fehler(500, 'Die Datei konnte nicht abgelegt werden. Bitte versuchen Sie es gleich noch einmal.')
    const dokumente = Array.isArray(zeile.dokumente) ? zeile.dokumente : []
    // Schon eingetragen (z. B. doppelt abgeschickt): nichts doppelt ablegen.
    if (dokumente.some((d: { url?: string }) => d && d.url === pfad)) return { status: 200, body: { ok: true } }
    const activities = Array.isArray(zeile.activities) ? zeile.activities : []
    const anforderungen = (Array.isArray(zeile.unterlagen_anforderungen) ? zeile.unterlagen_anforderungen : []) as Anforderung[]
    const { error: schreibfehler } = await admin
      .from('kunden')
      .update({
        dokumente: [dokument, ...dokumente],
        // Bei einem zweiten Durchgang nichts doppelt eintragen.
        activities: activities.some((x: { id?: string }) => x?.id === aktivitaetId) ? activities : [aktivitaet, ...activities],
        unterlagen_anforderungen: mitEingang(anforderungen, String(anforderung.token), eingang),
        letzte_aktivitaet: heute,
      })
      .eq('id', kunde.id)
    if (schreibfehler) return fehler(500, 'Die Datei konnte nicht abgelegt werden. Bitte versuchen Sie es gleich noch einmal.')

    const { data: nachher } = await admin.from('kunden').select('dokumente, activities, unterlagen_anforderungen').eq('id', kunde.id).maybeSingle()
    const dokDa = Array.isArray(nachher?.dokumente) && nachher.dokumente.some((d: { id?: string }) => d?.id === dokumentId)
    const aktDa = Array.isArray(nachher?.activities) && nachher.activities.some((x: { id?: string }) => x?.id === aktivitaetId)
    const eingDa =
      Array.isArray(nachher?.unterlagen_anforderungen) &&
      nachher.unterlagen_anforderungen.some((a: Anforderung) => a?.token === anforderung.token && (a.eingang ?? []).some((e) => e.dokumentId === dokumentId))
    if (dokDa && aktDa && eingDa) return { status: 200, body: { ok: true } }
    // Nur das Dokument verloren? Dann ist es mit dem nächsten Durchgang wieder da; ein bereits
    // vorhandenes Dokument wird oben erkannt — dann trotzdem Eingang/Verlauf nachtragen.
    if (dokDa) {
      const zeileJetzt = nachher as { activities?: unknown[]; unterlagen_anforderungen?: Anforderung[] }
      const patch: Record<string, unknown> = {}
      if (!aktDa) patch.activities = [aktivitaet, ...(Array.isArray(zeileJetzt.activities) ? zeileJetzt.activities : [])]
      if (!eingDa) patch.unterlagen_anforderungen = mitEingang(Array.isArray(zeileJetzt.unterlagen_anforderungen) ? zeileJetzt.unterlagen_anforderungen : [], String(anforderung.token), eingang)
      await admin.from('kunden').update(patch).eq('id', kunde.id)
      return { status: 200, body: { ok: true } }
    }
  }
  return fehler(500, 'Die Datei konnte nicht abgelegt werden. Bitte versuchen Sie es gleich noch einmal.')
}

/** Ein Einstieg für index.ts: beantwortet die drei öffentlichen Aktionen. */
export async function beantworteKundenUnterlagen(admin: Db, action: string, body: Record<string, unknown>, jetzt = new Date()): Promise<Antwort> {
  try {
    if (action === 'public_get_unterlagen') return await holeUnterlagen(admin, body.token, jetzt)
    if (action === 'public_unterlagen_upload_url') return await unterlagenUploadUrl(admin, body, jetzt)
    if (action === 'public_unterlagen_eingang') return await unterlagenEingang(admin, body, jetzt)
    return fehler(400, 'Unbekannte Aktion.')
  } catch (err) {
    console.error('Kunden-Unterlagen:', err)
    return fehler(500, 'Da ist bei uns etwas schiefgegangen. Bitte versuchen Sie es später noch einmal.')
  }
}
