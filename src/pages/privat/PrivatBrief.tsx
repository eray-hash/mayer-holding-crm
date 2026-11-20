import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FolderInput, Mic, Search, Sparkles, Square, X, FileText, Check } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { useMsStatus } from '../../lib/microsoftKonto'
import { erzeugeBrief, glaetteBrief, herunterladen, textZuAbsaetzen, useBriefboegen, type BriefErgebnis } from '../../lib/briefe'
import { ladeKundenDokumentHoch } from '../../lib/kundenDokumenteStorage'
import { useSpeechRecognition } from '../../lib/useSpeechRecognition'
import { today, uid } from '../../lib/dates'
import { Field, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import type { Dokument, Kunde, KundeBereich } from '../../types'

type Auswahl = { bereich: KundeBereich; kunde: Kunde }

/** Bereich Privat → Brief: diktieren oder tippen, von der KI glätten lassen, auf dem eigenen Briefbogen als Word + PDF. */
export function PrivatBrief() {
  const { ansichtAls, session } = useAuth()
  const { status } = useMsStatus(ansichtAls ? undefined : session?.user.email?.toLowerCase())
  if (ansichtAls) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Briefe werden in dieser Ansicht nicht gezeigt.</div>
  if (!status) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!status.erlaubt) return <p className="text-sm text-slate-500">Briefe auf eigenem Briefbogen sind für dein Konto nicht freigeschaltet.</p>
  return <Inhalt />
}

function Inhalt() {
  const { state, dispatch } = useApp()
  const { briefboegen, fehler: ladeFehler } = useBriefboegen(true)
  const [briefbogenId, setBriefbogenId] = useState('')
  const [auswahl, setAuswahl] = useState<Auswahl | null>(null)
  const [suche, setSuche] = useState('')
  const [empfaenger, setEmpfaenger] = useState('')
  const [betreff, setBetreff] = useState('')
  const [anrede, setAnrede] = useState('')
  const [text, setText] = useState('')
  const [arbeitet, setArbeitet] = useState<'' | 'glaetten' | 'erzeugen' | 'ablegen'>('')
  const [fehler, setFehler] = useState('')
  const [ergebnis, setErgebnis] = useState<BriefErgebnis | null>(null)
  const [abgelegt, setAbgelegt] = useState(false)
  const sprache = useSpeechRecognition()

  const bogen = briefboegen?.find((b) => b.id === briefbogenId) ?? briefboegen?.[0]

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase()
    if (q.length < 2) return []
    const liste: Auswahl[] = []
    for (const b of KUNDEN_BEREICHE) for (const k of b.get(state)) if (`${k.firma} ${k.ansprechpartner} ${k.email}`.toLowerCase().includes(q)) liste.push({ bereich: b.id, kunde: k })
    return liste.slice(0, 8)
  }, [suche, state])

  const zeilen = () => empfaenger.split('\n').map((z) => z.trim()).filter((z, i, alle) => z || (i > 0 && i < alle.length - 1))

  function waehle(a: Auswahl | null) {
    setAuswahl(a)
    setSuche('')
    setErgebnis(null)
    if (a) {
      const k = a.kunde
      const neu = [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean)
      setEmpfaenger((alt) => (alt.trim() ? alt : neu.join('\n')))
    }
  }

  function diktat() {
    if (sprache.recording) {
      sprache.stop()
      return
    }
    sprache.setTranscript('')
    sprache.setInterim('')
    sprache.start()
  }
  // Diktierten Text an den vorhandenen anhängen, sobald die Aufnahme fertig ist.
  const diktiert = (sprache.interim ? `${sprache.transcript} ${sprache.interim}` : sprache.transcript).trim()
  function diktatUebernehmen() {
    if (!diktiert) return
    setText((t) => (t.trim() ? `${t.trim()}\n\n${diktiert}` : diktiert))
    sprache.setTranscript('')
    sprache.setInterim('')
  }

  async function glaetten() {
    setFehler('')
    setArbeitet('glaetten')
    try {
      const g = await glaetteBrief(text, { betreff, empfaenger: zeilen() })
      setBetreff(g.betreff)
      setAnrede(g.anrede)
      setText(g.absaetze.join('\n\n'))
      setErgebnis(null)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet('')
    }
  }

  async function erzeugen() {
    if (!bogen) return
    setFehler('')
    setArbeitet('erzeugen')
    setAbgelegt(false)
    try {
      setErgebnis(await erzeugeBrief(bogen.id, { empfaenger: zeilen(), betreff, anrede, absaetze: textZuAbsaetzen(text) }))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet('')
    }
  }

  async function inAkte() {
    if (!ergebnis || !auswahl) return
    setFehler('')
    setArbeitet('ablegen')
    try {
      const neue: Dokument[] = []
      for (const [blob, endung] of [
        [ergebnis.pdf, 'pdf'],
        [ergebnis.docx, 'docx'],
      ] as const) {
        const name = `${ergebnis.name}.${endung}`
        const { pfad, groesse } = await ladeKundenDokumentHoch(auswahl.kunde.id, new File([blob], name, { type: blob.type }))
        neue.push({ id: uid('dok'), name, typ: blob.type, datum: today(), groesse, url: pfad })
      }
      const aktuell = KUNDEN_BEREICHE.find((b) => b.id === auswahl.bereich)!.get(state).find((k) => k.id === auswahl.kunde.id)
      dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: auswahl.bereich, id: auswahl.kunde.id, patch: { dokumente: [...(aktuell?.dokumente ?? []), ...neue] } })
      setAbgelegt(true)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet('')
    }
  }

  if (briefboegen && briefboegen.length === 0) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Noch kein Briefbogen hinterlegt. Lege ihn unter{' '}
        <Link className="font-medium text-accent-700 hover:underline" to="/privat/einstellungen">
          Einstellungen
        </Link>{' '}
        an.
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Brief schreiben</h1>
        <p className="text-sm text-slate-500">Tippen oder diktieren, auf Wunsch glätten lassen, dann als Word und PDF auf deinem Briefbogen.</p>
      </div>
      {ladeFehler && <p className="text-sm text-red-600">{ladeFehler}</p>}

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Briefbogen">
            <select className={inputClass} value={bogen?.id ?? ''} onChange={(e) => setBriefbogenId(e.target.value)}>
              {(briefboegen ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Für Kontakt (optional, zum Ablegen)">
            {auswahl ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="truncate">{auswahl.kunde.firma || auswahl.kunde.ansprechpartner}</span>
                <button className="text-slate-400 hover:text-slate-600" title="Entfernen" onClick={() => waehle(null)}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input className={`${inputClass} pl-8`} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name oder Firma suchen" />
                {treffer.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow">
                    {treffer.map((t) => (
                      <li key={`${t.bereich}-${t.kunde.id}`}>
                        <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => waehle(t)}>
                          {t.kunde.firma || t.kunde.ansprechpartner}
                          <span className="ml-1 text-xs text-slate-400">{KUNDEN_BEREICHE.find((b) => b.id === t.bereich)?.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
        </div>

        <Field label="Empfänger (eine Zeile je Zeile: Name, Straße, PLZ Ort)">
          <textarea className={`${inputClass} min-h-[6rem]`} value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Betreff">
            <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </Field>
          <Field label="Anrede">
            <input className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)} placeholder="Sehr geehrte Damen und Herren," />
          </Field>
        </div>
        <Field label="Text (Leerzeile = neuer Absatz)">
          <textarea className={`${inputClass} min-h-[14rem]`} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          {sprache.supported && (
            <SecondaryButton onClick={diktat}>
              {sprache.recording ? <Square size={15} /> : <Mic size={15} />} {sprache.recording ? 'Diktat beenden' : 'Diktieren'}
            </SecondaryButton>
          )}
          <SecondaryButton onClick={glaetten} disabled={!text.trim() || !!arbeitet}>
            <Sparkles size={15} /> {arbeitet === 'glaetten' ? 'Wird geglättet …' : 'Mit KI glätten'}
          </SecondaryButton>
          <PrimaryButton onClick={erzeugen} disabled={!bogen || !text.trim() || !!arbeitet}>
            <FileText size={15} /> {arbeitet === 'erzeugen' ? 'Wird erstellt …' : 'Brief erstellen'}
          </PrimaryButton>
        </div>
        {(sprache.recording || diktiert || sprache.beschaeftigt) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <div className="mb-1 text-xs text-slate-500">{sprache.recording ? 'Aufnahme läuft …' : sprache.beschaeftigt ? 'Wird abgeschrieben …' : 'Diktat'}</div>
            <div className="whitespace-pre-wrap">{diktiert || '…'}</div>
            {!sprache.recording && diktiert && (
              <SecondaryButton className="mt-2" onClick={diktatUebernehmen}>
                In den Text übernehmen
              </SecondaryButton>
            )}
          </div>
        )}
        {sprache.error && <p className="text-sm text-red-600">{sprache.error}</p>}
        {fehler && <p className="text-sm text-red-600">{fehler}</p>}
      </section>

      {ergebnis && (
        <section className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="text-sm font-medium text-emerald-900">Brief erstellt: {ergebnis.name}</div>
          {!ergebnis.mitHintergrund && <p className="text-xs text-amber-700">Für diesen Briefbogen ist kein PDF-Hintergrund hinterlegt — das PDF hat deshalb keinen Briefkopf. Die Word-Datei hat ihn.</p>}
          <div className="flex flex-wrap gap-2">
            <PrimaryButton onClick={() => herunterladen(ergebnis.pdf, `${ergebnis.name}.pdf`)}>
              <Download size={15} /> PDF
            </PrimaryButton>
            <SecondaryButton onClick={() => herunterladen(ergebnis.docx, `${ergebnis.name}.docx`)}>
              <Download size={15} /> Word
            </SecondaryButton>
            {auswahl && (
              <SecondaryButton onClick={inAkte} disabled={!!arbeitet || abgelegt}>
                {abgelegt ? <Check size={15} /> : <FolderInput size={15} />} {abgelegt ? 'In der Akte' : arbeitet === 'ablegen' ? 'Wird abgelegt …' : 'In die Akte legen'}
              </SecondaryButton>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
