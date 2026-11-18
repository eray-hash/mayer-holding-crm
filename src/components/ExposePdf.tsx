import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Download, FileText, FolderInput, ImageOff } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { CURRENT_USER } from '../data/constants'
import { briefkopfAus } from '../data/briefkopf'
import { erzeugeExposePdf, type ExposeBild } from '../lib/exposePdf'
import { adresseVon, exposeFakten, interneAngabenIn, objektartVon, ortVon, preisText, standardTitel } from '../lib/exposeDaten'
import { findeLogoVorlage, istBild, ladeExposeBild, ladeLogo, objektDateiUrl } from '../lib/exposeBilder'
import { ladeObjektDokumentHoch } from '../lib/objektDokumenteStorage'
import { fmtDate, today, uid } from '../lib/dates'
import type { Dokument, Objekt } from '../types'
import type jsPDF from 'jspdf'

/** Titelbild + bis zu sechs Bilder für die Bilderseite. */
export const MAX_BILDER = 7

// ── Einstellungen (Titel, Ort, Adresse, Text, Bilder) — auch im Fenster „An passende Gesuche schicken“ ──

export type ExposeEinstellungen = {
  titel: string
  ort: string
  adresseZeigen: boolean
  beschreibung: string
  /** Gewählte Bilder (Dokument-Kennungen) in ihrer Reihenfolge; das erste ist das Titelbild. */
  bilder: string[]
}

export function bilderVon(objekt: Objekt): Dokument[] {
  return (objekt.dokumente.Bilder ?? []).filter(istBild)
}

export function useExposeEinstellungen(objekt: Objekt, startText?: string) {
  const [e, setE] = useState<ExposeEinstellungen>(() => {
    const ort = ortVon(objekt)
    return {
      titel: standardTitel(objekt, ort),
      ort,
      adresseZeigen: false,
      beschreibung: startText ?? objekt.exposeText ?? '',
      bilder: bilderVon(objekt)
        .slice(0, MAX_BILDER)
        .map((d) => d.id),
    }
  })
  const aendere = (patch: Partial<ExposeEinstellungen>) => setE((alt) => ({ ...alt, ...patch }))
  return { e, aendere }
}

/** Kleines Vorschaubild über einen kurz gültigen Link. */
function Vorschau({ d }: { d: Dokument }) {
  const [url, setUrl] = useState('')
  const [fehler, setFehler] = useState(false)
  useEffect(() => {
    let aktiv = true
    objektDateiUrl(d)
      .then((u) => aktiv && setUrl(u))
      .catch(() => aktiv && setFehler(true))
    return () => {
      aktiv = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.url])
  return (
    <span className="flex h-10 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100">
      {url && !fehler ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFehler(true)} />
      ) : fehler ? (
        <ImageOff size={14} className="text-slate-400" />
      ) : null}
    </span>
  )
}

export function ExposeEinstellungenFelder({ objekt, e, aendere }: { objekt: Objekt; e: ExposeEinstellungen; aendere: (p: Partial<ExposeEinstellungen>) => void }) {
  const alle = bilderVon(objekt)
  const gewaehlt = e.bilder.map((id) => alle.find((d) => d.id === id)).filter((d): d is Dokument => !!d)
  const uebrige = alle.filter((d) => !e.bilder.includes(d.id))
  const voll = gewaehlt.length >= MAX_BILDER
  const warnungen = interneAngabenIn(objekt, `${e.titel}\n${e.ort}\n${e.beschreibung}`, e.adresseZeigen)
  const adresse = adresseVon(objekt)

  function schalte(id: string) {
    aendere({ bilder: e.bilder.includes(id) ? e.bilder.filter((x) => x !== id) : voll ? e.bilder : [...e.bilder, id] })
  }
  function schiebe(i: number, um: -1 | 1) {
    const neu = [...e.bilder]
    const j = i + um
    if (j < 0 || j >= neu.length) return
    ;[neu[i], neu[j]] = [neu[j], neu[i]]
    aendere({ bilder: neu })
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Titel im Exposé">
          <input className={inputClass} value={e.titel} onChange={(ev) => aendere({ titel: ev.target.value })} />
        </Field>
        <Field label="Ort (ohne Straße)">
          <input className={inputClass} value={e.ort} onChange={(ev) => aendere({ ort: ev.target.value })} placeholder="z. B. Ulm" />
        </Field>
      </div>
      {!e.ort.trim() && !e.adresseZeigen && <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Der Ort ließ sich nicht sicher aus der Adresse lesen – bitte eintragen.</p>}
      <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent-600" checked={e.adresseZeigen} onChange={(ev) => aendere({ adresseZeigen: ev.target.checked })} />
        <span>
          Adresse zeigen
          <span className="block text-xs text-slate-400">{e.adresseZeigen ? `Im Exposé steht: ${adresse || '–'}` : 'Ohne Haken steht nur der Ort im Exposé.'}</span>
        </span>
      </label>

      <Field label="Beschreibung (nur für dieses Exposé – der gespeicherte Text bleibt, wie er ist)">
        <textarea className={inputClass} rows={6} value={e.beschreibung} onChange={(ev) => aendere({ beschreibung: ev.target.value })} placeholder="Noch kein Exposé-Text hinterlegt." />
      </Field>
      {warnungen.length > 0 && (
        <div className="-mt-1 mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">Im Titel oder Text steht noch: {warnungen.join(', ')}. Bitte entfernen, wenn das Exposé anonym sein soll.</span>
        </div>
      )}

      <div className="mb-1 text-xs font-medium text-slate-500">
        Bilder aus dem Ordner „Bilder“ · das erste wird das Titelbild, bis zu sechs weitere kommen auf die Bilderseite
      </div>
      {alle.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">Im Ordner „Bilder“ liegen keine Fotos. Das Exposé entsteht dann ohne Bilder.</p>
      ) : (
        <ul className="mb-3 space-y-1 rounded-lg border border-slate-100 p-1.5 sm:max-h-72 sm:overflow-y-auto">
          {gewaehlt.map((d, i) => (
            <li key={d.id} className="flex items-center gap-2 rounded-md bg-accent-50/50 px-2 py-1.5 text-sm">
              <input type="checkbox" className="h-4 w-4 flex-shrink-0 rounded border-slate-300 text-accent-600" checked onChange={() => schalte(d.id)} aria-label={`${d.name} abwählen`} />
              <Vorschau d={d} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-700">{d.name}</span>
                <span className="text-xs text-slate-400">{i === 0 ? 'Titelbild' : `Bild ${i}`}</span>
              </span>
              <button type="button" onClick={() => schiebe(i, -1)} disabled={i === 0} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30" aria-label="Nach oben">
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => schiebe(i, 1)} disabled={i === gewaehlt.length - 1} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30" aria-label="Nach unten">
                <ArrowDown size={14} />
              </button>
            </li>
          ))}
          {uebrige.map((d) => (
            <li key={d.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${voll ? 'opacity-50' : ''}`}>
              <input type="checkbox" className="h-4 w-4 flex-shrink-0 rounded border-slate-300 text-accent-600" checked={false} disabled={voll} onChange={() => schalte(d.id)} aria-label={`${d.name} wählen`} />
              <Vorschau d={d} />
              <span className="min-w-0 flex-1 truncate text-slate-600">{d.name}</span>
            </li>
          ))}
        </ul>
      )}
      {voll && uebrige.length > 0 && <p className="-mt-2 mb-3 text-xs text-slate-400">Höchstens {MAX_BILDER} Bilder – erst eines abwählen, um ein anderes zu nehmen.</p>}
    </div>
  )
}

// ── PDF erzeugen ─────────────────────────────────────────────────────────────────────────────────

export type ExposeErgebnis = {
  doc: jsPDF
  blob: Blob
  groesse: number
  /** Ablagename (nur ASCII, für den Speicherort). */
  dateiname: string
  /** Anzeigename in den Unterlagen und im Mailanhang. */
  anzeigeName: string
  /** Bilder, die nicht geladen werden konnten. */
  ohneBilder: string[]
}

function ascii(text: string): string {
  return text
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

export function groesseText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** Absender-Angaben für den Kasten „Ihr Ansprechpartner“: aus „Mein Profil“, sonst aus dem Login. */
export function useExposeKontext() {
  const { state } = useApp()
  const { mitarbeiter } = useAuth()
  return useMemo(
    () => ({
      firma: briefkopfAus(state.vorlagenBeratung).name,
      kontakt: {
        name: state.profil.name?.trim() || mitarbeiter?.name || CURRENT_USER,
        telefon: state.profil.telefon?.trim() || mitarbeiter?.telefon || '',
        email: state.profil.email?.trim() || mitarbeiter?.email || '',
      },
      logoVorlage: findeLogoVorlage(state.vorlagenImmobilien),
    }),
    [state.vorlagenBeratung, state.vorlagenImmobilien, state.profil, mitarbeiter],
  )
}

export type ExposeKontext = ReturnType<typeof useExposeKontext>

export async function erstelleExpose(objekt: Objekt, e: ExposeEinstellungen, k: ExposeKontext): Promise<ExposeErgebnis> {
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
  // Fällt das Titelbild aus, rückt kein Galeriebild nach (falsches Seitenverhältnis) — dann ohne Titelbild.
  const titelbild = geladen[0] ?? undefined
  const bilder = geladen.slice(1).filter((b): b is ExposeBild => !!b)
  const logo = k.logoVorlage ? await ladeLogo(k.logoVorlage) : undefined

  const ort = e.ort.trim()
  const doc = erzeugeExposePdf({
    titel: e.titel.trim() || standardTitel(objekt, ort),
    ortZeile: e.adresseZeigen ? adresseVon(objekt) || ort : ort,
    objektart: objektartVon(objekt),
    preisText: preisText(objekt),
    fakten: exposeFakten(objekt),
    beschreibung: e.beschreibung,
    titelbild,
    bilder,
    logo,
    firma: k.firma,
    kontakt: k.kontakt,
    vertraulich: !!objekt.offMarket,
    stand: fmtDate(today()),
  })
  const blob = doc.output('blob')
  const titel = e.titel.trim() || objektartVon(objekt)
  return {
    doc,
    blob,
    groesse: blob.size,
    dateiname: `Expose_${ascii(titel) || 'Objekt'}_${today()}.pdf`,
    anzeigeName: `Exposé ${titel} (${fmtDate(today())}).pdf`,
    ohneBilder,
  }
}

// ── Fenster „Exposé als PDF“ ─────────────────────────────────────────────────────────────────────

export function ExposePdfDialog({ objekt, beschreibung, onClose }: { objekt: Objekt; beschreibung?: string; onClose: () => void }) {
  const { dispatch } = useApp()
  const kontext = useExposeKontext()
  const { e, aendere } = useExposeEinstellungen(objekt, beschreibung)
  const [arbeitet, setArbeitet] = useState<'' | 'laden' | 'ablegen'>('')
  const [fehler, setFehler] = useState('')
  const [meldung, setMeldung] = useState('')

  async function herunterladen() {
    setArbeitet('laden')
    setFehler('')
    setMeldung('')
    try {
      const r = await erstelleExpose(objekt, e, kontext)
      const url = URL.createObjectURL(r.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = r.anzeigeName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setMeldung(`Exposé erstellt (${r.doc.getNumberOfPages()} Seiten, ${groesseText(r.groesse)}).${r.ohneBilder.length ? ` Nicht geladen: ${r.ohneBilder.join(', ')}.` : ''}`)
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
      const r = await erstelleExpose(objekt, e, kontext)
      const { pfad, groesse } = await ladeObjektDokumentHoch(objekt.id, new File([r.blob], r.dateiname, { type: 'application/pdf' }))
      dispatch({
        type: 'ADD_DOKUMENT',
        objektId: objekt.id,
        ordner: 'Exposé',
        dokument: { id: uid('dok'), name: r.anzeigeName, typ: 'application/pdf', datum: today(), groesse, url: pfad },
      })
      setMeldung(`Im Ordner „Exposé“ abgelegt (${r.doc.getNumberOfPages()} Seiten, ${groesse}).${r.ohneBilder.length ? ` Nicht geladen: ${r.ohneBilder.join(', ')}.` : ''}`)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Exposé konnte nicht abgelegt werden.')
    } finally {
      setArbeitet('')
    }
  }

  return (
    <Modal open onClose={() => !arbeitet && onClose()} title="Exposé als PDF" width="max-w-2xl">
      <p className="mb-3 text-xs text-slate-500">
        Das Exposé enthält Titel, Ort, Bilder, die Eckdaten aus dem Verkaufsdatenblatt, die Beschreibung und deine Kontaktdaten. Eigentümer, interne Notizen, Kurzprüfung, Bewertung und Abrechnung kommen nie hinein.
      </p>
      <ExposeEinstellungenFelder objekt={objekt} e={e} aendere={aendere} />
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
        <SecondaryButton onClick={ablegen} disabled={!!arbeitet}>
          <FolderInput size={14} /> {arbeitet === 'ablegen' ? 'Wird abgelegt …' : 'In den Unterlagen ablegen'}
        </SecondaryButton>
        <PrimaryButton onClick={herunterladen} disabled={!!arbeitet}>
          <Download size={14} /> {arbeitet === 'laden' ? 'Wird erstellt …' : 'Exposé als PDF'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}

/** Knopf für die Karte „Exposé“. */
export function ExposePdfKnopf({ objekt, beschreibung }: { objekt: Objekt; beschreibung?: string }) {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <SecondaryButton onClick={() => setOffen(true)}>
        <FileText size={13} /> Exposé als PDF
      </SecondaryButton>
      {offen && <ExposePdfDialog objekt={objekt} beschreibung={beschreibung} onClose={() => setOffen(false)} />}
    </>
  )
}
