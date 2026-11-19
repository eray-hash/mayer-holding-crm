import { Card } from '../../components/ui'

// Öffentliche Seite /datenschutz (seit 19.11.2026): Datenschutzhinweise für Kunden, Interessenten,
// Eigentümer und Investoren, die die öffentlichen Formulare oder das Investoren-Portal nutzen.
// Verlinkt aus jedem Formular über components/DatenschutzHinweis.tsx. Inhalt abgestimmt mit dem
// Dokument „Datenschutz-Unterlagen Mayer Holding CRM“ (Verarbeitungsverzeichnis).

const STAND = '19.11.2026'

function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{titel}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  )
}

export function PublicDatenschutz() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-accent-600">Andreas Mayer Holding · Schwabstraße 3 · 89075 Ulm</p>
          <h1 className="mt-1 text-xl font-bold text-slate-800">Datenschutzhinweise</h1>
          <p className="mt-1 text-xs text-slate-500">für unsere Online-Formulare und das Investoren-Portal · Stand {STAND}</p>
        </div>
        <Card className="p-6">
          <Abschnitt titel="1. Verantwortlicher">
            <p>
              Andreas Mayer Holding UG (haftungsbeschränkt), Schwabstraße 3, 89075 Ulm
              <br />
              vertreten durch den Geschäftsführer Andreas Mayer
              <br />
              E-Mail: <a className="underline" href="mailto:info@amayer-holding.com">info@amayer-holding.com</a>
            </p>
          </Abschnitt>

          <Abschnitt titel="2. Zweck und Rechtsgrundlage">
            <p>
              Wir verarbeiten die Angaben, die Sie in unseren Formularen eintragen oder als Unterlagen hochladen, um Ihr Anliegen zu
              bearbeiten: zum Beispiel eine Beratung, eine Vollmacht, eine Selbstauskunft, den Verkauf einer Immobilie oder Ihre
              Beteiligung als Investor.
            </p>
            <p>
              Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Durchführung eines Vertrags oder vorvertragliche Maßnahmen auf Ihre
              Anfrage) sowie Art. 6 Abs. 1 lit. f DSGVO (unser berechtigtes Interesse an einer zügigen und sorgfältigen
              Bearbeitung).
            </p>
          </Abschnitt>

          <Abschnitt titel="3. Speicherort">
            <p>Ihre Daten werden in unserem Kundenverwaltungssystem gespeichert. Datenbank und Dateien liegen auf Servern in der Europäischen Union (Irland).</p>
          </Abschnitt>

          <Abschnitt titel="4. Einsatz von KI-Diensten">
            <p>
              Zur Unterstützung bei der Auswertung von Nachrichten, Dokumenten und Sprachaufnahmen setzen wir KI-Dienste der
              Anbieter Anthropic PBC (USA) und Groq Inc. (USA) ein. Dabei können personenbezogene Daten in die USA übermittelt
              werden.
            </p>
            <p>
              Mit beiden Anbietern bestehen Verträge zur Auftragsverarbeitung nach Art. 28 DSGVO. Die Übermittlung in die USA ist
              durch die Standardvertragsklauseln der EU-Kommission abgesichert. Die Anbieter verwenden Ihre Daten nicht zum Training
              ihrer KI-Modelle.
            </p>
          </Abschnitt>

          <Abschnitt titel="5. Weitere Dienstleister">
            <ul className="list-disc space-y-1 pl-5">
              <li>Fundament IT UG (haftungsbeschränkt), Ulm: Entwicklung und Betrieb unseres Kundenverwaltungssystems; setzt die hier genannten technischen Dienste in unserem Auftrag ein</li>
              <li>Supabase: Betrieb der Datenbank und Dateiablage, Server in der EU (Irland)</li>
              <li>IONOS: E-Mail-Postfächer, Deutschland</li>
              <li>CloudMailin: Weiterleitung eingehender E-Mails, Vereinigtes Königreich (von der EU als gleichwertig sicher anerkannt)</li>
            </ul>
            <p>Mit diesen Dienstleistern bestehen bzw. werden Verträge zur Auftragsverarbeitung geschlossen. Eine Weitergabe an sonstige Dritte erfolgt nur, wenn dies für Ihr Anliegen nötig ist oder Sie zugestimmt haben.</p>
          </Abschnitt>

          <Abschnitt titel="6. Speicherdauer">
            <p>
              Wir speichern Ihre Daten, solange es für Ihr Anliegen nötig ist. Danach bewahren wir sie nur so lange auf, wie es
              gesetzliche Aufbewahrungsfristen verlangen: in der Regel 6 Jahre für Geschäftsbriefe und 10 Jahre für Buchungs- und
              Steuerunterlagen.
            </p>
          </Abschnitt>

          <Abschnitt titel="7. Ihre Rechte">
            <p>Sie haben das Recht auf</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Auskunft über Ihre gespeicherten Daten,</li>
              <li>Berichtigung unrichtiger Daten,</li>
              <li>Löschung Ihrer Daten, soweit keine Aufbewahrungspflicht besteht,</li>
              <li>Einschränkung der Verarbeitung,</li>
              <li>Widerspruch gegen die Verarbeitung, soweit sie auf unserem berechtigten Interesse beruht,</li>
              <li>Datenübertragbarkeit.</li>
            </ul>
            <p>
              Schreiben Sie uns dafür einfach an <a className="underline" href="mailto:info@amayer-holding.com">info@amayer-holding.com</a>.
            </p>
            <p>
              Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren. Für uns zuständig ist der
              Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg.
            </p>
          </Abschnitt>
        </Card>
        <p className="mt-6 text-center text-xs text-slate-400">Stand: {STAND}</p>
      </div>
    </div>
  )
}
