import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Lock, Plane, Send, Trash2, User } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { Card, Field, inputClass, PrimaryButton, PasswortInput } from '../../components/ui'
import { today, fmtDate, uid } from '../../lib/dates'
import { CURRENT_USER } from '../../data/constants'
import { updateMyProfilRemote } from '../../lib/profilSync'

// Vertretungs-Logik (Quirin, Entscheidung 2026-11-03): "offener Pool" ohne feste Vertreter-
// Zuordnung — jeder trägt seine eigene Abwesenheit (von–bis) selbst ein, GF/Admin sehen während
// dieses Zeitraums die offenen Follow-ups/Aufgaben zusätzlich auf dem Heute-Screen (siehe
// HeuteScreen.tsx), ohne dass verantwortlich/zustaendig umgebucht wird.
function AbwesenheitVerwalten() {
  const { state, dispatch } = useApp()
  const [von, setVon] = useState(today())
  const [bis, setBis] = useState(today())
  const [fehler, setFehler] = useState('')

  const eigene = state.abwesenheiten
    .filter((a) => a.mitarbeiterName === CURRENT_USER)
    .sort((a, b) => b.von.localeCompare(a.von))

  function hinzufuegen() {
    if (bis < von) {
      setFehler('Das Enddatum muss nach dem Startdatum liegen.')
      return
    }
    setFehler('')
    dispatch({ type: 'ADD_ABWESENHEIT', abwesenheit: { id: uid('abw'), mitarbeiterName: CURRENT_USER, von, bis } })
  }

  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Plane size={14} /> Abwesenheit
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        In diesem Zeitraum sehen Geschäftsführung/Admin deine offenen Follow-ups und Aufgaben zusätzlich auf ihrem
        Heute-Screen — sie bleiben bei dir zugeordnet, werden nur zur Vertretung sichtbar gemacht.
      </p>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="Von">
          <input type="date" className={inputClass} value={von} onChange={(e) => setVon(e.target.value)} />
        </Field>
        <Field label="Bis">
          <input type="date" className={inputClass} value={bis} onChange={(e) => setBis(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <button
            onClick={hinzufuegen}
            className="w-full rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700"
          >
            Eintragen
          </button>
        </div>
      </div>
      {fehler && <p className="mb-2 text-sm font-medium text-rose-600">{fehler}</p>}
      {eigene.length > 0 && (
        <ul className="flex flex-col gap-2">
          {eigene.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="flex-1 text-slate-700">
                {fmtDate(a.von)} – {fmtDate(a.bis)}
                {a.bis >= today() && a.von <= today() ? <span className="ml-2 text-xs font-medium text-amber-600">aktuell</span> : null}
              </span>
              <button
                onClick={() => dispatch({ type: 'DELETE_ABWESENHEIT', id: a.id })}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                title="Löschen"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PasswortSetzen() {
  const [passwort, setPasswort] = useState('')
  const [passwortWiederholen, setPasswortWiederholen] = useState('')
  const [speichern, setSpeichern] = useState(false)
  const [fehler, setFehler] = useState('')
  const [erfolg, setErfolg] = useState(false)

  async function absenden() {
    if (passwort.length < 8) {
      setFehler('Mindestens 8 Zeichen.')
      return
    }
    if (passwort !== passwortWiederholen) {
      setFehler('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setFehler('')
    setSpeichern(true)
    try {
      const { error } = await supabase!.auth.updateUser({ password: passwort })
      if (error) throw new Error(error.message)
      setErfolg(true)
      setPasswort('')
      setPasswortWiederholen('')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Passwort konnte nicht gesetzt werden.')
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Lock size={14} /> Passwort setzen
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        Wenn du über einen Einladungs-Link hierher gekommen bist, setz dir hier dein eigenes Passwort — danach kannst du dich
        damit normal über die Login-Seite anmelden.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Neues Passwort">
          <PasswortInput value={passwort} onChange={setPasswort} autoComplete="new-password" />
        </Field>
        <Field label="Passwort wiederholen">
          <PasswortInput value={passwortWiederholen} onChange={setPasswortWiederholen} autoComplete="new-password" />
        </Field>
      </div>
      {fehler && <p className="mb-2 text-sm font-medium text-rose-600">{fehler}</p>}
      {erfolg && <p className="mb-2 text-sm font-medium text-emerald-600">Passwort gesetzt — ab jetzt damit anmelden.</p>}
      <PrimaryButton onClick={absenden} disabled={speichern || !passwort || !passwortWiederholen}>
        {speichern ? 'Speichert …' : 'Passwort speichern'}
      </PrimaryButton>
    </Card>
  )
}

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined

// Verknüpfung mit dem Telegram-Bot (zusätzlicher Kanal für den KI-Assistenten, siehe
// supabase/functions/telegram-gateway) — Mitarbeiter erzeugen sich hier einen Einmal-Code, schicken
// ihn per Telegram-Deep-Link an den Bot ("/start <code>"), der Webhook verknüpft dann chat_id <->
// mitarbeiter.id. Status (verbunden/nicht) wird direkt aus der eigenen mitarbeiter-Zeile gelesen.
function TelegramVerbinden() {
  const { session } = useAuth()
  const [chatId, setChatId] = useState<number | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [code, setCode] = useState<string | null>(null)
  const [erzeugen, setErzeugen] = useState(false)
  const [fehler, setFehler] = useState('')

  async function laden() {
    if (!supabase || !session?.user?.email) return
    const { data } = await supabase.from('mitarbeiter').select('telegram_chat_id').eq('email', session.user.email).maybeSingle()
    setChatId(data?.telegram_chat_id ?? null)
    setLaedt(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.email])

  async function linkErzeugen() {
    if (!supabase) return
    setErzeugen(true)
    setFehler('')
    try {
      const { data, error } = await supabase.rpc('generate_my_telegram_link_code')
      if (error) throw new Error(error.message)
      setCode(data as string)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Link konnte nicht erzeugt werden.')
    } finally {
      setErzeugen(false)
    }
  }

  async function trennen() {
    if (!supabase) return
    await supabase.rpc('clear_my_telegram_link')
    setChatId(null)
    setCode(null)
    laden()
  }

  if (laedt) return null

  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Send size={14} /> Telegram-Assistent
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        Verknüpfe dein Telegram, um dem CRM-Assistenten direkt per Telegram zu schreiben — Notizen, Aufgaben, Fragen zu
        Kunden, genau wie im KI-Chat hier.
      </p>
      {chatId ? (
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 size={15} /> Verbunden
          </p>
          <button onClick={trennen} className="text-sm font-medium text-rose-600 hover:underline">
            Verbindung trennen
          </button>
        </div>
      ) : code ? (
        <div>
          {TELEGRAM_BOT_USERNAME ? (
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`}
              target="_blank"
              rel="noreferrer"
              className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              <Send size={14} /> In Telegram öffnen & verbinden
            </a>
          ) : (
            <p className="mb-2 text-sm text-slate-600">
              Schick dem Bot in Telegram: <code className="rounded bg-slate-100 px-1.5 py-0.5">/start {code}</code>
            </p>
          )}
          <p className="text-xs text-slate-400">Klick danach hier auf "Status aktualisieren", sobald du in Telegram verbunden bist.</p>
          <button onClick={laden} className="mt-2 text-sm font-medium text-accent-600 hover:underline">
            Status aktualisieren
          </button>
        </div>
      ) : (
        <PrimaryButton onClick={linkErzeugen} disabled={erzeugen}>
          {erzeugen ? 'Erzeugt …' : 'Mit Telegram verbinden'}
        </PrimaryButton>
      )}
      {fehler && <p className="mt-2 text-sm font-medium text-rose-600">{fehler}</p>}
    </Card>
  )
}

export function MeinProfil() {
  const { state, dispatch } = useApp()
  const { session } = useAuth()
  const [name, setName] = useState(state.profil.name)
  const [telefon, setTelefon] = useState(state.profil.telefon)
  const [email, setEmail] = useState(state.profil.email)
  const [signaturHtml, setSignaturHtml] = useState(state.profil.signaturHtml)
  const [buchungslink, setBuchungslink] = useState(state.profil.buchungslink ?? '')
  const [fotoDataUrl, setFotoDataUrl] = useState(state.profil.fotoDataUrl)
  const [gespeichert, setGespeichert] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const letzterSyncRef = useRef(state.profil)

  // telefon/signaturHtml/fotoDataUrl/buchungslink können jetzt serverseitig NACH dem Mounten dieser
  // Seite eintreffen (eigene mitarbeiter-Zeile lädt asynchron, siehe AppContext.tsx) — ohne diesen
  // Effekt bliebe das Formular bei den anfänglichen (ggf. leeren) Werten stehen. Übernimmt neue
  // Werte aber nur, solange der Nutzer seit dem letzten Sync noch nichts selbst geändert hat, damit
  // eine laufende Bearbeitung nicht überschrieben wird.
  useEffect(() => {
    const unveraendert =
      name === letzterSyncRef.current.name &&
      telefon === letzterSyncRef.current.telefon &&
      email === letzterSyncRef.current.email &&
      signaturHtml === letzterSyncRef.current.signaturHtml &&
      (buchungslink || '') === (letzterSyncRef.current.buchungslink ?? '') &&
      fotoDataUrl === letzterSyncRef.current.fotoDataUrl
    if (unveraendert) {
      setName(state.profil.name)
      setTelefon(state.profil.telefon)
      setEmail(state.profil.email)
      setSignaturHtml(state.profil.signaturHtml)
      setBuchungslink(state.profil.buchungslink ?? '')
      setFotoDataUrl(state.profil.fotoDataUrl)
    }
    letzterSyncRef.current = state.profil
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.profil])

  function handleFoto(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setFotoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  function speichern() {
    dispatch({ type: 'UPDATE_PROFIL', patch: { name, telefon, email, signaturHtml, fotoDataUrl, buchungslink } })
    updateMyProfilRemote(telefon, signaturHtml, fotoDataUrl, buchungslink).catch((err) =>
      console.error('Profil konnte nicht geräteübergreifend gespeichert werden:', err),
    )
    setGespeichert(true)
    setTimeout(() => setGespeichert(false), 2500)
  }

  function buchungslinkInSignaturEinfuegen() {
    if (!buchungslink.trim()) return
    setSignaturHtml((s) => `${s}\n<p><a href="${buchungslink.trim()}">Termin direkt online buchen</a></p>`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mein Profil</h1>
      <p className="mb-5 text-sm text-slate-500">Persönliche Daten und E-Mail-Signatur.</p>

      <AbwesenheitVerwalten />

      {isSupabaseConfigured && session ? (
        <>
          <TelegramVerbinden />
          <PasswortSetzen />
        </>
      ) : (
        <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          Diese Angaben sind aktuell lokal auf diesem Gerät gespeichert — sobald echte
          Mitarbeiter-Logins eingerichtet sind, wird daraus ein echtes, pro Person gespeichertes Profil.
        </div>
      )}

      <Card className="p-5">
        <div className="mb-5 flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400"
            title="Profilbild ändern"
          >
            {fotoDataUrl ? <img src={fotoDataUrl} alt="Profilbild" className="h-full w-full object-cover" /> : <User size={28} />}
            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/40 group-hover:opacity-100">
              <Camera size={16} />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFoto(e.target.files?.[0])}
          />
          <div>
            <p className="text-sm font-medium text-slate-800">{name || 'Unbenannt'}</p>
            <button onClick={() => fileInputRef.current?.click()} className="text-xs text-accent-600 hover:underline">
              Profilbild ändern
            </button>
          </div>
        </div>

        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefon">
          <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+49 ..." />
        </Field>
        <Field label="E-Mail-Adresse">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@amayer-holding.com" />
        </Field>
        <Field label="Buchungslink (z. B. Calendly)">
          <div className="flex gap-2">
            <input className={inputClass} value={buchungslink} onChange={(e) => setBuchungslink(e.target.value)} placeholder="https://calendly.com/..." />
            <button
              onClick={buchungslinkInSignaturEinfuegen}
              disabled={!buchungslink.trim()}
              className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              In Signatur einfügen
            </button>
          </div>
        </Field>
      </Card>

      <Card className="mt-5 p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">E-Mail-Signatur (HTML)</h3>
        <p className="mb-3 text-xs text-slate-400">Wird an gesendete E-Mails aus dem Postfach angehängt.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            value={signaturHtml}
            onChange={(e) => setSignaturHtml(e.target.value)}
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Vorschau</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: signaturHtml }} />
          </div>
        </div>
      </Card>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={speichern}>Speichern</PrimaryButton>
        {gespeichert && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 size={15} /> Gespeichert
          </span>
        )}
      </div>
    </div>
  )
}
