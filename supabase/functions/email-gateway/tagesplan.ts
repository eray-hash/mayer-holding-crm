// Aktion `tagesplan` (Seite „Tagesablauf & Woche“, Runde 5) — nur mit eigenem Login:
//
//   { action: 'tagesplan', art: 'loesungen', todoId }                → 3 konkrete nächste Schritte für ein festgefahrenes To-do
//                                                                       (Haiku 5.5, gelesen werden To-do und die verknüpfte Akte
//                                                                       bzw. das Objekt). Schreibt nichts.
//   { action: 'tagesplan', art: 'anruf_notieren', bezug: {art,id}, text } → „Anruf: …“ oben in den Verlauf der Akte/des Objekts.
//
// Rechte wie in der Datenbank: To-do nur aus der eigenen Liste, einer freigegebenen Liste oder einer Bereichsliste, die
// man sehen darf; Akte/Objekt über die Prüfungen aus index.ts (als Parameter, keine Importe aus index.ts).

import { kiAufruf } from '../_shared/kiVerbrauch.ts'
import { alsBezug } from '../_shared/tagesplanBezug.ts'
import { berlinTag } from '../_shared/tagesplanLaden.ts'

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export const MODELL = 'claude-haiku-5-5'

export type Loesung = { titel: string; schritt: string; warum: string }
export type KiWerkzeug = { name: string; description: string; input_schema: Record<string, unknown> }
export type KiFrage = (prompt: string, werkzeug: KiWerkzeug, maxTokens: number) => Promise<unknown>

export type TagesplanHelfer = {
  darfKunde: (kundeId: string) => Promise<boolean>
  darfObjekt: (objektId: string) => Promise<boolean>
  darfBereich: (bereich: string) => Promise<boolean>
  /** KI-Aufruf (Standard: Haiku 5.5 über kiAufruf mit ANTHROPIC_API_KEY). */
  ki?: KiFrage
}

export type Antwort = { status: number; body: Record<string, unknown> }

const fehler = (status: number, text: string): Antwort => ({ status, body: { error: text } })

const kurz = (wert: unknown, n: number): string => {
  const t = String(wert ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export async function tagesplanAktion(admin: Db, aufrufer: { email: string }, body: Zeile, h: TagesplanHelfer): Promise<Antwort> {
  const email = String(aufrufer.email ?? '').trim().toLowerCase()
  if (!email) return fehler(401, 'Bitte neu einloggen — der Login-Nachweis fehlt oder ist abgelaufen.')
  if (body.art === 'loesungen') return await loesungen(admin, email, body, h)
  if (body.art === 'anruf_notieren') return await anrufNotieren(admin, email, body, h)
  return fehler(400, 'Unbekannte Art — erwartet "loesungen" oder "anruf_notieren".')
}

// ── Darf die Person das To-do sehen? ──────────────────────────────────────────────────────────────

export async function darfTodo(admin: Db, email: string, t: Zeile, h: Pick<TagesplanHelfer, 'darfBereich'>): Promise<boolean> {
  if (t.bereich) return await h.darfBereich(String(t.bereich))
  if (String(t.besitzer_email ?? '').toLowerCase() === email) return true
  const { data } = await admin.from('todo_freigaben').select('id').eq('besitzer_email', t.besitzer_email).eq('empfaenger_email', email).limit(1)
  return (data ?? []).length > 0
}

// ── Lösungsvorschläge ─────────────────────────────────────────────────────────────────────────────

const WERKZEUG: KiWerkzeug = {
  name: 'loesungen_vorschlagen',
  description: 'Genau drei konkrete, verschiedene nächste Schritte für eine festgefahrene Aufgabe.',
  input_schema: {
    type: 'object',
    properties: {
      vorschlaege: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            titel: { type: 'string', description: 'Kurzer Titel, höchstens 8 Wörter.' },
            schritt: { type: 'string', description: 'Was genau als Nächstes zu tun ist — eine Handlung, die heute machbar ist (wen anrufen, was schreiben, was prüfen).' },
            warum: { type: 'string', description: 'Ein Satz: warum das die Aufgabe voranbringt.' },
          },
          required: ['titel', 'schritt', 'warum'],
        },
      },
    },
    required: ['vorschlaege'],
  },
}

async function akteZusammenfassung(admin: Db, bezug: { art: 'objekt' | 'kunde'; id: string }, h: TagesplanHelfer): Promise<string> {
  if (bezug.art === 'kunde') {
    if (!(await h.darfKunde(bezug.id))) return ''
    const { data: k } = await admin.from('kunden').select('firma, ansprechpartner, bereich, status, sachverhalt, naechste_schritte, activities').eq('id', bezug.id).maybeSingle()
    if (!k || k.bereich === 'privat') return ''
    const verlauf = (Array.isArray(k.activities) ? k.activities : []).slice(0, 6).map((a: Zeile) => `- ${String(a.date ?? '').slice(0, 10)} ${kurz(a.text, 200)}`)
    return [`Akte: ${kurz(k.firma || k.ansprechpartner, 120)} (Status: ${kurz(k.status, 40)})`, k.sachverhalt ? `Sachverhalt: ${kurz(k.sachverhalt, 500)}` : '', k.naechste_schritte ? `Nächste Schritte laut Akte: ${kurz(k.naechste_schritte, 300)}` : '', verlauf.length ? `Letzter Verlauf:\n${verlauf.join('\n')}` : '']
      .filter(Boolean)
      .join('\n')
  }
  if (!(await h.darfObjekt(bezug.id))) return ''
  const { data: o } = await admin.from('objekte').select('bezeichnung, adresse, typ, kaufpreis, status, activities, privat_besitzer').eq('id', bezug.id).maybeSingle()
  if (!o) return ''
  const verlauf = (Array.isArray(o.activities) ? o.activities : []).slice(0, 6).map((a: Zeile) => `- ${String(a.date ?? '').slice(0, 10)} ${kurz(a.text, 200)}`)
  return [`Objekt: ${kurz(o.bezeichnung, 120)}${o.adresse ? `, ${kurz(o.adresse, 80)}` : ''} (${kurz(o.typ, 30)}, Status: ${kurz(o.status, 30)}${o.kaufpreis ? `, Kaufpreis ${o.kaufpreis} €` : ''})`, verlauf.length ? `Letzter Verlauf:\n${verlauf.join('\n')}` : '']
    .filter(Boolean)
    .join('\n')
}

export function loesungsPrompt(t: Zeile, akte: string): string {
  const felder = [
    ['Kunde/Projekt', t.kunde_projekt],
    ['Aufgabe', t.aufgabe],
    ['Prio', t.prio],
    ['Umsatz-Wert (€)', t.umsatz_wert],
    ['Aktueller Stand', t.aktueller_stand],
    ['Offene Fragen', t.welche_fragen],
    ['Bisher geplante nächste Schritte', t.naechste_schritte],
    ['Zuständig', t.zustaendig],
    ['Warten auf', t.warten_auf],
  ]
    .filter(([, w]) => String(w ?? '').trim())
    .map(([k, w]) => `${k}: ${kurz(w, 700)}`)
  return [
    'Du hilfst einem Mitarbeiter der Immobilienabteilung einer Unternehmensgruppe in Ulm (Makler, Bewertung, Vermarktung, Projektentwicklung).',
    'Eine Aufgabe aus seiner To-do-Liste kommt nicht voran. Schlage genau drei verschiedene, konkrete nächste Schritte vor, die er heute oder morgen selbst erledigen kann.',
    'Regeln: Deutsch, einfache Sprache, keine englischen Wörter, keine Floskeln. Jeder Vorschlag ist eine echte Handlung (wen anrufen, was schreiben, was prüfen, welche Unterlage anfordern). Verschiedene Wege, nicht dreimal dasselbe. Erfinde keine Namen, Zahlen oder Fakten, die nicht unten stehen. Die Stichpunkte des Mitarbeiters sind oft abgekürzt (QL = Quirin Lutzenberger, HS = Hasan Süslü, A.M = Andreas Mayer, Datumsangaben wie „18.11“ = Notiz von diesem Tag, die neueste steht meist vorn).',
    '',
    '<aufgabe>',
    ...felder,
    '</aufgabe>',
    akte ? `<akte>\n${akte}\n</akte>` : '',
  ]
    .filter((x) => x !== '')
    .join('\n')
}

export function haikuFrage(apiKey: string): KiFrage {
  return async (prompt, werkzeug, maxTokens) => {
    const antwort = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: MODELL,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        tools: [werkzeug],
        tool_choice: { type: 'tool', name: werkzeug.name },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!antwort.ok) throw new Error(`KI-Dienst antwortet mit ${antwort.status}: ${(await antwort.text().catch(() => '')).slice(0, 200)}`)
    const daten = await antwort.json()
    const block = daten?.content?.find((c: Zeile) => c.type === 'tool_use')
    if (!block?.input) throw new Error('Keine verwertbare Antwort vom KI-Dienst')
    return block.input
  }
}

export function bereinigeLoesungen(roh: unknown): Loesung[] {
  const liste = Array.isArray((roh as Zeile)?.vorschlaege) ? (roh as Zeile).vorschlaege : []
  return liste
    .map((v: Zeile) => ({ titel: kurz(v?.titel, 80), schritt: kurz(v?.schritt, 400), warum: kurz(v?.warum, 300) }))
    .filter((v: Loesung) => v.titel && v.schritt)
    .slice(0, 3)
}

async function loesungen(admin: Db, email: string, body: Zeile, h: TagesplanHelfer): Promise<Antwort> {
  const todoId = String(body.todoId ?? '').trim()
  if (!todoId) return fehler(400, 'todoId fehlt.')
  const { data: t, error } = await admin.from('todos').select('*').eq('id', todoId).maybeSingle()
  if (error) return fehler(500, `To-do nicht lesbar: ${error.message}`)
  if (!t) return fehler(404, 'Dieses To-do gibt es nicht mehr.')
  if (!(await darfTodo(admin, email, t, h))) return fehler(403, 'Dieses To-do gehört nicht zu deiner Liste.')
  const bezug = alsBezug(t.bezug)
  const akte = bezug ? await akteZusammenfassung(admin, bezug, h) : ''
  let ki = h.ki
  if (!ki) {
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) return fehler(503, 'Der KI-Dienst ist nicht eingerichtet.')
    ki = haikuFrage(key)
  }
  try {
    const vorschlaege = bereinigeLoesungen(await ki(loesungsPrompt(t, akte), WERKZEUG, 1200))
    if (vorschlaege.length === 0) return fehler(502, 'Es kamen keine brauchbaren Vorschläge zurück. Bitte noch einmal versuchen.')
    return { status: 200, body: { vorschlaege, mitAkte: akte !== '' } }
  } catch (err) {
    return fehler(502, `Die Vorschläge konnten nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── Anruf notieren ────────────────────────────────────────────────────────────────────────────────

async function anrufNotieren(admin: Db, email: string, body: Zeile, h: TagesplanHelfer): Promise<Antwort> {
  const bezug = alsBezug(body.bezug)
  const text = kurz(body.text, 1500)
  if (!bezug) return fehler(400, 'Akte oder Objekt fehlt.')
  if (!text) return fehler(400, 'Was ist beim Anruf herausgekommen? Der Text fehlt.')
  const erlaubt = bezug.art === 'kunde' ? await h.darfKunde(bezug.id) : await h.darfObjekt(bezug.id)
  if (!erlaubt) return fehler(403, 'Diese Akte ist für dich nicht freigegeben.')
  const { data: team } = await admin.from('mitarbeiter').select('name, email')
  const m = ((team ?? []) as Zeile[]).find((x) => String(x.email ?? '').toLowerCase() === email)
  const name = String(m?.name ?? email)
  const heute = berlinTag(new Date())
  const tabelle = bezug.art === 'kunde' ? 'kunden' : 'objekte'
  // Verlauf frisch lesen und nur diese Spalte(n) schreiben — nie die ganze Zeile.
  const { data: zeile, error } = await admin.from(tabelle).select('id, activities').eq('id', bezug.id).maybeSingle()
  if (error) return fehler(500, `Verlauf nicht lesbar: ${error.message}`)
  if (!zeile) return fehler(404, 'Diese Akte gibt es nicht mehr.')
  const eintrag = { id: `act_${crypto.randomUUID().slice(0, 12)}`, date: heute, text: `Anruf: ${text}`, user: name }
  const patch: Zeile = { activities: [eintrag, ...(Array.isArray(zeile.activities) ? zeile.activities : [])], updated_at: new Date().toISOString() }
  if (bezug.art === 'kunde') patch.letzte_aktivitaet = heute
  const { error: schreib } = await admin.from(tabelle).update(patch).eq('id', bezug.id)
  if (schreib) return fehler(500, `Anruf nicht gespeichert: ${schreib.message}`)
  return { status: 200, body: { ok: true, eintrag } }
}
