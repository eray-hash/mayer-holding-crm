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
import { absenderAus, aehnlicheAufgabe, aufgabenWoerter, findeKollege, kollegeUnklar, leseWiederholung, loeschWunsch, mitAbsender, type Wiederholung, wiederholungText, zuweisungsMitteilung } from './todoZuweisung.ts'
import { privatBotAktiv } from '../_shared/telegramPrivat.ts'

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

type TeamZeile = { id: string; name: string; email: string | null; telegram_chat_id: number | string | null; rolle?: string | null; ist_admin?: boolean | null; bereiche?: string[] | null }

async function ladeTeam(supabase: Supa): Promise<TeamZeile[]> {
  const { data } = await supabase.from('mitarbeiter').select('id, name, email, telegram_chat_id, rolle, ist_admin, bereiche').eq('aktiv', true)
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

/**
 * Kollege aus einer Namensangabe (fuer oder zuständig). undefined = keine Zuweisung (leer, der Mitarbeiter selbst
 * oder — nur bei zuständig — kein Kollege, z. B. ein Externer), Text = Fehler zum Nachfragen.
 * streng (fuer): Jeder Name, der nicht genau einen aktiven Kollegen meint, ist ein Fehler.
 */
async function kollegeAusAngabe(supabase: Supa, fragender: Fragender, angabe: string, streng: boolean): Promise<TeamZeile | string | undefined> {
  if (!angabe.trim()) return undefined
  const team = await ladeTeam(supabase)
  const namen = personenNamen(team.map((m) => m.name))
  const treffer = findeKollege(angabe, namen)
  if (treffer.art !== 'eindeutig') {
    // Bei „zuständig“ darf auch jemand außerhalb des Teams stehen (Steuerberater, Kunde) — nur mehrere Kollegen sind unklar.
    if (!streng && treffer.art === 'keiner') return undefined
    return `Nicht ausgeführt: ${kollegeUnklar(angabe, treffer, namen.filter((n) => n !== fragender.name))}`
  }
  const ziel = team.find((m) => m.name === treffer.name)
  if (!ziel) return undefined
  const eigene = String(fragender.email ?? '').toLowerCase()
  if (ziel.id === fragender.id || (eigene && String(ziel.email ?? '').toLowerCase() === eigene)) return undefined
  return ziel
}

/** Schickt dem Kollegen die Mitteilung über die Zuweisung; liefert den Satz für die Antwort des Werkzeugs. */
async function benachrichtigeKollegen(supabase: Supa, wege: MitteilungsWege | undefined, ziel: TeamZeile, text: string, von: string, protokolliere: (t: string) => void): Promise<string> {
  if (!ziel.telegram_chat_id || !wege) return `${ziel.name} ist nicht mit Telegram verbunden und sieht es nur im CRM.`
  const r = await schickeMitteilung(supabase, wege, ziel.id, text, von, 'mitteilung').catch((e) => ({ ok: false as const, grund: String(e), status: 500 }))
  if (!r.ok) return `Die Telegram-Nachricht an ${ziel.name} ging nicht raus (${r.grund}); er sieht es im CRM.`
  protokolliere(`${ziel.name} per Telegram über das To-do informiert`)
  return `${ziel.name} wurde per Telegram benachrichtigt.`
}

/**
 * Werkzeug todo_anlegen: eigene Liste (Vorgabe), Bereichsliste oder die Liste eines Kollegen (fuer).
 * Seit 24.11.2026 (Wunsch aus der Nutzung): Nennt zuständig eindeutig einen Kollegen, ist das ebenfalls eine
 * Zuweisung — vorher blieb die Aufgabe in der eigenen Liste und der Kollege erfuhr nichts. Der Kollege bekommt
 * eine Telegram-Mitteilung, und die Antwort nennt ausdrücklich, wem die Aufgabe zugewiesen ist.
 */
export async function todoAnlegen(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
  wege?: MitteilungsWege,
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
  const wiederholung = leseWiederholung(input?.wiederholen)
  if (wiederholung.fehler) return wiederholung.fehler
  const wiederholen: Wiederholung | null = wiederholung.wert ?? null
  if (wiederholen && !erinnernUm) return 'Fehler: Eine Wiederholung braucht eine Erinnerungszeit (erinnern_um), z. B. täglich um 09:00 ab morgen. Frag nach der Uhrzeit, wenn sie fehlt.'
  // Erinnerung ohne Fälligkeit: fällig am Tag der Erinnerung, damit die Aufgabe nicht „ohne Datum“ untergeht.
  const faellig = bis ?? (erinnernUm ? BERLIN_DATUM.format(new Date(erinnernUm)) : undefined)
  const prio = String(input?.prio ?? '').trim().toUpperCase().slice(0, 1)

  let besitzer = eigeneEmail
  let bereich: string | null = null
  let liste = 'deiner eigenen To-do-Liste'
  let zustaendig = String(input?.zustaendig ?? '').trim() || null

  const gewuenschterBereich = String(input?.bereich ?? '').trim()
  const fuer = String(input?.fuer ?? '').trim()
  // Kollege, dem die Aufgabe zugewiesen wird (eigene Liste des Kollegen oder zuständig in der Bereichsliste).
  let kollege: TeamZeile | null = null
  let vonKollege: string | null = null
  let hinweisBereich = ''
  if (gewuenschterBereich) {
    const b = gewuenschterBereich === 'immobilienkunden' ? 'immobilien' : gewuenschterBereich
    if (!BEREICH_IDS.includes(b)) return `Fehler: ungültiger Bereich. Erlaubt: ${BEREICH_IDS.join(', ')}.`
    if (!darfBereich(fragender, b)) return `Nicht angelegt: Der Bereich ${bereichName(b)} ist für ${fragender.name} nicht freigegeben.`
    bereich = b
    liste = `der To-do-Liste ${bereichName(b)}`
    // In der gemeinsamen Liste bleibt die Aufgabe; ein genannter Kollege wird zuständig und bekommt Bescheid.
    if (!imPrivatBot() && (fuer || zustaendig)) {
      const k = await kollegeAusAngabe(supabase, fragender, fuer || zustaendig || '', !!fuer)
      if (typeof k === 'string') return k
      if (k) {
        kollege = k
        zustaendig = k.name
        if (!darfBereich(k, b)) hinweisBereich = ` Achtung: Der Bereich ${bereichName(b)} ist für ${k.name} nicht freigegeben, er sieht diese Liste nicht — sag das dem Mitarbeiter und biete an, das To-do stattdessen in die eigene Liste von ${k.name} zu legen (todo_aendern mit fuer).`
      }
    }
    zustaendig = zustaendig ?? fragender.name
  } else if (fuer || zustaendig) {
    if (fuer && imPrivatBot()) return 'Nicht angelegt: Im privaten Assistenten gehen To-dos nur in die eigene private Liste.'
    const k = imPrivatBot() ? undefined : await kollegeAusAngabe(supabase, fragender, fuer || zustaendig || '', !!fuer)
    if (typeof k === 'string') return k
    if (k) {
      // Seit 22.11.2026 (Wunsch Quirin) darf jeder einem Kollegen ein To-do in dessen Liste schicken; damit
      // klar ist, woher es kommt, steht der Absender in der Aufgabe. Private Listen bleiben privat.
      if (!k.email) return `Nicht angelegt: Für ${k.name} ist keine E-Mail-Adresse hinterlegt, darum hat er keine eigene To-do-Liste.`
      besitzer = k.email.toLowerCase()
      liste = `der eigenen To-do-Liste von ${k.name}`
      zustaendig = k.name
      vonKollege = fragender.name
      kollege = k
    }
  }

  // Kein zweites To-do, wenn in der Ziel-Liste schon ein passendes offenes steht (Wunsch 25.11.2026: Statt einem
  // To-do in der Liste eines Kollegen eine Erinnerung zu geben, entstand ein Duplikat).
  if (input?.trotzdem_neu !== true) {
    const doppelt = await aehnlichesOffenesTodo(supabase, bereich, besitzer, aufgabe)
    if (doppelt) {
      const wo = bereich ? `der To-do-Liste ${bereichName(bereich)}` : besitzer === eigeneEmail ? 'seiner eigenen Liste' : liste
      return `NICHT ANGELEGT: In ${wo} steht schon das offene To-do „${doppelt.aufgabe}"${doppelt.erledigen_bis ? ` (bis ${deDatum(doppelt.erledigen_bis)})` : ''} · todo_id=${doppelt.id}. Soll es eine Frist, eine Erinnerung oder einen anderen Text bekommen, nimm todo_aendern mit dieser todo_id. Nur wenn der Mitarbeiter ausdrücklich ein zweites, eigenes To-do will, ruf todo_anlegen erneut mit trotzdem_neu=true auf.`
    }
  }

  // Ans Ende der jeweiligen Liste (wie im CRM: höchste Reihenfolge + 1).
  const reihenfolge = await naechsteReihenfolge(supabase, bereich, besitzer)
  const heute = heuteIso()
  const id = todoId()
  const text = (vonKollege ? mitAbsender(aufgabe, vonKollege) : aufgabe).slice(0, 500)
  const zeile: Record<string, unknown> = {
    id,
    besitzer_email: besitzer,
    bereich,
    reihenfolge,
    aufgabe: text,
    kunde_projekt: String(input?.kunde_projekt ?? '').trim() || null,
    zustaendig,
    prio: prio || null,
    erledigen_bis: faellig ?? null,
    erinnern_um: erinnernUm,
    erhalten_am: heute,
    erstellt_am: heute,
  }
  // Spalte erinnerung_wiederholung nur schreiben, wenn gewünscht (supabase/sql/2026-11-25_todo_wiederholung.sql).
  if (wiederholen) zeile.erinnerung_wiederholung = wiederholen
  const { error } = await supabase.from('todos').insert(zeile)
  if (error) return wiederholen && fehltWiederholungsSpalte(error) ? WIEDERHOLUNG_FEHLT : `Fehler beim Anlegen: ${error.message}`
  // Wer erinnert wird: bei der eigenen Liste ihr Besitzer, bei einer Bereichsliste der Zuständige (todoErinnerung.ts im email-gateway).
  const erinnerungText = erinnernUm ? `, Erinnerung per Telegram am ${deZeitpunkt(erinnernUm)}${bereich || kollege ? ` an ${zustaendig ?? 'den Zuständigen'}` : ''}${wiederholen ? `, wiederholt sich ${wiederholungText(wiederholen)}, bis es erledigt ist` : ''}` : ''
  protokolliere(`To-do „${aufgabe.slice(0, 120)}" in ${liste} angelegt${kollege ? `, zugewiesen an ${kollege.name}` : ''}${faellig ? `, erledigen bis ${deDatum(faellig)}` : ''}${erinnernUm ? `, Erinnerung ${deZeitpunkt(erinnernUm)}` : ''} (todo_id=${id})`)
  const wo = imPrivatBot() && !bereich
    ? ' Sie ist privat (nur für ihn sichtbar), die Erinnerung kommt hier im privaten Chat, und sie erscheint beim nächsten Abgleich in seinem Microsoft To Do.'
    : ' Sie steht jetzt auch im CRM unter „Aufgaben nach Mitarbeiter".'
  const grund = `Angelegt in ${imPrivatBot() && !bereich ? 'seiner privaten To-do-Liste' : liste}: „${aufgabe}"${faellig ? `, erledigen bis ${deDatum(faellig)}` : ', ohne Fälligkeit'}${zustaendig ? `, zuständig ${zustaendig}` : ''}${erinnerungText}.${wo}`
  if (!kollege) return `${grund} todo_id=${id}`
  const meldung = await benachrichtigeKollegen(
    supabase,
    wege,
    kollege,
    zuweisungsMitteilung({ von: fragender.name, aufgabe, faellig: faellig ? deDatum(faellig) : null, liste: bereich ? `To-do-Liste ${bereichName(bereich)}` : null, neu: true }),
    fragender.name,
    protokolliere,
  )
  return `ZUGEWIESEN AN ${kollege.name}. ${grund} ${meldung}${hinweisBereich} Sag dem Mitarbeiter ausdrücklich, dass die Aufgabe ${kollege.name} zugewiesen ist${bereich ? '' : ' und in dessen Liste steht'}, und ob er benachrichtigt wurde. todo_id=${id}`
}

/** Höchste Reihenfolge der Ziel-Liste + 1 (wie im CRM). */
async function naechsteReihenfolge(supabase: Supa, bereich: string | null, besitzer: string): Promise<number> {
  const abfrage = supabase.from('todos').select('reihenfolge').order('reihenfolge', { ascending: false, nullsFirst: false }).limit(1)
  const { data: letzte } = bereich ? await abfrage.eq('bereich', bereich) : await abfrage.is('bereich', null).ilike('besitzer_email', besitzer)
  return (Number(letzte?.[0]?.reihenfolge) || 0) + 1
}

const WIEDERHOLUNG_FEHLT = 'Fehler: Wiederkehrende Erinnerungen sind in der Datenbank noch nicht eingerichtet (Spalte erinnerung_wiederholung fehlt). Sag dem Mitarbeiter, dass das To-do deshalb NICHT gespeichert wurde, und biete eine einmalige Erinnerung an.'

/** Fehlt die Spalte erinnerung_wiederholung noch (SQL nicht ausgeführt)? */
function fehltWiederholungsSpalte(error: { message?: string; code?: string } | null): boolean {
  return !!error && /erinnerung_wiederholung/.test(String(error.message ?? ''))
}

/**
 * Offenes To-do in derselben Liste mit (fast) gleichem Text — oder null. Vorfilter in der Datenbank über das
 * längste Wort (Hasans eigene Liste hat über 2.600 offene To-dos), dann aehnlicheAufgabe.
 */
async function aehnlichesOffenesTodo(supabase: Supa, bereich: string | null, besitzer: string, aufgabe: string): Promise<{ id: string; aufgabe: string; erledigen_bis: string | null } | null> {
  const woerter = aufgabenWoerter(aufgabe).sort((a, b) => b.length - a.length)
  if (woerter.length === 0) return null
  // Vereinfachte Wörter (ae statt ä) stehen so nicht im Text: dann nach dem Wortstamm vor dem ersten Umlaut suchen.
  const stamm = woerter[0].split(/ae|oe|ue|ss/)[0]
  if (stamm.length < 3) return null
  let q = supabase.from('todos').select('id, aufgabe, erledigen_bis').is('erledigt_am', null).ilike('aufgabe', `%${stamm.replace(/[%_]/g, ' ')}%`)
  q = bereich ? q.eq('bereich', bereich) : q.is('bereich', null).ilike('besitzer_email', besitzer)
  const { data, error } = await q.order('id').limit(200)
  if (error) return null
  return ((data ?? []) as { id: string; aufgabe: string; erledigen_bis: string | null }[]).find((t) => aehnlicheAufgabe(t.aufgabe, aufgabe)) ?? null
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
  ms_id?: string | null
}
const TODO_SPALTEN = 'id, aufgabe, bereich, besitzer_email, erledigen_bis, erledigt_am, zustaendig, kunde_projekt, aktueller_stand, prio, erinnern_um, ms_id'

function istGeschaeftsfuehrung(m: Fragender): boolean {
  return m.nurPrivat !== true && (m.rolle === 'geschaeftsfuehrung' || !!m.ist_admin)
}

/** „Liste Immobilien“, „eigene Liste“ oder „Liste von <Kollege>“ (To-do in der eigenen Liste eines Kollegen). */
function listenName(t: TodoZeile, eigeneEmail: string): string {
  if (t.bereich) return `Liste ${bereichName(t.bereich)}`
  if (String(t.besitzer_email ?? '').toLowerCase() === eigeneEmail) return 'eigene Liste'
  return `Liste von ${t.zustaendig || t.besitzer_email || 'einem Kollegen'}`
}

/**
 * Sucht genau ein To-do für todo_erledigen / todo_aendern: per todo_id oder Suchbegriff im Aufgabentext
 * (nur offene), nur in Listen, die der Mitarbeiter ändern darf (eigene Liste, freigegebene Bereichsliste).
 * Kein oder mehrere Treffer → Text für den Assistenten statt eines To-dos.
 */
async function findeTodo(
  supabase: Supa,
  fragender: Fragender,
  input: { todo_id?: unknown; suchbegriff?: unknown } | undefined,
  // todo_loeschen: auch schon abgehakte To-dos (ein erledigter Stichpunkt soll von der Liste verschwinden).
  // fremde (todo_aendern): auch To-dos in der eigenen Liste eines Kollegen, die der Fragende dorthin geschickt hat
  // („(von <Name>)“) — die Geschäftsführung alle, außer privaten (Microsoft To Do, Besitzer mit privatem Assistenten).
  o: { auchErledigte?: boolean; fremde?: boolean } = {},
): Promise<TodoZeile | string> {
  // deno-lint-ignore no-explicit-any
  const offen = (q: any) => (o.auchErledigte ? q : q.is('erledigt_am', null))
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  const mitFremden = o.fremde === true && !imPrivatBot() && !!eigeneEmail
  const gf = istGeschaeftsfuehrung(fragender)
  const eigeneListe = (t: TodoZeile) => (t.bereich ? darfBereich(fragender, t.bereich) : String(t.besitzer_email ?? '').toLowerCase() === eigeneEmail)
  const fremdErlaubt = (t: TodoZeile) =>
    mitFremden && !t.bereich && !t.ms_id && String(t.besitzer_email ?? '').toLowerCase() !== eigeneEmail &&
    (absenderAus(t.aufgabe).toLowerCase() === fragender.name.toLowerCase() || gf)
  const darf = (t: TodoZeile) => eigeneListe(t) || fremdErlaubt(t)
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
        ? offen(supabase.from('todos').select(TODO_SPALTEN)).is('bereich', null).ilike('besitzer_email', eigeneEmail).ilike('aufgabe', muster).order('id').limit(50)
        : Promise.resolve({ data: [] }),
      offen(supabase.from('todos').select(TODO_SPALTEN)).not('bereich', 'is', null).ilike('aufgabe', muster).order('id').limit(200),
    ])
    treffer = [...((eigene.data ?? []) as TodoZeile[]), ...((bereichsListen.data ?? []) as TodoZeile[])]
    if (mitFremden) {
      // Listen der Kollegen: nur, was er selbst geschickt hat (die Geschäftsführung: alles Passende).
      let q = offen(supabase.from('todos').select(TODO_SPALTEN)).is('bereich', null).not('besitzer_email', 'ilike', eigeneEmail).ilike('aufgabe', muster)
      if (!gf) q = q.ilike('aufgabe', `%(von ${fragender.name.replace(/[%_]/g, ' ')})%`)
      const { data: fremd } = await q.order('id').limit(50)
      treffer.push(...((fremd ?? []) as TodoZeile[]))
    }
  }
  treffer = [...new Map(treffer.map((t) => [t.id, t])).values()].filter(darf)
  // Geschäftsführung in fremden Listen: nichts aus einer privaten Liste (Besitzer nutzt den privaten Assistenten),
  // außer er hat es selbst dorthin geschickt.
  if (mitFremden && gf) {
    const privat = new Map<string, boolean>()
    const geprueft: TodoZeile[] = []
    for (const t of treffer) {
      if (eigeneListe(t) || absenderAus(t.aufgabe).toLowerCase() === fragender.name.toLowerCase()) {
        geprueft.push(t)
        continue
      }
      const b = String(t.besitzer_email ?? '').toLowerCase()
      if (!privat.has(b)) privat.set(b, await privatBotAktiv(supabase, b).catch(() => true))
      if (!privat.get(b)) geprueft.push(t)
    }
    treffer = geprueft
  }
  if (treffer.length === 0) {
    const kopf = `Kein passendes ${o.auchErledigte ? '' : 'offenes '}To-do in Listen gefunden, die dieser Mitarbeiter ändern darf.`
    if (id || !eigeneEmail) return kopf
    // Sprachnachrichten: Der Suchbegriff ist oft falsch gehört (22.11.2026: „Judo“ statt des eben angelegten
    // AOK-To-dos — der Assistent legte ein neues an). Die zuletzt geänderten eigenen To-dos helfen beim Zuordnen.
    const { data: zuletzt } = await supabase.from('todos').select(TODO_SPALTEN).is('erledigt_am', null).is('bereich', null).ilike('besitzer_email', eigeneEmail).order('updated_at', { ascending: false }).limit(5)
    const liste = ((zuletzt ?? []) as TodoZeile[]).filter(darf)
    if (liste.length === 0) return kopf
    return `${kopf} Der Suchbegriff kann falsch verstanden sein (z. B. aus einer Sprachnachricht). Zuletzt geänderte offene To-dos seiner eigenen Liste — meint er eines davon, nimm dessen todo_id; sonst frag kurz nach, bevor du ein neues anlegst:\n${liste.map((t) => `- ${t.aufgabe}${t.erledigen_bis ? ` (bis ${deDatum(t.erledigen_bis)})` : ''} · todo_id=${t.id}`).join('\n')}`
  }
  if (treffer.length > 1) {
    return `Mehrere passende To-dos, frag nach, welches gemeint ist:\n${treffer.map((t) => `- ${t.aufgabe}${t.erledigen_bis ? ` (bis ${deDatum(t.erledigen_bis)})` : ''}${t.erledigt_am ? ` (erledigt am ${deDatum(t.erledigt_am)})` : ''} · ${listenName(t, eigeneEmail)} · todo_id=${t.id}`).join('\n')}`
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
 * Zuweisen (fuer, oder zuständig = eindeutig ein Kollege): Ein To-do der eigenen Liste wandert in die Liste des
 * Kollegen (mit Absender in Klammern), in einer Bereichsliste wird er zuständig; er bekommt eine Telegram-Mitteilung.
 */
export async function todoAendern(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
  wege?: MitteilungsWege,
): Promise<string> {
  const t = await findeTodo(supabase, fragender, input, { fremde: true })
  if (typeof t === 'string') return t
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  const inFremderListe = !t.bereich && String(t.besitzer_email ?? '').toLowerCase() !== eigeneEmail
  const angegeben = (feld: string) => input?.[feld] !== undefined && input?.[feld] !== null
  const patch: Record<string, string | number | null> = {}
  const was: string[] = []

  // Zuweisung an einen Kollegen zuerst klären: Ein unklarer Name ändert nichts (Rückfrage).
  const fuer = String(input?.fuer ?? '').trim()
  const zustaendigNeu = angegeben('zustaendig') ? String(input.zustaendig).trim() : ''
  let kollege: TeamZeile | null = null
  let umgezogen = false
  if ((fuer || zustaendigNeu) && !imPrivatBot()) {
    const k = await kollegeAusAngabe(supabase, fragender, fuer || zustaendigNeu, !!fuer)
    if (typeof k === 'string') return k
    if (k) kollege = k
  } else if (fuer && imPrivatBot()) return 'Nicht geändert: Im privaten Assistenten bleiben To-dos in der eigenen privaten Liste.'
  if (kollege) {
    if (t.erledigt_am) return `Nicht zugewiesen: „${t.aufgabe}" ist seit ${deDatum(t.erledigt_am)} erledigt. Für eine neue Aufgabe an ${kollege.name} nimm todo_anlegen mit fuer.`
    if (t.bereich) {
      patch.zustaendig = kollege.name
      was.push(`zuständig: ${kollege.name}`)
    } else {
      if (t.ms_id) return `Nicht zugewiesen: „${t.aufgabe}" kommt aus Microsoft To Do und bleibt in dieser Liste. Leg für ${kollege.name} stattdessen ein neues To-do an (todo_anlegen mit fuer).`
      if (!kollege.email) return `Nicht zugewiesen: Für ${kollege.name} ist keine E-Mail-Adresse hinterlegt, darum hat er keine eigene To-do-Liste.`
      patch.besitzer_email = kollege.email.toLowerCase()
      patch.zustaendig = kollege.name
      patch.reihenfolge = await naechsteReihenfolge(supabase, null, kollege.email.toLowerCase())
      umgezogen = true
      was.push(`in die eigene To-do-Liste von ${kollege.name} verschoben`)
    }
  }

  if (angegeben('aufgabe')) {
    const neu = String(input.aufgabe).trim().slice(0, 500)
    if (!neu) return 'Fehler: Der Aufgabentext darf nicht leer sein. Zum Abhaken nimm todo_erledigen.'
    if (neu !== t.aufgabe) {
      patch.aufgabe = neu
      was.push(`Text jetzt „${neu}"`)
    }
  }
  if (umgezogen) patch.aufgabe = mitAbsender(String(patch.aufgabe ?? t.aufgabe), fragender.name).slice(0, 500)
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
      const empfaenger = t.bereich || kollege || inFremderListe ? ` an ${kollege?.name || String(input?.zustaendig ?? '').trim() || t.zustaendig || (inFremderListe ? t.besitzer_email : '') || 'den Zuständigen'}` : ''
      was.push(`Erinnerung per Telegram am ${deZeitpunkt(erinnerung.wert)}${empfaenger}`)
      // Wie bei todo_anlegen: Ohne Fälligkeit wird der Tag der Erinnerung die Fälligkeit.
      if (!('erledigen_bis' in patch) && !t.erledigen_bis) {
        patch.erledigen_bis = BERLIN_DATUM.format(new Date(erinnerung.wert))
        was.push(`erledigen bis ${deDatum(String(patch.erledigen_bis))}`)
      }
    } else was.push('Erinnerung entfernt')
  }
  const wiederholung = leseWiederholung(input?.wiederholen)
  if (wiederholung.fehler) return wiederholung.fehler
  if (wiederholung.wert !== undefined) {
    const hatErinnerung = erinnerung.wert !== undefined ? !!erinnerung.wert : !!t.erinnern_um
    if (wiederholung.wert && !hatErinnerung) return 'Fehler: Eine Wiederholung braucht eine Erinnerungszeit. Gib erinnern_um mit an (z. B. morgen 09:00) oder frag nach der Uhrzeit.'
    patch.erinnerung_wiederholung = wiederholung.wert
    was.push(wiederholung.wert ? `Erinnerung wiederholt sich ${wiederholungText(wiederholung.wert)}, bis es erledigt ist` : 'Erinnerung nur noch einmalig')
  } else if (erinnerung.wert === '') {
    // Erinnerung weg → auch keine Wiederholung mehr (fehlt die Spalte noch, wird das unten ohne sie geschrieben).
    patch.erinnerung_wiederholung = null
  }
  const textFelder: [string, string][] = [['zustaendig', 'zuständig'], ['kunde_projekt', 'Kunde/Projekt'], ['aktueller_stand', 'aktueller Stand']]
  for (const [feld, name] of textFelder) {
    if (!angegeben(feld)) continue
    if (feld === 'zustaendig' && kollege) continue // schon oben als Zuweisung gesetzt
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
  let { error } = await supabase.from('todos').update(patch).eq('id', t.id)
  if (error && fehltWiederholungsSpalte(error)) {
    if (patch.erinnerung_wiederholung) return WIEDERHOLUNG_FEHLT
    delete patch.erinnerung_wiederholung
    ;({ error } = await supabase.from('todos').update(patch).eq('id', t.id))
  }
  if (error) return `Fehler beim Ändern: ${error.message}`
  const liste = listenName(t, eigeneEmail)
  protokolliere(`To-do „${t.aufgabe.slice(0, 120)}" geändert: ${was.join('; ').slice(0, 300)} (todo_id=${t.id})`)
  const erledigtHinweis = t.erledigt_am ? ` Hinweis: Das To-do ist seit ${deDatum(t.erledigt_am)} erledigt${patch.erinnern_um ? ', eine Erinnerung kommt dafür nicht' : ''}.` : ''
  const grund = `Geändert (${liste}, kein neues To-do angelegt): „${patch.aufgabe ?? t.aufgabe}" — ${was.join('; ')}.${erledigtHinweis}`
  if (!kollege) return `${grund} todo_id=${t.id}`
  const faellig = (patch.erledigen_bis !== undefined ? patch.erledigen_bis : t.erledigen_bis) as string | null
  const meldung = await benachrichtigeKollegen(
    supabase,
    wege,
    kollege,
    zuweisungsMitteilung({ von: fragender.name, aufgabe: String(input?.aufgabe ?? '').trim() || t.aufgabe, faellig: faellig ? deDatum(faellig) : null, liste: t.bereich ? `To-do-Liste ${bereichName(t.bereich)}` : null, neu: false }),
    fragender.name,
    protokolliere,
  )
  const bereichHinweis = t.bereich && !darfBereich(kollege, t.bereich) ? ` Achtung: Der Bereich ${bereichName(t.bereich)} ist für ${kollege.name} nicht freigegeben, er sieht diese Liste nicht — sag das dem Mitarbeiter.` : ''
  const nichtMehrSichtbar = umgezogen ? ` Es steht jetzt nicht mehr in der Liste von ${fragender.name}.` : ''
  return `ZUGEWIESEN AN ${kollege.name}. ${grund}${nichtMehrSichtbar} ${meldung}${bereichHinweis} Sag dem Mitarbeiter ausdrücklich, wem die Aufgabe jetzt zugewiesen ist und ob er benachrichtigt wurde. todo_id=${t.id}`
}

/**
 * Werkzeug todo_loeschen (Wunsch aus der Nutzung, 23.11.2026): ein To-do endgültig löschen statt nur abhaken —
 * wie der Papierkorb-Knopf in der To-Do-Liste des CRM (src/pages/todo/ToDoListe.tsx: dort löscht in der eigenen
 * Liste nur der Besitzer, in einer Bereichsliste jeder, der den Bereich sieht; das CRM löscht die Zeile direkt,
 * eine Sicherung oder einen Papierkorb gibt es für To-dos nicht). Gleiche Suche und Rechte wie todo_erledigen,
 * dazu auch schon abgehakte To-dos.
 * Nur, wenn der Mitarbeiter ausdrücklich löschen/entfernen will (anlass = seine Nachricht und die davor; ohne
 * anlass — z. B. in Tests — entfällt die Prüfung). Im Mayer-Assistenten nie Aufgaben aus Microsoft To Do
 * (Privat bleibt privat, wie bei todos_aufraeumen); im privaten Assistenten ja, der Abgleich löscht sie dort mit.
 */
export async function todoLoeschen(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  protokolliere: (text: string) => void,
  anlass?: readonly (string | null | undefined)[],
): Promise<string> {
  if (anlass && !loeschWunsch(anlass)) {
    return 'Nicht gelöscht: Der Mitarbeiter hat nicht ausdrücklich ums Löschen gebeten. Ist die Aufgabe erledigt, hak sie mit todo_erledigen ab; will er sie wirklich von der Liste haben, frag kurz „Endgültig löschen?“ und lösche erst nach seinem Ja.'
  }
  const t = await findeTodo(supabase, fragender, input, { auchErledigte: true })
  if (typeof t === 'string') return t
  const privat = imPrivatBot()
  if (t.ms_id && !privat) {
    return `Nicht gelöscht: „${t.aufgabe}" kommt aus seinem Microsoft To Do (privat). Das löscht er im privaten Assistenten, in Microsoft To Do oder im CRM in der To-Do-Liste.`
  }
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  // Die Zeilenregel noch einmal im Löschbefehl selbst (der Assistent arbeitet mit vollen Datenbankrechten).
  const befehl = supabase.from('todos').delete().eq('id', t.id)
  const { error } = t.bereich ? await befehl.eq('bereich', t.bereich) : await befehl.is('bereich', null).ilike('besitzer_email', eigeneEmail)
  if (error) return `Fehler beim Löschen: ${error.message}`
  const liste = t.bereich ? `Liste ${bereichName(t.bereich)}` : privat ? 'private Liste' : 'eigene Liste'
  protokolliere(`To-do „${t.aufgabe.slice(0, 120)}" gelöscht (${liste}, todo_id=${t.id})`)
  const ms = t.ms_id ? ' In Microsoft To Do verschwindet es beim nächsten Abgleich (alle 3 Minuten).' : ''
  return `Gelöscht (${liste}): „${t.aufgabe}". Endgültig, es steht auch nicht mehr unter „Erledigt“.${ms}`
}
