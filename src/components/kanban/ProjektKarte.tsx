import type { Projekt, Aufgabe, AufgabenStatus } from '../../types/project'
import { PROJEKT_STATUS_LABEL } from '../../types/project'
import { Card, PriorityBadge } from '../ui'
import { MeilensteinListe } from './MeilensteinListe'

const statusColor: Record<Projekt['status'], string> = {
  geplant: 'bg-slate-100 text-slate-600',
  in_arbeit: 'bg-sky-100 text-sky-700',
  pausiert: 'bg-amber-100 text-amber-700',
  abgeschlossen: 'bg-emerald-100 text-emerald-700',
}

export function ProjektKarte({
  projekt,
  onMoveAufgabe,
  onSaveAufgabe,
  onAddAufgabe,
}: {
  projekt: Projekt
  onMoveAufgabe: (meilensteinId: string, aufgabeId: string, status: AufgabenStatus) => void
  onSaveAufgabe: (meilensteinId: string, aufgabeId: string, patch: Partial<Aufgabe>) => void
  onAddAufgabe: (meilensteinId: string, titel: string) => void
}) {
  const alleAufgaben = projekt.meilensteine.flatMap((m) => m.aufgaben)
  const erledigt = alleAufgaben.filter((a) => a.status === 'erledigt').length
  const gesamt = alleAufgaben.length
  const pct = gesamt ? Math.round((erledigt / gesamt) * 100) : 0

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold leading-tight text-slate-800">{projekt.name}</h3>
          <span className="text-xs text-slate-500">{projekt.kind === 'kunde' ? 'Kundenprojekt' : 'Eigenes Projekt'} · {projekt.verantwortlich}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[projekt.status]}`}>
            {PROJEKT_STATUS_LABEL[projekt.status]}
          </span>
          <PriorityBadge value={projekt.prioritaet} />
        </div>
      </div>

      {projekt.aktuelleAufgabe && (
        <p className="text-sm text-slate-600">
          <span className="text-slate-400">Gerade dran: </span>
          {projekt.aktuelleAufgabe}
        </p>
      )}

      <div>
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-xs text-slate-500">{pct}% · {erledigt}/{gesamt} Aufgaben erledigt</div>
      </div>

      <MeilensteinListe
        meilensteine={projekt.meilensteine}
        onMoveAufgabe={onMoveAufgabe}
        onSaveAufgabe={onSaveAufgabe}
        onAddAufgabe={onAddAufgabe}
      />
    </Card>
  )
}
