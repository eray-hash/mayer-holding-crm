// Gemeinsames Fenster für Rechnung und Mahnschreiben (21.11.2026): PDF ansehen, per E-Mail an den Kunden
// senden (PDF als Anhang) oder nur als PDF erstellen (z. B. für den Versand per Post). In beiden Fällen
// landet das PDF in den Dokumenten der Akte; was danach an der Rechnung vermerkt wird, entscheidet der Aufrufer.
import { useEffect, useState, type ReactNode } from 'react'
import { Download, Mail, Printer } from 'lucide-react'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from '../ui'
import { herunterladen } from '../../lib/briefe'
import { isEmailGatewayConfigured, type MailAnhang } from '../../lib/emailGateway'
import { useRechnungAktionen } from './aktionen'

export type VersandErgebnis = { weg: 'email' | 'pdf'; an?: string; dokument?: { kundeId: string; dokumentId: string; name: string } }

export function PdfVersandModal({
  titel,
  kundeId,
  standardEmail,
  standardBetreff,
  standardMailText,
  erzeugePdf,
  dateiname,
  oben,
  pruefen,
  nurPdfHinweis,
  weitereAnhaenge,
  onErledigt,
  onClose,
}: {
  titel: string
  kundeId: string
  standardEmail: string
  standardBetreff: string
  standardMailText: string
  erzeugePdf: () => Blob
  dateiname: string
  /** Eigene Felder oberhalb (z. B. Stufe, Frist und Texte der Mahnung). */
  oben?: ReactNode
  /** Fehlermeldung, wenn noch etwas fehlt — sonst leer. */
  pruefen?: () => string
  nurPdfHinweis: string
  /** Modul E-Rechnung (abschaltbar, siehe src/module/eRechnung/README.md): weitere Anhänge beim Versand per E-Mail (z. B. XRechnung). */
  weitereAnhaenge?: () => MailAnhang[]
  onErledigt: (e: VersandErgebnis) => void
  onClose: () => void
}) {
  const { nutzer, pdfAblegen, pdfSenden } = useRechnungAktionen()
  const [weg, setWeg] = useState<'email' | 'pdf'>(standardEmail ? 'email' : 'pdf')
  const [an, setAn] = useState(standardEmail)
  const [betreff, setBetreff] = useState(standardBetreff)
  const [text, setText] = useState(standardMailText)
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState('')
  // Vorschläge folgen den Feldern oben (z. B. Frist der Mahnung), bis jemand sie selbst ändert.
  const [betreffVonHand, setBetreffVonHand] = useState(false)
  const [textVonHand, setTextVonHand] = useState(false)
  useEffect(() => {
    if (!betreffVonHand) setBetreff(standardBetreff)
  }, [standardBetreff, betreffVonHand])
  useEffect(() => {
    if (!textVonHand) setText(standardMailText)
  }, [standardMailText, textVonHand])

  function ansehen() {
    setFehler('')
    const f = pruefen?.()
    if (f) return setFehler(f)
    try {
      herunterladen(erzeugePdf(), dateiname)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das PDF ließ sich nicht erstellen.')
    }
  }

  async function ausfuehren() {
    setFehler('')
    const f = pruefen?.()
    if (f) return setFehler(f)
    if (weg === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an.trim())) return setFehler('Bitte eine gültige E-Mail-Adresse eintragen.')
      if (!betreff.trim() || !text.trim()) return setFehler('Bitte Betreff und Text der E-Mail ausfüllen.')
    }
    setArbeitet(true)
    try {
      const blob = erzeugePdf()
      if (weg === 'email') {
        await pdfSenden({ an, betreff, text, blob, dateiname, kundeId, weitereAnhaenge: weitereAnhaenge?.() })
      } else {
        herunterladen(blob, dateiname)
      }
      // Ablegen erst nach erfolgreichem Versand; scheitert nur das Ablegen, gilt der Versand trotzdem.
      let dokument: VersandErgebnis['dokument']
      let ablageFehler = ''
      try {
        dokument = await pdfAblegen(kundeId, blob, dateiname)
      } catch (e) {
        ablageFehler = e instanceof Error ? e.message : 'unbekannter Fehler'
      }
      onErledigt({ weg, an: weg === 'email' ? an.trim() : undefined, dokument })
      const ablage = dokument ? ' Das PDF liegt in der Akte unter Dokumente.' : ablageFehler ? ` Das PDF ließ sich aber nicht in der Akte ablegen (${ablageFehler}).` : ''
      setFertig(weg === 'email' ? `Gesendet an ${an.trim()}.${ablage}` : `Das PDF wurde heruntergeladen.${ablage}`)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte noch einmal versuchen.')
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={titel} width="max-w-2xl">
      {fertig ? (
        <div className="py-4 text-center">
          <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">{fertig}</p>
          <PrimaryButton onClick={onClose}>Fertig</PrimaryButton>
        </div>
      ) : (
        <>
          {oben}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setWeg('email')}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${weg === 'email' ? 'border-accent-600 bg-accent-50 text-accent-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Mail size={15} /> Per E-Mail
            </button>
            <button
              type="button"
              onClick={() => setWeg('pdf')}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium ${weg === 'pdf' ? 'border-accent-600 bg-accent-50 text-accent-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Printer size={15} /> Nur PDF (z. B. per Post)
            </button>
          </div>

          {weg === 'email' ? (
            !isEmailGatewayConfigured ? (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Das Postfach ist noch nicht verbunden — bitte „Nur PDF“ wählen.</p>
            ) : (
              <>
                <Field label="An">
                  <input className={inputClass} type="email" value={an} onChange={(e) => setAn(e.target.value)} placeholder="E-Mail-Adresse des Kunden" />
                </Field>
                {!standardEmail && <p className="-mt-2 mb-3 text-xs text-amber-700">In der Akte ist keine E-Mail-Adresse hinterlegt.</p>}
                <Field label="Betreff">
                  <input className={inputClass} value={betreff} onChange={(e) => {
                      setBetreff(e.target.value)
                      setBetreffVonHand(true)
                    }} />
                </Field>
                <Field label="Text der E-Mail">
                  <textarea className={inputClass} rows={8} value={text} onChange={(e) => {
                      setText(e.target.value)
                      setTextVonHand(true)
                    }} />
                </Field>
                <p className="-mt-2 mb-3 text-xs text-slate-400">Absender: gemeinsames Postfach. Das PDF „{dateiname}“ wird angehängt; deine Signatur aus „Mein Profil“ kommt automatisch darunter.</p>
              </>
            )
          ) : (
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{nurPdfHinweis}</p>
          )}

          {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <SecondaryButton onClick={ansehen} className="justify-center">
              <Download size={15} /> PDF ansehen
            </SecondaryButton>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <SecondaryButton onClick={onClose} className="justify-center">Abbrechen</SecondaryButton>
              <PrimaryButton className="justify-center" onClick={ausfuehren} disabled={arbeitet || nutzer.nurLesen || (weg === 'email' && !isEmailGatewayConfigured)}>
                {arbeitet ? 'Einen Moment …' : weg === 'email' ? 'Jetzt senden' : 'PDF erstellen und ablegen'}
              </PrimaryButton>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
