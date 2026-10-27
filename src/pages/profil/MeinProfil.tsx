import { useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, User } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'

export function MeinProfil() {
  const { state, dispatch } = useApp()
  const [name, setName] = useState(state.profil.name)
  const [telefon, setTelefon] = useState(state.profil.telefon)
  const [email, setEmail] = useState(state.profil.email)
  const [signaturHtml, setSignaturHtml] = useState(state.profil.signaturHtml)
  const [buchungslink, setBuchungslink] = useState(state.profil.buchungslink ?? '')
  const [fotoDataUrl, setFotoDataUrl] = useState(state.profil.fotoDataUrl)
  const [gespeichert, setGespeichert] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFoto(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setFotoDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  function speichern() {
    dispatch({ type: 'UPDATE_PROFIL', patch: { name, telefon, email, signaturHtml, fotoDataUrl, buchungslink } })
    setGespeichert(true)
    setTimeout(() => setGespeichert(false), 2500)
  }

  function buchungslinkInSignaturEinfuegen() {
    if (!buchungslink.trim()) return
    setSignaturHtml((s) => `${s}\n<p><a href="${buchungslink.trim()}">Termin direkt online buchen</a></p>`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Mein Profil</h1>
      <p className="mb-5 text-sm text-slate-500">Persönliche Daten und E-Mail-Signatur.</p>

      <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        Diese Angaben sind aktuell lokal auf diesem Gerät gespeichert — sobald echte
        Mitarbeiter-Logins eingerichtet sind, wird daraus ein echtes, pro Person gespeichertes Profil.
      </div>

      <Card className="p-5">
        <div className="mb-5 flex items-center gap-4">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="group relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-slate-400"
            title="Profilbild ändern"
          >
            {fotoDataUrl ? <img src={fotoDataUrl} alt="Profilbild" className="h-full w-full object-cover" /> : <User size={28} />}
            <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/40 group-hover:opacity-100">
              <Camera size={16} />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFoto(e.target.files?.[0])}
          />
          <div>
            <p className="text-sm font-medium text-slate-800">{name || 'Unbenannt'}</p>
            <button onClick={() => fileInputRef.current?.click()} className="text-xs text-accent-600 hover:underline">
              Profilbild ändern
            </button>
          </div>
        </div>

        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefon">
          <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="+49 ..." />
        </Field>
        <Field label="E-Mail-Adresse">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@amayer-holding.com" />
        </Field>
        <Field label="Buchungslink (z. B. Calendly)">
          <div className="flex gap-2">
            <input className={inputClass} value={buchungslink} onChange={(e) => setBuchungslink(e.target.value)} placeholder="https://calendly.com/..." />
            <button
              onClick={buchungslinkInSignaturEinfuegen}
              disabled={!buchungslink.trim()}
              className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              In Signatur einfügen
            </button>
          </div>
        </Field>
      </Card>

      <Card className="mt-5 p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">E-Mail-Signatur (HTML)</h3>
        <p className="mb-3 text-xs text-slate-400">Wird an gesendete E-Mails aus dem Postfach angehängt.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <textarea
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            value={signaturHtml}
            onChange={(e) => setSignaturHtml(e.target.value)}
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Vorschau</p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: signaturHtml }} />
          </div>
        </div>
      </Card>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={speichern}>Speichern</PrimaryButton>
        {gespeichert && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <CheckCircle2 size={15} /> Gespeichert
          </span>
        )}
      </div>
    </div>
  )
}
