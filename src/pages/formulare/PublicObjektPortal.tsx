// Interessenten-Portal (21.11.2026): Der Interessent öffnet seinen Link, stimmt AGB, Provisionsvereinbarung
// und dem vorzeitigen Beginn zu und sieht danach die Objektdaten und freigegebenen Unterlagen.
// Seit 22.11.2026 bucht er dort auch selbst einen Besichtigungstermin (oder bittet um Rückruf).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarCheck, CalendarDays, FileText, Home, Loader2, Lock, Phone } from 'lucide-react'
import { Card, PrimaryButton } from '../../components/ui'
import { DatenschutzHinweis } from '../../components/DatenschutzHinweis'
import { fmtEUR } from '../../lib/dates'
import { holePortal, holePortalDokument, portalBesichtigen, stimmePortalZu, type PortalBesichtigung, type PortalSeite } from '../../lib/objektPortal'
import { tagLang, tagSchluessel, uhr } from '../../../supabase/functions/_shared/besichtigungZeiten.ts'

/** Vorlagen-Text (# Titel, ## Abschnitt, **fett**) lesbar darstellen. */
function Vertragstext({ text }: { text: string }) {
  const fett = (zeile: string): ReactNode[] => zeile.split(/(\*\*[^*]+\*\*)/).map((t, i) => (t.startsWith('**') && t.endsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : t))
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-700">
      {text.split('\n').map((z, i) => {
        if (z.startsWith('# ')) return <h3 key={i} className="pt-1 text-sm font-semibold text-slate-800">{z.slice(2)}</h3>
        if (z.startsWith('## ')) return <h4 key={i} className="pt-2 font-semibold text-slate-800">{z.slice(3)}</h4>
        if (!z.trim()) return null
        return <p key={i}>{fett(z)}</p>
      })}
    </div>
  )
}

function Kopf() {
  return <p className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstraße 3, 89075 Ulm</p>
}

export function PublicObjektPortal() {
  const { token } = useParams()
  const [seite, setSeite] = useState<PortalSeite | null>(null)
  const [name, setName] = useState('')
  const [agb, setAgb] = useState(false)
  const [provision, setProvision] = useState(false)
  const [sofort, setSofort] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    if (!token) return
    holePortal(token)
      .then((s) => {
        setSeite(s)
        if (s.stufe === 'zustimmung') setName(s.name)
      })
      .catch(() => setSeite({ stufe: 'ungueltig', grund: 'Die Seite lässt sich gerade nicht laden. Bitte versuchen Sie es später erneut.' }))
  }, [token])

  async function zustimmen() {
    if (!token) return
    setLaeuft(true)
    setFehler('')
    try {
      const s = await stimmePortalZu(token, { name, agb, provision, sofortBeginn: sofort })
      if (s.stufe === 'fehler') setFehler(s.grund)
      else {
        setSeite(s)
        window.scrollTo({ top: 0 })
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  async function oeffne(id: string) {
    if (!token) return
    const fenster = window.open('', '_blank')
    try {
      const url = await holePortalDokument(token, id)
      if (fenster) fenster.location.href = url
      else window.location.href = url
    } catch (e) {
      fenster?.close()
      setFehler(e instanceof Error ? e.message : 'Das Dokument lässt sich gerade nicht öffnen.')
    }
  }

  if (!seite) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    )
  }

  if (seite.stufe === 'ungueltig' || seite.stufe === 'fehler') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md p-8 text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={32} />
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Kein Zugang</h1>
          <p className="text-sm text-slate-500">{seite.grund}</p>
        </Card>
      </div>
    )
  }

  if (seite.stufe === 'zustimmung') {
    const o = seite.objekt
    const bereit = agb && provision && sofort && name.trim().length >= 3
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-4">
          <Kopf />
          <h1 className="text-center text-xl font-bold text-slate-800">Ihre Unterlagen zum Objekt</h1>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <Home className="mt-0.5 shrink-0 text-accent-600" size={26} />
              <div>
                <h2 className="text-lg font-semibold text-slate-800">{o.bezeichnung}</h2>
                <p className="text-sm text-slate-500">{[o.ort, o.typ].filter(Boolean).join(' · ')}</p>
                {o.kaufpreis !== null && <p className="mt-1 text-sm font-medium text-slate-700">Kaufpreis {fmtEUR(o.kaufpreis)}</p>}
              </div>
            </div>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Guten Tag {seite.name}, bevor wir Ihnen die genaue Adresse, das Exposé und die Unterlagen zeigen, bitten wir Sie, unseren Bedingungen und der Provisionsvereinbarung zuzustimmen. Das dauert eine Minute.
            </p>
          </Card>

          {[
            { titel: 'Allgemeine Geschäftsbedingungen', text: seite.texte.agb },
            { titel: 'Provisionsvereinbarung', text: seite.texte.provision },
            { titel: 'Widerrufsbelehrung', text: seite.texte.widerruf },
          ].map((t) => (
            <Card key={t.titel} className="p-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><FileText size={16} className="text-slate-400" /> {t.titel}</h2>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-100 p-3">
                <Vertragstext text={t.text || 'Text folgt.'} />
              </div>
            </Card>
          ))}

          <Card className="space-y-3 p-5">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={agb} onChange={(e) => setAgb(e.target.checked)} />
              Ich habe die Allgemeinen Geschäftsbedingungen gelesen und stimme ihnen zu.
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={provision} onChange={(e) => setProvision(e.target.checked)} />
              Ich schließe die oben stehende Provisionsvereinbarung ab und verpflichte mich bei Erwerb des Objekts zur genannten Provision.
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={sofort} onChange={(e) => setSofort(e.target.checked)} />
              Ich verlange ausdrücklich, dass Sie vor Ablauf der Widerrufsfrist mit Ihrer Tätigkeit beginnen und mir die Unterlagen sofort zeigen. Mir ist bekannt, dass ich mein Widerrufsrecht bei vollständiger Vertragserfüllung verliere.
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Ihr vollständiger Name (gilt als Ihre Zustimmung)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" autoComplete="name" />
            </label>
            {fehler && <p className="text-sm font-medium text-rose-600">{fehler}</p>}
            <PrimaryButton className="w-full justify-center" disabled={!bereit || laeuft} onClick={zustimmen}>
              {laeuft ? 'Wird gespeichert …' : 'Zustimmen und Unterlagen ansehen'}
            </PrimaryButton>
            <p className="text-xs text-slate-400">Ihre Zustimmung wird mit Datum, Uhrzeit und dem genauen Wortlaut gespeichert. Eine Kopie erhalten Sie auf Wunsch von uns.</p>
          </Card>
          <DatenschutzHinweis />
        </div>
      </div>
    )
  }

  const o = seite.objekt
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Kopf />
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <Home className="mt-0.5 shrink-0 text-accent-600" size={26} />
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{o.bezeichnung}</h1>
              <p className="text-sm text-slate-500">{o.adresse}</p>
              <p className="mt-1 text-sm text-slate-600">
                {[o.typ, o.kaufpreis !== null ? `Kaufpreis ${fmtEUR(o.kaufpreis)}` : ''].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          {o.beschreibung && <p className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">{o.beschreibung}</p>}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Unterlagen</h2>
          {seite.dokumente.length === 0 ? (
            <p className="text-sm text-slate-500">Die Unterlagen werden gerade vorbereitet. Wir melden uns, sobald sie bereitstehen.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {seite.dokumente.map((d) => (
                <li key={d.id}>
                  <button onClick={() => oeffne(d.id)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-slate-50">
                    <FileText size={18} className="shrink-0 text-accent-600" />
                    <span className="min-w-0 flex-1 text-slate-700">{d.name}</span>
                    <span className="text-xs text-slate-400">{d.groesse}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fehler && <p className="mt-2 text-sm font-medium text-rose-600">{fehler}</p>}
        </Card>
        {token && <Besichtigung token={token} stand={seite.besichtigung} hinweis={seite.hinweis} onSeite={setSeite} />}
        <p className="text-center text-xs text-slate-400">
          Sie haben am {seite.zugestimmtAm ? new Date(seite.zugestimmtAm).toLocaleString('de-DE') : '–'} zugestimmt. Fragen? Antworten Sie einfach auf unsere E-Mail oder rufen Sie uns an: 0176 209 671 39.
        </p>
        <DatenschutzHinweis />
      </div>
    </div>
  )
}

/** „Besichtigung vereinbaren“: freie Zeiten wählen, eigenen Termin sehen und absagen, oder um Rückruf bitten. */
function Besichtigung({ token, stand, hinweis, onSeite }: { token: string; stand?: PortalBesichtigung; hinweis?: string; onSeite: (s: PortalSeite) => void }) {
  const [gewaehlt, setGewaehlt] = useState('')
  const [telefon, setTelefon] = useState('')
  const [nachricht, setNachricht] = useState('')
  const [rueckrufOffen, setRueckrufOffen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const b = stand ?? { zeiten: [], meine: null, rueckrufAm: null }

  const tage = useMemo(() => {
    const je = new Map<string, PortalBesichtigung['zeiten']>()
    for (const z of b.zeiten) je.set(tagSchluessel(z.beginn), [...(je.get(tagSchluessel(z.beginn)) ?? []), z])
    return [...je.values()]
  }, [b.zeiten])
  const auswahl = b.zeiten.find((z) => z.id === gewaehlt)

  async function los(e: Parameters<typeof portalBesichtigen>[1]) {
    setLaeuft(true)
    setFehler('')
    try {
      const s = await portalBesichtigen(token, e)
      if (s.stufe === 'fehler') setFehler(s.grund)
      else {
        setGewaehlt('')
        setRueckrufOffen(false)
        onSeite(s)
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <CalendarDays size={16} className="text-slate-400" /> Besichtigung vereinbaren
      </h2>
      {hinweis && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{hinweis}</p>}

      {b.meine ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CalendarCheck size={16} /> Ihr Besichtigungstermin
          </p>
          <p className="mt-1 text-sm text-emerald-900">
            {tagLang(b.meine.beginn)}, {uhr(b.meine.beginn)}–{uhr(b.meine.ende)} Uhr
          </p>
          {b.meine.treffpunkt && <p className="text-sm text-emerald-800">Treffpunkt: {b.meine.treffpunkt}</p>}
          {b.meine.makler && <p className="text-sm text-emerald-800">Es begleitet Sie: {b.meine.makler}</p>}
          <button
            disabled={laeuft}
            onClick={() => {
              if (window.confirm('Möchten Sie diesen Besichtigungstermin wirklich absagen?')) void los({ art: 'absagen', besichtigungId: b.meine!.id })
            }}
            className="mt-3 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Termin absagen
          </button>
        </div>
      ) : (
        <>
          {tage.length === 0 ? (
            <p className="text-sm text-slate-500">Zurzeit sind keine Besichtigungstermine frei. Gern rufen wir Sie an und vereinbaren einen Termin mit Ihnen.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Bitte wählen Sie einen Termin:</p>
              {tage.map((liste) => (
                <div key={liste[0].id}>
                  <div className="mb-1 text-xs font-medium text-slate-500">{tagLang(liste[0].beginn)}</div>
                  <div className="flex flex-wrap gap-2">
                    {liste.map((z) => (
                      <button
                        key={z.id}
                        onClick={() => setGewaehlt(z.id === gewaehlt ? '' : z.id)}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${z.id === gewaehlt ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                      >
                        {uhr(z.beginn)} Uhr
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {auswahl && (
                <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                  <p className="text-sm text-slate-700">
                    <strong>
                      {tagLang(auswahl.beginn)}, {uhr(auswahl.beginn)}–{uhr(auswahl.ende)} Uhr
                    </strong>
                    {auswahl.treffpunkt && <><br />Treffpunkt: {auswahl.treffpunkt}</>}
                    {auswahl.makler && <><br />Es begleitet Sie: {auswahl.makler}</>}
                  </p>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Telefon für Rückfragen (freiwillig)</span>
                    <input value={telefon} onChange={(e) => setTelefon(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" autoComplete="tel" inputMode="tel" />
                  </label>
                  <PrimaryButton className="w-full justify-center" disabled={laeuft} onClick={() => void los({ art: 'buchen', zeitId: auswahl.id, telefon: telefon.trim() || undefined })}>
                    {laeuft ? 'Wird gebucht …' : 'Diesen Termin buchen'}
                  </PrimaryButton>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3">
            {b.rueckrufAm && !rueckrufOffen ? (
              <p className="text-sm text-slate-500">Ihr Rückrufwunsch vom {new Date(b.rueckrufAm).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} Uhr liegt uns vor. Wir melden uns bei Ihnen.</p>
            ) : !rueckrufOffen ? (
              <button onClick={() => setRueckrufOffen(true)} className="flex items-center gap-2 text-sm font-medium text-accent-700 hover:underline">
                <Phone size={14} /> {tage.length === 0 ? 'Bitte rufen Sie mich an' : 'Keiner passt — bitte rufen Sie mich an'}
              </button>
            ) : (
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Ihre Telefonnummer</span>
                  <input value={telefon} onChange={(e) => setTelefon(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" autoComplete="tel" inputMode="tel" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Wann passt es Ihnen? (freiwillig)</span>
                  <textarea value={nachricht} onChange={(e) => setNachricht(e.target.value)} rows={2} maxLength={500} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="z. B. werktags ab 17 Uhr" />
                </label>
                <div className="flex gap-2">
                  <PrimaryButton disabled={laeuft} onClick={() => void los({ art: 'rueckruf', telefon: telefon.trim() || undefined, nachricht: nachricht.trim() || undefined })}>
                    {laeuft ? 'Wird gesendet …' : 'Rückruf anfordern'}
                  </PrimaryButton>
                  <button onClick={() => setRueckrufOffen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {fehler && <p className="mt-2 text-sm font-medium text-rose-600">{fehler}</p>}
    </Card>
  )
}
