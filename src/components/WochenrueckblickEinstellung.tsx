// Einstellungen für den Wochenrückblick per Telegram (22.11.2026), im Superuser-Bereich.
// Ein/aus, Wochentag und Uhrzeit, Zusammenfassung, Empfänger (nur Geschäftsführung und Admins mit Telegram),
// dazu Vorschau und „an mich senden“. Gespeichert wird auf dem Server (Aktion wochenrueckblick_einstellung, nur
// Geschäftsführung); jede Änderung schreibt nur das geänderte Feld. Daten: supabase/functions/email-gateway/wochenrueckblick.ts.
import { useEffect, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronRight, Eye, Send } from 'lucide-react'
import { callAuthenticated } from '../lib/emailGateway'
import { SecondaryButton } from './ui'

type Einstellung = { an: boolean; berichtAn: string[]; wochentag: number; stunde: number; zusammenfassung: boolean; geaendertVon?: string; geaendertAm?: string }
type Moeglich = { name: string; email: string; telegram: boolean }
type Lauf = { woche?: string; zustand?: string; am?: string; empfaenger?: string[] } | null
type Antwort = { einstellung: Einstellung; moeglicheEmpfaenger: Moeglich[]; letzterLauf: Lauf }

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const STUNDEN = Array.from({ length: 17 }, (_, i) => i + 6)
const DATUM_ZEIT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function zeitText(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : DATUM_ZEIT.format(d)
}

function laufText(l: Lauf): string {
  if (!l?.woche) return 'noch nie gesendet'
  const woche = l.woche.replace(/^(\d{4})-W(\d+)$/, 'KW $2/$1')
  if (l.zustand === 'gesendet') return `${woche}: gesendet am ${zeitText(l.am)}${l.empfaenger?.length ? ` an ${l.empfaenger.join(', ')}` : ' (an niemanden zugestellt)'}`
  if (l.zustand === 'fehler') return `${woche}: fehlgeschlagen am ${zeitText(l.am)}, wird erneut versucht`
  return `${woche}: läuft seit ${zeitText(l.am)}`
}

export function WochenrueckblickEinstellung() {
  const [d, setD] = useState<Antwort | null>(null)
  const [offen, setOffen] = useState(false)
  const [fehler, setFehler] = useState('')
  const [vorschau, setVorschau] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [laeuft, setLaeuft] = useState<'' | 'vorschau' | 'senden' | 'speichern'>('')

  useEffect(() => {
    callAuthenticated({ action: 'wochenrueckblick_einstellung' })
      .then((x: Antwort) => setD(x))
      .catch((x) => setFehler(x instanceof Error ? x.message : 'Einstellung ließ sich nicht laden.'))
  }, [])

  async function speichere(aenderung: Partial<Einstellung>) {
    setFehler('')
    setLaeuft('speichern')
    try {
      setD(await callAuthenticated({ action: 'wochenrueckblick_einstellung', speichern: aenderung }))
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft('')
    }
  }

  async function probe(senden: boolean) {
    setFehler('')
    setHinweis('')
    setLaeuft(senden ? 'senden' : 'vorschau')
    try {
      const r = await callAuthenticated({ action: 'wochenrueckblick_test', senden })
      setVorschau(String(r.text ?? ''))
      if (senden) setHinweis(r.gesendet ? 'An dich per Telegram gesendet.' : r.hinweis ?? 'Nicht gesendet.')
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft('')
    }
  }

  if (!d) return fehler ? <p className="text-xs text-rose-600">Wochenrückblick: {fehler}</p> : null
  const e = d.einstellung
  const empfaengerNamen = d.moeglicheEmpfaenger.filter((m) => e.berichtAn.includes(m.email) && m.telegram).map((m) => m.name.split(' ')[0])
  const kurz = e.an ? (empfaengerNamen.length ? `an, ${WOCHENTAGE[e.wochentag].toLowerCase()}s ab ${e.stunde} Uhr an ${empfaengerNamen.join(', ')}` : 'an, aber ohne Empfänger') : 'aus'

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <button onClick={() => setOffen((x) => !x)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {offen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <CalendarClock size={15} className="text-slate-400" />
        <span className="font-medium text-slate-700">Wochenrückblick per Telegram:</span>
        <span className={e.an && empfaengerNamen.length ? 'font-medium text-emerald-700' : 'text-slate-500'}>{kurz}</span>
      </button>
      {offen && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <p className="text-xs text-slate-500">
            Einmal je Woche eine kurze Nachricht nur aus Zahlen der letzten sieben Tage: neue Akten und Anfragen, Stufenwechsel, Abschlüsse, Kostenvoranschläge, Rechnungen und Zahlungen, Unterschriften, Interessenten-Portal, überfällige Wiedervorlagen je Person, Kundentermine der nächsten Woche und bis zu drei Punkte, die Aufmerksamkeit brauchen. Ohne Kundennamen.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={e.an} disabled={!!laeuft} onChange={(x) => speichere({ an: x.target.checked })} />
              eingeschaltet
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              am
              <select value={e.wochentag} disabled={!!laeuft} onChange={(x) => speichere({ wochentag: Number(x.target.value) })} className="rounded border border-slate-200 px-1 py-0.5 text-sm">
                {WOCHENTAGE.map((w, i) => (
                  <option key={w} value={i}>{w}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-slate-600">
              ab
              <select value={e.stunde} disabled={!!laeuft} onChange={(x) => speichere({ stunde: Number(x.target.value) })} className="rounded border border-slate-200 px-1 py-0.5 text-sm">
                {STUNDEN.map((h) => (
                  <option key={h} value={h}>{h}:00 Uhr</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={e.zusammenfassung} disabled={!!laeuft} onChange={(x) => speichere({ zusammenfassung: x.target.checked })} />
              zwei Sätze Zusammenfassung oben
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Empfänger</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {d.moeglicheEmpfaenger.map((m) => (
                <label key={m.email} className={`flex items-center gap-2 ${m.telegram ? '' : 'text-slate-400'}`}>
                  <input
                    type="checkbox"
                    checked={e.berichtAn.includes(m.email)}
                    disabled={!!laeuft || (!m.telegram && !e.berichtAn.includes(m.email))}
                    onChange={(x) => speichere({ berichtAn: x.target.checked ? [...e.berichtAn, m.email] : e.berichtAn.filter((a) => a !== m.email) })}
                  />
                  {m.name}
                  {!m.telegram && <span className="text-[11px]">(ohne Telegram)</span>}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Nur Geschäftsführung und Admins. Ohne Häkchen geht die Nachricht an niemanden.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => void probe(false)} disabled={!!laeuft}>
              <Eye size={14} /> {laeuft === 'vorschau' ? 'Wird erstellt …' : 'Vorschau'}
            </SecondaryButton>
            <SecondaryButton onClick={() => void probe(true)} disabled={!!laeuft}>
              <Send size={14} /> {laeuft === 'senden' ? 'Wird gesendet …' : 'Jetzt an mich senden'}
            </SecondaryButton>
            {hinweis && <span className="text-xs text-emerald-700">{hinweis}</span>}
          </div>
          {fehler && <p className="text-xs text-rose-600">{fehler}</p>}
          {vorschau && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs text-slate-700">{vorschau}</pre>}
          <p className="text-[11px] text-slate-400">
            Letzter Lauf: {laufText(d.letzterLauf)}
            {e.geaendertVon && ` · Einstellung zuletzt geändert von ${e.geaendertVon}${e.geaendertAm ? ` am ${zeitText(e.geaendertAm)}` : ''}`}
          </p>
        </div>
      )}
    </div>
  )
}
