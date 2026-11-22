// Laufende Aufnahme: Einwilligung → Aufnahme (Uhr, Pegel, Pause, Beenden), Markierungen, Notizen, Fotos,
// optional Mitlesen. Nach „Beenden“ geht es zum Warte-Bildschirm #/aufnahme/lokal-<id>.
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Camera, CircleHelp, CloudOff, LoaderCircle, Pause, Play, Square, SquareCheck, Star, TriangleAlert, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { zeitText } from '../automat'
import { Einwilligung } from '../komponenten/Einwilligung'
import { Pegelanzeige } from '../komponenten/Pegelanzeige'
import { useEinstellungen } from '../einstellungen'
import { useLokaleAufnahmen, useOnline, useTakt } from '../hooks'
import { istIPhone } from '../rekorder'
import * as s from '../sitzung'
import { fortschritt } from '../warteschlange'
import type { GespraechMarkerArt } from '../typen'

const MARKER: { art: GespraechMarkerArt; text: string; Icon: typeof Star; farbe: string }[] = [
  { art: 'wichtig', text: 'Wichtig', Icon: Star, farbe: 'text-amber-600' },
  { art: 'aufgabe', text: 'Aufgabe', Icon: SquareCheck, farbe: 'text-emerald-600' },
  { art: 'frage', text: 'Frage', Icon: CircleHelp, farbe: 'text-sky-600' },
]

export function Aufnehmen() {
  const stand = s.useSitzung()
  const { mitarbeiter } = useAuth()
  const e = useEinstellungen()
  const navigate = useNavigate()
  const phase = stand.automat.phase
  const v = stand.vorbereitung

  if (phase === 'bereit' || !v) return <Navigate to="/" replace />

  if (phase === 'einwilligung') {
    return (
      <Einwilligung
        art={v.art}
        wer={mitarbeiter?.name || mitarbeiter?.email || ''}
        aufbewahrungTage={e.aufbewahrungTage}
        onAbbrechen={() => {
          s.abbrechen()
          navigate('/', { replace: true })
        }}
        onBestaetigt={(einw) => void s.starten(einw, mitarbeiter?.email ?? '')}
      />
    )
  }

  if (phase === 'startet') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-600">
        <LoaderCircle className="h-8 w-8 animate-spin" />
        <div className="text-sm">Mikrofon wird gestartet …</div>
      </div>
    )
  }

  if (phase === 'beendet') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-600">
        <LoaderCircle className="h-8 w-8 animate-spin" />
        <div className="text-sm">Aufnahme wird gesichert …</div>
      </div>
    )
  }

  if (phase === 'fehler') {
    return (
      <div className="flex flex-col gap-4 py-8">
        <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{stand.automat.grund ?? 'Die Aufnahme ließ sich nicht starten.'}</div>
        <button
          onClick={() => {
            s.abbrechen()
            navigate('/', { replace: true })
          }}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
        >
          Zurück
        </button>
      </div>
    )
  }

  return <Laufend />
}

function Laufend() {
  const stand = s.useSitzung()
  const e = useEinstellungen()
  const navigate = useNavigate()
  const online = useOnline()
  const lokale = useLokaleAufnahmen()
  useTakt(500)
  const [beendet, setBeendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [bearbeite, setBearbeite] = useState<number | null>(null)
  const fotoEingabe = useRef<HTMLInputElement>(null)
  const phase = stand.automat.phase
  const v = stand.vorbereitung!
  const lokal = lokale.find((a) => a.lokalId === stand.lokalId)
  const stand_ = lokal ? fortschritt(lokal) : null
  const iPhone = istIPhone()

  // Versehentliches Schließen abfangen, solange aufgenommen wird
  useEffect(() => {
    const warnen = (ev: BeforeUnloadEvent) => {
      ev.preventDefault()
      ev.returnValue = ''
    }
    window.addEventListener('beforeunload', warnen)
    return () => window.removeEventListener('beforeunload', warnen)
  }, [])

  async function beenden() {
    if (!window.confirm('Aufnahme beenden und auswerten lassen?')) return
    setBeendet(true)
    try {
      const lokalId = await s.beenden()
      // Die Sitzung setzt der Warte-Bildschirm zurück (AufnahmeRoute) — hier zurücksetzen hieße, dass diese
      // Seite vor dem Wechsel noch einmal mit „bereit“ zeichnet und zur Startseite umleitet.
      navigate(lokalId ? `/aufnahme/lokal-${lokalId}` : '/', { replace: true })
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
      setBeendet(false)
    }
  }

  async function foto(datei: File | undefined) {
    if (!datei) return
    try {
      await s.fotoHinzufuegen(datei)
    } catch (err) {
      setFehler(`Foto ließ sich nicht speichern: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="truncate text-base font-semibold text-slate-900">{v.titel}</div>
        <div className="text-xs text-slate-500">
          {v.art === 'termin' ? 'Termin' : v.art === 'telefon' ? 'Telefonat' : 'Notiz'}
          {v.kundeName ? ` · ${v.kundeName}` : v.objektName ? ` · ${v.objektName}` : ' · Akte später zuordnen'}
        </div>
      </div>

      {/* Uhr und Stand */}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {phase === 'laeuft' && (
            <>
              <span className="h-3 w-3 animate-pulse rounded-full bg-rose-600" />
              <span className="text-rose-700">Aufnahme läuft</span>
            </>
          )}
          {phase === 'pausiert' && <span className="text-amber-700">Pausiert</span>}
          {phase === 'unterbrochen' && <span className="text-rose-700">Unterbrochen</span>}
        </div>
        <div className="font-mono text-5xl font-semibold tabular-nums text-slate-900">{zeitText(s.gesamtMs())}</div>
        <Pegelanzeige aktiv={phase === 'laeuft'} />
        <div className="text-xs text-slate-500">
          {stand_ ? `${stand_.gemeldet} von ${stand_.gesamt} Abschnitten hochgeladen` : 'Wird auf dem Gerät gesichert'}
          {!online && (
            <span className="ml-1 inline-flex items-center gap-1 text-amber-700">
              <CloudOff className="h-3 w-3" /> kein Netz, später
            </span>
          )}
        </div>
      </div>

      {/* Hinweise */}
      {phase === 'unterbrochen' && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{stand.hinweis ?? stand.automat.grund ?? 'Die Aufnahme wurde unterbrochen.'}</span>
          </div>
          <button onClick={() => void s.fortsetzen()} className="mt-3 w-full rounded-lg bg-rose-600 px-3 py-2.5 text-sm font-semibold text-white">
            Weiter aufnehmen
          </button>
        </div>
      )}
      {stand.stumm && phase === 'laeuft' && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Das Mikrofon ist gerade stumm (zum Beispiel wegen eines Anrufs). Es geht weiter, sobald es wieder frei ist.
        </div>
      )}
      {iPhone && phase !== 'unterbrochen' && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>iPhone:</strong> Bildschirm nicht sperren und die App nicht verlassen — sonst hält das iPhone die Aufnahme an. Bisher Aufgenommenes bleibt gesichert.
            {e.wachHalten && !stand.wachGehalten && ' Der Bildschirm bleibt hier nicht von selbst an: bitte das Handy ab und zu antippen oder die automatische Sperre in den Einstellungen des iPhones verlängern.'}
          </span>
        </div>
      )}

      {/* Bedienung */}
      <div className="grid grid-cols-2 gap-3">
        {phase === 'laeuft' && (
          <button onClick={s.pause} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-800">
            <Pause className="h-5 w-5" /> Pause
          </button>
        )}
        {phase === 'pausiert' && (
          <button onClick={s.weiter} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3.5 text-sm font-semibold text-emerald-800">
            <Play className="h-5 w-5" /> Weiter
          </button>
        )}
        {phase === 'unterbrochen' && <div />}
        <button onClick={beenden} disabled={beendet} className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-50">
          {beendet ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Square className="h-5 w-5" />} Beenden
        </button>
      </div>

      {fehler && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      {/* Markierungen */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Markieren</div>
        <div className="grid grid-cols-3 gap-2">
          {MARKER.map(({ art, text, Icon, farbe }) => (
            <button
              key={art}
              onClick={() => setBearbeite(s.markieren(art))}
              disabled={phase === 'unterbrochen'}
              className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-3 text-sm font-medium text-slate-700 active:bg-slate-100 disabled:opacity-40"
            >
              <Icon className={`h-5 w-5 ${farbe}`} /> {text}
            </button>
          ))}
        </div>
        {stand.marker.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {stand.marker.map((m, i) => (
              <li key={`${m.sek}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{zeitText(m.sek * 1000)}</span>
                {bearbeite === i ? (
                  <input
                    autoFocus
                    defaultValue={m.text}
                    onBlur={(ev) => {
                      s.markerText(i, ev.target.value.trim())
                      setBearbeite(null)
                    }}
                    onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-base sm:text-sm"
                    placeholder="Stichwort (freiwillig)"
                  />
                ) : (
                  <button onClick={() => setBearbeite(i)} className="min-w-0 flex-1 truncate text-left text-sm text-slate-800">
                    {m.text}
                  </button>
                )}
                <button onClick={() => s.markerEntfernen(i)} className="p-1 text-slate-400" aria-label="Markierung entfernen">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notizen */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Notizen</div>
        <textarea
          value={stand.notizen}
          onChange={(ev) => s.notizSetzen(ev.target.value)}
          rows={3}
          placeholder="Stichworte während des Gesprächs …"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 sm:text-sm"
        />
      </div>

      {/* Fotos */}
      <div>
        <input ref={fotoEingabe} type="file" accept="image/*" capture="environment" className="hidden" onChange={(ev) => (void foto(ev.target.files?.[0]), (ev.target.value = ''))} />
        <button onClick={() => fotoEingabe.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
          <Camera className="h-5 w-5" /> Dokument fotografieren{stand.fotos > 0 ? ` (${stand.fotos})` : ''}
        </button>
      </div>

      {/* Mitlesen */}
      {e.untertitel && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 text-xs font-medium text-slate-500">Mitlesen (nur Hilfe — die genaue Abschrift kommt vom Server)</div>
          <p className="min-h-[3rem] text-sm text-slate-700">{stand.untertitel || '…'}</p>
        </div>
      )}
    </div>
  )
}
