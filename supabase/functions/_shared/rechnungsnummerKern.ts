// Rechnungsnummern nach Vorgabe der Geschäftsführung (24.11.2026) — eine reine Funktion für das CRM
// (src/components/rechnungen/RechnungFormular.tsx) und den Assistenten (telegram-gateway/rechnungErstellen.ts).
// Keine Importe, damit Browser (Vite) und Deno dieselbe Datei nutzen.
//
// Schema: <Initialen><Unterscheidung>-<laufende Nummer je Kunde>, z. B. „Lukas Spring“ → LSA-001, LSA-002;
// ein zweiter Kunde mit denselben Initialen („Lea Sommer“) → LSB-001.
//  - Initialen: Vorname + Nachname (Großbuchstaben, Ä→A, ß→S, Akzente weg). Vor-/Nachname-Felder haben Vorrang
//    (die Akte hat heute keine; vorbereitet). Sonst der Personenname aus „firma“ (Privatkunden stehen dort mit
//    Namen) oder aus „ansprechpartner“. Firmenkunden ohne Personennamen: Anfangsbuchstaben der ersten zwei Wörter
//    des Firmennamens ohne Rechtsform (GmbH, UG, AG, eG, & Co. KG …); Klammern wie „(Genossenschaft)“ zählen nicht.
//    Immer genau zwei Buchstaben (ein einziges Wort → seine ersten zwei Buchstaben).
//  - Unterscheidung: dem Kunden EINMAL fest zugeteilt und in kunden.rechnungs_kuerzel gespeichert (z. B. „LSA“):
//    erster Kunde mit diesen Initialen A, zweiter B, … nach Z: AA, AB, … Alte Rechnungen ohne Unterscheidung
//    (z. B. „CL-001“) bleiben wie sie sind, belegen aber einen Platz: Hat ein ANDERER Kunde schon Rechnungen mit
//    „CL-…“, bekommt der nächste neue CL-Kunde B. Hat der Kunde selbst schon alte Nummern mit Unterscheidung
//    („LSA-…“), wird dieses Kürzel übernommen.
//  - Laufende Nummer: höchste vorhandene Nummer dieses Kürzels in den gespeicherten Rechnungen + 1, dreistellig.
// Gleichzeitige Vergabe: kunden.rechnungs_kuerzel und rechnungen.nummer sind eindeutig (supabase/sql/
// 2026-11-24_rechnungsnummer.sql); wer den Konflikt verliert, rechnet neu und versucht es noch einmal.

export type KundeFuerNummer = {
  id: string
  vorname?: string | null
  nachname?: string | null
  firma?: string | null
  ansprechpartner?: string | null
}

/** Rechtsformen und Zusätze, die im Firmennamen nicht als Wort zählen (klein, ohne Punkte). */
const RECHTSFORMEN = new Set([
  'gmbh', 'mbh', 'ug', 'ag', 'eg', 'kg', 'ohg', 'gbr', 'ek', 'ev', 'se', 'kgaa', 'co', 'cokg', 'haftungsbeschränkt', 'haftungsbeschraenkt', 'partg', 'partgmbb', 'ltd', 'inc', 'gmbhcokg',
])
const VERBINDER = new Set(['und', '&', '+', 'u'])
const ANREDEN = new Set(['herr', 'herrn', 'frau', 'dr', 'prof', 'dipl', 'ing', 'familie', 'fam'])

/** Erster Buchstabe als Großbuchstabe ohne Umlaut/Akzent (Ä→A, ß→S); '' wenn keiner. */
export function anfangsbuchstabe(wort: string): string {
  for (const z of wort) {
    const basis = z.replace(/ß/g, 's').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    if (/^[A-Z]$/.test(basis)) return basis
  }
  return ''
}

function woerter(text: string | null | undefined): string[] {
  return String(text ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;/]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
}

const ohnePunkt = (w: string) => w.toLowerCase().replace(/[.()-]/g, '')

function istRechtsform(w: string): boolean {
  return RECHTSFORMEN.has(ohnePunkt(w))
}

/** Personenname → Initialen (erstes und letztes Namenswort) oder null, wenn es kein einzelner Personenname ist. */
export function personInitialen(text: string | null | undefined): string | null {
  const alle = woerter(text)
  if (alle.length === 0) return null
  if (alle.some((w) => VERBINDER.has(ohnePunkt(w)) || istRechtsform(w))) return null
  const namen = alle.filter((w) => !ANREDEN.has(ohnePunkt(w)) && anfangsbuchstabe(w))
  if (namen.length < 2 || namen.length > 4) return null
  const a = anfangsbuchstabe(namen[0])
  const b = anfangsbuchstabe(namen[namen.length - 1])
  return a && b ? a + b : null
}

/** Firmenname → Anfangsbuchstaben der ersten zwei Wörter ohne Rechtsform und Klammern (ein Wort: seine ersten zwei Buchstaben). */
export function firmaInitialen(text: string | null | undefined): string | null {
  const w = woerter(text).filter((x) => !istRechtsform(x) && !VERBINDER.has(ohnePunkt(x)) && anfangsbuchstabe(x))
  if (w.length >= 2) return anfangsbuchstabe(w[0]) + anfangsbuchstabe(w[1])
  if (w.length === 1) {
    const buchstaben = [...w[0]].map(anfangsbuchstabe).filter(Boolean)
    if (buchstaben.length >= 2) return buchstaben[0] + buchstaben[1]
    if (buchstaben.length === 1) return buchstaben[0] + buchstaben[0]
  }
  return null
}

/** Zwei Initialen des Kunden (siehe Kopf). Ohne verwertbaren Namen „XX“. */
export function initialenVon(k: KundeFuerNummer): string {
  const v = anfangsbuchstabe(String(k.vorname ?? ''))
  const n = anfangsbuchstabe(String(k.nachname ?? ''))
  if (v && n) return v + n
  const firma = String(k.firma ?? '')
  const firmaIstFirma = woerter(firma).some(istRechtsform)
  return (
    (!firmaIstFirma ? personInitialen(firma) : null) ??
    personInitialen(k.ansprechpartner) ??
    firmaInitialen(firma) ??
    firmaInitialen(k.ansprechpartner) ??
    'XX'
  )
}

/** 0 → A, 25 → Z, 26 → AA, 27 → AB, … */
export function unterscheidung(i: number): string {
  let n = Math.max(0, Math.floor(i)) + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Teil vor „-<Ziffern>“ einer Rechnungsnummer in Großbuchstaben, z. B. „LSA-001“ → „LSA“; sonst ''. */
export function praefixVon(nummer: string | null | undefined): string {
  const m = String(nummer ?? '').trim().match(/^([A-Za-zÄÖÜäöü]+)-\d+$/)
  return m ? m[1].toUpperCase() : ''
}

export type KuerzelEingabe = {
  kunde: KundeFuerNummer & { rechnungs_kuerzel?: string | null }
  /** Gespeicherte Kürzel aller Kunden (kunden.rechnungs_kuerzel, ohne leere). */
  kuerzel: { kunde_id: string; kuerzel: string }[]
  /** Alle gespeicherten Rechnungen (nur kunde_id und nummer werden gebraucht). */
  rechnungen: { kunde_id: string | null; nummer: string }[]
}

/**
 * Kürzel des Kunden: gespeichert → unverändert. Sonst ein neues (neu = true, muss dann am Kunden gespeichert werden).
 */
export function kuerzelFuer(e: KuerzelEingabe): { kuerzel: string; neu: boolean } {
  const gespeichert = String(e.kunde.rechnungs_kuerzel ?? '').trim().toUpperCase()
  if (gespeichert) return { kuerzel: gespeichert, neu: false }
  const ini = initialenVon(e.kunde)
  const zuIni = (p: string) => p.length > 2 && p.startsWith(ini) && /^[A-Z]+$/.test(p)
  const belegt = new Map<string, string>() // Kürzel → Kunde
  for (const z of e.kuerzel) {
    const k = String(z.kuerzel ?? '').trim().toUpperCase()
    if (k) belegt.set(k, z.kunde_id)
  }
  const mitKuerzel = new Set(e.kuerzel.map((z) => z.kunde_id))
  // Alte Nummern dieses Kunden mit Unterscheidung (z. B. LSA-003) → übernehmen, wenn das Kürzel frei ist.
  const eigeneAlte = e.rechnungen.filter((r) => r.kunde_id === e.kunde.id).map((r) => praefixVon(r.nummer)).filter(zuIni).sort()
  for (const p of eigeneAlte) if (!belegt.has(p)) return { kuerzel: p, neu: true }
  // Alte Nummern anderer Kunden: mit Unterscheidung belegen genau dieses Kürzel; ohne (nur die Initialen, z. B. CL-001)
  // belegen sie je Kunde einen Platz.
  const blankeAndere = new Set<string>()
  for (const r of e.rechnungen) {
    if (!r.kunde_id || r.kunde_id === e.kunde.id) continue
    const p = praefixVon(r.nummer)
    if (zuIni(p) && !belegt.has(p)) belegt.set(p, r.kunde_id)
    if (p === ini && !mitKuerzel.has(r.kunde_id)) blankeAndere.add(r.kunde_id)
  }
  let reserviert = blankeAndere.size
  for (let i = 0; i < 100_000; i++) {
    const k = ini + unterscheidung(i)
    if (belegt.has(k)) continue
    if (reserviert > 0) {
      reserviert--
      continue
    }
    return { kuerzel: k, neu: true }
  }
  throw new Error('Kein freies Rechnungskürzel gefunden.')
}

/** Nächste Nummer zu einem Kürzel: höchste vorhandene laufende Nummer + 1, dreistellig (vergebene werden übersprungen). */
export function naechsteNummerFuerKuerzel(kuerzel: string, nummern: string[]): string {
  const k = kuerzel.trim().toUpperCase()
  const vergeben = new Set(nummern.map((n) => String(n ?? '').trim().toUpperCase()))
  let max = 0
  for (const n of nummern) {
    const m = String(n ?? '').trim().toUpperCase().match(/^([A-Z]+)-(\d+)$/)
    if (m && m[1] === k) max = Math.max(max, Number(m[2]))
  }
  let i = max + 1
  let vorschlag = `${k}-${String(i).padStart(3, '0')}`
  while (vergeben.has(vorschlag)) vorschlag = `${k}-${String(++i).padStart(3, '0')}`
  return vorschlag
}

/** Kürzel und Nummer in einem Schritt (für Vorschläge). */
export function rechnungsnummerVorschlag(e: KuerzelEingabe): { kuerzel: string; neu: boolean; nummer: string } {
  const k = kuerzelFuer(e)
  return { ...k, nummer: naechsteNummerFuerKuerzel(k.kuerzel, e.rechnungen.map((r) => r.nummer)) }
}
