// Sofort sichtbares Schild unter den kleinen Symbol-Knöpfen der Kopfleiste (24.11.2026): Fährt man mit der
// Maus darüber (oder springt mit der Tab-Taste darauf, nicht nach einem Mausklick), erscheint ohne Wartezeit ein kurzer Text, was der
// Knopf tut. Das eingebaute Browser-Schild (title) erscheint erst nach rund einer Sekunde und wurde deshalb
// übersehen. Auf Geräten ohne Maus (Handy, Tablet) bleibt das Schild aus, damit es nach dem Tippen nicht
// stehen bleibt.
//
// Einsatz:  <KopfHinweis text="Suche"><button aria-label="Suche">…</button></KopfHinweis>
// Der Knopf selbst trägt weiterhin aria-label (für Vorleseprogramme), aber kein title — sonst erschienen
// zwei Schilder übereinander.

import type { ReactNode } from 'react'

export function KopfHinweis({
  text,
  children,
  rechts = false,
  aus = false,
  className = 'inline-flex',
}: {
  /** Kurzer Text, was der Knopf tut. */
  text: string
  children: ReactNode
  /** Schild rechtsbündig statt mittig — für Knöpfe ganz rechts, damit es nicht über den Rand ragt. */
  rechts?: boolean
  /** Schild unterdrücken, z. B. solange das zugehörige Menü offen ist. */
  aus?: boolean
  /** Sichtbarkeit der Hülle, z. B. 'hidden sm:inline-flex' für Knöpfe, die auf dem Handy fehlen. */
  className?: string
}) {
  return (
    <span className={`group/hinweis relative ${className}`}>
      {children}
      {!aus && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full z-[60] mt-1.5 hidden w-max max-w-[16rem] rounded-md bg-slate-800 px-2 py-1 text-xs font-medium leading-snug text-white shadow-lg [@media(hover:hover)]:group-hover/hinweis:block group-has-[:focus-visible]/hinweis:block ${
            rechts ? 'right-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
