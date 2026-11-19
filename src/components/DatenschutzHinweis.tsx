// Kurzer Hinweis mit Link auf die Datenschutzhinweise (Seite /datenschutz) — unten in jedem
// öffentlichen Formular und im Investoren-Portal-Login (seit 19.11.2026).
export function DatenschutzHinweis({ dunkel = false }: { dunkel?: boolean }) {
  return (
    <p className={`mx-auto mt-6 max-w-2xl text-center text-xs print:hidden ${dunkel ? 'text-slate-400' : 'text-slate-500'}`}>
      Hinweise zum Datenschutz:{' '}
      <a href="#/datenschutz" target="_blank" rel="noopener noreferrer" className={`underline ${dunkel ? 'hover:text-slate-200' : 'hover:text-slate-700'}`}>
        Datenschutzhinweise
      </a>
    </p>
  )
}
