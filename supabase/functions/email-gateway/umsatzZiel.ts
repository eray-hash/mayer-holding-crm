// Umsatzziele auf dem Server (24.11.2026, Wunsch der Geschäftsführung). Gerechnet wird mit
// _shared/umsatzZielKern.ts, geladen mit telegram-gateway/umsatzZielWerkzeug.ts (ladeZielDaten) — so nennen Seite,
// Karte „Unser Ziel“, Morgen-Übersicht und Assistent dieselben Zahlen.
//
//   { action: "umsatzziel_stand", monat?, bereich? }
//       -> { uebersicht, meldung, darfAendern, tabellenDa, soll: [...] } — für jeden aktiven Mitarbeiter (Summen ohne
//          Namen; im Browser sähe nicht jeder alle Rechnungen, deshalb rechnet der Server). Fehlt für den laufenden
//          Monat ein Soll, wird die Vorgabe der Sparte festgeschrieben („am Monatsanfang automatisch übernommen“).
//
// Täglich: Abschnitt „Umsatzziel …“ in der Morgen-Übersicht (tagesmeldung.ts) für Geschäftsführung und Admins —
// nur mit eingeschaltetem Schalter umsatz_ziel_einstellung.meldung_aktiv (Vorgabe AUS; Seite „Automatische
// Nachrichten“, Schalter-Kennung `umsatzziel_meldung`). Bewusst keine eigene Nachricht: Die Geschäftsführung bekommt
// werktags ab 8 Uhr ohnehin die Morgen-Übersicht — ein Abschnitt darin ist eine Nachricht weniger am Morgen.

import { ermittleAufrufer } from './postfach.ts'
import { ladeZielDaten, type ZielDaten } from '../telegram-gateway/umsatzZielWerkzeug.ts'
import { fehlendeSollZeilen, istMonat, kurzMeldung, morgenZeilen, zielUebersicht, berechneZielStand } from '../_shared/umsatzZielKern.ts'
import { euro, monatVon } from '../_shared/umsatzKern.ts'
import type { ZielStand } from '../_shared/umsatzZielKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Ergebnis = { status: number; daten: unknown }

/** Heutiges Datum in Berlin (JJJJ-MM-TT). */
export function heuteBerlin(jetzt: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt)
}

/** Fehlende Soll-Zeilen des laufenden Monats mit der Vorgabe festschreiben. Wirft nie. */
export async function sollFestschreiben(admin: Db, d: ZielDaten, monat: string): Promise<number> {
  if (!d.tabellenDa) return 0
  const fehlend = fehlendeSollZeilen(d.sparten, d.sollZeilen, monat)
  if (fehlend.length === 0) return 0
  const { error } = await admin
    .from('umsatz_ziele')
    .upsert(fehlend.map((z) => ({ monat: z.monat, sparte: z.sparte, soll_netto: z.sollNetto, geaendert_von: 'Vorgabe (automatisch am Monatsanfang)' })), { onConflict: 'monat,sparte', ignoreDuplicates: true })
  if (error) {
    console.error('umsatz_ziele festschreiben:', error.message)
    return 0
  }
  return fehlend.length
}

async function istSuperuser(admin: Db, email: string): Promise<boolean> {
  const muster = email.replace(/[\\%_]/g, (z) => `\\${z}`)
  const { data } = await admin.from('mitarbeiter').select('ist_superuser, aktiv').ilike('email', muster).maybeSingle()
  return !!(data?.aktiv && data?.ist_superuser)
}

export async function umsatzzielStand(req: Request, admin: Db, body: Record<string, unknown>, jetzt = new Date()): Promise<Ergebnis> {
  const aufrufer = await ermittleAufrufer(req, admin, body)
  if (!aufrufer) return { status: 401, daten: { error: 'Bitte neu anmelden.' } }
  const heute = heuteBerlin(jetzt)
  const aktuell = monatVon(heute)!
  const monat = body.monat === undefined || body.monat === null || body.monat === '' ? aktuell : String(body.monat)
  if (!istMonat(monat)) return { status: 400, daten: { error: 'Monat bitte als JJJJ-MM.' } }
  const bereich = typeof body.bereich === 'string' && /^[a-z_]{2,40}$/.test(body.bereich) ? body.bereich : undefined
  try {
    const d = await ladeZielDaten(admin, heute)
    if (monat === aktuell && (await sollFestschreiben(admin, d, monat)) > 0) {
      for (const z of fehlendeSollZeilen(d.sparten, d.sollZeilen, monat)) d.sollZeilen.push({ ...z, geaendertVon: 'Vorgabe (automatisch am Monatsanfang)' })
      d.eingabe.soll = d.sollZeilen
    }
    const uebersicht = zielUebersicht(d.eingabe, d.trichter, monat, { bereich })
    const darfAendern = aufrufer.istGf || (await istSuperuser(admin, aufrufer.email))
    return {
      status: 200,
      daten: {
        uebersicht,
        meldung: kurzMeldung(uebersicht.stand),
        darfAendern,
        tabellenDa: d.tabellenDa,
        soll: d.sollZeilen.filter((z) => z.monat === monat),
      },
    }
  } catch (err) {
    console.error('umsatzziel_stand:', err)
    return { status: 500, daten: { error: `Umsatzziel ließ sich nicht berechnen: ${err instanceof Error ? err.message : String(err)}` } }
  }
}

// ---------------------------------------------------------------------------------------------
// Abschnitt in der Morgen-Übersicht

export type Abschnitt = { titel: string; zeilen: string[] }

/** Ist der Schalter an? Fehlt die Tabelle oder die Zeile: aus. */
export async function meldungAktiv(admin: Db): Promise<boolean> {
  try {
    const { data, error } = await admin.from('umsatz_ziel_einstellung').select('meldung_aktiv').eq('id', 1).maybeSingle()
    return !error && data?.meldung_aktiv === true
  } catch {
    return false
  }
}

// Einmal je Tag und Datenbank-Zugang rechnen, nicht für jede Person neu.
const CACHE = new WeakMap<object, { tag: string; stand: ZielStand | null }>()

/** Sparten einer Person aus ihren Bereichen (mitarbeiter.bereiche): immobilien → Immobilien, ki → KI, sonst Beratung & Privat. */
export function spartenFuerBereiche(bereiche: string[]): string[] {
  const s = new Set<string>()
  for (const b of bereiche) {
    if (b === 'immobilien' || b === 'immobilienkunden') s.add('immobilien')
    else if (b === 'ki') s.add('ki')
    else if (b === 'fahrschule') s.add('fahrschule')
    else if (b && b !== 'privat') s.add('beratung')
  }
  return [...s]
}

/** Zeilen für eine einzelne Sparte (Abteilungsleiter/Mitarbeiter sehen nur ihr Ziel). */
export function spartenZeilen(z: ZielStand, ids: string[]): { titel: string; zeilen: string[] } | null {
  const monat = z.monatName.split(' ')[0]
  const sp = z.sparten.filter((s) => ids.includes(s.sparte))
  if (sp.length === 0) return null
  const zeilen: string[] = []
  for (const s of sp) {
    if (sp.length > 1) zeilen.push(`${s.name}: ${euro(s.bezahlt)} von ${euro(s.soll)} (${s.prozent} %)`)
    if (s.hinweis) { zeilen.push(s.hinweis); continue }
    if (s.offen > 0) zeilen.push(`Offen in Rechnung: ${euro(s.offen)}`)
    zeilen.push(`Soll bis heute ${euro(s.sollBisHeute)} — ${s.abstand < 0 ? `Rückstand ${euro(-s.abstand)}` : `Vorsprung ${euro(s.abstand)}`}`)
    if (s.erwartet > 0) zeilen.push(`Hochrechnung mit Erwartetem: ${euro(s.hochrechnung)}`)
    if (z.verbleibendeWerktage > 0 && s.noetigProWerktag > 0) zeilen.push(`Nötig: ${euro(s.noetigProWerktag)} je Werktag (${z.verbleibendeWerktage} Werktage übrig)`)
  }
  const titel = sp.length === 1 ? `Umsatzziel ${monat} – ${sp[0].name}: ${euro(sp[0].bezahlt)} von ${euro(sp[0].soll)} (${sp[0].prozent} %)` : `Umsatzziel ${monat} deiner Abteilungen`
  return { titel, zeilen }
}

/** Der Abschnitt „Umsatzziel …“ — Geschäftsführung: alle Sparten; sonst nur die Sparten der eigenen Abteilungen
 *  (optionen.sparten). null, wenn der Schalter aus ist oder etwas fehlt. Wirft nie. */
export async function umsatzZielAbschnitt(admin: Db, jetzt: Date, optionen: { schalterPruefen?: boolean; sparten?: string[] } = {}): Promise<Abschnitt | null> {
  try {
    if (optionen.schalterPruefen !== false && !(await meldungAktiv(admin))) return null
    const heute = heuteBerlin(jetzt)
    let stand: ZielStand | null
    const c = CACHE.get(admin)
    if (c && c.tag === heute) stand = c.stand
    else {
      const d = await ladeZielDaten(admin, heute)
      const monat = monatVon(heute)!
      if ((await sollFestschreiben(admin, d, monat)) > 0) {
        for (const z of fehlendeSollZeilen(d.sparten, d.sollZeilen, monat)) d.sollZeilen.push(z)
        d.eingabe.soll = d.sollZeilen
      }
      stand = berechneZielStand(d.eingabe, monat)
      CACHE.set(admin, { tag: heute, stand })
    }
    if (!stand) return null
    return optionen.sparten ? spartenZeilen(stand, optionen.sparten) : morgenZeilen(stand)
  } catch (err) {
    console.error('Umsatzziel für die Morgen-Übersicht:', err instanceof Error ? err.message : err)
    return null
  }
}
