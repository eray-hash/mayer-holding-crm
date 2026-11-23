// Assistent-Werkzeug „Kurzprüfung per Telegram ausfüllen“ (Runde 6, 23.11.2026).
//
// Anlass: Bei 0 von 42 Objekten war die Vorab-Kurzprüfung ausgefüllt — sie ging nur im Browser (Objektakte →
// Kurzprüfung, src/components/ObjektKurzpruefungBlatt.tsx). Jetzt fragt der Assistent die Punkte der Reihe nach ab:
//   1. kurzpruefung_ausfuellen mit objekt_id → Stand und der nächste offene Punkt (die Frage dazu).
//   2. Der Mitarbeiter antwortet (Text oder Sprache), der Assistent ruft das Werkzeug mit `antworten` auf → speichert
//      und nennt den nächsten offenen Punkt. Mehrere Punkte auf einmal gehen auch.
// Gespeichert wird in objekte.kurzpruefung im selben Format wie im Browser (Kern _shared/kurzpruefungKern.ts, auch
// die Zeilen kommen von dort). Vor dem Schreiben wird die Spalte frisch gelesen, damit nichts aus einem offenen
// Browserfenster verloren geht; geschrieben werden nur kurzpruefung und ein Verlaufseintrag (activities).
//
// Dazu: Wochenhinweis montags an die Verantwortlichen der Akquise-Objekte ohne Kurzprüfung
// (email-gateway/kurzpruefungHinweis.ts); mit wochenhinweis=true/false schaltet der Mitarbeiter ihn für sich an/aus.
// Rechte über rechte.ts: Objekte der Holding nur mit Immobilien-Rechten, private Objekte nur ihr Besitzer.

import { istBegonnen, offenePunkte, type Eingabe, PUNKTE, punktInhalt, standText, trageEin, vervollstaendige } from '../_shared/kurzpruefungKern.ts'
import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { adresse, darfObjekt, darfObjekte, istEigene, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type KurzpruefungKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const HINWEIS_TABELLE = 'assistent_hinweise'

export const KURZPRUEFUNG_WERKZEUGE = [
  {
    name: 'kurzpruefung_ausfuellen',
    description:
      'Füllt die Vorab-Kurzprüfung eines Objekts (Objektakte → Kurzprüfung im CRM) Schritt für Schritt per Chat aus und speichert sie genau wie im Browser. ' +
      'Ohne antworten: zeigt Stand und den nächsten offenen Punkt — stell dem Mitarbeiter genau diese Frage. Mit antworten: trägt seine Antworten ein und nennt den nächsten Punkt. ' +
      'Punkte (in dieser Reihenfolge): Tabellenzeilen preis, preisProQm, lageMikro, lageMakro, baujahr, zustand, sanierung, mieteProQm, vermietungsstand, rendite, kaufpreisfaktor, vermarktbarkeit, sonstiges, investorensicht (je ist / marktwert / ergebnis); ' +
      'danach provisionProzent, provisionBetrag, verkaeuferBekannt, direktesMandat, offeneFragen, gruendeDagegen, gruendeDafuer (Listen, bis 4), prio (A/B/C), prioBegruendung, zeiterfordernis, naechsteSchritte (Liste, bis 4). ' +
      'Weiß er einen Punkt nicht, trag "–" ein (gilt als beantwortet). Ohne objekt_id: Liste der Akquise-Objekte ohne Kurzprüfung. Mit wochenhinweis=true/false schaltet er den Montags-Hinweis dazu an oder ab.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Das Objekt (ID aus objekte_suchen).' },
        antworten: {
          type: 'array',
          description: 'Antworten des Mitarbeiters. Tabellenzeile: {punkt, ist, marktwert, ergebnis} (nur genannte Spalten). Textfeld oder prio: {punkt, wert}. Liste: {punkt, liste: [..]}.',
          items: {
            type: 'object',
            properties: {
              punkt: { type: 'string' },
              ist: { type: 'string' },
              marktwert: { type: 'string' },
              ergebnis: { type: 'string' },
              wert: { type: 'string' },
              liste: { type: 'array', items: { type: 'string' } },
            },
            required: ['punkt'],
          },
        },
        listen_ersetzen: { type: 'boolean', description: 'true = Listen (Gründe, nächste Schritte) ersetzen statt ergänzen.' },
        wer: { type: 'string', description: 'Für die Liste ohne objekt_id: "ich" (Vorgabe), Name eines Kollegen oder "alle".' },
        wochenhinweis: { type: 'boolean', description: 'Nur wenn der Mitarbeiter es ausdrücklich will: true = Montags-Hinweis an, false = aus.' },
      },
    },
  },
]

export function istKurzpruefungWerkzeug(name: string): boolean {
  return KURZPRUEFUNG_WERKZEUGE.some((w) => w.name === name)
}

const SPALTEN = 'id, bezeichnung, status, kaufpreis, kurzpruefung, activities, verantwortlich, privat_besitzer'

async function setzeWochenhinweis(k: KurzpruefungKontext, an: boolean): Promise<string> {
  const email = adresse(k.mitarbeiter.email)
  if (!email) return 'Fehler: Zu deinem Zugang ist keine E-Mail-Adresse hinterlegt.'
  const { error } = await k.supabase.from(HINWEIS_TABELLE).upsert({ email, kurzpruefung_hinweis: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
  if (error) return `Fehler beim Speichern: ${error.message}`
  k.protokolliere(`Wochenhinweis Kurzprüfung ${an ? 'eingeschaltet' : 'ausgeschaltet'}`)
  return an
    ? 'Wochenhinweis Kurzprüfung ist für dich an: montags vormittags eine kurze Liste deiner Akquise-Objekte ohne Kurzprüfung (sobald die Geschäftsführung den Hinweis freigegeben hat).'
    : 'Wochenhinweis Kurzprüfung ist für dich aus. Wieder einschalten: „Wochenhinweis Kurzprüfung an“.'
}

function naechsterText(kp: ReturnType<typeof vervollstaendige>): string {
  const offen = offenePunkte(kp)
  if (!offen.length) return 'Alle Punkte sind ausgefüllt — die Kurzprüfung ist vollständig.'
  const p = offen[0]
  return `Nächster Punkt (${p.id}): ${p.frage}${offen.length > 1 ? ` Danach noch ${offen.length - 1} Punkt(e).` : ''}`
}

// deno-lint-ignore no-explicit-any
export async function fuehreKurzpruefungWerkzeugAus(name: string, input: any, k: KurzpruefungKontext): Promise<string> {
  if (name !== 'kurzpruefung_ausfuellen') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const teile: string[] = []

  if (typeof input?.wochenhinweis === 'boolean') {
    const t = await setzeWochenhinweis(k, input.wochenhinweis)
    if (t.startsWith('Fehler')) return t
    teile.push(t)
    if (!input?.objekt_id && !input?.wer) return t
  }

  const objektId = String(input?.objekt_id ?? '').trim()

  // ---- Liste: Akquise-Objekte ohne Kurzprüfung ----
  if (!objektId) {
    const { data, error } = await supabase.from('objekte').select(SPALTEN).eq('status', 'akquise').limit(2000)
    if (error) return `Fehler beim Laden: ${error.message}`
    // deno-lint-ignore no-explicit-any
    let objekte = ((data ?? []) as any[]).filter((o) => darfObjekt(mitarbeiter, o))
    if (objekte.length === 0 && mitarbeiter.nurPrivat !== true && !darfObjekte(mitarbeiter)) return nichtFreigegeben('immobilien', mitarbeiter.name)
    const gefragt = String(input?.wer ?? '').trim()
    const alle = /^(alle|alles|jeder|team)$/i.test(gefragt)
    const ich = !gefragt || /^(ich|mir|mich|meine?|selbst)$/i.test(gefragt)
    let werText = 'alle Akquise-Objekte, die du sehen darfst'
    if (!alle) {
      const { data: team } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
      const namen = personenNamen(((team ?? []) as { name: string }[]).map((t) => t.name).filter(Boolean))
      const personen = ich ? [mitarbeiter.name] : ordneZu(gefragt, namen).personen
      if (!personen.length) return `Fehler: „${gefragt}“ passt zu keinem Mitarbeiter eindeutig. Nenne den vollen Namen oder "alle".`
      objekte = objekte.filter((o) => {
        if (ich && adresse(o.privat_besitzer) && istEigene(mitarbeiter, o.privat_besitzer)) return true
        const zustaendig = ordneZu(o.verantwortlich, namen).personen
        return personen.some((p) => zustaendig.includes(p) || String(o.verantwortlich ?? '').trim().toLowerCase() === p.toLowerCase())
      })
      werText = ich ? 'deine Akquise-Objekte' : `Akquise-Objekte von ${personen.join(', ')}`
    }
    const ohne = objekte.filter((o) => !istBegonnen(o.kurzpruefung)).sort((a, b) => String(a.bezeichnung ?? '').localeCompare(String(b.bezeichnung ?? ''), 'de'))
    const angefangen = objekte.filter((o) => istBegonnen(o.kurzpruefung) && offenePunkte(vervollstaendige(o.kurzpruefung, o.kaufpreis, heute)).length > 0)
    teile.push(
      [
        `Kurzprüfung, ${werText}: ${ohne.length} ohne Kurzprüfung, ${angefangen.length} angefangen, ${objekte.length - ohne.length - angefangen.length} vollständig.`,
        ...angefangen.slice(0, 10).map((o) => `- angefangen: ${o.bezeichnung || o.id} (objekt_id=${o.id}) · ${standText(vervollstaendige(o.kurzpruefung, o.kaufpreis, heute))}`),
        ...ohne.slice(0, 30).map((o) => `- ohne: ${o.bezeichnung || o.id} (objekt_id=${o.id})`),
        ohne.length > 30 ? `… und ${ohne.length - 30} weitere ohne Kurzprüfung.` : '',
        'Zum Ausfüllen: kurzpruefung_ausfuellen mit objekt_id.',
      ].filter(Boolean).join('\n'),
    )
    return teile.join('\n\n').slice(0, 16000)
  }

  // ---- Ein Objekt ----
  const { data: o, error } = await supabase.from('objekte').select(SPALTEN).eq('id', objektId).maybeSingle()
  if (error) return `Fehler beim Laden: ${error.message}`
  if (!o || istUnsichtbaresObjekt(mitarbeiter, o)) return 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
  if (!darfObjekt(mitarbeiter, o)) return nichtFreigegeben('immobilien', mitarbeiter.name)
  const name_ = String(o.bezeichnung || o.id)
  const antworten: Eingabe[] = Array.isArray(input?.antworten) ? input.antworten.filter((a: unknown) => a && typeof a === 'object') : []

  if (antworten.length === 0) {
    const kp = vervollstaendige(o.kurzpruefung, o.kaufpreis, heute)
    const fertig = PUNKTE.filter((p) => !offenePunkte(kp).includes(p))
    teile.push(
      [
        `Kurzprüfung ${name_} (objekt_id=${o.id}): ${o.kurzpruefung ? standText(kp) : 'noch nicht begonnen'}.`,
        ...(fertig.length ? ['Schon eingetragen:', ...fertig.map((p) => `- ${punktInhalt(kp, p)}`)] : []),
        naechsterText(kp),
      ].join('\n'),
    )
    return teile.join('\n\n')
  }

  // Frisch lesen direkt vor dem Schreiben (ein offenes Browserfenster könnte inzwischen gespeichert haben).
  const { data: frisch, error: frischFehler } = await supabase.from('objekte').select('kurzpruefung, activities, kaufpreis').eq('id', o.id).maybeSingle()
  if (frischFehler || !frisch) return `Fehler beim Laden: ${frischFehler?.message ?? 'Objekt nicht mehr da'}`
  const alt = vervollstaendige(frisch.kurzpruefung, frisch.kaufpreis, heute)
  const { kp, geaendert, fehler } = trageEin(alt, antworten, { ersetzen: input?.listen_ersetzen === true })
  if (!geaendert.length) return `Nichts gespeichert${fehler.length ? `: ${fehler.join('; ')}` : ' (keine verwertbaren Antworten)'}. Gültige Punkte: ${PUNKTE.map((p) => p.id).join(', ')}.`
  if (!kp.datum) kp.datum = heute
  const eintrag = { id: crypto.randomUUID(), date: heute, text: `Kurzprüfung per Telegram ergänzt (${geaendert.length} Punkt${geaendert.length === 1 ? '' : 'e'})`, user: mitarbeiter.name }
  const { error: speicherFehler } = await supabase
    .from('objekte')
    .update({ kurzpruefung: kp, activities: [eintrag, ...(Array.isArray(frisch.activities) ? frisch.activities : [])] })
    .eq('id', o.id)
  if (speicherFehler) return `Fehler beim Speichern: ${speicherFehler.message}. Nichts wurde geändert.`
  protokolliere(`Kurzprüfung ${name_}: ${geaendert.join(', ')} eingetragen`)
  const gespeichert = PUNKTE.filter((p) => geaendert.includes(p.id)).map((p) => `- ${punktInhalt(kp, p)}`)
  return [
    `Gespeichert in der Kurzprüfung ${name_} (${standText(kp)}):`,
    ...gespeichert,
    fehler.length ? `Hinweis: ${fehler.join('; ')}.` : '',
    naechsterText(kp),
    'Im CRM: Objektakte → Kurzprüfung.',
  ].filter(Boolean).join('\n')
}
