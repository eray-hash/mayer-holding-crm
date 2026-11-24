// Nur für Tests: eine kleine Word-Datei, aufgebaut wie die echte Briefbogen-Vorlage der Holding
// (Kopf-/Fußzeile, verankerte Team-Spalte mit Umlauf, Brief-Textfeld „Firma“/„Ulm, den …“, leerer Rahmen,
// Abschnitt mit Kopfzeile für gerade/erste Seite, numbering.xml mit eigenen Listen). Ohne echte Namen.
import { strToU8, zipSync } from 'npm:fflate@0.8.2'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const K = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function form(text: string, umlauf: string): string {
  const absaetze = text ? text.split('|').map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('') : '<w:p/>'
  return `<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>5541645</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>146050</wp:posOffset></wp:positionV><wp:extent cx="2111375" cy="9446895"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${umlauf}<wp:docPr id="${text.length + 2}" name="Form"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr/><wps:txbx><w:txbxContent>${absaetze}</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback/></mc:AlternateContent>`
}

export function falscheHoldingVorlage(): Uint8Array {
  const rand = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="737" w:right="0" w:bottom="777" w:left="1219" w:header="680" w:footer="720" w:gutter="0"/>'
  const refs = '<w:headerReference w:type="even" r:id="rId8"/><w:headerReference w:type="default" r:id="rId9"/><w:footerReference w:type="default" r:id="rId11"/><w:headerReference w:type="first" r:id="rId12"/><w:footerReference w:type="first" r:id="rId13"/>'
  const lauf = (x: string) => `<w:r><w:rPr><w:noProof/></w:rPr>${x}</w:r>`
  const body =
    `<w:p>${lauf(form('Teamspalte Kanzlei|Muster Mitglied', '<wp:wrapSquare wrapText="bothSides"/>'))}${lauf(form('Firma|Ulm, den 30.08.2026|Gruss Absender', '<wp:wrapNone/>'))}${lauf(form('', '<wp:wrapNone/>'))}</w:p>` +
    `<w:p/><w:p><w:pPr><w:sectPr>${refs}<w:type w:val="continuous"/>${rand}<w:cols w:space="720"/></w:sectPr></w:pPr></w:p>` +
    `<w:p/><w:sectPr><w:type w:val="continuous"/>${rand}<w:cols w:space="720"/></w:sectPr>`
  const kopf = (t: string) => K + `<w:hdr ${W}><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:hdr>`
  const fuss = (t: string) => K + `<w:ftr ${W}><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:ftr>`
  const teile: Record<string, string> = {
    '[Content_Types].xml': K + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      ['header1', 'header2', 'header3'].map((h) => `<Override PartName="/word/${h}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`).join('') +
      ['footer2', 'footer3'].map((h) => `<Override PartName="/word/${h}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`).join('') +
      '</Types>',
    '_rels/.rels': K + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': K + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rId4" Type="${R}/settings" Target="settings.xml"/>` +
      `<Relationship Id="rId8" Type="${R}/header" Target="header1.xml"/><Relationship Id="rId9" Type="${R}/header" Target="header2.xml"/><Relationship Id="rId11" Type="${R}/footer" Target="footer2.xml"/>` +
      `<Relationship Id="rId12" Type="${R}/header" Target="header3.xml"/><Relationship Id="rId13" Type="${R}/footer" Target="footer3.xml"/></Relationships>`,
    'word/document.xml': K + `<w:document ${W}><w:body>${body}</w:body></w:document>`,
    'word/styles.xml': K + `<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Listenabsatz"><w:name w:val="List Paragraph"/></w:style></w:styles>`,
    'word/numbering.xml': K + `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    'word/settings.xml': K + `<w:settings ${W}><w:evenAndOddHeaders/></w:settings>`,
    'word/header1.xml': kopf('Kopf gerade'),
    'word/header2.xml': kopf('Absenderzeile Holding'),
    'word/header3.xml': kopf('Alte Anschrift'),
    'word/footer2.xml': fuss('Fusszeile Holding'),
    'word/footer3.xml': fuss('Alte Fusszeile'),
  }
  return zipSync(Object.fromEntries(Object.entries(teile).map(([k, v]) => [k, strToU8(v)])))
}
