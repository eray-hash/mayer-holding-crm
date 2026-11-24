import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Target } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { ladeUmsatzziel, sparteDesBereichs, type SpartenStand } from '../lib/umsatzziele'

// Karte „Unser Ziel“ oben in der Seitenleiste jeder Abteilung (24.11.2026, Wunsch der Geschäftsführung): wie weit
// ist die Sparte dieser Abteilung beim Monatsziel — Ist von Soll mit Balken; ein Klick öffnet /ziele mit dem
// Trichter der Abteilung. Die Zahlen rechnet der Server (lib/umsatzziele.ts), für alle Mitarbeiter gleich.
// Im Bereich Privat gibt es die Karte nicht.

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export function UnserZielSideLink({ bereich, collapsed }: { bereich: string; collapsed: boolean }) {
  const location = useLocation()
  const [stand, setStand] = useState<SpartenStand | null>(null)
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured || bereich === 'privat') return
    let aktiv = true
    ladeUmsatzziel()
      .then((a) => {
        if (!aktiv) return
        const id = sparteDesBereichs(a.uebersicht.sparten, bereich)
        setStand(a.uebersicht.stand.sparten.find((s) => s.sparte === id) ?? null)
        setFehler(false)
      })
      .catch(() => aktiv && setFehler(true))
    return () => {
      aktiv = false
    }
  }, [bereich])

  if (bereich === 'privat' || !isSupabaseConfigured) return null
  const ziel = `/ziele?bereich=${encodeURIComponent(bereich)}`
  const aktiv = location.pathname === '/ziele'
  const anteil = stand && stand.soll > 0 ? Math.min(1, stand.bezahlt / stand.soll) : 0
  const anteilOffen = stand && stand.soll > 0 ? Math.min(1 - anteil, stand.offen / stand.soll) : 0
  const marke = stand && stand.soll > 0 ? Math.min(1, stand.sollBisHeute / stand.soll) : 0

  if (collapsed) {
    return (
      <Link to={ziel} title={stand ? `Unser Ziel (${stand.name}): ${euro(stand.bezahlt)} von ${euro(stand.soll)}` : 'Unser Ziel'} className={`mx-2 mt-3 flex justify-center rounded-lg py-2 ${aktiv ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-50'}`}>
        <Target size={17} />
      </Link>
    )
  }

  return (
    <Link
      to={ziel}
      title="Monatsziel dieser Abteilung: Soll, Ist und Trichter"
      className={`mx-2 mt-3 block rounded-xl border px-3 py-2.5 transition ${aktiv ? 'border-accent-300 bg-accent-50' : 'border-accent-100 bg-accent-50/60 hover:border-accent-200 hover:bg-accent-50'}`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-accent-800">
        <Target size={16} />
        <span className="flex-1">Unser Ziel</span>
        {stand && <span className="text-xs font-semibold">{stand.prozent} %</span>}
      </div>
      {stand ? (
        <>
          <div className="mt-1 truncate text-xs text-slate-600">
            {stand.name}: {euro(stand.bezahlt)} von {euro(stand.soll)}
          </div>
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-white" aria-hidden>
            <div className="absolute inset-y-0 left-0 bg-accent-600" style={{ width: `${anteil * 100}%` }} />
            <div className="absolute inset-y-0 bg-accent-300" style={{ left: `${anteil * 100}%`, width: `${anteilOffen * 100}%` }} />
            {marke > 0 && marke < 1 && <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${marke * 100}%` }} />}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {stand.hinweis ? 'Bereich wird noch eingerichtet' : stand.abstand < 0 ? `${euro(-stand.abstand)} hinter dem Soll bis heute` : `${euro(stand.abstand)} vor dem Soll bis heute`}
          </div>
        </>
      ) : (
        <div className="mt-1 text-xs text-slate-500">{fehler ? 'Stand gerade nicht abrufbar — antippen für Details' : 'Stand wird geladen …'}</div>
      )}
    </Link>
  )
}
