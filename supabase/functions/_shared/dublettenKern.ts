// Dubletten finden (22.11.2026): doppelte Kundenakten und doppelte Objekte erkennen. Reiner Kern ohne
// Importe und ohne Deno- oder Browser-Funktionen — benutzt von der Seite „Dubletten“ im CRM (über die
// Aktion `dubletten` im email-gateway, dublettenZusammenfuehren.ts) und vom Werkzeug dubletten_finden des
// Assistenten (telegram-gateway/dublettenWerkzeug.ts). Zusammengeführt wird hier NICHT: das macht weiter
// allein kunden_zusammenfuehren (telegram-gateway/pflegeWerkzeuge.ts), mit Bestätigung.
//
// Hinweise je Paar, jeder mit Punkten (zusammen höchstens 100):
//  - Name: Firma bzw. Person ohne Rechtsform (GmbH, GmbH & Co. KG, UG (haftungsbeschränkt) …), ohne Anrede
//    und Titel, Umlaute gleich behandelt (ü = ue), Wortfolge egal („Mustermann Max“ = „Max Mustermann“),
//    kleine Tippfehler; Ansprechpartner und der Name in Klammern hinter der Firma zählen mit.
//  - E-Mail: gleiche Adresse; gleiche Firmen-Mailendung nach dem @ (nicht bei freien Anbietern wie GMX und nicht bei eigenen).
//  - Telefon: nur Ziffern, +49/0049 = 0; gleich, oder eine Nummer ist die andere mit fehlenden Endziffern
//    (z. B. 0049-163-6058 und 0049-163-6058100 — abgeschnittene Nummer).
//  - Anschrift: gleiche Straße mit Hausnummer (und gleiche PLZ, wenn beide eine haben).
// Ab MINDEST_PUNKTE gilt ein Paar als mögliche Dublette; Paare werden zu Gruppen verbunden. Akten in
// verschiedenen Bereichen werden eigens markiert (dann passt eher „Bereich wechseln“ als Zusammenführen;
// kunden_zusammenfuehren verlangt denselben Bereich). Bewusst verknüpfte Akten („in beiden Bereichen
// führen“, kunden.verknuepfte_kunden) und als „keine Dublette“ gemerkte Paare werden nie gemeldet.
// Private Kontakte und die Sammelakten bleiben außen vor; ebenso private Objekte.

export type AkteFuerDubletten = {
  id: string
  bereich: string
  firma?: string | null
  ansprechpartner?: string | null
  email?: string | null
  telefon?: string | null
  anschrift?: string | null
  /** Ids bewusst verknüpfter Akten (kunden.verknuepfte_kunden[].id). */
  verknuepft?: string[] | null
}

export type ObjektFuerDubletten = {
  id: string
  bezeichnung?: string | null
  adresse?: string | null
  /** Weitere Adressen, z. B. aus dem Verkaufsdatenblatt (Straße + PLZ/Ort). */
  weitereAdressen?: (string | null | undefined)[] | null
  privat_besitzer?: string | null
}

export type DublettenArt = 'kunde' | 'objekt'
export type Stufe = 'sicher' | 'wahrscheinlich' | 'moeglich'

export const STUFE_TEXT: Record<Stufe, string> = { sicher: 'sicher', wahrscheinlich: 'wahrscheinlich', moeglich: 'möglich' }

export type Paar = { a: string; b: string; punkte: number; gruende: string[] }

export type DublettenGruppe = {
  art: DublettenArt
  /** Sortierte Ids, mit „|“ verbunden — stabil für Schlüssel in der Oberfläche. */
  schluessel: string
  ids: string[]
  /** Höchste Punktzahl eines Paares der Gruppe. */
  punkte: number
  stufe: Stufe
  /** Alle Gründe der Paare (ohne Doppelte, stärkste zuerst). */
  gruende: string[]
  paare: Paar[]
  /** Nur Akten: liegen die Akten in verschiedenen Bereichen? */
  bereichsuebergreifend: boolean
  bereiche: string[]
}

export type DublettenOptionen = {
  /** Als „keine Dublette“ gemerkte Paare (paarSchluessel). */
  ausnahmen?: Iterable<string>
  mindestPunkte?: number
  /** Eigene Mailendungen (zählen nicht als gemeinsame Firmen-Mailendung). */
  eigeneDomains?: string[]
}

export const MINDEST_PUNKTE = 40
export const SAMMELAKTEN_IDS: readonly string[] = ['k_intern_holding', 'k_eingang_ungeklaert']
const EIGENE_DOMAINS = ['amayer-holding.com']

const FREEMAILER = new Set([
  'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com', 'web.de', 't-online.de', 'freenet.de',
  'hotmail.com', 'hotmail.de', 'outlook.com', 'outlook.de', 'live.com', 'live.de', 'msn.com', 'yahoo.com', 'yahoo.de',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.de', 'posteo.de', 'mailbox.org', 'arcor.de', 'online.de', 'mail.de',
  'email.de', 'proton.me', 'protonmail.com', 'vodafone.de', '1und1.de', 'kabelbw.de', 'unitybox.de', 'magenta.de',
])

// Wörter, die für den Vergleich von Namen nichts bedeuten: Rechtsformen, Anreden, Titel, Füllwörter.
const LEERWOERTER = new Set([
  'gmbh', 'mbh', 'ggmbh', 'ug', 'haftungsbeschraenkt', 'ag', 'kg', 'kgaa', 'ohg', 'gbr', 'co', 'und', 'ek', 'ekfm', 'ev', 'eg',
  'kfm', 'kffr', 'inh', 'inhaber', 'inhaberin', 'ltd', 'limited', 'se', 'partg', 'mbb', 'partnerschaft', 'partnerschaftsgesellschaft',
  'gesellschaft', 'herr', 'herrn', 'frau', 'hr', 'fr', 'dr', 'prof', 'dipl', 'ing', 'med', 'mag', 'rer', 'pol', 'nat', 'familie', 'fam',
  'eheleute', 'the', 'der', 'die', 'das', 'von', 'vom', 'zu', 'zum', 'zur',
])

// ---------- Hilfen ----------

/** Klein, Umlaute ausgeschrieben, ohne Akzente. */
export function grundform(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

/** Bedeutungstragende Wörter eines Namens, sortiert und ohne Doppelte (Inhalt in Klammern bleibt außen vor). */
export function namensWoerter(s: unknown): string[] {
  const ohneKlammer = grundform(s).replace(/\([^)]*\)/g, ' ')
  const woerter = ohneKlammer.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !LEERWOERTER.has(w))
  return [...new Set(woerter)].sort()
}

/** Inhalt von Klammern hinter einem Namen, z. B. „Muster GmbH (Max Muster)“ → ["Max Muster"]. */
function klammerInhalte(s: unknown): string[] {
  return [...String(s ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
}

/** Schlüssel eines Paares: beide Ids sortiert, mit „|“ verbunden. */
export function paarSchluessel(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Alle Paare einer Gruppe von Ids (für „keine Dublette“). */
export function allePaare(ids: string[]): string[] {
  const aus: string[] = []
  const eindeutig = [...new Set(ids)]
  for (let i = 0; i < eindeutig.length; i++) for (let j = i + 1; j < eindeutig.length; j++) aus.push(paarSchluessel(eindeutig[i], eindeutig[j]))
  return aus
}

/** Abstand nach Levenshtein, bricht ab (grenze + 1), sobald er größer als grenze wird. */
export function abstand(a: string, b: string, grenze = 2): number {
  if (Math.abs(a.length - b.length) > grenze) return grenze + 1
  let vorher = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const jetzt = [i]
    let kleinste = i
    for (let j = 1; j <= b.length; j++) {
      const wert = Math.min(vorher[j] + 1, jetzt[j - 1] + 1, vorher[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      jetzt.push(wert)
      if (wert < kleinste) kleinste = wert
    }
    if (kleinste > grenze) return grenze + 1
    vorher = jetzt
  }
  return vorher[b.length]
}

/** Alle E-Mail-Adressen eines Feldes (klein). */
export function emailAdressen(s: unknown): string[] {
  return [...new Set((String(s ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).map((e) => e.replace(/\.+$/, '')))]
}

function domainVon(email: string): string {
  return email.split('@')[1] ?? ''
}

/**
 * Telefonnummern eines Feldes als reine Ziffern, Landesvorwahl +49/0049 als führende 0, „(0)“ entfernt.
 * Mehrere Nummern trennen Komma, Semikolon, senkrechter Strich, Zeilenumbruch, „oder“, „und“ und Beschriftungen
 * wie „Tel.:“ oder „Mobil“. Kürzere Ziffernfolgen als 6 zählen nicht.
 */
export function telefonnummern(s: unknown): string[] {
  const roh = String(s ?? '').replace(/\(0\)/g, ' ')
  const teile = roh.split(/[,;|\n]|\boder\b|\bund\b|[a-zA-ZäöüÄÖÜß.:]{2,}:?/)
  const aus: string[] = []
  for (const teil of teile) {
    const t = teil.trim()
    if (!t) continue
    const plus = t.startsWith('+')
    let ziffern = t.replace(/\D/g, '')
    if (plus && ziffern.startsWith('49')) ziffern = `0${ziffern.slice(2)}`
    else if (ziffern.startsWith('0049')) ziffern = `0${ziffern.slice(4)}`
    else if (plus) ziffern = `00${ziffern}`
    if (ziffern.length >= 6) aus.push(ziffern)
  }
  return [...new Set(aus)]
}

/**
 * Straße mit Hausnummer als Schlüssel („hauptstr12a“), leer, wenn keine erkennbar. Gleiche Regel wie
 * strassenSchluessel in telegram-gateway/objektWerkzeuge.ts (hier ohne Importe nachgebildet).
 */
export function strassenSchluessel(adr: unknown): string {
  const s = grundform(adr).replace(/strasse\b/g, 'str').replace(/str\./g, 'str').replace(/\bstr\b/g, 'str')
  const m = s.match(/([a-z][a-z .-]*?)\s*(\d{1,4})(?!\d)\s*([a-z])?(?![a-z])/)
  if (!m) return ''
  return `${m[1].replace(/[^a-z]/g, '')}${m[2]}${m[3] ?? ''}`
}

function plzVon(adr: unknown): string {
  return String(adr ?? '').match(/\b\d{5}\b/)?.[0] ?? ''
}

function leer(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === ''
}

function stufeVon(punkte: number): Stufe {
  return punkte >= 80 ? 'sicher' : punkte >= 60 ? 'wahrscheinlich' : 'moeglich'
}

// ---------- Namen vergleichen ----------

type NamensTreffer = { punkte: number; grund: string }

/** Vergleich zweier Namen (Firma mit Firma). */
export function vergleicheNamen(a: unknown, b: unknown): NamensTreffer | null {
  const wa = namensWoerter(a)
  const wb = namensWoerter(b)
  if (wa.length === 0 || wb.length === 0) return null
  const ka = wa.join('')
  const kb = wb.join('')
  if (ka === kb && ka.length >= 3) {
    const wortgleich = grundform(a).replace(/[^a-z0-9]/g, '') === grundform(b).replace(/[^a-z0-9]/g, '')
    const punkte = wa.length >= 2 ? 60 : ka.length >= 5 ? 45 : 35
    return { punkte, grund: wortgleich ? 'gleicher Name' : 'gleicher Name, nur anders geschrieben (Rechtsform, Umlaute oder Wortfolge)' }
  }
  const kurz = Math.min(ka.length, kb.length)
  const d = abstand(ka, kb, 2)
  if ((kurz >= 6 && d <= 1) || (kurz >= 12 && d <= 2)) return { punkte: 40, grund: 'Name fast gleich geschrieben' }
  const sa = new Set(wa)
  const gemeinsam = wb.filter((w) => sa.has(w))
  const vereinigt = new Set([...wa, ...wb]).size
  if (Math.min(wa.length, wb.length) >= 2 && gemeinsam.length / vereinigt >= 0.75) return { punkte: 40, grund: 'Name weitgehend gleich' }
  const [klein, gross] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  const gs = new Set(gross)
  if (klein.every((w) => gs.has(w))) {
    if (klein.length >= 2) return { punkte: 35, grund: 'ein Name steckt ganz im anderen' }
    if (klein[0].length >= 5 && gross.length <= 3) return { punkte: 20, grund: 'gleicher Namensbestandteil' }
  }
  if (gemeinsam.filter((w) => w.length >= 3).length >= 2) return { punkte: 25, grund: 'Namen haben mehrere gleiche Bestandteile' }
  return null
}

// Platzhalter statt eines echten Namens, z. B. „(Absender noch eintragen)“.
const PLATZHALTER = /absender|eintragen|unbekannt|platzhalter|noch offen|\bn\.?\s?a\.?\b|\bk\.?\s?a\.?\b/i

/** Echter Ansprechpartner (kein Platzhalter, nicht bloß die Firma noch einmal)? */
function ansprechpartnerVon(k: AkteFuerDubletten): string {
  const ap = String(k.ansprechpartner ?? '').trim()
  if (!ap || PLATZHALTER.test(ap)) return ''
  if (namensWoerter(ap).join(' ') === namensWoerter(k.firma).join(' ')) return ''
  return ap
}

/** Personen-Namen einer Akte: Ansprechpartner und Namen in Klammern hinter der Firma. */
function personen(k: AkteFuerDubletten): string[] {
  return [ansprechpartnerVon(k), ...klammerInhalte(k.firma)].filter((p) => !PLATZHALTER.test(p) && namensWoerter(p).length >= 2)
}

/** Ist der Name (mindestens Vor- und Nachname) gleich? */
function gleichePerson(a: string, b: string): boolean {
  const wa = namensWoerter(a)
  const wb = namensWoerter(b)
  return wa.length >= 2 && wa.join(' ') === wb.join(' ')
}

function namenHinweis(x: AkteFuerDubletten, y: AkteFuerDubletten): NamensTreffer | null {
  const firma = vergleicheNamen(x.firma, y.firma)
  let person: NamensTreffer | null = null
  const px = personen(x)
  const py = personen(y)
  if (px.some((p) => py.some((q) => gleichePerson(p, q)))) person = { punkte: 45, grund: 'gleicher Ansprechpartner' }
  else if (px.some((p) => gleichePerson(p, String(y.firma ?? ''))) || py.some((q) => gleichePerson(q, String(x.firma ?? '')))) {
    person = { punkte: 45, grund: 'der Name der einen Akte ist Ansprechpartner der anderen' }
  }
  if (firma && person) return { punkte: Math.min(75, Math.max(firma.punkte, person.punkte) + 10), grund: `${firma.grund}; ${person.grund}` }
  return firma ?? person
}

// ---------- Akten ----------

/** Punkte und Gründe für zwei Akten (ohne Mindestgrenze). */
export function vergleicheAkten(x: AkteFuerDubletten, y: AkteFuerDubletten, eigeneDomains: string[] = EIGENE_DOMAINS): Paar {
  const gruende: string[] = []
  let punkte = 0
  const name = namenHinweis(x, y)
  if (name) {
    punkte += name.punkte
    gruende.push(...name.grund.split('; '))
  }

  const ex = emailAdressen(x.email)
  const ey = emailAdressen(y.email)
  const eigene = new Set(eigeneDomains.map((d) => d.toLowerCase()))
  if (ex.some((e) => ey.includes(e))) {
    punkte += 50
    gruende.push('gleiche E-Mail-Adresse')
  } else {
    const dy = new Set(ey.map(domainVon))
    const domain = ex.map(domainVon).find((d) => d && dy.has(d) && !FREEMAILER.has(d) && !eigene.has(d))
    if (domain) {
      punkte += 25
      gruende.push(`gleiche Firmen-Mailendung (@${domain})`)
    }
  }

  const tx = telefonnummern(x.telefon)
  const ty = telefonnummern(y.telefon)
  if (tx.some((t) => t.length >= 7 && ty.includes(t))) {
    punkte += 45
    gruende.push('gleiche Telefonnummer')
  } else if (
    tx.some((t) =>
      ty.some((u) => {
        const [kurz, lang] = t.length <= u.length ? [t, u] : [u, t]
        return kurz.length >= 8 && lang.length - kurz.length <= 4 && lang.startsWith(kurz)
      }),
    )
  ) {
    punkte += 40
    gruende.push('Telefonnummer gleich bis auf fehlende Endziffern')
  }

  // Gleiche Firma, aber erkennbar andere Personen (z. B. zwei Ansprechpartner derselben Stadtverwaltung) und
  // weder gleiche Adresse noch gleiche Nummer: eher zwei Kontakte als eine doppelte Akte.
  const apx = namensWoerter(ansprechpartnerVon(x))
  const apy = namensWoerter(ansprechpartnerVon(y))
  const gleicheKennung = gruende.includes('gleiche E-Mail-Adresse') || gruende.includes('gleiche Telefonnummer')
  if (name && !gleicheKennung && apx.length > 0 && apy.length > 0 && !apx.some((w) => apy.includes(w))) {
    punkte -= 25
    gruende.push('aber verschiedene Ansprechpartner')
  }

  const sx = strassenSchluessel(x.anschrift)
  if (sx && sx === strassenSchluessel(y.anschrift)) {
    const pa = plzVon(x.anschrift)
    const pb = plzVon(y.anschrift)
    if (!pa || !pb || pa === pb) {
      punkte += 30
      gruende.push('gleiche Anschrift')
    }
  }
  return { a: x.id, b: y.id, punkte: Math.max(0, Math.min(100, punkte)), gruende }
}

/** Darf diese Akte überhaupt als Dublette vorgeschlagen werden? */
export function istPruefbareAkte(k: AkteFuerDubletten): boolean {
  return !!k.id && !SAMMELAKTEN_IDS.includes(k.id) && k.bereich !== 'privat'
}

/** Mögliche Dubletten unter den Akten, als Gruppen (stärkste zuerst). */
export function findeAktenDubletten(akten: AkteFuerDubletten[], opt: DublettenOptionen = {}): DublettenGruppe[] {
  const liste = akten.filter(istPruefbareAkte)
  const ausnahmen = new Set(opt.ausnahmen ?? [])
  const grenze = opt.mindestPunkte ?? MINDEST_PUNKTE
  const verknuepft = new Set<string>()
  for (const k of liste) for (const v of k.verknuepft ?? []) if (v) verknuepft.add(paarSchluessel(k.id, v))
  const paare: Paar[] = []
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const s = paarSchluessel(liste[i].id, liste[j].id)
      if (ausnahmen.has(s) || verknuepft.has(s)) continue
      const p = vergleicheAkten(liste[i], liste[j], opt.eigeneDomains ?? EIGENE_DOMAINS)
      if (p.punkte >= grenze) paare.push(p)
    }
  }
  const bereichVon = new Map(liste.map((k) => [k.id, k.bereich]))
  return gruppiere('kunde', paare, (id) => bereichVon.get(id) ?? '')
}

// ---------- Objekte ----------

const OBJEKT_GRUND: Record<string, string> = {
  'gleicher Name': 'gleiche Bezeichnung',
  'gleicher Name, nur anders geschrieben (Rechtsform, Umlaute oder Wortfolge)': 'gleiche Bezeichnung, nur anders geschrieben',
  'Name fast gleich geschrieben': 'Bezeichnung fast gleich geschrieben',
  'Name weitgehend gleich': 'Bezeichnung weitgehend gleich',
  'ein Name steckt ganz im anderen': 'eine Bezeichnung steckt ganz in der anderen',
}

function objektAdressen(o: ObjektFuerDubletten): string[] {
  return [o.adresse, ...(o.weitereAdressen ?? []), o.bezeichnung].map((a) => String(a ?? '').trim()).filter(Boolean)
}

/** Punkte und Gründe für zwei Objekte (ohne Mindestgrenze). */
export function vergleicheObjekte(x: ObjektFuerDubletten, y: ObjektFuerDubletten): Paar {
  const gruende: string[] = []
  let punkte = 0
  const name = vergleicheNamen(x.bezeichnung, y.bezeichnung)
  if (name && name.punkte >= 35) {
    punkte += name.punkte >= 45 ? 50 : 35
    gruende.push(OBJEKT_GRUND[name.grund] ?? name.grund)
  }
  const ax = objektAdressen(x)
  const ay = objektAdressen(y)
  let adresse = 0
  let grund = ''
  for (const a of ax) {
    const sa = strassenSchluessel(a)
    if (!sa) continue
    for (const b of ay) {
      const sb = strassenSchluessel(b)
      if (!sb) continue
      const pa = plzVon(a)
      const pb = plzVon(b)
      const plzPasst = !pa || !pb || pa === pb
      if (sa === sb && plzPasst && adresse < 50) {
        adresse = 50
        grund = 'gleiche Adresse'
      } else if (pa && pa === pb && adresse < 35) {
        const nummer = (k: string) => k.match(/\d+[a-z]?$/)?.[0] ?? ''
        const strasse = (k: string) => k.replace(/\d+[a-z]?$/, '')
        if (nummer(sa) === nummer(sb) && strasse(sa).slice(0, 5) === strasse(sb).slice(0, 5)) {
          adresse = 35
          grund = 'Adresse sehr ähnlich (gleiche PLZ und Hausnummer)'
        }
      }
    }
  }
  if (adresse > 0) {
    punkte += adresse
    gruende.push(grund)
  }
  return { a: x.id, b: y.id, punkte: Math.min(100, punkte), gruende }
}

/** Mögliche Dubletten unter den Objekten der Holding (private Objekte bleiben außen vor). */
export function findeObjektDubletten(objekte: ObjektFuerDubletten[], opt: DublettenOptionen = {}): DublettenGruppe[] {
  const liste = objekte.filter((o) => !!o.id && leer(o.privat_besitzer))
  const ausnahmen = new Set(opt.ausnahmen ?? [])
  const grenze = opt.mindestPunkte ?? MINDEST_PUNKTE
  const paare: Paar[] = []
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      if (ausnahmen.has(paarSchluessel(liste[i].id, liste[j].id))) continue
      const p = vergleicheObjekte(liste[i], liste[j])
      if (p.punkte >= grenze) paare.push(p)
    }
  }
  return gruppiere('objekt', paare, () => 'immobilien')
}

// ---------- Gruppen ----------

/** „gleicher Name, nur anders geschrieben …“ entfällt, wenn auch „gleicher Name“ dasteht. */
function ohneVarianten(gruende: string[]): string[] {
  return gruende.filter((r) => !gruende.some((o) => o !== r && r.startsWith(`${o},`)))
}

function gruppiere(art: DublettenArt, paare: Paar[], bereichVon: (id: string) => string): DublettenGruppe[] {
  const eltern = new Map<string, string>()
  const wurzel = (id: string): string => {
    let w = id
    while (eltern.get(w) && eltern.get(w) !== w) w = eltern.get(w)!
    eltern.set(id, w)
    return w
  }
  for (const p of paare) {
    if (!eltern.has(p.a)) eltern.set(p.a, p.a)
    if (!eltern.has(p.b)) eltern.set(p.b, p.b)
    const wa = wurzel(p.a)
    const wb = wurzel(p.b)
    if (wa !== wb) eltern.set(wa < wb ? wb : wa, wa < wb ? wa : wb)
  }
  const nachWurzel = new Map<string, Paar[]>()
  for (const p of paare) {
    const w = wurzel(p.a)
    nachWurzel.set(w, [...(nachWurzel.get(w) ?? []), p])
  }
  const gruppen: DublettenGruppe[] = []
  for (const liste of nachWurzel.values()) {
    const sortiert = [...liste].sort((x, y) => y.punkte - x.punkte)
    const ids = [...new Set(sortiert.flatMap((p) => [p.a, p.b]))].sort()
    const punkte = sortiert[0].punkte
    const bereiche = [...new Set(ids.map(bereichVon))].sort()
    gruppen.push({
      art,
      schluessel: ids.join('|'),
      ids,
      punkte,
      stufe: stufeVon(punkte),
      gruende: ohneVarianten([...new Set(sortiert.flatMap((p) => p.gruende))]),
      paare: sortiert,
      bereichsuebergreifend: art === 'kunde' && bereiche.length > 1,
      bereiche,
    })
  }
  return gruppen.sort((x, y) => y.punkte - x.punkte || x.schluessel.localeCompare(y.schluessel))
}

/**
 * Gruppen auf sichtbare Ids beschränken (Bereichsrechte): Paare mit einer unsichtbaren Seite fallen weg, Punkte,
 * Gründe und „verschiedene Bereiche“ werden aus den übrigen Paaren neu bestimmt; eine Gruppe kann dabei zerfallen.
 */
export function beschraenkeGruppen(gruppen: DublettenGruppe[], sichtbar: (id: string) => boolean, bereichVon: (id: string) => string): DublettenGruppe[] {
  const aus: DublettenGruppe[] = []
  for (const g of gruppen) {
    if (g.ids.every(sichtbar)) {
      aus.push(g)
      continue
    }
    aus.push(...gruppiere(g.art, g.paare.filter((p) => sichtbar(p.a) && sichtbar(p.b)), bereichVon))
  }
  return aus.sort((x, y) => y.punkte - x.punkte || x.schluessel.localeCompare(y.schluessel))
}

/** Kurzer deutscher Satz zu einer Gruppe, z. B. „wahrscheinlich (70 Punkte): gleicher Name, gleiche Telefonnummer“. */
export function gruppenText(g: DublettenGruppe): string {
  return `${STUFE_TEXT[g.stufe]} (${g.punkte} Punkte): ${g.gruende.join(', ')}`
}
