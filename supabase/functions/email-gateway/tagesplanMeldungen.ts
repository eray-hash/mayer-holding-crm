// Telegram-Meldungen zum Tagesablauf (Runde 5, 22.11.2026) — vom Minutentakt termin_erinnerungen gerufen, ohne KI.
//
// - Morgens „Dein Tag“: werktags (Mo–Fr) beim ersten Takt ab 7:45 Uhr Berliner Zeit (bis 9:30; ein verpasster Morgen wird
//   nicht nachgeholt). Gibt es für heute noch keinen Plan, baut der Server ihn wie der Knopf „Tag vorschlagen“
//   (_shared/tagesplanKern.ts: Termine, Fristsachen, Offenes vom letzten Plan, A/B/C nach Prio und Umsatz) und speichert
//   ihn — die Seite zeigt dann genau das, was in der Nachricht steht. Inhalt: Termine, Fristsachen, A-Aufgaben, Zahl der
//   übrigen, möglicher Umsatz, Link zur Seite. Ohne offenen Eintrag keine Nachricht.
// - Abends „Offen geblieben — morgen übernehmen?“: werktags ab 17:30 (bis 19:00), nur wenn heute ein Plan mit offenen
//   Aufgaben existiert. Das Offene übernimmt der nächste Morgen automatisch.
// - Einstellung je Mitarbeiter in tagesplan_einstellungen (morgen_an, abend_an; keine Zeile = aus; für Quirin beim
//   Einspielen an). Nur aktive Mitarbeiter mit Telegram.
// - Höchstens einmal je Person, Art und Tag: Vor dem Senden wird die Sperrzeile `morgen|<adresse>|<datum>` in
//   tagesplan_meldungen angelegt; wer sie nicht anlegen kann (schon da, Tabelle fehlt), sendet nicht. Klappt das Senden
//   nicht, wird es nicht wiederholt.
// - Wirft nie: Fehler stehen im Ergebnis.

import { ladeLinkBasis } from '../_shared/terminBriefingKern.ts'
import { abendText, morgenText, schlageTagVor } from '../_shared/tagesplanKern.ts'
import { ladePlan, ladeTagDaten, leererPlan, speicherePlan, type TagPerson } from '../_shared/tagesplanLaden.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type Senden = (chat: number | string, text: string) => Promise<boolean>
export type TagesplanMeldungErgebnis = { morgen: number; abend: number; fehler: string[] }

const MORGEN_AB = 7 * 60 + 45
const MORGEN_BIS = 9 * 60 + 30
const ABEND_AB = 17 * 60 + 30
const ABEND_BIS = 19 * 60
const TABELLE = 'tagesplan_meldungen'
const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function fenster(jetzt: Date): { art: 'morgen' | 'abend'; datum: string; wochentag: number } | null {
  const b = berlinZeit(jetzt)
  if (b.wochentag < 1 || b.wochentag > 5) return null
  const min = b.stunde * 60 + b.minute
  if (min >= MORGEN_AB && min < MORGEN_BIS) return { art: 'morgen', datum: b.datum, wochentag: b.wochentag }
  if (min >= ABEND_AB && min < ABEND_BIS) return { art: 'abend', datum: b.datum, wochentag: b.wochentag }
  return null
}

export function seitenLink(basis: string): string {
  return `${basis.endsWith('/') ? basis : `${basis}/`}#/immobilien/tagesablauf`
}

export async function sendeTagesplanMeldungen(admin: Db, o: { sende: Senden; jetzt?: Date; linkBasis?: string }): Promise<TagesplanMeldungErgebnis> {
  const ergebnis: TagesplanMeldungErgebnis = { morgen: 0, abend: 0, fehler: [] }
  try {
    const f = fenster(o.jetzt ?? new Date())
    if (!f) return ergebnis
    const spalte = f.art === 'morgen' ? 'morgen_an' : 'abend_an'
    const { data: wollen, error } = await admin.from('tagesplan_einstellungen').select('email').eq(spalte, true)
    if (error) {
      ergebnis.fehler.push(`Einstellungen nicht lesbar: ${error.message}`)
      return ergebnis
    }
    const adressen = ((wollen ?? []) as { email: string }[]).map((w) => String(w.email ?? '').trim().toLowerCase()).filter(Boolean)
    if (!adressen.length) return ergebnis
    const ids = adressen.map((e) => `${f.art}|${e}|${f.datum}`)
    const { data: schon } = await admin.from(TABELLE).select('id').in('id', ids)
    const erledigt = new Set(((schon ?? []) as { id: string }[]).map((x) => x.id))
    const offen = adressen.filter((e) => !erledigt.has(`${f.art}|${e}|${f.datum}`))
    if (!offen.length) return ergebnis

    const { data: team } = await admin.from('mitarbeiter').select('name, email, rolle, ist_admin, bereiche, telegram_chat_id, aktiv').eq('aktiv', true)
    // deno-lint-ignore no-explicit-any
    const nachAdresse = new Map(((team ?? []) as any[]).map((m) => [String(m.email ?? '').toLowerCase(), m]))
    const link = seitenLink(o.linkBasis ?? (await ladeLinkBasis(admin)))

    for (const email of offen) {
      const m = nachAdresse.get(email)
      if (!m || !m.telegram_chat_id) continue
      const id = `${f.art}|${email}|${f.datum}`
      const { error: sperre } = await admin.from(TABELLE).insert({ id, email, art: f.art, datum: f.datum })
      if (sperre) {
        if (sperre.code !== '23505') ergebnis.fehler.push(`Meldung nicht vermerkt (${sperre.message}) — nicht gesendet.`)
        continue
      }
      try {
        const person: TagPerson = { name: String(m.name), email, rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: Array.isArray(m.bereiche) ? m.bereiche : [] }
        const text = f.art === 'morgen' ? await morgenNachricht(admin, person, f.datum, WOCHENTAG[f.wochentag], link, ergebnis.fehler) : await abendNachricht(admin, person, f.datum, link)
        if (!text) continue
        const ok = await o.sende(m.telegram_chat_id, text)
        await admin.from(TABELLE).update({ zugestellt: ok }).eq('id', id)
        if (ok) ergebnis[f.art] += 1
      } catch (err) {
        ergebnis.fehler.push(`${email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}

/** Plan von heute (oder, wenn es keinen gibt, der Vorschlag — dann gespeichert) als Morgennachricht. */
export async function morgenNachricht(admin: Db, person: TagPerson, datum: string, wochentag: string, link: string, fehler: string[] = []): Promise<string | null> {
  const d = await ladeTagDaten(admin, person, datum)
  fehler.push(...d.fehler.map((x) => `${person.email}: ${x}`))
  let plan = d.plan
  if (!plan || plan.zeilen.length === 0) {
    const basis = plan ?? leererPlan(person.name, datum)
    const v = schlageTagVor({ datum, todos: d.todos, termine: d.termine, wiedervorlagen: d.wiedervorlagen, vortag: d.vortag, bestehend: basis.zeilen })
    plan = { ...basis, zeilen: v.zeilen, vorgeschlagenAm: new Date().toISOString() }
    if (v.neu > 0) {
      const f = await speicherePlan(admin, plan)
      if (f) fehler.push(`${person.email}: Plan nicht gespeichert: ${f}`)
    }
  }
  return morgenText(plan, { link, wochentag })
}

export async function abendNachricht(admin: Db, person: TagPerson, datum: string, link: string): Promise<string | null> {
  const plan = await ladePlan(admin, person.name, datum)
  if (!plan) return null
  // To-dos, die inzwischen anderswo erledigt wurden (Liste, Assistent), zählen nicht als offen.
  const ids = [...new Set(plan.zeilen.map((z) => z.todoId).filter(Boolean))] as string[]
  const fertig = new Set<string>()
  if (ids.length) {
    const { data } = await admin.from('todos').select('id, erledigt_am').in('id', ids)
    for (const t of (data ?? []) as { id: string; erledigt_am: string | null }[]) if (String(t.erledigt_am ?? '').trim()) fertig.add(t.id)
  }
  const zeilen = plan.zeilen.map((z) => (z.todoId && !z.erledigt && fertig.has(z.todoId) ? { ...z, erledigt: true } : z))
  return abendText({ zeilen }, { link })
}
