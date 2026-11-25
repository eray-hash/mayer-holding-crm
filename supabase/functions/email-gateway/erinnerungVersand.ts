// Versand fälliger Erinnerungen (Tabelle erinnerungen, _shared/erinnerungKern.ts). Der Zeitplan ruft jede Minute
// termin_erinnerungen auf; dort läuft sendeFaelligeErinnerungen neben den To-do-Erinnerungen (todoErinnerung.ts).
//
// - An wen: fuer_email, nur wer aktiv und mit Telegram verbunden ist. Sonst still abgehakt (gesendet_am gesetzt),
//   damit es nicht jede Minute erneut versucht wird — die Erinnerung bleibt im CRM sichtbar.
// - Doppelt-sicher: erst beanspruchen (update … set gesendet_am where gesendet_am is null and faellig_um = <gelesen>
//   returning), dann senden. Ohne gespeicherten Vermerk keine Nachricht — auch wenn zwei Läufe gleichzeitig laufen.
//   Scheitert der Versand, wird der Vermerk zurückgenommen (nächster Versuch in der nächsten Minute).
// - Wiederholung: nach erfolgreichem Versand rückt faellig_um auf den nächsten Zeitpunkt und gesendet_am wird wieder leer.
// - Privat (im privaten Assistenten angelegt): nur über den privaten Bot, nie aufgezeichnet. Ist der private Bot nicht
//   aktiv, über den Mayer-Bot ohne Inhalt im Protokoll.
// - Mayer-Bot: über kalender.ts sendeTelegram (art 'erinnerung' → nachrichten_protokoll). Eigene Erinnerungen ohne Inhalt
//   im Protokoll (persönlich), von einem Kollegen bestellte mit Inhalt.
// - Länger als 2 Tage überfällig und nie gesendet (Zeitplan stand still) → still abgehakt.
import { erinnerungKnoepfe, erinnerungsNachricht, type ErinnerungZeile, istZuAlt, naechsterZeitpunkt } from '../_shared/erinnerungKern.ts'
import { sendeTelegram } from './kalender.ts'
import { privatBotAktiv, sendePrivat } from '../_shared/telegramPrivat.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const HOECHSTENS_JE_LAUF = 50
const SPALTEN = 'id, fuer_email, von_email, von_name, text, faellig_um, kunde_id, kunde_bereich, objekt_id, gesendet_am, erledigt_am, wiederholung, privat'

export type ErinnerungVersandWege = {
  /** Mayer-Bot: (chat, text, ohneInhalt, knöpfe) → ok */
  sende?: (chat: number | string, text: string, ohneInhalt: boolean, knoepfe: unknown) => Promise<boolean>
  /** Privater Bot */
  sendePrivat?: (chat: number | string, text: string, knoepfe: unknown) => Promise<boolean>
  hatPrivatBot?: (email: string) => Promise<boolean>
  jetzt?: () => number
}

/** Beansprucht die Erinnerung: gesetzter Stempel oder null (nicht senden — schon gesendet, geändert oder Fehler). */
export async function beanspruche(admin: Db, z: Pick<ErinnerungZeile, 'id' | 'faellig_um'>, stempel: string): Promise<boolean> {
  const { data, error } = await admin.from('erinnerungen').update({ gesendet_am: stempel }).eq('id', z.id).eq('faellig_um', z.faellig_um).is('gesendet_am', null).is('erledigt_am', null).select('id')
  if (error) {
    console.error('Erinnerung: gesendet_am nicht gesetzt', z.id, error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

async function akteName(admin: Db, z: ErinnerungZeile): Promise<string | null> {
  if (!z.kunde_id) return null
  const { data } = await admin.from('kunden').select('firma, ansprechpartner').eq('id', z.kunde_id).maybeSingle()
  if (!data) return null
  return String(data.firma || data.ansprechpartner || '').trim() || null
}

export async function sendeFaelligeErinnerungen(admin: Db, wege: ErinnerungVersandWege = {}): Promise<{ gesendet: number; abgehakt: number }> {
  const jetzt = (wege.jetzt ?? Date.now)()
  const sende = wege.sende ?? ((chat, text, ohneInhalt, knoepfe) => sendeTelegram(chat, text, 'erinnerung', ohneInhalt, { reply_markup: { inline_keyboard: knoepfe } }))
  const sendeP = wege.sendePrivat ?? (async (chat, text, knoepfe) => !!(await sendePrivat(chat, text, { reply_markup: { inline_keyboard: knoepfe } })))
  const { data, error } = await admin
    .from('erinnerungen')
    .select(SPALTEN)
    .is('gesendet_am', null)
    .is('erledigt_am', null)
    .lte('faellig_um', new Date(jetzt).toISOString())
    .order('faellig_um', { ascending: true })
    .limit(HOECHSTENS_JE_LAUF)
  if (error) {
    // Tabelle noch nicht angelegt (SQL nicht ausgeführt) → still.
    if (!/erinnerungen/.test(String(error.message))) console.error('Erinnerungen: Abfrage fehlgeschlagen', error.message)
    return { gesendet: 0, abgehakt: 0 }
  }
  const faellige = (data ?? []) as ErinnerungZeile[]
  if (faellige.length === 0) return { gesendet: 0, abgehakt: 0 }

  const { data: ma } = await admin.from('mitarbeiter').select('email, telegram_chat_id, aktiv').eq('aktiv', true)
  const chatVon = new Map<string, number | string>()
  for (const m of (ma ?? []) as { email: string | null; telegram_chat_id: number | string | null }[]) {
    if (m.email && m.telegram_chat_id) chatVon.set(m.email.trim().toLowerCase(), m.telegram_chat_id)
  }

  let gesendet = 0
  let abgehakt = 0
  for (const z of faellige) {
    const stempel = new Date(jetzt).toISOString()
    const chat = chatVon.get(String(z.fuer_email).toLowerCase())
    if (istZuAlt(z, jetzt) || !chat) {
      console.warn(`Erinnerung ${z.id} abgehakt ohne Versand:`, chat ? 'über 2 Tage alt' : 'Empfänger nicht aktiv oder ohne Telegram')
      if (await beanspruche(admin, z, stempel)) {
        abgehakt++
        await weiter(admin, z, stempel, jetzt)
      }
      continue
    }
    if (!(await beanspruche(admin, z, stempel))) continue
    const text = erinnerungsNachricht(z, await akteName(admin, z).catch(() => null))
    const knoepfe = erinnerungKnoepfe(z.id)
    const eigene = !z.von_email || z.von_email.toLowerCase() === z.fuer_email.toLowerCase()
    let ok = false
    try {
      const privatWeg = z.privat === true && (await (wege.hatPrivatBot ? wege.hatPrivatBot(z.fuer_email) : privatBotAktiv(admin, z.fuer_email)).catch(() => false))
      ok = privatWeg ? await sendeP(chat, text, knoepfe) : await sende(chat, text, eigene || z.privat === true, knoepfe)
    } catch (err) {
      console.error('Erinnerung: Versand fehlgeschlagen', z.id, err)
    }
    if (!ok) {
      const { error: f } = await admin.from('erinnerungen').update({ gesendet_am: null }).eq('id', z.id).eq('gesendet_am', stempel)
      if (f) console.error('Erinnerung: Vermerk nicht zurückgenommen', z.id, f.message)
      continue
    }
    gesendet++
    await weiter(admin, z, stempel, jetzt)
  }
  if (gesendet || abgehakt) console.log(`Erinnerungen: ${gesendet} gesendet, ${abgehakt} still abgehakt, ${faellige.length} fällig`)
  return { gesendet, abgehakt }
}

/** Wiederholung: auf den nächsten Zeitpunkt rücken und wieder freigeben (nur, wenn noch unser Vermerk drinsteht). */
async function weiter(admin: Db, z: ErinnerungZeile, stempel: string, jetzt: number): Promise<void> {
  const naechster = naechsterZeitpunkt(z.faellig_um, z.wiederholung, jetzt)
  if (!naechster) return
  const { error } = await admin.from('erinnerungen').update({ faellig_um: naechster, gesendet_am: null }).eq('id', z.id).eq('gesendet_am', stempel)
  if (error) console.error('Erinnerung: Wiederholung nicht weitergerückt', z.id, error.message)
}
