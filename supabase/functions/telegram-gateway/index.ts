// Edge Function "telegram-gateway" — der CRM-Assistent im Telegram-Chat.
//
// Mitarbeiter schreiben dem Bot wie einem Kollegen. Dahinter läuft ein echter Assistent mit
// Werkzeugen (Kunden suchen, Akte lesen, Notiz/Aufgabe setzen, Kunden anlegen/ändern, geschickte
// Dateien ablegen) und einem Gesprächsgedächtnis pro Mitarbeiter. Früher wurde jede Nachricht stur in
// "Notiz / Aufgabe / Frage" einsortiert — eine Bitte wie "leg die Dateien in seine Akte" wurde dadurch
// als Aufgabe gespeichert statt ausgeführt, und Rückfragen liefen über starre Schlüsselwörter.
//
// Zustand: mitarbeiter.telegram_pending (jsonb) hält Gesprächsverlauf und Aktionsprotokoll.
// Dateien: jede geschickte Datei wird sofort im Bucket "email-anhaenge" unter "telegram/" gesichert.
// "Noch nicht zugeordnet" heißt schlicht: liegt dort, wird aber von keiner Akte referenziert — dafür
// braucht es keinen eigenen Zustand, und auch früher liegengebliebene Dateien bleiben auffindbar.
//
// Setup (einmalig):
//   1. Secrets TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET und ANTHROPIC_API_KEY sind gesetzt.
//   2. Nach dem Deploy: setWebhook bei Telegram mit secret_token = TELEGRAM_WEBHOOK_SECRET.
//   3. Mitarbeiter verknüpfen sich über "Mein Profil" (Code per /start <code> an den Bot).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRM_SHARED_SECRET = Deno.env.get('CRM_SHARED_SECRET')
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const AGENT_MODEL = Deno.env.get('TELEGRAM_AGENT_MODEL') ?? 'claude-sonnet-5-5'

const BUCKET = 'email-anhaenge'
const ORDNER = 'telegram'

// deno-lint-ignore no-explicit-any
type Supa = SupabaseClient<any, any, any>

function supa(): Supa {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

// Ohne Bot-Token (lokaler Testlauf) wird die Antwort nur protokolliert.
async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  if (!BOT_TOKEN) {
    console.log(`[Telegram -> ${chatId}] ${text}`)
    return
  }
  // Telegram erlaubt höchstens 4096 Zeichen pro Nachricht.
  for (let i = 0; i < text.length; i += 4000) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000) }),
    })
    if (!res.ok) console.error('sendMessage fehlgeschlagen:', res.status, await res.text().catch(() => ''))
  }
}

async function sendeTippen(chatId: number): Promise<void> {
  if (!BOT_TOKEN) return
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {})
}

// Dokumenten-Analyse (Einzeldokument klassifizieren, Sammel-Scan aufteilen) bleibt in email-gateway.
// deno-lint-ignore no-explicit-any
async function callEmailGateway(action: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/email-gateway`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(CRM_SHARED_SECRET ? { 'x-crm-secret': CRM_SHARED_SECRET } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error ?? `email-gateway-Fehler (${res.status})`)
  return data
}

// ---------- Kleine Helfer ----------

function heuteBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}

function deDatum(iso: string | undefined | null): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? '')
}

function formatGroesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sicheresPfadsegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function kuerze(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)} … (gekürzt)` : s
}

// btoa auf das gesamte Array gespreizt würde bei großen Scans den Call-Stack sprengen.
function bytesZuBase64(bytes: Uint8Array): string {
  let binaer = ''
  const blockgroesse = 0x8000
  for (let i = 0; i < bytes.length; i += blockgroesse) {
    binaer += String.fromCharCode(...bytes.subarray(i, i + blockgroesse))
  }
  return btoa(binaer)
}

// ---------- Kunden ----------

type Activity = { id: string; date: string; text: string; user: string }
type Dokument = { id: string; name: string; typ: string; datum: string; groesse: string; url: string }
type KundeRow = {
  id: string
  bereich: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string | null
  status: string | null
  prioritaet: string | null
  verantwortlich: string | null
  follow_up: { date?: string; note?: string; done?: boolean } | null
  activities: Activity[] | null
  dokumente: Dokument[] | null
}

const KUNDE_SPALTEN = 'id, bereich, firma, ansprechpartner, email, telefon, status, prioritaet, verantwortlich, follow_up, activities, dokumente'

const BEREICH_LABEL: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}

// Gespiegelt aus src/data/statusNetworks.ts (eigene Laufzeit, kein gemeinsamer Import möglich).
const STATUS_JE_BEREICH: Record<string, Record<string, string>> = {
  beratung: {
    lead: 'Lead / Neuanfrage', erstkontakt: 'Erstkontakt hergestellt', termin: 'Erstgespräch terminiert',
    durchgefuehrt: 'Erstgespräch durchgeführt', konzept: 'Konzeptvorstellung', angebot: 'Angebot / Beratungsvertrag versendet',
    unterschrieben: 'Beratungsvertrag unterschrieben', aktives_mandat: 'Aktives Mandat / laufende Beratung',
    rechnung_gestellt: 'Leistung erbracht / Rechnung gestellt', abgeschlossen: 'Abgeschlossen',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse', nicht_qualifiziert: 'Nicht qualifiziert',
  },
  erben: {
    erstkontakt: 'Erstkontakt', bedarfsanalyse: 'Bedarfsanalyse / Erstgespräch', unterlagen_angefordert: 'Unterlagen/Mandantenfragebogen angefordert',
    konzept_erstellt: 'Mandantenmemo/Konzept erstellt', beratungsgespraech: 'Beratungsgespräch geführt',
    umsetzung: 'Umsetzung (Testament/Vollmacht/Stiftung)', abgeschlossen: 'Abgeschlossen',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse',
  },
  betriebsuebergabe: {
    erstkontakt: 'Erstkontakt', bedarfsanalyse: 'Bedarfsanalyse / Erstgespräch', unternehmensbewertung: 'Unternehmensbewertung / Analyse',
    nachfolgekonzept: 'Nachfolgekonzept erstellt', nachfolgersuche: 'Nachfolger-/Käufersuche', verhandlung: 'Verhandlung / Vertragsentwurf',
    notartermin: 'Notartermin / Übergabe vollzogen', abgeschlossen: 'Abgeschlossen',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse',
  },
  betriebsformen: {
    erstkontakt: 'Erstkontakt', bedarfsanalyse: 'Ist-Analyse aktuelle Rechtsform', konzept_erstellt: 'Rechtsformvergleich/Konzept erstellt',
    beratungsgespraech: 'Beratungsgespräch geführt', umsetzung: 'Umsetzung (Gründung/Umwandlung)',
    handelsregister: 'Notartermin/Handelsregistereintrag', abgeschlossen: 'Abgeschlossen',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse',
  },
  akademie: {
    interessent: 'Interessent', anmeldung_eingegangen: 'Anmeldung eingegangen', platz_bestaetigt: 'Kursplatz bestätigt',
    kurs_laeuft: 'Kurs läuft', abgeschlossen: 'Abgeschlossen / Zertifikat ausgestellt',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Abgebrochen / Kein Interesse',
  },
  finanzierungen: {
    interessent: 'Interessent', risikoprofil_erstellt: 'Risikoprofil / Geeignetheitsprüfung erstellt',
    beratungsgespraech: 'Beratungsgespräch geführt (Beratungsprotokoll)', zeichnung_eingegangen: 'Zeichnungsschein eingegangen',
    kapital_eingezahlt: 'Kapital eingezahlt', abgeschlossen: 'Abgeschlossen (Aktiver Investor)',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse',
  },
  privat: {
    neu: 'Neu', in_kontakt: 'In Kontakt', termin_vereinbart: 'Termin vereinbart', erledigt: 'Erledigt',
    wiedervorlage: 'Wiedervorlage / On Hold', abgebrochen: 'Abgebrochen / Nicht weiter verfolgt',
  },
  immobilienkunden: {
    interessent: 'Interessent / Erstkontakt', besichtigung: 'Besichtigung vereinbart', angebot: 'Angebot abgegeben',
    verhandlung: 'In Verhandlung', abgeschlossen: 'Abgeschlossen',
    wiedervorlage: 'Wiedervorlage / On Hold', verloren: 'Verloren / Kein Interesse',
  },
}

const NEUANLAGE_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
const START_STATUS: Record<string, string> = {
  beratung: 'lead', erben: 'erstkontakt', betriebsuebergabe: 'erstkontakt', betriebsformen: 'erstkontakt',
  akademie: 'interessent', finanzierungen: 'interessent', immobilienkunden: 'interessent',
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

const FUELLWOERTER = new Set(
  [
    'bei', 'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'war', 'wie', 'was', 'wer', 'für', 'mit', 'von',
    'vom', 'zum', 'zur', 'auf', 'aus', 'herr', 'herrn', 'frau', 'firma', 'kunde', 'kunden', 'kundin', 'mandant', 'akte',
  ].map(norm),
)

function suchWoerter(s: string): string[] {
  return (norm(s).match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !FUELLWOERTER.has(w))
}

function sucheKunden(kunden: KundeRow[], begriff: string): KundeRow[] {
  const q = suchWoerter(begriff)
  if (q.length === 0) return []
  const ganzerBegriff = norm(begriff).trim()
  return kunden
    .map((k) => {
      const hay = norm(`${k.firma} ${k.ansprechpartner} ${k.email}`)
      const hayWoerter: string[] = hay.match(/[a-z0-9]{2,}/g) ?? []
      let score = 0
      for (const t of q) {
        if (hayWoerter.includes(t)) score += 3
        else if (t.length >= 3 && hayWoerter.some((w) => w.startsWith(t))) score += 2
        else if (t.length >= 4 && hay.includes(t)) score += 1
      }
      if (ganzerBegriff.length >= 4 && hay.includes(ganzerBegriff)) score += 3
      return { k, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.k)
}

async function ladeKunde(supabase: Supa, id: unknown): Promise<KundeRow | null> {
  if (typeof id !== 'string' || !id) return null
  const { data } = await supabase.from('kunden').select(KUNDE_SPALTEN).eq('id', id).maybeSingle()
  return (data as KundeRow | null) ?? null
}

function kundeName(k: { firma: string; ansprechpartner: string }): string {
  return k.ansprechpartner && k.ansprechpartner !== k.firma ? `${k.firma} (${k.ansprechpartner})` : k.firma
}

const KEIN_KUNDE = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'

// ---------- Dateien ----------

async function telegramDateiHerunterladen(fileId: string): Promise<Uint8Array | null> {
  if (!BOT_TOKEN) return null
  const metaRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const meta = await metaRes.json()
  if (!meta.ok) return null
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${meta.result.file_path}`)
  if (!fileRes.ok) return null
  return new Uint8Array(await fileRes.arrayBuffer())
}

async function pdfSeitenzahl(bytes: Uint8Array): Promise<number | null> {
  try {
    return (await PDFDocument.load(bytes)).getPageCount()
  } catch {
    return null // beschädigt/verschlüsselt — läuft dann als Einzeldatei weiter
  }
}

async function pdfSeitenAusschneiden(bytes: Uint8Array, startSeite: number, endSeite: number): Promise<Uint8Array> {
  const quelle = await PDFDocument.load(bytes)
  const ziel = await PDFDocument.create()
  const indices = Array.from({ length: endSeite - startSeite + 1 }, (_, i) => startSeite - 1 + i)
  for (const seite of await ziel.copyPages(quelle, indices)) ziel.addPage(seite)
  return ziel.save()
}

type ScanAufteilung = {
  erkannter_name?: string
  erkannte_firma?: string
  dokumente: {
    start_seite: number
    end_seite: number
    kategorie: string
    erkanntes_datum?: string
    vorgeschlagener_dateiname: string
  }[]
}

async function speichereDatei(supabase: Supa, bytes: Uint8Array, dateiname: string, contentType: string): Promise<string | null> {
  const pfad = `${ORDNER}/${Date.now()}_${sicheresPfadsegment(dateiname)}`
  const { error } = await supabase.storage.from(BUCKET).upload(pfad, bytes, { contentType, upsert: true })
  if (error) {
    console.error('Upload fehlgeschlagen:', error.message)
    return null
  }
  return pfad
}

function anzeigeName(dateiImOrdner: string): string {
  return dateiImOrdner.replace(/^\d{10,}_/, '')
}

// Sichert eine per Telegram geschickte Datei (Sammel-Scans werden vorher in Einzeldokumente zerlegt)
// und liefert eine Beschreibung des Eingangs, die der Assistent als Nachricht bekommt. Die Zuordnung
// zum Kunden entscheidet der Assistent — er kennt das Gespräch ("die Scans sind für Lipps").
// deno-lint-ignore no-explicit-any
async function verarbeiteDateiEingang(supabase: Supa, message: any): Promise<string> {
  const photo = message.photo?.at(-1) // höchste Auflösung ist der letzte Eintrag
  const document = message.document
  const caption: string = message.caption?.trim() ?? ''
  const bytes = await telegramDateiHerunterladen(document?.file_id ?? photo.file_id)
  if (!bytes) return '[Datei-Eingang per Telegram] Die geschickte Datei konnte nicht von Telegram heruntergeladen werden. Nichts wurde gespeichert.'

  const dateiname: string = document?.file_name ?? `foto_${Date.now()}.jpg`
  const contentType: string = document?.mime_type ?? 'image/jpeg'
  const kopf = [
    '[Datei-Eingang per Telegram — Systemmeldung, nicht vom Mitarbeiter getippt]',
    `Originaldatei: „${dateiname}"`,
    `Bildunterschrift des Mitarbeiters: ${caption ? `„${caption}"` : '(keine)'}`,
  ]

  const seiten = contentType === 'application/pdf' ? await pdfSeitenzahl(bytes) : null
  if (seiten && seiten > 1) {
    let aufteilung: ScanAufteilung | null = null
    try {
      const result = await callEmailGateway('split_scan_dokument', { datei_base64: bytesZuBase64(bytes), dateiname, seitenzahl: seiten })
      aufteilung = result.aufteilung
    } catch (err) {
      console.error('split_scan_dokument fehlgeschlagen:', err)
    }
    const zeilen: string[] = []
    for (const teil of aufteilung?.dokumente ?? []) {
      try {
        const teilBytes = await pdfSeitenAusschneiden(bytes, teil.start_seite, teil.end_seite)
        const name = teil.vorgeschlagener_dateiname || `${teil.kategorie}_${teil.start_seite}-${teil.end_seite}.pdf`
        const pfad = await speichereDatei(supabase, teilBytes, name, 'application/pdf')
        if (!pfad) continue
        zeilen.push(
          `${zeilen.length + 1}. pfad=${pfad} | Name: ${name} | Kategorie: ${teil.kategorie}${teil.erkanntes_datum ? ` | Datum im Dokument: ${teil.erkanntes_datum}` : ''} | Seiten ${teil.start_seite}–${teil.end_seite}`,
        )
      } catch (err) {
        console.error('Seiten-Ausschnitt fehlgeschlagen:', err)
      }
    }
    if (zeilen.length > 0) {
      const erkannt = [aufteilung?.erkannter_name && `Name „${aufteilung.erkannter_name}"`, aufteilung?.erkannte_firma && `Firma „${aufteilung.erkannte_firma}"`].filter(Boolean)
      return [
        ...kopf,
        `Sammel-Scan mit ${seiten} Seiten, automatisch in ${zeilen.length} Einzeldokument(e) zerlegt.`,
        `Im Scan erkannt: ${erkannt.length > 0 ? erkannt.join(', ') : 'kein eindeutiger Name'}`,
        'Gespeichert, noch keiner Akte zugeordnet:',
        ...zeilen,
      ].join('\n')
    }
    // Aufteilung nicht gelungen: den Scan als Ganzes sichern statt ihn zu verlieren.
    const pfad = await speichereDatei(supabase, bytes, dateiname, contentType)
    if (!pfad) return `${kopf.join('\n')}\nDie Datei konnte nicht gespeichert werden.`
    return [
      ...kopf,
      `Sammel-Scan mit ${seiten} Seiten. Die automatische Aufteilung in Einzeldokumente ist fehlgeschlagen; der Scan wurde als eine Datei gespeichert.`,
      'Gespeichert, noch keiner Akte zugeordnet:',
      `1. pfad=${pfad} | Name: ${dateiname}`,
    ].join('\n')
  }

  let klassifikation: { erkannter_name?: string; erkannte_firma?: string; kategorie?: string } | null = null
  try {
    const result = await callEmailGateway('classify_kunden_dokument', { datei_base64: bytesZuBase64(bytes), media_type: contentType, dateiname })
    klassifikation = result.klassifikation
  } catch (err) {
    console.error('classify_kunden_dokument fehlgeschlagen:', err)
  }
  const pfad = await speichereDatei(supabase, bytes, dateiname, contentType)
  if (!pfad) return `${kopf.join('\n')}\nDie Datei konnte nicht gespeichert werden.`
  const erkannt = [
    klassifikation?.erkannter_name && `Name „${klassifikation.erkannter_name}"`,
    klassifikation?.erkannte_firma && `Firma „${klassifikation.erkannte_firma}"`,
    klassifikation?.kategorie && `Art: ${klassifikation.kategorie}`,
  ].filter(Boolean)
  return [
    ...kopf,
    `Im Dokument erkannt: ${erkannt.length > 0 ? erkannt.join(', ') : 'nichts Eindeutiges'}`,
    'Gespeichert, noch keiner Akte zugeordnet:',
    `1. pfad=${pfad} | Name: ${dateiname}`,
  ].join('\n')
}

type OrdnerDatei = { name: string; created_at?: string; metadata?: { size?: number; mimetype?: string } | null }

async function listeOrdner(supabase: Supa): Promise<OrdnerDatei[]> {
  const { data, error } = await supabase.storage.from(BUCKET).list(ORDNER, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw new Error(`Dateiablage nicht lesbar: ${error.message}`)
  return ((data ?? []) as OrdnerDatei[]).filter((d) => d.metadata) // Unterordner haben keine Metadaten
}

// Alles, was irgendeine Kunden- oder Objektakte an Dateien referenziert, als ein durchsuchbarer Text.
async function ladeReferenzen(supabase: Supa): Promise<{ text: string; kunden: Pick<KundeRow, 'id' | 'firma' | 'ansprechpartner' | 'dokumente'>[] }> {
  const [{ data: kunden }, { data: objekte }] = await Promise.all([
    supabase.from('kunden').select('id, firma, ansprechpartner, dokumente'),
    supabase.from('objekte').select('dokumente'),
  ])
  return { text: JSON.stringify([kunden ?? [], objekte ?? []]), kunden: (kunden ?? []) as Pick<KundeRow, 'id' | 'firma' | 'ansprechpartner' | 'dokumente'>[] }
}

// ---------- Gesprächszustand ----------

// Ein Zug = eine Nachricht des Mitarbeiters samt allem, was der Assistent daraufhin getan hat
// (Werkzeug-Aufrufe und deren Ergebnisse) und seiner Antwort. Die Werkzeug-Ergebnisse müssen im
// Verlauf bleiben: sieht der Assistent später nur noch seine eigenen Sätze, hält er sie für ungeprüft
// und nimmt korrekte Aussagen wieder zurück.
// deno-lint-ignore no-explicit-any
type Nachricht = { role: 'user' | 'assistant'; content: any }
type AgentState = {
  v: 3
  zuege: { z: string; msgs: Nachricht[] }[]
  aktionen: { z: string; text: string }[]
  loesch_anfrage?: { kunde_id: string; name: string; z: string }
}

// Liest ältere Zustände tolerant (ohne "zuege") — die werden einfach verworfen.
function ladeState(raw: unknown): AgentState {
  // deno-lint-ignore no-explicit-any
  const r = raw as any
  const grenze = Date.now() - 12 * 60 * 60 * 1000
  const zuege = r?.v === 3 && Array.isArray(r.zuege)
    // deno-lint-ignore no-explicit-any
    ? r.zuege.filter((zug: any) => Array.isArray(zug?.msgs) && new Date(zug.z).getTime() > grenze)
    : []
  return {
    v: 3,
    zuege,
    aktionen: Array.isArray(r?.aktionen) ? r.aktionen.slice(-12) : [],
    loesch_anfrage: r?.loesch_anfrage,
  }
}

// Große Werkzeug-Ergebnisse (ganze Akte, Firmenüberblick) werden für den gespeicherten Verlauf
// gekürzt; braucht der Assistent sie später wieder, ruft er das Werkzeug neu auf.
function fuerVerlauf(msgs: Nachricht[]): Nachricht[] {
  return msgs.map((m) =>
    Array.isArray(m.content)
      ? {
          ...m,
          // deno-lint-ignore no-explicit-any
          content: m.content.map((b: any) =>
            b?.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 2500
              ? { ...b, content: `${b.content.slice(0, 2500)} … (für den Verlauf gekürzt — bei Bedarf Werkzeug erneut aufrufen)` }
              : b,
          ),
        }
      : m,
  )
}

// ---------- Werkzeuge des Assistenten ----------

type Mitarbeiter = { id: string; name: string; rolle?: string | null; ist_admin?: boolean | null }
type ToolKontext = {
  supabase: Supa
  mitarbeiter: Mitarbeiter
  state: AgentState
  vorherigeLoeschAnfrage: AgentState['loesch_anfrage']
}

const STATUS_HINWEIS = Object.entries(STATUS_JE_BEREICH)
  .map(([bereich, stati]) => `${bereich}: ${Object.entries(stati).map(([id, label]) => `${id} (${label})`).join(', ')}`)
  .join('\n')

const TOOLS = [
  {
    name: 'kunden_suchen',
    description: 'Sucht Kunden/Mandanten über alle Bereiche nach Name, Firma oder E-Mail. Liefert die kunde_id, die alle anderen Werkzeuge brauchen. Immer zuerst aufrufen, wenn ein Kunde genannt wird, dessen kunde_id du im Gespräch noch nicht ermittelt hast.',
    input_schema: {
      type: 'object',
      properties: { suchbegriff: { type: 'string', description: 'Name, Firma oder E-Mail, z. B. "Lipps" oder "Simpfendörfer".' } },
      required: ['suchbegriff'],
    },
  },
  {
    name: 'kundenakte_lesen',
    description: 'Liest die vollständige Akte eines Kunden: Stammdaten, Status, Follow-up, Aktivitäten/Notizen (mit ID), Dokumente (mit ID), Gesprächsprotokolle. Grundlage für jede Frage zu einem Kunden (offene Punkte, vorhandene oder fehlende Unterlagen, letzter Stand).',
    input_schema: { type: 'object', properties: { kunde_id: { type: 'string' } }, required: ['kunde_id'] },
  },
  {
    name: 'notiz_speichern',
    description: 'Schreibt eine Notiz in die Aktivitäten-Timeline eines Kunden. Nur verwenden, wenn der Mitarbeiter ausdrücklich etwas festhalten will.',
    input_schema: {
      type: 'object',
      properties: { kunde_id: { type: 'string' }, text: { type: 'string', description: 'Der Notiztext, sauber ausformuliert.' } },
      required: ['kunde_id', 'text'],
    },
  },
  {
    name: 'aufgabe_setzen',
    description: 'Setzt das Follow-up (die nächste Aufgabe) eines Kunden oder hakt es ab. Jeder Kunde hat genau ein Follow-up; ein neues ersetzt das bisherige. Nur verwenden, wenn der Mitarbeiter sich etwas vormerken will — nicht für Dinge, die du selbst sofort erledigen kannst.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string' },
        titel: { type: 'string', description: 'Was zu tun ist.' },
        faellig_am: { type: 'string', description: 'Fälligkeit als JJJJ-MM-TT. Ohne Angabe des Mitarbeiters: heute.' },
        erledigt: { type: 'boolean', description: 'true, um das bestehende Follow-up als erledigt abzuhaken (titel/faellig_am dann weglassen).' },
      },
      required: ['kunde_id'],
    },
  },
  {
    name: 'aktivitaet_aendern',
    description: 'Korrigiert oder löscht einen einzelnen Eintrag der Aktivitäten-Timeline (z. B. eine falsch abgelegte Notiz). Die aktivitaet_id steht in kundenakte_lesen.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string' },
        aktivitaet_id: { type: 'string' },
        neuer_text: { type: 'string', description: 'Neuer Text des Eintrags.' },
        loeschen: { type: 'boolean', description: 'true, um den Eintrag zu entfernen.' },
      },
      required: ['kunde_id', 'aktivitaet_id'],
    },
  },
  {
    name: 'kunde_anlegen',
    description: 'Legt eine neue Kundenakte an. Vorher mit kunden_suchen prüfen, dass es den Kunden noch nicht gibt. Der Bereich muss feststehen — im Zweifel den Mitarbeiter fragen.',
    input_schema: {
      type: 'object',
      properties: {
        bereich: { type: 'string', enum: NEUANLAGE_BEREICHE, description: 'beratung = Unternehmensberatung, immobilienkunden = Immobilien.' },
        name: { type: 'string', description: 'Firmenname, bei Privatpersonen der volle Name.' },
        ansprechpartner: { type: 'string' },
        email: { type: 'string' },
        telefon: { type: 'string' },
      },
      required: ['bereich', 'name'],
    },
  },
  {
    name: 'kunde_aendern',
    description: `Ändert Stammdaten, Status, Priorität oder Zuständigkeit eines Kunden. Nur die Felder angeben, die sich ändern. Gültige Status-Werte je Bereich:\n${STATUS_HINWEIS}`,
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string' },
        firma: { type: 'string' },
        ansprechpartner: { type: 'string' },
        email: { type: 'string' },
        telefon: { type: 'string' },
        prioritaet: { type: 'string', enum: ['Hoch', 'Mittel', 'Niedrig'] },
        verantwortlich: { type: 'string', description: 'Name eines Mitarbeiters.' },
        status: { type: 'string', description: 'Status-ID aus der Liste des jeweiligen Bereichs.' },
      },
      required: ['kunde_id'],
    },
  },
  {
    name: 'kunde_loeschen',
    description: 'Löscht eine Kundenakte unwiderruflich. Der erste Aufruf löscht nie, sondern verlangt eine ausdrückliche Bestätigung des Mitarbeiters in seiner nächsten Nachricht; erst der Aufruf danach löscht.',
    input_schema: { type: 'object', properties: { kunde_id: { type: 'string' } }, required: ['kunde_id'] },
  },
  {
    name: 'unzugeordnete_dateien',
    description: 'Listet per Telegram geschickte Dateien der letzten 30 Tage, die gespeichert, aber noch in keiner Akte abgelegt sind (neueste zuerst). Nutze das, wenn der Mitarbeiter sich auf früher geschickte Dateien oder Scans bezieht.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'dateien_ablegen',
    description: 'Legt gespeicherte Dateien in die Akte eines Kunden. Die pfad-Werte stammen aus einem Datei-Eingang oder aus unzugeordnete_dateien. Meldet das Werkzeug ein mögliches Duplikat, frag den Mitarbeiter und rufe es für diese Datei erneut mit bei_duplikat auf.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string' },
        dateien: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pfad: { type: 'string', description: 'Exakt wie angegeben, beginnt mit "telegram/".' },
              name: { type: 'string', description: 'Anzeigename in der Akte. Nur setzen, wenn der gespeicherte Name nichtssagend ist (z. B. foto_123.jpg) — dann einen sprechenden Namen mit Dateiendung.' },
              kategorie: { type: 'string', description: 'Art des Dokuments, z. B. Rechnung, Vertrag, Ausweis.' },
            },
            required: ['pfad'],
          },
        },
        bei_duplikat: { type: 'string', enum: ['kopie', 'ueberschreiben', 'ignorieren'], description: 'Nur nach Rückfrage beim Mitarbeiter setzen.' },
      },
      required: ['kunde_id', 'dateien'],
    },
  },
  {
    name: 'dokument_aus_akte_nehmen',
    description: 'Nimmt ein Dokument wieder aus einer Akte heraus (z. B. beim falschen Kunden abgelegt). Die Datei selbst bleibt gespeichert und kann danach mit dateien_ablegen woanders abgelegt werden. Die dokument_id steht in kundenakte_lesen.',
    input_schema: {
      type: 'object',
      properties: { kunde_id: { type: 'string' }, dokument_id: { type: 'string' } },
      required: ['kunde_id', 'dokument_id'],
    },
  },
  {
    name: 'firmenueberblick',
    description: 'Überblick über ALLE Kunden und Immobilien-Objekte (Status, Zuständigkeit, letzte Aktivität, Suchprofile) samt aller fälligen Follow-ups. Für Fragen, die nicht einen einzelnen Kunden betreffen ("was steht heute an", "welche Käufer suchen …", "wer ist im Status …").',
    input_schema: { type: 'object', properties: {} },
  },
]

// deno-lint-ignore no-explicit-any
async function fuehreWerkzeugAus(name: string, input: any, ctx: ToolKontext): Promise<string> {
  const { supabase, mitarbeiter, state } = ctx
  const heute = heuteBerlin()
  const protokolliere = (text: string) => state.aktionen.push({ z: new Date().toISOString(), text })

  if (name === 'kunden_suchen') {
    const { data } = await supabase.from('kunden').select(KUNDE_SPALTEN)
    const treffer = sucheKunden((data ?? []) as KundeRow[], String(input.suchbegriff ?? ''))
    if (treffer.length === 0) return 'Keine Treffer. Es gibt im CRM keinen Kunden, der dazu passt.'
    return JSON.stringify(
      treffer.map((k) => ({
        kunde_id: k.id,
        bereich: BEREICH_LABEL[k.bereich] ?? k.bereich,
        firma: k.firma,
        ansprechpartner: k.ansprechpartner,
        email: k.email,
        telefon: k.telefon,
        status: STATUS_JE_BEREICH[k.bereich]?.[k.status ?? ''] ?? k.status,
      })),
    )
  }

  if (name === 'kundenakte_lesen') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const { data: protokolle } = await supabase
      .from('protokolle')
      .select('datum, betreff, teilnehmer, text, ki_zusammenfassung')
      .eq('bereich', k.bereich)
      .eq('kunde_id', k.id)
      .order('datum', { ascending: false })
      .limit(8)
    const fehlend = [!k.telefon && 'Telefon', !k.email && 'E-Mail', !k.ansprechpartner && 'Ansprechpartner', !k.verantwortlich && 'Verantwortlich'].filter(Boolean)
    const fu = k.follow_up
    return kuerze(
      [
        `Kunde: ${k.firma} | Ansprechpartner: ${k.ansprechpartner || '—'} | Bereich: ${BEREICH_LABEL[k.bereich] ?? k.bereich} (${k.bereich})`,
        `E-Mail: ${k.email || '—'} | Telefon: ${k.telefon || '—'} | Verantwortlich: ${k.verantwortlich || '—'} | Priorität: ${k.prioritaet || '—'}`,
        `Status: ${k.status ?? '—'} (${STATUS_JE_BEREICH[k.bereich]?.[k.status ?? ''] ?? 'unbekannt'})`,
        `Follow-up: ${fu?.note ? `${fu.note} — fällig ${deDatum(fu.date)}${fu.done ? ' (erledigt)' : ''}` : 'keines'}`,
        `Fehlende Stammdaten: ${fehlend.length > 0 ? fehlend.join(', ') : 'keine'}`,
        '',
        `Dokumente (${(k.dokumente ?? []).length}):`,
        ...((k.dokumente ?? []).length > 0 ? (k.dokumente ?? []).map((d) => `- ${d.name} (${deDatum(d.datum)}, ${d.groesse}) [dokument_id=${d.id}]`) : ['(keine)']),
        '',
        'Aktivitäten/Notizen (neueste zuerst):',
        ...((k.activities ?? []).length > 0
          ? (k.activities ?? []).slice(0, 30).map((a) => `- ${deDatum(a.date)} ${a.user}: ${a.text} [aktivitaet_id=${a.id}]`)
          : ['(keine)']),
        '',
        'Gesprächsprotokolle (neueste zuerst):',
        ...((protokolle ?? []).length > 0
          // deno-lint-ignore no-explicit-any
          ? (protokolle ?? []).map((p: any) => `- ${deDatum(p.datum)} „${p.betreff}" (Teilnehmer: ${p.teilnehmer}): ${kuerze(String(p.ki_zusammenfassung ?? p.text ?? ''), 900)}`)
          : ['(keine)']),
      ].join('\n'),
      14000,
    )
  }

  if (name === 'notiz_speichern') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const text = String(input.text ?? '').trim()
    if (!text) return 'Fehler: leerer Notiztext.'
    const { error } = await supabase
      .from('kunden')
      .update({ activities: [{ id: crypto.randomUUID(), date: heute, text, user: mitarbeiter.name }, ...(k.activities ?? [])], letzte_aktivitaet: heute })
      .eq('id', k.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`Notiz bei ${kundeName(k)} gespeichert: „${kuerze(text, 120)}"`)
    return `Notiz bei ${kundeName(k)} gespeichert.`
  }

  if (name === 'aufgabe_setzen') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    if (input.erledigt === true) {
      if (!k.follow_up?.note) return `${kundeName(k)} hat kein offenes Follow-up.`
      const { error } = await supabase
        .from('kunden')
        .update({
          follow_up: { ...k.follow_up, done: true },
          activities: [{ id: crypto.randomUUID(), date: heute, text: `Follow-up erledigt: „${k.follow_up.note}"`, user: mitarbeiter.name }, ...(k.activities ?? [])],
          letzte_aktivitaet: heute,
        })
        .eq('id', k.id)
      if (error) return `Fehler beim Speichern: ${error.message}`
      protokolliere(`Follow-up bei ${kundeName(k)} abgehakt: „${k.follow_up.note}"`)
      return `Follow-up „${k.follow_up.note}" bei ${kundeName(k)} als erledigt markiert.`
    }
    const titel = String(input.titel ?? '').trim()
    if (!titel) return 'Fehler: titel fehlt.'
    const faellig = /^\d{4}-\d{2}-\d{2}$/.test(String(input.faellig_am ?? '')) ? String(input.faellig_am) : heute
    const ersetzt = k.follow_up?.note && !k.follow_up.done ? ` Das bisherige offene Follow-up „${k.follow_up.note}" wurde damit ersetzt.` : ''
    const { error } = await supabase
      .from('kunden')
      .update({
        follow_up: { date: faellig, note: titel, done: false },
        activities: [{ id: crypto.randomUUID(), date: heute, text: `Aufgabe gesetzt: „${titel}" (fällig ${deDatum(faellig)})`, user: mitarbeiter.name }, ...(k.activities ?? [])],
        letzte_aktivitaet: heute,
      })
      .eq('id', k.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`Aufgabe bei ${kundeName(k)} gesetzt: „${titel}" (fällig ${deDatum(faellig)})`)
    return `Aufgabe „${titel}" bei ${kundeName(k)} gesetzt, fällig ${deDatum(faellig)}.${ersetzt}`
  }

  if (name === 'aktivitaet_aendern') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const eintrag = (k.activities ?? []).find((a) => a.id === input.aktivitaet_id)
    if (!eintrag) return 'Fehler: Diesen Eintrag gibt es in der Akte nicht. Lies die Akte neu (kundenakte_lesen).'
    const neuerText = String(input.neuer_text ?? '').trim()
    if (input.loeschen !== true && !neuerText) return 'Fehler: neuer_text oder loeschen=true angeben.'
    const activities = input.loeschen === true
      ? (k.activities ?? []).filter((a) => a.id !== eintrag.id)
      : (k.activities ?? []).map((a) => (a.id === eintrag.id ? { ...a, text: neuerText } : a))
    const { error } = await supabase.from('kunden').update({ activities }).eq('id', k.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    const was = input.loeschen === true ? 'gelöscht' : 'geändert'
    protokolliere(`Eintrag bei ${kundeName(k)} ${was}: „${kuerze(eintrag.text, 100)}"`)
    return `Eintrag „${kuerze(eintrag.text, 100)}" bei ${kundeName(k)} ${was}.`
  }

  if (name === 'kunde_anlegen') {
    const bereich = String(input.bereich ?? '')
    const firma = String(input.name ?? '').trim()
    if (!NEUANLAGE_BEREICHE.includes(bereich)) return `Fehler: ungültiger Bereich. Erlaubt: ${NEUANLAGE_BEREICHE.join(', ')}.`
    if (!firma) return 'Fehler: name fehlt.'
    const { data: alle } = await supabase.from('kunden').select(KUNDE_SPALTEN)
    const email = String(input.email ?? '').trim()
    const doppelt = ((alle ?? []) as KundeRow[]).find(
      (k) => norm(k.firma) === norm(firma) || (email && norm(k.email) === norm(email)),
    )
    if (doppelt) return `Nicht angelegt: Es gibt bereits ${kundeName(doppelt)} im Bereich ${BEREICH_LABEL[doppelt.bereich] ?? doppelt.bereich} (kunde_id=${doppelt.id}).`
    const id = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const { error } = await supabase.from('kunden').insert({
      id,
      bereich,
      firma,
      ansprechpartner: String(input.ansprechpartner ?? '').trim() || firma,
      email,
      telefon: String(input.telefon ?? '').trim(),
      prioritaet: 'Mittel',
      status: START_STATUS[bereich],
      follow_up: { date: heute, note: 'Erstkontakt aufnehmen', done: false },
      verantwortlich: mitarbeiter.name,
      letzte_aktivitaet: heute,
      activities: [{ id: crypto.randomUUID(), date: heute, text: `Akte per Telegram von ${mitarbeiter.name} angelegt.`, user: mitarbeiter.name }],
      dokumente: [],
    })
    if (error) return `Fehler beim Anlegen: ${error.message}`
    protokolliere(`Kunde ${firma} im Bereich ${BEREICH_LABEL[bereich]} angelegt (kunde_id=${id})`)
    return `Angelegt: ${firma}, Bereich ${BEREICH_LABEL[bereich]}, Status „${STATUS_JE_BEREICH[bereich][START_STATUS[bereich]]}", verantwortlich ${mitarbeiter.name}. kunde_id=${id}`
  }

  if (name === 'kunde_aendern') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const patch: Record<string, unknown> = {}
    const geaendert: string[] = []
    for (const feld of ['firma', 'ansprechpartner', 'email', 'telefon'] as const) {
      if (typeof input[feld] === 'string') {
        patch[feld] = input[feld].trim()
        geaendert.push(`${feld}: ${input[feld].trim() || '(leer)'}`)
      }
    }
    if (typeof input.prioritaet === 'string') {
      if (!['Hoch', 'Mittel', 'Niedrig'].includes(input.prioritaet)) return 'Fehler: prioritaet muss Hoch, Mittel oder Niedrig sein.'
      patch.prioritaet = input.prioritaet
      geaendert.push(`Priorität: ${input.prioritaet}`)
    }
    if (typeof input.verantwortlich === 'string') {
      const { data: team } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
      const namen = ((team ?? []) as { name: string }[]).map((m) => m.name)
      const treffer = namen.find((n) => norm(n) === norm(input.verantwortlich)) ?? namen.find((n) => norm(n).includes(norm(input.verantwortlich)))
      if (!treffer) return `Fehler: „${input.verantwortlich}" ist kein aktiver Mitarbeiter. Möglich: ${namen.join(', ')}.`
      patch.verantwortlich = treffer
      geaendert.push(`verantwortlich: ${treffer}`)
    }
    if (typeof input.status === 'string') {
      const erlaubt = STATUS_JE_BEREICH[k.bereich] ?? {}
      if (!erlaubt[input.status]) return `Fehler: ungültiger Status für ${k.bereich}. Erlaubt: ${Object.entries(erlaubt).map(([id, l]) => `${id} (${l})`).join(', ')}.`
      patch.status = input.status
      geaendert.push(`Status: ${erlaubt[input.status]}`)
    }
    if (geaendert.length === 0) return 'Fehler: kein Feld zum Ändern angegeben.'
    patch.activities = [{ id: crypto.randomUUID(), date: heute, text: `Per Telegram geändert — ${geaendert.join('; ')}`, user: mitarbeiter.name }, ...(k.activities ?? [])]
    patch.letzte_aktivitaet = heute
    const { error } = await supabase.from('kunden').update(patch).eq('id', k.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`${kundeName(k)} geändert — ${geaendert.join('; ')}`)
    return `Bei ${kundeName(k)} geändert — ${geaendert.join('; ')}.`
  }

  if (name === 'kunde_loeschen') {
    if (!(mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin)) return 'Nicht erlaubt: Kunden löschen darf nur Geschäftsführung/Admin.'
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const anfrage = ctx.vorherigeLoeschAnfrage
    const bestaetigbar = anfrage?.kunde_id === k.id && Date.now() - new Date(anfrage.z).getTime() < 10 * 60 * 1000
    if (!bestaetigbar) {
      state.loesch_anfrage = { kunde_id: k.id, name: kundeName(k), z: new Date().toISOString() }
      return `NOCH NICHT GELÖSCHT. Frage den Mitarbeiter jetzt ausdrücklich, ob ${kundeName(k)} (Bereich ${BEREICH_LABEL[k.bereich] ?? k.bereich}, ${(k.dokumente ?? []).length} Dokumente, ${(k.activities ?? []).length} Einträge) unwiderruflich gelöscht werden soll. Nur wenn er das in seiner nächsten Nachricht klar bestätigt, rufe kunde_loeschen erneut auf.`
    }
    const { error } = await supabase.from('kunden').delete().eq('id', k.id)
    if (error) return `Fehler beim Löschen: ${error.message}`
    protokolliere(`Kunde ${kundeName(k)} gelöscht`)
    return `Gelöscht: ${kundeName(k)}.`
  }

  if (name === 'unzugeordnete_dateien') {
    const [dateien, referenzen] = await Promise.all([listeOrdner(supabase), ladeReferenzen(supabase)])
    const grenze = Date.now() - 30 * 24 * 60 * 60 * 1000
    const offen = dateien
      .filter((d) => !referenzen.text.includes(`/${BUCKET}/${ORDNER}/${d.name}`))
      .filter((d) => !d.created_at || new Date(d.created_at).getTime() > grenze)
      .slice(0, 40)
    if (offen.length === 0) return 'Es gibt keine gespeicherten Dateien, die noch keiner Akte zugeordnet sind.'
    return offen
      .map((d, i) => {
        const wann = d.created_at ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d.created_at)) : '?'
        return `${i + 1}. pfad=${ORDNER}/${d.name} | Name: ${anzeigeName(d.name)} | hochgeladen ${wann} | ${formatGroesse(d.metadata?.size ?? 0)}`
      })
      .join('\n')
  }

  if (name === 'dateien_ablegen') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    // deno-lint-ignore no-explicit-any
    const gewuenscht: any[] = Array.isArray(input.dateien) ? input.dateien : []
    if (gewuenscht.length === 0) return 'Fehler: keine Dateien angegeben.'
    const [ordner, referenzen] = await Promise.all([listeOrdner(supabase), ladeReferenzen(supabase)])
    const imOrdner = new Map(ordner.map((d) => [d.name, d]))
    let dokumente = [...(k.dokumente ?? [])]
    const abgelegt: string[] = []
    const meldungen: string[] = []
    for (const g of gewuenscht) {
      const pfad = String(g?.pfad ?? '')
      const dateiName = pfad.startsWith(`${ORDNER}/`) ? pfad.slice(ORDNER.length + 1) : ''
      const datei = imOrdner.get(dateiName)
      if (!datei) {
        meldungen.push(`„${pfad}": Diese Datei gibt es in der Ablage nicht (pfad exakt übernehmen).`)
        continue
      }
      const url = supabase.storage.from(BUCKET).getPublicUrl(pfad).data.publicUrl
      const name = String(g?.name ?? '').trim() || anzeigeName(dateiName)
      if (dokumente.some((d) => d.url === url)) {
        meldungen.push(`„${name}": liegt bereits in dieser Akte.`)
        continue
      }
      const andererKunde = referenzen.kunden.find((x) => x.id !== k.id && (x.dokumente ?? []).some((d) => d.url === url))
      if (andererKunde) {
        meldungen.push(`„${name}": liegt bereits in der Akte von ${kundeName(andererKunde)} (kunde_id=${andererKunde.id}) — dort zuerst mit dokument_aus_akte_nehmen herausnehmen, falls es umziehen soll.`)
        continue
      }
      const neu: Dokument = {
        id: crypto.randomUUID(),
        name,
        typ: datei.metadata?.mimetype ?? 'application/octet-stream',
        datum: heute,
        groesse: formatGroesse(datei.metadata?.size ?? 0),
        url,
      }
      const duplikat = dokumente.find((d) => norm(d.name) === norm(name))
      if (duplikat && !input.bei_duplikat) {
        meldungen.push(`„${name}": NICHT abgelegt — in der Akte gibt es schon ein Dokument mit diesem Namen (vom ${deDatum(duplikat.datum)}). Frag den Mitarbeiter: überschreiben, als Kopie ablegen oder weglassen?`)
        continue
      }
      if (duplikat && input.bei_duplikat === 'ignorieren') {
        meldungen.push(`„${name}": weggelassen, das vorhandene Dokument bleibt.`)
        continue
      }
      if (duplikat && input.bei_duplikat === 'ueberschreiben') {
        dokumente = dokumente.map((d) => (d.id === duplikat.id ? { ...neu, id: d.id } : d))
        abgelegt.push(`${name} (vorhandenes ersetzt)`)
        continue
      }
      dokumente = [duplikat ? { ...neu, name: name.replace(/(\.[a-z0-9]+)?$/i, ' (2)$1') } : neu, ...dokumente]
      abgelegt.push(`${name}${g?.kategorie ? ` — ${g.kategorie}` : ''}`)
    }
    if (abgelegt.length > 0) {
      const { error } = await supabase
        .from('kunden')
        .update({
          dokumente,
          activities: [
            { id: crypto.randomUUID(), date: heute, text: `Per Telegram von ${mitarbeiter.name} abgelegt: ${abgelegt.map((n) => `„${n}"`).join(', ')}`, user: mitarbeiter.name },
            ...(k.activities ?? []),
          ],
          letzte_aktivitaet: heute,
        })
        .eq('id', k.id)
      if (error) return `Fehler beim Speichern: ${error.message}. Nichts wurde abgelegt.`
      protokolliere(`${abgelegt.length} Datei(en) bei ${kundeName(k)} abgelegt: ${abgelegt.join(', ')}`)
    }
    return [
      abgelegt.length > 0 ? `In der Akte von ${kundeName(k)} abgelegt (${abgelegt.length}): ${abgelegt.join(', ')}.` : `Nichts in der Akte von ${kundeName(k)} abgelegt.`,
      ...meldungen,
    ].join('\n')
  }

  if (name === 'dokument_aus_akte_nehmen') {
    const k = await ladeKunde(supabase, input.kunde_id)
    if (!k) return KEIN_KUNDE
    const dok = (k.dokumente ?? []).find((d) => d.id === input.dokument_id)
    if (!dok) return 'Fehler: Dieses Dokument gibt es in der Akte nicht. Lies die Akte neu (kundenakte_lesen).'
    const { error } = await supabase
      .from('kunden')
      .update({
        dokumente: (k.dokumente ?? []).filter((d) => d.id !== dok.id),
        activities: [{ id: crypto.randomUUID(), date: heute, text: `Dokument per Telegram aus der Akte genommen: „${dok.name}"`, user: mitarbeiter.name }, ...(k.activities ?? [])],
      })
      .eq('id', k.id)
    if (error) return `Fehler beim Speichern: ${error.message}`
    protokolliere(`Dokument „${dok.name}" aus der Akte von ${kundeName(k)} genommen`)
    const marker = `/${BUCKET}/${ORDNER}/`
    const pfad = dok.url.includes(marker) ? `${ORDNER}/${dok.url.split(marker)[1]}` : null
    return `„${dok.name}" aus der Akte von ${kundeName(k)} genommen.${pfad ? ` Die Datei bleibt gespeichert: pfad=${pfad}` : ' Die Datei stammt nicht aus Telegram und kann hier nicht neu zugeordnet werden.'}`
  }

  if (name === 'firmenueberblick') {
    const [{ data: kunden }, { data: objekte }] = await Promise.all([
      supabase.from('kunden').select('bereich, firma, ansprechpartner, status, verantwortlich, letzte_aktivitaet, follow_up, kaeuferprofil'),
      supabase.from('objekte').select('bezeichnung, adresse, typ, status, verantwortlich, eigentuemer'),
    ])
    const zeilen: string[] = [`Heute: ${deDatum(heute)}`, '', 'FÄLLIGE UND ÜBERFÄLLIGE FOLLOW-UPS:']
    // deno-lint-ignore no-explicit-any
    const faellig = ((kunden ?? []) as any[])
      .filter((k) => k.follow_up?.note && !k.follow_up.done && k.follow_up.date <= heute)
      .sort((a, b) => String(a.follow_up.date).localeCompare(String(b.follow_up.date)))
    zeilen.push(...(faellig.length > 0 ? faellig.map((k) => `- ${k.firma}: ${k.follow_up.note} — fällig ${deDatum(k.follow_up.date)} (verantwortlich: ${k.verantwortlich || '—'})`) : ['(keine)']))
    zeilen.push('', 'KUNDEN / MANDANTEN:')
    // deno-lint-ignore no-explicit-any
    for (const k of (kunden ?? []) as any[]) {
      const teile = [
        `${k.firma}${k.ansprechpartner && k.ansprechpartner !== k.firma ? ` (${k.ansprechpartner})` : ''}`,
        BEREICH_LABEL[k.bereich] ?? k.bereich,
        `Status: ${STATUS_JE_BEREICH[k.bereich]?.[k.status] ?? k.status}`,
        `Verantwortlich: ${k.verantwortlich || '—'}`,
        `Letzte Aktivität: ${deDatum(k.letzte_aktivitaet)}`,
      ]
      if (k.kaeuferprofil) {
        const kp = k.kaeuferprofil
        teile.push(`Suchprofil: ${(kp.objekttypen ?? []).join('/') || 'beliebig'}, Budget ${kp.budgetMin ?? '?'}–${kp.budgetMax ?? '?'} €, Lage „${kp.bevorzugteLage || 'offen'}"`)
      }
      zeilen.push(`- ${teile.join(' · ')}`)
    }
    zeilen.push('', 'IMMOBILIEN-OBJEKTE:')
    // deno-lint-ignore no-explicit-any
    for (const o of (objekte ?? []) as any[]) {
      zeilen.push(`- ${o.bezeichnung} (${o.adresse}) · Typ: ${o.typ} · Status: ${o.status} · Verantwortlich: ${o.verantwortlich || '—'}${o.eigentuemer?.name ? ` · Eigentümer: ${o.eigentuemer.name}` : ''}`)
    }
    return kuerze(zeilen.join('\n'), 40000)
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}

// ---------- Der Assistent ----------

const SYSTEM_PROMPT = `Du bist der Assistent der Andreas Mayer Holding (Ulm) im Telegram-Chat mit einem Mitarbeiter. Du arbeitest direkt im CRM der Holding: Du schlägst Kundenakten nach und beantwortest Fragen dazu, legst Kunden an und änderst sie, setzt Notizen und Aufgaben und legst per Telegram geschickte Dateien in die richtige Akte.

So arbeitest du:
- Du führst ein normales Gespräch und erledigst, worum man dich bittet. Will jemand etwas wissen, schlägst du es mit deinen Werkzeugen nach und antwortest. Will jemand etwas erledigt haben, erledigst du es mit deinen Werkzeugen und sagst danach genau, was du getan hast.
- Speichere eine Notiz oder Aufgabe NUR, wenn der Mitarbeiter ausdrücklich etwas festhalten oder sich etwas vormerken will. Eine Bitte wie "leg die Dateien in seine Akte" ist ein Auftrag an dich und keine Aufgabe für später: führe ihn aus. Eine Ankündigung wie "ich schicke dir gleich Scans für Kunde X" beantwortest du kurz und merkst dir den Kunden für die folgenden Dateien; du speicherst dafür nichts.
- Behaupte nie, etwas erledigt zu haben, was kein Werkzeug bestätigt hat. Meldet ein Werkzeug einen Fehler oder kannst du etwas nicht, sag das offen und was stattdessen geht.
- Erfinde nichts. Was nicht in Werkzeug-Ergebnissen oder im Gespräch steht, weißt du nicht. Ob es einen Kunden gibt oder nicht, sagst du erst, nachdem du mit kunden_suchen nachgesehen hast.
- Die Bereiche der Holding heißen: Unternehmensberatung, Immobilien, Erben, Betriebsübergabe, Betriebsformen, Akademie, Finanzierungen. Verwende im Gespräch diese Namen.
- Beziehe "er", "sie", "ihm", "seine Akte" auf den Kunden, um den es im Gespräch zuletzt ging. Ist nicht eindeutig, welcher Kunde gemeint ist (mehrere Treffer, kein Treffer, kein Bezug), frag kurz nach, statt zu raten. Lege niemals etwas bei einem Kunden ab, der nur vielleicht gemeint ist.
- Gibt es einen Kunden noch nicht, sag das und biete an, ihn anzulegen. Frag nach dem Bereich, wenn er nicht klar ist. Sagt der Mitarbeiter klar, dass und wo er angelegt werden soll, leg ihn an.
- Dateien: Jede geschickte Datei ist bereits sicher gespeichert, bevor du davon erfährst. Eine Nachricht, die mit "[Datei-Eingang" beginnt, kommt vom System und beschreibt, was angekommen ist. Lege die Dateien mit dateien_ablegen ab, sobald klar ist, wohin sie gehören: durch die Bildunterschrift, durch das bisherige Gespräch oder durch einen im Dokument erkannten Namen, zu dem kunden_suchen genau einen passenden Kunden liefert. Sonst frag nach und sag dazu, dass die Dateien gespeichert sind. Früher geschickte, noch nicht abgelegte Dateien findest du mit unzugeordnete_dateien.
- Sammel-Scans: Schickt der Mitarbeiter eine mehrseitige PDF (z. B. einen ganzen Ordner auf einmal gescannt), zerlegt das System sie beim Eingang automatisch in Einzeldokumente, benennt sie und speichert sie. Du bekommst die fertigen Einzeldokumente im Datei-Eingang und legst sie ab. Aufteilen und Ablegen von Scans kannst du also zusagen. Nur eine schon gespeicherte Datei nachträglich zerlegen geht nicht; dafür muss sie noch einmal geschickt werden.
- Deine Grenzen: Du siehst von Dokumenten Name, Art und das erkannte Datum, aber nicht den vollen Inhalt. Sprachnachrichten kannst du noch nicht verarbeiten.
- Meldet dateien_ablegen ein mögliches Duplikat, frag den Mitarbeiter, ob du überschreiben, als Kopie ablegen oder weglassen sollst.
- Kunden löschen: nur auf ausdrücklichen Wunsch und erst nach Bestätigung in einer eigenen Nachricht.
- Für Fragen quer über alle Kunden oder Objekte ("was steht heute an", "wer sucht ...") nutze firmenueberblick.

Ton und Form:
- Deutsch, per Du, knapp und konkret wie ein guter Kollege. Keine Floskeln, keine englischen Begriffe.
- Reiner Text ohne Markdown: keine Sternchen, keine Rauten, keine Tabellen. Aufzählungen als einfache Zeilen mit "- ".
- Zähle nicht auf, was du alles nicht getan oder nicht gespeichert hast, solange niemand danach fragt.
- Nenne bei jeder Änderung, bei welchem Kunden du was genau getan hast. Nenne keine internen IDs oder Dateipfade, außer der Mitarbeiter fragt danach.`

// deno-lint-ignore no-explicit-any
async function claude(system: unknown[], messages: unknown[]): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: AGENT_MODEL, max_tokens: 2000, system, tools: TOOLS, messages }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`KI-Dienst antwortet mit ${res.status}: ${data?.error?.message ?? 'unbekannter Fehler'}`)
  return data
}

// Ein Gesprächszug: bekommt die neue Nachricht (oder einen Datei-Eingang), arbeitet mit Werkzeugen,
// bis eine Antwort feststeht, und schreibt Verlauf und Aktionsprotokoll in den übergebenen Zustand.
export async function agentAntwort(supabase: Supa, mitarbeiter: Mitarbeiter, state: AgentState, eingang: string): Promise<string> {
  const ctx: ToolKontext = { supabase, mitarbeiter, state, vorherigeLoeschAnfrage: state.loesch_anfrage }
  state.loesch_anfrage = undefined // gilt nur für die direkt folgende Nachricht

  const neu: Nachricht[] = [{ role: 'user', content: eingang }]
  const messages = (): Nachricht[] => [...state.zuege.flatMap((zug) => zug.msgs), ...neu]

  const wochentag = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long' }).format(new Date())
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: [
        `Heute ist ${wochentag}, der ${deDatum(heuteBerlin())} (${heuteBerlin()}).`,
        `Du schreibst mit ${mitarbeiter.name}${mitarbeiter.rolle === 'geschaeftsfuehrung' ? ' (Geschäftsführung)' : ''}.`,
        state.aktionen.length > 0
          ? `Was du in diesem Chat zuletzt im CRM getan hast (älteste zuerst):\n${state.aktionen.slice(-10).map((a) => `- ${a.text}`).join('\n')}`
          : 'Du hast in diesem Chat bisher noch nichts im CRM verändert.',
      ].join('\n'),
    },
  ]

  let antwort = ''
  for (let schritt = 0; schritt < 12; schritt++) {
    const data = await claude(system, messages())
    // deno-lint-ignore no-explicit-any
    const bloecke: any[] = data.content ?? []
    if (data.stop_reason !== 'tool_use') {
      antwort = bloecke.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      break
    }
    neu.push({ role: 'assistant', content: bloecke })
    const ergebnisse = []
    for (const b of bloecke.filter((x) => x.type === 'tool_use')) {
      let ergebnis: string
      try {
        ergebnis = await fuehreWerkzeugAus(b.name, b.input ?? {}, ctx)
      } catch (err) {
        console.error(`Werkzeug ${b.name} fehlgeschlagen:`, err)
        ergebnis = `Fehler im Werkzeug: ${err instanceof Error ? err.message : String(err)}`
      }
      ergebnisse.push({ type: 'tool_result', tool_use_id: b.id, content: ergebnis })
    }
    neu.push({ role: 'user', content: ergebnisse })
  }
  if (!antwort) antwort = 'Ich bin damit nicht fertig geworden. Sag mir bitte noch einmal in einem Satz, was ich tun soll.'

  neu.push({ role: 'assistant', content: antwort })
  state.zuege = [...state.zuege, { z: new Date().toISOString(), msgs: fuerVerlauf(neu) }].slice(-10)
  while (state.zuege.length > 1 && JSON.stringify(state.zuege).length > 60000) state.zuege.shift()
  state.aktionen = state.aktionen.slice(-12)
  return antwort
}

// deno-lint-ignore no-explicit-any
async function verarbeiteUpdate(update: any): Promise<void> {
  const message = update?.message
  if (!message?.chat?.id) return
  const chatId: number = message.chat.id
  const text: string | undefined = message.text?.trim()
  const supabase = supa()

  // --- Verknüpfung über /start <code> (aus "Mein Profil" generiert) ---
  if (text?.startsWith('/start')) {
    const code = text.split(/\s+/)[1]?.trim()
    if (!code) {
      await sendTelegramMessage(chatId, 'Willkommen beim Assistenten der Mayer Holding! Bitte nutze den Verknüpfungs-Link aus "Mein Profil" im CRM, um deinen Zugang zu verbinden.')
      return
    }
    const { data: kandidat } = await supabase.from('mitarbeiter').select('id, name').eq('telegram_link_code', code).eq('aktiv', true).maybeSingle()
    if (!kandidat) {
      await sendTelegramMessage(chatId, 'Dieser Verknüpfungs-Code ist ungültig oder abgelaufen. Erzeug dir in "Mein Profil" im CRM einen neuen Link.')
      return
    }
    await supabase.from('mitarbeiter').update({ telegram_chat_id: chatId, telegram_link_code: null }).eq('id', kandidat.id)
    await sendTelegramMessage(chatId, `Verbunden! Du bist jetzt als ${kandidat.name} mit dem CRM verknüpft. Schreib mir einfach, was du brauchst: Fragen zu Kunden, Akten anlegen oder ändern, Notizen, Aufgaben. Dateien und Scans kannst du mir direkt schicken, ich lege sie in die richtige Akte.`)
    return
  }

  const { data: mitarbeiter } = await supabase
    .from('mitarbeiter')
    .select('id, name, aktiv, rolle, ist_admin, telegram_pending')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()
  if (!mitarbeiter || !mitarbeiter.aktiv) {
    await sendTelegramMessage(chatId, 'Dieser Chat ist noch nicht mit einem CRM-Zugang verknüpft. Geh in "Mein Profil" im CRM und folge dem Verknüpfungs-Link.')
    return
  }

  if (message.voice) {
    await sendTelegramMessage(chatId, 'Sprachnachrichten kann ich hier noch nicht verarbeiten — bitte vorerst als Text schreiben.')
    return
  }

  await sendeTippen(chatId)
  let eingang: string
  if (message.photo || message.document) {
    eingang = await verarbeiteDateiEingang(supabase, message)
  } else if (text) {
    eingang = text
  } else {
    await sendTelegramMessage(chatId, 'Ich kann Text, Fotos und Dokumente verarbeiten.')
    return
  }

  const state = ladeState(mitarbeiter.telegram_pending)
  let antwort: string
  try {
    antwort = await agentAntwort(supabase, mitarbeiter, state, eingang)
  } catch (err) {
    console.error('Assistent fehlgeschlagen:', err)
    const dateiHinweis = message.photo || message.document ? ' Deine Datei ist trotzdem gespeichert.' : ''
    await sendTelegramMessage(chatId, `Da ist gerade etwas schiefgelaufen (${err instanceof Error ? err.message : 'unbekannter Fehler'}).${dateiHinweis} Versuch es bitte gleich noch einmal.`)
    return
  }
  await supabase.from('mitarbeiter').update({ telegram_pending: state }).eq('id', mitarbeiter.id)
  await sendTelegramMessage(chatId, antwort)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const update = await req.json().catch(() => null)
  const arbeit = verarbeiteUpdate(update).catch((err) => console.error('Update-Verarbeitung fehlgeschlagen:', err))
  // Sofort antworten und im Hintergrund weiterarbeiten: Telegram wiederholt einen Webhook, der zu
  // lange braucht (Sammel-Scans, mehrere Werkzeug-Schritte) — das hätte doppelte Ablagen zur Folge.
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(arbeit)
  else await arbeit
  return new Response('ok')
})
