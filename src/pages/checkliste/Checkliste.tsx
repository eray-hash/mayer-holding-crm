// Projekt-Checkliste (Hasan und Eray, 20.11.2026): alle laufenden Akten der freigegebenen Bereiche in
// einer Liste — Stand, Sachverhalt, Vermittler, Dienstleistungen, Umsatz, Chance, Wiedervorlage,
// Unterlagen, nächste Schritte, Ampel. Rechnen in lib/checkliste.ts; Bearbeiten im Fenster unten.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Search, Sparkles } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, Modal, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { aktePfad, akteName, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { holeLeistungen } from '../../lib/leistungen'
import { ladeSeminare } from '../../lib/seminare'
import { checklisteVorschlag } from '../../lib/emailGateway'
import { WiedervorlagenListe } from '../../components/WiedervorlagenListe'
import { PartnerAuswahl } from '../../components/PartnerAuswahl'
import { WillkommenSchalter } from '../../components/WillkommenSchalter'
import { WillkommenHinweis } from '../../components/WillkommenHinweis'
import { ChanceVorschlagFeld } from '../../components/ChanceVorschlagFeld'
import { chanceVon, erwarteterUmsatz, umsatzFelder } from '../../lib/chanceVorschlag'
import { fmtEURCent, today } from '../../lib/dates'
import {
  AMPEL_LABEL, AMPEL_RANG, gewichtet,
} from '../../lib/checkliste'
import type { AmpelFarbe, Kunde, KundeBereich } from '../../types'
import { Ampel, StandAnzeige, kurzDatum, useChecklisteDaten, type Zeile } from './checklisteDaten'

export function Checkliste() {
  const { dispatch } = useApp()
  const navigate = useNavigate()
  const { oeffentlicheKundenBereiche } = useBereichsRechte()
  const nutzer = useKvNutzer()
  const heute = today()
  const { alle, wvJeKunde, wvLaden, fehler } = useChecklisteDaten()
  const [suche, setSuche] = useState('')
  const [bereichFilter, setBereichFilter] = useState('')
  const [ampelFilter, setAmpelFilter] = useState('')
  const [wer, setWer] = useState('')
  const [mitNeuanfragen, setMitNeuanfragen] = useState(false)
  const [mitAbgeschlossenen, setMitAbgeschlossenen] = useState(false)
  const [offen, setOffen] = useState<{ kundeId: string; bereich: KundeBereich } | null>(null)
  const neuanfragen = alle.filter((z) => z.stand.neuanfrage && !(wvJeKunde.get(z.kunde.id)?.length)).length
  const abgeschlossene = alle.filter((z) => z.stand.abgeschlossen).length
  const verantwortliche = useMemo(() => [...new Set(alle.map((z) => z.kunde.verantwortlich).filter(Boolean))].sort(), [alle])

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return alle
      // Neuanfragen aus dem Postfach ausblenden — außer, jemand hat schon eine Wiedervorlage dafür angelegt (dann ist es ein laufender Fall).
      .filter((z) => (mitNeuanfragen ? true : !z.stand.neuanfrage || (wvJeKunde.get(z.kunde.id)?.length ?? 0) > 0))
      .filter((z) => (mitAbgeschlossenen ? true : !z.stand.abgeschlossen))
      .filter((z) => !bereichFilter || z.bereich === bereichFilter)
      .filter((z) => !ampelFilter || z.ampel.farbe === ampelFilter)
      .filter((z) => !wer || z.kunde.verantwortlich === wer)
      .filter((z) => {
        if (!s) return true
        const k = z.kunde
        return [k.firma, k.ansprechpartner, k.sachverhalt, k.branche, k.vermittler?.name, ...(k.dienstleistungen ?? [])]
          .some((t) => (t ?? '').toLowerCase().includes(s))
      })
      .sort((a, b) => {
        const r = AMPEL_RANG[a.ampel.farbe] - AMPEL_RANG[b.ampel.farbe]
        if (r !== 0) return r
        const wa = a.wv[0]?.datum ?? '9999'
        const wb = b.wv[0]?.datum ?? '9999'
        return wa.localeCompare(wb)
      })
  }, [alle, suche, bereichFilter, ampelFilter, wer, mitNeuanfragen, mitAbgeschlossenen, wvJeKunde])

  const summe = sichtbar.reduce((s, z) => s + erwarteterUmsatz(z.kunde, z.umsatz.netto).netto, 0)
  const summeGewichtet = sichtbar.reduce((s, z) => s + gewichtet(erwarteterUmsatz(z.kunde, z.umsatz.netto).netto, z.kunde.auftragChance?.prozent), 0)
  const zaehle = (f: AmpelFarbe) => sichtbar.filter((z) => z.ampel.farbe === f).length
  const offeneZeile = offen ? alle.find((z) => z.kunde.id === offen.kundeId && z.bereich === offen.bereich) : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <ClipboardList size={20} className="text-slate-400" /> Projekt-Checkliste
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Alle laufenden Fälle deiner Bereiche: wo sie stehen, was sie bringen und was als Nächstes fällig ist. Ein Klick auf eine Zeile öffnet das Bearbeiten.
          </p>
        </div>
        <SecondaryButton onClick={() => navigate('/besprechung')}>Zur Wochenbesprechung</SecondaryButton>
      </div>

      <WillkommenSchalter nutzerName={nutzer.name} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-3">
          <p className="text-xs text-slate-500">Fälle</p>
          <p className="text-lg font-semibold text-slate-800">{sichtbar.length}</p>
          <p className="text-xs text-slate-400">{zaehle('rot')} rot · {zaehle('gelb')} gelb · {zaehle('gruen')} grün</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Erwarteter Umsatz netto</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">{fmtEURCent(summe)}</p>
          <p className="text-xs text-slate-400">aus den Kostenvoranschlägen</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Gewichtet nach Chance</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">{fmtEURCent(summeGewichtet)}</p>
          <p className="text-xs text-slate-400">Umsatz × Chance</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-slate-500">Ohne Chance</p>
          <p className="text-lg font-semibold text-slate-800">{sichtbar.filter((z) => z.kunde.auftragChance === undefined).length}</p>
          <p className="text-xs text-slate-400">zählen gewichtet noch nicht mit</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" />
          <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen: Name, Sachverhalt, Branche, Vermittler" className={`${inputClass} w-full pl-8`} />
        </div>
        <select value={bereichFilter} onChange={(e) => setBereichFilter(e.target.value)} className={inputClass} aria-label="Bereich">
          <option value="">Alle Bereiche</option>
          {oeffentlicheKundenBereiche.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <select value={ampelFilter} onChange={(e) => setAmpelFilter(e.target.value)} className={inputClass} aria-label="Ampel">
          <option value="">Alle Ampeln</option>
          <option value="rot">Rot</option>
          <option value="gelb">Gelb</option>
          <option value="gruen">Grün</option>
        </select>
        <select value={wer} onChange={(e) => setWer(e.target.value)} className={inputClass} aria-label="Verantwortlich">
          <option value="">Alle Verantwortlichen</option>
          {verantwortliche.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mitNeuanfragen} onChange={(e) => setMitNeuanfragen(e.target.checked)} />
          Neuanfragen aus dem Postfach zeigen ({neuanfragen})
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mitAbgeschlossenen} onChange={(e) => setMitAbgeschlossenen(e.target.checked)} />
          Abgeschlossene zeigen ({abgeschlossene})
        </label>
      </div>

      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {sichtbar.length === 0 ? (
        <EmptyState text="Keine Fälle für diese Auswahl." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1500px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">Kunde</th>
                <th className="px-3 py-2 font-semibold">Stand</th>
                <th className="px-3 py-2 font-semibold">Willkommen</th>
                <th className="px-3 py-2 font-semibold">Sachverhalt</th>
                <th className="px-3 py-2 font-semibold">Firma / Branche</th>
                <th className="px-3 py-2 font-semibold">Vermittler</th>
                <th className="px-3 py-2 font-semibold">Dienstleistungen</th>
                <th className="px-3 py-2 text-right font-semibold">Umsatz netto</th>
                <th className="px-3 py-2 text-right font-semibold">Chance</th>
                <th className="px-3 py-2 font-semibold">Wiedervorlage</th>
                <th className="px-3 py-2 font-semibold">Unterlagen</th>
                <th className="px-3 py-2 font-semibold">Nächste Schritte</th>
                <th className="px-3 py-2 font-semibold">Ampel</th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((z) => {
                const k = z.kunde
                const naechste = z.wv[0]
                return (
                  <tr
                    key={`${z.bereich}-${k.id}`}
                    onClick={() => setOffen({ kundeId: k.id, bereich: z.bereich })}
                    className="group cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50"
                  >
                    <td className="sticky left-0 z-10 min-w-[170px] bg-white px-3 py-2 group-hover:bg-slate-50">
                      <span className="block font-medium text-slate-800">{k.ansprechpartner || k.firma || 'Ohne Namen'}</span>
                      <span className="block text-xs text-slate-400">{z.bereichLabel}{k.verantwortlich ? ` · ${k.verantwortlich}` : ''}</span>
                    </td>
                    <td className="px-3 py-2"><StandAnzeige s={z.stand} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{z.willkommen ?? '–'}</td>
                    <td className="max-w-[260px] px-3 py-2 text-xs text-slate-700">{k.sachverhalt || <span className="text-slate-300">–</span>}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className="block text-slate-700">{k.firma && k.firma !== k.ansprechpartner ? k.firma : '–'}</span>
                      {k.branche && <span className="block text-slate-400">{k.branche}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">{k.vermittler?.name || '–'}</td>
                    <td className="max-w-[200px] px-3 py-2 text-xs text-slate-700">{k.dienstleistungen?.join(', ') || k.seminare?.map((s) => s.titel).join(', ') || '–'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-slate-700">
                      {z.umsatz.anzahl ? fmtEURCent(z.umsatz.netto) : chanceVon(k)?.umsatzNetto ? `${fmtEURCent(chanceVon(k)!.umsatzNetto!)} (geschätzt)` : '–'}
                      {z.umsatz.ohneBetrag > 0 && <span className="block text-slate-400">{z.umsatz.ohneBetrag} ohne Betrag</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums">
                      {k.auftragChance ? (
                        <span className={k.auftragChance.bestaetigt ? 'text-slate-700' : 'italic text-slate-400'} title={k.auftragChance.bestaetigt ? 'bestätigt' : 'Vorschlag, noch nicht bestätigt'}>
                          {k.auftragChance.prozent} %
                        </span>
                      ) : '–'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {naechste ? (
                        <>
                          <span className={`block tabular-nums ${naechste.datum < heute ? 'font-medium text-rose-600' : 'text-slate-700'}`}>{kurzDatum(naechste.datum)}</span>
                          <span className="block max-w-[180px] text-slate-500">{naechste.titel}</span>
                          {z.wv.length > 1 && <span className="block text-slate-400">+{z.wv.length - 1} weitere</span>}
                        </>
                      ) : <span className="text-slate-300">–</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{z.unterlagen ? `${z.unterlagen.da} von ${z.unterlagen.angefordert} da` : '–'}</td>
                    <td className="max-w-[220px] px-3 py-2 text-xs text-slate-700">{k.naechsteSchritte || <span className="text-slate-300">–</span>}</td>
                    <td className="px-3 py-2">
                      <Ampel a={z.ampel} />
                      {z.ampel.gruende[0] && <span className="mt-0.5 block max-w-[170px] text-[11px] text-slate-400">{z.ampel.gruende[0]}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {offeneZeile && (
        <ChecklisteBearbeiten
          key={`${offeneZeile.bereich}-${offeneZeile.kunde.id}`}
          zeile={offeneZeile}
          nurLesen={nutzer.nurLesen}
          nutzerName={nutzer.name}
          onClose={() => setOffen(null)}
          onWvAenderung={wvLaden}
          onAkte={() => navigate(aktePfad(offeneZeile.bereich, offeneZeile.kunde))}
          onSpeichern={(patch) => {
            dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: offeneZeile.bereich, id: offeneZeile.kunde.id, patch })
            setOffen(null)
          }}
          alleAkten={alle}
        />
      )}
    </div>
  )
}

export function ChecklisteBearbeiten({
  zeile, nurLesen, nutzerName, onClose, onAkte, onSpeichern, alleAkten, onWvAenderung,
}: {
  zeile: Zeile
  nurLesen: boolean
  nutzerName: string
  onClose: () => void
  onAkte: () => void
  onSpeichern: (patch: Partial<Kunde>) => void
  alleAkten: Zeile[]
  onWvAenderung: () => void
}) {
  const k = zeile.kunde
  const [sachverhalt, setSachverhalt] = useState(k.sachverhalt ?? '')
  const [branche, setBranche] = useState(k.branche ?? '')
  const [vermittler, setVermittler] = useState(k.vermittler?.name ?? '')
  const [dienste, setDienste] = useState<string[]>(k.dienstleistungen ?? [])
  const [frei, setFrei] = useState('')
  const [chance, setChance] = useState<string>(k.auftragChance ? String(k.auftragChance.prozent) : '')
  const [bestaetigt, setBestaetigt] = useState(k.auftragChance?.bestaetigt ?? false)
  const [begruendung, setBegruendung] = useState(k.auftragChance?.begruendung ?? '')
  const [umsatzSchaetzung, setUmsatzSchaetzung] = useState(chanceVon(k)?.umsatzNetto ? String(chanceVon(k)!.umsatzNetto) : '')
  const [umsatzMonat, setUmsatzMonat] = useState(chanceVon(k)?.monat ?? '')
  const [followUpErledigt, setFollowUpErledigt] = useState(false)
  const offenesFollowUp = k.followUp && !k.followUp.done && (k.followUp.date || k.followUp.note?.trim()) ? k.followUp : undefined
  const [naechste, setNaechste] = useState(k.naechsteSchritte ?? '')
  const [ampel, setAmpel] = useState<'' | AmpelFarbe>(k.ampelManuell?.farbe ?? '')
  const [ampelGrund, setAmpelGrund] = useState(k.ampelManuell?.grund ?? '')
  const [leistungen, setLeistungen] = useState<string[]>([])
  const [vorschlagLaeuft, setVorschlagLaeuft] = useState(false)
  const [hinweis, setHinweis] = useState('')
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    // Akademie: die Seminare aus dem Katalog statt der Beratungs-Preisliste.
    if (zeile.bereich === 'akademie') ladeSeminare().then((l) => setLeistungen(l.map((x) => x.titel))).catch(() => setLeistungen([]))
    else holeLeistungen().then((l) => setLeistungen(l.map((x) => x.bezeichnung))).catch(() => setLeistungen([]))
  }, [])

  const akteNamen = useMemo(() => [...new Set(alleAkten.filter((z) => z.kunde.id !== k.id).map((z) => akteName(z.kunde)))].sort(), [alleAkten, k.id])
  const auswahl = [...new Set([...leistungen, ...dienste])]

  async function vorschlagHolen() {
    setVorschlagLaeuft(true)
    setFehler('')
    setHinweis('')
    try {
      const v = await checklisteVorschlag(k.id)
      if (v.sachverhalt) setSachverhalt(v.sachverhalt)
      if (v.branche) setBranche(v.branche)
      if (v.vermittler && !vermittler.trim()) setVermittler(v.vermittler)
      if (v.dienstleistungen?.length) setDienste((d) => [...new Set([...d, ...v.dienstleistungen])])
      if (v.chance) {
        setChance(String(v.chance.prozent))
        setBegruendung(v.chance.begruendung ?? '')
        setBestaetigt(false)
      }
      if (v.naechsteSchritte) setNaechste(v.naechsteSchritte)
      setHinweis('Vorschlag eingesetzt. Bitte prüfen und bei Bedarf ändern. Die Chance gilt erst als bestätigt, wenn du das Häkchen setzt.')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Vorschlag ließ sich nicht holen.')
    } finally {
      setVorschlagLaeuft(false)
    }
  }

  function speichern() {
    const prozent = chance.trim() === '' ? undefined : Math.max(0, Math.min(100, Math.round(Number(chance))))
    if (prozent !== undefined && Number.isNaN(prozent)) {
      setFehler('Die Chance muss eine Zahl zwischen 0 und 100 sein.')
      return
    }
    const treffer = alleAkten.find((z) => akteName(z.kunde) === vermittler.trim())
    const jetzt = new Date().toISOString()
    const alteChance = chanceVon(k)
    const zusatz = umsatzFelder(umsatzSchaetzung, umsatzMonat)
    const chanceNeu =
      prozent === undefined
        ? undefined
        : alteChance && alteChance.prozent === prozent && alteChance.bestaetigt === bestaetigt && (alteChance.begruendung ?? '') === begruendung &&
            alteChance.umsatzNetto === zusatz.umsatzNetto && alteChance.monat === zusatz.monat
          ? k.auftragChance
          : ({ prozent, bestaetigt, begruendung: begruendung.trim() || undefined, von: nutzerName, am: jetzt, ...zusatz } as Kunde['auftragChance'])
    const patch: Partial<Kunde> = {
      sachverhalt: sachverhalt.trim() || undefined,
      branche: branche.trim() || undefined,
      vermittler: vermittler.trim() ? { name: vermittler.trim(), ...(treffer ? { kundeId: treffer.kunde.id, bereich: treffer.bereich } : {}) } : undefined,
      dienstleistungen: dienste.length ? dienste : undefined,
      auftragChance: chanceNeu,
      naechsteSchritte: naechste.trim() || undefined,
      ampelManuell: ampel ? { farbe: ampel, grund: ampelGrund.trim(), von: nutzerName, am: jetzt } : undefined,
    }
    if (followUpErledigt && offenesFollowUp) patch.followUp = { ...offenesFollowUp, done: true }
    onSpeichern(patch)
  }

  const feld = 'block text-xs font-medium text-slate-500 mb-1'
  return (
    <Modal
      open
      onClose={onClose}
      title={`Checkliste: ${akteName(k)}`}
      width="max-w-2xl"
      aktionen={!nurLesen && <PrimaryButton onClick={speichern}>Speichern</PrimaryButton>}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <div>
            <p className="font-medium text-slate-700">{zeile.bereichLabel} · {zeile.stand.schritt ? `${zeile.stand.schritt}/${zeile.stand.schritte} ` : ''}{zeile.stand.label}</p>
            <p className="text-xs text-slate-500">
              Umsatz netto {zeile.umsatz.anzahl ? fmtEURCent(zeile.umsatz.netto) : 'noch kein Kostenvoranschlag'} · Ampel {AMPEL_LABEL[zeile.ampel.farbe]}
              {zeile.ampel.gruende.length ? `: ${zeile.ampel.gruende.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <SecondaryButton onClick={onAkte}>Akte öffnen</SecondaryButton>
            {!nurLesen && (
              <SecondaryButton onClick={vorschlagHolen} disabled={vorschlagLaeuft}>
                <Sparkles size={14} /> {vorschlagLaeuft ? 'Assistent liest die Akte …' : 'Vorschlag vom Assistenten'}
              </SecondaryButton>
            )}
          </div>
        </div>
        {hinweis && <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-700">{hinweis}</p>}
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

        <fieldset disabled={nurLesen} className="space-y-4">
          <label className="block">
            <span className={feld}>Sachverhalt</span>
            <textarea value={sachverhalt} onChange={(e) => setSachverhalt(e.target.value)} rows={3} className={`${inputClass} w-full`} placeholder="Worum geht es? z. B. Gründung einer Holding für zwei Betriebe" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={feld}>Branche</span>
              <input value={branche} onChange={(e) => setBranche(e.target.value)} className={`${inputClass} w-full`} placeholder="z. B. Bauhauptgewerbe" />
            </label>
            <label className="block">
              <span className={feld}>Vermittler</span>
              <input value={vermittler} onChange={(e) => setVermittler(e.target.value)} list="checkliste-akten" className={`${inputClass} w-full`} placeholder="Name oder Akte" />
              <datalist id="checkliste-akten">{akteNamen.map((n) => <option key={n} value={n} />)}</datalist>
            </label>
          </div>
          {/* Partner-Verzeichnis (/partner): speichert sofort, unabhängig vom Speichern-Knopf oben. */}
          <PartnerAuswahl kundeId={k.id} nurLesen={nurLesen} onGewaehlt={(p) => { if (!vermittler.trim()) setVermittler(p.name || p.firma) }} />

          <div>
            <span className={feld}>Unsere Dienstleistungen</span>
            <div className="flex flex-wrap gap-1.5">
              {auswahl.map((d) => {
                const an = dienste.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDienste((l) => (an ? l.filter((x) => x !== d) : [...l, d]))}
                    className={`rounded-full border px-2.5 py-1 text-xs ${an ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                    aria-pressed={an}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={frei} onChange={(e) => setFrei(e.target.value)} className={`${inputClass} flex-1`} placeholder="Andere Leistung eintragen" />
              <SecondaryButton
                onClick={() => {
                  const t = frei.trim()
                  if (t && !dienste.includes(t)) setDienste((l) => [...l, t])
                  setFrei('')
                }}
              >
                Hinzufügen
              </SecondaryButton>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <label className="block">
              <span className={feld}>Chance auf Auftrag (%)</span>
              <input type="number" min={0} max={100} step={5} value={chance} onChange={(e) => { setChance(e.target.value); setBestaetigt(true) }} className={`${inputClass} w-full`} />
            </label>
            <label className="block">
              <span className={feld}>Begründung</span>
              <input value={begruendung} onChange={(e) => setBegruendung(e.target.value)} className={`${inputClass} w-full`} placeholder="Warum diese Einschätzung?" />
            </label>
          </div>
          {chance !== '' && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={bestaetigt} onChange={(e) => setBestaetigt(e.target.checked)} />
              Chance bestätigt (unbestätigte Werte erscheinen in der Liste kursiv)
            </label>
          )}
          <ChanceVorschlagFeld
            kundeId={k.id}
            nurLesen={nurLesen}
            kvUmsatz={zeile.umsatz.netto}
            umsatz={umsatzSchaetzung}
            setUmsatz={setUmsatzSchaetzung}
            monat={umsatzMonat}
            setMonat={setUmsatzMonat}
            onUebernehmen={(v) => {
              if (!v.chanceBestaetigt) {
                setChance(String(v.prozent))
                setBegruendung(v.begruendung)
              }
              setBestaetigt(true)
              setHinweis('Vorschlag eingesetzt. Mit „Speichern“ gilt er als bestätigt.')
            }}
          />
          <p className="text-xs text-slate-400">
            Gewichteter Umsatz: {fmtEURCent(gewichtet(zeile.umsatz.netto > 0 ? zeile.umsatz.netto : (umsatzFelder(umsatzSchaetzung, umsatzMonat).umsatzNetto ?? 0), chance === '' ? undefined : Number(chance)))}. Kostenvoranschläge der Akte gehen vor, sonst zählt der geschätzte Umsatz.
          </p>

          <div>
            <div className="mb-3"><WillkommenHinweis kundeId={k.id} nutzerName={nutzerName} nurLesen={nurLesen} /></div>
            <span className={feld}>Wiedervorlagen</span>
            {offenesFollowUp && (
              <label className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                <input type="checkbox" checked={followUpErledigt} onChange={(e) => setFollowUpErledigt(e.target.checked)} />
                <span className="flex-1">
                  Follow-up der Akte: {offenesFollowUp.note?.trim() || 'ohne Text'}
                  {offenesFollowUp.date ? ` · ${kurzDatum(offenesFollowUp.date)}` : ''}
                </span>
                <span className="text-xs text-slate-400">erledigt beim Speichern</span>
              </label>
            )}
            <WiedervorlagenListe
              kundeId={k.id}
              bereich={zeile.bereich}
              verantwortlich={k.verantwortlich}
              nutzerName={nutzerName}
              nurLesen={nurLesen}
              onAenderung={onWvAenderung}
            />
          </div>

          <label className="block">
            <span className={feld}>Nächste Schritte</span>
            <textarea value={naechste} onChange={(e) => setNaechste(e.target.value)} rows={2} className={`${inputClass} w-full`} />
          </label>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <label className="block">
              <span className={feld}>Ampel</span>
              <select value={ampel} onChange={(e) => setAmpel(e.target.value as '' | AmpelFarbe)} className={`${inputClass} w-full`}>
                <option value="">automatisch</option>
                <option value="gruen">Grün</option>
                <option value="gelb">Gelb</option>
                <option value="rot">Rot</option>
              </select>
            </label>
            {ampel && (
              <label className="block">
                <span className={feld}>Grund</span>
                <input value={ampelGrund} onChange={(e) => setAmpelGrund(e.target.value)} className={`${inputClass} w-full`} placeholder="Warum abweichend?" />
              </label>
            )}
          </div>
        </fieldset>
      </div>
    </Modal>
  )
}
