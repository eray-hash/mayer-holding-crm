// #/aufnahme/:id — Warte-Bildschirm nach „Beenden“ und Übergabe an den Prüfbildschirm von Helfer „auswertung“.
// :id ist die Nummer beim Server oder „lokal-<lokalId>“, solange die Aufnahme noch nicht angelegt/hochgeladen ist.
// Ablauf: Hochladen (Gerät) → Abschrift → Auswertung (Server, gespraech_stand alle 4 s) → AuswertungSeite.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, CloudOff, LoaderCircle } from 'lucide-react'
import { AuswertungSeite } from '../auswertung/AuswertungSeite'
import { useLokaleAufnahmen, useOnline } from '../hooks'
import { gespraechStand } from '../server'
import { anstossen } from '../uploader'
import { sitzung, zuruecksetzen } from '../sitzung'
import { fortschritt } from '../warteschlange'
import type { GespraechAufnahme } from '../typen'

const FERTIG = new Set(['fertig', 'fehler', 'verworfen'])

export function AufnahmeRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const online = useOnline()
  const lokale = useLokaleAufnahmen()
  const istLokal = id.startsWith('lokal-')
  const lokal = istLokal ? lokale.find((a) => a.lokalId === id.slice(6)) : lokale.find((a) => a.serverId === id)
  const serverId = istLokal ? (lokal?.serverId ?? null) : id
  const hochgeladen = !lokal || lokal.abgeschlossen
  const [zeile, setZeile] = useState<GespraechAufnahme | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)

  // Nach „Beenden“: Sitzung für die nächste Aufnahme freigeben.
  useEffect(() => {
    if (sitzung().automat.phase === 'beendet') zuruecksetzen()
  }, [])

  // Ist die Aufnahme beim Server vollständig, auf dessen Nummer umschalten (Adresse bleibt dann gültig).
  useEffect(() => {
    if (istLokal && lokal?.serverId && lokal.abgeschlossen) navigate(`/aufnahme/${lokal.serverId}`, { replace: true })
  }, [istLokal, lokal?.serverId, lokal?.abgeschlossen, navigate])

  useEffect(() => {
    if (lokal && !lokal.abgeschlossen) anstossen()
  }, [lokal?.lokalId]) // eslint-disable-line react-hooks/exhaustive-deps

  const neuLaden = useCallback(() => {
    if (!serverId) return
    gespraechStand(serverId)
      .then((z) => {
        setZeile(z)
        setFehler(null)
      })
      .catch((err) => setFehler(err instanceof Error ? err.message : String(err)))
  }, [serverId])

  // Stand beim Server abfragen, solange hochgeladen und noch nicht fertig.
  useEffect(() => {
    if (!serverId || !hochgeladen) return
    if (zeile && zeile.id === serverId && FERTIG.has(zeile.status)) return
    let aktiv = true
    let wecker: number | null = null
    const frage = async () => {
      if (!aktiv) return
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        try {
          const z = await gespraechStand(serverId)
          if (!aktiv) return
          setZeile(z)
          setFehler(null)
          if (FERTIG.has(z.status)) return
        } catch (err) {
          if (aktiv) setFehler(err instanceof Error ? err.message : String(err))
        }
      }
      if (aktiv) wecker = window.setTimeout(frage, 4000)
    }
    void frage()
    return () => {
      aktiv = false
      if (wecker !== null) window.clearTimeout(wecker)
    }
  }, [serverId, hochgeladen, zeile?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (zeile && serverId && zeile.id === serverId && FERTIG.has(zeile.status)) {
    return <AuswertungSeite id={serverId} zeile={zeile} neuLaden={neuLaden} />
  }

  if (istLokal && !lokal) {
    return (
      <div className="py-10 text-center text-sm text-slate-600">
        Diese Aufnahme liegt nicht (mehr) auf diesem Gerät.{' '}
        <Link to="/aufnahmen" className="font-medium text-accent-600">
          Meine Aufnahmen
        </Link>
      </div>
    )
  }

  const f = lokal ? fortschritt(lokal) : null
  const segmente = zeile?.segmente ?? []
  const abgeschrieben = segmente.filter((x) => x.status === 'transkribiert').length
  const status = zeile?.status
  const schritte: { text: string; zusatz?: string; zustand: 'fertig' | 'laeuft' | 'offen' }[] = [
    { text: 'Auf dem Gerät gesichert', zustand: 'fertig' },
    {
      text: 'Hochladen',
      zusatz: f && !hochgeladen ? `${f.gemeldet} von ${f.gesamt} Abschnitten` : undefined,
      zustand: hochgeladen ? 'fertig' : 'laeuft',
    },
    {
      text: 'Abschrift',
      zusatz: status === 'transkription' || status === 'hochladen' || status === 'aufnahme' ? `${abgeschrieben} von ${segmente.length} Abschnitten` : undefined,
      zustand: status === 'analyse' ? 'fertig' : hochgeladen && zeile ? 'laeuft' : 'offen',
    },
    { text: 'Auswertung', zustand: status === 'analyse' ? 'laeuft' : 'offen' },
  ]

  return (
    <div className="flex flex-col gap-5 py-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{zeile?.titel || lokal?.titel || 'Aufnahme'}</h1>
        <p className="text-sm text-slate-500">Die Auswertung wird vorbereitet.</p>
      </div>
      <ol className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        {schritte.map((sch) => (
          <li key={sch.text} className="flex items-center gap-3">
            {sch.zustand === 'fertig' ? (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-4 w-4" />
              </span>
            ) : sch.zustand === 'laeuft' ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-accent-600" />
            ) : (
              <span className="h-6 w-6 rounded-full border-2 border-slate-200" />
            )}
            <span className={`text-sm ${sch.zustand === 'offen' ? 'text-slate-400' : 'text-slate-800'}`}>{sch.text}</span>
            {sch.zusatz && <span className="ml-auto text-xs text-slate-500">{sch.zusatz}</span>}
          </li>
        ))}
      </ol>
      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <CloudOff className="h-4 w-4 shrink-0" /> Kein Netz — es geht weiter, sobald wieder Verbindung besteht.
        </div>
      )}
      {lokal?.letzterFehler && online && <p className="text-xs text-slate-500">Letzter Versuch fehlgeschlagen ({lokal.letzterFehler}) — wird gleich erneut versucht.</p>}
      {fehler && hochgeladen && <p className="text-xs text-slate-500">Stand nicht abrufbar ({fehler}) — neuer Versuch in wenigen Sekunden.</p>}
      <p className="text-sm text-slate-600">
        {hochgeladen
          ? 'Alles ist hochgeladen. Sie können die App jetzt schließen — wenn die Auswertung fertig ist, kommt eine Nachricht per Telegram.'
          : 'Bitte die App geöffnet lassen, bis alles hochgeladen ist. Wird sie geschlossen, geht es beim nächsten Öffnen weiter.'}
      </p>
      <Link to="/" className="text-center text-sm font-medium text-accent-600">
        Zur Startseite
      </Link>
    </div>
  )
}
