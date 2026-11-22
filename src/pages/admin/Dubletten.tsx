import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Copy, ExternalLink, Loader2, Merge, MoveRight, RefreshCw, ShieldOff } from 'lucide-react'
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { call } from '../../lib/emailGateway'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { useIstSuperuser } from '../superuser/useIstSuperuser'
import { getHauptpfad, getStatusMap } from '../../data/statusNetworks'
import { kundeBereichLabel, kundeDetailPfad } from '../../data/kundenBereiche'
import type { KundeBereich } from '../../types'
import { type DublettenGruppe, STUFE_TEXT } from '../../../supabase/functions/_shared/dublettenKern.ts'

// Dubletten: doppelte Kundenakten und Objekte finden, nebeneinander vergleichen und zusammenführen
// (22.11.2026). Nur Geschäftsführung, Admins und Superuser. Erkennung und Zusammenführen laufen auf dem
// Server (email-gateway, Aktion `dubletten`, supabase/functions/email-gateway/dublettenZusammenfuehren.ts):
// Zusammengeführt wird über das vorhandene kunden_zusammenfuehren des Assistenten — die bleibende Akte bekommt
// Verlauf, Dokumente, Protokolle, Rechnungen, Termine, Mails usw. der anderen, die andere wird gelöscht.
// „Keine Dublette“ merkt sich das Paar (Tabelle dubletten_ausnahmen); es wird nicht mehr vorgeschlagen.

type AktenZaehler = { dokumente: number; verlauf: number; rechnungen: number; protokolle: number; termine: number; mails: number; wiedervorlagen: number; kostenvoranschlaege: number }
type ObjektZaehler = { dokumente: number; verlauf: number; besichtigungen: number; anfragen: number; vorschlaege: number }

type AkteAnsicht = {
  id: string
  bereich: string
  bereichName: string
  firma: string
  ansprechpartner: string
  email: string
  telefon: string
  anschrift: string
  branche: string
  status: string
  prioritaet: string
  verantwortlich: string
  letzte_aktivitaet: string
  zaehler: AktenZaehler
}

type ObjektAnsicht = { id: string; bezeichnung: string; adresse: string; typ: string; status: string; kaufpreis: number | null; verantwortlich: string; zaehler: ObjektZaehler }

type GruppeMitAkten = DublettenGruppe & { text: string; vorschlag: string; akten: AkteAnsicht[] }
type GruppeMitObjekten = DublettenGruppe & { text: string; vorschlag: string; objekte: ObjektAnsicht[] }
type Liste = { kunden: GruppeMitAkten[]; objekte: GruppeMitObjekten[]; ausnahmen: number }
type EinzelErgebnis = { entferne_id: string; ok: boolean; text: string }

const FELDER: { id: keyof AkteAnsicht & string; label: string }[] = [
  { id: 'firma', label: 'Name' },
  { id: 'ansprechpartner', label: 'Ansprechpartner' },
  { id: 'email', label: 'E-Mail' },
  { id: 'telefon', label: 'Telefon' },
  { id: 'anschrift', label: 'Anschrift' },
  { id: 'branche', label: 'Branche' },
  { id: 'verantwortlich', label: 'Verantwortlich' },
  { id: 'status', label: 'Status' },
  { id: 'prioritaet', label: 'Priorität' },
]

const ZAEHLER_AKTE: { id: keyof AktenZaehler; label: string }[] = [
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'verlauf', label: 'Verlaufseinträge' },
  { id: 'rechnungen', label: 'Rechnungen' },
  { id: 'protokolle', label: 'Gesprächsprotokolle' },
  { id: 'termine', label: 'Termine' },
  { id: 'mails', label: 'Mails' },
  { id: 'wiedervorlagen', label: 'Wiedervorlagen' },
  { id: 'kostenvoranschlaege', label: 'Kostenvoranschläge' },
]

const ZAEHLER_OBJEKT: { id: keyof ObjektZaehler; label: string }[] = [
  { id: 'dokumente', label: 'Dokumente' },
  { id: 'verlauf', label: 'Verlaufseinträge' },
  { id: 'besichtigungen', label: 'Besichtigungen' },
  { id: 'anfragen', label: 'Anfragen' },
  { id: 'vorschlaege', label: 'Vorschläge an Kunden' },
]

const STUFE_FARBE: Record<string, string> = {
  sicher: 'border-rose-200 bg-rose-50 text-rose-800',
  wahrscheinlich: 'border-amber-200 bg-amber-50 text-amber-800',
  moeglich: 'border-slate-200 bg-slate-50 text-slate-600',
}

type StatusBereich = Parameters<typeof getStatusMap>[0]

function statusText(bereich: string, status: string): string {
  if (!status) return ''
  return getStatusMap(bereich as StatusBereich)[status]?.label ?? status
}

function leer(v: string): boolean {
  return !v || !v.trim()
}

function gleich(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function akteName(a: AkteAnsicht): string {
  return a.ansprechpartner && !gleich(a.ansprechpartner, a.firma) ? `${a.firma || 'ohne Namen'} (${a.ansprechpartner})` : a.firma || 'ohne Namen'
}

function euro(n: number | null): string {
  return n === null || Number.isNaN(n) ? '' : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)} €`
}

function datum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

function StufeMarke({ g }: { g: DublettenGruppe }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STUFE_FARBE[g.stufe] ?? STUFE_FARBE.moeglich}`}>
      {STUFE_TEXT[g.stufe]} · {g.punkte} Punkte
    </span>
  )
}

export function Dubletten() {
  const { echterMitarbeiter } = useAuth()
  const istSuperuser = useIstSuperuser()
  const istGf = !!echterMitarbeiter && (echterMitarbeiter.rolle === 'geschaeftsfuehrung' || !!echterMitarbeiter.ist_admin)
  const { neuLaden } = useApp()
  const [daten, setDaten] = useState<Liste | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [reiter, setReiter] = useState<'kunden' | 'objekte'>('kunden')
  const [filter, setFilter] = useState<'alle' | 'gleich' | 'bereiche'>('alle')
  // Ergebnis des letzten Zusammenführens/Verschiebens — oben, weil die Gruppe danach meist verschwindet.
  const [erledigt, setErledigt] = useState<{ ok: boolean; text: string }[]>([])

  const laden = useCallback(async () => {
    setLaedt(true)
    setFehler(null)
    try {
      setDaten((await call({ action: 'dubletten', modus: 'liste' })) as Liste)
    } catch (e) {
      setFehler(`Die Liste ließ sich nicht laden: ${(e as Error).message}`)
    } finally {
      setLaedt(false)
    }
  }, [])

  const darf = istGf || istSuperuser === true
  useEffect(() => {
    if (darf && isSupabaseConfigured) void laden()
  }, [darf, laden])

  const kunden = useMemo(
    () => (daten?.kunden ?? []).filter((g) => filter === 'alle' || (filter === 'bereiche' ? g.bereichsuebergreifend : !g.bereichsuebergreifend)),
    [daten, filter],
  )

  if (!isSupabaseConfigured) return <EmptyState text="Die Dubletten-Suche braucht eine Verbindung zur Datenbank." />
  if (!istGf && istSuperuser === null) return <div className="p-6 text-sm text-slate-500">Lädt …</div>
  if (!darf) return <Navigate to="/heute" replace />

  const nachAenderung = async (meldungen: { ok: boolean; text: string }[]) => {
    setErledigt(meldungen)
    await Promise.all([laden(), neuLaden()])
  }
  const entferneGruppe = (art: 'kunde' | 'objekt', schluessel: string) =>
    setDaten((d) => (d ? { ...d, ausnahmen: d.ausnahmen + 1, [art === 'kunde' ? 'kunden' : 'objekte']: (art === 'kunde' ? d.kunden : d.objekte).filter((g) => g.schluessel !== schluessel) } : d))

  const anzahlBereiche = (daten?.kunden ?? []).filter((g) => g.bereichsuebergreifend).length

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Copy size={20} className="text-accent-600" /> Dubletten
          </h1>
          <p className="text-xs text-slate-500">
            Doppelte Kundenakten und Objekte: gleicher Name (auch mit anderer Rechtsform, Umlauten oder Wortfolge), gleiche E-Mail-Adresse oder
            Firmen-Mailendung, gleiche oder abgeschnittene Telefonnummer, gleiche Anschrift.
            {daten && daten.ausnahmen > 0 && ` ${daten.ausnahmen} Paar(e) als „keine Dublette“ gemerkt.`}
          </p>
        </div>
        <SecondaryButton onClick={() => void laden()} disabled={laedt}>
          <RefreshCw size={14} className={laedt ? 'animate-spin' : ''} /> Neu suchen
        </SecondaryButton>
      </div>

      {fehler && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{fehler}</div>}
      {erledigt.map((m, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${m.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {m.text}
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
        <div className="flex gap-1">
          {(['kunden', 'objekte'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setReiter(r)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${reiter === r ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {r === 'kunden' ? `Kundenakten (${daten?.kunden.length ?? '…'})` : `Objekte (${daten?.objekte.length ?? '…'})`}
            </button>
          ))}
        </div>
        {reiter === 'kunden' && (
          <div className="mb-1 flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            {([
              ['alle', 'Alle'],
              ['gleich', 'Gleicher Bereich'],
              ['bereiche', `Verschiedene Bereiche (${anzahlBereiche})`],
            ] as const).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={`rounded-md px-2.5 py-1 ${filter === id ? 'bg-accent-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {laedt && !daten && (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Suche läuft …
        </div>
      )}

      {daten && reiter === 'kunden' && (kunden.length === 0 ? (
        <EmptyState text="Keine möglichen doppelten Kundenakten gefunden." />
      ) : (
        kunden.map((g) => (
          <AktenGruppe key={g.schluessel} gruppe={g} istGf={istGf} onGeaendert={nachAenderung} onKeineDublette={() => entferneGruppe('kunde', g.schluessel)} />
        ))
      ))}

      {daten && reiter === 'objekte' && (daten.objekte.length === 0 ? (
        <EmptyState text="Keine möglichen doppelten Objekte gefunden." />
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Objekte lassen sich hier vergleichen, aber noch nicht zusammenführen. Dokumente und Angaben bitte in der Objektakte von Hand übertragen und
            das überzählige Objekt danach dort löschen.
          </p>
          {daten.objekte.map((g) => (
            <ObjektGruppe key={g.schluessel} gruppe={g} onKeineDublette={() => entferneGruppe('objekt', g.schluessel)} />
          ))}
        </>
      ))}
    </div>
  )
}

// ---------- Kundenakten ----------

function AktenGruppe({
  gruppe,
  istGf,
  onGeaendert,
  onKeineDublette,
}: {
  gruppe: GruppeMitAkten
  istGf: boolean
  onGeaendert: (meldungen: { ok: boolean; text: string }[]) => Promise<void>
  onKeineDublette: () => void
}) {
  const [behalte, setBehalte] = useState(gruppe.vorschlag)
  const [dabei, setDabei] = useState<Record<string, boolean>>(() => Object.fromEntries(gruppe.ids.map((id) => [id, true])))
  const [wahl, setWahl] = useState<Record<string, string>>({})
  const [frage, setFrage] = useState<null | { art: 'zusammen' } | { art: 'bereich'; akte: AkteAnsicht }>(null)
  const [arbeitet, setArbeitet] = useState(false)
  const [meldungen, setMeldungen] = useState<{ ok: boolean; text: string }[]>([])

  const bleibt = gruppe.akten.find((a) => a.id === behalte) ?? gruppe.akten[0]
  const einarbeiten = gruppe.akten.filter((a) => a.id !== bleibt.id && dabei[a.id] && a.bereich === bleibt.bereich)
  const andereBereiche = gruppe.akten.filter((a) => a.id !== bleibt.id && dabei[a.id] && a.bereich !== bleibt.bereich)

  // Vorgabe je Feld: Wert der bleibenden Akte; ist er leer, der erste vorhandene der eingearbeiteten.
  const gewinner = (feld: string): string => {
    const gewaehlt = wahl[feld]
    if (gewaehlt && (gewaehlt === bleibt.id || einarbeiten.some((a) => a.id === gewaehlt))) return gewaehlt
    if (!leer(String(bleibt[feld as keyof AkteAnsicht] ?? ''))) return bleibt.id
    return einarbeiten.find((a) => !leer(String(a[feld as keyof AkteAnsicht] ?? '')))?.id ?? bleibt.id
  }

  async function zusammenfuehren() {
    setArbeitet(true)
    setMeldungen([])
    const felder: Record<string, string> = {}
    for (const f of FELDER) {
      const id = gewinner(f.id)
      if (id !== bleibt.id) felder[f.id] = id
    }
    try {
      const r = (await call({ action: 'dubletten', modus: 'zusammenfuehren', behalte_id: bleibt.id, entferne_ids: einarbeiten.map((a) => a.id), felder })) as { ok: boolean; ergebnisse: EinzelErgebnis[] }
      const liste = r.ergebnisse.map((e) => ({ ok: e.ok, text: e.text }))
      setMeldungen(liste)
      setFrage(null)
      if (r.ergebnisse.some((e) => e.ok)) await onGeaendert(liste)
    } catch (e) {
      setMeldungen([{ ok: false, text: (e as Error).message }])
      setFrage(null)
    } finally {
      setArbeitet(false)
    }
  }

  async function verschieben(akte: AkteAnsicht) {
    setArbeitet(true)
    setMeldungen([])
    const nach = bleibt.bereich as StatusBereich
    const netz = Object.fromEntries(Object.entries(getStatusMap(nach)).map(([id, knoten]) => [id, knoten.label]))
    try {
      const r = (await call({ action: 'dubletten', modus: 'bereich_wechseln', kunde_id: akte.id, nach_bereich: bleibt.bereich, status_netz: netz, start_status: getHauptpfad(nach)[0] })) as { ok: boolean; text: string }
      setMeldungen([{ ok: r.ok, text: r.text }])
      setFrage(null)
      if (r.ok) await onGeaendert([{ ok: true, text: r.text }])
    } catch (e) {
      setMeldungen([{ ok: false, text: (e as Error).message }])
      setFrage(null)
    } finally {
      setArbeitet(false)
    }
  }

  async function keineDublette() {
    setArbeitet(true)
    try {
      await call({ action: 'dubletten', modus: 'keine_dublette', art: 'kunde', ids: gruppe.ids })
      onKeineDublette()
    } catch (e) {
      setMeldungen([{ ok: false, text: (e as Error).message }])
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StufeMarke g={gruppe} />
        {gruppe.bereichsuebergreifend && (
          <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">verschiedene Bereiche</span>
        )}
        <span className="text-sm text-slate-600">{gruppe.gruende.join(' · ')}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left align-top">
              <th className="w-40 py-2 pr-3 text-xs font-medium text-slate-500">Bleibt bestehen</th>
              {gruppe.akten.map((a) => (
                <th key={a.id} className={`py-2 pr-3 font-normal ${dabei[a.id] ? '' : 'opacity-50'}`}>
                  <label className="flex items-start gap-2">
                    <input type="radio" name={`behalte-${gruppe.schluessel}`} checked={a.id === bleibt.id} onChange={() => setBehalte(a.id)} className="mt-1" />
                    <span>
                      <span className="block font-medium text-slate-800">{akteName(a)}</span>
                      <span className="block text-xs text-slate-500">{a.bereichName || kundeBereichLabel(a.bereich as KundeBereich)}</span>
                    </span>
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                    <Link to={kundeDetailPfad(a.bereich as KundeBereich, a.id)} className="inline-flex items-center gap-1 text-accent-700 hover:underline">
                      <ExternalLink size={12} /> öffnen
                    </Link>
                    {a.id !== bleibt.id && (
                      <label className="inline-flex items-center gap-1 text-slate-500">
                        <input type="checkbox" checked={!!dabei[a.id]} onChange={(e) => setDabei((d) => ({ ...d, [a.id]: e.target.checked }))} /> einbeziehen
                      </label>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FELDER.map((f) => {
              const werte = gruppe.akten.map((a) => String(a[f.id] ?? ''))
              const unterschiedlich = werte.filter((w) => !leer(w)).some((w, _, alle) => !gleich(w, alle[0]))
              const sieger = gewinner(f.id)
              return (
                <tr key={f.id} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-3 text-xs text-slate-500">{f.label}</td>
                  {gruppe.akten.map((a) => {
                    const wert = String(a[f.id] ?? '')
                    const anzeige = f.id === 'status' ? statusText(a.bereich, wert) : wert
                    const waehlbar = unterschiedlich && !leer(wert) && (a.id === bleibt.id || einarbeiten.some((x) => x.id === a.id))
                    return (
                      <td key={a.id} className={`py-1.5 pr-3 ${dabei[a.id] ? '' : 'opacity-50'} ${waehlbar && sieger === a.id ? 'font-medium text-slate-900' : 'text-slate-700'}`}>
                        {waehlbar ? (
                          <label className="flex items-start gap-1.5">
                            <input type="radio" name={`${gruppe.schluessel}-${f.id}`} checked={sieger === a.id} onChange={() => setWahl((w) => ({ ...w, [f.id]: a.id }))} className="mt-1" />
                            <span className="break-words">{anzeige}</span>
                          </label>
                        ) : (
                          <span className="break-words">{anzeige || <span className="text-slate-300">–</span>}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {ZAEHLER_AKTE.map((z) => (
              <tr key={z.id} className="border-b border-slate-100">
                <td className="py-1 pr-3 text-xs text-slate-500">{z.label}</td>
                {gruppe.akten.map((a) => (
                  <td key={a.id} className={`py-1 pr-3 tabular-nums text-slate-700 ${dabei[a.id] ? '' : 'opacity-50'}`}>
                    {a.zaehler[z.id]}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="py-1 pr-3 text-xs text-slate-500">Letzte Aktivität</td>
              {gruppe.akten.map((a) => (
                <td key={a.id} className={`py-1 pr-3 text-slate-700 ${dabei[a.id] ? '' : 'opacity-50'}`}>
                  {datum(a.letzte_aktivitaet)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {andereBereiche.length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <p>
            Zusammenführen geht nur innerhalb eines Bereichs. Liegt dieselbe Person bewusst in zwei Bereichen, die Gruppe als „keine Dublette“ merken.
            Sonst zuerst in den Bereich {bleibt.bereichName} verschieben:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {andereBereiche.map((a) => (
              <SecondaryButton key={a.id} disabled={arbeitet || !istGf} onClick={() => setFrage({ art: 'bereich', akte: a })}>
                <MoveRight size={14} /> {akteName(a)} ({a.bereichName}) verschieben
              </SecondaryButton>
            ))}
          </div>
        </div>
      )}

      {meldungen.length > 0 && (
        <div className="space-y-1">
          {meldungen.map((m, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${m.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              {m.text}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton disabled={arbeitet || einarbeiten.length === 0 || !istGf} onClick={() => setFrage({ art: 'zusammen' })}>
          <Merge size={14} /> Zusammenführen{einarbeiten.length > 0 ? ` (${einarbeiten.length + 1} Akten)` : ''}
        </PrimaryButton>
        <SecondaryButton disabled={arbeitet} onClick={() => void keineDublette()}>
          <ShieldOff size={14} /> Keine Dublette
        </SecondaryButton>
        {!istGf && <span className="text-xs text-slate-500">Zusammenführen und Verschieben darf nur die Geschäftsführung oder ein Admin.</span>}
      </div>

      <Modal open={frage?.art === 'zusammen'} onClose={() => !arbeitet && setFrage(null)} title="Akten zusammenführen?">
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            Bestehen bleibt <strong>{akteName(bleibt)}</strong> ({bleibt.bereichName}).
          </p>
          <p>Eingearbeitet und danach unwiderruflich gelöscht:</p>
          <ul className="list-disc space-y-1 pl-5">
            {einarbeiten.map((a) => (
              <li key={a.id}>
                {akteName(a)} — {a.zaehler.dokumente} Dokumente, {a.zaehler.verlauf} Verlaufseinträge, {a.zaehler.rechnungen} Rechnungen, {a.zaehler.protokolle} Protokolle,{' '}
                {a.zaehler.termine} Termine, {a.zaehler.mails} Mails
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">
            Alles davon wandert in die bleibende Akte. Gewählte Angaben ersetzen die bisherigen; der alte Wert steht danach im Verlauf. Abweichende Angaben,
            die nicht gewählt sind, stehen ebenfalls im Verlauf.
          </p>
          <div className="flex justify-end gap-2">
            <SecondaryButton disabled={arbeitet} onClick={() => setFrage(null)}>
              Abbrechen
            </SecondaryButton>
            <PrimaryButton disabled={arbeitet} onClick={() => void zusammenfuehren()}>
              {arbeitet ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />} Ja, zusammenführen
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      <Modal open={frage?.art === 'bereich'} onClose={() => !arbeitet && setFrage(null)} title="In anderen Bereich verschieben?">
        {frage?.art === 'bereich' && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              <strong>{akteName(frage.akte)}</strong> wird mit Verlauf, Dokumenten, Protokollen, Terminen und Mails vom Bereich {frage.akte.bereichName} in den Bereich{' '}
              {bleibt.bereichName} verschoben. Danach lässt sie sich mit {akteName(bleibt)} zusammenführen.
            </p>
            <div className="flex justify-end gap-2">
              <SecondaryButton disabled={arbeitet} onClick={() => setFrage(null)}>
                Abbrechen
              </SecondaryButton>
              <PrimaryButton disabled={arbeitet} onClick={() => void verschieben(frage.akte)}>
                {arbeitet ? <Loader2 size={14} className="animate-spin" /> : <MoveRight size={14} />} Ja, verschieben
              </PrimaryButton>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}

// ---------- Objekte ----------

function ObjektGruppe({ gruppe, onKeineDublette }: { gruppe: GruppeMitObjekten; onKeineDublette: () => void }) {
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const zeilen: { label: string; wert: (o: ObjektAnsicht) => string }[] = [
    { label: 'Bezeichnung', wert: (o) => o.bezeichnung },
    { label: 'Adresse', wert: (o) => o.adresse },
    { label: 'Objektart', wert: (o) => o.typ },
    { label: 'Status', wert: (o) => statusText('immobilien', o.status) },
    { label: 'Kaufpreis', wert: (o) => euro(o.kaufpreis) },
    { label: 'Verantwortlich', wert: (o) => o.verantwortlich },
  ]

  async function keineDublette() {
    setArbeitet(true)
    setFehler(null)
    try {
      await call({ action: 'dubletten', modus: 'keine_dublette', art: 'objekt', ids: gruppe.ids })
      onKeineDublette()
    } catch (e) {
      setFehler((e as Error).message)
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StufeMarke g={gruppe} />
        <span className="text-sm text-slate-600">{gruppe.gruende.join(' · ')}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="w-40 py-2 pr-3" />
              {gruppe.objekte.map((o) => (
                <th key={o.id} className="py-2 pr-3 font-normal">
                  <Link to={`/immobilien/objekte/${o.id}`} className="inline-flex items-center gap-1 font-medium text-accent-700 hover:underline">
                    <ExternalLink size={12} /> {o.bezeichnung || 'ohne Bezeichnung'}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.label} className="border-b border-slate-100 align-top">
                <td className="py-1.5 pr-3 text-xs text-slate-500">{z.label}</td>
                {gruppe.objekte.map((o) => (
                  <td key={o.id} className="break-words py-1.5 pr-3 text-slate-700">
                    {z.wert(o) || <span className="text-slate-300">–</span>}
                  </td>
                ))}
              </tr>
            ))}
            {ZAEHLER_OBJEKT.map((z) => (
              <tr key={z.id} className="border-b border-slate-100">
                <td className="py-1 pr-3 text-xs text-slate-500">{z.label}</td>
                {gruppe.objekte.map((o) => (
                  <td key={o.id} className="py-1 pr-3 tabular-nums text-slate-700">
                    {o.zaehler[z.id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {fehler && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{fehler}</div>}
      <SecondaryButton disabled={arbeitet} onClick={() => void keineDublette()}>
        <ShieldOff size={14} /> Keine Dublette
      </SecondaryButton>
    </Card>
  )
}
