// Hinweis auf „Heute“ (24.11.2026): eigene fertige Gesprächsaufnahmen aus der App „Mayer Gespräch“, die noch in keiner
// Akte gelandet sind (ohne Akte, ohne Objekt, nicht übernommen, nicht verteilt). Bis dahin sah ein Mitarbeiter solche
// Aufnahmen — etwa eine Sprachnotiz über viele Kunden — nur in der App. Der Link öffnet die Aufnahme in der App; bei
// Notizen gleich „Auf mehrere Akten verteilen“. Bei 0 nichts. Fehlt die Spalte verteilung noch (SQL vom 24.11.2026
// nicht eingespielt), wird ohne sie gezählt.
import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { aufnahmeLink } from '../gespraech/typen'
import { crmBasis } from './GespraechAufnehmenKnopf'
import { Card } from './ui'

type Zeile = { id: string; titel: string | null; art: string; erstellt_am: string; dauer_s: number | null; ergebnisse?: Record<string, unknown> | null }

const ART: Record<string, string> = { termin: 'Kundentermin', telefon: 'Telefonat', notiz: 'Sprachnotiz' }
const TAGE = 60

export function GespraechOhneAkteHinweis() {
  const [zeilen, setZeilen] = useState<Zeile[]>([])

  useEffect(() => {
    let aktiv = true
    ;(async () => {
      if (!supabase) return
      const { data: sitzung } = await supabase.auth.getSession()
      const ich = String(sitzung.session?.user?.email ?? '').toLowerCase()
      if (!ich) return
      const ab = new Date(Date.now() - TAGE * 86400000).toISOString()
      const abfrage = (spalten: string) =>
        supabase!
          .from('gespraech_aufnahmen')
          .select(spalten)
          .eq('mitarbeiter_email', ich)
          .eq('status', 'fertig')
          .is('kunde_id', null)
          .is('objekt_id', null)
          .is('uebernommen', null)
          .gte('erstellt_am', ab)
          .order('erstellt_am', { ascending: false })
          .limit(20)
      let { data, error } = await abfrage('id, titel, art, erstellt_am, dauer_s, ergebnisse:verteilung->ergebnisse')
      if (error) ({ data, error } = await abfrage('id, titel, art, erstellt_am, dauer_s'))
      if (!aktiv || error) return
      setZeilen(((data ?? []) as unknown as Zeile[]).filter((z) => !z.ergebnisse || Object.keys(z.ergebnisse).length === 0))
    })().catch(() => {})
    return () => {
      aktiv = false
    }
  }, [])

  if (zeilen.length === 0) return null
  const basis = crmBasis()
  return (
    <Card className="mb-5 border-indigo-200 bg-indigo-50/40 p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-indigo-800">
        <Mic size={14} /> Gesprächsaufnahmen ohne Akte ({zeilen.length})
      </h2>
      <p className="mb-3 text-xs text-indigo-800/70">
        Fertig ausgewertet, aber noch in keiner Akte. Geht es um mehrere Kunden, lässt sich die Aufnahme in der App auf mehrere Akten verteilen.
      </p>
      <ul className="space-y-1.5 text-sm">
        {zeilen.slice(0, 5).map((z) => (
          <li key={z.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate text-slate-700">
              {z.titel || ART[z.art] || 'Aufnahme'}
              <span className="text-xs text-slate-400"> · {new Date(z.erstellt_am).toLocaleDateString('de-DE')}{z.dauer_s ? ` · ${Math.round(z.dauer_s / 60)} Min.` : ''}</span>
            </span>
            <a
              href={`${aufnahmeLink(basis, z.id)}${z.art === 'notiz' ? '?verteilen=1' : ''}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              {z.art === 'notiz' ? 'Auf Akten verteilen' : 'In die Akte übernehmen'}
            </a>
          </li>
        ))}
        {zeilen.length > 5 && <li className="text-xs text-slate-400">und {zeilen.length - 5} weitere in der App unter „Meine Aufnahmen“</li>}
      </ul>
    </Card>
  )
}
