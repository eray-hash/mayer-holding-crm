// Datensicherung (Runde 5, 22.11.2026), Karte für die Superuser-Seite.
// Zeigt die letzte Sicherung (Zeit, Größe, Zeilen je Tabelle), startet eine Sicherung von Hand und gibt einen
// Download-Link (10 Minuten gültig) für die neueste Sicherung. Telegram-Hinweis bei Fehlschlag in der Nacht für die
// eigene Person an/aus. Alles über die Aktion `datensicherung` (nur Geschäftsführung und Superuser, Server prüft).
// Server: supabase/functions/email-gateway/datensicherung.ts; Einspielen: scripts/sicherung-wiederherstellen.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Download, HardDriveDownload, Play } from 'lucide-react'
import { callAuthenticated } from '../lib/emailGateway'
import { SecondaryButton } from './ui'

type Zusammenfassung = { name: string; zeit: string; art: string; bytes: number; dauerMs: number; tabellen: number; zeilen: number; dateien: number; dateienBytes: number }
type Neueste = {
  name: string
  erstellt: string
  art: string
  dauerMs: number
  paketBytes: number
  gesamtZeilen: number
  tabellen: { tabelle: string; zeilen: number; bytes: number }[]
  ausgelassen: { tabelle: string; grund: string }[]
  dateien: { anzahl: number; bytes: number }
  warnungen: string[]
}
type Antwort = {
  laeuft: { seit: string; art: string | null } | null
  letzte: Zusammenfassung | null
  letzterFehler: { zeit: string; text: string; art: string } | null
  meldungAn: boolean
  sicherungen: { name: string; bytes: number }[]
  gesamtBytes: number
  neueste: Neueste | null
}

const DATUM_ZEIT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function zeitText(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${DATUM_ZEIT.format(d)} Uhr`
}

function groesse(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} Byte`
  const einheiten = ['KB', 'MB', 'GB', 'TB']
  let w = bytes / 1024
  let i = 0
  while (w >= 1024 && i < einheiten.length - 1) {
    w /= 1024
    i++
  }
  return `${w.toFixed(w < 10 ? 1 : 0).replace('.', ',')} ${einheiten[i]}`
}

function zahl(n: number): string {
  return n.toLocaleString('de-DE')
}

function sekunden(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} Sek.` : `${Math.floor(s / 60)} Min. ${s % 60} Sek.`
}

/** „2026-11-23_0230“ → „23.11.2026, 02:30 Uhr“. */
function nameText(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/.exec(name)
  return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]} Uhr` : name
}

const ART: Record<string, string> = { nacht: 'nachts', hand: 'von Hand', probe: 'Probelauf' }

export function SicherungKarte() {
  const [d, setD] = useState<Antwort | null>(null)
  const [offen, setOffen] = useState(false)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState<'' | 'jetzt' | 'laden' | 'meldung'>('')
  const [alleTabellen, setAlleTabellen] = useState(false)
  // Zeitpunkt des letzten Ladens (für „älter als einen Tag“), nicht bei jedem Zeichnen neu gemessen.
  const [geladenAm, setGeladenAm] = useState(0)
  const abfrage = useRef<number | null>(null)

  const lade = useCallback(async () => {
    try {
      const x = (await callAuthenticated({ action: 'datensicherung', aufgabe: 'stand' })) as Antwort
      setD(x)
      setGeladenAm(Date.now())
      setFehler('')
      return x
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Stand ließ sich nicht laden.')
      return null
    }
  }, [])

  useEffect(() => {
    void lade()
    return () => {
      if (abfrage.current) window.clearTimeout(abfrage.current)
    }
  }, [lade])

  // Solange eine Sicherung läuft, alle 5 Sekunden nachsehen.
  useEffect(() => {
    if (!d?.laeuft) return
    abfrage.current = window.setTimeout(() => void lade(), 5000)
    return () => {
      if (abfrage.current) window.clearTimeout(abfrage.current)
    }
  }, [d, lade])

  async function jetztSichern() {
    setFehler('')
    setHinweis('')
    setBeschaeftigt('jetzt')
    try {
      await callAuthenticated({ action: 'datensicherung', aufgabe: 'jetzt' })
      setHinweis('Sicherung läuft — dauert meist unter einer Minute.')
      await lade()
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    } finally {
      setBeschaeftigt('')
    }
  }

  async function herunterladen(name?: string) {
    setFehler('')
    setHinweis('')
    setBeschaeftigt('laden')
    try {
      const r = await callAuthenticated({ action: 'datensicherung', aufgabe: 'herunterladen', ...(name ? { name } : {}) })
      if (r?.url) window.location.href = String(r.url)
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    } finally {
      setBeschaeftigt('')
    }
  }

  async function meldung(an: boolean) {
    setFehler('')
    setBeschaeftigt('meldung')
    try {
      setD((await callAuthenticated({ action: 'datensicherung', aufgabe: 'meldung', an })) as Antwort)
    } catch (x) {
      setFehler(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    } finally {
      setBeschaeftigt('')
    }
  }

  if (!d) return fehler ? <p className="text-xs text-rose-600">Datensicherung: {fehler}</p> : null

  const letzte = d.letzte
  const alterStunden = letzte ? (geladenAm - new Date(letzte.zeit).getTime()) / 3600_000 : Infinity
  // Fehler nur zeigen, wenn er neuer ist als die letzte gelungene Sicherung.
  const fehlerAktuell = d.letzterFehler && (!letzte || new Date(d.letzterFehler.zeit).getTime() > new Date(letzte.zeit).getTime()) ? d.letzterFehler : null
  const veraltet = alterStunden > 30
  const kurz = d.laeuft
    ? `läuft seit ${zeitText(d.laeuft.seit)}`
    : letzte
      ? `zuletzt ${zeitText(letzte.zeit)}, ${groesse(letzte.bytes)}`
      : 'noch keine Sicherung'
  const farbe = d.laeuft ? 'text-slate-600' : fehlerAktuell || veraltet ? 'font-medium text-rose-700' : 'font-medium text-emerald-700'
  const tabellen = d.neueste ? [...d.neueste.tabellen].sort((a, b) => b.zeilen - a.zeilen) : []

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm">
      <button onClick={() => setOffen((x) => !x)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {offen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
        <HardDriveDownload size={15} className="text-slate-400" />
        <span className="font-medium text-slate-700">Datensicherung:</span>
        <span className={farbe}>
          {kurz}
          {!d.laeuft && fehlerAktuell ? ' — letzter Versuch fehlgeschlagen' : ''}
          {!d.laeuft && !fehlerAktuell && letzte && veraltet ? ' — älter als einen Tag' : ''}
        </span>
      </button>
      {offen && (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          <p className="text-xs text-slate-500">
            Jede Nacht ab 2:30 Uhr eine eigene Sicherung aller CRM-Daten (alle Tabellen, unabhängig von den Sicherungen des Anbieters), gepackt in einem privaten Speicherfach, das nur der Server lesen kann.
            Aufbewahrt werden die letzten 14 Tage, dazu je eine Sicherung der letzten 8 Wochen und 12 Monate. Die Dateien selbst (Dokumente, Anhänge, Fotos) sind zu groß und nicht enthalten — nur ihre Liste.
            Zurückholen einer Akte oder Tabelle: mit dem Programm scripts/sicherung-wiederherstellen.ts (zuerst immer als Probelauf).
          </p>

          {fehlerAktuell && (
            <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              Fehlgeschlagen am {zeitText(fehlerAktuell.zeit)} ({ART[fehlerAktuell.art] ?? fehlerAktuell.art}): {fehlerAktuell.text}
            </div>
          )}

          {letzte && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-400">Letzte Sicherung</dt>
                <dd className="text-slate-700">{zeitText(letzte.zeit)} ({ART[letzte.art] ?? letzte.art})</dd>
              </div>
              <div>
                <dt className="text-slate-400">Größe / Dauer</dt>
                <dd className="text-slate-700">{groesse(letzte.bytes)} in {sekunden(letzte.dauerMs)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Inhalt</dt>
                <dd className="text-slate-700">{zahl(letzte.zeilen)} Zeilen aus {letzte.tabellen} Tabellen</dd>
              </div>
              <div>
                <dt className="text-slate-400">Ablage (nicht enthalten)</dt>
                <dd className="text-slate-700">{zahl(letzte.dateien)} Dateien, {groesse(letzte.dateienBytes)}</dd>
              </div>
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => void jetztSichern()} disabled={!!beschaeftigt || !!d.laeuft}>
              <Play size={14} /> {d.laeuft || beschaeftigt === 'jetzt' ? 'Sicherung läuft …' : 'Jetzt sichern'}
            </SecondaryButton>
            <SecondaryButton onClick={() => void herunterladen()} disabled={!!beschaeftigt || d.sicherungen.length === 0}>
              <Download size={14} /> {beschaeftigt === 'laden' ? 'Link wird erstellt …' : 'Neueste herunterladen'}
            </SecondaryButton>
            <label className="ml-1 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={d.meldungAn} disabled={!!beschaeftigt} onChange={(x) => void meldung(x.target.checked)} />
              Telegram an mich, wenn die Nachtsicherung scheitert
            </label>
          </div>
          {hinweis && <p className="text-xs text-emerald-700">{hinweis}</p>}
          {fehler && <p className="text-xs text-rose-600">{fehler}</p>}
          <p className="text-[11px] text-slate-400">
            Die heruntergeladene Datei enthält alle Kundendaten — nur auf verschlüsselten Geräten ablegen und nicht weitergeben. Jeder Download wird mit Name und Zeit vermerkt.
          </p>

          {d.neueste && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">
                Zeilen je Tabelle in der neuesten Sicherung ({nameText(d.neueste.name)})
              </p>
              <div className="grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {(alleTabellen ? tabellen : tabellen.slice(0, 12)).map((t) => (
                  <div key={t.tabelle} className="flex justify-between border-b border-slate-50 py-0.5">
                    <span className="truncate text-slate-600">{t.tabelle}</span>
                    <span className="ml-2 shrink-0 tabular-nums text-slate-700">{zahl(t.zeilen)}</span>
                  </div>
                ))}
              </div>
              {tabellen.length > 12 && (
                <button onClick={() => setAlleTabellen((x) => !x)} className="mt-1 text-xs text-accent-700 hover:underline">
                  {alleTabellen ? 'weniger zeigen' : `alle ${tabellen.length} Tabellen zeigen`}
                </button>
              )}
              {d.neueste.ausgelassen.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-400">Bewusst nicht gesichert: {d.neueste.ausgelassen.map((a) => a.tabelle).join(', ')} (kurzlebig).</p>
              )}
              {d.neueste.warnungen.map((w) => (
                <p key={w} className="mt-1 text-[11px] text-amber-700">{w}</p>
              ))}
            </div>
          )}

          {d.sicherungen.length > 1 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500">
                {d.sicherungen.length} Sicherungen aufbewahrt, zusammen {groesse(d.gesamtBytes)}
              </summary>
              <ul className="mt-1 divide-y divide-slate-50">
                {d.sicherungen.map((s) => (
                  <li key={s.name} className="flex items-center justify-between py-0.5">
                    <span className="text-slate-600">{nameText(s.name)}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-slate-500">{groesse(s.bytes)}</span>
                      <button onClick={() => void herunterladen(s.name)} disabled={!!beschaeftigt} className="text-accent-700 hover:underline disabled:opacity-50">
                        herunterladen
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
