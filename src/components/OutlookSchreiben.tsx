import { useState } from 'react'
import { Send, X } from 'lucide-react'
import { sendeUeberOutlook, type SendeArt } from '../lib/vormerkungen'
import type { OutlookMail } from '../lib/outlook'
import { Field, PrimaryButton, SecondaryButton, inputClass } from './ui'

type Modus = 'neu' | 'antworten' | 'allen' | 'weiterleiten'

/** Mail über Hotmail schreiben, beantworten oder weiterleiten. Senden nur nach Klick + Rückfrage. */
export function OutlookSchreiben({ modus, mail, onFertig }: { modus: Modus; mail?: OutlookMail; onFertig: (meldung?: string) => void }) {
  const [an, setAn] = useState('')
  const [cc, setCc] = useState('')
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')

  const titel = modus === 'neu' ? 'Neue Mail' : modus === 'weiterleiten' ? 'Weiterleiten' : modus === 'allen' ? 'Allen antworten' : 'Antworten'
  const liste = (t: string) => t.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean)

  async function senden() {
    setFehler('')
    const empf = modus === 'antworten' || modus === 'allen' ? [mail?.von.adresse ?? ''] : liste(an)
    if ((modus === 'neu' || modus === 'weiterleiten') && empf.length === 0) return setFehler('Bitte mindestens einen Empfänger angeben.')
    if (modus !== 'weiterleiten' && !text.trim()) return setFehler('Die Mail hat keinen Text.')
    const frage =
      modus === 'neu'
        ? `Mail „${betreff || '(ohne Betreff)'}“ jetzt an ${empf.join(', ')} senden?`
        : modus === 'weiterleiten'
          ? `„${mail?.betreff}“ jetzt an ${empf.join(', ')} weiterleiten?`
          : `Antwort auf „${mail?.betreff}“ jetzt senden${modus === 'allen' ? ' (an alle)' : ` an ${empf[0]}`}?`
    if (!window.confirm(frage)) return
    setArbeitet(true)
    try {
      const art: SendeArt = modus === 'neu' ? 'mail_senden' : modus === 'weiterleiten' ? 'mail_weiterleiten' : 'mail_antworten'
      const parameter =
        modus === 'neu'
          ? { an: empf, cc: liste(cc), betreff, text }
          : modus === 'weiterleiten'
            ? { mailId: mail!.id, an: empf, text, bezug: mail!.betreff }
            : { mailId: mail!.id, text, allen: modus === 'allen', bezug: mail!.betreff }
      onFertig(await sendeUeberOutlook(art, parameter))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-accent-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">
          {titel}
          {mail && modus !== 'neu' && <span className="font-normal text-slate-500"> · {mail.betreff}</span>}
        </h3>
        <button className="text-slate-400 hover:text-slate-600" title="Schließen" onClick={() => onFertig()}>
          <X size={16} />
        </button>
      </div>
      {(modus === 'neu' || modus === 'weiterleiten') && (
        <Field label="An (mehrere mit Komma)">
          <input className={inputClass} value={an} onChange={(e) => setAn(e.target.value)} />
        </Field>
      )}
      {modus === 'neu' && (
        <>
          <Field label="Kopie an (optional)">
            <input className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
          <Field label="Betreff">
            <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </Field>
        </>
      )}
      {(modus === 'antworten' || modus === 'allen') && mail && <p className="text-xs text-slate-500">An {mail.von.name || mail.von.adresse}{modus === 'allen' ? ' und alle anderen Empfänger' : ''} — die Originalmail wird darunter zitiert.</p>}
      <Field label={modus === 'weiterleiten' ? 'Text dazu (optional)' : 'Text'}>
        <textarea className={`${inputClass} min-h-[10rem]`} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
      <div className="flex gap-2">
        <PrimaryButton onClick={senden} disabled={arbeitet}>
          <Send size={15} /> {arbeitet ? 'Wird gesendet …' : 'Senden'}
        </PrimaryButton>
        <SecondaryButton onClick={() => onFertig()} disabled={arbeitet}>
          Abbrechen
        </SecondaryButton>
      </div>
    </div>
  )
}
