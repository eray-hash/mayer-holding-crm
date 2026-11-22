// Startseite der Gesprächs-App: großer Aufnahmeknopf, „Jetzt / als Nächstes“ (Termin mit Akte), Art der
// Aufnahme, freiwillige Zuordnung zu einer Akte; darüber unvollständige und noch hochzuladende Aufnahmen.
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CalendarClock, ChevronRight, CloudOff, Info, Mic, NotebookPen, Phone, RotateCcw, Trash2, Users } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { AkteWahl, type AkteAuswahl } from '../komponenten/AkteWahl'
import { useEinstellungen } from '../einstellungen'
import { minutenText, useLokaleAufnahmen, useOnline, wannText } from '../hooks'
import { aufnahmeMoeglich } from '../rekorder'
import { unvollstaendigeAuswerten, unvollstaendigeFortsetzen, useSitzung, verwerfen, vorbereiten } from '../sitzung'
import { ladeTerminVorschlag, type TerminVorschlag } from '../termine'
import { istVerwaist, standText, type LokaleAufnahme } from '../warteschlange'
import type { GespraechArt } from '../typen'
import type { DirektVorbereitung } from '../direktLink'
import { hilfeVorladen } from '../komponenten/hilfeDaten'

/** Übergabe vom Direkt-Link (App.tsx, AufnehmenEinstieg), wenn etwas aus dem Link nicht auffindbar war. */
type StartZustand = { vorbelegung?: DirektVorbereitung; hinweis?: string } | null

function akteAus(v: DirektVorbereitung | undefined): AkteAuswahl {
  if (v?.kundeId) return { art: 'kunde', id: v.kundeId, bereich: v.kundeBereich ?? '', name: v.kundeName ?? v.titel }
  if (v?.objektId) return { art: 'objekt', id: v.objektId, name: v.objektName ?? v.titel }
  return null
}

const MODI: { art: GespraechArt; titel: string; hinweis: string; Icon: typeof Users }[] = [
  { art: 'termin', titel: 'Termin', hinweis: 'Gespräch vor Ort — Handy offen auf den Tisch legen, Mikrofon zu den Sprechenden.', Icon: Users },
  {
    art: 'telefon',
    titel: 'Telefonat',
    hinweis: 'Telefonat über ein anderes Gerät (Festnetz, zweites Handy, Computer) auf Lautsprecher führen und dieses Handy daneben legen. Während eines Anrufs auf demselben Handy nimmt es nichts auf.',
    Icon: Phone,
  },
  { art: 'notiz', titel: 'Notiz', hinweis: 'Nur Sie sprechen — zum Beispiel eine Zusammenfassung direkt nach dem Termin.', Icon: NotebookPen },
]

export function Start() {
  const { mitarbeiter } = useAuth()
  const navigate = useNavigate()
  const ort = useLocation()
  const [uebergabe] = useState<StartZustand>(() => (ort.state as StartZustand) ?? null)
  const vorbelegt = uebergabe?.vorbelegung
  const e = useEinstellungen()
  const s = useSitzung()
  const online = useOnline()
  const lokale = useLokaleAufnahmen()
  const [art, setArt] = useState<GespraechArt>(vorbelegt?.art ?? e.standardModus)
  const [akte, setAkte] = useState<AkteAuswahl>(() => akteAus(vorbelegt))
  const [titel, setTitel] = useState(vorbelegt?.titel ?? '')
  const [terminId, setTerminId] = useState<string | undefined>(vorbelegt?.terminId)
  const [hinweis, setHinweis] = useState<string | null>(uebergabe?.hinweis ?? null)

  // Übergabe nur einmal anwenden (Zurück/neu laden belegt nicht erneut vor).
  useEffect(() => {
    if (ort.state) navigate('.', { replace: true, state: null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [vorschlag, setVorschlag] = useState<TerminVorschlag | null | undefined>(undefined)
  const [fehler, setFehler] = useState<string | null>(null)
  const [arbeitet, setArbeitet] = useState<string | null>(null)

  useEffect(() => {
    if (!mitarbeiter?.email) return
    let aktiv = true
    ladeTerminVorschlag(mitarbeiter.email)
      .then((v) => {
        if (aktiv) setVorschlag(v)
        // Spickzettel und Leitfaden schon jetzt aufs Gerät laden — im Termin gibt es oft kein Netz.
        if (v) void hilfeVorladen({ terminId: v.termin.id, kundeId: v.bezug?.art === 'kunde' ? v.bezug.id : undefined, objektId: v.bezug?.art === 'objekt' ? v.bezug.id : undefined })
      })
      .catch(() => aktiv && setVorschlag(null))
    return () => {
      aktiv = false
    }
  }, [mitarbeiter?.email])

  const laeuft = s.automat.phase === 'laeuft' || s.automat.phase === 'pausiert' || s.automat.phase === 'unterbrochen' || s.automat.phase === 'startet'
  const jetzt = Date.now()
  const unvollstaendig = lokale.filter((a) => a.lokalId !== s.lokalId && istVerwaist(a, jetzt))
  const hochladend = lokale.filter((a) => a.beendet && !a.abgeschlossen)

  function terminUebernehmen(v: TerminVorschlag) {
    setTerminId(v.termin.id)
    setTitel(v.termin.titel)
    setArt('termin')
    if (v.bezug?.art === 'kunde') setAkte({ art: 'kunde', id: v.bezug.id, bereich: v.bezug.bereich, name: v.akteName ?? v.termin.titel })
    else if (v.bezug?.art === 'objekt') setAkte({ art: 'objekt', id: v.bezug.id, name: v.akteName ?? v.termin.titel })
  }

  function aufnehmen() {
    setFehler(null)
    try {
      vorbereiten({
        art,
        titel: titel.trim() || (akte ? akte.name : MODI.find((m) => m.art === art)!.titel),
        kundeId: akte?.art === 'kunde' ? akte.id : undefined,
        kundeBereich: akte?.art === 'kunde' ? akte.bereich || undefined : undefined,
        kundeName: akte?.art === 'kunde' ? akte.name : undefined,
        objektId: akte?.art === 'objekt' ? akte.id : undefined,
        objektName: akte?.art === 'objekt' ? akte.name : undefined,
        terminId,
      })
      navigate('/aufnehmen')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    }
  }

  async function mitUnvollstaendiger(a: LokaleAufnahme, was: 'fortsetzen' | 'auswerten' | 'verwerfen') {
    setFehler(null)
    setArbeitet(a.lokalId)
    try {
      if (was === 'fortsetzen') {
        await unvollstaendigeFortsetzen(a.lokalId)
        navigate('/aufnehmen')
      } else if (was === 'auswerten') {
        await unvollstaendigeAuswerten(a.lokalId)
        navigate(`/aufnahme/lokal-${a.lokalId}`)
      } else if (window.confirm('Diese Aufnahme wirklich löschen? Der Ton ist danach weg.')) {
        await verwerfen(a.lokalId)
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setArbeitet(null)
    }
  }

  const modus = MODI.find((m) => m.art === art)!

  return (
    <div className="flex flex-col gap-5">
      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <CloudOff className="h-4 w-4 shrink-0" /> Kein Netz — Aufnehmen geht trotzdem, hochgeladen wird später.
        </div>
      )}

      {hinweis && (
        <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{hinweis} Bitte prüfen und dann aufnehmen.</span>
          <button type="button" onClick={() => setHinweis(null)} className="text-xs font-medium text-sky-700">
            OK
          </button>
        </div>
      )}

      {laeuft && (
        <Link to="/aufnehmen" className="flex items-center gap-3 rounded-xl bg-rose-600 px-4 py-3 text-white">
          <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
          <span className="flex-1 text-sm font-semibold">Aufnahme läuft — zurück zur Aufnahme</span>
          <ChevronRight className="h-5 w-5" />
        </Link>
      )}

      {unvollstaendig.map((a) => (
        <div key={a.lokalId} className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">Unvollständige Aufnahme</div>
          <div className="mt-0.5 text-sm text-amber-900">
            {a.titel || 'Aufnahme'} · {wannText(a.erstelltAm)} · {minutenText(a.dauer_s)}
          </div>
          <p className="mt-1 text-xs text-amber-800">Die Aufnahme wurde nicht beendet (App geschlossen oder Handy gesperrt). Das bis dahin Aufgenommene ist auf dem Gerät gesichert.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={!!arbeitet || laeuft} onClick={() => mitUnvollstaendiger(a, 'auswerten')} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Hochladen und auswerten
            </button>
            <button disabled={!!arbeitet || laeuft} onClick={() => mitUnvollstaendiger(a, 'fortsetzen')} className="flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Weiter aufnehmen
            </button>
            <button disabled={!!arbeitet} onClick={() => mitUnvollstaendiger(a, 'verwerfen')} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-amber-800 disabled:opacity-50" aria-label="Verwerfen">
              <Trash2 className="h-4 w-4" /> Verwerfen
            </button>
          </div>
        </div>
      ))}

      {hochladend.map((a) => (
        <Link key={a.lokalId} to={`/aufnahme/lokal-${a.lokalId}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-900">{a.titel || 'Aufnahme'}</div>
            <div className="truncate text-xs text-slate-500">{standText(a, jetzt, online)}</div>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400" />
        </Link>
      ))}

      {/* Jetzt / als Nächstes */}
      {vorschlag && (
        <button
          type="button"
          onClick={() => terminUebernehmen(vorschlag)}
          className={`rounded-xl border p-3 text-left ${terminId === vorschlag.termin.id ? 'border-accent-300 bg-accent-50' : 'border-slate-200 bg-white'}`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-700">
            <CalendarClock className="h-4 w-4" /> {vorschlag.laeuftGerade ? 'Jetzt' : 'Als Nächstes'}
          </div>
          <div className="mt-1 text-base font-semibold text-slate-900">{vorschlag.termin.titel}</div>
          <div className="text-sm text-slate-600">
            {wannText(vorschlag.termin.beginn)}
            {vorschlag.termin.ort ? ` · ${vorschlag.termin.ort}` : ''}
          </div>
          {vorschlag.akteName && <div className="mt-1 text-sm text-slate-700">Akte: {vorschlag.akteName}</div>}
          <div className="mt-2 text-sm font-medium text-accent-600">{terminId === vorschlag.termin.id ? 'Für die Aufnahme übernommen' : 'Diesen Termin aufnehmen'}</div>
        </button>
      )}

      {/* Art der Aufnahme */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Was nehmen Sie auf?</div>
        <div className="grid grid-cols-3 gap-2">
          {MODI.map(({ art: a, titel: t, Icon }) => (
            <button
              key={a}
              type="button"
              onClick={() => setArt(a)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-sm font-medium ${art === a ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-700'}`}
            >
              <Icon className="h-5 w-5" />
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{modus.hinweis}</p>
      </div>

      {/* Akte */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Zu welcher Akte? <span className="font-normal text-slate-400">(freiwillig)</span></div>
        <AkteWahl wert={akte} onWahl={setAkte} />
        {!akte && <p className="mt-1 text-xs text-slate-500">Ohne Auswahl lässt sich die Aufnahme später zuordnen.</p>}
      </div>

      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">Titel <span className="font-normal text-slate-400">(freiwillig)</span></div>
        <input
          value={titel}
          onChange={(ev) => setTitel(ev.target.value)}
          placeholder={akte ? akte.name : 'z. B. Erstgespräch Müller'}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 sm:text-sm"
        />
      </div>

      {fehler && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      {aufnahmeMoeglich() ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <button
            type="button"
            onClick={aufnehmen}
            disabled={laeuft}
            className="flex h-28 w-28 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg shadow-rose-200 active:scale-95 disabled:opacity-40"
            aria-label="Aufnahme beginnen"
          >
            <Mic className="h-12 w-12" />
          </button>
          <div className="text-sm font-medium text-slate-700">Aufnahme beginnen</div>
        </div>
      ) : (
        <p className="rounded-xl bg-rose-50 px-3 py-3 text-sm text-rose-700">Dieser Browser kann nicht aufnehmen. Bitte auf dem iPhone Safari, auf Android Chrome verwenden.</p>
      )}
    </div>
  )
}
