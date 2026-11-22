import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, List, LayoutGrid, ArrowRight, Radar, EyeOff, Share2 } from 'lucide-react'
import { useApp, useAdvanceStatus } from '../../context/AppContext'
import { IMMOBILIEN_STATUS } from '../../data/statusNetworks'
import { holeImmoRadarTopListings, generateExpose, isEmailGatewayConfigured, type ImmoRadarTreffer } from '../../lib/emailGateway'
import {
  PRIORITAET_ORDER,
  MITARBEITER,
  PRIORITAETEN,
  OBJEKT_GRUPPEN,
  OBJEKT_TYPEN,
  gruppeLabel,
  LUKRATIVITAET_OPTIONS,
  LUKRATIVITAET_COLOR,
} from '../../data/constants'
import { PriorityBadge, StatusBadge, SecondaryButton, PrimaryButton, Modal, Field, inputClass } from '../../components/ui'
import { StatusBoard } from '../../components/StatusBoard'
import { ObjektlisteWeitergeben } from '../../components/ObjektlisteWeitergeben'
import { useAuth } from '../../context/AuthContext'
import { CURRENT_USER } from '../../data/constants'
import { fmtDate, isOverdue, today, uid, fmtEUR } from '../../lib/dates'
import { immoObjekte, immoPfade } from './privatModus'
import { VollstaendigkeitsRing, ladePortalAngaben, vollstaendigkeitVon, type PortalAngaben } from '../../components/ObjektWasFehlt'
import { fehlendKurz, istUnvollstaendig, PHASE_TEXT, type Vollstaendigkeit } from '../../../supabase/functions/_shared/objektVollstaendigkeit.ts'
import { supabase } from '../../lib/supabaseClient'
import type { Objekt, Prioritaet, ObjektGruppe, ObjektTyp } from '../../types'

/** `privat`: der private Immobilien-Bereich des angemeldeten Mitarbeiters — nur eigene Objekte, neue Objekte
 *  bekommen den eigenen Login als Besitzer, keine Weitergabe-Liste und kein Verantwortlichen-Filter. */
export function ObjektListe({ privat }: { privat?: boolean } = {}) {
  const { state, dispatch } = useApp()
  const { session, mitarbeiter } = useAuth()
  const pfade = immoPfade(privat)
  const objekte = immoObjekte(state, privat)
  const ich = (session?.user.email ?? '').toLowerCase()
  const { advanceObjekt } = useAdvanceStatus()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'liste' | 'board'>('liste')
  const [addOpen, setAddOpen] = useState(false)
  const [immoRadarOpen, setImmoRadarOpen] = useState(false)

  // Bei jedem neuen Objekt automatisch ein 1-Seiten-Exposé erstellen (Whitelabel) — Punkt 12 der
  // Bugfix-Liste. Läuft bewusst asynchron nach dem Anlegen, damit das Anlegen selbst nicht auf die
  // KI-Antwort warten muss; das Exposé füllt sich in der Objektakte nach, sobald es fertig ist.
  function erstelleObjektMitExpose(neu: Objekt) {
    // Privat: Besitzer = eigener Login — damit landet das Objekt in privatObjekte und nur man selbst sieht es.
    const o: Objekt = privat ? { ...neu, privatBesitzer: ich } : neu
    if (privat && !ich) return
    dispatch({ type: 'ADD_OBJEKT', objekt: o })
    if (!isEmailGatewayConfigured) return
    generateExpose(o.bezeichnung, o.adresse, o.typ, o.kaufpreis)
      .then((exposeText) => dispatch({ type: 'UPDATE_OBJEKT', id: o.id, patch: { exposeText } }))
      .catch((err) => console.error('Exposé-Generierung fehlgeschlagen', err))
  }

  const gruppe = params.get('gruppe') ?? ''
  const [fStatus, setFStatus] = useState('')
  const [fPrio, setFPrio] = useState('')
  const [fVerantwortlich, setFVerantwortlich] = useState('')
  const [fOverdue, setFOverdue] = useState(false)
  // Vollständigkeit der Akten (Kern: supabase/functions/_shared/objektVollstaendigkeit.ts). Der Link aus dem
  // Montags-Hinweis per Telegram öffnet die Liste mit ?unvollstaendig=1.
  const [fUnvollstaendig, setFUnvollstaendig] = useState(() => params.get('unvollstaendig') === '1')
  const [portal, setPortal] = useState<Map<string, PortalAngaben> | null>(null)
  const objektIds = objekte.map((o) => o.id).join(',')
  useEffect(() => {
    // Nummern des Inserats und Portal-Freigaben stehen nicht im CRM-Zustand — einmal für alle Objekte lesen.
    if (privat || !objektIds) return
    let aktiv = true
    ladePortalAngaben(objektIds.split(','))
      .then((m) => { if (aktiv) setPortal(m) })
      .catch(() => { if (aktiv) setPortal(new Map()) })
    return () => { aktiv = false }
  }, [objektIds, privat])
  const vollstaendigkeit = useMemo(() => {
    const m = new Map<string, Vollstaendigkeit>()
    for (const o of objekte) m.set(o.id, vollstaendigkeitVon(o, privat ? undefined : portal?.get(o.id)))
    return m
  }, [objekte, portal, privat])
  // Objektliste zum Weitergeben: Objekte ankreuzen, als „nicht öffentlich" kennzeichnen, Auswahl ausgeben.
  const [fMarkt, setFMarkt] = useState<'' | 'nicht-oeffentlich' | 'oeffentlich'>('')
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set())
  const [weitergebenOpen, setWeitergebenOpen] = useState(false)

  const filtered = useMemo(() => {
    return objekte
      .filter((o) => !gruppe || o.gruppe === gruppe)
      .filter((o) => !fStatus || o.status === fStatus)
      .filter((o) => !fPrio || o.prioritaet === fPrio)
      .filter((o) => !fVerantwortlich || o.verantwortlich === fVerantwortlich)
      .filter((o) => !fOverdue || isOverdue(o.followUp.date, o.followUp.done))
      .filter((o) => !fMarkt || (fMarkt === 'nicht-oeffentlich' ? !!o.offMarket : !o.offMarket))
      .filter((o) => !fUnvollstaendig || istUnvollstaendig(vollstaendigkeit.get(o.id)!))
      .sort((a, b) =>
        fUnvollstaendig
          ? (vollstaendigkeit.get(a.id)!.prozent ?? 100) - (vollstaendigkeit.get(b.id)!.prozent ?? 100)
          : PRIORITAET_ORDER[a.prioritaet] - PRIORITAET_ORDER[b.prioritaet],
      )
  }, [objekte, gruppe, fStatus, fPrio, fVerantwortlich, fOverdue, fMarkt, fUnvollstaendig, vollstaendigkeit])

  const gewaehlt = objekte.filter((o) => auswahl.has(o.id))
  const alleSichtbarenGewaehlt = filtered.length > 0 && filtered.every((o) => auswahl.has(o.id))

  function schalte(id: string) {
    setAuswahl((alt) => {
      const neu = new Set(alt)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })
  }

  function kennzeichne(nichtOeffentlich: boolean) {
    for (const o of gewaehlt) if (!!o.offMarket !== nichtOeffentlich) dispatch({ type: 'UPDATE_OBJEKT', id: o.id, patch: { offMarket: nichtOeffentlich } })
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{privat ? 'Meine Objekte (privat)' : 'Objekte'} {gruppe && `– ${gruppeLabel(gruppe as ObjektGruppe)}`}</h1>
          <p className="text-sm text-slate-500">{filtered.length} von {objekte.length} Objekten</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button onClick={() => setView('liste')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'liste' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <List size={14} /> Liste
            </button>
            <button onClick={() => setView('board')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${view === 'board' ? 'bg-accent-50 text-accent-700' : 'text-slate-500'}`}>
              <LayoutGrid size={14} /> Board
            </button>
          </div>
          <a
            href="https://eray-hash.github.io/immobilien-radar/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Radar size={15} /> ImmoRadar öffnen
          </a>
          <SecondaryButton onClick={() => setImmoRadarOpen(true)}><Plus size={15} /> Aus ImmoRadar übernehmen</SecondaryButton>
          <PrimaryButton onClick={() => setAddOpen(true)}><Plus size={15} /> Neues Objekt</PrimaryButton>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <select value={gruppe} onChange={(e) => setParams(e.target.value ? { gruppe: e.target.value } : {})} className={`${inputClass} w-auto`}>
          <option value="">Alle Gruppen</option>
          {OBJEKT_GRUPPEN.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Status</option>
          {Object.values(IMMOBILIEN_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={fPrio} onChange={(e) => setFPrio(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">Alle Prioritäten</option>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {!privat && (
          <select value={fVerantwortlich} onChange={(e) => setFVerantwortlich(e.target.value)} className={`${inputClass} w-auto`}>
            <option value="">Alle Verantwortlichen</option>
            {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        <select value={fMarkt} onChange={(e) => setFMarkt(e.target.value as typeof fMarkt)} className={`${inputClass} w-auto`} aria-label="Öffentlich oder nicht öffentlich">
          <option value="">Öffentlich und nicht öffentlich</option>
          <option value="nicht-oeffentlich">Nur nicht öffentliche (Off-Market)</option>
          <option value="oeffentlich">Nur öffentliche</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={fOverdue} onChange={(e) => setFOverdue(e.target.checked)} className="rounded" />
          nur überfällige Follow-ups
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600" title="Objekte, denen für ihren Stand noch etwas fehlt (Kaufpreis, Fotos, Exposé, Unterlagen …) — die unvollständigsten zuerst">
          <input type="checkbox" checked={fUnvollstaendig} onChange={(e) => setFUnvollstaendig(e.target.checked)} className="rounded" />
          nur unvollständige
        </label>
        <WochenhinweisSchalter email={ich} />
      </div>

      {view === 'liste' && auswahl.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent-200 bg-accent-50 px-3 py-2 text-sm">
          <span className="font-medium text-accent-800">
            {auswahl.size} {auswahl.size === 1 ? 'Objekt' : 'Objekte'} ausgewählt
          </span>
          {/* Die Weitergabe-Liste hält fest, wer welche Objekte bekam (Mayer-Nachweis) — privat nicht. */}
          {!privat && (
            <PrimaryButton onClick={() => setWeitergebenOpen(true)}>
              <Share2 size={14} /> Liste zum Weitergeben
            </PrimaryButton>
          )}
          <SecondaryButton onClick={() => kennzeichne(true)}>
            <EyeOff size={14} /> Als nicht öffentlich kennzeichnen
          </SecondaryButton>
          <SecondaryButton onClick={() => kennzeichne(false)}>Kennzeichen entfernen</SecondaryButton>
          <button onClick={() => setAuswahl(new Set())} className="ml-auto text-xs font-medium text-accent-700 hover:underline">
            Auswahl aufheben
          </button>
        </div>
      )}

      {view === 'liste' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="w-8 py-3 pl-4">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={alleSichtbarenGewaehlt}
                    onChange={() => setAuswahl(alleSichtbarenGewaehlt ? new Set() : new Set(filtered.map((o) => o.id)))}
                    aria-label="Alle angezeigten Objekte auswählen"
                  />
                </th>
                <th className="px-4 py-3" title="Wie vollständig die Akte für ihren Stand ist">Akte</th>
                <th className="px-4 py-3">Objekt</th>
                <th className="px-4 py-3">Gruppe</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Follow-up</th>
                <th className="px-4 py-3">Verantwortlich</th>
                <th className="px-4 py-3">Kaufpreis</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const overdue = isOverdue(o.followUp.date, o.followUp.done)
                const node = IMMOBILIEN_STATUS[o.status]
                return (
                  <tr key={o.id} onClick={() => navigate(pfade.objekt(o.id))} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded" checked={auswahl.has(o.id)} onChange={() => schalte(o.id)} aria-label={`${o.bezeichnung} auswählen`} />
                    </td>
                    <td className="px-4 py-3">
                      <VollstaendigkeitsZelle v={vollstaendigkeit.get(o.id)!} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800">{o.bezeichnung}</span>
                        {o.quelle === 'immoradar' && <Radar size={12} className="text-accent-500" />}
                        {o.offMarket && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600" title="Wird nicht öffentlich angeboten (Off-Market)">
                            <EyeOff size={10} /> nicht öffentlich
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">{o.adresse}</div>
                      {o.lukrativitaet && (
                        <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${LUKRATIVITAET_COLOR[o.lukrativitaet] ?? 'bg-slate-100 text-slate-600'}`}>
                          {o.lukrativitaet}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{gruppeLabel(o.gruppe)}</td>
                    <td className="px-4 py-3 text-slate-500">{o.typ}</td>
                    <td className="px-4 py-3"><PriorityBadge value={o.prioritaet} /></td>
                    <td className="px-4 py-3"><StatusBadge label={node.label} color={node.color} /></td>
                    <td className="px-4 py-3">
                      <div className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>{fmtDate(o.followUp.date)}</div>
                      <div className="text-xs text-slate-400">{o.followUp.note}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{o.verantwortlich}</td>
                    <td className="px-4 py-3 text-slate-700">{fmtEUR(o.kaufpreis)}</td>
                    <td className="px-4 py-3 text-right">
                      {node.next.length > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); advanceObjekt(o.id) }} className="inline-flex items-center gap-1 rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100">
                          Weiter <ArrowRight size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-400">Keine Objekte gefunden.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <StatusBoard
          bereich="immobilien"
          basePath={pfade.objekteBasis}
          onAdvance={(id) => advanceObjekt(id)}
          items={filtered.map((o) => ({ id: o.id, title: o.bezeichnung, subtitle: o.adresse, prioritaet: o.prioritaet, status: o.status, followUp: o.followUp }))}
        />
      )}

      {weitergebenOpen && !privat && (
        <ObjektlisteWeitergeben open={weitergebenOpen} onClose={() => setWeitergebenOpen(false)} objekte={gewaehlt} absender={mitarbeiter?.name ?? CURRENT_USER} />
      )}
      {addOpen && (
        <NeuesObjektModal open={addOpen} onClose={() => setAddOpen(false)} onCreate={erstelleObjektMitExpose} eigenerName={privat ? (mitarbeiter?.name ?? CURRENT_USER) : undefined} />
      )}
      {immoRadarOpen && (
        <ImmoRadarUebernehmenModal
          open={immoRadarOpen}
          onClose={() => setImmoRadarOpen(false)}
          onCreate={erstelleObjektMitExpose}
          eigenerName={privat ? (mitarbeiter?.name ?? CURRENT_USER) : undefined}
        />
      )}
    </div>
  )
}

/** Ring mit Prozent; Tooltip nennt, was fehlt. Abgeschlossene Objekte (verkauft, Archiv, abgebrochen): Strich. */
function VollstaendigkeitsZelle({ v }: { v: Vollstaendigkeit }) {
  if (!v.gilt || v.prozent === null) return <span className="text-xs text-slate-300">–</span>
  const titel = v.fehlend.length === 0
    ? `Vollständig für den Stand „${PHASE_TEXT[v.phase]}“`
    : `${v.prozent} % für den Stand „${PHASE_TEXT[v.phase]}“ — es fehlt: ${fehlendKurz(v, 8)}`
  return <VollstaendigkeitsRing prozent={v.prozent} titel={titel} />
}

/** Eigene Einstellung für den Montags-Hinweis per Telegram (Tabelle objekt_luecken_hinweis, keine Zeile = an;
 *  verschickt von supabase/functions/email-gateway/objektLueckenHinweis.ts). Fehlt die Tabelle noch, bleibt der
 *  Schalter unsichtbar. */
function WochenhinweisSchalter({ email }: { email: string }) {
  const [an, setAn] = useState<boolean | null>(null)
  const [fehler, setFehler] = useState('')
  useEffect(() => {
    if (!supabase || !email) return
    let aktiv = true
    supabase
      .from('objekt_luecken_hinweis')
      .select('aktiv')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (aktiv && !error) setAn(data?.aktiv !== false)
      })
    return () => { aktiv = false }
  }, [email])
  if (an === null || !supabase) return null
  async function schalte(wert: boolean) {
    if (!supabase) return
    const vorher = an
    setAn(wert)
    setFehler('')
    const { error } = await supabase.from('objekt_luecken_hinweis').upsert({ email, aktiv: wert, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
    if (error) {
      setAn(vorher)
      setFehler('Nicht gespeichert.')
    }
  }
  return (
    <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500" title="Montags ab 8:30 Uhr eine kurze Telegram-Nachricht: welche deiner Objekte in Vorbereitung und Vermarktung noch unvollständig sind — nur wenn es etwas gibt">
      <input type="checkbox" checked={an} onChange={(e) => schalte(e.target.checked)} className="rounded" />
      montags per Telegram erinnern, was fehlt
      {fehler && <span className="text-rose-600">{fehler}</span>}
    </label>
  )
}

// Bildet die freien Objekttyp-Bezeichnungen des ImmoRadar-Scrapers auf die 5 festen ObjektTyp-Werte
// des CRM ab — das Radar unterscheidet z.B. mehrere Gewerbe-Unterarten, die hier alle auf "Gewerbe"
// zusammenfallen, da das CRM dafür keine feinere Kategorie führt.
const OBJEKT_TYP_MAPPING: Record<string, ObjektTyp> = {
  Mehrfamilienhaus: 'Haus',
  Eigentumswohnung: 'Wohnung',
  Baugrundstück: 'Grundstück',
  'Büro/Praxis': 'Gewerbe',
  'Weitere Gewerbeeinheit': 'Gewerbe',
  'Lager/Halle/Produktion': 'Gewerbe',
  'Einzelhandel/Kiosk': 'Gewerbe',
  'Gastronomie/Hotel': 'Gewerbe',
  'Garage/Stellplatz': 'Gewerbe',
}

// eigenerName gesetzt (privater Bereich): man ist selbst verantwortlich, die Auswahl entfällt.
function ImmoRadarUebernehmenModal({ open, onClose, onCreate, eigenerName }: { open: boolean; onClose: () => void; onCreate: (o: Objekt) => void; eigenerName?: string }) {
  const [listings, setListings] = useState<ImmoRadarTreffer[] | null>(null)
  const [ladeFehler, setLadeFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [ausgewaehlt, setAusgewaehlt] = useState<ImmoRadarTreffer | null>(null)

  const [bezeichnung, setBezeichnung] = useState('')
  const [adresse, setAdresse] = useState('')
  const [typ, setTyp] = useState<ObjektTyp>('Wohnung')
  const [kaufpreis, setKaufpreis] = useState(500000)
  const [immoRadarLink, setImmoRadarLink] = useState('')
  const [lukrativitaet, setLukrativitaet] = useState<string>(LUKRATIVITAET_OPTIONS[1])
  const [verantwortlich, setVerantwortlich] = useState(eigenerName ?? MITARBEITER[0])

  useEffect(() => {
    if (!open || listings !== null) return
    setLadeFehler('')
    holeImmoRadarTopListings()
      .then(setListings)
      .catch((err) => setLadeFehler(err instanceof Error ? err.message : 'ImmoRadar-Daten konnten nicht geladen werden.'))
  }, [open, listings])

  const gefiltert = useMemo(() => {
    if (!listings) return []
    const q = suche.trim().toLowerCase()
    if (!q) return listings
    return listings.filter((l) => `${l.titel} ${l.ort}`.toLowerCase().includes(q))
  }, [listings, suche])

  function waehlen(t: ImmoRadarTreffer) {
    setAusgewaehlt(t)
    setBezeichnung(t.titel)
    setAdresse(t.ort)
    setTyp(OBJEKT_TYP_MAPPING[t.objektTypLabel] ?? 'Wohnung')
    setKaufpreis(t.kaufpreis ?? 0)
    setImmoRadarLink(t.url)
    setLukrativitaet((LUKRATIVITAET_OPTIONS as readonly string[]).includes(t.lukrativitaet) ? t.lukrativitaet : LUKRATIVITAET_OPTIONS[1])
  }

  function zurueckZurListe() {
    setAusgewaehlt(null)
  }

  function schliessenUndZuruecksetzen() {
    setAusgewaehlt(null)
    setSuche('')
    onClose()
  }

  function submit() {
    if (!bezeichnung.trim()) return
    const kontextZeilen = [
      `Aus ImmoRadar übernommen (Lukrativität: ${lukrativitaet}).`,
      ausgewaehlt?.kiEinschaetzung ? `KI-Einschätzung: ${ausgewaehlt.kiEinschaetzung}` : '',
    ].filter(Boolean)
    onCreate({
      id: uid('o'),
      bezeichnung,
      adresse,
      gruppe: 'aktuell',
      typ,
      kaufpreis,
      prioritaet: 'Mittel',
      status: 'akquise',
      followUp: { date: today(), note: 'Aus ImmoRadar übernommen — erste Prüfung einplanen', done: false },
      verantwortlich,
      activities: [{ id: uid('act'), date: today(), text: kontextZeilen.join(' '), user: verantwortlich }],
      dokumente: {},
      quelle: 'immoradar',
      immoRadarLink: immoRadarLink || undefined,
      lukrativitaet,
    })
    setBezeichnung(''); setAdresse(''); setImmoRadarLink(''); setAusgewaehlt(null); setSuche('')
    onClose()
  }

  return (
    <Modal open={open} onClose={schliessenUndZuruecksetzen} title="Objekt aus ImmoRadar übernehmen" width="max-w-2xl">
      {!ausgewaehlt ? (
        <>
          <p className="mb-3 text-xs text-slate-500">
            Zeigt die vom{' '}
            <a href="https://eray-hash.github.io/immobilien-radar/" target="_blank" rel="noreferrer" className="text-accent-600 underline">
              ImmoRadar
            </a>{' '}
            als "interessant"/"sehr interessant" eingestuften Treffer — auswählen, Eckdaten prüfen, übernehmen.
          </p>
          <input
            className={`${inputClass} mb-3`}
            placeholder="Suche nach Ort oder Titel …"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          {ladeFehler && <p className="mb-3 text-sm text-rose-600">{ladeFehler}</p>}
          {!listings && !ladeFehler && <p className="text-sm text-slate-400">Lade ImmoRadar-Treffer …</p>}
          {listings && (
            <div className="max-h-96 space-y-1.5 overflow-y-auto">
              {gefiltert.length === 0 && <p className="text-sm text-slate-400">Keine Treffer.</p>}
              {gefiltert.map((t) => (
                <button
                  key={t.id}
                  onClick={() => waehlen(t)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 p-2.5 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-700">{t.titel}</div>
                    <div className="text-xs text-slate-400">{t.ort} · {t.objektTypLabel}{t.kaufpreis ? ` · ${fmtEUR(t.kaufpreis)}` : ''}</div>
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${LUKRATIVITAET_COLOR[t.lukrativitaet] ?? 'bg-slate-100 text-slate-600'}`}>
                    {t.lukrativitaet}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={zurueckZurListe} className="mb-3 text-xs font-medium text-accent-600 hover:underline">← Zurück zur Liste</button>
          <Field label="Bezeichnung"><input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} /></Field>
          <Field label="Adresse"><input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} /></Field>
          <Field label="Objekttyp">
            <select className={inputClass} value={typ} onChange={(e) => setTyp(e.target.value as ObjektTyp)}>
              {OBJEKT_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Kaufpreis (€)"><input type="number" className={inputClass} value={kaufpreis} onChange={(e) => setKaufpreis(Number(e.target.value))} /></Field>
          <Field label="Lukrativität (ImmoRadar-Einschätzung)">
            <select className={inputClass} value={lukrativitaet} onChange={(e) => setLukrativitaet(e.target.value)}>
              {LUKRATIVITAET_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          {ausgewaehlt.kiEinschaetzung && (
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{ausgewaehlt.kiEinschaetzung}</div>
          )}
          <Field label="ImmoRadar-Link (Original-Inserat)">
            <input className={inputClass} value={immoRadarLink} onChange={(e) => setImmoRadarLink(e.target.value)} />
          </Field>
          {!eigenerName && (
            <Field label="Verantwortlich">
              <select className={inputClass} value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)}>
                {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={schliessenUndZuruecksetzen} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>
            <PrimaryButton onClick={submit}>Objekt übernehmen</PrimaryButton>
          </div>
        </>
      )}
    </Modal>
  )
}

function NeuesObjektModal({ open, onClose, onCreate, eigenerName }: { open: boolean; onClose: () => void; onCreate: (o: Objekt) => void; eigenerName?: string }) {
  const [bezeichnung, setBezeichnung] = useState('')
  const [adresse, setAdresse] = useState('')
  const [gruppe, setGruppe] = useState<ObjektGruppe>('aktuell')
  const [typ, setTyp] = useState<ObjektTyp>('Wohnung')
  const [kaufpreis, setKaufpreis] = useState(500000)
  const [prioritaet, setPrioritaet] = useState<Prioritaet>('Mittel')
  const [status, setStatus] = useState('akquise')
  const [followUpDate, setFollowUpDate] = useState(today())
  const [verantwortlich, setVerantwortlich] = useState(eigenerName ?? MITARBEITER[0])

  function submit() {
    if (!bezeichnung.trim()) return
    onCreate({
      id: uid('o'),
      bezeichnung,
      adresse,
      gruppe,
      typ,
      kaufpreis,
      prioritaet,
      status,
      followUp: { date: followUpDate, note: 'Objekt aufgenommen', done: false },
      verantwortlich,
      activities: [{ id: uid('act'), date: today(), text: 'Objekt angelegt', user: verantwortlich }],
      dokumente: {},
    })
    setBezeichnung(''); setAdresse('')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Neues Objekt">
      <Field label="Bezeichnung"><input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} /></Field>
      <Field label="Adresse"><input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} /></Field>
      <Field label="Gruppe">
        <select className={inputClass} value={gruppe} onChange={(e) => setGruppe(e.target.value as ObjektGruppe)}>
          {OBJEKT_GRUPPEN.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </Field>
      <Field label="Objekttyp">
        <select className={inputClass} value={typ} onChange={(e) => setTyp(e.target.value as ObjektTyp)}>
          {OBJEKT_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Kaufpreis (€)"><input type="number" className={inputClass} value={kaufpreis} onChange={(e) => setKaufpreis(Number(e.target.value))} /></Field>
      <Field label="Priorität">
        <select className={inputClass} value={prioritaet} onChange={(e) => setPrioritaet(e.target.value as Prioritaet)}>
          {PRIORITAETEN.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Startstatus">
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.values(IMMOBILIEN_STATUS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Field>
      <Field label="Follow-up-Datum"><input type="date" className={inputClass} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
      {!eigenerName && (
        <Field label="Verantwortlich">
          <select className={inputClass} value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)}>
            {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>
        <PrimaryButton onClick={submit}>Objekt anlegen</PrimaryButton>
      </div>
    </Modal>
  )
}
