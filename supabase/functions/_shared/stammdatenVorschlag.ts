// Vorschläge für Stammdaten aus Mail-Signaturen (Spalte kunden.stammdaten_vorschlaege, 22.11.2026).
// Reine Funktionen ohne Datenbank — genutzt vom Server-Ablauf (email-gateway/stammdatenErgaenzen.ts), vom
// Assistenten (telegram-gateway/stammdatenWerkzeug.ts) und vom Hinweis in der Akte
// (src/components/StammdatenVorschlaege.tsx).
//
// Ein Vorschlag entsteht, wenn ein Feld der Akte schon gefüllt ist, die Signatur in einer Mail des Kunden aber
// etwas anderes nennt. Automatisch überschrieben wird nie. Erledigte Vorschläge (übernommen/verworfen)
// bleiben in der Liste, damit derselbe Wert nicht erneut vorgeschlagen wird.

import { anschriftEinzeilig, gleicheAnschrift, gleicheNummer } from './signaturDaten.ts'

export type StammdatenFeld = 'telefon' | 'anschrift' | 'email'

export type StammdatenVorschlag = {
  /** Herkunft: Mail-Signatur (Standard) oder Gesprächs-App. */
  quelle?: 'mail' | 'gespraech'
  id: string
  feld: StammdatenFeld
  wert: string
  /** Wert der Akte, als der Vorschlag entstand. */
  bisher: string
  /** Weitere Nummer aus derselben Signatur (z. B. Handy neben Festnetz) — nur zur Information. */
  weitere?: string
  /** Datum der Mail (JJJJ-MM-TT). */
  mailDatum: string
  mailId?: string | null
  erstellt: string
  status: 'offen' | 'uebernommen' | 'verworfen'
  erledigtAm?: string
  erledigtVon?: string
}

/** Höchstzahl gespeicherter Vorschläge je Akte; ältere erledigte fallen zuerst weg. */
export const HOECHSTENS_VORSCHLAEGE = 30

export const FELD_NAME: Record<StammdatenFeld, string> = { telefon: 'Telefon', anschrift: 'Anschrift', email: 'E-Mail-Adresse' }

/** Datum JJJJ-MM-TT → TT.MM.JJJJ. */
export function deDatum(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

/** Wert für Texte: Anschrift einzeilig. */
export function wertAnzeige(feld: StammdatenFeld, wert: string): string {
  return feld === 'anschrift' ? anschriftEinzeilig(wert) : wert
}

/** Sind zwei Werte desselben Feldes gleich (Nummern und Anschriften in vergleichbarer Form)? */
export function gleicherWert(feld: StammdatenFeld, a: string | null | undefined, b: string | null | undefined): boolean {
  if (feld === 'telefon') return gleicheNummer(a, b) || (!!a && a.trim() === String(b ?? '').trim())
  if (feld === 'anschrift') return gleicheAnschrift(a, b) || (!!a && a.trim() === String(b ?? '').trim())
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && !!String(a ?? '').trim()
}

/** Liste aus der Datenbank lesen (fehlerhafte Einträge weglassen). */
export function alsVorschlaege(wert: unknown): StammdatenVorschlag[] {
  if (!Array.isArray(wert)) return []
  return wert.filter(
    (v): v is StammdatenVorschlag =>
      !!v && typeof v === 'object' && typeof (v as StammdatenVorschlag).id === 'string' && typeof (v as StammdatenVorschlag).wert === 'string' &&
      ['telefon', 'anschrift', 'email'].includes((v as StammdatenVorschlag).feld),
  )
}

export function offeneVorschlaege(wert: unknown): StammdatenVorschlag[] {
  return alsVorschlaege(wert).filter((v) => v.status === 'offen')
}

/** Gab es diesen Wert für dieses Feld schon einmal als Vorschlag (egal ob offen, übernommen oder verworfen)? */
export function schonVorgeschlagen(liste: StammdatenVorschlag[], feld: StammdatenFeld, wert: string): boolean {
  return liste.some((v) => v.feld === feld && gleicherWert(feld, v.wert, wert))
}

/** Neue Vorschläge anhängen (ohne Doppelte), Liste auf HOECHSTENS_VORSCHLAEGE kürzen. */
export function haengeAn(liste: StammdatenVorschlag[], neu: StammdatenVorschlag[]): StammdatenVorschlag[] {
  const ergebnis = [...liste]
  for (const v of neu) if (!schonVorgeschlagen(ergebnis, v.feld, v.wert)) ergebnis.push(v)
  while (ergebnis.length > HOECHSTENS_VORSCHLAEGE) {
    const erledigt = ergebnis.findIndex((v) => v.status !== 'offen')
    ergebnis.splice(erledigt >= 0 ? erledigt : 0, 1)
  }
  return ergebnis
}

/** Text des Hinweises: "Neue Telefonnummer aus Mail vom 12.11.2026: 0172 … (bisher 0731 …)". */
export function vorschlagText(v: StammdatenVorschlag): string {
  const was = v.feld === 'telefon' ? 'Neue Telefonnummer' : v.feld === 'anschrift' ? 'Neue Anschrift' : 'Neue E-Mail-Adresse'
  const bisher = v.bisher ? ` (bisher: ${wertAnzeige(v.feld, v.bisher)})` : ''
  const weitere = v.weitere ? ` — außerdem genannt: ${v.weitere}` : ''
  return `${was} ${v.quelle === 'gespraech' ? 'aus Gespräch' : 'aus Mail'} vom ${deDatum(v.mailDatum)}: ${wertAnzeige(v.feld, v.wert)}${bisher}${weitere}`
}

/** Verlaufseintrag beim automatischen Ergänzen eines leeren Feldes. */
export function ergaenztText(feld: StammdatenFeld, wert: string, mailDatum: string, weitere?: string): string {
  const quelle = feld === 'email' ? 'aus Mail' : 'aus E-Mail-Signatur'
  const zusatz = weitere ? ` (außerdem genannt: ${weitere})` : ''
  return `${FELD_NAME[feld]} ${quelle} vom ${deDatum(mailDatum)} ergänzt: ${wertAnzeige(feld, wert)}${zusatz}`
}

/** Verlaufseintrag beim Übernehmen eines Vorschlags. */
export function uebernommenText(v: StammdatenVorschlag, wer: string): string {
  const bisher = v.bisher ? ` (bisher: ${wertAnzeige(v.feld, v.bisher)})` : ''
  return `${FELD_NAME[v.feld]} ${v.quelle === 'gespraech' ? 'aus Gespräch' : 'aus Mail'} vom ${deDatum(v.mailDatum)} übernommen von ${wer}: ${wertAnzeige(v.feld, v.wert)}${bisher}`
}

/** Vorschlag als erledigt markieren (gibt eine neue Liste zurück; unbekannte id → null). */
export function erledige(liste: StammdatenVorschlag[], id: string, status: 'uebernommen' | 'verworfen', wer: string, heute: string): StammdatenVorschlag[] | null {
  if (!liste.some((v) => v.id === id && v.status === 'offen')) return null
  return liste.map((v) => (v.id === id ? { ...v, status, erledigtAm: heute, erledigtVon: wer } : v))
}
