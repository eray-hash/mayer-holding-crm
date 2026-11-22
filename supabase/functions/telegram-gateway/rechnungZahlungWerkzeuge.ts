// Assistent-Werkzeuge für Zahlungen auf Ausgangsrechnungen und offene Posten (Tabelle rechnungen,
// Spalten seit 21.11.2026: zahlungen, mahnungen, versendet_am, bezahlt_am …; Oberfläche:
// Rechnungen und Mahnwesen im CRM).
//
// Die Rechenregeln stammen 1:1 aus dem CRM: src/lib/rechnungen.ts (bezahlteSumme, offenerBetrag,
// vollstaendigBezahlt, aktuelleFrist, istUnbezahlt/istUeberfaellig) und dem Dialog „Zahlung erfassen“
// (ZahlungErfassenModal in src/components/rechnungen/RechnungDialoge.tsx):
//   - Zahlung wird an rechnungen.zahlungen angehängt ({ id: zahl_…, datum, betrag, notiz?, erfasstVon }).
//   - Erreichen die Zahlungen den Bruttobetrag (bis auf einen halben Cent), wird die Rechnung
//     „Bezahlt“, bezahlt_am = Datum der Zahlung, Mahnstufe weg.
//   - Sonst bleibt der Status; ein Entwurf wird „Versendet“.
//   - Vermerk im Verlauf der Akte (kunden.activities) mit demselben Text wie im CRM.
// Abweichung zum CRM: Eine Überzahlung nimmt der Assistent nur an, wenn der Mitarbeiter sie
// ausdrücklich bestätigt (ueberzahlung_bestaetigt), und nennt sie dann im Ergebnis.
//
// Rechnungen erfassen und den Status von Hand setzen machen rechnung_erfassen/rechnung_status_setzen in index.ts.
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten. Zeilenregel rechnungen:
// darf_bereich('beratung') (Rechnungen und Mahnwesen hängen am Bereich Unternehmensberatung). Dazu
// prüft diese Datei — wie rechnung_status_setzen in index.ts — die Akte der Rechnung: private Akten
// anderer gibt es nicht, Akten aus nicht freigegebenen Bereichen sind „nicht freigegeben“.

import { darfAkte, darfBereich, istFremdePrivatakte, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { deDatum, pruefeDatum } from './wiedervorlageWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type RechnungZahlungKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export type Zahlung = { id: string; datum: string; betrag: number; notiz?: string; erfasstVon?: string }
export type Mahnung = { id: string; datum: string; stufe: string; gebuehr: number; neueFrist?: string }

export type RechnungZeile = {
  id: string
  nummer: string
  kunde_id: string
  datum: string
  betrag_netto: number | string
  betrag_brutto: number | string
  status: string
  zahlungsziel: string
  mahnstufe: string | null
  zahlungen: Zahlung[] | null
  mahnungen: Mahnung[] | null
  versendet_am: string | null
  bezahlt_am: string | null
}

const RECHNUNG_SPALTEN = 'id, nummer, kunde_id, datum, betrag_netto, betrag_brutto, status, zahlungsziel, mahnstufe, zahlungen, mahnungen, versendet_am, bezahlt_am'

export const MAHNSTUFEN: Record<string, string> = { erinnerung: 'Zahlungserinnerung', mahnung1: '1. Mahnung', mahnung2: '2. Mahnung', inkasso: 'Inkasso' }

// ---------------------------------------------------------------------------------------------
// Rechenregeln (wie src/lib/rechnungen.ts)

export function rundeCent(betrag: number): number {
  return Math.round(betrag * 100) / 100
}

export function bezahlteSumme(r: Pick<RechnungZeile, 'zahlungen'>): number {
  return rundeCent((Array.isArray(r.zahlungen) ? r.zahlungen : []).reduce((s, z) => s + (Number(z.betrag) || 0), 0))
}

export function mahngebuehren(r: Pick<RechnungZeile, 'mahnungen'>): number {
  return rundeCent((Array.isArray(r.mahnungen) ? r.mahnungen : []).reduce((s, m) => s + (Number(m.gebuehr) || 0), 0))
}

/** Noch offener Rechnungsbetrag (ohne Mahngebühren); 0 bei bezahlten Rechnungen. */
export function offenerBetrag(r: Pick<RechnungZeile, 'status' | 'betrag_brutto' | 'zahlungen'>): number {
  if (r.status === 'Bezahlt') return 0
  return Math.max(0, rundeCent(Number(r.betrag_brutto) - bezahlteSumme(r)))
}

export function vollstaendigBezahlt(brutto: number, zahlungenSumme: number): boolean {
  return zahlungenSumme >= brutto - 0.005
}

export function istUnbezahlt(r: Pick<RechnungZeile, 'status'>): boolean {
  return r.status === 'Versendet' || r.status === 'Überfällig'
}

/** Gültige Frist: neue Frist aus dem letzten Mahnschreiben, sonst das Zahlungsziel. */
export function aktuelleFrist(r: Pick<RechnungZeile, 'mahnungen' | 'zahlungsziel'>): string {
  const letzte = [...(Array.isArray(r.mahnungen) ? r.mahnungen : [])].reverse().find((m) => m.neueFrist)
  return letzte?.neueFrist ?? r.zahlungsziel
}

export function istUeberfaellig(r: Pick<RechnungZeile, 'status' | 'mahnstufe' | 'zahlungsziel'>, heute: string): boolean {
  if (!istUnbezahlt(r)) return false
  return r.status === 'Überfällig' || !!r.mahnstufe || (!!r.zahlungsziel && r.zahlungsziel < heute)
}

/** Tage bis zur Frist (negativ = so viele Tage überfällig); null ohne gültiges Datum. */
export function tageBisFrist(r: Pick<RechnungZeile, 'mahnungen' | 'zahlungsziel'>, heute: string): number | null {
  const frist = aktuelleFrist(r)
  if (!frist || !/^\d{4}-\d{2}-\d{2}/.test(frist)) return null
  const a = Date.parse(`${heute}T00:00:00Z`)
  const b = Date.parse(`${frist.slice(0, 10)}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

/** Kennung wie uid() im CRM: prefix_ + 7 Zufallszeichen + 4 Zeichen Zeit. */
function neueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

export type ZahlungsErgebnis = {
  zahlung: Zahlung
  /** Die zu schreibenden Spalten der Rechnung. */
  aenderung: Record<string, unknown>
  offenVorher: number
  offenNachher: number
  vollstaendig: boolean
  /** Betrag über dem offenen Rest (0 ohne Überzahlung). */
  ueberzahlung: number
  vermerk: string
}

/**
 * Rechnet eine Zahlung ein — wie ZahlungErfassenModal.speichern im CRM. Reine Funktion ohne Datenbank.
 * Fehler als Text (bezahlte Rechnung, Betrag ≤ 0, Überzahlung ohne Bestätigung).
 */
export function berechneZahlung(
  r: Pick<RechnungZeile, 'nummer' | 'status' | 'betrag_brutto' | 'zahlungen'>,
  p: { betrag: number; datum: string; notiz?: string; von: string; ueberzahlungBestaetigt?: boolean; id?: string },
): ZahlungsErgebnis | string {
  if (r.status === 'Bezahlt') return `Fehler: Rechnung ${r.nummer} ist schon als bezahlt vermerkt. Keine Zahlung erfasst.`
  if (!Number.isFinite(p.betrag) || p.betrag <= 0) return 'Fehler: Bitte einen Betrag größer als 0 € angeben.'
  const brutto = Number(r.betrag_brutto)
  const betrag = rundeCent(p.betrag)
  const offenVorher = offenerBetrag(r)
  const nachher = rundeCent(bezahlteSumme(r) + betrag)
  const ueberzahlung = Math.max(0, rundeCent(betrag - offenVorher))
  if (ueberzahlung >= 0.01 && !p.ueberzahlungBestaetigt) {
    return `Fehler: Der Betrag ${euro(betrag)} ist höher als der noch offene Rest von ${euro(offenVorher)} (Rechnung ${r.nummer} über ${euro(brutto)}). Nichts erfasst. Frag nach, ob das stimmt — nur wenn der Mitarbeiter die Überzahlung von ${euro(ueberzahlung)} bestätigt, mit ueberzahlung_bestaetigt=true erneut aufrufen.`
  }
  const vollstaendig = vollstaendigBezahlt(brutto, nachher)
  const notiz = String(p.notiz ?? '').trim()
  const zahlung: Zahlung = { id: p.id ?? neueId('zahl'), datum: p.datum, betrag, ...(notiz ? { notiz } : {}), erfasstVon: p.von }
  const zahlungen = [...(Array.isArray(r.zahlungen) ? r.zahlungen : []), zahlung]
  const offenNachher = Math.max(0, rundeCent(brutto - nachher))
  const aenderung: Record<string, unknown> = vollstaendig
    ? { zahlungen, status: 'Bezahlt', bezahlt_am: p.datum, mahnstufe: null }
    : { zahlungen, ...(r.status === 'Entwurf' ? { status: 'Versendet' } : {}) }
  const vermerk = vollstaendig
    ? `Zahlung über ${euro(betrag)} zu Rechnung ${r.nummer} erfasst — Rechnung vollständig bezahlt`
    : `Teilzahlung über ${euro(betrag)} zu Rechnung ${r.nummer} erfasst (noch offen: ${euro(offenNachher)})`
  return { zahlung, aenderung, offenVorher, offenNachher, vollstaendig, ueberzahlung, vermerk }
}

// ---------------------------------------------------------------------------------------------
// Rechte

/** Wie die Zeilenregel darf_bereich('beratung') auf rechnungen. */
export function darfRechnungen(m: RechteMitarbeiter): boolean {
  return darfBereich(m, 'beratung')
}

type AkteKurz = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null; activities?: unknown[] | null }

function akteName(a: Pick<AkteKurz, 'firma' | 'ansprechpartner'> | undefined | null): string {
  if (!a) return 'unbekannte Akte'
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

// ---------------------------------------------------------------------------------------------
// Werkzeuge

export const RECHNUNG_ZAHLUNG_WERKZEUGE = [
  {
    name: 'rechnung_zahlung_erfassen',
    description:
      'Erfasst einen Zahlungseingang zu einer Ausgangsrechnung der Holding, auch Teilzahlungen („Kunde X hat 500 € auf RE-2026-012 überwiesen“). Rechnet wie das CRM: Ist danach alles bezahlt, steht die Rechnung auf Bezahlt (mit Datum, Mahnstufe weg); sonst nennt das Ergebnis den noch offenen Rest. Vermerk im Verlauf der Akte. Lieber als rechnung_status_setzen nehmen, sobald ein Betrag genannt wird. Ein Betrag über dem offenen Rest wird erst nach Bestätigung angenommen.',
    input_schema: {
      type: 'object',
      properties: {
        rechnung_id: { type: 'string', description: 'ID der Rechnung (aus rechnungen_offen).' },
        nummer: { type: 'string', description: 'Rechnungsnummer, wenn die id nicht bekannt ist, z. B. "RE-2026-012".' },
        betrag: { type: 'number', description: 'Gezahlter Betrag in Euro. Ohne Angabe: der gesamte offene Rest (nur wenn der Mitarbeiter „voll bezahlt“ o. ä. sagt).' },
        datum: { type: 'string', description: 'Tag des Zahlungseingangs JJJJ-MM-TT (Vorgabe: heute).' },
        notiz: { type: 'string', description: 'Optional, z. B. "Überweisung", "bar", "Verrechnung".' },
        ueberzahlung_bestaetigt: { type: 'boolean', description: 'Nur true, wenn der Mitarbeiter bestätigt hat, dass mehr als der offene Rest gezahlt wurde.' },
      },
    },
  },
  {
    name: 'rechnungen_offen',
    description:
      'Listet offene Ausgangsrechnungen (versendet, noch nicht bezahlt) mit Rechnungsbetrag, bereits gezahltem und offenem Betrag, Frist, wie lange überfällig und Mahnstufe; dazu die Summe. Für „Welche Rechnungen sind noch offen?“, „Wer ist im Verzug?“, „Was schuldet uns Kunde X noch?“. Liefert die IDs für rechnung_zahlung_erfassen.',
    input_schema: {
      type: 'object',
      properties: {
        nur_ueberfaellig: { type: 'boolean', description: 'true = nur überfällige (Frist verstrichen oder schon gemahnt).' },
        kunde_id: { type: 'string', description: 'Nur die Rechnungen dieser Akte.' },
      },
    },
  },
]

export function istRechnungZahlungWerkzeug(name: string): boolean {
  return RECHNUNG_ZAHLUNG_WERKZEUGE.some((w) => w.name === name)
}

const AKTE_SPALTEN = 'id, bereich, firma, ansprechpartner, verantwortlich_email'

// deno-lint-ignore no-explicit-any
export async function fuehreRechnungZahlungWerkzeugAus(name: string, input: any, k: RechnungZahlungKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  if (!darfRechnungen(mitarbeiter)) return nichtFreigegeben('beratung', mitarbeiter.name)

  if (name === 'rechnungen_offen') {
    const kundeId = String(input?.kunde_id ?? '').trim()
    let q = supabase.from('rechnungen').select(RECHNUNG_SPALTEN).in('status', ['Versendet', 'Überfällig'])
    if (kundeId) q = q.eq('kunde_id', kundeId)
    const { data, error } = await q.limit(2000)
    if (error) return `Fehler beim Laden: ${error.message}`
    const roh = (data ?? []) as RechnungZeile[]
    const ids = [...new Set(roh.map((r) => r.kunde_id).filter(Boolean))]
    const akten = new Map<string, AkteKurz>()
    if (ids.length) {
      const { data: a } = await supabase.from('kunden').select(AKTE_SPALTEN).in('id', ids)
      for (const z of (a ?? []) as AkteKurz[]) akten.set(z.id, z)
    }
    if (kundeId) {
      const akte = akten.get(kundeId) ?? ((await supabase.from('kunden').select(AKTE_SPALTEN).eq('id', kundeId).maybeSingle()).data as AkteKurz | null)
      if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
      if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)
    }
    // Erst nach Rechten filtern: Rechnungen zu Akten, die der Mitarbeiter nicht sehen darf, tauchen nicht auf und zählen nicht mit.
    let liste = roh.filter((r) => {
      const a = akten.get(r.kunde_id)
      return !a || darfAkte(mitarbeiter, a)
    })
    if (input?.nur_ueberfaellig === true) liste = liste.filter((r) => istUeberfaellig(r, heute))
    const art = input?.nur_ueberfaellig === true ? 'Überfällige Rechnungen' : 'Offene Rechnungen'
    const kopf = `${art}${kundeId ? ` von ${akteName(akten.get(kundeId))}` : ''} (Stand ${deDatum(heute)})`
    if (!liste.length) return `${kopf}: keine.`
    // Am längsten überfällig zuerst.
    liste.sort((a, b) => aktuelleFrist(a).localeCompare(aktuelleFrist(b)) || a.nummer.localeCompare(b.nummer))
    const summe = rundeCent(liste.reduce((s, r) => s + offenerBetrag(r), 0))
    const zeilen = liste.slice(0, 80).map((r) => {
      const brutto = Number(r.betrag_brutto)
      const gezahlt = bezahlteSumme(r)
      const t = tageBisFrist(r, heute)
      const lage = t === null ? '' : t < 0 ? `seit ${-t} ${t === -1 ? 'Tag' : 'Tagen'} überfällig` : t === 0 ? 'heute fällig' : `fällig in ${t} ${t === 1 ? 'Tag' : 'Tagen'}`
      const teile = [
        r.nummer,
        akteName(akten.get(r.kunde_id)),
        `vom ${deDatum(r.datum)}`,
        `Betrag ${euro(brutto)}`,
        gezahlt > 0 ? `gezahlt ${euro(gezahlt)}` : '',
        `offen ${euro(offenerBetrag(r))}`,
        `Frist ${deDatum(aktuelleFrist(r))}${lage ? ` (${lage})` : ''}`,
        r.mahnstufe ? `Mahnstufe: ${MAHNSTUFEN[r.mahnstufe] ?? r.mahnstufe}` : '',
        mahngebuehren(r) > 0 ? `Mahngebühren ${euro(mahngebuehren(r))}` : '',
      ].filter(Boolean)
      return `- ${teile.join(' | ')} (id=${r.id})`
    })
    return [`${kopf}: ${liste.length}, zusammen offen ${euro(summe)} (ohne Mahngebühren).`, ...zeilen, liste.length > 80 ? `… und ${liste.length - 80} weitere (im CRM unter Mahnwesen).` : '']
      .filter(Boolean).join('\n').slice(0, 16000)
  }

  if (name === 'rechnung_zahlung_erfassen') {
    const id = String(input?.rechnung_id ?? '').trim()
    const nummer = String(input?.nummer ?? '').trim()
    if (!id && !nummer) return 'Fehler: rechnung_id oder nummer angeben. Offene Rechnungen zeigt rechnungen_offen.'
    let treffer: RechnungZeile[]
    if (id) {
      const { data } = await supabase.from('rechnungen').select(RECHNUNG_SPALTEN).eq('id', id).limit(2)
      treffer = (data ?? []) as RechnungZeile[]
    } else {
      const { data } = await supabase.from('rechnungen').select(RECHNUNG_SPALTEN).eq('nummer', nummer).limit(5)
      treffer = (data ?? []) as RechnungZeile[]
      if (!treffer.length) {
        // Groß-/Kleinschreibung und Leerzeichen großzügig: offene Rechnungen durchsuchen.
        const { data: alle } = await supabase.from('rechnungen').select(RECHNUNG_SPALTEN).limit(5000)
        const n = nummer.replace(/\s+/g, '').toLowerCase()
        treffer = ((alle ?? []) as RechnungZeile[]).filter((r) => String(r.nummer).replace(/\s+/g, '').toLowerCase() === n)
      }
    }
    const keine = `Es gibt keine erfasste Rechnung ${id ? 'mit dieser id' : `mit der Nummer ${nummer}`}. Offene Rechnungen zeigt rechnungen_offen.`
    if (!treffer.length) return `Fehler: ${keine}`
    // Akten laden und nach Rechten filtern, bevor gezählt wird — fremde private Akten verraten nichts.
    const akten = new Map<string, AkteKurz>()
    const { data: a } = await supabase.from('kunden').select(`${AKTE_SPALTEN}, activities`).in('id', [...new Set(treffer.map((r) => r.kunde_id))])
    for (const z of (a ?? []) as AkteKurz[]) akten.set(z.id, z)
    const sichtbar = treffer.filter((r) => {
      const akte = akten.get(r.kunde_id)
      return !akte || !istFremdePrivatakte(mitarbeiter, akte)
    })
    if (!sichtbar.length) return `Fehler: ${keine}`
    if (sichtbar.length > 1) return `Mehrere Rechnungen mit der Nummer ${nummer} — bitte die id angeben:\n${sichtbar.map((r) => `- ${r.nummer} vom ${deDatum(r.datum)}, ${euro(Number(r.betrag_brutto))}, ${r.status} (id=${r.id})`).join('\n')}`
    const r = sichtbar[0]
    const akte = akten.get(r.kunde_id)
    if (akte && !darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)

    const datumRoh = String(input?.datum ?? '').trim()
    const datum = datumRoh ? pruefeDatum(datumRoh) : heute
    if (!datum) return 'Fehler: datum ist kein gültiges Datum (JJJJ-MM-TT).'
    if (datum > heute) return `Fehler: Der Zahlungseingang (${deDatum(datum)}) liegt in der Zukunft. Erfasst werden nur eingegangene Zahlungen.`
    const betrag = input?.betrag === undefined || input?.betrag === null || input?.betrag === '' ? offenerBetrag(r) : Number(input.betrag)
    const e = berechneZahlung(r, { betrag, datum, notiz: input?.notiz, von: mitarbeiter.name, ueberzahlungBestaetigt: input?.ueberzahlung_bestaetigt === true })
    if (typeof e === 'string') return e

    const { error } = await supabase.from('rechnungen').update(e.aenderung).eq('id', r.id)
    if (error) return `Fehler beim Speichern: ${error.message}. Keine Zahlung erfasst.`
    // Vermerk im Verlauf der Akte — wie vermerk() in aktionen.ts: vorne anfügen, letzte Aktivität heute.
    if (akte) {
      const eintrag = { id: neueId('act'), date: heute, text: e.vermerk, user: mitarbeiter.name }
      await supabase.from('kunden').update({ activities: [eintrag, ...(Array.isArray(akte.activities) ? akte.activities : [])], letzte_aktivitaet: heute }).eq('id', akte.id)
    }
    protokolliere(`${e.vermerk} (${akteName(akte)})${e.ueberzahlung > 0 ? `, Überzahlung ${euro(e.ueberzahlung)}` : ''}`)
    const teile = [
      `Erfasst: Zahlung über ${euro(e.zahlung.betrag)} am ${deDatum(datum)} zu Rechnung ${r.nummer} (${akteName(akte)}, Rechnungsbetrag ${euro(Number(r.betrag_brutto))}).`,
      e.vollstaendig ? `Die Rechnung ist damit vollständig bezahlt und steht auf Bezahlt (bezahlt am ${deDatum(datum)}).` : `Noch offen: ${euro(e.offenNachher)}.`,
      e.vollstaendig && r.mahnstufe ? `Die Mahnstufe (${MAHNSTUFEN[r.mahnstufe] ?? r.mahnstufe}) ist damit erledigt.` : '',
      e.ueberzahlung > 0 ? `Achtung: Überzahlung von ${euro(e.ueberzahlung)} — ggf. Rückzahlung oder Verrechnung klären.` : '',
      mahngebuehren(r) > 0 ? `Hinweis: Mahngebühren von ${euro(mahngebuehren(r))} sind im offenen Betrag nicht enthalten.` : '',
      `id=${r.id}`,
    ].filter(Boolean)
    return teile.join(' ')
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
