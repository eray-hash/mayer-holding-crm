// Hinweis auf „Heute“ (22.11.2026): wie viele Neuanfragen noch niemand gesichtet hat, mit Knopf zur Seite
// „Neuanfragen sichten“. Zählt wie die Seite (ohne Altbestände, ohne Zurückgestellte); bei 0 nichts.
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Card } from '../../components/ui'
import { useNeuanfragen } from './neuanfragenDaten'

export function NeuanfragenHinweis() {
  const navigate = useNavigate()
  const { alle, geladen } = useNeuanfragen()
  if (!geladen) return null
  const offen = alle.filter((n) => n.lage === 'offen' && n.herkunft !== 'altbestand')
  if (offen.length === 0) return null
  const jeBereich = new Map<string, number>()
  for (const n of offen) jeBereich.set(n.bereichLabel, (jeBereich.get(n.bereichLabel) ?? 0) + 1)
  return (
    <Card className="mb-5 border-sky-200 bg-sky-50/40 p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-sky-800">
        <Sparkles size={14} /> Neuanfragen sichten ({offen.length})
      </h2>
      <p className="mb-3 text-xs text-sky-800/70">
        {[...jeBereich.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b}: ${n}`).join(' · ')} — je Anfrage ein Klick: Erstkontakt, archivieren oder später.
      </p>
      <button onClick={() => navigate('/neuanfragen')} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700">
        Jetzt sichten
      </button>
    </Card>
  )
}
