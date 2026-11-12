import { useState } from 'react'
import { Sparkles, Plus, Loader2, FileText, MessageSquare, Receipt, StickyNote, User, Globe } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getStatusMap } from '../data/statusNetworks'
import { CURRENT_USER } from '../data/constants'
import { analysierePotenzial, rechercheKundenUmfeld, holeDokumentInhalte, type DokumentInhaltInfo } from '../lib/emailGateway'
import { akteWissen } from '../lib/akteWissen'
import { SteuerAnalyseSection } from './SteuerAnalyseSection'
import { Card, PrimaryButton, PriorityBadge, EmptyState } from './ui'
import { fmtDate, fmtDateTime, fmtEURCent, addDays, today } from '../lib/dates'
import type { KundeBereich, PotenzialAnalyse, PotenzialQuelle } from '../types'

// Label für die Bereichs-Badge einer vorgeschlagenen Chance — bewusst alle sieben Bereiche
// (inkl. Immobilien), auch wenn diese Section nur in den KundeBereich-Detailseiten eingebunden
// wird: eine Chance kann ja auf Immobilien als Zielbereich zeigen.
const BEREICH_LABELS: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}

const QUELLEN_ICON = {
  Stammdaten: User,
  Aktivität: StickyNote,
  Dokument: FileText,
  Gesprächsprotokoll: MessageSquare,
  Rechnung: Receipt,
  'Internet-Recherche': Globe,
} as const

const SICHERHEIT_LABEL = { gesichert: 'gesichert', wahrscheinlich: 'wahrscheinlich dieselbe Person', unsicher: 'unsicher, Namensgleichheit möglich' } as const

// KI-gestützte Cross-Sell-/Upsell-Potenzialanalyse für einen Kunden/Mandanten — nutzt allgemeines
// KI-Fachwissen zu den Leistungsbereichen der Holding (siehe email-gateway "potenzial_analyse"),
// da keine echte Otto-Schmidt-Verlag-Anbindung lizenziert ist.
//
// Das Ergebnis wird in der Akte gespeichert (kunde.potenzialAnalyse) und zeigt offen, worauf es
// beruht: jeder Eintrag, der der KI vorlag, bekommt eine Kennung, und jede Chance nennt die
// Kennungen, auf die sie sich stützt. Vorher verschwand das Ergebnis beim Reiterwechsel, und es war
// nicht erkennbar, dass die KI z. B. von Dokumenten nur den Dateinamen kennt.
export function PotenzialAnalyseSection({ bereich, kundeId, kundeName }: { bereich: KundeBereich; kundeId: string; kundeName: string }) {
  const { state, dispatch } = useApp()
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [grundlageOffen, setGrundlageOffen] = useState(false)

  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const analyse = kunde?.potenzialAnalyse

  function speichere(neu: PotenzialAnalyse) {
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kundeId, patch: { potenzialAnalyse: neu } })
  }

  function sammleQuellen(inhalte: Map<string, DokumentInhaltInfo>): PotenzialQuelle[] {
    if (!kunde) return []
    const inhaltVermerk = (url: string) => {
      const i = inhalte.get(url)
      if (i?.status === 'gelesen') return i.zusammenfassung ? ` — Inhalt: ${i.zusammenfassung}` : ' — Inhalt gelesen'
      if (i?.status === 'laeuft') return ' — Inhalt wird gerade eingelesen, lag noch nicht vor'
      return ' — Inhalt lag nicht vor, nur der Dateiname'
    }
    const statusLabel = getStatusMap(bereich)[kunde.status]?.label ?? kunde.status
    const protokolle = state.protokolle.filter((p) => p.bereich === bereich && p.kundeId === kundeId)
    const rechnungen = state.rechnungen.filter((r) => r.kundeId === kundeId)
    return [
      {
        id: 'S1',
        art: 'Stammdaten',
        text: `${kunde.firma}${kunde.ansprechpartner && kunde.ansprechpartner !== kunde.firma ? ` (${kunde.ansprechpartner})` : ''} · Bereich ${BEREICH_LABELS[bereich] ?? bereich} · Status ${statusLabel} · Priorität ${kunde.prioritaet}`,
      },
      ...kunde.activities.slice(0, 20).map((a, i): PotenzialQuelle => ({ id: `A${i + 1}`, art: 'Aktivität', text: `${fmtDate(a.date)}: ${a.text}` })),
      ...(kunde.dokumente ?? []).slice(0, 40).map((d, i): PotenzialQuelle => ({ id: `D${i + 1}`, art: 'Dokument', text: `${d.name} (abgelegt ${fmtDate(d.datum)})${inhaltVermerk(d.url ?? '')}` })),
      ...protokolle.map((p, i): PotenzialQuelle => ({ id: `P${i + 1}`, art: 'Gesprächsprotokoll', text: `${fmtDate(p.datum)} „${p.betreff}": ${p.kiZusammenfassung ?? p.text}` })),
      ...rechnungen.map((r, i): PotenzialQuelle => ({
        id: `R${i + 1}`,
        art: 'Rechnung',
        text: `${r.nummer} vom ${fmtDate(r.datum)}${r.leistungBezeichnung ? `, ${r.leistungBezeichnung}` : ''}: ${fmtEURCent(r.betragBrutto)} brutto, ${r.status}`,
      })),
    ]
  }

  async function analysieren() {
    setLoading(true)
    setError('')
    try {
      if (!kunde) throw new Error('Kunde/Mandant nicht gefunden.')
      // Erst nach außen schauen: weitere Firmen, Funktionen und Beteiligungen des Kunden, die noch
      // nicht in der Akte stehen. Scheitert die Suche, läuft die Analyse trotzdem — mit Vermerk.
      setPhase('Suche im Internet nach weiteren Firmen und Beteiligungen …')
      let webRecherche: PotenzialAnalyse['webRecherche'] = 'ok'
      let webQuellen: PotenzialQuelle[] = []
      try {
        const { funde } = await rechercheKundenUmfeld({
          person: kunde.ansprechpartner,
          firma: kunde.firma,
          email: kunde.email,
          webseite: kunde.unternehmensbewertung?.webseite,
          bekannt: akteWissen(kunde),
        })
        webQuellen = funde.map((f, i): PotenzialQuelle => ({
          id: `W${i + 1}`,
          art: 'Internet-Recherche',
          text: f.text,
          // Nur echte Web-Adressen als Link zulassen — die Angabe stammt aus einer KI-Antwort.
          url: /^https?:\/\//i.test(f.quelle_url ?? '') ? f.quelle_url : undefined,
          sicherheit: f.sicherheit,
          bereitsBekannt: !!f.bereits_bekannt,
        }))
      } catch {
        webRecherche = 'fehlgeschlagen'
      }
      // Kurzfassungen der schon gelesenen Dokumente holen; das Lesen der übrigen läuft dabei an.
      let inhalte = new Map<string, DokumentInhaltInfo>()
      try {
        const r = await holeDokumentInhalte((kunde.dokumente ?? []).slice(0, 40).flatMap((d) => (d.url ? [{ url: d.url, name: d.name, typ: d.typ }] : [])))
        inhalte = new Map(r.dokumente.map((d) => [d.url, d]))
      } catch {
        inhalte = new Map()
      }
      setPhase('Werte Akte und Funde aus …')
      const quellen = [...sammleQuellen(inhalte), ...webQuellen]
      const abschnitt = (titel: string, art: PotenzialQuelle['art'], hinweis = '') => {
        const eintraege = quellen.filter((q) => q.art === art)
        return [`${titel}${hinweis}:`, ...(eintraege.length > 0 ? eintraege.map((q) => `[${q.id}] ${q.text}`) : ['(keine)']), '']
      }
      const kontext = [
        ...abschnitt('Stammdaten', 'Stammdaten'),
        ...abschnitt('Aktivitäten (neueste zuerst)', 'Aktivität'),
        ...abschnitt('Dokumente in der Akte', 'Dokument', ' — mit Kurzfassung des Inhalts, soweit das Dokument schon gelesen ist'),
        ...abschnitt('Gesprächsprotokolle', 'Gesprächsprotokoll'),
        ...abschnitt('Rechnungen der Holding an den Kunden', 'Rechnung'),
        webRecherche === 'ok' ? 'Öffentliche Internet-Recherche über den Kunden (weitere Firmen, Funktionen, Beteiligungen):' : 'Internet-Recherche: nicht verfügbar.',
        ...webQuellen.map((q) => `[${q.id}] ${q.text} (Sicherheit der Zuordnung: ${q.sicherheit ?? 'unbekannt'}; ${q.bereitsBekannt ? 'schon aus der Akte bekannt' : 'NEU, stand bisher nicht in der Akte'})`),
        ...(webRecherche === 'ok' && webQuellen.length === 0 ? ['(nichts Belastbares gefunden)'] : []),
      ].join('\n')
      const chancen = await analysierePotenzial(kontext)
      const bekannt = new Set(quellen.map((q) => q.id))
      speichere({
        erstelltAm: new Date().toISOString(),
        erstelltVon: CURRENT_USER,
        // Kennungen, die es nicht gibt, fliegen raus — eine erfundene Quelle wäre schlimmer als keine.
        chancen: chancen.map((c) => ({ ...c, quellen: (c.quellen ?? []).map((q) => q.replace(/[[\]\s]/g, '')).filter((q) => bekannt.has(q)) })),
        quellen,
        webRecherche,
        dokumenteMitInhalt: [...inhalte.values()].filter((d) => d.status === 'gelesen').length,
        dokumenteInArbeit: [...inhalte.values()].filter((d) => d.status === 'laeuft').length,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analyse fehlgeschlagen.')
    } finally {
      setLoading(false)
      setPhase('')
    }
  }

  function alsFollowUpUebernehmen(index: number) {
    if (!analyse || !kunde) return
    const c = analyse.chancen[index]
    // Ein bereits offenes Follow-up (z. B. ein dringender Erstkontakt) darf nicht durch den
    // Cross-Sell-Vorschlag überschrieben werden — die Chance landet dann nur als Aktivität in der
    // Kundenakte, das bestehende Follow-up bleibt die aktuelle Priorität.
    const hatOffenesFollowUp = !kunde.followUp.done
    dispatch({
      type: 'ADD_POTENZIAL_NOTIZ',
      bereich,
      kundeId,
      titel: c.titel,
      begruendung: c.begruendung,
      ...(hatOffenesFollowUp ? {} : { followUp: { date: addDays(today(), 3), note: c.naechster_schritt, done: false } }),
    })
    speichere({
      ...analyse,
      chancen: analyse.chancen.map((x, i) => (i === index ? { ...x, uebernommen: hatOffenesFollowUp ? 'vermerkt' : 'followup' } : x)),
    })
  }

  const quelleNachId = new Map((analyse?.quellen ?? []).map((q) => [q.id, q]))
  const webFunde = (analyse?.quellen ?? []).filter((q) => q.art === 'Internet-Recherche')
  const neueFunde = webFunde.filter((q) => !q.bereitsBekannt)
  const bekannteFunde = webFunde.filter((q) => q.bereitsBekannt)
  const zahl = (art: PotenzialQuelle['art'], einzahl: string, mehrzahl: string) => {
    const n = (analyse?.quellen ?? []).filter((q) => q.art === art).length
    return `${n} ${n === 1 ? einzahl : mehrzahl}`
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Lässt die KI auf Basis der Daten zu {kundeName} prüfen, ob weitere Leistungen der Holding für diesen Kunden sinnvoll sein könnten.
        </p>
        <PrimaryButton onClick={analysieren} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {loading ? 'Analysiere …' : analyse ? 'Erneut analysieren' : 'Potenzial analysieren'}
        </PrimaryButton>
      </div>

      {loading && phase && <p className="mb-3 text-xs text-slate-500">{phase} Das dauert etwa eine Minute.</p>}

      {error && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{error}</p>}

      {analyse && (
        <Card className="mb-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-700">Grundlage dieser Analyse</p>
              <p className="text-xs text-slate-400">
                Erstellt am {fmtDateTime(analyse.erstelltAm)} von {analyse.erstelltVon} · gespeichert in der Akte
              </p>
            </div>
            <button
              onClick={() => setGrundlageOffen((o) => !o)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {grundlageOffen ? 'Einträge ausblenden' : `Alle ${analyse.quellen.length} ausgewerteten Einträge anzeigen`}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Aus der Akte lagen der KI vor: Stammdaten, {zahl('Aktivität', 'Aktivität', 'Aktivitäten')}, {zahl('Dokument', 'Dokument', 'Dokumente')},{' '}
            {zahl('Gesprächsprotokoll', 'Gesprächsprotokoll', 'Gesprächsprotokolle')} und {zahl('Rechnung', 'Rechnung', 'Rechnungen')}.{' '}
            {analyse.dokumenteMitInhalt === undefined
              ? 'Von Dokumenten kannte sie bei dieser älteren Analyse nur den Dateinamen.'
              : `Von den Dokumenten lagen ${analyse.dokumenteMitInhalt} mit ihrem Inhalt vor${
                  analyse.dokumenteInArbeit ? `; ${analyse.dokumenteInArbeit} wurden gerade erst eingelesen — in ein paar Minuten erneut analysieren, dann fließen auch sie ein` : ''
                }.${
                  analyse.dokumenteMitInhalt < analyse.quellen.filter((q) => q.art === 'Dokument').length
                    ? ' Von den übrigen kannte sie nur den Dateinamen.'
                    : ''
                }`}{' '}
            {analyse.webRecherche === 'ok'
              ? `Zusätzlich wurde öffentlich im Internet nach weiteren Firmen, Funktionen und Beteiligungen gesucht (${zahl('Internet-Recherche', 'Fund', 'Funde')}).`
              : analyse.webRecherche === 'fehlgeschlagen'
                ? 'Die Internet-Recherche ist bei diesem Lauf fehlgeschlagen — das Ergebnis beruht nur auf der Akte.'
                : 'Bei dieser älteren Analyse wurde noch nicht im Internet gesucht.'}{' '}
            Die Vorschläge sind Einschätzungen und keine geprüften Fakten.
          </p>
          {grundlageOffen && (
            <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
              {analyse.quellen.map((q) => (
                <QuellenZeile key={q.id} quelle={q} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {analyse && analyse.webRecherche === 'ok' && (
        <Card className="mb-3 p-4">
          <p className="mb-1 text-sm font-medium text-slate-700">Über die Akte hinaus gefunden</p>
          {neueFunde.length === 0 ? (
            <p className="text-xs text-slate-500">
              Die Internet-Recherche hat nichts ergeben, was nicht schon in der Akte steht
              {bekannteFunde.length > 0 ? ` (${bekannteFunde.length} Funde bestätigen Bekanntes)` : ''}. Das heißt nicht, dass es nichts gibt — nur, dass öffentlich nichts Belastbares zu finden war.
            </p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {neueFunde.map((q) => (
                <li key={q.id} className="flex gap-2 text-sm text-slate-700">
                  <Globe size={14} className="mt-0.5 flex-shrink-0 text-accent-600" />
                  <div className="min-w-0">
                    <p className="break-words">{q.text}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Zuordnung: {q.sicherheit ? SICHERHEIT_LABEL[q.sicherheit] : 'nicht angegeben'}
                      {q.url && (
                        <>
                          {' · '}
                          <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
                            Quelle öffnen
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">Vor einem Kundengespräch gegenprüfen: Bei häufigen Namen kann ein Fund eine andere Person betreffen.</p>
        </Card>
      )}

      {analyse && analyse.chancen.length === 0 && !error && <EmptyState text="Aktuell keine zusätzliche Chance erkennbar." />}

      {analyse && analyse.chancen.length > 0 && (
        <div className="space-y-3">
          {analyse.chancen.map((c, i) => {
            const belege = (c.quellen ?? []).map((id) => quelleNachId.get(id)).filter((q): q is PotenzialQuelle => !!q)
            return (
              <Card key={i} className="p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">{BEREICH_LABELS[c.bereich] ?? c.bereich}</span>
                  <PriorityBadge value={c.prioritaet} />
                </div>
                <p className="mb-1 text-sm font-medium text-slate-800">{c.titel}</p>
                <p className="mb-2 text-sm text-slate-600">{c.begruendung}</p>
                <p className="mb-3 text-xs text-slate-400">Nächster Schritt: {c.naechster_schritt}</p>

                <div className="mb-3 rounded-lg bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-medium text-slate-500">Stützt sich auf</p>
                  {belege.length > 0 ? (
                    <ul className="space-y-1.5">
                      {belege.map((q) => (
                        <QuellenZeile key={q.id} quelle={q} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">Die KI hat keinen konkreten Eintrag der Akte als Beleg genannt — dieser Vorschlag beruht auf allgemeiner Einschätzung.</p>
                  )}
                  {c.annahmen && (
                    <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Annahme, noch zu prüfen:</span> {c.annahmen}
                    </p>
                  )}
                </div>

                {c.uebernommen ? (
                  <p className="text-xs font-medium text-emerald-600">
                    {c.uebernommen === 'followup' ? 'Als Follow-up übernommen.' : 'In der Kundenakte vermerkt — bestehendes Follow-up bleibt erhalten.'}
                  </p>
                ) : (
                  <button
                    onClick={() => alsFollowUpUebernehmen(i)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <Plus size={13} /> Als Follow-up übernehmen
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {!analyse && !loading && !error && <EmptyState text="Noch keine Analyse durchgeführt." />}

      <SteuerAnalyseSection bereich={bereich} kundeId={kundeId} />
    </div>
  )
}

function QuellenZeile({ quelle }: { quelle: PotenzialQuelle }) {
  const Icon = QUELLEN_ICON[quelle.art]
  return (
    <li className="flex gap-2 text-xs text-slate-600">
      <Icon size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
      <span className="min-w-0 break-words">
        <span className="font-medium text-slate-500">{quelle.art}:</span> {quelle.text}
        {quelle.sicherheit && <span className="text-slate-400"> · Zuordnung {SICHERHEIT_LABEL[quelle.sicherheit]}</span>}
        {quelle.url && (
          <>
            {' · '}
            <a href={quelle.url} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
              Quelle
            </a>
          </>
        )}
      </span>
    </li>
  )
}
