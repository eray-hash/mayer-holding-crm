// Kleiner ZIP-Schreiber ohne fremde Bibliothek (22.11.2026, Export für den Steuerberater).
// Speichert die Dateien unkomprimiert (Verfahren „stored“): Die Belege sind fast alle PDFs und Fotos,
// die schon gepackt sind — Komprimieren brächte kaum etwas. Dateinamen in UTF-8 (Kennzeichen Bit 11),
// damit Umlaute unter Windows und macOS richtig erscheinen. Keine ZIP64-Erweiterung: Grenze 4 GB je
// Datei und 65 535 Dateien — für einen Monat oder ein Quartal Belege weit genug.
// Läuft im Browser (CRM) und in Deno (Tests); nur Uint8Array/TextEncoder, kein Node.

export type ZipEintrag = { name: string; inhalt: Uint8Array; datum?: Date }

let crcTabelle: Uint32Array | null = null

/** CRC-32 (Polynom 0xEDB88320), wie ZIP es verlangt. */
export function crc32(daten: Uint8Array): number {
  if (!crcTabelle) {
    crcTabelle = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTabelle[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < daten.length; i++) crc = crcTabelle[(crc ^ daten[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Datum/Uhrzeit im MS-DOS-Format (lokale Zeit, 2-Sekunden-Schritte, ab 1980). */
function dosZeit(d: Date): { zeit: number; datum: number } {
  const jahr = Math.max(1980, d.getFullYear())
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    datum: ((jahr - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Pfad sauber machen: Schrägstriche vorwärts, keine führenden „/“, kein „..“. */
export function zipPfad(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t && t !== '.' && t !== '..')
    .join('/')
}

/** Baut die ZIP-Datei. Doppelte Namen sind ein Fehler (der Aufrufer macht sie vorher eindeutig). */
export function erstelleZip(eintraege: ZipEintrag[], jetzt = new Date()): Uint8Array {
  const kodierer = new TextEncoder()
  const namen = new Set<string>()
  const lokal: Uint8Array[] = []
  const zentral: Uint8Array[] = []
  let versatz = 0

  for (const e of eintraege) {
    const name = zipPfad(e.name)
    if (!name) throw new Error('ZIP: leerer Dateiname')
    if (namen.has(name)) throw new Error(`ZIP: Dateiname doppelt: ${name}`)
    namen.add(name)
    const nameBytes = kodierer.encode(name)
    const crc = crc32(e.inhalt)
    const groesse = e.inhalt.length
    const { zeit, datum } = dosZeit(e.datum ?? jetzt)

    const kopf = new Uint8Array(30 + nameBytes.length)
    const k = new DataView(kopf.buffer)
    k.setUint32(0, 0x04034b50, true) // Kennung lokaler Kopf
    k.setUint16(4, 20, true) // benötigte Version 2.0
    k.setUint16(6, 0x0800, true) // Bit 11: Namen in UTF-8
    k.setUint16(8, 0, true) // Verfahren 0 = unkomprimiert
    k.setUint16(10, zeit, true)
    k.setUint16(12, datum, true)
    k.setUint32(14, crc, true)
    k.setUint32(18, groesse, true)
    k.setUint32(22, groesse, true)
    k.setUint16(26, nameBytes.length, true)
    k.setUint16(28, 0, true)
    kopf.set(nameBytes, 30)

    const z = new Uint8Array(46 + nameBytes.length)
    const v = new DataView(z.buffer)
    v.setUint32(0, 0x02014b50, true) // Kennung zentrales Verzeichnis
    v.setUint16(4, 20, true) // erstellt mit Version 2.0
    v.setUint16(6, 20, true)
    v.setUint16(8, 0x0800, true)
    v.setUint16(10, 0, true)
    v.setUint16(12, zeit, true)
    v.setUint16(14, datum, true)
    v.setUint32(16, crc, true)
    v.setUint32(20, groesse, true)
    v.setUint32(24, groesse, true)
    v.setUint16(28, nameBytes.length, true)
    v.setUint16(30, 0, true) // Zusatzfeld
    v.setUint16(32, 0, true) // Kommentar
    v.setUint16(34, 0, true) // Datenträger
    v.setUint16(36, 0, true) // interne Merkmale
    v.setUint32(38, 0, true) // externe Merkmale
    v.setUint32(42, versatz, true)
    z.set(nameBytes, 46)

    lokal.push(kopf, e.inhalt)
    zentral.push(z)
    versatz += kopf.length + groesse
  }
  if (eintraege.length > 0xffff) throw new Error('ZIP: zu viele Dateien')
  if (versatz > 0xffffffff) throw new Error('ZIP: zu groß (über 4 GB)')

  const zentralGroesse = zentral.reduce((s, x) => s + x.length, 0)
  const ende = new Uint8Array(22)
  const en = new DataView(ende.buffer)
  en.setUint32(0, 0x06054b50, true)
  en.setUint16(4, 0, true)
  en.setUint16(6, 0, true)
  en.setUint16(8, eintraege.length, true)
  en.setUint16(10, eintraege.length, true)
  en.setUint32(12, zentralGroesse, true)
  en.setUint32(16, versatz, true)
  en.setUint16(20, 0, true)

  const gesamt = new Uint8Array(versatz + zentralGroesse + ende.length)
  let pos = 0
  for (const teil of [...lokal, ...zentral, ende]) {
    gesamt.set(teil, pos)
    pos += teil.length
  }
  return gesamt
}

/** Liest die Namen und Inhalte einer mit erstelleZip gebauten Datei zurück (nur für Tests und Prüfungen). */
export function leseZip(daten: Uint8Array): { name: string; inhalt: Uint8Array; crcStimmt: boolean }[] {
  const dv = new DataView(daten.buffer, daten.byteOffset, daten.byteLength)
  let endePos = -1
  for (let i = daten.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      endePos = i
      break
    }
  }
  if (endePos < 0) throw new Error('ZIP: Ende nicht gefunden')
  const anzahl = dv.getUint16(endePos + 10, true)
  let pos = dv.getUint32(endePos + 16, true)
  const dekodierer = new TextDecoder()
  const aus: { name: string; inhalt: Uint8Array; crcStimmt: boolean }[] = []
  for (let i = 0; i < anzahl; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) throw new Error('ZIP: Verzeichnis beschädigt')
    const crc = dv.getUint32(pos + 16, true)
    const groesse = dv.getUint32(pos + 20, true)
    const nameLaenge = dv.getUint16(pos + 28, true)
    const extra = dv.getUint16(pos + 30, true)
    const kommentar = dv.getUint16(pos + 32, true)
    const lokalPos = dv.getUint32(pos + 42, true)
    const name = dekodierer.decode(daten.subarray(pos + 46, pos + 46 + nameLaenge))
    const lNameLaenge = dv.getUint16(lokalPos + 26, true)
    const lExtra = dv.getUint16(lokalPos + 28, true)
    const start = lokalPos + 30 + lNameLaenge + lExtra
    const inhalt = daten.subarray(start, start + groesse)
    aus.push({ name, inhalt, crcStimmt: crc32(inhalt) === crc })
    pos += 46 + nameLaenge + extra + kommentar
  }
  return aus
}
