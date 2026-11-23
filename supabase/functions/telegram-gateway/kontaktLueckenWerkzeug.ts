// Assistent-Werkzeug „Wo fehlen Telefon und E-Mail?“ (Runde 6, 23.11.2026) — Gegenstück zu objekt_luecken.
// Rechnung im gemeinsamen Kern _shared/kontaktLuecken.ts (dieselbe wie bei der täglichen Nachfrage,
// email-gateway/kontaktNachfrage.ts).
//
// - Eine Akte (kunde_id): was fehlt.
// - Liste: „meine“ (Vorgabe; verantwortlich), ein Kollege oder alle Akten, die der Mitarbeiter sehen darf;
//   Vorgabe nur Akten ganz ohne Telefon und E-Mail, mit auch_teilweise=true auch die, denen eines davon fehlt.
// - Tägliche Nachfrage für den Fragenden an- oder abschalten (Tabelle assistent_hinweise, keine Zeile = an; ob die
//   Nachfrage überhaupt läuft, entscheidet der gemeinsame Schalter assistent_hinweis_einstellung).
//
// Nur Lesen, außer der eigenen Einstellung. Eingetragen wird mit kunde_aendern (email, telefon). Rechte über
// rechte.ts: private Kontakte zählen hier nie (dort pflegt der Besitzer selbst), fremde Bereiche fehlen.

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { BEREICH_TEXT, fehltText, KONTAKT_SPALTEN, type KontaktZeile, kontaktLuecken, pruefeKontakt, zaehlt } from '../_shared/kontaktLuecken.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { adresse, darfAkte, darfBereich, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type KontaktKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const HINWEIS_TABELLE = 'assistent_hinweise'
const HOECHSTENS = 40

export const KONTAKT_LUECKEN_WERKZEUGE = [
  {
    name: 'kontakt_luecken',
    description:
      'Zeigt Kundenakten, in denen Telefon und/oder E-Mail fehlen (laufende Akten der Holding, ohne private Kontakte und ohne abgeschlossene). ' +
      'Mit kunde_id für eine Akte, ohne für eine Liste: Vorgabe „meine Akten“ und nur Akten ganz ohne Telefon und E-Mail. Für „Wo fehlen Kontaktdaten?“, „Welche Akten kann ich nicht erreichen?“. ' +
      'Eintragen geht danach mit kunde_aendern (telefon, email). Mit nachfrage=true/false schaltet der Mitarbeiter die tägliche Nachfrage („Zu Akte X fehlen Telefon und E-Mail – weißt du sie?“) für sich an oder ab.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Eine bestimmte Akte.' },
        wer: { type: 'string', description: 'Für die Liste: "ich" (Vorgabe), Name oder Vorname eines Kollegen oder "alle".' },
        bereich: { type: 'string', enum: Object.keys(BEREICH_TEXT), description: 'Optional: nur dieser Bereich.' },
        auch_teilweise: { type: 'boolean', description: 'true = auch Akten, denen nur Telefon oder nur E-Mail fehlt.' },
        nachfrage: { type: 'boolean', description: 'Nur wenn der Mitarbeiter es ausdrücklich will: true = tägliche Nachfrage an, false = aus.' },
      },
    },
  },
]

export function istKontaktLueckenWerkzeug(name: string): boolean {
  return KONTAKT_LUECKEN_WERKZEUGE.some((w) => w.name === name)
}

async function setzeNachfrage(k: KontaktKontext, an: boolean): Promise<string> {
  const email = adresse(k.mitarbeiter.email)
  if (!email) return 'Fehler: Zu deinem Zugang ist keine E-Mail-Adresse hinterlegt.'
  const { error } = await k.supabase.from(HINWEIS_TABELLE).upsert({ email, kontakt_nachfrage: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
  if (error) return `Fehler beim Speichern: ${error.message}`
  k.protokolliere(`Tägliche Nachfrage nach fehlenden Kontaktdaten ${an ? 'eingeschaltet' : 'ausgeschaltet'}`)
  return an
    ? 'Die tägliche Nachfrage nach fehlenden Kontaktdaten ist für dich an: werktags vormittags höchstens eine Nachricht mit bis zu drei deiner Akten, denen Telefon und E-Mail fehlen (sobald die Geschäftsführung die Nachfrage freigegeben hat).'
    : 'Die tägliche Nachfrage nach fehlenden Kontaktdaten ist für dich aus. Wieder einschalten: „Kontakt-Nachfrage an“.'
}

// deno-lint-ignore no-explicit-any
export async function fuehreKontaktLueckenWerkzeugAus(name: string, input: any, k: KontaktKontext): Promise<string> {
  if (name !== 'kontakt_luecken') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = k
  if (mitarbeiter.nurPrivat === true) return 'Im privaten Assistenten gibt es diese Übersicht nicht — private Kontakte pflegst du direkt in der Akte.'
  const teile: string[] = []

  if (typeof input?.nachfrage === 'boolean') {
    const t = await setzeNachfrage(k, input.nachfrage)
    if (t.startsWith('Fehler')) return t
    teile.push(t)
    if (!input?.kunde_id && !input?.wer && !input?.bereich && input?.auch_teilweise === undefined) return t
  }

  // ---- Eine Akte ----
  const kundeId = String(input?.kunde_id ?? '').trim()
  if (kundeId) {
    const { data, error } = await supabase.from('kunden').select(`${KONTAKT_SPALTEN}, verantwortlich_email`).eq('id', kundeId).maybeSingle()
    if (error) return `Fehler beim Laden: ${error.message}`
    if (!data || istFremdePrivatakte(mitarbeiter, data)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    if (!darfAkte(mitarbeiter, data)) return nichtFreigegeben(data.bereich, mitarbeiter.name)
    if (istPrivat(data)) return 'Private Kontakte zählen hier nicht mit; Telefon und E-Mail trägst du mit kunde_aendern ein.'
    const l = pruefeKontakt(data as KontaktZeile, { mitAnschrift: true, mitEndstand: true })
    teile.push(
      l
        ? `Akte ${l.name} (kunde_id=${l.id}): es fehlen ${fehltText(l.fehlt)}. Eintragen mit kunde_aendern.`
        : `Akte ${String(data.firma || data.ansprechpartner || data.id)} (kunde_id=${data.id}): Telefon, E-Mail und Anschrift sind eingetragen.`,
    )
    return teile.join('\n\n')
  }

  // ---- Liste ----
  const bereich = String(input?.bereich ?? '').trim()
  const { data, error } = await alleZeilen(() => {
    let q = supabase.from('kunden').select(KONTAKT_SPALTEN).neq('bereich', 'privat')
    if (bereich) q = q.eq('bereich', bereich)
    return q
  })
  if (error) return `Fehler beim Laden: ${error.message}`
  let zeilen = ((data ?? []) as KontaktZeile[]).filter((z) => darfBereich(mitarbeiter, z.bereich))
  if (bereich && !darfBereich(mitarbeiter, bereich)) return nichtFreigegeben(bereich, mitarbeiter.name)

  const gefragt = String(input?.wer ?? '').trim()
  const alle = /^(alle|alles|jeder|team)$/i.test(gefragt)
  const ich = !gefragt || /^(ich|mir|mich|meine?|selbst)$/i.test(gefragt)
  let werText = 'alle Akten, die du sehen darfst'
  if (!alle) {
    const { data: team } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
    const namen = personenNamen(((team ?? []) as { name: string }[]).map((t) => t.name).filter(Boolean))
    const personen = ich ? [mitarbeiter.name] : ordneZu(gefragt, namen).personen
    if (!personen.length) return `Fehler: „${gefragt}“ passt zu keinem Mitarbeiter eindeutig. Nenne den vollen Namen oder "alle".`
    zeilen = zeilen.filter((z) => {
      const zustaendig = ordneZu(z.verantwortlich, namen).personen
      return personen.some((p) => zustaendig.includes(p) || String(z.verantwortlich ?? '').trim().toLowerCase() === p.toLowerCase())
    })
    werText = ich ? 'deine Akten' : `Akten von ${personen.join(', ')}`
  }
  const teilweise = input?.auch_teilweise === true
  const luecken = kontaktLuecken(zeilen, { nurOhneKontakt: !teilweise })
  const laufend = zeilen.filter((z) => zaehlt(z)).length
  if (luecken.length === 0) {
    teile.push(`Keine Lücken: Bei ${werText}${bereich ? ` (${BEREICH_TEXT[bereich] ?? bereich})` : ''} ist überall ${teilweise ? 'Telefon und E-Mail' : 'Telefon oder E-Mail'} eingetragen.`)
    return teile.join('\n\n')
  }
  const gezeigt = luecken.slice(0, HOECHSTENS)
  teile.push(
    [
      `${teilweise ? 'Akten mit fehlendem Telefon oder fehlender E-Mail' : 'Akten ganz ohne Telefon und E-Mail'}, ${werText}${bereich ? ` (${BEREICH_TEXT[bereich] ?? bereich})` : ''}: ${luecken.length}${laufend ? ` von ${laufend} geprüften` : ''}.`,
      ...gezeigt.map((l) => `- ${l.name} (kunde_id=${l.id}) · ${BEREICH_TEXT[l.bereich] ?? l.bereich}${l.verantwortlich && !ich ? ` · ${l.verantwortlich}` : ''} · fehlt: ${fehltText(l.fehlt)}`),
      luecken.length > HOECHSTENS ? `… und ${luecken.length - HOECHSTENS} weitere (eingrenzen mit bereich oder wer).` : '',
      'Eintragen: kunde_aendern mit telefon bzw. email.',
    ].filter(Boolean).join('\n'),
  )
  return teile.join('\n\n').slice(0, 16000)
}
