import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListChecks, Lock } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { supabase } from '../../lib/supabaseClient'
import { MITARBEITER } from '../../data/constants'
import { fmtDate, today } from '../../lib/dates'
import { sammleAufgaben } from '../../lib/aufgabenSammeln'
import { Card, EmptyState, inputClass } from '../../components/ui'
import {
  type Aufgabe,
  type AufgabenArt,
  type Lage,
  LAGE_TEXT,
  nachPerson,
  NICHT_IM_TEAM,
  OHNE_ZUSTAENDIGEN,
  ordneAufgabenZu,
} from '../../../supabase/functions/_shared/aufgabenKern.ts'

// Aufgaben nach Mitarbeiter: wer muss was bis wann erledigen — To-dos, Follow-ups und
// Projektaufgaben an einem Ort (Wunsch von Hasan, 18.11.2026). Die Zuordnung zu Personen und die
// Fälligkeit kommen aus supabase/functions/_shared/aufgabenKern.ts, damit der Assistent in Telegram
// genau dasselbe antwortet.

const ART_TEXT: Record<AufgabenArt, string> = { todo: 'To-do', followup: 'Follow-up', projekt: 'Projekt' }

type Zeitraum = 'alle' | 'faellig' | 'woche' | 'ohne'
const ZEITRAEUME: { id: Zeitraum; label: string }[] = [
  { id: 'alle', label: 'Alle offenen' },
  { id: 'faellig', label: 'Überfällig und heute fällig' },
  { id: 'woche', label: 'Fällig in den nächsten 7 Tagen (inkl. überfällig)' },
  { id: 'ohne', label: 'Ohne Datum' },
]

function passtZeitraum(lage: Lage, z: Zeitraum): boolean {
  if (z === 'alle') return true
  if (z === 'faellig') return lage === 'ueberfaellig' || lage === 'heute'
  if (z === 'woche') return lage === 'ueberfaellig' || lage === 'heute' || lage === 'woche'
  return lage === 'ohne'
}

const LAGE_FARBE: Record<Lage, string> = {
  ueberfaellig: 'border-rose-200 bg-rose-50 text-rose-700',
  heute: 'border-amber-200 bg-amber-50 text-amber-800',
  woche: 'border-sky-200 bg-sky-50 text-sky-800',
  spaeter: 'border-slate-200 bg-white text-slate-600',
  ohne: 'border-slate-200 bg-slate-50 text-slate-400',
}

export function AufgabenUebersicht() {
  const { state } = useApp()
  const navigate = useNavigate()
  const [team, setTeam] = useState<{ name: string; email: string }[]>([])
  const [person, setPerson] = useState<string>('alle')
  const [zeitraum, setZeitraum] = useState<Zeitraum>('alle')
  const [arten, setArten] = useState<Record<AufgabenArt, boolean>>({ todo: true, followup: true, projekt: true })

  // Namen und E-Mail-Adressen der Kollegen: für die Zuordnung und um eigene To-do-Listen ohne
  // „Zuständig“ ihrem Besitzer zuzuordnen.
  useEffect(() => {
    if (!supabase) return
    supabase
      .from('mitarbeiter')
      .select('name, email')
      .eq('aktiv', true)
      .then(({ data }) => setTeam(((data ?? []) as { name: string; email: string }[]).filter((m) => m.name)))
  }, [])

  const heute = today()
  const alle = useMemo(() => {
    const nameZuEmail = new Map(team.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m.name]))
    const namen = team.length > 0 ? team.map((m) => m.name) : MITARBEITER
    return ordneAufgabenZu(sammleAufgaben(state, nameZuEmail), namen, heute)
  }, [state, team, heute])

  const gefiltert = useMemo(() => alle.filter((a) => arten[a.art] && passtZeitraum(a.lage, zeitraum)), [alle, arten, zeitraum])
  const gruppen = useMemo(() => nachPerson(gefiltert), [gefiltert])
  const sichtbareGruppen = person === 'alle' ? gruppen : gruppen.filter((g) => g.person === person)
  const personenAuswahl = useMemo(() => nachPerson(alle).map((g) => g.person), [alle])

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-800">
          <ListChecks size={20} className="text-accent-600" /> Aufgaben nach Mitarbeiter
        </h1>
        <p className="text-sm text-slate-500">
          Wer muss was bis wann erledigen: alle offenen To-dos, Follow-ups aus den Kunden- und Objektakten und Aufgaben aus den Projekten, die du sehen kannst. Steht eine Aufgabe bei
          mehreren, erscheint sie bei jedem. Auch im Telegram-Assistenten abrufbar, z. B. „Was muss Quirin diese Woche erledigen?“
        </p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Mitarbeiter</span>
          <select className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="alle">Alle</option>
            {personenAuswahl.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Fälligkeit</span>
          <select className={inputClass} value={zeitraum} onChange={(e) => setZeitraum(e.target.value as Zeitraum)}>
            {ZEITRAEUME.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Art</span>
          <div className="flex flex-wrap gap-2 pt-1">
            {(Object.keys(ART_TEXT) as AufgabenArt[]).map((art) => (
              <label key={art} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={arten[art]} onChange={(e) => setArten((a) => ({ ...a, [art]: e.target.checked }))} />
                {ART_TEXT[art]}
              </label>
            ))}
          </div>
        </div>
      </div>

      {person === 'alle' && gruppen.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {gruppen.map((g) => (
            <button
              key={g.person}
              onClick={() => setPerson(g.person)}
              className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-accent-300 hover:bg-accent-50/40"
            >
              <p className="truncate text-sm font-medium text-slate-800">{g.person}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {g.aufgaben.length} offen
                {g.ueberfaellig > 0 && <span className="font-medium text-rose-600"> · {g.ueberfaellig} überfällig</span>}
                {g.heute > 0 && <span className="font-medium text-amber-700"> · {g.heute} heute</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {person !== 'alle' && (
        <button onClick={() => setPerson('alle')} className="mb-3 text-sm text-accent-700 hover:underline">
          ← Alle Mitarbeiter anzeigen
        </button>
      )}

      {sichtbareGruppen.length === 0 ? (
        <EmptyState text="Keine offenen Aufgaben für diese Auswahl." />
      ) : (
        <div className="space-y-5">
          {sichtbareGruppen.map((g) => (
            <section key={g.person}>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                {g.person}
                <span className="ml-2 font-normal text-slate-400">
                  {g.aufgaben.length} {g.aufgaben.length === 1 ? 'Aufgabe' : 'Aufgaben'}
                </span>
              </h2>
              {g.person.endsWith(NICHT_IM_TEAM) && (
                <p className="mb-2 text-xs text-slate-500">Dieser Name passt zu keinem Mitarbeiter im CRM. Bitte die Aufgabe einem Kollegen zuordnen.</p>
              )}
              {g.person === OHNE_ZUSTAENDIGEN && <p className="mb-2 text-xs text-slate-500">Hier ist niemand eingetragen. Bitte einen Zuständigen festlegen.</p>}
              <Card className="divide-y divide-slate-100 p-0">
                {g.aufgaben.map((a) => (
                  <AufgabeZeile key={`${g.person}|${a.id}`} a={a} onOeffnen={() => a.pfad && navigate(a.pfad)} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function AufgabeZeile({ a, onOeffnen }: { a: Aufgabe; onOeffnen: () => void }) {
  const mitAnderen = a.allePersonen.filter((p) => p !== a.person)
  return (
    <button onClick={onOeffnen} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
      <span className={`mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${LAGE_FARBE[a.lage]}`} title={a.datumArt}>
        {a.datumIso ? fmtDate(a.datumIso) : 'ohne Datum'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-800">
          {a.titel}
          {a.privat && <Lock size={12} className="ml-1 inline text-slate-400" aria-label="eigene Liste" />}
        </span>
        <span className="block text-xs text-slate-500">
          {[ART_TEXT[a.art], a.bezug, a.bereich, a.datumIso && a.datumArt ? `${a.datumArt} ${fmtDate(a.datumIso)}` : '', a.lage === 'ueberfaellig' ? LAGE_TEXT.ueberfaellig : '', mitAnderen.length ? `auch: ${mitAnderen.join(', ')}` : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
    </button>
  )
}
