// Bücher & Verlag (21.11.2026): ein Buch mit allen Angaben, Stufe, Schritten je Stufe, Notizen,
// Dateien und verknüpften Kontakten.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FileText, Link2, Plus, Trash2, Upload, X } from 'lucide-react'
import { Card, Field, PrimaryButton, SecondaryButton, StatusBadge, inputClass } from '../../components/ui'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { zahlAusText } from '../../components/KvPositionenEditor'
import { MITARBEITER } from '../../data/constants'
import { getNextMainStep } from '../../data/statusNetworks'
import {
  aendereBuch,
  aendereBuchKontakt,
  BUCH_CHECKLISTE,
  BUCH_STUFEN,
  buchDateiLink,
  fortschritt,
  KONTAKT_ROLLEN,
  ladeBuch,
  ladeBuchDateiHoch,
  ladeBuchKontakte,
  legeBuchKontaktAn,
  loescheBuch,
  loescheBuchDatei,
  stufeLabel,
  type Buch,
  type BuchAenderung,
  type BuchKontakt,
  type BuchKontaktRolle,
  type BuchStatus,
} from '../../lib/buecher'
import { fmtDateTime } from '../../lib/dates'

type Formular = Record<string, string>

const TEXTFELDER: { feld: keyof Buch; label: string; platzhalter?: string; typ?: 'text' | 'number' | 'date'; breit?: boolean }[] = [
  { feld: 'titel', label: 'Titel', breit: true },
  { feld: 'untertitel', label: 'Untertitel', breit: true },
  { feld: 'reihe', label: 'Reihe' },
  { feld: 'band', label: 'Band' },
  { feld: 'autor', label: 'Autor' },
  { feld: 'illustrator', label: 'Illustrator' },
  { feld: 'lektorat', label: 'Lektorat' },
  { feld: 'zielgruppe', label: 'Zielgruppe', platzhalter: 'z. B. Kinder 3–6 Jahre' },
  { feld: 'format', label: 'Format', platzhalter: 'z. B. Hardcover, 21 × 28 cm' },
  { feld: 'seitenzahl', label: 'Seitenzahl', typ: 'number' },
  { feld: 'isbn', label: 'ISBN', platzhalter: '978-3-…' },
  { feld: 'auflage', label: 'Auflage (Stück)', typ: 'number' },
  { feld: 'druckerei', label: 'Druckerei' },
  { feld: 'erscheinungstermin', label: 'Erscheinungstermin', typ: 'date' },
  { feld: 'ladenpreis', label: 'Ladenpreis (€, inkl. MwSt.)', typ: 'number' },
]

const ZAHLFELDER = new Set(['seitenzahl', 'auflage', 'ladenpreis'])

function formularAus(b: Buch): Formular {
  const f: Formular = {}
  for (const { feld } of TEXTFELDER) {
    const v = b[feld]
    f[feld] = v === undefined || v === null ? '' : feld === 'ladenpreis' ? String(v).replace('.', ',') : String(v)
  }
  f.verantwortlich = b.verantwortlich ?? ''
  return f
}

function zahlAus(text: string, ganz: boolean): number | undefined {
  if (!text.trim()) return undefined
  // „1.250“ ist 1250 (vorher 1,25), „490.50“ bleibt 490,5 — wie bei den Kostenvoranschlägen.
  const n = zahlAusText(text)
  if (!Number.isFinite(n)) return undefined
  return ganz ? Math.round(n) : Math.round(n * 100) / 100
}

export function BuchDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const nutzer = useKvNutzer()
  const nurLesen = nutzer.nurLesen
  const [buch, setBuch] = useState<Buch | null | undefined>(undefined)
  const [form, setForm] = useState<Formular>({})
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [kontakte, setKontakte] = useState<BuchKontakt[]>([])

  function uebernehmen(b: Buch) {
    setBuch(b)
    setForm(formularAus(b))
    setNotizen(b.notizen ?? '')
  }

  useEffect(() => {
    let aktiv = true
    ladeBuch(id)
      .then((b) => {
        if (!aktiv) return
        if (b) uebernehmen(b)
        else setBuch(null)
      })
      .catch((e) => {
        if (!aktiv) return
        setFehler(e instanceof Error ? e.message : 'Buch ließ sich nicht laden.')
        setBuch(null)
      })
    ladeBuchKontakte().then((k) => aktiv && setKontakte(k)).catch(() => {})
    return () => {
      aktiv = false
    }
  }, [id])

  const geaendert = useMemo(() => {
    if (!buch) return false
    const alt = formularAus(buch)
    return Object.keys(form).some((k) => (form[k] ?? '') !== (alt[k] ?? ''))
  }, [buch, form])

  function meldeErfolg(text: string) {
    setHinweis(text)
    window.setTimeout(() => setHinweis(''), 2500)
  }

  async function speichere(aenderung: BuchAenderung, erfolg = 'Gespeichert.') {
    if (!buch) return
    setSpeichert(true)
    setFehler('')
    try {
      const neu = await aendereBuch(buch.id, aenderung, nutzer.name)
      setBuch(neu)
      meldeErfolg(erfolg)
      return neu
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSpeichert(false)
    }
  }

  async function angabenSpeichern() {
    if (!buch) return
    if (!form.titel?.trim()) {
      setFehler('Der Titel darf nicht leer sein.')
      return
    }
    // Nur geänderte Felder schreiben, damit gleichzeitige Änderungen anderer erhalten bleiben.
    const alt = formularAus(buch)
    const aenderung: Record<string, unknown> = {}
    for (const k of Object.keys(form)) {
      if ((form[k] ?? '') === (alt[k] ?? '')) continue
      aenderung[k] = ZAHLFELDER.has(k) ? zahlAus(form[k], k !== 'ladenpreis') ?? null : form[k]
    }
    const neu = await speichere(aenderung as BuchAenderung)
    if (neu) setForm(formularAus(neu))
  }

  async function stufeSetzen(s: BuchStatus) {
    await speichere({ status: s }, `Stufe: ${stufeLabel(s)}`)
  }

  // Häkchen und Dateien: vor dem Schreiben den aktuellen Stand aus der Datenbank holen und nur die
  // eigene Änderung einarbeiten — sonst überschreibt ein zweites offenes Fenster die Häkchen anderer.
  async function schrittUmschalten(schrittId: string) {
    if (!buch || nurLesen) return
    try {
      const aktuell = (await ladeBuch(buch.id)) ?? buch
      await speichere({ checkliste: { ...aktuell.checkliste, [schrittId]: !aktuell.checkliste[schrittId] } }, 'Schritt gespeichert.')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.')
    }
  }

  async function notizenSpeichern() {
    if (!buch || notizen === (buch.notizen ?? '')) return
    await speichere({ notizen }, 'Notizen gespeichert.')
  }

  if (buch === undefined) return <p className="text-sm text-slate-400">Lädt …</p>
  if (buch === null)
    return (
      <div className="space-y-3">
        <Link to="/buecher" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Zurück zu den Büchern
        </Link>
        <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler || 'Dieses Buch gibt es nicht (mehr).'}</p>
      </div>
    )

  const naechste = getNextMainStep('buecher', buch.status) as BuchStatus | null
  const st = BUCH_STUFEN.find((s) => s.id === buch.status)
  const f = fortschritt(buch)
  const verknuepft = kontakte.filter((k) => k.buchIds.includes(buch.id))

  return (
    <div className="space-y-5">
      <Link to="/buecher" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Zurück zu den Büchern
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-800">{buch.titel}</h1>
          {buch.untertitel && <p className="text-sm text-slate-500">{buch.untertitel}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <StatusBadge label={st?.label ?? buch.status} color={st?.farbe ?? ''} />
            <span>{f.erledigt} von {f.gesamt} Schritten erledigt</span>
            <span>· zuletzt geändert {fmtDateTime(buch.geaendertAm)}{buch.geaendertVon ? ` von ${buch.geaendertVon}` : ''}</span>
          </div>
        </div>
        {!nurLesen && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={buch.status}
              onChange={(e) => stufeSetzen(e.target.value as BuchStatus)}
              className={`${inputClass} w-auto`}
              aria-label="Stufe"
              disabled={speichert}
            >
              {BUCH_STUFEN.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {naechste && (
              <PrimaryButton onClick={() => stufeSetzen(naechste)} disabled={speichert}>
                Weiter: {stufeLabel(naechste)} <ArrowRight size={14} />
              </PrimaryButton>
            )}
          </div>
        )}
      </div>

      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      {hinweis && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">{hinweis}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Angaben zum Buch</h2>
              {!nurLesen && (
                <PrimaryButton onClick={angabenSpeichern} disabled={!geaendert || speichert}>
                  {speichert ? 'Speichert …' : 'Speichern'}
                </PrimaryButton>
              )}
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {TEXTFELDER.map((t) => (
                <div key={t.feld} className={t.breit ? 'sm:col-span-2' : ''}>
                  <Field label={t.label}>
                    <input
                      type={t.typ === 'date' ? 'date' : 'text'}
                      inputMode={t.typ === 'number' ? 'decimal' : undefined}
                      value={form[t.feld] ?? ''}
                      onChange={(e) => setForm((alt) => ({ ...alt, [t.feld]: e.target.value }))}
                      placeholder={t.platzhalter}
                      className={inputClass}
                      disabled={nurLesen}
                    />
                  </Field>
                </div>
              ))}
              <Field label="Verantwortlich">
                <select
                  value={form.verantwortlich ?? ''}
                  onChange={(e) => setForm((alt) => ({ ...alt, verantwortlich: e.target.value }))}
                  className={inputClass}
                  disabled={nurLesen}
                >
                  <option value="">– niemand –</option>
                  {[...new Set([...MITARBEITER, ...(buch.verantwortlich ? [buch.verantwortlich] : [])])].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">Schritte</h2>
            <p className="mb-3 text-xs text-slate-500">Übliche Schritte bis zum fertigen Buch. Die Gruppe der aktuellen Stufe ist hervorgehoben.</p>
            <div className="space-y-3">
              {BUCH_CHECKLISTE.map((g) => {
                const aktuell = g.stufe === buch.status
                const erledigt = g.schritte.filter((s) => buch.checkliste[s.id]).length
                return (
                  <div key={g.stufe} className={`rounded-lg border p-3 ${aktuell ? 'border-accent-200 bg-accent-50/40' : 'border-slate-100'}`}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className={`font-semibold ${aktuell ? 'text-accent-700' : 'text-slate-600'}`}>{g.titel}</span>
                      <span className="tabular-nums text-slate-400">{erledigt}/{g.schritte.length}</span>
                    </div>
                    <ul className="space-y-1">
                      {g.schritte.map((s) => {
                        const an = !!buch.checkliste[s.id]
                        return (
                          <li key={s.id}>
                            <button
                              onClick={() => schrittUmschalten(s.id)}
                              disabled={nurLesen || speichert}
                              className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-white disabled:cursor-default"
                            >
                              <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${an ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-300 bg-white'}`}>
                                {an && <Check size={12} />}
                              </span>
                              <span>
                                <span className={an ? 'text-slate-400 line-through' : 'text-slate-700'}>{s.label}</span>
                                {s.hinweis && <span className="block text-xs text-slate-400">{s.hinweis}</span>}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Notizen</h2>
            <textarea
              value={notizen}
              onChange={(e) => setNotizen(e.target.value)}
              onBlur={notizenSpeichern}
              rows={6}
              className={inputClass}
              placeholder="Ideen, Absprachen, offene Fragen …"
              disabled={nurLesen}
            />
            <p className="mt-1 text-xs text-slate-400">Wird beim Verlassen des Feldes gespeichert.</p>
          </Card>

          <DateienKarte buch={buch} nurLesen={nurLesen} von={nutzer.name} onBuch={setBuch} onFehler={setFehler} />

          <KontakteKarte
            buch={buch}
            alle={kontakte}
            verknuepft={verknuepft}
            nurLesen={nurLesen}
            von={nutzer.name}
            onKontakte={setKontakte}
            onFehler={setFehler}
          />

          {!nurLesen && (
            <div className="flex justify-end">
              <button
                onClick={async () => {
                  if (!confirm(`„${buch.titel}“ mit allen Dateien löschen? Das lässt sich nicht rückgängig machen.`)) return
                  try {
                    await loescheBuch(buch)
                    navigate('/buecher')
                  } catch (e) {
                    setFehler(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.')
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
              >
                <Trash2 size={14} /> Buch löschen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DateienKarte({
  buch,
  nurLesen,
  von,
  onBuch,
  onFehler,
}: {
  buch: Buch
  nurLesen: boolean
  von: string
  onBuch: (b: Buch) => void
  onFehler: (t: string) => void
}) {
  const eingabe = useRef<HTMLInputElement>(null)
  const [laedt, setLaedt] = useState(false)

  async function hochladen(dateien: FileList | null) {
    if (!dateien?.length) return
    setLaedt(true)
    onFehler('')
    try {
      const neu = []
      for (const d of Array.from(dateien)) neu.push(await ladeBuchDateiHoch(buch.id, d, von))
      const aktuell = (await ladeBuch(buch.id)) ?? buch
      onBuch(await aendereBuch(buch.id, { dokumente: [...aktuell.dokumente, ...neu] }, von))
    } catch (e) {
      onFehler(e instanceof Error ? e.message : 'Hochladen fehlgeschlagen.')
    } finally {
      setLaedt(false)
      if (eingabe.current) eingabe.current.value = ''
    }
  }

  async function oeffnen(pfad: string) {
    try {
      window.open(await buchDateiLink(pfad), '_blank', 'noopener')
    } catch (e) {
      onFehler(e instanceof Error ? e.message : 'Datei ließ sich nicht öffnen.')
    }
  }

  async function entfernen(dokId: string, name: string, pfad: string) {
    if (!confirm(`Datei „${name}“ löschen?`)) return
    try {
      const aktuell = (await ladeBuch(buch.id)) ?? buch
      onBuch(await aendereBuch(buch.id, { dokumente: aktuell.dokumente.filter((d) => d.id !== dokId) }, von))
      await loescheBuchDatei(pfad)
    } catch (e) {
      onFehler(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.')
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Dateien</h2>
        {!nurLesen && (
          <>
            <input ref={eingabe} type="file" multiple className="hidden" onChange={(e) => hochladen(e.target.files)} />
            <SecondaryButton onClick={() => eingabe.current?.click()} disabled={laedt}>
              <Upload size={14} /> {laedt ? 'Lädt hoch …' : 'Hochladen'}
            </SecondaryButton>
          </>
        )}
      </div>
      {buch.dokumente.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Dateien — z. B. Manuskript, Illustrationen, Druckangebot, Vertrag.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {buch.dokumente.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
              <FileText size={15} className="flex-shrink-0 text-slate-400" />
              <button onClick={() => oeffnen(d.pfad)} className="min-w-0 flex-1 truncate text-left text-accent-700 hover:underline" title={d.name}>
                {d.name}
              </button>
              <span className="text-xs text-slate-400">{d.groesse}</span>
              {!nurLesen && (
                <button onClick={() => entfernen(d.id, d.name, d.pfad)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Datei löschen">
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function KontakteKarte({
  buch,
  alle,
  verknuepft,
  nurLesen,
  von,
  onKontakte,
  onFehler,
}: {
  buch: Buch
  alle: BuchKontakt[]
  verknuepft: BuchKontakt[]
  nurLesen: boolean
  von: string
  onKontakte: (k: BuchKontakt[]) => void
  onFehler: (t: string) => void
}) {
  const [auswahl, setAuswahl] = useState('')
  const [neuOffen, setNeuOffen] = useState(false)
  const [name, setName] = useState('')
  const [rolle, setRolle] = useState<BuchKontaktRolle>('Autor')
  const frei = alle.filter((k) => !k.buchIds.includes(buch.id))

  function ersetze(k: BuchKontakt) {
    onKontakte(alle.some((x) => x.id === k.id) ? alle.map((x) => (x.id === k.id ? k : x)) : [...alle, k].sort((a, b) => a.name.localeCompare(b.name, 'de')))
  }

  async function verknuepfen(kontaktId: string, an: boolean) {
    try {
      // Aktuellen Stand holen, damit Verknüpfungen zu anderen Büchern nicht verloren gehen.
      const frisch = (await ladeBuchKontakte()).find((k) => k.id === kontaktId)
      if (!frisch) return
      const ids = an ? [...new Set([...frisch.buchIds, buch.id])] : frisch.buchIds.filter((x) => x !== buch.id)
      ersetze(await aendereBuchKontakt(kontaktId, { buchIds: ids }, von))
    } catch (e) {
      onFehler(e instanceof Error ? e.message : 'Kontakt ließ sich nicht verknüpfen.')
    }
  }

  async function neuAnlegen() {
    if (!name.trim()) return
    try {
      ersetze(await legeBuchKontaktAn({ name, rolle, buchIds: [buch.id] }, von))
      setName('')
      setNeuOffen(false)
    } catch (e) {
      onFehler(e instanceof Error ? e.message : 'Kontakt ließ sich nicht anlegen.')
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Kontakte zu diesem Buch</h2>
        <Link to="/buecher/kontakte" className="text-xs text-slate-500 hover:text-slate-700">Alle Kontakte</Link>
      </div>
      {verknuepft.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Kontakte verknüpft.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {verknuepft.map((k) => (
            <li key={k.id} className="flex items-start gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-700">
                  {k.name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">{k.rolle}</span>
                </div>
                <div className="text-xs text-slate-500">{[k.firma, k.email, k.telefon].filter(Boolean).join(' · ')}</div>
              </div>
              {!nurLesen && (
                <button onClick={() => verknuepfen(k.id, false)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Verknüpfung lösen" aria-label="Verknüpfung lösen">
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!nurLesen && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {frei.length > 0 && (
            <div className="flex gap-2">
              <select value={auswahl} onChange={(e) => setAuswahl(e.target.value)} className={inputClass} aria-label="Vorhandenen Kontakt wählen">
                <option value="">Vorhandenen Kontakt wählen …</option>
                {frei.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.rolle})</option>)}
              </select>
              <SecondaryButton
                onClick={() => {
                  if (auswahl) verknuepfen(auswahl, true).then(() => setAuswahl(''))
                }}
                disabled={!auswahl}
              >
                <Link2 size={14} /> Verknüpfen
              </SecondaryButton>
            </div>
          )}
          {neuOffen ? (
            <div className="flex flex-wrap gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${inputClass} min-w-[140px] flex-1`} />
              <select value={rolle} onChange={(e) => setRolle(e.target.value as BuchKontaktRolle)} className={`${inputClass} w-auto`} aria-label="Rolle">
                {KONTAKT_ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <PrimaryButton onClick={neuAnlegen} disabled={!name.trim()}>Anlegen</PrimaryButton>
            </div>
          ) : (
            <button onClick={() => setNeuOffen(true)} className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline">
              <Plus size={14} /> Neuen Kontakt anlegen
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
