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
import { monatVon } from '../_shared/umsatzKern.ts'

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

// Einmal je Tag und Datenbank-Zugang rechnen, nicht für jede Person der Geschäftsführung neu.
const CACHE = new WeakMap<object, { tag: string; abschnitt: Abschnitt | null }>()

/** Der Abschnitt „Umsatzziel …“ für die Geschäftsführung — null, wenn der Schalter aus ist oder etwas fehlt. Wirft nie. */
export async function umsatzZielAbschnitt(admin: Db, jetzt: Date, optionen: { schalterPruefen?: boolean } = {}): Promise<Abschnitt | null> {
  try {
    if (optionen.schalterPruefen !== false && !(await meldungAktiv(admin))) return null
    const heute = heuteBerlin(jetzt)
    const c = CACHE.get(admin)
    if (c && c.tag === heute) return c.abschnitt
    const d = await ladeZielDaten(admin, heute)
    const monat = monatVon(heute)!
    if ((await sollFestschreiben(admin, d, monat)) > 0) {
      for (const z of fehlendeSollZeilen(d.sparten, d.sollZeilen, monat)) d.sollZeilen.push(z)
      d.eingabe.soll = d.sollZeilen
    }
    const abschnitt = morgenZeilen(berechneZielStand(d.eingabe, monat))
    CACHE.set(admin, { tag: heute, abschnitt })
    return abschnitt
  } catch (err) {
    console.error('Umsatzziel für die Morgen-Übersicht:', err instanceof Error ? err.message : err)
    return null
  }
}
