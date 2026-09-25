import { useState } from 'react'
import { ExternalLink, Link2, Check } from 'lucide-react'

export function shareableUrl(pfad: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#${pfad}`
}

export function FormularLinkButtons({ pfad }: { pfad: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="inline-flex items-center gap-2">
      <a
        href={`#${pfad}`}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100"
      >
        <ExternalLink size={13} /> Formular öffnen
      </a>
      <button
        onClick={async (e) => {
          e.stopPropagation()
          try {
            await navigator.clipboard.writeText(shareableUrl(pfad))
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            // Clipboard-Zugriff kann in manchen Kontexten fehlschlagen — kein Blocker für die Demo.
          }
        }}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        title="Link zu diesem Formular kopieren"
      >
        {copied ? <Check size={13} className="text-emerald-600" /> : <Link2 size={13} />}
        {copied ? 'Kopiert' : 'Link kopieren'}
      </button>
    </div>
  )
}
