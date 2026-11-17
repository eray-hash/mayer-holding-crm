import { useState } from 'react'
import { Check, Printer, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { IMMO_AUFTRAGSARTEN } from './ImmoStammdatenblatt'
import { druckeBlatt, type DruckAbschnitt } from '../lib/blattDruck'
import { holeObjektDatenVorschlag, isEmailGatewayConfigured } from '../lib/emailGateway'
import { fmtDate, fmtEUR, today } from '../lib/dates'
import type { ImmoAuftragsart, Objekt, ObjektTyp, ObjektVerkaufsdaten } from '../types'

const KENNZAHLEN: { id: 'baujahr' | 'grundstuecksflaeche' | 'wohnflaeche' | 'nutzflaeche' | 'einheiten' | 'zimmer' | 'stellplaetze' | 'vermietungsstatus'; label: string; platz?: string }[] = [
  { id: 'baujahr', label: 'Baujahr' },
  { id: 'grundstuecksflaeche', label: 'Grundstücksfläche', platz: 'm²' },
  { id: 'wohnflaeche', label: 'Wohnfläche', platz: 'm²' },
  { id: 'nutzflaeche', label: 'Nutzfläche', platz: 'm²' },
  { id: 'einheiten', label: 'Anzahl Einheiten' },
  { id: 'zimmer', label: 'Zimmeranzahl' },
  { id: 'stellplaetze', label: 'Stellplätze' },
  { id: 'vermietungsstatus', label: 'Vermietungsstatus', platz: 'z. B. voll vermietet' },
]

const VERFAHREN = ['Vergleichswertverfahren', 'Sachwertverfahren', 'Ertragswertverfahren', 'Lagebewertung', 'A/B/C-Städte', 'Umgebungsrecherche']

const VERKAUFSSTATUS = [
  'Erstaufnahme',
  'Unterlagenprüfung',
  'Bewertung erstellt',
  'Exposé vorbereitet',
  'Vermarktung aktiv',
  'Besichtigungen laufen',
  'Käufer gefunden',
  'Kaufvertrag vorbereitet',
  'Verkauf abgeschlossen',
]

// Feinere Objektart des Datenblatts → die fünf Objektarten, nach denen das CRM filtert und abgleicht.
const OBJEKTARTEN: { label: string; typ: ObjektTyp }[] = [
  { label: 'Eigentumswohnung', typ: 'Wohnung' },
  { label: 'Einfamilienhaus', typ: 'Haus' },
  { label: 'Zweifamilienhaus', typ: 'Haus' },
  { label: 'Reihenhaus / Doppelhaus', typ: 'Haus' },
  { label: 'Mehrfamilienhaus', typ: 'Haus' },
  { label: 'Wohn- und Geschäftshaus', typ: 'Haus' },
  { label: 'Gewerbeimmobilie', typ: 'Gewerbe' },
  { label: 'Grundstück', typ: 'Grundstück' },
  { label: 'Projektentwicklung', typ: 'Neubauprojekt' },
]

const UNTERLAGEN = [
  'Grundbuchauszug',
  'Flurkarte',
  'Lageplan',
  'Bauunterlagen',
  'Wohnflächenberechnung',
  'Lagenbewertung',
  'Energieausweis',
  'Mietverträge',
  'Mietaufstellung',
  'Teilungserklärung',
  'Baulastenverzeichnis',
  'Altlastenauskunft',
]

// Welcher Ordner der Objektakte welche Zeile des Unterlagenstatus belegt.
const UNTERLAGE_ORDNER: Record<string, 'Grundbuch' | 'Flurkarte' | 'Lageplan' | 'Wohnflächenberechnung' | 'Energieausweis' | 'Mietverträge' | 'Mieterliste' | 'Teilungserklärung' | 'Baulastenauskunft'> = {
  Grundbuchauszug: 'Grundbuch',
  Flurkarte: 'Flurkarte',
  Lageplan: 'Lageplan',
  Wohnflächenberechnung: 'Wohnflächenberechnung',
  Energieausweis: 'Energieausweis',
  Mietverträge: 'Mietverträge',
  Mietaufstellung: 'Mieterliste',
  Teilungserklärung: 'Teilungserklärung',
  Baulastenverzeichnis: 'Baulastenauskunft',
}

function leer(o: Objekt): ObjektVerkaufsdaten {
  return {
    datum: today(),
    auftraggeber: { name: o.eigentuemer?.name ?? '', telefon: o.eigentuemer?.telefon ?? '', email: o.eigentuemer?.email ?? '', adresse: '', webseite: '', bonitaet: '' },
    kennzahlen: { baujahr: '', grundstuecksflaeche: '', wohnflaeche: '', nutzflaeche: '', einheiten: '', zimmer: '', stellplaetze: '', vermietungsstatus: '', kaufpreisvorstellung: o.kaufpreis > 0 ? o.kaufpreis : undefined },
    bewertung: { rendite: '', faktor: '', verfahren: [] },
    verkaufsstatus: [],
    verkaufsstatusNotiz: '',
    uebersicht: { strasse: '', plzOrt: o.adresse, flurstueck: '', gemarkung: '', objektart: '' },
    unterlagen: {},
    sonstiges: '',
  }
}

function zahl(text: string): number | undefined {
  const sauber = text.replace(/[^\d]/g, '')
  return sauber ? Number(sauber) : undefined
}

function schalte(liste: string[], wert: string): string[] {
  return liste.includes(wert) ? liste.filter((x) => x !== wert) : [...liste, wert]
}

/** Das Verkaufsdatenblatt eines Objekts: Auftraggeber, Maklerauftrag, Kennzahlen, Bewertung, Verkaufsstatus,
 *  Objektübersicht und Unterlagenstatus auf einer Seite — zum Ausfüllen im CRM und zum Ausdrucken. */
export function ObjektVerkaufsdatenblatt({ objekt }: { objekt: Objekt }) {
  const { dispatch } = useApp()
  const [d, setD] = useState<ObjektVerkaufsdaten>(objekt.verkaufsdaten ?? leer(objekt))
  const [gespeichert, setGespeichert] = useState(false)
  const geaendert = JSON.stringify(d) !== JSON.stringify(objekt.verkaufsdaten ?? leer(objekt))

  function setze(aenderung: Partial<ObjektVerkaufsdaten>) {
    setD((alt) => ({ ...alt, ...aenderung }))
    setGespeichert(false)
  }
  const k = d.kennzahlen
  const miete = k.jahresnettokaltmiete
  const preis = k.kaufpreisvorstellung
  const rechnerisch = miete && preis ? `rechnerisch: Faktor ${(preis / miete).toLocaleString('de-DE', { maximumFractionDigits: 1 })} · Rendite ${((miete / preis) * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %` : ''

  // Vorbefüllen aus den Unterlagen des Objekts: Die KI liest Exposé, Gutachten usw. und schlägt Werte vor.
  // Übernommen wird nur in LEERE Felder — was schon eingetragen ist, bleibt. Gespeichert wird erst per Knopf.
  const [liest, setLiest] = useState(false)
  const [vorbefuellt, setVorbefuellt] = useState<{ felder: string[]; belege: string; hinweise: string; gelesen: string[]; ausgelassen: string[] } | null>(null)
  const [leseFehler, setLeseFehler] = useState('')

  async function vorbefuellen() {
    setLiest(true)
    setLeseFehler('')
    setVorbefuellt(null)
    try {
      const r = await holeObjektDatenVorschlag(objekt.id)
      const v = r.vorschlag
      const felder: string[] = []
      if (v) {
        const s = (wert: unknown) => (typeof wert === 'string' ? wert.trim() : typeof wert === 'number' ? String(wert) : '')
        const n = (wert: unknown) => (typeof wert === 'number' && Number.isFinite(wert) && wert > 0 ? Math.round(wert) : undefined)
        setD((alt) => {
          const neu: ObjektVerkaufsdaten = { ...alt, auftraggeber: { ...alt.auftraggeber }, kennzahlen: { ...alt.kennzahlen }, uebersicht: { ...alt.uebersicht }, unterlagen: { ...alt.unterlagen } }
          const setzeText = <T extends Record<string, unknown>>(ziel: T, feld: keyof T, wert: unknown, name: string) => {
            const text = s(wert)
            if (text && !String(ziel[feld] ?? '').trim()) {
              ziel[feld] = text as T[keyof T]
              felder.push(name)
            }
          }
          setzeText(neu.uebersicht, 'strasse', v.strasse, 'Straße')
          // Der Ort war nur aus der Objektliste übernommen: ein genauerer Wert aus den Unterlagen ersetzt ihn.
          if (s(v.plzOrt) && (!neu.uebersicht.plzOrt.trim() || neu.uebersicht.plzOrt === objekt.adresse)) {
            neu.uebersicht.plzOrt = s(v.plzOrt)
            felder.push('PLZ / Ort')
          }
          setzeText(neu.uebersicht, 'flurstueck', v.flurstueck, 'Flurstück')
          setzeText(neu.uebersicht, 'gemarkung', v.gemarkung, 'Gemarkung')
          if (!neu.uebersicht.objektart && OBJEKTARTEN.some((a) => a.label === v.objektart)) {
            neu.uebersicht.objektart = String(v.objektart)
            felder.push('Objektart')
          }
          for (const z of KENNZAHLEN) setzeText(neu.kennzahlen, z.id, v[z.id], z.label)
          if (neu.kennzahlen.jahresnettokaltmiete == null && n(v.jahresnettokaltmiete)) {
            neu.kennzahlen.jahresnettokaltmiete = n(v.jahresnettokaltmiete)
            felder.push('Jahresnettokaltmiete')
          }
          if (neu.kennzahlen.kaufpreisvorstellung == null && n(v.kaufpreisvorstellung)) {
            neu.kennzahlen.kaufpreisvorstellung = n(v.kaufpreisvorstellung)
            felder.push('Kaufpreisvorstellung')
          }
          setzeText(neu.auftraggeber, 'name', v.auftraggeberName, 'Auftraggeber')
          setzeText(neu.auftraggeber, 'telefon', v.auftraggeberTelefon, 'Telefon')
          setzeText(neu.auftraggeber, 'email', v.auftraggeberEmail, 'E-Mail')
          setzeText(neu.auftraggeber, 'adresse', v.auftraggeberAdresse, 'Adresse des Auftraggebers')
          // Unterlagenstatus: Was in den Ordnern des Objekts liegt, gilt als vorhanden (geprüft setzt nur ein Mensch).
          for (const [unterlage, ordner] of Object.entries(UNTERLAGE_ORDNER)) {
            if ((objekt.dokumente[ordner]?.length ?? 0) > 0 && !neu.unterlagen[unterlage]?.vorhanden) {
              neu.unterlagen[unterlage] = { vorhanden: true, geprueft: neu.unterlagen[unterlage]?.geprueft ?? false }
              felder.push(`${unterlage} vorhanden`)
            }
          }
          return neu
        })
        setGespeichert(false)
      }
      setVorbefuellt({ felder, belege: String(v?.belege ?? ''), hinweise: [r.hinweis, v?.hinweise].filter(Boolean).join(' '), gelesen: r.gelesen, ausgelassen: r.ausgelassen })
    } catch (err) {
      setLeseFehler(err instanceof Error ? err.message : 'Die Unterlagen konnten nicht gelesen werden.')
    } finally {
      setLiest(false)
    }
  }

  function speichern() {
    const art = OBJEKTARTEN.find((a) => a.label === d.uebersicht.objektart)
    dispatch({
      type: 'UPDATE_OBJEKT',
      id: objekt.id,
      patch: {
        verkaufsdaten: d,
        // Was im Datenblatt steht, gilt auch für Liste, Filter und Abgleich mit den Gesuchen.
        ...(art ? { typ: art.typ } : {}),
        ...(preis && preis > 0 ? { kaufpreis: preis } : {}),
      },
    })
    setGespeichert(true)
  }

  function drucken() {
    const ja = (b: boolean) => (b ? '☒' : '☐')
    const abschnitte: DruckAbschnitt[] = [
      {
        titel: 'Auftraggeber / Eigentümer',
        zeilen: [
          ['Name', d.auftraggeber.name],
          ['Telefon', d.auftraggeber.telefon],
          ['E-Mail', d.auftraggeber.email],
          ['Adresse', d.auftraggeber.adresse],
          ['Internetseite', d.auftraggeber.webseite],
          ['Bonität', d.auftraggeber.bonitaet],
          ['Maklerauftrag', IMMO_AUFTRAGSARTEN.find((a) => a.id === d.auftragsart)?.label ?? '–'],
        ],
      },
      {
        titel: 'Objektübersicht',
        zeilen: [
          ['Objektbezeichnung', objekt.bezeichnung],
          ['Straße', d.uebersicht.strasse],
          ['PLZ / Ort', d.uebersicht.plzOrt],
          ['Flurstück / Gemarkung', [d.uebersicht.flurstueck, d.uebersicht.gemarkung].filter(Boolean).join(' / ')],
          ['Objektart', d.uebersicht.objektart],
        ],
      },
      {
        titel: 'Objekt-Kennzahlen',
        zeilen: [
          ...KENNZAHLEN.map((z): [string, string] => [z.label, k[z.id]]),
          ['Jahresnettokaltmiete', miete ? fmtEUR(miete) : ''],
          ['Kaufpreisvorstellung', preis ? fmtEUR(preis) : ''],
          ['Zielverkaufspreis', k.zielverkaufspreis ? fmtEUR(k.zielverkaufspreis) : ''],
        ],
      },
      {
        titel: 'Bewertung',
        zeilen: [
          ['Rendite', d.bewertung.rendite],
          ['Faktor', d.bewertung.faktor],
          ['Bewertungsverfahren', d.bewertung.verfahren.join(', ')],
          ['Unser ermittelter Marktwert', d.bewertung.marktwert ? fmtEUR(d.bewertung.marktwert) : ''],
        ],
      },
      { titel: 'Verkaufsstatus', zeilen: [['Stand', VERKAUFSSTATUS.map((s) => `${ja(d.verkaufsstatus.includes(s))} ${s}`).join('   ')], ['Anmerkung', d.verkaufsstatusNotiz]] },
      {
        titel: 'Unterlagenstatus (vorhanden / geprüft)',
        zeilen: UNTERLAGEN.map((u): [string, string] => [u, `${ja(!!d.unterlagen[u]?.vorhanden)} vorhanden   ${ja(!!d.unterlagen[u]?.geprueft)} geprüft`]),
      },
      { titel: 'Sonstiges', zeilen: [['', d.sonstiges]] },
    ]
    druckeBlatt(`Verkaufsdaten – ${objekt.bezeichnung}`, `Datum ${d.datum ? fmtDate(d.datum) : '–'} · Prio ${d.prio ?? '–'}`, abschnitte)
  }

  const eingabe = (wert: string, onChange: (v: string) => void, platz?: string) => <input className={inputClass} value={wert} placeholder={platz} onChange={(e) => onChange(e.target.value)} />
  const betrag = (wert: number | undefined, onChange: (v: number | undefined) => void) => (
    <input className={inputClass} inputMode="numeric" value={wert != null ? String(wert) : ''} placeholder="€" onChange={(e) => onChange(zahl(e.target.value))} />
  )
  const pille = (an: boolean) => `rounded-full border px-3 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Verkaufsdaten – {objekt.bezeichnung}</h3>
            <p className="text-xs text-slate-400">Die Zusammenfassung des Objekts auf einer Seite.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
              Datum
              <input type="date" className={`${inputClass} w-auto`} value={d.datum ?? ''} onChange={(e) => setze({ datum: e.target.value || undefined })} />
            </label>
            <div className="flex items-center gap-1" role="group" aria-label="Priorität">
              <span className="mr-1 text-xs font-medium text-slate-500">Prio</span>
              {(['A', 'B', 'C'] as const).map((p) => (
                <button key={p} type="button" onClick={() => setze({ prio: d.prio === p ? undefined : p })} aria-pressed={d.prio === p} className={`h-8 w-8 rounded-lg border text-sm font-semibold ${d.prio === p ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isEmailGatewayConfigured && (
          <div className="mb-4 rounded-lg border border-accent-100 bg-accent-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-700">
                <strong>Aus den Unterlagen vorbefüllen:</strong> Die KI liest Exposé, Gutachten und weitere Dateien dieses Objekts und trägt ein, was dort steht. Nur leere Felder werden gefüllt.
              </p>
              <SecondaryButton onClick={vorbefuellen} disabled={liest}>
                <Sparkles size={14} className={liest ? 'animate-pulse' : ''} /> {liest ? 'Liest die Unterlagen … (bis zu 2 Minuten)' : 'Vorbefüllen'}
              </SecondaryButton>
            </div>
            {leseFehler && <p className="mt-2 text-sm text-rose-600">{leseFehler}</p>}
            {vorbefuellt && (
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                <p className="font-medium text-slate-700">
                  {vorbefuellt.felder.length > 0 ? `Eingetragen (bitte prüfen, dann speichern): ${vorbefuellt.felder.join(', ')}.` : 'In den gelesenen Unterlagen stand nichts, was nicht schon eingetragen ist.'}
                </p>
                {vorbefuellt.belege && <p className="whitespace-pre-wrap">Woher: {vorbefuellt.belege}</p>}
                {vorbefuellt.hinweise && <p className="whitespace-pre-wrap text-amber-700">Hinweise: {vorbefuellt.hinweise}</p>}
                {vorbefuellt.gelesen.length > 0 && <p>Gelesen: {vorbefuellt.gelesen.join(', ')}.</p>}
                {vorbefuellt.ausgelassen.length > 0 && <p className="text-slate-400">Nicht gelesen: {vorbefuellt.ausgelassen.slice(0, 8).join(', ')}{vorbefuellt.ausgelassen.length > 8 ? ` und ${vorbefuellt.ausgelassen.length - 8} weitere` : ''}.</p>}
              </div>
            )}
          </div>
        )}

        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Auftraggeber / Eigentümer</h4>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name">{eingabe(d.auftraggeber.name, (v) => setze({ auftraggeber: { ...d.auftraggeber, name: v } }))}</Field>
          <Field label="Telefon">{eingabe(d.auftraggeber.telefon, (v) => setze({ auftraggeber: { ...d.auftraggeber, telefon: v } }))}</Field>
          <Field label="E-Mail">{eingabe(d.auftraggeber.email, (v) => setze({ auftraggeber: { ...d.auftraggeber, email: v } }))}</Field>
          <Field label="Adresse">{eingabe(d.auftraggeber.adresse, (v) => setze({ auftraggeber: { ...d.auftraggeber, adresse: v } }))}</Field>
          <Field label="Internetseite">{eingabe(d.auftraggeber.webseite, (v) => setze({ auftraggeber: { ...d.auftraggeber, webseite: v } }))}</Field>
          <Field label="Bonität">{eingabe(d.auftraggeber.bonitaet, (v) => setze({ auftraggeber: { ...d.auftraggeber, bonitaet: v } }))}</Field>
        </div>
        <Field label="Maklerauftrag">
          <select className={`${inputClass} sm:w-80`} value={d.auftragsart ?? ''} onChange={(e) => setze({ auftragsart: (e.target.value || undefined) as ImmoAuftragsart | undefined })}>
            <option value="">noch kein Auftrag</option>
            {IMMO_AUFTRAGSARTEN.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Objektübersicht</h4>
          <Field label="Straße">{eingabe(d.uebersicht.strasse, (v) => setze({ uebersicht: { ...d.uebersicht, strasse: v } }))}</Field>
          <Field label="PLZ / Ort">{eingabe(d.uebersicht.plzOrt, (v) => setze({ uebersicht: { ...d.uebersicht, plzOrt: v } }))}</Field>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Flurstück">{eingabe(d.uebersicht.flurstueck, (v) => setze({ uebersicht: { ...d.uebersicht, flurstueck: v } }))}</Field>
            <Field label="Gemarkung">{eingabe(d.uebersicht.gemarkung, (v) => setze({ uebersicht: { ...d.uebersicht, gemarkung: v } }))}</Field>
          </div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Objektart</span>
          <div className="flex flex-wrap gap-2">
            {OBJEKTARTEN.map((a) => (
              <button key={a.label} type="button" aria-pressed={d.uebersicht.objektart === a.label} onClick={() => setze({ uebersicht: { ...d.uebersicht, objektart: d.uebersicht.objektart === a.label ? '' : a.label } })} className={pille(d.uebersicht.objektart === a.label)}>
                {a.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Objekt-Kennzahlen</h4>
          <div className="grid grid-cols-2 gap-x-3">
            {KENNZAHLEN.map((z) => (
              <Field key={z.id} label={z.label}>
                {eingabe(k[z.id], (v) => setze({ kennzahlen: { ...k, [z.id]: v } }), z.platz)}
              </Field>
            ))}
            <Field label="Jahresnettokaltmiete">{betrag(miete, (v) => setze({ kennzahlen: { ...k, jahresnettokaltmiete: v } }))}</Field>
            <Field label="Kaufpreisvorstellung">{betrag(preis, (v) => setze({ kennzahlen: { ...k, kaufpreisvorstellung: v } }))}</Field>
            <Field label="Zielverkaufspreis">{betrag(k.zielverkaufspreis, (v) => setze({ kennzahlen: { ...k, zielverkaufspreis: v } }))}</Field>
          </div>
        </Card>

        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Bewertung</h4>
          <div className="grid grid-cols-2 gap-x-3">
            <Field label="Rendite">{eingabe(d.bewertung.rendite, (v) => setze({ bewertung: { ...d.bewertung, rendite: v } }), 'z. B. 5,2 %')}</Field>
            <Field label="Faktor">{eingabe(d.bewertung.faktor, (v) => setze({ bewertung: { ...d.bewertung, faktor: v } }), 'z. B. 19')}</Field>
          </div>
          {rechnerisch && <p className="-mt-1 mb-3 text-xs text-slate-400">{rechnerisch}</p>}
          <span className="mb-1 block text-xs font-medium text-slate-500">Bewertungsverfahren</span>
          <div className="mb-3 flex flex-wrap gap-2">
            {VERFAHREN.map((v) => (
              <button key={v} type="button" aria-pressed={d.bewertung.verfahren.includes(v)} onClick={() => setze({ bewertung: { ...d.bewertung, verfahren: schalte(d.bewertung.verfahren, v) } })} className={pille(d.bewertung.verfahren.includes(v))}>
                {v}
              </button>
            ))}
          </div>
          <Field label="Unser ermittelter Marktwert">{betrag(d.bewertung.marktwert, (v) => setze({ bewertung: { ...d.bewertung, marktwert: v } }))}</Field>

          <h4 className="mb-2 mt-2 text-sm font-semibold text-slate-700">Verkaufsstatus</h4>
          <div className="mb-3 flex flex-wrap gap-2">
            {VERKAUFSSTATUS.map((s) => (
              <button key={s} type="button" aria-pressed={d.verkaufsstatus.includes(s)} onClick={() => setze({ verkaufsstatus: schalte(d.verkaufsstatus, s) })} className={pille(d.verkaufsstatus.includes(s))}>
                {s}
              </button>
            ))}
          </div>
          <Field label="Anmerkung zum Stand">{eingabe(d.verkaufsstatusNotiz, (v) => setze({ verkaufsstatusNotiz: v }))}</Field>
        </Card>

        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Unterlagenstatus</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-slate-400">
                <th className="pb-1.5">Dokument</th>
                <th className="pb-1.5 text-center">vorhanden</th>
                <th className="pb-1.5 text-center">geprüft</th>
              </tr>
            </thead>
            <tbody>
              {UNTERLAGEN.map((u) => {
                const stand = d.unterlagen[u] ?? { vorhanden: false, geprueft: false }
                return (
                  <tr key={u} className="border-t border-slate-50">
                    <td className="py-1.5 text-slate-700">{u}</td>
                    <td className="py-1.5 text-center">
                      <input type="checkbox" className="rounded" checked={stand.vorhanden} aria-label={`${u} vorhanden`} onChange={(e) => setze({ unterlagen: { ...d.unterlagen, [u]: { ...stand, vorhanden: e.target.checked } } })} />
                    </td>
                    <td className="py-1.5 text-center">
                      <input type="checkbox" className="rounded" checked={stand.geprueft} aria-label={`${u} geprüft`} onChange={(e) => setze({ unterlagen: { ...d.unterlagen, [u]: { ...stand, geprueft: e.target.checked } } })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-5">
        <Field label="Sonstiges">
          <textarea className={`${inputClass} min-h-24`} value={d.sonstiges} onChange={(e) => setze({ sonstiges: e.target.value })} />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {gespeichert && !geaendert && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={13} /> Gespeichert
            </span>
          )}
          <SecondaryButton onClick={drucken}>
            <Printer size={14} /> Drucken
          </SecondaryButton>
          <PrimaryButton onClick={speichern} disabled={!geaendert}>
            Verkaufsdatenblatt speichern
          </PrimaryButton>
        </div>
      </Card>
    </div>
  )
}
