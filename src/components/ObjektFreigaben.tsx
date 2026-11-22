// Interessenten-Portal in der Objektakte (21.11.2026): welche Unterlagen Interessenten sehen dürfen,
// Freigabe-Links je Interessent (mit Provision), Stand der Zustimmung und der gespeicherte Nachweis.
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Link2, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { useKvNutzer } from './KostenvoranschlaegeSection'
import { sendEmail } from '../lib/emailGateway'
import { supabase } from '../lib/supabaseClient'
import {
  beendeFreigabe, ladeAnfrageKennungen, ladeFreigaben, ladeInteressentenDokumente, legeFreigabeAn, portalLink, setzeAnfrageKennungen, setzeInteressentenDokumente,
  type ObjektFreigabe,
} from '../lib/objektPortal'
import type { Objekt } from '../types'

// Gleich wie PROVISION_VORSCHLAG in supabase/functions/email-gateway/anfragenManager.ts — bei Änderung beide anpassen.
const PROVISION_VORSCHLAG = '3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer'
const STATUS: Record<ObjektFreigabe['status'], { label: string; farbe: string }> = {
  eingeladen: { label: 'Link verschickt, noch nicht zugestimmt', farbe: 'bg-amber-50 text-amber-700' },
  zugestimmt: { label: 'Zugestimmt', farbe: 'bg-emerald-50 text-emerald-700' },
  widerrufen: { label: 'Zugang beendet', farbe: 'bg-slate-100 text-slate-500' },
}
/** Vom Anfragenmanager angelegt: ob der Link schon verschickt ist, weiß die Liste nicht — darum neutral. */
const statusVon = (f: ObjektFreigabe) => (f.quelle === 'anfrage' && f.status === 'eingeladen' ? { label: 'Noch nicht zugestimmt', farbe: STATUS.eingeladen.farbe } : STATUS[f.status])
const zeit = (iso?: string) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')

export function ObjektFreigaben({ objekt }: { objekt: Objekt }) {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [freigaben, setFreigaben] = useState<ObjektFreigabe[] | null>(null)
  const [frei, setFrei] = useState<string[]>([])
  const [fehler, setFehler] = useState('')
  const [neu, setNeu] = useState(false)
  const [kopiert, setKopiert] = useState('')
  const [mailFuer, setMailFuer] = useState<ObjektFreigabe | null>(null)
  const [nachweis, setNachweis] = useState<{ name: string; inhalt: Record<string, unknown> } | null>(null)

  const laden = () => {
    ladeFreigaben(objekt.id).then(setFreigaben).catch((e) => { setFehler(e instanceof Error ? e.message : String(e)); setFreigaben([]) })
    ladeInteressentenDokumente(objekt.id).then(setFrei).catch(() => setFrei([]))
  }
  useEffect(laden, [objekt.id])

  const ordner = Object.entries(objekt.dokumente ?? {}).filter(([, l]) => (l ?? []).length > 0)

  async function schalte(id: string) {
    const neuListe = frei.includes(id) ? frei.filter((x) => x !== id) : [...frei, id]
    setFrei(neuListe)
    try {
      await setzeInteressentenDokumente(objekt.id, neuListe)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setFrei(frei)
    }
  }

  async function kopiere(f: ObjektFreigabe) {
    try {
      await navigator.clipboard.writeText(portalLink(f.token))
      setKopiert(f.id)
      window.setTimeout(() => setKopiert(''), 2000)
    } catch {
      window.prompt('Link kopieren:', portalLink(f.token))
    }
  }

  async function zeigeNachweis(f: ObjektFreigabe) {
    const { data } = (await supabase?.from('objekt_freigaben').select('zustimmung').eq('id', f.id).maybeSingle()) ?? { data: null }
    setNachweis({ name: f.name, inhalt: (data?.zustimmung ?? {}) as Record<string, unknown> })
  }

  return (
    <div className="space-y-5">
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">So funktioniert das Interessenten-Portal</h3>
        <p className="text-sm text-slate-500">
          Ein Interessent bekommt einen eigenen Link. Dort sieht er zuerst nur Ort, Art und Kaufpreis. Erst wenn er den AGB, der Provisionsvereinbarung und dem sofortigen Beginn zugestimmt hat, sieht er die genaue Adresse, das Exposé und die unten freigegebenen Unterlagen. Die Zustimmung wird mit Zeitpunkt und genauem Wortlaut gespeichert. Die Texte stehen unter Vorlagen → Verträge („Interessenten-Portal …“).
        </p>
      </Card>

      <AnfrageKennungen objektId={objekt.id} nurLesen={nutzer.nurLesen} />

      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Unterlagen für Interessenten</h3>
        {ordner.length === 0 ? (
          <p className="text-sm text-slate-400">Dieses Objekt hat noch keine Dokumente.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {ordner.map(([name, liste]) => (
              <div key={name}>
                <p className="mb-1 text-xs font-medium text-slate-500">{name}</p>
                {(liste ?? []).map((d) => (
                  <label key={d.id} className="flex items-center gap-2 py-0.5 text-sm text-slate-700">
                    <input type="checkbox" checked={frei.includes(d.id)} disabled={nutzer.nurLesen} onChange={() => schalte(d.id)} />
                    <span className="truncate">{d.name}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-400">Angehakte Dokumente sehen alle Interessenten nach ihrer Zustimmung. Grundbuch, Mieterlisten und Ähnliches nur freigeben, wenn es wirklich nötig ist.</p>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Freigaben ({freigaben?.length ?? 0})</h3>
          {!nutzer.nurLesen && <PrimaryButton onClick={() => setNeu(true)}><Link2 size={14} /> Interessent freischalten</PrimaryButton>}
        </div>
        {freigaben === null ? (
          <p className="text-sm text-slate-400">Lädt …</p>
        ) : freigaben.length === 0 ? (
          <p className="text-sm text-slate-400">Noch kein Interessent freigeschaltet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {freigaben.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-700">{f.name}{f.email ? <span className="font-normal text-slate-400"> · {f.email}</span> : null}</p>
                  <p className="text-xs text-slate-400">
                    Provision: {f.provision} · erstellt {zeit(f.erstelltAm)}{f.erstelltVon ? ` von ${f.erstelltVon}` : ''} · {f.zugriffe}× geöffnet
                    {f.zustimmung ? ` · zugestimmt ${zeit(f.zustimmung.am)}` : ''}
                  </p>
                  {f.quelle === 'anfrage' && (
                    <p className="text-xs text-sky-700">Automatisch angelegt aus einer Anfrage vom {zeit(f.erstelltAm)}</p>
                  )}
                </div>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusVon(f).farbe}`}>{statusVon(f).label}</span>
                {f.status !== 'widerrufen' && (
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => kopiere(f)} className="inline-flex items-center gap-1 text-slate-600 hover:underline">{kopiert === f.id ? <Check size={13} /> : <Copy size={13} />} Link</button>
                    {!nutzer.nurLesen && f.email && <button onClick={() => setMailFuer(f)} className="inline-flex items-center gap-1 text-slate-600 hover:underline"><Mail size={13} /> Per E-Mail</button>}
                    {f.status === 'zugestimmt' && <button onClick={() => zeigeNachweis(f)} className="text-slate-600 hover:underline">Nachweis</button>}
                    {!nutzer.nurLesen && <button onClick={() => beendeFreigabe(f.id, nutzer.name).then(laden)} className="text-rose-600 hover:underline">Beenden</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {neu && <NeueFreigabe objekt={objekt} kunden={state.immobilienKunden} onClose={() => setNeu(false)} onFertig={(f) => { setNeu(false); laden(); if (f.email) setMailFuer(f) }} von={nutzer.name} />}
      {mailFuer && <LinkMail objekt={objekt} freigabe={mailFuer} absender={nutzer.name} onClose={() => setMailFuer(null)} />}
      {nachweis && (
        <Modal open onClose={() => setNachweis(null)} title={`Nachweis der Zustimmung: ${nachweis.name}`} width="max-w-2xl">
          <div className="space-y-2 text-sm text-slate-700">
            <p>Zugestimmt am {zeit(String(nachweis.inhalt.am ?? ''))} als „{String(nachweis.inhalt.name ?? '')}“.</p>
            <p className="text-xs text-slate-500">Gerät: {String(nachweis.inhalt.geraet ?? '–')} · Adresse: {String(nachweis.inhalt.ip ?? '–')}</p>
            {Object.entries((nachweis.inhalt.texte ?? {}) as Record<string, string>).map(([k, t]) => (
              <details key={k} className="rounded border border-slate-200 p-2">
                <summary className="cursor-pointer text-sm font-medium">{k === 'agb' ? 'AGB' : k === 'provision' ? 'Provisionsvereinbarung' : 'Widerrufsbelehrung'} (Wortlaut bei Zustimmung)</summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-slate-600">{t}</pre>
              </details>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}

/** Nummern des Inserats auf Portalen: daran erkennt der Anfragenmanager Anfragen zu diesem Objekt. */
function AnfrageKennungen({ objektId, nurLesen }: { objektId: string; nurLesen: boolean }) {
  const [text, setText] = useState('')
  const [gespeichert, setGespeichert] = useState('')
  const [stand, setStand] = useState<'laedt' | 'bereit' | 'speichert' | 'fehlt'>('laedt')
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    setStand('laedt')
    ladeAnfrageKennungen(objektId)
      .then((k) => {
        setText(k.join(', '))
        setGespeichert(k.join(', '))
        setStand('bereit')
      })
      // Vor dem Einspielen der Datenbank-Änderung gibt es die Spalte noch nicht: dann den Abschnitt nicht zeigen.
      .catch(() => setStand('fehlt'))
  }, [objektId])

  if (stand === 'fehlt') return null

  async function speichern() {
    setStand('speichert')
    setFehler('')
    try {
      const liste = text.split(/[,;\n]/).map((k) => k.trim()).filter((k) => k.length >= 3)
      await setzeAnfrageKennungen(objektId, liste)
      setText(liste.join(', '))
      setGespeichert(liste.join(', '))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
    setStand('bereit')
  }

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-sm font-semibold text-slate-700">Nummern des Inserats auf Portalen</h3>
      <p className="mb-3 text-sm text-slate-500">
        Hier die Nummern eintragen, unter denen das Objekt auf Portalen steht (Scout-ID bei ImmoScout24, Online-ID bei Immowelt, Anzeigennummer bei Kleinanzeigen) oder die eigene Objektnummer. Kommt dazu eine Anfrage ins Postfach, legt das CRM die Akte des Interessenten und seinen Link zum Portal von selbst an und gibt dem Verantwortlichen per Telegram Bescheid.
      </p>
      {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      <div className="flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={nurLesen || stand !== 'bereit'}
          placeholder="z. B. 151234567, MH-2026-07"
          className={`${inputClass} min-w-0 flex-1`}
          aria-label="Nummern des Inserats"
        />
        {!nurLesen && (
          <SecondaryButton onClick={speichern} disabled={stand !== 'bereit' || text === gespeichert}>
            {stand === 'speichert' ? 'Speichert …' : 'Speichern'}
          </SecondaryButton>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">Mehrere Nummern mit Komma trennen. Ohne Nummer erkennt das CRM das Objekt nur an Straße mit Hausnummer oder an der Bezeichnung.</p>
    </Card>
  )
}

function NeueFreigabe({ objekt, kunden, onClose, onFertig, von }: { objekt: Objekt; kunden: { id: string; firma: string; ansprechpartner: string; email: string; telefon: string }[]; onClose: () => void; onFertig: (f: ObjektFreigabe) => void; von: string }) {
  const [kundeId, setKundeId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [provision, setProvision] = useState(PROVISION_VORSCHLAG)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const sortiert = useMemo(() => [...kunden].sort((a, b) => (a.ansprechpartner || a.firma).localeCompare(b.ansprechpartner || b.firma)), [kunden])

  function waehle(id: string) {
    setKundeId(id)
    const k = kunden.find((x) => x.id === id)
    if (k) {
      setName(k.ansprechpartner || k.firma)
      setEmail(k.email ?? '')
      setTelefon(k.telefon ?? '')
    }
  }

  async function anlegen() {
    if (name.trim().length < 2 || !provision.trim()) {
      setFehler('Name und Provision sind nötig.')
      return
    }
    setLaeuft(true)
    try {
      onFertig(await legeFreigabeAn({ objektId: objekt.id, name, email, telefon, provision, kundeId: kundeId || undefined, kundeBereich: kundeId ? 'immobilienkunden' : undefined, von }))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setLaeuft(false)
    }
  }

  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  return (
    <Modal open onClose={onClose} title="Interessent freischalten" aktionen={<PrimaryButton onClick={anlegen} disabled={laeuft}>Link erstellen</PrimaryButton>}>
      <div className="space-y-3">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        <label className="block">
          <span className={feld}>Aus den Immobilien-Kunden wählen (oder unten neu eintragen)</span>
          <select value={kundeId} onChange={(e) => waehle(e.target.value)} className={`${inputClass} w-full`}>
            <option value="">– neuer Interessent –</option>
            {sortiert.map((k) => <option key={k.id} value={k.id}>{k.ansprechpartner || k.firma}{k.email ? ` (${k.email})` : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className={feld}>Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} w-full`} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className={feld}>E-Mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} w-full`} /></label>
          <label className="block"><span className={feld}>Telefon</span><input value={telefon} onChange={(e) => setTelefon(e.target.value)} className={`${inputClass} w-full`} /></label>
        </div>
        <label className="block">
          <span className={feld}>Provision (steht so in der Provisionsvereinbarung)</span>
          <input value={provision} onChange={(e) => setProvision(e.target.value)} className={`${inputClass} w-full`} />
        </label>
        <p className="text-xs text-slate-400">Der Link ist 90 Tage gültig und lässt sich jederzeit beenden.</p>
      </div>
    </Modal>
  )
}

function LinkMail({ objekt, freigabe, absender, onClose }: { objekt: Objekt; freigabe: ObjektFreigabe; absender: string; onClose: () => void }) {
  const [betreff, setBetreff] = useState(`Ihre Unterlagen zu ${objekt.bezeichnung}`)
  const [text, setText] = useState(
    `Guten Tag ${freigabe.name},\n\nvielen Dank für Ihr Interesse an ${objekt.bezeichnung}. Über diesen Link sehen Sie das Exposé und die Unterlagen, sobald Sie unseren Bedingungen und der Provisionsvereinbarung zugestimmt haben:\n${portalLink(freigabe.token)}\n\nFür Fragen oder einen Besichtigungstermin antworten Sie einfach auf diese E-Mail.\n\nMit freundlichen Grüßen\n${absender}\nAndreas Mayer Holding`,
  )
  const [stand, setStand] = useState<'' | 'sendet' | 'gesendet'>('')
  const [fehler, setFehler] = useState('')
  async function senden() {
    setStand('sendet')
    setFehler('')
    try {
      await sendEmail(freigabe.email!, betreff, text, undefined, freigabe.kundeId ? { kundeBereich: 'immobilienkunden', kundeId: freigabe.kundeId, kundeName: freigabe.name } : undefined)
      setStand('gesendet')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setStand('')
    }
  }
  return (
    <Modal open onClose={onClose} title={`Link an ${freigabe.email} senden`} width="max-w-xl" aktionen={stand === 'gesendet' ? <SecondaryButton onClick={onClose}>Schließen</SecondaryButton> : <PrimaryButton onClick={senden} disabled={stand === 'sendet'}>{stand === 'sendet' ? 'Sendet …' : 'Senden'}</PrimaryButton>}>
      <div className="space-y-3">
        {stand === 'gesendet' && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">Gesendet.</p>}
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        <input value={betreff} onChange={(e) => setBetreff(e.target.value)} className={`${inputClass} w-full`} aria-label="Betreff" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={11} className={`${inputClass} w-full`} aria-label="Text" />
      </div>
    </Modal>
  )
}
