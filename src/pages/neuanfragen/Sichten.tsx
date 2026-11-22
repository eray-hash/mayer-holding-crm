// Neuanfragen sichten (22.11.2026): Akten in der ersten Stufe ihres Bereichs (viele automatisch aus Mails
// angelegt) schnell einordnen — eine Karte nach der anderen (am Rechner auch als kompakte Liste) mit dem
// Wichtigsten: wer, Ausschnitt der ersten Mail, angelegt, Dokumente, Einschätzung des Assistenten in einem Satz.
//
// Handlungen:
//  - Qualifiziert → Erstkontakt: Status wie in der Projekt-Checkliste (dispatch → crmSync, nur geänderte
//    Felder), dazu wahlweise Verantwortlich und eine Wiedervorlage „Anrufen“.
//  - Kein Kunde / Spam bzw. Kein Interesse: Status „nicht qualifiziert“ bzw. „verloren“ (je nach Statusnetz
//    des Bereichs), Eintrag im Verlauf, offenes Follow-up erledigt.
//  - Später: bis zu einem Tag zurückstellen (kein Verlaufseintrag).
//  - Zusammenführen mit …: wenn eine mögliche Dublette existiert (Kern _shared/dublettenKern.ts, auf dem
//    Server), über den vorhandenen Weg der Seite „Dubletten“ (Aktion `dubletten`, nur Geschäftsführung/Admin).
// Die Entscheidung merkt der Server in kunden.triage_vorschlag (Aktion neuanfrage_einschaetzung), damit Akten,
// die im Erstkontakt bleiben (z. B. Erben), nicht wieder auftauchen. Am Rechner Tastenkürzel, am Handy Wischen.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Archive, ArrowLeft, ArrowRight, CalendarClock, Check, ExternalLink, FileText, LayoutList, Loader2, Mail, Merge, Phone,
  RefreshCw, Sparkles, SquareStack, Undo2, UserRound, XCircle,
} from 'lucide-react'
import { Card, Modal, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { useIstSuperuser } from '../superuser/useIstSuperuser'
import { call } from '../../lib/emailGateway'
import { NUR_LESEN_MELDUNG } from '../../lib/nurLesen'
import { legeWiedervorlageAn, loescheWiedervorlage } from '../../lib/wiedervorlagen'
import { addDays, daysSince, fmtDate, today, uid } from '../../lib/dates'
import { MITARBEITER } from '../../data/constants'
import { kundeDetailPfad } from '../../data/kundenBereiche'
import type { ActivityEntry, FollowUp, Kunde, KundeBereich } from '../../types'
import { AKTION_TEXT, GRUND_TEXT, HERKUNFT_TEXT } from '../../../supabase/functions/_shared/neuanfrageKern.ts'
import {
  holeEinschaetzungen, ladeEinzelheiten, merkeEntscheidung, statusLabel, useNeuanfragen, zielArchiv, zielQualifiziert,
  type AkteLage, type ArchivGrund, type DublettenHinweis, type Neuanfrage,
} from './neuanfragenDaten'

type Ansicht = 'karte' | 'liste'
type Dialog =
  | { art: 'qualifizieren'; n: Neuanfrage }
  | { art: 'archivieren'; n: Neuanfrage }
  | { art: 'spaeter'; n: Neuanfrage }
  | { art: 'zusammenfuehren'; n: Neuanfrage; partner: DublettenHinweis }
type Meldung = { text: string; rueckgaengig?: () => Promise<void> }

const SPEICHER_ANSICHT = 'neuanfragen.ansicht'
const SPEICHER_ANRUFEN = 'neuanfragen.anrufen'

function lies(schluessel: string): string | null {
  try {
    return localStorage.getItem(schluessel)
  } catch {
    return null
  }
}
function schreibe(schluessel: string, wert: string): void {
  try {
    localStorage.setItem(schluessel, wert)
  } catch {
    // Nur eine Bequemlichkeit — ohne Speicher geht es auch.
  }
}

/** Nächster Werktag nach heute (für „Anrufen“). */
function naechsterWerktag(ab = today()): string {
  let d = addDays(ab, 1)
  while ([0, 6].includes(new Date(`${d}T12:00:00`).getDay())) d = addDays(d, 1)
  return d
}

const istTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

function vorDays(datum: string): string {
  if (!datum) return ''
  const t = daysSince(datum)
  return t <= 0 ? 'heute' : t === 1 ? 'gestern' : `vor ${t} Tagen`
}

export function NeuanfragenSichten() {
  const { dispatch, neuLaden } = useApp()
  const { mitarbeiter } = useAuth()
  const istSuperuser = useIstSuperuser()
  const nutzer = useKvNutzer()
  const navigate = useNavigate()
  const { alle, triage, spalteFehlt, fehler: ladeFehler, geladen } = useNeuanfragen()

  const [ansicht, setAnsicht] = useState<Ansicht>(() => (lies(SPEICHER_ANSICHT) === 'liste' ? 'liste' : 'karte'))
  const [bereichFilter, setBereichFilter] = useState<KundeBereich | ''>('')
  const [mitZurueckgestellten, setMitZurueckgestellten] = useState(false)
  const [mitAltbestand, setMitAltbestand] = useState(false)
  const [aktuellId, setAktuellId] = useState<string | null>(null)
  const [einzelheiten, setEinzelheiten] = useState<Record<string, AkteLage>>({})
  const [kiText, setKiText] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [meldung, setMeldung] = useState<Meldung | null>(null)
  const [fehler, setFehler] = useState('')
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  // Sofort ausblenden, was gerade entschieden wurde (die Antwort des Servers kommt etwas später).
  const [erledigt, setErledigt] = useState<Set<string>>(new Set())
  const angefragt = useRef(new Set<string>())
  const eingeschaetzt = useRef(new Set<string>())
  const kiLaeuft = useRef(false)

  const darfZusammenfuehren = !!mitarbeiter && (mitarbeiter.rolle === 'geschaeftsfuehrung' || !!mitarbeiter.ist_admin || istSuperuser === true)

  useEffect(() => schreibe(SPEICHER_ANSICHT, ansicht), [ansicht])

  // ---------- Warteschlange ----------

  const grundmenge = useMemo(
    () =>
      alle.filter(
        (n) =>
          !erledigt.has(n.kunde.id) &&
          (n.lage === 'offen' || (mitZurueckgestellten && n.lage === 'zurueckgestellt')) &&
          (mitAltbestand || n.herkunft !== 'altbestand'),
      ),
    [alle, erledigt, mitZurueckgestellten, mitAltbestand],
  )
  const jeBereich = useMemo(() => {
    const m = new Map<KundeBereich, { label: string; anzahl: number }>()
    for (const n of grundmenge) m.set(n.bereich, { label: n.bereichLabel, anzahl: (m.get(n.bereich)?.anzahl ?? 0) + 1 })
    return [...m.entries()].sort((a, b) => b[1].anzahl - a[1].anzahl)
  }, [grundmenge])
  const liste = useMemo(() => (bereichFilter ? grundmenge.filter((n) => n.bereich === bereichFilter) : grundmenge), [grundmenge, bereichFilter])
  const index = Math.max(0, aktuellId ? liste.findIndex((n) => n.kunde.id === aktuellId) : 0)
  const aktuell: Neuanfrage | undefined = liste[index] ?? liste[0]
  const zurueckgestellt = alle.filter((n) => n.lage === 'zurueckgestellt').length
  const heuteGesichtet = [...triage.values()].filter((t) => t.entscheidung?.am.slice(0, 10) === today() && t.entscheidung.von === nutzer.name).length

  const geheZu = useCallback((schritt: number) => {
    if (liste.length === 0) return
    const neu = Math.min(liste.length - 1, Math.max(0, index + schritt))
    setAktuellId(liste[neu].kunde.id)
  }, [liste, index])

  /** Vor einer Entscheidung: die nächste Akte merken (die entschiedene verschwindet aus der Liste). */
  function naechsteNach(id: string): string | null {
    const i = liste.findIndex((n) => n.kunde.id === id)
    return liste[i + 1]?.kunde.id ?? liste[i - 1]?.kunde.id ?? null
  }

  // ---------- Einzelheiten (erste Mail, Dubletten) und Einschätzung ----------

  const idsSchluessel = liste.map((n) => n.kunde.id).join(',')
  useEffect(() => {
    if (nutzer.nurLesen || !geladen) return
    const fehlen = liste.map((n) => n.kunde.id).filter((id) => !angefragt.current.has(id))
    if (fehlen.length === 0) return
    // Die aktuelle zuerst, damit die Karte schnell vollständig ist.
    if (aktuell && fehlen.includes(aktuell.kunde.id)) fehlen.unshift(...fehlen.splice(fehlen.indexOf(aktuell.kunde.id), 1))
    for (const id of fehlen) angefragt.current.add(id)
    ladeEinzelheiten(fehlen)
      .then((neu) => setEinzelheiten((alt) => ({ ...alt, ...neu })))
      .catch((e) => {
        for (const id of fehlen) angefragt.current.delete(id)
        setFehler(e instanceof Error ? e.message : 'Mails und Dubletten ließen sich nicht laden.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsSchluessel, geladen, nutzer.nurLesen])

  const brauchtEinschaetzung = useCallback(
    (n: Neuanfrage) => {
      const e = einzelheiten[n.kunde.id]
      if (!e) return false
      const v = n.triage.vorschlag
      return !v || v.stand !== e.stand
    },
    [einzelheiten],
  )

  const schaetzeEin = useCallback(async (ids: string[], neu = false) => {
    if (kiLaeuft.current || ids.length === 0) return
    kiLaeuft.current = true
    let rest = [...ids]
    try {
      for (let runde = 0; runde < 12 && rest.length > 0; runde++) {
        setKiText(`Der Assistent schätzt ${rest.length} ${rest.length === 1 ? 'Anfrage' : 'Anfragen'} ein …`)
        const r = await holeEinschaetzungen(rest, neu)
        const fertig = new Set(Object.keys(r.vorschlaege))
        // Verarbeitet hat der Server höchstens 20; was ohne Antwort blieb, nicht endlos wiederholen.
        const bearbeitet = rest.slice(0, 20)
        rest = rest.filter((id) => !fertig.has(id) && !bearbeitet.includes(id))
        if (r.offen === 0 || fertig.size === 0) break
      }
      setKiText('')
    } catch (e) {
      setKiText('')
      setFehler(e instanceof Error ? e.message : 'Die Einschätzung ließ sich nicht holen.')
    } finally {
      kiLaeuft.current = false
    }
  }, [])

  useEffect(() => {
    if (nutzer.nurLesen || spalteFehlt) return
    const ids = liste.filter((n) => brauchtEinschaetzung(n) && !eingeschaetzt.current.has(n.kunde.id)).map((n) => n.kunde.id)
    if (ids.length === 0) return
    if (aktuell && ids.includes(aktuell.kunde.id)) ids.unshift(...ids.splice(ids.indexOf(aktuell.kunde.id), 1))
    for (const id of ids) eingeschaetzt.current.add(id)
    void schaetzeEin(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [einzelheiten, idsSchluessel, spalteFehlt, nutzer.nurLesen])

  // ---------- Handlungen ----------

  const eintrag = (text: string): ActivityEntry => ({ id: uid('act'), date: today(), text, user: nutzer.name })

  function ausblenden(id: string, an: boolean) {
    setErledigt((alt) => {
      const neu = new Set(alt)
      if (an) neu.add(id)
      else neu.delete(id)
      return neu
    })
  }

  async function rueckgaengigStatus(n: Neuanfrage, vorher: { status: string; verantwortlich: string; followUp: FollowUp }, wvId?: string) {
    const k = n.kunde
    dispatch({
      type: 'UPDATE_KUNDE_IN_BEREICH',
      bereich: n.bereich,
      id: k.id,
      patch: { status: vorher.status, verantwortlich: vorher.verantwortlich, followUp: vorher.followUp, activities: [eintrag(`Sichtung rückgängig gemacht – wieder ${statusLabel(n.bereich, vorher.status)} (durch ${nutzer.name})`), ...k.activities] },
    })
    if (wvId) await loescheWiedervorlage(wvId).catch(() => undefined)
    await merkeEntscheidung(k.id, { art: 'zuruecksetzen' }).catch(() => undefined)
    ausblenden(k.id, false)
    setAktuellId(k.id)
  }

  async function qualifizieren(n: Neuanfrage, opt: { verantwortlich: string; anrufen: string | null }) {
    if (nutzer.nurLesen) return setFehler(NUR_LESEN_MELDUNG)
    const k = n.kunde
    const ziel = zielQualifiziert(n.bereich, k.status)
    const vorher = { status: k.status, verantwortlich: k.verantwortlich, followUp: k.followUp }
    const teile = [ziel !== k.status ? `→ ${statusLabel(n.bereich, ziel)}` : '', opt.verantwortlich && opt.verantwortlich !== k.verantwortlich ? `verantwortlich: ${opt.verantwortlich}` : '']
    const patch: Partial<Kunde> = {
      letzteAktivitaet: today(),
      activities: [eintrag(`Neuanfrage gesichtet: qualifiziert ${teile.filter(Boolean).join(', ')} (durch ${nutzer.name})`.replace('  ', ' ')), ...k.activities],
    }
    if (ziel !== k.status) patch.status = ziel
    if (opt.verantwortlich !== k.verantwortlich) patch.verantwortlich = opt.verantwortlich
    setAktuellId(naechsteNach(k.id))
    ausblenden(k.id, true)
    setDialog(null)
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: n.bereich, id: k.id, patch })
    let wvId: string | undefined
    if (opt.anrufen && n.bereich !== 'privat') {
      try {
        wvId = (await legeWiedervorlageAn({ kundeId: k.id, bereich: n.bereich, titel: 'Anrufen', faellig: opt.anrufen, notiz: 'Aus „Neuanfragen sichten“', verantwortlich: opt.verantwortlich || undefined, von: nutzer.name })).id
      } catch (e) {
        setFehler(`Status gespeichert, aber die Wiedervorlage nicht: ${e instanceof Error ? e.message : 'Fehler'}`)
      }
    }
    try {
      await merkeEntscheidung(k.id, { art: 'qualifiziert', status: ziel })
    } catch (e) {
      // Bleibt der Status gleich (z. B. Erben im Erstkontakt), würde die Akte sonst wieder auftauchen — sagen.
      if (ziel === k.status) setFehler(`Nicht gemerkt: ${e instanceof Error ? e.message : 'Fehler'}`)
    }
    setMeldung({
      text: `${k.firma || k.ansprechpartner}: qualifiziert${ziel !== k.status ? ` → ${statusLabel(n.bereich, ziel)}` : ''}${wvId ? ', Wiedervorlage „Anrufen“ angelegt' : ''}.`,
      rueckgaengig: () => rueckgaengigStatus(n, vorher, wvId),
    })
  }

  async function archivieren(n: Neuanfrage, grund: ArchivGrund, notiz = '') {
    if (nutzer.nurLesen) return setFehler(NUR_LESEN_MELDUNG)
    const k = n.kunde
    const ziel = zielArchiv(n.bereich, grund)
    const vorher = { status: k.status, verantwortlich: k.verantwortlich, followUp: k.followUp }
    const patch: Partial<Kunde> = {
      status: ziel,
      letzteAktivitaet: today(),
      activities: [eintrag(`Neuanfrage gesichtet: archiviert – ${GRUND_TEXT[grund]} → ${statusLabel(n.bereich, ziel)} (durch ${nutzer.name})${notiz.trim() ? `: ${notiz.trim()}` : ''}`), ...k.activities],
    }
    if (k.followUp && !k.followUp.done && (k.followUp.date || k.followUp.note)) patch.followUp = { ...k.followUp, done: true }
    setAktuellId(naechsteNach(k.id))
    ausblenden(k.id, true)
    setDialog(null)
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: n.bereich, id: k.id, patch })
    merkeEntscheidung(k.id, { art: 'archiviert', status: ziel, grund }).catch(() => undefined)
    setMeldung({ text: `${k.firma || k.ansprechpartner}: archiviert (${statusLabel(n.bereich, ziel)}).`, rueckgaengig: () => rueckgaengigStatus(n, vorher) })
  }

  async function spaeter(n: Neuanfrage, bis: string) {
    if (nutzer.nurLesen) return setFehler(NUR_LESEN_MELDUNG)
    const k = n.kunde
    setDialog(null)
    setBeschaeftigt(true)
    try {
      setAktuellId(naechsteNach(k.id))
      ausblenden(k.id, true)
      await merkeEntscheidung(k.id, { art: 'spaeter', bis })
      setMeldung({
        text: `${k.firma || k.ansprechpartner}: zurückgestellt bis ${fmtDate(bis)}.`,
        rueckgaengig: async () => {
          await merkeEntscheidung(k.id, { art: 'zuruecksetzen' })
          ausblenden(k.id, false)
          setAktuellId(k.id)
        },
      })
    } catch (e) {
      ausblenden(k.id, false)
      setFehler(e instanceof Error ? e.message : 'Nicht zurückgestellt.')
    } finally {
      setBeschaeftigt(false)
    }
  }

  async function zusammenfuehren(n: Neuanfrage, partner: DublettenHinweis) {
    if (nutzer.nurLesen) return setFehler(NUR_LESEN_MELDUNG)
    setBeschaeftigt(true)
    setFehler('')
    try {
      const r = (await call({ action: 'dubletten', modus: 'zusammenfuehren', behalte_id: partner.id, entferne_ids: [n.kunde.id] })) as { ok: boolean; ergebnisse?: { text: string }[] }
      if (!r.ok) {
        setFehler(r.ergebnisse?.[0]?.text || 'Nicht zusammengeführt.')
        return
      }
      setAktuellId(naechsteNach(n.kunde.id))
      ausblenden(n.kunde.id, true)
      setDialog(null)
      setMeldung({ text: `${n.kunde.firma || n.kunde.ansprechpartner} in „${partner.firma || partner.ansprechpartner}“ eingearbeitet.` })
      await neuLaden()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Nicht zusammengeführt.')
    } finally {
      setBeschaeftigt(false)
    }
  }

  function akteOeffnen(n: Neuanfrage) {
    const pfad = kundeDetailPfad(n.bereich, n.kunde.id)
    if (istTouch()) navigate(pfad)
    else window.open(`#${pfad}`, '_blank', 'noopener')
  }

  /** „Kein Kunde / Spam“: Grund aus der Einschätzung, wenn sie einen passenden nennt. */
  function grundKeinKunde(n: Neuanfrage): ArchivGrund {
    const g = n.triage.vorschlag?.grund
    return g === 'kein_kundenanliegen' ? 'kein_kundenanliegen' : 'spam'
  }

  // ---------- Tastenkürzel (Rechner) ----------

  useEffect(() => {
    function taste(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const ziel = e.target as HTMLElement | null
      if (ziel && (/^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName) || ziel.isContentEditable)) return
      if (e.key === 'u' || e.key === 'U') {
        if (meldung?.rueckgaengig) {
          e.preventDefault()
          const f = meldung.rueckgaengig
          setMeldung(null)
          void f()
        }
        return
      }
      if (dialog || !aktuell || beschaeftigt) return
      const k = e.key.toLowerCase()
      const dup = einzelheiten[aktuell.kunde.id]?.dubletten[0]
      const aktionen: Record<string, () => void> = {
        q: () => setDialog({ art: 'qualifizieren', n: aktuell }),
        s: () => void archivieren(aktuell, grundKeinKunde(aktuell)),
        n: () => void archivieren(aktuell, 'kein_interesse'),
        l: () => setDialog({ art: 'spaeter', n: aktuell }),
        z: () => dup && setDialog({ art: 'zusammenfuehren', n: aktuell, partner: dup }),
        o: () => akteOeffnen(aktuell),
        j: () => geheZu(1),
        k: () => geheZu(-1),
        arrowright: () => geheZu(1),
        arrowdown: () => geheZu(1),
        arrowleft: () => geheZu(-1),
        arrowup: () => geheZu(-1),
      }
      if (k === 'enter' && ansicht === 'liste') {
        e.preventDefault()
        setAnsicht('karte')
        return
      }
      const f = aktionen[k]
      if (!f) return
      e.preventDefault()
      f()
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  })

  // Meldung nach einer Weile ausblenden.
  useEffect(() => {
    if (!meldung) return
    const t = window.setTimeout(() => setMeldung(null), 9000)
    return () => window.clearTimeout(t)
  }, [meldung])

  // ---------- Oberfläche ----------

  const gesperrt = nutzer.nurLesen || beschaeftigt
  const aktuelleLage = aktuell ? einzelheiten[aktuell.kunde.id] : undefined

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-28 md:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Sparkles size={20} className="text-slate-400" /> Neuanfragen sichten
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {grundmenge.length} offen{zurueckgestellt ? ` · ${zurueckgestellt} zurückgestellt` : ''}{heuteGesichtet ? ` · heute von dir gesichtet: ${heuteGesichtet}` : ''}
          </p>
        </div>
        <div className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 md:flex">
          <UmschaltKnopf aktiv={ansicht === 'karte'} onClick={() => setAnsicht('karte')}><SquareStack size={14} /> Karte</UmschaltKnopf>
          <UmschaltKnopf aktiv={ansicht === 'liste'} onClick={() => setAnsicht('liste')}><LayoutList size={14} /> Liste</UmschaltKnopf>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FilterChip aktiv={!bereichFilter} onClick={() => setBereichFilter('')}>Alle ({grundmenge.length})</FilterChip>
        {jeBereich.map(([b, x]) => (
          <FilterChip key={b} aktiv={bereichFilter === b} onClick={() => setBereichFilter(bereichFilter === b ? '' : b)}>{x.label} ({x.anzahl})</FilterChip>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-slate-500">
          <input type="checkbox" checked={mitZurueckgestellten} onChange={(e) => setMitZurueckgestellten(e.target.checked)} /> Zurückgestellte zeigen
        </label>
        <label className="flex items-center gap-1.5 text-slate-500" title="Akten aus übernommenen Altbeständen (Import, Quirins Ordner) stehen oft in der ersten Stufe, sind aber keine neuen Anfragen.">
          <input type="checkbox" checked={mitAltbestand} onChange={(e) => setMitAltbestand(e.target.checked)} /> Altbestände zeigen
        </label>
      </div>

      {nutzer.nurLesen && <Hinweis farbe="amber">{NUR_LESEN_MELDUNG}</Hinweis>}
      {spalteFehlt && <Hinweis farbe="amber">Die Datenbank kennt das Feld für gesichtete Neuanfragen noch nicht — Entscheidungen und Einschätzungen werden erst nach dem Einspielen gespeichert.</Hinweis>}
      {(fehler || ladeFehler) && (
        <Hinweis farbe="rose">
          {fehler || ladeFehler}{' '}
          <button className="underline" onClick={() => setFehler('')}>ausblenden</button>
        </Hinweis>
      )}
      {kiText && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 size={12} className="animate-spin" /> {kiText}
        </p>
      )}

      {!geladen ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Lade …</Card>
      ) : liste.length === 0 ? (
        <Card className="p-8 text-center">
          <Check size={28} className="mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-medium text-slate-700">Alles gesichtet.</p>
          <p className="mt-1 text-xs text-slate-400">
            {zurueckgestellt ? `${zurueckgestellt} zurückgestellt — sie kommen am gewählten Tag wieder.` : 'Neue Anfragen erscheinen hier, sobald das CRM sie anlegt.'}
          </p>
        </Card>
      ) : ansicht === 'liste' && !istTouch() ? (
        <ListenAnsicht
          liste={liste}
          aktuellId={aktuell?.kunde.id}
          einzelheiten={einzelheiten}
          gesperrt={gesperrt}
          onWaehle={(id) => setAktuellId(id)}
          onOeffne={(id) => {
            setAktuellId(id)
            setAnsicht('karte')
          }}
          onQualifizieren={(n) => setDialog({ art: 'qualifizieren', n })}
          onKeinKunde={(n) => void archivieren(n, grundKeinKunde(n))}
          onSpaeter={(n) => setDialog({ art: 'spaeter', n })}
        />
      ) : aktuell ? (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <button onClick={() => geheZu(-1)} disabled={index === 0} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-30">
              <ArrowLeft size={14} /> zurück
            </button>
            <span>{index + 1} von {liste.length}</span>
            <button onClick={() => geheZu(1)} disabled={index >= liste.length - 1} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-30">
              weiter <ArrowRight size={14} />
            </button>
          </div>
          <Karte
            key={aktuell.kunde.id}
            n={aktuell}
            lage={aktuelleLage}
            darfZusammenfuehren={darfZusammenfuehren}
            onNeuEinschaetzen={() => void schaetzeEin([aktuell.kunde.id], true)}
            onZusammenfuehren={(partner) => setDialog({ art: 'zusammenfuehren', n: aktuell, partner })}
            onAkte={() => akteOeffnen(aktuell)}
            onWischen={(richtung) => {
              if (gesperrt) return
              if (richtung === 'rechts') setDialog({ art: 'qualifizieren', n: aktuell })
              if (richtung === 'links') setDialog({ art: 'archivieren', n: aktuell })
            }}
          />
          <Aktionsleiste
            n={aktuell}
            dublette={aktuelleLage?.dubletten[0]}
            gesperrt={gesperrt}
            onQualifizieren={() => setDialog({ art: 'qualifizieren', n: aktuell })}
            onKeinKunde={() => void archivieren(aktuell, grundKeinKunde(aktuell))}
            onKeinInteresse={() => void archivieren(aktuell, 'kein_interesse')}
            onSpaeter={() => setDialog({ art: 'spaeter', n: aktuell })}
            onZusammenfuehren={(partner) => setDialog({ art: 'zusammenfuehren', n: aktuell, partner })}
            onAkte={() => akteOeffnen(aktuell)}
          />
          <p className="hidden text-center text-[11px] text-slate-400 md:block">
            Tasten: Q qualifiziert · S kein Kunde/Spam · N kein Interesse · L später · Z zusammenführen · O Akte öffnen · J/K oder Pfeile blättern · U rückgängig
          </p>
          <p className="text-center text-[11px] text-slate-400 md:hidden">Wischen: rechts = qualifiziert · links = archivieren</p>
        </>
      ) : null}

      {dialog?.art === 'qualifizieren' && (
        <QualifizierenDialog
          n={dialog.n}
          nutzerName={nutzer.name}
          onClose={() => setDialog(null)}
          onOk={(opt) => void qualifizieren(dialog.n, opt)}
        />
      )}
      {dialog?.art === 'archivieren' && (
        <ArchivDialog n={dialog.n} onClose={() => setDialog(null)} onOk={(grund, notiz) => void archivieren(dialog.n, grund, notiz)} />
      )}
      {dialog?.art === 'spaeter' && <SpaeterDialog n={dialog.n} onClose={() => setDialog(null)} onOk={(bis) => void spaeter(dialog.n, bis)} />}
      {dialog?.art === 'zusammenfuehren' && (
        <ZusammenfuehrenDialog
          n={dialog.n}
          partner={dialog.partner}
          darf={darfZusammenfuehren}
          laeuft={beschaeftigt}
          onClose={() => setDialog(null)}
          onOk={() => void zusammenfuehren(dialog.n, dialog.partner)}
          onDubletten={() => navigate('/dubletten')}
        />
      )}

      {meldung && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 md:bottom-6">
          <div className="flex max-w-xl items-center gap-3 rounded-xl bg-slate-800 px-4 py-2.5 text-sm text-white shadow-lg">
            <span className="min-w-0 flex-1">{meldung.text}</span>
            {meldung.rueckgaengig && (
              <button
                onClick={() => {
                  const f = meldung.rueckgaengig!
                  setMeldung(null)
                  void f().catch((e) => setFehler(e instanceof Error ? e.message : 'Rückgängig ging nicht.'))
                }}
                className="flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-medium hover:bg-white/20"
              >
                <Undo2 size={12} /> Rückgängig
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Bausteine ----------

function UmschaltKnopf({ aktiv, onClick, children }: { aktiv: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${aktiv ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

function FilterChip({ aktiv, onClick, children }: { aktiv: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-1 ${aktiv ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

function Hinweis({ farbe, children }: { farbe: 'amber' | 'rose'; children: ReactNode }) {
  const c = farbe === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-700'
  return <div className={`rounded-lg border px-3 py-2 text-xs ${c}`}>{children}</div>
}

function VorschlagChip({ n }: { n: Neuanfrage }) {
  const v = n.triage.vorschlag
  if (!v) return null
  const farbe = v.aktion === 'qualifizieren' ? 'bg-emerald-100 text-emerald-800' : v.aktion === 'archivieren' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
  const text = v.aktion === 'qualifizieren' ? 'echte Anfrage' : v.aktion === 'archivieren' ? (v.grund === 'spam' ? 'Spam' : v.grund === 'kein_interesse' ? 'kein Interesse' : 'kein Kunde') : 'unklar'
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${farbe}`}>{text}</span>
}

function Karte({
  n, lage, darfZusammenfuehren, onNeuEinschaetzen, onZusammenfuehren, onAkte, onWischen,
}: {
  n: Neuanfrage
  lage?: AkteLage
  darfZusammenfuehren: boolean
  onNeuEinschaetzen: () => void
  onZusammenfuehren: (p: DublettenHinweis) => void
  onAkte: () => void
  onWischen: (richtung: 'links' | 'rechts') => void
}) {
  const k = n.kunde
  const v = n.triage.vorschlag
  const start = useRef<{ x: number; y: number } | null>(null)
  const [versatz, setVersatz] = useState(0)
  const ersterEintrag = [...(k.activities ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]
  const doks = k.dokumente ?? []

  return (
    <div
      onTouchStart={(e) => (start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchMove={(e) => {
        if (!start.current) return
        const dx = e.touches[0].clientX - start.current.x
        const dy = e.touches[0].clientY - start.current.y
        // Nur waagerecht — senkrecht ist Blättern der Seite.
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) setVersatz(dx)
        else if (Math.abs(dy) > 12 && versatz === 0) start.current = null
      }}
      onTouchEnd={() => {
        const x = versatz
        start.current = null
        setVersatz(0)
        if (x > 90) onWischen('rechts')
        else if (x < -90) onWischen('links')
      }}
      style={{ transform: versatz ? `translateX(${versatz}px) rotate(${versatz / 40}deg)` : undefined, transition: versatz ? 'none' : 'transform 150ms', touchAction: 'pan-y' }}
      className="relative"
    >
      {versatz > 40 && <WischMarke className="left-3 bg-emerald-600">qualifiziert</WischMarke>}
      {versatz < -40 && <WischMarke className="right-3 bg-rose-600">archivieren</WischMarke>}
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-800">{k.firma || k.ansprechpartner || '(ohne Namen)'}</h2>
            {k.ansprechpartner && k.ansprechpartner !== k.firma && <p className="text-sm text-slate-600">{k.ansprechpartner}</p>}
            <p className="mt-1 text-xs text-slate-400">
              {n.bereichLabel} · {statusLabel(n.bereich, k.status)} · angelegt {n.angelegt ? `${fmtDate(n.angelegt)} (${vorDays(n.angelegt)})` : 'unbekannt'} · {HERKUNFT_TEXT[n.herkunft]}
              {k.verantwortlich ? ` · verantwortlich: ${k.verantwortlich}` : ''}
              {n.lage === 'zurueckgestellt' && n.triage.spaeter ? ` · zurückgestellt bis ${fmtDate(n.triage.spaeter.bis)}` : ''}
            </p>
          </div>
          <button onClick={onAkte} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
            <ExternalLink size={13} /> Akte
          </button>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {k.email && <a href={`mailto:${k.email}`} className="flex items-center gap-1 text-slate-600 hover:underline"><Mail size={13} className="text-slate-400" /> {k.email}</a>}
          {k.telefon && <a href={`tel:${k.telefon.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 text-slate-600 hover:underline"><Phone size={13} className="text-slate-400" /> {k.telefon}</a>}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs font-medium text-slate-500"><Sparkles size={12} /> Einschätzung des Assistenten</span>
            <button onClick={onNeuEinschaetzen} title="Neu einschätzen" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"><RefreshCw size={12} /></button>
          </div>
          {v ? (
            <>
              <p className="text-sm text-slate-800">{v.satz}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <VorschlagChip n={n} /> Vorschlag: {AKTION_TEXT[v.aktion]}
                {v.bereichVorschlag && <span className="text-amber-700">· passt eher zu: {BEREICH_LABEL[v.bereichVorschlag] ?? v.bereichVorschlag}</span>}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400">{lage ? 'Wird eingeschätzt …' : 'Kommt gleich …'}</p>
          )}
        </div>

        {lage?.dubletten.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-amber-800">Mögliche Dublette</p>
            {lage.dubletten.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                <span className="min-w-0 text-amber-900">
                  <strong>{d.firma || d.ansprechpartner}</strong> · {d.bereichName} · {statusLabel(d.bereich, d.status)}
                  <span className="block text-xs text-amber-700">{d.gruende.join(', ')}</span>
                </span>
                <span className="flex gap-1">
                  <a href={`#${kundeDetailPfad(d.bereich, d.id)}`} target="_blank" rel="noopener" className="rounded px-2 py-1 text-xs text-amber-800 hover:bg-amber-100">ansehen</a>
                  {darfZusammenfuehren && (
                    <button onClick={() => onZusammenfuehren(d)} className="flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">
                      <Merge size={12} /> zusammenführen
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><Mail size={12} /> Erste Mail</p>
          {!lage ? (
            <p className="text-sm text-slate-400">Lade …</p>
          ) : lage.ersteMail ? (
            <div className="text-sm">
              <p className="font-medium text-slate-800">{lage.ersteMail.betreff || '(ohne Betreff)'}</p>
              <p className="text-xs text-slate-400">{fmtDate(lage.ersteMail.datum)} · {lage.ersteMail.vonName || lage.ersteMail.von}</p>
              <p className="mt-1 whitespace-pre-line text-slate-600">{lage.ersteMail.ausschnitt}</p>
              {lage.mails > 1 && (
                <p className="mt-1 text-xs text-slate-400">
                  {lage.mails - 1} weitere {lage.mails === 2 ? 'Mail' : 'Mails'}{lage.letzteMail ? `, zuletzt ${fmtDate(lage.letzteMail.datum)}: ${lage.letzteMail.betreff}` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Keine Mail im gemeinsamen Postfach.</p>
          )}
        </div>

        {ersterEintrag && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Erster Eintrag im Verlauf</p>
            <p className="text-sm text-slate-600">{ersterEintrag.text}</p>
          </div>
        )}
        {k.sachverhalt && (
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Sachverhalt</p>
            <p className="text-sm text-slate-600">{k.sachverhalt}</p>
          </div>
        )}
        {doks.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><FileText size={12} /> Dokumente ({doks.length})</p>
            <ul className="text-sm text-slate-600">
              {doks.slice(0, 4).map((d) => <li key={d.id} className="truncate">{d.name}</li>)}
              {doks.length > 4 && <li className="text-xs text-slate-400">und {doks.length - 4} weitere</li>}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}

const BEREICH_LABEL: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  immobilienkunden: 'Immobilien',
}

function WischMarke({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`pointer-events-none absolute top-3 z-10 rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wide text-white ${className}`}>{children}</span>
}

function Aktionsleiste({
  n, dublette, gesperrt, onQualifizieren, onKeinKunde, onKeinInteresse, onSpaeter, onZusammenfuehren, onAkte,
}: {
  n: Neuanfrage
  dublette?: DublettenHinweis
  gesperrt: boolean
  onQualifizieren: () => void
  onKeinKunde: () => void
  onKeinInteresse: () => void
  onSpaeter: () => void
  onZusammenfuehren: (p: DublettenHinweis) => void
  onAkte: () => void
}) {
  const v = n.triage.vorschlag
  const betont = (aktion: 'qualifizieren' | 'archivieren') => (v?.aktion === aktion ? 'ring-2 ring-offset-1 ring-sky-400' : '')
  const ziel = zielQualifiziert(n.bereich, n.kunde.status)
  const qualiText = ziel !== n.kunde.status ? `Qualifiziert → ${statusLabel(n.bereich, ziel)}` : 'Qualifiziert'
  return (
    <div className="sticky bottom-0 z-30 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-xl md:border md:p-3">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        <button disabled={gesperrt} onClick={onQualifizieren} className={`col-span-2 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 md:col-span-1 md:py-2.5 ${betont('qualifizieren')}`}>
          <Check size={16} /> {qualiText} <Kbd>Q</Kbd>
        </button>
        <button disabled={gesperrt} onClick={onKeinKunde} className={`flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 md:py-2.5 ${v?.aktion === 'archivieren' && v.grund !== 'kein_interesse' ? betont('archivieren') : ''}`}>
          <XCircle size={16} /> Kein Kunde / Spam <Kbd>S</Kbd>
        </button>
        <button disabled={gesperrt} onClick={onKeinInteresse} className={`flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 md:py-2.5 ${v?.aktion === 'archivieren' && v.grund === 'kein_interesse' ? betont('archivieren') : ''}`}>
          <Archive size={16} /> Kein Interesse <Kbd>N</Kbd>
        </button>
        <button disabled={gesperrt} onClick={onSpaeter} className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 md:py-2.5">
          <CalendarClock size={16} /> Später <Kbd>L</Kbd>
        </button>
        {dublette ? (
          <button disabled={gesperrt} onClick={() => onZusammenfuehren(dublette)} className="flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 md:py-2.5">
            <Merge size={16} /> Zusammenführen … <Kbd>Z</Kbd>
          </button>
        ) : (
          <button onClick={onAkte} className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 md:py-2.5">
            <ExternalLink size={16} /> Akte öffnen <Kbd>O</Kbd>
          </button>
        )}
      </div>
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="hidden rounded border border-current/30 px-1 text-[10px] font-normal opacity-70 md:inline">{children}</kbd>
}

function ListenAnsicht({
  liste, aktuellId, einzelheiten, gesperrt, onWaehle, onOeffne, onQualifizieren, onKeinKunde, onSpaeter,
}: {
  liste: Neuanfrage[]
  aktuellId?: string
  einzelheiten: Record<string, AkteLage>
  gesperrt: boolean
  onWaehle: (id: string) => void
  onOeffne: (id: string) => void
  onQualifizieren: (n: Neuanfrage) => void
  onKeinKunde: (n: Neuanfrage) => void
  onSpaeter: (n: Neuanfrage) => void
}) {
  const aktiveZeile = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => aktiveZeile.current?.scrollIntoView({ block: 'nearest' }), [aktuellId])
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-100 text-xs text-slate-400">
          <tr>
            <th className="px-3 py-2 font-semibold">Wer</th>
            <th className="px-3 py-2 font-semibold">Bereich</th>
            <th className="px-3 py-2 font-semibold">Angelegt</th>
            <th className="px-3 py-2 font-semibold">Einschätzung</th>
            <th className="px-3 py-2 font-semibold">Erste Mail</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {liste.map((n) => {
            const e = einzelheiten[n.kunde.id]
            const aktiv = n.kunde.id === aktuellId
            return (
              <tr
                key={n.kunde.id}
                ref={aktiv ? aktiveZeile : undefined}
                onClick={() => onWaehle(n.kunde.id)}
                onDoubleClick={() => onOeffne(n.kunde.id)}
                className={`cursor-pointer border-b border-slate-50 align-top ${aktiv ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
              >
                <td className="max-w-[200px] px-3 py-2">
                  <span className="block truncate font-medium text-slate-800">{n.kunde.firma || n.kunde.ansprechpartner}</span>
                  <span className="block truncate text-xs text-slate-400">{n.kunde.ansprechpartner !== n.kunde.firma ? n.kunde.ansprechpartner : n.kunde.email}</span>
                  {e?.dubletten.length ? <span className="text-[11px] text-amber-700">mögliche Dublette</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{n.bereichLabel}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                  {n.angelegt ? fmtDate(n.angelegt) : '–'}
                  <span className="block text-slate-400">{HERKUNFT_TEXT[n.herkunft]}</span>
                </td>
                <td className="max-w-[300px] px-3 py-2 text-xs text-slate-700">
                  <div className="flex items-start gap-1.5"><VorschlagChip n={n} /> <span className="line-clamp-2">{n.triage.vorschlag?.satz ?? <span className="text-slate-300">…</span>}</span></div>
                </td>
                <td className="max-w-[240px] px-3 py-2 text-xs text-slate-600">
                  <span className="line-clamp-2">{e ? (e.ersteMail?.betreff || (e.ersteMail ? '(ohne Betreff)' : '–')) : '…'}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className="inline-flex gap-1" onClick={(ev) => ev.stopPropagation()}>
                    <IconKnopf titel="Qualifiziert (Q)" disabled={gesperrt} onClick={() => onQualifizieren(n)} className="text-emerald-700 hover:bg-emerald-50"><Check size={15} /></IconKnopf>
                    <IconKnopf titel="Kein Kunde / Spam (S)" disabled={gesperrt} onClick={() => onKeinKunde(n)} className="text-rose-700 hover:bg-rose-50"><XCircle size={15} /></IconKnopf>
                    <IconKnopf titel="Später (L)" disabled={gesperrt} onClick={() => onSpaeter(n)} className="text-slate-600 hover:bg-slate-100"><CalendarClock size={15} /></IconKnopf>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function IconKnopf({ titel, onClick, disabled, className, children }: { titel: string; onClick: () => void; disabled?: boolean; className: string; children: ReactNode }) {
  return (
    <button title={titel} aria-label={titel} disabled={disabled} onClick={onClick} className={`rounded-md p-1.5 disabled:opacity-40 ${className}`}>
      {children}
    </button>
  )
}

// ---------- Dialoge ----------

function QualifizierenDialog({ n, nutzerName, onClose, onOk }: { n: Neuanfrage; nutzerName: string; onClose: () => void; onOk: (opt: { verantwortlich: string; anrufen: string | null }) => void }) {
  const k = n.kunde
  const [verantwortlich, setVerantwortlich] = useState(k.verantwortlich || nutzerName)
  const [mitAnruf, setMitAnruf] = useState(lies(SPEICHER_ANRUFEN) === 'ja')
  const [datum, setDatum] = useState(naechsterWerktag())
  const ziel = zielQualifiziert(n.bereich, k.status)
  const namen = [...new Set([...MITARBEITER, nutzerName, k.verantwortlich].filter(Boolean))].sort()
  return (
    <Modal open onClose={onClose} title={`Qualifiziert: ${k.firma || k.ansprechpartner}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          schreibe(SPEICHER_ANRUFEN, mitAnruf ? 'ja' : 'nein')
          onOk({ verantwortlich, anrufen: mitAnruf && datum > today() ? datum : mitAnruf ? naechsterWerktag() : null })
        }}
        className="space-y-3"
      >
        <p className="text-sm text-slate-600">
          {ziel !== k.status
            ? <>Stand wird <strong>{statusLabel(n.bereich, ziel)}</strong>. Für den neuen Stand legt das CRM die übliche Wiedervorlage selbst an.</>
            : <>Der Stand bleibt <strong>{statusLabel(n.bereich, ziel)}</strong>; die Akte gilt als gesichtet.</>}
        </p>
        <label className="block">
          <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500"><UserRound size={12} /> Verantwortlich</span>
          <select value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)} className={inputClass}>
            <option value="">– niemand –</option>
            {namen.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={mitAnruf} onChange={(e) => setMitAnruf(e.target.checked)} /> Zusätzlich Wiedervorlage „Anrufen“ am
          <input type="date" value={datum} min={addDays(today(), 1)} onChange={(e) => setDatum(e.target.value)} disabled={!mitAnruf} className="rounded-md border border-slate-200 px-2 py-1 text-sm disabled:opacity-50" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <button type="submit" autoFocus className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-700">
            <Check size={14} /> Speichern (Enter)
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ArchivDialog({ n, onClose, onOk }: { n: Neuanfrage; onClose: () => void; onOk: (grund: ArchivGrund, notiz: string) => void }) {
  const [notiz, setNotiz] = useState('')
  const vorschlag = n.triage.vorschlag?.grund
  const gruende: ArchivGrund[] = ['spam', 'kein_kundenanliegen', 'kein_interesse']
  return (
    <Modal open onClose={onClose} title={`Archivieren: ${n.kunde.firma || n.kunde.ansprechpartner}`}>
      <div className="space-y-3">
        <input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz für den Verlauf (freiwillig)" className={inputClass} />
        <div className="grid gap-2">
          {gruende.map((g) => (
            <button
              key={g}
              onClick={() => onOk(g, notiz)}
              className={`rounded-lg border px-4 py-3 text-left text-sm font-medium ${g === vorschlag ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              {GRUND_TEXT[g]}
              <span className="block text-xs font-normal text-slate-500">Stand danach: {statusLabel(n.bereich, zielArchiv(n.bereich, g))}{g === vorschlag ? ' · Vorschlag des Assistenten' : ''}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function SpaeterDialog({ n, onClose, onOk }: { n: Neuanfrage; onClose: () => void; onOk: (bis: string) => void }) {
  const heute = today()
  const [datum, setDatum] = useState(addDays(heute, 7))
  const vorgaben: [string, string][] = [['Morgen', addDays(heute, 1)], ['Nächste Woche', addDays(heute, 7)], ['In einem Monat', addDays(heute, 30)]]
  useEffect(() => {
    function taste(e: KeyboardEvent) {
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0 && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        onOk(vorgaben[i][1])
      }
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  })
  return (
    <Modal open onClose={onClose} title={`Später: ${n.kunde.firma || n.kunde.ansprechpartner}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {vorgaben.map(([text, bis], i) => (
            <button key={text} onClick={() => onOk(bis)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {text}
              <span className="block text-xs font-normal text-slate-400">{fmtDate(bis)} <span className="hidden md:inline">· Taste {i + 1}</span></span>
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (datum > heute) onOk(datum) }} className="flex items-center gap-2">
          <input type="date" value={datum} min={addDays(heute, 1)} onChange={(e) => setDatum(e.target.value)} className={inputClass} />
          <PrimaryButton type="submit" disabled={!(datum > heute)}>Zurückstellen</PrimaryButton>
        </form>
        <p className="text-xs text-slate-400">Bis dahin taucht die Anfrage hier nicht auf; an dem Tag ist sie wieder dabei.</p>
      </div>
    </Modal>
  )
}

function ZusammenfuehrenDialog({
  n, partner, darf, laeuft, onClose, onOk, onDubletten,
}: { n: Neuanfrage; partner: DublettenHinweis; darf: boolean; laeuft: boolean; onClose: () => void; onOk: () => void; onDubletten: () => void }) {
  const andererBereich = partner.bereich !== n.bereich
  return (
    <Modal open onClose={onClose} title="Zusammenführen">
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          Die Neuanfrage <strong>{n.kunde.firma || n.kunde.ansprechpartner}</strong> wird in die Akte <strong>{partner.firma || partner.ansprechpartner}</strong> ({partner.bereichName},{' '}
          {statusLabel(partner.bereich, partner.status)}) eingearbeitet: Verlauf, Dokumente, Mails und Wiedervorlagen wandern mit, danach wird die Neuanfrage gelöscht.
        </p>
        <p className="text-xs text-slate-500">Hinweise: {partner.gruende.join(', ')}</p>
        {!darf ? (
          <Hinweis farbe="amber">Zusammenführen darf nur die Geschäftsführung oder ein Admin. Öffne die andere Akte oder sag Bescheid.</Hinweis>
        ) : andererBereich ? (
          <Hinweis farbe="amber">
            Die Akten liegen in verschiedenen Bereichen. Erst auf der Seite „Dubletten“ den Bereich wechseln, dann zusammenführen.{' '}
            <button onClick={onDubletten} className="underline">Zur Seite Dubletten</button>
          </Hinweis>
        ) : null}
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={onOk} disabled={!darf || andererBereich || laeuft}>
            {laeuft ? <Loader2 size={14} className="animate-spin" /> : <Merge size={14} />} Zusammenführen
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  )
}
