import { useMemo } from 'react'
import { X } from 'lucide-react'
import { aggregatWert, datensaetzeFuer, formatiereZahl, wahlBeschriftung, wertBeschriftung, zeigeWert, zellenSchluessel } from '../../lib/pivot'
import type { Aggregat, Einstellung, Feld, PivotErgebnis } from '../../lib/pivot'

/** Höchstens so viele Zeilen und Spalten werden angezeigt; die Excel-Datei enthält immer alles. */
export const MAX_ZEILEN = 500
export const MAX_SPALTEN = 60
const MAX_DETAILS = 200

export type Auswahl = { zeile?: string; spalte?: string; titel: string }

export function ErgebnisTabelle({
  ergebnis: erg,
  einstellung: e,
  felder,
  euro,
  auswahl,
  onAuswahl,
}: {
  ergebnis: PivotErgebnis
  einstellung: Einstellung
  felder: Feld[]
  euro: boolean
  auswahl: Auswahl | null
  onAuswahl: (a: Auswahl | null) => void
}) {
  const zeilen = erg.zeilen.slice(0, MAX_ZEILEN)
  const spalten = erg.spalten.slice(0, MAX_SPALTEN)
  const zeilenTitel = e.zeilen.length ? e.zeilen.map((w) => wahlBeschriftung(w, felder)) : ['']
  const mitSpalten = e.spalten.length > 0
  const zahl = (a: Aggregat | undefined) => (a ? formatiereZahl(aggregatWert(a, e.berechnung), euro) : '')
  const istGewaehlt = (zeile?: string, spalte?: string) => !!auswahl && auswahl.zeile === zeile && auswahl.spalte === spalte

  const zelle = (a: Aggregat | undefined, zeile: string | undefined, spalte: string | undefined, titel: string, summe: boolean) => (
    <td key={spalte ?? 'gesamt'} className={`border-b border-slate-100 p-0 text-right ${summe ? 'bg-slate-50 font-semibold text-slate-800' : 'text-slate-700'}`}>
      {a ? (
        <button
          type="button"
          onClick={() => onAuswahl(istGewaehlt(zeile, spalte) ? null : { zeile, spalte, titel })}
          className={`block w-full whitespace-nowrap px-3 py-1.5 text-right tabular-nums hover:bg-accent-50 ${istGewaehlt(zeile, spalte) ? 'bg-accent-100 text-accent-800' : ''}`}
          title="Datensätze dazu anzeigen"
        >
          {zahl(a)}
        </button>
      ) : null}
    </td>
  )

  return (
    <div>
      {mitSpalten && (
        <p className="mb-1 text-xs text-slate-500">
          Spalten: <span className="font-medium text-slate-700">{wahlBeschriftung(e.spalten[0], felder)}</span>
        </p>
      )}
      <div className="max-h-[65vh] w-fit max-w-full overflow-auto rounded-lg border border-slate-200">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {zeilenTitel.map((t, i) => (
                <th key={i} className={`sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-600 ${i === 0 ? 'left-0 z-30' : ''}`}>
                  {t}
                </th>
              ))}
              {spalten.map((s) => (
                <th key={s.schluessel} className="sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-3 py-2 text-right text-xs font-semibold text-slate-600">
                  {s.teile.join(' / ')}
                </th>
              ))}
              <th className="sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-700">
                {mitSpalten ? 'Gesamt' : wertBeschriftung(e, felder)}
              </th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z, zi) => {
              const titel = z.teile.join(' / ')
              return (
                <tr key={z.schluessel}>
                  {z.teile.map((t, i) => {
                    // Bei zwei Zeilenebenen steht der erste Wert nur einmal je Gruppe.
                    const wiederholt = i === 0 && z.teile.length > 1 && zi > 0 && zeilen[zi - 1].teile[0] === t
                    return (
                      <th
                        key={i}
                        scope="row"
                        className={`max-w-[16rem] truncate border-b border-slate-100 bg-white px-3 py-1.5 text-left font-medium text-slate-700 ${i === 0 ? 'sticky left-0 z-10 max-w-[11rem] sm:max-w-[16rem]' : ''}`}
                        title={t}
                      >
                        {wiederholt ? '' : t}
                      </th>
                    )
                  })}
                  {spalten.map((s) => zelle(erg.zellen.get(zellenSchluessel(z.schluessel, s.schluessel)), z.schluessel, s.schluessel, `${titel} · ${s.teile.join(' / ')}`, false))}
                  {zelle(erg.zeilenSumme.get(z.schluessel), z.schluessel, undefined, mitSpalten ? `${titel} · Gesamt` : titel, true)}
                </tr>
              )
            })}
          </tbody>
          {erg.datensaetze.length > 0 && (
            <tfoot>
              <tr>
                <th scope="row" className="sticky bottom-0 left-0 z-30 border-t border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800" colSpan={1}>
                  Gesamt
                </th>
                {zeilenTitel.slice(1).map((_, i) => (
                  <td key={i} className="sticky bottom-0 z-20 border-t border-slate-300 bg-slate-100" />
                ))}
                {spalten.map((s) => (
                  <td key={s.schluessel} className="sticky bottom-0 z-20 border-t border-slate-300 bg-slate-100 p-0 text-right font-semibold text-slate-800">
                    <button
                      type="button"
                      onClick={() => onAuswahl(istGewaehlt(undefined, s.schluessel) ? null : { spalte: s.schluessel, titel: `Gesamt · ${s.teile.join(' / ')}` })}
                      className={`block w-full whitespace-nowrap px-3 py-2 text-right tabular-nums hover:bg-accent-50 ${istGewaehlt(undefined, s.schluessel) ? 'bg-accent-100 text-accent-800' : ''}`}
                      title="Datensätze dazu anzeigen"
                    >
                      {zahl(erg.spaltenSumme.get(s.schluessel))}
                    </button>
                  </td>
                ))}
                <td className="sticky bottom-0 z-20 border-t border-slate-300 bg-slate-200 p-0 text-right font-bold text-slate-900">
                  <button
                    type="button"
                    onClick={() => onAuswahl(istGewaehlt(undefined, undefined) ? null : { titel: 'Alle Datensätze' })}
                    className={`block w-full whitespace-nowrap px-3 py-2 text-right tabular-nums hover:bg-accent-50 ${istGewaehlt(undefined, undefined) ? 'bg-accent-100 text-accent-800' : ''}`}
                    title="Datensätze dazu anzeigen"
                  >
                    {zahl(erg.gesamt)}
                  </button>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {(erg.zeilen.length > MAX_ZEILEN || erg.spalten.length > MAX_SPALTEN) && (
        <p className="mt-2 text-xs text-amber-700">
          Angezeigt werden{' '}
          {[
            erg.zeilen.length > MAX_ZEILEN ? `die ersten ${MAX_ZEILEN} von ${erg.zeilen.length.toLocaleString('de-DE')} Zeilen` : '',
            erg.spalten.length > MAX_SPALTEN ? `die ersten ${MAX_SPALTEN} von ${erg.spalten.length.toLocaleString('de-DE')} Spalten` : '',
          ]
            .filter(Boolean)
            .join(' und ')}
          . Die Summen und die Excel-Datei enthalten alles.
        </p>
      )}
    </div>
  )
}

/** Die Datensätze hinter der angeklickten Zelle. */
export function DetailListe({
  ergebnis,
  auswahl,
  felder,
  spaltenIds,
  onClose,
}: {
  ergebnis: PivotErgebnis
  auswahl: Auswahl
  felder: Feld[]
  spaltenIds: string[]
  onClose: () => void
}) {
  const liste = useMemo(() => datensaetzeFuer(ergebnis, auswahl.zeile, auswahl.spalte), [ergebnis, auswahl])
  const spalten = spaltenIds.map((id) => felder.find((f) => f.id === id)).filter((f): f is Feld => !!f)
  return (
    <div className="mt-4 rounded-lg border border-accent-200 bg-white">
      <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800" title={auswahl.titel}>
            {auswahl.titel}
          </p>
          <p className="text-xs text-slate-500">
            {liste.length.toLocaleString('de-DE')} {liste.length === 1 ? 'Datensatz' : 'Datensätze'}
            {liste.length > MAX_DETAILS ? ` – die ersten ${MAX_DETAILS} sind aufgeführt` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Liste schließen">
          <X size={16} />
        </button>
      </div>
      <div className="max-h-80 max-w-full overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              {spalten.map((f) => (
                <th key={f.id} className={`sticky top-0 whitespace-nowrap bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 ${f.typ === 'zahl' ? 'text-right' : 'text-left'}`}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {liste.slice(0, MAX_DETAILS).map((d, i) => (
              <tr key={String(d._id ?? i)}>
                {spalten.map((f) => (
                  <td key={f.id} className={`max-w-[18rem] truncate px-3 py-1.5 text-slate-700 ${f.typ === 'zahl' ? 'whitespace-nowrap text-right tabular-nums' : ''}`} title={zeigeWert(d[f.id], f)}>
                    {zeigeWert(d[f.id], f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
