import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, ChevronLeft, Clock, MapPin, User } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'
import { holeBuchungsInfo, legeBuchungAn, type BuchungsInfo } from '../../lib/terminBuchung'

// Öffentliche Buchungsseite /formular/termin/:kennung: Kunden wählen einen freien Termin bei einem
// Mitarbeiter (Tag → Uhrzeit → Angaben) und bekommen eine Bestätigung per E-Mail mit Kalenderdatei.
// Die freien Zeiten rechnet der Server (email-gateway/buchung.ts); angezeigt wird immer deutsche Zeit.

const TAG_KURZ = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit' })
const TAG_LANG = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const MONAT = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', month: 'long', year: 'numeric' })
const UHR = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' })

const EMAIL_MUSTER = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function andereZeitzone(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Berlin'
  } catch {
    return false
  }
}

export function PublicTerminBuchen() {
  const { kennung = '' } = useParams()
  const [info, setInfo] = useState<BuchungsInfo | null>(null)
  const [ladeFehler, setLadeFehler] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [zeit, setZeit] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [nachricht, setNachricht] = useState('')
  // Unsichtbares Feld gegen Programme, die Formulare automatisch ausfüllen (bleibt bei Menschen leer).
  const [webseite, setWebseite] = useState('')
  const [senden, setSenden] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState<{ beginn: string; ende: string; bestaetigungGesendet: boolean } | null>(null)

  async function laden() {
    setLadeFehler('')
    try {
      setInfo(await holeBuchungsInfo(kennung))
    } catch (err) {
      setLadeFehler(err instanceof Error ? err.message : 'Die Buchungsseite konnte nicht geladen werden.')
    }
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kennung])

  // Tage nach Monat gruppiert, damit auch 90 Tage übersichtlich bleiben.
  const monate = useMemo(() => {
    const gruppen: { monat: string; tage: BuchungsInfo['tage'] }[] = []
    for (const t of info?.tage ?? []) {
      const m = MONAT.format(new Date(t.zeiten[0]))
      const letzte = gruppen[gruppen.length - 1]
      if (letzte && letzte.monat === m) letzte.tage.push(t)
      else gruppen.push({ monat: m, tage: [t] })
    }
    return gruppen
  }, [info])

  const gewaehlterTag = info?.tage.find((t) => t.datum === tag) ?? null

  async function buchen() {
    if (!info || !zeit) return
    if (name.trim().length < 2) {
      setFehler('Bitte Ihren Namen angeben.')
      return
    }
    if (!EMAIL_MUSTER.test(email.trim())) {
      setFehler('Bitte eine gültige E-Mail-Adresse angeben — dorthin schicken wir die Bestätigung.')
      return
    }
    setFehler('')
    setSenden(true)
    try {
      const ergebnis = await legeBuchungAn({ kennung, beginn: zeit, name: name.trim(), email: email.trim(), telefon: telefon.trim(), nachricht: nachricht.trim(), webseite })
      setFertig(ergebnis)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Die Buchung hat nicht geklappt. Bitte versuchen Sie es noch einmal.'
      setFehler(text)
      // Zeit inzwischen vergeben: freie Zeiten neu laden und zurück zur Auswahl.
      if (/nicht mehr frei/.test(text)) {
        setZeit(null)
        await laden()
      }
    } finally {
      setSenden(false)
    }
  }

  const kopf = (
    <div className="mb-6 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding</p>
      <h1 className="mt-1 text-xl font-bold text-slate-800">{info?.titel || 'Termin vereinbaren'}</h1>
      {info && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span className="flex items-center gap-1.5"><User size={14} className="text-slate-400" /> {info.name}</span>
          <span className="flex items-center gap-1.5"><Clock size={14} className="text-slate-400" /> {info.dauer_min} Minuten</span>
          {info.ort && <span className="flex items-center gap-1.5"><MapPin size={14} className="text-slate-400" /> {info.ort}</span>}
        </div>
      )}
    </div>
  )

  if (fertig) {
    const v = new Date(fertig.beginn)
    const b = new Date(fertig.ende)
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-md">
          <Card className="p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={40} />
            <h1 className="mb-2 text-lg font-semibold text-slate-800">Ihr Termin ist gebucht</h1>
            <p className="text-sm font-medium text-slate-700">{info?.titel}{info?.name ? ` mit ${info.name}` : ''}</p>
            <p className="mt-1 text-sm text-slate-700">{TAG_LANG.format(v)}, {UHR.format(v)}–{UHR.format(b)} Uhr</p>
            {info?.ort && <p className="mt-1 text-sm text-slate-500">Ort: {info.ort}</p>}
            <p className="mt-4 text-sm text-slate-500">
              {fertig.bestaetigungGesendet
                ? `Eine Bestätigung mit dem Termin für Ihren Kalender ist unterwegs an ${email.trim()}.`
                : 'Ihr Termin ist eingetragen. Die Bestätigung per E-Mail konnte gerade nicht verschickt werden — wir melden uns bei Ihnen.'}{' '}
              Wenn Sie den Termin absagen oder verschieben möchten, antworten Sie einfach auf die Bestätigung oder rufen Sie uns an.
            </p>
          </Card>
        </div>
        <DatenschutzHinweis />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        {kopf}

        {ladeFehler && (
          <Card className="p-6 text-center">
            <p className="text-sm text-slate-600">{ladeFehler}</p>
          </Card>
        )}

        {!info && !ladeFehler && <p className="text-center text-sm text-slate-400">Freie Termine werden geladen …</p>}

        {info && (
          <Card className="p-5 sm:p-6">
            {info.hinweis && <p className="mb-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{info.hinweis}</p>}

            {info.tage.length === 0 ? (
              <p className="text-sm text-slate-600">Zurzeit sind leider keine Termine frei. Bitte schauen Sie später noch einmal vorbei oder rufen Sie uns an.</p>
            ) : !gewaehlterTag ? (
              <>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <CalendarDays size={15} className="text-slate-400" /> 1. Tag wählen
                </h2>
                {monate.map((g) => (
                  <div key={g.monat} className="mb-4 last:mb-0">
                    <p className="mb-2 text-xs font-medium text-slate-500">{g.monat}</p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {g.tage.map((t) => (
                        <button
                          key={t.datum}
                          onClick={() => { setTag(t.datum); setZeit(null); setFehler('') }}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-center text-sm font-medium text-slate-700 hover:border-accent-400 hover:bg-accent-50"
                        >
                          {TAG_KURZ.format(new Date(t.zeiten[0]))}
                          <span className="block text-[11px] font-normal text-slate-400">{t.zeiten.length} frei</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : !zeit ? (
              <>
                <button onClick={() => setTag(null)} className="mb-3 flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline">
                  <ChevronLeft size={14} /> anderer Tag
                </button>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Clock size={15} className="text-slate-400" /> 2. Uhrzeit wählen · {TAG_LANG.format(new Date(gewaehlterTag.zeiten[0]))}
                </h2>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {gewaehlterTag.zeiten.map((z) => (
                    <button
                      key={z}
                      onClick={() => { setZeit(z); setFehler('') }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-center text-sm font-medium text-slate-700 hover:border-accent-400 hover:bg-accent-50"
                    >
                      {UHR.format(new Date(z))} Uhr
                    </button>
                  ))}
                </div>
                {andereZeitzone() && <p className="mt-3 text-xs text-slate-400">Alle Uhrzeiten in deutscher Zeit.</p>}
              </>
            ) : (
              <>
                <button onClick={() => setZeit(null)} className="mb-3 flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline">
                  <ChevronLeft size={14} /> andere Uhrzeit
                </button>
                <div className="mb-4 rounded-lg bg-accent-50 p-3 text-sm text-accent-800">
                  <span className="font-medium">{TAG_LANG.format(new Date(zeit))}</span>, {UHR.format(new Date(zeit))}–{UHR.format(new Date(new Date(zeit).getTime() + info.dauer_min * 60000))} Uhr
                </div>
                <h2 className="mb-3 text-sm font-semibold text-slate-700">3. Ihre Angaben</h2>
                <Field label="Name*">
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
                </Field>
                <Field label="E-Mail*">
                  <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} />
                </Field>
                <Field label="Telefon (freiwillig)">
                  <input type="tel" className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} autoComplete="tel" maxLength={40} />
                </Field>
                <Field label="Worum geht es? (freiwillig)">
                  <textarea className={inputClass} rows={4} value={nachricht} onChange={(e) => setNachricht(e.target.value)} maxLength={2000} />
                </Field>
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label>
                    Webseite
                    <input tabIndex={-1} autoComplete="off" value={webseite} onChange={(e) => setWebseite(e.target.value)} />
                  </label>
                </div>
                <p className="mb-4 text-xs text-slate-400">Mit Stern gekennzeichnete Felder bitte ausfüllen. Ihre Angaben verwenden wir nur für diesen Termin.</p>
                {fehler && <p className="mb-3 text-sm font-medium text-rose-600">{fehler}</p>}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <SecondaryButton onClick={() => setZeit(null)} disabled={senden} className="justify-center">Zurück</SecondaryButton>
                  <PrimaryButton onClick={buchen} disabled={senden} className="justify-center">
                    {senden ? 'Wird gebucht …' : 'Termin verbindlich buchen'}
                  </PrimaryButton>
                </div>
              </>
            )}
            {fehler && !zeit && <p className="mt-3 text-sm font-medium text-rose-600">{fehler}</p>}
          </Card>
        )}
      </div>
      <DatenschutzHinweis />
    </div>
  )
}
