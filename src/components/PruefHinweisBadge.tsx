import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Link2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { kundeBereichLabel, kundeDetailPfad } from '../data/kundenBereiche'
import { Modal, PrimaryButton, SecondaryButton } from './ui'
import { uid } from '../lib/dates'
import type { Kunde, KundeBereich } from '../types'

// Rotes "!" neben dem Kunden, sichtbar wenn kunde.pruefHinweis gesetzt ist (z.B. "Dokumente zeigen
// Restaurant-Finanzierung, könnte auch Betriebsübergabe sein") — Klick öffnet ein Pop-up mit der
// Begründung und löst den Hinweis über eine von drei Optionen auf:
// - Verschieben: Kunde wandert komplett in den vorgeschlagenen Bereich (MOVE_KUNDE_BEREICH).
// - In beiden Bereichen führen: legt eine verknüpfte Kopie im vorgeschlagenen Bereich an
//   (ADD_KUNDE_IN_BEREICH) — neue Dokumente, die künftig über DokumenteSection.tsx hinzukommen,
//   landen dank verknuepfteKunden automatisch in beiden Akten (siehe dort).
// - Hier lassen: Hinweis wird einfach gelöscht, nichts wandert.
export function PruefHinweisBadge({ bereich, kunde }: { bereich: KundeBereich; kunde: Kunde }) {
  const { dispatch } = useApp()
  const [offen, setOffen] = useState(false)
  const hinweis = kunde.pruefHinweis
  if (!hinweis) return null

  function schliessen() {
    setOffen(false)
  }

  function hierBehalten() {
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { pruefHinweis: undefined } })
    schliessen()
  }

  function verschieben() {
    if (!hinweis?.vorschlagBereich) return
    dispatch({
      type: 'MOVE_KUNDE_BEREICH',
      von: bereich,
      nach: hinweis.vorschlagBereich,
      id: kunde.id,
      patch: { pruefHinweis: undefined },
    })
    schliessen()
  }

  function inBeidenFuehren() {
    if (!hinweis?.vorschlagBereich) return
    const zielBereich = hinweis.vorschlagBereich
    const neueId = uid('k')
    const kopie: Kunde = {
      ...kunde,
      id: neueId,
      pruefHinweis: undefined,
      // Frischer Start im neuen Bereich statt doppelter Dokumenten-/Aktivitäten-Historie — nur die
      // Verknüpfung sorgt dafür, dass künftige neue Dokumente in beiden Akten landen.
      dokumente: [],
      activities: [],
      verknuepfteKunden: [...(kunde.verknuepfteKunden ?? []), { id: kunde.id, bereich }],
    }
    dispatch({ type: 'ADD_KUNDE_IN_BEREICH', bereich: zielBereich, kunde: kopie })
    dispatch({
      type: 'UPDATE_KUNDE_IN_BEREICH',
      bereich,
      id: kunde.id,
      patch: {
        pruefHinweis: undefined,
        verknuepfteKunden: [...(kunde.verknuepfteKunden ?? []), { id: neueId, bereich: zielBereich }],
      },
    })
    schliessen()
  }

  return (
    <>
      <button
        onClick={() => setOffen(true)}
        title="Zu prüfen — Bereichszuordnung unklar"
        className="inline-flex flex-shrink-0 items-center text-rose-600 hover:text-rose-700"
      >
        <AlertCircle size={18} />
      </button>

      <Modal open={offen} onClose={schliessen} title="Zu prüfen" width="max-w-md">
        <p className="mb-4 text-sm text-slate-600">{hinweis.text}</p>
        <div className="flex flex-col gap-2">
          {hinweis.vorschlagBereich && (
            <PrimaryButton onClick={verschieben}>Nach {kundeBereichLabel(hinweis.vorschlagBereich)} verschieben</PrimaryButton>
          )}
          {hinweis.vorschlagBereich && (
            <SecondaryButton onClick={inBeidenFuehren}>
              In beiden Bereichen führen ({kundeBereichLabel(bereich)} + {kundeBereichLabel(hinweis.vorschlagBereich)})
            </SecondaryButton>
          )}
          <SecondaryButton onClick={hierBehalten}>Hier bei {kundeBereichLabel(bereich)} lassen</SecondaryButton>
        </div>
      </Modal>
    </>
  )
}

// Kleine Zeile "Auch verknüpft bei: X" mit Link zur jeweils anderen Akte — bleibt auch nach Auflösen
// des PruefHinweis bestehen (verknuepfteKunden wird nicht beim Schließen gelöscht).
function VerknuepfteKundenZeile({ kunde }: { kunde: Kunde }) {
  const links = kunde.verknuepfteKunden
  if (!links || links.length === 0) return null
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
      <Link2 size={12} className="flex-shrink-0" />
      Auch geführt bei:{' '}
      {links.map((l, i) => (
        <span key={l.id}>
          {i > 0 && ', '}
          <Link to={kundeDetailPfad(l.bereich, l.id)} className="text-accent-600 hover:underline">
            {kundeBereichLabel(l.bereich)}
          </Link>
        </span>
      ))}
    </div>
  )
}

// Kombiniert "!"-Hinweis (neben dem Namen) und Verknüpfungs-Zeile (darunter) — ein einziger Einbau-
// punkt pro Kundenakte statt zwei.
export function KundeHinweise({ bereich, kunde }: { bereich: KundeBereich; kunde: Kunde }) {
  return (
    <>
      <PruefHinweisBadge bereich={bereich} kunde={kunde} />
      <VerknuepfteKundenZeile kunde={kunde} />
    </>
  )
}
