import { useState } from 'react'
import { Sparkles, Plus, Loader2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { analysierePotenzial, type PotenzialChance } from '../lib/emailGateway'
import { Card, PrimaryButton, PriorityBadge, EmptyState } from './ui'
import { fmtDate, addDays, today } from '../lib/dates'
import type { KundeBereich } from '../types'

// Label für die Bereichs-Badge einer vorgeschlagenen Chance — bewusst alle sieben Bereiche
// (inkl. Immobilien), auch wenn diese Section nur in den sechs KundeBereich-Detailseiten
// eingebunden wird: eine Chance kann ja auf Immobilien als Zielbereich zeigen.
const BEREICH_LABELS: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
}

// KI-gestützte Cross-Sell-/Upsell-Potenzialanalyse für einen Kunden/Mandanten — nutzt allgemeines
// KI-Fachwissen zu den Leistungsbereichen der Holding (siehe email-gateway "potenzial_analyse"),
// da keine echte Otto-Schmidt-Verlag-Anbindung lizenziert ist. In allen sechs KundeBereich-
// Detailseiten wiederverwendbar, analog zu GespraechsprotokolleSection.
export function PotenzialAnalyseSection({ bereich, kundeId, kundeName }: { bereich: KundeBereich; kundeId: string; kundeName: string }) {
  const { state, dispatch } = useApp()
  const [chancen, setChancen] = useState<PotenzialChance[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uebernommen, setUebernommen] = useState<Set<number>>(new Set())

  async function analysieren() {
    setLoading(true)
    setError('')
    try {
      const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
      if (!kunde) throw new Error('Kunde/Mandant nicht gefunden.')
      const protokolle = state.protokolle.filter((p) => p.bereich === bereich && p.kundeId === kundeId)
      const statusLabel = getStatusMap(bereich)[kunde.status]?.label ?? kunde.status
      const kontext = [
        `Kunde/Mandant: ${kunde.firma} (${kunde.ansprechpartner})`,
        `Aktuell betreuter Bereich: ${BEREICH_LABELS[bereich]}`,
        `Status: ${statusLabel}`,
        `Priorität: ${kunde.prioritaet}`,
        '',
        'Aktivitäten (neueste zuerst):',
        ...(kunde.activities.length > 0 ? kunde.activities.slice(0, 20).map((a) => `- ${fmtDate(a.date)}: ${a.text}`) : ['(keine)']),
        '',
        'Gesprächsprotokolle:',
        ...(protokolle.length > 0
          ? protokolle.map((p) => `- ${fmtDate(p.datum)} "${p.betreff}": ${p.kiZusammenfassung ?? p.text}`)
          : ['(keine)']),
      ].join('\n')
      const result = await analysierePotenzial(kontext)
      setChancen(result)
      setUebernommen(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyse fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  function alsFollowUpUebernehmen(c: PotenzialChance, index: number) {
    dispatch({
      type: 'ADD_POTENZIAL_NOTIZ',
      bereich,
      kundeId,
      titel: c.titel,
      begruendung: c.begruendung,
      followUp: { date: addDays(today(), 3), note: c.naechster_schritt, done: false },
    })
    setUebernommen((s) => new Set(s).add(index))
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Lässt die KI auf Basis der Daten zu {kundeName} prüfen, ob weitere Leistungen der Holding für diesen Kunden sinnvoll sein könnten.
        </p>
        <PrimaryButton onClick={analysieren} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? 'Analysiere …' : chancen ? 'Erneut analysieren' : 'Potenzial analysieren'}
        </PrimaryButton>
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{error}</p>}

      {chancen && chancen.length === 0 && !error && <EmptyState text="Aktuell keine zusätzliche Chance erkennbar." />}

      {chancen && chancen.length > 0 && (
        <div className="space-y-3">
          {chancen.map((c, i) => (
            <Card key={i} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">{BEREICH_LABELS[c.bereich] ?? c.bereich}</span>
                <PriorityBadge value={c.prioritaet} />
              </div>
              <p className="mb-1 text-sm font-medium text-slate-800">{c.titel}</p>
              <p className="mb-2 text-sm text-slate-600">{c.begruendung}</p>
              <p className="mb-3 text-xs text-slate-400">Nächster Schritt: {c.naechster_schritt}</p>
              {uebernommen.has(i) ? (
                <p className="text-xs font-medium text-emerald-600">Als Follow-up übernommen.</p>
              ) : (
                <button
                  onClick={() => alsFollowUpUebernehmen(c, i)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Plus size={13} /> Als Follow-up übernehmen
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      {!chancen && !loading && !error && <EmptyState text="Noch keine Analyse durchgeführt." />}
    </div>
  )
}
