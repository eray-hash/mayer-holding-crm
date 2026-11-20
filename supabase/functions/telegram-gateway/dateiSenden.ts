// Assistent-Werkzeug "datei_senden": schickt eine Datei aus den Dokumenten einer Kundenakte per
// Telegram (sendDocument) an den Mitarbeiter, der gerade mit dem Assistenten spricht. Anlass: Am
// 20.11.2026 wollte ein Mitarbeiter die eben erstellte Datei direkt im Chat haben — der Assistent konnte
// sie nur in der Akte ablegen.
//
// Dokumente liegen an mehreren Orten (siehe email-gateway/index.ts, ladeDokumentBytes): im CRM
// hochgeladene und vom Assistenten erstellte im privaten Eimer "kunden-dokumente" (url = Pfad),
// Mail- und Telegram-Anhänge im Eimer "email-anhaenge" (url = volle Adresse, die nicht mehr offen
// abrufbar sein muss), Anhänge aus persönlichen Postfächern mit Vorsatz "privat:" (Eimer
// "postfach-anhaenge"). Gelesen wird immer mit dem Dienst-Client; nur fremde Adressen per fetch.
//
// Rechte wie beim Erstellen (darfAkte aus rechte.ts): private Akten anderer gibt es nicht. Sensible
// Unterlagen (Ausweis, Kontoauszug … — dieselbe Erkennung wie sensibel.ts) gehen nicht über Telegram,
// weil mit Telegram kein Auftragsverarbeitungsvertrag besteht; ausgenommen sind Dateien, die der
// Assistent selbst erstellt hat (quelle "assistent").

import { eigenerSpeicher, ERLAUBTE_EIMER, istSichererPfad } from '../_shared/speicherPfad.ts'
import { type AkteFuerRechte, darfAkte as darfAkteStandard, istPrivat, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { sensibleArt } from './sensibel.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Telegram-Bots dürfen Dateien bis 50 MB schicken. */
export const TELEGRAM_GRENZE = 50 * 1024 * 1024

export const DATEI_SENDEN_WERKZEUG = {
  name: 'datei_senden',
  description:
    'Schickt eine Datei aus den Dokumenten einer Kundenakte (PDF, Word, Excel, Foto, Scan …) direkt als Datei in den Telegram-Chat des Mitarbeiters, mit dem du gerade sprichst. Verwenden, wenn der Mitarbeiter eine Datei "hier", "in Telegram", "aufs Handy" haben möchte oder "schick mir …" sagt — auch gleich nach dokument_erstellen oder tabelle_erstellen. Die Datei wird mit dokument_id (aus einer früheren Antwort, z. B. von dokument_erstellen, tabelle_erstellen oder kundenakte_lesen) oder einem Suchbegriff aus dem Dateinamen gewählt; bei mehreren Treffern kommt eine Liste zum Nachfragen. Mit "an" geht die Datei stattdessen an einen Kollegen (z. B. "schick das Merkblatt an Andreas"); er muss die Akte selbst sehen dürfen, private Akten gehen nie an andere. Sensible Unterlagen (Ausweis, Kontoauszug, Steuer-, Gehalts- und Gesundheitsunterlagen, unterschriebene Verträge) werden aus Datenschutzgründen nicht über Telegram verschickt.',
  input_schema: {
    type: 'object',
    properties: {
      kunde_id: { type: 'string', description: 'Die Akte, in der die Datei liegt (für Unterlagen des Hauses k_intern_holding).' },
      dokument_id: { type: 'string', description: 'Kennung des Dokuments (dokument_id), wenn bekannt.' },
      name: { type: 'string', description: 'Sonst: Dateiname oder ein Wort daraus, z. B. "Mieterliste".' },
      bildunterschrift: { type: 'string', description: 'Optional: kurzer Text unter der Datei (höchstens 1000 Zeichen).' },
      an: { type: 'string', description: 'Optional: Name eines Kollegen, an den die Datei gehen soll (statt an den Mitarbeiter selbst). Nur wenn er das ausdrücklich will.' },
    },
    required: ['kunde_id'],
  },
}

export type SendeKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; id?: string | null }
  protokolliere: (text: string) => void
  darfAkte?: (m: RechteMitarbeiter, akte: AkteFuerRechte) => boolean
  /** Chat-ID, falls der Aufrufer sie kennt; sonst aus mitarbeiter.telegram_chat_id. */
  chatId?: number | string | null
  /** Bot-Schlüssel; ohne Angabe TELEGRAM_BOT_TOKEN. Fehlt er (lokaler Test), wird nur protokolliert. */
  botToken?: string | null
  /** Für Tests: Ersatz für fetch (Telegram und fremde Adressen). */
  abruf?: typeof fetch
}

type Dok = { id?: string; name?: string; typ?: string; url?: string; groesse?: string; datum?: string; quelle?: string }

function kundeName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  const firma = String(k.firma ?? '').trim()
  const ap = String(k.ansprechpartner ?? '').trim()
  return ap && ap !== firma ? `${firma} (${ap})` : firma || ap
}

function einfach(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function formatGroesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function liste(doks: Dok[]): string {
  return doks
    .slice(0, 10)
    .map((d) => `- „${d.name ?? 'ohne Namen'}"${d.datum ? ` (${d.datum}${d.groesse ? `, ${d.groesse}` : ''})` : ''} dokument_id=${d.id ?? '?'}`)
    .join('\n')
}

/** Sucht das Dokument nach Kennung oder Teil des Namens. */
export function findeDokument(doks: Dok[], id: string, suche: string): { dok: Dok } | { meldung: string } {
  if (id) {
    const d = doks.find((x) => x.id === id)
    if (d) return { dok: d }
    if (!suche) return { meldung: `Kein Dokument mit dokument_id=${id} in dieser Akte.${doks.length ? ` Vorhanden sind u. a.:\n${liste(doks)}` : ''}` }
  }
  if (!suche) return { meldung: doks.length ? `Welche Datei? Gib dokument_id oder name an. Vorhanden sind u. a.:\n${liste(doks)}` : 'Diese Akte hat keine Dokumente.' }
  const s = einfach(suche)
  const genau = doks.filter((d) => einfach(d.name ?? '') === s || einfach(String(d.name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '')) === s)
  if (genau.length === 1) return { dok: genau[0] }
  const woerter = s.split(' ').filter(Boolean)
  const treffer = doks.filter((d) => {
    const n = einfach(d.name ?? '')
    return woerter.every((w) => n.includes(w))
  })
  if (treffer.length === 1) return { dok: treffer[0] }
  if (treffer.length === 0) return { meldung: `Keine Datei zu „${suche}" in dieser Akte.${doks.length ? ` Vorhanden sind u. a.:\n${liste(doks)}` : ''}` }
  return { meldung: `Mehrere Dateien passen zu „${suche}" — welche soll es sein?\n${liste(treffer)}` }
}

/**
 * Wo liegt die Datei? Eimer + Pfad im eigenen Speicher (mit dem Dienst-Client lesbar). null, wenn der
 * Verweis leer, fremd oder bedenklich ist — fremde Adressen werden nie abgerufen (_shared/speicherPfad.ts).
 */
export function speicherOrt(url: string, basisUrl = Deno.env.get('SUPABASE_URL') ?? ''): { eimer: string; pfad: string } | null {
  const u = String(url ?? '').trim()
  if (!u) return null
  let ort: { eimer: string; pfad: string } | null
  if (u.startsWith('objekt-dokumente:')) ort = { eimer: 'objekt-dokumente', pfad: u.slice('objekt-dokumente:'.length) }
  else if (u.startsWith('privat:')) ort = { eimer: 'postfach-anhaenge', pfad: u.slice('privat:'.length) }
  else if (/^https?:\/\//i.test(u)) ort = eigenerSpeicher(u, basisUrl)
  else ort = { eimer: 'kunden-dokumente', pfad: u }
  return ort && istSichererPfad(ort.pfad) && (ERLAUBTE_EIMER as readonly string[]).includes(ort.eimer) ? ort : null
}

class DateiFehler extends Error {}

async function ladeBytes(supabase: Supa, url: string, abruf: typeof fetch): Promise<Uint8Array<ArrayBuffer>> {
  const ort = speicherOrt(url)
  if (!ort) throw new DateiFehler(String(url ?? '').trim() ? 'Der Verweis auf diese Datei ist ungültig oder zeigt nicht auf den eigenen Speicher. Sie lässt sich nur im CRM öffnen.' : 'Zu diesem Dokument ist keine Datei hinterlegt.')
  const zuGross = (n: number) => new DateiFehler(`Die Datei ist ${formatGroesse(n)} groß — Telegram nimmt höchstens 50 MB. Sie lässt sich im CRM in der Akte unter Dokumente öffnen.`)
  void abruf
  let bytes: Uint8Array<ArrayBuffer>
  const { data, error } = await supabase.storage.from(ort.eimer).download(ort.pfad)
  if (error || !data) throw new DateiFehler(`Die Datei ist im Speicher nicht (mehr) vorhanden (${error?.message ?? 'unbekannt'}).`)
  if (data.size > TELEGRAM_GRENZE) throw zuGross(data.size)
  bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length > TELEGRAM_GRENZE) throw zuGross(bytes.length)
  if (bytes.length === 0) throw new DateiFehler('Die Datei ist leer.')
  return bytes
}

const TYP_NACH_ENDUNG: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  csv: 'text/csv',
  txt: 'text/plain',
}
const ENDUNG_NACH_TYP: Record<string, string> = Object.fromEntries(Object.entries(TYP_NACH_ENDUNG).filter(([e]) => e !== 'jpeg').map(([e, t]) => [t, e]))

/** Dateiname für Telegram: ohne Pfadzeichen, mit Endung. */
export function sendeName(dok: Dok): string {
  // deno-lint-ignore no-control-regex
  let n = String(dok.name ?? '').replace(/[\\/\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Datei'
  const endung = ENDUNG_NACH_TYP[String(dok.typ ?? '')]
  if (!/\.[a-z0-9]{2,5}$/i.test(n) && endung) n = `${n}.${endung}`
  return n.length > 120 ? n.slice(-120) : n
}

function telegramFehler(status: number, beschreibung: string, wer: string): string {
  if (status === 413 || /too large|too big/i.test(beschreibung)) return 'Telegram hat die Datei als zu groß abgelehnt (höchstens 50 MB). Sie lässt sich im CRM in der Akte unter Dokumente öffnen.'
  if (/chat not found/i.test(beschreibung)) return `Der Telegram-Chat von ${wer} ist nicht erreichbar. Er muss sich im CRM unter Einstellungen neu mit Telegram verbinden.`
  if (status === 403 || /blocked|deactivated/i.test(beschreibung)) return `Telegram lässt die Nachricht nicht zu: ${wer} hat den Bot gestoppt oder blockiert.`
  if (status === 429) return 'Telegram bremst gerade (zu viele Nachrichten). Bitte in einer Minute noch einmal versuchen.'
  return `Telegram hat die Datei abgelehnt (${status}${beschreibung ? `: ${beschreibung}` : ''}).`
}

// deno-lint-ignore no-explicit-any
export async function fuehreDateiSendenAus(input: any, k: SendeKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere } = k
  const darf = k.darfAkte ?? darfAkteStandard
  const abruf = k.abruf ?? fetch
  const kundeId = String(input?.kunde_id ?? '').trim()
  const dokId = String(input?.dokument_id ?? '').trim()
  const suche = String(input?.name ?? input?.suchbegriff ?? '').trim()
  const unterschrift = String(input?.bildunterschrift ?? '').trim().slice(0, 1000)
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'

  const { data: akte, error: ladeFehler } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email, dokumente').eq('id', kundeId).maybeSingle()
  if (ladeFehler) return `Fehler beim Laden der Akte: ${ladeFehler.message}`
  const keinKunde = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'
  if (!akte) return keinKunde
  if (!darf(mitarbeiter, akte)) return istPrivat(akte) ? keinKunde : nichtFreigegeben(akte.bereich, mitarbeiter.name)
  const akteName = kundeName(akte)

  const doks: Dok[] = Array.isArray(akte.dokumente) ? akte.dokumente : []
  const gefunden = findeDokument(doks, dokId, suche)
  if ('meldung' in gefunden) return gefunden.meldung
  const dok = gefunden.dok
  const name = sendeName(dok)

  const sensibel = dok.quelle === 'assistent' ? null : sensibleArt([dok.name])
  if (sensibel) {
    return `Nicht gesendet: „${dok.name}" ist eine sensible Unterlage (${sensibel}). Solche Unterlagen verschicke ich aus Datenschutzgründen nicht über Telegram (mit Telegram besteht kein Auftragsverarbeitungsvertrag). Sag dem Mitarbeiter, dass er sie im CRM in der Akte von ${akteName} unter Dokumente öffnen kann.`
  }

  // Empfänger: der Mitarbeiter selbst oder — mit "an" — ein Kollege (Wunsch vom 20.11.2026). Der
  // Kollege muss die Akte selbst sehen dürfen; private Akten gehen nie an andere.
  const anName = String(input?.an ?? '').trim()
  let empfaenger = mitarbeiter.name
  let chatId = anName ? null : (k.chatId ?? null)
  let beschriftung = unterschrift
  if (anName) {
    const { data: alle, error: mFehler } = await supabase.from('mitarbeiter').select('id, name, email, rolle, ist_admin, bereiche, telegram_chat_id, aktiv').eq('aktiv', true)
    if (mFehler) return `Fehler beim Laden der Kollegen: ${mFehler.message}`
    const such = einfach(anName)
    // deno-lint-ignore no-explicit-any
    const kandidaten = (alle ?? []).filter((m: any) => einfach(m.name ?? '') === such || einfach(m.name ?? '').split(' ').includes(such) || einfach(m.name ?? '').includes(such))
    if (kandidaten.length === 0) return `Nicht gesendet: Einen Kollegen „${anName}" gibt es nicht.`
    // deno-lint-ignore no-explicit-any
    if (kandidaten.length > 1) return `Mehrere Kollegen passen zu „${anName}": ${kandidaten.map((m: any) => m.name).join(', ')}. Bitte nachfragen, wer gemeint ist.`
    const kollege = kandidaten[0]
    if (kollege.email && mitarbeiter.email && String(kollege.email).toLowerCase() === String(mitarbeiter.email).toLowerCase()) return await fuehreDateiSendenAus({ ...input, an: '' }, k)
    if (!darf(kollege, akte)) return istPrivat(akte) ? 'Nicht gesendet: Dateien aus privaten Akten gehen nicht an Kollegen.' : `Nicht gesendet: ${kollege.name} darf die Akte von ${akteName} nicht sehen (Bereich nicht freigegeben).`
    empfaenger = kollege.name
    chatId = kollege.telegram_chat_id ?? null
    if (!chatId) return `Nicht gesendet: ${kollege.name} ist nicht mit Telegram verbunden. Die Datei liegt in der Akte von ${akteName} unter Dokumente.`
    beschriftung = `Von ${mitarbeiter.name}${unterschrift ? `: ${unterschrift}` : ` — „${name}" aus der Akte ${akteName}`}`.slice(0, 1000)
  }
  if (!chatId) {
    const spalte = mitarbeiter.id ? 'id' : 'email'
    const wert = mitarbeiter.id ?? mitarbeiter.email
    if (wert) {
      const { data: m } = await supabase.from('mitarbeiter').select('telegram_chat_id').eq(spalte, wert).maybeSingle()
      chatId = m?.telegram_chat_id ?? null
    }
  }
  if (!chatId) return `Nicht gesendet: Für ${mitarbeiter.name} ist kein Telegram-Chat verbunden. Er kann sich im CRM unter Einstellungen mit Telegram verbinden; bis dahin öffnet er die Datei im CRM in der Akte von ${akteName} unter Dokumente.`

  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await ladeBytes(supabase, String(dok.url ?? ''), abruf)
  } catch (e) {
    return `Nicht gesendet: ${e instanceof DateiFehler ? e.message : `Die Datei ließ sich nicht laden (${e instanceof Error ? e.message : String(e)}).`}`
  }

  const typ = dok.typ || TYP_NACH_ENDUNG[name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream'
  const token = k.botToken === undefined ? Deno.env.get('TELEGRAM_BOT_TOKEN') : k.botToken
  if (!token) {
    console.log(`[Telegram-Datei -> ${chatId}] ${name} (${formatGroesse(bytes.length)}, ${typ})${beschriftung ? ` — ${beschriftung}` : ''}`)
    protokolliere(`„${name}" aus der Akte ${akteName} an ${empfaenger} geschickt (Testlauf, nicht wirklich gesendet)`)
    return `Testlauf ohne Bot-Schlüssel: „${name}" (${formatGroesse(bytes.length)}) wäre jetzt in den Telegram-Chat von ${empfaenger} gegangen, wurde aber nur protokolliert.`
  }

  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('document', new Blob([bytes], { type: typ }), name)
  if (beschriftung) form.append('caption', beschriftung)
  let res: Response
  try {
    res = await abruf(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(90_000) })
  } catch (e) {
    return `Nicht gesendet: Telegram war nicht erreichbar (${e instanceof Error ? e.message : String(e)}). Bitte gleich noch einmal versuchen.`
  }
  // deno-lint-ignore no-explicit-any
  const antwort: any = await res.json().catch(() => null)
  if (!res.ok || !antwort?.ok) {
    const meldung = telegramFehler(antwort?.error_code ?? res.status, String(antwort?.description ?? ''), empfaenger)
    console.error('sendDocument fehlgeschlagen:', res.status, antwort?.description ?? '')
    return `Nicht gesendet: ${meldung}`
  }
  protokolliere(`„${name}" aus der Akte ${akteName} per Telegram an ${empfaenger} geschickt`)
  return `Gesendet: „${name}" (${formatGroesse(bytes.length)}) liegt jetzt als Datei im Telegram-Chat von ${empfaenger}. Bestätige das in deiner Antwort nur kurz, ohne die Datei noch einmal zu beschreiben.`
}
