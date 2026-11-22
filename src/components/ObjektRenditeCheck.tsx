import { useEffect, useMemo, useState } from 'react'
import { Calculator, Check, ClipboardCheck, ExternalLink, Globe, Loader2, Printer, Save } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { CURRENT_USER } from '../data/constants'
import { druckeBlatt, type DruckAbschnitt } from '../lib/blattDruck'
import { fmtDate } from '../lib/dates'
import { callAuthenticated, isEmailGatewayConfigured } from '../lib/emailGateway'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { leereKurzpruefung } from '../lib/bewertungAnzeige'
import {
  berechneRendite,
  type Bundesland,
  EINGABE_FELDER,
  empfindlichkeit,
  euroText,
  GRUNDERWERBSTEUER,
  leseRenditeStand,
  leseZahl,
  mischeRenditeStand,
  type MieteArt,
  prozentText,
  PRUEFSTEINE,
  RENDITE_VORGABEN,
  type RenditeEingaben,
  type RenditeMarkt,
  type RenditeStand,
  urteilText,
  vergleicheMitMarkt,
  vorschlagAusObjekt,
  vorzeichen,
  zahlText,
} from '../../supabase/functions/_shared/renditeKern.ts'
import type { Objekt } from '../types'

// Rendite- und Kaufpreis-Check eines Anlageobjekts (Reiter „Rendite“ der Objektakte, 22.11.2026). Gerechnet wird
// mit dem gemeinsamen Kern supabase/functions/_shared/renditeKern.ts — derselbe rechnet im Assistenten
// (rendite_rechnen), deshalb nennen Telegram und die Akte dieselben Zahlen. Gespeichert wird in objekte.rendite:
// diese Spalte liest und schreibt nur diese Seite (frisch gelesen und zusammengeführt), das übrige Speichern des
// Objekts (crmSync) lässt sie unberührt. Den Marktvergleich schreibt der Server (email-gateway/renditeMarkt.ts).

type Zahlfeld = Exclude<keyof RenditeEingaben, 'mieteArt' | 'pacht' | 'bundesland'>
type Formular = Record<Zahlfeld, string> & { mieteArt: MieteArt; pacht: boolean; bundesland: Bundesland | '' }

const ZAHLFELDER: Zahlfeld[] = [
  'kaufpreis', 'flaeche', 'einheiten', 'miete', 'grunderwerbsteuerProzent', 'notarGrundbuchProzent', 'maklerProzent', 'zusatzkosten',
  'leerstandProzent', 'bewirtschaftungProzent', 'instandhaltungJeQm', 'sonstigeKostenJahr', 'eigenkapital', 'zinsProzent', 'tilgungProzent',
]

const MIETE_ARTEN: { id: MieteArt; label: string }[] = [
  { id: 'qm_monat', label: '€ je m² im Monat' },
  { id: 'monat', label: '€ im Monat (gesamt)' },
  { id: 'jahr', label: '€ im Jahr (gesamt)' },
]

const fehlerText = (err: unknown, ersatz: string) => (err instanceof Error && err.message ? err.message : ersatz)
const alsText = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','))

function formularAus(e: RenditeEingaben): Formular {
  const f = { mieteArt: e.mieteArt ?? 'qm_monat', pacht: e.pacht === true, bundesland: e.bundesland ?? '' } as Formular
  for (const k of ZAHLFELDER) f[k] = alsText(e[k])
  return f
}

function eingabenAus(f: Formular): RenditeEingaben {
  const e: RenditeEingaben = { mieteArt: f.mieteArt }
  if (f.pacht) e.pacht = true
  if (f.bundesland) e.bundesland = f.bundesland
  for (const k of ZAHLFELDER) {
    const n = f[k].trim() ? leseZahl(f[k]) : undefined
    if (n !== undefined && n >= 0) e[k] = n
  }
  return e
}

async function ladeStand(objektId: string): Promise<RenditeStand | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('objekte').select('rendite').eq('id', objektId).maybeSingle()
  if (error) throw new Error(error.message)
  const roh = (data as { rendite?: unknown } | null)?.rendite
  return roh ? leseRenditeStand(roh) : null
}

/** Frisch lesen, zusammenführen, nur die Spalte rendite schreiben (Marktvergleich und Prüfsteine anderer bleiben). */
async function speichereStand(objektId: string, aenderung: Partial<RenditeStand>): Promise<RenditeStand> {
  if (!supabase) return mischeRenditeStand(null, aenderung)
  const { data, error } = await supabase.from('objekte').select('rendite').eq('id', objektId).maybeSingle()
  if (error) throw new Error(error.message)
  const neu = mischeRenditeStand((data as { rendite?: unknown } | null)?.rendite, aenderung)
  const { error: fehler } = await supabase.from('objekte').update({ rendite: neu }).eq('id', objektId)
  if (fehler) throw new Error(fehler.message)
  return neu
}

function Kachel({ titel, wert, zusatz, ton = 'normal' }: { titel: string; wert: string; zusatz?: string; ton?: 'normal' | 'gut' | 'schlecht' }) {
  const farbe = ton === 'gut' ? 'text-emerald-700' : ton === 'schlecht' ? 'text-rose-700' : 'text-slate-800'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{titel}</div>
      <div className={`text-base font-semibold ${farbe}`}>{wert}</div>
      {zusatz && <div className="text-xs text-slate-400">{zusatz}</div>}
    </div>
  )
}

export function ObjektRenditeCheck({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const vorschlag = useMemo(() => vorschlagAusObjekt(objekt), [objekt])
  const [stand, setStand] = useState<RenditeStand | null>(null)
  const [geladen, setGeladen] = useState(!isSupabaseConfigured)
  const [form, setForm] = useState<Formular>(() => formularAus(vorschlag.eingaben))
  const [geaendert, setGeaendert] = useState<Set<keyof Formular>>(new Set())
  const [vorgang, setVorgang] = useState<'' | 'speichern' | 'markt' | 'pruefstein'>('')
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')

  // Gespeicherten Stand holen; gibt es noch keine Eingaben, bleibt der Vorschlag aus der Akte stehen.
  useEffect(() => {
    let aktiv = true
    ladeStand(objekt.id)
      .then((s) => {
        if (!aktiv) return
        setStand(s)
        if (s?.eingaben && Object.keys(s.eingaben).length > 0) setForm(formularAus({ ...vorschlag.eingaben, ...s.eingaben }))
      })
      .catch((err) => aktiv && setFehler(`Der gespeicherte Rendite-Check konnte nicht geladen werden: ${fehlerText(err, 'unbekannter Fehler')}`))
      .finally(() => aktiv && setGeladen(true))
    return () => {
      aktiv = false
    }
    // Nur beim Öffnen eines Objekts — spätere Änderungen an der Akte überschreiben keine Eingaben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objekt.id])

  // Läuft ein Vergleich vor Ort (z. B. per Telegram gestartet), alle 5 Sekunden nachsehen, bis er fertig ist.
  const marktLaeuft = stand?.markt?.status === 'laeuft'
  useEffect(() => {
    if (!marktLaeuft || vorgang === 'markt') return
    const takt = setInterval(() => {
      ladeStand(objekt.id)
        .then((s) => s && setStand((alt) => ({ ...(alt ?? s), markt: s.markt })))
        .catch(() => undefined)
    }, 5000)
    return () => clearInterval(takt)
  }, [marktLaeuft, vorgang, objekt.id])

  const eingaben = useMemo(() => eingabenAus(form), [form])
  const r = useMemo(() => berechneRendite(eingaben), [eingaben])
  const em = useMemo(() => empfindlichkeit(eingaben), [eingaben])
  const markt = stand?.markt
  const vgl = useMemo(() => vergleicheMitMarkt({ ...r, flaeche: eingaben.flaeche }, markt), [r, eingaben.flaeche, markt])
  const herkunft = { ...vorschlag.herkunft, ...(stand?.herkunft ?? {}) }
  const ungespeichert = !stand?.eingaben || EINGABE_FELDER.some((f) => (eingaben[f] ?? (f === 'mieteArt' ? 'qm_monat' : undefined)) !== (stand.eingaben?.[f] ?? (f === 'mieteArt' ? 'qm_monat' : undefined)))
  const pachtWort = form.pacht ? 'Pacht' : 'Miete'
  const beschaeftigt = vorgang !== ''

  function setze<K extends keyof Formular>(feld: K, wert: Formular[K]) {
    setForm((alt) => ({ ...alt, [feld]: wert }))
    setGeaendert((alt) => new Set(alt).add(feld))
    setHinweis('')
  }

  async function speichern() {
    if (beschaeftigt) return
    setVorgang('speichern')
    setFehler('')
    try {
      const neueHerkunft: RenditeStand['herkunft'] = { ...herkunft }
      for (const f of geaendert) neueHerkunft[f] = `Eingabe im CRM (${CURRENT_USER})`
      for (const f of Object.keys(neueHerkunft) as (keyof RenditeEingaben)[]) if (eingaben[f] === undefined) delete neueHerkunft[f]
      const neu = await speichereStand(objekt.id, { eingaben, herkunft: neueHerkunft, ergebnis: r, berechnetAm: new Date().toISOString(), berechnetVon: CURRENT_USER })
      setStand(neu)
      setGeaendert(new Set())
      setHinweis('Gespeichert.')
    } catch (err) {
      setFehler(`Speichern ging nicht: ${fehlerText(err, 'unbekannter Fehler')}`)
    } finally {
      setVorgang('')
    }
  }

  async function marktPruefen() {
    if (beschaeftigt) return
    setVorgang('markt')
    setFehler('')
    setHinweis('')
    try {
      // Fläche und Einheiten helfen der Recherche — vorher speichern, falls noch nicht geschehen.
      if (ungespeichert) setStand(await speichereStand(objekt.id, { eingaben, herkunft, ergebnis: r, berechnetAm: new Date().toISOString(), berechnetVon: CURRENT_USER }))
      setStand((alt) => ({ ...(alt ?? { version: 1 }), markt: { ...(alt?.markt ?? {}), status: 'laeuft', gestartetAm: new Date().toISOString() } as RenditeMarkt }))
      const antwort = (await callAuthenticated({ action: 'rendite_marktvergleich', objektId: objekt.id })) as { markt?: RenditeMarkt }
      if (antwort.markt) setStand((alt) => ({ ...(alt ?? { version: 1 }), markt: antwort.markt }))
    } catch (err) {
      setFehler(`Vergleich vor Ort: ${fehlerText(err, 'unbekannter Fehler')}`)
      // Auch bei einem Abbruch der Verbindung kann der Server fertig geworden sein.
      ladeStand(objekt.id).then((s) => s && setStand(s)).catch(() => undefined)
    } finally {
      setVorgang('')
    }
  }

  async function pruefsteinSetzen(id: string, erledigt: boolean, notiz?: string) {
    setVorgang('pruefstein')
    setFehler('')
    const alt = stand?.pruefsteine?.[id]
    const eintrag = { erledigt, ...(notiz ?? alt?.notiz ? { notiz: notiz ?? alt?.notiz } : {}), am: new Date().toISOString().slice(0, 10), von: CURRENT_USER }
    try {
      setStand(await speichereStand(objekt.id, { pruefsteine: { [id]: eintrag } }))
    } catch (err) {
      setFehler(`Prüfstein konnte nicht gespeichert werden: ${fehlerText(err, 'unbekannter Fehler')}`)
    } finally {
      setVorgang('')
    }
  }

  // Finanzierung aus dem Reiter „Finanzierung“ (nicht abgelehnt; zugesagte und ausgezahlte zuerst) als Vorlage.
  const finanzierung = useMemo(() => {
    const rang: Record<string, number> = { Ausgezahlt: 0, Zugesagt: 1, 'In Prüfung': 2, Angefragt: 3 }
    return (state.finanzierungen ?? [])
      .filter((f) => f.objektId === objekt.id && f.status !== 'Abgelehnt' && f.darlehenssumme > 0)
      .sort((a, b) => (rang[a.status] ?? 9) - (rang[b.status] ?? 9))[0]
  }, [state.finanzierungen, objekt.id])

  function finanzierungUebernehmen() {
    if (!finanzierung) return
    // Eigenkapital = Gesamtinvestition − Darlehenssumme (nie unter 0).
    setForm((alt) => ({
      ...alt,
      eigenkapital: alsText(Math.max(0, Math.round(r.gesamtinvestition - finanzierung.darlehenssumme))),
      ...(finanzierung.zinssatz > 0 ? { zinsProzent: alsText(finanzierung.zinssatz) } : {}),
    }))
    setGeaendert((alt) => new Set(alt).add('eigenkapital').add('zinsProzent'))
    setHinweis(`Finanzierung ${finanzierung.bank ? `der ${finanzierung.bank} ` : ''}übernommen: Darlehen ${euroText(finanzierung.darlehenssumme)}${finanzierung.zinssatz > 0 ? `, ${prozentText(finanzierung.zinssatz, 2)} Zins` : ''}. Tilgung bitte prüfen.`)
  }

  function marktmieteUebernehmen() {
    const m = markt?.mieteJeQmMittel ?? (markt?.mieteJeQmVon && markt?.mieteJeQmBis ? (markt.mieteJeQmVon + markt.mieteJeQmBis) / 2 : markt?.mieteJeQmVon ?? markt?.mieteJeQmBis)
    if (!m) return
    setForm((alt) => ({ ...alt, miete: alsText(Math.round(m * 100) / 100), mieteArt: 'qm_monat' }))
    setGeaendert((alt) => new Set(alt).add('miete'))
    setHinweis('Marktmiete als Annahme eingesetzt — das ist keine vereinbarte Miete.')
  }

  /** Trägt die eigenen Werte in die Spalte „Ist“ der Kurzprüfung ein — nur in leere Felder. */
  function inKurzpruefung() {
    const basis = objekt.kurzpruefung ?? leereKurzpruefung(objekt)
    const zeilen = { ...basis.zeilen }
    const werte: [string, string, string][] = [
      ['preisProQm', 'Preis pro m²', r.kaufpreisJeQm ? `${euroText(r.kaufpreisJeQm)}/m²` : ''],
      ['mieteProQm', 'Miete pro m²', r.mieteJeQmMonat ? `${euroText(r.mieteJeQmMonat, 2)}/m²` : ''],
      ['rendite', 'Rendite', r.bruttorendite !== null ? `${prozentText(r.bruttorendite)} brutto, ${prozentText(r.nettorendite)} netto` : ''],
      ['kaufpreisfaktor', 'Kaufpreisfaktor', r.faktor ? zahlText(r.faktor, 1) : ''],
    ]
    const gefuellt: string[] = []
    const belegt: string[] = []
    for (const [id, label, text] of werte) {
      if (!text) continue
      const alt = zeilen[id] ?? { ist: '', marktwert: '', ergebnis: '' }
      if ((alt.ist ?? '').trim()) {
        belegt.push(label)
        continue
      }
      zeilen[id] = { ...alt, ist: text }
      gefuellt.push(label)
    }
    if (gefuellt.length) dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { kurzpruefung: { ...basis, zeilen } } })
    setHinweis(
      gefuellt.length
        ? `In die Kurzprüfung (Spalte „Ist“) eingetragen: ${gefuellt.join(', ')}.${belegt.length ? ` Schon belegt und nicht geändert: ${belegt.join(', ')}.` : ''}`
        : belegt.length
          ? `Nichts eingetragen — schon belegt: ${belegt.join(', ')}.`
          : 'Es gibt noch keine Werte zum Eintragen.',
    )
  }

  function drucken() {
    const abschnitte: DruckAbschnitt[] = [
      {
        titel: 'Kaufpreis und Nebenkosten',
        zeilen: [
          ['Kaufpreis', euroText(r.kaufpreis)],
          [`Grunderwerbsteuer (${prozentText(r.grunderwerbsteuerProzent, 1)})`, euroText(r.grunderwerbsteuer)],
          ['Notar und Grundbuch', euroText(r.notarGrundbuch)],
          ['Makler', euroText(r.makler)],
          ...(r.zusatzkosten ? ([['Zusatzkosten', euroText(r.zusatzkosten)]] as [string, string][]) : []),
          ['Gesamtinvestition', euroText(r.gesamtinvestition)],
        ],
      },
      {
        titel: 'Kennzahlen',
        zeilen: [
          ['Kaufpreis je m²', euroText(r.kaufpreisJeQm)],
          [`${pachtWort} im Jahr`, euroText(r.jahresmieteSoll)],
          [`${pachtWort} je m² im Monat`, euroText(r.mieteJeQmMonat, 2)],
          ['Kaufpreisfaktor', zahlText(r.faktor, 1)],
          ['Bruttorendite', prozentText(r.bruttorendite)],
          ['Nettorendite', prozentText(r.nettorendite)],
          ['Cashflow vor Steuern im Monat', euroText(r.cashflowMonat)],
          ['Eigenkapitalrendite', prozentText(r.ekRendite)],
          [`Break-even-${pachtWort} je m² im Monat`, euroText(r.breakEvenMieteJeQmMonat, 2)],
        ],
      },
      {
        titel: 'Empfindlichkeit',
        tabelle: {
          kopf: [pachtWort, 'Bruttorendite', 'Nettorendite', 'Cashflow im Monat', 'Eigenkapitalrendite'],
          zeilen: em.miete.map((z) => [z.aenderung === 0 ? 'wie angesetzt' : `${vorzeichen(z.aenderung, String(z.aenderung))} %`, prozentText(z.bruttorendite), prozentText(z.nettorendite), euroText(z.cashflowMonat), prozentText(z.ekRendite)]),
        },
      },
    ]
    if (markt?.status === 'fertig') {
      abschnitte.push({
        titel: `Vergleich vor Ort (${markt.stand ? fmtDate(markt.stand) : '–'})`,
        zeilen: [
          ['Preise je m²', `${euroText(markt.preisJeQmVon)} bis ${euroText(markt.preisJeQmBis)}${markt.preisBezug ? ` (${markt.preisBezug})` : ''}`],
          ['Miete/Pacht je m²', `${euroText(markt.mieteJeQmVon, 2)} bis ${euroText(markt.mieteJeQmBis, 2)}${markt.mieteBezug ? ` (${markt.mieteBezug})` : ''}`],
          ['Einschätzung', markt.einschaetzung ?? ''],
          ['Quellen', (markt.quellen ?? []).map((q) => `${q.titel}: ${q.url}`).join('\n')],
        ],
      })
    }
    abschnitte.push({ titel: 'Prüfsteine', zeilen: PRUEFSTEINE.map((p) => [p.titel, `${stand?.pruefsteine?.[p.id]?.erledigt ? 'geklärt' : 'offen'}${stand?.pruefsteine?.[p.id]?.notiz ? ` – ${stand.pruefsteine[p.id].notiz}` : ''}`]) })
    if (r.annahmen.length) abschnitte.push({ titel: 'Annahmen', zeilen: r.annahmen.map((a) => ['', a]) })
    druckeBlatt(`Rendite-Check – ${objekt.bezeichnung}`, 'Überschlagsrechnung vor Steuern, kein Gutachten', abschnitte)
  }

  const feld = (k: Zahlfeld, label: string, platzhalter?: string) => (
    <Field label={label}>
      <input className={inputClass} inputMode="decimal" value={form[k]} placeholder={platzhalter} onChange={(e) => setze(k, e.target.value)} />
      {herkunft[k] && !geaendert.has(k) && <span className="mt-0.5 block text-[11px] text-slate-400">aus: {herkunft[k]}</span>}
    </Field>
  )

  const satzLand = GRUNDERWERBSTEUER[form.bundesland || RENDITE_VORGABEN.bundesland].prozent
  const marktAlter = markt?.stand ? Math.round((Date.now() - new Date(`${markt.stand}T12:00:00`).getTime()) / 86_400_000) : null

  if (!geladen) {
    return (
      <Card className="p-5 text-sm text-slate-500">
        <Loader2 size={14} className="mr-1 inline animate-spin" /> Rendite-Check wird geladen …
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800"><Calculator size={16} /> Rendite-Check</h3>
            <p className="text-xs text-slate-500">
              Überschlagsrechnung vor Steuern, kein Gutachten.{' '}
              {stand?.berechnetAm ? `Zuletzt gespeichert am ${fmtDate(stand.berechnetAm.slice(0, 10))}${stand.berechnetVon ? ` von ${stand.berechnetVon}` : ''}.` : 'Noch nicht gespeichert — die Felder sind aus der Akte vorbefüllt.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton onClick={speichern} disabled={beschaeftigt || !ungespeichert}>
              {vorgang === 'speichern' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Speichern
            </PrimaryButton>
            <SecondaryButton onClick={marktPruefen} disabled={beschaeftigt || marktLaeuft || !isEmailGatewayConfigured}>
              {vorgang === 'markt' || marktLaeuft ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Vergleich vor Ort prüfen
            </SecondaryButton>
            <SecondaryButton onClick={inKurzpruefung} disabled={beschaeftigt}><ClipboardCheck size={14} /> In Kurzprüfung übernehmen</SecondaryButton>
            <SecondaryButton onClick={drucken}><Printer size={14} /> Drucken / als PDF</SecondaryButton>
          </div>
        </div>
        {fehler && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</div>}
        {hinweis && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><Check size={14} className="mr-1 inline" />{hinweis}</div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="col-span-full mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Objekt und {pachtWort}</div>
            {feld('kaufpreis', 'Kaufpreis (€)')}
            {feld('flaeche', 'Fläche (m²)')}
            {feld('einheiten', 'Einheiten')}
            {feld('miete', `${pachtWort} netto kalt`)}
            <Field label="Einheit">
              <select className={inputClass} value={form.mieteArt} onChange={(e) => setze('mieteArt', e.target.value as MieteArt)}>
                {MIETE_ARTEN.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
            <label className="mb-3 flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
              <input type="checkbox" checked={form.pacht} onChange={(e) => setze('pacht', e.target.checked)} /> Es ist eine Pacht
            </label>

            <div className="col-span-full mb-1 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Kaufnebenkosten</div>
            <Field label="Bundesland">
              <select className={inputClass} value={form.bundesland} onChange={(e) => setze('bundesland', e.target.value as Bundesland | '')}>
                <option value="">{GRUNDERWERBSTEUER[RENDITE_VORGABEN.bundesland].name} (Vorgabe)</option>
                {(Object.keys(GRUNDERWERBSTEUER) as Bundesland[]).map((b) => <option key={b} value={b}>{GRUNDERWERBSTEUER[b].name} ({zahlText(GRUNDERWERBSTEUER[b].prozent, 1)} %)</option>)}
              </select>
              {herkunft.bundesland && !geaendert.has('bundesland') && <span className="mt-0.5 block text-[11px] text-slate-400">aus: {herkunft.bundesland}</span>}
            </Field>
            {feld('grunderwerbsteuerProzent', 'Grunderwerbsteuer (%)', `${zahlText(satzLand, 1)} laut Bundesland`)}
            {feld('notarGrundbuchProzent', 'Notar und Grundbuch (%)', zahlText(RENDITE_VORGABEN.notarGrundbuchProzent, 1))}
            {feld('maklerProzent', 'Makler / Käuferprovision (%)', '0')}
            {feld('zusatzkosten', 'Zusatzkosten einmalig (€)', 'z. B. Möblierung')}

            <div className="col-span-full mb-1 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Laufende Kosten des Eigentümers</div>
            {feld('leerstandProzent', 'Leerstand/Mietausfall (%)', String(RENDITE_VORGABEN.leerstandProzent))}
            {feld('bewirtschaftungProzent', 'Nicht umlagefähig (% der Miete)', String(RENDITE_VORGABEN.bewirtschaftungProzent))}
            {feld('instandhaltungJeQm', 'Instandhaltung (€/m² im Jahr)', String(RENDITE_VORGABEN.instandhaltungJeQm))}
            {feld('sonstigeKostenJahr', 'Feste Kosten im Jahr (€)', '0')}

            <div className="col-span-full mb-1 mt-1 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span>Finanzierung (leer = ganz aus eigenem Geld)</span>
              {finanzierung && (
                <button type="button" onClick={finanzierungUebernehmen} className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-accent-700 hover:bg-slate-50">
                  Aus dem Reiter „Finanzierung“ übernehmen
                </button>
              )}
            </div>
            {feld('eigenkapital', 'Eigenkapital (€)', 'Nebenkosten + 20 %')}
            {feld('zinsProzent', 'Zins (%)', zahlText(RENDITE_VORGABEN.zinsProzent, 1))}
            {feld('tilgungProzent', 'Tilgung (%)', zahlText(RENDITE_VORGABEN.tilgungProzent, 0))}
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Kachel titel="Kaufpreis je m²" wert={euroText(r.kaufpreisJeQm)} zusatz={vgl.preis ? `vor Ort ${euroText(vgl.preis.von)}–${euroText(vgl.preis.bis)}: ${urteilText(vgl.preis.urteil)}` : r.gesamtJeQm ? `mit Nebenkosten ${euroText(r.gesamtJeQm)}` : undefined} ton={vgl.preis?.urteil === 'guenstig' ? 'gut' : vgl.preis?.urteil === 'teuer' ? 'schlecht' : 'normal'} />
              <Kachel titel="Gesamtinvestition" wert={euroText(r.gesamtinvestition)} zusatz={`Nebenkosten ${euroText(r.nebenkosten)} (${prozentText(r.nebenkostenProzent, 1)})`} />
              <Kachel titel="Kaufpreisfaktor" wert={r.faktor ? `${zahlText(r.faktor, 1)}-fach` : '–'} zusatz="Kaufpreis ÷ Jahresmiete" />
              <Kachel titel="Bruttorendite" wert={prozentText(r.bruttorendite)} zusatz={vgl.renditeBeiMarktmiete ? `bei Marktmiete ${prozentText(vgl.renditeBeiMarktmiete.von)}–${prozentText(vgl.renditeBeiMarktmiete.bis)}` : `${pachtWort} ÷ Kaufpreis`} />
              <Kachel titel="Nettorendite" wert={prozentText(r.nettorendite)} zusatz="nach Kosten, mit Nebenkosten" />
              <Kachel titel={`${pachtWort} im Jahr`} wert={euroText(r.jahresmieteSoll)} zusatz={r.mieteJeQmMonat ? `${euroText(r.mieteJeQmMonat, 2)}/m² im Monat` : undefined} />
              <Kachel titel="Cashflow vor Steuern" wert={r.cashflowMonat !== null ? `${euroText(r.cashflowMonat)} / Monat` : '–'} zusatz={r.finanziert ? `nach Rate ${euroText(r.kapitaldienstJahr / 12)} im Monat` : 'ohne Darlehen'} ton={r.cashflowMonat !== null ? (r.cashflowMonat >= 0 ? 'gut' : 'schlecht') : 'normal'} />
              <Kachel titel="Eigenkapitalrendite" wert={prozentText(r.ekRendite)} zusatz={`auf ${euroText(r.eigenkapital)}`} />
              <Kachel titel={`Break-even-${pachtWort}`} wert={r.breakEvenMieteJeQmMonat !== null ? `${euroText(r.breakEvenMieteJeQmMonat, 2)}/m²` : '–'} zusatz={r.breakEvenAnteil !== null ? `${prozentText(r.breakEvenAnteil, 0)} der angesetzten` : 'Cashflow = 0'} />
              {r.finanziert && <Kachel titel="Schuldendienstdeckung" wert={zahlText(r.schuldendienstdeckung, 2)} zusatz="Reinertrag ÷ Rate (Banken: ab 1,2)" ton={r.schuldendienstdeckung !== null && r.schuldendienstdeckung < 1.2 ? 'schlecht' : 'normal'} />}
            </div>
            {r.fehlt.length > 0 && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Für eine vollständige Rechnung fehlt: {r.fehlt.join(', ')}.</div>}
            {r.annahmen.length > 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="mb-1 font-medium text-slate-700">Annahmen (bitte prüfen)</div>
                <ul className="list-disc space-y-0.5 pl-4">{r.annahmen.map((a) => <li key={a}>{a}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      </Card>

      {r.jahresmieteSoll !== null && (
        <Card className="overflow-x-auto p-5">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Was, wenn {pachtWort} oder Zins anders kommen?</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3">{pachtWort}</th><th className="pr-3">Bruttorendite</th><th className="pr-3">Nettorendite</th><th className="pr-3">Cashflow im Monat</th><th>Eigenkapitalrendite</th>
              </tr>
            </thead>
            <tbody>
              {em.miete.map((z) => (
                <tr key={z.aenderung} className={`border-b border-slate-50 ${z.aenderung === 0 ? 'font-medium' : ''}`}>
                  <td className="py-1.5 pr-3">{z.aenderung === 0 ? 'wie angesetzt' : `${vorzeichen(z.aenderung, String(z.aenderung))} %`} <span className="text-xs text-slate-400">({euroText(z.jahresmieteSoll)})</span></td>
                  <td className="pr-3">{prozentText(z.bruttorendite)}</td>
                  <td className="pr-3">{prozentText(z.nettorendite)}</td>
                  <td className={`pr-3 ${z.cashflowMonat !== null && z.cashflowMonat < 0 ? 'text-rose-700' : ''}`}>{euroText(z.cashflowMonat)}</td>
                  <td>{prozentText(z.ekRendite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {em.raster.length > 0 ? (
            <>
              <h4 className="mb-2 mt-4 text-sm font-semibold text-slate-700">Cashflow im Monat nach {pachtWort} und Zins</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-3">{pachtWort} / Zins</th>
                    {em.zins.map((z) => <th key={z.aenderung} className="pr-3">{prozentText(z.zinsProzent, 2)}{z.aenderung === 0 ? ' (angesetzt)' : ''}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {em.miete.map((m) => (
                    <tr key={m.aenderung} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3">{m.aenderung === 0 ? 'wie angesetzt' : `${vorzeichen(m.aenderung, String(m.aenderung))} %`}</td>
                      {em.zins.map((z) => {
                        const wert = em.raster.find((x) => x.mieteAenderung === m.aenderung && x.zinsAenderung === z.aenderung)?.cashflowMonat ?? null
                        return <td key={z.aenderung} className={`pr-3 ${wert !== null && wert < 0 ? 'text-rose-700' : ''} ${m.aenderung === 0 && z.aenderung === 0 ? 'font-medium' : ''}`}>{euroText(wert)}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Zins ±1 Punkt erscheint, sobald mit Darlehen gerechnet wird (Eigenkapital, Zins oder Tilgung eintragen).</p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Globe size={14} /> Vergleich vor Ort</h4>
          {markt?.status === 'fertig' && (markt.mieteJeQmVon || markt.mieteJeQmBis) && !form.miete.trim() && (
            <SecondaryButton onClick={marktmieteUebernehmen}>Marktmiete als Annahme einsetzen</SecondaryButton>
          )}
        </div>
        {!markt && <p className="text-sm text-slate-500">Noch nicht geprüft. „Vergleich vor Ort prüfen“ sucht im Netz nach dem Preis je m² für diese Objektart am Ort und der üblichen Miete bzw. Pacht, mit Quellen (dauert ein bis zwei Minuten).</p>}
        {(marktLaeuft || vorgang === 'markt') && <p className="mb-2 text-sm text-slate-500"><Loader2 size={14} className="mr-1 inline animate-spin" /> Die Recherche läuft (etwa ein bis zwei Minuten) …</p>}
        {markt?.status === 'fehler' && <p className="text-sm text-rose-700">Die Recherche ist gescheitert: {markt.fehler}</p>}
        {markt?.status === 'fertig' && (
          <div className="space-y-2 text-sm text-slate-700">
            {markt.fehler && <p className="text-xs text-amber-700">{markt.fehler} Angezeigt wird das frühere Ergebnis.</p>}
            <p className="text-xs text-slate-500">
              Recherche vom {markt.stand ? fmtDate(markt.stand) : '–'}{markt.ort ? ` für ${markt.ort}` : ''}{markt.gestartetVon ? `, gestartet von ${markt.gestartetVon}` : ''}.
              {marktAlter !== null && marktAlter > 30 ? ' Älter als ein Monat — besser neu prüfen.' : ''}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Kachel titel="Preise je m² vor Ort" wert={markt.preisJeQmVon || markt.preisJeQmBis ? `${euroText(markt.preisJeQmVon)} – ${euroText(markt.preisJeQmBis)}` : 'nicht gefunden'} zusatz={markt.preisBezug} />
              <Kachel titel="Miete/Pacht je m² im Monat" wert={markt.mieteJeQmVon || markt.mieteJeQmBis ? `${euroText(markt.mieteJeQmVon, 2)} – ${euroText(markt.mieteJeQmBis, 2)}` : 'nicht gefunden'} zusatz={markt.mieteBezug} />
              <Kachel titel="Übliche Rendite / Faktor" wert={markt.renditeVon || markt.renditeBis ? `${prozentText(markt.renditeVon, 1)} – ${prozentText(markt.renditeBis, 1)}` : markt.faktorVon || markt.faktorBis ? `${zahlText(markt.faktorVon, 1)} – ${zahlText(markt.faktorBis, 1)}-fach` : 'nicht gefunden'} />
            </div>
            {vgl.preis && <p>Eigener Kaufpreis je m² {euroText(vgl.preis.eigen)}: <strong>{urteilText(vgl.preis.urteil)}</strong> ({vorzeichen(vgl.preis.abweichungProzent, prozentText(vgl.preis.abweichungProzent, 0))} zum Mittel von {euroText(vgl.preis.mittel)}).</p>}
            {vgl.miete && <p>Angesetzte {pachtWort} {euroText(vgl.miete.eigen, 2)}/m²: <strong>{urteilText(vgl.miete.urteil)}</strong> im Vergleich zur Marktmiete.</p>}
            {markt.einschaetzung && <p className="text-slate-600">{markt.einschaetzung}</p>}
            {(markt.hinweise ?? []).length > 0 && <ul className="list-disc pl-5 text-xs text-slate-500">{markt.hinweise!.map((h) => <li key={h}>{h}</li>)}</ul>}
            {(markt.quellen ?? []).length > 0 && (
              <div className="text-xs">
                <div className="mb-1 font-medium text-slate-600">Quellen</div>
                <ul className="space-y-0.5">
                  {markt.quellen!.map((q) => (
                    <li key={q.url}>
                      <a href={q.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline">{q.titel} <ExternalLink size={11} /></a>
                      {q.stand && <span className="text-slate-400"> · Stand {q.stand}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h4 className="mb-2 text-sm font-semibold text-slate-700">Prüfsteine vor dem Kauf</h4>
        <ul className="space-y-2">
          {PRUEFSTEINE.map((p) => {
            const s = stand?.pruefsteine?.[p.id]
            return (
              <li key={p.id} className="rounded-lg border border-slate-100 px-3 py-2">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={!!s?.erledigt} disabled={vorgang === 'pruefstein'} onChange={(e) => pruefsteinSetzen(p.id, e.target.checked)} />
                  <span>
                    <span className={`font-medium ${s?.erledigt ? 'text-emerald-700' : 'text-slate-800'}`}>{p.titel}</span>
                    <span className="block text-xs text-slate-500">{p.hinweis}</span>
                    {s?.erledigt && s.von && <span className="block text-[11px] text-slate-400">geklärt{s.am ? ` am ${fmtDate(s.am)}` : ''} von {s.von}</span>}
                  </span>
                </label>
                <input
                  className={`${inputClass} mt-1.5 text-xs`}
                  placeholder="Notiz (z. B. „Baugenehmigung 2005 liegt vor“)"
                  defaultValue={s?.notiz ?? ''}
                  key={`${p.id}-${s?.notiz ?? ''}`}
                  onBlur={(e) => {
                    const notiz = e.target.value.trim()
                    if (notiz !== (s?.notiz ?? '')) void pruefsteinSetzen(p.id, !!s?.erledigt, notiz)
                  }}
                />
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
