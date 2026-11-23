// Rechnungsvorschläge „Nie vergessen, eine Rechnung zu stellen“ (22.11.2026). Der Server legt alle fünf Minuten
// Vorschläge an (email-gateway/rechnungVorschlaege.ts, Regeln in supabase/functions/_shared/rechnungVorschlagKern.ts):
// angenommener Kostenvoranschlag ohne Rechnung, erledigte Akte ohne Rechnung, Seminarteilnahme ohne Rechnung,
// Provision eines beurkundeten Objekts. Hier:
// - RechnungVorschlaege: Liste auf der Seite Rechnungen mit „Rechnung erstellen“ (öffnet das Rechnungsformular,
//   vorausgefüllt) und „Verwerfen“; ?vorschlag=<id> öffnet einen Vorschlag direkt (Link aus Akte oder Telegram).
//   Unten der Haken für den eigenen Wochenhinweis per Telegram.
// - RechnungVorschlagHinweis: kleine Karte in der Akte (oder am Objekt), wenn es einen offenen Vorschlag gibt.
// Ohne Tabelle (noch nicht eingerichtet) oder ohne Rechte zeigt beides einfach nichts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BellRing, ChevronDown, ChevronRight, FilePlus2, X } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { Card } from '../ui'
import { akteName, findeAkte, useKvNutzer } from '../KostenvoranschlaegeSection'
import { fmtEURCent, uid } from '../../lib/dates'
import { RechnungFormular } from './RechnungFormular'
import { ART_NAME, faelligSatz, type VorschlagZeile } from '../../../supabase/functions/_shared/rechnungVorschlagKern.ts'
import type { Rechnung } from '../../types'

const TABELLE = 'rechnung_vorschlaege'
const HINWEIS = 'rechnung_vorschlag_hinweis'

const ART_FARBE: Record<VorschlagZeile['art'], string> = {
  kv: 'bg-sky-50 text-sky-700',
  akte: 'bg-emerald-50 text-emerald-700',
  seminar: 'bg-violet-50 text-violet-700',
  provision: 'bg-amber-50 text-amber-800',
}

async function ladeOffene(filter?: { kundeId?: string; objektId?: string }): Promise<VorschlagZeile[]> {
  if (!supabase) return []
  let q = supabase.from(TABELLE).select('*').eq('status', 'offen')
  if (filter?.kundeId) q = q.eq('kunde_id', filter.kundeId)
  if (filter?.objektId) q = q.eq('objekt_id', filter.objektId)
  const { data, error } = await q.order('erstellt_am', { ascending: true }).limit(500)
  if (error) return []
  return (data ?? []) as VorschlagZeile[]
}

/** Status eines Vorschlags setzen (nur offen → erstellt/verworfen). */
async function setzeStatus(id: string, status: 'erstellt' | 'verworfen', wer: string, rechnungId?: string): Promise<void> {
  if (!supabase) return
  const jetzt = new Date().toISOString()
  const { error } = await supabase
    .from(TABELLE)
    .update({ status, rechnung_id: rechnungId ?? null, erledigt_am: jetzt, erledigt_von: wer, geaendert_am: jetzt })
    .eq('id', id)
    .eq('status', 'offen')
  if (error) throw new Error(error.message)
}

/** Vorlage für das Rechnungsformular aus einem Vorschlag. */
export function vorlageAusVorschlag(v: VorschlagZeile): Partial<Rechnung> {
  return {
    kundeId: v.kunde_id ?? undefined,
    positionen: (v.positionen ?? []).map((p) => ({ id: uid('p'), bezeichnung: p.bezeichnung, menge: Number(p.menge) || 1, einheit: p.einheit || 'Pauschal', einzelpreis: Number(p.einzelpreis) || 0, ...(p.leistungId ? { leistungId: p.leistungId } : {}) })),
    // 0 % (z. B. Kleinunternehmer, steuerfreie Leistung) ist ein gültiger Satz — nur ein fehlender Satz wird 19 %.
    ustSatz: v.ust_satz === null || v.ust_satz === undefined || (v.ust_satz as unknown) === '' || !Number.isFinite(Number(v.ust_satz)) ? 19 : Number(v.ust_satz),
    leistungBezeichnung: v.titel || undefined,
    kvId: v.kv_id ?? undefined,
    notiz: `Aus Rechnungsvorschlag: ${v.grund ?? ''}`.trim(),
  }
}

function betragText(v: VorschlagZeile): string {
  return Number(v.betrag_netto) > 0 ? `${fmtEURCent(Number(v.betrag_netto))} netto` : 'Betrag offen'
}

/** Liste „Vorschläge“ auf der Seite Rechnungen. */
export function RechnungVorschlaege({ onRechnungAngelegt }: { onRechnungAngelegt?: (rechnungId: string) => void }) {
  const { state } = useApp()
  const { mitarbeiter } = useAuth()
  const nutzer = useKvNutzer()
  const [params, setParams] = useSearchParams()
  const [liste, setListe] = useState<VorschlagZeile[] | null>(null)
  const [offenAuf, setOffenAuf] = useState(true)
  const [formular, setFormular] = useState<VorschlagZeile | null>(null)
  const [verwerfen, setVerwerfen] = useState<string | null>(null)
  const [fehler, setFehler] = useState('')
  const [hinweisAn, setHinweisAn] = useState<boolean | null>(null)
  const vorschlagParam = params.get('vorschlag')

  const laden = useCallback(() => ladeOffene().then(setListe), [])
  useEffect(() => {
    laden()
  }, [laden])

  // Eigene Einstellung für den Wochenhinweis (keine Zeile = an für die Geschäftsführung).
  useEffect(() => {
    if (!supabase || !nutzer.email) return
    supabase
      .from(HINWEIS)
      .select('aktiv')
      .eq('email', nutzer.email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return
        setHinweisAn(data ? data.aktiv !== false : mitarbeiter?.rolle === 'geschaeftsfuehrung')
      })
  }, [nutzer.email, mitarbeiter?.rolle])

  // ?vorschlag=<id> öffnet den Vorschlag direkt.
  useEffect(() => {
    if (!vorschlagParam || !liste) return
    const v = liste.find((x) => x.id === vorschlagParam)
    if (v && !nutzer.nurLesen) setFormular(v)
    else if (!v) setFehler('Dieser Vorschlag ist schon erledigt oder nicht mehr offen.')
    const p = new URLSearchParams(params)
    p.delete('vorschlag')
    setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vorschlagParam, liste])

  const summe = useMemo(() => (liste ?? []).reduce((s, v) => s + (Number(v.betrag_netto) > 0 ? Number(v.betrag_netto) : 0), 0), [liste])

  async function verwerfenBestaetigt(id: string) {
    setFehler('')
    try {
      await setzeStatus(id, 'verworfen', nutzer.name)
      setVerwerfen(null)
      await laden()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Verwerfen hat nicht geklappt.')
    }
  }

  async function hinweisSetzen(an: boolean) {
    if (!supabase || !nutzer.email) return
    setHinweisAn(an)
    const { error } = await supabase.from(HINWEIS).upsert({ email: nutzer.email, aktiv: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
    if (error) {
      setHinweisAn(!an)
      setFehler(`Einstellung ließ sich nicht speichern: ${error.message}`)
    }
  }

  if (!liste || (liste.length === 0 && !fehler)) return null

  return (
    <Card className="mb-5 border-amber-200 p-0">
      <button type="button" onClick={() => setOffenAuf((x) => !x)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <BellRing size={16} className="shrink-0 text-amber-600" />
          <span className="text-sm font-semibold text-slate-800">Vorschläge: {faelligSatz(liste.length)}</span>
          {summe > 0 && <span className="hidden text-xs text-slate-500 sm:inline">zusammen {fmtEURCent(summe)} netto</span>}
        </span>
        {offenAuf ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {offenAuf && (
        <div className="border-t border-slate-100">
          {fehler && <p className="px-4 pt-3 text-sm text-rose-600">{fehler}</p>}
          <ul className="divide-y divide-slate-100">
            {liste.map((v) => {
              const akte = v.kunde_id ? findeAkte(state, v.kunde_id) : undefined
              return (
                <li key={v.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ART_FARBE[v.art]}`}>{ART_NAME[v.art]}</span>
                      <span className="truncate font-medium text-slate-800">{akte ? akteName(akte.kunde) : v.kunde_id ? 'Akte' : 'Kunde noch wählen'}</span>
                      <span className="text-sm text-slate-700">{betragText(v)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-600">{v.titel}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{v.grund}</div>
                  </div>
                  {!nutzer.nurLesen && (
                    <div className="flex shrink-0 items-center gap-2">
                      {verwerfen === v.id ? (
                        <>
                          <span className="text-xs text-slate-500">Wirklich verwerfen?</span>
                          <button type="button" onClick={() => verwerfenBestaetigt(v.id)} className="rounded-md px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">
                            Ja, verwerfen
                          </button>
                          <button type="button" onClick={() => setVerwerfen(null)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setFormular(v)}
                            className="inline-flex items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700"
                          >
                            <FilePlus2 size={13} /> Rechnung erstellen
                          </button>
                          <button type="button" onClick={() => setVerwerfen(v.id)} title="Keine Rechnung nötig — Vorschlag verwerfen" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">
                            <X size={13} /> Verwerfen
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {!nutzer.nurLesen && hinweisAn !== null && (
            <label className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <input type="checkbox" checked={hinweisAn} onChange={(e) => hinweisSetzen(e.target.checked)} />
              Montags per Telegram erinnern, wenn Rechnungen fällig zu stellen sind
            </label>
          )}
        </div>
      )}
      {formular && (
        <RechnungFormular
          key={formular.id}
          vorlage={vorlageAusVorschlag(formular)}
          onClose={() => setFormular(null)}
          onGespeichert={(rechnungId) => {
            const v = formular
            setzeStatus(v.id, 'erstellt', nutzer.name, rechnungId)
              .catch((e) => setFehler(`Rechnung angelegt, aber der Vorschlag ließ sich nicht abhaken: ${e instanceof Error ? e.message : String(e)}`))
              .finally(() => laden())
            onRechnungAngelegt?.(rechnungId)
          }}
        />
      )}
    </Card>
  )
}

/** Hinweis-Karte in der Akte (kundeId) oder am Objekt (objektId), wenn eine Rechnung fällig ist. */
export function RechnungVorschlagHinweis({ kundeId, objektId }: { kundeId?: string; objektId?: string }) {
  const navigate = useNavigate()
  const [liste, setListe] = useState<VorschlagZeile[]>([])
  useEffect(() => {
    if (!kundeId && !objektId) return
    ladeOffene({ kundeId, objektId }).then(setListe)
  }, [kundeId, objektId])
  if (liste.length === 0) return null
  return (
    <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {liste.map((v) => (
        <div key={v.id} className="flex items-start gap-2 [&+&]:mt-2">
          <BellRing size={15} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div>
              Rechnung fällig: {v.titel} ({betragText(v)})
            </div>
            <div className="text-xs opacity-80">{v.grund}</div>
            <button type="button" onClick={() => navigate(`/beratung/rechnungen?vorschlag=${encodeURIComponent(v.id)}`)} className="mt-1 text-xs font-medium hover:underline">
              Rechnung erstellen →
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
