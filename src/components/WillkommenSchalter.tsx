// Schalter für die automatische Willkommensnachricht (20.11.2026), oben auf der Projekt-Checkliste.
// Ein- und ausschalten und die Wartezeit ändern dürfen nur Geschäftsführung und Superuser (Regel in der
// Datenbank). Der Text ist die Mail-Vorlage „Willkommensnachricht (automatisch)“.
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { ladeWillkommenEinstellung, setzeWillkommenEinstellung, type WillkommenEinstellung } from '../lib/willkommen'

export function WillkommenSchalter({ nutzerName }: { nutzerName: string }) {
  const { state } = useApp()
  const { mitarbeiter, istSuperuser, ansichtAls } = useAuth()
  const [e, setE] = useState<WillkommenEinstellung | null>(null)
  const [offen, setOffen] = useState(false)
  const [fehler, setFehler] = useState('')
  const darf = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || istSuperuser)
  const vorlage = state.mailVorlagen.find((v) => v.id === 'mv-willkommen-auto')

  useEffect(() => {
    ladeWillkommenEinstellung().then(setE).catch((x) => setFehler(x instanceof Error ? x.message : 'Einstellung ließ sich nicht laden.'))
  }, [])

  async function setze(neu: { aktiv?: boolean; verzoegerungMinuten?: number }) {
    setFehler('')
    try {
      await setzeWillkommenEinstellung(neu, nutzerName)
      setE(await ladeWillkommenEinstellung())
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    }
  }

  if (!e) return fehler ? <p className="text-xs text-rose-600">{fehler}</p> : null
  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <button onClick={() => setOffen((x) => !x)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {offen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <Mail size={15} className="text-slate-400" />
        <span className="font-medium text-slate-700">Automatische Willkommensnachricht:</span>
        <span className={e.aktiv ? 'font-medium text-emerald-700' : 'text-slate-500'}>{e.aktiv ? `an, ${e.verzoegerungMinuten} Minuten nach Erstkontakt` : 'aus'}</span>
      </button>
      {offen && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <p className="text-xs text-slate-500">
            Wenn ein Fall in den ersten Stand kommt (Neuanfrage → Erstkontakt, oder ein Mitarbeiter legt eine Akte an), geht nach der Wartezeit diese Mail mit einem Link zum Hochladen von Unterlagen an den Kunden. Akten, die das CRM selbst anlegt, bekommen nichts. In der Akte lässt sich jede Nachricht bis dahin abbrechen.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={e.aktiv} disabled={!darf} onChange={(x) => setze({ aktiv: x.target.checked })} />
              eingeschaltet
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              Wartezeit
              <select value={e.verzoegerungMinuten} disabled={!darf} onChange={(x) => setze({ verzoegerungMinuten: Number(x.target.value) })} className="rounded border border-slate-200 px-1 py-0.5 text-sm">
                {[15, 30, 60, 120, 240, 1440].map((m) => (
                  <option key={m} value={m}>{m < 60 ? `${m} Minuten` : m === 1440 ? '1 Tag' : `${m / 60} Std.`}</option>
                ))}
              </select>
            </label>
            {!darf && <span className="text-xs text-slate-400">Ändern darf nur die Geschäftsführung.</span>}
            {e.geaendertVon && <span className="text-xs text-slate-400">zuletzt geändert von {e.geaendertVon}</span>}
          </div>
          {fehler && <p className="text-xs text-rose-600">{fehler}</p>}
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Betreff: {vorlage?.betreff ?? '–'}</p>
            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{vorlage?.text ?? 'Vorlage „Willkommensnachricht (automatisch)“ nicht gefunden.'}</pre>
            <p className="mt-2 text-[11px] text-slate-400">Den Text ändert man unter den Mail-Vorlagen. {'{{ansprechpartner}}'} = Name des Kunden, {'{{ansprechpartner_satz}}'} = „Ihr persönlicher Ansprechpartner ist …“ (fällt ohne Verantwortlichen weg), {'{{link}}'} = Link zum Hochladen, {'{{gruss}}'} = Name des Verantwortlichen.</p>
          </div>
        </div>
      )}
    </div>
  )
}
