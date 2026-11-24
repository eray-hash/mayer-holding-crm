// Gesprächs-App „Mayer Gespräch“: eine Aufnahme auf mehrere Akten verteilen (24.11.2026). Zwei Aktionen im
// email-gateway (registriert in index.ts wie gespraech_uebernehmen; App: src/gespraech/auswertung/Verteilen.tsx,
// Telegram: telegram-gateway/aufnahmeVerteilen.ts):
//
// - gespraech_verteilen_vorschlag {id, neu?, telegram?}: Die KI (Sonnet wie gespraechPipeline.ts, Verbrauch über
//   kiAufruf) zerlegt die Abschrift in Abschnitte je Kunde bzw. Vorgang (Stand, bezahlt, erwartet, Chance,
//   Wiedervorlagen, To-dos, offene Fragen) und gleicht sie mit den Akten ab (_shared/gespraechVerteilenKern.ts).
//   Das Ergebnis steht in gespraech_aufnahmen.verteilung. Die Berechnung läuft im Hintergrund weiter; die Anfrage
//   wartet bis zu wartenMs darauf, sonst kommt status 'laeuft' (die App fragt erneut; über Telegram kommt am Ende
//   eine kurze Nachricht). Ohne neu=true liefert ein zweiter Aufruf den gespeicherten Vorschlag — Treffer und
//   Vorschläge werden dabei jedes Mal frisch gegen die Akten gerechnet (neue Akten, schon verteilte Teile).
// - gespraech_verteilen {id, auswahl: {abschnitte: [{nr, ziel: {kundeId} | {neu: {bereich, firma?, ansprechpartner?}}
//   | {ueberspringen: true}, …Änderungen}]}}: legt je Akte an: ggf. die Akte, das Gesprächsprotokoll (nur der Teil zu
//   diesem Kunden), einen Verlaufseintrag, Wiedervorlagen, To-dos, die Chance (bestätigte nie überschreiben → dann
//   chance_vorschlag) und den Vermittler (nur wenn leer). Wiederholbar ohne Doppelte (siehe Kern).
//
// Rechte: nur der Besitzer der Aufnahme; je Akte darfKunde, für neue Akten darfBereich (privat: eigene).

import type { Aufrufer } from './postfach.ts'
import { kiAufruf } from '../_shared/kiVerbrauch.ts'
import { kiFehlerText } from '../_shared/kiFehler.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { startStatusFuer } from '../_shared/startStatus.ts'
import { ladeLinkBasis } from '../_shared/terminBriefingKern.ts'
import { todoAnlegen } from '../telegram-gateway/teamWerkzeuge.ts'
import {
  akteLinkVerteilen,
  akteName,
  aktenFuerAbgleich,
  BEREICH_NAME,
  chanceFuer,
  deDatum,
  findeTreffer,
  istDatum,
  LAEUFT_HOECHSTENS_MS,
  leseVerteilung,
  NEUANLAGE_BEREICHE,
  neueAkteId,
  normalisiereAbschnitte,
  protokollIdFuer,
  protokollText,
  SAMMELAKTEN_VERTEILEN,
  teamMitgliedZu,
  todoSchluessel,
  type VerteilAbschnitt,
  type VerteilAkte,
  type VerteilErgebnis,
  type Verteilung,
  type VerteilTreffer,
  type VerteilVorschlag,
  verlaufText,
  verteilPrompt,
  verteilSystem,
  verteilWerkzeug,
  vorschlagFuer,
  wirksamerAbschnitt,
  wvSchluessel,
} from '../_shared/gespraechVerteilenKern.ts'

// deno-lint-ignore no-explicit-any
type Db = any

const MODELL = 'claude-sonnet-5-5'
const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export type VerteilKi = (a: { system: string; prompt: string; werkzeug: { name: string; description: string; input_schema: Record<string, unknown> }; maxTokens: number; timeoutMs: number }) => Promise<Record<string, unknown>>

export type VerteilKontext = {
  admin: Db
  aufrufer: Aufrufer
  /** Heute (Berlin) als JJJJ-MM-TT. */
  heute: string
  darfKunde: (kundeId: string) => Promise<boolean>
  darfBereich: (bereich: string) => Promise<boolean>
  linkBasis?: string
  /** Tests: KI ersetzen. */
  ki?: VerteilKi
  /** Arbeit nach der Antwort weiterlaufen lassen (EdgeRuntime.waitUntil). */
  imHintergrund?: (arbeit: Promise<unknown>) => void
  /** So lange wartet der Vorschlag auf die KI, bevor er 'laeuft' meldet (Vorgabe 140 s, höchstens Restlaufzeit − 30 s). */
  wartenMs?: number
  /** Garantierte Restlaufzeit dieses Workers in ms (begrenzt Warten und KI-Zeit). */
  restMs?: () => number
  sendeTelegram?: (chat: number | string | null, text: string) => Promise<boolean>
  jetzt?: () => number
}

export type VerteilAntwort = { status: number; daten: Record<string, unknown> }

type Aufnahme = {
  id: string
  mitarbeiter_email: string
  kunde_id: string | null
  titel: string | null
  art: string
  status: string
  notizen: string | null
  transkript: string | null
  sprecher: { label?: string; name?: string; text?: string }[] | null
  verteilung: unknown
  erstellt_am: string
}

const SPALTEN = 'id, mitarbeiter_email, kunde_id, titel, art, status, notizen, transkript, sprecher, verteilung, erstellt_am'

function adresse(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

function fehler(status: number, meldung: string): VerteilAntwort {
  return { status, daten: { error: meldung } }
}

const BERLIN_TAG = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })

function berlinTag(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ''))
  return Number.isNaN(d.getTime()) ? '' : BERLIN_TAG.format(d)
}

function jetztMs(k: VerteilKontext): number {
  return k.jetzt ? k.jetzt() : Date.now()
}

async function ladeAufnahme(k: VerteilKontext, id: unknown): Promise<Aufnahme | VerteilAntwort> {
  const kennung = String(id ?? '').trim()
  if (!kennung) return fehler(400, 'id fehlt.')
  const { data, error } = await k.admin.from('gespraech_aufnahmen').select(SPALTEN).eq('id', kennung).maybeSingle()
  if (error) return fehler(500, `Die Aufnahme ließ sich nicht laden: ${error.message}`)
  if (!data || adresse(data.mitarbeiter_email) !== adresse(k.aufrufer.email)) return fehler(404, 'Diese Aufnahme gibt es nicht (mehr).')
  return data as Aufnahme
}

function istAntwort(x: unknown): x is VerteilAntwort {
  return !!x && typeof x === 'object' && 'daten' in x
}

/** Abschrift mit Zeitmarken aus den Absätzen der Sprecher-Zuordnung, sonst die Spalte transkript. */
function abschriftVon(z: Aufnahme): string {
  const absaetze = Array.isArray(z.sprecher) ? z.sprecher.filter((a) => String(a?.text ?? '').trim()) : []
  const text = absaetze.length ? absaetze.map((a) => `${a.name || a.label || 'Sprecher'}: ${String(a.text).trim()}`).join('\n') : String(z.transkript ?? '').trim()
  return text.length > 300_000 ? `${text.slice(0, 200_000)}\n[… Mitte gekürzt …]\n${text.slice(-100_000)}` : text
}

type Ich = { id: string; name: string; email: string; rolle: string | null; ist_admin: boolean | null; bereiche: string[] | null; telegram_chat_id: number | string | null }

async function ladeIch(k: VerteilKontext): Promise<Ich | null> {
  const { data } = await k.admin.from('mitarbeiter').select('id, name, email, rolle, ist_admin, bereiche, telegram_chat_id, aktiv').eq('aktiv', true)
  return (((data ?? []) as Ich[]).find((m) => adresse(m.email) === adresse(k.aufrufer.email)) ?? null)
}

function sichtbarFuer(ich: Ich | null): (bereich: string) => boolean {
  return (bereich: string) => {
    if (!ich) return false
    if (ich.rolle === 'geschaeftsfuehrung' || ich.ist_admin) return true
    const kennung = bereich === 'immobilienkunden' ? 'immobilien' : bereich
    return Array.isArray(ich.bereiche) && ich.bereiche.includes(kennung)
  }
}

async function ladeAkten(k: VerteilKontext, ich: Ich | null): Promise<VerteilAkte[]> {
  const { data, error } = await alleZeilen(() => k.admin.from('kunden').select('id, bereich, firma, ansprechpartner, email, verantwortlich_email'))
  if (error) throw new Error(`Die Akten ließen sich nicht lesen: ${error.message}`)
  return aktenFuerAbgleich((data ?? []) as VerteilAkte[], k.aufrufer.email, sichtbarFuer(ich))
}

/** KI wie gespraechPipeline.ts (Sonnet 5.5, Werkzeug, tool_choice auto), Fehler über kiFehlerText. */
const sonnet: VerteilKi = async (a) => {
  const schluessel = Deno.env.get('ANTHROPIC_API_KEY')
  if (!schluessel) throw new Error('Die KI ist nicht eingerichtet (kein Schlüssel hinterlegt).')
  const res = await kiAufruf('email-gateway', 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': schluessel, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    signal: AbortSignal.timeout(a.timeoutMs),
    body: JSON.stringify({
      model: MODELL,
      max_tokens: a.maxTokens,
      thinking: { type: 'between_tools' },
      system: a.system,
      tools: [a.werkzeug],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: a.prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(kiFehlerText(detail, `Der KI-Dienst antwortet mit ${res.status}: ${detail.slice(0, 200)}`))
  }
  const data = await res.json()
  // deno-lint-ignore no-explicit-any
  const t = (data.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === a.werkzeug.name)
  if (!t) throw new Error(data.stop_reason === 'max_tokens' ? 'Die Antwort der KI war zu lang.' : 'Die KI hat keine verwertbare Antwort geliefert.')
  return t.input as Record<string, unknown>
}

/** Verteilung frisch lesen und mit `aendern` neu schreiben (Ergebnisse anderer Aufrufe bleiben erhalten). */
async function speichereVerteilung(k: VerteilKontext, id: string, aendern: (v: Verteilung | null) => Verteilung): Promise<Verteilung> {
  const { data } = await k.admin.from('gespraech_aufnahmen').select('verteilung').eq('id', id).maybeSingle()
  const neu = aendern(leseVerteilung(data?.verteilung))
  const { error } = await k.admin.from('gespraech_aufnahmen').update({ verteilung: neu, geaendert_am: new Date(jetztMs(k)).toISOString() }).eq('id', id)
  if (error) throw new Error(`Die Verteilung ließ sich nicht speichern: ${error.message}`)
  return neu
}

// ---------------------------------------------------------------------------------------------
// Vorschlag

/** KI-Lauf: Abschnitte berechnen und speichern. Wirft nie (Fehler landen in verteilung.fehler). */
async function berechne(k: VerteilKontext, z: Aufnahme, ich: Ich | null): Promise<Verteilung> {
  const seit = new Date(jetztMs(k)).toISOString()
  try {
    const akten = await ladeAkten(k, ich)
    const { data: teamRoh } = await k.admin.from('mitarbeiter').select('name').eq('aktiv', true)
    const tag = berlinTag(z.erstellt_am) || k.heute
    const prompt = verteilPrompt({
      tag,
      wochentag: WOCHENTAGE[new Date(`${tag}T12:00:00Z`).getUTCDay()],
      titel: z.titel,
      sprecher: ich?.name || k.aufrufer.name,
      team: ((teamRoh ?? []) as { name: string }[]).map((m) => String(m.name ?? '')).filter(Boolean),
      akten,
      abschrift: abschriftVon(z),
      notizen: z.notizen,
    })
    const roh = await (k.ki ?? sonnet)({ system: verteilSystem(), prompt, werkzeug: verteilWerkzeug(), maxTokens: 32000, timeoutMs: Math.max(60_000, Math.min(330_000, (k.restMs?.() ?? 345_000) - 15_000)) })
    const { abschnitte, hinweis } = normalisiereAbschnitte(roh, new Set(akten.map((a) => a.id)))
    return await speichereVerteilung(k, z.id, (alt) => ({
      version: 1,
      status: 'fertig',
      erstellt_am: new Date(jetztMs(k)).toISOString(),
      von: k.aufrufer.name,
      ...(abschnitte.length === 0 ? { hinweis: hinweis || 'In der Aufnahme waren keine einzelnen Kunden oder Vorgänge zu erkennen.' } : hinweis ? { hinweis } : {}),
      abschnitte,
      ergebnisse: alt?.ergebnisse ?? {},
    }))
  } catch (err) {
    const meldung = err instanceof Error ? err.message : String(err)
    console.error(`Verteilen ${z.id}: Vorschlag fehlgeschlagen:`, meldung)
    try {
      return await speichereVerteilung(k, z.id, (alt) => ({ version: 1, status: 'fehler', seit, fehler: `Der Vorschlag ließ sich nicht erstellen: ${meldung}`, abschnitte: alt?.abschnitte ?? [], ergebnisse: alt?.ergebnisse ?? {} }))
    } catch {
      return { version: 1, status: 'fehler', fehler: meldung, abschnitte: [], ergebnisse: {} }
    }
  }
}

export type AbschnittAnsicht = VerteilAbschnitt & {
  treffer: VerteilTreffer[]
  vorschlag: VerteilVorschlag
  erledigt?: { kundeId: string; name: string; link: string; extern?: boolean }
}

/** Was App und Telegram zeigen: Abschnitte mit frisch gerechneten Treffern, Vorschlag und Stand der Verteilung. */
export async function verteilAnsicht(k: VerteilKontext, z: Aufnahme, v: Verteilung, ich: Ich | null): Promise<Record<string, unknown>> {
  const sichtbar = sichtbarFuer(ich)
  const erlaubt = [...NEUANLAGE_BEREICHE.filter(sichtbar), 'privat']
  const basis = k.linkBasis ?? (await ladeLinkBasis(k.admin))
  if (v.status !== 'fertig') {
    return { ok: true, status: v.status, fehler: v.fehler ?? null, abschnitte: [], bereiche: erlaubt, ergebnisse: Object.values(v.ergebnisse) }
  }
  const akten = await ladeAkten(k, ich)
  const nachId = new Map(akten.map((a) => [a.id, a]))
  const liste = v.abschnitte.map((ab) => {
    const treffer = findeTreffer(ab, akten)
    return { ab, treffer, vorschlag: vorschlagFuer(ab, treffer, erlaubt) }
  })
  // Schon verteilt? Eigene Ergebnisse, sonst ein Protokoll mit der festen Kennung (z. B. per Skript angelegt).
  const kandidaten = [...new Set([...liste.flatMap((x) => x.treffer.map((t) => t.id)), ...Object.keys(v.ergebnisse)])]
  const mitProtokoll = new Set<string>()
  for (let i = 0; i < kandidaten.length; i += 100) {
    const teil = kandidaten.slice(i, i + 100)
    const { data } = await k.admin.from('protokolle').select('id, kunde_id').in('id', teil.map((kid) => protokollIdFuer(z.id, kid)))
    for (const p of (data ?? []) as { kunde_id: string }[]) mitProtokoll.add(String(p.kunde_id))
  }
  const link = (bereich: string, id: string) => akteLinkVerteilen(basis, bereich, id)
  const abschnitte: AbschnittAnsicht[] = liste.map(({ ab, treffer, vorschlag }) => {
    const eigenes = Object.values(v.ergebnisse).find((e) => !e.extern && e.nrs?.includes(ab.nr))
    let erledigt: AbschnittAnsicht['erledigt']
    if (eigenes) erledigt = { kundeId: eigenes.kundeId, name: eigenes.name, link: link(eigenes.bereich, eigenes.kundeId) }
    else {
      const ziel = vorschlag.art === 'akte' ? vorschlag.kundeId : ''
      const fremd = ziel && mitProtokoll.has(ziel) ? ziel : ''
      if (fremd) {
        const a = nachId.get(fremd)
        erledigt = { kundeId: fremd, name: a ? akteName(a) : fremd, link: link(a?.bereich ?? 'beratung', fremd), extern: true }
      }
    }
    return { ...ab, treffer, vorschlag, ...(erledigt ? { erledigt } : {}) }
  })
  return {
    ok: true,
    status: 'fertig',
    erstellt_am: v.erstellt_am ?? null,
    hinweis: v.hinweis ?? null,
    abschnitte,
    bereiche: erlaubt,
    ergebnisse: Object.values(v.ergebnisse).map((e) => ({ ...e, link: link(e.bereich, e.kundeId) })),
  }
}

/** Kurze Telegram-Nachricht, wenn der Vorschlag erst nach dem Warten fertig wurde. */
function fertigNachricht(v: Verteilung, titel: string): string {
  if (v.status !== 'fertig') return `🎙️ Der Vorschlag zum Verteilen der Aufnahme${titel} ist leider nicht gelungen: ${v.fehler ?? 'unbekannter Fehler'}`
  const namen = v.abschnitte.slice(0, 8).map((a) => a.name).join(', ')
  return `🎙️ Der Vorschlag zum Verteilen der Aufnahme${titel} ist fertig: ${v.abschnitte.length} Kunden bzw. Vorgänge (${namen}${v.abschnitte.length > 8 ? ' …' : ''}). Schreib mir „Verteile meine letzte Aufnahme“, dann gehen wir ihn durch.`
}

// deno-lint-ignore no-explicit-any
export async function gespraechVerteilenVorschlag(k: VerteilKontext, body: any): Promise<VerteilAntwort> {
  const z = await ladeAufnahme(k, body?.id)
  if (istAntwort(z)) return z
  if (z.status !== 'fertig') return fehler(409, 'Die Aufnahme ist noch nicht fertig ausgewertet.')
  if (!abschriftVon(z)) return fehler(409, 'Zu dieser Aufnahme gibt es keine Abschrift.')
  const ich = await ladeIch(k)
  const v = leseVerteilung(z.verteilung)
  const jetzt = jetztMs(k)
  const laeuftNoch = v?.status === 'laeuft' && jetzt - Date.parse(String(v.seit ?? '')) < LAEUFT_HOECHSTENS_MS
  const starten = !laeuftNoch && (!v || v.status === 'laeuft' || body?.neu === true)
  if (!starten) return { status: 200, daten: await verteilAnsicht(k, z, v!, ich) }

  await speichereVerteilung(k, z.id, (alt) => ({ version: 1, status: 'laeuft', seit: new Date(jetzt).toISOString(), von: k.aufrufer.name, abschnitte: alt?.abschnitte ?? [], ergebnisse: alt?.ergebnisse ?? {} }))
  const stand: { fertig: Verteilung | null; gewartet: boolean } = { fertig: null, gewartet: true }
  const lauf = berechne(k, z, ich).then(async (erg) => {
    stand.fertig = erg
    if (!stand.gewartet && body?.telegram === true && k.sendeTelegram && ich?.telegram_chat_id) {
      await k.sendeTelegram(ich.telegram_chat_id, fertigNachricht(erg, z.titel ? ` „${z.titel}“` : '')).catch(() => false)
    }
    return erg
  })
  k.imHintergrund?.(lauf)
  const warten = Math.max(0, Math.min(k.wartenMs ?? 140_000, (k.restMs?.() ?? 170_000) - 30_000))
  let uhr: ReturnType<typeof setTimeout> | undefined
  await Promise.race([lauf, new Promise((r) => (uhr = setTimeout(r, warten)))])
  clearTimeout(uhr)
  if (!stand.fertig) {
    stand.gewartet = false
    return { status: 200, daten: { ok: true, status: 'laeuft', abschnitte: [], hinweis: 'Der Vorschlag wird noch berechnet (lange Aufnahme).' } }
  }
  return { status: 200, daten: await verteilAnsicht(k, z, stand.fertig, ich) }
}

// ---------------------------------------------------------------------------------------------
// Übernehmen

type Ziel = { kundeId: string; abschnitt: VerteilAbschnitt; neu: boolean }

type AkteVoll = {
  id: string
  bereich: string
  firma: string | null
  ansprechpartner: string | null
  verantwortlich: string | null
  verantwortlich_email: string | null
}

// deno-lint-ignore no-explicit-any
export async function gespraechVerteilen(k: VerteilKontext, body: any): Promise<VerteilAntwort> {
  const { admin, aufrufer, heute } = k
  const z = await ladeAufnahme(k, body?.id)
  if (istAntwort(z)) return z
  const v = leseVerteilung(z.verteilung)
  if (!v || v.status !== 'fertig') return fehler(409, v?.status === 'laeuft' ? 'Der Vorschlag wird gerade noch berechnet. Bitte kurz warten.' : 'Bitte zuerst den Vorschlag zum Verteilen laden.')
  const eingaben = Array.isArray(body?.auswahl?.abschnitte) ? body.auswahl.abschnitte.slice(0, 150) : []
  if (eingaben.length === 0) return fehler(400, 'Es ist kein Abschnitt ausgewählt.')

  const ich = await ladeIch(k)
  const sichtbar = sichtbarFuer(ich)
  const datum = berlinTag(z.erstellt_am) || heute
  const sprecher = ich?.name || aufrufer.name
  const basis = k.linkBasis ?? (await ladeLinkBasis(admin))
  const appLink = `${basis.endsWith('/') ? basis : `${basis}/`}gespraech/#/aufnahme/${encodeURIComponent(z.id)}`
  const hinweise: string[] = []
  const zeilen: string[] = []

  // 1. Ziele bestimmen (Akte prüfen bzw. neu anlegen)
  const ziele: Ziel[] = []
  const neuAngelegt = new Set<string>()
  const gesehen = new Set<number>()
  for (const e of eingaben) {
    const nr = Number(e?.nr)
    const ab = v.abschnitte.find((a) => a.nr === nr)
    if (!ab || gesehen.has(nr)) continue
    gesehen.add(nr)
    const ziel = e?.ziel ?? {}
    if (ziel.ueberspringen === true) continue
    const wirksam = wirksamerAbschnitt(ab, e)
    if (typeof ziel.kundeId === 'string' && ziel.kundeId.trim()) {
      const kundeId = ziel.kundeId.trim()
      if (SAMMELAKTEN_VERTEILEN.includes(kundeId)) {
        hinweise.push(`${ab.name}: In die Sammelakten wird nicht verteilt — bitte die Akte des Kunden wählen.`)
        continue
      }
      const { data: akte } = await admin.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
      if (!akte || (akte.bereich === 'privat' && adresse(akte.verantwortlich_email) !== adresse(aufrufer.email))) {
        hinweise.push(`${ab.name}: Die gewählte Akte gibt es nicht (mehr).`)
        continue
      }
      if (!(await k.darfKunde(kundeId))) {
        hinweise.push(`${ab.name}: Diese Akte ist für dich nicht freigegeben.`)
        continue
      }
      ziele.push({ kundeId, abschnitt: wirksam, neu: false })
      continue
    }
    if (ziel.neu && typeof ziel.neu === 'object') {
      const bereich = String(ziel.neu.bereich ?? '').trim()
      const firma = String(ziel.neu.firma ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || ab.firma || ab.name
      const ansprechpartner = String(ziel.neu.ansprechpartner ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || ab.person || firma
      const privat = bereich === 'privat'
      if (!NEUANLAGE_BEREICHE.includes(bereich) && !privat) {
        hinweise.push(`${ab.name}: Bitte einen gültigen Bereich für die neue Akte wählen.`)
        continue
      }
      if (!privat && !(await k.darfBereich(bereich))) {
        hinweise.push(`${ab.name}: Im Bereich ${BEREICH_NAME[bereich] ?? bereich} darfst du keine Akte anlegen.`)
        continue
      }
      const kundeId = neueAkteId(z.id, firma)
      const { error } = await admin.from('kunden').insert({
        id: kundeId,
        bereich,
        firma,
        ansprechpartner,
        email: '',
        telefon: '',
        prioritaet: 'Mittel',
        status: startStatusFuer(bereich),
        follow_up: { date: heute, note: 'Erstkontakt aus der Sprachnotiz nachbereiten', done: false },
        verantwortlich: sprecher,
        ...(privat ? { verantwortlich_email: adresse(aufrufer.email) } : {}),
        ...(wirksam.vermittler ? { vermittler: { name: wirksam.vermittler } } : {}),
        letzte_aktivitaet: heute,
        activities: [{ id: crypto.randomUUID(), date: heute, text: `Akte aus der Sprachnotiz von ${sprecher} vom ${deDatum(datum)} angelegt.`, user: sprecher }],
        dokumente: [],
      })
      if (error) {
        const doppelt = String(error.code) === '23505' || /duplicate key/i.test(String(error.message))
        if (!doppelt) {
          hinweise.push(`${ab.name}: Die neue Akte ließ sich nicht anlegen: ${error.message}`)
          continue
        }
        // Schon bei einem früheren Aufruf angelegt (feste Kennung) — diese nehmen.
      } else neuAngelegt.add(kundeId)
      ziele.push({ kundeId, abschnitt: wirksam, neu: !error })
      continue
    }
    hinweise.push(`${ab.name}: Kein Ziel gewählt — übersprungen.`)
  }

  // 2. Je Akte anlegen
  const gruppen = new Map<string, Ziel[]>()
  for (const x of ziele) gruppen.set(x.kundeId, [...(gruppen.get(x.kundeId) ?? []), x])
  const { data: teamRoh } = await admin.from('mitarbeiter').select('name, email').eq('aktiv', true)
  const team = ((teamRoh ?? []) as { name: string; email: string }[]).map((m) => ({ name: String(m.name ?? ''), email: adresse(m.email) }))
  const fragender = { id: String(ich?.id ?? ''), name: aufrufer.name, email: aufrufer.email, rolle: ich?.rolle ?? null, ist_admin: ich?.ist_admin ?? null, bereiche: ich?.bereiche ?? null }
  const ergebnisseAus: Record<string, unknown>[] = []

  for (const [kundeId, teileZ] of gruppen) {
    const teile = teileZ.map((t) => t.abschnitt)
    const { data: akteRoh } = await admin.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (!akteRoh) {
      hinweise.push(`${teile[0].name}: Die Akte ließ sich nicht laden.`)
      continue
    }
    const akte = akteRoh as AkteVoll
    const name = akteName(akte)
    const privat = akte.bereich === 'privat'
    const vorher = v.ergebnisse[kundeId]
    const erg: VerteilErgebnis = {
      ...(vorher ?? {}),
      kundeId,
      name,
      bereich: akte.bereich,
      nrs: [...new Set([...(vorher?.nrs ?? []), ...teile.map((t) => t.nr)])],
      am: vorher?.am ?? new Date(jetztMs(k)).toISOString(),
      wiedervorlagen: { ...(vorher?.wiedervorlagen ?? {}) },
      todos: { ...(vorher?.todos ?? {}) },
      ...(teileZ.some((t) => t.neu) || vorher?.neuAngelegt ? { neuAngelegt: true } : {}),
    }
    const eigeneHinweise: string[] = []
    const angelegt: string[] = []
    const link = akteLinkVerteilen(basis, akte.bereich, kundeId)

    if (erg.extern) {
      eigeneHinweise.push('Schon früher verteilt (Gesprächsprotokoll vorhanden) — nichts doppelt angelegt.')
    } else {
      // 2a. Protokoll mit fester Kennung
      let weiter = true
      if (!erg.protokollId) {
        const protokollId = protokollIdFuer(z.id, kundeId)
        const kern = teile.map((t) => t.stand).join(' ')
        const { error } = await admin.from('protokolle').insert({
          id: protokollId,
          bereich: akte.bereich,
          kunde_id: kundeId,
          datum,
          teilnehmer: sprecher.slice(0, 300),
          betreff: `Sprachnotiz vom ${deDatum(datum)}: ${teile.map((t) => t.name).join(', ')}`.slice(0, 200),
          text: protokollText(teile, { sprecher, datum, titel: z.titel, link: appLink }),
          kernthemen: [kern.slice(0, 500)],
          vereinbarungen: [...teile.flatMap((t) => t.todos.map((x) => x.text)), ...teile.flatMap((t) => t.wiedervorlagen.map((w) => w.titel))].slice(0, 30),
          offene_punkte: teile.flatMap((t) => t.offeneFragen).slice(0, 30),
          stimmung: null,
          ki_zusammenfassung: kern.slice(0, 3000),
          dauer_sekunden: null,
        })
        if (error) {
          const doppelt = String(error.code) === '23505' || /duplicate key/i.test(String(error.message))
          if (!doppelt) {
            eigeneHinweise.push(`Das Gesprächsprotokoll ließ sich nicht anlegen: ${error.message}. Für diese Akte wurde nichts angelegt.`)
            weiter = false
          } else {
            // Protokoll gibt es schon, aber nicht von diesem Ablauf vermerkt (Skript, zweiter gleichzeitiger Aufruf):
            // dann für diese Akte nichts weiter anlegen.
            erg.extern = true
            erg.protokollId = protokollId
            eigeneHinweise.push('Schon früher verteilt (Gesprächsprotokoll vorhanden) — nichts doppelt angelegt.')
            weiter = false
          }
        } else {
          erg.protokollId = protokollId
          angelegt.push('Gesprächsprotokoll')
        }
      }

      if (weiter) {
        // 2b. Wiedervorlagen
        for (const w of teile.flatMap((t) => t.wiedervorlagen)) {
          const schluessel = wvSchluessel(w)
          if (erg.wiedervorlagen![schluessel]) continue
          if (privat) {
            eigeneHinweise.push(`Wiedervorlage „${w.titel}“ nicht angelegt: Private Kontakte haben keine Wiedervorlagen.`)
            continue
          }
          if (!istDatum(w.faellig)) {
            eigeneHinweise.push(`Wiedervorlage „${w.titel}“ nicht angelegt: Datum fehlt.`)
            continue
          }
          const { data, error } = await admin.from('wiedervorlagen').insert({
            kunde_id: kundeId,
            bereich: akte.bereich,
            titel: w.titel,
            faellig: w.faellig,
            notiz: `Aus der Sprachnotiz vom ${deDatum(datum)}`,
            verantwortlich: String(akte.verantwortlich ?? '').trim() || sprecher,
            quelle: 'hand',
            erstellt_von: aufrufer.name,
          }).select('id').single()
          if (error || !data) {
            eigeneHinweise.push(`Wiedervorlage „${w.titel}“ nicht angelegt: ${error?.message ?? 'unbekannter Fehler'}.`)
            continue
          }
          erg.wiedervorlagen![schluessel] = String(data.id)
          angelegt.push(`Wiedervorlage „${w.titel}“ zum ${deDatum(w.faellig)}`)
        }

        // 2c. To-dos (wie todo_anlegen des Assistenten: eigene Liste oder die eines Kollegen)
        for (const t of teile.flatMap((x) => x.todos)) {
          const schluessel = todoSchluessel(t)
          if (erg.todos![schluessel]) continue
          const zustEmail = adresse(t.zustaendig_email)
          const kollege = zustEmail
            ? team.find((m) => m.email === zustEmail)
            : teamMitgliedZu(t.zustaendig, team)
          if (zustEmail && !kollege) {
            eigeneHinweise.push(`To-do „${t.text}“ nicht angelegt: ${zustEmail} ist kein aktiver Mitarbeiter.`)
            continue
          }
          const fuerKollege = kollege && kollege.email !== adresse(aufrufer.email) ? kollege : undefined
          const frei = !kollege && t.zustaendig ? t.zustaendig : ''
          const r = await todoAnlegen(admin, fragender, {
            aufgabe: t.text,
            erledigen_bis: istDatum(t.faellig) ? t.faellig : undefined,
            kunde_projekt: name,
            ...(fuerKollege ? { fuer: fuerKollege.name } : frei ? { zustaendig: frei } : {}),
          }, () => {})
          const tid = r.match(/todo_id=(\S+)/)?.[1]
          if (!tid || /^(Fehler|Nicht angelegt)/.test(r)) {
            eigeneHinweise.push(`To-do „${t.text}“ nicht angelegt: ${r.replace(/^Fehler:\s*/, '')}`)
            continue
          }
          erg.todos![schluessel] = tid
          angelegt.push(`To-do „${t.text}“${fuerKollege ? ` für ${fuerKollege.name}` : ''}`)
        }

        // 2d. Akte: frisch lesen, nur geänderte Felder schreiben (Verlauf mit der Datenbank zusammengeführt).
        const { data: frisch, error: frischFehler } = await admin.from('kunden').select('bereich, activities, vermittler, auftrag_chance').eq('id', kundeId).maybeSingle()
        if (frischFehler || !frisch) {
          eigeneHinweise.push(`Die Akte selbst (Verlauf, Chance) ließ sich nicht aktualisieren: ${frischFehler?.message ?? 'nicht gefunden'}.`)
        } else {
          const aenderung: Record<string, unknown> = {}
          let chanceArt: VerteilErgebnis['chance'] | undefined
          if (!erg.chance) {
            const c = chanceFuer(teile, { bereich: String(frisch.bereich ?? akte.bereich), auftrag_chance: frisch.auftrag_chance }, { name: sprecher, am: new Date(jetztMs(k)).toISOString() })
            if (c) {
              aenderung[c.feld] = c.wert
              chanceArt = c.feld === 'auftrag_chance' ? 'gesetzt' : 'vorschlag'
              angelegt.push(c.feld === 'auftrag_chance' ? `Chance ${c.wert.prozent} % (unbestätigt)` : `Vorschlag Chance ${c.wert.prozent} % (die bestätigte Chance bleibt)`)
            }
          }
          const vermittler = teile.map((t) => t.vermittler).find(Boolean)
          const vorhandenerVermittler = frisch.vermittler && typeof frisch.vermittler === 'object' ? String((frisch.vermittler as Record<string, unknown>).name ?? '').trim() : ''
          let vermittlerGesetzt = false
          if (vermittler && !erg.vermittler && !vorhandenerVermittler && !privat) {
            aenderung.vermittler = { name: vermittler }
            vermittlerGesetzt = true
            angelegt.push(`Vermittler „${vermittler}“`)
          }
          const verlaufNoetig = !erg.verlauf || angelegt.length > 0
          if (verlaufNoetig) {
            const text = erg.verlauf ? `Weitere Punkte aus der Sprachnotiz vom ${deDatum(datum)} übernommen: ${angelegt.join(', ')}.` : verlaufText(teile, { sprecher, datum, angelegt })
            aenderung.activities = [{ id: crypto.randomUUID(), date: heute, text, user: aufrufer.name }, ...(Array.isArray(frisch.activities) ? frisch.activities : [])]
            aenderung.letzte_aktivitaet = heute
          }
          if (Object.keys(aenderung).length) {
            const { error } = await admin.from('kunden').update(aenderung).eq('id', kundeId)
            if (error) eigeneHinweise.push(`Die Akte selbst (Verlauf, Chance, Vermittler) ließ sich nicht aktualisieren: ${error.message}.`)
            else {
              if (verlaufNoetig) erg.verlauf = true
              if (chanceArt) erg.chance = chanceArt
              if (vermittlerGesetzt) erg.vermittler = true
            }
          }
        }
      }
    }

    erg.hinweise = eigeneHinweise.length ? eigeneHinweise.slice(0, 20) : vorher?.hinweise
    // Nach jeder Akte speichern: bricht der Lauf ab, weiß der nächste Aufruf, was schon da ist.
    try {
      await speichereVerteilung(k, z.id, (alt) => {
        const basisV = alt ?? v
        const frischErg = basisV.ergebnisse[kundeId]
        const behalten = erg.extern && frischErg?.protokollId && !frischErg.extern
        return { ...basisV, ergebnisse: { ...basisV.ergebnisse, [kundeId]: behalten ? frischErg : erg } }
      })
      v.ergebnisse[kundeId] = erg
    } catch (err) {
      eigeneHinweise.push(`Vermerk an der Aufnahme ließ sich nicht speichern (ein zweiter Aufruf könnte doppelt anlegen): ${err instanceof Error ? err.message : String(err)}`)
    }
    if (neuAngelegt.has(kundeId)) angelegt.unshift(`neue Akte (${BEREICH_NAME[akte.bereich] ?? akte.bereich})`)
    zeilen.push(`${name}: ${angelegt.length ? angelegt.join(', ') : 'nichts Neues'}.`)
    ergebnisseAus.push({ kundeId, name, bereich: akte.bereich, link, neu: neuAngelegt.has(kundeId), extern: !!erg.extern, angelegt, hinweise: eigeneHinweise, nrs: teile.map((t) => t.nr) })
  }

  return { status: 200, daten: { ok: true, zeilen, hinweise, ergebnisse: ergebnisseAus } }
}
