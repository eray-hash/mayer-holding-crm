// Assistent-Werkzeug "diagramm_erstellen" (Wunsch 23.11.2026): zeichnet Mindmap, Baum, Organigramm,
// Ablaufdiagramm, Struktogramm, Zeitstrahl oder Sammeltafel (diagramm.ts), schickt das Bild sofort in
// den Telegram-Chat (über den Bot, mit dem gerade gesprochen wird — privat bleibt privat) und legt
// Bild (PNG) und PDF in der genannten Kunden- oder Objektakte ab. Ohne Akte nur in den Chat.

import { ART_NAME, alsPdf, alsPng, baueSvg, DIAGRAMM_ARTEN, pruefeEingabe } from './diagramm.ts'
import { deDatum, type DokumentKontext, heuteBerlin, ladeZiel, legeAb, ohneEndung } from './dokumentErstellen.ts'

const KNOTEN = {
  type: 'object',
  description: 'Ein Kasten: text und optional kinder (Liste weiterer Kästen in derselben Form).',
  properties: { text: { type: 'string' }, kinder: { type: 'array', items: { type: 'object' } } },
  required: ['text'],
}

export const DIAGRAMM_WERKZEUG = {
  name: 'diagramm_erstellen',
  description:
    'Zeichnet ein Diagramm als Bild (PNG) und PDF und schickt das Bild sofort hier in den Chat: Mindmap (art "mindmap", Thema in der Mitte, Äste rundherum), Baumdiagramm/Entscheidungsbaum ("baum", von links nach rechts), Organigramm ("organigramm", von oben nach unten), Ablaufdiagramm/Flussdiagramm ("ablauf", Schritte mit Ja/Nein-Fragen), Struktogramm nach Nassi-Shneiderman ("struktogramm"), Zeitstrahl ("zeitstrahl") oder Brainstorming-/Sammeltafel in Spalten ("tafel", z. B. Ideen/Vorteile/Offene Fragen). Verwenden, wenn jemand ein Diagramm, eine Mindmap, ein Schaubild, eine Skizze eines Ablaufs, ein Organigramm oder eine Übersicht „als Bild“ möchte. Den Inhalt schreibst du selbst knapp (Stichworte, keine langen Sätze; höchstens rund 120 Kästen). Mit kunde_id oder objekt_id werden Bild und PDF zusätzlich in dieser Akte abgelegt („speichere es ab“ → nach der passenden Akte fragen oder sie aus dem Gespräch nehmen); ohne Akte kommt es nur in den Chat. Fotos oder gemalte Bilder kann dieses Werkzeug nicht erzeugen.',
  input_schema: {
    type: 'object',
    properties: {
      art: { type: 'string', enum: [...DIAGRAMM_ARTEN] },
      titel: { type: 'string', description: 'Überschrift des Diagramms, wird auch Dateiname.' },
      knoten: { ...KNOTEN, description: 'Für mindmap, baum, organigramm: die Wurzel (Mitte bzw. Spitze) mit kinder.' },
      schritte: {
        type: 'array',
        description: 'Für ablauf: Schritte von oben nach unten. art "start"/"ende" (abgerundet), "schritt" (Kasten) oder "frage" (Raute; Ja geht nach unten weiter, nein = Text des Nein-Zweigs rechts, nein_weiter_bei = Nummer des Schritts (ab 1), zu dem es danach zurückgeht).',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, art: { type: 'string', enum: ['start', 'schritt', 'frage', 'ende'] }, nein: { type: 'string' }, nein_weiter_bei: { type: 'number' } },
          required: ['text'],
        },
      },
      bloecke: {
        type: 'array',
        description:
          'Für struktogramm: Blöcke von oben nach unten. art "anweisung" (text), "verzweigung" (text = Bedingung, ja und nein = Listen von Blöcken) oder "schleife" (text = Bedingung, inhalt = Liste von Blöcken).',
        items: { type: 'object', properties: { art: { type: 'string', enum: ['anweisung', 'verzweigung', 'schleife'] }, text: { type: 'string' }, ja: { type: 'array', items: { type: 'object' } }, nein: { type: 'array', items: { type: 'object' } }, inhalt: { type: 'array', items: { type: 'object' } } }, required: ['art', 'text'] },
      },
      ereignisse: { type: 'array', description: 'Für zeitstrahl: in zeitlicher Reihenfolge.', items: { type: 'object', properties: { datum: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } },
      spalten: { type: 'array', description: 'Für tafel: 1–6 Spalten mit Überschrift und Stichpunkten.', items: { type: 'object', properties: { titel: { type: 'string' }, punkte: { type: 'array', items: { type: 'string' } } }, required: ['titel', 'punkte'] } },
      kunde_id: { type: 'string', description: 'Optional: Kundenakte, in der Bild und PDF abgelegt werden.' },
      objekt_id: { type: 'string', description: 'Optional statt kunde_id: Objektakte einer Immobilie (Ordner frei wählbar, Vorgabe „Sonstiges“).' },
      ordner: { type: 'string', description: 'Nur mit objekt_id: Ordner in der Objektakte.' },
    },
    required: ['art', 'titel'],
  },
}

export function istDiagrammWerkzeug(name: string): boolean {
  return name === DIAGRAMM_WERKZEUG.name
}

export type DiagrammKontext = DokumentKontext & {
  /** Schreibt PNG und PDF; für Tests ersetzbar. */
  zeichne?: (svg: string, b: number, h: number, titel: string) => Promise<{ png: Uint8Array; pdf: Uint8Array }>
}

async function standardZeichnen(svg: string, b: number, h: number, titel: string) {
  const png = await alsPng(svg, b, h)
  return { png, pdf: await alsPdf(png, titel) }
}

/** Bild per sendPhoto in den Chat (zu große Bilder als Datei). Ohne Schlüssel nur protokolliert. */
async function sendeBild(k: DiagrammKontext, png: Uint8Array, name: string, beschriftung: string): Promise<string | null> {
  let chatId = k.chatId ?? null
  if (!chatId) {
    const m = k.mitarbeiter as { id?: string | null; email?: string | null }
    const { data } = m.id
      ? await k.supabase.from('mitarbeiter').select('telegram_chat_id').eq('id', m.id).maybeSingle()
      : await k.supabase.from('mitarbeiter').select('telegram_chat_id').ilike('email', String(m.email ?? '')).maybeSingle()
    chatId = data?.telegram_chat_id ?? null
  }
  if (!chatId) return 'kein Telegram-Chat bekannt'
  const token = k.botToken === undefined ? Deno.env.get('TELEGRAM_BOT_TOKEN') : k.botToken
  if (!token) {
    console.log(`[Telegram-Bild -> ${chatId}] ${name} (${png.length} Bytes) — ${beschriftung}`)
    return null
  }
  const abruf = k.abruf ?? fetch
  const alsFoto = png.length < 9_000_000
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append(alsFoto ? 'photo' : 'document', new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }), name)
  form.append('caption', beschriftung.slice(0, 1000))
  try {
    const res = await abruf(`https://api.telegram.org/bot${token}/${alsFoto ? 'sendPhoto' : 'sendDocument'}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) })
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json().catch(() => null)
    if (j?.ok) return null
    // Telegram lehnt sehr lange oder schmale Bilder als Foto ab — dann als Datei.
    if (alsFoto) {
      const f2 = new FormData()
      f2.append('chat_id', String(chatId))
      f2.append('document', new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }), name)
      f2.append('caption', beschriftung.slice(0, 1000))
      const r2 = await abruf(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: f2, signal: AbortSignal.timeout(60_000) })
      // deno-lint-ignore no-explicit-any
      const j2: any = await r2.json().catch(() => null)
      if (j2?.ok) return null
      return String(j2?.description ?? r2.status)
    }
    return String(j?.description ?? res.status)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// deno-lint-ignore no-explicit-any
export async function fuehreDiagrammAus(input: any, k: DiagrammKontext): Promise<string> {
  const eingabe = pruefeEingabe(input)
  if (typeof eingabe === 'string') return eingabe
  const heute = k.heute ?? heuteBerlin()
  const mitAkte = !!String(input?.kunde_id ?? '').trim() || !!String(input?.objekt_id ?? '').trim()
  // Akte zuerst prüfen: Fehlt das Recht, wird gar nicht erst gezeichnet.
  const ziel = mitAkte ? await ladeZiel(k, input, 'Sonstiges') : null
  if (typeof ziel === 'string') return ziel

  const { svg, b, h } = baueSvg(eingabe)
  let dateien: { png: Uint8Array; pdf: Uint8Array }
  try {
    dateien = await (k.zeichne ?? standardZeichnen)(svg, b, h, eingabe.titel)
  } catch (e) {
    return `Fehler beim Zeichnen: ${e instanceof Error ? e.message : String(e)}. Bitte gleich noch einmal versuchen.`
  }
  const artName = ART_NAME[eingabe.art]
  const basis = `${ohneEndung(eingabe.titel)} (${deDatum(heute)})`
  const gesendet = await sendeBild(k, dateien.png, `${basis}.png`, `${artName}: ${eingabe.titel}`)
  const chatText = gesendet ? `Das Bild konnte nicht in den Chat geschickt werden (${gesendet}).` : 'Das Bild ist im Chat.'
  if (!ziel) {
    k.protokolliere(`${artName} „${eingabe.titel}“ erstellt und in den Chat geschickt (nicht abgelegt)`)
    return `${artName} „${eingabe.titel}“ erstellt. ${chatText} Es ist in keiner Akte abgelegt — soll es gespeichert werden, frag nach der Akte und rufe das Werkzeug mit kunde_id oder objekt_id noch einmal auf. Schreib nur kurz dazu, das Bild nicht noch einmal beschreiben.`
  }
  const ablage = []
  for (const [endung, typ, bytes] of [
    ['png', 'image/png', dateien.png],
    ['pdf', 'application/pdf', dateien.pdf],
  ] as const) {
    const r = await legeAb(k, ziel, heute, {
      bytes,
      dateiName: `${basis}.${endung}`,
      typ,
      aktivitaet: (n) => `${artName} „${n}“ vom Assistenten für ${k.mitarbeiter.name} gezeichnet und ${ziel.art === 'objekt' ? `im Ordner ${ziel.ordner}` : 'unter Dokumente'} abgelegt.`,
    })
    if (typeof r === 'string') return `${artName} erstellt. ${chatText} Ablage fehlgeschlagen: ${r}`
    ablage.push(r)
  }
  k.protokolliere(`${artName} „${eingabe.titel}“ gezeichnet und bei ${ziel.name} abgelegt (Bild und PDF)`)
  return `${artName} „${eingabe.titel}“ erstellt. ${chatText} Abgelegt ${ziel.art === 'objekt' ? `in der Objektakte ${ziel.name} im Ordner ${ziel.ordner}` : `in der Akte von ${ziel.name} unter Dokumente`}: „${ablage[0].name}“ (Bild) und „${ablage[1].name}“ (PDF, dokument_id=${ablage[1].id}). Schreib nur kurz dazu, das Bild nicht noch einmal beschreiben.`
}
