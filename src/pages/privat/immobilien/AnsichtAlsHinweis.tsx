import type { ReactNode } from 'react'
import { useAuth } from '../../../context/AuthContext'

/** „Ansehen als …“: Private Objekte und Kontakte gehören dem angemeldeten Menschen; die einer anderen Person
 *  lädt die Datenbank dem Superuser nicht (und soll es auch nicht). Statt fremder Leere ein klarer Hinweis. */
export function NurEigeneAnsicht({ children }: { children: ReactNode }) {
  const { ansichtAls } = useAuth()
  if (ansichtAls) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Private Immobilien werden in dieser Ansicht nicht gezeigt. {ansichtAls.name} sieht hier nur die eigenen Objekte, Kunden und Gesuche.
      </div>
    )
  }
  return <>{children}</>
}
