// Ablage selbst erstellter Dateien (PDF, Word, Excel, Exposé) in der Objektakte — gemeinsam genutzt von
// dokumentErstellen.ts (dokument_erstellen / tabelle_erstellen mit objekt_id) und exposeWerkzeuge.ts
// (expose_erstellen). Anlass (Wunsch vom 20.11.2026): Der Assistent hatte ein Exposé erstellt und konnte es
// nur in einer Sammelakte ablegen, nicht in der Objektakte.
//
// Ablage genau wie dateien_ins_objekt (objektWerkzeuge.ts) und das CRM (src/lib/objektDokumenteStorage.ts):
// privater Eimer "objekt-dokumente", Pfad "<objektId>/<dokId>_<speichername>", in objekte.dokumente unter
// dem Ordner ein Eintrag { id, name, typ, datum, groesse, url } mit url = Speicherpfad; dazu quelle
// "assistent". Geschrieben werden nur dokumente, activities und updated_at — frisch gelesen direkt vor dem
// Schreiben, denn das Erstellen dauert und in der Zwischenzeit kann jemand anderes etwas abgelegt haben.
//
// Rechte wie in der Datenbank (rechte.ts): Objekte der Holding nur mit Rechten für Immobilien, private
// Objekte nur ihr Besitzer; fremde private Objekte gibt es für den Mitarbeiter nicht.

import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { formatGroesse, freierName, OBJEKT_ORDNER, ordnerVon, speicherName } from './objektWerkzeuge.ts'
import type { ObjektDokument } from './objektakte.ts'
import { darfObjekt, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export const OBJEKT_EIMER = 'objekt-dokumente'
export const KEIN_OBJEKT = 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'

export type AblageKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
}

// deno-lint-ignore no-explicit-any
export type ObjektZeile = Record<string, any> & { id: string; bezeichnung?: string | null; adresse?: string | null; privat_besitzer?: string | null }

/** Lädt ein Objekt mit Rechteprüfung. Fehlertext (beginnt mit „Fehler“ bzw. „Nicht freigegeben“) oder die Zeile. */
export async function ladeObjektMitRechten(k: AblageKontext, objektId: string, spalten: string): Promise<ObjektZeile | string> {
  const id = String(objektId ?? '').trim()
  if (!id) return 'Fehler: objekt_id fehlt. Ermittle sie mit objekte_suchen.'
  const mitBesitzer = /\bprivat_besitzer\b/.test(spalten) ? spalten : `${spalten}, privat_besitzer`
  const { data, error } = await k.supabase.from('objekte').select(mitBesitzer).eq('id', id).maybeSingle()
  if (error) return `Fehler beim Laden des Objekts: ${error.message}`
  if (!data || istUnsichtbaresObjekt(k.mitarbeiter, data)) return KEIN_OBJEKT
  if (!darfObjekt(k.mitarbeiter, data)) return nichtFreigegeben('immobilien', k.mitarbeiter.name)
  return data as ObjektZeile
}

/** „Bezeichnung“ (Adresse) für Antworten und Verlauf. */
export function objektAnzeige(o: { bezeichnung?: string | null; adresse?: string | null }): string {
  const b = String(o.bezeichnung ?? '').trim() || 'Objekt ohne Bezeichnung'
  const a = String(o.adresse ?? '').trim()
  return a && a.toLowerCase() !== b.toLowerCase() ? `„${b}“ (${a})` : `„${b}“`
}

/** Ordner aus der Eingabe (tolerant: „Expose“ → „Exposé“); leer → Vorgabe; unbekannt → Fehlertext. */
export function ordnerAusEingabe(eingabe: unknown, vorgabe: string): { ordner: string } | { fehler: string } {
  const roh = String(eingabe ?? '').trim()
  if (!roh) return { ordner: vorgabe }
  const ordner = ordnerVon(roh)
  return ordner ? { ordner } : { fehler: `Fehler: Den Ordner „${roh}“ gibt es in der Objektakte nicht. Möglich: ${OBJEKT_ORDNER.join(', ')}.` }
}

export type Abgelegt = { id: string; name: string; groesse: string; ordner: string; pfad: string }

/**
 * Datei in den Objekt-Speicher laden und in objekte.dokumente[ordner] + activities eintragen.
 * Gleicher Name im Ordner → „Name (2).pdf“. Schlägt das Schreiben fehl, wird die Datei wieder entfernt.
 */
export async function legeInsObjektAb(
  k: AblageKontext,
  objekt: ObjektZeile,
  heute: string,
  datei: { bytes: Uint8Array; dateiName: string; typ: string; ordner: string; aktivitaet: (anzeigeName: string, groesse: string) => string },
): Promise<Abgelegt | string> {
  const { supabase, mitarbeiter } = k
  const dokId = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const pfad = `${objekt.id}/${dokId}_${speicherName(datei.dateiName)}`
  if (!istSichererPfad(pfad)) return 'Fehler: Der Dateiname ist nicht verwendbar. Nichts wurde abgelegt.'
  const { error: hochFehler } = await supabase.storage.from(OBJEKT_EIMER).upload(pfad, datei.bytes, { contentType: datei.typ, upsert: false })
  if (hochFehler) return `Fehler beim Speichern der Datei: ${hochFehler.message}. Nichts wurde abgelegt.`

  const entferne = async () => {
    try {
      await supabase.storage.from(OBJEKT_EIMER).remove([pfad])
    } catch {
      // Aufräumen ist nur ein Versuch.
    }
  }
  const { data: frisch, error: frischFehler } = await supabase.from('objekte').select('dokumente, activities').eq('id', objekt.id).maybeSingle()
  if (frischFehler || !frisch) {
    await entferne()
    return `Fehler beim Speichern in der Objektakte: ${frischFehler?.message ?? 'Objekt nicht mehr vorhanden'}. Nichts wurde abgelegt.`
  }
  const dokumente: Record<string, ObjektDokument[]> = { ...(frisch.dokumente && typeof frisch.dokumente === 'object' && !Array.isArray(frisch.dokumente) ? frisch.dokumente : {}) }
  const liste = Array.isArray(dokumente[datei.ordner]) ? dokumente[datei.ordner] : []
  const name = freierName(datei.dateiName, liste)
  const groesse = formatGroesse(datei.bytes.length)
  const neu = { id: dokId, name, typ: datei.typ, datum: heute, groesse, url: pfad, quelle: 'assistent' }
  dokumente[datei.ordner] = [neu, ...liste]
  const eintrag = { id: `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, date: heute, text: datei.aktivitaet(name, groesse), user: mitarbeiter.name }
  const { error: schreibFehler } = await supabase
    .from('objekte')
    .update({ dokumente, activities: [eintrag, ...(Array.isArray(frisch.activities) ? frisch.activities : [])], updated_at: new Date().toISOString() })
    .eq('id', objekt.id)
  if (schreibFehler) {
    await entferne()
    return `Fehler beim Speichern in der Objektakte: ${schreibFehler.message}. Nichts wurde abgelegt.`
  }
  return { id: dokId, name, groesse, ordner: datei.ordner, pfad }
}

/** Gibt ein Dokument des Objekts für das Interessenten-Portal frei (objekte.interessenten_dokumente, frisch gelesen). */
export async function gibFuerPortalFrei(k: AblageKontext, objektId: string, dokId: string): Promise<true | string> {
  const { data, error } = await k.supabase.from('objekte').select('interessenten_dokumente').eq('id', objektId).maybeSingle()
  if (error || !data) return `Die Freigabe für das Interessenten-Portal ging nicht (${error?.message ?? 'Objekt nicht gefunden'}); das lässt sich im CRM unter „Interessenten-Portal“ nachholen.`
  const bisher: string[] = Array.isArray(data.interessenten_dokumente) ? data.interessenten_dokumente.filter((x: unknown) => typeof x === 'string') : []
  if (bisher.includes(dokId)) return true
  const { error: schreibFehler } = await k.supabase.from('objekte').update({ interessenten_dokumente: [...bisher, dokId] }).eq('id', objektId)
  if (schreibFehler) return `Die Freigabe für das Interessenten-Portal ging nicht (${schreibFehler.message}); das lässt sich im CRM unter „Interessenten-Portal“ nachholen.`
  return true
}
