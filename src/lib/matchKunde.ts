import type { AppData } from '../context/AppContext'
import type { KundeBereich } from '../types'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'

export type KundeMatch = { bereich: KundeBereich; kundeId: string; kundeName: string; score: number }

// Häufige, nicht-unterscheidende deutsche Füllwörter — ohne Filter können diese sowohl selbst
// zufällig als Teilstring in einem Firmen-/E-Mail-Namen auftauchen (z.B. "bei" in
// "gewerbeimmo-ulm.de") als auch (vor der Umstellung auf Wortgrenzen-Vergleich) andere Namen
// fälschlich matchen (z.B. "der" in "Alexander") — beides real beim Testen aufgetreten.
const FUELLWOERTER = new Set([
  'bei', 'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'ist', 'war', 'wie', 'was', 'wer', 'wen',
  'wem', 'für', 'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'hat', 'hab', 'sein', 'ihr',
  'ihre', 'dein', 'deine', 'mein', 'meine', 'noch', 'nach', 'vor', 'über', 'unter', 'nur', 'auch',
  'kein', 'keine', 'man', 'wir', 'ich', 'du', 'sie', 'wird', 'werden', 'kann', 'soll', 'will',
])

function woerter(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüß]{3,}/g) ?? []).filter((w) => !FUELLWOERTER.has(w))
}

// Simples, aber echtes Text-Matching: findet den Kunden/Mandanten (über alle Bereiche hinweg),
// dessen Firmen-/Ansprechpartnername am häufigsten im übergebenen Text vorkommt. Wird sowohl beim
// Dokumenten-Import als auch beim E-Mail-Posteingang verwendet, damit beide dieselbe Logik teilen.
//
// Vergleicht ganze Wörter (nicht Teilstrings) — sonst matcht z.B. die Frage-Füllwörter "bei"/"der"
// zufällig als Teilstring irgendwo in einem unbeteiligten Firmennamen oder einer E-Mail-Adresse.
//
// Gibt ALLE Kunden zurück, die den höchsten Score erreichen (nicht nur den ersten gefundenen) —
// Grundlage dafür, Mehrdeutigkeit zu erkennen (z.B. nur ein Vorname genannt, der auf mehrere Kunden
// zutrifft), statt stillschweigend irgendeinen davon zu raten. Siehe KiAssistentPanel.tsx.
export function suggestKundeKandidaten(state: AppData, text: string): KundeMatch[] {
  const tokens = woerter(text)
  if (tokens.length === 0) return []
  let bestScore = 0
  let beste: KundeMatch[] = []
  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      const ansprechpartnerWoerter = woerter(k.ansprechpartner)
      const haystackWoerter = new Set(woerter(`${k.firma} ${k.ansprechpartner} ${k.email}`))
      const score = tokens.filter((t) => haystackWoerter.has(t)).length
      if (score === 0) continue
      // Ein Treffer NUR auf den Vornamen reicht nicht als sicherer Fund: "Thomas" matcht z.B. sowohl
      // "Thomas Berger" als auch "Thomas Luther" gleichermaßen — ein häufiger Vorname allein ist zu
      // unscharf, um sich sicher auf EINEN bestimmten Kunden festzulegen (echter Fehlgriff beim
      // Testen: "Termin mit Thomas Berger" — ein Mitarbeiter, kein Kunde — landete sonst fälschlich
      // beim völlig unbeteiligten Kunden "Thomas Luther"). Nachname, Firma oder E-Mail zählen
      // weiterhin auch einzeln als ausreichend sicher.
      const matchedWoerter = new Set(tokens.filter((t) => haystackWoerter.has(t)))
      const nurVorname =
        ansprechpartnerWoerter.length > 1 &&
        matchedWoerter.size === 1 &&
        matchedWoerter.has(ansprechpartnerWoerter[0]) &&
        !ansprechpartnerWoerter.slice(1).some((w) => matchedWoerter.has(w))
      if (nurVorname) continue
      const kandidat: KundeMatch = { bereich: b.id, kundeId: k.id, kundeName: `${k.firma} (${k.ansprechpartner})`, score }
      if (score > bestScore) {
        bestScore = score
        beste = [kandidat]
      } else if (score === bestScore) {
        beste.push(kandidat)
      }
    }
  }
  return beste
}

export function suggestKunde(state: AppData, text: string): KundeMatch | null {
  return suggestKundeKandidaten(state, text)[0] ?? null
}

// Sucht einen Kunden/Mandanten über alle Bereiche hinweg anhand der Telefonnummer — fürs
// "Gespräch aufzeichnen" ohne vorher in eine bestimmte Akte zu gehen (Nummer eintippen, System
// erkennt den Kunden). Vergleicht nur Ziffern (Formatierung wie Leerzeichen/Klammern/Ländervorwahl
// wird ignoriert) und verlangt mindestens 6 übereinstimmende Endziffern, damit kurze/leere Nummern
// nicht zufällig alles matchen.
export function suggestKundeByTelefon(state: AppData, nummer: string): KundeMatch[] {
  const ziffern = nummer.replace(/\D/g, '')
  if (ziffern.length < 6) return []
  const suffix = ziffern.slice(-8) // auf die letzten 8 Ziffern vergleichen, robust gegen Landesvorwahl-Schreibweisen (+49 vs. 0)
  const treffer: KundeMatch[] = []
  for (const b of KUNDEN_BEREICHE) {
    for (const k of b.get(state)) {
      const kundenZiffern = (k.telefon ?? '').replace(/\D/g, '')
      if (kundenZiffern.length < 6) continue
      if (kundenZiffern.slice(-8) === suffix || kundenZiffern.endsWith(suffix.slice(-6)) || suffix.endsWith(kundenZiffern.slice(-6))) {
        treffer.push({ bereich: b.id, kundeId: k.id, kundeName: `${k.firma} (${k.ansprechpartner})`, score: 100 })
      }
    }
  }
  return treffer
}

// Exakter Treffer per E-Mail-Adresse (für den Posteingang zuverlässiger als reines Text-Matching).
export function matchKundeByEmail(state: AppData, email: string): KundeMatch | null {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  for (const b of KUNDEN_BEREICHE) {
    const kunde = b.get(state).find((k) => k.email.trim().toLowerCase() === normalized)
    if (kunde) return { bereich: b.id, kundeId: kunde.id, kundeName: `${kunde.firma} (${kunde.ansprechpartner})`, score: 100 }
  }
  return null
}
