// Einwilligung vor JEDER Aufnahme. Ein Gespräch ohne Zustimmung aller Beteiligten aufzuzeichnen ist
// strafbar (§ 201 StGB). Der bestätigte Text wird mit Zeitpunkt und Person in der Aufnahme gespeichert.
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { GespraechArt, GespraechEinwilligung } from '../typen'

export function einwilligungsText(art: GespraechArt): string {
  if (art === 'notiz') return 'Ich nehme nur meine eigene Stimme auf. Sprechen weitere Personen mit, hole ich vorher auch deren Zustimmung ein.'
  return 'Alle Beteiligten wurden vor Beginn gefragt und sind einverstanden, dass dieses Gespräch aufgezeichnet, automatisch abgeschrieben und für die Akte ausgewertet wird.'
}

export function Einwilligung({
  art,
  wer,
  aufbewahrungTage,
  onBestaetigt,
  onAbbrechen,
}: {
  art: GespraechArt
  wer: string
  aufbewahrungTage: number
  onBestaetigt: (e: GespraechEinwilligung) => void
  onAbbrechen: () => void
}) {
  const [haken, setHaken] = useState(false)
  const text = einwilligungsText(art)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-accent-600" />
        <h1 className="text-lg font-semibold text-slate-900">Einverständnis</h1>
      </div>
      {art === 'notiz' ? (
        <p className="text-sm text-slate-700">Eine Notiz für die Akte, bei der nur Sie sprechen.</p>
      ) : (
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            Ein Gespräch darf nur aufgenommen werden, wenn <strong>alle</strong> Beteiligten zustimmen. Ohne Zustimmung ist die Aufnahme strafbar (§ 201 Strafgesetzbuch).
          </p>
          {art === 'telefon' && <p>Am Telefon: Fragen Sie gleich zu Beginn — am besten so, dass die Zustimmung mit auf der Aufnahme ist.</p>}
          <p className="text-slate-500">Tipp: Sagen Sie zu Beginn kurz „Alle sind mit der Aufnahme einverstanden“. Der Ton wird nach {aufbewahrungTage} Tagen gelöscht, Abschrift und Auswertung bleiben in der Akte.</p>
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input type="checkbox" checked={haken} onChange={(e) => setHaken(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
        <span className="text-sm text-slate-800">{text}</span>
      </label>
      <div className="flex gap-3">
        <button type="button" onClick={onAbbrechen} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
          Abbrechen
        </button>
        <button
          type="button"
          disabled={!haken}
          onClick={() => onBestaetigt({ bestaetigt: true, am: new Date().toISOString(), text, wer })}
          className="flex-[2] rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Aufnahme starten
        </button>
      </div>
    </div>
  )
}
