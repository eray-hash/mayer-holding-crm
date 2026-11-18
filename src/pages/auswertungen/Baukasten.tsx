import { useMemo, useState } from 'react'
import { Filter as FilterIcon, X } from 'lucide-react'
import { inputClass } from '../../components/ui'
import { BERECHNUNGEN, GRUPPIERUNGEN, beschriftung, werteListe, wirksameGruppierung } from '../../lib/pivot'
import type { Berechnung, Datensatz, Einstellung, Feld, FeldWahl, Filter, Gruppierung } from '../../lib/pivot'

const KEINE = ''

const labelClass = 'mb-1 block text-xs font-medium text-slate-500'
// Ohne die feste volle Breite aus inputClass, damit schmale Felder neben breiten Platz finden.
const basis = inputClass.replace('w-full', '').trim()
const selectClass = `${basis} w-full min-w-0 flex-1`

function FeldWahlEingabe({
  titel,
  felder,
  wahl,
  optional,
  onChange,
}: {
  titel: string
  felder: Feld[]
  wahl: FeldWahl | undefined
  optional?: boolean
  onChange: (w: FeldWahl | undefined) => void
}) {
  const feld = felder.find((f) => f.id === wahl?.feld)
  const g = wirksameGruppierung(feld, wahl?.gruppierung)
  return (
    <div className="min-w-0">
      <span className={labelClass}>{titel}</span>
      <div className="flex min-w-0 gap-2">
        <select
          className={selectClass}
          value={wahl?.feld ?? KEINE}
          aria-label={titel}
          onChange={(e) => {
            const neu = felder.find((f) => f.id === e.target.value)
            onChange(neu ? (neu.typ === 'datum' ? { feld: neu.id, gruppierung: wahl?.gruppierung ?? 'monat' } : { feld: neu.id }) : undefined)
          }}
        >
          {optional && <option value={KEINE}>– keine –</option>}
          {felder.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        {feld?.typ === 'datum' && (
          <select
            className={`${basis} w-32 flex-none`}
            value={g}
            aria-label={`${titel}: zusammenfassen nach`}
            onChange={(e) => onChange({ feld: feld.id, gruppierung: e.target.value as Gruppierung })}
          >
            {GRUPPIERUNGEN.map((x) => (
              <option key={x.id} value={x.id}>
                je {x.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

/** Auswahl der Zeilen, Spalten, Berechnung und Filter. */
export function Baukasten({
  felder,
  daten,
  hauptdatum,
  einstellung: e,
  onChange,
}: {
  felder: Feld[]
  daten: Datensatz[]
  hauptdatum?: string
  einstellung: Einstellung
  onChange: (e: Einstellung) => void
}) {
  const zahlFelder = felder.filter((f) => f.typ === 'zahl')
  const setze = (teil: Partial<Einstellung>) => onChange({ ...e, ...teil })
  const datumFeld = felder.find((f) => f.id === hauptdatum)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FeldWahlEingabe
          titel="Zeilen"
          felder={felder}
          wahl={e.zeilen[0]}
          onChange={(w) => setze({ zeilen: w ? [w, ...e.zeilen.slice(1)] : e.zeilen.slice(1) })}
        />
        <FeldWahlEingabe
          titel="Zweite Zeilenebene"
          felder={felder}
          wahl={e.zeilen[1]}
          optional
          onChange={(w) => setze({ zeilen: w ? [e.zeilen[0] ?? w, w].slice(0, e.zeilen[0] ? 2 : 1) : e.zeilen.slice(0, 1) })}
        />
        <FeldWahlEingabe titel="Spalten" felder={felder} wahl={e.spalten[0]} optional onChange={(w) => setze({ spalten: w ? [w] : [] })} />
        <div className="min-w-0">
          <span className={labelClass}>Berechnung</span>
          <div className="flex min-w-0 gap-2">
            <select
              className={e.berechnung === 'anzahl' ? selectClass : `${basis} w-36 flex-none`}
              value={e.berechnung}
              aria-label="Berechnung"
              onChange={(ev) => {
                const b = ev.target.value as Berechnung
                setze({ berechnung: b, wert: b === 'anzahl' ? e.wert : e.wert ?? zahlFelder[0]?.id })
              }}
            >
              {BERECHNUNGEN.map((b) => (
                <option key={b.id} value={b.id} disabled={b.id !== 'anzahl' && zahlFelder.length === 0}>
                  {b.label}
                </option>
              ))}
            </select>
            {e.berechnung !== 'anzahl' && (
              <select className={selectClass} value={e.wert ?? ''} aria-label="Wert" onChange={(ev) => setze({ wert: ev.target.value })}>
                {zahlFelder.map((f) => (
                  <option key={f.id} value={f.id}>
                    von {f.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      <FilterLeiste felder={felder} daten={daten} filter={e.filter} onChange={(filter) => setze({ filter })} />

      {datumFeld && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="min-w-0">
            <span className={labelClass}>{datumFeld.label} von</span>
            <input type="date" className={`${basis} w-40`} value={e.von ?? ''} onChange={(ev) => setze({ von: ev.target.value || undefined })} />
          </label>
          <label className="min-w-0">
            <span className={labelClass}>bis</span>
            <input type="date" className={`${basis} w-40`} value={e.bis ?? ''} onChange={(ev) => setze({ bis: ev.target.value || undefined })} />
          </label>
          {(e.von || e.bis) && (
            <button type="button" className="pb-2 text-sm font-medium text-accent-600 hover:underline" onClick={() => setze({ von: undefined, bis: undefined })}>
              Zeitraum löschen
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Filter ───────────────────────────────────────────────────────────────────────────────────────

function FilterLeiste({ felder, daten, filter, onChange }: { felder: Feld[]; daten: Datensatz[]; filter: Filter[]; onChange: (f: Filter[]) => void }) {
  const [offen, setOffen] = useState<string | null>(null)
  const filterbar = felder.filter((f) => f.typ === 'text' || f.typ === 'jaNein')
  const frei = filterbar.filter((f) => !filter.some((x) => x.feld === f.id))
  const offenerFilter = filter.find((f) => f.feld === offen)
  const offenesFeld = felder.find((f) => f.id === offen)

  return (
    <div>
      <span className={labelClass}>Filter</span>
      <div className="flex flex-wrap items-center gap-2">
        {filter.map((f) => {
          const feld = felder.find((x) => x.id === f.feld)
          if (!feld) return null
          return (
            <span key={f.feld} className={`inline-flex max-w-full items-center rounded-full border text-sm ${offen === f.feld ? 'border-accent-300 bg-accent-50' : 'border-slate-200 bg-white'}`}>
              <button type="button" className="min-w-0 truncate py-1 pl-3 pr-1 text-left text-slate-700" onClick={() => setOffen(offen === f.feld ? null : f.feld)} title="Werte auswählen">
                <FilterIcon size={12} className="mr-1 inline text-slate-400" />
                {feld.label}: {f.ohne.length === 0 ? 'alle' : f.ohne.length <= 2 ? `ohne ${f.ohne.map((k) => beschriftung(k, feld, wirksameGruppierung(feld, f.gruppierung))).join(', ')}` : `ohne ${f.ohne.length} Werte`}
              </button>
              <button
                type="button"
                className="rounded-full p-1.5 text-slate-400 hover:text-rose-600"
                aria-label={`Filter ${feld.label} entfernen`}
                title="Filter entfernen"
                onClick={() => {
                  if (offen === f.feld) setOffen(null)
                  onChange(filter.filter((x) => x.feld !== f.feld))
                }}
              >
                <X size={13} />
              </button>
            </span>
          )
        })}
        {frei.length > 0 && (
          <select
            className={`${basis} w-auto max-w-full py-1.5`}
            value=""
            aria-label="Filter hinzufügen"
            onChange={(ev) => {
              const id = ev.target.value
              if (!id) return
              onChange([...filter, { feld: id, ohne: [] }])
              setOffen(id)
            }}
          >
            <option value="">+ Filter hinzufügen …</option>
            {frei.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {offenerFilter && offenesFeld && (
        <WerteAuswahl
          key={offenesFeld.id}
          feld={offenesFeld}
          daten={daten}
          filter={offenerFilter}
          onChange={(ohne) => onChange(filter.map((x) => (x.feld === offenerFilter.feld ? { ...x, ohne } : x)))}
          onClose={() => setOffen(null)}
        />
      )}
    </div>
  )
}

function WerteAuswahl({ feld, daten, filter, onChange, onClose }: { feld: Feld; daten: Datensatz[]; filter: Filter; onChange: (ohne: string[]) => void; onClose: () => void }) {
  const [suche, setSuche] = useState('')
  const werte = useMemo(() => werteListe(daten, feld, filter.gruppierung), [daten, feld, filter.gruppierung])
  const ohne = new Set(filter.ohne)
  const s = suche.trim().toLowerCase()
  const sichtbar = s ? werte.filter((w) => w.label.toLowerCase().includes(s)) : werte
  const umschalten = (k: string) => {
    const neu = new Set(ohne)
    if (neu.has(k)) neu.delete(k)
    else neu.add(k)
    onChange([...neu])
  }
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="basis-full text-sm font-medium text-slate-700 sm:basis-auto sm:flex-1">{feld.label}: Werte, die mitzählen</span>
        <button type="button" className="text-xs font-medium text-accent-600 hover:underline" onClick={() => onChange(filter.ohne.filter((k) => !sichtbar.some((w) => w.schluessel === k)))}>
          {s ? 'Gefundene an' : 'Alle'}
        </button>
        <button type="button" className="text-xs font-medium text-accent-600 hover:underline" onClick={() => onChange([...new Set([...filter.ohne, ...sichtbar.map((w) => w.schluessel)])])}>
          {s ? 'Gefundene aus' : 'Keine'}
        </button>
        <button type="button" className="ml-auto rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 sm:ml-0" onClick={onClose}>
          Fertig
        </button>
      </div>
      {werte.length > 12 && <input className={`${inputClass} mb-2`} placeholder="Wert suchen …" value={suche} onChange={(ev) => setSuche(ev.target.value)} aria-label="Wert suchen" />}
      <ul className="max-h-60 space-y-0.5 overflow-y-auto">
        {sichtbar.slice(0, 500).map((w) => (
          <li key={w.schluessel}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-white">
              <input type="checkbox" className="h-4 w-4 flex-none accent-accent-600" checked={!ohne.has(w.schluessel)} onChange={() => umschalten(w.schluessel)} />
              <span className="min-w-0 flex-1 truncate text-slate-700">{w.label}</span>
              <span className="flex-none text-xs tabular-nums text-slate-400">{w.anzahl.toLocaleString('de-DE')}</span>
            </label>
          </li>
        ))}
        {sichtbar.length > 500 && <li className="px-1.5 py-1 text-xs text-slate-400">… und {sichtbar.length - 500} weitere – bitte oben suchen.</li>}
        {sichtbar.length === 0 && <li className="px-1.5 py-1 text-xs text-slate-400">Nichts gefunden.</li>}
      </ul>
    </div>
  )
}
