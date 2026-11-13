import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Reiterleiste einer Kunden-/Mandantenakte — dieselbe Darstellung in allen Bereichen (Wunsch vom
// 13.11.2026: überall wie in der Unternehmensberatung, statt in manchen Bereichen alles
// untereinander zu scrollen). Der gewählte Reiter steht als ?tab=… in der Adresse, damit Links
// direkt auf einen Reiter zeigen können.
//
// Passen nicht alle Reiter in die Breite, lässt sich die Leiste nach links und rechts bewegen:
// mit den Pfeilen am Rand, mit dem Mausrad über der Leiste oder durch Wischen. Ohne das waren die
// hinteren Reiter mit einer normalen Maus nicht erreichbar.
export type Reiter = { id: string; label: string; zusatz?: string }

export function AktenReiter({ reiter, aktiv, onWaehle }: { reiter: Reiter[]; aktiv: string; onWaehle: (id: string) => void }) {
  const leiste = useRef<HTMLDivElement>(null)
  const [links, setLinks] = useState(false)
  const [rechts, setRechts] = useState(false)

  useEffect(() => {
    const el = leiste.current
    if (!el) return
    const pruefe = () => {
      setLinks(el.scrollLeft > 2)
      setRechts(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
    }
    // Mausrad (senkrecht) bewegt die Leiste waagerecht — aber nur, solange sie in dieser Richtung
    // noch Weg hat; sonst scrollt wie gewohnt die Seite.
    const rad = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const kannWeiter = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 2 : el.scrollLeft > 2
      if (!kannWeiter) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    pruefe()
    el.addEventListener('scroll', pruefe, { passive: true })
    el.addEventListener('wheel', rad, { passive: false })
    const beobachter = new ResizeObserver(pruefe)
    beobachter.observe(el)
    return () => {
      el.removeEventListener('scroll', pruefe)
      el.removeEventListener('wheel', rad)
      beobachter.disconnect()
    }
  }, [reiter.length])

  // Den gewählten Reiter immer ins Sichtfeld holen (z. B. wenn ein Link direkt auf einen hinteren Reiter führt).
  useEffect(() => {
    leiste.current?.querySelector<HTMLElement>('[data-aktiv="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [aktiv])

  const bewege = (richtung: 1 | -1) => {
    const el = leiste.current
    if (el) el.scrollBy({ left: richtung * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' })
  }

  return (
    <div className="relative mb-4 border-b border-slate-200">
      <div ref={leiste} className="reiterleiste flex gap-1 overflow-x-auto">
        {reiter.map((t) => (
          <button
            key={t.id}
            data-aktiv={aktiv === t.id}
            onClick={() => onWaehle(t.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              aktiv === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {t.zusatz && <span className="ml-1.5 text-xs text-slate-400">{t.zusatz}</span>}
          </button>
        ))}
      </div>
      {links && (
        <button
          type="button"
          onClick={() => bewege(-1)}
          aria-label="Weitere Reiter links zeigen"
          className="absolute inset-y-0 left-0 flex w-9 items-center justify-start bg-gradient-to-r from-slate-50 via-slate-50 to-transparent text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {rechts && (
        <button
          type="button"
          onClick={() => bewege(1)}
          aria-label="Weitere Reiter rechts zeigen"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-end bg-gradient-to-l from-slate-50 via-slate-50 to-transparent text-slate-500 hover:text-slate-800"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  )
}
