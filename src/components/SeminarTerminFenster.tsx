// Fenster zum Anlegen und Bearbeiten eines Seminartermins (22.11.2026), genutzt auf der Seite Seminare
// und auf der Seite eines Termins (/akademie/termine/:id).
import { useState } from 'react'
import { Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { MITARBEITER } from '../data/constants'
import { zahlAusText } from './KvPositionenEditor'
import { alsEingabeZeit, ausEingabeZeit, TERMIN_STATUS, type SeminarTermin, type TerminEingabe, type TerminStatus } from '../lib/seminarTermine'

export function SeminarTerminFenster({
  seminarTitel, termin, anzahlAnmeldungen = 0, vorgabeVerantwortlich, vorgabeReferent, onClose, onSpeichern, onLoeschen,
}: {
  seminarTitel: string
  termin?: SeminarTermin
  anzahlAnmeldungen?: number
  vorgabeVerantwortlich: string
  vorgabeReferent?: string
  onClose: () => void
  onSpeichern: (e: TerminEingabe & { beginn: string }) => Promise<void>
  onLoeschen?: () => Promise<void>
}) {
  const [beginn, setBeginn] = useState(alsEingabeZeit(termin?.beginn))
  const [ende, setEnde] = useState(alsEingabeZeit(termin?.ende))
  const [ort, setOrt] = useState(termin?.ort ?? '')
  const [onlineLink, setOnlineLink] = useState(termin?.onlineLink ?? '')
  const [plaetze, setPlaetze] = useState(termin?.plaetze !== undefined ? String(termin.plaetze) : '')
  const [preis, setPreis] = useState(termin?.preis !== undefined ? String(termin.preis).replace('.', ',') : '')
  const [referent, setReferent] = useState(termin?.referent ?? vorgabeReferent ?? '')
  const [verantwortlich, setVerantwortlich] = useState(termin?.verantwortlich ?? vorgabeVerantwortlich)
  const [status, setStatus] = useState<TerminStatus>(termin?.status ?? 'geplant')
  const [anmeldeschluss, setAnmeldeschluss] = useState(termin?.anmeldeschluss ? alsEingabeZeit(termin.anmeldeschluss).slice(0, 10) : '')
  const [oeffentlich, setOeffentlich] = useState(termin?.oeffentlich ?? false)
  const [notiz, setNotiz] = useState(termin?.notiz ?? '')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [loeschenFragen, setLoeschenFragen] = useState(false)

  const namen = MITARBEITER.includes(verantwortlich) || !verantwortlich ? MITARBEITER : [verantwortlich, ...MITARBEITER]

  async function speichern() {
    const b = ausEingabeZeit(beginn)
    if (!b) return setFehler('Bitte Datum und Uhrzeit des Beginns angeben.')
    const e = ende ? ausEingabeZeit(ende) : undefined
    if (ende && !e) return setFehler('Das Ende ist kein gültiger Zeitpunkt.')
    if (e && e < b) return setFehler('Das Ende liegt vor dem Beginn.')
    const p = plaetze.trim() === '' ? undefined : Number(plaetze)
    if (p !== undefined && (!Number.isInteger(p) || p < 1)) return setFehler('Plätze: eine ganze Zahl ab 1, oder leer lassen für unbegrenzt.')
    // zahlAusText: „490,50“, „1.250“ und „490.50“ (Punkt als Komma) — vorher wurde „490.50“ zu 49.050 €.
    const pr = preis.trim() === '' ? undefined : zahlAusText(preis)
    if (pr !== undefined && (!Number.isFinite(pr) || pr < 0)) return setFehler('Der Preis muss eine Zahl sein, z. B. 490 oder 490,00.')
    const schluss = anmeldeschluss ? ausEingabeZeit(`${anmeldeschluss}T23:59`) : undefined
    setLaeuft(true)
    setFehler('')
    try {
      await onSpeichern({
        beginn: b,
        ende: e ?? '',
        ort,
        onlineLink,
        plaetze: p,
        preis: pr,
        referent,
        verantwortlich,
        status,
        anmeldeschluss: schluss ?? '',
        oeffentlich,
        notiz,
      })
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
      setLaeuft(false)
    }
  }

  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  return (
    <Modal
      open
      onClose={onClose}
      title={termin ? `Termin bearbeiten: ${seminarTitel}` : `Neuer Termin: ${seminarTitel}`}
      width="max-w-xl"
      aktionen={<PrimaryButton onClick={speichern} disabled={laeuft}>Speichern</PrimaryButton>}
    >
      <div className="space-y-3">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={feld}>Beginn</span>
            <input type="datetime-local" value={beginn} onChange={(e) => setBeginn(e.target.value)} className={`${inputClass} w-full`} />
          </label>
          <label className="block">
            <span className={feld}>Ende (freiwillig)</span>
            <input type="datetime-local" value={ende} onChange={(e) => setEnde(e.target.value)} className={`${inputClass} w-full`} />
          </label>
        </div>
        <label className="block">
          <span className={feld}>Ort</span>
          <input value={ort} onChange={(e) => setOrt(e.target.value)} className={`${inputClass} w-full`} placeholder="z. B. Schwabstraße 3, 89075 Ulm" />
        </label>
        <label className="block">
          <span className={feld}>Zugang für die Teilnahme online (freiwillig)</span>
          <input value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} className={`${inputClass} w-full`} placeholder="Adresse des Videotreffens" />
          <span className="mt-0.5 block text-[11px] text-slate-400">Steht nur in den Mails an angemeldete Teilnehmer, nicht auf der öffentlichen Seite.</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={feld}>Plätze</span>
            <input value={plaetze} onChange={(e) => setPlaetze(e.target.value)} inputMode="numeric" className={`${inputClass} w-full`} placeholder="leer = unbegrenzt" />
          </label>
          <label className="block">
            <span className={feld}>Preis netto (€)</span>
            <input value={preis} onChange={(e) => setPreis(e.target.value)} inputMode="decimal" className={`${inputClass} w-full`} placeholder="leer = Katalogpreis" />
          </label>
          <label className="block">
            <span className={feld}>Anmeldeschluss</span>
            <input type="date" value={anmeldeschluss} onChange={(e) => setAnmeldeschluss(e.target.value)} className={`${inputClass} w-full`} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={feld}>Referent</span>
            <input value={referent} onChange={(e) => setReferent(e.target.value)} className={`${inputClass} w-full`} />
          </label>
          <label className="block">
            <span className={feld}>Betreut von</span>
            <select value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)} className={`${inputClass} w-full`}>
              {namen.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={feld}>Stand</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as TerminStatus)} className={`${inputClass} w-full`}>
              {TERMIN_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {termin && status === 'abgesagt' && termin.status !== 'abgesagt' && anzahlAnmeldungen > 0 && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            Ist die Regel „Absage des Termins“ eingeschaltet, bekommen alle Angemeldeten und die Warteliste nach dem Speichern eine Absage per Mail.
          </p>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={oeffentlich} onChange={(e) => setOeffentlich(e.target.checked)} />
          <span>
            Anmeldung über das Internet erlauben
            <span className="block text-xs text-slate-400">Dann funktioniert der Anmeldelink des Termins. Ist der Termin voll, landen neue Anmeldungen auf der Warteliste.</span>
          </span>
        </label>
        <label className="block">
          <span className={feld}>Notiz (nur intern)</span>
          <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={2} className={`${inputClass} w-full`} />
        </label>
      </div>

      {termin && onLoeschen && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
          {!loeschenFragen ? (
            <button onClick={() => setLoeschenFragen(true)} className="text-rose-600 hover:underline">Termin löschen</button>
          ) : (
            <>
              <span className="text-slate-600">
                {anzahlAnmeldungen > 0 ? `${anzahlAnmeldungen} Anmeldung(en) werden mit gelöscht. Für eine Absage besser den Stand auf „Abgesagt“ setzen. ` : ''}Wirklich löschen?
              </span>
              <SecondaryButton onClick={() => setLoeschenFragen(false)}>Abbrechen</SecondaryButton>
              <button
                onClick={() => onLoeschen().catch((e) => setFehler(e instanceof Error ? e.message : 'Löschen ging nicht.'))}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-white hover:bg-rose-700"
              >
                Löschen
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
