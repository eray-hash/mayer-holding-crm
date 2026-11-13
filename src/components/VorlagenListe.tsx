import { useState } from 'react'
import { FileText, PenLine } from 'lucide-react'
import type { Vorlage } from '../types'
import { fmtDate } from '../lib/dates'
import { Card } from './ui'
import { VORLAGEN_KATEGORIEN } from '../data/constants'
import { FormularLinkButtons } from './FormularLink'
import { VorlageAusfuellenModal } from './VorlageAusfuellenModal'

export function VorlagenListe({ kategorie, vorlagen }: { kategorie: string; vorlagen: Vorlage[] }) {
  const [offen, setOffen] = useState<Vorlage | null>(null)
  const label = VORLAGEN_KATEGORIEN.find((k) => k.id === kategorie)?.label ?? kategorie
  const list = vorlagen.filter((v) => v.kategorie === kategorie)

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Vorlagen – {label}</h1>
      <p className="mb-5 text-sm text-slate-500">{list.length} Vorlagen in dieser Kategorie</p>

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
                <td className="px-4 py-3 text-slate-500">{v.typ}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(v.zuletztGeaendert)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setOffen(v)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      title="Vorlage ansehen, mit den Daten eines Kunden ausfüllen und als PDF erzeugen"
                    >
                      <PenLine size={13} /> Ausfüllen
                    </button>
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
