import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { brauchtDateiLink, holeAnhangUrl } from '../lib/emailGateway'
import type { EmailAnhang } from '../types'

function fmtGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Anhang einer Mail. Die Dateien liegen nicht offen im Netz — beim Klick wird ein kurz gültiger Link
 *  geholt (nur für angemeldete Mitarbeiter). */
export function MailAnhangLink({ anhang }: { anhang: EmailAnhang }) {
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const klasse = 'flex items-center gap-1.5 text-left text-sm text-accent-600 hover:underline'
  const inhalt = (
    <>
      <Paperclip size={13} /> {anhang.filename} <span className="text-xs text-slate-400">({fmtGroesse(anhang.size)})</span>
    </>
  )

  if (!brauchtDateiLink(anhang.url)) {
    return (
      <a href={anhang.url} target="_blank" rel="noreferrer" className={klasse}>
        {inhalt}
      </a>
    )
  }

  async function oeffnen() {
    setLaeuft(true)
    setFehler('')
    // Fenster sofort öffnen (sonst blockt der Browser es nach dem Warten), Adresse danach setzen.
    const fenster = window.open('', '_blank')
    try {
      const url = await holeAnhangUrl(anhang.url)
      if (fenster) fenster.location.href = url
      else window.location.href = url
    } catch (err) {
      fenster?.close()
      setFehler(err instanceof Error ? err.message : 'Anhang konnte nicht geöffnet werden.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div>
      <button type="button" onClick={oeffnen} disabled={laeuft} className={klasse}>
        {inhalt}
        {laeuft && <span className="text-xs text-slate-400">wird geöffnet …</span>}
      </button>
      {fehler && <p className="text-xs text-rose-600">{fehler}</p>}
    </div>
  )
}
