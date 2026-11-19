// Prüfung einer neu eingegangenen Mail im gemeinsamen Postfach — gemeinsam genutzt von
// inbound-email (Weiterleitung von info@amayer-holding.com) und email-gateway/postfach.ts (direkter
// Abruf weiterer gemeinsamer Postfächer wie info@coach-es.de, seit 19.11.2026). Vorher lag alles in
// inbound-email/index.ts; der Inhalt der Funktionen ist unverändert übernommen.
import { kiAufruf } from './kiVerbrauch.ts'

// klassifiziereRelevanz: Live-Gegenstück zu scripts/cleanup-inbox.mjs (dort nur als manueller Einmal-Lauf für den
// historischen Rückstand): klassifiziert jede neu eingehende Mail direkt beim Eingang, damit das
// Postfach nicht erneut mit Newslettern/Werbung/automatisierten Rechnungen vollläuft. Bewusst nur
// verstecken ("nicht_relevant" setzen), nie löschen — bei einer KI-Fehlklassifizierung geht dadurch
// nichts verloren, siehe Mitarbeiter-Rückfrage vom 30.10.2026. Ein Fehler beim Klassifizieren darf
// das Einsortieren der Mail selbst nicht verhindern — im Zweifel bleibt sie sichtbar ("kunde").
export async function klassifiziereRelevanz(vonName: string, von: string, betreff: string, ausschnitt: string): Promise<'kunde' | 'nicht_relevant'> {
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
): Promise<{ kundeId: string; bereich: string; kundeName: string } | null> {
  try {
    const { data: treffer, error } = await supabase
      .from('kunden')
      .select('id, bereich, firma, ansprechpartner, telefon, dokumente, activities')
      .ilike('email', von.trim())
    if (error || !treffer || treffer.length !== 1) return null

    const kunde = treffer[0]
    const hatAnhaenge = anhaenge.length > 0
    const heute = new Date().toISOString().slice(0, 10)
    const neueDokumente = anhaenge.map((a) => ({
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
        text: hatAnhaenge
          ? `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName} (${anhaenge.length} Anhang/Anhänge in Dokumente abgelegt)`
          : `E-Mail automatisch zugeordnet: „${betreff}" von ${vonName}`,
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

    const { error: updateError } = await supabase
      .from('kunden')
      .update({
        ...(telefonAktualisieren ? { telefon: neueTelefonnummer } : {}),
        dokumente: [...neueDokumente, ...((kunde.dokumente as unknown[]) ?? [])],
        activities: [...neueActivities, ...((kunde.activities as unknown[]) ?? [])],
      })
      .eq('id', kunde.id)
    if (updateError) {
      console.error('Automatische Zuordnung fehlgeschlagen (Kunde-Update)', updateError)
      return null
    }
    return { kundeId: kunde.id, bereich: kunde.bereich, kundeName: `${kunde.firma} (${kunde.ansprechpartner})` }
  } catch (err) {
    console.error('Automatische Zuordnung fehlgeschlagen', err)
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

export type MailPruefung = {
  relevanz: 'kunde' | 'nicht_relevant'
  zuordnung: { kundeId: string; bereich: string; kundeName: string } | null
}

/** Alles, was eine neue Mail im gemeinsamen Postfach durchläuft: Relevanz (Newsletter/Werbung
 *  ausblenden), automatische Zuordnung zur Akte bei eindeutiger Absenderadresse, und Lieferanten-
 *  rechnungen als Verbindlichkeit. Wirft nie. */
// deno-lint-ignore no-explicit-any
export async function pruefeNeueMail(supabase: any, m: { messageId: string; von: string; vonName: string; betreff: string; text: string; anhaenge: { filename: string; size: number; contentType: string; url: string }[] }): Promise<MailPruefung> {
  const relevanz = await klassifiziereRelevanz(m.vonName, m.von, m.betreff, m.text.slice(0, 500))
  const zuordnung = relevanz === 'kunde' ? await versucheAutomatischeZuordnung(supabase, m.von, m.vonName, m.betreff, m.text, m.anhaenge) : null
  // Läuft bewusst unabhängig von relevanz — eine Lieferantenrechnung ist für den Posteingang
  // "nicht_relevant", für die Buchhaltung aber hochrelevant.
  const verbindlichkeit = await erkenneEingehendeVerbindlichkeit(m.vonName, m.von, m.betreff, m.text, m.anhaenge)
  if (verbindlichkeit?.istRechnung) {
    const { error } = await supabase.from('verbindlichkeiten').insert({
      id: crypto.randomUUID(),
      lieferant: m.vonName,
      lieferant_email: m.von,
      rechnungsnummer: verbindlichkeit.rechnungsnummer ?? null,
      datum: new Date().toISOString().slice(0, 10),
      betrag_netto: verbindlichkeit.betragNetto ?? null,
      betrag_brutto: verbindlichkeit.betragBrutto ?? null,
      zahlungsziel: verbindlichkeit.zahlungsziel ?? null,
      status: 'offen',
      quelle: 'email-automatisch',
      quell_email_id: m.messageId,
    })
    if (error) console.error('Verbindlichkeit anlegen fehlgeschlagen', error)
  }
  return { relevanz, zuordnung }
}
