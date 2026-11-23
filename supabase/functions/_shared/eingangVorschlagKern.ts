// Vorschläge für „Ungeklärte Eingänge“ auf dem Server (Runde 6, 23.11.2026).
//
// Die Seite src/pages/eingang/UngeklaerteEingaenge.tsx rechnet ihre Vorschläge im Browser aus (Wörter aus Dateiname
// und Kurzfassung gegen Kunden- und Objektnamen). Für „Bitte bestätigen“ per Telegram (email-gateway/bitteBestaetigen.ts)
// braucht der Server dieselbe Bewertung — diese Datei ist eine wörtliche Übertragung von woerter, brauchbar,
// merkmaleAus, vorschlaegeFuer und ordnerFuer aus der Seite. Ändert sich dort etwas, hier nachziehen
// (Test: email-gateway/bitteBestaetigen.test.ts prüft einige Fälle der Seite).
//
// Bewusst ohne Deno- oder Browser-Funktionen.

export type EingangKandidat =
  | { art: 'kunde'; id: string; bereich: string; name: string }
  | { art: 'objekt'; id: string; name: string }

export type Merkmale = { kandidat: EingangKandidat; stark: string[]; schwach: string[] }

function normal(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function woerter(text: string): string[] {
  return normal(text).split(/[^a-z0-9]+/).filter(Boolean)
}

const ALLERWELTSWOERTER = new Set(
  `gmbh mbh ohg gbr holding gruppe group firma gesellschaft verwaltung verwaltungs immobilien immobilie beratung
  kanzlei service services consulting management invest partner haus wohnung grundstueck gewerbe objekt objekte
  mehrfamilienhaus einfamilienhaus neubau neubauprojekt strasse platz gasse allee ring rechnung rechnungen scan scans
  scanned dokument dokumente document datei dateien vertrag vertraege angebot angebote brief schreiben kopie anlage
  anlagen anhang seite seiten foto fotos bild bilder image images photo photos screenshot bildschirmfoto whatsapp
  telegram signal jpeg heic docx xlsx final entwurf version unterlagen unterlage eingang sonstiges herr frau herrn
  familie eheleute januar februar maerz april juni juli august september oktober november dezember montag dienstag
  mittwoch donnerstag freitag samstag sonntag auftrag bestellung lieferschein mahnung bescheid antrag formular
  vollmacht protokoll notiz liste uebersicht deutschland germany nord sued west mitte stadt kreis bank sparkasse
  versicherung finanzamt notar steuerberater kunde kunden mandant privat intern unbekannt ohne name namen`.split(/\s+/),
)

const VORNAMEN = new Set(
  `andreas michael thomas stefan stephan christian peter martin klaus hans wolfgang juergen frank markus marcus
  alexander daniel matthias mathias joachim josef joseph johann johannes manfred helmut werner gerhard dieter bernd
  ralf rolf karl heinz walter guenter guenther horst tobias florian sebastian patrick oliver christoph robert
  richard georg erwin erich ernst franz friedrich fritz hermann herbert kurt otto paul rainer reiner rudolf simon
  timo ulrich volker anna maria sabine petra monika andrea claudia susanne ursula karin birgit nicole stefanie
  stephanie christina christine julia katharina elisabeth renate heike gabriele martina angelika brigitte barbara
  nadja evelyn sandra melanie daniela silvia sylvia ingrid helga erika gisela anja tanja kerstin simone`.split(/\s+/),
)

function brauchbar(wort: string): boolean {
  return wort.length >= 4 && /^[a-z]+$/.test(wort) && !ALLERWELTSWOERTER.has(wort)
}

export function merkmaleAus(kandidat: EingangKandidat, starkText: string, weitererText: string, sperre: Set<string>): Merkmale {
  const stark = new Set<string>()
  const schwach = new Set<string>()
  for (const w of woerter(starkText)) if (brauchbar(w) && !sperre.has(w)) (VORNAMEN.has(w) ? schwach : stark).add(w)
  const person = woerter(weitererText).filter((w) => brauchbar(w) && !sperre.has(w))
  person.forEach((w, i) => {
    if (stark.has(w)) return
    if (i === person.length - 1 && !VORNAMEN.has(w)) stark.add(w)
    else schwach.add(w)
  })
  return { kandidat, stark: [...stark], schwach: [...schwach].filter((w) => !stark.has(w)) }
}

export function haeufigkeitAus(merkmale: Merkmale[]): Map<string, number> {
  const h = new Map<string, number>()
  for (const m of merkmale) for (const w of new Set([...m.stark, ...m.schwach])) h.set(w, (h.get(w) ?? 0) + 1)
  return h
}

export function vorschlaegeFuer(dateiname: string, kurzfassung: string, merkmale: Merkmale[], haeufigkeit: Map<string, number>): EingangKandidat[] {
  const ohneEndung = dateiname.replace(/\.[A-Za-z0-9]{2,5}$/, '')
  const imNamen = new Set(woerter(ohneEndung))
  const namenAmStueck = normal(ohneEndung).replace(/[^a-z0-9]+/g, '')
  const imText = new Set(woerter(kurzfassung))
  const stehtImNamen = (w: string) => imNamen.has(w) || (w.length >= 6 && namenAmStueck.includes(w))

  const bewertet: { kandidat: EingangKandidat; punkte: number }[] = []
  for (const m of merkmale) {
    let punkte = 0
    let nameTreffer = 0
    let starkImNamen = 0
    let textTreffer = 0
    let starkImText = 0
    let eindeutigImText = false
    const pruefe = (w: string, stark: boolean) => {
      const wieOft = haeufigkeit.get(w) ?? 0
      if (wieOft > 3) return
      if (stehtImNamen(w)) {
        nameTreffer++
        if (stark) starkImNamen++
        punkte += stark ? 4 : 2
      } else if (imText.has(w)) {
        textTreffer++
        if (stark) starkImText++
        if (stark && w.length >= 8 && wieOft === 1) eindeutigImText = true
        punkte += stark ? 2 : 1
      }
    }
    m.stark.forEach((w) => pruefe(w, true))
    m.schwach.forEach((w) => pruefe(w, false))
    const passt = starkImNamen >= 1 || nameTreffer >= 2 || (nameTreffer >= 1 && textTreffer >= 1) || (textTreffer >= 2 && starkImText >= 1) || eindeutigImText
    if (passt) bewertet.push({ kandidat: m.kandidat, punkte })
  }
  if (bewertet.length === 0) return []
  bewertet.sort((a, b) => b.punkte - a.punkte)
  const beste = bewertet[0].punkte
  if (bewertet.filter((b) => b.punkte === beste).length > 2) return []
  return bewertet.filter((b) => b.punkte >= beste * 0.6).slice(0, 2).map((b) => b.kandidat)
}

const ORDNER_REGELN: [RegExp, string][] = [
  [/grundbuch/i, 'Grundbuch'],
  [/grundriss/i, 'Grundrisse'],
  [/flurkarte/i, 'Flurkarte'],
  [/lageplan/i, 'Lageplan'],
  [/energieausweis/i, 'Energieausweis'],
  [/teilungserkl/i, 'Teilungserklärung'],
  [/mietvertr/i, 'Mietverträge'],
  [/mieterliste|mietaufstellung/i, 'Mieterliste'],
  [/expos/i, 'Exposé'],
  [/gutachten|wertermittlung|bewertung/i, 'Gutachten'],
  [/kaufvertrag|notar/i, 'Notarielle Dokumente'],
  [/vertrag|vollmacht/i, 'Verträge'],
]

/** Ordner der Objektakte für eine Datei (wie die Seite; Auffang „Sonstiges“, Bilder nach „Bilder“). */
export function ordnerFuer(d: { name?: string | null; typ?: string | null }): string {
  for (const [muster, ordner] of ORDNER_REGELN) if (muster.test(String(d.name ?? ''))) return ordner
  return String(d.typ ?? '').toLowerCase().startsWith('image/') ? 'Bilder' : 'Sonstiges'
}
