// Vorschläge aus Runde 5 auf dem Reiter „In die Akte“: der aus dem Gespräch vorbefüllte Fragebogen des Bereichs
// (als PDF in die Akte) und die Felder der Projekt-Checkliste (Sachverhalt, Branche, Dienstleistungen). Nur aus dem
// Gesagten; Aktenfelder werden nur gefüllt, wenn sie in der Akte leer sind — überschrieben wird nie.
import type { AktenfeldName, Aktenfelder, FragebogenAntwort } from '../../../supabase/functions/_shared/gespraechSchema.ts'
import type { AkteKurz } from './api'
import { aendere, feld, Karte } from './bausteine'

export type FbZeile = FragebogenAntwort & { an: boolean }
export type AfZeile = { feld: AktenfeldName; wert: string; an: boolean }

const FELD_NAME: Record<AktenfeldName, string> = { sachverhalt: 'Sachverhalt', branche: 'Branche', dienstleistungen: 'Dienstleistungen' }

export function fbStart(liste: FragebogenAntwort[] | undefined): FbZeile[] {
  return (liste ?? []).map((x) => ({ ...x, an: true }))
}

export function afStart(f: Aktenfelder | undefined): AfZeile[] {
  const aus: AfZeile[] = []
  if (f?.sachverhalt) aus.push({ feld: 'sachverhalt', wert: f.sachverhalt, an: true })
  if (f?.branche) aus.push({ feld: 'branche', wert: f.branche, an: true })
  if (f?.dienstleistungen?.length) aus.push({ feld: 'dienstleistungen', wert: f.dienstleistungen.join(', '), an: true })
  return aus
}

/** Bearbeitete Aktenfelder für den Server (Dienstleistungen als Liste). */
export function afAlsDaten(liste: AfZeile[]): Aktenfelder {
  const aus: Aktenfelder = {}
  for (const z of liste) {
    const w = z.wert.trim()
    if (!w) continue
    if (z.feld === 'dienstleistungen') aus.dienstleistungen = w.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
    else aus[z.feld] = w
  }
  return aus
}

function aktenWert(akte: AkteKurz | null, f: AktenfeldName): string {
  if (!akte) return ''
  const w = akte[f]
  return Array.isArray(w) ? w.filter(Boolean).join(', ') : String(w ?? '').trim()
}

export function FragebogenKarte({ name, zeilen, setZeilen, an, setAn, fertig, notiz }: { name: string; zeilen: FbZeile[]; setZeilen: (z: FbZeile[]) => void; an: boolean; setAn: (an: boolean) => void; fertig: boolean; notiz?: boolean }) {
  const beantwortet = zeilen.filter((z) => z.an && z.antwort.trim()).length
  return (
    <Karte titel={`Fragebogen „${name}“ vorbefüllt in die Akte`} an={an} setAn={setAn} fertig={fertig} fertigText={notiz ? 'als Notiz übernommen' : 'übernommen'}>
      <p className="mb-2 text-xs text-slate-500">
        {beantwortet} Antwort{beantwortet === 1 ? '' : 'en'} aus dem Gespräch — nur Gesagtes. Kommt als PDF unter Dokumente, die übrigen Fragen stehen darin als „noch nicht besprochen“. Unsichere Antworten sind gelb.
      </p>
      <div className="space-y-2">
        {zeilen.map((z, i) => (
          <div key={i} className={`rounded-lg border p-2 ${z.sicher ? 'border-slate-200' : 'border-amber-300 bg-amber-50/60'} ${z.an ? '' : 'opacity-60'}`}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={z.an} disabled={fertig} onChange={(e) => setZeilen(aendere(zeilen, i, { an: e.target.checked }))} />
              <span className="text-sm font-medium text-slate-800">{z.frage}</span>
              {!z.sicher && <span className="ml-auto shrink-0 text-xs text-amber-700">unsicher</span>}
            </label>
            <input className={`${feld} mt-1.5`} value={z.antwort} disabled={fertig || !z.an} onChange={(e) => setZeilen(aendere(zeilen, i, { antwort: e.target.value }))} />
          </div>
        ))}
      </div>
    </Karte>
  )
}

export function AktenfelderKarten({ zeilen, setZeilen, akte, erledigt }: { zeilen: AfZeile[]; setZeilen: (z: AfZeile[]) => void; akte: AkteKurz | null; erledigt?: Record<string, string> }) {
  return (
    <>
      {zeilen.map((z, i) => {
        const bisher = aktenWert(akte, z.feld)
        const status = erledigt?.[z.feld]
        return (
          <Karte key={z.feld} titel={`Akte: ${FELD_NAME[z.feld]}`} an={z.an && !bisher} setAn={bisher ? undefined : (an) => setZeilen(aendere(zeilen, i, { an }))} fertig={status === 'ergaenzt'} fertigText="ergänzt">
            {z.feld === 'sachverhalt' ? (
              <textarea className={`${feld} min-h-[5rem]`} value={z.wert} disabled={!!status || !!bisher} onChange={(e) => setZeilen(aendere(zeilen, i, { wert: e.target.value }))} />
            ) : (
              <input className={feld} value={z.wert} disabled={!!status || !!bisher} onChange={(e) => setZeilen(aendere(zeilen, i, { wert: e.target.value }))} />
            )}
            <p className="mt-1 text-xs text-slate-500">
              {status === 'ergaenzt'
                ? 'In der Akte ergänzt.'
                : bisher
                  ? `In der Akte steht schon: ${bisher.length > 160 ? `${bisher.slice(0, 159)}…` : bisher} — wird nicht überschrieben.`
                  : z.feld === 'dienstleistungen'
                    ? 'Feld in der Akte ist leer — wird ergänzt (mehrere mit Komma trennen).'
                    : 'Feld in der Akte ist leer — wird ergänzt.'}
            </p>
          </Karte>
        )
      })}
    </>
  )
}
