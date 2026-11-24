// Dialog beim Setzen des Status „verloren“ (Entgangene Klienten, 24.11.2026): Grund (Pflicht), Notiz,
// entgangener Betrag (vorbelegt aus der Chance der Akte). „Grund vorschlagen“ lässt die KI Verlauf und
// Protokolle der Akte lesen (email-gateway, Aktion entgangen_grund_vorschlag) — übernommen wird nur, was
// der Mitarbeiter mit „Als entgangen speichern“ bestätigt.
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import type { Kunde, KundeBereich } from '../types'
import { useApp } from '../context/AppContext'
import { useKvNutzer } from './KostenvoranschlaegeSection'
import { NUR_LESEN_MELDUNG } from '../lib/nurLesen'
import { ENTGANGEN_GRUENDE, type EntgangenGrund, holeGrundVorschlag, markiereEntgangen, statusLabelFuer, wertAusChance } from '../lib/entgangen'
import { isEmailGatewayConfigured } from '../lib/emailGateway'

function zahl(text: string): number | undefined {
  const t = text.replace(/€/g, '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

export function VerlorenDialog({
  open,
  bereich,
  kunde,
  onClose,
  onGespeichert,
}: {
  open: boolean
  bereich: KundeBereich
  kunde: Kunde
  onClose: () => void
  onGespeichert?: () => void
}) {
  const { dispatch } = useApp()
  const nutzer = useKvNutzer()
  const [grund, setGrund] = useState<EntgangenGrund | ''>('')
  const [notiz, setNotiz] = useState('')
  const [betrag, setBetrag] = useState('')
  const [laedt, setLaedt] = useState(false)
  const [hinweis, setHinweis] = useState('')
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!open) return
    const wert = wertAusChance(kunde.auftragChance)
    setGrund('')
    setNotiz('')
    setBetrag(wert ? String(wert).replace('.', ',') : '')
    setHinweis('')
    setFehler('')
    // Nur beim Öffnen vorbelegen, nicht bei jeder Änderung der Akte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kunde.id])

  async function vorschlagen() {
    setLaedt(true)
    setFehler('')
    setHinweis('')
    try {
      const v = await holeGrundVorschlag(kunde.id)
      setGrund(v.grund)
      if (v.satz && !notiz.trim()) setNotiz(v.satz)
      setHinweis('Vorschlag aus Verlauf und Protokollen — bitte prüfen.')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Vorschlag ließ sich nicht holen.')
    } finally {
      setLaedt(false)
    }
  }

  function speichern() {
    if (nutzer.nurLesen) return setFehler(NUR_LESEN_MELDUNG)
    if (!grund) return setFehler('Bitte einen Grund auswählen.')
    if (betrag.trim() && zahl(betrag) === undefined) return setFehler('Den Betrag bitte als Zahl angeben, z. B. 2.500 — oder leer lassen.')
    markiereEntgangen(dispatch, bereich, kunde, { grund, notiz, wertNetto: zahl(betrag) }, nutzer.name)
    onGespeichert?.()
    onClose()
  }

  const name = kunde.firma || kunde.ansprechpartner || 'Akte'
  return (
    <Modal open={open} onClose={onClose} title={`${name} als entgangen markieren`}>
      <p className="mb-3 text-sm text-slate-600">
        Die Akte geht auf „{statusLabelFuer(bereich, kunde, 'verloren')}“. Bisheriger Stand: {statusLabelFuer(bereich, kunde, kunde.status)}.
        Der Grund erscheint auf der Seite „Entgangene Klienten“.
      </p>
      <Field label="Grund (Pflicht)">
        <select className={inputClass} value={grund} onChange={(e) => setGrund(e.target.value as EntgangenGrund | '')}>
          <option value="">— bitte wählen —</option>
          {ENTGANGEN_GRUENDE.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
      </Field>
      {isEmailGatewayConfigured && (
        <div className="-mt-1 mb-3">
          <button
            type="button"
            onClick={() => void vorschlagen()}
            disabled={laedt}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50"
          >
            <Sparkles size={13} /> {laedt ? 'Lese Verlauf und Protokolle …' : 'Grund vorschlagen'}
          </button>
          {hinweis && <span className="ml-2 text-xs text-slate-500">{hinweis}</span>}
        </div>
      )}
      <Field label="Notiz (was ist passiert?)">
        <textarea className={inputClass} rows={3} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Hat nach dem Angebot nicht mehr geantwortet." />
      </Field>
      <Field label="Entgangener Betrag netto in € (vorbelegt aus der Chance, leer = unbekannt)">
        <input className={inputClass} inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="z. B. 2.500" />
      </Field>
      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={speichern} disabled={!grund}>Als entgangen speichern</PrimaryButton>
      </div>
    </Modal>
  )
}
