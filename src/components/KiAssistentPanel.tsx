import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Sparkles, AlertTriangle, Send, X, Volume2, VolumeX, Bot } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useSpeechRecognition } from '../lib/useSpeechRecognition'
import { speak, isSpeechSynthesisSupported } from '../lib/useSpeechSynthesis'
import { isEmailGatewayConfigured, classifyAssistantInput, answerAssistantQuestion, type AssistentTyp } from '../lib/emailGateway'
import { suggestKunde } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { inputClass } from './ui'
import { today, fmtDate, uid } from '../lib/dates'
import type { KundeBereich } from '../types'

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string }

type PendingAction = {
  typ: AssistentTyp
  titel: string
  faelligkeitsDatum: string
  kundeAuswahl: string
  frageText: string
  antwort?: string
  antwortLoading?: boolean
  antwortError?: string
}

// Persistentes Chat-Panel (statt Modal) für den KI-Assistenten — bleibt über die ganze Session
// gemountet (siehe Layout.tsx), damit der Gesprächsverlauf beim Auf-/Zuklappen erhalten bleibt.
// Antworten werden zusätzlich per Sprachausgabe vorgelesen (abschaltbar).
export function KiAssistentPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { state, dispatch } = useApp()
  const { supported, recording, transcript, interim, error: recError, start, stop, setTranscript } = useSpeechRecognition()

  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid('msg'), role: 'assistant', text: 'Hallo! Sag oder tipp mir eine Notiz, eine Aufgabe oder stell mir eine Frage zu einem Kunden.' },
  ])
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [verarbeiten, setVerarbeiten] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  function addMessage(role: ChatMessage['role'], text: string, sprechen = false) {
    setMessages((m) => [...m, { id: uid('msg'), role, text }])
    if (sprechen) speak(text, ttsEnabled)
  }

  const alleKunden = KUNDEN_BEREICHE.flatMap((b) =>
    b.get(state).map((k) => ({ bereich: b.id, kundeId: k.id, label: `${k.firma} (${k.ansprechpartner}) · ${b.label}`, kunde: k })),
  )

  async function senden() {
    const text = (interim ? `${transcript} ${interim}` : transcript).trim()
    if (!text) return
    setTranscript('')
    addMessage('user', text)
    setVerarbeiten(true)
    try {
      const klass = await classifyAssistantInput(text, today())
      const match = (klass.erkannter_name && suggestKunde(state, klass.erkannter_name)) || suggestKunde(state, text)
      const kundeAuswahl = match ? `${match.bereich}:${match.kundeId}` : ''

      if (klass.typ === 'frage') {
        const frageText = klass.frage ?? text
        if (!match) {
          addMessage('assistant', 'Dazu habe ich keinen passenden Kunden gefunden — nenn mir bitte den Namen etwas genauer.', true)
        } else {
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
            'Gesprächsprotokolle:',
            ...(protokolle.length > 0
              ? protokolle.map((p) => `- ${fmtDate(p.datum)} "${p.betreff}" (Teilnehmer: ${p.teilnehmer}): ${p.kiZusammenfassung ?? p.text}`)
              : ['(keine)']),
          ].join('\n')
          try {
            const antwort = await answerAssistantQuestion(frageText, kontext)
            addMessage('assistant', antwort, true)
          } catch (err) {
            addMessage('assistant', `Antwort konnte nicht abgerufen werden: ${err instanceof Error ? err.message : 'Fehler'}`, true)
          }
        }
      } else {
        const titel = klass.titel ?? text.slice(0, 80)
        setPending({ typ: klass.typ, titel, faelligkeitsDatum: klass.faelligkeitsdatum ?? '', kundeAuswahl, frageText: '' })
        const kundeHinweis = match ? ` für ${match.kundeName}` : ' (kein Kunde erkannt — landet als allgemeine Notiz auf "Heute")'
        addMessage('assistant', `Ich habe das als ${klass.typ === 'aufgabe' ? 'Aufgabe' : 'Notiz'}${kundeHinweis} verstanden. Unten kannst du es prüfen und speichern.`, true)
      }
    } catch (err) {
      addMessage('assistant', `Verarbeitung fehlgeschlagen: ${err instanceof Error ? err.message : 'Fehler'}`)
    } finally {
      setVerarbeiten(false)
    }
  }

  function pendingKunde(p: PendingAction) {
    if (!p.kundeAuswahl) return null
    const [bereich, kundeId] = p.kundeAuswahl.split(':') as [KundeBereich, string]
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)?.get(state).find((k) => k.id === kundeId)
    return kunde ? { bereich, kundeId, kunde } : null
  }

  function speichernPending() {
    if (!pending) return
    const ausgewaehlt = pendingKunde(pending)
    if (ausgewaehlt) {
      dispatch({
        type: 'ADD_VOICE_TASK',
        bereich: ausgewaehlt.bereich,
        kundeId: ausgewaehlt.kundeId,
        text: pending.titel,
        followUp: pending.typ === 'aufgabe' ? { date: pending.faelligkeitsDatum || today(), note: pending.titel, done: false } : undefined,
      })
      addMessage('assistant', `Gespeichert bei ${ausgewaehlt.kunde.firma}.`, true)
    } else {
      dispatch({
        type: 'ADD_NOTIZ',
        notiz: { id: uid('notiz'), text: pending.titel, erstelltAm: today(), faelligkeitsDatum: pending.faelligkeitsDatum || undefined, erledigt: false },
      })
      addMessage('assistant', 'Als Notiz auf "Heute" gespeichert.', true)
    }
    setPending(null)
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

          {pending && (
            <div className="rounded-xl border border-accent-200 bg-accent-50 p-3">
              <label className="mb-1 block text-xs font-medium text-slate-500">Art</label>
              <select
                className={`${inputClass} mb-2 text-xs`}
                value={pending.typ}
                onChange={(e) => setPending({ ...pending, typ: e.target.value as AssistentTyp })}
              >
                <option value="notiz">Notiz</option>
                <option value="aufgabe">Aufgabe</option>
              </select>

              <label className="mb-1 block text-xs font-medium text-slate-500">Kunde/Mandant</label>
              <select
                className={`${inputClass} mb-2 text-xs`}
                value={pending.kundeAuswahl}
                onChange={(e) => setPending({ ...pending, kundeAuswahl: e.target.value })}
              >
                <option value="">— kein Kunde —</option>
                {alleKunden.map((k) => (
                  <option key={`${k.bereich}:${k.kundeId}`} value={`${k.bereich}:${k.kundeId}`}>
                    {k.label}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-xs font-medium text-slate-500">Titel</label>
              <input className={`${inputClass} mb-2 text-xs`} value={pending.titel} onChange={(e) => setPending({ ...pending, titel: e.target.value })} />

              {pending.typ === 'aufgabe' && (
                <>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Fälligkeitsdatum</label>
                  <input
                    type="date"
                    className={`${inputClass} mb-2 text-xs`}
                    value={pending.faelligkeitsDatum}
                    onChange={(e) => setPending({ ...pending, faelligkeitsDatum: e.target.value })}
                  />
                </>
              )}

              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setPending(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white">
                  Verwerfen
                </button>
                <button
                  onClick={speichernPending}
                  disabled={!pending.titel.trim()}
                  className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-50"
                >
                  Speichern
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
        <div className="flex flex-shrink-0 items-end gap-2 border-t border-slate-100 p-3">
          <button
            onClick={recording ? stop : start}
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
            onChange={(e) => setTranscript(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                senden()
              }
            }}
            placeholder="Nachricht eingeben oder Mikro nutzen …"
          />
          <button
            onClick={senden}
            disabled={!isEmailGatewayConfigured || verarbeiten || !liveText.trim()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
            title="Senden"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
