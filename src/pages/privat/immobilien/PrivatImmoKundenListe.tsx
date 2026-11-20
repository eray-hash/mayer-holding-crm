import { ImmobilienKundenListe } from '../../immobilien/ImmobilienKundenListe'
import { NurEigeneAnsicht } from './AnsichtAlsHinweis'

/** Eigene private Immobilien-Kunden (/privat/immobilien/kunden). */
export function PrivatImmoKundenListe() {
  return (
    <NurEigeneAnsicht>
      <ImmobilienKundenListe privat />
    </NurEigeneAnsicht>
  )
}
