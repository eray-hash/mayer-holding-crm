// „Zum Unterschreiben verschickt“ in der Akte (Online-Unterschrift, 22.11.2026): Stand jeder Anfrage, Link kopieren,
// zurückziehen, Nachweis ansehen und das unterschriebene PDF öffnen. Verschickt wird beim Ausfüllen einer Vorlage
// („Zum Unterschreiben schicken“, UnterschriftAnfordern.tsx). Dazu der Schalter der Geschäftsführung für die
// automatische Kopie an den Kunden.
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, FileText, PenLine, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { erzeugeKundenDownloadUrl } from '../lib/kundenDokumenteStorage'
import {
  ladeKopieSchalter, ladeUnterschriftAnfragen, ladeUnterschriftNachweis, setzeKopieSchalter, unterschriftLink, wirklicherStatus, zieheUnterschriftZurueck,
  type UnterschriftAnfrage, type UnterschriftNachweis,
} from '../lib/unterschrift'
import { STATUS_TEXT, zeitDe, type UnterschriftStatus } from '../../supabase/functions/_shared/unterschriftKern.ts'
import { Modal } from './ui'
import type { Kunde, KundeBereich } from '../types'

const FARBE: Record<UnterschriftStatus, string> = {
  offen: 'bg-amber-50 text-amber-700',
  unterschrieben: 'bg-emerald-50 text-emerald-700',
  abgelehnt: 'bg-rose-50 text-rose-700',
  abgelaufen: 'bg-slate-100 text-slate-500',
  zurueckgezogen: 'bg-slate-100 text-slate-500',
}

const datum = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–')

// `bereich` wie bei KundenberichtModal (einheitlicher Aufruf auf allen Aktenseiten); die Anfragen hängen an der Akte.
export function UnterschriftAnfragen({ kunde, nutzerName, nurLesen = false }: { bereich: KundeBereich; kunde: Kunde; nutzerName: string; nurLesen?: boolean }) {
  const { mitarbeiter, istSuperuser, ansichtAls } = useAuth()
  const darfSchalter = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || istSuperuser)
  const [liste, setListe] = useState<UnterschriftAnfrage[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [kopiert, setKopiert] = useState('')
  const [nachweis, setNachweis] = useState<{ a: UnterschriftAnfrage; n: UnterschriftNachweis } | null>(null)
  const [schalter, setSchalter] = useState<{ aktiv: boolean } | null>(null)

  const laden = useCallback(() => {
    setFehler('')
    ladeUnterschriftAnfragen(kunde.id)
      .then(setListe)
      .catch((e) => {
        setFehler(e instanceof Error ? e.message : String(e))
        setListe([])
      })
  }, [kunde.id])

  useEffect(() => {
    laden()
    ladeKopieSchalter().then(setSchalter).catch(() => setSchalter(null))
  }, [laden])

  // Die Liste neu laden, wenn sich die Akte ändert (z. B. Verlauf-Eintrag nach einer Unterschrift kommt per Abgleich herein).
  const letzte = kunde.activities?.[0]?.id
  useEffect(() => {
    if (liste) laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letzte])

  async function kopiere(a: UnterschriftAnfrage) {
    const link = unterschriftLink(a.token)
    try {
      await navigator.clipboard.writeText(link)
      setKopiert(a.id)
      window.setTimeout(() => setKopiert(''), 2000)
    } catch {
      window.prompt('Link kopieren:', link)
    }
  }

  async function zurueck(a: UnterschriftAnfrage) {
    if (!window.confirm(`„${a.titel}“ zurückziehen? Der Link funktioniert danach nicht mehr.`)) return
    try {
      await zieheUnterschriftZurueck(a.id, nutzerName)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
    laden()
  }

  async function oeffnePdf(a: UnterschriftAnfrage) {
    if (!a.dokument) return
    const fenster = window.open('', '_blank')
    try {
      const url = await erzeugeKundenDownloadUrl(a.dokument)
      if (fenster) fenster.location.href = url
      else window.location.href = url
    } catch (e) {
      fenster?.close()
      setFehler(e instanceof Error ? e.message : 'Das PDF lässt sich gerade nicht öffnen.')
    }
  }

  async function zeigeNachweis(a: UnterschriftAnfrage) {
    try {
      setNachweis({ a, n: await ladeUnterschriftNachweis(a.id) })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }

  async function schalte(aktiv: boolean) {
    setFehler('')
    try {
      await setzeKopieSchalter(aktiv, nutzerName)
      setSchalter(await ladeKopieSchalter())
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><PenLine size={14} /> Zum Unterschreiben verschickt</h3>
        <button type="button" onClick={laden} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Neu laden" title="Neu laden">
          <RefreshCw size={13} />
        </button>
      </div>
      {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-600">{fehler}</p>}
      {liste === null ? (
        <p className="text-xs text-slate-400">Lädt …</p>
      ) : liste.length === 0 ? (
        <p className="text-xs text-slate-400">Noch nichts verschickt. So geht’s: unter Vorlagen einen Vertrag oder eine Vollmacht für diese Akte ausfüllen → „Zum Unterschreiben schicken“.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {liste.map((a) => {
            const st = wirklicherStatus(a)
            return (
              <li key={a.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium text-slate-700">{a.titel}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${FARBE[st]}`}>{STATUS_TEXT[st]}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {datum(a.erstelltAm)}{a.erstelltVon ? ` von ${a.erstelltVon}` : ''}{a.email ? ` an ${a.email}` : ' · nur Link'}
                  {st === 'offen' && ` · gültig bis ${datum(a.gueltigBis)} · ${a.zugriffe ? `${a.zugriffe}× geöffnet` : 'noch nicht geöffnet'}`}
                  {st === 'unterschrieben' && a.unterschriebenAm && ` · unterschrieben ${zeitDe(a.unterschriebenAm)} als „${a.nameGetippt ?? ''}“`}
                  {st === 'abgelehnt' && ` · abgelehnt ${datum(a.abgelehntAm)}${a.ablehnungGrund ? `: „${a.ablehnungGrund}“` : ''}`}
                  {st === 'zurueckgezogen' && ` · zurückgezogen ${datum(a.zurueckgezogenAm)}${a.zurueckgezogenVon ? ` von ${a.zurueckgezogenVon}` : ''}`}
                </p>
                <div className="mt-1 flex flex-wrap gap-3 text-xs">
                  {st === 'offen' && (
                    <button onClick={() => kopiere(a)} className="inline-flex items-center gap-1 text-slate-600 hover:underline">
                      {kopiert === a.id ? <Check size={12} /> : <Copy size={12} />} Link kopieren
                    </button>
                  )}
                  {st === 'offen' && !nurLesen && <button onClick={() => zurueck(a)} className="text-rose-600 hover:underline">Zurückziehen</button>}
                  {st === 'unterschrieben' && a.dokument && (
                    <button onClick={() => oeffnePdf(a)} className="inline-flex items-center gap-1 text-slate-600 hover:underline"><FileText size={12} /> PDF öffnen</button>
                  )}
                  {st === 'unterschrieben' && !a.dokument && <span className="text-amber-700">PDF fehlt in der Akte — Unterschrift ist gespeichert</span>}
                  {st === 'unterschrieben' && <button onClick={() => zeigeNachweis(a)} className="text-slate-600 hover:underline">Nachweis</button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {schalter && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Kopie des unterschriebenen PDF automatisch an den Kunden: {schalter.aktiv ? <span className="font-medium text-emerald-700">ein</span> : <span className="font-medium text-slate-600">aus</span>}
          {darfSchalter && (
            <button type="button" onClick={() => schalte(!schalter.aktiv)} className="font-medium text-accent-600 hover:underline">
              {schalter.aktiv ? 'ausschalten' : 'einschalten'}
            </button>
          )}
          {!darfSchalter && !schalter.aktiv && <span>(einschalten kann die Geschäftsführung; der Kunde kann seine Kopie aber nach dem Unterschreiben selbst herunterladen)</span>}
        </p>
      )}

      {nachweis && (
        <Modal open onClose={() => setNachweis(null)} title={`Nachweis: ${nachweis.a.titel}`} width="max-w-2xl">
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Elektronisch unterschrieben am {nachweis.n.unterschriebenAm ? zeitDe(nachweis.n.unterschriebenAm) : '–'} als „{nachweis.n.nameGetippt ?? ''}“.
            </p>
            {nachweis.n.unterschrift && <img src={nachweis.n.unterschrift} alt="Unterschrift" className="h-20 w-auto rounded border border-slate-200 bg-white p-1" />}
            <p className="text-xs text-slate-500">
              IP-Adresse: {nachweis.n.ip || '–'} · Gerät: {nachweis.n.geraet || '–'}
              {nachweis.a.email ? ` · Link ging an ${nachweis.a.email}` : ''}
            </p>
            {nachweis.n.kundenWerte && Object.keys(nachweis.n.kundenWerte).length > 0 && (
              <div className="text-xs">
                <p className="font-medium text-slate-600">Angaben des Kunden:</p>
                <ul className="mt-1 list-inside list-disc text-slate-600">
                  {Object.entries(nachweis.n.kundenWerte).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
                </ul>
              </div>
            )}
            <p className="break-all text-xs text-slate-400">Prüfsumme des Texts (SHA-256): {nachweis.n.pruefsumme ?? '–'} · Vorgang {nachweis.a.id}</p>
            {nachweis.n.endgueltigerText && (
              <details className="rounded border border-slate-200 p-2">
                <summary className="cursor-pointer text-sm font-medium">Unterschriebener Wortlaut</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-600">{nachweis.n.endgueltigerText.replace(/\*\*/g, '')}</pre>
              </details>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
