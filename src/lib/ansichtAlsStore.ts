// Zustand von „Ansehen als …“ (nur Superuser): wessen Sicht gerade gezeigt wird. Bewusst nur im
// Speicher dieses Fensters — nie in der Datenbank, nicht einmal im Browser-Speicher. Neu laden beendet
// die Ansicht. Solange sie läuft, ist der Nur-Lesen-Schutz (nurLesen.ts) an.
import { useSyncExternalStore } from 'react'
import { setzeNurLesen } from './nurLesen'

/** Die Felder der Mitarbeiter-Zeile, die für die Sicht nötig sind (wie Mitarbeiter in AuthContext). */
export type AnsichtPerson = {
  id: string
  name: string
  email: string
  rolle: 'geschaeftsfuehrung' | 'mitarbeiter'
  bereiche: string[]
  aktiv: boolean
  ist_admin: boolean
  telefon: string | null
  signatur_html: string | null
  foto_data_url: string | null
  buchungslink: string | null
  ist_superuser?: boolean
}

let person: AnsichtPerson | null = null
const hoerer = new Set<() => void>()

function melde() {
  for (const f of hoerer) f()
}

export function starteAnsicht(p: AnsichtPerson): void {
  // Erst sperren, dann umschalten — kein Augenblick, in dem die fremde Sicht ohne Schutz läuft.
  setzeNurLesen(true)
  person = p
  melde()
}

export function beendeAnsicht(): void {
  person = null
  melde()
  setzeNurLesen(false)
}

export function ansichtPerson(): AnsichtPerson | null {
  return person
}

export function useAnsichtPerson(): AnsichtPerson | null {
  return useSyncExternalStore(
    (f) => {
      hoerer.add(f)
      return () => hoerer.delete(f)
    },
    () => person,
    () => null,
  )
}
