import { useMemo, useState } from 'react'
import { Plus, Check, Mail, Trash2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, SecondaryButton, Modal, Field, inputClass, StatusBadge, EmptyState } from '../../components/ui'
import { fmtDate, fmtEUR, today, uid } from '../../lib/dates'
import type { Verbindlichkeit, VerbindlichkeitStatus } from '../../types'

// Gegenstück zur Rechnungen-Seite: Geld, das Mayer Holding selbst schuldet (Lieferanten-/
// Kostenrechnungen) statt Geld, das Kunden schulden. Wird sowohl automatisch aus eingehenden
// E-Mails befüllt (quelle 'email-automatisch', siehe inbound-email Edge Function) als auch manuell
// angelegt — Nutzer-Entscheidung 2026-11-06.
function istUeberfaellig(v: Verbindlichkeit): boolean {
  return v.status !== 'bezahlt' && !!v.zahlungsziel && v.zahlungsziel < today()
}

function effektiverStatus(v: Verbindlichkeit): VerbindlichkeitStatus {
  if (v.status === 'bezahlt') return 'bezahlt'
  return istUeberfaellig(v) ? 'ueberfaellig' : 'offen'
}

const STATUS_LABEL: Record<VerbindlichkeitStatus, string> = { offen: 'Offen', bezahlt: 'Bezahlt', ueberfaellig: 'Überfällig' }
const STATUS_FARBE: Record<VerbindlichkeitStatus, string> = {
  offen: 'bg-sky-50 text-sky-700',
  bezahlt: 'bg-emerald-50 text-emerald-700',
  ueberfaellig: 'bg-rose-50 text-rose-700',
}

export function Verbindlichkeiten() {
  const { state, dispatch } = useApp()
  const [addOpen, setAddOpen] = useState(false)

  const kpis = useMemo(() => {
    const offen = state.verbindlichkeiten.filter((v) => effektiverStatus(v) !== 'bezahlt').reduce((s, v) => s + (v.betragBrutto ?? 0), 0)
    const ueberfaellig = state.verbindlichkeiten.filter((v) => effektiverStatus(v) === 'ueberfaellig').reduce((s, v) => s + (v.betragBrutto ?? 0), 0)
    const zuPruefen = state.verbindlichkeiten.filter((v) => v.quelle === 'email-automatisch' && (v.betragBrutto === undefined || !v.rechnungsnummer)).length
    return { offen, ueberfaellig, zuPruefen }
  }, [state.verbindlichkeiten])

  const sortiert = useMemo(
    () => [...state.verbindlichkeiten].sort((a, b) => (effektiverStatus(a) === 'bezahlt' ? 1 : 0) - (effektiverStatus(b) === 'bezahlt' ? 1 : 0) || b.datum.localeCompare(a.datum)),
    [state.verbindlichkeiten],
  )

  function alsBezahltMarkieren(v: Verbindlichkeit) {
    dispatch({ type: 'UPDATE_VERBINDLICHKEIT', id: v.id, patch: { status: 'bezahlt' } })
  }
  function loeschen(v: Verbindlichkeit) {
    if (confirm(`Verbindlichkeit "${v.lieferant}" wirklich löschen?`)) dispatch({ type: 'DELETE_VERBINDLICHKEIT', id: v.id })
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Verbindlichkeiten</h1>
          <p className="text-sm text-slate-500">Eingehende Rechnungen, die Mayer Holding selbst bezahlen muss</p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Neue Verbindlichkeit</PrimaryButton>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Offen" value={fmtEUR(kpis.offen)} />
        <Kpi label="Überfällig" value={fmtEUR(kpis.ueberfaellig)} accent="text-rose-600" />
        <Kpi label="Automatisch erkannt, unvollständig" value={String(kpis.zuPruefen)} accent="text-amber-600" />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Lieferant</th>
              <th className="px-4 py-3">Rechnungs-Nr.</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Betrag (netto/brutto)</th>
              <th className="px-4 py-3">Zahlungsziel</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Quelle</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sortiert.map((v) => {
              const status = effektiverStatus(v)
              return (
                <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-700">{v.lieferant}</td>
                  <td className="px-4 py-3 text-slate-500">{v.rechnungsnummer ?? <span className="text-amber-600">zu prüfen</span>}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(v.datum)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {v.betragNetto !== undefined || v.betragBrutto !== undefined
                      ? `${v.betragNetto !== undefined ? fmtEUR(v.betragNetto) : '–'} / ${v.betragBrutto !== undefined ? fmtEUR(v.betragBrutto) : '–'}`
                      : <span className="text-amber-600">zu prüfen</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{v.zahlungsziel ? fmtDate(v.zahlungsziel) : '–'}</td>
                  <td className="px-4 py-3"><StatusBadge label={STATUS_LABEL[status]} color={STATUS_FARBE[status]} /></td>
                  <td className="px-4 py-3 text-slate-400">{v.quelle === 'email-automatisch' ? <span className="inline-flex items-center gap-1"><Mail size={12} /> Mail</span> : 'Manuell'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {status !== 'bezahlt' && (
                        <button onClick={() => alsBezahltMarkieren(v)} title="Als bezahlt markieren" className="rounded-md bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100">
                          <Check size={14} />
                        </button>
                      )}
                      <button onClick={() => loeschen(v)} title="Löschen" className="rounded-md bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {sortiert.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10"><EmptyState text="Keine Verbindlichkeiten." /></td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {addOpen && (
        <NeueVerbindlichkeitModal
          onClose={() => setAddOpen(false)}
          onCreate={(v) => {
            dispatch({ type: 'ADD_VERBINDLICHKEIT', verbindlichkeit: v })
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-slate-800'}`}>{value}</div>
    </Card>
  )
}

function NeueVerbindlichkeitModal({ onClose, onCreate }: { onClose: () => void; onCreate: (v: Verbindlichkeit) => void }) {
  const [lieferant, setLieferant] = useState('')
  const [rechnungsnummer, setRechnungsnummer] = useState('')
  const [datum, setDatum] = useState(today())
  const [betragNetto, setBetragNetto] = useState('')
  const [betragBrutto, setBetragBrutto] = useState('')
  const [zahlungsziel, setZahlungsziel] = useState('')
  const [notiz, setNotiz] = useState('')

  function submit() {
    if (!lieferant.trim()) return
    onCreate({
      id: uid('verb'),
      lieferant,
      rechnungsnummer: rechnungsnummer || undefined,
      datum,
      betragNetto: betragNetto ? Number(betragNetto) : undefined,
      betragBrutto: betragBrutto ? Number(betragBrutto) : undefined,
      zahlungsziel: zahlungsziel || undefined,
      status: 'offen',
      notiz: notiz || undefined,
      quelle: 'manuell',
    })
  }

  return (
    <Modal open onClose={onClose} title="Neue Verbindlichkeit">
      <Field label="Lieferant"><input className={inputClass} value={lieferant} onChange={(e) => setLieferant(e.target.value)} autoFocus /></Field>
      <Field label="Rechnungsnummer"><input className={inputClass} value={rechnungsnummer} onChange={(e) => setRechnungsnummer(e.target.value)} /></Field>
      <Field label="Datum"><input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Betrag netto (€)"><input type="number" className={inputClass} value={betragNetto} onChange={(e) => setBetragNetto(e.target.value)} /></Field>
        <Field label="Betrag brutto (€)"><input type="number" className={inputClass} value={betragBrutto} onChange={(e) => setBetragBrutto(e.target.value)} /></Field>
      </div>
      <Field label="Zahlungsziel"><input type="date" className={inputClass} value={zahlungsziel} onChange={(e) => setZahlungsziel(e.target.value)} /></Field>
      <Field label="Notiz"><textarea className={inputClass} rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={submit} disabled={!lieferant.trim()}>Anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
