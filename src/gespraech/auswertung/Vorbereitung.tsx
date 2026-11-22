// Vorbereitung auf ein Gespräch: Termin der nächsten 14 Tage oder Akte wählen → Briefing wie das Termin-Briefing
// per Telegram (Server-Aktion gespraech_vorbereitung, Kern _shared/terminBriefingKern.ts): Stand der Akte,
// Sachverhalt, letzte Kontakte, offene Wiedervorlagen, fehlende Unterlagen, offene Rechnungen/Angebote und
// zwei bis drei vorgeschlagene Gesprächspunkte. Liest nur.
//
// Einbindung (Helfer „app“): z. B. Route #/vorbereitung (Adresse ?termin=… / ?kunde=… / ?objekt=… wählt
// gleich vor) oder als Eigenschaften. `onAufnahme` startet die Aufnahme mit den passenden Vorgaben
// (gleiche Felder wie AufnahmeVorbereitung in sitzung.ts); ohne `onAufnahme` gibt es den Knopf nicht.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { sucheAkten, type AkteTreffer } from '../akten'
import { istBeteiligt } from '../termine'
import { eigeneEmail, vorbereitung, type BriefingAntwort } from './api'

export type VorbereitungVorgabe = {
  art: 'termin'
  titel: string
  kundeId?: string
  kundeBereich?: string
  kundeName?: string
  objektId?: string
  terminId?: string
}

type TerminZeile = { id: string; titel: string; beginn: string; ende: string; ganztags: boolean | null; ort: string | null; kunde_name: string | null; besitzer_email: string; teilnehmer: string[] | null }

function terminZeit(t: { beginn: string; ende: string; ganztags?: boolean | null }): string {
  const b = new Date(t.beginn)
  const tag = b.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  if (t.ganztags) return `${tag}, ganztägig`
  const uhr = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  return `${tag}, ${uhr(b)}–${uhr(new Date(t.ende))} Uhr`
}

function kurzDatum(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.` : ''
}

export function Vorbereitung({ terminId, kundeId, objektId, onAufnahme }: { terminId?: string; kundeId?: string; objektId?: string; onAufnahme?: (v: VorbereitungVorgabe) => void }) {
  const [params] = useSearchParams()
  const start = {
    terminId: terminId ?? params.get('termin') ?? undefined,
    kundeId: kundeId ?? params.get('kunde') ?? undefined,
    objektId: objektId ?? params.get('objekt') ?? undefined,
  }
  const [termine, setTermine] = useState<TerminZeile[]>([])
  const [suche, setSuche] = useState('')
  const [treffer, setTreffer] = useState<AkteTreffer[]>([])
  const [antwort, setAntwort] = useState<BriefingAntwort | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    ;(async () => {
      if (!supabase) return
      const ich = await eigeneEmail()
      const jetzt = new Date()
      const { data } = await supabase
        .from('termine')
        .select('id, titel, beginn, ende, ganztags, ort, kunde_name, besitzer_email, teilnehmer')
        .gt('ende', jetzt.toISOString())
        .lt('beginn', new Date(jetzt.getTime() + 14 * 86400000).toISOString())
        .order('beginn')
        .limit(200)
      if (aktiv) setTermine(((data ?? []) as TerminZeile[]).filter((t) => istBeteiligt(t, ich)).slice(0, 30))
    })().catch(() => {})
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (start.terminId || start.kundeId || start.objektId) void lade(start)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start.terminId, start.kundeId, start.objektId])

  useEffect(() => {
    const s = suche.trim()
    if (s.length < 2) {
      setTreffer([])
      return
    }
    let aktiv = true
    const uhr = setTimeout(() => {
      sucheAkten(s).then((t) => aktiv && setTreffer(t)).catch(() => aktiv && setTreffer([]))
    }, 250)
    return () => {
      aktiv = false
      clearTimeout(uhr)
    }
  }, [suche])

  async function lade(ziel: { terminId?: string; kundeId?: string; objektId?: string }) {
    setLaeuft(true)
    setFehler('')
    setAntwort(null)
    try {
      setAntwort(await vorbereitung(ziel))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaeuft(false)
    }
  }

  const b = antwort?.briefing
  const v = antwort?.vorgabe
  return (
    <div className="pb-4">
      <h1 className="text-xl font-semibold text-slate-900">Gespräch vorbereiten</h1>

      {!antwort && !laeuft && (
        <>
          <h2 className="mt-4 text-sm font-semibold text-slate-700">Meine nächsten Termine</h2>
          <ul className="mt-2 space-y-1.5">
            {termine.map((t) => (
              <li key={t.id}>
                <button onClick={() => lade({ terminId: t.id })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left">
                  <div className="text-sm font-medium text-slate-900">{t.titel}</div>
                  <div className="text-xs text-slate-500">{terminZeit(t)}{t.kunde_name ? ` · ${t.kunde_name}` : ''}{t.ort ? ` · ${t.ort}` : ''}</div>
                </button>
              </li>
            ))}
            {termine.length === 0 && <li className="text-sm text-slate-500">Keine Termine in den nächsten 14 Tagen.</li>}
          </ul>
          <h2 className="mt-5 text-sm font-semibold text-slate-700">Oder Akte suchen</h2>
          <input className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none" value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma, Objekt" />
          <div className="mt-2 space-y-1.5">
            {treffer.map((t) => (
              <button key={`${t.art}${t.id}`} onClick={() => lade(t.art === 'kunde' ? { kundeId: t.id } : { objektId: t.id })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm">
                <span className="text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-400">{t.zusatz}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {laeuft && <p className="mt-6 text-sm text-slate-500">Briefing wird zusammengestellt …</p>}
      {fehler && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{fehler}</p>}

      {antwort && (
        <div className="mt-4 space-y-4">
          <button onClick={() => setAntwort(null)} className="text-sm text-indigo-600">← Andere Auswahl</button>
          {antwort.termin && (
            <div className="rounded-xl bg-indigo-50 p-3">
              <div className="font-medium text-indigo-900">{antwort.termin.titel}</div>
              <div className="text-sm text-indigo-800">{terminZeit(antwort.termin)}{antwort.termin.ort ? ` · ${antwort.termin.ort}` : ''}</div>
            </div>
          )}
          {antwort.hinweis && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{antwort.hinweis}</p>}
          {b && (
            <>
              <div>
                <div className="text-lg font-semibold text-slate-900">{b.kopf}</div>
                <div className="text-sm text-slate-500">{[b.stand && `Stand: ${b.stand}`, b.verantwortlich && `Verantwortlich: ${b.verantwortlich}`].filter(Boolean).join(' · ')}</div>
                {b.eckdaten.map((e, i) => <div key={i} className="text-sm text-slate-600">{e}</div>)}
              </div>
              {(antwort.gespraechspunkte ?? []).length > 0 && (
                <Teil titel="Gesprächspunkte (Vorschlag)" punkte={antwort.gespraechspunkte} hervor />
              )}
              {b.sachverhalt && <Teil titel="Sachverhalt" text={b.sachverhalt} />}
              {b.naechsteSchritte && <Teil titel="Nächste Schritte laut Akte" text={b.naechsteSchritte} />}
              <Teil titel="Letzte Kontakte" punkte={b.kontakte.map((k) => `${kurzDatum(k.datum)} ${k.text}`)} leer="keine erfasst" />
              <Teil titel="Offen" punkte={b.offen} leer="keine Wiedervorlage gesetzt" />
              {b.fehlend.length > 0 && <Teil titel={`Fehlende Unterlagen${b.fehlendSeit ? ` (angefordert am ${kurzDatum(b.fehlendSeit)})` : ''}`} punkte={b.fehlend} />}
              {b.geld.length > 0 && <Teil titel="Offene Rechnungen und Angebote" punkte={b.geld} />}
              {b.fehler.length > 0 && <p className="text-xs text-slate-400">Nicht alles geladen: {b.fehler.join('; ')}</p>}
              {b.link && <a href={b.link} target="_blank" rel="noreferrer" className="inline-block text-sm text-indigo-600">Akte im CRM öffnen</a>}
            </>
          )}
          {onAufnahme && v && (
            <button
              onClick={() => onAufnahme({ art: 'termin', titel: v.titel, kundeId: v.kundeId ?? undefined, kundeBereich: v.kundeBereich ?? undefined, kundeName: b?.kopf, objektId: v.objektId ?? undefined, terminId: v.terminId ?? undefined })}
              className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white"
            >
              Aufnahme für dieses Gespräch starten
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Teil({ titel, text, punkte, leer, hervor }: { titel: string; text?: string; punkte?: string[]; leer?: string; hervor?: boolean }) {
  return (
    <section className={hervor ? 'rounded-xl border border-indigo-200 bg-white p-3' : ''}>
      <h2 className="text-sm font-semibold text-slate-700">{titel}</h2>
      {text && <p className="mt-1 whitespace-pre-line text-[15px] text-slate-800">{text}</p>}
      {punkte && punkte.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px] text-slate-800">
          {punkte.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}
      {punkte && punkte.length === 0 && leer && <p className="mt-1 text-sm text-slate-500">{leer}</p>}
    </section>
  )
}
