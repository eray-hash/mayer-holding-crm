// Assistent-Werkzeug „umsatz_vorschau“ (22.11.2026): Umsatzvorschau und Provisionen für die
// Geschäftsführung — schon in Rechnung gestellt, offene Rechnungen, Angebote nach Chance und
// Immobilien-Provision nach Stand des Objekts, für Monat, Quartal oder Jahr. Gerechnet wird mit
// _shared/umsatzKern.ts, derselben Datei wie die Seite /auswertungen/umsatz im CRM.
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregeln
// nach: Akten und Kostenvoranschläge nur aus freigegebenen Bereichen (darfAkte/darfBereich), private nie;
// Rechnungen nur mit dem Bereich Unternehmensberatung (Zeilenregel rechnungen) und nur, wenn die Akte
// der Rechnung freigegeben ist; Objekte nur mit Immobilien-Rechten, private Objekte nie.
// Im privaten Assistenten gibt es das Werkzeug nicht (keine Zahlen der Holding).

import { berechneUmsatzvorschau, bereichKennung, BEREICH_NAMEN, kurzbericht, OBJEKT_STUFEN, type AkteEingabe, type AngebotEingabe, type ObjektEingabe, type RechnungEingabe, type ZeitraumArt } from '../_shared/umsatzKern.ts'
import { darfAkte, darfBereich, darfObjekte, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type UmsatzKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const UMSATZ_WERKZEUGE = [
  {
    name: 'umsatz_vorschau',
    description:
      'Umsatzvorschau und Provisionen: was im Zeitraum schon in Rechnung gestellt ist, Zahlungseingang, offene und überfällige Rechnungen, erwarteter Umsatz aus Angeboten (Kostenvoranschläge × Chance der Akte) und Immobilien-Provision (Kaufpreis × Provisionssatz × Anteil nach Stand des Objekts) — mit den größten Posten und Lücken. Für Fragen wie „Was kommt diesen Monat rein?“, „Wie sieht das Quartal aus?“, „Welche Provisionen erwarten wir bis Jahresende?“, „Umsatz Immobilien dieses Jahr?“. Alle Beträge netto.',
    input_schema: {
      type: 'object',
      properties: {
        zeitraum: { type: 'string', enum: ['monat', 'quartal', 'jahr'], description: 'monat = laufender Monat (Vorgabe), quartal = laufendes Quartal, jahr = ganzes laufendes Kalenderjahr bis 31.12.' },
        bereich: { type: 'string', description: 'Optional: nur ein Bereich, z. B. "beratung", "immobilien", "erben", "betriebsuebergabe", "betriebsformen", "akademie", "finanzierungen" (Name geht auch, z. B. "Unternehmensberatung").' },
      },
    },
  },
]

export function istUmsatzWerkzeug(name: string): boolean {
  return UMSATZ_WERKZEUGE.some((w) => w.name === name)
}

/** Bereich aus Kennung oder Name („Immobilien“, „unternehmensberatung“, „immobilienkunden“) → Kennung; undefined, wenn unbekannt. */
export function bereichAusEingabe(roh: unknown): string | undefined {
  const t = String(roh ?? '').trim().toLowerCase()
  if (!t) return undefined
  const kennung = bereichKennung(t)
  if (BEREICH_NAMEN[kennung] && kennung !== 'ohne') return kennung
  for (const [id, name] of Object.entries(BEREICH_NAMEN)) {
    if (id === 'ohne') continue
    const n = name.toLowerCase()
    if (n === t || n.startsWith(t) || t.startsWith(n.split(' ')[0])) return id
  }
  if (/immo/.test(t)) return 'immobilien'
  if (/berat/.test(t)) return 'beratung'
  if (/buch|bücher|verlag/.test(t)) return 'buecher'
  return undefined
}

type KundeZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; status: string | null; auftrag_chance: { prozent?: number; bestaetigt?: boolean; umsatzNetto?: number; monat?: string } | null; verantwortlich_email: string | null }

function akteName(a: Pick<KundeZeile, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

function zahl(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Lädt alles, was der Mitarbeiter sehen darf, in die Eingaben des Rechenkerns. */
export async function ladeUmsatzEingabe(supabase: Supa, m: RechteMitarbeiter, heute: string) {
  // Akten (ohne private)
  const { data: kundenRoh, error: kFehler } = await supabase
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, status, auftrag_chance, verantwortlich_email')
    .neq('bereich', 'privat')
  if (kFehler) throw new Error(`Akten ließen sich nicht laden: ${kFehler.message}`)
  // Wie im CRM: die Sammelakten liegen in der Unternehmensberatung und zählen mit deren Recht (Prüfung im Kern).
  const kunden = ((kundenRoh ?? []) as KundeZeile[]).filter((k) => darfAkte(m, k))
  const kundeJeId = new Map(kunden.map((k) => [k.id, k]))
  const akten: AkteEingabe[] = kunden.map((k) => ({
    id: k.id,
    bereich: String(k.bereich ?? ''),
    name: akteName(k),
    status: String(k.status ?? ''),
    chance: k.auftrag_chance && Number.isFinite(Number(k.auftrag_chance.prozent)) ? Number(k.auftrag_chance.prozent) : undefined,
    chanceBestaetigt: k.auftrag_chance?.bestaetigt,
    erwartetNetto: Number(k.auftrag_chance?.umsatzNetto) > 0 ? Number(k.auftrag_chance!.umsatzNetto) : undefined,
    erwartetMonat: typeof k.auftrag_chance?.monat === 'string' ? k.auftrag_chance.monat : undefined,
  }))

  // Kostenvoranschläge: wie die Zeilenregel — mit Bereich nur freigegeben, ohne Bereich für alle, private nie.
  const { data: kvRoh, error: kvFehler } = await supabase
    .from('kostenvoranschlaege')
    .select('id, kunde_id, bereich, privat_besitzer, name, beschreibung, betrag, status, datum, positionen, aufschlag_prozent, ust_satz, erstellt_am')
    .in('status', ['offen', 'angenommen'])
  if (kvFehler) throw new Error(`Kostenvoranschläge ließen sich nicht laden: ${kvFehler.message}`)
  // deno-lint-ignore no-explicit-any
  const angebote: AngebotEingabe[] = ((kvRoh ?? []) as any[])
    .filter((kv) => !kv.privat_besitzer && kv.bereich !== 'privat' && (!kv.bereich || darfBereich(m, kv.bereich)))
    .map((kv) => ({
      id: kv.id,
      kundeId: kv.kunde_id ?? undefined,
      bereich: kv.bereich ?? undefined,
      name: kv.name ?? '',
      beschreibung: kv.beschreibung ?? '',
      status: kv.status,
      datum: kv.datum ?? undefined,
      erstelltAm: kv.erstellt_am ?? undefined,
      betrag: kv.betrag === null || kv.betrag === undefined ? null : zahl(kv.betrag),
      positionen: Array.isArray(kv.positionen) && kv.positionen.length ? kv.positionen : null,
      aufschlagProzent: kv.aufschlag_prozent === null || kv.aufschlag_prozent === undefined ? null : zahl(kv.aufschlag_prozent),
      ustSatz: kv.ust_satz === null || kv.ust_satz === undefined ? null : zahl(kv.ust_satz),
    }))

  // Rechnungen: Zeilenregel darf_bereich('beratung'), dazu die Akte der Rechnung.
  const rechnungen: RechnungEingabe[] = []
  if (darfBereich(m, 'beratung')) {
    const { data: rRoh, error: rFehler } = await supabase
      .from('rechnungen')
      .select('id, nummer, kunde_id, datum, betrag_netto, betrag_brutto, status, zahlungsziel, mahnstufe, zahlungen, mahnungen, bezahlt_am, kv_id')
    if (rFehler) throw new Error(`Rechnungen ließen sich nicht laden: ${rFehler.message}`)
    // Akten der Rechnungen, die oben fehlen (z. B. private), nachschlagen, um sie sicher auszuschließen.
    // deno-lint-ignore no-explicit-any
    const zeilen = (rRoh ?? []) as any[]
    const fehlend = [...new Set(zeilen.map((r) => r.kunde_id).filter((id: string) => id && !kundeJeId.has(id)))]
    const fremd = new Map<string, KundeZeile>()
    if (fehlend.length) {
      const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, status, auftrag_chance, verantwortlich_email').in('id', fehlend)
      for (const k of (data ?? []) as KundeZeile[]) fremd.set(k.id, k)
    }
    for (const r of zeilen) {
      const k = kundeJeId.get(r.kunde_id) ?? fremd.get(r.kunde_id)
      if (k && !darfAkte(m, k)) continue
      if (k && String(k.bereich) === 'privat') continue
      const letzteFrist = [...(Array.isArray(r.mahnungen) ? r.mahnungen : [])].reverse().find((x: { neueFrist?: string }) => x?.neueFrist)?.neueFrist
      rechnungen.push({
        id: r.id,
        nummer: r.nummer,
        kundeId: r.kunde_id ?? undefined,
        bereich: k ? String(k.bereich ?? '') : undefined,
        akteName: k ? akteName(k) : undefined,
        datum: String(r.datum ?? ''),
        netto: zahl(r.betrag_netto),
        brutto: zahl(r.betrag_brutto),
        status: r.status,
        zahlungsziel: r.zahlungsziel ?? undefined,
        mahnstufe: r.mahnstufe ?? null,
        neueFrist: letzteFrist,
        zahlungen: (Array.isArray(r.zahlungen) ? r.zahlungen : []).map((z: { datum: string; betrag: unknown }) => ({ datum: String(z?.datum ?? ''), betrag: zahl(z?.betrag) })),
        bezahltAm: r.bezahlt_am ?? undefined,
        kvId: r.kv_id ?? undefined,
      })
    }
  }

  // Objekte: nur die in einem zählenden Stand, ohne private.
  const objekte: ObjektEingabe[] = []
  if (darfObjekte(m)) {
    const { data: oRoh, error: oFehler } = await supabase
      .from('objekte')
      .select('id, bezeichnung, adresse, kaufpreis, status, verkaufsdaten, kurzpruefung, privat_besitzer')
      .in('status', Object.keys(OBJEKT_STUFEN))
    if (oFehler) throw new Error(`Objekte ließen sich nicht laden: ${oFehler.message}`)
    // deno-lint-ignore no-explicit-any
    const liste = ((oRoh ?? []) as any[]).filter((o) => !o.privat_besitzer)
    const ids = liste.map((o) => o.id)
    const abrechnung = new Map<string, number>()
    // deno-lint-ignore no-explicit-any
    const freigaben = new Map<string, any[]>()
    if (ids.length) {
      const { data: abr } = await supabase.from('abteilung_eintraege').select('daten').eq('art', 'abrechnung')
      for (const z of (abr ?? []) as { daten: { objektId?: string; provision?: number } | null }[]) {
        if (z.daten?.objektId && Number(z.daten.provision) > 0) abrechnung.set(z.daten.objektId, Number(z.daten.provision))
      }
      const { data: fr } = await supabase.from('objekt_freigaben').select('objekt_id, provision, status, erstellt_am').in('objekt_id', ids)
      for (const f of (fr ?? []) as { objekt_id: string; provision: string; status: string; erstellt_am: string }[]) {
        freigaben.set(f.objekt_id, [...(freigaben.get(f.objekt_id) ?? []), { provision: f.provision, status: f.status, erstelltAm: f.erstellt_am }])
      }
    }
    for (const o of liste) {
      const b = String(o.bezeichnung ?? '').trim()
      const a = String(o.adresse ?? '').trim()
      const kz = o.verkaufsdaten?.kennzahlen ?? {}
      objekte.push({
        id: o.id,
        name: b && a && !b.includes(a) ? `${b}, ${a}` : b || a || 'Objekt ohne Bezeichnung',
        status: o.status,
        kaufpreis: zahl(o.kaufpreis),
        zielpreis: zahl(kz.zielverkaufspreis) || zahl(kz.kaufpreisvorstellung) || null,
        abrechnungProvision: abrechnung.get(o.id) ?? null,
        kurzpruefungProzent: o.kurzpruefung?.provisionProzent ?? undefined,
        kurzpruefungBetrag: o.kurzpruefung?.provisionBetrag ?? undefined,
        freigaben: freigaben.get(o.id) ?? [],
      })
    }
  }

  return { heute, rechnungen, angebote, akten, objekte }
}

export async function fuehreUmsatzWerkzeugAus(name: string, input: Record<string, unknown>, ctx: UmsatzKontext): Promise<string> {
  if (name !== 'umsatz_vorschau') return `Fehler: unbekanntes Werkzeug ${name}.`
  const m = ctx.mitarbeiter
  if (m.nurPrivat === true) return 'Die Umsatzvorschau der Holding gibt es im privaten Assistenten nicht.'
  const art: ZeitraumArt = ['monat', 'quartal', 'jahr'].includes(String(input.zeitraum)) ? (String(input.zeitraum) as ZeitraumArt) : 'monat'
  let bereich: string | undefined
  if (input.bereich !== undefined && input.bereich !== null && String(input.bereich).trim()) {
    bereich = bereichAusEingabe(input.bereich)
    if (!bereich) return `Fehler: Bereich „${String(input.bereich)}“ kenne ich nicht. Möglich: ${Object.entries(BEREICH_NAMEN).filter(([id]) => id !== 'ohne').map(([id, n]) => `${id} (${n})`).join(', ')}.`
    if (!darfBereich(m, bereich)) return nichtFreigegeben(bereich, m.name)
  }
  try {
    const eingabe = await ladeUmsatzEingabe(ctx.supabase, m, ctx.heute)
    const vorschau = berechneUmsatzvorschau(eingabe, { darf: (b) => darfBereich(m, b) })
    ctx.protokolliere(`Umsatzvorschau ${art}${bereich ? ` (${bereich})` : ''} abgefragt`)
    return kurzbericht(vorschau, art, bereich)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}
