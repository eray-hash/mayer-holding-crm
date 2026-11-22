// Liest Quirins zwei Excel-Blätter — „ToDo Liste“ (Formular vom 08.09.2026, Reiter „to Do“ und „erledigte Aufgaben“)
// und „Tagesablauf klar definieren“ (Version 31.07.2026) — aus den Zeilen eines Tabellenblatts (Liste von Zeilen, wie
// sie die Excel-Bibliothek mit header:1 liefert). Ohne Bibliothek und ohne Browser: läuft im CRM, in Deno-Tests und im
// Einspiel-Skript (node).
//
// Spalten „to Do“: 0 Start-Datum · 1 Pri · 2 Unter-Pri · 3 Kunde/Projekt/Firma · 4 Aufgabe · 5 Abt. · 6 aktueller
// Stand/Info · 7 welche Fragen · 8 Was ist als nächstes zu tun · 9 zuständig · 10 geplante Zeit (min) · 11 Ist-Zeit ·
// 12 Umsatz-Wert (€, Text wie „25k“, „5k-45k“, „?“) · 13 geplante Wiedervorlage · 14 Erledigt am.
// Im Reiter „erledigte Aufgaben“ stehen die Zeilen in drei verschiedenen Anordnungen (je nachdem, aus welcher
// Fassung der Liste sie verschoben wurden) — erkannt an der Spalte, in der das Kürzel des Zuständigen steht.

import type { PlanBlock, PlanZeile } from '../../../supabase/functions/_shared/tagesplanKern.ts'

export type ImportTodo = {
  id: string
  blatt: 'offen' | 'erledigt'
  zeile: number
  start_datum: string | null
  prio: string | null
  unter_prio: number | null
  kunde_projekt: string | null
  aufgabe: string
  abteilung: string | null
  aktueller_stand: string | null
  welche_fragen: string | null
  naechste_schritte: string | null
  zustaendig: string | null
  geplante_zeit: string | null
  ist_zeit: number | null
  umsatz_wert: number | null
  /** Originaltext der Umsatz-Spalte, wenn er keine eindeutige Zahl war (z. B. „5k-45k“). */
  umsatz_text: string | null
  geplante_wiedervorlage: string | null
  erledigt_am: string | null
  /** true = Erledigt-Datum stand nicht in der Liste (Stand der Liste eingesetzt). */
  erledigt_geschaetzt: boolean
}

export type ImportTagesablauf = {
  datum: string | null
  ort: string | null
  bearbeiter: string | null
  zeilen: PlanZeile[]
  anrufe: string
  gesamtMin: number | null
}

const zwei = (n: number) => String(n).padStart(2, '0')

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
  return s && !/^[.…_\s-]+$/.test(s) ? s : null
}

function zahl(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = text(v)
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Excel-Seriennummer (Tage seit 30.12.1899) oder Text „17.9.“, „17.11.26“ → JJJJ-MM-TT. Ohne Jahr: das Jahr, in dem
 *  der Tag zuletzt vor (oder am) Stand der Liste lag. */
export function excelDatum(v: unknown, stand: string): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 30000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${zwei(d.getUTCMonth() + 1)}-${zwei(d.getUTCDate())}`
  }
  const s = text(v)
  if (!s) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/.exec(s)
  if (!m) return null
  const tag = Number(m[1])
  const monat = Number(m[2])
  const standJahr = Number(stand.slice(0, 4))
  const jahr = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : standJahr
  if (!gibtEs(jahr, monat, tag)) return null
  if (m[3]) return `${jahr}-${zwei(monat)}-${zwei(tag)}`
  const kandidat = `${standJahr}-${zwei(monat)}-${zwei(tag)}`
  return kandidat <= stand || !gibtEs(standJahr - 1, monat, tag) ? kandidat : `${standJahr - 1}-${zwei(monat)}-${zwei(tag)}`
}

function gibtEs(jahr: number, monat: number, tag: number): boolean {
  const d = new Date(Date.UTC(jahr, monat - 1, tag))
  return d.getUTCFullYear() === jahr && d.getUTCMonth() === monat - 1 && d.getUTCDate() === tag
}

/** „25k“ → 25000, „5k-45k“ → 5000 (vorsichtig: der kleinere Wert), „50-70k“ → 50000, „mind.50k“ → 50000,
 *  „evtl 100k“ → 100000, „?“/„fraglich“ → null. eindeutig = genau eine Zahl ohne Zusatz. */
export function umsatzAusText(v: unknown): { wert: number | null; eindeutig: boolean } {
  if (typeof v === 'number') return { wert: Number.isFinite(v) ? v : null, eindeutig: true }
  const s = text(v)?.toLowerCase().replace(/\s+/g, '') ?? ''
  if (!s || /^\?+$/.test(s)) return { wert: null, eindeutig: true }
  const teile = [...s.matchAll(/(\d+(?:[.,]\d+)?)(k|tsd|t€|mio)?/g)]
  if (teile.length === 0) return { wert: null, eindeutig: false }
  // Bei „50-70k“ gilt das „k“ des zweiten Werts auch für den ersten.
  const letzteEinheit = teile[teile.length - 1][2]
  const werte = teile.map((t, i) => {
    const n = Number(t[1].replace(',', '.'))
    const einheit = t[2] ?? (i < teile.length - 1 && teile.length > 1 ? letzteEinheit : undefined)
    return einheit === 'mio' ? n * 1_000_000 : einheit ? n * 1000 : n
  })
  const wert = Math.min(...werte)
  const eindeutig = teile.length === 1 && new RegExp(`^${teile[0][0].replace('.', '\\.')}€?$`).test(s)
  return { wert, eindeutig }
}

const KUERZEL: Record<string, string> = {
  ql: 'Quirin Lutzenberger',
  hs: 'Hasan Süslü',
  am: 'Andreas Mayer',
  mg: 'Markus Gröber',
  ey: 'Eray Yesil',
}

/** „QL“, „Q.L “, „HS.“, „A.M“, „QL HS“ → volle Namen (mit Komma). Unbekanntes bleibt als Text. */
export function zustaendigName(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const teile = s.split(/[\s,/+&]+/).filter(Boolean)
  const namen: string[] = []
  for (const t of teile) {
    const k = t.toLowerCase().replace(/[^a-zäöü]/g, '')
    if (KUERZEL[k]) namen.push(KUERZEL[k])
    else if (k) namen.push(t.replace(/\.+$/, ''))
  }
  return namen.length ? [...new Set(namen)].join(', ') : null
}

export function istKuerzel(v: unknown): boolean {
  const s = text(v)
  if (!s || s.length > 8) return false
  return s.split(/[\s,/+&]+/).filter(Boolean).every((t) => !!KUERZEL[t.toLowerCase().replace(/[^a-zäöü]/g, '')])
}

/** Stabile Kennung aus dem Inhalt der Zeile (gleiche Zeile → gleiche Kennung bei jedem Einspielen). */
export function stabileId(teile: (string | number | null | undefined)[]): string {
  const s = teile.map((t) => String(t ?? '').trim().replace(/\s+/g, ' ').toLowerCase()).join('|')
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `todo_ql_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

function prioWert(v: unknown): string | null {
  const s = text(v)?.toUpperCase().replace(/[^A-Z]/g, '') ?? ''
  return s ? s.charAt(0) : null
}

function istDatenZeile(r: unknown[]): boolean {
  // Daten beginnen mit einem Datum (Zahl oder „17.9.“) oder haben eine Prio und eine Aufgabe/Kunden.
  const a = r[0]
  const datumsartig = typeof a === 'number' || /^\d{1,2}\.\d{1,2}\.?/.test(String(a ?? ''))
  const prio = /^[A-E]\s*$/i.test(String(r[1] ?? '').trim())
  return (datumsartig || prio) && r.slice(3, 9).some((c) => text(c) !== null)
}

type Rohfelder = {
  start: unknown
  prio: unknown
  unter: unknown
  kunde: unknown
  aufgabe: unknown
  abt: unknown
  stand: unknown
  fragen: unknown
  naechstes: unknown
  zust: unknown
  geplant: unknown
  ist: unknown
  umsatz: unknown
  wv: unknown
  /** Mögliche Erledigt-Daten in der Reihenfolge, in der sie gelten; Texte darunter wandern in den Stand. */
  erledigt: unknown[]
  /** Freie Zusatzangaben in Spalten ohne festen Platz (werden an den Stand gehängt). */
  zusatz?: unknown[]
}

function baue(f: Rohfelder, blatt: 'offen' | 'erledigt', zeile: number, stand: string): ImportTodo | null {
  const kunde = text(f.kunde)
  const stand_ = text(f.stand)
  const naechste = text(f.naechstes)
  const aufgabe = text(f.aufgabe) ?? naechste ?? stand_?.split('\n')[0] ?? kunde
  if (!aufgabe) return null
  const umsatzText = text(f.umsatz)
  const umsatz = umsatzAusText(f.umsatz)
  const geplantMin = zahl(f.geplant)
  const start = excelDatum(f.start, stand)
  // Erledigt-Datum: das erste lesbare Datum, das nicht vor dem Start liegt. Texte in diesen Spalten („1.9 wird gemacht“) → Stand.
  let erledigtDatum: string | null = null
  const zusatz: string[] = []
  if (blatt === 'erledigt') {
    for (const k of f.erledigt) {
      const d = excelDatum(k, stand)
      if (d && !erledigtDatum && (!start || d >= start) && d <= stand) erledigtDatum = d
      else if (!d && text(k)) zusatz.push(text(k) as string)
    }
  }
  for (const z of f.zusatz ?? []) if (text(z)) zusatz.push(text(z) as string)
  const notizen = [stand_, ...zusatz, umsatzText && !umsatz.eindeutig ? `Umsatz laut Liste: ${umsatzText}` : null].filter(Boolean) as string[]
  const t: ImportTodo = {
    id: '',
    blatt,
    zeile,
    start_datum: start,
    prio: prioWert(f.prio),
    unter_prio: zahl(f.unter),
    kunde_projekt: kunde,
    aufgabe,
    abteilung: text(f.abt),
    aktueller_stand: notizen.length ? notizen.join('\n') : null,
    welche_fragen: text(f.fragen),
    naechste_schritte: naechste,
    zustaendig: zustaendigName(f.zust),
    geplante_zeit: geplantMin !== null && geplantMin > 0 ? String(Math.round(geplantMin)) : null,
    ist_zeit: zahl(f.ist),
    umsatz_wert: umsatz.wert,
    umsatz_text: umsatzText && !umsatz.eindeutig ? umsatzText : null,
    geplante_wiedervorlage: excelDatum(f.wv, stand),
    erledigt_am: blatt === 'erledigt' ? (erledigtDatum ?? stand) : null,
    erledigt_geschaetzt: blatt === 'erledigt' && !erledigtDatum,
  }
  // Kennung aus dem, was die Zeile ausmacht — nicht aus Stand/Fragen (die ändern sich von Liste zu Liste).
  t.id = stabileId([blatt === 'erledigt' ? 'e' : 'o', t.start_datum, t.kunde_projekt, t.aufgabe])
  return t
}

/** Reiter „to Do“. stand = Datum der Liste (JJJJ-MM-TT). */
export function leseToDoBlatt(zeilen: unknown[][], stand: string): ImportTodo[] {
  const raus: ImportTodo[] = []
  zeilen.forEach((r, i) => {
    if (!Array.isArray(r) || !istDatenZeile(r)) return
    const t = baue(
      { start: r[0], prio: r[1], unter: r[2], kunde: r[3], aufgabe: r[4], abt: r[5], stand: r[6], fragen: r[7], naechstes: r[8], zust: r[9], geplant: r[10], ist: r[11], umsatz: r[12], wv: r[13], erledigt: [] },
      'offen',
      i + 1,
      stand,
    )
    if (t) raus.push(t)
  })
  return raus
}

/** Reiter „erledigte Aufgaben“ — drei Anordnungen, erkannt am Kürzel des Zuständigen in Spalte 7, 8 oder 9. */
export function leseErledigtBlatt(zeilen: unknown[][], stand: string): ImportTodo[] {
  const raus: ImportTodo[] = []
  zeilen.forEach((r, i) => {
    if (!Array.isArray(r) || !istDatenZeile(r)) return
    const basis = { start: r[0], prio: r[1], unter: r[2], kunde: r[3], aufgabe: r[4], abt: r[5] }
    let f: Rohfelder
    if (istKuerzel(r[9])) {
      // Anordnung wie „to Do“.
      f = { ...basis, stand: r[6], fragen: r[7], naechstes: r[8], zust: r[9], geplant: r[10], ist: r[11], umsatz: r[12], wv: null, erledigt: [r[14], r[13]] }
    } else if (istKuerzel(r[8])) {
      // Ältere Fassung: Stand, nächster Schritt, zuständig, Zeit, Ist, Umsatz, Datum in Spalte 12.
      f = { ...basis, stand: r[6], fragen: null, naechstes: r[7], zust: r[8], geplant: r[9], ist: r[10], umsatz: r[11], wv: null, erledigt: [r[14], r[12]], zusatz: [r[13]] }
    } else {
      // Überschriften dieses Reiters: Fragen/Infos, zuständig, Info, Zeit, Ist, Umsatz, Wiedervorlage, erledigt.
      const zust = istKuerzel(r[7]) ? r[7] : null
      f = { ...basis, stand: r[6], fragen: null, naechstes: zust ? null : r[7], zust, geplant: r[9], ist: r[10], umsatz: r[11], wv: null, erledigt: [r[14], r[12]], zusatz: [r[8], r[13]] }
    }
    const t = baue(f, 'erledigt', i + 1, stand)
    if (t) raus.push(t)
  })
  return raus
}

// ── Tagesablauf ───────────────────────────────────────────────────────────────────────────────────

/** „1130“ (Excel-Zahl) oder „11:30“ → "11:30". */
function uhrAus(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 0 && v < 1) {
      const min = Math.round(v * 24 * 60)
      return `${zwei(Math.floor(min / 60))}:${zwei(min % 60)}`
    }
    const h = Math.floor(v / 100)
    const m = Math.round(v % 100)
    return h <= 24 && m < 60 ? `${zwei(h)}:${zwei(m)}` : undefined
  }
  const s = text(v)
  const m = s ? /^(\d{1,2})[:.](\d{2})$/.exec(s) : null
  return m ? `${zwei(Number(m[1]))}:${m[2]}` : undefined
}

/** Reiter des Tagesablaufs. Die Blöcke stehen untereinander; erkannt an der ersten Spalte (Organisatorisch, Fristsachen,
 *  A, B, C, „viele 3-7 Min“, Unvorhergesehenes). Was in Spalte 4 steht, ist eine Zeile; „ca. Min.“/„bis Uhrzeit“ in einer
 *  Zeile ohne Text gehören zur Zeile darüber; Spalte 7 „Anrufe“. */
export function leseTagesablauf(zeilen: unknown[][], idVon: (block: PlanBlock, nr: number) => string): ImportTagesablauf {
  const erg: ImportTagesablauf = { datum: null, ort: null, bearbeiter: null, zeilen: [], anrufe: '', gesamtMin: null }
  const anrufe: string[] = []
  let block: PlanBlock | null = null
  let nr = 0
  for (const r of zeilen) {
    if (!Array.isArray(r)) continue
    const a = (text(r[0]) ?? '').toLowerCase()
    const alleTexte = r.map((c) => text(c) ?? '').join(' ')
    const datum = /Datum\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(alleTexte)
    if (datum) erg.datum = `${datum[3]}-${zwei(Number(datum[2]))}-${zwei(Number(datum[1]))}`
    const ort = /Ort[_\s:]*([A-Za-zÄÖÜäöüß .-]+?)_{2,}/.exec(alleTexte)
    if (ort) erg.ort = ort[1].trim().replace(/^\w/, (c) => c.toUpperCase()).replace(/^(\w)(\w+)$/, (_m, x: string, y: string) => x + y.toLowerCase())
    const bearb = /Bearbeiter[_\s:]*([A-Za-zÄÖÜäöüß .-]+?)_{2,}/.exec(alleTexte)
    if (bearb) erg.bearbeiter = bearb[1].trim()
    if (a.startsWith('gesamtzeit')) {
      erg.gesamtMin = zahl(r[1])
      block = null
      continue
    }
    if (a.startsWith('orginatori') || (a.startsWith('organisatori') && block === null)) block = 'organisation'
    else if (a.startsWith('fristsachen')) block = 'frist'
    else if (/^a\s*$/.test(a)) block = 'A'
    else if (/^b\s*$/.test(a)) block = 'B'
    else if (/^c\s*$/.test(a)) block = 'C'
    else if (a.startsWith('viele')) block = 'kurz'
    else if (a.startsWith('unvorher')) block = 'unvorhergesehen'
    else if (a.startsWith('sonstige')) block = null
    if (!block) continue
    const was = text(r[4])
    const dauer = zahl(r[1])
    const bis = uhrAus(r[2])
    const anruf = text(r[7])
    if (anruf && !/^anrufe$/i.test(anruf)) anrufe.push(anruf)
    if (was && !/^was ist heute/i.test(was)) {
      nr += 1
      const z: PlanZeile = { id: idVon(block, nr), block, was: was.replace(/[_\s]{3,}$/, '').replace(/,\s*$/, '').trim() }
      if (dauer && dauer > 0) z.dauerMin = Math.round(dauer)
      if (bis) z.bisUhr = bis
      const gv = text(r[5])
      if (gv) z.ergebnis = gv
      const infos = text(r[6])
      if (infos) z.stand = infos
      if (anruf) z.stand = [z.stand, `Anrufe: ${anruf}`].filter(Boolean).join(' · ')
      erg.zeilen.push(z)
    } else if ((dauer || bis) && erg.zeilen.length && erg.zeilen[erg.zeilen.length - 1].block === block) {
      // Zeit ohne Text: gehört zur letzten Zeile desselben Blocks.
      const letzte = erg.zeilen[erg.zeilen.length - 1]
      if (dauer && dauer > 0 && !letzte.dauerMin) letzte.dauerMin = Math.round(dauer)
      if (bis && !letzte.bisUhr) letzte.bisUhr = bis
    }
  }
  erg.anrufe = anrufe.join('\n')
  return erg
}
