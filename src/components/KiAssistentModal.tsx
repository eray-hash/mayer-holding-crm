import { useState } from 'react'
import { Mic, Square, Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useSpeechRecognition } from '../lib/useSpeechRecognition'
import { isEmailGatewayConfigured, classifyAssistantInput, answerAssistantQuestion, type AssistentTyp } from '../lib/emailGateway'
import { suggestKunde } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { today, fmtDate, uid } from '../lib/dates'
import type { KundeBereich } from '../types'

type Phase = 'eingabe' | 'ergebnis'

// Globaler KI-Assistent (Topbar): freies Diktat oder Text wird klassifiziert als Notiz, Aufgabe
// oder Frage. Bei erkanntem Kunden landet eine Aufgabe als Follow-up + Aktivität direkt bei ihm,
// eine Frage wird anhand seiner Historie (Protokolle/Aktivitäten/Status) beantwortet. Ohne
// Kundentreffer landet eine Notiz/Aufgabe stattdessen in der Notizen-Liste auf "Heute".
export function KiAssistentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const { supported, recording, transcript, interim, error: recError, start, stop, setTranscript } = useSpeechRecognition()

  const [phase, setPhase] = useState<Phase>('eingabe')
  const [verarbeiten, setVerarbeiten] = useState(false)
  const [verarbeitenError, setVerarbeitenError] = useState('')

  const [typ, setTyp] = useState<AssistentTyp>('notiz')
  const [titel, setTitel] = useState('')
  const [faelligkeitsDatum, setFaelligkeitsDatum] = useState('')
  const [frageText, setFrageText] = useState('')
  const [kundeAuswahl, setKundeAuswahl] = useState('')

  const [antwortLoading, setAntwortLoading] = useState(false)
  const [antwortError, setAntwortError] = useState('')
  const [antwort, setAntwort] = useState('')

  const [gespeichert, setGespeichert] = useState(false)

  function reset() {
    setTranscript('')
    setPhase('eingabe')
    setVerarbeitenError('')
    setTitel('')
    setFaelligkeitsDatum('')
    setFrageText('')
    setKundeAuswahl('')
    setAntwort('')
    setAntwortError('')
    setGespeichert(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  const alleKunden = KUNDEN_BEREICHE.flatMap((b) =>
    b.get(state).map((k) => ({ bereich: b.id, kundeId: k.id, label: `${k.firma} (${k.ansprechpartner}) · ${b.label}`, kunde: k })),
  )

  async function verarbeiten_() {
    const text = (interim ? `${transcript} ${interim}` : transcript).trim()
    if (!text) return
    setVerarbeiten(true)
    setVerarbeitenError('')
    try {
      const klass = await classifyAssistantInput(text, today())
      setTyp(klass.typ)
      setTitel(klass.titel ?? (klass.typ === 'frage' ? '' : text.slice(0, 80)))
      setFaelligkeitsDatum(klass.faelligkeitsdatum ?? '')
      setFrageText(klass.frage ?? text)

      const match = (klass.erkannter_name && suggestKunde(state, klass.erkannter_name)) || suggestKunde(state, text)
      setKundeAuswahl(match ? `${match.bereich}:${match.kundeId}` : '')

      setPhase('ergebnis')
    } catch (err) {
      setVerarbeitenError(err instanceof Error ? err.message : 'Verarbeitung fehlgeschlagen.')
    } finally {
      setVerarbeiten(false)
    }
  }

  const ausgewaehlterKunde = (() => {
    if (!kundeAuswahl) return null
    const [bereich, kundeId] = kundeAuswahl.split(':') as [KundeBereich, string]
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)?.get(state).find((k) => k.id === kundeId)
    return kunde ? { bereich, kundeId, kunde } : null
  })()

  async function frageBeantworten() {
    if (!ausgewaehlterKunde) return
    setAntwortLoading(true)
    setAntwortError('')
    try {
      const { bereich, kunde } = ausgewaehlterKunde
      const protokolle = state.protokolle.filter((p) => p.bereich === bereich && p.kundeId === kunde.id)
      const statusLabel = getStatusMap(bereich)[kunde.status]?.label ?? kunde.status
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
      setAntwort(await answerAssistantQuestion(frageText, kontext))
    } catch (err) {
      setAntwortError(err instanceof Error ? err.message : 'Antwort konnte nicht abgerufen werden.')
    } finally {
      setAntwortLoading(false)
    }
  }

  function speichern() {
    if (ausgewaehlterKunde) {
      dispatch({
        type: 'ADD_VOICE_TASK',
        bereich: ausgewaehlterKunde.bereich,
        kundeId: ausgewaehlterKunde.kundeId,
        text: titel,
        followUp: typ === 'aufgabe' ? { date: faelligkeitsDatum || today(), note: titel, done: false } : undefined,
      })
    } else {
      dispatch({
        type: 'ADD_NOTIZ',
        notiz: { id: uid('notiz'), text: titel, erstelltAm: today(), faelligkeitsDatum: faelligkeitsDatum || undefined, erledigt: false },
      })
    }
    setGespeichert(true)
  }

  const liveText = interim ? `${transcript} ${interim}`.trim() : transcript

  return (
    <Modal open={open} onClose={handleClose} title="KI-Assistent" width="max-w-lg">
      {phase === 'eingabe' && (
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
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> läuft …
              </span>
            )}
            {!supported && !recording && <span className="text-xs text-slate-400">Live-Transkription evtl. nicht verfügbar — Text unten eintippen geht immer.</span>}
          </div>

          {recError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {recError}
            </div>
          )}

          <Field label="Was möchtest du festhalten oder fragen?">
            <textarea
              className={`${inputClass} font-mono`}
              rows={6}
              value={liveText}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder='z. B. "Muss noch Kunde Müller kontaktieren wegen Unterlagen" oder "Was wurde beim letzten Termin mit Frau Schmidt besprochen?"'
            />
          </Field>

          {verarbeitenError && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {verarbeitenError}
            </div>
          )}

          {!isEmailGatewayConfigured && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> KI-Assistent noch nicht verbunden (Postfach-Function nicht konfiguriert).
            </div>
          )}

          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={handleClose}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={verarbeiten_} disabled={!isEmailGatewayConfigured || verarbeiten || !liveText.trim()}>
              <Sparkles size={14} className={verarbeiten ? 'animate-pulse' : ''} /> {verarbeiten ? 'Verarbeitet …' : 'Verarbeiten'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {phase === 'ergebnis' && !gespeichert && (
        <div>
          <Field label="Art">
            <select className={inputClass} value={typ} onChange={(e) => setTyp(e.target.value as AssistentTyp)}>
              <option value="notiz">Notiz</option>
              <option value="aufgabe">Aufgabe</option>
              <option value="frage">Frage</option>
            </select>
          </Field>

          <Field label="Erkannter Kunde/Mandant (bei Bedarf korrigieren)">
            <select
              className={inputClass}
              value={kundeAuswahl}
              onChange={(e) => {
                setKundeAuswahl(e.target.value)
                setAntwort('')
              }}
            >
              <option value="">— kein Kunde —</option>
              {alleKunden.map((k) => (
                <option key={`${k.bereich}:${k.kundeId}`} value={`${k.bereich}:${k.kundeId}`}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          {typ === 'frage' ? (
            <>
              <Field label="Frage">
                <textarea className={inputClass} rows={2} value={frageText} onChange={(e) => setFrageText(e.target.value)} />
              </Field>

              {!ausgewaehlterKunde ? (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> Für Fragen wird ein erkannter Kunde gebraucht — oben auswählen.
                </div>
              ) : (
                <div className="mb-3">
                  <SecondaryButton onClick={frageBeantworten} disabled={antwortLoading}>
                    <Sparkles size={13} className={antwortLoading ? 'animate-pulse' : ''} /> {antwortLoading ? 'Sucht Antwort …' : 'Antwort holen'}
                  </SecondaryButton>
                </div>
              )}

              {antwortError && (
                <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {antwortError}
                </div>
              )}

              {antwort && <div className="mb-3 rounded-lg border border-accent-200 bg-accent-50 p-4 text-sm text-slate-700">{antwort}</div>}

              <div className="flex justify-end gap-2">
                <SecondaryButton onClick={handleClose}>Schließen</SecondaryButton>
              </div>
            </>
          ) : (
            <>
              <Field label="Titel">
                <input className={inputClass} value={titel} onChange={(e) => setTitel(e.target.value)} />
              </Field>
              {typ === 'aufgabe' && (
                <Field label="Fälligkeitsdatum (optional)">
                  <input type="date" className={inputClass} value={faelligkeitsDatum} onChange={(e) => setFaelligkeitsDatum(e.target.value)} />
                </Field>
              )}
              <p className="mb-3 text-xs text-slate-400">
                {ausgewaehlterKunde
                  ? `Wird als Follow-up + Aktivität bei ${ausgewaehlterKunde.kunde.firma} gespeichert.`
                  : 'Kein Kunde ausgewählt — wird als allgemeine Notiz auf "Heute" gespeichert.'}
              </p>
              <div className="flex justify-end gap-2">
                <SecondaryButton onClick={handleClose}>Abbrechen</SecondaryButton>
                <PrimaryButton onClick={speichern} disabled={!titel.trim()}>
                  Speichern
                </PrimaryButton>
              </div>
            </>
          )}
        </div>
      )}

      {gespeichert && (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={36} />
          <p className="mb-5 text-sm font-medium text-slate-800">Gespeichert.</p>
          <div className="flex justify-center">
            <PrimaryButton onClick={handleClose}>Fertig</PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
