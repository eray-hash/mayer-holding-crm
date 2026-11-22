// Assistent-Werkzeuge für Dateien in der Kundenakte:
// - "dokument_erstellen": macht aus einem Text, den der Assistent geschrieben hat (Merkblatt, Schreiben,
//   Zusammenfassung), eine fertige PDF- oder Word-Datei und legt sie in der Kundenakte ab. Anlass:
//   Andreas Mayer bat am 19.11.2026 zweimal um "ein Handout aus den Vertragsnotizen"; der Assistent
//   konnte bis dahin nur Text zum Abschreiben liefern. Word seit 20.11.2026 (dateiFormate.ts).
// - "tabelle_erstellen" (seit 20.11.2026): echte Excel-Datei aus Spalten und Zeilen, die der Assistent
//   selbst ausschreibt — z. B. eine Liste von einem Foto. Anlass: Ein Mitarbeiter schickte das Foto
//   einer Liste und wollte eine Excel-Datei mit zwei Spalten.
// - "datei_senden" (seit 20.11.2026, dateiSenden.ts): schickt eine Datei der Akte per Telegram.
//
// Ablage wie beim Hochladen im CRM (src/lib/kundenDokumenteStorage.ts, DokumenteSection.tsx):
// privater Bucket "kunden-dokumente", Pfad "<kundeId>/dok_<kennung>_<dateiname>", und in
// kunden.dokumente ein Eintrag { id, name, typ, datum, groesse, url } mit url = Storage-Pfad (kein
// https); dazu quelle "assistent" (datei_senden erkennt daran selbst erstellte Dateien). Geöffnet wird
// die Datei im CRM über einen kurz gültigen Link; email-gateway liest solche Pfade ebenfalls
// (dokument_inhalte, auch .docx/.xlsx), d. h. kundenakte_lesen und dokument_inhalt funktionieren auch.
//
// Seit 22.11.2026 auch in die Objektakte (objekt_id statt kunde_id, Ordner frei wählbar, Vorgabe „Exposé“
// bei Exposés, sonst „Sonstiges“) — Ablage über objektAblage.ts. Anlass: Wunsch vom 20.11.2026, ein
// erstelltes Exposé landete mangels Funktion in einer Sammelakte.
//
// Die Datei kennt index.ts nicht (kein Kreis-Import): Datenbank, Mitarbeiter und Protokoll reicht der
// Aufrufer herein, die Rechte kommen aus rechte.ts. Neue Werkzeuge hier in DOKUMENT_WERKZEUGE und
// istDokumentWerkzeug eintragen — index.ts übernimmt sie von selbst.

import { PDFDocument, type PDFEmbeddedPage, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { type Lauf, laeufe, ohneTitelUeberschrift, zerlege } from './auszeichnung.ts'
import { type BlattEingabe, DOCX_TYP, erstelleDocx, erstelleXlsx, XLSX_TYP } from './dateiFormate.ts'
import { DATEI_SENDEN_WERKZEUG, fuehreDateiSendenAus } from './dateiSenden.ts'
import { ladeObjektMitRechten, legeInsObjektAb, objektAnzeige, type ObjektZeile, ordnerAusEingabe } from './objektAblage.ts'
import { type AkteFuerRechte, darfAkte as darfAkteStandard, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// Die Zerlegung der Auszeichnung liegt in auszeichnung.ts (gemeinsam mit Word); hier weiter erreichbar.
export { type Block, type Lauf, laeufe, zerlege } from './auszeichnung.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type DokumentKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; id?: string | null }
  protokolliere: (text: string) => void
  /** Heutiges Datum JJJJ-MM-TT (Berlin). Ohne Angabe selbst ermittelt. */
  heute?: string
  /** Nur falls index.ts eine eigene Prüfung hat; sonst gilt darfAkte aus rechte.ts. */
  darfAkte?: (m: RechteMitarbeiter, akte: AkteFuerRechte) => boolean
  /** Für datei_senden: Chat-ID, falls bekannt (sonst aus der Tabelle mitarbeiter). */
  chatId?: number | string | null
  /** Für Tests von datei_senden: Bot-Schlüssel (null = keiner) und Ersatz für fetch. */
  botToken?: string | null
  abruf?: typeof fetch
}

const BUCKET = 'kunden-dokumente'
const MAX_ZEICHEN = 60_000

const ARTEN = ['handout', 'brief', 'zusammenfassung'] as const
type Art = (typeof ARTEN)[number]
// Angezeigt wird nur Deutsch: "handout" ist bloß der Schlüssel, auf dem Blatt steht "Merkblatt".
const ART_NAME: Record<Art, string> = { handout: 'Merkblatt', brief: 'Schreiben', zusammenfassung: 'Zusammenfassung' }

export const FIRMA = 'Andreas Mayer Holding'
export const FIRMA_ZEILE = 'Andreas Mayer Holding UG (haftungsbeschränkt) · Schwabstraße 3 · 89075 Ulm'

const SENDEN_HINWEIS = 'Will der Mitarbeiter die Datei hier in Telegram haben, schick sie mit datei_senden'

export const DOKUMENT_WERKZEUGE = [
  {
    name: 'dokument_erstellen',
    description:
      'Erstellt aus einem von dir geschriebenen Text eine fertige Datei — PDF (Vorgabe) oder Word (.docx, format "word") — als Merkblatt, Schreiben oder Zusammenfassung mit Briefkopf der Andreas Mayer Holding (bei eigenen privaten Kontakten auf dem eigenen Briefbogen bzw. mit dem Namen des Mitarbeiters), Datum und Seitenzahlen und legt sie als Dokument in der Kundenakte ab — oder mit objekt_id statt kunde_id in der Objektakte einer Immobilie (Ordner frei wählbar, Vorgabe „Exposé“ bei einem Exposé, sonst „Sonstiges“). Verwenden, wenn jemand ein Merkblatt, ein Schreiben oder eine Zusammenfassung "als Datei", "als PDF", "als Word-Datei", "zum Bearbeiten" oder "zum Ausdrucken/Mitgeben" möchte. Den Inhalt (z. B. aus Gesprächsprotokollen, Vertragsnotizen oder Dokumenten der Akte) schreibst du vorher selbst vollständig aus. Für eigene Unterlagen des Hauses ohne Kundenbezug kunde_id=k_intern_holding. Gehört das Dokument zu einer Immobilie (Exposé, Objektbeschreibung, Notiz zum Objekt), immer objekt_id nehmen, nie eine Sammelakte; ein fertiges Exposé mit Bildern, Eckdaten und Ansprechpartner macht aber expose_erstellen. Reine Listen und Tabellen zum Weiterrechnen oder Sortieren besser mit tabelle_erstellen (Excel). Danach kann die Datei mit datei_senden direkt in den Telegram-Chat geschickt werden.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Kundenakte, in der die Datei abgelegt wird (entweder kunde_id oder objekt_id).' },
        objekt_id: { type: 'string', description: 'Statt kunde_id: das Immobilien-Objekt, in dessen Objektakte die Datei abgelegt wird (ID aus objekte_suchen).' },
        ordner: { type: 'string', description: 'Nur mit objekt_id: Ordner der Objektakte, z. B. "Exposé", "Aktennotiz", "Protokolle", "Sonstiges". Ohne Angabe "Exposé", wenn der Titel ein Exposé ist, sonst "Sonstiges".' },
        titel: { type: 'string', description: 'Überschrift des Dokuments auf Deutsch, z. B. "Merkblatt Erbvertrag". Wird auch Dateiname.' },
        inhalt: {
          type: 'string',
          description:
            'Der vollständige Text in einfacher Auszeichnung: "## " für Zwischenüberschriften ("### " für kleinere), "- " für Aufzählungspunkte (zwei Leerzeichen davor für eine Ebene tiefer), "1. " für nummerierte Punkte, **fett**, *kursiv*, Leerzeile zwischen Absätzen, einzelner Zeilenumbruch bleibt erhalten (z. B. Anschrift, Grußformel), "---" für eine Trennlinie, einfache Tabellen mit "| a | b |" (erste Zeile = Kopfzeile). Den Titel nicht noch einmal als Überschrift wiederholen. Alles auf Deutsch.',
        },
        art: { type: 'string', enum: [...ARTEN], description: 'handout = Merkblatt (Vorgabe), brief = Schreiben, zusammenfassung = Zusammenfassung.' },
        format: { type: 'string', enum: ['pdf', 'word'], description: 'pdf (Vorgabe) oder word = bearbeitbare Word-Datei (.docx). Word nur, wenn der Mitarbeiter Word, .docx oder eine Datei zum Weiterbearbeiten möchte.' },
      },
      required: ['titel', 'inhalt'],
    },
  },
  {
    name: 'tabelle_erstellen',
    description:
      'Erstellt eine echte Excel-Datei (.xlsx) mit einem oder mehreren Blättern und legt sie als Dokument in der Kundenakte ab. Verwenden, wenn jemand "Excel", "eine Tabelle", "eine Liste als Datei", "zum Sortieren/Weiterrechnen" oder eine Aufstellung mit Spalten möchte — auch, wenn er ein Foto oder einen Scan einer Liste schickt und daraus eine Tabelle haben will: Dann schreibst du alle Zeilen vom Bild selbst vollständig ab (nichts weglassen, Unleserliches als "[unleserlich]"). Spalten so, wie der Mitarbeiter sie möchte (z. B. zwei Spalten). Zahlen (Beträge, Mengen, Flächen) als Zahl angeben, ohne Tausenderpunkt und mit Punkt als Dezimalzeichen (1234.5), dann rechnet Excel damit und zeigt "1.234,5"; Postleitzahlen, Telefon-, Kunden- und Aktennummern sowie Datumsangaben als Text. Für Unterlagen des Hauses ohne Kundenbezug kunde_id=k_intern_holding. Gehört die Tabelle zu einer Immobilie (z. B. Mieterliste), mit objekt_id statt kunde_id in die Objektakte (Ordner frei wählbar, Vorgabe „Sonstiges“). Danach kann die Datei (aus einer Kundenakte) mit datei_senden direkt in den Telegram-Chat geschickt werden.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Kundenakte, in der die Datei abgelegt wird (entweder kunde_id oder objekt_id).' },
        objekt_id: { type: 'string', description: 'Statt kunde_id: das Immobilien-Objekt, in dessen Objektakte die Tabelle abgelegt wird.' },
        ordner: { type: 'string', description: 'Nur mit objekt_id: Ordner der Objektakte, z. B. "Mieterliste", "Kostenaufstellung"; ohne Angabe "Sonstiges".' },
        titel: { type: 'string', description: 'Name der Tabelle auf Deutsch, z. B. "Mieterliste Schwabstraße". Wird Dateiname.' },
        blaetter: {
          type: 'array',
          description: 'Die Blätter der Arbeitsmappe, meist nur eines.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name des Blatts (höchstens 31 Zeichen), z. B. "Liste".' },
              spalten: { type: 'array', items: { type: 'string' }, description: 'Spaltenüberschriften (Kopfzeile), z. B. ["Name", "Telefon"].' },
              zeilen: {
                type: 'array',
                description: 'Die Datenzeilen, je Zeile ein Array in der Reihenfolge der Spalten. Leere Zelle = null.',
                items: { type: 'array', items: { type: ['string', 'number', 'null'] } },
              },
            },
            required: ['spalten', 'zeilen'],
          },
        },
      },
      required: ['titel', 'blaetter'],
    },
  },
  DATEI_SENDEN_WERKZEUG,
]

const NAMEN = new Set(DOKUMENT_WERKZEUGE.map((w) => w.name))

export function istDokumentWerkzeug(name: string): boolean {
  return NAMEN.has(name)
}

type AkteZeile = { id: string; bereich?: string | null; firma?: string | null; ansprechpartner?: string | null; verantwortlich_email?: string | null }

/** Akte laden und Rechte prüfen; Fehlertext oder die Akte. Private Akten eines Kollegen gibt es für den Mitarbeiter nicht. */
async function ladeAkte(k: DokumentKontext, kundeId: string): Promise<AkteZeile | string> {
  const darf = k.darfAkte ?? darfAkteStandard
  const { data: akte, error: ladeFehler } = await k.supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (ladeFehler) return `Fehler beim Laden der Akte: ${ladeFehler.message}`
  const keinKunde = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'
  if (!akte) return keinKunde
  if (!darf(k.mitarbeiter, akte)) return istFremdePrivatakte(k.mitarbeiter, akte) ? keinKunde : nichtFreigegeben(akte.bereich, k.mitarbeiter.name)
  return akte
}

/** Datei hochladen und in kunden.dokumente + activities eintragen. Fehlertext oder der neue Eintrag. */
async function legeInAkteAb(
  k: DokumentKontext,
  akte: AkteZeile,
  heute: string,
  datei: { bytes: Uint8Array; dateiName: string; typ: string; aktivitaet: (anzeigeName: string, groesse: string) => string },
): Promise<{ id: string; name: string; groesse: string } | string> {
  const { supabase, mitarbeiter } = k
  const kennung = `dok_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  const pfad = `${akte.id}/${kennung}_${sicheresPfadsegment(datei.dateiName)}`
  const { error: hochFehler } = await supabase.storage.from(BUCKET).upload(pfad, datei.bytes, { contentType: datei.typ, upsert: false })
  if (hochFehler) return `Fehler beim Speichern der Datei: ${hochFehler.message}. Nichts wurde abgelegt.`

  // Erst jetzt frisch lesen und gleich schreiben: Das Erstellen dauert, in der Zwischenzeit kann
  // jemand anderes Dokumente oder Einträge hinzugefügt haben.
  const { data: frisch, error: frischFehler } = await supabase.from('kunden').select('dokumente, activities').eq('id', akte.id).maybeSingle()
  if (frischFehler || !frisch) {
    await supabase.storage.from(BUCKET).remove([pfad]).catch(() => {})
    return `Fehler beim Speichern in der Akte: ${frischFehler?.message ?? 'Akte nicht mehr vorhanden'}. Nichts wurde abgelegt.`
  }
  const dokumente: { id: string; name: string }[] = Array.isArray(frisch.dokumente) ? frisch.dokumente : []
  const anzeigeName = freierName(datei.dateiName, dokumente.map((d) => d.name))
  const groesse = formatGroesse(datei.bytes.length)
  const neu = { id: kennung, name: anzeigeName, typ: datei.typ, datum: heute, groesse, url: pfad, quelle: 'assistent' }
  const eintrag = { id: crypto.randomUUID(), date: heute, text: datei.aktivitaet(anzeigeName, groesse), user: mitarbeiter.name }
  const { error: schreibFehler } = await supabase
    .from('kunden')
    .update({ dokumente: [neu, ...dokumente], activities: [eintrag, ...(Array.isArray(frisch.activities) ? frisch.activities : [])], letzte_aktivitaet: heute })
    .eq('id', akte.id)
  if (schreibFehler) {
    await supabase.storage.from(BUCKET).remove([pfad]).catch(() => {})
    return `Fehler beim Speichern in der Akte: ${schreibFehler.message}. Nichts wurde abgelegt.`
  }
  return { id: kennung, name: anzeigeName, groesse }
}

// deno-lint-ignore no-explicit-any
export async function fuehreDokumentWerkzeugAus(name: string, input: any, k: DokumentKontext): Promise<string> {
  if (name === 'tabelle_erstellen') return await tabelleErstellen(input, k)
  if (name === 'datei_senden') return await fuehreDateiSendenAus(input, k)
  if (name !== 'dokument_erstellen') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere } = k
  const heute = k.heute ?? heuteBerlin()

  const titel = String(input?.titel ?? '').replace(/\s+/g, ' ').trim()
  const inhalt = String(input?.inhalt ?? '').replace(/\r\n?/g, '\n').trim()
  const art: Art = ARTEN.includes(input?.art) ? input.art : 'handout'
  const word = /^(word|docx|\.docx)$/i.test(String(input?.format ?? '').trim())
  if (!String(input?.kunde_id ?? '').trim() && !String(input?.objekt_id ?? '').trim()) return 'Fehler: kunde_id oder objekt_id fehlt. Ermittle die Akte mit kunden_suchen bzw. das Objekt mit objekte_suchen.'
  if (!titel) return 'Fehler: titel fehlt.'
  if (!inhalt) return 'Fehler: inhalt ist leer. Schreib den vollständigen Text des Dokuments in inhalt.'
  if (inhalt.length > MAX_ZEICHEN) return `Fehler: inhalt ist zu lang (${inhalt.length} Zeichen, höchstens ${MAX_ZEICHEN}). Kürze den Text oder teile ihn auf mehrere Dokumente auf.`

  const ziel = await ladeZiel(k, input, /expos/i.test(titel) ? 'Exposé' : 'Sonstiges')
  if (typeof ziel === 'string') return ziel

  // Eigene private Akte bzw. eigenes privates Objekt: nie mit Mayer-Briefkopf. PDF auf dem eigenen
  // Briefbogen (Bereich Privat → Einstellungen), Word mit dem Namen des Mitarbeiters im Kopf.
  let eigener: EigenerKopf | undefined
  if (ziel.privatBesitzer !== undefined) {
    eigener = { name: mitarbeiter.name }
    if (!word) {
      const briefbogen = await ladeEigenenBriefbogen(supabase, ziel.privatBesitzer)
      if (briefbogen) eigener.briefbogen = briefbogen
    }
  }

  let datei: { bytes: Uint8Array; seiten?: number }
  try {
    datei = word
      ? {
          bytes: erstelleDocx({
            titel,
            inhalt,
            artName: ART_NAME[art],
            fuer: ziel.fuer,
            stand: langesDatum(heute),
            kopf: eigener ? { name: eigener.name } : { name: FIRMA, zeile: FIRMA_ZEILE },
            urheber: eigener ? eigener.name : FIRMA,
          }),
        }
      : await erstellePdf({ titel, inhalt, art, fuer: ziel.fuer, datum: heute, eigener })
  } catch (e) {
    return `Fehler beim Erstellen der ${word ? 'Word-Datei' : 'PDF'}: ${e instanceof Error ? e.message : String(e)}`
  }

  const formatName = word ? 'Word-Datei' : 'PDF'
  const seitenText = datei.seiten ? ` (${datei.seiten} ${datei.seiten === 1 ? 'Seite' : 'Seiten'})` : ''
  const abgelegt = await legeAb(k, ziel, heute, {
    bytes: datei.bytes,
    dateiName: `${ohneEndung(titel)} (${deDatum(heute)}).${word ? 'docx' : 'pdf'}`,
    typ: word ? DOCX_TYP : 'application/pdf',
    aktivitaet: (n) => `${ART_NAME[art]} als ${formatName} „${n}"${seitenText} vom Assistenten für ${mitarbeiter.name} erstellt und ${ziel.art === 'objekt' ? `im Ordner ${ziel.ordner}` : 'unter Dokumente'} abgelegt.`,
  })
  if (typeof abgelegt === 'string') return abgelegt
  protokolliere(`${ART_NAME[art]} „${abgelegt.name}" (${formatName}) erstellt und ${ziel.art === 'objekt' ? `in der Objektakte ${ziel.name} (Ordner ${ziel.ordner})` : `bei ${ziel.name}`} abgelegt`)
  const umfang = datei.seiten ? `PDF, ${datei.seiten} ${datei.seiten === 1 ? 'Seite' : 'Seiten'}` : 'Word'
  if (ziel.art === 'objekt') {
    return `Erstellt und abgelegt: „${abgelegt.name}" (${umfang}, ${abgelegt.groesse}) in der Objektakte ${ziel.name} im Ordner ${ziel.ordner}. Im CRM öffnet man es dort unter Unterlagen mit einem Klick. objekt_id=${ziel.objekt.id}, dokument_id=${abgelegt.id}`
  }
  return `Erstellt und abgelegt: „${abgelegt.name}" (${umfang}, ${abgelegt.groesse}) in der Akte von ${ziel.name} unter Dokumente. Im CRM öffnet man es dort mit einem Klick. ${SENDEN_HINWEIS} (kunde_id=${ziel.akte.id}, dokument_id=${abgelegt.id}) direkt in den Chat. dokument_id=${abgelegt.id}`
}

// deno-lint-ignore no-explicit-any
async function tabelleErstellen(input: any, k: DokumentKontext): Promise<string> {
  const { mitarbeiter, protokolliere } = k
  const heute = k.heute ?? heuteBerlin()
  const titel = String(input?.titel ?? '').replace(/\s+/g, ' ').trim()
  // Manche Aufrufe schicken ein einzelnes Blatt statt einer Liste.
  const blaetter: BlattEingabe[] = Array.isArray(input?.blaetter) ? input.blaetter : input?.blaetter && typeof input.blaetter === 'object' ? [input.blaetter] : []
  if (!String(input?.kunde_id ?? '').trim() && !String(input?.objekt_id ?? '').trim()) return 'Fehler: kunde_id oder objekt_id fehlt. Ermittle die Akte mit kunden_suchen bzw. das Objekt mit objekte_suchen.'
  if (!titel) return 'Fehler: titel fehlt.'
  if (blaetter.length === 0 || blaetter.every((b) => !Array.isArray(b?.zeilen) || b.zeilen.length === 0)) {
    return 'Fehler: Die Tabelle ist leer. Gib in blaetter mindestens ein Blatt mit spalten und zeilen an (bei einem Foto alle Zeilen selbst abschreiben).'
  }

  const ziel = await ladeZiel(k, input, 'Sonstiges')
  if (typeof ziel === 'string') return ziel

  let mappe: ReturnType<typeof erstelleXlsx>
  try {
    mappe = erstelleXlsx({ titel, urheber: ziel.privatBesitzer !== undefined ? mitarbeiter.name : FIRMA, blaetter })
  } catch (e) {
    return `Fehler beim Erstellen der Excel-Datei: ${e instanceof Error ? e.message : String(e)}`
  }
  const zeilen = mappe.blaetter.reduce((s, b) => s + b.zeilen, 0)
  const umfang = mappe.blaetter.length === 1
    ? `${zeilen} ${zeilen === 1 ? 'Zeile' : 'Zeilen'}, ${mappe.blaetter[0].spalten} ${mappe.blaetter[0].spalten === 1 ? 'Spalte' : 'Spalten'}`
    : `${mappe.blaetter.length} Blätter, ${zeilen} Zeilen`

  const abgelegt = await legeAb(k, ziel, heute, {
    bytes: mappe.bytes,
    dateiName: `${ohneEndung(titel)} (${deDatum(heute)}).xlsx`,
    typ: XLSX_TYP,
    aktivitaet: (n) => `Excel-Tabelle „${n}" (${umfang}) vom Assistenten für ${mitarbeiter.name} erstellt und ${ziel.art === 'objekt' ? `im Ordner ${ziel.ordner}` : 'unter Dokumente'} abgelegt.`,
  })
  if (typeof abgelegt === 'string') return abgelegt
  protokolliere(`Excel-Tabelle „${abgelegt.name}" erstellt und ${ziel.art === 'objekt' ? `in der Objektakte ${ziel.name} (Ordner ${ziel.ordner})` : `bei ${ziel.name}`} abgelegt`)
  const blattNamen = mappe.blaetter.map((b) => `„${b.name}"`).join(', ')
  if (ziel.art === 'objekt') {
    return `Erstellt und abgelegt: „${abgelegt.name}" (Excel, ${umfang}, Blatt ${blattNamen}, ${abgelegt.groesse}) in der Objektakte ${ziel.name} im Ordner ${ziel.ordner}. objekt_id=${ziel.objekt.id}, dokument_id=${abgelegt.id}`
  }
  return `Erstellt und abgelegt: „${abgelegt.name}" (Excel, ${umfang}, Blatt ${blattNamen}, ${abgelegt.groesse}) in der Akte von ${ziel.name} unter Dokumente. ${SENDEN_HINWEIS} (kunde_id=${ziel.akte.id}, dokument_id=${abgelegt.id}) direkt in den Chat. dokument_id=${abgelegt.id}`
}

// ---------- Ziel der Ablage: Kundenakte oder Objektakte ----------

type Ziel =
  | { art: 'akte'; akte: AkteZeile; name: string; fuer?: string; privatBesitzer?: string }
  | { art: 'objekt'; objekt: ObjektZeile; ordner: string; name: string; fuer?: string; privatBesitzer?: string }

/** Kundenakte (kunde_id) oder Objektakte (objekt_id, hat Vorrang) laden und Rechte prüfen. privatBesitzer gesetzt = eigene private Ablage. */
// deno-lint-ignore no-explicit-any
async function ladeZiel(k: DokumentKontext, input: any, standardOrdner: string): Promise<Ziel | string> {
  const objektId = String(input?.objekt_id ?? '').trim()
  if (objektId) {
    const ordner = ordnerAusEingabe(input?.ordner, standardOrdner)
    if ('fehler' in ordner) return ordner.fehler
    const o = await ladeObjektMitRechten(k, objektId, 'id, bezeichnung, adresse, privat_besitzer')
    if (typeof o === 'string') return o
    const besitzer = String(o.privat_besitzer ?? '').trim().toLowerCase()
    return { art: 'objekt', objekt: o, ordner: ordner.ordner, name: objektAnzeige(o), fuer: String(o.bezeichnung ?? '').trim() || undefined, privatBesitzer: besitzer || undefined }
  }
  const akte = await ladeAkte(k, String(input?.kunde_id ?? '').trim())
  if (typeof akte === 'string') return akte
  const name = kundeName(akte)
  return {
    art: 'akte',
    akte,
    name,
    fuer: SAMMELAKTEN.includes(akte.id) ? undefined : name,
    privatBesitzer: istPrivat(akte) ? String(akte.verantwortlich_email ?? '').trim().toLowerCase() : undefined,
  }
}

async function legeAb(
  k: DokumentKontext,
  ziel: Ziel,
  heute: string,
  datei: { bytes: Uint8Array; dateiName: string; typ: string; aktivitaet: (anzeigeName: string, groesse: string) => string },
): Promise<{ id: string; name: string; groesse: string } | string> {
  if (ziel.art === 'akte') return await legeInAkteAb(k, ziel.akte, heute, datei)
  return await legeInsObjektAb(k, ziel.objekt, heute, { ...datei, ordner: ziel.ordner })
}

/** Erster eigener Briefbogen (Bereich Privat) des Besitzers; ohne oder bei Fehlern undefined → schlichter Kopf. */
// deno-lint-ignore no-explicit-any
export async function ladeEigenenBriefbogen(supabase: any, besitzerEmail: string): Promise<EigenerKopf['briefbogen'] | undefined> {
  try {
    const besitzer = String(besitzerEmail ?? '').trim().toLowerCase()
    if (!besitzer) return undefined
    const { data: boegen } = await supabase.from('briefboegen').select('name, pdf_pfad, einstellungen').eq('besitzer_email', besitzer).not('pdf_pfad', 'is', null).order('name')
    const bogen = (boegen ?? [])[0]
    if (!bogen?.pdf_pfad) return undefined
    const { data: datei } = await supabase.storage.from('briefboegen').download(bogen.pdf_pfad)
    return datei ? { pdf: new Uint8Array(await datei.arrayBuffer()), raender: bogen.einstellungen?.raender } : undefined
  } catch (e) {
    console.error('Briefbogen für privates Dokument nicht ladbar — schlichter Kopf', e instanceof Error ? e.message : e)
    return undefined
  }
}


// ---------- Hilfen ----------

export function heuteBerlin(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
}

export function deDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export function langesDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[3])}. ${MONATE[Number(m[2]) - 1]} ${m[1]}` : iso
}

function kundeName(k: { firma?: string | null; ansprechpartner?: string | null }): string {
  const firma = String(k.firma ?? '').trim()
  const ap = String(k.ansprechpartner ?? '').trim()
  return ap && ap !== firma ? `${firma} (${ap})` : firma || ap
}

function formatGroesse(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ohneEndung(s: string): string {
  return s.replace(/\.(pdf|docx?|xlsx?|csv)$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim()
}

// Storage-Schlüssel nur aus einfachen Zeichen; Umlaute werden ausgeschrieben.
function sicheresPfadsegment(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120)
}

function freierName(name: string, vorhanden: string[]): string {
  const belegt = new Set(vorhanden.map((n) => String(n).toLowerCase()))
  if (!belegt.has(name.toLowerCase())) return name
  for (let i = 2; i < 100; i++) {
    const kandidat = /\.[a-z0-9]{2,5}$/i.test(name) ? name.replace(/(\.[a-z0-9]{2,5})$/i, ` (${i})$1`) : `${name} (${i})`
    if (!belegt.has(kandidat.toLowerCase())) return kandidat
  }
  return name
}

// ---------- PDF ----------

const A4 = { breite: 595.28, hoehe: 841.89 }
const RAND = { links: 64, rechts: 64, oben: 56, unten: 64 }
const TEXT_FARBE = rgb(0.13, 0.13, 0.13)
const GRAU = rgb(0.42, 0.42, 0.42)
const LINIE = rgb(0.78, 0.78, 0.78)
const AKZENT = rgb(0.13, 0.27, 0.42)
const TABELLEN_KOPF = rgb(0.95, 0.95, 0.95)

const GROESSE = 10.5
const ZEILE = 15

export type Schriften = { normal: PDFFont; fett: PDFFont; kursiv: PDFFont; fettKursiv: PDFFont; symbol: PDFFont }

// Haken, Kreuze und ein paar Zeichen, die Helvetica nicht hat, kommen aus der Symbolschrift
// ZapfDingbats (ebenfalls eine Standardschrift, nichts wird eingebettet).
const SYMBOLE = new Set(['✓', '✔', '✗', '✘', '★', '☎', '✉', '➔'])

function symbolTeile(text: string, font: PDFFont, f: Schriften): Teil[] {
  const aus: Teil[] = []
  for (const z of text) {
    const fz = SYMBOLE.has(z) ? f.symbol : font
    const letzter = aus[aus.length - 1]
    if (letzter && letzter.font === fz) letzter.text += z
    else aus.push({ text: z, font: fz })
  }
  return aus
}
export type Teil = { text: string; font: PDFFont }
type Wort = { teile: Teil[]; leerDavor: boolean }
export type Zeile = { teile: Teil[]; breite: number }

// Was die Standardschrift (WinAnsi) nicht kennt, wird ersetzt statt die Erstellung abzubrechen.
const ERSATZ: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '', '\t': '    ',
  '‐': '-', '‑': '-', '‒': '-', '−': '-', '―': '—',
  '′': "'", '″': '"', '‟': '"', '‛': "'",
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '➔': '->', '➜': '->', '▶': '>', '►': '>',
  '≥': '>=', '≤': '<=', '≈': '~', '≠': 'ungleich', '∞': 'unbegrenzt', '√': 'Wurzel',
  '☑': '✔', '☒': '✘', '☐': '-', '◦': '·', '▪': '•', '■': '•', '●': '•', '○': '·', '◆': '•',
  '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
}

export function zeichenFilter(font: PDFFont): (s: string) => string {
  const erlaubt = new Set(font.getCharacterSet())
  return (s: string) => {
    let aus = ''
    for (const z of s) {
      const cp = z.codePointAt(0)!
      if (cp === 10 || erlaubt.has(cp) || SYMBOLE.has(z)) {
        aus += z
        continue
      }
      if (z in ERSATZ) {
        aus += ERSATZ[z]
        continue
      }
      // Akzente abwerfen (é → e), wenn der Grundbuchstabe darstellbar ist; sonst weglassen
      // (Sinnbilder wie Emojis) bzw. "?" für unbekannte Buchstaben.
      const basis = z.normalize('NFD').replace(/[̀-ͯ]/g, '')
      if (basis && [...basis].every((b) => erlaubt.has(b.codePointAt(0)!))) aus += basis
      else if (/\p{L}|\p{N}/u.test(z)) aus += '?'
    }
    return aus
  }
}

function schriftFuer(l: { fett: boolean; kursiv: boolean }, f: Schriften): PDFFont {
  return l.fett ? (l.kursiv ? f.fettKursiv : f.fett) : l.kursiv ? f.kursiv : f.normal
}

export function umbrechen(text: Lauf[], f: Schriften, groesse: number, maxBreite: number): Zeile[] {
  const woerter: Wort[] = []
  let leer = false
  for (const l of text) {
    const font = schriftFuer(l, f)
    for (const m of l.text.matchAll(/(\s+)|(\S+)/g)) {
      if (m[1]) {
        leer = true
        continue
      }
      const teile = symbolTeile(m[2], font, f)
      if (leer || woerter.length === 0) woerter.push({ teile, leerDavor: leer && woerter.length > 0 })
      else woerter[woerter.length - 1].teile.push(...teile)
      leer = false
    }
  }
  const zeilen: Zeile[] = []
  let akt: Zeile = { teile: [], breite: 0 }
  const breiteVon = (t: Teil) => textBreite(t.font, t.text, groesse)
  for (const w of woerter) {
    const wb = w.teile.reduce((s, t) => s + breiteVon(t), 0)
    const leerTeil: Teil = { text: ' ', font: w.teile[0].font === f.symbol ? f.normal : w.teile[0].font }
    const lb = akt.teile.length > 0 && w.leerDavor ? breiteVon(leerTeil) : 0
    if (akt.breite + lb + wb <= maxBreite) {
      if (lb) akt.teile.push(leerTeil)
      akt.teile.push(...w.teile)
      akt.breite += lb + wb
      continue
    }
    if (akt.teile.length > 0) zeilen.push(akt)
    akt = { teile: [], breite: 0 }
    if (wb <= maxBreite) {
      akt.teile.push(...w.teile)
      akt.breite = wb
      continue
    }
    // Überlanges Wort (z. B. lange Adresse): zeichenweise trennen.
    for (const t of w.teile) {
      for (const z of t.text) {
        const zb = textBreite(t.font, z, groesse)
        if (akt.breite + zb > maxBreite && akt.teile.length > 0) {
          zeilen.push(akt)
          akt = { teile: [], breite: 0 }
        }
        const letzter = akt.teile[akt.teile.length - 1]
        if (letzter && letzter.font === t.font) letzter.text += z
        else akt.teile.push({ text: z, font: t.font })
        akt.breite += zb
      }
    }
  }
  if (akt.teile.length > 0) zeilen.push(akt)
  return zeilen
}

/** Eigener Briefbogen (Bereich Privat): Seite 1/2 als Hintergrund, Ränder in Punkt. */
export type BriefbogenHintergrund = { erste: PDFEmbeddedPage; folge: PDFEmbeddedPage; ersteOben: number; folgeOben: number }

// Das €-Zeichen: Helvetica ist nicht eingebettet. pdf-lib (und Acrobat/Chrome) rechnen mit 556/1000
// Geviert, die macOS-/iOS-Vorschau zeichnet aber die System-Helvetica, deren € 744/1000 breit ist — das €
// ragte dort in das nächste Zeichen („€Anzahlung“, ein Doppelpunkt nach € verschwand; Prüfung vom
// 20.11.2026). Deshalb wird jedes € als eigenes Stück gesetzt und mit der größeren Breite weitergerückt;
// in Acrobat/Chrome steht danach nur eine kleine Lücke von gut 2 pt.
const EURO_BREITE = 0.744

/** Breite eines Texts mit der größeren €-Breite (für Umbruch und Positionen). */
export function textBreite(font: PDFFont, text: string, groesse: number): number {
  const anzahl = text.split('€').length - 1
  if (!anzahl) return font.widthOfTextAtSize(text, groesse)
  return font.widthOfTextAtSize(text.replaceAll('€', ''), groesse) + anzahl * EURO_BREITE * groesse
}

/** Zeichnet Text ab x, jedes € als eigenes Stück (siehe oben); liefert das x danach. */
export function zeichneText(seite: PDFPage, text: string, x: number, y: number, groesse: number, font: PDFFont, farbe: ReturnType<typeof rgb>): number {
  let cx = x
  for (const stueck of text.split(/(€)/)) {
    if (!stueck) continue
    seite.drawText(stueck, { x: cx, y, size: groesse, font, color: farbe })
    cx += stueck === '€' ? EURO_BREITE * groesse : font.widthOfTextAtSize(stueck, groesse)
  }
  return cx
}

class Setzer {
  seite!: PDFPage
  y = 0
  /** Oberkante des Textes auf der aktuellen Seite (für „am Seitenanfang“). */
  startY = 0
  seiten: PDFPage[] = []
  rand = { ...RAND }
  constructor(
    private doc: PDFDocument,
    private f: Schriften,
    private kopf: { name: string; zeile: string } = { name: FIRMA, zeile: FIRMA_ZEILE },
    private hintergrund?: BriefbogenHintergrund,
  ) {}

  get breite() {
    return A4.breite - this.rand.links - this.rand.rechts
  }

  neueSeite() {
    this.seite = this.doc.addPage([A4.breite, A4.hoehe])
    this.seiten.push(this.seite)
    if (this.hintergrund) {
      // Eigener Briefbogen: Kopf und Fuß stehen im Hintergrund, der Text beginnt unter dem Kopf.
      const bg = this.seiten.length === 1 ? this.hintergrund.erste : this.hintergrund.folge
      this.seite.drawPage(bg, { x: 0, y: 0, width: A4.breite, height: A4.hoehe })
      this.y = A4.hoehe - (this.seiten.length === 1 ? this.hintergrund.ersteOben : this.hintergrund.folgeOben)
      this.startY = this.y
      return
    }
    const top = A4.hoehe - this.rand.oben
    this.seite.drawText(this.kopf.name, { x: this.rand.links, y: top - 11, size: 11.5, font: this.f.fett, color: AKZENT })
    if (this.kopf.zeile) this.seite.drawText(this.kopf.zeile, { x: this.rand.links, y: top - 24, size: 7.8, font: this.f.normal, color: GRAU })
    this.seite.drawLine({ start: { x: this.rand.links, y: top - 32 }, end: { x: A4.breite - this.rand.rechts, y: top - 32 }, thickness: 0.6, color: LINIE })
    this.y = top - 32 - 26
    this.startY = this.y
  }

  /** Sorgt für Platz; sonst neue Seite. */
  platz(hoehe: number) {
    if (this.y - hoehe < this.rand.unten + 14) this.neueSeite()
  }

  zeile(z: Zeile, x: number, groesse: number, farbe = TEXT_FARBE) {
    // Gleiche Schrift in einem Stück zeichnen: Dann setzt der Betrachter Wortabstände und Zeichen
    // selbst, auch wenn seine Ersatzschrift minimal andere Breiten hat.
    const stuecke: Teil[] = []
    for (const t of z.teile) {
      const letzter = stuecke[stuecke.length - 1]
      if (letzter && letzter.font === t.font) letzter.text += t.text
      else stuecke.push({ ...t })
    }
    let cx = x
    for (const t of stuecke) {
      cx = zeichneText(this.seite, t.text, cx, this.y, groesse, t.font, farbe)
    }
  }

  /** Setzt umbrochenen Text ab der aktuellen Höhe; y ist danach unter der letzten Zeile. */
  text(text: Lauf[], x: number, maxBreite: number, groesse = GROESSE, abstand = ZEILE, farbe = TEXT_FARBE) {
    for (const z of umbrechen(text, this.f, groesse, maxBreite)) {
      this.platz(abstand)
      this.y -= abstand - (abstand - groesse) / 2
      this.zeile(z, x, groesse, farbe)
      this.y -= (abstand - groesse) / 2
    }
  }
}

export type EigenerKopf = {
  /** Briefbogen-PDF (leere Seite; Seite 2 = Folgeseite, falls vorhanden) und Ränder in mm aus den Briefbogen-Einstellungen. */
  briefbogen?: { pdf: Uint8Array; raender?: { links?: number; rechts?: number; unten?: number; anschriftOben?: number; folgeseiteOben?: number } }
  /** Name im Kopf, wenn kein Briefbogen da ist (nie die Mayer Holding für Private). */
  name: string
}

export async function erstellePdf(a: { titel: string; inhalt: string; art?: Art; fuer?: string; datum: string; eigener?: EigenerKopf }): Promise<{ bytes: Uint8Array; seiten: number }> {
  const doc = await PDFDocument.create()
  const f: Schriften = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    fett: await doc.embedFont(StandardFonts.HelveticaBold),
    kursiv: await doc.embedFont(StandardFonts.HelveticaOblique),
    fettKursiv: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    symbol: await doc.embedFont(StandardFonts.ZapfDingbats),
  }
  const sauber = zeichenFilter(f.normal)
  const titel = sauber(a.titel)
  const art = a.art ?? 'handout'
  const urheber = a.eigener ? sauber(a.eigener.name) : FIRMA
  doc.setTitle(titel)
  doc.setAuthor(urheber)
  doc.setCreator(`${urheber} – CRM`)
  doc.setProducer(`${urheber} – CRM`)
  doc.setLanguage('de-DE')

  // Eigener Briefbogen (privater Bereich): Seiten des Briefbogens als Hintergrund, Ränder aus seinen Einstellungen.
  let hintergrund: BriefbogenHintergrund | undefined
  const MM = 72 / 25.4
  const r = a.eigener?.briefbogen?.raender ?? {}
  if (a.eigener?.briefbogen) {
    const quelle = await PDFDocument.load(a.eigener.briefbogen.pdf)
    const anzahl = quelle.getPageCount()
    const [erste, folge] = await doc.embedPdf(a.eigener.briefbogen.pdf, anzahl > 1 ? [0, 1] : [0, 0])
    hintergrund = { erste, folge, ersteOben: (r.anschriftOben ?? 50.7) * MM, folgeOben: (r.folgeseiteOben ?? 30) * MM }
  }
  const s = new Setzer(doc, f, a.eigener ? { name: urheber, zeile: '' } : undefined, hintergrund)
  if (hintergrund) s.rand = { links: (r.links ?? 25) * MM, rechts: (r.rechts ?? 20) * MM, oben: RAND.oben, unten: (r.unten ?? 25) * MM }
  s.neueSeite()

  // Kopf der ersten Seite: Art, Titel, für wen und Stand.
  s.y -= 2
  s.seite.drawText(ART_NAME[art].toUpperCase().split('').join(' '), { x: s.rand.links, y: s.y - 8, size: 8, font: f.fett, color: GRAU })
  s.y -= 16
  s.text([{ text: titel, fett: true, kursiv: false }], s.rand.links, s.breite, 19, 24, AKZENT)
  s.y -= 4
  const meta = [a.fuer ? `Für: ${sauber(a.fuer)}` : '', `Stand: ${langesDatum(a.datum)}`].filter(Boolean).join('   ·   ')
  s.text([{ text: meta, fett: false, kursiv: false }], s.rand.links, s.breite, 9.5, 13, GRAU)
  s.y -= 18

  // Wiederholt der Text den Titel als erste Überschrift, fällt sie weg.
  const bloecke = ohneTitelUeberschrift(zerlege(sauber(a.inhalt)), titel)

  const ABSATZ = 7
  for (let i = 0; i < bloecke.length; i++) {
    const b = bloecke[i]
    const naechster = bloecke[i + 1]
    if (b.art === 'leer') continue
    if (b.art === 'ueberschrift') {
      const groesse = b.ebene === 1 ? 15 : b.ebene === 2 ? 13 : 11.5
      const vorher = b.ebene === 1 ? 16 : b.ebene === 2 ? 12 : 9
      // Überschrift nie allein am Seitenende.
      s.platz(vorher + groesse + 6 + 2 * ZEILE)
      if (s.y < s.startY - 22) s.y -= vorher
      s.text(laeufe(b.text, { fett: true, kursiv: false }), s.rand.links, s.breite, groesse, groesse + 5, b.ebene === 3 ? TEXT_FARBE : AKZENT)
      s.y -= b.ebene === 1 ? 6 : 4
      continue
    }
    if (b.art === 'linie') {
      s.platz(16)
      // Am Seitenanfang trennt eine Linie nichts mehr.
      if (s.y >= s.startY - 0.5) continue
      s.y -= 8
      s.seite.drawLine({ start: { x: s.rand.links, y: s.y }, end: { x: A4.breite - s.rand.rechts, y: s.y }, thickness: 0.6, color: LINIE })
      s.y -= 10
      continue
    }
    if (b.art === 'absatz') {
      for (const z of b.zeilen) s.text(laeufe(z), s.rand.links, s.breite)
      s.y -= ABSATZ
      continue
    }
    if (b.art === 'zitat') {
      const start = s.y
      const seiteVorher = s.seite
      for (const z of b.zeilen) s.text(laeufe(z, { fett: false, kursiv: true }), s.rand.links + 14, s.breite - 14, GROESSE, ZEILE, GRAU)
      if (s.seite === seiteVorher) s.seite.drawLine({ start: { x: s.rand.links + 3, y: start - 2 }, end: { x: s.rand.links + 3, y: s.y + 2 }, thickness: 2, color: LINIE })
      s.y -= ABSATZ
      continue
    }
    if (b.art === 'punkt') {
      const einzug = s.rand.links + 4 + b.ebene * 16
      const markeText = b.marke ?? (b.ebene === 0 ? '•' : b.ebene === 1 ? '–' : '·')
      const markeFont = b.marke ? f.normal : f.fett
      const textX = einzug + (b.marke ? Math.max(16, markeFont.widthOfTextAtSize(markeText, GROESSE) + 6) : 12)
      s.platz(ZEILE)
      const markeY = s.y - (ZEILE - (ZEILE - GROESSE) / 2)
      const seiteVorher = s.seite
      for (const z of b.zeilen) s.text(laeufe(z), textX, A4.breite - s.rand.rechts - textX)
      // Die Marke steht neben der ersten Zeile; platz() oben stellt sicher, dass die auf dieser Seite liegt.
      seiteVorher.drawText(markeText, { x: einzug, y: markeText === '•' ? markeY - 1.2 : markeY, size: markeText === '•' ? GROESSE * 1.3 : GROESSE, font: markeFont, color: b.marke ? TEXT_FARBE : AKZENT })
      s.y -= naechster && naechster.art === 'punkt' ? 3 : ABSATZ
      continue
    }
    if (b.art === 'tabelle') {
      tabelle(s, f, b.zeilen)
      s.y -= ABSATZ + 2
    }
  }

  // Fußzeile mit Seitenzahlen, wenn die Gesamtzahl feststeht.
  const gesamt = s.seiten.length
  const ohneSymbole = [...titel].filter((z) => !SYMBOLE.has(z)).join('').trim()
  const fussTitel = ohneSymbole.length > 70 ? `${ohneSymbole.slice(0, 68)}…` : ohneSymbole
  s.seiten.forEach((p, i) => {
    if (hintergrund) {
      // Auf dem eigenen Briefbogen nur die Seitenzahl — Fußzeile und Linie hat der Briefbogen selbst.
      if (gesamt > 1) {
        const nr = `Seite ${i + 1} von ${gesamt}`
        p.drawText(nr, { x: A4.breite - s.rand.rechts - f.normal.widthOfTextAtSize(nr, 8), y: s.rand.unten + 2, size: 8, font: f.normal, color: GRAU })
      }
      return
    }
    const y = s.rand.unten - 28
    p.drawLine({ start: { x: s.rand.links, y: y + 14 }, end: { x: A4.breite - s.rand.rechts, y: y + 14 }, thickness: 0.5, color: LINIE })
    zeichneText(p, fussTitel, s.rand.links, y, 8, f.normal, GRAU)
    const nr = `Seite ${i + 1} von ${gesamt}`
    p.drawText(nr, { x: A4.breite - s.rand.rechts - f.normal.widthOfTextAtSize(nr, 8), y, size: 8, font: f.normal, color: GRAU })
  })

  return { bytes: await doc.save(), seiten: gesamt }
}

function tabelle(s: Setzer, f: Schriften, zeilen: string[][]) {
  const spalten = Math.max(...zeilen.map((z) => z.length))
  const pad = 5
  const groesse = 9.5
  const abstand = 13
  // Spaltenbreiten nach dem längsten Inhalt, jede mindestens 12 % der Breite.
  const natuerlich = Array.from({ length: spalten }, (_, c) =>
    Math.max(30, ...zeilen.map((z, r) => (umbrechen(laeufe(z[c] ?? '', { fett: r === 0, kursiv: false }), f, groesse, 1e6)[0]?.breite ?? 0) + 2 * pad)),
  )
  const summe = natuerlich.reduce((a, b) => a + b, 0)
  let breiten = summe <= s.breite ? natuerlich.map((w) => w * (s.breite / summe)) : natuerlich.map((w) => Math.max(s.breite * 0.12, (w / summe) * s.breite))
  const skal = s.breite / breiten.reduce((a, b) => a + b, 0)
  breiten = breiten.map((w) => w * skal)

  zeilen.forEach((z, r) => {
    const kopf = r === 0 && zeilen.length > 1
    const zellen = Array.from({ length: spalten }, (_, c) => umbrechen(laeufe(z[c] ?? '', { fett: kopf, kursiv: false }), f, groesse, breiten[c] - 2 * pad))
    const hoehe = Math.max(1, ...zellen.map((x) => x.length)) * abstand + 2 * pad - 2
    s.platz(hoehe)
    const oben = s.y
    if (kopf) s.seite.drawRectangle({ x: s.rand.links, y: oben - hoehe, width: s.breite, height: hoehe, color: TABELLEN_KOPF })
    let x = s.rand.links
    zellen.forEach((zellZeilen, c) => {
      s.y = oben - pad + 1
      for (const zz of zellZeilen) {
        s.y -= abstand - (abstand - groesse) / 2
        s.zeile(zz, x + pad, groesse)
        s.y -= (abstand - groesse) / 2
      }
      x += breiten[c]
    })
    s.seite.drawRectangle({ x: s.rand.links, y: oben - hoehe, width: s.breite, height: hoehe, borderColor: LINIE, borderWidth: 0.5 })
    let lx = s.rand.links
    for (let c = 0; c < spalten - 1; c++) {
      lx += breiten[c]
      s.seite.drawLine({ start: { x: lx, y: oben }, end: { x: lx, y: oben - hoehe }, thickness: 0.5, color: LINIE })
    }
    s.y = oben - hoehe
  })
}
