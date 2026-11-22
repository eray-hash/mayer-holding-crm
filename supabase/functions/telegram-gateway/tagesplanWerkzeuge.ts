// Assistent-Werkzeuge für den Tagesablauf (Seite „Tagesablauf & Woche“, Runde 5, 22.11.2026).
//
// Ein Tag = eine Zeile in abteilung_eintraege (art 'tagesplan', id `${name}|${datum}`), Aufbau wie Quirins Vorlage:
// Organisatorisch, Fristsachen, A (ca. 2 Std.), B (ca. 1,5 Std.), C (ca. 1 Std.), kurze Arbeiten, Unvorhergesehenes.
// Regeln und Texte: _shared/tagesplanKern.ts, Laden/Speichern: _shared/tagesplanLaden.ts.
//
// Rechte (der Assistent arbeitet mit Dienstrechten): Ändern nur am EIGENEN Tag. Ansehen dürfen die Tage der Kollegen alle
// mit Immobilien-Recht (wie die Seite), nur lesend. Abhaken eines Eintrags mit To-do hakt das To-do nur ab, wenn es in der
// eigenen Liste steht; Wiedervorlagen nur, wenn der Bereich freigegeben ist. Jede Änderung liest den Plan frisch und
// schreibt ihn ganz zurück (ein Tag, eine Zeile).

import { darfBereich, type RechteMitarbeiter } from './rechte.ts'
import {
  BLOCK_REIHENFOLGE,
  BLOCK_TITEL,
  bilanz,
  dauerText,
  euro,
  minutenZuUhr,
  type PlanBlock,
  type PlanTag,
  type PlanZeile,
  schlageTagVor,
  STANDARD_START,
  textSchluessel,
  todoText,
  zeitplan,
  dauerVonTodo,
} from '../_shared/tagesplanKern.ts'
import { alsPlanTodo, ladeEigeneTodos, ladePlan, ladeTagDaten, leererPlan, speicherePlan, type TagPerson } from '../_shared/tagesplanLaden.ts'
import { type BezugKandidat, findeBezugImText } from '../_shared/tagesplanBezug.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type TagesplanKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; email?: string | null }
  protokolliere: (text: string) => void
  heute: string
}

const BLOCK_ENUM = ['frist', 'A', 'B', 'C', 'kurz', 'unvorhergesehen', 'organisation']
const KUERZEL: Record<PlanBlock, string> = { organisation: 'O', frist: 'F', A: 'A', B: 'B', C: 'C', kurz: 'K', unvorhergesehen: 'U' }

export const TAGESPLAN_WERKZEUGE = [
  {
    name: 'tag_zeigen',
    description:
      'Zeigt den Tagesablauf (Tagesplan) eines Tages: Termine mit Uhrzeit, Fristsachen, A-, B-, C-Aufgaben, kurze Arbeiten, Unvorhergesehenes — mit Zeiten von–bis, Häkchen, Umsatz und Bilanz. Für „Was steht heute an?“, „Zeig mir meinen Tag“, „Was hat Quirin heute vor?“. Liefert die Kürzel (F1, A1, B2 …) für tag_eintrag_erledigt/tag_eintrag_entfernen. Gibt es noch keinen Plan, sag das und biete tag_vorschlagen an.',
    input_schema: {
      type: 'object',
      properties: {
        datum: { type: 'string', description: 'JJJJ-MM-TT; ohne Angabe heute.' },
        wer: { type: 'string', description: 'Name oder Vorname eines Kollegen (nur lesen); leer = der Fragende selbst.' },
      },
    },
  },
  {
    name: 'tag_vorschlagen',
    description:
      'Baut den eigenen Tagesplan automatisch aus der eigenen To-do-Liste und speichert ihn: Termine aus dem Kalender als feste Zeiten, Fristsachen (fällige/überfällige To-dos und Wiedervorlagen), Offenes vom letzten Plan, dann A/B/C nach Prio und Umsatz (A ca. 2 Std., B 1,5 Std., C 1 Std.), kurze Arbeiten bis 10 Minuten; Unvorhergesehenes bleibt frei. Was schon im Plan steht, bleibt; nichts kommt doppelt. Für „Plan mir meinen Tag“, „Mach mir den Tagesablauf für morgen“.',
    input_schema: {
      type: 'object',
      properties: { datum: { type: 'string', description: 'JJJJ-MM-TT; ohne Angabe heute.' } },
    },
  },
  {
    name: 'tag_eintrag_erledigt',
    description:
      'Hakt einen Eintrag im eigenen Tagesplan ab (oder wieder auf). Hängt ein To-do dran, wird es mit erledigt (Ist-Zeit wird dazugezählt, wenn angegeben); bei einer Wiedervorlage aus einer Akte ebenso. Für „Ebay-Anzeige ist erledigt“, „A1 fertig, hat 40 Minuten gedauert“.',
    input_schema: {
      type: 'object',
      properties: {
        eintrag: { type: 'string', description: 'Kürzel aus tag_zeigen (z. B. "A1", "F2"), id des Eintrags oder ein eindeutiges Stichwort aus dem Text.' },
        erledigt: { type: 'boolean', description: 'false = wieder öffnen. Vorgabe true.' },
        ist_minuten: { type: 'integer', minimum: 1, maximum: 600, description: 'Optional: tatsächlich gebrauchte Minuten.' },
        datum: { type: 'string', description: 'JJJJ-MM-TT; ohne Angabe heute.' },
      },
      required: ['eintrag'],
    },
  },
  {
    name: 'tag_eintrag_hinzufuegen',
    description:
      'Setzt eine Aufgabe in einen Block des eigenen Tagesplans („setz mir Gutachten Vöhringen als B-Aufgabe heute“, „morgen als Fristsache: Bank anrufen“). Passt der Text eindeutig zu einem offenen To-do der eigenen Liste, wird es verknüpft (Abhaken hakt dann das To-do ab); Akte/Objekt wird erkannt, wenn der Name eindeutig ist.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Was zu tun ist.' },
        block: { type: 'string', enum: BLOCK_ENUM, description: 'frist = Fristsache (unbedingt erledigen), A/B/C, kurz = kurze Arbeit (3–10 Min.), unvorhergesehen, organisation.' },
        dauer_min: { type: 'integer', minimum: 1, maximum: 480, description: 'Optional: geplante Minuten.' },
        todo_id: { type: 'string', description: 'Optional: id eines To-dos der eigenen Liste.' },
        datum: { type: 'string', description: 'JJJJ-MM-TT; ohne Angabe heute.' },
      },
      required: ['text', 'block'],
    },
  },
  {
    name: 'tag_eintrag_entfernen',
    description: 'Nimmt einen Eintrag aus dem eigenen Tagesplan (das To-do selbst bleibt unverändert). Für „streich Tinyhäuser aus meinem Tag“.',
    input_schema: {
      type: 'object',
      properties: {
        eintrag: { type: 'string', description: 'Kürzel aus tag_zeigen, id oder eindeutiges Stichwort.' },
        datum: { type: 'string', description: 'JJJJ-MM-TT; ohne Angabe heute.' },
      },
      required: ['eintrag'],
    },
  },
]

export function istTagesplanWerkzeug(name: string): boolean {
  return TAGESPLAN_WERKZEUGE.some((w) => w.name === name)
}

// ── Hilfen ────────────────────────────────────────────────────────────────────────────────────────

function datumVon(v: unknown, heute: string): string | null {
  const s = String(v ?? '').trim()
  if (!s || /^heute$/i.test(s)) return heute
  if (/^morgen$/i.test(s)) {
    const d = new Date(`${heute}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(`${s}T12:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

function deDatum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

/** Kürzel je Zeile: F1, A1, B1 … in Blockreihenfolge. */
export function kuerzelListe(zeilen: PlanZeile[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const b of BLOCK_REIHENFOLGE) {
    zeilen.filter((z) => z.block === b && String(z.was ?? '').trim()).forEach((z, i) => m.set(z.id, `${KUERZEL[b]}${i + 1}`))
  }
  return m
}

/** Eintrag über Kürzel, id oder eindeutiges Stichwort finden. */
export function findeEintrag(zeilen: PlanZeile[], ref: string): { zeile?: PlanZeile; fehler?: string } {
  const r = String(ref ?? '').trim()
  if (!r) return { fehler: 'Fehler: eintrag fehlt. Nimm das Kürzel aus tag_zeigen (z. B. A1).' }
  const kuerzel = kuerzelListe(zeilen)
  const nachKuerzel = zeilen.find((z) => kuerzel.get(z.id)?.toLowerCase() === r.toLowerCase())
  if (nachKuerzel) return { zeile: nachKuerzel }
  const nachId = zeilen.find((z) => z.id === r)
  if (nachId) return { zeile: nachId }
  const s = textSchluessel(r)
  const treffer = zeilen.filter((z) => textSchluessel(z.was).includes(s))
  if (treffer.length === 1) return { zeile: treffer[0] }
  if (treffer.length > 1) return { fehler: `Fehler: „${r}“ passt auf mehrere Einträge: ${treffer.map((z) => `${kuerzel.get(z.id)} ${z.was}`).join('; ')}. Nimm das Kürzel.` }
  return { fehler: `Fehler: Kein Eintrag passt auf „${r}“. Zeig den Tag mit tag_zeigen und nimm das Kürzel.` }
}

export function planText(plan: PlanTag, opts: { fremd?: boolean } = {}): string {
  const zeilen = plan.zeilen.filter((z) => String(z.was ?? '').trim())
  if (!zeilen.length) return `Der Tagesplan von ${plan.mitarbeiter} für ${deDatum(plan.datum)} ist leer.`
  const kuerzel = kuerzelListe(zeilen)
  const zeit = zeitplan(zeilen, plan.startUhr ?? STANDARD_START)
  const nachId = new Map(zeit.eintraege.map((e) => [e.id, e]))
  const teile: string[] = [`Tagesplan von ${plan.mitarbeiter}, ${deDatum(plan.datum)}${plan.ort ? `, Ort: ${plan.ort}` : ''}${opts.fremd ? ' (nur lesen)' : ''}:`]
  for (const b of BLOCK_REIHENFOLGE) {
    const imBlock = zeilen.filter((z) => z.block === b)
    if (!imBlock.length) continue
    teile.push(`${BLOCK_TITEL[b]}:`)
    for (const z of imBlock) {
      const e = nachId.get(z.id)
      const von = e ? `${minutenZuUhr(e.von)}–${minutenZuUhr(e.bis)}` : z.terminId ? 'ganztägig' : ''
      const extra = [z.umsatz ? euro(z.umsatz) : '', z.istMin ? `${z.istMin} Min. gestoppt` : '', z.ausVortag ? `offen seit ${deDatum(z.ausVortag)}` : '', z.todoId ? 'To-do' : '', z.bezug ? `zu ${z.bezug.name}` : ''].filter(Boolean)
      teile.push(`${z.erledigt ? '✅' : '☐'} ${kuerzel.get(z.id)} ${von ? `${von} ` : ''}${z.was}${extra.length ? ` (${extra.join(', ')})` : ''} [id=${z.id}]`)
    }
  }
  const bi = bilanz(zeilen)
  teile.push(`Bilanz: ${bi.erledigt} von ${bi.anzahl} erledigt, geplant ${dauerText(bi.minutenGeplant)}${bi.minutenIst ? `, gestoppt ${dauerText(bi.minutenIst)}` : ''}${bi.umsatzMoeglich ? `, möglicher Umsatz ${euro(bi.umsatzMoeglich)} (davon erledigt ${euro(bi.umsatzErledigt)})` : ''}. Ende ohne Puffer ca. ${minutenZuUhr(zeit.ende)} Uhr.`)
  if (plan.anrufe?.trim()) teile.push(`Anrufe: ${plan.anrufe.trim().slice(0, 500)}`)
  return teile.join('\n').slice(0, 12000)
}

async function teamPerson(supabase: Supa, wer: string): Promise<{ name: string; email: string } | null | 'mehrdeutig'> {
  const { data } = await supabase.from('mitarbeiter').select('name, email').eq('aktiv', true)
  const s = wer.trim().toLowerCase()
  const treffer = ((data ?? []) as { name: string; email: string }[]).filter((m) => m.name.toLowerCase() === s || m.name.toLowerCase().split(/\s+/).includes(s))
  if (treffer.length > 1) return 'mehrdeutig'
  return treffer[0] ?? null
}

function person(m: TagesplanKontext['mitarbeiter']): TagPerson {
  return { name: m.name, email: String(m.email ?? '').toLowerCase(), rolle: m.rolle ?? null, ist_admin: m.ist_admin ?? null, bereiche: m.bereiche ?? [] }
}

async function bezugKandidaten(supabase: Supa, m: RechteMitarbeiter): Promise<BezugKandidat[]> {
  const raus: BezugKandidat[] = []
  if (darfBereich(m, 'immobilien')) {
    const { data: objekte } = await supabase.from('objekte').select('id, bezeichnung, privat_besitzer').is('privat_besitzer', null)
    for (const o of (objekte ?? []) as { id: string; bezeichnung: string }[]) raus.push({ art: 'objekt', id: o.id, name: o.bezeichnung })
    const { data: kunden } = await supabase.from('kunden').select('id, firma, ansprechpartner, bereich').eq('bereich', 'immobilienkunden')
    for (const k of (kunden ?? []) as { id: string; firma: string; ansprechpartner: string; bereich: string }[]) raus.push({ art: 'kunde', id: k.id, name: k.firma || k.ansprechpartner, bereich: k.bereich })
  }
  return raus
}

// ── Ausführung ────────────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export async function fuehreTagesplanWerkzeugAus(name: string, input: any, k: TagesplanKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (mitarbeiter.nurPrivat === true) return 'Der Tagesablauf gehört zum Mayer-CRM — im privaten Assistenten gibt es ihn nicht.'
  if (!darfBereich(mitarbeiter, 'immobilien')) return 'Fehler: Der Tagesablauf (Bereich Immobilien) ist für dich nicht freigegeben.'
  const datum = datumVon(input?.datum, heute)
  if (!datum) return 'Fehler: datum ist kein gültiges Datum (JJJJ-MM-TT).'
  const ich = person(mitarbeiter)
  if (!ich.email) return 'Fehler: Deine Login-Adresse ist unbekannt.'

  if (name === 'tag_zeigen') {
    const wer = String(input?.wer ?? '').trim()
    let name_ = ich.name
    let fremd = false
    if (wer && !/^(ich|mir|mein|meinen|selbst)$/i.test(wer)) {
      const p = await teamPerson(supabase, wer)
      if (p === 'mehrdeutig') return `Fehler: „${wer}“ passt auf mehrere Mitarbeiter. Nimm den vollen Namen.`
      if (!p) return `Fehler: Keinen aktiven Mitarbeiter „${wer}“ gefunden.`
      fremd = p.name !== ich.name
      name_ = p.name
    }
    const plan = await ladePlan(supabase, name_, datum)
    if (!plan || !plan.zeilen.some((z) => String(z.was ?? '').trim())) {
      return fremd ? `${name_} hat für ${deDatum(datum)} keinen Tagesplan gespeichert.` : `Für ${deDatum(datum)} gibt es noch keinen Tagesplan. Mit tag_vorschlagen baue ich ihn aus deiner To-do-Liste und deinen Terminen.`
    }
    return planText(plan, { fremd })
  }

  if (name === 'tag_vorschlagen') {
    const d = await ladeTagDaten(supabase, ich, datum)
    const basis = d.plan ?? leererPlan(ich.name, datum)
    const v = schlageTagVor({ datum, todos: d.todos, termine: d.termine, wiedervorlagen: d.wiedervorlagen, vortag: d.vortag, bestehend: basis.zeilen })
    if (v.neu === 0) return `Nichts Neues: Alles, was für ${deDatum(datum)} ansteht und in die Zeitbudgets passt, steht schon im Plan.\n\n${planText(basis)}`
    // Frisch lesen, damit eine gleichzeitige Änderung im Browser nicht verloren geht: neue Zeilen auf den aktuellen Stand setzen.
    const aktuell = (await ladePlan(supabase, ich.name, datum)) ?? basis
    const vorhanden = new Set(aktuell.zeilen.map((z) => z.id))
    const neu = v.zeilen.filter((z) => !basis.zeilen.some((b) => b.id === z.id) && !vorhanden.has(z.id))
    const plan: PlanTag = { ...aktuell, zeilen: ordneEin(aktuell.zeilen, neu), vorgeschlagenAm: new Date().toISOString() }
    const f = await speicherePlan(supabase, plan)
    if (f) return `Fehler beim Speichern des Plans: ${f}`
    protokolliere(`Tagesplan ${deDatum(datum)} vorgeschlagen (${neu.length} neue Einträge)`)
    const hinweis = [
      d.fehler.length ? `Hinweis: ${d.fehler.join('; ')}` : '',
      v.nichtEingeplant.length ? `Nicht mehr eingeplant (Budgets voll): ${v.nichtEingeplant.length} To-do(s), z. B. ${v.nichtEingeplant.slice(0, 3).map((t) => todoText(t)).join('; ')}.` : '',
    ].filter(Boolean)
    return [`Gespeichert: ${neu.length} neue Einträge im Tagesplan für ${deDatum(datum)}.`, ...hinweis, '', planText(plan)].join('\n')
  }

  // Ab hier: Änderungen am eigenen Plan.
  const plan = await ladePlan(supabase, ich.name, datum)

  if (name === 'tag_eintrag_hinzufuegen') {
    const text = String(input?.text ?? '').replace(/\s+/g, ' ').trim()
    const block = String(input?.block ?? '') as PlanBlock
    if (!text) return 'Fehler: text fehlt.'
    if (!BLOCK_ENUM.includes(block)) return `Fehler: block muss einer von ${BLOCK_ENUM.join(', ')} sein.`
    const basis = plan ?? leererPlan(ich.name, datum)
    const z: PlanZeile = { id: `tz_${crypto.randomUUID().slice(0, 12)}`, block, was: text.slice(0, 300), quelle: 'telegram' }
    const dauer = Number(input?.dauer_min)
    // To-do verknüpfen: angegeben oder eindeutig über den Text.
    const todos = await ladeEigeneTodos(supabase, ich)
    let todo = input?.todo_id ? todos.find((t) => t.id === String(input.todo_id)) : undefined
    if (input?.todo_id && !todo) {
      const { data: t } = await supabase.from('todos').select('*').eq('id', String(input.todo_id)).maybeSingle()
      if (!t || String(t.besitzer_email ?? '').toLowerCase() !== ich.email || t.bereich) return 'Fehler: Dieses To-do steht nicht in deiner eigenen Liste.'
      todo = alsPlanTodo(t)
    }
    if (!todo) {
      const s = textSchluessel(text)
      const passend = todos.filter((t) => {
        const a = textSchluessel(t.aufgabe)
        const kp = textSchluessel(String(t.kundeProjekt ?? ''))
        return (a.length >= 6 && (s.includes(a) || a.includes(s))) || (kp.length >= 5 && s.includes(kp))
      })
      if (passend.length === 1) todo = passend[0]
    }
    if (todo) {
      if (basis.zeilen.some((x) => x.todoId === todo!.id)) {
        const k_ = kuerzelListe(basis.zeilen).get(basis.zeilen.find((x) => x.todoId === todo!.id)!.id)
        return `Dieses To-do steht schon im Plan (${k_}). Soll es in einen anderen Block, nimm es mit tag_eintrag_entfernen heraus und setz es neu.`
      }
      z.todoId = todo.id
      if (todo.umsatzWert) z.umsatz = todo.umsatzWert
      if (todo.bezug) z.bezug = todo.bezug
      if (!Number.isFinite(dauer)) z.dauerMin = dauerVonTodo(todo)
    }
    if (Number.isFinite(dauer) && dauer > 0) z.dauerMin = Math.min(480, Math.round(dauer))
    if (!z.bezug) {
      const t = findeBezugImText(text, await bezugKandidaten(supabase, mitarbeiter))
      if (t) z.bezug = t.bezug
    }
    const neuPlan: PlanTag = { ...basis, zeilen: ordneEin(basis.zeilen, [z]) }
    const f = await speicherePlan(supabase, neuPlan)
    if (f) return `Fehler beim Speichern: ${f}`
    protokolliere(`Tagesplan ${deDatum(datum)}: „${z.was}“ als ${BLOCK_TITEL[block]} eingetragen`)
    const k_ = kuerzelListe(neuPlan.zeilen).get(z.id)
    const budget = { A: 120, B: 90, C: 60, kurz: 60 } as Record<string, number>
    const belegt = neuPlan.zeilen.filter((x) => x.block === block).reduce((s, x) => s + (x.dauerMin ?? 0), 0)
    const warnung = budget[block] && belegt > budget[block] ? ` Achtung: ${BLOCK_TITEL[block]} hat jetzt ${dauerText(belegt)} (geplant sind ca. ${dauerText(budget[block])}).` : ''
    return `Eingetragen: ${k_} „${z.was}“ in ${BLOCK_TITEL[block]} am ${deDatum(datum)}${z.dauerMin ? `, ca. ${z.dauerMin} Min.` : ''}${z.todoId ? ', mit dem To-do verknüpft' : ''}${z.bezug ? `, zu ${z.bezug.name}` : ''}.${warnung} id=${z.id}`
  }

  if (!plan) return `Fehler: Für ${deDatum(datum)} gibt es noch keinen Tagesplan.`
  const r = findeEintrag(plan.zeilen, String(input?.eintrag ?? ''))
  if (r.fehler) return r.fehler
  const z = r.zeile!
  const k_ = kuerzelListe(plan.zeilen).get(z.id) ?? ''

  if (name === 'tag_eintrag_entfernen') {
    const f = await speicherePlan(supabase, { ...plan, zeilen: plan.zeilen.filter((x) => x.id !== z.id) })
    if (f) return `Fehler beim Speichern: ${f}`
    protokolliere(`Tagesplan ${deDatum(datum)}: „${z.was}“ entfernt`)
    return `Entfernt: ${k_} „${z.was}“ aus dem Tagesplan vom ${deDatum(datum)}.${z.todoId ? ' Das To-do selbst bleibt offen in der Liste.' : ''}`
  }

  if (name === 'tag_eintrag_erledigt') {
    const erledigt = input?.erledigt !== false
    const ist = Number(input?.ist_minuten)
    const istMin = Number.isFinite(ist) && ist > 0 ? Math.min(600, Math.round(ist)) : 0
    const geaendert: PlanZeile = { ...z, erledigt }
    if (!erledigt) delete geaendert.erledigt
    if (istMin) geaendert.istMin = (z.istMin ?? 0) + istMin
    if (geaendert.laeuftSeit) delete geaendert.laeuftSeit
    const zusatz: string[] = []
    if (z.todoId) {
      const { data: t } = await supabase.from('todos').select('id, besitzer_email, bereich, erledigt_am, ist_zeit').eq('id', z.todoId).maybeSingle()
      if (t && !t.bereich && String(t.besitzer_email ?? '').toLowerCase() === ich.email) {
        const patch: Record<string, unknown> = { erledigt_am: erledigt ? heute : null }
        if (istMin) patch.ist_zeit = Number(t.ist_zeit ?? 0) + istMin
        const { error } = await supabase.from('todos').update(patch).eq('id', t.id)
        zusatz.push(error ? `To-do nicht geändert: ${error.message}` : erledigt ? 'To-do in der Liste abgehakt' : 'To-do wieder offen')
      } else if (t) zusatz.push('das To-do gehört nicht zu deiner Liste und bleibt unverändert')
    }
    if (z.wvId) {
      const { data: w } = await supabase.from('wiedervorlagen').select('id, bereich, erledigt_am').eq('id', z.wvId).maybeSingle()
      if (w && darfBereich(mitarbeiter, w.bereich)) {
        const { error } = await supabase.from('wiedervorlagen').update(erledigt ? { erledigt_am: new Date().toISOString(), erledigt_von: ich.name } : { erledigt_am: null, erledigt_von: null }).eq('id', w.id)
        zusatz.push(error ? `Wiedervorlage nicht geändert: ${error.message}` : erledigt ? 'Wiedervorlage in der Akte erledigt' : 'Wiedervorlage wieder offen')
      }
    }
    // Plan frisch lesen und nur diese Zeile ersetzen.
    const aktuell = (await ladePlan(supabase, ich.name, datum)) ?? plan
    const f = await speicherePlan(supabase, { ...aktuell, zeilen: aktuell.zeilen.map((x) => (x.id === z.id ? geaendert : x)) })
    if (f) return `Fehler beim Speichern: ${f}`
    protokolliere(`Tagesplan ${deDatum(datum)}: „${z.was}“ ${erledigt ? 'abgehakt' : 'wieder geöffnet'}`)
    const bi = bilanz(aktuell.zeilen.map((x) => (x.id === z.id ? geaendert : x)))
    return `${erledigt ? 'Abgehakt' : 'Wieder offen'}: ${k_} „${z.was}“${istMin ? ` (+${istMin} Min.)` : ''}${zusatz.length ? ` — ${zusatz.join(', ')}` : ''}. Stand: ${bi.erledigt} von ${bi.anzahl} erledigt.`
  }

  return `Fehler: Unbekanntes Werkzeug ${name}.`
}

/** Neue Zeilen hinter die letzte Zeile ihres Blocks setzen (Blockreihenfolge bleibt). */
function ordneEin(zeilen: PlanZeile[], neu: PlanZeile[]): PlanZeile[] {
  const alle = [...zeilen, ...neu]
  return BLOCK_REIHENFOLGE.flatMap((b) => alle.filter((z) => z.block === b))
}
