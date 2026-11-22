// Öffentliche Anmeldung zu einem Seminartermin der Akademie (22.11.2026). Link /formular/seminar/:token,
// token = geheime Kennung des Termins (seminar_termine.anmelde_token). Server: email-gateway/seminarAnmeldung.ts.
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Clock, GraduationCap, Loader2, Lock, MapPin, User } from 'lucide-react'
import { Card, PrimaryButton } from '../../components/ui'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'
import { fmtEURCent } from '../../lib/dates'
import { holeTerminSeite, meldeAn, terminZeit, type AnmeldeErgebnis, type TerminSeite } from '../../lib/seminarTermine'

/** Vorlagen-Text (# Titel, ## Abschnitt, **fett**) lesbar darstellen (wie im Interessenten-Portal). */
function Vertragstext({ text }: { text: string }) {
  const fett = (zeile: string): ReactNode[] => zeile.split(/(\*\*[^*]+\*\*)/).map((t, i) => (t.startsWith('**') && t.endsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : t))
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-700">
      {text.split('\n').map((z, i) => {
        if (z.startsWith('# ')) return <h3 key={i} className="pt-1 text-sm font-semibold text-slate-800">{z.slice(2)}</h3>
        if (z.startsWith('## ')) return <h4 key={i} className="pt-2 font-semibold text-slate-800">{z.slice(3)}</h4>
        if (!z.trim()) return null
        return <p key={i}>{fett(z)}</p>
      })}
    </div>
  )
}

function Kopf() {
  return <p className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-accent-600">Akademie · Andreas Mayer Holding · Schwabstraße 3, 89075 Ulm</p>
}

function Rahmen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Kopf />
        {children}
        <DatenschutzHinweis />
      </div>
    </div>
  )
}

export function PublicSeminarAnmeldung() {
  const { terminId } = useParams()
  const [seite, setSeite] = useState<TerminSeite | null>(null)
  const [ergebnis, setErgebnis] = useState<Extract<AnmeldeErgebnis, { stufe: 'angemeldet' | 'warteliste' }> | null>(null)
  const [name, setName] = useState('')
  const [firma, setFirma] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [webseite, setWebseite] = useState('')
  const [bedingungen, setBedingungen] = useState(false)
  const [datenschutz, setDatenschutz] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!terminId) return
    holeTerminSeite(terminId)
      .then(setSeite)
      .catch(() => setSeite({ stufe: 'ungueltig', grund: 'Die Seite lässt sich gerade nicht laden. Bitte versuchen Sie es später erneut.' }))
  }, [terminId])

  async function absenden() {
    if (!terminId) return
    setLaeuft(true)
    setFehler('')
    try {
      const r = await meldeAn(terminId, { name, firma, email, telefon, teilnahmebedingungen: bedingungen, datenschutz, webseite })
      if (r.stufe === 'fehler') setFehler(r.grund)
      else if (r.stufe === 'ungueltig') setSeite({ stufe: 'ungueltig', grund: r.grund })
      else {
        setErgebnis(r)
        window.scrollTo({ top: 0 })
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  if (!seite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (seite.stufe === 'ungueltig') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={32} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Keine Anmeldung möglich</h1>
          <p className="text-sm text-slate-500">{seite.grund}</p>
        </Card>
      </div>
    )
  }

  const { seminar, termin, freiePlaetze, texte } = seite

  if (ergebnis) {
    const warte = ergebnis.stufe === 'warteliste'
    return (
      <Rahmen>
        <Card className="p-8 text-center">
          <CheckCircle2 className={`mx-auto mb-3 ${warte ? 'text-amber-500' : 'text-emerald-500'}`} size={40} />
          <h1 className="mb-2 text-xl font-semibold text-slate-800">{warte ? 'Sie stehen auf der Warteliste' : 'Vielen Dank für Ihre Anmeldung'}</h1>
          <p className="text-sm text-slate-600">
            {ergebnis.schonAngemeldet ? 'Sie waren für diesen Termin bereits angemeldet. ' : ''}
            {warte
              ? `Alle Plätze für „${ergebnis.seminar}“ am ${terminZeit(ergebnis.beginn)} sind vergeben. Sobald ein Platz frei wird, melden wir uns bei Ihnen.`
              : `Wir haben Ihre Anmeldung für „${ergebnis.seminar}“ am ${terminZeit(ergebnis.beginn)} erhalten und melden uns mit allen Einzelheiten bei Ihnen.`}
          </p>
          <p className="mt-4 text-xs text-slate-400">Sie können dieses Fenster jetzt schließen.</p>
        </Card>
      </Rahmen>
    )
  }

  const bereit = name.trim().length >= 3 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && datenschutz && (!texte.teilnahmebedingungen || bedingungen)
  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  const eingabe = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm'
  return (
    <Rahmen>
      <h1 className="text-center text-xl font-bold text-slate-800">Anmeldung zum Seminar</h1>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <GraduationCap className="mt-0.5 shrink-0 text-accent-600" size={26} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-800">{seminar.titel}</h2>
            {seminar.bereich && <p className="text-xs text-slate-400">{seminar.bereich}</p>}
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li className="flex items-center gap-2"><CalendarDays size={15} className="text-slate-400" /> {terminZeit(termin.beginn, termin.ende ?? undefined)}</li>
              {(termin.ort || termin.online) && (
                <li className="flex items-center gap-2"><MapPin size={15} className="text-slate-400" /> {[termin.ort, termin.online ? 'Teilnahme auch online möglich' : ''].filter(Boolean).join(' · ')}</li>
              )}
              {seminar.dauer && <li className="flex items-center gap-2"><Clock size={15} className="text-slate-400" /> {seminar.dauer}</li>}
              {termin.referent && <li className="flex items-center gap-2"><User size={15} className="text-slate-400" /> {termin.referent}</li>}
            </ul>
            <p className="mt-2 text-sm font-medium text-slate-700">
              {termin.preis !== null ? `${fmtEURCent(termin.preis)} zzgl. Umsatzsteuer je Teilnehmer` : 'Preis auf Anfrage'}
            </p>
            {seminar.beschreibung && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{seminar.beschreibung}</p>}
            <p className={`mt-3 rounded-lg p-2 text-sm ${freiePlaetze === 0 ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'}`}>
              {freiePlaetze === null
                ? 'Es sind noch Plätze frei.'
                : freiePlaetze === 0
                  ? 'Alle Plätze sind vergeben. Sie können sich auf die Warteliste setzen lassen.'
                  : freiePlaetze === 1
                    ? 'Noch 1 Platz frei.'
                    : `Noch ${freiePlaetze} Plätze frei.`}
              {termin.anmeldeschluss ? ` Anmeldeschluss: ${new Date(termin.anmeldeschluss).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}.` : ''}
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Ihre Angaben</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className={feld}>Vor- und Nachname</span><input value={name} onChange={(e) => setName(e.target.value)} className={eingabe} autoComplete="name" /></label>
          <label className="block"><span className={feld}>Firma (freiwillig)</span><input value={firma} onChange={(e) => setFirma(e.target.value)} className={eingabe} autoComplete="organization" /></label>
          <label className="block"><span className={feld}>E-Mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={eingabe} autoComplete="email" /></label>
          <label className="block"><span className={feld}>Telefon (freiwillig)</span><input value={telefon} onChange={(e) => setTelefon(e.target.value)} type="tel" className={eingabe} autoComplete="tel" /></label>
        </div>
        {/* Für Menschen unsichtbar: füllen nur Programme aus. */}
        <input value={webseite} onChange={(e) => setWebseite(e.target.value)} name="webseite" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      </Card>

      {texte.teilnahmebedingungen && (
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Teilnahmebedingungen</h2>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-100 p-3">
            <Vertragstext text={texte.teilnahmebedingungen} />
          </div>
        </Card>
      )}

      <Card className="space-y-3 p-5">
        {texte.teilnahmebedingungen && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={bedingungen} onChange={(e) => setBedingungen(e.target.checked)} />
            Ich habe die Teilnahmebedingungen gelesen und stimme ihnen zu.
          </label>
        )}
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={datenschutz} onChange={(e) => setDatenschutz(e.target.checked)} />
          <span>
            {texte.datenschutz}{' '}
            <a href="#/datenschutz" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-900">Datenschutzhinweise lesen</a>
          </span>
        </label>
        {fehler && <p className="text-sm font-medium text-rose-600">{fehler}</p>}
        <PrimaryButton className="w-full justify-center" disabled={!bereit || laeuft} onClick={absenden}>
          {laeuft ? 'Wird gesendet …' : freiePlaetze === 0 ? 'Auf die Warteliste setzen' : 'Verbindlich anmelden'}
        </PrimaryButton>
        <p className="text-xs text-slate-400">Ihre Zustimmung wird mit Datum, Uhrzeit und dem genauen Wortlaut gespeichert.</p>
      </Card>
    </Rahmen>
  )
}
