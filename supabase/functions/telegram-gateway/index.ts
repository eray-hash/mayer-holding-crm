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

async function telegramDateiHerunterladen(fileId: string): Promise<{ bytes: Uint8Array; telegramPfad: string } | null> {
  const metaRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`)
  const meta = await metaRes.json()
  if (!meta.ok) return null
  const telegramPfad = meta.result.file_path as string
  const fileRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${telegramPfad}`)
  if (!fileRes.ok) return null
  return { bytes: new Uint8Array(await fileRes.arrayBuffer()), telegramPfad }
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
    .select('id, name, aktiv, telegram_last_kunde_id, telegram_last_kunde_bereich, telegram_pending')
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

  // --- Fotos/Dokumente: herunterladen, ablegen, per Bildunterschrift dem richtigen Kunden zuordnen ---
  const photo = message.photo?.at(-1) // höchste Auflösung ist der letzte Eintrag
  const document = message.document
  if (photo || document) {
    const fileId = document?.file_id ?? photo.file_id
    const datei = await telegramDateiHerunterladen(fileId)
    if (!datei) {
      await sendTelegramMessage(chatId, 'Die Datei konnte nicht heruntergeladen werden.')
      return new Response('ok')
    }
    const caption: string = message.caption?.trim() ?? ''
    if (!caption) {
      await sendTelegramMessage(chatId, 'Für welchen Kunden/Mandanten ist das? Schick die Datei nochmal mit dem Kundennamen als Bildunterschrift.')
      return new Response('ok')
    }
    const { data: kundenRows } = await supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, email, telefon, status, follow_up, activities, dokumente')
    const kandidaten = matchKandidaten((kundenRows ?? []) as KundeRow[], caption)
    if (kandidaten.length !== 1) {
      await sendTelegramMessage(
        chatId,
        kandidaten.length === 0
          ? 'Dazu habe ich keinen passenden Kunden gefunden — nenn den Namen in der Bildunterschrift bitte genauer.'
          : `Dazu habe ich mehrere passende Kunden gefunden: ${kandidaten.map((k) => `${k.kunde.firma} (${k.kunde.ansprechpartner})`).join(', ')}. Bitte genauer benennen.`,
      )
      return new Response('ok')
    }
    const kunde = kandidaten[0].kunde
    const dateiname = document?.file_name ?? `foto_${Date.now()}.jpg`
    const contentType = document?.mime_type ?? 'image/jpeg'
    const pfad = `telegram/${kunde.id}/${Date.now()}_${sicheresPfadsegment(dateiname)}`
    const { error: uploadError } = await supabase.storage
      .from('email-anhaenge')
      .upload(pfad, datei.bytes, { contentType, upsert: true })
    if (uploadError) {
      await sendTelegramMessage(chatId, 'Die Datei konnte nicht gespeichert werden.')
      return new Response('ok')
    }
    const { data: urlData } = supabase.storage.from('email-anhaenge').getPublicUrl(pfad)
    const heute = new Date().toISOString().slice(0, 10)
    const neuesDokument = { id: crypto.randomUUID(), name: dateiname, typ: contentType, datum: heute, groesse: formatGroesse(datei.bytes.length), url: urlData.publicUrl }
    const neueActivity = { id: crypto.randomUUID(), date: heute, text: `Datei per Telegram von ${mitarbeiter.name} abgelegt: „${dateiname}"`, user: mitarbeiter.name }
    await supabase
      .from('kunden')
      .update({
        dokumente: [neuesDokument, ...(kunde.dokumente ?? [])],
        activities: [neueActivity, ...(kunde.activities ?? [])],
      })
      .eq('id', kunde.id)
    await supabase.from('mitarbeiter').update({ telegram_last_kunde_id: kunde.id, telegram_last_kunde_bereich: kunde.bereich }).eq('id', mitarbeiter.id)
    await sendTelegramMessage(chatId, `Abgelegt bei ${kunde.firma} (${kunde.ansprechpartner}): „${dateiname}"`)
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
  const pending = mitarbeiter.telegram_pending as { text: string; klass: typeof klass; kandidaten_ids: string[]; erstellt_am: string } | null
  if (pending && Date.now() - new Date(pending.erstellt_am).getTime() < 10 * 60 * 1000) {
    const textWoerter = new Set(woerter(text))
    const treffer = alleKunden.filter(
      (k) => pending.kandidaten_ids.includes(k.id) && [...woerter(k.firma), ...woerter(k.ansprechpartner)].some((w) => textWoerter.has(w)),
    )
    if (treffer.length === 1) {
      match = treffer[0]
      klass = pending.klass
      await supabase.from('mitarbeiter').update({ telegram_pending: null }).eq('id', mitarbeiter.id)
    } else {
      await supabase.from('mitarbeiter').update({ telegram_pending: null }).eq('id', mitarbeiter.id)
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
