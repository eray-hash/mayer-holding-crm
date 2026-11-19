import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Objekt } from '../types'

// Link zur öffentlichen Eigentümer-Seite eines Objekts. Seit 19.11.2026 mit geheimem Zeichen
// (Spalte objekte.eigentuemer_token, vergibt die Datenbank): Vorher reichte die Objekt-Kennung, die
// sich erraten lässt (o_ql_…), und jeder konnte Eigentümerdaten lesen, überschreiben und Dateien
// hochladen.

export function eigentuemerPfad(objektId: string, token: string): string {
  return `/formular/eigentuemer/${encodeURIComponent(objektId)}/${encodeURIComponent(token)}`
}

/** Pfad (ohne #) zur Eigentümer-Seite oder null, solange das Zeichen noch nicht bekannt ist. Wurde
 *  das Objekt eben erst in diesem Fenster angelegt, steht das Zeichen noch nicht im Stand — dann wird es
 *  einmal aus der Datenbank nachgelesen. */
export function useEigentuemerPfad(objekt: Pick<Objekt, 'id' | 'eigentuemerToken'>): string | null {
  const [nachgelesen, setNachgelesen] = useState<{ id: string; token: string } | null>(null)
  const bekannt = objekt.eigentuemerToken || (nachgelesen?.id === objekt.id ? nachgelesen.token : '')

  useEffect(() => {
    if (objekt.eigentuemerToken || !supabase) return
    let aktiv = true
    const lies = async () => {
      // Kurz warten: Ein eben angelegtes Objekt wird im Hintergrund gespeichert.
      for (const warte of [0, 1500, 4000]) {
        if (warte) await new Promise((r) => setTimeout(r, warte))
        const { data } = await supabase!.from('objekte').select('eigentuemer_token').eq('id', objekt.id).maybeSingle()
        const token = (data as { eigentuemer_token?: string } | null)?.eigentuemer_token
        if (token) {
          if (aktiv) setNachgelesen({ id: objekt.id, token })
          return
        }
      }
    }
    lies().catch(() => {})
    return () => {
      aktiv = false
    }
  }, [objekt.id, objekt.eigentuemerToken])

  return bekannt ? eigentuemerPfad(objekt.id, bekannt) : null
}
