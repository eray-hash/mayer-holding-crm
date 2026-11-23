import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, CheckCircle2, Circle, FileUp, Loader2, Lock } from 'lucide-react'
import { holePublicUnterlagen, holeUnterlagenUploadUrl, ladeKundenUnterlageHoch, meldeKundenUnterlage, type PublicUnterlagen } from '../../lib/emailGateway'
import { SONSTIGE_UNTERLAGE } from '../../data/kundenUnterlagen'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'

// Öffentliche Hochlade-Seite für Unterlagen, die ein Mitarbeiter beim Kunden angefordert hat
// (KundeUnterlagenAnfordern.tsx). Ohne Login; der Schlüssel ist allein die geheime Kennung im Link.
// Gedacht für Menschen, die selten mit so etwas zu tun haben: große Knöpfe, einfache Wörter, ein Foto
// mit dem Handy genügt. Fotos werden im Browser verkleinert und als JPEG geschickt (auch HEIC vom iPhone,
// soweit das Gerät es lesen kann); PDF-Dateien gehen unverändert hoch.

const MAX_BYTES = 20 * 1024 * 1024
/** Kleinere JPEG/PNG gehen unverändert hoch, größere Fotos werden verkleinert. */
const UNVERAENDERT_BIS = 3 * 1024 * 1024
const LANGE_KANTE = 2400

type Vorbereitet = { blob: Blob; name: string; typ: string }

function istPdf(datei: File): boolean {
  return datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name)
}

function istBild(datei: File): boolean {
  return datei.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(datei.name)
}

function stammname(name: string): string {
  const ohne = name.replace(/\.[^./\\]+$/, '').trim()
  return ohne || 'Foto'
}

async function bildLesen(datei: File): Promise<{ bild: CanvasImageSource; breite: number; hoehe: number; freigeben: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(datei, { imageOrientation: 'from-image' })
      return { bild: bitmap, breite: bitmap.width, hoehe: bitmap.height, freigeben: () => bitmap.close() }
    } catch {
      // weiter mit dem <img>-Weg (z. B. Safari bei HEIC)
    }
  }
  const adresse = URL.createObjectURL(datei)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('nicht lesbar'))
      el.src = adresse
    })
    return { bild: img, breite: img.naturalWidth, hoehe: img.naturalHeight, freigeben: () => URL.revokeObjectURL(adresse) }
  } catch (err) {
    URL.revokeObjectURL(adresse)
    throw err
  }
}

/** Macht aus der gewählten Datei etwas, das der Server annimmt: PDF unverändert, Fotos als JPEG oder PNG. */
async function vorbereiten(datei: File): Promise<Vorbereitet> {
  if (istPdf(datei)) {
    if (datei.size > MAX_BYTES) throw new Error('Diese PDF-Datei ist größer als 20 MB. Bitte schicken Sie sie in mehreren Teilen.')
    return { blob: datei, name: /\.pdf$/i.test(datei.name) ? datei.name : `${stammname(datei.name)}.pdf`, typ: 'application/pdf' }
  }
  if (!istBild(datei)) throw new Error('Bitte nur Fotos oder PDF-Dateien hochladen.')
  const schonPassend = (datei.type === 'image/jpeg' || datei.type === 'image/png') && datei.size <= UNVERAENDERT_BIS
  if (schonPassend) {
    const endung = datei.type === 'image/png' ? '.png' : '.jpg'
    return { blob: datei, name: /\.(jpe?g|png)$/i.test(datei.name) ? datei.name : `${stammname(datei.name)}${endung}`, typ: datei.type }
  }
  let gelesen: Awaited<ReturnType<typeof bildLesen>>
  try {
    gelesen = await bildLesen(datei)
  } catch {
    throw new Error('Dieses Bild kann Ihr Gerät leider nicht umwandeln. Bitte nehmen Sie es mit „Foto aufnehmen“ neu auf oder schicken Sie eine PDF-Datei.')
  }
  try {
    const faktor = Math.min(1, LANGE_KANTE / Math.max(gelesen.breite, gelesen.hoehe, 1))
    const breite = Math.max(1, Math.round(gelesen.breite * faktor))
    const hoehe = Math.max(1, Math.round(gelesen.hoehe * faktor))
    const canvas = document.createElement('canvas')
    canvas.width = breite
    canvas.height = hoehe
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('kein Zeichenbereich')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, breite, hoehe)
    ctx.drawImage(gelesen.bild, 0, 0, breite, hoehe)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('kein Bild')
    if (blob.size > MAX_BYTES) throw new Error('zu groß')
    return { blob, name: `${stammname(datei.name)}.jpg`, typ: 'image/jpeg' }
  } catch {
    throw new Error('Das Foto konnte nicht vorbereitet werden. Bitte versuchen Sie es noch einmal oder schicken Sie eine PDF-Datei.')
  } finally {
    gelesen.freigeben()
  }
}

// ── Bausteine ────────────────────────────────────────────────────────────────────────────────────

function HochladeKnoepfe({
  gesperrt,
  schonEtwas,
  onDateien,
}: {
  gesperrt: boolean
  schonEtwas: boolean
  onDateien: (dateien: File[]) => void
}) {
  const knopf =
    'flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold transition focus-within:ring-4'
  const aus = gesperrt ? 'pointer-events-none opacity-50' : ''
  function auswahl(e: React.ChangeEvent<HTMLInputElement>) {
    const dateien = Array.from(e.target.files ?? [])
    // Feld leeren, damit dieselbe Datei nach einem Fehler noch einmal gewählt werden kann.
    e.target.value = ''
    if (dateien.length > 0) onDateien(dateien)
  }
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className={`${knopf} ${aus} bg-accent-600 text-white hover:bg-accent-700 focus-within:ring-accent-200`}>
        <Camera size={20} className="flex-shrink-0" />
        {schonEtwas ? 'Weiteres Foto aufnehmen' : 'Foto aufnehmen'}
        <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={gesperrt} onChange={auswahl} />
      </label>
      <label className={`${knopf} ${aus} border-2 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-within:ring-slate-200`}>
        <FileUp size={20} className="flex-shrink-0" />
        {schonEtwas ? 'Weitere Datei wählen' : 'Datei wählen'}
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif"
          multiple
          className="sr-only"
          disabled={gesperrt}
          onChange={auswahl}
        />
      </label>
    </div>
  )
}

function PunktKarte({
  titel,
  text,
  erledigt,
  hochgeladen,
  laeuft,
  fortschritt,
  fehler,
  gesperrt,
  onDateien,
  freiwillig = false,
}: {
  titel: string
  text?: string
  /** Ohne „offen/erledigt": für sonstige Unterlagen, die niemand abhakt. */
  freiwillig?: boolean
  erledigt: boolean
  hochgeladen: string[]
  laeuft: boolean
  fortschritt: string
  fehler: string
  gesperrt: boolean
  onDateien: (dateien: File[]) => void
}) {
  return (
    <li className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${erledigt ? 'border-emerald-200' : 'border-slate-200'}`}>
      <div className="flex items-start gap-3">
        {erledigt ? (
          <CheckCircle2 size={26} className="mt-0.5 flex-shrink-0 text-emerald-600" />
        ) : freiwillig ? (
          <FileUp size={26} className="mt-0.5 flex-shrink-0 text-slate-400" />
        ) : (
          <Circle size={26} className="mt-0.5 flex-shrink-0 text-slate-300" />
        )}
        <div className="min-w-0 flex-1">
          <h3 lang="de" className="hyphens-auto break-words text-base font-semibold leading-snug text-slate-800">
            {titel}
          </h3>
          {text && <p className="mt-1 whitespace-pre-wrap break-words text-base text-slate-700">{text}</p>}
          {!freiwillig && <p className={`mt-1 text-sm font-medium ${erledigt ? 'text-emerald-700' : 'text-slate-500'}`}>{erledigt ? 'Erledigt – vielen Dank!' : 'Noch offen'}</p>}
        </div>
      </div>
      {hochgeladen.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {hochgeladen.map((n, i) => (
            <li key={`${n}-${i}`} className="flex items-start gap-1.5 break-all">
              <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" /> {n}
            </li>
          ))}
        </ul>
      )}
      {laeuft && (
        <p className="mt-3 flex items-center gap-2 text-base font-medium text-accent-700" role="status">
          <Loader2 size={18} className="animate-spin" /> {fortschritt}
        </p>
      )}
      {fehler && (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-base font-medium text-rose-700" role="alert">
          {fehler}
        </p>
      )}
      <HochladeKnoepfe gesperrt={gesperrt} schonEtwas={hochgeladen.length > 0 || erledigt} onDateien={onDateien} />
    </li>
  )
}

function Rahmen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-xl">
        <p className="mb-5 text-center text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
        {children}
      </div>
      <DatenschutzHinweis />
    </div>
  )
}

// ── Die Seite ────────────────────────────────────────────────────────────────────────────────────

export function PublicKundenUnterlagen() {
  const { token } = useParams()
  // Eigener Zustand je Link: ein anderer Link in derselben Seite beginnt von vorn.
  return <UnterlagenSeite key={token ?? ''} token={token ?? ''} />
}

function UnterlagenSeite({ token }: { token: string }) {
  const [daten, setDaten] = useState<PublicUnterlagen | null | undefined>(token ? undefined : null)
  const [ladeFehler, setLadeFehler] = useState(false)
  const [erledigt, setErledigt] = useState<Set<string>>(new Set())
  const [hochgeladen, setHochgeladen] = useState<Record<string, string[]>>({})
  const [aktiv, setAktiv] = useState<string | null>(null)
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!token) return
    let abgebrochen = false
    holePublicUnterlagen(token)
      .then((d) => {
        if (abgebrochen) return
        setDaten(d)
        if (d) setErledigt(new Set(d.punkte.filter((p) => p.erledigt).map((p) => p.name)))
      })
      .catch(() => {
        if (abgebrochen) return
        setLadeFehler(true)
        setDaten(null)
      })
    return () => {
      abgebrochen = true
    }
  }, [token])

  if (daten === undefined) {
    return (
      <Rahmen>
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      </Rahmen>
    )
  }

  if (!daten || !token) {
    return (
      <Rahmen>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-bold text-slate-800">{ladeFehler ? 'Die Seite lädt gerade nicht' : 'Dieser Link gilt nicht mehr'}</h1>
          <p className="text-base text-slate-600">
            {ladeFehler
              ? 'Bitte versuchen Sie es in ein paar Minuten noch einmal.'
              : 'Bitte fragen Sie bei uns nach einem neuen Link. Melden Sie sich einfach bei Ihrem Ansprechpartner.'}
          </p>
        </div>
      </Rahmen>
    )
  }

  const punkte = daten.punkte.map((p) => p.name)
  const fertigZahl = punkte.filter((p) => erledigt.has(p)).length
  const prozent = punkte.length === 0 ? 0 : Math.round((fertigZahl / punkte.length) * 100)
  const allesDa = punkte.length > 0 && fertigZahl === punkte.length

  async function hochladen(punkt: string, dateien: File[]) {
    if (aktiv || !token) return
    setAktiv(punkt)
    setFehler((f) => ({ ...f, [punkt]: '' }))
    try {
      for (let i = 0; i < dateien.length; i++) {
        setFortschritt(dateien.length > 1 ? `Wird hochgeladen … (${i + 1} von ${dateien.length})` : 'Wird hochgeladen …')
        const fertig = await vorbereiten(dateien[i])
        const ziel = await holeUnterlagenUploadUrl(token, punkt, fertig.name, fertig.blob.size)
        await ladeKundenUnterlageHoch(ziel.pfad, ziel.token, fertig.blob, fertig.typ, ziel.bucket)
        await meldeKundenUnterlage(token, punkt, { pfad: ziel.pfad, name: fertig.name })
        setHochgeladen((h) => ({ ...h, [punkt]: [...(h[punkt] ?? []), fertig.name] }))
        setErledigt((s) => new Set(s).add(punkt))
      }
    } catch (err) {
      const text = err instanceof Error && err.message ? err.message : ''
      setFehler((f) => ({
        ...f,
        [punkt]: text && !/fetch|network|failed/i.test(text) ? text : 'Das Hochladen hat nicht geklappt. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es noch einmal.',
      }))
    } finally {
      setAktiv(null)
      setFortschritt('')
    }
  }

  return (
    <Rahmen>
      <h1 className="text-2xl font-bold text-slate-800">Ihre Unterlagen</h1>
      <p className="mt-3 text-base leading-relaxed text-slate-700">
        Guten Tag{daten.vorname ? ` ${daten.vorname}` : ''},
        <br />
        hier können Sie uns die Unterlagen schicken, um die wir Sie gebeten haben{daten.firma ? ` (für ${daten.firma})` : ''}. Ein Foto mit dem Handy genügt. Eine
        Anmeldung ist nicht nötig.
      </p>

      {punkte.length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3 text-base">
            <span className="font-semibold text-slate-800">
              {fertigZahl} von {punkte.length} erledigt
            </span>
            <span className="font-semibold text-slate-500">{prozent} %</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prozent}>
            <div className={`h-full rounded-full transition-all ${allesDa ? 'bg-emerald-500' : 'bg-accent-500'}`} style={{ width: `${prozent}%` }} />
          </div>
        </div>
      )}

      {allesDa && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-base text-emerald-800">
          <CheckCircle2 size={24} className="mt-0.5 flex-shrink-0" />
          <p>
            <span className="font-semibold">Vielen Dank!</span> Alles, worum wir gebeten haben, ist bei uns angekommen. Sie können diese Seite jetzt schließen
            {daten.weitere ? ' – oder unten noch die weiteren Unterlagen schicken.' : '.'}
          </p>
        </div>
      )}

      {punkte.length > 0 && (
        <>
          <h2 className="mb-3 mt-7 text-lg font-semibold text-slate-800">Darum bitten wir Sie</h2>
          <ul className="space-y-4">
            {punkte.map((p) => (
              <PunktKarte
                key={p}
                titel={p}
                erledigt={erledigt.has(p)}
                hochgeladen={hochgeladen[p] ?? []}
                laeuft={aktiv === p}
                fortschritt={fortschritt}
                fehler={fehler[p] ?? ''}
                gesperrt={aktiv !== null}
                onDateien={(d) => hochladen(p, d)}
              />
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-3 mt-7 text-lg font-semibold text-slate-800">{daten.weitere ? 'Außerdem bitten wir um' : 'Sonstige Unterlage hochladen'}</h2>
      <ul>
        <PunktKarte
          titel={daten.weitere ? 'Weitere Unterlagen' : 'Etwas anderes schicken'}
          text={daten.weitere ?? 'Falls Sie uns noch etwas anderes schicken möchten, können Sie es hier hochladen.'}
          freiwillig
          erledigt={(hochgeladen[SONSTIGE_UNTERLAGE] ?? []).length > 0}
          hochgeladen={hochgeladen[SONSTIGE_UNTERLAGE] ?? []}
          laeuft={aktiv === SONSTIGE_UNTERLAGE}
          fortschritt={fortschritt}
          fehler={fehler[SONSTIGE_UNTERLAGE] ?? ''}
          gesperrt={aktiv !== null}
          onDateien={(d) => hochladen(SONSTIGE_UNTERLAGE, d)}
        />
      </ul>

      <div className="mt-8 space-y-2 text-center text-sm text-slate-500">
        <p>Erlaubt sind Fotos (JPG, PNG) und PDF-Dateien bis 20 MB. Mehrere Seiten können Sie nacheinander fotografieren.</p>
        <p>
          <Lock size={14} className="-mt-0.5 mr-1 inline-block align-middle" />
          Die Übertragung ist verschlüsselt. Ihre Dateien kommen direkt zu uns.
        </p>
        <p>Bei Fragen erreichen Sie uns unter den Ihnen bekannten Kontaktdaten der Andreas Mayer Holding.</p>
      </div>
    </Rahmen>
  )
}
