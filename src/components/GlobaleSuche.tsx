import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Users, Building2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../data/kundenBereiche'
import { Modal, inputClass } from './ui'

// Globale Suchleiste (Punkt 10 der Bugfix-Liste): durchsucht Kunden/Mandanten aus allen Bereichen
// (Privat eingeschlossen — dort sieht man per RLS ohnehin nur die eigenen) sowie Immobilien-Objekte,
// live während des Tippens, kein Server-Roundtrip nötig (alles schon im App-State geladen).

type Treffer = { key: string; titel: string; subtitel: string; icon: 'kunde' | 'objekt'; pfad: string }

export function GlobaleSuche({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp()
  const navigate = useNavigate()
  const [suche, setSuche] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else setSuche('')
  }, [open])

  const treffer = useMemo<Treffer[]>(() => {
    const text = suche.trim().toLowerCase()
    if (text.length < 2) return []
    const passt = (...felder: (string | undefined)[]) => felder.some((f) => f?.toLowerCase().includes(text))

    const kunden: Treffer[] = []
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        if (passt(k.firma, k.ansprechpartner, k.email, k.telefon)) {
          kunden.push({ key: `k-${b.id}-${k.id}`, titel: k.firma, subtitel: `${k.ansprechpartner} · ${b.label}`, icon: 'kunde', pfad: kundeDetailPfad(b.id, k.id) })
        }
      }
    }

    const objekte: Treffer[] = state.objekte
      .filter((o) => passt(o.bezeichnung, o.adresse))
      .map((o) => ({ key: `o-${o.id}`, titel: o.bezeichnung, subtitel: o.adresse, icon: 'objekt' as const, pfad: `/immobilien/objekte/${o.id}` }))

    return [...kunden, ...objekte].slice(0, 20)
  }, [state, suche])

  function oeffnen(pfad: string) {
    navigate(pfad)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Suche" width="max-w-xl">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          className={`${inputClass} pl-9`}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Kunde, Mandant, Immobilie — mind. 2 Zeichen"
        />
      </div>
      {suche.trim().length >= 2 && (
        <div className="mt-2 max-h-96 space-y-1 overflow-y-auto">
          {treffer.length === 0 && <p className="px-1 py-3 text-sm text-slate-400">Keine Treffer.</p>}
          {treffer.map((t) => (
            <button
              key={t.key}
              onClick={() => oeffnen(t.pfad)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              {t.icon === 'kunde' ? <Users size={14} className="flex-shrink-0 text-slate-400" /> : <Building2 size={14} className="flex-shrink-0 text-slate-400" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-800">{t.titel}</span>
                <span className="block truncate text-xs text-slate-400">{t.subtitel}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
