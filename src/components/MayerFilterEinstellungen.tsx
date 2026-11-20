import { useEffect, useState } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { ladeMayerRegel, speichereMayerRegel, type MayerRegelAnsicht } from '../lib/outlook'
import { Field, PrimaryButton, SecondaryButton, inputClass } from './ui'

/** Privat → Einstellungen: welche Mails als Mayer-Geschäft gelten und im privaten Bereich ausgeblendet werden. */
export function MayerFilterEinstellungen() {
  const [regel, setRegel] = useState<MayerRegelAnsicht | null>(null)
  const [domains, setDomains] = useState('')
  const [adressen, setAdressen] = useState('')
  const [fehler, setFehler] = useState('')
  const [gespeichert, setGespeichert] = useState(false)
  const [arbeitet, setArbeitet] = useState(false)

  const lade = () =>
    ladeMayerRegel()
      .then((r) => {
        setRegel(r)
        setDomains(r.domains.join('\n'))
        setAdressen(r.adressen.join('\n'))
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : String(e)))

  useEffect(() => {
    lade()
  }, [])

  async function speichern(vorgabe: boolean) {
    setFehler('')
    setGespeichert(false)
    setArbeitet(true)
    try {
      const zeilen = (t: string) => t.split(/[\s,;]+/).map((z) => z.trim()).filter(Boolean)
      await speichereMayerRegel({ domains: zeilen(domains), adressen: zeilen(adressen), vorgabe })
      await lade()
      setGespeichert(true)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
        <ShieldCheck size={17} className="text-slate-500" /> Mayer-Geschäft ausblenden
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Mails von oder an diese Domains und Adressen erscheinen im privaten Bereich nicht — weder im Postfach noch in der Suche, beim Assistenten oder im Briefing.
        Ebenso ganze Unterhaltungen, aus denen du eine Mail an Mayer geschickt oder weitergeleitet hast. Mayer-Kunden gehören ins Mayer-CRM.
      </p>
      {!regel && !fehler && <p className="mt-3 text-sm text-slate-400">Wird geladen …</p>}
      {regel && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Domains${regel.eigeneDomains ? '' : ' (Vorgabe aus dem CRM)'}`}>
              <textarea className={`${inputClass} min-h-[7rem] font-mono text-xs`} value={domains} onChange={(e) => setDomains(e.target.value)} />
            </Field>
            <Field label="Weitere einzelne Adressen">
              <textarea className={`${inputClass} min-h-[7rem] font-mono text-xs`} value={adressen} onChange={(e) => setAdressen(e.target.value)} placeholder="z. B. kunde@gmx.de" />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Immer dabei: die {regel.crmAdressen} Adressen der CRM-Postfächer und Kollegen. Gemerkte Mayer-Unterhaltungen: {regel.unterhaltungen}.
          </p>
          {fehler && <p className="text-sm text-rose-600">{fehler}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => speichern(false)} disabled={arbeitet}>
              <Check size={15} /> Speichern
            </PrimaryButton>
            {regel.eigeneDomains && (
              <SecondaryButton onClick={() => speichern(true)} disabled={arbeitet}>
                Domains auf Vorgabe zurücksetzen
              </SecondaryButton>
            )}
            {gespeichert && <span className="text-sm text-emerald-700">Gespeichert.</span>}
          </div>
        </div>
      )}
      {!regel && fehler && <p className="mt-3 text-sm text-rose-600">{fehler}</p>}
    </section>
  )
}
