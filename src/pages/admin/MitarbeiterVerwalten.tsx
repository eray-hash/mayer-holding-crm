import { useEffect, useState } from 'react'
import { Mail, Plus, UserCheck, UserX } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { inviteMitarbeiter } from '../../lib/emailGateway'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { Card, Field, inputClass, PrimaryButton, EmptyState } from '../../components/ui'
import type { KundeBereich } from '../../types'

type MitarbeiterRow = {
  id: string
  name: string
  email: string
  rolle: 'geschaeftsfuehrung' | 'mitarbeiter'
  bereiche: KundeBereich[]
  aktiv: boolean
}

// Mitarbeiter-Verwaltung "von innen" (Geschäftsführungs-Anforderung): neue Mitarbeiter anlegen,
// Bereiche zuweisen, Einladungs-Mail auslösen (Supabase Auth — Mitarbeiter setzt sein eigenes
// Passwort selbst), bestehende deaktivieren. RLS erlaubt Schreiben hier nur Geschäftsführung.
export function MitarbeiterVerwalten() {
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [rolle, setRolle] = useState<MitarbeiterRow['rolle']>('mitarbeiter')
  const [bereiche, setBereiche] = useState<Set<KundeBereich>>(new Set())
  const [anlegen, setAnlegen] = useState(false)
  const [anlegenFehler, setAnlegenFehler] = useState('')
  const [erfolg, setErfolg] = useState('')

  async function laden() {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase.from('mitarbeiter').select('id, name, email, rolle, bereiche, aktiv').order('created_at')
    if (error) setError(error.message)
    else setMitarbeiter((data ?? []) as MitarbeiterRow[])
    setLoading(false)
  }

  useEffect(() => {
    laden()
  }, [])

  function toggleBereich(b: KundeBereich) {
    setBereiche((s) => {
      const next = new Set(s)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  async function anlegenUndEinladen() {
    if (!supabase || !name.trim() || !email.trim()) return
    setAnlegen(true)
    setAnlegenFehler('')
    setErfolg('')
    try {
      const { error: insertError } = await supabase.from('mitarbeiter').insert({
        name: name.trim(),
        email: email.trim(),
        rolle,
        bereiche: rolle === 'geschaeftsfuehrung' ? KUNDEN_BEREICHE.map((b) => b.id) : Array.from(bereiche),
        aktiv: true,
      })
      if (insertError) throw new Error(insertError.message)
      await inviteMitarbeiter(email.trim())
      setErfolg(`${name.trim()} wurde angelegt, Einladungs-Mail an ${email.trim()} verschickt.`)
      setName('')
      setEmail('')
      setRolle('mitarbeiter')
      setBereiche(new Set())
      laden()
    } catch (err) {
      setAnlegenFehler(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.')
    } finally {
      setAnlegen(false)
    }
  }

  async function aktivTogglen(m: MitarbeiterRow) {
    if (!supabase) return
    await supabase.from('mitarbeiter').update({ aktiv: !m.aktiv }).eq('id', m.id)
    laden()
  }

  if (!isSupabaseConfigured) {
    return <EmptyState text="Mitarbeiter-Verwaltung braucht eine Supabase-Verbindung." />
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mitarbeiter verwalten</h1>
      <p className="mb-5 text-sm text-slate-500">Neue Mitarbeiter anlegen, Bereiche zuweisen, Zugänge sperren/entsperren.</p>

      <Card className="mb-6 p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Neuer Mitarbeiter</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-Mail">
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Rolle">
          <select className={inputClass} value={rolle} onChange={(e) => setRolle(e.target.value as MitarbeiterRow['rolle'])}>
            <option value="mitarbeiter">Mitarbeiter</option>
            <option value="geschaeftsfuehrung">Geschäftsführung</option>
          </select>
        </Field>
        {rolle === 'mitarbeiter' && (
          <Field label="Bereiche">
            <div className="flex flex-wrap gap-3">
              {KUNDEN_BEREICHE.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" className="rounded" checked={bereiche.has(b.id)} onChange={() => toggleBereich(b.id)} />
                  {b.label}
                </label>
              ))}
            </div>
          </Field>
        )}
        {rolle === 'geschaeftsfuehrung' && <p className="mb-3 text-xs text-slate-400">Geschäftsführung sieht automatisch alle Bereiche.</p>}

        {anlegenFehler && <p className="mb-3 text-sm font-medium text-rose-600">{anlegenFehler}</p>}
        {erfolg && <p className="mb-3 text-sm font-medium text-emerald-600">{erfolg}</p>}

        <PrimaryButton onClick={anlegenUndEinladen} disabled={anlegen || !name.trim() || !email.trim()}>
          <Plus size={14} /> {anlegen ? 'Wird angelegt …' : 'Anlegen & einladen'}
        </PrimaryButton>
      </Card>

      <h3 className="mb-2 text-sm font-semibold text-slate-700">Bestehende Mitarbeiter</h3>
      {error && <p className="mb-3 text-sm font-medium text-rose-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : (
        <div className="space-y-2">
          {mitarbeiter.map((m) => (
            <Card key={m.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {m.name} {!m.aktiv && <span className="ml-1 text-xs font-normal text-rose-500">(gesperrt)</span>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  <Mail size={11} className="mr-1 inline" />
                  {m.email} · {m.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'} ·{' '}
                  {m.rolle === 'geschaeftsfuehrung' ? 'alle Bereiche' : m.bereiche.map(kundeBereichLabel).join(', ') || 'kein Bereich'}
                </p>
              </div>
              <button
                onClick={() => aktivTogglen(m)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  m.aktiv ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                {m.aktiv ? <UserX size={13} /> : <UserCheck size={13} />} {m.aktiv ? 'Sperren' : 'Entsperren'}
              </button>
            </Card>
          ))}
          {mitarbeiter.length === 0 && <EmptyState text="Noch keine Mitarbeiter angelegt." />}
        </div>
      )}
    </div>
  )
}
