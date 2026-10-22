import { useEffect, useRef, useState } from 'react'
import { Mic, Square, AlertTriangle } from 'lucide-react'
import { inputClass, PrimaryButton, SecondaryButton } from './ui'

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

export function CallRecorder({ onSave, onCancel }: { onSave: (transcript: string) => void; onCancel: () => void }) {
  const [supported] = useState(() => getSpeechRecognition() !== null)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

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

      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onCancel}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={() => onSave(transcript.trim())} disabled={!transcript.trim()}>
          Als Gesprächsprotokoll speichern
        </PrimaryButton>
      </div>
    </div>
  )
}
