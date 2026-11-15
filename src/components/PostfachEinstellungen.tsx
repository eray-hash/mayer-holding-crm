import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Mail, Trash2, Users } from 'lucide-react'
import { ladePostfaecher, trennePostfach, type PostfachInfo } from '../lib/emailGateway'
import { usePostfaecher, ladePostfaecherNeu } from '../lib/postfaecher'
import { useAuth } from '../context/AuthContext'
import { fmtDateTime } from '../lib/dates'
import { PostfachVerbinden } from './PostfachVerbinden'
import { Card, Modal, PrimaryButton, SecondaryButton } from './ui'

const SPAETER = 'mh_postfach_spaeter_'

/** "Mein Profil": das eigene Postfach verbinden, Zustand sehen, wieder trennen. */
export function MeinPostfachAbschnitt() {
  const { session } = useAuth()
  const { postfaecher, eigenes, geladen, fehler } = usePostfaecher()
  const loginAdresse = (session?.user.email ?? '').toLowerCase()
  // Wer sich mit der Adresse des gemeinsamen Postfachs anmeldet, hat kein "eigenes" zu verbinden.
  const loginIstGemeinsam = postfaecher.some((p) => p.gemeinsam && p.adresse.toLowerCase() === loginAdresse)
  const [trennt, setTrennt] = useState(false)
  const [meldung, setMeldung] = useState('')

  async function trennen() {
    if (!eigenes) return
    if (!window.confirm(`Postfach ${eigenes.adresse} vom CRM trennen? Bereits abgeholte Mails bleiben erhalten, neue kommen nicht mehr an.`)) return
    setTrennt(true)
    setMeldung('')
    try {
      await trennePostfach(eigenes.id)
      try {
        localStorage.setItem(SPAETER + loginAdresse, '1')
      } catch {
        // dann erscheint der Hinweis eben noch einmal
      }
      await ladePostfaecherNeu()
    } catch (err) {
      setMeldung(err instanceof Error ? err.message : 'Trennen hat nicht geklappt.')
    } finally {
      setTrennt(false)
    }
  }

  return (
    <Card className="mt-5 p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Mein Postfach</h3>
      <p className="mb-4 text-xs text-slate-500">
        Dein eigenes Mail-Postfach im CRM: Eingehende Mails landen im Bereich „Privat“ unter „Mein Postfach“ und sind nur für dich sichtbar. Beim Schreiben kannst du deine Adresse als Absender wählen.
      </p>
      {!geladen && !fehler && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
      {geladen && eigenes && (
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 size={15} /> {eigenes.adresse} ist verbunden
            </span>
            <SecondaryButton onClick={trennen} disabled={trennt} className="text-xs">
              <Trash2 size={13} /> {trennt ? 'Wird getrennt …' : 'Trennen'}
            </SecondaryButton>
          </div>
          <p className="mt-1 text-xs text-slate-400">{eigenes.letzterAbruf ? `Zuletzt abgeholt: ${fmtDateTime(eigenes.letzterAbruf)}` : 'Erster Abruf läuft …'}</p>
          {eigenes.letzterFehler && (
            <div className="mt-3">
              <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> Letzter Abruf fehlgeschlagen: {eigenes.letzterFehler}
              </p>
              <div className="max-w-md"><PostfachVerbinden adresse={eigenes.adresse} adresseAenderbar={false} /></div>
            </div>
          )}
        </div>
      )}
      {geladen && !eigenes && (
        <div className="max-w-md">
          {loginIstGemeinsam && (
            <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              Du meldest dich mit {loginAdresse} an — das ist das gemeinsame Postfach und bereits verbunden. Hier kannst du zusätzlich eine eigene, persönliche Adresse verbinden.
            </p>
          )}
          <PostfachVerbinden adresse={loginIstGemeinsam ? '' : loginAdresse} />
        </div>
      )}
      {meldung && <p className="mt-2 text-xs text-rose-600">{meldung}</p>}
    </Card>
  )
}

/** Einmaliger Hinweis nach dem Einloggen, solange kein eigenes Postfach verbunden ist. */
export function PostfachEinrichtenHinweis() {
  const { session } = useAuth()
  const email = (session?.user.email ?? '').toLowerCase()
  const { postfaecher, eigenes, geladen } = usePostfaecher()
  const [zu, setZu] = useState(false)
  const [verbunden, setVerbunden] = useState(false)

  let spaeter = false
  try {
    spaeter = !!email && localStorage.getItem(SPAETER + email) === '1'
  } catch {
    spaeter = false
  }
  // Kein Hinweis für jemanden, dessen Login-Adresse selbst das gemeinsame Postfach ist.
  const loginIstGemeinsam = postfaecher.some((p) => p.gemeinsam && p.adresse.toLowerCase() === email)
  // Auch nicht für Adressen bei Microsoft oder Google — die lassen sich mit Passwort nicht anbinden.
  const nichtAnbindbar = /@(outlook|hotmail|live|msn|gmail|googlemail)\./.test(email)
  if (!email || !geladen || zu || spaeter || nichtAnbindbar || (loginIstGemeinsam && !verbunden) || (eigenes && !verbunden)) return null

  function schliessen() {
    try {
      localStorage.setItem(SPAETER + email, '1')
    } catch {
      // dann erscheint der Hinweis beim nächsten Mal eben wieder
    }
    setZu(true)
  }

  return (
    <Modal open onClose={schliessen} title="Dein Postfach verbinden" width="max-w-md">
      {!verbunden && (
        <p className="mb-4 text-sm text-slate-600">
          Ein Schritt, dann ist dein eigenes Postfach im CRM: Mails an dich kommen hier an (nur für dich sichtbar), und du schreibst unter deiner eigenen Adresse.
        </p>
      )}
      <PostfachVerbinden adresse={email} onVerbunden={() => setVerbunden(true)} />
      <div className="mt-4 flex justify-end">
        {verbunden ? <PrimaryButton onClick={schliessen}>Fertig</PrimaryButton> : <button onClick={schliessen} className="text-sm text-slate-500 hover:underline">Später</button>}
      </div>
    </Modal>
  )
}

/** Verwaltung (Geschäftsführung): alle Postfächer sehen, ein weiteres gemeinsames verbinden. */
export function PostfaecherVerwaltung() {
  const [liste, setListe] = useState<PostfachInfo[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [neu, setNeu] = useState(false)

  async function lade() {
    try {
      setListe(await ladePostfaecher(true))
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Postfächer konnten nicht geladen werden.')
    }
  }
  useEffect(() => {
    lade()
  }, [])

  async function trennen(p: PostfachInfo) {
    if (!window.confirm(`Postfach ${p.adresse} vom CRM trennen?`)) return
    try {
      await trennePostfach(p.id)
      await Promise.all([lade(), ladePostfaecherNeu()])
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Trennen hat nicht geklappt.')
    }
  }

  return (
    <Card className="mb-6 p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Postfächer</h3>
      <p className="mb-3 text-xs text-slate-500">
        Gemeinsame Postfächer stehen allen als Absender zur Wahl. Persönliche Postfächer verbindet jeder Mitarbeiter selbst (einmal das Passwort seines Postfachs eingeben) — ihr Inhalt ist nur für ihn sichtbar.
      </p>
      {fehler && <p className="mb-2 text-xs text-rose-600">{fehler}</p>}
      {!liste && !fehler && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {liste && (
        <ul className="divide-y divide-slate-100">
          {liste.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              {p.gemeinsam ? <Users size={14} className="text-slate-400" /> : <Mail size={14} className="text-slate-400" />}
              <span className="font-medium text-slate-800">{p.adresse}</span>
              <span className="text-xs text-slate-500">{p.gemeinsam ? 'gemeinsam' : `persönlich — ${p.besitzer}`}</span>
              {p.letzterFehler ? (
                <span className="text-xs text-amber-700">Abruf gestört</span>
              ) : (
                <span className="text-xs text-emerald-600">{p.bereit ? 'verbunden' : 'Zugang fehlt'}</span>
              )}
              {p.id !== 'standard' && p.gemeinsam && (
                <button onClick={() => trennen(p)} className="ml-auto text-xs text-slate-400 hover:text-rose-600">
                  Trennen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {neu ? (
          <div className="max-w-md rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Weiteres gemeinsames Postfach verbinden</p>
            <PostfachVerbinden gemeinsam onVerbunden={() => { lade() }} />
            <button onClick={() => setNeu(false)} className="mt-2 text-xs text-slate-500 hover:underline">Schließen</button>
          </div>
        ) : (
          <SecondaryButton onClick={() => setNeu(true)} className="text-xs">
            <Users size={13} /> Gemeinsames Postfach hinzufügen
          </SecondaryButton>
        )}
      </div>
    </Card>
  )
}
