// Zeitleiste des Tages (neben der Block-Ansicht) und zugleich die Handy-Ansicht: eine durchgehende Liste nach Uhrzeit
// mit großen Häkchen, „Jetzt dran“, Stoppuhr je Zeile, Umsatz, Telefonnummern/„Anruf notieren“ und den
// Lösungsvorschlägen. Die Zeiten rechnet _shared/tagesplanKern.ts (zeitplan): Termine fest, alles andere der Reihe nach.
import { useEffect, useState } from 'react'
import { Check, Pause, Play } from 'lucide-react'
import {
  BLOCK_TITEL,
  bilanz,
  BUDGET,
  dauerText,
  euro,
  gelaufeneMinuten,
  jetztDran,
  minutenZuUhr,
  type PlanZeile,
  zeitplan,
} from '../../../supabase/functions/_shared/tagesplanKern.ts'
import { AnrufSpalte } from './AnrufSpalte'
import { LoesungsKnopf } from './Loesungsvorschlaege'

export type ZeilenAktionen = {
  onAbhaken: (id: string, erledigt: boolean) => void
  onStoppuhr: (id: string) => void
  onAnrufNotiert: (zeile: string) => void
  umsatzVon: (z: PlanZeile) => number | undefined
  fragenVon: (z: PlanZeile) => string | undefined
  /** Nur lesen (Tag eines Kollegen). */
  nurLesen?: boolean
}

/** Minuten seit Mitternacht, alle 30 Sekunden neu. */
export function useJetztMinuten(aktiv: boolean): number {
  const [jetzt, setJetzt] = useState(() => new Date())
  useEffect(() => {
    if (!aktiv) return
    const t = window.setInterval(() => setJetzt(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [aktiv])
  return jetzt.getHours() * 60 + jetzt.getMinutes()
}

export function StoppuhrAnzeige({ z }: { z: PlanZeile }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!z.laeuftSeit) return
    const t = window.setInterval(() => setTick((x) => x + 1), 15_000)
    return () => window.clearInterval(t)
  }, [z.laeuftSeit])
  const minuten = (z.istMin ?? 0) + gelaufeneMinuten(z.laeuftSeit, new Date())
  if (!minuten && !z.laeuftSeit) return null
  return <span className={`text-xs tabular-nums ${z.laeuftSeit ? 'font-semibold text-accent-700' : 'text-slate-500'}`}>{dauerText(minuten)}</span>
}

export function StoppuhrKnopf({ z, onStoppuhr, gross }: { z: PlanZeile; onStoppuhr: (id: string) => void; gross?: boolean }) {
  const laeuft = !!z.laeuftSeit
  return (
    <button
      onClick={() => onStoppuhr(z.id)}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border ${gross ? 'h-9 w-9' : 'h-8 w-8'} ${laeuft ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
      aria-label={laeuft ? `Stoppuhr für ${z.was} anhalten` : `Stoppuhr für ${z.was} starten`}
      title={laeuft ? 'Stoppuhr anhalten' : 'Stoppuhr starten'}
    >
      {laeuft ? <Pause size={15} /> : <Play size={15} />}
    </button>
  )
}

export function Zeitleiste({ zeilen, startUhr, istHeute, aktionen }: { zeilen: PlanZeile[]; startUhr: string; istHeute: boolean; aktionen: ZeilenAktionen }) {
  const jetzt = useJetztMinuten(istHeute)
  const gefuellt = zeilen.filter((z) => z.was.trim() !== '')
  const plan = zeitplan(gefuellt, startUhr)
  const dran = istHeute ? jetztDran(gefuellt, plan, jetzt) : null
  const nachId = new Map(gefuellt.map((z) => [z.id, z]))
  const ganztags = gefuellt.filter((z) => z.terminId && !z.festVon)
  const bi = bilanz(gefuellt, aktionen.umsatzVon)
  const puffer = BUDGET.unvorhergesehen ?? 0

  if (gefuellt.length === 0) return <p className="text-sm text-slate-400">Noch keine Einträge. Mit „Tag vorschlagen“ füllt das CRM den Tag aus deiner To-do-Liste.</p>

  return (
    <div>
      {ganztags.length > 0 && (
        <ul className="mb-2 space-y-1">
          {ganztags.map((z) => (
            <li key={z.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="mr-2 rounded bg-accent-100 px-1.5 py-px text-[11px] font-semibold text-accent-700">Termin</span>
              {z.was}
            </li>
          ))}
        </ul>
      )}
      <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {plan.eintraege.map((e) => {
          const z = nachId.get(e.id)
          if (!z) return null
          const istDran = z.id === dran
          const umsatz = aktionen.umsatzVon(z)
          const fragen = aktionen.fragenVon(z)
          // „hinter der Zeit“ nur an der Zeile, die jetzt dran ist — sonst stünde es abends an jeder Zeile.
          const vorbei = istDran && istHeute && !z.erledigt && e.bis <= jetzt && !e.fest
          return (
            <li key={z.id} className={`flex gap-3 px-3 py-3 ${istDran ? 'bg-accent-50 ring-2 ring-inset ring-accent-300' : ''} ${z.erledigt ? 'bg-slate-50/60' : ''}`}>
              <button
                onClick={() => !aktionen.nurLesen && aktionen.onAbhaken(z.id, !z.erledigt)}
                disabled={aktionen.nurLesen}
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 ${z.erledigt ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent hover:border-emerald-400'}`}
                aria-label={z.erledigt ? `${z.was}: wieder öffnen` : `${z.was}: erledigt`}
                aria-pressed={!!z.erledigt}
              >
                <Check size={18} strokeWidth={3} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className={`font-semibold tabular-nums ${e.fest ? 'text-accent-700' : 'text-slate-500'}`}>
                    {minutenZuUhr(e.von)}–{minutenZuUhr(e.bis)}
                  </span>
                  <span className="text-slate-400">{e.fest ? 'Termin' : BLOCK_TITEL[z.block]}</span>
                  {istDran && <span className="rounded bg-accent-600 px-1.5 py-px text-[11px] font-semibold text-white">Jetzt dran</span>}
                  {vorbei && <span className="text-amber-600">hinter der Zeit</span>}
                  {z.ausVortag && <span className="text-slate-400">offen seit {z.ausVortag.slice(8, 10)}.{z.ausVortag.slice(5, 7)}.</span>}
                </div>
                <div className={`mt-0.5 break-words text-[15px] leading-snug ${z.erledigt ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{z.was}</div>
                {z.stand && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{z.stand}</div>}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {umsatz ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{euro(umsatz)}</span> : null}
                  <StoppuhrAnzeige z={z} />
                  {z.todoId && fragen?.trim() && !z.erledigt && !aktionen.nurLesen && <LoesungsKnopf todoId={z.todoId} aufgabe={z.was} fragen={fragen} klein />}
                </div>
                {!aktionen.nurLesen && z.bezug && (
                  <div className="mt-1.5">
                    <AnrufSpalte bezug={z.bezug} onNotiert={aktionen.onAnrufNotiert} kompakt />
                  </div>
                )}
              </div>
              {!aktionen.nurLesen && !z.erledigt && !e.fest && <StoppuhrKnopf z={z} onStoppuhr={aktionen.onStoppuhr} gross />}
            </li>
          )
        })}
        <li className="px-3 py-2 text-xs text-slate-500">
          bis ca. {minutenZuUhr(plan.ende)} Uhr geplant · danach {dauerText(puffer)} Puffer für Unvorhergesehenes (bis ca. {minutenZuUhr(plan.ende + puffer)} Uhr)
        </li>
      </ol>
      <p className="mt-2 text-xs text-slate-500">
        {bi.erledigt} von {bi.anzahl} erledigt{bi.umsatzMoeglich > 0 ? ` · möglicher Umsatz heute ${euro(bi.umsatzMoeglich)}` : ''}
      </p>
    </div>
  )
}

/** Tagesabschluss: erledigt vs. geplant, Zeit geplant vs. gestoppt, bewegter Umsatz. */
export function Tagesbilanz({ zeilen, umsatzVon }: { zeilen: PlanZeile[]; umsatzVon: (z: PlanZeile) => number | undefined }) {
  const b = bilanz(zeilen.filter((z) => z.was.trim() !== ''), umsatzVon)
  if (b.anzahl === 0) return null
  const quote = Math.round((b.erledigt / b.anzahl) * 100)
  const kachel = 'rounded-lg bg-slate-50 px-3 py-2'
  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className={kachel}>
        <div className="text-xs text-slate-500">Erledigt</div>
        <div className="font-semibold text-slate-800">
          {b.erledigt} von {b.anzahl} <span className="text-xs font-normal text-slate-400">({quote} %)</span>
        </div>
      </div>
      <div className={kachel}>
        <div className="text-xs text-slate-500">Zeit geplant / gestoppt</div>
        <div className="font-semibold text-slate-800">
          {b.minutenGeplant ? dauerText(b.minutenGeplant) : '–'} / {b.minutenIst ? dauerText(b.minutenIst) : '–'}
        </div>
      </div>
      <div className={kachel}>
        <div className="text-xs text-slate-500">Möglicher Umsatz heute</div>
        <div className="font-semibold text-slate-800">{b.umsatzMoeglich ? euro(b.umsatzMoeglich) : '–'}</div>
      </div>
      <div className={kachel}>
        <div className="text-xs text-slate-500">Umsatz bewegt</div>
        <div className="font-semibold text-emerald-700">{b.umsatzErledigt ? euro(b.umsatzErledigt) : '–'}</div>
      </div>
    </div>
  )
}
