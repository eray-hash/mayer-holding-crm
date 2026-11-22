import { useEffect, useState } from 'react'
import { PostfaecherVerwaltung } from '../../components/PostfachEinstellungen'
import { Mail, Plus, UserCheck, UserX, Pencil, Save, XCircle, ShieldCheck, Link2, Copy, Check, AtSign, Eye } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { inviteMitarbeiter, generateLoginLink, updateMitarbeiterEmail } from '../../lib/emailGateway'
import { ALLE_BEREICHE, bereichLabel } from '../../data/bereiche'
import { Card, Field, inputClass, PrimaryButton, EmptyState } from '../../components/ui'
import type { Bereich } from '../../types'
import { StammdatenNachtrag } from '../../components/StammdatenVorschlaege'
import { Link } from 'react-router-dom'

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

// Was zu einem Bereich gehört — damit die Geschäftsführung beim Anhaken weiß, was sie freigibt.
const BEREICH_INHALT: Partial<Record<Bereich, string>> = {
  beratung: 'Kunden, Rechnungen, Mahnwesen, Verbindlichkeiten',
  immobilien: 'Objekte, Immobilien-Kunden, Gesuche, Zeiterfassung',
  erben: 'Mandanten',
  betriebsuebergabe: 'Mandanten',
  betriebsformen: 'Mandanten',
  akademie: 'Teilnehmer',
  finanzierungen: 'Mandanten',
  buecher: 'Eigene Bücher, Buch-Kontakte',
}

// In fester Reihenfolge speichern, damit die Anzeige überall gleich aussieht.
function sortiert(auswahl: Set<Bereich>): Bereich[] {
  return ALLE_BEREICH_IDS.filter((b) => auswahl.has(b))
}

function sichtText(m: Pick<MitarbeiterRow, 'rolle' | 'ist_admin' | 'bereiche'>): string {
  if (m.rolle === 'geschaeftsfuehrung') return 'sieht alles (Geschäftsführung)'
  if (m.ist_admin) return 'sieht alles (Admin)'
  const liste = ALLE_BEREICHE.filter((b) => m.bereiche.includes(b.id))
  if (liste.length === 0) return 'kein Bereich freigegeben'
  if (liste.length === ALLE_BEREICHE.length) return 'alle Bereiche'
  return liste.map((b) => b.label).join(', ')
}

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
        bereiche: rolle === 'geschaeftsfuehrung' ? ALLE_BEREICH_IDS : sortiert(bereiche),
        ist_admin: istAdmin,
        aktiv: true,
      })
      if (insertError) throw new Error(insertError.message)
      await inviteMitarbeiter(email.trim())
      setErfolg(
        `${name.trim()} wurde angelegt, Einladungs-Mail an ${email.trim()} verschickt. Nach dem Öffnen des Links legt ${name.trim()} zuerst ein Passwort fest. Falls die Mail nicht ankommt (z.B. bei Hotmail-Adressen), unten „Login-Link" nutzen oder ${name.trim()} auf „Erster Login?" beim Login verweisen.`,
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
          bereiche: editRolle === 'geschaeftsfuehrung' ? ALLE_BEREICH_IDS : sortiert(editBereiche),
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
      <p className="mb-4 text-sm text-slate-500">Neue Mitarbeiter anlegen, Bereiche zuweisen, Zugänge sperren/entsperren.</p>

      <WerSiehtWas />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Doppelte Akten</h3>
          <p className="text-xs text-slate-500">Doppelte Kundenakten und Objekte finden, nebeneinander vergleichen und zusammenführen.</p>
        </div>
        <Link to="/dubletten" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Copy size={14} /> Dubletten öffnen</Link>
      </Card>

      <PostfaecherVerwaltung />
      <div className="mb-6"><StammdatenNachtrag /></div>

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
        <BereichAuswahl
          rolle={rolle}
          istAdmin={istAdmin}
          auswahl={bereiche}
          onToggle={toggleBereich}
          onAlle={() => setBereiche(new Set(ALLE_BEREICH_IDS))}
          onKeine={() => setBereiche(new Set())}
        />

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-56">
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
                    {m.email} · {m.rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Mitarbeiter'}
                  </p>
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                    <Eye size={11} className="mt-0.5 flex-shrink-0" />
                    <span>{sichtText(m)}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                  <BereichAuswahl
                    rolle={editRolle}
                    istAdmin={editAdmin}
                    auswahl={editBereiche}
                    onToggle={toggleEditBereich}
                    onAlle={() => setEditBereiche(new Set(ALLE_BEREICH_IDS))}
                    onKeine={() => setEditBereiche(new Set())}
                  />
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

function WerSiehtWas() {
  return (
    <Card className="mb-6 p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Eye size={15} /> Wer sieht was?
      </h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>
          <strong>Geschäftsführung und Admins</strong> sehen immer alles — die Häkchen bei den Bereichen spielen für sie keine Rolle.
        </li>
        <li>
          <strong>Mitarbeiter</strong> sehen nur die Bereiche, die hier angehakt sind: deren Kunden und Mandanten, Vorlagen und Projekte. Das gilt
          für die gespeicherten Daten selbst, nicht nur für das Menü.
        </li>
        <li>
          Die <strong>„Ungeklärten Eingänge“</strong> und die <strong>interne Akte der Holding</strong> sehen alle Mitarbeiter, egal welche
          Bereiche angehakt sind.
        </li>
        <li>
          Ebenfalls für alle gleich: das gemeinsame Postfach, der Kalender und die eigenen Aufgaben. Private Kontakte sieht nur, wem sie gehören.
        </li>
        <li>Eine Änderung wirkt, sobald der Mitarbeiter das CRM neu lädt.</li>
      </ul>
    </Card>
  )
}

function BereichAuswahl({
  rolle,
  istAdmin,
  auswahl,
  onToggle,
  onAlle,
  onKeine,
}: {
  rolle: MitarbeiterRow['rolle']
  istAdmin: boolean
  auswahl: Set<Bereich>
  onToggle: (b: Bereich) => void
  onAlle: () => void
  onKeine: () => void
}) {
  if (rolle === 'geschaeftsfuehrung' || istAdmin) {
    return (
      <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        {rolle === 'geschaeftsfuehrung' ? 'Geschäftsführung' : 'Admins'} sehen automatisch alle Bereiche.
      </p>
    )
  }
  return (
    <Field label="Diese Bereiche darf der Mitarbeiter sehen">
      <div className="mb-2 flex gap-2">
        <button type="button" onClick={onAlle} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Alle anhaken
        </button>
        <button type="button" onClick={onKeine} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Keine
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ALLE_BEREICHE.map((b) => (
          <label
            key={b.id}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              auswahl.has(b.id) ? 'border-accent-300 bg-accent-50 text-slate-800' : 'border-slate-200 text-slate-600'
            }`}
          >
            <input type="checkbox" className="mt-0.5 rounded" checked={auswahl.has(b.id)} onChange={() => onToggle(b.id)} />
            <span className="min-w-0">
              <span className="block font-medium">{bereichLabel(b.id)}</span>
              {BEREICH_INHALT[b.id] && <span className="block text-xs text-slate-400">{BEREICH_INHALT[b.id]}</span>}
            </span>
          </label>
        ))}
      </div>
      {auswahl.size === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Ohne Bereich sieht der Mitarbeiter nur seine privaten Kontakte, das Postfach, den Kalender, die Ungeklärten Eingänge und die interne Akte.
        </p>
      )}
    </Field>
  )
}
