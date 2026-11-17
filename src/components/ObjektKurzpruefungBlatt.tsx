import { useState } from 'react'
import { Check, Printer } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { druckeBlatt } from '../lib/blattDruck'
import { fmtDate, fmtEUR, today } from '../lib/dates'
import type { Objekt, ObjektKurzpruefung } from '../types'

// Die Zeilen der Papiervorlage; jede hat die drei Spalten „Ist", „Marktwert" und „unser Ergebnis".
const ZEILEN: { id: string; label: string }[] = [
  { id: 'preis', label: 'Preis' },
  { id: 'preisProQm', label: 'Preis pro m²' },
  { id: 'lageMikro', label: 'Lage – unmittelbare Umgebung' },
  { id: 'lageMakro', label: 'Lage – Stadt/Region (A, B, C, D)' },
  { id: 'baujahr', label: 'Baujahr' },
  { id: 'zustand', label: 'Zustand' },
  { id: 'sanierung', label: 'Anstehende Sanierung' },
  { id: 'mieteProQm', label: 'Miete pro m²' },
  { id: 'vermietungsstand', label: 'Vermietungsstand' },
  { id: 'rendite', label: 'Rendite' },
  { id: 'kaufpreisfaktor', label: 'Kaufpreisfaktor' },
  { id: 'vermarktbarkeit', label: 'Vermarktbarkeit' },
  { id: 'sonstiges', label: 'Sonstiges' },
  { id: 'investorensicht', label: 'Investorensicht' },
]

function leer(o: Objekt): ObjektKurzpruefung {
  return {
    datum: today(),
    zeilen: { preis: { ist: o.kaufpreis > 0 ? fmtEUR(o.kaufpreis) : '', marktwert: '', ergebnis: '' } },
    provisionProzent: '',
    provisionBetrag: '',
    verkaeuferBekannt: '',
    direktesMandat: '',
    offeneFragen: '',
    gruendeDagegen: ['', '', '', ''],
    gruendeDafuer: ['', '', '', ''],
    prioBegruendung: '',
    zeiterfordernis: '',
    naechsteSchritte: ['', '', '', ''],
  }
}

/** Vorab-Kurzprüfung eines Objekts: Ist-Werte gegen Marktwert und eigene Einschätzung, Provision, Mandat,
 *  Gründe für und gegen die Annahme, Einstufung A/B/C, Zeitaufwand und nächste Schritte. */
export function ObjektKurzpruefungBlatt({ objekt }: { objekt: Objekt }) {
  const { dispatch } = useApp()
  const [d, setD] = useState<ObjektKurzpruefung>(objekt.kurzpruefung ?? leer(objekt))
  const [gespeichert, setGespeichert] = useState(false)
  const geaendert = JSON.stringify(d) !== JSON.stringify(objekt.kurzpruefung ?? leer(objekt))

  function setze(aenderung: Partial<ObjektKurzpruefung>) {
    setD((alt) => ({ ...alt, ...aenderung }))
    setGespeichert(false)
  }
  function setzeZelle(id: string, spalte: 'ist' | 'marktwert' | 'ergebnis', wert: string) {
    const alt = d.zeilen[id] ?? { ist: '', marktwert: '', ergebnis: '' }
    setze({ zeilen: { ...d.zeilen, [id]: { ...alt, [spalte]: wert } } })
  }
  function setzeListe(feld: 'gruendeDagegen' | 'gruendeDafuer' | 'naechsteSchritte', i: number, wert: string) {
    setze({ [feld]: d[feld].map((x, j) => (j === i ? wert : x)) })
  }

  function speichern() {
    dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { kurzpruefung: d } })
    setGespeichert(true)
  }

  function drucken() {
    const liste = (l: string[]) => l.map((x, i) => `${i + 1}. ${x}`).join('\n')
    druckeBlatt(`Vorab-Kurzprüfung – ${objekt.bezeichnung}`, `Datum ${d.datum ? fmtDate(d.datum) : '–'} · Ergebnis: Prio ${d.prio ?? '–'}`, [
      { titel: 'Objekt', tabelle: { kopf: ['', 'Ist', 'Marktwert', 'Unser Ergebnis'], zeilen: ZEILEN.map((z) => [z.label, d.zeilen[z.id]?.ist ?? '', d.zeilen[z.id]?.marktwert ?? '', d.zeilen[z.id]?.ergebnis ?? '']) } },
      {
        titel: 'Auftrag',
        zeilen: [
          ['Provision', [d.provisionProzent && `${d.provisionProzent} %`, d.provisionBetrag && `${d.provisionBetrag} €`].filter(Boolean).join(' · ')],
          ['Verkäufer bekannt', d.verkaeuferBekannt],
          ['Direktes Mandat', d.direktesMandat],
          ['Offene Fragen', d.offeneFragen],
        ],
      },
      { titel: 'Gründe gegen die Auftragsannahme', zeilen: [['', liste(d.gruendeDagegen)]] },
      { titel: 'Gründe dafür', zeilen: [['', liste(d.gruendeDafuer)]] },
      { titel: 'Ergebnis', zeilen: [['Prio', d.prio ?? '–'], ['Warum diese Einstufung', d.prioBegruendung], ['Zeiterfordernis', d.zeiterfordernis]] },
      { titel: 'Nächste Schritte', zeilen: [['', liste(d.naechsteSchritte)]] },
    ])
  }

  const zelle = 'w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-accent-400'

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Vorab-Kurzprüfung – {objekt.bezeichnung}</h3>
            <p className="text-xs text-slate-400">Lohnt sich der Auftrag? Ist-Werte, Marktwert und eigene Einschätzung nebeneinander.</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
            Datum
            <input type="date" className={`${inputClass} w-auto`} value={d.datum ?? ''} onChange={(e) => setze({ datum: e.target.value || undefined })} />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="w-1/4 pb-2"></th>
                <th className="pb-2 pl-2">Ist</th>
                <th className="pb-2 pl-2">Marktwert</th>
                <th className="pb-2 pl-2">Unser Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {ZEILEN.map((z) => (
                <tr key={z.id}>
                  <td className="py-1 pr-2 text-slate-600">{z.label}</td>
                  {(['ist', 'marktwert', 'ergebnis'] as const).map((s) => (
                    <td key={s} className="py-1 pl-2">
                      <input className={zelle} value={d.zeilen[z.id]?.[s] ?? ''} onChange={(e) => setzeZelle(z.id, s, e.target.value)} aria-label={`${z.label} – ${s === 'ist' ? 'Ist' : s === 'marktwert' ? 'Marktwert' : 'unser Ergebnis'}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Auftrag</h4>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Provision in %">
              <input className={inputClass} value={d.provisionProzent} onChange={(e) => setze({ provisionProzent: e.target.value })} placeholder="z. B. 3,57" />
            </Field>
            <Field label="Provision als Betrag (€)">
              <input className={inputClass} value={d.provisionBetrag} onChange={(e) => setze({ provisionBetrag: e.target.value })} />
            </Field>
            <Field label="Verkäufer bekannt?">
              <input className={inputClass} value={d.verkaeuferBekannt} onChange={(e) => setze({ verkaeuferBekannt: e.target.value })} placeholder="ja / nein / über wen" />
            </Field>
            <Field label="Direktes Mandat?">
              <input className={inputClass} value={d.direktesMandat} onChange={(e) => setze({ direktesMandat: e.target.value })} placeholder="ja / nein" />
            </Field>
          </div>
          <Field label="Offene Fragen">
            <textarea className={`${inputClass} min-h-20`} value={d.offeneFragen} onChange={(e) => setze({ offeneFragen: e.target.value })} />
          </Field>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Ergebnis</h4>
            <div className="flex items-center gap-1" role="group" aria-label="Einstufung">
              <span className="mr-1 text-xs font-medium text-slate-500">Prio</span>
              {(['A', 'B', 'C'] as const).map((p) => (
                <button key={p} type="button" onClick={() => setze({ prio: d.prio === p ? undefined : p })} aria-pressed={d.prio === p} className={`h-8 w-8 rounded-lg border text-sm font-semibold ${d.prio === p ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <Field label="Warum diese Einstufung">
            <textarea className={`${inputClass} min-h-20`} value={d.prioBegruendung} onChange={(e) => setze({ prioBegruendung: e.target.value })} />
          </Field>
          <Field label="Zeiterfordernis (grobe Einschätzung)">
            <input className={inputClass} value={d.zeiterfordernis} onChange={(e) => setze({ zeiterfordernis: e.target.value })} placeholder="z. B. 20 Stunden über 6 Wochen" />
          </Field>
        </Card>

        {(
          [
            ['gruendeDagegen', 'Gründe gegen die Auftragsannahme (Probleme)'],
            ['gruendeDafuer', 'Gründe dafür (Vorteile)'],
          ] as const
        ).map(([feld, titel]) => (
          <Card key={feld} className="p-5">
            <h4 className="mb-3 text-sm font-semibold text-slate-700">{titel}</h4>
            {d[feld].map((wert, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <span className="w-4 text-xs text-slate-400">{i + 1}</span>
                <input className={inputClass} value={wert} onChange={(e) => setzeListe(feld, i, e.target.value)} aria-label={`${titel} ${i + 1}`} />
              </div>
            ))}
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h4 className="mb-3 text-sm font-semibold text-slate-700">Nächste Schritte</h4>
        {d.naechsteSchritte.map((wert, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <span className="w-4 text-xs text-slate-400">{i + 1}</span>
            <input className={inputClass} value={wert} onChange={(e) => setzeListe('naechsteSchritte', i, e.target.value)} aria-label={`Nächster Schritt ${i + 1}`} />
          </div>
        ))}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          {gespeichert && !geaendert && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={13} /> Gespeichert
            </span>
          )}
          <SecondaryButton onClick={drucken}>
            <Printer size={14} /> Drucken
          </SecondaryButton>
          <PrimaryButton onClick={speichern} disabled={!geaendert}>
            Kurzprüfung speichern
          </PrimaryButton>
        </div>
      </Card>
    </div>
  )
}
