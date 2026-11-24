// Rechnungen ausstellen ohne CRM-Fenster (24.11.2026, Telegram-Werkzeug rechnung_erstellen): Rechenregeln und
// Nummernkreis genau wie das CRM, damit eine im Assistenten ausgestellte Rechnung nicht von einer im CRM angelegten
// zu unterscheiden ist. Reine Funktionen ohne Datenbank (Tests: rechnungAusstellenKern.test.ts).
//
// Vorbilder im CRM (nicht ändern, nur nachbauen):
//  - Rechnungsnummer: rechnungsnummerKern.ts (Kürzel je Kunde + laufende Nummer, Vorgabe der Geschäftsführung).
//  - src/lib/rechnungen.ts: rundeCent, summeAusPositionen (je Position auf Cent runden, Summe netto, Steuer auf den Nettobetrag, brutto = netto + Steuer).
//  - src/components/rechnungen/RechnungFormular.tsx: Zahlungsziel 14 Tage nach Rechnungsdatum, Steuersatz 19 %,
//    Einheit „Pauschal“, leistung_bezeichnung = erste Position, neue Rechnung als „Entwurf“.
//  - src/components/rechnungen/aktionen.ts: Empfängerzeilen (Firma, Ansprechpartner falls anders, Anschrift).
//  - src/module/eRechnung/ausRechnung.ts: Angaben für die XRechnung (hier mit den Angaben des Holding-Briefbogens).

import { HOLDING_ANGABEN } from './holdingBriefbogen.ts'
import type { XRechnungEingabe } from './eRechnung/erzeugen.ts'

export type RechnungPosition = { id: string; bezeichnung: string; menge: number; einheit: string; einzelpreis: number }

/** Absender-Adresse der Firma (gemeinsames Postfach), Kontakt in der XRechnung — wie ABSENDER_EMAIL im CRM. */
export const ABSENDER_EMAIL = 'info@amayer-holding.com'

export const ZAHLUNGSZIEL_TAGE = 14
export const UST_VORGABE = 19

export function rundeCent(betrag: number): number {
  return Math.round(betrag * 100) / 100
}

/** JJJJ-MM-TT plus n Tage (reine Kalenderrechnung). */
export function plusTage(datum: string, n: number): string {
  const [y, m, d] = datum.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function istIsoDatum(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = new Date(`${d}T00:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d
}

export function deDatum(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

/** Zahl ohne unnötige Nachkommastellen (Menge), deutsch. */
export function zahl(n: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(n)
}

/** Kennung wie uid() im CRM: prefix_ + 7 Zufallszeichen + 4 Zeichen Zeit. */
export function neueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9).padEnd(7, '0')}${Date.now().toString(36).slice(-4)}`
}

// ---------------------------------------------------------------------------------------------
// Positionen und Beträge

/** Netto-, Steuer- und Bruttobetrag aus Positionen (Einzelpreise netto) — wie summeAusPositionen im CRM. */
export function summeAusPositionen(positionen: { menge: number; einzelpreis: number }[], ustSatz: number): { netto: number; ust: number; brutto: number } {
  const netto = rundeCent(positionen.reduce((s, p) => s + rundeCent((Number(p.menge) || 0) * (Number(p.einzelpreis) || 0)), 0))
  const ust = rundeCent((netto * (ustSatz || 0)) / 100)
  return { netto, ust, brutto: rundeCent(netto + ust) }
}

/** Einheit in der Schreibweise des CRM (KV_EINHEITEN: Stunde, Tag, Pauschal, Stück); andere bleiben wie genannt. */
export function einheitAus(roh: unknown): string {
  const e = String(roh ?? '').trim()
  const k = e.toLowerCase().replace(/\.$/, '')
  if (!k) return 'Pauschal'
  if (/^(std|stunde|stunden|h)$/.test(k)) return 'Stunde'
  if (/^(tag|tage)$/.test(k)) return 'Tag'
  if (/^(pauschal|pauschale|psch|pausch)$/.test(k)) return 'Pauschal'
  if (/^(stk|stück|stueck)$/.test(k)) return 'Stück'
  return e.slice(0, 20)
}

/** Einheit für die Mengenspalte im PDF (wie rechnungPdf.ts im CRM: Std., Tag/Tage, sonst wie gespeichert). */
export function einheitAnzeige(einheit: string, menge: number): string {
  if (einheit === 'Stunde') return 'Std.'
  if (einheit === 'Tag') return menge === 1 ? 'Tag' : 'Tage'
  return einheit
}

/** Zahl aus Eingabe (Zahl oder deutscher Text wie „5.000,50“). NaN, wenn nicht lesbar. */
export function zahlAus(w: unknown): number {
  if (typeof w === 'number') return w
  const t = String(w ?? '').trim().replace(/\s|€|eur/gi, '')
  if (!t) return NaN
  const normal = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : NaN
}

/** Positionen aus der Werkzeug-Eingabe prüfen; Fehlertext oder die Positionen (Einzelpreis auf Cent gerundet). */
export function lesePositionen(roh: unknown): RechnungPosition[] | string {
  if (!Array.isArray(roh) || roh.length === 0) return 'Fehler: Es fehlt mindestens eine Position (bezeichnung, menge, einzelpreis netto).'
  if (roh.length > 40) return 'Fehler: Höchstens 40 Positionen je Rechnung.'
  const aus: RechnungPosition[] = []
  for (const [i, p] of roh.entries()) {
    // deno-lint-ignore no-explicit-any
    const q = (p ?? {}) as any
    const bezeichnung = String(q.bezeichnung ?? '').replace(/\s+/g, ' ').trim()
    if (!bezeichnung) return `Fehler: Position ${i + 1} hat keine Bezeichnung.`
    if (bezeichnung.length > 300) return `Fehler: Die Bezeichnung von Position ${i + 1} ist zu lang (höchstens 300 Zeichen).`
    const menge = q.menge === undefined || q.menge === null || q.menge === '' ? 1 : zahlAus(q.menge)
    if (!Number.isFinite(menge) || menge <= 0 || menge > 1_000_000) return `Fehler: Position ${i + 1} („${bezeichnung}“) braucht eine Menge größer als 0.`
    const preis = zahlAus(q.einzelpreis)
    if (!Number.isFinite(preis) || Math.abs(preis) > 10_000_000) return `Fehler: Position ${i + 1} („${bezeichnung}“) hat keinen gültigen Einzelpreis (netto in Euro).`
    aus.push({ id: neueId('p'), bezeichnung, menge: Math.round(menge * 10000) / 10000, einheit: einheitAus(q.einheit), einzelpreis: rundeCent(preis) })
  }
  return aus
}

/** Leistungsdatum/-zeitraum als Text für rechnungen.leistungszeitraum; leer = „entspricht dem Rechnungsdatum“. */
export function leistungText(leistungsdatum: unknown, zeitraum: unknown): string {
  const z = String(zeitraum ?? '').replace(/\s+/g, ' ').trim()
  if (z) return z.slice(0, 120)
  const d = String(leistungsdatum ?? '').trim()
  return istIsoDatum(d) ? deDatum(d) : ''
}

/** Ein einzelnes Datum (TT.MM.JJJJ) heißt auf der Rechnung „Leistungsdatum“, alles andere „Leistungszeitraum“. */
export function leistungBeschriftung(text: string): 'Leistungsdatum' | 'Leistungszeitraum' {
  return !text.trim() || /^\d{2}\.\d{2}\.\d{4}$/.test(text.trim()) ? 'Leistungsdatum' : 'Leistungszeitraum'
}

// ---------------------------------------------------------------------------------------------
// Empfänger (wie src/components/rechnungen/aktionen.ts)

export type AkteFuerRechnung = {
  id: string
  firma?: string | null
  ansprechpartner?: string | null
  anschrift?: string | null
  email?: string | null
  immo_stammdaten?: { adresse?: string | null } | null
}

/** Anschrift in Zeilen: mehrzeilig wie gespeichert; einzeilig „Straße 1, 89075 Ulm“ wird an den Kommas geteilt. */
export function anschriftZeilen(text: string | null | undefined): string[] {
  const t = String(text ?? '').trim()
  if (!t) return []
  const zeilen = t.includes('\n') ? t.split('\n') : t.split(/,\s*/)
  return zeilen.map((z) => z.trim()).filter(Boolean)
}

/** Anschrift für die Rechnung: angegeben, sonst aus der Akte (Anschrift, bei Immobilienkunden die Adresse der Stammdaten). */
export function anschriftFuer(angegeben: string | null | undefined, akte: AkteFuerRechnung): string[] {
  const eigene = anschriftZeilen(angegeben)
  if (eigene.length) return eigene
  const ausAkte = anschriftZeilen(akte.anschrift)
  if (ausAkte.length) return ausAkte
  return anschriftZeilen(akte.immo_stammdaten?.adresse ?? '')
}

/** Empfängerzeilen: Firma, Ansprechpartner (falls anders), Anschrift — ohne doppelte Zeilen. */
export function empfaengerZeilen(akte: AkteFuerRechnung, anschrift: string[]): string[] {
  const firma = String(akte.firma ?? '').trim()
  const person = String(akte.ansprechpartner ?? '').trim()
  const zeilen = [firma, person && person !== firma ? person : '', ...anschrift].map((z) => z.trim()).filter(Boolean)
  return zeilen.filter((z, i) => zeilen.findIndex((x) => x.toLowerCase() === z.toLowerCase()) === i)
}

/** Hat die Anschrift eine Zeile „PLZ Ort“? (Pflicht für Rechnung und E-Rechnung.) */
export function hatPlzOrt(anschrift: string[]): boolean {
  return anschrift.some((z) => /^\s*(?:D-)?\d{4,5}\s+\S/.test(z))
}

export function rechnungDateiname(nummer: string, datum: string): string {
  return `Rechnung ${nummer.replace(/[\\/:*?"<>|]/g, '-').trim()} (${deDatum(datum)}).pdf`
}

export function xRechnungDateiname(nummer: string): string {
  return `${nummer.trim().replace(/[\\/:*?"<>|\s]+/g, '-') || 'Rechnung'}_XRechnung.xml`
}

// ---------------------------------------------------------------------------------------------
// E-Rechnung (Modul „E-Rechnung“, nur wenn eingeschaltet): Angaben wie src/module/eRechnung/ausRechnung.ts

export function xRechnungEingabe(
  r: { nummer: string; datum: string; zahlungsziel?: string | null; leistungszeitraum?: string | null; positionen: { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[]; ust_satz: number; hinweis?: string | null },
  akte: AkteFuerRechnung,
  empfaenger: string[],
): XRechnungEingabe {
  const ADRESSE = /^\s*(\d{5})\s+(.+)$/
  const idxOrt = empfaenger.findIndex((z) => ADRESSE.test(z))
  const ort = idxOrt >= 0 ? empfaenger[idxOrt].match(ADRESSE) : null
  const vorOrt = idxOrt >= 0 ? empfaenger.slice(0, idxOrt) : empfaenger
  const hinweis = String(r.hinweis ?? '').trim()
  return {
    nummer: r.nummer,
    datum: r.datum,
    faellig: r.zahlungsziel || undefined,
    leistungszeitraum: String(r.leistungszeitraum ?? '').trim() || undefined,
    verkaeufer: {
      name: HOLDING_ANGABEN.firma,
      strasse: HOLDING_ANGABEN.strasse,
      plz: HOLDING_ANGABEN.plz,
      ort: HOLDING_ANGABEN.ort,
      land: 'DE',
      steuernummer: HOLDING_ANGABEN.steuernummer,
      registernummer: HOLDING_ANGABEN.register,
      telefon: HOLDING_ANGABEN.telefon,
      kontaktName: HOLDING_ANGABEN.geschaeftsfuehrer,
      email: ABSENDER_EMAIL,
    },
    kaeufer: {
      name: vorOrt[0] || String(akte.firma ?? '').trim(),
      strasse: vorOrt.length > 1 ? vorOrt[vorOrt.length - 1] : undefined,
      plz: ort?.[1],
      ort: ort?.[2],
      land: 'DE',
      email: String(akte.email ?? '').trim() || undefined,
    },
    kaeuferReferenz: akte.id,
    iban: HOLDING_ANGABEN.iban.replace(/\s/g, ''),
    positionen: r.positionen.map((p) => ({ bezeichnung: p.bezeichnung, menge: Number(p.menge) || 0, einheit: p.einheit, einzelpreis: Number(p.einzelpreis) || 0 })),
    ustSatz: r.ust_satz,
    steuerbefreiungGrund: r.ust_satz === 0 ? hinweis || undefined : undefined,
    hinweise: r.ust_satz !== 0 && hinweis ? [hinweis] : undefined,
  }
}
