// Seite „Automatische Nachrichten“ der Immobilien-Abteilung (21.11.2026, Eray: vorgefertigte Mails, die nach
// bestimmten Ereignissen automatisch hinausgehen). Oben die Regeln (an/aus und Wartezeit nur für
// Geschäftsführung und Superuser, Regel in der Datenbank), mit Vorschau und Bearbeiten der Mail-Vorlage;
// darunter die Warteschlange (geplant, gesendet, nicht gesendet, Fehler).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Mail, RefreshCw } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { CURRENT_USER } from '../../data/constants'
import { AutoNachrichtZeile } from '../../components/AutoNachrichtenListe'
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import {
  AUTO_PLATZHALTER,
  WARTEZEIT_WAHL,
  ladeAutoNachrichten,
  ladeAutoRegeln,
  setzeAutoRegel,
  wartezeitText,
  type AutoNachricht,
  type AutoRegel,
} from '../../lib/autoNachrichten'

type Ansicht = 'geplant' | 'gesendet' | 'rest'

export function AutoNachrichten() {
  const { state } = useApp()
  const { mitarbeiter, istSuperuser, ansichtAls } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const darfSchalten = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || istSuperuser)
  const [regeln, setRegeln] = useState<AutoRegel[]>([])
  const [liste, setListe] = useState<AutoNachricht[]>([])
  const [fehler, setFehler] = useState('')
  const [ansicht, setAnsicht] = useState<Ansicht>('geplant')
  const [hilfeOffen, setHilfeOffen] = useState(false)

  const laden = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([ladeAutoRegeln(), ladeAutoNachrichten()])
      setRegeln(r)
      setListe(l)
      setFehler('')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Laden hat nicht geklappt.')
    }
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  const objektNamen = useMemo(() => new Map(state.objekte.map((o) => [o.id, o.bezeichnung])), [state.objekte])
  const titel = useMemo(() => new Map(regeln.map((r) => [r.id, r.titel])), [regeln])

  const gruppen = useMemo(() => {
    const geplant = liste.filter((n) => n.status === 'geplant' || n.status === 'ohne_adresse').sort((a, b) => a.sendenAb.localeCompare(b.sendenAb))
    const gesendet = liste.filter((n) => n.status === 'gesendet').sort((a, b) => (b.gesendetAm ?? '').localeCompare(a.gesendetAm ?? ''))
    const rest = liste.filter((n) => n.status === 'abgebrochen' || n.status === 'fehler')
    return { geplant, gesendet, rest }
  }, [liste])
  const anzahlFehler = liste.filter((n) => n.status === 'fehler').length

  async function setze(r: AutoRegel, neu: { aktiv?: boolean; wartezeitMinuten?: number }) {
    setFehler('')
    try {
      await setzeAutoRegel(r.id, neu, wer)
      setRegeln(await ladeAutoRegeln())
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    }
  }

  const sichtbar = gruppen[ansicht]
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Automatische Nachrichten</h1>
          <p className="text-sm text-slate-500">
            Vorgefertigte E-Mails an Interessenten, die nach bestimmten Ereignissen von selbst hinausgehen. {regeln.filter((r) => r.aktiv).length} von {regeln.length} eingeschaltet.
          </p>
        </div>
        <SecondaryButton onClick={laden}>
          <RefreshCw size={14} /> Aktualisieren
        </SecondaryButton>
      </div>

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      <Card className="mb-4 p-4 text-sm text-slate-600">
        <p>
          So funktioniert es: Trägt jemand in der Objektakte eine Besichtigung ein, ändert ihren Stand oder ein Kaufpreisangebot, oder stimmt ein Interessent im Interessenten-Portal zu, merkt das CRM die passende Nachricht vor. Nach der Wartezeit geht sie an die E-Mail-Adresse des Interessenten. Bis dahin lässt sich jede Nachricht hier oder in der Objektakte ansehen, sofort senden oder abbrechen. Passt der Anlass beim Senden nicht mehr (z. B. Termin abgesagt), geht nichts hinaus. Private Objekte bekommen nie eine automatische Nachricht.
        </p>
        {!darfSchalten && <p className="mt-2 text-xs text-slate-400">Ein- und ausschalten und die Wartezeit ändern darf nur die Geschäftsführung.</p>}
      </Card>

      <div className="mb-6 space-y-3">
        {regeln.map((r) => (
          <RegelKarte key={r.id} regel={r} darfSchalten={darfSchalten} onSetze={(neu) => setze(r, neu)} />
        ))}
        <div className="rounded-lg border border-slate-200 bg-white text-sm">
          <button onClick={() => setHilfeOffen((x) => !x)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-600">
            {hilfeOffen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
            Platzhalter für die Vorlagen
          </button>
          {hilfeOffen && (
            <div className="border-t border-slate-100 px-3 py-3 text-xs text-slate-600">
              <ul className="grid gap-1 sm:grid-cols-2">
                {AUTO_PLATZHALTER.map((p) => (
                  <li key={p.name}>
                    <code className="rounded bg-slate-100 px-1">{`{{${p.name}}}`}</code> {p.bedeutung}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-slate-400">Bleibt ein Platzhalter leer (z. B. kein Telefon hinterlegt), fällt die ganze Zeile weg. Nur bei {'{{Name}}'} bleibt die Zeile stehen („Guten Tag,“).</p>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-sm font-semibold text-slate-700">Warteschlange</h2>
        {(
          [
            ['geplant', `Geplant (${gruppen.geplant.length})`],
            ['gesendet', `Gesendet (${gruppen.gesendet.length})`],
            ['rest', `Nicht gesendet und Fehler (${gruppen.rest.length})`],
          ] as [Ansicht, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAnsicht(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${ansicht === id ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {label}
          </button>
        ))}
        {anzahlFehler > 0 && <span className="text-xs font-medium text-rose-600">{anzahlFehler} mit Fehler</span>}
      </div>
      {sichtbar.length === 0 ? (
        <EmptyState text={ansicht === 'geplant' ? 'Gerade ist keine Nachricht geplant.' : 'Hier ist noch nichts.'} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {sichtbar.map((n) => (
              <AutoNachrichtZeile
                key={n.id}
                n={n}
                regelTitel={titel.get(n.regel) ?? n.regel}
                objektId={n.objektId}
                objektName={n.objektId ? objektNamen.get(n.objektId) ?? 'Objekt' : undefined}
                nurLesen={!!ansichtAls}
                onGeaendert={laden}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function RegelKarte({ regel, darfSchalten, onSetze }: { regel: AutoRegel; darfSchalten: boolean; onSetze: (neu: { aktiv?: boolean; wartezeitMinuten?: number }) => void }) {
  const { state, dispatch } = useApp()
  const { ansichtAls } = useAuth()
  const vorlage = state.mailVorlagen.find((v) => v.id === regel.vorlageId)
  const [offen, setOffen] = useState(false)
  const [bearbeiten, setBearbeiten] = useState(false)
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')

  function startBearbeiten() {
    setBetreff(vorlage?.betreff ?? '')
    setText(vorlage?.text ?? '')
    setBearbeiten(true)
  }

  function speichern() {
    if (!vorlage || !betreff.trim() || !text.trim()) return
    dispatch({ type: 'UPDATE_MAIL_VORLAGE', id: vorlage.id, patch: { betreff: betreff.trim(), text } })
    setBearbeiten(false)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button onClick={() => setOffen((x) => !x)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {offen ? <ChevronDown size={15} className="shrink-0 text-slate-400" /> : <ChevronRight size={15} className="shrink-0 text-slate-400" />}
          <Mail size={15} className="shrink-0 text-slate-400" />
          <span className="font-medium text-slate-700">{regel.titel}</span>
          <span className={regel.aktiv ? 'font-medium text-emerald-700' : 'text-slate-500'}>{regel.aktiv ? `an, ${wartezeitText(regel)}` : 'aus'}</span>
        </button>
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={regel.aktiv} disabled={!darfSchalten} onChange={(e) => onSetze({ aktiv: e.target.checked })} />
          eingeschaltet
        </label>
        {regel.wartezeitMinuten !== null && (
          <label className="flex items-center gap-2 text-slate-600">
            Wartezeit
            <select
              value={regel.wartezeitMinuten}
              disabled={!darfSchalten}
              onChange={(e) => onSetze({ wartezeitMinuten: Number(e.target.value) })}
              className="rounded border border-slate-200 px-1 py-0.5 text-sm"
            >
              {Array.from(new Set([...WARTEZEIT_WAHL, regel.wartezeitMinuten])).sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'sofort' : m < 60 ? `${m} Minuten` : m === 1440 ? '1 Tag' : `${m / 60} Std.`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {offen && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <p className="text-xs text-slate-500">{regel.beschreibung}</p>
          {regel.geaendertVon && <p className="text-xs text-slate-400">Zuletzt geändert von {regel.geaendertVon}</p>}
          {!vorlage ? (
            <p className="text-xs text-rose-600">Die Mail-Vorlage „{regel.vorlageId}“ fehlt. Ohne sie geht diese Nachricht nicht hinaus.</p>
          ) : bearbeiten ? (
            <div className="space-y-2">
              <Field label="Betreff">
                <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
              </Field>
              <Field label="Text">
                <textarea className={`${inputClass} min-h-[260px] font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <PrimaryButton onClick={speichern}>Vorlage speichern</PrimaryButton>
                <SecondaryButton onClick={() => setBearbeiten(false)}>Abbrechen</SecondaryButton>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">Betreff: {vorlage.betreff}</p>
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{vorlage.text}</pre>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                Mail-Vorlage „{vorlage.name}“ — auch im Postfach unter „Mailvorlagen verwalten“ zu finden.
                {!ansichtAls && (
                  <button onClick={startBearbeiten} className="font-medium text-accent-600 hover:underline">
                    Text bearbeiten
                  </button>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
