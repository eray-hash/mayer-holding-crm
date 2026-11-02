import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Sparkles, AlertTriangle, Send, X, Volume2, VolumeX, Bot, ImagePlus, Phone } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useSpeechRecognition } from '../lib/useSpeechRecognition'
import { speak, isSpeechSynthesisSupported } from '../lib/useSpeechSynthesis'
import { isEmailGatewayConfigured, classifyAssistantInput, answerAssistantQuestion, answerWithImage } from '../lib/emailGateway'
import { suggestKundeKandidaten, type KundeMatch } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { CallRecorder } from './CallRecorder'
import { Modal, inputClass } from './ui'
import { today, fmtDate, uid, addDays } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'
import type { KundeBereich } from '../types'

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; imageDataUrl?: string }
type PastedImage = { dataUrl: string; base64: string; mediaType: string }
type AufnahmeKunde = { bereich: KundeBereich; kundeId: string; kundeName: string }

// Persistentes Chat-Panel (statt Modal) für den KI-Assistenten — bleibt über die ganze Session
// gemountet (siehe Layout.tsx), damit der Gesprächsverlauf beim Auf-/Zuklappen erhalten bleibt.
// Antworten werden zusätzlich per Sprachausgabe vorgelesen (abschaltbar).
export function KiAssistentPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, dispatch } = useApp()
  const { supported, recording, transcript, interim, error: recError, start, stop, setTranscript } = useSpeechRecognition()

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid('msg'), role: 'assistant', text: 'Hallo! Sag oder tipp mir eine Notiz, eine Aufgabe oder stell mir eine Frage zu einem Kunden.' },
  ])
  const [verarbeiten, setVerarbeiten] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(true)
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
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, aufnahmeKunde])

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

  function onPasteInput(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1] ?? ''
      setPastedImage({ dataUrl, base64, mediaType: file.type })
    }
    reader.readAsDataURL(file)
  }

  async function senden() {
    const text = (interim ? `${transcript} ${interim}` : transcript).trim()
    if (!text && !pastedImage) return
    setTranscript('')
    // Gesprochen rein -> gesprochen zurück, getippt rein -> nur Text zurück (siehe inputModus oben).
    const sprechen = inputModus === 'sprache' && ttsEnabled

    if (pastedImage) {
      const bild = pastedImage
      addMessage('user', text || '(Bild ohne Text gesendet)', false, bild.dataUrl)
      setPastedImage(null)
      setVerarbeiten(true)
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
          addMessage('assistant', 'Dazu habe ich keinen passenden Kunden gefunden — nenn mir bitte den Namen etwas genauer.', sprechen)
        } else {
          await beantworteFrage(match, frageText, sprechen)
        }
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
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg hover:bg-accent-700"
        title="KI-Assistent öffnen"
      >
        <Bot size={24} />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end sm:inset-auto sm:bottom-5 sm:right-5">
      <div className="flex h-full w-full flex-col bg-white shadow-2xl sm:h-[600px] sm:w-96 sm:rounded-2xl sm:ring-1 sm:ring-slate-200">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent-600" />
            <span className="text-sm font-semibold text-slate-800">KI-Assistent</span>
          </div>
          <div className="flex items-center gap-1">
            {isSpeechSynthesisSupported && (
              <button
                onClick={() => setTtsEnabled((v) => !v)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title={ttsEnabled ? 'Sprachausgabe ausschalten' : 'Sprachausgabe einschalten'}
              >
                {ttsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}
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
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                  m.role === 'user' ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {m.imageDataUrl && <img src={m.imageDataUrl} alt="Angehängtes Bild" className="mb-2 max-h-40 rounded-lg" />}
                {m.text}
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
          <div className="flex items-end gap-2">
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
              placeholder={pastedImage ? 'Frage zum Bild (optional) …' : 'Nachricht eingeben, Mikro nutzen oder Bild einfügen …'}
              title="Bilder per Strg/Cmd+V aus der Zwischenablage einfügen"
            />
            <button
              onClick={senden}
              disabled={!isEmailGatewayConfigured || verarbeiten || (!liveText.trim() && !pastedImage)}
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
