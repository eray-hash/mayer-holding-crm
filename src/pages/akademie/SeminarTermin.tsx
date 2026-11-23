// Ein Seminartermin der Akademie (22.11.2026): Eckdaten, öffentlicher Anmeldelink, Teilnehmerliste
// (von Hand aus Akademie-Akten oder frei eintragen, Stand ändern, als Tabelle herunterladen,
// Teilnahmebestätigung als PDF) und die automatischen Mails an die Teilnehmer dieses Termins.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Award, CalendarDays, Check, Copy, Download, ExternalLink, Mail, MapPin, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { SeminarTerminFenster } from '../../components/SeminarTerminFenster'
import { fmtEURCent, today, uid } from '../../lib/dates'
import { ladeSeminare, type Seminar } from '../../lib/seminare'
import {
  aendereAnmeldung, aendereTermin, anmeldeLink, ANMELDE_STATUS, belegung as belegungVon, erneuereAnmeldeLink, ladeAkademieRegeln,
  ladeAnmeldungen, ladeTermin, ladeTerminNachrichten, legeAnmeldungAn, loescheAnmeldung, loescheTermin, regelZeitText, teilnehmerCsv,
  TERMIN_STATUS, terminZeit, warteAufAkte, type AkademieNachricht, type AkademieRegel, type AnmeldeStatus, type SeminarAnmeldung, type SeminarTermin,
} from '../../lib/seminarTermine'
import { brichAutoNachrichtAb, sendeAutoNachrichtJetzt, setzeAutoRegel } from '../../lib/autoNachrichten'
import { erzeugeTeilnahmePdf, teilnahmeDateiname } from '../../lib/teilnahmebestaetigungPdf'
import { briefkopfAus } from '../../data/briefkopf'
import type { Kunde, SeminarBuchung, SeminarStand } from '../../types'

const NACHRICHT_STAND: Record<string, { label: string; farbe: string }> = {
  geplant: { label: 'Geplant', farbe: 'bg-sky-50 text-sky-700' },
  ohne_adresse: { label: 'Ohne Adresse', farbe: 'bg-amber-50 text-amber-700' },
  gesendet: { label: 'Gesendet', farbe: 'bg-emerald-50 text-emerald-700' },
  abgebrochen: { label: 'Nicht gesendet', farbe: 'bg-slate-100 text-slate-500' },
  fehler: { label: 'Fehler', farbe: 'bg-rose-50 text-rose-700' },
}

/** Seminare einer Akte: Eintrag ergänzen oder den Stand anheben (nie absenken). */
function seminareMit(liste: SeminarBuchung[] | undefined, s: { id: string; titel: string }, stand: SeminarStand): SeminarBuchung[] {
  const rang: Record<SeminarStand, number> = { interessiert: 0, angemeldet: 1, teilgenommen: 2 }
  const alt = liste ?? []
  if (!alt.some((x) => x.id === s.id)) return [...alt, { id: s.id, titel: s.titel, stand }]
  return alt.map((x) => (x.id === s.id && rang[x.stand] < rang[stand] ? { ...x, stand } : x))
}

function herunterladen(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function SeminarTermin() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const { mitarbeiter, istSuperuser, ansichtAls } = useAuth()
  const nutzer = useKvNutzer()
  const darfSchalten = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || istSuperuser)

  const [termin, setTermin] = useState<SeminarTermin | null | undefined>(undefined)
  const [seminar, setSeminar] = useState<Seminar | undefined>()
  const [liste, setListe] = useState<SeminarAnmeldung[]>([])
  const [nachrichten, setNachrichten] = useState<AkademieNachricht[]>([])
  const [regeln, setRegeln] = useState<AkademieRegel[]>([])
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')
  const [bearbeiten, setBearbeiten] = useState(false)
  const [eintragen, setEintragen] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const [loeschen, setLoeschen] = useState<SeminarAnmeldung | null>(null)

  const laden = useCallback(async () => {
    if (!id) return
    try {
      const t = await ladeTermin(id)
      setTermin(t)
      if (!t) return
      const [katalog, anm] = await Promise.all([ladeSeminare(), ladeAnmeldungen({ terminId: t.id })])
      setSeminar(katalog.find((s) => s.id === t.seminarId))
      setListe(anm)
      setNachrichten(await ladeTerminNachrichten(t.id).catch(() => []))
      setRegeln(await ladeAkademieRegeln().catch(() => []))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Termin ließ sich nicht laden.')
      setTermin((t) => (t === undefined ? null : t))
    }
  }, [id])
  useEffect(() => {
    laden()
  }, [laden])

  const b = useMemo(() => belegungVon(liste, termin?.plaetze), [liste, termin?.plaetze])
  const sortiert = useMemo(() => {
    const reihenfolge: AnmeldeStatus[] = ['bestaetigt', 'angemeldet', 'teilgenommen', 'warteliste', 'storniert']
    return [...liste].sort((x, y) => reihenfolge.indexOf(x.status) - reihenfolge.indexOf(y.status) || x.erstelltAm.localeCompare(y.erstelltAm))
  }, [liste])
  const akten = state.akademieTeilnehmer

  if (termin === undefined) return <p className="text-sm text-slate-400">Lädt …</p>
  if (termin === null) {
    return (
      <div className="space-y-3">
        <Link to="/akademie/seminare" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> Seminare</Link>
        <EmptyState text={fehler || 'Diesen Termin gibt es nicht (mehr).'} />
      </div>
    )
  }

  const titel = seminar?.titel ?? 'Seminar'
  const st = TERMIN_STATUS.find((x) => x.id === termin.status)
  const preis = termin.preis ?? seminar?.preisNetto
  const link = anmeldeLink(termin.anmeldeToken)

  /** Stand des Seminars in der Akademie-Akte nachziehen (Seminare und Verlauf). */
  function inAkteVermerken(a: Pick<SeminarAnmeldung, 'kundeId'>, stand: SeminarStand | null, text: string) {
    if (!a.kundeId || !seminar) return
    const k = akten.find((x) => x.id === a.kundeId)
    if (!k) return
    const patch: Partial<Kunde> = {
      activities: [{ id: uid('act'), date: today(), text, user: nutzer.name }, ...(k.activities ?? [])],
      letzteAktivitaet: today(),
    }
    if (stand) patch.seminare = seminareMit(k.seminare, seminar, stand)
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'akademie', id: k.id, patch })
  }

  async function standSetzen(a: SeminarAnmeldung, status: AnmeldeStatus) {
    setFehler('')
    try {
      await aendereAnmeldung(a.id, { status }, nutzer.name)
      const label = ANMELDE_STATUS.find((s) => s.id === status)?.label ?? status
      const stand: SeminarStand | null = status === 'teilgenommen' ? 'teilgenommen' : status === 'angemeldet' || status === 'bestaetigt' ? 'angemeldet' : null
      inAkteVermerken(a, stand, `Seminar „${titel}“ am ${terminZeit(termin!.beginn)}: Stand auf „${label}“ gesetzt.`)
      await laden()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    }
  }

  function csv() {
    const datum = termin!.beginn.slice(0, 10)
    herunterladen(new Blob([teilnehmerCsv(sortiert)], { type: 'text/csv;charset=utf-8' }), `Teilnehmer ${titel.replace(/[\\/:*?"<>|]/g, '-')} ${datum}.csv`)
  }

  function bestaetigung(a: SeminarAnmeldung) {
    const angaben = {
      name: a.name,
      firma: a.firma,
      seminar: titel,
      termin: terminZeit(termin!.beginn, termin!.ende),
      ort: termin!.ort,
      dauer: seminar?.dauer,
      referent: termin!.referent || seminar?.dozent,
      inhalte: seminar?.beschreibung,
    }
    herunterladen(erzeugeTeilnahmePdf(angaben, briefkopfAus(state.vorlagenBeratung)), teilnahmeDateiname(angaben))
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link)
      setKopiert(true)
      setTimeout(() => setKopiert(false), 2000)
    } catch {
      setHinweis(`Kopieren ging nicht. Der Link: ${link}`)
    }
  }

  return (
    <div className="space-y-5">
      <Link to="/akademie/seminare" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"><ArrowLeft size={14} /> Seminare</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-800">{titel}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1"><CalendarDays size={14} className="text-slate-400" /> {terminZeit(termin.beginn, termin.ende)}</span>
            {termin.ort && <span className="inline-flex items-center gap-1"><MapPin size={14} className="text-slate-400" /> {termin.ort}</span>}
            {termin.onlineLink && <span className="text-slate-500">auch online</span>}
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st?.farbe ?? ''}`}>{st?.label}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {[
              preis !== undefined ? `${fmtEURCent(preis)} netto${termin.preis === undefined ? ' (Katalogpreis)' : ''}` : '',
              termin.referent || seminar?.dozent ? `Referent: ${termin.referent || seminar?.dozent}` : '',
              termin.verantwortlich ? `betreut von ${termin.verantwortlich}` : '',
              termin.anmeldeschluss ? `Anmeldeschluss ${new Date(termin.anmeldeschluss).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}` : '',
            ].filter(Boolean).join(' · ')}
          </p>
          {termin.notiz && <p className="mt-1 text-xs text-slate-500">Notiz: {termin.notiz}</p>}
        </div>
        {!nutzer.nurLesen && (
          <SecondaryButton onClick={() => setBearbeiten(true)}><Pencil size={14} /> Termin bearbeiten</SecondaryButton>
        )}
      </div>

      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      {hinweis && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{hinweis}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Plätze</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">
            {b.belegt}
            {termin.plaetze !== undefined && <span className="text-base font-normal text-slate-400"> / {termin.plaetze}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {termin.plaetze === undefined ? 'ohne Begrenzung' : b.voll ? (b.belegt > termin.plaetze ? `überbucht um ${b.belegt - termin.plaetze}` : 'voll') : `${b.frei} frei`}
            {b.warteliste > 0 ? ` · ${b.warteliste} auf der Warteliste` : ''}
          </p>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <p className="text-xs font-medium text-slate-500">Anmeldung über das Internet</p>
          {termin.oeffentlich ? (
            <>
              <p className="mt-1 break-all rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">{link}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <SecondaryButton onClick={kopieren}>{kopiert ? <Check size={14} /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Link kopieren'}</SecondaryButton>
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                  <ExternalLink size={14} /> Seite ansehen
                </a>
                {!nutzer.nurLesen && (
                  <button
                    onClick={async () => {
                      try {
                        await erneuereAnmeldeLink(termin.id, nutzer.name)
                        setHinweis('Neuer Link erzeugt. Der alte Link funktioniert nicht mehr.')
                      } catch (e) {
                        // Vorher kam die Erfolgsmeldung auch nach einem Fehler.
                        setFehler(e instanceof Error ? e.message : 'Ging nicht.')
                      }
                      await laden()
                    }}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                    title="Wenn der Link in falsche Hände geraten ist"
                  >
                    <RefreshCw size={12} /> Neuen Link erzeugen
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              Aus. Teilnehmer werden nur von Hand eingetragen.{' '}
              {!nutzer.nurLesen && (
                <button
                  onClick={async () => {
                    await aendereTermin(termin.id, { oeffentlich: true }, nutzer.name).catch((e) => setFehler(e instanceof Error ? e.message : 'Ging nicht.'))
                    await laden()
                  }}
                  className="font-medium text-accent-700 hover:underline"
                >
                  Einschalten
                </button>
              )}
            </p>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Users size={16} className="text-slate-400" /> Teilnehmer ({liste.length})</h2>
          <div className="flex flex-wrap gap-2">
            {liste.length > 0 && <SecondaryButton onClick={csv}><Download size={14} /> Als Tabelle (CSV)</SecondaryButton>}
            {!nutzer.nurLesen && termin.status === 'geplant' && <PrimaryButton onClick={() => setEintragen(true)}><Plus size={14} /> Teilnehmer eintragen</PrimaryButton>}
          </div>
        </div>
        {sortiert.length === 0 ? (
          <EmptyState text="Noch niemand angemeldet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Name</th>
                  <th className="py-1.5 pr-3 font-medium">Kontakt</th>
                  <th className="py-1.5 pr-3 font-medium">Stand</th>
                  <th className="py-1.5 pr-3 font-medium">Eingetragen</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortiert.map((a) => (
                  <tr key={a.id} className={a.status === 'storniert' ? 'text-slate-400' : 'text-slate-700'}>
                    <td className="py-2 pr-3 align-top">
                      {a.kundeId && akten.some((k) => k.id === a.kundeId) ? (
                        <Link to={`/akademie/teilnehmer/${a.kundeId}`} className="font-medium hover:underline">{a.name}</Link>
                      ) : (
                        <span className="font-medium">{a.name}</span>
                      )}
                      {a.firma && <span className="block text-xs text-slate-500">{a.firma}</span>}
                      {a.notiz && <span className="block text-xs text-slate-400">{a.notiz}</span>}
                    </td>
                    <td className="py-2 pr-3 align-top text-xs">
                      {a.email && <a href={`mailto:${a.email}`} className="block hover:underline">{a.email}</a>}
                      {a.telefon && <span className="block">{a.telefon}</span>}
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <select
                        value={a.status}
                        disabled={nutzer.nurLesen}
                        onChange={(e) => standSetzen(a, e.target.value as AnmeldeStatus)}
                        className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
                        aria-label={`Stand für ${a.name}`}
                      >
                        {ANMELDE_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3 align-top text-xs text-slate-500">
                      {new Date(a.erstelltAm).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}
                      <span className="block">{a.quelle === 'formular' ? 'über das Formular' : `von Hand${a.erstelltVon ? ` (${a.erstelltVon})` : ''}`}</span>
                      {a.zustimmung && <span className="block" title={`Zugestimmt am ${new Date(a.zustimmung.am).toLocaleString('de-DE')}`}>Bedingungen zugestimmt</span>}
                    </td>
                    <td className="py-2 align-top">
                      <div className="flex justify-end gap-1">
                        {a.status === 'teilgenommen' && (
                          <button onClick={() => bestaetigung(a)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Teilnahmebestätigung als PDF" aria-label={`Teilnahmebestätigung für ${a.name}`}>
                            <Award size={15} />
                          </button>
                        )}
                        {!nutzer.nurLesen && (
                          <button onClick={() => setLoeschen(a)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Aus der Liste entfernen" aria-label={`${a.name} entfernen`}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Mail size={16} className="text-slate-400" /> Automatische Mails an die Teilnehmer</h2>
        <ul className="mb-3 grid gap-2 sm:grid-cols-2">
          {regeln.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 p-2 text-xs">
              <span>
                <span className="font-medium text-slate-700">{r.titel}</span> <span className="text-slate-400">({regelZeitText(r)})</span>
                <span className="block text-slate-500">{r.beschreibung}</span>
              </span>
              {darfSchalten ? (
                <button
                  onClick={async () => {
                    try {
                      await setzeAutoRegel(r.id, { aktiv: !r.aktiv }, nutzer.name)
                      setRegeln(await ladeAkademieRegeln())
                    } catch (e) {
                      setFehler(e instanceof Error ? e.message : 'Ging nicht.')
                    }
                  }}
                  className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${r.aktiv ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                >
                  {r.aktiv ? 'An' : 'Aus'}
                </button>
              ) : (
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${r.aktiv ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{r.aktiv ? 'An' : 'Aus'}</span>
              )}
            </li>
          ))}
        </ul>
        {regeln.length > 0 && regeln.every((r) => !r.aktiv) && <p className="mb-2 text-xs text-slate-500">Alle automatischen Mails sind aus. Einschalten kann die Geschäftsführung.</p>}
        {nachrichten.length === 0 ? (
          <p className="text-sm text-slate-400">Für diesen Termin ist keine Mail vorgemerkt oder verschickt.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {nachrichten.map((n) => {
              const s = NACHRICHT_STAND[n.status] ?? { label: n.status, farbe: '' }
              const regel = regeln.find((r) => r.id === n.regel)
              return (
                <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-700">{regel?.titel ?? n.regel}</span>
                    <span className="text-slate-500"> an {n.anName ?? n.an ?? 'unbekannt'}</span>
                    <span className="block text-xs text-slate-400">
                      {n.status === 'gesendet' && n.gesendetAm ? `gesendet ${new Date(n.gesendetAm).toLocaleString('de-DE')}` : `ab ${new Date(n.sendenAb).toLocaleString('de-DE')}`}
                      {n.grund ? ` · ${n.grund}` : ''}
                    </span>
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${s.farbe}`}>{s.label}</span>
                  {!nutzer.nurLesen && n.status === 'geplant' && (
                    <>
                      <button
                        onClick={async () => {
                          try {
                            const r = await sendeAutoNachrichtJetzt(n.id)
                            setHinweis(r.gesendet > 0 ? 'Gesendet.' : r.meldungen.join(' ') || 'Nicht gesendet.')
                            await laden()
                          } catch (e) {
                            setFehler(e instanceof Error ? e.message : 'Ging nicht.')
                          }
                        }}
                        className="text-xs font-medium text-accent-700 hover:underline"
                      >
                        Jetzt senden
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await brichAutoNachrichtAb(n.id, nutzer.name)
                            await laden()
                          } catch (e) {
                            setFehler(e instanceof Error ? e.message : 'Ging nicht.')
                          }
                        }}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        Nicht senden
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {bearbeiten && (
        <SeminarTerminFenster
          seminarTitel={titel}
          termin={termin}
          anzahlAnmeldungen={liste.filter((a) => a.status !== 'storniert').length}
          vorgabeVerantwortlich={nutzer.name}
          onClose={() => setBearbeiten(false)}
          onSpeichern={async (e) => {
            await aendereTermin(termin.id, e, nutzer.name)
            setBearbeiten(false)
            await laden()
          }}
          onLoeschen={async () => {
            await loescheTermin(termin.id)
            navigate('/akademie/seminare')
          }}
        />
      )}

      {eintragen && seminar && (
        <EintragenFenster
          akten={akten}
          liste={liste}
          voll={b.voll}
          onClose={() => setEintragen(false)}
          onEintragen={async (e) => {
            let kundeId = e.kundeId
            let akteHinweis = ''
            if (!kundeId && e.akteAnlegen) {
              // Neue Akademie-Akte über das CRM anlegen; die Datenbank schreibt sie im Hintergrund.
              const neu: Kunde = {
                id: uid('a'),
                firma: e.firma.trim() || e.name.trim(),
                ansprechpartner: e.name.trim(),
                email: e.email.trim(),
                telefon: e.telefon.trim(),
                prioritaet: 'Mittel',
                status: 'anmeldung_eingegangen',
                followUp: { date: today(), note: `Anmeldung zu „${titel}“ bestätigen`, done: false },
                verantwortlich: termin.verantwortlich || nutzer.name,
                letzteAktivitaet: today(),
                activities: [{ id: uid('act'), date: today(), text: `Teilnehmer angelegt beim Eintragen für das Seminar „${titel}“ am ${terminZeit(termin.beginn)}.`, user: nutzer.name }],
                seminare: [{ id: seminar.id, titel: seminar.titel, stand: e.status === 'warteliste' ? 'interessiert' : 'angemeldet' }],
              }
              dispatch({ type: 'ADD_AKADEMIE_TEILNEHMER', kunde: neu })
              if (await warteAufAkte(neu.id)) kundeId = neu.id
              else akteHinweis = ' Die neue Akte war noch nicht gespeichert, deshalb ist die Anmeldung noch nicht mit ihr verbunden.'
            }
            const a = await legeAnmeldungAn({ terminId: termin.id, kundeId, name: e.name, firma: e.firma, email: e.email, telefon: e.telefon, status: e.status, notiz: e.notiz }, nutzer.name)
            if (e.kundeId) {
              const label = ANMELDE_STATUS.find((s) => s.id === e.status)?.label ?? e.status
              inAkteVermerken(a, e.status === 'warteliste' ? 'interessiert' : 'angemeldet', `Für das Seminar „${titel}“ am ${terminZeit(termin.beginn)} eingetragen (${label}).`)
            }
            setEintragen(false)
            setHinweis(`${a.name} eingetragen.${akteHinweis}`)
            await laden()
          }}
        />
      )}

      {loeschen && (
        <Modal open onClose={() => setLoeschen(null)} title="Aus der Liste entfernen?">
          <p className="text-sm text-slate-600">
            {loeschen.name} wird aus der Teilnehmerliste gelöscht. Wer abgesagt hat, besser auf „Storniert“ setzen — dann bleibt die Anmeldung nachvollziehbar.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <SecondaryButton onClick={() => setLoeschen(null)}>Abbrechen</SecondaryButton>
            <button
              onClick={async () => {
                try {
                  await loescheAnmeldung(loeschen.id)
                  setLoeschen(null)
                  await laden()
                } catch (e) {
                  setFehler(e instanceof Error ? e.message : 'Löschen ging nicht.')
                  setLoeschen(null)
                }
              }}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700"
            >
              Löschen
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

type Eintrag = { kundeId?: string; name: string; firma: string; email: string; telefon: string; status: AnmeldeStatus; notiz: string; akteAnlegen: boolean }

function EintragenFenster({
  akten, liste, voll, onClose, onEintragen,
}: {
  akten: Kunde[]
  liste: SeminarAnmeldung[]
  voll: boolean
  onClose: () => void
  onEintragen: (e: Eintrag) => Promise<void>
}) {
  const [art, setArt] = useState<'akte' | 'frei'>(akten.length ? 'akte' : 'frei')
  const [suche, setSuche] = useState('')
  const [kundeId, setKundeId] = useState('')
  const [name, setName] = useState('')
  const [firma, setFirma] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [status, setStatus] = useState<AnmeldeStatus>(voll ? 'warteliste' : 'angemeldet')
  const [notiz, setNotiz] = useState('')
  const [akteAnlegen, setAkteAnlegen] = useState(true)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  const schon = new Set(liste.filter((a) => a.status !== 'storniert').map((a) => a.kundeId).filter(Boolean))
  const treffer = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return akten
      .filter((k) => !schon.has(k.id))
      .filter((k) => !s || [k.firma, k.ansprechpartner, k.email].some((t) => (t ?? '').toLowerCase().includes(s)))
      .slice(0, 50)
  }, [akten, suche, schon])

  async function speichern() {
    setFehler('')
    let e: Eintrag
    if (art === 'akte') {
      const k = akten.find((x) => x.id === kundeId)
      if (!k) return setFehler('Bitte eine Akte auswählen.')
      const nameAusAkte = (k.ansprechpartner || k.firma || '').trim()
      e = { kundeId: k.id, name: nameAusAkte, firma: k.firma && k.firma !== nameAusAkte ? k.firma : '', email: k.email ?? '', telefon: k.telefon ?? '', status, notiz, akteAnlegen: false }
    } else {
      if (name.trim().length < 2) return setFehler('Bitte den Namen angeben.')
      if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setFehler('Die E-Mail-Adresse ist ungültig.')
      const vorhanden = email.trim() ? akten.find((k) => (k.email ?? '').trim().toLowerCase() === email.trim().toLowerCase()) : undefined
      if (vorhanden && akteAnlegen) return setFehler(`Zu dieser E-Mail-Adresse gibt es schon die Akte „${vorhanden.ansprechpartner || vorhanden.firma}“. Bitte „Aus einer Akte“ wählen.`)
      e = { name, firma, email, telefon, status, notiz, akteAnlegen }
    }
    setLaeuft(true)
    try {
      await onEintragen(e)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
      setLaeuft(false)
    }
  }

  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  return (
    <Modal open onClose={onClose} title="Teilnehmer eintragen" aktionen={<PrimaryButton onClick={speichern} disabled={laeuft}>Eintragen</PrimaryButton>}>
      <div className="space-y-3">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(['akte', 'frei'] as const).map((x) => (
            <button key={x} onClick={() => setArt(x)} className={`flex-1 rounded-md px-2 py-1 ${art === x ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'}`}>
              {x === 'akte' ? 'Aus einer Akte' : 'Neue Person'}
            </button>
          ))}
        </div>
        {art === 'akte' ? (
          <>
            <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma oder E-Mail suchen" className={`${inputClass} w-full`} />
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              {treffer.length === 0 ? (
                <p className="p-2 text-sm text-slate-400">Keine passende Akademie-Akte.</p>
              ) : (
                treffer.map((k) => (
                  <label key={k.id} className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 ${kundeId === k.id ? 'bg-accent-50' : ''}`}>
                    <input type="radio" name="akte" checked={kundeId === k.id} onChange={() => setKundeId(k.id)} />
                    <span className="min-w-0 flex-1 text-slate-700">{k.ansprechpartner || k.firma}{k.firma && k.firma !== k.ansprechpartner ? ` (${k.firma})` : ''}</span>
                    <span className="text-xs text-slate-400">{k.email}</span>
                  </label>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block"><span className={feld}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} w-full`} /></label>
              <label className="block"><span className={feld}>Firma (freiwillig)</span><input value={firma} onChange={(e) => setFirma(e.target.value)} className={`${inputClass} w-full`} /></label>
              <label className="block"><span className={feld}>E-Mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={`${inputClass} w-full`} /></label>
              <label className="block"><span className={feld}>Telefon</span><input value={telefon} onChange={(e) => setTelefon(e.target.value)} className={`${inputClass} w-full`} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={akteAnlegen} onChange={(e) => setAkteAnlegen(e.target.checked)} /> Auch als Akademie-Akte anlegen
            </label>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={feld}>Stand</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as AnmeldeStatus)} className={`${inputClass} w-full`}>
              {ANMELDE_STATUS.filter((s) => s.id !== 'storniert').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="block"><span className={feld}>Notiz (freiwillig)</span><input value={notiz} onChange={(e) => setNotiz(e.target.value)} className={`${inputClass} w-full`} /></label>
        </div>
        {voll && status !== 'warteliste' && <p className="text-xs text-amber-700">Der Termin ist voll. Mit diesem Stand wird er überbucht.</p>}
        <p className="text-xs text-slate-400">Ist die Regel „Anmeldebestätigung“ eingeschaltet, bekommt der Teilnehmer eine Mail, sobald er auf „Angemeldet“ oder „Bestätigt“ steht.</p>
      </div>
    </Modal>
  )
}
