// Liste automatischer Nachrichten (21.11.2026): auf der Seite „Automatische Nachrichten“ und in der
// Objektakte (Reiter Besichtigungen und Interessenten-Portal). Geplante lassen sich sofort senden oder
// abbrechen; jede Nachricht lässt sich aufklappen, um den genauen Text zu sehen.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Mail, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import {
  AUTO_STATUS_FARBE,
  AUTO_STATUS_LABEL,
  autoStatusText,
  brichAutoNachrichtAb,
  ladeAutoNachrichten,
  ladeAutoRegeln,
  sendeAutoNachrichtJetzt,
  type AutoNachricht,
  type AutoRegel,
} from '../lib/autoNachrichten'
import { Card, StatusBadge } from './ui'

export function AutoNachrichtZeile({
  n,
  regelTitel,
  objektName,
  objektId,
  nurLesen,
  onGeaendert,
}: {
  n: AutoNachricht
  regelTitel: string
  objektName?: string
  objektId?: string
  nurLesen: boolean
  onGeaendert: () => void
}) {
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const [offen, setOffen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [meldung, setMeldung] = useState('')

  async function aktion(f: () => Promise<string | void>) {
    setLaeuft(true)
    setMeldung('')
    try {
      const m = await f()
      if (m) setMeldung(m)
      onGeaendert()
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft(false)
    }
  }

  const kannHandeln = !nurLesen && (n.status === 'geplant' || n.status === 'ohne_adresse')
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={() => setOffen((x) => !x)} className="flex min-w-0 items-start gap-2 text-left">
          {offen ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-400" />}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-800">{regelTitel}</span>
              <StatusBadge label={AUTO_STATUS_LABEL[n.status]} color={AUTO_STATUS_FARBE[n.status]} />
            </span>
            <span className="block text-xs text-slate-500">
              {n.anName || n.an ? `an ${[n.anName, n.an && `<${n.an}>`].filter(Boolean).join(' ')} · ` : ''}
              {autoStatusText(n)}
            </span>
          </span>
        </button>
        {objektName && objektId && (
          <Link to={`/immobilien/objekte/${objektId}`} className="text-xs text-accent-600 hover:underline">
            {objektName}
          </Link>
        )}
      </div>
      {kannHandeln && (
        <div className="mt-1.5 flex flex-wrap gap-3 pl-6 text-xs font-medium text-slate-600">
          {n.status === 'geplant' && (
            <button
              disabled={laeuft}
              onClick={() =>
                aktion(async () => {
                  if (!window.confirm(`Diese Nachricht jetzt an ${n.an ?? 'den Interessenten'} senden?`)) return
                  const r = await sendeAutoNachrichtJetzt(n.id)
                  return r.gesendet > 0 ? 'Gesendet.' : r.meldungen[0] ?? 'Nicht gesendet.'
                })
              }
              className="hover:underline disabled:opacity-50"
            >
              {laeuft ? 'Sendet …' : 'Jetzt senden'}
            </button>
          )}
          <button disabled={laeuft} onClick={() => aktion(() => brichAutoNachrichtAb(n.id, wer))} className="hover:underline disabled:opacity-50">
            Nicht senden
          </button>
        </div>
      )}
      {meldung && <p className="mt-1 pl-6 text-xs text-slate-600">{meldung}</p>}
      {offen && (
        <div className="mt-2 ml-6 rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Betreff: {n.betreff || '–'}</p>
          <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{n.text || 'Kein Text.'}</pre>
          {n.status === 'geplant' && <p className="mt-2 text-[11px] text-slate-400">Vorschau. Kurz vor dem Senden wird der Text mit dem dann aktuellen Stand (Termin, Vorlage) neu zusammengesetzt.</p>}
        </div>
      )}
    </li>
  )
}

/** Kleiner Abschnitt in der Objektakte: automatische Nachrichten zu diesem Objekt. Ohne Nachrichten: nichts. */
export function ObjektAutoNachrichten({ objektId, art }: { objektId: string; art: 'besichtigung' | 'portal' }) {
  const { ansichtAls } = useAuth()
  const [liste, setListe] = useState<AutoNachricht[]>([])
  const [regeln, setRegeln] = useState<AutoRegel[]>([])

  const laden = useCallback(() => {
    ladeAutoNachrichten({ objektId, grenze: 100 })
      .then((l) => setListe(l.filter((n) => (art === 'portal' ? !!n.freigabeId : !!n.besichtigungId))))
      .catch(() => setListe([]))
  }, [objektId, art])

  useEffect(() => {
    laden()
    ladeAutoRegeln().then(setRegeln).catch(() => setRegeln([]))
    // Besichtigungen werden in diesem Reiter gespeichert; die Datenbank merkt dabei Nachrichten vor.
    const t = window.setInterval(laden, 20000)
    return () => window.clearInterval(t)
  }, [laden])

  const anzahlAn = regeln.filter((r) => r.aktiv && (art === 'portal' ? r.id.startsWith('immo_portal') : r.id.startsWith('immo_besichtigung'))).length
  if (liste.length === 0 && anzahlAn === 0) return null
  const titel = new Map(regeln.map((r) => [r.id, r.titel]))
  return (
    <Card className="mt-4 p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <Mail size={13} /> Automatische Nachrichten
        </span>
        <span className="flex items-center gap-3 text-xs">
          <button onClick={laden} className="flex items-center gap-1 text-slate-500 hover:text-slate-700" title="Neu laden">
            <RefreshCw size={12} /> Aktualisieren
          </button>
          <Link to="/immobilien/automatische-nachrichten" className="text-accent-600 hover:underline">
            Einstellungen
          </Link>
        </span>
      </div>
      {liste.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-500">Für dieses Objekt ist noch keine automatische Nachricht vorgemerkt.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {liste.map((n) => (
            <AutoNachrichtZeile key={n.id} n={n} regelTitel={titel.get(n.regel) ?? n.regel} nurLesen={!!ansichtAls} onGeaendert={laden} />
          ))}
        </ul>
      )}
    </Card>
  )
}
