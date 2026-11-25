// „Meine Erinnerungen“ (25.11.2026): Erinnerungen sind kein To-do — eigene Karte auf „Heute“ und eigene Seite
// /erinnerungen (Link oben in der To-do-Liste), NICHT in der To-do-Liste selbst. Anlegen, verschieben, erledigt, löschen.
// Die Erinnerung kommt zur Uhrzeit per Telegram (Server). Daten: src/lib/erinnerungen.ts.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, Check, Clock3, Plus, Repeat, Trash2, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { ladeKollegen, type Kollege } from '../lib/kalenderDb'
import {
  alsEingabe, type Erinnerung, erledigeErinnerung, ladeErinnerungen, legeErinnerungAn, loescheErinnerung, morgenNeun, verschiebeErinnerung,
  vorschlagZeit, type Wiederholung, WIEDERHOLUNG_LABEL, zeitText,
} from '../lib/erinnerungen'
import { Card, inputClass, PrimaryButton, SecondaryButton } from './ui'

const STUNDE = 60 * 60 * 1000

export function MeineErinnerungen({ voll = false }: { voll?: boolean }) {
  const { session, mitarbeiter, ansichtAls } = useAuth()
  const ich = (session?.user.email ?? '').toLowerCase()
  const [liste, setListe] = useState<Erinnerung[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [neuOffen, setNeuOffen] = useState(false)
  const [verschiebe, setVerschiebe] = useState<{ id: string; wert: string } | null>(null)
  const [kollegen, setKollegen] = useState<Kollege[]>([])
  const [form, setForm] = useState({ text: '', wann: alsEingabe(vorschlagZeit()), fuer: '', wiederholung: '' as Wiederholung })

  async function laden() {
    if (!ich) return
    try {
      setListe(await ladeErinnerungen(ich))
      setFehler('')
    } catch (err) {
      setListe([])
      setFehler(err instanceof Error ? err.message : 'Erinnerungen ließen sich nicht laden.')
    }
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ich])

  useEffect(() => {
    if (ich) ladeKollegen().then(setKollegen).catch(() => setKollegen([]))
  }, [ich])

  // Ohne Datenbank oder in „Ansehen als“ (würde die eigenen statt der angesehenen Person zeigen): nichts.
  if (!isSupabaseConfigured || !session || ansichtAls) return null
  if (liste === null) return null

  const jetzt = Date.now()
  // An mich: noch nicht verschickt (oder wiederkehrend) — und verschickte der letzten 12 Stunden zum Abhaken/Verschieben.
  const anMich = liste.filter((e) => e.fuerEmail === ich && (!e.gesendetAm || e.wiederholung || jetzt - Date.parse(e.gesendetAm) < 12 * STUNDE))
  const fuerAndere = liste.filter((e) => e.fuerEmail !== ich && e.vonEmail === ich && (!e.gesendetAm || e.wiederholung))
  const nameVon = new Map(kollegen.map((k) => [k.email, k.name]))

  // Auf „Heute“ nur zeigen, wenn es etwas gibt — außer man legt gerade eine an.
  if (!voll && anMich.length === 0 && fuerAndere.length === 0 && !neuOffen && !fehler) {
    return (
      <div className="mb-5 flex justify-end">
        <button type="button" onClick={() => setNeuOffen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-accent-700">
          <AlarmClock size={13} /> Erinnerung anlegen
        </button>
      </div>
    )
  }

  async function mache(id: string, f: () => Promise<void>) {
    setLaeuft(id)
    setFehler('')
    try {
      await f()
      await laden()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft(null)
    }
  }

  async function anlegen() {
    const text = form.text.trim()
    if (!text) return setFehler('Woran soll erinnert werden?')
    const wann = new Date(form.wann)
    if (Number.isNaN(wann.getTime()) || wann.getTime() < Date.now() - 60000) return setFehler('Bitte einen Zeitpunkt in der Zukunft wählen.')
    await mache('neu', async () => {
      await legeErinnerungAn({ fuerEmail: form.fuer || ich, vonEmail: ich, vonName: mitarbeiter?.name ?? '', text, faelligUm: wann.toISOString(), wiederholung: form.wiederholung })
      setForm({ text: '', wann: alsEingabe(vorschlagZeit()), fuer: '', wiederholung: '' })
      setNeuOffen(false)
    })
  }

  const zeile = (e: Erinnerung, fuerKollege: boolean) => {
    const verschickt = !!e.gesendetAm && !e.wiederholung
    return (
      <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2.5">
          <AlarmClock size={15} className={`mt-0.5 shrink-0 ${verschickt ? 'text-slate-400' : 'text-amber-500'}`} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-slate-800">{e.text}</p>
            <p className="text-xs text-slate-400">
              {zeitText(e.faelligUm)}
              {e.wiederholung && (
                <span className="ml-1 inline-flex items-center gap-0.5">
                  · <Repeat size={10} /> {WIEDERHOLUNG_LABEL[e.wiederholung]}
                </span>
              )}
              {fuerKollege && ` · für ${nameVon.get(e.fuerEmail) ?? e.fuerEmail}`}
              {!fuerKollege && e.vonEmail && e.vonEmail !== ich && ` · von ${e.vonName ?? e.vonEmail}`}
              {verschickt && ' · per Telegram verschickt'}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <button
              onClick={() => mache(e.id, () => verschiebeErinnerung(e.id, new Date(Math.max(Date.now(), verschickt ? 0 : Date.parse(e.faelligUm)) + STUNDE).toISOString()))}
              disabled={laeuft !== null}
              className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              title="1 Stunde später"
            >
              <Clock3 size={15} />
            </button>
            <button
              onClick={() => setVerschiebe(verschiebe?.id === e.id ? null : { id: e.id, wert: alsEingabe(verschickt ? morgenNeun() : e.faelligUm) })}
              disabled={laeuft !== null}
              className="rounded-md px-1.5 py-2 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              title="Anderen Zeitpunkt wählen"
            >
              Verschieben
            </button>
            {!fuerKollege && !e.wiederholung && (
              <button
                onClick={() => mache(e.id, () => erledigeErinnerung(e.id))}
                disabled={laeuft !== null}
                className="rounded-md p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50"
                title="Erledigt"
              >
                <Check size={15} />
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm(`Erinnerung „${e.text}“ löschen?`)) mache(e.id, () => loescheErinnerung(e.id))
              }}
              disabled={laeuft !== null}
              className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
              title="Löschen"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        {verschiebe?.id === e.id && (
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
            <input type="datetime-local" value={verschiebe.wert} onChange={(ev) => setVerschiebe({ id: e.id, wert: ev.target.value })} className={`${inputClass} w-auto`} />
            <SecondaryButton
              onClick={() => {
                const d = new Date(verschiebe.wert)
                if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 60000) return setFehler('Bitte einen Zeitpunkt in der Zukunft wählen.')
                mache(e.id, async () => {
                  await verschiebeErinnerung(e.id, d.toISOString())
                  setVerschiebe(null)
                })
              }}
              disabled={laeuft !== null}
            >
              Speichern
            </SecondaryButton>
            <button type="button" onClick={() => setVerschiebe(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" title="Abbrechen">
              <X size={14} />
            </button>
          </div>
        )}
      </li>
    )
  }

  return (
    <Card className="mb-5 p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <AlarmClock size={14} className="text-amber-500" /> Meine Erinnerungen
          {anMich.length > 0 && <span className="text-xs font-normal text-slate-400">({anMich.length})</span>}
        </h2>
        <div className="flex items-center gap-3">
          {!voll && (
            <Link to="/erinnerungen" className="text-xs text-slate-500 hover:text-accent-700">
              Alle
            </Link>
          )}
          {!neuOffen && (
            <button type="button" onClick={() => setNeuOffen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline">
              <Plus size={13} /> Neue Erinnerung
            </button>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-400">Kommt zur Uhrzeit per Telegram. Erinnerungen sind keine To-dos — sie stehen nicht in der To-do-Liste.</p>
      {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {neuOffen && (
        <div className="mb-3 space-y-2 rounded-lg border border-slate-200 p-3">
          <input
            autoFocus
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            placeholder="Woran? z. B. Bank anrufen"
            maxLength={500}
            className={inputClass}
            onKeyDown={(e) => e.key === 'Enter' && anlegen()}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="datetime-local" value={form.wann} onChange={(e) => setForm({ ...form, wann: e.target.value })} className={inputClass} />
            <select value={form.fuer} onChange={(e) => setForm({ ...form, fuer: e.target.value })} className={inputClass}>
              <option value="">für mich</option>
              {kollegen
                .filter((k) => k.email !== ich)
                .map((k) => (
                  <option key={k.email} value={k.email}>
                    für {k.name}
                  </option>
                ))}
            </select>
            <select value={form.wiederholung} onChange={(e) => setForm({ ...form, wiederholung: e.target.value as Wiederholung })} className={inputClass}>
              {(Object.keys(WIEDERHOLUNG_LABEL) as Wiederholung[]).map((w) => (
                <option key={w} value={w}>
                  {WIEDERHOLUNG_LABEL[w]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={() => setNeuOffen(false)}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={anlegen} disabled={laeuft !== null}>
              Speichern
            </PrimaryButton>
          </div>
        </div>
      )}

      {anMich.length === 0 && !neuOffen && <p className="text-sm text-slate-400">Keine offenen Erinnerungen.</p>}
      {anMich.length > 0 && <ul className="flex flex-col gap-2">{anMich.map((e) => zeile(e, false))}</ul>}
      {fuerAndere.length > 0 && (
        <details className="mt-3" open={voll}>
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">Von mir für Kollegen ({fuerAndere.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">{fuerAndere.map((e) => zeile(e, true))}</ul>
        </details>
      )}
    </Card>
  )
}

/** Seite /erinnerungen (Link aus der To-do-Liste und von der Karte auf „Heute“). */
export function ErinnerungenSeite() {
  return (
    <div className="mx-auto max-w-3xl">
      <MeineErinnerungen voll />
    </div>
  )
}
