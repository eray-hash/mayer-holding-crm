import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Clock, Printer, Trash2, UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { druckeBlatt } from '../lib/blattDruck'
import { fmtDate, fmtDateTime, fmtEUR, fmtEURCent, today } from '../lib/dates'
import { MITARBEITER } from '../data/constants'
import type { Objekt, ObjektAbrechnung } from '../types'

// ── Zahlen lesen und schreiben ───────────────────────────────────────────────────────────────────

const runde2 = (n: number) => Math.round(n * 100) / 100

/** Liest die erste Zahl aus freiem Text in deutscher Schreibweise ("25.000", "25 000 €", "3,57", "1.250.000,50").
 *  Komma = Dezimaltrenner; Punkte sind Tausenderpunkte, wenn danach immer genau drei Ziffern stehen, sonst
 *  Dezimalpunkt. Bei Prozentangaben (punktIstKomma) ist ein einzelner Punkt immer der Dezimaltrenner.
 *  `rest` ist der Text hinter der Zahl (für Zusätze wie "Tsd."). Nichts Lesbares → null. */
function leseZahl(text: string, punktIstKomma = false): { wert: number; rest: string } | null {
  // "25 000" oder "25'000": Leerzeichen/Hochkomma als Tausendertrenner entfernen (nur vor genau drei Ziffern).
  const glatt = text.replace(/(\d)[\s '’](?=\d{3}(?!\d))/g, '$1')
  const treffer = /\d[\d.,]*/.exec(glatt)
  if (!treffer) return null
  const roh = treffer[0].replace(/[.,]+$/, '')
  const rest = glatt.slice(treffer.index + treffer[0].length)
  const kommas = roh.split(',').length - 1
  const punkte = roh.split('.').length - 1
  let norm: string
  if (kommas > 0 && punkte > 0) {
    // Beide Zeichen: das hintere ist der Dezimaltrenner, das andere trennt Tausender.
    norm = roh.lastIndexOf(',') > roh.lastIndexOf('.') ? roh.replace(/\./g, '').replace(',', '.') : roh.replace(/,/g, '')
  } else if (kommas === 1) {
    norm = roh.replace(',', '.')
  } else if (kommas > 1) {
    norm = roh.replace(/,/g, '')
  } else if (punkte > 0) {
    const tausender = !punktIstKomma && /^\d{1,3}(\.\d{3})+$/.test(roh)
    norm = tausender ? roh.replace(/\./g, '') : punkte === 1 ? roh : ''
  } else {
    norm = roh
  }
  const wert = Number(norm)
  if (norm === '' || !Number.isFinite(wert)) return null
  return { wert, rest }
}

/** Eingabefeld → Zahl. Leer = undefined (nichts eingetragen), Unlesbares = NaN. */
function eingabeZahl(text: string, punktIstKomma = false): number | undefined {
  const t = text.trim().replace(/\s*(€|%|eur|euro)$/i, '').trim()
  if (!t) return undefined
  if (!/^\d[\d.,\s '’]*$/.test(t)) return NaN
  const z = leseZahl(t, punktIstKomma)
  return z && z.rest.trim() === '' ? z.wert : NaN
}

const gueltig = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n)

/** Zahl → Text fürs Eingabefeld: 25000 → "25.000", 85.5 → "85,5". */
function zahlText(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

/** Glatte Beträge ohne Cent, alle anderen mit. */
function geld(n: number): string {
  const r = runde2(n) || 0
  return Number.isInteger(r) ? fmtEUR(r) : fmtEURCent(r)
}

function prozent(n: number): string {
  return `${(Math.round(n * 10) / 10 || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`
}

/** 150 → "2 Std. 30 Min." */
function fmtDauer(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} Min.`
  if (m === 0) return `${h} Std.`
  return `${h} Std. ${m} Min.`
}

/** 150 → "2,50" (Stunden als Dezimalzahl). */
function fmtStunden(min: number): string {
  return (min / 60).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Vorschlag für die Provision aus der Kurzprüfung ──────────────────────────────────────────────

type Vorschlag = { betrag: number; herkunft: string }

/** Erst der Betrag aus der Kurzprüfung, sonst Kaufpreis × Prozentsatz aus der Kurzprüfung. */
function provisionsVorschlag(o: Objekt): Vorschlag | null {
  const kp = o.kurzpruefung
  if (!kp) return null
  const betragText = String(kp.provisionBetrag ?? '').trim()
  // Steht im Betragsfeld ein Prozentwert, ist es kein Euro-Betrag.
  if (betragText && !betragText.includes('%')) {
    const z = leseZahl(betragText)
    if (z) {
      const faktor = /^\s*(mio\b|mio\.|million)/i.test(z.rest) ? 1_000_000 : /^\s*(tsd\b|tsd\.|t€|k\b)/i.test(z.rest) ? 1000 : 1
      const betrag = runde2(z.wert * faktor)
      if (betrag > 0) return { betrag, herkunft: `Betrag aus der Kurzprüfung (dort steht „${betragText}“)` }
    }
  }
  const prozentText = String(kp.provisionProzent ?? '').trim()
  const p = prozentText ? leseZahl(prozentText, true) : null
  const kaufpreis = Number(o.kaufpreis) || 0
  if (p && p.wert > 0 && p.wert <= 100 && kaufpreis > 0) {
    return {
      betrag: runde2((kaufpreis * p.wert) / 100),
      herkunft: `${p.wert.toLocaleString('de-DE', { maximumFractionDigits: 4 })} % aus der Kurzprüfung vom Kaufpreis ${geld(kaufpreis)}`,
    }
  }
  return null
}

// ── Entwurf (Eingabefelder als Text) ─────────────────────────────────────────────────────────────

type Entwurf = {
  provision: string
  saetze: Record<string, string>
  anteile: Record<string, string>
  /** Von Hand hinzugefügte Personen (ohne Zeiteinträge) und solche mit gespeichertem Satz oder Anteil. */
  personen: string[]
  notiz: string
}

type Inhalt = Pick<ObjektAbrechnung, 'provision' | 'stundensaetze' | 'anteile' | 'notiz'>

const LEER: Inhalt = { stundensaetze: {}, anteile: {}, notiz: '' }

function entwurfAus(gespeicherte: ObjektAbrechnung | undefined, objekt: Objekt): Entwurf {
  if (!gespeicherte) {
    // Noch nie gespeichert: Provision einmalig aus der Kurzprüfung vorschlagen.
    const v = provisionsVorschlag(objekt)
    return { provision: v ? zahlText(v.betrag) : '', saetze: {}, anteile: {}, personen: [], notiz: '' }
  }
  const alsText = (r: Record<string, number> | undefined) =>
    Object.fromEntries(Object.entries(r ?? {}).filter(([, w]) => Number.isFinite(w)).map(([name, w]) => [name, zahlText(w)]))
  const saetze = alsText(gespeicherte.stundensaetze)
  const anteile = alsText(gespeicherte.anteile)
  return {
    provision: typeof gespeicherte.provision === 'number' && Number.isFinite(gespeicherte.provision) ? zahlText(gespeicherte.provision) : '',
    saetze,
    anteile,
    personen: [...new Set([...Object.keys(saetze), ...Object.keys(anteile)])],
    notiz: gespeicherte.notiz ?? '',
  }
}

/** Vergleichbare Kurzform einer Abrechnung (ohne Zeitstempel, Reihenfolge der Namen egal). */
function kern(a: Inhalt): string {
  const sortiert = (r: Record<string, number> | undefined) =>
    Object.entries(r ?? {})
      .map(([name, w]) => [name, runde2(w)] as const)
      .sort(([x], [y]) => x.localeCompare(y))
  return JSON.stringify([typeof a.provision === 'number' ? runde2(a.provision) : null, sortiert(a.stundensaetze), sortiert(a.anteile), a.notiz ?? ''])
}

// ── Rechnung ─────────────────────────────────────────────────────────────────────────────────────

type Zeile = {
  name: string
  min: number
  anzahl: number
  erster: string
  letzter: string
  /** Stundensatz: undefined = leer, NaN = unlesbar. */
  satz: number | undefined
  /** Fester Anteil in Prozent: undefined = nach Zeit, NaN = unlesbar. */
  fest: number | undefined
  /** Zeitkosten in Euro; null solange kein Stundensatz eingetragen ist. */
  kosten: number | null
  /** Anteil an der gesamten erfassten Zeit in Prozent. */
  zeitanteil: number
  /** Anteil an der Provision in Prozent. */
  anteil: number
  /** Anteil an der Provision in Euro; null solange keine Provision eingetragen ist. */
  betrag: number | null
}

/** Die Abrechnung eines Objekts als Reiter: erfasste Zeit je Person, Zeitkosten über den Stundensatz,
 *  Aufteilung der Provision (nach Zeitanteil oder mit festen Anteilen) und was am Ende übrig bleibt. */
export function ObjektAbrechnungSection({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const gespeicherte = state.abrechnungen.find((a) => a.id === objekt.id)
  const stand = `${objekt.id}|${gespeicherte?.aktualisiertAm ?? ''}`

  const [entwurf, setEntwurf] = useState<Entwurf>(() => entwurfAus(gespeicherte, objekt))
  const [geladen, setGeladen] = useState({ objektId: objekt.id, stand })
  const [beruehrt, setBeruehrt] = useState(false)
  const [gespeichert, setGespeichert] = useState(false)
  const [fremdGeaendert, setFremdGeaendert] = useState(false)
  const [neuePerson, setNeuePerson] = useState('')

  // Der gespeicherte Stand hat sich geändert (Daten kamen erst nach dem Öffnen vom Server, ein Kollege hat
  // gespeichert, oder es ist ein anderes Objekt): übernehmen, solange hier noch nichts eingetippt wurde.
  // So überschreibt der Vorschlag aus der Kurzprüfung nie eine gespeicherte Provision.
  if (geladen.stand !== stand) {
    const anderesObjekt = geladen.objektId !== objekt.id
    setGeladen({ objektId: objekt.id, stand })
    if (anderesObjekt || !beruehrt) {
      setEntwurf(entwurfAus(gespeicherte, objekt))
      setBeruehrt(false)
      setFremdGeaendert(false)
      if (anderesObjekt) setGespeichert(false)
    } else {
      setFremdGeaendert(true)
    }
  }

  function setze(aenderung: Partial<Entwurf>) {
    setEntwurf((alt) => ({ ...alt, ...aenderung }))
    setBeruehrt(true)
    setGespeichert(false)
  }

  // ── Zeit je Person ──
  const jePerson = new Map<string, { min: number; anzahl: number; erster: string; letzter: string }>()
  for (const z of state.zeiteintraege) {
    if (z.objektId !== objekt.id) continue
    const name = (z.mitarbeiter ?? '').trim() || 'Ohne Namen'
    const min = Math.max(0, Math.round(Number(z.dauerMin) || 0))
    const p = jePerson.get(name) ?? { min: 0, anzahl: 0, erster: '', letzter: '' }
    p.min += min
    p.anzahl += 1
    if (z.datum && (!p.erster || z.datum < p.erster)) p.erster = z.datum
    if (z.datum && (!p.letzter || z.datum > p.letzter)) p.letzter = z.datum
    jePerson.set(name, p)
  }
  const mitZeit = [...jePerson.entries()].sort(([a, x], [b, y]) => y.min - x.min || a.localeCompare(b)).map(([name]) => name)
  const namen = [...mitZeit, ...entwurf.personen.filter((n) => !jePerson.has(n))]

  const provisionEingabe = eingabeZahl(entwurf.provision)
  const provision = gueltig(provisionEingabe) ? runde2(provisionEingabe) : undefined

  // ── Aufteilung ──
  const gesamtMin = mitZeit.reduce((s, n) => s + (jePerson.get(n)?.min ?? 0), 0)
  const grund = namen.map((name) => {
    const zeit = jePerson.get(name) ?? { min: 0, anzahl: 0, erster: '', letzter: '' }
    return { name, ...zeit, satz: eingabeZahl(entwurf.saetze[name] ?? ''), fest: eingabeZahl(entwurf.anteile[name] ?? '', true) }
  })
  const summeFest = grund.reduce((s, g) => s + (gueltig(g.fest) ? g.fest : 0), 0)
  const restProzent = Math.max(0, 100 - summeFest)
  // Wer keinen festen Anteil hat, teilt sich den Rest nach erfasster Zeit.
  const freieMin = grund.reduce((s, g) => s + (g.fest === undefined ? g.min : 0), 0)
  const zeilenOhneBetrag = grund.map((g) => ({
    ...g,
    kosten: gueltig(g.satz) ? runde2((g.min / 60) * g.satz) : null,
    zeitanteil: gesamtMin > 0 ? (g.min / gesamtMin) * 100 : 0,
    anteil: gueltig(g.fest) ? g.fest : g.fest === undefined && freieMin > 0 ? (restProzent * g.min) / freieMin : 0,
  }))
  const verteiltProzent = zeilenOhneBetrag.reduce((s, z) => s + z.anteil, 0)
  // Beträge in Cent; ist die Provision vollständig verteilt, geht der Rundungsrest an den größten Anteil.
  const cent = zeilenOhneBetrag.map((z) => (provision === undefined ? 0 : Math.round(provision * z.anteil)))
  if (provision !== undefined && cent.length > 0 && Math.abs(verteiltProzent - 100) < 1e-6) {
    const rest = Math.round(provision * 100) - cent.reduce((s, c) => s + c, 0)
    cent[cent.indexOf(Math.max(...cent))] += rest
  }
  const zeilen: Zeile[] = zeilenOhneBetrag.map((z, i) => ({ ...z, betrag: provision === undefined ? null : cent[i] / 100 }))

  const kostenGesamt = runde2(zeilen.reduce((s, z) => s + (z.kosten ?? 0), 0))
  const betragGesamt = provision === undefined ? null : runde2(zeilen.reduce((s, z) => s + (z.betrag ?? 0), 0))
  const ueberschuss = provision === undefined ? null : runde2(provision - kostenGesamt)
  const ohneSatz = zeilen.filter((z) => z.min > 0 && z.satz === undefined).length
  const zuViel = summeFest > 100 + 1e-6
  const nichtVerteilt = zuViel ? 0 : Math.max(0, 100 - verteiltProzent)
  const unlesbar = Number.isNaN(provisionEingabe) || zeilen.some((z) => Number.isNaN(z.satz) || Number.isNaN(z.fest))

  // ── Speichern ──
  function inhalt(): Inhalt {
    const stundensaetze: Record<string, number> = {}
    const anteile: Record<string, number> = {}
    for (const z of zeilen) {
      if (gueltig(z.satz)) stundensaetze[z.name] = runde2(z.satz)
      if (gueltig(z.fest)) anteile[z.name] = runde2(z.fest)
    }
    return { provision, stundensaetze, anteile, notiz: entwurf.notiz.trim() }
  }
  const geaendert = kern(inhalt()) !== kern(gespeicherte ?? LEER)

  function speichern() {
    if (unlesbar) return
    const abrechnung: ObjektAbrechnung = { id: objekt.id, objektId: objekt.id, ...inhalt(), aktualisiertAm: new Date().toISOString() }
    dispatch({ type: 'SPEICHERE_ABRECHNUNG', abrechnung })
    setGeladen({ objektId: objekt.id, stand: `${objekt.id}|${abrechnung.aktualisiertAm}` })
    setBeruehrt(false)
    setFremdGeaendert(false)
    setGespeichert(true)
  }

  function ladeGespeicherten() {
    setEntwurf(entwurfAus(gespeicherte, objekt))
    setBeruehrt(false)
    setFremdGeaendert(false)
    setGespeichert(false)
  }

  // ── Personen ──
  const waehlbar = MITARBEITER.filter((m) => !namen.includes(m))
  function personHinzu() {
    if (!neuePerson || namen.includes(neuePerson)) return
    setze({ personen: [...entwurf.personen, neuePerson] })
    setNeuePerson('')
  }
  function personWeg(name: string) {
    const ohne = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([n]) => n !== name))
    setze({ personen: entwurf.personen.filter((n) => n !== name), saetze: ohne(entwurf.saetze), anteile: ohne(entwurf.anteile) })
  }

  // ── Vorschlag aus der Kurzprüfung ──
  const vorschlag = provisionsVorschlag(objekt)
  const vorschlagSteht = !!vorschlag && !gespeicherte && provision === vorschlag.betrag
  const vorschlagAngebot = !!vorschlag && entwurf.provision.trim() === ''

  // ── Ergebnis in einem Satz ──
  let satz: string
  if (provision === undefined || ueberschuss === null) {
    satz =
      kostenGesamt > 0
        ? `Bisher sind ${geld(kostenGesamt)} Zeitkosten aufgelaufen. Trag oben die Provision ein, dann siehst du, was davon übrig bleibt.`
        : 'Trag oben die Provision und die Stundensätze ein, dann siehst du hier, was nach den Zeitkosten übrig bleibt.'
  } else if (ueberschuss >= 0) {
    const jeStunde = gesamtMin > 0 ? ` Bei ${fmtDauer(gesamtMin)} erfasster Zeit sind das ${geld(provision / (gesamtMin / 60))} Provision je Stunde.` : ''
    satz = `Von ${geld(provision)} Provision bleiben nach ${geld(kostenGesamt)} Zeitkosten ${geld(ueberschuss)} übrig.${jeStunde}`
  } else {
    satz = `Die Zeitkosten von ${geld(kostenGesamt)} liegen um ${geld(-ueberschuss)} über der Provision von ${geld(provision)}.`
  }

  const zeitraum = (z: { erster: string; letzter: string }) => (!z.erster ? '–' : z.erster === z.letzter ? fmtDate(z.erster) : `${fmtDate(z.erster)} – ${fmtDate(z.letzter)}`)
  const bleibt = (z: Zeile) => (z.betrag === null ? null : runde2(z.betrag - (z.kosten ?? 0)))

  function drucken() {
    druckeBlatt(`Abrechnung – ${objekt.bezeichnung}`, `Stand ${fmtDate(today())} · Provision ${provision === undefined ? '–' : geld(provision)}`, [
      {
        titel: 'Zeit und Zeitkosten je Person',
        tabelle: {
          kopf: ['Person', 'Einträge', 'Zeit', 'Stunden', 'Zeitraum', 'Stundensatz', 'Zeitkosten'],
          zeilen: [
            ...zeilen.map((z) => [z.name, String(z.anzahl), z.min > 0 ? fmtDauer(z.min) : '–', fmtStunden(z.min), zeitraum(z), gueltig(z.satz) ? geld(z.satz) : '–', z.kosten === null ? '–' : geld(z.kosten)]),
            ['Summe', String(zeilen.reduce((s, z) => s + z.anzahl, 0)), gesamtMin > 0 ? fmtDauer(gesamtMin) : '–', fmtStunden(gesamtMin), '', '', geld(kostenGesamt)],
          ],
        },
      },
      {
        titel: 'Aufteilung der Provision',
        tabelle: {
          kopf: ['Person', 'Zeitanteil', 'Fester Anteil', 'Anteil an der Provision', 'Betrag', 'Bleibt nach Zeitkosten'],
          zeilen: [
            ...zeilen.map((z) => {
              const b = bleibt(z)
              return [z.name, prozent(z.zeitanteil), gueltig(z.fest) ? prozent(z.fest) : 'nach Zeit', prozent(z.anteil), z.betrag === null ? '–' : geld(z.betrag), b === null ? '–' : geld(b)]
            }),
            ['Summe', gesamtMin > 0 ? '100 %' : '–', summeFest > 0 ? prozent(summeFest) : '–', prozent(verteiltProzent), betragGesamt === null ? '–' : geld(betragGesamt), betragGesamt === null ? '–' : geld(betragGesamt - kostenGesamt)],
          ],
        },
      },
      {
        titel: 'Ergebnis',
        zeilen: [
          ['Provision', provision === undefined ? '–' : geld(provision)],
          ['Zeitkosten gesamt', geld(kostenGesamt)],
          ['Überschuss nach Zeitkosten', ueberschuss === null ? '–' : geld(ueberschuss)],
          ['', satz],
          ...(zuViel ? ([['Hinweis', `Die festen Anteile ergeben zusammen ${prozent(summeFest)} – mehr als die ganze Provision.`]] as [string, string][]) : []),
          ...(nichtVerteilt > 0.05 ? ([['Hinweis', `${prozent(nichtVerteilt)} der Provision sind noch nicht verteilt.`]] as [string, string][]) : []),
        ],
      },
      ...(entwurf.notiz.trim() ? [{ titel: 'Anmerkung', zeilen: [['', entwurf.notiz.trim()]] as [string, string][] }] : []),
    ])
  }

  const zelle = 'w-24 rounded-md border bg-white px-2 py-1.5 text-right text-sm text-slate-800 outline-none focus:border-accent-400'
  const rand = (wert: number | undefined) => (Number.isNaN(wert) ? 'border-rose-300 bg-rose-50' : 'border-slate-200')
  const kopf = 'pb-2 pl-3 text-right font-medium'
  const zahlZelle = 'py-2 pl-3 text-right tabular-nums text-slate-700'

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Abrechnung – {objekt.bezeichnung}</h3>
            <p className="text-xs text-slate-400">Wer hat wie viel Zeit hineingesteckt, was hat sie gekostet und wer bekommt wie viel von der Provision?</p>
          </div>
          <Link to="/immobilien/zeiterfassung" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Clock size={14} /> Zeit erfassen
          </Link>
        </div>

        {fremdGeaendert && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">Diese Abrechnung wurde inzwischen an anderer Stelle gespeichert. Wenn du jetzt speicherst, gilt dein Stand.</span>
            <button type="button" onClick={ladeGespeicherten} className="font-medium underline hover:no-underline">
              Gespeicherten Stand laden
            </button>
          </div>
        )}

        <h4 className="mb-2 text-sm font-semibold text-slate-700">Zeit und Zeitkosten je Person</h4>
        {mitZeit.length === 0 && <p className="mb-3 text-sm text-slate-500">Für dieses Objekt ist noch keine Zeit erfasst.</p>}
        {zeilen.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 text-left font-medium">Person</th>
                  <th className={kopf}>Einträge</th>
                  <th className={kopf}>Zeit</th>
                  <th className={kopf}>Stunden</th>
                  <th className="pb-2 pl-3 text-left font-medium">Zeitraum</th>
                  <th className={kopf}>Stundensatz (€)</th>
                  <th className={kopf}>Zeitkosten</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zeilen.map((z) => (
                  <tr key={z.name}>
                    <td className="py-2 font-medium text-slate-800">{z.name}</td>
                    <td className={zahlZelle}>{z.anzahl}</td>
                    <td className={`${zahlZelle} whitespace-nowrap`}>{z.min > 0 ? fmtDauer(z.min) : '–'}</td>
                    <td className={zahlZelle}>{fmtStunden(z.min)}</td>
                    <td className="whitespace-nowrap py-2 pl-3 text-slate-500">{zeitraum(z)}</td>
                    <td className="py-1 pl-3 text-right">
                      <input
                        className={`${zelle} ${rand(z.satz)}`}
                        inputMode="decimal"
                        value={entwurf.saetze[z.name] ?? ''}
                        onChange={(e) => setze({ saetze: { ...entwurf.saetze, [z.name]: e.target.value } })}
                        placeholder="z. B. 80"
                        aria-label={`Stundensatz in Euro für ${z.name}`}
                        aria-invalid={Number.isNaN(z.satz)}
                      />
                    </td>
                    <td className={`${zahlZelle} whitespace-nowrap`}>{z.kosten === null ? '–' : geld(z.kosten)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-800">
                  <td className="py-2">Summe</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{zeilen.reduce((s, z) => s + z.anzahl, 0)}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{gesamtMin > 0 ? fmtDauer(gesamtMin) : '–'}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{fmtStunden(gesamtMin)}</td>
                  <td></td>
                  <td></td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{geld(kostenGesamt)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {ohneSatz > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            {ohneSatz === 1 ? 'Für eine Person fehlt noch der Stundensatz – ihre Zeit ist' : `Für ${ohneSatz} Personen fehlt noch der Stundensatz – ihre Zeit ist`} in den Zeitkosten noch nicht enthalten.
          </p>
        )}
      </Card>

      <Card className="p-5">
        <h4 className="mb-3 text-sm font-semibold text-slate-700">Provision und Aufteilung</h4>
        <div className="max-w-xs">
          <Field label="Provision (€)">
            <input
              className={`${inputClass} ${Number.isNaN(provisionEingabe) ? 'border-rose-300 bg-rose-50' : ''}`}
              inputMode="decimal"
              value={entwurf.provision}
              onChange={(e) => setze({ provision: e.target.value })}
              placeholder="z. B. 25.000"
              aria-invalid={Number.isNaN(provisionEingabe)}
            />
          </Field>
        </div>
        {vorschlagSteht && vorschlag && <p className="-mt-1 mb-3 text-xs text-slate-500">Vorschlag: {vorschlag.herkunft}. Er ist noch nicht gespeichert – du kannst ihn ändern.</p>}
        {vorschlagAngebot && vorschlag && (
          <p className="-mt-1 mb-3 text-xs text-slate-500">
            Vorschlag: {geld(vorschlag.betrag)} – {vorschlag.herkunft}.{' '}
            <button type="button" onClick={() => setze({ provision: zahlText(vorschlag.betrag) })} className="font-medium text-accent-600 hover:underline">
              Übernehmen
            </button>
          </p>
        )}

        <p className="mb-3 text-xs text-slate-400">
          Ohne weitere Angaben wird die Provision nach dem Anteil an der erfassten Zeit geteilt. Trägst du bei jemandem einen festen Anteil ein, teilen sich die anderen den Rest nach ihrer Zeit.
        </p>

        {zeilen.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">Noch niemand zum Aufteilen da – erfasse Zeit für das Objekt oder füge unten eine Person hinzu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 text-left font-medium">Person</th>
                  <th className={kopf}>Zeitanteil</th>
                  <th className={kopf}>Fester Anteil (%)</th>
                  <th className={kopf}>Anteil an der Provision</th>
                  <th className={kopf}>Betrag</th>
                  <th className={kopf}>Bleibt nach Zeitkosten</th>
                  <th className="w-10 pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {zeilen.map((z) => {
                  const b = bleibt(z)
                  return (
                    <tr key={z.name}>
                      <td className="py-2 font-medium text-slate-800">{z.name}</td>
                      <td className={zahlZelle}>{gesamtMin > 0 ? prozent(z.zeitanteil) : '–'}</td>
                      <td className="py-1 pl-3 text-right">
                        <input
                          className={`${zelle} ${rand(z.fest)}`}
                          inputMode="decimal"
                          value={entwurf.anteile[z.name] ?? ''}
                          onChange={(e) => setze({ anteile: { ...entwurf.anteile, [z.name]: e.target.value } })}
                          placeholder="nach Zeit"
                          aria-label={`Fester Anteil an der Provision in Prozent für ${z.name}`}
                          aria-invalid={Number.isNaN(z.fest)}
                        />
                      </td>
                      <td className={zahlZelle}>{prozent(z.anteil)}</td>
                      <td className={`${zahlZelle} whitespace-nowrap font-medium text-slate-800`}>{z.betrag === null ? '–' : geld(z.betrag)}</td>
                      <td className={`py-2 pl-3 text-right tabular-nums whitespace-nowrap ${b !== null && b < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{b === null ? '–' : geld(b)}</td>
                      <td className="py-1 pl-2 text-right">
                        {!jePerson.has(z.name) && (
                          <button type="button" onClick={() => personWeg(z.name)} className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-rose-600" aria-label={`${z.name} aus der Aufteilung entfernen`} title="Aus der Aufteilung entfernen">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold text-slate-800">
                  <td className="py-2">Summe</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{gesamtMin > 0 ? '100 %' : '–'}</td>
                  <td className={`py-2 pl-3 text-right tabular-nums ${zuViel ? 'text-rose-600' : ''}`}>{summeFest > 0 ? prozent(summeFest) : '–'}</td>
                  <td className={`py-2 pl-3 text-right tabular-nums ${zuViel ? 'text-rose-600' : ''}`}>{prozent(verteiltProzent)}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{betragGesamt === null ? '–' : geld(betragGesamt)}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{betragGesamt === null ? '–' : geld(betragGesamt - kostenGesamt)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {zuViel && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              Die festen Anteile ergeben zusammen {prozent(summeFest)} – das sind {prozent(summeFest - 100)} mehr als die ganze Provision. Wer keinen festen Anteil hat, bekommt so nichts. Bitte die Anteile anpassen.
            </span>
          </div>
        )}
        {!zuViel && zeilen.length > 0 && nichtVerteilt > 0.05 && (
          <p className="mt-3 text-xs text-slate-500">
            {prozent(nichtVerteilt)} der Provision{provision !== undefined ? ` (${geld((provision * nichtVerteilt) / 100)})` : ''} sind noch nicht verteilt – es gibt niemanden mit erfasster Zeit, der sich den Rest teilt. Gib einen festen Anteil ein oder erfasse Zeit.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select className={`${inputClass} w-auto min-w-48`} value={neuePerson} onChange={(e) => setNeuePerson(e.target.value)} aria-label="Person ohne Zeiteinträge hinzufügen" disabled={waehlbar.length === 0}>
            <option value="">{waehlbar.length === 0 ? 'Alle sind schon dabei' : 'Person auswählen …'}</option>
            {waehlbar.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <SecondaryButton onClick={personHinzu} disabled={!neuePerson}>
            <UserPlus size={14} /> Person hinzufügen
          </SecondaryButton>
          <span className="text-xs text-slate-400">Für jemanden ohne erfasste Zeit, der einen festen Anteil bekommt – zum Beispiel die Geschäftsführung.</span>
        </div>
      </Card>

      <Card className="p-5">
        <h4 className="mb-3 text-sm font-semibold text-slate-700">Ergebnis</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-medium text-slate-500">Provision</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{provision === undefined ? '–' : geld(provision)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-medium text-slate-500">Zeitkosten gesamt</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{geld(kostenGesamt)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-medium text-slate-500">Überschuss nach Zeitkosten</div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${ueberschuss === null ? 'text-slate-800' : ueberschuss < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{ueberschuss === null ? '–' : geld(ueberschuss)}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">{satz}</p>

        <div className="mt-4">
          <Field label="Anmerkung">
            <textarea className={`${inputClass} min-h-20`} value={entwurf.notiz} onChange={(e) => setze({ notiz: e.target.value })} placeholder="z. B. Absprachen zur Aufteilung, Stand der Provision" />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          {unlesbar && <span className="text-xs font-medium text-rose-600">Bitte in den rot markierten Feldern nur Zahlen eintragen.</span>}
          {gespeichert && !geaendert && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={13} /> Gespeichert
            </span>
          )}
          {!gespeichert && !geaendert && gespeicherte?.aktualisiertAm && <span className="text-xs text-slate-400">Zuletzt gespeichert am {fmtDateTime(gespeicherte.aktualisiertAm)}</span>}
          <SecondaryButton onClick={drucken}>
            <Printer size={14} /> Drucken
          </SecondaryButton>
          <PrimaryButton onClick={speichern} disabled={!geaendert || unlesbar}>
            Abrechnung speichern
          </PrimaryButton>
        </div>
      </Card>
    </div>
  )
}
