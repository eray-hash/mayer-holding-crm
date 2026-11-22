import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Download, Eye, FileText, FolderInput } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { bilderVon, ExposeEinstellungenFelder, groesseText, MAX_BILDER, useExposeEinstellungen, useExposeKontext, type ExposeEinstellungen, type ExposeKontext } from './ExposePdf'
import { erzeugeExposePdf, type ExposeBild } from '../lib/exposePdf'
import { adresseVon, exposeFakten, objektartVon, preisText, standardTitel } from '../lib/exposeDaten'
import { ladeExposeBild, ladeLogo } from '../lib/exposeBilder'
import { ladeObjektDokumentHoch } from '../lib/objektDokumenteStorage'
import { ladeInteressentenDokumente, setzeInteressentenDokumente } from '../lib/objektPortal'
import { fmtDate, today, uid } from '../lib/dates'
import type { Dokument, Objekt } from '../types'

// „Exposé erstellen“ in der Objektakte (22.11.2026): wie „Exposé als PDF“ (ExposePdf.tsx) — gleiche
// Einstellungen, gleiche Datei —, dazu
//  - optional die Käuferprovision als Zeile in den Eckdaten (nie die Provision aus der Kurzprüfung),
//  - optional ein Vermittler (Name, Firma, Telefon, E-Mail, z. B. von einer Visitenkarte) als eigener Kasten,
//  - Vorschau im Browser, Herunterladen, Ablage im Ordner „Exposé“ und auf Wunsch gleich die Freigabe
//    für das Interessenten-Portal (objekte.interessenten_dokumente).
// Anlass: Wünsche „Erstellte Dokumente direkt in der Objektakte ablegen“ und „Exposé mit Kontaktdaten
// des Vermittlers vervollständigen“ (20.11.2026). Der Assistent kann dasselbe mit expose_erstellen.

type Vermittler = { name: string; firma: string; telefon: string; email: string }
const LEERER_VERMITTLER: Vermittler = { name: '', firma: '', telefon: '', email: '' }

type Ergebnis = { blob: Blob; seiten: number; groesse: number; dateiname: string; anzeigeName: string; ohneBilder: string[] }

function ascii(text: string): string {
  return text
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

async function erstelle(objekt: Objekt, e: ExposeEinstellungen, k: ExposeKontext, provision: string, vermittler: Vermittler): Promise<Ergebnis> {
  const alle = bilderVon(objekt)
  const gewaehlt = e.bilder.map((id) => alle.find((d) => d.id === id)).filter((d): d is Dokument => !!d).slice(0, MAX_BILDER)
  const ohneBilder: string[] = []
  const geladen = await Promise.all(
    gewaehlt.map((d, i) =>
      ladeExposeBild(d, i === 0 ? 'titel' : 'galerie').catch(() => {
        ohneBilder.push(d.name)
        return null
      }),
    ),
  )
  const logo = k.logoVorlage ? await ladeLogo(k.logoVorlage) : undefined
  const fakten = exposeFakten(objekt)
  // Provision vor den Kaufpreis (der steht in exposeFakten immer zuletzt).
  if (provision.trim()) fakten.splice(Math.max(0, fakten.length - 1), 0, { label: 'Käuferprovision', wert: provision.trim() })
  const ort = e.ort.trim()
  const titel = e.titel.trim() || standardTitel(objekt, ort)
  const doc = erzeugeExposePdf({
    titel,
    ortZeile: e.adresseZeigen ? adresseVon(objekt) || ort : ort,
    objektart: objektartVon(objekt),
    preisText: preisText(objekt),
    fakten,
    beschreibung: e.beschreibung,
    titelbild: geladen[0] ?? undefined,
    bilder: geladen.slice(1).filter((b): b is ExposeBild => !!b),
    logo,
    firma: k.firma,
    kontakt: k.kontakt,
    vermittler: vermittler.name.trim() || vermittler.firma.trim() ? vermittler : undefined,
    vertraulich: !!objekt.offMarket,
    stand: fmtDate(today()),
  })
  const blob = doc.output('blob')
  return {
    blob,
    seiten: doc.getNumberOfPages(),
    groesse: blob.size,
    dateiname: `Expose_${ascii(titel) || 'Objekt'}_${today()}.pdf`,
    anzeigeName: `Exposé ${titel} (${fmtDate(today())}).pdf`,
    ohneBilder,
  }
}

export function ObjektExposeErstellenDialog({ objekt, beschreibung, onClose }: { objekt: Objekt; beschreibung?: string; onClose: () => void }) {
  const { dispatch } = useApp()
  const kontext = useExposeKontext()
  const { e, aendere } = useExposeEinstellungen(objekt, beschreibung)
  const [provision, setProvision] = useState('')
  const [vermittler, setVermittler] = useState<Vermittler>(LEERER_VERMITTLER)
  const [vermittlerOffen, setVermittlerOffen] = useState(false)
  const [portal, setPortal] = useState(false)
  const [arbeitet, setArbeitet] = useState<'' | 'vorschau' | 'laden' | 'ablegen'>('')
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')

  const nichtGeladen = (r: Ergebnis) => (r.ohneBilder.length ? ` Nicht geladen: ${r.ohneBilder.join(', ')}.` : '')

  async function vorschau() {
    // Fenster sofort öffnen (sonst blockiert der Browser es nach dem Warten), dann die Datei hineinladen.
    const fenster = window.open('', '_blank')
    setArbeitet('vorschau')
    setFehler('')
    setMeldung('')
    try {
      const r = await erstelle(objekt, e, kontext, provision, vermittler)
      const url = URL.createObjectURL(r.blob)
      if (fenster) fenster.location.href = url
      else window.open(url, '_blank')
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000)
      setMeldung(`Vorschau geöffnet (${r.seiten} Seiten, ${groesseText(r.groesse)}).${nichtGeladen(r)}`)
    } catch (err) {
      fenster?.close()
      setFehler(err instanceof Error ? err.message : 'Das Exposé konnte nicht erstellt werden.')
    } finally {
      setArbeitet('')
    }
  }

  async function herunterladen() {
    setArbeitet('laden')
    setFehler('')
    setMeldung('')
    try {
      const r = await erstelle(objekt, e, kontext, provision, vermittler)
      const url = URL.createObjectURL(r.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.anzeigeName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setMeldung(`Exposé erstellt (${r.seiten} Seiten, ${groesseText(r.groesse)}).${nichtGeladen(r)}`)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Exposé konnte nicht erstellt werden.')
    } finally {
      setArbeitet('')
    }
  }

  async function ablegen() {
    setArbeitet('ablegen')
    setFehler('')
    setMeldung('')
    try {
      const r = await erstelle(objekt, e, kontext, provision, vermittler)
      const { pfad, groesse } = await ladeObjektDokumentHoch(objekt.id, new File([r.blob], r.dateiname, { type: 'application/pdf' }))
      const dokId = uid('dok')
      dispatch({
        type: 'ADD_DOKUMENT',
        objektId: objekt.id,
        ordner: 'Exposé',
        dokument: { id: dokId, name: r.anzeigeName, typ: 'application/pdf', datum: today(), groesse, url: pfad },
      })
      let portalText = ''
      if (portal) {
        try {
          const frei = await ladeInteressentenDokumente(objekt.id)
          if (!frei.includes(dokId)) await setzeInteressentenDokumente(objekt.id, [...frei, dokId])
          portalText = ' Für das Interessenten-Portal freigegeben.'
        } catch (err) {
          portalText = ` Die Freigabe für das Interessenten-Portal ging nicht (${err instanceof Error ? err.message : 'unbekannter Fehler'}) – bitte unter „Interessenten-Portal“ nachholen.`
        }
      }
      setMeldung(`Im Ordner „Exposé“ abgelegt (${r.seiten} Seiten, ${groesse}).${portalText}${nichtGeladen(r)}`)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Exposé konnte nicht abgelegt werden.')
    } finally {
      setArbeitet('')
    }
  }

  const vermittlerKurz = [vermittler.name, vermittler.firma].map((t) => t.trim()).filter(Boolean).join(', ')

  return (
    <Modal open onClose={() => !arbeitet && onClose()} title="Exposé erstellen" width="max-w-2xl">
      <p className="mb-3 text-xs text-slate-500">
        Das Exposé enthält Titel, Ort oder Adresse, Bilder, die Eckdaten aus dem Verkaufsdatenblatt, die Beschreibung und deine Kontaktdaten. Eigentümer, interne Notizen, Kurzprüfung, Bewertung und Abrechnung kommen nie hinein.
      </p>
      <ExposeEinstellungenFelder objekt={objekt} e={e} aendere={aendere} />

      <Field label="Käuferprovision (freiwillig, steht so in den Eckdaten)">
        <input className={inputClass} value={provision} onChange={(ev) => setProvision(ev.target.value)} placeholder="z. B. 3,57 % inkl. MwSt." />
      </Field>

      <div className="mb-3 rounded-lg border border-slate-100">
        <button type="button" onClick={() => setVermittlerOffen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm" aria-expanded={vermittlerOffen}>
          <span className="min-w-0">
            <span className="font-medium text-slate-700">Vermittler</span>
            <span className="block truncate text-xs text-slate-400">{vermittlerKurz || 'ohne – nur deine Kontaktdaten'}</span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-accent-700">
            {vermittlerOffen ? 'Zuklappen' : 'Angeben'} {vermittlerOffen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </span>
        </button>
        {vermittlerOffen && (
          <div className="border-t border-slate-100 px-3 pt-3">
            <p className="mb-2 text-xs text-slate-500">Erscheint als eigener Kasten „Vermittler“ neben deinen Kontaktdaten, z. B. mit den Angaben von seiner Visitenkarte.</p>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              <Field label="Name">
                <input className={inputClass} value={vermittler.name} onChange={(ev) => setVermittler({ ...vermittler, name: ev.target.value })} />
              </Field>
              <Field label="Firma">
                <input className={inputClass} value={vermittler.firma} onChange={(ev) => setVermittler({ ...vermittler, firma: ev.target.value })} />
              </Field>
              <Field label="Telefon">
                <input className={inputClass} type="tel" value={vermittler.telefon} onChange={(ev) => setVermittler({ ...vermittler, telefon: ev.target.value })} />
              </Field>
              <Field label="E-Mail">
                <input className={inputClass} type="email" value={vermittler.email} onChange={(ev) => setVermittler({ ...vermittler, email: ev.target.value })} />
              </Field>
            </div>
          </div>
        )}
      </div>

      <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent-600" checked={portal} onChange={(ev) => setPortal(ev.target.checked)} />
        <span>
          Beim Ablegen für das Interessenten-Portal freigeben
          <span className="block text-xs text-slate-400">Interessenten sehen es erst, nachdem sie im Portal den Bedingungen und der Provision zugestimmt haben.</span>
        </span>
      </label>

      {!kontext.logoVorlage && <p className="mb-3 text-xs text-slate-400">Kein Logo unter den Vorlagen gefunden – oben steht der Firmenname als Text.</p>}
      {fehler && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">{fehler}</span>
        </div>
      )}
      {meldung && (
        <p className="mb-3 flex items-start gap-1.5 text-xs font-medium text-emerald-700" role="status">
          <Check size={14} className="mt-0.5 flex-shrink-0" /> <span className="min-w-0 break-words">{meldung}</span>
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={onClose} disabled={!!arbeitet}>
          Schließen
        </SecondaryButton>
        <SecondaryButton onClick={vorschau} disabled={!!arbeitet}>
          <Eye size={14} /> {arbeitet === 'vorschau' ? 'Wird erstellt …' : 'Vorschau'}
        </SecondaryButton>
        <SecondaryButton onClick={herunterladen} disabled={!!arbeitet}>
          <Download size={14} /> {arbeitet === 'laden' ? 'Wird erstellt …' : 'Herunterladen'}
        </SecondaryButton>
        <PrimaryButton onClick={ablegen} disabled={!!arbeitet}>
          <FolderInput size={14} /> {arbeitet === 'ablegen' ? 'Wird abgelegt …' : 'In der Objektakte ablegen'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}

/** Knopf „Exposé erstellen“ (ersetzt in der Karte „Exposé“ den Knopf „Exposé als PDF“). */
export function ObjektExposeErstellen({ objekt, beschreibung }: { objekt: Objekt; beschreibung?: string }) {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <SecondaryButton onClick={() => setOffen(true)}>
        <FileText size={13} /> Exposé erstellen
      </SecondaryButton>
      {offen && <ObjektExposeErstellenDialog objekt={objekt} beschreibung={beschreibung} onClose={() => setOffen(false)} />}
    </>
  )
}
