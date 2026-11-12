import { useEffect, useState } from 'react'
import { Loader2, Save, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Card, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from './ui'
import { fmtEUR, today } from '../lib/dates'
import { supabase } from '../lib/supabaseClient'
import { starteBewertungRecherche, setzeBewertungRechercheFort } from '../lib/emailGateway'
import type { KundeBereich, Unternehmensbewertung } from '../types'

function leererEntwurf(): Unternehmensbewertung {
  return {
    jahresumsatz: undefined,
    ebit: undefined,
    ebitda: undefined,
    substanzwert: undefined,
    nachhaltigerJahresueberschuss: undefined,
    branchenmultiplikator: 5,
    kapitalisierungszinsProzent: 10,
    notizen: '',
    erstelltAm: today(),
  }
}

// Echte Unternehmensbewertung (Kaufpreis-Schätzung), keine bloße KI-Einschätzung — Nutzer-
// Entscheidung 2026-11-06. Kombiniert die drei gängigen Praxis-Verfahren und zeigt eine Spanne,
// da jede Bewertung eine Schätzung mit Ermessensspielraum bleibt. Live berechnet aus den
// eingegebenen Werten, nichts wird fest vorgerechnet gespeichert.
function berechneErgebnisse(b: Unternehmensbewertung) {
  const ergebnisse: { verfahren: string; wert: number; basis: string }[] = []
  if (b.ebit !== undefined && b.branchenmultiplikator) {
    ergebnisse.push({ verfahren: 'Multiplikatorverfahren', wert: b.ebit * b.branchenmultiplikator, basis: `EBIT ${fmtEUR(b.ebit)} × Faktor ${b.branchenmultiplikator}` })
  }
  if (b.nachhaltigerJahresueberschuss !== undefined && b.kapitalisierungszinsProzent) {
    ergebnisse.push({
      verfahren: 'Ertragswertverfahren',
      wert: b.nachhaltigerJahresueberschuss / (b.kapitalisierungszinsProzent / 100),
      basis: `Nachhaltiger Jahresüberschuss ${fmtEUR(b.nachhaltigerJahresueberschuss)} / ${b.kapitalisierungszinsProzent}%`,
    })
  }
  if (b.substanzwert !== undefined) {
    ergebnisse.push({ verfahren: 'Substanzwertverfahren (Wertuntergrenze)', wert: b.substanzwert, basis: 'Nettovermögen laut Eingabe' })
  }
  return ergebnisse
}

export function UnternehmensbewertungSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const [entwurf, setEntwurf] = useState<Unternehmensbewertung>(kunde?.unternehmensbewertung ?? leererEntwurf())
  const [bearbeiten, setBearbeiten] = useState(!kunde?.unternehmensbewertung)
  const [kostenModal, setKostenModal] = useState(false)
  const [anlass, setAnlass] = useState('Nachfolge')
  const [stichtag, setStichtag] = useState(today())
  const [rechercheWirdGestartet, setRechercheWirdGestartet] = useState(false)
  const [rechercheFehler, setRechercheFehler] = useState('')

  const recherche = kunde?.unternehmensbewertungRecherche

  // Tickt, solange eine Recherche läuft, damit "läuft seit …" und die Hänger-Erkennung aktuell bleiben.
  const [jetzt, setJetzt] = useState(Date.now())
  useEffect(() => {
    if (recherche?.status !== 'laeuft') return
    const t = setInterval(() => setJetzt(Date.now()), 10000)
    return () => clearInterval(t)
  }, [recherche?.status])
  const letzterFortschritt = recherche ? new Date(recherche.aktualisiertAm ?? recherche.gestartetAm).getTime() : 0
  // Ein Schritt dauert höchstens gut zwei Minuten, plus Wartezeit auf einen frischen Server-Prozess.
  // Rührt sich fünf Minuten nichts, ist die Recherche abgebrochen und kommt von selbst nicht zurück.
  const haengt = recherche?.status === 'laeuft' && jetzt - letzterFortschritt > 5 * 60 * 1000
  const laeuftSeitMin = recherche ? Math.max(0, Math.round((jetzt - new Date(recherche.gestartetAm).getTime()) / 60000)) : 0

  // Pollt den Recherche-Status, während die Edge Function im Hintergrund weiterläuft (siehe
  // email-gateway "bewertung_recherche_start") — kein Realtime im Projekt vorhanden, daher einfaches
  // Intervall statt einer Subscription. Stoppt automatisch, sobald der Status nicht mehr "laeuft" ist.
  useEffect(() => {
    const client = supabase
    if (!client || recherche?.status !== 'laeuft') return
    const intervall = setInterval(async () => {
      const { data } = await client
        .from('kunden')
        .select('unternehmensbewertung_recherche')
        .eq('id', kundeId)
        .eq('bereich', bereich)
        .maybeSingle()
      const frisch = data?.unternehmensbewertung_recherche
      if (frisch && JSON.stringify(frisch) !== JSON.stringify(recherche)) {
        dispatch({ type: 'KUNDE_VOM_SERVER', bereich, id: kundeId, patch: { unternehmensbewertungRecherche: frisch } })
      }
    }, 5000)
    return () => clearInterval(intervall)
  }, [recherche, bereich, kundeId, dispatch])

  if (!kunde) return null

  function speichern() {
    dispatch({ type: 'SET_UNTERNEHMENSBEWERTUNG', bereich, kundeId, bewertung: { ...entwurf, erstelltAm: today() } })
    setBearbeiten(false)
  }

  async function rechercheStarten() {
    setKostenModal(false)
    setRechercheWirdGestartet(true)
    setRechercheFehler('')
    try {
      const vorhandeneZahlen: Record<string, number> = {}
      if (entwurf.ebit !== undefined) vorhandeneZahlen.ebit = entwurf.ebit
      if (entwurf.substanzwert !== undefined) vorhandeneZahlen.substanzwert = entwurf.substanzwert
      if (entwurf.nachhaltigerJahresueberschuss !== undefined) vorhandeneZahlen.nachhaltigerJahresueberschuss = entwurf.nachhaltigerJahresueberschuss
      await starteBewertungRecherche({
        bereich,
        kundeId,
        firma: kunde!.firma,
        webseite: entwurf.webseite ?? '',
        anlass,
        stichtag,
        vorhandeneZahlen,
      })
      dispatch({
        type: 'KUNDE_VOM_SERVER',
        bereich,
        id: kundeId,
        patch: { unternehmensbewertungRecherche: { status: 'laeuft', schritt: 'Wird gestartet …', anlass, stichtag, gestartetAm: new Date().toISOString() } },
      })
    } catch (err) {
      setRechercheFehler(err instanceof Error ? err.message : 'KI-Recherche konnte nicht gestartet werden.')
    } finally {
      setRechercheWirdGestartet(false)
    }
  }

  async function rechercheFortsetzen() {
    setRechercheFehler('')
    try {
      await setzeBewertungRechercheFort({ bereich, kundeId })
      setJetzt(Date.now())
    } catch (err) {
      setRechercheFehler(err instanceof Error ? err.message : 'Die Recherche konnte nicht fortgesetzt werden.')
    }
  }

  function werteUebernehmen() {
    if (!recherche?.abgeleiteteZahlen) return
    const z = recherche.abgeleiteteZahlen
    setEntwurf((x) => ({
      ...x,
      ebit: z.ebit ?? x.ebit,
      substanzwert: z.substanzwert ?? x.substanzwert,
      nachhaltigerJahresueberschuss: z.nachhaltigerJahresueberschuss ?? x.nachhaltigerJahresueberschuss,
      branchenmultiplikator: z.branchenmultiplikator ?? x.branchenmultiplikator,
      kapitalisierungszinsProzent: z.kapitalisierungszinsProzent ?? x.kapitalisierungszinsProzent,
    }))
    setBearbeiten(true)
  }

  const ergebnisse = berechneErgebnisse(bearbeiten ? entwurf : kunde.unternehmensbewertung ?? entwurf)
  const werte = ergebnisse.map((e) => e.wert)
  const min = werte.length > 0 ? Math.min(...werte) : undefined
  const max = werte.length > 0 ? Math.max(...werte) : undefined
  const mittel = werte.length > 0 ? werte.reduce((a, b) => a + b, 0) / werte.length : undefined

  return (
    <div className="space-y-4">
      {!bearbeiten && kunde.unternehmensbewertung ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Unternehmensbewertung</h4>
            <button onClick={() => setBearbeiten(true)} className="text-xs font-medium text-accent-600 hover:underline">Bearbeiten</button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-400">Jahresumsatz</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.jahresumsatz !== undefined ? fmtEUR(kunde.unternehmensbewertung.jahresumsatz) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">EBIT</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.ebit !== undefined ? fmtEUR(kunde.unternehmensbewertung.ebit) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">EBITDA</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.ebitda !== undefined ? fmtEUR(kunde.unternehmensbewertung.ebitda) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Substanzwert</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.substanzwert !== undefined ? fmtEUR(kunde.unternehmensbewertung.substanzwert) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Nachhaltiger Jahresüberschuss</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.nachhaltigerJahresueberschuss !== undefined ? fmtEUR(kunde.unternehmensbewertung.nachhaltigerJahresueberschuss) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Branchenmultiplikator</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.branchenmultiplikator}×</dd></div>
            <div><dt className="text-xs text-slate-400">Kapitalisierungszins</dt><dd className="text-slate-700">{kunde.unternehmensbewertung.kapitalisierungszinsProzent}%</dd></div>
          </dl>
          {kunde.unternehmensbewertung.notizen && <p className="mt-2 text-sm text-slate-600">{kunde.unternehmensbewertung.notizen}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Unternehmensbewertung erfassen</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Jahresumsatz (€)">
              <input type="number" className={inputClass} value={entwurf.jahresumsatz ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, jahresumsatz: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="EBIT (€)">
              <input type="number" className={inputClass} value={entwurf.ebit ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, ebit: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="EBITDA (€)">
              <input type="number" className={inputClass} value={entwurf.ebitda ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, ebitda: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Substanzwert / Nettovermögen (€)">
              <input type="number" className={inputClass} value={entwurf.substanzwert ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, substanzwert: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Nachhaltiger Jahresüberschuss (€)">
              <input type="number" className={inputClass} value={entwurf.nachhaltigerJahresueberschuss ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, nachhaltigerJahresueberschuss: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Branchenmultiplikator (× EBIT)">
              <input type="number" step="0.1" className={inputClass} value={entwurf.branchenmultiplikator} onChange={(e) => setEntwurf((x) => ({ ...x, branchenmultiplikator: Number(e.target.value) || 0 }))} />
            </Field>
            <Field label="Kapitalisierungszins (%)">
              <input type="number" step="0.5" className={inputClass} value={entwurf.kapitalisierungszinsProzent} onChange={(e) => setEntwurf((x) => ({ ...x, kapitalisierungszinsProzent: Number(e.target.value) || 0 }))} />
            </Field>
            <Field label="Webseite der Firma (für KI-Recherche)">
              <input type="text" placeholder="z. B. www.firma.de" className={inputClass} value={entwurf.webseite ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, webseite: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notizen">
            <textarea className={inputClass} rows={2} value={entwurf.notizen} onChange={(e) => setEntwurf((x) => ({ ...x, notizen: e.target.value }))} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            {kunde.unternehmensbewertung && <button onClick={() => setBearbeiten(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>}
            <PrimaryButton onClick={speichern}><Save size={14} /> Speichern</PrimaryButton>
          </div>
        </Card>
      )}

      {ergebnisse.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Ergebnis (Schätzung, keine exakte Zahl)</h4>
          <div className="mb-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-400">Minimum</div>
              <div className="text-sm font-semibold text-slate-700">{min !== undefined ? fmtEUR(min) : '—'}</div>
            </div>
            <div className="rounded-lg bg-accent-50 p-3">
              <div className="text-xs text-accent-600">Mittelwert</div>
              <div className="text-base font-semibold text-accent-700">{mittel !== undefined ? fmtEUR(mittel) : '—'}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-400">Maximum</div>
              <div className="text-sm font-semibold text-slate-700">{max !== undefined ? fmtEUR(max) : '—'}</div>
            </div>
          </div>
          <ul className="space-y-1.5 text-sm">
            {ergebnisse.map((e) => (
              <li key={e.verfahren} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                <span className="text-slate-500">{e.verfahren} <span className="text-xs text-slate-400">({e.basis})</span></span>
                <span className="font-medium text-slate-700">{fmtEUR(e.wert)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Sparkles size={14} className="text-accent-600" /> KI-Recherche</h4>
        </div>
        {rechercheFehler && <p className="mb-2 text-sm text-rose-600">{rechercheFehler}</p>}

        {(!recherche || recherche.status === 'fertig' || recherche.status === 'fehler' || haengt) && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Anlass">
              <select className={inputClass} value={anlass} onChange={(e) => setAnlass(e.target.value)}>
                <option>Nachfolge</option>
                <option>Kauf</option>
                <option>Beteiligung</option>
              </select>
            </Field>
            <Field label="Stichtag">
              <input type="date" className={inputClass} value={stichtag} onChange={(e) => setStichtag(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <SecondaryButton onClick={() => setKostenModal(true)} disabled={!entwurf.webseite || rechercheWirdGestartet} className="w-full justify-center">
                {rechercheWirdGestartet ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {haengt ? 'Von vorn starten' : recherche?.status === 'fertig' ? 'Erneut recherchieren' : recherche?.status === 'fehler' ? 'Erneut versuchen' : 'KI-Recherche starten'}
              </SecondaryButton>
            </div>
            {!entwurf.webseite && <p className="sm:col-span-3 text-xs text-slate-400">Webseite der Firma oben im Bearbeiten-Modus hinterlegen, um die Recherche zu starten.</p>}
          </div>
        )}

        {recherche?.status === 'laeuft' && !haengt && (
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 size={16} className="animate-spin text-accent-600" />
              {recherche.schrittNr ? `Schritt ${recherche.schrittNr} von 4: ` : ''}
              {recherche.schritt ?? 'Recherche läuft …'}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Läuft seit {laeuftSeitMin < 1 ? 'weniger als einer Minute' : `${laeuftSeitMin} Min.`} — üblich sind 3 bis 6 Minuten. Du kannst die Seite verlassen, die Recherche läuft auf dem Server weiter.
            </p>
          </div>
        )}

        {haengt && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <p>
              Die Recherche ist hängen geblieben: seit {Math.round((jetzt - letzterFortschritt) / 60000)} Minuten kein Fortschritt
              {recherche?.schritt ? ` (zuletzt: ${recherche.schritt})` : ''}.
            </p>
            {recherche?.schrittNr ? (
              <button onClick={rechercheFortsetzen} className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
                Ab Schritt {recherche.schrittNr} fortsetzen
              </button>
            ) : (
              <p className="mt-1 text-xs">Dieser Lauf lässt sich nicht fortsetzen — bitte oben von vorn starten.</p>
            )}
          </div>
        )}

        {recherche?.status === 'fehler' && recherche.fehler && (
          <p className="mt-2 text-sm text-rose-600">Fehler: {recherche.fehler}</p>
        )}

        {recherche?.status === 'fertig' && recherche.bericht && (
          <div className="mt-3 space-y-3">
            {recherche.abgeleiteteZahlen && (
              <SecondaryButton onClick={werteUebernehmen}><Save size={14} /> Vorgeschlagene Werte in den Rechner übernehmen</SecondaryButton>
            )}
            <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{recherche.bericht}</div>
          </div>
        )}
      </Card>

      <Modal open={kostenModal} onClose={() => setKostenModal(false)} title="KI-Recherche starten">
        <p className="mb-4 text-sm text-slate-600">
          Dies startet eine mehrstufige KI-Recherche (Firmenidentifikation, 5 Recherche-Agents, Prüfung,
          Bewertung) mit echter Websuche. Geschätzte Kosten: <strong>ca. 0,50–1,50 € pro Durchlauf</strong> (echtes
          Anthropic-API-Guthaben). Dauer: mehrere Minuten. Fortfahren?
        </p>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={() => setKostenModal(false)}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={rechercheStarten}>Jetzt starten</PrimaryButton>
        </div>
      </Modal>
    </div>
  )
}
