// „Vermittelt durch“ (22.11.2026): kleine Auswahl in Akte und Objekt, welcher Partner (Vermittler, Makler,
// Tippgeber, Notar, Bank …) den Fall gebracht hat bzw. dabei ist — mit Provision. Speichert sofort in
// partner_bezug (nicht erst mit dem Speichern-Knopf des umgebenden Fensters). Die Datenbank zeigt eine
// Zuordnung nur, wenn die Akte/das Objekt selbst sichtbar ist. Partner pflegen: Seite /partner.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookUser, Plus, X } from 'lucide-react'
import { inputClass } from './ui'
import { useKvNutzer } from './KostenvoranschlaegeSection'
import { fmtEURCent } from '../lib/dates'
import { aendereBezug, ladeBezuege, ladePartner, legePartnerAn, loescheBezug, ordneZu, type Partner, type PartnerBezug } from '../lib/partner'
import {
  PARTNER_ARTEN,
  PARTNER_ART_NAME,
  PROVISION_STATUS,
  PROVISION_STATUS_NAME,
  ROLLE_NAME,
  aehnlichePartner,
  leseBetrag,
  partnerName,
  type BezugRolle,
  type PartnerArt,
  type ProvisionStatus,
} from '../../supabase/functions/_shared/partnerKern.ts'

export function PartnerAuswahl({
  kundeId,
  objektId,
  standardRolle = 'vermittelt',
  titel = 'Vermittelt durch',
  nurLesen: nurLesenVorgabe,
  onGewaehlt,
}: {
  kundeId?: string
  objektId?: string
  standardRolle?: BezugRolle
  titel?: string
  nurLesen?: boolean
  /** Nach dem Zuordnen, z. B. um das alte Textfeld „Vermittler“ mitzufüllen. */
  onGewaehlt?: (p: Partner) => void
}) {
  const nutzer = useKvNutzer()
  const nurLesen = nurLesenVorgabe || nutzer.nurLesen
  const [partner, setPartner] = useState<Partner[]>([])
  const [bezuege, setBezuege] = useState<PartnerBezug[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [offen, setOffen] = useState(false)
  const [eingabe, setEingabe] = useState('')
  const [rolle, setRolle] = useState<BezugRolle>(standardRolle)
  const [provision, setProvision] = useState('')
  const [betrag, setBetrag] = useState('')
  const [neuArt, setNeuArt] = useState<PartnerArt>(standardRolle === 'angeboten' ? 'makler' : 'vermittler')
  const [arbeitet, setArbeitet] = useState(false)
  const [bearbeitet, setBearbeitet] = useState<string | null>(null)

  const laden = useCallback(async () => {
    if (!kundeId && !objektId) return
    setLaedt(true)
    try {
      const [p, b] = await Promise.all([ladePartner(), ladeBezuege(kundeId ? { kundeId } : { objektId })])
      setPartner(p)
      setBezuege(b)
      setFehler('')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Partner ließen sich nicht laden.')
    } finally {
      setLaedt(false)
    }
  }, [kundeId, objektId])

  useEffect(() => {
    laden()
  }, [laden])

  const nachId = useMemo(() => new Map(partner.map((p) => [p.id, p])), [partner])
  const aktive = useMemo(() => partner.filter((p) => p.aktiv), [partner])
  const optionen = useMemo(() => aktive.map((p) => ({ p, text: partnerName(p) })).sort((a, b) => a.text.localeCompare(b.text, 'de')), [aktive])
  const gewaehlt = optionen.find((o) => o.text === eingabe.trim())?.p
  const aehnlich = !gewaehlt && eingabe.trim().length >= 3 ? aehnlichePartner(aktive, { name: eingabe, firma: eingabe }) : []

  async function hinzufuegen() {
    const roh = eingabe.trim()
    if (!roh) return
    const b = betrag.trim() ? leseBetrag(betrag) : undefined
    if (betrag.trim() && b === undefined) {
      setFehler('Der Betrag ist keine gültige Zahl.')
      return
    }
    setArbeitet(true)
    setFehler('')
    try {
      let p = gewaehlt ?? aehnlich[0]
      if (!p) {
        // Neu anlegen: „Helmut Dick (HD-IMMO)“ → Name und Firma
        const m = roh.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
        p = await legePartnerAn({ name: m ? m[1] : roh, firma: m ? m[2] : '', art: neuArt }, nutzer.name)
        setPartner((l) => [...l, p!])
      }
      const neu = await ordneZu({ partnerId: p.id, kundeId: kundeId ?? null, objektId: kundeId ? null : (objektId ?? null), rolle, provisionVereinbart: provision, betrag: b ?? null }, nutzer.name)
      setBezuege((l) => [neu, ...l])
      onGewaehlt?.(p)
      setEingabe('')
      setProvision('')
      setBetrag('')
      setOffen(false)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht speichern.')
    } finally {
      setArbeitet(false)
    }
  }

  async function entfernen(b: PartnerBezug) {
    const p = nachId.get(b.partnerId)
    if (!window.confirm(`Zuordnung zu ${p ? partnerName(p) : 'diesem Partner'} entfernen? Der Partner selbst bleibt erhalten.`)) return
    try {
      await loescheBezug(b.id)
      setBezuege((l) => l.filter((x) => x.id !== b.id))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht entfernen.')
    }
  }

  async function statusSetzen(b: PartnerBezug, status: ProvisionStatus) {
    try {
      const neu = await aendereBezug(b, { ...b, provisionStatus: status }, nutzer.name)
      setBezuege((l) => l.map((x) => (x.id === b.id ? neu : x)))
      setBearbeitet(null)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Zuordnung ließ sich nicht speichern.')
    }
  }

  if (!kundeId && !objektId) return null
  const feld = 'block text-xs font-medium text-slate-500 mb-1'
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`${feld} mb-0 flex items-center gap-1.5`}>
          <BookUser size={13} className="text-slate-400" /> {titel}
        </span>
        {!nurLesen && !offen && (
          <button type="button" onClick={() => setOffen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent-700 hover:bg-accent-50">
            <Plus size={12} /> Partner zuordnen
          </button>
        )}
      </div>

      {laedt ? (
        <p className="text-xs text-slate-400">Lädt …</p>
      ) : bezuege.length === 0 && !offen ? (
        <p className="text-xs text-slate-400">Noch kein Partner zugeordnet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {bezuege.map((b) => {
            const p = nachId.get(b.partnerId)
            return (
              <li key={b.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
                <Link to={`/partner?id=${b.partnerId}`} className="truncate font-medium hover:underline" title="Partner öffnen">
                  {p ? partnerName(p) : 'Partner'}
                </Link>
                <span className="text-slate-400">{ROLLE_NAME[b.rolle]}</span>
                {bearbeitet === b.id && !nurLesen ? (
                  <select autoFocus value={b.provisionStatus} onChange={(e) => statusSetzen(b, e.target.value as ProvisionStatus)} onBlur={() => setBearbeitet(null)} className="rounded border border-slate-200 bg-white px-1 py-0 text-xs">
                    {PROVISION_STATUS.map((s) => <option key={s} value={s}>{PROVISION_STATUS_NAME[s]}</option>)}
                  </select>
                ) : (
                  <button
                    type="button"
                    disabled={nurLesen}
                    onClick={() => setBearbeitet(b.id)}
                    title={b.provisionVereinbart ? `Vereinbart: ${b.provisionVereinbart}` : 'Stand der Provision ändern'}
                    className={`rounded-full px-1.5 ${b.provisionStatus === 'offen' || b.provisionStatus === 'abgerechnet' ? 'bg-amber-100 text-amber-800' : b.provisionStatus === 'bezahlt' ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}
                  >
                    {b.provisionStatus === 'keine' ? 'keine Provision' : `Provision ${PROVISION_STATUS_NAME[b.provisionStatus]}`}
                    {b.betrag !== null ? ` · ${fmtEURCent(b.betrag)}` : ''}
                  </button>
                )}
                {!nurLesen && (
                  <button type="button" onClick={() => entfernen(b)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600" aria-label="Zuordnung entfernen">
                    <X size={12} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {offen && !nurLesen && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={eingabe}
              onChange={(e) => setEingabe(e.target.value)}
              list={`partner-liste-${kundeId ?? objektId}`}
              className={inputClass}
              placeholder="Partner suchen oder neuen Namen eintippen"
              autoFocus
            />
            <datalist id={`partner-liste-${kundeId ?? objektId}`}>{optionen.map((o) => <option key={o.p.id} value={o.text} />)}</datalist>
            <select value={rolle} onChange={(e) => setRolle(e.target.value as BezugRolle)} className={inputClass}>
              {(Object.keys(ROLLE_NAME) as BezugRolle[]).map((r) => <option key={r} value={r}>{ROLLE_NAME[r]}</option>)}
            </select>
          </div>
          {eingabe.trim() && !gewaehlt && (
            aehnlich.length ? (
              <p className="text-xs text-slate-500">Passt zu vorhandenem Partner: <strong>{partnerName(aehnlich[0])}</strong> — wird diesem zugeordnet.</p>
            ) : (
              <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                Neu anlegen als
                <select value={neuArt} onChange={(e) => setNeuArt(e.target.value as PartnerArt)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs">
                  {PARTNER_ARTEN.map((a) => <option key={a} value={a}>{PARTNER_ART_NAME[a]}</option>)}
                </select>
              </label>
            )
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
            <input value={provision} onChange={(e) => setProvision(e.target.value)} className={inputClass} placeholder="Provision für diesen Fall (optional), z. B. 10 % vom Honorar" />
            <input value={betrag} onChange={(e) => setBetrag(e.target.value)} className={inputClass} placeholder="Betrag €" inputMode="decimal" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setOffen(false); setEingabe('') }} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Abbrechen</button>
            <button type="button" onClick={hinzufuegen} disabled={arbeitet || !eingabe.trim()} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-50">
              {arbeitet ? 'Speichert …' : 'Zuordnen'}
            </button>
          </div>
        </div>
      )}
      {fehler && <p className="mt-1.5 rounded bg-rose-50 p-1.5 text-xs text-rose-600">{fehler}</p>}
    </div>
  )
}
