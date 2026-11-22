// Fotos einer Objektakte verwalten (22.11.2026): alle Bilder des Ordners „Bilder“ als Kacheln, Reihenfolge
// per Ziehen (am Rechner) oder mit den Pfeilen (am Handy), „Als Titelbild“, Drehen, Beschriftung und
// „Im Exposé“ je Foto, dazu mehrere Fotos auf einmal hochladen. Große Handyfotos werden vor dem Hochladen
// im Browser auf höchstens 2400 Pixel (lange Kante) verkleinert und als JPEG gespeichert — richtig herum,
// denn das Dekodieren beachtet die Ausrichtungs-Angabe der Kamera.
//
// Gespeichert wird in objekte.bilder_reihenfolge (Form und Regeln: supabase/functions/_shared/bilderReihenfolge.ts),
// direkt und nur diese eine Spalte — vor jedem Schreiben frisch gelesen, damit eine gleichzeitige Änderung
// (z. B. Fotos per Telegram) nicht verloren geht. Beide Exposé-Erzeuger (CRM und Assistent) nehmen das
// erste Foto als Titelbild, lassen „nicht im Exposé“ weg und drehen wie hier eingestellt.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ImageOff, RotateCw, Star, Upload } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, SecondaryButton } from './ui'
import { supabase } from '../lib/supabaseClient'
import { ladeObjektDokumentHoch } from '../lib/objektDokumenteStorage'
import { brauchtDateiLink, holeAnhangUrl } from '../lib/emailGateway'
import { dekodiere, istBild, reihenfolgeVon } from '../lib/exposeBilder'
import { today, uid } from '../lib/dates'
import {
  alsTitelbild,
  aendereEintrag,
  type BildEintrag,
  dreheWeiter,
  haengeAn,
  MAX_BESCHRIFTUNG,
  neueReihenfolge,
  normaleDrehung,
  ordneBilder,
  verschiebe,
} from '../../supabase/functions/_shared/bilderReihenfolge.ts'
import type { Dokument, Objekt } from '../types'

const EIMER = 'objekt-dokumente'
/** Lange Kante nach dem Verkleinern. */
const MAX_KANTE = 2400
/** Kleinere JPEG/PNG bleiben unverändert (ihre Ausrichtungs-Angabe beachten alle Anzeigen). */
const OHNE_VERKLEINERN_BIS = 3 * 1024 * 1024
const HOECHSTENS_DATEIEN = 40

function formatiereGroesse(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Dateiname ohne Umlaute und Sonderzeichen (die Ablage lehnt manche ab). */
function sichererName(name: string): string {
  const s = name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '')
  return s.slice(-100) || 'foto.jpg'
}

/**
 * Verkleinert ein großes Foto auf höchstens MAX_KANTE Pixel (lange Kante) und speichert es als JPEG — die
 * Ausrichtung der Kamera ist dabei schon angewendet. Kleine JPEG/PNG bleiben, wie sie sind. Kann der
 * Browser das Format nicht lesen (z. B. HEIC außerhalb von Safari), geht das Original hoch.
 */
async function bereiteVor(datei: File): Promise<{ datei: File; verkleinert: boolean; unlesbar: boolean }> {
  const istJpegOderPng = /^image\/(jpeg|png)$/i.test(datei.type) || /\.(jpe?g|png)$/i.test(datei.name)
  let q: Awaited<ReturnType<typeof dekodiere>>
  try {
    q = await dekodiere(datei)
  } catch {
    return { datei, verkleinert: false, unlesbar: true }
  }
  try {
    const lang = Math.max(q.breite, q.hoehe)
    if (istJpegOderPng && lang <= MAX_KANTE && datei.size <= OHNE_VERKLEINERN_BIS) return { datei, verkleinert: false, unlesbar: false }
    const faktor = Math.min(1, MAX_KANTE / lang)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(q.breite * faktor))
    canvas.height = Math.max(1, Math.round(q.hoehe * faktor))
    const ctx = canvas.getContext('2d')
    if (!ctx) return { datei, verkleinert: false, unlesbar: false }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(q.bild, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    canvas.width = 0
    canvas.height = 0
    if (!blob) return { datei, verkleinert: false, unlesbar: false }
    const stamm = datei.name.replace(/\.[A-Za-z0-9]{1,6}$/, '') || 'foto'
    return { datei: new File([blob], `${stamm}.jpg`, { type: 'image/jpeg' }), verkleinert: true, unlesbar: false }
  } finally {
    q.schliessen()
  }
}

/** Kleines Vorschaubild: erst über die Bildbearbeitung der Ablage (klein), sonst das Original. Neu angelegt je Ablageort (key). */
function Kachelbild({ d, drehung, abgeblendet }: { d: Dokument; drehung: number; abgeblendet: boolean }) {
  const [urls, setUrls] = useState<string[]>([])
  const [stufe, setStufe] = useState(0)
  useEffect(() => {
    let aktiv = true
    ;(async () => {
      if (!d.url) return
      if (brauchtDateiLink(d.url)) {
        const u = await holeAnhangUrl(d.url)
        if (aktiv) setUrls([u])
        return
      }
      if (!supabase) return
      const liste: string[] = []
      const klein = await supabase.storage.from(EIMER).createSignedUrl(d.url, 60 * 30, { transform: { width: 480, height: 480, resize: 'cover', quality: 70 } })
      if (!klein.error && klein.data?.signedUrl) liste.push(klein.data.signedUrl)
      const gross = await supabase.storage.from(EIMER).createSignedUrl(d.url, 60 * 30)
      if (!gross.error && gross.data?.signedUrl) liste.push(gross.data.signedUrl)
      if (aktiv) setUrls(liste)
    })().catch(() => aktiv && setUrls([]))
    return () => {
      aktiv = false
    }
  }, [d.url])
  const url = urls[stufe]
  return (
    <span className={`relative block aspect-square w-full overflow-hidden rounded-t-lg bg-slate-100 ${abgeblendet ? 'opacity-50' : ''}`}>
      {url ? (
        <img
          src={url}
          alt={d.name}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform"
          style={drehung ? { transform: `rotate(${drehung}deg)` } : undefined}
          onError={() => setStufe((s) => s + 1)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-slate-300">
          <ImageOff size={20} />
        </span>
      )}
    </span>
  )
}

function Beschriftung({ wert, onSpeichern, deaktiviert }: { wert: string; onSpeichern: (t: string) => void; deaktiviert: boolean }) {
  // Neu angelegt, wenn sich der gespeicherte Text ändert (key an der Aufrufstelle).
  const [entwurf, setEntwurf] = useState(wert)
  const speichern = () => {
    const t = entwurf.replace(/\s+/g, ' ').trim()
    if (t !== wert) onSpeichern(t)
  }
  return (
    <input
      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-accent-400"
      value={entwurf}
      maxLength={MAX_BESCHRIFTUNG}
      placeholder="Beschriftung, z. B. Küche"
      disabled={deaktiviert}
      onChange={(e) => setEntwurf(e.target.value)}
      onBlur={speichern}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      aria-label="Beschriftung des Fotos"
    />
  )
}

export function ObjektBilderVerwalten({ objekt }: { objekt: Objekt }) {
  const { dispatch } = useApp()
  const bilder = useMemo(() => (objekt.dokumente.Bilder ?? []).filter(istBild), [objekt.dokumente.Bilder])
  // Stand der Spalte: aus dem geladenen Objekt (falls schon mitgeladen), dann frisch aus der Datenbank.
  const [roh, setRoh] = useState<unknown>(() => reihenfolgeVon(objekt))
  const [arbeitet, setArbeitet] = useState(false)
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')
  const [gezogen, setGezogen] = useState<string | null>(null)
  const [ziel, setZiel] = useState<string | null>(null)
  const eingabe = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let aktiv = true
    if (!supabase) return
    supabase
      .from('objekte')
      .select('bilder_reihenfolge')
      .eq('id', objekt.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (aktiv && !error && data) setRoh((data as { bilder_reihenfolge?: unknown }).bilder_reihenfolge ?? [])
      })
    return () => {
      aktiv = false
    }
  }, [objekt.id])

  const geordnet = useMemo(() => ordneBilder(bilder, roh), [bilder, roh])

  /** Liest den Stand frisch, wendet die Änderung an und schreibt nur die Spalte bilder_reihenfolge. */
  async function speichere(aenderung: (liste: Dokument[], frisch: unknown) => BildEintrag[], liste: Dokument[] = bilder): Promise<boolean> {
    if (!supabase) {
      setFehler('Die Datenbank ist nicht verbunden.')
      return false
    }
    setFehler('')
    setMeldung('')
    const { data, error } = await supabase.from('objekte').select('bilder_reihenfolge').eq('id', objekt.id).maybeSingle()
    if (error) {
      setFehler(`Die Reihenfolge ließ sich nicht laden: ${error.message}`)
      return false
    }
    const frisch = (data as { bilder_reihenfolge?: unknown } | null)?.bilder_reihenfolge ?? []
    const neu = aenderung(liste, frisch)
    const { error: schreibFehler } = await supabase.from('objekte').update({ bilder_reihenfolge: neu }).eq('id', objekt.id)
    if (schreibFehler) {
      setFehler(`Nicht gespeichert: ${schreibFehler.message}`)
      return false
    }
    setRoh(neu)
    // Damit das Exposé im selben Fenster gleich die neue Reihenfolge nimmt (die Spalte schreibt die
    // allgemeine Speicherung nicht mit, sie gehört dieser Ansicht und dem Server).
    dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { bilderReihenfolge: neu } as unknown as Partial<Objekt> })
    return true
  }

  const aendere = (f: (liste: Dokument[], frisch: unknown) => BildEintrag[]) => {
    if (arbeitet) return
    setArbeitet(true)
    void speichere(f).finally(() => setArbeitet(false))
  }

  function fallenLassen(zielId: string) {
    const quelle = gezogen
    setGezogen(null)
    setZiel(null)
    if (!quelle || quelle === zielId) return
    const ids = geordnet.map((g) => g.dok.id).filter((id) => id !== quelle)
    const stelle = ids.indexOf(zielId)
    // Nach vorn gezogen: vor das Ziel; nach hinten gezogen: hinter das Ziel.
    const vorher = geordnet.findIndex((g) => g.dok.id === quelle) > geordnet.findIndex((g) => g.dok.id === zielId)
    ids.splice(vorher ? stelle : stelle + 1, 0, quelle)
    aendere((l, f) => neueReihenfolge(l, f, ids))
  }

  async function hochladen(dateien: File[]) {
    const fotos = dateien.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(f.name)).slice(0, HOECHSTENS_DATEIEN)
    if (fotos.length === 0) {
      setFehler('Bitte Fotos auswählen (JPEG, PNG, HEIC …).')
      return
    }
    setArbeitet(true)
    setFehler('')
    setMeldung('')
    const neue: Dokument[] = []
    const fehlgeschlagen: string[] = []
    let unlesbar = 0
    try {
      for (let i = 0; i < fotos.length; i++) {
        setFortschritt(`Foto ${i + 1} von ${fotos.length} wird hochgeladen …`)
        try {
          const v = await bereiteVor(fotos[i])
          if (v.unlesbar) unlesbar++
          const datei = new File([v.datei], sichererName(v.datei.name), { type: v.datei.type || 'application/octet-stream' })
          const { pfad, groesse } = await ladeObjektDokumentHoch(objekt.id, datei)
          const dok: Dokument = { id: uid('dok'), name: v.datei.name, typ: datei.type, datum: today(), groesse: groesse || formatiereGroesse(datei.size), url: pfad }
          dispatch({ type: 'ADD_DOKUMENT', objektId: objekt.id, ordner: 'Bilder', dokument: dok })
          neue.push(dok)
        } catch (err) {
          fehlgeschlagen.push(`${fotos[i].name}${err instanceof Error ? ` (${err.message})` : ''}`)
        }
      }
      if (neue.length > 0) {
        setFortschritt('Reihenfolge wird gespeichert …')
        // Neue Fotos kommen hinten an — das Titelbild bleibt, wie es war.
        await speichere((l, f) => haengeAn(l, f, neue.map((d) => d.id)), [...bilder, ...neue])
        setMeldung(`${neue.length} ${neue.length === 1 ? 'Foto' : 'Fotos'} hochgeladen.${unlesbar ? ` ${unlesbar} davon konnte der Browser nicht anzeigen (z. B. HEIC) — sie liegen als Original in der Akte.` : ''}`)
      }
      if (fehlgeschlagen.length) setFehler(`Nicht hochgeladen: ${fehlgeschlagen.join(', ')}`)
    } finally {
      setFortschritt('')
      setArbeitet(false)
      if (eingabe.current) eingabe.current.value = ''
    }
  }

  const imExpose = geordnet.filter((g) => g.eintrag.im_expose !== false).length

  return (
    <Card className="mb-5 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700">Fotos</h3>
          <p className="text-xs text-slate-400">
            {bilder.length === 0
              ? 'Noch keine Fotos im Ordner „Bilder“.'
              : `${bilder.length} ${bilder.length === 1 ? 'Foto' : 'Fotos'}, ${imExpose} im Exposé · das erste ist das Titelbild · Reihenfolge per Ziehen oder mit den Pfeilen`}
          </p>
        </div>
        <SecondaryButton onClick={() => eingabe.current?.click()} disabled={arbeitet}>
          <Upload size={14} /> Fotos hochladen
        </SecondaryButton>
        <input
          ref={eingabe}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const liste = Array.from(e.target.files ?? [])
            if (liste.length) void hochladen(liste)
          }}
        />
      </div>

      {fortschritt && <p className="mb-3 text-xs font-medium text-accent-700" role="status">{fortschritt}</p>}
      {fehler && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">{fehler}</span>
        </div>
      )}
      {meldung && (
        <p className="mb-3 flex items-start gap-1.5 text-xs font-medium text-emerald-700" role="status">
          <Check size={14} className="mt-0.5 flex-shrink-0" /> <span className="min-w-0 break-words">{meldung}</span>
        </p>
      )}

      {bilder.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {geordnet.map((g, i) => {
            const d = g.dok
            const drehung = normaleDrehung(g.eintrag.drehung)
            const drin = g.eintrag.im_expose !== false
            return (
              <li
                key={d.id}
                draggable={!arbeitet}
                onDragStart={(e) => {
                  setGezogen(d.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', d.id)
                }}
                onDragEnd={() => {
                  setGezogen(null)
                  setZiel(null)
                }}
                onDragOver={(e) => {
                  if (!gezogen) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (ziel !== d.id) setZiel(d.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  fallenLassen(d.id)
                }}
                className={`flex flex-col rounded-lg border bg-white shadow-sm ${ziel === d.id && gezogen !== d.id ? 'border-accent-400 ring-2 ring-accent-100' : 'border-slate-200'} ${gezogen === d.id ? 'opacity-40' : ''}`}
              >
                <span className="relative block cursor-grab active:cursor-grabbing">
                  <Kachelbild key={d.url} d={d} drehung={drehung} abgeblendet={!drin} />
                  {i === 0 && (
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      <Star size={11} /> Titelbild
                    </span>
                  )}
                  {!drin && <span className="absolute right-1.5 top-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">nicht im Exposé</span>}
                </span>
                <div className="flex flex-1 flex-col gap-1.5 p-2">
                  <span className="truncate text-[11px] text-slate-400" title={d.name}>{d.name}</span>
                  <Beschriftung key={g.eintrag.beschriftung ?? ''} wert={g.eintrag.beschriftung ?? ''} deaktiviert={arbeitet} onSpeichern={(t) => aendere((l, f) => aendereEintrag(l, f, d.id, { beschriftung: t }))} />
                  <div className="flex items-center gap-0.5">
                    <button type="button" disabled={arbeitet || i === 0} onClick={() => aendere((l, f) => verschiebe(l, f, d.id, -1))} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Nach vorn" title="Nach vorn">
                      <ChevronLeft size={15} />
                    </button>
                    <button type="button" disabled={arbeitet || i === geordnet.length - 1} onClick={() => aendere((l, f) => verschiebe(l, f, d.id, 1))} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Nach hinten" title="Nach hinten">
                      <ChevronRight size={15} />
                    </button>
                    <button type="button" disabled={arbeitet} onClick={() => aendere((l, f) => dreheWeiter(l, f, d.id))} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label="Um 90 Grad drehen" title="Um 90 Grad drehen">
                      <RotateCw size={15} />
                    </button>
                    <button type="button" disabled={arbeitet || i === 0} onClick={() => aendere((l, f) => alsTitelbild(l, f, d.id))} className="rounded p-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-30" aria-label="Als Titelbild" title="Als Titelbild">
                      <Star size={15} />
                    </button>
                    <label className="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-slate-500" title="Kommt dieses Foto ins Exposé?">
                      <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-accent-600" checked={drin} disabled={arbeitet} onChange={(e) => aendere((l, f) => aendereEintrag(l, f, d.id, { im_expose: e.target.checked }))} />
                      Exposé
                    </label>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
