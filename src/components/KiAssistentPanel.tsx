import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Sparkles, AlertTriangle, Send, X, Volume2, VolumeX, Bot, ImagePlus, Phone, Paperclip, Maximize2, Minimize2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { BILD_ARTEN, DATEI_ARTEN, dateiStatus, frageAssistent, istServerAssistentVerfuegbar, mailStatus, schickeDatei, verkleinereBild, type AssistentBild } from '../lib/assistentServer'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { useSpeechRecognition } from '../lib/useSpeechRecognition'
import { speak, stopSpeaking, isSpeechSynthesisSupported } from '../lib/useSpeechSynthesis'
import { offenerKontext } from '../lib/assistentKontext'
import {
  isEmailGatewayConfigured,
  classifyAssistantInput,
  answerAssistantQuestion,
  answerWithImage,
  answerFirmenwissen,
  type AssistentKlassifikation,
} from '../lib/emailGateway'
import { buildFirmenwissenKontext } from '../lib/firmenwissenKontext'
import { collectFollowUpPriorities } from '../lib/followUpPriorities'
import { suggestKundeKandidaten, type KundeMatch } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { CallRecorder } from './CallRecorder'
import { Modal, inputClass } from './ui'
import { today, fmtDate, uid, addDays } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'
import type { KundeBereich, Kunde } from '../types'

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; imageDataUrl?: string }

// Der Gesprächsverlauf blieb bisher nur im React-State — beim Schließen der CRM-Seite (Tab zu,
// neu laden) war der komplette Chat weg, obwohl das Zu-/Aufklappen des Panels selbst ihn schon
// erhielt (reines Mounten/Unmounten war nie das Problem). Jetzt zusätzlich in localStorage
// gespiegelt, pro Mitarbeiter getrennt (gemeinsam genutzter Bürorechner), mit Obergrenze gegen
// unbegrenztes Wachstum.
const KI_CHAT_MAX_NACHRICHTEN = 100
function kiChatStorageKey(mitarbeiterId: string | undefined): string {
  return `mh_crm_ki_assistent_messages_${mitarbeiterId ?? 'lokal'}`
}
function ladeKiChatNachrichten(mitarbeiterId: string | undefined): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(kiChatStorageKey(mitarbeiterId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}
type PastedImage = { dataUrl: string; base64: string; mediaType: string }
type AufnahmeKunde = { bereich: KundeBereich; kundeId: string; kundeName: string }

// Persistentes Chat-Panel (statt Modal) für den KI-Assistenten — bleibt über die ganze Session
// gemountet (siehe Layout.tsx), damit der Gesprächsverlauf beim Auf-/Zuklappen erhalten bleibt, UND
// zusätzlich in localStorage gespiegelt (siehe ladeKiChatNachrichten oben), damit er auch ein
// Schließen des Tabs/der Seite übersteht. Antworten werden zusätzlich per Sprachausgabe
// vorgelesen (abschaltbar).
export function KiAssistentPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, dispatch, neuLaden } = useApp()
  const { session, mitarbeiter } = useAuth()
  const { supported, recording, transcript, interim, error: recError, start, stop, setTranscript, setInterim, beschaeftigt: schreibtAb } = useSpeechRecognition()
  // Löschen über den Ersatzweg ohne Server (unten, fuehreAktionLeadLoeschenAus) nur für GF/Admin. Im
  // Demo-Modus (ohne Supabase) gibt es keine echten Mitarbeiter-Rollen — dort greift wie überall sonst
  // in der App state.rolle als Ersatz (siehe Layout.tsx resetData-Gate). Mit Server prüft das der Server.
  const loeschenErlaubt = isSupabaseConfigured
    ? !!session && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin)
    : state.rolle === 'geschaeftsfuehrung'
  const followUps = collectFollowUpPriorities(state)

  const [messages, setMessages] = useState<ChatMessage[]>(
    () =>
      ladeKiChatNachrichten(mitarbeiter?.id) ?? [
        { id: uid('msg'), role: 'assistant', text: 'Hallo! Sag oder tipp mir, was du brauchst: Fragen zu Kunden, Notizen, Aufgaben, eine neue Akte oder eine E-Mail an einen oder alle Kunden.' },
      ],
  )
  const [verarbeiten, setVerarbeiten] = useState(false)
  // Vorlesen ist aus, bis es jemand einschaltet (Wunsch aus dem Büro: nicht ungefragt laut vorlesen).
  // Die Wahl und die Fenstergröße bleiben je Browser gemerkt.
  const [ttsEnabled, setTtsEnabled] = useState(() => {
    try {
      return localStorage.getItem('ki-assistent-vorlesen') === 'an'
    } catch {
      return false
    }
  })
  const [gross, setGross] = useState(() => {
    try {
      return localStorage.getItem('ki-assistent-gross') === 'ja'
    } catch {
      return false
    }
  })
  const [liestVor, setLiestVor] = useState<string | null>(null)

  function merke(schluessel: string, wert: string) {
    try {
      localStorage.setItem(schluessel, wert)
    } catch {
      // ohne Browserspeicher gilt die Wahl nur für diese Sitzung
    }
  }

  function schalteVorlesen() {
    const an = !ttsEnabled
    setTtsEnabled(an)
    merke('ki-assistent-vorlesen', an ? 'an' : 'aus')
    if (!an) {
      stopSpeaking() // läuft gerade etwas, sofort verstummen
      setLiestVor(null)
    }
  }

  // Eine einzelne Antwort auf Klick vorlesen (oder das laufende Vorlesen beenden) — unabhängig vom Schalter oben.
  function leseVor(id: string, text: string) {
    if (liestVor === id) {
      stopSpeaking()
      setLiestVor(null)
      return
    }
    setLiestVor(id)
    speak(text, true, () => setLiestVor((jetzt) => (jetzt === id ? null : jetzt)))
  }

  // Fenster zu oder Seite verlassen: nichts redet weiter.
  useEffect(() => {
    if (!open) {
      stopSpeaking()
      setLiestVor(null)
    }
    return () => stopSpeaking()
  }, [open])
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null)
  const [aufnahmeKunde, setAufnahmeKunde] = useState<AufnahmeKunde | null>(null)
  const [recorderOpen, setRecorderOpen] = useState(false)
  // Woher kam die aktuell im Eingabefeld stehende Eingabe — bestimmt, ob die Antwort gesprochen
  // oder nur als Text zurückkommt (gesprochen rein -> gesprochen zurück, getippt rein -> Text
  // zurück), statt wie bisher eines globalen "immer vorlesen, wenn eingeschaltet"-Schalters.
  const [inputModus, setInputModus] = useState<'sprache' | 'text'>('text')
  // Zuletzt im Gespräch erkannter Kunde — Fallback, falls eine Folgeäußerung ("ja, leg ihn auf
  // Wiedervorlage") keinen Namen mehr nennt, sich aber offensichtlich auf denselben Kunden bezieht.
  const [letzterKunde, setLetzterKunde] = useState<KundeMatch | null>(null)
  // Gesetzt, wenn der Assistent gerade wegen Mehrdeutigkeit nachgefragt hat ("wen genau meinst
  // du?") — damit die Antwort darauf (oft nur ein Name) als Klärung der ursprünglichen Frage
  // behandelt wird statt als neue, kontextlose Äußerung.
  const [ausstehendeFrage, setAusstehendeFrage] = useState<{ frageText: string; kandidaten: KundeMatch[] } | null>(null)
  // Fehlendes Feld bei "leg einen Lead an" (Bereich und/oder Firma noch unbekannt) — merkt sich den
  // bisherigen Stand, bis die fehlende Angabe in der nächsten Nachricht nachgereicht wird.
  const [ausstehendeAktion, setAusstehendeAktion] = useState<AssistentKlassifikation | null>(null)
  // Löschen ist nicht ohne Weiteres rückgängig zu machen — deshalb immer erst mit "ja" bestätigen
  // lassen, statt sofort zu löschen (gleiches Muster wie bei der Telegram-Variante).
  const [ausstehendeLoeschung, setAusstehendeLoeschung] = useState<KundeMatch | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dateiWahl = useRef<HTMLInputElement>(null)
  // Zeile über dem Eingabefeld, solange Dateien hochgeladen oder einsortiert werden.
  const [dateiHinweis, setDateiHinweis] = useState('')

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, aufnahmeKunde])

  useEffect(() => {
    try {
      localStorage.setItem(kiChatStorageKey(mitarbeiter?.id), JSON.stringify(messages.slice(-KI_CHAT_MAX_NACHRICHTEN)))
    } catch {
      // z.B. Safari-Privatmodus oder Speicher voll — Chat bleibt dann nur für diese Sitzung erhalten.
    }
  }, [messages, mitarbeiter?.id])

  function addMessage(role: ChatMessage['role'], text: string, sprechen = false, imageDataUrl?: string) {
    setMessages((m) => [...m, { id: uid('msg'), role, text, imageDataUrl }])
    if (sprechen) speak(text, ttsEnabled)
  }

  // Baut denselben Kunden-Kontext wie zuvor inline in senden() und fragt das Modell — ausgelagert,
  // damit sowohl der normale "frage"-Zweig als auch die Auflösung einer Rückfrage (siehe
  // ausstehendeFrage) dieselbe Logik benutzen, statt sie zu duplizieren.
  async function beantworteFrage(match: KundeMatch, frageText: string, sprechen: boolean) {
    addMessage('assistant', `Frage zu ${match.kundeName}: „${frageText}" — ich schaue nach …`)
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === match.bereich)!.get(state).find((k) => k.id === match.kundeId)!
    const protokolle = state.protokolle.filter((p) => p.bereich === match.bereich && p.kundeId === kunde.id)
    const statusLabel = getStatusMap(match.bereich)[kunde.status]?.label ?? kunde.status
    const kontext = [
      `Kunde/Mandant: ${kunde.firma} (${kunde.ansprechpartner})`,
      `Status: ${statusLabel}`,
      `Follow-up: ${fmtDate(kunde.followUp.date)} — ${kunde.followUp.note}${kunde.followUp.done ? ' (erledigt)' : ''}`,
      '',
      'Aktivitäten (neueste zuerst):',
      ...kunde.activities.slice(0, 20).map((a) => `- ${fmtDate(a.date)}: ${a.text}`),
      '',
      'Gesprächsprotokolle (neueste zuerst):',
      ...(protokolle.length > 0
        ? protokolle.flatMap((p) => [
            `- ${fmtDate(p.datum)} "${p.betreff}" (Teilnehmer: ${p.teilnehmer}):`,
            `  Zusammenfassung: ${p.kiZusammenfassung ?? p.text}`,
            ...(p.kernthemen?.length ? [`  Kernthemen: ${p.kernthemen.join(', ')}`] : []),
            ...(p.vereinbarungen?.length ? [`  Vereinbarungen: ${p.vereinbarungen.join(', ')}`] : []),
            ...(p.offenePunkte?.length ? [`  Offene Punkte: ${p.offenePunkte.join(', ')}`] : []),
          ])
        : ['(keine)']),
      '',
      'Vorhandene Dokumente:',
      ...(kunde.dokumente && kunde.dokumente.length > 0 ? kunde.dokumente.map((d) => `- ${d.name}`) : ['(keine)']),
      ...(kunde.unterlagenCheckliste
        ? [
            '',
            'Unterlagen-Checkliste:',
            ...Object.entries(kunde.unterlagenCheckliste).map(([punkt, erledigt]) => `- ${punkt}: ${erledigt ? 'vorhanden' : 'FEHLT NOCH'}`),
          ]
        : []),
    ].join('\n')
    try {
      const antwort = await answerAssistantQuestion(frageText, kontext)
      addMessage('assistant', antwort, sprechen)
    } catch (err) {
      addMessage('assistant', `Antwort konnte nicht abgerufen werden: ${err instanceof Error ? err.message : 'Fehler'}`, sprechen)
    }
  }

  // Fragt den Assistenten auf dem Server (derselbe wie in Telegram) und zeigt seine Antwort. Er schlägt
  // nach, ändert Akten und bereitet E-Mails vor; gesendet wird erst nach ausdrücklicher Freigabe im Gespräch.
  async function frageServer(text: string, sprechen: boolean, bild?: AssistentBild) {
    try {
      const r = await frageAssistent(text, offenerKontext(), bild)
      addMessage('assistant', r.antwort, sprechen)
      if (r.geaendert) await neuLaden().catch(() => undefined)
      if (r.mailStart) warteAufVersand(r.mailStart)
    } catch (err) {
      addMessage('assistant', err instanceof Error ? err.message : 'Der Assistent ist gerade nicht erreichbar.', sprechen)
    }
  }

  // Allgemeine Frage ohne konkret erkannten Kunden (z.B. "was muss ich heute machen", "wie ist mein
  // Stand"). Mit Server beantwortet sie der Assistent dort (er sieht Fälligkeiten und Aufgaben aller
  // Bereiche, die der Mitarbeiter sehen darf). Ohne Server (Demo) wie bisher hier im Browser über den
  // Firmen-Überblick, ergänzt um die eigenen fälligen Follow-ups.
  async function beantworteUebersicht(text: string, sprechen: boolean) {
    if (istServerAssistentVerfuegbar && session) {
      await frageServer(text, sprechen)
      return
    }
    const heute = today()
    const eigeneFaellige = followUps.filter((f) => f.verantwortlich === CURRENT_USER)
    const faelligkeitenAbschnitt = [
      `Heutiges Datum: ${heute}`,
      '',
      `Für ${CURRENT_USER} fällige/überfällige Follow-ups (unabhängig vom Bereich):`,
      ...(eigeneFaellige.length > 0
        ? eigeneFaellige.map((f) => `- ${f.name}, Bereich ${f.bereichLabel}: ${f.note} — fällig ${fmtDate(f.date)}`)
        : ['(keine fälligen Follow-ups)']),
    ].join('\n')
    try {
      const kontext = `${faelligkeitenAbschnitt}\n\n${buildFirmenwissenKontext(state)}`
      const antwort = await answerFirmenwissen(text, kontext)
      addMessage('assistant', antwort, sprechen)
    } catch (err) {
      addMessage('assistant', `Antwort konnte nicht abgerufen werden: ${err instanceof Error ? err.message : 'Fehler'}`, sprechen)
    }
  }

  const AKTION_BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen'] as const

  // Erstes "echtes" Tool des Assistenten: legt direkt einen neuen Kunden/Lead an, statt nur Notizen/
  // Fragen zu bearbeiten. Bewusst als einzelnes, eng begrenztes Tool statt offener Schreibrechte —
  // dieselbe Logik läuft serverseitig auch für Telegram (supabase/functions/telegram-gateway).
  function fuehreAktionLeadAnlegenAus(klass: AssistentKlassifikation, sprechen: boolean) {
    const bereich = klass.aktion_bereich as KundeBereich | undefined
    const firma = klass.aktion_firma ?? klass.erkannter_name
    if (!bereich || !AKTION_BEREICHE.includes(bereich as any)) {
      setAusstehendeAktion(klass)
      addMessage('assistant', `In welchem Bereich soll der Lead angelegt werden? (${AKTION_BEREICHE.join(', ')})`, sprechen)
      return
    }
    if (!firma) {
      setAusstehendeAktion({ ...klass, aktion_bereich: bereich })
      addMessage('assistant', 'Wie soll der Lead/die Firma heißen?', sprechen)
      return
    }
    const neuerKunde: Kunde = {
      id: uid('k'),
      firma,
      ansprechpartner: firma,
      email: '',
      telefon: '',
      prioritaet: 'Mittel',
      status: 'lead',
      followUp: { date: addDays(today(), 2), note: 'Erstkontakt aufnehmen', done: false },
      verantwortlich: CURRENT_USER,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text: 'Per KI-Assistent angelegt.', user: CURRENT_USER }],
    }
    switch (bereich) {
      case 'beratung': dispatch({ type: 'ADD_KUNDE', kunde: neuerKunde }); break
      case 'erben': dispatch({ type: 'ADD_ERBEN_MANDANT', kunde: neuerKunde }); break
      case 'betriebsuebergabe': dispatch({ type: 'ADD_BETRIEBSUEBERGABE_MANDANT', kunde: neuerKunde }); break
      case 'betriebsformen': dispatch({ type: 'ADD_BETRIEBSFORMEN_MANDANT', kunde: neuerKunde }); break
      case 'akademie': dispatch({ type: 'ADD_AKADEMIE_TEILNEHMER', kunde: neuerKunde }); break
      case 'finanzierungen': dispatch({ type: 'ADD_FINANZIERUNGEN_MANDANT', kunde: neuerKunde }); break
    }
    addMessage('assistant', `Erledigt — "${firma}" als neuer Lead bei ${bereich} angelegt, dir zugeordnet.`, sprechen)
  }

  // Löschen ist nicht ohne Weiteres rückgängig zu machen — deshalb nur für GF/Admin und immer erst
  // mit Rückfrage. (Mit Server läuft das Löschen, Verschieben und Zusammenführen von Akten über den
  // Assistenten auf dem Server, ebenfalls nur für GF/Admin und mit Bestätigung.)
  function fuehreAktionLeadLoeschenAus(match: KundeMatch | null, sprechen: boolean) {
    if (!loeschenErlaubt) {
      addMessage('assistant', 'Kunden/Leads löschen darf nur Geschäftsführung/Admin.', sprechen)
      return
    }
    if (!match) {
      addMessage('assistant', 'Welchen Kunden/Lead genau soll ich löschen? Nenn mir bitte den Namen etwas genauer.', sprechen)
      return
    }
    setAusstehendeLoeschung(match)
    addMessage('assistant', `Soll ich "${match.kundeName}" bei ${match.bereich} wirklich unwiderruflich löschen? Antworte mit "ja" zum Bestätigen, sonst passiert nichts.`, sprechen)
  }

  function onPasteInput(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    // Große Bildschirmfotos vorher verkleinern (wie bei der Büroklammer) — der Assistent liest bis
    // etwa 3,5 MB je Bild; ungewöhnliche Formate werden dabei, wenn möglich, zu JPEG.
    void verkleinereBild(file).then((bild) => {
      if (!(BILD_ARTEN as readonly string[]).includes(bild.type)) {
        addMessage('assistant', 'Dieses Bildformat kann ich nicht lesen. Möglich sind JPEG, PNG, WebP und GIF.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(',')[1] ?? ''
        setPastedImage({ dataUrl, base64, mediaType: bild.type })
      }
      reader.readAsDataURL(bild)
    })
  }

  // Ein freigegebener E-Mail-Versand läuft auf dem Server im Hintergrund. Hier wird alle paar
  // Sekunden nachgefragt, bis die Abschlussmeldung da ist (höchstens 20 Minuten lang).
  function warteAufVersand(auftragId: string) {
    let versuche = 0
    const timer = window.setInterval(async () => {
      versuche++
      try {
        const st = await mailStatus()
        if (st.ergebnis?.id === auftragId) {
          window.clearInterval(timer)
          addMessage('assistant', st.ergebnis.text)
          await neuLaden().catch(() => undefined)
          return
        }
      } catch {
        // Verbindung kurz weg — einfach beim nächsten Mal wieder fragen.
      }
      if (versuche >= 240) {
        window.clearInterval(timer)
        addMessage('assistant', 'Zum E-Mail-Versand habe ich noch keine Abschlussmeldung. Frag mich später, ob alles raus ist.')
      }
    }, 5000)
  }

  // Dateien und Fotos direkt hier abgeben — derselbe Weg wie über Telegram, nur ohne Telegram: Die
  // Datei geht in die eigene Ablage, der Assistent auf dem Server liest sie und legt sie in die
  // richtige Akte. Das läuft dort weiter, auch wenn dieses Fenster zugeht.
  async function dateienSchicken(liste: File[]) {
    if (liste.length === 0) return
    if (!istServerAssistentVerfuegbar || !session) {
      addMessage('assistant', 'Dateien kann ich hier erst annehmen, wenn du angemeldet bist.')
      return
    }
    const text = (interim ? `${transcript} ${interim}` : transcript).trim()
    setTranscript('')
    setInterim('')
    const namen = liste.length <= 4 ? liste.map((f) => f.name).join(', ') : `${liste.slice(0, 3).map((f) => f.name).join(', ')} und ${liste.length - 3} weitere`
    addMessage('user', `${liste.length === 1 ? 'Datei' : `${liste.length} Dateien`} geschickt: ${namen}${text ? `\n${text}` : ''}`)
    const sammel = liste.length > 3
    setVerarbeiten(true)
    const bekannt = new Set<string>()
    try {
      ;(await dateiStatus()).ergebnisse.forEach((e) => bekannt.add(e.id))
    } catch {
      // Dann zeigen wir schlimmstenfalls eine ältere Meldung noch einmal.
    }
    let geschickt = 0
    for (const [i, datei] of liste.entries()) {
      setDateiHinweis(liste.length === 1 ? `„${datei.name}" wird hochgeladen …` : `Datei ${i + 1} von ${liste.length} wird hochgeladen …`)
      try {
        await schickeDatei(await verkleinereBild(datei), text, sammel)
        geschickt++
      } catch (err) {
        addMessage('assistant', `„${datei.name}": ${err instanceof Error ? err.message : 'Hochladen fehlgeschlagen.'}`)
      }
    }
    if (geschickt === 0) {
      setDateiHinweis('')
      setVerarbeiten(false)
      return
    }
    if (sammel) {
      // Viele Dateien: nicht darauf warten — das Gespräch bleibt frei, die Meldung kommt nach.
      addMessage('assistant', `${geschickt} Dateien sind gespeichert. Ich sortiere sie der Reihe nach ein und melde mich hier, wenn alles liegt. Das Fenster muss dafür nicht offen bleiben.`)
      setVerarbeiten(false)
    }
    setDateiHinweis(geschickt === 1 ? 'Die Datei wird gelesen und einsortiert …' : `${geschickt} Dateien werden gelesen und einsortiert …`)
    let runden = 0
    let gezeigt = 0
    let ruhig = 0
    const timer = window.setInterval(async () => {
      runden++
      try {
        const st = await dateiStatus()
        for (const e of st.ergebnisse) {
          if (bekannt.has(e.id)) continue
          bekannt.add(e.id)
          gezeigt++
          addMessage('assistant', e.text)
          if (!sammel) setVerarbeiten(false)
          await neuLaden().catch(() => undefined)
        }
        ruhig = !st.laeuft && st.wartend === 0 ? ruhig + 1 : 0
        if (st.wartend > 0) setDateiHinweis(`Noch ${st.wartend} ${st.wartend === 1 ? 'Datei wartet' : 'Dateien warten'} auf das Einsortieren …`)
      } catch {
        // Verbindung kurz weg — beim nächsten Mal wieder fragen.
      }
      // Fertig, wenn zweimal hintereinander nichts mehr läuft oder wartet (höchstens 20 Minuten).
      if ((ruhig >= 2 && runden >= 3) || runden >= 300) {
        window.clearInterval(timer)
        setDateiHinweis('')
        setVerarbeiten(false)
        if (gezeigt === 0) {
          addMessage('assistant', runden >= 300 ? 'Das Einsortieren läuft noch. Die Dateien sind gespeichert; das Ergebnis siehst du in den Akten oder unter „Ungeklärte Eingänge".' : 'Die Dateien sind gespeichert. Wohin sie gekommen sind, siehst du in den Akten oder unter „Ungeklärte Eingänge".')
          await neuLaden().catch(() => undefined)
        }
      }
    }, 4000)
  }

  async function senden() {
    const text = (interim ? `${transcript} ${interim}` : transcript).trim()
    if (!text && !pastedImage) return
    setTranscript('')
    setInterim('')
    // Gesprochen rein -> gesprochen zurück, getippt rein -> nur Text zurück (siehe inputModus oben).
    const sprechen = inputModus === 'sprache' && ttsEnabled

    if (pastedImage) {
      const bild = pastedImage
      addMessage('user', text || '(Bild ohne Text gesendet)', false, bild.dataUrl)
      setPastedImage(null)
      setVerarbeiten(true)
      // Mit Server: an den Assistenten dort (er sieht das Bild nur für diese Nachricht, abgelegt wird es nicht).
      if (istServerAssistentVerfuegbar && session) {
        try {
          await frageServer(text, sprechen, { base64: bild.base64, mediaType: bild.mediaType as AssistentBild['mediaType'] })
        } finally {
          setVerarbeiten(false)
        }
        return
      }
      // Ohne Server (Demo): wie bisher direkt aus dem Browser.
      try {
        const antwort = await answerWithImage(text, bild.base64, bild.mediaType)
        addMessage('assistant', antwort, sprechen)
      } catch (err) {
        addMessage('assistant', `Bild konnte nicht analysiert werden: ${err instanceof Error ? err.message : 'Fehler'}`, sprechen)
      } finally {
        setVerarbeiten(false)
      }
      return
    }
    if (!text) return

    // Bestätigung für eine ausstehende Löschung ("ja" = löschen, alles andere = abbrechen) — immer
    // zuerst prüfen, sonst würde die Antwort wie eine neue, kontextlose Nachricht behandelt.
    if (ausstehendeLoeschung) {
      const pending = ausstehendeLoeschung
      setAusstehendeLoeschung(null)
      addMessage('user', text)
      if (/^ja\b/i.test(text.trim())) {
        dispatch({ type: 'PFLEGE_LOESCHE_KUNDE', id: pending.kundeId, bereich: pending.bereich })
        addMessage('assistant', `Gelöscht: ${pending.kundeName}`, sprechen)
      } else {
        addMessage('assistant', 'Abgebrochen, nichts gelöscht.', sprechen)
      }
      return
    }

    // Fehlendes Feld bei "leg einen Lead an" nachreichen (Bereich oder Firma).
    if (ausstehendeAktion) {
      const pending = ausstehendeAktion
      setAusstehendeAktion(null)
      addMessage('user', text)
      const genannterBereich = AKTION_BEREICHE.find((b) => text.toLowerCase().includes(b))
      const ergaenzt: AssistentKlassifikation = pending.aktion_bereich
        ? { ...pending, aktion_firma: text.trim() }
        : { ...pending, aktion_bereich: genannterBereich }
      fuehreAktionLeadAnlegenAus(ergaenzt, sprechen)
      return
    }

    // Auflösung einer vorherigen Rückfrage ("mehrere passende Kunden gefunden, wen genau meinst
    // du?") — wenn die aktuelle Äußerung genau einen der damals genannten Kandidaten eindeutig
    // benennt, wird direkt die ursprüngliche Frage für diesen Kunden beantwortet, statt die Antwort
    // (z.B. nur ein Name) als komplett neue, kontextlose Äußerung zu klassifizieren.
    if (ausstehendeFrage) {
      const pending = ausstehendeFrage
      setAusstehendeFrage(null)
      const neueTreffer = new Set(suggestKundeKandidaten(state, text).map((k) => k.kundeId))
      const aufgeloest = pending.kandidaten.filter((k) => neueTreffer.has(k.kundeId))
      if (aufgeloest.length === 1) {
        addMessage('user', text)
        setLetzterKunde(aufgeloest[0])
        setVerarbeiten(true)
        try {
          await beantworteFrage(aufgeloest[0], pending.frageText, sprechen)
        } finally {
          setVerarbeiten(false)
        }
        return
      }
      // Nicht eindeutig aufgelöst (z.B. User ignoriert die Rückfrage und fragt etwas anderes) ->
      // ganz normal weiterverarbeiten, nicht in der Rückfrage hängen bleiben.
    }

    // Regelfall: der Assistent auf dem Server (derselbe wie in Telegram), auch für Fragen quer über die
    // ganze Firma und — nur Geschäftsführung/Admin — für Akten verschieben, zusammenführen und löschen.
    // Nur der Wunsch, ein Gespräch aufzunehmen, bleibt hier im Fenster, weil das Mikrofon hier sitzt.
    const willAufnehmen = /\baufnahme\b|\baufzeichn|\bmitschneid|\b(nimm|nehm|zeichne)\b.*\bauf\b/i.test(text)
    if (istServerAssistentVerfuegbar && session && !willAufnehmen) {
      addMessage('user', text)
      setVerarbeiten(true)
      try {
        await frageServer(text, sprechen)
      } finally {
        setVerarbeiten(false)
      }
      return
    }

    addMessage('user', text)
    setVerarbeiten(true)
    try {
      const klass = await classifyAssistantInput(text, today())
      // Kandidaten aus zwei Quellen zusammenführen (per von der KI erkanntem Namen, und per
      // komplettem Text) — bei einer KI-Fehlextraktion kann der Text-Treffer trotzdem der eindeutig
      // bessere sein (siehe echter Fehlgriff beim Testen: "Amberger Feinmechanik" in der Frage, aber
      // KI extrahierte fälschlich einen komplett anderen Namen). Pro Kunde wird nur der höhere der
      // beiden Scores behalten, dann werden nur die Kunden mit dem insgesamt höchsten Score behalten.
      const kandidatenNachId = new Map<string, KundeMatch>()
      for (const k of [...(klass.erkannter_name ? suggestKundeKandidaten(state, klass.erkannter_name) : []), ...suggestKundeKandidaten(state, text)]) {
        const vorhanden = kandidatenNachId.get(k.kundeId)
        if (!vorhanden || k.score > vorhanden.score) kandidatenNachId.set(k.kundeId, k)
      }
      const alleKandidaten = [...kandidatenNachId.values()]
      const topScore = alleKandidaten.length > 0 ? Math.max(...alleKandidaten.map((k) => k.score)) : 0
      const kandidaten = alleKandidaten.filter((k) => k.score === topScore)

      // Mehrdeutig (z.B. nur ein Vorname genannt, der auf mehrere Kunden zutrifft) -> nachfragen
      // statt stillschweigend irgendeinen davon zu nehmen. Gilt für jede Art von Äußerung (Frage,
      // Notiz, Aufgabe, Aufnahme), nicht nur für "frage".
      if (kandidaten.length > 1) {
        if (klass.typ === 'frage') setAusstehendeFrage({ frageText: klass.frage ?? text, kandidaten })
        addMessage(
          'assistant',
          `Dazu habe ich mehrere passende Kunden/Mandanten gefunden: ${kandidaten.map((k) => k.kundeName).join(', ')}. Wen genau meinst du?`,
          sprechen,
        )
        return
      }

      // Fallback auf den zuletzt besprochenen Kunden, wenn die aktuelle Äußerung keinen Namen mehr
      // nennt (z.B. "ja, leg ihn auf Wiedervorlage" als Antwort auf einen proaktiven Vorschlag).
      const match = kandidaten[0] ?? letzterKunde
      if (match) setLetzterKunde(match)

      if (klass.typ === 'frage') {
        const frageText = klass.frage ?? text
        if (!match) {
          // Kein konkreter Kunde erkannt — trotzdem beantworten, auf Basis des gesamten
          // Firmenwissens, statt stillschweigend abzubrechen (deckt bereichsübergreifende Fragen ab).
          await beantworteUebersicht(frageText, sprechen)
        } else {
          await beantworteFrage(match, frageText, sprechen)
        }
      } else if (klass.typ === 'uebersicht') {
        await beantworteUebersicht(text, sprechen)
      } else if (klass.typ === 'aktion_lead_anlegen') {
        fuehreAktionLeadAnlegenAus(klass, sprechen)
      } else if (klass.typ === 'aktion_lead_loeschen') {
        fuehreAktionLeadLoeschenAus(match, sprechen)
      } else if (klass.typ === 'aufnahme') {
        if (!match) {
          addMessage('assistant', 'Für welchen Kunden/Mandanten soll ich aufzeichnen? Nenn mir bitte den Namen.', sprechen)
        } else {
          setAufnahmeKunde({ bereich: match.bereich, kundeId: match.kundeId, kundeName: match.kundeName })
          addMessage('assistant', `Aufnahme für ${match.kundeName} vorbereitet. Klicke unten auf „Jetzt aufnehmen", sobald es losgeht.`, sprechen)
        }
      } else {
        const titel = klass.titel ?? text.slice(0, 80)
        const faelligkeitsDatum = klass.faelligkeitsdatum || today()
        const art = klass.typ === 'aufgabe' ? 'Aufgabe' : 'Notiz'
        if (match) {
          dispatch({
            type: 'ADD_VOICE_TASK',
            bereich: match.bereich,
            kundeId: match.kundeId,
            text: titel,
            followUp: klass.typ === 'aufgabe' ? { date: faelligkeitsDatum, note: titel, done: false } : undefined,
          })
          const falligHinweis = klass.typ === 'aufgabe' ? ` (fällig ${fmtDate(faelligkeitsDatum)})` : ''
          addMessage('assistant', `Erledigt — ${art}${falligHinweis} bei ${match.kundeName} gespeichert: „${titel}"`, sprechen)
        } else {
          dispatch({
            type: 'ADD_NOTIZ',
            notiz: { id: uid('notiz'), text: titel, erstelltAm: today(), faelligkeitsDatum: klass.typ === 'aufgabe' ? faelligkeitsDatum : undefined, erledigt: false },
          })
          addMessage('assistant', `Erledigt — als ${art} auf "Heute" gespeichert: „${titel}" (ich hab keinen passenden Kunden gefunden).`, sprechen)
        }
      }
    } catch (err) {
      addMessage('assistant', `Verarbeitung fehlgeschlagen: ${err instanceof Error ? err.message : 'Fehler'}`, sprechen)
    } finally {
      setVerarbeiten(false)
    }
  }

  const liveText = interim ? `${transcript} ${interim}`.trim() : transcript

  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-5 right-5 z-40 hidden h-14 w-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg hover:bg-accent-700 sm:flex"
        title="KI-Assistent öffnen"
      >
        <Bot size={24} />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end sm:inset-auto sm:bottom-5 sm:right-5">
      <div
        className={`flex h-full w-full flex-col bg-white shadow-2xl sm:rounded-2xl sm:ring-1 sm:ring-slate-200 ${
          gross ? 'sm:h-[calc(100vh-2.5rem)] sm:w-[min(960px,calc(100vw-2.5rem))]' : 'sm:h-[min(760px,calc(100vh-2.5rem))] sm:w-[min(540px,calc(100vw-2.5rem))]'
        }`}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent-600" />
            <span className="text-sm font-semibold text-slate-800">KI-Assistent</span>
          </div>
          <div className="flex items-center gap-1">
            {isSpeechSynthesisSupported && (
              <button
                onClick={schalteVorlesen}
                className={`rounded-md p-1.5 ${ttsEnabled ? 'bg-accent-50 text-accent-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}
                title={ttsEnabled ? 'Vorlesen ist an (nach gesprochenen Fragen) — klicken zum Ausschalten, stoppt auch sofort' : 'Vorlesen ist aus — klicken, damit Antworten auf gesprochene Fragen vorgelesen werden'}
                aria-label={ttsEnabled ? 'Vorlesen ausschalten' : 'Vorlesen einschalten'}
                aria-pressed={ttsEnabled}
              >
                {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}
            <button
              onClick={() => {
                setGross((g) => {
                  merke('ki-assistent-gross', g ? 'nein' : 'ja')
                  return !g
                })
              }}
              className="hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 sm:block"
              title={gross ? 'Fenster verkleinern' : 'Fenster vergrößern'}
              aria-label={gross ? 'Fenster verkleinern' : 'Fenster vergrößern'}
            >
              {gross ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button onClick={onToggle} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Schließen">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Verlauf */}
        <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  m.role === 'user' ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {m.imageDataUrl && <img src={m.imageDataUrl} alt="Angehängtes Bild" className="mb-2 max-h-40 rounded-lg" />}
                {m.text}
                {m.role === 'assistant' && isSpeechSynthesisSupported && (
                  <button
                    onClick={() => leseVor(m.id, m.text)}
                    className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
                    aria-label={liestVor === m.id ? 'Vorlesen beenden' : 'Diese Antwort vorlesen'}
                  >
                    {liestVor === m.id ? <Square size={11} /> : <Volume2 size={12} />} {liestVor === m.id ? 'Stopp' : 'Vorlesen'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {verarbeiten && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-slate-100 px-3.5 py-2 text-sm text-slate-400">
                <Sparkles size={13} className="inline animate-pulse" /> denkt nach …
              </div>
            </div>
          )}

          {aufnahmeKunde && (
            <div className="rounded-xl border border-accent-200 bg-accent-50 p-3">
              <p className="mb-2 text-sm text-slate-700">Aufnahme für <strong>{aufnahmeKunde.kundeName}</strong> bereit.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAufnahmeKunde(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white">
                  Verwerfen
                </button>
                <button
                  onClick={() => setRecorderOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700"
                >
                  <Phone size={13} /> Jetzt aufnehmen
                </button>
              </div>
            </div>
          )}

        </div>

        {recError && (
          <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {recError}
          </div>
        )}

        {!isEmailGatewayConfigured && (
          <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> KI-Assistent noch nicht verbunden.
          </div>
        )}

        {/* Eingabe */}
        <div className="flex-shrink-0 border-t border-slate-100 p-3">
          {pastedImage && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
              <img src={pastedImage.dataUrl} alt="Eingefügtes Bild" className="h-12 w-12 rounded object-cover" />
              <span className="flex-1 text-xs text-slate-500">Bild angehängt — Frage dazu eintippen oder direkt senden.</span>
              <button onClick={() => setPastedImage(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" title="Bild entfernen">
                <X size={14} />
              </button>
            </div>
          )}
          {dateiHinweis && <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{dateiHinweis}</p>}
          <input
            ref={dateiWahl}
            type="file"
            multiple
            accept={DATEI_ARTEN}
            className="hidden"
            onChange={(e) => {
              const liste = Array.from(e.target.files ?? [])
              e.target.value = ''
              void dateienSchicken(liste)
            }}
          />
          <div className="flex items-end gap-2">
            <button
              onClick={() => dateiWahl.current?.click()}
              disabled={verarbeiten || !istServerAssistentVerfuegbar || !session}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-50"
              title="Datei oder Foto schicken — ich lege sie in die richtige Akte"
              aria-label="Datei oder Foto schicken"
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={() => {
                if (recording) {
                  stop()
                } else {
                  setInputModus('sprache')
                  start()
                }
              }}
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                recording ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title={recording ? 'Aufnahme stoppen' : 'Aufnahme starten'}
              disabled={!supported}
            >
              {recording ? <Square size={14} /> : <Mic size={16} />}
            </button>
            <textarea
              className={`${inputClass} max-h-24 flex-1 resize-none text-sm`}
              rows={1}
              value={liveText}
              onChange={(e) => {
                setInputModus('text')
                setTranscript(e.target.value)
              }}
              onPaste={onPasteInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  senden()
                }
              }}
              placeholder={
                schreibtAb
                  ? 'Wird abgeschrieben …'
                  : recording
                    ? 'Ich höre zu … zum Beenden auf das Quadrat klicken'
                    : pastedImage
                      ? 'Frage zum Bild (optional) …'
                      : 'Nachricht oder Datei …'
              }
              title="Bilder per Strg/Cmd+V aus der Zwischenablage einfügen"
            />
            <button
              onClick={senden}
              disabled={!isEmailGatewayConfigured || verarbeiten || schreibtAb || (!liveText.trim() && !pastedImage)}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
              title="Senden"
            >
              {pastedImage ? <ImagePlus size={15} /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>

      <Modal open={recorderOpen && !!aufnahmeKunde} onClose={() => setRecorderOpen(false)} title="Gespräch aufzeichnen" width="max-w-2xl">
        {aufnahmeKunde && (
          <CallRecorder
            onCancel={() => setRecorderOpen(false)}
            onSave={({ transcript: aufnahmeTranscript, summary }) => {
              dispatch({
                type: 'ADD_PROTOKOLL',
                protokoll: {
                  id: uid('p'),
                  bereich: aufnahmeKunde.bereich,
                  kundeId: aufnahmeKunde.kundeId,
                  datum: today(),
                  teilnehmer: `${aufnahmeKunde.kundeName}, ${CURRENT_USER}`,
                  betreff: summary ? 'Telefonat (KI-zusammengefasst)' : 'Telefonat (automatisch transkribiert)',
                  text: aufnahmeTranscript,
                  kernthemen: summary?.kernthemen,
                  vereinbarungen: summary?.vereinbarungen,
                  offenePunkte: summary?.offene_punkte,
                  stimmung: summary?.stimmung,
                  kiZusammenfassung: summary?.zusammenfassung,
                },
              })
              addMessage('assistant', `Protokoll bei ${aufnahmeKunde.kundeName} abgelegt.`, true)
              if (summary?.offene_punkte && summary.offene_punkte.length > 0) {
                const titel = summary.offene_punkte[0]
                dispatch({
                  type: 'ADD_VOICE_TASK',
                  bereich: aufnahmeKunde.bereich,
                  kundeId: aufnahmeKunde.kundeId,
                  text: titel,
                  followUp: { date: addDays(today(), 3), note: titel, done: false },
                })
                addMessage('assistant', `Daraus hab ich gleich einen Follow-up angelegt: „${titel}" (fällig in 3 Tagen).`, true)
              }
              setRecorderOpen(false)
              setAufnahmeKunde(null)
            }}
          />
        )}
      </Modal>
    </div>
  )
}
