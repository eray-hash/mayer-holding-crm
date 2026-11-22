// „3 x Lösungsvorschläge“ aus Quirins Vorlage: Für eine Aufgabe, die festhängt (offene Fragen im To-do), fragt der
// Knopf den Assistenten nach drei konkreten nächsten Schritten — auf Grundlage des To-dos und der verknüpften Akte bzw.
// des Objekts (Server-Aktion tagesplan, art loesungen). Ein Vorschlag lässt sich als „nächster Schritt“ ins To-do
// übernehmen.
import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { call as gatewayCall, isEmailGatewayConfigured } from '../../lib/emailGateway'
import { Modal, PrimaryButton, SecondaryButton } from '../ui'
import { fmtDate, today } from '../../lib/dates'

type Loesung = { titel: string; schritt: string; warum: string }

export function LoesungsKnopf({ todoId, aufgabe, fragen, klein }: { todoId: string; aufgabe: string; fragen?: string; klein?: boolean }) {
  const { state, dispatch } = useApp()
  const [offen, setOffen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [vorschlaege, setVorschlaege] = useState<Loesung[]>([])
  const [mitAkte, setMitAkte] = useState(false)
  const [uebernommen, setUebernommen] = useState<number | null>(null)

  if (!isEmailGatewayConfigured) return null

  async function holen() {
    setOffen(true)
    setLaeuft(true)
    setFehler('')
    setUebernommen(null)
    try {
      const r = (await gatewayCall({ action: 'tagesplan', art: 'loesungen', todoId })) as { vorschlaege?: Loesung[]; mitAkte?: boolean }
      setVorschlaege(r.vorschlaege ?? [])
      setMitAkte(!!r.mitAkte)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Vorschläge konnten nicht geholt werden.')
    } finally {
      setLaeuft(false)
    }
  }

  function uebernehmen(i: number) {
    const v = vorschlaege[i]
    const t = state.todos.find((x) => x.id === todoId)
    if (!v || !t) return
    const tag = fmtDate(today()).slice(0, 5)
    const neu = `${tag} ${v.schritt}${t.naechsteSchritte?.trim() ? ` ${t.naechsteSchritte.trim()}` : ''}`
    dispatch({ type: 'UPDATE_TODO', id: todoId, patch: { naechsteSchritte: neu } })
    setUebernommen(i)
  }

  return (
    <>
      <button
        onClick={holen}
        className={`inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 font-medium text-amber-800 hover:bg-amber-100 ${klein ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-xs'}`}
        title="Drei Lösungsvorschläge vom Assistenten"
      >
        <Lightbulb size={12} /> 3 Lösungen
      </button>
      <Modal
        open={offen}
        onClose={() => setOffen(false)}
        title="3 Lösungsvorschläge"
        width="max-w-xl"
      >
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <div className="font-medium text-slate-800">{aufgabe}</div>
            {fragen?.trim() && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-500">Offene Fragen: {fragen.trim().slice(0, 400)}</div>}
          </div>
          {laeuft && <p className="text-slate-500">Der Assistent denkt nach …</p>}
          {fehler && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{fehler}</p>}
          {!laeuft && vorschlaege.length > 0 && (
            <>
              <ol className="space-y-2">
                {vorschlaege.map((v, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="font-semibold text-slate-800">
                      {i + 1}. {v.titel}
                    </div>
                    <p className="mt-1 text-slate-700">{v.schritt}</p>
                    {v.warum && <p className="mt-1 text-xs text-slate-500">{v.warum}</p>}
                    <div className="mt-2">
                      {uebernommen === i ? (
                        <span className="text-xs font-medium text-emerald-600">Als nächsten Schritt ins To-do übernommen.</span>
                      ) : (
                        <SecondaryButton onClick={() => uebernehmen(i)}>Als nächsten Schritt übernehmen</SecondaryButton>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-slate-400">{mitAkte ? 'Grundlage: das To-do und die verknüpfte Akte bzw. das Objekt.' : 'Grundlage: das To-do (ohne verknüpfte Akte).'} Vorschläge prüfen — der Assistent kennt nicht alles.</p>
            </>
          )}
          <div className="flex justify-end gap-2">
            {!laeuft && <SecondaryButton onClick={holen}>Neue Vorschläge</SecondaryButton>}
            <PrimaryButton onClick={() => setOffen(false)}>Schließen</PrimaryButton>
          </div>
        </div>
      </Modal>
    </>
  )
}
