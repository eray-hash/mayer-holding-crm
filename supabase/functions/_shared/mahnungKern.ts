// Zahlungserinnerung, 1. und 2. Mahnung auf dem Server (24.11.2026) — dieselben Stufen, Texte, Fristen und Gebühren wie
// der Mahn-Dialog im CRM (src/lib/rechnungPdf.ts: mahnVorlage, mahnBetraege, mahnungPdfDateiname;
// src/components/rechnungen/RechnungDialoge.tsx: MahnungModal — Mailtext, Eintrag an der Rechnung, Vermerk in der Akte).
// Genutzt vom Telegram-Werkzeug mahnung_erstellen und von followup_durchspielen (telegram-gateway/mahnungWerkzeuge.ts).
//
// Eintrag an der Rechnung genau wie das CRM: rechnungen.mahnungen bekommt { id, datum, stufe, gebuehr, neueFrist, weg,
// an, dokumentName, von } angehängt, mahnstufe = Stufe, status = „Überfällig“.
//
// Rechnung ohne Zahlungsfrist (rechnungen.ohne_zahlungsfrist, 24.11.2026): Auf der Rechnung steht kein „zahlbar bis“,
// zahlungsziel ist nur der interne Prüftag. Die Zahlungserinnerung sagt dann nicht „war am … fällig“.
// Rein: keine Datenbank, kein Netz (Tests: mahnungKern.test.ts).

import { type MahnStufe, STUFE_NAME } from './mahnVorschlagKern.ts'

export type MahnEintrag = {
  id: string
  datum: string
  stufe: string
  /** Mahngebühr in Euro (0 bei der Zahlungserinnerung). */
  gebuehr: number
  neueFrist?: string
  /** 'email' = per Mail an `an`, 'pdf' = nur als PDF (z. B. Post), 'vermerk' = Inkasso-Vermerk. */
  weg: 'email' | 'pdf' | 'vermerk'
  an?: string
  dokumentName?: string
  von?: string
}

/** Die Felder der Tabelle rechnungen, die ein Mahnschreiben braucht. */
export type MahnRechnungDaten = {
  id: string
  nummer: string
  datum: string | null
  zahlungsziel: string | null
  ohne_zahlungsfrist?: boolean | null
  status: string
  mahnstufe: string | null
  betrag_brutto: number | string
  zahlungen: { datum?: string | null; betrag?: number | string | null }[] | null
  mahnungen: Partial<MahnEintrag>[] | null
}

const NAMEN: Record<string, string> = { ...STUFE_NAME, inkasso: 'Inkasso' }

export function mahnstufeName(s: string): string {
  return NAMEN[s] ?? s
}

export function rundeCent(n: number): number {
  return Math.round(n * 100) / 100
}

export function deDatum(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso ?? '')
}

export function euro(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
}

/** Im Fließtext „EUR“ statt „€“ (wie im CRM-PDF). */
export function euroText(n: number): string {
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} EUR`
}

const liste = <T>(w: T[] | null | undefined): T[] => (Array.isArray(w) ? w : [])

export function bezahlteSumme(r: Pick<MahnRechnungDaten, 'zahlungen'>): number {
  return rundeCent(liste(r.zahlungen).reduce((s, z) => s + (Number(z?.betrag) || 0), 0))
}

export function mahngebuehren(r: Pick<MahnRechnungDaten, 'mahnungen'>): number {
  return rundeCent(liste(r.mahnungen).reduce((s, m) => s + (Number(m?.gebuehr) || 0), 0))
}

export type MahnBetraege = { brutto: number; gezahlt: number; fruehere: number; gebuehr: number; offen: number; summe: number }

/** Beträge eines Mahnschreibens: offener Rechnungsbetrag, frühere Gebühren, neue Gebühr, Summe (mahnBetraege im CRM). */
export function mahnBetraege(r: MahnRechnungDaten, gebuehr: number): MahnBetraege {
  const brutto = Number(r.betrag_brutto) || 0
  const gezahlt = bezahlteSumme(r)
  const fruehere = mahngebuehren(r)
  const offen = Math.max(0, rundeCent(brutto - gezahlt))
  const g = rundeCent(gebuehr || 0)
  return { brutto, gezahlt, fruehere, gebuehr: g, offen, summe: rundeCent(offen + fruehere + g) }
}

export type MahnVorlage = { tage: number; gebuehr: number; text: string; schluss: string }

/** Frist, Gebühr und Texte je Stufe — wörtlich wie mahnVorlage im CRM (src/lib/rechnungPdf.ts). */
export function mahnVorlage(r: MahnRechnungDaten, stufe: MahnStufe): MahnVorlage {
  const frueher = liste(r.mahnungen).filter((m) => m?.stufe && m.stufe !== 'inkasso')
  const bezug = `unsere Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)}`
  const aufzaehlung = (ms: Partial<MahnEintrag>[]) => ms.map((m) => `${mahnstufeName(String(m.stufe))} vom ${deDatum(m.datum)}`).join(', ')
  if (stufe === 'erinnerung') {
    // Ohne Zahlungsfrist stand kein Fälligkeitstag auf der Rechnung — dann auch keinen nennen.
    const faellig = r.ohne_zahlungsfrist || !r.zahlungsziel ? '' : ` Die Zahlung war am ${deDatum(r.zahlungsziel)} fällig.`
    return {
      tage: 7,
      gebuehr: 0,
      text: `sicherlich ist es Ihrer Aufmerksamkeit entgangen, dass ${bezug} noch nicht vollständig beglichen ist.${faellig}\nWir bitten Sie freundlich, den unten aufgeführten Betrag bis zum genannten Datum zu überweisen.`,
      schluss: 'Sollten Sie die Zahlung in den letzten Tagen bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Bei Fragen zur Rechnung sind wir gerne für Sie da.',
    }
  }
  if (stufe === 'mahnung1') {
    return {
      tage: 10,
      gebuehr: 5,
      text: `leider konnten wir zu unserer Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)} bis heute keinen vollständigen Zahlungseingang feststellen${frueher.length ? ` – auch nicht nach unserer ${aufzaehlung(frueher)}` : ''}.\nWir bitten Sie, den unten aufgeführten Betrag bis spätestens zum genannten Datum zu überweisen.`,
      schluss: 'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos. Falls es Gründe für die Verzögerung gibt, sprechen Sie uns gerne an – gemeinsam finden wir eine Lösung.',
    }
  }
  return {
    tage: 10,
    gebuehr: 5,
    text: `trotz unserer bisherigen Schreiben${frueher.length ? ` (${aufzaehlung(frueher)})` : ''} ist ${bezug} weiterhin nicht vollständig bezahlt.\nWir fordern Sie hiermit letztmalig auf, den unten aufgeführten Gesamtbetrag bis spätestens zum genannten Datum zu überweisen.`,
    schluss: 'Sollte der Betrag bis zu diesem Datum nicht bei uns eingegangen sein, werden wir die Forderung ohne weitere Ankündigung an ein Inkassobüro übergeben oder das gerichtliche Mahnverfahren einleiten. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.',
  }
}

export function mahnungDateiname(nummer: string, stufe: string, datum: string): string {
  return `${mahnstufeName(stufe)} zu Rechnung ${nummer.replace(/[\\/:*?"<>|]/g, '-').trim()} (${deDatum(datum)}).pdf`
}

export function mahnungBetreff(nummer: string, stufe: string): string {
  return `${mahnstufeName(stufe)} zu Rechnung ${nummer}`
}

/** Mailtext wie im CRM; {{anrede}} und Gruß setzt der Versand (mailText in index.ts). */
export function mahnungMailText(r: Pick<MahnRechnungDaten, 'nummer' | 'datum'>, stufe: string, summe: number, frist: string): string {
  return `{{anrede}},\n\nanbei erhalten Sie unsere ${mahnstufeName(stufe)} zu Rechnung Nr. ${r.nummer} vom ${deDatum(r.datum)}.\nBitte überweisen Sie den offenen Betrag von ${euro(summe)} bis spätestens ${deDatum(frist)}.\n\nSollte sich Ihre Zahlung mit dieser Nachricht überschnitten haben, betrachten Sie sie bitte als gegenstandslos.`
}

/** Vermerk in der Akte wie im CRM (MahnungModal → vermerk). */
export function mahnVermerk(nummer: string, stufe: string, weg: 'email' | 'pdf', an: string | undefined, frist: string, summe: number): string {
  return `${mahnstufeName(stufe)} zu Rechnung ${nummer} ${weg === 'email' ? `per E-Mail an ${an} gesendet` : 'als PDF erstellt'} — neue Frist ${deDatum(frist)}, offen ${euro(summe)}`
}

/** Kennung wie uid('mahn') im CRM. */
export function neueMahnId(): string {
  return `mahn_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

/** Änderung an der Rechnung nach dem Schreiben — wie das CRM: Eintrag anhängen, Stufe setzen, Status Überfällig. */
export function rechnungNachMahnung(r: Pick<MahnRechnungDaten, 'mahnungen' | 'status'>, eintrag: MahnEintrag): { mahnungen: Partial<MahnEintrag>[]; mahnstufe: string; status: string } {
  return {
    mahnungen: [...liste(r.mahnungen), eintrag],
    mahnstufe: eintrag.stufe,
    // Ist die Rechnung inzwischen bezahlt, bleibt sie bezahlt (das CRM ließe dort gar kein Schreiben mehr zu).
    status: r.status === 'Bezahlt' ? 'Bezahlt' : 'Überfällig',
  }
}

/** Stufe aus freier Angabe („Zahlungserinnerung“, „1. Mahnung“, „mahnung2“, „2“ …); null = nicht erkannt. */
export function leseStufe(w: unknown): MahnStufe | null {
  const t = String(w ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  if (/^(erinnerung|zahlungserinnerung|0)$/.test(t)) return 'erinnerung'
  if (/^(mahnung1|1|1\.mahnung|erstemahnung|1mahnung)$/.test(t)) return 'mahnung1'
  if (/^(mahnung2|2|2\.mahnung|zweitemahnung|2mahnung|letztemahnung)$/.test(t)) return 'mahnung2'
  return null
}
