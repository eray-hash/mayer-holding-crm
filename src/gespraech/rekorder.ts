// Tonaufnahme in Abschnitten. Je Abschnitt läuft ein eigener MediaRecorder auf demselben Mikrofon-Strom;
// nach SEGMENT_MS reiner Aufnahmezeit wird er beendet und sofort ein neuer gestartet. So ist jeder Abschnitt
// eine vollständige, für sich lesbare Datei (Kopf + Ton) und bleibt weit unter der 20-MB-Grenze der
// Abschrift (48 kbit/s × 3 Min. ≈ 1,1 MB). Innerhalb eines Abschnitts liefert der Recorder alle TEIL_MS ein
// Teilstück, das sofort im Gerätespeicher landet — bricht etwas ab, fehlen höchstens die letzten Sekunden.
//
// Format: iPhone/Safari nimmt nur audio/mp4 zuverlässig auf, alle anderen audio/webm mit Opus.

export const SEGMENT_MS = 3 * 60_000
export const TEIL_MS = 5_000
const BITRATE = 48_000

/** Abschnitts- und Teillänge, die neue Rekorder verwenden (nur Tests verkürzen sie). */
export const ZEITEN = { segmentMs: SEGMENT_MS, teilMs: TEIL_MS }

export type SegmentInfo = { nr: number; mime: string; dauerMs: number; bytes: number; teile: number }

export type RekorderRueckrufe = {
  /** Neuer Abschnitt beginnt (vor dem ersten Teilstück). */
  beiSegmentStart: (nr: number, mime: string) => void | Promise<void>
  /** Ein Teilstück ist da — sofort sichern. */
  beiTeil: (nr: number, lfd: number, daten: Blob) => Promise<void>
  /** Ein Abschnitt ist abgeschlossen (alle Teilstücke wurden vorher über beiTeil geliefert). */
  beiSegmentEnde: (info: SegmentInfo) => Promise<void>
  /** Mikrofon weg (Anruf, App verlassen, Bildschirm gesperrt) oder Recorder-Fehler. */
  beiStoerung: (art: 'beendet' | 'fehler', text: string) => void
  /** Mikrofon kurz stumm (z. B. Anruf auf dem iPhone) bzw. wieder da. */
  beiStumm?: (stumm: boolean) => void
}

export function istApple(): boolean {
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua)
  return iOS || safari
}

export function istIPhone(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Bestes unterstütztes Format: Apple → audio/mp4, sonst audio/webm;codecs=opus. '' = Standard des Browsers. */
export function waehleFormat(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const kandidaten = istApple() ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return kandidaten.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
}

export function aufnahmeMoeglich(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export async function holeMikrofon(): Promise<MediaStream> {
  if (!aufnahmeMoeglich()) throw new Error('Dieser Browser kann nicht aufnehmen. Bitte Safari (iPhone) oder Chrome (Android) verwenden.')
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('Kein Zugriff auf das Mikrofon. Bitte in den Einstellungen des Telefons bzw. Browsers erlauben und erneut versuchen.')
    if (name === 'NotFoundError') throw new Error('Kein Mikrofon gefunden.')
    if (name === 'NotReadableError') throw new Error('Das Mikrofon ist gerade belegt (z. B. durch einen Anruf oder eine andere App).')
    throw new Error(`Mikrofon ließ sich nicht starten: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type Lauf = {
  nr: number
  rec: MediaRecorder
  mime: string
  lfd: number
  bytes: number
  /** Aufnahmezeit dieses Abschnitts ohne Pausen */
  aktivMs: number
  seit: number | null
  kette: Promise<void>
  ende: Promise<void>
  /** onstop schon verarbeitet (kann nach einer Störung doppelt kommen) */
  fertig: boolean
}

export class SegmentRekorder {
  private stream: MediaStream | null = null
  private lauf: Lauf | null = null
  private uhr: number | null = null
  private pausiert = false
  private gestoppt = true
  private format = ''
  private naechsteNr = 1
  private r: RekorderRueckrufe
  private segmentMs: number
  private teilMs: number

  constructor(r: RekorderRueckrufe, opts: { segmentMs?: number; teilMs?: number } = {}) {
    this.r = r
    this.segmentMs = opts.segmentMs ?? ZEITEN.segmentMs
    this.teilMs = opts.teilMs ?? ZEITEN.teilMs
  }

  get laeuft(): boolean {
    return !this.gestoppt
  }

  get aktuelleNr(): number {
    return this.lauf?.nr ?? this.naechsteNr - 1
  }

  /** Startet auf einem Mikrofon-Strom; ersteNr = Nummer des ersten Abschnitts (beim Fortsetzen > 1). */
  async start(stream: MediaStream, ersteNr: number): Promise<void> {
    this.stream = stream
    this.format = waehleFormat()
    this.naechsteNr = ersteNr
    this.gestoppt = false
    this.pausiert = false
    for (const spur of stream.getAudioTracks()) {
      spur.onended = () => this.stoerung('beendet', 'Das Mikrofon wurde getrennt (App verlassen, Bildschirm gesperrt oder Anruf).')
      spur.onmute = () => this.r.beiStumm?.(true)
      spur.onunmute = () => this.r.beiStumm?.(false)
    }
    await this.neuerAbschnitt()
    this.uhr = window.setInterval(() => this.pruefeWechsel(), 1000)
  }

  private async neuerAbschnitt(): Promise<void> {
    if (!this.stream) return
    const nr = this.naechsteNr++
    let rec: MediaRecorder
    try {
      rec = this.format ? new MediaRecorder(this.stream, { mimeType: this.format, audioBitsPerSecond: BITRATE }) : new MediaRecorder(this.stream, { audioBitsPerSecond: BITRATE })
    } catch {
      rec = new MediaRecorder(this.stream)
    }
    const mime = (rec.mimeType || this.format || 'audio/webm').split(';')[0]
    let endeAuf: () => void = () => undefined
    const lauf: Lauf = { nr, rec, mime, lfd: 0, bytes: 0, aktivMs: 0, seit: Date.now(), kette: Promise.resolve(), ende: new Promise<void>((res) => (endeAuf = res)), fertig: false }
    await this.r.beiSegmentStart(nr, mime)
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return
      const lfd = lauf.lfd++
      lauf.bytes += e.data.size
      lauf.kette = lauf.kette.then(() => this.r.beiTeil(nr, lfd, e.data)).catch(() => undefined)
    }
    rec.onstop = () => {
      if (lauf.fertig) return
      lauf.fertig = true
      const dauerMs = lauf.aktivMs + (lauf.seit === null ? 0 : Date.now() - lauf.seit)
      lauf.seit = null
      // Erst wenn alle Teilstücke gesichert sind, ist der Abschnitt fertig.
      lauf.kette = lauf.kette
        .then(() => this.r.beiSegmentEnde({ nr, mime, dauerMs, bytes: lauf.bytes, teile: lauf.lfd }))
        .catch(() => undefined)
        .finally(endeAuf)
    }
    rec.onerror = (ev) => {
      const text = (ev as unknown as { error?: { message?: string } }).error?.message ?? 'unbekannter Fehler'
      this.stoerung('fehler', `Die Aufnahme wurde vom Browser abgebrochen (${text}).`)
    }
    rec.start(this.teilMs)
    if (this.pausiert) this.pausiereLauf(lauf)
    this.lauf = lauf
  }

  private pruefeWechsel(): void {
    const l = this.lauf
    if (!l || this.gestoppt || this.pausiert) return
    // Mikrofon still und heimlich weg (iPhone meldet das nicht immer über onended)?
    if (this.stream && this.stream.getAudioTracks().every((t) => t.readyState === 'ended')) {
      this.stoerung('beendet', 'Das Mikrofon wurde getrennt (App verlassen, Bildschirm gesperrt oder Anruf).')
      return
    }
    if (l.rec.state === 'inactive') {
      this.stoerung('fehler', 'Die Aufnahme wurde vom Browser beendet.')
      return
    }
    const aktiv = l.aktivMs + (l.seit === null ? 0 : Date.now() - l.seit)
    if (aktiv >= this.segmentMs) void this.wechsle()
  }

  /** Beendet den laufenden Abschnitt und beginnt im selben Moment den nächsten. */
  private async wechsle(): Promise<void> {
    const alt = this.lauf
    if (!alt) return
    this.lauf = null
    try {
      if (alt.rec.state !== 'inactive') alt.rec.stop()
    } catch {
      // schon gestoppt
    }
    await this.neuerAbschnitt()
  }

  private pausiereLauf(l: Lauf): void {
    if (l.seit !== null) {
      l.aktivMs += Date.now() - l.seit
      l.seit = null
    }
    try {
      if (l.rec.state === 'recording') {
        l.rec.requestData()
        l.rec.pause()
      }
    } catch {
      // Ältere Browser ohne pause(): Abschnitt wird beim Fortsetzen gewechselt (siehe weiter()).
    }
  }

  pause(): void {
    if (this.gestoppt || this.pausiert) return
    this.pausiert = true
    if (this.lauf) this.pausiereLauf(this.lauf)
  }

  weiter(): void {
    if (this.gestoppt || !this.pausiert) return
    this.pausiert = false
    const l = this.lauf
    if (!l) return
    if (l.rec.state === 'paused') {
      try {
        l.rec.resume()
        l.seit = Date.now()
        return
      } catch {
        // unten: neuer Abschnitt
      }
    }
    if (l.rec.state === 'recording') {
      l.seit = Date.now()
      return
    }
    void this.wechsle()
  }

  /** Bittet den Recorder, das bisher Aufgenommene sofort als Teilstück zu liefern (vor dem Verlassen der App). */
  sichereJetzt(): void {
    try {
      if (this.lauf?.rec.state === 'recording') this.lauf.rec.requestData()
    } catch {
      // nichts zu tun
    }
  }

  /** Stoppt alles und wartet, bis der letzte Abschnitt gesichert ist. Gibt das Mikrofon frei. */
  async stop(): Promise<void> {
    if (this.gestoppt && !this.lauf) {
      this.gibMikrofonFrei()
      return
    }
    this.gestoppt = true
    if (this.uhr !== null) window.clearInterval(this.uhr)
    this.uhr = null
    const l = this.lauf
    this.lauf = null
    if (l) {
      try {
        if (l.rec.state !== 'inactive') l.rec.stop()
        else if (!l.fertig) {
          // Recorder war schon aus (Störung) und onstop kam evtl. nie — Abschnitt trotzdem abschließen.
          setTimeout(() => l.rec.onstop?.call(l.rec, new Event('stop')), 300)
        }
      } catch {
        // schon gestoppt
      }
      // Höchstens 8 s warten — auf manchen Geräten kommt onstop nach einem Mikrofonverlust nie.
      await Promise.race([l.ende, new Promise<void>((res) => setTimeout(res, 8000))])
    }
    this.gibMikrofonFrei()
  }

  private stoerung(art: 'beendet' | 'fehler', text: string): void {
    if (this.gestoppt) return
    void this.stop().finally(() => this.r.beiStoerung(art, text))
  }

  private gibMikrofonFrei(): void {
    for (const t of this.stream?.getTracks() ?? []) {
      t.onended = null
      t.onmute = null
      t.onunmute = null
      try {
        t.stop()
      } catch {
        // egal
      }
    }
    this.stream = null
  }
}

/** Lautstärke-Anzeige: liefert 0…1 aus dem Mikrofon-Strom. */
export class Pegel {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private daten: Float32Array<ArrayBuffer> | null = null

  constructor(stream: MediaStream) {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      this.ctx = new Ctx()
      const quelle = this.ctx.createMediaStreamSource(stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      quelle.connect(this.analyser)
      this.daten = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      void this.ctx.resume?.()
    } catch {
      this.ctx = null
      this.analyser = null
    }
  }

  wert(): number {
    if (!this.analyser || !this.daten) return 0
    this.analyser.getFloatTimeDomainData(this.daten)
    let summe = 0
    for (let i = 0; i < this.daten.length; i++) summe += this.daten[i] * this.daten[i]
    const rms = Math.sqrt(summe / this.daten.length)
    // Sprache liegt grob bei 0,01–0,3 RMS — logarithmisch auf 0…1 strecken.
    return Math.max(0, Math.min(1, (Math.log10(rms + 1e-4) + 3.2) / 2.7))
  }

  schliessen(): void {
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.analyser = null
  }
}
