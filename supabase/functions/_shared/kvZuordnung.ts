// Kostenvoranschläge ihren Kundenakten zuordnen (22.11.2026). Reiner Kern ohne Datenbank, ohne Deno- und
// Browser-Funktionen — benutzt von
//  - der Aktion `kv_zuordnen` im email-gateway (email-gateway/kvZuordnung.ts, einmalige Zuordnung mit Vorschau
//    auf der Seite „Kostenvoranschläge“, nur Geschäftsführung),
//  - dem Formular „Neuer Kostenvoranschlag“ im CRM (src/components/KvAkteVorschlag.tsx, Vorschlag beim Tippen),
//  - dem Assistenten (telegram-gateway/kvAkteVorschlag.ts, Hinweis nach kostenvoranschlag_anlegen ohne Akte).
// Anlass: keiner der 20 Einträge vom Notizzettel (17.11.2026) hatte eine Akte, deshalb fehlten sie in
// Umsatzvorschau, Rechnungsvorschlägen, Wiedervorlagen und im Reiter der Akte.
//
// Die Namen stammen oft von handschriftlichen Zetteln: abgekürzt („Breh.“, „Lachenm.“), mit Vermittler davor
// („Azat Leicht“), Initial angeklebt („Wleicht“ = „W. Leicht“) oder leicht verlesen. Deshalb wird je Wort des
// Kostenvoranschlags das beste Wort der Akte gesucht (Firma, Ansprechpartner, Namen in Klammern, Teil der
// Mailadresse vor dem @):
//  - gleich (Umlaute gleich behandelt: ü = ue),
//  - Abkürzung mit Punkt: Anfang des Wortes der Akte (ab 3 Buchstaben; ab 6 Buchstaben ein Tippfehler erlaubt),
//  - Initial + Name zusammengeschrieben („W. Leicht“ ↔ „Wleicht“),
//  - Anfang eines längeren Wortes (ab 5 Buchstaben, „Hohloch“ ↔ „Hohlocher“),
//  - fast gleich (ab 6 Buchstaben 1 Tippfehler, ab 9 Buchstaben 2).
// Allgemeine Wörter wie „Immo“, „Fenster“, „Dach“ zählen nur als Zusatz. Wie selten ein Wort unter allen Akten
// ist, zählt mit: ein Nachname, der in vielen Akten steht, ist kein Hinweis auf eine bestimmte Akte.
// Weitere Hinweise: die verknüpfte Datei liegt in einer echten Akte; der volle Name der Akte steht im Text der
// verknüpften Datei (nur wenn die Datei zu genau einem Kostenvoranschlag gehört — eine Liste mit vielen Namen
// passte sonst zu jedem); ein seltenes Wort aus Beschreibung/Notiz steht im Namen der Akte (nur als Zusatz).
//
// Stufen: „sicher“ ab 80 Punkten und nur, wenn genau eine Akte so gut passt; „wahrscheinlich“ ab 50 Punkten.
// Darunter wird nichts vorgeschlagen.
// Sichtbarkeit: Öffentliche Einträge nur zu öffentlichen Akten (eine private Akte machte den Eintrag für alle
// anderen unsichtbar), private Einträge nur zu privaten Akten desselben Besitzers. Sammelakten nie.

import { abstand, grundform, namensWoerter, SAMMELAKTEN_IDS } from './dublettenKern.ts'

export type KvFuerZuordnung = {
  id: string
  name: string
  beschreibung?: string | null
  notiz?: string | null
  bereich?: string | null
  privat_besitzer?: string | null
  /** Akte, in der die verknüpfte Datei liegt (kostenvoranschlaege.dokument.kundeId). */
  dokumentKundeId?: string | null
  /** Kennung der verknüpften Datei (dokument.dokumentId) — um zu erkennen, ob sie zu mehreren Einträgen gehört. */
  dokumentId?: string | null
  /** Gelesener Text der verknüpften Datei (dokument_inhalte), falls vorhanden. */
  dokumentText?: string | null
}

export type AkteFuerZuordnung = {
  id: string
  bereich: string
  firma?: string | null
  ansprechpartner?: string | null
  email?: string | null
  verantwortlich_email?: string | null
}

export type KvStufe = 'sicher' | 'wahrscheinlich'

export const KV_STUFE_TEXT: Record<KvStufe, string> = { sicher: 'sicher', wahrscheinlich: 'wahrscheinlich' }

export type KvKandidat = { kunde_id: string; stufe: KvStufe; punkte: number; gruende: string[] }

export type KvVorschlag = { kv_id: string; kandidaten: KvKandidat[] }

export const SICHER_AB = 80
export const WAHRSCHEINLICH_AB = 50
const HOECHSTENS_KANDIDATEN = 3

// Wörter, die auf Zetteln oft vor oder nach dem Namen stehen, aber keine bestimmte Akte bezeichnen.
const ALLGEMEIN = new Set([
  'immo', 'immobilie', 'immobilien', 'invest', 'bau', 'haus', 'fenster', 'kueche', 'bad', 'dach', 'dachdecker', 'garten',
  'landschaftsbau', 'vermoegen', 'erbe', 'erben', 'nachlass', 'firma', 'objekt', 'auftrag', 'angebot', 'kv', 'kostenvoranschlag',
  'rechnung', 'beratung', 'finanzierung', 'kredit', 'service', 'verwaltung', 'gruppe', 'holding', 'handel', 'handels', 'ulm',
  'neu', 'alt', 'kunde', 'kundin', 'privat', 'projekt', 'wohnung', 'mfh', 'efh', 'sanierung', 'renovierung', 'heizung',
  'elektro', 'maler', 'umbau', 'neubau', 'anbau', 'bezahlt', 'offen',
])

// Füllwörter aus Notizen („Name so vom Zettel abgelesen“), die nie einen Namen bezeichnen.
const NOTIZ_LEER = new Set([
  'name', 'namen', 'zettel', 'notiz', 'notizzettel', 'abgelesen', 'gelesen', 'abgekuerzt', 'markiert', 'unsicher',
  'handschriftlich', 'wollte', 'melden', 'nach', 'dem', 'urlaub', 'auf', 'als', 'so', 'vom', 'bez', 'noch', 'nicht',
  'telefon', 'termin', 'woche', 'monat', 'heute', 'morgen', 'bitte', 'rueckruf', 'anruf',
])

type Art = 'gleich' | 'abkuerzung' | 'initial' | 'anfang' | 'fast'

type KvWort = { wort: string; abgekuerzt: boolean }

/** Wörter des Namens eines Kostenvoranschlags, mit Merkmal „mit Punkt abgekürzt“ („Lachenm.“). */
export function kvWoerter(name: unknown): KvWort[] {
  const roh = grundform(name).replace(/\([^)]*\)/g, ' ')
  const aus: KvWort[] = []
  const gesehen = new Set<string>()
  for (const m of roh.matchAll(/([a-z0-9]+)(\.)?/g)) {
    const wort = m[1]
    const abgekuerzt = !!m[2] && wort.length >= 3 && !/^\d+$/.test(wort)
    if (wort.length < 2 || gesehen.has(wort)) continue
    if (namensWoerter(wort).length === 0) continue // Rechtsform, Anrede, Titel, Füllwort („Dr.“, „GmbH“)
    gesehen.add(wort)
    aus.push({ wort, abgekuerzt })
  }
  return aus
}

/** Initial + folgendes Wort zusammengeschrieben: „W. Leicht“ → „wleicht“. */
function initialFormen(s: unknown): string[] {
  const woerter = grundform(s).replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(Boolean)
  const aus: string[] = []
  for (let i = 0; i + 1 < woerter.length; i++) if (woerter[i].length === 1 && woerter[i + 1].length >= 3) aus.push(woerter[i] + woerter[i + 1])
  return aus
}

function klammerInhalte(s: unknown): string[] {
  return [...String(s ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
}

/** Wörter des Mailnamens vor dem @, z. B. „r.breh69“ → ["breh"] (Ziffern weg, Wörter ab 3 Buchstaben). */
function mailWoerter(email: unknown): string[] {
  const aus: string[] = []
  for (const adr of String(email ?? '').toLowerCase().match(/[a-z0-9._%+-]+@/g) ?? []) {
    for (const w of adr.slice(0, -1).replace(/\d+/g, ' ').split(/[^a-z]+/)) {
      if (w.length >= 3 && namensWoerter(w).length > 0 && !['info', 'office', 'mail', 'kontakt', 'buero', 'buchhaltung', 'service', 'noreply', 'no', 'reply', 'post', 'team'].includes(w)) aus.push(w)
    }
  }
  return aus
}

type AktenWoerter = { namen: Set<string>; initial: Set<string>; mail: Set<string>; vollNamen: string[][] }

function aktenWoerter(a: AkteFuerZuordnung): AktenWoerter {
  const quellen = [a.firma, a.ansprechpartner, ...klammerInhalte(a.firma), ...klammerInhalte(a.ansprechpartner)]
  const namen = new Set<string>()
  for (const q of quellen) for (const w of namensWoerter(q)) namen.add(w)
  const initial = new Set<string>(quellen.flatMap(initialFormen))
  const mail = new Set<string>(mailWoerter(a.email).filter((w) => !namen.has(w)))
  // Volle Namen (mindestens zwei Wörter) für die Suche im Text der Datei.
  const vollNamen = [a.firma, a.ansprechpartner].map((q) => namensWoerter(q)).filter((w) => w.length >= 2)
  return { namen, initial, mail, vollNamen }
}

type WortTreffer = { art: Art; aktenWort: string; ausMail: boolean }

function vergleicheWort(k: KvWort, aw: AktenWoerter): WortTreffer | null {
  let bestes: WortTreffer | null = null
  const rang: Record<Art, number> = { gleich: 5, initial: 4, abkuerzung: 3, anfang: 2, fast: 1 }
  const nimm = (t: WortTreffer) => {
    if (!bestes || rang[t.art] > rang[bestes.art] || (rang[t.art] === rang[bestes.art] && bestes.ausMail && !t.ausMail)) bestes = t
  }
  const pruefe = (w: string, ausMail: boolean) => {
    const t = k.wort
    if (w === t) return nimm({ art: 'gleich', aktenWort: w, ausMail })
    if (k.abgekuerzt) {
      if (w.startsWith(t)) return nimm({ art: 'abkuerzung', aktenWort: w, ausMail })
      if (t.length >= 6 && w.length > t.length && abstand(t, w.slice(0, t.length), 1) <= 1) return nimm({ art: 'abkuerzung', aktenWort: w, ausMail })
      return
    }
    if (t.length >= 5 && w.length > t.length && w.startsWith(t)) return nimm({ art: 'anfang', aktenWort: w, ausMail })
    const kurz = Math.min(t.length, w.length)
    if (kurz >= 6) {
      const d = abstand(t, w, 2)
      if (d <= 1 || (kurz >= 9 && d <= 2)) nimm({ art: 'fast', aktenWort: w, ausMail })
    }
  }
  for (const w of aw.namen) pruefe(w, false)
  if (!k.abgekuerzt && aw.initial.has(k.wort)) nimm({ art: 'initial', aktenWort: k.wort, ausMail: false })
  for (const w of aw.mail) pruefe(w, true)
  return bestes
}

const ART_TEXT: Record<Art, string> = {
  gleich: 'gleich',
  initial: 'Initial und Name zusammengeschrieben',
  abkuerzung: 'abgekürzt',
  anfang: 'Wortanfang gleich',
  fast: 'fast gleich geschrieben',
}

/** Punkte für ein einzelnes passendes Namenswort, je nach Art und wie viele Akten dieses Wort haben. */
function einzelPunkte(art: Art, laenge: number, haeufigkeit: number): number {
  const basis = art === 'gleich' || art === 'initial' ? 65 : art === 'abkuerzung' ? (laenge >= 4 ? 60 : 50) : art === 'anfang' ? 58 : 52
  const abzug = haeufigkeit <= 1 ? 0 : haeufigkeit === 2 ? 5 : haeufigkeit === 3 ? 13 : 30
  return basis - abzug
}

export type KvZuordnungsOptionen = {
  /** Wie oft jedes Namenswort unter allen Akten vorkommt (sonst aus `akten` gezählt). */
  haeufigkeit?: Map<string, number>
}

/** Zählt je Wort, in wie vielen Akten es im Namen steht (Sammelakten ausgenommen). */
export function wortHaeufigkeit(akten: AkteFuerZuordnung[]): Map<string, number> {
  const h = new Map<string, number>()
  for (const a of akten) {
    if (SAMMELAKTEN_IDS.includes(a.id)) continue
    const aw = aktenWoerter(a)
    for (const w of new Set([...aw.namen, ...aw.initial, ...aw.mail])) h.set(w, (h.get(w) ?? 0) + 1)
  }
  return h
}

function istPrivatKv(kv: Pick<KvFuerZuordnung, 'bereich' | 'privat_besitzer'>): boolean {
  return kv.bereich === 'privat' || !!String(kv.privat_besitzer ?? '').trim()
}

/** Darf der Eintrag dieser Akte zugeordnet werden, ohne dass sich ändert, wer ihn sieht? */
export function passtSichtbarkeit(kv: Pick<KvFuerZuordnung, 'bereich' | 'privat_besitzer'>, akte: Pick<AkteFuerZuordnung, 'id' | 'bereich' | 'verantwortlich_email'>): boolean {
  if (SAMMELAKTEN_IDS.includes(akte.id)) return false
  const akteprivat = akte.bereich === 'privat'
  if (!istPrivatKv(kv)) return !akteprivat
  if (!akteprivat) return false
  const besitzer = String(kv.privat_besitzer ?? '').trim().toLowerCase()
  return !!besitzer && besitzer === String(akte.verantwortlich_email ?? '').trim().toLowerCase()
}

function textWoerter(text: unknown): Set<string> {
  return new Set(grundform(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2))
}

/** Punkte und Gründe für ein Paar Kostenvoranschlag ↔ Akte (ohne Mindestgrenze, ohne Stufe). */
export function bewerteKvAkte(
  kv: KvFuerZuordnung,
  akte: AkteFuerZuordnung,
  haeufigkeit: Map<string, number>,
  dokumentTextNutzen = true,
): { punkte: number; gruende: string[] } {
  const aw = aktenWoerter(akte)
  const gruende: string[] = []
  let haupt = 0

  // 1. Namenswörter
  const woerter = kvWoerter(kv.name)
  const besondere = woerter.filter((w) => !ALLGEMEIN.has(w.wort))
  const treffer: { k: KvWort; t: WortTreffer }[] = []
  for (const k of besondere) {
    const t = vergleicheWort(k, aw)
    if (t) treffer.push({ k, t })
  }
  if (treffer.length >= 2) {
    const alleStark = treffer.every((x) => x.t.art === 'gleich' || x.t.art === 'initial' || x.t.art === 'abkuerzung')
    const alleWoerter = treffer.length === besondere.length
    const akteGanz = [...aw.namen].filter((w) => !ALLGEMEIN.has(w)).every((w) => treffer.some((x) => x.t.aktenWort === w))
    haupt = alleStark ? (alleWoerter ? (akteGanz ? 95 : 90) : 82) : 75
    // Viele Akten mit denselben Wörtern (z. B. drei Akten derselben Firma): nur wahrscheinlich.
    const seltenste = Math.min(...treffer.map((x) => haeufigkeit.get(x.t.aktenWort) ?? 1))
    if (seltenste >= 3) haupt = Math.min(haupt, 70)
    gruende.push(alleWoerter && alleStark ? 'Name gleich' : 'mehrere Namensteile passen')
  } else if (treffer.length === 1) {
    const { k, t } = treffer[0]
    let p = einzelPunkte(t.art, k.wort.length, haeufigkeit.get(t.aktenWort) ?? 1)
    if (t.ausMail) p -= 8
    // Einwort-Name, der genau dem (einzigen) Namen der Akte entspricht („First“ ↔ „first Academy GmbH“ zählt nicht dazu).
    const nurDiesesWort = besondere.length === 1 && woerter.length === 1 && [...aw.namen].filter((w) => !ALLGEMEIN.has(w)).length === 1
    if (nurDiesesWort && t.art === 'gleich' && k.wort.length >= 4) p = Math.max(p, 80)
    if (k.wort.length <= 3 && t.art === 'gleich') p = Math.min(p, 45) // „Sv“, „Dfv“: zu kurz für einen eigenen Hinweis
    haupt = p
    const wo = t.ausMail ? ' (in der Mailadresse)' : ''
    gruende.push(
      t.art === 'gleich'
        ? `Namensteil „${k.wort}“ gleich${wo}`
        : t.art === 'initial'
        ? `„${k.wort}“ ist Initial und Name zusammengeschrieben`
        : `„${k.wort}${k.abgekuerzt ? '.' : ''}“ passt zu „${t.aktenWort}“ (${ART_TEXT[t.art]})${wo}`,
    )
  }

  // 2. Allgemeine Wörter (nur als Zusatz)
  let zusatz = 0
  if (haupt > 0) {
    for (const k of woerter.filter((w) => ALLGEMEIN.has(w.wort))) if (aw.namen.has(k.wort)) zusatz += 5
  }

  // 3. Verknüpfte Datei liegt in dieser Akte
  if (kv.dokumentKundeId && kv.dokumentKundeId === akte.id && !SAMMELAKTEN_IDS.includes(akte.id)) {
    haupt = haupt > 0 ? Math.max(haupt + 15, 95) : 90
    gruende.unshift('die verknüpfte Datei liegt in dieser Akte')
  }

  // 4. Voller Name der Akte steht im Text der verknüpften Datei
  if (dokumentTextNutzen && kv.dokumentText && aw.vollNamen.length) {
    const tw = textWoerter(kv.dokumentText)
    if (aw.vollNamen.some((n) => n.every((w) => tw.has(w)))) {
      if (haupt > 0) zusatz += 25
      else haupt = 55
      gruende.push('der Name der Akte steht in der verknüpften Datei')
    }
  }

  // 5. Seltenes Wort aus Beschreibung/Notiz steht im Namen der Akte (nur als Zusatz)
  if (haupt > 0) {
    const name = new Set(woerter.map((w) => w.wort))
    const extra = new Set(
      `${kv.beschreibung ?? ''} ${kv.notiz ?? ''}`
        .split(/\s+/)
        .flatMap((s) => namensWoerter(s))
        .filter((w) => w.length >= 5 && !name.has(w) && !ALLGEMEIN.has(w) && !NOTIZ_LEER.has(w)),
    )
    const passend = [...extra].filter((w) => aw.namen.has(w) && (haeufigkeit.get(w) ?? 1) <= 2)
    if (passend.length) {
      zusatz += 10
      gruende.push(`„${passend[0]}“ aus Beschreibung oder Notiz steht im Namen der Akte`)
    }
  }

  return { punkte: Math.max(0, Math.min(100, haupt + zusatz)), gruende }
}

/** Vorschläge für einen Kostenvoranschlag (stärkste zuerst, höchstens drei, nur ab „wahrscheinlich“). */
export function findeKvKandidaten(kv: KvFuerZuordnung, akten: AkteFuerZuordnung[], opt: KvZuordnungsOptionen & { dokumentTextNutzen?: boolean } = {}): KvKandidat[] {
  const h = opt.haeufigkeit ?? wortHaeufigkeit(akten)
  const roh: { kunde_id: string; punkte: number; gruende: string[] }[] = []
  for (const a of akten) {
    if (!a?.id || !passtSichtbarkeit(kv, a)) continue
    const b = bewerteKvAkte(kv, a, h, opt.dokumentTextNutzen !== false)
    if (b.punkte >= WAHRSCHEINLICH_AB) roh.push({ kunde_id: a.id, ...b })
  }
  roh.sort((x, y) => y.punkte - x.punkte || x.kunde_id.localeCompare(y.kunde_id))
  const sichere = roh.filter((r) => r.punkte >= SICHER_AB).length
  return roh.slice(0, HOECHSTENS_KANDIDATEN).map((r, i) => {
    const sicher = r.punkte >= SICHER_AB && sichere === 1 && i === 0
    const gruende = r.punkte >= SICHER_AB && sichere > 1 ? [...r.gruende, 'mehrere Akten passen gleich gut'] : r.gruende
    return { kunde_id: r.kunde_id, stufe: sicher ? 'sicher' : 'wahrscheinlich', punkte: r.punkte, gruende }
  })
}

/**
 * Vorschläge für viele Kostenvoranschläge auf einmal. Der Text einer verknüpften Datei zählt nur, wenn die
 * Datei zu genau einem der Einträge gehört (eine Liste mit vielen Namen passte sonst zu jedem).
 */
export function kvZuordnungsVorschlaege(kvs: KvFuerZuordnung[], akten: AkteFuerZuordnung[]): KvVorschlag[] {
  const h = wortHaeufigkeit(akten)
  const dateiAnzahl = new Map<string, number>()
  for (const kv of kvs) if (kv.dokumentId) dateiAnzahl.set(kv.dokumentId, (dateiAnzahl.get(kv.dokumentId) ?? 0) + 1)
  return kvs.map((kv) => ({
    kv_id: kv.id,
    kandidaten: findeKvKandidaten(kv, akten, { haeufigkeit: h, dokumentTextNutzen: !kv.dokumentId || (dateiAnzahl.get(kv.dokumentId) ?? 0) <= 1 }),
  }))
}

/** Zählt Einträge mit sicherem, nur wahrscheinlichem und ohne Vorschlag. */
export function kvZaehler(v: KvVorschlag[]): { gesamt: number; sicher: number; wahrscheinlich: number; ohne: number } {
  const sicher = v.filter((x) => x.kandidaten[0]?.stufe === 'sicher').length
  const wahrscheinlich = v.filter((x) => x.kandidaten.length > 0 && x.kandidaten[0].stufe !== 'sicher').length
  return { gesamt: v.length, sicher, wahrscheinlich, ohne: v.length - sicher - wahrscheinlich }
}
