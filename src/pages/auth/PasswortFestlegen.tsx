import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { PasswortInput } from '../../components/ui'

const inputCls =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100'

// Supabase meldet Fehler auf Englisch — die zwei, die hier realistisch vorkommen, auf Deutsch.
function aufDeutsch(meldung: string): string {
  if (/different from the old password/i.test(meldung)) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.'
  if (/at least \d+ characters|weak|should contain/i.test(meldung)) return 'Das Passwort ist zu schwach. Bitte ein längeres wählen.'
  if (/session|jwt|expired|not authenticated/i.test(meldung)) return 'Die Anmeldung ist abgelaufen. Bitte den Link erneut anfordern.'
  return meldung
}

// Pflichtschritt nach dem Öffnen eines Einladungs-, Login- oder Passwort-Links: Der Link meldet
// zwar an, vergibt aber kein Passwort. Ohne diesen Schritt kam man beim nächsten Mal nicht mehr
// hinein (siehe supabaseClient.ts).
export function PasswortFestlegen() {
  const { session, passwortFestgelegt, signOut } = useAuth()
  const [passwort, setPasswort] = useState('')
  const [wiederholen, setWiederholen] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function absenden(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (passwort.length < 8) {
      setFehler('Das Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (passwort !== wiederholen) {
      setFehler('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setFehler(null)
    setSpeichert(true)
    const { error } = await supabase.auth.updateUser({ password: passwort })
    setSpeichert(false)
    if (error) {
      setFehler(aufDeutsch(error.message))
      return
    }
    passwortFestgelegt()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-semibold text-slate-800">Passwort festlegen</h1>
        <p className="mb-4 text-sm text-slate-500">
          Du bist über einen Link angemeldet{session?.user.email ? ` (${session.user.email})` : ''}. Lege jetzt dein Passwort fest. Damit meldest du
          dich künftig auf der Login-Seite an.
        </p>
        <form onSubmit={absenden} className="flex flex-col gap-3">
          <PasswortInput
            placeholder="Neues Passwort (mindestens 8 Zeichen)"
            value={passwort}
            onChange={setPasswort}
            required
            autoComplete="new-password"
            className={inputCls}
          />
          <PasswortInput
            placeholder="Passwort wiederholen"
            value={wiederholen}
            onChange={setWiederholen}
            required
            autoComplete="new-password"
            className={inputCls}
          />
          {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
          <button
            type="submit"
            disabled={speichert}
            className="mt-1 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
          >
            {speichert ? 'Speichert …' : 'Passwort speichern und weiter'}
          </button>
        </form>
        <button type="button" onClick={signOut} className="mt-3 text-sm font-medium text-slate-500 hover:underline">
          Abmelden
        </button>
      </div>
    </div>
  )
}
