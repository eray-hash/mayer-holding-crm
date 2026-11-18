// Drehung von JPEG-Fotos über die Ausrichtungs-Angabe in den Bilddaten (EXIF "Orientation", Tag 0x0112).
//
// Warum keine Pixel-Drehung: Ein Handyfoto hat 12 Millionen Bildpunkte und mehr. Es zu entpacken, zu
// drehen und neu zu verpacken kostete im Test mit der bekannten reinen JavaScript-Bibliothek "jimp"
// (1.6) schon auf einem schnellen Rechner rund 1,4 Sekunden Rechenzeit und gut 100 MB Speicher; die
// Edge-Laufzeit erlaubt je Anfrage 2 Sekunden Rechenzeit und 256 MB. Das wäre bei großen Fotos ein
// Abbruch mitten im Eingang. Die Ausrichtungs-Angabe dagegen ist ein einziger Zahlenwert in der
// Datei: Ihn zu setzen ändert kein Bildpixel, verliert keine Qualität und kostet nichts. Alle
// aktuellen Browser (und damit das CRM) zeigen das Foto danach richtig herum an.
//
// Werte: 1 = normal, 3 = um 180° drehen, 6 = um 90° im Uhrzeigersinn drehen, 8 = um 270° im
// Uhrzeigersinn (90° gegen den Uhrzeigersinn). 2, 4, 5, 7 sind gespiegelte Varianten.

const SOI = 0xffd8

type Fundstelle = { wert: number; offset: number; little: boolean }

function lies16(b: Uint8Array, i: number, little: boolean): number {
  return little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]
}

function lies32(b: Uint8Array, i: number, little: boolean): number {
  return little ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}

export function istJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && ((bytes[0] << 8) | bytes[1]) === SOI && bytes[2] === 0xff
}

// Läuft die Segmente bis zum Bildbeginn (SOS) ab. Liefert die APP1-Exif-Segmente und die Stelle,
// an der ein neues Segment eingefügt werden kann (nach SOI und einem eventuellen JFIF-APP0).
function segmente(bytes: Uint8Array): { exif: { start: number; ende: number }[]; einfuegen: number } | null {
  if (!istJpeg(bytes)) return null
  const exif: { start: number; ende: number }[] = []
  let einfuegen = 2
  let i = 2
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null // kaputte Struktur: lieber nichts anfassen
    const marker = bytes[i + 1]
    if (marker === 0xff) {
      i++ // Füllbyte
      continue
    }
    if (marker === 0xda || marker === 0xd9) break // Bilddaten beginnen bzw. Dateiende
    const laenge = (bytes[i + 2] << 8) | bytes[i + 3]
    if (laenge < 2 || i + 2 + laenge > bytes.length) return null
    const start = i + 4
    const ende = i + 2 + laenge
    if (marker === 0xe0 && i === 2) einfuegen = ende
    if (marker === 0xe1 && ende - start >= 14 && bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66 && bytes[start + 4] === 0 && bytes[start + 5] === 0) {
      exif.push({ start: start + 6, ende })
    }
    i = ende
  }
  return { exif, einfuegen }
}

// Sucht im ersten Verzeichnis (IFD0) der Exif-Daten den Eintrag 0x0112.
function findeAusrichtung(bytes: Uint8Array, tiff: { start: number; ende: number }): Fundstelle | 'ohne' | null {
  const t = tiff.start
  const little = bytes[t] === 0x49 && bytes[t + 1] === 0x49
  const big = bytes[t] === 0x4d && bytes[t + 1] === 0x4d
  if (!little && !big) return null
  if (lies16(bytes, t + 2, little) !== 42) return null
  const ifd = t + lies32(bytes, t + 4, little)
  if (ifd + 2 > tiff.ende) return null
  const anzahl = lies16(bytes, ifd, little)
  for (let n = 0; n < anzahl; n++) {
    const e = ifd + 2 + n * 12
    if (e + 12 > tiff.ende) return null
    if (lies16(bytes, e, little) !== 0x0112) continue
    if (lies16(bytes, e + 2, little) !== 3) return null // Typ SHORT erwartet
    const wert = lies16(bytes, e + 8, little)
    return { wert, offset: e + 8, little }
  }
  return 'ohne'
}

/** Ausrichtung laut Exif (1–8); 1, wenn keine Angabe vorhanden ist; null bei nicht lesbarer Datei. */
export function jpegAusrichtung(bytes: Uint8Array): number | null {
  const s = segmente(bytes)
  if (!s) return null
  for (const tiff of s.exif) {
    const f = findeAusrichtung(bytes, tiff)
    if (f && f !== 'ohne') return f.wert >= 1 && f.wert <= 8 ? f.wert : 1
  }
  return 1
}

/** Ausrichtungs-Wert für eine Drehung im Uhrzeigersinn (0/90/180/270). */
export function ausrichtungFuerDrehung(grad: number): number {
  return grad === 90 ? 6 : grad === 180 ? 3 : grad === 270 ? 8 : 1
}

/**
 * Setzt die Ausrichtung eines JPEG, ohne ein Bildpixel anzufassen. Vorhandene Angabe: wird ersetzt.
 * Gar keine Exif-Daten: ein kleiner Exif-Block wird eingefügt. Exif-Daten ohne Ausrichtungs-Eintrag
 * oder eine Datei, deren Aufbau nicht eindeutig lesbar ist: null (die Datei bleibt dann, wie sie ist).
 */
export function setzeJpegAusrichtung(bytes: Uint8Array, wert: number): Uint8Array | null {
  if (!Number.isInteger(wert) || wert < 1 || wert > 8) return null
  const s = segmente(bytes)
  if (!s) return null
  for (const tiff of s.exif) {
    const f = findeAusrichtung(bytes, tiff)
    if (f === null) return null
    if (f === 'ohne') return null
    const neu = bytes.slice()
    if (f.little) {
      neu[f.offset] = wert & 0xff
      neu[f.offset + 1] = 0
    } else {
      neu[f.offset] = 0
      neu[f.offset + 1] = wert & 0xff
    }
    return neu
  }
  // Kein Exif-Block: "Exif\0\0" + TIFF-Kopf (MM, 42, Verzeichnis ab 8) + ein Eintrag + Ende-Zeiger.
  const nutzlast = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, wert, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]
  const laenge = nutzlast.length + 2
  const segment = new Uint8Array([0xff, 0xe1, laenge >> 8, laenge & 0xff, ...nutzlast])
  const neu = new Uint8Array(bytes.length + segment.length)
  neu.set(bytes.subarray(0, s.einfuegen), 0)
  neu.set(segment, s.einfuegen)
  neu.set(bytes.subarray(s.einfuegen), s.einfuegen + segment.length)
  return neu
}

/**
 * Richtet ein eingegangenes JPEG-Foto nach der erkannten Drehung (Grad im Uhrzeigersinn, damit der
 * Text aufrecht steht) aus. Nur, wenn das Foto noch keine eigene Drehangabe trägt: Hat die Kamera
 * schon eine gesetzt, zeigt der Browser das Foto danach gedreht an, und ob die Erkennung das Foto
 * vor oder nach dieser Drehung gesehen hat, ist nicht sicher — dann bleibt die Kamera-Angabe stehen.
 * Liefert die neuen Bytes oder null, wenn nichts geändert wurde.
 */
export function richteFotoAus(bytes: Uint8Array, grad: number): Uint8Array | null {
  const ziel = ausrichtungFuerDrehung(grad)
  if (ziel === 1) return null
  if (jpegAusrichtung(bytes) !== 1) return null
  return setzeJpegAusrichtung(bytes, ziel)
}
