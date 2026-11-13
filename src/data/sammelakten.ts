// Zwei feste Akten in der Unternehmensberatung, die der Assistent anlegt und füllt (siehe
// supabase/functions/telegram-gateway): Alles, was per Telegram kommt, liegt sofort in einer Akte —
// was keinem Kunden zuzuordnen ist, hier. Es sind keine Kunden; Warnungen wie "fehlende Stammdaten"
// gelten für sie nicht.
export const AKTE_UNGEKLAERT = 'k_eingang_ungeklaert'
export const AKTE_INTERN = 'k_intern_holding'

export const istSammelakte = (kundeId: string) => kundeId === AKTE_UNGEKLAERT || kundeId === AKTE_INTERN

export const PFAD_UNGEKLAERT = `/beratung/kunden/${AKTE_UNGEKLAERT}`
