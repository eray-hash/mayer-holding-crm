// „Auf mehrere Akten verteilen“ (24.11.2026): Für Aufnahmen, in denen mehrere Kunden nacheinander besprochen werden
// (z. B. eine Sprachnotiz der Geschäftsführung mit 30 Kunden). Der Server zerlegt die Abschrift in Abschnitte je Kunde
// und schlägt je Abschnitt eine Akte vor (gespraech_verteilen_vorschlag, email-gateway/gespraechVerteilen.ts). Hier
// wählt der Mitarbeiter je Abschnitt die Akte (Treffer, andere Akte suchen, neue Akte, überspringen), ändert Stand,
// Beträge, Chance, Wiedervorlagen und To-dos und übernimmt (gespraech_verteilen). Schon Verteiltes ist abgehakt und
// gesperrt; ein zweites Übernehmen legt nichts doppelt an.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BEREICH_NAMEN, sucheAkten, type AkteTreffer } from '../akten'
import { aendere, feld, UEBER_LEISTE, fehlerText } from './bausteine'
import {
  alsDatum,
  eigeneEmail,
  ladeTeam,
  verteilen,
  verteilVorschlag,
  type TeamMitglied,
  type VerteilAbschnittAnsicht,
  type VerteilEingabe,
  type VerteilErgebnisZeile,
  type VerteilVorschlagAntwort,
} from './api'

type ZielArt = 'akte' | 'suchen' | 'neu' | 'ueberspringen'
type Wv = { titel: string; faellig: string; an: boolean }
type Todo = { text: string; faellig: string; zustaendig: string; email: string; an: boolean }
type Zeile = {
  a: VerteilAbschnittAnsicht
  an: boolean
  offen: boolean
  zielArt: ZielArt
  kundeId: string
  kundeName: string
  neuBereich: string
  neuName: string
  stand: string
  bezahlt: string
  erwartet: string
  monat: string
  chanceAn: boolean
  prozent: string
  begruendung: string
  wv: Wv[]
  todos: Todo[]
}

function zahlText(n: number | undefined): string {
  return n ? String(n).replace('.', ',') : ''
}

function alsZahl(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function passendesMitglied(name: string, team: TeamMitglied[]): string {
  const n = name.trim().toLowerCase()
  if (!n) return ''
  const t = team.filter((m) => {
    const voll = m.name.toLowerCase()
    return voll === n || n.split(/\s+/).every((w) => voll.split(/\s+/).includes(w))
  })
  return t.length === 1 ? t[0].email : ''
}

function startZeile(a: VerteilAbschnittAnsicht, bereiche: string[], team: TeamMitglied[], ich: string): Zeile {
  const v = a.vorschlag
  const treffer = a.treffer.find((t) => v.art === 'akte' && t.id === v.kundeId)
  return {
    a,
    an: !a.erledigt && v.art !== 'ueberspringen',
    offen: false,
    zielArt: v.art === 'akte' ? 'akte' : v.art === 'neu' ? 'neu' : 'ueberspringen',
    kundeId: v.art === 'akte' ? v.kundeId : '',
    kundeName: treffer?.name ?? '',
    neuBereich: v.art === 'neu' ? v.bereich : bereiche[0] ?? 'privat',
    neuName: a.firma || a.name,
    stand: a.stand,
    bezahlt: zahlText(a.bezahlt),
    erwartet: zahlText(a.erwartetNetto),
    monat: a.erwartetMonat ?? '',
    chanceAn: !!a.chance,
    prozent: a.chance ? String(a.chance.prozent) : '',
    begruendung: a.chance?.begruendung ?? '',
    wv: a.wiedervorlagen.map((w) => ({ titel: w.titel, faellig: alsDatum(w.faellig), an: true })),
    todos: a.todos.map((t) => ({ text: t.text, faellig: alsDatum(t.faellig), zustaendig: t.zustaendig ?? '', email: passendesMitglied(t.zustaendig ?? '', team) || (t.zustaendig ? '' : ich), an: true })),
  }
}

export function Verteilen({ id, zurueck }: { id: string; zurueck?: () => void }) {
  const [antwort, setAntwort] = useState<VerteilVorschlagAntwort | null>(null)
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [team, setTeam] = useState<TeamMitglied[]>([])
  const [ich, setIch] = useState('')
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [ergebnis, setErgebnis] = useState<{ ergebnisse: VerteilErgebnisZeile[]; hinweise: string[] } | null>(null)
  const aktiv = useRef(true)

  async function lade(neu = false) {
    setLaedt(true)
    setFehler('')
    try {
      const [t, e]: [TeamMitglied[], string] = team.length ? [team, ich] : await Promise.all([ladeTeam(), eigeneEmail()])
      if (!team.length) {
        setTeam(t)
        setIch(e)
      }
      let r = await verteilVorschlag(id, neu)
      // Lange Aufnahmen: die Berechnung läuft im Hintergrund weiter — alle 5 Sekunden nachfragen.
      while (aktiv.current && r.status === 'laeuft') {
        setAntwort(r)
        await new Promise((ok) => setTimeout(ok, 5000))
        r = await verteilVorschlag(id)
      }
      if (!aktiv.current) return
      setAntwort(r)
      setZeilen((r.abschnitte ?? []).map((a) => startZeile(a, r.bereiche ?? ['privat'], t, e)))
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      if (aktiv.current) setLaedt(false)
    }
  }

  useEffect(() => {
    aktiv.current = true
    void lade()
    return () => {
      aktiv.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const ausgewaehlt = zeilen.filter((z) => z.an && !z.a.erledigt && z.zielArt !== 'ueberspringen')
  const probleme = useMemo(() => {
    const p: string[] = []
    for (const z of ausgewaehlt) {
      if ((z.zielArt === 'akte' || z.zielArt === 'suchen') && !z.kundeId) p.push(`${z.a.name}: Bitte eine Akte wählen.`)
      if (z.zielArt === 'neu' && (!z.neuName.trim() || !z.neuBereich)) p.push(`${z.a.name}: Name und Bereich der neuen Akte fehlen.`)
      if (z.wv.some((w) => w.an && w.titel.trim() && !w.faellig)) p.push(`${z.a.name}: Wiedervorlage ohne Datum.`)
    }
    return p
  }, [ausgewaehlt])

  async function uebernehmen() {
    setLaeuft(true)
    setFehler('')
    try {
      const eingaben: VerteilEingabe[] = ausgewaehlt.map((z) => ({
        nr: z.a.nr,
        ziel: z.zielArt === 'neu' ? { neu: { bereich: z.neuBereich, firma: z.neuName.trim(), ansprechpartner: z.a.person } } : { kundeId: z.kundeId },
        stand: z.stand,
        bezahlt: alsZahl(z.bezahlt),
        erwartetNetto: alsZahl(z.erwartet),
        erwartetMonat: /^\d{4}-\d{2}$/.test(z.monat) ? z.monat : null,
        chance: z.chanceAn && z.prozent.trim() !== '' && Number.isFinite(Number(z.prozent)) ? { prozent: Number(z.prozent), begruendung: z.begruendung } : null,
        wiedervorlagen: z.wv.filter((w) => w.an && w.titel.trim()).map((w) => ({ titel: w.titel, faellig: w.faellig })),
        todos: z.todos.filter((t) => t.an && t.text.trim()).map((t) => ({ text: t.text, faellig: t.faellig || undefined, zustaendig: t.email ? undefined : t.zustaendig || undefined, zustaendig_email: t.email || undefined })),
      }))
      const r = await verteilen(id, eingaben)
      setErgebnis({ ergebnisse: r.ergebnisse, hinweise: r.hinweise })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      await lade()
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setLaeuft(false)
    }
  }

  const setze = (i: number, teil: Partial<Zeile>) => setZeilen((l) => aendere(l, i, teil))
  const bereiche = antwort?.bereiche ?? ['privat']

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Auf mehrere Akten verteilen</h2>
        {zurueck && <button onClick={zurueck} className="text-sm text-indigo-600">In eine Akte übernehmen</button>}
      </div>
      <p className="text-sm text-slate-600">Je Kunde ein Abschnitt: Akte prüfen, bei Bedarf ändern, dann übernehmen. Je Akte entstehen ein Gesprächsprotokoll mit nur ihrem Teil, ein Eintrag im Verlauf und die angehakten Wiedervorlagen und To-dos.</p>

      {ergebnis && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">Übernommen in {ergebnis.ergebnisse.length} Akte{ergebnis.ergebnisse.length === 1 ? '' : 'n'}:</p>
          <ul className="mt-1 space-y-1">
            {ergebnis.ergebnisse.map((e) => (
              <li key={e.kundeId}>
                <a href={e.link} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 underline">{e.name}</a>
                {e.neu ? ' (neu angelegt)' : ''}: {e.extern ? 'schon früher verteilt — nichts doppelt angelegt' : e.angelegt.length ? e.angelegt.join(', ') : 'nichts Neues'}
                {e.hinweise.map((h, n) => <span key={n} className="block text-amber-800">{h}</span>)}
              </li>
            ))}
          </ul>
          {ergebnis.hinweise.map((h, n) => <p key={n} className="mt-1 text-amber-800">{h}</p>)}
        </div>
      )}

      {laedt && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {antwort?.status === 'laeuft' ? 'Der Vorschlag wird erstellt — bei langen Aufnahmen dauert das ein, zwei Minuten …' : 'Vorschlag wird geladen …'}
        </div>
      )}
      {fehler && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{fehler}</p>}
      {!laedt && antwort?.status === 'fehler' && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
          {antwort.fehler ?? 'Der Vorschlag ließ sich nicht erstellen.'}
          <button onClick={() => void lade(true)} className="mt-2 block font-medium text-indigo-700 underline">Noch einmal versuchen</button>
        </div>
      )}
      {!laedt && antwort?.hinweis && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{antwort.hinweis}</p>}

      {!laedt && zeilen.map((z, i) => (
        <AbschnittKarte key={z.a.nr} z={z} setze={(teil) => setze(i, teil)} team={team} ich={ich} bereiche={bereiche} />
      ))}

      {!laedt && antwort?.status === 'fertig' && zeilen.length > 0 && (
        <>
          {probleme.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {probleme.slice(0, 6).map((p, n) => <p key={n}>{p}</p>)}
            </div>
          )}
          <button onClick={() => { if (confirm('Den Vorschlag neu von der KI erstellen lassen? Deine Änderungen auf dieser Seite gehen verloren; schon Verteiltes bleibt.')) void lade(true) }} className="text-sm text-slate-500 underline">
            Vorschlag neu erstellen
          </button>
          <button
            onClick={uebernehmen}
            disabled={laeuft || ausgewaehlt.length === 0 || probleme.length > 0}
            className="sticky z-20 w-full rounded-xl bg-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-lg disabled:opacity-50"
            style={UEBER_LEISTE}
          >
            {laeuft ? 'Wird übernommen …' : `In ${ausgewaehlt.length} Abschnitt${ausgewaehlt.length === 1 ? '' : 'en'} übernehmen`}
          </button>
        </>
      )}
    </div>
  )
}

function AbschnittKarte({ z, setze, team, ich, bereiche }: { z: Zeile; setze: (teil: Partial<Zeile>) => void; team: TeamMitglied[]; ich: string; bereiche: string[] }) {
  const a = z.a
  const [suche, setSuche] = useState('')
  const [treffer, setTreffer] = useState<AkteTreffer[]>([])

  useEffect(() => {
    if (z.zielArt !== 'suchen' || suche.trim().length < 2) {
      setTreffer([])
      return
    }
    let aktiv = true
    const uhr = setTimeout(() => {
      sucheAkten(suche.trim()).then((t) => aktiv && setTreffer(t.filter((x) => x.art === 'kunde'))).catch(() => aktiv && setTreffer([]))
    }, 250)
    return () => {
      aktiv = false
      clearTimeout(uhr)
    }
  }, [suche, z.zielArt])

  if (a.erledigt) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm">
        <div className="font-semibold text-slate-800">{a.nr + 1}. {a.name}</div>
        <div className="text-emerald-800">
          Schon verteilt → <a href={a.erledigt.link} target="_blank" rel="noreferrer" className="underline">{a.erledigt.name}</a>
        </div>
      </div>
    )
  }

  const unsicher = a.vorschlag.art === 'akte' && !a.vorschlag.sicher
  const wert = z.zielArt === 'akte' ? `akte:${z.kundeId}` : z.zielArt
  const marke = z.zielArt === 'ueberspringen' ? null : z.zielArt === 'neu' ? 'neue Akte' : unsicher && z.kundeId === (a.vorschlag as { kundeId: string }).kundeId ? 'bitte prüfen' : null

  return (
    <div className={`rounded-xl border p-3 ${z.an ? 'border-indigo-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-75'}`}>
      <label className="flex items-center gap-2">
        <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={z.an} onChange={(e) => setze({ an: e.target.checked })} />
        <span className="text-sm font-semibold text-slate-800">{a.nr + 1}. {a.name}</span>
        {marke && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${marke === 'bitte prüfen' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{marke}</span>}
      </label>
      {a.bezug && <p className="mt-1 text-xs text-slate-500">{a.bezug}</p>}

      <select
        className={`${feld} mt-2`}
        value={wert}
        disabled={!z.an}
        onChange={(e) => {
          const v = e.target.value
          if (v.startsWith('akte:')) {
            const kid = v.slice(5)
            setze({ zielArt: 'akte', kundeId: kid, kundeName: a.treffer.find((t) => t.id === kid)?.name ?? '' })
          } else setze({ zielArt: v as ZielArt, kundeId: v === 'suchen' ? '' : z.kundeId })
        }}
      >
        {a.treffer.map((t) => <option key={t.id} value={`akte:${t.id}`}>{t.name} · {BEREICH_NAMEN[t.bereich] ?? t.bereich}</option>)}
        {z.zielArt === 'akte' && z.kundeId && !a.treffer.some((t) => t.id === z.kundeId) && <option value={`akte:${z.kundeId}`}>{z.kundeName || z.kundeId}</option>}
        <option value="suchen">Andere Akte suchen …</option>
        <option value="neu">Neue Akte anlegen</option>
        <option value="ueberspringen">Überspringen</option>
      </select>

      {z.an && z.zielArt === 'suchen' && (
        <div className="mt-2">
          <input className={feld} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma oder E-Mail" />
          <div className="mt-1.5 space-y-1">
            {treffer.map((t) => (
              <button key={t.id} onClick={() => setze({ zielArt: 'akte', kundeId: t.id, kundeName: t.name })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm">
                <span>{t.name}</span>
                <span className="text-xs text-slate-400">{t.zusatz}</span>
              </button>
            ))}
            {suche.trim().length >= 2 && treffer.length === 0 && <p className="text-xs text-slate-500">Keine Akte gefunden.</p>}
          </div>
        </div>
      )}

      {z.an && z.zielArt === 'neu' && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input className={feld} value={z.neuName} onChange={(e) => setze({ neuName: e.target.value })} placeholder="Name oder Firma" />
          <select className={feld} value={z.neuBereich} onChange={(e) => setze({ neuBereich: e.target.value })}>
            {bereiche.map((b) => <option key={b} value={b}>{b === 'privat' ? 'Privat (nur für mich)' : BEREICH_NAMEN[b] ?? b}</option>)}
          </select>
        </div>
      )}

      {z.an && z.zielArt !== 'ueberspringen' && (
        <>
          <textarea className={`${feld} mt-2 min-h-[4.5rem] text-sm`} value={z.stand} onChange={(e) => setze({ stand: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">
            {[
              z.bezahlt ? `bezahlt ${z.bezahlt} €` : '',
              z.erwartet ? `erwartet ${z.erwartet} € netto${z.monat ? ` (${z.monat.split('-').reverse().join('.')})` : ''}` : '',
              z.chanceAn && z.prozent ? `Chance ${z.prozent} %` : '',
              z.wv.filter((w) => w.an).length ? `${z.wv.filter((w) => w.an).length} Wiedervorlage(n)` : '',
              z.todos.filter((t) => t.an).length ? `${z.todos.filter((t) => t.an).length} To-do(s)` : '',
            ].filter(Boolean).join(' · ') || 'Keine Beträge, Wiedervorlagen oder To-dos.'}
          </p>
          <button onClick={() => setze({ offen: !z.offen })} className="mt-1 text-sm text-indigo-600">{z.offen ? 'Weniger' : 'Beträge, Chance, Wiedervorlagen, To-dos ändern'}</button>
          {z.offen && <Details z={z} setze={setze} team={team} ich={ich} />}
        </>
      )}
    </div>
  )
}

function Details({ z, setze, team, ich }: { z: Zeile; setze: (teil: Partial<Zeile>) => void; team: TeamMitglied[]; ich: string }) {
  return (
    <div className="mt-2 space-y-3 border-t border-slate-100 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-500">Bezahlt (€)
          <input className={feld} inputMode="decimal" value={z.bezahlt} onChange={(e) => setze({ bezahlt: e.target.value })} />
        </label>
        <label className="text-xs text-slate-500">Erwartet netto (€)
          <input className={feld} inputMode="decimal" value={z.erwartet} onChange={(e) => setze({ erwartet: e.target.value })} />
        </label>
        <label className="col-span-2 text-xs text-slate-500">Monat, in dem es erwartet wird
          <input type="month" className={feld} value={z.monat} onChange={(e) => setze({ monat: e.target.value })} />
        </label>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={z.chanceAn} onChange={(e) => setze({ chanceAn: e.target.checked })} />
          Chance eintragen (unbestätigt; eine bestätigte Chance bleibt)
        </label>
        {z.chanceAn && (
          <div className="mt-1 grid grid-cols-[5.5rem_1fr] gap-2">
            <input className={feld} inputMode="numeric" value={z.prozent} placeholder="%" onChange={(e) => setze({ prozent: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} />
            <input className={feld} value={z.begruendung} placeholder="Begründung" onChange={(e) => setze({ begruendung: e.target.value })} />
          </div>
        )}
      </div>

      {z.wv.length > 0 && <p className="text-sm font-medium text-slate-700">Wiedervorlagen</p>}
      {z.wv.map((w, i) => (
        <div key={`wv${i}`} className="grid grid-cols-[auto_1fr] items-start gap-2">
          <input type="checkbox" className="mt-2.5 h-5 w-5 accent-indigo-600" checked={w.an} onChange={(e) => setze({ wv: aendere(z.wv, i, { an: e.target.checked }) })} />
          <div className="space-y-1">
            <input className={feld} value={w.titel} onChange={(e) => setze({ wv: aendere(z.wv, i, { titel: e.target.value }) })} />
            <input type="date" className={feld} value={w.faellig} onChange={(e) => setze({ wv: aendere(z.wv, i, { faellig: e.target.value }) })} />
            {w.an && !w.faellig && <p className="text-xs text-rose-700">Bitte ein Datum wählen.</p>}
          </div>
        </div>
      ))}
      <button className="text-xs text-indigo-600" onClick={() => setze({ wv: [...z.wv, { titel: '', faellig: '', an: true }] })}>+ Wiedervorlage</button>

      {z.todos.length > 0 && <p className="text-sm font-medium text-slate-700">To-dos</p>}
      {z.todos.map((t, i) => (
        <div key={`td${i}`} className="grid grid-cols-[auto_1fr] items-start gap-2">
          <input type="checkbox" className="mt-2.5 h-5 w-5 accent-indigo-600" checked={t.an} onChange={(e) => setze({ todos: aendere(z.todos, i, { an: e.target.checked }) })} />
          <div className="space-y-1">
            <input className={feld} value={t.text} onChange={(e) => setze({ todos: aendere(z.todos, i, { text: e.target.value }) })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={feld} value={t.email} onChange={(e) => setze({ todos: aendere(z.todos, i, { email: e.target.value }) })}>
                <option value={ich}>Ich</option>
                {team.filter((m) => m.email !== ich).map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
                {t.zustaendig && !passendesMitglied(t.zustaendig, team) && <option value="">{t.zustaendig} (in meiner Liste)</option>}
              </select>
              <input type="date" className={feld} value={t.faellig} onChange={(e) => setze({ todos: aendere(z.todos, i, { faellig: e.target.value }) })} />
            </div>
          </div>
        </div>
      ))}
      <button className="text-xs text-indigo-600" onClick={() => setze({ todos: [...z.todos, { text: '', faellig: '', zustaendig: '', email: ich, an: true }] })}>+ To-do</button>

      {z.a.offeneFragen.length > 0 && (
        <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          <p className="font-medium">Offene Fragen (kommen ins Protokoll):</p>
          {z.a.offeneFragen.map((f, n) => <p key={n}>– {f}</p>)}
        </div>
      )}
      {z.a.auszug && (
        <details className="text-xs text-slate-500">
          <summary>Wortlaut aus der Aufnahme</summary>
          <p className="mt-1 whitespace-pre-line">{z.a.auszug}</p>
        </details>
      )}
    </div>
  )
}
