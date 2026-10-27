// Sprachausgabe (Web Speech API) für den KI-Assistenten — Antworten können vorgelesen werden statt
// nur als Text zu erscheinen. Eigenständig von useSpeechRecognition.ts (das ist Spracheingabe).
export function speak(text: string, enabled: boolean) {
  if (!enabled) return
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel() // vorherige Ausgabe abbrechen statt zu überlappen
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'de-DE'
  synth.speak(utterance)
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel()
}

export const isSpeechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
