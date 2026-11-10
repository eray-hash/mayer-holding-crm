import { useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card, EmptyState } from './ui'
import { erzeugeKundenDownloadUrl, ladeKundenDokumentHoch } from '../lib/kundenDokumenteStorage'
import { uid, today } from '../lib/dates'
import type { Dokument, KundeBereich } from '../types'

// Dokumente, die der Kunden-/Mandantenakte zugeordnet wurden — teils automatisch aus zugeordneten
// E-Mail-Anhängen (siehe ASSIGN_EINGEGANGENE_EMAIL in AppContext.tsx, dort liegt d.url als direkte
// https-URL im öffentlichen "email-anhaenge"-Bucket), teils echte Uploads im privaten
// "kunden-dokumente"-Bucket (siehe kundenDokumenteStorage.ts), dort liegt d.url als Storage-Pfad
// und muss erst zu einer zeitlich begrenzten Signed URL aufgelöst werden. Bewusst eine flache
// Liste ohne Ordner-Kategorisierung wie bei Immobilien-Objekten, da hier nicht nötig.
export function DokumenteSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const dokumente = kunde?.dokumente ?? []
  const [fehler, setFehler] = useState('')
  const [hochladen, setHochladen] = useState(false)

  async function dokumentOeffnen(d: Dokument) {
    if (!d.url) return
    setFehler('')
    try {
      const ziel = d.url.startsWith('http') ? d.url : await erzeugeKundenDownloadUrl(d.url)
      window.open(ziel, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Datei konnte nicht geöffnet werden.')
    }
  }

  async function dateiHochladen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFehler('')
    setHochladen(true)
    try {
      const { pfad, groesse } = await ladeKundenDokumentHoch(kundeId, file)
      const neuesDokument: Dokument = { id: uid('dok'), name: file.name, typ: file.type || 'Datei', datum: today(), groesse, url: pfad }
      dispatch({ type: 'UPDATE_KUNDE', id: kundeId, patch: { dokumente: [...dokumente, neuesDokument] } })
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Hochladen fehlgeschlagen.')
    } finally {
      setHochladen(false)
    }
  }

  return (
    <div>
      {fehler && <p className="mb-2 text-sm text-rose-600">{fehler}</p>}

      <label className="mb-3 flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <Upload size={14} /> {hochladen ? 'Wird hochgeladen …' : 'Datei hochladen'}
        <input type="file" className="hidden" onChange={dateiHochladen} disabled={hochladen} />
      </label>

      {dokumente.length === 0 ? (
        <EmptyState text="Noch keine Dokumente — z. B. automatisch aus zugeordneten E-Mail-Anhängen, oder oben manuell hochladen." />
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {dokumente.map((d) => (
            <button
              key={d.id}
              onClick={() => dokumentOeffnen(d)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-slate-50"
            >
              <FileText size={16} className="flex-shrink-0 text-slate-400" />
              <span className="flex-1 truncate font-medium text-slate-700">{d.name}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">{d.groesse}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">{d.datum}</span>
            </button>
          ))}
        </Card>
      )}
    </div>
  )
}
