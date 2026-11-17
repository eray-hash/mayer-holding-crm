import { useState } from 'react'
import { ExternalLink, FileText, PenLine, Trash2 } from 'lucide-react'
import type { Vorlage } from '../types'
import { useApp } from '../context/AppContext'
import { erzeugeKundenDownloadUrl, loescheKundenDokument } from '../lib/kundenDokumenteStorage'
import { fmtDate } from '../lib/dates'
import { Card } from './ui'
import { VORLAGEN_KATEGORIEN } from '../data/constants'
import { FormularLinkButtons } from './FormularLink'
import { VorlageAusfuellenModal } from './VorlageAusfuellenModal'

const STANDARD_RUBRIKEN = ['vollmacht', 'schreiben', 'vertraege']

/** `rubriken`: welche Rubriken dieser Bereich in seiner Seitenleiste anbietet — nur dorthin lässt sich eine Datei-Vorlage umlegen. */
export function VorlagenListe({ kategorie, vorlagen, rubriken = STANDARD_RUBRIKEN }: { kategorie: string; vorlagen: Vorlage[]; rubriken?: string[] }) {
  const { dispatch } = useApp()
  const [offen, setOffen] = useState<Vorlage | null>(null)
  const [fehler, setFehler] = useState('')
  const label = VORLAGEN_KATEGORIEN.find((k) => k.id === kategorie)?.label ?? kategorie
  const gefiltert = vorlagen.filter((v) => v.kategorie === kategorie)
  // Viele Dateien (übernommene Ordner) nach Namen ordnen; die wenigen Text-Vorlagen behalten ihre gewohnte Reihenfolge.
  const list = gefiltert.some((v) => v.datei) ? [...gefiltert].sort((a, b) => a.name.localeCompare(b.name, 'de')) : gefiltert

  // Vorlagen, die als Datei vorliegen: kurz gültigen Link holen und in neuem Fenster öffnen.
  async function dateiOeffnen(v: Vorlage) {
    if (!v.datei) return
    setFehler('')
    const fenster = window.open('', '_blank') // sofort öffnen, sonst blockt der Browser es nach dem Warten
    try {
      const ziel = await erzeugeKundenDownloadUrl(v.datei.pfad)
      if (fenster) fenster.location.href = ziel
      else window.location.href = ziel
    } catch (err) {
      fenster?.close()
      setFehler(err instanceof Error ? err.message : 'Die Datei konnte nicht geöffnet werden.')
    }
  }

  async function dateiLoeschen(v: Vorlage) {
    if (!v.datei) return
    if (!window.confirm(`„${v.name}" endgültig aus den Vorlagen löschen? Die Datei wird dabei auch aus der Ablage entfernt.`)) return
    await loescheKundenDokument(v.datei.pfad).catch(() => undefined)
    dispatch({ type: 'DELETE_VORLAGE', id: v.id })
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Vorlagen – {label}</h1>
      <p className="mb-5 text-sm text-slate-500">{list.length} Vorlagen in dieser Kategorie</p>
      {fehler && <p className="mb-3 text-sm text-rose-600">{fehler}</p>}

      {list.length === 0 && (
        <Card className="p-6 text-sm text-slate-500">
          Für diese Kategorie liegt in diesem Bereich noch keine Vorlage vor. Die allgemeinen Vorlagen der Kanzlei (Vollmachten,
          Geheimhaltungsvereinbarung, Gesprächsprotokoll, Anschreiben) stehen unter Unternehmensberatung → Vorlagen.
        </Card>
      )}
      <Card className={list.length === 0 ? 'hidden' : 'overflow-hidden'}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Typ</th>
              <th className="px-4 py-3">Zuletzt geändert</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-700">
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="text-slate-400" />
                    {v.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {v.typ}
                  {v.datei && <span className="ml-1 text-xs text-slate-400">({v.datei.groesse})</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(v.zuletztGeaendert)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {v.datei ? (
                      <>
                        <select
                          value={v.kategorie}
                          onChange={(e) => dispatch({ type: 'SET_VORLAGE_KATEGORIE', id: v.id, kategorie: e.target.value as Vorlage['kategorie'] })}
                          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600"
                          title="In eine andere Rubrik legen"
                          aria-label="Rubrik"
                        >
                          {VORLAGEN_KATEGORIEN.filter((k) => rubriken.includes(k.id)).map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => dateiOeffnen(v)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          title="Datei öffnen"
                        >
                          <ExternalLink size={13} /> Öffnen
                        </button>
                        <button
                          onClick={() => dateiLoeschen(v)}
                          className="inline-flex items-center rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="Aus den Vorlagen löschen"
                          aria-label={`${v.name} löschen`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setOffen(v)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        title="Vorlage ansehen, mit den Daten eines Kunden ausfüllen und als PDF erzeugen"
                      >
                        <PenLine size={13} /> Ausfüllen
                      </button>
                    )}
                    {v.formularPfad && <FormularLinkButtons pfad={v.formularPfad} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {offen && <VorlageAusfuellenModal key={offen.id} vorlage={offen} onClose={() => setOffen(null)} />}
    </div>
  )
}
