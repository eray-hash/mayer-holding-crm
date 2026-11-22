// Aktion `kv_zuordnen` (22.11.2026): Kostenvoranschläge ohne Akte ihren Kundenakten zuordnen — einmalig mit
// Vorschau auf der Seite „Kostenvoranschläge“ (src/components/KvZuordnungVorschlaege.tsx), nur Geschäftsführung
// und Admins. Anlass: keiner der 20 Einträge hatte eine Akte, deshalb fehlten sie in Umsatzvorschau
// (_shared/umsatzKern.ts), Rechnungsvorschlägen (_shared/rechnungVorschlagKern.ts), Wiedervorlagen (wv_kv) und im
// Reiter der Akte.
//
//  - modus "vorschlaege" (Vorgabe, ändert nichts): alle sichtbaren Einträge ohne Akte mit Kandidaten
//    (Kern: _shared/kvZuordnung.ts) und Zählern sicher / wahrscheinlich / ohne Vorschlag.
//  - modus "zuordnen" mit paare = [{ kv_id, kunde_id }]: ohne anwenden = true nur Prüfung (was würde gesetzt),
//    mit anwenden = true werden kunde_id, bereich und privat_besitzer gesetzt — genau wie zuordnungVon im
//    Assistenten (telegram-gateway/kostenvoranschlagWerkzeuge.ts). Nur Einträge, die noch keine Akte haben
//    (Schutz gegen gleichzeitiges Zuordnen), und nur, wenn sich dadurch nicht ändert, wer den Eintrag sieht.

import { darfKv, zuordnungVon } from '../telegram-gateway/kostenvoranschlagWerkzeuge.ts'
import { bereichName, darfAkte, type RechteMitarbeiter } from '../telegram-gateway/rechte.ts'
import { alleZeilen } from '../_shared/dublettenLaden.ts'
import { type AkteFuerZuordnung, type KvFuerZuordnung, type KvKandidat, kvZaehler, kvZuordnungsVorschlaege, passtSichtbarkeit } from '../_shared/kvZuordnung.ts'
import { inhaltSchluessel } from './akteZuObjekt.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type KvZuordnungUmgebung = {
  admin: Db
  aufrufer: { email: string; name: string }
  protokolliere?: (text: string) => void
}

export type KvZuordnungAntwort = { status: number; daten: unknown }

type Mitarbeiter = RechteMitarbeiter & { name: string; aktiv?: boolean | null }

export const MAX_PAARE = 100
const AKTEN_SPALTEN = 'id, bereich, firma, ansprechpartner, email, verantwortlich_email'
const KV_SPALTEN = 'id, kunde_id, bereich, privat_besitzer, name, beschreibung, notiz, betrag, status, datum, dokument'

export type KandidatAnsicht = KvKandidat & { firma: string; ansprechpartner: string; bereich: string; bereichName: string }
export type EintragAnsicht = {
  id: string
  name: string
  beschreibung: string
  notiz: string
  betrag: number | null
  status: string
  datum: string | null
  privat: boolean
  kandidaten: KandidatAnsicht[]
}

function kvSichtbar(m: Mitarbeiter, k: Zeile): boolean {
  return darfKv(m, { bereich: k.bereich ?? null, privat_besitzer: k.privat_besitzer ?? null })
}

function fehler(status: number, text: string): KvZuordnungAntwort {
  return { status, daten: { error: text } }
}

export function darfKvZuordnen(m: Partial<Mitarbeiter> | null | undefined): boolean {
  return !!m && m.aktiv !== false && (m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true)
}

async function ladeMitarbeiter(admin: Db, email: string): Promise<Mitarbeiter | null> {
  const spalten = 'name, email, rolle, ist_admin, bereiche, aktiv'
  const { data } = await admin.from('mitarbeiter').select(spalten).eq('email', email).maybeSingle()
  if (data) return data as Mitarbeiter
  const muster = email.toLowerCase().replace(/[\\%_]/g, (z: string) => `\\${z}`)
  const { data: z } = await admin.from('mitarbeiter').select(spalten).ilike('email', muster).maybeSingle()
  return (z as Mitarbeiter | null) ?? null
}

export async function kvZuordnungAktion(umg: KvZuordnungUmgebung, body: Zeile): Promise<KvZuordnungAntwort> {
  const m = await ladeMitarbeiter(umg.admin, umg.aufrufer.email)
  if (!m || m.aktiv === false) return fehler(401, 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.')
  if (!darfKvZuordnen(m)) return fehler(403, 'Das Zuordnen der Kostenvoranschläge ist nur für die Geschäftsführung freigegeben.')
  const modus = typeof body?.modus === 'string' && body.modus.trim() ? body.modus.trim() : 'vorschlaege'
  try {
    if (modus === 'vorschlaege') return await vorschlaege(umg, m)
    if (modus === 'zuordnen') return await zuordnen(umg, m, body)
  } catch (e) {
    return fehler(500, `Das hat nicht geklappt: ${e instanceof Error ? e.message : String(e)}`)
  }
  return fehler(400, 'Unbekannter Modus — erwartet vorschlaege oder zuordnen.')
}

// ---------- Vorschläge (ändert nichts) ----------

function alsAkte(z: Zeile): AkteFuerZuordnung {
  return { id: String(z.id), bereich: String(z.bereich ?? ''), firma: z.firma, ansprechpartner: z.ansprechpartner, email: z.email, verantwortlich_email: z.verantwortlich_email }
}

/** Gelesene Texte der verknüpften Dateien (dokument_inhalte), nur für Dateien, die zu genau einem Eintrag gehören. */
async function dokumentTexte(admin: Db, kvs: Zeile[], akten: Map<string, Zeile>): Promise<Map<string, string>> {
  const anzahl = new Map<string, number>()
  for (const k of kvs) {
    const d = k.dokument?.dokumentId
    if (d) anzahl.set(d, (anzahl.get(d) ?? 0) + 1)
  }
  const schluesselVon = new Map<string, string>() // dokumentId → Schlüssel in dokument_inhalte
  for (const k of kvs) {
    const d = k.dokument
    if (!d?.dokumentId || anzahl.get(d.dokumentId) !== 1) continue
    const dok = (akten.get(String(d.kundeId ?? ''))?.dokumente ?? []).find((x: Zeile) => x?.id === d.dokumentId)
    if (dok?.url) schluesselVon.set(d.dokumentId, inhaltSchluessel(String(dok.url)))
  }
  const texte = new Map<string, string>()
  const alle = [...new Set(schluesselVon.values())]
  for (let i = 0; i < alle.length; i += 100) {
    const { data } = await admin.from('dokument_inhalte').select('schluessel, zusammenfassung, inhalt').in('schluessel', alle.slice(i, i + 100))
    const nachSchluessel = new Map<string, string>()
    for (const r of (data ?? []) as Zeile[]) nachSchluessel.set(r.schluessel, `${r.zusammenfassung ?? ''}\n${String(r.inhalt ?? '').slice(0, 20000)}`)
    for (const [dokId, s] of schluesselVon) if (nachSchluessel.has(s)) texte.set(dokId, nachSchluessel.get(s)!)
  }
  return texte
}

async function vorschlaege(umg: KvZuordnungUmgebung, m: Mitarbeiter): Promise<KvZuordnungAntwort> {
  const [kvZeilen, aktenZeilen] = await Promise.all([
    alleZeilen(umg.admin, 'kostenvoranschlaege', KV_SPALTEN, (q: Db) => q.is('kunde_id', null)),
    alleZeilen(umg.admin, 'kunden', AKTEN_SPALTEN),
  ])
  const kvs = kvZeilen.filter((k) => kvSichtbar(m, k))
  const sichtbareAkten = aktenZeilen.filter((a) => darfAkte(m, a))
  const aktenMap = new Map(aktenZeilen.map((a) => [String(a.id), a]))

  // Dokumente nur der Akten laden, in denen verknüpfte Dateien liegen (die Spalte ist groß).
  const dateiAkten = [...new Set(kvs.map((k) => String(k.dokument?.kundeId ?? '')).filter(Boolean))]
  const mitDokumenten = new Map<string, Zeile>()
  for (let i = 0; i < dateiAkten.length; i += 50) {
    const { data } = await umg.admin.from('kunden').select('id, dokumente').in('id', dateiAkten.slice(i, i + 50))
    for (const z of (data ?? []) as Zeile[]) mitDokumenten.set(String(z.id), z)
  }
  const texte = await dokumentTexte(umg.admin, kvs, mitDokumenten)

  const eingabe: KvFuerZuordnung[] = kvs.map((k) => ({
    id: String(k.id),
    name: String(k.name ?? ''),
    beschreibung: k.beschreibung,
    notiz: k.notiz,
    bereich: k.bereich,
    privat_besitzer: k.privat_besitzer,
    dokumentKundeId: k.dokument?.kundeId ?? null,
    dokumentId: k.dokument?.dokumentId ?? null,
    dokumentText: k.dokument?.dokumentId ? texte.get(k.dokument.dokumentId) ?? null : null,
  }))
  const liste = kvZuordnungsVorschlaege(eingabe, sichtbareAkten.map(alsAkte))
  const eintraege: EintragAnsicht[] = liste.map((v) => {
    const k = kvs.find((x) => String(x.id) === v.kv_id)!
    return {
      id: v.kv_id,
      name: String(k.name ?? ''),
      beschreibung: String(k.beschreibung ?? ''),
      notiz: String(k.notiz ?? ''),
      betrag: k.betrag === null || k.betrag === undefined || k.betrag === '' ? null : Number(k.betrag),
      status: String(k.status ?? 'offen'),
      datum: k.datum ?? null,
      privat: k.bereich === 'privat' || !!k.privat_besitzer,
      kandidaten: v.kandidaten.map((c) => {
        const a = aktenMap.get(c.kunde_id) ?? {}
        return { ...c, firma: String(a.firma ?? '').trim(), ansprechpartner: String(a.ansprechpartner ?? '').trim(), bereich: String(a.bereich ?? ''), bereichName: a.bereich === 'privat' ? 'Privat' : bereichName(a.bereich) }
      }),
    }
  })
  // Sichere zuerst, dann wahrscheinliche, dann ohne Vorschlag; innerhalb nach Name.
  const rang = (e: EintragAnsicht) => (e.kandidaten[0]?.stufe === 'sicher' ? 0 : e.kandidaten.length ? 1 : 2)
  eintraege.sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name, 'de'))
  return { status: 200, daten: { zaehler: kvZaehler(liste), eintraege } }
}

// ---------- Zuordnen ----------

export type ZuordnungsErgebnis = {
  kv_id: string
  kunde_id: string
  ok: boolean
  text: string
  setzt?: { kunde_id: string | null; bereich: string | null; privat_besitzer: string | null }
}

function akteName(a: Zeile): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

async function zuordnen(umg: KvZuordnungUmgebung, m: Mitarbeiter, body: Zeile): Promise<KvZuordnungAntwort> {
  const roh = Array.isArray(body?.paare) ? body.paare : []
  const paare: { kv_id: string; kunde_id: string }[] = []
  const gesehen = new Set<string>()
  for (const p of roh) {
    const kv_id = String(p?.kv_id ?? '').trim()
    const kunde_id = String(p?.kunde_id ?? '').trim()
    if (!kv_id || !kunde_id || gesehen.has(kv_id)) continue
    gesehen.add(kv_id)
    paare.push({ kv_id, kunde_id })
  }
  if (!paare.length) return fehler(400, 'Keine Zuordnung angegeben (paare mit kv_id und kunde_id).')
  if (paare.length > MAX_PAARE) return fehler(400, `Höchstens ${MAX_PAARE} Zuordnungen auf einmal.`)
  const anwenden = body?.anwenden === true

  const kvIds = paare.map((p) => p.kv_id)
  const kundenIds = [...new Set(paare.map((p) => p.kunde_id))]
  const [{ data: kvDaten, error: e1 }, { data: aktenDaten, error: e2 }] = await Promise.all([
    umg.admin.from('kostenvoranschlaege').select(KV_SPALTEN).in('id', kvIds),
    umg.admin.from('kunden').select(AKTEN_SPALTEN).in('id', kundenIds),
  ])
  if (e1 || e2) return fehler(500, `Laden hat nicht geklappt: ${(e1 ?? e2).message}`)
  const kvMap = new Map(((kvDaten ?? []) as Zeile[]).map((k) => [String(k.id), k]))
  const aktenMap = new Map(((aktenDaten ?? []) as Zeile[]).map((a) => [String(a.id), a]))

  const ergebnisse: ZuordnungsErgebnis[] = []
  for (const p of paare) {
    const kv = kvMap.get(p.kv_id)
    const akte = aktenMap.get(p.kunde_id)
    const basis = { kv_id: p.kv_id, kunde_id: p.kunde_id }
    if (!kv || !kvSichtbar(m, kv)) {
      ergebnisse.push({ ...basis, ok: false, text: 'Den Kostenvoranschlag gibt es nicht (mehr).' })
      continue
    }
    if (kv.kunde_id) {
      ergebnisse.push({ ...basis, ok: false, text: kv.kunde_id === p.kunde_id ? 'Ist dieser Akte schon zugeordnet.' : 'Ist inzwischen einer anderen Akte zugeordnet — nicht geändert.' })
      continue
    }
    if (!akte || !darfAkte(m, akte)) {
      ergebnisse.push({ ...basis, ok: false, text: 'Die Akte gibt es nicht (mehr).' })
      continue
    }
    if (!passtSichtbarkeit(kv, alsAkte(akte))) {
      ergebnisse.push({ ...basis, ok: false, text: 'Diese Akte passt nicht: Es würde sich ändern, wer den Kostenvoranschlag sieht (privat ↔ für alle, oder Sammelakte).' })
      continue
    }
    const setzt = zuordnungVon({ id: String(akte.id), bereich: akte.bereich, firma: akte.firma, ansprechpartner: akte.ansprechpartner, verantwortlich_email: akte.verantwortlich_email })
    const titel = `„${String(kv.name ?? '')}${kv.beschreibung ? ` – ${kv.beschreibung}` : ''}“`
    if (!anwenden) {
      ergebnisse.push({ ...basis, ok: true, setzt, text: `${titel} würde der Akte ${akteName(akte)} zugeordnet.` })
      continue
    }
    const { data: geaendert, error } = await umg.admin
      .from('kostenvoranschlaege')
      .update({ ...setzt, geaendert_am: new Date().toISOString() })
      .eq('id', p.kv_id)
      .is('kunde_id', null)
      .select('id')
    if (error) {
      ergebnisse.push({ ...basis, ok: false, text: `Speichern hat nicht geklappt: ${error.message}` })
      continue
    }
    if (!geaendert?.length) {
      ergebnisse.push({ ...basis, ok: false, text: 'Ist inzwischen schon zugeordnet — nicht geändert.' })
      continue
    }
    umg.protokolliere?.(`Kostenvoranschlag ${p.kv_id} der Akte ${p.kunde_id} zugeordnet (von ${umg.aufrufer.name})`)
    ergebnisse.push({ ...basis, ok: true, setzt, text: `${titel} ist jetzt der Akte ${akteName(akte)} zugeordnet.` })
  }
  return { status: 200, daten: { angewendet: anwenden, zugeordnet: anwenden ? ergebnisse.filter((e) => e.ok).length : 0, ergebnisse } }
}
