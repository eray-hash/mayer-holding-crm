// Dubletten finden — Laden aus der Datenbank (22.11.2026). Gemeinsam für die Aktion `dubletten` im
// email-gateway (Seite „Dubletten“) und das Werkzeug dubletten_finden des Assistenten. Erkennung selbst:
// dublettenKern.ts (rein). Alle Lesevorgänge seitenweise (Supabase liefert höchstens 1000 Zeilen).

import { type AkteFuerDubletten, type DublettenGruppe, findeAktenDubletten, findeObjektDubletten, type ObjektFuerDubletten } from './dublettenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

/** „Keine Dublette“ gemerkt: id = `${art}:${paarSchluessel}`. */
export const AUSNAHMEN_TABELLE = 'dubletten_ausnahmen'

const SEITE = 1000

/** Alle Zeilen einer Tabelle, seitenweise nach dem Schlüssel (Vorgabe id; Schlüssel-Blättern). */
export async function alleZeilen(db: Db, tabelle: string, spalten: string, filter?: (q: Db) => Db, schluessel = 'id'): Promise<Zeile[]> {
  const aus: Zeile[] = []
  let letzte: string | null = null
  for (let runde = 0; runde < 200; runde++) {
    let q = db.from(tabelle).select(spalten)
    if (filter) q = filter(q)
    if (letzte !== null) q = q.gt(schluessel, letzte)
    const { data, error } = await q.order(schluessel, { ascending: true }).limit(SEITE)
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    const zeilen = (data ?? []) as Zeile[]
    aus.push(...zeilen)
    if (zeilen.length < SEITE) break
    letzte = String(zeilen[zeilen.length - 1][schluessel])
  }
  return aus
}

export const AKTEN_SPALTEN = 'id, bereich, firma, ansprechpartner, email, telefon, anschrift, branche, status, prioritaet, verantwortlich, verantwortlich_email, letzte_aktivitaet, updated_at, verknuepfte_kunden'
export const OBJEKT_SPALTEN = 'id, bezeichnung, adresse, typ, status, kaufpreis, verantwortlich, privat_besitzer, verkaufsdaten, updated_at'

export function alsAkte(z: Zeile): AkteFuerDubletten {
  const verknuepft = Array.isArray(z.verknuepfte_kunden) ? (z.verknuepfte_kunden as Zeile[]).map((v) => String(v?.id ?? '')).filter(Boolean) : []
  return { id: String(z.id), bereich: String(z.bereich ?? ''), firma: z.firma, ansprechpartner: z.ansprechpartner, email: z.email, telefon: z.telefon, anschrift: z.anschrift, verknuepft }
}

export function alsObjekt(z: Zeile): ObjektFuerDubletten {
  const ue = z.verkaufsdaten?.uebersicht
  const weitere = ue ? [`${ue.strasse ?? ''} ${ue.plzOrt ?? ''}`.trim()] : []
  return { id: String(z.id), bezeichnung: z.bezeichnung, adresse: z.adresse, weitereAdressen: weitere, privat_besitzer: z.privat_besitzer }
}

export type DublettenLage = {
  kunden: DublettenGruppe[]
  objekte: DublettenGruppe[]
  akten: Map<string, Zeile>
  objektZeilen: Map<string, Zeile>
  ausnahmen: number
}

/** Lädt Akten, Objekte und gemerkte Ausnahmen und sucht Dubletten. Fehlt die Ausnahmen-Tabelle noch, gilt sie als leer. */
export async function findeDublettenInDb(db: Db, opt: { kunden?: boolean; objekte?: boolean } = {}): Promise<DublettenLage> {
  const mitKunden = opt.kunden !== false
  const mitObjekten = opt.objekte !== false
  const [aktenZeilen, objektZeilen, ausnahmeZeilen] = await Promise.all([
    mitKunden ? alleZeilen(db, 'kunden', AKTEN_SPALTEN, (q) => q.neq('bereich', 'privat')) : Promise.resolve([]),
    mitObjekten ? alleZeilen(db, 'objekte', OBJEKT_SPALTEN) : Promise.resolve([]),
    alleZeilen(db, AUSNAHMEN_TABELLE, 'id').catch(() => [] as Zeile[]),
  ])
  const ausnahmen = { kunde: new Set<string>(), objekt: new Set<string>() }
  for (const z of ausnahmeZeilen) {
    const [art, ...rest] = String(z.id).split(':')
    if (art === 'kunde' || art === 'objekt') ausnahmen[art].add(rest.join(':'))
  }
  return {
    kunden: mitKunden ? findeAktenDubletten(aktenZeilen.map(alsAkte), { ausnahmen: ausnahmen.kunde }) : [],
    objekte: mitObjekten ? findeObjektDubletten(objektZeilen.map(alsObjekt), { ausnahmen: ausnahmen.objekt }) : [],
    akten: new Map(aktenZeilen.map((z) => [String(z.id), z])),
    objektZeilen: new Map(objektZeilen.map((z) => [String(z.id), z])),
    ausnahmen: ausnahmeZeilen.length,
  }
}

export type AktenZaehler = {
  dokumente: number
  verlauf: number
  rechnungen: number
  protokolle: number
  termine: number
  mails: number
  wiedervorlagen: number
  kostenvoranschlaege: number
}

export type ObjektZaehler = { dokumente: number; verlauf: number; besichtigungen: number; anfragen: number; vorschlaege: number }

async function zaehleJe(db: Db, tabelle: string, spalte: string, ids: string[], schluessel = 'id'): Promise<Map<string, number>> {
  const zaehler = new Map<string, number>()
  if (ids.length === 0) return zaehler
  try {
    const zeilen = await alleZeilen(db, tabelle, schluessel === spalte ? spalte : `${schluessel}, ${spalte}`, (q) => q.in(spalte, ids), schluessel)
    for (const z of zeilen) zaehler.set(String(z[spalte]), (zaehler.get(String(z[spalte])) ?? 0) + 1)
  } catch {
    // Zählen ist nur zur Anzeige da; eine fehlende Tabelle soll die Liste nicht verhindern.
  }
  return zaehler
}

function laenge(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/** Zahlen für den Vergleich nebeneinander: Dokumente, Verlauf, Rechnungen, Protokolle, Termine, Mails … */
export async function zaehleAkten(db: Db, ids: string[]): Promise<Record<string, AktenZaehler>> {
  const aus: Record<string, AktenZaehler> = {}
  if (ids.length === 0) return aus
  const [listen, rechnungen, protokolle, termine, gesendet, eingang, wv, kv] = await Promise.all([
    alleZeilen(db, 'kunden', 'id, dokumente, activities', (q) => q.in('id', ids)),
    zaehleJe(db, 'rechnungen', 'kunde_id', ids),
    zaehleJe(db, 'protokolle', 'kunde_id', ids),
    zaehleJe(db, 'termine', 'kunde_id', ids),
    zaehleJe(db, 'gesendete_emails', 'kunde_id', ids),
    zaehleJe(db, 'eingegangene_emails', 'zugewiesener_kunde_id', ids),
    zaehleJe(db, 'wiedervorlagen', 'kunde_id', ids),
    zaehleJe(db, 'kostenvoranschlaege', 'kunde_id', ids),
  ])
  const nachId = new Map(listen.map((z) => [String(z.id), z]))
  for (const id of ids) {
    const z = nachId.get(id)
    aus[id] = {
      dokumente: laenge(z?.dokumente),
      verlauf: laenge(z?.activities),
      rechnungen: rechnungen.get(id) ?? 0,
      protokolle: protokolle.get(id) ?? 0,
      termine: termine.get(id) ?? 0,
      mails: (gesendet.get(id) ?? 0) + (eingang.get(id) ?? 0),
      wiedervorlagen: wv.get(id) ?? 0,
      kostenvoranschlaege: kv.get(id) ?? 0,
    }
  }
  return aus
}

export async function zaehleObjekte(db: Db, ids: string[]): Promise<Record<string, ObjektZaehler>> {
  const aus: Record<string, ObjektZaehler> = {}
  if (ids.length === 0) return aus
  const [listen, besichtigungen, anfragen, vorschlaege] = await Promise.all([
    alleZeilen(db, 'objekte', 'id, dokumente, activities', (q) => q.in('id', ids)),
    zaehleJe(db, 'besichtigungen', 'objekt_id', ids),
    zaehleJe(db, 'objekt_anfragen', 'objekt_id', ids, 'email_id'),
    zaehleJe(db, 'objekt_vorschlaege', 'objekt_id', ids),
  ])
  const nachId = new Map(listen.map((z) => [String(z.id), z]))
  for (const id of ids) {
    const z = nachId.get(id)
    aus[id] = {
      dokumente: laenge(z?.dokumente),
      verlauf: laenge(z?.activities),
      besichtigungen: besichtigungen.get(id) ?? 0,
      anfragen: anfragen.get(id) ?? 0,
      vorschlaege: vorschlaege.get(id) ?? 0,
    }
  }
  return aus
}
