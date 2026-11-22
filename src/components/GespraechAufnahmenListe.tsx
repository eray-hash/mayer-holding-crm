// Abschnitt „Aufnahmen“ in der Akte (22.11.2026): Gesprächsaufnahmen aus der App „Mayer Gespräch“, die mit
// dieser Akte verknüpft sind — Stand, Datum, Dauer, wer aufgenommen hat. Eigene Aufnahmen öffnen sich in der
// App (Prüfbildschirm, Übernehmen); bei Aufnahmen von Kollegen steht nur die Zusammenfassung (lesen darf sie,
// wer die Akte sehen darf — Zeilenschutz der Datenbank). Ohne Tabelle oder ohne Recht: keine Liste.
// Runde 5: Knopf „Gespräch aufnehmen“ (Direkt-Link in die App, Akte vorgewählt) — der Abschnitt steht deshalb
// auch ohne bisherige Aufnahmen da. Für Objektakten mit objektId statt kundeId.
import { useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { aufnahmeLink } from '../gespraech/typen'
import { crmBasis, GespraechAufnehmenKnopf } from './GespraechAufnehmenKnopf'

type Zeile = {
  id: string
  mitarbeiter_email: string
  titel: string | null
  art: string
  status: string
  dauer_s: number | null
  erstellt_am: string
  protokoll: string | null
  zusammenfassung: string | null
}

const STATUS: Record<string, string> = {
  aufnahme: 'läuft', hochladen: 'wird hochgeladen', transkription: 'wird abgeschrieben', analyse: 'wird ausgewertet',
  fertig: 'fertig', fehler: 'Fehler', verworfen: 'verworfen',
}
const ART: Record<string, string> = { termin: 'Kundentermin', telefon: 'Telefonat', notiz: 'Notiz' }

function dauer(s: number | null): string {
  const n = Math.max(0, Math.round(Number(s) || 0))
  return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')} Min.` : ''
}

export function GespraechAufnahmenListe({ kundeId, objektId }: { kundeId?: string; objektId?: string }) {
  const [zeilen, setZeilen] = useState<Zeile[] | null>(null)
  const [ich, setIch] = useState('')
  const [namen, setNamen] = useState<Map<string, string>>(new Map())
  const [offen, setOffen] = useState<string | null>(null)

  useEffect(() => {
    let aktiv = true
    ;(async () => {
      if (!supabase || (!kundeId && !objektId)) return
      const [{ data: sitzung }, { data, error }, { data: team }] = await Promise.all([
        supabase.auth.getSession(),
        supabase
          .from('gespraech_aufnahmen')
          .select('id, mitarbeiter_email, titel, art, status, dauer_s, erstellt_am, protokoll:uebernommen->>protokollId, zusammenfassung:analyse->>zusammenfassung')
          .eq(kundeId ? 'kunde_id' : 'objekt_id', kundeId ?? objektId)
          .neq('status', 'verworfen')
          .order('erstellt_am', { ascending: false })
          .limit(20),
        supabase.from('mitarbeiter').select('name, email'),
      ])
      if (!aktiv) return
      setIch(String(sitzung.session?.user?.email ?? '').toLowerCase())
      setNamen(new Map(((team ?? []) as { name: string; email: string }[]).map((m) => [String(m.email).toLowerCase(), m.name])))
      setZeilen(error ? null : ((data ?? []) as unknown as Zeile[]))
    })().catch(() => aktiv && setZeilen(null))
    return () => {
      aktiv = false
    }
  }, [kundeId, objektId])

  if (!kundeId && !objektId) return null
  const basis = crmBasis()
  const liste = zeilen ?? []

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className={`flex items-center gap-2 ${liste.length ? 'mb-1.5' : ''}`}>
        <p className="flex flex-1 items-center gap-2 text-sm font-medium text-slate-700">
          <Mic size={15} className="text-slate-400" /> Aufnahmen
          {zeilen && liste.length === 0 && <span className="text-xs font-normal text-slate-400">noch keine</span>}
        </p>
        <GespraechAufnehmenKnopf kunde={kundeId} objekt={kundeId ? undefined : objektId} />
      </div>
      {liste.length > 0 && (
        <ul className="space-y-1.5">
          {liste.map((z) => {
            const eigene = z.mitarbeiter_email.toLowerCase() === ich
            const datum = new Date(z.erstellt_am).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            return (
              <li key={z.id} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-800">{z.titel || ART[z.art] || 'Aufnahme'}</span>
                  <span className={`shrink-0 text-xs ${z.status === 'fehler' ? 'text-rose-600' : z.status === 'fertig' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {z.protokoll ? 'übernommen' : STATUS[z.status] ?? z.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-2 text-xs text-slate-400">
                  <span>{datum}</span>
                  {dauer(z.dauer_s) && <span>{dauer(z.dauer_s)}</span>}
                  {!eigene && <span>{namen.get(z.mitarbeiter_email.toLowerCase()) ?? z.mitarbeiter_email}</span>}
                  {eigene ? (
                    <a href={aufnahmeLink(basis, z.id)} target="_blank" rel="noreferrer" className="text-accent-600 hover:underline">In der App öffnen</a>
                  ) : z.zusammenfassung ? (
                    <button onClick={() => setOffen(offen === z.id ? null : z.id)} className="text-accent-600 hover:underline">{offen === z.id ? 'Zuklappen' : 'Zusammenfassung'}</button>
                  ) : null}
                </div>
                {offen === z.id && z.zusammenfassung && <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-2 text-xs text-slate-600">{z.zusammenfassung}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
