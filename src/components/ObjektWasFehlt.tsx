// „Was fehlt noch“ in der Objektakte und der Vollständigkeits-Ring in der Objektliste (22.11.2026).
// Die Prüfliste (welche Punkte in welchem Stand zählen, wie schwer sie wiegen, wo man sie einträgt) steht im
// gemeinsamen Kern supabase/functions/_shared/objektVollstaendigkeit.ts — dieselbe Rechnung nutzt der
// Assistent (objekt_luecken) und der Wochenhinweis am Montag.
//
// Nummern des Inserats (objekte.anfrage_kennungen) und die Freigaben fürs Interessenten-Portal
// (objekte.interessenten_dokumente) stehen nicht im geladenen CRM-Zustand; sie werden hier eigens gelesen,
// in der Akte bei jedem Reiterwechsel neu (dort ändert man sie ja).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import { Card } from './ui'
import { supabase } from '../lib/supabaseClient'
import {
  PHASE_TEXT, pruefeVollstaendigkeit, type Punkt, type Vollstaendigkeit,
} from '../../supabase/functions/_shared/objektVollstaendigkeit.ts'
import type { Objekt } from '../types'

/** Portal-Angaben eines Objekts; undefined = (noch) nicht geladen. */
export type PortalAngaben = { anfrageKennungen: string[]; interessentenDokumente: string[] }

/** Die Prüfung für ein Objekt aus dem CRM-Zustand. */
export function vollstaendigkeitVon(o: Objekt, portal?: PortalAngaben): Vollstaendigkeit {
  return pruefeVollstaendigkeit({
    status: o.status,
    typ: o.typ,
    kaufpreis: o.kaufpreis,
    adresse: o.adresse,
    verantwortlich: o.verantwortlich,
    eigentuemer: o.eigentuemer,
    verkaufsdaten: o.verkaufsdaten,
    dokumente: o.dokumente,
    bilderReihenfolge: o.bilderReihenfolge,
    exposeText: o.exposeText,
    anfrageKennungen: portal?.anfrageKennungen ?? null,
    interessentenDokumente: portal?.interessentenDokumente ?? null,
    offMarket: o.offMarket,
    privat: !!o.privatBesitzer,
  })
}

function farbe(prozent: number): { strich: string; text: string } {
  if (prozent >= 100) return { strich: '#10b981', text: 'text-emerald-600' }
  if (prozent >= 75) return { strich: '#0ea5e9', text: 'text-sky-700' }
  if (prozent >= 45) return { strich: '#f59e0b', text: 'text-amber-700' }
  return { strich: '#f43f5e', text: 'text-rose-600' }
}

/** Kleiner Ring mit Prozentzahl. */
export function VollstaendigkeitsRing({ prozent, groesse = 30, titel }: { prozent: number; groesse?: number; titel?: string }) {
  const r = (groesse - 5) / 2
  const umfang = 2 * Math.PI * r
  const f = farbe(prozent)
  return (
    <span className="relative inline-flex flex-shrink-0 items-center justify-center" style={{ width: groesse, height: groesse }} title={titel} aria-label={titel ?? `${prozent} % vollständig`}>
      <svg width={groesse} height={groesse} className="-rotate-90">
        <circle cx={groesse / 2} cy={groesse / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={3} />
        <circle cx={groesse / 2} cy={groesse / 2} r={r} fill="none" stroke={f.strich} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${(umfang * prozent) / 100} ${umfang}`} />
      </svg>
      <span className={`absolute text-[9px] font-semibold ${f.text}`}>{prozent}</span>
    </span>
  )
}

/** Liest Nummern des Inserats und Portal-Freigaben für viele Objekte auf einmal (Objektliste). */
export async function ladePortalAngaben(ids: string[]): Promise<Map<string, PortalAngaben>> {
  const m = new Map<string, PortalAngaben>()
  if (!supabase || ids.length === 0) return m
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('objekte').select('id, anfrage_kennungen, interessenten_dokumente').in('id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const z of (data ?? []) as { id: string; anfrage_kennungen: unknown; interessenten_dokumente: unknown }[]) {
      m.set(z.id, {
        anfrageKennungen: Array.isArray(z.anfrage_kennungen) ? (z.anfrage_kennungen as string[]) : [],
        interessentenDokumente: Array.isArray(z.interessenten_dokumente) ? (z.interessenten_dokumente as string[]) : [],
      })
    }
  }
  return m
}

/** Kasten „Was fehlt noch“ für die Objektakte. Springt per Klick in den richtigen Reiter (und Ordner). */
export function ObjektWasFehlt({ objekt, privat }: { objekt: Objekt; privat?: boolean }) {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'uebersicht'
  const [portal, setPortal] = useState<PortalAngaben | undefined>(undefined)
  const [offen, setOffen] = useState<boolean | null>(null)

  useEffect(() => {
    if (privat || !supabase) return
    let aktiv = true
    supabase
      .from('objekte')
      .select('anfrage_kennungen, interessenten_dokumente')
      .eq('id', objekt.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv || error) return
        setPortal({
          anfrageKennungen: Array.isArray(data?.anfrage_kennungen) ? (data!.anfrage_kennungen as string[]) : [],
          interessentenDokumente: Array.isArray(data?.interessenten_dokumente) ? (data!.interessenten_dokumente as string[]) : [],
        })
      })
    return () => {
      aktiv = false
    }
  }, [objekt.id, privat, tab])

  const v = vollstaendigkeitVon(objekt, portal)
  if (!v.gilt) return null
  // Ohne geladene Portal-Angaben wären Inserat und Portal fälschlich „offen“: so lange weglassen.
  const fehlend = !privat && !portal ? v.fehlend.filter((p) => p.schluessel !== 'inserat' && p.schluessel !== 'portal') : v.fehlend
  const prozent = v.prozent ?? 0
  // Aufgeklappt, solange das Objekt vorbereitet oder vermarktet wird; sonst zugeklappt (eine Zeile).
  const aufgeklappt = offen ?? ((v.phase === 'vorbereitung' || v.phase === 'vermarktung') && fehlend.length > 0)

  function oeffne(p: Punkt) {
    setParams(p.ordner ? { tab: p.reiter, ordner: p.ordner } : { tab: p.reiter })
  }

  if (fehlend.length === 0) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-700">
        <CheckCircle2 size={16} /> Objektakte für den Stand „{PHASE_TEXT[v.phase]}“ vollständig.
      </div>
    )
  }

  return (
    <Card className="mb-4 p-4">
      <button onClick={() => setOffen(!aufgeklappt)} className="flex w-full items-center gap-3 text-left" aria-expanded={aufgeklappt}>
        <VollstaendigkeitsRing prozent={prozent} groesse={36} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-700">Was fehlt noch</div>
          <div className="text-xs text-slate-500">
            {prozent} % vollständig für den Stand „{PHASE_TEXT[v.phase]}“ · {fehlend.length} {fehlend.length === 1 ? 'Punkt offen' : 'Punkte offen'}
          </div>
        </div>
        {aufgeklappt ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {aufgeklappt && (
        <>
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {fehlend.map((p) => (
              <li key={p.schluessel} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-700">
                    {p.titel}
                    {p.detail && <span className="ml-1.5 text-xs font-normal text-slate-400">({p.detail})</span>}
                  </div>
                  <div className="text-xs text-slate-500">{p.hinweis}</div>
                </div>
                {!(p.reiter === tab && (p.ordner ?? null) === params.get('ordner')) ? (
                  <button onClick={() => oeffne(p)} className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100">
                    Dorthin <ArrowRight size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">
            Gezählt wird, was im aktuellen Stand wichtig ist — in der Akquise nur Eckdaten, in der Vermarktung auch Fotos, Exposé, Inserat und Interessenten-Portal.
          </p>
        </>
      )}
    </Card>
  )
}
