// Werkzeuge für die Arbeit im Team (Wünsche aus der Nutzungsauswertung vom 18./19.11.2026):
// - kollegen_benachrichtigen: kurze Telegram-Nachricht an Kollegen ("ich habe für X eine Akte angelegt"),
//   ohne dafür einen Termin anzulegen (Wunsch von Andreas).
// - todo_anlegen / todo_erledigen: To-dos ohne Kundenbezug in der eigenen Liste oder einer Bereichsliste,
//   damit sie auf der Seite „Aufgaben nach Mitarbeiter" und in aufgaben_uebersicht erscheinen (Wunsch von Eray).
//
// Die Datei kennt index.ts nicht (kein Kreis-Import): Telegram-Versand und Gesprächszustand reicht der
// Aufrufer als Funktionen herein.

import { alsIso, ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { BEREICH_IDS, bereichName, darfBereich, siehtAlleBereiche, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
type Fragender = RechteMitarbeiter & { id: string; name: string; email?: string | null }

export const HOECHSTENS_EMPFAENGER = 5

/** Was eine Mitteilung braucht: Bot-Versand und Gesprächszustand des Empfängers. */
export type MitteilungsWege = {
  botToken?: string
  // deno-lint-ignore no-explicit-any
  ladeState: (raw: unknown) => any
  // deno-lint-ignore no-explicit-any
  speichereZustand: (supabase: Supa, mitarbeiterId: string, state: any) => Promise<unknown>
}

export type MitteilungsErgebnis = { ok: true; an: string } | { ok: false; grund: string; status: number }

/**
 * Schickt einem Mitarbeiter eine Nachricht über den Bot und legt sie in seinen Gesprächsverlauf.
 * art 'mitteilung': eine Nachricht ohne Frage — Folgefragen beantwortet der Assistent ganz normal.
 * art 'rueckfrage': die Antwort wird als Antwort an `von` verstanden (Einrichtung, Datenübernahme).
 * Gleicher Weg wie die interne Rückfrage von außen (index.ts, intern:'rueckfrage').
 */
export async function schickeMitteilung(
  supabase: Supa,
  wege: MitteilungsWege,
  mitarbeiterId: string,
  text: string,
  von: string,
  art: 'mitteilung' | 'rueckfrage' = 'mitteilung',
): Promise<MitteilungsErgebnis> {
  const { data: m } = await supabase.from('mitarbeiter').select('id, name, aktiv, telegram_chat_id, telegram_pending').eq('id', mitarbeiterId).maybeSingle()
  if (!m?.aktiv) return { ok: false, grund: 'Mitarbeiter nicht gefunden', status: 404 }
  if (!m.telegram_chat_id || !wege.botToken) return { ok: false, grund: 'nicht mit Telegram verbunden', status: 409 }
  const antwort = await fetch(`https://api.telegram.org/bot${wege.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: m.telegram_chat_id, text }),
  })
  if (!antwort.ok) return { ok: false, grund: `Telegram lehnt ab (${antwort.status})`, status: 502 }
  const state = wege.ladeState(m.telegram_pending)
  state.zuege.push({
    z: new Date().toISOString(),
    msgs: [
      {
        role: 'user',
        content:
          art === 'mitteilung'
            ? `[Systemmeldung, nicht vom Mitarbeiter getippt] Im Auftrag von ${von} wurde dem Mitarbeiter über dich die folgende Mitteilung geschickt. Fragt er danach weiter, hilf ihm ganz normal mit deinen Werkzeugen.`
            : `[Systemmeldung, nicht vom Mitarbeiter getippt] Im Auftrag von ${von} wurde dem Mitarbeiter über dich die folgende Rückfrage geschickt. Antwortet er darauf, bedanke dich kurz und sag ihm, dass seine Antwort an ${von} weitergegeben wird. Lege dafür nichts im CRM an und ändere nichts, außer er bittet ausdrücklich darum.`,
      },
      { role: 'assistant', content: text },
    ],
  })
  await wege.speichereZustand(supabase, String(m.id), state)
  return { ok: true, an: m.name }
}

type TeamZeile = { id: string; name: string; email: string | null; telegram_chat_id: number | string | null; rolle?: string | null; ist_admin?: boolean | null }

async function ladeTeam(supabase: Supa): Promise<TeamZeile[]> {
  const { data } = await supabase.from('mitarbeiter').select('id, name, email, telegram_chat_id, rolle, ist_admin').eq('aktiv', true)
  return ((data ?? []) as TeamZeile[]).filter((m) => m.name)
}

/** Werkzeug kollegen_benachrichtigen. */
export async function kollegenBenachrichtigen(
  supabase: Supa,
  wege: MitteilungsWege,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
): Promise<string> {
  const text = String(input?.text ?? '').trim()
  if (!text) return 'Fehler: text fehlt. Frag den Mitarbeiter, was in der Nachricht stehen soll.'
  const wen = Array.isArray(input?.mitarbeiter) ? input.mitarbeiter.map(String).join(', ') : String(input?.mitarbeiter ?? '')
  if (!wen.trim()) return 'Fehler: mitarbeiter fehlt (Name des Kollegen).'
  const team = await ladeTeam(supabase)
  const { personen, unbekannt } = ordneZu(wen, personenNamen(team.map((m) => m.name)))
  if (personen.length === 0) {
    return `Nicht geschickt: Zu „${unbekannt.join(', ') || wen}" gibt es keinen eindeutigen Kollegen. Im Team sind: ${personenNamen(team.map((m) => m.name)).join(', ')}. Frag nach, wer gemeint ist.`
  }
  if (personen.length > HOECHSTENS_EMPFAENGER) return `Nicht geschickt: höchstens ${HOECHSTENS_EMPFAENGER} Kollegen auf einmal. Frag nach, wem genau.`
  const nachricht = `Nachricht von ${fragender.name}:\n${text.slice(0, 3500)}`
  const zeilen: string[] = []
  for (const name of personen) {
    const m = team.find((t) => t.name === name)
    if (!m) continue
    if (m.id === fragender.id) {
      zeilen.push(`- ${name}: nicht geschickt, das ist der Mitarbeiter selbst.`)
      continue
    }
    if (!m.telegram_chat_id) {
      zeilen.push(`- ${name}: nicht geschickt, ${name} ist nicht mit Telegram verbunden. Er sieht nur, was im CRM steht.`)
      continue
    }
    const r = await schickeMitteilung(supabase, wege, m.id, nachricht, fragender.name, 'mitteilung')
    if (r.ok) {
      zeilen.push(`- ${name}: geschickt.`)
      protokolliere(`Nachricht an ${name} per Telegram geschickt: „${text.length > 120 ? `${text.slice(0, 120)} …` : text}"`)
    } else zeilen.push(`- ${name}: nicht geschickt (${r.grund}).`)
  }
  if (unbekannt.length > 0) zeilen.push(`- Nicht zuordenbar: ${unbekannt.join(', ')}.`)
  return `Ergebnis (verschickter Text: „${nachricht}"):\n${zeilen.join('\n')}`
}

function heuteIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}

function deDatum(iso?: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Gleiche Form wie uid('todo') im CRM (src/lib/dates.ts). */
function todoId(): string {
  return `todo_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

/** Werkzeug todo_anlegen: eigene Liste (Vorgabe), Bereichsliste oder — nur GF/Admin — Liste eines Kollegen. */
export async function todoAnlegen(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
): Promise<string> {
  const aufgabe = String(input?.aufgabe ?? '').trim()
  if (!aufgabe) return 'Fehler: aufgabe fehlt.'
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  if (!eigeneEmail) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt, darum gibt es keine eigene To-do-Liste.'
  const rohDatum = String(input?.erledigen_bis ?? '').trim()
  const bis = rohDatum ? alsIso(rohDatum) : undefined
  if (rohDatum && !bis) return `Fehler: Datum „${rohDatum}" nicht erkannt. Nutze JJJJ-MM-TT oder TT.MM.JJJJ.`
  const prio = String(input?.prio ?? '').trim().toUpperCase().slice(0, 1)

  let besitzer = eigeneEmail
  let bereich: string | null = null
  let liste = 'deiner eigenen To-do-Liste'
  let zustaendig = String(input?.zustaendig ?? '').trim() || null

  const gewuenschterBereich = String(input?.bereich ?? '').trim()
  const fuer = String(input?.fuer ?? '').trim()
  if (gewuenschterBereich) {
    const b = gewuenschterBereich === 'immobilienkunden' ? 'immobilien' : gewuenschterBereich
    if (!BEREICH_IDS.includes(b)) return `Fehler: ungültiger Bereich. Erlaubt: ${BEREICH_IDS.join(', ')}.`
    if (!darfBereich(fragender, b)) return `Nicht angelegt: Der Bereich ${bereichName(b)} ist für ${fragender.name} nicht freigegeben.`
    bereich = b
    liste = `der To-do-Liste ${bereichName(b)}`
    zustaendig = zustaendig ?? fragender.name
  } else if (fuer) {
    const team = await ladeTeam(supabase)
    const { personen } = ordneZu(fuer, personenNamen(team.map((m) => m.name)))
    if (personen.length !== 1) return `Nicht angelegt: „${fuer}" ist kein eindeutiger Kollege. Im Team sind: ${personenNamen(team.map((m) => m.name)).join(', ')}.`
    const ziel = team.find((m) => m.name === personen[0])
    if (ziel && ziel.email && ziel.email.toLowerCase() !== eigeneEmail) {
      if (!siehtAlleBereiche(fragender)) {
        return `Nicht angelegt: In die eigene Liste eines Kollegen darf nur die Geschäftsführung eintragen. Leg die Aufgabe stattdessen in eine Bereichsliste mit Zuständig ${personen[0]} oder in die eigene Liste von ${fragender.name}.`
      }
      besitzer = ziel.email.toLowerCase()
      liste = `der eigenen To-do-Liste von ${ziel.name}`
    } else if (!ziel?.email) return `Nicht angelegt: Für ${personen[0]} ist keine E-Mail-Adresse hinterlegt.`
  }

  // Ans Ende der jeweiligen Liste (wie im CRM: höchste Reihenfolge + 1).
  const abfrage = supabase.from('todos').select('reihenfolge').order('reihenfolge', { ascending: false, nullsFirst: false }).limit(1)
  const { data: letzte } = bereich ? await abfrage.eq('bereich', bereich) : await abfrage.is('bereich', null).ilike('besitzer_email', besitzer)
  const reihenfolge = (Number(letzte?.[0]?.reihenfolge) || 0) + 1
  const heute = heuteIso()
  const id = todoId()
  const { error } = await supabase.from('todos').insert({
    id,
    besitzer_email: besitzer,
    bereich,
    reihenfolge,
    aufgabe: aufgabe.slice(0, 500),
    kunde_projekt: String(input?.kunde_projekt ?? '').trim() || null,
    zustaendig,
    prio: prio || null,
    erledigen_bis: bis ?? null,
    erhalten_am: heute,
    erstellt_am: heute,
  })
  if (error) return `Fehler beim Anlegen: ${error.message}`
  protokolliere(`To-do „${aufgabe.slice(0, 120)}" in ${liste} angelegt${bis ? `, erledigen bis ${deDatum(bis)}` : ''} (todo_id=${id})`)
  return `Angelegt in ${liste}: „${aufgabe}"${bis ? `, erledigen bis ${deDatum(bis)}` : ', ohne Fälligkeit'}${zustaendig ? `, zuständig ${zustaendig}` : ''}. Sie steht jetzt auch im CRM unter „Aufgaben nach Mitarbeiter". todo_id=${id}`
}

type TodoZeile = { id: string; aufgabe: string; bereich: string | null; besitzer_email: string | null; erledigen_bis: string | null; erledigt_am: string | null }

/** Werkzeug todo_erledigen: hakt ein To-do ab (eigene Liste oder freigegebene Bereichsliste). */
export async function todoErledigen(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
): Promise<string> {
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  const darf = (t: TodoZeile) => (t.bereich ? darfBereich(fragender, t.bereich) : String(t.besitzer_email ?? '').toLowerCase() === eigeneEmail)
  const id = String(input?.todo_id ?? '').trim()
  let treffer: TodoZeile[]
  if (id) {
    const { data } = await supabase.from('todos').select('id, aufgabe, bereich, besitzer_email, erledigen_bis, erledigt_am').eq('id', id).maybeSingle()
    treffer = data ? [data as TodoZeile] : []
  } else {
    const such = String(input?.suchbegriff ?? '').trim().toLowerCase()
    if (!such) return 'Fehler: todo_id oder suchbegriff angeben.'
    const { data } = await supabase.from('todos').select('id, aufgabe, bereich, besitzer_email, erledigen_bis, erledigt_am').is('erledigt_am', null).ilike('aufgabe', `%${such.replace(/[%_]/g, ' ')}%`).limit(20)
    treffer = (data ?? []) as TodoZeile[]
  }
  treffer = treffer.filter(darf)
  if (treffer.length === 0) return 'Kein passendes offenes To-do in Listen gefunden, die dieser Mitarbeiter ändern darf.'
  if (treffer.length > 1) {
    return `Mehrere passende To-dos, frag nach, welches gemeint ist:\n${treffer.map((t) => `- ${t.aufgabe}${t.erledigen_bis ? ` (bis ${deDatum(t.erledigen_bis)})` : ''} · ${t.bereich ? bereichName(t.bereich) : 'eigene Liste'} · todo_id=${t.id}`).join('\n')}`
  }
  const t = treffer[0]
  if (t.erledigt_am) return `Schon erledigt am ${deDatum(t.erledigt_am)}: „${t.aufgabe}".`
  const { error } = await supabase.from('todos').update({ erledigt_am: heuteIso() }).eq('id', t.id)
  if (error) return `Fehler: ${error.message}`
  protokolliere(`To-do „${t.aufgabe.slice(0, 120)}" als erledigt markiert (todo_id=${t.id})`)
  return `Erledigt: „${t.aufgabe}" (${t.bereich ? `Liste ${bereichName(t.bereich)}` : 'eigene Liste'}).`
}
