// Gesprächsleitfaden während der Aufnahme: Fragebogen des Bereichs als abhakbare Liste.
//   Antippen      = gefragt (nur auf dem Gerät gemerkt, je Aufnahme)
//   Lange drücken = kurze Notiz zur Frage → Markierung {art:'frage', text:'<Frage>: <Notiz>'} (über onMarkieren,
//                   also den bestehenden Weg der Markierungen zum Server und in die Auswertung)
// Welcher Leitfaden benutzt wurde, steht als Markierung „Leitfaden: <Name> [<Vorlagen-id>]“ in der Aufnahme
// (gespraech_notiz kennt dafür kein Feld) — gesetzt bei der ersten Wahl bzw. dem ersten Haken.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, Circle, CircleCheck, LoaderCircle, MessageSquareText, X } from 'lucide-react'
import { merkeGewaehlt, setzeAnzeige, useAnzeige, useFortschritt, useLeitfaeden, zuletztGewaehlt } from './hilfeDaten'
import { frageMarkerText, leitfadenMarkerText, vorlagenBereich, vorschlag, type Leitfaden as LeitfadenTyp, type LeitfadenPunkt } from './leitfadenText'
import type { Thema } from './thema'
import type { GespraechArt } from '../typen'

const BEREICH_NAMEN: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}

const LANG_MS = 500

/** Antippen und langes Drücken auf derselben Zeile; Wischen (Scrollen) löst nichts aus. */
function useDruck(beiTippen: () => void, beiLang: () => void) {
  const uhr = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const warLang = useRef(false)
  const stopp = () => {
    if (uhr.current !== null) window.clearTimeout(uhr.current)
    uhr.current = null
  }
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      warLang.current = false
      start.current = { x: e.clientX, y: e.clientY }
      stopp()
      uhr.current = window.setTimeout(() => {
        warLang.current = true
        uhr.current = null
        try {
          navigator.vibrate?.(25)
        } catch {
          // ohne Vibration
        }
        beiLang()
      }, LANG_MS)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) stopp()
    },
    onPointerUp: stopp,
    onPointerCancel: stopp,
    onPointerLeave: stopp,
    onClick: () => {
      if (warLang.current) {
        warLang.current = false
        return
      }
      beiTippen()
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }
}

function Zeile({ p, gefragt, notiz, t, gross, umschalten, notieren }: { p: LeitfadenPunkt; gefragt: boolean; notiz?: string; t: Thema; gross: boolean; umschalten: () => void; notieren: () => void }) {
  const druck = useDruck(umschalten, notieren)
  return (
    <li>
      <button
        {...druck}
        aria-pressed={gefragt}
        className={`flex w-full select-none items-start gap-3 px-3 py-3 text-left ${gross ? 'min-h-[4rem]' : 'min-h-[3.5rem]'} ${p.unter ? 'pl-10' : ''} ${gefragt ? (t.dunkel ? 'bg-emerald-950/40' : 'bg-emerald-50') : ''}`}
        style={{ WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      >
        {gefragt ? <CircleCheck className={`mt-0.5 h-6 w-6 shrink-0 ${t.gut}`} /> : <Circle className={`mt-0.5 h-6 w-6 shrink-0 ${t.leise}`} />}
        <span className="min-w-0 flex-1">
          <span className={`block ${gefragt ? t.leise : t.text} ${gefragt ? 'line-through decoration-1' : ''}`}>{p.text}</span>
          {p.hinweis && <span className={`mt-0.5 block text-[0.85em] ${t.leise}`}>{p.hinweis}</span>}
          {notiz && (
            <span className={`mt-1 flex items-start gap-1.5 text-[0.9em] ${t.dunkel ? 'text-sky-300' : 'text-sky-700'}`}>
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" /> {notiz}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

export function Leitfaden({
  art,
  kundeBereich,
  objekt,
  lokalId,
  t,
  gross,
  onMarkieren,
}: {
  art: GespraechArt
  kundeBereich?: string
  /** Aufnahme gehört zu einem Objekt (ohne Kundenakte) */
  objekt: boolean
  lokalId: string | null
  t: Thema
  gross: boolean
  /** Setzt eine Markierung {art:'frage'} mit diesem Text zur aktuellen Aufnahmezeit. */
  onMarkieren: (text: string) => void
}) {
  const { liste, fehler } = useLeitfaeden()
  const { fortschritt, geladen, aendern } = useFortschritt(lokalId)
  const anzeige = useAnzeige()
  const [notizFuer, setNotizFuer] = useState<LeitfadenPunkt | null>(null)
  const [zu, setZu] = useState<Set<number>>(new Set())
  const markiertHier = useRef(new Set<string>())
  const bereich = vorlagenBereich(kundeBereich, objekt)
  const schrift = gross ? 'text-lg leading-relaxed' : 'text-[15px] leading-snug'

  const aktivId = useMemo(() => {
    if (!liste) return null
    if (fortschritt.leitfadenId !== undefined) return fortschritt.leitfadenId && liste.some((l) => l.id === fortschritt.leitfadenId) ? fortschritt.leitfadenId : null
    return vorschlag(liste, { bereich, art, zuletzt: zuletztGewaehlt(bereich, art) })
  }, [liste, fortschritt.leitfadenId, bereich, art])
  const aktiv = liste?.find((l) => l.id === aktivId) ?? null

  // Auswahl: eigener Bereich zuerst, dann die übrigen
  const gruppen = useMemo(() => {
    const m = new Map<string, LeitfadenTyp[]>()
    for (const l of liste ?? []) m.set(l.bereich, [...(m.get(l.bereich) ?? []), l])
    return [...m.entries()].sort(([a], [b]) => (a === bereich ? -1 : b === bereich ? 1 : a.localeCompare(b)))
  }, [liste, bereich])

  /** Hält fest, welcher Leitfaden benutzt wird (einmal je Aufnahme und Leitfaden). */
  function festhalten(l: LeitfadenTyp) {
    if (fortschritt.markiert.includes(l.id) || markiertHier.current.has(l.id)) return
    markiertHier.current.add(l.id)
    onMarkieren(leitfadenMarkerText(l))
    aendern((f) => ({ ...f, leitfadenId: f.leitfadenId === undefined ? l.id : f.leitfadenId, markiert: f.markiert.includes(l.id) ? f.markiert : [...f.markiert, l.id] }))
  }

  function waehlen(id: string) {
    const neu = id || null
    aendern((f) => ({ ...f, leitfadenId: neu }))
    merkeGewaehlt(bereich, art, neu)
    const l = liste?.find((x) => x.id === neu)
    if (l) festhalten(l)
  }

  function umschalten(p: LeitfadenPunkt) {
    if (aktiv) festhalten(aktiv)
    aendern((f) => ({ ...f, leitfadenId: f.leitfadenId === undefined ? aktivId : f.leitfadenId, gefragt: f.gefragt.includes(p.id) ? f.gefragt.filter((x) => x !== p.id) : [...f.gefragt, p.id] }))
  }

  function notizSpeichern(p: LeitfadenPunkt, text: string) {
    const notiz = text.trim()
    setNotizFuer(null)
    if (!notiz || notiz === fortschritt.notizen[p.id]) return
    if (aktiv) festhalten(aktiv)
    onMarkieren(frageMarkerText(p.text, notiz))
    aendern((f) => ({ ...f, leitfadenId: f.leitfadenId === undefined ? aktivId : f.leitfadenId, notizen: { ...f.notizen, [p.id]: notiz }, gefragt: f.gefragt.includes(p.id) ? f.gefragt : [...f.gefragt, p.id] }))
  }

  if (!liste || (lokalId && !geladen)) {
    return (
      <div className={`flex items-center gap-2 rounded-2xl border p-4 ${t.karte} ${t.leise} ${schrift}`}>
        <LoaderCircle className="h-5 w-5 animate-spin" /> Leitfäden werden geladen …
      </div>
    )
  }

  const gefragt = new Set(fortschritt.gefragt)
  const anzahlGefragt = aktiv ? aktiv.abschnitte.reduce((n, a) => n + a.punkte.filter((p) => gefragt.has(p.id)).length, 0) : 0

  return (
    <div className={`flex flex-col gap-2.5 ${schrift}`}>
      <div className={`rounded-2xl border p-3 ${t.karte}`}>
        <label className={`mb-1 block text-[0.8em] font-medium ${t.leise}`} htmlFor="leitfaden-wahl">
          Leitfaden
        </label>
        <select id="leitfaden-wahl" value={aktivId ?? ''} onChange={(e) => waehlen(e.target.value)} className={`h-12 w-full rounded-xl border px-3 text-base outline-none ${t.eingabe}`}>
          <option value="">Kein Leitfaden</option>
          {gruppen.map(([b, ls]) => (
            <optgroup key={b} label={BEREICH_NAMEN[b] ?? b}>
              {ls.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.anzahl})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {fehler && liste.length === 0 && <p className={`mt-2 text-[0.85em] ${t.leise}`}>Die Fragebögen ließen sich nicht laden: {fehler}</p>}
        {!fehler && liste.length === 0 && <p className={`mt-2 text-[0.85em] ${t.leise}`}>Es gibt noch keine Fragebögen mit Text in den Vorlagen.</p>}
        {aktiv && (
          <div className="mt-2 flex items-center gap-2">
            <span className={`flex-1 text-[0.85em] ${t.leise}`}>
              {anzahlGefragt} von {aktiv.anzahl} gefragt · Antippen = gefragt, lange drücken = Notiz
            </span>
            <button onClick={() => setzeAnzeige({ nurOffen: !anzeige.nurOffen })} aria-pressed={anzeige.nurOffen} className={`h-10 shrink-0 rounded-full border px-3 text-sm font-medium ${anzeige.nurOffen ? t.knopfAktiv : t.knopf}`}>
              Nur offene
            </button>
          </div>
        )}
      </div>

      {!aktiv && liste.length > 0 && <div className={`px-1 ${t.leise}`}>Kein Leitfaden gewählt — oben einen Fragebogen auswählen, wenn er helfen soll.</div>}

      {aktiv?.abschnitte.map((a, i) => {
        const punkte = anzeige.nurOffen ? a.punkte.filter((p) => !gefragt.has(p.id)) : a.punkte
        if (punkte.length === 0 && anzeige.nurOffen) return null
        const erledigt = a.punkte.filter((p) => gefragt.has(p.id)).length
        const offen = !zu.has(i)
        return (
          <section key={`${aktiv.id}-${i}`} className={`overflow-hidden rounded-2xl border ${t.karte}`}>
            <button
              onClick={() => setZu((z) => {
                const n = new Set(z)
                if (n.has(i)) n.delete(i)
                else n.add(i)
                return n
              })}
              className="flex min-h-[3rem] w-full items-center gap-2 px-3 py-2 text-left"
              aria-expanded={offen}
            >
              <span className="min-w-0 flex-1">
                {a.ober && <span className={`block text-[0.75em] uppercase tracking-wide ${t.leise}`}>{a.ober}</span>}
                <span className={`block font-semibold ${t.text}`}>{a.titel}</span>
              </span>
              <span className={`shrink-0 text-[0.85em] tabular-nums ${erledigt === a.punkte.length ? t.gut : t.leise}`}>
                {erledigt}/{a.punkte.length}
              </span>
              {offen ? <ChevronDown className={`h-5 w-5 ${t.leise}`} /> : <ChevronRight className={`h-5 w-5 ${t.leise}`} />}
            </button>
            {offen && (
              <ul className={`divide-y border-t ${t.trenner}`}>
                {punkte.map((p) => (
                  <Zeile key={p.id} p={p} gefragt={gefragt.has(p.id)} notiz={fortschritt.notizen[p.id]} t={t} gross={gross} umschalten={() => umschalten(p)} notieren={() => setNotizFuer(p)} />
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {notizFuer && <NotizBlatt punkt={notizFuer} alt={fortschritt.notizen[notizFuer.id] ?? ''} t={t} onAbbrechen={() => setNotizFuer(null)} onSpeichern={(text) => notizSpeichern(notizFuer, text)} />}
    </div>
  )
}

/** Unten eingeblendetes Blatt für die Notiz zu einer Frage (über den Bedienknöpfen, mit großer Schrift). */
function NotizBlatt({ punkt, alt, t, onAbbrechen, onSpeichern }: { punkt: LeitfadenPunkt; alt: string; t: Thema; onAbbrechen: () => void; onSpeichern: (text: string) => void }) {
  const [text, setText] = useState(alt)
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onAbbrechen}>
      <div
        className={`rounded-t-3xl border-t p-4 ${t.leiste}`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start gap-2">
          <div className={`flex-1 text-base font-semibold ${t.text}`}>{punkt.text}</div>
          <button onClick={onAbbrechen} aria-label="Schließen" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${t.knopf}`}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={280}
          placeholder="Kurze Notiz, z. B. die Antwort des Kunden"
          className={`w-full rounded-xl border px-3 py-2 text-lg outline-none ${t.eingabe}`}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={onAbbrechen} className={`h-14 rounded-xl border text-base font-semibold ${t.knopf}`}>
            Abbrechen
          </button>
          <button onClick={() => onSpeichern(text)} disabled={!text.trim()} className="h-14 rounded-xl bg-sky-600 text-base font-semibold text-white disabled:opacity-40">
            Notiz speichern
          </button>
        </div>
      </div>
    </div>
  )
}
