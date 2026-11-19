// Sensible Unterlagen nicht in Telegram liegen lassen (19.11.2026, Datenschutz-Unterlagen: mit
// Telegram besteht kein Auftragsverarbeitungsvertrag). Schickt ein Mitarbeiter per Telegram einen
// Ausweis, Kontoauszug, Steuerbescheid, Gesundheitsunterlagen oder einen Vertrag, wird die Datei wie
// gewohnt gespeichert und abgelegt — danach löscht der Assistent die Nachricht aus dem Chat und sagt
// kurz Bescheid. Gelöscht wird nur, was nachweislich gespeichert ist; Sprachnachrichten, Audio und
// Videos nie. Keine eigene KI: Grundlage ist die Unterlagenart, die die Dokument-Erkennung ohnehin
// liefert (classify_kunden_dokument / split_scan_dokument), sonst Dateiname und Bildunterschrift.

const REGELN: [RegExp, string][] = [
  [/personalausweis|\bausweis|reisepass|\bpass(kopie)?\b|aufenthalts(titel|erlaubnis|karte|genehmigung)|f(ue|u)hrerschein|id[- ]?karte|identity card/, 'Ausweis'],
  [/kontoausz|konto[- ]?auszug|bankauszug|umsatzliste|kontouebersicht|kontoumsaetze/, 'Kontoauszug'],
  [/gehalts(nachweis|abrechnung|bescheinigung)|lohn(abrechnung|nachweis|zettel|steuerbescheinigung)|verdienst(bescheinigung|nachweis|abrechnung)|entgelt(abrechnung|nachweis)|bezuegemitteilung|rentenbescheid/, 'Gehalts- oder Lohnnachweis'],
  [/steuer(bescheid|erklaerung|erkl)|einkommen(s)?steuer|einkommensteuerbescheid|elster/, 'Steuerunterlage'],
  [/schufa|selbstauskunft|bonitaetsauskunft/, 'Bonitätsunterlage'],
  [/attest|befund|diagnose|krankmeldung|arbeitsunfaehigkeit|arztbrief|aerztlich|krankenkasse|krankenhaus|pflegegrad|schwerbehindert|gesundheits/, 'Gesundheitsunterlage'],
  [/vollmacht/, 'Vollmacht'],
  [/vertrag|vereinbarung|unterschrieben|unterzeichnet/, 'Vertrag'],
]
// Was einen Vertrag NICHT sensibel macht: Entwürfe und leere Vorlagen.
const KEIN_VERTRAG = /entwurf|muster|vorlage|blanko|leer\b/

function einfach(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[_\-.]+/g, ' ')
}

/** Unterlagenart, wenn einer der Texte auf eine sensible Unterlage deutet — sonst null. */
export function sensibleArt(texte: (string | null | undefined)[]): string | null {
  for (const roh of texte) {
    const t = einfach(String(roh ?? ''))
    if (!t.trim()) continue
    for (const [muster, art] of REGELN) {
      if (!muster.test(t)) continue
      if (art === 'Vertrag' && KEIN_VERTRAG.test(t)) continue
      return art
    }
  }
  return null
}

/** Die Unterlagenarten aus dem Ergebnistext eines Datei-Eingangs („Art: …", „Kategorie: …"). */
export function erkannteArten(eingang: string): string[] {
  return [...eingang.matchAll(/(?:Art|Kategorie): ([^|,\n]+)/g)].map((m) => m[1].trim())
}

/**
 * Entscheidet für einen Telegram-Datei-Eingang, ob die Nachricht aus dem Chat gelöscht werden soll.
 * Voraussetzung: Die Datei ist gespeichert (`pfad=` im Ergebnis) und ist kein Ton/Video.
 * Zuerst zählt die erkannte Unterlagenart; nur wenn es keine gibt, Dateiname und Bildunterschrift.
 */
export function sensiblerEingang(eingang: string, datei: { dateiname: string; caption: string; contentType: string }): string | null {
  if (!/pfad=/.test(eingang)) return null
  if (/^(audio|video)\//.test(datei.contentType)) return null
  const arten = erkannteArten(eingang)
  const ausArt = sensibleArt(arten)
  if (ausArt) return ausArt
  // Eine erkannte, unbedenkliche Art (z. B. „Exposé", „BWA") geht vor dem Dateinamen — aber die
  // Bildunterschrift des Mitarbeiters („Ausweis von Herrn X") zählt trotzdem.
  if (arten.length > 0) return sensibleArt([datei.caption])
  return sensibleArt([datei.dateiname, datei.caption])
}

export function sensibelHinweis(art: string): string {
  return `Hinweis: Das war ein sensibles Dokument (${art}). Ich habe es im CRM abgelegt und aus diesem Chat gelöscht. Solche Unterlagen bitte künftig direkt im CRM hochladen.`
}

/** Löscht eine eingegangene Nachricht im privaten Chat (geht bis 48 Stunden nach dem Senden). */
export async function loescheTelegramNachricht(token: string | undefined, chatId: number | string, messageId: number | undefined): Promise<boolean> {
  if (!token || !messageId) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    })
    const daten = await res.json().catch(() => ({}))
    if (!res.ok || daten?.ok !== true) {
      console.error('Telegram-Nachricht konnte nicht gelöscht werden:', res.status, daten?.description ?? '')
      return false
    }
    return true
  } catch (err) {
    console.error('Telegram-Nachricht konnte nicht gelöscht werden:', err instanceof Error ? err.message : err)
    return false
  }
}
