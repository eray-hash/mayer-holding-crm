import { useEffect, useRef, useState } from 'react'
import { MeinPostfachAbschnitt } from '../../components/PostfachEinstellungen'
import { AlertTriangle, Camera, CheckCircle2, Lock, Plane, Send, Trash2, User } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { Card, Field, inputClass, PrimaryButton, PasswortInput } from '../../components/ui'
import { today, fmtDate, uid } from '../../lib/dates'
import { CURRENT_USER } from '../../data/constants'
import { updateMyProfilRemote } from '../../lib/profilSync'
import { LEERER_ZUSATZ, ladeFirmenKontaktCrm, ladeProfilZusatz, speichereProfilZusatz, type ProfilZusatz } from '../../lib/meinProfilZusatz'
import { FirmenTelefonEinstellung, ProfilLueckenKarte } from '../../components/ProfilVollstaendigkeit'
import {
  firmenKontaktAus,
  profilLuecken,
  pruefeTelefon,
  telefonAusSignatur,
  type FirmenKontakt,
} from '../../../supabase/functions/_shared/profilKern.ts'

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

// Morgen-Übersicht und Wochenbericht per Telegram an- oder abschalten (verschickt vom Server, siehe
// supabase/functions/email-gateway/tagesmeldung.ts). Gespeichert in der eigenen Zeile von
// kalender_einstellungen — wie die Kalender-Einstellungen nur mit den eigenen Spalten, damit
// Erinnerungen, Sichtbarkeit und Abo-Kennung unberührt bleiben. Keine Zeile = beides an.
type MeldungSpalte = 'morgen_uebersicht' | 'wochenbericht'

function TelegramMeldungen() {
  const { session, mitarbeiter } = useAuth()
  const email = (session?.user?.email ?? '').toLowerCase()
  const gf = mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin
  const [werte, setWerte] = useState<Record<MeldungSpalte, boolean> | null>(null)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!supabase || !email) return
    let aktiv = true
    supabase
      .from('kalender_einstellungen')
      .select('morgen_uebersicht, wochenbericht')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv) return
        if (error) {
          setFehler('Die Einstellungen konnten nicht geladen werden.')
          return
        }
        setWerte({ morgen_uebersicht: data?.morgen_uebersicht !== false, wochenbericht: data?.wochenbericht !== false })
      })
    return () => {
      aktiv = false
    }
  }, [email])

  async function speichern(spalte: MeldungSpalte, wert: boolean) {
    if (!supabase || !email || !werte) return
    const vorher = werte
    setWerte({ ...werte, [spalte]: wert })
    setFehler('')
    try {
      const aenderung = { [spalte]: wert, geaendert_am: new Date().toISOString() }
      const { data, error } = await supabase.from('kalender_einstellungen').update(aenderung).eq('email', email).select('email')
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) {
        // Noch keine eigene Zeile: mit denselben Grundwerten anlegen wie der Kalender.
        const { error: anlegeFehler } = await supabase.from('kalender_einstellungen').insert({ email, erinnerungen: [60], sichtbar: true, ...aenderung })
        if (anlegeFehler && anlegeFehler.code !== '23505') throw new Error(anlegeFehler.message)
        if (anlegeFehler) {
          // Gleichzeitig angelegt (z. B. im Kalender): dann nur die eigene Spalte ändern.
          const { data: zweite, error: zweiter } = await supabase.from('kalender_einstellungen').update(aenderung).eq('email', email).select('email')
          if (zweiter || !zweite?.length) throw new Error(zweiter?.message ?? 'nicht gespeichert')
        }
      }
    } catch {
      setWerte(vorher)
      setFehler('Die Einstellung konnte nicht gespeichert werden. Bitte später noch einmal versuchen.')
    }
  }

  if (!werte) return fehler ? <p className="mt-3 text-xs font-medium text-rose-600">{fehler}</p> : null

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={werte.morgen_uebersicht} onChange={(e) => speichern('morgen_uebersicht', e.target.checked)} />
        <span>
          Morgen-Übersicht um 8 Uhr per Telegram
          <span className="block text-xs text-slate-500">
            Montag bis Freitag: deine Termine, fälligen Wiedervorlagen und Aufgaben des Tages. Steht nichts an, kommt keine Nachricht.
          </span>
        </span>
      </label>
      {gf && (
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={werte.wochenbericht} onChange={(e) => speichern('wochenbericht', e.target.checked)} />
          <span>
            Wochenbericht freitags um 16 Uhr
            <span className="block text-xs text-slate-500">Neue Akten, Rechnungen, Objekte, Treffer und offene Fragen der Woche in Zahlen.</span>
          </span>
        </label>
      )}
      {fehler && <p className="mt-2 text-xs font-medium text-rose-600">{fehler}</p>}
    </div>
  )
}

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
  const [kopiert, setKopiert] = useState(false)

  async function laden() {
    if (!supabase || !session?.user?.email) return
    const { data } = await supabase.from('mitarbeiter').select('telegram_chat_id').eq('email', session.user.email).maybeSingle()
    setChatId(data?.telegram_chat_id ?? null)
    if (data?.telegram_chat_id) merkeCode(null)
    setLaedt(false)
  }

  // Der offene Code bleibt für dieses Browserfenster gemerkt: Wer zu Telegram wechselt und zurückkommt
  // (das Handy lädt die Seite dabei oft neu), soll nicht versehentlich einen neuen Code erzeugen — der
  // alte wäre damit ungültig.
  const merkSchluessel = `telegram-code:${session?.user?.email ?? ''}`
  function merkeCode(wert: string | null) {
    try {
      if (wert) sessionStorage.setItem(merkSchluessel, wert)
      else sessionStorage.removeItem(merkSchluessel)
    } catch {
      // Ohne Browserspeicher gilt der Code eben nur, solange die Seite offen bleibt.
    }
  }

  useEffect(() => {
    try {
      setCode(sessionStorage.getItem(merkSchluessel))
    } catch {
      setCode(null)
    }
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
      merkeCode(data as string)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Link konnte nicht erzeugt werden.')
    } finally {
      setErzeugen(false)
    }
  }

  // Solange ein Code offen ist, selbst nachsehen, ob Telegram inzwischen verbunden ist (höchstens 15 Minuten).
  useEffect(() => {
    if (!code || chatId) return
    const beginn = Date.now()
    const takt = window.setInterval(() => {
      if (Date.now() - beginn > 15 * 60_000) window.clearInterval(takt)
      else if (document.visibilityState === 'visible') laden()
    }, 4000)
    const beiRueckkehr = () => {
      if (document.visibilityState === 'visible') laden()
    }
    document.addEventListener('visibilitychange', beiRueckkehr)
    return () => {
      window.clearInterval(takt)
      document.removeEventListener('visibilitychange', beiRueckkehr)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, chatId])

  async function codeKopieren() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      // Zwischenablage gesperrt: Der Code steht sichtbar da und lässt sich von Hand markieren.
    }
  }

  async function trennen() {
    if (!supabase) return
    await supabase.rpc('clear_my_telegram_link')
    merkeCode(null)
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
        <>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 size={15} /> Verbunden
            </p>
            <button onClick={trennen} className="text-sm font-medium text-rose-600 hover:underline">
              Verbindung trennen
            </button>
          </div>
          <TelegramMeldungen />
        </>
      ) : code ? (
        <div>
          <ol className="mb-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
            {TELEGRAM_BOT_USERNAME && (
              <li>
                <a
                  href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700"
                >
                  <Send size={14} /> In Telegram öffnen
                </a>
                <span className="mt-1 block text-xs text-slate-500">
                  Am besten auf dem Handy, auf dem Telegram läuft. Telegram öffnet den Chat mit dem Assistenten.
                </span>
              </li>
            )}
            <li>
              In Telegram ganz unten auf <strong>„Starten“</strong> tippen. Erst damit wird die Verbindung hergestellt.
            </li>
          </ol>
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-600">Passiert in Telegram nichts?</p>
            <p className="mt-1 text-xs text-slate-500">
              Dann öffne in Telegram den Chat mit dem Assistenten
              {TELEGRAM_BOT_USERNAME ? ` (Suche: @${TELEGRAM_BOT_USERNAME})` : ''} und schick ihm diesen Code als ganz normale Nachricht:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="select-all rounded bg-white px-2.5 py-1.5 text-base font-semibold tracking-widest text-slate-800 ring-1 ring-slate-200">
                {code}
              </code>
              <button onClick={codeKopieren} className="text-sm font-medium text-accent-600 hover:underline">
                {kopiert ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Diese Seite merkt von selbst, wenn die Verbindung steht. Der Code gilt, bis du einen neuen erzeugst.
          </p>
          <button onClick={linkErzeugen} disabled={erzeugen} className="mt-2 text-sm font-medium text-accent-600 hover:underline">
            {erzeugen ? 'Erzeugt …' : 'Neuen Code erzeugen'}
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
  const { session, mitarbeiter } = useAuth()
  const [name, setName] = useState(state.profil.name)
  const [telefon, setTelefon] = useState(state.profil.telefon)
  const [email, setEmail] = useState(state.profil.email)
  const [signaturHtml, setSignaturHtml] = useState(state.profil.signaturHtml)
  const [buchungslink, setBuchungslink] = useState(state.profil.buchungslink ?? '')
  const [fotoDataUrl, setFotoDataUrl] = useState(state.profil.fotoDataUrl)
  const [gespeichert, setGespeichert] = useState(false)
  const [fehler, setFehler] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const letzterSyncRef = useRef(state.profil)

  // Zusatzangaben (Mobil, Funktion, Nachfrage-Einstellung) aus mitarbeiter_profil und die
  // Firmen-Ersatznummer — für Formular und Vollständigkeits-Karte (Runde 5, 22.11.2026).
  const [zusatzGespeichert, setZusatzGespeichert] = useState<ProfilZusatz | null>(null)
  const [mobil, setMobil] = useState('')
  const [position, setPosition] = useState('')
  const [firma, setFirma] = useState<FirmenKontakt>(firmenKontaktAus(null))
  useEffect(() => {
    if (!isSupabaseConfigured || !mitarbeiter?.id) return
    let aktiv = true
    Promise.all([ladeProfilZusatz(mitarbeiter.id), ladeFirmenKontaktCrm()])
      .then(([z, f]) => {
        if (!aktiv) return
        setZusatzGespeichert(z)
        setMobil(z.mobil)
        setPosition(z.position)
        setFirma(f)
      })
      .catch(() => {
        if (aktiv) setZusatzGespeichert(LEERER_ZUSATZ)
      })
    return () => {
      aktiv = false
    }
  }, [mitarbeiter?.id])

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
    const tel = pruefeTelefon(telefon)
    const mob = pruefeTelefon(mobil)
    if (!tel.ok || !mob.ok) {
      setFehler(!tel.ok ? `Telefon: ${tel.grund}` : `Mobil: ${!mob.ok ? mob.grund : ''}`)
      return
    }
    setFehler('')
    const telefonSauber = tel.wert
    setTelefon(telefonSauber)
    setMobil(mob.wert)
    dispatch({ type: 'UPDATE_PROFIL', patch: { name, telefon: telefonSauber, email, signaturHtml, fotoDataUrl, buchungslink } })
    updateMyProfilRemote(telefonSauber, signaturHtml, fotoDataUrl, buchungslink).catch((err) =>
      console.error('Profil konnte nicht geräteübergreifend gespeichert werden:', err),
    )
    // Mobil/Funktion nur schreiben, wenn sie sich geändert haben (eigene Zeile in mitarbeiter_profil).
    if (isSupabaseConfigured && mitarbeiter?.id && zusatzGespeichert) {
      const patch: Partial<ProfilZusatz> = {}
      if (mob.wert !== zusatzGespeichert.mobil) patch.mobil = mob.wert
      if (position.trim() !== zusatzGespeichert.position) patch.position = position.trim()
      if (Object.keys(patch).length) {
        speichereProfilZusatz(mitarbeiter.id, patch)
          .then(() => setZusatzGespeichert({ ...zusatzGespeichert, ...patch }))
          .catch(() => setFehler('Mobil und Funktion konnten nicht gespeichert werden. Bitte später noch einmal versuchen.'))
      }
    }
    setGespeichert(true)
    setTimeout(() => setGespeichert(false), 2500)
  }

  async function nachfrageUmschalten(an: boolean) {
    if (!mitarbeiter?.id || !zusatzGespeichert) return
    const vorher = zusatzGespeichert
    setZusatzGespeichert({ ...vorher, profilNachfrage: an })
    try {
      await speichereProfilZusatz(mitarbeiter.id, { profilNachfrage: an })
    } catch {
      setZusatzGespeichert(vorher)
      setFehler('Die Einstellung konnte nicht gespeichert werden.')
    }
  }

  // Vollständigkeit nach dem gespeicherten Stand (nicht nach halb getippten Feldern).
  const luecken = zusatzGespeichert
    ? profilLuecken(
        { telefon: state.profil.telefon, mobil: zusatzGespeichert.mobil, signatur: state.profil.signaturHtml, position: zusatzGespeichert.position },
        firma,
      )
    : []
  const signaturTelefon = !telefon.trim() && !mobil.trim() ? telefonAusSignatur(signaturHtml) : ''

  function buchungslinkInSignaturEinfuegen() {
    if (!buchungslink.trim()) return
    setSignaturHtml((s) => `${s}\n<p><a href="${buchungslink.trim()}">Termin direkt online buchen</a></p>`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mein Profil</h1>
      <p className="mb-5 text-sm text-slate-500">Persönliche Daten und E-Mail-Signatur.</p>

      <ProfilLueckenKarte luecken={luecken} signaturTelefon={signaturTelefon} onTelefonUebernehmen={(n) => setTelefon(n)} />

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
        <Field label="Telefon (erscheint in Mails an Interessenten, im Kundenbereich und im Exposé)">
          <input className={inputClass} type="tel" value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+49 ..." />
        </Field>
        {isSupabaseConfigured && zusatzGespeichert && (
          <>
            <Field label="Mobil (freiwillig; wird genommen, wenn kein Telefon eingetragen ist)">
              <input className={inputClass} type="tel" value={mobil} onChange={(e) => setMobil(e.target.value)} placeholder="+49 176 ..." />
            </Field>
            <Field label="Funktion">
              <input className={inputClass} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="z. B. Immobilienberater" />
            </Field>
          </>
        )}
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
        {isSupabaseConfigured && zusatzGespeichert && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={zusatzGespeichert.profilNachfrage}
              onChange={(e) => nachfrageUmschalten(e.target.checked)}
            />
            <span>
              Der Telegram-Assistent darf mich einmal nach meiner Telefonnummer fragen
              <span className="block text-xs text-slate-500">Er fragt höchstens ein einziges Mal und nur, wenn Telefon und Mobil fehlen.</span>
            </span>
          </label>
        )}
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
        {gespeichert && !fehler && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 size={15} /> Gespeichert
          </span>
        )}
        {fehler && <span className="text-sm font-medium text-rose-600">{fehler}</span>}
      </div>

      {isSupabaseConfigured && session && (
        <div className="mt-5">
          <FirmenTelefonEinstellung />
        </div>
      )}

      {isSupabaseConfigured && <MeinPostfachAbschnitt />}
    </div>
  )
}
