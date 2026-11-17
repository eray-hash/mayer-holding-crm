import { useMemo, useState } from 'react'
import { Check, Copy, Printer } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { fmtDate, fmtEUR, today } from '../lib/dates'
import type { Objekt } from '../types'

type SpalteId = 'bezeichnung' | 'ort' | 'typ' | 'preis'
const SPALTEN: { id: SpalteId; label: string }[] = [
  { id: 'bezeichnung', label: 'Bezeichnung' },
  { id: 'ort', label: 'Ort' },
  { id: 'typ', label: 'Objektart' },
  { id: 'preis', label: 'Kaufpreis' },
]

function html(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Ausgewählte Objekte als kurze Liste zum Weitergeben an Makler, Investoren oder Kunden: nur die
 *  angehakten Angaben, nie Eigentümer, Unterlagen, Verlauf oder interne Zuständigkeiten. Die Bezeichnung
 *  lässt sich je Objekt für diese Liste umformulieren (interne Namen enthalten oft den Eigentümer). */
export function ObjektlisteWeitergeben({ open, onClose, objekte, absender }: { open: boolean; onClose: () => void; objekte: Objekt[]; absender: string }) {
  const [spalten, setSpalten] = useState<Set<SpalteId>>(new Set(['bezeichnung', 'ort', 'typ', 'preis']))
  const [namen, setNamen] = useState<Record<string, string>>({})
  const [kopiert, setKopiert] = useState(false)
  const nichtOeffentlich = objekte.some((o) => o.offMarket)

  const zeilen = useMemo(
    () =>
      objekte.map((o, i) => ({
        id: o.id,
        nr: i + 1,
        bezeichnung: namen[o.id] ?? o.bezeichnung,
        ort: o.adresse || '–',
        typ: o.typ,
        preis: o.kaufpreis > 0 ? fmtEUR(o.kaufpreis) : 'auf Anfrage',
      })),
    [objekte, namen],
  )
  const aktiv = SPALTEN.filter((s) => spalten.has(s.id))
  const hinweis = nichtOeffentlich ? 'Vertraulich – diese Objekte werden nicht öffentlich angeboten. Weitergabe nur nach Absprache.' : ''

  function alsText(): string {
    const kopf = `Objektliste – Andreas Mayer Holding, Stand ${fmtDate(today())}`
    const liste = zeilen.map((z) => `${z.nr}. ${aktiv.map((s) => z[s.id]).join(' · ')}`)
    return [kopf, hinweis, '', ...liste, '', `Bei Interesse melden Sie sich gern bei ${absender}.`].filter((x, i) => x !== '' || i > 1).join('\n')
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(alsText())
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2500)
    } catch {
      // Zwischenablage gesperrt — der Text lässt sich über „Drucken" trotzdem ausgeben.
    }
  }

  function drucken() {
    const fenster = window.open('', '_blank')
    if (!fenster) return
    const kopf = aktiv.map((s) => `<th>${html(s.label)}</th>`).join('')
    const rumpf = zeilen.map((z) => `<tr><td>${z.nr}</td>${aktiv.map((s) => `<td>${html(String(z[s.id]))}</td>`).join('')}</tr>`).join('')
    fenster.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Objektliste</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:32px}h1{font-size:18px;margin:0 0 4px}p{font-size:12px;color:#475569;margin:0 0 14px}
      table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #cbd5e1;padding:7px 8px;text-align:left;vertical-align:top}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}.hinweis{font-weight:bold;color:#1e293b}.fuss{margin-top:18px}
    </style></head><body><h1>Objektliste</h1><p>Andreas Mayer Holding · Stand ${html(fmtDate(today()))}</p>
    ${hinweis ? `<p class="hinweis">${html(hinweis)}</p>` : ''}
    <table><thead><tr><th>Nr.</th>${kopf}</tr></thead><tbody>${rumpf}</tbody></table>
    <p class="fuss">Bei Interesse melden Sie sich gern bei ${html(absender)}.</p></body></html>`)
    fenster.document.close()
    fenster.focus()
    fenster.print()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Objektliste zum Weitergeben (${objekte.length} ${objekte.length === 1 ? 'Objekt' : 'Objekte'})`} width="max-w-3xl">
      <p className="mb-3 text-sm text-slate-500">
        Weitergegeben werden nur die angehakten Angaben. Eigentümer, Unterlagen, Verlauf und interne Zuständigkeiten gehen nie mit.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {SPALTEN.map((s) => {
          const an = spalten.has(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                setSpalten((alt) => {
                  const neu = new Set(alt)
                  if (an) neu.delete(s.id)
                  else neu.add(s.id)
                  return neu.size === 0 ? alt : neu
                })
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              aria-pressed={an}
            >
              {s.label}
            </button>
          )
        })}
      </div>
      {spalten.has('bezeichnung') && (
        <p className="mb-2 text-xs text-amber-600">Die Bezeichnung enthält intern oft den Namen des Eigentümers — hier für diese Liste umformulieren oder die Spalte abwählen.</p>
      )}
      <div className="mb-4 max-h-80 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Nr.</th>
              {aktiv.map((s) => (
                <th key={s.id} className="px-3 py-2">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2 text-slate-400">{z.nr}</td>
                {aktiv.map((s) => (
                  <td key={s.id} className="px-3 py-2 text-slate-700">
                    {s.id === 'bezeichnung' ? (
                      <input
                        className={`${inputClass} py-1`}
                        value={z.bezeichnung}
                        onChange={(e) => setNamen((n) => ({ ...n, [z.id]: e.target.value }))}
                        aria-label={`Bezeichnung für Objekt ${z.nr}`}
                      />
                    ) : (
                      z[s.id]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hinweis && <p className="mb-3 text-xs font-medium text-slate-600">{hinweis}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={kopieren}>
          {kopiert ? <Check size={14} /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Als Text kopieren (E-Mail, WhatsApp)'}
        </SecondaryButton>
        <PrimaryButton onClick={drucken}>
          <Printer size={14} /> Drucken / als PDF speichern
        </PrimaryButton>
      </div>
    </Modal>
  )
}
