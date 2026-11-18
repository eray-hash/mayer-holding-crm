// Ungeklärte Eingänge von Hand einsortieren: Was der Assistent keiner Akte zuordnen konnte, liegt in
// der Sammelakte „Ungeklärte Eingänge". Die Seite dazu (src/pages/eingang/UngeklaerteEingaenge.tsx)
// ruft diese beiden Funktionen über die Aktionen `eingang_ablegen` und `eingang_entfernen` auf.
//
// - Ziel Kunde: Ein Dokument ist nur ein Verweis auf die gespeicherte Datei. Ablegen heißt: den
//   Eintrag beim Kunden eintragen und aus der Sammelakte austragen — die Datei selbst bleibt, wo sie ist
//   (dasselbe Vorgehen wie `dateien_ablegen` im Telegram-Assistenten).
// - Ziel Objekt: Die Objektakte kennt nur Dateien in ihrem eigenen, nicht öffentlichen Ablageort
//   („objekt-dokumente", `url` = Pfad darin) — so öffnet sie Dateien und so liest sie der Server für
//   Bewertung und Verkaufsdatenblatt. Deshalb wird die Datei dorthin kopiert, wie bei einer Mail, die
//   einem Objekt zugeordnet wird (objektMail.ts). Jede Datei bekommt eine feste Kennung aus ihrem
//   bisherigen Verweis; ein zweiter Lauf legt nichts doppelt an.
// - Sammelakte und Ziel werden unmittelbar vor dem Schreiben frisch gelesen, damit eine gleichzeitige
//   Änderung (Telegram, Kollegen) möglichst nicht verloren geht.
import { gemeinsamerAblagePfad, ladeGemeinsameDatei } from './postfach.ts'

// Der Dienst-Zugang zur Datenbank — in postfach.ts genauso typisiert, dort aber nicht exportiert.
// deno-lint-ignore no-explicit-any
type Db = any

export type Dokument = { id: string; name: string; typ: string; datum: string; groesse: string; url?: string }
type Eintrag = { id: string; date: string; text: string; user: string }
type Ordner = Record<string, Dokument[]>

export type AblageZiel = { art: 'kunde'; id: string } | { art: 'objekt'; id: string; ordner: string }

export type AblageErgebnis =
  | {
      ok: true
      /** Namen der Dateien, die jetzt im Ziel liegen. */
      abgelegt: string[]
      /** Namen der Dateien, die im Ziel schon lagen — sie sind nur aus der Sammelakte ausgetragen. */
      uebersprungen: string[]
      /** Ganze Sätze zu Dateien, die sich nicht ablegen ließen — sie liegen weiter in der Sammelakte. */
      nichtAbgelegt: string[]
      sammelDokumente: Dokument[]
      ziel:
        | { art: 'kunde'; id: string; bereich: string; name: string; dokumente: Dokument[]; activities: Eintrag[]; letzteAktivitaet: string }
        | { art: 'objekt'; id: string; name: string; ordner: string; dokumente: Ordner; activities: Eintrag[] }
    }
  | { ok: false; fehler: string }

export type EntnahmeErgebnis =
  | { ok: true; entfernt: string[]; sammelDokumente: Dokument[]; sammelActivities: Eintrag[] }
  | { ok: false; fehler: string }

const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'
const OBJEKT_ABLAGE = 'objekt-dokumente'
const KUNDEN_ABLAGE = 'kunden-dokumente'
const HOECHSTENS = 200
// Ein Aufruf darf höchstens 150 Sekunden laufen. Das Kopieren in die Objektakte hört deshalb rechtzeitig
// auf; was dann noch fehlt, bleibt in der Sammelakte und wird beim nächsten Klick abgelegt.
const ZEIT_GRENZE_MS = 100_000

// Genau die Ordner der Objektakte (DOKUMENT_ORDNER in src/types/index.ts).
const OBJEKT_ORDNER = [
  'Aktennotiz', 'Angebote', 'Baulastenauskunft', 'Betriebskostenabrechnung', 'Bilder', 'Energieausweis', 'Exposé',
  'Finanzierung', 'Flurkarte', 'Gebäudeversicherung', 'Genehmigung', 'Grundbuch', 'Grundrisse', 'Gutachten',
  'Kostenaufstellung', 'Lageplan', 'Leistungsverzeichnisse', 'Mieterliste', 'Mietverträge', 'Notarielle Dokumente',
  'Persönliche Daten des Eigentümers', 'Pläne', 'Protokolle', 'Sanierungsunterlagen', 'Sonstiges', 'Teilungserklärung',
  'Verträge', 'Wohnflächenberechnung',
]

// Das heutige Datum, wie es in Ulm auf dem Kalender steht (nicht das der Weltzeit).
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
  if (ersetzt.length <= 100) return ersetzt || 'Datei'
  // Zu lange Namen kürzen, die Endung aber behalten — an ihr erkennt das Programm die Dateiart.
  const punkt = ersetzt.lastIndexOf('.')
  const endung = punkt > 0 && ersetzt.length - punkt <= 12 ? ersetzt.slice(punkt) : ''
  return ersetzt.slice(0, 100 - endung.length) + endung
}

function groesseText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function alsDokumente(wert: unknown): Dokument[] {
  return Array.isArray(wert) ? (wert.filter((d) => d && typeof d === 'object' && typeof (d as Dokument).id === 'string') as Dokument[]) : []
}

function alsOrdner(wert: unknown): Ordner {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Ordner) : {}
}

function alsEintraege(wert: unknown): Eintrag[] {
  return Array.isArray(wert) ? (wert as Eintrag[]) : []
}

function kennungen(roh: unknown): string[] {
  const liste = Array.isArray(roh) ? roh : []
  return [...new Set(liste.map((x) => String(x ?? '').trim()).filter(Boolean))]
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

function anzeigeName(d: Dokument): string {
  return String(d.name ?? '').trim() || 'Datei ohne Namen'
}

function inAnfuehrung(namen: string[]): string {
  return namen.map((n) => `„${n}“`).join(', ')
}

function kundeName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  const firma = String(k.firma ?? '').trim()
  const person = String(k.ansprechpartner ?? '').trim()
  return person && person !== firma ? `${firma || person}${firma ? ` (${person})` : ''}` : firma || 'Kunde ohne Namen'
}

// Dateien aus Telegram und dem Assistenten tragen im Dateinamen einen Abdruck ihres Inhalts
// („…/1731850000000_h0123456789ab_Name.pdf", bei zerlegten Sammel-Scans mit Seitenbereich). Zwei
// Verweise mit demselben Abdruck zeigen auf inhaltsgleiche Dateien.
function inhaltsAbdruck(url: string | undefined): string | null {
  if (!url) return null
  const letztes = url.split(/[?#]/)[0].split('/').pop() ?? ''
  return letztes.match(/^\d{10,}_(h[0-9a-f]{12}(?:p\d+-\d+)?)_/)?.[1] ?? null
}

// Gleicher Name, anderer Inhalt: als weitere Fassung ablegen — nichts wird überschrieben.
function freierName(name: string, vorhandene: Dokument[]): string {
  const belegt = new Set(vorhandene.map((d) => norm(d.name)))
  if (!belegt.has(norm(name))) return name
  for (let nr = 2; nr < 100; nr++) {
    const versuch = name.replace(/(\.[a-z0-9]+)?$/i, ` (${nr})$1`)
    if (!belegt.has(norm(versuch))) return versuch
  }
  return name
}

async function ladeSammelakte(admin: Db): Promise<{ dokumente: Dokument[]; activities: Eintrag[] } | string> {
  const { data, error } = await admin.from('kunden').select('id, dokumente, activities').eq('id', AKTE_UNGEKLAERT).maybeSingle()
  if (error) return `Die ungeklärten Eingänge ließen sich nicht laden: ${error.message}`
  if (!data) return 'Es gibt noch keine ungeklärten Eingänge.'
  return { dokumente: alsDokumente(data.dokumente), activities: alsEintraege(data.activities) }
}

// Trägt Dateien aus der Sammelakte aus: frisch lesen, nur diese Kennungen entfernen, alles andere bleibt.
async function trageAus(admin: Db, ids: Set<string>, eintrag?: Eintrag): Promise<{ dokumente: Dokument[]; activities: Eintrag[] } | string> {
  const sammel = await ladeSammelakte(admin)
  if (typeof sammel === 'string') return sammel
  const dokumente = sammel.dokumente.filter((d) => !ids.has(d.id))
  const activities = eintrag ? [eintrag, ...sammel.activities] : sammel.activities
  if (dokumente.length === sammel.dokumente.length && !eintrag) return { dokumente, activities }
  const { error } = await admin
    .from('kunden')
    .update(eintrag ? { dokumente, activities, letzte_aktivitaet: eintrag.date } : { dokumente })
    .eq('id', AKTE_UNGEKLAERT)
  if (error) return error.message
  return { dokumente, activities }
}

type Auswahl = { gewaehlt: Dokument[]; fehlend: number }

async function waehleAus(admin: Db, dokumentIds: unknown): Promise<Auswahl | string> {
  const ids = kennungen(dokumentIds)
  if (ids.length === 0) return 'Es ist keine Datei ausgewählt.'
  if (ids.length > HOECHSTENS) return `Bitte höchstens ${HOECHSTENS} Dateien auf einmal.`
  const sammel = await ladeSammelakte(admin)
  if (typeof sammel === 'string') return sammel
  const gesucht = new Set(ids)
  const gewaehlt = sammel.dokumente.filter((d) => gesucht.has(d.id))
  if (gewaehlt.length === 0) {
    return ids.length === 1
      ? 'Diese Datei liegt nicht mehr unter den ungeklärten Eingängen — vermutlich wurde sie inzwischen schon abgelegt.'
      : 'Diese Dateien liegen nicht mehr unter den ungeklärten Eingängen — vermutlich wurden sie inzwischen schon abgelegt.'
  }
  return { gewaehlt, fehlend: ids.length - new Set(gewaehlt.map((d) => d.id)).size }
}

function fehlendHinweis(fehlend: number): string[] {
  if (fehlend <= 0) return []
  return [fehlend === 1 ? 'Eine ausgewählte Datei lag nicht mehr unter den ungeklärten Eingängen.' : `${fehlend} ausgewählte Dateien lagen nicht mehr unter den ungeklärten Eingängen.`]
}

export async function legeEingaengeAb(admin: Db, eingabe: { dokumentIds: string[]; ziel: AblageZiel }, wer: { name: string }): Promise<AblageErgebnis> {
  const ziel = eingabe?.ziel
  const zielId = String(ziel?.id ?? '').trim()
  if (!ziel || (ziel.art !== 'kunde' && ziel.art !== 'objekt') || !zielId) return { ok: false, fehler: 'Es fehlt die Angabe, wohin abgelegt werden soll.' }
  if (zielId === AKTE_UNGEKLAERT) return { ok: false, fehler: 'Die Dateien liegen bereits unter den ungeklärten Eingängen. Bitte einen Kunden oder ein Objekt wählen.' }

  try {
    const auswahl = await waehleAus(admin, eingabe?.dokumentIds)
    if (typeof auswahl === 'string') return { ok: false, fehler: auswahl }
    const name = String(wer?.name ?? '').trim() || 'unbekannt'
    return ziel.art === 'kunde' ? await legeBeiKundeAb(admin, auswahl, zielId, name) : await legeBeiObjektAb(admin, auswahl, zielId, String(ziel.ordner ?? '').trim(), name)
  } catch (e) {
    return { ok: false, fehler: `Das Ablegen ist fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function legeBeiKundeAb(admin: Db, auswahl: Auswahl, kundeId: string, wer: string): Promise<AblageErgebnis> {
  const { data: kunde, error } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, dokumente, activities').eq('id', kundeId).maybeSingle()
  if (error) return { ok: false, fehler: `Die Akte ließ sich nicht laden: ${error.message}` }
  if (!kunde) return { ok: false, fehler: 'Diese Akte gibt es nicht (mehr).' }
  // Private Kontakte gehören einem einzelnen Mitarbeiter. Diese Funktion arbeitet mit vollen
  // Datenbankrechten und kann nicht prüfen, wem der Kontakt gehört — also gar nicht erst hinein.
  if (kunde.bereich === 'privat') return { ok: false, fehler: 'In einen privaten Kontakt lässt sich von hier aus nichts ablegen.' }

  const heute = heuteInBerlin()
  let dokumente = alsDokumente(kunde.dokumente)
  const abgelegt: string[] = []
  const uebersprungen: string[] = []
  const erledigt = new Set<string>()
  for (const d of auswahl.gewaehlt) {
    const abdruck = inhaltsAbdruck(d.url)
    const schonDa = dokumente.some((x) => x.id === d.id || (!!d.url && x.url === d.url) || (!!abdruck && !!x.url && x.url.includes(`_${abdruck}_`)))
    erledigt.add(d.id)
    if (schonDa) {
      uebersprungen.push(anzeigeName(d))
      continue
    }
    const neu: Dokument = { ...d, name: freierName(anzeigeName(d), dokumente) }
    dokumente = [neu, ...dokumente]
    abgelegt.push(neu.name)
  }

  let activities = alsEintraege(kunde.activities)
  if (abgelegt.length > 0) {
    activities = [{ id: crypto.randomUUID(), date: heute, text: `Aus den ungeklärten Eingängen abgelegt von ${wer}: ${inAnfuehrung(abgelegt)}`, user: wer }, ...activities]
    const { error: schreibFehler } = await admin.from('kunden').update({ dokumente, activities, letzte_aktivitaet: heute }).eq('id', kunde.id)
    if (schreibFehler) return { ok: false, fehler: `Die Akte ließ sich nicht speichern: ${schreibFehler.message}. Nichts wurde abgelegt.` }
  }

  const sammel = await trageAus(admin, erledigt)
  if (typeof sammel === 'string') {
    return { ok: false, fehler: `${abgelegt.length > 0 ? `Die Dateien liegen jetzt bei ${kundeName(kunde)}, ließen` : 'Die Dateien ließen'} sich aber nicht aus den ungeklärten Eingängen austragen: ${sammel}. Bitte noch einmal auf „Ablegen“ klicken — doppelt abgelegt wird dabei nichts.` }
  }
  return {
    ok: true,
    abgelegt,
    uebersprungen,
    nichtAbgelegt: fehlendHinweis(auswahl.fehlend),
    sammelDokumente: sammel.dokumente,
    ziel: { art: 'kunde', id: kunde.id, bereich: String(kunde.bereich ?? ''), name: kundeName(kunde), dokumente, activities, letzteAktivitaet: heute },
  }
}

// Holt die gespeicherte Datei zu einem Verweis aus der Sammelakte: gemeinsame Ablage (Telegram,
// Assistent, Mail-Anhänge) oder — bei von Hand in die Sammelakte hochgeladenen Dateien — die Ablage der
// Kundendokumente.
async function ladeDatei(admin: Db, url: string): Promise<Uint8Array> {
  const gemeinsam = gemeinsamerAblagePfad(url)
  if (gemeinsam) return await ladeGemeinsameDatei(admin, gemeinsam)
  if (/^https?:\/\//i.test(url) || url.startsWith('privat:')) throw new Error('die Datei liegt an einem Ort, von dem sie sich nicht in eine Objektakte übernehmen lässt')
  const { data, error } = await admin.storage.from(KUNDEN_ABLAGE).download(url)
  if (error || !data) throw new Error(`die Datei ist nicht abrufbar (${error?.message ?? 'unbekannt'})`)
  return new Uint8Array(await data.arrayBuffer())
}

function alleObjektDokumente(dokumente: Ordner): Dokument[] {
  return Object.values(dokumente).flatMap((liste) => (Array.isArray(liste) ? liste : []))
}

async function legeBeiObjektAb(admin: Db, auswahl: Auswahl, objektId: string, ordner: string, wer: string): Promise<AblageErgebnis> {
  if (!OBJEKT_ORDNER.includes(ordner)) return { ok: false, fehler: 'Bitte einen Ordner der Objektakte wählen.' }
  const { data: objekt, error } = await admin.from('objekte').select('id, bezeichnung, dokumente').eq('id', objektId).maybeSingle()
  if (error) return { ok: false, fehler: `Das Objekt ließ sich nicht laden: ${error.message}` }
  if (!objekt) return { ok: false, fehler: 'Dieses Objekt gibt es nicht (mehr).' }

  const start = Date.now()
  const heute = heuteInBerlin()
  const vorher = alleObjektDokumente(alsOrdner(objekt.dokumente))
  const neu: { quelle: Dokument; dokument: Dokument }[] = []
  const uebersprungen: string[] = []
  const nichtAbgelegt: string[] = fehlendHinweis(auswahl.fehlend)
  const erledigt = new Set<string>()
  let ausZeitgruenden = 0

  for (const d of auswahl.gewaehlt) {
    const name = anzeigeName(d)
    if (!d.url) {
      nichtAbgelegt.push(`„${name}“: Zu diesem Eintrag ist keine Datei gespeichert.`)
      continue
    }
    const id = `dok_e${await kurzKennung(d.url)}`
    if (vorher.some((x) => x.id === id || x.url === d.url) || neu.some((n) => n.dokument.id === id)) {
      uebersprungen.push(name)
      erledigt.add(d.id)
      continue
    }
    if (Date.now() - start > ZEIT_GRENZE_MS) {
      ausZeitgruenden++
      continue
    }
    try {
      const bytes = await ladeDatei(admin, d.url)
      const zielPfad = `${objekt.id}/${id}_${sichererDateiname(name)}`
      const typ = /^[\w.+-]+\/[\w.+-]+$/.test(String(d.typ ?? '')) ? d.typ : 'application/octet-stream'
      const { error: kopierFehler } = await admin.storage.from(OBJEKT_ABLAGE).upload(zielPfad, bytes, { contentType: typ, upsert: true })
      if (kopierFehler) throw new Error(kopierFehler.message)
      neu.push({ quelle: d, dokument: { id, name, typ: d.typ || typ, datum: d.datum || heute, groesse: d.groesse || groesseText(bytes.length), url: zielPfad } })
    } catch (e) {
      const grund = e instanceof Error ? e.message : String(e)
      console.error('Ungeklärter Eingang nicht in Objektakte kopierbar', objekt.id, id, grund)
      nichtAbgelegt.push(`„${name}“: ${grund}.`)
    }
  }
  if (ausZeitgruenden > 0) {
    nichtAbgelegt.push(`${ausZeitgruenden === 1 ? 'Eine Datei wurde' : `${ausZeitgruenden} Dateien wurden`} aus Zeitgründen noch nicht abgelegt — bitte noch einmal auf „Ablegen“ klicken.`)
  }
  if (neu.length === 0 && uebersprungen.length === 0) {
    return { ok: false, fehler: `Es ließ sich nichts beim Objekt ablegen. ${nichtAbgelegt.join(' ')}`.trim() }
  }

  // ---- Objekt ergänzen: frisch lesen, das Kopieren kann gedauert haben ----
  const { data: frisch, error: leseFehler } = await admin.from('objekte').select('dokumente, activities').eq('id', objekt.id).maybeSingle()
  if (leseFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht ergänzen: ${leseFehler.message}` }
  if (!frisch) return { ok: false, fehler: 'Dieses Objekt gibt es nicht mehr.' }
  const dokumente: Ordner = { ...alsOrdner(frisch.dokumente) }
  const inzwischen = new Set(alleObjektDokumente(dokumente).map((x) => x.id))
  const abgelegt: string[] = []
  let imOrdner = Array.isArray(dokumente[ordner]) ? dokumente[ordner] : []
  for (const n of neu) {
    erledigt.add(n.quelle.id)
    if (inzwischen.has(n.dokument.id)) {
      uebersprungen.push(n.dokument.name)
      continue
    }
    const eintrag = { ...n.dokument, name: freierName(n.dokument.name, imOrdner) }
    imOrdner = [eintrag, ...imOrdner]
    abgelegt.push(eintrag.name)
  }
  let activities = alsEintraege(frisch.activities)
  if (abgelegt.length > 0) {
    dokumente[ordner] = imOrdner
    activities = [{ id: crypto.randomUUID(), date: heute, text: `Aus den ungeklärten Eingängen abgelegt von ${wer} (Ordner ${ordner}): ${inAnfuehrung(abgelegt)}`, user: wer }, ...activities]
    const { error: schreibFehler } = await admin.from('objekte').update({ dokumente, activities }).eq('id', objekt.id)
    if (schreibFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht speichern: ${schreibFehler.message}. Nichts wurde abgelegt.` }
  }

  const bezeichnung = String(objekt.bezeichnung ?? '').trim() || 'Objekt ohne Bezeichnung'
  const sammel = await trageAus(admin, erledigt)
  if (typeof sammel === 'string') {
    return { ok: false, fehler: `${abgelegt.length > 0 ? `Die Dateien liegen jetzt beim Objekt ${bezeichnung}, ließen` : 'Die Dateien ließen'} sich aber nicht aus den ungeklärten Eingängen austragen: ${sammel}. Bitte noch einmal auf „Ablegen“ klicken — doppelt abgelegt wird dabei nichts.` }
  }
  return {
    ok: true,
    abgelegt,
    uebersprungen,
    nichtAbgelegt,
    sammelDokumente: sammel.dokumente,
    ziel: { art: 'objekt', id: objekt.id, name: bezeichnung, ordner, dokumente, activities },
  }
}

// Nimmt Einträge aus der Sammelakte, ohne sie irgendwo abzulegen (Werbung, Doppeltes, Versehen). Die
// gespeicherte Datei wird nicht gelöscht — nur der Eintrag in dieser Liste verschwindet.
export async function nimmEingaengeHeraus(admin: Db, dokumentIds: string[], wer: { name: string }): Promise<EntnahmeErgebnis> {
  try {
    const auswahl = await waehleAus(admin, dokumentIds)
    if (typeof auswahl === 'string') return { ok: false, fehler: auswahl }
    const name = String(wer?.name ?? '').trim() || 'unbekannt'
    const entfernt = auswahl.gewaehlt.map(anzeigeName)
    const eintrag: Eintrag = {
      id: crypto.randomUUID(),
      date: heuteInBerlin(),
      text: `Von ${name} aus der Liste genommen, ohne es abzulegen (die gespeicherte Datei bleibt erhalten): ${inAnfuehrung(entfernt)}`,
      user: name,
    }
    const sammel = await trageAus(admin, new Set(auswahl.gewaehlt.map((d) => d.id)), eintrag)
    if (typeof sammel === 'string') return { ok: false, fehler: `Die Einträge ließen sich nicht aus der Liste nehmen: ${sammel}` }
    return { ok: true, entfernt, sammelDokumente: sammel.dokumente, sammelActivities: sammel.activities }
  } catch (e) {
    return { ok: false, fehler: `Die Einträge ließen sich nicht aus der Liste nehmen: ${e instanceof Error ? e.message : String(e)}` }
  }
}
