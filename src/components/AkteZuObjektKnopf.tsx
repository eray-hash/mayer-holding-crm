import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Loader2 } from 'lucide-react'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { useApp } from '../context/AppContext'
import { call } from '../lib/emailGateway'
import { OBJEKT_TYPEN } from '../data/constants'
import { DOKUMENT_ORDNER } from '../types'

// Knopf „In Objektakte umwandeln“ in einer Immobilien-Kundenakte (22.11.2026): Für Akten, die in Wahrheit ein
// Objekt sind (z. B. ein vom Makler angebotenes Hotel mit 100 Fotos und Exposés). Die Arbeit macht der Server
// (email-gateway, Aktion akte_zu_objekt, siehe supabase/functions/email-gateway/akteZuObjekt.ts):
//  1. Vorschau: vorgeschlagener Name, Adresse, Kaufpreis, Objektart und wohin jede Datei kommt — hier änderbar.
//  2. Start: Objekt anlegen, Dateien im Hintergrund in die Objektakte kopieren (läuft auch weiter, wenn dieses
//     Fenster geschlossen wird), am Ende aus der Kundenakte nehmen.
//  3. Fortschritt: alle drei Sekunden der Stand; fertig → Link zur neuen Objektakte.

type Eckdaten = {
  bezeichnung: string
  adresse: string
  kaufpreis: number
  typ: string
  nichtOeffentlich: boolean
  anbieter: { art: string; name: string; firma: string; telefon: string; email: string } | null
  eigentuemer: { name: string; telefon: string; email: string } | null
}
type Ziel = { id: string; name: string }
type DokZeile = { id: string; name: string; ordner: string; ziel: string; grund: string; doppelt: boolean; stand: string }
type Umzug = {
  umzugId: string
  kundeId: string
  kundeName: string
  status: 'vorschau' | 'laeuft' | 'fertig' | 'abgebrochen'
  objektId: string | null
  objektName: string
  neuesObjekt: boolean
  eckdaten: Eckdaten
  dublette: Ziel | null
  kandidaten: Ziel[]
  ordnerZahlen: Record<string, number>
  andereZiele: (Ziel & { anzahl: number })[]
  bleiben: number
  doppelt: number
  dokumente: DokZeile[]
  hinweise: string[]
  erledigt: number
  gesamt: number
  fehler: { name: string; grund: string }[]
  behalten: boolean
}

const BLEIBT = 'bleibt'
const NEU = 'neu'

function euro(n: number): string {
  return n > 0 ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)} €` : '—'
}

export function AkteZuObjektKnopf({ kundeId, nurLesen }: { kundeId: string; nurLesen?: boolean }) {
  const { neuLaden } = useApp()
  const navigate = useNavigate()
  const [offen, setOffen] = useState(false)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [umzug, setUmzug] = useState<Umzug | null>(null)
  // Eingaben der Vorschau
  const [bezeichnung, setBezeichnung] = useState('')
  const [adresse, setAdresse] = useState('')
  const [kaufpreis, setKaufpreis] = useState('')
  const [typ, setTyp] = useState('Haus')
  const [behalten, setBehalten] = useState(false)
  const [inVorhandenes, setInVorhandenes] = useState(false)
  const [aenderungen, setAenderungen] = useState<Record<string, { ordner?: string; ziel?: string }>>({})
  const neuGeladen = useRef(false)

  const uebernimm = useCallback((u: Umzug) => {
    setUmzug(u)
    // Schon beim Öffnen fertig (früher umgezogen): nichts neu zu laden.
    if (u.status === 'fertig') neuGeladen.current = true
    if (u.status === 'vorschau') {
      setBezeichnung(u.eckdaten.bezeichnung ?? '')
      setAdresse(u.eckdaten.adresse ?? '')
      setKaufpreis(u.eckdaten.kaufpreis > 0 ? String(u.eckdaten.kaufpreis) : '')
      setTyp(u.eckdaten.typ || 'Haus')
      setInVorhandenes(!!u.dublette)
      setAenderungen({})
    }
  }, [])

  async function oeffnen() {
    setOffen(true)
    setFehler('')
    if (umzug && umzug.status !== 'abgebrochen') return
    setLaedt(true)
    try {
      uebernimm(await call({ action: 'akte_zu_objekt', modus: 'vorschau', kunde_id: kundeId }))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }

  async function neuBerechnen() {
    setLaedt(true)
    setFehler('')
    try {
      uebernimm(await call({ action: 'akte_zu_objekt', modus: 'vorschau', kunde_id: kundeId, neu: true }))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }

  // Fortschritt abfragen, solange der Umzug läuft und das Fenster offen ist.
  useEffect(() => {
    if (!offen || umzug?.status !== 'laeuft') return
    const id = umzug.umzugId
    const t = window.setInterval(async () => {
      try {
        const u: Umzug = await call({ action: 'akte_zu_objekt', modus: 'stand', umzug_id: id })
        setUmzug(u)
      } catch {
        // nächster Versuch in drei Sekunden
      }
    }, 3000)
    return () => window.clearInterval(t)
  }, [offen, umzug?.status, umzug?.umzugId])

  // Fertig: den Stand des CRM neu laden (neue Objektakte, Kundenakte ohne die umgezogenen Dokumente).
  useEffect(() => {
    if (umzug?.status === 'fertig' && !neuGeladen.current) {
      neuGeladen.current = true
      void neuLaden()
    }
  }, [umzug?.status, neuLaden])

  const zeilen = useMemo(
    () => (umzug?.dokumente ?? []).map((d) => ({ ...d, ordner: aenderungen[d.id]?.ordner ?? d.ordner, ziel: aenderungen[d.id]?.ziel ?? d.ziel })),
    [umzug, aenderungen],
  )
  const nachZiel = useMemo(() => {
    const neu: Record<string, number> = {}
    const andere: Record<string, number> = {}
    let bleibt = 0
    for (const z of zeilen) {
      if (z.doppelt) continue
      if (z.ziel === BLEIBT) bleibt++
      else if (z.ziel === NEU) neu[z.ordner] = (neu[z.ordner] ?? 0) + 1
      else andere[z.ziel] = (andere[z.ziel] ?? 0) + 1
    }
    return { neu, andere, bleibt }
  }, [zeilen])

  const zielName = (id: string) => (umzug?.kandidaten ?? []).find((k) => k.id === id)?.name ?? id
  const neuName = inVorhandenes && umzug?.dublette ? `„${umzug.dublette.name}“ (vorhanden)` : 'Neue Objektakte'

  function aendere(id: string, feld: 'ordner' | 'ziel', wert: string) {
    setAenderungen((a) => ({ ...a, [id]: { ...a[id], [feld]: wert } }))
  }

  async function starten() {
    if (!umzug) return
    setLaedt(true)
    setFehler('')
    try {
      const liste = Object.entries(aenderungen).map(([id, a]) => ({ id, ...a }))
      const u: Umzug = await call({
        action: 'akte_zu_objekt',
        modus: 'start',
        umzug_id: umzug.umzugId,
        eckdaten: inVorhandenes ? {} : { bezeichnung, adresse, kaufpreis, typ },
        aenderungen: liste,
        behalten,
        objekt_id: inVorhandenes && umzug.dublette ? umzug.dublette.id : undefined,
        trotzdem: !inVorhandenes && !!umzug.dublette,
      })
      setUmzug(u)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }

  async function zurObjektakte() {
    if (!umzug?.objektId) return
    await neuLaden()
    setOffen(false)
    navigate(`/immobilien/objekte/${umzug.objektId}`)
  }

  if (nurLesen) return null

  const prozent = umzug && umzug.gesamt > 0 ? Math.round((umzug.erledigt / umzug.gesamt) * 100) : 0
  const summeNeu = Object.values(nachZiel.neu).reduce((a, b) => a + b, 0)

  return (
    <>
      <button
        onClick={oeffnen}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        title="Diese Akte ist eigentlich ein Objekt: Objektakte anlegen und die Dokumente dorthin einsortieren"
      >
        <Building2 size={14} /> In Objektakte umwandeln
      </button>

      <Modal open={offen} onClose={() => setOffen(false)} title="In Objektakte umwandeln" width="max-w-3xl">
        {laedt && !umzug && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Akte wird ausgewertet …
          </div>
        )}
        {fehler && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</div>}

        {umzug?.status === 'vorschau' && (
          <div>
            <p className="mb-4 text-sm text-slate-600">
              Aus dieser Kundenakte wird eine Objektakte. Alle Dokumente werden in die passenden Ordner einsortiert und danach aus der Kundenakte
              genommen. Die Kundenakte selbst bleibt als Kontakt des Maklers bzw. Eigentümers bestehen.
            </p>

            {umzug.dublette && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="mb-2">Es gibt schon die Objektakte „{umzug.dublette.name}“.</div>
                <label className="mr-4 inline-flex items-center gap-1.5">
                  <input type="radio" checked={inVorhandenes} onChange={() => setInVorhandenes(true)} /> Dokumente dort hinein legen
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" checked={!inVorhandenes} onChange={() => setInVorhandenes(false)} /> Trotzdem ein neues Objekt anlegen
                </label>
              </div>
            )}

            {!inVorhandenes && (
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Field label="Bezeichnung">
                  <input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} />
                </Field>
                <Field label="Adresse">
                  <input className={inputClass} value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Straße Nr, PLZ Ort" />
                </Field>
                <Field label="Kaufpreis (Euro)">
                  <input className={inputClass} value={kaufpreis} onChange={(e) => setKaufpreis(e.target.value)} placeholder="z. B. 1200000" />
                </Field>
                <Field label="Objektart">
                  <select className={inputClass} value={typ} onChange={(e) => setTyp(e.target.value)}>
                    {OBJEKT_TYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {!inVorhandenes && (umzug.eckdaten.anbieter || umzug.eckdaten.eigentuemer || umzug.eckdaten.nichtOeffentlich) && (
              <div className="mb-3 text-xs text-slate-500">
                {umzug.eckdaten.anbieter && (
                  <div>Angeboten von: {[umzug.eckdaten.anbieter.name, umzug.eckdaten.anbieter.firma].filter(Boolean).join(', ')} (kommt in den Verlauf)</div>
                )}
                {umzug.eckdaten.eigentuemer && <div>Eigentümer: {umzug.eckdaten.eigentuemer.name}</div>}
                {umzug.eckdaten.nichtOeffentlich && <div>Wird als „nicht öffentlich angeboten“ gekennzeichnet.</div>}
              </div>
            )}

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="mb-1 font-medium text-slate-700">
                {neuName}: {summeNeu} Datei(en)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(nachZiel.neu).sort((a, b) => b[1] - a[1]).map(([o, n]) => (
                  <span key={o} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">{o}: {n}</span>
                ))}
              </div>
              {Object.entries(nachZiel.andere).map(([id, n]) => (
                <div key={id} className="mt-2 text-slate-700">In das vorhandene Objekt „{zielName(id)}“: {n} Datei(en)</div>
              ))}
              {nachZiel.bleibt > 0 && <div className="mt-2 text-slate-500">Bleiben in der Kundenakte: {nachZiel.bleibt}</div>}
            </div>

            {umzug.hinweise.length > 0 && (
              <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-slate-500">
                {umzug.hinweise.map((h) => <li key={h}>{h}</li>)}
              </ul>
            )}

            {zeilen.length > 0 && (
              <details className="mb-3">
                <summary className="cursor-pointer text-sm font-medium text-accent-700">Dateien einzeln ansehen und ändern ({zeilen.length})</summary>
                <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-100">
                  <table className="w-full text-xs">
                    <tbody>
                      {zeilen.map((d) => (
                        <tr key={d.id} className="border-b border-slate-50 align-top">
                          <td className="px-2 py-1.5">
                            <div className="break-all text-slate-700">{d.name}</div>
                            <div className="text-slate-400">{d.grund}</div>
                          </td>
                          <td className="w-44 px-1 py-1.5">
                            <select disabled={d.doppelt || d.ziel === BLEIBT} value={d.ordner} onChange={(e) => aendere(d.id, 'ordner', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5">
                              {DOKUMENT_ORDNER.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </td>
                          <td className="w-48 px-1 py-1.5">
                            <select disabled={d.doppelt} value={d.ziel} onChange={(e) => aendere(d.id, 'ziel', e.target.value)} className="w-full rounded border border-slate-200 bg-white px-1 py-0.5">
                              <option value={NEU}>{neuName}</option>
                              {umzug.kandidaten.filter((k) => !(inVorhandenes && k.id === umzug.dublette?.id)).map((k) => <option key={k.id} value={k.id}>In „{k.name}“</option>)}
                              <option value={BLEIBT}>Bleibt in der Kundenakte</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={behalten} onChange={(e) => setBehalten(e.target.checked)} />
              Dokumente zusätzlich in der Kundenakte lassen
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={neuBerechnen} disabled={laedt} className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50">
                Vorschlag neu berechnen
              </button>
              <div className="flex gap-2">
                <SecondaryButton onClick={() => setOffen(false)}>Abbrechen</SecondaryButton>
                <PrimaryButton onClick={starten} disabled={laedt || (!inVorhandenes && !bezeichnung.trim())}>
                  {laedt ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />} Umwandeln
                </PrimaryButton>
              </div>
            </div>
          </div>
        )}

        {umzug?.status === 'laeuft' && (
          <div className="py-2">
            <div className="mb-2 text-sm text-slate-700">
              Dokumente werden in die Objektakte „{umzug.objektName}“ gelegt … {umzug.erledigt} von {umzug.gesamt}
            </div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${prozent}%` }} />
            </div>
            <p className="text-xs text-slate-500">Das läuft auf dem Server weiter, auch wenn dieses Fenster geschlossen wird.</p>
          </div>
        )}

        {umzug?.status === 'fertig' && (
          <div className="py-2">
            <div className="mb-2 text-sm font-medium text-emerald-700">
              Fertig: {umzug.gesamt - umzug.fehler.length} von {umzug.gesamt} Datei(en) sind in der Objektakte „{umzug.objektName}“
              {umzug.andereZiele.length > 0 && ` bzw. in ${umzug.andereZiele.map((z) => `„${z.name}“`).join(', ')}`}.
            </div>
            {umzug.fehler.length > 0 && (
              <div className="mb-3 text-xs text-rose-700">
                Nicht übernommen (liegen weiter in der Kundenakte):
                <ul className="list-disc pl-5">
                  {umzug.fehler.map((f) => <li key={f.name + f.grund}>{f.name} — {f.grund}</li>)}
                </ul>
              </div>
            )}
            <div className="mb-3 text-xs text-slate-500">
              Eckdaten: {umzug.eckdaten.adresse || 'ohne Adresse'} · {umzug.eckdaten.typ} · Kaufpreis {euro(umzug.eckdaten.kaufpreis)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={neuBerechnen} disabled={laedt} className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50">
                Noch einmal umwandeln (z. B. für später dazugekommene Dateien)
              </button>
              <PrimaryButton onClick={zurObjektakte}>
                <Building2 size={14} /> Zur Objektakte
              </PrimaryButton>
            </div>
          </div>
        )}

        {umzug?.status === 'abgebrochen' && <div className="py-2 text-sm text-slate-600">Der Umzug wurde abgebrochen.</div>}
      </Modal>
    </>
  )
}
