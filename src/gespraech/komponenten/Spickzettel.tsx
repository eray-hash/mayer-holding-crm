// Spickzettel während der Aufnahme: das Wichtigste aus der Akte auf einen Blick — Gesprächspunkte, offene
// Punkte, Wiedervorlagen, fehlende Unterlagen, offene Rechnungen, nächste Schritte, letzte Kontakte.
// Daten: gespraech_vorbereitung (hilfeDaten.ts), im Gerätespeicher abgelegt, also auch ohne Netz da.
// Jeder Block lässt sich zuklappen (gemerkt je Gerät); leere Blöcke stehen gesammelt in einer Zeile.
import type { ReactNode } from 'react'
import { CalendarClock, ChevronDown, ChevronRight, CircleAlert, FileWarning, History, Lightbulb, ListTodo, LoaderCircle, Receipt, RefreshCw, ScrollText, Footprints, Info } from 'lucide-react'
import { useOnline } from '../hooks'
import { hatZiel, setzeAnzeige, useAnzeige, useSpickzettel, type SpickDaten, type SpickZiel } from './hilfeDaten'
import type { Thema } from './thema'

type Block = { id: string; titel: string; Icon: typeof Info; leer: string; inhalt: ReactNode | null; anzahl?: number }

const UHR = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
const TAG = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })

function standText(am: number): string {
  const d = new Date(am)
  return d.toDateString() === new Date().toDateString() ? `heute ${UHR.format(d)} Uhr` : `${TAG.format(d)}, ${UHR.format(d)} Uhr`
}

function kurzTag(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.` : ''
}

/** Hebt „überfällig“ farbig hervor. */
function Zeile({ text, t }: { text: string; t: Thema }) {
  const teile = text.split(/(\(überfällig\)|–\s*überfällig(?![a-zäöüß]))/i)
  return (
    <>
      {teile.map((x, i) =>
        i % 2 === 1 ? (
          <span key={i} className={`font-semibold ${t.dunkel ? 'text-rose-300' : 'text-rose-700'}`}>
            {x}
          </span>
        ) : (
          <span key={i}>{x}</span>
        ),
      )}
    </>
  )
}

function Liste({ zeilen, t }: { zeilen: string[]; t: Thema }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {zeilen.map((z, i) => (
        <li key={i} className="flex gap-2">
          <span className={`mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full ${t.dunkel ? 'bg-slate-500' : 'bg-slate-400'}`} />
          <span className="min-w-0">
            <Zeile text={z} t={t} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function bloecke(d: SpickDaten, t: Thema): Block[] {
  const b = d.briefing
  if (!b) return []
  const istWv = (z: string) => /^Wiedervorlage\s/.test(z) || /weitere Wiedervorlagen/.test(z)
  const wv = b.offen.filter(istWv).map((z) => z.replace(/^Wiedervorlage\s+/, ''))
  const offen = b.offen.filter((z) => !istWv(z))
  const punkte = d.gespraechspunkte ?? []
  return [
    { id: 'punkte', titel: 'Ansprechen', Icon: Lightbulb, leer: 'Gesprächspunkte', inhalt: punkte.length ? <Liste zeilen={punkte} t={t} /> : null, anzahl: punkte.length },
    { id: 'offen', titel: 'Offene Punkte', Icon: ListTodo, leer: 'offenen Punkte', inhalt: offen.length ? <Liste zeilen={offen} t={t} /> : null, anzahl: offen.length },
    { id: 'fehlend', titel: 'Fehlende Unterlagen', Icon: FileWarning, leer: 'fehlenden Unterlagen', anzahl: b.fehlend.length,
      inhalt: b.fehlend.length ? (
        <>
          <Liste zeilen={b.fehlend} t={t} />
          {b.fehlendSeit && <div className={`mt-1.5 text-[0.85em] ${t.leise}`}>Zuletzt angefordert am {kurzTag(b.fehlendSeit)}</div>}
        </>
      ) : null },
    { id: 'wv', titel: 'Wiedervorlagen', Icon: CalendarClock, leer: 'Wiedervorlagen', inhalt: wv.length ? <Liste zeilen={wv} t={t} /> : null, anzahl: wv.length },
    { id: 'geld', titel: 'Offene Rechnungen und Angebote', Icon: Receipt, leer: 'offenen Rechnungen', inhalt: b.geld.length ? <Liste zeilen={b.geld} t={t} /> : null, anzahl: b.geld.length },
    { id: 'schritte', titel: 'Nächste Schritte', Icon: Footprints, leer: 'nächsten Schritte', inhalt: b.naechsteSchritte ? <p>{b.naechsteSchritte}</p> : null },
    { id: 'kontakte', titel: 'Letzte Kontakte', Icon: History, leer: 'Kontakte', anzahl: b.kontakte.length,
      inhalt: b.kontakte.length ? (
        <ul className="flex flex-col gap-1.5">
          {b.kontakte.slice(0, 3).map((k, i) => (
            <li key={i} className="flex gap-2">
              <span className={`w-14 shrink-0 tabular-nums ${t.leise}`}>{kurzTag(k.datum) || '—'}</span>
              <span className="min-w-0">{k.text}</span>
            </li>
          ))}
        </ul>
      ) : null },
    { id: 'eckdaten', titel: 'Eckdaten', Icon: Info, leer: '', inhalt: b.eckdaten.length ? <Liste zeilen={b.eckdaten} t={t} /> : null },
    { id: 'sachverhalt', titel: 'Sachverhalt', Icon: ScrollText, leer: '', inhalt: b.sachverhalt ? <p>{b.sachverhalt}</p> : null },
  ]
}

export function Spickzettel({ ziel, t, gross }: { ziel: SpickZiel; t: Thema; gross: boolean }) {
  const { daten, am, laedt, fehler, neuLaden } = useSpickzettel(ziel)
  const online = useOnline()
  const anzeige = useAnzeige()
  const schrift = gross ? 'text-lg leading-relaxed' : 'text-[15px] leading-snug'

  if (!hatZiel(ziel)) {
    return <div className={`rounded-2xl border p-4 ${t.karte} ${t.leise} ${schrift}`}>Diese Aufnahme ist mit keiner Akte und keinem Termin verknüpft — der Spickzettel braucht eine Akte. Zuordnen geht nach dem Gespräch.</div>
  }
  if (!daten) {
    if (laedt)
      return (
        <div className={`flex items-center gap-2 rounded-2xl border p-4 ${t.karte} ${t.leise} ${schrift}`}>
          <LoaderCircle className="h-5 w-5 animate-spin" /> Spickzettel wird geladen …
        </div>
      )
    return (
      <div className={`rounded-2xl border p-4 ${t.karte} ${schrift}`}>
        <p className={t.leise}>{!online ? 'Kein Netz, und der Spickzettel wurde vorher nicht auf dem Gerät gespeichert. Er lädt, sobald wieder Netz da ist.' : fehler ? `Der Spickzettel ließ sich nicht laden: ${fehler}` : 'Noch kein Spickzettel geladen.'}</p>
        {online && (
          <button onClick={neuLaden} className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border font-medium ${t.knopf}`}>
            <RefreshCw className="h-5 w-5" /> Erneut versuchen
          </button>
        )}
      </div>
    )
  }

  const b = daten.briefing
  const alle = bloecke(daten, t)
  const voll = alle.filter((x) => x.inhalt)
  const leer = alle.filter((x) => !x.inhalt && x.leer).map((x) => x.leer)
  const zu = new Set(anzeige.zu)
  const umschalten = (id: string) => setzeAnzeige({ zu: zu.has(id) ? anzeige.zu.filter((x) => x !== id) : [...anzeige.zu, id] })

  return (
    <div className={`flex flex-col gap-2.5 ${schrift}`}>
      {/* Kopf: Akte, Stand, Verantwortlich, Stand der Daten */}
      <div className={`rounded-2xl border px-4 py-3 ${t.karte}`}>
        {b ? (
          <>
            <div className={`font-semibold ${gross ? 'text-xl' : 'text-lg'} ${t.text}`}>{b.kopf}</div>
            <div className={t.leise}>
              {[b.stand, b.verantwortlich && `zuständig: ${b.verantwortlich}`].filter(Boolean).join(' · ')}
            </div>
          </>
        ) : (
          <div className={t.leise}>{daten.hinweis ?? 'Zu diesem Termin gibt es keine Akte.'}</div>
        )}
        <div className={`mt-2 flex items-center gap-2 text-[0.8em] ${t.leise}`}>
          <span className="min-w-0 flex-1">
            {am ? `Stand ${standText(am)}` : ''}
            {!online && ' · ohne Netz, vom Gerät'}
            {fehler && online && ' · neu laden ging nicht'}
          </span>
          <button onClick={neuLaden} disabled={!online || laedt} aria-label="Spickzettel neu laden" className={`flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-40 ${t.knopf}`}>
            <RefreshCw className={`h-4 w-4 ${laedt ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {voll.map((x) => {
        const offen = !zu.has(x.id)
        return (
          <section key={x.id} className={`overflow-hidden rounded-2xl border ${t.karte}`}>
            <button onClick={() => umschalten(x.id)} className="flex min-h-[3rem] w-full items-center gap-2.5 px-4 py-2 text-left" aria-expanded={offen}>
              <x.Icon className={`h-5 w-5 shrink-0 ${t.leise}`} />
              <span className={`flex-1 font-semibold ${t.text}`}>{x.titel}</span>
              {x.anzahl ? <span className={`rounded-full px-2 text-[0.8em] font-semibold ${t.dunkel ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}>{x.anzahl}</span> : null}
              {offen ? <ChevronDown className={`h-5 w-5 ${t.leise}`} /> : <ChevronRight className={`h-5 w-5 ${t.leise}`} />}
            </button>
            {offen && <div className={`px-4 pb-3 ${t.text}`}>{x.inhalt}</div>}
          </section>
        )
      })}

      {leer.length > 0 && b && (
        <div className={`px-1 text-[0.85em] ${t.leise}`}>Keine {leer.join(', ')}.</div>
      )}
      {b && b.fehler.length > 0 && (
        <div className={`flex items-start gap-2 px-1 text-[0.8em] ${t.leise}`}>
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Nicht geladen: {b.fehler.join(', ')}
        </div>
      )}
    </div>
  )
}
