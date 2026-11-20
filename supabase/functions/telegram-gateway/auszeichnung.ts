// Einfache Auszeichnung, in der der Assistent Dokumente schreibt ("## " Überschrift, "- " Punkt,
// "1. " nummeriert, **fett**, *kursiv*, "---" Linie, "| a | b |" Tabelle). Zerlegt wird sie hier, gesetzt
// in dokumentErstellen.ts (PDF) und dateiFormate.ts (Word). Reine Funktionen ohne Datenbank.

export type Lauf = { text: string; fett: boolean; kursiv: boolean }

export type Block =
  | { art: 'ueberschrift'; ebene: number; text: string }
  | { art: 'absatz'; zeilen: string[] }
  | { art: 'punkt'; ebene: number; marke: string | null; zeilen: string[] }
  | { art: 'zitat'; zeilen: string[] }
  | { art: 'tabelle'; zeilen: string[][] }
  | { art: 'linie' }
  | { art: 'leer' }

/** Inline-Auszeichnung: **fett**, __fett__, *kursiv*, `Code` (nur Text), [Text](Adresse). */
export function laeufe(s: string, basis: { fett: boolean; kursiv: boolean } = { fett: false, kursiv: false }): Lauf[] {
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)').replace(/`([^`]+)`/g, '$1')
  const aus: Lauf[] = []
  const muster = /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g
  let pos = 0
  for (const m of s.matchAll(muster)) {
    if (m.index! > pos) aus.push({ text: s.slice(pos, m.index), ...basis })
    if (m[1] !== undefined || m[2] !== undefined) aus.push(...laeufe(m[1] ?? m[2], { ...basis, fett: true }))
    else aus.push({ text: m[3], fett: basis.fett, kursiv: true })
    pos = m.index! + m[0].length
  }
  if (pos < s.length) aus.push({ text: s.slice(pos), ...basis })
  return aus.filter((l) => l.text.length > 0)
}

export function zerlege(inhalt: string): Block[] {
  const bloecke: Block[] = []
  const zeilen = inhalt.split('\n')
  const letzter = () => bloecke[bloecke.length - 1]
  for (let i = 0; i < zeilen.length; i++) {
    const roh = zeilen[i].replace(/\s+$/, '')
    const z = roh.trim()
    if (!z) {
      if (letzter() && letzter().art !== 'leer') bloecke.push({ art: 'leer' })
      continue
    }
    const einzug = (roh.match(/^ */)?.[0].length ?? 0)
    let m: RegExpMatchArray | null
    if ((m = z.match(/^(#{1,6})\s+(.*)$/))) {
      bloecke.push({ art: 'ueberschrift', ebene: Math.min(m[1].length, 3), text: m[2].replace(/\s*#+$/, '') })
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(z)) {
      bloecke.push({ art: 'linie' })
    } else if (z.startsWith('|')) {
      const zellen = z.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      if (zellen.every((c) => /^:?-{2,}:?$/.test(c))) continue
      const l = letzter()
      if (l && l.art === 'tabelle') l.zeilen.push(zellen)
      else bloecke.push({ art: 'tabelle', zeilen: [zellen] })
    } else if ((m = z.match(/^[-*•–]\s+(.*)$/))) {
      bloecke.push({ art: 'punkt', ebene: Math.min(Math.floor(einzug / 2), 3), marke: null, zeilen: [m[1]] })
    } else if ((m = z.match(/^(\d{1,3}[.)]|[a-zA-Z][.)])\s+(.*)$/))) {
      bloecke.push({ art: 'punkt', ebene: Math.min(Math.floor(einzug / 2), 3), marke: m[1].replace(')', '.'), zeilen: [m[2]] })
    } else if (z.startsWith('>')) {
      const text = z.replace(/^>\s?/, '')
      const l = letzter()
      if (l && l.art === 'zitat') l.zeilen.push(text)
      else bloecke.push({ art: 'zitat', zeilen: [text] })
    } else {
      // Einzelner Zeilenumbruch bleibt erhalten (Anschrift, Grußformel); eingerückte Folgezeile
      // eines Aufzählungspunkts gehört zu ihm.
      const l = letzter()
      if (l && l.art === 'punkt' && einzug > 0) l.zeilen.push(z)
      else if (l && l.art === 'absatz') l.zeilen.push(z)
      else bloecke.push({ art: 'absatz', zeilen: [z] })
    }
  }
  return bloecke
}

/** Wiederholt der Text den Titel als erste Überschrift, fällt sie weg. */
export function ohneTitelUeberschrift(bloecke: Block[], titel: string): Block[] {
  const vergleich = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')
  const erster = bloecke.find((b) => b.art !== 'leer')
  if (erster && erster.art === 'ueberschrift' && vergleich(erster.text.replace(/\*/g, '')) === vergleich(titel)) return bloecke.slice(bloecke.indexOf(erster) + 1)
  return bloecke
}
