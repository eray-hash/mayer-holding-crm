// Assistent-Werkzeug „mein_profil_aendern“ und die einmalige Nachfrage nach der Telefonnummer
// (Runde 5, 22.11.2026; Kern: ../_shared/profilKern.ts, Oberfläche: Mein Profil + Heute).
//
// Ändert ausschließlich die EIGENE Zeile des schreibenden Mitarbeiters (ctx.mitarbeiter.id):
//  - telefon, signatur → mitarbeiter.telefon / signatur_html (wie update_my_profil im CRM)
//  - mobil, position   → mitarbeiter_profil (id = mitarbeiter.id)
// Es gibt keinen Parameter für einen anderen Mitarbeiter — fremde Profile kann der Assistent nicht ändern.
//
// Nachfrage: profilNachfrage() prüft, ob Telefon UND Mobil fehlen, ob der Mitarbeiter Nachfragen
// zulässt (mitarbeiter_profil.profil_nachfrage) und ob schon gefragt wurde (telefon_gefragt_am). Der
// Anspruch wird atomar gesetzt (insert bzw. update … where telefon_gefragt_am is null) — dadurch fragt
// der Assistent jeden Mitarbeiter genau einmal, auch wenn zwei Nachrichten gleichzeitig eintreffen.

import { profilLuecken, ladeFirmenKontakt, pruefeTelefon, signaturAusText, TELEFON_NACHFRAGE } from '../_shared/profilKern.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type ProfilKontext = {
  supabase: Supa
  mitarbeiter: { id: string; name: string }
  protokolliere: (text: string) => void
  heute?: string
}

export const PROFIL_WERKZEUGE = [
  {
    name: 'mein_profil_aendern',
    description:
      'Ändert das EIGENE Profil des Mitarbeiters, mit dem du schreibst („Meine Nummer ist …“, „trag als Funktion Immobilienberater ein“, „meine Signatur soll lauten …“). Nur seine eigenen Angaben, nie die eines Kollegen. Die Telefonnummer erscheint in automatischen Mails an Interessenten, im Kundenbereich und im Exposé. Ohne Angaben aufgerufen zeigt es den aktuellen Stand und was noch fehlt. Ein leerer Text löscht die Angabe.',
    input_schema: {
      type: 'object',
      properties: {
        telefon: { type: 'string', description: 'Telefonnummer für Kunden, z. B. "0731 123456" oder "+49 176 1234567".' },
        mobil: { type: 'string', description: 'Optional: zusätzliche Mobilnummer (wird genommen, wenn keine Telefonnummer eingetragen ist).' },
        position: { type: 'string', description: 'Funktion, z. B. "Immobilienberater" oder "Geschäftsführer".' },
        signatur: { type: 'string', description: 'E-Mail-Signatur als normaler Text, Zeilen mit Zeilenumbruch. Ersetzt die bisherige Signatur ganz — nur auf ausdrücklichen Wunsch.' },
      },
    },
  },
]

export function istProfilWerkzeug(name: string): boolean {
  return PROFIL_WERKZEUGE.some((w) => w.name === name)
}

type Eingabe = { telefon?: unknown; mobil?: unknown; position?: unknown; signatur?: unknown }

const gesetzt = (x: unknown): x is string => typeof x === 'string'

async function ladeStand(supabase: Supa, id: string) {
  const [{ data: m, error }, { data: z }] = await Promise.all([
    supabase.from('mitarbeiter').select('id, telefon, signatur_html').eq('id', id).maybeSingle(),
    supabase.from('mitarbeiter_profil').select('id, mobil, position').eq('id', id).maybeSingle(),
  ])
  if (error || !m) return null
  return {
    telefon: String(m.telefon ?? '').trim(),
    signatur: String(m.signatur_html ?? ''),
    mobil: String(z?.mobil ?? '').trim(),
    position: String(z?.position ?? '').trim(),
    zusatzDa: !!z,
  }
}

function standText(s: { telefon: string; mobil: string; position: string; signatur: string }, luecken: string[]): string {
  const zeilen = [
    `Telefon: ${s.telefon || '–'}`,
    `Mobil: ${s.mobil || '–'}`,
    `Funktion: ${s.position || '–'}`,
    `Signatur: ${s.signatur.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ? 'vorhanden' : '–'}`,
  ]
  return luecken.length ? `${zeilen.join('\n')}\nEs fehlt noch: ${luecken.join(', ')}.` : `${zeilen.join('\n')}\nDas Profil ist vollständig.`
}

// deno-lint-ignore no-explicit-any
export async function fuehreProfilWerkzeugAus(name: string, input: any, ctx: ProfilKontext): Promise<string> {
  if (name !== 'mein_profil_aendern') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere } = ctx
  const id = String(mitarbeiter?.id ?? '')
  if (!id) return 'Fehler: Mitarbeiter unbekannt.'
  const e = (input ?? {}) as Eingabe

  const vorher = await ladeStand(supabase, id)
  if (!vorher) return 'Fehler: Dein Profil wurde nicht gefunden.'

  // Prüfen, bevor irgendetwas geschrieben wird.
  const aenderungM: Record<string, string | null> = {}
  const aenderungZ: Record<string, string | null> = {}
  const genannt: string[] = []
  if (gesetzt(e.telefon)) {
    const p = pruefeTelefon(e.telefon)
    if (!p.ok) return `Fehler: ${p.grund} Bitte die Nummer noch einmal schicken.`
    if (p.wert !== vorher.telefon) aenderungM.telefon = p.wert || null
    genannt.push(p.wert ? `Telefon ${p.wert}` : 'Telefon gelöscht')
  }
  if (gesetzt(e.mobil)) {
    const p = pruefeTelefon(e.mobil)
    if (!p.ok) return `Fehler: ${p.grund} (Mobil)`
    if (p.wert !== vorher.mobil) aenderungZ.mobil = p.wert || null
    genannt.push(p.wert ? `Mobil ${p.wert}` : 'Mobil gelöscht')
  }
  if (gesetzt(e.position)) {
    const wert = e.position.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (wert !== vorher.position) aenderungZ.position = wert || null
    genannt.push(wert ? `Funktion „${wert}“` : 'Funktion gelöscht')
  }
  if (gesetzt(e.signatur)) {
    const text = e.signatur.trim().slice(0, 2000)
    const html = text ? signaturAusText(text) : ''
    if (html !== vorher.signatur) aenderungM.signatur_html = html || null
    genannt.push(text ? 'Signatur' : 'Signatur gelöscht')
  }

  const firma = await ladeFirmenKontakt(supabase)
  if (genannt.length === 0) {
    const luecken = profilLuecken(vorher, firma).map((l) => l.titel.replace(/^Deine /, '').replace(/ fehlt$/, ''))
    return standText(vorher, luecken)
  }

  // Nur geänderte Felder schreiben; immer nur die eigene Zeile (id aus dem Kontext).
  if (Object.keys(aenderungM).length) {
    const { error } = await supabase.from('mitarbeiter').update(aenderungM).eq('id', id)
    if (error) return `Fehler: Profil nicht gespeichert (${error.message}).`
  }
  if (Object.keys(aenderungZ).length) {
    const zeile = { ...aenderungZ, geaendert_am: new Date().toISOString() }
    const { error } = vorher.zusatzDa
      ? await supabase.from('mitarbeiter_profil').update(zeile).eq('id', id)
      : await supabase.from('mitarbeiter_profil').upsert({ id, ...zeile }, { onConflict: 'id' })
    if (error) return `Fehler: Mobil/Funktion nicht gespeichert (${error.message}).${Object.keys(aenderungM).length ? ' Telefon/Signatur sind gespeichert.' : ''}`
  }
  const geaendert = Object.keys(aenderungM).length + Object.keys(aenderungZ).length > 0
  if (geaendert) protokolliere(`Eigenes Profil geändert: ${genannt.join(', ')} (mitarbeiter_id=${id})`)

  const nachher = {
    telefon: 'telefon' in aenderungM ? String(aenderungM.telefon ?? '') : vorher.telefon,
    mobil: 'mobil' in aenderungZ ? String(aenderungZ.mobil ?? '') : vorher.mobil,
    position: 'position' in aenderungZ ? String(aenderungZ.position ?? '') : vorher.position,
    signatur: 'signatur_html' in aenderungM ? String(aenderungM.signatur_html ?? '') : vorher.signatur,
  }
  const rest = profilLuecken(nachher, firma).map((l) => l.titel.replace(/^Deine /, '').replace(/ fehlt$/, ''))
  return `${geaendert ? 'Gespeichert' : 'Schon so eingetragen'}: ${genannt.join(', ')}.${rest.length ? ` Es fehlt noch: ${rest.join(', ')}.` : ' Das Profil ist jetzt vollständig.'}`
}

// ── Einmalige Nachfrage ─────────────────────────────────────────────────────────────────────

/**
 * Liefert den Nachfrage-Text genau einmal je Mitarbeiter, wenn Telefon und Mobil fehlen und Nachfragen
 * erlaubt sind; sonst null. Setzt dabei den Anspruch (telefon_gefragt_am). Fehler → null (nie störend).
 */
export async function profilNachfrage(supabase: Supa, mitarbeiter: { id: string }, jetzt = new Date()): Promise<string | null> {
  try {
    const id = String(mitarbeiter?.id ?? '')
    if (!id) return null
    const { data: m } = await supabase.from('mitarbeiter').select('id, aktiv, telefon').eq('id', id).maybeSingle()
    if (!m || m.aktiv === false || String(m.telefon ?? '').trim()) return null
    const { data: z } = await supabase.from('mitarbeiter_profil').select('id, mobil, profil_nachfrage, telefon_gefragt_am').eq('id', id).maybeSingle()
    if (z && (String(z.mobil ?? '').trim() || z.profil_nachfrage === false || z.telefon_gefragt_am)) return null

    const am = jetzt.toISOString()
    if (!z) {
      const { error } = await supabase.from('mitarbeiter_profil').insert({ id, telefon_gefragt_am: am, geaendert_am: am })
      if (!error) return TELEFON_NACHFRAGE
      if (error.code !== '23505') return null
      // Gleichzeitig angelegt: dann wie unten über das bedingte Update beanspruchen.
    }
    const { data: beansprucht } = await supabase
      .from('mitarbeiter_profil')
      .update({ telefon_gefragt_am: am })
      .eq('id', id)
      .is('telefon_gefragt_am', null)
      .neq('profil_nachfrage', false)
      .select('id')
    return Array.isArray(beansprucht) && beansprucht.length > 0 ? TELEFON_NACHFRAGE : null
  } catch (err) {
    console.error('Profil-Nachfrage fehlgeschlagen:', err)
    return null
  }
}

type VerlaufNachricht = { role: string; content: unknown }
type MitVerlauf = { zuege: { msgs: VerlaufNachricht[] }[] }

/**
 * Hängt die Nachfrage an die Antwort an — und auch an die letzte Assistenten-Nachricht im gespeicherten
 * Verlauf, damit der Assistent beim nächsten Zug weiß, warum der Mitarbeiter eine Nummer schickt.
 */
export function nachfrageAnhaengen(state: MitVerlauf, antwort: string, frage: string): string {
  const zug = state.zuege?.[state.zuege.length - 1]
  const letzte = zug?.msgs?.[zug.msgs.length - 1]
  if (letzte && letzte.role === 'assistant' && typeof letzte.content === 'string') letzte.content = `${letzte.content}\n\n${frage}`
  return `${antwort}\n\n${frage}`
}
