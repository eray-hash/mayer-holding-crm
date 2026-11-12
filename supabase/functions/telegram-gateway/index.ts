// Edge Function "telegram-gateway" — Telegram als zusätzlicher Kanal für denselben KI-Assistenten,
// den es im CRM-Web-Chat schon gibt (siehe KiAssistentPanel.tsx). Mitarbeiter schreiben dem CRM-Bot
// in ihrem eigenen, normalen Telegram ganz normal — dieselbe Klassifizierung/Beantwortung läuft über
// die bereits bestehenden Actions in email-gateway (assistant_classify/assistant_answer), nur dass
// hier serverseitig dieselbe Kunden-Zuordnung und das Schreiben von Notizen/Aufgaben nachgebaut wird,
// die im Web normalerweise der Browser (React-State) übernimmt — ein Telegram-Webhook hat ja kein
// offenes CRM im Browser, auf dessen State er zugreifen könnte.
//
// Setup (einmalig):
//   1. Secrets TELEGRAM_BOT_TOKEN und TELEGRAM_WEBHOOK_SECRET sind bereits gesetzt.
//   2. Nach dem Deploy: setWebhook bei Telegram registrieren (einmaliger Aufruf, siehe unten im
//      Projekt-Chat dokumentiert) mit secret_token = TELEGRAM_WEBHOOK_SECRET.
//   3. Mitarbeiter verknüpfen sich selbst über "Mein Profil" (erzeugt einen Code, den sie per
//      /start <code> an den Bot schicken) — siehe self_register-ähnliches Muster in email-gateway.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRM_SHARED_SECRET = Deno.env.get('CRM_SHARED_SECRET')

function supa() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

// Delegiert die eigentlichen LLM-Aufrufe an die schon bestehenden Actions in email-gateway, statt
// dieselben Claude-Prompts hier zu duplizieren — eine Quelle der Wahrheit für die KI-Logik, egal ob
// Web-Chat oder Telegram sie aufruft.
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

// ---------- Kunden-Zuordnung (Port von src/lib/matchKunde.ts, siehe dort für die Begründung der
// Einzelfälle — muss inhaltlich mit der Web-Variante übereinstimmen, da Mitarbeiter denselben
// Assistenten über zwei Kanäle nutzen) ----------

const FUELLWOERTER = new Set([
  'bei', 'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'war', 'wie', 'was', 'wer', 'wen',
  'wem', 'für', 'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'hat', 'hab', 'sein', 'ihr',
  'ihre', 'dein', 'deine', 'mein', 'meine', 'noch', 'nach', 'vor', 'über', 'unter', 'nur', 'auch',
  'kein', 'keine', 'man', 'wir', 'ich', 'du', 'sie', 'wird', 'werden', 'kann', 'soll', 'will',
])

function woerter(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüß]{3,}/g) ?? []).filter((w) => !FUELLWOERTER.has(w))
}

type KundeRow = {
  id: string
  bereich: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string | null
  status: string | null
  follow_up: { date: string; note: string; done: boolean } | null
  activities: { id: string; date: string; text: string; user: string }[] | null
  dokumente: { id: string; name: string; typ: string; datum: string; groesse: string; url: string }[] | null
}

type KundeMatch = { kunde: KundeRow; score: number }

function matchKandidaten(kunden: KundeRow[], text: string): KundeMatch[] {
  const tokens = woerter(text)
  if (tokens.length === 0) return []
  let bestScore = 0
  let beste: KundeMatch[] = []
  for (const k of kunden) {
    const ansprechpartnerWoerter = woerter(k.ansprechpartner)
    const haystackWoerter = new Set(woerter(`${k.firma} ${k.ansprechpartner} ${k.email}`))
    const score = tokens.filter((t) => haystackWoerter.has(t)).length
    if (score === 0) continue
    const matchedWoerter = new Set(tokens.filter((t) => haystackWoerter.has(t)))
    const nurVorname =
      ansprechpartnerWoerter.length > 1 &&
      matchedWoerter.size === 1 &&
      matchedWoerter.has(ansprechpartnerWoerter[0]) &&
      !ansprechpartnerWoerter.slice(1).some((w) => matchedWoerter.has(w))
    if (nurVorname) continue
    if (score > bestScore) {
      bestScore = score
      beste = [{ kunde: k, score }]
    } else if (score === bestScore) {
      beste.push({ kunde: k, score })
    }
  }
  return beste
}

// ---------- Datei-Download von Telegram, Upload in denselben Storage-Bucket wie E-Mail-Anhänge ----------

function sicheresPfadsegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_')
}

// btoa auf das gesamte Array gespreizt würde bei großen Scans (mehrere MB) den Call-Stack sprengen —
// deshalb in 32-KB-Blöcken.
function bytesZuBase64(bytes: Uint8Array): string {
  let binaer = ''
  const blockgroesse = 0x8000
  for (let i = 0; i < bytes.length; i += blockgroesse) {
    binaer += String.fromCharCode(...bytes.subarray(i, i + blockgroesse))
  }
  return btoa(binaer)
}

async function telegramDateiHerunterladen(fileId: string): Promise<{ bytes: Uint8Array; telegramPfad: string } | null> {
  const metaRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const meta = await metaRes.json()
  if (!meta.ok) return null
  const telegramPfad = meta.result.file_path as string
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${telegramPfad}`)
  if (!fileRes.ok) return null
  return { bytes: new Uint8Array(await fileRes.arrayBuffer()), telegramPfad }
}

// ---------- Sammel-Scan aufteilen (ein ganzer Aktenordner auf einmal gescannt und geschickt) ----------

async function pdfSeitenzahl(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes)
    return doc.getPageCount()
  } catch {
    return null // z.B. beschädigt/verschlüsselt — dann läuft die Datei einfach als Einzeldokument weiter.
  }
}

// Schneidet die Seiten [startSeite, endSeite] (1-basiert, beide inklusive) als eigenständige PDF aus.
async function pdfSeitenAusschneiden(bytes: Uint8Array, startSeite: number, endSeite: number): Promise<Uint8Array> {
  const quelle = await PDFDocument.load(bytes)
  const ziel = await PDFDocument.create()
  const indices = Array.from({ length: endSeite - startSeite + 1 }, (_, i) => startSeite - 1 + i)
  const kopiert = await ziel.copyPages(quelle, indices)
  for (const seite of kopiert) ziel.addPage(seite)
  return ziel.save()
}

// Grobe, aber praxistaugliche Duplikat-Erkennung: kein Abgleich des tatsächlichen Dateiinhalts
// (dafür müsste jedes bereits abgelegte Dokument erneut gelesen werden), sondern ein Abgleich der
// vorhandenen Dateinamen gegen Kategorie + erkanntes Datum des neuen Teildokuments — reicht für den
// praktischen Fall ("gleiche Unterlage versehentlich zweimal eingescannt") meist aus.
function findeVermutetesDuplikat(
  vorhandeneDokumente: { id: string; name: string }[],
  kategorie: string,
  erkanntesDatum: string | undefined,
): { id: string; name: string } | null {
  const kategorieWort = kategorie.toLowerCase().replace(/[^a-zäöüß]/g, '')
  if (!kategorieWort) return null
  const datumsTeile = (erkanntesDatum ?? '').split('-').filter(Boolean) // [YYYY, MM, DD?]
  for (const d of vorhandeneDokumente) {
    const nameNorm = d.name.toLowerCase()
    if (!nameNorm.includes(kategorieWort)) continue
    if (datumsTeile.length === 0) return d // Kategorie passt, kein Datum zum Gegenprüfen vorhanden
    const passtZumDatum = datumsTeile.every((teil) => nameNorm.includes(teil))
    if (passtZumDatum) return d
  }
  return null
}

type TelegramDokument = { id: string; name: string; typ: string; datum: string; groesse: string; url: string }

// Spiegelt die Antwortstruktur der email-gateway-Action "split_scan_dokument" (eigene Edge Function,
// kein geteilter Import möglich).
type ScanAufteilung = {
  erkannter_name?: string
  erkannte_firma?: string
  dokumente: {
    start_seite: number
    end_seite: number
    kategorie: string
    erkannter_name?: string
    erkanntes_datum?: string
    vorgeschlagener_dateiname: string
  }[]
}

// Verarbeitet einen mehrseitigen PDF-Sammel-Scan vollständig: KI-Analyse (Aufteilung in
// Einzeldokumente), Kunden-Zuordnung, tatsächliches Zerschneiden der PDF, Duplikat-Prüfung gegen die
// bereits vorhandenen Dokumente des Kunden und — falls nötig — Start einer Rückfrage-Warteschlange
// (ein Duplikat nach dem anderen, siehe aktion_feld "duplikat_entscheidung" weiter unten). Dokumente
// ohne Duplikat-Verdacht werden sofort automatisch abgelegt.
async function handleMehrseitigerScan(
  supabase: ReturnType<typeof createClient>,
  mitarbeiter: { id: string; name: string },
  chatId: number,
  bytes: Uint8Array,
  dateiname: string,
  seitenzahl: number,
  caption: string,
): Promise<void> {
  let aufteilung: ScanAufteilung | null = null
  try {
    const base64 = bytesZuBase64(bytes)
    const result = await callEmailGateway('split_scan_dokument', { datei_base64: base64, dateiname, seitenzahl })
    aufteilung = result.aufteilung
  } catch (err) {
    console.error('split_scan_dokument fehlgeschlagen:', err)
  }
  if (!aufteilung || !aufteilung.dokumente || aufteilung.dokumente.length === 0) {
    await sendTelegramMessage(chatId, 'Der Sammel-Scan konnte nicht automatisch analysiert werden — bitte nochmal schicken oder einzeln aufteilen.')
    return
  }

  // Erst ALLE Teildokumente zerschneiden und sichern — unabhängig davon, ob schon ein passender
  // Kunde existiert. Vorher wurde bei fehlendem/mehrdeutigem Treffer gar nichts gespeichert (echter
  // Fund beim Testen: ein ganz neuer Kunde, der noch nicht im CRM existiert, bekam nur "keinen
  // passenden Kunden gefunden" zu hören und die Scans waren verloren — genau der Fall, für den die
  // Funktion eigentlich gedacht ist).
  const heute = new Date().toISOString().slice(0, 10)
  const alleTeildokumente: { dokument: TelegramDokument; kategorie: string; erkanntesDatum?: string }[] = []
  for (const teil of aufteilung.dokumente) {
    let teilBytes: Uint8Array
    try {
      teilBytes = await pdfSeitenAusschneiden(bytes, teil.start_seite, teil.end_seite)
    } catch (err) {
      console.error('Seiten-Ausschnitt fehlgeschlagen:', err)
      continue
    }
    const teilDateiname = teil.vorgeschlagener_dateiname || `${teil.kategorie}_${teil.start_seite}-${teil.end_seite}.pdf`
    const pfad = `telegram/${Date.now()}_${sicheresPfadsegment(teilDateiname)}`
    const { error: uploadError } = await supabase.storage.from('email-anhaenge').upload(pfad, teilBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      console.error('Upload Teildokument fehlgeschlagen:', uploadError.message)
      continue
    }
    const { data: urlData } = supabase.storage.from('email-anhaenge').getPublicUrl(pfad)
    alleTeildokumente.push({
      dokument: {
        id: crypto.randomUUID(),
        name: teilDateiname,
        typ: 'application/pdf',
        datum: heute,
        groesse: formatGroesse(teilBytes.length),
        url: urlData.publicUrl,
      },
      kategorie: teil.kategorie,
      erkanntesDatum: teil.erkanntes_datum,
    })
  }
  if (alleTeildokumente.length === 0) {
    await sendTelegramMessage(chatId, 'Die erkannten Dokumente konnten nicht gespeichert werden — bitte nochmal schicken.')
    return
  }

  const { data: kundenRows } = await supabase
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, email, telefon, status, follow_up, activities, dokumente')
  const alleKunden = (kundenRows ?? []) as KundeRow[]
  const suchtext = [caption, aufteilung.erkannter_name, aufteilung.erkannte_firma].filter(Boolean).join(' ')
  const kandidaten = suchtext ? matchKandidaten(alleKunden, suchtext) : []

  if (kandidaten.length > 1) {
    // Mehrdeutig: anders als beim normalen Text-Chat (siehe Rückfrage-Auflösung weiter unten) gab es
    // hier bisher KEINEN Rückfrage-Zustand — die nächste Antwort ("Lipps", "nein rückgängig machen",
    // ...) landete dadurch im allgemeinen Text-Assistenten und wurde dort, mangels eigenem Treffer,
    // fälschlich dem zuletzt bearbeiteten (völlig anderen) Kunden als Notiz zugeordnet. Echter Fund
    // beim Testen. Jetzt wird die Mehrdeutigkeit wie beim Text-Chat per Rückfrage-Zustand aufgelöst.
    await supabase
      .from('mitarbeiter')
      .update({
        telegram_pending: {
          text: '',
          klass: null,
          kandidaten_ids: kandidaten.map((k) => k.kunde.id),
          erstellt_am: new Date().toISOString(),
          aktion_feld: 'scan_mehrdeutig',
          neuer_kunde_scan_dokumente: alleTeildokumente.map((t) => t.dokument),
          scan_teildokumente_meta: alleTeildokumente.map((t) => ({ id: t.dokument.id, kategorie: t.kategorie, erkanntesDatum: t.erkanntesDatum })),
        },
      })
      .eq('id', mitarbeiter.id)
    await sendTelegramMessage(
      chatId,
      `Der Scan enthält ${alleTeildokumente.length} erkannte Dokument(e) und ist gespeichert, aber ich habe mehrere passende Kunden gefunden: ${kandidaten.map((k) => `${k.kunde.firma} (${k.kunde.ansprechpartner})`).join(', ')}. Welchen genau meinst du?`,
    )
    return
  }

  if (kandidaten.length === 0) {
    // Kein Treffer: neuen Kunden für den GESAMTEN Scan vorschlagen (nicht nur eine einzelne Datei
    // wie im Einzeldokument-Ablauf) — der Standardfall beim Erstanlegen eines Aktenordners.
    await supabase
      .from('mitarbeiter')
      .update({
        telegram_pending: {
          text: '',
          klass: null,
          kandidaten_ids: [],
          erstellt_am: new Date().toISOString(),
          aktion_feld: 'neuer_kunde_scan_bestaetigen',
          neuer_kunde_name: aufteilung.erkannter_name ?? '',
          neuer_kunde_firma: aufteilung.erkannte_firma ?? caption ?? '',
          neuer_kunde_scan_dokumente: alleTeildokumente.map((t) => t.dokument),
        },
      })
      .eq('id', mitarbeiter.id)
    await sendTelegramMessage(
      chatId,
      `Der Scan enthält ${alleTeildokumente.length} erkannte Dokument(e) (${[...new Set(aufteilung.dokumente.map((d) => d.kategorie))].join(', ')}), aber ich habe keinen passenden Kunden gefunden. Alle Dokumente sind gespeichert. Soll ich dafür einen neuen Kunden anlegen? Antworte mit dem Bereich (z.B. "finanzierungen", "erben", "beratung", "betriebsuebergabe", "betriebsformen" oder "akademie") oder "nein".`,
    )
    return
  }

  await legeTeildokumenteBeiKundeAb(supabase, mitarbeiter, chatId, kandidaten[0].kunde, alleTeildokumente)
}

// Gemeinsame Ablage-Logik für einen bereits eindeutig feststehenden Kunden — genutzt sowohl direkt
// (genau ein Treffer) als auch nach Auflösung einer Mehrdeutigkeits-Rückfrage (aktion_feld
// "scan_mehrdeutig" weiter unten), damit beide Pfade exakt dieselbe Duplikat-Prüfung durchlaufen.
async function legeTeildokumenteBeiKundeAb(
  supabase: ReturnType<typeof createClient>,
  mitarbeiter: { id: string; name: string },
  chatId: number,
  kunde: KundeRow,
  teildokumente: { dokument: TelegramDokument; kategorie: string; erkanntesDatum?: string }[],
): Promise<void> {
  const heute = new Date().toISOString().slice(0, 10)
  const vorhandeneDokumente = (kunde.dokumente ?? []) as TelegramDokument[]
  const abgelegteNamen: string[] = []
  const neueDokumenteDirekt: TelegramDokument[] = []
  const neueActivities: { id: string; date: string; text: string; user: string }[] = []
  const duplikatWarteschlange: { dokument: TelegramDokument; bestehendesId: string; bestehenderName: string }[] = []

  for (const { dokument, kategorie, erkanntesDatum } of teildokumente) {
    const duplikat = findeVermutetesDuplikat(vorhandeneDokumente, kategorie, erkanntesDatum)
    if (duplikat) {
      duplikatWarteschlange.push({ dokument, bestehendesId: duplikat.id, bestehenderName: duplikat.name })
    } else {
      neueDokumenteDirekt.push(dokument)
      abgelegteNamen.push(dokument.name)
      neueActivities.push({
        id: crypto.randomUUID(),
        date: heute,
        text: `Aus Sammel-Scan per Telegram von ${mitarbeiter.name} automatisch abgelegt: „${dokument.name}" — ${kategorie}`,
        user: mitarbeiter.name,
      })
    }
  }

  if (neueDokumenteDirekt.length > 0) {
    await supabase
      .from('kunden')
      .update({ dokumente: [...neueDokumenteDirekt, ...vorhandeneDokumente], activities: [...neueActivities, ...(kunde.activities ?? [])] })
      .eq('id', kunde.id)
  }
  await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: kunde.id, telegram_last_kunde_bereich: kunde.bereich }).eq('id', mitarbeiter.id)

  if (duplikatWarteschlange.length === 0) {
    await sendTelegramMessage(
      chatId,
      `Sammel-Scan aufgeteilt und bei ${kunde.firma} (${kunde.ansprechpartner}) abgelegt: ${abgelegteNamen.map((n) => `„${n}"`).join(', ')}.`,
    )
    return
  }

  await supabase
    .from('mitarbeiter')
    .update({
      telegram_pending: {
        text: '',
        klass: null,
        kandidaten_ids: [],
        erstellt_am: new Date().toISOString(),
        aktion_feld: 'duplikat_entscheidung',
        duplikat_bereich: kunde.bereich,
        duplikat_kunde_id: kunde.id,
        duplikat_warteschlange: duplikatWarteschlange,
      },
    })
    .eq('id', mitarbeiter.id)

  const vorabText = abgelegteNamen.length > 0 ? `${abgelegteNamen.length} Dokument(e) bereits automatisch abgelegt. ` : ''
  const erstes = duplikatWarteschlange[0]
  const restHinweis =
    duplikatWarteschlange.length > 1 ? ` (danach noch ${duplikatWarteschlange.length - 1} weitere Rückfrage${duplikatWarteschlange.length > 2 ? 'n' : ''})` : ''
  await sendTelegramMessage(
    chatId,
    `${vorabText}Für „${erstes.dokument.name}" gibt es möglicherweise schon „${erstes.bestehenderName}" bei ${kunde.firma}. Was soll ich tun — "überschreiben", "kopie", "ignorieren" oder "prüfen" (als Kopie ablegen + Hinweis in der Akte)?${restHinweis}`,
  )
}

// ---------- Firmenwissen-Kontext (Server-Port von src/lib/firmenwissenKontext.ts) — damit über
// Telegram wirklich JEDE Frage zu Kunden/Objekten/Prozessen beantwortbar ist, nicht nur zu einem per
// Name erkannten einzelnen Kunden. Dieselbe Sicherheitslogik wie im Web: keine zusätzliche
// Bereichs-Einschränkung, jeder aktive Mitarbeiter darf per RLS ohnehin alles lesen. ----------

async function buildFirmenwissenKontextServer(supabase: ReturnType<typeof createClient>): Promise<string> {
  const [{ data: kundenRows }, { data: objekteRows }] = await Promise.all([
    supabase.from('kunden').select('bereich, firma, ansprechpartner, status, verantwortlich, letzte_aktivitaet, kaeuferprofil'),
    supabase.from('objekte').select('bezeichnung, adresse, typ, status, verantwortlich, activities, dokumente, eigentuemer'),
  ])

  const abschnitte: string[] = []
  abschnitte.push('=== KUNDEN / MANDANTEN (alle Bereiche) ===')
  const nachBereich = new Map<string, any[]>()
  for (const k of kundenRows ?? []) {
    if (!nachBereich.has(k.bereich)) nachBereich.set(k.bereich, [])
    nachBereich.get(k.bereich)!.push(k)
  }
  for (const [bereich, kunden] of nachBereich) {
    abschnitte.push(`-- ${bereich} (${kunden.length}) --`)
    for (const k of kunden) {
      const teile = [
        `${k.firma} (${k.ansprechpartner})`,
        `Status: ${k.status}`,
        `Verantwortlich: ${k.verantwortlich}`,
        `Letzte Aktivität: ${k.letzte_aktivitaet}`,
      ]
      if (k.kaeuferprofil) {
        const kp = k.kaeuferprofil
        teile.push(`Suchprofil: ${(kp.objekttypen ?? []).join('/') || 'beliebig'}, Budget ${kp.budgetMin ?? '?'}–${kp.budgetMax ?? '?'} €, Lage „${kp.bevorzugteLage || 'offen'}"`)
      }
      abschnitte.push(`  - ${teile.join(' · ')}`)
    }
  }

  abschnitte.push('\n=== IMMOBILIEN-OBJEKTE ===')
  for (const o of objekteRows ?? []) {
    const vorhandeneOrdner = Object.entries(o.dokumente ?? {})
      .filter(([, liste]: [string, any]) => (liste?.length ?? 0) > 0)
      .map(([name]) => name)
    const teile = [
      `${o.bezeichnung} (${o.adresse})`,
      `Typ: ${o.typ}`,
      `Status: ${o.status}`,
      `Verantwortlich: ${o.verantwortlich}`,
      `Letzte Aktivität: ${o.activities?.[0] ? o.activities[0].date : 'keine'}`,
      `Vorhandene Unterlagen: ${vorhandeneOrdner.length > 0 ? vorhandeneOrdner.join(', ') : 'keine'}`,
    ]
    if (o.eigentuemer) teile.push(`Eigentümer: ${o.eigentuemer.name}${o.eigentuemer.ansprechpartner ? ` (Ansprechpartner: ${o.eigentuemer.ansprechpartner})` : ''}`)
    abschnitte.push(`  - ${teile.join(' · ')}`)
  }

  return abschnitte.join('\n')
}

function formatGroesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const update = await req.json().catch(() => null)
  const message = update?.message
  if (!message?.chat?.id) return new Response('ok')

  const chatId: number = message.chat.id
  const text: string | undefined = message.text?.trim()
  const supabase = supa()

  // --- Verknüpfung über /start <code> (aus "Mein Profil" generiert) ---
  if (text?.startsWith('/start')) {
    const code = text.split(/\s+/)[1]?.trim()
    if (!code) {
      await sendTelegramMessage(chatId, 'Willkommen beim Mayer Holding CRM-Assistenten! Bitte nutze den Verknüpfungs-Link aus "Mein Profil" im CRM, um deinen Account zu verbinden.')
      return new Response('ok')
    }
    const { data: kandidat } = await supabase
      .from('mitarbeiter')
      .select('id, name')
      .eq('telegram_link_code', code)
      .eq('aktiv', true)
      .maybeSingle()
    if (!kandidat) {
      await sendTelegramMessage(chatId, 'Dieser Verknüpfungs-Code ist ungültig oder abgelaufen. Erzeug dir in "Mein Profil" im CRM einen neuen Link.')
      return new Response('ok')
    }
    await supabase.from('mitarbeiter').update({ telegram_chat_id: chatId, telegram_link_code: null }).eq('id', kandidat.id)
    await sendTelegramMessage(chatId, `Verbunden! Du bist jetzt als ${kandidat.name} mit dem Mayer Holding CRM verknüpft. Schreib mir einfach wie im Web-Chat auch — Notizen, Aufgaben, Fragen zu Kunden.`)
    return new Response('ok')
  }

  // --- Mitarbeiter anhand des verknüpften Chats finden ---
  const { data: mitarbeiter } = await supabase
    .from('mitarbeiter')
    .select('id, name, aktiv, rolle, ist_admin, telegram_last_kunde_id, telegram_last_kunde_bereich, telegram_pending')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()
  if (!mitarbeiter || !mitarbeiter.aktiv) {
    await sendTelegramMessage(chatId, 'Dieser Chat ist noch nicht mit einem CRM-Account verknüpft. Geh in "Mein Profil" im CRM und folge dem Verknüpfungs-Link.')
    return new Response('ok')
  }

  // --- Sprachnachrichten: noch nicht unterstützt (bewusst ehrlich statt stillschweigend ignorieren) ---
  if (message.voice) {
    await sendTelegramMessage(chatId, 'Sprachnachrichten kann ich hier noch nicht verarbeiten — bitte vorerst als Text schreiben. Das kommt als Nächstes.')
    return new Response('ok')
  }

  // --- Fotos/Dokumente: herunterladen, per KI-Inhaltsanalyse (nicht mehr zwingend per
  // Bildunterschrift) dem richtigen Kunden zuordnen. Vorher musste jede Datei eine Bildunterschrift
  // mit dem Kundennamen tragen, sonst passierte gar nichts — in der Praxis (z.B. Hasan schickt
  // schnell mehrere Scans ohne Unterschrift) blieb die Funktion dadurch faktisch ungenutzt. Die KI
  // liest jetzt den Inhalt selbst (Name/Firma im Dokument), die Bildunterschrift zählt weiterhin
  // zusätzlich mit, falls vorhanden. Gibt es keinen passenden Kunden, wird einer vorgeschlagen statt
  // die Datei kommentarlos zu verwerfen — die Datei wird in jedem Fall sofort gesichert.
  const photo = message.photo?.at(-1) // höchste Auflösung ist der letzte Eintrag
  const document = message.document
  if (photo || document) {
    const fileId = document?.file_id ?? photo.file_id
    const datei = await telegramDateiHerunterladen(fileId)
    if (!datei) {
      await sendTelegramMessage(chatId, 'Die Datei konnte nicht heruntergeladen werden.')
      return new Response('ok')
    }

    // Mehrseitiger PDF-Sammel-Scan (z.B. ein ganzer Aktenordner auf einmal gescannt) — eigener Ablauf
    // mit Aufteilung in Einzeldokumente + Duplikat-Prüfung, siehe handleMehrseitigerScan. Einzelne
    // Fotos/Dokumente (1 Seite) laufen unverändert über den bestehenden Ablauf unten weiter.
    if (document?.mime_type === 'application/pdf') {
      const seiten = await pdfSeitenzahl(datei.bytes)
      if (seiten && seiten > 1) {
        await handleMehrseitigerScan(
          supabase,
          mitarbeiter,
          chatId,
          datei.bytes,
          document.file_name ?? `scan_${Date.now()}.pdf`,
          seiten,
          message.caption?.trim() ?? '',
        )
        return new Response('ok')
      }
    }

    const caption: string = message.caption?.trim() ?? ''
    const dateiname = document?.file_name ?? `foto_${Date.now()}.jpg`
    const contentType = document?.mime_type ?? 'image/jpeg'

    let klassifikation: { erkannter_name?: string; erkannte_firma?: string; kategorie: string } | null = null
    try {
      const base64 = bytesZuBase64(datei.bytes)
      const result = await callEmailGateway('classify_kunden_dokument', { datei_base64: base64, media_type: contentType, dateiname })
      klassifikation = result.klassifikation
    } catch (err) {
      console.error('classify_kunden_dokument fehlgeschlagen:', err)
    }

    const { data: kundenRows } = await supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, email, telefon, status, follow_up, activities, dokumente')
    const alleKundenFuerDatei = (kundenRows ?? []) as KundeRow[]
    const suchtext = [caption, klassifikation?.erkannter_name, klassifikation?.erkannte_firma].filter(Boolean).join(' ')
    const kandidaten = suchtext ? matchKandidaten(alleKundenFuerDatei, suchtext) : []
    const erkanntText = klassifikation
      ? ` (erkannt: ${[klassifikation.erkannte_firma, klassifikation.erkannter_name, klassifikation.kategorie].filter(Boolean).join(', ')})`
      : ''

    // Datei immer sofort sichern — unabhängig vom Treffer, sonst ist sie bei der nächsten Nachricht
    // (z.B. Antwort auf die Rückfrage) verloren.
    const pfad = `telegram/${Date.now()}_${sicheresPfadsegment(dateiname)}`
    const { error: uploadError } = await supabase.storage.from('email-anhaenge').upload(pfad, datei.bytes, { contentType, upsert: true })
    if (uploadError) {
      await sendTelegramMessage(chatId, 'Die Datei konnte nicht gespeichert werden.')
      return new Response('ok')
    }
    const { data: urlData } = supabase.storage.from('email-anhaenge').getPublicUrl(pfad)
    const heute = new Date().toISOString().slice(0, 10)
    const neuesDokument = { id: crypto.randomUUID(), name: dateiname, typ: contentType, datum: heute, groesse: formatGroesse(datei.bytes.length), url: urlData.publicUrl }

    if (kandidaten.length === 1) {
      const kunde = kandidaten[0].kunde
      const neueActivity = {
        id: crypto.randomUUID(),
        date: heute,
        text: `Datei per Telegram von ${mitarbeiter.name} automatisch abgelegt: „${dateiname}"${klassifikation ? ` — ${klassifikation.kategorie}` : ''}`,
        user: mitarbeiter.name,
      }
      await supabase
        .from('kunden')
        .update({ dokumente: [neuesDokument, ...(kunde.dokumente ?? [])], activities: [neueActivity, ...(kunde.activities ?? [])] })
        .eq('id', kunde.id)
      await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: kunde.id, telegram_last_kunde_bereich: kunde.bereich }).eq('id', mitarbeiter.id)
      await sendTelegramMessage(chatId, `Automatisch abgelegt bei ${kunde.firma} (${kunde.ansprechpartner}): „${dateiname}"${erkanntText}`)
      return new Response('ok')
    }

    if (kandidaten.length > 1) {
      await sendTelegramMessage(
        chatId,
        `Dazu habe ich mehrere passende Kunden gefunden: ${kandidaten.map((k) => `${k.kunde.firma} (${k.kunde.ansprechpartner})`).join(', ')}. Die Datei ist gespeichert${erkanntText} — schick sie bitte nochmal mit dem genauen Kundennamen als Bildunterschrift, dann lege ich sie richtig ab.`,
      )
      return new Response('ok')
    }

    // Kein Treffer: neuen Kunden vorschlagen statt die Datei kommentarlos zu verwerfen.
    await supabase
      .from('mitarbeiter')
      .update({
        telegram_pending: {
          text: '',
          klass: null,
          kandidaten_ids: [],
          erstellt_am: new Date().toISOString(),
          aktion_feld: 'neuer_kunde_bestaetigen',
          neuer_kunde_dokument: neuesDokument,
          neuer_kunde_name: klassifikation?.erkannter_name ?? '',
          neuer_kunde_firma: klassifikation?.erkannte_firma ?? caption ?? '',
        },
      })
      .eq('id', mitarbeiter.id)
    await sendTelegramMessage(
      chatId,
      `Dazu habe ich keinen passenden Kunden/Mandanten gefunden.${erkanntText || ' Im Dokument war nichts Eindeutiges erkennbar.'} Die Datei ist gespeichert. Soll ich dafür einen neuen Kunden anlegen? Antworte mit dem Bereich (z.B. "finanzierungen", "erben", "beratung", "betriebsuebergabe", "betriebsformen" oder "akademie") oder "nein".`,
    )
    return new Response('ok')
  }

  if (!text) {
    await sendTelegramMessage(chatId, 'Ich kann aktuell Text, Fotos und Dokumente verarbeiten.')
    return new Response('ok')
  }

  const { data: kundenRows } = await supabase
    .from('kunden')
    .select('id, bereich, firma, ansprechpartner, email, telefon, status, follow_up, activities, dokumente')
  const alleKunden = (kundenRows ?? []) as KundeRow[]

  // --- Offene Rückfrage auflösen (z.B. vorige Nachricht: "mehrere Kunden gefunden, wen meinst du?")
  // — ohne das landet eine kurze Antwort wie nur der Vorname als neue, kontextlose Nachricht und wird
  // falsch interpretiert (siehe echter Fehlgriff beim Testen: "Renate" löste nichts auf, die
  // Folgenachricht "Renate Mayer" landete dann fälschlich als sinnlose Notiz in ihrer Akte).
  let klass: { typ: string; erkannter_name?: string; titel?: string; faelligkeitsdatum?: string; frage?: string } | null = null
  let match: KundeRow | null = null
  const pending = mitarbeiter.telegram_pending as
    | {
        text: string
        klass: any
        kandidaten_ids: string[]
        erstellt_am: string
        aktion_feld?:
          | 'bereich'
          | 'firma'
          | 'loeschen_bestaetigen'
          | 'neuer_kunde_bestaetigen'
          | 'neuer_kunde_scan_bestaetigen'
          | 'scan_mehrdeutig'
          | 'duplikat_entscheidung'
        loeschen_id?: string
        loeschen_name?: string
        neuer_kunde_dokument?: TelegramDokument
        neuer_kunde_name?: string
        neuer_kunde_firma?: string
        neuer_kunde_scan_dokumente?: TelegramDokument[]
        scan_teildokumente_meta?: { id: string; kategorie: string; erkanntesDatum?: string }[]
        duplikat_bereich?: string
        duplikat_kunde_id?: string
        duplikat_warteschlange?: { dokument: TelegramDokument; bestehendesId: string; bestehenderName: string }[]
      }
    | null
  if (pending && Date.now() - new Date(pending.erstellt_am).getTime() < 10 * 60 * 1000) {
    await supabase.from('mitarbeiter').update({ telegram_pending: null }).eq('id', mitarbeiter.id)
    if (pending.aktion_feld === 'loeschen_bestaetigen') {
      const bestaetigt = /^ja\b/i.test(text.trim())
      if (bestaetigt && pending.loeschen_id) {
        const { error: deleteError } = await supabase.from('kunden').delete().eq('id', pending.loeschen_id)
        await sendTelegramMessage(chatId, deleteError ? `Löschen fehlgeschlagen: ${deleteError.message}` : `Gelöscht: ${pending.loeschen_name}`)
      } else {
        await sendTelegramMessage(chatId, 'Abgebrochen, nichts gelöscht.')
      }
      return new Response('ok')
    }
    if (pending.aktion_feld === 'neuer_kunde_bestaetigen') {
      const BEREICHE_NEUANLAGE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
      const genannterBereich = BEREICHE_NEUANLAGE.find((b) => text.toLowerCase().includes(b))
      if (!genannterBereich) {
        await sendTelegramMessage(chatId, 'Ok, nichts angelegt. Die Datei bleibt gespeichert, du kannst sie manuell im CRM zuordnen.')
        return new Response('ok')
      }
      const heute = new Date().toISOString().slice(0, 10)
      const firma = pending.neuer_kunde_firma || pending.neuer_kunde_name || 'Unbekannt (Telegram)'
      const neueId = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const DEFAULT_STATUS: Record<string, string> = {
        beratung: 'lead', erben: 'erstkontakt', betriebsuebergabe: 'erstkontakt',
        betriebsformen: 'erstkontakt', akademie: 'interessent', finanzierungen: 'interessent',
      }
      const { error: insertError } = await supabase.from('kunden').insert({
        id: neueId,
        bereich: genannterBereich,
        firma,
        ansprechpartner: pending.neuer_kunde_name || '',
        email: '',
        telefon: null,
        prioritaet: 'Mittel',
        status: DEFAULT_STATUS[genannterBereich],
        follow_up: { date: heute, note: 'Von Telegram automatisch angelegt — Erstkontakt vereinbaren', done: false },
        verantwortlich: mitarbeiter.name,
        letzte_aktivitaet: heute,
        activities: [{ id: crypto.randomUUID(), date: heute, text: `Per Telegram von ${mitarbeiter.name} angelegt (Datei automatisch erkannt, kein passender Kunde gefunden).`, user: mitarbeiter.name }],
        dokumente: pending.neuer_kunde_dokument ? [pending.neuer_kunde_dokument] : [],
      })
      if (insertError) {
        await sendTelegramMessage(chatId, `Anlegen fehlgeschlagen: ${insertError.message}`)
        return new Response('ok')
      }
      await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: neueId, telegram_last_kunde_bereich: genannterBereich }).eq('id', mitarbeiter.id)
      await sendTelegramMessage(chatId, `Neu angelegt: ${firma} (Bereich ${genannterBereich}) — Datei ist dort abgelegt.`)
      return new Response('ok')
    }
    if (pending.aktion_feld === 'neuer_kunde_scan_bestaetigen') {
      const BEREICHE_NEUANLAGE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
      const genannterBereich = BEREICHE_NEUANLAGE.find((b) => text.toLowerCase().includes(b))
      if (!genannterBereich) {
        await sendTelegramMessage(chatId, 'Ok, nichts angelegt. Die Dokumente bleiben gespeichert, du kannst sie manuell im CRM zuordnen.')
        return new Response('ok')
      }
      const heute = new Date().toISOString().slice(0, 10)
      const firma = pending.neuer_kunde_firma || pending.neuer_kunde_name || 'Unbekannt (Telegram-Scan)'
      const neueId = `k_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
      const scanDokumente = pending.neuer_kunde_scan_dokumente ?? []
      const DEFAULT_STATUS: Record<string, string> = {
        beratung: 'lead', erben: 'erstkontakt', betriebsuebergabe: 'erstkontakt',
        betriebsformen: 'erstkontakt', akademie: 'interessent', finanzierungen: 'interessent',
      }
      const { error: insertError } = await supabase.from('kunden').insert({
        id: neueId,
        bereich: genannterBereich,
        firma,
        ansprechpartner: pending.neuer_kunde_name || '',
        email: '',
        telefon: null,
        prioritaet: 'Mittel',
        status: DEFAULT_STATUS[genannterBereich],
        follow_up: { date: heute, note: 'Von Telegram automatisch angelegt — Erstkontakt vereinbaren', done: false },
        verantwortlich: mitarbeiter.name,
        letzte_aktivitaet: heute,
        activities: [{
          id: crypto.randomUUID(),
          date: heute,
          text: `Per Telegram von ${mitarbeiter.name} angelegt (Sammel-Scan automatisch erkannt, kein passender Kunde gefunden) — ${scanDokumente.length} Dokument(e) abgelegt.`,
          user: mitarbeiter.name,
        }],
        dokumente: scanDokumente,
      })
      if (insertError) {
        await sendTelegramMessage(chatId, `Anlegen fehlgeschlagen: ${insertError.message}`)
        return new Response('ok')
      }
      await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: neueId, telegram_last_kunde_bereich: genannterBereich }).eq('id', mitarbeiter.id)
      await sendTelegramMessage(
        chatId,
        `Neu angelegt: ${firma} (Bereich ${genannterBereich}) — ${scanDokumente.length} Dokument(e) aus dem Sammel-Scan sind dort abgelegt.`,
      )
      return new Response('ok')
    }
    if (pending.aktion_feld === 'scan_mehrdeutig') {
      const textWoerter = new Set(woerter(text))
      const treffer = alleKunden.filter(
        (k) => pending.kandidaten_ids.includes(k.id) && [...woerter(k.firma), ...woerter(k.ansprechpartner)].some((w) => textWoerter.has(w)),
      )
      if (treffer.length !== 1) {
        // Wieder unklar/kein Treffer: Rückfrage-Zustand erhalten bleiben lassen, statt stillschweigend
        // im allgemeinen Text-Chat zu landen (genau das war der ursprüngliche Fehler).
        await supabase.from('mitarbeiter').update({ telegram_pending: pending }).eq('id', mitarbeiter.id)
        await sendTelegramMessage(chatId, 'Das war nicht eindeutig genug — bitte nenne den Firmen- oder Ansprechpartner-Namen genau wie oben aufgelistet.')
        return new Response('ok')
      }
      const kundeRowRaw = treffer[0]
      const dokumente = pending.neuer_kunde_scan_dokumente ?? []
      const meta = pending.scan_teildokumente_meta ?? []
      const teildokumente = dokumente.map((dokument) => {
        const m = meta.find((x) => x.id === dokument.id)
        return { dokument, kategorie: m?.kategorie ?? 'Sonstiges', erkanntesDatum: m?.erkanntesDatum }
      })
      await legeTeildokumenteBeiKundeAb(supabase, mitarbeiter, chatId, kundeRowRaw, teildokumente)
      return new Response('ok')
    }
    if (pending.aktion_feld === 'duplikat_entscheidung') {
      const warteschlange = pending.duplikat_warteschlange ?? []
      const aktuelles = warteschlange[0]
      if (!aktuelles || !pending.duplikat_kunde_id || !pending.duplikat_bereich) return new Response('ok')

      const { data: kundeRow } = await supabase
        .from('kunden')
        .select('id, bereich, firma, ansprechpartner, dokumente, activities')
        .eq('id', pending.duplikat_kunde_id)
        .eq('bereich', pending.duplikat_bereich)
        .maybeSingle()
      if (!kundeRow) {
        await sendTelegramMessage(chatId, 'Der zugehörige Kunde wurde nicht mehr gefunden.')
        return new Response('ok')
      }

      const antwort = text.trim().toLowerCase()
      let dokumente = (kundeRow.dokumente ?? []) as TelegramDokument[]
      let aktionsText = ''
      if (antwort.startsWith('über') || antwort.startsWith('uber')) {
        dokumente = dokumente.map((d) => (d.id === aktuelles.bestehendesId ? { ...aktuelles.dokument, id: d.id } : d))
        aktionsText = `„${aktuelles.bestehenderName}" durch „${aktuelles.dokument.name}" überschrieben`
      } else if (antwort.startsWith('kopie')) {
        dokumente = [aktuelles.dokument, ...dokumente]
        aktionsText = `„${aktuelles.dokument.name}" als weitere Kopie abgelegt`
      } else if (antwort.startsWith('prüf') || antwort.startsWith('pruf')) {
        dokumente = [aktuelles.dokument, ...dokumente]
        aktionsText = `„${aktuelles.dokument.name}" abgelegt, als möglicherweise doppelt markiert — bitte im CRM prüfen`
      } else if (antwort.startsWith('ignor')) {
        aktionsText = `„${aktuelles.dokument.name}" verworfen, „${aktuelles.bestehenderName}" bleibt unverändert`
      } else {
        // Nicht verstanden: Pending unverändert wieder zurückschreiben (wurde oben bereits gelöscht) und erneut nachfragen.
        await supabase.from('mitarbeiter').update({ telegram_pending: pending }).eq('id', mitarbeiter.id)
        await sendTelegramMessage(chatId, 'Das habe ich nicht verstanden — bitte antworte mit "überschreiben", "kopie", "ignorieren" oder "prüfen".')
        return new Response('ok')
      }

      const heute = new Date().toISOString().slice(0, 10)
      const activities = [
        { id: crypto.randomUUID(), date: heute, text: `Duplikat-Entscheidung per Telegram von ${mitarbeiter.name}: ${aktionsText}`, user: mitarbeiter.name },
        ...((kundeRow.activities ?? []) as { id: string; date: string; text: string; user: string }[]),
      ]
      await supabase.from('kunden').update({ dokumente, activities }).eq('id', kundeRow.id)

      const rest = warteschlange.slice(1)
      if (rest.length === 0) {
        await sendTelegramMessage(chatId, `Erledigt: ${aktionsText}. Alle Rückfragen zum Sammel-Scan sind abgearbeitet.`)
        return new Response('ok')
      }
      await supabase
        .from('mitarbeiter')
        .update({ telegram_pending: { ...pending, duplikat_warteschlange: rest, erstellt_am: new Date().toISOString() } })
        .eq('id', mitarbeiter.id)
      const naechstes = rest[0]
      await sendTelegramMessage(
        chatId,
        `${aktionsText}. Nächste Rückfrage: Für „${naechstes.dokument.name}" gibt es möglicherweise schon „${naechstes.bestehenderName}". Was soll ich tun — "überschreiben", "kopie", "ignorieren" oder "prüfen"?`,
      )
      return new Response('ok')
    }
    if (pending.aktion_feld === 'bereich') {
      const BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
      const genannt = BEREICHE.find((b) => text.toLowerCase().includes(b))
      klass = genannt ? { ...pending.klass, aktion_bereich: genannt } : pending.klass
    } else if (pending.aktion_feld === 'firma') {
      klass = { ...pending.klass, aktion_firma: text.trim() }
    } else {
      const textWoerter = new Set(woerter(text))
      const treffer = alleKunden.filter(
        (k) => pending.kandidaten_ids.includes(k.id) && [...woerter(k.firma), ...woerter(k.ansprechpartner)].some((w) => textWoerter.has(w)),
      )
      if (treffer.length === 1) {
        match = treffer[0]
        klass = pending.klass
      }
    }
  }

  // --- Normale Klassifizierung + Kunden-Zuordnung, falls keine Rückfrage aufgelöst wurde ---
  if (!klass) {
    try {
      const result = await callEmailGateway('assistant_classify', { transcript: text, heute: new Date().toISOString().slice(0, 10) })
      klass = result.klassifikation
    } catch {
      await sendTelegramMessage(chatId, 'Da ist leider etwas schiefgelaufen. Versuch es nochmal.')
      return new Response('ok')
    }

    const kandidatenNachId = new Map<string, KundeMatch>()
    for (const k of [...(klass.erkannter_name ? matchKandidaten(alleKunden, klass.erkannter_name) : []), ...matchKandidaten(alleKunden, text)]) {
      const vorhanden = kandidatenNachId.get(k.kunde.id)
      if (!vorhanden || k.score > vorhanden.score) kandidatenNachId.set(k.kunde.id, k)
    }
    const alleKandidaten = [...kandidatenNachId.values()]
    const topScore = alleKandidaten.length > 0 ? Math.max(...alleKandidaten.map((k) => k.score)) : 0
    const kandidaten = alleKandidaten.filter((k) => k.score === topScore)

    if (kandidaten.length > 1) {
      await supabase
        .from('mitarbeiter')
        .update({ telegram_pending: { text, klass, kandidaten_ids: kandidaten.map((k) => k.kunde.id), erstellt_am: new Date().toISOString() } })
        .eq('id', mitarbeiter.id)
      await sendTelegramMessage(chatId, `Dazu habe ich mehrere passende Kunden/Mandanten gefunden: ${kandidaten.map((k) => `${k.kunde.firma} (${k.kunde.ansprechpartner})`).join(', ')}. Wen genau meinst du?`)
      return new Response('ok')
    }

    match = kandidaten[0]?.kunde ?? null
    if (!match && mitarbeiter.telegram_last_kunde_id) {
      match = alleKunden.find((k) => k.id === mitarbeiter.telegram_last_kunde_id) ?? null
    }
  }
  if (match) await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: match.id, telegram_last_kunde_bereich: match.bereich }).eq('id', mitarbeiter.id)
  if (!klass) return new Response('ok') // kann hier nicht mehr eintreten, beruhigt nur die Typprüfung

  if (klass.typ === 'frage') {
    const frageText = klass.frage ?? text
    if (!match) {
      // Kein konkreter Kunde erkannt/gemeint — trotzdem beantworten, auf Basis des gesamten
      // Firmenwissens (alle Kunden/Objekte), statt stillschweigend abzubrechen. Deckt z.B.
      // bereichsübergreifende Fragen ab ("Welche Käufer suchen Objekte über 5 Mio?").
      try {
        const kontext = await buildFirmenwissenKontextServer(supabase)
        const result = await callEmailGateway('firmenwissen_answer', { frage: frageText, kontext })
        await sendTelegramMessage(chatId, result.antwort)
      } catch {
        await sendTelegramMessage(chatId, 'Antwort konnte nicht abgerufen werden.')
      }
      return new Response('ok')
    }
    const { data: protokolleRows } = await supabase
      .from('protokolle')
      .select('datum, betreff, teilnehmer, text, kernthemen, vereinbarungen, offene_punkte, ki_zusammenfassung')
      .eq('bereich', match.bereich)
      .eq('kunde_id', match.id)
      .order('datum', { ascending: false })
      .limit(10)
    const kontext = [
      `Kunde/Mandant: ${match.firma} (${match.ansprechpartner})`,
      `Status: ${match.status ?? 'unbekannt'}`,
      match.follow_up ? `Follow-up: ${match.follow_up.date} — ${match.follow_up.note}${match.follow_up.done ? ' (erledigt)' : ''}` : 'Follow-up: keines',
      '',
      'Aktivitäten (neueste zuerst):',
      ...(match.activities ?? []).slice(0, 20).map((a) => `- ${a.date}: ${a.text}`),
      '',
      'Gesprächsprotokolle (neueste zuerst):',
      ...((protokolleRows ?? []).length > 0
        ? (protokolleRows ?? []).flatMap((p: any) => [
            `- ${p.datum} "${p.betreff}" (Teilnehmer: ${p.teilnehmer}):`,
            `  Zusammenfassung: ${p.ki_zusammenfassung ?? p.text}`,
          ])
        : ['(keine)']),
      '',
      'Vorhandene Dokumente:',
      ...((match.dokumente ?? []).length > 0 ? (match.dokumente ?? []).map((d) => `- ${d.name}`) : ['(keine)']),
    ].join('\n')
    try {
      const result = await callEmailGateway('assistant_answer', { frage: frageText, kontext })
      await sendTelegramMessage(chatId, result.antwort)
    } catch {
      await sendTelegramMessage(chatId, 'Antwort konnte nicht abgerufen werden.')
    }
    return new Response('ok')
  }

  if (klass.typ === 'uebersicht') {
    const heute = new Date().toISOString().slice(0, 10)
    const eigeneFaelligeKunden = alleKunden
      .filter((k) => k.verantwortlich === mitarbeiter.name && k.follow_up && !(k.follow_up as any).done && (k.follow_up as any).date <= heute)
      .sort((a, b) => ((a.follow_up as any).date as string).localeCompare((b.follow_up as any).date as string))
    const faelligkeitenAbschnitt = [
      `Heutiges Datum: ${heute}`,
      '',
      `Für ${mitarbeiter.name} fällige/überfällige Follow-ups (eigene Kunden/Mandanten, unabhängig vom Bereich):`,
      ...(eigeneFaelligeKunden.length > 0
        ? eigeneFaelligeKunden.map((k) => `- ${k.firma} (${k.ansprechpartner}), Bereich ${k.bereich}: ${(k.follow_up as any).note} — fällig ${(k.follow_up as any).date}`)
        : ['(keine fälligen Follow-ups)']),
    ].join('\n')
    try {
      const firmenwissen = await buildFirmenwissenKontextServer(supabase)
      const kontext = `${faelligkeitenAbschnitt}\n\n${firmenwissen}`
      const result = await callEmailGateway('firmenwissen_answer', { frage: text, kontext })
      await sendTelegramMessage(chatId, result.antwort)
    } catch {
      await sendTelegramMessage(chatId, 'Antwort konnte nicht abgerufen werden.')
    }
    return new Response('ok')
  }

  if (klass.typ === 'aktion_lead_anlegen') {
    const BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']
    const bereich = (klass as any).aktion_bereich as string | undefined
    const firma = ((klass as any).aktion_firma as string | undefined) ?? klass.erkannter_name
    if (!bereich || !BEREICHE.includes(bereich)) {
      await supabase
        .from('mitarbeiter')
        .update({ telegram_pending: { text, klass, kandidaten_ids: [], erstellt_am: new Date().toISOString(), aktion_feld: 'bereich' } })
        .eq('id', mitarbeiter.id)
      await sendTelegramMessage(chatId, `In welchem Bereich soll der Lead angelegt werden? (${BEREICHE.join(', ')})`)
      return new Response('ok')
    }
    if (!firma) {
      await supabase
        .from('mitarbeiter')
        .update({ telegram_pending: { text, klass: { ...klass, aktion_bereich: bereich }, kandidaten_ids: [], erstellt_am: new Date().toISOString(), aktion_feld: 'firma' } })
        .eq('id', mitarbeiter.id)
      await sendTelegramMessage(chatId, 'Wie soll der Lead/die Firma heißen?')
      return new Response('ok')
    }
    const heute = new Date().toISOString().slice(0, 10)
    const inZweiTagen = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { error: insertError } = await supabase.from('kunden').insert({
      id: crypto.randomUUID(),
      bereich,
      firma,
      ansprechpartner: firma,
      email: '',
      telefon: '',
      prioritaet: 'Mittel',
      status: 'lead',
      follow_up: { date: inZweiTagen, note: 'Erstkontakt aufnehmen', done: false },
      verantwortlich: mitarbeiter.name,
      letzte_aktivitaet: heute,
      activities: [{ id: crypto.randomUUID(), date: heute, text: `Per Telegram von ${mitarbeiter.name} angelegt.`, user: mitarbeiter.name }],
    })
    if (insertError) {
      await sendTelegramMessage(chatId, `Anlegen fehlgeschlagen: ${insertError.message}`)
    } else {
      await sendTelegramMessage(chatId, `Erledigt — "${firma}" als neuer Lead bei ${bereich} angelegt, dir zugeordnet.`)
    }
    return new Response('ok')
  }

  if (klass.typ === 'aktion_lead_loeschen') {
    const berechtigt = mitarbeiter.rolle === 'geschaeftsfuehrung' || !!mitarbeiter.ist_admin
    if (!berechtigt) {
      await sendTelegramMessage(chatId, 'Kunden/Leads löschen darf nur Geschäftsführung/Admin.')
      return new Response('ok')
    }
    if (!match) {
      await sendTelegramMessage(chatId, 'Welchen Kunden/Lead genau soll ich löschen? Nenn mir bitte den Namen etwas genauer.')
      return new Response('ok')
    }
    const name = `${match.firma} (${match.ansprechpartner}) bei ${match.bereich}`
    await supabase
      .from('mitarbeiter')
      .update({ telegram_pending: { aktion_feld: 'loeschen_bestaetigen', loeschen_id: match.id, loeschen_name: name, erstellt_am: new Date().toISOString(), kandidaten_ids: [], klass: null, text: '' } })
      .eq('id', mitarbeiter.id)
    await sendTelegramMessage(chatId, `Soll ich "${name}" wirklich unwiderruflich löschen? Antworte mit "ja" zum Bestätigen, sonst passiert nichts.`)
    return new Response('ok')
  }

  if (klass.typ === 'aufnahme') {
    await sendTelegramMessage(chatId, 'Gespräche live aufzeichnen geht aktuell nur über den "Gespräch aufzeichnen"-Button im CRM selbst, noch nicht über Telegram.')
    return new Response('ok')
  }

  // notiz / aufgabe
  const titel = klass.titel ?? text.slice(0, 80)
  const faelligkeitsdatum = klass.faelligkeitsdatum || new Date().toISOString().slice(0, 10)
  const art = klass.typ === 'aufgabe' ? 'Aufgabe' : 'Notiz'
  if (match) {
    const heute = new Date().toISOString().slice(0, 10)
    const neueActivity = { id: crypto.randomUUID(), date: heute, text: `${art} per Telegram von ${mitarbeiter.name} erfasst: „${titel}"`, user: mitarbeiter.name }
    await supabase
      .from('kunden')
      .update({
        activities: [neueActivity, ...(match.activities ?? [])],
        ...(klass.typ === 'aufgabe' ? { follow_up: { date: faelligkeitsdatum, note: titel, done: false } } : {}),
      })
      .eq('id', match.id)
    const falligHinweis = klass.typ === 'aufgabe' ? ` (fällig ${faelligkeitsdatum})` : ''
    await sendTelegramMessage(chatId, `Erledigt — ${art}${falligHinweis} bei ${match.firma} (${match.ansprechpartner}) gespeichert: „${titel}"`)
  } else {
    await sendTelegramMessage(chatId, `Ich hab keinen passenden Kunden gefunden — magst du mir noch sagen, zu welchem Kunden das gehört? Sonst leg ich es gerade nirgends ab.`)
  }
  return new Response('ok')
})
