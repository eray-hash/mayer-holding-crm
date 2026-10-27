import { useState } from 'react'
import { Phone, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { CallRecorder } from './CallRecorder'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState, Card, StatusBadge } from './ui'
import { fmtDate, today, uid } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'
import type { KundeBereich, Protokoll } from '../types'

// Gebündelte Gesprächsprotokolle-Sektion (manuelles Protokoll + "Gespräch aufzeichnen" mit
// Live-Transkription/KI-Zusammenfassung) — in jedem KundeBereich wiederverwendbar, siehe
// Verwendung in den jeweiligen *Detail.tsx-Seiten.
export function GespraechsprotokolleSection({ bereich, kundeId, kundeName }: { bereich: KundeBereich; kundeId: string; kundeName: string }) {
  const { state, dispatch } = useApp()
  const [protokollOpen, setProtokollOpen] = useState(false)
  const [callRecorderOpen, setCallRecorderOpen] = useState(false)
  const protokolle = state.protokolle.filter((p) => p.bereich === bereich && p.kundeId === kundeId)

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <SecondaryButton onClick={() => setCallRecorderOpen(true)}>
          <Phone size={14} /> Gespräch aufzeichnen
        </SecondaryButton>
        <PrimaryButton onClick={() => setProtokollOpen(true)}>
          <Plus size={14} /> Neues Protokoll
        </PrimaryButton>
      </div>
      <div className="space-y-3">
        {protokolle.map((p) => (
          <ProtokollCard key={p.id} p={p} />
        ))}
        {protokolle.length === 0 && <EmptyState text="Keine Gesprächsprotokolle." />}
      </div>

      <Modal open={protokollOpen} onClose={() => setProtokollOpen(false)} title="Neues Gesprächsprotokoll">
        <ProtokollForm
          onSubmit={(p) => {
            dispatch({ type: 'ADD_PROTOKOLL', protokoll: { ...p, id: uid('p'), bereich, kundeId } })
            setProtokollOpen(false)
          }}
        />
      </Modal>

      <Modal open={callRecorderOpen} onClose={() => setCallRecorderOpen(false)} title="Telefonat aufzeichnen" width="max-w-2xl">
        <CallRecorder
          onCancel={() => setCallRecorderOpen(false)}
          onSave={({ transcript, summary }) => {
            dispatch({
              type: 'ADD_PROTOKOLL',
              protokoll: {
                id: uid('p'),
                bereich,
                kundeId,
                datum: today(),
                teilnehmer: `${kundeName}, ${CURRENT_USER}`,
                betreff: summary ? 'Telefonat (KI-zusammengefasst)' : 'Telefonat (automatisch transkribiert)',
                text: transcript,
                kernthemen: summary?.kernthemen,
                vereinbarungen: summary?.vereinbarungen,
                offenePunkte: summary?.offene_punkte,
                stimmung: summary?.stimmung,
                kiZusammenfassung: summary?.zusammenfassung,
              },
            })
            setCallRecorderOpen(false)
          }}
        />
      </Modal>
    </div>
  )
}

export function ProtokollCard({ p }: { p: Protokoll }) {
  const hasSummary = !!(p.kernthemen?.length || p.vereinbarungen?.length || p.offenePunkte?.length)
  return (
    <Card className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-800">{p.betreff}</span>
        <span className="text-xs text-slate-400">{fmtDate(p.datum)}</span>
      </div>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
        Teilnehmer: {p.teilnehmer}
        {p.stimmung && <StatusBadge label={`Stimmung: ${p.stimmung}`} color="bg-accent-50 text-accent-700" />}
      </div>

      {hasSummary ? (
        <div className="space-y-2.5">
          {p.kiZusammenfassung && <p className="text-sm text-slate-600">{p.kiZusammenfassung}</p>}
          {p.kernthemen && p.kernthemen.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Kernthemen</div>
              <div className="flex flex-wrap gap-1.5">
                {p.kernthemen.map((k, i) => (
                  <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          {p.vereinbarungen && p.vereinbarungen.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Vereinbarungen</div>
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-600">
                {p.vereinbarungen.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
          {p.offenePunkte && p.offenePunkte.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-500">Offene Punkte</div>
              <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-600">
                {p.offenePunkte.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer select-none hover:text-slate-600">Volles Transkript anzeigen</summary>
            <p className="mt-1.5 whitespace-pre-line text-slate-500">{p.text}</p>
          </details>
        </div>
      ) : (
        <p className="text-sm text-slate-600">{p.text}</p>
      )}
    </Card>
  )
}

function ProtokollForm({ onSubmit }: { onSubmit: (p: { datum: string; teilnehmer: string; betreff: string; text: string }) => void }) {
  const [datum, setDatum] = useState(today())
  const [teilnehmer, setTeilnehmer] = useState('')
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')
  return (
    <div>
      <Field label="Datum">
        <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
      </Field>
      <Field label="Teilnehmer">
        <input className={inputClass} value={teilnehmer} onChange={(e) => setTeilnehmer(e.target.value)} />
      </Field>
      <Field label="Betreff">
        <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
      </Field>
      <Field label="Notiz">
        <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={() => onSubmit({ datum, teilnehmer, betreff, text })}>Speichern</PrimaryButton>
      </div>
    </div>
  )
}
