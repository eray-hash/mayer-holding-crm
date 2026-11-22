// Chance-Vorschlag und erwarteter Umsatz im Checklisten-Fenster (22.11.2026): zeigt den gespeicherten
// Vorschlag (kunden.chance_vorschlag) grau mit „übernehmen“ und die Felder „Erwarteter Umsatz netto“ und
// „Erwarteter Monat“. Gespeichert wird mit dem Speichern-Knopf des Fensters (ChecklisteBearbeiten).
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fmtEURCent } from '../lib/dates'
import { berechneChanceVorschlaege, ladeChanceVorschlaege, type ChanceVorschlag } from '../lib/chanceVorschlag'
import { monatName } from '../../supabase/functions/_shared/umsatzKern.ts'

export function ChanceVorschlagFeld({
  kundeId, nurLesen, kvUmsatz, umsatz, setUmsatz, monat, setMonat, onUebernehmen,
}: {
  kundeId: string
  nurLesen: boolean
  /** Netto aus den Kostenvoranschlägen der Akte (0 = keiner mit Betrag). */
  kvUmsatz: number
  /** Eingabefeld „Erwarteter Umsatz netto“ (Text, leer = keiner). */
  umsatz: string
  setUmsatz: (s: string) => void
  /** JJJJ-MM oder leer. */
  monat: string
  setMonat: (s: string) => void
  /** Vorschlag in die Felder des Fensters übernehmen (Chance, Begründung, bestätigt; Umsatz/Monat setzt diese Komponente). */
  onUebernehmen: (v: ChanceVorschlag) => void
}) {
  const [vorschlag, setVorschlag] = useState<ChanceVorschlag | undefined>()
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    ladeChanceVorschlaege(kundeId).then((m) => aktiv && setVorschlag(m.get(kundeId))).catch(() => undefined)
    return () => {
      aktiv = false
    }
  }, [kundeId])

  async function neuBerechnen() {
    setLaeuft(true)
    setFehler('')
    try {
      const e = await berechneChanceVorschlaege({ kundeIds: [kundeId] })
      const v = e.vorschlaege.get(kundeId)
      setVorschlag(v)
      if (!v) setFehler(e.text || 'Für diese Akte gibt es keinen Vorschlag (abgeschlossen oder schon bestätigt).')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Der Vorschlag ließ sich nicht berechnen.')
    } finally {
      setLaeuft(false)
    }
  }

  function uebernehmen(v: ChanceVorschlag) {
    if (kvUmsatz <= 0) {
      setUmsatz(v.umsatzNetto ? String(v.umsatzNetto) : '')
      setMonat(v.umsatzNetto && v.monat ? v.monat : '')
    }
    onUebernehmen(v)
  }

  const feld = 'block text-xs font-medium text-slate-500 mb-1'
  return (
    <div className="space-y-2">
      {vorschlag && (
        <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-slate-600">
              Vorschlag{vorschlag.quelle === 'ki' ? ' (vom Assistenten geprüft)' : ''}: {vorschlag.chanceBestaetigt ? '' : `${vorschlag.prozent} % · `}
              {vorschlag.umsatzNetto ? fmtEURCent(vorschlag.umsatzNetto) : 'ohne Umsatz'}
              {vorschlag.monat ? ` · ${monatName(vorschlag.monat)}` : ''}
            </span>
            <span className="block">{vorschlag.begruendung}</span>
          </span>
          {!nurLesen && (
            <button type="button" onClick={() => uebernehmen(vorschlag)} className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:border-sky-500 hover:text-sky-700">
              übernehmen
            </button>
          )}
        </div>
      )}
      {!nurLesen && (
        <button type="button" onClick={neuBerechnen} disabled={laeuft} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-sky-700 disabled:opacity-50">
          <RefreshCw size={12} className={laeuft ? 'animate-spin' : ''} /> {laeuft ? 'Vorschlag wird berechnet …' : vorschlag ? 'Vorschlag neu berechnen' : 'Vorschlag für Chance und Umsatz berechnen'}
        </button>
      )}
      {fehler && <p className="text-xs text-rose-600">{fehler}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="block">
          <span className={feld}>Erwarteter Umsatz netto (€)</span>
          <input
            type="number"
            min={0}
            step={50}
            value={umsatz}
            onChange={(e) => setUmsatz(e.target.value)}
            disabled={nurLesen}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-accent-400 disabled:bg-slate-50"
            placeholder={kvUmsatz > 0 ? 'zählt aus dem Kostenvoranschlag' : 'z. B. 3850'}
          />
        </label>
        <label className="block">
          <span className={feld}>Erwarteter Monat</span>
          <input
            type="month"
            value={monat}
            onChange={(e) => setMonat(e.target.value)}
            disabled={nurLesen}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-accent-400 disabled:bg-slate-50"
          />
        </label>
      </div>
      <p className="text-xs text-slate-400">
        {kvUmsatz > 0
          ? `In der Umsatzvorschau zählt der Kostenvoranschlag (${fmtEURCent(kvUmsatz)}); eine Schätzung hier zählt erst, wenn kein Kostenvoranschlag mit Betrag mehr offen ist.`
          : 'Ohne Kostenvoranschlag zählt dieser Betrag × Chance in der Umsatzvorschau im erwarteten Monat.'}
      </p>
    </div>
  )
}
