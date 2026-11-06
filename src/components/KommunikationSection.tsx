import { useEffect, useState } from 'react'
import { Loader2, Mail, MailCheck } from 'lucide-react'
import { fetchEmailsForKunde, isEmailInboxDbConfigured } from '../lib/emailInboxDb'
import { fetchSentEmailsForKunde, isSentEmailsDbConfigured } from '../lib/sentEmailsDb'
import { Card, EmptyState } from './ui'
import { fmtDate } from '../lib/dates'

type Eintrag =
  | { art: 'eingang'; datum: string; von: string; betreff: string; ausschnitt: string }
  | { art: 'ausgang'; datum: string; an: string; betreff: string; ausschnitt: string }

// Posteingang + Postausgang zu einem Kunden gebündelt, chronologisch sortiert — damit der komplette
// Mailverlauf mit einer Person direkt aus der Akte einsehbar ist, nicht nur über das allgemeine Postfach.
export function KommunikationSection({ kundeId }: { kundeId: string }) {
  const [eintraege, setEintraege] = useState<Eintrag[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEmailInboxDbConfigured && !isSentEmailsDbConfigured) {
      setError('E-Mail-Anbindung ist noch nicht konfiguriert.')
      return
    }
    Promise.all([
      isEmailInboxDbConfigured ? fetchEmailsForKunde(kundeId) : Promise.resolve([]),
      isSentEmailsDbConfigured ? fetchSentEmailsForKunde(kundeId) : Promise.resolve([]),
    ])
      .then(([eingang, ausgang]) => {
        const kombiniert: Eintrag[] = [
          ...eingang.map((m) => ({ art: 'eingang' as const, datum: m.datum, von: m.vonName, betreff: m.betreff, ausschnitt: m.ausschnitt })),
          ...ausgang.map((m) => ({ art: 'ausgang' as const, datum: m.gesendetAm, an: m.anName, betreff: m.betreff, ausschnitt: m.text.slice(0, 200) })),
        ].sort((a, b) => new Date(b.datum).getTime() - new Date(a.datum).getTime())
        setEintraege(kombiniert)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Kommunikationsverlauf konnte nicht geladen werden.'))
  }, [kundeId])

  if (error) return <EmptyState text={error} />
  if (!eintraege) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
        <Loader2 className="animate-spin" size={16} /> Lädt …
      </div>
    )
  }
  if (eintraege.length === 0) return <EmptyState text="Noch keine zugeordnete E-Mail-Kommunikation." />

  return (
    <Card className="divide-y divide-slate-100 overflow-hidden">
      {eintraege.map((e, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          {e.art === 'eingang' ? (
            <Mail size={16} className="mt-0.5 flex-shrink-0 text-accent-500" />
          ) : (
            <MailCheck size={16} className="mt-0.5 flex-shrink-0 text-emerald-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-700">{e.betreff}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">{fmtDate(e.datum)}</span>
            </div>
            <p className="truncate text-xs text-slate-500">
              {e.art === 'eingang' ? `Von ${e.von}` : `An ${e.an}`}
            </p>
            {e.ausschnitt && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{e.ausschnitt}</p>}
          </div>
        </div>
      ))}
    </Card>
  )
}
