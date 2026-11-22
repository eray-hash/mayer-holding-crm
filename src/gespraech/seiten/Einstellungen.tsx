// Einstellungen der Gesprächs-App (je Gerät): Standard-Art, Aufbewahrung des Tons, Bildschirm wach halten,
// Mitlesen; dazu Hinweise zum Home-Bildschirm, Gerätespeicher und Abmelden.
import { Download, LogOut, Smartphone } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { setzeEinstellungen, useEinstellungen, type GespraechEinstellungen } from '../einstellungen'
import { useLokaleAufnahmen } from '../hooks'
import { istInstalliert, useInstallAngebot } from '../installieren'
import { istIPhone } from '../rekorder'
import { untertitelMoeglich } from '../untertitel'
import { wachHaltenMoeglich } from '../wachHalten'
import type { GespraechArt } from '../typen'

function Wahl<T extends string | number>({ werte, wert, onWahl }: { werte: { wert: T; text: string }[]; wert: T; onWahl: (w: T) => void }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${werte.length}, minmax(0, 1fr))` }}>
      {werte.map((w) => (
        <button
          key={String(w.wert)}
          type="button"
          onClick={() => onWahl(w.wert)}
          className={`rounded-xl border px-2 py-2.5 text-sm font-medium ${wert === w.wert ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-700'}`}
        >
          {w.text}
        </button>
      ))}
    </div>
  )
}

function Schalter({ an, onWechsel, text, hinweis, aus }: { an: boolean; onWechsel: (an: boolean) => void; text: string; hinweis?: string; aus?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 ${aus ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={an} disabled={aus} onChange={(e) => onWechsel(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
      <span>
        <span className="block text-sm font-medium text-slate-800">{text}</span>
        {hinweis && <span className="block text-xs text-slate-500">{hinweis}</span>}
      </span>
    </label>
  )
}

export function Einstellungen() {
  const e = useEinstellungen()
  const { mitarbeiter, signOut } = useAuth()
  const lokale = useLokaleAufnahmen()
  const installieren = useInstallAngebot()
  const offen = lokale.filter((a) => !a.abgeschlossen).length
  const setze = (a: Partial<GespraechEinstellungen>) => setzeEinstellungen(a)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold text-slate-900">Einstellungen</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-slate-700">Art der Aufnahme beim Öffnen</h2>
        <Wahl<GespraechArt>
          werte={[
            { wert: 'termin', text: 'Termin' },
            { wert: 'telefon', text: 'Telefonat' },
            { wert: 'notiz', text: 'Notiz' },
          ]}
          wert={e.standardModus}
          onWahl={(w) => setze({ standardModus: w })}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-slate-700">Ton aufbewahren</h2>
        <Wahl<7 | 30 | 90>
          werte={[
            { wert: 7, text: '7 Tage' },
            { wert: 30, text: '30 Tage' },
            { wert: 90, text: '90 Tage' },
          ]}
          wert={e.aufbewahrungTage}
          onWahl={(w) => setze({ aufbewahrungTage: w })}
        />
        <p className="text-xs text-slate-500">Danach löscht der Server den Ton. Abschrift und Auswertung bleiben. Gilt für neue Aufnahmen.</p>
      </section>

      <section className="flex flex-col gap-2">
        <Schalter
          an={e.wachHalten}
          onWechsel={(an) => setze({ wachHalten: an })}
          text="Bildschirm während der Aufnahme wach halten"
          hinweis={wachHaltenMoeglich() ? 'Empfohlen — das iPhone hält die Aufnahme an, sobald sich der Bildschirm sperrt.' : 'Dieser Browser kann den Bildschirm nicht wach halten. Bitte die automatische Sperre in den Einstellungen des Handys verlängern.'}
          aus={!wachHaltenMoeglich()}
        />
        <Schalter
          an={e.untertitel}
          onWechsel={(an) => setze({ untertitel: an })}
          text="Mitlesen während der Aufnahme"
          hinweis={untertitelMoeglich() ? 'Zeigt das Gesprochene ungefähr mit. Nur eine Hilfe; kann auf manchen Handys die Aufnahme stören.' : 'Dieser Browser kann nicht mitlesen.'}
          aus={!untertitelMoeglich()}
        />
      </section>

      {!istInstalliert() && (
        <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <Smartphone className="h-4 w-4" /> Auf den Home-Bildschirm legen
          </h2>
          {installieren ? (
            <button onClick={() => void installieren()} className="flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-3 py-2.5 text-sm font-medium text-white">
              <Download className="h-4 w-4" /> Gesprächs-App installieren
            </button>
          ) : istIPhone() ? (
            <p className="text-sm text-slate-600">In Safari unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“. Danach die App über das neue Symbol öffnen und einmal anmelden.</p>
          ) : (
            <p className="text-sm text-slate-600">Im Browser-Menü (drei Punkte) „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.</p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-1 text-sm text-slate-600">
        <div>Angemeldet als {mitarbeiter?.name || mitarbeiter?.email}</div>
        <div>{offen > 0 ? `${offen} Aufnahme(n) noch auf diesem Gerät, nicht vollständig hochgeladen.` : 'Alle Aufnahmen sind hochgeladen.'}</div>
        <a href="../#/heute" className="mt-2 font-medium text-accent-600">
          Zum CRM
        </a>
      </section>

      <button
        onClick={() => {
          if (offen > 0 && !window.confirm('Es liegen noch nicht hochgeladene Aufnahmen auf dem Gerät. Sie bleiben gespeichert und werden nach der nächsten Anmeldung hochgeladen. Trotzdem abmelden?')) return
          void signOut()
        }}
        className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
      >
        <LogOut className="h-4 w-4" /> Abmelden
      </button>
    </div>
  )
}
