// Word- und Excel-Dateien für den Assistenten (dokument_erstellen mit format "word", tabelle_erstellen).
// Anlass: Am 20.11.2026 schickte ein Mitarbeiter das Foto einer Liste und wollte daraus eine Excel-Datei
// mit zwei Spalten — der Assistent konnte nur PDFs. Bewusst ohne große Bibliothek (die Funktion hat
// beim Bündeln eine Größengrenze): Die Dateien sind ZIP-Archive mit ein paar XML-Teilen (Office Open
// XML), gepackt mit fflate, das XML schreiben wir selbst. Reine Funktionen ohne Datenbank und Netz,
// geprüft in dateiFormate.test.ts.
//
// Word hält sich streng an die Reihenfolge der Kind-Elemente (pPr, rPr, tblPr …) aus dem Schema; wer
// hier etwas ergänzt, muss die Reihenfolge einhalten, sonst meldet Word „Datei beschädigt“.
//
// Holding-Dokumente (seit 24.11.2026) entstehen nicht frei, sondern auf der echten Word-Vorlage des
// Briefbogens (erstelleHoldingDocx, holdingDocx.ts): Dafür lassen sich Formatvorlagen und Listen hier mit
// einem Namensvorsatz bzw. Nummern-Versatz erzeugen (WortStil), damit sie nicht mit denen der Vorlage
// zusammenstoßen.

import { strFromU8, strToU8, unzipSync, zipSync } from 'npm:fflate@0.8.2'
import { type Block, laeufe, type Lauf, ohneTitelUeberschrift, zerlege } from './auszeichnung.ts'

export const DOCX_TYP = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_TYP = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ---------- Gemeinsam ----------

const XML_KOPF = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Text für XML: maskiert & < > " und wirft Zeichen weg, die XML nicht erlaubt (Steuerzeichen, halbe Ersatzzeichen). */
export function xmlText(s: string): string {
  return String(s)
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function zip(teile: Record<string, string>): Uint8Array {
  const dateien: Record<string, Uint8Array> = {}
  for (const [pfad, xml] of Object.entries(teile)) dateien[pfad] = strToU8(xml)
  return zipSync(dateien, { level: 6 })
}

function kernEigenschaften(titel: string, urheber: string, jetzt: Date): string {
  const zeit = jetzt.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return (
    XML_KOPF +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlText(titel)}</dc:title><dc:creator>${xmlText(urheber)}</dc:creator><cp:lastModifiedBy>${xmlText(urheber)}</cp:lastModifiedBy><dc:language>de-DE</dc:language>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${zeit}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${zeit}</dcterms:modified>` +
    '</cp:coreProperties>'
  )
}

function anwendungsEigenschaften(urheber: string): string {
  return XML_KOPF + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlText(`${urheber} – CRM`)}</Application></Properties>`
}

function paketBeziehungen(hauptteil: string): string {
  return (
    XML_KOPF +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${hauptteil}"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>'
  )
}

// ---------- Word ----------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

// Farben wie im PDF (dokumentErstellen.ts).
const AKZENT = '21456B'
const GRAU = '6B6B6B'
const LINIE = 'C7C7C7'
const TABELLEN_KOPF = 'F2F2F2'

// A4 in Zwanzigstel Punkt; Textbreite = Seite minus Ränder.
const SEITE = { breite: 11906, hoehe: 16838, links: 1280, rechts: 1280, oben: 1701, unten: 1418 }
const TEXTBREITE = SEITE.breite - SEITE.links - SEITE.rechts

/** Wie Formatvorlagen und Listen heißen: frei (eigene Datei) oder mit Vorsatz in einer fremden Vorlage. */
export type WortStil = {
  /** Vorsatz vor allen eigenen Formatvorlagen-IDs, z. B. "Crm" → "CrmHeading1". */
  praefix: string
  /** Formatvorlage für schlichte Absätze; leer = Standard der Datei. */
  standard: string
  /** Erste freie abstractNumId (in einer Vorlage: direkt nach deren höchster). */
  abstraktBasis: number
  /** Höchste schon vergebene numId (0 = keine). Ohne Lücke weiterzählen: Apples Vorschau verliert sonst die Aufzählungszeichen. */
  numBasis: number
  /** Breite von Tabellen in Zwanzigstel Punkt. */
  tabellenBreite: number
}

const STIL_EIGEN: WortStil = { praefix: '', standard: '', abstraktBasis: 0, numBasis: 0, tabellenBreite: TEXTBREITE }

export type WordKopf = {
  /** Erste Kopfzeile (fett, Akzentfarbe): Firmenname oder bei privaten Akten der Name des Besitzers. */
  name: string
  /** Zweite, kleine Zeile (Anschrift); leer bei privaten Akten. */
  zeile?: string
}

export type WordEingabe = {
  titel: string
  /** Text in der einfachen Auszeichnung (auszeichnung.ts). */
  inhalt: string
  /** Angezeigte Dokumentart über dem Titel, z. B. "Merkblatt". */
  artName: string
  /** "Für: …" unter dem Titel; leer bei Sammelakten. */
  fuer?: string
  /** "Stand: …" — schon fertig formatiert, z. B. "20. November 2026". */
  stand: string
  kopf: WordKopf
  urheber: string
  jetzt?: Date
}

/** Ein Textlauf; Tabulatoren werden echte Word-Tabs. */
function wLauf(text: string, eig: { fett?: boolean; kursiv?: boolean; farbe?: string; groesse?: number; sperren?: number } = {}): string {
  const rPr =
    (eig.fett ? '<w:b/>' : '') +
    (eig.kursiv ? '<w:i/>' : '') +
    (eig.farbe ? `<w:color w:val="${eig.farbe}"/>` : '') +
    (eig.sperren ? `<w:spacing w:val="${eig.sperren}"/>` : '') +
    (eig.groesse ? `<w:sz w:val="${eig.groesse}"/><w:szCs w:val="${eig.groesse}"/>` : '')
  const inhalt = text
    .split('\t')
    .map((t) => (t ? `<w:t xml:space="preserve">${xmlText(t)}</w:t>` : ''))
    .join('<w:tab/>')
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${inhalt}</w:r>`
}

function wLaeufe(l: Lauf[], eig: { farbe?: string; groesse?: number } = {}): string {
  return l.map((x) => wLauf(x.text, { ...eig, fett: x.fett, kursiv: x.kursiv })).join('')
}

/** Mehrere Zeilen in einem Absatz, getrennt durch einen weichen Zeilenumbruch. */
function wZeilen(zeilen: string[], basis?: { fett: boolean; kursiv: boolean }, eig: { farbe?: string; groesse?: number } = {}): string {
  return zeilen.map((z) => wLaeufe(laeufe(z, basis), eig)).join('<w:r><w:br/></w:r>')
}

function wAbsatz(pPr: string, laeufeXml: string): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${laeufeXml}</w:p>`
}

type Liste = { abstraktId: number; numId: number; ebenen: Map<number, { format: string; start: number }> }

/** Marke "3." → dezimal ab 3, "b." → Kleinbuchstaben ab 2, "C." → Großbuchstaben ab 3. */
function markeFormat(marke: string): { format: string; start: number } {
  const kern = marke.replace(/[.)]$/, '')
  if (/^\d+$/.test(kern)) return { format: 'decimal', start: Math.max(1, Number(kern)) }
  const z = kern.toLowerCase().charCodeAt(0) - 96
  return { format: kern === kern.toLowerCase() ? 'lowerLetter' : 'upperLetter', start: Math.max(1, z) }
}

function wTabelle(zeilen: string[][], st: WortStil): string {
  const breite = st.tabellenBreite
  const std = st.standard ? `<w:pStyle w:val="${st.standard}"/>` : ''
  const spalten = Math.max(1, ...zeilen.map((z) => z.length))
  // Spaltenbreiten nach dem längsten Inhalt (Zeichen), jede mindestens 12 % der Breite.
  const natuerlich = Array.from({ length: spalten }, (_, c) => Math.max(4, ...zeilen.map((z) => (z[c] ?? '').replace(/\*/g, '').length)))
  const summe = natuerlich.reduce((a, b) => a + b, 0)
  let breiten = natuerlich.map((w) => Math.max(0.12, w / summe))
  const skal = 1 / breiten.reduce((a, b) => a + b, 0)
  breiten = breiten.map((w) => Math.floor(w * skal * breite))
  const mitKopf = zeilen.length > 1
  const zeilenXml = zeilen
    .map((z, r) => {
      const kopf = r === 0 && mitKopf
      const zellen = breiten
        .map((b, c) => {
          const tcPr = `<w:tcW w:w="${b}" w:type="dxa"/>${kopf ? `<w:shd w:val="clear" w:color="auto" w:fill="${TABELLEN_KOPF}"/>` : ''}`
          const text = wLaeufe(laeufe(z[c] ?? '', { fett: kopf, kursiv: false }))
          return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${wAbsatz(`${std}<w:spacing w:before="0" w:after="0"/>`, text)}</w:tc>`
        })
        .join('')
      return `<w:tr><w:trPr><w:cantSplit/>${kopf ? '<w:tblHeader/>' : ''}</w:trPr>${zellen}</w:tr>`
    })
    .join('')
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="${st.praefix}TabelleRaster"/><w:tblW w:w="${breite}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${breiten.map((b) => `<w:gridCol w:w="${b}"/>`).join('')}</w:tblGrid>${zeilenXml}</w:tbl>` +
    // Abstand nach der Tabelle; außerdem darf eine Tabelle nicht direkt an eine zweite oder ans Ende stoßen.
    wAbsatz(`${std}<w:spacing w:before="0" w:after="60"/>`, '')
  )
}

/** Inhalt von word/document.xml (ohne sectPr) und die nummerierten Listen dafür. */
function wKoerper(bloecke: Block[], st: WortStil = STIL_EIGEN): { xml: string; listen: Liste[] } {
  const ps = (id: string) => `<w:pStyle w:val="${st.praefix}${id}"/>`
  const std = st.standard ? `<w:pStyle w:val="${st.standard}"/>` : ''
  const listen: Liste[] = []
  let aktuelle: Liste | null = null
  const teile: string[] = []
  let schonInhalt = false
  for (let i = 0; i < bloecke.length; i++) {
    const b = bloecke[i]
    const naechster = bloecke.slice(i + 1).find((x) => x.art !== 'leer')
    if (b.art === 'leer') continue
    // Eine nummerierte Liste läuft weiter über Leerzeilen und eingeschobene Aufzählungspunkte; alles andere beendet sie.
    if (b.art !== 'punkt') aktuelle = null
    if (b.art === 'ueberschrift') {
      teile.push(wAbsatz(ps(`Heading${b.ebene}`), wLaeufe(laeufe(b.text))))
    } else if (b.art === 'linie') {
      if (!schonInhalt) continue
      teile.push(wAbsatz(`${std}<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${LINIE}"/></w:pBdr><w:spacing w:before="0" w:after="200"/>`, ''))
    } else if (b.art === 'absatz') {
      teile.push(wAbsatz(std, wZeilen(b.zeilen)))
    } else if (b.art === 'zitat') {
      teile.push(wAbsatz(ps('Zitat'), wZeilen(b.zeilen)))
    } else if (b.art === 'tabelle') {
      teile.push(wTabelle(b.zeilen, st))
    } else if (b.art === 'punkt') {
      let numId = st.numBasis + 1
      if (b.marke) {
        if (!aktuelle) {
          aktuelle = { abstraktId: st.abstraktBasis + listen.length + 1, numId: st.numBasis + listen.length + 2, ebenen: new Map() }
          listen.push(aktuelle)
        }
        if (!aktuelle.ebenen.has(b.ebene)) aktuelle.ebenen.set(b.ebene, markeFormat(b.marke))
        numId = aktuelle.numId
      }
      const letzter = !naechster || naechster.art !== 'punkt'
      teile.push(
        wAbsatz(
          `${ps('Listenabsatz')}<w:numPr><w:ilvl w:val="${b.ebene}"/><w:numId w:val="${numId}"/></w:numPr>${letzter ? '<w:spacing w:after="140"/>' : ''}`,
          wZeilen(b.zeilen),
        ),
      )
    }
    schonInhalt = true
  }
  return { xml: teile.join(''), listen }
}

/** abstractNum- und num-Elemente (getrennt, weil in numbering.xml alle abstractNum vor den num stehen müssen). */
function wNummerierungTeile(listen: Liste[], st: WortStil = STIL_EIGEN): { abstrakt: string; nums: string } {
  const EINZUG = 360
  const ebene = (ilvl: number, format: string, text: string, start = 1, rPr = '') =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="${start}"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${xmlText(text)}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${EINZUG + ilvl * EINZUG}" w:hanging="${format === 'bullet' ? 284 : 360}"/></w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:lvl>`
  // Aufzählungszeichen wie im PDF: • (Akzentfarbe), –, ·, ·
  const punkte = ['•', '–', '·', '·']
  const aufzaehlung =
    `<w:abstractNum w:abstractNumId="${st.abstraktBasis}"><w:multiLevelType w:val="hybridMultilevel"/>` +
    punkte.map((p, i) => ebene(i, 'bullet', p, 1, `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/>${i === 0 ? `<w:color w:val="${AKZENT}"/>` : ''}`)).join('') +
    '</w:abstractNum>'
  const nummern = listen
    .map((l) => {
      const lvls = [0, 1, 2, 3]
        .map((i) => {
          // Ebenen ohne Marke im Text: dezimal, darunter Buchstaben — wie man es erwarten würde.
          const e = l.ebenen.get(i) ?? { format: i % 2 === 0 ? 'decimal' : 'lowerLetter', start: 1 }
          return ebene(i, e.format, `%${i + 1}.`, e.start)
        })
        .join('')
      return `<w:abstractNum w:abstractNumId="${l.abstraktId}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`
    })
    .join('')
  const nums = `<w:num w:numId="${st.numBasis + 1}"><w:abstractNumId w:val="${st.abstraktBasis}"/></w:num>` + listen.map((l) => `<w:num w:numId="${l.numId}"><w:abstractNumId w:val="${l.abstraktId}"/></w:num>`).join('')
  return { abstrakt: aufzaehlung + nummern, nums }
}

function wNummerierung(listen: Liste[]): string {
  const t = wNummerierungTeile(listen)
  return XML_KOPF + `<w:numbering ${W_NS}>${t.abstrakt}${t.nums}</w:numbering>`
}

/** Deutsche Namen der eigenen Formatvorlagen, wenn sie in einer fremden Vorlage stehen (dort sichtbar in Word). */
const DE_NAME: Record<string, string> = {
  Titel: 'Titel', Heading1: 'Überschrift 1', Heading2: 'Überschrift 2', Heading3: 'Überschrift 3', Listenabsatz: 'Liste', Zitat: 'Zitat', TabelleRaster: 'Tabelle',
}

const SCHRIFT_RPR = '<w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="212121"/><w:sz w:val="21"/><w:szCs w:val="21"/>'

/** Formatvorlagen für den Inhalt (Titel, Überschriften, Liste, Zitat, Tabelle) — frei oder mit Vorsatz für eine fremde Vorlage. */
function wInhaltsVorlagen(st: WortStil): string {
  const p = st.praefix
  // In einer fremden Vorlage eigene Namen (Word verlangt eindeutige Namen) und eine eigene Grundvorlage mit Schrift und Abständen.
  const basis = st.standard || 'Standard'
  const absatzVorlage = (id: string, name: string, pPr: string, rPr: string, extra = '') =>
    `<w:style w:type="paragraph"${p ? ' w:customStyle="1"' : ''} w:styleId="${p}${id}"><w:name w:val="${p ? `CRM ${DE_NAME[id] ?? id}` : name}"/><w:basedOn w:val="${basis}"/><w:next w:val="${basis}"/>${extra}<w:qFormat/>` +
    `${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`
  const grund = st.standard
    ? `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${st.standard}"><w:name w:val="CRM Standard"/><w:qFormat/>` +
      '<w:pPr><w:widowControl/><w:spacing w:before="0" w:after="140" w:line="276" w:lineRule="auto"/></w:pPr>' +
      `<w:rPr>${SCHRIFT_RPR}<w:lang w:val="de-DE" w:eastAsia="de-DE" w:bidi="ar-SA"/></w:rPr></w:style>`
    : ''
  const tabellenRand =
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>'
  return (
    grund +
    absatzVorlage('Titel', 'Title', '<w:keepNext/><w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/>', `<w:b/><w:color w:val="${AKZENT}"/><w:sz w:val="38"/><w:szCs w:val="38"/>`) +
    absatzVorlage('Heading1', 'heading 1', '<w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/>', `<w:b/><w:color w:val="${AKZENT}"/><w:sz w:val="30"/><w:szCs w:val="30"/>`, '<w:uiPriority w:val="9"/>') +
    absatzVorlage('Heading2', 'heading 2', '<w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>', `<w:b/><w:color w:val="${AKZENT}"/><w:sz w:val="26"/><w:szCs w:val="26"/>`, '<w:uiPriority w:val="9"/>') +
    absatzVorlage('Heading3', 'heading 3', '<w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="60"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="23"/><w:szCs w:val="23"/>', '<w:uiPriority w:val="9"/>') +
    absatzVorlage('Listenabsatz', 'List Paragraph', '<w:spacing w:after="60"/><w:contextualSpacing/>', '', '<w:uiPriority w:val="34"/>') +
    absatzVorlage('Zitat', 'Quote', `<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="${LINIE}"/></w:pBdr><w:ind w:left="284"/>`, `<w:i/><w:color w:val="${GRAU}"/>`, '<w:uiPriority w:val="29"/>') +
    `<w:style w:type="table"${p ? ' w:customStyle="1"' : ''} w:styleId="${p}TabelleRaster"><w:name w:val="${p ? `CRM ${DE_NAME.TabelleRaster}` : 'Table Grid'}"/>${p ? '' : '<w:basedOn w:val="NormaleTabelle"/>'}<w:uiPriority w:val="39"/>` +
    '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>' +
    `<w:tblPr>${p ? '<w:tblInd w:w="0" w:type="dxa"/>' : ''}<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${LINIE}"/></w:tblBorders>` +
    `${tabellenRand}</w:tblPr></w:style>`
  )
}

function wFormatvorlagen(): string {
  const absatzVorlage = (id: string, name: string, pPr: string, rPr: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Standard"/><w:next w:val="Standard"/><w:qFormat/>` +
    `${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}</w:style>`
  return (
    XML_KOPF +
    `<w:styles ${W_NS}>` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${SCHRIFT_RPR}<w:lang w:val="de-DE" w:eastAsia="de-DE" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="Absatz-Standardschriftart"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    wInhaltsVorlagen(STIL_EIGEN) +
    absatzVorlage('Kopfzeile', 'header', `<w:tabs><w:tab w:val="right" w:pos="${TEXTBREITE}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>`, '') +
    absatzVorlage('Fusszeile', 'footer', `<w:tabs><w:tab w:val="right" w:pos="${TEXTBREITE}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>`, `<w:color w:val="${GRAU}"/><w:sz w:val="16"/><w:szCs w:val="16"/>`) +
    '<w:style w:type="table" w:default="1" w:styleId="NormaleTabelle"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>'
  )
}

function wKopfzeile(k: WordKopf): string {
  const linie = `<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="${LINIE}"/></w:pBdr>`
  const name = wLauf(k.name, { fett: true, farbe: AKZENT, groesse: 23 })
  const inhalt = k.zeile
    ? wAbsatz('<w:pStyle w:val="Kopfzeile"/>', name) + wAbsatz(`<w:pStyle w:val="Kopfzeile"/>${linie}`, wLauf(k.zeile, { farbe: GRAU, groesse: 16 }))
    : wAbsatz(`<w:pStyle w:val="Kopfzeile"/>${linie}`, name)
  return XML_KOPF + `<w:hdr ${W_NS}>${inhalt}</w:hdr>`
}

function wFusszeile(titel: string): string {
  const fussTitel = titel.length > 70 ? `${titel.slice(0, 68)}…` : titel
  const feld = (befehl: string) => `<w:fldSimple w:instr=" ${befehl} \\* MERGEFORMAT ">${wLauf('1')}</w:fldSimple>`
  const pPr = `<w:pStyle w:val="Fusszeile"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="${LINIE}"/></w:pBdr>`
  return XML_KOPF + `<w:ftr ${W_NS}>${wAbsatz(pPr, `${wLauf(fussTitel)}${wLauf('\t')}${wLauf('Seite ')}${feld('PAGE')}${wLauf(' von ')}${feld('NUMPAGES')}`)}</w:ftr>`
}

/** Erzeugt eine .docx aus der einfachen Auszeichnung, aufgebaut wie die PDF aus erstellePdf. */
/** Art, Titel und „Für/Stand“ über dem Text. ankerLaeufe: zusätzliche Läufe im ersten Absatz (verankerte Formen der Vorlage). */
function wKopfBlock(a: { artName: string; titel: string; fuer?: string; stand: string }, st: WortStil, ankerLaeufe = ''): string {
  const std = st.standard ? `<w:pStyle w:val="${st.standard}"/>` : ''
  const meta = [a.fuer ? `Für: ${a.fuer}` : '', `Stand: ${a.stand}`].filter(Boolean).join('   ·   ')
  return (
    wAbsatz(`${std}<w:spacing w:before="0" w:after="40"/>`, ankerLaeufe + wLauf(a.artName.toUpperCase(), { fett: true, farbe: GRAU, groesse: 16, sperren: 60 })) +
    wAbsatz(`<w:pStyle w:val="${st.praefix}Titel"/>`, wLauf(a.titel)) +
    wAbsatz(`${std}<w:spacing w:before="0" w:after="320"/>`, wLauf(meta, { farbe: GRAU, groesse: 19 }))
  )
}

export function erstelleDocx(a: WordEingabe): Uint8Array {
  const bloecke = ohneTitelUeberschrift(zerlege(a.inhalt), a.titel)
  const koerper = wKoerper(bloecke)
  const kopfBlock = wKopfBlock(a, STIL_EIGEN)
  const sectPr =
    '<w:sectPr><w:headerReference w:type="default" r:id="rIdKopf"/><w:footerReference w:type="default" r:id="rIdFuss"/>' +
    `<w:pgSz w:w="${SEITE.breite}" w:h="${SEITE.hoehe}"/>` +
    `<w:pgMar w:top="${SEITE.oben}" w:right="${SEITE.rechts}" w:bottom="${SEITE.unten}" w:left="${SEITE.links}" w:header="709" w:footer="567" w:gutter="0"/>` +
    '<w:cols w:space="708"/></w:sectPr>'
  const dokument = XML_KOPF + `<w:document ${W_NS}><w:body>${kopfBlock}${koerper.xml}${sectPr}</w:body></w:document>`

  const inhaltsTypen =
    XML_KOPF +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const dokBeziehungen =
    XML_KOPF +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rIdStile" Type="${R}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rIdNummern" Type="${R}/numbering" Target="numbering.xml"/>` +
    `<Relationship Id="rIdEinst" Type="${R}/settings" Target="settings.xml"/>` +
    `<Relationship Id="rIdKopf" Type="${R}/header" Target="header1.xml"/>` +
    `<Relationship Id="rIdFuss" Type="${R}/footer" Target="footer1.xml"/>` +
    '</Relationships>'
  const einstellungen =
    XML_KOPF +
    `<w:settings ${W_NS}><w:defaultTabStop w:val="708"/><w:hyphenationZone w:val="425"/><w:characterSpacingControl w:val="doNotCompress"/>` +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'

  return zip({
    '[Content_Types].xml': inhaltsTypen,
    '_rels/.rels': paketBeziehungen('word/document.xml'),
    'docProps/core.xml': kernEigenschaften(a.titel, a.urheber, a.jetzt ?? new Date()),
    'docProps/app.xml': anwendungsEigenschaften(a.urheber),
    'word/document.xml': dokument,
    'word/_rels/document.xml.rels': dokBeziehungen,
    'word/styles.xml': wFormatvorlagen(),
    'word/numbering.xml': wNummerierung(koerper.listen),
    'word/settings.xml': einstellungen,
    'word/header1.xml': wKopfzeile(a.kopf),
    'word/footer1.xml': wFusszeile(a.titel),
  })
}

// ---------- Word auf dem Holding-Briefbogen ----------
// Seit 24.11.2026: Holding-Dokumente als Word entstehen auf der ECHTEN Word-Vorlage des Briefbogens
// (CRM-Vorlage „Briefbogen AMayer Holding Ulmer Wirtschaftskanzlei“, lädt dokumentErstellen.ts aus dem
// Speicher). Kopf- und Fußzeile der Vorlage bleiben unverändert (Logo, Absenderzeile, Bank, Register).
// Aus dem Text der Vorlage bleibt nur die verankerte Team-Spalte „Ulmer Wirtschaftskanzlei“ (Seite 1,
// Text fließt links daran vorbei); das Brief-Textfeld („Firma“, „Ulm, den …“, Grußblock) und leere
// Rahmen fallen weg. Der Inhalt kommt als normale Absätze mit eigenen Formatvorlagen („CRM …“) dazu.

/** Textfelder der Vorlage, die zum Briefformular gehören und in einem Merkblatt nichts verloren haben. */
const BRIEF_PLATZHALTER = /Ulm, den|\bFirma\b/

/** Seitenränder in Zwanzigstel Punkt: rechts 22 mm (Seite 1 hält die Team-Spalte selbst frei), oben/unten wie im PDF. */
const HOLDING_SEITE = { rechts: 1247, oben: 3005, unten: 1701, links: 1219 }
/** Tabellenbreite: Auf Seite 1 steht ab 153,9 mm die Team-Spalte; so schmal passt eine Tabelle auf jede Seite. */
const HOLDING_TABELLE = 7200
const HOLDING_PRAEFIX = 'Crm'

export type HoldingWordEingabe = Omit<WordEingabe, 'kopf'>

/** Sichtbarer Text eines XML-Stücks (Inhalt aller <w:t>). */
function sichtbarerText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
}

/** Top-level-Blöcke <mc:AlternateContent>…</mc:AlternateContent> bzw. <w:drawing>…</w:drawing> (verschachtelt gezählt). */
function formBloecke(xml: string): string[] {
  const aus: string[] = []
  const muster = /<(\/?)(mc:AlternateContent|w:drawing)(?=[\s>/])[^>]*?(\/?)>/g
  let tiefe = 0
  let start = -1
  let art = ''
  for (const m of xml.matchAll(muster)) {
    if (m[3]) continue
    if (!m[1]) {
      if (tiefe === 0) {
        start = m.index!
        art = m[2]
      }
      if (m[2] === art) tiefe++
    } else if (m[2] === art && tiefe > 0) {
      tiefe--
      if (tiefe === 0) aus.push(xml.slice(start, m.index! + m[0].length))
    }
  }
  return aus
}

function attribut(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

/** Höchste vergebene abstractNumId bzw. numId einer numbering.xml (-1 bzw. 0, wenn keine). */
function hoechsteNummern(xml: string): { abstrakt: number; num: number } {
  let abstrakt = -1
  let num = 0
  for (const m of xml.matchAll(/<w:abstractNum\b[^>]*\sw:abstractNumId="(\d+)"/g)) abstrakt = Math.max(abstrakt, Number(m[1]))
  for (const m of xml.matchAll(/<w:num\b[^>]*\sw:numId="(\d+)"/g)) num = Math.max(num, Number(m[1]))
  return { abstrakt, num }
}

/**
 * Word-Datei auf der echten Briefbogen-Vorlage der Holding. vorlage = die .docx aus dem Speicher.
 * Wirft mit deutschem Text, wenn die Vorlage nicht passt (dann lieber Fehler als ein erfundenes Layout).
 */
export function erstelleHoldingDocx(vorlage: Uint8Array, a: HoldingWordEingabe): Uint8Array {
  let dateien: Record<string, Uint8Array>
  try {
    dateien = unzipSync(vorlage)
  } catch {
    throw new Error('Die Word-Vorlage des Holding-Briefbogens ist keine lesbare Word-Datei')
  }
  const lies = (n: string) => (dateien[n] ? strFromU8(dateien[n]) : '')
  const schreib = (n: string, xml: string) => {
    dateien[n] = strToU8(xml)
  }
  const doc = lies('word/document.xml')
  const bodyAuf = doc.indexOf('<w:body>')
  const bodyZu = doc.lastIndexOf('</w:body>')
  if (bodyAuf < 0 || bodyZu < bodyAuf) throw new Error('Die Word-Vorlage des Holding-Briefbogens hat keinen Dokumentinhalt')
  const body = doc.slice(bodyAuf + '<w:body>'.length, bodyZu)

  // Abschnitt mit der Kopfzeile der Vorlage (Logo + Absenderzeile); nur Standard-Kopf/-Fuß übernehmen.
  const abschnitte = [...body.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g)].map((m) => m[0])
  const abschnitt = abschnitte.find((x) => /<w:headerReference\b[^>]*w:type="default"/.test(x))
  if (!abschnitt) throw new Error('Die Word-Vorlage des Holding-Briefbogens hat keine Kopfzeile')
  const kopfRef = abschnitt.match(/<w:headerReference\b[^>]*w:type="default"[^>]*\/>/)![0]
  const fussRef = abschnitt.match(/<w:footerReference\b[^>]*w:type="default"[^>]*\/>/)?.[0] ?? ''
  const pgSz = abschnitt.match(/<w:pgSz\b[^>]*\/>/)?.[0] ?? `<w:pgSz w:w="${SEITE.breite}" w:h="${SEITE.hoehe}"/>`
  const alterRand = abschnitt.match(/<w:pgMar\b[^>]*\/>/)?.[0] ?? ''
  const zahl = (name: string, vorgabe: number) => {
    const w = Number(attribut(alterRand, `w:${name}`))
    return Number.isFinite(w) && attribut(alterRand, `w:${name}`) !== undefined ? w : vorgabe
  }
  const pgMar =
    `<w:pgMar w:top="${Math.max(HOLDING_SEITE.oben, zahl('top', 0))}" w:right="${HOLDING_SEITE.rechts}" w:bottom="${Math.max(HOLDING_SEITE.unten, zahl('bottom', 0))}" ` +
    `w:left="${zahl('left', HOLDING_SEITE.links)}" w:header="${zahl('header', 680)}" w:footer="${zahl('footer', 720)}" w:gutter="0"/>`
  const docGrid = abschnitt.match(/<w:docGrid\b[^>]*\/>/)?.[0] ?? ''
  const sectPr = `<w:sectPr>${kopfRef}${fussRef}${pgSz}${pgMar}<w:cols w:space="720"/>${docGrid}</w:sectPr>`

  // Verankerte Formen behalten, die nicht zum Briefformular gehören (Team-Spalte); alles andere fällt weg.
  const anker = formBloecke(body).filter((b) => {
    if (!/<wp:anchor\b/.test(b)) return false
    const t = sichtbarerText(b)
    if (BRIEF_PLATZHALTER.test(t)) return false
    return t.trim().length > 0 || /r:embed="/.test(b)
  })
  const ankerLaeufe = anker.map((b) => `<w:r><w:rPr><w:noProof/></w:rPr>${b}</w:r>`).join('')

  // Listen-Nummern über denen der Vorlage, Formatvorlagen mit Vorsatz.
  const nummernAlt = lies('word/numbering.xml')
  const hoechste = hoechsteNummern(nummernAlt)
  const st: WortStil = { praefix: HOLDING_PRAEFIX, standard: `${HOLDING_PRAEFIX}Standard`, abstraktBasis: hoechste.abstrakt + 1, numBasis: hoechste.num, tabellenBreite: HOLDING_TABELLE }
  const koerper = wKoerper(ohneTitelUeberschrift(zerlege(a.inhalt), a.titel), st)
  const kopfBlock = wKopfBlock(a, st, ankerLaeufe)
  schreib('word/document.xml', doc.slice(0, bodyAuf) + `<w:body>${kopfBlock}${koerper.xml}${sectPr}</w:body>` + doc.slice(bodyZu + '</w:body>'.length))

  let typen = lies('[Content_Types].xml')
  let rels = lies('word/_rels/document.xml.rels')
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const sorgeFuerTyp = (teil: string, typ: string) => {
    if (!typen.includes(`PartName="${teil}"`)) typen = typen.replace('</Types>', `<Override PartName="${teil}" ContentType="${typ}"/></Types>`)
  }

  const nummern = wNummerierungTeile(koerper.listen, st)
  if (nummernAlt) {
    const ersterNum = nummernAlt.search(/<w:num\s/)
    const aufraeumen = nummernAlt.search(/<w:numIdMacAtCleanup\b/)
    const ende = aufraeumen >= 0 ? aufraeumen : nummernAlt.lastIndexOf('</w:numbering>')
    const vorNums = ersterNum >= 0 ? ersterNum : ende
    schreib('word/numbering.xml', nummernAlt.slice(0, vorNums) + nummern.abstrakt + nummernAlt.slice(vorNums, ende) + nummern.nums + nummernAlt.slice(ende))
  } else {
    schreib('word/numbering.xml', XML_KOPF + `<w:numbering ${W_NS}>${nummern.abstrakt}${nummern.nums}</w:numbering>`)
    if (!rels.includes('Target="numbering.xml"')) rels = rels.replace('</Relationships>', `<Relationship Id="rIdCrmNummern" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`)
    sorgeFuerTyp('/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml')
  }

  const stile = lies('word/styles.xml')
  if (!stile.includes('</w:styles>')) throw new Error('Die Word-Vorlage des Holding-Briefbogens hat keine Formatvorlagen')
  schreib('word/styles.xml', stile.replace('</w:styles>', `${wInhaltsVorlagen(st)}</w:styles>`))

  // Gerade/ungerade Kopfzeilen aus: Es gibt nur noch den Standard-Kopf, sonst blieben gerade Seiten leer.
  const einst = lies('word/settings.xml')
  if (einst) schreib('word/settings.xml', einst.replace(/<w:evenAndOddHeaders\b[^>]*\/>/g, ''))

  // Nicht mehr benutzte Kopf-/Fußzeilen (z. B. „erste Seite“ mit alter Anschrift) ganz entfernen.
  const benutzt = new Set([kopfRef, fussRef].map((r) => attribut(r, 'r:id')).filter(Boolean))
  rels = rels.replace(/<Relationship\b[^>]*\/>/g, (rel) => {
    const typ = attribut(rel, 'Type') ?? ''
    if (!/\/(header|footer)$/.test(typ) || benutzt.has(attribut(rel, 'Id'))) return rel
    const ziel = (attribut(rel, 'Target') ?? '').replace(/^\/?word\//, '')
    delete dateien[`word/${ziel}`]
    delete dateien[`word/_rels/${ziel}.rels`]
    typen = typen.replace(new RegExp(`<Override PartName="/word/${ziel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`), '')
    return ''
  })
  schreib('word/_rels/document.xml.rels', rels)

  schreib('docProps/core.xml', kernEigenschaften(a.titel, a.urheber, a.jetzt ?? new Date()))
  sorgeFuerTyp('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
  schreib('docProps/app.xml', anwendungsEigenschaften(a.urheber))
  sorgeFuerTyp('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
  schreib('[Content_Types].xml', typen)
  return zipSync(dateien, { level: 6 })
}

// ---------- Excel ----------

export type Zellwert = string | number | boolean | null | undefined
export type BlattEingabe = { name?: string; spalten?: string[]; zeilen?: Zellwert[][] }

export const MAX_BLAETTER = 20
export const MAX_ZELLEN = 200_000
const MAX_TEXT = 32_767

// Zellformate (Index in cellXfs von xl/styles.xml).
const S = { standard: 0, kopf: 1, ganz: 2, dez2: 3, dez1: 4, dez3: 5, dez4: 6, euro: 7, umbruch: 8 } as const

/** Spalten, in denen Zahlen ohne Tausenderpunkt stehen sollen (Jahr 2026, PLZ 89075, Nummern). */
const OHNE_TRENNER = /jahr|plz|postleitzahl|\bnr\b|nr\.|nummer|telefon|\btel\b|mobil|fax|kennung|\bid\b|iban|bic|aktenzeichen|\bjg\b|jahrgang/i

/** Spaltenbuchstaben: 0 → A, 25 → Z, 26 → AA. */
export function spaltenName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Erlaubter, eindeutiger Blattname: höchstens 31 Zeichen, ohne : \ / ? * [ ], nicht mit ' am Rand. */
export function blattName(roh: string | undefined, nr: number, vergeben: Set<string>): string {
  let n = String(roh ?? '')
    .replace(/[:\\/?*[\]]/g, '-')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31)
    .trim()
  if (!n) n = `Tabelle${nr}`
  if (n.toLowerCase() === 'history') n = 'History 1' // von Excel belegt
  let kandidat = n
  for (let i = 2; vergeben.has(kandidat.toLowerCase()); i++) {
    const zusatz = ` (${i})`
    kandidat = n.slice(0, 31 - zusatz.length).trimEnd() + zusatz
  }
  vergeben.add(kandidat.toLowerCase())
  return kandidat
}

type Zelle = { zahl: number; stil: number } | { text: string } | null

/** Deutsche Zahl als Text ("1.234,56", "12,5", "1.200 €") → Zahl; reine Ziffernfolgen (PLZ, Telefon) bleiben Text. */
function deutscheZahl(s: string): { zahl: number; euro: boolean } | null {
  const m = s.trim().match(/^(-?)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+(?=\s?€))\s?(€)?$/)
  if (!m) return null
  const zahl = Number(`${m[1]}${m[2].replace(/\./g, '').replace(',', '.')}`)
  return Number.isFinite(zahl) ? { zahl, euro: !!m[3] } : null
}

function zahlStil(z: number, ohneTrenner: boolean): number {
  if (ohneTrenner) return S.standard
  if (Number.isInteger(z)) return S.ganz
  const stellen = Math.min(4, (String(z).split('.')[1] ?? '').replace(/e.*$/, '').length)
  return stellen <= 1 ? S.dez1 : stellen === 2 ? S.dez2 : stellen === 3 ? S.dez3 : S.dez4
}

function zelle(v: Zellwert, ohneTrenner: boolean): Zelle {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? { zahl: v, stil: zahlStil(v, ohneTrenner) } : null
  if (typeof v === 'boolean') return { text: v ? 'ja' : 'nein' }
  const text = String(v)
  if (!text.trim()) return null
  const d = deutscheZahl(text)
  if (d) return { zahl: d.zahl, stil: d.euro ? S.euro : zahlStil(d.zahl, ohneTrenner) }
  return { text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text }
}

function anzeigeLaenge(z: Zelle): number {
  if (!z) return 0
  if ('text' in z) return Math.max(...z.text.split('\n').map((t) => t.length))
  return z.zahl.toLocaleString('de-DE', { maximumFractionDigits: 4 }).length + (z.stil === S.euro ? 2 : 0)
}

function xStile(): string {
  const xf = (numFmtId: number, extra = '', alignment = '') =>
    `<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${extra}>${alignment}</xf>`
  const xfs = [
    xf(0),
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    xf(3),
    xf(4),
    xf(164),
    xf(165),
    xf(166),
    xf(167),
    xf(0, ' applyAlignment="1"', '<alignment vertical="top" wrapText="1"/>'),
  ]
  return (
    XML_KOPF +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="#,##0.000"/><numFmt numFmtId="166" formatCode="#,##0.0000"/>' +
    `<numFmt numFmtId="167" formatCode="${xmlText('#,##0.00\\ "€"')}"/></numFmts>` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  )
}

export type XlsxEingabe = { titel: string; urheber: string; blaetter: BlattEingabe[]; jetzt?: Date }

/** Erzeugt eine .xlsx: je Blatt eine fette, fixierte Kopfzeile mit Filter, Zahlen als Zahlen. Wirft bei unbrauchbarer Eingabe einen deutschen Fehlertext. */
export function erstelleXlsx(a: XlsxEingabe): { bytes: Uint8Array; blaetter: { name: string; zeilen: number; spalten: number }[] } {
  const roh = Array.isArray(a.blaetter) ? a.blaetter : []
  if (roh.length === 0) throw new Error('blaetter ist leer — mindestens ein Blatt mit spalten und zeilen angeben.')
  if (roh.length > MAX_BLAETTER) throw new Error(`zu viele Blätter (${roh.length}, höchstens ${MAX_BLAETTER}).`)
  const zellenGesamt = roh.reduce((s, b) => s + (Array.isArray(b?.zeilen) ? b.zeilen.reduce((t, z) => t + (Array.isArray(z) ? z.length : 1), 0) : 0), 0)
  if (zellenGesamt > MAX_ZELLEN) throw new Error(`zu viele Zellen (${zellenGesamt}, höchstens ${MAX_ZELLEN}). Bitte auf mehrere Dateien aufteilen.`)

  const texte: string[] = []
  const textNr = new Map<string, number>()
  const textIndex = (t: string) => {
    let i = textNr.get(t)
    if (i === undefined) {
      i = texte.length
      texte.push(t)
      textNr.set(t, i)
    }
    return i
  }
  const vergeben = new Set<string>()
  const ergebnis: { name: string; zeilen: number; spalten: number }[] = []
  const blattXml: string[] = []

  roh.forEach((b, nr) => {
    const name = blattName(b?.name, nr + 1, vergeben)
    const kopf = (Array.isArray(b?.spalten) ? b.spalten : []).map((s) => String(s ?? '').trim())
    const daten = (Array.isArray(b?.zeilen) ? b.zeilen : []).map((z) => (Array.isArray(z) ? z : [z as Zellwert]))
    const mitKopf = kopf.some((s) => s)
    const spalten = Math.max(kopf.length, ...daten.map((z) => z.length), 1)
    const ohneTrenner = Array.from({ length: spalten }, (_, c) => OHNE_TRENNER.test(kopf[c] ?? ''))
    const breite = Array.from({ length: spalten }, (_, c) => (mitKopf ? (kopf[c] ?? '').length + 2 : 0))

    const zeilenXml: string[] = []
    let r = 0
    if (mitKopf) {
      r = 1
      const zellen = kopf.map((t, c) => (t ? `<c r="${spaltenName(c)}1" t="s" s="${S.kopf}"><v>${textIndex(t)}</v></c>` : `<c r="${spaltenName(c)}1" s="${S.kopf}"/>`))
      zeilenXml.push(`<row r="1">${zellen.join('')}</row>`)
    }
    for (const z of daten) {
      r++
      const zellen: string[] = []
      for (let c = 0; c < z.length; c++) {
        const w = zelle(z[c], ohneTrenner[c])
        if (!w) continue
        breite[c] = Math.max(breite[c], anzeigeLaenge(w))
        const ref = `${spaltenName(c)}${r}`
        if ('text' in w) zellen.push(`<c r="${ref}" t="s"${w.text.includes('\n') ? ` s="${S.umbruch}"` : ''}><v>${textIndex(w.text)}</v></c>`)
        else zellen.push(`<c r="${ref}"${w.stil ? ` s="${w.stil}"` : ''}><v>${w.zahl}</v></c>`)
      }
      zeilenXml.push(`<row r="${r}">${zellen.join('')}</row>`)
    }
    const letzte = Math.max(r, 1)
    const bereich = `A1:${spaltenName(spalten - 1)}${letzte}`
    const cols = breite.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(9, w + 2)).toFixed(1)}" customWidth="1"/>`).join('')
    const ansicht = mitKopf
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
      : '<selection activeCell="A1" sqref="A1"/>'
    // Druck-Fußzeile: Titel links, Seitenzahl rechts (& ist dort ein Steuerzeichen und wird verdoppelt).
    const fuss = xmlText(`&L${a.titel.slice(0, 100).replace(/&/g, '&&')}&RSeite &P von &N`)
    blattXml.push(
      XML_KOPF +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
        `<dimension ref="${bereich}"/>` +
        `<sheetViews><sheetView${nr === 0 ? ' tabSelected="1"' : ''} workbookViewId="0">${ansicht}</sheetView></sheetViews>` +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        `<cols>${cols}</cols>` +
        `<sheetData>${zeilenXml.join('')}</sheetData>` +
        (mitKopf && r > 1 ? `<autoFilter ref="${bereich}"/>` : '') +
        '<pageMargins left="0.6" right="0.6" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        `<pageSetup paperSize="9" orientation="${spalten > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>` +
        `<headerFooter><oddFooter>${fuss}</oddFooter></headerFooter>` +
        '</worksheet>',
    )
    ergebnis.push({ name, zeilen: daten.length, spalten })
  })

  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const quote = (n: string) => `'${n.replace(/'/g, "''")}'`
  const filter = ergebnis
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => blattXml[i].includes('<autoFilter'))
    .map(({ b, i }) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(`${quote(b.name)}!$A$1:$${spaltenName(b.spalten - 1)}$${b.zeilen + 1}`)}</definedName>`)
    .join('')
  const mappe =
    XML_KOPF +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}">` +
    '<workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>' +
    `<sheets>${ergebnis.map((b, i) => `<sheet name="${xmlText(b.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    (filter ? `<definedNames>${filter}</definedNames>` : '') +
    '<calcPr calcId="191029"/></workbook>'
  const n = ergebnis.length
  const mappenBeziehungen =
    XML_KOPF +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    ergebnis.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="${R}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${R}/sharedStrings" Target="sharedStrings.xml"/>` +
    '</Relationships>'
  const geteilt =
    XML_KOPF +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${texte.length}" uniqueCount="${texte.length}">` +
    texte.map((t) => `<si><t${/^\s|\s$|\n/.test(t) ? ' xml:space="preserve"' : ''}>${xmlText(t)}</t></si>`).join('') +
    '</sst>'
  const inhaltsTypen =
    XML_KOPF +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    ergebnis.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'

  const teile: Record<string, string> = {
    '[Content_Types].xml': inhaltsTypen,
    '_rels/.rels': paketBeziehungen('xl/workbook.xml'),
    'docProps/core.xml': kernEigenschaften(a.titel, a.urheber, a.jetzt ?? new Date()),
    'docProps/app.xml': anwendungsEigenschaften(a.urheber),
    'xl/workbook.xml': mappe,
    'xl/_rels/workbook.xml.rels': mappenBeziehungen,
    'xl/styles.xml': xStile(),
    'xl/sharedStrings.xml': geteilt,
  }
  blattXml.forEach((x, i) => (teile[`xl/worksheets/sheet${i + 1}.xml`] = x))
  return { bytes: zip(teile), blaetter: ergebnis }
}
