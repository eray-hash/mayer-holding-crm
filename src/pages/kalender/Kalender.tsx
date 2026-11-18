import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Lock, Settings, AlertTriangle, Users, MapPin, Trash2, Check, CalendarPlus, Copy } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import {
  ladeTermine,
  ladeBelegt,
  ladeKollegen,
  ladeEinstellungen,
  speichereEinstellungen,
  telegramVerbunden,
  ERINNERUNGS_WAHL,
  type Termin,
  type Belegt,
  type Kollege,
  type KalenderEinstellungen,
} from '../../lib/kalenderDb'
import { speichereTerminRemote, loescheTerminRemote, TerminUeberschneidung, holeKalenderAbo, type KalenderAbo } from '../../lib/emailGateway'
import { KUNDEN_BEREICHE, kundeDetailPfad, kundeBereichLabel } from '../../data/kundenBereiche'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import type { KundeBereich } from '../../types'

type Ansicht = 'tag' | 'woche' | 'monat'

const STUNDE_PX = 44
const ERSTE_STUNDE = 6
const LETZTE_STUNDE = 22
const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
// Eine Farbe je Person, damit man in der Teamansicht auf einen Blick sieht, wer belegt ist.
const FARBEN = ['#4f46e5', '#0d9488', '#d97706', '#be185d', '#0369a1', '#65a30d', '#7c3aed', '#b45309']

const p2 = (n: number) => String(n).padStart(2, '0')
const tagKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const tagStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const plusTage = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const montagVon = (d: Date) => plusTage(tagStart(d), -((d.getDay() + 6) % 7))
const uhr = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
const datumLang = (d: Date) => d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

type Eintrag = {
  key: string
  von: Date
  bis: Date
  ganztags: boolean
  // Voll sichtbarer Termin (eigener oder gemeinsam gebuchter) — sonst nur ein belegter Zeitraum.
  termin?: Termin
  person: string
  privat: boolean
}

type Formular = {
  id?: string
  titel: string
  datum: string
  von: string
  bis: string
  ganztags: boolean
  ort: string
  beschreibung: string
  teilnehmer: string[]
  kunde: { id: string; bereich: string; name: string } | null
}

/**
 * Kalender. Im privaten Bereich: der eigene Kalender mit allem (Termine, Follow-ups, To-dos).
 * Im öffentlichen Bereich: die Kalender aller Kollegen nebeneinander — fremde Termine erscheinen nur
 * als "Privat" (belegt). Voll zu sehen ist ein Termin nur für die, die ihn gemeinsam gebucht haben.
 */
export function Kalender({ privat = false }: { privat?: boolean }) {
  const navigate = useNavigate()
  const { state } = useApp()
  const { session, mitarbeiter } = useAuth()
  const ich = (session?.user.email ?? '').toLowerCase()

  const [ansicht, setAnsicht] = useState<Ansicht>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'tag' : 'woche'))
  const [anker, setAnker] = useState(() => tagStart(new Date()))
  const [termine, setTermine] = useState<Termin[]>([])
  const [belegt, setBelegt] = useState<Belegt[]>([])
  const [kollegen, setKollegen] = useState<Kollege[]>([])
  const [gezeigt, setGezeigt] = useState<string[] | null>(null)
  const [fehler, setFehler] = useState('')
  const [laedt, setLaedt] = useState(false)
  const [formular, setFormular] = useState<Formular | null>(null)
  const [detail, setDetail] = useState<Termin | null>(null)
  const [einstellungenOffen, setEinstellungenOffen] = useState(false)
  const [aboOffen, setAboOffen] = useState(false)
  const rasterRef = useRef<HTMLDivElement>(null)

  const { von, bis, tage } = useMemo(() => {
    if (ansicht === 'tag') return { von: anker, bis: plusTage(anker, 1), tage: [anker] }
    if (ansicht === 'woche') {
      const mo = montagVon(anker)
      return { von: mo, bis: plusTage(mo, 7), tage: Array.from({ length: 7 }, (_, i) => plusTage(mo, i)) }
    }
    const erster = montagVon(new Date(anker.getFullYear(), anker.getMonth(), 1))
    return { von: erster, bis: plusTage(erster, 42), tage: Array.from({ length: 42 }, (_, i) => plusTage(erster, i)) }
  }, [ansicht, anker])

  async function lade() {
    if (!ich) return
    setLaedt(true)
    setFehler('')
    try {
      const [t, b] = await Promise.all([ladeTermine(von, bis), privat ? Promise.resolve([] as Belegt[]) : ladeBelegt(von, bis)])
      setTermine(t)
      setBelegt(b)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Kalender konnte nicht geladen werden.')
    } finally {
      setLaedt(false)
    }
  }

  useEffect(() => {
    lade()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ich, von.getTime(), bis.getTime(), privat])

  useEffect(() => {
    ladeKollegen()
      .then(setKollegen)
      .catch(() => {})
  }, [])

  // Beim ersten Öffnen auf den Arbeitsbeginn scrollen statt auf 6 Uhr.
  useEffect(() => {
    if (rasterRef.current) rasterRef.current.scrollTop = (8 - ERSTE_STUNDE) * STUNDE_PX - 8
  }, [ansicht])

  const namen = useMemo(() => new Map(kollegen.map((k) => [k.email, k.name])), [kollegen])
  const farbe = (email: string) => FARBEN[Math.max(0, kollegen.findIndex((k) => k.email === email)) % FARBEN.length]
  const personen = privat ? [ich] : (gezeigt ?? kollegen.map((k) => k.email))

  // Alles, was im Raster erscheint: die voll sichtbaren Termine (einmal, auch wenn mehrere der
  // gezeigten Personen dabei sind) und die nur als belegt bekannten Zeiträume der Kollegen.
  const eintraege = useMemo<Eintrag[]>(() => {
    const liste: Eintrag[] = []
    const bekannt = new Set<string>()
    for (const t of termine) {
      const beteiligte = [t.besitzerEmail, ...t.teilnehmer]
      for (const p of beteiligte) bekannt.add(`${p}|${new Date(t.beginn).getTime()}|${new Date(t.ende).getTime()}`)
      if (!beteiligte.some((p) => personen.includes(p))) continue
      liste.push({ key: t.id, von: new Date(t.beginn), bis: new Date(t.ende), ganztags: t.ganztags, termin: t, person: t.besitzerEmail, privat: false })
    }
    if (!privat) {
      belegt.forEach((b, i) => {
        if (!personen.includes(b.person) || b.person === ich) return
        if (bekannt.has(`${b.person}|${new Date(b.beginn).getTime()}|${new Date(b.ende).getTime()}`)) return
        liste.push({ key: `b${i}`, von: new Date(b.beginn), bis: new Date(b.ende), ganztags: b.ganztags, person: b.person, privat: true })
      })
    }
    return liste.sort((x, y) => x.von.getTime() - y.von.getTime())
  }, [termine, belegt, personen.join(','), privat, ich])

  // Follow-ups und To-dos stehen im eigenen Kalender mit drin (als Tagesmarken, nicht als Termine).
  const marken = useMemo(() => {
    const proTag = new Map<string, { key: string; text: string; pfad?: string; art: 'followup' | 'todo' }[]>()
    const fuege = (tag: string, m: { key: string; text: string; pfad?: string; art: 'followup' | 'todo' }) => proTag.set(tag, [...(proTag.get(tag) ?? []), m])
    const meinName = (mitarbeiter?.name ?? state.profil.name ?? '').trim().toLowerCase()
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        if (!k.followUp?.date || k.followUp.done) continue
        if (b.id !== 'privat' && meinName && (k.verantwortlich ?? '').trim().toLowerCase() !== meinName) continue
        fuege(k.followUp.date, { key: `f${k.id}`, text: `${k.firma}: ${k.followUp.note || 'Follow-up'}`, pfad: kundeDetailPfad(b.id, k.id), art: 'followup' })
      }
    }
    for (const t of state.todos) {
      if (!t.geplanteWiedervorlage || t.erledigtAm || t.besitzerEmail.toLowerCase() !== ich) continue
      fuege(t.geplanteWiedervorlage.slice(0, 10), { key: `t${t.id}`, text: t.aufgabe, pfad: t.bereich ? undefined : '/privat/todo', art: 'todo' })
    }
    return proTag
  }, [state, mitarbeiter?.name, ich])

  function neuesFormular(start: Date, ganztags = false): Formular {
    const ende = new Date(start.getTime() + 3600000)
    return { titel: '', datum: tagKey(start), von: uhr(start), bis: uhr(ende), ganztags, ort: '', beschreibung: '', teilnehmer: [], kunde: null }
  }

  function bearbeiten(t: Termin) {
    const v = new Date(t.beginn)
    const b = new Date(t.ende)
    setDetail(null)
    setFormular({ id: t.id, titel: t.titel, datum: tagKey(v), von: uhr(v), bis: uhr(b), ganztags: t.ganztags, ort: t.ort, beschreibung: t.beschreibung, teilnehmer: t.teilnehmer, kunde: t.kundeId ? { id: t.kundeId, bereich: t.kundeBereich ?? '', name: t.kundeName ?? '' } : null })
  }

  function blaettern(richtung: number) {
    if (ansicht === 'monat') setAnker(new Date(anker.getFullYear(), anker.getMonth() + richtung, 1))
    else setAnker(plusTage(anker, richtung * (ansicht === 'woche' ? 7 : 1)))
  }

  const titelZeile =
    ansicht === 'monat'
      ? anker.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
      : ansicht === 'tag'
        ? datumLang(anker)
        : `${tage[0].toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${tage[6].toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
  const heuteKey = tagKey(new Date())

  return (
    <div className="flex flex-col gap-3 md:h-[calc(100vh-7.5rem)]">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold text-slate-800">{privat ? 'Mein Kalender' : 'Kalender'}</h1>
        {privat && (
          <span className="flex items-center gap-1 text-xs text-slate-400">
            <Lock size={12} /> vollständig nur für dich
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs">
            {(['tag', 'woche', 'monat'] as Ansicht[]).map((a) => (
              <button key={a} onClick={() => setAnsicht(a)} className={`px-3 py-1.5 font-medium ${ansicht === a ? 'bg-accent-50 text-accent-700' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {a === 'tag' ? 'Tag' : a === 'woche' ? 'Woche' : 'Monat'}
              </button>
            ))}
          </div>
          <SecondaryButton onClick={() => setAnker(tagStart(new Date()))} className="text-xs">Heute</SecondaryButton>
          <button onClick={() => blaettern(-1)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50" title="Zurück"><ChevronLeft size={15} /></button>
          <button onClick={() => blaettern(1)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50" title="Weiter"><ChevronRight size={15} /></button>
          <button onClick={() => setAboOffen(true)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 text-xs text-slate-600 hover:bg-slate-50" title="In meinen Kalender übernehmen (Handy, Outlook …)">
            <CalendarPlus size={15} /> <span className="hidden sm:inline">In meinen Kalender</span>
          </button>
          <button onClick={() => setEinstellungenOffen(true)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50" title="Erinnerungen und Sichtbarkeit"><Settings size={15} /></button>
          <PrimaryButton onClick={() => { const jetzt = new Date(); setFormular(neuesFormular(new Date(anker.getFullYear(), anker.getMonth(), anker.getDate(), Math.min(21, jetzt.getHours() + 1)))) }} className="text-xs">
            <Plus size={14} /> Termin
          </PrimaryButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-medium text-slate-700">{titelZeile}</span>
        {laedt && <span className="text-xs text-slate-400">lädt …</span>}
        {!privat && kollegen.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {kollegen.map((k) => {
              const an = personen.includes(k.email)
              return (
                <button
                  key={k.email}
                  onClick={() => setGezeigt(an ? personen.filter((p) => p !== k.email) : [...personen, k.email])}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${an ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                  title={an ? 'Ausblenden' : 'Einblenden'}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: an ? farbe(k.email) : '#cbd5e1' }} />
                  {k.email === ich ? 'Ich' : k.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {fehler && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler}
        </div>
      )}

      {ansicht === 'monat' ? (
        <div className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs">
          {WOCHENTAGE.map((w) => (
            <div key={w} className="border-b border-slate-100 px-2 py-1.5 text-center font-medium text-slate-500">{w}</div>
          ))}
          {tage.map((tag) => {
            const key = tagKey(tag)
            const amTag = eintraege.filter((e) => e.von < plusTage(tag, 1) && e.bis > tag)
            const m = privat ? (marken.get(key) ?? []) : []
            return (
              <button
                key={key}
                onClick={() => { setAnker(tag); setAnsicht('tag') }}
                className={`min-h-[4.5rem] border-b border-r border-slate-100 p-1 text-left align-top hover:bg-slate-50 ${tag.getMonth() !== anker.getMonth() ? 'bg-slate-50/60 text-slate-400' : ''}`}
              >
                <div className={`mb-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${key === heuteKey ? 'bg-accent-600 text-white' : 'text-slate-600'}`}>{tag.getDate()}</div>
                {amTag.slice(0, 3).map((e) => (
                  <div key={e.key} className="truncate rounded px-1 py-px text-[11px] text-white" style={{ background: e.privat ? '#94a3b8' : farbe(e.person) }}>
                    {e.privat ? `Privat · ${namen.get(e.person) ?? ''}` : `${e.ganztags ? '' : uhr(e.von) + ' '}${e.termin?.titel}`}
                  </div>
                ))}
                {amTag.length + m.length > 3 && <div className="text-[10px] text-slate-400">+{amTag.length + m.length - Math.min(3, amTag.length)} weitere</div>}
                {amTag.length <= 3 && m.slice(0, 3 - amTag.length).map((x) => <div key={x.key} className="truncate text-[11px] text-slate-500">• {x.text}</div>)}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Kopf mit Wochentagen, ganztägigen Terminen und Tagesmarken */}
          <div className="flex border-b border-slate-200">
            <div className="w-11 flex-shrink-0" />
            {tage.map((tag) => {
              const key = tagKey(tag)
              const ganz = eintraege.filter((e) => e.ganztags && e.von < plusTage(tag, 1) && e.bis > tag)
              const m = privat ? (marken.get(key) ?? []) : []
              return (
                <div key={key} className="min-w-0 flex-1 border-l border-slate-100 px-1 py-1.5">
                  <div className="text-center text-xs">
                    <span className="text-slate-400">{WOCHENTAGE[(tag.getDay() + 6) % 7]} </span>
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-semibold ${key === heuteKey ? 'bg-accent-600 text-white' : 'text-slate-700'}`}>{tag.getDate()}</span>
                  </div>
                  {ganz.map((e) => (
                    <button key={e.key} onClick={() => e.termin && setDetail(e.termin)} className="mt-0.5 block w-full truncate rounded px-1 py-px text-left text-[11px] text-white" style={{ background: e.privat ? '#94a3b8' : farbe(e.person) }}>
                      {e.privat ? `Privat · ${namen.get(e.person) ?? ''}` : e.termin?.titel}
                    </button>
                  ))}
                  {m.map((x) => (
                    <button key={x.key} onClick={() => x.pfad && navigate(x.pfad)} className="mt-0.5 block w-full truncate rounded bg-amber-50 px-1 py-px text-left text-[11px] text-amber-800" title={x.text}>
                      {x.art === 'todo' ? '☐ ' : '↻ '}
                      {x.text}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Stundenraster */}
          <div ref={rasterRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="relative flex" style={{ height: (LETZTE_STUNDE - ERSTE_STUNDE) * STUNDE_PX }}>
              <div className="w-11 flex-shrink-0">
                {Array.from({ length: LETZTE_STUNDE - ERSTE_STUNDE }, (_, i) => (
                  <div key={i} className="pr-1 text-right text-[10px] text-slate-400" style={{ height: STUNDE_PX }}>
                    {p2(ERSTE_STUNDE + i)}:00
                  </div>
                ))}
              </div>
              {tage.map((tag) => (
                <TagesSpalte
                  key={tagKey(tag)}
                  tag={tag}
                  eintraege={eintraege.filter((e) => !e.ganztags && e.von < plusTage(tag, 1) && e.bis > tag)}
                  farbe={farbe}
                  namen={namen}
                  ich={ich}
                  onNeu={(start) => setFormular(neuesFormular(start))}
                  onOeffnen={(t) => setDetail(t)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {formular && (
        <TerminFormular
          start={formular}
          ich={ich}
          kollegen={kollegen}
          belegt={belegt}
          termine={termine}
          onSchliessen={() => setFormular(null)}
          onGespeichert={() => { setFormular(null); lade() }}
        />
      )}

      {detail && (
        <TerminDetail
          termin={detail}
          ich={ich}
          namen={namen}
          onSchliessen={() => setDetail(null)}
          onBearbeiten={() => bearbeiten(detail)}
          onGeloescht={() => { setDetail(null); lade() }}
        />
      )}

      {einstellungenOffen && <EinstellungenFenster ich={ich} onSchliessen={() => setEinstellungenOffen(false)} onAbo={() => { setEinstellungenOffen(false); setAboOffen(true) }} />}
      {aboOffen && <KalenderAboFenster onSchliessen={() => setAboOffen(false)} />}
    </div>
  )
}

function TagesSpalte({
  tag,
  eintraege,
  farbe,
  namen,
  ich,
  onNeu,
  onOeffnen,
}: {
  tag: Date
  eintraege: Eintrag[]
  farbe: (email: string) => string
  namen: Map<string, string>
  ich: string
  onNeu: (start: Date) => void
  onOeffnen: (t: Termin) => void
}) {
  const tagBeginn = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), ERSTE_STUNDE).getTime()
  const tagEnde = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), LETZTE_STUNDE).getTime()
  // Überschneidende Einträge nebeneinander: jeder bekommt die erste freie Spur.
  const spuren: number[] = []
  const gelegt = eintraege.map((e) => {
    const v = Math.max(e.von.getTime(), tagBeginn)
    const b = Math.min(e.bis.getTime(), tagEnde)
    let spur = spuren.findIndex((endeDerSpur) => endeDerSpur <= v)
    if (spur === -1) spur = spuren.length
    spuren[spur] = b
    return { e, v, b, spur }
  })
  const breite = 100 / Math.max(1, spuren.length)

  return (
    <div className="relative min-w-0 flex-1 border-l border-slate-100">
      {Array.from({ length: LETZTE_STUNDE - ERSTE_STUNDE }, (_, i) => (
        <button
          key={i}
          onClick={() => onNeu(new Date(tag.getFullYear(), tag.getMonth(), tag.getDate(), ERSTE_STUNDE + i))}
          className="block w-full border-b border-slate-100 hover:bg-accent-50/40"
          style={{ height: STUNDE_PX }}
          aria-label={`Termin am ${tag.toLocaleDateString('de-DE')} um ${ERSTE_STUNDE + i} Uhr anlegen`}
        />
      ))}
      {gelegt
        .filter((g) => g.b > g.v)
        .map(({ e, v, b, spur }) => {
          const oben = ((v - tagBeginn) / 3600000) * STUNDE_PX
          const hoehe = Math.max(18, ((b - v) / 3600000) * STUNDE_PX - 2)
          const stil = { top: oben, height: hoehe, left: `calc(${spur * breite}% + 1px)`, width: `calc(${breite}% - 2px)` }
          if (e.privat || !e.termin) {
            return (
              <div key={e.key} className="absolute overflow-hidden rounded-md border border-slate-300 bg-slate-100 px-1 py-0.5 text-[11px] leading-tight text-slate-500" style={stil} title={`${namen.get(e.person) ?? 'Kollege'} ist in dieser Zeit belegt`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: farbe(e.person) }} />
                Privat
                <div className="truncate">{namen.get(e.person) ?? ''}</div>
              </div>
            )
          }
          const t = e.termin
          const gemeinsam = t.teilnehmer.length > 0
          return (
            <button key={e.key} onClick={() => onOeffnen(t)} className="absolute overflow-hidden rounded-md px-1 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm" style={{ ...stil, background: farbe(t.besitzerEmail) }}>
              <div className="truncate font-semibold">{t.titel}</div>
              <div className="truncate opacity-90">
                {uhr(e.von)}–{uhr(e.bis)}
                {gemeinsam && ` · ${[t.besitzerEmail, ...t.teilnehmer].map((p) => (p === ich ? 'ich' : (namen.get(p) ?? p).split(' ')[0])).join(', ')}`}
              </div>
            </button>
          )
        })}
    </div>
  )
}

function TerminFormular({
  start,
  ich,
  kollegen,
  belegt,
  termine,
  onSchliessen,
  onGespeichert,
}: {
  start: Formular
  ich: string
  kollegen: Kollege[]
  belegt: Belegt[]
  termine: Termin[]
  onSchliessen: () => void
  onGespeichert: () => void
}) {
  const { state } = useApp()
  const [f, setF] = useState<Formular>(start)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [ueberschneidung, setUeberschneidung] = useState('')
  const [kundenSuche, setKundenSuche] = useState('')

  const [jahr, monat, tagZahl] = f.datum.split('-').map(Number)
  const zeit = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return new Date(jahr, (monat || 1) - 1, tagZahl || 1, h || 0, m || 0)
  }
  const beginn = f.ganztags ? new Date(jahr, (monat || 1) - 1, tagZahl || 1) : zeit(f.von)
  const ende = f.ganztags ? new Date(jahr, (monat || 1) - 1, (tagZahl || 1) + 1) : zeit(f.bis)
  const gueltig = f.titel.trim() && !Number.isNaN(beginn.getTime()) && ende.getTime() > beginn.getTime()

  // Wer ist in der gewählten Zeit schon belegt? (aus den geladenen Daten — der Server prüft beim Speichern noch einmal verbindlich)
  const istBelegt = (email: string) =>
    belegt.some((b) => b.person === email && new Date(b.beginn) < ende && new Date(b.ende) > beginn && !termine.some((t) => t.id === f.id && new Date(t.beginn).getTime() === new Date(b.beginn).getTime()))

  const kundenTreffer = useMemo(() => {
    const s = kundenSuche.trim().toLowerCase()
    if (s.length < 2) return []
    const treffer: { id: string; bereich: KundeBereich; name: string }[] = []
    for (const b of KUNDEN_BEREICHE) {
      if (b.id === 'privat') continue
      for (const k of b.get(state)) {
        if (`${k.firma} ${k.ansprechpartner}`.toLowerCase().includes(s)) treffer.push({ id: k.id, bereich: b.id, name: k.firma })
        if (treffer.length >= 6) return treffer
      }
    }
    return treffer
  }, [kundenSuche, state])

  async function speichern(trotz = false) {
    setLaeuft(true)
    setFehler('')
    setUeberschneidung('')
    try {
      await speichereTerminRemote({
        id: f.id,
        titel: f.titel.trim(),
        beschreibung: f.beschreibung,
        ort: f.ort,
        beginn: beginn.toISOString(),
        ende: ende.toISOString(),
        ganztags: f.ganztags,
        teilnehmer: f.teilnehmer,
        kunde: f.kunde,
        trotzUeberschneidung: trotz,
      })
      onGespeichert()
    } catch (err) {
      if (err instanceof TerminUeberschneidung) setUeberschneidung(err.message)
      else setFehler(err instanceof Error ? err.message : 'Termin konnte nicht gespeichert werden.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Modal
      open
      onClose={onSchliessen}
      title={f.id ? 'Termin bearbeiten' : 'Neuer Termin'}
      width="max-w-lg"
      aktionen={
        <>
          <SecondaryButton onClick={onSchliessen} className="text-xs">Abbrechen</SecondaryButton>
          <PrimaryButton onClick={() => speichern(false)} disabled={laeuft || !gueltig} className="text-xs">
            <Check size={13} /> {laeuft ? 'Speichert …' : 'Speichern'}
          </PrimaryButton>
        </>
      }
    >
      <Field label="Titel">
        <input className={inputClass} value={f.titel} onChange={(e) => setF({ ...f, titel: e.target.value })} placeholder="z. B. Besprechung Finanzierung" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2">
          <Field label="Datum">
            <input type="date" className={inputClass} value={f.datum} onChange={(e) => setF({ ...f, datum: e.target.value })} />
          </Field>
        </div>
        {!f.ganztags && (
          <>
            <Field label="Von">
              <input type="time" className={inputClass} value={f.von} onChange={(e) => setF({ ...f, von: e.target.value })} />
            </Field>
            <Field label="Bis">
              <input type="time" className={inputClass} value={f.bis} onChange={(e) => setF({ ...f, bis: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={f.ganztags} onChange={(e) => setF({ ...f, ganztags: e.target.checked })} /> Ganztägig
      </label>

      {kollegen.length > 1 && (
        <Field label="Gemeinsam mit (bekommen den Termin in ihren Kalender und eine Telegram-Nachricht)">
          <div className="flex flex-wrap gap-1.5">
            {kollegen
              .filter((k) => k.email !== ich)
              .map((k) => {
                const dabei = f.teilnehmer.includes(k.email)
                const voll = istBelegt(k.email)
                return (
                  <button
                    key={k.email}
                    type="button"
                    onClick={() => setF({ ...f, teilnehmer: dabei ? f.teilnehmer.filter((t) => t !== k.email) : [...f.teilnehmer, k.email] })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${dabei ? 'border-accent-600 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {dabei && '✓ '}
                    {k.name}
                    {voll && <span className="ml-1 text-amber-600">· belegt</span>}
                  </button>
                )
              })}
          </div>
        </Field>
      )}

      <Field label="Ort (optional)">
        <input className={inputClass} value={f.ort} onChange={(e) => setF({ ...f, ort: e.target.value })} />
      </Field>
      <Field label="Kunde (optional)">
        {f.kunde ? (
          <div className="flex items-center gap-2 text-sm text-slate-700">
            {f.kunde.name} <span className="text-xs text-slate-400">({kundeBereichLabel(f.kunde.bereich as KundeBereich)})</span>
            <button type="button" onClick={() => setF({ ...f, kunde: null })} className="text-xs text-slate-400 hover:text-rose-600">entfernen</button>
          </div>
        ) : (
          <div>
            <input className={inputClass} value={kundenSuche} onChange={(e) => setKundenSuche(e.target.value)} placeholder="Name suchen …" />
            {kundenTreffer.length > 0 && (
              <ul className="mt-1 rounded-lg border border-slate-200">
                {kundenTreffer.map((k) => (
                  <li key={k.id}>
                    <button type="button" onClick={() => { setF({ ...f, kunde: k }); setKundenSuche('') }} className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                      {k.name} <span className="text-xs text-slate-400">({kundeBereichLabel(k.bereich)})</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
      <Field label="Notiz (optional)">
        <textarea className={inputClass} rows={3} value={f.beschreibung} onChange={(e) => setF({ ...f, beschreibung: e.target.value })} />
      </Field>

      {ueberschneidung && (
        <div className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {ueberschneidung}
          <div className="mt-2">
            <SecondaryButton onClick={() => speichern(true)} disabled={laeuft} className="text-xs">Trotzdem buchen</SecondaryButton>
          </div>
        </div>
      )}
      {fehler && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler}
        </div>
      )}
    </Modal>
  )
}

function TerminDetail({
  termin,
  ich,
  namen,
  onSchliessen,
  onBearbeiten,
  onGeloescht,
}: {
  termin: Termin
  ich: string
  namen: Map<string, string>
  onSchliessen: () => void
  onBearbeiten: () => void
  onGeloescht: () => void
}) {
  const navigate = useNavigate()
  const { state } = useApp()
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const meiner = termin.besitzerEmail === ich
  const aktenBereich = KUNDEN_BEREICHE.find((x) => x.id === termin.kundeBereich)
  const aktenPfad = termin.kundeId && aktenBereich?.get(state).some((k) => k.id === termin.kundeId) ? kundeDetailPfad(aktenBereich.id, termin.kundeId) : null
  const v = new Date(termin.beginn)
  const b = new Date(termin.ende)

  async function loeschen() {
    const frage = meiner
      ? termin.teilnehmer.length > 0
        ? 'Termin für alle absagen? Die Beteiligten bekommen eine Nachricht.'
        : 'Termin löschen?'
      : 'Für diesen Termin absagen? Er verschwindet aus deinem Kalender, die anderen behalten ihn.'
    if (!window.confirm(frage)) return
    setLaeuft(true)
    setFehler('')
    try {
      await loescheTerminRemote(termin.id)
      onGeloescht()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
      setLaeuft(false)
    }
  }

  return (
    <Modal open onClose={onSchliessen} title={termin.titel} width="max-w-md">
      <p className="text-sm text-slate-700">
        {termin.ganztags ? `${datumLang(v)}, ganztägig` : `${datumLang(v)}, ${uhr(v)}–${uhr(b)} Uhr`}
      </p>
      {termin.ort && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600">
          <MapPin size={14} className="text-slate-400" /> {termin.ort}
        </p>
      )}
      <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-600">
        <Users size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
        {[termin.besitzerEmail, ...termin.teilnehmer].map((p) => (p === ich ? 'ich' : (namen.get(p) ?? p))).join(', ')}
        {termin.teilnehmer.length === 0 && ' (nur für mich)'}
      </p>
      {/* Die Akte kann für diesen Teilnehmer unsichtbar sein (anderer Bereich ohne Freigabe) — dann
          nur den Namen zeigen statt eines Links, der ins Leere führt. */}
      {termin.kundeId && aktenPfad && (
        <button onClick={() => navigate(aktenPfad)} className="mt-2 text-sm text-accent-600 hover:underline">
          Zur Akte: {termin.kundeName}
        </button>
      )}
      {termin.kundeId && !aktenPfad && termin.kundeName && <p className="mt-2 text-sm text-slate-500">Kunde: {termin.kundeName}</p>}
      {termin.beschreibung && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{termin.beschreibung}</p>}
      {fehler && <p className="mt-3 text-xs text-rose-600">{fehler}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <SecondaryButton onClick={loeschen} disabled={laeuft} className="text-xs">
          <Trash2 size={13} /> {meiner ? (termin.teilnehmer.length > 0 ? 'Für alle absagen' : 'Löschen') : 'Absagen'}
        </SecondaryButton>
        {meiner && <PrimaryButton onClick={onBearbeiten} className="text-xs">Bearbeiten</PrimaryButton>}
      </div>
    </Modal>
  )
}

function EinstellungenFenster({ ich, onSchliessen, onAbo }: { ich: string; onSchliessen: () => void; onAbo: () => void }) {
  const { session } = useAuth()
  const [e, setE] = useState<KalenderEinstellungen | null>(null)
  const [telegram, setTelegram] = useState<boolean | null>(null)
  const [gespeichert, setGespeichert] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    ladeEinstellungen(ich).then(setE).catch(() => setE({ erinnerungen: [60], sichtbar: true }))
    telegramVerbunden(session?.user.email ?? ich).then(setTelegram).catch(() => setTelegram(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ich])

  async function speichern(neu: KalenderEinstellungen) {
    setE(neu)
    setGespeichert(false)
    setFehler('')
    try {
      await speichereEinstellungen(ich, neu)
      setGespeichert(true)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
    }
  }

  return (
    <Modal open onClose={onSchliessen} title="Kalender-Einstellungen" width="max-w-md">
      {!e ? (
        <p className="text-sm text-slate-400">Wird geladen …</p>
      ) : (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Erinnerung per Telegram</p>
          <div className="space-y-1.5">
            {ERINNERUNGS_WAHL.map((w) => (
              <label key={w.minuten} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={e.erinnerungen.includes(w.minuten)}
                  onChange={(ev) => speichern({ ...e, erinnerungen: ev.target.checked ? [...e.erinnerungen, w.minuten] : e.erinnerungen.filter((m) => m !== w.minuten) })}
                />
                {w.label}
              </label>
            ))}
          </div>
          {telegram === false && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Telegram ist bei dir noch nicht verbunden — Erinnerungen und Termin-Nachrichten kommen erst an, wenn du es unter „Mein Profil“ verknüpft hast.
            </p>
          )}
          <p className="mb-2 mt-5 text-sm font-medium text-slate-700">Sichtbarkeit</p>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={e.sichtbar} onChange={(ev) => speichern({ ...e, sichtbar: ev.target.checked })} />
            <span>
              Kollegen sehen, wann ich belegt bin
              <span className="block text-xs text-slate-500">Sie sehen nur „Privat“ und die Uhrzeit — nie, worum es geht. Gemeinsam gebuchte Termine sehen alle Beteiligten vollständig.</span>
            </span>
          </label>
          <p className="mb-2 mt-5 text-sm font-medium text-slate-700">Termine auf dem Handy und in Outlook</p>
          <button onClick={onAbo} className="flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:underline">
            <CalendarPlus size={14} /> In meinen Kalender übernehmen …
          </button>
          {gespeichert && <p className="mt-3 text-xs text-emerald-600">Gespeichert.</p>}
          {fehler && <p className="mt-3 text-xs text-rose-600">{fehler}</p>}
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <PrimaryButton onClick={onSchliessen}>Fertig</PrimaryButton>
      </div>
    </Modal>
  )
}

// Persönliches Kalender-Abo: Die Kalender-App (iPhone, Outlook, Mac, Google) holt die eigenen
// CRM-Termine regelmäßig über eine geheime Adresse ab. Nur eine Richtung: CRM → Kalender-App.
function KalenderAboFenster({ onSchliessen }: { onSchliessen: () => void }) {
  const [abo, setAbo] = useState<KalenderAbo | null>(null)
  const [laeuft, setLaeuft] = useState(true)
  const [fehler, setFehler] = useState('')
  const [kopiert, setKopiert] = useState(false)
  const [erneuert, setErneuert] = useState(false)
  const feldRef = useRef<HTMLInputElement>(null)

  async function laden(neu: boolean) {
    setLaeuft(true)
    setFehler('')
    setKopiert(false)
    try {
      setAbo(await holeKalenderAbo(neu))
      if (neu) setErneuert(true)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Der Link konnte nicht geladen werden.')
    } finally {
      setLaeuft(false)
    }
  }

  useEffect(() => {
    laden(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function kopieren() {
    if (!abo) return
    try {
      await navigator.clipboard.writeText(abo.https)
      setKopiert(true)
    } catch {
      // Ohne Zugriff auf die Zwischenablage: Text markieren, damit man ihn selbst kopieren kann.
      feldRef.current?.select()
      setFehler('Kopieren ging nicht automatisch — der Link ist markiert, bitte selbst kopieren.')
    }
  }

  function erneuern() {
    if (!window.confirm('Neuen Link erzeugen? Der alte Link funktioniert dann sofort nicht mehr. Wo er schon eingerichtet ist (Handy, Outlook …), musst du den Kalender mit dem neuen Link noch einmal hinzufügen.')) return
    laden(true)
  }

  return (
    <Modal open onClose={onSchliessen} title="In meinen Kalender übernehmen" width="max-w-lg">
      <p className="text-sm text-slate-600">
        Deine CRM-Termine (eigene und gemeinsam gebuchte) erscheinen automatisch in dem Kalender, den du sowieso benutzt — auf dem iPhone, in Outlook, am Mac oder bei Google. Einmal einrichten, danach kommt alles von selbst.
      </p>

      {fehler && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler}
        </div>
      )}

      {laeuft && !abo && <p className="mt-4 text-sm text-slate-400">Link wird geladen …</p>}

      {abo && (
        <>
          <p className="mb-1.5 mt-4 text-sm font-medium text-slate-700">Dein persönlicher Link</p>
          <input ref={feldRef} readOnly value={abo.https} onFocus={(ev) => ev.target.select()} className={`${inputClass} font-mono text-xs`} aria-label="Dein persönlicher Kalender-Link" />
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={abo.webcal} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700">
              <CalendarPlus size={14} /> In Kalender-App öffnen
            </a>
            <SecondaryButton onClick={kopieren} className="text-sm">
              <Copy size={14} /> {kopiert ? 'Kopiert' : 'Link kopieren'}
            </SecondaryButton>
          </div>
          {erneuert && <p className="mt-2 text-xs text-emerald-600">Neuer Link erzeugt — der alte funktioniert nicht mehr.</p>}
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            Der Link ist geheim: Wer ihn hat, sieht deine Termine. Nicht weitergeben und nicht in Mails an Kunden schreiben.
          </p>

          <p className="mb-1.5 mt-5 text-sm font-medium text-slate-700">iPhone (Kalender von Apple)</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Das CRM auf dem iPhone öffnen und oben auf „In Kalender-App öffnen“ tippen.</li>
            <li>Auf „Abonnieren“ tippen, danach oben rechts auf „Hinzufügen“. Falls nach dem Account gefragt wird: „Auf meinem iPhone“ wählen.</li>
            <li>
              Damit Änderungen schnell ankommen: Einstellungen → Apps → Kalender → Kalender-Accounts → Datenabgleich → unten bei „Abrufen“ „Alle 15 Minuten“ wählen. (Bei älteren iPhones: Einstellungen → Kalender → Accounts → Datenabgleich.)
            </li>
          </ol>
          <p className="mt-1.5 text-xs text-slate-500">
            Ohne Antippen geht es auch so: Link kopieren, dann in der Kalender-App unten auf „Kalender“ → „Kalender hinzufügen“ → „Kalenderabonnement hinzufügen“ und den Link einfügen. Auf manchen iPhones heißt der Weg: Einstellungen → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.
          </p>

          <p className="mb-1.5 mt-4 text-sm font-medium text-slate-700">Andere Kalender</p>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li><span className="font-medium text-slate-700">Outlook (Windows und im Browser):</span> Link kopieren → Kalender hinzufügen → Aus dem Internet abonnieren → Link einfügen.</li>
            <li><span className="font-medium text-slate-700">Mac:</span> Kalender → Ablage → Neues Kalenderabonnement → Link einfügen, bei „Automatisch aktualisieren“ „Alle 15 Minuten“ wählen.</li>
            <li><span className="font-medium text-slate-700">Google Kalender und Android:</span> am Computer auf calendar.google.com → Weitere Kalender (+) → Per URL → Link einfügen. Danach erscheint er auch auf dem Android-Handy.</li>
          </ul>

          <p className="mb-1.5 mt-4 text-sm font-medium text-slate-700">Gut zu wissen</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            <li>Die Kalender-App holt neue Termine nach ihrem eigenen Takt: das iPhone und der Mac auf Wunsch alle 15 Minuten, Outlook und Google teils erst nach mehreren Stunden.</li>
            <li>Es geht nur in eine Richtung: Termine im CRM anlegen oder ändern. Was du in der Kalender-App änderst, kommt nicht ins CRM zurück.</li>
            <li>Übertragen werden Termine der letzten 60 Tage und der nächsten 18 Monate.</li>
          </ul>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <SecondaryButton onClick={erneuern} disabled={laeuft} className="text-xs">
              {laeuft ? 'Wird erzeugt …' : 'Neuen Link erzeugen (alter wird ungültig)'}
            </SecondaryButton>
            <p className="mt-1.5 text-xs text-slate-500">Zum Beispiel, wenn der Link versehentlich weitergegeben wurde.</p>
          </div>
        </>
      )}

      <div className="mt-5 flex justify-end">
        <PrimaryButton onClick={onSchliessen}>Fertig</PrimaryButton>
      </div>
    </Modal>
  )
}
