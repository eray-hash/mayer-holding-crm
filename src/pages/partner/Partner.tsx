// Partner und Vermittler (/partner, 22.11.2026): Verzeichnis aller Vermittler, Makler, Tippgeber, Notare,
// Steuerberater, Banken und Gutachter — mit Kontakt, vereinbarter Provision, was sie gebracht haben
// (Akten/Objekte) und Summe der offenen Provisionen. Dazu ein Erst-Vorschlag „Aus dem CRM übernehmen“:
// liest Vermittler-Feld, Objekt-Verlauf und Makler-Akten (Kern supabase/functions/_shared/partnerKern.ts),
// zeigt eine Vorschau und legt erst nach Klick an. Daten: src/lib/partner.ts. Die Zuordnungen sieht nur,
// wer die Akte bzw. das Objekt sehen darf (Regel in der Datenbank).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookUser, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { useApp, type AppData } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Field, Modal, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from '../../components/ui'
import { aktePfad, akteName, findeAkte, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { fmtEURCent } from '../../lib/dates'
import {
  aenderePartner,
  aendereBezug,
  ladeBezuege,
  ladePartner,
  legePartnerAn,
  loescheBezug,
  loeschePartner,
  ordneZu,
  uebernehmeKandidaten,
  type Partner,
  type PartnerBezug,
} from '../../lib/partner'
import {
  BEZUG_ROLLEN,
  PARTNER_ARTEN,
  PARTNER_ART_NAME,
  PROVISION_STATUS,
  PROVISION_STATUS_NAME,
  ROLLE_NAME,
  aehnlichePartner,
  findePartnerKandidaten,
  leseBetrag,
  offeneProvision,
  partnerName,
  type AkteEingabe,
  type BezugRolle,
  type Kandidat,
  type PartnerArt,
  type ProvisionStatus,
} from '../../../supabase/functions/_shared/partnerKern.ts'

type Ziel = { art: 'Akte' | 'Objekt'; titel: string; pfad?: string; gefunden: boolean }

function zielVon(state: AppData, b: Pick<PartnerBezug, 'kundeId' | 'objektId'>): Ziel {
  if (b.kundeId) {
    const a = findeAkte(state, b.kundeId)
    return a ? { art: 'Akte', titel: akteName(a.kunde), pfad: aktePfad(a.bereich, a.kunde), gefunden: true } : { art: 'Akte', titel: 'Akte (nicht geladen)', gefunden: false }
  }
  const o = state.objekte.find((x) => x.id === b.objektId)
  if (o) return { art: 'Objekt', titel: o.bezeichnung || o.adresse || 'Objekt', pfad: `/immobilien/objekte/${o.id}`, gefunden: true }
  const p = state.privatObjekte.find((x) => x.id === b.objektId)
  return p ? { art: 'Objekt', titel: p.bezeichnung || p.adresse || 'Objekt', gefunden: true } : { art: 'Objekt', titel: 'Objekt (nicht geladen)', gefunden: false }
}

const LEERER_PARTNER: Partner = {
  id: '',
  name: '',
  firma: '',
  art: 'vermittler',
  email: '',
  telefon: '',
  adresse: '',
  notiz: '',
  provisionVereinbarung: '',
  provisionSatz: null,
  akteId: null,
  aktiv: true,
  erstelltVon: '',
  erstelltAm: '',
}

export function PartnerSeite() {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [params, setParams] = useSearchParams()
  const [partner, setPartner] = useState<Partner[]>([])
  const [bezuege, setBezuege] = useState<PartnerBezug[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [artFilter, setArtFilter] = useState<PartnerArt | ''>('')
  const [nurOffene, setNurOffene] = useState(false)
  const [mitInaktiven, setMitInaktiven] = useState(false)
  const [neu, setNeu] = useState(false)
  const [vorschlag, setVorschlag] = useState(false)
  const offenId = params.get('id')

  const laden = useCallback(async () => {
    setLaedt(true)
    try {
      const [p, b] = await Promise.all([ladePartner(), ladeBezuege()])
      setPartner(p)
      setBezuege(b)
      setFehler('')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Partner ließen sich nicht laden.')
    } finally {
      setLaedt(false)
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  // Im Modus „Ansehen als …“ lädt die Datenbank mit dem eigenen Login: nur Zuordnungen zeigen, deren
  // Akte/Objekt die angesehene Person im App-Zustand hat.
  const sichtbareBezuege = useMemo(() => (nutzer.nurLesen ? bezuege.filter((b) => zielVon(state, b).gefunden) : bezuege), [bezuege, nutzer.nurLesen, state])
  const jePartner = useMemo(() => {
    const m = new Map<string, PartnerBezug[]>()
    for (const b of sichtbareBezuege) m.set(b.partnerId, [...(m.get(b.partnerId) ?? []), b])
    return m
  }, [sichtbareBezuege])

  const gefiltert = useMemo(() => {
    const t = suche.trim().toLowerCase()
    return partner.filter((p) => {
      if (!mitInaktiven && !p.aktiv) return false
      if (artFilter && p.art !== artFilter) return false
      if (nurOffene && !offeneProvision(jePartner.get(p.id) ?? []).anzahl) return false
      if (!t) return true
      return [p.name, p.firma, p.email, p.telefon, p.notiz, PARTNER_ART_NAME[p.art]].some((x) => x.toLowerCase().includes(t))
    }).sort((a, b) => partnerName(a).localeCompare(partnerName(b), 'de'))
  }, [partner, suche, artFilter, nurOffene, mitInaktiven, jePartner])

  const gesamtOffen = useMemo(() => offeneProvision(sichtbareBezuege.map((b) => ({ provision_status: b.provisionStatus, betrag: b.betrag }))), [sichtbareBezuege])
  const offenerPartner = offenId ? partner.find((p) => p.id === offenId) : undefined

  function oeffne(id: string | null) {
    const n = new URLSearchParams(params)
    if (id) n.set('id', id)
    else n.delete('id')
    setParams(n, { replace: true })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-800">
            <BookUser size={20} className="text-accent-600" /> Partner und Vermittler
          </h1>
          <p className="text-sm text-slate-500">
            Vermittler, Makler, Tippgeber, Notare, Steuerberater, Banken und Gutachter — wer welche Akte oder welches Objekt gebracht hat und welche Provision vereinbart ist.
          </p>
        </div>
        {!nutzer.nurLesen && (
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => setVorschlag(true)}>
              <Sparkles size={14} /> Aus dem CRM übernehmen
            </SecondaryButton>
            <PrimaryButton onClick={() => setNeu(true)}>
              <Plus size={14} /> Neuer Partner
            </PrimaryButton>
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500">Aktive Partner</p>
          <p className="text-lg font-semibold text-slate-800">{partner.filter((p) => p.aktiv).length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Gebrachte Akten und Objekte</p>
          <p className="text-lg font-semibold text-slate-800">{sichtbareBezuege.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500">Offene Provisionen</p>
          <p className="text-lg font-semibold text-slate-800">{fmtEURCent(gesamtOffen.summe)}</p>
          {gesamtOffen.ohneBetrag > 0 && <p className="text-xs text-amber-700">{gesamtOffen.ohneBetrag} offene ohne Betrag</p>}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} className={`${inputClass} pl-8`} placeholder="Name, Firma, E-Mail, Telefon …" />
        </div>
        <select value={artFilter} onChange={(e) => setArtFilter(e.target.value as PartnerArt | '')} className={`${inputClass} w-auto`}>
          <option value="">Alle Arten</option>
          {PARTNER_ARTEN.map((a) => <option key={a} value={a}>{PARTNER_ART_NAME[a]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={nurOffene} onChange={(e) => setNurOffene(e.target.checked)} /> nur mit offener Provision
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={mitInaktiven} onChange={(e) => setMitInaktiven(e.target.checked)} /> auch nicht mehr aktive
        </label>
      </div>

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Partner</th>
              <th className="px-4 py-3">Art</th>
              <th className="hidden px-4 py-3 md:table-cell">Kontakt</th>
              <th className="px-4 py-3">Gebracht</th>
              <th className="px-4 py-3 text-right">Provision offen</th>
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((p) => {
              const liste = jePartner.get(p.id) ?? []
              const offen = offeneProvision(liste.map((b) => ({ provision_status: b.provisionStatus, betrag: b.betrag })))
              const akten = liste.filter((b) => b.kundeId).length
              const objekte = liste.filter((b) => b.objektId && !b.kundeId).length
              return (
                <tr key={p.id} onClick={() => oeffne(p.id)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{partnerName(p)}</div>
                    {!p.aktiv && <div className="text-xs text-slate-400">nicht mehr aktiv</div>}
                    {p.provisionVereinbarung && <div className="max-w-xs truncate text-xs text-slate-500">Provision: {p.provisionVereinbarung}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{PARTNER_ART_NAME[p.art]}</td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                    {p.telefon && <div>{p.telefon}</div>}
                    {p.email && <div className="truncate">{p.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {akten || objekte ? [akten ? `${akten} ${akten === 1 ? 'Akte' : 'Akten'}` : '', objekte ? `${objekte} ${objekte === 1 ? 'Objekt' : 'Objekte'}` : ''].filter(Boolean).join(', ') : '–'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {offen.anzahl ? (
                      <span className="font-medium text-amber-800">
                        {fmtEURCent(offen.summe)}
                        {offen.ohneBetrag ? <span className="block text-xs font-normal text-amber-700">+ {offen.ohneBetrag} ohne Betrag</span> : null}
                      </span>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!laedt && gefiltert.length === 0 && (
          <div className="p-6">
            <EmptyState text={partner.length ? 'Kein Partner passt zur Auswahl.' : 'Noch keine Partner erfasst. Leg einen an oder lass dir mit „Aus dem CRM übernehmen“ Vorschläge zeigen.'} />
          </div>
        )}
        {laedt && <p className="p-6 text-center text-sm text-slate-400">Lädt …</p>}
      </Card>

      {offenerPartner && (
        <PartnerDetail
          key={offenerPartner.id}
          partner={offenerPartner}
          bezuege={jePartner.get(offenerPartner.id) ?? []}
          alle={partner}
          onClose={() => oeffne(null)}
          onPartner={(p) => setPartner((l) => l.map((x) => (x.id === p.id ? p : x)))}
          onGeloescht={(id) => {
            setPartner((l) => l.filter((x) => x.id !== id))
            setBezuege((l) => l.filter((x) => x.partnerId !== id))
            oeffne(null)
          }}
          onBezuege={(f) => setBezuege(f)}
        />
      )}
      {neu && (
        <PartnerFormularFenster
          alle={partner}
          onClose={() => setNeu(false)}
          onAngelegt={(p) => {
            setPartner((l) => [...l, p])
            setNeu(false)
            oeffne(p.id)
          }}
        />
      )}
      {vorschlag && (
        <VorschlagFenster
          partner={partner}
          bezuege={bezuege}
          onClose={() => setVorschlag(false)}
          onFertig={() => {
            setVorschlag(false)
            laden()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Formular (Kontakt, Provision)

function PartnerFelder({ wert, setWert, nurLesen }: { wert: Partner; setWert: (p: Partner) => void; nurLesen: boolean }) {
  const setze = <K extends keyof Partner>(k: K, v: Partner[K]) => setWert({ ...wert, [k]: v })
  return (
    <fieldset disabled={nurLesen} className="grid gap-x-3 sm:grid-cols-2">
      <Field label="Name (Person)">
        <input value={wert.name} onChange={(e) => setze('name', e.target.value)} className={inputClass} placeholder="z. B. Helmut Dick" />
      </Field>
      <Field label="Firma">
        <input value={wert.firma} onChange={(e) => setze('firma', e.target.value)} className={inputClass} placeholder="z. B. HD-IMMO" />
      </Field>
      <Field label="Art">
        <select value={wert.art} onChange={(e) => setze('art', e.target.value as PartnerArt)} className={inputClass}>
          {PARTNER_ARTEN.map((a) => <option key={a} value={a}>{PARTNER_ART_NAME[a]}</option>)}
        </select>
      </Field>
      <Field label="Telefon">
        <input value={wert.telefon} onChange={(e) => setze('telefon', e.target.value)} className={inputClass} type="tel" />
      </Field>
      <Field label="E-Mail">
        <input value={wert.email} onChange={(e) => setze('email', e.target.value)} className={inputClass} type="email" />
      </Field>
      <Field label="Anschrift">
        <input value={wert.adresse} onChange={(e) => setze('adresse', e.target.value)} className={inputClass} />
      </Field>
      <Field label="Vereinbarte Provision (allgemein)">
        <input value={wert.provisionVereinbarung} onChange={(e) => setze('provisionVereinbarung', e.target.value)} className={inputClass} placeholder="z. B. 10 % vom Beratungshonorar nach Zahlungseingang" />
      </Field>
      <Field label="Provisionssatz in %">
        <input
          value={wert.provisionSatz === null ? '' : String(wert.provisionSatz).replace('.', ',')}
          onChange={(e) => {
            const t = e.target.value.trim()
            const n = t === '' ? null : Number(t.replace(',', '.'))
            setze('provisionSatz', n === null || Number.isNaN(n) ? null : n)
          }}
          className={inputClass}
          inputMode="decimal"
          placeholder="z. B. 10"
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Notiz">
          <textarea value={wert.notiz} onChange={(e) => setze('notiz', e.target.value)} rows={3} className={inputClass} />
        </Field>
      </div>
    </fieldset>
  )
}

function PartnerFormularFenster({ alle, onClose, onAngelegt }: { alle: Partner[]; onClose: () => void; onAngelegt: (p: Partner) => void }) {
  const nutzer = useKvNutzer()
  const [wert, setWert] = useState<Partner>(LEERER_PARTNER)
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const doppelt = aehnlichePartner(alle, wert)

  async function anlegen() {
    if (!wert.name.trim() && !wert.firma.trim()) {
      setFehler('Bitte einen Namen oder eine Firma angeben.')
      return
    }
    setArbeitet(true)
    try {
      const { id: _id, erstelltVon: _v, erstelltAm: _a, ...felder } = wert
      onAngelegt(await legePartnerAn(felder, nutzer.name))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Partner ließ sich nicht anlegen.')
      setArbeitet(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Neuer Partner" width="max-w-2xl" aktionen={<PrimaryButton onClick={anlegen} disabled={arbeitet}>{arbeitet ? 'Speichert …' : 'Anlegen'}</PrimaryButton>}>
      {doppelt.length > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          Gibt es vielleicht schon: {doppelt.slice(0, 3).map((p) => partnerName(p)).join(', ')}. Bitte prüfen, bevor du einen zweiten Eintrag anlegst.
        </p>
      )}
      <PartnerFelder wert={wert} setWert={setWert} nurLesen={false} />
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Ansicht eines Partners

function PartnerDetail({
  partner,
  bezuege,
  alle,
  onClose,
  onPartner,
  onGeloescht,
  onBezuege,
}: {
  partner: Partner
  bezuege: PartnerBezug[]
  alle: Partner[]
  onClose: () => void
  onPartner: (p: Partner) => void
  onGeloescht: (id: string) => void
  onBezuege: (f: (l: PartnerBezug[]) => PartnerBezug[]) => void
}) {
  const { state } = useApp()
  const { mitarbeiter } = useAuth()
  const nutzer = useKvNutzer()
  const [wert, setWert] = useState<Partner>(partner)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const geaendert = JSON.stringify(wert) !== JSON.stringify(partner)
  const darfLoeschen = !nutzer.nurLesen && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || mitarbeiter?.ist_admin === true)
  const offen = offeneProvision(bezuege.map((b) => ({ provision_status: b.provisionStatus, betrag: b.betrag })))
  const eigeneAkte = partner.akteId ? findeAkte(state, partner.akteId) : undefined
  const doppelt = aehnlichePartner(alle.filter((p) => p.id !== partner.id), partner)

  async function speichern() {
    setArbeitet(true)
    setFehler('')
    try {
      const neu = await aenderePartner(partner, wert, nutzer.name)
      onPartner(neu)
      setWert(neu)
      setHinweis('Gespeichert.')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Partner ließ sich nicht speichern.')
    } finally {
      setArbeitet(false)
    }
  }

  async function loeschen() {
    if (!window.confirm(`${partnerName(partner)} endgültig löschen? Auch alle Zuordnungen zu Akten und Objekten werden entfernt. Das lässt sich nicht rückgängig machen.`)) return
    try {
      await loeschePartner(partner.id)
      onGeloescht(partner.id)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Partner ließ sich nicht löschen.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={partnerName(partner)}
      width="max-w-3xl"
      aktionen={!nutzer.nurLesen && geaendert && <PrimaryButton onClick={speichern} disabled={arbeitet}>{arbeitet ? 'Speichert …' : 'Speichern'}</PrimaryButton>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <StatusBadge label={PARTNER_ART_NAME[partner.art]} color="bg-slate-100 text-slate-700" />
          {!partner.aktiv && <StatusBadge label="nicht mehr aktiv" color="bg-slate-100 text-slate-500" />}
          {eigeneAkte && (
            <Link to={aktePfad(eigeneAkte.bereich, eigeneAkte.kunde)} className="text-accent-700 hover:underline">
              Eigene Akte: {akteName(eigeneAkte.kunde)}
            </Link>
          )}
          {partner.erstelltVon && <span>angelegt von {partner.erstelltVon}</span>}
        </div>
        {doppelt.length > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Ähnlicher Eintrag vorhanden: {doppelt.slice(0, 3).map((p) => partnerName(p)).join(', ')}.</p>
        )}

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">Offene Provision: </span>
          <strong className={offen.anzahl ? 'text-amber-800' : 'text-slate-700'}>{fmtEURCent(offen.summe)}</strong>
          <span className="text-slate-500"> aus {offen.anzahl} {offen.anzahl === 1 ? 'Fall' : 'Fällen'}{offen.ohneBetrag ? `, davon ${offen.ohneBetrag} noch ohne Betrag` : ''}</span>
        </div>

        <BezuegeListe partner={partner} bezuege={bezuege} onBezuege={onBezuege} />

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Kontakt und Vereinbarung</h3>
          <PartnerFelder wert={wert} setWert={setWert} nurLesen={nutzer.nurLesen} />
          {!nutzer.nurLesen && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={wert.aktiv} onChange={(e) => setWert({ ...wert, aktiv: e.target.checked })} /> aktiv
              </label>
              <div className="flex gap-2">
                {darfLoeschen && (
                  <SecondaryButton onClick={loeschen}>
                    <Trash2 size={14} /> Löschen
                  </SecondaryButton>
                )}
                <PrimaryButton onClick={speichern} disabled={!geaendert || arbeitet}>{arbeitet ? 'Speichert …' : 'Speichern'}</PrimaryButton>
              </div>
            </div>
          )}
        </div>
        {hinweis && !geaendert && <p className="text-xs text-emerald-700">{hinweis}</p>}
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      </div>
    </Modal>
  )
}

function BezuegeListe({ partner, bezuege, onBezuege }: { partner: Partner; bezuege: PartnerBezug[]; onBezuege: (f: (l: PartnerBezug[]) => PartnerBezug[]) => void }) {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [ziel, setZiel] = useState('')
  const [rolle, setRolle] = useState<BezugRolle>(partner.art === 'makler' ? 'angeboten' : partner.art === 'vermittler' || partner.art === 'tippgeber' ? 'vermittelt' : 'beraten')
  const [fehler, setFehler] = useState('')

  // Auswahl: alle sichtbaren Akten (ohne private) und Objekte der Holding
  const ziele = useMemo(() => {
    const l: { text: string; kundeId?: string; objektId?: string }[] = []
    for (const b of KUNDEN_BEREICHE) {
      if (b.id === 'privat') continue
      for (const k of b.get(state)) l.push({ text: `${akteName(k)} · ${b.label}`, kundeId: k.id })
    }
    for (const o of state.objekte) l.push({ text: `${o.bezeichnung || o.adresse} · Objekt`, objektId: o.id })
    return l.sort((a, b) => a.text.localeCompare(b.text, 'de'))
  }, [state])

  async function zuordnen() {
    const z = ziele.find((x) => x.text === ziel.trim())
    if (!z) {
      setFehler('Bitte eine Akte oder ein Objekt aus der Liste wählen.')
      return
    }
    try {
      const neu = await ordneZu({ partnerId: partner.id, kundeId: z.kundeId, objektId: z.objektId, rolle }, nutzer.name)
      onBezuege((l) => [neu, ...l])
      setZiel('')
      setFehler('')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht speichern.')
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Gebrachte Akten und Objekte</h3>
      {bezuege.length === 0 ? (
        <p className="mb-2 text-sm text-slate-400">Noch nichts zugeordnet (oder nur Akten, die du nicht sehen darfst).</p>
      ) : (
        <div className="mb-2 space-y-2">
          {bezuege.map((b) => (
            <BezugZeile key={b.id} bezug={b} ziel={zielVon(state, b)} onGeaendert={(n) => onBezuege((l) => l.map((x) => (x.id === n.id ? n : x)))} onEntfernt={(id) => onBezuege((l) => l.filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
      {!nutzer.nurLesen && (
        <div className="flex flex-wrap gap-2">
          <input value={ziel} onChange={(e) => setZiel(e.target.value)} list={`ziele-${partner.id}`} className={`${inputClass} min-w-[14rem] flex-1`} placeholder="Akte oder Objekt zuordnen …" />
          <datalist id={`ziele-${partner.id}`}>{ziele.map((z) => <option key={`${z.kundeId ?? ''}${z.objektId ?? ''}`} value={z.text} />)}</datalist>
          <select value={rolle} onChange={(e) => setRolle(e.target.value as BezugRolle)} className={`${inputClass} w-auto`}>
            {BEZUG_ROLLEN.map((r) => <option key={r} value={r}>{ROLLE_NAME[r]}</option>)}
          </select>
          <SecondaryButton onClick={zuordnen} disabled={!ziel.trim()}>
            <Plus size={14} /> Zuordnen
          </SecondaryButton>
        </div>
      )}
      {fehler && <p className="mt-1 text-xs text-rose-600">{fehler}</p>}
    </div>
  )
}

function BezugZeile({ bezug, ziel, onGeaendert, onEntfernt }: { bezug: PartnerBezug; ziel: Ziel; onGeaendert: (b: PartnerBezug) => void; onEntfernt: (id: string) => void }) {
  const nutzer = useKvNutzer()
  const [wert, setWert] = useState(bezug)
  const [betragText, setBetragText] = useState(bezug.betrag === null ? '' : String(bezug.betrag).replace('.', ','))
  const [fehler, setFehler] = useState('')
  const betrag = betragText.trim() ? (leseBetrag(betragText) ?? NaN) : null
  const neu: PartnerBezug = { ...wert, betrag: betrag === null || Number.isNaN(betrag) ? null : betrag }
  const geaendert = JSON.stringify(neu) !== JSON.stringify(bezug)

  async function speichern() {
    if (betrag !== null && Number.isNaN(betrag)) {
      setFehler('Der Betrag ist keine gültige Zahl.')
      return
    }
    try {
      // Provision eingetragen, Stand noch „keine“ → offen
      const mitStand = neu.provisionStatus === 'keine' && (neu.provisionVereinbart.trim() || (neu.betrag ?? 0) > 0) && bezug.provisionStatus === 'keine' ? { ...neu, provisionStatus: 'offen' as ProvisionStatus } : neu
      const gespeichert = await aendereBezug(bezug, mitStand, nutzer.name)
      onGeaendert(gespeichert)
      setWert(gespeichert)
      setFehler('')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht speichern.')
    }
  }

  async function entfernen() {
    if (!window.confirm(`Zuordnung zu „${ziel.titel}“ entfernen?`)) return
    try {
      await loescheBezug(bezug.id)
      onEntfernt(bezug.id)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht entfernen.')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <span className="mr-1.5 text-xs text-slate-400">{ziel.art}</span>
          {ziel.pfad ? <Link to={ziel.pfad} className="font-medium text-accent-700 hover:underline">{ziel.titel}</Link> : <span className="font-medium text-slate-700">{ziel.titel}</span>}
        </div>
        {!nutzer.nurLesen && (
          <button type="button" onClick={entfernen} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600" aria-label="Zuordnung entfernen">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <fieldset disabled={nutzer.nurLesen} className="grid gap-2 sm:grid-cols-[auto_1fr_auto_8rem]">
        <select value={wert.rolle} onChange={(e) => setWert({ ...wert, rolle: e.target.value as BezugRolle })} className={`${inputClass} w-auto`}>
          {BEZUG_ROLLEN.map((r) => <option key={r} value={r}>{ROLLE_NAME[r]}</option>)}
        </select>
        <input value={wert.provisionVereinbart} onChange={(e) => setWert({ ...wert, provisionVereinbart: e.target.value })} className={inputClass} placeholder="Provision für diesen Fall" />
        <select value={wert.provisionStatus} onChange={(e) => setWert({ ...wert, provisionStatus: e.target.value as ProvisionStatus })} className={`${inputClass} w-auto`}>
          {PROVISION_STATUS.map((s) => <option key={s} value={s}>{PROVISION_STATUS_NAME[s]}</option>)}
        </select>
        <input value={betragText} onChange={(e) => setBetragText(e.target.value)} className={inputClass} placeholder="Betrag €" inputMode="decimal" />
        <input value={wert.notiz} onChange={(e) => setWert({ ...wert, notiz: e.target.value })} className={`${inputClass} sm:col-span-4`} placeholder="Notiz" />
      </fieldset>
      {geaendert && !nutzer.nurLesen && (
        <div className="mt-2 flex justify-end">
          <PrimaryButton onClick={speichern}>Speichern</PrimaryButton>
        </div>
      )}
      {fehler && <p className="mt-1 text-xs text-rose-600">{fehler}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Vorschlag „Aus dem CRM übernehmen“

function VorschlagFenster({ partner, bezuege, onClose, onFertig }: { partner: Partner[]; bezuege: PartnerBezug[]; onClose: () => void; onFertig: () => void }) {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const ergebnis = useMemo(() => {
    const akten: AkteEingabe[] = []
    for (const b of KUNDEN_BEREICHE) {
      if (b.id === 'privat') continue
      for (const k of b.get(state)) {
        akten.push({
          id: k.id,
          bereich: b.id,
          firma: k.firma,
          ansprechpartner: k.ansprechpartner,
          email: k.email,
          telefon: k.telefon,
          sachverhalt: k.sachverhalt,
          vermittler: k.vermittler ? { name: k.vermittler.name, kundeId: k.vermittler.kundeId } : null,
          activities: k.activities,
        })
      }
    }
    return findePartnerKandidaten({
      akten,
      objekte: state.objekte.map((o) => ({ id: o.id, bezeichnung: o.bezeichnung, adresse: o.adresse, activities: o.activities, privat_besitzer: o.privatBesitzer ?? null })),
      partner: partner.map((p) => ({ id: p.id, name: p.name, firma: p.firma, email: p.email, telefon: p.telefon, art: p.art, akte_id: p.akteId })),
      bezuege: bezuege.map((b) => ({ partner_id: b.partnerId, kunde_id: b.kundeId, objekt_id: b.objektId, rolle: b.rolle })),
    })
  }, [state, partner, bezuege])
  const [liste, setListe] = useState<Kandidat[]>(ergebnis.kandidaten)
  const [an, setAn] = useState<Set<string>>(() => new Set(ergebnis.kandidaten.filter((k) => k.sicher).map((k) => k.schluessel)))
  const [arbeitet, setArbeitet] = useState(false)
  const [meldung, setMeldung] = useState('')

  function aendere(schluessel: string, patch: Partial<Kandidat>) {
    setListe((l) => l.map((k) => (k.schluessel === schluessel ? { ...k, ...patch } : k)))
  }

  async function uebernehmen() {
    const auswahl = liste.filter((k) => an.has(k.schluessel))
    if (!auswahl.length) return
    setArbeitet(true)
    const r = await uebernehmeKandidaten(auswahl, nutzer.name)
    setArbeitet(false)
    if (r.fehler.length) {
      setMeldung(`${r.partner} Partner angelegt, ${r.bezuege} Zuordnungen gespeichert. Nicht geklappt: ${r.fehler.join(' · ')}`)
      return
    }
    onFertig()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Partner aus dem CRM übernehmen"
      width="max-w-4xl"
      aktionen={<PrimaryButton onClick={uebernehmen} disabled={arbeitet || an.size === 0}>{arbeitet ? 'Übernimmt …' : `Ausgewählte übernehmen (${an.size})`}</PrimaryButton>}
    >
      <p className="mb-3 text-sm text-slate-600">
        Gefunden in den Akten und Objekten, die du sehen darfst: Feld „Vermittler“, „Angeboten von …“ im Verlauf von Objekten, Makler-Akten und Vermittler-Hinweise im Verlauf.
        Angehakt sind die eindeutigen Fälle. Erst mit dem Knopf oben wird etwas angelegt.
        {ergebnis.schonErledigt > 0 && ` ${ergebnis.schonErledigt} ${ergebnis.schonErledigt === 1 ? 'Treffer ist' : 'Treffer sind'} schon vollständig erfasst.`}
      </p>
      {meldung && <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{meldung}</p>}
      {liste.length === 0 ? (
        <EmptyState text="Keine neuen Vorschläge — alles Gefundene ist schon erfasst." />
      ) : (
        <div className="space-y-2">
          {liste.map((k) => {
            const gewaehlt = an.has(k.schluessel)
            return (
              <div key={k.schluessel} className={`rounded-lg border p-3 ${gewaehlt ? 'border-accent-300 bg-accent-50/40' : 'border-slate-200'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    checked={gewaehlt}
                    onChange={(e) =>
                      setAn((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(k.schluessel)
                        else n.delete(k.schluessel)
                        return n
                      })
                    }
                    aria-label={`${partnerName(k)} übernehmen`}
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {k.vorhanden ? (
                      <p className="text-sm font-medium text-slate-800">
                        {k.vorhanden.name} <span className="font-normal text-slate-500">— gibt es schon, nur neue Zuordnungen</span>
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input value={k.name} onChange={(e) => aendere(k.schluessel, { name: e.target.value })} className={inputClass} placeholder="Name" />
                        <input value={k.firma} onChange={(e) => aendere(k.schluessel, { firma: e.target.value })} className={inputClass} placeholder="Firma" />
                        <select value={k.art} onChange={(e) => aendere(k.schluessel, { art: e.target.value as PartnerArt })} className={`${inputClass} w-auto`}>
                          {PARTNER_ARTEN.map((a) => <option key={a} value={a}>{PARTNER_ART_NAME[a]}</option>)}
                        </select>
                      </div>
                    )}
                    {!k.vorhanden && (k.email || k.telefon) && <p className="text-xs text-slate-500">{[k.telefon, k.email].filter(Boolean).join(' · ')}</p>}
                    <ul className="list-disc pl-4 text-xs text-slate-500">
                      {k.gruende.map((g) => <li key={g}>{g}</li>)}
                    </ul>
                    {k.bezuege.length > 0 && (
                      <p className="text-xs text-slate-700">
                        Zuordnungen: {k.bezuege.map((b) => `${ROLLE_NAME[b.rolle]} ${b.objekt_id ? 'Objekt' : 'Akte'} „${b.titel}“`).join(' · ')}
                      </p>
                    )}
                  </div>
                  {!k.sicher && <StatusBadge label="bitte prüfen" color="bg-amber-100 text-amber-800" />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
