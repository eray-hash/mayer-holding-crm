// Rechnungsvorschläge „Nie vergessen, eine Rechnung zu stellen“ (22.11.2026). Reines Rechnen ohne Datenbank,
// ohne Browser und ohne Abhängigkeiten außer _shared/umsatzKern.ts — dieselbe Datei nutzen der Minutentakt
// (email-gateway/rechnungVorschlaege.ts), der Assistent (telegram-gateway/rechnungVorschlagWerkzeug.ts) und
// das CRM (src/components/rechnungen/RechnungVorschlaege.tsx).
//
// ─── Wann ein Vorschlag entsteht (Tabelle rechnung_vorschlaege, Schlüssel = id) ────────────────────
// kv:<kvId>              Kostenvoranschlag „angenommen“, nicht privat, und es gibt keine Rechnung mit dieser kv_id.
//                        Positionen = die des Kostenvoranschlags (Auf-/Abschlag eingerechnet, wie die Übernahme im
//                        Rechnungsformular), sonst eine Pauschale über den Nettobetrag.
// akte:<kundeId>         Akte im Stand „Leistung erbracht / Rechnung gestellt“ (Unternehmensberatung) oder
//                        „Abgeschlossen“ (Beratung, Erben, Betriebsübergabe, Betriebsformen, Akademie), und es gibt
//                        für diese Akte noch gar keine Rechnung. Nicht bei Finanzierungen (Investoren bekommen keine
//                        Rechnung), Immobilien-Kunden (dort zählt die Provision am Objekt), privaten Akten und den
//                        Sammelakten. Nicht, wenn die Akte einen angenommenen oder bezahlten Kostenvoranschlag hat
//                        (dafür gibt es den kv-Vorschlag bzw. er ist erledigt) oder eine Seminarteilnahme (dafür
//                        gibt es den seminar-Vorschlag). Positionen: geschätzter Umsatz der Projekt-Checkliste
//                        (auftrag_chance.umsatzNetto) als Pauschale, sonst die Dienstleistungen der Akte mit dem
//                        Preis aus der Preisliste (Stundensatz, sonst Tagessatz, jeweils der untere Wert, Menge 1 —
//                        wie im Positionen-Editor), sonst eine leere Position zum Ausfüllen.
// seminar:<anmeldungId>  Seminaranmeldung „teilgenommen“ ohne rechnung_id. Preis = Preis des Termins, sonst
//                        Katalogpreis (netto).
// provision:<objektId>   Objekt ab „Beurkundet“ (auch Fälligkeitsmitteilung, Kaufpreis gezahlt, Besitzübergang,
//                        Verkauft), nicht privat, mit BEKANNTER Provision (umsatzKern.provisionFuerObjekt ohne
//                        Annahme und mit Betrag: Abrechnung, Kurzprüfung oder Provisionstext der Freigabe).
//                        Kunde = zugewiesener Kunde des Objekts, sonst die einzige zugestimmte Freigabe mit Akte.
//
// ─── Lebenslauf ───────────────────────────────────────────────────────────────────────────────────
// offen → erstellt (Rechnung angelegt: im CRM per Knopf, oder automatisch erkannt: Rechnung mit kv_id, Rechnung
// für die Akte, rechnung_id an der Anmeldung) oder verworfen (von Hand). Erstellt und verworfen bleiben für immer —
// derselbe Anlass schlägt nie wieder vor. Ein offener Vorschlag, dessen Anlass wegfällt (Kostenvoranschlag nicht
// mehr angenommen, Akte wieder geöffnet …), wird gelöscht; ändern sich Betrag oder Positionen, wird er angepasst.
// Alle Beträge NETTO.

import { provisionFuerObjekt, runde2, type ObjektEingabe } from './umsatzKern.ts'

// ─── Stellschrauben ────────────────────────────────────────────────────────────────────────────────

/** Stände einer Akte, ab denen eine Rechnung fällig ist — je Kundenakten-Schlüssel (kunden.bereich). */
export const AKTE_RECHNUNG_STAENDE: Record<string, readonly string[]> = {
  beratung: ['rechnung_gestellt', 'abgeschlossen'],
  erben: ['abgeschlossen'],
  betriebsuebergabe: ['abgeschlossen'],
  betriebsformen: ['abgeschlossen'],
  akademie: ['abgeschlossen'],
}

/** Stände eines Objekts, ab denen die Provision in Rechnung gestellt werden kann. */
export const PROVISION_STAENDE: readonly string[] = ['beurkundet', 'faelligkeitsmitteilung', 'kaufpreis_gezahlt', 'besitzuebergang', 'verkauft']

export const SAMMELAKTEN_IDS: readonly string[] = ['k_intern_holding', 'k_eingang_ungeklaert']

export const STANDARD_UST = 19

// ─── Typen ─────────────────────────────────────────────────────────────────────────────────────────

export type VorschlagArt = 'kv' | 'akte' | 'seminar' | 'provision'
export type VorschlagStatus = 'offen' | 'erstellt' | 'verworfen'

export type VorschlagPosition = { bezeichnung: string; menge: number; einheit: string; einzelpreis: number; leistungId?: string }

/** Ein Vorschlag, wie er nach den Regeln sein soll (ohne Status). */
export type SollVorschlag = {
  id: string
  art: VorschlagArt
  kunde_id: string | null
  kunde_bereich: string | null
  kv_id: string | null
  anmeldung_id: string | null
  objekt_id: string | null
  titel: string
  positionen: VorschlagPosition[]
  betrag_netto: number | null
  ust_satz: number
  grund: string
}

/** Eine Zeile der Tabelle rechnung_vorschlaege. */
export type VorschlagZeile = SollVorschlag & {
  status: VorschlagStatus
  rechnung_id: string | null
  erledigt_am?: string | null
  erledigt_von?: string | null
  erstellt_am?: string | null
}

export type AkteDaten = {
  id: string
  bereich: string
  name: string
  status: string
  dienstleistungen?: string[] | null
  umsatzNetto?: number | null
}

export type KvDaten = {
  id: string
  kundeId: string | null
  bereich: string | null
  privat: boolean
  name: string
  beschreibung?: string | null
  status: string
  betrag?: number | null
  positionen?: { bezeichnung?: string; menge?: number; einheit?: string; einzelpreis?: number; leistungId?: string }[] | null
  aufschlagProzent?: number | null
  ustSatz?: number | null
}

export type AnmeldungDaten = {
  id: string
  kundeId: string | null
  name: string
  firma?: string | null
  status: string
  rechnungId: string | null
  seminarTitel: string
  /** Preis des Termins, sonst Katalogpreis (netto); undefined = keiner hinterlegt. */
  preisNetto?: number | null
  /** Beginn des Termins (ISO). */
  beginn?: string | null
}

export type ObjektDaten = ObjektEingabe & {
  privatBesitzer?: string | null
  /** Zugewiesener Kunde des Objekts. */
  kunde?: { id: string; bereich: string } | null
  /** Zugestimmte Freigaben mit Akte (Käuferseite). */
  zugestimmteKunden?: { id: string; bereich: string }[]
}

export type PreislistenEintrag = { id: string; bezeichnung: string; preis_stunde_von: number | null; preis_tag_von: number | null }

export type RechnungKurz = { id: string; kundeId: string | null; kvId: string | null }

export type VorschlagEingabe = {
  akten: AkteDaten[]
  angebote: KvDaten[]
  anmeldungen: AnmeldungDaten[]
  objekte: ObjektDaten[]
  rechnungen: RechnungKurz[]
  preisliste: PreislistenEintrag[]
  /** Namen der Akten (für Titel), auch für Akten, die nicht in `akten` stehen. */
  aktenNamen?: Map<string, { name: string; bereich: string }>
}

// ─── Hilfen ────────────────────────────────────────────────────────────────────────────────────────

export const ART_NAME: Record<VorschlagArt, string> = {
  kv: 'Kostenvoranschlag',
  akte: 'Auftrag erledigt',
  seminar: 'Seminar',
  provision: 'Provision',
}

function zahl(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function euroCent(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

export function summeNetto(positionen: VorschlagPosition[]): number {
  return runde2(positionen.reduce((s, p) => s + runde2(zahl(p.menge) * zahl(p.einzelpreis)), 0))
}

function datumDeutsch(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Positionen aus einem Kostenvoranschlag: Auf-/Abschlag in den Einzelpreis eingerechnet (wie preisMitAufschlag im CRM). */
export function positionenAusKv(kv: KvDaten): VorschlagPosition[] {
  const auf = zahl(kv.aufschlagProzent)
  if (Array.isArray(kv.positionen) && kv.positionen.length > 0) {
    return kv.positionen.map((p) => ({
      bezeichnung: String(p.bezeichnung ?? '').trim() || kv.name || 'Leistung',
      menge: zahl(p.menge) || 1,
      einheit: String(p.einheit ?? '').trim() || 'Pauschal',
      einzelpreis: runde2(zahl(p.einzelpreis) * (1 + auf / 100)),
      ...(p.leistungId ? { leistungId: p.leistungId } : {}),
    }))
  }
  // Ohne Positionen: Betrag als Pauschale; mit Steuersatz ist der Betrag brutto (wie umsatzKern.angebotNetto).
  const betrag = kv.betrag === null || kv.betrag === undefined ? 0 : zahl(kv.betrag)
  const netto = kv.ustSatz !== null && kv.ustSatz !== undefined ? runde2(betrag / (1 + zahl(kv.ustSatz) / 100)) : betrag
  return [{ bezeichnung: String(kv.beschreibung ?? '').trim() || kv.name || 'Leistung laut Kostenvoranschlag', menge: 1, einheit: 'Pauschal', einzelpreis: runde2(netto) }]
}

/** Positionen für eine erledigte Akte ohne Kostenvoranschlag. */
export function positionenFuerAkte(a: AkteDaten, preisliste: PreislistenEintrag[]): { positionen: VorschlagPosition[]; woher: string } {
  const dienste = (a.dienstleistungen ?? []).map((d) => String(d ?? '').trim()).filter(Boolean)
  const umsatz = zahl(a.umsatzNetto)
  if (umsatz > 0) {
    return {
      positionen: [{ bezeichnung: dienste.length ? dienste.join(', ') : 'Leistung laut Auftrag', menge: 1, einheit: 'Pauschal', einzelpreis: runde2(umsatz) }],
      woher: 'Betrag aus dem geschätzten Umsatz der Projekt-Checkliste — bitte prüfen.',
    }
  }
  const ausListe: VorschlagPosition[] = []
  for (const d of dienste) {
    const l = preisliste.find((x) => x.bezeichnung.trim().toLowerCase() === d.toLowerCase())
    if (l && (l.preis_stunde_von !== null || l.preis_tag_von !== null)) {
      const stunde = l.preis_stunde_von !== null && l.preis_stunde_von !== undefined
      ausListe.push({ bezeichnung: l.bezeichnung, menge: 1, einheit: stunde ? 'Stunde' : 'Tag', einzelpreis: zahl(stunde ? l.preis_stunde_von : l.preis_tag_von), leistungId: l.id })
    } else {
      ausListe.push({ bezeichnung: d, menge: 1, einheit: 'Pauschal', einzelpreis: 0 })
    }
  }
  if (ausListe.length) {
    return { positionen: ausListe, woher: 'Positionen aus den Dienstleistungen der Akte mit Preisen aus der Preisliste — Menge und Preis bitte prüfen.' }
  }
  return { positionen: [{ bezeichnung: 'Leistung laut Auftrag', menge: 1, einheit: 'Pauschal', einzelpreis: 0 }], woher: 'Kein Betrag hinterlegt — bitte Positionen und Preise eintragen.' }
}

// ─── Regeln ────────────────────────────────────────────────────────────────────────────────────────

/** Alle Vorschläge, die es nach den Regeln geben soll. */
export function sollVorschlaege(e: VorschlagEingabe): SollVorschlag[] {
  const aus: SollVorschlag[] = []
  const namen = e.aktenNamen ?? new Map<string, { name: string; bereich: string }>()
  for (const a of e.akten) if (!namen.has(a.id)) namen.set(a.id, { name: a.name, bereich: a.bereich })
  const kvMitRechnung = new Set(e.rechnungen.map((r) => r.kvId).filter(Boolean) as string[])
  const akteMitRechnung = new Set(e.rechnungen.map((r) => r.kundeId).filter(Boolean) as string[])
  const akteName = (id: string | null) => (id ? namen.get(id)?.name : undefined)
  const akteBereich = (id: string | null) => (id ? namen.get(id)?.bereich ?? null : null)

  // (1) Angenommene Kostenvoranschläge ohne Rechnung.
  for (const kv of e.angebote) {
    if (kv.status !== 'angenommen' || kv.privat || kv.bereich === 'privat') continue
    if (kvMitRechnung.has(kv.id)) continue
    if (kv.kundeId && akteBereich(kv.kundeId) === 'privat') continue
    const positionen = positionenAusKv(kv)
    const titel = [kv.name, kv.beschreibung].map((x) => String(x ?? '').trim()).filter(Boolean).join(' – ') || 'Kostenvoranschlag'
    aus.push({
      id: `kv:${kv.id}`,
      art: 'kv',
      kunde_id: kv.kundeId,
      kunde_bereich: akteBereich(kv.kundeId) ?? kv.bereich ?? null,
      kv_id: kv.id,
      anmeldung_id: null,
      objekt_id: null,
      titel,
      positionen,
      betrag_netto: summeNetto(positionen),
      ust_satz: kv.ustSatz !== null && kv.ustSatz !== undefined ? zahl(kv.ustSatz) : STANDARD_UST,
      grund: `Kostenvoranschlag „${titel}“${akteName(kv.kundeId) ? ` (${akteName(kv.kundeId)})` : ''} ist angenommen, aber noch nicht in Rechnung gestellt.`,
    })
  }

  // (2) Akten, deren Auftrag erledigt ist, ohne jede Rechnung.
  const akteMitKv = new Set(e.angebote.filter((k) => (k.status === 'angenommen' || k.status === 'bezahlt') && k.kundeId).map((k) => k.kundeId as string))
  const akteMitSeminar = new Set(e.anmeldungen.filter((x) => x.status === 'teilgenommen' && x.kundeId).map((x) => x.kundeId as string))
  for (const a of e.akten) {
    const staende = AKTE_RECHNUNG_STAENDE[a.bereich]
    if (!staende || !staende.includes(a.status)) continue
    if (SAMMELAKTEN_IDS.includes(a.id)) continue
    if (akteMitRechnung.has(a.id) || akteMitKv.has(a.id) || akteMitSeminar.has(a.id)) continue
    const { positionen, woher } = positionenFuerAkte(a, e.preisliste)
    const betrag = summeNetto(positionen)
    const stand = a.status === 'rechnung_gestellt' ? '„Leistung erbracht / Rechnung gestellt“' : '„Abgeschlossen“'
    aus.push({
      id: `akte:${a.id}`,
      art: 'akte',
      kunde_id: a.id,
      kunde_bereich: a.bereich,
      kv_id: null,
      anmeldung_id: null,
      objekt_id: null,
      titel: positionen.length === 1 ? positionen[0].bezeichnung : `${positionen.length} Leistungen`,
      positionen,
      betrag_netto: betrag > 0 ? betrag : null,
      ust_satz: STANDARD_UST,
      grund: `Akte ${a.name} steht auf ${stand}, es gibt aber noch keine Rechnung. ${woher}`,
    })
  }

  // (3) Seminarteilnahmen ohne Rechnung.
  for (const t of e.anmeldungen) {
    if (t.status !== 'teilgenommen' || t.rechnungId) continue
    if (t.kundeId && akteBereich(t.kundeId) === 'privat') continue
    const preis = t.preisNetto === null || t.preisNetto === undefined ? 0 : zahl(t.preisNetto)
    const datum = datumDeutsch(t.beginn)
    const wer = [t.name, t.firma].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ')
    const positionen: VorschlagPosition[] = [{ bezeichnung: `Seminar „${t.seminarTitel}“${datum ? ` am ${datum}` : ''}${wer ? ` — Teilnahme ${wer}` : ''}`, menge: 1, einheit: 'Teilnahme', einzelpreis: runde2(preis) }]
    aus.push({
      id: `seminar:${t.id}`,
      art: 'seminar',
      kunde_id: t.kundeId,
      kunde_bereich: akteBereich(t.kundeId) ?? (t.kundeId ? 'akademie' : null),
      kv_id: null,
      anmeldung_id: t.id,
      objekt_id: null,
      titel: `Seminar „${t.seminarTitel}“${datum ? ` am ${datum}` : ''}`,
      positionen,
      betrag_netto: preis > 0 ? runde2(preis) : null,
      ust_satz: STANDARD_UST,
      grund: `${wer || 'Ein Teilnehmer'} hat am Seminar „${t.seminarTitel}“${datum ? ` am ${datum}` : ''} teilgenommen, es gibt aber noch keine Rechnung.${preis > 0 ? '' : ' Kein Preis hinterlegt — bitte eintragen.'}${t.kundeId ? '' : ' Ohne Akte — bitte beim Anlegen den Kunden wählen.'}`,
    })
  }

  // (4) Provision nach der Beurkundung, wenn sie bekannt ist.
  for (const o of e.objekte) {
    if (!PROVISION_STAENDE.includes(o.status) || o.privatBesitzer || o.privat) continue
    const p = provisionFuerObjekt(o)
    if (p.annahme || p.betrag === undefined || !(p.betrag > 0)) continue
    const kunde = o.kunde?.id ? o.kunde : o.zugestimmteKunden?.length === 1 ? o.zugestimmteKunden[0] : null
    const kundeName = kunde ? akteName(kunde.id) : undefined
    const positionen: VorschlagPosition[] = [{ bezeichnung: `Maklerprovision ${o.name}`, menge: 1, einheit: 'Pauschal', einzelpreis: runde2(p.betrag) }]
    aus.push({
      id: `provision:${o.id}`,
      art: 'provision',
      kunde_id: kunde?.id ?? null,
      kunde_bereich: kunde?.bereich ?? null,
      kv_id: null,
      anmeldung_id: null,
      objekt_id: o.id,
      titel: `Provision ${o.name}`,
      positionen,
      betrag_netto: runde2(p.betrag),
      ust_satz: STANDARD_UST,
      grund: `Objekt ${o.name} ist beurkundet — Provision ${euroCent(runde2(p.betrag))} netto (${p.quelle}).${kunde ? (kundeName ? ` Rechnung an ${kundeName}?` : '') : ' Kunde unklar — bitte beim Anlegen wählen.'}`,
    })
  }
  return aus
}

// ─── Abgleich mit der Tabelle ──────────────────────────────────────────────────────────────────────

export type Abgleich = {
  neu: SollVorschlag[]
  /** id → geänderte Felder (nur offene Vorschläge). */
  aendern: { id: string; felder: Partial<SollVorschlag> }[]
  /** Offene Vorschläge, für die inzwischen eine Rechnung da ist. */
  erledigt: { id: string; rechnungId: string }[]
  /** Offene Vorschläge ohne Anlass mehr. */
  entfernen: string[]
}

const VERGLEICHS_FELDER: (keyof SollVorschlag)[] = ['kunde_id', 'kunde_bereich', 'titel', 'positionen', 'betrag_netto', 'ust_satz', 'grund']

function gleich(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * Vergleicht Soll mit den vorhandenen Zeilen (alle offenen plus die mit den ids aus `soll`).
 * `rechnungFuer` sagt für einen offenen Vorschlag, ob es inzwischen eine Rechnung gibt (id der Rechnung).
 */
export function gleicheAb(soll: SollVorschlag[], vorhanden: Pick<VorschlagZeile, 'id' | 'status' | keyof SollVorschlag>[], rechnungFuer: (z: Pick<VorschlagZeile, 'id' | 'art' | 'kunde_id' | 'kv_id' | 'anmeldung_id'>) => string | undefined): Abgleich {
  const ergebnis: Abgleich = { neu: [], aendern: [], erledigt: [], entfernen: [] }
  const jeId = new Map(vorhanden.map((z) => [z.id, z]))
  const sollIds = new Set(soll.map((s) => s.id))
  for (const s of soll) {
    const z = jeId.get(s.id)
    if (!z) {
      ergebnis.neu.push(s)
      continue
    }
    if (z.status !== 'offen') continue
    const felder: Partial<SollVorschlag> = {}
    for (const f of VERGLEICHS_FELDER) if (!gleich(z[f], s[f])) (felder as Record<string, unknown>)[f] = s[f]
    if (Object.keys(felder).length) ergebnis.aendern.push({ id: s.id, felder })
  }
  for (const z of vorhanden) {
    if (z.status !== 'offen' || sollIds.has(z.id)) continue
    const r = rechnungFuer(z)
    if (r) ergebnis.erledigt.push({ id: z.id, rechnungId: r })
    else ergebnis.entfernen.push(z.id)
  }
  return ergebnis
}

// ─── Texte ─────────────────────────────────────────────────────────────────────────────────────────

/** „1 Rechnung ist fällig zu stellen“ / „3 Rechnungen sind fällig zu stellen“. */
export function faelligSatz(n: number): string {
  return n === 1 ? '1 Rechnung ist fällig zu stellen' : `${n} Rechnungen sind fällig zu stellen`
}

/** Link auf die Rechnungen-Seite, wahlweise mit einem Vorschlag geöffnet. */
export function vorschlagLink(basis: string, id?: string): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  return `${b}#/beratung/rechnungen${id ? `?vorschlag=${encodeURIComponent(id)}` : ''}`
}

/** Eine Zeile je Vorschlag (für Telegram). */
export function vorschlagZeile(v: Pick<VorschlagZeile, 'art' | 'titel' | 'betrag_netto'>, akteName?: string): string {
  const betrag = v.betrag_netto !== null && v.betrag_netto !== undefined && Number(v.betrag_netto) > 0 ? `${euroCent(Number(v.betrag_netto))} netto` : 'Betrag offen'
  return `${ART_NAME[v.art]}: ${v.titel}${akteName ? ` — ${akteName}` : ''} — ${betrag}`
}
