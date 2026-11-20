import { useState } from 'react'
import { Check, FileText } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { useMsStatus } from '../lib/microsoftKonto'
import { erzeugeBrief, herunterladen, textZuAbsaetzen, useBriefboegen } from '../lib/briefe'
import { ladeKundenDokumentHoch } from '../lib/kundenDokumenteStorage'
import { today, uid } from '../lib/dates'
import { SecondaryButton, inputClass } from './ui'
import type { Dokument, Kunde, KundeBereich } from '../types'

/**
 * Knopf im Vorlagen-Fenster: die ausgefüllte Vorlage auf dem eigenen Word-Briefbogen (Word + PDF).
 * Erscheint nur für Freigeschaltete, die mindestens einen Briefbogen hinterlegt haben.
 */
export function AufBriefbogen({ titel, text, auswahl }: { titel: string; text: () => string; auswahl?: { bereich: KundeBereich; kunde: Kunde } }) {
  const { session, ansichtAls } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  const { briefboegen } = useBriefboegen(!!status?.erlaubt)
  const { state, dispatch } = useApp()
  const [id, setId] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [fertig, setFertig] = useState('')
  const [fehler, setFehler] = useState('')
  if (!status?.erlaubt || !briefboegen?.length) return null
  const bogen = briefboegen.find((b) => b.id === id) ?? briefboegen[0]

  async function los(inAkte: boolean) {
    setFehler('')
    setFertig('')
    setArbeitet(true)
    try {
      const k = auswahl?.kunde
      const empfaenger = k ? [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean) : []
      const e = await erzeugeBrief(bogen.id, { empfaenger, betreff: titel, anrede: '', absaetze: textZuAbsaetzen(text()) })
      if (inAkte && auswahl) {
        const neue: Dokument[] = []
        for (const [blob, endung] of [
          [e.pdf, 'pdf'],
          [e.docx, 'docx'],
        ] as const) {
          const name = `${e.name}.${endung}`
          const { pfad, groesse } = await ladeKundenDokumentHoch(auswahl.kunde.id, new File([blob], name, { type: blob.type }))
          neue.push({ id: uid('dok'), name, typ: blob.type, datum: today(), groesse, url: pfad })
        }
        const aktuell = KUNDEN_BEREICHE.find((b) => b.id === auswahl.bereich)!.get(state).find((x) => x.id === auswahl.kunde.id)
        dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: auswahl.bereich, id: auswahl.kunde.id, patch: { dokumente: [...(aktuell?.dokumente ?? []), ...neue] } })
        setFertig('Word und PDF liegen in der Akte.')
      } else {
        herunterladen(e.pdf, `${e.name}.pdf`)
        herunterladen(e.docx, `${e.name}.docx`)
        setFertig(e.mitHintergrund ? 'Heruntergeladen.' : 'Heruntergeladen (PDF ohne Briefkopf — kein PDF-Hintergrund hinterlegt).')
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
      <FileText size={14} className="text-slate-400" />
      {briefboegen.length > 1 ? (
        <select className={`${inputClass} w-auto py-1 text-xs`} value={bogen.id} onChange={(e) => setId(e.target.value)} title="Briefbogen">
          {briefboegen.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-slate-600">Briefbogen „{bogen.name}“</span>
      )}
      <SecondaryButton onClick={() => los(false)} disabled={arbeitet}>
        {arbeitet ? 'Wird erstellt …' : 'Herunterladen'}
      </SecondaryButton>
      {auswahl && (
        <SecondaryButton onClick={() => los(true)} disabled={arbeitet}>
          In die Akte
        </SecondaryButton>
      )}
      {fertig && (
        <span className="flex items-center gap-1 text-xs text-emerald-700">
          <Check size={13} /> {fertig}
        </span>
      )}
      {fehler && <span className="text-xs text-rose-600">{fehler}</span>}
    </div>
  )
}
