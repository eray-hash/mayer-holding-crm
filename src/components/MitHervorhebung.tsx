// Zeigt eine Assistenten-Antwort mit hervorgehobenem Wesentlichen: **…** wird fett auf gelbem Grund
// (Wunsch Hasan 25.11.2026). Gegenstück zu supabase/functions/_shared/fettMarken.ts (Telegram: fett).
export function teileHervorhebung(text: string): { text: string; fett: boolean }[] {
  const teile: { text: string; fett: boolean }[] = []
  const muster = /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g
  let letzt = 0
  for (const m of text.matchAll(muster)) {
    if (m.index! > letzt) teile.push({ text: text.slice(letzt, m.index), fett: false })
    teile.push({ text: m[1], fett: true })
    letzt = m.index! + m[0].length
  }
  if (letzt < text.length) teile.push({ text: text.slice(letzt), fett: false })
  return teile
}

export function ohneHervorhebung(text: string): string {
  return teileHervorhebung(text).map((t) => t.text).join('')
}

export default function MitHervorhebung({ text }: { text: string }) {
  return (
    <>
      {teileHervorhebung(text).map((t, i) =>
        t.fett ? (
          <strong key={i} className="rounded bg-amber-100 px-1 font-semibold text-slate-900">
            {t.text}
          </strong>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  )
}
