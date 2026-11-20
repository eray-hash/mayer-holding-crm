// Positionen eines Kostenvoranschlags aus der Preisliste (oder frei) zusammenstellen, mit Auf- oder
// Abschlag in Prozent und Umsatzsteuer (Wunsch von Eray, 20.11.2026). Die Preisliste ist dieselbe wie
// für Rechnungen (leistungen_preisliste, netto). Der Auf-/Abschlag wird in die Einzelpreise
// eingerechnet: Der Kunde sieht auf dem Kostenvoranschlag nur die angepassten Preise.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { holeLeistungen, type Leistung } from '../lib/leistungen'
import { berechneKv, KV_EINHEITEN, preisMitAufschlag, type KvPosition } from '../lib/kostenvoranschlaege'
import { inputClass } from './ui'

export const euroText = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

/** Zahl aus deutscher Eingabe ("1.250,50", "12,5", "-5"); NaN, wenn keine Zahl. */
export function zahlAusText(text: string): number {
  const t = text.trim().replace(/€|%/g, '').replace(/\s/g, '')
  if (!t) return NaN
  let norm = t
  if (t.includes(',')) norm = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) norm = t.replace(/\./g, '')
  return Number(norm)
}

const zahlText = (n: number) => (Number.isFinite(n) ? n.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : '')

function spanne(von: number | null, bis: number | null): string {
  if (von == null && bis == null) return ''
  if (von != null && bis != null && Number(von) !== Number(bis)) return `${euroText(Number(von))} – ${euroText(Number(bis))}`
  return euroText(Number(von ?? bis))
}

const neueId = () => `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

const SCHNELL = [-10, -5, 5, 10]

export type KvPositionenWert = { positionen: KvPosition[]; aufschlagProzent: number; ustSatz: number }

export function KvPositionenEditor({ wert, onChange, nurLesen }: { wert: KvPositionenWert; onChange: (w: KvPositionenWert) => void; nurLesen?: boolean }) {
  const [leistungen, setLeistungen] = useState<Leistung[]>([])
  const [ladeFehler, setLadeFehler] = useState('')
  const [auswahl, setAuswahl] = useState('')
  // Eingabefelder als Text, damit "12," beim Tippen nicht sofort verschwindet.
  const [texte, setTexte] = useState<Record<string, { menge: string; preis: string }>>({})
  const [aufschlagText, setAufschlagText] = useState(zahlText(wert.aufschlagProzent))

  useEffect(() => {
    holeLeistungen()
      .then(setLeistungen)
      .catch((e) => setLadeFehler(e instanceof Error ? e.message : 'Preisliste konnte nicht geladen werden.'))
  }, [])

  const rechnung = useMemo(() => berechneKv(wert.positionen, wert.aufschlagProzent, wert.ustSatz), [wert])

  const setze = (teil: Partial<KvPositionenWert>) => onChange({ ...wert, ...teil })
  const aendere = (id: string, teil: Partial<KvPosition>) => setze({ positionen: wert.positionen.map((p) => (p.id === id ? { ...p, ...teil } : p)) })

  function ausPreisliste(id: string) {
    setAuswahl('')
    const l = leistungen.find((x) => x.id === id)
    if (!l) return
    const stunde = l.preis_stunde_von != null
    const preis = Number(stunde ? l.preis_stunde_von : (l.preis_tag_von ?? 0))
    setze({ positionen: [...wert.positionen, { id: neueId(), bezeichnung: l.bezeichnung, menge: 1, einheit: stunde ? 'Stunde' : 'Tag', einzelpreis: preis, leistungId: l.id }] })
  }

  function frei() {
    setze({ positionen: [...wert.positionen, { id: neueId(), bezeichnung: '', menge: 1, einheit: 'Pauschal', einzelpreis: 0 }] })
  }

  function einheitWechseln(p: KvPosition, einheit: string) {
    const l = p.leistungId ? leistungen.find((x) => x.id === p.leistungId) : undefined
    const neuerPreis = l ? (einheit === 'Stunde' ? l.preis_stunde_von : einheit === 'Tag' ? l.preis_tag_von : null) : null
    aendere(p.id, { einheit, ...(neuerPreis != null ? { einzelpreis: Number(neuerPreis) } : {}) })
    if (neuerPreis != null) setTexte((t) => ({ ...t, [p.id]: { menge: t[p.id]?.menge ?? zahlText(p.menge), preis: zahlText(Number(neuerPreis)) } }))
  }

  function aufschlagSetzen(text: string) {
    setAufschlagText(text)
    const n = text.trim() === '' ? 0 : zahlAusText(text)
    if (Number.isFinite(n) && n > -100 && n < 1000) setze({ aufschlagProzent: n })
  }

  const text = (p: KvPosition) => texte[p.id] ?? { menge: zahlText(p.menge), preis: zahlText(p.einzelpreis) }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">Positionen</span>
        <span className="text-xs text-slate-400">Preise netto laut Preisliste</span>
      </div>

      {wert.positionen.length === 0 && <p className="mb-2 text-sm text-slate-400">Noch keine Position. Wähle eine Leistung aus der Preisliste oder lege eine freie Position an.</p>}

      <div className="space-y-2">
        {wert.positionen.map((p, i) => {
          const l = p.leistungId ? leistungen.find((x) => x.id === p.leistungId) : undefined
          const angepasst = preisMitAufschlag(p.einzelpreis, wert.aufschlagProzent)
          return (
            <div key={p.id} className="rounded-lg bg-slate-50 p-2">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-5 shrink-0 text-xs text-slate-400">{i + 1}.</span>
                <input
                  className={`${inputClass} flex-1`}
                  value={p.bezeichnung}
                  disabled={nurLesen}
                  onChange={(e) => aendere(p.id, { bezeichnung: e.target.value })}
                  placeholder="Bezeichnung der Leistung"
                />
                {!nurLesen && (
                  <button type="button" onClick={() => setze({ positionen: wert.positionen.filter((x) => x.id !== p.id) })} className="mt-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Position entfernen" aria-label="Position entfernen">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 pl-7 sm:grid-cols-[5rem_7rem_8rem_1fr]">
                <label className="text-xs text-slate-500">
                  Menge
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    disabled={nurLesen}
                    value={text(p).menge}
                    onChange={(e) => {
                      const t = e.target.value
                      setTexte((x) => ({ ...x, [p.id]: { ...text(p), menge: t } }))
                      const n = zahlAusText(t)
                      if (Number.isFinite(n) && n >= 0) aendere(p.id, { menge: n })
                    }}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Einheit
                  <select className={inputClass} disabled={nurLesen} value={p.einheit} onChange={(e) => einheitWechseln(p, e.target.value)}>
                    {KV_EINHEITEN.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Einzelpreis netto
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    disabled={nurLesen}
                    value={text(p).preis}
                    onChange={(e) => {
                      const t = e.target.value
                      setTexte((x) => ({ ...x, [p.id]: { ...text(p), preis: t } }))
                      const n = zahlAusText(t)
                      if (Number.isFinite(n) && n >= 0) aendere(p.id, { einzelpreis: n })
                    }}
                  />
                </label>
                <div className="col-span-3 self-end text-xs text-slate-500 sm:col-span-1 sm:text-right">
                  {l && (
                    <div>
                      Preisliste: {p.einheit === 'Stunde' ? spanne(l.preis_stunde_von, l.preis_stunde_bis) || '–' : p.einheit === 'Tag' ? spanne(l.preis_tag_von, l.preis_tag_bis) || '–' : '–'}
                    </div>
                  )}
                  <div className="font-medium text-slate-700">
                    {wert.aufschlagProzent ? `${euroText(angepasst)} je ${p.einheit} · ` : ''}
                    {euroText(p.menge * angepasst)}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {!nurLesen && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select className={`${inputClass} flex-1`} value={auswahl} onChange={(e) => ausPreisliste(e.target.value)}>
            <option value="">+ Leistung aus der Preisliste wählen …</option>
            {leistungen.map((l) => (
              <option key={l.id} value={l.id}>
                {l.bezeichnung}
                {l.preis_stunde_von != null ? ` · ${spanne(l.preis_stunde_von, l.preis_stunde_bis)} je Stunde` : l.preis_tag_von != null ? ` · ${spanne(l.preis_tag_von, l.preis_tag_bis)} je Tag` : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={frei} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <Plus size={15} /> Freie Position
          </button>
        </div>
      )}
      {ladeFehler && <p className="mt-2 text-xs text-rose-600">Preisliste: {ladeFehler}</p>}

      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Aufschlag (+) oder Nachlass (–) in Prozent</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input className={`${inputClass} w-24`} inputMode="decimal" disabled={nurLesen} value={aufschlagText} onChange={(e) => aufschlagSetzen(e.target.value)} placeholder="0" />
            <span className="text-sm text-slate-500">%</span>
            {!nurLesen &&
              SCHNELL.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => aufschlagSetzen(zahlText((wert.aufschlagProzent || 0) + s))}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  title={`${s > 0 ? 'Weitere' : ''} ${Math.abs(s)} % ${s > 0 ? 'aufschlagen' : 'nachlassen'}`}
                >
                  {s > 0 ? `+${s}` : s} %
                </button>
              ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">Wird in die Einzelpreise eingerechnet; der Kunde sieht nur die angepassten Preise.</p>
          <span className="mb-1 mt-3 block text-xs font-medium text-slate-500">Umsatzsteuer</span>
          <select className={`${inputClass} w-40`} disabled={nurLesen} value={wert.ustSatz} onChange={(e) => setze({ ustSatz: Number(e.target.value) })}>
            <option value={19}>19 %</option>
            <option value={7}>7 %</option>
            <option value={0}>keine</option>
          </select>
        </div>
        <dl className="space-y-1 self-end text-sm">
          <div className="flex justify-between text-slate-500">
            <dt>Summe laut Preisliste</dt>
            <dd>{euroText(rechnung.grundsumme)}</dd>
          </div>
          {rechnung.aufschlag !== 0 && (
            <div className="flex justify-between text-slate-500">
              <dt>{rechnung.aufschlag > 0 ? 'Aufschlag' : 'Nachlass'} ({zahlText(wert.aufschlagProzent)} %)</dt>
              <dd>
                {rechnung.aufschlag > 0 ? '+' : ''}
                {euroText(rechnung.aufschlag)}
              </dd>
            </div>
          )}
          <div className="flex justify-between text-slate-700">
            <dt>Netto</dt>
            <dd>{euroText(rechnung.netto)}</dd>
          </div>
          <div className="flex justify-between text-slate-500">
            <dt>Umsatzsteuer {wert.ustSatz} %</dt>
            <dd>{euroText(rechnung.ust)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
            <dt>Gesamtbetrag</dt>
            <dd>{euroText(rechnung.brutto)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
