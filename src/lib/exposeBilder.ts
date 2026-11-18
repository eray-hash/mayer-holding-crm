// Bilder für das Exposé-PDF: aus der geschützten Ablage über einen kurz gültigen Link holen, richtig
// drehen (Handyfotos tragen die Ausrichtung nur als Zusatzangabe), auf das gewünschte Seitenverhältnis
// zuschneiden, verkleinern und als JPEG pressen — damit das PDF auch mit sieben Fotos klein bleibt
// (Ziel: deutlich unter 5 MB, auch als Mailanhang).
import type { Dokument, Vorlage } from '../types'
import type { ExposeBild } from './exposePdf'
import { erzeugeDownloadUrl } from './objektDokumenteStorage'
import { erzeugeKundenDownloadUrl } from './kundenDokumenteStorage'
import { brauchtDateiLink, holeAnhangUrl } from './emailGateway'

const BILD_ENDUNG = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i

/** Ist dieses Dokument (vermutlich) ein Foto? */
export function istBild(d: Dokument): boolean {
  return !!d.url && (d.typ.toLowerCase().startsWith('image/') || BILD_ENDUNG.test(d.name) || BILD_ENDUNG.test(d.url))
}

/** Kurz gültiger Link auf eine Datei eines Objekts (eigene Ablage oder gemeinsame Ablage). */
export async function objektDateiUrl(d: Dokument): Promise<string> {
  if (!d.url) throw new Error('Datei ohne Ablageort.')
  return brauchtDateiLink(d.url) ? holeAnhangUrl(d.url) : erzeugeDownloadUrl(d.url)
}

async function ladeBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Datei nicht abrufbar (${res.status})`)
  return res.blob()
}

type Quelle = { bild: CanvasImageSource; breite: number; hoehe: number; schliessen: () => void }

/** Dekodiert ein Bild mit der richtigen Ausrichtung (EXIF). Erst createImageBitmap, sonst ein <img>. */
async function dekodiere(blob: Blob): Promise<Quelle> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    return { bild: bitmap, breite: bitmap.width, hoehe: bitmap.height, schliessen: () => bitmap.close() }
  } catch {
    // z. B. SVG oder ältere Browser: <img> beachtet die Ausrichtung in aktuellen Browsern von selbst.
    const adresse = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = adresse
      await img.decode()
      return { bild: img, breite: img.naturalWidth, hoehe: img.naturalHeight, schliessen: () => URL.revokeObjectURL(adresse) }
    } catch {
      URL.revokeObjectURL(adresse)
      throw new Error('Dieses Bildformat kann der Browser nicht lesen (z. B. HEIC außerhalb von Safari).')
    }
  }
}

/** Schneidet mittig auf `verhaeltnis` (Breite/Höhe) zu, verkleinert auf höchstens `maxBreite` und
 *  presst als JPEG unter `maxBytes` (Qualität schrittweise herunter). */
function alsJpeg(q: Quelle, verhaeltnis: number | null, maxBreite: number, maxBytes: number): ExposeBild {
  let sx = 0
  let sy = 0
  let sw = q.breite
  let sh = q.hoehe
  if (verhaeltnis) {
    if (sw / sh > verhaeltnis) {
      sw = Math.round(sh * verhaeltnis)
      sx = Math.round((q.breite - sw) / 2)
    } else {
      sh = Math.round(sw / verhaeltnis)
      sy = Math.round((q.hoehe - sh) / 2)
    }
  }
  let zielB = Math.min(maxBreite, sw)
  for (let versuch = 0; versuch < 3; versuch++) {
    const zielH = Math.max(1, Math.round((zielB * sh) / sw))
    const canvas = document.createElement('canvas')
    canvas.width = zielB
    canvas.height = zielH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.')
    ctx.fillStyle = '#ffffff' // transparente PNGs bekommen weißen statt schwarzen Grund
    ctx.fillRect(0, 0, zielB, zielH)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(q.bild, sx, sy, sw, sh, 0, 0, zielB, zielH)
    for (const qualitaet of [0.82, 0.72, 0.62, 0.52]) {
      const dataUrl = canvas.toDataURL('image/jpeg', qualitaet)
      if (dataUrl.length * 0.75 <= maxBytes) return { dataUrl, breite: zielB, hoehe: zielH }
    }
    zielB = Math.round(zielB * 0.75)
  }
  const canvas = document.createElement('canvas')
  canvas.width = zielB
  canvas.height = Math.round((zielB * sh) / sw)
  canvas.getContext('2d')?.drawImage(q.bild, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.5), breite: canvas.width, hoehe: canvas.height }
}

export type BildArt = 'titel' | 'galerie'

/** Holt ein Foto des Objekts und bereitet es für das PDF auf: Titelbild 3:2 bis 1600 Pixel breit
 *  (höchstens etwa 450 KB), Bilderseite 4:3 bis 1000 Pixel (höchstens etwa 230 KB). */
export async function ladeExposeBild(d: Dokument, art: BildArt): Promise<ExposeBild> {
  const blob = await ladeBlob(await objektDateiUrl(d))
  const q = await dekodiere(blob)
  try {
    return art === 'titel' ? alsJpeg(q, 1.5, 1600, 450_000) : alsJpeg(q, 4 / 3, 1000, 230_000)
  } finally {
    q.schliessen()
  }
}

/** Ein Logo aus den Vorlagen der Immobilienabteilung: Datei-Vorlage, deren Name „Logo“ oder „Briefbogen“
 *  enthält und die ein Bild ist (ein Briefbogen als PDF oder Word lässt sich nicht einsetzen). */
export function findeLogoVorlage(vorlagen: Vorlage[]): Vorlage | undefined {
  const bild = (v: Vorlage) => !!v.datei && (v.datei.typ.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(v.datei.name))
  const kandidaten = vorlagen.filter((v) => bild(v) && /logo|briefbogen/i.test(`${v.name} ${v.datei?.name ?? ''}`))
  // „Logo“ vor „Briefbogen“ — ein ganzer Briefbogen als Bild wäre oben im Exposé zu groß.
  return kandidaten.find((v) => /logo/i.test(`${v.name} ${v.datei?.name ?? ''}`)) ?? kandidaten[0]
}

/** Logo als PNG (Transparenz bleibt), höchstens 600 Pixel breit. Fehler → ohne Logo. */
export async function ladeLogo(v: Vorlage): Promise<ExposeBild | undefined> {
  if (!v.datei) return undefined
  try {
    const blob = await ladeBlob(await erzeugeKundenDownloadUrl(v.datei.pfad))
    const q = await dekodiere(blob)
    try {
      const b = Math.min(600, q.breite)
      const h = Math.max(1, Math.round((b * q.hoehe) / q.breite))
      const canvas = document.createElement('canvas')
      canvas.width = b
      canvas.height = h
      canvas.getContext('2d')?.drawImage(q.bild, 0, 0, b, h)
      return { dataUrl: canvas.toDataURL('image/png'), breite: b, hoehe: h }
    } finally {
      q.schliessen()
    }
  } catch {
    return undefined
  }
}
