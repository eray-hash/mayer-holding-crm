// Reine Hilfen für die Anzeige der „Bewertung per Knopf" eines Objekts (ObjektBewertungSection.tsx):
// Kennzahlen als Text, Vergleich mit der Kaufpreisvorstellung, den Berichtstext in Überschriften,
// Absätze, Listen und Tabellen zerlegen, die Übernahme in die Vorab-Kurzprüfung und die Druckausgabe.
// Nichts hier spricht mit dem Server oder ändert gespeicherte Daten.

import { fmtDateTime, fmtEUR, fmtEURCent, today } from './dates'
import type { DruckAbschnitt } from './blattDruck'
import type { Objekt, ObjektBewertung, ObjektKurzpruefung } from '../types'

type Kennzahlen = NonNullable<ObjektBewertung['kennzahlen']>

/** Nur echte, positive Zahlen zählen — der Server lässt fehlende Werte weg oder liefert null. */
function zahl(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

function fmtZahl(n: number, stellen = 1): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: stellen })
}

/** Beträge pro m²: kleine Werte (Mieten) mit Cent, große (Kaufpreise) ohne. */
function fmtProQm(n: number): string {
  return n < 1000 && !Number.isInteger(n) ? fmtEURCent(n) : fmtEUR(n)
}

// ── Stand des Laufs ──────────────────────────────────────────────────────────────────────────────

/** Kurzform des Server-Stands zum Vergleichen: ändert sich, sobald der Server etwas Neues geschrieben hat. */
export function bewertungSignatur(b: ObjektBewertung | null | undefined): string {
  return b ? [b.status, b.schrittNr ?? '', b.aktualisiertAm ?? '', b.gestartetAm].join('|') : ''
}

/** Ein Schritt dauert höchstens gut zwei Minuten. Rührt sich länger nichts, kommt der Lauf von selbst nicht zurück. */
export const HAENGT_NACH_MS = 4 * 60 * 1000

export function letzterFortschritt(b: ObjektBewertung): number {
  const t = new Date(b.aktualisiertAm ?? b.gestartetAm).getTime()
  return Number.isFinite(t) ? t : 0
}

export function bewertungHaengt(b: ObjektBewertung | undefined, jetzt: number): boolean {
  if (!b || b.status !== 'laeuft') return false
  const t = letzterFortschritt(b)
  return t > 0 && jetzt - t > HAENGT_NACH_MS
}

/** „Schritt 2 von 4: Markt recherchieren" — lässt weg, was der Server (noch) nicht gemeldet hat. */
export function schrittText(b: ObjektBewertung, ohne = 'Bewertung läuft …'): string {
  const nr = zahl(b.schrittNr)
  const gesamt = zahl(b.schritteGesamt)
  const kopf = nr ? `Schritt ${nr}${gesamt ? ` von ${gesamt}` : ''}` : ''
  const name = (b.schritt ?? '').trim()
  if (kopf && name) return `${kopf}: ${name}`
  return kopf || name || ohne
}

/** Anteil für den Fortschrittsbalken in Prozent: fertige Schritte plus ein halber für den laufenden. */
export function fortschrittProzent(b: ObjektBewertung): number {
  const nr = zahl(b.schrittNr)
  const gesamt = zahl(b.schritteGesamt)
  if (!nr || !gesamt) return 5
  return Math.min(97, Math.max(5, Math.round(((nr - 0.5) / gesamt) * 100)))
}

export function zeitpunkt(iso: string | undefined): string {
  if (!iso) return ''
  return Number.isFinite(new Date(iso).getTime()) ? fmtDateTime(iso) : ''
}

/** Vorauswahl der KI-Anweisung: erst eine mit „Bewertung" im Namen, dann „Master", sonst die einzige vorhandene. */
export function schlageAnweisungVor(anweisungen: { id: string; name: string }[], zuletztId?: string): string {
  if (zuletztId && anweisungen.some((a) => a.id === zuletztId)) return zuletztId
  const treffer = anweisungen.find((a) => /bewertung/i.test(a.name)) ?? anweisungen.find((a) => /master/i.test(a.name))
  if (treffer) return treffer.id
  return anweisungen.length === 1 ? anweisungen[0].id : ''
}

/** Wie viele Unterlagen das Objekt hat; `mitDatei` sind die mit hinterlegter Datei — nur die kann der Server lesen. */
export function zaehleUnterlagen(objekt: Objekt): { gesamt: number; mitDatei: number; ordner: number } {
  const listen = Object.values(objekt.dokumente ?? {}).map((l) => l ?? [])
  const alle = listen.flat()
  return { gesamt: alle.length, mitDatei: alle.filter((d) => !!d.url).length, ordner: listen.filter((l) => l.length > 0).length }
}

// ── Kennzahlen ───────────────────────────────────────────────────────────────────────────────────

/** Bezugswert für den Vergleich: der genannte Marktwert, sonst die Mitte der Spanne. */
export function marktwertMitte(k: Kennzahlen | undefined): number | undefined {
  if (!k) return undefined
  const von = zahl(k.marktwertVon)
  const bis = zahl(k.marktwertBis)
  return zahl(k.marktwert) ?? (von && bis ? (von + bis) / 2 : von ?? bis)
}

/** „1.150.000 € – 1.320.000 €" oder ein einzelner Wert; leer, wenn der Bericht keinen Marktwert nennt. */
export function marktwertText(k: Kennzahlen | undefined): string {
  if (!k) return ''
  const von = zahl(k.marktwertVon)
  const bis = zahl(k.marktwertBis)
  if (von && bis && von !== bis) return `${fmtEUR(Math.min(von, bis))} – ${fmtEUR(Math.max(von, bis))}`
  const einzel = zahl(k.marktwert) ?? von ?? bis
  return einzel ? fmtEUR(einzel) : ''
}

/** „Kaufpreisvorstellung 12 % über dem Mittelwert (oberhalb der Spanne)" — leer ohne Kaufpreis oder Marktwert. */
export function kaufpreisVergleich(kaufpreis: number, k: Kennzahlen | undefined): string {
  const preis = zahl(kaufpreis)
  const mitte = marktwertMitte(k)
  if (!preis || !mitte || !k) return ''
  const von = zahl(k.marktwertVon)
  const bis = zahl(k.marktwertBis)
  const spanne = von && bis && von !== bis ? { von: Math.min(von, bis), bis: Math.max(von, bis) } : null
  const bezug = spanne ? 'dem Mittelwert' : 'dem Marktwert'
  const prozent = Math.round(((preis - mitte) / mitte) * 100)
  const lage = spanne ? (preis > spanne.bis ? ' (oberhalb der Spanne)' : preis < spanne.von ? ' (unterhalb der Spanne)' : ' (innerhalb der Spanne)') : ''
  const kopf = `Kaufpreisvorstellung ${fmtEUR(preis)}`
  if (prozent === 0) return `${kopf}: entspricht ${bezug}${lage}`
  return `${kopf}: ${Math.abs(prozent)} % ${prozent > 0 ? 'über' : 'unter'} ${bezug}${lage}`
}

export type KennzahlKachel = { id: string; titel: string; wert: string; zusatz?: string; breit?: boolean }

/** Die Kacheln über dem Bericht — nur für Werte, die der Bericht wirklich nennt. */
export function kennzahlKacheln(k: Kennzahlen | undefined, kaufpreis: number): KennzahlKachel[] {
  if (!k) return []
  const kacheln: KennzahlKachel[] = []
  const markt = marktwertText(k)
  if (markt) {
    const mitte = marktwertMitte(k)
    const istSpanne = markt.includes('–')
    const teile = [istSpanne && mitte ? `Mittelwert ${fmtEUR(mitte)}` : '', kaufpreisVergleich(kaufpreis, k)].filter(Boolean)
    kacheln.push({ id: 'marktwert', titel: 'Marktwert', wert: markt, zusatz: teile.join(' · ') || undefined, breit: true })
  }
  const preisQm = zahl(k.preisProQm)
  if (preisQm) kacheln.push({ id: 'preisProQm', titel: 'Preis pro m²', wert: fmtProQm(preisQm) })
  const mieteQm = zahl(k.mieteProQm)
  if (mieteQm) kacheln.push({ id: 'mieteProQm', titel: 'Miete pro m²', wert: fmtProQm(mieteQm), zusatz: 'im Monat' })
  const faktor = zahl(k.kaufpreisfaktor)
  if (faktor) kacheln.push({ id: 'kaufpreisfaktor', titel: 'Kaufpreisfaktor', wert: `${fmtZahl(faktor)}-fach`, zusatz: 'Kaufpreis geteilt durch Jahresmiete' })
  const rendite = zahl(k.rendite)
  if (rendite) kacheln.push({ id: 'rendite', titel: 'Rendite', wert: `${fmtZahl(rendite, 2)} %`, zusatz: 'im Jahr' })
  return kacheln
}

// ── Übernahme in die Vorab-Kurzprüfung ───────────────────────────────────────────────────────────

/** Gleiche Startwerte wie `leer()` in ObjektKurzpruefungBlatt.tsx — dort nicht exportiert, deshalb hier nachgebaut. */
export function leereKurzpruefung(o: Objekt): ObjektKurzpruefung {
  return {
    datum: today(),
    zeilen: { preis: { ist: o.kaufpreis > 0 ? fmtEUR(o.kaufpreis) : '', marktwert: '', ergebnis: '' } },
    provisionProzent: '',
    provisionBetrag: '',
    verkaeuferBekannt: '',
    direktesMandat: '',
    offeneFragen: '',
    gruendeDagegen: ['', '', '', ''],
    gruendeDafuer: ['', '', '', ''],
    prioBegruendung: '',
    zeiterfordernis: '',
    naechsteSchritte: ['', '', '', ''],
  }
}

/** Welche Kennzahl in welche Zeile der Kurzprüfung gehört (Zeilen-Kennungen wie in ObjektKurzpruefungBlatt.tsx). */
function kurzpruefungWerte(k: Kennzahlen): { id: string; label: string; text: string }[] {
  const preisQm = zahl(k.preisProQm)
  const mieteQm = zahl(k.mieteProQm)
  const rendite = zahl(k.rendite)
  const faktor = zahl(k.kaufpreisfaktor)
  return [
    { id: 'preis', label: 'Preis', text: marktwertText(k) },
    { id: 'preisProQm', label: 'Preis pro m²', text: preisQm ? fmtProQm(preisQm) : '' },
    { id: 'mieteProQm', label: 'Miete pro m²', text: mieteQm ? fmtProQm(mieteQm) : '' },
    { id: 'rendite', label: 'Rendite', text: rendite ? `${fmtZahl(rendite, 2)} %` : '' },
    { id: 'kaufpreisfaktor', label: 'Kaufpreisfaktor', text: faktor ? fmtZahl(faktor) : '' },
  ].filter((w) => w.text !== '')
}

export function hatUebernehmbareKennzahlen(k: Kennzahlen | undefined): boolean {
  return !!k && kurzpruefungWerte(k).length > 0
}

/** Trägt die Kennzahlen in die Spalte „Marktwert" der Kurzprüfung ein — nur in leere Felder, alles andere bleibt.
 *  `gefuellt` / `belegt` nennen die Zeilen, die eingetragen bzw. wegen vorhandenem Inhalt übersprungen wurden. */
export function uebernehmeInKurzpruefung(objekt: Objekt, k: Kennzahlen | undefined): { kurzpruefung: ObjektKurzpruefung; gefuellt: string[]; belegt: string[] } {
  const basis = objekt.kurzpruefung ?? leereKurzpruefung(objekt)
  const zeilen = { ...basis.zeilen }
  const gefuellt: string[] = []
  const belegt: string[] = []
  for (const w of k ? kurzpruefungWerte(k) : []) {
    const alt = zeilen[w.id] ?? { ist: '', marktwert: '', ergebnis: '' }
    if ((alt.marktwert ?? '').trim() !== '') {
      belegt.push(w.label)
      continue
    }
    zeilen[w.id] = { ...alt, marktwert: w.text }
    gefuellt.push(w.label)
  }
  return { kurzpruefung: { ...basis, zeilen }, gefuellt, belegt }
}

// ── Berichtstext zerlegen ────────────────────────────────────────────────────────────────────────

export type BerichtBlock =
  | { art: 'ueberschrift'; ebene: 1 | 2 | 3; text: string }
  | { art: 'absatz'; text: string }
  | { art: 'liste'; punkte: { marke?: string; text: string }[] }
  | { art: 'tabelle'; kopf: string[]; zeilen: string[][] }

/** Zeile ganz in Großbuchstaben („LAGE UND UMFELD", „3. FAZIT:") — so setzen die hinterlegten Anweisungen ihre Überschriften. */
function istGrossUeberschrift(zeile: string): boolean {
  if (zeile.length < 4 || zeile.length > 90) return false
  if (zeile !== zeile.toUpperCase()) return false
  const buchstaben = (zeile.match(/\p{Lu}/gu) ?? []).length
  const zeichen = zeile.replace(/\s/g, '').length
  // Reine Zahlenzeilen wie „EUR 1.200.000" sind keine Überschrift.
  return buchstaben >= 4 && buchstaben * 2 >= zeichen
}

function tabellenZellen(zeile: string): string[] {
  return zeile
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((z) => z.trim())
}

/** Zerlegt den Bericht (schlichter Text; Überschriften in Großbuchstaben oder mit „#", Listen mit „-") in Blöcke. */
export function zerlegeBericht(text: string): BerichtBlock[] {
  const bloecke: BerichtBlock[] = []
  let absatz: string[] = []
  let liste: { marke?: string; text: string }[] | null = null
  let tabelle: string[][] | null = null

  function abschliessen() {
    if (absatz.length > 0) bloecke.push({ art: 'absatz', text: absatz.join('\n') })
    if (liste && liste.length > 0) bloecke.push({ art: 'liste', punkte: liste })
    if (tabelle && tabelle.length > 0) bloecke.push({ art: 'tabelle', kopf: tabelle[0], zeilen: tabelle.slice(1) })
    absatz = []
    liste = null
    tabelle = null
  }

  for (const roh of text.replace(/\r\n?/g, '\n').split('\n')) {
    const zeile = roh.trim()
    if (zeile === '' || /^([-*_=])\1{2,}$/.test(zeile)) {
      abschliessen()
      continue
    }
    const raute = /^(#{1,6})\s+(.+?)\s*#*$/.exec(zeile)
    if (raute) {
      abschliessen()
      bloecke.push({ art: 'ueberschrift', ebene: raute[1].length <= 1 ? 1 : raute[1].length === 2 ? 2 : 3, text: ohneAuszeichnung(raute[2]) })
      continue
    }
    if (/^\|.*\|/.test(zeile)) {
      if (!tabelle) {
        abschliessen()
        tabelle = []
      }
      // Trennzeile zwischen Kopf und Inhalt („|---|---|") trägt keinen Inhalt.
      if (!/^[|\s:-]+$/.test(zeile)) tabelle.push(tabellenZellen(zeile))
      continue
    }
    const punkt = /^[-*•–]\s+(.+)$/.exec(zeile)
    const nummer = punkt ? null : /^(\d{1,2}[.)])\s+(.+)$/.exec(zeile)
    if (punkt || (nummer && !istGrossUeberschrift(zeile))) {
      if (!liste) {
        abschliessen()
        liste = []
      }
      liste.push(punkt ? { text: punkt[1] } : { marke: nummer![1], text: nummer![2] })
      continue
    }
    if (istGrossUeberschrift(zeile.replace(/\*\*/g, ''))) {
      abschliessen()
      bloecke.push({ art: 'ueberschrift', ebene: 2, text: ohneAuszeichnung(zeile).replace(/:$/, '') })
      continue
    }
    // Eine Zeile, die als Ganzes fett gesetzt ist („**Fazit**"), ist eine Zwischenüberschrift.
    const fettZeile = /^\*\*([^*]+)\*\*:?$/.exec(zeile)
    if (fettZeile && fettZeile[1].length <= 90) {
      abschliessen()
      bloecke.push({ art: 'ueberschrift', ebene: 3, text: fettZeile[1].trim().replace(/:$/, '') })
      continue
    }
    // Eingerückte Folgezeile gehört noch zum letzten Listenpunkt.
    if (liste && liste.length > 0 && /^\s{2,}\S/.test(roh)) {
      liste[liste.length - 1].text += ` ${zeile}`
      continue
    }
    if (liste || tabelle) abschliessen()
    absatz.push(zeile)
  }
  abschliessen()
  return bloecke
}

/** Entfernt die Sternchen für Fettdruck — für Kopieren in Felder, Überschriften und den Druck. */
export function ohneAuszeichnung(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '')
}

/** Zerlegt eine Zeile in normale und fett gesetzte Stücke („**so**"). */
export function fettStuecke(text: string): { text: string; fett: boolean }[] {
  const stuecke: { text: string; fett: boolean }[] = []
  let rest = text
  for (;;) {
    const m = /\*\*(.+?)\*\*/.exec(rest)
    if (!m) break
    if (m.index > 0) stuecke.push({ text: rest.slice(0, m.index), fett: false })
    stuecke.push({ text: m[1], fett: true })
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest) stuecke.push({ text: rest.replace(/\*\*/g, ''), fett: false })
  return stuecke
}

/** Nur gewöhnliche Internet-Adressen werden anklickbar — alles andere bleibt reiner Text. */
export function sichereAdresse(url: string | undefined): string | null {
  const u = (url ?? '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  try {
    return new URL(u).href
  } catch {
    return null
  }
}

// ── Druck ────────────────────────────────────────────────────────────────────────────────────────

export const ENTWURF_KURZ = 'KI-Entwurf, kein Gutachten.'
export const ENTWURF_TEXT =
  'Diese Bewertung hat eine KI aus den Unterlagen des Objekts und einer Marktrecherche erstellt. Sie ersetzt keine Bewertung durch einen Sachverständigen. Alle Zahlen müssen vor der Weitergabe von einem Menschen anhand der genannten Quellen geprüft werden.'

/** Bewertung als Abschnitte für `druckeBlatt` (blattDruck.ts): Hinweis, Kennzahlen, Bericht, Unterlagen, Quellen. */
export function bewertungDruckAbschnitte(objekt: Objekt, b: ObjektBewertung): DruckAbschnitt[] {
  const abschnitte: DruckAbschnitt[] = [{ titel: 'Hinweis', zeilen: [['', `${ENTWURF_KURZ} ${ENTWURF_TEXT}`]] }]

  const kacheln = kennzahlKacheln(b.kennzahlen, objekt.kaufpreis)
  if (kacheln.length > 0) {
    abschnitte.push({ titel: 'Kennzahlen', zeilen: kacheln.map((k) => [k.titel, k.zusatz ? `${k.wert}\n${k.zusatz}` : k.wert]) })
  }

  // Jede Überschrift des Berichts beginnt einen Abschnitt; Tabellen werden eigene Abschnitte gleichen Namens.
  let titel = 'Bewertung'
  let zeilen: string[] = []
  const textAbschluss = () => {
    if (zeilen.length > 0) abschnitte.push({ titel, zeilen: [['', zeilen.join('\n\n')]] })
    zeilen = []
  }
  for (const block of zerlegeBericht(b.bericht ?? '')) {
    if (block.art === 'ueberschrift') {
      textAbschluss()
      titel = block.text
    } else if (block.art === 'absatz') {
      zeilen.push(ohneAuszeichnung(block.text))
    } else if (block.art === 'liste') {
      zeilen.push(block.punkte.map((p) => `${p.marke ?? '–'} ${ohneAuszeichnung(p.text)}`).join('\n'))
    } else {
      textAbschluss()
      abschnitte.push({ titel, tabelle: { kopf: block.kopf.map(ohneAuszeichnung), zeilen: block.zeilen.map((z) => z.map(ohneAuszeichnung)) } })
    }
  }
  textAbschluss()

  const gelesen = b.gelesen ?? []
  const nichtGelesen = b.nichtGelesen ?? []
  if (gelesen.length > 0 || nichtGelesen.length > 0) {
    abschnitte.push({
      titel: 'Unterlagen',
      zeilen: [
        ['Gelesen', gelesen.length > 0 ? gelesen.join('\n') : 'keine'],
        ...(nichtGelesen.length > 0 ? ([['Nicht gelesen', nichtGelesen.join('\n')]] as [string, string][]) : []),
      ],
    })
  }
  const quellen = (b.quellen ?? []).filter((q) => q && (q.titel || q.url))
  if (quellen.length > 0) {
    abschnitte.push({ titel: 'Quellen der Marktrecherche', zeilen: quellen.map((q) => [q.titel || 'Quelle', q.url ?? '']) })
  }
  return abschnitte
}

/** Zeile unter dem Titel des Ausdrucks und unter dem Ergebnis: wann, von wem, nach welcher Anweisung. */
export function entstehungText(b: ObjektBewertung): string {
  const wann = zeitpunkt(b.abgeschlossenAm ?? b.aktualisiertAm ?? b.gestartetAm)
  return [wann ? `Erstellt am ${wann}` : 'Erstellt', b.gestartetVon ? `von ${b.gestartetVon}` : '', b.vorlageName ? `nach der Anweisung „${b.vorlageName}“` : ''].filter(Boolean).join(' ')
}
