// Schalter einer automatischen Nachricht je nach Art: an/aus, Stufe (aus / Probelauf / alle), Empfängerliste,
// Regel mit Wartezeit, oder nur ein erklärender Satz (je Person, pro Vorgang, immer an).
import { useState } from 'react'
import type { AutomatikEintrag } from '../../lib/automatik/katalog'
import { WARTEZEIT_WAHL } from '../../lib/autoNachrichten'
import {
  empfaengerNamen,
  wartezeitWahlText,
  zeitText,
  type AutomatikStand,
  type MitarbeiterKurz,
  type SchalterAenderung,
  type SchalterStand,
} from '../../lib/automatik/schalter'
import { SecondaryButton } from '../../components/ui'

type Props = {
  eintrag: AutomatikEintrag
  stand: AutomatikStand | null
  mitarbeiter: MitarbeiterKurz[]
  darfAendern: boolean
  onSchalter: (id: string, a: SchalterAenderung) => Promise<boolean>
}

const SELECT = 'rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm disabled:opacity-60'

function Geaendert({ s }: { s?: { geaendertVon?: string; geaendertAm?: string } }) {
  if (!s?.geaendertVon && !s?.geaendertAm) return null
  return (
    <span className="text-xs text-slate-400">
      zuletzt geändert{s.geaendertVon ? ` von ${s.geaendertVon}` : ''}
      {s.geaendertAm ? ` am ${zeitText(s.geaendertAm)}` : ''}
    </span>
  )
}

function Unbekannt() {
  return <p className="text-xs text-slate-500">Stand unbekannt: Der Server liefert diese Einstellung noch nicht.</p>
}

function WartezeitWahl({ wert, disabled, onChange }: { wert: number; disabled: boolean; onChange: (m: number) => void }) {
  const wahl = Array.from(new Set([...WARTEZEIT_WAHL, wert])).sort((a, b) => a - b)
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Wartezeit
      <select value={wert} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className={SELECT}>
        {wahl.map((m) => (
          <option key={m} value={m}>
            {wartezeitWahlText(m)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function SchalterSteuerung({ eintrag, stand, mitarbeiter, darfAendern, onSchalter }: Props) {
  const s = eintrag.schalter
  switch (s.art) {
    case 'immer':
      return <p className="text-sm text-slate-600">Immer an — diese Nachricht lässt sich nicht abschalten.</p>
    case 'je_person':
      return <p className="text-sm text-slate-600">Jeder stellt das für sich selbst ein: {s.wo}.</p>
    case 'je_vorgang':
      return <p className="text-sm text-slate-600">Wird bei jedem einzelnen Vorgang entschieden: {s.wo}.</p>
    case 'regel': {
      const r = stand?.regeln.find((x) => x.id === s.id)
      if (!r) return <Unbekannt />
      const id = `regel:${r.id}`
      return (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={r.aktiv} disabled={!darfAendern} onChange={(e) => onSchalter(id, { wert: e.target.checked })} />
            eingeschaltet
          </label>
          {r.wartezeitMinuten !== null ? (
            <WartezeitWahl wert={r.wartezeitMinuten} disabled={!darfAendern} onChange={(m) => onSchalter(id, { wartezeitMinuten: m })} />
          ) : (
            <span className="text-xs text-slate-500">fester Zeitpunkt: {eintrag.zeitpunkt}</span>
          )}
        </div>
      )
    }
    case 'an_aus': {
      const st = stand?.schalter[s.id]
      if (!st) return <Unbekannt />
      const an = st.wert === true || st.wert === 'alle'
      return (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={an} disabled={!darfAendern} onChange={(e) => onSchalter(s.id, { wert: e.target.checked })} />
            eingeschaltet
          </label>
          {typeof st.wartezeitMinuten === 'number' && (
            <WartezeitWahl wert={st.wartezeitMinuten} disabled={!darfAendern} onChange={(m) => onSchalter(s.id, { wartezeitMinuten: m })} />
          )}
          <Geaendert s={st} />
        </div>
      )
    }
    case 'stufe': {
      const st = stand?.schalter[s.id]
      if (!st) return <Unbekannt />
      return <StufeSchalter id={s.id} st={st} mitUhrzeit={s.id === 'abend_rueckblick'} darfAendern={darfAendern} onSchalter={onSchalter} />
    }
    case 'empfaenger': {
      const st = stand?.schalter[s.id]
      if (!st) return <Unbekannt />
      return <EmpfaengerSchalter id={s.id} st={st} mitarbeiter={mitarbeiter} darfAendern={darfAendern} onSchalter={onSchalter} />
    }
  }
}

function StufeSchalter({ id, st, mitUhrzeit, darfAendern, onSchalter }: { id: string; st: SchalterStand; mitUhrzeit: boolean; darfAendern: boolean; onSchalter: Props['onSchalter'] }) {
  const wert = st.wert === true ? 'alle' : st.wert === false ? 'aus' : st.wert
  const [uhrzeit, setUhrzeit] = useState(st.uhrzeit ?? '')
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Stand
        <select value={wert} disabled={!darfAendern} onChange={(e) => onSchalter(id, { wert: e.target.value as 'aus' | 'superuser' | 'alle' })} className={SELECT}>
          <option value="aus">aus</option>
          <option value="superuser">Probelauf (nur Superuser)</option>
          <option value="alle">an für alle</option>
        </select>
      </label>
      {mitUhrzeit && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          ab
          <input
            type="time"
            value={uhrzeit}
            disabled={!darfAendern}
            onChange={(e) => setUhrzeit(e.target.value)}
            onBlur={async () => {
              if (!uhrzeit || uhrzeit === st.uhrzeit) return
              if (!(await onSchalter(id, { uhrzeit }))) setUhrzeit(st.uhrzeit ?? '')
            }}
            className={SELECT}
          />
          Uhr
        </label>
      )}
      <Geaendert s={st} />
    </div>
  )
}

function EmpfaengerSchalter({ id, st, mitarbeiter, darfAendern, onSchalter }: { id: string; st: SchalterStand; mitarbeiter: MitarbeiterKurz[]; darfAendern: boolean; onSchalter: Props['onSchalter'] }) {
  const an = st.wert === true || st.wert === 'alle'
  const [bearbeiten, setBearbeiten] = useState(false)
  const [auswahl, setAuswahl] = useState<string[]>(st.empfaenger ?? [])
  const alle = auswahl.includes('*')

  function umschalten(email: string) {
    setAuswahl((alt) => (alt.includes(email) ? alt.filter((x) => x !== email) : [...alt.filter((x) => x !== '*'), email]))
  }

  async function speichern() {
    if (await onSchalter(id, { empfaenger: auswahl })) setBearbeiten(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={an} disabled={!darfAendern} onChange={(e) => onSchalter(id, { wert: e.target.checked })} />
          eingeschaltet
        </label>
        <span className="text-sm text-slate-600">Empfänger: {empfaengerNamen(st.empfaenger, mitarbeiter)}</span>
        {darfAendern && !bearbeiten && (
          <button
            onClick={() => {
              setAuswahl(st.empfaenger ?? [])
              setBearbeiten(true)
            }}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            Empfänger ändern
          </button>
        )}
        <Geaendert s={st} />
      </div>
      {bearbeiten && (
        <div className="rounded-lg border border-slate-200 p-3">
          <label className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={alle} onChange={(e) => setAuswahl(e.target.checked ? ['*'] : [])} />
            alle Mitarbeiter
          </label>
          {!alle && (
            <div className="grid gap-1 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={auswahl.includes('superuser')} onChange={() => umschalten('superuser')} />
                alle Superuser
              </label>
              {mitarbeiter.map((m) => (
                <label key={m.email} className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={auswahl.includes(m.email)} onChange={() => umschalten(m.email)} />
                  {m.name}
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <SecondaryButton onClick={speichern}>Empfänger speichern</SecondaryButton>
            <SecondaryButton onClick={() => setBearbeiten(false)}>Abbrechen</SecondaryButton>
          </div>
        </div>
      )}
    </div>
  )
}
