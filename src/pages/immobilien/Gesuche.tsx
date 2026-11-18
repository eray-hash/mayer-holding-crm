import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Field, inputClass, Modal, PrimaryButton } from '../../components/ui'
import { GesuchFormular } from '../../components/GesuchFormular'
import { alleGesuche, budgetText, eckdatenTexte, passendeObjekte, pruefe } from '../../lib/gesuche'
import { entdecktText, neueTrefferMeldungen, NEU_TAGE, paarSchluessel } from '../../lib/trefferMeldungen'
import { kundeBereichLabel, kundeDetailPfad } from '../../data/kundenBereiche'
import { CURRENT_USER } from '../../data/constants'
import { fmtDate, fmtEUR, today, uid } from '../../lib/dates'
import type { Gesuch, Kunde, KundeBereich } from '../../types'

function kontaktPfad(bereich: KundeBereich, kundeId: string): string {
  return bereich === 'immobilienkunden' ? `/immobilien/kunden/${kundeId}?tab=stammdatenblatt` : kundeDetailPfad(bereich, kundeId)
}

/** Kleine Marke für Paare, die der Server in den letzten Tagen neu entdeckt hat. */
function NeuMarke() {
  return <span className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-700">neu</span>
}

// So viele neue Treffer zeigt die Karte oben, bevor „alle anzeigen" nötig wird — auf dem Handy weniger,
// weil dort jeder Eintrag mehrere Zeilen braucht und die Karte sonst den ganzen Bildschirm füllt.
const NEUE_ZUERST = 5
const NEUE_ZUERST_HANDY = 3

/** Alle Gesuche auf einen Blick — wer sucht was, und welche Objekte aus dem Bestand dazu passen.
 *  Ein neues Gesuch ist in einer Minute erfasst: Kontakt wählen (oder neu anlegen), Wunsch eintragen. */
export function Gesuche() {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const [suche, setSuche] = useState('')
  const [auchErledigte, setAuchErledigte] = useState(false)
  const [offen, setOffen] = useState<string | null>(null)
  const [neu, setNeu] = useState(false)
  const [alleNeuen, setAlleNeuen] = useState(false)

  const alle = useMemo(() => alleGesuche(state), [state])

  // Vom Server neu entdeckte Treffer (Regel für „neu": siehe src/lib/trefferMeldungen.ts). Gezeigt wird
  // nur, was nach dem Abgleich dieser Seite auch jetzt noch passt — überholte Meldungen räumt der Server
  // erst bei seinem nächsten Lauf ab. Auch ob es ein Treffer oder „zu prüfen" ist, kommt aus dem Abgleich
  // der Seite, damit Karte und Liste nie Verschiedenes sagen.
  const neueTreffer = useMemo(() => {
    const liste = []
    for (const meldung of neueTrefferMeldungen(state.trefferMeldungen ?? [])) {
      const z = alle.find((x) => x.gesuch.id === meldung.gesuchId && x.kunde.id === meldung.kundeId)
      const objekt = state.objekte.find((o) => o.id === meldung.objektId)
      if (!z || !objekt || z.gesuch.erledigt) continue
      const t = pruefe(z.gesuch, objekt)
      if (!t) continue
      liste.push({ meldung, gesuch: z.gesuch, kunde: z.kunde, bereich: z.bereich, objekt, sicher: t.offen.length === 0 })
    }
    return liste
  }, [alle, state.objekte, state.trefferMeldungen])
  const neuePaare = useMemo(() => new Set(neueTreffer.map((n) => paarSchluessel(n.gesuch.id, n.objekt.id))), [neueTreffer])

  const zeilen = useMemo(() => {
    const begriff = suche.trim().toLowerCase()
    return alle
      .filter((z) => auchErledigte || !z.gesuch.erledigt)
      .filter((z) => !begriff || `${z.kunde.firma} ${z.kunde.ansprechpartner} ${z.gesuch.titel} ${z.gesuch.lage} ${z.gesuch.objekttypen.join(' ')} ${z.gesuch.notizen}`.toLowerCase().includes(begriff))
      .map((z) => ({ ...z, treffer: passendeObjekte(z.gesuch, state.objekte) }))
      .sort((a, b) => b.gesuch.erstelltAm.localeCompare(a.gesuch.erstelltAm))
  }, [alle, state.objekte, suche, auchErledigte])

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Gesuche</h1>
          <p className="text-sm text-slate-500">
            {zeilen.length} {zeilen.length === 1 ? 'Gesuch' : 'Gesuche'} · wird laufend mit den {state.objekte.length} Objekten abgeglichen
          </p>
        </div>
        <PrimaryButton onClick={() => setNeu(true)}>
          <Plus size={15} /> Neues Gesuch
        </PrimaryButton>
      </div>

      {neueTreffer.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-slate-100 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-800">Neue Treffer</h2>
            <span className="text-xs text-slate-400">
              {neueTreffer.length} in den letzten {NEU_TAGE} Tagen
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {(alleNeuen ? neueTreffer : neueTreffer.slice(0, NEUE_ZUERST)).map((n, i) => (
              <li key={n.meldung.id} className={`${!alleNeuen && i >= NEUE_ZUERST_HANDY ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm`}>
                <div className="min-w-0 flex-1 basis-60 break-words">
                  <Link to={`/immobilien/objekte/${n.objekt.id}`} className="font-medium text-accent-600 hover:underline">
                    {n.objekt.bezeichnung}
                  </Link>
                  <span className="text-slate-500"> passt zu „{n.gesuch.titel}“ von </span>
                  <Link to={kontaktPfad(n.bereich, n.kunde.id)} className="font-medium text-accent-600 hover:underline">
                    {n.kunde.firma || n.kunde.ansprechpartner}
                  </Link>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${n.sicher ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{n.sicher ? 'Treffer' : 'zu prüfen'}</span>
                  <span className="text-slate-400">{entdecktText(n.meldung.entdecktAm)}</span>
                </div>
              </li>
            ))}
          </ul>
          {neueTreffer.length > NEUE_ZUERST_HANDY && (
            <button
              onClick={() => setAlleNeuen(!alleNeuen)}
              className={`${neueTreffer.length > NEUE_ZUERST ? '' : 'sm:hidden'} w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-accent-600 hover:bg-slate-50`}
              aria-expanded={alleNeuen}
            >
              {alleNeuen ? 'weniger anzeigen' : `alle ${neueTreffer.length} anzeigen`}
            </button>
          )}
        </Card>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-52 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-8`} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Ort, Objektart …" aria-label="Gesuche durchsuchen" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={auchErledigte} onChange={(e) => setAuchErledigte(e.target.checked)} /> auch erledigte zeigen
        </label>
      </Card>

      {zeilen.length === 0 ? (
        <EmptyState text="Noch kein Gesuch erfasst. Über „Neues Gesuch“ ist es in einer Minute angelegt." />
      ) : (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {zeilen.map(({ gesuch: g, kunde, bereich, treffer }) => {
            const schluessel = `${kunde.id}:${g.id}`
            const auf = offen === schluessel
            const sicher = treffer.filter((t) => t.offen.length === 0).length
            const kontaktLink = kontaktPfad(bereich, kunde.id)
            const hatNeue = treffer.some((t) => neuePaare.has(paarSchluessel(g.id, t.objekt.id)))
            return (
              <div key={schluessel} className={g.erledigt ? 'opacity-60' : ''}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="text-sm font-medium text-slate-800">{g.titel}</div>
                    <div className="text-xs text-slate-500">
                      {[g.objekttypen.join(', ') || 'Objektart egal', g.lage || 'Lage egal', budgetText(g), ...eckdatenTexte(g)].filter((x) => x !== '–').join(' · ')}
                    </div>
                  </div>
                  <div className="min-w-40 text-sm">
                    <Link to={kontaktLink} className="font-medium text-accent-600 hover:underline">
                      {kunde.firma}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {bereich === 'immobilienkunden' ? 'Immobilien-Kontakt' : kundeBereichLabel(bereich)} · {fmtDate(g.erstelltAm)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOffen(auf ? null : schluessel)}
                      disabled={treffer.length === 0}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                        sicher > 0 ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : treffer.length > 0 ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-slate-50 text-slate-400'
                      }`}
                      title="Treffer: alle Angaben passen. Zu prüfen: Beim Objekt fehlt eine Angabe (z. B. der Kaufpreis), deshalb ist der Abgleich nicht sicher."
                      aria-expanded={auf}
                    >
                      {treffer.length === 0 ? 'kein Treffer' : [sicher > 0 ? `${sicher} Treffer` : '', treffer.length - sicher > 0 ? `${treffer.length - sicher} zu prüfen` : ''].filter(Boolean).join(' · ')}
                      {treffer.length > 0 && <ChevronDown size={13} className={auf ? 'rotate-180' : ''} />}
                    </button>
                    {hatNeue && <NeuMarke />}
                  </div>
                </div>
                {auf && (
                  <ul className="space-y-1 bg-slate-50 px-4 py-3">
                    {treffer.map((t) => (
                      <li key={t.objekt.id} className="text-sm">
                        <Link to={`/immobilien/objekte/${t.objekt.id}`} className="font-medium text-accent-600 hover:underline">
                          {t.objekt.bezeichnung}
                        </Link>
                        {neuePaare.has(paarSchluessel(g.id, t.objekt.id)) && (
                          <>
                            {' '}
                            <NeuMarke />
                          </>
                        )}
                        <span className="text-xs text-slate-500">
                          {' '}
                          · {t.objekt.typ}
                          {t.objekt.kaufpreis > 0 ? ` · ${fmtEUR(t.objekt.kaufpreis)}` : ''} · {t.passt.join(', ')}
                        </span>
                        {t.offen.length > 0 && <span className="text-xs text-amber-600"> · {t.offen.join(', ')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </Card>
      )}

      <Modal open={neu} onClose={() => setNeu(false)} title="Neues Gesuch">
        {neu && (
          <NeuesGesuch
            kontakte={state.immobilienKunden}
            onAbbrechen={() => setNeu(false)}
            onSpeichern={(kontakt, gesuch) => {
              if (typeof kontakt === 'string') {
                const k = state.immobilienKunden.find((x) => x.id === kontakt)
                if (k) dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'immobilienkunden', id: k.id, patch: { gesuche: [gesuch, ...(k.gesuche ?? [])], letzteAktivitaet: today() } })
              } else {
                const wer = mitarbeiter?.name ?? CURRENT_USER
                dispatch({
                  type: 'ADD_KUNDE_IN_BEREICH',
                  bereich: 'immobilienkunden',
                  kunde: {
                    id: uid('ik'),
                    firma: kontakt.name,
                    ansprechpartner: kontakt.name,
                    email: kontakt.email,
                    telefon: kontakt.telefon,
                    prioritaet: 'Mittel',
                    status: 'interessent',
                    followUp: { date: '', note: '', done: false },
                    verantwortlich: wer,
                    letzteAktivitaet: today(),
                    activities: [{ id: uid('act'), date: today(), text: `Kontakt mit Gesuch „${gesuch.titel}" angelegt`, user: wer }],
                    gesuche: [gesuch],
                  },
                })
              }
              setNeu(false)
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function NeuesGesuch({
  kontakte,
  onSpeichern,
  onAbbrechen,
}: {
  kontakte: Kunde[]
  onSpeichern: (kontakt: string | { name: string; telefon: string; email: string }, gesuch: Gesuch) => void
  onAbbrechen: () => void
}) {
  const [kontaktId, setKontaktId] = useState('')
  const [name, setName] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')
  const sortiert = [...kontakte].sort((a, b) => a.firma.localeCompare(b.firma, 'de'))
  const kontaktFehlt = kontaktId === '' && name.trim() === ''

  return (
    <div>
      <Field label="Wer sucht?">
        <select className={inputClass} value={kontaktId} onChange={(e) => setKontaktId(e.target.value)}>
          <option value="">Neuer Kontakt …</option>
          {sortiert.map((k) => (
            <option key={k.id} value={k.id}>
              {k.firma}
            </option>
          ))}
        </select>
      </Field>
      {kontaktId === '' && (
        <div className="mb-1 grid grid-cols-1 gap-x-3 sm:grid-cols-3">
          <Field label="Name oder Firma">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Telefon">
            <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} />
          </Field>
          <Field label="E-Mail">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
      )}
      {kontaktFehlt && <p className="mb-3 text-xs text-amber-600">Bitte einen Kontakt wählen oder einen Namen eintragen.</p>}
      <div className={kontaktFehlt ? 'pointer-events-none opacity-50' : ''}>
        <GesuchFormular onAbbrechen={onAbbrechen} onSpeichern={(g) => onSpeichern(kontaktId || { name: name.trim(), telefon: telefon.trim(), email: email.trim() }, g)} />
      </div>
    </div>
  )
}
