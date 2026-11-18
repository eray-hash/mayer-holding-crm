// Neue Treffer zwischen Gesuchen und Objekten von selbst bemerken und per Telegram melden — ohne
// offenes Browserfenster und ohne Klick. Der Zeitplan ruft `pruefeNeueTreffer` jede Minute; die
// eigentliche Prüfung läuft höchstens alle fünf Minuten.
//
// WICHTIG: Die Abgleich-Regeln hier (pruefe, alleGesuche, passendeObjekte) müssen genau gleich
// bleiben wie in src/lib/gesuche.ts. Dort rechnet der Browser auf den Programm-Daten, hier der
// Server auf den Zeilen der Datenbank. Wer die Regeln an einer Stelle ändert, ändert sie an beiden —
// sonst meldet der Server Treffer, die die Seite „Gesuche“ nicht zeigt (oder umgekehrt).
//
// - Jeder bekannte Treffer ist eine Zeile in `abteilung_eintraege` (art „treffer“, id
//   `treffer|<gesuchId>|<objektId>`). Der Browser liest diese Zeilen nur, er schreibt sie nie.
// - Der allererste Lauf hält alle vorhandenen Treffer still fest und meldet nichts — sonst bekäme
//   jeder auf einen Schlag Dutzende alter Treffer.
// - Gemeldet wird danach nur: ein Paar, das neu passt, und ein Paar, das von „zu prüfen“ zu einem
//   vollständigen Treffer wird. Paare, die nicht mehr passen, verschwinden still.
// - Nie doppelt melden: Die Zeile wird VOR dem Senden angelegt; gibt es sie schon, wird nicht gesendet.

// Der Dienst-Zugang zur Datenbank — wie in objektMail.ts.
// deno-lint-ignore no-explicit-any
type Db = any

export type KundenZeile = {
  id: string
  bereich?: string | null
  firma?: string | null
  ansprechpartner?: string | null
  verantwortlich?: string | null
  /** jsonb: Liste der Gesuche, Feldnamen wie im Browser (objekttypen, lage, budgetMin, budgetMax, erledigt). */
  gesuche?: unknown
  /** jsonb: älteres Käuferprofil (objekttypen, bevorzugteLage, budgetMin, budgetMax). */
  kaeuferprofil?: unknown
}

export type ObjektZeile = {
  id: string
  bezeichnung?: string | null
  adresse?: string | null
  typ?: string | null
  kaufpreis?: number | string | null
  status?: string | null
  verantwortlich?: string | null
  zugewiesener_kunde?: unknown
  verkaufsdaten?: unknown
  activities?: unknown
}

/** So liegt ein Treffer in `abteilung_eintraege.daten` (gleich dem Typ TrefferMeldung in src/types/index.ts). */
export type TrefferMeldung = {
  id: string
  gesuchId: string
  kundeId: string
  objektId: string
  art: 'treffer' | 'pruefen'
  entdecktAm: string
  gemeldetAn: string[]
}

/** Ein aktuell passendes Paar samt allem, was für die Nachricht gebraucht wird. */
export type BerechneterTreffer = {
  id: string
  gesuchId: string
  kundeId: string
  objektId: string
  /** „treffer“ = nichts offen, „pruefen“ = beim Objekt fehlt noch eine Angabe. */
  art: 'treffer' | 'pruefen'
  /** Wortgleich zu `passt` / `offen` in src/lib/gesuche.ts. */
  passt: string[]
  offen: string[]
  /** Dasselbe in Kurzform für die Nachricht („Objektart“, „Lage“, „Preis im Budget“). */
  passtKurz: string[]
  gesuchTitel: string
  kundeName: string
  kundeVerantwortlich: string
  objektBezeichnung: string
  objektVerantwortlich: string
}

export type TrefferErgebnis = { gelaufen: boolean; neu: number; benachrichtigt: number }
export type TrefferOptionen = { jetzt?: Date; ohneTakt?: boolean }
export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>

const TABELLE = 'abteilung_eintraege'
const STAND_ID = 'treffer_stand'
const TAKT_MS = 5 * 60 * 1000
const HOECHSTENS_ZEILEN = 8

// ---------------------------------------------------------------------------------------------
// Abgleich — Abbild von src/lib/gesuche.ts
// ---------------------------------------------------------------------------------------------

type Gesuch = {
  id: string
  titel: string
  objekttypen: string[]
  lage: string
  budgetMin?: number | null
  budgetMax?: number | null
  erledigt?: boolean
}

type Objekt = {
  id: string
  bezeichnung: string
  adresse: string
  typ: string
  kaufpreis: number
  status: string
  zugewiesen: boolean
  verantwortlich: string
  artUngeprueft: boolean
}

// Verkaufte, abgebrochene und archivierte Objekte stehen nicht mehr zur Vermittlung.
const NICHT_VERFUEGBAR = new Set(['verkauft', 'archiv', 'abgebrochen'])

/** Orte eines Gesuchs als einzelne Suchwörter ("Ulm, Neu-Ulm und Umgebung" → ["ulm", "neu-ulm"]). */
function orte(lage: string): string[] {
  return lage
    .toLowerCase()
    .split(/[,;/]|\bund\b|\boder\b/)
    .map((t) => t.replace(/\b(umgebung|raum|region|kreis|landkreis|großraum|nähe|bis)\b/g, '').trim())
    .filter((t) => t.length >= 3)
}

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : wert == null ? '' : String(wert)
}

function alsObjekt(wert: unknown): Record<string, unknown> | null {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : null
}

/** Bei übernommenen Objekten steht im ersten Verlaufseintrag, wenn die Objektart nur ein Platzhalter ist. */
function artUngeprueft(zeile: ObjektZeile): boolean {
  // Sobald im Verkaufsdatenblatt eine Objektart gewählt ist, gilt sie als geprüft.
  if (alsObjekt(alsObjekt(zeile.verkaufsdaten)?.uebersicht)?.objektart) return false
  const verlauf = Array.isArray(zeile.activities) ? zeile.activities : []
  return verlauf.some((a) => {
    const eintrag = alsObjekt(a)
    return !!eintrag && text(eintrag.id).startsWith('a_ql_') && /Noch nicht geprüft:[^.]*Objektart/.test(text(eintrag.text))
  })
}

/** Eine Zeile der Tabelle `objekte` so lesen, wie der Browser sie liest (rowToObjekt in src/lib/crmSync.ts). */
function objektAusZeile(zeile: ObjektZeile): Objekt {
  return {
    id: text(zeile.id),
    bezeichnung: text(zeile.bezeichnung),
    adresse: text(zeile.adresse),
    typ: text(zeile.typ),
    kaufpreis: Number(zeile.kaufpreis),
    status: text(zeile.status),
    zugewiesen: !!zeile.zugewiesener_kunde,
    verantwortlich: text(zeile.verantwortlich),
    artUngeprueft: artUngeprueft(zeile),
  }
}

function gesuchAusJson(wert: unknown): Gesuch | null {
  const g = alsObjekt(wert)
  if (!g) return null
  return {
    id: text(g.id),
    titel: text(g.titel),
    objekttypen: Array.isArray(g.objekttypen) ? g.objekttypen.map(text) : [],
    lage: text(g.lage),
    budgetMin: g.budgetMin as number | null | undefined,
    budgetMax: g.budgetMax as number | null | undefined,
    erledigt: !!g.erledigt,
  }
}

/** Alle Gesuche eines Kontakts. Ein älteres „Käuferprofil“ zählt als ein Gesuch mit. */
function gesucheDesKontakts(kunde: KundenZeile): Gesuch[] {
  const liste: Gesuch[] = []
  for (const roh of Array.isArray(kunde.gesuche) ? kunde.gesuche : []) {
    const g = gesuchAusJson(roh)
    if (g) liste.push(g)
  }
  const p = alsObjekt(kunde.kaeuferprofil)
  if (p) {
    const objekttypen = Array.isArray(p.objekttypen) ? p.objekttypen.map(text) : []
    const lage = text(p.bevorzugteLage)
    if (lage.trim() || objekttypen.length > 0 || p.budgetMin != null || p.budgetMax != null) {
      liste.push({
        id: `kaeuferprofil:${kunde.id}`,
        titel: 'Käuferprofil',
        objekttypen,
        lage,
        budgetMin: p.budgetMin as number | null | undefined,
        budgetMax: p.budgetMax as number | null | undefined,
      })
    }
  }
  return liste
}

/** Prüft ein Objekt gegen ein Gesuch. null = passt nicht. */
function pruefe(gesuch: Gesuch, o: Objekt): { passt: string[]; passtKurz: string[]; offen: string[] } | null {
  if (NICHT_VERFUEGBAR.has(o.status) || o.zugewiesen) return null
  const passt: string[] = []
  const passtKurz: string[] = []
  const offen: string[] = []

  if (gesuch.objekttypen.length > 0) {
    if (o.artUngeprueft) {
      // Aus einem Ordner übernommen, die Objektart ist nur ein Platzhalter: weder Treffer noch Ausschluss.
      offen.push('Objektart beim Objekt noch nicht geprüft')
    } else {
      if (!gesuch.objekttypen.includes(o.typ)) return null
      passt.push(`Objektart ${o.typ}`)
      passtKurz.push('Objektart')
    }
  }

  const suchorte = orte(gesuch.lage)
  if (suchorte.length > 0) {
    const wo = `${o.adresse} ${o.bezeichnung}`.toLowerCase()
    const ort = suchorte.find((t) => wo.includes(t))
    if (!ort) return null
    passt.push(`Lage ${o.adresse || o.bezeichnung}`)
    passtKurz.push('Lage')
  }

  if (gesuch.budgetMin != null || gesuch.budgetMax != null) {
    if (o.kaufpreis > 0) {
      if (gesuch.budgetMin != null && o.kaufpreis < gesuch.budgetMin) return null
      if (gesuch.budgetMax != null && o.kaufpreis > gesuch.budgetMax) return null
      passt.push('Preis im Budget')
      passtKurz.push('Preis im Budget')
    } else {
      offen.push('Kaufpreis beim Objekt nicht hinterlegt')
    }
  }

  // Ein Gesuch ganz ohne Angaben würde auf alles passen — das hilft niemandem.
  if (passt.length === 0) return null
  return { passt, passtKurz, offen }
}

export function trefferId(gesuchId: string, objektId: string): string {
  return `treffer|${gesuchId}|${objektId}`
}

/** Alle Paare aus Gesuch und Objekt, die im Augenblick zusammenpassen. Rechnet nur, liest und
 *  schreibt nichts. Kontakte des Bereichs „privat“ und erledigte Gesuche zählen nicht mit. */
export function berechneTreffer(kundenZeilen: KundenZeile[], objektZeilen: ObjektZeile[]): BerechneterTreffer[] {
  const objekte = objektZeilen.map(objektAusZeile)
  const treffer = new Map<string, BerechneterTreffer>()
  for (const kunde of kundenZeilen) {
    if (kunde.bereich === 'privat') continue
    for (const gesuch of gesucheDesKontakts(kunde)) {
      if (gesuch.erledigt || !gesuch.id) continue
      for (const o of objekte) {
        const t = pruefe(gesuch, o)
        if (!t) continue
        const id = trefferId(gesuch.id, o.id)
        // Sollten zwei Kontakte je ein Gesuch mit derselben Kennung haben, zählt das erste Paar.
        if (treffer.has(id)) continue
        treffer.set(id, {
          id,
          gesuchId: gesuch.id,
          kundeId: text(kunde.id),
          objektId: o.id,
          art: t.offen.length === 0 ? 'treffer' : 'pruefen',
          passt: t.passt,
          offen: t.offen,
          passtKurz: t.passtKurz,
          gesuchTitel: gesuch.titel,
          kundeName: text(kunde.firma).trim() || text(kunde.ansprechpartner).trim(),
          kundeVerantwortlich: text(kunde.verantwortlich),
          objektBezeichnung: o.bezeichnung,
          objektVerantwortlich: o.verantwortlich,
        })
      }
    }
  }
  return [...treffer.values()]
}

// ---------------------------------------------------------------------------------------------
// Nachricht
// ---------------------------------------------------------------------------------------------

export type MeldeEintrag = { treffer: BerechneterTreffer; anlass: 'neu' | 'vollstaendig' }

function kurz(wert: string, laenge = 80): string {
  const sauber = wert.replace(/\s+/g, ' ').trim()
  return sauber.length <= laenge ? sauber : `${sauber.slice(0, laenge - 1).trimEnd()}…`
}

function zeileFuer({ treffer: t, anlass }: MeldeEintrag): string {
  const objekt = `Objekt „${kurz(t.objektBezeichnung) || 'ohne Bezeichnung'}“`
  const gesuch = `Gesuch „${kurz(t.gesuchTitel) || 'ohne Titel'}“${t.kundeName ? ` von ${kurz(t.kundeName, 60)}` : ''}`
  const was = t.passtKurz.length > 0 ? ` (${t.passtKurz.join(', ')})` : ''
  if (anlass === 'vollstaendig') return `• Jetzt vollständiger Treffer: ${objekt} passt zum ${gesuch}${was}`
  if (t.art === 'treffer') return `• ${objekt} passt zum ${gesuch}${was}`
  return `• ${objekt} könnte zum ${gesuch} passen${was} – noch zu prüfen: ${t.offen.join(', ')}`
}

/** Eine Nachricht für eine Person: alle ihre neuen Treffer dieses Laufs, höchstens acht ausgeschrieben. */
export function trefferNachricht(eintraege: MeldeEintrag[]): string {
  // Erst die sicheren Treffer, dann die jetzt vollständigen, zuletzt die noch zu prüfenden.
  const rang = (e: MeldeEintrag) => (e.anlass === 'vollstaendig' ? 1 : e.treffer.art === 'treffer' ? 0 : 2)
  const sortiert = [...eintraege].sort((a, b) => rang(a) - rang(b))
  const zeilen = sortiert.slice(0, HOECHSTENS_ZEILEN).map(zeileFuer)
  const rest = sortiert.length - zeilen.length
  if (rest > 0) zeilen.push(rest === 1 ? '… und 1 weiterer' : `… und ${rest} weitere`)
  const kopf = sortiert.length === 1 ? 'Neuer Treffer in der Immobilienabteilung:' : 'Neue Treffer in der Immobilienabteilung:'
  return `${kopf}\n${zeilen.join('\n')}\n\nAnsehen im CRM unter Immobilien → Gesuche.`
}

// ---------------------------------------------------------------------------------------------
// Datenbank
// ---------------------------------------------------------------------------------------------

/** Liest eine Tabelle vollständig, seitenweise — unabhängig davon, wie viele Zeilen die Datenbank je
 *  Abruf höchstens herausgibt. Ein abgeschnittenes Ergebnis sähe sonst aus wie „passt nicht mehr“. */
// deno-lint-ignore no-explicit-any
async function ladeAlle(admin: Db, tabelle: string, spalten: string, art?: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const alle: any[] = []
  for (;;) {
    let abfrage = admin.from(tabelle).select(spalten)
    if (art) abfrage = abfrage.eq('art', art)
    const { data, error } = await abfrage.order('id').range(alle.length, alle.length + 999)
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    const seite = Array.isArray(data) ? data : []
    if (seite.length === 0) return alle
    alle.push(...seite)
  }
}

type Person = { name: string; chat: number | string }

/** Erreichbare Mitarbeiter (aktiv und mit Telegram verbunden), nach Namen. */
async function ladeErreichbare(admin: Db): Promise<Map<string, Person>> {
  const { data, error } = await admin.from('mitarbeiter').select('name, aktiv, telegram_chat_id')
  if (error) throw new Error(`mitarbeiter: ${error.message}`)
  const team = new Map<string, Person>()
  for (const m of (data ?? []) as { name: string | null; aktiv: boolean | null; telegram_chat_id: number | string | null }[]) {
    const name = text(m.name).trim()
    if (!name || m.aktiv !== true || m.telegram_chat_id == null || m.telegram_chat_id === '') continue
    team.set(name.toLowerCase(), { name, chat: m.telegram_chat_id })
  }
  return team
}

function alsMeldung(daten: unknown): Partial<TrefferMeldung> {
  return alsObjekt(daten) ?? {}
}

function namenListe(wert: unknown): string[] {
  return Array.isArray(wert) ? wert.filter((n): n is string => typeof n === 'string') : []
}

// ---------------------------------------------------------------------------------------------
// Der Lauf
// ---------------------------------------------------------------------------------------------

/** Vom Zeitplan jede Minute gerufen. Kehrt sofort zurück (`gelaufen: false`), solange seit dem
 *  letzten echten Lauf keine fünf Minuten vergangen sind (außer mit `ohneTakt`).
 *  `neu` zählt neu festgehaltene Paare (beim stillen Erststand alle) und Paare, die jetzt vollständig
 *  passen; `benachrichtigt` zählt die tatsächlich zugestellten Nachrichten (eine je Person).
 *  Wirft nie: Fehler der Datenbank stehen im Protokoll, der nächste Lauf versucht es erneut. */
export async function pruefeNeueTreffer(admin: Db, sende: SendeFunktion, optionen?: TrefferOptionen): Promise<TrefferErgebnis> {
  const ergebnis: TrefferErgebnis = { gelaufen: false, neu: 0, benachrichtigt: 0 }
  try {
    await lauf(admin, sende, optionen ?? {}, ergebnis)
  } catch (err) {
    console.error('Treffer-Prüfung (Gesuche und Objekte) fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
  return ergebnis
}

async function lauf(admin: Db, sende: SendeFunktion, optionen: TrefferOptionen, ergebnis: TrefferErgebnis): Promise<void> {
  const jetzt = optionen.jetzt ?? new Date()
  const jetztIso = jetzt.toISOString()

  // ---- Stand lesen, Takt einhalten ----
  const { data: standZeile, error: standFehler } = await admin.from(TABELLE).select('daten').eq('id', STAND_ID).maybeSingle()
  if (standFehler) throw new Error(`Stand nicht lesbar: ${standFehler.message}`)

  if (!standZeile) {
    await erststand(admin, jetztIso, ergebnis)
    return
  }

  const stand = alsObjekt(standZeile.daten) ?? {}
  const letzterLauf = typeof stand.letzterLauf === 'string' ? stand.letzterLauf : null
  if (!optionen.ohneTakt && letzterLauf) {
    const letzter = Date.parse(letzterLauf)
    // Betrag: Ein versehentlich in der Zukunft liegender Zeitpunkt darf die Prüfung nicht für immer anhalten.
    if (Number.isFinite(letzter) && Math.abs(jetzt.getTime() - letzter) < TAKT_MS) return
  }

  // ---- Den Lauf für sich beanspruchen: Nur wer den Zeitpunkt weiterstellt, prüft. Laufen zwei
  //      Aufrufe gleichzeitig, findet der zweite den alten Zeitpunkt nicht mehr vor und hört auf. ----
  let anspruch = admin
    .from(TABELLE)
    .update({ daten: { ...stand, letzterLauf: jetztIso, erststandAm: stand.erststandAm ?? jetztIso }, updated_at: jetztIso })
    .eq('id', STAND_ID)
  if (letzterLauf) anspruch = anspruch.eq('daten->>letzterLauf', letzterLauf)
  const { data: beansprucht, error: anspruchFehler } = await anspruch.select('id')
  if (anspruchFehler) throw new Error(`Stand nicht schreibbar: ${anspruchFehler.message}`)
  if (!Array.isArray(beansprucht) || beansprucht.length === 0) return
  ergebnis.gelaufen = true

  // ---- Alles lesen, bevor irgendetwas geschrieben wird: Schlägt ein Abruf fehl, bleibt alles, wie es ist. ----
  const [kunden, objekte, vorhandeneZeilen, team] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, firma, ansprechpartner, verantwortlich, gesuche, kaeuferprofil'),
    ladeAlle(admin, 'objekte', 'id, bezeichnung, adresse, typ, kaufpreis, status, verantwortlich, zugewiesener_kunde, verkaufsdaten, activities'),
    ladeAlle(admin, TABELLE, 'id, daten', 'treffer'),
    ladeErreichbare(admin),
  ])

  const aktuelle = berechneTreffer(kunden, objekte)
  const aktuelleIds = new Set(aktuelle.map((t) => t.id))
  const vorhandene = new Map<string, Partial<TrefferMeldung>>()
  for (const z of vorhandeneZeilen) vorhandene.set(text(z.id), alsMeldung(z.daten))

  // ---- Neue Paare und Paare, die jetzt vollständig passen: erst festhalten, dann melden ----
  const zuMelden: MeldeEintrag[] = []
  const gespeichert = new Map<string, TrefferMeldung>()
  const stillAbwerten: { id: string; meldung: Partial<TrefferMeldung> }[] = []

  for (const t of aktuelle) {
    const alt = vorhandene.get(t.id)
    if (!alt) {
      const meldung: TrefferMeldung = { id: t.id, gesuchId: t.gesuchId, kundeId: t.kundeId, objektId: t.objektId, art: t.art, entdecktAm: jetztIso, gemeldetAn: [] }
      const { error } = await admin.from(TABELLE).insert({ id: t.id, art: 'treffer', daten: meldung, updated_at: jetztIso })
      if (error) {
        // Gibt es die Zeile schon (ein anderer Lauf war schneller), wird nicht gemeldet. Bei jedem
        // anderen Fehler auch nicht — der nächste Lauf sieht das Paar wieder als neu.
        if (error.code !== '23505') console.error('Treffer nicht speicherbar:', t.id, error.message)
        continue
      }
      ergebnis.neu++
      gespeichert.set(t.id, meldung)
      zuMelden.push({ treffer: t, anlass: 'neu' })
    } else if (alt.art === 'pruefen' && t.art === 'treffer') {
      // Der fehlende Wert ist nachgetragen. Der Zeitpunkt wird neu gesetzt, damit die Seite „Gesuche“
      // das Paar wieder unter „Neue Treffer“ zeigt.
      const meldung: TrefferMeldung = { id: t.id, gesuchId: t.gesuchId, kundeId: t.kundeId, objektId: t.objektId, art: 'treffer', entdecktAm: jetztIso, gemeldetAn: namenListe(alt.gemeldetAn) }
      const { data, error } = await admin.from(TABELLE).update({ daten: meldung, updated_at: jetztIso }).eq('id', t.id).eq('daten->>art', 'pruefen').select('id')
      if (error) {
        console.error('Treffer nicht aktualisierbar:', t.id, error.message)
        continue
      }
      if (!Array.isArray(data) || data.length === 0) continue // ein anderer Lauf hat es schon gemeldet
      ergebnis.neu++
      gespeichert.set(t.id, meldung)
      zuMelden.push({ treffer: t, anlass: 'vollstaendig' })
    } else if (alt.art === 'treffer' && t.art === 'pruefen') {
      stillAbwerten.push({ id: t.id, meldung: alt })
    }
  }

  // ---- Je Person eine Nachricht: wer das Objekt betreut und wer den Kontakt betreut ----
  const jePerson = new Map<string, { person: Person; eintraege: MeldeEintrag[] }>()
  for (const eintrag of zuMelden) {
    const schon = new Set<string>()
    for (const name of [eintrag.treffer.objektVerantwortlich, eintrag.treffer.kundeVerantwortlich]) {
      const person = team.get(name.trim().toLowerCase())
      if (!person) continue
      const schluessel = String(person.chat)
      if (schon.has(schluessel)) continue
      schon.add(schluessel)
      const sammlung = jePerson.get(schluessel) ?? { person, eintraege: [] }
      sammlung.eintraege.push(eintrag)
      jePerson.set(schluessel, sammlung)
    }
  }

  const gemeldet = new Map<string, string[]>()
  for (const { person, eintraege } of jePerson.values()) {
    let zugestellt = false
    try {
      zugestellt = (await sende(person.chat, trefferNachricht(eintraege))) === true
    } catch (err) {
      console.error('Treffer-Nachricht nicht zustellbar:', err instanceof Error ? err.message : err)
    }
    if (!zugestellt) continue
    ergebnis.benachrichtigt++
    for (const e of eintraege) gemeldet.set(e.treffer.id, [...(gemeldet.get(e.treffer.id) ?? []), person.name])
  }

  // ---- Festhalten, wer Bescheid bekommen hat ----
  for (const [id, namen] of gemeldet) {
    const meldung = gespeichert.get(id)
    if (!meldung) continue
    const gemeldetAn = [...new Set([...meldung.gemeldetAn, ...namen])]
    const { error } = await admin.from(TABELLE).update({ daten: { ...meldung, gemeldetAn }, updated_at: jetztIso }).eq('id', id)
    if (error) console.error('Empfänger am Treffer nicht vermerkbar:', id, error.message)
  }

  // ---- Still nachführen: Beim Objekt fehlt wieder eine Angabe (z. B. Kaufpreis gelöscht) ----
  for (const { id, meldung } of stillAbwerten) {
    const { error } = await admin.from(TABELLE).update({ daten: { ...meldung, art: 'pruefen' }, updated_at: jetztIso }).eq('id', id).eq('daten->>art', 'treffer')
    if (error) console.error('Treffer nicht aktualisierbar:', id, error.message)
  }

  // ---- Paare, die nicht mehr passen, verschwinden ----
  for (const id of vorhandene.keys()) {
    if (aktuelleIds.has(id)) continue
    const { error } = await admin.from(TABELLE).delete().eq('id', id).eq('art', 'treffer')
    if (error) console.error('Treffer nicht löschbar:', id, error.message)
  }
}

/** Der allererste Lauf: alle vorhandenen Treffer still festhalten, niemanden benachrichtigen. */
async function erststand(admin: Db, jetztIso: string, ergebnis: TrefferErgebnis): Promise<void> {
  const [kunden, objekte, vorhandeneZeilen] = await Promise.all([
    ladeAlle(admin, 'kunden', 'id, bereich, firma, ansprechpartner, verantwortlich, gesuche, kaeuferprofil'),
    ladeAlle(admin, 'objekte', 'id, bezeichnung, adresse, typ, kaufpreis, status, verantwortlich, zugewiesener_kunde, verkaufsdaten, activities'),
    ladeAlle(admin, TABELLE, 'id, daten', 'treffer'),
  ])

  // Liegen schon Zeilen vor (ein früherer Erststand brach mittendrin ab), bekommen die fehlenden
  // denselben Zeitpunkt — die Seite „Gesuche“ erkennt den Erststand am gemeinsamen ältesten Zeitpunkt.
  const schonDa = new Set<string>()
  let zeitpunkt = jetztIso
  for (const z of vorhandeneZeilen) {
    schonDa.add(text(z.id))
    const entdeckt = alsMeldung(z.daten).entdecktAm
    if (typeof entdeckt === 'string' && Number.isFinite(Date.parse(entdeckt)) && Date.parse(entdeckt) < Date.parse(zeitpunkt)) zeitpunkt = entdeckt
  }

  const fehlende = berechneTreffer(kunden, objekte)
    .filter((t) => !schonDa.has(t.id))
    .map((t) => {
      const meldung: TrefferMeldung = { id: t.id, gesuchId: t.gesuchId, kundeId: t.kundeId, objektId: t.objektId, art: t.art, entdecktAm: zeitpunkt, gemeldetAn: [] }
      return { id: t.id, art: 'treffer', daten: meldung, updated_at: jetztIso }
    })
  for (let i = 0; i < fehlende.length; i += 200) {
    const { error } = await admin.from(TABELLE).upsert(fehlende.slice(i, i + 200), { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(`Erststand nicht speicherbar: ${error.message}`)
  }

  // Erst wenn alles festgehalten ist, gilt der Erststand als gemacht. Bricht der Lauf vorher ab,
  // wiederholt ihn der nächste Aufruf still — und niemand bekommt die alten Treffer gemeldet.
  const { error } = await admin.from(TABELLE).insert({ id: STAND_ID, art: STAND_ID, daten: { letzterLauf: jetztIso, erststandAm: jetztIso }, updated_at: jetztIso })
  if (error && error.code !== '23505') throw new Error(`Stand nicht speicherbar: ${error.message}`)
  ergebnis.gelaufen = true
  ergebnis.neu = fehlende.length
}
