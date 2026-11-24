// Assistent-Werkzeug „umsatzziel_stand“ (24.11.2026, Wunsch der Geschäftsführung): Wo stehen wir beim
// Monatsziel (50.000 € netto: KI, Immobilien, Beratung & Privat)? Soll, Ist (bezahlt), offene Rechnungen,
// Erwartetes, Soll bis heute mit Rückstand/Vorsprung — und der Trichter je Sparte (wie viele Leads braucht es?).
// Gerechnet wird mit _shared/umsatzZielKern.ts, wie die Seite /ziele und die Morgen-Übersicht.
//
// Hier steht auch das Laden aller Daten (ladeZielDaten) — email-gateway/umsatzZiel.ts benutzt es mit.
// Die Zahlen sind Summen ohne Namen und für alle Mitarbeiter gleich (Ziel des ganzen Teams; die Karte „Unser Ziel“
// zeigt sie in jeder Abteilung). Private Akten, Kostenvoranschläge und Objekte zählen nie. Im privaten Assistenten
// gibt es das Werkzeug nicht.

import { ladeUmsatzEingabe } from './umsatzWerkzeuge.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { monatVon, plusMonate } from '../_shared/umsatzKern.ts'
import {
  aktenBereich, AKTEN_BEREICH_NAME, BASIS_MONATE, istMonat, sollAusZeilen, spartenAusZeilen, zielBericht, zielUebersicht,
  type SollZeile, type SparteRegel, type TrichterDaten, type ZielEingabe, type ZielUebersicht,
} from '../_shared/umsatzZielKern.ts'
import type { RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type UmsatzZielKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const UMSATZZIEL_WERKZEUGE = [
  {
    name: 'umsatzziel_stand',
    description:
      'Stand beim monatlichen Umsatzziel (Soll je Sparte KI, Immobilien, Beratung & Privat; zusammen in der Regel 50.000 € netto): Ist (bezahlt), offene Rechnungen des Monats, Erwartetes (Angebote × Chance, Provision nach Stand), Hochrechnung, Soll bis heute mit Rückstand oder Vorsprung, nötiger Umsatz je Werktag — dazu der Trichter (Leads → Erstgespräche → Angebote → Aufträge bzw. Interessenten → Besichtigungen → Reservierung/Notar → Abschlüsse, Verlustquote, Ø Auftragswert) und wie viele Leads es für das Soll braucht. Für „Wo stehen wir beim Umsatzziel?“, „Wie viele Leads brauchen wir?“, „Schaffen wir die 50.000 diesen Monat?“. Alle Beträge netto.',
    input_schema: {
      type: 'object',
      properties: {
        monat: { type: 'string', description: 'Optional: Monat als JJJJ-MM (Vorgabe: laufender Monat).' },
        sparte: { type: 'string', description: 'Optional: nur eine Sparte — "ki", "immobilien" oder "beratung" (Beratung & Privat); ein Bereich wie "erben" oder "akademie" geht auch (dann mit dessen Trichter).' },
      },
    },
  },
]

export function istUmsatzZielWerkzeug(name: string): boolean {
  return UMSATZZIEL_WERKZEUGE.some((w) => w.name === name)
}

/** Volle Rechte für die Summen (keine Namen in der Antwort) — private Einträge schließt der Lader selbst aus. */
const ALLE: RechteMitarbeiter = { name: 'Umsatzziel', rolle: 'geschaeftsfuehrung' }

export type ZielDaten = { eingabe: ZielEingabe; trichter: TrichterDaten; sollZeilen: SollZeile[]; sparten: SparteRegel[]; tabellenDa: boolean }

function zahl(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function positionsText(p: unknown): string {
  if (!Array.isArray(p)) return ''
  return p.map((x) => (x && typeof x === 'object' ? [(x as Record<string, unknown>).bezeichnung, (x as Record<string, unknown>).beschreibung, (x as Record<string, unknown>).name].filter((t) => typeof t === 'string').join(' ') : '')).join(' ')
}

// deno-lint-ignore no-explicit-any
async function alle(supabase: Supa, tabelle: string, spalten: string, filter?: (q: any) => any): Promise<any[]> {
  const { data, error } = await alleZeilen(() => {
    const q = supabase.from(tabelle).select(spalten)
    return filter ? filter(q) : q
  })
  if (error) throw new Error(`${tabelle} ließ sich nicht laden: ${error.message}`)
  return data
}

/** Lädt Sparten, Soll, Umsatz-Eingaben und Trichter-Daten (alles außer Privatem). */
export async function ladeZielDaten(supabase: Supa, heute: string): Promise<ZielDaten> {
  // Sparten und Soll — fehlen die Tabellen noch (SQL nicht eingespielt), gelten die Vorgaben.
  const [spRoh, sollRoh] = await Promise.all([
    supabase.from('umsatz_sparten').select('*'),
    supabase.from('umsatz_ziele').select('monat, sparte, soll_netto, geaendert_von, geaendert_am'),
  ])
  const tabellenDa = !spRoh.error && !sollRoh.error
  const sparten = spartenAusZeilen(spRoh.error ? null : spRoh.data)
  const sollZeilen = sollRoh.error ? [] : sollAusZeilen(sollRoh.data)

  const ab = `${plusMonate(monatVon(heute)!, -(BASIS_MONATE + 1))}-01`
  const [umsatz, aktenRoh, termine, besichtigungen, kvs, rechnungen, objekte, investoren] = await Promise.all([
    ladeUmsatzEingabe(supabase, ALLE, heute),
    // kunden.verloren (Seite „Entgangene Klienten“) gibt es erst nach deren SQL — sonst ohne die Spalte.
    alle(supabase, 'kunden', 'id, bereich, status, activities, verloren', (q) => q.neq('bereich', 'privat')).catch(() => alle(supabase, 'kunden', 'id, bereich, status, activities', (q) => q.neq('bereich', 'privat'))),
    alle(supabase, 'termine', 'id, kunde_id, beginn', (q) => q.not('kunde_id', 'is', null).gte('beginn', ab)),
    alle(supabase, 'besichtigungen', 'id, kunde_id, kunde_bereich, beginn, status', (q) => q.gte('beginn', ab)),
    alle(supabase, 'kostenvoranschlaege', 'id, kunde_id, bereich, privat_besitzer, name, beschreibung, positionen, status, datum, erstellt_am'),
    alle(supabase, 'rechnungen', 'id, nummer, kunde_id, datum, status, betrag_netto, leistung_bezeichnung, positionen'),
    alle(supabase, 'objekte', 'id, privat_besitzer, activities'),
    alle(supabase, 'fonds_investoren', 'id, seit').catch(() => []),
  ])

  // Suchtexte für die Stichwort-Erkennung (nur gebraucht, wenn eine Sparte sie eingeschaltet hat).
  const texte: Record<string, string> = {}
  if (sparten.some((s) => s.stichwortAktiv)) {
    for (const r of rechnungen) texte[r.id] = [r.nummer, r.leistung_bezeichnung, positionsText(r.positionen)].filter(Boolean).join(' ')
    for (const kv of kvs) texte[kv.id] = [kv.name, kv.beschreibung, positionsText(kv.positionen)].filter(Boolean).join(' ')
  }

  // deno-lint-ignore no-explicit-any
  const akten = (aktenRoh as any[]).map((k) => ({
    id: String(k.id),
    bereich: String(k.bereich ?? ''),
    status: k.status ?? null,
    activities: Array.isArray(k.activities) ? k.activities : [],
    verlorenAm: k.verloren && typeof k.verloren === 'object' && typeof k.verloren.am === 'string' ? k.verloren.am : null,
  }))
  const trichter: TrichterDaten = {
    akten,
    termine: termine.map((t) => ({ kundeId: String(t.kunde_id), beginn: String(t.beginn ?? '') })),
    besichtigungen: besichtigungen.map((b) => ({ kundeId: b.kunde_id ?? null, kundeBereich: b.kunde_bereich ?? null, beginn: String(b.beginn ?? ''), status: b.status ?? null })),
    angebote: kvs.map((kv) => ({ id: kv.id, kundeId: kv.kunde_id ?? null, bereich: kv.bereich ?? null, status: String(kv.status ?? ''), datum: kv.datum ?? null, erstelltAm: kv.erstellt_am ?? null, privat: !!kv.privat_besitzer || kv.bereich === 'privat' })),
    rechnungen: rechnungen.map((r) => ({ id: r.id, kundeId: r.kunde_id ?? null, datum: String(r.datum ?? ''), status: String(r.status ?? ''), netto: zahl(r.betrag_netto) })),
    objekte: objekte.map((o) => ({ id: o.id, privat: !!o.privat_besitzer, activities: Array.isArray(o.activities) ? o.activities : [] })),
    investoren: investoren.map((i) => ({ id: String(i.id), seit: typeof i.seit === 'string' ? i.seit : null })),
  }
  const vorhandeneBereiche = [...new Set(akten.map((a) => a.bereich).filter(Boolean))]
  return { eingabe: { heute, umsatz, texte, sparten, soll: sollZeilen, vorhandeneBereiche }, trichter, sollZeilen, sparten, tabellenDa }
}

/** Sparte oder Bereich aus der Eingabe des Modells. */
export function zielAuswahl(roh: unknown, sparten: SparteRegel[]): { sparte?: string; bereich?: string } | null {
  const t = String(roh ?? '').trim().toLowerCase()
  if (!t) return {}
  const sp = sparten.find((s) => s.id === t || s.name.toLowerCase() === t || s.name.toLowerCase().startsWith(t))
  if (sp) return { sparte: sp.id }
  if (/^ki$|künstlich|kuenstlich/.test(t)) return sparten.some((s) => s.id === 'ki') ? { sparte: 'ki' } : null
  if (/immo/.test(t)) return { sparte: sparten.find((s) => s.objektProvision)?.id ?? 'immobilien' }
  if (/privat|rest/.test(t)) return { sparte: sparten.find((s) => s.rest)?.id }
  const b = aktenBereich(t)
  if (AKTEN_BEREICH_NAME[b]) return { bereich: b }
  for (const [id, name] of Object.entries(AKTEN_BEREICH_NAME)) if (name.toLowerCase().startsWith(t) || t.startsWith(name.toLowerCase().split(' ')[0])) return { bereich: id }
  if (/berat/.test(t)) return { bereich: 'beratung' }
  return null
}

export function berichtAus(u: ZielUebersicht, auswahl: { sparte?: string; bereich?: string }): string {
  if (auswahl.bereich && u.bereich) {
    return zielBericht(u.stand, [u.bereich.trichter], u.bereich.sparte)
  }
  const trichter = u.trichter.filter((t) => !auswahl.sparte || t.sparte === auswahl.sparte).map((t) => t.trichter)
  return zielBericht(u.stand, trichter, auswahl.sparte)
}

export async function fuehreUmsatzZielWerkzeugAus(name: string, input: Record<string, unknown>, ctx: UmsatzZielKontext): Promise<string> {
  if (name !== 'umsatzziel_stand') return `Fehler: unbekanntes Werkzeug ${name}.`
  if (ctx.mitarbeiter.nurPrivat === true) return 'Das Umsatzziel der Holding gibt es im privaten Assistenten nicht.'
  const monat = input.monat === undefined || input.monat === null || String(input.monat).trim() === '' ? monatVon(ctx.heute)! : String(input.monat).trim()
  if (!istMonat(monat)) return `Fehler: Monat „${monat}“ bitte als JJJJ-MM angeben, z. B. ${monatVon(ctx.heute)}.`
  try {
    const d = await ladeZielDaten(ctx.supabase, ctx.heute)
    const auswahl = zielAuswahl(input.sparte, d.sparten)
    if (!auswahl) return `Fehler: Sparte „${String(input.sparte)}“ kenne ich nicht. Möglich: ${d.sparten.map((s) => `${s.id} (${s.name})`).join(', ')} oder ein Bereich wie erben, akademie.`
    const u = zielUebersicht(d.eingabe, d.trichter, monat, { bereich: auswahl.bereich })
    ctx.protokolliere(`Umsatzziel ${monat}${auswahl.sparte ? ` (${auswahl.sparte})` : auswahl.bereich ? ` (${auswahl.bereich})` : ''} abgefragt`)
    return berichtAus(u, auswahl) + (d.tabellenDa ? '' : '\n(Hinweis: Die Soll-Tabelle ist noch nicht eingerichtet — es gelten die Vorgaben 10.000 / 15.000 / 25.000 €.)')
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}
