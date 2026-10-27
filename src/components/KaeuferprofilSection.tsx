import { useState } from 'react'
import { Save, Send, Check } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { matchObjekte } from '../lib/matchObjekte'
import { OBJEKT_TYPEN, gruppeLabel } from '../data/constants'
import { Card, Field, inputClass, PrimaryButton, EmptyState, StatusBadge } from './ui'
import { FormularLinkButtons } from './FormularLink'
import { fmtEUR, today, uid } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'
import type { KundeBereich, Kaeuferprofil, ObjektTyp } from '../types'

const NUTZUNG_OPTIONEN: Kaeuferprofil['nutzung'][] = ['Eigennutz', 'Kapitalanlage', 'Unklar']

function leererEntwurf(): Kaeuferprofil {
  return {
    budgetMin: undefined,
    budgetMax: undefined,
    objekttypen: [],
    bevorzugteLage: '',
    nutzung: 'Unklar',
    zeitrahmen: '',
    finanzierungGesichert: false,
    notizen: '',
    erstelltAm: today(),
  }
}

// Käuferprofil-Fragebogen + automatisches Matching gegen den Immobilien-Objektbestand — in allen
// sechs KundeBereich-Detailseiten einbindbar, analog zu PotenzialAnalyseSection. Ein Kunde/Mandant
// muss kein originärer Immobilien-Kunde sein, um Kaufinteresse zu hinterlegen.
export function KaeuferprofilSection({ bereich, kundeId, kundeName }: { bereich: KundeBereich; kundeId: string; kundeName: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const [entwurf, setEntwurf] = useState<Kaeuferprofil>(kunde?.kaeuferprofil ?? leererEntwurf())
  const [bearbeiten, setBearbeiten] = useState(!kunde?.kaeuferprofil)
  const [vorgeschlagen, setVorgeschlagen] = useState<Set<string>>(new Set())

  if (!kunde) return null

  function toggleTyp(t: ObjektTyp) {
    setEntwurf((e) => ({
      ...e,
      objekttypen: e.objekttypen.includes(t) ? e.objekttypen.filter((x) => x !== t) : [...e.objekttypen, t],
    }))
  }

  function speichern() {
    dispatch({ type: 'SET_KAEUFERPROFIL', bereich, kundeId, profil: { ...entwurf, erstelltAm: today() } })
    setBearbeiten(false)
  }

  const bestehendeVorschlaege = state.objektVorschlaege.filter((v) => v.kundeBereich === bereich && v.kundeId === kundeId)
  const bereitsVorgeschlageneIds = new Set(bestehendeVorschlaege.map((v) => v.objektId))
  const treffer = kunde.kaeuferprofil ? matchObjekte(state.objekte, kunde.kaeuferprofil).filter((o) => !bereitsVorgeschlageneIds.has(o.id)) : []

  function vorschlagen(objektId: string, text: string) {
    const id = uid('ov')
    dispatch({
      type: 'ADD_OBJEKT_VORSCHLAG',
      vorschlag: { id, objektId, kundeBereich: bereich, kundeId, kundeName, steuerBegruendung: text, status: 'offen', erstelltAm: today(), erstelltVon: CURRENT_USER },
    })
    setVorgeschlagen((s) => new Set(s).add(objektId))
  }

  return (
    <div className="space-y-4">
      {!bearbeiten && kunde.kaeuferprofil ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-700">Käuferprofil</h4>
            <button onClick={() => setBearbeiten(true)} className="text-xs font-medium text-accent-600 hover:underline">Bearbeiten</button>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-slate-400">Budget</dt><dd className="text-slate-700">{kunde.kaeuferprofil.budgetMin ? fmtEUR(kunde.kaeuferprofil.budgetMin) : '—'} bis {kunde.kaeuferprofil.budgetMax ? fmtEUR(kunde.kaeuferprofil.budgetMax) : '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Objekttypen</dt><dd className="text-slate-700">{kunde.kaeuferprofil.objekttypen.length > 0 ? kunde.kaeuferprofil.objekttypen.join(', ') : 'egal'}</dd></div>
            <div><dt className="text-xs text-slate-400">Bevorzugte Lage</dt><dd className="text-slate-700">{kunde.kaeuferprofil.bevorzugteLage || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Nutzung</dt><dd className="text-slate-700">{kunde.kaeuferprofil.nutzung}</dd></div>
            <div><dt className="text-xs text-slate-400">Zeitrahmen</dt><dd className="text-slate-700">{kunde.kaeuferprofil.zeitrahmen || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">Finanzierung gesichert</dt><dd className="text-slate-700">{kunde.kaeuferprofil.finanzierungGesichert ? 'Ja' : 'Nein'}</dd></div>
          </dl>
          {kunde.kaeuferprofil.notizen && <p className="mt-2 text-sm text-slate-600">{kunde.kaeuferprofil.notizen}</p>}
        </Card>
      ) : (
        <Card className="p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Käuferprofil erfassen</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Budget von (€)">
              <input type="number" className={inputClass} value={entwurf.budgetMin ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, budgetMin: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
            <Field label="Budget bis (€)">
              <input type="number" className={inputClass} value={entwurf.budgetMax ?? ''} onChange={(e) => setEntwurf((x) => ({ ...x, budgetMax: e.target.value ? Number(e.target.value) : undefined }))} />
            </Field>
          </div>
          <Field label="Objekttypen (Mehrfachauswahl, leer = egal)">
            <div className="flex flex-wrap gap-3">
              {OBJEKT_TYPEN.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" className="rounded" checked={entwurf.objekttypen.includes(t)} onChange={() => toggleTyp(t)} />
                  {t}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Bevorzugte Lage">
            <input className={inputClass} value={entwurf.bevorzugteLage} onChange={(e) => setEntwurf((x) => ({ ...x, bevorzugteLage: e.target.value }))} placeholder="z. B. Ulm, Neu-Ulm" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nutzung">
              <select className={inputClass} value={entwurf.nutzung} onChange={(e) => setEntwurf((x) => ({ ...x, nutzung: e.target.value as Kaeuferprofil['nutzung'] }))}>
                {NUTZUNG_OPTIONEN.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Zeitrahmen">
              <input className={inputClass} value={entwurf.zeitrahmen} onChange={(e) => setEntwurf((x) => ({ ...x, zeitrahmen: e.target.value }))} placeholder="z. B. innerhalb 6 Monate" />
            </Field>
          </div>
          <label className="mb-3 mt-1 flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" className="rounded" checked={entwurf.finanzierungGesichert} onChange={(e) => setEntwurf((x) => ({ ...x, finanzierungGesichert: e.target.checked }))} />
            Finanzierung bereits gesichert
          </label>
          <Field label="Notizen">
            <textarea className={inputClass} rows={2} value={entwurf.notizen} onChange={(e) => setEntwurf((x) => ({ ...x, notizen: e.target.value }))} />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            {kunde.kaeuferprofil && <button onClick={() => setBearbeiten(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Abbrechen</button>}
            <PrimaryButton onClick={speichern}><Save size={14} /> Speichern</PrimaryButton>
          </div>
        </Card>
      )}

      {kunde.kaeuferprofil && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Passende Objekte</h4>
          <div className="space-y-3">
            {treffer.map((o) => {
              const begruendung = `Dieses Objekt passt zu Ihrem Käuferprofil: ${o.typ} in ${o.adresse} für ${fmtEUR(o.kaufpreis)}${kunde.kaeuferprofil!.nutzung !== 'Unklar' ? `, geeignet zur ${kunde.kaeuferprofil!.nutzung === 'Eigennutz' ? 'Eigennutzung' : 'Kapitalanlage'}` : ''}.`
              return (
                <Card key={o.id} className="p-4">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{o.bezeichnung}</span>
                    <span className="text-xs text-slate-400">{gruppeLabel(o.gruppe)}</span>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">{o.adresse} · {o.typ} · {fmtEUR(o.kaufpreis)}</p>
                  {vorgeschlagen.has(o.id) ? (
                    <p className="text-xs font-medium text-emerald-600 inline-flex items-center gap-1"><Check size={13} /> Vorgeschlagen — Link unten zum Weitersenden.</p>
                  ) : (
                    <button
                      onClick={() => vorschlagen(o.id, begruendung)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Send size={13} /> Exposé vorschlagen
                    </button>
                  )}
                </Card>
              )
            })}
            {treffer.length === 0 && <EmptyState text="Keine passenden Objekte im aktuellen Bestand." />}
          </div>
        </div>
      )}

      {bestehendeVorschlaege.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Bereits vorgeschlagene Objekte</h4>
          <div className="space-y-3">
            {bestehendeVorschlaege.map((v) => {
              const o = state.objekte.find((x) => x.id === v.objektId)
              return (
                <Card key={v.id} className="p-4">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">{o?.bezeichnung ?? 'Objekt'}</span>
                    <StatusBadge
                      label={v.status === 'offen' ? 'Offen' : v.status === 'akzeptiert' ? 'Akzeptiert' : 'Abgelehnt'}
                      color={v.status === 'offen' ? 'bg-amber-50 text-amber-700' : v.status === 'akzeptiert' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}
                    />
                  </div>
                  {v.status === 'offen' && <FormularLinkButtons pfad={`/formular/expose/${v.id}`} />}
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
