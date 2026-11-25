// Werkzeug aktivitaet_aendern: einen Verlaufseintrag (activities) einer Kundenakte ODER einer Objektakte korrigieren
// oder löschen (Wunsch 25.11.2026: Der Assistent konnte eine falsche Notiz in einer Objektakte nicht löschen, nur
// eine Korrektur ergänzen; bis dahin ging aktivitaet_aendern nur für Kundenakten).
//
// Regeln (für Kunden- und Objektakten gleich):
//   - Nur eigene Einträge (user = Name des Mitarbeiters) — die Geschäftsführung/Admin darf alle.
//   - Löschen erst nach ausdrücklicher Bestätigung in der nächsten Nachricht (wie kunde_loeschen: state.loesch_anfrage,
//     Schlüssel „eintrag:<tabelle>:<akte>:<eintrag>“, gilt 10 Minuten und nur für die direkt folgende Nachricht).
//     Statt des Eintrags bleibt ein Vermerk ohne Inhalt: „Verlaufseintrag vom … gelöscht von …“.
//   - Ändern: neuer Text, dazu bearbeitet_von/bearbeitet_am am Eintrag.
//   - Feldweise: activities wird unmittelbar vor dem Schreiben frisch gelesen, geschrieben wird nur activities
//     (Objekte zusätzlich updated_at) — nie die ganze Zeile aus einem älteren Stand.
import { darfAkte, darfObjekt, istFremdePrivatakte, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type LoeschAnfrage = { kunde_id: string; name: string; z: string }

export type EintragKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  heute: string
  protokolliere: (t: string) => void
  vorherigeAnfrage?: LoeschAnfrage
  setzeAnfrage: (a: LoeschAnfrage) => void
}

type Eintrag = { id?: string; date?: string; text?: string; user?: string; [k: string]: unknown }

const GUELTIG_MS = 10 * 60 * 1000

function deDatum(iso?: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

function kurz(s: unknown, max = 100): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)} …` : t
}

function istGf(m: RechteMitarbeiter): boolean {
  return m.nurPrivat !== true && (m.rolle === 'geschaeftsfuehrung' || !!m.ist_admin)
}

/** Eigener Eintrag (Name gleich, ohne Groß/klein) oder Geschäftsführung/Admin. */
export function darfEintragAendern(m: RechteMitarbeiter & { name: string }, e: Eintrag): boolean {
  if (istGf(m)) return true
  return !!m.name && String(e.user ?? '').trim().toLowerCase() === m.name.trim().toLowerCase()
}

function zufallsId(): string {
  return `act_${crypto.randomUUID().slice(0, 12)}`
}

type Akte = { tabelle: 'kunden' | 'objekte'; id: string; name: string }

/** Lädt die Akte (Rechte wie beim Lesen) und liefert Tabelle, ID und Anzeigenamen — oder einen Fehlertext. */
async function ladeAkte(supabase: Supa, m: RechteMitarbeiter & { name: string }, input: { kunde_id?: unknown; objekt_id?: unknown }): Promise<Akte | string> {
  const objektId = String(input?.objekt_id ?? '').trim()
  if (objektId) {
    const { data, error } = await supabase.from('objekte').select('id, bezeichnung, adresse, privat_besitzer').eq('id', objektId).maybeSingle()
    if (error) return `Fehler beim Laden des Objekts: ${error.message}`
    if (!data || istUnsichtbaresObjekt(m, data)) return 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
    if (!darfObjekt(m, data)) return nichtFreigegeben('immobilien', m.name)
    return { tabelle: 'objekte', id: data.id, name: [data.bezeichnung, data.adresse].filter(Boolean).join(', ') || data.id }
  }
  const kundeId = String(input?.kunde_id ?? '').trim()
  if (!kundeId) return 'Fehler: kunde_id (Kundenakte) oder objekt_id (Objektakte) angeben.'
  const { data, error } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (error) return `Fehler beim Laden der Akte: ${error.message}`
  if (!data || istFremdePrivatakte(m, data)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
  if (!darfAkte(m, data)) return nichtFreigegeben(data.bereich, m.name)
  return { tabelle: 'kunden', id: data.id, name: data.firma || data.ansprechpartner || data.id }
}

// deno-lint-ignore no-explicit-any
export async function verlaufEintragAendern(input: any, k: EintragKontext): Promise<string> {
  const { supabase, mitarbeiter, heute, protokolliere } = k
  const akte = await ladeAkte(supabase, mitarbeiter, input ?? {})
  if (typeof akte === 'string') return akte
  const eintragId = String(input?.aktivitaet_id ?? '').trim()
  if (!eintragId) return `Fehler: aktivitaet_id fehlt. Sie steht in ${akte.tabelle === 'objekte' ? 'objektakte_lesen' : 'kundenakte_lesen'} hinter jedem Eintrag.`
  const loeschen = input?.loeschen === true
  const neuerText = String(input?.neuer_text ?? '').trim()
  if (!loeschen && !neuerText) return 'Fehler: neuer_text oder loeschen=true angeben.'

  // Frisch lesen — nur activities.
  const { data: frisch, error: lesefehler } = await supabase.from(akte.tabelle).select('activities').eq('id', akte.id).maybeSingle()
  if (lesefehler) return `Fehler beim Lesen des Verlaufs: ${lesefehler.message}`
  const liste: Eintrag[] = Array.isArray(frisch?.activities) ? frisch.activities : []
  const eintrag = liste.find((a) => a && a.id === eintragId)
  const lesen = akte.tabelle === 'objekte' ? 'objektakte_lesen' : 'kundenakte_lesen'
  if (!eintrag) return `Fehler: Diesen Eintrag gibt es in der Akte nicht (mehr). Lies die Akte neu (${lesen}).`
  if (!darfEintragAendern(mitarbeiter, eintrag)) {
    return `Nicht erlaubt: Der Eintrag stammt von ${eintrag.user || 'jemand anderem'}. Ändern oder löschen darf man nur eigene Einträge; alle darf die Geschäftsführung. Biete an, eine Korrektur als neuen Eintrag zu ergänzen oder die Geschäftsführung zu bitten.`
  }

  const schreibe = async (activities: Eintrag[]) => {
    const patch: Record<string, unknown> = { activities }
    if (akte.tabelle === 'objekte') patch.updated_at = new Date().toISOString()
    return await supabase.from(akte.tabelle).update(patch).eq('id', akte.id)
  }

  if (loeschen) {
    const schluessel = `eintrag:${akte.tabelle}:${akte.id}:${eintragId}`
    const a = k.vorherigeAnfrage
    const bestaetigt = a?.kunde_id === schluessel && Date.now() - new Date(a.z).getTime() < GUELTIG_MS
    if (!bestaetigt) {
      k.setzeAnfrage({ kunde_id: schluessel, name: `Verlaufseintrag in ${akte.name}`, z: new Date().toISOString() })
      return `NOCH NICHT GELÖSCHT. Frag den Mitarbeiter ausdrücklich, ob der Eintrag vom ${deDatum(eintrag.date)} („${kurz(eintrag.text, 80)}“) in ${akte.name} gelöscht werden soll. Nur wenn er das in seiner nächsten Nachricht klar bestätigt, rufe aktivitaet_aendern erneut mit loeschen=true auf.`
    }
    const vermerk: Eintrag = { id: zufallsId(), date: heute, text: `Verlaufseintrag vom ${deDatum(eintrag.date)} gelöscht von ${mitarbeiter.name}`, user: mitarbeiter.name }
    const { error } = await schreibe([vermerk, ...liste.filter((x) => x?.id !== eintragId)])
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`Verlaufseintrag in ${akte.name} gelöscht: „${kurz(eintrag.text)}“`)
    return `Gelöscht: Eintrag vom ${deDatum(eintrag.date)} in ${akte.name}. Im Verlauf steht nur noch der Vermerk, dass er gelöscht wurde (ohne Inhalt).`
  }

  const neu = liste.map((x) => (x?.id === eintragId ? { ...x, text: neuerText.slice(0, 4000), bearbeitet_von: mitarbeiter.name, bearbeitet_am: heute } : x))
  const { error } = await schreibe(neu)
  if (error) return `Fehler beim Speichern: ${error.message}`
  protokolliere(`Verlaufseintrag in ${akte.name} korrigiert: „${kurz(eintrag.text)}“ → „${kurz(neuerText)}“`)
  return `Korrigiert: Eintrag vom ${deDatum(eintrag.date)} in ${akte.name} lautet jetzt „${kurz(neuerText, 200)}“.`
}
