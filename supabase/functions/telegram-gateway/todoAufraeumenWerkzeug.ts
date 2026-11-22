// Assistent-Werkzeug todos_aufraeumen (22.11.2026): Aufräum-Vorschläge für die EIGENE To-do-Liste des Fragenden
// (doppelt, lange unberührt, lange überfällig, sieht erledigt aus, Akte abgeschlossen — Kern in
// _shared/todoAufraeumen.ts, dieselben Regeln wie das Feld „Aufräumen“ in der To-Do-Liste im CRM).
//
// - Ohne bestaetigt: nur Vorschläge (Zahlen, Gruppen mit Code, Beispiele mit todo_id). Ändert nichts.
// - Mit bestaetigt=true: wendet NUR an, was genannt ist — per gruppe (Code aus der Vorschau; passt der Code nicht
//   mehr zum aktuellen Stand, wird nichts geändert) oder per todo_ids, und nur Aufgaben, die gerade vorgeschlagen
//   sind. „Erledigen“ ist weich (abgehakt mit Vermerk „aufgeräumt am …“), gelöscht wird nur mit aktion=loeschen.
// - Privat bleibt privat (Erays Regel vom 21.11.2026): Im Mayer-Bot nie Aufgaben aus Microsoft To Do und nicht die
//   eigene Liste einer Person, die den privaten Assistenten nutzt — die räumt sie dort auf.
// - Microsoft: Erledigt/Frist/Stand trägt der Abgleich (email-gateway/todoAbgleich.ts) zurück, Löschen der
//   Auslöser todo_ms_loeschung. Bereichslisten (gemeinsam) räumt das Werkzeug bewusst nicht auf.
//
// Der Assistent arbeitet mit vollen Datenbankrechten; die Zeilenregel der Datenbank (eigene Liste = besitzer_email)
// steht deshalb in jeder Abfrage und jedem Schreiben.

import {
  aenderungenFuer,
  AKTION_NAME,
  ART_NAME,
  analysiereTodos,
  AUFRAEUM_ARTEN,
  type AufraeumAktion,
  type AufraeumArt,
  type AufraeumTodo,
  type AufraeumVorschlag,
  buendele,
  deDatum,
  gruppenCode,
  istEndstatus,
  type AkteName,
  ladeOffeneTodos,
  stuecke,
  type TodoAenderung,
  vermerk,
  zusammenfassen,
} from '../_shared/todoAufraeumen.ts'
import { privatBotAktiv as privatBotAktivStandard } from '../_shared/telegramPrivat.ts'
import { adresse, type RechteMitarbeiter } from './rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type TodoAufraeumenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** true = Aufruf aus dem privaten Assistenten (index.ts: imPrivatBot()). */
  privat?: boolean
  /** Für Tests ersetzbar; Vorgabe _shared/telegramPrivat.ts privatBotAktiv. */
  privatBotAktiv?: (email: string) => Promise<boolean>
}

const HOECHSTENS_IDS = 300

export const TODO_AUFRAEUMEN_WERKZEUGE = [
  {
    name: 'todos_aufraeumen',
    description:
      'Räumt die EIGENE To-do-Liste des Mitarbeiters auf: findet doppelte Aufgaben, lange unberührte ohne Frist, lange überfällige, solche, die erledigt aussehen (z. B. Termin im Text längst vorbei), und solche zu abgeschlossenen Akten. Ohne bestaetigt nur Vorschläge (Zahlen, Gruppen mit Code, Beispiele mit todo_id) — ändert nichts. Für „räum meine To-dos auf“, „was kann weg?“, „zeig mir die doppelten To-dos“. Anwenden erst nach seinem klaren Ja in der nächsten Nachricht: bestaetigt=true mit gruppe=<Code aus der Vorschau> oder todo_ids. Standard ist abhaken mit Vermerk „aufgeräumt“ (lässt sich wieder öffnen); löschen nur, wenn er ausdrücklich löschen sagt (aktion=loeschen).',
    input_schema: {
      type: 'object',
      properties: {
        art: { type: 'string', enum: [...AUFRAEUM_ARTEN], description: 'Nur diese Art zeigen: wohl_erledigt, akte_abgeschlossen, doppelt, ueberfaellig, alt. Mit art (und/oder liste) kommen die einzelnen Aufgaben mit todo_id.' },
        liste: { type: 'string', description: 'Nur diese Liste (Teil des Namens, z. B. eine Microsoft-Liste wie "Einkauf").' },
        tage_alt: { type: 'integer', minimum: 30, maximum: 730, description: 'Ab wie vielen Tagen ohne Bewegung eine Aufgabe ohne Frist als alt gilt (Vorgabe 90). Beim Bestätigen denselben Wert wie in der Vorschau nehmen.' },
        bestaetigt: { type: 'boolean', description: 'true NUR, wenn der Mitarbeiter die gezeigten Vorschläge ausdrücklich bestätigt hat.' },
        gruppe: { type: 'string', description: 'Code einer Gruppe aus der Vorschau (beginnt mit G). Wendet genau diese Gruppe an.' },
        todo_ids: { type: 'array', items: { type: 'string' }, maxItems: HOECHSTENS_IDS, description: 'Stattdessen einzelne Aufgaben (todo_id aus der Vorschau).' },
        aktion: {
          type: 'string',
          enum: ['vorschlag', 'erledigen', 'verschieben', 'loeschen'],
          description: 'vorschlag (Vorgabe) = jeweils den Vorschlag anwenden; erledigen = abhaken mit Vermerk (bei Doppeln: zusammenführen); verschieben = neue Frist (datum); loeschen = endgültig löschen, NUR auf ausdrücklichen Wunsch (bei Doppeln bleibt eine).',
        },
        datum: { type: 'string', description: 'Bei aktion=verschieben: neue Frist als JJJJ-MM-TT.' },
      },
    },
  },
]

export function istTodoAufraeumenWerkzeug(name: string): boolean {
  return name === 'todos_aufraeumen'
}

const zahl = (n: number) => n.toLocaleString('de-DE')
const kurz = (s: string, n = 60) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Namen von Akten, Objekten und Projekten mit „abgeschlossen ja/nein“ (für akte_abgeschlossen). */
export async function ladeAkten(supabase: Supa): Promise<AkteName[]> {
  const akten: AkteName[] = []
  const lies = async (tabelle: string, spalten: string, namen: string[]) => {
    // Seitenweise: Akten werden mehr als 1000 (Grenze der Datenbank je Abfrage).
    const { data } = await alleZeilen(() => supabase.from(tabelle).select(spalten))
    for (const z of (data ?? []) as Record<string, string | null>[]) {
      for (const n of namen) if (z[n]) akten.push({ name: String(z[n]), abgeschlossen: istEndstatus(z.status) })
    }
  }
  await Promise.all([
    lies('kunden', 'firma, ansprechpartner, status', ['firma', 'ansprechpartner']),
    lies('objekte', 'bezeichnung, status', ['bezeichnung']),
    lies('projekte', 'name, status', ['name']),
  ]).catch(() => undefined)
  return akten
}

type Topf = { code: string; art: AufraeumArt; liste_name: string; vorschlag: AufraeumAktion; vorschlaege: AufraeumVorschlag[]; anzahl: number }

/** Gruppen zum Bestätigen: je Art, Liste und Vorschlag eine; der Code hängt an genau diesen Aufgaben. */
export function toepfe(v: AufraeumVorschlag[]): Topf[] {
  const m = new Map<string, Omit<Topf, 'code'>>()
  for (const x of v) {
    const k = `${x.art}|${x.liste}|${x.vorschlag}`
    if (!m.has(k)) m.set(k, { art: x.art, liste_name: x.liste_name, vorschlag: x.vorschlag, vorschlaege: [], anzahl: 0 })
    const t = m.get(k)!
    t.vorschlaege.push(x)
    t.anzahl += x.todo_ids.filter((id) => id !== x.behalten_id).length
  }
  return [...m.values()].map((t) => ({ ...t, code: gruppenCode(t.vorschlaege.flatMap((x) => x.todo_ids)) })).sort((a, b) => b.anzahl - a.anzahl)
}

function aktionText(v: AufraeumVorschlag): string {
  return v.vorschlag === 'verschieben' && v.datum ? `verschieben auf ${deDatum(v.datum)}` : AKTION_NAME[v.vorschlag].toLowerCase()
}

// deno-lint-ignore no-explicit-any
export async function fuehreTodoAufraeumenWerkzeugAus(name: string, input: any, ctx: TodoAufraeumenKontext): Promise<string> {
  if (!istTodoAufraeumenWerkzeug(name)) return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere, heute } = ctx
  const email = adresse(mitarbeiter.email)
  if (!email) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt, darum gibt es keine eigene To-do-Liste.'
  const privat = ctx.privat === true
  if (!privat) {
    const hatPrivat = await (ctx.privatBotAktiv ?? ((e: string) => privatBotAktivStandard(supabase, e)))(email).catch(() => false)
    if (hatPrivat) return 'Seine eigene To-do-Liste ist privat (sie läuft über seinen privaten Assistenten und Microsoft To Do). Aufräumen geht dort: Er schreibt dem privaten Assistenten „räum meine To-dos auf“, oder im CRM in der To-Do-Liste über den Knopf „Aufräumen“.'
  }

  let todos: AufraeumTodo[]
  try {
    todos = await ladeOffeneTodos(supabase, { besitzer: email })
  } catch (e) {
    return `Fehler beim Lesen der To-dos: ${e instanceof Error ? e.message : e}`
  }
  // Im Mayer-Bot nie Aufgaben aus dem privaten Microsoft To Do.
  if (!privat) todos = todos.filter((t) => !t.ms_id)
  const tageAlt = Math.min(730, Math.max(30, Number(input?.tage_alt) || 90))
  const alle = analysiereTodos(todos, { heute, tageAlt, akten: await ladeAkten(supabase) })
  const listeFilter = String(input?.liste ?? '').trim().toLowerCase()
  const artFilter = AUFRAEUM_ARTEN.includes(input?.art) ? (input.art as AufraeumArt) : null
  const passend = alle.filter((v) => (!artFilter || v.art === artFilter) && (!listeFilter || v.liste_name.toLowerCase().includes(listeFilter)))
  const nachId = new Map(todos.map((t) => [t.id, t]))
  const wo = privat ? 'seiner privaten To-do-Liste' : 'seiner eigenen To-do-Liste'

  // ---------- Anwenden ----------
  if (input?.bestaetigt === true) {
    const rohAktion = String(input?.aktion ?? 'vorschlag')
    const aktion: AufraeumAktion | null = rohAktion === 'erledigen' || rohAktion === 'verschieben' || rohAktion === 'loeschen' ? rohAktion : null
    const datum = String(input?.datum ?? '').trim()
    if (aktion === 'verschieben' && datum && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return `Fehler: Datum „${datum}“ nicht erkannt. Nutze JJJJ-MM-TT.`
    if (aktion === 'verschieben' && datum && datum < heute) return 'Fehler: Das neue Datum liegt in der Vergangenheit.'
    let auswahl: AufraeumVorschlag[] = []
    const nichtVorgeschlagen: string[] = []
    const code = String(input?.gruppe ?? '').trim()
    const ids: string[] = Array.isArray(input?.todo_ids) ? input.todo_ids.map((x: unknown) => String(x).trim()).filter(Boolean) : []
    if (code) {
      const topf = toepfe(alle).find((t) => t.code === code)
      if (!topf) return 'Fehler: Diese Gruppe passt nicht mehr zum aktuellen Stand (inzwischen geändert oder anderer Wert für tage_alt). Nichts geändert — bitte die Vorschläge neu abrufen und noch einmal bestätigen lassen.'
      auswahl = topf.vorschlaege
    } else if (ids.length) {
      if (ids.length > HOECHSTENS_IDS) return `Fehler: Höchstens ${HOECHSTENS_IDS} todo_ids auf einmal — für mehr eine Gruppe (gruppe=<Code>) nehmen.`
      const gewaehlt = new Set(ids)
      for (const v of alle) {
        const treffer = v.todo_ids.filter((id) => gewaehlt.has(id))
        if (treffer.length === 0) continue
        if (v.art === 'doppelt' && v.behalten_id) {
          // Nur die genannten anderen; die behaltene bleibt in jedem Fall.
          const andere = treffer.filter((id) => id !== v.behalten_id)
          if (andere.length === 0 && aktion !== 'verschieben') continue
          auswahl.push({ ...v, todo_ids: [v.behalten_id, ...andere] })
        } else auswahl.push({ ...v, todo_ids: treffer })
      }
      const vorgeschlagen = new Set(auswahl.flatMap((v) => v.todo_ids))
      for (const id of ids) if (!vorgeschlagen.has(id)) nichtVorgeschlagen.push(id)
    } else return 'Fehler: Zum Anwenden gruppe=<Code> oder todo_ids angeben (aus der Vorschau).'

    const aenderungen: TodoAenderung[] = []
    const zaehler = { erledigt: 0, verschoben: 0, geloescht: 0, zusammengefuehrt: 0 }
    for (const v of auswahl) {
      // „erledigen“ bei Doppeln heißt zusammenführen (sonst wäre auch die behaltene weg).
      const a: AufraeumAktion | undefined = aktion === 'erledigen' && v.art === 'doppelt' ? 'zusammenfuehren' : aktion ?? undefined
      const liste = aenderungenFuer(v, nachId, { heute, aktion: a, datum: datum || undefined })
      for (const x of liste) {
        if (x.loeschen) zaehler.geloescht++
        else if (x.felder?.erledigt_am) (v.art === 'doppelt' ? zaehler.zusammengefuehrt++ : zaehler.erledigt++)
        else if (x.felder?.erledigen_bis && !(v.art === 'doppelt' && x.id === v.behalten_id)) zaehler.verschoben++
      }
      aenderungen.push(...liste)
    }
    if (aenderungen.length === 0) {
      return `Nichts geändert: Keine der genannten Aufgaben ist (noch) offen und vorgeschlagen.${nichtVorgeschlagen.length ? ` Nicht vorgeschlagen: ${nichtVorgeschlagen.slice(0, 10).join(', ')}.` : ''}`
    }
    const { buendel, loeschen } = buendele(aenderungen)
    const fehler: string[] = []
    for (const b of buendel) {
      for (const teil of stuecke(b.ids)) {
        const { error } = await supabase.from('todos').update(b.felder).in('id', teil).eq('besitzer_email', email).is('bereich', null)
        if (error) fehler.push(error.message)
      }
    }
    for (const teil of stuecke(loeschen)) {
      const { error } = await supabase.from('todos').delete().in('id', teil).eq('besitzer_email', email).is('bereich', null)
      if (error) fehler.push(error.message)
    }
    const teile = [
      zaehler.erledigt ? `${zahl(zaehler.erledigt)} abgehakt` : '',
      zaehler.zusammengefuehrt ? `${zahl(zaehler.zusammengefuehrt)} Doppel abgehakt (je eine Aufgabe bleibt)` : '',
      zaehler.verschoben ? `${zahl(zaehler.verschoben)} verschoben` : '',
      zaehler.geloescht ? `${zahl(zaehler.geloescht)} gelöscht` : '',
    ].filter(Boolean)
    const geaenderteIds = [...new Set(aenderungen.map((a) => a.id))]
    protokolliere(`To-dos aufgeräumt in ${wo}: ${teile.join(', ')} (todo_ids=${geaenderteIds.slice(0, 15).join(',')}${geaenderteIds.length > 15 ? ` … +${geaenderteIds.length - 15}` : ''})`)
    const hatMs = geaenderteIds.some((id) => nachId.get(id)?.ms_id)
    return [
      fehler.length ? `Fehler bei einem Teil: ${fehler.slice(0, 2).join(' | ')}. Erledigt wurde: ${teile.join(', ') || 'nichts'}.` : `Aufgeräumt in ${wo}: ${teile.join(', ')}.`,
      zaehler.erledigt || zaehler.zusammengefuehrt ? `Abgehakte tragen im aktuellen Stand den Vermerk „${vermerk('alt', heute).split(':')[0]}: …“ und lassen sich im CRM unter „Erledigt“ wieder öffnen.` : '',
      hatMs ? 'In Microsoft To Do erscheint das beim nächsten Abgleich (alle 3 Minuten; bei sehr vielen Aufgaben dauert es einige Durchläufe).' : '',
      nichtVorgeschlagen.length ? `Unverändert (nicht vorgeschlagen): ${nichtVorgeschlagen.slice(0, 10).join(', ')}${nichtVorgeschlagen.length > 10 ? ' …' : ''}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  // ---------- Vorschau ----------
  if (todos.length === 0) return `In ${wo} ist nichts offen — nichts aufzuräumen.`
  if (passend.length === 0) {
    return `Keine Aufräum-Vorschläge${artFilter ? ` der Art „${ART_NAME[artFilter]}“` : ''}${listeFilter ? ` in Listen mit „${input.liste}“` : ''} in ${wo} (${zahl(todos.length)} offen, Grenze für alt: ${tageAlt} Tage).`
  }
  const zeilen: string[] = []
  const betroffen = new Set(passend.flatMap((v) => v.todo_ids.filter((id) => id !== v.behalten_id))).size
  zeilen.push(`Aufräum-Vorschläge für ${wo} (${zahl(todos.length)} offen, davon ${zahl(betroffen)} betroffen; alt = über ${tageAlt} Tage ohne Frist unberührt). Noch nichts geändert.`)
  for (const z of zusammenfassen(passend)) {
    const v = passend.filter((x) => x.art === z.art)
    const akt = [...new Set(v.map((x) => AKTION_NAME[x.vorschlag].toLowerCase()))].join('/')
    zeilen.push(z.art === 'doppelt' ? `- ${ART_NAME[z.art]}: ${zahl(z.vorschlaege)} Gruppen, ${zahl(z.todos)} Aufgaben zu viel → ${akt}` : `- ${ART_NAME[z.art]}: ${zahl(z.todos)} → ${akt}`)
  }
  const einzeln = !!artFilter || !!listeFilter
  const toepfeListe = toepfe(passend)
  zeilen.push('Gruppen zum Bestätigen (gruppe=Code):')
  for (const t of toepfeListe.slice(0, einzeln ? 6 : 15)) {
    const beispiele = t.vorschlaege.slice(0, 2).map((v) => `„${kurz(nachId.get(v.behalten_id ?? v.todo_ids[0])?.aufgabe ?? '', 40)}“`).join(', ')
    zeilen.push(`- ${ART_NAME[t.art]} · ${t.liste_name} · ${zahl(t.anzahl)} · ${aktionText(t.vorschlaege[0])} · gruppe=${t.code} (z. B. ${beispiele})`)
  }
  if (toepfeListe.length > (einzeln ? 6 : 15)) zeilen.push(`… und ${toepfeListe.length - (einzeln ? 6 : 15)} weitere Gruppen (mit art oder liste eingrenzen).`)
  if (einzeln) {
    zeilen.push('Einzelne Aufgaben:')
    for (const v of passend.slice(0, 40)) {
      if (v.art === 'doppelt') {
        zeilen.push(`- Doppelt: bleibt „${kurz(nachId.get(v.behalten_id!)?.aufgabe ?? '')}“ (todo_id=${v.behalten_id}); weg: ${v.todo_ids.filter((id) => id !== v.behalten_id).join(', ')}`)
      } else {
        zeilen.push(`- „${kurz(nachId.get(v.todo_ids[0])?.aufgabe ?? '')}“ · ${v.grund} → ${aktionText(v)} (todo_id=${v.todo_ids[0]})`)
      }
    }
    if (passend.length > 40) zeilen.push(`… und ${zahl(passend.length - 40)} weitere.`)
  }
  zeilen.push('Anwenden nur nach seinem Ja: bestaetigt=true mit gruppe=<Code> (gleiches tage_alt) oder todo_ids. Standard: abhaken mit Vermerk „aufgeräumt“; löschen nur, wenn er es ausdrücklich will (aktion=loeschen).')
  return zeilen.join('\n')
}
