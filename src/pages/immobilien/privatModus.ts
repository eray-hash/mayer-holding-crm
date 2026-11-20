// Gemeinsame Helfer, damit die Immobilien-Seiten auch den privaten Immobilien-Bereich eines Mitarbeiters
// tragen (Prop `privat`, seit 20.11.2026). Ohne `privat` bleibt alles wie im Mayer-Bereich.
//
// Privat heißt: Objekte aus `state.privatObjekte` (nur für den Besitzer sichtbar), Kontakte aus
// `state.privatKunden` mit `privatArt: 'immobilienkunden'`, und alle Verweise führen auf /privat/immobilien/….
// Mayer-Daten (Objekte, Kontakte, Treffer-Meldungen) werden dort nie gezeigt oder abgeglichen.
import type { AppData } from '../../context/AppContext'
import { kundeDetailPfad } from '../../data/kundenBereiche'
import type { Kunde, KundeBereich } from '../../types'
import type { GesuchMitKontakt } from '../../lib/gesuche'

export type ImmoPfade = {
  objektListe: string
  objekteBasis: string
  objekt: (id: string) => string
  kundenListe: string
  kunde: (id: string) => string
  gesuche: string
  /** Akte eines Kontakts mit Gesuch — Immobilien-Kontakte gleich im Reiter „Stammdatenblatt“. */
  kontakt: (bereich: KundeBereich, id: string) => string
}

const MAYER: ImmoPfade = {
  objektListe: '/immobilien',
  objekteBasis: '/immobilien/objekte',
  objekt: (id) => `/immobilien/objekte/${id}`,
  kundenListe: '/immobilien/kunden',
  kunde: (id) => `/immobilien/kunden/${id}`,
  gesuche: '/immobilien/gesuche',
  kontakt: (bereich, id) => (bereich === 'immobilienkunden' ? `/immobilien/kunden/${id}?tab=stammdatenblatt` : kundeDetailPfad(bereich, id)),
}

const PRIVAT: ImmoPfade = {
  objektListe: '/privat/immobilien',
  objekteBasis: '/privat/immobilien/objekte',
  objekt: (id) => `/privat/immobilien/objekte/${id}`,
  kundenListe: '/privat/immobilien/kunden',
  kunde: (id) => `/privat/immobilien/kunden/${id}`,
  gesuche: '/privat/immobilien/gesuche',
  kontakt: (_bereich, id) => `/privat/immobilien/kunden/${id}?tab=stammdatenblatt`,
}

export function immoPfade(privat?: boolean): ImmoPfade {
  return privat ? PRIVAT : MAYER
}

/** Die privaten Immobilien-Kontakte des angemeldeten Mitarbeiters. */
export function privateImmoKunden(state: AppData): Kunde[] {
  return state.privatKunden.filter((k) => k.privatArt === 'immobilienkunden')
}

/** Kontakte des jeweiligen Bereichs: Mayer-Immobilienkunden oder die eigenen privaten Immobilien-Kontakte. */
export function immoKunden(state: AppData, privat?: boolean): Kunde[] {
  return privat ? privateImmoKunden(state) : state.immobilienKunden
}

/** Objekte des jeweiligen Bereichs: Mayer-Objekte oder die eigenen privaten Objekte. */
export function immoObjekte(state: AppData, privat?: boolean) {
  return privat ? state.privatObjekte : state.objekte
}

/** In welcher Kundenliste (für ADD_/UPDATE_KUNDE_IN_BEREICH) die Kontakte liegen. */
export function immoKundenBereich(privat?: boolean): KundeBereich {
  return privat ? 'privat' : 'immobilienkunden'
}

/** Gesuche nur der eigenen privaten Immobilien-Kontakte (Gegenstück zu alleGesuche, das Privat bewusst auslässt).
 *  Ein älteres Käuferprofil zählt — wie dort — als ein Gesuch mit. */
export function privateGesuche(state: AppData): GesuchMitKontakt[] {
  const liste: GesuchMitKontakt[] = []
  for (const kunde of privateImmoKunden(state)) {
    for (const gesuch of kunde.gesuche ?? []) liste.push({ gesuch, kunde, bereich: 'privat' })
    const p = kunde.kaeuferprofil
    if (p && (p.bevorzugteLage.trim() || p.objekttypen.length > 0 || p.budgetMin != null || p.budgetMax != null)) {
      liste.push({
        bereich: 'privat',
        kunde,
        gesuch: {
          id: `kaeuferprofil:${kunde.id}`,
          erstelltAm: p.erstelltAm,
          titel: 'Käuferprofil',
          objekttypen: p.objekttypen,
          lage: p.bevorzugteLage,
          budgetMin: p.budgetMin,
          budgetMax: p.budgetMax,
          nutzung: p.nutzung,
          notizen: p.notizen,
        },
      })
    }
  }
  return liste
}
