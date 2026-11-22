// Seminarkatalog der Akademie (Liste von Hasan Süslü, 21.11.2026): Seminare nach Bereichen, mit Stand,
// Dauer, Preis, Dozent und wer sich dafür interessiert oder angemeldet hat (aus den Teilnehmer-Akten).
// Seit 22.11.2026 je Seminar Termine (Tabelle seminar_termine) mit Teilnehmerliste auf /akademie/termine/:id.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, CalendarDays, Plus, Search } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { aendereSeminar, KATALOG_STAND, ladeSeminare, legeSeminarAn, loescheSeminar, nachBereich, TEILNEHMER_STAND, type Seminar, type SeminarKatalogStand } from '../../lib/seminare'
import { fmtEURCent } from '../../lib/dates'
import { SeminarTerminFenster } from '../../components/SeminarTerminFenster'
import { belegung as belegungVon, ladeAnmeldungen, ladeTermine, legeTerminAn, TERMIN_STATUS, terminZeit, type SeminarAnmeldung, type SeminarTermin } from '../../lib/seminarTermine'
import type { Kunde, SeminarStand } from '../../types'

type Belegung = { kunde: Kunde; stand: SeminarStand }

export function Seminare() {
  const { state } = useApp()
  const navigate = useNavigate()
  const nutzer = useKvNutzer()
  const [liste, setListe] = useState<Seminar[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [standFilter, setStandFilter] = useState<'' | SeminarKatalogStand>('')
  const [offen, setOffen] = useState<Seminar | 'neu' | null>(null)
  const [terminNeu, setTerminNeu] = useState<Seminar | null>(null)
  const [termine, setTermine] = useState<SeminarTermin[]>([])
  const [anmeldungen, setAnmeldungen] = useState<SeminarAnmeldung[]>([])

  const laden = () => ladeSeminare().then(setListe).catch((e) => { setFehler(e instanceof Error ? e.message : 'Seminare ließen sich nicht laden.'); setListe([]) })
  const termineLaden = () =>
    ladeTermine()
      .then(async (t) => {
        setTermine(t)
        setAnmeldungen(await ladeAnmeldungen({ terminIds: t.map((x) => x.id) }))
      })
      .catch(() => undefined)
  useEffect(() => {
    laden()
    termineLaden()
  }, [])

  const termineJeSeminar = useMemo(() => {
    const m = new Map<string, SeminarTermin[]>()
    for (const t of termine) m.set(t.seminarId, [...(m.get(t.seminarId) ?? []), t])
    return m
  }, [termine])
  const jetztIso = new Date().toISOString()

  // Wer ist für welches Seminar eingetragen (aus den Akten der Akademie)?
  const belegung = useMemo(() => {
    const m = new Map<string, Belegung[]>()
    for (const k of state.akademieTeilnehmer) for (const b of k.seminare ?? []) m.set(b.id, [...(m.get(b.id) ?? []), { kunde: k, stand: b.stand }])
    return m
  }, [state.akademieTeilnehmer])

  const gruppen = useMemo(() => {
    const s = suche.trim().toLowerCase()
    const gefiltert = (liste ?? []).filter((x) => (!standFilter || x.stand === standFilter) && (!s || [x.titel, x.bereich, x.dozent, x.beschreibung].some((t) => (t ?? '').toLowerCase().includes(s))))
    return nachBereich(gefiltert)
  }, [liste, suche, standFilter])
  const bereiche = useMemo(() => nachBereich(liste ?? []).map(([b]) => b), [liste])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BookOpen size={20} className="text-slate-400" /> Seminare
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Seminarangebot der Akademie nach Bereichen. Ein Klick auf ein Seminar öffnet Beschreibung, Dauer, Preis, Dozent und die Termine mit ihren Teilnehmerlisten. In der Akte eines Teilnehmers trägt man ein, welche Seminare er angefragt oder gebucht hat.
          </p>
        </div>
        {!nutzer.nurLesen && (
          <PrimaryButton onClick={() => setOffen('neu')}>
            <Plus size={14} /> Neues Seminar
          </PrimaryButton>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Seminar, Bereich oder Dozent suchen" className={`${inputClass} w-full pl-8`} />
        </div>
        <select value={standFilter} onChange={(e) => setStandFilter(e.target.value as '' | SeminarKatalogStand)} className={inputClass} aria-label="Stand">
          <option value="">Alle Stände</option>
          {KATALOG_STAND.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {liste === null ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : gruppen.length === 0 ? (
        <EmptyState text="Keine Seminare für diese Auswahl." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {gruppen.map(([bereich, seminare]) => (
            <Card key={bereich} className="p-4">
              <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold text-slate-700">
                {bereich}
                <span className="text-xs font-normal text-slate-400">{seminare.length}</span>
              </h2>
              <ul className="divide-y divide-slate-100">
                {seminare.map((s) => {
                  const st = KATALOG_STAND.find((x) => x.id === s.stand)
                  const b = belegung.get(s.id) ?? []
                  const angemeldet = b.filter((x) => x.stand !== 'interessiert').length
                  const interessiert = b.length - angemeldet
                  const naechster = (termineJeSeminar.get(s.id) ?? []).find((t) => t.status === 'geplant' && t.beginn >= jetztIso)
                  return (
                    <li key={s.id}>
                      <button onClick={() => setOffen(s)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left text-sm hover:bg-slate-50">
                        <span className="min-w-0 flex-1 font-medium text-slate-700">{s.titel}</span>
                        {(s.dauer || s.preisNetto !== undefined) && (
                          <span className="text-xs tabular-nums text-slate-500">
                            {[s.dauer, s.preisNetto !== undefined ? fmtEURCent(s.preisNetto) : ''].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {b.length > 0 && (
                          <span className="text-xs text-slate-500">
                            {angemeldet > 0 ? `${angemeldet} angemeldet` : ''}
                            {angemeldet > 0 && interessiert > 0 ? ' · ' : ''}
                            {interessiert > 0 ? `${interessiert} interessiert` : ''}
                          </span>
                        )}
                        {naechster && (
                          <span className="inline-flex items-center gap-1 text-xs text-sky-700" title="Nächster Termin">
                            <CalendarDays size={12} /> {new Date(naechster.beginn).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' })}
                          </span>
                        )}
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st?.farbe ?? ''}`}>{st?.label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {offen && (
        <SeminarFenster
          seminar={offen === 'neu' ? undefined : offen}
          bereiche={bereiche}
          belegung={offen === 'neu' ? [] : belegung.get(offen.id) ?? []}
          termine={offen === 'neu' ? [] : termineJeSeminar.get(offen.id) ?? []}
          anmeldungen={anmeldungen}
          nurLesen={nutzer.nurLesen}
          onAkte={(k) => navigate(`/akademie/teilnehmer/${k.id}`)}
          onTermin={(t) => navigate(`/akademie/termine/${t.id}`)}
          onNeuerTermin={() => {
            if (offen === 'neu') return
            setTerminNeu(offen)
            setOffen(null)
          }}
          onClose={() => setOffen(null)}
          onSpeichern={async (e) => {
            if (offen === 'neu') await legeSeminarAn({ ...e, titel: e.titel ?? '', bereich: e.bereich ?? '' }, nutzer.name, liste ?? [])
            else await aendereSeminar(offen.id, e, nutzer.name)
            await laden()
            setOffen(null)
          }}
          onLoeschen={async () => {
            if (offen === 'neu') return
            await loescheSeminar(offen.id)
            await laden()
            setOffen(null)
          }}
        />
      )}

      {terminNeu && (
        <SeminarTerminFenster
          seminarTitel={terminNeu.titel}
          vorgabeVerantwortlich={nutzer.name}
          vorgabeReferent={terminNeu.dozent}
          onClose={() => setTerminNeu(null)}
          onSpeichern={async (e) => {
            const t = await legeTerminAn(terminNeu.id, e, nutzer.name)
            setTerminNeu(null)
            navigate(`/akademie/termine/${t.id}`)
          }}
        />
      )}
    </div>
  )
}

function SeminarFenster({
  seminar, bereiche, belegung, termine, anmeldungen, nurLesen, onAkte, onTermin, onNeuerTermin, onClose, onSpeichern, onLoeschen,
}: {
  seminar?: Seminar
  bereiche: string[]
  belegung: Belegung[]
  termine: SeminarTermin[]
  anmeldungen: SeminarAnmeldung[]
  nurLesen: boolean
  onAkte: (k: Kunde) => void
  onTermin: (t: SeminarTermin) => void
  onNeuerTermin: () => void
  onClose: () => void
  onSpeichern: (e: Partial<Seminar>) => Promise<void>
  onLoeschen: () => Promise<void>
}) {
  const [titel, setTitel] = useState(seminar?.titel ?? '')
  const [bereich, setBereich] = useState(seminar?.bereich ?? bereiche[0] ?? '')
  const [neuerBereich, setNeuerBereich] = useState('')
  const [beschreibung, setBeschreibung] = useState(seminar?.beschreibung ?? '')
  const [dauer, setDauer] = useState(seminar?.dauer ?? '')
  const [preis, setPreis] = useState(seminar?.preisNetto !== undefined ? String(seminar.preisNetto).replace('.', ',') : '')
  const [dozent, setDozent] = useState(seminar?.dozent ?? '')
  const [stand, setStand] = useState<SeminarKatalogStand>(seminar?.stand ?? 'in_planung')
  const [loeschenFragen, setLoeschenFragen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  async function speichern() {
    const zielBereich = bereich === '__neu' ? neuerBereich.trim() : bereich
    if (!titel.trim() || !zielBereich) {
      setFehler('Titel und Bereich sind nötig.')
      return
    }
    const p = preis.trim() === '' ? undefined : Number(preis.replace(/\./g, '').replace(',', '.'))
    if (p !== undefined && !Number.isFinite(p)) {
      setFehler('Der Preis muss eine Zahl sein, z. B. 490 oder 490,00.')
      return
    }
    setLaeuft(true)
    setFehler('')
    try {
      await onSpeichern({ titel, bereich: zielBereich, beschreibung, dauer, preisNetto: p ?? Number.NaN, dozent, stand })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
      setLaeuft(false)
    }
  }

  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  return (
    <Modal open onClose={onClose} title={seminar ? seminar.titel : 'Neues Seminar'} width="max-w-xl" aktionen={!nurLesen && <PrimaryButton onClick={speichern} disabled={laeuft}>Speichern</PrimaryButton>}>
      <fieldset disabled={nurLesen} className="space-y-3">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        <label className="block">
          <span className={feld}>Titel</span>
          <input value={titel} onChange={(e) => setTitel(e.target.value)} className={`${inputClass} w-full`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={feld}>Bereich</span>
            <select value={bereich} onChange={(e) => setBereich(e.target.value)} className={`${inputClass} w-full`}>
              {bereiche.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value="__neu">Neuer Bereich …</option>
            </select>
          </label>
          {bereich === '__neu' && (
            <label className="block">
              <span className={feld}>Name des neuen Bereichs</span>
              <input value={neuerBereich} onChange={(e) => setNeuerBereich(e.target.value)} className={`${inputClass} w-full`} />
            </label>
          )}
          <label className="block">
            <span className={feld}>Stand</span>
            <select value={stand} onChange={(e) => setStand(e.target.value as SeminarKatalogStand)} className={`${inputClass} w-full`}>
              {KATALOG_STAND.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className={feld}>Beschreibung</span>
          <textarea value={beschreibung} onChange={(e) => setBeschreibung(e.target.value)} rows={3} className={`${inputClass} w-full`} placeholder="Inhalte, Zielgruppe, Ablauf" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={feld}>Dauer</span>
            <input value={dauer} onChange={(e) => setDauer(e.target.value)} className={`${inputClass} w-full`} placeholder="z. B. 2 Tage" />
          </label>
          <label className="block">
            <span className={feld}>Preis netto (€)</span>
            <input value={preis} onChange={(e) => setPreis(e.target.value)} inputMode="decimal" className={`${inputClass} w-full`} placeholder="z. B. 490" />
          </label>
          <label className="block">
            <span className={feld}>Dozent</span>
            <input value={dozent} onChange={(e) => setDozent(e.target.value)} className={`${inputClass} w-full`} />
          </label>
        </div>
      </fieldset>

      {seminar && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Termine</p>
            {!nurLesen && (
              <button onClick={onNeuerTermin} className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline">
                <Plus size={12} /> Termin hinzufügen
              </button>
            )}
          </div>
          {termine.length === 0 ? (
            <p className="text-sm text-slate-400">Noch kein Termin.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {termine.map((t) => {
                const b = belegungVon(anmeldungen.filter((a) => a.terminId === t.id), t.plaetze)
                const st = TERMIN_STATUS.find((x) => x.id === t.status)
                return (
                  <li key={t.id}>
                    <button onClick={() => onTermin(t)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                      <span className="min-w-0 flex-1 text-slate-700">{terminZeit(t.beginn, t.ende)}{t.ort ? ` · ${t.ort}` : ''}</span>
                      <span className="text-xs tabular-nums text-slate-500">
                        {b.belegt}{t.plaetze !== undefined ? ` / ${t.plaetze}` : ''} angemeldet{b.warteliste ? ` · ${b.warteliste} Warteliste` : ''}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st?.farbe ?? ''}`}>{st?.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {seminar && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Teilnehmer und Interessenten</p>
          {belegung.length === 0 ? (
            <p className="text-sm text-slate-400">Noch niemand eingetragen. Das geht in der Akte des Teilnehmers.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {belegung.map((b) => (
                <li key={b.kunde.id} className="flex justify-between gap-2">
                  <button onClick={() => onAkte(b.kunde)} className="text-left text-slate-700 hover:underline">{b.kunde.ansprechpartner || b.kunde.firma}</button>
                  <span className="text-xs text-slate-500">{TEILNEHMER_STAND.find((t) => t.id === b.stand)?.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {seminar && !nurLesen && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          {!loeschenFragen ? (
            <button onClick={() => setLoeschenFragen(true)} className="text-rose-600 hover:underline">Seminar löschen</button>
          ) : termine.length > 0 ? (
            <>
              <span className="text-slate-600">Zu diesem Seminar gibt es {termine.length} Termin(e). Bitte zuerst die Termine löschen.</span>
              <SecondaryButton onClick={() => setLoeschenFragen(false)}>Verstanden</SecondaryButton>
            </>
          ) : (
            <>
              <span className="text-slate-600">{belegung.length > 0 ? `${belegung.length} Akte(n) verweisen darauf. ` : ''}Wirklich löschen?</span>
              <SecondaryButton onClick={() => setLoeschenFragen(false)}>Abbrechen</SecondaryButton>
              <button onClick={() => onLoeschen().catch((e) => setFehler(e instanceof Error ? e.message : 'Löschen ging nicht.'))} className="rounded-lg bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700">
                Löschen
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
