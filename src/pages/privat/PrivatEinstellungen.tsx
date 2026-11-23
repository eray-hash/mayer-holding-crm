import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, Link2, Unlink, RefreshCw } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { gleicheJetztAb, setzeToDoListen, starteMsAnmeldung, trenneMsKonto, useMsStatus, type AbgleichLauf, type ToDoListeStand } from '../../lib/microsoftKonto'
import { PrimaryButton, SecondaryButton } from '../../components/ui'
import { fmtDateTime } from '../../lib/dates'
import { BriefboegenVerwalten } from '../../components/BriefboegenVerwalten'
import { MayerFilterEinstellungen } from '../../components/MayerFilterEinstellungen'

/** Bereich Privat → Einstellungen: Microsoft-Konto (Outlook/Hotmail, To Do, Kalender) verbinden. */
export function PrivatEinstellungen() {
  const { ansichtAls } = useAuth()
  if (ansichtAls) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Private Einstellungen werden in dieser Ansicht nicht gezeigt.
      </div>
    )
  }
  return <Inhalt />
}

function Inhalt() {
  const { session } = useAuth()
  const ich = (session?.user.email ?? '').toLowerCase()
  const { status, neuLaden } = useMsStatus(ich || undefined)
  const [params, setParams] = useSearchParams()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')

  // Rückkehr von der Microsoft-Anmeldung: ?ms=ok|fehler&meldung=…
  useEffect(() => {
    const ms = params.get('ms')
    if (!ms) return
    setMeldung({ ok: ms === 'ok', text: params.get('meldung') ?? '' })
    setParams({}, { replace: true })
    neuLaden().catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verbinden() {
    setFehler('')
    setArbeitet(true)
    try {
      await starteMsAnmeldung()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setArbeitet(false)
    }
  }

  async function trennen() {
    if (!window.confirm('Microsoft-Konto wirklich trennen? Das CRM kann danach nicht mehr auf Hotmail, To Do und Kalender zugreifen.')) return
    setFehler('')
    setArbeitet(true)
    try {
      await trenneMsKonto(ich)
      setMeldung({ ok: true, text: 'Getrennt. Den Zugriff kannst du zusätzlich bei Microsoft unter account.live.com/consent/Manage entziehen.' })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Einstellungen</h1>
        <p className="text-sm text-slate-500">Nur für dich sichtbar.</p>
      </div>

      {meldung && (
        <div className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${meldung.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {meldung.ok ? <Check size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{meldung.text || (meldung.ok ? 'Verbunden.' : 'Verbinden fehlgeschlagen.')}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-800">Microsoft-Konto (Outlook, To Do, Kalender)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Damit liest das CRM deine Outlook-Mails direkt bei Microsoft (sie werden nicht kopiert), gleicht To Do und deinen Outlook-Kalender ab und
          bereitet Antworten vor. Senden, Löschen und Einladungen passieren nur, wenn du sie bestätigst.
        </p>

        {!status && <p className="mt-4 text-sm text-slate-400">Wird geladen …</p>}
        {status && !status.erlaubt && (
          <p className="mt-4 text-sm text-slate-500">Für dein Konto ist die Microsoft-Anbindung nicht freigeschaltet.</p>
        )}
        {status?.erlaubt && !status.eingerichtet && (
          <p className="mt-4 text-sm text-amber-700">Die Anbindung ist noch nicht fertig eingerichtet. Bitte bei Eray melden.</p>
        )}
        {status?.erlaubt && status.eingerichtet && !status.verbunden && (
          <div className="mt-4">
            <PrimaryButton onClick={verbinden} disabled={arbeitet}>
              <Link2 size={16} /> Mit Microsoft verbinden
            </PrimaryButton>
            <p className="mt-2 text-xs text-slate-400">Du wirst zu Microsoft weitergeleitet, meldest dich dort an und bestätigst die Rechte.</p>
          </div>
        )}
        {status?.erlaubt && status.verbunden && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <div>
                Verbunden mit <strong>{status.adresse || status.name || 'Microsoft-Konto'}</strong>
              </div>
              {status.verbundenAm && <div className="text-xs text-slate-500">seit {fmtDateTime(status.verbundenAm)}</div>}
              {status.letzterErfolg && <div className="text-xs text-slate-500">zuletzt erfolgreich: {fmtDateTime(status.letzterErfolg)}</div>}
              {status.letzterFehler && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {status.letzterFehler}
                </div>
              )}
            </div>
            <AbgleichZeile titel="To Do" lauf={status.abgleich?.todo} />
            <AbgleichZeile titel="Kalender" lauf={status.abgleich?.kalender} />
            {status.todoListen && status.todoListen.length > 0 && <ToDoListenAuswahl ich={ich} listen={status.todoListen} />}
            <div className="flex flex-wrap gap-2">
              <SecondaryButton
                onClick={async () => {
                  setFehler('')
                  setArbeitet(true)
                  try {
                    await gleicheJetztAb(ich)
                  } catch (e) {
                    setFehler(e instanceof Error ? e.message : String(e))
                  } finally {
                    setArbeitet(false)
                  }
                }}
                disabled={arbeitet}
              >
                <RefreshCw size={16} /> Jetzt abgleichen
              </SecondaryButton>
              {status.letzterFehler && (
                <PrimaryButton onClick={verbinden} disabled={arbeitet}>
                  <RefreshCw size={16} /> Neu verbinden
                </PrimaryButton>
              )}
              <SecondaryButton onClick={trennen} disabled={arbeitet}>
                <Unlink size={16} /> Trennen
              </SecondaryButton>
            </div>
          </div>
        )}
        {fehler && <p className="mt-3 text-sm text-red-600">{fehler}</p>}
      </section>

      {status?.erlaubt && <BriefboegenVerwalten />}
      {status?.erlaubt && status.verbunden && <MayerFilterEinstellungen />}
    </div>
  )
}

function AbgleichZeile({ titel, lauf }: { titel: string; lauf?: AbgleichLauf }) {
  if (!lauf) return <div className="text-xs text-slate-400">{titel}: noch kein Abgleich (läuft alle 3 Minuten).</div>
  return (
    <div className="text-xs text-slate-500">
      {titel}: zuletzt {fmtDateTime(lauf.am)} · {lauf.vonMicrosoft} von Microsoft, {lauf.nachMicrosoft} nach Microsoft, {lauf.geloescht} gelöscht
      {lauf.konflikte ? `, ${lauf.konflikte} gleichzeitig geändert (jüngere Fassung gewann)` : ''}
      {lauf.fehler?.length ? <span className="text-amber-700"> · Probleme: {lauf.fehler.join(' | ')}</span> : null}
    </div>
  )
}

/** Welche Listen aus Microsoft To Do abgeglichen werden (Runde 6). Ausgeschlossene Listen holt der Abgleich nicht mehr;
 *  was schon übernommen ist, bleibt gespeichert und ist in der To-Do-Liste nur ausgeblendet (dort „Anzeigen“). */
function ToDoListenAuswahl({ ich, listen }: { ich: string; listen: ToDoListeStand[] }) {
  const [aus, setAus] = useState<Set<string>>(() => new Set(listen.filter((l) => l.aus).map((l) => l.id)))
  const [offen, setOffen] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState('')
  const vorher = listen.filter((l) => l.aus).map((l) => l.id).sort().join('|')
  const geaendert = [...aus].sort().join('|') !== vorher
  async function speichern() {
    setFehler('')
    setSpeichert(true)
    try {
      await setzeToDoListen(ich, [...aus])
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setSpeichert(false)
    }
  }
  const ausgeschlossen = listen.filter((l) => l.aus).length
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <button type="button" className="flex w-full items-center justify-between text-left font-medium text-slate-700" onClick={() => setOffen((o) => !o)}>
        <span>To-Do-Listen: {listen.length - ausgeschlossen} von {listen.length} werden abgeglichen</span>
        <span className="text-xs text-accent-700">{offen ? 'Schließen' : 'Auswählen'}</span>
      </button>
      {offen && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Nicht angehakte Listen holt das CRM nicht mehr. Schon übernommene Aufgaben daraus bleiben gespeichert, werden aber in deiner To-Do-Liste und in der
            Morgen-Übersicht ausgeblendet. Gelöscht wird nichts.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {listen.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={!aus.has(l.id)}
                  onChange={(e) => setAus((a) => {
                    const n = new Set(a)
                    if (e.target.checked) n.delete(l.id)
                    else n.add(l.id)
                    return n
                  })}
                />
                <span>{l.name || 'Liste ohne Namen'}</span>
                {l.markiert && <span className="text-xs text-slate-400">(markierte Mails)</span>}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <PrimaryButton onClick={speichern} disabled={!geaendert || speichert}>
              <Check size={16} /> Auswahl speichern
            </PrimaryButton>
            {fehler && <span className="text-xs text-red-600">{fehler}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
