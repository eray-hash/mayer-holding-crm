import { useMemo, useState } from 'react'
import { Plus, Check, RotateCcw, Trash2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState } from '../../components/ui'
import { uid, today } from '../../lib/dates'
import type { ToDoEintrag } from '../../types'

// 1:1 nachgebaut aus Erays privater "ToDo Liste"-Excel (zwei Reiter "to Do"/"erledigte Aufgaben",
// Spalten Start/Prio/Unter-Prio/Kunde-Projekt/Aufgabe/Abt./aktueller Stand/Fragen/nächste Schritte/
// zuständig/Zeiten/Umsatz/Wiedervorlage/Erledigt-am) — bewusst keine Berechnung hinter Prio/Unter-Prio,
// genau wie in der Vorlage: beides wird frei von Hand vergeben (Nutzer-Entscheidung 2026-11-06).
function sortiere(liste: ToDoEintrag[]): ToDoEintrag[] {
  return [...liste].sort((a, b) => {
    const prioA = a.prio ?? ''
    const prioB = b.prio ?? ''
    if (prioA !== prioB) return prioA.localeCompare(prioB)
    return (a.unterPrio ?? 99) - (b.unterPrio ?? 99)
  })
}

export function ToDoListe() {
  const { state, dispatch } = useApp()
  const [ansicht, setAnsicht] = useState<'offen' | 'erledigt'>('offen')
  const [addOpen, setAddOpen] = useState(false)
  const [editEintrag, setEditEintrag] = useState<ToDoEintrag | null>(null)

  const offen = useMemo(() => sortiere(state.todos.filter((t) => !t.erledigtAm)), [state.todos])
  const erledigt = useMemo(
    () => [...state.todos.filter((t) => t.erledigtAm)].sort((a, b) => (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? '')),
    [state.todos],
  )
  const sichtbar = ansicht === 'offen' ? offen : erledigt

  function erledigen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: today() } })
  }
  function wiederOeffnen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: undefined } })
  }
  function loeschen(t: ToDoEintrag) {
    if (confirm(`"${t.aufgabe}" wirklich löschen?`)) dispatch({ type: 'DELETE_TODO', id: t.id })
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">To-Do-Liste</h1>
          <p className="text-sm text-slate-500">{offen.length} offen · {erledigt.length} erledigt</p>
        </div>
        <PrimaryButton onClick={() => setAddOpen(true)}>
          <Plus size={15} /> Neue Aufgabe
        </PrimaryButton>
      </div>

      <div className="mb-4 flex rounded-lg border border-slate-200 bg-white p-0.5 w-fit">
        <button
          onClick={() => setAnsicht('offen')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${ansicht === 'offen' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
        >
          Offen
        </button>
        <button
          onClick={() => setAnsicht('erledigt')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${ansicht === 'erledigt' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
        >
          Erledigt
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-3 py-3">Start</th>
              <th className="px-3 py-3">Prio</th>
              <th className="px-3 py-3">Unter</th>
              <th className="px-3 py-3">Kunde/Projekt</th>
              <th className="px-3 py-3">Aufgabe</th>
              <th className="px-3 py-3">Abt.</th>
              <th className="px-3 py-3">Aktueller Stand</th>
              <th className="px-3 py-3">Zuständig</th>
              {ansicht === 'erledigt' && <th className="px-3 py-3">Erledigt am</th>}
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((t) => (
              <tr
                key={t.id}
                onClick={() => setEditEintrag(t)}
                className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60"
              >
                <td className="px-3 py-3 whitespace-nowrap text-slate-500">{t.startDatum ?? ''}</td>
                <td className="px-3 py-3 font-medium text-slate-700">{t.prio ?? ''}</td>
                <td className="px-3 py-3 text-slate-500">{t.unterPrio ?? ''}</td>
                <td className="px-3 py-3 text-slate-600">{t.kundeProjekt ?? ''}</td>
                <td className="px-3 py-3 text-slate-800">{t.aufgabe}</td>
                <td className="px-3 py-3 text-slate-500">{t.abteilung ?? ''}</td>
                <td className="px-3 py-3 max-w-xs truncate text-slate-500" title={t.aktuellerStand ?? ''}>{t.aktuellerStand ?? ''}</td>
                <td className="px-3 py-3 text-slate-500">{t.zustaendig ?? ''}</td>
                {ansicht === 'erledigt' && <td className="px-3 py-3 whitespace-nowrap text-slate-400">{t.erledigtAm}</td>}
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {ansicht === 'offen' ? (
                      <button
                        onClick={() => erledigen(t)}
                        title="Als erledigt markieren"
                        className="rounded-md bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100"
                      >
                        <Check size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => wiederOeffnen(t)}
                        title="Wieder öffnen"
                        className="rounded-md bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    <button onClick={() => loeschen(t)} title="Löschen" className="rounded-md bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={ansicht === 'erledigt' ? 10 : 9} className="px-4 py-10">
                  <EmptyState text={ansicht === 'offen' ? 'Keine offenen Aufgaben.' : 'Noch keine Aufgabe erledigt.'} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <ToDoModal
          titel="Neue Aufgabe"
          onClose={() => setAddOpen(false)}
          onSubmit={(eintrag) => {
            dispatch({ type: 'ADD_TODO', todo: { ...eintrag, id: uid('todo'), erstelltAm: today() } })
            setAddOpen(false)
          }}
        />
      )}
      {editEintrag && (
        <ToDoModal
          titel="Aufgabe bearbeiten"
          initial={editEintrag}
          onClose={() => setEditEintrag(null)}
          onSubmit={(patch) => {
            dispatch({ type: 'UPDATE_TODO', id: editEintrag.id, patch })
            setEditEintrag(null)
          }}
        />
      )}
    </div>
  )
}

type ToDoFormWert = Omit<ToDoEintrag, 'id' | 'erstelltAm'>

function ToDoModal({
  titel,
  initial,
  onClose,
  onSubmit,
}: {
  titel: string
  initial?: ToDoEintrag
  onClose: () => void
  onSubmit: (werte: ToDoFormWert) => void
}) {
  const [startDatum, setStartDatum] = useState(initial?.startDatum ?? '')
  const [prio, setPrio] = useState(initial?.prio ?? '')
  const [unterPrio, setUnterPrio] = useState(initial?.unterPrio?.toString() ?? '')
  const [kundeProjekt, setKundeProjekt] = useState(initial?.kundeProjekt ?? '')
  const [aufgabe, setAufgabe] = useState(initial?.aufgabe ?? '')
  const [abteilung, setAbteilung] = useState(initial?.abteilung ?? '')
  const [aktuellerStand, setAktuellerStand] = useState(initial?.aktuellerStand ?? '')
  const [welcheFragen, setWelcheFragen] = useState(initial?.welcheFragen ?? '')
  const [naechsteSchritte, setNaechsteSchritte] = useState(initial?.naechsteSchritte ?? '')
  const [zustaendig, setZustaendig] = useState(initial?.zustaendig ?? '')
  const [geplanteZeit, setGeplanteZeit] = useState(initial?.geplanteZeit ?? '')
  const [istZeit, setIstZeit] = useState(initial?.istZeit?.toString() ?? '')
  const [umsatzWert, setUmsatzWert] = useState(initial?.umsatzWert?.toString() ?? '')
  const [geplanteWiedervorlage, setGeplanteWiedervorlage] = useState(initial?.geplanteWiedervorlage ?? '')

  function submit() {
    if (!aufgabe.trim()) return
    onSubmit({
      startDatum: startDatum || undefined,
      prio: prio || undefined,
      unterPrio: unterPrio ? Number(unterPrio) : undefined,
      kundeProjekt: kundeProjekt || undefined,
      aufgabe,
      abteilung: abteilung || undefined,
      aktuellerStand: aktuellerStand || undefined,
      welcheFragen: welcheFragen || undefined,
      naechsteSchritte: naechsteSchritte || undefined,
      zustaendig: zustaendig || undefined,
      geplanteZeit: geplanteZeit || undefined,
      istZeit: istZeit ? Number(istZeit) : undefined,
      umsatzWert: umsatzWert ? Number(umsatzWert) : undefined,
      geplanteWiedervorlage: geplanteWiedervorlage || undefined,
      erledigtAm: initial?.erledigtAm,
    })
  }

  return (
    <Modal open onClose={onClose} title={titel} width="max-w-2xl">
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <Field label="Start (frei, z.B. 18.08)"><input className={inputClass} value={startDatum} onChange={(e) => setStartDatum(e.target.value)} /></Field>
        <Field label="Prio (A/B/C/...)"><input className={inputClass} value={prio} onChange={(e) => setPrio(e.target.value)} /></Field>
        <Field label="Unter-Prio (1-9)"><input type="number" className={inputClass} value={unterPrio} onChange={(e) => setUnterPrio(e.target.value)} /></Field>
      </div>
      <Field label="Kunde/Projekt"><input className={inputClass} value={kundeProjekt} onChange={(e) => setKundeProjekt(e.target.value)} /></Field>
      <Field label="Aufgabe"><textarea className={inputClass} rows={2} value={aufgabe} onChange={(e) => setAufgabe(e.target.value)} autoFocus /></Field>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <Field label="Abteilung"><input className={inputClass} value={abteilung} onChange={(e) => setAbteilung(e.target.value)} /></Field>
        <Field label="Zuständig"><input className={inputClass} value={zustaendig} onChange={(e) => setZustaendig(e.target.value)} /></Field>
      </div>
      <Field label="Aktueller Stand"><textarea className={inputClass} rows={2} value={aktuellerStand} onChange={(e) => setAktuellerStand(e.target.value)} /></Field>
      <Field label="Welche Fragen gibt es / welche Infos werden benötigt"><textarea className={inputClass} rows={2} value={welcheFragen} onChange={(e) => setWelcheFragen(e.target.value)} /></Field>
      <Field label="Was ist als nächstes zu tun"><textarea className={inputClass} rows={2} value={naechsteSchritte} onChange={(e) => setNaechsteSchritte(e.target.value)} /></Field>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <Field label="Geplante Zeit (z.B. 180 std)"><input className={inputClass} value={geplanteZeit} onChange={(e) => setGeplanteZeit(e.target.value)} /></Field>
        <Field label="Ist-Zeit (min)"><input type="number" className={inputClass} value={istZeit} onChange={(e) => setIstZeit(e.target.value)} /></Field>
        <Field label="Umsatz (€)"><input type="number" className={inputClass} value={umsatzWert} onChange={(e) => setUmsatzWert(e.target.value)} /></Field>
      </div>
      <Field label="Geplante Wiedervorlage"><input type="date" className={inputClass} value={geplanteWiedervorlage} onChange={(e) => setGeplanteWiedervorlage(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={submit} disabled={!aufgabe.trim()}>Speichern</PrimaryButton>
      </div>
    </Modal>
  )
}
