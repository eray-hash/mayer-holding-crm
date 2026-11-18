import { useState } from 'react'
import { AlertTriangle, Building2, FileText, Globe, Loader2, ShieldCheck, ThumbsDown, ThumbsUp, User } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { AMPEL, erkenneKundenArt, firmaIstNurPersonenname, pruefeBonitaet } from '../lib/bonitaet'
import { fmtDateTime } from '../lib/dates'
import { Card, PrimaryButton, SecondaryButton } from './ui'
import type { BonitaetPunkt, Bonitaetseinschaetzung, KundeBereich } from '../types'

const DOKUMENT_STAND: Record<Bonitaetseinschaetzung['dokumente'][number]['stand'], string> = {
  verwendet: 'verwendet',
  wird_eingelesen: 'wird gerade eingelesen, zählt beim nächsten Mal',
  nicht_lesbar: 'nicht lesbar',
  nicht_verwendet: 'nicht verwendet',
}

const WEB_TEXT: Record<Bonitaetseinschaetzung['webRecherche'], string> = {
  nicht_erlaubt: 'Keine Suche im Internet (Privatperson).',
  ok: 'Öffentliche Registerangaben zur Firma wurden gesucht.',
  fehlgeschlagen: 'Die Suche nach Registerangaben hat nicht geklappt.',
  kein_firmenname: 'Keine Suche im Internet: In der Akte steht kein Firmenname.',
}

// Interne Bonitätseinschätzung ohne Auskunftei: wertet die Unterlagen aus, die der Kunde selbst gegeben
// hat, und bei Firmen zusätzlich kostenlose öffentliche Registerangaben. Die Arbeit macht der Server
// (email-gateway „bonitaet_pruefen"); er speichert das Ergebnis in der Akte (kunde.bonitaet).
export function BonitaetSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const ergebnis = kunde?.bonitaet
  const vorschlag = erkenneKundenArt(kunde?.firma ?? '', kunde?.ansprechpartner ?? '')
  const [art, setArt] = useState<'person' | 'firma'>(ergebnis?.art ?? vorschlag.art)
  const [auswahlOffen, setAuswahlOffen] = useState(!ergebnis)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')

  if (!kunde) return null
  const ohneFirmenname = firmaIstNurPersonenname(kunde.firma, kunde.ansprechpartner)

  async function starten() {
    setLaeuft(true)
    setFehler('')
    setHinweis('')
    try {
      const { bonitaet, angestossen } = await pruefeBonitaet({ bereich, kundeId, art })
      // Der Server hat schon gespeichert: nur anzeigen, nicht zurückschreiben.
      dispatch({ type: 'KUNDE_VOM_SERVER', bereich, id: kundeId, patch: { bonitaet } })
      setAuswahlOffen(false)
      if (angestossen > 0) setHinweis(`${angestossen} ${angestossen === 1 ? 'Unterlage wird' : 'Unterlagen werden'} jetzt eingelesen. In einigen Minuten neu prüfen, dann zählen sie mit.`)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Prüfung ist fehlgeschlagen.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <ShieldCheck size={15} className="text-accent-600" /> Bonität
          </h4>
          <p className="text-xs text-slate-400">Wertet Schufa-Selbstauskunft, BWA, Jahresabschluss, Kontoauszüge und Gehaltsnachweise aus der Akte aus.</p>
        </div>
        {ergebnis && !auswahlOffen && !laeuft && (
          <SecondaryButton onClick={() => setAuswahlOffen(true)}>
            <ShieldCheck size={14} /> Neu prüfen
          </SecondaryButton>
        )}
      </div>

      <div className="mb-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          Interne Einschätzung, keine Auskunft einer Auskunftei. Grundlage sind nur Unterlagen, die der Kunde uns gegeben hat, und bei Firmen öffentliche Registerangaben. Über
          Privatpersonen wird nicht im Internet gesucht.
        </p>
      </div>

      {auswahlOffen && (
        <Card className="mb-3 p-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Wer wird geprüft?</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Privatperson oder Firma">
            <ArtKnopf an={art === 'person'} onClick={() => setArt('person')} icon={<User size={15} />} titel="Privatperson" text="Nur Unterlagen aus der Akte. Keine Suche im Internet." />
            <ArtKnopf
              an={art === 'firma'}
              onClick={() => setArt('firma')}
              icon={<Building2 size={15} />}
              titel="Firma"
              text="Unterlagen aus der Akte und kostenlose Registerangaben zur Firma (Handelsregister, Insolvenzbekanntmachungen, veröffentlichte Abschlüsse)."
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Vorschlag aus der Akte: <span className="font-medium">{vorschlag.art === 'firma' ? 'Firma' : 'Privatperson'}</span> ({vorschlag.grund}).
          </p>
          {art === 'firma' && !ohneFirmenname && (
            <p className="mt-1 break-words text-xs text-slate-500">Gesucht wird nur nach „{kunde.firma}", nicht nach der Ansprechperson.</p>
          )}
          {art === 'firma' && ohneFirmenname && (
            <p className="mt-1 text-xs text-amber-700">In der Akte steht kein Firmenname — es wird nicht im Internet gesucht, nur die Unterlagen zählen.</p>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {ergebnis && (
              <SecondaryButton onClick={() => setAuswahlOffen(false)} disabled={laeuft}>
                Abbrechen
              </SecondaryButton>
            )}
            <PrimaryButton onClick={starten} disabled={laeuft}>
              {laeuft ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              {ergebnis ? 'Neu prüfen' : 'Bonität einschätzen'}
            </PrimaryButton>
          </div>
          {laeuft && <p className="mt-2 text-xs text-slate-500">Die Unterlagen werden geprüft. Das dauert bis zu zwei Minuten — bitte die Seite so lange offen lassen.</p>}
        </Card>
      )}

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler}</p>}
      {hinweis && <p className="mb-3 rounded-lg bg-sky-50 p-3 text-xs text-sky-800">{hinweis}</p>}

      {ergebnis && <Ergebnis b={ergebnis} />}
    </div>
  )
}

function ArtKnopf({ an, onClick, icon, titel, text }: { an: boolean; onClick: () => void; icon: React.ReactNode; titel: string; text: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={an}
      onClick={onClick}
      className={`rounded-lg border p-3 text-left ${an ? 'border-accent-300 bg-accent-50' : 'border-slate-200 hover:bg-slate-50'}`}
    >
      <span className={`flex items-center gap-1.5 text-sm font-medium ${an ? 'text-accent-700' : 'text-slate-700'}`}>
        {icon} {titel}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
    </button>
  )
}

function Ergebnis({ b }: { b: Bonitaetseinschaetzung }) {
  const [grundlageOffen, setGrundlageOffen] = useState(false)
  const a = AMPEL[b.ampel] ?? AMPEL.nicht_beurteilbar
  const verwendet = (b.dokumente ?? []).filter((d) => d.stand === 'verwendet')
  return (
    <Card className="p-4">
      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${a.flaeche}`}>
        <span className={`h-3 w-3 flex-shrink-0 rounded-full ${a.punkt}`} aria-hidden />
        <span className="min-w-0 break-words">{a.label}</span>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Eingeschätzt am {fmtDateTime(b.erstelltAm)}
        {b.erstelltVon ? ` von ${b.erstelltVon}` : ''} · geprüft als {b.art === 'firma' ? 'Firma' : 'Privatperson'}
        {b.art !== b.artErkannt ? ` (Vorschlag aus der Akte war ${b.artErkannt === 'firma' ? 'Firma' : 'Privatperson'})` : ''}
      </p>
      {b.begruendung && <p className="mt-3 break-words text-sm text-slate-700">{b.begruendung}</p>}

      <PunktListe titel="Spricht dafür" icon={<ThumbsUp size={13} className="text-emerald-600" />} punkte={b.positiv ?? []} leer="Nichts Belegtes gefunden." />
      <PunktListe titel="Spricht dagegen" icon={<ThumbsDown size={13} className="text-rose-600" />} punkte={b.negativ ?? []} leer="Nichts Belegtes gefunden." />

      {(b.fehlt ?? []).length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-slate-600">Für eine bessere Einschätzung fehlt</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {b.fehlt.map((f, i) => (
              <li key={i} className="break-words">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            <span className="font-medium text-slate-600">Grundlage:</span> {verwendet.length} {verwendet.length === 1 ? 'Unterlage' : 'Unterlagen'}
            {b.selbstauskunftVerwendet ? ', Selbstauskunft' : ''}. {WEB_TEXT[b.webRecherche] ?? ''}
          </p>
          {(b.dokumente ?? []).length > 0 && (
            <button onClick={() => setGrundlageOffen((o) => !o)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {grundlageOffen ? 'Unterlagen ausblenden' : 'Unterlagen anzeigen'}
            </button>
          )}
        </div>
        {grundlageOffen && (
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {b.dokumente.map((d, i) => (
              <li key={i} className="flex gap-2">
                <FileText size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <span className="min-w-0 break-words">
                  {d.name} — {DOKUMENT_STAND[d.stand] ?? d.stand}
                  {d.hinweis ? ` (${d.hinweis})` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function PunktListe({ titel, icon, punkte, leer }: { titel: string; icon: React.ReactNode; punkte: BonitaetPunkt[]; leer: string }) {
  return (
    <div className="mt-4">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        {icon} {titel}
      </p>
      {punkte.length === 0 ? (
        <p className="text-xs text-slate-400">{leer}</p>
      ) : (
        <ul className="space-y-2">
          {punkte.map((p, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-2.5">
              <p className="break-words text-sm text-slate-700">{p.text}</p>
              <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                {p.art === 'oeffentlich' ? <Globe size={12} className="mt-0.5 flex-shrink-0" /> : <FileText size={12} className="mt-0.5 flex-shrink-0" />}
                <span className="min-w-0 break-all">
                  Quelle:{' '}
                  {p.url && /^https?:\/\//i.test(p.url) ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
                      {p.url}
                    </a>
                  ) : (
                    p.quelle
                  )}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
