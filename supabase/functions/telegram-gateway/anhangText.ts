// Text aus Word- und Excel-Anhängen (Hotmail-Anhänge im privaten Assistenten, 23.11.2026: eine
// .docx-Übersicht konnte der Assistent nicht öffnen). Gleiche Leseweise wie bueroDateiText in
// email-gateway/index.ts; eingebettete Bilder werden nicht gelesen, das alte .doc-Format nicht unterstützt.
import { strFromU8, unzipSync } from 'npm:fflate@0.8.2'

const entschluesseln = (t: string) =>
  t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')

export function istWord(name: string, typ = ''): boolean {
  return /\.docx$/i.test(name) || typ.includes('wordprocessingml')
}

export function istExcel(name: string, typ = ''): boolean {
  return /\.xlsx$/i.test(name) || typ.includes('spreadsheetml')
}

/** Fließtext einer .docx-Datei; Absätze und Tabellenzeilen bleiben Zeilen. */
export function wordText(bytes: Uint8Array): string {
  const dateien = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
  const xml = dateien['word/document.xml']
  if (!xml) throw new Error('keine Word-Datei im .docx-Format')
  return strFromU8(xml)
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .split(/<\/w:p>/)
    .map((absatz) => entschluesseln([...absatz.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|(\t)|(\n)/g)].map((m) => m[1] ?? m[2] ?? m[3]).join('')).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Zellen einer .xlsx-Datei als Text: je Blatt eine Überschrift, je Zeile Zellen durch Tabulator getrennt. */
export function excelText(bytes: Uint8Array): string {
  const dateien = unzipSync(bytes, { filter: (f) => f.name === 'xl/sharedStrings.xml' || f.name === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) })
  const geteilt = dateien['xl/sharedStrings.xml']
    ? [...strFromU8(dateien['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => entschluesseln([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')))
    : []
  const namen = dateien['xl/workbook.xml'] ? [...strFromU8(dateien['xl/workbook.xml']).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => entschluesseln(m[1])) : []
  const blaetter = Object.keys(dateien)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  if (!blaetter.length) throw new Error('keine Excel-Datei im .xlsx-Format')
  return blaetter
    .map((datei, i) => {
      const zeilen = [...strFromU8(dateien[datei]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
        .map((r) =>
          [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
            .map((c) => {
              const v = c[2]?.match(/<v>([^<]*)<\/v>/)?.[1] ?? c[2]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? ''
              return /t="s"/.test(c[1]) ? geteilt[Number(v)] ?? '' : entschluesseln(v)
            })
            .join('\t')
            .trimEnd(),
        )
        .filter((z) => z.trim())
      return `=== Tabellenblatt: ${namen[i] ?? i + 1} ===\n${zeilen.join('\n') || '(leer)'}`
    })
    .join('\n\n')
}

/** Text eines Word-/Excel-Anhangs oder null, wenn es keiner ist. Wirft bei kaputten Dateien. */
export function bueroAnhangText(name: string, typ: string, bytes: Uint8Array, max = 15000): string | null {
  const text = istWord(name, typ) ? wordText(bytes) : istExcel(name, typ) ? excelText(bytes) : null
  if (text === null) return null
  return text.length > max ? `${text.slice(0, max)}\n… (gekürzt: die Datei ist länger, als hier gelesen wurde)` : text
}
