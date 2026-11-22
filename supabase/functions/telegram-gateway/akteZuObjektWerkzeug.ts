// Assistent-Werkzeug: Kundenakte in eine Objektakte umwandeln (22.11.2026). Anlass: Kundenakten, die in Wahrheit
// ein Objekt sind (z. B. „Hotel Gasthof Hirsch Alfdorf (HD-IMMO, Helmut Dick)“ mit 106 Dokumenten). Die Arbeit
// selbst macht email-gateway (Aktion akte_zu_objekt, email-gateway/akteZuObjekt.ts): Vorschau, Anlegen, Kopieren in
// Blöcken im Hintergrund, Abschluss. Dieses Werkzeug prüft die Rechte wie die Datenbank (rechte.ts), zeigt die
// Vorschau und startet erst nach dem Ja des Mitarbeiters (bestaetigt=true). Ist der Umzug per Telegram gestartet,
// schickt email-gateway am Ende eine kurze Nachricht an den Mitarbeiter.

import { euro } from './objektWerkzeuge.ts'
import { darfAkte, darfObjekte, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type AkteZuObjektKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** email-gateway aufrufen (callEmailGateway in index.ts) — wirft mit der Fehlermeldung des Servers. */
  // deno-lint-ignore no-explicit-any
  rufeEmailGateway: (action: string, body: Record<string, unknown>) => Promise<any>
}

export const AKTE_ZU_OBJEKT_WERKZEUGE = [
  {
    name: 'akte_in_objekt_umwandeln',
    description:
      'Wandelt eine Kundenakte, die in Wahrheit ein Objekt (eine Immobilie) ist, in eine Objektakte um und sortiert alle ihre Dokumente automatisch in die Ordner der Objektakte (Exposé, Bilder, Grundbuch …). ' +
      'Erster Aufruf ohne bestaetigt: Vorschau mit vorgeschlagenem Namen, Adresse, Kaufpreis, Objektart und wie viele Dateien in welchen Ordner kommen — zeig sie dem Mitarbeiter. Erst nach seinem Ja erneut mit bestaetigt=true aufrufen (Korrekturen dabei mitgeben). ' +
      'Dateien, die zu einem anderen schon vorhandenen Objekt gehören, kommen dorthin; Logos aus Mail-Signaturen bleiben in der Kundenakte; die Kundenakte bleibt als Kontakt des Maklers bzw. Eigentümers bestehen. ' +
      'Bei vielen Dateien läuft das im Hintergrund weiter; ein erneuter Aufruf mit derselben kunde_id nennt den Stand. kunde_id aus kunden_suchen.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Kundenakte, die ein Objekt ist.' },
        bestaetigt: { type: 'boolean', description: 'true = der Mitarbeiter hat die Vorschau gesehen und will umwandeln.' },
        bezeichnung: { type: 'string', description: 'Optional: anderer Name des Objekts.' },
        adresse: { type: 'string', description: 'Optional: andere Adresse (Straße Nr, PLZ Ort).' },
        kaufpreis: { type: ['number', 'string'], description: 'Optional: anderer Kaufpreis in Euro.' },
        typ: { type: 'string', enum: ['Wohnung', 'Haus', 'Grundstück', 'Gewerbe', 'Neubauprojekt'], description: 'Optional: andere Objektart.' },
        in_vorhandenes_objekt: { type: 'string', description: 'Optional: objekt_id eines schon vorhandenen Objekts — dann wird kein neues angelegt, die Dateien kommen dort hinein.' },
        trotzdem: { type: 'boolean', description: 'true = trotz eines gleichen vorhandenen Objekts ein neues anlegen (nur nach Bestätigung).' },
        alles_ins_neue_objekt: { type: 'boolean', description: 'true = auch Dateien, die einem anderen Objekt zugeordnet wurden, in die neue Objektakte legen.' },
        dokumente_behalten: { type: 'boolean', description: 'true = Dokumente zusätzlich in der Kundenakte lassen (Vorgabe: dort herausnehmen).' },
        erneut: { type: 'boolean', description: 'true = eine schon umgezogene Akte noch einmal umwandeln (nur auf ausdrücklichen Wunsch).' },
      },
      required: ['kunde_id'],
    },
  },
]

export function istAkteZuObjektWerkzeug(name: string): boolean {
  return AKTE_ZU_OBJEKT_WERKZEUGE.some((w) => w.name === name)
}

// ---------- Texte ----------

// deno-lint-ignore no-explicit-any
type Antwort = Record<string, any>

function ordnerText(zahlen: Record<string, number> | undefined): string {
  return Object.entries(zahlen ?? {}).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')
}

function summe(zahlen: Record<string, number> | undefined): number {
  return Object.values(zahlen ?? {}).reduce((a, b) => a + b, 0)
}

export function vorschauText(a: Antwort): string {
  const e = a.eckdaten ?? {}
  const anb = e.anbieter && (e.anbieter.name || e.anbieter.firma) ? ` Angeboten von ${e.anbieter.art || 'Makler'} ${[e.anbieter.name, e.anbieter.firma && (e.anbieter.name ? `(${e.anbieter.firma})` : e.anbieter.firma)].filter(Boolean).join(' ')}.` : ''
  const eig = e.eigentuemer?.name ? ` Eigentümer: ${e.eigentuemer.name}.` : ''
  const zeilen = [
    `Vorschau — Kundenakte „${a.kundeName}“ (kunde_id=${a.kundeId}) in eine Objektakte umwandeln:`,
    `Neue Objektakte: „${e.bezeichnung}“${e.adresse ? `, ${e.adresse}` : ', Adresse unbekannt'}, ${e.typ}, Kaufpreis ${euro(e.kaufpreis)}${e.nichtOeffentlich ? ', nicht öffentlich (Off-Market)' : ''}, Status Akquise.${anb}${eig}`,
    `In die neue Objektakte: ${summe(a.ordnerZahlen)} Datei(en)${summe(a.ordnerZahlen) ? ` (${ordnerText(a.ordnerZahlen)})` : ''}.`,
    ...(a.andereZiele ?? []).map((z: { id: string; name: string; anzahl: number }) => `In das schon vorhandene Objekt „${z.name}“ (objekt_id=${z.id}): ${z.anzahl} Datei(en).`),
    a.bleiben ? `In der Kundenakte bleiben: ${a.bleiben} Datei(en).` : '',
    ...(a.hinweise ?? []).map((h: string) => `Hinweis: ${h}`),
    a.dublette ? `Es gibt schon die Objektakte „${a.dublette.name}“ (objekt_id=${a.dublette.id}): mit in_vorhandenes_objekt=${a.dublette.id} kommen die Dateien dort hinein; ein zweites Objekt nur mit trotzdem=true.` : '',
    `Zeig das dem Mitarbeiter. Nach seinem Ja erneut mit bestaetigt=true aufrufen (Korrekturen wie bezeichnung, adresse, kaufpreis, typ mitgeben). umzug_id=${a.umzugId}`,
  ]
  return zeilen.filter(Boolean).join('\n')
}

export function standText(a: Antwort): string {
  const ziel = `„${a.objektName}“${a.objektId ? ` (objekt_id=${a.objektId})` : ''}`
  if (a.status === 'laeuft') return `Läuft: Kundenakte „${a.kundeName}“ → Objektakte ${ziel} — ${a.erledigt} von ${a.gesamt} Dateien erledigt. Es geht im Hintergrund weiter; am Ende kommt eine kurze Nachricht.`
  if (a.status === 'fertig') {
    const fehler = (a.fehler ?? []) as { name: string; grund: string }[]
    return `Fertig: Kundenakte „${a.kundeName}“ ist in die Objektakte ${ziel} umgezogen — ${a.gesamt - fehler.length} von ${a.gesamt} Dateien übernommen.${fehler.length ? ` Nicht übernommen (liegen weiter in der Kundenakte): ${fehler.slice(0, 5).map((f) => `„${f.name}“ (${f.grund})`).join(', ')}${fehler.length > 5 ? ' …' : ''}.` : ''} Die Kundenakte bleibt als Kontakt bestehen.`
  }
  if (a.status === 'abgebrochen') return `Der Umzug der Kundenakte „${a.kundeName}“ wurde abgebrochen.`
  return vorschauText(a)
}

// ---------- Werkzeug ----------

// deno-lint-ignore no-explicit-any
export async function fuehreAkteZuObjektWerkzeugAus(name: string, input: any, k: AkteZuObjektKontext): Promise<string> {
  if (name !== 'akte_in_objekt_umwandeln') return `Fehler: unbekanntes Werkzeug ${name}.`
  try {
    return await umwandeln(input ?? {}, k)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}

// deno-lint-ignore no-explicit-any
async function umwandeln(input: any, k: AkteZuObjektKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere } = k
  if (mitarbeiter.nurPrivat === true) return 'Fehler: Im privaten Assistenten gibt es das Umwandeln in eine Objektakte nicht — dafür im CRM-Assistenten oder im CRM die Kundenakte öffnen.'
  if (!darfObjekte(mitarbeiter)) return `${nichtFreigegeben('immobilien', mitarbeiter.name)} Eine Objektakte kann er deshalb nicht anlegen.`
  const kundeId = String(input.kunde_id ?? '').trim()
  if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
  if (SAMMELAKTEN.includes(kundeId)) return 'Fehler: Die Sammelakten lassen sich nicht in eine Objektakte umwandeln.'
  const { data: akte } = await supabase.from('kunden').select('id, bereich, firma, verantwortlich_email').eq('id', kundeId).maybeSingle()
  if (!akte || istFremdePrivatakte(mitarbeiter, akte)) return 'Fehler: Es gibt keine Kundenakte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
  if (istPrivat(akte)) return 'Fehler: Private Kontakte lassen sich nicht in eine Objektakte der Holding umwandeln.'
  if (!darfAkte(mitarbeiter, akte)) return nichtFreigegeben(akte.bereich, mitarbeiter.name)

  const imAuftragVon = String(mitarbeiter.email ?? '').trim().toLowerCase()
  if (!imAuftragVon) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  const rufe = (body: Record<string, unknown>) => k.rufeEmailGateway('akte_zu_objekt', { ...body, imAuftragVon })

  // Läuft schon ein Umzug oder ist die Akte schon umgezogen?
  let stand: Antwort | null = null
  try {
    stand = await rufe({ modus: 'stand', kunde_id: kundeId })
  } catch {
    stand = null // noch kein Umzug für diese Akte
  }
  if (stand?.status === 'laeuft') return standText(stand)
  if (stand?.status === 'fertig' && input.erneut !== true) return `${standText(stand)} Soll sie trotzdem noch einmal umgewandelt werden (z. B. für später dazugekommene Dateien), erneut mit erneut=true aufrufen.`

  const vorschau: Antwort = await rufe({ modus: 'vorschau', kunde_id: kundeId, neu: input.erneut === true })
  if (vorschau.status === 'laeuft') return standText(vorschau)
  if (input.bestaetigt !== true) return vorschauText(vorschau)

  const eckdaten: Record<string, unknown> = {}
  for (const feld of ['bezeichnung', 'adresse', 'typ'] as const) if (typeof input[feld] === 'string' && input[feld].trim()) eckdaten[feld] = input[feld].trim()
  if (input.kaufpreis !== undefined && input.kaufpreis !== null && input.kaufpreis !== '') eckdaten.kaufpreis = input.kaufpreis
  const gestartet: Antwort = await rufe({
    modus: 'start',
    umzug_id: vorschau.umzugId,
    eckdaten,
    objekt_id: typeof input.in_vorhandenes_objekt === 'string' && input.in_vorhandenes_objekt.trim() ? input.in_vorhandenes_objekt.trim() : undefined,
    trotzdem: input.trotzdem === true,
    alles_ins_neue: input.alles_ins_neue_objekt === true,
    behalten: input.dokumente_behalten === true,
    quelle: 'telegram',
  })
  protokolliere(`Kundenakte „${akte.firma ?? kundeId}“ (kunde_id=${kundeId}) wird in die Objektakte „${gestartet.objektName}“ umgewandelt (objekt_id=${gestartet.objektId}, ${gestartet.gesamt} Dateien)`)
  const anderswo = (gestartet.andereZiele ?? []).map((z: { name: string; anzahl: number }) => `${z.anzahl} in „${z.name}“`).join(', ')
  return `Gestartet: ${gestartet.neuesObjekt ? 'neue ' : ''}Objektakte „${gestartet.objektName}“ (objekt_id=${gestartet.objektId}). ${gestartet.gesamt} Datei(en) werden umgelegt${anderswo ? ` (davon ${anderswo})` : ''} — das läuft im Hintergrund weiter (bisher ${gestartet.erledigt} erledigt); am Ende kommt eine kurze Nachricht. Den Stand nennt ein erneuter Aufruf mit kunde_id=${kundeId}.`
}
