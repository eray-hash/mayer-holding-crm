import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, SkipForward, Undo2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { call } from '../lib/emailGateway'
import { fmtEURCent } from '../lib/dates'
import { aktePfad, findeAkte } from './KostenvoranschlaegeSection'
import { Modal, PrimaryButton, SecondaryButton } from './ui'
import type { KvKandidat, KvStufe } from '../../supabase/functions/_shared/kvZuordnung.ts'

// Einmalige Zuordnung der Kostenvoranschläge ohne Akte (22.11.2026), nur Geschäftsführung: zeigt je Eintrag die
// vorgeschlagenen Akten mit Grund (Server: Aktion kv_zuordnen, email-gateway/kvZuordnung.ts; Regeln:
// _shared/kvZuordnung.ts). Zuordnen setzt Akte, Bereich und bei privaten Akten den Besitzer — wie im
// Bearbeiten-Fenster und im Assistenten. „Überspringen“ merkt sich nur dieser Browser.

type Kandidat = KvKandidat & { firma: string; ansprechpartner: string; bereich: string; bereichName: string }
type Eintrag = { id: string; name: string; beschreibung: string; notiz: string; betrag: number | null; status: string; datum: string | null; privat: boolean; kandidaten: Kandidat[] }
type Antwort = { zaehler: { gesamt: number; sicher: number; wahrscheinlich: number; ohne: number }; eintraege: Eintrag[] }
type Ergebnis = { kv_id: string; kunde_id: string; ok: boolean; text: string }

const MERKER = 'kv-zuordnung-uebersprungen'

function ladeUebersprungen(): Set<string> {
  try {
    const roh = localStorage.getItem(MERKER)
    return new Set(roh ? (JSON.parse(roh) as string[]) : [])
  } catch {
    return new Set()
  }
}

function speichereUebersprungen(s: Set<string>) {
  try {
    localStorage.setItem(MERKER, JSON.stringify([...s]))
  } catch {
    // ohne Speicher im Browser gilt „Überspringen“ nur bis zum Neuladen
  }
}

const STUFE_FARBE: Record<KvStufe, string> = {
  sicher: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  wahrscheinlich: 'border-amber-200 bg-amber-50 text-amber-700',
}

function akteTitel(k: Pick<Kandidat, 'firma' | 'ansprechpartner'>): string {
  return k.ansprechpartner && k.ansprechpartner !== k.firma ? `${k.firma || 'ohne Namen'} (${k.ansprechpartner})` : k.firma || k.ansprechpartner || 'ohne Namen'
}

export function KvZuordnungVorschlaege({ open, onClose, onZugeordnet }: { open: boolean; onClose: () => void; onZugeordnet: () => void }) {
  const { state } = useApp()
  const [daten, setDaten] = useState<Antwort | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [arbeitet, setArbeitet] = useState<string | null>(null)
  const [meldungen, setMeldungen] = useState<Ergebnis[]>([])
  const [uebersprungen, setUebersprungen] = useState<Set<string>>(() => ladeUebersprungen())
  const [zeigeUebersprungene, setZeigeUebersprungene] = useState(false)

  const laden = useCallback(async () => {
    setLaedt(true)
    setFehler('')
    try {
      setDaten((await call({ action: 'kv_zuordnen', modus: 'vorschlaege' })) as Antwort)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Die Vorschläge ließen sich nicht laden.')
    } finally {
      setLaedt(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setMeldungen([])
      void laden()
    }
  }, [open, laden])

  const sichtbar = useMemo(() => (daten?.eintraege ?? []).filter((e) => zeigeUebersprungene || !uebersprungen.has(e.id)), [daten, uebersprungen, zeigeUebersprungene])
  const mitVorschlag = sichtbar.filter((e) => e.kandidaten.length > 0)
  const ohneVorschlag = sichtbar.filter((e) => e.kandidaten.length === 0)
  const sichere = mitVorschlag.filter((e) => e.kandidaten[0]?.stufe === 'sicher')
  const anzahlUebersprungen = (daten?.eintraege ?? []).filter((e) => uebersprungen.has(e.id)).length

  async function zuordnen(paare: { kv_id: string; kunde_id: string }[], schluessel: string) {
    setArbeitet(schluessel)
    setFehler('')
    try {
      const r = (await call({ action: 'kv_zuordnen', modus: 'zuordnen', anwenden: true, paare })) as { zugeordnet: number; ergebnisse: Ergebnis[] }
      setMeldungen((m) => [...r.ergebnisse, ...m])
      const erledigt = new Set(r.ergebnisse.filter((e) => e.ok).map((e) => e.kv_id))
      // Auch „schon zugeordnet“ verschwindet aus der Liste — der Eintrag hat dann eine Akte.
      for (const e of r.ergebnisse) if (!e.ok && /zugeordnet/.test(e.text)) erledigt.add(e.kv_id)
      setDaten((d) => (d ? { ...d, eintraege: d.eintraege.filter((e) => !erledigt.has(e.id)) } : d))
      if (r.zugeordnet > 0) onZugeordnet()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das Zuordnen hat nicht geklappt.')
    } finally {
      setArbeitet(null)
    }
  }

  function alleSicheren() {
    if (!sichere.length) return
    if (!window.confirm(`${sichere.length} ${sichere.length === 1 ? 'Kostenvoranschlag' : 'Kostenvoranschläge'} der jeweils sicheren Akte zuordnen?`)) return
    void zuordnen(sichere.map((e) => ({ kv_id: e.id, kunde_id: e.kandidaten[0].kunde_id })), 'alle')
  }

  function ueberspringen(id: string, an: boolean) {
    setUebersprungen((alt) => {
      const neu = new Set(alt)
      if (an) neu.add(id)
      else neu.delete(id)
      speichereUebersprungen(neu)
      return neu
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title="Kostenvoranschläge ohne Akte — Vorschläge"
      aktionen={
        sichere.length > 0 ? (
          <PrimaryButton onClick={alleSicheren} disabled={!!arbeitet}>
            <Check size={15} /> Alle sicheren zuordnen ({sichere.length})
          </PrimaryButton>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-slate-500">
        Ohne Akte fehlen Kostenvoranschläge in Umsatzvorschau, Rechnungsvorschlägen, Wiedervorlagen und im Reiter der Akte. Vorschläge kommen aus dem Namen
        (auch abgekürzt oder leicht verlesen), Beschreibung und Notiz. Prüfe sie kurz — besonders bei „wahrscheinlich“. Zuordnen lässt sich später im
        Bearbeiten-Fenster wieder ändern.
      </p>
      {daten && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-600">{daten.eintraege.length} ohne Akte</span>
          <span className={`rounded-full border px-2.5 py-1 ${STUFE_FARBE.sicher}`}>{daten.eintraege.filter((e) => e.kandidaten[0]?.stufe === 'sicher').length} sicher</span>
          <span className={`rounded-full border px-2.5 py-1 ${STUFE_FARBE.wahrscheinlich}`}>{daten.eintraege.filter((e) => e.kandidaten.length && e.kandidaten[0].stufe !== 'sicher').length} wahrscheinlich</span>
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500">{daten.eintraege.filter((e) => !e.kandidaten.length).length} ohne Vorschlag</span>
          {anzahlUebersprungen > 0 && (
            <button type="button" onClick={() => setZeigeUebersprungene((z) => !z)} className="rounded-full border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-50">
              {zeigeUebersprungene ? 'Übersprungene ausblenden' : `${anzahlUebersprungen} übersprungen — anzeigen`}
            </button>
          )}
        </div>
      )}
      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      {meldungen.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          {meldungen.slice(0, 8).map((m, i) => (
            <li key={`${m.kv_id}-${i}`} className={m.ok ? 'text-emerald-700' : 'text-rose-700'}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
      {laedt ? (
        <p className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Vorschläge werden gesucht …
        </p>
      ) : daten && daten.eintraege.length === 0 ? (
        <p className="text-sm text-slate-500">Alle Kostenvoranschläge, die du sehen darfst, haben eine Akte.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {mitVorschlag.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800">
                      {e.name}
                      {e.beschreibung && <span className="font-normal text-slate-500"> – {e.beschreibung}</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {e.betrag === null ? 'ohne Betrag' : fmtEURCent(e.betrag)}
                      {e.privat ? ' · privat' : ''}
                      {e.notiz ? ` · ${e.notiz}` : ''}
                    </div>
                  </div>
                  {uebersprungen.has(e.id) ? (
                    <SecondaryButton onClick={() => ueberspringen(e.id, false)}>
                      <Undo2 size={14} /> Wieder vorschlagen
                    </SecondaryButton>
                  ) : (
                    <SecondaryButton onClick={() => ueberspringen(e.id, true)}>
                      <SkipForward size={14} /> Überspringen
                    </SecondaryButton>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {e.kandidaten.map((k) => {
                    const geladen = findeAkte(state, k.kunde_id)
                    return (
                      <li key={k.kunde_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2">
                        <div className="min-w-0 text-sm">
                          <span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STUFE_FARBE[k.stufe]}`}>{k.stufe === 'sicher' ? 'sicher' : 'wahrscheinlich'}</span>
                          {geladen ? (
                            <Link to={aktePfad(geladen.bereich, geladen.kunde)} className="font-medium text-accent-700 hover:underline" target="_blank" rel="noreferrer">
                              {akteTitel(k)}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-800">{akteTitel(k)}</span>
                          )}
                          <span className="text-xs text-slate-500"> · {k.bereichName}</span>
                          <span className="block text-xs text-slate-500">{k.gruende.join('; ')}</span>
                        </div>
                        <PrimaryButton onClick={() => zuordnen([{ kv_id: e.id, kunde_id: k.kunde_id }], `${e.id}:${k.kunde_id}`)} disabled={!!arbeitet}>
                          {arbeitet === `${e.id}:${k.kunde_id}` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Zuordnen
                        </PrimaryButton>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {ohneVorschlag.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">{ohneVorschlag.length} ohne Vorschlag — im Bearbeiten-Fenster von Hand zuordnen</summary>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {ohneVorschlag.map((e) => (
                  <li key={e.id}>
                    {e.name}
                    {e.beschreibung ? ` – ${e.beschreibung}` : ''} <span className="text-xs text-slate-400">({e.betrag === null ? 'ohne Betrag' : fmtEURCent(e.betrag)})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Modal>
  )
}
