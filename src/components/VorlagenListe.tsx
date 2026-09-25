import { useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import type { Vorlage } from '../types'
import { fmtDate } from '../lib/dates'
import { Modal, Card } from './ui'
import { VORLAGEN_KATEGORIEN } from '../data/constants'
import { FormularLinkButtons } from './FormularLink'

export function VorlagenListe({ kategorie, vorlagen }: { kategorie: string; vorlagen: Vorlage[] }) {
  const [preview, setPreview] = useState<Vorlage | null>(null)
  const label = VORLAGEN_KATEGORIEN.find((k) => k.id === kategorie)?.label ?? kategorie
  const list = vorlagen.filter((v) => v.kategorie === kategorie)

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Vorlagen – {label}</h1>
      <p className="mb-5 text-sm text-slate-500">{list.length} Vorlagen in dieser Kategorie</p>

      <Card className="overflow-hidden">
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
                      onClick={() => setPreview(v)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Eye size={13} /> Vorschau
                    </button>
                    {v.formularPfad && <FormularLinkButtons pfad={v.formularPfad} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name ?? ''}>
        {preview && (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex gap-4 text-xs text-slate-400">
              <span>Typ: {preview.typ}</span>
              <span>Zuletzt geändert: {fmtDate(preview.zuletztGeaendert)}</span>
            </div>
            <div className="whitespace-pre-line rounded-lg border border-slate-100 bg-slate-50 p-4 leading-relaxed">{preview.text}</div>
          </div>
        )}
      </Modal>
    </div>
  )
}
