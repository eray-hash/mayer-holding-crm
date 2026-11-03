import type { AppData } from '../context/AppContext'
import type { Bereich } from '../types'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../data/kundenBereiche'
import { getStatusMap, getHauptpfad } from '../data/statusNetworks'
import { OBJEKT_UNTERLAGEN_PFLICHT } from '../data/objektUnterlagenPflicht'
import { fmtDate } from './dates'

// Firmen-Wissens-KI (Quirin Lutzenberger, Immobilienfachwirt: "Eigene Firmen-KI ... greift
// ausschließlich auf eure freigegebenen Unternehmensdaten zu") — bewusst KEIN Dokumenten-RAG mit
// Embeddings: die eigentlichen Unternehmensdaten (Kunden/Mandanten, Objekte, Prozess-Stufen,
// Unterlagen-Pflichten) liegen bereits strukturiert im bereits geladenen App-State vor. Eine knappe
// Textzusammenfassung davon reicht locker in ein einziges Claude-Prompt (siehe answerFirmenwissen in
// email-gateway/index.ts) und beantwortet genau die Art Fragen, die Quirin als Beispiele nennt
// ("Wo liegt das Exposé Musterstraße 17?", "Welche Käufer suchen Gewerbeobjekte zwischen 5 und 10
// Millionen?"), ohne die Komplexität eines mehrstufigen Tool-Use-Agenten.
//
// Sicherheitsmodell bewusst identisch zum Rest der App: die Bereichs-Einschränkung (siehe
// RequireBereich in App.tsx) ist eine UI-Fahrbahnmarkierung, keine Datenbank-Schranke — jeder aktive
// Mitarbeiter kann ohnehin per RLS alle Kunden/Objekte lesen. Diese Zusammenfassung schränkt daher
// bewusst nicht zusätzlich nach Bereichs-Berechtigung ein.
function prozessBeschreibung(bereich: Bereich): string {
  const map = getStatusMap(bereich)
  const pfad = getHauptpfad(bereich)
  return pfad.map((id) => map[id]?.label ?? id).join(' → ')
}

export function buildFirmenwissenKontext(state: AppData): string {
  const abschnitte: string[] = []

  abschnitte.push('=== PROZESS-ABLÄUFE (Hauptpfad je Bereich) ===')
  for (const bereich of [...KUNDEN_BEREICHE.map((b) => b.id), 'immobilien' as const]) {
    const label = bereich === 'immobilien' ? 'Immobilien' : kundeBereichLabel(bereich)
    abschnitte.push(`${label}: ${prozessBeschreibung(bereich)}`)
  }

  abschnitte.push('\n=== UNTERLAGEN-PFLICHT JE OBJEKTTYP (z.B. Mehrfamilienhaus zählt als "Haus") ===')
  for (const [typ, kategorien] of Object.entries(OBJEKT_UNTERLAGEN_PFLICHT)) {
    abschnitte.push(`${typ}: ${kategorien.join(', ')}`)
  }

  abschnitte.push('\n=== KUNDEN / MANDANTEN (alle Bereiche) ===')
  for (const b of KUNDEN_BEREICHE) {
    const kunden = b.get(state)
    if (kunden.length === 0) continue
    abschnitte.push(`-- ${b.label} (${kunden.length}) --`)
    for (const k of kunden) {
      const teile = [
        `${k.firma} (${k.ansprechpartner})`,
        `Status: ${getStatusMap(b.id)[k.status]?.label ?? k.status}`,
        `Verantwortlich: ${k.verantwortlich}`,
        `Letzte Aktivität: ${fmtDate(k.letzteAktivitaet)}`,
      ]
      if (k.kaeuferprofil) {
        const kp = k.kaeuferprofil
        teile.push(
          `Suchprofil: ${kp.objekttypen.join('/')  || 'beliebig'}, Budget ${kp.budgetMin ?? '?'}–${kp.budgetMax ?? '?'} €, Lage „${kp.bevorzugteLage || 'offen'}"`,
        )
      }
      abschnitte.push(`  - ${teile.join(' · ')}`)
    }
  }

  abschnitte.push('\n=== IMMOBILIEN-OBJEKTE ===')
  for (const o of state.objekte) {
    const vorhandeneOrdner = Object.entries(o.dokumente)
      .filter(([, liste]) => (liste?.length ?? 0) > 0)
      .map(([name]) => name)
    const teile = [
      `${o.bezeichnung} (${o.adresse})`,
      `Typ: ${o.typ}`,
      `Status: ${getStatusMap('immobilien')[o.status]?.label ?? o.status}`,
      `Verantwortlich: ${o.verantwortlich}`,
      `Letzte Aktivität: ${o.activities[0] ? fmtDate(o.activities[0].date) : 'keine'}`,
      `Vorhandene Unterlagen: ${vorhandeneOrdner.length > 0 ? vorhandeneOrdner.join(', ') : 'keine'}`,
    ]
    if (o.eigentuemer) {
      teile.push(`Eigentümer: ${o.eigentuemer.name}${o.eigentuemer.ansprechpartner ? ` (Ansprechpartner: ${o.eigentuemer.ansprechpartner})` : ''}`)
    }
    abschnitte.push(`  - ${teile.join(' · ')}`)
  }

  return abschnitte.join('\n')
}
