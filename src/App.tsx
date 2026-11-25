import { type ReactNode } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import { Fehlergrenze } from './components/Fehlergrenze'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PortalAuthProvider, usePortalAuth } from './context/PortalAuthContext'
import { RollenAuswahl } from './pages/auth/RollenAuswahl'
import { LoginScreen } from './pages/auth/LoginScreen'
import { PasswortFestlegen } from './pages/auth/PasswortFestlegen'
import { isSupabaseConfigured } from './lib/supabaseClient'
import { darfBereich, istFuerAlleSichtbar } from './lib/bereichsRechte'
import { Layout } from './components/Layout'
import { PortalLayout } from './components/PortalLayout'
import { KundenListe } from './pages/beratung/KundenListe'
import { KundenDetail } from './pages/beratung/KundenDetail'
import { VorlagenPage } from './pages/beratung/VorlagenPage'
import { Mahnwesen } from './pages/beratung/Mahnwesen'
import { Rechnungen } from './pages/beratung/Rechnungen'
import { Verbindlichkeiten } from './pages/beratung/Verbindlichkeiten'
import { Leistungen } from './pages/beratung/Leistungen'
import { ObjektListe } from './pages/immobilien/ObjektListe'
import { ObjektDetail } from './pages/immobilien/ObjektDetail'
import { ImmobilienKundenListe } from './pages/immobilien/ImmobilienKundenListe'
import { ImmobilienKundenDetail } from './pages/immobilien/ImmobilienKundenDetail'
import { Gesuche } from './pages/immobilien/Gesuche'
import { FragenAnGF } from './pages/immobilien/FragenAnGF'
import { Zeiterfassung } from './pages/immobilien/Zeiterfassung'
import { TagesablaufSeite } from './pages/immobilien/Tagesablauf'
import { Weitergaben } from './pages/immobilien/Weitergaben'
import { AutoNachrichten } from './pages/immobilien/AutoNachrichten'
import { Finanzierungen } from './pages/immobilien/Finanzierungen'
import { VorlagenPageImmobilien } from './pages/immobilien/VorlagenPageImmobilien'
import { ErbenListe } from './pages/erben/ErbenListe'
import { ErbenDetail } from './pages/erben/ErbenDetail'
import { VorlagenPageErben } from './pages/erben/VorlagenPageErben'
import { BetriebsuebergabeListe } from './pages/betriebsuebergabe/BetriebsuebergabeListe'
import { BetriebsuebergabeDetail } from './pages/betriebsuebergabe/BetriebsuebergabeDetail'
import { VorlagenPageBetriebsuebergabe } from './pages/betriebsuebergabe/VorlagenPageBetriebsuebergabe'
import { BetriebsformenListe } from './pages/betriebsformen/BetriebsformenListe'
import { BetriebsformenDetail } from './pages/betriebsformen/BetriebsformenDetail'
import { VorlagenPageBetriebsformen } from './pages/betriebsformen/VorlagenPageBetriebsformen'
import { AkademieListe } from './pages/akademie/AkademieListe'
import { AkademieDetail } from './pages/akademie/AkademieDetail'
import { VorlagenPageAkademie } from './pages/akademie/VorlagenPageAkademie'
import { FinanzierungenListe } from './pages/finanzierungen/FinanzierungenListe'
import { FinanzierungenDetail } from './pages/finanzierungen/FinanzierungenDetail'
import { VorlagenPageFinanzierungen } from './pages/finanzierungen/VorlagenPageFinanzierungen'
import { PrivatListe } from './pages/privat/PrivatListe'
import { PrivatDetail } from './pages/privat/PrivatDetail'
import { PrivatPostfach } from './pages/privat/PrivatPostfach'
import { PrivatEinstellungen } from './pages/privat/PrivatEinstellungen'
import { PrivatBrief } from './pages/privat/PrivatBrief'
import { PrivatHotmail } from './pages/privat/PrivatHotmail'
import { PrivatBestaetigen } from './pages/privat/PrivatBestaetigen'
import { PrivatSystemcheck } from './pages/privat/PrivatSystemcheck'
import { PrivatArtListe } from './pages/privat/PrivatArtListe'
import { PrivatVorlagen } from './pages/privat/PrivatVorlagen'
import { PrivatGesuche, PrivatImmoKundeDetail, PrivatImmoKundenListe, PrivatObjektDetail, PrivatObjektListe } from './pages/privat/immobilien'
import { Kalender } from './pages/kalender/Kalender'
import { Auswertungen } from './pages/auswertungen/Auswertungen'
import { Umsatzvorschau } from './pages/auswertungen/Umsatzvorschau'
import { Umsatzziele } from './pages/ziele/Umsatzziele'
import { PartnerSeite } from './pages/partner/Partner'
import { PostfachEinrichtenHinweis } from './components/PostfachEinstellungen'
import { ToDoListe, BereichToDoListe } from './pages/todo/ToDoListe'
import { HeuteScreen } from './pages/heute/HeuteScreen'
import { ErinnerungenSeite } from './components/MeineErinnerungen'
import { Postfach } from './pages/postfach/Postfach'
import { UngeklaerteEingaenge } from './pages/eingang/UngeklaerteEingaenge'
import { Ablegen } from './pages/ablegen/Ablegen'
import { Kampagnen } from './pages/kampagnen/Kampagnen'
import { MeinProfil } from './pages/profil/MeinProfil'
import { MitarbeiterVerwalten } from './pages/admin/MitarbeiterVerwalten'
import { Wuensche } from './pages/admin/Wuensche'
import { Neuigkeiten } from './pages/neuigkeiten/Neuigkeiten'
import { Dubletten } from './pages/admin/Dubletten'
import { NeuanfragenSichten } from './pages/neuanfragen/Sichten'
import { AufgabenUebersicht } from './pages/aufgaben/AufgabenUebersicht'
import { EntgangeneKlienten } from './pages/entgangen/EntgangeneKlienten'
import { Kostenvoranschlaege } from './pages/kostenvoranschlaege/Kostenvoranschlaege'
import { Checkliste } from './pages/checkliste/Checkliste'
import { Wochenbesprechung } from './pages/besprechung/Wochenbesprechung'
import { Seminare } from './pages/akademie/Seminare'
import { SeminarTermin } from './pages/akademie/SeminarTermin'
import { BuecherListe } from './pages/buecher/BuecherListe'
import { BuchDetail } from './pages/buecher/BuchDetail'
import { BuchKontakte } from './pages/buecher/BuchKontakte'
import { SuperuserSeite } from './pages/superuser/SuperuserSeite'
import { AutomatischeNachrichten } from './pages/automatik/AutomatischeNachrichten'
import { ProjekteListe } from './pages/projekte/ProjekteListe'
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalMagicLink } from './pages/portal/PortalMagicLink'
import { PortalOverview } from './pages/portal/PortalOverview'
import { PortalRendite } from './pages/portal/PortalRendite'
import { PortalAuszahlungen } from './pages/portal/PortalAuszahlungen'
import { PortalDokumente } from './pages/portal/PortalDokumente'
import { PublicFeedbackbogen } from './pages/formulare/PublicFeedbackbogen'
import { PublicVollmachtErben } from './pages/formulare/PublicVollmachtErben'
import { PublicExpose } from './pages/formulare/PublicExpose'
import { PublicObjektPortal } from './pages/formulare/PublicObjektPortal'
import { PublicSeminarAnmeldung } from './pages/formulare/PublicSeminarAnmeldung'
import { PublicUnterschrift } from './pages/formulare/PublicUnterschrift'
import { PublicMandantenfragebogenErben } from './pages/formulare/PublicMandantenfragebogenErben'
import { PublicVollmachtBeratung } from './pages/formulare/PublicVollmachtBeratung'
import { PublicSelbstauskunft } from './pages/formulare/PublicSelbstauskunft'
import { PublicEigentuemerPortal } from './pages/formulare/PublicEigentuemerPortal'
import { PublicTerminBuchen } from './pages/formulare/PublicTerminBuchen'
import { PublicNda } from './pages/formulare/PublicNda'
import { PublicKundenUnterlagen } from './pages/formulare/PublicKundenUnterlagen'
import { PublicKundenPortal } from './pages/formulare/PublicKundenPortal'
import { PublicDatenschutz } from './pages/formulare/PublicDatenschutz'
import type { Bereich } from './types'

function RootRedirect() {
  return <Navigate to="/heute" replace />
}

function AdminRoutesContent() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/heute" element={<HeuteScreen />} />
        <Route path="/erinnerungen" element={<ErinnerungenSeite />} />
        <Route path="/postfach" element={<Postfach />} />
        <Route path="/eingaenge" element={<UngeklaerteEingaenge />} />
        <Route path="/ablegen" element={<Ablegen />} />
        <Route path="/kalender" element={<Kalender />} />
        <Route path="/aufgaben" element={<AufgabenUebersicht />} />
        <Route path="/entgangen" element={<EntgangeneKlienten />} />
        <Route path="/superuser" element={<SuperuserSeite />} />
        <Route path="/automatische-nachrichten" element={<AutomatischeNachrichten />} />
        {/* Für alle: Was jemand sieht, begrenzt die Datenbank (Bereichsrechte) schon im App-Zustand. */}
        <Route path="/auswertungen" element={<Auswertungen />} />
        <Route path="/auswertungen/umsatz" element={<Umsatzvorschau />} />
        {/* Für alle: Umsatzziele (Summen ohne Namen, rechnet der Server — email-gateway/umsatzZiel.ts). */}
        <Route path="/ziele" element={<Umsatzziele />} />
        {/* Für alle: Partner sieht jeder aktive Mitarbeiter, Zuordnungen nur mit Rechten an Akte/Objekt (Datenbank). */}
        <Route path="/partner" element={<PartnerSeite />} />
        {/* Für alle: Sichtbarkeit regelt die Datenbank (Bereichsrechte, private Einträge nur für den Besitzer). */}
        <Route path="/kostenvoranschlaege" element={<Kostenvoranschlaege />} />
        <Route path="/checkliste" element={<Checkliste />} />
        <Route path="/besprechung" element={<Wochenbesprechung />} />
        <Route path="/kampagnen" element={<Kampagnen />} />
        <Route path="/profil" element={<MeinProfil />} />
        <Route path="/mitarbeiter" element={<RequireAdmin><MitarbeiterVerwalten /></RequireAdmin>} />
        <Route path="/wuensche" element={<Wuensche />} />
        <Route path="/neuigkeiten" element={<Neuigkeiten />} />
        <Route path="/dubletten" element={<Dubletten />} />
        <Route path="/neuanfragen" element={<NeuanfragenSichten />} />

        {/* Privat: bewusst NICHT per RequireBereich beschränkt — jeder Mitarbeiter hat seinen
            eigenen, persönlichen Bereich, das ist keine von der GF zuteilbare Berechtigung.
            Sichtbarkeit wird stattdessen über RLS in Supabase erzwungen (siehe crmSync.ts). */}
        <Route path="/privat" element={<PrivatListe />} />
        <Route path="/privat/kontakte/:id" element={<PrivatDetail />} />
        <Route path="/privat/postfach" element={<PrivatPostfach />} />
        <Route path="/privat/einstellungen" element={<PrivatEinstellungen />} />
        <Route path="/privat/brief" element={<PrivatBrief />} />
        <Route path="/privat/hotmail" element={<PrivatHotmail />} />
        <Route path="/privat/bestaetigen" element={<PrivatBestaetigen />} />
        <Route path="/privat/systemcheck" element={<PrivatSystemcheck />} />
        <Route path="/privat/art/:art" element={<PrivatArtListe />} />
        <Route path="/privat/art/:art/:id" element={<PrivatDetail />} />
        <Route path="/privat/projekte" element={<ProjekteListe />} />
        <Route path="/privat/kostenvoranschlaege" element={<Kostenvoranschlaege key="privat" privat />} />
        <Route path="/privat/immobilien" element={<PrivatObjektListe />} />
        <Route path="/privat/immobilien/objekte/:id" element={<PrivatObjektDetail />} />
        <Route path="/privat/immobilien/kunden" element={<PrivatImmoKundenListe />} />
        <Route path="/privat/immobilien/kunden/:id" element={<PrivatImmoKundeDetail />} />
        <Route path="/privat/immobilien/gesuche" element={<PrivatGesuche />} />
        <Route path="/privat/vorlagen/:art/:kind" element={<PrivatVorlagen />} />
        <Route path="/privat/vorlagen/:art" element={<PrivatVorlagen />} />
        <Route path="/privat/offen" element={<PrivatHotmail key="offen" start="offen" />} />
        <Route path="/privat/kalender" element={<Kalender privat />} />
        <Route path="/privat/todo" element={<ToDoListe />} />

        <Route path="/beratung" element={<RequireBereich bereich="beratung"><KundenListe /></RequireBereich>} />
        <Route path="/beratung/kunden/:id" element={<RequireBereich bereich="beratung" sammelakteErlaubt><KundenDetail /></RequireBereich>} />
        <Route path="/beratung/vorlagen/:kind" element={<RequireBereich bereich="beratung"><VorlagenPage /></RequireBereich>} />
        <Route path="/beratung/mahnwesen" element={<RequireBereich bereich="beratung"><Mahnwesen /></RequireBereich>} />
        <Route path="/beratung/rechnungen" element={<RequireBereich bereich="beratung"><Rechnungen /></RequireBereich>} />
        <Route path="/beratung/verbindlichkeiten" element={<RequireBereich bereich="beratung"><Verbindlichkeiten /></RequireBereich>} />
        <Route path="/beratung/leistungen" element={<RequireBereich bereich="beratung"><Leistungen /></RequireBereich>} />
        <Route path="/beratung/projekte" element={<RequireBereich bereich="beratung"><ProjekteListe /></RequireBereich>} />
        <Route path="/beratung/todo" element={<RequireBereich bereich="beratung"><BereichToDoListe bereich="beratung" label="Unternehmensberatung" /></RequireBereich>} />

        <Route path="/immobilien" element={<RequireBereich bereich="immobilien"><ObjektListe /></RequireBereich>} />
        <Route path="/immobilien/objekte/:id" element={<RequireBereich bereich="immobilien"><ObjektDetail /></RequireBereich>} />
        <Route path="/immobilien/kunden" element={<RequireBereich bereich="immobilien"><ImmobilienKundenListe /></RequireBereich>} />
        <Route path="/immobilien/kunden/:id" element={<RequireBereich bereich="immobilien"><ImmobilienKundenDetail /></RequireBereich>} />
        <Route path="/immobilien/gesuche" element={<RequireBereich bereich="immobilien"><Gesuche /></RequireBereich>} />
        <Route path="/immobilien/fragen" element={<RequireBereich bereich="immobilien"><FragenAnGF /></RequireBereich>} />
        <Route path="/immobilien/zeiterfassung" element={<RequireBereich bereich="immobilien"><Zeiterfassung /></RequireBereich>} />
        <Route path="/immobilien/tagesablauf" element={<RequireBereich bereich="immobilien"><TagesablaufSeite /></RequireBereich>} />
        <Route path="/immobilien/weitergaben" element={<RequireBereich bereich="immobilien"><Weitergaben /></RequireBereich>} />
        <Route path="/immobilien/automatische-nachrichten" element={<RequireBereich bereich="immobilien"><AutoNachrichten /></RequireBereich>} />
        <Route path="/immobilien/finanzierungen" element={<RequireBereich bereich="immobilien"><Finanzierungen /></RequireBereich>} />
        <Route path="/immobilien/vorlagen/:kind" element={<RequireBereich bereich="immobilien"><VorlagenPageImmobilien /></RequireBereich>} />
        <Route path="/immobilien/projekte" element={<RequireBereich bereich="immobilien"><ProjekteListe /></RequireBereich>} />
        <Route path="/immobilien/todo" element={<RequireBereich bereich="immobilien"><BereichToDoListe bereich="immobilien" label="Immobilien" /></RequireBereich>} />

        <Route path="/erben" element={<RequireBereich bereich="erben"><ErbenListe /></RequireBereich>} />
        <Route path="/erben/mandanten/:id" element={<RequireBereich bereich="erben"><ErbenDetail /></RequireBereich>} />
        <Route path="/erben/vorlagen/:kind" element={<RequireBereich bereich="erben"><VorlagenPageErben /></RequireBereich>} />
        <Route path="/erben/projekte" element={<RequireBereich bereich="erben"><ProjekteListe /></RequireBereich>} />
        <Route path="/erben/todo" element={<RequireBereich bereich="erben"><BereichToDoListe bereich="erben" label="Erben" /></RequireBereich>} />

        <Route path="/betriebsuebergabe" element={<RequireBereich bereich="betriebsuebergabe"><BetriebsuebergabeListe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/mandanten/:id" element={<RequireBereich bereich="betriebsuebergabe"><BetriebsuebergabeDetail /></RequireBereich>} />
        <Route path="/betriebsuebergabe/vorlagen/:kind" element={<RequireBereich bereich="betriebsuebergabe"><VorlagenPageBetriebsuebergabe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/projekte" element={<RequireBereich bereich="betriebsuebergabe"><ProjekteListe /></RequireBereich>} />
        <Route path="/betriebsuebergabe/todo" element={<RequireBereich bereich="betriebsuebergabe"><BereichToDoListe bereich="betriebsuebergabe" label="Betriebsübergabe" /></RequireBereich>} />

        <Route path="/betriebsformen" element={<RequireBereich bereich="betriebsformen"><BetriebsformenListe /></RequireBereich>} />
        <Route path="/betriebsformen/mandanten/:id" element={<RequireBereich bereich="betriebsformen"><BetriebsformenDetail /></RequireBereich>} />
        <Route path="/betriebsformen/vorlagen/:kind" element={<RequireBereich bereich="betriebsformen"><VorlagenPageBetriebsformen /></RequireBereich>} />
        <Route path="/betriebsformen/projekte" element={<RequireBereich bereich="betriebsformen"><ProjekteListe /></RequireBereich>} />
        <Route path="/betriebsformen/todo" element={<RequireBereich bereich="betriebsformen"><BereichToDoListe bereich="betriebsformen" label="Betriebsformen" /></RequireBereich>} />

        <Route path="/akademie" element={<RequireBereich bereich="akademie"><AkademieListe /></RequireBereich>} />
        <Route path="/akademie/teilnehmer/:id" element={<RequireBereich bereich="akademie"><AkademieDetail /></RequireBereich>} />
        <Route path="/akademie/vorlagen/:kind" element={<RequireBereich bereich="akademie"><VorlagenPageAkademie /></RequireBereich>} />
        <Route path="/akademie/projekte" element={<RequireBereich bereich="akademie"><ProjekteListe /></RequireBereich>} />
        <Route path="/akademie/seminare" element={<RequireBereich bereich="akademie"><Seminare /></RequireBereich>} />
        <Route path="/akademie/termine/:id" element={<RequireBereich bereich="akademie"><SeminarTermin /></RequireBereich>} />
        <Route path="/akademie/todo" element={<RequireBereich bereich="akademie"><BereichToDoListe bereich="akademie" label="Akademie" /></RequireBereich>} />

        <Route path="/finanzierungen" element={<RequireBereich bereich="finanzierungen"><FinanzierungenListe /></RequireBereich>} />
        <Route path="/finanzierungen/mandanten/:id" element={<RequireBereich bereich="finanzierungen"><FinanzierungenDetail /></RequireBereich>} />
        <Route path="/finanzierungen/vorlagen/:kind" element={<RequireBereich bereich="finanzierungen"><VorlagenPageFinanzierungen /></RequireBereich>} />
        <Route path="/finanzierungen/projekte" element={<RequireBereich bereich="finanzierungen"><ProjekteListe /></RequireBereich>} />
        <Route path="/finanzierungen/todo" element={<RequireBereich bereich="finanzierungen"><BereichToDoListe bereich="finanzierungen" label="Finanzierungen" /></RequireBereich>} />

        {/* Bücher & Verlag (21.11.2026) */}
        <Route path="/buecher" element={<RequireBereich bereich="buecher"><BuecherListe /></RequireBereich>} />
        <Route path="/buecher/kontakte" element={<RequireBereich bereich="buecher"><BuchKontakte /></RequireBereich>} />
        <Route path="/buecher/todo" element={<RequireBereich bereich="buecher"><BereichToDoListe bereich="buecher" label="Bücher & Verlag" /></RequireBereich>} />
        <Route path="/buecher/:id" element={<RequireBereich bereich="buecher"><BuchDetail /></RequireBereich>} />

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Layout>
  )
}

function LadeBildschirm({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
      {text}
    </div>
  )
}

function ZugangGesperrt({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-slate-800">Zugang noch nicht freigeschaltet</h1>
        <p className="mb-4 text-sm text-slate-500">
          {email} ist angemeldet, aber (noch) nicht als aktiver Mitarbeiter hinterlegt. Bitte bei der Geschäftsführung melden.
        </p>
        <button onClick={onSignOut} className="text-sm font-medium text-accent-600 hover:underline">
          Abmelden
        </button>
      </div>
    </div>
  )
}

// Echter Mitarbeiter-Login, sobald Supabase konfiguriert ist (siehe lib/supabaseClient.ts) — ohne
// Konfiguration (z.B. lokale Entwicklung ohne .env.local) bleibt der bisherige reine Rollenpicker
// als Demo-Modus aktiv, damit lokales Arbeiten ohne echte Zugangsdaten weiter funktioniert.
function AdminRoutes() {
  const { state, hydrated, hydrateError } = useApp()
  const { ready, session, mitarbeiter, passwortFestlegen, signOut } = useAuth()

  if (!isSupabaseConfigured) {
    if (!state.rolle) return <RollenAuswahl />
    return <AdminRoutesContent />
  }

  if (!ready) return <LadeBildschirm text="Lädt …" />
  if (!session) return <LoginScreen />
  if (!mitarbeiter || !mitarbeiter.aktiv) return <ZugangGesperrt email={session.user.email ?? ''} onSignOut={signOut} />
  if (passwortFestlegen) return <PasswortFestlegen />
  if (!hydrated) return <LadeBildschirm text="Daten werden geladen …" />
  if (hydrateError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">
          Daten konnten nicht geladen werden: {hydrateError}
        </div>
      </div>
    )
  }
  return (
    <>
      <AdminRoutesContent />
      <PostfachEinrichtenHinweis />
    </>
  )
}

// Setzt mitarbeiter.bereiche/ist_admin tatsächlich am Routing durch (Beschluss 2026-11-02) — bis
// dahin sah ein eingeloggter Mitarbeiter trotz gesetzter Felder jeden Bereich. Im Demo-Modus (ohne
// Supabase) gibt es keine Mitarbeiter-Zugriffssteuerung, also ungefiltert durchlassen.
// Seit 18.11.2026 setzt auch die Datenbank dieselbe Regel durch (darf_bereich); diese Prüfung hier
// verhindert nur, dass jemand eine leere Seite sieht. Die beiden Sammelakten ("Ungeklärte Eingänge",
// interne Akte) liegen unter /beratung/kunden/…, sind aber für jeden aktiven Mitarbeiter da.
function RequireBereich({ bereich, sammelakteErlaubt, children }: { bereich: Bereich; sammelakteErlaubt?: boolean; children: ReactNode }) {
  const { mitarbeiter } = useAuth()
  const { id } = useParams()
  if (!isSupabaseConfigured) return <>{children}</>
  const erlaubt = darfBereich(mitarbeiter, bereich) || (!!sammelakteErlaubt && istFuerAlleSichtbar(id))
  if (!erlaubt) return <Navigate to="/heute" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { mitarbeiter } = useAuth()
  if (!isSupabaseConfigured) return <>{children}</>
  const erlaubt = !mitarbeiter || mitarbeiter.rolle === 'geschaeftsfuehrung' || mitarbeiter.ist_admin
  if (!erlaubt) return <Navigate to="/heute" replace />
  return <>{children}</>
}

function RequirePortalAuth({ children }: { children: ReactNode }) {
  const { ready, investor } = usePortalAuth()
  if (!ready) return <LadeBildschirm text="Lädt …" />
  if (!investor) return <Navigate to="/portal/login" replace />
  return <>{children}</>
}

function PortalRoutes() {
  return (
    <Routes>
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route path="/portal/magic/:token" element={<PortalMagicLink />} />
      <Route
        path="/portal"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalOverview />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/rendite"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalRendite />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/auszahlungen"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalAuszahlungen />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
      <Route
        path="/portal/dokumente"
        element={
          <RequirePortalAuth>
            <PortalLayout>
              <PortalDokumente />
            </PortalLayout>
          </RequirePortalAuth>
        }
      />
    </Routes>
  )
}

function AppRoutes() {
  const location = useLocation()
  // Datenschutzhinweise (seit 19.11.2026): öffentlich, ohne Anmeldung, verlinkt aus allen Formularen.
  if (location.pathname === '/datenschutz') {
    return (
      <Routes>
        <Route path="/datenschutz" element={<PublicDatenschutz />} />
      </Routes>
    )
  }
  // Öffentliche, ausfüllbare Formulare: brauchen weder Rollenwahl noch Portal-Login — genau
  // der Link, den man z.B. nach einem Vortrag an Interessenten verschickt.
  if (location.pathname.startsWith('/formular/')) {
    return (
      <Routes>
        <Route path="/formular/feedbackbogen" element={<PublicFeedbackbogen />} />
        <Route path="/formular/vollmacht/erben/:mandantId" element={<PublicVollmachtErben />} />
        <Route path="/formular/expose/:vorschlagId" element={<PublicExpose />} />
        <Route path="/formular/objekt/:token" element={<PublicObjektPortal />} />
        <Route path="/formular/seminar/:terminId" element={<PublicSeminarAnmeldung />} />
        <Route path="/formular/unterschrift/:token" element={<PublicUnterschrift />} />
        <Route path="/formular/mandantenfragebogen/erben/:mandantId" element={<PublicMandantenfragebogenErben />} />
        <Route path="/formular/vollmacht/beratung/:typ/:kundeId" element={<PublicVollmachtBeratung />} />
        <Route path="/formular/vollmacht/privat/:mandantId" element={<PublicVollmachtErben bereich="privat" />} />
        <Route path="/formular/mandantenfragebogen/privat/:mandantId" element={<PublicMandantenfragebogenErben bereich="privat" />} />
        <Route path="/formular/vollmacht/privat/:typ/:kundeId" element={<PublicVollmachtBeratung bereich="privat" />} />
        <Route path="/formular/selbstauskunft/:bereich/:kundeId" element={<PublicSelbstauskunft />} />
        {/* Mit geheimem Zeichen (seit 19.11.2026). Alte Links ohne Zeichen landen auf derselben Seite und
            bekommen dort den Hinweis, dass der Link abgelaufen ist. */}
        <Route path="/formular/eigentuemer/:objektId/:token" element={<PublicEigentuemerPortal />} />
        <Route path="/formular/eigentuemer/:objektId" element={<PublicEigentuemerPortal />} />
        <Route path="/formular/termin/:kennung" element={<PublicTerminBuchen />} />
        <Route path="/formular/nda/:bereich/:kundeId" element={<PublicNda />} />
        <Route path="/formular/unterlagen/:token" element={<PublicKundenUnterlagen />} />
        <Route path="/formular/kunde/:token" element={<PublicKundenPortal />} />
      </Routes>
    )
  }
  const isPortal = location.pathname.startsWith('/portal')
  return isPortal ? <PortalRoutes /> : <AdminRoutes />
}

function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <PortalAuthProvider>
          <HashRouter>
            <Fehlergrenze name="Ganzes CRM" ganz><AppRoutes /></Fehlergrenze>
          </HashRouter>
        </PortalAuthProvider>
      </AppProvider>
    </AuthProvider>
  )
}

export default App
