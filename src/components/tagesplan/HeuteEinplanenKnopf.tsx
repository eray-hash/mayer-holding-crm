// Knopf „Heute einplanen“ in der eigenen To-do-Liste: legt das To-do in den heutigen Tagesablauf (Seite „Tagesablauf &
// Woche“) — in den Block nach Prio (fällig → Fristsachen, bis 10 Minuten → kurze Arbeiten), mit dem To-do verknüpft.
// Nur für die eigene Liste und nur mit Immobilien-Recht (der Tagesablauf gehört zur Immobilienabteilung).
import { CalendarPlus, Check } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { darfBereich } from '../../lib/bereichsRechte'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { CURRENT_USER } from '../../data/constants'
import { today, uid } from '../../lib/dates'
import type { Tagesplan, ToDoEintrag } from '../../types'
import {
  dauerVonTodo,
  istFaellig,
  KURZ_BIS,
  ordneNachBloecken,
  type PlanBlock,
  type PlanTag,
  type PlanZeile,
  prioRang,
  STANDARD_START,
  todoText,
} from '../../../supabase/functions/_shared/tagesplanKern.ts'
import { alsPlanTodo } from './planDaten'

export function HeuteEinplanenKnopf({ todo }: { todo: ToDoEintrag }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  if (isSupabaseConfigured && !darfBereich(mitarbeiter, 'immobilien')) return null
  if ((todo.erledigtAm ?? '').trim()) return null
  const ich = mitarbeiter?.name ?? CURRENT_USER
  const datum = today()
  const plan = state.tagesplaene.find((p) => p.mitarbeiter === ich && p.datum === datum) as unknown as PlanTag | undefined
  const schonDrin = !!plan?.zeilen?.some((z) => z.todoId === todo.id)

  function einplanen() {
    if (schonDrin) return
    const t = alsPlanTodo(todo, null)
    const dauer = dauerVonTodo(t)
    const r = prioRang(t.prio)
    const block: PlanBlock = istFaellig(t, datum) ? 'frist' : dauer <= KURZ_BIS ? 'kurz' : r === 0 ? 'A' : r === 1 ? 'B' : 'C'
    const zeile: PlanZeile = { id: uid('tz'), block, was: todoText(t), todoId: todo.id, dauerMin: dauer, quelle: 'hand', ...(todo.umsatzWert ? { umsatz: todo.umsatzWert } : {}) }
    const neu: PlanTag = {
      ...(plan ?? { id: `${ich}|${datum}`, mitarbeiter: ich, datum, anrufe: '', startUhr: STANDARD_START }),
      zeilen: ordneNachBloecken([...(plan?.zeilen ?? []), zeile]),
      aktualisiertAm: new Date().toISOString(),
    } as PlanTag
    dispatch({ type: 'SPEICHERE_TAGESPLAN', plan: neu as unknown as Tagesplan })
  }

  return (
    <button
      onClick={einplanen}
      disabled={schonDrin}
      title={schonDrin ? 'Steht schon in deinem heutigen Tagesablauf' : 'In meinen heutigen Tagesablauf einplanen'}
      className={`rounded-md p-1.5 ${schonDrin ? 'bg-accent-50 text-accent-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
    >
      {schonDrin ? <Check size={14} /> : <CalendarPlus size={14} />}
    </button>
  )
}
