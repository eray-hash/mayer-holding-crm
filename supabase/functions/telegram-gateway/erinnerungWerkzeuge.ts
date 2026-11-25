// Erinnerungen im Telegram-Assistenten (25.11.2026, Wunsch der Geschäftsführung: „Eine Erinnerung ist kein To-do.“).
// Vorher legte „erinnere Andreas um 12 an …“ ein To-do in dessen Liste an (todo_anlegen mit erinnern_um). Jetzt:
//   erinnerung_anlegen / erinnerungen_zeigen / erinnerung_verschieben / erinnerung_loeschen → Tabelle erinnerungen,
//   Versand zur Uhrzeit: email-gateway/erinnerungVersand.ts, Kern: _shared/erinnerungKern.ts.
// Für Kollegen: Der Kollege bekommt vorher KEINE Nachricht, nur zur Uhrzeit die Erinnerung mit „(von Hasan)“; der
// Auftraggeber bekommt die Bestätigung im Chat. Privater Assistent: nur eigene Erinnerungen (privat=true), keine für
// Kollegen; Mayer-seitig erscheinen private Erinnerungen nie.
// Knöpfe unter der Erinnerung (er:e:<id> erledigt, er:s:<id> in 1 Stunde nochmal): verarbeiteErinnerungKnopf.

import { personenNamen } from '../_shared/aufgabenKern.ts'
import {
  deUhrzeit, deZeitpunkt, type ErinnerungZeile, HOECHSTE_TEXTLAENGE, leseErinnerungKnopf, leseWiederholung, leseZeitpunkt, naechsterZeitpunkt,
  SPAETER_MS, vorname, WIEDERHOLUNG_TEXT, type Wiederholung,
} from '../_shared/erinnerungKern.ts'
import { darfAkte, istPrivat, type RechteMitarbeiter } from './rechte.ts'
import { findeKollege, kollegeUnklar } from './todoZuweisung.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
export type ErinnerungFragender = RechteMitarbeiter & { id: string; name: string; email?: string | null }
export type ErinnerungKontext = {
  supabase: Supa
  mitarbeiter: ErinnerungFragender
  protokolliere: (text: string) => void
  /** Privater Assistent? (imPrivatBot() im Aufrufer) */
  privat: boolean
  jetzt?: number
}

const SPALTEN = 'id, fuer_email, von_email, von_name, text, faellig_um, kunde_id, kunde_bereich, objekt_id, gesendet_am, erledigt_am, wiederholung, privat'
const TABELLE_FEHLT = 'Erinnerungen sind noch nicht eingerichtet (die Tabelle fehlt in der Datenbank). Sag dem Mitarbeiter, dass Eray das noch freischalten muss; lege stattdessen NICHTS als To-do an, außer er will das ausdrücklich.'

export const ERINNERUNG_WERKZEUGE = [
  {
    name: 'erinnerung_anlegen',
    description:
      'Legt eine ERINNERUNG an: Zur genannten Zeit kommt per Telegram „⏰ Erinnerung: <text>“. Für „erinnere mich …“, „erinnere Hasan um 12 an …“, „denk dran …“, „schick mir um 15 Uhr eine Nachricht …“ — IMMER dieses Werkzeug, NIE todo_anlegen (eine Erinnerung ist kein To-do und landet nicht in der To-do-Liste). ' +
      'Relative Angaben („in 2 Stunden“, „morgen 9 Uhr“, „Freitag früh“) rechnest du selbst vom aktuellen Datum und der aktuellen Uhrzeit aus; ohne Uhrzeit nimm 09:00. Frag nicht zurück, wenn Tag oder Uhrzeit erkennbar sind. ' +
      'Für einen Kollegen: fuer=<Name>. Er bekommt vorher nichts, nur zur Uhrzeit die Erinnerung mit „(von <dir>)“. Gehört es zu einer Akte, gib kunde_id mit (vorher kunden_suchen). ' +
      'Bestätige danach kurz: wann, für wen, welcher Text.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Woran erinnert wird, kurz und in Du-Form für den Empfänger, z. B. „Bestätigungsschreiben 34c prüfen“.' },
        wann: { type: 'string', description: 'Zeitpunkt in deutscher Ortszeit, Form JJJJ-MM-TTTHH:MM, z. B. 2026-11-25T12:00.' },
        fuer: { type: 'string', description: '„ich“ (Vorgabe) oder Vorname/Name eines Kollegen.' },
        kunde_id: { type: 'string', description: 'Optional: Akte, zu der die Erinnerung gehört.' },
        wiederholung: { type: 'string', enum: ['', 'taeglich', 'woechentlich', 'monatlich'], description: 'Optional, nur wenn ausdrücklich gewünscht („jeden Montag um 8“).' },
      },
      required: ['text', 'wann'],
    },
  },
  {
    name: 'erinnerungen_zeigen',
    description: 'Zeigt offene Erinnerungen: die an den Mitarbeiter und die, die er für Kollegen bestellt hat (mit erinnerung_id). Für „welche Erinnerungen habe ich?“, „woran erinnerst du mich noch?“.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'erinnerung_verschieben',
    description: 'Verschiebt eine offene oder schon verschickte Erinnerung auf einen neuen Zeitpunkt (auch „später“, „in einer Stunde nochmal“, „morgen nochmal“) und ändert auf Wunsch den Text. Mit erinnerung_id (aus erinnerungen_zeigen) oder suchbegriff.',
    input_schema: {
      type: 'object',
      properties: {
        erinnerung_id: { type: 'string' },
        suchbegriff: { type: 'string', description: 'Wort aus dem Erinnerungstext.' },
        wann: { type: 'string', description: 'Neuer Zeitpunkt, deutsche Ortszeit JJJJ-MM-TTTHH:MM.' },
        text: { type: 'string', description: 'Optional: neuer Text.' },
      },
      required: ['wann'],
    },
  },
  {
    name: 'erinnerung_loeschen',
    description: 'Löscht eine Erinnerung (auch eine wiederkehrende ganz). Mit erinnerung_id oder suchbegriff; bei mehreren Treffern kommt eine Liste zum Nachfragen.',
    input_schema: {
      type: 'object',
      properties: {
        erinnerung_id: { type: 'string' },
        suchbegriff: { type: 'string' },
      },
    },
  },
]

export function istErinnerungWerkzeug(name: string): boolean {
  return ERINNERUNG_WERKZEUGE.some((w) => w.name === name)
}

type TeamZeile = { id: string; name: string; email: string | null; telegram_chat_id: number | string | null }

async function ladeTeam(supabase: Supa): Promise<TeamZeile[]> {
  const { data } = await supabase.from('mitarbeiter').select('id, name, email, telegram_chat_id').eq('aktiv', true)
  return ((data ?? []) as TeamZeile[]).filter((m) => m.name)
}

function tabelleFehlt(fehler: { message?: string; code?: string } | null | undefined): boolean {
  const m = String(fehler?.message ?? '')
  return fehler?.code === '42P01' || fehler?.code === 'PGRST205' || /erinnerungen.*(does not exist|schema cache)|(does not exist|schema cache).*erinnerungen/i.test(m)
}

function zeile(z: ErinnerungZeile, ich: string): string {
  const fuerMich = z.fuer_email.toLowerCase() === ich
  const wer = fuerMich ? (z.von_email && z.von_email.toLowerCase() !== ich ? ` (von ${vorname(z.von_name)})` : '') : ` → für ${z.fuer_email}`
  const w = z.wiederholung as Exclude<Wiederholung, ''> | undefined
  const wdh = w && WIEDERHOLUNG_TEXT[w] ? `, ${WIEDERHOLUNG_TEXT[w]}` : ''
  const stand = z.gesendet_am && !w ? ' [schon verschickt]' : ''
  return `- ${deZeitpunkt(z.faellig_um)}${wdh}: „${z.text}“${wer}${stand} (erinnerung_id=${z.id})`
}

/** Erinnerungen, die der Fragende sehen und ändern darf: an ihn oder von ihm; im Mayer-Bot nie private, im privaten Bot nur private eigene. */
function sichtbar(z: ErinnerungZeile, ich: string, privat: boolean): boolean {
  const meine = z.fuer_email.toLowerCase() === ich || String(z.von_email ?? '').toLowerCase() === ich
  if (!meine) return false
  return privat ? z.privat === true && z.fuer_email.toLowerCase() === ich : z.privat !== true
}

async function findeErinnerung(k: ErinnerungKontext, ich: string, input: { erinnerung_id?: unknown; suchbegriff?: unknown }): Promise<ErinnerungZeile | string> {
  const id = String(input?.erinnerung_id ?? '').trim()
  const such = String(input?.suchbegriff ?? '').trim().toLowerCase()
  if (!id && !such) return 'Fehler: erinnerung_id oder suchbegriff angeben (erinnerungen_zeigen liefert die id).'
  let abfrage = k.supabase.from('erinnerungen').select(SPALTEN).is('erledigt_am', null)
  if (id) abfrage = abfrage.eq('id', id)
  const { data, error } = await abfrage.or(`fuer_email.ilike.${ich},von_email.ilike.${ich}`).order('faellig_um', { ascending: true }).limit(200)
  if (error) return tabelleFehlt(error) ? TABELLE_FEHLT : `Fehler: ${error.message}`
  const treffer = ((data ?? []) as ErinnerungZeile[]).filter((z) => sichtbar(z, ich, k.privat) && (!such || z.text.toLowerCase().includes(such)))
  if (treffer.length === 0) return 'Keine passende offene Erinnerung gefunden. Zeig mit erinnerungen_zeigen, welche es gibt.'
  if (treffer.length > 1) return `Mehrere passen — frag nach, welche gemeint ist:\n${treffer.slice(0, 10).map((z) => zeile(z, ich)).join('\n')}`
  return treffer[0]
}

// deno-lint-ignore no-explicit-any
export async function fuehreErinnerungWerkzeugAus(name: string, input: any, k: ErinnerungKontext): Promise<string> {
  const ich = String(k.mitarbeiter.email ?? '').trim().toLowerCase()
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt, darum kann keine Erinnerung zugeordnet werden.'
  const jetzt = k.jetzt ?? Date.now()

  if (name === 'erinnerung_anlegen') {
    const text = String(input?.text ?? '').trim().replace(/^⏰\s*/, '').replace(/^erinnerung:\s*/i, '').slice(0, HOECHSTE_TEXTLAENGE)
    if (!text) return 'Fehler: text fehlt — woran soll erinnert werden?'
    const zeit = leseZeitpunkt(input?.wann, jetzt)
    if ('fehler' in zeit) return zeit.fehler
    const wiederholung = leseWiederholung(input?.wiederholung)
    if (wiederholung === null) return 'Fehler: wiederholung muss leer, taeglich, woechentlich oder monatlich sein.'

    // Für wen?
    const fuerRoh = String(input?.fuer ?? '').trim()
    const team = await ladeTeam(k.supabase)
    let ziel: TeamZeile | undefined = team.find((m) => String(m.email ?? '').toLowerCase() === ich)
    let fuerKollege = false
    if (fuerRoh && !/^(ich|mich|mir|selbst|mich selbst)$/i.test(fuerRoh)) {
      const namen = personenNamen(team.map((m) => m.name))
      const treffer = findeKollege(fuerRoh, namen)
      if (treffer.art !== 'eindeutig') return `Nicht angelegt: ${kollegeUnklar(fuerRoh, treffer, namen.filter((n) => n !== k.mitarbeiter.name))}`
      const kollege = team.find((m) => m.name === treffer.name)
      if (kollege && String(kollege.email ?? '').toLowerCase() !== ich) {
        if (k.privat) return 'Nicht angelegt: Im privaten Assistenten gibt es nur Erinnerungen für dich selbst. Erinnerungen für Kollegen gehen über den Mayer-Assistenten.'
        if (!kollege.email) return `Nicht angelegt: Für ${kollege.name} ist keine E-Mail-Adresse hinterlegt.`
        if (!kollege.telegram_chat_id) return `Nicht angelegt: ${kollege.name} ist nicht mit Telegram verbunden und würde die Erinnerung nie bekommen. Biete stattdessen an, ihm ein To-do zu schicken oder es ihm selbst zu sagen.`
        ziel = kollege
        fuerKollege = true
      }
    }
    const fuerEmail = fuerKollege ? String(ziel!.email).toLowerCase() : ich

    // Akte (optional): Rechte des Auftraggebers; eine private Akte nie in die Erinnerung eines Kollegen.
    let kundeId: string | null = null
    let kundeBereich: string | null = null
    let akteText = ''
    const kid = String(input?.kunde_id ?? '').trim()
    if (kid) {
      const { data: akte } = await k.supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kid).maybeSingle()
      if (!akte || !darfAkte(k.mitarbeiter, akte)) return 'Fehler: Diese Akte gibt es für dich nicht. Ermittle die kunde_id mit kunden_suchen.'
      if (fuerKollege && istPrivat(akte)) return 'Nicht angelegt: Das ist ein privater Kontakt — er erscheint nicht in der Erinnerung eines Kollegen. Leg sie ohne kunde_id an.'
      kundeId = akte.id
      kundeBereich = akte.bereich ?? null
      akteText = `, Akte „${String(akte.firma || akte.ansprechpartner || akte.id)}“`
    }

    const { data, error } = await k.supabase
      .from('erinnerungen')
      .insert({
        fuer_email: fuerEmail,
        von_email: ich,
        von_name: k.mitarbeiter.name,
        text,
        faellig_um: zeit.utc,
        kunde_id: kundeId,
        kunde_bereich: kundeBereich,
        wiederholung,
        privat: k.privat,
        quelle: k.privat ? 'telegram_privat' : 'telegram',
      })
      .select('id')
      .single()
    if (error) return tabelleFehlt(error) ? TABELLE_FEHLT : `Fehler beim Anlegen: ${error.message}`
    const wdh = wiederholung ? `, wiederholt sich ${WIEDERHOLUNG_TEXT[wiederholung]}` : ''
    const fuerText = fuerKollege ? ziel!.name : 'dich'
    k.protokolliere(`Erinnerung für ${fuerKollege ? ziel!.name : 'sich'} am ${deZeitpunkt(zeit.utc)}${wdh}: „${text.slice(0, 120)}“ (erinnerung_id=${data?.id})`)
    const ohneTelegram = !fuerKollege && !ziel?.telegram_chat_id ? ' Achtung: Du bist nicht mit Telegram verbunden — die Erinnerung steht nur im CRM unter „Heute“.' : ''
    return (
      `ERINNERUNG GESPEICHERT (kein To-do): ${deZeitpunkt(zeit.utc)}${wdh} bekommt ${fuerText} per Telegram „⏰ Erinnerung: ${text}“${fuerKollege ? ` (von ${vorname(k.mitarbeiter.name)})` : ''}${akteText}.` +
      (fuerKollege ? ` ${ziel!.name} bekommt vorher keine Nachricht, nur zur Uhrzeit die Erinnerung.` : '') +
      `${ohneTelegram} Bestätige kurz in einem Satz (wann, für wen, was) und nenne es Erinnerung, nicht To-do. erinnerung_id=${data?.id}`
    )
  }

  if (name === 'erinnerungen_zeigen') {
    const { data, error } = await k.supabase
      .from('erinnerungen')
      .select(SPALTEN)
      .is('erledigt_am', null)
      .or(`fuer_email.ilike.${ich},von_email.ilike.${ich}`)
      .order('faellig_um', { ascending: true })
      .limit(200)
    if (error) return tabelleFehlt(error) ? TABELLE_FEHLT : `Fehler: ${error.message}`
    // Offen = noch nicht verschickt (oder wiederkehrend); verschickte Einmal-Erinnerungen der letzten 12 Stunden zum Verschieben.
    const alle = ((data ?? []) as ErinnerungZeile[]).filter((z) => sichtbar(z, ich, k.privat))
    const offen = alle.filter((z) => !z.gesendet_am || z.wiederholung)
    const kuerzlich = alle.filter((z) => z.gesendet_am && !z.wiederholung && jetzt - Date.parse(z.gesendet_am) < 12 * 3600 * 1000)
    if (offen.length === 0 && kuerzlich.length === 0) return 'Keine offenen Erinnerungen.'
    const an = offen.filter((z) => z.fuer_email.toLowerCase() === ich)
    const fuerAndere = offen.filter((z) => z.fuer_email.toLowerCase() !== ich)
    const namen = new Map((await ladeTeam(k.supabase)).map((m) => [String(m.email ?? '').toLowerCase(), m.name]))
    const mitNamen = (s: string) => s.replace(/→ für (\S+@\S+?)( |\[|\(|$)/, (_m, e, r) => `→ für ${namen.get(String(e).toLowerCase()) ?? e}${r}`)
    const teile: string[] = []
    if (an.length) teile.push(`An dich (${an.length}):\n${an.map((z) => zeile(z, ich)).join('\n')}`)
    if (fuerAndere.length) teile.push(`Von dir für Kollegen (${fuerAndere.length}):\n${fuerAndere.map((z) => mitNamen(zeile(z, ich))).join('\n')}`)
    if (kuerzlich.length) teile.push(`Heute schon verschickt (lassen sich verschieben):\n${kuerzlich.map((z) => mitNamen(zeile(z, ich))).join('\n')}`)
    return teile.join('\n\n')
  }

  if (name === 'erinnerung_verschieben') {
    const z = await findeErinnerung(k, ich, input)
    if (typeof z === 'string') return z
    const zeit = leseZeitpunkt(input?.wann, jetzt)
    if ('fehler' in zeit) return zeit.fehler
    const neu: Record<string, unknown> = { faellig_um: zeit.utc, gesendet_am: null }
    const text = String(input?.text ?? '').trim().slice(0, HOECHSTE_TEXTLAENGE)
    if (text) neu.text = text
    const { error } = await k.supabase.from('erinnerungen').update(neu).eq('id', z.id)
    if (error) return `Fehler beim Verschieben: ${error.message}`
    k.protokolliere(`Erinnerung „${(text || z.text).slice(0, 80)}“ verschoben auf ${deZeitpunkt(zeit.utc)}`)
    return `Verschoben: „${text || z.text}“ kommt jetzt ${deZeitpunkt(zeit.utc)}.`
  }

  if (name === 'erinnerung_loeschen') {
    const z = await findeErinnerung(k, ich, input)
    if (typeof z === 'string') return z
    const { error } = await k.supabase.from('erinnerungen').delete().eq('id', z.id)
    if (error) return `Fehler beim Löschen: ${error.message}`
    k.protokolliere(`Erinnerung „${z.text.slice(0, 80)}“ gelöscht`)
    return `Gelöscht: Erinnerung „${z.text}“ (${deZeitpunkt(z.faellig_um)}).`
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}

export type TelegramApi = (methode: string, daten: Record<string, unknown>) => Promise<Record<string, unknown> | null>

/**
 * Knopf unter einer Erinnerung (er:e:<id> erledigt, er:s:<id> in 1 Stunde nochmal). Nur der Empfänger im eigenen Chat.
 * Einmalige: erledigt → erledigt_am; später → faellig_um = jetzt + 1 h, gesendet_am leer (kommt erneut).
 * Wiederkehrende: erledigt = nur bestätigt (die Reihe läuft weiter, löschen per „Erinnerung löschen“);
 * später → eine einmalige Kopie in 1 Stunde, die Reihe bleibt unverändert. Danach verschwinden die Knöpfe. Wirft nie.
 */
// deno-lint-ignore no-explicit-any
export async function verarbeiteErinnerungKnopf(k: { supabase: Supa; knopf: any; antworte: (text: string) => Promise<unknown>; telegram: TelegramApi; jetzt?: number }): Promise<void> {
  try {
    const knopf = leseErinnerungKnopf(k.knopf?.data)
    const chatId = k.knopf?.message?.chat?.id
    if (!knopf || !chatId) return void (await k.antworte('Unbekannter Knopf.'))
    const { data: m } = await k.supabase.from('mitarbeiter').select('email, aktiv').eq('telegram_chat_id', chatId).maybeSingle()
    if (!m?.aktiv || !m.email) return void (await k.antworte('Dieser Chat ist mit keinem CRM-Zugang verbunden.'))
    const { data: z } = await k.supabase.from('erinnerungen').select(SPALTEN).eq('id', knopf.id).maybeSingle()
    if (!z || String(z.fuer_email).toLowerCase() !== String(m.email).trim().toLowerCase()) return void (await k.antworte('Diese Erinnerung gibt es nicht mehr.'))
    const jetzt = k.jetzt ?? Date.now()
    let vermerk: string
    if (knopf.art === 'e') {
      if (!z.wiederholung) {
        if (!z.erledigt_am) await k.supabase.from('erinnerungen').update({ erledigt_am: new Date(jetzt).toISOString() }).eq('id', z.id)
        vermerk = '✓ erledigt'
      } else {
        const n = naechsterZeitpunkt(z.faellig_um, z.wiederholung, jetzt)
        vermerk = `✓ erledigt${n ? ` — nächste ${deZeitpunkt(n)}` : ''}`
      }
    } else {
      const neu = new Date(jetzt + SPAETER_MS).toISOString()
      if (!z.wiederholung) {
        const { error } = await k.supabase.from('erinnerungen').update({ faellig_um: neu, gesendet_am: null, erledigt_am: null }).eq('id', z.id)
        if (error) return void (await k.antworte('Das hat nicht geklappt.'))
      } else {
        const { error } = await k.supabase.from('erinnerungen').insert({
          fuer_email: z.fuer_email, von_email: z.von_email, von_name: z.von_name, text: z.text, faellig_um: neu,
          kunde_id: z.kunde_id, kunde_bereich: z.kunde_bereich, objekt_id: z.objekt_id, wiederholung: '', privat: z.privat === true, quelle: 'knopf_spaeter',
        })
        if (error) return void (await k.antworte('Das hat nicht geklappt.'))
      }
      vermerk = `→ kommt um ${deUhrzeit(neu)} Uhr nochmal`
    }
    await k.antworte(vermerk)
    const nachricht = k.knopf?.message
    if (nachricht?.message_id) {
      await k.telegram('editMessageText', { chat_id: chatId, message_id: nachricht.message_id, text: `${String(nachricht.text ?? '')}\n\n${vermerk}`.slice(0, 4000), reply_markup: { inline_keyboard: [] } })
    }
  } catch (err) {
    console.error('Erinnerungs-Knopf fehlgeschlagen:', err)
    await k.antworte('Das hat nicht geklappt.').catch(() => undefined)
  }
}
