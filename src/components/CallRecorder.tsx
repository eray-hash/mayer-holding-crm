import { useEffect, useRef, useState } from 'react'
import { Mic, Square, AlertTriangle, Sparkles } from 'lucide-react'
import { inputClass, Field, PrimaryButton, SecondaryButton } from './ui'
import { isEmailGatewayConfigured, summarizeTranscript, type Gespraechszusammenfassung } from '../lib/emailGateway'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type CallRecorderSave = { transcript: string; summary?: Gespraechszusammenfassung }

export function CallRecorder({ onSave, onCancel }: { onSave: (data: CallRecorderSave) => void; onCancel: () => void }) {
  const [supported] = useState(() => getSpeechRecognition() !== null)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [summary, setSummary] = useState<Gespraechszusammenfassung | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  function start() {
    setError('')
    const SpeechRecognitionCtor = getSpeechRecognition()
    if (!SpeechRecognitionCtor) {
      setError('Dein Browser unterstützt keine Live-Transkription (am besten Google Chrome verwenden). Du kannst den Text unten auch manuell eintippen.')
      return
    }
    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'de-DE'
    recognition.onresult = (event: any) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalChunk += result[0].transcript
        else interimChunk += result[0].transcript
      }
      if (finalChunk) setTranscript((t) => (t ? `${t} ${finalChunk}`.trim() : finalChunk.trim()))
      setInterim(interimChunk)
    }
    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') return
      setError(`Mikrofon-/Transkriptionsfehler: ${event.error}. Du kannst den Text unten auch manuell eintippen oder korrigieren.`)
    }
    recognition.onend = () => {
      setInterim('')
      if (recognitionRef.current === recognition) setRecording(false)
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setRecording(true)
    } catch {
      setError('Aufnahme konnte nicht gestartet werden. Bitte Mikrofon-Zugriff im Browser erlauben.')
    }
  }

  function stop() {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setRecording(false)
  }

  async function summarize() {
    setSummarizing(true)
    setSummaryError('')
    try {
      const result = await summarizeTranscript(transcript.trim())
      setSummary(result)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Zusammenfassung fehlgeschlagen.')
    } finally {
      setSummarizing(false)
    }
  }

  function updateSummaryList(field: 'kernthemen' | 'vereinbarungen' | 'offene_punkte', value: string) {
    if (!summary) return
    setSummary({ ...summary, [field]: value.split('\n').map((s) => s.trim()).filter(Boolean) })
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 rounded-lg bg-slate-50 p-4">
        {!recording ? (
          <PrimaryButton onClick={start}>
            <Mic size={15} /> Aufnahme starten
          </PrimaryButton>
        ) : (
          <SecondaryButton onClick={stop} className="border-rose-300 text-rose-600 hover:bg-rose-50">
            <Square size={13} /> Aufnahme stoppen
          </SecondaryButton>
        )}
        {recording && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> läuft … spricht ins Mikrofon
          </span>
        )}
        {!supported && !recording && (
          <span className="text-xs text-slate-400">Live-Transkription evtl. nicht verfügbar — Text unten manuell eintippen geht immer.</span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}

      <label className="mb-1.5 block text-xs font-medium text-slate-500">Transkript (live editierbar)</label>
      <textarea
        className={`${inputClass} font-mono`}
        rows={10}
        value={interim ? `${transcript} ${interim}`.trim() : transcript}
        onChange={(e) => setTranscript(e.target.value)}
        placeholder="Transkript erscheint hier während des Gesprächs — oder einfach manuell eintippen/einfügen."
      />

      {isEmailGatewayConfigured && (
        <div className="mt-3">
          <SecondaryButton onClick={summarize} disabled={!transcript.trim() || summarizing}>
            <Sparkles size={13} className={summarizing ? 'animate-pulse' : ''} />
            {summarizing ? 'Fasst zusammen …' : summary ? 'Erneut zusammenfassen' : 'Mit KI zusammenfassen'}
          </SecondaryButton>
        </div>
      )}

      {summaryError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> KI-Zusammenfassung nicht verfügbar: {summaryError}
        </div>
      )}

      {summary && (
        <div className="mt-4 space-y-3 rounded-lg border border-accent-200 bg-accent-50 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-accent-700">KI-Zusammenfassung (editierbar)</h4>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-accent-700">Stimmung: {summary.stimmung}</span>
          </div>
          <Field label="Zusammenfassung">
            <textarea
              className={inputClass}
              rows={3}
              value={summary.zusammenfassung}
              onChange={(e) => setSummary({ ...summary, zusammenfassung: e.target.value })}
            />
          </Field>
          <Field label="Kernthemen (eine Zeile je Punkt)">
            <textarea
              className={inputClass}
              rows={3}
              value={summary.kernthemen.join('\n')}
              onChange={(e) => updateSummaryList('kernthemen', e.target.value)}
            />
          </Field>
          <Field label="Vereinbarungen (eine Zeile je Punkt)">
            <textarea
              className={inputClass}
              rows={3}
              value={summary.vereinbarungen.join('\n')}
              onChange={(e) => updateSummaryList('vereinbarungen', e.target.value)}
            />
          </Field>
          <Field label="Offene Punkte (eine Zeile je Punkt)">
            <textarea
              className={inputClass}
              rows={3}
              value={summary.offene_punkte.join('\n')}
              onChange={(e) => updateSummaryList('offene_punkte', e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onCancel}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={() => onSave({ transcript: transcript.trim(), summary: summary ?? undefined })} disabled={!transcript.trim()}>
          Als Gesprächsprotokoll speichern
        </PrimaryButton>
      </div>
    </div>
  )
}
