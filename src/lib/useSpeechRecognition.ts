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

// Geteilte Live-Transkriptions-Logik (Web Speech API) — von CallRecorder und KiAssistentPanel
// genutzt, damit beide dieselbe Aufnahme-/Fehlerbehandlung haben statt sie zu duplizieren.
export function useSpeechRecognition() {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null)
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [dauerSekunden, setDauerSekunden] = useState(0)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const startZeitpunktRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  // Live-Zeittracking fürs "Gespräch aufzeichnen" — läuft nur während recording, friert beim
  // Stoppen auf dem letzten Stand ein, damit die Gesamtdauer danach noch ausgelesen werden kann.
  useEffect(() => {
    if (!recording) return
    const interval = setInterval(() => {
      if (startZeitpunktRef.current) setDauerSekunden(Math.round((Date.now() - startZeitpunktRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [recording])

  function start() {
    setError('')
    setDauerSekunden(0)
    startZeitpunktRef.current = Date.now()
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

  return { supported, recording, transcript, interim, error, dauerSekunden, start, stop, setTranscript, setInterim }
}
