// Prüfbildschirm einer fertigen Aufnahme (#/aufnahme/:id, sobald der Server 'fertig', 'fehler' oder 'verworfen'
// meldet; vorher zeigt die App selbst den Warte-Bildschirm). Drei Reiter:
//  - Ergebnis: Zusammenfassung, Kernthemen, Vereinbarungen, offene Punkte, Fragen und Einwände, Zahlen, Risiken,
//    fehlende Unterlagen, Stimmung.
//  - Abschrift: Text je Abschnitt mit Sprechernamen, dazu Markierungen, Notizen und Fotos an ihrer Stelle. Tippen
//    auf eine Zeitmarke springt im Abspieler dorthin (die Tonabschnitte laufen nacheinander, Links kurz gültig).
//  - In die Akte: jeder Vorschlag als Karte mit Haken und änderbaren Feldern; „Übernehmen“ ruft
//    gespraech_uebernehmen (Server legt nichts doppelt an; Übernommenes ist danach abgehakt und gesperrt).
//    Verschickt wird von hier nichts — der Mail-Entwurf landet als Notiz in der Akte. Seit Runde 5 auch der
//    vorbefüllte Fragebogen und die Aktenfelder (FragebogenKarten.tsx).
//  - Teilen (Runde 5, Teilen.tsx): an Kollegen per Telegram, Gesprächsnotiz an den Kunden (nur per Knopf + Bestätigung).
//  - Seit 24.11.2026 auf dem Reiter „In die Akte“ zusätzlich „Auf mehrere Akten verteilen“ (Verteilen.tsx) für Aufnahmen,
//    in denen mehrere Kunden nacheinander besprochen werden. Der Link aus dem CRM öffnet das mit ?verteilen=1.
// Auf dem Reiter „Abschrift“ zeigt SpracheUebersetzung.tsx die erkannte Sprache und auf Wunsch die deutsche Fassung.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { GespraechAufnahme, GespraechSegment } from '../typen'
import { AkteZuordnen } from './AkteZuordnen'
import {
  akteAnzeige,
  alsDatum,
  alsUhrzeit,
  ART_NAME,
  datumZeit,
  eigeneEmail,
  ladeAkte,
  ladeTeam,
  signierteLinks,
  STATUS_FARBE,
  STATUS_NAME,
  uebernehmen,
  zeit,
  type AkteKurz,
  type AufnahmeR5,
  type TeamMitglied,
  type UebernahmeErgebnis,
} from './api'
import { BEREICH_NAMEN } from '../akten'
import { aendere, feld, Karte, Schalter, UEBER_LEISTE } from './bausteine'
import { DeutscheFassung, istFremdsprachig, SprachLeiste } from './SpracheUebersetzung'
import { TeilenSeite } from './Teilen'
import { Verteilen } from './Verteilen'
import { afAlsDaten, afStart, AktenfelderKarten, fbStart, FragebogenKarte, type AfZeile, type FbZeile } from './FragebogenKarten'

export type AuswertungSeiteProps = {
  id: string
  zeile: GespraechAufnahme
  neuLaden: () => void
}

type Reiter = 'ergebnis' | 'abschrift' | 'akte' | 'teilen'
const MARKER_ZEICHEN: Record<string, string> = { wichtig: '★', aufgabe: '✓', frage: '?' }
const MARKER_NAME: Record<string, string> = { wichtig: 'Wichtig', aufgabe: 'Aufgabe', frage: 'Frage' }
const STAMMDATEN_NAME: Record<string, string> = { telefon: 'Telefon', email: 'E-Mail', anschrift: 'Anschrift', firma: 'Firma', ansprechpartner: 'Ansprechpartner', sonstiges: 'Sonstiges' }

export function AuswertungSeite({ id, zeile, neuLaden }: AuswertungSeiteProps) {
  const location = useLocation()
  const startVerteilen = new URLSearchParams(location.search).get('verteilen') === '1'
  const [reiter, setReiter] = useState<Reiter>(startVerteilen ? 'akte' : 'ergebnis')
  const [verteilenAn, setVerteilenAn] = useState(startVerteilen)
  const segmente = useMemo(() => [...(zeile.segmente ?? [])].sort((a, b) => a.nr - b.nr), [zeile.segmente])
  const fotos = zeile.fotos ?? []
  const [links, setLinks] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let aktiv = true
    const pfade = [...segmente.map((s) => s.pfad), ...fotos.map((f) => f.pfad)].filter(Boolean)
    if (zeile.status === 'verworfen' || pfade.length === 0) return
    signierteLinks(pfade).then((m) => aktiv && setLinks(m)).catch(() => {})
    return () => {
      aktiv = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeile.id, segmente.length, fotos.length, zeile.status])

  const abspieler = useAbspieler(segmente, links)

  return (
    <div className="pb-4">
      <div>
        <Link to="/aufnahmen" className="text-sm text-indigo-600">← Meine Aufnahmen</Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">{zeile.titel || ART_NAME[zeile.art] || 'Aufnahme'}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_FARBE[zeile.status] ?? ''}`}>{STATUS_NAME[zeile.status] ?? zeile.status}</span>
          <span>{ART_NAME[zeile.art] ?? ''}</span>
          <span>{datumZeit(zeile.erstellt_am)}</span>
          {zeile.dauer_s ? <span>{zeit(zeile.dauer_s)} Min.</span> : null}
        </div>
        {zeile.status === 'fehler' && (
          <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            Die Auswertung ist fehlgeschlagen{zeile.fehler ? `: ${zeile.fehler}` : '.'} Die Abschrift und der Ton bleiben erhalten, soweit vorhanden.
          </div>
        )}
        {zeile.status === 'verworfen' && <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">Diese Aufnahme wurde verworfen. Der Ton ist gelöscht.</div>}
      </div>

      <div className="-mx-4 mt-3 flex border-b border-slate-200 bg-white px-2">
        {(['ergebnis', 'abschrift', 'akte', 'teilen'] as Reiter[]).map((r) => (
          <button key={r} onClick={() => setReiter(r)} className={`flex-1 border-b-2 px-1 py-2.5 text-sm font-medium ${reiter === r ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500'}`}>
            {r === 'ergebnis' ? 'Ergebnis' : r === 'abschrift' ? 'Abschrift' : r === 'akte' ? 'In die Akte' : 'Teilen'}
          </button>
        ))}
      </div>

      <div className="pt-4">
        {reiter === 'ergebnis' && <Ergebnis zeile={zeile} />}
        {reiter === 'abschrift' && (
          <>
            {zeile.status !== 'verworfen' && <SprachLeiste id={id} zeile={zeile as AufnahmeR5} neuLaden={neuLaden} />}
            {istFremdsprachig(zeile as AufnahmeR5) && zeile.status !== 'verworfen' ? (
              <DeutscheFassung id={id} zeile={zeile as AufnahmeR5} springe={abspieler.springe} original={<Abschrift zeile={zeile} segmente={segmente} links={links} springe={abspieler.springe} />} />
            ) : (
              <Abschrift zeile={zeile} segmente={segmente} links={links} springe={abspieler.springe} />
            )}
          </>
        )}
        {reiter === 'akte' && (verteilenAn && zeile.status === 'fertig' ? (
          <Verteilen id={id} zurueck={() => setVerteilenAn(false)} />
        ) : (
          <InDieAkte id={id} zeile={zeile} neuLaden={neuLaden} onVerteilen={() => setVerteilenAn(true)} />
        ))}
        {reiter === 'teilen' && <TeilenSeite id={id} zeile={zeile as AufnahmeR5} neuLaden={neuLaden} />}
      </div>

      {/* Auf den Reitern „In die Akte“ und „Teilen“ ist der Abspieler versteckt; der Ton läuft trotzdem weiter. */}
      {segmente.length > 0 && zeile.status !== 'verworfen' && <Abspieler {...abspieler} segmente={segmente} links={links} versteckt={reiter === 'akte' || reiter === 'teilen'} />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Abspieler: die Tonabschnitte nacheinander, Sprung an eine Gesamtzeit

function startZeiten(segmente: GespraechSegment[]): number[] {
  const aus: number[] = []
  let summe = 0
  for (const s of segmente) {
    aus.push(summe)
    summe += Math.max(0, Number(s.dauer_s) || 0)
  }
  return aus
}

function useAbspieler(segmente: GespraechSegment[], links: Map<string, string>) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [index, setIndex] = useState(0)
  const [position, setPosition] = useState(0)
  const versatz = useRef<number | null>(null)
  const abspielen = useRef(false)
  const starts = useMemo(() => startZeiten(segmente), [segmente])

  function springe(sek: number) {
    let i = 0
    for (let n = 0; n < segmente.length; n++) if (starts[n] <= sek) i = n
    const rest = Math.max(0, sek - (starts[i] ?? 0))
    const audio = ref.current
    if (i === index && audio && audio.readyState >= 1) {
      audio.currentTime = rest
      void audio.play().catch(() => {})
    } else {
      versatz.current = rest
      abspielen.current = true
      setIndex(i)
    }
  }

  function geladen() {
    const audio = ref.current
    if (!audio) return
    if (versatz.current !== null) {
      audio.currentTime = versatz.current
      versatz.current = null
    }
    if (abspielen.current) {
      abspielen.current = false
      void audio.play().catch(() => {})
    }
  }

  function zuEnde() {
    if (index < segmente.length - 1) {
      abspielen.current = true
      setIndex(index + 1)
    }
  }

  function zeitUpdate() {
    const audio = ref.current
    if (audio) setPosition((starts[index] ?? 0) + audio.currentTime)
  }

  const src = links.get(segmente[index]?.pfad ?? '') ?? ''
  return { ref, index, position, src, springe, geladen, zuEnde, zeitUpdate }
}

function Abspieler(p: ReturnType<typeof useAbspieler> & { segmente: GespraechSegment[]; links: Map<string, string>; versteckt?: boolean }) {
  const gesamt = p.segmente.reduce((n, s) => n + (Number(s.dauer_s) || 0), 0)
  return (
    <div className={`sticky z-20 mt-4 rounded-xl border border-slate-200 bg-white/95 px-3 pb-2 pt-2 shadow-lg backdrop-blur ${p.versteckt ? 'hidden' : ''}`} style={UEBER_LEISTE}>
      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{p.segmente.length > 1 ? `Teil ${p.index + 1} von ${p.segmente.length}` : 'Aufnahme'}</span>
          <span>{zeit(p.position)}{gesamt ? ` / ${zeit(gesamt)}` : ''}</span>
        </div>
        {p.src ? (
          <audio ref={p.ref} src={p.src} controls preload="metadata" className="w-full" onLoadedMetadata={p.geladen} onEnded={p.zuEnde} onTimeUpdate={p.zeitUpdate} />
        ) : (
          <p className="py-2 text-sm text-slate-500">Ton wird geladen oder ist nicht mehr vorhanden.</p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Ergebnis

function Abschnitt({ titel, punkte }: { titel: string; punkte?: string[] }) {
  const liste = (punkte ?? []).filter((x) => String(x ?? '').trim())
  if (liste.length === 0) return null
  return (
    <section className="mt-5">
      <h2 className="text-sm font-semibold text-slate-700">{titel}</h2>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] text-slate-800">
        {liste.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </section>
  )
}

function Ergebnis({ zeile }: { zeile: GespraechAufnahme }) {
  const a = zeile.analyse
  if (!a) return <p className="text-sm text-slate-500">Keine Auswertung vorhanden.</p>
  return (
    <div>
      {a.zusammenfassung && <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{a.zusammenfassung}</p>}
      <Abschnitt titel="Kernthemen" punkte={a.kernthemen} />
      <Abschnitt titel="Vereinbart" punkte={a.vereinbarungen} />
      <Abschnitt titel="Offene Punkte" punkte={a.offene_punkte} />
      <Abschnitt titel="Fragen des Kunden" punkte={a.kundenfragen} />
      <Abschnitt titel="Einwände" punkte={a.einwaende} />
      <Abschnitt titel="Zahlen" punkte={(a.zahlen ?? []).map((z) => `${z.was}: ${z.betrag}${z.einheit ? ` ${z.einheit}` : ''}`)} />
      <Abschnitt titel="Risiken" punkte={a.risiken} />
      <Abschnitt titel="Fehlende Unterlagen" punkte={a.unterlagen_fehlen} />
      {a.stimmung && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-slate-700">Stimmung</h2>
          <p className="mt-1 text-[15px] text-slate-800">{a.stimmung}</p>
        </section>
      )}
      {a.chance_hinweis?.begruendung && (
        <section className="mt-5 rounded-lg bg-slate-50 p-3">
          <h2 className="text-sm font-semibold text-slate-700">Einschätzung der Abschlusschance{typeof a.chance_hinweis.prozent === 'number' ? `: ${a.chance_hinweis.prozent} %` : ''}</h2>
          <p className="mt-1 text-sm text-slate-700">{a.chance_hinweis.begruendung}</p>
        </section>
      )}
      {(a.sprecher ?? []).length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-slate-700">Beteiligte</h2>
          <p className="mt-1 text-sm text-slate-600">{(a.sprecher ?? []).map((s) => s.name || s.label).join(', ')}</p>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Abschrift

/** Ordnet Zeilen der Form „Sprecher A: …“ bzw. „[A]: …“ den Namen aus der Auswertung zu. */
function sprecherZeilen(text: string, namen: Map<string, string>): { wer: string | null; text: string }[] {
  return String(text ?? '')
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
    .map((z) => {
      const m = z.match(/^\[?([^\]:\n]{1,40})\]?\s*:\s*(.*)$/)
      if (m) {
        const label = m[1].trim()
        const name = namen.get(label.toLowerCase())
        if (name || /^sprecher\s*\w{1,3}$/i.test(label)) return { wer: name ?? label, text: m[2] }
      }
      return { wer: null, text: z }
    })
}

function Abschrift({ zeile, segmente, links, springe }: { zeile: GespraechAufnahme; segmente: GespraechSegment[]; links: Map<string, string>; springe: (sek: number) => void }) {
  const namen = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of zeile.analyse?.sprecher ?? zeile.sprecher ?? []) if (s?.label) m.set(String(s.label).trim().toLowerCase(), s.name || s.label)
    return m
  }, [zeile.analyse, zeile.sprecher])
  const starts = useMemo(() => startZeiten(segmente), [segmente])
  const mitText = segmente.some((s) => String(s.text ?? '').trim())
  const marker = [...(zeile.marker ?? [])].sort((a, b) => a.sek - b.sek)
  const fotos = [...(zeile.fotos ?? [])].sort((a, b) => a.sek - b.sek)
  const imAbschnitt = <T extends { sek: number }>(liste: T[], i: number) =>
    liste.filter((x) => x.sek >= starts[i] && (i === segmente.length - 1 || x.sek < starts[i + 1]))

  const Zeitmarke = ({ sek }: { sek: number }) => (
    <button onClick={() => springe(sek)} className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-xs text-indigo-700">{zeit(sek)}</button>
  )
  const Dazwischen = ({ i }: { i: number }) => (
    <>
      {imAbschnitt(marker, i).map((m, n) => (
        <div key={`m${n}`} className="my-2 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-sm text-amber-900">
          <Zeitmarke sek={m.sek} />
          <span>{MARKER_ZEICHEN[m.art] ?? '•'} {MARKER_NAME[m.art] ?? 'Markierung'}{m.text ? `: ${m.text}` : ''}</span>
        </div>
      ))}
      {imAbschnitt(fotos, i).length > 0 && (
        <div className="my-2 flex flex-wrap gap-2">
          {imAbschnitt(fotos, i).map((f, n) => (
            <button key={`f${n}`} onClick={() => springe(f.sek)} className="relative">
              {links.get(f.pfad) ? <img src={links.get(f.pfad)} alt={f.name || 'Foto'} className="h-24 w-24 rounded-lg object-cover" /> : <span className="block h-24 w-24 rounded-lg bg-slate-100" />}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white">{zeit(f.sek)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )

  return (
    <div>
      {zeile.notizen?.trim() && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3">
          <h2 className="text-sm font-semibold text-slate-700">Notizen</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{zeile.notizen}</p>
        </div>
      )}
      {mitText ? (
        segmente.map((s, i) => (
          <div key={s.nr} className="mb-4">
            <div className="mb-1"><Zeitmarke sek={starts[i]} /></div>
            <Dazwischen i={i} />
            {sprecherZeilen(String(s.text ?? ''), namen).map((z, n) => (
              <p key={n} className="mb-1.5 text-[15px] leading-relaxed text-slate-800">
                {z.wer && <span className="font-semibold text-slate-900">{z.wer}: </span>}
                {z.text}
              </p>
            ))}
          </div>
        ))
      ) : (
        <>
          {segmente.length > 0 ? segmente.map((_, i) => <Dazwischen key={i} i={i} />) : null}
          {zeile.transkript?.trim() ? (
            sprecherZeilen(zeile.transkript, namen).map((z, n) => (
              <p key={n} className="mb-1.5 text-[15px] leading-relaxed text-slate-800">
                {z.wer && <span className="font-semibold text-slate-900">{z.wer}: </span>}
                {z.text}
              </p>
            ))
          ) : (
            <p className="text-sm text-slate-500">Keine Abschrift vorhanden.</p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// In die Akte

type Schritt = { text: string; wer: string; faellig: string }
type Wv = { titel: string; faellig: string; an: boolean }
type Todo = { text: string; faellig: string; zustaendig: string; email: string; emailGewaehlt: boolean; an: boolean }
type Termin = { titel: string; datum: string; uhrzeit: string; dauer_min: number; ort: string; mit: string; an: boolean }
type Sd = { feld: string; wert: string; an: boolean }

function passendesMitglied(name: string, team: TeamMitglied[]): string {
  const n = name.trim().toLowerCase()
  if (!n) return ''
  const treffer = team.filter((m) => {
    const voll = m.name.toLowerCase()
    return voll === n || voll.split(/\s+/)[0] === n || n.split(/\s+/)[0] === voll.split(/\s+/)[0]
  })
  return treffer.length === 1 ? treffer[0].email : ''
}

function InDieAkte({ id, zeile: zeileRoh, neuLaden, onVerteilen }: AuswertungSeiteProps & { onVerteilen: () => void }) {
  const zeile = zeileRoh as AufnahmeR5
  const a = zeile.analyse
  const u = zeile.uebernommen
  const [akte, setAkte] = useState<AkteKurz | null>(null)
  const [akteAendern, setAkteAendern] = useState(false)
  const [team, setTeam] = useState<TeamMitglied[]>([])
  const [ich, setIch] = useState('')

  const [zusammenfassung, setZusammenfassung] = useState(a?.zusammenfassung ?? '')
  const [schritteAn, setSchritteAn] = useState(true)
  const [schritte, setSchritte] = useState<Schritt[]>(() => (a?.naechste_schritte ?? []).map((s) => ({ text: s.text ?? '', wer: s.wer ?? '', faellig: alsDatum(s.faellig) })))
  const [wv, setWv] = useState<Wv[]>(() => (a?.wiedervorlagen ?? []).map((w) => ({ titel: w.titel ?? '', faellig: alsDatum(w.faellig), an: true })))
  const [todos, setTodos] = useState<Todo[]>(() => (a?.todos ?? []).map((t) => ({ text: t.text ?? '', faellig: alsDatum(t.faellig), zustaendig: t.zustaendig ?? '', email: '', emailGewaehlt: false, an: true })))
  const [termine, setTermine] = useState<Termin[]>(() => (a?.termine ?? []).map((t) => ({ titel: t.titel ?? '', datum: alsDatum(t.datum), uhrzeit: alsUhrzeit(t.uhrzeit), dauer_min: 60, ort: t.ort ?? '', mit: t.mit ?? '', an: true })))
  const [sd, setSd] = useState<Sd[]>(() => (a?.stammdaten ?? []).map((s) => ({ feld: s.feld, wert: s.wert ?? '', an: true })))
  const [mail, setMail] = useState({ betreff: a?.mail_entwurf?.betreff ?? '', text: a?.mail_entwurf?.text ?? '', an: !!(a?.mail_entwurf?.betreff || a?.mail_entwurf?.text) })
  const [fb, setFb] = useState<FbZeile[]>(() => fbStart(a?.fragebogen))
  const [fbAn, setFbAn] = useState(true)
  const [af, setAf] = useState<AfZeile[]>(() => afStart(a?.aktenfelder))
  const [audio, setAudio] = useState(false)
  const [fotosAn, setFotosAn] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [ergebnis, setErgebnis] = useState<UebernahmeErgebnis | null>(null)

  useEffect(() => {
    let aktiv = true
    if (zeile.kunde_id) ladeAkte(zeile.kunde_id).then((x) => aktiv && setAkte(x)).catch(() => {})
    else setAkte(null)
    return () => {
      aktiv = false
    }
  }, [zeile.kunde_id])

  useEffect(() => {
    let aktiv = true
    Promise.all([ladeTeam(), eigeneEmail()]).then(([t, e]) => {
      if (!aktiv) return
      setTeam(t)
      setIch(e)
      setTodos((liste) => liste.map((x) => (x.emailGewaehlt ? x : { ...x, email: passendesMitglied(x.zustaendig, t) || e })))
    }).catch(() => {})
    return () => {
      aktiv = false
    }
  }, [])

  if (!a) return <p className="text-sm text-slate-500">Ohne Auswertung gibt es nichts zu übernehmen.</p>
  if (zeile.status !== 'fertig') return <p className="text-sm text-slate-500">Übernehmen geht erst, wenn die Auswertung fertig ist.</p>

  const privat = (akte?.bereich ?? zeile.kunde_bereich) === 'privat'
  const aktenwert = (f: string): string => {
    const w = akte ? (akte as Record<string, unknown>)[f] : ''
    return Array.isArray(w) ? w.filter(Boolean).join(', ') : String(w ?? '').trim()
  }
  const fertig = (liste: Record<string, string> | undefined, i: number) => !!liste?.[String(i)]
  const protokollFertig = !!u?.protokollId
  const fehlendeDaten = wv.some((w, i) => w.an && !fertig(u?.wiedervorlagen, i) && (!w.titel.trim() || !w.faellig)) || termine.some((t, i) => t.an && !fertig(u?.termine, i) && (!t.titel.trim() || !t.datum))

  async function abschicken() {
    setLaeuft(true)
    setFehler('')
    setErgebnis(null)
    try {
      const nimm = <T extends { an: boolean }>(liste: T[], schon?: Record<string, string>) => liste.map((x, i) => (x.an && !schon?.[String(i)] ? i : -1)).filter((i) => i >= 0)
      const r = await uebernehmen(
        id,
        {
          protokoll: true,
          naechsteSchritte: schritteAn && schritte.some((s) => s.text.trim()),
          wiedervorlagen: privat ? [] : nimm(wv, u?.wiedervorlagen),
          todos: nimm(todos, u?.todos),
          termine: nimm(termine, u?.termine),
          stammdaten: nimm(sd, u?.stammdaten),
          audioInAkte: audio,
          fotosInAkte: fotosAn,
          mailEntwurf: mail.an,
          fragebogen: fbAn && !u?.fragebogen && fb.some((x) => x.an && x.antwort.trim()),
          aktenfelder: privat ? [] : af.filter((x) => x.an && x.wert.trim() && !u?.aktenfelder?.[x.feld] && !aktenwert(x.feld)).map((x) => x.feld),
        },
        {
          zusammenfassung,
          naechste_schritte: schritte.filter((s) => s.text.trim()).map((s) => ({ text: s.text, wer: s.wer || undefined, faellig: s.faellig || undefined })),
          wiedervorlagen: wv.map((w) => ({ titel: w.titel, faellig: w.faellig })),
          todos: todos.map((t) => ({ text: t.text, faellig: t.faellig || undefined, zustaendig: t.email ? undefined : t.zustaendig || undefined, zustaendig_email: t.email || undefined })),
          termine: termine.map((t) => ({ titel: t.titel, datum: t.datum, uhrzeit: t.uhrzeit || undefined, ort: t.ort || undefined, mit: t.mit || undefined, dauer_min: t.dauer_min })),
          stammdaten: sd.map((s) => ({ feld: s.feld, wert: s.wert })),
          mail_entwurf: { betreff: mail.betreff, text: mail.text },
          ...(fb.length ? { fragebogen: fb.filter((x) => x.an && x.antwort.trim()).map(({ an: _an, ...x }) => x) } : {}),
          ...(af.length ? { aktenfelder: afAlsDaten(af.filter((x) => x.an)) } : {}),
        },
      )
      setErgebnis(r)
      neuLaden()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaeuft(false)
    }
  }


  return (
    <div className="space-y-3">
      {/* Mehrere Kunden in einer Aufnahme (z. B. Sprachnotiz der Geschäftsführung): auf mehrere Akten verteilen. */}
      <div className={`rounded-xl border p-3 ${zeile.kunde_id ? 'border-slate-200 bg-white' : 'border-indigo-200 bg-indigo-50'}`}>
        <p className="text-sm text-slate-700">
          {zeile.kunde_id ? 'Geht es in der Aufnahme um mehrere Kunden? Dann lässt sie sich auch aufteilen.' : 'Geht es in der Aufnahme um mehrere Kunden? Dann je Kunde in seine Akte verteilen statt einer Akte zuzuordnen.'}
        </p>
        <button onClick={onVerteilen} className="mt-2 w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700">Auf mehrere Akten verteilen</button>
      </div>

      {/* Akte */}
      {!zeile.kunde_id || akteAendern ? (
        <AkteZuordnen aufnahmeId={id} vorschlagName={(a.sprecher ?? []).find((s) => s.rolle === 'kunde')?.name} onFertig={() => { setAkteAendern(false); neuLaden() }} />
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
          <div>
            <div className="text-xs text-slate-500">Akte</div>
            <div className="font-medium text-slate-900">{akte ? akteAnzeige(akte) : 'wird geladen …'}</div>
            {akte && <div className="text-xs text-slate-500">{akte.bereich === 'privat' ? 'Privat' : BEREICH_NAMEN[akte.bereich] ?? akte.bereich}</div>}
          </div>
          {!protokollFertig && <button onClick={() => setAkteAendern(true)} className="text-sm text-indigo-600">Ändern</button>}
        </div>
      )}

      <Karte titel="Gesprächsprotokoll" an fest fertig={protokollFertig}>
        <textarea className={`${feld} min-h-[6rem]`} value={zusammenfassung} disabled={protokollFertig} onChange={(e) => setZusammenfassung(e.target.value)} />
        <p className="mt-1 text-xs text-slate-500">Mit Kernthemen, Vereinbarungen, offenen Punkten, Markierungen, Notizen und der Abschrift.</p>
      </Karte>

      {schritte.length > 0 && (
        <Karte titel="Nächste Schritte (ersetzt das Feld in der Akte)" an={schritteAn} setAn={setSchritteAn} fertig={!!u?.naechsteSchritte}>
          {schritte.map((s, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_auto] gap-2">
              <input className={`${feld} col-span-2`} value={s.text} disabled={!!u?.naechsteSchritte} onChange={(e) => setSchritte(aendere(schritte, i, { text: e.target.value }))} />
              <input className={feld} value={s.wer} placeholder="Wer" disabled={!!u?.naechsteSchritte} onChange={(e) => setSchritte(aendere(schritte, i, { wer: e.target.value }))} />
              <input type="date" className={feld} value={s.faellig} disabled={!!u?.naechsteSchritte} onChange={(e) => setSchritte(aendere(schritte, i, { faellig: e.target.value }))} />
            </div>
          ))}
        </Karte>
      )}

      {wv.map((w, i) => (
        <Karte key={`wv${i}`} titel="Wiedervorlage" an={w.an && !privat} setAn={privat ? undefined : (an) => setWv(aendere(wv, i, { an }))} fertig={fertig(u?.wiedervorlagen, i)}>
          {privat && <p className="mb-2 text-xs text-amber-700">Private Kontakte haben keine Wiedervorlagen — dafür ein To-do nehmen.</p>}
          <input className={feld} value={w.titel} disabled={fertig(u?.wiedervorlagen, i)} onChange={(e) => setWv(aendere(wv, i, { titel: e.target.value }))} />
          <input type="date" className={`${feld} mt-2`} value={w.faellig} disabled={fertig(u?.wiedervorlagen, i)} onChange={(e) => setWv(aendere(wv, i, { faellig: e.target.value }))} />
          {w.an && !w.faellig && !fertig(u?.wiedervorlagen, i) && <p className="mt-1 text-xs text-rose-700">Bitte ein Datum wählen.</p>}
        </Karte>
      ))}

      {todos.map((t, i) => (
        <Karte key={`td${i}`} titel="To-do" an={t.an} setAn={(an) => setTodos(aendere(todos, i, { an }))} fertig={fertig(u?.todos, i)}>
          <input className={feld} value={t.text} disabled={fertig(u?.todos, i)} onChange={(e) => setTodos(aendere(todos, i, { text: e.target.value }))} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className={feld} value={t.email} disabled={fertig(u?.todos, i)} onChange={(e) => setTodos(aendere(todos, i, { email: e.target.value, emailGewaehlt: true }))}>
              <option value={ich}>Ich</option>
              {team.filter((m) => m.email !== ich).map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
              {t.zustaendig && !passendesMitglied(t.zustaendig, team) && <option value="">{t.zustaendig} (in meiner Liste)</option>}
            </select>
            <input type="date" className={feld} value={t.faellig} disabled={fertig(u?.todos, i)} onChange={(e) => setTodos(aendere(todos, i, { faellig: e.target.value }))} />
          </div>
        </Karte>
      ))}

      {termine.map((t, i) => (
        <Karte key={`te${i}`} titel="Termin in meinem Kalender" an={t.an} setAn={(an) => setTermine(aendere(termine, i, { an }))} fertig={fertig(u?.termine, i)}>
          <input className={feld} value={t.titel} disabled={fertig(u?.termine, i)} onChange={(e) => setTermine(aendere(termine, i, { titel: e.target.value }))} />
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input type="date" className={`${feld} col-span-3 sm:col-span-1`} value={t.datum} disabled={fertig(u?.termine, i)} onChange={(e) => setTermine(aendere(termine, i, { datum: e.target.value }))} />
            <input type="time" className={feld} value={t.uhrzeit} disabled={fertig(u?.termine, i)} onChange={(e) => setTermine(aendere(termine, i, { uhrzeit: e.target.value }))} />
            <select className={`${feld} col-span-2 sm:col-span-1`} value={t.dauer_min} disabled={fertig(u?.termine, i) || !t.uhrzeit} onChange={(e) => setTermine(aendere(termine, i, { dauer_min: Number(e.target.value) }))}>
              {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} Min.` : `${m / 60} Std.`}</option>)}
            </select>
          </div>
          <input className={`${feld} mt-2`} value={t.ort} placeholder="Ort" disabled={fertig(u?.termine, i)} onChange={(e) => setTermine(aendere(termine, i, { ort: e.target.value }))} />
          {t.mit && <p className="mt-1 text-xs text-slate-500">Mit: {t.mit}</p>}
          {!t.uhrzeit && <p className="mt-1 text-xs text-slate-500">Ohne Uhrzeit wird es ein ganztägiger Eintrag.</p>}
          {t.an && !t.datum && !fertig(u?.termine, i) && <p className="mt-1 text-xs text-rose-700">Bitte ein Datum wählen.</p>}
        </Karte>
      ))}

      {sd.map((s, i) => {
        const bisher = ['telefon', 'email', 'anschrift'].includes(s.feld) ? aktenwert(s.feld) : ''
        const nurNotiz = !['telefon', 'email', 'anschrift'].includes(s.feld)
        return (
          <Karte key={`sd${i}`} titel={`Stammdaten: ${STAMMDATEN_NAME[s.feld] ?? s.feld}`} an={s.an} setAn={(an) => setSd(aendere(sd, i, { an }))} fertig={fertig(u?.stammdaten, i)}>
            <input className={feld} value={s.wert} disabled={fertig(u?.stammdaten, i)} onChange={(e) => setSd(aendere(sd, i, { wert: e.target.value }))} />
            <p className="mt-1 text-xs text-slate-500">
              {nurNotiz ? 'Kommt als Notiz in den Verlauf der Akte.' : bisher ? `In der Akte steht: ${bisher.replace(/\n/g, ', ')} — wird als Vorschlag in der Akte gezeigt, nichts wird überschrieben.` : 'Feld in der Akte ist leer — wird ergänzt.'}
            </p>
          </Karte>
        )
      })}

      {!privat && af.length > 0 && <AktenfelderKarten zeilen={af} setZeilen={setAf} akte={akte} erledigt={u?.aktenfelder} />}

      {!privat && fb.length > 0 && (
        <FragebogenKarte name={a.fragebogen_vorlage?.name ?? 'Fragebogen'} zeilen={fb} setZeilen={setFb} an={fbAn} setAn={setFbAn} fertig={!!u?.fragebogen} notiz={!!u?.fragebogen?.notiz} />
      )}

      {(a.mail_entwurf?.betreff || a.mail_entwurf?.text) && (
        <Karte titel="Mail-Entwurf als Notiz in die Akte" an={mail.an} setAn={(an) => setMail({ ...mail, an })} fertig={!!u?.mailEntwurf}>
          <input className={feld} value={mail.betreff} placeholder="Betreff" disabled={!!u?.mailEntwurf} onChange={(e) => setMail({ ...mail, betreff: e.target.value })} />
          <textarea className={`${feld} mt-2 min-h-[8rem]`} value={mail.text} disabled={!!u?.mailEntwurf} onChange={(e) => setMail({ ...mail, text: e.target.value })} />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-slate-500">Wird hier nicht verschickt — senden geht auf dem Reiter „Teilen“.</p>
            <button className="text-xs text-indigo-600" onClick={() => void navigator.clipboard?.writeText(`${mail.betreff}\n\n${mail.text}`).catch(() => {})}>Text kopieren</button>
          </div>
        </Karte>
      )}

      {(zeile.segmente ?? []).length > 0 && (
        <Schalter text="Ton der Aufnahme als Datei in der Akte ablegen" an={audio || !!u?.audio} gesperrt={!!u?.audio} setAn={setAudio} zusatz={u?.audio?.uebersprungen ? `Nicht abgelegt: ${u.audio.uebersprungen}` : u?.audio ? 'Liegt in der Akte.' : 'Sonst wird der Ton nach der Löschfrist gelöscht.'} />
      )}
      {(zeile.fotos ?? []).length > 0 && (
        <Schalter text="Fotos aus dem Gespräch in der Akte ablegen" an={fotosAn || !!u?.fotos} gesperrt={!!u?.fotos} setAn={setFotosAn} />
      )}

      {fehler && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{fehler}</p>}
      {ergebnis && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          {ergebnis.zeilen.map((z, i) => <p key={i}>{z}</p>)}
          {ergebnis.hinweise.map((h, i) => <p key={`h${i}`} className="mt-1 text-amber-800">{h}</p>)}
        </div>
      )}
      {!ergebnis && u?.hinweise && u.hinweise.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Beim letzten Übernehmen:</p>
          {u.hinweise.map((h, i) => <p key={i}>{h}</p>)}
        </div>
      )}

      <button
        onClick={abschicken}
        disabled={laeuft || !zeile.kunde_id || akteAendern || fehlendeDaten}
        className="sticky z-20 w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-lg disabled:opacity-50"
        style={UEBER_LEISTE}
      >
        {laeuft ? 'Wird übernommen …' : protokollFertig ? 'Ausgewähltes zusätzlich übernehmen' : 'Übernehmen'}
      </button>
      {!zeile.kunde_id && <p className="text-center text-xs text-slate-500">Zuerst eine Akte zuordnen.</p>}
    </div>
  )
}
