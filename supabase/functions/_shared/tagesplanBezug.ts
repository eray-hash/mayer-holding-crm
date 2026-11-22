// Welche Akte oder welches Objekt meint ein To-do? — vorsichtige Zuordnung über Namen, für den Import von Quirins
// To-do-Liste und als Vorschlag im Tagesablauf („Bezug vermutet – übernehmen?“). Nur eindeutige Treffer zählen:
//
// - Aus dem Objektnamen (bzw. Firma/Ansprechpartner der Akte) werden die kennzeichnenden Wörter genommen — Orte
//   und Namen, ohne Allerweltswörter wie „Objekt“, „Wohnung“, „Haus“, „Makler“.
// - Ein Wort im To-do-Text trifft genau, wenn es gleich ist oder der Anfang des anderen (mind. 5 Buchstaben, höchstens
//   3 Buchstaben länger: „Karlstr“ ↔ „Karlstraße“); unscharf bei Wörtern ab 5 Buchstaben mit höchstens 2 Tippfehlern
//   und gleichem Anfangsbuchstaben („Otilie“ ↔ „Ottilye“). Unscharfe Treffer zählen nur, wenn derselbe Kandidat auch
//   ein genaues Wort hat („Otilie Mayr“ → „Ottilye Mayr“, aber „stellen“ allein nie → „Stehle“).
// - Gewicht: Wörter ab 6 Buchstaben zählen 2, kürzere 1. Treffer nur ab Gewicht 2 und nur, wenn kein anderer
//   Kandidat gleich gut ist („Fördermittel für Vöhringen und Aislingen“ → zwei Objekte → kein Bezug) und kein anderer
//   Kandidat ein ganz anderes Wort trifft („alte Projekte Tosic/Donaueschingen“ → zwei Sachen → kein Bezug).

import type { PlanBezug } from './tagesplanKern.ts'

export type BezugKandidat = { art: 'objekt' | 'kunde'; id: string; name: string; bereich?: string; woerter?: string[] }

export type BezugTreffer = { bezug: PlanBezug; gewicht: number; woerter: string[] } | null

const ALLERWELT = new Set([
  'objekt', 'objekte', 'wohnung', 'wohnungen', 'haus', 'häuser', 'immo', 'immos', 'immobilie', 'immobilien', 'projekt', 'projekte',
  'makler', 'maklerin', 'mehrere', 'raum', 'grundstück', 'exposé', 'expose', 'angebot', 'archiv', 'einstieg', 'zwei', 'drei',
  'will', 'aktuell', 'nicht', 'verkaufen', 'ordner', 'grauer', 'wertermittlung', 'einwertung', 'büro', 'neue', 'neuer', 'kunde',
  'kunden', 'firma', 'gmbh', 'holding', 'mayer', 'straße', 'strasse', 'str', 'hotel', 'hotels', 'quartiersentwicklung', 'boardinghouse',
  'wohnpark', 'ladenfläche', 'großprojekte', 'mit', 'und', 'der', 'die', 'das', 'für', 'von', 'vom', 'zum', 'zur', 'ein', 'eine',
  'einen', 'auf', 'aus', 'bei', 'nach', 'über', 'unter', 'beim', 'immobilienrecherche', 'wohnportfolio', 'campus', 'residenz', 'gasthof',
  'türkei', 'berlin', 'münchen', 'grundstücke', 'kontakt', 'kontakte', 'kontaktdaten', 'intern', 'interne', 'liste', 'umgebung', 'gesuch', 'absender', 'eintragen', 'bitte', 'buchhaltung', 'gastro',
])

export function woerterVon(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[–—]/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4 && !ALLERWELT.has(w))
}

/** Die kennzeichnenden Wörter eines Kandidaten: aus dem Objektnamen bzw. Firma und Ansprechpartner der Akte. */
export function schluesselWoerter(k: Pick<BezugKandidat, 'art' | 'name'> & { woerter?: string[] }): string[] {
  if (k.woerter?.length) return [...new Set(k.woerter.map((w) => w.toLowerCase()))]
  return [...new Set(woerterVon(String(k.name ?? '')))]
}

function abstand(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const vorher = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const jetzt = [i]
    for (let j = 1; j <= b.length; j++) jetzt[j] = Math.min(vorher[j] + 1, jetzt[j - 1] + 1, vorher[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    for (let j = 0; j <= b.length; j++) vorher[j] = jetzt[j]
  }
  return vorher[b.length]
}

/** 'genau' (gleich oder Wortanfang), 'unscharf' (Tippfehler) oder null. */
export function wortTrifft(textWort: string, schluessel: string): 'genau' | 'unscharf' | null {
  if (textWort === schluessel) return 'genau'
  const [kurz, lang] = textWort.length <= schluessel.length ? [textWort, schluessel] : [schluessel, textWort]
  if (kurz.length >= 5 && lang.length - kurz.length <= 3 && lang.startsWith(kurz)) return 'genau'
  return kurz.length >= 5 && textWort[0] === schluessel[0] && abstand(textWort, schluessel) <= 2 ? 'unscharf' : null
}

/** Der eindeutig beste Kandidat für einen Text — oder null. */
export function findeBezugImText(text: string, kandidaten: BezugKandidat[]): BezugTreffer {
  const textWoerter = [...new Set(woerterVon(text))]
  if (!textWoerter.length) return null
  const bewertet = kandidaten
    .map((k) => {
      const genau: string[] = []
      const unscharf: string[] = []
      for (const s of schluesselWoerter(k)) {
        const arten = textWoerter.map((w) => wortTrifft(w, s))
        if (arten.includes('genau')) genau.push(s)
        else if (arten.includes('unscharf')) unscharf.push(s)
      }
      const gefunden = genau.length ? [...genau, ...unscharf] : []
      return { k, gefunden, gewicht: gefunden.reduce((s, w) => s + (w.length >= 6 ? 2 : 1), 0) }
    })
    .filter((x) => x.gewicht >= 1)
    .sort((a, b) => b.gewicht - a.gewicht)
  if (!bewertet.length || bewertet[0].gewicht < 2) return null
  const [erster, ...andere] = bewertet
  for (const x of andere) {
    if (x.k.id === erster.k.id) continue
    if (x.gewicht === erster.gewicht) return null
    // Trifft ein anderer Kandidat nur Wörter, die beim ersten nicht vorkommen, nennt der Text zwei verschiedene Sachen.
    if (!x.gefunden.some((w) => erster.gefunden.includes(w))) return null
  }
  const bezug: PlanBezug = { art: erster.k.art, id: erster.k.id, name: erster.k.name }
  if (erster.k.bereich) bezug.bereich = erster.k.bereich
  return { bezug, gewicht: erster.gewicht, woerter: erster.gefunden }
}

/** Ist der Bezug-Wert aus der Datenbank (todos.bezug, jsonb) gültig? */
export function alsBezug(wert: unknown): PlanBezug | null {
  if (!wert || typeof wert !== 'object') return null
  const w = wert as Record<string, unknown>
  if ((w.art !== 'objekt' && w.art !== 'kunde') || typeof w.id !== 'string' || !w.id) return null
  const b: PlanBezug = { art: w.art, id: w.id, name: typeof w.name === 'string' ? w.name : w.id }
  if (typeof w.bereich === 'string' && w.bereich) b.bereich = w.bereich
  return b
}
