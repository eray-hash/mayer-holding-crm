// Ungeklärte Eingänge von Hand einsortieren: Was der Assistent keiner Akte zuordnen konnte, liegt in
// der Sammelakte „Ungeklärte Eingänge". Die Seite dazu (src/pages/eingang/UngeklaerteEingaenge.tsx)
// ruft diese Funktionen über die Aktionen `eingang_ablegen`, `eingang_entfernen` und
// `eingang_rueckgaengig` auf.
//
// - Ein Dokument ist nur ein Verweis auf die gespeicherte Datei. Ablegen heißt: den Eintrag beim Kunden
//   bzw. im gewählten Ordner des Objekts eintragen (gleiche Kennung, gleicher Verweis) und aus der
//   Sammelakte austragen. Die Datei selbst bleibt, wo sie ist — es wird nichts kopiert und nichts
//   gelöscht (dasselbe Vorgehen wie `dateien_ablegen` im Telegram-Assistenten).
// - Jede Ablage wird in `abteilung_eintraege` (art „ablage", id „ablage|<uuid>") festgehalten: wann,
//   wer, wohin, und je Datei der ursprüngliche Eintrag der Sammelakte. Damit lässt sie sich rückgängig
//   machen. Diese Zeilen schreibt nur der Server; das Fenster liest sie nur.
// - Sammelakte und Ziel werden unmittelbar vor dem Schreiben frisch gelesen, damit eine gleichzeitige
//   Änderung (Telegram, Kollegen) möglichst nicht verloren geht.

// Der Dienst-Zugang zur Datenbank — in postfach.ts genauso typisiert, dort aber nicht exportiert.
// deno-lint-ignore no-explicit-any
type Db = any

export type Dokument = { id: string; name: string; typ: string; datum: string; groesse: string; url?: string }
type Eintrag = { id: string; date: string; text: string; user: string }
type Ordner = Record<string, Dokument[]>

export type AblageZiel = { art: 'kunde'; id: string } | { art: 'objekt'; id: string; ordner: string }

type ZielStand =
  | { art: 'kunde'; id: string; bereich: string; name: string; dokumente: Dokument[]; activities: Eintrag[]; letzteAktivitaet: string }
  | { art: 'objekt'; id: string; name: string; ordner: string; dokumente: Ordner; activities: Eintrag[] }

export type AblageErgebnis =
  | {
      ok: true
      /** Namen der Dateien, die jetzt im Ziel liegen. */
      abgelegt: string[]
      /** Namen der Dateien, die im Ziel schon lagen — sie sind nur aus der Sammelakte ausgetragen. */
      uebersprungen: string[]
      /** Ganze Sätze zu Dateien, die sich nicht ablegen ließen — sie liegen weiter in der Sammelakte. */
      nichtAbgelegt: string[]
      /** Kennung des Eintrags zum Rückgängigmachen; `null`, wenn er sich nicht speichern ließ (dann steht in `hinweise` warum). */
      ablageId: string | null
      hinweise: string[]
      sammelDokumente: Dokument[]
      ziel: ZielStand
    }
  | { ok: false; fehler: string }

export type EntnahmeErgebnis =
  | { ok: true; entfernt: string[]; sammelDokumente: Dokument[]; sammelActivities: Eintrag[] }
  | { ok: false; fehler: string }

export type RueckgaengigErgebnis =
  | {
      ok: true
      /** Namen der Dateien, die aus dem Ziel genommen und wieder unter die ungeklärten Eingänge gelegt wurden. */
      zurueck: string[]
      /** Namen der Dateien, die beim Ablegen schon im Ziel lagen und jetzt wieder in der Liste stehen. */
      wiederInListe: string[]
      /** Namen der Dateien, die inzwischen nicht mehr im Ziel liegen — sie bleiben, wie sie sind. */
      nichtMehrDort: string[]
      sammelDokumente: Dokument[]
      /** Frischer Stand des Ziels; `null`, wenn es das Ziel nicht mehr gibt. */
      ziel: ZielStand | null
    }
  | { ok: false; fehler: string }

/** So liegt eine Ablage in `abteilung_eintraege.daten`. */
export type AblageProtokoll = {
  id: string
  art: 'ablage'
  am: string
  von: string
  ziel: { art: 'kunde'; id: string; name: string; bereich: string } | { art: 'objekt'; id: string; name: string; ordner: string }
  /** Je abgelegte Datei: der ursprüngliche Eintrag der Sammelakte und wie er im Ziel heißt (die Kennung bleibt gleich). */
  dateien: { original: Dokument; zielId: string; zielUrl?: string; zielName: string }[]
  /** Dateien, die im Ziel schon lagen und deshalb nur aus der Sammelakte ausgetragen wurden. */
  uebersprungen: Dokument[]
  rueckgaengigAm?: string
  rueckgaengigVon?: string
  rueckgaengig?: { zurueck: string[]; wiederInListe: string[]; nichtMehrDort: string[] }
}

const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'
const PROTOKOLL_TABELLE = 'abteilung_eintraege'
const HOECHSTENS = 200

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

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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
    const lauf = ziel.art === 'kunde' ? await legeBeiKundeAb(admin, auswahl, zielId, name) : await legeBeiObjektAb(admin, auswahl, zielId, String(ziel.ordner ?? '').trim(), name)
    if (!lauf.ok) return lauf

    // ---- Festhalten, damit sich die Ablage rückgängig machen lässt ----
    const hinweise: string[] = []
    let ablageId: string | null = null
    if (lauf.dateien.length > 0 || lauf.uebersprungeneDokumente.length > 0) {
      const z = lauf.ziel
      const protokoll: AblageProtokoll = {
        id: `ablage|${crypto.randomUUID()}`,
        art: 'ablage',
        am: new Date().toISOString(),
        von: name,
        ziel: z.art === 'kunde' ? { art: 'kunde', id: z.id, name: z.name, bereich: z.bereich } : { art: 'objekt', id: z.id, name: z.name, ordner: z.ordner },
        dateien: lauf.dateien,
        uebersprungen: lauf.uebersprungeneDokumente,
      }
      try {
        const { error } = await admin.from(PROTOKOLL_TABELLE).insert({ id: protokoll.id, art: 'ablage', daten: protokoll, updated_at: protokoll.am })
        if (error) throw new Error(error.message)
        ablageId = protokoll.id
      } catch (e) {
        console.error('Ablage nicht protokolliert', fehlerText(e))
        hinweise.push(`Abgelegt ist alles, aber der Eintrag zum Rückgängigmachen ließ sich nicht speichern (${fehlerText(e)}). Diese Ablage lässt sich deshalb nur von Hand zurücknehmen.`)
      }
    }
    return {
      ok: true,
      abgelegt: lauf.abgelegt,
      uebersprungen: lauf.uebersprungen,
      nichtAbgelegt: lauf.nichtAbgelegt,
      ablageId,
      hinweise,
      sammelDokumente: lauf.sammelDokumente,
      ziel: lauf.ziel,
    }
  } catch (e) {
    return { ok: false, fehler: `Das Ablegen ist fehlgeschlagen: ${fehlerText(e)}` }
  }
}

type Lauf =
  | {
      ok: true
      abgelegt: string[]
      uebersprungen: string[]
      nichtAbgelegt: string[]
      dateien: AblageProtokoll['dateien']
      uebersprungeneDokumente: Dokument[]
      sammelDokumente: Dokument[]
      ziel: ZielStand
    }
  | { ok: false; fehler: string }

// Liegt die Datei schon im Ziel? Gleiche Kennung, gleicher Verweis oder inhaltsgleich (gleicher Abdruck).
function liegtSchonIn(vorhandene: Dokument[], d: Dokument): boolean {
  const abdruck = inhaltsAbdruck(d.url)
  return vorhandene.some((x) => x.id === d.id || (!!d.url && x.url === d.url) || (!!abdruck && !!x.url && x.url.includes(`_${abdruck}_`)))
}

// Verteilt die ausgewählten Einträge: was schon im Ziel liegt, wird übersprungen; der Rest kommt vorn
// in die Liste (`liste`), bei gleichem Namen als „Name (2)". Alle Vergleiche gegen `alleImZiel`.
function verteile(auswahl: Auswahl, alleImZiel: Dokument[], liste: Dokument[]) {
  let neueListe = liste
  const imZiel = [...alleImZiel]
  const dateien: AblageProtokoll['dateien'] = []
  const uebersprungeneDokumente: Dokument[] = []
  const erledigt = new Set<string>()
  for (const d of auswahl.gewaehlt) {
    erledigt.add(d.id)
    if (liegtSchonIn(imZiel, d)) {
      uebersprungeneDokumente.push(d)
      continue
    }
    const neu: Dokument = { ...d, name: freierName(anzeigeName(d), neueListe) }
    neueListe = [neu, ...neueListe]
    imZiel.push(neu)
    dateien.push({ original: d, zielId: neu.id, zielUrl: neu.url, zielName: neu.name })
  }
  return { liste: neueListe, dateien, uebersprungeneDokumente, erledigt }
}

async function legeBeiKundeAb(admin: Db, auswahl: Auswahl, kundeId: string, wer: string): Promise<Lauf> {
  const { data: kunde, error } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, dokumente, activities').eq('id', kundeId).maybeSingle()
  if (error) return { ok: false, fehler: `Die Akte ließ sich nicht laden: ${error.message}` }
  if (!kunde) return { ok: false, fehler: 'Diese Akte gibt es nicht (mehr).' }
  // Private Kontakte gehören einem einzelnen Mitarbeiter. Diese Funktion arbeitet mit vollen
  // Datenbankrechten und kann nicht prüfen, wem der Kontakt gehört — also gar nicht erst hinein.
  if (kunde.bereich === 'privat') return { ok: false, fehler: 'In einen privaten Kontakt lässt sich von hier aus nichts ablegen.' }

  const heute = heuteInBerlin()
  const vorher = alsDokumente(kunde.dokumente)
  const v = verteile(auswahl, vorher, vorher)
  const abgelegt = v.dateien.map((x) => x.zielName)
  let activities = alsEintraege(kunde.activities)
  if (abgelegt.length > 0) {
    activities = [{ id: crypto.randomUUID(), date: heute, text: `Aus den ungeklärten Eingängen abgelegt von ${wer}: ${inAnfuehrung(abgelegt)}`, user: wer }, ...activities]
    const { error: schreibFehler } = await admin.from('kunden').update({ dokumente: v.liste, activities, letzte_aktivitaet: heute }).eq('id', kunde.id)
    if (schreibFehler) return { ok: false, fehler: `Die Akte ließ sich nicht speichern: ${schreibFehler.message}. Nichts wurde abgelegt.` }
  }

  const sammel = await trageAus(admin, v.erledigt)
  if (typeof sammel === 'string') {
    return { ok: false, fehler: `${abgelegt.length > 0 ? `Die Dateien liegen jetzt bei ${kundeName(kunde)}, ließen` : 'Die Dateien ließen'} sich aber nicht aus den ungeklärten Eingängen austragen: ${sammel}. Bitte noch einmal auf „Ablegen“ klicken — doppelt abgelegt wird dabei nichts.` }
  }
  return {
    ok: true,
    abgelegt,
    uebersprungen: v.uebersprungeneDokumente.map(anzeigeName),
    nichtAbgelegt: fehlendHinweis(auswahl.fehlend),
    dateien: v.dateien,
    uebersprungeneDokumente: v.uebersprungeneDokumente,
    sammelDokumente: sammel.dokumente,
    ziel: { art: 'kunde', id: kunde.id, bereich: String(kunde.bereich ?? ''), name: kundeName(kunde), dokumente: v.liste, activities, letzteAktivitaet: heute },
  }
}

function alleObjektDokumente(dokumente: Ordner): Dokument[] {
  return Object.values(dokumente).flatMap((liste) => (Array.isArray(liste) ? liste : []))
}

function objektName(o: { bezeichnung?: string | null }): string {
  return String(o.bezeichnung ?? '').trim() || 'Objekt ohne Bezeichnung'
}

async function legeBeiObjektAb(admin: Db, auswahl: Auswahl, objektId: string, ordner: string, wer: string): Promise<Lauf> {
  if (!OBJEKT_ORDNER.includes(ordner)) return { ok: false, fehler: 'Bitte einen Ordner der Objektakte wählen.' }
  const { data: objekt, error } = await admin.from('objekte').select('id, bezeichnung, dokumente, activities').eq('id', objektId).maybeSingle()
  if (error) return { ok: false, fehler: `Das Objekt ließ sich nicht laden: ${error.message}` }
  if (!objekt) return { ok: false, fehler: 'Dieses Objekt gibt es nicht (mehr).' }

  const heute = heuteInBerlin()
  const dokumente: Ordner = { ...alsOrdner(objekt.dokumente) }
  const imOrdner = alsDokumente(dokumente[ordner])
  // Doppelt ist eine Datei, wenn sie in irgendeinem Ordner des Objekts schon liegt.
  const v = verteile(auswahl, alleObjektDokumente(dokumente), imOrdner)
  const abgelegt = v.dateien.map((x) => x.zielName)
  let activities = alsEintraege(objekt.activities)
  if (abgelegt.length > 0) {
    dokumente[ordner] = v.liste
    activities = [{ id: crypto.randomUUID(), date: heute, text: `Aus den ungeklärten Eingängen abgelegt von ${wer} (Ordner ${ordner}): ${inAnfuehrung(abgelegt)}`, user: wer }, ...activities]
    const { error: schreibFehler } = await admin.from('objekte').update({ dokumente, activities }).eq('id', objekt.id)
    if (schreibFehler) return { ok: false, fehler: `Das Objekt ließ sich nicht speichern: ${schreibFehler.message}. Nichts wurde abgelegt.` }
  }

  const sammel = await trageAus(admin, v.erledigt)
  if (typeof sammel === 'string') {
    return { ok: false, fehler: `${abgelegt.length > 0 ? `Die Dateien liegen jetzt beim Objekt ${objektName(objekt)}, ließen` : 'Die Dateien ließen'} sich aber nicht aus den ungeklärten Eingängen austragen: ${sammel}. Bitte noch einmal auf „Ablegen“ klicken — doppelt abgelegt wird dabei nichts.` }
  }
  return {
    ok: true,
    abgelegt,
    uebersprungen: v.uebersprungeneDokumente.map(anzeigeName),
    nichtAbgelegt: fehlendHinweis(auswahl.fehlend),
    dateien: v.dateien,
    uebersprungeneDokumente: v.uebersprungeneDokumente,
    sammelDokumente: sammel.dokumente,
    ziel: { art: 'objekt', id: objekt.id, name: objektName(objekt), ordner, dokumente, activities },
  }
}

// Macht eine Ablage rückgängig: Was noch unverändert im Ziel liegt (gleiche Kennung, gleicher Verweis),
// kommt dort heraus und wieder unter die ungeklärten Eingänge; Dateien, die beim Ablegen schon im Ziel
// lagen und nur ausgetragen wurden, kommen ebenfalls zurück in die Liste. Was inzwischen verschoben
// oder gelöscht wurde, bleibt, wie es ist.
// Reihenfolge mit Absicht: erst zurück in die Liste, dann aus dem Ziel nehmen — scheitert der zweite
// Schritt, liegt eine Datei kurz an zwei Stellen, aber nie an keiner.
export async function macheAblageRueckgaengig(admin: Db, ablageId: string, wer: { name: string }): Promise<RueckgaengigErgebnis> {
  const kennung = String(ablageId ?? '').trim()
  if (!kennung.startsWith('ablage|')) return { ok: false, fehler: 'Es fehlt die Angabe, welche Ablage gemeint ist.' }
  const name = String(wer?.name ?? '').trim() || 'unbekannt'
  try {
    const { data: zeile, error } = await admin.from(PROTOKOLL_TABELLE).select('id, art, daten').eq('id', kennung).maybeSingle()
    if (error) return { ok: false, fehler: `Die Ablage ließ sich nicht laden: ${error.message}` }
    if (!zeile || zeile.art !== 'ablage' || !zeile.daten) return { ok: false, fehler: 'Diese Ablage ist nicht (mehr) verzeichnet.' }
    const p = zeile.daten as AblageProtokoll
    if (p.rueckgaengigAm) {
      return { ok: false, fehler: `Diese Ablage wurde bereits rückgängig gemacht${p.rueckgaengigVon ? ` (von ${p.rueckgaengigVon})` : ''}. Es wurde nichts geändert.` }
    }
    const dateien = Array.isArray(p.dateien) ? p.dateien : []
    const uebersprungene = Array.isArray(p.uebersprungen) ? p.uebersprungen : []
    const heute = heuteInBerlin()

    // ---- Ziel frisch lesen: was liegt noch so dort, wie es abgelegt wurde? ----
    const istKunde = p.ziel?.art === 'kunde'
    const { data: zielZeile, error: zielFehler } = istKunde
      ? await admin.from('kunden').select('id, bereich, firma, ansprechpartner, dokumente, activities, letzte_aktivitaet').eq('id', p.ziel.id).maybeSingle()
      : await admin.from('objekte').select('id, bezeichnung, dokumente, activities').eq('id', p.ziel?.id).maybeSingle()
    if (zielFehler) return { ok: false, fehler: `${istKunde ? 'Die Akte' : 'Das Objekt'} ließ sich nicht laden: ${zielFehler.message}. Es wurde nichts geändert.` }
    const istNochDa = (liste: Dokument[], f: AblageProtokoll['dateien'][number]) => liste.some((x) => x.id === f.zielId && x.url === f.zielUrl)
    const zielDokumente: Dokument[] = !zielZeile ? [] : istKunde ? alsDokumente(zielZeile.dokumente) : alleObjektDokumente(alsOrdner(zielZeile.dokumente))
    const zurueckDateien = dateien.filter((f) => istNochDa(zielDokumente, f))
    const nichtMehrDort = dateien.filter((f) => !istNochDa(zielDokumente, f)).map((f) => f.zielName || anzeigeName(f.original))

    // ---- 1. Zurück in die Sammelakte (Kennungen, die dort schon liegen, nicht doppelt) ----
    const sammel = await ladeSammelakte(admin)
    if (typeof sammel === 'string') return { ok: false, fehler: `${sammel}. Es wurde nichts geändert.` }
    const zurueckInListe = [...zurueckDateien.map((f) => f.original), ...uebersprungene]
    const schonInListe = new Set(sammel.dokumente.map((d) => d.id))
    const hinein = zurueckInListe.filter((d, i) => d?.id && !schonInListe.has(d.id) && zurueckInListe.findIndex((x) => x.id === d.id) === i)
    let sammelDokumente = sammel.dokumente
    if (hinein.length > 0) {
      sammelDokumente = [...hinein, ...sammel.dokumente]
      const { error: sammelFehler } = await admin.from('kunden').update({ dokumente: sammelDokumente }).eq('id', AKTE_UNGEKLAERT)
      if (sammelFehler) return { ok: false, fehler: `Die Dateien ließen sich nicht zurück unter die ungeklärten Eingänge legen: ${sammelFehler.message}. Es wurde nichts geändert.` }
    }

    // ---- 2. Aus dem Ziel nehmen und dort vermerken ----
    let ziel: ZielStand | null = null
    if (zielZeile) {
      const weg = new Set(zurueckDateien.map((f) => f.zielId))
      const namen = zurueckDateien.map((f) => f.zielName || anzeigeName(f.original))
      let activities = alsEintraege(zielZeile.activities)
      const eintrag: Eintrag = { id: crypto.randomUUID(), date: heute, text: `Ablage rückgängig gemacht von ${name}: ${inAnfuehrung(namen)}`, user: name }
      if (istKunde) {
        const dokumente = zielDokumente.filter((d) => !weg.has(d.id))
        let letzte = String(zielZeile.letzte_aktivitaet ?? '')
        if (weg.size > 0) {
          activities = [eintrag, ...activities]
          letzte = heute
          const { error: e2 } = await admin.from('kunden').update({ dokumente, activities, letzte_aktivitaet: heute }).eq('id', zielZeile.id)
          if (e2) return { ok: false, fehler: `Die Dateien liegen wieder unter den ungeklärten Eingängen, ließen sich aber nicht aus der Akte nehmen: ${e2.message}. Bitte noch einmal „Rückgängig“ wählen.` }
        }
        ziel = { art: 'kunde', id: zielZeile.id, bereich: String(zielZeile.bereich ?? ''), name: kundeName(zielZeile), dokumente, activities, letzteAktivitaet: letzte }
      } else {
        const dokumente: Ordner = {}
        for (const [ordner, liste] of Object.entries(alsOrdner(zielZeile.dokumente))) dokumente[ordner] = Array.isArray(liste) ? liste.filter((d) => !(d && weg.has(d.id))) : liste
        if (weg.size > 0) {
          activities = [eintrag, ...activities]
          const { error: e2 } = await admin.from('objekte').update({ dokumente, activities }).eq('id', zielZeile.id)
          if (e2) return { ok: false, fehler: `Die Dateien liegen wieder unter den ungeklärten Eingängen, ließen sich aber nicht aus dem Objekt nehmen: ${e2.message}. Bitte noch einmal „Rückgängig“ wählen.` }
        }
        const ordner = p.ziel.art === 'objekt' ? p.ziel.ordner : 'Sonstiges'
        ziel = { art: 'objekt', id: zielZeile.id, name: objektName(zielZeile), ordner, dokumente, activities }
      }
    }

    // ---- 3. Vermerken, dass diese Ablage zurückgenommen ist ----
    const zurueck = zurueckDateien.map((f) => f.zielName || anzeigeName(f.original))
    const wiederInListe = uebersprungene.filter((d) => hinein.some((x) => x.id === d.id)).map(anzeigeName)
    const jetzt = new Date().toISOString()
    const { error: markFehler } = await admin
      .from(PROTOKOLL_TABELLE)
      .update({ daten: { ...p, rueckgaengigAm: jetzt, rueckgaengigVon: name, rueckgaengig: { zurueck, wiederInListe, nichtMehrDort } }, updated_at: jetzt })
      .eq('id', kennung)
    if (markFehler) console.error('Rückgängig nicht vermerkt', kennung, markFehler.message)

    return { ok: true, zurueck, wiederInListe, nichtMehrDort, sammelDokumente, ziel }
  } catch (e) {
    return { ok: false, fehler: `Das Rückgängigmachen ist fehlgeschlagen: ${fehlerText(e)}` }
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
