// Assistent-Werkzeug „Gesprächsprotokoll nach einem Kundentermin“ (22.11.2026).
//
// Gegenstück zur Nachfrage nach Kundenterminen (email-gateway/nachTermin.ts): Der Assistent fragt nach dem
// Termin „Wie lief's?“, der Mitarbeiter antwortet per Sprachnachricht oder Text, und der Assistent legt mit
// nachtermin_protokoll das Gesprächsprotokoll an — gegliedert in Teilnehmer, Besprochen, Vereinbart und Nächste
// Schritte. Anders als gespraechsprotokoll_anlegen füllt es auch die gegliederten Felder der Tabelle protokolle
// (ki_zusammenfassung, kernthemen = Besprochen, vereinbarungen = Vereinbart, offene_punkte = Nächste Schritte;
// so zeigt die Akte sie wie bei „Gespräch aufzeichnen“), legt den Wortlaut der Rückmeldung in text ab und
// schreibt die nächsten Schritte in das Feld „Nächste Schritte“ der Akte (kunden.naechste_schritte, eine Zeile
// je Schritt). Wiedervorlagen und To-dos legt es bewusst NICHT an — die schlägt der Assistent danach vor.
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb gelten hier die Zeilenregeln aus rechte.ts.

import { darfAkte, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type NachTerminKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

const LISTE = (beschreibung: string) => ({ type: 'array', items: { type: 'string' }, description: beschreibung })

export const NACHTERMIN_WERKZEUGE = [
  {
    name: 'nachtermin_protokoll',
    description:
      'Legt nach einem Kundentermin ein gegliedertes Gesprächsprotokoll in der Kundenakte an (Teilnehmer, Besprochen, Vereinbart, Nächste Schritte) und trägt die nächsten Schritte in das Feld „Nächste Schritte“ der Akte ein. Für die Antwort des Mitarbeiters auf die Nachfrage „Wie lief der Termin …?“ und überhaupt, wenn er erzählt, wie ein Kundentermin gelaufen ist. Nur übernehmen, was er gesagt hat — nichts dazuerfinden. Legt keine Wiedervorlagen oder To-dos an; die schlägst du danach vor.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (bei der Nachfrage steht sie in der Systemmeldung, sonst mit kunden_suchen ermitteln).' },
        datum: { type: 'string', description: 'Tag des Termins als JJJJ-MM-TT. Unbekannt: heute.' },
        betreff: { type: 'string', description: 'Kurz, z. B. "Erstgespräch Testament" oder der Titel des Termins.' },
        teilnehmer: { type: 'string', description: 'Namen, durch Komma getrennt (Kunde und Mitarbeiter). Fehlt es: Kunde und der Mitarbeiter.' },
        zusammenfassung: { type: 'string', description: 'Ein bis zwei Sätze: worum ging es, wie ist der Stand.' },
        besprochen: LISTE('Was besprochen wurde, je Punkt ein kurzer Satz.'),
        vereinbart: LISTE('Was fest vereinbart wurde (Zusagen, Termine, Beträge so wie gesagt).'),
        naechste_schritte: LISTE('Was als Nächstes passiert, je Schritt ein Satz mit wer und bis wann, falls genannt.'),
        wortlaut: { type: 'string', description: 'Die Rückmeldung des Mitarbeiters im Wortlaut (bei Sprachnachrichten die Abschrift).' },
        akte_aktualisieren: { type: 'boolean', description: 'false = das Feld „Nächste Schritte“ der Akte nicht überschreiben. Vorgabe: true, sobald naechste_schritte genannt sind.' },
      },
      required: ['kunde_id', 'besprochen'],
    },
  },
]

export function istNachTerminWerkzeug(name: string): boolean {
  return NACHTERMIN_WERKZEUGE.some((w) => w.name === name)
}

/** Liste aus der Eingabe: Zeichenketten, getrimmt, ohne Aufzählungszeichen, ohne Leere; auch eine einzelne Zeichenkette mit Zeilen. */
export function liste(wert: unknown): string[] {
  const roh = Array.isArray(wert) ? wert : typeof wert === 'string' ? wert.split('\n') : []
  return roh
    .map((x) => String(x ?? '').replace(/^\s*(?:[-–•*·]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((x) => x.slice(0, 500))
}

function deDatum(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso
}

/** Der Text des Protokolls: die vier Abschnitte, darunter der Wortlaut. */
export function protokollText(p: { teilnehmer: string; besprochen: string[]; vereinbart: string[]; naechste: string[]; wortlaut: string }): string {
  const abschnitt = (titel: string, punkte: string[]) => `${titel}:\n${punkte.length ? punkte.map((x) => `- ${x}`).join('\n') : '- nichts genannt'}`
  const teile = [
    `Teilnehmer: ${p.teilnehmer}`,
    abschnitt('Besprochen', p.besprochen),
    abschnitt('Vereinbart', p.vereinbart),
    abschnitt('Nächste Schritte', p.naechste),
  ]
  if (p.wortlaut) teile.push(`Rückmeldung im Wortlaut:\n${p.wortlaut}`)
  return teile.join('\n\n')
}

// deno-lint-ignore no-explicit-any
export async function fuehreNachTerminWerkzeugAus(name: string, input: any, k: NachTerminKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (name !== 'nachtermin_protokoll') return `Fehler: Unbekanntes Werkzeug ${name}.`

  const kundeId = String(input?.kunde_id ?? '').trim()
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
  if (SAMMELAKTEN.includes(kundeId)) return 'Fehler: In den Sammelakten werden keine Gesprächsprotokolle angelegt. Ermittle die Akte des Kunden mit kunden_suchen.'
  const besprochen = liste(input?.besprochen)
  const vereinbart = liste(input?.vereinbart)
  const naechste = liste(input?.naechste_schritte)
  if (besprochen.length === 0 && vereinbart.length === 0) return 'Fehler: besprochen fehlt. Frag den Mitarbeiter kurz, was im Termin besprochen wurde.'
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.datum ?? '')) ? String(input.datum) : heute

  const { data: akte, error: akteFehler } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (akteFehler) return `Fehler beim Laden der Akte: ${akteFehler.message}`
  if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
  if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
  const kunde = String(akte.ansprechpartner ?? '').trim() || String(akte.firma ?? '').trim() || kundeId

  const betreff = String(input?.betreff ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || `Kundentermin am ${deDatum(datum)}`
  const teilnehmer = String(input?.teilnehmer ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || `${kunde}, ${mitarbeiter.name}`
  const zusammenfassung = String(input?.zusammenfassung ?? '').trim().slice(0, 1000)
  const wortlaut = String(input?.wortlaut ?? '').trim().slice(0, 8000)

  // Doppelt aufgerufen (z. B. nach einer Wiederholung)? Gleiches Datum und gleicher Betreff → nicht noch einmal.
  const { data: gleiche } = await supabase.from('protokolle').select('id').eq('kunde_id', kundeId).eq('datum', datum).eq('betreff', betreff).limit(1)
  if (Array.isArray(gleiche) && gleiche.length > 0) {
    return `Schon vorhanden: Gesprächsprotokoll „${betreff}“ vom ${deDatum(datum)} in der Akte von ${kunde} (${gleiche[0].id}). Nichts neu angelegt.`
  }

  const id = `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`
  const { error } = await supabase.from('protokolle').insert({
    id,
    bereich: akte.bereich,
    kunde_id: kundeId,
    datum,
    teilnehmer,
    betreff,
    text: protokollText({ teilnehmer, besprochen, vereinbart, naechste, wortlaut }),
    ki_zusammenfassung: zusammenfassung || null,
    kernthemen: besprochen.length ? besprochen : null,
    vereinbarungen: vereinbart.length ? vereinbart : null,
    offene_punkte: naechste.length ? naechste : null,
  })
  if (error) return `Fehler beim Anlegen des Protokolls: ${error.message}`
  protokolliere(`Gesprächsprotokoll „${betreff}“ (${id}) bei ${kunde} angelegt`)

  // Akte: Verlauf und „Nächste Schritte“ — frisch lesen, nur geänderte Felder schreiben.
  const { data: frisch } = await supabase.from('kunden').select('activities, naechste_schritte').eq('id', kundeId).maybeSingle()
  const vorher = String(frisch?.naechste_schritte ?? '').trim()
  const schritteSchreiben = naechste.length > 0 && input?.akte_aktualisieren !== false
  const aenderung: Record<string, unknown> = {
    activities: [{ id: crypto.randomUUID(), date: heute, text: `Gesprächsprotokoll nach Termin angelegt: „${betreff}“`, user: mitarbeiter.name }, ...(Array.isArray(frisch?.activities) ? frisch.activities : [])],
    letzte_aktivitaet: heute,
  }
  if (schritteSchreiben) aenderung.naechste_schritte = naechste.map((x) => `- ${x}`).join('\n')
  const { error: akteSchreibFehler } = await supabase.from('kunden').update(aenderung).eq('id', kundeId)
  const zeilen = [`Gesprächsprotokoll „${betreff}“ vom ${deDatum(datum)} in der Akte von ${kunde} angelegt (${id}).`]
  if (akteSchreibFehler) {
    zeilen.push(`Fehler: Die Akte selbst (Verlauf${schritteSchreiben ? ', Nächste Schritte' : ''}) ließ sich nicht aktualisieren: ${akteSchreibFehler.message}`)
  } else if (schritteSchreiben) {
    protokolliere(`Nächste Schritte bei ${kunde} aktualisiert`)
    zeilen.push(`„Nächste Schritte“ der Akte ersetzt (${naechste.length} Punkt${naechste.length === 1 ? '' : 'e'}).${vorher ? ` Vorher stand dort: „${vorher.slice(0, 300)}“` : ''}`)
  }
  if (naechste.length > 0) {
    zeilen.push(
      istPrivat(akte)
        ? 'Schlage dem Mitarbeiter jetzt für die nächsten Schritte passende To-dos (todo_anlegen, mit Datum) als kurze Liste vor und lege sie erst an, wenn er zustimmt. Private Kontakte haben keine Wiedervorlagen.'
        : 'Schlage dem Mitarbeiter jetzt für die nächsten Schritte passende Wiedervorlagen (wiedervorlage_anlegen, mit Datum) bzw. To-dos (todo_anlegen) als kurze Liste mit Datum vor und lege sie erst an, wenn er zustimmt. Prüfe vorher mit wiedervorlagen_auflisten (kunde_id), ob es schon passende gibt.',
    )
  }
  return zeilen.join('\n')
}
