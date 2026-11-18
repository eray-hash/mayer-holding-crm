import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Camera,
  Check,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  FileText,
  FolderInput,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { CURRENT_USER } from '../data/constants'
import { erkenneKundenArt } from '../lib/bonitaet'
import { fmtDateTime, today, uid } from '../lib/dates'
import { leseKontoauszug } from '../lib/emailGateway'
import { ladeKundenDokumentHoch } from '../lib/kundenDokumenteStorage'
import {
  AUFFANG_KATEGORIE,
  EXCEL_TYP,
  FOTO_HOECHSTENS,
  FOTO_KANTE,
  KONTOART_LABEL,
  UMBUCHUNG_HINWEIS,
  arbeitsmappeAlsBytes,
  baueArbeitsmappe,
  betragAlsEingabe,
  erkenneKontoart,
  excelDateiname,
  fmtBetrag,
  fuegeBuchungenZusammen,
  istAuswertbaresDokument,
  istPdf,
  kategorienFuer,
  klingtNachKontoauszug,
  leseBetrag,
  monatLabel,
  monatSchluessel,
  neueBuchungsId,
  pruefeNeueDatei,
  uebernehmeBuchungen,
  werteAus,
  zeitraumText,
  type Buchung,
  type Kontoart,
} from '../lib/kontoauszugAuswertung'
import {
  benenneKontoauszugAuswertungUm,
  ladeKontoauszugAuswertungen,
  loescheKontoauszugAuswertung,
  speichereKontoauszugAuswertung,
  type GespeicherteAuswertung,
} from '../lib/kontoauszugSpeicher'
import { Card, EmptyState, PrimaryButton, SecondaryButton, inputClass } from './ui'
import type { Dokument, KontoauszugDatei, KundeBereich } from '../types'

const fehlerText = (err: unknown, ersatz: string) => (err instanceof Error && err.message ? err.message : ersatz)

/** Eine Auswertung, die gerade bearbeitet wird. `gespeichert` = gibt es schon in der Tabelle. */
type Entwurf = {
  id: string
  titel: string
  kontoart: Kontoart
  buchungen: Buchung[]
  dateien: KontoauszugDatei[]
  erstelltAm: string
  erstelltVon?: string
  gespeichert: boolean
}

type Ansicht = 'liste' | 'neu' | 'pruefen'

/** Kontoauszüge eines Kunden auswerten: Auszüge aus der Akte wählen oder neu hochladen, vom Server
 *  auslesen lassen (eine Datei je Aufruf), Buchungen prüfen und korrigieren, Summen je Kategorie und
 *  Monat ansehen, speichern (Tabelle kontoauszug_auswertungen) und als Excel herunterladen oder in der
 *  Akte ablegen. Übernommen aus dem früheren Einzelprogramm „Kontoauszug → Excel“. */
export function KontoauszuegeSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)

  const [liste, setListe] = useState<GespeicherteAuswertung[] | null>(null)
  const [ladeFehler, setLadeFehler] = useState('')
  const [ansicht, setAnsicht] = useState<Ansicht>('liste')
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null)
  const [ungespeichert, setUngespeichert] = useState(false)

  // Neueste Daten für Schritte, die über mehrere Wartezeiten laufen (Hochladen mehrerer Dateien).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  // Dokumente, die schon an die Akte gegeben wurden, aber noch nicht im Zustand angekommen sind.
  const ausstehend = useRef<{ bereich: KundeBereich; id: string; dok: Dokument }[]>([])
  useEffect(() => {
    ausstehend.current = ausstehend.current.filter((a) => {
      const k = KUNDEN_BEREICHE.find((b) => b.id === a.bereich)!.get(state).find((x) => x.id === a.id)
      return !!k && !(k.dokumente ?? []).some((d) => d.id === a.dok.id)
    })
  }, [state])

  useEffect(() => {
    let aktiv = true
    ladeKontoauszugAuswertungen(kundeId, bereich)
      .then((l) => {
        if (!aktiv) return
        setLadeFehler('')
        setListe(l)
      })
      .catch((err) => {
        if (!aktiv) return
        setListe([])
        setLadeFehler(fehlerText(err, 'Die gespeicherten Auswertungen konnten nicht geladen werden.'))
      })
    return () => {
      aktiv = false
    }
  }, [kundeId, bereich])

  if (!kunde) return null

  /** Legt ein Dokument in der Akte ab — wie der Hochladen-Knopf unter „Dokumente“, also auch in
   *  verknüpften Akten. Liest jedes Mal den neuesten Stand, damit mehrere Dateien hintereinander
   *  sich nicht gegenseitig überschreiben. */
  function legeInAkteAb(dok: Dokument) {
    const s = stateRef.current
    const ziele: { bereich: KundeBereich; id: string }[] = [{ bereich, id: kundeId }]
    const k = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(s).find((x) => x.id === kundeId)
    for (const link of k?.verknuepfteKunden ?? []) ziele.push(link)
    for (const ziel of ziele) {
      const zk = KUNDEN_BEREICHE.find((b) => b.id === ziel.bereich)!.get(s).find((x) => x.id === ziel.id)
      if (!zk) continue
      ausstehend.current.push({ ...ziel, dok })
      const vorhanden = zk.dokumente ?? []
      const offen = ausstehend.current.filter((a) => a.bereich === ziel.bereich && a.id === ziel.id && !vorhanden.some((d) => d.id === a.dok.id)).map((a) => a.dok)
      dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: ziel.bereich, id: ziel.id, patch: { dokumente: [...vorhanden, ...offen] } })
    }
  }

  function oeffne(a: GespeicherteAuswertung) {
    setEntwurf({
      id: a.id,
      titel: a.titel,
      kontoart: erkenneKontoart(a.buchungen),
      buchungen: a.buchungen,
      dateien: a.dateien,
      erstelltAm: a.erstelltAm,
      erstelltVon: a.erstelltVon,
      gespeichert: true,
    })
    setUngespeichert(false)
    setAnsicht('pruefen')
  }

  function zurListe() {
    if (ungespeichert && !window.confirm('Die Änderungen an dieser Auswertung sind noch nicht gespeichert. Trotzdem schließen?')) return
    setEntwurf(null)
    setUngespeichert(false)
    setAnsicht('liste')
  }

  function nachSpeichern(a: GespeicherteAuswertung) {
    setListe((l) => [a, ...(l ?? []).filter((x) => x.id !== a.id)])
  }

  const vorschlagKontoart: Kontoart = erkenneKundenArt(kunde.firma ?? '', kunde.ansprechpartner ?? '').art === 'firma' ? 'geschaeft' : 'privat'

  return (
    <div className="mt-6 min-w-0 border-t border-slate-200 pt-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Landmark size={15} className="text-accent-600" /> Kontoauszüge auswerten
          </h4>
          <p className="text-xs text-slate-400">Buchungen auslesen, prüfen, nach Kategorie und Monat zusammenfassen und als Excel-Datei ausgeben.</p>
        </div>
        {ansicht === 'liste' && (
          <SecondaryButton onClick={() => setAnsicht('neu')}>
            <Plus size={14} /> Neue Auswertung
          </SecondaryButton>
        )}
      </div>

      {ansicht === 'liste' && <Liste liste={liste} ladeFehler={ladeFehler} onOeffne={oeffne} onListe={setListe} />}

      {ansicht === 'neu' && (
        <NeueAuswertung
          bereich={bereich}
          kundeId={kundeId}
          dokumente={kunde.dokumente ?? []}
          vorschlagKontoart={vorschlagKontoart}
          legeInAkteAb={legeInAkteAb}
          onAbbrechen={() => setAnsicht('liste')}
          onFertig={(e) => {
            setEntwurf(e)
            setUngespeichert(true)
            setAnsicht('pruefen')
          }}
        />
      )}

      {ansicht === 'pruefen' && entwurf && (
        <Pruefung
          bereich={bereich}
          kundeId={kundeId}
          entwurf={entwurf}
          ungespeichert={ungespeichert}
          aendere={(fn) => {
            setEntwurf((e) => (e ? fn(e) : e))
            setUngespeichert(true)
          }}
          nachSpeichern={(a) => {
            nachSpeichern(a)
            setEntwurf((e) => (e ? { ...e, gespeichert: true, titel: a.titel } : e))
            setUngespeichert(false)
          }}
          legeInAkteAb={legeInAkteAb}
          onSchliessen={zurListe}
        />
      )}
    </div>
  )
}

// ---------- Liste der gespeicherten Auswertungen ----------

function Liste({
  liste,
  ladeFehler,
  onOeffne,
  onListe,
}: {
  liste: GespeicherteAuswertung[] | null
  ladeFehler: string
  onOeffne: (a: GespeicherteAuswertung) => void
  onListe: (fn: (l: GespeicherteAuswertung[] | null) => GespeicherteAuswertung[] | null) => void
}) {
  const [umbenennen, setUmbenennen] = useState<{ id: string; titel: string } | null>(null)
  const [beschaeftigt, setBeschaeftigt] = useState('')
  const [fehler, setFehler] = useState('')

  async function speichereTitel() {
    if (!umbenennen) return
    const titel = umbenennen.titel.trim()
    if (!titel) return
    setBeschaeftigt(umbenennen.id)
    setFehler('')
    try {
      const geaendertAm = await benenneKontoauszugAuswertungUm(umbenennen.id, titel)
      onListe((l) => (l ?? []).map((a) => (a.id === umbenennen.id ? { ...a, titel, geaendertAm } : a)))
      setUmbenennen(null)
    } catch (err) {
      setFehler(fehlerText(err, 'Umbenennen hat nicht geklappt.'))
    } finally {
      setBeschaeftigt('')
    }
  }

  async function loesche(a: GespeicherteAuswertung) {
    if (!window.confirm(`Auswertung „${a.titel || 'ohne Titel'}“ mit ${a.buchungen.length} Buchungen löschen? Das lässt sich nicht rückgängig machen. Die Auszüge in der Akte bleiben erhalten.`)) return
    setBeschaeftigt(a.id)
    setFehler('')
    try {
      await loescheKontoauszugAuswertung(a.id)
      onListe((l) => (l ?? []).filter((x) => x.id !== a.id))
    } catch (err) {
      setFehler(fehlerText(err, 'Löschen hat nicht geklappt.'))
    } finally {
      setBeschaeftigt('')
    }
  }

  if (liste === null)
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Gespeicherte Auswertungen werden geladen …
      </p>
    )

  return (
    <div>
      {ladeFehler && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{ladeFehler}</p>}
      {fehler && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler}</p>}
      {liste.length === 0 && !ladeFehler && <EmptyState text="Noch keine Auswertung gespeichert." />}
      {liste.length > 0 && (
        <Card className="divide-y divide-slate-100">
          {liste.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                {umbenennen?.id === a.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      autoFocus
                      value={umbenennen.titel}
                      onChange={(e) => setUmbenennen({ id: a.id, titel: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') speichereTitel()
                        if (e.key === 'Escape') setUmbenennen(null)
                      }}
                      className={`${inputClass} min-w-0 flex-1`}
                      aria-label="Neuer Titel"
                    />
                    <button onClick={speichereTitel} disabled={beschaeftigt === a.id} className="rounded-lg border border-slate-200 p-2 text-emerald-600 hover:bg-slate-50" aria-label="Titel speichern">
                      {beschaeftigt === a.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => setUmbenennen(null)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Abbrechen">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => onOeffne(a)} className="block w-full min-w-0 text-left">
                    <span className="block break-words text-sm font-medium text-slate-700 hover:text-accent-700">{a.titel || 'Ohne Titel'}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {zeitraumText(a.buchungen)} · {a.buchungen.length} {a.buchungen.length === 1 ? 'Buchung' : 'Buchungen'}
                    </span>
                    <span className="block text-xs text-slate-400">
                      Gespeichert am {fmtDateTime(a.geaendertAm)}
                      {a.erstelltVon ? ` · angelegt von ${a.erstelltVon}` : ''}
                    </span>
                  </button>
                )}
              </div>
              {umbenennen?.id !== a.id && (
                <div className="flex flex-shrink-0 flex-wrap gap-1.5">
                  <button onClick={() => onOeffne(a)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                    Öffnen
                  </button>
                  <button
                    onClick={() => setUmbenennen({ id: a.id, titel: a.titel })}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Pencil size={12} /> Umbenennen
                  </button>
                  <button
                    onClick={() => loesche(a)}
                    disabled={beschaeftigt === a.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    {beschaeftigt === a.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Löschen
                  </button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

// ---------- Neue Auswertung: Auszüge wählen und auslesen ----------

function ladeBild(datei: File): Promise<HTMLImageElement> {
  return new Promise((fertig, fehler) => {
    const url = URL.createObjectURL(datei)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      fertig(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      fehler(new Error('nicht lesbar'))
    }
    img.src = url
  })
}

/** Fotos für den Server vorbereiten: höchstens etwa 2000 Punkte lange Kante, als JPEG, höchstens 5 MB.
 *  HEIC (iPhone) kann der Server nicht lesen — es wird hier umgewandelt, soweit der Browser es öffnen kann. */
async function bereiteFotoVor(datei: File): Promise<File> {
  if (istPdf(datei)) return datei
  const heic = /heic|heif/i.test(datei.type) || /\.(heic|heif)$/i.test(datei.name)
  const passt = /^image\/(jpeg|png|webp|gif)$/i.test(datei.type) && datei.size <= FOTO_HOECHSTENS
  let bild: ImageBitmap | HTMLImageElement
  try {
    bild = await createImageBitmap(datei)
  } catch {
    try {
      bild = await ladeBild(datei)
    } catch {
      if (passt) return datei
      throw new Error(
        heic
          ? 'Dieses iPhone-Foto (HEIC) lässt sich in diesem Browser nicht umwandeln. Bitte in Safari öffnen oder am iPhone unter Einstellungen › Kamera › Formate „Maximale Kompatibilität“ wählen.'
          : 'Das Foto lässt sich nicht öffnen.',
      )
    }
  }
  const breite = bild.width
  const hoehe = bild.height
  const faktor = Math.min(1, FOTO_KANTE / Math.max(breite, hoehe, 1))
  if (passt && faktor === 1 && !/gif/i.test(datei.type)) return datei
  if (passt && /gif/i.test(datei.type)) return datei
  const flaeche = document.createElement('canvas')
  flaeche.width = Math.max(1, Math.round(breite * faktor))
  flaeche.height = Math.max(1, Math.round(hoehe * faktor))
  const stift = flaeche.getContext('2d')
  if (!stift) throw new Error('Das Foto lässt sich nicht verkleinern.')
  stift.fillStyle = '#ffffff'
  stift.fillRect(0, 0, flaeche.width, flaeche.height)
  stift.drawImage(bild, 0, 0, flaeche.width, flaeche.height)
  if ('close' in bild) bild.close()
  for (const guete of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((fertig) => flaeche.toBlob(fertig, 'image/jpeg', guete))
    if (blob && blob.size <= FOTO_HOECHSTENS) return new File([blob], datei.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' })
  }
  throw new Error('Das Foto ist auch verkleinert noch größer als 5 MB.')
}

type DateiErgebnis = { name: string; anzahl: number; fehler?: string; umgestellt: number; uebertragen: number; bank?: string | null; zeitraum?: string }

function NeueAuswertung({
  bereich,
  kundeId,
  dokumente,
  vorschlagKontoart,
  legeInAkteAb,
  onAbbrechen,
  onFertig,
}: {
  bereich: KundeBereich
  kundeId: string
  dokumente: Dokument[]
  vorschlagKontoart: Kontoart
  legeInAkteAb: (d: Dokument) => void
  onAbbrechen: () => void
  onFertig: (e: Entwurf) => void
}) {
  const auswertbar = useMemo(() => dokumente.filter(istAuswertbaresDokument), [dokumente])
  const [kontoart, setKontoart] = useState<Kontoart>(vorschlagKontoart)
  const [auswahl, setAuswahl] = useState<Set<string>>(() => new Set(auswertbar.filter((d) => klingtNachKontoauszug(d.name)).map((d) => d.id)))
  const [alleZeigen, setAlleZeigen] = useState(false)
  const [neue, setNeue] = useState<File[]>([])
  const [abgelehnt, setAbgelehnt] = useState<string[]>([])
  const [laeuft, setLaeuft] = useState(false)
  const [fortschritt, setFortschritt] = useState<{ nr: number; gesamt: number; name: string; schritt: 'hochladen' | 'auslesen' } | null>(null)
  const [ergebnisse, setErgebnisse] = useState<DateiErgebnis[]>([])
  const [fehler, setFehler] = useState('')
  const dateiFeld = useRef<HTMLInputElement>(null)
  const kameraFeld = useRef<HTMLInputElement>(null)

  const sichtbar = alleZeigen ? auswertbar : auswertbar.filter((d) => klingtNachKontoauszug(d.name) || auswahl.has(d.id))
  const versteckt = auswertbar.length - sichtbar.length
  const anzahl = auswertbar.filter((d) => auswahl.has(d.id)).length + neue.length

  function dateienDazu(liste: FileList | null) {
    if (!liste) return
    const schluessel = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
    const dateien = Array.from(liste)
    const gruende = dateien.map((f) => ({ f, grund: pruefeNeueDatei(f) }))
    setAbgelehnt(gruende.filter((g) => g.grund).map((g) => `${g.f.name}: ${g.grund}`))
    setNeue((alt) => {
      const da = new Set(alt.map(schluessel))
      return [...alt, ...gruende.filter((g) => !g.grund && !da.has(schluessel(g.f))).map((g) => g.f)]
    })
  }

  function umschalten(id: string) {
    setAuswahl((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function starten() {
    type Aufgabe = { art: 'akte'; dok: Dokument } | { art: 'neu'; datei: File }
    const aufgaben: Aufgabe[] = [
      ...auswertbar.filter((d) => auswahl.has(d.id)).map((dok): Aufgabe => ({ art: 'akte', dok })),
      ...neue.map((datei): Aufgabe => ({ art: 'neu', datei })),
    ]
    if (aufgaben.length === 0) return
    setLaeuft(true)
    setFehler('')
    setErgebnisse([])
    let buchungen: Buchung[] = []
    const dateien: KontoauszugDatei[] = []
    const ergebnis: DateiErgebnis[] = []
    const hochgeladen: string[] = []
    for (let i = 0; i < aufgaben.length; i++) {
      const a = aufgaben[i]
      const name = a.art === 'akte' ? a.dok.name : a.datei.name
      let verweis: { url: string; name: string; typ?: string } | null = a.art === 'akte' ? { url: a.dok.url!, name, typ: a.dok.typ } : null
      try {
        if (a.art === 'neu') {
          setFortschritt({ nr: i + 1, gesamt: aufgaben.length, name, schritt: 'hochladen' })
          const grund = pruefeNeueDatei(a.datei)
          if (grund) throw new Error(grund)
          const datei = await bereiteFotoVor(a.datei)
          const { pfad, groesse } = await ladeKundenDokumentHoch(kundeId, datei)
          const dok: Dokument = { id: uid('dok'), name: datei.name, typ: datei.type || 'Datei', datum: today(), groesse, url: pfad }
          legeInAkteAb(dok)
          hochgeladen.push(dok.id)
          verweis = { url: pfad, name: datei.name, typ: datei.type || undefined }
        }
        setFortschritt({ nr: i + 1, gesamt: aufgaben.length, name, schritt: 'auslesen' })
        const antwort = await leseKontoauszug(kundeId, bereich, verweis!)
        const { buchungen: neu, umgestellt, uebertragen } = uebernehmeBuchungen(antwort.buchungen, kontoart, verweis!.name)
        buchungen = fuegeBuchungenZusammen(buchungen, neu)
        const info: KontoauszugDatei = { ...antwort.datei, name: antwort.datei?.name || name, url: antwort.datei?.url || verweis!.url, anzahl: neu.length }
        dateien.push(info)
        ergebnis.push({
          name,
          anzahl: neu.length,
          umgestellt,
          uebertragen,
          fehler: info.fehler,
          bank: info.bank,
          zeitraum: neu.length ? zeitraumText(neu) : undefined,
        })
      } catch (err) {
        const text = fehlerText(err, 'Auslesen fehlgeschlagen.')
        dateien.push({ name, url: verweis?.url, anzahl: 0, fehler: text })
        ergebnis.push({ name, anzahl: 0, umgestellt: 0, uebertragen: 0, fehler: text })
      }
      setErgebnisse([...ergebnis])
    }

    setFortschritt(null)
    setLaeuft(false)
    // Hochgeladene Dateien liegen jetzt in der Akte: bei einem neuen Versuch nicht noch einmal hochladen.
    if (hochgeladen.length) {
      setNeue([])
      setAuswahl((s) => new Set([...s, ...hochgeladen]))
    }

    if (buchungen.length === 0) {
      setFehler(
        ergebnis.every((e) => e.fehler)
          ? 'Keine Datei konnte ausgelesen werden. Die Hinweise je Datei stehen oben.'
          : 'In den Dateien wurden keine Buchungen erkannt. Bildqualität und Dateiart prüfen oder die Buchungen von Hand eintragen.',
      )
      return
    }
    const banken = [...new Set(dateien.map((d) => d.bank).filter(Boolean))]
    onFertig({
      id: uid('kauswertung'),
      titel: `${banken.length === 1 ? `${banken[0]} ` : 'Kontoauszüge '}${zeitraumText(buchungen)}`,
      kontoart,
      buchungen,
      dateien,
      erstelltAm: new Date().toISOString(),
      erstelltVon: CURRENT_USER,
      gespeichert: false,
    })
  }

  function leerWeiter() {
    onFertig({
      id: uid('kauswertung'),
      titel: 'Kontoauszüge',
      kontoart,
      buchungen: [],
      dateien: [],
      erstelltAm: new Date().toISOString(),
      erstelltVon: CURRENT_USER,
      gespeichert: false,
    })
  }

  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">Welches Konto?</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Privatkonto oder Geschäftskonto">
        <ArtKnopf an={kontoart === 'privat'} onClick={() => setKontoart('privat')} icon={<User size={15} />} titel="Privatkonto" text="Kategorien für Haushalt: Gehalt, Miete, Lebensmittel, Versicherungen …" disabled={laeuft} />
        <ArtKnopf
          an={kontoart === 'geschaeft'}
          onClick={() => setKontoart('geschaeft')}
          icon={<Building2 size={15} />}
          titel="Geschäftskonto"
          text="Kategorien für Firmen: Umsatzerlöse, Wareneinkauf, Personal, Steuern …"
          disabled={laeuft}
        />
      </div>

      <p className="mb-2 mt-4 text-sm font-medium text-slate-700">Auszüge aus der Akte</p>
      {auswertbar.length === 0 ? (
        <p className="text-xs text-slate-500">In der Akte liegen keine PDFs oder Bilder. Unten neue Auszüge hochladen.</p>
      ) : (
        <>
          {sichtbar.length === 0 && <p className="text-xs text-slate-500">Kein Dateiname klingt nach einem Kontoauszug.</p>}
          <ul className="space-y-1">
            {sichtbar.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                  <input type="checkbox" checked={auswahl.has(d.id)} onChange={() => umschalten(d.id)} disabled={laeuft} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-accent-600" />
                  <FileText size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{d.name}</span>
                  <span className="flex-shrink-0 text-xs text-slate-400">{d.groesse}</span>
                </label>
              </li>
            ))}
          </ul>
          {(versteckt > 0 || alleZeigen) && (
            <button onClick={() => setAlleZeigen((x) => !x)} className="mt-1 text-xs font-medium text-accent-600 hover:underline">
              {alleZeigen ? 'Nur Kontoauszüge zeigen' : `Alle ${auswertbar.length} PDFs und Bilder zeigen`}
            </button>
          )}
        </>
      )}

      <p className="mb-2 mt-4 text-sm font-medium text-slate-700">Neue Auszüge</p>
      <div className="flex flex-wrap gap-2">
        <SecondaryButton onClick={() => dateiFeld.current?.click()} disabled={laeuft}>
          <Upload size={14} /> Datei wählen
        </SecondaryButton>
        <SecondaryButton onClick={() => kameraFeld.current?.click()} disabled={laeuft}>
          <Camera size={14} /> Foto aufnehmen
        </SecondaryButton>
        <input
          ref={dateiFeld}
          type="file"
          accept="application/pdf,image/*,.pdf,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            dateienDazu(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={kameraFeld}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            dateienDazu(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {neue.length > 0 && (
        <ul className="mt-2 space-y-1">
          {neue.map((f, i) => (
            <li key={`${f.name}${i}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm">
              <FileText size={14} className="flex-shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 break-words text-slate-700">{f.name}</span>
              <span className="flex-shrink-0 text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
              <button onClick={() => setNeue((l) => l.filter((_, j) => j !== i))} disabled={laeuft} className="flex-shrink-0 text-slate-400 hover:text-rose-600" aria-label="Datei entfernen">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {abgelehnt.length > 0 && (
        <ul className="mt-2 space-y-1">
          {abgelehnt.map((t, i) => (
            <li key={i} className="break-words rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
              Nicht übernommen — {t}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Neue Dateien werden zuerst in der Akte unter „Dokumente“ abgelegt und dann ausgelesen. PDFs bis 20 MB und 24 Seiten; Fotos werden vorher verkleinert.
      </p>

      {fortschritt && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
          <Loader2 size={15} className="mt-0.5 flex-shrink-0 animate-spin" />
          <div className="min-w-0">
            <p className="font-medium">
              Auszug {fortschritt.nr} von {fortschritt.gesamt} wird {fortschritt.schritt === 'hochladen' ? 'in die Akte geladen' : 'ausgelesen'} …
            </p>
            <p className="break-words text-xs">{fortschritt.name}</p>
            <p className="mt-1 text-xs text-sky-700">Je Auszug etwa eine halbe bis eine Minute. Bitte die Seite so lange offen lassen.</p>
          </div>
        </div>
      )}

      {ergebnisse.length > 0 && <DateiErgebnisse ergebnisse={ergebnisse} />}
      {fehler && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <SecondaryButton onClick={onAbbrechen} disabled={laeuft}>
          Abbrechen
        </SecondaryButton>
        {fehler && !laeuft && (
          <SecondaryButton onClick={leerWeiter}>
            <Pencil size={14} /> Von Hand eintragen
          </SecondaryButton>
        )}
        <PrimaryButton onClick={starten} disabled={laeuft || anzahl === 0}>
          {laeuft ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          {anzahl === 0 ? 'Erst Auszüge wählen' : `${anzahl} ${anzahl === 1 ? 'Auszug' : 'Auszüge'} auslesen`}
        </PrimaryButton>
      </div>
    </Card>
  )
}

function DateiErgebnisse({ ergebnisse }: { ergebnisse: DateiErgebnis[] }) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {ergebnisse.map((r, i) => (
        <li key={`${r.name}${i}`} className={`rounded-lg border px-3 py-2 text-xs ${r.fehler && r.anzahl === 0 ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-600'}`}>
          <p className="break-words font-medium text-slate-800">{r.name}</p>
          {r.anzahl > 0 && (
            <p>
              {r.anzahl} {r.anzahl === 1 ? 'Buchung' : 'Buchungen'}
              {r.bank ? ` · ${r.bank}` : ''}
              {r.zeitraum ? ` · ${r.zeitraum}` : ''}
            </p>
          )}
          {r.fehler && (
            <p className={`mt-1 flex gap-1 font-medium ${r.anzahl > 0 ? 'rounded bg-amber-50 p-1.5 text-amber-800' : ''}`}>
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{r.anzahl > 0 ? `Nicht alles gelesen: ${r.fehler}` : r.fehler}</span>
            </p>
          )}
          {r.uebertragen > 0 && (
            <p className="text-slate-500">
              {r.uebertragen} {r.uebertragen === 1 ? 'Kategorie wurde' : 'Kategorien wurden'} von Privat- auf Geschäftskategorien übertragen — bitte prüfen.
            </p>
          )}
          {r.umgestellt > 0 && (
            <p className="text-amber-700">
              {r.umgestellt} {r.umgestellt === 1 ? 'Buchung hatte' : 'Buchungen hatten'} eine Kategorie außerhalb des gewählten Satzes und {r.umgestellt === 1 ? 'steht' : 'stehen'} jetzt auf „Sonstiges“.
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

function ArtKnopf({ an, onClick, icon, titel, text, disabled }: { an: boolean; onClick: () => void; icon: React.ReactNode; titel: string; text: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={an}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-3 text-left disabled:opacity-60 ${an ? 'border-accent-300 bg-accent-50' : 'border-slate-200 hover:bg-slate-50'}`}
    >
      <span className={`flex items-center gap-1.5 text-sm font-medium ${an ? 'text-accent-700' : 'text-slate-700'}`}>
        {icon} {titel}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
    </button>
  )
}

// ---------- Prüfen, Summen, Speichern, Excel ----------

const SEITE = 100

function useBreit(): boolean {
  const abfrage = '(min-width: 1024px)'
  const [breit, setBreit] = useState(() => typeof window !== 'undefined' && window.matchMedia(abfrage).matches)
  useEffect(() => {
    const mq = window.matchMedia(abfrage)
    const neu = () => setBreit(mq.matches)
    mq.addEventListener('change', neu)
    return () => mq.removeEventListener('change', neu)
  }, [])
  return breit
}

function Pruefung({
  bereich,
  kundeId,
  entwurf,
  ungespeichert,
  aendere,
  nachSpeichern,
  legeInAkteAb,
  onSchliessen,
}: {
  bereich: KundeBereich
  kundeId: string
  entwurf: Entwurf
  ungespeichert: boolean
  aendere: (fn: (e: Entwurf) => Entwurf) => void
  nachSpeichern: (a: GespeicherteAuswertung) => void
  legeInAkteAb: (d: Dokument) => void
  onSchliessen: () => void
}) {
  const breit = useBreit()
  const [filterMonat, setFilterMonat] = useState('')
  const [filterKategorie, setFilterKategorie] = useState('')
  const [anzahlSichtbar, setAnzahlSichtbar] = useState(SEITE)
  const [vorgang, setVorgang] = useState<'' | 'speichern' | 'excel' | 'akte'>('')
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null)

  const { buchungen, kontoart } = entwurf
  const kategorien = kategorienFuer(kontoart)
  const gesamt = useMemo(() => werteAus(buchungen), [buchungen])
  const gefiltert = useMemo(
    () => buchungen.filter((b) => (!filterMonat || monatSchluessel(b.datum) === filterMonat) && (!filterKategorie || b.kategorie === filterKategorie)),
    [buchungen, filterMonat, filterKategorie],
  )
  const filterAktiv = Boolean(filterMonat || filterKategorie)
  const summen = useMemo(() => (filterAktiv ? werteAus(gefiltert).summen : gesamt.summen), [filterAktiv, gefiltert, gesamt])
  const vorhandeneKategorien = useMemo(() => {
    const da = new Set(buchungen.map((b) => b.kategorie))
    return [...kategorien.filter((k) => da.has(k)), ...[...da].filter((k) => !kategorien.includes(k))]
  }, [buchungen, kategorien])
  const fremd = buchungen.filter((b) => !kategorien.includes(b.kategorie)).length
  const mitVorschlag = buchungen.filter((b) => b.kategorieVorschlag).length
  const dateiFehler = entwurf.dateien.filter((d) => d.fehler)
  const w = gesamt.waehrung

  function aendereBuchung(id: string, patch: Partial<Buchung>) {
    aendere((e) => ({ ...e, buchungen: e.buchungen.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }

  function loescheBuchung(id: string) {
    aendere((e) => ({ ...e, buchungen: e.buchungen.filter((b) => b.id !== id) }))
  }

  function neueZeile() {
    const tag = filterMonat && filterMonat !== 'Unbekannt' ? `${filterMonat}-01` : today()
    const b: Buchung = {
      id: neueBuchungsId(),
      datum: tag,
      text: '',
      gegenpartei: '',
      betrag: 0,
      waehrung: w,
      kategorie: filterKategorie || AUFFANG_KATEGORIE,
      quelle: 'von Hand',
    }
    aendere((e) => ({ ...e, buchungen: [b, ...e.buchungen] }))
  }

  function fremdeAufSonstiges() {
    aendere((e) => ({
      ...e,
      buchungen: e.buchungen.map((b) => (kategorienFuer(e.kontoart).includes(b.kategorie) ? b : { ...b, kategorieVorschlag: b.kategorieVorschlag ?? b.kategorie, kategorie: AUFFANG_KATEGORIE })),
    }))
  }

  async function speichern() {
    setVorgang('speichern')
    setMeldung(null)
    try {
      const gespeichert = await speichereKontoauszugAuswertung({
        id: entwurf.id,
        kundeId,
        bereich,
        titel: entwurf.titel.trim() || `Kontoauszüge ${zeitraumText(buchungen)}`,
        erstelltAm: entwurf.erstelltAm,
        erstelltVon: entwurf.erstelltVon,
        geaendertAm: new Date().toISOString(),
        buchungen,
        dateien: entwurf.dateien,
      })
      nachSpeichern(gespeichert)
      setMeldung({ art: 'ok', text: 'Gespeichert.' })
    } catch (err) {
      setMeldung({ art: 'fehler', text: fehlerText(err, 'Speichern hat nicht geklappt.') })
    } finally {
      setVorgang('')
    }
  }

  function excelBauen(): { bytes: ArrayBuffer; name: string } {
    const titel = entwurf.titel.trim() || 'Kontoauszüge'
    const wb = baueArbeitsmappe(buchungen, entwurf.dateien, { titel })
    return { bytes: arbeitsmappeAlsBytes(wb), name: excelDateiname(titel, today()) }
  }

  function herunterladen() {
    setVorgang('excel')
    setMeldung(null)
    try {
      const { bytes, name } = excelBauen()
      const url = URL.createObjectURL(new Blob([bytes], { type: EXCEL_TYP }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setMeldung({ art: 'fehler', text: fehlerText(err, 'Die Excel-Datei konnte nicht erstellt werden.') })
    } finally {
      setVorgang('')
    }
  }

  async function inAkteAblegen() {
    setVorgang('akte')
    setMeldung(null)
    try {
      const { bytes, name } = excelBauen()
      const datei = new File([bytes], name, { type: EXCEL_TYP })
      const { pfad, groesse } = await ladeKundenDokumentHoch(kundeId, datei)
      legeInAkteAb({ id: uid('dok'), name, typ: EXCEL_TYP, datum: today(), groesse, url: pfad })
      setMeldung({ art: 'ok', text: `In der Akte unter „Dokumente“ abgelegt: ${name}` })
    } catch (err) {
      setMeldung({ art: 'fehler', text: fehlerText(err, 'Ablegen in der Akte hat nicht geklappt.') })
    } finally {
      setVorgang('')
    }
  }

  const angezeigt = gefiltert.slice(0, anzahlSichtbar)

  return (
    <div className="min-w-0 space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onSchliessen} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ChevronLeft size={13} /> Zur Liste
          </button>
          <span className="text-xs text-slate-400">
            {entwurf.gespeichert ? (ungespeichert ? 'Gespeichert, mit ungespeicherten Änderungen' : 'Gespeichert') : 'Noch nicht gespeichert'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-slate-500">Titel</span>
            <input value={entwurf.titel} onChange={(e) => aendere((x) => ({ ...x, titel: e.target.value }))} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Kategorien für</span>
            <select value={kontoart} onChange={(e) => aendere((x) => ({ ...x, kontoart: e.target.value as Kontoart }))} className={inputClass}>
              <option value="privat">{KONTOART_LABEL.privat}</option>
              <option value="geschaeft">{KONTOART_LABEL.geschaeft}</option>
            </select>
          </label>
        </div>
        {entwurf.dateien.length > 0 && (
          <p className="mt-2 break-words text-xs text-slate-500">
            Ausgelesen aus: {entwurf.dateien.map((d) => `${d.name} (${d.fehler && !d.anzahl ? 'Fehler' : `${d.anzahl}`})`).join(', ')}
          </p>
        )}
        {dateiFehler.length > 0 && (
          <ul className="mt-2 space-y-1">
            {dateiFehler.map((d, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                <span className="min-w-0 break-words">
                  <span className="break-words font-medium">{d.name}:</span> {d.anzahl > 0 ? `nicht alles gelesen (${d.anzahl} Buchungen übernommen). ` : ''}
                  {d.fehler}
                </span>
              </li>
            ))}
          </ul>
        )}
        {fremd > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span className="min-w-0 flex-1">
              {fremd} {fremd === 1 ? 'Buchung hat' : 'Buchungen haben'} eine Kategorie, die nicht zum {KONTOART_LABEL[kontoart]} gehört.
            </span>
            <button onClick={fremdeAufSonstiges} className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100">
              Auf „Sonstiges“ setzen
            </button>
          </div>
        )}
        {kontoart === 'geschaeft' && !entwurf.gespeichert && buchungen.length > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            Der Server ordnet bisher nur nach Privatkategorien. Für das Geschäftskonto wurden sie hier übertragen (zum Beispiel „Auto & Tankstelle“ → „Fahrzeuge“) — bitte prüfen.
          </p>
        )}
        {mitVorschlag > 0 && (
          <p className="mt-2 text-xs text-amber-700">
            {mitVorschlag} {mitVorschlag === 1 ? 'Buchung steht' : 'Buchungen stehen'} auf „Sonstiges“, weil der vorgeschlagene Name nicht in die Liste passte — der Vorschlag steht jeweils unter der Kategorie.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kachel label={filterAktiv ? 'Buchungen (Auswahl)' : 'Buchungen'} wert={String(filterAktiv ? gefiltert.length : buchungen.length)} />
        <Kachel label="Einnahmen" wert={fmtBetrag(summen.einnahmen, w)} ton="plus" />
        <Kachel label="Ausgaben" wert={fmtBetrag(summen.ausgaben, w)} ton="minus" />
        <Kachel label="Saldo" wert={fmtBetrag(summen.saldo, w)} ton={summen.saldo >= 0 ? 'plus' : 'minus'} />
      </div>
      <p className="-mt-2 text-xs text-slate-400">Einnahmen, Ausgaben und Saldo ohne „Umbuchung & Eigenübertrag“{filterAktiv ? ', nur für die gefilterten Buchungen' : ''}.</p>

      <Card className="p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <h5 className="mr-auto text-sm font-semibold text-slate-700">Buchungen prüfen und korrigieren</h5>
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">Monat</span>
            <select
              value={filterMonat}
              onChange={(e) => {
                setFilterMonat(e.target.value)
                setAnzahlSichtbar(SEITE)
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:w-auto"
            >
              <option value="">Alle Monate</option>
              {gesamt.monate.map((m) => (
                <option key={m} value={m}>
                  {monatLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">Kategorie</span>
            <select
              value={filterKategorie}
              onChange={(e) => {
                setFilterKategorie(e.target.value)
                setAnzahlSichtbar(SEITE)
              }}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 sm:w-auto sm:max-w-[16rem]"
            >
              <option value="">Alle Kategorien</option>
              {vorhandeneKategorien.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button onClick={neueZeile} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <Plus size={13} /> Zeile
          </button>
        </div>

        {gefiltert.length === 0 ? (
          <EmptyState text={buchungen.length === 0 ? 'Keine Buchungen. Über „Zeile“ von Hand eintragen.' : 'Keine Buchung passt zum Filter.'} />
        ) : breit ? (
          <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Datum</th>
                  <th className="px-2 py-2 font-medium">Gegenpartei</th>
                  <th className="px-2 py-2 font-medium">Text</th>
                  <th className="px-2 py-2 font-medium">Kategorie</th>
                  <th className="px-2 py-2 text-right font-medium">Betrag</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {angezeigt.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-2 py-1.5">
                      <input type="date" value={b.datum} onChange={(e) => aendereBuchung(b.id, { datum: e.target.value })} className={zelle('w-[8.5rem]')} aria-label="Datum" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={b.gegenpartei ?? ''} onChange={(e) => aendereBuchung(b.id, { gegenpartei: e.target.value })} className={zelle('w-full min-w-[9rem]')} aria-label="Gegenpartei" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={b.text} onChange={(e) => aendereBuchung(b.id, { text: e.target.value })} className={zelle('w-full min-w-[14rem]')} aria-label="Text" title={b.text} />
                    </td>
                    <td className="px-2 py-1.5">
                      <KategorieWahl b={b} kategorien={kategorien} onChange={(k) => aendereBuchung(b.id, { kategorie: k, kategorieVorschlag: undefined })} className={zelle('w-[13rem]')} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <BetragFeld wert={b.betrag} onChange={(n) => aendereBuchung(b.id, { betrag: n })} className={zelle('w-[7.5rem] text-right tabular-nums')} />
                    </td>
                    <td className="px-1 py-1.5 text-right">
                      <button onClick={() => loescheBuchung(b.id)} className="rounded p-1 text-slate-300 hover:text-rose-600" aria-label="Buchung löschen">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="space-y-2">
            {angezeigt.map((b) => (
              <li key={b.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
                <div className="flex gap-2">
                  <input type="date" value={b.datum} onChange={(e) => aendereBuchung(b.id, { datum: e.target.value })} className={zelle('min-w-0 flex-1')} aria-label="Datum" />
                  <BetragFeld wert={b.betrag} onChange={(n) => aendereBuchung(b.id, { betrag: n })} className={zelle('w-28 text-right tabular-nums')} />
                </div>
                <input value={b.gegenpartei ?? ''} onChange={(e) => aendereBuchung(b.id, { gegenpartei: e.target.value })} placeholder="Gegenpartei" className={zelle('w-full')} aria-label="Gegenpartei" />
                <textarea value={b.text} onChange={(e) => aendereBuchung(b.id, { text: e.target.value })} placeholder="Text" rows={2} className={zelle('w-full resize-y')} aria-label="Text" />
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <KategorieWahl b={b} kategorien={kategorien} onChange={(k) => aendereBuchung(b.id, { kategorie: k, kategorieVorschlag: undefined })} className={zelle('w-full')} />
                  </div>
                  <button onClick={() => loescheBuchung(b.id)} className="flex-shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-rose-600" aria-label="Buchung löschen">
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {gefiltert.length > angezeigt.length && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {angezeigt.length} von {gefiltert.length} angezeigt.
            <button onClick={() => setAnzahlSichtbar((n) => n + SEITE)} className="font-medium text-accent-600 hover:underline">
              Weitere {Math.min(SEITE, gefiltert.length - angezeigt.length)} zeigen
            </button>
            <button onClick={() => setAnzahlSichtbar(gefiltert.length)} className="font-medium text-accent-600 hover:underline">
              Alle zeigen
            </button>
          </div>
        )}
      </Card>

      {gesamt.monate.length > 0 && <Uebersichten a={gesamt} />}

      {meldung && <p className={`rounded-lg p-3 text-sm ${meldung.art === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{meldung.text}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <SecondaryButton onClick={inAkteAblegen} disabled={!!vorgang || buchungen.length === 0} className="justify-center">
          {vorgang === 'akte' ? <Loader2 size={14} className="animate-spin" /> : <FolderInput size={14} />} In der Akte ablegen
        </SecondaryButton>
        <SecondaryButton onClick={herunterladen} disabled={!!vorgang || buchungen.length === 0} className="justify-center">
          {vorgang === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Excel herunterladen
        </SecondaryButton>
        <PrimaryButton onClick={speichern} disabled={!!vorgang || (entwurf.gespeichert && !ungespeichert)} className="justify-center">
          {vorgang === 'speichern' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Speichern
        </PrimaryButton>
      </div>
      <p className="text-xs text-slate-400">Auswertung ohne Gewähr — Beträge und Kategorien vor Verwendung prüfen. Die Excel-Datei enthält die Summen als fertige Tabellen, keine Excel-Pivottabelle.</p>
    </div>
  )
}

function zelle(extra: string): string {
  return `rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 ${extra}`
}

function KategorieWahl({ b, kategorien, onChange, className }: { b: Buchung; kategorien: readonly string[]; onChange: (k: string) => void; className: string }) {
  const fremd = !kategorien.includes(b.kategorie)
  return (
    <>
      <select value={b.kategorie} onChange={(e) => onChange(e.target.value)} className={`${className} ${fremd ? 'border-amber-300 bg-amber-50' : ''}`} aria-label="Kategorie">
        {fremd && <option value={b.kategorie}>{b.kategorie} (anderer Satz)</option>}
        {kategorien.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {b.kategorieVorschlag && <span className="mt-0.5 block break-words text-[11px] text-amber-700">Vorschlag: {b.kategorieVorschlag}</span>}
    </>
  )
}

/** Betrag mit Komma eintippen; jede lesbare Eingabe zählt sofort in die Summen. */
function BetragFeld({ wert, onChange, className }: { wert: number; onChange: (n: number) => void; className: string }) {
  // Beim Tippen zählt der eigene Text; sonst wird immer der gespeicherte Betrag gezeigt.
  const [text, setText] = useState<string | null>(null)
  const ungueltig = text !== null && leseBetrag(text) === null
  return (
    <input
      inputMode="decimal"
      value={text ?? betragAlsEingabe(wert)}
      onFocus={() => setText(betragAlsEingabe(wert))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value)
        const n = leseBetrag(e.target.value)
        if (n !== null) onChange(n)
      }}
      className={`${className} ${wert < 0 ? 'text-rose-600' : 'text-emerald-700'} ${ungueltig ? 'border-rose-300' : ''}`}
      aria-label="Betrag"
    />
  )
}

function Kachel({ label, wert, ton }: { label: string; wert: string; ton?: 'plus' | 'minus' }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="truncate text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 break-words text-sm font-semibold tabular-nums ${ton === 'plus' ? 'text-emerald-700' : ton === 'minus' ? 'text-rose-600' : 'text-slate-900'}`}>{wert}</p>
    </div>
  )
}

function farbe(n: number): string {
  return n < 0 ? 'text-rose-600' : n > 0 ? 'text-emerald-700' : 'text-slate-300'
}

function Uebersichten({ a }: { a: ReturnType<typeof werteAus> }) {
  const w = a.waehrung
  return (
    <>
      <Card className="p-3 sm:p-4">
        <h5 className="mb-2 text-sm font-semibold text-slate-700">Nach Kategorie und Monat</h5>
        <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-2 py-2 sm:px-3 font-medium">Kategorie</th>
                {a.monate.map((m) => (
                  <th key={m} className="whitespace-nowrap px-2 py-2 sm:px-3 text-right font-medium">
                    {monatLabel(m)}
                  </th>
                ))}
                <th className="px-2 py-2 sm:px-3 text-right font-medium">Gesamt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {a.pivot.map((z) => (
                <tr key={z.kategorie}>
                  <td className="sticky left-0 max-w-[10rem] bg-white px-2 py-1.5 sm:px-3 text-slate-700 sm:max-w-none sm:whitespace-nowrap">{z.kategorie}</td>
                  {a.monate.map((m) => (
                    <td key={m} className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right ${farbe(z.jeMonat[m] ?? 0)}`}>
                      {z.jeMonat[m] ? fmtBetrag(z.jeMonat[m], w) : '–'}
                    </td>
                  ))}
                  <td className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right font-semibold ${farbe(z.summe)}`}>{fmtBetrag(z.summe, w)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="sticky left-0 bg-slate-50 px-2 py-1.5 sm:px-3 text-slate-700">Gesamt</td>
                {a.monate.map((m) => (
                  <td key={m} className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right ${farbe(a.pivotSummen[m] ?? 0)}`}>
                    {fmtBetrag(a.pivotSummen[m] ?? 0, w)}
                  </td>
                ))}
                <td className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right ${farbe(a.pivotGesamt)}`}>{fmtBetrag(a.pivotGesamt, w)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">{UMBUCHUNG_HINWEIS}</p>
      </Card>

      <Card className="p-3 sm:p-4">
        <h5 className="mb-2 text-sm font-semibold text-slate-700">Monatsübersicht</h5>
        <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2 sm:px-3 font-medium">Monat</th>
                <th className="px-2 py-2 sm:px-3 text-right font-medium">Einnahmen</th>
                <th className="px-2 py-2 sm:px-3 text-right font-medium">Ausgaben</th>
                <th className="px-2 py-2 sm:px-3 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {a.monatlich.map((m) => (
                <tr key={m.monat}>
                  <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 text-slate-700">{monatLabel(m.monat)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 text-right text-emerald-700">{fmtBetrag(m.einnahmen, w)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 text-right text-rose-600">{fmtBetrag(m.ausgaben, w)}</td>
                  <td className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right font-medium ${farbe(m.saldo)}`}>{fmtBetrag(m.saldo, w)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-2 py-1.5 sm:px-3 text-slate-700">Gesamt</td>
                <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 text-right text-emerald-700">{fmtBetrag(a.summen.einnahmen, w)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 sm:px-3 text-right text-rose-600">{fmtBetrag(a.summen.ausgaben, w)}</td>
                <td className={`whitespace-nowrap px-2 py-1.5 sm:px-3 text-right ${farbe(a.summen.saldo)}`}>{fmtBetrag(a.summen.saldo, w)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">Ohne „Umbuchung & Eigenübertrag“.</p>
      </Card>
    </>
  )
}
