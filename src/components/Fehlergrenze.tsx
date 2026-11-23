import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { meldeFehler } from '../lib/fehlerMelden'

// Fängt Programmfehler beim Anzeigen ab, damit nicht das ganze CRM weiß wird.
//
// Ohne diese Grenze hängt React bei einem einzigen Fehler (z. B. ein Feld, das in der Datenbank leer
// ist, obwohl die Seite einen Text erwartet) den kompletten Baum ab — Seitenleiste, Suche und alle
// anderen Karten sind dann ebenfalls weg und nur ein Neuladen hilft.
//
// Mit Grenze bleibt alles außerhalb stehen; an der Stelle erscheint ein kurzer Hinweis mit
// „Erneut versuchen“. Der Fehler landet wie bisher in app_fehler (die Grenze fängt ihn ab, bevor
// das allgemeine Melden in lib/fehlerMelden.ts ihn sehen würde, darum meldet sie ihn selbst).
//
// `schluessel`: ändert er sich, während der Hinweis angezeigt wird, versucht die Grenze es von
// selbst neu (z. B. Wechsel auf eine andere Seite oder einen anderen Reiter). Anders als ein
// React-`key` baut er die Inhalte im fehlerfreien Fall NICHT neu auf — Eingaben bleiben erhalten.
type Props = {
  children: ReactNode
  /** Kurzer Name für die Meldung in app_fehler, z. B. „Seite“ oder „Objekt: Rendite“. Nie Kundendaten. */
  name?: string
  /** Kleiner Hinweis für eine einzelne Karte statt des großen für eine ganze Seite. */
  klein?: boolean
  /** Äußerste Grenze um das ganze CRM: dann gibt es keine „übrigen Bereiche“, die weiter funktionieren. */
  ganz?: boolean
  schluessel?: string
}

type Zustand = { fehler: Error | null; schluesselBeiFehler?: string }

export class Fehlergrenze extends Component<Props, Zustand> {
  state: Zustand = { fehler: null }

  static getDerivedStateFromError(fehler: unknown): Partial<Zustand> {
    return { fehler: fehler instanceof Error ? fehler : new Error(String(fehler)) }
  }

  componentDidCatch(fehler: unknown, info: ErrorInfo) {
    this.setState({ schluesselBeiFehler: this.props.schluessel })
    const text = fehler instanceof Error ? fehler.message || fehler.name : String(fehler)
    // Nur die ersten Bausteine aus dem Aufrufpfad — reicht, um die Stelle zu finden.
    const pfad = (info.componentStack ?? '')
      .split('\n')
      .map((z) => z.trim().replace(/^at /, '').split(' ')[0])
      .filter(Boolean)
      .slice(0, 4)
      .join(' < ')
    meldeFehler(text, [this.props.name, pfad].filter(Boolean).join(' · ') || undefined)
  }

  componentDidUpdate(vorher: Props) {
    if (this.state.fehler && vorher.schluessel !== this.props.schluessel && this.props.schluessel !== this.state.schluesselBeiFehler) {
      this.setState({ fehler: null, schluesselBeiFehler: undefined })
    }
  }

  private nochmal = () => this.setState({ fehler: null, schluesselBeiFehler: undefined })

  render() {
    if (!this.state.fehler) return this.props.children
    if (this.props.klein) {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={15} className="shrink-0" />
          <span>Dieser Abschnitt konnte nicht angezeigt werden. Der Fehler wurde gemeldet.</span>
          <button type="button" onClick={this.nochmal} className="ml-auto inline-flex items-center gap-1 font-medium underline hover:no-underline">
            <RefreshCw size={13} /> Erneut versuchen
          </button>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
        <AlertTriangle size={22} className="mx-auto mb-2 text-amber-600" />
        <p className="font-medium">Diese Ansicht konnte nicht angezeigt werden.</p>
        <p className="mt-1 text-amber-800">
          {this.props.ganz
            ? 'Der Fehler wurde automatisch gemeldet. Bitte lade die Seite neu.'
            : 'Der Fehler wurde automatisch gemeldet. Die übrigen Bereiche des CRM funktionieren weiter, du kannst einfach eine andere Seite wählen.'}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={this.nochmal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-amber-900 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <RefreshCw size={14} /> Erneut versuchen
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg px-3 py-1.5 font-medium text-amber-900 underline hover:no-underline"
          >
            Seite neu laden
          </button>
        </div>
      </div>
    )
  }
}
