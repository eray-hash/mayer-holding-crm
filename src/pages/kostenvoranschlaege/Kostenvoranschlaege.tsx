import { useEffect, useMemo, useState } from 'react'
import { Calculator, Download, FilePlus2, Link2, Lock, Plus, Search } from 'lucide-react'
import { utils } from 'xlsx'
import type { CellObject } from 'xlsx'
import { useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { KvZuordnungVorschlaege } from '../../components/KvZuordnungVorschlaege'
import { Card, EmptyState, PrimaryButton, SecondaryButton, inputClass } from '../../components/ui'
import { KvAngebotModal, KvBearbeitenModal, KvListe, akteName, findeAkte, kvStatusLabel, useKvAktionen, useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { KV_STATUS, kvGesamt, kvSumme, ladeKostenvoranschlaege, type KvStatus, type Kostenvoranschlag } from '../../lib/kostenvoranschlaege'
import { ladeMappeHerunter } from '../../lib/pivotExport'
import { fmtEURCent, today } from '../../lib/dates'

// Übersicht aller Kostenvoranschläge (/kostenvoranschlaege) bzw. nur der eigenen privaten (/privat/kostenvoranschlaege).
// Was jemand sieht, begrenzt die Datenbank (Bereichsrechte, private Einträge nur für den Besitzer).
export function Kostenvoranschlaege({ privat }: { privat?: boolean } = {}) {
  const { state } = useApp()
  const nutzer = useKvNutzer()
  const [alle, setAlle] = useState<Kostenvoranschlag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [statusFilter, setStatusFilter] = useState<KvStatus | ''>('')
  const [suche, setSuche] = useState('')
  const [fenster, setFenster] = useState<{ eintrag?: Kostenvoranschlag } | null>(null)
  const [angebot, setAngebot] = useState(false)
  const { darf } = useBereichsRechte()
  const { statusAendern, loeschen, uebernehmen } = useKvAktionen(setAlle, setFehler)
  // Einmalige Zuordnung der Einträge ohne Akte (22.11.2026) — nur Geschäftsführung/Admins, nicht in „Ansehen als …“.
  const { echterMitarbeiter } = useAuth()
  const darfZuordnen = !privat && !nutzer.nurLesen && !!echterMitarbeiter && (echterMitarbeiter.rolle === 'geschaeftsfuehrung' || !!echterMitarbeiter.ist_admin)
  const [zuordnungOffen, setZuordnungOffen] = useState(false)
  const [neuLaden, setNeuLaden] = useState(0)

  useEffect(() => {
    let aktiv = true
    setLaedt(true)
    ladeKostenvoranschlaege()
      .then((l) => aktiv && setAlle(l))
      .catch((err) => aktiv && setFehler(err instanceof Error ? err.message : 'Kostenvoranschläge ließen sich nicht laden.'))
      .finally(() => aktiv && setLaedt(false))
    return () => {
      aktiv = false
    }
  }, [neuLaden])

  // Im Modus „Ansehen als …“ lädt die Datenbank mit dem eigenen Login; hier wird auf das gefiltert,
  // was die angesehene Person sehen würde (eigene private Einträge, freigegebene Bereiche).
  const sichtbar = useMemo(() => {
    if (!nutzer.nurLesen) return alle
    return alle.filter((k) => {
      if (k.bereich === 'privat' || k.privatBesitzer) return !!k.privatBesitzer && k.privatBesitzer === nutzer.email
      if (!k.bereich) return true
      return darf(k.bereich as never)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alle, nutzer.nurLesen, nutzer.email])
  // Die allgemeine Seite zeigt nur Einträge der Holding: eigene private stehen unter „Meine Kostenvoranschläge“ und
  // liefen sonst in Kennzahlen, Summen und ins Angebot mit (die Excel-Datei ließ sie schon weg).
  const imUmfang = useMemo(
    () => (privat ? sichtbar.filter((k) => k.bereich === 'privat' || !!k.privatBesitzer) : sichtbar.filter((k) => k.bereich !== 'privat' && !k.privatBesitzer)),
    [sichtbar, privat],
  )

  const gefiltert = useMemo(() => {
    const such = suche.trim().toLowerCase()
    return imUmfang.filter((k) => {
      if (statusFilter && k.status !== statusFilter) return false
      if (!such) return true
      const akte = findeAkte(state, k.kundeId)
      return [k.name, k.beschreibung, k.notiz, akte ? akteName(akte.kunde) : ''].some((t) => t.toLowerCase().includes(such))
    })
  }, [imUmfang, statusFilter, suche, state])

  const ohneAkte = useMemo(() => alle.filter((k) => !k.kundeId).length, [alle])

  const summeVon = (s: KvStatus) => kvSumme(imUmfang.filter((k) => k.status === s))

  function herunterladen() {
    const kopf = ['Name', 'Beschreibung', 'Betrag (€)', 'Status', 'Datum', 'Akte', 'Bereich', 'Notiz', 'Datei', 'Erfasst von']
    // Auf der allgemeinen Seite keine privaten Einträge in die Datei — die wird oft weitergegeben.
    const fuerDatei = privat ? gefiltert : gefiltert.filter((k) => k.bereich !== 'privat' && !k.privatBesitzer)
    const zeilen: (string | number | Date | null)[][] = fuerDatei.map((k) => {
      const akte = findeAkte(state, k.kundeId)
      return [
        k.name,
        k.beschreibung,
        k.betrag ?? null,
        kvStatusLabel(k.status),
        k.datum ? new Date(`${k.datum.slice(0, 10)}T12:00:00`) : null,
        akte ? akteName(akte.kunde) : k.kundeId ? 'Akte nicht geladen' : 'Keiner Akte zugeordnet',
        akte ? (akte.bereich === 'privat' ? 'Privat' : akte.bereichLabel) : k.bereich === 'privat' ? 'Privat' : '',
        k.notiz,
        k.dokument?.name ?? '',
        k.erstelltVon,
      ]
    })
    const n = zeilen.length
    zeilen.push([])
    zeilen.push(['Summe der angezeigten Zeilen', '', null, '', null, '', '', '', '', ''])
    const blatt = utils.aoa_to_sheet([kopf, ...zeilen], { cellDates: true })
    // Summe als Formel, die beim Filtern in Excel mitrechnet (TEILERGEBNIS bzw. SUBTOTAL).
    blatt[utils.encode_cell({ r: n + 2, c: 2 })] = { t: 'n', f: `SUBTOTAL(109,C2:C${n + 1})`, z: '#,##0.00 "€"' } as CellObject
    // Beträge als Zahl mit deutschem Euro-Format, Datum als echtes Datum (sortiert richtig).
    for (let r = 1; r <= n; r++) {
      const zelle = blatt[utils.encode_cell({ r, c: 2 })] as CellObject | undefined
      if (zelle && zelle.t === 'n') zelle.z = '#,##0.00 "€"'
      const d = blatt[utils.encode_cell({ r, c: 4 })] as CellObject | undefined
      if (d && (d.t === 'd' || d.t === 'n')) d.z = 'dd.mm.yyyy'
    }
    blatt['!cols'] = [{ wch: 28 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 30 }, { wch: 20 }, { wch: 40 }, { wch: 28 }, { wch: 18 }]
    blatt['!autofilter'] = { ref: utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(n, 1), c: kopf.length - 1 } }) }
    const mappe = utils.book_new()
    utils.book_append_sheet(mappe, blatt, 'Kostenvoranschläge')
    ladeMappeHerunter(mappe, `Kostenvoranschlaege${privat ? '_privat' : ''}_${today()}.xlsx`)
  }

  if (privat && nutzer.nurLesen) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Private Kostenvoranschläge werden in dieser Ansicht nicht gezeigt.</div>
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-800">
            {privat ? <Lock size={20} className="text-accent-600" /> : <Calculator size={20} className="text-accent-600" />}
            {privat ? 'Meine Kostenvoranschläge' : 'Kostenvoranschläge'}
          </h1>
          <p className="text-sm text-slate-500">
            {privat
              ? 'Nur deine privaten Kostenvoranschläge — niemand sonst sieht sie.'
              : 'Alle Kostenvoranschläge der Holding, die du sehen darfst — mit Akte oder noch ohne Zuordnung. Deine privaten stehen im privaten Bereich.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton onClick={herunterladen} disabled={gefiltert.length === 0}>
            <Download size={15} /> Als Excel-Datei herunterladen
          </SecondaryButton>
          {!nutzer.nurLesen && (
            <SecondaryButton onClick={() => setAngebot(true)} disabled={!imUmfang.some((k) => k.status !== 'abgelehnt')}>
              <FilePlus2 size={15} /> Angebot erstellen
            </SecondaryButton>
          )}
          {!nutzer.nurLesen && (
            <PrimaryButton onClick={() => setFenster({})}>
              <Plus size={15} /> Neuer Kostenvoranschlag
            </PrimaryButton>
          )}
        </div>
      </div>

      {darfZuordnen && ohneAkte > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <Link2 size={16} className="shrink-0" />
            {ohneAkte} {ohneAkte === 1 ? 'Kostenvoranschlag' : 'Kostenvoranschläge'} ohne Akte — sie fehlen in Umsatzvorschau, Rechnungsvorschlägen und Wiedervorlagen.
          </span>
          <SecondaryButton onClick={() => setZuordnungOffen(true)}>Vorschläge ansehen</SecondaryButton>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kennzahl titel="Anzahl" wert={String(imUmfang.length)} />
        <Kennzahl titel="Summe offen" wert={fmtEURCent(summeVon('offen'))} farbe="text-amber-700" />
        <Kennzahl titel="Summe angenommen" wert={fmtEURCent(summeVon('angenommen'))} farbe="text-sky-700" />
        <Kennzahl titel="Summe bezahlt" wert={fmtEURCent(summeVon('bezahlt'))} farbe="text-emerald-700" />
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={`${inputClass} pl-9`} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen nach Name, Beschreibung, Notiz oder Akte …" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterKnopf aktiv={statusFilter === ''} onClick={() => setStatusFilter('')} label="Alle" anzahl={imUmfang.length} />
          {KV_STATUS.map((s) => (
            <FilterKnopf key={s.id} aktiv={statusFilter === s.id} onClick={() => setStatusFilter(s.id)} label={s.label} anzahl={imUmfang.filter((k) => k.status === s.id).length} />
          ))}
        </div>
      </div>

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      {laedt ? (
        <p className="text-sm text-slate-400">Wird geladen …</p>
      ) : gefiltert.length === 0 ? (
        <EmptyState text={imUmfang.length === 0 ? 'Noch keine Kostenvoranschläge.' : 'Keine Kostenvoranschläge passen zu Suche und Filter.'} />
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {gefiltert.length} {gefiltert.length === 1 ? 'Eintrag' : 'Einträge'} angezeigt · Summe <span className="font-medium text-slate-700">{fmtEURCent(kvGesamt(gefiltert).summe)}</span>
            {' '}(ohne Abgelehnte{kvGesamt(gefiltert).ohneBetrag ? `; ${kvGesamt(gefiltert).ohneBetrag} ohne Betrag` : ''})
          </p>
          <KvListe eintraege={gefiltert} nurLesen={nutzer.nurLesen} onBearbeiten={(kv) => setFenster({ eintrag: kv })} onStatus={statusAendern} onLoeschen={loeschen} />
        </>
      )}

      {darfZuordnen && <KvZuordnungVorschlaege open={zuordnungOffen} onClose={() => setZuordnungOffen(false)} onZugeordnet={() => setNeuLaden((n) => n + 1)} />}

      <KvAngebotModal open={angebot} onClose={() => setAngebot(false)} eintraege={gefiltert} />

      <KvBearbeitenModal
        open={!!fenster}
        onClose={() => setFenster(null)}
        eintrag={fenster?.eintrag}
        nurPrivat={privat}
        onGespeichert={uebernehmen}
      />
    </div>
  )
}

function Kennzahl({ titel, wert, farbe = 'text-slate-800' }: { titel: string; wert: string; farbe?: string }) {
  return (
    <Card className="p-3 sm:p-4">
      <div className="text-xs font-medium text-slate-500">{titel}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums sm:text-xl ${farbe}`}>{wert}</div>
    </Card>
  )
}

function FilterKnopf({ aktiv, onClick, label, anzahl }: { aktiv: boolean; onClick: () => void; label: string; anzahl: number }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${aktiv ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
    >
      {label} <span className="text-slate-400">{anzahl}</span>
    </button>
  )
}
