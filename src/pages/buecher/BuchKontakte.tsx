// Bücher & Verlag (21.11.2026): Kontakte rund um die Bücher — Autoren, Illustratoren, Lektorat,
// Druckereien, Händler, Presse.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Contact, Plus, Search, Trash2 } from 'lucide-react'
import { Card, EmptyState, Field, Modal, PrimaryButton, inputClass } from '../../components/ui'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import {
  aendereBuchKontakt,
  KONTAKT_ROLLEN,
  ladeBuecher,
  ladeBuchKontakte,
  legeBuchKontaktAn,
  loescheBuchKontakt,
  type Buch,
  type BuchKontakt,
  type BuchKontaktRolle,
} from '../../lib/buecher'

export function BuchKontakte() {
  const nutzer = useKvNutzer()
  const [liste, setListe] = useState<BuchKontakt[] | null>(null)
  const [buecher, setBuecher] = useState<Buch[]>([])
  const [fehler, setFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [rolleFilter, setRolleFilter] = useState<'' | BuchKontaktRolle>('')
  const [offen, setOffen] = useState<BuchKontakt | 'neu' | null>(null)

  const laden = () =>
    ladeBuchKontakte()
      .then(setListe)
      .catch((e) => {
        setFehler(e instanceof Error ? e.message : 'Kontakte ließen sich nicht laden.')
        setListe([])
      })

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setListe([])
      setFehler('Ohne Verbindung zur Datenbank können keine Kontakte angezeigt werden.')
      return
    }
    laden()
    ladeBuecher().then(setBuecher).catch(() => {})
  }, [])

  const titelVon = useMemo(() => new Map(buecher.map((b) => [b.id, b.titel])), [buecher])

  const gefiltert = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return (liste ?? []).filter(
      (k) => (!rolleFilter || k.rolle === rolleFilter) && (!s || [k.name, k.firma, k.email, k.telefon, k.notiz].some((t) => (t ?? '').toLowerCase().includes(s))),
    )
  }, [liste, suche, rolleFilter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Contact size={20} className="text-slate-400" /> Kontakte
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Autoren, Illustratoren, Lektorat, Druckereien, Händler und Presse — mit den Büchern, an denen sie beteiligt sind.</p>
        </div>
        {!nutzer.nurLesen && isSupabaseConfigured && (
          <PrimaryButton onClick={() => setOffen('neu')}>
            <Plus size={14} /> Neuer Kontakt
          </PrimaryButton>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma, E-Mail suchen" className={`${inputClass} w-full pl-8`} />
        </div>
        <select value={rolleFilter} onChange={(e) => setRolleFilter(e.target.value as '' | BuchKontaktRolle)} className={`${inputClass} w-auto`} aria-label="Rolle">
          <option value="">Alle Rollen</option>
          {KONTAKT_ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {liste === null ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : gefiltert.length === 0 ? (
        <EmptyState text={liste.length === 0 ? 'Noch keine Kontakte angelegt.' : 'Kein Kontakt passt zur Auswahl.'} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Rolle</th>
                <th className="px-4 py-2.5 font-medium">Firma</th>
                <th className="px-4 py-2.5 font-medium">E-Mail</th>
                <th className="px-4 py-2.5 font-medium">Telefon</th>
                <th className="px-4 py-2.5 font-medium">Bücher</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefiltert.map((k) => (
                <tr key={k.id} onClick={() => setOffen(k)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{k.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{k.rolle}</td>
                  <td className="px-4 py-2.5 text-slate-600">{k.firma ?? '–'}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {k.email ? (
                      <a href={`mailto:${k.email}`} onClick={(e) => e.stopPropagation()} className="text-accent-700 hover:underline">{k.email}</a>
                    ) : '–'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{k.telefon ?? '–'}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {k.buchIds.length === 0
                      ? '–'
                      : k.buchIds.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ', '}
                            <Link to={`/buecher/${id}`} onClick={(e) => e.stopPropagation()} className="text-accent-700 hover:underline">{titelVon.get(id) ?? 'Buch'}</Link>
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {offen && (
        <KontaktFenster
          kontakt={offen === 'neu' ? undefined : offen}
          buecher={buecher}
          nurLesen={nutzer.nurLesen}
          von={nutzer.name}
          onClose={() => setOffen(null)}
          onGespeichert={() => {
            setOffen(null)
            laden()
          }}
        />
      )}
    </div>
  )
}

function KontaktFenster({
  kontakt,
  buecher,
  nurLesen,
  von,
  onClose,
  onGespeichert,
}: {
  kontakt?: BuchKontakt
  buecher: Buch[]
  nurLesen: boolean
  von: string
  onClose: () => void
  onGespeichert: () => void
}) {
  const [name, setName] = useState(kontakt?.name ?? '')
  const [rolle, setRolle] = useState<BuchKontaktRolle>(kontakt?.rolle ?? 'Autor')
  const [firma, setFirma] = useState(kontakt?.firma ?? '')
  const [email, setEmail] = useState(kontakt?.email ?? '')
  const [telefon, setTelefon] = useState(kontakt?.telefon ?? '')
  const [notiz, setNotiz] = useState(kontakt?.notiz ?? '')
  const [buchIds, setBuchIds] = useState<string[]>(kontakt?.buchIds ?? [])
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState('')

  async function speichern() {
    if (!name.trim()) {
      setFehler('Bitte einen Namen eingeben.')
      return
    }
    setSpeichert(true)
    setFehler('')
    try {
      const daten = { name, rolle, firma, email, telefon, notiz, buchIds }
      if (kontakt) await aendereBuchKontakt(kontakt.id, daten, von)
      else await legeBuchKontaktAn(daten, von)
      onGespeichert()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
      setSpeichert(false)
    }
  }

  async function loeschen() {
    if (!kontakt || !confirm(`Kontakt „${kontakt.name}“ löschen?`)) return
    try {
      await loescheBuchKontakt(kontakt.id)
      onGespeichert()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={kontakt ? kontakt.name : 'Neuer Kontakt'}
      aktionen={
        !nurLesen && (
          <PrimaryButton onClick={speichern} disabled={speichert}>
            {speichert ? 'Speichert …' : 'Speichern'}
          </PrimaryButton>
        )
      }
    >
      <fieldset disabled={nurLesen}>
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Rolle">
            <select value={rolle} onChange={(e) => setRolle(e.target.value as BuchKontaktRolle)} className={inputClass}>
              {KONTAKT_ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Firma">
            <input value={firma} onChange={(e) => setFirma(e.target.value)} className={inputClass} />
          </Field>
          <Field label="E-Mail">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Telefon">
            <input value={telefon} onChange={(e) => setTelefon(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Notiz">
          <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={3} className={inputClass} />
        </Field>
        {buecher.length > 0 && (
          <div className="mb-3">
            <span className="mb-1 block text-xs font-medium text-slate-500">Beteiligt an</span>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {buecher.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={buchIds.includes(b.id)}
                    onChange={(e) => setBuchIds((alt) => (e.target.checked ? [...alt, b.id] : alt.filter((x) => x !== b.id)))}
                  />
                  {b.titel}
                </label>
              ))}
            </div>
          </div>
        )}
      </fieldset>
      {fehler && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      {kontakt && !nurLesen && (
        <div className="mt-3 flex justify-end">
          <button onClick={loeschen} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
            <Trash2 size={14} /> Kontakt löschen
          </button>
        </div>
      )}
    </Modal>
  )
}
