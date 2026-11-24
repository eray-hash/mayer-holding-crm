// Eine Karte je automatischer Nachricht: zugeklappt Name, Stand und „Wann“; aufgeklappt Wenn/Wann/An, Schalter,
// Text und die letzten Nachrichten aus dem Verlauf.
import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AutomatikEintrag } from '../../lib/automatik/katalog'
import { pilleFuer, zeitText, type AutomatikStand, type MitarbeiterKurz, type SchalterAenderung } from '../../lib/automatik/schalter'
import { STAND_FARBE, type VerlaufEintrag } from '../../lib/automatik/verlauf'
import { SchalterSteuerung } from './SchalterSteuerung'
import { TextBereich } from './TextAnzeige'

type Props = {
  eintrag: AutomatikEintrag
  stand: AutomatikStand | null
  mitarbeiter: MitarbeiterKurz[]
  letzte: VerlaufEintrag[]
  verlaufGeladen: boolean
  darfAendern: boolean
  onSchalter: (id: string, a: SchalterAenderung) => Promise<boolean>
}

function Zeile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[88px_1fr] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700">{children}</dd>
    </div>
  )
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold text-slate-500">{titel}</h4>
      {children}
    </section>
  )
}

export function EintragKarte({ eintrag, stand, mitarbeiter, letzte, verlaufGeladen, darfAendern, onSchalter }: Props) {
  const [offen, setOffen] = useState(false)
  const pille = pilleFuer(eintrag, stand)

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <button onClick={() => setOffen((x) => !x)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left" aria-expanded={offen}>
        {offen ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{eintrag.name}</span>
            <span title={pille.titel} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pille.farbe}`}>
              {pille.label}
            </span>
            {eintrag.hinweis && <span className="text-[11px] text-slate-400">{eintrag.hinweis}</span>}
          </span>
          {!offen && (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              Wann: {eintrag.anlass} → {eintrag.zeitpunkt}
            </span>
          )}
        </span>
      </button>
      {offen && (
        <div className="space-y-4 border-t border-slate-100 px-3 py-3 sm:pl-8">
          <dl className="space-y-1.5">
            <Zeile label="Wenn">{eintrag.anlass}</Zeile>
            <Zeile label="Wann">{eintrag.zeitpunkt}</Zeile>
            <Zeile label="An">{eintrag.empfaenger}</Zeile>
          </dl>
          <Abschnitt titel="Schalter">
            <SchalterSteuerung eintrag={eintrag} stand={stand} mitarbeiter={mitarbeiter} darfAendern={darfAendern} onSchalter={onSchalter} />
          </Abschnitt>
          <Abschnitt titel="Text">
            <TextBereich eintrag={eintrag} stand={stand} darfAendern={darfAendern} onSchalter={onSchalter} />
          </Abschnitt>
          <Abschnitt titel={eintrag.protokoll === 'wiedervorlagen' ? 'Nächste fällige' : 'Letzte Nachrichten'}>
            <LetzteNachrichten eintrag={eintrag} letzte={letzte} verlaufGeladen={verlaufGeladen} />
          </Abschnitt>
        </div>
      )}
    </div>
  )
}

function LetzteNachrichten({ eintrag, letzte, verlaufGeladen }: { eintrag: AutomatikEintrag; letzte: VerlaufEintrag[]; verlaufGeladen: boolean }) {
  if (eintrag.kanal === 'privat') return <p className="text-xs text-slate-500">Bewusst nicht aufgezeichnet – privat.</p>
  if (eintrag.protokoll === 'keins') return <p className="text-xs text-slate-500">Wird nicht aufgezeichnet.</p>
  if (!verlaufGeladen) return <p className="text-xs text-slate-400">Wird geladen …</p>
  if (letzte.length === 0)
    return <p className="text-xs text-slate-500">{eintrag.protokoll === 'wiedervorlagen' ? 'In den nächsten 14 Tagen ist keine fällig.' : 'In den letzten 30 Tagen keine.'}</p>
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
      {letzte.map((v) => (
        <li key={v.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-xs">
          <span className="w-32 shrink-0 text-slate-500">{zeitText(v.zeitpunkt)}</span>
          <span className="min-w-0 flex-1 truncate text-slate-700">{v.an}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAND_FARBE[v.stand]}`}>{v.standText}</span>
        </li>
      ))}
    </ul>
  )
}
