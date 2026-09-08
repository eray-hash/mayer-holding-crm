import type { Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

const REF = '2026-09-08'
const rel = (days: number) => addDays(REF, days)

const vorlageText =
  'Dies ist ein Platzhaltertext für die Vorschau dieser Vorlage. In der finalen Version steht hier der ' +
  'vollständige Dokumenteninhalt inklusive Objektangaben, Datum, Betreff und individueller Textbausteine.'

export const seedVorlagenImmobilien: Vorlage[] = [
  { id: uid('vli'), kategorie: 'vollmacht', name: 'Verkaufsvollmacht Immobilie', typ: 'Vollmacht', zuletztGeaendert: rel(-18), text: vorlageText },
  { id: uid('vli'), kategorie: 'vollmacht', name: 'Vermarktungsvollmacht (Makleralleinauftrag)', typ: 'Vollmacht', zuletztGeaendert: rel(-40), text: vorlageText },
  { id: uid('vli'), kategorie: 'vollmacht', name: 'Vollmacht Grundbucheinsicht', typ: 'Vollmacht', zuletztGeaendert: rel(-55), text: vorlageText },
  { id: uid('vli'), kategorie: 'vollmacht', name: 'Vollmacht Notartermin', typ: 'Vollmacht', zuletztGeaendert: rel(-8), text: vorlageText },
  { id: uid('vli'), kategorie: 'schreiben', name: 'Exposé-Anschreiben', typ: 'Schreiben', zuletztGeaendert: rel(-6), text: vorlageText },
  { id: uid('vli'), kategorie: 'schreiben', name: 'Besichtigungsbestätigung', typ: 'Schreiben', zuletztGeaendert: rel(-9), text: vorlageText },
  { id: uid('vli'), kategorie: 'schreiben', name: 'Reservierungsbestätigung', typ: 'Schreiben', zuletztGeaendert: rel(-13), text: vorlageText },
  { id: uid('vli'), kategorie: 'schreiben', name: 'Anschreiben Eigentümerakquise', typ: 'Schreiben', zuletztGeaendert: rel(-27), text: vorlageText },
  { id: uid('vli'), kategorie: 'vertraege', name: 'Kaufvertragsentwurf Standard', typ: 'Vertrag', zuletztGeaendert: rel(-22), text: vorlageText },
  { id: uid('vli'), kategorie: 'vertraege', name: 'Maklervertrag (Alleinauftrag)', typ: 'Vertrag', zuletztGeaendert: rel(-31), text: vorlageText },
  { id: uid('vli'), kategorie: 'vertraege', name: 'Reservierungsvereinbarung', typ: 'Vertrag', zuletztGeaendert: rel(-11), text: vorlageText },
  { id: uid('vli'), kategorie: 'vertraege', name: 'Mietvertrag Wohnraum Standard', typ: 'Vertrag', zuletztGeaendert: rel(-48), text: vorlageText },
]
