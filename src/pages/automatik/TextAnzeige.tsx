// Text einer automatischen Nachricht: Mail-Vorlage (Vorschau, bearbeiten, Platzhalter), Regel-Vorlage,
// Wiedervorlage-Regeln (Tabelle zum Bearbeiten), fester Programmtext oder KI-Hinweis.
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Field, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { AUTO_PLATZHALTER } from '../../lib/autoNachrichten'
import { AUTOMATIK_PLATZHALTER, type AutomatikEintrag } from '../../lib/automatik/katalog'
import { BEREICH_NAME, standName, type AutomatikStand, type SchalterAenderung, type WvRegelStand } from '../../lib/automatik/schalter'
import { ausloeserText } from '../../lib/wiedervorlagen'

type Platzhalter = { name: string; bedeutung: string }

const WILLKOMMEN_PLATZHALTER: Platzhalter[] = [
  { name: 'ansprechpartner', bedeutung: 'Name des Kunden' },
  { name: 'ansprechpartner_satz', bedeutung: '„Ihr persönlicher Ansprechpartner ist …“ (fällt ohne Verantwortlichen weg)' },
  { name: 'link', bedeutung: 'Link zum Hochladen von Unterlagen' },
  { name: 'gruss', bedeutung: 'Name des Verantwortlichen' },
]

function bekanntePlatzhalter(e: AutomatikEintrag): Platzhalter[] {
  if (e.id === 'willkommen') return WILLKOMMEN_PLATZHALTER
  if (e.text.art === 'regel' && e.text.regelId.startsWith('immo_')) return AUTO_PLATZHALTER
  return AUTOMATIK_PLATZHALTER[e.id] ?? AUTOMATIK_PLATZHALTER[e.kanal] ?? []
}

export function TextBereich({
  eintrag,
  stand,
  darfAendern,
  onSchalter,
}: {
  eintrag: AutomatikEintrag
  stand: AutomatikStand | null
  darfAendern: boolean
  onSchalter: (id: string, a: SchalterAenderung) => Promise<boolean>
}) {
  const t = eintrag.text
  switch (t.art) {
    case 'vorlage':
      return <VorlageText vorlageId={t.vorlageId} platzhalter={bekanntePlatzhalter(eintrag)} darfAendern={darfAendern} />
    case 'regel': {
      const regel = stand?.regeln.find((r) => r.id === t.regelId)
      if (!regel) return <p className="text-xs text-slate-500">Die Regel „{t.regelId}“ ist gerade nicht lesbar, deshalb fehlt hier die Vorlage.</p>
      if (!regel.vorlageId) return <p className="text-xs text-slate-500">Zu dieser Regel ist keine Mail-Vorlage eingetragen.</p>
      return <VorlageText vorlageId={regel.vorlageId} platzhalter={bekanntePlatzhalter(eintrag)} darfAendern={darfAendern} />
    }
    case 'wv_regeln':
      return <WvRegelTabelle regeln={stand?.wvRegeln ?? []} darfAendern={darfAendern && stand?.quelle === 'server'} serverBereit={stand?.quelle === 'server'} onSchalter={onSchalter} />
    case 'fest':
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">Der Text wird vom Programm aus den Daten der Akte zusammengesetzt.</p>
          {t.beispiel && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-medium text-slate-400">Beispiel</p>
              <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{t.beispiel}</pre>
            </div>
          )}
        </div>
      )
    case 'ki':
      return <p className="text-xs text-slate-600">{t.hinweis}.</p>
  }
}

function VorlageText({ vorlageId, platzhalter, darfAendern }: { vorlageId: string; platzhalter: Platzhalter[]; darfAendern: boolean }) {
  const { state, dispatch } = useApp()
  const vorlage = state.mailVorlagen.find((v) => v.id === vorlageId)
  const [bearbeiten, setBearbeiten] = useState(false)
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')

  if (!vorlage) return <p className="text-xs text-amber-700">Vorlage noch nicht vorhanden.</p>

  function start() {
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
    <div className="space-y-2">
      {bearbeiten ? (
        <div>
          <Field label="Betreff">
            <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </Field>
          <Field label="Text">
            <textarea className={`${inputClass} min-h-[240px] font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <PrimaryButton onClick={speichern} disabled={!betreff.trim() || !text.trim()}>
              Vorlage speichern
            </PrimaryButton>
            <SecondaryButton onClick={() => setBearbeiten(false)}>Abbrechen</SecondaryButton>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Betreff: {vorlage.betreff}</p>
          <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{vorlage.text}</pre>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            Mail-Vorlage „{vorlage.name}“ — auch im Postfach unter „Mailvorlagen verwalten“.
            {darfAendern && (
              <button onClick={start} className="font-medium text-accent-600 hover:underline">
                Text bearbeiten
              </button>
            )}
          </p>
        </div>
      )}
      <PlatzhalterListe bekannt={platzhalter} texte={[vorlage.betreff, bearbeiten ? text : vorlage.text]} />
    </div>
  )
}

/** Bekannte Platzhalter plus die, die im Text vorkommen (ohne Erklärung, falls unbekannt). */
function PlatzhalterListe({ bekannt, texte }: { bekannt: Platzhalter[]; texte: string[] }) {
  const [offen, setOffen] = useState(false)
  const imText = new Set<string>()
  for (const t of texte) for (const m of t.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) imText.add(m[1])
  const liste = [...bekannt, ...[...imText].filter((n) => !bekannt.some((b) => b.name === n)).map((name) => ({ name, bedeutung: '' }))]
  if (liste.length === 0) return null
  return (
    <div className="text-xs">
      <button onClick={() => setOffen((x) => !x)} className="flex items-center gap-1 text-slate-500 hover:text-slate-700">
        {offen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Platzhalter ({liste.length})
      </button>
      {offen && (
        <ul className="mt-1 grid gap-1 pl-4 text-slate-600 sm:grid-cols-2">
          {liste.map((p) => (
            <li key={p.name}>
              <code className="rounded bg-slate-100 px-1">{`{{${p.name}}}`}</code> {p.bedeutung}
              {imText.has(p.name) ? '' : <span className="text-slate-400"> (im Text nicht benutzt)</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WvRegelTabelle({
  regeln,
  darfAendern,
  serverBereit,
  onSchalter,
}: {
  regeln: WvRegelStand[]
  darfAendern: boolean
  serverBereit: boolean
  onSchalter: (id: string, a: SchalterAenderung) => Promise<boolean>
}) {
  if (regeln.length === 0) return <p className="text-xs text-slate-500">Die Regeln lassen sich gerade nicht lesen.</p>
  return (
    <div className="space-y-2">
      {!serverBereit && <p className="text-xs text-slate-400">Ändern geht, sobald der Server die Einstellungen liefert.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-2 font-medium">An</th>
              <th className="py-1 pr-2 font-medium">Bereich</th>
              <th className="py-1 pr-2 font-medium">Auslöser</th>
              <th className="py-1 pr-2 font-medium">Titel der Wiedervorlage</th>
              <th className="py-1 font-medium">fällig nach</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {regeln.map((r) => (
              <WvZeile key={r.id} regel={r} darfAendern={darfAendern} onSchalter={onSchalter} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WvZeile({ regel, darfAendern, onSchalter }: { regel: WvRegelStand; darfAendern: boolean; onSchalter: (id: string, a: SchalterAenderung) => Promise<boolean> }) {
  const [titel, setTitel] = useState(regel.titel)
  const [tage, setTage] = useState(String(regel.tage))
  const id = `wv:${regel.id}`
  const ausloeser = ausloeserText(regel.ausloeser, (s) => standName(s, regel.bereich))

  async function titelSichern() {
    const neu = titel.trim()
    if (!neu || neu === regel.titel) return setTitel(regel.titel)
    if (!(await onSchalter(id, { titel: neu }))) setTitel(regel.titel)
  }
  async function tageSichern() {
    const n = Number(tage)
    if (!Number.isFinite(n) || n < 0 || n > 365 || Math.round(n) !== n) return setTage(String(regel.tage))
    if (n === regel.tage) return
    if (!(await onSchalter(id, { tage: n }))) setTage(String(regel.tage))
  }

  return (
    <tr className={regel.aktiv ? '' : 'text-slate-400'}>
      <td className="py-1.5 pr-2">
        <input type="checkbox" checked={regel.aktiv} disabled={!darfAendern} onChange={(e) => onSchalter(id, { wert: e.target.checked })} aria-label="Regel eingeschaltet" />
      </td>
      <td className="py-1.5 pr-2">{BEREICH_NAME(regel.bereich)}</td>
      <td className="py-1.5 pr-2">{ausloeser}</td>
      <td className="py-1.5 pr-2">
        {darfAendern ? (
          <input className="w-full rounded border border-slate-200 px-1.5 py-0.5" value={titel} onChange={(e) => setTitel(e.target.value)} onBlur={titelSichern} />
        ) : (
          regel.titel
        )}
      </td>
      <td className="whitespace-nowrap py-1.5">
        {darfAendern ? (
          <input type="number" min={0} max={365} className="w-14 rounded border border-slate-200 px-1.5 py-0.5" value={tage} onChange={(e) => setTage(e.target.value)} onBlur={tageSichern} />
        ) : (
          regel.tage
        )}{' '}
        Tagen
      </td>
    </tr>
  )
}
