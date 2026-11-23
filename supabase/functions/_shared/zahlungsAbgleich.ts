// Zahlungsabgleich (22.11.2026): Buchungen eines Kontoauszugs gegen offene Ausgangsrechnungen
// (Eingänge) und offene Verbindlichkeiten (Ausgänge) abgleichen und Zahlungen zum Bestätigen
// vorschlagen. Reine Funktionen ohne Datenbank — benutzt von der Oberfläche
// (src/components/rechnungen/KontoauszugAbgleich.tsx) und vom Assistenten
// (telegram-gateway/abgleichWerkzeug.ts). Gebucht wird dort, nicht hier.
//
// Bewertung je Buchung:
//   - Rechnungsnummer im Verwendungszweck (stark), auch mit anderen Trennzeichen („RE 2026 012“,
//     „RE2026012“) oder ohne Kürzel („2026-012“). Mehrere Nummern in einer Überweisung = Sammelzahlung.
//   - Betrag gleich dem offenen Rest (stark), auch als Summe mehrerer Rechnungen desselben Kunden.
//   - Ähnlichkeit von Auftraggeber/Empfänger mit Firma oder Ansprechpartner der Akte bzw. dem Lieferanten.
//   - Zahlung nach dem Rechnungsdatum (sonst eine Stufe unsicherer).
//   - Teilzahlungen (weniger als offen, mit Nummer), Skonto bis 3 % (immer gekennzeichnet, nie vorausgewählt),
//     Überzahlung (unklar).
// Sicherheit: „sicher“ (vorausgewählt), „wahrscheinlich“, „unklar“; dazu ein Grund in einfachem Deutsch.
//
// Doppelt buchen verhindern: Jede Buchung bekommt einen Fingerabdruck
// „kontoauszug:<Datum>:<Betrag in Cent mit Vorzeichen>:<n>“ (n = wievielte Buchung mit gleichem Datum und
// Betrag im Auszug). Bewusst ohne Text und Namen — die liest die KI bei einem zweiten Durchgang nicht
// immer gleich. Beim Buchen landet er in rechnungen.zahlungen[].quelle bzw. in der Notiz der
// Verbindlichkeit („Kennung kontoauszug:…“). Steht er schon irgendwo, gilt die Buchung als gebucht.
// Zusätzlich: Gibt es schon eine von Hand erfasste Zahlung mit gleichem Datum und Betrag, wird der
// Vorschlag „unklar“ (womöglich doppelt) bzw. die Buchung als „vermutlich schon erfasst“ geführt.

export type AbgleichBuchung = {
  /** Eindeutig innerhalb des Auszugs. */
  id: string
  /** JJJJ-MM-TT */
  datum: string
  /** Eingang positiv, Ausgang negativ. */
  betrag: number
  verwendungszweck: string
  gegenName?: string | null
  gegenIban?: string | null
}

export type AbgleichRechnung = {
  id: string
  nummer: string
  datum: string
  brutto: number
  /** Noch offener Betrag — vom Aufrufer mit seiner Rechenregel (offenerBetrag) ermittelt. */
  offen: number
  kundeId?: string | null
  /** Firma, Ansprechpartner der Akte. */
  namen: string[]
}

export type AbgleichVerbindlichkeit = {
  id: string
  lieferant: string
  lieferantEmail?: string | null
  rechnungsnummer?: string | null
  datum: string
  /** Bruttobetrag; fehlt bei manchen automatisch erkannten Einträgen. */
  betrag?: number | null
}

/** Schon erfasste Zahlungen (alle Rechnungen, auch bezahlte; bezahlte Verbindlichkeiten). */
export type BekannteZahlung = {
  art: 'rechnung' | 'verbindlichkeit'
  zielId: string
  /** Für Texte, z. B. „RE-2026-012“ oder „Telekom“. */
  bezeichnung: string
  datum: string
  /** Immer positiv. */
  betrag: number
  /** Fingerabdruck(e), falls aus einem Kontoauszug gebucht. */
  quellen?: string[]
}

export type Sicherheit = 'sicher' | 'wahrscheinlich' | 'unklar'

export type VorschlagZiel = {
  art: 'rechnung' | 'verbindlichkeit'
  id: string
  /** Rechnungsnummer (bei Verbindlichkeiten die des Lieferanten oder leer). */
  nummer: string
  /** Kunde bzw. Lieferant. */
  name: string
  kundeId?: string | null
  /** Zu buchender Betrag (positiv). */
  betrag: number
  /** Offen vor dieser Buchung (Verbindlichkeit: Bruttobetrag, 0 wenn unbekannt). */
  offenVorher: number
  /** Gilt nach der Buchung als bezahlt (auch bei Skonto und Überzahlung). */
  vollstaendig: boolean
}

export type AbgleichVorschlag = {
  /** Stabil, solange Buchung und Ziele gleich bleiben (für „buche v…“ im Assistenten). */
  id: string
  buchung: AbgleichBuchung
  fingerabdruck: string
  art: 'rechnung' | 'verbindlichkeit'
  ziele: VorschlagZiel[]
  sicherheit: Sicherheit
  grund: string
  skonto?: { betrag: number; prozent: number }
  ueberzahlung?: number
  /** Womöglich doppelt (gleiche Zahlung schon von Hand erfasst). */
  hinweis?: string
  vorausgewaehlt: boolean
}

export type AbgleichErgebnis = {
  vorschlaege: AbgleichVorschlag[]
  schonGebucht: { buchung: AbgleichBuchung; fingerabdruck: string; wo: string }[]
  ohneTreffer: { buchung: AbgleichBuchung; fingerabdruck: string; grund: string }[]
}

export const SKONTO_HOECHSTENS = 0.03
const PREFIX = 'kontoauszug:'

// ---------------------------------------------------------------------------------------------
// Kleine Helfer

export function rundeCent(n: number): number {
  return Math.round(n * 100) / 100
}

function cent(n: number): number {
  return Math.round(n * 100)
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

export function deDatum(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

/** Kurzer, stabiler Streuwert (FNV-1a, 32 Bit) als Text zur Basis 36. */
export function kurzHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** Fingerabdrücke aller Buchungen eines Auszugs (Reihenfolge des Auszugs zählt für n). */
export function fingerabdruecke(buchungen: AbgleichBuchung[]): Map<string, string> {
  const zaehler = new Map<string, number>()
  const aus = new Map<string, string>()
  for (const b of buchungen) {
    const c = cent(b.betrag)
    const basis = `${b.datum}:${c >= 0 ? '+' : ''}${c}`
    const n = (zaehler.get(basis) ?? 0) + 1
    zaehler.set(basis, n)
    aus.set(b.id, `${PREFIX}${basis}:${n}`)
  }
  return aus
}

/** Alle Kennungen „kontoauszug:…“ aus einem Text (z. B. der Notiz einer Verbindlichkeit). */
export function kennungenAusText(text: string | null | undefined): string[] {
  return String(text ?? '').match(/kontoauszug:\d{4}-\d{2}-\d{2}:[+-]?\d+:\d+/g) ?? []
}

function grundform(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
}

// Rechtsformen, Anreden und Füllwörter zählen beim Namensvergleich nicht.
const FUELLWOERTER = new Set([
  'gmbh', 'mbh', 'ug', 'haftungsbeschraenkt', 'kg', 'ag', 'ohg', 'gbr', 'ek', 'ev', 'co', 'se', 'kgaa', 'partg', 'ltd', 'limited', 'inc',
  'und', 'der', 'die', 'das', 'von', 'vom', 'van', 'den', 'fa', 'firma', 'herr', 'herrn', 'frau', 'dr', 'prof', 'inh', 'inhaber', 'www', 'de', 'com',
])

export function namensTeile(s: string | null | undefined): string[] {
  return grundform(String(s ?? ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2 && !FUELLWOERTER.has(t) && !/^\d+$/.test(t))
}

function teilPasst(t: string, menge: string[]): boolean {
  return menge.some((x) => x === t || (t.length >= 5 && x.length >= 5 && (x.startsWith(t) || t.startsWith(x))))
}

/** Anteil der wesentlichen Namensteile von `name`, die in `text` vorkommen (0 … 1). */
export function namensNaehe(name: string, text: string | null | undefined): number {
  const alle = namensTeile(name)
  const lang = alle.filter((t) => t.length >= 3)
  const teile = lang.length ? lang : alle
  if (!teile.length) return 0
  const menge = namensTeile(text)
  if (!menge.length) return 0
  return teile.filter((t) => teilPasst(t, menge)).length / teile.length
}

/** Name im Auftraggeber/Empfänger zählt voll, im Verwendungszweck etwas weniger. */
function naehe(namen: string[], b: AbgleichBuchung): number {
  let best = 0
  for (const n of namen) {
    if (!n?.trim()) continue
    best = Math.max(best, namensNaehe(n, b.gegenName), 0.8 * namensNaehe(n, b.verwendungszweck))
  }
  return best
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const TRENNER = '[\\s\\-/._:#]*'

/**
 * Sucht eine Rechnungsnummer im Verwendungszweck. 'voll' = mit Kürzel (RE-2026-012, RE2026012,
 * „RE 2026 12“), 'ziffern' = nur die Ziffernfolge (2026-012, 2026012) — dann mindestens 6 Ziffern.
 */
export function findeNummer(nummer: string | null | undefined, text: string): 'voll' | 'ziffern' | null {
  const teile = String(nummer ?? '').toUpperCase().match(/[A-Z]+|\d+/g)
  if (!teile) return null
  const alnum = teile.join('')
  if (alnum.length < 4 || !/\d/.test(alnum)) return null
  const stueck = (t: string) => (/^\d+$/.test(t) ? `0*${esc(t.replace(/^0+(?=\d)/, ''))}` : esc(t))
  const voll = new RegExp(`(?<![A-Z0-9])${teile.map(stueck).join(TRENNER)}(?![0-9])`, 'i')
  if (voll.test(text)) return 'voll'
  const ziffern = teile.filter((t) => /^\d+$/.test(t))
  if (ziffern.length && ziffern.length < teile.length && ziffern.join('').length >= 6) {
    // Ohne Kürzel nur die Ziffern genau so, wie sie in der Nummer stehen (führende Nullen zählen), und nicht als Teil
    // eines Datums: sonst passte RE-2026-011 auf jedes „2026-11-15“ im Verwendungszweck (Teilzahlung „wahrscheinlich“,
    // und das Mahnwesen hielt die Rechnung für „Abgleich ausstehend“).
    const nur = new RegExp(`(?<![0-9]|[0-9][.\\-])${ziffern.map(esc).join(TRENNER)}(?![0-9]|[.\\-][0-9]{1,2}(?![0-9]))`)
    if (nur.test(text)) return 'ziffern'
  }
  return null
}

/** Eine Stufe unsicherer. */
function abstufen(s: Sicherheit): Sicherheit {
  return s === 'sicher' ? 'wahrscheinlich' : 'unklar'
}

function aufzaehlung(teile: string[]): string {
  return teile.length <= 1 ? (teile[0] ?? '') : `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`
}

// ---------------------------------------------------------------------------------------------
// Abgleich

type Ziel = {
  art: 'rechnung' | 'verbindlichkeit'
  id: string
  nummer: string
  name: string
  namen: string[]
  kundeId?: string | null
  datum: string
  /** Offen in Cent (Verbindlichkeit: Brutto oder null, wenn unbekannt). */
  offenCent: number | null
}

type Treffer = {
  ziele: VorschlagZiel[]
  sicherheit: Sicherheit
  gruende: string[]
  skonto?: { betrag: number; prozent: number }
  ueberzahlung?: number
}

/** Verteilt einen Betrag (Cent) auf mehrere Ziele, ältestes zuerst. */
function verteile(betragCent: number, ziele: Ziel[], rest: Map<string, number | null>): { ziel: Ziel; cent: number; voll: boolean }[] {
  const aus: { ziel: Ziel; cent: number; voll: boolean }[] = []
  let uebrig = betragCent
  const sortiert = [...ziele].sort((a, b) => a.datum.localeCompare(b.datum) || a.nummer.localeCompare(b.nummer))
  sortiert.forEach((z, i) => {
    const offen = rest.get(z.id) ?? 0
    const letzter = i === sortiert.length - 1
    const teil = letzter ? uebrig : Math.min(uebrig, offen)
    if (teil <= 0 && !letzter) return
    aus.push({ ziel: z, cent: Math.max(0, teil), voll: teil >= offen })
    uebrig -= teil
  })
  return aus.filter((a) => a.cent > 0)
}

function alsZiele(teile: { ziel: Ziel; cent: number; voll: boolean }[], rest: Map<string, number | null>, vollAlle = false): VorschlagZiel[] {
  return teile.map(({ ziel, cent: c, voll }) => ({
    art: ziel.art,
    id: ziel.id,
    nummer: ziel.nummer,
    name: ziel.name,
    kundeId: ziel.kundeId ?? null,
    betrag: c / 100,
    offenVorher: (rest.get(ziel.id) ?? 0) / 100,
    vollstaendig: vollAlle || voll || ziel.art === 'verbindlichkeit',
  }))
}

function zielText(z: Ziel): string {
  if (z.art === 'rechnung') return `Rechnung ${z.nummer}`
  return z.nummer ? `Verbindlichkeit ${z.name} (${z.nummer})` : `Verbindlichkeit ${z.name}`
}

/** Teilmengen (2 bis 4 Ziele) mit genau dieser Summe; älteste Kombination zuerst. */
function summenTreffer(betragCent: number, ziele: Ziel[], rest: Map<string, number | null>): Ziel[] | null {
  const liste = [...ziele].filter((z) => (rest.get(z.id) ?? 0) > 0).sort((a, b) => a.datum.localeCompare(b.datum)).slice(0, 12)
  const n = liste.length
  let fund: Ziel[] | null = null
  const suche = (start: number, gewaehlt: Ziel[], summe: number) => {
    if (fund) return
    if (gewaehlt.length >= 2 && summe === betragCent) {
      fund = [...gewaehlt]
      return
    }
    if (gewaehlt.length === 4 || summe >= betragCent) return
    for (let i = start; i < n && !fund; i++) suche(i + 1, [...gewaehlt, liste[i]], summe + (rest.get(liste[i].id) ?? 0))
  }
  suche(0, [], 0)
  return fund
}

function bewerte(b: AbgleichBuchung, kandidaten: Ziel[], rest: Map<string, number | null>, artWort: { geld: string; teilzahlung: boolean }): Treffer | null {
  const betragCent = Math.abs(cent(b.betrag))
  if (betragCent === 0) return null
  const verfuegbar = kandidaten.filter((z) => {
    const r = rest.get(z.id)
    return r === null || (r ?? 0) > 0
  })
  if (!verfuegbar.length) return null

  // 1. Nummern im Verwendungszweck
  const nummernTreffer = verfuegbar
    .map((z) => ({ z, wie: findeNummer(z.nummer, b.verwendungszweck) }))
    .filter((x): x is { z: Ziel; wie: 'voll' | 'ziffern' } => !!x.wie)
  // Bei mehreren Treffern derselben Nummer (gleiche Nummer bei zwei Lieferanten) den mit dem passenderen Namen.
  if (nummernTreffer.length) {
    const ziele = nummernTreffer.map((x) => x.z)
    const nurZiffern = nummernTreffer.every((x) => x.wie === 'ziffern')
    const nummernText = `${ziele.length > 1 ? 'Rechnungsnummern' : 'Rechnungsnummer'} ${aufzaehlung(ziele.map((z) => z.nummer))} im Verwendungszweck${nurZiffern ? ' (ohne Kürzel)' : ''}`
    const gruende = [nummernText]
    const bekannt = ziele.every((z) => rest.get(z.id) !== null)
    const summeCent = ziele.reduce((s, z) => s + (rest.get(z.id) ?? 0), 0)
    let t: Treffer
    if (!bekannt) {
      // Verbindlichkeit ohne Betrag: nur die Nummer spricht dafür.
      t = { ziele: alsZiele(ziele.map((z) => ({ ziel: z, cent: ziele.length === 1 ? betragCent : 0, voll: true })).filter((x) => x.cent > 0), rest), sicherheit: 'wahrscheinlich', gruende: [...gruende, 'in der Verbindlichkeit fehlt der Betrag'] }
      if (!t.ziele.length) return null
    } else if (betragCent === summeCent) {
      t = { ziele: alsZiele(verteile(betragCent, ziele, rest), rest), sicherheit: nurZiffern ? 'wahrscheinlich' : 'sicher', gruende: [...gruende, ziele.length > 1 ? `Betrag = Summe der offenen Beträge (${euro(summeCent / 100)})` : 'Betrag stimmt genau'] }
    } else if (betragCent < summeCent && summeCent - betragCent <= Math.round(summeCent * SKONTO_HOECHSTENS)) {
      const abzug = summeCent - betragCent
      // Skonto anteilig verteilen; jede Rechnung gilt danach als bezahlt.
      let uebrig = betragCent
      const teile = ziele.map((z, i) => {
        const offen = rest.get(z.id) ?? 0
        const c = i === ziele.length - 1 ? uebrig : Math.round((offen * betragCent) / summeCent)
        uebrig -= c
        return { ziel: z, cent: c, voll: true }
      })
      const prozent = Math.round((abzug / summeCent) * 1000) / 10
      t = { ziele: alsZiele(teile, rest, true), sicherheit: 'wahrscheinlich', gruende: [...gruende, `${euro(abzug / 100)} weniger als offen — vermutlich ${String(prozent).replace('.', ',')} % Skonto abgezogen; beim Buchen gilt ${ziele.length > 1 ? 'jede davon' : artWort.teilzahlung ? 'die Rechnung' : 'sie'} als bezahlt`], skonto: { betrag: abzug / 100, prozent } }
    } else if (betragCent < summeCent) {
      const teile = verteile(betragCent, ziele, rest)
      const offenNachher = (summeCent - betragCent) / 100
      t = {
        ziele: alsZiele(teile, rest),
        sicherheit: 'wahrscheinlich',
        gruende: [...gruende, artWort.teilzahlung ? `Teilzahlung — danach noch offen ${euro(offenNachher)}` : `Betrag weicht ab (${euro(betragCent / 100)} statt ${euro(summeCent / 100)}) — beim Buchen gilt sie als bezahlt`],
      }
      if (!artWort.teilzahlung) t.sicherheit = 'unklar'
    } else {
      const ueber = (betragCent - summeCent) / 100
      t = { ziele: alsZiele(verteile(betragCent, ziele, rest), rest, true), sicherheit: 'unklar', gruende: [...gruende, `${euro(ueber)} mehr als offen (${euro(summeCent / 100)}) — Überzahlung klären`], ueberzahlung: ueber }
    }
    const nameNaehe = Math.max(...ziele.map((z) => naehe(z.namen, b)))
    if (nameNaehe >= 0.5) t.gruende.push(`${artWort.geld} passt (${b.gegenName || 'im Verwendungszweck'})`)
    else if (b.gegenName?.trim()) t.gruende.push(`${artWort.geld} „${b.gegenName.trim()}“ weicht vom Namen ab`)
    return datumPruefen(t, b, ziele)
  }

  // 2. Ohne Nummer: Name und Betrag
  const mitNamen = verfuegbar.map((z) => ({ z, n: naehe(z.namen, b) })).filter((x) => x.n >= 0.5)
  const genau = verfuegbar.filter((z) => rest.get(z.id) === betragCent)
  const genauMitNamen = mitNamen.filter((x) => rest.get(x.z.id) === betragCent).sort((a, c) => c.n - a.n || a.z.datum.localeCompare(c.z.datum))
  if (genauMitNamen.length) {
    const besterWert = genauMitNamen[0].n
    const gleichGut = genauMitNamen.filter((x) => x.n === besterWert).sort((a, c) => a.z.datum.localeCompare(c.z.datum))
    const z = gleichGut[0].z
    const gruende = [`Betrag stimmt genau, ${artWort.geld.toLowerCase()} passt zu ${z.name}`, 'keine Nummer im Verwendungszweck']
    let sicherheit: Sicherheit = besterWert >= 0.99 && gleichGut.length === 1 ? 'sicher' : 'wahrscheinlich'
    if (gleichGut.length > 1) {
      gruende.push(`${gleichGut.length} gleich hohe offene Posten — der älteste gewählt (${aufzaehlung(gleichGut.map((x) => x.z.nummer || deDatum(x.z.datum)))})`)
      sicherheit = 'unklar'
    }
    return datumPruefen({ ziele: alsZiele([{ ziel: z, cent: betragCent, voll: true }], rest), sicherheit, gruende }, b, [z])
  }
  if (mitNamen.length) {
    // Gruppen je Kunde/Lieferant: Summe mehrerer offener Posten?
    const gruppen = new Map<string, Ziel[]>()
    for (const { z } of mitNamen) {
      const k = z.kundeId || grundform(z.name)
      gruppen.set(k, [...(gruppen.get(k) ?? []), z])
    }
    for (const liste of gruppen.values()) {
      const summe = summenTreffer(betragCent, liste, rest)
      if (summe) {
        return datumPruefen(
          { ziele: alsZiele(verteile(betragCent, summe, rest), rest), sicherheit: 'wahrscheinlich', gruende: [`Betrag = Summe von ${aufzaehlung(summe.map(zielText))}`, `${artWort.geld.toLowerCase()} passt zu ${summe[0].name}`, 'keine Nummer im Verwendungszweck'] },
          b,
          summe,
        )
      }
    }
    // Skonto auf einen Posten
    const skonto = mitNamen
      .map((x) => x.z)
      .filter((z) => {
        const r = rest.get(z.id) ?? 0
        return r > betragCent && r - betragCent <= Math.round(r * SKONTO_HOECHSTENS)
      })
      .sort((a, c) => a.datum.localeCompare(c.datum))
    if (skonto.length) {
      const z = skonto[0]
      const abzug = (rest.get(z.id) ?? 0) - betragCent
      const prozent = Math.round((abzug / (rest.get(z.id) ?? 1)) * 1000) / 10
      return datumPruefen(
        {
          ziele: alsZiele([{ ziel: z, cent: betragCent, voll: true }], rest, true),
          sicherheit: 'wahrscheinlich',
          gruende: [`${artWort.geld.toLowerCase()} passt zu ${z.name}`, `${euro(abzug / 100)} weniger als offen bei ${zielText(z)} — vermutlich ${String(prozent).replace('.', ',')} % Skonto; beim Buchen gilt sie als bezahlt`, 'keine Nummer im Verwendungszweck'],
          skonto: { betrag: abzug / 100, prozent },
        },
        b,
        [z],
      )
    }
    // Teilzahlung ohne Nummer: nur wenn genau ein offener Posten dieses Namens
    const einzeln = mitNamen.filter((x) => (rest.get(x.z.id) ?? 0) > betragCent)
    if (einzeln.length === 1 && artWort.teilzahlung) {
      const z = einzeln[0].z
      return datumPruefen(
        {
          ziele: alsZiele([{ ziel: z, cent: betragCent, voll: false }], rest),
          sicherheit: 'unklar',
          gruende: [`${artWort.geld.toLowerCase()} passt zu ${z.name}, einziger offener Posten`, `Betrag kleiner als offen — Teilzahlung? Danach noch offen ${euro(((rest.get(z.id) ?? 0) - betragCent) / 100)}`, 'keine Nummer im Verwendungszweck'],
        },
        b,
        [z],
      )
    }
    // Verbindlichkeit ohne Betrag mit passendem Namen
    const ohneBetrag = mitNamen.filter((x) => rest.get(x.z.id) === null).sort((a, c) => c.n - a.n || a.z.datum.localeCompare(c.z.datum))
    if (ohneBetrag.length) {
      const z = ohneBetrag[0].z
      return datumPruefen(
        { ziele: alsZiele([{ ziel: z, cent: betragCent, voll: true }], rest), sicherheit: 'unklar', gruende: [`${artWort.geld.toLowerCase()} passt zu ${z.name}`, 'in der Verbindlichkeit fehlt der Betrag', 'keine Nummer im Verwendungszweck'] },
        b,
        [z],
      )
    }
  }
  // 3. Nur der Betrag
  if (genau.length >= 1 && genau.length <= 3) {
    const sortiert = [...genau].sort((a, c) => a.datum.localeCompare(c.datum))
    const z = sortiert[0]
    const gruende = [`nur der Betrag passt (${zielText(z)}, ${z.name})`, b.gegenName?.trim() ? `${artWort.geld} „${b.gegenName.trim()}“ passt nicht zum Namen` : `${artWort.geld} unbekannt`]
    if (genau.length > 1) gruende.push(`auch ${aufzaehlung(sortiert.slice(1).map(zielText))} hat diesen Betrag`)
    return datumPruefen({ ziele: alsZiele([{ ziel: z, cent: betragCent, voll: true }], rest), sicherheit: 'unklar', gruende }, b, [z])
  }
  return null
}

function datumPruefen(t: Treffer, b: AbgleichBuchung, ziele: Ziel[]): Treffer {
  const zuFrueh = ziele.filter((z) => z.datum && b.datum && b.datum < z.datum)
  if (zuFrueh.length) {
    t.sicherheit = abstufen(t.sicherheit)
    t.gruende.push(`Zahlung liegt vor dem Datum von ${aufzaehlung(zuFrueh.map(zielText))}`)
  }
  return t
}

/**
 * Gleicht alle Buchungen ab. Eingänge (betrag > 0) gegen offene Rechnungen, Ausgänge gegen offene
 * Verbindlichkeiten. Jeder offene Rest wird nur einmal verteilt: zuerst Buchungen mit Nummer, dann
 * die übrigen, jeweils nach Datum.
 */
export function gleicheAb(
  buchungen: AbgleichBuchung[],
  rechnungen: AbgleichRechnung[],
  verbindlichkeiten: AbgleichVerbindlichkeit[],
  bekannte: BekannteZahlung[] = [],
): AbgleichErgebnis {
  const fp = fingerabdruecke(buchungen)
  const ergebnis: AbgleichErgebnis = { vorschlaege: [], schonGebucht: [], ohneTreffer: [] }

  const rZiele: Ziel[] = rechnungen
    .filter((r) => cent(r.offen) > 0)
    .map((r) => ({ art: 'rechnung', id: r.id, nummer: r.nummer, name: r.namen.find((n) => n?.trim())?.trim() || 'ohne Namen', namen: r.namen, kundeId: r.kundeId ?? null, datum: r.datum, offenCent: cent(r.offen) }))
  const vZiele: Ziel[] = verbindlichkeiten.map((v) => {
    const domain = String(v.lieferantEmail ?? '').split('@')[1]?.split('.').slice(-2, -1)[0] ?? ''
    return {
      art: 'verbindlichkeit',
      id: v.id,
      nummer: String(v.rechnungsnummer ?? '').trim(),
      name: v.lieferant?.trim() || 'Lieferant',
      namen: [v.lieferant, domain].filter(Boolean),
      datum: v.datum,
      offenCent: v.betrag != null && Number.isFinite(v.betrag) && v.betrag > 0 ? cent(v.betrag) : null,
    }
  })
  const rest = new Map<string, number | null>()
  for (const z of [...rZiele, ...vZiele]) rest.set(z.id, z.offenCent)

  // Schon gebucht?
  const quellen = new Map<string, string>()
  for (const k of bekannte) for (const q of k.quellen ?? []) quellen.set(q, k.bezeichnung)
  const offen: AbgleichBuchung[] = []
  for (const b of buchungen) {
    const f = fp.get(b.id)!
    if (quellen.has(f)) ergebnis.schonGebucht.push({ buchung: b, fingerabdruck: f, wo: `schon gebucht bei ${quellen.get(f)}` })
    else offen.push(b)
  }

  const hatNummer = (b: AbgleichBuchung) => (b.betrag > 0 ? rZiele : vZiele).some((z) => findeNummer(z.nummer, b.verwendungszweck))
  const reihenfolge = [...offen].sort((a, c) => Number(hatNummer(c)) - Number(hatNummer(a)) || a.datum.localeCompare(c.datum))

  const vorschlagNach = new Map<string, AbgleichVorschlag>()
  for (const b of reihenfolge) {
    const f = fp.get(b.id)!
    const eingang = b.betrag > 0
    const doppelt = bekannte.find((k) => k.datum === b.datum && cent(k.betrag) === Math.abs(cent(b.betrag)) && k.art === (eingang ? 'rechnung' : 'verbindlichkeit') && !(k.quellen ?? []).length)
    const t = cent(b.betrag) === 0 ? null : bewerte(b, eingang ? rZiele : vZiele, rest, eingang ? { geld: 'Auftraggeber', teilzahlung: true } : { geld: 'Empfänger', teilzahlung: false })
    if (!t || !t.ziele.length) {
      if (doppelt) ergebnis.schonGebucht.push({ buchung: b, fingerabdruck: f, wo: `vermutlich schon von Hand erfasst bei ${doppelt.bezeichnung}` })
      else ergebnis.ohneTreffer.push({ buchung: b, fingerabdruck: f, grund: eingang ? 'keine passende offene Rechnung' : 'keine passende offene Verbindlichkeit' })
      continue
    }
    // Verteilten Betrag vom offenen Rest abziehen (Verbindlichkeiten sind danach vergeben).
    for (const z of t.ziele) {
      const r = rest.get(z.id)
      rest.set(z.id, z.art === 'verbindlichkeit' || r === null || r === undefined ? 0 : Math.max(0, r - cent(z.betrag)))
    }
    let sicherheit = t.sicherheit
    let hinweis: string | undefined
    if (doppelt) {
      sicherheit = 'unklar'
      hinweis = `Am ${deDatum(b.datum)} ist schon eine Zahlung über ${euro(Math.abs(b.betrag))} bei ${doppelt.bezeichnung} erfasst — womöglich doppelt.`
    }
    const v: AbgleichVorschlag = {
      id: `v${kurzHash(`${f}|${t.ziele.map((z) => z.id).sort().join(',')}`)}`,
      buchung: b,
      fingerabdruck: f,
      art: eingang ? 'rechnung' : 'verbindlichkeit',
      ziele: t.ziele,
      sicherheit,
      grund: `${t.gruende.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()),
      ...(t.skonto ? { skonto: t.skonto } : {}),
      ...(t.ueberzahlung ? { ueberzahlung: t.ueberzahlung } : {}),
      ...(hinweis ? { hinweis } : {}),
      vorausgewaehlt: sicherheit === 'sicher' && !t.skonto && !t.ueberzahlung && !hinweis,
    }
    vorschlagNach.set(b.id, v)
  }
  // Ausgabe in der Reihenfolge des Auszugs.
  for (const b of buchungen) {
    const v = vorschlagNach.get(b.id)
    if (v) ergebnis.vorschlaege.push(v)
  }
  return ergebnis
}

// ---------------------------------------------------------------------------------------------
// Texte beim Buchen (Oberfläche und Assistent gleich)

/** Notiz an der Zahlung. */
export function zahlungsNotiz(v: Pick<AbgleichVorschlag, 'buchung' | 'skonto'>): string {
  const wer = String(v.buchung.gegenName ?? '').trim()
  const teile = [`Kontoauszug${wer ? `: ${wer}` : ''}`]
  if (v.skonto) teile.push(`${String(v.skonto.prozent).replace('.', ',')} % Skonto (${euro(v.skonto.betrag)}) abgezogen`)
  return teile.join(' — ').slice(0, 200)
}

/** Vermerk im Verlauf der Akte — wie „Zahlung erfassen“, mit Hinweis auf den Kontoauszug. */
export function zahlungsVermerk(p: { nummer: string; betrag: number; vollstaendig: boolean; offenNachher: number; skonto?: { betrag: number; prozent: number } }): string {
  if (p.vollstaendig) {
    const skonto = p.skonto ? `, ${String(p.skonto.prozent).replace('.', ',')} % Skonto (${euro(p.skonto.betrag)}) abgezogen` : ''
    return `Zahlung über ${euro(p.betrag)} zu Rechnung ${p.nummer} erfasst (aus dem Kontoauszug${skonto}) — Rechnung vollständig bezahlt`
  }
  return `Teilzahlung über ${euro(p.betrag)} zu Rechnung ${p.nummer} erfasst (aus dem Kontoauszug, noch offen: ${euro(p.offenNachher)})`
}

/** Neue Notiz einer Verbindlichkeit: alte Notiz plus Zeile mit Datum und Kennung. */
export function verbindlichkeitNotiz(alt: string | null | undefined, v: Pick<AbgleichVorschlag, 'buchung' | 'fingerabdruck' | 'skonto'>): string {
  const skonto = v.skonto ? `, ${String(v.skonto.prozent).replace('.', ',')} % Skonto (${euro(v.skonto.betrag)}) abgezogen` : ''
  const zeile = `Bezahlt laut Kontoauszug am ${deDatum(v.buchung.datum)} über ${euro(Math.abs(v.buchung.betrag))}${skonto} (Kennung ${v.fingerabdruck})`
  const a = String(alt ?? '').trim()
  return a ? `${a}\n${zeile}` : zeile
}

export const SICHERHEIT_TEXT: Record<Sicherheit, string> = { sicher: 'Sicher', wahrscheinlich: 'Wahrscheinlich', unklar: 'Unklar' }
