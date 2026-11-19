import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { isEmailGatewayConfigured, requestPasswordReset, selbstRegistrieren } from '../../lib/emailGateway'
import { PasswortInput } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'

const inputCls =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100'

function PasswortVergessenForm({ onZurueck }: { onZurueck: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [erledigt, setErledigt] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await requestPasswordReset(email)
      setErledigt(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anfrage fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  if (erledigt) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">
          Falls <strong>{email}</strong> bei uns als Mitarbeiter-Zugang hinterlegt ist, wurde gerade ein Link dorthin
          verschickt. Öffne ihn und lege dein Passwort fest. Der Link funktioniert nur einmal.
        </p>
        <button type="button" onClick={onZurueck} className="text-sm font-medium text-accent-600 hover:underline">
          Zurück zum Login
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">Gib deine E-Mail-Adresse ein — wir schicken dir einen Link zum Neusetzen des Passworts.</p>
      <input
        type="email"
        placeholder="E-Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="username"
        className={inputCls}
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {loading ? '…' : 'Link anfordern'}
      </button>
      <button type="button" onClick={onZurueck} className="text-sm font-medium text-slate-500 hover:underline">
        Zurück zum Login
      </button>
    </form>
  )
}

// Erster Zugang: Seit 19.11.2026 nur noch per Link an das eigene Postfach — vorher ließ sich hier das
// Passwort eines eingeladenen, aber noch nie angemeldeten Kollegen von jedem setzen, der seine Adresse kannte.
function RegistrierenForm({ onZurueck }: { onZurueck: () => void }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [erledigt, setErledigt] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await selbstRegistrieren(email)
      setErledigt(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Das hat gerade nicht geklappt. Bitte erneut versuchen.')
    } finally {
      setLoading(false)
    }
  }

  if (erledigt) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">
          Wenn <strong>{email}</strong> als Mitarbeiter hinterlegt ist, haben wir gerade einen Link an diese Adresse geschickt.
          Öffne ihn im Postfach und lege dort dein Passwort fest. Kommt nichts an, schau im Spam-Ordner nach oder frag Eray oder Hasan nach einem Login-Link.
        </p>
        <button type="button" onClick={onZurueck} className="text-sm font-medium text-accent-600 hover:underline">
          Zum Login
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">
        Für den allerersten Zugang. Deine E-Mail muss als Mitarbeiter hinterlegt sein. Du bekommst einen Link per E-Mail und
        legst dort dein Passwort fest.
      </p>
      <input
        type="email"
        placeholder="E-Mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="username"
        className={inputCls}
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="mt-1 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {loading ? '…' : 'Link zum Einrichten schicken'}
      </button>
      <button type="button" onClick={onZurueck} className="text-sm font-medium text-slate-500 hover:underline">
        Zurück zum Login
      </button>
    </form>
  )
}

export function LoginScreen() {
  const { passwortFestgelegt } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [vergessenModus, setVergessenModus] = useState(false)
  const [registrierenModus, setRegistrierenModus] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort stimmt nicht. Noch kein Passwort? Dann unten „Erster Login?" wählen.' : error.message)
    // Wer sich mit Passwort anmeldet, hat eins — ein liegengebliebener Merker aus einem alten Link entfällt.
    else passwortFestgelegt()
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-slate-800">Mayer Holding CRM</h1>
        <p className="mb-4 text-sm text-slate-500">Mitarbeiter-Login</p>

        {vergessenModus ? (
          <PasswortVergessenForm onZurueck={() => setVergessenModus(false)} />
        ) : registrierenModus ? (
          <RegistrierenForm onZurueck={() => setRegistrierenModus(false)} />
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="E-Mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className={inputCls}
              />
              <PasswortInput
                placeholder="Passwort"
                value={password}
                onChange={setPassword}
                required
                autoComplete="current-password"
                className={inputCls}
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="mt-1 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
              >
                {loading ? '…' : 'Anmelden'}
              </button>
            </form>
            {isEmailGatewayConfigured && (
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVergessenModus(true)}
                  className="text-sm font-medium text-accent-600 hover:underline"
                >
                  Passwort vergessen?
                </button>
                <button
                  type="button"
                  onClick={() => setRegistrierenModus(true)}
                  className="text-sm font-medium text-slate-500 hover:underline"
                >
                  Erster Login?
                </button>
              </div>
            )}
          </>
        )}

        <p className="mt-4 text-xs text-slate-400">
          Zugänge werden von der Geschäftsführung angelegt. Bei Problemen bitte an Andreas oder Eray wenden.
        </p>
      </div>
    </div>
  )
}
