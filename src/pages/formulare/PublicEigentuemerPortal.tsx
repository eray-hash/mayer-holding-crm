import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Circle, Loader2, Upload, Camera } from 'lucide-react'
import { Card, Field, inputClass, PrimaryButton } from '../../components/ui'
import { uid, today } from '../../lib/dates'
import { holePublicObjekt, holeObjektUploadUrl, sendePublicObjektFormular, type PublicObjekt } from '../../lib/emailGateway'
import { ladeAlsEigentuemerHoch } from '../../lib/objektDokumenteStorage'
import { pruefeUnterlagenVollstaendigkeit } from '../../data/objektUnterlagenPflicht'
import type { Dokument, DokumentOrdnerName, Objekt } from '../../types'

// Öffentliches, nicht-authentifiziertes Eigentümer-Portal für ein Immobilien-Objekt (Quirin
// Lutzenberger, Immobilienfachwirt: "Eigentümer bekommt automatisch einen persönlichen Link, dort
// kann er Dokumente hochladen, fehlende Unterlagen sehen, Stammdaten bestätigen"). Bewusst (noch)
// ohne Vollmacht-/Maklervertrag-Unterschrift — das würde verbindliche Provisions-/Alleinauftrags-
// Konditionen voraussetzen, die der Mitarbeiter vor Linkversand festlegen müsste (siehe
// Projektnotiz); dieser erste Schritt deckt den unstrittigen Kern ab: Stammdaten + Unterlagen.
export function PublicEigentuemerPortal() {
  const { objektId } = useParams()
  const [objekt, setObjekt] = useState<PublicObjekt | null | undefined>(undefined)

  const [name, setName] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')
  const [ansprechpartner, setAnsprechpartner] = useState('')
  const [stammdatenSpeichern, setStammdatenSpeichern] = useState(false)
  const [stammdatenGespeichert, setStammdatenGespeichert] = useState(false)
  const [stammdatenFehler, setStammdatenFehler] = useState('')

  const [hochladenKategorie, setHochladenKategorie] = useState<string | null>(null)
  const [uploadFehler, setUploadFehler] = useState('')
  const [neuHochgeladen, setNeuHochgeladen] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!objektId) return
    holePublicObjekt(objektId)
      .then(setObjekt)
      .catch(() => setObjekt(null))
  }, [objektId])

  useEffect(() => {
    if (objekt?.eigentuemer) {
      setName(objekt.eigentuemer.name)
      setTelefon(objekt.eigentuemer.telefon)
      setEmail(objekt.eigentuemer.email)
      setAnsprechpartner(objekt.eigentuemer.ansprechpartner ?? '')
    }
  }, [objekt])

  if (!objektId || objekt === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Link ungültig</h1>
          <p className="text-sm text-slate-500">Dieser Link ist nicht mehr verfügbar. Bitte fordern Sie einen neuen Link an.</p>
        </Card>
      </div>
    )
  }

  if (objekt === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  // pruefeUnterlagenVollstaendigkeit braucht nur typ + dokumente — die übrigen Objekt-Felder sind
  // für die Berechnung irrelevant, daher hier unproblematisch als Teilobjekt durchgereicht. Bezieht
  // sich auf den beim Laden geholten Stand; gerade in dieser Sitzung hochgeladene Dokumente (siehe
  // neuHochgeladen) müssen separat eingerechnet werden, sonst bliebe die Prozentanzeige nach einem
  // erfolgreichen Upload stehen, obwohl die einzelne Zeile schon auf "erledigt" springt.
  const checkRoh = pruefeUnterlagenVollstaendigkeit(objekt as unknown as Objekt)
  const vorhandenGesamt = new Set([...checkRoh.vorhanden, ...Array.from(neuHochgeladen).filter((k) => checkRoh.pflicht.includes(k as DokumentOrdnerName))])
  const check = {
    ...checkRoh,
    vorhanden: Array.from(vorhandenGesamt) as DokumentOrdnerName[],
    prozent: checkRoh.pflicht.length === 0 ? 100 : Math.round((vorhandenGesamt.size / checkRoh.pflicht.length) * 100),
  }

  async function stammdatenSpeichernKlick() {
    if (!name.trim() || !telefon.trim() || !email.trim()) {
      setStammdatenFehler('Bitte Name, Telefon und E-Mail-Adresse angeben.')
      return
    }
    setStammdatenFehler('')
    setStammdatenSpeichern(true)
    try {
      await sendePublicObjektFormular({
        objektId: objektId!,
        aktivitaetText: 'Stammdaten vom Eigentümer bestätigt/aktualisiert.',
        eigentuemer: { name: name.trim(), telefon: telefon.trim(), email: email.trim(), ansprechpartner: ansprechpartner.trim() || undefined },
      })
      setStammdatenGespeichert(true)
    } catch (err) {
      setStammdatenFehler(err instanceof Error ? err.message : 'Speichern fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setStammdatenSpeichern(false)
    }
  }

  async function dateiHochladen(kategorie: DokumentOrdnerName, file: File | undefined) {
    if (!file) return
    setHochladenKategorie(kategorie)
    setUploadFehler('')
    try {
      const { pfad, token } = await holeObjektUploadUrl(objektId!, file.name)
      const { groesse } = await ladeAlsEigentuemerHoch(pfad, token, file)
      const dokument: Dokument = { id: uid('dok'), name: file.name, typ: file.type || 'Datei', datum: today(), groesse, url: pfad }
      await sendePublicObjektFormular({
        objektId: objektId!,
        aktivitaetText: `Dokument vom Eigentümer hochgeladen: „${file.name}" (${kategorie}).`,
        dokument,
        ordner: kategorie,
      })
      setNeuHochgeladen((s) => new Set(s).add(kategorie))
    } catch (err) {
      setUploadFehler(err instanceof Error ? err.message : 'Hochladen fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setHochladenKategorie(null)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstrasse 3, 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Ihr Objekt bei uns</h1>
          <p className="mt-1 text-sm text-slate-500">{objekt.bezeichnung} · {objekt.adresse}</p>
        </div>

        <Card className="mb-5 p-6">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Ihre Kontaktdaten</h2>
          <p className="mb-4 text-xs text-slate-500">
            Bitte bestätigen oder korrigieren Sie Ihre Daten. Falls im Tagesgeschäft eine andere Person als Sie selbst
            Ansprechpartner ist (z. B. Hausverwaltung, Familienangehörige), tragen Sie diese bitte zusätzlich ein.
          </p>
          <Field label="Name *">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Telefon *">
            <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} />
          </Field>
          <Field label="E-Mail-Adresse *">
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Abweichender Ansprechpartner (optional)">
            <input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} />
          </Field>
          {stammdatenFehler && <p className="mb-3 text-sm font-medium text-rose-600">{stammdatenFehler}</p>}
          <PrimaryButton onClick={stammdatenSpeichernKlick} disabled={stammdatenSpeichern}>
            {stammdatenSpeichern ? 'Wird gespeichert …' : stammdatenGespeichert ? 'Erneut speichern' : 'Daten bestätigen'}
          </PrimaryButton>
          {stammdatenGespeichert && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Gespeichert.</p>}
        </Card>

        <Card className="mb-5 p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Benötigte Unterlagen</h2>
            <span className="text-sm font-semibold text-slate-700">{check.prozent} %</span>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${check.prozent === 100 ? 'bg-emerald-500' : 'bg-accent-500'}`} style={{ width: `${check.prozent}%` }} />
          </div>
          {check.pflicht.length === 0 ? (
            <p className="text-sm text-slate-500">Für dieses Objekt sind aktuell keine bestimmten Unterlagen hinterlegt.</p>
          ) : (
            <div className="space-y-2">
              {check.pflicht.map((kategorie) => {
                const vorhanden = check.vorhanden.includes(kategorie) || neuHochgeladen.has(kategorie)
                return (
                  <div key={kategorie} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      {vorhanden ? <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-500" /> : <Circle size={16} className="flex-shrink-0 text-slate-300" />}
                      <span className={vorhanden ? 'text-slate-600' : 'font-medium text-slate-700'}>{kategorie}</span>
                    </div>
                    <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                      {hochladenKategorie === kategorie ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Upload size={13} />
                      )}
                      {vorhanden ? 'Ersetzen' : 'Hochladen'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        disabled={hochladenKategorie !== null}
                        onChange={(e) => dateiHochladen(kategorie, e.target.files?.[0])}
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="mb-5 p-6">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Fotos</h2>
          <p className="mb-4 text-xs text-slate-500">Aktuelle Fotos des Objekts (innen/außen) für die Vermarktung.</p>
          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm font-medium text-slate-600 hover:bg-slate-50">
            {hochladenKategorie === 'Bilder' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            Foto hochladen
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={hochladenKategorie !== null}
              onChange={(e) => dateiHochladen('Bilder', e.target.files?.[0])}
            />
          </label>
          {neuHochgeladen.has('Bilder') && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Foto(s) hochgeladen — weitere Fotos einfach erneut hochladen.</p>}
        </Card>

        {uploadFehler && (
          <p className="mb-5 rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-600">{uploadFehler}</p>
        )}

        <p className="text-center text-xs text-slate-400">
          Bei Fragen erreichen Sie uns jederzeit unter den Ihnen bekannten Kontaktdaten der Andreas Mayer Holding.
        </p>
      </div>
    </div>
  )
}
