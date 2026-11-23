// Wochenbesprechung (Projekt-Checkliste Stufe 3, Hasan und Eray, 20.11.2026): alle laufenden Fälle auf
// fünf gemeinsamen Stufen nebeneinander, Kennzahlen, was diese Woche fällig ist (je Person) und was sich
// seit Montag bewegt hat. Fälle lassen sich direkt verschieben (setzt den Stand der Akte; die Datenbank
// legt dann die Wiedervorlagen des neuen Stands an).
// Seit 22.11.2026: Vorschläge für Chance, erwarteten Umsatz und Monat je Fall (kunden.chance_vorschlag,
// Regeln in supabase/functions/_shared/chanceKern.ts) grau an der Karte, mit „übernehmen“ je Fall und
// „alle übernehmen“ je Stufe. Übernehmen bestätigt die Chance und trägt den Umsatz ein (auftrag_chance) —
// damit zählt der Fall in der Umsatzvorschau.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Presentation, Sparkles, Undo2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, inputClass } from '../../components/ui'
import { aktePfad, akteName, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { supabase } from '../../lib/supabaseClient'
import { erledigeWiedervorlage } from '../../lib/wiedervorlagen'
import { addDays, fmtEURCent, today, uid } from '../../lib/dates'

/** Kalendertag eines Zeitstempels in Ortszeit (ein UTC-Zeitstempel kurz nach Mitternacht gehört sonst zum Vortag). */
function lokalerTag(iso: string): string {
  if (iso.length <= 10) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
import { AMPEL_RANG, STUFEN, STUFE_ZURUECK, gewichtet, standVon, stufeVon, wochenEnde, zielStatus } from '../../lib/checkliste'
import { AMPEL_PUNKT, kurzDatum, useChecklisteDaten, type Zeile } from '../checkliste/checklisteDaten'
import { ChecklisteBearbeiten } from '../checkliste/Checkliste'
import { berechneChanceVorschlaege, chanceVon, erwarteterUmsatz, ladeChanceVorschlaege, uebernahmePatch, vorschlagOffen, type ChanceVorschlag } from '../../lib/chanceVorschlag'
import { monatKurz } from '../../../supabase/functions/_shared/umsatzKern.ts'
import type { AmpelFarbe, Kunde, KundeBereich } from '../../types'

const RAND: Record<AmpelFarbe, string> = { rot: 'border-l-rose-500', gelb: 'border-l-amber-400', gruen: 'border-l-emerald-500' }
const SPALTEN = [...STUFEN, 'Zurückgestellt']

function kalenderwoche(iso: string): number {
  const d = new Date(iso + 'T00:00:00')
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const tag = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - tag)
  const jahresAnfang = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - jahresAnfang.getTime()) / 86_400_000 + 1) / 7)
}

type Faellig = { schluessel: string; zeile: Zeile; titel: string; datum: string; automatisch: boolean; wvId?: string; person: string }
type Bewegung = { schluessel: string; datum: string; text: string; zeile?: Zeile }

export function Wochenbesprechung() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const nutzer = useKvNutzer()
  const { oeffentlicheKundenBereiche } = useBereichsRechte()
  const { alle, wvListe, wvJeKunde, wvLaden, kvs, fehler, heute } = useChecklisteDaten()
  const [wer, setWer] = useState('')
  const [bereichFilter, setBereichFilter] = useState('')
  const [offen, setOffen] = useState<{ kundeId: string; bereich: KundeBereich } | null>(null)
  const [meldung, setMeldung] = useState<{ text: string; rueck?: () => void } | null>(null)
  const [erledigtDieseWoche, setErledigtDieseWoche] = useState<{ id: string; kunde_id: string; titel: string; erledigt_am: string; erledigt_von: string | null; erledigt_grund: string | null }[]>([])
  const [aktionLaeuft, setAktionLaeuft] = useState(false)
  const [vorschlaege, setVorschlaege] = useState<Map<string, ChanceVorschlag>>(new Map())
  const [vorschlagFehler, setVorschlagFehler] = useState('')
  const [rechnet, setRechnet] = useState(false)
  const [mitNeuanfragen, setMitNeuanfragen] = useState(false)

  useEffect(() => {
    ladeChanceVorschlaege().then(setVorschlaege).catch((e) => setVorschlagFehler(e instanceof Error ? e.message : 'Vorschläge ließen sich nicht laden.'))
  }, [])

  const montag = addDays(wochenEnde(heute), -6)
  const sonntag = wochenEnde(heute)

  useEffect(() => {
    supabase
      ?.from('wiedervorlagen')
      .select('id, kunde_id, titel, erledigt_am, erledigt_von, erledigt_grund')
      // Montag 0 Uhr in deutscher Zeit (nicht UTC) — sonst fehlte, was Montag vor 1 bzw. 2 Uhr erledigt wurde.
      .gte('erledigt_am', new Date(montag + 'T00:00:00').toISOString())
      .order('erledigt_am', { ascending: false })
      .limit(200)
      .then(({ data }) => setErledigtDieseWoche((data ?? []) as typeof erledigtDieseWoche))
  }, [montag, wvListe])

  // Laufende Fälle: wie in der Checkliste ohne unbearbeitete Neuanfragen, ohne abgeschlossene/verlorene.
  const faelle = useMemo(
    () =>
      alle
        .filter((z) => stufeVon(z.bereich, z.kunde.status) !== undefined)
        .filter((z) => mitNeuanfragen || !z.stand.neuanfrage || (wvJeKunde.get(z.kunde.id)?.length ?? 0) > 0)
        .filter((z) => !bereichFilter || z.bereich === bereichFilter)
        .filter((z) => !wer || z.kunde.verantwortlich === wer || (wvJeKunde.get(z.kunde.id) ?? []).some((w) => w.verantwortlich === wer)),
    [alle, wvJeKunde, bereichFilter, wer, mitNeuanfragen],
  )
  const neuanfragenOhneWv = useMemo(() => alle.filter((z) => z.stand.neuanfrage && !(wvJeKunde.get(z.kunde.id)?.length)).length, [alle, wvJeKunde])
  const verantwortliche = useMemo(() => [...new Set(alle.map((z) => z.kunde.verantwortlich).filter(Boolean))].sort(), [alle])
  const zeileVon = useMemo(() => new Map(alle.map((z) => [z.kunde.id, z])), [alle])

  // Umsatz je Fall: Kostenvoranschläge mit Betrag gehen vor, sonst die übernommene Schätzung.
  const umsatzVonZeile = (z: Zeile) => erwarteterUmsatz(z.kunde, z.umsatz.netto)
  const summe = faelle.reduce((s, z) => s + umsatzVonZeile(z).netto, 0)
  const summeGewichtet = faelle.reduce((s, z) => s + gewichtet(umsatzVonZeile(z).netto, chanceVon(z.kunde)?.prozent), 0)
  const offenerVorschlag = (z: Zeile) => (vorschlagOffen(z.kunde, vorschlaege.get(z.kunde.id), z.umsatz.netto) ? vorschlaege.get(z.kunde.id) : undefined)
  const anzahlOffeneVorschlaege = faelle.filter((z) => offenerVorschlag(z)).length
  const ohneChance = faelle.filter((z) => !chanceVon(z.kunde)).length
  const anzahl = (f: AmpelFarbe) => faelle.filter((z) => z.ampel.farbe === f).length

  // Fällig bis Sonntag: Einträge der Tabelle wiedervorlagen und das Follow-up der Akte.
  const faellig: Faellig[] = useMemo(() => {
    const liste: Faellig[] = []
    const imUmfang = new Set(faelle.map((z) => z.kunde.id))
    for (const w of wvListe) {
      const z = zeileVon.get(w.kundeId)
      if (!z || !imUmfang.has(w.kundeId) || w.faellig > sonntag) continue
      const person = w.verantwortlich || z.kunde.verantwortlich || 'Niemand zugeordnet'
      if (wer && person !== wer) continue
      liste.push({ schluessel: `wv:${w.id}`, zeile: z, titel: w.titel, datum: w.faellig, automatisch: w.quelle === 'regel', wvId: w.id, person })
    }
    for (const z of faelle) {
      const fu = z.kunde.followUp
      if (!fu || fu.done || !/^\d{4}-\d{2}-\d{2}$/.test(fu.date ?? '') || fu.date > sonntag) continue
      const person = z.kunde.verantwortlich || 'Niemand zugeordnet'
      if (wer && person !== wer) continue
      liste.push({ schluessel: `fu:${z.kunde.id}`, zeile: z, titel: fu.note?.trim() || 'Follow-up', datum: fu.date, automatisch: false, person })
    }
    return liste.sort((a, b) => a.person.localeCompare(b.person) || a.datum.localeCompare(b.datum))
  }, [wvListe, faelle, zeileVon, sonntag, wer])
  const faelligJePerson = useMemo(() => {
    const m = new Map<string, Faellig[]>()
    for (const f of faellig) m.set(f.person, [...(m.get(f.person) ?? []), f])
    return [...m.entries()]
  }, [faellig])
  const ueberfaellig = faellig.filter((f) => f.datum < heute).length

  // Seit Montag bewegt: Stand-Änderungen (Verlauf der Akte), erledigte Wiedervorlagen, neue Kostenvoranschläge.
  const bewegungen: Bewegung[] = useMemo(() => {
    const liste: Bewegung[] = []
    for (const z of faelle) {
      for (const a of z.kunde.activities ?? []) {
        const d = (a.date ?? '').slice(0, 10)
        if (d < montag || !/^(Status|Stand)\b/.test(a.text ?? '')) continue
        liste.push({ schluessel: `a:${a.id}`, datum: d, text: `${akteName(z.kunde)}: ${a.text.replace(/ am \d{4}-\d{2}-\d{2}/, '')}`, zeile: z })
      }
    }
    for (const w of erledigtDieseWoche) {
      const z = zeileVon.get(w.kunde_id)
      if (!z || (bereichFilter && z.bereich !== bereichFilter)) continue
      const wie = w.erledigt_grund ? `von selbst erledigt (${w.erledigt_grund})` : `erledigt${w.erledigt_von ? ` von ${w.erledigt_von}` : ''}`
      liste.push({ schluessel: `w:${w.id}`, datum: lokalerTag(w.erledigt_am), text: `${akteName(z.kunde)}: „${w.titel}“ ${wie}`, zeile: z })
    }
    for (const kv of kvs) {
      if (lokalerTag(kv.erstelltAm ?? '') < montag) continue
      const z = kv.kundeId ? zeileVon.get(kv.kundeId) : undefined
      if (bereichFilter && z?.bereich !== bereichFilter) continue
      const betrag = kv.betrag ? ` über ${fmtEURCent(kv.betrag)}` : ''
      liste.push({ schluessel: `k:${kv.id}`, datum: lokalerTag(kv.erstelltAm), text: `${z ? akteName(z.kunde) : kv.name}: Kostenvoranschlag${betrag} angelegt`, zeile: z })
    }
    return liste.sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 40)
  }, [faelle, erledigtDieseWoche, kvs, zeileVon, montag, bereichFilter])

  function setzeStand(z: Zeile, stufe: number) {
    const neu = zielStatus(z.bereich, stufe)
    if (!neu || neu === z.kunde.status) return
    const k = z.kunde
    const alt = k.status
    const eintrag = (von: string, nach: string) => ({
      id: uid('act'),
      date: today(),
      text: `Status: ${standVon(z.bereich, von).label} → ${standVon(z.bereich, nach).label} (in der Wochenbesprechung) durch ${nutzer.name}`,
      user: nutzer.name,
    })
    const patch = (von: string, nach: string, aktivitaeten: Kunde['activities']): Partial<Kunde> => ({
      status: nach,
      letzteAktivitaet: today(),
      activities: [eintrag(von, nach), ...aktivitaeten],
    })
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: z.bereich, id: k.id, patch: patch(alt, neu, k.activities ?? []) })
    // Die Datenbank legt die Wiedervorlagen des neuen Stands an — kurz danach neu laden.
    window.setTimeout(wvLaden, 2500)
    setMeldung({
      text: `${akteName(k)} steht jetzt auf „${standVon(z.bereich, neu).label}“.`,
      rueck: () => {
        dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: z.bereich, id: k.id, patch: patch(neu, alt, k.activities ?? []) })
        window.setTimeout(wvLaden, 2500)
        setMeldung(null)
      },
    })
  }

  async function erledige(f: Faellig) {
    setAktionLaeuft(true)
    try {
      if (f.wvId) {
        await erledigeWiedervorlage(f.wvId, nutzer.name)
        await wvLaden()
      } else {
        const fu = f.zeile.kunde.followUp
        dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: f.zeile.bereich, id: f.zeile.kunde.id, patch: { followUp: { ...fu, done: true } } })
      }
      setMeldung({ text: `„${f.titel}“ erledigt.` })
    } catch (e) {
      setMeldung({ text: e instanceof Error ? e.message : 'Das hat nicht geklappt.' })
    } finally {
      setAktionLaeuft(false)
    }
  }

  /** Vorschläge übernehmen (einer oder alle einer Stufe), mit Rückgängig. */
  function uebernimm(zeilen: Zeile[], stufenTitel?: string) {
    const liste = zeilen.flatMap((z) => {
      const v = offenerVorschlag(z)
      return v ? [{ z, v }] : []
    })
    if (!liste.length) return
    if (liste.length > 1 && !window.confirm(`${liste.length} Vorschläge${stufenTitel ? ` der Stufe „${stufenTitel}“` : ''} übernehmen? Chance und Umsatz gelten danach als bestätigt und zählen in der Umsatzvorschau.`)) return
    const vorher = liste.map(({ z }) => ({ z, alt: z.kunde.auftragChance }))
    for (const { z, v } of liste) dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: z.bereich, id: z.kunde.id, patch: uebernahmePatch(z.kunde, v, nutzer.name) })
    const eins = liste[0]
    setMeldung({
      text: liste.length === 1
        ? `Für ${akteName(eins.z.kunde)} übernommen: ${eins.v.chanceBestaetigt ? '' : `${eins.v.prozent} %, `}${eins.v.umsatzNetto ? fmtEURCent(eins.v.umsatzNetto) : 'ohne Umsatz'}${eins.v.monat ? `, ${monatKurz(eins.v.monat)}` : ''}.`
        : `${liste.length} Vorschläge übernommen.`,
      rueck: () => {
        for (const { z, alt } of vorher) dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: z.bereich, id: z.kunde.id, patch: { auftragChance: alt } })
        setMeldung(null)
      },
    })
  }

  async function vorschlaegeBerechnen() {
    setRechnet(true)
    setVorschlagFehler('')
    try {
      const e = await berechneChanceVorschlaege()
      setVorschlaege(await ladeChanceVorschlaege())
      setMeldung({ text: e.text || `${e.berechnet} Vorschläge berechnet.` })
    } catch (e) {
      setVorschlagFehler(e instanceof Error ? e.message : 'Die Vorschläge ließen sich nicht berechnen.')
    } finally {
      setRechnet(false)
    }
  }

  const offeneZeile = offen ? alle.find((z) => z.kunde.id === offen.kundeId && z.bereich === offen.bereich) : undefined
  const kw = kalenderwoche(heute)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Presentation size={20} className="text-slate-400" /> Wochenbesprechung · KW {kw}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {kurzDatum(montag)} bis {kurzDatum(sonntag)} · alle laufenden Fälle deiner Bereiche, in fünf Stufen. Ein Klick auf einen Namen öffnet die Checkliste des Falls.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={wer} onChange={(e) => setWer(e.target.value)} className={inputClass} aria-label="Person">
            <option value="">Alle Personen</option>
            {verantwortliche.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={bereichFilter} onChange={(e) => setBereichFilter(e.target.value)} className={inputClass} aria-label="Bereich">
            <option value="">Alle Bereiche</option>
            {oeffentlicheKundenBereiche.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
      </div>

      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      {meldung && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <span>{meldung.text}</span>
          <span className="flex gap-3">
            {meldung.rueck && (
              <button onClick={meldung.rueck} className="inline-flex items-center gap-1 font-medium hover:underline">
                <Undo2 size={14} /> Rückgängig
              </button>
            )}
            <button onClick={() => setMeldung(null)} className="text-sky-600 hover:underline">Schließen</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Laufende Fälle</p>
          <p className="text-lg font-semibold text-slate-800">{faelle.length}</p>
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${AMPEL_PUNKT.rot}`} />{anzahl('rot')}
            <span className={`h-2 w-2 rounded-full ${AMPEL_PUNKT.gelb}`} />{anzahl('gelb')}
            <span className={`h-2 w-2 rounded-full ${AMPEL_PUNKT.gruen}`} />{anzahl('gruen')}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Erwarteter Umsatz netto</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">{fmtEURCent(summe)}</p>
          <p className="text-xs text-slate-400">Kostenvoranschläge, sonst übernommene Schätzung</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Gewichtet nach Chance</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">{fmtEURCent(summeGewichtet)}</p>
          <p className="text-xs text-slate-400">realistisch zu erwarten</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Bis Sonntag fällig</p>
          <p className="text-lg font-semibold text-slate-800">{faellig.length}</p>
          <p className={`text-xs ${ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-400'}`}>davon {ueberfaellig} überfällig</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <p className="text-slate-600">
          <Sparkles size={14} className="mr-1 inline text-slate-400" />
          Chance und Umsatz: {anzahlOffeneVorschlaege} {anzahlOffeneVorschlaege === 1 ? 'Vorschlag' : 'Vorschläge'} zum Übernehmen
          {ohneChance > 0 ? ` · ${ohneChance} ${ohneChance === 1 ? 'Fall' : 'Fälle'} ohne Chance` : ''}
          <span className="block text-xs text-slate-400">Vorschläge stehen grau an den Karten. Übernehmen bestätigt Chance und Umsatz; erst dann zählt der Fall in der Umsatzvorschau.</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {neuanfragenOhneWv > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={mitNeuanfragen} onChange={(e) => setMitNeuanfragen(e.target.checked)} />
              Neuanfragen zeigen ({neuanfragenOhneWv})
            </label>
          )}
          {!nutzer.nurLesen && (
            <button
              onClick={vorschlaegeBerechnen}
              disabled={rechnet}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Sparkles size={14} /> {rechnet ? 'Wird berechnet … (bis zu einer Minute)' : 'Vorschläge neu berechnen'}
            </button>
          )}
        </div>
        {vorschlagFehler && <p className="w-full text-xs text-rose-600">{vorschlagFehler}</p>}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1200px] grid-cols-6 gap-3">
          {SPALTEN.map((titel, stufe) => {
            const karten = faelle
              .filter((z) => (stufeVon(z.bereich, z.kunde.status) ?? -1) === stufe)
              .sort((a, b) => AMPEL_RANG[a.ampel.farbe] - AMPEL_RANG[b.ampel.farbe] || (a.wv[0]?.datum ?? '9').localeCompare(b.wv[0]?.datum ?? '9'))
            const summeSpalte = karten.reduce((s, z) => s + umsatzVonZeile(z).netto, 0)
            const mitVorschlag = karten.filter((z) => offenerVorschlag(z))
            return (
              <div key={titel} className={`flex flex-col gap-2 rounded-lg p-2 ${stufe === STUFE_ZURUECK ? 'bg-slate-50' : 'bg-slate-100'}`}>
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold text-slate-700">{titel}</h2>
                  <span className="text-xs text-slate-400">{karten.length}</span>
                </div>
                {summeSpalte > 0 && <p className="px-1 text-[11px] tabular-nums text-slate-400">{fmtEURCent(summeSpalte)}</p>}
                {mitVorschlag.length > 0 && !nutzer.nurLesen && (
                  <button onClick={() => uebernimm(mitVorschlag, titel)} className="mx-1 rounded border border-dashed border-slate-300 bg-white/60 px-1.5 py-0.5 text-left text-[11px] text-slate-500 hover:border-sky-500 hover:text-sky-700">
                    {mitVorschlag.length === 1 ? '1 Vorschlag übernehmen' : `alle ${mitVorschlag.length} Vorschläge dieser Stufe übernehmen`}
                  </button>
                )}
                {karten.map((z) => {
                  const k = z.kunde
                  const u = umsatzVonZeile(z)
                  const c = chanceVon(k)
                  const v = offenerVorschlag(z)
                  return (
                    <div key={`${z.bereich}-${k.id}`} className={`space-y-1.5 rounded-md border border-l-4 border-slate-200 bg-white p-2.5 text-xs ${RAND[z.ampel.farbe]}`}>
                      <div>
                        <button onClick={() => setOffen({ kundeId: k.id, bereich: z.bereich })} className="text-left text-sm font-medium text-slate-800 hover:text-sky-700 hover:underline">
                          {k.ansprechpartner || k.firma || 'Ohne Namen'}
                        </button>
                        <p className="text-[11px] text-slate-400">{z.bereichLabel}{k.verantwortlich ? ` · ${k.verantwortlich}` : ''}</p>
                      </div>
                      <p className="text-slate-500">{z.stand.label}</p>
                      {z.ampel.gruende[0] && <p className={z.ampel.farbe === 'rot' ? 'text-rose-600' : 'text-slate-500'}>{z.ampel.gruende[0]}</p>}
                      {(z.umsatz.anzahl > 0 || c) && (
                        <p className="tabular-nums text-slate-600">
                          {u.netto > 0 ? `${fmtEURCent(u.netto)}${u.geschaetzt ? ' (geschätzt)' : ''}` : z.umsatz.anzahl > 0 ? fmtEURCent(0) : 'ohne Umsatz'}
                          {c && <span className={c.bestaetigt ? '' : 'italic text-slate-400'}> · {c.prozent} %</span>}
                          {u.geschaetzt && c?.monat && <span className="text-slate-400"> · {monatKurz(c.monat)}</span>}
                        </p>
                      )}
                      {v && (
                        <div className="flex items-center justify-between gap-1 rounded border border-dashed border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-400" title={v.begruendung}>
                          <span className="italic">
                            Vorschlag: {v.chanceBestaetigt ? '' : `${v.prozent} % · `}{v.umsatzNetto ? fmtEURCent(v.umsatzNetto) : 'ohne Umsatz'}{v.monat ? ` · ${monatKurz(v.monat)}` : ''}
                          </span>
                          {!nutzer.nurLesen && (
                            <button onClick={() => uebernimm([z])} className="shrink-0 font-medium text-slate-500 hover:text-sky-700 hover:underline" aria-label={`Vorschlag für ${akteName(k)} übernehmen`}>
                              übernehmen
                            </button>
                          )}
                        </div>
                      )}
                      <label className="flex items-center gap-1 text-[11px] text-slate-400">
                        verschieben
                        <select
                          value={stufe}
                          disabled={nutzer.nurLesen}
                          onChange={(e) => setzeStand(z, Number(e.target.value))}
                          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700"
                          aria-label={`${k.ansprechpartner || k.firma} in eine andere Stufe verschieben`}
                        >
                          {SPALTEN.map((t, i) => {
                            const ziel = i === STUFE_ZURUECK ? undefined : zielStatus(z.bereich, i)
                            return (
                              <option key={t} value={i} disabled={i !== stufe && !ziel}>
                                {t}{i !== stufe && ziel ? ` (${standVon(z.bereich, ziel).label})` : ''}
                              </option>
                            )
                          })}
                        </select>
                      </label>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Bis Sonntag fällig, je Person</h2>
          {faelligJePerson.length === 0 ? (
            <p className="text-sm text-slate-400">Nichts fällig.</p>
          ) : (
            <div className="space-y-4">
              {faelligJePerson.map(([person, liste]) => (
                <div key={person}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{person} · {liste.length}</p>
                  <ul className="divide-y divide-slate-100">
                    {liste.map((f) => (
                      <li key={f.schluessel} className="flex items-start gap-2 py-1.5 text-sm">
                        <button
                          disabled={aktionLaeuft || nutzer.nurLesen}
                          onClick={() => erledige(f)}
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 text-slate-400 hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                          title="Erledigt"
                          aria-label={`${f.titel} erledigt`}
                        >
                          <Check size={13} />
                        </button>
                        <span className={`w-16 shrink-0 tabular-nums ${f.datum < heute ? 'font-medium text-rose-600' : 'text-slate-500'}`}>{kurzDatum(f.datum)}</span>
                        <span className="min-w-0 flex-1">
                          <button onClick={() => navigate(aktePfad(f.zeile.bereich, f.zeile.kunde))} className="font-medium text-slate-700 hover:underline">{akteName(f.zeile.kunde)}</button>
                          <span className="text-slate-600">: {f.titel}</span>
                          {f.automatisch && <span className="ml-1 text-[10px] text-sky-600">automatisch</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Seit Montag bewegt</h2>
          {bewegungen.length === 0 ? (
            <p className="text-sm text-slate-400">Diese Woche noch keine Änderungen am Stand, keine erledigten Wiedervorlagen und keine neuen Kostenvoranschläge.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {bewegungen.map((b) => (
                <li key={b.schluessel} className="flex gap-2">
                  <span className="w-16 shrink-0 tabular-nums text-slate-400">{kurzDatum(b.datum)}</span>
                  <span className="text-slate-700">{b.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {offeneZeile && (
        <ChecklisteBearbeiten
          key={`${offeneZeile.bereich}-${offeneZeile.kunde.id}`}
          zeile={offeneZeile}
          nurLesen={nutzer.nurLesen}
          nutzerName={nutzer.name}
          onClose={() => setOffen(null)}
          onAkte={() => navigate(aktePfad(offeneZeile.bereich, offeneZeile.kunde))}
          onSpeichern={(patch) => {
            dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: offeneZeile.bereich, id: offeneZeile.kunde.id, patch })
            setOffen(null)
          }}
          onWvAenderung={wvLaden}
          alleAkten={alle}
        />
      )}
    </div>
  )
}
