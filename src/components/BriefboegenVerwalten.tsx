import { useState } from 'react'
import { Check, FileText, Pencil, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { loescheBriefbogen, speichereBriefbogen, STANDARD_RAENDER, useBriefboegen, type Briefbogen, type Raender } from '../lib/briefe'
import { Field, PrimaryButton, SecondaryButton, inputClass } from './ui'

const RAND_FELDER: { key: keyof Raender; label: string; schritt: number }[] = [
  { key: 'links', label: 'Rand links (mm)', schritt: 0.5 },
  { key: 'rechts', label: 'Rand rechts (mm)', schritt: 0.5 },
  { key: 'unten', label: 'Rand unten (mm)', schritt: 0.5 },
  { key: 'anschriftOben', label: 'Anschrift von oben (mm)', schritt: 0.5 },
  { key: 'datumOben', label: 'Datum von oben (mm)', schritt: 0.5 },
  { key: 'betreffOben', label: 'Betreff von oben (mm)', schritt: 0.5 },
  { key: 'folgeseiteOben', label: 'Folgeseite: Text ab (mm)', schritt: 0.5 },
  { key: 'schrift', label: 'Schriftgröße (pt)', schritt: 0.5 },
  { key: 'zeilenhoehe', label: 'Zeilenabstand (Faktor)', schritt: 0.05 },
]

/** Privat → Einstellungen: eigene Word-Briefbögen hochladen und einstellen. */
export function BriefboegenVerwalten() {
  const { briefboegen, fehler: ladeFehler } = useBriefboegen(true)
  const [bearbeite, setBearbeite] = useState<Briefbogen | 'neu' | null>(null)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Briefbögen</h2>
          <p className="mt-1 text-sm text-slate-500">Deine Word-Briefbögen für Briefe und für alle CRM-Vorlagen („Auf Briefbogen“).</p>
        </div>
        {bearbeite === null && (
          <SecondaryButton onClick={() => setBearbeite('neu')}>
            <Plus size={16} /> Briefbogen
          </SecondaryButton>
        )}
      </div>

      {ladeFehler && <p className="mt-3 text-sm text-red-600">{ladeFehler}</p>}
      {briefboegen === null && !ladeFehler && <p className="mt-3 text-sm text-slate-400">Wird geladen …</p>}
      {briefboegen?.length === 0 && bearbeite === null && <p className="mt-3 text-sm text-slate-500">Noch kein Briefbogen hinterlegt.</p>}

      {bearbeite === null && !!briefboegen?.length && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {briefboegen.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <FileText size={15} className="text-slate-400" /> {b.name}
                </div>
                <div className="text-xs text-slate-500">
                  Word ✓ · {b.hatPdf ? 'PDF-Hintergrund ✓' : <span className="text-amber-700">ohne PDF-Hintergrund (PDF dann ohne Briefkopf)</span>}
                  {!b.platzhalter.includes('EMPFAENGER') && <span className="text-amber-700"> · ohne [[EMPFAENGER]]</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Bearbeiten" onClick={() => setBearbeite(b)}>
                  <Pencil size={15} />
                </button>
                <button
                  className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  title="Löschen"
                  onClick={async () => {
                    if (!window.confirm(`Briefbogen „${b.name}“ löschen? Die hochgeladenen Dateien werden entfernt.`)) return
                    try {
                      await loescheBriefbogen(b.id)
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {bearbeite !== null && <Formular vorhanden={bearbeite === 'neu' ? undefined : bearbeite} onFertig={() => setBearbeite(null)} />}
    </section>
  )
}

function Formular({ vorhanden, onFertig }: { vorhanden?: Briefbogen; onFertig: () => void }) {
  const [name, setName] = useState(vorhanden?.name ?? '')
  const [docx, setDocx] = useState<File | null>(null)
  const [pdf, setPdf] = useState<File | null>(null)
  const [ort, setOrt] = useState(vorhanden?.einstellungen.ort ?? 'Ulm')
  const [gruss, setGruss] = useState((vorhanden?.einstellungen.gruss ?? ['Mit freundlichen Grüßen', '', '']).join('\n'))
  const [raender, setRaender] = useState<Raender>({ ...STANDARD_RAENDER, ...(vorhanden?.einstellungen.raender ?? {}) })
  const [mehr, setMehr] = useState(false)
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')

  async function speichern() {
    setFehler('')
    if (!name.trim()) return setFehler('Bitte einen Namen angeben, z. B. „Privat“.')
    if (!vorhanden && !docx) return setFehler('Bitte die Word-Datei (.docx) auswählen.')
    setArbeitet(true)
    try {
      const geaendert = Object.fromEntries(Object.entries(raender).filter(([k, v]) => STANDARD_RAENDER[k as keyof Raender] !== v))
      await speichereBriefbogen({
        id: vorhanden?.id,
        name: name.trim(),
        docx,
        pdf,
        einstellungen: { ort: ort.trim() || undefined, gruss: gruss.split('\n'), raender: geaendert },
      })
      onFertig()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-600">
        <strong>So bereitest du den Briefbogen vor:</strong>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>
            Deinen Briefbogen in Word öffnen. An die passenden Stellen je einen eigenen Absatz mit <code>[[EMPFAENGER]]</code> <code>[[DATUM]]</code>{' '}
            <code>[[BETREFF]]</code> <code>[[ANREDE]]</code> <code>[[TEXT]]</code> setzen; Grußformel und Unterschrift fest darunter. Als .docx speichern.
          </li>
          <li>
            Für das PDF: dieselbe Datei <em>ohne</em> die Platzhalter und ohne Grußformel (nur Kopf, Fuß, Logo — also die leere Seite) über „Speichern unter → PDF“
            sichern. Hat der Briefbogen eine eigene Folgeseite, als zweite Seite mit hinein.
          </li>
        </ol>
      </div>

      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Privat" />
      </Field>
      <Field label={vorhanden ? 'Word-Datei ersetzen (.docx, optional)' : 'Word-Datei (.docx)'}>
        <input type="file" accept=".docx" onChange={(e) => setDocx(e.target.files?.[0] ?? null)} className="text-sm" />
      </Field>
      <Field label={vorhanden?.hatPdf ? 'PDF-Hintergrund ersetzen (optional)' : 'Leere Briefbogen-Seite als PDF (empfohlen)'}>
        <input type="file" accept=".pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} className="text-sm" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ort fürs Datum">
          <input className={inputClass} value={ort} onChange={(e) => setOrt(e.target.value)} />
        </Field>
        <Field label="Grußformel und Name (nur im PDF; eine Zeile je Zeile)">
          <textarea className={`${inputClass} min-h-[5.5rem]`} value={gruss} onChange={(e) => setGruss(e.target.value)} />
        </Field>
      </div>

      <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={() => setMehr((m) => !m)}>
        {mehr ? 'Abstände ausblenden' : 'Abstände im PDF einstellen …'}
      </button>
      {mehr && (
        <div className="grid gap-3 sm:grid-cols-3">
          {RAND_FELDER.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                type="number"
                step={f.schritt}
                className={inputClass}
                value={raender[f.key]}
                onChange={(e) => setRaender((r) => ({ ...r, [f.key]: Number(e.target.value) }))}
              />
            </Field>
          ))}
        </div>
      )}

      {fehler && (
        <p className="flex items-start gap-1.5 text-sm text-red-600">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {fehler}
        </p>
      )}
      <div className="flex gap-2">
        <PrimaryButton onClick={speichern} disabled={arbeitet}>
          <Check size={16} /> {arbeitet ? 'Wird geprüft …' : 'Speichern'}
        </PrimaryButton>
        <SecondaryButton onClick={onFertig} disabled={arbeitet}>
          Abbrechen
        </SecondaryButton>
      </div>
    </div>
  )
}
