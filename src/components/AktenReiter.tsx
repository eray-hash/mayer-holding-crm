// Reiterleiste einer Kunden-/Mandantenakte — dieselbe Darstellung in allen Bereichen (Wunsch vom
// 13.11.2026: überall wie in der Unternehmensberatung, statt in manchen Bereichen alles
// untereinander zu scrollen). Der gewählte Reiter steht als ?tab=… in der Adresse, damit Links
// direkt auf einen Reiter zeigen können.
export type Reiter = { id: string; label: string }

export function AktenReiter({ reiter, aktiv, onWaehle }: { reiter: Reiter[]; aktiv: string; onWaehle: (id: string) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {reiter.map((t) => (
        <button
          key={t.id}
          onClick={() => onWaehle(t.id)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
            aktiv === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
