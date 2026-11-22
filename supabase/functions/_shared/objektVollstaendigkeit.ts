// Vollständigkeit einer Objektakte (22.11.2026): Was fehlt noch, damit ein Objekt gut vermarktet werden kann?
// Anlass: Im Bestand hatten 30 aktive Objekte keinen Kaufpreis, die meisten keine Fotos, keine Nummern des
// Inserats (Anfragen von Portalen ließen sich nicht zuordnen), Exposé und Verkaufsdatenblatt oft leer.
//
// Reiner Kern ohne Datenbank und ohne Browser — genutzt vom CRM (src/components/ObjektWasFehlt.tsx,
// src/pages/immobilien/ObjektListe.tsx), vom Assistenten (telegram-gateway/objektLueckenWerkzeug.ts) und vom
// Wochenhinweis am Montag (email-gateway/objektLueckenHinweis.ts).
//
// Je Objekt eine Prüfliste. Wie wichtig ein Punkt ist (Gewicht), hängt vom Stand des Objekts ab: In der
// Akquise genügen Eckdaten, in der Vorbereitung kommen Unterlagen und Fotos dazu, in der Vermarktung zählt
// alles, was Interessenten sehen (Fotos, Exposé, Portal, Inserat). Nach der Reservierung zählen nur noch die
// Eckdaten und das Grundbuch; Archiv, verkauft und abgebrochen werden nicht mehr bewertet.
// Ergebnis: Prozent (Summe der erfüllten Gewichte / Summe aller Gewichte) und die fehlenden Punkte mit
// einem kurzen Hinweis, wo man sie einträgt (Reiter der Objektakte, ggf. Ordner).

import { leseReihenfolge } from './bilderReihenfolge.ts'

export type Phase = 'akquise' | 'vorbereitung' | 'vermarktung' | 'verkauf' | 'ende'

export type PunktSchluessel =
  | 'kaufpreis'
  | 'adresse'
  | 'objektart'
  | 'flaeche'
  | 'eigentuemer'
  | 'verantwortlich'
  | 'fotos'
  | 'titelbild'
  | 'exposeText'
  | 'exposePdf'
  | 'energieausweis'
  | 'grundbuch'
  | 'inserat'
  | 'portal'

/** Reiter der Objektakte (ids wie TABS in src/pages/immobilien/ObjektDetail.tsx). */
export type Reiter = 'uebersicht' | 'verkaufsdaten' | 'dokumente' | 'interessenten'

export type Punkt = {
  schluessel: PunktSchluessel
  titel: string
  erfuellt: boolean
  /** Gewicht im aktuellen Stand (immer > 0; Punkte mit Gewicht 0 sind gar nicht in der Liste). */
  gewicht: number
  /** Kurz, was genau fehlt (z. B. „2 von 5 Fotos“); leer, wenn erfüllt. */
  detail: string
  /** Wo man es im CRM einträgt. */
  hinweis: string
  /** Wie es über den Assistenten geht (für Telegram). */
  assistent: string
  reiter: Reiter
  /** Bei Reiter „dokumente“: der Ordner. */
  ordner?: string
}

export type Vollstaendigkeit = {
  phase: Phase
  /** false bei Archiv, verkauft, abgebrochen: keine Bewertung. */
  gilt: boolean
  /** 0–100, null wenn !gilt. */
  prozent: number | null
  punkte: Punkt[]
  /** Fehlende Punkte, wichtigste zuerst. */
  fehlend: Punkt[]
}

/** Was die Prüfung braucht — gleich, ob es aus dem CRM-Zustand (camelCase) oder einer Datenbankzeile kommt. */
export type VollstaendigkeitEingabe = {
  status?: string | null
  typ?: string | null
  kaufpreis?: number | string | null
  adresse?: string | null
  verantwortlich?: string | null
  eigentuemer?: unknown
  verkaufsdaten?: unknown
  dokumente?: unknown
  bilderReihenfolge?: unknown
  exposeText?: string | null
  /** objekte.anfrage_kennungen — undefined = nicht geladen (Punkt gilt dann als offen). */
  anfrageKennungen?: string[] | null
  /** objekte.interessenten_dokumente — Dokument-Kennungen, die im Interessenten-Portal freigegeben sind. */
  interessentenDokumente?: string[] | null
  offMarket?: boolean | null
  /** Privates Objekt: kein Interessenten-Portal, keine Inserat-Nummern. */
  privat?: boolean
}

export const MIN_FOTOS = 5

const PHASE_VON_STATUS: Record<string, Phase> = {
  akquise: 'akquise',
  on_hold: 'akquise',
  vorbereitung: 'vorbereitung',
  vermarktung: 'vermarktung',
  reserviert: 'verkauf',
  notarauftrag_vorbereitet: 'verkauf',
  vertragsentwurf_erhalten: 'verkauf',
  pruefung_verkaeufer: 'verkauf',
  pruefung_kaeufer: 'verkauf',
  aenderungswuensche: 'verkauf',
  notartermin: 'verkauf',
  beurkundet: 'verkauf',
  faelligkeitsmitteilung: 'verkauf',
  kaufpreis_gezahlt: 'verkauf',
  besitzuebergang: 'verkauf',
  verkauft: 'ende',
  archiv: 'ende',
  abgebrochen: 'ende',
}

export function phaseVon(status: string | null | undefined): Phase {
  return PHASE_VON_STATUS[String(status ?? '').trim()] ?? 'akquise'
}

export const PHASE_TEXT: Record<Phase, string> = {
  akquise: 'Akquise',
  vorbereitung: 'Vorbereitung',
  vermarktung: 'Vermarktung',
  verkauf: 'Verkauf läuft',
  ende: 'abgeschlossen',
}

type Gewichte = Record<Exclude<Phase, 'ende'>, number>

// Gewicht je Stand: [Akquise, Vorbereitung, Vermarktung, Verkauf läuft]. 0 = in diesem Stand nicht nötig.
const GEWICHT: Record<PunktSchluessel, Gewichte> = {
  kaufpreis: { akquise: 3, vorbereitung: 3, vermarktung: 3, verkauf: 2 },
  adresse: { akquise: 2, vorbereitung: 3, vermarktung: 3, verkauf: 2 },
  objektart: { akquise: 1, vorbereitung: 1, vermarktung: 1, verkauf: 0 },
  flaeche: { akquise: 1, vorbereitung: 2, vermarktung: 2, verkauf: 0 },
  eigentuemer: { akquise: 2, vorbereitung: 2, vermarktung: 2, verkauf: 1 },
  verantwortlich: { akquise: 2, vorbereitung: 2, vermarktung: 2, verkauf: 2 },
  fotos: { akquise: 0, vorbereitung: 2, vermarktung: 3, verkauf: 0 },
  titelbild: { akquise: 0, vorbereitung: 1, vermarktung: 2, verkauf: 0 },
  exposeText: { akquise: 0, vorbereitung: 1, vermarktung: 2, verkauf: 0 },
  exposePdf: { akquise: 0, vorbereitung: 1, vermarktung: 3, verkauf: 0 },
  energieausweis: { akquise: 0, vorbereitung: 2, vermarktung: 3, verkauf: 1 },
  grundbuch: { akquise: 1, vorbereitung: 2, vermarktung: 3, verkauf: 2 },
  inserat: { akquise: 0, vorbereitung: 0, vermarktung: 2, verkauf: 0 },
  portal: { akquise: 0, vorbereitung: 0, vermarktung: 2, verkauf: 0 },
}

/** Für Grundstücke und Neubauprojekte gibt es (noch) keinen Energieausweis — wie OBJEKT_UNTERLAGEN_PFLICHT im CRM. */
const OHNE_ENERGIEAUSWEIS = new Set(['Grundstück', 'Neubauprojekt'])
/** Objektarten, die schon genau genug sind (keine feinere Angabe im Verkaufsdatenblatt nötig). */
const GENAUE_TYPEN = new Set(['Wohnung', 'Grundstück'])
const GUELTIGE_TYPEN = new Set(['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Neubauprojekt'])

// ---------------------------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------------------------

function obj(wert: unknown): Record<string, unknown> {
  return wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : {}
}

function txt(wert: unknown): string {
  return typeof wert === 'string' ? wert.trim() : typeof wert === 'number' && Number.isFinite(wert) ? String(wert) : ''
}

/** Euro-Betrag aus Zahl oder Text („1.200.000“, „1,2 Mio“ zählt nicht — nur echte Zahlen). */
function betrag(wert: unknown): number {
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : 0
  if (typeof wert === 'string') {
    const n = Number(wert.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

type Dok = { id: string; name: string; typ: string }

function dokumenteIn(dokumente: unknown, ordner: string): Dok[] {
  const liste = obj(dokumente)[ordner]
  if (!Array.isArray(liste)) return []
  return liste
    .map((d) => obj(d))
    .filter((d) => txt(d.id) || txt(d.name))
    .map((d) => ({ id: txt(d.id), name: txt(d.name), typ: txt(d.typ) }))
}

function alleDokumentIds(dokumente: unknown): Set<string> {
  const ids = new Set<string>()
  for (const liste of Object.values(obj(dokumente))) {
    if (!Array.isArray(liste)) continue
    for (const d of liste) {
      const id = txt(obj(d).id)
      if (id) ids.add(id)
    }
  }
  return ids
}

function istBild(d: Dok): boolean {
  if (d.typ) return d.typ.toLowerCase().startsWith('image/')
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(d.name)
}

function istPdf(d: Dok): boolean {
  return d.typ.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(d.name)
}

/** PLZ (fünf Ziffern) in einem Text. */
export function hatPlz(text: string): boolean {
  return /(^|\D)\d{5}(\D|$)/.test(text)
}

// ---------------------------------------------------------------------------------------------
// Die Prüfung
// ---------------------------------------------------------------------------------------------

type Pruefung = { erfuellt: boolean; detail: string }

function pruefe(e: VollstaendigkeitEingabe): Record<PunktSchluessel, Pruefung> {
  const vd = obj(e.verkaufsdaten)
  const kz = obj(vd.kennzahlen)
  const ueb = obj(vd.uebersicht)
  const auftraggeber = obj(vd.auftraggeber)
  const eig = obj(e.eigentuemer)
  const typ = txt(e.typ)

  const preis = betrag(e.kaufpreis) > 0 || betrag(kz.kaufpreisvorstellung) > 0 || betrag(kz.zielverkaufspreis) > 0

  const adresse = txt(e.adresse)
  const plzOrt = txt(ueb.plzOrt)
  const strasse = txt(ueb.strasse)
  const adresseOk = (hatPlz(adresse) && /[a-zäöüß]/i.test(adresse.replace(/\d{5}/, ''))) || (hatPlz(plzOrt) && !!strasse)
  const adresseDetail = !adresse && !plzOrt ? 'keine Adresse' : 'Straße oder PLZ fehlt'

  const objektartOk = GUELTIGE_TYPEN.has(typ) && (!!txt(ueb.objektart) || GENAUE_TYPEN.has(typ))

  const flaeche = typ === 'Grundstück'
    ? !!txt(kz.grundstuecksflaeche)
    : !!(txt(kz.wohnflaeche) || txt(kz.nutzflaeche))
  const zimmerNoetig = typ === 'Wohnung'
  const zimmer = !!txt(kz.zimmer)
  const flaecheOk = flaeche && (!zimmerNoetig || zimmer)
  const flaecheDetail = !flaeche && zimmerNoetig && !zimmer ? 'Fläche und Zimmer fehlen' : !flaeche ? 'Fläche fehlt' : 'Zimmerzahl fehlt'

  const kontakt = (o: Record<string, unknown>) => !!txt(o.name) && !!(txt(o.telefon) || txt(o.email))
  const eigentuemerOk = kontakt(eig) || kontakt(auftraggeber)
  const eigentuemerDetail = txt(eig.name) || txt(auftraggeber.name) ? 'Telefon oder E-Mail fehlt' : 'kein Eigentümer eingetragen'

  const verantwortlichOk = !!txt(e.verantwortlich)

  const bilder = dokumenteIn(e.dokumente, 'Bilder').filter(istBild)
  const fotosOk = bilder.length >= MIN_FOTOS
  // Titelbild = ausdrücklich festgelegte Reihenfolge, deren erstes Foto es im Ordner noch gibt.
  const bildIds = new Set(bilder.map((b) => b.id))
  const reihenfolge = leseReihenfolge(e.bilderReihenfolge).filter((r) => bildIds.has(r.id))
  const titelbildOk = reihenfolge.length > 0
  const titelDetail = bilder.length === 0 ? 'noch keine Fotos' : 'nicht festgelegt'

  const exposeTextOk = txt(e.exposeText).length >= 80

  const exposePdfOk = dokumenteIn(e.dokumente, 'Exposé').some(istPdf)

  const energieOk = dokumenteIn(e.dokumente, 'Energieausweis').length > 0
  const grundbuchOk = dokumenteIn(e.dokumente, 'Grundbuch').length > 0

  const kennungen = (e.anfrageKennungen ?? []).map((k) => String(k ?? '').trim()).filter(Boolean)
  const inseratOk = kennungen.length > 0

  const vorhandeneIds = alleDokumentIds(e.dokumente)
  const freigegeben = (e.interessentenDokumente ?? []).filter((id) => vorhandeneIds.has(String(id)))
  const portalOk = freigegeben.length > 0

  return {
    kaufpreis: { erfuellt: preis, detail: 'kein Kaufpreis' },
    adresse: { erfuellt: adresseOk, detail: adresseDetail },
    objektart: { erfuellt: objektartOk, detail: GUELTIGE_TYPEN.has(typ) ? 'genaue Objektart fehlt' : 'keine Objektart' },
    flaeche: { erfuellt: flaecheOk, detail: flaecheDetail },
    eigentuemer: { erfuellt: eigentuemerOk, detail: eigentuemerDetail },
    verantwortlich: { erfuellt: verantwortlichOk, detail: 'niemand verantwortlich' },
    fotos: { erfuellt: fotosOk, detail: `${bilder.length} von ${MIN_FOTOS} Fotos` },
    titelbild: { erfuellt: titelbildOk, detail: titelDetail },
    exposeText: { erfuellt: exposeTextOk, detail: txt(e.exposeText) ? 'Text zu kurz' : 'kein Text' },
    exposePdf: { erfuellt: exposePdfOk, detail: 'kein Exposé als PDF im Ordner „Exposé“' },
    energieausweis: { erfuellt: energieOk, detail: 'Ordner „Energieausweis“ leer' },
    grundbuch: { erfuellt: grundbuchOk, detail: 'Ordner „Grundbuch“ leer' },
    inserat: { erfuellt: inseratOk, detail: 'keine Nummer eingetragen' },
    portal: { erfuellt: portalOk, detail: 'nichts freigegeben' },
  }
}

type Beschreibung = Pick<Punkt, 'titel' | 'hinweis' | 'assistent' | 'reiter' | 'ordner'>

const BESCHREIBUNG: Record<PunktSchluessel, Beschreibung> = {
  kaufpreis: {
    titel: 'Kaufpreis',
    hinweis: 'Reiter „Verkaufsdatenblatt“: Kaufpreisvorstellung oder Zielverkaufspreis eintragen und speichern.',
    assistent: 'Kaufpreis nennen (objekt_aendern).',
    reiter: 'verkaufsdaten',
  },
  adresse: {
    titel: 'Adresse mit PLZ',
    hinweis: 'Reiter „Verkaufsdatenblatt“, Abschnitt Übersicht: Straße und PLZ/Ort eintragen.',
    assistent: 'Straße, Hausnummer, PLZ und Ort nennen (objekt_aendern).',
    reiter: 'verkaufsdaten',
  },
  objektart: {
    titel: 'Objektart',
    hinweis: 'Reiter „Verkaufsdatenblatt“, Abschnitt Übersicht: Objektart wählen (z. B. Mehrfamilienhaus).',
    assistent: 'Objektart nennen (objekt_aendern, typ); die genaue Art im Verkaufsdatenblatt im CRM.',
    reiter: 'verkaufsdaten',
  },
  flaeche: {
    titel: 'Fläche und Zimmer',
    hinweis: 'Reiter „Verkaufsdatenblatt“, Kennzahlen: Wohn- oder Nutzfläche (beim Grundstück die Grundstücksfläche), bei Wohnungen die Zimmer.',
    assistent: 'Im CRM im Verkaufsdatenblatt eintragen (geht nicht über den Assistenten).',
    reiter: 'verkaufsdaten',
  },
  eigentuemer: {
    titel: 'Eigentümer-Kontakt',
    hinweis: 'Reiter „Übersicht“, Kasten Eigentümer (Link an den Eigentümer schicken) oder im Verkaufsdatenblatt unter Auftraggeber.',
    assistent: 'Name, Telefon oder E-Mail des Eigentümers nennen (objekt_aendern, eigentuemer).',
    reiter: 'uebersicht',
  },
  verantwortlich: {
    titel: 'Verantwortlicher',
    hinweis: 'Dem Assistenten sagen, wer das Objekt betreut („Verantwortlich für … ist …“).',
    assistent: 'Verantwortlichen setzen (objekt_aendern, verantwortlich).',
    reiter: 'uebersicht',
  },
  fotos: {
    titel: `Mindestens ${MIN_FOTOS} Fotos`,
    hinweis: 'Reiter „Dokumente“, Ordner „Bilder“: Fotos hochladen — oder per Telegram an den Assistenten schicken.',
    assistent: 'Fotos schicken und ins Objekt legen (fotos_ins_objekt).',
    reiter: 'dokumente',
    ordner: 'Bilder',
  },
  titelbild: {
    titel: 'Titelbild',
    hinweis: 'Reiter „Dokumente“, Ordner „Bilder“: Foto als Titelbild festlegen und die Reihenfolge ordnen.',
    assistent: 'Titelbild vorschlagen lassen oder festlegen (titelbild_vorschlagen, bild_reihenfolge_setzen).',
    reiter: 'dokumente',
    ordner: 'Bilder',
  },
  exposeText: {
    titel: 'Exposé-Text',
    hinweis: 'Reiter „Übersicht“, Kasten Exposé: Text erstellen lassen oder schreiben.',
    assistent: 'Exposé erstellen lassen (expose_erstellen).',
    reiter: 'uebersicht',
  },
  exposePdf: {
    titel: 'Exposé als PDF',
    hinweis: 'Reiter „Übersicht“, Kasten Exposé: „Exposé erstellen“ — das PDF landet im Ordner „Exposé“.',
    assistent: 'Exposé als PDF erstellen und ablegen (expose_erstellen).',
    reiter: 'uebersicht',
  },
  energieausweis: {
    titel: 'Energieausweis',
    hinweis: 'Reiter „Dokumente“, Ordner „Energieausweis“: Datei hochladen oder beim Eigentümer anfordern.',
    assistent: 'Datei schicken und in den Ordner Energieausweis legen (dateien_ins_objekt).',
    reiter: 'dokumente',
    ordner: 'Energieausweis',
  },
  grundbuch: {
    titel: 'Grundbuchauszug',
    hinweis: 'Reiter „Dokumente“, Ordner „Grundbuch“: Auszug hochladen oder beim Eigentümer anfordern.',
    assistent: 'Datei schicken und in den Ordner Grundbuch legen (dateien_ins_objekt).',
    reiter: 'dokumente',
    ordner: 'Grundbuch',
  },
  inserat: {
    titel: 'Nummern des Inserats',
    hinweis: 'Reiter „Interessenten-Portal“, unten: die Nummer des Inserats je Portal eintragen — sonst lassen sich Anfragen nicht zuordnen.',
    assistent: 'Nur im CRM: Reiter „Interessenten-Portal“, Nummern des Inserats.',
    reiter: 'interessenten',
  },
  portal: {
    titel: 'Unterlagen fürs Interessenten-Portal',
    hinweis: 'Reiter „Interessenten-Portal“: Unterlagen ankreuzen, die Interessenten sehen dürfen (mindestens das Exposé).',
    assistent: 'Beim Exposé erstellen gleich freigeben lassen (expose_erstellen) oder im CRM ankreuzen.',
    reiter: 'interessenten',
  },
}

const REIHENFOLGE: PunktSchluessel[] = [
  'kaufpreis', 'adresse', 'objektart', 'flaeche', 'eigentuemer', 'verantwortlich',
  'fotos', 'titelbild', 'exposeText', 'exposePdf', 'energieausweis', 'grundbuch', 'inserat', 'portal',
]

/** Gewicht eines Punkts für dieses Objekt (0 = gilt hier nicht). */
function gewichtVon(s: PunktSchluessel, phase: Phase, e: VollstaendigkeitEingabe): number {
  if (phase === 'ende') return 0
  if (s === 'energieausweis' && OHNE_ENERGIEAUSWEIS.has(txt(e.typ))) return 0
  // Private Objekte haben kein Interessenten-Portal; nicht öffentliche (Off-Market) stehen auf keinem Portal.
  if ((s === 'inserat' || s === 'portal') && e.privat) return 0
  if (s === 'inserat' && e.offMarket) return 0
  return GEWICHT[s][phase]
}

/** Die Prüfliste eines Objekts mit Prozent und fehlenden Punkten. */
export function pruefeVollstaendigkeit(e: VollstaendigkeitEingabe): Vollstaendigkeit {
  const phase = phaseVon(e.status)
  if (phase === 'ende') return { phase, gilt: false, prozent: null, punkte: [], fehlend: [] }
  const ergebnis = pruefe(e)
  const punkte: Punkt[] = []
  for (const s of REIHENFOLGE) {
    const gewicht = gewichtVon(s, phase, e)
    if (gewicht <= 0) continue
    const p = ergebnis[s]
    punkte.push({ schluessel: s, ...BESCHREIBUNG[s], gewicht, erfuellt: p.erfuellt, detail: p.erfuellt ? '' : p.detail })
  }
  const summe = punkte.reduce((n, p) => n + p.gewicht, 0)
  const erreicht = punkte.reduce((n, p) => n + (p.erfuellt ? p.gewicht : 0), 0)
  const prozent = summe === 0 ? 100 : Math.round((erreicht / summe) * 100)
  const fehlend = punkte
    .filter((p) => !p.erfuellt)
    .sort((a, b) => b.gewicht - a.gewicht || REIHENFOLGE.indexOf(a.schluessel) - REIHENFOLGE.indexOf(b.schluessel))
  return { phase, gilt: true, prozent, punkte, fehlend }
}

/** Fehlt noch etwas, das im aktuellen Stand zählt? (Filter „unvollständig“, Wochenhinweis) */
export function istUnvollstaendig(v: Vollstaendigkeit): boolean {
  return v.gilt && v.fehlend.length > 0
}

/** Eingabe aus einer Datenbankzeile von `objekte` (Spaltennamen wie in der Tabelle). */
export function eingabeAusZeile(z: Record<string, unknown>): VollstaendigkeitEingabe {
  const liste = (w: unknown) => (Array.isArray(w) ? w.map((x) => String(x ?? '')) : null)
  return {
    status: txt(z.status),
    typ: txt(z.typ),
    kaufpreis: (z.kaufpreis as number | string | null) ?? null,
    adresse: txt(z.adresse),
    verantwortlich: txt(z.verantwortlich),
    eigentuemer: z.eigentuemer,
    verkaufsdaten: z.verkaufsdaten,
    dokumente: z.dokumente,
    bilderReihenfolge: z.bilder_reihenfolge,
    exposeText: typeof z.expose_text === 'string' ? z.expose_text : null,
    anfrageKennungen: liste(z.anfrage_kennungen),
    interessentenDokumente: liste(z.interessenten_dokumente),
    offMarket: z.off_market === true,
    privat: !!txt(z.privat_besitzer),
  }
}

/** Die Spalten, die eingabeAusZeile braucht (plus id/bezeichnung für Listen). */
export const VOLLSTAENDIGKEIT_SPALTEN =
  'id, bezeichnung, status, typ, kaufpreis, adresse, verantwortlich, eigentuemer, verkaufsdaten, dokumente, bilder_reihenfolge, expose_text, anfrage_kennungen, interessenten_dokumente, off_market, privat_besitzer'

/** Kurzform für Listen: „Kaufpreis, Fotos (2 von 5 Fotos), Grundbuchauszug“. */
export function fehlendKurz(v: Vollstaendigkeit, hoechstens = 6): string {
  const teile = v.fehlend.slice(0, hoechstens).map((p) => (p.schluessel === 'fotos' ? `Fotos (${p.detail})` : p.titel))
  const rest = v.fehlend.length - teile.length
  return rest > 0 ? `${teile.join(', ')} und ${rest} weitere` : teile.join(', ')
}
