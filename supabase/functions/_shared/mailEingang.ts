// Prüfung einer neu eingegangenen Mail im gemeinsamen Postfach — gemeinsam genutzt von
// inbound-email (Weiterleitung von info@amayer-holding.com) und email-gateway/postfach.ts (direkter
// Abruf weiterer gemeinsamer Postfächer wie info@coach-es.de, seit 19.11.2026). Vorher lag alles in
// inbound-email/index.ts; der Inhalt der Funktionen ist unverändert übernommen.
import { kiAufruf } from './kiVerbrauch.ts'
import { heuteBerlin } from './heuteBerlin.ts'
// Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md)
import { eRechnungAusAnhaengen } from './eRechnung/modul.ts'
import type { ERechnungDaten } from './eRechnung/lesen.ts'

// klassifiziereRelevanz: Live-Gegenstück zu scripts/cleanup-inbox.mjs (dort nur als manueller Einmal-Lauf für den
// historischen Rückstand): klassifiziert jede neu eingehende Mail direkt beim Eingang, damit das
// Postfach nicht erneut mit Newslettern/Werbung/automatisierten Rechnungen vollläuft. Bewusst nur
// verstecken ("nicht_relevant" setzen), nie löschen — bei einer KI-Fehlklassifizierung geht dadurch
// nichts verloren, siehe Mitarbeiter-Rückfrage vom 30.10.2026. Ein Fehler beim Klassifizieren darf
// das Einsortieren der Mail selbst nicht verhindern — im Zweifel bleibt sie sichtbar ("kunde").
// `hinweis` (optional): was das CRM über den Absender weiß (siehe absenderHinweis) — ohne ihn wurden echte Mails von
// Mitarbeitern eines bestehenden Kunden als Rundmail ausgeblendet (VHS Augsburg, 16. und 20.11.2026: Teilnehmerliste,
// Kursplanung, Seminartermine — alle „nicht_relevant“).
export async function klassifiziereRelevanz(vonName: string, von: string, betreff: string, ausschnitt: string, hinweis?: string | null): Promise<'kunde' | 'nicht_relevant'> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return 'kunde'
  try {
    const res = await kiAufruf('inbound-email', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        tools: [{
          name: 'klassifiziere_email',
          description: 'Klassifiziert eine eingehende E-Mail danach, ob sie von/an einen echten (potenziellen) Kunden ist oder nicht.',
          input_schema: {
            type: 'object',
            properties: { kategorie: { type: 'string', enum: ['kunde', 'nicht_relevant'] } },
            required: ['kategorie'],
          },
        }],
        tool_choice: { type: 'tool', name: 'klassifiziere_email' },
        messages: [{
          role: 'user',
          content: `Du hilfst, den E-Mail-Posteingang einer Unternehmensberatung/Immobilien-/Finanzierungsholding (Mayer Holding, info@amayer-holding.com) sauber zu halten. Klassifiziere die folgende eingehende E-Mail:

- "kunde": Eine echte, individuell adressierte Anfrage oder Korrespondenz von/an einen bestehenden oder potenziellen Kunden/Mandanten/Interessenten (z. B. Anfrage zu Beratung, Finanzierung, Immobilien, Vertragsunterlagen, persönliche Korrespondenz zu einem konkreten Anliegen).
- "nicht_relevant": Newsletter, Werbe-/Marketing-Mails, automatisierte Rechnungen/Belege/Quittungen (z. B. PayPal, Zoom, Telefonanbieter), Spam, Lead-Marktplatz-Benachrichtigungen (z. B. bark.com), Kontoauszüge, Systembenachrichtigungen, Abo-Dienste, Vereins-/Schul-Rundmails ohne direkten Geschäftsbezug.

Im Zweifel (du bist dir nicht sicher, ob Geschäftsbezug zu einem Kunden/Interessenten besteht) wähle "kunde", damit nichts Wichtiges verloren geht.
${hinweis ? `\nHinweis aus dem CRM: ${hinweis} Persönlich geschriebene Mails zu einem konkreten Anliegen (Termine, Teilnehmerlisten, Planung, Unterlagen, Rückfragen) sind dann "kunde" — auch von Schulen, Vereinen oder Behörden. Reine Werbe-, Newsletter- und Rundmails bleiben "nicht_relevant".\n` : ''}
Von: ${vonName} <${von}>
Betreff: ${betreff}
Ausschnitt: ${ausschnitt.slice(0, 300)}`,
        }],
      }),
    })
    if (!res.ok) return 'kunde'
    const data = await res.json()
    const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    const kategorie = toolUse?.input?.kategorie
    return kategorie === 'nicht_relevant' ? 'nicht_relevant' : 'kunde'
  } catch (err) {
    console.error('Relevanz-Klassifizierung fehlgeschlagen', err)
    return 'kunde'
  }
}

// Liest eine Telefonnummer aus dem E-Mail-Text (meist in der Signatur, typischerweise am Ende der
// Mail) — dieselbe Haiku-Tool-Use-Technik wie klassifiziereRelevanz(). Nur für bereits bekannte
// Kunden relevant: bei neuen Leads übernimmt classifyNewLeads() in email-gateway dieselbe Aufgabe.
export async function extrahiereTelefonnummer(text: string): Promise<string | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey || !text.trim()) return null
  try {
    const res = await kiAufruf('inbound-email', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
        tools: [{
          name: 'telefonnummer_extrahieren',
          description: 'Extrahiert eine Telefonnummer (meist in der Signatur) aus einer E-Mail, falls vorhanden.',
          input_schema: {
            type: 'object',
            properties: { telefonnummer: { type: 'string', description: 'Telefonnummer wie im Text geschrieben, oder leerer String falls keine gefunden wurde.' } },
            required: ['telefonnummer'],
          },
        }],
        tool_choice: { type: 'tool', name: 'telefonnummer_extrahieren' },
        messages: [{
          role: 'user',
          content: `Suche in der folgenden E-Mail (meist in der Signatur am Ende) nach einer Telefonnummer der absendenden Person. Gib sie so zurück, wie sie geschrieben ist. Falls keine Telefonnummer enthalten ist, gib einen leeren String zurück.\n\n${text.slice(-2000)}`,
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    const nummer = (toolUse?.input?.telefonnummer ?? '').trim()
    return nummer || null
  } catch (err) {
    console.error('Telefonnummer-Extraktion fehlgeschlagen', err)
    return null
  }
}

/** Maskiert die Platzhalter von ilike (`%`, `_`, `\\`), damit eine Adresse nur sich selbst trifft. */
export function likeMaskiert(wert: string): string {
  return wert.replace(/[\\%_]/g, (z) => `\\${z}`)
}

// Adressen von Mitarbeitern werden nie einer Akte zugeordnet (wie ordneOffeneMailsZu in email-gateway/postfach.ts).
// deno-lint-ignore no-explicit-any
async function istMitarbeiterAdresse(supabase: any, adresse: string): Promise<boolean> {
  const { data } = await supabase.from('mitarbeiter').select('email').ilike('email', likeMaskiert(adresse)).limit(1)
  return Array.isArray(data) && data.length > 0
}

// Anbieter, bei denen viele Fremde dieselbe Domain haben — dort sagt die Domain nichts über eine Firma.
const ALLERWELTS_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'web.de', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 't-online.de', 'magenta.de', 'hotmail.com', 'hotmail.de',
  'outlook.com', 'outlook.de', 'live.com', 'live.de', 'msn.com', 'yahoo.com', 'yahoo.de', 'yahoo.it', 'icloud.com', 'me.com', 'mac.com',
  'freenet.de', 'aol.com', 'aol.de', 'mail.de', 'posteo.de', 'arcor.de', 'online.de', 'vodafone.de', 'email.de', 'protonmail.com', 'proton.me',
])

/** Was das CRM über den Absender weiß, als Satz für die Relevanz-Einordnung — oder null. Nur Mayer-Akten (keine
 *  privaten), nie Mitarbeiter. Wirft nie. */
// deno-lint-ignore no-explicit-any
export async function absenderHinweis(supabase: any, von: string): Promise<string | null> {
  try {
    const adresse = von.trim().toLowerCase()
    const domain = adresse.split('@')[1] ?? ''
    if (!domain || (await istMitarbeiterAdresse(supabase, adresse))) return null
    const name = (k: { firma?: string | null }) => String(k.firma ?? '').trim() || 'ohne Namen'
    const { data: genau } = await supabase.from('kunden').select('firma').ilike('email', likeMaskiert(adresse)).neq('bereich', 'privat').limit(3)
    if (Array.isArray(genau) && genau.length > 0) return `Der Absender ist im CRM als Kunde hinterlegt (Akte „${name(genau[0])}“).`
    if (ALLERWELTS_DOMAINS.has(domain)) return null
    const { data: gleicheDomain } = await supabase.from('kunden').select('firma').ilike('email', `%@${likeMaskiert(domain)}`).neq('bereich', 'privat').limit(3)
    if (Array.isArray(gleicheDomain) && gleicheDomain.length > 0) return `Die Absender-Domain @${domain} gehört zur Kundenakte „${name(gleicheDomain[0])}“ im CRM.`
    return null
  } catch {
    return null
  }
}

/** Relevanz einer neuen Mail des gemeinsamen Postfachs, mit dem Wissen des CRM über den Absender. Wirft nie. */
// deno-lint-ignore no-explicit-any
export async function klassifiziereEingang(supabase: any, m: { von: string; vonName: string; betreff: string; text: string }): Promise<'kunde' | 'nicht_relevant'> {
  const hinweis = await absenderHinweis(supabase, m.von)
  return klassifiziereRelevanz(m.vonName, m.von, m.betreff, m.text.slice(0, 500), hinweis)
}

// Live-Gegenstück zu scripts/auto-assign-emails.mjs (dort nur als Einmal-Lauf für den historischen
// Rückstand): ordnet eine neu eingehende Kunden-Mail automatisch zu, wenn genau ein Kunde/Mandant
// (über alle Bereiche hinweg) exakt dieselbe E-Mail-Adresse hinterlegt hat — sonst (kein Treffer
// oder mehrere Kunden teilen sich dieselbe Adresse) bleibt die Mail unzugeordnet und taucht im
// Postfach weiter zur manuellen Zuordnung auf. Ein Fehler hier darf das Einsortieren der Mail
// selbst nicht verhindern.
export async function versucheAutomatischeZuordnung(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  von: string,
  vonName: string,
  betreff: string,
  text: string,
  anhaenge: { filename: string; size: number; contentType: string; url: string }[],
  /** Zeile der schon gespeicherten Mail: wird vor dem Ergänzen der Akte beansprucht (siehe unten). */
  zeilenId: string | null = null,
): Promise<{ kundeId: string; bereich: string; kundeName: string } | null> {
  let beansprucht = false
  try {
    const adresse = von.trim().toLowerCase()
    if (!adresse.includes('@') || (await istMitarbeiterAdresse(supabase, adresse))) return null
    // Private Akten (bereich 'privat') gehören einem einzelnen Mitarbeiter — eine Mail des gemeinsamen Postfachs darf
    // dort nie landen (sonst verschwindet sie samt Anhängen für alle anderen). `_` und `%` sind in ilike Platzhalter.
    const { data: treffer, error } = await supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, telefon')
      .ilike('email', likeMaskiert(adresse))
      .neq('bereich', 'privat')
    if (error || !treffer || treffer.length !== 1) return null

    const kunde = treffer[0]
    const kundeName = `${kunde.firma} (${kunde.ansprechpartner})`
    // Erst die gespeicherte Mail beanspruchen, dann die Akte ergänzen (Nachtprüfung 23.11.2026): Seit die Mail VOR der
    // Zuordnung gespeichert wird, kann die Zuordnung im Zeitplan (ordneOffeneMailsZu in email-gateway/postfach.ts)
    // dieselbe, noch nicht zugeordnete Mail gleichzeitig zur Akte legen — Verlauf und Dokumente kämen doppelt.
    // Ist sie schon zugeordnet, ist hier nichts mehr zu tun.
    if (zeilenId) {
      const { data: geholt, error: holFehler } = await supabase
        .from('eingegangene_emails')
        .update({ zugewiesener_kunde_id: kunde.id, zugewiesener_bereich: kunde.bereich, zugewiesener_kunde_name: kundeName })
        .eq('id', zeilenId)
        .is('zugewiesener_kunde_id', null)
        .select('id')
      if (holFehler || !Array.isArray(geholt) || geholt.length === 0) return null
      beansprucht = true
    }
    // Winzige Bilder sind Logos aus der Signatur, keine Unterlagen (wie ordneMailZu in email-gateway/postfach.ts).
    const unterlagen = anhaenge.filter((a) => !(String(a.contentType ?? '').startsWith('image/') && Number(a.size ?? 0) < 15 * 1024))
    const hatAnhaenge = unterlagen.length > 0
    const heute = heuteBerlin()
    let neueDokumente = unterlagen.map((a) => ({
      id: crypto.randomUUID(),
      name: a.filename,
      typ: a.contentType,
      datum: heute,
      groesse: a.size < 1024 * 1024 ? `${Math.round(a.size / 1024)} KB` : `${(a.size / (1024 * 1024)).toFixed(1)} MB`,
      url: a.url,
    }))
    const neueActivities: Record<string, unknown>[] = [
      {
        id: crypto.randomUUID(),
        date: heute,
        text: `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName}`,
        user: 'System (automatische E-Mail-Zuordnung)',
      },
    ]

    // Stammdaten-Nachpflege: eine in der laufenden Korrespondenz erwähnte Telefonnummer wird direkt
    // übernommen (Nutzer-Entscheidung 2026-11-06: Signatur-Angaben gelten als verlässlich genug, um
    // ohne Rückfrage zu speichern), nicht nur beim allerersten Kontakt wie bei neuen Leads.
    const neueTelefonnummer = await extrahiereTelefonnummer(text)
    const telefonAktualisieren = !!neueTelefonnummer && neueTelefonnummer !== kunde.telefon
    if (telefonAktualisieren) {
      neueActivities.unshift({
        id: crypto.randomUUID(),
        date: heute,
        text: `Telefonnummer automatisch aus E-Mail-Signatur übernommen: ${neueTelefonnummer}`,
        user: 'System (automatische E-Mail-Zuordnung)',
      })
    }

    // Dokumente und Verlauf erst JETZT lesen (nach dem KI-Aufruf oben): Mit den Listen vom Anfang würde eine in der
    // Zwischenzeit im Browser gespeicherte Änderung der Akte überschrieben.
    const { data: frisch, error: frischFehler } = await supabase.from('kunden').select('dokumente, activities').eq('id', kunde.id).maybeSingle()
    if (frischFehler || !frisch) throw new Error(`Akte nicht lesbar: ${frischFehler?.message ?? 'nicht gefunden'}`)
    // Was schon in der Akte liegt (gleiche Adresse), nicht noch einmal ablegen — wie ordneMailZu in postfach.ts.
    const vorhanden = new Set(((frisch.dokumente as { url?: string }[] | null) ?? []).map((d) => d?.url).filter(Boolean))
    neueDokumente = neueDokumente.filter((d) => !vorhanden.has(d.url))
    if (hatAnhaenge && neueDokumente.length > 0) {
      neueActivities[neueActivities.length - 1].text = `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName} (${neueDokumente.length} Anhang/Anhänge in Dokumente abgelegt)`
    }
    const { error: updateError } = await supabase
      .from('kunden')
      .update({
        ...(telefonAktualisieren ? { telefon: neueTelefonnummer } : {}),
        dokumente: [...neueDokumente, ...((frisch.dokumente as unknown[]) ?? [])],
        activities: [...neueActivities, ...((frisch.activities as unknown[]) ?? [])],
      })
      .eq('id', kunde.id)
    if (updateError) throw new Error(`Kunde-Update: ${updateError.message}`)
    return { kundeId: kunde.id, bereich: kunde.bereich, kundeName }
  } catch (err) {
    console.error('Automatische Zuordnung fehlgeschlagen', err)
    // Beanspruchung zurücknehmen: Die Mail bleibt unzugeordnet und taucht im Postfach (und im Zeitplan) wieder auf.
    if (beansprucht && zeilenId) {
      await Promise.resolve(
        supabase.from('eingegangene_emails').update({ zugewiesener_kunde_id: null, zugewiesener_bereich: null, zugewiesener_kunde_name: null }).eq('id', zeilenId),
      ).catch(() => undefined)
    }
    return null
  }
}

// Erkennt eingehende Lieferanten-/Kostenrechnungen (Geld, das Mayer Holding selbst schuldet) und
// legt sie als "Verbindlichkeit" an — unabhängig von klassifiziereRelevanz oben, die solche Mails
// bewusst als "nicht_relevant" einstuft (und damit im Posteingang ausblendet/beim Aufräumen
// gelöscht werden könnten, siehe scripts/cleanup-inbox.mjs). Ohne PDF-Text-Extraktion kann nur
// erkannt/extrahiert werden, was im Mailtext selbst steht (Betreff/Anschreiben) — bei reinen
// PDF-Anhängen ohne Angaben im Text bleiben Felder leer und müssen manuell nachgetragen werden
// (2026-11-06, bekannte Grenze, kein stilles Falsch-Erkennen).
export async function erkenneEingehendeVerbindlichkeit(
  vonName: string,
  von: string,
  betreff: string,
  text: string,
  anhaenge: { filename: string }[],
): Promise<{ istRechnung: boolean; rechnungsnummer?: string; betragNetto?: number; betragBrutto?: number; zahlungsziel?: string } | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return null
  try {
    const res = await kiAufruf('inbound-email', 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        tools: [{
          name: 'erkenne_rechnung',
          description: 'Erkennt, ob eine eingehende E-Mail eine Rechnung ist, die der Empfänger (Mayer Holding) selbst bezahlen muss, und extrahiert vorhandene Angaben.',
          input_schema: {
            type: 'object',
            properties: {
              ist_rechnung: { type: 'boolean', description: 'true nur, wenn dies eine Rechnung/Kostennote an Mayer Holding ist (Lieferant/Dienstleister verlangt Zahlung)' },
              rechnungsnummer: { type: 'string', description: 'Falls im Text genannt, sonst weglassen' },
              betrag_netto: { type: 'number', description: 'Nettobetrag in Euro, falls im Text genannt, sonst weglassen' },
              betrag_brutto: { type: 'number', description: 'Bruttobetrag/Gesamtbetrag in Euro, falls im Text genannt, sonst weglassen' },
              zahlungsziel: { type: 'string', description: 'Fälligkeitsdatum im Format YYYY-MM-DD, falls im Text genannt, sonst weglassen' },
            },
            required: ['ist_rechnung'],
          },
        }],
        tool_choice: { type: 'tool', name: 'erkenne_rechnung' },
        messages: [{
          role: 'user',
          content: `Prüfe, ob diese eingehende E-Mail an info@amayer-holding.com (Mayer Holding, Unternehmensberatung) eine Rechnung ist, die Mayer Holding selbst an einen Lieferanten/Dienstleister bezahlen muss — NICHT eine Rechnung, die Mayer Holding an einen eigenen Kunden stellt. Typische Beispiele: Hosting-/Software-Rechnungen, Bürobedarf, Energieversorger, Handwerker, Freelancer-Honorare. Extrahiere nur Angaben, die wirklich im Text stehen — nichts raten oder schätzen.

Von: ${vonName} <${von}>
Betreff: ${betreff}
Anhänge: ${anhaenge.map((a) => a.filename).join(', ') || 'keine'}
Text: ${text.slice(0, 1500)}`,
        }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const toolUse = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    const input = toolUse?.input
    if (!input?.ist_rechnung) return { istRechnung: false }
    return {
      istRechnung: true,
      rechnungsnummer: input.rechnungsnummer || undefined,
      betragNetto: typeof input.betrag_netto === 'number' ? input.betrag_netto : undefined,
      betragBrutto: typeof input.betrag_brutto === 'number' ? input.betrag_brutto : undefined,
      zahlungsziel: input.zahlungsziel || undefined,
    }
  } catch (err) {
    console.error('Verbindlichkeits-Erkennung fehlgeschlagen', err)
    return null
  }
}

type ErkannteVerbindlichkeit = { istRechnung: boolean; lieferant?: string; datum?: string; rechnungsnummer?: string; betragNetto?: number; betragBrutto?: number; zahlungsziel?: string }

// Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md)
/** Angaben einer angehängten E-Rechnung als Lieferantenrechnung — null bei Gutschriften und bei eigenen Rechnungen der
 *  Mayer Holding (z. B. Kopie einer ausgehenden Rechnung); dann entscheidet wie bisher die KI. Beträge nur in Euro. */
export function verbindlichkeitAusERechnung(d: ERechnungDaten): ErkannteVerbindlichkeit | null {
  const verkaeufer = `${d.verkaeufer?.name ?? ''} ${d.verkaeufer?.email ?? ''}`
  if (d.art !== 'Rechnung' || /mayer[\s-]*holding|amayer/i.test(verkaeufer)) return null
  const euro = /^(eur)?$/i.test(String(d.waehrung ?? '').trim())
  const datum = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined)
  return {
    istRechnung: true,
    lieferant: d.verkaeufer?.name?.trim() || undefined,
    datum: datum(d.datum),
    rechnungsnummer: d.nummer?.trim() || undefined,
    betragNetto: euro && d.netto > 0 ? d.netto : undefined,
    betragBrutto: euro && d.brutto > 0 ? d.brutto : undefined,
    zahlungsziel: datum(d.faellig),
  }
}

export type MailPruefung = {
  relevanz: 'kunde' | 'nicht_relevant'
  zuordnung: { kundeId: string; bereich: string; kundeName: string } | null
}

/** Alles, was eine neue Mail im gemeinsamen Postfach durchläuft: Relevanz (Newsletter/Werbung
 *  ausblenden), automatische Zuordnung zur Akte bei eindeutiger Absenderadresse, und Lieferanten-
 *  rechnungen als Verbindlichkeit. Wirft nie. */
// deno-lint-ignore no-explicit-any
export async function pruefeNeueMail(supabase: any, m: NeueMail): Promise<MailPruefung> {
  const relevanz = await klassifiziereEingang(supabase, m)
  const zuordnung = await nachDemSpeichern(supabase, null, m, relevanz)
  return { relevanz, zuordnung }
}

export type NeueMail = { messageId: string; von: string; vonName: string; betreff: string; text: string; anhaenge: { filename: string; size: number; contentType: string; url: string }[] }

/** Zweiter Teil der Prüfung, ERST NACHDEM die Mail gespeichert ist (`zeilenId` = ihre Zeile; null = nicht
 *  nachtragen): Zuordnung zur Akte (nur relevanz 'kunde') und Lieferantenrechnung als Verbindlichkeit. So läuft beides
 *  genau einmal je Mail — vorher lief es vor dem Speichern, und eine zweite Zustellung derselben Mail (Weiterleitungs-
 *  dienst wiederholt bei langsamer Antwort, Postfach-Abruf holt dieselbe große Mail) legte Verlauf, Dokumente und
 *  Verbindlichkeit doppelt an. Wirft nie. */
// deno-lint-ignore no-explicit-any
export async function nachDemSpeichern(supabase: any, zeilenId: string | null, m: NeueMail, relevanz: 'kunde' | 'nicht_relevant'): Promise<MailPruefung['zuordnung']> {
  // Mit zeilenId trägt versucheAutomatischeZuordnung die Zuordnung selbst an der Mail ein (beansprucht sie vorher).
  const zuordnung = relevanz === 'kunde' ? await versucheAutomatischeZuordnung(supabase, m.von, m.vonName, m.betreff, m.text, m.anhaenge, zeilenId) : null
  // Läuft bewusst unabhängig von relevanz — eine Lieferantenrechnung ist für den Posteingang
  // "nicht_relevant", für die Buchhaltung aber hochrelevant.
  // Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md): Hängt eine lesbare E-Rechnung an, ist die Mail
  // eine Lieferantenrechnung, auch wenn der Mailtext das nicht hergibt — Angaben genau aus der Datei, ohne KI. Modul aus,
  // keine oder unlesbare E-Rechnung: wie bisher. Den Beleg legt später belegErgaenzen.ts (email-gateway) ab.
  const eRechnung = await eRechnungAusAnhaengen(supabase, m.anhaenge)
  const ausERechnung = eRechnung ? verbindlichkeitAusERechnung(eRechnung.daten) : null
  const verbindlichkeit: ErkannteVerbindlichkeit | null = ausERechnung ?? (await erkenneEingehendeVerbindlichkeit(m.vonName, m.von, m.betreff, m.text, m.anhaenge))
  if (verbindlichkeit?.istRechnung) {
    const { error } = await supabase.from('verbindlichkeiten').insert({
      id: crypto.randomUUID(),
      lieferant: verbindlichkeit.lieferant || m.vonName,
      lieferant_email: m.von,
      rechnungsnummer: verbindlichkeit.rechnungsnummer ?? null,
      datum: verbindlichkeit.datum ?? heuteBerlin(),
      betrag_netto: verbindlichkeit.betragNetto ?? null,
      betrag_brutto: verbindlichkeit.betragBrutto ?? null,
      zahlungsziel: verbindlichkeit.zahlungsziel ?? null,
      status: 'offen',
      quelle: 'email-automatisch',
      quell_email_id: m.messageId,
    })
    if (error) console.error('Verbindlichkeit anlegen fehlgeschlagen', error)
  }
  return zuordnung
}
