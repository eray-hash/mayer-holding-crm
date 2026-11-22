// Ersatz für node:async_hooks im Browser. Die Gesprächs-App importiert findeBezug aus
// supabase/functions/_shared/terminBriefingKern.ts; der zieht kiVerbrauch.ts mit, das beim Laden
// einen AsyncLocalStorage anlegt. Im Browser wird davon nichts aufgerufen — der Ersatz muss nur da sein.
// Eingebunden über resolve.alias in vite.config.ts.
export class AsyncLocalStorage<T> {
  private wert: T | undefined
  run<R>(store: T, arbeit: () => R): R {
    const vorher = this.wert
    this.wert = store
    try {
      return arbeit()
    } finally {
      this.wert = vorher
    }
  }
  getStore(): T | undefined {
    return this.wert
  }
}
