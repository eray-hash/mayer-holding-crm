import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { Card, EmptyState, SecondaryButton, inputClass } from '../../components/ui'
import { ladeSuperuserAuswertung, type SuperuserTeil } from '../../lib/emailGateway'
import { useIstSuperuser } from './useIstSuperuser'

// Superuser-Bereich (nur Mitarbeiter mit mitarbeiter.ist_superuser — der Server prüft das ebenfalls).
// Zeigt Tatsachen zur Nutzung, den Verlauf über alle Akten, Geschäftszahlen und Technik & Kosten.
// Bewusst ohne Noten, Ranglisten oder Sortierung nach „gut/schlecht“: Personen stehen nach Namen.
// Daten: supabase/functions/email-gateway/superuser.ts (Aktion superuser_auswertung).

type Zeitraum = 7 | 30 | 90

const TEILE: { id: SuperuserTeil; label: string }[] = [
  { id: 'nutzung', label: 'Nutzung' },
  { id: 'verlauf', label: 'Verlauf' },
  { id: 'zahlen', label: 'Zahlen' },
  { id: 'technik', label: 'Technik & Kosten' },
]

const DATUM_ZEIT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
function datumZeit(iso?: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : DATUM_ZEIT.format(d)
}
function tagText(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}
function minuten(n: number): string {
  if (n < 60) return `${n} Min.`
  const h = Math.floor(n / 60)
  const m = n % 60
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`
}
function euro(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function Balken({ wert, max, farbe = 'bg-accent-500' }: { wert: number; max: number; farbe?: string }) {
  const breite = max > 0 ? Math.max(wert > 0 ? 3 : 0, Math.round((wert / max) * 100)) : 0
  return (
    <div className="h-2 w-full rounded bg-slate-100">
      <div className={`h-2 rounded ${farbe}`} style={{ width: `${breite}%` }} />
    </div>
  )
}

function Hinweise({ liste }: { liste?: string[] }) {
  if (!liste?.length) return null
  return (
    <ul className="mt-3 space-y-1 text-xs text-slate-500">
      {liste.map((h) => (
        <li key={h}>• {h}</li>
      ))}
    </ul>
  )
}

function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{titel}</h2>
      {children}
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------

type NutzungZeile = {
  name: string
  letzteAnmeldung: string | null
  aktiveTage: number
  aktiveMinuten: number
  minutenJeTag: Record<string, number>
  stunden: number[]
  verlaufseintraege: number
  dokumenteAbgelegt: number
  mailsGesendet: number
  termineAngelegt: number
  todosErledigt: number
  assistentZuege: number
  sprachnachrichten: number
}

function NutzungAnsicht({ daten }: { daten: { zeilen: NutzungZeile[]; hinweise: string[] } }) {
  const zeilen = [...daten.zeilen].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const maxStunde = Math.max(1, ...zeilen.flatMap((z) => z.stunden))
  return (
    <div className="space-y-4">
      <Abschnitt titel="Nutzung je Mitarbeiter">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Mitarbeiter</th>
                <th className="py-2 pr-3 font-medium">Letzte Anmeldung</th>
                <th className="py-2 pr-3 text-right font-medium">Aktive Tage</th>
                <th className="py-2 pr-3 text-right font-medium">Zeit im CRM</th>
                <th className="py-2 pr-3 text-right font-medium">Einträge</th>
                <th className="py-2 pr-3 text-right font-medium">Dokumente</th>
                <th className="py-2 pr-3 text-right font-medium">Mails</th>
                <th className="py-2 pr-3 text-right font-medium">Termine</th>
                <th className="py-2 pr-3 text-right font-medium">Aufgaben erledigt</th>
                <th className="py-2 pr-3 text-right font-medium">Assistent</th>
                <th className="py-2 text-right font-medium">Sprachnachrichten</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => (
                <tr key={z.name} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-medium text-slate-800">{z.name}</td>
                  <td className="py-2 pr-3 text-slate-600">{datumZeit(z.letzteAnmeldung)}</td>
                  <td className="py-2 pr-3 text-right">{z.aktiveTage}</td>
                  <td className="py-2 pr-3 text-right">{minuten(z.aktiveMinuten)}</td>
                  <td className="py-2 pr-3 text-right">{z.verlaufseintraege}</td>
                  <td className="py-2 pr-3 text-right">{z.dokumenteAbgelegt}</td>
                  <td className="py-2 pr-3 text-right">{z.mailsGesendet}</td>
                  <td className="py-2 pr-3 text-right">{z.termineAngelegt}</td>
                  <td className="py-2 pr-3 text-right">{z.todosErledigt}</td>
                  <td className="py-2 pr-3 text-right">{z.assistentZuege}</td>
                  <td className="py-2 text-right">{z.sprachnachrichten}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Hinweise liste={daten.hinweise} />
      </Abschnitt>

      <Abschnitt titel="Zeit im CRM je Tag und Uhrzeit">
        <div className="grid gap-4 md:grid-cols-2">
          {zeilen.map((z) => {
            const tage = Object.entries(z.minutenJeTag).sort(([a], [b]) => a.localeCompare(b))
            const maxTag = Math.max(1, ...tage.map(([, n]) => n))
            return (
              <div key={z.name} className="rounded-lg border border-slate-100 p-3">
                <div className="mb-2 text-sm font-medium text-slate-800">{z.name}</div>
                {tage.length === 0 ? (
                  <p className="text-xs text-slate-400">Noch keine gemessenen Minuten im Zeitraum.</p>
                ) : (
                  <div className="space-y-1">
                    {tage.map(([d, n]) => (
                      <div key={d} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 text-slate-500">{tagText(d)}</span>
                        <Balken wert={n} max={maxTag} />
                        <span className="w-20 shrink-0 text-right text-slate-600">{minuten(n)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex h-10 items-end gap-px" title="Minuten je Uhrzeit (0–23 Uhr)">
                  {z.stunden.map((n, h) => (
                    <div key={h} className="flex-1 rounded-t bg-accent-400" style={{ height: `${Math.round((n / maxStunde) * 100)}%`, minHeight: n > 0 ? 2 : 0 }} title={`${h} Uhr: ${n} Min.`} />
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>0 Uhr</span>
                  <span>12 Uhr</span>
                  <span>23 Uhr</span>
                </div>
              </div>
            )
          })}
        </div>
      </Abschnitt>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

type VerlaufEintrag = { datum: string; zeit?: string; wer: string | null; werText: string; bereich: string; akte: string; pfad: string; text: string; art: 'verlauf' | 'mail' | 'termin' }
const ART_TEXT: Record<VerlaufEintrag['art'], string> = { verlauf: 'Eintrag', mail: 'Mail', termin: 'Termin' }

function VerlaufAnsicht({
  daten,
  personen,
  person,
  setPerson,
  bereich,
  setBereich,
}: {
  daten: { eintraege: VerlaufEintrag[]; gesamt: number; bereiche: string[] }
  personen: string[]
  person: string
  setPerson: (p: string) => void
  bereich: string
  setBereich: (b: string) => void
}) {
  return (
    <Abschnitt titel="Verlauf über alle Akten">
      <div className="mb-3 flex flex-wrap gap-2">
        <select className={`${inputClass} w-auto`} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Alle Personen</option>
          {personen.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className={`${inputClass} w-auto`} value={bereich} onChange={(e) => setBereich(e.target.value)}>
          <option value="">Alle Bereiche</option>
          {daten.bereiche.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-slate-500">
          {daten.gesamt} Einträge{daten.gesamt > daten.eintraege.length ? `, die neuesten ${daten.eintraege.length} angezeigt` : ''}
        </span>
      </div>
      {daten.eintraege.length === 0 ? (
        <EmptyState text="Keine Einträge für diese Auswahl." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {daten.eintraege.map((e, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:gap-3">
              <span className="w-32 shrink-0 text-xs text-slate-500">{e.zeit ? datumZeit(e.zeit) : tagText(e.datum)}</span>
              <span className="w-40 shrink-0 text-xs font-medium text-slate-700">{e.wer ?? e.werText}</span>
              <span className="min-w-0 flex-1">
                <span className="mr-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">{ART_TEXT[e.art]}</span>
                {e.akte && (
                  <Link to={e.pfad} className="mr-2 font-medium text-accent-700 hover:underline">
                    {e.akte}
                  </Link>
                )}
                {e.bereich && <span className="mr-2 text-xs text-slate-400">{e.bereich}</span>}
                <span className="text-slate-700">{e.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Abschnitt>
  )
}

// ---------------------------------------------------------------------------------------------

type Anfragen = { erkannt: number; uebernommen: number; verworfen: number; nichtRelevant: number; relevanteMails: number }
type ZahlenDaten = {
  wochen: string[]
  neueAkten: Record<string, Record<string, number>>
  anfragen: Record<string, Anfragen>
  quellen: Record<string, number>
  anfragenJePostfach: Record<string, number>
  antwortzeit: { medianStunden: number | null; beantwortet: number; ohneAntwort: number }
  ueberfaellig: Record<string, { followups: number; todos: number }>
  objekteNachStatus: Record<string, number>
  hinweise: string[]
}

const OBJEKT_STATUS_TEXT: Record<string, string> = { akquise: 'Akquise', on_hold: 'Pausiert', archiv: 'Archiv', abgebrochen: 'Abgebrochen', verkauft: 'Verkauft', vermarktung: 'Vermarktung', reserviert: 'Reserviert' }

function ZahlenAnsicht({ daten }: { daten: ZahlenDaten }) {
  const bereiche = [...new Set(Object.values(daten.neueAkten).flatMap((w) => Object.keys(w)))].sort((a, b) => a.localeCompare(b, 'de'))
  const antwort = daten.antwortzeit.medianStunden
  return (
    <div className="space-y-4">
      <Abschnitt titel="Neue Akten je Woche und Bereich">
        {bereiche.length === 0 ? (
          <EmptyState text="Keine neuen Akten im Zeitraum." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-3 font-medium">Woche ab</th>
                  {bereiche.map((b) => (
                    <th key={b} className="py-2 pr-3 text-right font-medium">
                      {b}
                    </th>
                  ))}
                  <th className="py-2 text-right font-medium">Zusammen</th>
                </tr>
              </thead>
              <tbody>
                {daten.wochen.map((w) => {
                  const zeile = daten.neueAkten[w] ?? {}
                  return (
                    <tr key={w} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 text-slate-600">{tagText(w)}</td>
                      {bereiche.map((b) => (
                        <td key={b} className="py-2 pr-3 text-right">
                          {zeile[b] ?? 0}
                        </td>
                      ))}
                      <td className="py-2 text-right font-medium">{Object.values(zeile).reduce((s, n) => s + n, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Abschnitt>

      <Abschnitt titel="Anfragen je Woche">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium">Woche ab</th>
                <th className="py-2 pr-3 text-right font-medium">Neue Absender geprüft</th>
                <th className="py-2 pr-3 text-right font-medium">Als Akte übernommen</th>
                <th className="py-2 pr-3 text-right font-medium">Verworfen</th>
                <th className="py-2 pr-3 text-right font-medium">Nicht relevant</th>
                <th className="py-2 text-right font-medium">Relevante Mails</th>
              </tr>
            </thead>
            <tbody>
              {daten.wochen.map((w) => {
                const a = daten.anfragen[w] ?? { erkannt: 0, uebernommen: 0, verworfen: 0, nichtRelevant: 0, relevanteMails: 0 }
                return (
                  <tr key={w} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 text-slate-600">{tagText(w)}</td>
                    <td className="py-2 pr-3 text-right">{a.erkannt}</td>
                    <td className="py-2 pr-3 text-right">{a.uebernommen}</td>
                    <td className="py-2 pr-3 text-right">{a.verworfen}</td>
                    <td className="py-2 pr-3 text-right">{a.nichtRelevant}</td>
                    <td className="py-2 text-right">{a.relevanteMails}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
          <span>Woher: {Object.entries(daten.quellen).map(([q, n]) => `${q === 'email-analyse' ? 'aus Mails erkannt' : q} ${n}`).join(', ') || '–'}</span>
          <span>Relevante Mails je Postfach: {Object.entries(daten.anfragenJePostfach).map(([p, n]) => `${p === 'standard' ? 'info@amayer-holding.com' : p} ${n}`).join(', ') || '–'}</span>
        </div>
      </Abschnitt>

      <div className="grid gap-4 md:grid-cols-3">
        <Abschnitt titel="Antwortzeit auf erste Mails">
          <div className="text-2xl font-semibold text-slate-800">{antwort == null ? '–' : antwort < 24 ? `${Math.round(antwort)} Std.` : `${(antwort / 24).toFixed(1).replace('.', ',')} Tage`}</div>
          <p className="mt-1 text-xs text-slate-500">
            Mittlerer Wert · {daten.antwortzeit.beantwortet} beantwortet, {daten.antwortzeit.ohneAntwort} ohne Antwort aus dem CRM
          </p>
        </Abschnitt>
        <Abschnitt titel="Überfällige Wiedervorlagen und Aufgaben">
          {Object.keys(daten.ueberfaellig).length === 0 ? (
            <p className="text-sm text-slate-500">Nichts überfällig.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(daten.ueberfaellig)
                .sort(([a], [b]) => a.localeCompare(b, 'de'))
                .map(([p, n]) => (
                  <li key={p} className="flex justify-between gap-2">
                    <span className="text-slate-700">{p}</span>
                    <span className="text-slate-600">
                      {n.followups} Wiedervorlagen, {n.todos} Aufgaben
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Abschnitt>
        <Abschnitt titel="Objekte nach Status">
          <ul className="space-y-1 text-sm">
            {Object.entries(daten.objekteNachStatus)
              .sort(([a], [b]) => a.localeCompare(b, 'de'))
              .map(([s, n]) => (
                <li key={s} className="flex justify-between gap-2">
                  <span className="text-slate-700">{OBJEKT_STATUS_TEXT[s] ?? s}</span>
                  <span className="text-slate-600">{n}</span>
                </li>
              ))}
          </ul>
        </Abschnitt>
      </div>
      <Hinweise liste={daten.hinweise} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

type TechnikDaten = {
  kosten: { summeEuro: number; aufrufe: number; jeTag: Record<string, number>; jeAnlass: Record<string, number>; jeModell: Record<string, number>; jePerson?: Record<string, number>; privatJePerson?: Record<string, number>; umrechnung: string }
  fehler: { browser: number; browserBeispiele: string[]; server: { titel: string; anzahl: number; status: string; zuletzt: string }[]; offeneWuensche: number }
  postfaecher: { adresse: string; art: string; aktiv: boolean; letzterAbruf: string | null; letzterFehler: string | null }[]
  sprachnachrichten: { heute: number; tagesgrenze: number }
  hinweise: string[]
}

const ANLASS_TEXT: Record<string, string> = {
  telegram: 'Assistent (Telegram)',
  'web:chat': 'Assistent (CRM)',
  classify_new_leads: 'Anfragen erkennen',
  'mail-eingang': 'Mail-Eingang prüfen',
  dokument_lesen: 'Dokumente lesen',
  kunden_umfeld_recherche: 'Kunden-Recherche',
  kontoauszug_auslesen: 'Kontoauszüge',
  bonitaet_pruefen: 'Bonität',
  wunsch_analyse: 'Wunsch-Auswertung',
  summarize: 'Zusammenfassungen',
}

function TechnikAnsicht({ daten }: { daten: TechnikDaten }) {
  const tage = Object.entries(daten.kosten.jeTag).sort(([a], [b]) => a.localeCompare(b))
  const maxTag = Math.max(0.01, ...tage.map(([, n]) => n))
  const anlaesse = Object.entries(daten.kosten.jeAnlass).sort(([a], [b]) => (ANLASS_TEXT[a] ?? a).localeCompare(ANLASS_TEXT[b] ?? b, 'de'))
  const maxAnlass = Math.max(0.01, ...anlaesse.map(([, n]) => n))
  const personen = Object.entries(daten.kosten.jePerson ?? {}).sort(([, a], [, b]) => b - a)
  const privatKosten = Object.entries(daten.kosten.privatJePerson ?? {}).filter(([, n]) => n > 0).sort(([, a], [, b]) => b - a)
  const maxPerson = Math.max(0.01, ...personen.map(([, n]) => n))
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Abschnitt titel="KI-Kosten im Zeitraum">
          <div className="text-2xl font-semibold text-slate-800">{euro(daten.kosten.summeEuro)}</div>
          <p className="mt-1 text-xs text-slate-500">
            {daten.kosten.aufrufe} Aufrufe · umgerechnet ({daten.kosten.umrechnung})
          </p>
        </Abschnitt>
        <Abschnitt titel="Sprachnachrichten heute">
          <div className="text-2xl font-semibold text-slate-800">
            {daten.sprachnachrichten.heute} <span className="text-sm font-normal text-slate-500">von {daten.sprachnachrichten.tagesgrenze.toLocaleString('de-DE')}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Tagesgrenze des kostenlosen Groq-Kontos</p>
        </Abschnitt>
        <Abschnitt titel="Fehler und Wünsche">
          <ul className="space-y-1 text-sm text-slate-700">
            <li>Fehler im Browser: {daten.fehler.browser}</li>
            <li>Probleme auf dem Server: {daten.fehler.server.length}</li>
            <li>Offene Wünsche: {daten.fehler.offeneWuensche}</li>
          </ul>
        </Abschnitt>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Abschnitt titel="KI-Kosten je Tag">
          {tage.length === 0 ? (
            <EmptyState text="Keine KI-Aufrufe im Zeitraum." />
          ) : (
            <div className="space-y-1">
              {tage.map(([d, n]) => (
                <div key={d} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-slate-500">{tagText(d)}</span>
                  <Balken wert={n} max={maxTag} />
                  <span className="w-16 shrink-0 text-right text-slate-600">{euro(n)}</span>
                </div>
              ))}
            </div>
          )}
        </Abschnitt>
        <Abschnitt titel="KI-Kosten je Funktion">
          <div className="space-y-1">
            {anlaesse.map(([a, n]) => (
              <div key={a} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-slate-600" title={a}>
                  {ANLASS_TEXT[a] ?? a}
                </span>
                <Balken wert={n} max={maxAnlass} farbe="bg-slate-400" />
                <span className="w-16 shrink-0 text-right text-slate-600">{euro(n)}</span>
              </div>
            ))}
          </div>
        </Abschnitt>
      </div>

      <Abschnitt titel="KI-Kosten je Person">
        {personen.length === 0 ? (
          <EmptyState text="Keine KI-Aufrufe im Zeitraum." />
        ) : (
          <div className="space-y-1">
            {personen.map(([p, n]) => (
              <div key={p} className="flex items-center gap-2 text-xs">
                <span className="w-48 shrink-0 truncate text-slate-600" title={p}>
                  {p}
                </span>
                <Balken wert={n} max={maxPerson} farbe="bg-slate-400" />
                <span className="w-16 shrink-0 text-right text-slate-600">{euro(n)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Je Person gemessen seit 19.11.2026. Zeitplan-Aufträge und der Mail-Eingang laufen ohne Person und stehen unter „Automatisch“.</p>
              {privatKosten.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <div className="mb-1 font-medium text-slate-700">Davon privat (Bereich Privat — wird privat berechnet)</div>
            {privatKosten.map(([p, n]) => (
              <div key={p} className="flex justify-between">
                <span>{p}</span>
                <span>{euro(n)}</span>
              </div>
            ))}
          </div>
        )}
      </Abschnitt>

      <Abschnitt titel="Postfächer">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">Adresse</th>
              <th className="py-2 pr-3 font-medium">Art</th>
              <th className="py-2 pr-3 font-medium">Letzter Abruf</th>
              <th className="py-2 font-medium">Letzter Fehler</th>
            </tr>
          </thead>
          <tbody>
            {[...daten.postfaecher]
              .sort((a, b) => a.adresse.localeCompare(b.adresse))
              .map((p) => (
                <tr key={p.adresse} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-slate-800">{p.adresse}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {p.art}
                    {!p.aktiv && ' (aus)'}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{datumZeit(p.letzterAbruf)}</td>
                  <td className={`py-2 ${p.letzterFehler ? 'text-red-600' : 'text-slate-400'}`}>{p.letzterFehler ?? 'keiner'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Abschnitt>

      {(daten.fehler.server.length > 0 || daten.fehler.browserBeispiele.length > 0) && (
        <Abschnitt titel="Fehler im Einzelnen">
          <ul className="space-y-1 text-sm text-slate-700">
            {daten.fehler.server.map((f) => (
              <li key={f.titel}>
                {f.titel} · {f.anzahl}× · {f.status}
              </li>
            ))}
            {daten.fehler.browserBeispiele.map((f, i) => (
              <li key={i} className="text-xs text-slate-500">
                Browser: {f}
              </li>
            ))}
          </ul>
        </Abschnitt>
      )}
      <Hinweise liste={daten.hinweise} />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------

export function SuperuserSeite() {
  const istSuperuser = useIstSuperuser()
  const [teil, setTeil] = useState<SuperuserTeil>('nutzung')
  const [zeitraum, setZeitraum] = useState<Zeitraum>(30)
  const [person, setPerson] = useState('')
  const [bereich, setBereich] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [daten, setDaten] = useState<any>(null)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')

  const laden = useCallback(async () => {
    setLaedt(true)
    setFehler('')
    try {
      setDaten(await ladeSuperuserAuswertung(teil, zeitraum, teil === 'verlauf' ? { person: person || undefined, bereich: bereich || undefined } : {}))
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
      setDaten(null)
    } finally {
      setLaedt(false)
    }
  }, [teil, zeitraum, person, bereich])

  useEffect(() => {
    if (istSuperuser) void laden()
  }, [istSuperuser, laden])

  const personen: string[] = useMemo(() => (Array.isArray(daten?.personen) ? daten.personen : []), [daten])
  const [allePersonen, setAllePersonen] = useState<string[]>([])
  useEffect(() => {
    if (personen.length > 0) setAllePersonen(personen)
  }, [personen])

  if (istSuperuser === null) return <div className="p-6 text-sm text-slate-500">Lädt …</div>
  if (!istSuperuser) return <Navigate to="/heute" replace />

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <ShieldCheck size={20} className="text-accent-600" /> Superuser
          </h1>
          <p className="text-xs text-slate-500">
            Nur für dich sichtbar. Tatsachen zur Nutzung, ohne Bewertung von Personen.
            {daten?.zeitraum && ` Zeitraum ${tagText(daten.zeitraum.von)} – ${tagText(daten.zeitraum.bis)}.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            {([7, 30, 90] as Zeitraum[]).map((z) => (
              <button key={z} onClick={() => setZeitraum(z)} className={`rounded-md px-2.5 py-1 ${zeitraum === z ? 'bg-accent-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {z} Tage
              </button>
            ))}
          </div>
          <SecondaryButton onClick={() => void laden()} disabled={laedt}>
            <RefreshCw size={14} className={laedt ? 'animate-spin' : ''} /> Neu laden
          </SecondaryButton>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TEILE.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setDaten(null)
              setTeil(t.id)
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${teil === t.id ? 'border-accent-600 font-medium text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {fehler && <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">{fehler}</Card>}
      {laedt && !daten && <div className="p-6 text-sm text-slate-500">Lädt …</div>}
      {daten && teil === 'nutzung' && Array.isArray(daten.zeilen) && <NutzungAnsicht daten={daten} />}
      {daten && teil === 'verlauf' && Array.isArray(daten.eintraege) && (
        <VerlaufAnsicht daten={daten} personen={allePersonen} person={person} setPerson={setPerson} bereich={bereich} setBereich={setBereich} />
      )}
      {daten && teil === 'zahlen' && Array.isArray(daten.wochen) && <ZahlenAnsicht daten={daten} />}
      {daten && teil === 'technik' && daten.kosten && <TechnikAnsicht daten={daten} />}
    </div>
  )
}
