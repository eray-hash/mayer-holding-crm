// „Jetzt / als Nächstes“ auf der Startseite: der laufende oder nächste Termin des Mitarbeiters (eigene und
// solche, bei denen er Teilnehmer ist) samt verknüpfter Akte. Die Akte findet findeBezug aus dem Termin-
// Briefing (supabase/functions/_shared/terminBriefingKern.ts) — dieselben Regeln wie Briefing und
// Nachfrage nach Terminen. Gelesen wird mit dem eigenen Login, der Zeilenschutz der Datenbank gilt also:
// Akten aus Bereichen, die der Mitarbeiter nicht sehen darf, tauchen nicht auf.

import { supabase } from '../lib/supabaseClient'
import { findeBezug, istAbgesagterTitel, kandidatenLader, TERMIN_SPALTEN, type Bezug, type BriefingTermin } from '../../supabase/functions/_shared/terminBriefingKern.ts'

export type TerminVorschlag = {
  termin: BriefingTermin
  laeuftGerade: boolean
  bezug: Bezug | null
  /** Anzeigename der Akte bzw. des Objekts */
  akteName: string | null
}

/** Wie weit nach vorn geschaut wird. */
const VORAUS_TAGE = 7

export function istBeteiligt(t: Pick<BriefingTermin, 'besitzer_email' | 'teilnehmer'>, email: string): boolean {
  const ich = email.trim().toLowerCase()
  return String(t.besitzer_email ?? '').toLowerCase() === ich || (t.teilnehmer ?? []).some((x) => String(x).toLowerCase() === ich)
}

/** Wählt aus den Terminen den laufenden, sonst den nächsten (ganztägige nur, wenn nichts anderes da ist). */
export function waehleTermin(termine: BriefingTermin[], email: string, jetzt: Date): BriefingTermin | null {
  const t = jetzt.getTime()
  const passend = termine
    .filter((x) => istBeteiligt(x, email) && !istAbgesagterTitel(x.titel ?? '') && new Date(x.ende).getTime() > t)
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
  const mitUhrzeit = passend.filter((x) => !x.ganztags)
  const liste = mitUhrzeit.length > 0 ? mitUhrzeit : passend
  return liste.find((x) => new Date(x.beginn).getTime() <= t) ?? liste[0] ?? null
}

export async function ladeTerminVorschlag(email: string): Promise<TerminVorschlag | null> {
  if (!supabase) return null
  const jetzt = new Date()
  const bis = new Date(jetzt.getTime() + VORAUS_TAGE * 24 * 3600_000)
  const { data, error } = await supabase
    .from('termine')
    .select(TERMIN_SPALTEN)
    .gt('ende', jetzt.toISOString())
    .lt('beginn', bis.toISOString())
    .order('beginn')
    .limit(200)
  if (error) throw new Error(error.message)
  const termin = waehleTermin((data ?? []) as unknown as BriefingTermin[], email, jetzt)
  if (!termin) return null

  const { data: team } = await supabase.from('mitarbeiter').select('email, name')
  const teamListe = (team ?? []) as { email: string; name: string | null }[]
  let bezug: Bezug | null = null
  try {
    bezug = await findeBezug(supabase, termin, {
      team: new Set(teamListe.map((m) => String(m.email).toLowerCase())),
      teamNamen: teamListe.map((m) => m.name ?? '').filter(Boolean),
      lader: kandidatenLader(supabase),
    })
  } catch {
    bezug = null
  }
  let akteName: string | null = null
  if (bezug?.art === 'kunde') {
    const { data: k } = await supabase.from('kunden').select('firma, ansprechpartner').eq('id', bezug.id).maybeSingle()
    if (k) akteName = [k.ansprechpartner, k.firma].filter(Boolean).join(' · ') || null
    else bezug = null // nicht sichtbar
  } else if (bezug?.art === 'objekt') {
    const { data: o } = await supabase.from('objekte').select('bezeichnung').eq('id', bezug.id).maybeSingle()
    if (o) akteName = String(o.bezeichnung ?? '') || null
    else bezug = null
  }
  return { termin, laeuftGerade: new Date(termin.beginn).getTime() <= jetzt.getTime(), bezug, akteName }
}
