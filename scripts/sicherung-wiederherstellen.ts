// Wiederherstellen aus der täglichen Datensicherung (Runde 5, 22.11.2026).
//
// Holt eine einzelne Tabelle oder eine einzelne Akte (Zeile in `kunden` + alle Zeilen, die über kunde_id, akte_id,
// zugewiesener_kunde_id oder verknuepft_kunde_id an ihr hängen) aus einer Sicherung im Eimer `sicherungen` zurück
// in die Live-Datenbank. Alles andere bleibt unberührt.
//
// GRUNDSATZ: Ohne --ausfuehren ist es immer ein Probelauf — das Programm zeigt nur, was es tun würde.
// Vor dem Schreiben legt es eine Rückfalldatei an (Live-Stand der betroffenen Zeilen), mit der sich das Einspielen
// über den Befehl `rueckgaengig` wieder umkehren lässt.
//
// Ausführen (vom Ordner des CRM-Codes aus, Dienstschlüssel aus .env.local oder dem Supabase-Dashboard):
//
//   export SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=...            # nie weitergeben, nie ins Repo
//   deno run --allow-net --allow-env --allow-read --allow-write scripts/sicherung-wiederherstellen.ts <befehl> [optionen]
//
// Befehle:
//   liste                                       Sicherungen im Eimer (neueste zuerst)
//   zeige    [--sicherung NAME]                 Inhalt einer Sicherung: Tabellen, Zeilen, Ausgelassenes
//   tabelle  --tabelle T [--sicherung NAME]     eine Tabelle auf den Stand der Sicherung setzen
//            [--id WERT]                          nur diese eine Zeile (Primärschlüssel; einspaltig)
//            [--spalten a,b]                      bei vorhandenen Zeilen nur diese Spalten zurücksetzen
//            [--loeschen]                         Zeilen, die es erst seit der Sicherung gibt, löschen (Vorgabe: bleiben)
//   akte     --id KUNDEN_ID [--sicherung NAME]  eine Akte samt zugehöriger Zeilen zurückholen
//            [--nur-akte]                         nur die Zeile in kunden, nichts Zugehöriges
//            [--tabellen a,b]                     nur diese zugehörigen Tabellen (kunden ist immer dabei)
//            [--spalten a,b]                      nur diese Spalten der Akte (z. B. activities,dokumente)
//            [--auch-umgehaengte]                 auch Zeilen, die inzwischen an einer ANDEREN Akte hängen (Vorgabe: nein)
//   rueckgaengig --datei RUECKFALL.ndjson       ein Einspielen umkehren (Rückfalldatei aus einem früheren Lauf)
//
// Gemeinsame Optionen:
//   --sicherung NAME   z. B. 2026-11-23_0230; Vorgabe: die neueste
//   --paket DATEI.zip  ein heruntergeladenes Paket statt des Eimers lesen
//   --werte            im Probelauf alte und neue Werte der geänderten Felder zeigen (gekürzt)
//   --ausfuehren       wirklich schreiben (sonst Probelauf)
//   --mit-ausloesern   Datenbank-Auslöser beim Einspielen laufen lassen (Vorgabe: aus — sonst würden z. B.
//                      Willkommensnachrichten oder Wiedervorlagen neu eingeplant und To-dos nach Outlook gespiegelt)
//   --ja               ohne Rückfrage (für Skripte)
//
// Was die Sicherung NICHT enthält: die Dateien selbst (Dokumente, Anhänge, Fotos) — nur ihre Liste. Eine
// zurückgeholte Akte zeigt auf Dateien, die noch in der Ablage liegen müssen. Ebenso nicht: Anmeldungen,
// kurzlebige Zähler/Warteschlangen, KI-Verbrauch älter als 90 Tage.
//
// Voraussetzung: die SQL der Runde 5 (Funktion sicherung_zeilen_einspielen) ist eingespielt.

import {
  SICHERUNG_EIMER,
  akteReihenfolge,
  akteSpalte,
  felderText,
  groesseText,
  istSicherungsName,
  lesePaket,
  nameAlsText,
  schluesselWert,
  stabil,
  vergleiche,
  type GelesenesPaket,
  type Vergleich,
  type Zeile,
} from '../supabase/functions/_shared/sicherungKern.ts'

export type Umgebung = {
  url: string
  schluessel: string
  ausgabe: (zeile: string) => void
  /** Rückfrage vor dem Schreiben; true = weiter. */
  frage: (text: string) => boolean
  schreibeDatei: (pfad: string, inhalt: string) => Promise<void>
  leseDatei: (pfad: string) => Promise<Uint8Array>
  jetzt?: () => Date
}

type Optionen = Record<string, string | true>

const BLOCK = 200
const SEITE = 1000

export function leseArgumente(args: string[]): { befehl: string; o: Optionen } {
  const [befehl = 'hilfe', ...rest] = args
  const o: Optionen = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) throw new Error(`Unerwartetes Argument „${a}“.`)
    const name = a.slice(2)
    const naechstes = rest[i + 1]
    if (naechstes !== undefined && !naechstes.startsWith('--')) {
      o[name] = naechstes
      i++
    } else o[name] = true
  }
  return { befehl, o }
}

function text(o: Optionen, name: string): string | null {
  const w = o[name]
  return typeof w === 'string' && w.trim() ? w.trim() : null
}

function liste(o: Optionen, name: string): string[] | null {
  const w = text(o, name)
  return w ? w.split(',').map((s) => s.trim()).filter(Boolean) : null
}

// ---------------------------------------------------------------------------------------------
// Zugriff auf Supabase (nur fetch, Dienstschlüssel)
// ---------------------------------------------------------------------------------------------

class Zugang {
  constructor(private u: Umgebung) {}

  private kopf(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.u.schluessel, authorization: `Bearer ${this.u.schluessel}`, ...extra }
  }

  async json(pfad: string, init: RequestInit = {}): Promise<unknown> {
    const r = await fetch(`${this.u.url}${pfad}`, { ...init, headers: this.kopf((init.headers as Record<string, string>) ?? {}) })
    const t = await r.text()
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${pfad.split('?')[0]}: ${r.status} ${t.slice(0, 300)}`)
    return t ? JSON.parse(t) : null
  }

  async sicherungen(): Promise<{ name: string; bytes: number }[]> {
    const d = (await this.json(`/storage/v1/object/list/${SICHERUNG_EIMER}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 1000, offset: 0, sortBy: { column: 'name', order: 'desc' } }),
    })) as { name: string; metadata?: { size?: number } }[]
    return (d ?? [])
      .filter((x) => x.name.endsWith('.zip') && istSicherungsName(x.name.slice(0, -4)))
      .map((x) => ({ name: x.name.slice(0, -4), bytes: Number(x.metadata?.size ?? 0) }))
      .sort((a, b) => b.name.localeCompare(a.name))
  }

  async paket(name: string): Promise<Uint8Array> {
    const r = await fetch(`${this.u.url}/storage/v1/object/${SICHERUNG_EIMER}/${encodeURIComponent(name)}.zip`, { headers: this.kopf() })
    if (!r.ok) throw new Error(`Sicherung ${name} ließ sich nicht laden: ${r.status} ${(await r.text()).slice(0, 200)}`)
    return new Uint8Array(await r.arrayBuffer())
  }

  /** Live-Schema: Primärschlüssel und Spalten je Tabelle. */
  async schema(): Promise<Map<string, { schluessel: string[]; spalten: string[] }>> {
    const d = (await this.json('/rest/v1/rpc/sicherung_tabellen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })) as { tabelle: string; schluessel: string[]; spalten: string[] }[]
    return new Map((d ?? []).map((z) => [z.tabelle, { schluessel: z.schluessel ?? [], spalten: z.spalten ?? [] }]))
  }

  /** Alle Live-Zeilen einer Tabelle mit optionalem Filter (PostgREST-Ausdruck, z. B. „kunde_id=eq.k1“), seitenweise. */
  async zeilen(tabelle: string, filter: string | null, sortierung: string[]): Promise<Zeile[]> {
    const aus: Zeile[] = []
    for (let versatz = 0; ; ) {
      const teile = ['select=*', ...(filter ? [filter] : []), ...(sortierung.length ? [`order=${sortierung.map((s) => `${encodeURIComponent(s)}.asc`).join(',')}`] : []), `limit=${SEITE}`, `offset=${versatz}`]
      const seite = (await this.json(`/rest/v1/${encodeURIComponent(tabelle)}?${teile.join('&')}`)) as Zeile[]
      if (!Array.isArray(seite) || seite.length === 0) break
      aus.push(...seite)
      // Bis eine leere Seite kommt — so stimmt es auch, falls der Server weniger als 1000 Zeilen je Abfrage liefert.
      versatz += seite.length
    }
    return aus
  }

  async einspielen(tabelle: string, zeilen: Zeile[], spalten: string[] | null, ohneAusloeser: boolean): Promise<number> {
    let n = 0
    for (let i = 0; i < zeilen.length; i += BLOCK) {
      const r = await this.json('/rest/v1/rpc/sicherung_zeilen_einspielen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ p_tabelle: tabelle, p_zeilen: zeilen.slice(i, i + BLOCK), p_spalten: spalten, p_ohne_ausloeser: ohneAusloeser }),
      })
      n += Number(r ?? 0)
    }
    return n
  }

  async loeschen(tabelle: string, spalte: string, werte: unknown[]): Promise<void> {
    for (let i = 0; i < werte.length; i += 100) {
      await this.json(`/rest/v1/${encodeURIComponent(tabelle)}?${inFilter(spalte, werte.slice(i, i + 100))}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    }
  }
}

function inFilter(spalte: string, werte: unknown[]): string {
  const inListe = werte.map((w) => `"${String(w).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')
  return `${encodeURIComponent(spalte)}=in.(${encodeURIComponent(inListe)})`
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

type TabellenPlan = {
  tabelle: string
  schluessel: string[]
  vergleich: Vergleich
  /** Zeilen, die geschrieben würden (neu + geändert, ohne übersprungene). */
  schreiben: Zeile[]
  /** Live-Zeilen, die gelöscht würden (nur tabelle --loeschen). */
  loeschen: Zeile[]
  /** Übersprungen (z. B. hängt inzwischen an anderer Akte), mit Grund. */
  uebersprungen: { zeile: Zeile; grund: string }[]
  spalten: string[] | null
  hinweise: string[]
}

async function ladeGewaehltesPaket(z: Zugang, u: Umgebung, o: Optionen): Promise<GelesenesPaket> {
  const datei = text(o, 'paket')
  if (datei) return lesePaket(await u.leseDatei(datei))
  let name = text(o, 'sicherung')
  if (!name || name === 'neueste') {
    const alle = await z.sicherungen()
    if (alle.length === 0) throw new Error('Im Eimer liegt noch keine Sicherung.')
    name = alle[0].name
  }
  u.ausgabe(`Sicherung ${name} (${nameAlsText(name)}) wird geladen …`)
  return lesePaket(await z.paket(name))
}

/** Holt zu Sicherungs-Zeilen, die live per Filter nicht gefunden wurden, die Live-Zeile über den Schlüssel. */
async function ergaenzeUeberSchluessel(z: Zugang, tabelle: string, schluessel: string[], sicherung: Zeile[], live: Zeile[]): Promise<Zeile[]> {
  if (schluessel.length !== 1) return live
  const bekannt = new Set(live.map((l) => schluesselWert(l, schluessel)))
  const fehlen = sicherung.filter((s) => !bekannt.has(schluesselWert(s, schluessel))).map((s) => s[schluessel[0]])
  const aus = [...live]
  for (let i = 0; i < fehlen.length; i += 100) aus.push(...(await z.zeilen(tabelle, inFilter(schluessel[0], fehlen.slice(i, i + 100)), schluessel)))
  return aus
}

function planeTabelle(tabelle: string, schluessel: string[], sicherung: Zeile[], live: Zeile[], o: { spalten: string[] | null; loeschen: boolean; akte?: { spalte: string; id: string; auchUmgehaengte: boolean } }): TabellenPlan {
  const v = vergleiche(sicherung, live, schluessel, o.spalten ?? undefined)
  const plan: TabellenPlan = { tabelle, schluessel, vergleich: v, schreiben: [], loeschen: [], uebersprungen: [], spalten: o.spalten, hinweise: [] }
  for (const n of v.neu) plan.schreiben.push(n)
  for (const g of v.geaendert) {
    const a = o.akte
    if (a && a.spalte !== 'id' && g.live[a.spalte] !== null && g.live[a.spalte] !== undefined && String(g.live[a.spalte]) !== a.id && !a.auchUmgehaengte) {
      plan.uebersprungen.push({ zeile: g.sicherung, grund: `hängt inzwischen an Akte ${g.live[a.spalte]}` })
      continue
    }
    plan.schreiben.push(g.sicherung)
  }
  if (o.loeschen) plan.loeschen = v.nurLive
  return plan
}

function kurz(w: unknown, n = 160): string {
  const s = stabil(w)
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function zeigePlan(u: Umgebung, p: TabellenPlan, werte: boolean): void {
  const v = p.vergleich
  u.ausgabe(`\nTabelle ${p.tabelle} (Schlüssel ${p.schluessel.join(', ') || '—'}${p.spalten ? `, nur Spalten ${p.spalten.join(', ')}` : ''}):`)
  u.ausgabe(`  ${v.gleich} unverändert, ${v.geaendert.length} geändert, ${v.neu.length} fehlen live (würden neu angelegt), ${v.nurLive.length} nur live${p.loeschen.length ? ` (würden GELÖSCHT)` : ' (bleiben unberührt)'}`)
  for (const g of v.geaendert.slice(0, 50)) {
    const ueber = p.uebersprungen.find((x) => x.zeile === g.sicherung)
    u.ausgabe(`  ${ueber ? 'übersprungen' : 'zurücksetzen'} ${g.schluessel}: ${felderText(g.felder)}${ueber ? ` — ${ueber.grund}` : ''}`)
    if (werte) for (const f of g.felder.slice(0, 8)) u.ausgabe(`      ${f}: jetzt ${kurz(g.live[f])}  →  Sicherung ${kurz(g.sicherung[f])}`)
  }
  if (v.geaendert.length > 50) u.ausgabe(`  … und ${v.geaendert.length - 50} weitere geänderte Zeilen`)
  for (const n of v.neu.slice(0, 20)) u.ausgabe(`  neu anlegen ${schluesselWert(n, p.schluessel)}`)
  if (v.neu.length > 20) u.ausgabe(`  … und ${v.neu.length - 20} weitere`)
  for (const l of p.loeschen.slice(0, 20)) u.ausgabe(`  löschen ${schluesselWert(l, p.schluessel)}`)
  for (const h of p.hinweise) u.ausgabe(`  Hinweis: ${h}`)
}

/** Schreibt die Rückfalldatei, spielt dann ein. Gibt Zeilenzahlen zurück. */
async function fuehreAus(z: Zugang, u: Umgebung, plaene: TabellenPlan[], o: Optionen): Promise<void> {
  const gesamt = plaene.reduce((s, p) => s + p.schreiben.length + p.loeschen.length, 0)
  if (gesamt === 0) {
    u.ausgabe('\nNichts zu tun — der Live-Stand entspricht der Sicherung.')
    return
  }
  if (o.ausfuehren !== true) {
    u.ausgabe(`\nPROBELAUF — nichts geschrieben. ${gesamt} Zeile(n) wären betroffen. Zum Einspielen denselben Befehl mit --ausfuehren wiederholen.`)
    return
  }
  if (o.ja !== true && !u.frage(`${gesamt} Zeile(n) in ${plaene.filter((p) => p.schreiben.length + p.loeschen.length).map((p) => p.tabelle).join(', ')} werden geschrieben. Fortfahren?`)) {
    u.ausgabe('Abgebrochen — nichts geschrieben.')
    return
  }
  // Rückfalldatei: Live-Stand jeder Zeile, die überschrieben oder gelöscht wird, und die Schlüssel neu angelegter Zeilen.
  const zeit = (u.jetzt?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const rueckfall = `wiederherstellung-${zeit}-rueckfall.ndjson`
  const zeilen: string[] = []
  for (const p of plaene) {
    const geaendert = new Set(p.schreiben.map((s) => schluesselWert(s, p.schluessel)))
    for (const g of p.vergleich.geaendert) if (geaendert.has(g.schluessel)) zeilen.push(JSON.stringify({ tabelle: p.tabelle, art: 'vorher', zeile: g.live }))
    for (const n of p.vergleich.neu) zeilen.push(JSON.stringify({ tabelle: p.tabelle, art: 'neu', schluessel: Object.fromEntries(p.schluessel.map((s) => [s, n[s]])) }))
    for (const l of p.loeschen) zeilen.push(JSON.stringify({ tabelle: p.tabelle, art: 'vorher', zeile: l }))
  }
  await u.schreibeDatei(rueckfall, zeilen.join('\n') + '\n')
  u.ausgabe(`\nRückfalldatei geschrieben: ${rueckfall} (umkehren mit: rueckgaengig --datei ${rueckfall})`)
  const ohneAusloeser = o['mit-ausloesern'] !== true
  for (const p of plaene) {
    if (p.schreiben.length) {
      const n = await z.einspielen(p.tabelle, p.schreiben, p.spalten, ohneAusloeser)
      u.ausgabe(`  ${p.tabelle}: ${n} Zeile(n) eingespielt`)
    }
    if (p.loeschen.length) {
      await z.loeschen(p.tabelle, p.schluessel[0], p.loeschen.map((l) => l[p.schluessel[0]]))
      u.ausgabe(`  ${p.tabelle}: ${p.loeschen.length} Zeile(n) gelöscht`)
    }
  }
  u.ausgabe('Fertig. Offene CRM-Fenster bitte neu laden (sonst schreibt ein altes Fenster seinen Stand zurück).')
}

// ---------------------------------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------------------------------

async function befehlTabelle(z: Zugang, u: Umgebung, o: Optionen): Promise<void> {
  const tabelle = text(o, 'tabelle')
  if (!tabelle) throw new Error('--tabelle fehlt.')
  const paket = await ladeGewaehltesPaket(z, u, o)
  const eintrag = paket.manifest.tabellen.find((t) => t.tabelle === tabelle)
  if (!eintrag) throw new Error(`Tabelle ${tabelle} ist nicht in der Sicherung ${paket.manifest.name}.`)
  const schema = (await z.schema()).get(tabelle)
  if (!schema) throw new Error(`Tabelle ${tabelle} gibt es live nicht (mehr) — erst die Tabelle anlegen lassen.`)
  if (schema.schluessel.length === 0) throw new Error(`Tabelle ${tabelle} hat keinen Primärschlüssel — nur von Hand einspielbar.`)
  if (stabil(schema.schluessel) !== stabil(eintrag.schluessel)) throw new Error(`Primärschlüssel hat sich geändert (Sicherung: ${eintrag.schluessel.join(', ')}, live: ${schema.schluessel.join(', ')}).`)
  let sicherung = (await paket.zeilen(tabelle))!
  const id = text(o, 'id')
  let filter: string | null = null
  if (id) {
    if (schema.schluessel.length !== 1) throw new Error('--id geht nur bei einspaltigem Primärschlüssel.')
    sicherung = sicherung.filter((s) => String(s[schema.schluessel[0]]) === id)
    if (sicherung.length === 0) throw new Error(`Zeile ${id} ist nicht in der Sicherung.`)
    filter = inFilter(schema.schluessel[0], [id])
  }
  if (o.loeschen === true && id) throw new Error('--loeschen und --id zusammen ergeben keinen Sinn.')
  if (o.loeschen === true && schema.schluessel.length !== 1) throw new Error('--loeschen geht nur bei einspaltigem Primärschlüssel.')
  const spalten = liste(o, 'spalten')
  const fremd = spalten?.filter((s) => !schema.spalten.includes(s)) ?? []
  if (fremd.length) throw new Error(`Unbekannte Spalte(n): ${fremd.join(', ')}`)
  const live = await z.zeilen(tabelle, filter, schema.schluessel)
  const plan = planeTabelle(tabelle, schema.schluessel, sicherung, live, { spalten, loeschen: o.loeschen === true })
  const weg = eintrag.spalten.filter((s) => !schema.spalten.includes(s))
  if (weg.length) plan.hinweise.push(`Spalten gibt es live nicht mehr, sie werden ausgelassen: ${weg.join(', ')}`)
  if (eintrag.filter) plan.hinweise.push(`Die Sicherung enthält nur einen Ausschnitt (${eintrag.filter}) — ältere Zeilen fehlen dort absichtlich; --loeschen würde sie löschen.`)
  if (eintrag.filter && o.loeschen === true) throw new Error(`--loeschen ist bei ${tabelle} gesperrt (Sicherung enthält nur ${eintrag.filter}).`)
  u.ausgabe(`Sicherung ${paket.manifest.name}: ${tabelle} mit ${eintrag.zeilen} Zeilen; live ${live.length}${id ? ' (gefiltert)' : ''}.`)
  zeigePlan(u, plan, o.werte === true)
  await fuehreAus(z, u, [plan], o)
}

async function befehlAkte(z: Zugang, u: Umgebung, o: Optionen): Promise<void> {
  const id = text(o, 'id')
  if (!id) throw new Error('--id (Kunden-ID der Akte) fehlt.')
  const paket = await ladeGewaehltesPaket(z, u, o)
  const schema = await z.schema()
  const nurTabellen = liste(o, 'tabellen')
  const spalten = liste(o, 'spalten')
  const kandidaten = paket.manifest.tabellen
    .map((t) => ({ t, spalte: akteSpalte(t.tabelle, t.spalten) }))
    .filter((x) => x.spalte && (x.t.tabelle === 'kunden' || (o['nur-akte'] !== true && (!nurTabellen || nurTabellen.includes(x.t.tabelle)))))
  const reihenfolge = akteReihenfolge(kandidaten.map((k) => k.t.tabelle))
  const plaene: TabellenPlan[] = []
  let akteGefunden = false
  for (const tabelle of reihenfolge) {
    const k = kandidaten.find((x) => x.t.tabelle === tabelle)!
    const spalte = k.spalte!
    const live = schema.get(tabelle)
    if (!live) {
      u.ausgabe(`\nTabelle ${tabelle}: gibt es live nicht mehr — übersprungen.`)
      continue
    }
    if (live.schluessel.length === 0 || stabil(live.schluessel) !== stabil(k.t.schluessel)) {
      u.ausgabe(`\nTabelle ${tabelle}: Primärschlüssel fehlt oder hat sich geändert — übersprungen (von Hand prüfen).`)
      continue
    }
    const sicherung = ((await paket.zeilen(tabelle)) ?? []).filter((s) => s[spalte] !== null && s[spalte] !== undefined && String(s[spalte]) === id)
    if (tabelle === 'kunden') {
      akteGefunden = sicherung.length > 0
      if (!akteGefunden) throw new Error(`Akte ${id} ist nicht in der Sicherung ${paket.manifest.name}.`)
      u.ausgabe(`Akte ${id}: ${String(sicherung[0].firma ?? sicherung[0].ansprechpartner ?? '')} (Bereich ${String(sicherung[0].bereich ?? '—')})`)
    }
    let liveZeilen = await z.zeilen(tabelle, inFilter(spalte, [id]), live.schluessel)
    if (sicherung.length === 0 && liveZeilen.length === 0) continue
    liveZeilen = await ergaenzeUeberSchluessel(z, tabelle, live.schluessel, sicherung, liveZeilen)
    const plan = planeTabelle(tabelle, live.schluessel, sicherung, liveZeilen, {
      spalten: tabelle === 'kunden' ? spalten : null,
      loeschen: false,
      akte: { spalte, id, auchUmgehaengte: o['auch-umgehaengte'] === true },
    })
    const weg = k.t.spalten.filter((s) => !live.spalten.includes(s))
    if (weg.length) plan.hinweise.push(`Spalten gibt es live nicht mehr, sie werden ausgelassen: ${weg.join(', ')}`)
    plaene.push(plan)
  }
  if (spalten) {
    const fremd = spalten.filter((s) => !(schema.get('kunden')?.spalten ?? []).includes(s))
    if (fremd.length) throw new Error(`Unbekannte Spalte(n) in kunden: ${fremd.join(', ')}`)
  }
  for (const p of plaene) zeigePlan(u, p, o.werte === true)
  if (plaene.some((p) => p.vergleich.nurLive.length)) u.ausgabe('\nZeilen „nur live“ sind seit der Sicherung dazugekommen und bleiben, wie sie sind.')
  await fuehreAus(z, u, plaene, o)
}

async function befehlRueckgaengig(z: Zugang, u: Umgebung, o: Optionen): Promise<void> {
  const datei = text(o, 'datei')
  if (!datei) throw new Error('--datei fehlt.')
  const eintraege = new TextDecoder().decode(await u.leseDatei(datei)).split('\n').filter((x) => x.trim()).map((x) => JSON.parse(x) as { tabelle: string; art: 'vorher' | 'neu'; zeile?: Zeile; schluessel?: Zeile })
  const schema = await z.schema()
  const jeTabelle = new Map<string, { vorher: Zeile[]; neu: Zeile[] }>()
  for (const e of eintraege) {
    const t = jeTabelle.get(e.tabelle) ?? { vorher: [], neu: [] }
    if (e.art === 'vorher' && e.zeile) t.vorher.push(e.zeile)
    if (e.art === 'neu' && e.schluessel) t.neu.push(e.schluessel)
    jeTabelle.set(e.tabelle, t)
  }
  for (const [tabelle, t] of jeTabelle) {
    const s = schema.get(tabelle)
    u.ausgabe(`${tabelle}: ${t.vorher.length} Zeile(n) auf den Stand vor dem Einspielen setzen, ${t.neu.length} damals neu angelegte löschen`)
    if (t.neu.length && (!s || s.schluessel.length !== 1)) throw new Error(`${tabelle}: neu angelegte Zeilen lassen sich nur bei einspaltigem Schlüssel löschen.`)
  }
  if (o.ausfuehren !== true) {
    u.ausgabe('\nPROBELAUF — nichts geschrieben. Zum Umkehren mit --ausfuehren wiederholen.')
    return
  }
  if (o.ja !== true && !u.frage('Einspielen umkehren?')) {
    u.ausgabe('Abgebrochen — nichts geschrieben.')
    return
  }
  const ohneAusloeser = o['mit-ausloesern'] !== true
  // Erst löschen (abhängige Tabellen vor kunden), dann den alten Stand zurück (kunden zuerst).
  for (const tabelle of akteReihenfolge([...jeTabelle.keys()]).reverse()) {
    const t = jeTabelle.get(tabelle)!
    const k = schema.get(tabelle)!.schluessel[0]
    if (t.neu.length) await z.loeschen(tabelle, k, t.neu.map((x) => x[k]))
  }
  for (const tabelle of akteReihenfolge([...jeTabelle.keys()])) {
    const t = jeTabelle.get(tabelle)!
    if (t.vorher.length) await z.einspielen(tabelle, t.vorher, null, ohneAusloeser)
    u.ausgabe(`  ${tabelle}: umgekehrt`)
  }
  u.ausgabe('Fertig.')
}

export async function hauptprogramm(args: string[], u: Umgebung): Promise<number> {
  const { befehl, o } = leseArgumente(args)
  const z = new Zugang(u)
  switch (befehl) {
    case 'liste': {
      const alle = await z.sicherungen()
      if (alle.length === 0) u.ausgabe('Noch keine Sicherung im Eimer.')
      for (const s of alle) u.ausgabe(`${s.name}   ${nameAlsText(s.name).padEnd(24)} ${groesseText(s.bytes)}`)
      return 0
    }
    case 'zeige': {
      const p = await ladeGewaehltesPaket(z, u, o)
      const m = p.manifest
      u.ausgabe(`Sicherung ${m.name} (${m.art}${m.von ? `, von ${m.von}` : ''}), erstellt ${m.erstellt}, Dauer ${Math.round(m.dauerMs / 1000)} s`)
      u.ausgabe(`${m.tabellen.length} Tabellen, ${m.gesamtZeilen} Zeilen; Ablage: ${m.dateien.anzahl} Dateien, ${groesseText(m.dateien.bytes)} (nicht enthalten, nur die Liste)`)
      for (const t of m.tabellen) u.ausgabe(`  ${t.tabelle.padEnd(34)} ${String(t.zeilen).padStart(7)} Zeilen  ${groesseText(t.bytes).padStart(9)}${t.filter ? `  (${t.filter})` : ''}`)
      for (const a of m.ausgelassen) u.ausgabe(`  ausgelassen: ${a.tabelle} — ${a.grund}`)
      for (const w of m.warnungen) u.ausgabe(`  Hinweis: ${w}`)
      return 0
    }
    case 'tabelle':
      await befehlTabelle(z, u, o)
      return 0
    case 'akte':
      await befehlAkte(z, u, o)
      return 0
    case 'rueckgaengig':
      await befehlRueckgaengig(z, u, o)
      return 0
    default: {
      u.ausgabe('Befehle: liste | zeige | tabelle --tabelle T | akte --id KUNDEN_ID | rueckgaengig --datei D   (Probelauf ohne --ausfuehren)')
      u.ausgabe('Ausführliche Beschreibung: Kopf dieser Datei.')
      return befehl === 'hilfe' ? 0 : 1
    }
  }
}

if (import.meta.main) {
  const url = Deno.env.get('SUPABASE_URL')
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !schluessel) {
    console.error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein (siehe Kopf dieser Datei).')
    Deno.exit(2)
  }
  try {
    const code = await hauptprogramm(Deno.args, {
      url: url.replace(/\/$/, ''),
      schluessel,
      ausgabe: (z) => console.log(z),
      frage: (t) => (Deno.stdin.isTerminal() ? (prompt(`${t} Zum Bestätigen JA eintippen:`) ?? '').trim() === 'JA' : false),
      schreibeDatei: (p, i) => Deno.writeTextFile(p, i),
      leseDatei: (p) => Deno.readFile(p),
    })
    Deno.exit(code)
  } catch (err) {
    console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    Deno.exit(1)
  }
}
