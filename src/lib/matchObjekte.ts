import type { Kaeuferprofil, Objekt } from '../types'

// Filtert den Objektbestand anhand eines Käuferprofils: Budget-Spanne, bevorzugte Objekttypen
// (falls gewählt) und ein einfacher Textabgleich der bevorzugten Lage gegen die Adresse. Objekte,
// die bereits einem Kunden zugewiesen sind, kommen nicht mehr in Frage.
export function matchObjekte(objekte: Objekt[], profil: Kaeuferprofil): Objekt[] {
  const lage = profil.bevorzugteLage.trim().toLowerCase()
  return objekte.filter((o) => {
    if (o.zugewiesenerKunde) return false
    if (profil.budgetMin != null && o.kaufpreis < profil.budgetMin) return false
    if (profil.budgetMax != null && o.kaufpreis > profil.budgetMax) return false
    if (profil.objekttypen.length > 0 && !profil.objekttypen.includes(o.typ)) return false
    if (lage && !o.adresse.toLowerCase().includes(lage)) return false
    return true
  })
}
