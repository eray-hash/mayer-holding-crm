import { useEffect, useRef, useState } from 'react'
import { abhoerenVerfuegbar, schreibeAb } from './assistentServer'

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

// Geteilte Aufnahme-Logik für CallRecorder und KiAssistentPanel. Zwei Wege, eine Schnittstelle:
//
// - "abschrift": Ist auf dem Server die Abschrift eingerichtet (Whisper), wird echter Ton aufgenommen
//   und abschnittsweise dorthin geschickt. Der Text erscheint nach jedem Abschnitt und nach dem
//   Stoppen; `beschaeftigt` ist wahr, solange noch ein Abschnitt abgeschrieben wird. Deutlich genauer
//   als der Browser, dafür nicht Wort für Wort live.
// - "browser": sonst die eingebaute Spracherkennung des Browsers (live, aber ungenau; nur Chrome).
export type AufnahmeModus = 'abschrift' | 'browser'

// Länge eines Abschnitts. Kurz genug, dass bei einem langen Gespräch laufend Text nachkommt, lang
// genug, dass Sätze selten mitten durchgeschnitten werden.
const ABSCHNITT_SEKUNDEN = 75

function aufnahmeFormat(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function useSpeechRecognition() {
  const [modus, setModus] = useState<AufnahmeModus>('browser')
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [recording, setRecording] = useState(false)
  const supported = modus === 'abschrift' || getSpeechRecognitionCtor() !== null
  const streamRef = useRef<MediaStream | null>(null)
  const rekorderRef = useRef<MediaRecorder | null>(null)
  const abschnittTimerRef = useRef<number | null>(null)
  const ketteRef = useRef<Promise<void>>(Promise.resolve())
  const ausstehendRef = useRef(0)
  const textRef = useRef('')

  useEffect(() => {
    let aktiv = true
    abhoerenVerfuegbar().then((ok) => {
      if (aktiv && ok && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia) setModus('abschrift')
    })
    return () => {
      aktiv = false
    }
  }, [])
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [dauerSekunden, setDauerSekunden] = useState(0)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const startZeitpunktRef = useRef<number | null>(null)

  useEffect(() => {
    textRef.current = transcript
  }, [transcript])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
      if (abschnittTimerRef.current) window.clearInterval(abschnittTimerRef.current)
      if (rekorderRef.current?.state === 'recording') rekorderRef.current.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // ---------- Weg "abschrift": Ton aufnehmen, in Abschnitten abschreiben lassen ----------

  function reiheEin(aufnahme: Blob) {
    if (aufnahme.size < 2500) return // praktisch leer (Knopf versehentlich doppelt gedrückt)
    ausstehendRef.current++
    setBeschaeftigt(true)
    // Nacheinander, damit die Abschnitte in der gesprochenen Reihenfolge im Text landen.
    ketteRef.current = ketteRef.current.then(async () => {
      try {
        const text = await schreibeAb(aufnahme, textRef.current.slice(-400))
        if (text) setTranscript((t) => (t ? `${t} ${text}`.trim() : text))
      } catch (err) {
        setError(`${err instanceof Error ? err.message : 'Die Abschrift ist fehlgeschlagen.'} Du kannst den Text unten auch manuell eintippen oder korrigieren.`)
      } finally {
        ausstehendRef.current--
        if (ausstehendRef.current === 0) setBeschaeftigt(false)
      }
    })
  }

  function neuerAbschnitt(stream: MediaStream) {
    const format = aufnahmeFormat()
    const rekorder = format ? new MediaRecorder(stream, { mimeType: format }) : new MediaRecorder(stream)
    const teile: Blob[] = []
    rekorder.ondataavailable = (e) => {
      if (e.data.size > 0) teile.push(e.data)
    }
    rekorder.onstop = () => reiheEin(new Blob(teile, { type: rekorder.mimeType || format || 'audio/webm' }))
    rekorder.start()
    rekorderRef.current = rekorder
  }

  async function startAbschrift() {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setError('Aufnahme konnte nicht gestartet werden. Bitte Mikrofon-Zugriff im Browser erlauben.')
      return
    }
    streamRef.current = stream
    neuerAbschnitt(stream)
    setRecording(true)
    // Abschnittswechsel: erst den neuen Abschnitt starten, dann den alten beenden — so fehlt kein Wort.
    abschnittTimerRef.current = window.setInterval(() => {
      const alter = rekorderRef.current
      neuerAbschnitt(stream)
      if (alter?.state === 'recording') alter.stop()
    }, ABSCHNITT_SEKUNDEN * 1000)
  }

  function stopAbschrift() {
    if (abschnittTimerRef.current) window.clearInterval(abschnittTimerRef.current)
    abschnittTimerRef.current = null
    if (rekorderRef.current?.state === 'recording') rekorderRef.current.stop()
    rekorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRecording(false)
  }

  // ---------- gemeinsam ----------

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
    if (modus === 'abschrift') {
      void startAbschrift()
      return
    }
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
    if (modus === 'abschrift') {
      stopAbschrift()
      return
    }
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setRecording(false)
  }

  return { supported, recording, transcript, interim, error, dauerSekunden, start, stop, setTranscript, setInterim, modus, beschaeftigt }
}
