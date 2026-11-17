import { useState } from 'react'
import { Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { OBJEKT_TYPEN } from '../data/constants'
import { today, uid } from '../lib/dates'
import type { Gesuch, ObjektTyp } from '../types'

function zahl(text: string): number | undefined {
  const sauber = text.replace(/[^\d]/g, '')
  return sauber ? Number(sauber) : undefined
}

/** Eingabe eines Gesuchs: was gesucht wird, wo, in welchem Preisrahmen. Bewusst kurz — ein Gesuch muss in einer Minute erfasst sein. */
export function GesuchFormular({ gesuch, onSpeichern, onAbbrechen }: { gesuch?: Gesuch; onSpeichern: (g: Gesuch) => void; onAbbrechen: () => void }) {
  const [titel, setTitel] = useState(gesuch?.titel ?? '')
  const [objekttypen, setObjekttypen] = useState<ObjektTyp[]>(gesuch?.objekttypen ?? [])
  const [lage, setLage] = useState(gesuch?.lage ?? '')
  const [budgetMin, setBudgetMin] = useState(gesuch?.budgetMin != null ? String(gesuch.budgetMin) : '')
  const [budgetMax, setBudgetMax] = useState(gesuch?.budgetMax != null ? String(gesuch.budgetMax) : '')
  const [nutzung, setNutzung] = useState<Gesuch['nutzung']>(gesuch?.nutzung ?? 'Unklar')
  const [notizen, setNotizen] = useState(gesuch?.notizen ?? '')

  const hatAngabe = objekttypen.length > 0 || lage.trim() !== '' || zahl(budgetMin) != null || zahl(budgetMax) != null

  function speichern() {
    onSpeichern({
      id: gesuch?.id ?? uid('ges'),
      erstelltAm: gesuch?.erstelltAm ?? today(),
      titel: titel.trim() || [objekttypen.join('/'), lage.trim()].filter(Boolean).join(' in ') || 'Gesuch',
      objekttypen,
      lage: lage.trim(),
      budgetMin: zahl(budgetMin),
      budgetMax: zahl(budgetMax),
      nutzung,
      notizen: notizen.trim(),
      erledigt: gesuch?.erledigt,
    })
  }

  return (
    <div>
      <Field label="Kurzbeschreibung (z. B. „Mehrfamilienhaus Raum Ulm bis 1,5 Mio.“)">
        <input className={inputClass} value={titel} onChange={(e) => setTitel(e.target.value)} />
      </Field>
      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-slate-500">Objektart (keine Auswahl = egal)</span>
        <div className="flex flex-wrap gap-2">
          {OBJEKT_TYPEN.map((t) => {
            const an = objekttypen.includes(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => setObjekttypen((l) => (an ? l.filter((x) => x !== t) : [...l, t]))}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                aria-pressed={an}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>
      <Field label="Lage — Orte oder Regionen, durch Komma getrennt (leer = egal)">
        <input className={inputClass} value={lage} onChange={(e) => setLage(e.target.value)} placeholder="Ulm, Neu-Ulm, Blaubeuren" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Preis von (€)">
          <input className={inputClass} inputMode="numeric" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
        </Field>
        <Field label="Preis bis (€)">
          <input className={inputClass} inputMode="numeric" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="1500000" />
        </Field>
      </div>
      <Field label="Nutzung">
        <select className={inputClass} value={nutzung} onChange={(e) => setNutzung(e.target.value as Gesuch['nutzung'])}>
          <option value="Unklar">Noch unklar</option>
          <option value="Kapitalanlage">Kapitalanlage</option>
          <option value="Eigennutz">Eigennutzung</option>
        </select>
      </Field>
      <Field label="Weitere Wünsche und Notizen">
        <textarea className={`${inputClass} min-h-20`} value={notizen} onChange={(e) => setNotizen(e.target.value)} />
      </Field>
      {!hatAngabe && <p className="mb-3 text-xs text-amber-600">Ohne Objektart, Lage oder Preis kann das Gesuch mit keinem Objekt abgeglichen werden.</p>}
      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={onAbbrechen}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={speichern}>Gesuch speichern</PrimaryButton>
      </div>
    </div>
  )
}
