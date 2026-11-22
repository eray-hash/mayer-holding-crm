// „Belegte Zeiten aus meinem Kalender“: Der Mitarbeiter hinterlegt den veröffentlichten Link seines eigenen
// Kalenders (Outlook, iPhone/iCloud, Google, IONOS …). Das CRM liest daraus alle 15 Minuten nur die Uhrzeiten
// und zeigt sie als graue Blöcke „Belegt (eigener Kalender)“; Kollegen sehen nur „Privat“.
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, Unlink } from 'lucide-react'
import { inputClass, PrimaryButton, SecondaryButton } from '../ui'
import { aktualisiereFremd, ladeFremdStatus, speichereFremdLink, type FremdStatus } from './fremdKalender'

const STAND = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function EigenerKalenderVerbinden({ onGeaendert }: { onGeaendert?: () => void }) {
  const [status, setStatus] = useState<FremdStatus | null>(null)
  const [eingabe, setEingabe] = useState('')
  const [laeuft, setLaeuft] = useState<'' | 'speichern' | 'lesen' | 'trennen'>('')
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')

  useEffect(() => {
    ladeFremdStatus()
      .then((s) => {
        setStatus(s)
        setEingabe(s.url ?? '')
      })
      .catch((err) => {
        setStatus({ verbunden: false })
        setFehler(err instanceof Error ? err.message : 'Der Stand konnte nicht geladen werden.')
      })
  }, [])

  async function ausfuehren(art: 'speichern' | 'lesen' | 'trennen') {
    setLaeuft(art)
    setFehler('')
    setMeldung('')
    try {
      const neu = art === 'speichern' ? await speichereFremdLink(eingabe) : art === 'trennen' ? await speichereFremdLink('') : await aktualisiereFremd()
      setStatus(neu)
      setEingabe(neu.url ?? '')
      setMeldung(art === 'trennen' ? 'Getrennt — die belegten Zeiten aus deinem Kalender sind entfernt.' : art === 'speichern' ? 'Verbunden.' : 'Neu gelesen.')
      onGeaendert?.()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft('')
    }
  }

  function trennen() {
    if (!window.confirm('Verbindung zu deinem Kalender trennen? Die belegten Zeiten daraus verschwinden aus dem CRM.')) return
    ausfuehren('trennen')
  }

  const geaendert = (eingabe.trim() || '') !== (status?.url ?? '')

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">Belegte Zeiten aus meinem Kalender ins CRM holen</p>
      <p className="text-sm text-slate-600">
        Damit Kollegen und der Assistent sehen, wann du anderweitig belegt bist: Veröffentliche deinen Kalender in deiner Kalender-App und füge den Link hier ein. Ins CRM kommen nur die Uhrzeiten — keine Titel, keine Orte, keine Inhalte. Du siehst sie als graue Blöcke „Belegt (eigener Kalender)“, Kollegen nur als „Privat“.
      </p>

      {status === null ? (
        <p className="mt-3 text-sm text-slate-400">Wird geladen …</p>
      ) : (
        <>
          {status.verbunden && (
            <div className={`mt-3 rounded-lg p-3 text-xs ${status.fehler ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
              {status.fehler ? (
                <span className="flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  <span>
                    Zuletzt nicht lesbar: {status.fehler}
                    {status.stand && <> Gezeigt werden die Zeiten vom {STAND.format(new Date(status.stand))} Uhr.</>}
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Check size={13} /> Verbunden — {status.anzahl ?? 0} belegte Zeiten{status.stand ? `, zuletzt gelesen am ${STAND.format(new Date(status.stand))} Uhr` : ''}. Wird alle 15 Minuten neu gelesen.
                </span>
              )}
            </div>
          )}

          <label className="mb-1.5 mt-3 block text-xs font-medium text-slate-500" htmlFor="eigener-kalender-link">
            Link deines Kalenders (beginnt mit https:// oder webcal://)
          </label>
          <input
            id="eigener-kalender-link"
            className={`${inputClass} font-mono text-xs`}
            value={eingabe}
            onChange={(e) => setEingabe(e.target.value)}
            placeholder="z. B. webcal://p01-caldav.icloud.com/published/2/…"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <PrimaryButton onClick={() => ausfuehren('speichern')} disabled={!!laeuft || !eingabe.trim() || (!geaendert && !!status.verbunden)} className="text-sm">
              {laeuft === 'speichern' ? 'Wird geprüft …' : status.verbunden ? 'Link ändern' : 'Verbinden'}
            </PrimaryButton>
            {status.verbunden && (
              <>
                <SecondaryButton onClick={() => ausfuehren('lesen')} disabled={!!laeuft} className="text-sm">
                  <RefreshCw size={14} /> {laeuft === 'lesen' ? 'Liest …' : 'Jetzt neu lesen'}
                </SecondaryButton>
                <SecondaryButton onClick={trennen} disabled={!!laeuft} className="text-sm">
                  <Unlink size={14} /> {laeuft === 'trennen' ? 'Trennt …' : 'Trennen'}
                </SecondaryButton>
              </>
            )}
          </div>
          {meldung && <p className="mt-2 text-xs text-emerald-600">{meldung}</p>}
          {fehler && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler}
            </div>
          )}
        </>
      )}

      <p className="mb-1.5 mt-4 text-sm font-medium text-slate-700">So bekommst du den Link</p>
      <ul className="space-y-1.5 text-sm text-slate-600">
        <li>
          <span className="font-medium text-slate-700">iPhone (iCloud-Kalender):</span> Kalender-App → unten „Kalender“ → beim gewünschten Kalender auf das „i“ tippen → „Öffentlicher Kalender“ einschalten → „Link teilen …“ → „Kopieren“. Geht nur mit iCloud-Kalendern, nicht mit „Auf meinem iPhone“.
        </li>
        <li>
          <span className="font-medium text-slate-700">Outlook im Browser:</span> Einstellungen (Zahnrad) → Kalender → Freigegebene Kalender → „Kalender veröffentlichen“ → Kalender wählen und „Kann sehen, wann ich beschäftigt bin“ → „Veröffentlichen“ → den ICS-Link kopieren (nicht den HTML-Link).
        </li>
        <li>
          <span className="font-medium text-slate-700">Google Kalender:</span> am Computer auf calendar.google.com → bei deinem Kalender „Einstellungen und Freigabe“ → „Kalender integrieren“ → „Privatadresse im iCal-Format“ kopieren.
        </li>
        <li>
          <span className="font-medium text-slate-700">IONOS und andere:</span> in den Einstellungen des Kalenders nach „Veröffentlichen“, „Per Link freigeben“ oder „iCal-Adresse“ suchen.
        </li>
      </ul>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
        <li>Der Link ist geheim: Er wird nur für dich gespeichert und nur dir angezeigt. Wer ihn kennt, kann deinen Kalender lesen — nicht weitergeben.</li>
        <li>Hast du unter Privat dein Microsoft-Konto verbunden, kommen deine Outlook-Termine schon von selbst ins CRM — dann brauchst du das hier für diesen Kalender nicht.</li>
        <li>Ganztägige Einträge (z. B. Geburtstage) sperren keine Uhrzeiten; als „abwesend“ oder „beschäftigt“ markierte ganze Tage (Urlaub) schon.</li>
      </ul>
    </div>
  )
}
