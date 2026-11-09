import { useEffect, useMemo, useRef, useState } from 'react'
import { read, utils } from 'xlsx'
import { Plus, Check, RotateCcw, Trash2, Share2, Upload, Download, ChevronDown, ArrowRightLeft } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState } from '../../components/ui'
import { uid, today } from '../../lib/dates'
import { CURRENT_USER } from '../../data/constants'
import { ALLE_BEREICHE } from '../../data/bereiche'
import type { ToDoEintrag, Bereich } from '../../types'

// Zwei Arten von Listen teilen sich dieselbe Tabelle/Komponente:
// - Privat: eigene, isolierte Liste pro Mitarbeiter (RLS: besitzer_email), optional mit Lese-/
//   Schreibrecht an Kollegen freigebbar, mit Listen-Umschalter oben.
// - Bereich (z.B. Beratung, Erben, ...): geteilte Liste, für alle aktiven Mitarbeiter sichtbar und
//   bearbeitbar wie der Rest des jeweiligen Bereichs.
// Aufgaben lassen sich in beide Richtungen zwischen der eigenen privaten Liste und einer
// Bereichs-Liste verschieben ("Bereich zuweisen" / "In private Liste verschieben") — Nutzer-
// Entscheidung 2026-11-06. Standard-Sortierung ist die ursprüngliche Reihenfolge (reihenfolge-
// Spalte), nicht automatisch nach Prio — genau wie in der Excel-Vorlage.
type ExcelSpalten = [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]

function zuExcelZeile(rows: unknown[][]): ExcelSpalten[] {
  return rows as ExcelSpalten[]
}

function textWert(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return String(v)
  const s = String(v).trim()
  return s || undefined
}

function zahlWert(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

function parseExcelDatei(workbookBuffer: ArrayBuffer, sheetName: string): Omit<ToDoEintrag, 'id' | 'besitzerEmail' | 'bereich' | 'reihenfolge' | 'erstelltAm'>[] {
  const wb = read(workbookBuffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[sheetName] ?? wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rows = zuExcelZeile(utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }))
  const out: ReturnType<typeof parseExcelDatei> = []
  for (const row of rows.slice(4)) {
    const aufgabe = textWert(row[4])
    if (!aufgabe) continue
    out.push({
      startDatum: textWert(row[0]),
      prio: textWert(row[1]),
      unterPrio: zahlWert(row[2]),
      kundeProjekt: textWert(row[3]),
      aufgabe,
      abteilung: textWert(row[5]),
      aktuellerStand: textWert(row[6]),
      welcheFragen: textWert(row[7]),
      naechsteSchritte: textWert(row[8]),
      zustaendig: textWert(row[9]),
      geplanteZeit: textWert(row[10]),
      istZeit: zahlWert(row[11]),
      umsatzWert: zahlWert(row[12]),
      geplanteWiedervorlage: textWert(row[13]),
      erledigtAm: textWert(row[15]),
    })
  }
  return out
}

function csvZeile(werte: (string | number | undefined)[]): string {
  return werte.map((w) => `"${(w ?? '').toString().replace(/"/g, '""')}"`).join(';')
}

function exportiereCsv(liste: ToDoEintrag[], dateiname: string) {
  const header = csvZeile(['Start', 'Prio', 'Unter', 'Kunde/Projekt', 'Aufgabe', 'Abt.', 'aktueller Stand', 'welche Fragen', 'nächste Schritte', 'zuständig', 'geplante Zeit', 'Ist-Zeit', 'Umsatz', 'Wiedervorlage', 'Erledigt am'])
  const zeilen = liste.map((t) =>
    csvZeile([t.startDatum, t.prio, t.unterPrio, t.kundeProjekt, t.aufgabe, t.abteilung, t.aktuellerStand, t.welcheFragen, t.naechsteSchritte, t.zustaendig, t.geplanteZeit, t.istZeit, t.umsatzWert, t.geplanteWiedervorlage, t.erledigtAm]),
  )
  const csv = '﻿' + [header, ...zeilen].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.click()
  URL.revokeObjectURL(url)
}

type Mitarbeiterkurz = { name: string; email: string }
type Recht = 'eigentuemer' | 'lesen' | 'schreiben'
type Scope = { kind: 'privat' } | { kind: 'bereich'; bereich: Bereich; label: string }

export function ToDoListe() {
  return <ToDoListeKern scope={{ kind: 'privat' }} />
}

export function BereichToDoListe({ bereich, label }: { bereich: Bereich; label: string }) {
  return <ToDoListeKern scope={{ kind: 'bereich', bereich, label }} />
}

function ToDoListeKern({ scope }: { scope: Scope }) {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter } = useAuth()
  const eigeneEmail = (isSupabaseConfigured && session?.user.email) || 'lokal'
  const eigenerName = mitarbeiter?.name ?? CURRENT_USER

  const [ansicht, setAnsicht] = useState<'offen' | 'erledigt'>('offen')
  const [sortierung, setSortierung] = useState<'reihenfolge' | 'prio'>('reihenfolge')
  const [aktiveListe, setAktiveListe] = useState<string>(eigeneEmail)
  const [addOpen, setAddOpen] = useState(false)
  const [editEintrag, setEditEintrag] = useState<ToDoEintrag | null>(null)
  const [freigabenOpen, setFreigabenOpen] = useState(false)
  const [alleMitarbeiter, setAlleMitarbeiter] = useState<Mitarbeiterkurz[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('mitarbeiter')
      .select('name, email')
      .eq('aktiv', true)
      .order('name')
      .then(({ data }) => setAlleMitarbeiter(data ?? []))
  }, [])

  const namenNachEmail = useMemo(() => {
    const map = new Map(alleMitarbeiter.map((m) => [m.email, m.name]))
    map.set(eigeneEmail, eigenerName)
    return map
  }, [alleMitarbeiter, eigeneEmail, eigenerName])

  // Nur relevant im Privat-Scope: eigene Liste + alle Listen, die mir freigegeben wurden.
  const verfuegbareListen = useMemo(() => {
    if (scope.kind !== 'privat') return []
    const fremde = state.todoFreigaben
      .filter((f) => f.empfaengerEmail === eigeneEmail)
      .map((f) => ({ besitzerEmail: f.besitzerEmail, recht: f.recht as Recht }))
    return [{ besitzerEmail: eigeneEmail, recht: 'eigentuemer' as Recht }, ...fremde]
  }, [scope, state.todoFreigaben, eigeneEmail])

  const meinRecht: Recht = scope.kind === 'bereich' ? 'eigentuemer' : verfuegbareListen.find((l) => l.besitzerEmail === aktiveListe)?.recht ?? 'lesen'
  const darfSchreiben = meinRecht === 'eigentuemer' || meinRecht === 'schreiben'
  const darfLoeschen = scope.kind === 'bereich' ? true : meinRecht === 'eigentuemer'

  const listenEintraege = useMemo(
    () => (scope.kind === 'bereich' ? state.todos.filter((t) => t.bereich === scope.bereich) : state.todos.filter((t) => !t.bereich && t.besitzerEmail === aktiveListe)),
    [state.todos, scope, aktiveListe],
  )
  const offen = useMemo(() => listenEintraege.filter((t) => !t.erledigtAm), [listenEintraege])
  const erledigt = useMemo(() => listenEintraege.filter((t) => t.erledigtAm), [listenEintraege])

  const sortiere = (liste: ToDoEintrag[]) =>
    [...liste].sort((a, b) => {
      if (sortierung === 'prio') {
        const prioA = a.prio ?? ''
        const prioB = b.prio ?? ''
        if (prioA !== prioB) return prioA.localeCompare(prioB)
        return (a.unterPrio ?? 99) - (b.unterPrio ?? 99)
      }
      if (ansicht === 'erledigt') return (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? '')
      return (a.reihenfolge ?? 99999) - (b.reihenfolge ?? 99999)
    })

  const sichtbar = sortiere(ansicht === 'offen' ? offen : erledigt)

  function naechsteReihenfolge() {
    return 1 + Math.max(0, ...listenEintraege.map((t) => t.reihenfolge ?? 0))
  }

  function erledigen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: today() } })
  }
  function wiederOeffnen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: undefined } })
  }
  function loeschen(t: ToDoEintrag) {
    if (confirm(`"${t.aufgabe}" wirklich löschen?`)) dispatch({ type: 'DELETE_TODO', id: t.id })
  }
  function naechsteReihenfolgeFuer(ziel: ToDoEintrag[]) {
    return 1 + Math.max(0, ...ziel.map((t) => t.reihenfolge ?? 0))
  }
  function bereichZuweisen(t: ToDoEintrag, bereich: Bereich) {
    const ziel = state.todos.filter((x) => x.bereich === bereich)
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { bereich, reihenfolge: naechsteReihenfolgeFuer(ziel) } })
  }
  function inPrivateListeVerschieben(t: ToDoEintrag) {
    const ziel = state.todos.filter((x) => !x.bereich && x.besitzerEmail === eigeneEmail)
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { bereich: undefined, besitzerEmail: eigeneEmail, reihenfolge: naechsteReihenfolgeFuer(ziel) } })
  }

  function importDatei(datei: File) {
    datei.arrayBuffer().then((buffer) => {
      const importiert = parseExcelDatei(buffer, 'to Do')
      let n = naechsteReihenfolge()
      for (const eintrag of importiert) {
        dispatch({
          type: 'ADD_TODO',
          todo: {
            ...eintrag,
            id: uid('todo'),
            besitzerEmail: eigeneEmail,
            bereich: scope.kind === 'bereich' ? scope.bereich : undefined,
            reihenfolge: n++,
            erstelltAm: today(),
          },
        })
      }
      alert(`${importiert.length} Aufgaben importiert.`)
    })
  }

  const titel = scope.kind === 'bereich' ? `To-Do-Liste — ${scope.label}` : 'To-Do-Liste'
  const dateiname = scope.kind === 'bereich' ? `todo-liste-${scope.bereich}.csv` : `todo-liste-${aktiveListe}.csv`

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{titel}</h1>
          <p className="text-sm text-slate-500">
            {offen.length} offen · {erledigt.length} erledigt
            {scope.kind === 'bereich' && ' · für alle Mitarbeiter sichtbar'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope.kind === 'privat' && verfuegbareListen.length > 1 && (
            <div className="relative">
              <select
                value={aktiveListe}
                onChange={(e) => setAktiveListe(e.target.value)}
                className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium"
              >
                {verfuegbareListen.map((l) => (
                  <option key={l.besitzerEmail} value={l.besitzerEmail}>
                    {l.besitzerEmail === eigeneEmail ? 'Meine Liste' : `Liste von ${namenNachEmail.get(l.besitzerEmail) ?? l.besitzerEmail}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          )}
          <select value={sortierung} onChange={(e) => setSortierung(e.target.value as 'reihenfolge' | 'prio')} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="reihenfolge">Reihenfolge (wie Excel)</option>
            <option value="prio">Nach Priorität</option>
          </select>
          {scope.kind === 'privat' && aktiveListe === eigeneEmail && isSupabaseConfigured && (
            <SecondaryButton onClick={() => setFreigabenOpen(true)}>
              <Share2 size={14} /> Freigeben
            </SecondaryButton>
          )}
          {darfSchreiben && (
            <>
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && importDatei(e.target.files[0])} />
              <SecondaryButton onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> Excel importieren
              </SecondaryButton>
            </>
          )}
          <SecondaryButton onClick={() => exportiereCsv(sichtbar, dateiname)}>
            <Download size={14} /> Export
          </SecondaryButton>
          {darfSchreiben && (
            <PrimaryButton onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Neue Aufgabe
            </PrimaryButton>
          )}
        </div>
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

      {/* overflow-x-auto + sticky erste Spalten, damit Start/Prio/Unter beim Scrollen nach rechts
          sichtbar bleiben (Beschwerde: "dann sind die Prios weg"). */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 w-[90px]">Start</th>
              <th className="sticky left-[90px] z-10 bg-slate-50 px-3 py-3 w-[56px]">Prio</th>
              <th className="sticky left-[146px] z-10 border-r border-slate-200 bg-slate-50 px-3 py-3 w-[56px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Unter</th>
              <th className="px-3 py-3 whitespace-nowrap">Kunde/Projekt</th>
              <th className="px-3 py-3 whitespace-nowrap">Aufgabe</th>
              <th className="px-3 py-3 whitespace-nowrap">Abt.</th>
              <th className="px-3 py-3 whitespace-nowrap">Aktueller Stand</th>
              <th className="px-3 py-3 whitespace-nowrap">Welche Fragen</th>
              <th className="px-3 py-3 whitespace-nowrap">Nächste Schritte</th>
              <th className="px-3 py-3 whitespace-nowrap">Zuständig</th>
              <th className="px-3 py-3 whitespace-nowrap">Geplante Zeit</th>
              <th className="px-3 py-3 whitespace-nowrap">Ist-Zeit</th>
              <th className="px-3 py-3 whitespace-nowrap">Umsatz</th>
              <th className="px-3 py-3 whitespace-nowrap">Wiedervorlage</th>
              {ansicht === 'erledigt' && <th className="px-3 py-3 whitespace-nowrap">Erledigt am</th>}
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((t) => (
              <tr key={t.id} className="group border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td onClick={() => setEditEintrag(t)} className="sticky left-0 z-10 cursor-pointer whitespace-nowrap bg-white px-3 py-3 text-slate-500 group-hover:bg-slate-50">
                  {t.startDatum ?? ''}
                </td>
                <td onClick={() => setEditEintrag(t)} className="sticky left-[90px] z-10 cursor-pointer bg-white px-3 py-3 font-medium text-slate-700 group-hover:bg-slate-50">
                  {t.prio ?? ''}
                </td>
                <td onClick={() => setEditEintrag(t)} className="sticky left-[146px] z-10 cursor-pointer border-r border-slate-100 bg-white px-3 py-3 text-slate-500 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-slate-50">
                  {t.unterPrio ?? ''}
                </td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-600">{t.kundeProjekt ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-800">{t.aufgabe}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.abteilung ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.aktuellerStand ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.welcheFragen ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.naechsteSchritte ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.zustaendig ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.geplanteZeit ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.istZeit ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.umsatzWert ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.geplanteWiedervorlage ?? ''}</td>
                {ansicht === 'erledigt' && <td className="px-3 py-3 whitespace-nowrap text-slate-400">{t.erledigtAm}</td>}
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {darfSchreiben && scope.kind === 'privat' && (
                      <BereichZuweisenDropdown onWaehlen={(b) => bereichZuweisen(t, b)} />
                    )}
                    {darfSchreiben && scope.kind === 'bereich' && (
                      <button onClick={() => inPrivateListeVerschieben(t)} title="In meine private Liste verschieben" className="rounded-md bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200">
                        <ArrowRightLeft size={14} />
                      </button>
                    )}
                    {darfSchreiben && (ansicht === 'offen' ? (
                      <button onClick={() => erledigen(t)} title="Als erledigt markieren" className="rounded-md bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100">
                        <Check size={14} />
                      </button>
                    ) : (
                      <button onClick={() => wiederOeffnen(t)} title="Wieder öffnen" className="rounded-md bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100">
                        <RotateCcw size={14} />
                      </button>
                    ))}
                    {darfLoeschen && (
                      <button onClick={() => loeschen(t)} title="Löschen" className="rounded-md bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={16} className="px-4 py-10">
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
            dispatch({
              type: 'ADD_TODO',
              todo: {
                ...eintrag,
                id: uid('todo'),
                besitzerEmail: scope.kind === 'bereich' ? eigeneEmail : aktiveListe,
                bereich: scope.kind === 'bereich' ? scope.bereich : undefined,
                reihenfolge: naechsteReihenfolge(),
                erstelltAm: today(),
              },
            })
            setAddOpen(false)
          }}
        />
      )}
      {editEintrag && (
        <ToDoModal
          titel="Aufgabe bearbeiten"
          initial={editEintrag}
          readOnly={!darfSchreiben}
          onClose={() => setEditEintrag(null)}
          onSubmit={(patch) => {
            dispatch({ type: 'UPDATE_TODO', id: editEintrag.id, patch })
            setEditEintrag(null)
          }}
        />
      )}
      {freigabenOpen && (
        <FreigabenModal
          besitzerEmail={eigeneEmail}
          alleMitarbeiter={alleMitarbeiter.filter((m) => m.email !== eigeneEmail)}
          onClose={() => setFreigabenOpen(false)}
        />
      )}
    </div>
  )
}

function BereichZuweisenDropdown({ onWaehlen }: { onWaehlen: (bereich: Bereich) => void }) {
  const [offen, setOffen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOffen((o) => !o)} title="Bereich zuweisen" className="rounded-md bg-accent-50 p-1.5 text-accent-700 hover:bg-accent-100">
        <ArrowRightLeft size={14} />
      </button>
      {offen && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOffen(false)} aria-label="Schließen" />
          <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {ALLE_BEREICHE.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  onWaehlen(b.id)
                  setOffen(false)
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FreigabenModal({ besitzerEmail, alleMitarbeiter, onClose }: { besitzerEmail: string; alleMitarbeiter: Mitarbeiterkurz[]; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const freigaben = state.todoFreigaben.filter((f) => f.besitzerEmail === besitzerEmail)

  function setRecht(empfaengerEmail: string, recht: '' | 'lesen' | 'schreiben') {
    if (!recht) {
      const bestehende = freigaben.find((f) => f.empfaengerEmail === empfaengerEmail)
      if (bestehende) dispatch({ type: 'DELETE_TODO_FREIGABE', id: bestehende.id })
      return
    }
    dispatch({ type: 'SET_TODO_FREIGABE', besitzerEmail, empfaengerEmail, recht })
  }

  return (
    <Modal open onClose={onClose} title="Meine To-Do-Liste freigeben">
      <p className="mb-3 text-sm text-slate-500">Wer Lesezugriff hat, sieht deine Liste nur. Wer Schreibzugriff hat, kann Aufgaben anlegen/bearbeiten — löschen kannst nur du.</p>
      <div className="space-y-2">
        {alleMitarbeiter.map((m) => {
          const aktuell = freigaben.find((f) => f.empfaengerEmail === m.email)?.recht ?? ''
          return (
            <div key={m.email} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm text-slate-700">{m.name}</span>
              <select
                value={aktuell}
                onChange={(e) => setRecht(m.email, e.target.value as '' | 'lesen' | 'schreiben')}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="">Kein Zugriff</option>
                <option value="lesen">Lesen</option>
                <option value="schreiben">Lesen & Schreiben</option>
              </select>
            </div>
          )
        })}
        {alleMitarbeiter.length === 0 && <EmptyState text="Keine weiteren Mitarbeiter gefunden." />}
      </div>
      <div className="mt-4 flex justify-end">
        <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
      </div>
    </Modal>
  )
}

type ToDoFormWert = Omit<ToDoEintrag, 'id' | 'besitzerEmail' | 'bereich' | 'reihenfolge' | 'erstelltAm'>

function ToDoModal({
  titel,
  initial,
  readOnly,
  onClose,
  onSubmit,
}: {
  titel: string
  initial?: ToDoEintrag
  readOnly?: boolean
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
      <fieldset disabled={readOnly} className="disabled:opacity-60">
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
      </fieldset>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>{readOnly ? 'Schließen' : 'Abbrechen'}</SecondaryButton>
        {!readOnly && <PrimaryButton onClick={submit} disabled={!aufgabe.trim()}>Speichern</PrimaryButton>}
      </div>
    </Modal>
  )
}
