// Neuanfragen sichten (22.11.2026): Daten und Regeln ohne Oberfläche — gemeinsam für die Seite
// (Sichten.tsx) und den Hinweis auf „Heute“ (NeuanfragenHinweis.tsx).
//
// Eine Neuanfrage ist eine Akte in der ersten Stufe ihres Bereichs: Beratung „Lead / Neuanfrage“, sonst
// die erste Stufe des Hauptpfads (Erstkontakt bzw. Interessent) — und „lead“ in jedem Bereich, weil die
// automatische Anlage aus Mails diesen Status überall setzt. Ob sie noch zu sichten ist, steht in
// kunden.triage_vorschlag (nur vom Server geschrieben, hier nur gelesen; Kern: _shared/neuanfrageKern.ts).
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { call } from '../../lib/emailGateway'
import { supabase } from '../../lib/supabaseClient'
import { today } from '../../lib/dates'
import { STATUS_NETZ } from '../../lib/checkliste'
import { istSammelakte } from '../../data/sammelakten'
import type { Kunde, KundeBereich } from '../../types'
import {
  angelegtAm, herkunftVon, lageVon, leseTriage, leseVorschlag, type ArchivGrund, type EntscheidungsArt, type HerkunftArt,
  type Lage, type TriageDaten, type TriageVorschlag,
} from '../../../supabase/functions/_shared/neuanfrageKern.ts'

export type { ArchivGrund, HerkunftArt, Lage, TriageDaten, TriageVorschlag }

export type Neuanfrage = {
  kunde: Kunde
  bereich: KundeBereich
  bereichLabel: string
  angelegt: string
  herkunft: HerkunftArt
  triage: TriageDaten
  lage: Lage
}

// ---------- Stufen je Bereich ----------

export function ersteStufe(bereich: KundeBereich): string {
  return STATUS_NETZ[bereich]?.pfad[0] ?? 'lead'
}

export function istErsteStufe(bereich: KundeBereich, status: string): boolean {
  return status === 'lead' || status === ersteStufe(bereich)
}

export function statusLabel(bereich: KundeBereich, status: string): string {
  return STATUS_NETZ[bereich]?.status[status]?.label ?? status
}

/** Status nach „qualifiziert“: Beratung → Erstkontakt; sonst die erste Stufe (aus „lead“) bzw. unverändert. */
export function zielQualifiziert(bereich: KundeBereich, status: string): string {
  const netz = STATUS_NETZ[bereich]
  if (!netz) return status
  if (bereich === 'beratung') return netz.status.erstkontakt ? 'erstkontakt' : netz.pfad[1] ?? status
  return status === 'lead' ? netz.pfad[0] : status
}

/** Status nach „archivieren“: Spam / kein Kundenanliegen → „nicht qualifiziert“, wenn es das gibt; sonst „verloren“. */
export function zielArchiv(bereich: KundeBereich, grund: ArchivGrund): string {
  const netz = STATUS_NETZ[bereich]
  if (!netz) return 'verloren'
  if (grund !== 'kein_interesse' && netz.status.nicht_qualifiziert) return 'nicht_qualifiziert'
  if (netz.status.verloren) return 'verloren'
  return Object.values(netz.status).find((s) => s.isTerminal)?.id ?? 'verloren'
}

// ---------- Gespeicherter Stand (kunden.triage_vorschlag) ----------

let zwischenspeicher: { am: number; daten: Map<string, TriageDaten>; spalteFehlt: boolean } | null = null
const hoerer = new Set<() => void>()

/** Alle gespeicherten Sichtungs-Stände der sichtbaren Akten (Zeilenregeln der Datenbank), seitenweise. */
export async function ladeTriageDaten(erzwingen = false): Promise<{ daten: Map<string, TriageDaten>; spalteFehlt: boolean }> {
  if (!erzwingen && zwischenspeicher && Date.now() - zwischenspeicher.am < 60_000) return zwischenspeicher
  const daten = new Map<string, TriageDaten>()
  let spalteFehlt = false
  if (supabase) {
    for (let von = 0; von < 50_000; von += 1000) {
      const { data, error } = await supabase
        .from('kunden')
        .select('id, triage_vorschlag')
        .not('triage_vorschlag', 'is', null)
        .order('id')
        .range(von, von + 999)
      if (error) {
        // Vor dem Einspielen der Spalte: Seite trotzdem nutzbar, nur ohne gespeicherten Stand.
        if (/triage_vorschlag/.test(error.message)) spalteFehlt = true
        else throw new Error(`Gesichtete Neuanfragen ließen sich nicht laden: ${error.message}`)
        break
      }
      const zeilen = (data ?? []) as { id: string; triage_vorschlag: unknown }[]
      for (const z of zeilen) daten.set(z.id, leseTriage(z.triage_vorschlag))
      if (zeilen.length < 1000) break
    }
  }
  zwischenspeicher = { am: Date.now(), daten, spalteFehlt }
  return zwischenspeicher
}

/** Nach einer Antwort des Servers: Stand einer Akte lokal ersetzen (und andere Ansichten benachrichtigen). */
export function merkeTriage(id: string, t: TriageDaten): void {
  if (!zwischenspeicher) zwischenspeicher = { am: Date.now(), daten: new Map(), spalteFehlt: false }
  zwischenspeicher.daten.set(id, t)
  for (const f of hoerer) f()
}

/** Neuanfragen der freigegebenen Bereiche (ohne Privat und Sammelakten) mit ihrer Lage beim Sichten. */
export function useNeuanfragen() {
  const { state } = useApp()
  const { oeffentlicheKundenBereiche } = useBereichsRechte()
  const [triage, setTriage] = useState<Map<string, TriageDaten>>(() => zwischenspeicher?.daten ?? new Map())
  const [spalteFehlt, setSpalteFehlt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [geladen, setGeladen] = useState(!!zwischenspeicher)

  useEffect(() => {
    let aktiv = true
    ladeTriageDaten()
      .then((r) => {
        if (!aktiv) return
        setTriage(new Map(r.daten))
        setSpalteFehlt(r.spalteFehlt)
        setGeladen(true)
      })
      .catch((e) => aktiv && setFehler(e instanceof Error ? e.message : 'Laden fehlgeschlagen.'))
    const f = () => zwischenspeicher && setTriage(new Map(zwischenspeicher.daten))
    hoerer.add(f)
    return () => {
      aktiv = false
      hoerer.delete(f)
    }
  }, [])

  const heute = today()
  const bereichsSchluessel = oeffentlicheKundenBereiche.map((b) => b.id).join()
  const alle: Neuanfrage[] = useMemo(() => {
    const aus: Neuanfrage[] = []
    for (const b of oeffentlicheKundenBereiche) {
      for (const k of b.get(state)) {
        if (istSammelakte(k.id) || !istErsteStufe(b.id, k.status)) continue
        const t = triage.get(k.id) ?? {}
        aus.push({
          kunde: k,
          bereich: b.id,
          bereichLabel: b.label,
          angelegt: angelegtAm(k.activities, k.letzteAktivitaet ?? ''),
          herkunft: herkunftVon(k.activities),
          triage: t,
          lage: lageVon(k.status, t, heute),
        })
      }
    }
    // Neueste zuerst — frische Anfragen sind am wertvollsten.
    return aus.sort((x, y) => y.angelegt.localeCompare(x.angelegt) || x.kunde.firma.localeCompare(y.kunde.firma))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, triage, heute, bereichsSchluessel])

  return { alle, triage, spalteFehlt, fehler, geladen }
}

// ---------- Server (email-gateway, Aktion neuanfrage_einschaetzung) ----------

export type MailKurz = { id: string; von: string; vonName: string; betreff: string; datum: string; ausschnitt: string }
export type DublettenHinweis = { id: string; firma: string; ansprechpartner: string; bereich: KundeBereich; bereichName: string; status: string; punkte: number; gruende: string[] }
export type AkteLage = { mails: number; ersteMail: MailKurz | null; letzteMail: MailKurz | null; dubletten: DublettenHinweis[]; triage: TriageDaten; stand: string }

export async function ladeEinzelheiten(kundeIds: string[]): Promise<Record<string, AkteLage>> {
  const aus: Record<string, AkteLage> = {}
  for (let i = 0; i < kundeIds.length; i += 200) {
    const r = (await call({ action: 'neuanfrage_einschaetzung', modus: 'laden', kundeIds: kundeIds.slice(i, i + 200) })) as { akten?: Record<string, AkteLage> }
    for (const [id, lage] of Object.entries(r.akten ?? {})) {
      aus[id] = { ...lage, triage: leseTriage(lage.triage) }
      merkeTriage(id, aus[id].triage)
    }
  }
  return aus
}

export async function holeEinschaetzungen(kundeIds: string[], neu = false): Promise<{ vorschlaege: Record<string, TriageVorschlag>; offen: number; kiFehler: number; text: string }> {
  const r = (await call({ action: 'neuanfrage_einschaetzung', modus: 'einschaetzen', kundeIds: kundeIds.slice(0, 200), neu })) as {
    vorschlaege?: Record<string, unknown>
    offen?: number
    kiFehler?: number
    text?: string
  }
  const vorschlaege: Record<string, TriageVorschlag> = {}
  for (const [id, roh] of Object.entries(r.vorschlaege ?? {})) {
    const v = leseVorschlag(roh)
    if (!v) continue
    vorschlaege[id] = v
    const alt = zwischenspeicher?.daten.get(id) ?? {}
    merkeTriage(id, { ...alt, vorschlag: v })
  }
  return { vorschlaege, offen: Number(r.offen) || 0, kiFehler: Number(r.kiFehler) || 0, text: String(r.text ?? '') }
}

export async function merkeEntscheidung(
  kundeId: string,
  e: { art: EntscheidungsArt; status: string; grund?: ArchivGrund } | { art: 'spaeter'; bis: string } | { art: 'zuruecksetzen' },
): Promise<TriageDaten> {
  const r = (await call({ action: 'neuanfrage_einschaetzung', modus: 'entscheiden', kundeId, ...e })) as { triage?: unknown }
  const t = leseTriage(r.triage)
  merkeTriage(kundeId, t)
  return t
}
