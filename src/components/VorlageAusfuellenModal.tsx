import { useMemo, useState } from 'react'
import { Download, FolderInput, Copy, Check, Search, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { CURRENT_USER } from '../data/constants'
import { briefkopfAus } from '../data/briefkopf'
import { ladeKundenDokumentHoch } from '../lib/kundenDokumenteStorage'
import { erzeugeVorlagePdf } from '../lib/vorlagePdf'
import {
  felderAus,
  fuelleAlsText,
  hatKopfzeile,
  hauptfelder,
  offeneFelder,
  vorbelegteKaestchen,
  vorbelegung,
  zerlegeVorlage,
  type InlineTeil,
} from '../lib/vorlagenFuellen'
import { fmtDate, today, uid } from '../lib/dates'
import { Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import type { Dokument, Kunde, KundeBereich, Vorlage } from '../types'

type Auswahl = { bereich: KundeBereich; kunde: Kunde }

// Ausfüllen einer Vorlage: Kunde wählen (optional), die Felder werden aus der Akte vorbelegt, alles
// bleibt von Hand änderbar, Kästchen lassen sich in der Vorschau anklicken. Ergebnis als PDF mit
// Briefkopf — zum Herunterladen oder direkt in die Akte. Am Wortlaut der Vorlage ändert das nichts.
export function VorlageAusfuellenModal({
  vorlage,
  onClose,
  startKunde,
}: {
  vorlage: Vorlage
  onClose: () => void
  startKunde?: Auswahl
}) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const bearbeiter = mitarbeiter?.name ?? CURRENT_USER
  const heute = fmtDate(today())
  const briefkopf = useMemo(() => briefkopfAus(state.vorlagenBeratung), [state.vorlagenBeratung])

  const [auswahl, setAuswahl] = useState<Auswahl | undefined>(startKunde)
  const [suche, setSuche] = useState('')
  const [werte, setWerte] = useState<Record<string, string>>(() => vorbelegung(vorlage.text, { kunde: startKunde?.kunde, mitarbeiter: bearbeiter, heute }))
  // Welche Felder der Nutzer selbst angefasst hat — die überschreibt ein Kundenwechsel nicht mehr.
  const [vonHand, setVonHand] = useState<Set<string>>(new Set())
  const [angekreuzt, setAngekreuzt] = useState<Set<number>>(() => vorbelegteKaestchen(vorlage.text))
  const [kopiert, setKopiert] = useState(false)
  const [ablegen, setAblegen] = useState<'idle' | 'laeuft' | 'fertig'>('idle')
  const [fehler, setFehler] = useState('')

  const felder = useMemo(() => felderAus(vorlage.text), [vorlage.text])
  // In der linken Spalte nur die Hauptangaben; Tabellenzellen füllt man direkt in der Vorschau aus.
  const haupt = useMemo(() => hauptfelder(vorlage.text), [vorlage.text])
  const bloecke = useMemo(() => zerlegeVorlage(vorlage.text), [vorlage.text])
  const offen = offeneFelder(vorlage.text, werte).filter((n) => haupt.includes(n))

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase()
    if (q.length < 2) return []
    const liste: Auswahl[] = []
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        if (`${k.firma} ${k.ansprechpartner} ${k.email}`.toLowerCase().includes(q)) liste.push({ bereich: b.id, kunde: k })
      }
    }
    return liste.slice(0, 8)
  }, [suche, state])

  function waehleKunde(a: Auswahl | undefined) {
    setAuswahl(a)
    setSuche('')
    setAblegen('idle')
    const neu = vorbelegung(vorlage.text, { kunde: a?.kunde, mitarbeiter: bearbeiter, heute })
    setWerte((alt) => {
      const ergebnis: Record<string, string> = {}
      for (const name of felder) {
        if (vonHand.has(name)) ergebnis[name] = alt[name] ?? ''
        else if (neu[name]) ergebnis[name] = neu[name]
      }
      return ergebnis
    })
  }

  function setzeFeld(name: string, wert: string) {
    setWerte((alt) => ({ ...alt, [name]: wert }))
    setVonHand((alt) => new Set(alt).add(name))
    setAblegen('idle')
  }

  function schalteKaestchen(nr: number) {
    setAngekreuzt((alt) => {
      const neu = new Set(alt)
      if (neu.has(nr)) neu.delete(nr)
      else neu.add(nr)
      return neu
    })
    setAblegen('idle')
  }

  const dateiname = () => {
    const wer = auswahl ? (auswahl.kunde.ansprechpartner || auswahl.kunde.firma).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') : ''
    const was = vorlage.name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')
    return `${was}${wer ? `_${wer}` : ''}_${today()}.pdf`
  }

  function alsPdf() {
    setFehler('')
    try {
      erzeugeVorlagePdf({ text: vorlage.text, werte, angekreuzt, briefkopf }).save(dateiname())
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'PDF konnte nicht erzeugt werden.')
    }
  }

  async function inAkte() {
    if (!auswahl) return
    setFehler('')
    setAblegen('laeuft')
    try {
      const blob = erzeugeVorlagePdf({ text: vorlage.text, werte, angekreuzt, briefkopf }).output('blob')
      const name = dateiname()
      const file = new File([blob], name, { type: 'application/pdf' })
      const { pfad, groesse } = await ladeKundenDokumentHoch(auswahl.kunde.id, file)
      const dokument: Dokument = { id: uid('dok'), name, typ: 'application/pdf', datum: today(), groesse, url: pfad }
      // Den aktuellen Stand der Akte nehmen, nicht den beim Öffnen des Fensters gemerkten.
      const aktuell = KUNDEN_BEREICHE.find((b) => b.id === auswahl.bereich)!.get(state).find((k) => k.id === auswahl.kunde.id)
      dispatch({
        type: 'UPDATE_KUNDE_IN_BEREICH',
        bereich: auswahl.bereich,
        id: auswahl.kunde.id,
        patch: { dokumente: [...(aktuell?.dokumente ?? []), dokument] },
      })
      setAblegen('fertig')
    } catch (err) {
      setAblegen('idle')
      setFehler(err instanceof Error ? err.message : 'Ablegen in der Akte ist fehlgeschlagen.')
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(fuelleAlsText(vorlage.text, werte, angekreuzt))
      setKopiert(true)
      setTimeout(() => setKopiert(false), 1500)
    } catch {
      setFehler('Der Text konnte nicht in die Zwischenablage kopiert werden.')
    }
  }

  const zeigeTeile = (teile: InlineTeil[]) =>
    teile.map((t, i) => {
      if (t.art === 'text') return t.fett ? <strong key={i} className="font-semibold text-slate-800">{t.text}</strong> : <span key={i}>{t.text}</span>
      if (t.art === 'kaestchen') {
        const an = angekreuzt.has(t.nr)
        return (
          <button
            key={i}
            type="button"
            onClick={() => schalteKaestchen(t.nr)}
            aria-pressed={an}
            title={an ? 'Angekreuzt — zum Entfernen klicken' : 'Zum Ankreuzen klicken'}
            className={`mx-0.5 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded-sm border text-[11px] font-bold leading-none ${
              an ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-400 bg-white text-transparent hover:border-accent-500'
            }`}
          >
            ×
          </button>
        )
      }
      const wert = werte[t.name] ?? ''
      const kurz = t.name.includes(': ') ? '' : t.name
      return (
        <input
          key={i}
          value={wert}
          onChange={(e) => setzeFeld(t.name, e.target.value)}
          placeholder={kurz}
          title={t.name}
          aria-label={t.name}
          size={Math.max(4, Math.min(48, (wert || kurz).length + 1))}
          className={`mx-0.5 max-w-full rounded border-0 px-1 py-0 text-sm text-slate-800 outline-none ring-1 focus:ring-2 focus:ring-accent-400 ${
            wert.trim() ? 'bg-emerald-50 ring-emerald-100' : 'bg-amber-50 ring-amber-200 placeholder:text-amber-600'
          }`}
        />
      )
    })

  return (
    <Modal open onClose={onClose} title={`Ausfüllen: ${vorlage.name}`} width="max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Für wen?</p>
            {auswahl ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700">{auswahl.kunde.ansprechpartner || auswahl.kunde.firma}</p>
                  <p className="truncate text-xs text-slate-400">
                    {auswahl.kunde.firma} · {KUNDEN_BEREICHE.find((b) => b.id === auswahl.bereich)?.label}
                  </p>
                </div>
                <button onClick={() => waehleKunde(undefined)} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" aria-label="Kunde entfernen">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
                <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Kunde suchen (Name, Firma, E-Mail)" className={`${inputClass} w-full pl-8`} />
                {treffer.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                    {treffer.map((t) => (
                      <button key={`${t.bereich}-${t.kunde.id}`} onClick={() => waehleKunde(t)} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
                        <span className="block truncate text-sm text-slate-700">{t.kunde.ansprechpartner || t.kunde.firma}</span>
                        <span className="block truncate text-xs text-slate-400">
                          {t.kunde.firma} · {KUNDEN_BEREICHE.find((b) => b.id === t.bereich)?.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-400">Ohne Kunde bleibt die Vorlage leer und lässt sich von Hand ausfüllen.</p>
              </div>
            )}
          </div>

          {felder.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Diese Vorlage hat keine Felder zum Ausfüllen.</p>
          ) : haupt.length === 0 ? (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Die Felder dieser Vorlage stehen in Tabellen. Fülle sie rechts direkt in der Vorschau aus.</p>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-slate-500">
                Angaben ({haupt.length - offen.length} von {haupt.length} ausgefüllt)
              </p>
              {haupt.map((name) => (
                <label key={name} className="block">
                  <span className="mb-0.5 block text-xs text-slate-500">{name}</span>
                  <input value={werte[name] ?? ''} onChange={(e) => setzeFeld(name, e.target.value)} className={`${inputClass} w-full`} />
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              Vorschau · grün = ausgefüllt, gelb = noch offen · Felder und Kästchen lassen sich hier direkt bearbeiten
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton onClick={kopieren}>
                {kopiert ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Text kopieren'}
              </SecondaryButton>
              <SecondaryButton onClick={alsPdf}>
                <Download size={14} /> PDF herunterladen
              </SecondaryButton>
              <PrimaryButton onClick={inAkte} disabled={!auswahl || ablegen !== 'idle'}>
                {ablegen === 'fertig' ? <Check size={14} /> : <FolderInput size={14} />}
                {ablegen === 'laeuft' ? 'Legt ab …' : ablegen === 'fertig' ? 'In der Akte abgelegt' : 'Als PDF in die Akte'}
              </PrimaryButton>
            </div>
          </div>
          {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
          {offen.length > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
              Noch offen: {offen.slice(0, 6).join(', ')}
              {offen.length > 6 ? ` und ${offen.length - 6} weitere` : ''}. Im PDF steht dort eine Linie zum Ausfüllen von Hand.
            </p>
          )}
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700 shadow-sm">
            {bloecke.map((b, i) => {
              if (b.art === 'leer') return <div key={i} className="h-3" />
              if (b.art === 'titel') return <h3 key={i} className="mb-2 text-lg font-semibold text-slate-800">{zeigeTeile(b.teile)}</h3>
              if (b.art === 'ueberschrift') return <h4 key={i} className="mb-1 mt-3 font-semibold text-slate-800">{zeigeTeile(b.teile)}</h4>
              if (b.art === 'zeile') return <p key={i} style={b.einzug ? { paddingLeft: `${Math.min(b.einzug, 12) * 0.45}rem` } : undefined}>{zeigeTeile(b.teile)}</p>
              return (
                <div key={i} className="my-2 overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {b.zeilen.map((zeile, z) => (
                        <tr key={z} className={z === 0 && hatKopfzeile(b.zeilen) ? 'bg-slate-50 font-medium' : ''}>
                          {zeile.map((zelle, s) => (
                            <td key={s} className="border border-slate-200 px-2 py-1 align-top">
                              {zeigeTeile(zelle)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
