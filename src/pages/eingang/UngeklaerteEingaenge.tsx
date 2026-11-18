import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CheckCircle2, ChevronDown, ExternalLink, File as FileIcon, FileText, History, Home, Image as ImageIcon, RefreshCw, Search, Trash2, TriangleAlert, Undo2, X } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { KUNDEN_BEREICHE, kundeBereichLabel, kundeDetailPfad } from '../../data/kundenBereiche'
import { AKTE_INTERN, AKTE_UNGEKLAERT, istSammelakte } from '../../data/sammelakten'
import { MITARBEITER } from '../../data/constants'
import { fmtDate, fmtDateTime } from '../../lib/dates'
import { brauchtDateiLink, holeAnhangUrl, holeDokumentInhalte } from '../../lib/emailGateway'
import { ladeLetzteAblagen, ladeUngeklaerteEingaenge, legeEingaengeAb, macheAblageRueckgaengig, nimmEingaengeHeraus, type AblageErgebnis, type AblageProtokoll, type AblageZiel } from '../../lib/eingang'
import { erzeugeKundenDownloadUrl } from '../../lib/kundenDokumenteStorage'
import { DOKUMENT_ORDNER, type ActivityEntry, type Dokument, type DokumentOrdnerName, type KundeBereich } from '../../types'

// ---------- Ziele (Kunden aller Bereiche und Objekte) ----------

type Kandidat =
  | { art: 'kunde'; id: string; bereich: KundeBereich; name: string; zusatz: string; suchtext: string }
  | { art: 'objekt'; id: string; name: string; zusatz: string; suchtext: string }

type Wahl = { kandidat: Kandidat; ordner: DokumentOrdnerName }

type Sammelakte = { dokumente: Dokument[]; activities: ActivityEntry[] }

type Meldung = {
  art: 'erfolg' | 'fehler'
  titel: string
  zeilen: string[]
  link?: { zu: string; text: string }
  /** Knopf „Rückgängig" direkt nach dem Ablegen. */
  rueckgaengig?: string
}

type ZielStand = AblageErgebnis['ziel']

const SAMMEL_BEREICH: KundeBereich = 'beratung' // die Sammelakte liegt in der Liste der Unternehmensberatung
const AUFFANG_ORDNER: DokumentOrdnerName = 'Sonstiges'

function normal(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function woerter(text: string): string[] {
  return normal(text).split(/[^a-z0-9]+/).filter(Boolean)
}

function kundenName(k: { firma: string; ansprechpartner: string }): string {
  const firma = (k.firma ?? '').trim()
  const person = (k.ansprechpartner ?? '').trim()
  if (firma && person && person !== firma) return `${firma} (${person})`
  return firma || person || 'Ohne Namen'
}

function kennung(k: Kandidat): string {
  return `${k.art}:${k.id}`
}

// ---------- Vorschläge: Wörter aus Dateiname und Kurzfassung gegen Kunden- und Objektnamen ----------
//
// Ohne KI und bewusst zurückhaltend — kein Vorschlag ist besser als ein falscher. Es zählen nur Wörter,
// die etwas über das Ziel sagen: keine Rechtsformen, keine Dokumentarten, keine Wörter mit Ziffern, und
// nichts, was bei mehr als drei Kunden oder Objekten vorkommt.

const ALLERWELTSWOERTER = new Set(
  `gmbh mbh ohg gbr holding gruppe group firma gesellschaft verwaltung verwaltungs immobilien immobilie beratung
  kanzlei service services consulting management invest partner haus wohnung grundstueck gewerbe objekt objekte
  mehrfamilienhaus einfamilienhaus neubau neubauprojekt strasse platz gasse allee ring rechnung rechnungen scan scans
  scanned dokument dokumente document datei dateien vertrag vertraege angebot angebote brief schreiben kopie anlage
  anlagen anhang seite seiten foto fotos bild bilder image images photo photos screenshot bildschirmfoto whatsapp
  telegram signal jpeg heic docx xlsx final entwurf version unterlagen unterlage eingang sonstiges herr frau herrn
  familie eheleute januar februar maerz april juni juli august september oktober november dezember montag dienstag
  mittwoch donnerstag freitag samstag sonntag auftrag bestellung lieferschein mahnung bescheid antrag formular
  vollmacht protokoll notiz liste uebersicht deutschland germany nord sued west mitte stadt kreis bank sparkasse
  versicherung finanzamt notar steuerberater kunde kunden mandant privat intern unbekannt ohne name namen`.split(/\s+/),
)

// Häufige Vornamen sagen allein nichts — sie zählen nur zusammen mit einem zweiten Treffer.
const VORNAMEN = new Set(
  `andreas michael thomas stefan stephan christian peter martin klaus hans wolfgang juergen frank markus marcus
  alexander daniel matthias mathias joachim josef joseph johann johannes manfred helmut werner gerhard dieter bernd
  ralf rolf karl heinz walter guenter guenther horst tobias florian sebastian patrick oliver christoph robert
  richard georg erwin erich ernst franz friedrich fritz hermann herbert kurt otto paul rainer reiner rudolf simon
  timo ulrich volker anna maria sabine petra monika andrea claudia susanne ursula karin birgit nicole stefanie
  stephanie christina christine julia katharina elisabeth renate heike gabriele martina angelika brigitte barbara
  nadja evelyn sandra melanie daniela silvia sylvia ingrid helga erika gisela anja tanja kerstin simone`.split(/\s+/),
)

function brauchbar(wort: string): boolean {
  return wort.length >= 4 && /^[a-z]+$/.test(wort) && !ALLERWELTSWOERTER.has(wort)
}

type Merkmale = { kandidat: Kandidat; stark: string[]; schwach: string[] }

function merkmaleAus(kandidat: Kandidat, starkText: string, weitererText: string, sperre: Set<string>): Merkmale {
  const stark = new Set<string>()
  const schwach = new Set<string>()
  for (const w of woerter(starkText)) if (brauchbar(w) && !sperre.has(w)) (VORNAMEN.has(w) ? schwach : stark).add(w)
  // Bei einer Person ist der Nachname (letztes Wort) aussagekräftig, der Rest nur ergänzend.
  const person = woerter(weitererText).filter((w) => brauchbar(w) && !sperre.has(w))
  person.forEach((w, i) => {
    if (stark.has(w)) return
    if (i === person.length - 1 && !VORNAMEN.has(w)) stark.add(w)
    else schwach.add(w)
  })
  return { kandidat, stark: [...stark], schwach: [...schwach].filter((w) => !stark.has(w)) }
}

function vorschlaegeFuer(dateiname: string, kurzfassung: string, merkmale: Merkmale[], haeufigkeit: Map<string, number>): Kandidat[] {
  const ohneEndung = dateiname.replace(/\.[A-Za-z0-9]{2,5}$/, '')
  const imNamen = new Set(woerter(ohneEndung))
  const namenAmStueck = normal(ohneEndung).replace(/[^a-z0-9]+/g, '')
  const imText = new Set(woerter(kurzfassung))
  const stehtImNamen = (w: string) => imNamen.has(w) || (w.length >= 6 && namenAmStueck.includes(w))

  const bewertet: { kandidat: Kandidat; punkte: number }[] = []
  for (const m of merkmale) {
    let punkte = 0
    let nameTreffer = 0
    let starkImNamen = 0
    let textTreffer = 0
    let starkImText = 0
    let eindeutigImText = false
    const pruefe = (w: string, stark: boolean) => {
      const wieOft = haeufigkeit.get(w) ?? 0
      if (wieOft > 3) return
      if (stehtImNamen(w)) {
        nameTreffer++
        if (stark) starkImNamen++
        punkte += stark ? 4 : 2
      } else if (imText.has(w)) {
        textTreffer++
        if (stark) starkImText++
        if (stark && w.length >= 8 && wieOft === 1) eindeutigImText = true
        punkte += stark ? 2 : 1
      }
    }
    m.stark.forEach((w) => pruefe(w, true))
    m.schwach.forEach((w) => pruefe(w, false))
    const passt = starkImNamen >= 1 || nameTreffer >= 2 || (nameTreffer >= 1 && textTreffer >= 1) || (textTreffer >= 2 && starkImText >= 1) || eindeutigImText
    if (passt) bewertet.push({ kandidat: m.kandidat, punkte })
  }
  if (bewertet.length === 0) return []
  bewertet.sort((a, b) => b.punkte - a.punkte)
  const beste = bewertet[0].punkte
  // Drei oder mehr gleich gute Treffer: das Wort unterscheidet nicht — lieber nichts vorschlagen.
  if (bewertet.filter((b) => b.punkte === beste).length > 2) return []
  return bewertet.filter((b) => b.punkte >= beste * 0.6).slice(0, 2).map((b) => b.kandidat)
}

// Welcher Ordner der Objektakte passt zum Dateinamen? Dieselben Regeln wie beim Zuordnen einer Mail
// zu einem Objekt (supabase/functions/email-gateway/objektMail.ts); der erste Treffer gewinnt.
const ORDNER_REGELN: [RegExp, DokumentOrdnerName][] = [
  [/grundbuch/i, 'Grundbuch'],
  [/grundriss/i, 'Grundrisse'],
  [/flurkarte/i, 'Flurkarte'],
  [/lageplan/i, 'Lageplan'],
  [/energieausweis/i, 'Energieausweis'],
  [/teilungserkl/i, 'Teilungserklärung'],
  [/mietvertr/i, 'Mietverträge'],
  [/mieterliste|mietaufstellung/i, 'Mieterliste'],
  [/expos/i, 'Exposé'],
  [/gutachten|wertermittlung|bewertung/i, 'Gutachten'],
  [/kaufvertrag|notar/i, 'Notarielle Dokumente'],
  [/vertrag|vollmacht/i, 'Verträge'],
]

function ordnerFuer(d: Dokument): DokumentOrdnerName {
  for (const [muster, ordner] of ORDNER_REGELN) if (muster.test(d.name)) return ordner
  return (d.typ ?? '').toLowerCase().startsWith('image/') ? 'Bilder' : AUFFANG_ORDNER
}

// ---------- Kleine Helfer für die Anzeige ----------

function aufzaehlung(namen: string[], hoechstens = 6): string {
  const gezeigt = namen.slice(0, hoechstens).map((n) => `„${n}“`).join(', ')
  const rest = namen.length - hoechstens
  return rest > 0 ? `${gezeigt} und ${rest} weitere` : gezeigt
}

function dateienText(anzahl: number): string {
  return anzahl === 1 ? '1 Datei' : `${anzahl} Dateien`
}

/** Die Zeile aus dem Verlauf der Sammelakte, die diese Datei nennt — ohne die Liste der übrigen Dateinamen. */
function eingangsHinweis(d: Dokument, activities: ActivityEntry[]): { text: string; datum: string; art?: string } | null {
  const name = (d.name ?? '').trim()
  if (!name) return null
  const eintrag = activities.find((a) => typeof a?.text === 'string' && a.text.includes(name))
  if (!eintrag) return null
  const teile = eintrag.text.match(/^([\s\S]*?):\s*„[\s\S]*["“”]([\s\S]*)$/)
  const text = teile ? `${teile[1].trim()}${teile[2].trim() ? ` ${teile[2].trim()}` : ''}` : eintrag.text
  // Der Assistent vermerkt hinter dem Namen manchmal, was für ein Schriftstück es ist („Name — Art").
  const stelle = eintrag.text.indexOf(`„${name} — `)
  const art = stelle >= 0 ? eintrag.text.slice(stelle + name.length + 4).split(/["“”]/)[0].trim() : ''
  return { text: text.length > 260 ? `${text.slice(0, 260)} …` : text, datum: eintrag.date, art: art || undefined }
}

function DateiZeichen({ typ }: { typ: string }) {
  const t = (typ ?? '').toLowerCase()
  if (t.startsWith('image/')) return <ImageIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
  if (t.includes('pdf') || t.startsWith('text/')) return <FileText size={16} className="mt-0.5 shrink-0 text-slate-400" />
  return <FileIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
}

function ZielZeichen({ kandidat }: { kandidat: Kandidat }) {
  return kandidat.art === 'objekt' ? <Home size={14} className="shrink-0 text-slate-400" /> : <Building2 size={14} className="shrink-0 text-slate-400" />
}

// ---------- Zielauswahl: Suchfeld über Kunden aller Bereiche und Objekte, bei Objekten mit Ordner ----------

function ZielWahl({
  kandidaten,
  wert,
  onChange,
  ordnerVorgabe,
  gesperrt,
  beschriftung,
}: {
  kandidaten: Kandidat[]
  wert: Wahl | null
  onChange: (wahl: Wahl | null) => void
  ordnerVorgabe: DokumentOrdnerName
  gesperrt: boolean
  beschriftung: string
}) {
  const [text, setText] = useState('')
  const begriffe = useMemo(() => woerter(text), [text])
  const treffer = useMemo(() => {
    if (text.trim().length < 2 || begriffe.length === 0) return []
    const erster = begriffe[0]
    return kandidaten
      .filter((k) => begriffe.every((b) => k.suchtext.includes(b)))
      .sort((a, b) => Number(normal(b.name).startsWith(erster)) - Number(normal(a.name).startsWith(erster)))
  }, [kandidaten, begriffe, text])
  const GRENZE = 8

  if (wert) {
    return (
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-sm text-slate-800">
          <ZielZeichen kandidat={wert.kandidat} />
          <span className="min-w-0 break-words">
            {wert.kandidat.name}
            {wert.kandidat.zusatz && <span className="text-xs text-slate-500"> · {wert.kandidat.zusatz}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} disabled={gesperrt} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-50" title="Anderes Ziel wählen" aria-label="Anderes Ziel wählen">
            <X size={14} />
          </button>
        </span>
        {wert.kandidat.art === 'objekt' && (
          <label className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">Ordner</span>
            <select className={`${inputClass} min-w-0 py-1.5 sm:w-56`} value={wert.ordner} disabled={gesperrt} onChange={(e) => onChange({ ...wert, ordner: e.target.value as DokumentOrdnerName })} aria-label="Ordner in der Objektakte">
              {DOKUMENT_ORDNER.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input className={`${inputClass} pl-8`} value={text} disabled={gesperrt} onChange={(e) => setText(e.target.value)} placeholder="Kunde oder Objekt suchen …" aria-label={beschriftung} />
      </div>
      {text.trim().length >= 2 && (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {treffer.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Kein Kunde und kein Objekt passt zu dieser Suche.</li>}
          {treffer.slice(0, GRENZE).map((k) => (
            <li key={kennung(k)} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  onChange({ kandidat: k, ordner: ordnerVorgabe })
                  setText('')
                }}
              >
                <ZielZeichen kandidat={k} />
                <span className="min-w-0 break-words">
                  <span className="font-medium text-slate-700">{k.name}</span>
                  {k.zusatz && <span className="text-xs text-slate-500"> · {k.zusatz}</span>}
                </span>
              </button>
            </li>
          ))}
          {treffer.length > GRENZE && <li className="px-3 py-2 text-xs text-slate-400">{treffer.length - GRENZE} weitere Treffer — bitte genauer suchen.</li>}
        </ul>
      )}
    </div>
  )
}

function alsZiel(wahl: Wahl): AblageZiel {
  return wahl.kandidat.art === 'kunde' ? { art: 'kunde', id: wahl.kandidat.id } : { art: 'objekt', id: wahl.kandidat.id, ordner: wahl.ordner }
}

// Wohin führt der Link zum Ziel einer Ablage?
function zielPfad(ziel: AblageProtokoll['ziel'] | ZielStand): string {
  return ziel.art === 'kunde' ? kundeDetailPfad(ziel.bereich, ziel.id) : `/immobilien/objekte/${ziel.id}?tab=dokumente&ordner=${encodeURIComponent(ziel.ordner)}`
}

function zielText(ziel: AblageProtokoll['ziel'] | ZielStand): string {
  if (ziel.art === 'objekt') return `Objekt ${ziel.name}, Ordner ${ziel.ordner}`
  return `${ziel.name}, ${ziel.id === AKTE_INTERN ? 'eigene Unterlagen des Hauses' : `Bereich ${kundeBereichLabel(ziel.bereich)}`}`
}

function ablageNamen(p: AblageProtokoll): string[] {
  return [...p.dateien.map((f) => f.zielName || f.original.name), ...(p.uebersprungen ?? []).map((d) => d.name)]
}

// ---------- Die Seite ----------

/** Ungeklärte Eingänge abarbeiten: Was der Assistent keiner Akte zuordnen konnte, liegt hier. Je Datei
 *  steht, was über sie bekannt ist; mit einem Klick kommt sie zu einem Kunden oder in den Ordner eines
 *  Objekts — einzeln oder mehrere auf einmal. Das Ablegen selbst macht der Server (lib/eingang.ts). */
export function UngeklaerteEingaenge() {
  const { state, dispatch } = useApp()
  const [sammel, setSammel] = useState<Sammelakte | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [ladeFehler, setLadeFehler] = useState('')
  const [kurzfassungen, setKurzfassungen] = useState<Record<string, string>>({})
  const [auswahl, setAuswahl] = useState<string[]>([])
  const [ziele, setZiele] = useState<Record<string, Wahl>>({})
  const [sammelZiel, setSammelZiel] = useState<Wahl | null>(null)
  const [arbeitetAn, setArbeitetAn] = useState<string[] | null>(null)
  const [meldung, setMeldung] = useState<Meldung | null>(null)
  const meldungRef = useRef<HTMLDivElement>(null)
  const gefragt = useRef(new Set<string>())
  const [runde, setRunde] = useState(0)
  const [ablagen, setAblagen] = useState<AblageProtokoll[]>([])
  const [ablagenFehler, setAblagenFehler] = useState('')
  const [ablagenOffen, setAblagenOffen] = useState(false)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Frisch aus der Datenbank lesen und ins Fenster übernehmen, ohne etwas zurückzuschreiben.
  const laden = useCallback(async () => {
    setLadeFehler('')
    try {
      const frisch = await ladeUngeklaerteEingaenge()
      if (frisch) {
        setSammel(frisch)
        dispatch({ type: 'KUNDE_VOM_SERVER', bereich: SAMMEL_BEREICH, id: AKTE_UNGEKLAERT, patch: { dokumente: frisch.dokumente, activities: frisch.activities } })
      } else {
        // Ohne Datenbank (Vorführmodus) oder solange es die Sammelakte noch nicht gibt: der Stand des Fensters.
        const lokal = stateRef.current.kunden.find((k) => k.id === AKTE_UNGEKLAERT)
        setSammel({ dokumente: lokal?.dokumente ?? [], activities: lokal?.activities ?? [] })
      }
    } catch (err) {
      setLadeFehler(err instanceof Error ? err.message : 'Die ungeklärten Eingänge ließen sich nicht laden.')
    } finally {
      setLaedt(false)
    }
  }, [dispatch])

  // Die zuletzt abgelegten Dateien (zum Rückgängigmachen) — ein Fehler hier stört die Liste oben nicht.
  const ladeAblagen = useCallback(async () => {
    try {
      setAblagen(await ladeLetzteAblagen(14))
      setAblagenFehler('')
    } catch (err) {
      setAblagenFehler(err instanceof Error ? err.message : 'Die zuletzt abgelegten Dateien ließen sich nicht laden.')
    }
  }, [])

  useEffect(() => {
    void laden()
    void ladeAblagen()
  }, [laden, ladeAblagen])

  const dokumente = useMemo(() => {
    // Neueste zuerst; bei gleichem Datum bleibt die Reihenfolge der Akte (dort steht Neues vorn).
    return [...(sammel?.dokumente ?? [])].map((d, i) => ({ d, i })).sort((a, b) => (b.d.datum ?? '').localeCompare(a.d.datum ?? '') || a.i - b.i).map((x) => x.d)
  }, [sammel])

  // Kurzfassungen, die der Server zu schon gelesenen Dateien aufbewahrt — nur abfragen, kein neues
  // Lesen anstoßen. Jede Datei wird nur einmal gefragt (nach „Neu laden" noch einmal).
  const verweise = useMemo(() => dokumente.filter((d) => d.url).map((d) => d.url as string).join('\n'), [dokumente])
  useEffect(() => {
    const offen = dokumente.filter((d) => d.url && !gefragt.current.has(d.url))
    if (offen.length === 0) return
    for (const d of offen) gefragt.current.add(d.url as string)
    void (async () => {
      const gefunden: Record<string, string> = {}
      for (let start = 0; start < offen.length; start += 200) {
        try {
          const antwort = await holeDokumentInhalte(offen.slice(start, start + 200).map((d) => ({ url: d.url as string, name: d.name, typ: d.typ })), false)
          for (const info of antwort.dokumente) if (info.status === 'gelesen' && info.zusammenfassung?.trim()) gefunden[info.url] = info.zusammenfassung.trim()
        } catch {
          // Ohne Kurzfassungen geht es auch — die Liste bleibt benutzbar.
        }
      }
      if (Object.keys(gefunden).length > 0) setKurzfassungen((alt) => ({ ...alt, ...gefunden }))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verweise, runde])

  // Alle möglichen Ziele: Kunden aller Bereiche (ohne private Kontakte und ohne diese Sammelakte) und Objekte.
  const kandidaten = useMemo<Kandidat[]>(() => {
    const liste: Kandidat[] = []
    for (const bereich of KUNDEN_BEREICHE) {
      if (bereich.id === 'privat') continue
      for (const k of bereich.get(state)) {
        if (k.id === AKTE_UNGEKLAERT) continue
        const name = kundenName(k)
        const zusatz = k.id === AKTE_INTERN ? 'eigene Unterlagen des Hauses' : bereich.label
        liste.push({ art: 'kunde', id: k.id, bereich: bereich.id, name, zusatz, suchtext: normal(`${name} ${zusatz}`) })
      }
    }
    for (const o of state.objekte) {
      const name = (o.bezeichnung ?? '').trim() || 'Objekt ohne Bezeichnung'
      const zusatz = ['Objekt', (o.adresse ?? '').trim()].filter(Boolean).join(' · ')
      liste.push({ art: 'objekt', id: o.id, name, zusatz, suchtext: normal(`${name} ${o.adresse ?? ''} ${o.typ ?? ''} objekt`) })
    }
    return liste.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [state])

  const vorschlagGrundlage = useMemo(() => {
    // Der eigene Firmenname steht in fast jedem Schriftstück — er taugt nicht zum Unterscheiden.
    const intern = state.kunden.find((k) => k.id === AKTE_INTERN)
    // Ebenso die Namen der Mitarbeiter: Sie stehen als Absender im Dateinamen („Sprachnachricht … von <Name>")
    // und würden sonst auf einen Kunden gleichen Nachnamens zeigen.
    const sperre = new Set(woerter(`${intern ? `${intern.firma} ${intern.ansprechpartner}` : ''} ${MITARBEITER.join(' ')}`))
    const kundeNachId = new Map(KUNDEN_BEREICHE.flatMap((b) => b.get(state)).map((k) => [k.id, k]))
    const objektNachId = new Map(state.objekte.map((o) => [o.id, o]))
    const merkmale: Merkmale[] = []
    for (const kandidat of kandidaten) {
      if (kandidat.art === 'kunde') {
        const k = kundeNachId.get(kandidat.id)
        if (!k || istSammelakte(k.id)) continue
        merkmale.push(merkmaleAus(kandidat, k.firma ?? '', k.ansprechpartner ?? '', sperre))
      } else {
        const o = objektNachId.get(kandidat.id)
        if (o) merkmale.push(merkmaleAus(kandidat, `${o.bezeichnung ?? ''} ${o.adresse ?? ''}`, '', sperre))
      }
    }
    const haeufigkeit = new Map<string, number>()
    for (const m of merkmale) for (const w of new Set([...m.stark, ...m.schwach])) haeufigkeit.set(w, (haeufigkeit.get(w) ?? 0) + 1)
    return { merkmale, haeufigkeit }
  }, [state, kandidaten])

  const vorschlaege = useMemo(() => {
    const jeDatei: Record<string, Kandidat[]> = {}
    for (const d of dokumente) jeDatei[d.id] = vorschlaegeFuer(d.name ?? '', d.url ? (kurzfassungen[d.url] ?? '') : '', vorschlagGrundlage.merkmale, vorschlagGrundlage.haeufigkeit)
    return jeDatei
  }, [dokumente, kurzfassungen, vorschlagGrundlage])

  const vorhandeneIds = useMemo(() => new Set(dokumente.map((d) => d.id)), [dokumente])
  const gewaehlt = auswahl.filter((id) => vorhandeneIds.has(id))
  const arbeitet = arbeitetAn !== null

  function zeige(m: Meldung) {
    setMeldung(m)
    // Die Meldung steht oben — nach einem Klick weiter unten in der Liste dorthin holen.
    window.setTimeout(() => meldungRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
  }

  function uebernimmSammelakte(neueDokumente: Dokument[], neueActivities?: ActivityEntry[] | null) {
    setSammel((alt) => ({ dokumente: neueDokumente, activities: neueActivities ?? alt?.activities ?? [] }))
    dispatch({ type: 'KUNDE_VOM_SERVER', bereich: SAMMEL_BEREICH, id: AKTE_UNGEKLAERT, patch: neueActivities ? { dokumente: neueDokumente, activities: neueActivities } : { dokumente: neueDokumente } })
    const noch = new Set(neueDokumente.map((d) => d.id))
    setAuswahl((alt) => alt.filter((id) => noch.has(id)))
    setZiele((alt) => Object.fromEntries(Object.entries(alt).filter(([id]) => noch.has(id))))
  }

  // Stand des Ziels vom Server ins Fenster übernehmen — nichts davon wird noch einmal geschrieben.
  function uebernimmZiel(ziel: ZielStand) {
    if (ziel.art === 'kunde') dispatch({ type: 'KUNDE_VOM_SERVER', bereich: ziel.bereich, id: ziel.id, patch: { dokumente: ziel.dokumente, activities: ziel.activities, letzteAktivitaet: ziel.letzteAktivitaet } })
    else dispatch({ type: 'OBJEKT_VOM_SERVER', id: ziel.id, patch: { dokumente: ziel.dokumente, activities: ziel.activities } })
  }

  async function ablegen(ids: string[], wahl: Wahl, ausSammelleiste = false) {
    if (ids.length === 0 || arbeitet) return
    setArbeitetAn(ids)
    setMeldung(null)
    try {
      const ergebnis = await legeEingaengeAb(ids, alsZiel(wahl))
      // Den Stand vom Server ins Fenster übernehmen — nichts davon wird noch einmal geschrieben.
      uebernimmSammelakte(ergebnis.sammelDokumente)
      const ziel = ergebnis.ziel
      uebernimmZiel(ziel)
      const ort =
        ziel.art === 'kunde'
          ? `bei ${ziel.name || wahl.kandidat.name}, ${ziel.id === AKTE_INTERN ? 'eigene Unterlagen des Hauses' : `Bereich ${kundeBereichLabel(ziel.bereich)}`}`
          : `beim Objekt ${ziel.name || wahl.kandidat.name}, Ordner ${ziel.ordner}`
      const zeilen: string[] = []
      if (ergebnis.abgelegt.length > 0) zeilen.push(`Abgelegt: ${aufzaehlung(ergebnis.abgelegt)}`)
      if (ergebnis.uebersprungen.length > 0) zeilen.push(`Lag dort schon und wurde deshalb nur aus dieser Liste genommen: ${aufzaehlung(ergebnis.uebersprungen)}`)
      zeilen.push(...ergebnis.nichtAbgelegt.map((satz) => `Nicht abgelegt — ${satz}`))
      zeilen.push(...ergebnis.hinweise)
      zeige({
        art: ergebnis.abgelegt.length > 0 || ergebnis.nichtAbgelegt.length === 0 ? 'erfolg' : 'fehler',
        titel: ergebnis.abgelegt.length > 0 ? `${dateienText(ergebnis.abgelegt.length)} abgelegt ${ort}` : `Nichts Neues abgelegt ${ort}`,
        zeilen,
        link: { zu: zielPfad(ziel), text: ziel.art === 'kunde' ? 'Zur Akte' : 'Zum Objekt' },
        rueckgaengig: ergebnis.ablageId ?? undefined,
      })
      if (ausSammelleiste) setSammelZiel(null)
      void ladeAblagen()
    } catch (err) {
      zeige({ art: 'fehler', titel: 'Das Ablegen hat nicht geklappt', zeilen: [err instanceof Error ? err.message : 'Unbekannter Fehler.'] })
      void laden() // der Stand im Fenster kann veraltet sein (jemand anderes war schneller)
    } finally {
      setArbeitetAn(null)
    }
  }

  async function rueckgaengig(ablageId: string) {
    if (arbeitet) return
    setArbeitetAn([])
    setMeldung(null)
    try {
      const ergebnis = await macheAblageRueckgaengig(ablageId)
      uebernimmSammelakte(ergebnis.sammelDokumente)
      if (ergebnis.ziel) uebernimmZiel(ergebnis.ziel)
      const zurueck = [...ergebnis.zurueck, ...ergebnis.wiederInListe]
      const zeilen: string[] = []
      if (ergebnis.zurueck.length > 0) zeilen.push(`Wieder in dieser Liste${ergebnis.ziel ? ` und nicht mehr bei ${zielText(ergebnis.ziel)}` : ''}: ${aufzaehlung(ergebnis.zurueck)}`)
      if (ergebnis.wiederInListe.length > 0) zeilen.push(`Lag beim Ablegen schon dort und steht jetzt wieder in dieser Liste: ${aufzaehlung(ergebnis.wiederInListe)}`)
      if (ergebnis.nichtMehrDort.length > 0) zeilen.push(`Nicht mehr dort, bleibt wie es ist: ${aufzaehlung(ergebnis.nichtMehrDort)}`)
      zeige({
        art: zurueck.length > 0 ? 'erfolg' : 'fehler',
        titel: zurueck.length > 0 ? `Ablage rückgängig gemacht — ${dateienText(zurueck.length)} wieder in der Liste` : 'Nichts zurückgenommen',
        zeilen,
        link: ergebnis.ziel ? { zu: zielPfad(ergebnis.ziel), text: ergebnis.ziel.art === 'kunde' ? 'Zur Akte' : 'Zum Objekt' } : undefined,
      })
    } catch (err) {
      zeige({ art: 'fehler', titel: 'Das Rückgängigmachen hat nicht geklappt', zeilen: [err instanceof Error ? err.message : 'Unbekannter Fehler.'] })
      void laden()
    } finally {
      setArbeitetAn(null)
      void ladeAblagen()
    }
  }

  function rueckgaengigMitFrage(p: AblageProtokoll) {
    const namen = ablageNamen(p)
    const liste = namen.slice(0, 15).map((n) => `• ${n}`).join('\n') + (namen.length > 15 ? `\n… und ${namen.length - 15} weitere` : '')
    const frage = `Diese Ablage rückgängig machen?\n\nZiel: ${zielText(p.ziel)}\nAbgelegt am ${fmtDateTime(p.am)} von ${p.von}\n\n${liste}\n\nDie Einträge kommen dort heraus und wieder in die Liste der ungeklärten Eingänge. Was dort inzwischen verschoben oder gelöscht wurde, bleibt, wie es ist.`
    if (window.confirm(frage)) void rueckgaengig(p.id)
  }

  async function herausnehmen(ids: string[]) {
    if (ids.length === 0 || arbeitet) return
    const namen = dokumente.filter((d) => ids.includes(d.id)).map((d) => d.name)
    const liste = namen.slice(0, 15).map((n) => `• ${n}`).join('\n') + (namen.length > 15 ? `\n… und ${namen.length - 15} weitere` : '')
    const frage = `${ids.length === 1 ? 'Diesen Eintrag' : `Diese ${ids.length} Einträge`} aus der Liste nehmen?\n\n${liste}\n\nEs verschwindet nur der Eintrag in dieser Liste. Die gespeicherte Datei wird nicht gelöscht — sie liegt danach aber in keiner Akte mehr.`
    if (!window.confirm(frage)) return
    setArbeitetAn(ids)
    setMeldung(null)
    try {
      const ergebnis = await nimmEingaengeHeraus(ids)
      uebernimmSammelakte(ergebnis.sammelDokumente, ergebnis.sammelActivities)
      zeige({ art: 'erfolg', titel: `${dateienText(ergebnis.entfernt.length)} aus der Liste genommen`, zeilen: [`${aufzaehlung(ergebnis.entfernt)} — ${ergebnis.entfernt.length === 1 ? 'die gespeicherte Datei ist' : 'die gespeicherten Dateien sind'} nicht gelöscht.`] })
    } catch (err) {
      zeige({ art: 'fehler', titel: 'Das Herausnehmen hat nicht geklappt', zeilen: [err instanceof Error ? err.message : 'Unbekannter Fehler.'] })
      void laden()
    } finally {
      setArbeitetAn(null)
    }
  }

  async function oeffnen(d: Dokument) {
    if (!d.url) return
    // Fenster sofort öffnen (sonst blockt der Browser es nach dem Warten), Adresse danach setzen.
    const fenster = window.open('', '_blank')
    try {
      const adresse = brauchtDateiLink(d.url) ? await holeAnhangUrl(d.url) : d.url.startsWith('http') ? d.url : await erzeugeKundenDownloadUrl(d.url)
      if (fenster) fenster.location.href = adresse
      else window.location.href = adresse
    } catch (err) {
      fenster?.close()
      zeige({ art: 'fehler', titel: `„${d.name}“ ließ sich nicht öffnen`, zeilen: [err instanceof Error ? err.message : 'Unbekannter Fehler.'] })
    }
  }

  function umschalten(id: string) {
    setAuswahl((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : [...alt, id]))
  }

  const alleGewaehlt = dokumente.length > 0 && gewaehlt.length === dokumente.length

  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-800">Ungeklärte Eingänge</h1>
          <p className="text-sm text-slate-500">
            {laedt ? 'Wird geladen …' : `${dateienText(dokumente.length)} · vom Assistenten keiner Akte zugeordnet`}
          </p>
        </div>
        <SecondaryButton
          onClick={() => {
            setLaedt(true)
            gefragt.current.clear()
            setRunde((r) => r + 1)
            void laden()
            void ladeAblagen()
          }}
          disabled={laedt || arbeitet}
        >
          <RefreshCw size={15} className={laedt ? 'animate-spin' : ''} /> Neu laden
        </SecondaryButton>
      </div>

      {ladeFehler && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{ladeFehler}</span>
        </div>
      )}

      <div ref={meldungRef}>
        {meldung && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${meldung.art === 'erfolg' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`} role="status">
            {meldung.art === 'erfolg' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <TriangleAlert size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="break-words font-medium">{meldung.titel}</div>
              {meldung.zeilen.map((zeile, i) => (
                <div key={i} className="mt-0.5 break-words">
                  {zeile}
                </div>
              ))}
              {(meldung.link || meldung.rueckgaengig) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {meldung.link && (
                    <Link to={meldung.link.zu} className="inline-flex items-center gap-1 font-medium underline">
                      {meldung.link.text} <ExternalLink size={13} />
                    </Link>
                  )}
                  {meldung.rueckgaengig && (
                    <button
                      type="button"
                      onClick={() => meldung.rueckgaengig && void rueckgaengig(meldung.rueckgaengig)}
                      disabled={arbeitet}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Undo2 size={13} /> Rückgängig
                    </button>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setMeldung(null)} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" title="Meldung schließen" aria-label="Meldung schließen">
              <X size={15} />
            </button>
          </div>
        )}
      </div>

      {!laedt && dokumente.length === 0 && !ladeFehler && <EmptyState text="Alles einsortiert — hier liegt gerade nichts. Was der Assistent keiner Akte zuordnen kann, erscheint hier." />}

      {dokumente.length > 0 && (
        <>
          {/* Mehrere auf einmal: bleibt beim Blättern oben stehen, sobald etwas angekreuzt ist. */}
          <Card className={`mb-4 p-3 ${gewaehlt.length > 0 ? 'sticky top-0 z-10 shadow-md' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-400"
                  checked={alleGewaehlt}
                  disabled={arbeitet}
                  onChange={() => setAuswahl(alleGewaehlt ? [] : dokumente.map((d) => d.id))}
                />
                Alle auswählen
              </label>
              <span className="text-xs text-slate-500">{gewaehlt.length === 0 ? 'Ankreuzen, um mehrere auf einmal abzulegen' : `${gewaehlt.length} von ${dokumente.length} ausgewählt`}</span>
            </div>
            {gewaehlt.length > 0 && (
              <div className="mt-3 flex min-w-0 flex-col gap-2 lg:flex-row lg:items-start">
                <div className="min-w-0 flex-1">
                  <ZielWahl kandidaten={kandidaten} wert={sammelZiel} onChange={setSammelZiel} ordnerVorgabe={AUFFANG_ORDNER} gesperrt={arbeitet} beschriftung="Ziel für alle ausgewählten Dateien suchen" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton onClick={() => sammelZiel && void ablegen(gewaehlt, sammelZiel, true)} disabled={!sammelZiel || arbeitet}>
                    {arbeitet ? 'Wird abgelegt …' : `${dateienText(gewaehlt.length)} ablegen`}
                  </PrimaryButton>
                  <SecondaryButton onClick={() => void herausnehmen(gewaehlt)} disabled={arbeitet}>
                    <Trash2 size={14} /> Aus der Liste nehmen
                  </SecondaryButton>
                </div>
              </div>
            )}
          </Card>

          <Card className="divide-y divide-slate-100 overflow-hidden">
            {dokumente.map((d) => {
              const kurz = d.url ? kurzfassungen[d.url] : undefined
              const hinweis = eingangsHinweis(d, sammel?.activities ?? [])
              const wahl = ziele[d.id] ?? null
              const inArbeit = arbeitetAn?.includes(d.id) ?? false
              const angekreuzt = gewaehlt.includes(d.id)
              return (
                <div key={d.id} className={`px-3 py-3 sm:px-4 ${inArbeit ? 'opacity-60' : ''} ${angekreuzt ? 'bg-accent-50/40' : ''}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-400"
                      checked={angekreuzt}
                      disabled={arbeitet}
                      onChange={() => umschalten(d.id)}
                      aria-label={`${d.name} auswählen`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="flex min-w-0 flex-1 basis-56 items-start gap-2">
                          <DateiZeichen typ={d.typ} />
                          <div className="min-w-0">
                            <div className="break-words text-sm font-medium text-slate-800 [overflow-wrap:anywhere]">{d.name || 'Datei ohne Namen'}</div>
                            <div className="text-xs text-slate-500">
                              {fmtDate(d.datum)}
                              {d.groesse ? ` · ${d.groesse}` : ''}
                              {hinweis?.art ? ` · ${hinweis.art}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void oeffnen(d)}
                            disabled={!d.url}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            title={d.url ? 'Datei in einem neuen Fenster öffnen' : 'Zu diesem Eintrag ist keine Datei gespeichert'}
                          >
                            <ExternalLink size={13} /> Öffnen
                          </button>
                          <button
                            type="button"
                            onClick={() => void herausnehmen([d.id])}
                            disabled={arbeitet}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Aus der Liste nehmen (die Datei wird nicht gelöscht)"
                            aria-label={`${d.name} aus der Liste nehmen`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {kurz && <p className="mt-1.5 break-words text-sm text-slate-600">{kurz}</p>}
                      {hinweis && (
                        <p className="mt-1 break-words text-xs text-slate-500">
                          Eingang {fmtDate(hinweis.datum)}: {hinweis.text}
                        </p>
                      )}

                      {!wahl && (vorschlaege[d.id]?.length ?? 0) > 0 && (
                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-500">Vorschlag (antippen, dann „Ablegen“):</span>
                          {vorschlaege[d.id].map((k) => {
                            const ordner = ordnerFuer(d)
                            return (
                              <button
                                key={kennung(k)}
                                type="button"
                                disabled={arbeitet}
                                onClick={() => setZiele((alt) => ({ ...alt, [d.id]: { kandidat: k, ordner } }))}
                                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-left text-xs font-medium text-accent-700 hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title={k.art === 'objekt' ? `Objekt ${k.name}, Ordner ${ordner} als Ziel übernehmen` : `${k.name} als Ziel übernehmen`}
                              >
                                <ZielZeichen kandidat={k} />
                                <span className="min-w-0 break-words">
                                  {k.name}
                                  <span className="font-normal text-slate-500"> · {k.art === 'objekt' ? `Objekt, Ordner ${ordner}` : k.zusatz}</span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <ZielWahl
                            kandidaten={kandidaten}
                            wert={wahl}
                            onChange={(neu) => setZiele((alt) => (neu ? { ...alt, [d.id]: neu } : Object.fromEntries(Object.entries(alt).filter(([id]) => id !== d.id))))}
                            ordnerVorgabe={ordnerFuer(d)}
                            gesperrt={arbeitet}
                            beschriftung={`Ziel für ${d.name} suchen`}
                          />
                        </div>
                        <PrimaryButton onClick={() => wahl && void ablegen([d.id], wahl)} disabled={!wahl || arbeitet} className="shrink-0 self-start">
                          {inArbeit ? 'Wird abgelegt …' : 'Ablegen'}
                        </PrimaryButton>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </Card>
        </>
      )}

      {(ablagen.length > 0 || ablagenFehler) && (
        <Card className="mt-6">
          <button
            type="button"
            onClick={() => setAblagenOffen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 sm:px-4"
            aria-expanded={ablagenOffen}
          >
            <History size={16} className="shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1">
              Zuletzt abgelegt
              <span className="font-normal text-slate-500"> · {ablagen.length === 0 ? 'letzte 14 Tage' : `${ablagen.length} in den letzten 14 Tagen`}</span>
            </span>
            <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${ablagenOffen ? 'rotate-180' : ''}`} />
          </button>
          {ablagenOffen && (
            <div className="border-t border-slate-100">
              {ablagenFehler && <p className="px-3 py-2 text-sm text-rose-600 sm:px-4">{ablagenFehler}</p>}
              <ul className="divide-y divide-slate-100">
                {ablagen.map((p) => {
                  const namen = ablageNamen(p)
                  return (
                    <li key={p.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4">
                      <div className="min-w-0 flex-1 text-sm">
                        <div className="text-xs text-slate-500">
                          {fmtDateTime(p.am)} · {p.von}
                        </div>
                        <div className="mt-0.5 break-words text-slate-700 [overflow-wrap:anywhere]">{aufzaehlung(namen, 4)}</div>
                        <div className="mt-0.5 break-words text-xs text-slate-500">
                          nach{' '}
                          <Link to={zielPfad(p.ziel)} className="font-medium text-accent-600 hover:underline">
                            {zielText(p.ziel)}
                          </Link>
                        </div>
                      </div>
                      <SecondaryButton onClick={() => rueckgaengigMitFrage(p)} disabled={arbeitet} className="shrink-0 self-start px-2.5 py-1.5 text-xs">
                        <Undo2 size={13} /> Rückgängig
                      </SecondaryButton>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
