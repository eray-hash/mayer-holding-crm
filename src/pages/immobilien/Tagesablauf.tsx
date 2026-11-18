import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useApp, type AppData } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { ladeTermine, type Termin } from '../../lib/kalenderDb'
import { Card, EmptyState, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { CURRENT_USER, MITARBEITER } from '../../data/constants'
import { addDays, fmtDate, fmtDateTime, today, uid } from '../../lib/dates'
import type { Tagesplan, TagesplanBlock, TagesplanZeile, Wochenplan } from '../../types'

// Die Blöcke der Vorlage „Tagesablauf klar definieren", in der Reihenfolge des Blatts.
// leer = so viele Zeilen stehen mindestens da, auch wenn noch nichts eingetragen ist.
const BLOECKE: { id: TagesplanBlock; titel: string; hinweis: string; kuerzel: string; leer: number }[] = [
  { id: 'organisation', titel: 'Organisatorisch', hinweis: 'wiederholte Aufgaben', kuerzel: '', leer: 0 },
  { id: 'frist', titel: 'Fristsachen', hinweis: 'unbedingt erledigen', kuerzel: '', leer: 3 },
  { id: 'A', titel: 'A-Aufgaben', hinweis: 'Dauer ca. 2 Std.', kuerzel: 'A', leer: 3 },
  { id: 'B', titel: 'B-Aufgaben', hinweis: 'ca. 1,5 Std.', kuerzel: 'B', leer: 4 },
  { id: 'C', titel: 'C-Aufgaben', hinweis: 'ca. 1 Std., falls noch Zeit übrig ist', kuerzel: 'C', leer: 4 },
  { id: 'kurz', titel: 'Kurze Arbeiten', hinweis: 'viele 3–7-Minuten-Arbeiten', kuerzel: '', leer: 2 },
]

// Stehen in jedem neuen Tagesablauf schon drin.
const FESTE_AUFGABEN = ['To-do-Liste überarbeiten', 'Objektliste aktualisieren', 'Tagesablauf festlegen']

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
const STUNDEN = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]

const KEINE_ZELLEN: Record<string, string> = {}

// Schmales Eingabefeld für die Zeilen des Tagesablaufs (inputClass ist immer volle Breite).
const feldGrund = 'rounded-lg border border-slate-200 bg-white text-sm text-slate-800 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100'
const feldKlasse = `${feldGrund} px-2.5 py-1.5`
const feldSchmal = `${feldGrund} px-1.5 py-1.5`

const pfeilKlasse = 'rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700'

type TagEntwurf = { ort: string; zeilen: TagesplanZeile[]; anrufe: string }

// ── Datum ────────────────────────────────────────────────────────────────────────────────────────

/** Montag der Woche, in der das Datum liegt — aus dem lokalen Kalendertag gerechnet. */
function montagVon(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return addDays(iso, -((d.getDay() + 6) % 7))
}

function wochentag(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long' })
}

function fmtDauer(minuten: number): string {
  const std = Math.floor(minuten / 60)
  const min = minuten % 60
  if (std === 0) return `${min} Min.`
  return min === 0 ? `${std} Std.` : `${std} Std. ${min} Min.`
}

// ── Tagesablauf: Zeilen ──────────────────────────────────────────────────────────────────────────

function leereZeile(block: TagesplanBlock): TagesplanZeile {
  return { id: uid('tz'), block, was: '' }
}

function neuerTag(): TagEntwurf {
  return {
    ort: '',
    anrufe: '',
    zeilen: BLOECKE.flatMap((b) =>
      b.id === 'organisation' ? FESTE_AUFGABEN.map((was) => ({ id: uid('tz'), block: b.id, was })) : Array.from({ length: b.leer }, () => leereZeile(b.id)),
    ),
  }
}

/** Gespeicherte Zeilen, je Block mit leeren Zeilen aufgefüllt — damit das Blatt immer gleich aussieht. */
function mitLeerzeilen(zeilen: TagesplanZeile[]): TagesplanZeile[] {
  return BLOECKE.flatMap((b) => {
    const vorhanden = zeilen.filter((z) => z.block === b.id)
    return [...vorhanden, ...Array.from({ length: Math.max(0, b.leer - vorhanden.length) }, () => leereZeile(b.id))]
  })
}

/** So wird gespeichert: nur Zeilen mit Text, in Blockreihenfolge, ohne leere Angaben. */
function bereinigeZeilen(zeilen: TagesplanZeile[]): TagesplanZeile[] {
  return BLOECKE.flatMap((b) =>
    zeilen
      .filter((z) => z.block === b.id && z.was.trim() !== '')
      .map((z) => {
        const sauber: TagesplanZeile = { id: z.id, block: z.block, was: z.was.trim() }
        if (z.dauerMin && z.dauerMin > 0) sauber.dauerMin = z.dauerMin
        if (z.bisUhr) sauber.bisUhr = z.bisUhr
        if (z.ergebnis?.trim()) sauber.ergebnis = z.ergebnis.trim()
        if (z.stand?.trim()) sauber.stand = z.stand.trim()
        if (z.erledigt) sauber.erledigt = true
        return sauber
      }),
  )
}

function tagKern(e: TagEntwurf): string {
  return JSON.stringify([e.ort.trim(), bereinigeZeilen(e.zeilen), e.anrufe.trim()])
}

function kennzahlen(zeilen: TagesplanZeile[]) {
  const mitText = zeilen.filter((z) => z.was.trim() !== '')
  return {
    anzahl: mitText.length,
    erledigt: mitText.filter((z) => z.erledigt).length,
    minuten: mitText.reduce((summe, z) => summe + (z.dauerMin ?? 0), 0),
  }
}

function zeilenNummer(block: (typeof BLOECKE)[number], index: number): string {
  return `${block.kuerzel}${index + 1}`
}

// ── Vorschläge für den Tag ───────────────────────────────────────────────────────────────────────

/** In diese Blöcke lassen sich Vorschläge übernehmen. */
type VorschlagBlock = Extract<TagesplanBlock, 'frist' | 'A' | 'B' | 'C'>

const VORSCHLAG_BLOECKE: { id: VorschlagBlock; kurz: string }[] = [
  { id: 'frist', kurz: 'Frist' },
  { id: 'A', kurz: 'A' },
  { id: 'B', kurz: 'B' },
  { id: 'C', kurz: 'C' },
]

const VORSCHLAEGE_SICHTBAR = 12

type Vorschlag = {
  id: string
  /** So landet der Vorschlag als Zeile im Tagesablauf. */
  text: string
  quelle: string
  hinweis: string
  /** Gesetzt, wenn der Vorschlag am gewählten Tag fällig oder schon überfällig ist. */
  faellig: string | null
  ueberfaellig: boolean
  /** Der vorgeschlagene Block. */
  block: VorschlagBlock
  /** 0 = A/Hoch, 1 = B/Mittel, 2 = C/Niedrig, 3 = ohne Angabe. */
  rang: number
  /** Für die Reihenfolge der nicht fälligen Vorschläge: „erledigen bis“, sonst ganz hinten. */
  spaeter: string
  /** Nur bei Terminen aus dem Kalender: die feste Zeit, die beim Übernehmen in die Zeile kommt. */
  termin?: Zeitangabe
}

/** Zeitfelder einer Zeile im Tagesablauf („ca. Min.“ und „bis Uhrzeit“). */
type Zeitangabe = { dauerMin?: number; bisUhr?: string }

/** Ein Vorschlag, wie er in den Tagesablauf übernommen wird. */
type Uebernahme = { text: string; block: VorschlagBlock; zeit?: Zeitangabe }

type VorschlagDaten = Pick<AppData, 'todos' | 'objekte' | 'immobilienKunden' | 'projekte'>

/** Vergleichsform eines Zeilentexts: ohne Groß-/Kleinschreibung, ohne doppelte Leerzeichen. */
function textSchluessel(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Datumsangabe als lokales yyyy-mm-dd — die Wiedervorlage der To-do-Liste ist ein freies Textfeld
 *  (auch „17.11.2026“). Leer, wenn kein Datum zu erkennen ist. */
function alsDatum(wert: string | null | undefined): string {
  const s = (wert ?? '').trim()
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const deutsch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (deutsch) return `${deutsch[3].length === 2 ? `20${deutsch[3]}` : deutsch[3]}-${deutsch[2].padStart(2, '0')}-${deutsch[1].padStart(2, '0')}`
  return ''
}

function woerter(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
}

/** Steht in „zuständig“/„verantwortlich“ der angemeldete Mitarbeiter? Ohne Groß-/Kleinschreibung:
 *  der volle Name, nur Vor- oder nur Nachname, auch mit abgekürztem zweiten Teil („Quirin L.“) und in
 *  Aufzählungen („Quirin / Hasan“). Ein anderer voller Name mit gleichem Nachnamen zählt nicht. */
function gehoertMir(angabe: string | null | undefined, ich: string): boolean {
  const meinName = textSchluessel(ich)
  const text = textSchluessel(angabe ?? '')
  if (!text || !meinName) return false
  if (text.includes(meinName)) return true
  const teile = woerter(meinName).filter((t) => t.length >= 3)
  if (teile.length === 0) return false
  return text.split(/[,;/&+]|\s+und\s+/).some((eintrag) => {
    const w = woerter(eintrag)
    return w.some((x) => teile.includes(x)) && w.every((x) => teile.includes(x) || (x.length === 1 && teile.some((t) => t.startsWith(x))))
  })
}

function rangVonPrioritaet(prioritaet: string | null | undefined): number {
  return prioritaet === 'Hoch' ? 0 : prioritaet === 'Mittel' ? 1 : prioritaet === 'Niedrig' ? 2 : 3
}

/** Was am gewählten Tag für den Mitarbeiter ansteht — aus den Daten, die das CRM schon hat:
 *  offene To-dos (Abteilung und eigene Liste), fällige Follow-ups der Objekte und Kontakte und
 *  fällige Projektaufgaben. Fälliges und Überfälliges zuerst (das Älteste oben), danach nach Prio. */
function sammleVorschlaege(daten: VorschlagDaten, ich: string, email: string, datum: string): Vorschlag[] {
  const istHeute = datum === today()
  const faelligText = (tag: string) => (tag < datum ? `überfällig seit ${fmtDate(tag)}` : istHeute ? 'fällig heute' : `fällig am ${fmtDate(tag)}`)
  const liste: Vorschlag[] = []

  for (const t of daten.todos ?? []) {
    if ((t.erledigtAm ?? '').trim()) continue
    const inMeinerListe = t.bereich ? t.bereich === 'immobilien' : (t.besitzerEmail ?? '').trim().toLowerCase() === email
    if (!inMeinerListe) continue
    if ((t.zustaendig ?? '').trim() && !gehoertMir(t.zustaendig, ich)) continue
    const aufgabe = (t.aufgabe ?? '').trim()
    if (!aufgabe) continue
    const kundeProjekt = (t.kundeProjekt ?? '').trim()
    const bis = alsDatum(t.erledigenBis)
    const wiedervorlage = alsDatum(t.geplanteWiedervorlage)
    const prio = (t.prio ?? '').trim().toUpperCase().charAt(0)
    const mitFrist = bis !== '' && bis <= datum
    const faellig = mitFrist ? bis : wiedervorlage === datum ? datum : null
    const hinweise: string[] = []
    if (mitFrist) hinweise.push(faelligText(bis))
    else if (faellig) hinweise.push(istHeute ? 'Wiedervorlage heute' : `Wiedervorlage am ${fmtDate(datum)}`)
    if (prio === 'A' || prio === 'B' || prio === 'C') hinweise.push(`Prio ${prio}`)
    if (!mitFrist && bis) hinweise.push(`erledigen bis ${fmtDate(bis)}`)
    const wartenAuf = (t.wartenAuf ?? '').trim()
    if (wartenAuf) hinweise.push(`warten auf ${wartenAuf}`)
    liste.push({
      id: `todo-${t.id}`,
      text: kundeProjekt ? `${aufgabe} (${kundeProjekt})` : aufgabe,
      quelle: t.bereich ? 'To-do Abteilung' : 'Eigenes To-do',
      hinweis: hinweise.join(' · '),
      faellig,
      ueberfaellig: mitFrist && bis < datum,
      block: faellig ? 'frist' : prio === 'A' ? 'A' : prio === 'B' ? 'B' : 'C',
      rang: prio === 'A' ? 0 : prio === 'B' ? 1 : prio === 'C' ? 2 : 3,
      spaeter: bis || '9999-99-99',
    })
  }

  const followUp = (id: string, quelle: string, name: string, f: { date: string; note: string; done: boolean } | undefined, verantwortlich: string, prioritaet: string) => {
    const tag = alsDatum(f?.date)
    if (!f || f.done || !tag || tag > datum || !gehoertMir(verantwortlich, ich)) return
    const notiz = (f.note ?? '').trim()
    liste.push({
      id,
      text: notiz ? `Follow-up ${name}: ${notiz}` : `Follow-up ${name}`,
      quelle,
      hinweis: faelligText(tag),
      faellig: tag,
      ueberfaellig: tag < datum,
      block: 'frist',
      rang: rangVonPrioritaet(prioritaet),
      spaeter: tag,
    })
  }
  for (const o of daten.objekte ?? []) {
    followUp(`objekt-${o.id}`, 'Follow-up Objekt', (o.bezeichnung ?? '').trim() || (o.adresse ?? '').trim() || 'Objekt', o.followUp, o.verantwortlich, o.prioritaet)
  }
  for (const k of daten.immobilienKunden ?? []) {
    const firma = (k.firma ?? '').trim()
    const person = (k.ansprechpartner ?? '').trim()
    const name = firma && person && firma.toLowerCase() !== person.toLowerCase() ? `${firma} (${person})` : firma || person || 'Kontakt'
    followUp(`kontakt-${k.id}`, 'Follow-up Kontakt', name, k.followUp, k.verantwortlich, k.prioritaet)
  }

  // Projektaufgaben, wie sie auch die Seite „Heute“ liest: offene Aufgaben mit Wiedervorlage bis zum gewählten Tag.
  for (const projekt of daten.projekte ?? []) {
    for (const meilenstein of projekt.meilensteine ?? []) {
      for (const aufgabe of meilenstein.aufgaben ?? []) {
        const tag = alsDatum(aufgabe.wiedervorlage)
        if (aufgabe.status === 'erledigt' || !tag || tag > datum || !gehoertMir(aufgabe.zustaendig, ich)) continue
        const titel = (aufgabe.titel ?? '').trim()
        if (!titel) continue
        liste.push({
          id: `aufgabe-${aufgabe.id}`,
          text: projekt.name ? `${titel} (${projekt.name})` : titel,
          quelle: 'Projektaufgabe',
          hinweis: faelligText(tag),
          faellig: tag,
          ueberfaellig: tag < datum,
          block: 'frist',
          rang: rangVonPrioritaet(aufgabe.prioritaet),
          spaeter: tag,
        })
      }
    }
  }

  liste.sort((a, b) => {
    if (a.faellig && b.faellig) return a.faellig.localeCompare(b.faellig) || a.rang - b.rang || a.text.localeCompare(b.text, 'de')
    if (a.faellig) return -1
    if (b.faellig) return 1
    return a.rang - b.rang || a.spaeter.localeCompare(b.spaeter) || a.text.localeCompare(b.text, 'de')
  })

  // Zwei Einträge mit demselben Text ergäben dieselbe Zeile — nur der erste (dringendere) bleibt.
  const gesehen = new Set<string>()
  return liste.filter((v) => {
    const schluessel = textSchluessel(v.text)
    if (gesehen.has(schluessel)) return false
    gesehen.add(schluessel)
    return true
  })
}

// ── Termine aus dem Kalender als Vorschläge ──────────────────────────────────────────────────────

const zwei = (n: number) => String(n).padStart(2, '0')
const uhrzeit = (d: Date) => `${zwei(d.getHours())}:${zwei(d.getMinutes())}`
const lokalerTag = (d: Date) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`

/** Beginn und Ende des Kalendertags (lokale Zeit; auch an Tagen der Zeitumstellung richtig). */
function tagesGrenzen(datum: string): { beginn: Date; ende: Date } {
  const beginn = new Date(datum + 'T00:00:00')
  return { beginn, ende: new Date(beginn.getFullYear(), beginn.getMonth(), beginn.getDate() + 1) }
}

/** Die Termine des Tags als Vorschläge — nur die eigenen und die, bei denen man Teilnehmer ist. Die
 *  Datenbank liefert ohnehin nur solche; hier wird es trotzdem noch einmal geprüft, damit von einem
 *  fremden Termin nie etwas erscheint. Titel, Zeit und Kunde — keine Beschreibung. */
function terminVorschlaege(termine: Termin[], email: string, datum: string): Vorschlag[] {
  const ich = email.trim().toLowerCase()
  if (!ich) return []
  const tag = tagesGrenzen(datum)
  return termine
    .filter((t) => t.besitzerEmail.toLowerCase() === ich || t.teilnehmer.some((p) => p.toLowerCase() === ich))
    .map((t) => {
      const beginn = new Date(t.beginn)
      const ende = new Date(t.ende)
      const beginntHeute = beginn >= tag.beginn
      const endetHeute = ende < tag.ende
      let spanne = 'ganztägig'
      let zeit: Zeitangabe = {}
      if (!t.ganztags && (beginntHeute || endetHeute)) {
        spanne = beginntHeute && endetHeute ? `${uhrzeit(beginn)}–${uhrzeit(ende)} Uhr` : beginntHeute ? `ab ${uhrzeit(beginn)} Uhr` : `bis ${uhrzeit(ende)} Uhr`
        // Dauer nur, wenn der Termin ganz an diesem Tag liegt; die Endzeit, wenn er an diesem Tag endet.
        const minuten = Math.round((ende.getTime() - beginn.getTime()) / 60000)
        zeit = { ...(beginntHeute && endetHeute && minuten > 0 ? { dauerMin: minuten } : {}), ...(endetHeute ? { bisUhr: uhrzeit(ende) } : {}) }
      }
      const titel = (t.titel ?? '').trim() || 'Termin'
      const kunde = (t.kundeName ?? '').trim()
      const ort = (t.ort ?? '').trim()
      const hinweise: string[] = []
      // Mehrtägige Termine: von wann bis wann sie insgesamt gehen (Ende um Mitternacht zählt zum Vortag).
      if (!beginntHeute) hinweise.push(`seit ${fmtDate(lokalerTag(beginn))}`)
      if (ende > tag.ende) hinweise.push(`bis ${fmtDate(lokalerTag(new Date(ende.getTime() - 1)))}`)
      if (ort) hinweise.push(`Ort: ${ort}`)
      if (t.teilnehmer.length > 0) hinweise.push('gemeinsamer Termin')
      return {
        id: `termin-${t.id}`,
        text: `${spanne}: ${titel}${kunde ? ` (${kunde})` : ''}`,
        quelle: 'Termin',
        hinweis: hinweise.join(' · '),
        faellig: datum,
        ueberfaellig: false,
        block: 'frist' as const,
        rang: 0,
        // Reihenfolge: ganztägige, dann die schon vor dem Tag begonnenen, dann nach Beginn.
        spaeter: t.ganztags || (!beginntHeute && !endetHeute) ? '' : beginntHeute ? `2${beginn.toISOString()}` : `1${ende.toISOString()}`,
        termin: zeit,
      }
    })
    .sort((a, b) => a.spaeter.localeCompare(b.spaeter) || a.text.localeCompare(b.text, 'de'))
}

const KEINE_TERMINE: Termin[] = []

type TerminStand = { laedt: boolean; fehler: boolean; termine: Termin[]; erneut: () => void }

/** Lädt die Termine des Tags einmal je Tag (und auf Wunsch erneut). aktiv = false: lädt nichts — für
 *  fremde Tagesabläufe und ohne Anmeldung. */
function useTermineDesTags(datum: string, email: string, aktiv: boolean): TerminStand {
  const [versuch, setVersuch] = useState(0)
  const schluessel = `${email}|${datum}|${versuch}`
  const [ergebnis, setErgebnis] = useState<{ schluessel: string; termine: Termin[]; fehler: boolean } | null>(null)

  useEffect(() => {
    if (!aktiv) return
    let abgebrochen = false
    const tag = tagesGrenzen(datum)
    ladeTermine(tag.beginn, tag.ende)
      .then((termine) => {
        if (!abgebrochen) setErgebnis({ schluessel, termine, fehler: false })
      })
      .catch(() => {
        if (!abgebrochen) setErgebnis({ schluessel, termine: [], fehler: true })
      })
    return () => {
      abgebrochen = true
    }
  }, [aktiv, schluessel, datum])

  const aktuell = aktiv && ergebnis?.schluessel === schluessel ? ergebnis : null
  return {
    laedt: aktiv && !aktuell,
    fehler: !!aktuell?.fehler,
    termine: aktuell?.termine ?? KEINE_TERMINE,
    erneut: () => setVersuch((v) => v + 1),
  }
}

// ── Wochenplan: Zellen ───────────────────────────────────────────────────────────────────────────

function bereinigeZellen(zellen: Record<string, string>): Record<string, string> {
  const sauber: Record<string, string> = {}
  for (const schluessel of Object.keys(zellen).sort()) {
    const text = (zellen[schluessel] ?? '').trim()
    if (text) sauber[schluessel] = text
  }
  return sauber
}

function wochenKern(zellen: Record<string, string>): string {
  return JSON.stringify(Object.entries(bereinigeZellen(zellen)))
}

// ── Entwurf mit Abgleich gegen den gespeicherten Stand ───────────────────────────────────────────

/** Hält den eigenen, noch nicht gespeicherten Stand. Solange du nichts geändert hast, zeigt er immer
 *  den gespeicherten Stand (auch wenn der erst nach dem Öffnen der Seite geladen wird oder von einem
 *  anderen Gerät kommt) — so überschreibt ein leeres Blatt nie versehentlich einen gespeicherten Plan. */
function useEntwurf<T>(gespeicherterStand: T, kern: (wert: T) => string) {
  const [lokal, setLokal] = useState<{ daten: T; basis: string } | null>(null)
  const standKern = kern(gespeicherterStand)
  const selbstGeaendert = lokal !== null && kern(lokal.daten) !== lokal.basis
  const anderswoGeaendert = lokal !== null && lokal.basis !== standKern
  const eigenerStand = lokal !== null && (selbstGeaendert || !anderswoGeaendert) ? lokal : null
  const entwurf = eigenerStand ? eigenerStand.daten : gespeicherterStand
  const geaendert = kern(entwurf) !== standKern
  return {
    entwurf,
    geaendert,
    /** Du hast geändert, und gleichzeitig ist anderswo ein neuer Stand gespeichert worden. */
    ueberholt: eigenerStand !== null && anderswoGeaendert && geaendert,
    setze: (neu: T) => setLokal({ daten: neu, basis: eigenerStand ? eigenerStand.basis : standKern }),
    uebernommen: (daten: T) => setLokal({ daten, basis: kern(daten) }),
    verwerfen: () => setLokal(null),
  }
}

/** Meldet der Seite, ob es ungespeicherte Änderungen gibt (für die Rückfrage beim Wechseln). */
function useMeldeUngespeichert(melde: (ungespeichert: boolean) => void, geaendert: boolean) {
  useEffect(() => {
    melde(geaendert)
    return () => melde(false)
  }, [melde, geaendert])
}

// ── Seite ────────────────────────────────────────────────────────────────────────────────────────

/** Tagesablauf und Wochenplan der Immobilienabteilung. Morgens trägt jeder ein, was heute in welcher
 *  Reihenfolge ansteht — alle anderen sehen es darunter. Der Wochenplan ist das Stundenraster je Woche.
 *  Vorlagen: die Tabellenblätter „Tagesablauf klar definieren" und „Wochenplan". */
export function TagesablaufSeite() {
  const { mitarbeiter } = useAuth()
  const ich = mitarbeiter?.name ?? CURRENT_USER
  const [ansicht, setAnsicht] = useState<'tag' | 'woche'>('tag')
  const [datum, setDatum] = useState(today())
  const [wocheAb, setWocheAb] = useState(() => montagVon(today()))
  const [kollege, setKollege] = useState('') // leer = mein eigener Wochenplan
  const ungespeichert = useRef(false)
  const meldeUngespeichert = useCallback((wert: boolean) => {
    ungespeichert.current = wert
  }, [])

  function wechsle(aktion: () => void) {
    if (ungespeichert.current && !window.confirm('Du hast Änderungen, die noch nicht gespeichert sind. Trotzdem wechseln? Sie gehen dann verloren.')) return
    ungespeichert.current = false
    aktion()
  }

  const wessen = kollege || ich

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Tagesablauf</h1>
        <p className="text-sm text-slate-500">Wer macht heute was – dein Tagesablauf, die der Kollegen und der Wochenplan.</p>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {(
          [
            { id: 'tag', label: 'Tagesablauf' },
            { id: 'woche', label: 'Wochenplan' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => ansicht !== t.id && wechsle(() => setAnsicht(t.id))}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${ansicht === t.id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            aria-pressed={ansicht === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ansicht === 'tag' ? (
        <>
          <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
            <button className={pfeilKlasse} onClick={() => wechsle(() => setDatum(addDays(datum, -1)))} aria-label="Einen Tag zurück" title="Einen Tag zurück">
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className={`${feldGrund} px-2.5 py-2`}
              value={datum}
              onChange={(e) => {
                const neu = e.target.value
                if (neu && neu !== datum) wechsle(() => setDatum(neu))
              }}
              aria-label="Datum"
            />
            <button className={pfeilKlasse} onClick={() => wechsle(() => setDatum(addDays(datum, 1)))} aria-label="Einen Tag weiter" title="Einen Tag weiter">
              <ChevronRight size={16} />
            </button>
            {datum !== today() && <SecondaryButton onClick={() => wechsle(() => setDatum(today()))}>Heute</SecondaryButton>}
            <span className="ml-1 text-sm text-slate-600">
              {wochentag(datum)}
              {datum === today() && <span className="text-slate-400"> · heute</span>}
            </span>
          </Card>

          <MeinTagesablauf key={`${ich}|${datum}`} ich={ich} datum={datum} onUngespeichert={meldeUngespeichert} />
          <KollegenTagesablaeufe ich={ich} datum={datum} />
        </>
      ) : (
        <>
          <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className={pfeilKlasse} onClick={() => wechsle(() => setWocheAb(addDays(wocheAb, -7)))} aria-label="Eine Woche zurück" title="Eine Woche zurück">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-medium text-slate-700">
                Wochenplan vom {fmtDate(wocheAb)} bis {fmtDate(addDays(wocheAb, 6))}
              </span>
              <button className={pfeilKlasse} onClick={() => wechsle(() => setWocheAb(addDays(wocheAb, 7)))} aria-label="Eine Woche weiter" title="Eine Woche weiter">
                <ChevronRight size={16} />
              </button>
              {wocheAb !== montagVon(today()) && <SecondaryButton onClick={() => wechsle(() => setWocheAb(montagVon(today())))}>Diese Woche</SecondaryButton>}
            </div>
            <label className="flex min-w-52 flex-1 items-center gap-2 text-sm text-slate-600 sm:flex-none">
              <span className="whitespace-nowrap">Wessen Plan?</span>
              <select
                className={inputClass}
                value={kollege}
                onChange={(e) => {
                  const neu = e.target.value
                  wechsle(() => setKollege(neu))
                }}
              >
                <option value="">Mein Wochenplan ({ich})</option>
                {MITARBEITER.filter((name) => name !== ich).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </Card>

          {wessen === ich ? (
            <MeinWochenplan key={`${ich}|${wocheAb}`} ich={ich} wocheAb={wocheAb} onUngespeichert={meldeUngespeichert} />
          ) : (
            <KollegenWochenplan name={wessen} wocheAb={wocheAb} />
          )}
        </>
      )}
    </div>
  )
}

// ── Speichern-Leiste ─────────────────────────────────────────────────────────────────────────────

function SpeicherLeiste({
  text,
  geaendert,
  gespeichert,
  aktiv,
  onSpeichern,
}: {
  text: string
  geaendert: boolean
  gespeichert: boolean
  aktiv: boolean
  onSpeichern: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {geaendert && <span className="text-xs font-medium text-amber-600">Änderungen noch nicht gespeichert</span>}
      {gespeichert && !geaendert && (
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
          <Check size={13} /> Gespeichert
        </span>
      )}
      <PrimaryButton onClick={onSpeichern} disabled={!aktiv}>
        {text}
      </PrimaryButton>
    </div>
  )
}

function UeberholtHinweis({ onLaden }: { onLaden: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
      <span className="min-w-0 flex-1">Der gespeicherte Stand wurde inzwischen an anderer Stelle geändert. Wenn du jetzt speicherst, gilt dein Stand von hier.</span>
      <button onClick={onLaden} className="rounded-md border border-amber-300 bg-white px-2 py-1 font-medium hover:bg-amber-100">
        Gespeicherten Stand laden
      </button>
    </div>
  )
}

// ── Mein Tagesablauf ─────────────────────────────────────────────────────────────────────────────

function MeinTagesablauf({ ich, datum, onUngespeichert }: { ich: string; datum: string; onUngespeichert: (ungespeichert: boolean) => void }) {
  const { state, dispatch } = useApp()
  const { session } = useAuth()
  // Wie in der To-do-Liste: ohne Anmeldung gehören die eigenen To-dos dem Besitzer „lokal“.
  const meineEmail = ((isSupabaseConfigured && session?.user?.email) || 'lokal').toLowerCase()
  const [vorlage] = useState(neuerTag)
  const [gespeichertMeldung, setGespeichertMeldung] = useState(false)
  const [uebernahmeMeldung, setUebernahmeMeldung] = useState('')

  const gespeicherterPlan = state.tagesplaene.find((p) => p.mitarbeiter === ich && p.datum === datum)
  const gespeicherterStand = useMemo<TagEntwurf>(
    () => (gespeicherterPlan ? { ort: gespeicherterPlan.ort ?? '', zeilen: mitLeerzeilen(gespeicherterPlan.zeilen ?? []), anrufe: gespeicherterPlan.anrufe ?? '' } : vorlage),
    [gespeicherterPlan, vorlage],
  )
  const { entwurf, geaendert, ueberholt, setze, uebernommen, verwerfen } = useEntwurf(gespeicherterStand, tagKern)
  useMeldeUngespeichert(onUngespeichert, geaendert)

  // Der letzte frühere Tagesablauf — von dort kommen die offenen Aufgaben für „Vom letzten Tag übernehmen".
  const letzterPlan = useMemo(
    () => state.tagesplaene.filter((p) => p.mitarbeiter === ich && p.datum < datum).sort((a, b) => b.datum.localeCompare(a.datum))[0],
    [state.tagesplaene, ich, datum],
  )
  const offenVomLetzten = letzterPlan ? (letzterPlan.zeilen ?? []).filter((z) => z.was.trim() !== '' && !z.erledigt) : []

  const { todos, objekte, immobilienKunden, projekte } = state
  // Termine aus dem Kalender: nur hier im eigenen Tagesablauf und nur mit Anmeldung (die Tagesabläufe
  // der Kollegen bekommen keine Terminvorschläge).
  const kalenderEmail = isSupabaseConfigured ? (session?.user?.email ?? '').trim().toLowerCase() : ''
  const termineDesTags = useTermineDesTags(datum, kalenderEmail, kalenderEmail !== '')
  const termine = termineDesTags.termine
  const vorschlaege = useMemo(() => {
    // Termine zuerst (nach Uhrzeit) — sie haben eine feste Zeit. Gleicher Text ergäbe dieselbe Zeile: nur der erste bleibt.
    const gesehen = new Set<string>()
    return [...terminVorschlaege(termine, kalenderEmail, datum), ...sammleVorschlaege({ todos, objekte, immobilienKunden, projekte }, ich, meineEmail, datum)].filter((v) => {
      const schluessel = textSchluessel(v.text)
      if (gesehen.has(schluessel)) return false
      gesehen.add(schluessel)
      return true
    })
  }, [termine, kalenderEmail, todos, objekte, immobilienKunden, projekte, ich, meineEmail, datum])

  const zahlen = kennzahlen(entwurf.zeilen)

  function aendere(neu: TagEntwurf) {
    setze(neu)
    setGespeichertMeldung(false)
  }

  function aendereZeile(id: string, patch: Partial<TagesplanZeile>) {
    aendere({ ...entwurf, zeilen: entwurf.zeilen.map((z) => (z.id === id ? { ...z, ...patch } : z)) })
  }

  function neueZeile(block: TagesplanBlock) {
    // Hinter der letzten Zeile des Blocks einfügen (die Reihenfolge beim Speichern richtet sich ohnehin nach den Blöcken).
    aendere({ ...entwurf, zeilen: [...entwurf.zeilen, leereZeile(block)] })
  }

  function entferneZeile(id: string) {
    aendere({ ...entwurf, zeilen: entwurf.zeilen.filter((z) => z.id !== id) })
  }

  function uebernehmeVomLetztenTag() {
    if (!letzterPlan) return
    let dazu = 0
    const zeilen = BLOECKE.flatMap((b) => {
      const gefuellt = entwurf.zeilen.filter((z) => z.block === b.id && z.was.trim() !== '')
      const leere = entwurf.zeilen.filter((z) => z.block === b.id && z.was.trim() === '')
      const schonDa = new Set(gefuellt.map((z) => z.was.trim().toLowerCase()))
      const neu: TagesplanZeile[] = []
      for (const z of offenVomLetzten) {
        const text = z.was.trim()
        if (z.block !== b.id || schonDa.has(text.toLowerCase())) continue
        schonDa.add(text.toLowerCase())
        // Ohne Häkchen und ohne Ergebnis — beides gehört zum alten Tag.
        neu.push({ id: uid('tz'), block: b.id, was: text, dauerMin: z.dauerMin, bisUhr: z.bisUhr, stand: z.stand })
      }
      dazu += neu.length
      // Die übernommenen Zeilen füllen zuerst die leeren Zeilen des Blocks.
      return [...gefuellt, ...neu, ...leere.slice(0, Math.max(0, leere.length - neu.length))]
    })
    if (dazu > 0) aendere({ ...entwurf, zeilen })
    setUebernahmeMeldung(
      dazu > 0
        ? `${dazu} offene ${dazu === 1 ? 'Aufgabe' : 'Aufgaben'} vom ${fmtDate(letzterPlan.datum)} übernommen.`
        : offenVomLetzten.length === 0
          ? `Am ${fmtDate(letzterPlan.datum)} ist nichts offen geblieben.`
          : `Alles Offene vom ${fmtDate(letzterPlan.datum)} steht schon in deinem Tagesablauf.`,
    )
  }

  /** Vorschläge als Zeilen in den Tagesablauf legen: in die erste leere Zeile des Blocks, sonst als neue
   *  Zeile dahinter. Was mit demselben Text schon im Plan steht, kommt nicht doppelt. Ein Termin bringt
   *  seine Zeit mit: Dauer in „ca. Min.“, Ende in „bis Uhrzeit“ (nur wo die Zeile dort noch nichts hat).
   *  Gespeichert wird dabei nichts — das bleibt bei „Tagesablauf speichern“. */
  function uebernehmeVorschlaege(auswahl: Uebernahme[]) {
    let zeilen = entwurf.zeilen
    const schonDa = new Set(zeilen.map((z) => textSchluessel(z.was)).filter(Boolean))
    for (const { text, block, zeit } of auswahl) {
      const schluessel = textSchluessel(text)
      if (!schluessel || schonDa.has(schluessel)) continue
      schonDa.add(schluessel)
      const fuelle = (z: TagesplanZeile): TagesplanZeile => ({
        ...z,
        was: text,
        ...(zeit?.dauerMin && !z.dauerMin ? { dauerMin: zeit.dauerMin } : {}),
        ...(zeit?.bisUhr && !z.bisUhr ? { bisUhr: zeit.bisUhr } : {}),
      })
      const leer = zeilen.find((z) => z.block === block && z.was.trim() === '')
      zeilen = leer ? zeilen.map((z) => (z.id === leer.id ? fuelle(z) : z)) : [...zeilen, fuelle(leereZeile(block))]
    }
    if (zeilen !== entwurf.zeilen) aendere({ ...entwurf, zeilen })
  }

  function speichern() {
    const ort = entwurf.ort.trim()
    const plan: Tagesplan = {
      id: `${ich}|${datum}`,
      mitarbeiter: ich,
      datum,
      ...(ort ? { ort } : {}),
      zeilen: bereinigeZeilen(entwurf.zeilen),
      anrufe: entwurf.anrufe.trim(),
      aktualisiertAm: new Date().toISOString(),
    }
    dispatch({ type: 'SPEICHERE_TAGESPLAN', plan })
    uebernommen(entwurf)
    setGespeichertMeldung(true)
  }

  const leiste = <SpeicherLeiste text="Tagesablauf speichern" geaendert={geaendert} gespeichert={gespeichertMeldung} aktiv={geaendert || !gespeicherterPlan} onSpeichern={speichern} />

  return (
    <>
      <VorschlaegeKarte
        datum={datum}
        vorschlaege={vorschlaege}
        zeilen={entwurf.zeilen}
        onUebernehmen={uebernehmeVorschlaege}
        termine={kalenderEmail ? termineDesTags : undefined}
      />
      <Card className="mb-5 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Mein Tagesablauf</h3>
            <p className="text-xs text-slate-400">
              {wochentag(datum)}, {fmtDate(datum)} · Bearbeiter: {ich}
            </p>
          </div>
          {leiste}
        </div>

        {ueberholt && <UeberholtHinweis onLaden={verwerfen} />}
        {!gespeicherterPlan && !geaendert && (
          <p className="mb-4 text-xs text-slate-500">Für diesen Tag ist noch nichts gespeichert. Die Kollegen sehen deinen Tagesablauf erst, wenn du ihn gespeichert hast.</p>
        )}

        <div className="mb-2 grid grid-cols-1 items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Ort">
            <input className={inputClass} value={entwurf.ort} onChange={(e) => aendere({ ...entwurf, ort: e.target.value })} placeholder="z. B. Büro Ulm, unterwegs" />
          </Field>
          <div className="mb-3 text-sm text-slate-600 lg:col-span-2">
            <span className="font-medium text-slate-700">{zahlen.minuten > 0 ? fmtDauer(zahlen.minuten) : 'Noch keine Zeiten'}</span> geplant ·{' '}
            <span className="font-medium text-slate-700">
              {zahlen.erledigt} von {zahlen.anzahl}
            </span>{' '}
            erledigt
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <SecondaryButton onClick={uebernehmeVomLetztenTag} disabled={!letzterPlan}>
            Vom letzten Tag übernehmen
          </SecondaryButton>
          <span className="text-xs text-slate-500">
            {uebernahmeMeldung ||
              (letzterPlan
                ? `Letzter Tagesablauf: ${fmtDate(letzterPlan.datum)} · ${offenVomLetzten.length} ${offenVomLetzten.length === 1 ? 'Aufgabe' : 'Aufgaben'} offen`
                : 'Es gibt noch keinen früheren Tagesablauf von dir.')}
          </span>
        </div>

        {/* Spaltenköpfe wie im Tabellenblatt — nur am großen Bildschirm, am Handy stehen die Angaben untereinander. */}
        <div className="mb-1 hidden items-center gap-2 text-xs font-medium text-slate-400 lg:flex">
          <span className="w-4 shrink-0" />
          <span className="w-6 shrink-0" />
          <span className="w-14 shrink-0">ca. Min.</span>
          <span className="w-24 shrink-0">bis Uhrzeit</span>
          <span className="min-w-0 flex-[2_1_0%]">Was ist heute zu tun (in dieser Reihenfolge)</span>
          <span className="min-w-0 flex-[1_1_0%]">Gewinn/Verlust</span>
          <span className="min-w-0 flex-[1.5_1_0%]">Infos, Stand, Fragen, nächste Schritte</span>
          <span className="w-8 shrink-0" />
        </div>

        <div className="space-y-5">
          {BLOECKE.map((b) => {
            const zeilen = entwurf.zeilen.filter((z) => z.block === b.id)
            const minuten = kennzahlen(zeilen).minuten
            return (
              <section key={b.id} aria-label={b.titel}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-100 pb-1">
                  <h4 className="text-sm font-semibold text-slate-700">
                    {b.titel} <span className="text-xs font-normal text-slate-400">· {b.hinweis}</span>
                  </h4>
                  {minuten > 0 && <span className="text-xs text-slate-400">{fmtDauer(minuten)} geplant</span>}
                </div>
                <div className="space-y-3 lg:space-y-1.5">
                  {zeilen.map((z, i) => {
                    const nummer = zeilenNummer(b, i)
                    const name = z.was.trim() || `Zeile ${nummer}`
                    // Am Handy erscheinen Ergebnis und Stand erst, wenn die Zeile einen Text hat — sonst wird das Blatt zu lang.
                    const nurMitText = z.was.trim() === '' ? 'hidden lg:block' : ''
                    return (
                      <div key={z.id} className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
                        <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!z.erledigt} onChange={(e) => aendereZeile(z.id, { erledigt: e.target.checked })} aria-label={`${name} erledigt`} title="erledigt" />
                        <span className="w-6 shrink-0 text-xs font-semibold text-slate-400">{nummer}</span>
                        <input
                          type="number"
                          min={0}
                          step={5}
                          inputMode="numeric"
                          className={`${feldSchmal} w-14 shrink-0`}
                          value={z.dauerMin ?? ''}
                          onChange={(e) => {
                            const zahl = Math.round(Number(e.target.value))
                            aendereZeile(z.id, { dauerMin: e.target.value === '' || !Number.isFinite(zahl) || zahl <= 0 ? undefined : zahl })
                          }}
                          placeholder="Min."
                          aria-label={`${name}: ca. Minuten`}
                          title="ca. Minuten"
                        />
                        <span className="text-xs text-slate-400 lg:hidden">bis</span>
                        <input
                          type="time"
                          className={`${feldSchmal} w-24 shrink-0`}
                          value={z.bisUhr ?? ''}
                          onChange={(e) => aendereZeile(z.id, { bisUhr: e.target.value || undefined })}
                          aria-label={`${name}: bis Uhrzeit`}
                          title="bis Uhrzeit"
                        />
                        <button
                          onClick={() => entferneZeile(z.id)}
                          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-600 lg:order-last lg:ml-0"
                          aria-label={`${name} entfernen`}
                          title="Zeile entfernen"
                        >
                          <Trash2 size={14} />
                        </button>
                        <input
                          className={`${feldKlasse} min-w-0 basis-full lg:flex-[2_1_0%] ${z.erledigt ? 'text-slate-400 line-through' : ''}`}
                          value={z.was}
                          onChange={(e) => aendereZeile(z.id, { was: e.target.value })}
                          placeholder="Was ist zu tun?"
                          aria-label={`${b.titel} ${nummer}: Was ist zu tun?`}
                        />
                        <input
                          className={`${feldKlasse} min-w-0 basis-full lg:flex-[1_1_0%] ${nurMitText}`}
                          value={z.ergebnis ?? ''}
                          onChange={(e) => aendereZeile(z.id, { ergebnis: e.target.value })}
                          placeholder="Gewinn/Verlust – was hat es gebracht?"
                          aria-label={`${name}: Gewinn/Verlust`}
                        />
                        <textarea
                          rows={1}
                          className={`${feldKlasse} min-h-[2.125rem] min-w-0 basis-full lg:flex-[1.5_1_0%] ${nurMitText}`}
                          value={z.stand ?? ''}
                          onChange={(e) => aendereZeile(z.id, { stand: e.target.value })}
                          placeholder="Infos, Stand, Fragen, nächste Schritte"
                          aria-label={`${name}: Infos, aktueller Stand, Fragen, nächste Schritte`}
                        />
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => neueZeile(b.id)} className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent-600 hover:bg-accent-50">
                  <Plus size={13} /> Zeile
                </button>
              </section>
            )
          })}
        </div>

        <div className="mt-5">
          <Field label="Anrufe">
            <textarea
              className={`${inputClass} min-h-24`}
              value={entwurf.anrufe}
              onChange={(e) => aendere({ ...entwurf, anrufe: e.target.value })}
              placeholder="Wen rufst du heute an, wer hat angerufen, was ist dabei herausgekommen?"
            />
          </Field>
        </div>

        {leiste}
      </Card>
    </>
  )
}

// ── Vorschläge für heute ─────────────────────────────────────────────────────────────────────────

/** Was das CRM für den Tag vorschlägt. Ein Klick auf Frist, A, B oder C legt den Vorschlag als Zeile in
 *  diesen Block; was schon im Plan steht, erscheint als „übernommen“. */
function VorschlaegeKarte({
  datum,
  vorschlaege,
  zeilen,
  onUebernehmen,
  termine,
}: {
  datum: string
  vorschlaege: Vorschlag[]
  zeilen: TagesplanZeile[]
  onUebernehmen: (auswahl: Uebernahme[]) => void
  /** Ladezustand der Kalendertermine; fehlt, wenn keine Termine geladen werden (ohne Anmeldung). */
  termine?: TerminStand
}) {
  const [alleZeigen, setAlleZeigen] = useState(false)
  const istHeute = datum === today()

  // In welchem Block ein Text schon steht.
  const imPlan = new Map<string, TagesplanBlock>()
  for (const z of zeilen) {
    const schluessel = textSchluessel(z.was)
    if (schluessel && !imPlan.has(schluessel)) imPlan.set(schluessel, z.block)
  }
  const offen = vorschlaege.filter((v) => !imPlan.has(textSchluessel(v.text)))
  const uebernommen = vorschlaege.filter((v) => imPlan.has(textSchluessel(v.text)))
  const alle = [...offen, ...uebernommen]
  const sichtbar = alleZeigen ? alle : alle.slice(0, VORSCHLAEGE_SICHTBAR)
  const offeneFristen = offen.filter((v) => v.block === 'frist')

  return (
    <Card className="mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-700">{istHeute ? 'Vorschläge für heute' : `Vorschläge für ${wochentag(datum)}, ${fmtDate(datum)}`}</h3>
          <p className="text-xs text-slate-400">
            Aus {termine ? 'Kalender, ' : ''}To-do-Liste, Follow-ups und Projektaufgaben. Mit Frist, A, B oder C legst du fest, in welchen Block eine Aufgabe kommt – der farbige Knopf ist
            der Vorschlag.{termine ? ' Ein Termin bringt Dauer und Endzeit gleich mit.' : ''} Gespeichert wird erst mit „Tagesablauf speichern“.
          </p>
        </div>
        {offeneFristen.length > 0 && (
          <SecondaryButton onClick={() => onUebernehmen(offeneFristen.map((v) => ({ text: v.text, block: 'frist' as const, zeit: v.termin })))}>
            Alle Fristen übernehmen ({offeneFristen.length})
          </SecondaryButton>
        )}
      </div>

      {termine?.laedt && <p className="mb-2 text-xs text-slate-400">Termine aus dem Kalender werden geladen …</p>}
      {termine?.fehler && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <span className="min-w-0 flex-1">Die Termine aus dem Kalender konnten nicht geladen werden. Die übrigen Vorschläge stehen trotzdem hier.</span>
          <button onClick={termine.erneut} className="rounded-md border border-rose-300 bg-white px-2 py-1 font-medium hover:bg-rose-100">
            Erneut versuchen
          </button>
        </div>
      )}

      {offen.length === 0 && !termine?.laedt && (
        <p className="text-sm text-slate-400">{istHeute ? 'Für heute liegt nichts an, das nicht schon in deinem Plan steht.' : 'Für diesen Tag liegt nichts an, das nicht schon in deinem Plan steht.'}</p>
      )}

      {sichtbar.length > 0 && (
        <ul className={`space-y-2 ${offen.length === 0 ? 'mt-3' : ''}`}>
          {sichtbar.map((v) => {
            const blockImPlan = imPlan.get(textSchluessel(v.text))
            const blockTitel = blockImPlan ? BLOECKE.find((b) => b.id === blockImPlan)?.titel : undefined
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 px-3 py-2">
                <div className="min-w-0 basis-full sm:flex-1">
                  <p className={`break-words text-sm ${blockImPlan ? 'text-slate-400' : 'text-slate-800'}`}>{v.text}</p>
                  <p className="text-xs text-slate-400">
                    {v.termin ? (
                      <span className={`mr-0.5 inline-block rounded px-1.5 py-px text-[11px] font-semibold ${blockImPlan ? 'bg-slate-200 text-slate-500' : 'bg-accent-100 text-accent-700'}`}>Termin</span>
                    ) : (
                      <span className="font-medium text-slate-500">{v.quelle}</span>
                    )}
                    {v.hinweis && (
                      <>
                        {v.termin ? ' ' : ' · '}
                        <span className={blockImPlan || v.termin ? '' : v.ueberfaellig ? 'font-medium text-rose-600' : v.faellig ? 'font-medium text-amber-600' : ''}>{v.hinweis}</span>
                      </>
                    )}
                  </p>
                </div>
                {blockImPlan ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600">
                    <Check size={13} /> übernommen{blockTitel ? ` · ${blockTitel}` : ''}
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${v.text} übernehmen in`}>
                    {VORSCHLAG_BLOECKE.map((b) => {
                      const titel = BLOECKE.find((x) => x.id === b.id)?.titel ?? b.kurz
                      const vorgeschlagen = b.id === v.block
                      return (
                        <button
                          key={b.id}
                          onClick={() => onUebernehmen([{ text: v.text, block: b.id, zeit: v.termin }])}
                          className={`min-w-9 rounded-md px-2.5 py-1.5 text-xs ${
                            vorgeschlagen ? 'bg-accent-600 font-semibold text-white hover:bg-accent-700' : 'border border-slate-200 bg-white font-medium text-slate-600 hover:bg-slate-100'
                          }`}
                          aria-label={`${v.text}: in ${titel} übernehmen${vorgeschlagen ? ' (vorgeschlagen)' : ''}`}
                          title={`In ${titel} übernehmen${vorgeschlagen ? ' (vorgeschlagen)' : ''}`}
                        >
                          {b.kurz}
                        </button>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {alle.length > VORSCHLAEGE_SICHTBAR && (
        <button onClick={() => setAlleZeigen(!alleZeigen)} className="mt-2 rounded-md px-1.5 py-1 text-xs font-medium text-accent-600 hover:bg-accent-50" aria-expanded={alleZeigen}>
          {alleZeigen ? 'weniger anzeigen' : `${alle.length - VORSCHLAEGE_SICHTBAR} weitere anzeigen`}
        </button>
      )}
    </Card>
  )
}

// ── Tagesabläufe der Kollegen ────────────────────────────────────────────────────────────────────

function KollegenTagesablaeufe({ ich, datum }: { ich: string; datum: string }) {
  const { state } = useApp()
  const plaene = useMemo(
    () => state.tagesplaene.filter((p) => p.datum === datum && p.mitarbeiter !== ich).sort((a, b) => a.mitarbeiter.localeCompare(b.mitarbeiter, 'de')),
    [state.tagesplaene, datum, ich],
  )

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Tagesabläufe der Kollegen</h3>
      {plaene.length === 0 ? (
        <p className="text-sm text-slate-400">Für den {fmtDate(datum)} hat noch kein Kollege einen Tagesablauf gespeichert.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-400">
            {plaene.length} {plaene.length === 1 ? 'Kollege hat' : 'Kollegen haben'} für den {fmtDate(datum)} einen Tagesablauf gespeichert – nur zum Lesen.
          </p>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {plaene.map((p) => (
              <KollegenKarte key={p.id} plan={p} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function KollegenKarte({ plan }: { plan: Tagesplan }) {
  const zeilen = (plan.zeilen ?? []).filter((z) => z.was.trim() !== '')
  const zahlen = kennzahlen(zeilen)
  const anrufe = (plan.anrufe ?? '').trim()

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-800">{plan.mitarbeiter}</div>
          <div className="text-xs text-slate-500">
            {[plan.ort ? `Ort: ${plan.ort}` : '', `${zahlen.erledigt} von ${zahlen.anzahl} erledigt`, zahlen.minuten > 0 ? `${fmtDauer(zahlen.minuten)} geplant` : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        {plan.aktualisiertAm && <span className="text-xs text-slate-400">gespeichert {fmtDateTime(plan.aktualisiertAm)}</span>}
      </div>

      {zeilen.length === 0 && !anrufe && <p className="text-sm text-slate-400">Noch nichts eingetragen.</p>}

      <div className="space-y-3">
        {BLOECKE.map((b) => {
          const imBlock = zeilen.filter((z) => z.block === b.id)
          if (imBlock.length === 0) return null
          return (
            <div key={b.id}>
              <div className="mb-1 text-xs font-semibold text-slate-500">{b.titel}</div>
              <ul className="space-y-1.5">
                {imBlock.map((z, i) => (
                  <li key={z.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${z.erledigt ? 'border-emerald-300 bg-emerald-50 text-emerald-600' : 'border-slate-300 text-transparent'}`}
                      role="img"
                      aria-label={z.erledigt ? 'erledigt' : 'offen'}
                    >
                      <Check size={11} />
                    </span>
                    <div className="min-w-0">
                      <div className={z.erledigt ? 'text-slate-400 line-through' : 'text-slate-800'}>
                        {b.kuerzel && <span className="mr-1 text-xs font-semibold text-slate-400">{zeilenNummer(b, i)}</span>}
                        {z.was}
                      </div>
                      {(z.dauerMin || z.bisUhr) && (
                        <div className="text-xs text-slate-400">{[z.dauerMin ? `ca. ${z.dauerMin} Min.` : '', z.bisUhr ? `bis ${z.bisUhr} Uhr` : ''].filter(Boolean).join(' · ')}</div>
                      )}
                      {z.stand && <p className="whitespace-pre-wrap text-xs text-slate-500">{z.stand}</p>}
                      {z.ergebnis && <p className="whitespace-pre-wrap text-xs text-slate-500">Gewinn/Verlust: {z.ergebnis}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
        {anrufe && (
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">Anrufe</div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{anrufe}</p>
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Wochenplan ───────────────────────────────────────────────────────────────────────────────────

function MeinWochenplan({ ich, wocheAb, onUngespeichert }: { ich: string; wocheAb: string; onUngespeichert: (ungespeichert: boolean) => void }) {
  const { state, dispatch } = useApp()
  const [gespeichertMeldung, setGespeichertMeldung] = useState(false)
  const gespeicherterPlan = state.wochenplaene.find((p) => p.mitarbeiter === ich && p.wocheAb === wocheAb)
  const { entwurf, geaendert, ueberholt, setze, uebernommen, verwerfen } = useEntwurf(gespeicherterPlan?.zellen ?? KEINE_ZELLEN, wochenKern)
  useMeldeUngespeichert(onUngespeichert, geaendert)

  function speichern() {
    const plan: Wochenplan = { id: `${ich}|${wocheAb}`, mitarbeiter: ich, wocheAb, zellen: bereinigeZellen(entwurf), aktualisiertAm: new Date().toISOString() }
    dispatch({ type: 'SPEICHERE_WOCHENPLAN', plan })
    uebernommen(entwurf)
    setGespeichertMeldung(true)
  }

  const eintraege = Object.keys(bereinigeZellen(entwurf)).length
  const leiste = <SpeicherLeiste text="Wochenplan speichern" geaendert={geaendert} gespeichert={gespeichertMeldung} aktiv={geaendert} onSpeichern={speichern} />

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Mein Wochenplan</h3>
          <p className="text-xs text-slate-400">
            {eintraege} {eintraege === 1 ? 'Eintrag' : 'Einträge'} · je Stunde ein kurzer Text
          </p>
        </div>
        {leiste}
      </div>
      {ueberholt && <UeberholtHinweis onLaden={verwerfen} />}
      <WochenRaster
        wocheAb={wocheAb}
        zellen={entwurf}
        onAendere={(schluessel, text) => {
          setze({ ...entwurf, [schluessel]: text })
          setGespeichertMeldung(false)
        }}
      />
      <div className="mt-4">{leiste}</div>
    </Card>
  )
}

function KollegenWochenplan({ name, wocheAb }: { name: string; wocheAb: string }) {
  const { state } = useApp()
  const plan = state.wochenplaene.find((p) => p.mitarbeiter === name && p.wocheAb === wocheAb)
  const zellen = plan ? bereinigeZellen(plan.zellen ?? KEINE_ZELLEN) : KEINE_ZELLEN

  if (!plan || Object.keys(zellen).length === 0) {
    return <EmptyState text={`${name} hat für die Woche vom ${fmtDate(wocheAb)} bis ${fmtDate(addDays(wocheAb, 6))} noch keinen Wochenplan gespeichert.`} />
  }
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Wochenplan von {name}</h3>
          <p className="text-xs text-slate-400">Nur zum Lesen.</p>
        </div>
        {plan.aktualisiertAm && <span className="text-xs text-slate-400">gespeichert {fmtDateTime(plan.aktualisiertAm)}</span>}
      </div>
      <WochenRaster wocheAb={wocheAb} zellen={zellen} />
    </Card>
  )
}

/** Das Stundenraster: Zeilen 09.00 bis 20.00, Spalten Montag bis Sonntag. Ohne onAendere nur zum Lesen. */
function WochenRaster({ wocheAb, zellen, onAendere }: { wocheAb: string; zellen: Record<string, string>; onAendere?: (schluessel: string, text: string) => void }) {
  const heute = today()
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-14 border border-slate-200 bg-slate-50 px-1.5 py-2 text-left text-xs font-medium text-slate-500">
              Uhrzeit
            </th>
            {WOCHENTAGE.map((tagName, tag) => {
              const datum = addDays(wocheAb, tag)
              return (
                <th key={tagName} scope="col" className={`border border-slate-200 px-1.5 py-2 text-left text-xs font-semibold ${datum === heute ? 'bg-accent-50 text-accent-700' : 'bg-slate-50 text-slate-600'}`}>
                  {tagName}
                  <span className="ml-1 font-normal text-slate-400">{fmtDate(datum).slice(0, 6)}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {STUNDEN.map((stunde) => {
            const uhrzeit = `${String(stunde).padStart(2, '0')}.00`
            return (
              <tr key={stunde}>
                <th scope="row" className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-1.5 py-1.5 text-left text-xs font-medium text-slate-500">
                  {uhrzeit}
                </th>
                {WOCHENTAGE.map((tagName, tag) => {
                  const schluessel = `${tag}-${stunde}`
                  const text = zellen[schluessel] ?? ''
                  return (
                    <td key={schluessel} className="border border-slate-200 p-0 align-top">
                      {onAendere ? (
                        <input
                          className="w-full bg-transparent px-1.5 py-1.5 text-sm text-slate-800 outline-none focus:bg-accent-50 focus:ring-2 focus:ring-inset focus:ring-accent-200"
                          value={text}
                          onChange={(e) => onAendere(schluessel, e.target.value)}
                          aria-label={`${tagName}, ${uhrzeit} Uhr`}
                          title={text || undefined}
                        />
                      ) : (
                        <div className="min-h-8 break-words px-1.5 py-1.5 text-sm text-slate-700">{text}</div>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
