import { ObjektListe } from '../../immobilien/ObjektListe'
import { NurEigeneAnsicht } from './AnsichtAlsHinweis'

/** Private Objektliste des angemeldeten Mitarbeiters (/privat/immobilien). */
export function PrivatObjektListe() {
  return (
    <NurEigeneAnsicht>
      <ObjektListe privat />
    </NurEigeneAnsicht>
  )
}
