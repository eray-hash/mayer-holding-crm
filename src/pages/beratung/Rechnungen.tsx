import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Check, X, Search } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, PrimaryButton, SecondaryButton, Modal, Field, EmptyState, inputClass } from '../../components/ui'
import { RechnungStatusBadge } from './KundenDetail'
import { fmtDate, today, uid, addDays, fmtEURCent } from '../../lib/dates'
import { holeLeistungen, type Leistung } from '../../lib/leistungen'
import { istUnbezahlt, istUeberfaellig, angezeigterStatus, rundeCent } from '../../lib/rechnungen'
import { KUNDEN_BEREICHE, kundeDetailPfad } from '../../data/kundenBereiche'
import type { Kunde, KundeBereich, Rechnung, RechnungStatus } from '../../types'

type FilterId = 'alle' | 'offen' | 'ueberfaellig' | 'bezahlt' | 'entwurf'

const FILTER: { id: FilterId; label: string; leer: string; passt: (r: Rechnung) => boolean }[] = [
  { id: 'alle', label: 'Alle', leer: 'Noch keine Rechnungen erfasst.', passt: () => true },
  { id: 'offen', label: 'Offen', leer: 'Keine offenen Rechnungen.', passt: istUnbezahlt },
  { id: 'ueberfaellig', label: 'Überfällig', leer: 'Keine überfälligen Rechnungen.', passt: istUeberfaellig },
  { id: 'bezahlt', label: 'Bezahlt', leer: 'Keine bezahlten Rechnungen.', passt: (r) => r.status === 'Bezahlt' },
  { id: 'entwurf', label: 'Entwurf', leer: 'Keine Entwürfe.', passt: (r) => r.status === 'Entwurf' },
]

export function Rechnungen() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterId>('alle')
  const [suche, setSuche] = useState('')
  const [formular, setFormular] = useState<{ rechnung?: Rechnung } | null>(null)
  const [loeschenId, setLoeschenId] = useState<string | null>(null)

  const kundenNachId = useMemo(() => {
    const map = new Map<string, { kunde: Kunde; bereich: KundeBereich }>()
    for (const b of KUNDEN_BEREICHE) for (const kunde of b.get(state)) map.set(kunde.id, { kunde, bereich: b.id })
    return map
  }, [state])

  const kpis = useMemo(() => {
    const summe = (liste: Rechnung[]) => liste.reduce((s, r) => s + r.betragBrutto, 0)
    const now = new Date()
    const quarter = Math.floor(now.getMonth() / 3)
    const bezahltQ = state.rechnungen
      .filter((r) => r.status === 'Bezahlt')
      .filter((r) => {
        const d = new Date(r.datum)
        return Math.floor(d.getMonth() / 3) === quarter && d.getFullYear() === now.getFullYear()
      })
    return { offen: summe(state.rechnungen.filter(istUnbezahlt)), ueberfaellig: summe(state.rechnungen.filter(istUeberfaellig)), bezahltQ: summe(bezahltQ) }
  }, [state.rechnungen])

  const aktiverFilter = FILTER.find((f) => f.id === filter)!
  const suchtext = suche.trim().toLowerCase()
  const sichtbar = state.rechnungen
    .filter(aktiverFilter.passt)
    .filter((r) => {
      if (!suchtext) return true
      const firma = kundenNachId.get(r.kundeId)?.kunde.firma ?? ''
      return `${r.nummer} ${firma} ${r.leistungBezeichnung ?? ''}`.toLowerCase().includes(suchtext)
    })
    .sort((a, b) => b.datum.localeCompare(a.datum))

  function alsBezahltMarkieren(r: Rechnung) {
    dispatch({ type: 'UPDATE_RECHNUNG', id: r.id, patch: { status: 'Bezahlt', mahnstufe: undefined } })
  }

  function loeschen(id: string) {
    dispatch({ type: 'DELETE_RECHNUNG', id })
    setLoeschenId(null)
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Rechnungen</h1>
          <p className="text-sm text-slate-500">Alle Rechnungen an Kunden, über alle Bereiche</p>
        </div>
        <PrimaryButton onClick={() => setFormular({})}><Plus size={15} /> Neue Rechnung</PrimaryButton>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Offen (noch nicht bezahlt)" value={fmtEURCent(kpis.offen)} />
        <Kpi label="Davon überfällig" value={fmtEURCent(kpis.ueberfaellig)} accent="text-rose-600" />
        <Kpi label="Bezahlt dieses Quartal" value={fmtEURCent(kpis.bezahltQ)} accent="text-emerald-600" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTER.map((f) => {
            const anzahl = state.rechnungen.filter(f.passt).length
            const aktiv = f.id === filter
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  aktiv ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label} <span className={aktiv ? 'text-white/80' : 'text-slate-400'}>{anzahl}</span>
              </button>
            )
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${inputClass} pl-8`}
            placeholder="Nummer, Kunde oder Leistung suchen …"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Nr.</th>
              <th className="px-4 py-3">Kunde</th>
              <th className="px-4 py-3">Leistung</th>
              <th className="px-4 py-3">Datum</th>
              <th className="px-4 py-3">Betrag (netto/brutto)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Zahlungsziel</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((r) => {
              const treffer = kundenNachId.get(r.kundeId)
              const ueberfaellig = istUeberfaellig(r)
              return (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.nummer}</td>
                  <td
                    className={`px-4 py-3 text-slate-600 ${treffer ? 'cursor-pointer hover:text-accent-700' : ''}`}
                    onClick={() => treffer && navigate(kundeDetailPfad(treffer.bereich, treffer.kunde.id))}
                  >
                    {treffer?.kunde.firma ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.leistungBezeichnung
                      ? `${r.leistungBezeichnung}${r.leistungMenge ? ` (${r.leistungMenge} × ${r.leistungEinheit})` : ''}`
                      : '–'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtDate(r.datum)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{fmtEURCent(r.betragNetto)} / {fmtEURCent(r.betragBrutto)}</td>
                  <td className="px-4 py-3"><RechnungStatusBadge status={angezeigterStatus(r)} /></td>
                  <td className={`whitespace-nowrap px-4 py-3 ${ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                    {r.status === 'Bezahlt' ? '–' : fmtDate(r.zahlungsziel)}
                  </td>
                  <td className="px-4 py-3">
                    {loeschenId === r.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => loeschen(r.id)} className="whitespace-nowrap rounded-md bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700">
                          Wirklich löschen?
                        </button>
                        <button type="button" onClick={() => setLoeschenId(null)} aria-label="Löschen abbrechen" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-0.5 text-slate-400">
                        {istUnbezahlt(r) && (
                          <button
                            type="button"
                            onClick={() => alsBezahltMarkieren(r)}
                            title="Als bezahlt markieren"
                            aria-label="Als bezahlt markieren"
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            <Check size={13} /> Bezahlt
                          </button>
                        )}
                        <button type="button" onClick={() => setFormular({ rechnung: r })} title="Bearbeiten" aria-label="Rechnung bearbeiten" className="rounded-md p-1.5 hover:bg-slate-100 hover:text-accent-600">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => setLoeschenId(r.id)} title="Löschen" aria-label="Rechnung löschen" className="rounded-md p-1.5 hover:bg-rose-50 hover:text-rose-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sichtbar.length === 0 && (
          <div className="p-4">
            <EmptyState text={suchtext ? 'Keine Rechnung passt zur Suche.' : aktiverFilter.leer} />
          </div>
        )}
      </Card>

      {formular && <RechnungFormular rechnung={formular.rechnung} onClose={() => setFormular(null)} />}
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ?? 'text-slate-800'}`}>{value}</div>
    </Card>
  )
}

const UST_SAETZE = [19, 7, 0]

// Betragsfelder sind Textfelder, damit "3.867,50" genauso eingegeben werden kann wie "3867.5".
function alsZahl(text: string): number {
  const t = text.trim().replace(/\s|€/g, '')
  if (!t) return NaN
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
}

function alsText(betrag: number): string {
  return rundeCent(betrag).toFixed(2).replace('.', ',')
}

function nummernVorschlag(rechnungen: Rechnung[]): string {
  const jahr = today().slice(0, 4)
  const vergeben = new Set(rechnungen.map((r) => r.nummer.trim().toLowerCase()))
  let n = rechnungen.filter((r) => r.datum.startsWith(jahr)).length + 1
  let vorschlag = `RE-${jahr}-${String(n).padStart(3, '0')}`
  while (vergeben.has(vorschlag.toLowerCase())) {
    n++
    vorschlag = `RE-${jahr}-${String(n).padStart(3, '0')}`
  }
  return vorschlag
}

// Anlegen und Bearbeiten in einem Formular. Alles ist von Hand eintragbar, damit auch eine bereits
// gestellte Rechnung (eigene Nummer, früheres Datum, centgenauer Betrag) nachgetragen werden kann —
// das alte Formular vergab eine Zufallsnummer, nahm immer das heutige Datum und rundete den
// Bruttobetrag auf ganze Euro.
function RechnungFormular({ rechnung, onClose }: { rechnung?: Rechnung; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const bereicheMitKunden = KUNDEN_BEREICHE.map((b) => ({ ...b, kunden: b.get(state) })).filter((b) => b.kunden.length > 0)

  const [kundeId, setKundeId] = useState(rechnung?.kundeId ?? bereicheMitKunden[0]?.kunden[0]?.id ?? '')
  const [nummer, setNummer] = useState(rechnung?.nummer ?? nummernVorschlag(state.rechnungen))
  const [datum, setDatum] = useState(rechnung?.datum ?? today())
  const [status, setStatus] = useState<RechnungStatus>(rechnung?.status ?? 'Entwurf')

  const [zahlungsziel, setZahlungsziel] = useState(rechnung?.zahlungsziel ?? addDays(today(), 14))
  const [zielVonHand, setZielVonHand] = useState(!!rechnung && rechnung.zahlungsziel !== addDays(rechnung.datum, 14))

  const erkannterSatz = rechnung ? UST_SAETZE.find((s) => Math.abs(rundeCent(rechnung.betragNetto * (1 + s / 100)) - rechnung.betragBrutto) < 0.011) : 19
  const [ustSatz, setUstSatz] = useState(erkannterSatz ?? 19)
  const [netto, setNetto] = useState(rechnung ? alsText(rechnung.betragNetto) : '')
  const [brutto, setBrutto] = useState(rechnung ? alsText(rechnung.betragBrutto) : '')
  const [bruttoVonHand, setBruttoVonHand] = useState(!!rechnung && erkannterSatz === undefined)

  const [leistungen, setLeistungen] = useState<Leistung[]>([])
  const [leistungId, setLeistungId] = useState('')
  const [bezeichnung, setBezeichnung] = useState(rechnung?.leistungBezeichnung ?? '')
  const [einheit, setEinheit] = useState<'Stunde' | 'Tag'>(rechnung?.leistungEinheit ?? 'Stunde')
  const [menge, setMenge] = useState(rechnung?.leistungMenge ?? 1)
  const [preisJeEinheit, setPreisJeEinheit] = useState(0)

  useEffect(() => {
    holeLeistungen()
      .then(setLeistungen)
      .catch(() => setLeistungen([]))
  }, [])

  const gewaehlteLeistung = leistungen.find((l) => l.id === leistungId)

  function nettoSetzen(text: string, satz = ustSatz) {
    setNetto(text)
    const n = alsZahl(text)
    if (!bruttoVonHand) setBrutto(Number.isFinite(n) ? alsText(n * (1 + satz / 100)) : '')
  }

  function satzSetzen(satz: number) {
    setUstSatz(satz)
    setBruttoVonHand(false)
    const n = alsZahl(netto)
    setBrutto(Number.isFinite(n) ? alsText(n * (1 + satz / 100)) : '')
  }

  function datumSetzen(neu: string) {
    setDatum(neu)
    if (!zielVonHand && neu) setZahlungsziel(addDays(neu, 14))
  }

  function leistungWaehlen(id: string) {
    setLeistungId(id)
    const l = leistungen.find((x) => x.id === id)
    if (!l) return
    const nutzeEinheit = l.preis_stunde_von != null ? 'Stunde' : 'Tag'
    const preis = nutzeEinheit === 'Stunde' ? l.preis_stunde_von! : (l.preis_tag_von ?? 0)
    setBezeichnung(l.bezeichnung)
    setEinheit(nutzeEinheit)
    setMenge(1)
    setPreisJeEinheit(preis)
    nettoSetzen(alsText(preis))
  }

  function einheitWaehlen(e: 'Stunde' | 'Tag') {
    setEinheit(e)
    if (!gewaehlteLeistung) return
    const preis = e === 'Stunde' ? (gewaehlteLeistung.preis_stunde_von ?? 0) : (gewaehlteLeistung.preis_tag_von ?? 0)
    setPreisJeEinheit(preis)
    nettoSetzen(alsText(preis * menge))
  }

  function mengeOderPreisAendern(neueMenge: number, neuerPreis: number) {
    setMenge(neueMenge)
    setPreisJeEinheit(neuerPreis)
    nettoSetzen(alsText(neueMenge * neuerPreis))
  }

  const nettoZahl = alsZahl(netto)
  const bruttoZahl = alsZahl(brutto)
  const nummerSauber = nummer.trim()
  const nummerVergeben = state.rechnungen.some((r) => r.id !== rechnung?.id && r.nummer.trim().toLowerCase() === nummerSauber.toLowerCase())
  const fehler = !kundeId
    ? 'Bitte einen Kunden wählen.'
    : !nummerSauber
      ? 'Bitte eine Rechnungsnummer eintragen.'
      : nummerVergeben
        ? `Die Rechnungsnummer ${nummerSauber} ist schon vergeben.`
        : !datum
          ? 'Bitte ein Rechnungsdatum eintragen.'
          : !Number.isFinite(nettoZahl) || nettoZahl < 0
            ? 'Bitte einen gültigen Nettobetrag eintragen.'
            : !Number.isFinite(bruttoZahl) || bruttoZahl <= 0
              ? 'Bitte einen gültigen Bruttobetrag eintragen.'
              : !zahlungsziel
                ? 'Bitte ein Zahlungsziel eintragen.'
                : ''

  function speichern() {
    if (fehler) return
    const bez = bezeichnung.trim()
    // Einheit/Menge gelten nur, solange die Leistung aus der Preisliste stammt bzw. beim Bearbeiten
    // unverändert geblieben ist — bei freier Bezeichnung gibt es dafür keine Grundlage.
    const mengeBehalten = !gewaehlteLeistung && !!rechnung && bez === (rechnung.leistungBezeichnung ?? '')
    const werte = {
      nummer: nummerSauber,
      kundeId,
      datum,
      betragNetto: rundeCent(nettoZahl),
      betragBrutto: rundeCent(bruttoZahl),
      status,
      zahlungsziel,
      leistungBezeichnung: bez || undefined,
      leistungEinheit: gewaehlteLeistung ? einheit : mengeBehalten ? rechnung?.leistungEinheit : undefined,
      leistungMenge: gewaehlteLeistung ? menge : mengeBehalten ? rechnung?.leistungMenge : undefined,
    }
    if (rechnung) {
      const mahnstufeWeg = status === 'Bezahlt' || status === 'Entwurf'
      dispatch({ type: 'UPDATE_RECHNUNG', id: rechnung.id, patch: mahnstufeWeg ? { ...werte, mahnstufe: undefined } : werte })
    } else {
      dispatch({ type: 'ADD_RECHNUNG', rechnung: { id: uid('r'), ...werte } })
    }
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={rechnung ? `Rechnung ${rechnung.nummer} bearbeiten` : 'Neue Rechnung'} width="max-w-xl">
      <Field label="Kunde">
        <select className={inputClass} value={kundeId} onChange={(e) => setKundeId(e.target.value)}>
          {bereicheMitKunden.length === 0 && <option value="">– noch keine Kunden angelegt –</option>}
          {bereicheMitKunden.map((b) => (
            <optgroup key={b.id} label={b.label}>
              {b.kunden.map((k) => <option key={k.id} value={k.id}>{k.firma}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Rechnungsnummer">
          <input className={inputClass} value={nummer} onChange={(e) => setNummer(e.target.value)} placeholder="z. B. RE-2026-001" />
        </Field>
        <Field label="Rechnungsdatum">
          <input type="date" className={inputClass} value={datum} onChange={(e) => datumSetzen(e.target.value)} />
        </Field>
      </div>

      <Field label="Leistung aus der Preisliste (optional)">
        <select className={inputClass} value={leistungId} onChange={(e) => leistungWaehlen(e.target.value)}>
          <option value="">– Freie Eingabe –</option>
          {leistungen.map((l) => <option key={l.id} value={l.id}>{l.bezeichnung}</option>)}
        </select>
      </Field>
      <Field label="Leistung (Bezeichnung auf der Rechnung, optional)">
        <input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} placeholder="z. B. Vermögensschutzberatung" />
      </Field>

      {gewaehlteLeistung && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Einheit">
            <select
              className={inputClass}
              value={einheit}
              onChange={(e) => einheitWaehlen(e.target.value as 'Stunde' | 'Tag')}
              disabled={gewaehlteLeistung.preis_stunde_von == null || gewaehlteLeistung.preis_tag_von == null}
            >
              {gewaehlteLeistung.preis_stunde_von != null && <option value="Stunde">Stunde</option>}
              {gewaehlteLeistung.preis_tag_von != null && <option value="Tag">Tag</option>}
            </select>
          </Field>
          <Field label="Menge">
            <input type="number" min={0} step="0.25" className={inputClass} value={menge} onChange={(e) => mengeOderPreisAendern(Number(e.target.value), preisJeEinheit)} />
          </Field>
          <Field label="Preis je Einheit (€)">
            <input type="number" step="0.01" className={inputClass} value={preisJeEinheit} onChange={(e) => mengeOderPreisAendern(menge, Number(e.target.value))} />
          </Field>
        </div>
      )}
      {gewaehlteLeistung && (
        <p className="-mt-2 mb-3 text-xs text-slate-400">
          Preisspanne lt. Preisliste:{' '}
          {einheit === 'Stunde'
            ? `${fmtEURCent(gewaehlteLeistung.preis_stunde_von ?? 0)} – ${fmtEURCent(gewaehlteLeistung.preis_stunde_bis ?? 0)}`
            : `${fmtEURCent(gewaehlteLeistung.preis_tag_von ?? 0)} – ${fmtEURCent(gewaehlteLeistung.preis_tag_bis ?? 0)}`}{' '}
          je {einheit}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Betrag netto (€)">
          <input inputMode="decimal" className={inputClass} value={netto} onChange={(e) => nettoSetzen(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Umsatzsteuer">
          <select className={inputClass} value={ustSatz} onChange={(e) => satzSetzen(Number(e.target.value))}>
            {UST_SAETZE.map((s) => <option key={s} value={s}>{s} %</option>)}
          </select>
        </Field>
        <Field label="Betrag brutto (€)">
          <input
            inputMode="decimal"
            className={inputClass}
            value={brutto}
            onChange={(e) => {
              setBrutto(e.target.value)
              setBruttoVonHand(true)
            }}
            placeholder="0,00"
          />
        </Field>
      </div>
      <p className="-mt-2 mb-3 text-xs text-slate-400">
        {bruttoVonHand ? (
          <>
            Brutto von Hand eingetragen.{' '}
            <button type="button" onClick={() => satzSetzen(ustSatz)} className="font-medium text-accent-600 hover:text-accent-700">
              Wieder aus Netto und {ustSatz} % berechnen
            </button>
          </>
        ) : (
          'Brutto wird aus Netto und Umsatzsteuer berechnet und kann überschrieben werden.'
        )}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Zahlungsziel">
          <input
            type="date"
            className={inputClass}
            value={zahlungsziel}
            onChange={(e) => {
              setZahlungsziel(e.target.value)
              setZielVonHand(true)
            }}
          />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as RechnungStatus)}>
            <option value="Entwurf">Entwurf</option>
            <option value="Versendet">Versendet (offen)</option>
            <option value="Bezahlt">Bezahlt</option>
            <option value="Überfällig">Überfällig</option>
          </select>
        </Field>
      </div>

      {fehler && <p className="mb-1 mt-1 text-xs text-rose-600">{fehler}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={speichern} disabled={!!fehler}>{rechnung ? 'Änderungen speichern' : 'Rechnung anlegen'}</PrimaryButton>
      </div>
    </Modal>
  )
}
