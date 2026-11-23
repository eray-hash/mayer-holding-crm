// Werkzeuge für die Arbeit im Team (Wünsche aus der Nutzungsauswertung vom 18./19.11.2026):
// - kollegen_benachrichtigen: kurze Telegram-Nachricht an Kollegen ("ich habe für X eine Akte angelegt"),
//   ohne dafür einen Termin anzulegen (Wunsch von Andreas).
// - todo_anlegen / todo_erledigen: To-dos ohne Kundenbezug in der eigenen Liste oder einer Bereichsliste,
//   damit sie auf der Seite „Aufgaben nach Mitarbeiter" und in aufgaben_uebersicht erscheinen (Wunsch von Eray).
// - todo_aendern + Erinnerung (erinnern_um): Andreas wollte am 19.11. ein To-do umbenennen und eine Frist
//   setzen (der Assistent legte stattdessen neue an) und zu einer festen Uhrzeit erinnert werden. Versand
//   der Erinnerung: email-gateway/todoErinnerung.ts (Zeitplan jede Minute).
//
// Die Datei kennt index.ts nicht (kein Kreis-Import): Telegram-Versand und Gesprächszustand reicht der
// Aufrufer als Funktionen herein.

import { alsIso, ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { BEREICH_IDS, bereichName, darfBereich, type RechteMitarbeiter } from './rechte.ts'
import { imPrivatBot } from './privatBot.ts'

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

/** Abstand Berlin zu UTC in Minuten zu einem Zeitpunkt (60 im Winter, 120 im Sommer). */
function berlinVersatzMinuten(ms: number): number {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  )
  const alsUtc = Date.UTC(Number(teile.year), Number(teile.month) - 1, Number(teile.day), Number(teile.hour), Number(teile.minute))
  return Math.round((alsUtc - Math.floor(ms / 60000) * 60000) / 60000)
}

/**
 * Deutsche Ortszeit („2026-11-20T09:00“, „2026-11-20 9:00“, „20.11.2026 09:00“; nur Datum = 09:00 Uhr)
 * als UTC-Zeitpunkt (ISO), Sommer-/Winterzeit eingerechnet. Ungültig → undefined.
 */
export function berlinZeitZuUtc(wert: string): string | undefined {
  const s = String(wert ?? '').trim()
  let j: number, mo: number, t: number, h = 9, mi = 0
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ,]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/)
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[T ,]+(\d{1,2})[:.](\d{2})(?:\s*Uhr)?)?$/i)
  if (iso) [j, mo, t] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (de) [j, mo, t] = [Number(de[3]), Number(de[2]), Number(de[1])]
  else return undefined
  const zeit = iso ?? de!
  if (zeit[4] !== undefined) [h, mi] = [Number(zeit[4]), Number(zeit[5])]
  if (mo < 1 || mo > 12 || t < 1 || t > 31 || h > 23 || mi > 59) return undefined
  const wand = Date.UTC(j, mo - 1, t, h, mi)
  if (new Date(wand).getUTCDate() !== t) return undefined // z. B. 31.02.
  // Zweimal rechnen: Der Versatz am geschätzten Zeitpunkt kann um die Umstellung herum noch der alte sein.
  let utc = wand - berlinVersatzMinuten(wand) * 60000
  utc = wand - berlinVersatzMinuten(utc) * 60000
  return new Date(utc).toISOString()
}

const BERLIN_DATUM = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })
const BERLIN_ZEIT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** UTC-Zeitpunkt als „20.11.2026, 09:00 Uhr“ (deutsche Ortszeit). */
export function deZeitpunkt(iso: string): string {
  return `${BERLIN_ZEIT.format(new Date(iso))} Uhr`
}

/** Liest erinnern_um aus der Werkzeug-Eingabe: undefined = nicht angegeben, '' = löschen, sonst UTC-ISO; Fehlertext bei Unsinn. */
function leseErinnerung(roh: unknown): { wert?: string; fehler?: string } {
  if (roh === undefined || roh === null) return {}
  const s = String(roh).trim()
  if (!s) return { wert: '' }
  const utc = berlinZeitZuUtc(s)
  if (!utc) return { fehler: `Fehler: Erinnerungszeit „${s}" nicht erkannt. Nutze JJJJ-MM-TTTHH:MM in deutscher Ortszeit, z. B. 2026-11-20T09:00.` }
  if (Date.parse(utc) < Date.now() - 5 * 60000) return { fehler: `Fehler: Die Erinnerungszeit ${deZeitpunkt(utc)} liegt in der Vergangenheit. Nimm eine Zeit in der Zukunft.` }
  return { wert: utc }
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
  const erinnerung = leseErinnerung(input?.erinnern_um)
  if (erinnerung.fehler) return erinnerung.fehler
  const erinnernUm = erinnerung.wert || null
  // Erinnerung ohne Fälligkeit: fällig am Tag der Erinnerung, damit die Aufgabe nicht „ohne Datum“ untergeht.
  const faellig = bis ?? (erinnernUm ? BERLIN_DATUM.format(new Date(erinnernUm)) : undefined)
  const prio = String(input?.prio ?? '').trim().toUpperCase().slice(0, 1)

  let besitzer = eigeneEmail
  let bereich: string | null = null
  let liste = 'deiner eigenen To-do-Liste'
  let zustaendig = String(input?.zustaendig ?? '').trim() || null

  const gewuenschterBereich = String(input?.bereich ?? '').trim()
  const fuer = String(input?.fuer ?? '').trim()
  let vonKollege: string | null = null
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
      // Seit 22.11.2026 (Wunsch Quirin) darf jeder einem Kollegen ein To-do in dessen Liste schicken; damit
      // klar ist, woher es kommt, steht der Absender in der Aufgabe. Private Listen bleiben privat.
      if (imPrivatBot()) return 'Nicht angelegt: Im privaten Assistenten gehen To-dos nur in die eigene private Liste.'
      besitzer = ziel.email.toLowerCase()
      liste = `der eigenen To-do-Liste von ${ziel.name}`
      zustaendig = ziel.name
      vonKollege = fragender.name
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
    aufgabe: (vonKollege ? `${aufgabe} (von ${vonKollege})` : aufgabe).slice(0, 500),
    kunde_projekt: String(input?.kunde_projekt ?? '').trim() || null,
    zustaendig,
    prio: prio || null,
    erledigen_bis: faellig ?? null,
    erinnern_um: erinnernUm,
    erhalten_am: heute,
    erstellt_am: heute,
  })
  if (error) return `Fehler beim Anlegen: ${error.message}`
  // Wer erinnert wird: bei der eigenen Liste ihr Besitzer, bei einer Bereichsliste der Zuständige (todoErinnerung.ts im email-gateway).
  const erinnerungText = erinnernUm ? `, Erinnerung per Telegram am ${deZeitpunkt(erinnernUm)}${bereich ? ` an ${zustaendig ?? 'den Zuständigen'}` : ''}` : ''
  protokolliere(`To-do „${aufgabe.slice(0, 120)}" in ${liste} angelegt${faellig ? `, erledigen bis ${deDatum(faellig)}` : ''}${erinnernUm ? `, Erinnerung ${deZeitpunkt(erinnernUm)}` : ''} (todo_id=${id})`)
  // Im privaten Assistenten: private Liste, Erinnerung kommt im privaten Chat (todoErinnerung.ts), nichts im Mayer-Bereich.
  const wo = imPrivatBot() && !bereich
    ? ' Sie ist privat (nur für ihn sichtbar), die Erinnerung kommt hier im privaten Chat, und sie erscheint beim nächsten Abgleich in seinem Microsoft To Do.'
    : ' Sie steht jetzt auch im CRM unter „Aufgaben nach Mitarbeiter".'
  const hinweisKollege = vonKollege ? ` Sag dazu, dass ${zustaendig} das To-do in seiner Liste sieht; soll er sofort Bescheid bekommen, biete kollegen_benachrichtigen an.` : ''
  return `Angelegt in ${imPrivatBot() && !bereich ? 'seiner privaten To-do-Liste' : liste}: „${aufgabe}"${faellig ? `, erledigen bis ${deDatum(faellig)}` : ', ohne Fälligkeit'}${zustaendig ? `, zuständig ${zustaendig}` : ''}${erinnerungText}.${wo}${hinweisKollege} todo_id=${id}`
}

type TodoZeile = {
  id: string
  aufgabe: string
  bereich: string | null
  besitzer_email: string | null
  erledigen_bis: string | null
  erledigt_am: string | null
  zustaendig: string | null
  kunde_projekt: string | null
  aktueller_stand: string | null
  prio: string | null
  erinnern_um: string | null
}
const TODO_SPALTEN = 'id, aufgabe, bereich, besitzer_email, erledigen_bis, erledigt_am, zustaendig, kunde_projekt, aktueller_stand, prio, erinnern_um'

/**
 * Sucht genau ein To-do für todo_erledigen / todo_aendern: per todo_id oder Suchbegriff im Aufgabentext
 * (nur offene), nur in Listen, die der Mitarbeiter ändern darf (eigene Liste, freigegebene Bereichsliste).
 * Kein oder mehrere Treffer → Text für den Assistenten statt eines To-dos.
 */
async function findeTodo(supabase: Supa, fragender: Fragender, input: { todo_id?: unknown; suchbegriff?: unknown } | undefined): Promise<TodoZeile | string> {
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  const darf = (t: TodoZeile) => (t.bereich ? darfBereich(fragender, t.bereich) : String(t.besitzer_email ?? '').toLowerCase() === eigeneEmail)
  const id = String(input?.todo_id ?? '').trim()
  let treffer: TodoZeile[]
  if (id) {
    const { data } = await supabase.from('todos').select(TODO_SPALTEN).eq('id', id).maybeSingle()
    treffer = data ? [data as TodoZeile] : []
  } else {
    const such = String(input?.suchbegriff ?? '').trim().toLowerCase()
    if (!such) return 'Fehler: todo_id oder suchbegriff angeben.'
    const muster = `%${such.replace(/[%_]/g, ' ')}%`
    // Nur in Listen suchen, die er ändern darf (eigene Liste, Bereichslisten). Bis 23.11.2026 wurde über ALLE
    // offenen To-dos gesucht, auf 20 begrenzt und erst danach nach Rechten gefiltert: Hasans über 2.600
    // private To-dos füllten bei häufigen Wörtern („anrufen“ 42, „senden“ 50) die 20 Plätze, die eigenen
    // Treffer fielen weg → „Kein passendes offenes To-do“, obwohl es da war.
    const [eigene, bereichsListen] = await Promise.all([
      eigeneEmail
        ? supabase.from('todos').select(TODO_SPALTEN).is('erledigt_am', null).is('bereich', null).ilike('besitzer_email', eigeneEmail).ilike('aufgabe', muster).order('id').limit(50)
        : Promise.resolve({ data: [] }),
      supabase.from('todos').select(TODO_SPALTEN).is('erledigt_am', null).not('bereich', 'is', null).ilike('aufgabe', muster).order('id').limit(200),
    ])
    treffer = [...((eigene.data ?? []) as TodoZeile[]), ...((bereichsListen.data ?? []) as TodoZeile[])]
  }
  treffer = treffer.filter(darf)
  if (treffer.length === 0) {
    const kopf = 'Kein passendes offenes To-do in Listen gefunden, die dieser Mitarbeiter ändern darf.'
    if (id || !eigeneEmail) return kopf
    // Sprachnachrichten: Der Suchbegriff ist oft falsch gehört (22.11.2026: „Judo“ statt des eben angelegten
    // AOK-To-dos — der Assistent legte ein neues an). Die zuletzt geänderten eigenen To-dos helfen beim Zuordnen.
    const { data: zuletzt } = await supabase.from('todos').select(TODO_SPALTEN).is('erledigt_am', null).is('bereich', null).ilike('besitzer_email', eigeneEmail).order('updated_at', { ascending: false }).limit(5)
    const liste = ((zuletzt ?? []) as TodoZeile[]).filter(darf)
    if (liste.length === 0) return kopf
    return `${kopf} Der Suchbegriff kann falsch verstanden sein (z. B. aus einer Sprachnachricht). Zuletzt geänderte offene To-dos seiner eigenen Liste — meint er eines davon, nimm dessen todo_id; sonst frag kurz nach, bevor du ein neues anlegst:\n${liste.map((t) => `- ${t.aufgabe}${t.erledigen_bis ? ` (bis ${deDatum(t.erledigen_bis)})` : ''} · todo_id=${t.id}`).join('\n')}`
  }
  if (treffer.length > 1) {
    return `Mehrere passende To-dos, frag nach, welches gemeint ist:\n${treffer.map((t) => `- ${t.aufgabe}${t.erledigen_bis ? ` (bis ${deDatum(t.erledigen_bis)})` : ''} · ${t.bereich ? bereichName(t.bereich) : 'eigene Liste'} · todo_id=${t.id}`).join('\n')}`
  }
  return treffer[0]
}

/** Werkzeug todo_erledigen: hakt ein To-do ab (eigene Liste oder freigegebene Bereichsliste). */
export async function todoErledigen(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
): Promise<string> {
  const t = await findeTodo(supabase, fragender, input)
  if (typeof t === 'string') return t
  if (t.erledigt_am) return `Schon erledigt am ${deDatum(t.erledigt_am)}: „${t.aufgabe}".`
  const { error } = await supabase.from('todos').update({ erledigt_am: heuteIso() }).eq('id', t.id)
  if (error) return `Fehler: ${error.message}`
  protokolliere(`To-do „${t.aufgabe.slice(0, 120)}" als erledigt markiert (todo_id=${t.id})`)
  return `Erledigt: „${t.aufgabe}" (${t.bereich ? `Liste ${bereichName(t.bereich)}` : 'eigene Liste'}).`
}

/**
 * Werkzeug todo_aendern: ändert ein bestehendes To-do (Text, Fälligkeit, Erinnerung, Zuständig, Kunde/Projekt,
 * aktueller Stand, Prio) — legt nie ein neues an. Gleiche Suche und gleiche Rechte wie todo_erledigen.
 * Nicht angegebene Felder bleiben, leerer Text löscht (außer beim Aufgabentext).
 */
export async function todoAendern(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
): Promise<string> {
  const t = await findeTodo(supabase, fragender, input)
  if (typeof t === 'string') return t
  const angegeben = (feld: string) => input?.[feld] !== undefined && input?.[feld] !== null
  const patch: Record<string, string | null> = {}
  const was: string[] = []

  if (angegeben('aufgabe')) {
    const neu = String(input.aufgabe).trim().slice(0, 500)
    if (!neu) return 'Fehler: Der Aufgabentext darf nicht leer sein. Zum Abhaken nimm todo_erledigen.'
    if (neu !== t.aufgabe) {
      patch.aufgabe = neu
      was.push(`Text jetzt „${neu}"`)
    }
  }
  if (angegeben('erledigen_bis')) {
    const roh = String(input.erledigen_bis).trim()
    const bis = roh ? alsIso(roh) : null
    if (roh && !bis) return `Fehler: Datum „${roh}" nicht erkannt. Nutze JJJJ-MM-TT oder TT.MM.JJJJ.`
    patch.erledigen_bis = bis ?? null
    was.push(bis ? `erledigen bis ${deDatum(bis)}` : 'Fälligkeit entfernt')
  }
  const erinnerung = leseErinnerung(input?.erinnern_um)
  if (erinnerung.fehler) return erinnerung.fehler
  if (erinnerung.wert !== undefined) {
    patch.erinnern_um = erinnerung.wert || null
    if (erinnerung.wert) {
      const empfaenger = t.bereich ? ` an ${String(input?.zustaendig ?? '').trim() || t.zustaendig || 'den Zuständigen'}` : ''
      was.push(`Erinnerung per Telegram am ${deZeitpunkt(erinnerung.wert)}${empfaenger}`)
      // Wie bei todo_anlegen: Ohne Fälligkeit wird der Tag der Erinnerung die Fälligkeit.
      if (!('erledigen_bis' in patch) && !t.erledigen_bis) {
        patch.erledigen_bis = BERLIN_DATUM.format(new Date(erinnerung.wert))
        was.push(`erledigen bis ${deDatum(patch.erledigen_bis)}`)
      }
    } else was.push('Erinnerung entfernt')
  }
  const textFelder: [string, string][] = [['zustaendig', 'zuständig'], ['kunde_projekt', 'Kunde/Projekt'], ['aktueller_stand', 'aktueller Stand']]
  for (const [feld, name] of textFelder) {
    if (!angegeben(feld)) continue
    const neu = String(input[feld]).trim().slice(0, 1000) || null
    patch[feld] = neu
    was.push(neu ? `${name}: ${neu}` : `${name} entfernt`)
  }
  if (angegeben('prio')) {
    const p = String(input.prio).trim().toUpperCase().slice(0, 1) || null
    patch.prio = p
    was.push(p ? `Prio ${p}` : 'Prio entfernt')
  }

  if (Object.keys(patch).length === 0) return `Nichts geändert: Es wurde keine neue Angabe gemacht (todo_id=${t.id}, „${t.aufgabe}").`
  const { error } = await supabase.from('todos').update(patch).eq('id', t.id)
  if (error) return `Fehler beim Ändern: ${error.message}`
  const liste = t.bereich ? `Liste ${bereichName(t.bereich)}` : 'eigene Liste'
  protokolliere(`To-do „${t.aufgabe.slice(0, 120)}" geändert: ${was.join('; ').slice(0, 300)} (todo_id=${t.id})`)
  const erledigtHinweis = t.erledigt_am ? ` Hinweis: Das To-do ist seit ${deDatum(t.erledigt_am)} erledigt${patch.erinnern_um ? ', eine Erinnerung kommt dafür nicht' : ''}.` : ''
  return `Geändert (${liste}, kein neues To-do angelegt): „${patch.aufgabe ?? t.aufgabe}" — ${was.join('; ')}.${erledigtHinweis} todo_id=${t.id}`
}
