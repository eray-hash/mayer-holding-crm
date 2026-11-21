import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Check, RotateCcw, Trash2, Share2, Upload, Download, ChevronDown, ArrowRightLeft, Bell, X, ListOrdered, Wand2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { call as gatewayCall, isEmailGatewayConfigured } from '../../lib/emailGateway'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton, EmptyState } from '../../components/ui'
import { uid, today, fmtDate, fmtEURCent, isOverdue } from '../../lib/dates'
import { CURRENT_USER } from '../../data/constants'
import { ALLE_BEREICHE } from '../../data/bereiche'
import type { ToDoEintrag, Bereich } from '../../types'
import { analysiereToDoDatei, toDoCsvText, zeitaufwandskosten } from '../../lib/todoExcelImport'
import type { ToDoImportVorschau, ToDoImportWert } from '../../lib/todoExcelImport'

// Zwei Arten von Listen teilen sich dieselbe Tabelle/Komponente:
// - Privat: eigene, isolierte Liste pro Mitarbeiter (RLS: besitzer_email), optional mit Lese-/
//   Schreibrecht an Kollegen freigebbar, mit Listen-Umschalter oben.
// - Bereich (z.B. Beratung, Erben, ...): geteilte Liste, für alle aktiven Mitarbeiter sichtbar und
//   bearbeitbar wie der Rest des jeweiligen Bereichs.
// Aufgaben lassen sich in beide Richtungen zwischen der eigenen privaten Liste und einer
// Bereichs-Liste verschieben ("Bereich zuweisen" / "In private Liste verschieben") — Nutzer-
// Entscheidung 2026-11-06. Standard-Sortierung ist die ursprüngliche Reihenfolge (reihenfolge-
// Spalte), nicht automatisch nach Prio — genau wie in der Excel-Vorlage.
function fmtStunden(minuten: number): string {
  return `${(minuten / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`
}

// Erinnerung per Telegram (todos.erinnern_um, verschickt vom Zeitplan im email-gateway, todoErinnerung.ts).
// Im Formular als Ortszeit des Browsers (Datum + Uhrzeit), gespeichert als ISO-Zeitpunkt.
function isoZuEingabe(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const zwei = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`
}

function erinnerungKurz(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Kleine Glocke mit Uhrzeit; ausgegraut, sobald die Erinnerung verschickt wurde. */
function ErinnerungsHinweis({ t }: { t: ToDoEintrag }) {
  if (!t.erinnernUm) return null
  const gesendet = !!t.erinnertAm
  return (
    <span
      title={gesendet ? `Erinnerung per Telegram gesendet am ${new Date(t.erinnertAm!).toLocaleString('de-DE')}` : 'Erinnerung per Telegram'}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap ${gesendet ? 'text-slate-300 line-through' : 'text-accent-700'}`}
    >
      <Bell size={11} />
      {erinnerungKurz(t.erinnernUm)}
    </span>
  )
}

// Automatische Priorisierung (Server, email-gateway/todoPriorisierung.ts): werktags morgens und bei neuen Aufgaben,
// dazu der Knopf „Jetzt priorisieren“. Von Hand gesetzte Prios (prioQuelle 'hand') bleiben.
function prioTitel(t: ToDoEintrag): string | undefined {
  if (t.prioQuelle === 'auto') return `Automatisch gesetzt${t.prioGrund ? `: ${t.prioGrund}` : ''}`
  if (t.prioQuelle === 'hand') return 'Von Hand gesetzt — bleibt bei der automatischen Priorisierung'
  return undefined
}

/** Prio mit kleinem grauen Zauberstab, wenn sie automatisch gesetzt wurde (Begründung im Hinweis beim Darüberfahren). */
function PrioAnzeige({ t, mitUnterPrio }: { t: ToDoEintrag; mitUnterPrio?: boolean }) {
  if (!t.prio) return null
  return (
    <span title={prioTitel(t)} className="inline-flex items-center gap-0.5">
      {t.prio}
      {mitUnterPrio && (t.unterPrio ?? '')}
      {t.prioQuelle === 'auto' && <Wand2 size={10} className="text-slate-400" aria-label="automatisch" />}
    </span>
  )
}

function exportiereCsv(liste: ToDoEintrag[], dateiname: string) {
  const blob = new Blob([toDoCsvText(liste)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.click()
  URL.revokeObjectURL(url)
}

type Mitarbeiterkurz = { name: string; email: string }
type Recht = 'eigentuemer' | 'lesen' | 'schreiben'
type Sortierung = 'reihenfolge' | 'prio' | 'faellig'
type Scope = { kind: 'privat' } | { kind: 'bereich'; bereich: Bereich; label: string }

export function ToDoListe() {
  return <ToDoListeKern scope={{ kind: 'privat' }} />
}

export function BereichToDoListe({ bereich, label }: { bereich: Bereich; label: string }) {
  return <ToDoListeKern scope={{ kind: 'bereich', bereich, label }} />
}

function ToDoListeKern({ scope }: { scope: Scope }) {
  const { state, dispatch, neuLaden } = useApp()
  const { session, mitarbeiter } = useAuth()
  const eigeneEmail = (isSupabaseConfigured && session?.user.email) || 'lokal'
  const eigenerName = mitarbeiter?.name ?? CURRENT_USER

  const [ansicht, setAnsicht] = useState<'offen' | 'erledigt'>('offen')
  const [sortierung, setSortierung] = useState<Sortierung>('reihenfolge')
  const [aktiveListe, setAktiveListe] = useState<string>(eigeneEmail)
  const [addOpen, setAddOpen] = useState(false)
  const [editEintrag, setEditEintrag] = useState<ToDoEintrag | null>(null)
  const [freigabenOpen, setFreigabenOpen] = useState(false)
  const [alleMitarbeiter, setAlleMitarbeiter] = useState<Mitarbeiterkurz[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importVorschau, setImportVorschau] = useState<{ dateiname: string; vorschau?: ToDoImportVorschau; fehler?: string } | null>(null)
  const [priorisierung, setPriorisierung] = useState<{ laeuft: boolean; meldung?: string; fehler?: boolean }>({ laeuft: false })

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('mitarbeiter')
      .select('name, email')
      .eq('aktiv', true)
      .order('name')
      .then(({ data }) => setAlleMitarbeiter(data ?? []))
  }, [])

  const namenNachEmail = useMemo(() => {
    const map = new Map(alleMitarbeiter.map((m) => [m.email, m.name]))
    map.set(eigeneEmail, eigenerName)
    return map
  }, [alleMitarbeiter, eigeneEmail, eigenerName])

  // Nur relevant im Privat-Scope: eigene Liste + alle Listen, die mir freigegeben wurden.
  const verfuegbareListen = useMemo(() => {
    if (scope.kind !== 'privat') return []
    const fremde = state.todoFreigaben
      .filter((f) => f.empfaengerEmail === eigeneEmail)
      .map((f) => ({ besitzerEmail: f.besitzerEmail, recht: f.recht as Recht }))
    return [{ besitzerEmail: eigeneEmail, recht: 'eigentuemer' as Recht }, ...fremde]
  }, [scope, state.todoFreigaben, eigeneEmail])

  const meinRecht: Recht = scope.kind === 'bereich' ? 'eigentuemer' : verfuegbareListen.find((l) => l.besitzerEmail === aktiveListe)?.recht ?? 'lesen'
  const darfSchreiben = meinRecht === 'eigentuemer' || meinRecht === 'schreiben'
  const darfLoeschen = scope.kind === 'bereich' ? true : meinRecht === 'eigentuemer'

  const listenEintraege = useMemo(
    () => (scope.kind === 'bereich' ? state.todos.filter((t) => t.bereich === scope.bereich) : state.todos.filter((t) => !t.bereich && t.besitzerEmail === aktiveListe)),
    [state.todos, scope, aktiveListe],
  )
  const offen = useMemo(() => listenEintraege.filter((t) => !t.erledigtAm), [listenEintraege])
  const erledigt = useMemo(() => listenEintraege.filter((t) => t.erledigtAm), [listenEintraege])

  const sortiere = (liste: ToDoEintrag[]) =>
    [...liste].sort((a, b) => {
      if (sortierung === 'prio') {
        const prioA = a.prio ?? ''
        const prioB = b.prio ?? ''
        if (prioA !== prioB) return prioA.localeCompare(prioB)
        return (a.unterPrio ?? 99) - (b.unterPrio ?? 99)
      }
      if (sortierung === 'faellig') {
        // Früheste Frist zuerst, Aufgaben ohne Frist ans Ende; bei Gleichstand die gewohnte Reihenfolge.
        const bisA = a.erledigenBis || '9999-99-99'
        const bisB = b.erledigenBis || '9999-99-99'
        if (bisA !== bisB) return bisA.localeCompare(bisB)
        return (a.reihenfolge ?? 99999) - (b.reihenfolge ?? 99999)
      }
      if (ansicht === 'erledigt') return (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? '')
      return (a.reihenfolge ?? 99999) - (b.reihenfolge ?? 99999)
    })

  const sichtbar = sortiere(ansicht === 'offen' ? offen : erledigt)

  // Summen über die gerade angezeigten Aufgaben. Kosten zählen nur, wo Ist-Zeit UND Stundensatz stehen —
  // wie viele Aufgaben mit Ist-Zeit deshalb fehlen, wird daneben ausgewiesen statt verschwiegen.
  const summeIstMinuten = sichtbar.reduce((s, t) => s + (t.istZeit ?? 0), 0)
  const summeKosten = sichtbar.reduce((s, t) => s + (zeitaufwandskosten(t) ?? 0), 0)
  const ohneStundensatz = sichtbar.filter((t) => t.istZeit && zeitaufwandskosten(t) === undefined).length
  const ueberfaelligAnzahl = offen.filter((t) => isOverdue(t.erledigenBis ?? '', false)).length

  // Knopf nur für Listen, die die Automatik auch bearbeitet: Bereichslisten und die eigene private Liste.
  const darfPriorisieren = isSupabaseConfigured && isEmailGatewayConfigured && darfSchreiben && (scope.kind === 'bereich' || aktiveListe === eigeneEmail)

  async function jetztPriorisieren() {
    setPriorisierung({ laeuft: true })
    try {
      const r = await gatewayCall({ action: 'todos_priorisieren', ...(scope.kind === 'bereich' ? { bereich: scope.bereich } : { privat: true }) })
      await neuLaden().catch(() => undefined)
      const meldung = r?.gelaufen
        ? r.geaendert === 0
          ? 'Priorisiert — die Reihenfolge passt schon.'
          : `Priorisiert — ${r.geaendert} ${r.geaendert === 1 ? 'Aufgabe' : 'Aufgaben'} neu eingeordnet.`
        : `Nichts zu tun: ${r?.grund ?? 'keine offenen Aufgaben'}.`
      setPriorisierung({ laeuft: false, meldung })
    } catch (err) {
      setPriorisierung({ laeuft: false, meldung: err instanceof Error ? err.message : 'Priorisieren hat nicht geklappt.', fehler: true })
    }
  }

  function naechsteReihenfolge() {
    return 1 + Math.max(0, ...listenEintraege.map((t) => t.reihenfolge ?? 0))
  }

  function erledigen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: today() } })
  }
  function wiederOeffnen(t: ToDoEintrag) {
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { erledigtAm: undefined } })
  }
  function loeschen(t: ToDoEintrag) {
    if (confirm(`"${t.aufgabe}" wirklich löschen?`)) dispatch({ type: 'DELETE_TODO', id: t.id })
  }
  function naechsteReihenfolgeFuer(ziel: ToDoEintrag[]) {
    return 1 + Math.max(0, ...ziel.map((t) => t.reihenfolge ?? 0))
  }
  function bereichZuweisen(t: ToDoEintrag, bereich: Bereich) {
    const ziel = state.todos.filter((x) => x.bereich === bereich)
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { bereich, reihenfolge: naechsteReihenfolgeFuer(ziel) } })
  }
  function inPrivateListeVerschieben(t: ToDoEintrag) {
    const ziel = state.todos.filter((x) => !x.bereich && x.besitzerEmail === eigeneEmail)
    dispatch({ type: 'UPDATE_TODO', id: t.id, patch: { bereich: undefined, besitzerEmail: eigeneEmail, reihenfolge: naechsteReihenfolgeFuer(ziel) } })
  }

  // Import in zwei Schritten: Datei lesen und Vorschau zeigen, übernommen wird erst nach dem Klick.
  function importDatei(datei: File) {
    datei
      .arrayBuffer()
      .then((buffer) => setImportVorschau({ dateiname: datei.name, vorschau: analysiereToDoDatei(buffer, datei.name, today()) }))
      .catch(() => setImportVorschau({ dateiname: datei.name, fehler: 'Die Datei ließ sich nicht lesen. Bitte als Excel-Datei (.xlsx) oder als CSV-Datei speichern und erneut wählen.' }))
  }

  function importUebernehmen(eintraege: ToDoImportWert[]) {
    let n = naechsteReihenfolge()
    for (const eintrag of eintraege) {
      dispatch({
        type: 'ADD_TODO',
        todo: {
          ...eintrag,
          id: uid('todo'),
          besitzerEmail: eigeneEmail,
          bereich: scope.kind === 'bereich' ? scope.bereich : undefined,
          reihenfolge: n++,
          erstelltAm: today(),
        },
      })
    }
    setImportVorschau(null)
  }

  const titel = scope.kind === 'bereich' ? `To-Do-Liste — ${scope.label}` : 'To-Do-Liste'
  const dateiname = scope.kind === 'bereich' ? `todo-liste-${scope.bereich}.csv` : `todo-liste-${aktiveListe}.csv`

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{titel}</h1>
          <p className="text-sm text-slate-500">
            {offen.length} offen · {erledigt.length} erledigt
            {ueberfaelligAnzahl > 0 && <span className="font-medium text-rose-600"> · {ueberfaelligAnzahl} überfällig</span>}
            {scope.kind === 'bereich' && ' · für alle Mitarbeiter sichtbar'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope.kind === 'privat' && verfuegbareListen.length > 1 && (
            <div className="relative">
              <select
                value={aktiveListe}
                onChange={(e) => setAktiveListe(e.target.value)}
                className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium"
              >
                {verfuegbareListen.map((l) => (
                  <option key={l.besitzerEmail} value={l.besitzerEmail}>
                    {l.besitzerEmail === eigeneEmail ? 'Meine Liste' : `Liste von ${namenNachEmail.get(l.besitzerEmail) ?? l.besitzerEmail}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          )}
          <select value={sortierung} onChange={(e) => setSortierung(e.target.value as Sortierung)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="reihenfolge">Reihenfolge (wie Excel)</option>
            <option value="prio">Nach Priorität</option>
            <option value="faellig">Nach Frist (Erledigen bis)</option>
          </select>
          {scope.kind === 'privat' && aktiveListe === eigeneEmail && isSupabaseConfigured && (
            <SecondaryButton onClick={() => setFreigabenOpen(true)}>
              <Share2 size={14} /> Freigeben
            </SecondaryButton>
          )}
          {darfSchreiben && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const datei = e.target.files?.[0]
                  // Zurücksetzen, damit dieselbe Datei nach "Abbrechen" erneut gewählt werden kann.
                  e.target.value = ''
                  if (datei) importDatei(datei)
                }}
              />
              <SecondaryButton onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> Excel importieren
              </SecondaryButton>
            </>
          )}
          {darfPriorisieren && (
            <SecondaryButton onClick={jetztPriorisieren} disabled={priorisierung.laeuft}>
              <ListOrdered size={14} /> {priorisierung.laeuft ? 'Priorisiere …' : 'Jetzt priorisieren'}
            </SecondaryButton>
          )}
          <SecondaryButton onClick={() => exportiereCsv(sichtbar, dateiname)}>
            <Download size={14} /> Export
          </SecondaryButton>
          {darfSchreiben && (
            <PrimaryButton onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Neue Aufgabe
            </PrimaryButton>
          )}
        </div>
      </div>

      {darfPriorisieren && (
        <p className={`-mt-3 mb-4 text-xs ${priorisierung.fehler ? 'text-rose-600' : 'text-slate-400'}`}>
          {priorisierung.meldung ??
            'Prio und Reihenfolge stellt das CRM werktags morgens und bei neuen Aufgaben automatisch ein. Von Hand gesetzte Prios bleiben.'}
        </p>
      )}

      <div className="mb-4 flex rounded-lg border border-slate-200 bg-white p-0.5 w-fit">
        <button
          onClick={() => setAnsicht('offen')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${ansicht === 'offen' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
        >
          Offen
        </button>
        <button
          onClick={() => setAnsicht('erledigt')}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${ansicht === 'erledigt' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}
        >
          Erledigt
        </button>
      </div>

      {/* Unter sm: Karten statt der 15-spaltigen Excel-Tabelle — auf Handy-Breite ist die
          Tabelle selbst mit sticky Spalten kaum benutzbar (zu viel horizontales Scrollen für
          Felder wie "Nächste Schritte"). Zeigt die wichtigsten Felder, Rest per Tap im Modal. */}
      <div className="space-y-2 sm:hidden">
        {sichtbar.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <button onClick={() => setEditEintrag(t)} className="block w-full text-left">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800">{t.aufgabe}</p>
                {t.prio && (
                  <span className="flex-shrink-0 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700">
                    <PrioAnzeige t={t} mitUnterPrio />
                  </span>
                )}
              </div>
              {(t.kundeProjekt || t.zustaendig) && (
                <p className="mt-0.5 text-xs text-slate-500">{[t.kundeProjekt, t.zustaendig].filter(Boolean).join(' · ')}</p>
              )}
              {t.wartenAuf && <p className="mt-0.5 text-xs text-amber-700">Warten auf: {t.wartenAuf}</p>}
              {(t.startDatum || t.geplanteWiedervorlage || t.erledigenBis || t.erinnernUm || zeitaufwandskosten(t) !== undefined || (ansicht === 'erledigt' && t.erledigtAm)) && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  {t.startDatum && <span>Start: {t.startDatum}</span>}
                  {t.erledigenBis && (
                    <span className={isOverdue(t.erledigenBis, !!t.erledigtAm) ? 'font-medium text-rose-600' : ''}>
                      Erledigen bis: {fmtDate(t.erledigenBis)}
                      {isOverdue(t.erledigenBis, !!t.erledigtAm) && ' · überfällig'}
                    </span>
                  )}
                  <ErinnerungsHinweis t={t} />
                  {t.geplanteWiedervorlage && <span>Wiedervorlage: {t.geplanteWiedervorlage}</span>}
                  {zeitaufwandskosten(t) !== undefined && <span>Zeitkosten: {fmtEURCent(zeitaufwandskosten(t)!)}</span>}
                  {ansicht === 'erledigt' && t.erledigtAm && <span>Erledigt: {t.erledigtAm}</span>}
                </div>
              )}
            </button>
            <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-2">
              {darfSchreiben && scope.kind === 'privat' && <BereichZuweisenDropdown onWaehlen={(b) => bereichZuweisen(t, b)} />}
              {darfSchreiben && scope.kind === 'bereich' && (
                <button onClick={() => inPrivateListeVerschieben(t)} title="In meine private Liste verschieben" className="rounded-md bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200">
                  <ArrowRightLeft size={14} />
                </button>
              )}
              {darfSchreiben &&
                (ansicht === 'offen' ? (
                  <button onClick={() => erledigen(t)} title="Als erledigt markieren" className="rounded-md bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100">
                    <Check size={14} />
                  </button>
                ) : (
                  <button onClick={() => wiederOeffnen(t)} title="Wieder öffnen" className="rounded-md bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100">
                    <RotateCcw size={14} />
                  </button>
                ))}
              {darfLoeschen && (
                <button onClick={() => loeschen(t)} title="Löschen" className="rounded-md bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {sichtbar.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10">
            <EmptyState text={ansicht === 'offen' ? 'Keine offenen Aufgaben.' : 'Noch keine Aufgabe erledigt.'} />
          </div>
        )}
      </div>

      {/* overflow-x-auto + sticky erste Spalten, damit Start/Prio/Unter beim Scrollen nach rechts
          sichtbar bleiben (Beschwerde: "dann sind die Prios weg"). Ab sm sichtbar — darunter
          übernimmt die Karten-Ansicht oben. */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-3 w-[90px]">Start</th>
              <th className="sticky left-[90px] z-10 bg-slate-50 px-3 py-3 w-[56px]">Prio</th>
              <th className="sticky left-[146px] z-10 border-r border-slate-200 bg-slate-50 px-3 py-3 w-[56px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Unter</th>
              <th className="px-3 py-3 whitespace-nowrap">Kunde/Projekt</th>
              <th className="px-3 py-3 whitespace-nowrap">Aufgabe</th>
              <th className="px-3 py-3 whitespace-nowrap">Erledigen bis</th>
              <th className="px-3 py-3 whitespace-nowrap">Warten auf</th>
              <th className="px-3 py-3 whitespace-nowrap">Abt.</th>
              <th className="px-3 py-3 whitespace-nowrap">Aktueller Stand</th>
              <th className="px-3 py-3 whitespace-nowrap">Welche Fragen</th>
              <th className="px-3 py-3 whitespace-nowrap">Nächste Schritte</th>
              <th className="px-3 py-3 whitespace-nowrap">Zuständig</th>
              <th className="px-3 py-3 whitespace-nowrap">Geplante Zeit</th>
              <th className="px-3 py-3 whitespace-nowrap">Ist-Zeit</th>
              <th className="px-3 py-3 whitespace-nowrap">Zeitkosten</th>
              <th className="px-3 py-3 whitespace-nowrap">Umsatz</th>
              <th className="px-3 py-3 whitespace-nowrap">Wiedervorlage</th>
              {ansicht === 'erledigt' && <th className="px-3 py-3 whitespace-nowrap">Erledigt am</th>}
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((t) => {
              const ueberfaellig = isOverdue(t.erledigenBis ?? '', !!t.erledigtAm)
              const kosten = zeitaufwandskosten(t)
              return (
              <tr key={t.id} className="group border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                <td onClick={() => setEditEintrag(t)} className="sticky left-0 z-10 cursor-pointer whitespace-nowrap bg-white px-3 py-3 text-slate-500 group-hover:bg-slate-50">
                  {t.startDatum ?? ''}
                </td>
                <td onClick={() => setEditEintrag(t)} className="sticky left-[90px] z-10 cursor-pointer bg-white px-3 py-3 font-medium text-slate-700 group-hover:bg-slate-50">
                  <PrioAnzeige t={t} />
                </td>
                <td onClick={() => setEditEintrag(t)} className="sticky left-[146px] z-10 cursor-pointer border-r border-slate-100 bg-white px-3 py-3 text-slate-500 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-slate-50">
                  {t.unterPrio ?? ''}
                </td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-600">{t.kundeProjekt ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-800">{t.aufgabe}</td>
                <td onClick={() => setEditEintrag(t)} className={`cursor-pointer px-3 py-3 whitespace-nowrap ${ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                  {t.erledigenBis ? fmtDate(t.erledigenBis) : ''}
                  {ueberfaellig && ' · überfällig'}
                  {t.erinnernUm && (
                    <span className="block text-xs font-normal">
                      <ErinnerungsHinweis t={t} />
                    </span>
                  )}
                </td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-[12rem] text-slate-500">{t.wartenAuf ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.abteilung ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.aktuellerStand ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.welcheFragen ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 max-w-xs text-slate-500">{t.naechsteSchritte ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.zustaendig ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.geplanteZeit ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 text-slate-500">{t.istZeit ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{kosten !== undefined ? fmtEURCent(kosten) : ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.umsatzWert ?? ''}</td>
                <td onClick={() => setEditEintrag(t)} className="cursor-pointer px-3 py-3 whitespace-nowrap text-slate-500">{t.geplanteWiedervorlage ?? ''}</td>
                {ansicht === 'erledigt' && <td className="px-3 py-3 whitespace-nowrap text-slate-400">{t.erledigtAm}</td>}
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {darfSchreiben && scope.kind === 'privat' && (
                      <BereichZuweisenDropdown onWaehlen={(b) => bereichZuweisen(t, b)} />
                    )}
                    {darfSchreiben && scope.kind === 'bereich' && (
                      <button onClick={() => inPrivateListeVerschieben(t)} title="In meine private Liste verschieben" className="rounded-md bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200">
                        <ArrowRightLeft size={14} />
                      </button>
                    )}
                    {darfSchreiben && (ansicht === 'offen' ? (
                      <button onClick={() => erledigen(t)} title="Als erledigt markieren" className="rounded-md bg-emerald-50 p-1.5 text-emerald-600 hover:bg-emerald-100">
                        <Check size={14} />
                      </button>
                    ) : (
                      <button onClick={() => wiederOeffnen(t)} title="Wieder öffnen" className="rounded-md bg-amber-50 p-1.5 text-amber-600 hover:bg-amber-100">
                        <RotateCcw size={14} />
                      </button>
                    ))}
                    {darfLoeschen && (
                      <button onClick={() => loeschen(t)} title="Löschen" className="rounded-md bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
            {sichtbar.length === 0 && (
              <tr>
                <td colSpan={19} className="px-4 py-10">
                  <EmptyState text={ansicht === 'offen' ? 'Keine offenen Aufgaben.' : 'Noch keine Aufgabe erledigt.'} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sichtbar.length > 0 && (
        <p className="mt-2 px-1 text-xs text-slate-500">
          Ist-Zeit gesamt: <span className="font-medium text-slate-700">{fmtStunden(summeIstMinuten)}</span>
          {' · '}
          Zeitaufwandskosten gesamt: <span className="font-medium text-slate-700">{fmtEURCent(summeKosten)}</span>
          {ohneStundensatz > 0 && (
            <span className="text-slate-400">
              {' '}
              ({ohneStundensatz} {ohneStundensatz === 1 ? 'Aufgabe' : 'Aufgaben'} mit Ist-Zeit ohne Stundensatz nicht eingerechnet)
            </span>
          )}
        </p>
      )}

      {addOpen && (
        <ToDoModal
          titel="Neue Aufgabe"
          onClose={() => setAddOpen(false)}
          onSubmit={(eintrag) => {
            dispatch({
              type: 'ADD_TODO',
              todo: {
                ...eintrag,
                id: uid('todo'),
                besitzerEmail: scope.kind === 'bereich' ? eigeneEmail : aktiveListe,
                bereich: scope.kind === 'bereich' ? scope.bereich : undefined,
                reihenfolge: naechsteReihenfolge(),
                erstelltAm: today(),
              },
            })
            setAddOpen(false)
          }}
        />
      )}
      {editEintrag && (
        <ToDoModal
          titel="Aufgabe bearbeiten"
          initial={editEintrag}
          readOnly={!darfSchreiben}
          onClose={() => setEditEintrag(null)}
          onSubmit={(patch) => {
            dispatch({ type: 'UPDATE_TODO', id: editEintrag.id, patch })
            setEditEintrag(null)
          }}
        />
      )}
      {importVorschau && (
        <ImportVorschauModal
          dateiname={importVorschau.dateiname}
          vorschau={importVorschau.vorschau}
          fehler={importVorschau.fehler}
          onClose={() => setImportVorschau(null)}
          onUebernehmen={importUebernehmen}
        />
      )}
      {freigabenOpen && (
        <FreigabenModal
          besitzerEmail={eigeneEmail}
          alleMitarbeiter={alleMitarbeiter.filter((m) => m.email !== eigeneEmail)}
          onClose={() => setFreigabenOpen(false)}
        />
      )}
    </div>
  )
}

// Vorschau vor dem Import: je Tabellenblatt Anzahl der erkannten Aufgaben, welche Spalte in welches Feld
// geht und welche Spalten nicht übernommen werden. Erst der Knopf übernimmt die Aufgaben.
function ImportVorschauModal({
  dateiname,
  vorschau,
  fehler,
  onClose,
  onUebernehmen,
}: {
  dateiname: string
  vorschau?: ToDoImportVorschau
  fehler?: string
  onClose: () => void
  onUebernehmen: (eintraege: ToDoImportWert[]) => void
}) {
  const blaetter = vorschau?.blaetter ?? []
  const [auswahl, setAuswahl] = useState<Record<string, boolean>>(() => Object.fromEntries(blaetter.map((b) => [b.blatt, b.eintraege.length > 0])))
  const gewaehlt = blaetter.filter((b) => auswahl[b.blatt])
  const anzahl = gewaehlt.reduce((s, b) => s + b.eintraege.length, 0)
  const mehrere = blaetter.length > 1

  return (
    <Modal
      open
      onClose={onClose}
      title="Excel-Datei prüfen"
      width="max-w-2xl"
      aktionen={
        <>
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          {!fehler && (
            <PrimaryButton onClick={() => onUebernehmen(gewaehlt.flatMap((b) => b.eintraege))} disabled={anzahl === 0}>
              {anzahl === 1 ? '1 Aufgabe übernehmen' : `${anzahl} Aufgaben übernehmen`}
            </PrimaryButton>
          )}
        </>
      }
    >
      <p className="mb-3 break-words text-xs text-slate-500">{dateiname}</p>
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
      {!fehler && blaetter.length === 0 && (
        <p className="text-sm text-slate-600">Keine Aufgaben erkannt: In der Datei wurde keine Spalte „Aufgabe“ gefunden.</p>
      )}
      <div className="space-y-3">
        {blaetter.map((b) => (
          <div key={b.blatt} className={`rounded-lg border p-3 ${mehrere && !auswahl[b.blatt] ? 'border-slate-100 opacity-60' : 'border-slate-200'}`}>
            {mehrere && (
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={!!auswahl[b.blatt]}
                  disabled={b.eintraege.length === 0}
                  onChange={(e) => setAuswahl((a) => ({ ...a, [b.blatt]: e.target.checked }))}
                />
                <span className="break-words">Blatt „{b.blatt}“</span>
              </label>
            )}
            <p className="text-sm font-semibold text-slate-800">
              {b.eintraege.length === 1 ? '1 Aufgabe erkannt' : `${b.eintraege.length} Aufgaben erkannt`}
              <span className="font-normal text-slate-400">
                {' · '}
                {b.kopfVon === b.kopfBis ? `Überschrift in Zeile ${b.kopfVon}` : `Überschrift in Zeile ${b.kopfVon}–${b.kopfBis}`}
              </span>
            </p>

            <p className="mt-2 text-xs font-medium text-slate-500">Spalten zugeordnet:</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {b.zugeordnet.map((z) => (
                <li key={z.spalte + z.feld} className="max-w-full break-words rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  {z.spalte} → {z.feld}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-xs font-medium text-slate-500">Nicht zugeordnet (wird nicht übernommen):</p>
            {b.nichtUebernommen.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">keine</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {b.nichtUebernommen.map((n) => (
                  <li key={n.spalte} className="break-words text-xs text-slate-600">
                    <span className="font-medium">{n.spalte}</span> – {n.grund}
                  </li>
                ))}
              </ul>
            )}

            {b.hinweise.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {b.hinweise.map((h) => (
                  <li key={h} className="break-words text-xs text-amber-700">
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {b.eintraege.length > 0 && (
              <>
                <p className="mt-2 text-xs font-medium text-slate-500">Erste Aufgaben:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {b.eintraege.slice(0, 3).map((e, i) => (
                    <li key={i} className="break-words text-xs text-slate-700">
                      {e.aufgabe}
                      {e.erledigtAm && <span className="text-slate-400"> (erledigt)</span>}
                    </li>
                  ))}
                </ul>
                {b.eintraege.length > 3 && <p className="mt-0.5 text-xs text-slate-400">… und {b.eintraege.length - 3} weitere</p>}
              </>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

function BereichZuweisenDropdown({ onWaehlen }: { onWaehlen: (bereich: Bereich) => void }) {
  const [offen, setOffen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOffen((o) => !o)} title="Bereich zuweisen" className="rounded-md bg-accent-50 p-1.5 text-accent-700 hover:bg-accent-100">
        <ArrowRightLeft size={14} />
      </button>
      {offen && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" onClick={() => setOffen(false)} aria-label="Schließen" />
          <div className="absolute right-0 z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
            {ALLE_BEREICHE.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  onWaehlen(b.id)
                  setOffen(false)
                }}
                className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                {b.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FreigabenModal({ besitzerEmail, alleMitarbeiter, onClose }: { besitzerEmail: string; alleMitarbeiter: Mitarbeiterkurz[]; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const freigaben = state.todoFreigaben.filter((f) => f.besitzerEmail === besitzerEmail)

  function setRecht(empfaengerEmail: string, recht: '' | 'lesen' | 'schreiben') {
    if (!recht) {
      const bestehende = freigaben.find((f) => f.empfaengerEmail === empfaengerEmail)
      if (bestehende) dispatch({ type: 'DELETE_TODO_FREIGABE', id: bestehende.id })
      return
    }
    dispatch({ type: 'SET_TODO_FREIGABE', besitzerEmail, empfaengerEmail, recht })
  }

  return (
    <Modal open onClose={onClose} title="Meine To-Do-Liste freigeben">
      <p className="mb-3 text-sm text-slate-500">Wer Lesezugriff hat, sieht deine Liste nur. Wer Schreibzugriff hat, kann Aufgaben anlegen/bearbeiten — löschen kannst nur du.</p>
      <div className="space-y-2">
        {alleMitarbeiter.map((m) => {
          const aktuell = freigaben.find((f) => f.empfaengerEmail === m.email)?.recht ?? ''
          return (
            <div key={m.email} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm text-slate-700">{m.name}</span>
              <select
                value={aktuell}
                onChange={(e) => setRecht(m.email, e.target.value as '' | 'lesen' | 'schreiben')}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="">Kein Zugriff</option>
                <option value="lesen">Lesen</option>
                <option value="schreiben">Lesen & Schreiben</option>
              </select>
            </div>
          )
        })}
        {alleMitarbeiter.length === 0 && <EmptyState text="Keine weiteren Mitarbeiter gefunden." />}
      </div>
      <div className="mt-4 flex justify-end">
        <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
      </div>
    </Modal>
  )
}

type ToDoFormWert = Omit<ToDoEintrag, 'id' | 'besitzerEmail' | 'bereich' | 'reihenfolge' | 'erstelltAm'>

function ToDoModal({
  titel,
  initial,
  readOnly,
  onClose,
  onSubmit,
}: {
  titel: string
  initial?: ToDoEintrag
  readOnly?: boolean
  onClose: () => void
  onSubmit: (werte: ToDoFormWert) => void
}) {
  const [startDatum, setStartDatum] = useState(initial?.startDatum ?? '')
  const [prio, setPrio] = useState(initial?.prio ?? '')
  // Wer die Prio selbst ändert, setzt sie „von Hand“ — die Automatik lässt sie dann stehen. „Wieder automatisch“ gibt sie frei.
  const [prioQuelle, setPrioQuelle] = useState<ToDoEintrag['prioQuelle']>(initial?.prioQuelle)
  const [unterPrio, setUnterPrio] = useState(initial?.unterPrio?.toString() ?? '')
  const [kundeProjekt, setKundeProjekt] = useState(initial?.kundeProjekt ?? '')
  const [aufgabe, setAufgabe] = useState(initial?.aufgabe ?? '')
  const [abteilung, setAbteilung] = useState(initial?.abteilung ?? '')
  const [aktuellerStand, setAktuellerStand] = useState(initial?.aktuellerStand ?? '')
  const [welcheFragen, setWelcheFragen] = useState(initial?.welcheFragen ?? '')
  const [naechsteSchritte, setNaechsteSchritte] = useState(initial?.naechsteSchritte ?? '')
  const [zustaendig, setZustaendig] = useState(initial?.zustaendig ?? '')
  const [geplanteZeit, setGeplanteZeit] = useState(initial?.geplanteZeit ?? '')
  const [istZeit, setIstZeit] = useState(initial?.istZeit?.toString() ?? '')
  const [umsatzWert, setUmsatzWert] = useState(initial?.umsatzWert?.toString() ?? '')
  const [geplanteWiedervorlage, setGeplanteWiedervorlage] = useState(initial?.geplanteWiedervorlage ?? '')
  const [wartenAuf, setWartenAuf] = useState(initial?.wartenAuf ?? '')
  // Neue Aufgabe: "Erhalten am" ist heute vorbelegt. Beim Bearbeiten bleibt ein leeres Feld leer.
  const [erhaltenAm, setErhaltenAm] = useState(initial ? initial.erhaltenAm ?? '' : today())
  const [erledigenBis, setErledigenBis] = useState(initial?.erledigenBis ?? '')
  const erinnerungAnfang = isoZuEingabe(initial?.erinnernUm)
  const [erinnerung, setErinnerung] = useState(erinnerungAnfang)
  const erinnerungGeaendert = erinnerung !== erinnerungAnfang
  const erinnerungVorbei = !!erinnerung && erinnerungGeaendert && new Date(erinnerung).getTime() < Date.now()
  const [stundensatz, setStundensatz] = useState(initial?.stundensatz?.toString() ?? '')

  const kostenVorschau = zeitaufwandskosten({
    istZeit: istZeit ? Number(istZeit) : undefined,
    stundensatz: stundensatz ? Number(stundensatz) : undefined,
  })

  function submit() {
    if (!aufgabe.trim()) return
    // Nur bei Änderung mitschicken: Sonst bliebe eine vom Assistenten gesetzte Erinnerung unangetastet
    // (crmSync schickt erinnern_um nur, wenn das Feld bekannt ist). Neue Zeit = noch nicht gesendet.
    const erinnerungFelder: Partial<ToDoFormWert> = erinnerungGeaendert
      ? { erinnernUm: erinnerung ? new Date(erinnerung).toISOString() : '', erinnertAm: undefined }
      : {}
    onSubmit({
      ...erinnerungFelder,
      startDatum: startDatum || undefined,
      prio: prio || undefined,
      prioQuelle,
      unterPrio: unterPrio ? Number(unterPrio) : undefined,
      kundeProjekt: kundeProjekt || undefined,
      aufgabe,
      abteilung: abteilung || undefined,
      aktuellerStand: aktuellerStand || undefined,
      welcheFragen: welcheFragen || undefined,
      naechsteSchritte: naechsteSchritte || undefined,
      zustaendig: zustaendig || undefined,
      geplanteZeit: geplanteZeit || undefined,
      istZeit: istZeit ? Number(istZeit) : undefined,
      umsatzWert: umsatzWert ? Number(umsatzWert) : undefined,
      geplanteWiedervorlage: geplanteWiedervorlage || undefined,
      erledigtAm: initial?.erledigtAm,
      wartenAuf: wartenAuf.trim() || undefined,
      erhaltenAm: erhaltenAm || undefined,
      // Erinnerung ohne Frist: Tag der Erinnerung wird die Frist (wie beim Assistenten).
      erledigenBis: erledigenBis || (erinnerung && erinnerungGeaendert ? erinnerung.slice(0, 10) : '') || undefined,
      stundensatz: stundensatz ? Number(stundensatz) : undefined,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={titel}
      width="max-w-2xl"
      aktionen={
        // Oben statt unten (Wunsch vom 13.11.2026): Speichern ist erreichbar, ohne das Formular bis ans Ende zu scrollen.
        <>
          <SecondaryButton onClick={onClose}>{readOnly ? 'Schließen' : 'Abbrechen'}</SecondaryButton>
          {!readOnly && <PrimaryButton onClick={submit} disabled={!aufgabe.trim()}>Speichern</PrimaryButton>}
        </>
      }
    >
      <fieldset disabled={readOnly} className="disabled:opacity-60">
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Field label="Start (frei, z.B. 18.08)"><input className={inputClass} value={startDatum} onChange={(e) => setStartDatum(e.target.value)} /></Field>
          <Field label="Prio (A/B/C/...)">
            <input
              className={inputClass}
              value={prio}
              onChange={(e) => {
                setPrio(e.target.value)
                setPrioQuelle(e.target.value.trim() ? 'hand' : undefined)
              }}
            />
            {prioQuelle === 'auto' && (
              <span className="mt-1 flex items-start gap-1 text-xs text-slate-400">
                <Wand2 size={11} className="mt-0.5 flex-shrink-0" />
                Automatisch{initial?.prioGrund && prio === initial.prio ? `: ${initial.prioGrund}` : ''}
              </span>
            )}
            {prioQuelle === 'hand' && !readOnly && (
              <button type="button" onClick={() => setPrioQuelle(undefined)} className="mt-1 text-xs text-slate-400 underline hover:text-slate-600">
                Von Hand gesetzt · wieder automatisch
              </button>
            )}
            {!prioQuelle && initial?.prioQuelle === 'hand' && <span className="mt-1 block text-xs text-slate-400">Wird beim nächsten Lauf automatisch gesetzt.</span>}
          </Field>
          <Field label="Unter-Prio (1-9)"><input type="number" className={inputClass} value={unterPrio} onChange={(e) => setUnterPrio(e.target.value)} /></Field>
        </div>
        <Field label="Kunde/Projekt"><input className={inputClass} value={kundeProjekt} onChange={(e) => setKundeProjekt(e.target.value)} /></Field>
        <Field label="Aufgabe"><textarea className={inputClass} rows={2} value={aufgabe} onChange={(e) => setAufgabe(e.target.value)} autoFocus /></Field>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Field label="Abteilung"><input className={inputClass} value={abteilung} onChange={(e) => setAbteilung(e.target.value)} /></Field>
          <Field label="Zuständig"><input className={inputClass} value={zustaendig} onChange={(e) => setZustaendig(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Field label="Erhalten am"><input type="date" className={inputClass} value={erhaltenAm} onChange={(e) => setErhaltenAm(e.target.value)} /></Field>
          <Field label="Erledigen bis"><input type="date" className={inputClass} value={erledigenBis} onChange={(e) => setErledigenBis(e.target.value)} /></Field>
          <Field label="Warten auf"><input className={inputClass} value={wartenAuf} onChange={(e) => setWartenAuf(e.target.value)} /></Field>
        </div>
        <div className="mb-3">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
            <Bell size={12} /> Erinnerung per Telegram (Datum und Uhrzeit)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              aria-label="Erinnerung per Telegram"
              className={`${inputClass} sm:max-w-xs`}
              value={erinnerung}
              onChange={(e) => setErinnerung(e.target.value)}
            />
            {erinnerung && !readOnly && (
              <button type="button" onClick={() => setErinnerung('')} title="Erinnerung entfernen" className="rounded-md bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
                <X size={14} />
              </button>
            )}
          </div>
          {erinnerungVorbei && <p className="mt-1 text-xs text-amber-700">Der Zeitpunkt liegt in der Vergangenheit: Bis zwei Tage zurück geht die Erinnerung sofort raus, sonst gar nicht.</p>}
          {!erinnerungGeaendert && initial?.erinnernUm && initial.erinnertAm && (
            <p className="mt-1 text-xs text-slate-400">Gesendet am {new Date(initial.erinnertAm).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}. Eine neue Zeit verschickt sie noch einmal.</p>
          )}
          {erinnerung && !erinnerungVorbei && !(initial?.erinnertAm && !erinnerungGeaendert) && (
            <p className="mt-1 text-xs text-slate-400">Kommt bei der eigenen Liste an deren Besitzer, bei einer Bereichsliste an den Zuständigen — wenn er mit Telegram verbunden ist.</p>
          )}
        </div>
        <Field label="Aktueller Stand"><textarea className={inputClass} rows={2} value={aktuellerStand} onChange={(e) => setAktuellerStand(e.target.value)} /></Field>
        <Field label="Welche Fragen gibt es / welche Infos werden benötigt"><textarea className={inputClass} rows={2} value={welcheFragen} onChange={(e) => setWelcheFragen(e.target.value)} /></Field>
        <Field label="Was ist als nächstes zu tun"><textarea className={inputClass} rows={2} value={naechsteSchritte} onChange={(e) => setNaechsteSchritte(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Field label="Geplante Zeit (z.B. 180 std)"><input className={inputClass} value={geplanteZeit} onChange={(e) => setGeplanteZeit(e.target.value)} /></Field>
          <Field label="Ist-Zeit (min)"><input type="number" className={inputClass} value={istZeit} onChange={(e) => setIstZeit(e.target.value)} /></Field>
          <Field label="Umsatz (€)"><input type="number" className={inputClass} value={umsatzWert} onChange={(e) => setUmsatzWert(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Field label="Stundensatz (€)"><input type="number" min="0" step="0.01" className={inputClass} value={stundensatz} onChange={(e) => setStundensatz(e.target.value)} /></Field>
          <div className="mb-3 sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-500">Zeitaufwandskosten (Ist-Zeit × Stundensatz)</span>
            <p className="px-1 py-2 text-sm text-slate-700">{kostenVorschau !== undefined ? fmtEURCent(kostenVorschau) : '– (Ist-Zeit und Stundensatz eintragen)'}</p>
          </div>
        </div>
        <Field label="Geplante Wiedervorlage"><input type="date" className={inputClass} value={geplanteWiedervorlage} onChange={(e) => setGeplanteWiedervorlage(e.target.value)} /></Field>
      </fieldset>
    </Modal>
  )
}
