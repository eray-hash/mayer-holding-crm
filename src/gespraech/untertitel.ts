// Mitlesen während der Aufnahme über die Spracherkennung des Browsers (Chrome, Safari) — nur als Hilfe
// auf dem Bildschirm. Maßgeblich ist die Abschrift des Servers. Standardmäßig aus, weil die Erkennung auf
// manchen Telefonen das Mikrofon mitbenutzt und die Aufnahme stören kann.

type Erkennung = {
  continuous: boolean
  interimResults: boolean
  lang: string
  // deno-lint-ignore no-explicit-any
  onresult: ((e: any) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function konstruktor(): (new () => Erkennung) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Erkennung; webkitSpeechRecognition?: new () => Erkennung }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function untertitelMoeglich(): boolean {
  return konstruktor() !== null
}

export class LiveUntertitel {
  private e: Erkennung | null = null
  private aktiv = false
  private fest = ''
  private beiText: (text: string) => void

  constructor(beiText: (text: string) => void) {
    this.beiText = beiText
  }

  start(): void {
    const K = konstruktor()
    if (!K || this.aktiv) return
    this.aktiv = true
    const e = new K()
    e.lang = 'de-DE'
    e.continuous = true
    e.interimResults = true
    e.onresult = (ev) => {
      let vorlaeufig = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = String(ev.results[i][0]?.transcript ?? '')
        if (ev.results[i].isFinal) this.fest = `${this.fest} ${t}`.trim().slice(-600)
        else vorlaeufig += t
      }
      this.beiText(`${this.fest} ${vorlaeufig}`.trim().slice(-400))
    }
    e.onerror = () => undefined
    // Die Erkennung endet von selbst nach einer Weile Stille — solange gewünscht, neu starten.
    e.onend = () => {
      if (!this.aktiv) return
      setTimeout(() => {
        try {
          if (this.aktiv) e.start()
        } catch {
          this.aktiv = false
        }
      }, 300)
    }
    try {
      e.start()
      this.e = e
    } catch {
      this.aktiv = false
    }
  }

  stop(): void {
    this.aktiv = false
    try {
      this.e?.stop()
    } catch {
      // egal
    }
    this.e = null
  }
}
