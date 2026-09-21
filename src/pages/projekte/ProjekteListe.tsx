import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { ProjektKarte } from '../../components/kanban/ProjektKarte'
import { Modal, Field, inputClass, PrimaryButton, EmptyState } from '../../components/ui'
import { MITARBEITER, PRIORITAETEN } from '../../data/constants'
import { uid } from '../../lib/dates'
import type { ProjektBereich, ProjektKind } from '../../types/project'
import type { Prioritaet } from '../../types'

export function ProjekteListe() {
  const { state, dispatch } = useApp()
  const [addOpen, setAddOpen] = useState(false)

  const bereich: ProjektBereich = state.bereich === 'immobilien' ? 'immobilien' : 'beratung'

  const projekte = useMemo(() => state.projekte.filter((p) => p.bereich === bereich), [state.projekte, bereich])

  function moveAufgabe(projektId: string, meilensteinId: string, aufgabeId: string, status: import('../../types/project').AufgabenStatus) {
    dispatch({ type: 'MOVE_AUFGABE', projektId, meilensteinId, aufgabeId, status })
  }
  function saveAufgabe(projektId: string, meilensteinId: string, aufgabeId: string, patch: Partial<import('../../types/project').Aufgabe>) {
    dispatch({ type: 'UPDATE_AUFGABE', projektId, meilensteinId, aufgabeId, patch })
  }
  function addAufgabe(projektId: string, meilensteinId: string, titel: string) {
    dispatch({
      type: 'ADD_AUFGABE',
      projektId,
      meilensteinId,
      aufgabe: {
        id: uid('auf'),
        titel,
        status: 'offen',
        prioritaet: 'Mittel',
        unterPrio: null,
        startDatum: null,
        kunde: null,
        abteilung: null,
        zustaendig: null,
        naechsterSchritt: null,
        fragen: null,
        benoetigteInfos: null,
        geplanteZeitStunden: null,
        istZeitStunden: null,
        umsatzEuro: null,
        wiedervorlage: null,
        erledigtAm: null,
        protokoll: null,
        taskvorschlaege: null,
        fuerClaude: false,
      },
    })
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Projekte</h1>
          <p className="text-sm text-slate-500">{projekte.length} Projekte in diesem Bereich</p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Neues Projekt
        </PrimaryButton>
      </div>

      {projekte.length === 0 ? (
        <EmptyState text="Noch keine Projekte in diesem Bereich." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {projekte.map((p) => (
            <ProjektKarte
              key={p.id}
              projekt={p}
              onMoveAufgabe={(meilensteinId, aufgabeId, status) => moveAufgabe(p.id, meilensteinId, aufgabeId, status)}
              onSaveAufgabe={(meilensteinId, aufgabeId, patch) => saveAufgabe(p.id, meilensteinId, aufgabeId, patch)}
              onAddAufgabe={(meilensteinId, titel) => addAufgabe(p.id, meilensteinId, titel)}
            />
          ))}
        </div>
      )}

      <NeuesProjektModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        bereich={bereich}
        onCreate={(projekt) => dispatch({ type: 'ADD_PROJEKT', projekt })}
      />
    </div>
  )
}

function NeuesProjektModal({
  open,
  onClose,
  bereich,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  bereich: ProjektBereich
  onCreate: (p: import('../../types/project').Projekt) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProjektKind>('kunde')
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [verantwortlich, setVerantwortlich] = useState(MITARBEITER[0])

  function submit() {
    if (!name.trim()) return
    onCreate({
      id: uid('proj'),
      bereich,
      name,
      kind,
      status: 'geplant',
      prioritaet,
      verantwortlich,
      aktuelleAufgabe: null,
      meilensteine: [{ id: uid('meil'), titel: 'Allgemein', eta: null, sortOrder: 1, aufgaben: [] }],
    })
    setName('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Projekt">
      <Field label="Titel">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Art">
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as ProjektKind)}>
          <option value="kunde">Kundenprojekt</option>
          <option value="eigen">Eigenes Projekt</option>
        </select>
      </Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Verantwortlich">
        <select className={inputClass} value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)}>
          {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <div className="mt-4 flex justify-end">
        <PrimaryButton onClick={submit}>Projekt anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
