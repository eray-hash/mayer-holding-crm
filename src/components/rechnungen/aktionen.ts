// Gemeinsame Bausteine für Rechnungen und Mahnwesen (21.11.2026): Empfänger aus der Akte, Vermerk im
// Verlauf der Akte, PDF in den Dokumenten der Akte ablegen, PDF per E-Mail senden.
import { useCallback } from 'react'
import { useApp, type AppData } from '../../context/AppContext'
import { findeAkte, useKvNutzer, type KvAkte } from '../KostenvoranschlaegeSection'
import { sendEmail, type MailAnhang, type SendEmailKundeKontext } from '../../lib/emailGateway'
import { ladeKundenDokumentHoch } from '../../lib/kundenDokumenteStorage'
import { briefkopfAus } from '../../data/briefkopf'
import { today, uid } from '../../lib/dates'
import type { Dokument, Rechnung } from '../../types'

/** Anschrift für Rechnung/Mahnung: auf der Rechnung gespeichert, sonst aus der Akte. */
export function anschriftFuer(r: Pick<Rechnung, 'anschrift'>, akte?: KvAkte): string {
  if (r.anschrift?.trim()) return r.anschrift.trim()
  const k = akte?.kunde
  return (k?.anschrift?.trim() || (k?.immoStammdaten?.adresse ?? '').split(/,\s*/).join('\n')).trim()
}

/** Empfängerzeilen: Firma, Ansprechpartner (falls anders), Anschrift. */
export function empfaengerZeilen(r: Pick<Rechnung, 'anschrift'>, akte?: KvAkte): string[] {
  const k = akte?.kunde
  const firma = (k?.firma ?? '').trim()
  const person = (k?.ansprechpartner ?? '').trim()
  const zeilen = [firma, person && person !== firma ? person : '', ...anschriftFuer(r, akte).split('\n')]
  return zeilen.map((z) => z.trim()).filter(Boolean)
}

export function blobZuBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader()
    leser.onload = () => resolve(String(leser.result).replace(/^data:[^,]*,/, ''))
    leser.onerror = () => reject(new Error('Das PDF ließ sich nicht für den Versand vorbereiten.'))
    leser.readAsDataURL(blob)
  })
}

/** Mail-Text mit der Signatur aus „Mein Profil“ (wie SendEmailModal). */
function mitSignatur(text: string, signaturHtml?: string): { text: string; html?: string } {
  const sig = signaturHtml?.trim()
  if (!sig) return { text: text.trim() }
  const sigText = sig
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<div>${text
    .trim()
    .split('\n')
    .map((z) => `<p>${esc(z) || '&nbsp;'}</p>`)
    .join('')}</div><div>${sig}</div>`
  return { text: `${text.trim()}\n\n--\n${sigText}`, html }
}

export function useRechnungAktionen() {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()

  const briefkopf = briefkopfAus(state.vorlagenBeratung)

  /** Eintrag im Verlauf der Akte. */
  const vermerk = useCallback(
    (kundeId: string, text: string, aktuellerStand?: AppData) => {
      const akte = findeAkte(aktuellerStand ?? state, kundeId)
      if (!akte) return
      dispatch({
        type: 'UPDATE_KUNDE_IN_BEREICH',
        bereich: akte.bereich,
        id: akte.kunde.id,
        patch: { letzteAktivitaet: today(), activities: [{ id: uid('act'), date: today(), text, user: nutzer.name }, ...(akte.kunde.activities ?? [])] },
      })
    },
    [state, dispatch, nutzer.name],
  )

  /** Legt das PDF in den Dokumenten der Akte ab; gibt den Verweis zurück (oder nichts ohne Akte). */
  const pdfAblegen = useCallback(
    async (kundeId: string, blob: Blob, name: string): Promise<{ kundeId: string; dokumentId: string; name: string } | undefined> => {
      const akte = findeAkte(state, kundeId)
      if (!akte) return undefined
      const { pfad, groesse } = await ladeKundenDokumentHoch(akte.kunde.id, new File([blob], name, { type: 'application/pdf' }))
      const dok: Dokument = { id: uid('dok'), name, typ: 'application/pdf', datum: today(), groesse, url: pfad }
      dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: akte.bereich, id: akte.kunde.id, patch: { dokumente: [...(akte.kunde.dokumente ?? []), dok] } })
      return { kundeId: akte.kunde.id, dokumentId: dok.id, name }
    },
    [state, dispatch],
  )

  /** Sendet das PDF als Anhang an den Kunden (über das gemeinsame Postfach). */
  const pdfSenden = useCallback(
    // weitereAnhaenge: Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md) — z. B. die XRechnung als XML
    async (p: { an: string; betreff: string; text: string; blob: Blob; dateiname: string; kundeId: string; weitereAnhaenge?: MailAnhang[] }) => {
      const akte = findeAkte(state, p.kundeId)
      const inhalt = mitSignatur(p.text, state.profil.signaturHtml)
      const base64 = await blobZuBase64(p.blob)
      // ohneRechnungsErkennung: die Rechnung steht schon im CRM — sonst legte der Server sie aus dem Mailtext ein zweites Mal an.
      const kontext: SendEmailKundeKontext & { ohneRechnungsErkennung: boolean } = {
        toName: akte ? akte.kunde.ansprechpartner || akte.kunde.firma : p.an,
        kundeBereich: akte?.bereich,
        kundeId: akte?.kunde.id,
        kundeName: akte?.kunde.firma,
        ohneRechnungsErkennung: true,
      }
      await sendEmail(p.an.trim(), p.betreff.trim(), inhalt.text, inhalt.html, kontext, [{ filename: p.dateiname, contentBase64: base64, contentType: 'application/pdf' }, ...(p.weitereAnhaenge ?? [])])
    },
    [state],
  )

  return { state, dispatch, nutzer, briefkopf, vermerk, pdfAblegen, pdfSenden }
}
