import { useEffect, useRef, useState } from 'react'

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

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// Geteilte Live-Transkriptions-Logik (Web Speech API) — von CallRecorder und KiAssistentModal
// genutzt, damit beide dieselbe Aufnahme-/Fehlerbehandlung haben statt sie zu duplizieren.
export function useSpeechRecognition() {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null)
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
    const SpeechRecognitionCtor = getSpeechRecognitionCtor()
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

  return { supported, recording, transcript, interim, error, start, stop, setTranscript }
}
