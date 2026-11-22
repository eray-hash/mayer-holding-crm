// Wöchentlicher „Tipp der Woche“ aus „Neu im CRM“ per Telegram (23.11.2026) — vom Zeitplan jede Minute gerufen
// (Aktion termin_erinnerungen in index.ts), ohne offenes Browserfenster.
//
// Warum: In wenigen Tagen kamen Dutzende Neuerungen dazu, die Kollegen kennen sie nicht. Statt einer langen
// Rundmail bekommt jeder höchstens EINE kurze Nachricht pro Woche mit genau einer Neuerung, die ihn betrifft.
//
// - Dienstags beim ersten Minutentakt ab 10:00 Uhr Berliner Zeit (spätestens bis 11:59; ein verpasster Dienstag
//   wird nicht nachgeholt). Außerhalb des Fensters ohne Datenbankzugriff.
// - Empfänger: aktive Mitarbeiter mit Telegram. Einstellung je Mitarbeiter in neuigkeiten_einstellung
//   (telegram_tipp; keine Zeile = AN). Abschalten auf /neuigkeiten oder beim Assistenten („Tipp der Woche aus“).
// - Welche Neuerung: aktiv, für die Person relevant (Bereiche/Geschäftsführung, _shared/neuigkeitenKern.ts),
//   noch nicht gelesen (neuigkeiten_gelesen) und noch nie als Tipp geschickt (gesendete_tipps). Zuerst, was zu
//   den eigenen Schwerpunkten passt, dann nach Rang, dann die neueste. Gibt es keine, kommt nichts.
// - Höchstens einmal pro Woche: letzte_woche (Datum des Dienstags) wird VOR dem Senden mit einer bedingten
//   Änderung gesetzt, im selben Schreibvorgang kommt die id in gesendete_tipps (bzw. die Zeile wird angelegt).
//   Laufen zwei Takte gleichzeitig, gewinnt nur einer.
// - Nur an Mitarbeiter, nie an Kunden. Über den Mayer-Bot (es geht um das Mayer-CRM, nichts Privates).
// - Wirft nie.

import { berlinZeit } from './tagesmeldung.ts'
import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import { istRelevant, NEUIGKEIT_SPALTEN, neuigkeitAusZeile, sortiereNeuigkeiten, tippText, type Neuigkeit } from '../_shared/neuigkeitenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
export type TippErgebnis = { gelaufen: boolean; gesendet: number; meldungen: string[] }

export const EINSTELLUNG_TABELLE = 'neuigkeiten_einstellung'
export const GELESEN_TABELLE = 'neuigkeiten_gelesen'
export const NEUIGKEITEN_TABELLE = 'neuigkeiten'
const WOCHENTAG = 2 // Dienstag
const AB_STUNDE = 10
const BIS_STUNDE = 12 // ausschließlich
const HOECHSTENS_NEUIGKEITEN = 500

/** Dienstag zwischen 10:00 und 11:59 Uhr Berliner Zeit? */
export function imTippFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag === WOCHENTAG && b.stunde >= AB_STUNDE && b.stunde < BIS_STUNDE
}

type Einstellung = { an: boolean; letzte: string; gesendet: string[]; schwerpunkte: string[] }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

function liste(w: unknown): string[] {
  return Array.isArray(w) ? w.map((x) => text(x)).filter(Boolean) : []
}

/** Wählt den Tipp für eine Person (oder null) und zählt, wie viele relevante Neuigkeiten danach noch ungelesen sind. */
export function waehleTipp(
  neuigkeiten: Neuigkeit[],
  person: { rolle?: string | null; ist_admin?: boolean | null; bereiche?: string[] | null },
  gelesen: Set<string>,
  schonGeschickt: string[],
  schwerpunkte: string[],
): { tipp: Neuigkeit | null; weitere: number } {
  const geschickt = new Set(schonGeschickt)
  const offen = neuigkeiten.filter((n) => n.aktiv && istRelevant(n, person) && !gelesen.has(n.id))
  const kandidaten = sortiereNeuigkeiten(offen.filter((n) => !geschickt.has(n.id)), schwerpunkte)
  const tipp = kandidaten[0] ?? null
  return { tipp, weitere: tipp ? offen.length - 1 : offen.length }
}

/** Vom Minutentakt (Aktion termin_erinnerungen) gerufen. Außerhalb des Fensters ohne Datenbankzugriff. */
export async function pruefeNeuigkeitenTipps(admin: Db, sende: SendeFunktion, jetzt: Date = new Date()): Promise<TippErgebnis> {
  const ergebnis: TippErgebnis = { gelaufen: false, gesendet: 0, meldungen: [] }
  if (!imTippFenster(jetzt)) return ergebnis
  try {
    const dienstag = berlinZeit(jetzt).datum
    const [{ data: leute, error: teamFehler }, { data: einst, error: einstFehler }] = await Promise.all([
      admin.from('mitarbeiter').select('name, email, rolle, ist_admin, aktiv, bereiche, telegram_chat_id').eq('aktiv', true),
      admin.from(EINSTELLUNG_TABELLE).select('email, telegram_tipp, letzte_woche, gesendete_tipps, schwerpunkte'),
    ])
    if (teamFehler) throw new Error(`mitarbeiter: ${teamFehler.message}`)
    // Lieber gar nicht senden als an jemanden, der abgeschaltet hat (oder die Tabelle fehlt noch).
    if (einstFehler) throw new Error(`${EINSTELLUNG_TABELLE}: ${einstFehler.message}`)
    const einstellung = new Map<string, Einstellung>()
    for (const z of (einst ?? []) as Record<string, unknown>[]) {
      einstellung.set(text(z.email).toLowerCase(), {
        an: z.telegram_tipp !== false,
        letzte: text(z.letzte_woche).slice(0, 10),
        gesendet: liste(z.gesendete_tipps),
        schwerpunkte: liste(z.schwerpunkte),
      })
    }
    // deno-lint-ignore no-explicit-any
    const offen = ((leute ?? []) as any[]).filter((m) => {
      const email = text(m.email).toLowerCase()
      if (!email || m.telegram_chat_id === null || m.telegram_chat_id === undefined || m.telegram_chat_id === '') return false
      const e = einstellung.get(email)
      return !e || (e.an && e.letzte < dienstag)
    })
    if (offen.length === 0) return ergebnis
    ergebnis.gelaufen = true

    const { data: zeilen, error: neuFehler } = await admin
      .from(NEUIGKEITEN_TABELLE)
      .select(NEUIGKEIT_SPALTEN)
      .eq('aktiv', true)
      .order('datum', { ascending: false })
      .limit(HOECHSTENS_NEUIGKEITEN)
    if (neuFehler) throw new Error(`${NEUIGKEITEN_TABELLE}: ${neuFehler.message}`)
    const neuigkeiten = ((zeilen ?? []) as Record<string, unknown>[]).map(neuigkeitAusZeile).filter((n) => n.id && n.titel)
    if (neuigkeiten.length === 0) return ergebnis
    const ids = neuigkeiten.map((n) => n.id)

    const { data: wk } = await admin.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const basis = text(wk?.link_basis) || CRM_BASIS_STANDARD

    for (const m of offen) {
      const email = text(m.email).toLowerCase()
      try {
        // Gelesenes je Person, nur unter den geladenen Neuigkeiten (also nie mehr Zeilen als Neuigkeiten).
        const { data: gel, error: gelFehler } = await admin.from(GELESEN_TABELLE).select('schluessel').eq('email', email).in('schluessel', ids)
        if (gelFehler) throw new Error(`${GELESEN_TABELLE}: ${gelFehler.message}`)
        const gelesen = new Set(((gel ?? []) as { schluessel: string }[]).map((g) => text(g.schluessel)))
        const e = einstellung.get(email)
        const { tipp, weitere } = waehleTipp(neuigkeiten, m, gelesen, e?.gesendet ?? [], e?.schwerpunkte ?? [])
        if (!tipp) continue

        // Erst die Woche beanspruchen (mit der id des Tipps), dann senden: so kommt der Tipp nie zweimal.
        if (!(await beanspruche(admin, email, e ?? null, dienstag, tipp.id))) continue
        if (await sende(m.telegram_chat_id, tippText(tipp, basis, weitere)).catch(() => false)) ergebnis.gesendet++
        else ergebnis.meldungen.push(`Tipp der Woche an ${email}: Telegram-Versand fehlgeschlagen.`)
      } catch (err) {
        ergebnis.meldungen.push(`Tipp der Woche an ${email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Tipp der Woche fehlgeschlagen:', err)
    ergebnis.meldungen.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

/** Setzt letzte_woche auf diesen Dienstag und merkt die id — nur, wenn es noch niemand getan hat. true = senden. */
async function beanspruche(admin: Db, email: string, e: Einstellung | null, dienstag: string, id: string): Promise<boolean> {
  if (!e) {
    const { error } = await admin.from(EINSTELLUNG_TABELLE).insert({ email, telegram_tipp: true, letzte_woche: dienstag, gesendete_tipps: [id] })
    if (!error) return true
    if (error.code !== '23505') throw new Error(`${EINSTELLUNG_TABELLE}: ${error.message}`)
    // Gerade von einem anderen Lauf (oder dem Mitarbeiter selbst) angelegt: frisch lesen und bedingt ändern.
    const { data: frisch, error: lesFehler } = await admin.from(EINSTELLUNG_TABELLE).select('gesendete_tipps').eq('email', email).maybeSingle()
    if (lesFehler) throw new Error(`${EINSTELLUNG_TABELLE}: ${lesFehler.message}`)
    return await bedingtSetzen(admin, email, dienstag, [...liste(frisch?.gesendete_tipps), id])
  }
  return await bedingtSetzen(admin, email, dienstag, [...e.gesendet.filter((x) => x !== id), id])
}

async function bedingtSetzen(admin: Db, email: string, dienstag: string, gesendet: string[]): Promise<boolean> {
  const { data, error } = await admin
    .from(EINSTELLUNG_TABELLE)
    .update({ letzte_woche: dienstag, gesendete_tipps: gesendet })
    .eq('email', email)
    .eq('telegram_tipp', true)
    .or(`letzte_woche.is.null,letzte_woche.lt.${dienstag}`)
    .select('email')
  if (error) throw new Error(`${EINSTELLUNG_TABELLE}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}
