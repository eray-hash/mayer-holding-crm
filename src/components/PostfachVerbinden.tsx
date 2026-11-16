import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Mail } from 'lucide-react'
import { verbindePostfach } from '../lib/emailGateway'
import { ladePostfaecherNeu } from '../lib/postfaecher'
import { Field, inputClass, PrimaryButton } from './ui'

/**
 * Ein Postfach verbinden: Adresse + das Passwort des Postfachs — den Mail-Server findet das CRM selbst.
 * Das Passwort wird nur an den eigenen Server geschickt, dort geprüft und verschlüsselt abgelegt.
 */
export function PostfachVerbinden({
  adresse: vorgabe,
  gemeinsam = false,
  adresseAenderbar = true,
  onVerbunden,
}: {
  adresse?: string
  /** Gemeinsames Postfach für alle (nur Geschäftsführung) statt des eigenen. */
  gemeinsam?: boolean
  adresseAenderbar?: boolean
  onVerbunden?: (adresse: string) => void
}) {
  const [adresse, setAdresse] = useState(vorgabe ?? '')
  const [anzeigeName, setAnzeigeName] = useState('')
  const [passwort, setPasswort] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState('')
  const [nurEmpfang, setNurEmpfang] = useState(false)

  async function verbinden(e: React.FormEvent) {
    e.preventDefault()
    setLaeuft(true)
    setFehler('')
    try {
      const ergebnis = await verbindePostfach({ adresse: adresse.trim(), passwort, gemeinsam, anzeigeName: anzeigeName.trim() || undefined })
      setPasswort('')
      setNurEmpfang(ergebnis.nurEmpfang === true)
      setFertig(ergebnis.adresse)
      await ladePostfaecherNeu().catch(() => {})
      onVerbunden?.(ergebnis.adresse)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Postfach konnte nicht verbunden werden.')
    } finally {
      setLaeuft(false)
    }
  }

  if (fertig) {
    return (
      <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
        <span>
          <strong>{fertig}</strong> ist verbunden{nurEmpfang ? ' — nur für den Empfang' : ''}.{' '}
          {nurEmpfang
            ? 'Mails an diese Adresse kommen ab jetzt im CRM an. Senden unter dieser Adresse geht über das CRM nicht: Der Mail-Anbieter lässt den Versand von unserem Server nicht zu.'
            : gemeinsam
              ? 'Alle Mitarbeiter können jetzt von dieser Adresse senden.'
              : 'Die letzten Mails werden gerade abgeholt, neue kommen ab jetzt von selbst.'}
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={verbinden}>
      <Field label="E-Mail-Adresse des Postfachs">
        <input
          className={inputClass}
          type="email"
          value={adresse}
          disabled={!adresseAenderbar || laeuft}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="name@firma.de"
          autoComplete="username"
        />
      </Field>
      {gemeinsam && (
        <Field label="Absendername (optional)">
          <input className={inputClass} value={anzeigeName} disabled={laeuft} onChange={(e) => setAnzeigeName(e.target.value)} placeholder="z. B. Coach ES" />
        </Field>
      )}
      <Field label="Passwort dieses Postfachs">
        <input className={inputClass} type="password" value={passwort} disabled={laeuft} onChange={(e) => setPasswort(e.target.value)} autoComplete="off" />
      </Field>
      <p className="mb-3 text-xs text-slate-500">
        Gemeint ist das Passwort, mit dem du dich bei deinem Mail-Anbieter anmeldest — nicht das fürs CRM. Es wird geprüft und verschlüsselt hinterlegt; den Mail-Server findet das CRM selbst.
      </p>
      {fehler && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {fehler}
        </div>
      )}
      <PrimaryButton type="submit" disabled={laeuft || !adresse.trim() || !passwort}>
        <Mail size={14} /> {laeuft ? 'Wird geprüft … (bis zu 30 Sekunden)' : 'Postfach verbinden'}
      </PrimaryButton>
    </form>
  )
}
