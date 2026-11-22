// Darstellung eines Dokuments zur Online-Unterschrift (22.11.2026) in der Aufmachung der Vorlage: Logo, Schrift und
// Titel wie im gedruckten Original (Kopfstil aus src/lib/vorlagePdf.ts). Felder, die der Kunde ausfüllt, sind
// Eingabefelder (öffentliche Seite) oder hervorgehobene Platzhalter (Vorschau im CRM). Gleiche Zerlegung wie die
// Vorschau beim Ausfüllen (zerlegeVorlage), damit der Kunde genau den vorbereiteten Text sieht.
import { useMemo } from 'react'
import { hatKopfzeile, zerlegeVorlage, type InlineTeil } from '../lib/vorlagenFuellen'
import { MAYER_LOGO_PNG } from '../data/mayerLogo'
import type { KundenFeld } from '../../supabase/functions/_shared/unterschriftKern.ts'

const SERIF = new Set(['brief', 'vertrag', 'schlichtSerif', 'memo'])
const OHNE_LOGO = new Set(['schlicht', 'schlichtSerif', 'memo'])
const TITEL_MITTE = new Set(['kooperation', 'schlicht', 'erben'])

export function UnterschriftDokument({
  text,
  kopfstil,
  felder = [],
  werte = {},
  onWert,
}: {
  text: string
  kopfstil: string
  felder?: KundenFeld[]
  werte?: Record<string, string>
  /** Ohne: nur ansehen (Felder des Kunden als Platzhalter). */
  onWert?: (name: string, wert: string) => void
}) {
  const bloecke = useMemo(() => zerlegeVorlage(text), [text])
  const pflicht = useMemo(() => new Map(felder.map((f) => [f.name, f.pflicht])), [felder])
  const serif = SERIF.has(kopfstil)

  const teile = (liste: InlineTeil[]) =>
    liste.map((t, i) => {
      if (t.art === 'text') return t.fett ? <strong key={i} className="font-semibold text-slate-900">{t.text}</strong> : <span key={i}>{t.text}</span>
      if (t.art === 'kaestchen') {
        return (
          <span key={i} aria-label={t.vorbelegt ? 'angekreuzt' : 'nicht angekreuzt'} className="mx-0.5 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded-sm border border-slate-500 text-[11px] font-bold leading-none">
            {t.vorbelegt ? '×' : ''}
          </span>
        )
      }
      const wert = werte[t.name] ?? ''
      const istPflicht = pflicht.get(t.name) !== false
      if (!onWert) {
        return (
          <span key={i} className="mx-0.5 rounded bg-amber-50 px-1 text-amber-800 ring-1 ring-amber-200" title="füllt der Kunde aus">
            {t.name}
          </span>
        )
      }
      return (
        <input
          key={i}
          value={wert}
          onChange={(e) => onWert(t.name, e.target.value)}
          placeholder={`${t.name}${istPflicht ? '' : ' (freiwillig)'}`}
          aria-label={t.name}
          maxLength={300}
          size={Math.max(12, Math.min(40, (wert || t.name).length + 2))}
          className={`mx-0.5 my-0.5 max-w-full rounded border-0 px-1.5 py-0.5 font-sans text-sm text-slate-900 outline-none ring-1 focus:ring-2 focus:ring-accent-400 ${
            wert.trim() ? 'bg-emerald-50 ring-emerald-200' : istPflicht ? 'bg-amber-50 ring-amber-300 placeholder:text-amber-700' : 'bg-slate-50 ring-slate-200 placeholder:text-slate-400'
          }`}
        />
      )
    })

  return (
    <div className={`rounded-lg border border-slate-200 bg-white px-5 py-6 text-[15px] leading-relaxed text-slate-800 shadow-sm sm:px-10 sm:py-10 ${serif ? 'font-serif' : ''}`}>
      {!OHNE_LOGO.has(kopfstil) && <img src={MAYER_LOGO_PNG} alt="Mayer Consulting" className="mb-6 h-16 w-auto sm:h-20" />}
      {bloecke.map((b, i) => {
        if (b.art === 'leer') return <div key={i} className="h-3" />
        if (b.art === 'titel') return <h2 key={i} className={`mb-3 text-xl font-bold text-slate-900 sm:text-2xl ${TITEL_MITTE.has(kopfstil) ? 'text-center' : ''}`}>{teile(b.teile)}</h2>
        if (b.art === 'ueberschrift') return <h3 key={i} className="mb-1 mt-4 font-semibold text-slate-900">{teile(b.teile)}</h3>
        if (b.art === 'zeile') return <p key={i} className="break-words" style={b.einzug ? { paddingLeft: `${Math.min(b.einzug, 12) * 0.45}rem` } : undefined}>{teile(b.teile)}</p>
        return (
          <div key={i} className="my-2 overflow-x-auto">
            <table className={`w-full border-collapse ${b.rahmenlos ? '' : 'text-sm'}`}>
              <tbody>
                {b.zeilen.map((zeile, z) => (
                  <tr key={z} className={!b.rahmenlos && z === 0 && hatKopfzeile(b.zeilen) ? 'bg-slate-50 font-medium' : ''}>
                    {zeile.map((zelle, s) => (
                      <td key={s} className={`${b.rahmenlos ? 'pr-4' : 'border border-slate-200 px-2'} py-1 align-top`}>{teile(zelle)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
