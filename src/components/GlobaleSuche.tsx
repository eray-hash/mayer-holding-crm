import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarClock,
  FileText,
  Handshake,
  Inbox,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  Search,
  Send,
  Users,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../data/kundenBereiche'
import { alsTsquery, ausschnittTeile } from '../../supabase/functions/_shared/sucheAnfrage.ts'

// Globale Suche (Cmd/Ctrl+K und Lupe in der Kopfzeile, siehe Layout.tsx).
//
// Zwei Stufen:
// 1. Sofort, ohne Server: Namen von Akten und Objekten aus dem schon geladenen App-Zustand (wie bisher;
//    der Zustand ist durch die Datenbankrechte bereits gefiltert).
// 2. Nach kurzer Tipp-Pause: Volltextsuche in der Datenbank (public.suche_alles) — Akten samt Verlauf,
//    Sachverhalt und nächsten Schritten, Inhalte gelesener Dokumente, Mails (gemeinsames und eigenes
//    Postfach), Gesprächsprotokolle, Objekte samt Exposé-Text, To-dos, Wiedervorlagen, Bücher, Partner.
//    Die Rechte setzt die Datenbank durch (Zeilenregeln des angemeldeten Mitarbeiters).
// Die Suchanfrage baut _shared/sucheAnfrage.ts (genau wie beim Assistenten): Wortanfänge, "Wortfolge",
// -ohne, ODER. Im Modus „Ansehen als“ gibt es nur Stufe 1 (die Datenbank würde mit den Rechten des
// Superusers antworten, nicht mit denen der angesehenen Person).

type Art = 'akte' | 'objekt' | 'dokument' | 'mail' | 'gesendet' | 'protokoll' | 'todo' | 'wiedervorlage' | 'buch' | 'partner'

type Treffer = {
  art: Art
  id: string
  titel: string
  untertitel: string
  ausschnitt: string | null
  ziel: string | null
  datum: string | null
  /** Nur aus dem App-Zustand (Namen), ohne Fundstelle */
  schnell?: boolean
}

const GRUPPEN: { art: Art; label: string; icon: ReactNode }[] = [
  { art: 'akte', label: 'Akten', icon: <Users size={14} /> },
  { art: 'objekt', label: 'Objekte', icon: <Building2 size={14} /> },
  { art: 'dokument', label: 'Dokumente', icon: <FileText size={14} /> },
  { art: 'mail', label: 'Empfangene Mails', icon: <Inbox size={14} /> },
  { art: 'gesendet', label: 'Gesendete Mails', icon: <Send size={14} /> },
  { art: 'protokoll', label: 'Gesprächsprotokolle', icon: <MessageSquareText size={14} /> },
  { art: 'todo', label: 'To-dos', icon: <ListTodo size={14} /> },
  { art: 'wiedervorlage', label: 'Wiedervorlagen', icon: <CalendarClock size={14} /> },
  { art: 'buch', label: 'Bücher', icon: <BookOpen size={14} /> },
  { art: 'partner', label: 'Partner', icon: <Handshake size={14} /> },
]

const GRENZE_JE_ART = 8
const PAUSE_MS = 250

function datumKurz(iso: string | null): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function Ausschnitt({ text }: { text: string }) {
  return (
    <>
      {ausschnittTeile(text).map((t, i) =>
        t.treffer ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-slate-900">
            {t.text}
          </mark>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  )
}

export function GlobaleSuche({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useApp()
  const { ansichtAls } = useAuth()
  const navigate = useNavigate()
  const [suche, setSuche] = useState('')
  const [serverTreffer, setServerTreffer] = useState<Treffer[] | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [aktiv, setAktiv] = useState(0)
  const [vorschau, setVorschau] = useState<Treffer | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const anfrageNr = useRef(0)

  const volltext = !!supabase && !ansichtAls
  const text = suche.trim()
  const anfrage = useMemo(() => alsTsquery(text), [text])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
    else {
      setSuche('')
      setServerTreffer(null)
      setFehler('')
      setVorschau(null)
      setAktiv(0)
    }
  }, [open])

  // Stufe 1: Namen aus dem App-Zustand (sofort)
  const schnelleTreffer = useMemo<Treffer[]>(() => {
    const t = text.toLowerCase()
    if (t.length < 2) return []
    const passt = (...felder: (string | undefined)[]) => felder.some((f) => f?.toLowerCase().includes(t))
    const aus: Treffer[] = []
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        if (passt(k.firma, k.ansprechpartner, k.email, k.telefon)) {
          aus.push({ art: 'akte', id: k.id, titel: k.firma || k.ansprechpartner || '(ohne Namen)', untertitel: [k.firma ? k.ansprechpartner : '', b.label].filter(Boolean).join(' · '), ausschnitt: null, ziel: kundeDetailPfad(b.id, k.id), datum: null, schnell: true })
        }
      }
    }
    for (const o of state.objekte) {
      if (passt(o.bezeichnung, o.adresse)) {
        aus.push({ art: 'objekt', id: o.id, titel: o.bezeichnung, untertitel: o.adresse, ausschnitt: null, ziel: `/immobilien/objekte/${o.id}`, datum: null, schnell: true })
      }
    }
    for (const o of state.privatObjekte ?? []) {
      if (passt(o.bezeichnung, o.adresse)) {
        aus.push({ art: 'objekt', id: o.id, titel: o.bezeichnung, untertitel: [o.adresse, 'privates Objekt'].filter(Boolean).join(' · '), ausschnitt: null, ziel: `/privat/immobilien/objekte/${o.id}`, datum: null, schnell: true })
      }
    }
    return aus.slice(0, 30)
  }, [state, text])

  // Stufe 2: Volltext in der Datenbank, nach einer Tipp-Pause; ältere Antworten werden verworfen.
  useEffect(() => {
    if (!open || !volltext) return
    const nr = ++anfrageNr.current
    if (!anfrage) {
      setServerTreffer(null)
      setLaeuft(false)
      setFehler('')
      return
    }
    setLaeuft(true)
    const zeitgeber = setTimeout(async () => {
      try {
        const { data, error } = await supabase!.rpc('suche_alles', { q: anfrage, grenze: GRENZE_JE_ART })
        if (nr !== anfrageNr.current) return
        if (error) throw new Error(error.message)
        setServerTreffer(
          ((data ?? []) as Record<string, unknown>[]).map((z) => ({
            art: String(z.art) as Art,
            id: String(z.id),
            titel: String(z.titel ?? ''),
            untertitel: String(z.untertitel ?? ''),
            ausschnitt: (z.ausschnitt as string | null) ?? null,
            ziel: (z.ziel as string | null) ?? null,
            datum: (z.datum as string | null) ?? null,
          })),
        )
        setFehler('')
      } catch {
        if (nr !== anfrageNr.current) return
        setServerTreffer(null)
        setFehler('Die Volltextsuche ist gerade nicht erreichbar — gezeigt werden nur Namen von Akten und Objekten.')
      } finally {
        if (nr === anfrageNr.current) setLaeuft(false)
      }
    }, PAUSE_MS)
    return () => clearTimeout(zeitgeber)
  }, [anfrage, open, volltext])

  // Gruppen: Server-Treffer zuerst, Namens-Treffer aus Stufe 1 ergänzen, was der Volltext nicht hat
  // (z. B. Wortteile mitten im Namen).
  const gruppen = useMemo(() => {
    const alle: Treffer[] = []
    const gesehen = new Set<string>()
    const nimm = (t: Treffer) => {
      const schluessel = `${t.art}:${t.id}`
      if (gesehen.has(schluessel)) return
      gesehen.add(schluessel)
      alle.push(t)
    }
    for (const t of serverTreffer ?? []) nimm(t)
    for (const t of schnelleTreffer) nimm(t)
    return GRUPPEN.map((g) => ({ ...g, treffer: alle.filter((t) => t.art === g.art), voll: (serverTreffer ?? []).filter((t) => t.art === g.art).length >= GRENZE_JE_ART })).filter(
      (g) => g.treffer.length > 0,
    )
  }, [serverTreffer, schnelleTreffer])

  const flach = useMemo(() => gruppen.flatMap((g) => g.treffer), [gruppen])

  useEffect(() => {
    setAktiv(0)
  }, [text])

  useEffect(() => {
    if (aktiv >= flach.length && flach.length > 0) setAktiv(flach.length - 1)
  }, [aktiv, flach.length])

  useEffect(() => {
    document.getElementById(`globale-suche-treffer-${aktiv}`)?.scrollIntoView({ block: 'nearest' })
  }, [aktiv])

  const oeffnen = useCallback(
    (t: Treffer) => {
      if (t.art === 'mail' || t.art === 'gesendet') {
        setVorschau(t)
        return
      }
      if (!t.ziel) return
      navigate(t.ziel)
      onClose()
    },
    [navigate, onClose],
  )

  // Tasten auf Dokumentebene (wie Modal in ui.tsx): Esc wirkt auch, wenn der Fokus nicht im Feld liegt.
  // Pfeile/Eingabetaste nur, wenn kein Knopf den Fokus hat (sonst öffnete Enter doppelt).
  const tastenStand = useRef({ flach, aktiv, vorschau, oeffnen, onClose })
  tastenStand.current = { flach, aktiv, vorschau, oeffnen, onClose }
  useEffect(() => {
    if (!open) return
    function taste(e: KeyboardEvent) {
      const st = tastenStand.current
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (st.vorschau) setVorschau(null)
        else st.onClose()
        return
      }
      if (st.vorschau) return
      const ziel = e.target as HTMLElement | null
      if (ziel && ziel.tagName === 'BUTTON') return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAktiv((a) => (st.flach.length ? (a + 1) % st.flach.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAktiv((a) => (st.flach.length ? (a - 1 + st.flach.length) % st.flach.length : 0))
      } else if (e.key === 'Enter' && !e.isComposing) {
        const t = st.flach[st.aktiv]
        if (t) {
          e.preventDefault()
          st.oeffnen(t)
        }
      }
    }
    document.addEventListener('keydown', taste, true)
    return () => document.removeEventListener('keydown', taste, true)
  }, [open])

  if (!open) return null

  const kurz = text.length < 2
  const ohneAnfrage = !kurz && !anfrage
  let laufendeNr = 0

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 backdrop-blur-[1px] sm:items-start sm:p-4 sm:pt-16" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Suche"
        className="flex h-full w-full flex-col bg-white shadow-xl ring-1 ring-slate-200 sm:h-auto sm:max-h-[80vh] sm:max-w-2xl sm:rounded-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {vorschau ? (
          <MailVorschau
            treffer={vorschau}
            onZurueck={() => {
              setVorschau(null)
              setTimeout(() => inputRef.current?.focus(), 0)
            }}
            onOeffnen={(ziel) => {
              navigate(ziel)
              onClose()
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
              <Search size={16} className="flex-shrink-0 text-slate-400" />
              <input
                ref={inputRef}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                placeholder="Suchen in Akten, Dokumenten, Mails, Protokollen …"
                className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none sm:text-sm"
                role="combobox"
                aria-expanded={flach.length > 0}
                aria-controls="globale-suche-liste"
                aria-activedescendant={flach.length ? `globale-suche-treffer-${aktiv}` : undefined}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
              />
              {laeuft && <LoaderCircle size={16} className="flex-shrink-0 animate-spin text-slate-400" aria-label="Sucht" />}
              <button onClick={onClose} className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Schließen">
                <X size={18} />
              </button>
            </div>

            <div id="globale-suche-liste" role="listbox" aria-label="Treffer" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              {kurz && (
                <div className="space-y-2 px-2 py-3 text-sm text-slate-500">
                  <p>
                    {volltext
                      ? 'Sucht in Akten (auch Verlauf und Sachverhalt), Inhalten von Dokumenten, Mails, Gesprächsprotokollen, Objekten, To-dos, Wiedervorlagen, Büchern und Partnern. Mindestens 2 Zeichen.'
                      : 'Sucht in den Namen von Akten und Objekten. Mindestens 2 Zeichen.'}
                  </p>
                  {volltext && (
                    <p className="text-xs text-slate-400">
                      Tipps: Wortanfänge genügen („Müll“ findet „Müller“) · "in Anführungszeichen" = genau diese Wortfolge · -wort schließt aus · ODER zwischen zwei Begriffen
                    </p>
                  )}
                  {ansichtAls && <p className="text-xs text-slate-400">Im Modus „Ansehen als“ gibt es nur die Namenssuche.</p>}
                </div>
              )}
              {!kurz && fehler && <p className="px-2 py-2 text-xs text-amber-700">{fehler}</p>}
              {!kurz && flach.length === 0 && !laeuft && (serverTreffer !== null || !volltext || ohneAnfrage) && (
                <p className="px-2 py-3 text-sm text-slate-400">Keine Treffer.</p>
              )}
              {!kurz &&
                gruppen.map((g) => (
                  <div key={g.art} className="mb-2" role="group" aria-label={g.label}>
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {g.icon}
                      <span>{g.label}</span>
                      <span className="font-normal normal-case tracking-normal">({g.treffer.length}{g.voll ? '+' : ''})</span>
                    </div>
                    {g.treffer.map((t) => {
                      const nr = laufendeNr++
                      const istAktiv = nr === aktiv
                      return (
                        <button
                          key={`${t.art}:${t.id}`}
                          id={`globale-suche-treffer-${nr}`}
                          role="option"
                          aria-selected={istAktiv}
                          onClick={() => oeffnen(t)}
                          onMouseMove={() => {
                            if (!istAktiv) setAktiv(nr)
                          }}
                          className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${istAktiv ? 'bg-accent-50 ring-1 ring-accent-100' : 'hover:bg-slate-50'}`}
                        >
                          <span className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{t.titel}</span>
                            {t.datum && <span className="flex-shrink-0 text-xs text-slate-400">{datumKurz(t.datum)}</span>}
                          </span>
                          {t.untertitel && <span className="block truncate text-xs text-slate-500">{t.untertitel}</span>}
                          {t.ausschnitt && (
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-600">
                              <Ausschnitt text={t.ausschnitt} />
                            </span>
                          )}
                        </button>
                      )
                    })}
                    {g.voll && <p className="px-3 pt-0.5 text-[11px] text-slate-400">Es gibt vielleicht mehr — Suche genauer fassen.</p>}
                  </div>
                ))}
            </div>

            <div className="hidden items-center gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 sm:flex">
              <span>↑ ↓ auswählen</span>
              <span>Eingabetaste öffnen</span>
              <span>Esc schließen</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Vorschau einer Mail (das Postfach hat keinen direkten Link auf eine einzelne Mail). Gelesen wird mit den
// Rechten des Mitarbeiters; private Mails anderer gibt es für ihn nicht.
type MailDaten = { betreff: string; wer: string; datum: string | null; text: string }

function MailVorschau({ treffer, onZurueck, onOeffnen }: { treffer: Treffer; onZurueck: () => void; onOeffnen: (ziel: string) => void }) {
  const [daten, setDaten] = useState<MailDaten | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktuell = true
    async function laden() {
      if (!supabase) return
      try {
        if (treffer.art === 'mail') {
          const { data, error } = await supabase
            .from('eingegangene_emails')
            .select('betreff, von, von_name, mail_datum, ausschnitt, plain:rohdaten->>plain')
            .eq('id', treffer.id)
            .maybeSingle()
          if (error) throw error
          if (!data) throw new Error('nicht gefunden')
          const z = data as Record<string, string | null>
          if (aktuell) setDaten({ betreff: z.betreff || '(ohne Betreff)', wer: z.von_name ? `${z.von_name} <${z.von ?? ''}>` : z.von ?? '', datum: z.mail_datum, text: z.plain || z.ausschnitt || '' })
        } else {
          const { data, error } = await supabase.from('gesendete_emails').select('betreff, an, an_name, gesendet_am, text').eq('id', treffer.id).maybeSingle()
          if (error) throw error
          if (!data) throw new Error('nicht gefunden')
          const z = data as Record<string, string | null>
          if (aktuell) setDaten({ betreff: z.betreff || '(ohne Betreff)', wer: `an ${z.an_name ? `${z.an_name} <${z.an ?? ''}>` : z.an ?? ''}`, datum: z.gesendet_am, text: z.text || '' })
        }
      } catch {
        if (aktuell) setFehler('Die Mail ließ sich nicht laden.')
      }
    }
    void laden()
    return () => {
      aktuell = false
    }
  }, [treffer])

  const zurAkte = treffer.ziel && treffer.ziel !== '/postfach' ? treffer.ziel : null

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <button onClick={onZurueck} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100" autoFocus>
          <ArrowLeft size={16} /> Zurück zu den Treffern
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {fehler && <p className="text-sm text-amber-700">{fehler}</p>}
        {!fehler && !daten && <p className="text-sm text-slate-400">Lädt …</p>}
        {daten && (
          <>
            <h3 className="text-base font-semibold text-slate-800">{daten.betreff}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {daten.wer}
              {daten.datum ? ` · ${datumKurz(daten.datum)}` : ''}
            </p>
            {treffer.ausschnitt && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                <Ausschnitt text={treffer.ausschnitt} />
              </p>
            )}
            <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{daten.text.slice(0, 20000)}</div>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {zurAkte && (
          <button onClick={() => onOeffnen(zurAkte)} className="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
            Zur Akte
          </button>
        )}
        <button onClick={() => onOeffnen('/postfach')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          Zum Postfach
        </button>
      </div>
    </>
  )
}
