import { useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { inputClass } from './ui'
import { MITARBEITER } from '../data/constants'
import type { Kunde, KundeBereich } from '../types'

type StammdatenLabels = { firma?: string; ansprechpartner?: string }

// Stammdaten (Firma/Name, Ansprechpartner, E-Mail, Telefon, Verantwortlich) waren bisher überall nur
// als reine <dl>-Anzeige zu sehen, ohne jede Möglichkeit, sie direkt in der Akte zu bearbeiten —
// z.B. ließ sich eine fehlende Telefonnummer nirgends nachtragen, obwohl genau das die
// Fehlende-Stammdaten-Warnung ausgelöst hat. Nutzer-Feedback: "jedes Feld muss bearbeitbar sein".
// Nutzt die generische UPDATE_KUNDE_IN_BEREICH-Aktion, funktioniert also identisch in allen Bereichen.
export function StammdatenKarte({ bereich, kunde, labels = {} }: { bereich: KundeBereich; kunde: Kunde; labels?: StammdatenLabels }) {
  const { dispatch } = useApp()
  const [bearbeiten, setBearbeiten] = useState(false)
  const [entwurf, setEntwurf] = useState({
    firma: kunde.firma,
    ansprechpartner: kunde.ansprechpartner,
    email: kunde.email,
    telefon: kunde.telefon,
    verantwortlich: kunde.verantwortlich,
  })

  function bearbeitenOeffnen() {
    setEntwurf({
      firma: kunde.firma,
      ansprechpartner: kunde.ansprechpartner,
      email: kunde.email,
      telefon: kunde.telefon,
      verantwortlich: kunde.verantwortlich,
    })
    setBearbeiten(true)
  }

  function speichern() {
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: entwurf })
    setBearbeiten(false)
  }

  const firmaLabel = labels.firma ?? 'Firma'
  const ansprechpartnerLabel = labels.ansprechpartner ?? 'Ansprechpartner'

  if (bearbeiten) {
    return (
      <div className="space-y-2 text-sm">
        <EditRow label={firmaLabel} value={entwurf.firma} onChange={(v) => setEntwurf((x) => ({ ...x, firma: v }))} />
        <EditRow label={ansprechpartnerLabel} value={entwurf.ansprechpartner} onChange={(v) => setEntwurf((x) => ({ ...x, ansprechpartner: v }))} />
        <EditRow label="E-Mail" value={entwurf.email} onChange={(v) => setEntwurf((x) => ({ ...x, email: v }))} />
        <EditRow label="Telefon" value={entwurf.telefon} onChange={(v) => setEntwurf((x) => ({ ...x, telefon: v }))} />
        <div className="flex items-center justify-between gap-3">
          <span className="flex-shrink-0 text-slate-400">Verantwortlich</span>
          <select
            className={`${inputClass} text-right`}
            value={entwurf.verantwortlich}
            onChange={(e) => setEntwurf((x) => ({ ...x, verantwortlich: e.target.value }))}
          >
            {MITARBEITER.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setBearbeiten(false)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50">
            Abbrechen
          </button>
          <button onClick={speichern} className="flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-700">
            <Check size={13} /> Speichern
          </button>
        </div>
      </div>
    )
  }

  return (
    <dl className="space-y-2 text-sm">
      <Row label={firmaLabel} value={kunde.firma} />
      <Row label={ansprechpartnerLabel} value={kunde.ansprechpartner} />
      <Row label="E-Mail" value={kunde.email} />
      <Row label="Telefon" value={kunde.telefon} />
      <Row label="Verantwortlich" value={kunde.verantwortlich} />
      <div className="pt-1 text-right">
        <button onClick={bearbeitenOeffnen} className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline">
          <Pencil size={12} /> Bearbeiten
        </button>
      </div>
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value || '—'}</dd>
    </div>
  )
}

function EditRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="flex-shrink-0 text-slate-400">{label}</label>
      <input className={`${inputClass} text-right`} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
