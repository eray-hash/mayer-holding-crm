// Reiter „Teilen“ des Prüfbildschirms (Runde 5):
//  - An Kollegen schicken: Zusammenfassung + Link per Telegram (gespraech_teilen). Zur Auswahl stehen nur Kollegen,
//    die die Akte sehen dürfen und Telegram verbunden haben.
//  - Gesprächsnotiz an den Kunden: Vorschlag aus der Auswertung (Nachfass-Mail oder kurze Gesprächsnotiz), änderbar,
//    wahlweise in die Sprache des Kunden übersetzt. Verschickt wird nur über den Knopf „Senden“ und eine zweite
//    Bestätigung — über den normalen Versand des CRM mit der eigenen Signatur (gesendete_emails), danach ein
//    Eintrag im Verlauf der Akte.
import { useEffect, useMemo, useState } from 'react'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../../lib/postfaecher'
import { gespraechsnotizText, SPRACHEN, sprachName } from '../../../supabase/functions/_shared/gespraechSchema.ts'
import { datumZeit, eigeneEmail, ladeAkte, ladeSignatur, sendeKundennotiz, teilen, teilenEmpfaenger, uebersetzeText, type AkteKurz, type AufnahmeR5, type TeilenEmpfaenger } from './api'
import { feld, fehlerText } from './bausteine'

export function TeilenSeite({ id, zeile, neuLaden }: { id: string; zeile: AufnahmeR5; neuLaden: () => void }) {
  const [akte, setAkte] = useState<AkteKurz | null>(null)
  useEffect(() => {
    let aktiv = true
    if (zeile.kunde_id) ladeAkte(zeile.kunde_id).then((x) => aktiv && setAkte(x)).catch(() => {})
    return () => {
      aktiv = false
    }
  }, [zeile.kunde_id])

  if (zeile.status !== 'fertig' || !zeile.analyse) return <p className="text-sm text-slate-500">Teilen geht erst, wenn die Auswertung fertig ist.</p>
  if (zeile.besitzer === false) return <p className="text-sm text-slate-500">Teilen kann nur, wer die Aufnahme gemacht hat.</p>
  if (!zeile.kunde_id && !zeile.objekt_id) return <p className="text-sm text-slate-500">Bitte zuerst auf dem Reiter „In die Akte“ eine Akte zuordnen — geteilt wird nur, was an einer Akte hängt.</p>
  const privat = zeile.kunde_bereich === 'privat'
  const geteilt = zeile.geteilt ?? []

  return (
    <div className="space-y-4">
      {privat ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Private Aufnahmen lassen sich nicht mit Kollegen teilen.</p> : <AnKollegen id={id} neuLaden={neuLaden} />}
      {zeile.kunde_id && zeile.art !== 'notiz' && <AnKunden id={id} zeile={zeile} akte={akte} neuLaden={neuLaden} />}
      {geteilt.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="text-sm font-semibold text-slate-700">Schon geteilt</h2>
          <ul className="mt-1.5 space-y-1 text-sm text-slate-700">
            {[...geteilt].reverse().map((g, i) => (
              <li key={i}>
                {datumZeit(g.am)} — {g.art === 'kollege' ? `${g.name} per Telegram${g.ok ? '' : ' (nicht zugestellt)'}` : `Gesprächsnotiz an ${g.an}${g.sprache && g.sprache !== 'de' ? ` (auf ${sprachName(g.sprache)})` : ''}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function AnKollegen({ id, neuLaden }: { id: string; neuLaden: () => void }) {
  const [liste, setListe] = useState<TeilenEmpfaenger[] | null>(null)
  const [gewaehlt, setGewaehlt] = useState<string[]>([])
  const [notiz, setNotiz] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [ergebnis, setErgebnis] = useState<{ gesendet: string[]; nicht: { name: string; grund: string }[] } | null>(null)

  useEffect(() => {
    let aktiv = true
    teilenEmpfaenger(id).then((l) => aktiv && setListe(l)).catch((e) => aktiv && setFehler(fehlerText(e)))
    return () => {
      aktiv = false
    }
  }, [id])

  const moeglich = (liste ?? []).filter((m) => m.darf && m.telegram)
  const andere = (liste ?? []).filter((m) => !(m.darf && m.telegram))

  async function schicken() {
    setLaeuft(true)
    setFehler('')
    setErgebnis(null)
    try {
      const r = await teilen(id, gewaehlt, notiz.trim())
      setErgebnis(r)
      if (r.gesendet.length) {
        setGewaehlt([])
        setNotiz('')
      }
      neuLaden()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-slate-800">An Kollegen schicken</h2>
      <p className="mt-0.5 text-xs text-slate-500">Zusammenfassung, nächste Schritte und ein Link zur Aufnahme per Telegram. Nur Kollegen, die diese Akte sehen dürfen.</p>
      {liste === null && !fehler && <p className="mt-2 text-sm text-slate-500">Wird geladen …</p>}
      {liste !== null && moeglich.length === 0 && <p className="mt-2 text-sm text-slate-500">Kein Kollege mit Telegram darf diese Akte sehen.</p>}
      <div className="mt-2 space-y-1.5">
        {moeglich.map((m) => (
          <label key={m.email} className="flex items-center gap-2 text-[15px] text-slate-800">
            <input type="checkbox" className="h-5 w-5 accent-indigo-600" checked={gewaehlt.includes(m.email)} onChange={(e) => setGewaehlt(e.target.checked ? [...gewaehlt, m.email].slice(0, 5) : gewaehlt.filter((x) => x !== m.email))} />
            {m.name}
          </label>
        ))}
        {andere.length > 0 && (
          <p className="text-xs text-slate-400">
            Nicht möglich: {andere.map((m) => `${m.name} (${!m.darf ? 'darf die Akte nicht sehen' : 'ohne Telegram'})`).join(', ')}
          </p>
        )}
      </div>
      {moeglich.length > 0 && (
        <>
          <textarea className={`${feld} mt-2 min-h-[4rem]`} value={notiz} maxLength={500} placeholder="Kurze Nachricht dazu (freiwillig)" onChange={(e) => setNotiz(e.target.value)} />
          <button onClick={schicken} disabled={laeuft || gewaehlt.length === 0} className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {laeuft ? 'Wird geschickt …' : gewaehlt.length > 1 ? `An ${gewaehlt.length} Kollegen schicken` : 'Per Telegram schicken'}
          </button>
        </>
      )}
      {fehler && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{fehler}</p>}
      {ergebnis && (
        <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
          {ergebnis.gesendet.length > 0 && <p>Geschickt an {ergebnis.gesendet.join(', ')}.</p>}
          {ergebnis.nicht.map((n, i) => <p key={i} className="text-amber-800">{n.name}: {n.grund}</p>)}
        </div>
      )}
    </section>
  )
}

type Vorlage = 'mail' | 'notiz'

function AnKunden({ id, zeile, akte, neuLaden }: { id: string; zeile: AufnahmeR5; akte: AkteKurz | null; neuLaden: () => void }) {
  const a = zeile.analyse!
  const [ich, setIch] = useState('')
  const [signatur, setSignatur] = useState('')
  const besitzerName = (a.sprecher ?? []).find((s) => s.rolle === 'mitarbeiter')?.name ?? ''
  const kundeName = (a.sprecher ?? []).find((s) => s.rolle === 'kunde')?.name ?? ''
  const hatEntwurf = !!(a.mail_entwurf?.text ?? '').trim()
  const [vorlage, setVorlage] = useState<Vorlage>(hatEntwurf ? 'mail' : 'notiz')
  const tag = String(zeile.erstellt_am ?? '').slice(0, 10)

  /** Deutscher Vorschlag je Vorlage; mit Signatur ohne den Namen unter dem Gruß. */
  const vorschlag = useMemo(() => {
    if (vorlage === 'mail' && hatEntwurf) {
      let text = String(a.mail_entwurf.text).trim()
      if (signatur && besitzerName) {
        // Der Name steht dann schon in der Signatur.
        const zeilen = text.split('\n')
        if (zeilen.length > 1 && zeilen[zeilen.length - 1].trim() === besitzerName.trim()) text = zeilen.slice(0, -1).join('\n').trimEnd()
      }
      return { betreff: a.mail_entwurf.betreff || 'Unser Gespräch', text }
    }
    return gespraechsnotizText(a, { datum: tag, absender: besitzerName, mitSignatur: !!signatur })
  }, [vorlage, hatEntwurf, a, signatur, besitzerName, tag])

  const [an, setAn] = useState('')
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')
  const [geaendert, setGeaendert] = useState(false)
  const erkannt = zeile.sprache_erkannt && zeile.sprache_erkannt !== 'de' ? zeile.sprache_erkannt : ''
  const [sprache, setSprache] = useState('de')
  const [deutsch, setDeutsch] = useState<{ betreff: string; text: string } | null>(null)
  const [uebersetzt, setUebersetzt] = useState(false)
  const [laeuft, setLaeuft] = useState<'' | 'uebersetzen' | 'senden'>('')
  const [bestaetigen, setBestaetigen] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState('')

  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (x?: string | null) => (x && absenderListe.some((p) => p.id === x) ? x : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])

  useEffect(() => {
    let aktiv = true
    eigeneEmail().then(async (e) => {
      if (!aktiv) return
      setIch(e)
      const s = await ladeSignatur(e).catch(() => '')
      if (aktiv) setSignatur(s)
    }).catch(() => {})
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (akte?.email && !an) setAn(akte.email)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [akte?.email])

  // Vorschlag übernehmen, solange nichts von Hand geändert wurde.
  useEffect(() => {
    if (geaendert || uebersetzt) return
    setBetreff(vorschlag.betreff)
    setText(vorschlag.text)
  }, [vorschlag, geaendert, uebersetzt])

  const adresseOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an.trim())

  async function uebersetzen() {
    if (sprache === 'de') return
    setLaeuft('uebersetzen')
    setFehler('')
    try {
      const quelle = deutsch ?? { betreff, text }
      const r = await uebersetzeText(id, vorlage, sprache, quelle.betreff, quelle.text)
      setDeutsch(quelle)
      setBetreff(r.betreff || quelle.betreff)
      setText(r.text)
      setUebersetzt(true)
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft('')
    }
  }

  function zurueckAufDeutsch() {
    if (deutsch) {
      setBetreff(deutsch.betreff)
      setText(deutsch.text)
    }
    setDeutsch(null)
    setUebersetzt(false)
    setSprache('de')
  }

  async function senden() {
    if (!akte || !adresseOk || !text.trim()) return
    setLaeuft('senden')
    setFehler('')
    try {
      const r = await sendeKundennotiz({
        id,
        an: an.trim(),
        anName: kundeName || akte.ansprechpartner || akte.firma || an.trim(),
        betreff: betreff.trim() || 'Gesprächsnotiz',
        text: text.trim(),
        signaturHtml: signatur,
        akte: { id: akte.id, bereich: akte.bereich, firma: akte.firma },
        postfachId: vonId || undefined,
        sprache: uebersetzt ? sprache : 'de',
      })
      if (vonId) merkeAbsender(vonId)
      setFertig(r.hinweis ?? `Verschickt an ${an.trim()} — steht im Mail-Verlauf und im Verlauf der Akte.`)
      setBestaetigen(false)
      neuLaden()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft('')
    }
  }

  const sprachAuswahl = [{ code: 'de', name: 'Deutsch' }, ...(erkannt ? [{ code: erkannt, name: sprachName(erkannt) }] : []), ...SPRACHEN.filter((s) => s.code && s.code !== 'de' && s.code !== erkannt).map((s) => ({ code: s.code as string, name: s.name }))]

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-slate-800">Gesprächsnotiz an den Kunden</h2>
      <p className="mt-0.5 text-xs text-slate-500">Vorschlag aus der Auswertung — bitte lesen und anpassen. Verschickt wird erst nach „Senden“ und einer Bestätigung{signatur ? ', mit deiner Signatur aus „Mein Profil“' : ''}.</p>
      {fertig ? (
        <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{fertig}</p>
      ) : (
        <>
          {hatEntwurf && (
            <div className="mt-2 flex rounded-lg bg-slate-100 p-1 text-sm">
              {(['mail', 'notiz'] as Vorlage[]).map((v) => (
                <button key={v} disabled={uebersetzt} onClick={() => { setVorlage(v); setGeaendert(false) }} className={`flex-1 rounded-md px-2 py-1.5 ${vorlage === v ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  {v === 'mail' ? 'Nachfass-Mail' : 'Kurze Gesprächsnotiz'}
                </button>
              ))}
            </div>
          )}
          <label className="mt-2 block text-xs text-slate-500">An</label>
          <input className={feld} type="email" value={an} onChange={(e) => setAn(e.target.value)} placeholder="E-Mail-Adresse des Kunden" />
          {an && !adresseOk && <p className="mt-1 text-xs text-rose-700">Das ist keine vollständige E-Mail-Adresse.</p>}
          {!akte?.email && <p className="mt-1 text-xs text-amber-700">In der Akte steht keine E-Mail-Adresse.</p>}
          {absenderListe.length > 1 ? (
            <>
              <label className="mt-2 block text-xs text-slate-500">Von</label>
              <select className={feld} value={vonId} onChange={(e) => setVonId(e.target.value)}>
                {absenderListe.map((p) => <option key={p.id} value={p.id}>{postfachBezeichnung(p)}</option>)}
              </select>
            </>
          ) : absenderListe.length === 1 ? <p className="mt-2 break-words text-xs text-slate-500">Von: {postfachBezeichnung(absenderListe[0])}</p> : null}
          <label className="mt-2 block text-xs text-slate-500">Betreff</label>
          <input className={feld} value={betreff} onChange={(e) => { setBetreff(e.target.value); setGeaendert(true) }} />
          <textarea className={`${feld} mt-2 min-h-[12rem]`} value={text} onChange={(e) => { setText(e.target.value); setGeaendert(true) }} />

          <div className="mt-2 rounded-lg bg-slate-50 p-2">
            <label className="block text-xs text-slate-500">Sprache der Mail</label>
            {uebersetzt ? (
              <div className="mt-1 flex items-center justify-between text-sm">
                <span>Übersetzt auf {sprachName(sprache)}</span>
                <button className="text-xs text-indigo-600" onClick={zurueckAufDeutsch}>Zurück zur deutschen Fassung</button>
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <select className={feld} value={sprache} onChange={(e) => setSprache(e.target.value)}>
                  {sprachAuswahl.map((s) => <option key={s.code} value={s.code}>{s.name}{s.code === erkannt ? ' (im Gespräch erkannt)' : ''}</option>)}
                </select>
                {sprache !== 'de' && (
                  <button onClick={uebersetzen} disabled={!!laeuft || !text.trim()} className="shrink-0 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">
                    {laeuft === 'uebersetzen' ? '…' : 'Übersetzen'}
                  </button>
                )}
              </div>
            )}
            {uebersetzt && <p className="mt-1 text-xs text-slate-500">Maschinell übersetzt — vor dem Senden bitte prüfen lassen, wenn möglich.</p>}
          </div>

          {fehler && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{fehler}</p>}
          {!bestaetigen ? (
            <button onClick={() => setBestaetigen(true)} disabled={!!laeuft || !adresseOk || !text.trim() || !akte || !ich} className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              Senden …
            </button>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-900">Wirklich an <span className="font-medium">{an.trim()}</span> senden?</p>
              <div className="mt-2 flex gap-2">
                <button onClick={senden} disabled={!!laeuft} className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{laeuft === 'senden' ? 'Wird gesendet …' : 'Ja, jetzt senden'}</button>
                <button onClick={() => setBestaetigen(false)} disabled={!!laeuft} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">Abbrechen</button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
