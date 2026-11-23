// „Bitte bestätigen“ per Telegram-Knopf (Runde 6, 23.11.2026): Knöpfe unter den Vorschlägen, die email-gateway
// (bitteBestaetigen.ts: Termin/E-Mail/Datei → Akte; statusVorschlag.ts: Statuswechsel) schickt, und das
// Assistenten-Werkzeug vorschlaege_bestaetigen für dieselben Vorschläge (Liste, „Andere Akte“ mit Namen).
//
// Ausgeführt wird genau das, was die Bestätigung im Browser heute tut — mit denselben Funktionen und Rechten:
//  - termin       _shared/terminZuordnungKern.ts ordneVonHandZu (wie Aktion termin_zuordnen des Kalenders):
//                 Ja/Andere Akte = zuordnen, Ignorieren = Vorschlag ablehnen (kommt für diesen Termin nie wieder).
//  - mail         email-gateway mail_zuordnen im Auftrag des Mitarbeiters (Bereichsrecht wie im Browser), danach
//                 Vorschlag „uebernommen“; Ignorieren = Vorschlag „verworfen“ (wie src/lib/mailVorschlaege.ts).
//  - mail_privat  Werkzeug meine_post_vorschlaege (privatPostWerkzeug.ts) annehmen/verwerfen — Holding-Akte: Mail ins
//                 CRM übergeben (mail_freigeben) und zuordnen, eigener privater Kontakt: bleibt privat.
//  - eingang      email-gateway eingang_ablegen im Auftrag des Mitarbeiters (wie die Seite „Ungeklärte Eingänge“);
//                 Ignorieren = nur hier vermerkt (die Datei bleibt in der Liste, der Vorschlag kommt nicht wieder).
//  - status       Status der Akte setzen wie das CRM (Verlaufseintrag „Status: alt → neu am … durch …“), nur wenn der
//                 Status sich seit dem Vorschlag nicht geändert hat und der Mitarbeiter die Akte sehen darf.
//                 Nein = Vorschlag abgelehnt (für diese Akte frühestens nach 7 Tagen ein neuer).
//
// Sicherheit: Ein Knopf gilt nur im Chat des Empfängers und nur mit dem Code aus genau dieser Nachricht. Jede
// Entscheidung setzt den Vorschlag vorher bedingt auf „laeuft“ — zwei gleichzeitige Klicks führen nichts doppelt aus.
// Die Datei kennt index.ts nicht (kein Kreis-Import): Telegram, Mail-Funktion und Gesprächszustand kommen herein.

import {
  andereAkteFrage,
  erledigtText,
  istBestaetigenKnopf,
  leseKnopf,
  type StatusDaten,
  TABELLE,
  type VorschlagArt,
  type VorschlagZeile,
  type Wahl,
  zielText,
  type ZuordnungDaten,
} from '../_shared/bestaetigenKern.ts'
import { ordneVonHandZu, type ZuordnungVorschlag } from '../_shared/terminZuordnungKern.ts'
import { darfAkte, ohneNurPrivat, type RechteMitarbeiter } from './rechte.ts'
import { fuehrePrivatPostWerkzeugAus } from './privatPostWerkzeug.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export { istBestaetigenKnopf }

export type Mitarbeiter = RechteMitarbeiter & { id?: string; name: string }
// deno-lint-ignore no-explicit-any
export type MailFunktion = (action: string, body: Record<string, unknown>) => Promise<any>
export type TelegramApi = (methode: string, daten: Record<string, unknown>) => Promise<Record<string, unknown> | null>

export type EntscheidKontext = {
  supabase: Supa
  mitarbeiter: Mitarbeiter
  heute: string
  /** email-gateway mit Dienst-Schlüssel (index.ts: callEmailGateway); imAuftragVon setzt diese Datei. */
  mailFunktion: MailFunktion
  /** Zum Ändern der Telegram-Nachricht nach der Entscheidung (ohne: Nachricht bleibt, wie sie ist). */
  telegram?: TelegramApi
  protokolliere?: (text: string) => void
  jetzt?: Date
}

export type Entscheidung = { ok: boolean; text: string }

const ZEILE_SPALTEN = 'id, empfaenger_email, art, bezug_id, kunde_id, daten, code, status, ergebnis, telegram_nachricht, erstellt_am, erledigt_am'

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

/** Telegram-Aufruf mit einem Bot-Schlüssel (ohne Schlüssel: nur ins Protokoll). */
export function telegramMit(token: string | undefined): TelegramApi {
  return async (methode, daten) => {
    if (!token) {
      console.log(`[Telegram ${methode}] ${String(daten.text ?? '').slice(0, 200)}`)
      return null
    }
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${methode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten) })
      const j = await r.json().catch(() => null)
      if (!r.ok) console.error(`Telegram ${methode} fehlgeschlagen`, r.status, j?.description)
      return j?.result ?? null
    } catch (err) {
      console.error(`Telegram ${methode} fehlgeschlagen`, err)
      return null
    }
  }
}

async function ladeZeile(supabase: Supa, id: string): Promise<VorschlagZeile | null> {
  const { data } = await supabase.from(TABELLE).select(ZEILE_SPALTEN).eq('id', id).maybeSingle()
  return (data ?? null) as VorschlagZeile | null
}

/** Prüft Empfänger, Code und Stand. Liefert die Zeile oder eine Meldung. */
async function pruefeZeile(supabase: Supa, m: Mitarbeiter, id: string, code?: string): Promise<VorschlagZeile | string> {
  const z = await ladeZeile(supabase, id)
  if (!z || z.art === 'lauf' || adresse(z.empfaenger_email) !== adresse(m.email) || (code !== undefined && z.code !== code)) return 'Diesen Vorschlag gibt es nicht (mehr).'
  if (z.status === 'laeuft') return 'Dieser Vorschlag wird gerade schon bearbeitet.'
  if (z.status !== 'offen') return `Dieser Vorschlag ist schon erledigt${z.ergebnis ? `: ${z.ergebnis}` : '.'}`
  return z
}

type Ausgang = { status: 'erledigt' | 'ignoriert' | 'nein' | 'veraltet' | 'offen'; text: string }

function fehlerText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Entscheidet einen Vorschlag. wahl 'andere' braucht kundeId (bzw. bei Dateien objektId); ohne beides liefert sie
 * nur die Frage nach der Akte (nichts geändert). code nur beim Knopf (das Werkzeug kennt ihn nicht).
 */
export async function entscheideVorschlag(
  k: EntscheidKontext,
  id: string,
  wahl: Wahl,
  o: { code?: string; kundeId?: string; objektId?: string; ordner?: string } = {},
): Promise<Entscheidung> {
  const { supabase, mitarbeiter: m } = k
  const jetzt = k.jetzt ?? new Date()
  const geprueft = await pruefeZeile(supabase, m, id, o.code)
  if (typeof geprueft === 'string') return { ok: false, text: geprueft }
  const z = geprueft
  if (z.art === 'status' && (wahl === 'andere' || wahl === 'ignorieren')) return { ok: false, text: 'Bei einem Statusvorschlag geht nur Ja oder Nein.' }
  if (z.art !== 'status' && wahl === 'nein') wahl = 'ignorieren'
  if (wahl === 'andere' && !o.kundeId && !o.objektId) return { ok: true, text: andereAkteFrage(z.art as VorschlagArt, z.daten as ZuordnungDaten) }
  if (wahl === 'andere' && o.objektId && z.art !== 'eingang') return { ok: false, text: 'Ein Objekt als Ziel geht nur bei Dateien aus „Ungeklärte Eingänge“.' }

  // Beanspruchen: nur wer „offen“ → „laeuft“ setzt, entscheidet.
  const { data: beansprucht } = await supabase.from(TABELLE).update({ status: 'laeuft' }).eq('id', z.id).eq('status', 'offen').select('id')
  if (!Array.isArray(beansprucht) || beansprucht.length === 0) return { ok: false, text: 'Dieser Vorschlag ist schon erledigt.' }

  let a: Ausgang
  try {
    a = await fuehreAus(k, z, wahl, o, jetzt)
  } catch (err) {
    a = { status: 'offen', text: `Das hat nicht geklappt: ${fehlerText(err)}` }
  }
  await supabase
    .from(TABELLE)
    .update({ status: a.status, ergebnis: a.text.slice(0, 500), erledigt_am: a.status === 'offen' ? null : jetzt.toISOString() })
    .eq('id', z.id)
  if (a.status !== 'offen') {
    k.protokolliere?.(`Vorschlag ${z.id} (${z.art}): ${a.text}`)
    const t = z.telegram_nachricht
    if (k.telegram && t?.chat && t.id) await k.telegram('editMessageText', { chat_id: t.chat, message_id: t.id, text: erledigtText(z.art as VorschlagArt, z.daten, `${a.status === 'erledigt' ? '✅ ' : ''}${a.text}`) })
  }
  // veraltet (schon erledigt, kein Recht, geändert) und offen (Fehler) zählen nicht als erledigt.
  return { ok: a.status === 'erledigt' || a.status === 'ignoriert' || a.status === 'nein', text: a.text }
}

async function fuehreAus(k: EntscheidKontext, z: VorschlagZeile, wahl: Wahl, o: { kundeId?: string; objektId?: string; ordner?: string }, jetzt: Date): Promise<Ausgang> {
  const { supabase, mitarbeiter: m } = k
  const ich = adresse(m.email)
  const zielKunde = wahl === 'andere' ? String(o.kundeId ?? '').trim() : String(z.kunde_id ?? '')

  if (z.art === 'termin') {
    const { data: t } = await supabase.from('termine').select('id, titel, kunde_id, kunde_name, zuordnung_vorschlag').eq('id', z.bezug_id).maybeSingle()
    if (!t) return { status: 'veraltet', text: 'Diesen Termin gibt es nicht mehr.' }
    const v = (t.zuordnung_vorschlag ?? {}) as ZuordnungVorschlag
    const offenerVorschlag = v.stand === 'vorschlag' && String(v.kunde_id ?? '') === String(z.kunde_id ?? '')
    if (wahl !== 'andere' && (t.kunde_id || !offenerVorschlag)) return { status: 'veraltet', text: t.kunde_id ? `Der Termin gehört inzwischen schon zur Akte ${t.kunde_name ?? t.kunde_id}.` : 'Der Vorschlag ist inzwischen nicht mehr aktuell.' }
    const person = { email: ich, name: m.name, rolle: m.rolle ?? null, ist_admin: m.ist_admin === true, bereiche: m.bereiche ?? [] }
    const r = wahl === 'ignorieren'
      ? await ordneVonHandZu(supabase, person, { terminId: z.bezug_id, kundeId: null, vorschlagAblehnen: true }, jetzt)
      : await ordneVonHandZu(supabase, person, { terminId: z.bezug_id, kundeId: zielKunde }, jetzt)
    if (!r.ok) return { status: r.status === 403 ? 'veraltet' : 'offen', text: r.fehler }
    return { status: wahl === 'ignorieren' ? 'ignoriert' : 'erledigt', text: r.text }
  }

  if (z.art === 'mail') {
    const { data: mail } = await supabase.from('eingegangene_emails').select('id, betreff, zugewiesener_kunde_id, zugewiesener_kunde_name, zuordnung_vorschlag').eq('id', z.bezug_id).is('besitzer_email', null).maybeSingle()
    if (!mail) return { status: 'veraltet', text: 'Diese Mail liegt nicht mehr im gemeinsamen Postfach.' }
    if (mail.zugewiesener_kunde_id) return { status: 'veraltet', text: `Die Mail ist schon der Akte ${mail.zugewiesener_kunde_name ?? mail.zugewiesener_kunde_id} zugeordnet.` }
    const bisher = (mail.zuordnung_vorschlag && typeof mail.zuordnung_vorschlag === 'object' ? mail.zuordnung_vorschlag : {}) as Record<string, unknown>
    const stand = (status: string) => supabase.from('eingegangene_emails').update({ zuordnung_vorschlag: { ...bisher, status, erledigt_am: jetzt.toISOString(), erledigt_von: m.name } }).eq('id', mail.id).is('besitzer_email', null)
    if (wahl === 'ignorieren') {
      await stand('verworfen')
      return { status: 'ignoriert', text: `Vorschlag verworfen. Die Mail „${mail.betreff ?? '(ohne Betreff)'}“ bleibt im gemeinsamen Postfach.` }
    }
    const r = await k.mailFunktion('mail_zuordnen', { mailId: mail.id, kundeId: zielKunde, imAuftragVon: ich })
    await stand('uebernommen')
    const abgelegt = Number(r?.abgelegt ?? 0)
    return { status: 'erledigt', text: `„${r?.betreff ?? mail.betreff ?? 'Mail'}“ liegt jetzt bei ${r?.kundeName ?? zielKunde}.${abgelegt > 0 ? ` ${abgelegt === 1 ? '1 Anhang liegt' : `${abgelegt} Anhänge liegen`} in den Dokumenten der Akte.` : ''}` }
  }

  if (z.art === 'mail_privat') {
    const protokoll: string[] = []
    const antwort = await fuehrePrivatPostWerkzeugAus(
      'meine_post_vorschlaege',
      wahl === 'ignorieren' ? { aktion: 'verwerfen', mail_id: z.bezug_id } : { aktion: 'annehmen', mail_id: z.bezug_id, kunde_id: zielKunde },
      { supabase, mitarbeiter: ohneNurPrivat(m), protokolliere: (t) => protokoll.push(t), heute: k.heute, mailFunktion: k.mailFunktion },
    )
    const text = antwort.replace(/^(Erledigt|Fehler):\s*/, '')
    if (antwort.startsWith('Erledigt')) return { status: wahl === 'ignorieren' ? 'ignoriert' : 'erledigt', text }
    if (/schon bei einer Akte|nicht im privaten Postfach|inzwischen geändert/.test(antwort)) return { status: 'veraltet', text }
    // Übergeben ja, Zuordnen nein: nicht wiederholen (die Mail ist schon im gemeinsamen Postfach).
    if (/ins gemeinsame Postfach übergeben/.test(antwort)) return { status: 'erledigt', text }
    return { status: 'offen', text }
  }

  if (z.art === 'eingang') {
    if (wahl === 'ignorieren') return { status: 'ignoriert', text: 'Ignoriert. Die Datei bleibt unter „Ungeklärte Eingänge“; dieser Vorschlag kommt nicht wieder.' }
    const d = z.daten as ZuordnungDaten
    const ziel: { art: string; id: string; ordner?: string } = wahl === 'andere'
      ? (o.objektId ? { art: 'objekt', id: String(o.objektId), ordner: String(o.ordner ?? '').trim() || 'Sonstiges' } : { art: 'kunde', id: zielKunde })
      : (d.ziel.art === 'objekt' ? { art: 'objekt', id: d.ziel.id, ordner: d.ziel.ordner || 'Sonstiges' } : { art: 'kunde', id: d.ziel.id })
    const r = await k.mailFunktion('eingang_ablegen', { dokumentIds: [z.bezug_id], ziel, imAuftragVon: ich })
    const abgelegt = Array.isArray(r?.abgelegt) ? r.abgelegt.length : 0
    const schonDa = Array.isArray(r?.uebersprungen) ? r.uebersprungen.length : 0
    const name = r?.ziel?.name ?? (wahl === 'andere' ? ziel.id : d.ziel.name)
    if (abgelegt + schonDa > 0) return { status: 'erledigt', text: `„${d.titel}“ liegt jetzt bei ${name}${ziel.art === 'objekt' ? ` (Ordner ${ziel.ordner})` : ''}.` }
    const grund = Array.isArray(r?.nichtAbgelegt) && r.nichtAbgelegt.length ? String(r.nichtAbgelegt[0]) : 'Die Datei liegt nicht mehr unter „Ungeklärte Eingänge“.'
    return { status: 'veraltet', text: grund }
  }

  if (z.art === 'status') {
    const d = z.daten as StatusDaten
    if (wahl === 'nein') return { status: 'nein', text: 'Kein Statuswechsel. Für diese Akte frage ich frühestens in 7 Tagen wieder.' }
    const { data: akte } = await supabase.from('kunden').select('id, bereich, status, verantwortlich_email, activities').eq('id', z.kunde_id).maybeSingle()
    if (!akte) return { status: 'veraltet', text: 'Diese Akte gibt es nicht mehr.' }
    if (!darfAkte(ohneNurPrivat(m), akte)) return { status: 'veraltet', text: 'Diese Akte darfst du nicht ändern.' }
    if (String(akte.status ?? '') !== d.von) return { status: 'veraltet', text: 'Der Status wurde inzwischen schon geändert — nichts gemacht.' }
    const eintrag = { id: crypto.randomUUID(), date: k.heute, text: `Status: ${d.vonName} → ${d.nachName} am ${k.heute} durch ${m.name} (per Telegram bestätigt)`, user: m.name }
    const { data: geaendert, error } = await supabase
      .from('kunden')
      .update({ status: d.nach, activities: [eintrag, ...(Array.isArray(akte.activities) ? akte.activities : [])], letzte_aktivitaet: k.heute })
      .eq('id', akte.id)
      .eq('status', d.von)
      .select('id')
    if (error) return { status: 'offen', text: `Nicht gespeichert: ${error.message}` }
    if (!Array.isArray(geaendert) || geaendert.length === 0) return { status: 'veraltet', text: 'Der Status wurde inzwischen schon geändert — nichts gemacht.' }
    return { status: 'erledigt', text: `Status von „${d.name}“ steht jetzt auf „${d.nachName}“.` }
  }
  return { status: 'veraltet', text: 'Unbekannte Art von Vorschlag.' }
}

// ---------------------------------------------------------------------------------------------
// Knopf

/** Gesprächszustand (wie MitteilungsWege in teamWerkzeuge.ts). */
export type Wege = {
  // deno-lint-ignore no-explicit-any
  ladeState: (raw: unknown) => any
  // deno-lint-ignore no-explicit-any
  speichereZustand: (supabase: Supa, mitarbeiterId: string, state: any) => Promise<unknown>
}

export type KnopfKontext = {
  supabase: Supa
  // deno-lint-ignore no-explicit-any
  knopf: any
  antworte: (text: string) => Promise<unknown>
  telegram: TelegramApi
  mailFunktion: MailFunktion
  wege: Wege
  heute: string
  jetzt?: Date
}

/** Knopf „bt:…“ unter einem Vorschlag. Wirft nie. */
export async function verarbeiteBestaetigenKnopf(k: KnopfKontext): Promise<void> {
  try {
    const kn = leseKnopf(k.knopf?.data)
    const chatId = k.knopf?.message?.chat?.id
    if (!kn || !chatId) return void (await k.antworte('Unbekannter Knopf.'))
    const { data: m } = await k.supabase.from('mitarbeiter').select('id, name, email, rolle, ist_admin, bereiche, aktiv, telegram_pending').eq('telegram_chat_id', chatId).maybeSingle()
    if (!m?.aktiv) return void (await k.antworte('Dieser Chat ist mit keinem CRM-Zugang verbunden.'))
    const mitarbeiter: Mitarbeiter = { id: m.id, name: m.name, email: adresse(m.email), rolle: m.rolle, ist_admin: m.ist_admin, bereiche: m.bereiche ?? [] }

    if (kn.wahl === 'andere') {
      const z = await pruefeZeile(k.supabase, mitarbeiter, kn.id, kn.code)
      if (typeof z === 'string') return void (await k.antworte(z))
      const d = z.daten as ZuordnungDaten
      const frage = andereAkteFrage(z.art as VorschlagArt, d)
      const uebergabe = z.art === 'mail_privat'
        ? ' Es ist eine Mail aus seinem persönlichen Postfach: Wählt er eine Akte der Holding, wird sie dabei ins CRM übergeben (die Kollegen des Bereichs sehen sie dann) — sag ihm das, bevor du zuordnest; bei einem eigenen privaten Kontakt bleibt sie privat.'
        : ''
      const systemmeldung =
        `[Systemmeldung, nicht vom Mitarbeiter getippt] Der Mitarbeiter hat beim „Bitte bestätigen“-Vorschlag ${z.id} (${z.art}: „${d.titel}“, vorgeschlagen war ${zielText(d.ziel)}) auf „Andere Akte“ getippt. ` +
        `Nennt er jetzt einen Namen, ermittle die Akte mit kunden_suchen${z.art === 'eingang' ? ' (oder ein Objekt mit objekte_suchen)' : ''} und ordne mit vorschlaege_bestaetigen zu (aktion=andere_akte, vorschlag_id=${z.id}, kunde_id${z.art === 'eingang' ? ' bzw. objekt_id' : ''}). Ist der Name nicht eindeutig, frag nach.${uebergabe} Nenne die Kennung nicht.`
      await k.telegram('sendMessage', { chat_id: chatId, text: frage })
      const state = k.wege.ladeState(m.telegram_pending)
      state.zuege.push({ z: (k.jetzt ?? new Date()).toISOString(), msgs: [{ role: 'user', content: systemmeldung }, { role: 'assistant', content: frage }] })
      await k.wege.speichereZustand(k.supabase, String(m.id), state)
      return void (await k.antworte('Schreib mir den Namen der Akte.'))
    }

    const r = await entscheideVorschlag(
      { supabase: k.supabase, mitarbeiter, heute: k.heute, mailFunktion: k.mailFunktion, telegram: k.telegram, jetzt: k.jetzt },
      kn.id,
      kn.wahl,
      { code: kn.code },
    )
    await k.antworte(r.text)
    // Längere Fehlermeldungen passen nicht in die kurze Antwort am Knopf.
    if (!r.ok && r.text.length > 180) await k.telegram('sendMessage', { chat_id: chatId, text: r.text })
  } catch (err) {
    console.error('Bitte-bestätigen-Knopf fehlgeschlagen:', err)
    await k.antworte('Das hat nicht geklappt.').catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------
// Werkzeug

export const BESTAETIGEN_WERKZEUGE = [
  {
    name: 'vorschlaege_bestaetigen',
    description:
      'Die „Bitte bestätigen“-Vorschläge, die das CRM dem Mitarbeiter, mit dem du sprichst, per Telegram mit Knöpfen geschickt hat: Termin, E-Mail oder Datei aus „Ungeklärte Eingänge“ → Akte, und Statuswechsel einer Akte. ' +
      'aktion=liste zeigt seine offenen Vorschläge mit vorschlag_id. aktion=ja übernimmt den Vorschlag wie vorgeschlagen. aktion=andere_akte ordnet stattdessen der genannten Akte zu (kunde_id vorher mit kunden_suchen ermitteln; bei einer Datei geht auch objekt_id mit optionalem ordner). aktion=ignorieren verwirft einen Zuordnungsvorschlag, aktion=nein lehnt einen Statuswechsel ab. ' +
      'Nach „Andere Akte“ am Knopf schreibt der Mitarbeiter meist nur einen Namen — such dann die Akte und ordne mit aktion=andere_akte zu. Bei einer E-Mail aus seinem persönlichen Postfach wird sie mit einer Akte der Holding dabei ins CRM übergeben (die Kollegen des Bereichs sehen sie dann) — vorher kurz nachfragen.',
    input_schema: {
      type: 'object',
      properties: {
        aktion: { type: 'string', enum: ['liste', 'ja', 'andere_akte', 'ignorieren', 'nein'] },
        vorschlag_id: { type: 'string', description: 'Kennung des Vorschlags (aus aktion=liste oder dem Gesprächsverlauf).' },
        kunde_id: { type: 'string', description: 'Bei andere_akte: die richtige Akte.' },
        objekt_id: { type: 'string', description: 'Bei andere_akte und einer Datei: stattdessen dieses Objekt.' },
        ordner: { type: 'string', description: 'Bei objekt_id optional: Ordner der Objektakte (sonst Sonstiges).' },
      },
      required: ['aktion'],
    },
  },
]

export function istBestaetigenWerkzeug(name: string): boolean {
  return BESTAETIGEN_WERKZEUGE.some((w) => w.name === name)
}

// deno-lint-ignore no-explicit-any
export async function fuehreBestaetigenWerkzeugAus(name: string, input: any, k: EntscheidKontext): Promise<string> {
  if (name !== 'vorschlaege_bestaetigen') return `Fehler: Unbekanntes Werkzeug ${name}.`
  if (k.mitarbeiter.nurPrivat === true) return 'Fehler: Diese Vorschläge gibt es nur im Mayer-Assistenten.'
  const ich = adresse(k.mitarbeiter.email)
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  const aktion = String(input?.aktion ?? 'liste')
  if (aktion === 'liste') {
    const seit = new Date((k.jetzt ?? new Date()).getTime() - 14 * 86_400_000).toISOString()
    const { data, error } = await k.supabase.from(TABELLE).select(ZEILE_SPALTEN).eq('empfaenger_email', ich).eq('status', 'offen').gte('erstellt_am', seit).order('erstellt_am', { ascending: false }).limit(50)
    if (error) return `Fehler beim Lesen: ${error.message}`
    const zeilen = ((data ?? []) as VorschlagZeile[]).filter((z) => z.art !== 'lauf')
    if (zeilen.length === 0) return 'Keine offenen Vorschläge.'
    return JSON.stringify({
      offen: zeilen.length,
      vorschlaege: zeilen.map((z) => {
        if (z.art === 'status') {
          const d = z.daten as StatusDaten
          return { vorschlag_id: z.id, art: 'Statuswechsel', akte: d.name, kunde_id: z.kunde_id, jetzt: d.vonName, vorschlag: d.nachName, anlass: d.anlass }
        }
        const d = z.daten as ZuordnungDaten
        return { vorschlag_id: z.id, art: z.art, was: d.titel, von: d.von ?? undefined, vorschlag: zielText(d.ziel), grund: d.grund }
      }),
    })
  }
  const id = String(input?.vorschlag_id ?? '').trim()
  if (!id) return 'Fehler: vorschlag_id fehlt. Hol sie mit aktion=liste.'
  const wahl: Wahl | null = aktion === 'ja' ? 'ja' : aktion === 'andere_akte' ? 'andere' : aktion === 'ignorieren' ? 'ignorieren' : aktion === 'nein' ? 'nein' : null
  if (!wahl) return 'Fehler: aktion muss liste, ja, andere_akte, ignorieren oder nein sein.'
  if (wahl === 'andere' && !input?.kunde_id && !input?.objekt_id) return 'Fehler: Bei andere_akte bitte kunde_id (oder bei einer Datei objekt_id) angeben — ermittle sie mit kunden_suchen.'
  const r = await entscheideVorschlag(k, id, wahl, { kundeId: input?.kunde_id ? String(input.kunde_id) : undefined, objektId: input?.objekt_id ? String(input.objekt_id) : undefined, ordner: input?.ordner ? String(input.ordner) : undefined })
  return r.ok ? `Erledigt: ${r.text}` : `Fehler: ${r.text}`
}
