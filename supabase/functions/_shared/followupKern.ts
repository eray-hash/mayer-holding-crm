// Nächste Follow-up-Schritte einer Akte (24.11.2026) — aus den ECHTEN Regeln und Daten berechnet, nichts geraten:
//  - Rechnungen der Akte (Tabelle rechnungen): Entwurf → „versenden“; versendet/offen → Zahlungsziel.
//  - Wiedervorlage-Regeln (Tabelle wiedervorlage_regeln, Auslöser „ereignis:rechnung“): legt die Datenbank beim Versand
//    selbst an (Trigger wv_rechnung → wv_anlegen, fällig = Zahlungsziel + tage, je Akte und Regel nur eine offene).
//    Für eine Rechnung, die gerade erst erstellt ist, wird sie hier vorausgesagt („legt das CRM beim Versand an“).
//  - Mahnvorschläge (_shared/mahnVorschlagKern.ts, Einstellung mahn_einstellung, Vorgabe 3/14/28 Tage nach dem
//    Zahlungsziel; die nächste Stufe frühestens am Tag nach der neuen Frist des vorigen Schreibens — Fristen wie
//    mahnVorlage im CRM: Erinnerung 7, 1. Mahnung 10 Tage). Der Server schlägt nur vor (Telegram); gesendet wird nach dem
//    Ja des Mitarbeiters — im CRM oder in Telegram mit mahnung_erstellen (telegram-gateway/mahnungWerkzeuge.ts).
//  - Offene Wiedervorlagen der Akte (Tabelle wiedervorlagen), das alte einzelne Follow-up (kunden.follow_up) und
//    fehlende angeforderte Unterlagen (kunden.unterlagen_anforderungen) — wie die Projekt-Checkliste im CRM.
// Reine Rechnung in berechneFolgeSchritte (Tests: followupKern.test.ts), Laden in ladeFolgeDaten.

import { aktuelleFrist, einstellungAus, type MahnEinstellung, type MahnStufe, MAHN_STUFEN, naechsteStufe, offenerBetrag, plusTage, pruefeRechnung, STUFE_NAME } from './mahnVorschlagKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type FolgeRechnung = {
  id: string
  nummer: string
  status: string
  datum?: string | null
  zahlungsziel: string | null
  mahnstufe: string | null
  betrag_brutto: number | string
  zahlungen: { datum?: string | null; betrag?: number | string | null }[] | null
  mahnungen: { datum?: string | null; stufe?: string | null; neueFrist?: string | null }[] | null
}
export type FolgeWv = { titel: string; faellig: string; regel?: string | null; quelle?: string | null }
export type FolgeRegel = { id: string; titel: string; tage: number; aktiv: boolean; bereich: string | null }
export type FolgeMahnVorschlag = { rechnung_id: string; stufe: string; status: string; zurueckgestellt_bis: string | null }

export type FolgeDaten = {
  heute: string
  rechnungen: FolgeRechnung[]
  /** Aktive Regeln mit Auslöser „ereignis:rechnung“ für den Bereich der Akte. */
  rechnungsRegeln: FolgeRegel[]
  wiedervorlagen: FolgeWv[]
  followUp?: { date?: string | null; note?: string | null; done?: boolean | null } | null
  mahn: MahnEinstellung
  mahnVorschlaege: FolgeMahnVorschlag[]
  unterlagen?: { angefordert: number; da: number } | null
}

export type FolgeSchritt = { datum: string; text: string }

/** Neue Frist, die das jeweilige Schreiben setzt (mahnVorlage im CRM: Erinnerung 7 Tage, Mahnungen 10 Tage). */
const FRIST_TAGE: Record<MahnStufe, number> = { erinnerung: 7, mahnung1: 10, mahnung2: 10 }

const istDatum = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
const max = (a: string, b: string) => (a > b ? a : b)
const euro = (n: number) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`

/**
 * Schritte mit Datum. `versandHeute` = Kennung einer Rechnung im Entwurf, für die so gerechnet wird, als ginge sie heute
 * raus (Vorschau direkt nach dem Erstellen).
 */
export function berechneFolgeSchritte(d: FolgeDaten, o: { versandHeute?: string } = {}): { schritte: FolgeSchritt[]; hinweise: string[] } {
  const schritte: FolgeSchritt[] = []
  const hinweise: string[] = []
  const offeneRegeln = new Set(d.wiedervorlagen.map((w) => w.regel).filter(Boolean) as string[])
  let mahnHinweis = false

  for (const r of [...d.rechnungen].sort((a, b) => String(a.zahlungsziel).localeCompare(String(b.zahlungsziel)))) {
    const geplant = r.status === 'Entwurf' && r.id === o.versandHeute
    if (r.status === 'Entwurf' && !geplant) {
      schritte.push({ datum: d.heute, text: `Rechnung ${r.nummer} versenden (noch Entwurf, der Kunde hat sie nicht)` })
      continue
    }
    if (r.status !== 'Versendet' && r.status !== 'Überfällig' && !geplant) continue
    const alsVersendet = { ...r, kunde_id: null, status: geplant ? 'Versendet' : r.status }
    const offen = offenerBetrag(alsVersendet)
    if (offen < 0.01 || !istDatum(r.zahlungsziel)) continue
    const ziel = r.zahlungsziel.slice(0, 10)
    if (geplant) schritte.push({ datum: d.heute, text: `Rechnung ${r.nummer} an den Kunden senden` })

    const frist = aktuelleFrist(alsVersendet)
    schritte.push({ datum: istDatum(frist) ? frist.slice(0, 10) : ziel, text: `Zahlungsziel Rechnung ${r.nummer}: ${euro(offen)} offen` })
    if (geplant) {
      for (const regel of d.rechnungsRegeln) {
        if (offeneRegeln.has(regel.id)) {
          hinweise.push(`Die Wiedervorlage „${regel.titel}“ ist in dieser Akte schon offen; beim Versand kommt keine zweite dazu.`)
          continue
        }
        schritte.push({ datum: plusTage(ziel, regel.tage), text: `Wiedervorlage „${regel.titel}“ (legt das CRM beim Versand an)` })
      }
    }

    if (!d.mahn.aktiv) {
      mahnHinweis = true
      continue
    }
    const naechste = naechsteStufe(r.mahnstufe)
    if (!naechste) {
      if (r.mahnstufe === 'mahnung2') schritte.push({ datum: max(d.heute, plusTage(istDatum(frist) ? frist : ziel, 1)), text: `Rechnung ${r.nummer}: nach der 2. Mahnung über Inkasso entscheiden (kein automatischer Vorschlag mehr)` })
      continue
    }
    const p = pruefeRechnung(alsVersendet, d.heute, d.mahn)
    const vorschlag = d.mahnVorschlaege.find((v) => v.rechnung_id === r.id && v.stufe === naechste)
    let datum: string
    let text: string
    if (vorschlag?.status === 'zurueckgestellt' && istDatum(vorschlag.zurueckgestellt_bis)) {
      datum = vorschlag.zurueckgestellt_bis.slice(0, 10)
      text = `${STUFE_NAME[naechste]} zu ${r.nummer} (zurückgestellt bis dahin)`
    } else if (vorschlag?.status === 'offen') {
      datum = d.heute
      text = `${STUFE_NAME[naechste]} zu ${r.nummer} liegt als Vorschlag bereit (hier mit „${STUFE_NAME[naechste]} ${r.nummer} senden“ oder im CRM unter Mahnwesen)`
    } else if (p.ergebnis === 'warten') {
      datum = p.ab
      text = `${STUFE_NAME[naechste]} zu ${r.nummer} wird vorgeschlagen, falls bis dahin nicht bezahlt`
    } else if (p.ergebnis === 'faellig') {
      datum = d.heute
      text = `${STUFE_NAME[naechste]} zu ${r.nummer} ist fällig (Vorschlag kommt mit dem nächsten Tageslauf)`
    } else if (p.ergebnis === 'uebersprungen') {
      datum = d.heute
      text = `${STUFE_NAME[naechste]} zu ${r.nummer} zurückgehalten: ${p.grund}`
    } else continue
    schritte.push({ datum, text })
    // Spätere Stufen: frühestens Zahlungsziel + eingestellte Tage und nach der Frist des vorigen Schreibens.
    let vorher = datum
    let vorherStufe: MahnStufe = naechste
    for (const s of MAHN_STUFEN.slice(MAHN_STUFEN.indexOf(naechste) + 1)) {
      const ab = max(plusTage(ziel, d.mahn.tage[s]), plusTage(vorher, FRIST_TAGE[vorherStufe] + 1))
      schritte.push({ datum: ab, text: `${STUFE_NAME[s]} zu ${r.nummer} frühestens, falls weiter offen` })
      vorher = ab
      vorherStufe = s
    }
  }
  if (mahnHinweis) hinweise.push('Mahnvorschläge sind im CRM ausgeschaltet (Automatische Nachrichten).')

  for (const w of d.wiedervorlagen) {
    if (!istDatum(w.faellig)) continue
    schritte.push({ datum: w.faellig.slice(0, 10), text: `Wiedervorlage: ${w.titel}${w.quelle === 'regel' ? ' (automatisch)' : ''}` })
  }
  const fu = d.followUp
  if (fu && !fu.done && istDatum(fu.date)) schritte.push({ datum: fu.date.slice(0, 10), text: `Follow-up: ${String(fu.note ?? '').trim() || 'nachfassen'}` })
  if (d.unterlagen && d.unterlagen.angefordert > d.unterlagen.da) {
    hinweise.push(`${d.unterlagen.angefordert - d.unterlagen.da} von ${d.unterlagen.angefordert} angeforderten Unterlagen fehlen noch.`)
  }
  schritte.sort((a, b) => a.datum.localeCompare(b.datum))
  return { schritte, hinweise }
}

/** Kurzes Datum „08.12.“ (mit Jahr, wenn es nicht das laufende ist). */
export function kurzDatum(iso: string, heute: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-')
  return j === heute.slice(0, 4) ? `${t}.${m}.` : `${t}.${m}.${j}`
}

/** Text für Telegram: eine Zeile je Datum (gleiche Tage zusammengefasst), Überfälliges markiert, höchstens `grenze` Zeilen. */
export function folgeText(e: { schritte: FolgeSchritt[]; hinweise: string[] }, heute: string, grenze = 12): string {
  if (e.schritte.length === 0 && e.hinweise.length === 0) return 'Keine offenen Follow-up-Schritte in dieser Akte.'
  const jeTag = new Map<string, string[]>()
  for (const s of e.schritte) jeTag.set(s.datum, [...(jeTag.get(s.datum) ?? []), s.text])
  const zeilen = [...jeTag.entries()].map(([datum, texte]) => `- ${kurzDatum(datum, heute)}${datum < heute ? ' (überfällig)' : datum === heute ? ' (heute)' : ''} ${texte.join('; ')}`)
  const gekuerzt = zeilen.length > grenze ? [...zeilen.slice(0, grenze), `- … und ${zeilen.length - grenze} weitere`] : zeilen
  return [...gekuerzt, ...e.hinweise.map((h) => `Hinweis: ${h}`)].join('\n')
}

/** Unterlagen-Stand wie unterlagenVon in src/lib/checkliste.ts. */
export function unterlagenStand(anforderungen: unknown): { angefordert: number; da: number } | null {
  const alle = Array.isArray(anforderungen) ? anforderungen : []
  // deno-lint-ignore no-explicit-any
  const liste = alle.filter((a: any) => a?.art === 'anforderung')
  if (liste.length === 0) return null
  const angefordert = new Set<string>()
  const da = new Set<string>()
  // deno-lint-ignore no-explicit-any
  for (const a of liste as any[]) {
    for (const p of a.punkte ?? []) angefordert.add(String(p))
    if (String(a.weitere ?? '').trim()) angefordert.add(String(a.weitere).trim())
  }
  // deno-lint-ignore no-explicit-any
  for (const a of alle as any[]) for (const e of a?.eingang ?? []) da.add(String(e?.punkt))
  return { angefordert: angefordert.size, da: [...angefordert].filter((p) => da.has(p)).length }
}

/** Lädt alles für eine Akte. `mitRechnungen` = false, wenn der Mitarbeiter Rechnungen nicht sehen darf. */
export async function ladeFolgeDaten(db: Db, kunde: { id: string; bereich: string | null; follow_up?: unknown; unterlagen_anforderungen?: unknown }, heute: string, mitRechnungen: boolean): Promise<FolgeDaten> {
  const leer = { data: [] }
  const [rech, wv, regeln, einst] = await Promise.all([
    mitRechnungen
      ? db.from('rechnungen').select('id, nummer, status, datum, zahlungsziel, mahnstufe, betrag_brutto, zahlungen, mahnungen').eq('kunde_id', kunde.id).in('status', ['Entwurf', 'Versendet', 'Überfällig'])
      : leer,
    db.from('wiedervorlagen').select('titel, faellig, regel, quelle').eq('kunde_id', kunde.id).is('erledigt_am', null),
    mitRechnungen ? db.from('wiedervorlage_regeln').select('id, titel, tage, aktiv, bereich').eq('ausloeser', 'ereignis:rechnung').eq('aktiv', true) : leer,
    mitRechnungen ? db.from('mahn_einstellung').select('*').limit(1).maybeSingle() : { data: null },
  ])
  const rechnungen = (rech.data ?? []) as FolgeRechnung[]
  const vorschlaege = mitRechnungen && rechnungen.length
    ? ((await db.from('mahn_vorschlaege').select('rechnung_id, stufe, status, zurueckgestellt_bis').in('rechnung_id', rechnungen.map((r) => r.id)).in('status', ['offen', 'zurueckgestellt'])).data ?? [])
    : []
  return {
    heute,
    rechnungen,
    rechnungsRegeln: ((regeln.data ?? []) as FolgeRegel[]).filter((r) => r.aktiv && (!r.bereich || r.bereich === kunde.bereich)),
    // deno-lint-ignore no-explicit-any
    wiedervorlagen: ((wv.data ?? []) as any[]).map((w) => ({ titel: String(w.titel ?? ''), faellig: String(w.faellig ?? '').slice(0, 10), regel: w.regel ?? null, quelle: w.quelle ?? null })),
    // deno-lint-ignore no-explicit-any
    followUp: (kunde.follow_up ?? null) as any,
    mahn: einstellungAus(einst.data ?? null),
    mahnVorschlaege: vorschlaege as FolgeMahnVorschlag[],
    unterlagen: unterlagenStand(kunde.unterlagen_anforderungen),
  }
}
