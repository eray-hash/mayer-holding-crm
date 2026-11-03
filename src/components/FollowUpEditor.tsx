import { useState } from 'react'
import { Field, inputClass, PrimaryButton } from './ui'

// Bisher nur in KundenDetail.tsx (Beratung) vorhanden — die anderen fünf Kunde-Bereiche
// (Erben/Betriebsübergabe/Betriebsformen/Akademie/Finanzierungen) zeigten das Follow-up nur
// read-only an, ohne Möglichkeit, Datum/Notiz direkt auf der Detailseite zu ändern (nur die groben
// "+3 Tage"/"erledigt"-Aktionen auf dem Heute-Screen). Gefunden beim Bugfixing-Durchgang 2026-11-03,
// hierher ausgelagert, damit alle sechs Bereiche dieselbe Komponente nutzen.
export function FollowUpForm({
  date,
  note,
  done,
  onSubmit,
}: {
  date: string
  note: string
  done: boolean
  onSubmit: (f: { date: string; note: string; done: boolean }) => void
}) {
  const [d, setD] = useState(date)
  const [n, setN] = useState(note)
  const [done_, setDone] = useState(done)
  return (
    <div>
      <Field label="Datum">
        <input type="date" className={inputClass} value={d} onChange={(e) => setD(e.target.value)} />
      </Field>
      <Field label="Notiz">
        <input className={inputClass} value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={done_} onChange={(e) => setDone(e.target.checked)} className="rounded" /> erledigt
      </label>
      <div className="flex justify-end">
        <PrimaryButton onClick={() => onSubmit({ date: d, note: n, done: done_ })}>Speichern</PrimaryButton>
      </div>
    </div>
  )
}
