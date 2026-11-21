// Bücher & Verlag (21.11.2026): alle eigenen Bücher als Tafel nach Stufen oder als Liste.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Columns3, List, Plus, Search } from 'lucide-react'
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from '../../components/ui'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { BUCH_STUFEN, fortschritt, ladeBuecher, legeBuchAn, stufeLabel, type Buch, type BuchStatus } from '../../lib/buecher'
import { fmtDate, fmtEURCent } from '../../lib/dates'

type Ansicht = 'tafel' | 'liste'
const ANSICHT_KEY = 'buecher-ansicht'

function gemerkteAnsicht(): Ansicht {
  try {
    return localStorage.getItem(ANSICHT_KEY) === 'liste' ? 'liste' : 'tafel'
  } catch {
    return 'tafel'
  }
}

export function BuecherListe() {
  const navigate = useNavigate()
  const nutzer = useKvNutzer()
  const [liste, setListe] = useState<Buch[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [ansicht, setAnsicht] = useState<Ansicht>(gemerkteAnsicht)
  const [neuOffen, setNeuOffen] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setListe([])
      setFehler('Ohne Verbindung zur Datenbank können keine Bücher angezeigt werden.')
      return
    }
    ladeBuecher()
      .then(setListe)
      .catch((e) => {
        setFehler(e instanceof Error ? e.message : 'Bücher ließen sich nicht laden.')
        setListe([])
      })
  }, [])

  function ansichtWechseln(a: Ansicht) {
    setAnsicht(a)
    try {
      localStorage.setItem(ANSICHT_KEY, a)
    } catch {
      /* egal */
    }
  }

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    if (!s) return liste ?? []
    return (liste ?? []).filter((b) =>
      [b.titel, b.untertitel, b.reihe, b.autor, b.illustrator, b.isbn, b.zielgruppe].some((t) => (t ?? '').toLowerCase().includes(s)),
    )
  }, [liste, suche])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BookOpen size={20} className="text-slate-400" /> Bücher
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Eigene Bücher von der Idee bis zum Verkauf. Ein Klick auf ein Buch öffnet alle Angaben, die Schritte je Stufe, Notizen, Dateien und Kontakte.
          </p>
        </div>
        {!nutzer.nurLesen && isSupabaseConfigured && (
          <PrimaryButton onClick={() => setNeuOffen(true)}>
            <Plus size={14} /> Neues Buch
          </PrimaryButton>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Titel, Autor, Reihe oder ISBN suchen" className={`${inputClass} w-full pl-8`} />
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            onClick={() => ansichtWechseln('tafel')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${ansicht === 'tafel' ? 'bg-accent-50 font-medium text-accent-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Columns3 size={14} /> Tafel
          </button>
          <button
            onClick={() => ansichtWechseln('liste')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${ansicht === 'liste' ? 'bg-accent-50 font-medium text-accent-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <List size={14} /> Liste
          </button>
        </div>
      </div>
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {liste === null ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : liste.length === 0 && !fehler ? (
        <EmptyState text="Noch keine Bücher angelegt. Mit „Neues Buch“ geht es los." />
      ) : ansicht === 'tafel' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BUCH_STUFEN.map((stufe) => {
            const karten = gefiltert.filter((b) => b.status === stufe.id)
            return (
              <div key={stufe.id} className="w-64 flex-shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <StatusBadge label={stufe.label} color={stufe.farbe} />
                  <span className="text-xs text-slate-400">{karten.length}</span>
                </div>
                <div className="min-h-[120px] space-y-2 rounded-xl bg-slate-100/70 p-2">
                  {karten.map((b) => (
                    <BuchKarte key={b.id} buch={b} onClick={() => navigate(`/buecher/${b.id}`)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : gefiltert.length === 0 ? (
        <EmptyState text="Kein Buch passt zur Suche." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Titel</th>
                <th className="px-4 py-2.5 font-medium">Autor</th>
                <th className="px-4 py-2.5 font-medium">Zielgruppe</th>
                <th className="px-4 py-2.5 font-medium">Stufe</th>
                <th className="px-4 py-2.5 font-medium">Erscheint</th>
                <th className="px-4 py-2.5 font-medium">ISBN</th>
                <th className="px-4 py-2.5 text-right font-medium">Ladenpreis</th>
                <th className="px-4 py-2.5 text-right font-medium">Schritte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefiltert.map((b) => {
                const f = fortschritt(b)
                const st = BUCH_STUFEN.find((s) => s.id === b.status)
                return (
                  <tr key={b.id} onClick={() => navigate(`/buecher/${b.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{b.titel}</div>
                      {(b.untertitel || b.reihe) && <div className="text-xs text-slate-500">{[b.reihe && `${b.reihe}${b.band ? `, Band ${b.band}` : ''}`, b.untertitel].filter(Boolean).join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{b.autor ?? '–'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{b.zielgruppe ?? '–'}</td>
                    <td className="px-4 py-2.5"><StatusBadge label={st?.label ?? stufeLabel(b.status)} color={st?.farbe ?? ''} /></td>
                    <td className="px-4 py-2.5 text-slate-600">{b.erscheinungstermin ? fmtDate(b.erscheinungstermin) : '–'}</td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">{b.isbn ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{b.ladenpreis !== undefined ? fmtEURCent(b.ladenpreis) : '–'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{f.erledigt}/{f.gesamt}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {neuOffen && (
        <NeuesBuchFenster
          onClose={() => setNeuOffen(false)}
          onAngelegt={(b) => navigate(`/buecher/${b.id}`)}
          von={nutzer.name}
        />
      )}
    </div>
  )
}

function BuchKarte({ buch, onClick }: { buch: Buch; onClick: () => void }) {
  const f = fortschritt(buch)
  return (
    <button onClick={onClick} className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-accent-300 hover:shadow">
      <div className="text-sm font-medium text-slate-800">{buch.titel}</div>
      {buch.untertitel && <div className="mt-0.5 text-xs text-slate-500">{buch.untertitel}</div>}
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
        {buch.autor && <div>Autor: {buch.autor}</div>}
        {buch.zielgruppe && <div>Zielgruppe: {buch.zielgruppe}</div>}
        {buch.erscheinungstermin && <div>Erscheint: {fmtDate(buch.erscheinungstermin)}</div>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round((f.erledigt / f.gesamt) * 100)}%` }} />
        </div>
        <span className="text-[11px] tabular-nums text-slate-400">{f.erledigt}/{f.gesamt}</span>
      </div>
    </button>
  )
}

function NeuesBuchFenster({ onClose, onAngelegt, von }: { onClose: () => void; onAngelegt: (b: Buch) => void; von: string }) {
  const [titel, setTitel] = useState('')
  const [autor, setAutor] = useState('')
  const [zielgruppe, setZielgruppe] = useState('')
  const [status, setStatus] = useState<BuchStatus>('idee')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState('')

  async function anlegen() {
    if (!titel.trim()) {
      setFehler('Bitte einen Titel eingeben.')
      return
    }
    setSpeichert(true)
    setFehler('')
    try {
      const b = await legeBuchAn({ titel, autor, zielgruppe, status }, von)
      onAngelegt(b)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Buch ließ sich nicht anlegen.')
      setSpeichert(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Neues Buch"
      aktionen={
        <PrimaryButton onClick={anlegen} disabled={speichert}>
          {speichert ? 'Speichert …' : 'Anlegen'}
        </PrimaryButton>
      }
    >
      <Field label="Titel">
        <input autoFocus value={titel} onChange={(e) => setTitel(e.target.value)} className={inputClass} placeholder="z. B. Der kleine Igel findet nach Hause" />
      </Field>
      <Field label="Autor">
        <input value={autor} onChange={(e) => setAutor(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Zielgruppe">
        <input value={zielgruppe} onChange={(e) => setZielgruppe(e.target.value)} className={inputClass} placeholder="z. B. Kinder 3–6 Jahre" />
      </Field>
      <Field label="Stufe">
        <select value={status} onChange={(e) => setStatus(e.target.value as BuchStatus)} className={inputClass}>
          {BUCH_STUFEN.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <p className="text-xs text-slate-400">Alle weiteren Angaben (ISBN, Druckerei, Preis …) trägst du danach im Buch ein.</p>
      {fehler && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      <div className="mt-4 flex justify-end">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
      </div>
    </Modal>
  )
}
