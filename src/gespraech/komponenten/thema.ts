// Farben des Aufnahme-Bildschirms: dunkel (Standard im Gespräch — blendet nicht, lenkt weniger ab) oder hell.
// Die Klassen stehen ausgeschrieben da, damit Tailwind sie findet.

export type Thema = {
  dunkel: boolean
  seite: string
  leiste: string
  karte: string
  text: string
  leise: string
  knopf: string
  knopfAktiv: string
  eingabe: string
  trenner: string
  warn: string
  fehler: string
  gut: string
}

export function thema(dunkel: boolean): Thema {
  return dunkel
    ? {
        dunkel,
        seite: 'bg-slate-950 text-slate-100',
        leiste: 'bg-slate-900 border-slate-800',
        karte: 'bg-slate-900 border-slate-800',
        text: 'text-slate-100',
        leise: 'text-slate-400',
        knopf: 'bg-slate-800 border-slate-700 text-slate-100 active:bg-slate-700',
        knopfAktiv: 'bg-sky-500 border-sky-500 text-slate-950',
        eingabe: 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-sky-500',
        trenner: 'divide-slate-800 border-slate-800',
        warn: 'bg-amber-950 border-amber-900 text-amber-200',
        fehler: 'bg-rose-950 border-rose-900 text-rose-200',
        gut: 'text-emerald-400',
      }
    : {
        dunkel,
        seite: 'bg-slate-50 text-slate-900',
        leiste: 'bg-white border-slate-200',
        karte: 'bg-white border-slate-200',
        text: 'text-slate-900',
        leise: 'text-slate-500',
        knopf: 'bg-white border-slate-200 text-slate-800 active:bg-slate-100',
        knopfAktiv: 'bg-slate-900 border-slate-900 text-white',
        eingabe: 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-accent-400',
        trenner: 'divide-slate-100 border-slate-200',
        warn: 'bg-amber-50 border-amber-200 text-amber-900',
        fehler: 'bg-rose-50 border-rose-200 text-rose-800',
        gut: 'text-emerald-600',
      }
}
