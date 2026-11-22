// Kleine Bausteine des Prüfbildschirms (AuswertungSeite.tsx und die Teile aus Runde 5): Karte mit Haken,
// Schalter, Eingabefeld-Stil und der Abstand über der unteren Leiste der App.
import type { ReactNode } from 'react'

export const feld = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-indigo-500 focus:outline-none'

// Klebt unten über der Leiste der App (Start / Meine Aufnahmen / Einstellungen).
export const UEBER_LEISTE = { bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }

export function Karte({ titel, an, setAn, fest, fertig, fertigText = 'übernommen', children }: { titel: string; an: boolean; setAn?: (an: boolean) => void; fest?: boolean; fertig?: boolean; fertigText?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${fertig ? 'border-emerald-200 bg-emerald-50/50' : an ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-75'}`}>
      <label className="mb-2 flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={fertig || an} disabled={fertig || fest || !setAn} onChange={(e) => setAn?.(e.target.checked)} />
        <span className="text-sm font-semibold text-slate-800">{titel}</span>
        {fertig && <span className="ml-auto text-xs font-medium text-emerald-700">{fertigText}</span>}
      </label>
      {children}
    </div>
  )
}

export function Schalter({ text, an, setAn, gesperrt, zusatz }: { text: string; an: boolean; setAn: (an: boolean) => void; gesperrt?: boolean; zusatz?: string }) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <input type="checkbox" className="mt-0.5 h-5 w-5 accent-indigo-600" checked={an} disabled={gesperrt} onChange={(e) => setAn(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-slate-800">{text}</span>
        {zusatz && <span className="block text-xs text-slate-500">{zusatz}</span>}
      </span>
    </label>
  )
}

export function aendere<T>(liste: T[], i: number, teil: Partial<T>): T[] {
  return liste.map((x, n) => (n === i ? { ...x, ...teil } : x))
}

export function fehlerText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e)
}
