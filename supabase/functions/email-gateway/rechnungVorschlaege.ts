// Rechnungsvorschläge „Nie vergessen, eine Rechnung zu stellen“ (22.11.2026) — Minutentakt und Wochenhinweis.
// Die Regeln stehen in _shared/rechnungVorschlagKern.ts; diese Datei lädt die Daten und schreibt die Tabelle
// rechnung_vorschlaege.
//
// Warum ein Takt statt Datenbank-Auslösern: Die Provision wird mit umsatzKern.ts (Texte wie „3,57 % inkl. MwSt.“)
// gerechnet, Positionen kommen aus Kostenvoranschlag, Preisliste oder Seminarpreis — das gibt es nur in TypeScript.
// Der Takt holt alles nach, egal wer die Daten geschrieben hat (CRM, Assistent, Import), und ist idempotent:
// Schlüssel der Zeile = Anlass (kv:<id>, akte:<id>, seminar:<id>, provision:<id>), neu wird nur angelegt, was
// es noch nicht gibt (doppelte Anlage scheitert am Primärschlüssel und wird ignoriert).
//
// pruefeRechnungVorschlaege: alle fünf Minuten (Minute durch 5 teilbar), ohne KI, ohne Nachrichten; wirft nie.
// pruefeRechnungVorschlagHinweis: montags 9–12 Uhr Berliner Zeit höchstens eine Telegram-Nachricht je Person und
//   Woche „N Rechnungen sind fällig zu stellen“. Einstellung je Mitarbeiter in rechnung_vorschlag_hinweis
//   (aktiv; keine Zeile = an für die Geschäftsführung, aus für alle anderen). Ohne offene Vorschläge keine Nachricht.
//   Die Woche wird VOR dem Senden mit einer bedingten Änderung beansprucht (nie doppelt). Wirft nie.

import { CRM_BASIS_STANDARD } from '../_shared/kundenberichtKern.ts'
import {
  AKTE_RECHNUNG_STAENDE,
  euroCent,
  faelligSatz,
  gleicheAb,
  PROVISION_STAENDE,
  sollVorschlaege,
  vorschlagLink,
  vorschlagZeile,
  type AkteDaten,
  type AnmeldungDaten,
  type KvDaten,
  type ObjektDaten,
  type PreislistenEintrag,
  type RechnungKurz,
  type VorschlagZeile,
} from '../_shared/rechnungVorschlagKern.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const VORSCHLAG_TABELLE = 'rechnung_vorschlaege'
export const HINWEIS_TABELLE = 'rechnung_vorschlag_hinweis'
const IN_STUECK = 150

export type VorschlagLauf = { gelaufen: boolean; neu: number; geaendert: number; erledigt: number; entfernt: number; verknuepft: number; fehler: string[] }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

function akteName(k: { firma?: unknown; ansprechpartner?: unknown }): string {
  const f = text(k.firma)
  const p = text(k.ansprechpartner)
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

function stuecke<T>(liste: T[], n = IN_STUECK): T[][] {
  const aus: T[][] = []
  for (let i = 0; i < liste.length; i += n) aus.push(liste.slice(i, i + n))
  return aus
}

/** Zeilen mit `spalte in (werte)` — in Stücken, damit die Adresse nicht zu lang wird. */
async function ladeIn(admin: Db, tabelle: string, spalten: string, spalte: string, werte: string[], weiter?: (q: Db) => Db): Promise<Record<string, unknown>[]> {
  const eindeutig = [...new Set(werte.filter(Boolean))]
  const aus: Record<string, unknown>[] = []
  for (const teil of stuecke(eindeutig)) {
    let q = admin.from(tabelle).select(spalten).in(spalte, teil)
    if (weiter) q = weiter(q)
    const { data, error } = await q
    if (error) throw new Error(`${tabelle}: ${error.message}`)
    aus.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return aus
}

/** Vom Minutentakt gerufen; läuft nur, wenn die Minute durch 5 teilbar ist (oder `immer`). */
export async function pruefeRechnungVorschlaege(admin: Db, jetzt: Date = new Date(), optionen: { immer?: boolean } = {}): Promise<VorschlagLauf> {
  const lauf: VorschlagLauf = { gelaufen: false, neu: 0, geaendert: 0, erledigt: 0, entfernt: 0, verknuepft: 0, fehler: [] }
  if (!optionen.immer && jetzt.getUTCMinutes() % 5 !== 0) return lauf
  lauf.gelaufen = true
  try {
    const aktenBereiche = Object.keys(AKTE_RECHNUNG_STAENDE)
    const aktenStaende = [...new Set(Object.values(AKTE_RECHNUNG_STAENDE).flat())]
    const [kvRes, akteRes, anmRes, objRes, offenRes, preisRes] = await Promise.all([
      admin.from('kostenvoranschlaege').select('id, kunde_id, bereich, privat_besitzer, name, beschreibung, betrag, status, positionen, aufschlag_prozent, ust_satz').eq('status', 'angenommen'),
      admin.from('kunden').select('id, bereich, firma, ansprechpartner, status, dienstleistungen, auftrag_chance').in('bereich', aktenBereiche).in('status', aktenStaende),
      admin.from('seminar_anmeldungen').select('id, termin_id, kunde_id, name, firma, status, rechnung_id').eq('status', 'teilgenommen').is('rechnung_id', null),
      admin.from('objekte').select('id, bezeichnung, adresse, kaufpreis, status, verkaufsdaten, kurzpruefung, privat_besitzer, zugewiesener_kunde').in('status', [...PROVISION_STAENDE]),
      admin.from(VORSCHLAG_TABELLE).select('*').eq('status', 'offen'),
      admin.from('leistungen_preisliste').select('id, bezeichnung, preis_stunde_von, preis_tag_von'),
    ])
    for (const [name, r] of [['kostenvoranschlaege', kvRes], ['kunden', akteRes], ['seminar_anmeldungen', anmRes], ['objekte', objRes], [VORSCHLAG_TABELLE, offenRes]] as const) {
      if (r.error) throw new Error(`${name}: ${r.error.message}`)
    }
    // deno-lint-ignore no-explicit-any
    const kvZeilen = ((kvRes.data ?? []) as any[]).filter((k) => !text(k.privat_besitzer) && k.bereich !== 'privat')
    // deno-lint-ignore no-explicit-any
    const akteZeilen = (akteRes.data ?? []) as any[]
    // deno-lint-ignore no-explicit-any
    const anmZeilen = (anmRes.data ?? []) as any[]
    // deno-lint-ignore no-explicit-any
    const objZeilen = ((objRes.data ?? []) as any[]).filter((o) => !text(o.privat_besitzer))
    const offene = (offenRes.data ?? []) as VorschlagZeile[]
    const preisliste = (preisRes.error ? [] : (preisRes.data ?? [])) as PreislistenEintrag[]

    // Zusätzliche Angaben zu den Akten: Kostenvoranschläge (angenommen/bezahlt) und Seminarteilnahmen der erledigten Akten.
    const akteIds = akteZeilen.map((a) => text(a.id))
    const akteKv = akteIds.length ? await ladeIn(admin, 'kostenvoranschlaege', 'id, kunde_id, status, privat_besitzer, bereich, name', 'kunde_id', akteIds, (q) => q.in('status', ['angenommen', 'bezahlt'])) : []
    const akteSeminar = akteIds.length ? await ladeIn(admin, 'seminar_anmeldungen', 'id, kunde_id, status, rechnung_id', 'kunde_id', akteIds, (q) => q.eq('status', 'teilgenommen')) : []

    // Seminare: Termin und Katalog für Titel und Preis.
    const termine = await ladeIn(admin, 'seminar_termine', 'id, seminar_id, beginn, preis', 'id', anmZeilen.map((a) => text(a.termin_id)))
    const terminJe = new Map(termine.map((t) => [text(t.id), t]))
    const seminare = await ladeIn(admin, 'seminare', 'id, titel, preis_netto', 'id', termine.map((t) => text(t.seminar_id)))
    const seminarJe = new Map(seminare.map((s) => [text(s.id), s]))

    // Objekte: Abrechnung und Freigaben wie umsatzWerkzeuge.ts.
    const objIds = objZeilen.map((o) => text(o.id))
    const abrechnung = new Map<string, number>()
    // deno-lint-ignore no-explicit-any
    const freigaben = new Map<string, any[]>()
    if (objIds.length) {
      const { data: abr } = await admin.from('abteilung_eintraege').select('daten').eq('art', 'abrechnung')
      for (const z of (abr ?? []) as { daten: { objektId?: string; provision?: number } | null }[]) {
        if (z.daten?.objektId && Number(z.daten.provision) > 0) abrechnung.set(z.daten.objektId, Number(z.daten.provision))
      }
      for (const f of await ladeIn(admin, 'objekt_freigaben', 'objekt_id, provision, status, erstellt_am, kunde_id, kunde_bereich', 'objekt_id', objIds)) {
        const id = text(f.objekt_id)
        freigaben.set(id, [...(freigaben.get(id) ?? []), f])
      }
    }

    // Rechnungen, die Vorschläge erledigen: mit kv_id der Kostenvoranschläge und für die betroffenen Akten.
    const kvIds = [...kvZeilen.map((k) => text(k.id)), ...offene.map((z) => text(z.kv_id))].filter(Boolean)
    const kundenIdsFuerRechnung = [...akteIds, ...offene.filter((z) => z.art === 'akte').map((z) => text(z.kunde_id))].filter(Boolean)
    const rechnungZeilen = [
      ...(kvIds.length ? await ladeIn(admin, 'rechnungen', 'id, kunde_id, kv_id', 'kv_id', kvIds) : []),
      ...(kundenIdsFuerRechnung.length ? await ladeIn(admin, 'rechnungen', 'id, kunde_id, kv_id', 'kunde_id', kundenIdsFuerRechnung) : []),
    ]
    const rechnungen: RechnungKurz[] = rechnungZeilen.map((r) => ({ id: text(r.id), kundeId: text(r.kunde_id) || null, kvId: text(r.kv_id) || null }))

    // Namen und Bereiche aller genannten Akten (Kostenvoranschläge, Teilnehmer, Objekte).
    const namen = new Map<string, { name: string; bereich: string }>()
    for (const a of akteZeilen) namen.set(text(a.id), { name: akteName(a), bereich: text(a.bereich) })
    const weitere = [
      ...kvZeilen.map((k) => text(k.kunde_id)),
      ...anmZeilen.map((a) => text(a.kunde_id)),
      ...objZeilen.map((o) => text(o.zugewiesener_kunde?.kundeId)),
      ...[...freigaben.values()].flat().map((f) => text(f.kunde_id)),
    ].filter((id) => id && !namen.has(id))
    for (const k of await ladeIn(admin, 'kunden', 'id, bereich, firma, ansprechpartner', 'id', weitere)) namen.set(text(k.id), { name: akteName(k), bereich: text(k.bereich) })

    const akten: AkteDaten[] = akteZeilen.map((a) => ({
      id: text(a.id),
      bereich: text(a.bereich),
      name: akteName(a),
      status: text(a.status),
      dienstleistungen: Array.isArray(a.dienstleistungen) ? a.dienstleistungen : [],
      umsatzNetto: Number(a.auftrag_chance?.umsatzNetto) > 0 ? Number(a.auftrag_chance.umsatzNetto) : null,
    }))
    const kvDaten = (z: Record<string, unknown>): KvDaten => ({
      id: text(z.id),
      kundeId: text(z.kunde_id) || null,
      bereich: text(z.bereich) || null,
      privat: !!text(z.privat_besitzer),
      name: text(z.name),
      beschreibung: text(z.beschreibung),
      status: text(z.status),
      betrag: z.betrag === null || z.betrag === undefined ? null : Number(z.betrag),
      positionen: Array.isArray(z.positionen) ? (z.positionen as KvDaten['positionen']) : null,
      aufschlagProzent: z.aufschlag_prozent === null || z.aufschlag_prozent === undefined ? null : Number(z.aufschlag_prozent),
      ustSatz: z.ust_satz === null || z.ust_satz === undefined ? null : Number(z.ust_satz),
    })
    const angebote: KvDaten[] = [...kvZeilen.map(kvDaten), ...akteKv.filter((k) => !kvZeilen.some((x) => x.id === k.id)).map(kvDaten)]
    const anmeldungen: AnmeldungDaten[] = [
      ...anmZeilen.map((a) => {
        const t = terminJe.get(text(a.termin_id))
        const s = t ? seminarJe.get(text(t.seminar_id)) : undefined
        const preis = t && t.preis !== null && t.preis !== undefined ? Number(t.preis) : s && s.preis_netto !== null && s.preis_netto !== undefined ? Number(s.preis_netto) : null
        return { id: text(a.id), kundeId: text(a.kunde_id) || null, name: text(a.name), firma: text(a.firma), status: text(a.status), rechnungId: text(a.rechnung_id) || null, seminarTitel: text(s?.titel) || 'Seminar', preisNetto: preis, beginn: text(t?.beginn) || null }
      }),
      // Nur damit die Akten-Regel weiß, dass es eine Teilnahme gibt (mit Rechnung → erzeugt selbst nichts).
      ...akteSeminar.filter((a) => !anmZeilen.some((x) => x.id === a.id)).map((a) => ({ id: text(a.id), kundeId: text(a.kunde_id) || null, name: '', status: text(a.status), rechnungId: text(a.rechnung_id) || null, seminarTitel: '' })),
    ]
    const objekte: ObjektDaten[] = objZeilen.map((o) => {
      const b = text(o.bezeichnung)
      const a = text(o.adresse)
      const kz = o.verkaufsdaten?.kennzahlen ?? {}
      const fr = freigaben.get(text(o.id)) ?? []
      const zugeordnet = text(o.zugewiesener_kunde?.kundeId)
      return {
        id: text(o.id),
        name: b && a && !b.includes(a) ? `${b}, ${a}` : b || a || 'Objekt ohne Bezeichnung',
        status: text(o.status),
        kaufpreis: Number(o.kaufpreis) || 0,
        zielpreis: Number(kz.zielverkaufspreis) || Number(kz.kaufpreisvorstellung) || null,
        abrechnungProvision: abrechnung.get(text(o.id)) ?? null,
        kurzpruefungProzent: o.kurzpruefung?.provisionProzent ?? undefined,
        kurzpruefungBetrag: o.kurzpruefung?.provisionBetrag ?? undefined,
        freigaben: fr.map((f) => ({ provision: text(f.provision), status: text(f.status), erstelltAm: text(f.erstellt_am) })),
        privatBesitzer: text(o.privat_besitzer) || null,
        kunde: zugeordnet ? { id: zugeordnet, bereich: namen.get(zugeordnet)?.bereich ?? text(o.zugewiesener_kunde?.bereich) } : null,
        zugestimmteKunden: [...new Map(fr.filter((f) => f.status === 'zugestimmt' && text(f.kunde_id)).map((f) => [text(f.kunde_id), { id: text(f.kunde_id), bereich: namen.get(text(f.kunde_id))?.bereich ?? text(f.kunde_bereich) }])).values()],
      }
    })

    const soll = sollVorschlaege({ akten, angebote, anmeldungen, objekte, rechnungen, preisliste, aktenNamen: namen })

    // Vorhandene Zeilen: alle offenen plus die mit den ids aus soll (erstellt/verworfen → nie wieder vorschlagen).
    const vorhanden = new Map<string, VorschlagZeile>(offene.map((z) => [z.id, z]))
    for (const z of (await ladeIn(admin, VORSCHLAG_TABELLE, '*', 'id', soll.map((s) => s.id).filter((id) => !vorhanden.has(id)))) as VorschlagZeile[]) vorhanden.set(z.id, z)

    // Seminar-Vorschläge, deren Anmeldung inzwischen eine rechnung_id hat (offene, die nicht mehr im Soll sind).
    const offeneSeminare = offene.filter((z) => z.art === 'seminar' && z.anmeldung_id && !soll.some((s) => s.id === z.id))
    const anmMitRechnung = new Map<string, string>()
    for (const a of await ladeIn(admin, 'seminar_anmeldungen', 'id, rechnung_id', 'id', offeneSeminare.map((z) => text(z.anmeldung_id)))) {
      if (text(a.rechnung_id)) anmMitRechnung.set(text(a.id), text(a.rechnung_id))
    }
    const abgleich = gleicheAb(soll, [...vorhanden.values()], (z) => {
      if (z.art === 'kv') return rechnungen.find((r) => r.kvId && r.kvId === z.kv_id)?.id
      if (z.art === 'akte') return rechnungen.find((r) => r.kundeId && r.kundeId === z.kunde_id)?.id
      if (z.art === 'seminar') return z.anmeldung_id ? anmMitRechnung.get(text(z.anmeldung_id)) : undefined
      return undefined
    })

    const jetztIso = jetzt.toISOString()
    for (const s of abgleich.neu) {
      const { error } = await admin.from(VORSCHLAG_TABELLE).insert({ ...s, status: 'offen', erstellt_am: jetztIso, geaendert_am: jetztIso })
      if (!error) lauf.neu++
      else if (error.code !== '23505') lauf.fehler.push(`${s.id}: ${error.message}`)
    }
    for (const a of abgleich.aendern) {
      const { error } = await admin.from(VORSCHLAG_TABELLE).update({ ...a.felder, geaendert_am: jetztIso }).eq('id', a.id).eq('status', 'offen')
      if (!error) lauf.geaendert++
      else lauf.fehler.push(`${a.id}: ${error.message}`)
    }
    for (const e of abgleich.erledigt) {
      const { error } = await admin
        .from(VORSCHLAG_TABELLE)
        .update({ status: 'erstellt', rechnung_id: e.rechnungId, erledigt_am: jetztIso, erledigt_von: 'automatisch (Rechnung gefunden)', geaendert_am: jetztIso })
        .eq('id', e.id)
        .eq('status', 'offen')
      if (!error) lauf.erledigt++
      else lauf.fehler.push(`${e.id}: ${error.message}`)
    }
    for (const id of abgleich.entfernen) {
      const { error } = await admin.from(VORSCHLAG_TABELLE).delete().eq('id', id).eq('status', 'offen')
      if (!error) lauf.entfernt++
      else lauf.fehler.push(`${id}: ${error.message}`)
    }

    // Im CRM angelegte Rechnung zu einer Seminarteilnahme: rechnung_id an der Anmeldung nachtragen (nur wenn es die
    // Rechnung in der Datenbank schon gibt — das CRM speichert sie kurz danach).
    const seminarErstellt = [...vorhanden.values()].filter((z) => z.art === 'seminar' && z.status === 'erstellt' && z.rechnung_id && z.anmeldung_id && anmZeilen.some((a) => a.id === z.anmeldung_id))
    if (seminarErstellt.length) {
      const da = new Set((await ladeIn(admin, 'rechnungen', 'id', 'id', seminarErstellt.map((z) => text(z.rechnung_id)))).map((r) => text(r.id)))
      for (const z of seminarErstellt) {
        if (!da.has(text(z.rechnung_id))) continue
        const { error } = await admin.from('seminar_anmeldungen').update({ rechnung_id: z.rechnung_id }).eq('id', z.anmeldung_id).is('rechnung_id', null)
        if (!error) lauf.verknuepft++
        else lauf.fehler.push(`Anmeldung ${z.anmeldung_id}: ${error.message}`)
      }
    }
  } catch (err) {
    lauf.fehler.push(err instanceof Error ? err.message : String(err))
  }
  if (lauf.fehler.length) console.error('Rechnungsvorschläge:', lauf.fehler.join(' | '))
  return lauf
}

// ─── Wochenhinweis ───────────────────────────────────────────────────────────────────────────────

export type SendeFunktion = (chatId: number | string, text: string) => Promise<boolean>
export type HinweisErgebnis = { gelaufen: boolean; gesendet: number; meldungen: string[] }

const AB_STUNDE = 9
const BIS_STUNDE = 12
const HOECHSTENS_ZEILEN = 6

/** Montag zwischen 9:00 und 11:59 Uhr Berliner Zeit? */
export function imWochenFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag === 1 && b.stunde >= AB_STUNDE && b.stunde < BIS_STUNDE
}

type Person = { email: string; chat: number | string; alles: boolean; bereiche: string[] }

/** Darf die Person den Vorschlag sehen? Wie die Zeilenregel: Unternehmensberatung + Bereich der Akte; Provision nur mit Immobilien. */
export function siehtVorschlag(p: { alles: boolean; bereiche: string[] }, v: Pick<VorschlagZeile, 'art' | 'kunde_bereich'>): boolean {
  if (p.alles) return true
  const darf = (b: string | null | undefined) => {
    const id = b === 'immobilienkunden' ? 'immobilien' : text(b)
    return !id || id === 'intern' ? true : id === 'privat' ? false : p.bereiche.includes(id)
  }
  if (!darf('beratung')) return false
  if (v.art === 'provision' && !darf('immobilien')) return false
  return darf(v.kunde_bereich)
}

/** Text der Wochennachricht. */
export function wochenText(vorschlaege: VorschlagZeile[], namen: Map<string, string>, basis: string): string {
  const summe = vorschlaege.reduce((s, v) => s + (Number(v.betrag_netto) > 0 ? Number(v.betrag_netto) : 0), 0)
  const ohneBetrag = vorschlaege.filter((v) => !(Number(v.betrag_netto) > 0)).length
  const sortiert = [...vorschlaege].sort((a, b) => (Number(b.betrag_netto) || 0) - (Number(a.betrag_netto) || 0))
  const gezeigt = sortiert.slice(0, HOECHSTENS_ZEILEN)
  return [
    `Wochenhinweis Rechnungen: ${faelligSatz(vorschlaege.length)}${summe > 0 ? ` (zusammen ${euroCent(summe)} netto${ohneBetrag ? `, ${ohneBetrag} noch ohne Betrag` : ''})` : ''}.`,
    ...gezeigt.map((v) => `• ${vorschlagZeile(v, v.kunde_id ? namen.get(v.kunde_id) : undefined)}`),
    sortiert.length > gezeigt.length ? `… und ${sortiert.length - gezeigt.length} weitere.` : '',
    `Im CRM unter Rechnungen → Vorschläge: ${vorschlagLink(basis)}`,
    'Abschalten: dem Assistenten „Wochenhinweis Rechnungen aus“ schreiben oder auf der Seite Rechnungen den Haken entfernen.',
  ].filter(Boolean).join('\n')
}

/** Vom Minutentakt gerufen. Außerhalb des Fensters ohne Datenbankzugriff. */
export async function pruefeRechnungVorschlagHinweis(admin: Db, sende: SendeFunktion, jetzt: Date = new Date()): Promise<HinweisErgebnis> {
  const ergebnis: HinweisErgebnis = { gelaufen: false, gesendet: 0, meldungen: [] }
  if (!imWochenFenster(jetzt)) return ergebnis
  try {
    const montag = berlinZeit(jetzt).datum
    const [{ data: leute, error: teamFehler }, { data: einst, error: einstFehler }] = await Promise.all([
      admin.from('mitarbeiter').select('email, rolle, ist_admin, aktiv, bereiche, telegram_chat_id').eq('aktiv', true),
      admin.from(HINWEIS_TABELLE).select('email, aktiv, letzte_woche'),
    ])
    if (teamFehler) throw new Error(`mitarbeiter: ${teamFehler.message}`)
    // Lieber gar nicht senden als an jemanden, der abgeschaltet hat.
    if (einstFehler) throw new Error(`${HINWEIS_TABELLE}: ${einstFehler.message}`)
    const einstellung = new Map<string, { aktiv: boolean; letzte: string }>()
    for (const z of (einst ?? []) as { email: string; aktiv: boolean | null; letzte_woche: string | null }[]) {
      einstellung.set(text(z.email).toLowerCase(), { aktiv: z.aktiv !== false, letzte: text(z.letzte_woche).slice(0, 10) })
    }
    const offen: Person[] = []
    // deno-lint-ignore no-explicit-any
    for (const m of (leute ?? []) as any[]) {
      const email = text(m.email).toLowerCase()
      const chat = m.telegram_chat_id
      if (!email || chat === null || chat === undefined || chat === '') continue
      const gf = m.rolle === 'geschaeftsfuehrung'
      const e = einstellung.get(email)
      // Keine Zeile: an für die Geschäftsführung, aus für alle anderen.
      if (e ? !e.aktiv || e.letzte >= montag : !gf) continue
      const alles = gf || m.ist_admin === true
      const bereiche = Array.isArray(m.bereiche) ? m.bereiche.map((b: unknown) => text(b)) : []
      if (!alles && !bereiche.includes('beratung')) continue
      offen.push({ email, chat, alles, bereiche })
    }
    if (offen.length === 0) return ergebnis
    ergebnis.gelaufen = true

    const { data: vRoh, error: vFehler } = await admin.from(VORSCHLAG_TABELLE).select('*').eq('status', 'offen')
    if (vFehler) throw new Error(`${VORSCHLAG_TABELLE}: ${vFehler.message}`)
    const vorschlaege = (vRoh ?? []) as VorschlagZeile[]
    if (vorschlaege.length === 0) return ergebnis

    const namen = new Map<string, string>()
    for (const k of await ladeIn(admin, 'kunden', 'id, firma, ansprechpartner', 'id', vorschlaege.map((v) => text(v.kunde_id)))) namen.set(text(k.id), akteName(k))
    const { data: wk } = await admin.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const basis = text(wk?.link_basis) || CRM_BASIS_STANDARD

    for (const p of offen) {
      const meine = vorschlaege.filter((v) => siehtVorschlag(p, v))
      if (meine.length === 0) continue
      if (!(await beanspruche(admin, p.email, einstellung.has(p.email), montag))) continue
      try {
        if (await sende(p.chat, wochenText(meine, namen, basis)).catch(() => false)) ergebnis.gesendet++
        else ergebnis.meldungen.push(`Rechnungs-Wochenhinweis an ${p.email}: Telegram-Versand fehlgeschlagen.`)
      } catch (err) {
        ergebnis.meldungen.push(`Rechnungs-Wochenhinweis an ${p.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Rechnungs-Wochenhinweis fehlgeschlagen:', err)
    ergebnis.meldungen.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

/** Setzt letzte_woche auf diesen Montag — nur, wenn es noch niemand getan hat. true = wir dürfen senden. */
async function beanspruche(admin: Db, email: string, hatZeile: boolean, montag: string): Promise<boolean> {
  if (!hatZeile) {
    const { error } = await admin.from(HINWEIS_TABELLE).insert({ email, aktiv: true, letzte_woche: montag })
    if (!error) return true
    if (error.code !== '23505') throw new Error(`${HINWEIS_TABELLE}: ${error.message}`)
  }
  const { data, error } = await admin
    .from(HINWEIS_TABELLE)
    .update({ letzte_woche: montag })
    .eq('email', email)
    .eq('aktiv', true)
    .or(`letzte_woche.is.null,letzte_woche.lt.${montag}`)
    .select('email')
  if (error) throw new Error(`${HINWEIS_TABELLE}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}
