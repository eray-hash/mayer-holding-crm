// Diagramme zeichnen (Wunsch 23.11.2026: „Entwirf mir ein Diagramm und speichere es ab“):
// Mindmap, Baumdiagramm, Organigramm, Ablaufdiagramm, Struktogramm, Zeitstrahl und Sammeltafel
// (Brainstorming in Spalten). Der Assistent liefert nur den Inhalt als Struktur; Anordnung und
// Zeichnung macht dieser Baustein. Ergebnis: SVG → PNG (resvg) und ein PDF mit dem Bild.
//
// Schrift und Zeichenprogramm werden beim ersten Gebrauch aus dem Netz geladen (jsDelivr) und im
// Speicher des Workers gehalten. Inhalte gehen dabei nicht nach außen.

import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'

export const DIAGRAMM_ARTEN = ['mindmap', 'baum', 'organigramm', 'ablauf', 'struktogramm', 'zeitstrahl', 'tafel'] as const
export type DiagrammArt = (typeof DIAGRAMM_ARTEN)[number]

export const ART_NAME: Record<DiagrammArt, string> = {
  mindmap: 'Mindmap',
  baum: 'Baumdiagramm',
  organigramm: 'Organigramm',
  ablauf: 'Ablaufdiagramm',
  struktogramm: 'Struktogramm',
  zeitstrahl: 'Zeitstrahl',
  tafel: 'Sammeltafel',
}

export type Knoten = { text: string; kinder?: Knoten[] }
export type Schritt = { text: string; art?: 'start' | 'schritt' | 'frage' | 'ende'; nein?: string; nein_weiter_bei?: number }
export type Block = { art: 'anweisung' | 'verzweigung' | 'schleife'; text: string; ja?: Block[]; nein?: Block[]; inhalt?: Block[] }
export type Ereignis = { datum?: string; text: string }
export type Spalte = { titel: string; punkte: string[] }

export type DiagrammEingabe = {
  art: DiagrammArt
  titel: string
  knoten?: Knoten
  schritte?: Schritt[]
  bloecke?: Block[]
  ereignisse?: Ereignis[]
  spalten?: Spalte[]
}

export const MAX_ELEMENTE = 120
const MAX_TEXT = 160

// ---------------------------------------------------------------------------------------------
// Prüfen und bereinigen
// ---------------------------------------------------------------------------------------------

const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)

// deno-lint-ignore no-explicit-any
function knotenAus(roh: any, tiefe = 0, zaehler = { n: 0 }): Knoten | null {
  if (!roh || typeof roh !== 'object' || tiefe > 6) return null
  const text = txt(roh.text ?? roh.titel ?? roh.name)
  if (!text || ++zaehler.n > MAX_ELEMENTE) return null
  const kinder = (Array.isArray(roh.kinder) ? roh.kinder : []).map((k: unknown) => knotenAus(k, tiefe + 1, zaehler)).filter(Boolean) as Knoten[]
  return kinder.length ? { text, kinder } : { text }
}

// deno-lint-ignore no-explicit-any
function bloeckeAus(roh: any, tiefe = 0, zaehler = { n: 0 }): Block[] {
  if (!Array.isArray(roh) || tiefe > 5) return []
  const aus: Block[] = []
  for (const b of roh) {
    if (!b || typeof b !== 'object' || ++zaehler.n > MAX_ELEMENTE) continue
    const art = ['verzweigung', 'schleife'].includes(b.art) ? b.art : 'anweisung'
    const text = txt(b.text ?? b.bedingung)
    if (!text) continue
    if (art === 'verzweigung') aus.push({ art, text, ja: bloeckeAus(b.ja, tiefe + 1, zaehler), nein: bloeckeAus(b.nein, tiefe + 1, zaehler) })
    else if (art === 'schleife') aus.push({ art, text, inhalt: bloeckeAus(b.inhalt, tiefe + 1, zaehler) })
    else aus.push({ art, text })
  }
  return aus
}

/** Eingabe des Assistenten prüfen; Fehlertext oder bereinigte Eingabe. */
// deno-lint-ignore no-explicit-any
export function pruefeEingabe(roh: any): DiagrammEingabe | string {
  const art = String(roh?.art ?? '').toLowerCase() as DiagrammArt
  if (!DIAGRAMM_ARTEN.includes(art)) return `Fehler: art muss eine von ${DIAGRAMM_ARTEN.join(', ')} sein.`
  const titel = txt(roh?.titel) || ART_NAME[art]
  if (art === 'mindmap' || art === 'baum' || art === 'organigramm') {
    const knoten = knotenAus(roh?.knoten)
    if (!knoten) return 'Fehler: knoten fehlt (Wurzel mit text und kinder).'
    return { art, titel, knoten }
  }
  if (art === 'ablauf') {
    const schritte: Schritt[] = (Array.isArray(roh?.schritte) ? roh.schritte : [])
      .slice(0, 40)
      // deno-lint-ignore no-explicit-any
      .map((s: any) => ({
        text: txt(s?.text),
        art: ['start', 'frage', 'ende'].includes(s?.art) ? s.art : 'schritt',
        nein: txt(s?.nein) || undefined,
        nein_weiter_bei: Number.isInteger(s?.nein_weiter_bei) ? s.nein_weiter_bei : undefined,
      }))
      .filter((s: Schritt) => s.text)
    if (!schritte.length) return 'Fehler: schritte fehlen.'
    return { art, titel, schritte }
  }
  if (art === 'struktogramm') {
    const bloecke = bloeckeAus(roh?.bloecke)
    if (!bloecke.length) return 'Fehler: bloecke fehlen.'
    return { art, titel, bloecke }
  }
  if (art === 'zeitstrahl') {
    // deno-lint-ignore no-explicit-any
    const ereignisse = (Array.isArray(roh?.ereignisse) ? roh.ereignisse : []).slice(0, 40).map((e: any) => ({ datum: txt(e?.datum) || undefined, text: txt(e?.text) })).filter((e: Ereignis) => e.text)
    if (!ereignisse.length) return 'Fehler: ereignisse fehlen.'
    return { art, titel, ereignisse }
  }
  const spalten = (Array.isArray(roh?.spalten) ? roh.spalten : [])
    .slice(0, 6)
    // deno-lint-ignore no-explicit-any
    .map((s: any) => ({ titel: txt(s?.titel) || '—', punkte: (Array.isArray(s?.punkte) ? s.punkte : []).map(txt).filter(Boolean).slice(0, 20) }))
  if (!spalten.length) return 'Fehler: spalten fehlen.'
  return { art: 'tafel', titel, spalten }
}

// ---------------------------------------------------------------------------------------------
// Text messen und umbrechen (Näherung für Noto Sans; reicht für Kästen mit etwas Luft)
// ---------------------------------------------------------------------------------------------

const SCHMAL = /[iljtfrI.,:;'|!()[\]\s]/
const BREIT = /[mwMWÄÖÜ@%&]/
export function textBreite(text: string, groesse: number, fett = false): number {
  let summe = 0
  for (const z of text) summe += SCHMAL.test(z) ? 0.3 : BREIT.test(z) ? 0.86 : /[A-ZÄÖÜ0-9]/.test(z) ? 0.66 : 0.56
  return summe * groesse * (fett ? 1.06 : 1)
}

export function umbrechen(text: string, maxBreite: number, groesse: number, fett = false): string[] {
  const zeilen: string[] = []
  let zeile = ''
  for (const wort of text.split(' ')) {
    const probe = zeile ? `${zeile} ${wort}` : wort
    if (textBreite(probe, groesse, fett) <= maxBreite || !zeile) zeile = probe
    else {
      zeilen.push(zeile)
      zeile = wort
    }
  }
  if (zeile) zeilen.push(zeile)
  return zeilen.length ? zeilen : ['']
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------------------------------------
// Zeichenbausteine
// ---------------------------------------------------------------------------------------------

const FARBEN = ['#2563eb', '#0f9d8a', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777']
const TINTE = '#1f2937'
const LINIE = '#94a3b8'

type Kasten = { b: number; h: number; zeilen: string[]; groesse: number; fett: boolean }

function kasten(text: string, groesse: number, maxBreite: number, fett = false, polster = 12): Kasten {
  const zeilen = umbrechen(text, maxBreite, groesse, fett)
  const b = Math.max(...zeilen.map((z) => textBreite(z, groesse, fett))) + 2 * polster
  return { b: Math.max(b * 1.04, 60), h: zeilen.length * groesse * 1.3 + 2 * polster - groesse * 0.3, zeilen, groesse, fett }
}

function textBlock(k: Kasten, mx: number, oben: number, farbe = TINTE, anker: 'middle' | 'start' = 'middle', x?: number): string {
  const zh = k.groesse * 1.3
  const start = oben + (k.h - (k.zeilen.length * zh - k.groesse * 0.3)) / 2 + k.groesse * 0.95
  return k.zeilen
    .map((z, i) => `<text x="${(x ?? mx).toFixed(1)}" y="${(start + i * zh).toFixed(1)}" font-size="${k.groesse}" ${k.fett ? 'font-weight="700"' : ''} fill="${farbe}" text-anchor="${anker}">${esc(z)}</text>`)
    .join('')
}

function rahmen(x: number, y: number, b: number, h: number, fuell: string, strich: string, r = 10, breite = 1.5): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${b.toFixed(1)}" height="${h.toFixed(1)}" rx="${r}" fill="${fuell}" stroke="${strich}" stroke-width="${breite}"/>`
}

function hell(farbe: string, anteil = 0.86): string {
  const n = parseInt(farbe.slice(1), 16)
  const kanal = (v: number) => Math.round(v + (255 - v) * anteil)
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => kanal(v).toString(16).padStart(2, '0')).join('')}`
}

type Bild = { svg: string; b: number; h: number }

function mitTitel(titel: string, inhalt: Bild): Bild {
  const rand = 40
  const t = kasten(titel, 26, Math.max(inhalt.b, 500), true, 0)
  const b = Math.max(inhalt.b, t.b) + 2 * rand
  const h = inhalt.h + t.h + 3 * rand
  const versatz = (b - inhalt.b) / 2
  return {
    b,
    h,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${b.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${b.toFixed(1)} ${h.toFixed(1)}" font-family="Noto Sans">` +
      `<rect width="100%" height="100%" fill="#ffffff"/>` +
      textBlock(t, b / 2, rand, TINTE) +
      `<g transform="translate(${versatz.toFixed(1)} ${(t.h + 2 * rand).toFixed(1)})">${inhalt.svg}</g></svg>`,
  }
}

// ---------------------------------------------------------------------------------------------
// Bäume: waagerecht (Baum, Mindmap-Hälften) und senkrecht (Organigramm)
// ---------------------------------------------------------------------------------------------

type Platz = { k: Knoten; kasten: Kasten; x: number; y: number; tiefe: number; farbe: string; kinder: Platz[] }

function messeBaum(k: Knoten, tiefe: number, farbe: string, senkrecht: boolean): Platz & { ausdehnung: number } {
  const groesse = tiefe === 0 ? 20 : tiefe === 1 ? 16 : 14
  const kas = kasten(k.text, groesse, senkrecht ? 180 : 240, tiefe <= 1)
  const kinder = (k.kinder ?? []).map((c, i) => messeBaum(c, tiefe + 1, tiefe === 0 ? FARBEN[i % FARBEN.length] : farbe, senkrecht))
  const abstand = senkrecht ? 24 : 14
  const eigen = senkrecht ? kas.b : kas.h
  const summe = kinder.reduce((s, c) => s + c.ausdehnung, 0) + Math.max(0, kinder.length - 1) * abstand
  return { k, kasten: kas, x: 0, y: 0, tiefe, farbe, kinder, ausdehnung: Math.max(eigen, summe) }
}

/** Waagerechter Baum ab (x, oben) innerhalb der Höhe ausdehnung; richtung -1 = nach links. */
function legeWaagerecht(p: Platz & { ausdehnung: number }, x: number, oben: number, spalten: number[], richtung: 1 | -1) {
  p.y = oben + p.ausdehnung / 2 - p.kasten.h / 2
  p.x = richtung === 1 ? x : x - p.kasten.b
  const naechstX = x + richtung * (spalten[p.tiefe] + 60)
  const summe = p.kinder.reduce((s, c) => s + (c as Platz & { ausdehnung: number }).ausdehnung, 0) + Math.max(0, p.kinder.length - 1) * 14
  let y = oben + (p.ausdehnung - summe) / 2
  for (const c of p.kinder as (Platz & { ausdehnung: number })[]) {
    legeWaagerecht(c, naechstX, y, spalten, richtung)
    y += c.ausdehnung + 14
  }
}

function spaltenBreiten(p: Platz, aus: number[] = []): number[] {
  aus[p.tiefe] = Math.max(aus[p.tiefe] ?? 0, p.kasten.b)
  for (const c of p.kinder) spaltenBreiten(c, aus)
  return aus
}

function zeichneKnoten(p: Platz): string {
  const k = p.kasten
  if (p.tiefe === 0) return rahmen(p.x, p.y, k.b, k.h, TINTE, TINTE, 14, 0) + textBlock(k, p.x + k.b / 2, p.y, '#ffffff')
  if (p.tiefe === 1) return rahmen(p.x, p.y, k.b, k.h, p.farbe, p.farbe, 10, 0) + textBlock(k, p.x + k.b / 2, p.y, '#ffffff')
  return rahmen(p.x, p.y, k.b, k.h, hell(p.farbe), p.farbe, 8) + textBlock(k, p.x + k.b / 2, p.y)
}

function alle(p: Platz, aus: Platz[] = []): Platz[] {
  aus.push(p)
  for (const c of p.kinder) alle(c, aus)
  return aus
}

function kurveWaagerecht(a: Platz, c: Platz): string {
  const linksNachRechts = c.x > a.x
  const x1 = linksNachRechts ? a.x + a.kasten.b : a.x
  const x2 = linksNachRechts ? c.x : c.x + c.kasten.b
  const y1 = a.y + a.kasten.h / 2
  const y2 = c.y + c.kasten.h / 2
  const mx = (x1 + x2) / 2
  return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${mx.toFixed(1)} ${y1.toFixed(1)} ${mx.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${c.farbe}" stroke-width="${a.tiefe === 0 ? 3 : 2}"/>`
}

function rahmenUm(knoten: Platz[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...knoten.map((p) => p.x)),
    minY: Math.min(...knoten.map((p) => p.y)),
    maxX: Math.max(...knoten.map((p) => p.x + p.kasten.b)),
    maxY: Math.max(...knoten.map((p) => p.y + p.kasten.h)),
  }
}

function verschoben(svg: string, dx: number, dy: number): string {
  return `<g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)})">${svg}</g>`
}

export function zeichneBaum(wurzel: Knoten): Bild {
  const p = messeBaum(wurzel, 0, TINTE, false)
  legeWaagerecht(p, 0, 0, spaltenBreiten(p), 1)
  const knoten = alle(p)
  const linien = knoten.flatMap((a) => a.kinder.map((c) => kurveWaagerecht(a, c))).join('')
  const r = rahmenUm(knoten)
  return { svg: verschoben(linien + knoten.map(zeichneKnoten).join(''), -r.minX, -r.minY), b: r.maxX - r.minX, h: r.maxY - r.minY }
}

export function zeichneMindmap(wurzel: Knoten): Bild {
  const p = messeBaum(wurzel, 0, TINTE, false)
  const kinder = p.kinder as (Platz & { ausdehnung: number })[]
  // Äste abwechselnd nach Höhe auf rechts und links verteilen (größte zuerst in die leichtere Hälfte).
  const rechts: typeof kinder = []
  const links: typeof kinder = []
  let hr = 0
  let hl = 0
  for (const c of [...kinder].sort((a, b) => b.ausdehnung - a.ausdehnung)) {
    if (hr <= hl) {
      rechts.push(c)
      hr += c.ausdehnung + 20
    } else {
      links.push(c)
      hl += c.ausdehnung + 20
    }
  }
  const ordne = (liste: typeof kinder) => kinder.filter((c) => liste.includes(c))
  const spalten = spaltenBreiten(p)
  const seite = (liste: typeof kinder, richtung: 1 | -1) => {
    const hoehe = liste.reduce((s, c) => s + c.ausdehnung, 0) + Math.max(0, liste.length - 1) * 20
    let y = -hoehe / 2
    for (const c of ordne(liste)) {
      legeWaagerecht(c, richtung * (p.kasten.b / 2 + 70), y, spalten, richtung)
      y += c.ausdehnung + 20
    }
  }
  seite(rechts, 1)
  seite(links, -1)
  p.x = -p.kasten.b / 2
  p.y = -p.kasten.h / 2
  const knoten = alle(p)
  const linien = knoten.flatMap((a) => a.kinder.map((c) => kurveWaagerecht(a, c))).join('')
  const r = rahmenUm(knoten)
  return { svg: verschoben(linien + knoten.map(zeichneKnoten).join(''), -r.minX, -r.minY), b: r.maxX - r.minX, h: r.maxY - r.minY }
}

function legeSenkrecht(p: Platz & { ausdehnung: number }, links: number, y: number, zeilen: number[]) {
  p.x = links + p.ausdehnung / 2 - p.kasten.b / 2
  p.y = y
  const summe = p.kinder.reduce((s, c) => s + (c as Platz & { ausdehnung: number }).ausdehnung, 0) + Math.max(0, p.kinder.length - 1) * 24
  let x = links + (p.ausdehnung - summe) / 2
  for (const c of p.kinder as (Platz & { ausdehnung: number })[]) {
    legeSenkrecht(c, x, y + zeilen[p.tiefe] + 50, zeilen)
    x += c.ausdehnung + 24
  }
}

export function zeichneOrganigramm(wurzel: Knoten): Bild {
  const p = messeBaum(wurzel, 0, TINTE, true)
  const zeilen: number[] = []
  for (const k of alle(p)) zeilen[k.tiefe] = Math.max(zeilen[k.tiefe] ?? 0, k.kasten.h)
  legeSenkrecht(p, 0, 0, zeilen)
  const knoten = alle(p)
  const linien = knoten
    .flatMap((a) =>
      a.kinder.map((c) => {
        const x1 = a.x + a.kasten.b / 2
        const y1 = a.y + a.kasten.h
        const x2 = c.x + c.kasten.b / 2
        const ym = a.y + zeilen[a.tiefe] + 25
        return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} V${ym.toFixed(1)} H${x2.toFixed(1)} V${c.y.toFixed(1)}" fill="none" stroke="${LINIE}" stroke-width="1.8"/>`
      }),
    )
    .join('')
  const r = rahmenUm(knoten)
  return { svg: verschoben(linien + knoten.map(zeichneKnoten).join(''), -r.minX, -r.minY), b: r.maxX - r.minX, h: r.maxY - r.minY }
}

// ---------------------------------------------------------------------------------------------
// Ablaufdiagramm
// ---------------------------------------------------------------------------------------------

const pfeilSpitze = `<defs><marker id="spitze" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${LINIE}"/></marker></defs>`

export function zeichneAblauf(schritte: Schritt[]): Bild {
  const mitte = 200
  const teile: string[] = []
  const lagen: { y: number; h: number; b: number }[] = []
  let y = 0
  let rechtsMax = mitte + 160
  const neinSpur: string[] = []
  schritte.forEach((s, i) => {
    const frage = s.art === 'frage'
    const k = kasten(s.text, 15, frage ? 170 : 260, s.art === 'start' || s.art === 'ende')
    let b = k.b
    let h = k.h
    if (frage) {
      b = k.b * 1.7
      h = Math.max(k.h * 1.9, 70)
    }
    const x = mitte - b / 2
    if (s.art === 'start' || s.art === 'ende') {
      teile.push(rahmen(x, y, b, h, TINTE, TINTE, h / 2, 0) + textBlock(k, mitte, y, '#ffffff'))
    } else if (frage) {
      teile.push(`<path d="M${mitte} ${y} L${mitte + b / 2} ${y + h / 2} L${mitte} ${y + h} L${mitte - b / 2} ${y + h / 2} Z" fill="${hell('#d97706')}" stroke="#d97706" stroke-width="1.8"/>`)
      teile.push(textBlock({ ...k, h }, mitte, y))
    } else {
      teile.push(rahmen(x, y, b, h, hell('#2563eb'), '#2563eb', 8) + textBlock(k, mitte, y))
    }
    lagen.push({ y, h, b })
    if (frage && s.nein) {
      const nk = kasten(s.nein, 14, 200)
      const nx = mitte + b / 2 + 50
      const ny = y + h / 2 - nk.h / 2
      teile.push(`<path d="M${mitte + b / 2} ${y + h / 2} H${nx}" stroke="${LINIE}" stroke-width="1.8" marker-end="url(#spitze)"/>`)
      teile.push(`<text x="${mitte + b / 2 + 8}" y="${y + h / 2 - 6}" font-size="13" fill="#dc2626" font-weight="700">Nein</text>`)
      teile.push(rahmen(nx, ny, nk.b, nk.h, hell('#dc2626'), '#dc2626', 8) + textBlock(nk, nx + nk.b / 2, ny))
      rechtsMax = Math.max(rechtsMax, nx + nk.b)
      const ziel = s.nein_weiter_bei
      if (ziel && ziel >= 1 && ziel <= schritte.length && ziel - 1 !== i) neinSpur.push(`${i}|${ziel - 1}|${nx + nk.b}|${ny + nk.h / 2}`)
    }
    const weiter = i < schritte.length - 1
    if (weiter) {
      teile.push(`<path d="M${mitte} ${y + h} V${y + h + 40}" stroke="${LINIE}" stroke-width="1.8" marker-end="url(#spitze)"/>`)
      if (frage) teile.push(`<text x="${mitte + 8}" y="${y + h + 24}" font-size="13" fill="#0f9d8a" font-weight="700">Ja</text>`)
    }
    y += h + 40
  })
  // Rückwege („Nein → weiter bei Schritt n“) auf einer eigenen Spur rechts.
  neinSpur.forEach((eintrag, nr) => {
    const [, zielIndex, x0, y0] = eintrag.split('|').map(Number)
    const spur = rechtsMax + 30 + nr * 18
    const z = lagen[zielIndex]
    const zy = z.y + z.h / 2
    teile.push(`<path d="M${x0} ${y0} H${spur} V${zy} H${mitte + z.b / 2}" fill="none" stroke="${LINIE}" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#spitze)"/>`)
  })
  const breite = Math.max(rechtsMax + (neinSpur.length ? 40 + neinSpur.length * 18 : 0), mitte + 200)
  return { svg: pfeilSpitze + teile.join(''), b: breite, h: y - 40 }
}

// ---------------------------------------------------------------------------------------------
// Struktogramm (Nassi-Shneiderman)
// ---------------------------------------------------------------------------------------------

const S_GROESSE = 14

function hoeheBloecke(bloecke: Block[], b: number): number {
  return bloecke.length ? bloecke.reduce((s, x) => s + hoeheBlock(x, b), 0) : 34
}

function hoeheBlock(x: Block, b: number): number {
  if (x.art === 'anweisung') return kasten(x.text, S_GROESSE, b - 20, false, 10).h
  if (x.art === 'schleife') return kasten(x.text, S_GROESSE, b - 20, true, 10).h + hoeheBloecke(x.inhalt ?? [], b - 28)
  const kopf = kasten(x.text, S_GROESSE, b * 0.7, true, 10).h + 26
  return kopf + Math.max(hoeheBloecke(x.ja ?? [], b / 2), hoeheBloecke(x.nein ?? [], b / 2))
}

function zeichneBloecke(bloecke: Block[], x: number, y: number, b: number, ziel: number): string {
  if (!bloecke.length) return rahmen(x, y, b, ziel, '#ffffff', TINTE, 0, 1.2) + `<text x="${x + b / 2}" y="${y + ziel / 2 + 5}" font-size="14" fill="${LINIE}" text-anchor="middle">—</text>`
  const teile: string[] = []
  const natuerlich = bloecke.map((bl) => hoeheBlock(bl, b))
  const rest = ziel - natuerlich.reduce((s, h) => s + h, 0)
  bloecke.forEach((bl, i) => {
    const h = natuerlich[i] + (i === bloecke.length - 1 ? rest : 0)
    teile.push(zeichneBlock(bl, x, y, b, h))
    y += h
  })
  return teile.join('')
}

function zeichneBlock(bl: Block, x: number, y: number, b: number, h: number): string {
  if (bl.art === 'anweisung') {
    const k = kasten(bl.text, S_GROESSE, b - 20, false, 10)
    return rahmen(x, y, b, h, '#ffffff', TINTE, 0, 1.2) + textBlock({ ...k, h }, x + b / 2, y)
  }
  if (bl.art === 'schleife') {
    const k = kasten(bl.text, S_GROESSE, b - 20, true, 10)
    return (
      rahmen(x, y, b, h, hell('#7c3aed', 0.9), TINTE, 0, 1.2) +
      textBlock(k, x + 10, y, TINTE, 'start', x + 10) +
      zeichneBloecke(bl.inhalt ?? [], x + 28, y + k.h, b - 28, h - k.h)
    )
  }
  const k = kasten(bl.text, S_GROESSE, b * 0.7, true, 10)
  const kopf = k.h + 26
  const rumpf = h - kopf
  return (
    rahmen(x, y, b, kopf, hell('#d97706', 0.9), TINTE, 0, 1.2) +
    `<path d="M${x} ${y} L${x + b / 2} ${y + kopf} L${x + b} ${y}" fill="none" stroke="${TINTE}" stroke-width="1.2"/>` +
    textBlock(k, x + b / 2, y) +
    `<text x="${x + 8}" y="${y + kopf - 8}" font-size="13" font-weight="700" fill="#0f9d8a">Ja</text>` +
    `<text x="${x + b - 8}" y="${y + kopf - 8}" font-size="13" font-weight="700" fill="#dc2626" text-anchor="end">Nein</text>` +
    zeichneBloecke(bl.ja ?? [], x, y + kopf, b / 2, rumpf) +
    zeichneBloecke(bl.nein ?? [], x + b / 2, y + kopf, b / 2, rumpf)
  )
}

export function zeichneStruktogramm(bloecke: Block[]): Bild {
  const b = 760
  const h = hoeheBloecke(bloecke, b)
  return { svg: zeichneBloecke(bloecke, 0, 0, b, h) + rahmen(0, 0, b, h, 'none', TINTE, 0, 2), b, h }
}

// ---------------------------------------------------------------------------------------------
// Zeitstrahl (senkrecht, gut lesbar auf dem Handy) und Sammeltafel
// ---------------------------------------------------------------------------------------------

export function zeichneZeitstrahl(ereignisse: Ereignis[]): Bild {
  const teile: string[] = []
  let y = 0
  const linieX = 20
  ereignisse.forEach((e, i) => {
    const farbe = FARBEN[i % FARBEN.length]
    const datum = e.datum ? kasten(e.datum, 15, 420, true, 0) : null
    const k = kasten(e.text, 15, 420, false, 12)
    const h = (datum ? datum.h + 6 : 0) + k.h
    teile.push(`<circle cx="${linieX}" cy="${y + 12}" r="9" fill="${farbe}"/>`)
    if (datum) teile.push(textBlock(datum, 0, y, farbe, 'start', linieX + 26))
    const ky = y + (datum ? datum.h + 6 : 0)
    teile.push(rahmen(linieX + 22, ky, Math.max(k.b, 200), k.h, hell(farbe), farbe, 8) + textBlock(k, 0, ky, TINTE, 'start', linieX + 34))
    y += h + 26
  })
  const hoehe = y - 26
  return { svg: `<line x1="${linieX}" y1="0" x2="${linieX}" y2="${hoehe}" stroke="${LINIE}" stroke-width="3"/>` + teile.join(''), b: 500, h: hoehe }
}

export function zeichneTafel(spalten: Spalte[]): Bild {
  const breite = 230
  const abstand = 22
  const teile: string[] = []
  let hoehe = 0
  spalten.forEach((s, i) => {
    const farbe = FARBEN[i % FARBEN.length]
    const x = i * (breite + abstand)
    const kopf = kasten(s.titel, 16, breite - 24, true)
    teile.push(rahmen(x, 0, breite, kopf.h, farbe, farbe, 10, 0) + textBlock(kopf, x + breite / 2, 0, '#ffffff'))
    let y = kopf.h + 14
    for (const punkt of s.punkte) {
      const k = kasten(punkt, 14, breite - 28)
      teile.push(rahmen(x + 4, y, breite - 8, k.h, hell(farbe, 0.88), hell(farbe, 0.5), 6) + textBlock(k, x + breite / 2, y))
      y += k.h + 10
    }
    hoehe = Math.max(hoehe, y - 10)
  })
  return { svg: teile.join(''), b: spalten.length * (breite + abstand) - abstand, h: hoehe }
}

// ---------------------------------------------------------------------------------------------
// Gesamt: SVG, PNG, PDF
// ---------------------------------------------------------------------------------------------

export function baueSvg(e: DiagrammEingabe): { svg: string; b: number; h: number } {
  const inhalt =
    e.art === 'mindmap'
      ? zeichneMindmap(e.knoten!)
      : e.art === 'baum'
        ? zeichneBaum(e.knoten!)
        : e.art === 'organigramm'
          ? zeichneOrganigramm(e.knoten!)
          : e.art === 'ablauf'
            ? zeichneAblauf(e.schritte!)
            : e.art === 'struktogramm'
              ? zeichneStruktogramm(e.bloecke!)
              : e.art === 'zeitstrahl'
                ? zeichneZeitstrahl(e.ereignisse!)
                : zeichneTafel(e.spalten!)
  return mitTitel(e.titel, inhalt)
}

const QUELLE = 'https://cdn.jsdelivr.net/npm'
let bereit: Promise<Uint8Array[]> | null = null

async function laden(abruf: typeof fetch): Promise<Uint8Array[]> {
  const bytes = async (url: string) => {
    const r = await abruf(url, { signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`${url} → ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  }
  await initWasm(abruf(`${QUELLE}/@resvg/resvg-wasm@2.6.2/index_bg.wasm`))
  return await Promise.all([bytes(`${QUELLE}/@expo-google-fonts/noto-sans@0.2.3/NotoSans_400Regular.ttf`), bytes(`${QUELLE}/@expo-google-fonts/noto-sans@0.2.3/NotoSans_700Bold.ttf`)])
}

/** SVG in ein PNG umwandeln (doppelte Auflösung, höchstens 4000 Bildpunkte je Seite). */
export async function alsPng(svg: string, b: number, h: number, abruf: typeof fetch = fetch): Promise<Uint8Array> {
  if (!bereit) bereit = laden(abruf).catch((e) => {
    bereit = null
    throw e
  })
  const schriften = await bereit
  const faktor = Math.max(0.5, Math.min(2, 4000 / Math.max(b, h)))
  return new Resvg(svg, { font: { fontBuffers: schriften, defaultFontFamily: 'Noto Sans', loadSystemFonts: false }, fitTo: { mode: 'zoom', value: faktor } }).render().asPng()
}

/** PDF mit dem Bild auf einer Seite (A4 hoch oder quer, je nach Form), mit Rand. */
export async function alsPdf(png: Uint8Array, titel: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(titel)
  const bild = await doc.embedPng(png)
  const quer = bild.width > bild.height
  const [sb, sh] = quer ? [841.89, 595.28] : [595.28, 841.89]
  const seite = doc.addPage([sb, sh])
  const rand = 28
  const f = Math.min((sb - 2 * rand) / bild.width, (sh - 2 * rand) / bild.height)
  const w = bild.width * f
  const hh = bild.height * f
  seite.drawImage(bild, { x: (sb - w) / 2, y: (sh - hh) / 2, width: w, height: hh })
  return await doc.save()
}
