import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { Card } from '../../components/ui'
import { fmtEUR } from '../../lib/dates'

type LeistungRow = {
  id: string
  sortierung: number
  bezeichnung: string
  preis_stunde_von: number | null
  preis_stunde_bis: number | null
  preis_tag_von: number | null
  preis_tag_bis: number | null
  hinweis: string | null
  stand: string
}

function spanne(von: number | null, bis: number | null): string {
  if (von == null && bis == null) return '—'
  if (von === bis) return fmtEUR(von!)
  return `${fmtEUR(von!)} – ${fmtEUR(bis!)}`
}

export function Leistungen() {
  const [rows, setRows] = useState<LeistungRow[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) {
      setError('Keine Supabase-Verbindung konfiguriert.')
      return
    }
    supabase
      .from('leistungen_preisliste')
      .select('*')
      .order('sortierung', { ascending: true })
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setRows(data as LeistungRow[])
      })
  }, [])

  const stand = rows?.[0]?.stand

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-800">Leistungen &amp; Preise</h1>
        <p className="text-sm text-slate-500">
          Preis-Stammdaten als Grundlage für Rechnungen{stand ? ` · Stand ${new Date(stand).toLocaleDateString('de-DE')}` : ''} · netto,
          exklusive 19&nbsp;% USt.
        </p>
      </div>

      {error && <p className="mb-4 text-sm font-medium text-rose-600">{error}</p>}

      {!rows && !error && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={16} /> Lädt …
        </div>
      )}

      {rows && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Leistung</th>
                <th className="px-4 py-3">Netto je Stunde</th>
                <th className="px-4 py-3">Netto je Tag / Veranstaltung</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-slate-50 last:border-0 ${r.sortierung === 0 ? 'bg-slate-50/60 font-medium' : ''}`}>
                  <td className="px-4 py-3 text-slate-700">
                    {r.bezeichnung}
                    {r.hinweis && <span className="ml-2 text-xs font-normal text-amber-600" title={r.hinweis}>⚠︎</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{spanne(r.preis_stunde_von, r.preis_stunde_bis)}</td>
                  <td className="px-4 py-3 text-slate-600">{spanne(r.preis_tag_von, r.preis_tag_bis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-4 text-xs text-slate-400">
        Tagessätze gelten als Paket für bis zu 8 Leistungsstunden. Telefonische Beratung wird im 15-Minuten-Takt abgerechnet.
        Projektpauschalen und laufende Mandate nach individueller Vereinbarung.
      </p>

      {!isSupabaseConfigured && <p className="mt-4 text-sm text-slate-400">Demo-Modus ohne Supabase-Verbindung.</p>}
    </div>
  )
}
