// Laufende Aufnahme: Einwilligung → Aufnahme. Nach „Beenden“ geht es zum Warte-Bildschirm #/aufnahme/lokal-<id>.
// Während der Aufnahme (Runde 5, 22.11.2026) ein eigener Vollbild-Bildschirm für die Bedienung mit einer Hand:
//   oben     Uhr, Status, Pegel, Akte; Schalter für dunkel/hell und große Schrift
//   Mitte    drei Reiter: Spickzettel (Stand der Akte, auch ohne Netz), Leitfaden (Fragebogen zum Abhaken),
//            Notizen (Markierungen, Stichworte, Mitlesen)
//   unten    immer erreichbar: Reiterwahl, Markieren (Wichtig/Aufgabe/Frage), Foto, Pause/Weiter, Beenden
// Spickzettel und Leitfäden werden schon beim Einwilligungs-Bildschirm in den Gerätespeicher geladen.
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BookOpenCheck, Camera, CircleHelp, CloudOff, LoaderCircle, Moon, NotebookPen, Pause, Play, ScrollText, Square, SquareCheck, Star, Sun, TriangleAlert, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { zeitText } from '../automat'
import { Einwilligung } from '../komponenten/Einwilligung'
import { Leitfaden } from '../komponenten/Leitfaden'
import { Pegelanzeige } from '../komponenten/Pegelanzeige'
import { Spickzettel } from '../komponenten/Spickzettel'
import { hilfeVorladen, setzeAnzeige, useAnzeige, type Reiter } from '../komponenten/hilfeDaten'
import { thema } from '../komponenten/thema'
import { useEinstellungen } from '../einstellungen'
import { useLokaleAufnahmen, useOnline, useTakt } from '../hooks'
import { istIPhone } from '../rekorder'
import * as s from '../sitzung'
import { fortschritt } from '../warteschlange'
import type { GespraechMarkerArt } from '../typen'

const MARKER: { art: GespraechMarkerArt; text: string; Icon: typeof Star; farbe: string }[] = [
  { art: 'wichtig', text: 'Wichtig', Icon: Star, farbe: 'text-amber-500' },
  { art: 'aufgabe', text: 'Aufgabe', Icon: SquareCheck, farbe: 'text-emerald-500' },
  { art: 'frage', text: 'Frage', Icon: CircleHelp, farbe: 'text-sky-500' },
]

const REITER: { id: Reiter; text: string; Icon: typeof Star }[] = [
  { id: 'spick', text: 'Spickzettel', Icon: ScrollText },
  { id: 'leitfaden', text: 'Leitfaden', Icon: BookOpenCheck },
  { id: 'notizen', text: 'Notizen', Icon: NotebookPen },
]

export function Aufnehmen() {
  const stand = s.useSitzung()
  const { mitarbeiter } = useAuth()
  const e = useEinstellungen()
  const navigate = useNavigate()
  const phase = stand.automat.phase
  const v = stand.vorbereitung

  // Spickzettel und Leitfäden schon jetzt (meist noch mit Netz) auf das Gerät holen.
  const kundeId = v?.kundeId
  const objektId = v?.objektId
  const terminId = v?.terminId
  useEffect(() => {
    if (kundeId || objektId || terminId || phase === 'einwilligung') void hilfeVorladen({ kundeId, objektId, terminId })
    // Nur beim Wechsel der Akte, nicht bei jedem Phasenwechsel
    // (phase steht nur drin, damit die Leitfäden auch ohne Akte geladen werden).
  }, [kundeId, objektId, terminId, phase === 'einwilligung'])

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
  const anzeige = useAnzeige()
  const navigate = useNavigate()
  const online = useOnline()
  const lokale = useLokaleAufnahmen()
  useTakt(500)
  const [beendet, setBeendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [bearbeite, setBearbeite] = useState<number | null>(null)
  const [gesetzt, setGesetzt] = useState<{ index: number; art: GespraechMarkerArt; sek: number } | null>(null)
  const fotoEingabe = useRef<HTMLInputElement>(null)
  const phase = stand.automat.phase
  const v = stand.vorbereitung!
  const lokal = lokale.find((a) => a.lokalId === stand.lokalId)
  const stand_ = lokal ? fortschritt(lokal) : null
  const iPhone = istIPhone()
  const t = thema(anzeige.dunkel)
  const gross = anzeige.gross

  // Versehentliches Schließen abfangen, solange aufgenommen wird
  useEffect(() => {
    const warnen = (ev: BeforeUnloadEvent) => {
      ev.preventDefault()
      ev.returnValue = ''
    }
    window.addEventListener('beforeunload', warnen)
    return () => window.removeEventListener('beforeunload', warnen)
  }, [])

  // Vollbild: die Seite dahinter nicht mitscrollen lassen
  useEffect(() => {
    const vorher = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = vorher
    }
  }, [])

  // Hinweis „markiert“ nach ein paar Sekunden ausblenden
  useEffect(() => {
    if (!gesetzt) return
    const uhr = window.setTimeout(() => setGesetzt(null), 5000)
    return () => window.clearTimeout(uhr)
  }, [gesetzt])

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

  function markieren(art: GespraechMarkerArt) {
    const index = s.markieren(art)
    setGesetzt({ index, art, sek: Math.floor(s.gesamtMs() / 1000) })
  }

  /** Markierung {art:'frage'} mit Text aus dem Leitfaden (Notiz zu einer Frage, benutzter Leitfaden). */
  function frageMarkieren(text: string) {
    const index = s.markieren('frage')
    s.markerText(index, text)
  }

  function stichwortErgaenzen() {
    if (!gesetzt) return
    setBearbeite(gesetzt.index)
    setGesetzt(null)
    setzeAnzeige({ reiter: 'notizen' })
  }

  const schrift = gross ? 'text-lg' : 'text-[15px]'
  const artText = v.art === 'termin' ? 'Termin' : v.art === 'telefon' ? 'Telefonat' : 'Notiz'
  const akte = v.kundeName ?? v.objektName ?? 'Akte später zuordnen'

  return (
    <div className={`fixed inset-x-0 top-0 z-30 flex h-[100dvh] flex-col ${t.seite}`} style={{ colorScheme: t.dunkel ? 'dark' : 'light' }}>
      {/* Kopf: Uhr, Status, Pegel, Akte, Anzeige-Schalter */}
      <header className={`shrink-0 border-b px-4 pb-2 ${t.leiste}`} style={{ paddingTop: 'max(0.6rem, env(safe-area-inset-top))' }}>
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="flex shrink-0 flex-col items-start">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {phase === 'laeuft' && (
                <>
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                  <span className={t.dunkel ? 'text-rose-300' : 'text-rose-700'}>Aufnahme</span>
                </>
              )}
              {phase === 'pausiert' && <span className={t.dunkel ? 'text-amber-300' : 'text-amber-700'}>Pausiert</span>}
              {phase === 'unterbrochen' && <span className={t.dunkel ? 'text-rose-300' : 'text-rose-700'}>Unterbrochen</span>}
            </div>
            <div className="font-mono text-3xl font-semibold tabular-nums leading-tight">{zeitText(s.gesamtMs())}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-sm font-semibold ${t.text}`}>{v.titel}</div>
            <div className={`truncate text-xs ${t.leise}`}>
              {artText} · {akte}
            </div>
          </div>
          <button
            onClick={() => setzeAnzeige({ gross: !gross })}
            aria-pressed={gross}
            aria-label="Große Schrift"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-base font-bold ${gross ? t.knopfAktiv : t.knopf}`}
          >
            A<span className="text-xs">+</span>
          </button>
          <button
            onClick={() => setzeAnzeige({ dunkel: !t.dunkel })}
            aria-label={t.dunkel ? 'Hell anzeigen' : 'Dunkel anzeigen'}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${t.knopf}`}
          >
            {t.dunkel ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
        <div className="mx-auto mt-2 flex max-w-md items-center gap-3">
          <div className={`flex-1 ${t.dunkel ? 'opacity-70' : ''}`}>
            <Pegelanzeige aktiv={phase === 'laeuft'} />
          </div>
          <div className={`shrink-0 text-[11px] ${t.leise}`}>
            {stand_ ? `${stand_.gemeldet}/${stand_.gesamt} hochgeladen` : 'auf dem Gerät'}
            {!online && (
              <span className={`ml-1 inline-flex items-center gap-0.5 ${t.dunkel ? 'text-amber-300' : 'text-amber-700'}`}>
                <CloudOff className="h-3 w-3" /> kein Netz
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Inhalt: Hinweise + gewählter Reiter (alle bleiben eingehängt, damit nichts neu lädt) */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={`mx-auto flex max-w-md flex-col gap-3 px-4 py-3 ${schrift}`}>
          {phase === 'unterbrochen' && (
            <div className={`flex items-start gap-2 rounded-2xl border p-3 ${t.fehler}`}>
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{stand.hinweis ?? stand.automat.grund ?? 'Die Aufnahme wurde unterbrochen.'} Unten auf „Weiter aufnehmen“ tippen.</span>
            </div>
          )}
          {stand.stumm && phase === 'laeuft' && (
            <div className={`flex items-start gap-2 rounded-2xl border p-3 ${t.warn}`}>
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" /> Das Mikrofon ist gerade stumm (zum Beispiel wegen eines Anrufs). Es geht weiter, sobald es wieder frei ist.
            </div>
          )}
          {iPhone && phase !== 'unterbrochen' && (
            <div className={`flex items-start gap-2 rounded-2xl border p-2.5 text-xs ${t.warn}`}>
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>iPhone:</strong> Bildschirm nicht sperren und die App nicht verlassen — sonst hält das iPhone die Aufnahme an. Bisher Aufgenommenes bleibt gesichert.
                {e.wachHalten && !stand.wachGehalten && ' Der Bildschirm bleibt hier nicht von selbst an: bitte das Handy ab und zu antippen oder die automatische Sperre in den Einstellungen des iPhones verlängern.'}
              </span>
            </div>
          )}
          {fehler && (
            <div className={`flex items-start gap-2 rounded-2xl border p-3 ${t.fehler}`}>
              <span className="flex-1">{fehler}</span>
              <button onClick={() => setFehler(null)} aria-label="Hinweis schließen" className="p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className={anzeige.reiter === 'spick' ? '' : 'hidden'}>
            <Spickzettel ziel={{ kundeId: v.kundeId, objektId: v.objektId, terminId: v.terminId }} t={t} gross={gross} />
          </div>
          <div className={anzeige.reiter === 'leitfaden' ? '' : 'hidden'}>
            <Leitfaden art={v.art} kundeBereich={v.kundeBereich} objekt={!!v.objektId && !v.kundeId} lokalId={stand.lokalId} t={t} gross={gross} onMarkieren={frageMarkieren} />
          </div>
          <div className={anzeige.reiter === 'notizen' ? 'flex flex-col gap-3' : 'hidden'}>
            <Notizen t={t} gross={gross} bearbeite={bearbeite} setBearbeite={setBearbeite} untertitel={e.untertitel} />
          </div>
        </div>
      </main>

      {/* Bedienung: immer im Daumenbereich */}
      <footer className={`shrink-0 border-t px-3 pt-2 ${t.leiste}`} style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-md flex-col gap-2">
          {gesetzt && (
            <button onClick={stichwortErgaenzen} className={`flex h-11 items-center gap-2 rounded-xl border px-3 text-sm ${t.knopf}`}>
              <span className="font-semibold">{MARKER.find((m) => m.art === gesetzt.art)?.text} bei {zeitText(gesetzt.sek * 1000)} markiert</span>
              <span className={`ml-auto ${t.leise}`}>Stichwort ergänzen</span>
            </button>
          )}
          <div className={`grid grid-cols-3 gap-1 rounded-xl p-1 ${t.dunkel ? 'bg-slate-800' : 'bg-slate-100'}`} role="tablist">
            {REITER.map(({ id, text, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={anzeige.reiter === id}
                onClick={() => setzeAnzeige({ reiter: id })}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ${anzeige.reiter === id ? (t.dunkel ? 'bg-slate-600 text-white' : 'bg-white text-slate-900 shadow-sm') : t.leise}`}
              >
                <Icon className="h-4 w-4" /> {text}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MARKER.map(({ art, text, Icon, farbe }) => (
              <button key={art} onClick={() => markieren(art)} className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-semibold ${t.knopf}`}>
                <Icon className={`h-6 w-6 ${farbe}`} /> {text}
              </button>
            ))}
            <button onClick={() => fotoEingabe.current?.click()} className={`relative flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-semibold ${t.knopf}`}>
              <Camera className="h-6 w-6" /> Foto
              {stand.fotos > 0 && <span className="absolute right-1.5 top-1 rounded-full bg-sky-600 px-1.5 text-[10px] font-bold text-white">{stand.fotos}</span>}
            </button>
            <input ref={fotoEingabe} type="file" accept="image/*" capture="environment" className="hidden" onChange={(ev) => (void foto(ev.target.files?.[0]), (ev.target.value = ''))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {phase === 'laeuft' && (
              <button onClick={s.pause} className={`flex h-16 items-center justify-center gap-2 rounded-2xl border text-lg font-semibold ${t.knopf}`}>
                <Pause className="h-6 w-6" /> Pause
              </button>
            )}
            {phase === 'pausiert' && (
              <button onClick={s.weiter} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-semibold text-white active:bg-emerald-700">
                <Play className="h-6 w-6" /> Weiter
              </button>
            )}
            {phase === 'unterbrochen' && (
              <button onClick={() => void s.fortsetzen()} className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-base font-semibold text-white active:bg-rose-700">
                <Play className="h-6 w-6" /> Weiter aufnehmen
              </button>
            )}
            <button
              onClick={beenden}
              disabled={beendet}
              className={`flex h-16 items-center justify-center gap-2 rounded-2xl text-lg font-semibold disabled:opacity-50 ${t.dunkel ? 'bg-slate-100 text-slate-900 active:bg-white' : 'bg-slate-900 text-white active:bg-slate-800'}`}
            >
              {beendet ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <Square className="h-6 w-6" />} Beenden
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

/** Reiter „Notizen“: Markierungen (mit Stichwort), freie Notizen, Mitlesen. */
function Notizen({ t, gross, bearbeite, setBearbeite, untertitel }: { t: ReturnType<typeof thema>; gross: boolean; bearbeite: number | null; setBearbeite: (i: number | null) => void; untertitel: boolean }) {
  const stand = s.useSitzung()
  const schrift = gross ? 'text-lg' : 'text-base'
  return (
    <>
      <div>
        <div className={`mb-1.5 text-sm font-semibold ${t.leise}`}>Markierungen</div>
        {stand.marker.length === 0 ? (
          <div className={`rounded-2xl border p-3 text-sm ${t.karte} ${t.leise}`}>Noch keine. Unten auf Wichtig, Aufgabe oder Frage tippen — die Stelle im Gespräch wird gemerkt.</div>
        ) : (
          <ul className={`divide-y overflow-hidden rounded-2xl border ${t.karte} ${t.trenner}`}>
            {stand.marker.map((m, i) => {
              const Icon = MARKER.find((x) => x.art === m.art)?.Icon ?? Star
              const farbe = MARKER.find((x) => x.art === m.art)?.farbe ?? ''
              return (
                <li key={`${m.sek}-${i}`} className="flex min-h-[3.25rem] items-center gap-2 px-3 py-1.5">
                  <Icon className={`h-5 w-5 shrink-0 ${farbe}`} />
                  <span className={`w-11 shrink-0 font-mono text-xs ${t.leise}`}>{zeitText(m.sek * 1000)}</span>
                  {bearbeite === i ? (
                    <input
                      autoFocus
                      defaultValue={m.text}
                      onFocus={(ev) => ev.target.select()}
                      onBlur={(ev) => {
                        s.markerText(i, ev.target.value.trim())
                        setBearbeite(null)
                      }}
                      onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                      className={`h-11 min-w-0 flex-1 rounded-lg border px-2 text-base outline-none ${t.eingabe}`}
                      placeholder="Stichwort (freiwillig)"
                    />
                  ) : (
                    <button onClick={() => setBearbeite(i)} className={`min-h-[2.75rem] min-w-0 flex-1 text-left ${schrift} ${t.text}`}>
                      {m.text}
                    </button>
                  )}
                  <button onClick={() => s.markerEntfernen(i)} className={`flex h-10 w-10 shrink-0 items-center justify-center ${t.leise}`} aria-label="Markierung entfernen">
                    <X className="h-5 w-5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <div className={`mb-1.5 text-sm font-semibold ${t.leise}`}>Notizen</div>
        <textarea
          value={stand.notizen}
          onChange={(ev) => s.notizSetzen(ev.target.value)}
          rows={5}
          placeholder="Stichworte während des Gesprächs …"
          className={`w-full rounded-2xl border px-3 py-2 outline-none ${schrift} ${t.eingabe}`}
        />
      </div>

      {untertitel && (
        <div className={`rounded-2xl border p-3 ${t.karte}`}>
          <div className={`mb-1 text-xs font-medium ${t.leise}`}>Mitlesen (nur Hilfe — die genaue Abschrift kommt vom Server)</div>
          <p className={`min-h-[3rem] ${schrift} ${t.text}`}>{stand.untertitel || '…'}</p>
        </div>
      )}
    </>
  )
}
