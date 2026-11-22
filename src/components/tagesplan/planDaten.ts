// Browser-Seite des Tagesplans: To-dos, Termine und Wiedervorlagen in die Form des Planers bringen
// (supabase/functions/_shared/tagesplanKern.ts), Bezüge der To-dos lesen/setzen (Spalte todos.bezug — die
// To-do-Liste des CRM kennt sie noch nicht, deshalb liest die Seite sie selbst), Telefonnummern zu Akte/Objekt.
import { useCallback, useEffect, useState } from 'react'
import type { AppData } from '../../context/AppContext'
import { supabase } from '../../lib/supabaseClient'
import { alleZeilen } from '../../lib/alleZeilen'
import type { Termin } from '../../lib/kalenderDb'
import type { Wiedervorlage } from '../../lib/wiedervorlagen'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import type { Kunde, ToDoEintrag } from '../../types'
import { gehoertZu, type PlanBezug, type PlanTermin, type PlanTodo, type PlanWiedervorlage } from '../../../supabase/functions/_shared/tagesplanKern.ts'
import { alsBezug, type BezugKandidat } from '../../../supabase/functions/_shared/tagesplanBezug.ts'

const zwei = (n: number) => String(n).padStart(2, '0')
const uhr = (d: Date) => `${zwei(d.getHours())}:${zwei(d.getMinutes())}`

/** Offene To-dos der eigenen Liste, die mir gehören (zuständig leer oder ich), für den Planer. */
export function eigeneTodosFuerPlan(todos: ToDoEintrag[], email: string, name: string, bezuege: Map<string, PlanBezug>): PlanTodo[] {
  const ich = email.trim().toLowerCase()
  return todos
    .filter((t) => !t.bereich && (t.besitzerEmail ?? '').toLowerCase() === ich && !(t.erledigtAm ?? '').trim() && gehoertZu(t.zustaendig, name))
    .map((t) => alsPlanTodo(t, bezuege.get(t.id) ?? null))
}

export function alsPlanTodo(t: ToDoEintrag, bezug: PlanBezug | null): PlanTodo {
  return {
    id: t.id,
    aufgabe: t.aufgabe,
    kundeProjekt: t.kundeProjekt ?? null,
    prio: t.prio ?? null,
    unterPrio: t.unterPrio ?? null,
    umsatzWert: t.umsatzWert ?? null,
    geplanteZeit: t.geplanteZeit ?? null,
    erledigenBis: t.erledigenBis ?? null,
    geplanteWiedervorlage: t.geplanteWiedervorlage ?? null,
    erledigtAm: t.erledigtAm ?? null,
    welcheFragen: t.welcheFragen ?? null,
    reihenfolge: t.reihenfolge ?? null,
    bezug,
  }
}

/** Termine des Tages (lokale Zeit = deutsche Zeit) für den Planer — nur eigene und die, bei denen ich Teilnehmer bin. */
export function termineFuerPlan(termine: Termin[], email: string, datum: string): PlanTermin[] {
  const ich = email.trim().toLowerCase()
  const beginnTag = new Date(`${datum}T00:00:00`)
  const endeTag = new Date(beginnTag.getFullYear(), beginnTag.getMonth(), beginnTag.getDate() + 1)
  return termine
    .filter((t) => ich && (t.besitzerEmail.toLowerCase() === ich || t.teilnehmer.some((p) => p.toLowerCase() === ich)))
    .filter((t) => !/^\s*(abgesagt|canceled|cancelled|abgelehnt)\s*:/i.test(t.titel ?? ''))
    .map((t) => {
      const b = new Date(t.beginn)
      const e = new Date(t.ende)
      const beginntHeute = b >= beginnTag
      const endetHeute = e <= endeTag
      const ganztags = t.ganztags || (!beginntHeute && !endetHeute)
      const p: PlanTermin = { id: t.id, titel: t.titel, ganztags, kundeName: t.kundeName ?? null, ort: t.ort || null }
      if (!ganztags) {
        p.von = beginntHeute ? uhr(b) : '00:00'
        p.bis = endetHeute ? uhr(e) : '23:59'
      }
      if (t.kundeId) p.bezug = { art: 'kunde', id: t.kundeId, name: t.kundeName || t.titel, ...(t.kundeBereich ? { bereich: t.kundeBereich } : {}) }
      return p
    })
}

export function alleKunden(state: AppData): Kunde[] {
  return KUNDEN_BEREICHE.filter((b) => b.id !== 'privat').flatMap((b) => b.get(state).map((k) => ({ ...k, bereich: b.id }) as Kunde & { bereich: string }))
}

/** Wiedervorlagen, für die ich verantwortlich bin und die bis zum Tag fällig sind. */
export function wiedervorlagenFuerPlan(liste: Wiedervorlage[], name: string, datum: string, state: AppData): PlanWiedervorlage[] {
  const kunden = new Map(alleKunden(state).map((k) => [k.id, k]))
  return liste
    .filter((w) => !w.erledigtAm && w.faellig <= datum && (w.verantwortlich ?? '').trim() && gehoertZu(w.verantwortlich, name))
    .map((w) => {
      const k = kunden.get(w.kundeId)
      const akteName = k ? (k.firma || k.ansprechpartner || '').trim() || null : null
      return { id: w.id, titel: w.titel, faellig: w.faellig, akteName, bezug: { art: 'kunde' as const, id: w.kundeId, name: akteName ?? w.kundeId, bereich: w.bereich } }
    })
}

/** Kandidaten für die Bezug-Erkennung: Objekte und Immobilien-Kontakte, die ich im CRM sehe. */
export function bezugKandidaten(state: AppData): BezugKandidat[] {
  return [
    ...(state.objekte ?? []).map((o) => ({ art: 'objekt' as const, id: o.id, name: o.bezeichnung || o.adresse || o.id })),
    ...(state.immobilienKunden ?? []).map((k) => ({ art: 'kunde' as const, id: k.id, name: (k.firma || k.ansprechpartner || k.id).trim(), bereich: 'immobilienkunden' })),
  ]
}

export type Telefon = { wer: string; nummer: string }

/** Telefonnummern zu einer Akte/einem Objekt: Akte → telefon; Objekt → Eigentümer, zugewiesener Kontakt. */
export function telefonnummern(bezug: PlanBezug | undefined, state: AppData): Telefon[] {
  if (!bezug) return []
  const raus: Telefon[] = []
  const kunde = (id: string) => alleKunden(state).find((k) => k.id === id)
  if (bezug.art === 'kunde') {
    const k = kunde(bezug.id)
    if (k?.telefon?.trim()) raus.push({ wer: (k.ansprechpartner || k.firma || bezug.name).trim(), nummer: k.telefon.trim() })
  } else {
    const o = (state.objekte ?? []).find((x) => x.id === bezug.id)
    if (o?.eigentuemer?.telefon?.trim()) raus.push({ wer: `Eigentümer ${o.eigentuemer.ansprechpartner || o.eigentuemer.name || ''}`.trim(), nummer: o.eigentuemer.telefon.trim() })
    const zk = o?.zugewiesenerKunde ? kunde(o.zugewiesenerKunde.kundeId) : undefined
    if (zk?.telefon?.trim()) raus.push({ wer: (zk.ansprechpartner || zk.firma).trim(), nummer: zk.telefon.trim() })
  }
  const gesehen = new Set<string>()
  return raus.filter((t) => (gesehen.has(t.nummer) ? false : (gesehen.add(t.nummer), true)))
}

export function telLink(nummer: string): string {
  return `tel:${nummer.replace(/[^\d+]/g, '')}`
}

/** Liegt die Akte/das Objekt im CRM, das ich sehe? (Sonst kein Link, keine Nummer.) */
export function bezugSichtbar(bezug: PlanBezug | undefined, state: AppData): boolean {
  if (!bezug) return false
  return bezug.art === 'objekt' ? (state.objekte ?? []).some((o) => o.id === bezug.id) : alleKunden(state).some((k) => k.id === bezug.id)
}

const AKTE_PFAD: Record<string, string> = {
  beratung: '/beratung/kunden/',
  immobilienkunden: '/immobilien/kunden/',
  erben: '/erben/mandanten/',
  betriebsuebergabe: '/betriebsuebergabe/mandanten/',
  betriebsformen: '/betriebsformen/mandanten/',
  finanzierungen: '/finanzierungen/mandanten/',
  akademie: '/akademie/teilnehmer/',
}

export function bezugPfad(bezug: PlanBezug, state: AppData): string {
  if (bezug.art === 'objekt') return `/immobilien/objekte/${encodeURIComponent(bezug.id)}`
  const bereich = bezug.bereich ?? (alleKunden(state).find((k) => k.id === bezug.id) as (Kunde & { bereich?: string }) | undefined)?.bereich ?? 'beratung'
  return `${AKTE_PFAD[bereich] ?? '/beratung/kunden/'}${encodeURIComponent(bezug.id)}`
}

// ── Bezüge der To-dos (Spalte todos.bezug) ───────────────────────────────────────────────────────

export type BezugStand = {
  bezuege: Map<string, PlanBezug>
  /** false, solange die Spalte fehlt (SQL noch nicht eingespielt) — dann kein Speichern. */
  verfuegbar: boolean
  setze: (todoId: string, bezug: PlanBezug | null) => Promise<string | null>
}

/** Liest die Bezüge der eigenen To-dos (seitenweise) und setzt einzelne. */
export function useTodoBezuege(email: string, aktiv: boolean): BezugStand {
  const [bezuege, setBezuege] = useState<Map<string, PlanBezug>>(() => new Map())
  const [verfuegbar, setVerfuegbar] = useState(false)

  useEffect(() => {
    if (!aktiv || !supabase || !email) return
    let abgebrochen = false
    const client = supabase
    alleZeilen(() => client.from('todos').select('id, bezug').eq('besitzer_email', email).is('bereich', null).not('bezug', 'is', null)).then(({ data, error }) => {
      if (abgebrochen) return
      if (error) {
        setVerfuegbar(false)
        return
      }
      const m = new Map<string, PlanBezug>()
      for (const z of (data ?? []) as { id: string; bezug: unknown }[]) {
        const b = alsBezug(z.bezug)
        if (b) m.set(z.id, b)
      }
      setBezuege(m)
      setVerfuegbar(true)
    })
    return () => {
      abgebrochen = true
    }
  }, [email, aktiv])

  const setze = useCallback(async (todoId: string, bezug: PlanBezug | null): Promise<string | null> => {
    if (!supabase) return 'Keine Verbindung zur Datenbank.'
    const { error } = await supabase.from('todos').update({ bezug }).eq('id', todoId)
    if (error) return error.message
    setBezuege((alt) => {
      const neu = new Map(alt)
      if (bezug) neu.set(todoId, bezug)
      else neu.delete(todoId)
      return neu
    })
    return null
  }, [])

  return { bezuege, verfuegbar, setze }
}
