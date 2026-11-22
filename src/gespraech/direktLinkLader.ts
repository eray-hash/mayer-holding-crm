// Nachschlagen für Direkt-Links (direktLink.ts) mit dem eigenen Login — der Zeilenschutz der Datenbank gilt:
// Termine, Akten und Objekte, die der Mitarbeiter nicht sehen darf, gelten als „nicht gefunden“. Die Akte eines
// Termins findet findeBezug (dieselben Regeln wie Briefing, Nachfrage und „Jetzt / als Nächstes“).

import { supabase } from '../lib/supabaseClient'
import { findeBezug, kandidatenLader, SAMMELAKTEN, TERMIN_SPALTEN, type BriefingTermin } from '../../supabase/functions/_shared/terminBriefingKern.ts'
import type { DirektAkte, DirektLader } from './direktLink'
import { ladeTerminVorschlag } from './termine'

/** So lange vor Beginn gilt ein Termin für die Schnellaktion „Termin aufnehmen“ als „gleich“. */
const GLEICH_MINUTEN = 30

type Fehler = { code?: string; message: string } | null

/** Antwort der Datenbank mit Fehlercode (Zeilenschutz, ungültige Nummer …) = nicht gefunden; ohne Code = kein Netz. */
function pruefe(error: Fehler): 'ok' | 'nicht_gefunden' {
  if (!error) return 'ok'
  if (error.code) return 'nicht_gefunden'
  throw new Error(error.message)
}

function kundeName(k: { firma?: string | null; ansprechpartner?: string | null; email?: string | null }, id: string): string {
  return [k.ansprechpartner, k.firma].filter(Boolean).join(' · ') || k.email || id
}

async function kunde(id: string): Promise<DirektAkte | null> {
  if (!supabase) throw new Error('keine Verbindung')
  if (SAMMELAKTEN.includes(id)) return null
  const { data, error } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, email').eq('id', id).maybeSingle()
  if (pruefe(error) === 'nicht_gefunden' || !data) return null
  return { art: 'kunde', id: String(data.id), bereich: String(data.bereich ?? ''), name: kundeName(data, id) }
}

async function objekt(id: string): Promise<DirektAkte | null> {
  if (!supabase) throw new Error('keine Verbindung')
  const { data, error } = await supabase.from('objekte').select('id, bezeichnung, adresse').eq('id', id).maybeSingle()
  if (pruefe(error) === 'nicht_gefunden' || !data) return null
  return { art: 'objekt', id: String(data.id), name: String(data.bezeichnung || data.adresse || id) }
}

export function direktLader(email: string): DirektLader {
  const termine = new Map<string, BriefingTermin>()
  return {
    async termin(id) {
      if (!supabase) throw new Error('keine Verbindung')
      const { data, error } = await supabase.from('termine').select(TERMIN_SPALTEN).eq('id', id).maybeSingle()
      if (pruefe(error) === 'nicht_gefunden' || !data) return null
      const t = data as unknown as BriefingTermin
      termine.set(t.id, t)
      return { id: t.id, titel: String(t.titel ?? '') }
    },
    async akteZuTermin(id) {
      const t = termine.get(id)
      if (!t || !supabase) return null
      try {
        const { data: team } = await supabase.from('mitarbeiter').select('email, name')
        const liste = (team ?? []) as { email: string; name: string | null }[]
        const bezug = await findeBezug(supabase, t, {
          team: new Set(liste.map((m) => String(m.email).toLowerCase())),
          teamNamen: liste.map((m) => m.name ?? '').filter(Boolean),
          lader: kandidatenLader(supabase),
        })
        if (bezug?.art === 'kunde') return await kunde(bezug.id)
        if (bezug?.art === 'objekt') return await objekt(bezug.id)
        return null
      } catch {
        return null
      }
    },
    kunde,
    objekt,
    async aktuellerTermin() {
      const v = await ladeTerminVorschlag(email)
      if (!v) return null
      const bisBeginn = (new Date(v.termin.beginn).getTime() - Date.now()) / 60000
      if (!v.laeuftGerade && bisBeginn > GLEICH_MINUTEN) return null
      let akte: DirektAkte | null = null
      if (v.bezug?.art === 'kunde') akte = { art: 'kunde', id: v.bezug.id, bereich: v.bezug.bereich, name: v.akteName ?? v.termin.titel }
      else if (v.bezug?.art === 'objekt') akte = { art: 'objekt', id: v.bezug.id, name: v.akteName ?? v.termin.titel }
      return { termin: { id: v.termin.id, titel: String(v.termin.titel ?? '') }, akte }
    },
  }
}
