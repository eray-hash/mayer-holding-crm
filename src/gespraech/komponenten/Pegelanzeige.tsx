// Lautstärke-Balken während der Aufnahme (liest den Pegel 20-mal je Sekunde, ohne React neu zu zeichnen).
import { useEffect, useRef } from 'react'
import { pegelWert } from '../sitzung'

export function Pegelanzeige({ aktiv }: { aktiv: boolean }) {
  const balken = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aktiv) {
      if (balken.current) balken.current.style.width = '0%'
      return
    }
    let weiter = true
    let letzte = 0
    let geglaettet = 0
    const zeichne = (t: number) => {
      if (!weiter) return
      if (t - letzte > 50) {
        letzte = t
        const w = pegelWert()
        geglaettet = w > geglaettet ? w : geglaettet * 0.85 + w * 0.15
        if (balken.current) balken.current.style.width = `${Math.round(geglaettet * 100)}%`
      }
      requestAnimationFrame(zeichne)
    }
    requestAnimationFrame(zeichne)
    return () => {
      weiter = false
    }
  }, [aktiv])
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" role="meter" aria-label="Lautstärke">
      <div ref={balken} className="h-full rounded-full bg-emerald-500 transition-[width] duration-75" style={{ width: '0%' }} />
    </div>
  )
}
