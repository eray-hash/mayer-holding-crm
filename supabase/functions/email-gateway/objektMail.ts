// Eine Mail aus dem gemeinsamen Postfach einem Immobilien-Objekt zuordnen: Die Immobilienabteilung
// denkt in Objekten, nicht in Kunden — ein Exposé oder ein Grundbuchauszug gehört zum Objekt.
//
// - Die Anhänge werden aus der gemeinsamen Ablage in den nicht öffentlichen Ablageort der
//   Objekt-Dokumente kopiert und im passenden Ordner des Objekts eingetragen.
// - Am Objekt entsteht ein Eintrag im Verlauf, an der Mail ein Vermerk, zu welchem Objekt sie gehört
//   (`rohdaten.objekt`).
// - Ein zweiter Lauf mit derselben Mail und demselben Objekt legt nichts doppelt an: Jede Datei
//   bekommt eine feste Kennung aus Mail und Dateiname.
//
// - Private Objekte (objekte.privat_besitzer gesetzt) nur für ihren Besitzer (`wer.email`); an der Mail im
//   gemeinsamen Postfach steht dann nicht die Bezeichnung, sondern nur „privates Objekt“.
import { gemeinsamerAblagePfad, ladeGemeinsameDatei } from './postfach.ts'
import { darfObjekt, istPrivatesObjekt } from '../_shared/privatZugriff.ts'

// Der Dienst-Zugang zur Datenbank — in postfach.ts genauso typisiert, dort aber nicht exportiert.
// deno-lint-ignore no-explicit-any
type Db = any

type MailAnhang = { filename?: string; size?: number; contentType?: string; url?: string }
type Dokument = { id: string; name: string; typ: string; datum: string; groesse: string; url?: string }
type Ordner = Record<string, Dokument[]>

export type ObjektZuordnung =
  | { ok: true; abgelegt: number; uebersprungen: number; ordner: string[]; betreff: string }
  | { ok: false; fehler: string }

const OBJEKT_ABLAGE = 'objekt-dokumente'
const MAIL_SPALTEN = 'id, message_id, von, von_name, betreff, anhaenge, rohdaten, besitzer_email'

// Reihenfolge zählt: der erste Treffer gewinnt („Mietvertrag" und „Kaufvertrag" vor „Vertrag").
// Die Namen sind genau die Ordner der Objektakte (DOKUMENT_ORDNER in src/types/index.ts).
const ORDNER_REGELN: [RegExp, string][] = [
  [/grundbuch/i, 'Grundbuch'],
  [/grundriss/i, 'Grundrisse'],
  [/flurkarte/i, 'Flurkarte'],
  [/lageplan/i, 'Lageplan'],
  [/energieausweis/i, 'Energieausweis'],
  [/teilungserkl/i, 'Teilungserklärung'],
  [/mietvertr/i, 'Mietverträge'],
  [/mieterliste|mietaufstellung/i, 'Mieterliste'],
  [/expos/i, 'Exposé'],
  [/gutachten|wertermittlung|bewertung/i, 'Gutachten'],
  [/kaufvertrag|notar/i, 'Notarielle Dokumente'],
  [/vertrag|vollmacht/i, 'Verträge'],
]

function ordnerFuer(dateiname: string, inhaltsTyp: string): string {
  for (const [muster, ordner] of ORDNER_REGELN) if (muster.test(dateiname)) return ordner
  return inhaltsTyp.toLowerCase().startsWith('image/') ? 'Bilder' : 'Sonstiges'
}

// Das heutige Datum, wie es in Ulm auf dem Kalender steht (nicht das der Weltzeit, das zwischen
// Mitternacht und ein bzw. zwei Uhr noch den Vortag zeigt).
function heuteInBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function kurzKennung(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

function sichererDateiname(name: string): string {
  const ersetzt = name
    .normalize('NFC')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
  if (ersetzt.length <= 100) return ersetzt || 'Anhang'
  // Zu lange Namen kürzen, die Endung aber behalten — an ihr erkennt das Programm die Dateiart.
  const punkt = ersetzt.lastIndexOf('.')
  const endung = punkt > 0 && ersetzt.length - punkt <= 12 ? ersetzt.slice(punkt) : ''
  return ersetzt.slice(0, 100 - endung.length) + endung
}

function groesseText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function alsOrdner(wert: unknown): Ordner {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Ordner) : {}
}

function vorhandeneKennungen(dokumente: Ordner): Set<string> {
  const kennungen = new Set<string>()
  for (const liste of Object.values(dokumente)) {
    if (!Array.isArray(liste)) continue
    for (const d of liste) if (d && typeof d.id === 'string') kennungen.add(d.id)
  }
  return kennungen
}

// `mailId` ist die Zeilen-Kennung (uuid) oder die Message-ID der Mail.
export async function ordneMailObjektZu(admin: Db, mailId: string, objektId: string, wer: { name: string; email?: string }): Promise<ObjektZuordnung> {
  const gesucht = String(mailId ?? '').trim()
  const objektKennung = String(objektId ?? '').trim()
  if (!gesucht) return { ok: false, fehler: 'Es fehlt die Angabe, welche Mail gemeint ist.' }
  if (!objektKennung) return { ok: false, fehler: 'Es fehlt die Angabe, welches Objekt gemeint ist.' }

  // ---- Die Mail: nur aus dem gemeinsamen Postfach ----
  const istUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gesucht)
  const suche = async (spalte: 'id' | 'message_id', nurGemeinsam: boolean) => {
    let abfrage = admin.from('eingegangene_emails').select(MAIL_SPALTEN).eq(spalte, gesucht)
    if (nurGemeinsam) abfrage = abfrage.is('besitzer_email', null)
    const { data, error } = await abfrage.limit(1).maybeSingle()
    if (error) throw new Error(error.message)
    return data
  }
  // deno-lint-ignore no-explicit-any
  let mail: any = null
  try {
    if (istUuid) mail = await suche('id', true)
    if (!mail) mail = await suche('message_id', true)
    if (!mail) {
      // Unterscheiden, ob es die Mail gar nicht gibt oder ob sie jemandem persönlich gehört.
      const privat = (istUuid ? await suche('id', false) : null) ?? (await suche('message_id', false))
      return privat
        ? { ok: false, fehler: 'Diese Mail liegt in einem persönlichen Postfach. Einem Objekt lassen sich nur Mails aus dem gemeinsamen Postfach zuordnen.' }
        : { ok: false, fehler: 'Diese Mail wurde im gemeinsamen Postfach nicht gefunden.' }
    }
  } catch (e) {
    return { ok: false, fehler: `Die Mail ließ sich nicht laden: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (mail.besitzer_email) return { ok: false, fehler: 'Diese Mail liegt in einem persönlichen Postfach. Einem Objekt lassen sich nur Mails aus dem gemeinsamen Postfach zuordnen.' }

  // ---- Das Objekt ----
  const { data: objekt, error: objektFehler } = await admin.from('objekte').select('id, bezeichnung, dokumente, activities, privat_besitzer').eq('id', objektKennung).maybeSingle()
  if (objektFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht laden: ${objektFehler.message}` }
  if (!objekt) return { ok: false, fehler: 'Dieses Objekt gibt es nicht.' }
  const privat = istPrivatesObjekt(objekt)
  // Ein fremdes privates Objekt gilt als nicht vorhanden (keine Auskunft, dass es das Objekt gibt).
  if (privat && !darfObjekt(objekt, String(wer?.email ?? ''), false)) return { ok: false, fehler: 'Dieses Objekt gibt es nicht.' }

  // ---- Anhänge in die Ablage des Objekts kopieren ----
  const heute = heuteInBerlin()
  const schonDa = vorhandeneKennungen(alsOrdner(objekt.dokumente))
  const anhaenge = (Array.isArray(mail.anhaenge) ? mail.anhaenge : []) as MailAnhang[]
  const neu: { ordner: string; dokument: Dokument }[] = []
  const gleicheNamen = new Map<string, number>()
  let uebersprungen = 0
  let brauchbar = 0
  let letzterFehler = ''

  for (const anhang of anhaenge) {
    const name = String(anhang?.filename ?? '').trim() || 'Anhang'
    const typ = String(anhang?.contentType ?? '').trim() || 'application/octet-stream'
    // Zwei Anhänge mit demselben Namen in einer Mail bekommen trotzdem verschiedene Kennungen.
    const wievielter = gleicheNamen.get(name) ?? 0
    gleicheNamen.set(name, wievielter + 1)
    // Winzige Bilder sind Logos aus der Signatur, keine Unterlagen (dieselbe Regel wie bei Kundenakten).
    if (typ.toLowerCase().startsWith('image/') && Number(anhang?.size ?? 0) < 15 * 1024) {
      uebersprungen++
      continue
    }
    brauchbar++
    const kennung = await kurzKennung(`${mail.id}\n${name}${wievielter > 0 ? `\n${wievielter}` : ''}`)
    const id = `dok_${kennung}`
    if (schonDa.has(id) || neu.some((n) => n.dokument.id === id)) {
      uebersprungen++ // liegt schon beim Objekt
      continue
    }
    const quelle = gemeinsamerAblagePfad(String(anhang?.url ?? ''))
    if (!quelle) {
      uebersprungen++
      letzterFehler = `„${name}" liegt nicht in der gemeinsamen Ablage`
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = await ladeGemeinsameDatei(admin, quelle)
    } catch (e) {
      uebersprungen++
      letzterFehler = `„${name}": ${e instanceof Error ? e.message : String(e)}`
      console.error('Anhang für Objekt nicht lesbar', quelle, letzterFehler)
      continue
    }
    const ziel = `${objekt.id}/${id}_${sichererDateiname(name)}`
    const { error: schreibFehler } = await admin.storage.from(OBJEKT_ABLAGE).upload(ziel, bytes, { contentType: typ, upsert: true })
    if (schreibFehler) {
      uebersprungen++
      letzterFehler = `„${name}": ${schreibFehler.message}`
      console.error('Anhang für Objekt nicht ablegbar', ziel, schreibFehler.message)
      continue
    }
    neu.push({ ordner: ordnerFuer(name, typ), dokument: { id, name, typ, datum: heute, groesse: groesseText(bytes.length), url: ziel } })
  }

  // Gab es Unterlagen, aber keine einzige ließ sich ablegen und keine lag schon dort, ist das ein
  // Fehlschlag — sonst stünde am Objekt „E-Mail zugeordnet", und die Unterlagen fehlten stillschweigend.
  const rohVorher = mail.rohdaten && typeof mail.rohdaten === 'object' && !Array.isArray(mail.rohdaten) ? (mail.rohdaten as Record<string, unknown>) : {}
  const schonHier = (rohVorher.objekt as { id?: unknown } | undefined)?.id === objekt.id
  if (letzterFehler && neu.length === 0 && brauchbar > 0 && !schonHier) {
    return { ok: false, fehler: `Die Anhänge dieser Mail ließen sich nicht beim Objekt ablegen (${letzterFehler}).` }
  }

  // ---- Objekt ergänzen: frisch lesen, damit eine gleichzeitige Änderung nicht verloren geht ----
  let abgelegt: { ordner: string; dokument: Dokument }[] = []
  if (!schonHier || neu.length > 0) {
    const { data: frisch, error: leseFehler } = await admin.from('objekte').select('dokumente, activities').eq('id', objekt.id).maybeSingle()
    if (leseFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht ergänzen: ${leseFehler.message}` }
    if (!frisch) return { ok: false, fehler: 'Dieses Objekt gibt es nicht mehr.' }
    const dokumente: Ordner = { ...alsOrdner(frisch.dokumente) }
    const inzwischenDa = vorhandeneKennungen(dokumente)
    abgelegt = neu.filter((n) => !inzwischenDa.has(n.dokument.id))
    uebersprungen += neu.length - abgelegt.length
    for (const n of abgelegt) dokumente[n.ordner] = [n.dokument, ...(Array.isArray(dokumente[n.ordner]) ? dokumente[n.ordner] : [])]
    if (!schonHier || abgelegt.length > 0) {
      const anzahl = abgelegt.length
      const text = `E-Mail zugeordnet: „${mail.betreff ?? '(ohne Betreff)'}" von ${mail.von_name || mail.von || 'unbekannt'}${anzahl > 0 ? ` (${anzahl} ${anzahl === 1 ? 'Anhang' : 'Anhänge'} abgelegt)` : ''}`
      const activities = [{ id: crypto.randomUUID(), date: heute, text, user: wer?.name || 'unbekannt' }, ...(Array.isArray(frisch.activities) ? frisch.activities : [])]
      const { error: schreibFehler } = await admin.from('objekte').update({ dokumente, activities }).eq('id', objekt.id)
      if (schreibFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht ergänzen: ${schreibFehler.message}` }
    }
  }

  // ---- An der Mail vermerken, zu welchem Objekt sie gehört (alles andere in `rohdaten` bleibt) ----
  const { data: mailFrisch, error: mailLeseFehler } = await admin.from('eingegangene_emails').select('rohdaten').eq('id', mail.id).maybeSingle()
  if (mailLeseFehler) return { ok: false, fehler: `Die Zuordnung ließ sich an der Mail nicht vermerken: ${mailLeseFehler.message}` }
  const roh = mailFrisch?.rohdaten
  // Die Mail sehen alle Mitarbeiter: bei einem privaten Objekt ohne dessen Bezeichnung.
  const vermerk = { id: objekt.id, bezeichnung: privat ? 'privates Objekt' : (objekt.bezeichnung ?? '') }
  const rohdaten =
    roh && typeof roh === 'object' && !Array.isArray(roh)
      ? { ...(roh as Record<string, unknown>), objekt: vermerk }
      : roh === null || roh === undefined
        ? { objekt: vermerk }
        : { inhalt: roh, objekt: vermerk } // unerwartete Form: nichts wegwerfen
  const { error: mailFehler } = await admin.from('eingegangene_emails').update({ rohdaten }).eq('id', mail.id)
  if (mailFehler) return { ok: false, fehler: `Die Anhänge liegen beim Objekt, aber die Zuordnung ließ sich an der Mail nicht vermerken: ${mailFehler.message}` }

  return {
    ok: true,
    abgelegt: abgelegt.length,
    uebersprungen,
    ordner: [...new Set(abgelegt.map((n) => n.ordner))],
    betreff: mail.betreff ?? '',
  }
}
