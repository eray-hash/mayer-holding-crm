// „Ansehen als …“: Aus dem Stand, den der Superuser geladen hat (er sieht alles), wird der Stand,
// den die angesehene Person sähe. Dieselben Regeln wie in der Datenbank (Rechte vom 18.11.2026,
// siehe bereichsRechte.ts):
// - Geschäftsführung und Admins sehen alle Bereiche, alle anderen nur ihre freigegebenen.
// - Die beiden Sammelakten (ungeklärte Eingänge, interne Akte) sieht jeder.
// - Private Kontakte nur die eigenen; eigene To-do-Listen nur die eigene und die für sie freigegebenen.
// - Objekte und die Immobilien-Einträge (Fragen, Zeiten, Tages-/Wochenpläne, Weitergaben, Abrechnungen)
//   brauchen „immobilien“; Rechnungen, Konzepte, Verträge und Verbindlichkeiten brauchen „beratung“.
// - Projekte: „intern“ sieht jeder, sonst der Bereich.
// - Notizen gehören dem angemeldeten Menschen und lassen sich niemandem zuordnen — sie werden in der
//   fremden Sicht nicht gezeigt.
// Reine Funktion ohne Seiteneffekte: Sie ändert den Stand nicht, sie liefert eine gefilterte Kopie.
import type { AppData } from '../context/AppContext'
import type { Bereich, KundeBereich, Vorlage } from '../types'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { istSammelakte } from '../data/sammelakten'

export type SichtPerson = {
  email: string
  name: string
  rolle: 'geschaeftsfuehrung' | 'mitarbeiter'
  ist_admin: boolean
  bereiche: string[]
  telefon?: string | null
  signatur_html?: string | null
  foto_data_url?: string | null
  buchungslink?: string | null
}

function siehtAlles(p: SichtPerson): boolean {
  return p.rolle === 'geschaeftsfuehrung' || !!p.ist_admin
}

export function darfFuer(p: SichtPerson, bereich: Bereich | KundeBereich | string | null | undefined): boolean {
  if (!bereich || bereich === 'privat' || bereich === 'intern') return true
  if (siehtAlles(p)) return true
  const freigabe = bereich === 'immobilienkunden' ? 'immobilien' : bereich
  return (p.bereiche ?? []).includes(freigabe)
}

const gleich = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

function vorlagen(p: SichtPerson, bereich: Bereich, liste: Vorlage[]): Vorlage[] {
  return darfFuer(p, bereich) ? liste : liste.filter((v) => v.kategorie === 'briefkopf' || v.id === 'briefkopf')
}

export function filtereFuerPerson(state: AppData, p: SichtPerson): AppData {
  let s: AppData = { ...state }

  // Kunden-Listen je Bereich
  for (const def of KUNDEN_BEREICHE) {
    const liste = def.get(state)
    let neu = liste
    if (def.id === 'privat') neu = liste.filter((k) => gleich(k.verantwortlichEmail, p.email))
    else if (!darfFuer(p, def.id)) neu = liste.filter((k) => istSammelakte(k.id))
    if (neu !== liste) s = def.set(s, neu)
  }

  const immo = darfFuer(p, 'immobilien')
  const beratung = darfFuer(p, 'beratung')
  if (!immo) {
    s.objekte = []
    s.finanzierungen = []
    s.immoFragen = []
    s.zeiteintraege = []
    s.tagesplaene = []
    s.wochenplaene = []
    s.weitergaben = []
    s.abrechnungen = []
  }
  if (!beratung) {
    s.rechnungen = []
    s.konzepte = []
    s.vertraege = []
    s.verbindlichkeiten = []
  }
  s.protokolle = state.protokolle.filter((x) => darfFuer(p, x.bereich))
  s.objektVorschlaege = state.objektVorschlaege.filter((x) => darfFuer(p, x.kundeBereich))
  s.projekte = state.projekte.filter((x) => darfFuer(p, x.bereich))

  s.vorlagenBeratung = vorlagen(p, 'beratung', state.vorlagenBeratung)
  s.vorlagenImmobilien = vorlagen(p, 'immobilien', state.vorlagenImmobilien)
  s.vorlagenErben = vorlagen(p, 'erben', state.vorlagenErben)
  s.vorlagenBetriebsuebergabe = vorlagen(p, 'betriebsuebergabe', state.vorlagenBetriebsuebergabe)
  s.vorlagenBetriebsformen = vorlagen(p, 'betriebsformen', state.vorlagenBetriebsformen)
  s.vorlagenAkademie = vorlagen(p, 'akademie', state.vorlagenAkademie)
  s.vorlagenFinanzierungen = vorlagen(p, 'finanzierungen', state.vorlagenFinanzierungen)

  // To-do-Listen: Bereichslisten nach Freigabe; eigene Listen nur die eigene und die freigegebenen.
  const freigegebenVon = new Set(state.todoFreigaben.filter((f) => gleich(f.empfaengerEmail, p.email)).map((f) => f.besitzerEmail.trim().toLowerCase()))
  s.todos = state.todos.filter((t) =>
    t.bereich ? darfFuer(p, t.bereich) : gleich(t.besitzerEmail, p.email) || freigegebenVon.has((t.besitzerEmail ?? '').trim().toLowerCase()),
  )
  s.todoFreigaben = state.todoFreigaben.filter((f) => gleich(f.besitzerEmail, p.email) || gleich(f.empfaengerEmail, p.email))

  s.notizen = []

  // Profil: das der angesehenen Person (Name, Telefon, Signatur, Foto).
  s.profil = {
    ...state.profil,
    name: p.name,
    email: p.email,
    telefon: p.telefon ?? '',
    signaturHtml: p.signatur_html ?? '',
    fotoDataUrl: p.foto_data_url ?? undefined,
    buchungslink: p.buchungslink ?? undefined,
  }
  return s
}
