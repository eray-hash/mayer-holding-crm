import { useEffect, useState } from 'react'
import { callAuthenticated } from './emailGateway'

// Briefe auf dem eigenen Word-Briefbogen (Bereich Privat). Die Dateien liegen auf dem Server; der Browser
// bekommt nur die Liste und das fertige Ergebnis (Word + PDF) zurück. Server: email-gateway/briefe.ts.

export type Raender = {
  links: number
  rechts: number
  unten: number
  anschriftOben: number
  datumOben: number
  betreffOben: number
  folgeseiteOben: number
  schrift: number
  zeilenhoehe: number
}

export const STANDARD_RAENDER: Raender = { links: 25, rechts: 20, unten: 25, anschriftOben: 50.7, datumOben: 98.5, betreffOben: 106, folgeseiteOben: 30, schrift: 11, zeilenhoehe: 1.35 }

export type BriefbogenEinstellungen = { ort?: string; gruss?: string[]; raender?: Partial<Raender> }

export type Briefbogen = {
  id: string
  name: string
  hatPdf: boolean
  platzhalter: string[]
  einstellungen: BriefbogenEinstellungen
  geaendertAm: string
}

export type BriefDaten = { empfaenger: string[]; datum?: string; betreff: string; anrede: string; absaetze: string[] }

export type BriefErgebnis = { name: string; docx: Blob; pdf: Blob; mitHintergrund: boolean }

let liste: Briefbogen[] | null = null
const zuhoerer = new Set<() => void>()

export async function ladeBriefboegen(): Promise<Briefbogen[]> {
  const data = await callAuthenticated({ action: 'briefboegen_liste' })
  liste = data.briefboegen ?? []
  zuhoerer.forEach((f) => f())
  return liste!
}

/** Liste der eigenen Briefbögen (nur laden, wenn `aktiv` — also für Freigeschaltete). */
export function useBriefboegen(aktiv: boolean): { briefboegen: Briefbogen[] | null; fehler: string } {
  const [, setZaehler] = useState(0)
  const [fehler, setFehler] = useState('')
  useEffect(() => {
    const f = () => setZaehler((z) => z + 1)
    zuhoerer.add(f)
    if (aktiv && liste === null) ladeBriefboegen().catch((e) => setFehler(e instanceof Error ? e.message : String(e)))
    return () => {
      zuhoerer.delete(f)
    }
  }, [aktiv])
  return { briefboegen: aktiv ? liste : null, fehler }
}

export function vergissBriefboegen() {
  liste = null
}

async function alsBase64(datei: File): Promise<string> {
  const puffer = new Uint8Array(await datei.arrayBuffer())
  let roh = ''
  for (let i = 0; i < puffer.length; i += 0x8000) roh += String.fromCharCode(...puffer.subarray(i, i + 0x8000))
  return btoa(roh)
}

function ausBase64(b64: string, typ: string): Blob {
  const roh = atob(b64)
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return new Blob([bytes], { type: typ })
}

export async function speichereBriefbogen(eingabe: { id?: string; name: string; docx?: File | null; pdf?: File | null; einstellungen: BriefbogenEinstellungen }): Promise<Briefbogen> {
  const data = await callAuthenticated({
    action: 'briefbogen_speichern',
    id: eingabe.id,
    name: eingabe.name,
    einstellungen: eingabe.einstellungen,
    ...(eingabe.docx ? { docx: await alsBase64(eingabe.docx) } : {}),
    ...(eingabe.pdf ? { pdf: await alsBase64(eingabe.pdf) } : {}),
  })
  await ladeBriefboegen()
  return data.briefbogen
}

export async function loescheBriefbogen(id: string): Promise<void> {
  await callAuthenticated({ action: 'briefbogen_loeschen', id })
  await ladeBriefboegen()
}

export async function erzeugeBrief(briefbogenId: string, brief: BriefDaten): Promise<BriefErgebnis> {
  const data = await callAuthenticated({ action: 'brief_erzeugen', briefbogenId, brief })
  return {
    name: data.name,
    docx: ausBase64(data.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    pdf: ausBase64(data.pdf, 'application/pdf'),
    mitHintergrund: !!data.mitHintergrund,
  }
}

export async function glaetteBrief(text: string, hinweis: { betreff?: string; empfaenger?: string[] }): Promise<{ betreff: string; anrede: string; absaetze: string[] }> {
  return callAuthenticated({ action: 'brief_glaetten', text, ...hinweis })
}

export function herunterladen(blob: Blob, dateiname: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Text einer ausgefüllten Vorlage in Absätze teilen (Leerzeile = neuer Absatz, einfache Umbrüche bleiben). */
export function textZuAbsaetzen(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((a) => a.replace(/^\n+|\s+$/g, ''))
    .filter((a) => a.trim())
}
