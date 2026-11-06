import { useState } from 'react'
import { Save } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card, Field, inputClass, PrimaryButton } from './ui'
import { fmtEUR, today } from '../lib/dates'
import type { KundeBereich, Unternehmensbewertung } from '../types'

function leererEntwurf(): Unternehmensbewertung {
  return {
    jahresumsatz: undefined,
    ebit: undefined,
    ebitda: undefined,
    substanzwert: undefined,
    nachhaltigerJahresueberschuss: undefined,
    branchenmultiplikator: 5,
    kapitalisierungszinsProzent: 10,
    notizen: '',
    erstelltAm: today(),
  }
}

// Echte Unternehmensbewertung (Kaufpreis-Schätzung), keine bloße KI-Einschätzung — Nutzer-
// Entscheidung 2026-11-06. Kombiniert die drei gängigen Praxis-Verfahren und zeigt eine Spanne,
// da jede Bewertung eine Schätzung mit Ermessensspielraum bleibt. Live berechnet aus den
// eingegebenen Werten, nichts wird fest vorgerechnet gespeichert.
function berechneErgebnisse(b: Unternehmensbewertung) {
  const ergebnisse: { verfahren: string; wert: number; basis: string }[] = []
  if (b.ebit !== undefined && b.branchenmultiplikator) {
    ergebnisse.push({ verfahren: 'Multiplikatorverfahren', wert: b.ebit * b.branchenmultiplikator, basis: `EBIT ${fmtEUR(b.ebit)} × Faktor ${b.branchenmultiplikator}` })
  }
  if (b.nachhaltigerJahresueberschuss !== undefined && b.kapitalisierungszinsProzent) {
    ergebnisse.push({
      verfahren: 'Ertragswertverfahren',
      wert: b.nachhaltigerJahresueberschuss / (b.kapitalisierungszinsProzent / 100),
      basis: `Nachhaltiger Jahresüberschuss ${fmtEUR(b.nachhaltigerJahresueberschuss)} / ${b.kapitalisierungszinsProzent}%`,
    })
  }
  if (b.substanzwert !== undefined) {
    ergebnisse.push({ verfahren: 'Substanzwertverfahren (Wertuntergrenze)', wert: b.substanzwert, basis: 'Nettovermögen laut Eingabe' })
  }
  return ergebnisse
}

export function UnternehmensbewertungSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const [entwurf, setEntwurf] = useState<Unternehmensbewertung>(kunde?.unternehmensbewertung ?? leererEntwurf())
  const [bearbeiten, setBearbeiten] = useState(!kunde?.unternehmensbewertung)

  if (!kunde) return null

  function speichern() {
    dispatch({ type: 'SET_UNTERNEHMENSBEWERTUNG', bereich, kundeId, bewertung: { ...entwurf, erstelltAm: today() } })
    setBearbeiten(false)
  }

  const ergebnisse = berechneErgebnisse(bearbeiten ? entwurf : kunde.unternehmensbewertung ?? entwurf)
  const werte = ergebnisse.map((e) => e.wert)
  const min = werte.length > 0 ? Math.min(...werte) : undefined
  const max = werte.length > 0 ? Math.max(...werte) : undefined
  const mittel = werte.length > 0 ? werte.reduce((a, b) => a + b, 0) / werte.length : undefined

  return (
    <div className="space-y-4">
      {!bearbeiten && kunde.unternehmensbewertung ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Unternehmensbewertung</h4>
            <button onClick={() => setBearbeiten(true)} className="text-xs font-medium text-accent-600 hover:underline">Bearbeiten</button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-400">Jahresumsatz</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.jahresumsatz !== undefined ? fmtEUR(kunde.unternehmensbewertung.jahresumsatz) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">EBIT</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.ebit !== undefined ? fmtEUR(kunde.unternehmensbewertung.ebit) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">EBITDA</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.ebitda !== undefined ? fmtEUR(kunde.unternehmensbewertung.ebitda) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Substanzwert</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.substanzwert !== undefined ? fmtEUR(kunde.unternehmensbewertung.substanzwert) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Nachhaltiger Jahresüberschuss</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.nachhaltigerJahresueberschuss !== undefined ? fmtEUR(kunde.unternehmensbewertung.nachhaltigerJahresueberschuss) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Branchenmultiplikator</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.branchenmultiplikator}×</dd></div>
            <div><dt className="text-xs text-slate-400">Kapitalisierungszins</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.kapitalisierungszinsProzent}%</dd></div>
          </dl>
          {kunde.unternehmensbewertung.notizen && <p className="mt-2 text-sm text-slate-600">{kunde.unternehmensbewertung.notizen}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Unternehmensbewertung erfassen</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Jahresumsatz (€)">
              <input type="number" className={inputClass} value={entwurf.jahresumsatz ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, jahresumsatz: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="EBIT (€)">
              <input type="number" className={inputClass} value={entwurf.ebit ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, ebit: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="EBITDA (€)">
              <input type="number" className={inputClass} value={entwurf.ebitda ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, ebitda: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Substanzwert / Nettovermögen (€)">
              <input type="number" className={inputClass} value={entwurf.substanzwert ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, substanzwert: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Nachhaltiger Jahresüberschuss (€)">
              <input type="number" className={inputClass} value={entwurf.nachhaltigerJahresueberschuss ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, nachhaltigerJahresueberschuss: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Branchenmultiplikator (× EBIT)">
              <input type="number" step="0.1" className={inputClass} value={entwurf.branchenmultiplikator} onChange={(e) => setEntwurf((x) => ({ ...x, branchenmultiplikator: Number(e.target.value) || 0 }))} />
            </Field>
            <Field label="Kapitalisierungszins (%)">
              <input type="number" step="0.5" className={inputClass} value={entwurf.kapitalisierungszinsProzent} onChange={(e) => setEntwurf((x) => ({ ...x, kapitalisierungszinsProzent: Number(e.target.value) || 0 }))} />
            </Field>
          </div>
          <Field label="Notizen">
            <textarea className={inputClass} rows={2} value={entwurf.notizen} onChange={(e) => setEntwurf((x) => ({ ...x, notizen: e.target.value }))} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            {kunde.unternehmensbewertung && <button onClick={() => setBearbeiten(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>}
            <PrimaryButton onClick={speichern}><Save size={14} /> Speichern</PrimaryButton>
          </div>
        </Card>
      )}

      {ergebnisse.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Ergebnis (Schätzung, keine exakte Zahl)</h4>
          <div className="mb-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-400">Minimum</div>
              <div className="text-sm font-semibold text-slate-700">{min !== undefined ? fmtEUR(min) : '—'}</div>
            </div>
            <div className="rounded-lg bg-accent-50 p-3">
              <div className="text-xs text-accent-600">Mittelwert</div>
              <div className="text-base font-semibold text-accent-700">{mittel !== undefined ? fmtEUR(mittel) : '—'}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-400">Maximum</div>
              <div className="text-sm font-semibold text-slate-700">{max !== undefined ? fmtEUR(max) : '—'}</div>
            </div>
          </div>
          <ul className="space-y-1.5 text-sm">
            {ergebnisse.map((e) => (
              <li key={e.verfahren} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                <span className="text-slate-500">{e.verfahren} <span className="text-xs text-slate-400">({e.basis})</span></span>
                <span className="font-medium text-slate-700">{fmtEUR(e.wert)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
