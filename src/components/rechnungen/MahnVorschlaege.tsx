// Mahnvorschläge auf der Seite Mahnwesen (22.11.2026). Der Server legt jeden Tag ab 9 Uhr Vorschläge an
// (supabase/functions/email-gateway/mahnVorschlag.ts, Regeln in _shared/mahnVorschlagKern.ts) und meldet sie dem
// Zuständigen per Telegram. Hier wird nur geprüft und gehandelt — gesendet wird mit dem vorhandenen Mahn-Dialog:
// - „… erstellen und senden“ öffnet MahnungModal (vorausgefüllt mit der nächsten Stufe = Stufe des Vorschlags).
// - „Zahlung ist eingegangen“ öffnet ZahlungErfassenModal.
// - „Kunde zahlt in Raten / zurückstellen bis …“ stellt den Vorschlag bis zu einem Datum zurück (Vermerk in der Akte);
//   danach öffnet ihn der Server wieder und meldet ihn erneut.
// Erledigtes (bezahlt, Schreiben erstellt) wird hier sofort abgehakt und verschwindet; ?vorschlag=<id> (Link aus
// Telegram) öffnet den Mahn-Dialog direkt. Ohne Tabelle (noch nicht eingerichtet) oder ohne Rechte zeigt der Block nichts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BellRing, ChevronDown, ChevronRight, Clock, Euro, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card, Field, PrimaryButton, SecondaryButton, inputClass } from '../ui'
import { akteName, findeAkte } from '../KostenvoranschlaegeSection'
import { addDays, fmtDate, fmtEURCent, today } from '../../lib/dates'
import { istUnbezahlt, offenerBetrag } from '../../lib/rechnungen'
import { MahnungModal, ZahlungErfassenModal } from './RechnungDialoge'
import { useRechnungAktionen } from './aktionen'
import {
  EINSTELLUNG_TABELLE,
  HINWEIS_TABELLE,
  STANDARD_EINSTELLUNG,
  STUFE_NAME,
  VORSCHLAG_TABELLE,
  einstellungAus,
  stufeErreicht,
  tageText,
  tageZwischen,
  type MahnEinstellung,
  type MahnVorschlagZeile,
} from '../../../supabase/functions/_shared/mahnVorschlagKern.ts'
import type { Rechnung } from '../../types'

const GRUENDE = ['Ratenzahlung vereinbart', 'Kunde hat Zahlung zugesagt', 'Rückfrage oder Reklamation offen', 'Sonstiges']

async function ladeZeilen(): Promise<MahnVorschlagZeile[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from(VORSCHLAG_TABELLE).select('*').in('status', ['offen', 'zurueckgestellt']).order('erstellt_am', { ascending: true }).limit(500)
  if (error) return null
  return (data ?? []) as MahnVorschlagZeile[]
}

/** Nur offen/zurückgestellt → neuer Status (bedingt, damit zwei Fenster nichts doppelt tun). */
async function aendere(z: Pick<MahnVorschlagZeile, 'id' | 'status'>, felder: Partial<MahnVorschlagZeile>): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from(VORSCHLAG_TABELLE)
    .update({ ...felder, geaendert_am: new Date().toISOString() })
    .eq('id', z.id)
    .eq('status', z.status)
  if (error) throw new Error(error.message)
}

/** Hat sich der Vorschlag durch den Stand der Rechnung erledigt? */
function erledigtDurch(z: MahnVorschlagZeile, r: Rechnung | undefined): 'gesendet' | 'erledigt' | null {
  if (!r) return null
  if (!istUnbezahlt(r) || offenerBetrag(r) < 0.01) return 'erledigt'
  if (stufeErreicht(r.mahnstufe, z.stufe)) return 'gesendet'
  return null
}

export function MahnVorschlaege() {
  const { state, nutzer, vermerk } = useRechnungAktionen()
  const [params, setParams] = useSearchParams()
  const [zeilen, setZeilen] = useState<MahnVorschlagZeile[] | null>(null)
  const [auf, setAuf] = useState(true)
  const [fehler, setFehler] = useState('')
  const [mahnen, setMahnen] = useState<string | null>(null)
  const [zahlung, setZahlung] = useState<string | null>(null)
  const [zurueck, setZurueck] = useState<{ id: string; bis: string; grund: string; text: string } | null>(null)
  const [hinweisAn, setHinweisAn] = useState<boolean | null>(null)
  const [einst, setEinst] = useState<MahnEinstellung | null>(null)
  const [einstOffen, setEinstOffen] = useState(false)
  const vorschlagParam = params.get('vorschlag')
  // Schon versucht abzuhaken (sonst Endlosschleife, wenn das Abhaken z. B. an Rechten scheitert).
  const versucht = useRef(new Set<string>())

  const laden = useCallback(() => ladeZeilen().then(setZeilen), [])
  useEffect(() => {
    laden()
  }, [laden])

  useEffect(() => {
    if (!supabase) return
    supabase
      .from(EINSTELLUNG_TABELLE)
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error) setEinst(einstellungAus(data))
      })
    if (!nutzer.email) return
    supabase
      .from(HINWEIS_TABELLE)
      .select('aktiv')
      .eq('email', nutzer.email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error) setHinweisAn(data ? data.aktiv !== false : true)
      })
  }, [nutzer.email])

  const rechnungJe = useMemo(() => new Map(state.rechnungen.map((r) => [r.id, r])), [state.rechnungen])

  // Erledigtes abhaken (bezahlt → erledigt, Schreiben dieser Stufe erstellt → gesendet).
  useEffect(() => {
    if (!zeilen || nutzer.nurLesen) return
    const fertig = zeilen.map((z) => ({ z, s: erledigtDurch(z, rechnungJe.get(z.rechnung_id)) })).filter((x) => x.s && !versucht.current.has(`${x.z.id}:${x.s}`))
    if (!fertig.length) return
    for (const { z, s } of fertig) versucht.current.add(`${z.id}:${s}`)
    const jetzt = new Date().toISOString()
    Promise.all(fertig.map(({ z, s }) => aendere(z, { status: s!, erledigt_am: jetzt, erledigt_von: nutzer.name }).catch(() => undefined))).then(() => laden())
  }, [zeilen, rechnungJe, nutzer.nurLesen, nutzer.name, laden])

  const offen = useMemo(
    () =>
      (zeilen ?? [])
        .filter((z) => z.status === 'offen' && rechnungJe.has(z.rechnung_id) && !erledigtDurch(z, rechnungJe.get(z.rechnung_id)))
        .map((z) => ({ z, r: rechnungJe.get(z.rechnung_id)! }))
        .sort((a, b) => (a.r.zahlungsziel || '').localeCompare(b.r.zahlungsziel || '')),
    [zeilen, rechnungJe],
  )
  const zurueckgestellt = useMemo(
    () =>
      (zeilen ?? [])
        .filter((z) => z.status === 'zurueckgestellt' && rechnungJe.has(z.rechnung_id) && !erledigtDurch(z, rechnungJe.get(z.rechnung_id)))
        .map((z) => ({ z, r: rechnungJe.get(z.rechnung_id)! })),
    [zeilen, rechnungJe],
  )

  // ?vorschlag=<id> (Link aus Telegram) öffnet den Mahn-Dialog.
  useEffect(() => {
    if (!vorschlagParam || !zeilen) return
    const treffer = offen.find((x) => x.z.id === vorschlagParam)
    if (treffer && !nutzer.nurLesen) setMahnen(treffer.r.id)
    else if (!treffer) setFehler('Dieser Mahnvorschlag ist schon erledigt oder zurückgestellt.')
    const p = new URLSearchParams(params)
    p.delete('vorschlag')
    setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vorschlagParam, zeilen])

  const kunde = (r: Rechnung) => {
    const a = findeAkte(state, r.kundeId)
    return a ? akteName(a.kunde) : '–'
  }

  async function zurueckstellen() {
    if (!zurueck) return
    const treffer = offen.find((x) => x.z.id === zurueck.id)
    if (!treffer) return
    const grund = zurueck.grund === 'Sonstiges' ? zurueck.text.trim() || 'zurückgestellt' : `${zurueck.grund}${zurueck.text.trim() ? ` — ${zurueck.text.trim()}` : ''}`
    setFehler('')
    try {
      await aendere(treffer.z, { status: 'zurueckgestellt', zurueckgestellt_bis: zurueck.bis, notiz: grund })
      vermerk(treffer.r.kundeId, `${STUFE_NAME[treffer.z.stufe]} zu Rechnung ${treffer.r.nummer} zurückgestellt bis ${fmtDate(zurueck.bis)} (${grund})`)
      setZurueck(null)
      await laden()
    } catch (e) {
      setFehler(`Zurückstellen hat nicht geklappt: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function wiederAufnehmen(z: MahnVorschlagZeile) {
    setFehler('')
    try {
      await aendere(z, { status: 'offen', zurueckgestellt_bis: null })
      await laden()
    } catch (e) {
      setFehler(`Das hat nicht geklappt: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function hinweisSetzen(an: boolean) {
    if (!supabase || !nutzer.email) return
    setHinweisAn(an)
    const { error } = await supabase.from(HINWEIS_TABELLE).upsert({ email: nutzer.email, aktiv: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
    if (error) {
      setHinweisAn(!an)
      setFehler(`Einstellung ließ sich nicht speichern: ${error.message}`)
    }
  }

  async function einstellungSpeichern(e: MahnEinstellung) {
    if (!supabase) return
    const sauber = einstellungAus({ aktiv: e.aktiv, tage_erinnerung: e.tage.erinnerung, tage_mahnung1: e.tage.mahnung1, tage_mahnung2: e.tage.mahnung2, ruhe_tage_zahlung: e.ruheTage })
    const { error } = await supabase
      .from(EINSTELLUNG_TABELLE)
      .update({
        aktiv: sauber.aktiv,
        tage_erinnerung: sauber.tage.erinnerung,
        tage_mahnung1: sauber.tage.mahnung1,
        tage_mahnung2: sauber.tage.mahnung2,
        ruhe_tage_zahlung: sauber.ruheTage,
        geaendert_am: new Date().toISOString(),
        geaendert_von: nutzer.name,
      })
      .eq('id', 1)
    if (error) setFehler(`Einstellung ließ sich nicht speichern: ${error.message}`)
    else {
      setEinst(sauber)
      setEinstOffen(false)
    }
  }

  if (!zeilen) return null
  const mahnRechnung = mahnen ? rechnungJe.get(mahnen) : undefined
  const zahlRechnung = zahlung ? rechnungJe.get(zahlung) : undefined

  return (
    <Card className="mb-5 border-amber-200 p-0">
      <button type="button" onClick={() => setAuf((x) => !x)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <BellRing size={16} className="shrink-0 text-amber-600" />
          <span className="text-sm font-semibold text-slate-800">
            Vorschläge: {offen.length === 0 ? 'heute ist nichts zu mahnen' : offen.length === 1 ? '1 Schreiben ist vorbereitet' : `${offen.length} Schreiben sind vorbereitet`}
          </span>
          {zurueckgestellt.length > 0 && <span className="hidden text-xs text-slate-500 sm:inline">· {zurueckgestellt.length} zurückgestellt</span>}
        </span>
        {auf ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {auf && (
        <div className="border-t border-slate-100">
          {fehler && <p className="px-4 pt-3 text-sm text-rose-600">{fehler}</p>}
          {offen.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {offen.map(({ z, r }) => {
                const tage = r.zahlungsziel ? tageZwischen(r.zahlungsziel, today()) : 0
                return (
                  <li key={z.id} className="px-4 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">{STUFE_NAME[z.stufe]}</span>
                          <span className="truncate font-medium text-slate-800">{kunde(r)}</span>
                          <span className="text-sm text-slate-700">{fmtEURCent(offenerBetrag(r))} offen</span>
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          Rechnung {r.nummer} · Zahlungsziel {fmtDate(r.zahlungsziel)} · seit {tageText(tage)} überfällig
                        </div>
                      </div>
                      {!nutzer.nurLesen && (
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setMahnen(r.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
                          >
                            <BellRing size={13} /> {STUFE_NAME[z.stufe]} erstellen und senden
                          </button>
                          <button type="button" onClick={() => setZahlung(r.id)} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50">
                            <Euro size={13} /> Zahlung ist eingegangen
                          </button>
                          <button
                            type="button"
                            onClick={() => setZurueck({ id: z.id, bis: addDays(today(), 30), grund: GRUENDE[0], text: '' })}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            <Clock size={13} /> Kunde zahlt in Raten / zurückstellen bis …
                          </button>
                        </div>
                      )}
                    </div>
                    {zurueck?.id === z.id && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
                          <Field label="Zurückstellen bis">
                            <input type="date" className={inputClass} value={zurueck.bis} min={addDays(today(), 1)} onChange={(e) => setZurueck({ ...zurueck, bis: e.target.value })} />
                          </Field>
                          <Field label="Grund">
                            <select className={inputClass} value={zurueck.grund} onChange={(e) => setZurueck({ ...zurueck, grund: e.target.value })}>
                              {GRUENDE.map((g) => (
                                <option key={g}>{g}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label={zurueck.grund === 'Sonstiges' ? 'Grund in Worten' : 'Notiz (optional)'}>
                            <input className={inputClass} value={zurueck.text} onChange={(e) => setZurueck({ ...zurueck, text: e.target.value })} placeholder="z. B. 3 Raten à 400 €" />
                          </Field>
                        </div>
                        <p className="-mt-1 mb-2 text-xs text-slate-500">Bis dahin kommt zu dieser Rechnung kein neuer Vorschlag. Danach erscheint er wieder und der Zuständige bekommt eine Nachricht.</p>
                        <div className="flex justify-end gap-2">
                          <SecondaryButton onClick={() => setZurueck(null)}>Abbrechen</SecondaryButton>
                          <PrimaryButton onClick={zurueckstellen} disabled={!zurueck.bis || zurueck.bis <= today() || (zurueck.grund === 'Sonstiges' && !zurueck.text.trim())}>
                            Zurückstellen
                          </PrimaryButton>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {offen.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">Jeden Morgen ab 9 Uhr wird geprüft, welche überfälligen Rechnungen den nächsten Schritt brauchen.</p>}

          {zurueckgestellt.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2">
              <div className="mb-1 text-xs font-medium text-slate-500">Zurückgestellt</div>
              {zurueckgestellt.map(({ z, r }) => (
                <div key={z.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm">
                  <span className="min-w-0 text-slate-700">
                    {kunde(r)} · {r.nummer} · {STUFE_NAME[z.stufe]}
                    <span className="text-slate-500">
                      {' '}
                      — bis {fmtDate(z.zurueckgestellt_bis ?? '')}
                      {z.notiz ? ` · ${z.notiz}` : ''}
                    </span>
                  </span>
                  {!nutzer.nurLesen && (
                    <button type="button" onClick={() => wiederAufnehmen(z)} className="text-xs font-medium text-accent-600 hover:text-accent-700">
                      Wieder aufnehmen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!nutzer.nurLesen && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              {hinweisAn !== null ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={hinweisAn} onChange={(e) => hinweisSetzen(e.target.checked)} />
                  Per Telegram Bescheid geben, wenn ein Schreiben für meine Kunden vorbereitet ist
                </label>
              ) : (
                <span />
              )}
              {einst && (
                <button type="button" onClick={() => setEinstOffen((x) => !x)} className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-800">
                  <Settings size={13} /> Einstellungen
                </button>
              )}
            </div>
          )}
          {einstOffen && einst && <EinstellungFormular wert={einst} onSpeichern={einstellungSpeichern} onAbbrechen={() => setEinstOffen(false)} />}
        </div>
      )}
      {mahnRechnung && <MahnungModal rechnung={mahnRechnung} onClose={() => setMahnen(null)} />}
      {zahlRechnung && <ZahlungErfassenModal rechnung={zahlRechnung} onClose={() => setZahlung(null)} />}
    </Card>
  )
}

function EinstellungFormular({ wert, onSpeichern, onAbbrechen }: { wert: MahnEinstellung; onSpeichern: (e: MahnEinstellung) => void; onAbbrechen: () => void }) {
  const [e, setE] = useState<MahnEinstellung>(wert)
  const zahlFeld = (label: string, w: number, setze: (n: number) => void) => (
    <Field label={label}>
      <input type="number" min={0} max={365} className={inputClass} value={w} onChange={(ev) => setze(Number(ev.target.value))} />
    </Field>
  )
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={e.aktiv} onChange={(ev) => setE({ ...e, aktiv: ev.target.checked })} />
        Jeden Morgen Mahnvorschläge vorbereiten
      </label>
      <p className="mb-2 text-xs text-slate-500">Tage nach dem Zahlungsziel, ab denen der jeweilige Schritt vorgeschlagen wird (frühestens nach Ablauf der Frist aus dem letzten Schreiben):</p>
      <div className="grid grid-cols-2 gap-x-3 sm:grid-cols-4">
        {zahlFeld('Zahlungserinnerung', e.tage.erinnerung, (n) => setE({ ...e, tage: { ...e.tage, erinnerung: n } }))}
        {zahlFeld('1. Mahnung', e.tage.mahnung1, (n) => setE({ ...e, tage: { ...e.tage, mahnung1: n } }))}
        {zahlFeld('2. Mahnung', e.tage.mahnung2, (n) => setE({ ...e, tage: { ...e.tage, mahnung2: n } }))}
        {zahlFeld('Ruhe nach Zahlung (Tage)', e.ruheTage, (n) => setE({ ...e, ruheTage: n }))}
      </div>
      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={() => setE(STANDARD_EINSTELLUNG)}>Vorgabe</SecondaryButton>
        <SecondaryButton onClick={onAbbrechen}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={() => onSpeichern(e)}>Speichern</PrimaryButton>
      </div>
    </div>
  )
}
