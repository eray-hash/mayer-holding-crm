// Zuordnung einer Aufnahme zu einer Kunden- oder Objektakte (freiwillig — „später zuordnen“ geht immer).
import { useEffect, useState } from 'react'
import { Building2, Search, User, X } from 'lucide-react'
import { sucheAkten, type AkteTreffer } from '../akten'

export type AkteAuswahl = { art: 'kunde'; id: string; bereich: string; name: string } | { art: 'objekt'; id: string; name: string } | null

export function AkteWahl({ wert, onWahl }: { wert: AkteAuswahl; onWahl: (a: AkteAuswahl) => void }) {
  const [eingabe, setEingabe] = useState('')
  const [treffer, setTreffer] = useState<AkteTreffer[]>([])
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  useEffect(() => {
    if (eingabe.trim().length < 2) {
      setTreffer([])
      return
    }
    let aktiv = true
    const t = window.setTimeout(() => {
      setLaedt(true)
      sucheAkten(eingabe)
        .then((l) => aktiv && (setTreffer(l), setFehler(null)))
        .catch((err) => aktiv && setFehler(err instanceof Error ? err.message : 'Suche fehlgeschlagen.'))
        .finally(() => aktiv && setLaedt(false))
    }, 250)
    return () => {
      aktiv = false
      window.clearTimeout(t)
    }
  }, [eingabe])

  if (wert) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-accent-200 bg-accent-50 px-3 py-2.5">
        {wert.art === 'kunde' ? <User className="h-5 w-5 shrink-0 text-accent-600" /> : <Building2 className="h-5 w-5 shrink-0 text-accent-600" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-900">{wert.name}</div>
          <div className="text-xs text-slate-500">{wert.art === 'kunde' ? 'Kundenakte' : 'Objektakte'}</div>
        </div>
        <button type="button" onClick={() => onWahl(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Zuordnung entfernen">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={eingabe}
          onChange={(e) => setEingabe(e.target.value)}
          placeholder="Akte suchen: Name, Firma, Objekt"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-base outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 sm:text-sm"
        />
      </div>
      {fehler && <p className="mt-1 text-xs text-rose-600">{fehler}</p>}
      {eingabe.trim().length >= 2 && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {laedt && treffer.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Sucht …</div>}
          {!laedt && treffer.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Nichts gefunden.</div>}
          {treffer.map((t) => (
            <button
              key={`${t.art}-${t.id}`}
              type="button"
              onClick={() => {
                onWahl(t.art === 'kunde' ? { art: 'kunde', id: t.id, bereich: t.bereich, name: t.name } : { art: 'objekt', id: t.id, name: t.name })
                setEingabe('')
              }}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50"
            >
              {t.art === 'kunde' ? <User className="h-4 w-4 shrink-0 text-slate-400" /> : <Building2 className="h-4 w-4 shrink-0 text-slate-400" />}
              <div className="min-w-0">
                <div className="truncate text-sm text-slate-900">{t.name}</div>
                <div className="truncate text-xs text-slate-500">{t.zusatz}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
