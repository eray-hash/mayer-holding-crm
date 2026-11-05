import { useEffect, useState } from 'react'
import { Mail, Plus, UserCheck, UserX, Pencil, Save, XCircle, ShieldCheck, Link2, Copy, Check, AtSign } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { inviteMitarbeiter, generateLoginLink, updateMitarbeiterEmail } from '../../lib/emailGateway'
import { ALLE_BEREICHE, bereichLabel } from '../../data/bereiche'
import { Card, Field, inputClass, PrimaryButton, EmptyState } from '../../components/ui'
import type { Bereich } from '../../types'

type MitarbeiterRow = {
  id: string
  name: string
  email: string
  rolle: 'geschaeftsfuehrung' | 'mitarbeiter'
  bereiche: Bereich[]
  aktiv: boolean
  ist_admin: boolean
}

const ALLE_BEREICH_IDS = ALLE_BEREICHE.map((b) => b.id)

// Mitarbeiter-Verwaltung "von innen" (Geschäftsführungs-Anforderung): neue Mitarbeiter anlegen,
// Bereiche zuweisen, Einladungs-Mail auslösen (Supabase Auth — Mitarbeiter setzt sein eigenes
// Passwort selbst), bestehende bearbeiten/deaktivieren. RLS erlaubt Schreiben hier nur
// Geschäftsführung. "Admin" ist unabhängig von der Rolle "Geschäftsführung" schaltbar (z.B. ein
// technischer Admin-Zugang ohne GF-Titel) — Beschluss vom 2026-11-02: Default bei Anlage ist
// Zugriff auf alle Bereiche, Einschränkung ist die Ausnahme.
export function MitarbeiterVerwalten() {
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [rolle, setRolle] = useState<MitarbeiterRow['rolle']>('mitarbeiter')
  const [bereiche, setBereiche] = useState<Set<Bereich>>(new Set(ALLE_BEREICH_IDS))
  const [istAdmin, setIstAdmin] = useState(false)
  const [anlegen, setAnlegen] = useState(false)
  const [anlegenFehler, setAnlegenFehler] = useState('')
  const [erfolg, setErfolg] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRolle, setEditRolle] = useState<MitarbeiterRow['rolle']>('mitarbeiter')
  const [editBereiche, setEditBereiche] = useState<Set<Bereich>>(new Set())
  const [editAdmin, setEditAdmin] = useState(false)
  const [editSpeichern, setEditSpeichern] = useState(false)
  const [editFehler, setEditFehler] = useState('')

  const [linkLaedtId, setLinkLaedtId] = useState<string | null>(null)
  const [erzeugterLink, setErzeugterLink] = useState<{ id: string; link: string } | null>(null)
  const [linkFehler, setLinkFehler] = useState<{ id: string; text: string } | null>(null)
  const [linkKopiert, setLinkKopiert] = useState(false)

  const [emailBearbeitenId, setEmailBearbeitenId] = useState<string | null>(null)
  const [neueEmailEntwurf, setNeueEmailEntwurf] = useState('')
  const [emailSpeichern, setEmailSpeichern] = useState(false)
  const [emailFehler, setEmailFehler] = useState<{ id: string; text: string } | null>(null)

  async function laden() {
    if (!supabase) return
    setLoading(true)
    const { data, error } = await supabase
      .from('mitarbeiter')
      .select('id, name, email, rolle, bereiche, aktiv, ist_admin')
      .order('created_at')
    if (error) setError(error.message)
    else setMitarbeiter((data ?? []) as MitarbeiterRow[])
    setLoading(false)
  }

  useEffect(() => {
    laden()
  }, [])

  function toggleBereich(b: Bereich) {
    setBereiche((s) => {
      const next = new Set(s)
      if (next.has(b)) next.delete(b)
      else next.add(b)
      return next
    })
  }

  function toggleEditBereich(b: Bereich) {
    setEditBereiche((s) => {
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
        bereiche: rolle === 'geschaeftsfuehrung' ? ALLE_BEREICH_IDS : Array.from(bereiche),
        ist_admin: istAdmin,
        aktiv: true,
      })
      if (insertError) throw new Error(insertError.message)
      await inviteMitarbeiter(email.trim())
      setErfolg(
        `${name.trim()} wurde angelegt, Einladungs-Mail an ${email.trim()} verschickt. Falls sie nicht ankommt (z.B. bei Hotmail-Adressen), unten „Login-Link" nutzen oder ${name.trim()} auf „Passwort vergessen?" beim Login verweisen.`,
      )
      setName('')
      setEmail('')
      setRolle('mitarbeiter')
      setBereiche(new Set(ALLE_BEREICH_IDS))
      setIstAdmin(false)
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

  // Workaround für Mitarbeiter, deren Einladungs-/Reset-Mail von Supabase nie ankommt (z.B.
  // Hotmail-Adressen, siehe Projektnotiz "Supabase Email Delivery Broken") — erzeugt denselben
  // Login-/Passwort-setzen-Link direkt, ohne dass Supabase selbst eine Mail verschicken muss. Muss
  // manuell über einen anderen Kanal (Chat, Signal, ...) an den Mitarbeiter zugestellt werden.
  async function linkErzeugen(m: MitarbeiterRow) {
    setLinkLaedtId(m.id)
    setLinkFehler(null)
    setErzeugterLink(null)
    setLinkKopiert(false)
    try {
      const link = await generateLoginLink(m.email)
      setErzeugterLink({ id: m.id, link })
    } catch (err) {
      setLinkFehler({ id: m.id, text: err instanceof Error ? err.message : 'Link konnte nicht erzeugt werden.' })
    } finally {
      setLinkLaedtId(null)
    }
  }

  function emailBearbeitenStarten(m: MitarbeiterRow) {
    setEmailBearbeitenId(m.id)
    setNeueEmailEntwurf(m.email)
    setEmailFehler(null)
  }

  async function emailSpeichernKlick(id: string) {
    if (!neueEmailEntwurf.trim()) return
    setEmailSpeichern(true)
    setEmailFehler(null)
    try {
      await updateMitarbeiterEmail(id, neueEmailEntwurf.trim())
      setEmailBearbeitenId(null)
      laden()
    } catch (err) {
      setEmailFehler({ id, text: err instanceof Error ? err.message : 'E-Mail konnte nicht geändert werden.' })
    } finally {
      setEmailSpeichern(false)
    }
  }

  async function linkKopieren(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setLinkKopiert(true)
      setTimeout(() => setLinkKopiert(false), 2000)
    } catch {
      // Clipboard-Zugriff kann in manchen Kontexten fehlschlagen — kein Blocker, Link steht ja da.
    }
  }

  function beginnEdit(m: MitarbeiterRow) {
    setEditingId(m.id)
    setEditRolle(m.rolle)
    setEditBereiche(new Set(m.bereiche))
    setEditAdmin(m.ist_admin)
    setEditFehler('')
  }

  function editAbbrechen() {
    setEditingId(null)
    setEditFehler('')
  }

  async function editSpeichernKlick() {
    if (!supabase || !editingId) return
    setEditSpeichern(true)
    setEditFehler('')
    try {
      const { error: updateError } = await supabase
        .from('mitarbeiter')
        .update({
          rolle: editRolle,
          bereiche: editRolle === 'geschaeftsfuehrung' ? ALLE_BEREICH_IDS : Array.from(editBereiche),
          ist_admin: editAdmin,
        })
        .eq('id', editingId)
      if (updateError) throw new Error(updateError.message)
      setEditingId(null)
      laden()
    } catch (err) {
      setEditFehler(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setEditSpeichern(false)
    }
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
              {ALLE_BEREICHE.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" className="rounded" checked={bereiche.has(b.id)} onChange={() => toggleBereich(b.id)} />
                  {b.label}
                </label>
              ))}
            </div>
          </Field>
        )}
        {rolle === 'geschaeftsfuehrung' && <p className="mb-3 text-xs text-slate-400">Geschäftsführung sieht automatisch alle Bereiche.</p>}

        <Field label="Admin">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" className="rounded" checked={istAdmin} onChange={(e) => setIstAdmin(e.target.checked)} />
            Admin-Rechte (unabhängig von der Rolle, z.B. für technische Verwaltung)
          </label>
        </Field>

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
            <Card key={m.id} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {m.name} {!m.aktiv && <span className="ml-1 text-xs font-normal text-rose-500">(gesperrt)</span>}
                    {m.ist_admin && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">
                        <ShieldCheck size={10} /> Admin
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    <Mail size={11} className="mr-1 inline" />
                    {m.email} · {m.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'} ·{' '}
                    {m.rolle === 'geschaeftsfuehrung' ? 'alle Bereiche' : m.bereiche.map(bereichLabel).join(', ') || 'kein Bereich'}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => (emailBearbeitenId === m.id ? setEmailBearbeitenId(null) : emailBearbeitenStarten(m))}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    title="Login-E-Mail ändern (z.B. vorübergehend auf eine private Adresse ausweichen)"
                  >
                    <AtSign size={13} /> E-Mail ändern
                  </button>
                  <button
                    onClick={() => linkErzeugen(m)}
                    disabled={linkLaedtId === m.id}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    title="Login-Link erzeugen (falls die Einladungs-/Reset-Mail z.B. bei Hotmail nie ankommt)"
                  >
                    <Link2 size={13} /> {linkLaedtId === m.id ? 'Erzeugt …' : 'Login-Link'}
                  </button>
                  <button
                    onClick={() => (editingId === m.id ? editAbbrechen() : beginnEdit(m))}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {editingId === m.id ? <XCircle size={13} /> : <Pencil size={13} />} {editingId === m.id ? 'Abbrechen' : 'Bearbeiten'}
                  </button>
                  <button
                    onClick={() => aktivTogglen(m)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                      m.aktiv ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {m.aktiv ? <UserX size={13} /> : <UserCheck size={13} />} {m.aktiv ? 'Sperren' : 'Entsperren'}
                  </button>
                </div>
              </div>

              {linkFehler?.id === m.id && <p className="mt-2 text-xs font-medium text-rose-600">{linkFehler.text}</p>}

              {emailBearbeitenId === m.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Field label="Neue Login-E-Mail">
                    <input
                      type="email"
                      className={inputClass}
                      value={neueEmailEntwurf}
                      onChange={(e) => setNeueEmailEntwurf(e.target.value)}
                    />
                  </Field>
                  <p className="-mt-2 mb-3 text-xs text-slate-400">
                    Ändert sowohl den Login-Account als auch den CRM-Eintrag. Jederzeit wieder auf die alte Adresse zurückstellbar.
                  </p>
                  {emailFehler?.id === m.id && <p className="mb-3 text-sm font-medium text-rose-600">{emailFehler.text}</p>}
                  <PrimaryButton onClick={() => emailSpeichernKlick(m.id)} disabled={emailSpeichern || !neueEmailEntwurf.trim()}>
                    <Save size={14} /> {emailSpeichern ? 'Wird geändert …' : 'E-Mail ändern'}
                  </PrimaryButton>
                </div>
              )}

              {erzeugterLink?.id === m.id && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent-200 bg-accent-50 p-2.5">
                  <input readOnly value={erzeugterLink.link} className="min-w-0 flex-1 truncate bg-transparent text-xs text-slate-700" />
                  <button
                    onClick={() => linkKopieren(erzeugterLink.link)}
                    className="flex flex-shrink-0 items-center gap-1 rounded-md bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-700"
                  >
                    {linkKopiert ? <Check size={12} /> : <Copy size={12} />} {linkKopiert ? 'Kopiert' : 'Kopieren'}
                  </button>
                </div>
              )}

              {editingId === m.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Field label="Rolle">
                    <select
                      className={inputClass}
                      value={editRolle}
                      onChange={(e) => setEditRolle(e.target.value as MitarbeiterRow['rolle'])}
                    >
                      <option value="mitarbeiter">Mitarbeiter</option>
                      <option value="geschaeftsfuehrung">Geschäftsführung</option>
                    </select>
                  </Field>
                  {editRolle === 'mitarbeiter' && (
                    <Field label="Bereiche">
                      <div className="flex flex-wrap gap-3">
                        {ALLE_BEREICHE.map((b) => (
                          <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={editBereiche.has(b.id)}
                              onChange={() => toggleEditBereich(b.id)}
                            />
                            {b.label}
                          </label>
                        ))}
                      </div>
                    </Field>
                  )}
                  {editRolle === 'geschaeftsfuehrung' && (
                    <p className="mb-3 text-xs text-slate-400">Geschäftsführung sieht automatisch alle Bereiche.</p>
                  )}
                  <Field label="Admin">
                    <label className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input type="checkbox" className="rounded" checked={editAdmin} onChange={(e) => setEditAdmin(e.target.checked)} />
                      Admin-Rechte
                    </label>
                  </Field>
                  {editFehler && <p className="mb-3 text-sm font-medium text-rose-600">{editFehler}</p>}
                  <PrimaryButton onClick={editSpeichernKlick} disabled={editSpeichern}>
                    <Save size={14} /> {editSpeichern ? 'Wird gespeichert …' : 'Speichern'}
                  </PrimaryButton>
                </div>
              )}
            </Card>
          ))}
          {mitarbeiter.length === 0 && <EmptyState text="Noch keine Mitarbeiter angelegt." />}
        </div>
      )}
    </div>
  )
}
