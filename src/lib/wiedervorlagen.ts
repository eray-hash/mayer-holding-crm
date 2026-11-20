// Wiedervorlagen mit Auslösern (Projekt-Checkliste Stufe 2, 20.11.2026).
//
// Tabelle `wiedervorlagen` (eine Zeile je Wiedervorlage einer Akte) und Katalog `wiedervorlage_regeln`.
// Die automatischen Einträge legt die Datenbank selbst an und schließt sie (Auslöser an kunden,
// kostenvoranschlaege, rechnungen, termine) — egal, ob die Änderung aus dem Browser, vom Assistenten oder
// vom Server kommt. Von Hand angelegte Einträge haben quelle 'hand'.
//
// Die bisherige Wiedervorlage der Akte (kunden.follow_up, „Follow-up“) bleibt unverändert bestehen.
// Zugriff: wie die Akte (Bereichsrechte in der Datenbank); private Kontakte haben keine Wiedervorlagen.
import { supabase } from './supabaseClient'
import type { KundeBereich } from '../types'

export type Wiedervorlage = {
  id: string
  kundeId: string
  bereich: KundeBereich
  regel?: string
  titel: string
  notiz?: string
  /** JJJJ-MM-TT */
  faellig: string
  verantwortlich?: string
  quelle: 'hand' | 'regel'
  erledigtAm?: string
  erledigtVon?: string
  erledigtGrund?: string
  erstelltAm: string
  erstelltVon?: string
}

export type WiedervorlageRegel = {
  id: string
  /** undefined = jeder Bereich */
  bereich?: KundeBereich
  ausloeser: string
  titel: string
  tage: number
  schliesst: string[]
  sortierung: number
}

function client() {
  if (!supabase) throw new Error('Keine Verbindung zur Datenbank.')
  return supabase
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ausZeile(z: any): Wiedervorlage {
  return {
    id: z.id,
    kundeId: z.kunde_id,
    bereich: z.bereich,
    regel: z.regel ?? undefined,
    titel: z.titel,
    notiz: z.notiz ?? undefined,
    faellig: String(z.faellig).slice(0, 10),
    verantwortlich: z.verantwortlich ?? undefined,
    quelle: z.quelle === 'regel' ? 'regel' : 'hand',
    erledigtAm: z.erledigt_am ?? undefined,
    erledigtVon: z.erledigt_von ?? undefined,
    erledigtGrund: z.erledigt_grund ?? undefined,
    erstelltAm: z.erstellt_am,
    erstelltVon: z.erstellt_von ?? undefined,
  }
}

function fehler(e: { message?: string } | null): Error {
  const m = e?.message ?? ''
  if (/row-level security|permission denied/i.test(m)) return new Error('Für diesen Bereich hast du keine Berechtigung.')
  if (/privat/i.test(m)) return new Error('Private Kontakte haben keine Wiedervorlagen.')
  return new Error(m ? `Wiedervorlage ließ sich nicht speichern: ${m}` : 'Wiedervorlage ließ sich nicht speichern.')
}

/** Alle offenen Wiedervorlagen, die der Nutzer sehen darf (Datenbank filtert nach Bereichsrechten). */
export async function ladeOffeneWiedervorlagen(): Promise<Wiedervorlage[]> {
  const { data, error } = await client().from('wiedervorlagen').select('*').is('erledigt_am', null).order('faellig', { ascending: true }).limit(5000)
  if (error) throw fehler(error)
  return (data ?? []).map(ausZeile)
}

/** Offene und die zuletzt erledigten Wiedervorlagen einer Akte (offene zuerst, nach Fälligkeit). */
export async function ladeWiedervorlagenFuerKunde(kundeId: string, erledigteAnzahl = 10): Promise<Wiedervorlage[]> {
  const [offen, erledigt] = await Promise.all([
    client().from('wiedervorlagen').select('*').eq('kunde_id', kundeId).is('erledigt_am', null).order('faellig', { ascending: true }),
    client().from('wiedervorlagen').select('*').eq('kunde_id', kundeId).not('erledigt_am', 'is', null).order('erledigt_am', { ascending: false }).limit(erledigteAnzahl),
  ])
  if (offen.error) throw fehler(offen.error)
  if (erledigt.error) throw fehler(erledigt.error)
  return [...(offen.data ?? []), ...(erledigt.data ?? [])].map(ausZeile)
}

let regelSpeicher: Promise<WiedervorlageRegel[]> | null = null
/** Katalog der Regeln (einmal je Fenster geladen). */
export function ladeRegeln(): Promise<WiedervorlageRegel[]> {
  if (!regelSpeicher) {
    regelSpeicher = Promise.resolve(
      client().from('wiedervorlage_regeln').select('*').eq('aktiv', true).order('sortierung', { ascending: true }),
    ).then(({ data, error }) => {
      if (error) {
        regelSpeicher = null
        throw fehler(error)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        id: r.id,
        bereich: r.bereich ?? undefined,
        ausloeser: r.ausloeser,
        titel: r.titel,
        tage: r.tage,
        schliesst: r.schliesst ?? [],
        sortierung: r.sortierung,
      }))
    })
  }
  return regelSpeicher
}

/** Regeln, die für einen Bereich in Frage kommen (Bereichsregeln zuerst, dann allgemeine), ohne doppelte Titel. */
export function regelnFuer(regeln: WiedervorlageRegel[], bereich: KundeBereich): WiedervorlageRegel[] {
  const passend = [...regeln.filter((r) => r.bereich === bereich), ...regeln.filter((r) => !r.bereich)]
  const gesehen = new Set<string>()
  return passend.filter((r) => (gesehen.has(r.titel) ? false : (gesehen.add(r.titel), true)))
}

/** Text, wodurch eine Regel ausgelöst wird (für Erklärungen in der Oberfläche). */
export function ausloeserText(ausloeser: string, statusLabel?: (id: string) => string | undefined): string {
  const [art, wert] = ausloeser.split(':')
  if (art === 'status') return `Stand „${statusLabel?.(wert) ?? wert}“`
  const ereignisse: Record<string, string> = {
    unterlagen_angefordert: 'Unterlagen angefordert',
    unterlagen_eingegangen: 'Unterlagen eingegangen',
    angebot: 'Kostenvoranschlag angelegt',
    rechnung: 'Rechnung versendet',
    termin: 'Termin im Kalender',
  }
  return ereignisse[wert] ?? wert
}

export async function legeWiedervorlageAn(e: {
  kundeId: string
  bereich: KundeBereich
  titel: string
  faellig: string
  notiz?: string
  regel?: string
  verantwortlich?: string
  von: string
}): Promise<Wiedervorlage> {
  if (e.bereich === 'privat') throw new Error('Private Kontakte haben keine Wiedervorlagen.')
  const { data, error } = await client()
    .from('wiedervorlagen')
    .insert({
      kunde_id: e.kundeId,
      bereich: e.bereich,
      titel: e.titel.trim(),
      faellig: e.faellig,
      notiz: e.notiz?.trim() || null,
      // Von Hand gewählte Katalog-Einträge behalten den Verweis, damit sie sich ebenfalls von selbst erledigen.
      regel: e.regel ?? null,
      verantwortlich: e.verantwortlich || null,
      quelle: 'hand',
      erstellt_von: e.von,
    })
    .select('*')
    .single()
  if (error) {
    if (/wiedervorlagen_regel_offen|duplicate key/i.test(error.message)) throw new Error('Diese Wiedervorlage ist für die Akte schon offen.')
    throw fehler(error)
  }
  return ausZeile(data)
}

export async function erledigeWiedervorlage(id: string, von: string): Promise<void> {
  const { error } = await client().from('wiedervorlagen').update({ erledigt_am: new Date().toISOString(), erledigt_von: von, erledigt_grund: null }).eq('id', id)
  if (error) throw fehler(error)
}

export async function oeffneWiedervorlageWieder(id: string): Promise<void> {
  const { error } = await client().from('wiedervorlagen').update({ erledigt_am: null, erledigt_von: null, erledigt_grund: null }).eq('id', id)
  if (error) {
    if (/wiedervorlagen_regel_offen|duplicate key/i.test(error.message)) throw new Error('Dieselbe Wiedervorlage ist schon wieder offen.')
    throw fehler(error)
  }
}

export async function verschiebeWiedervorlage(id: string, faellig: string): Promise<void> {
  const { error } = await client().from('wiedervorlagen').update({ faellig }).eq('id', id)
  if (error) throw fehler(error)
}

export async function loescheWiedervorlage(id: string): Promise<void> {
  const { error } = await client().from('wiedervorlagen').delete().eq('id', id)
  if (error) throw fehler(error)
}

/** Offene Wiedervorlagen je Akte (für Listen). */
export function jeKunde(liste: Wiedervorlage[]): Map<string, Wiedervorlage[]> {
  const m = new Map<string, Wiedervorlage[]>()
  for (const w of liste) if (!w.erledigtAm) m.set(w.kundeId, [...(m.get(w.kundeId) ?? []), w])
  for (const l of m.values()) l.sort((a, b) => a.faellig.localeCompare(b.faellig))
  return m
}
