import { ObjektDetail } from '../../immobilien/ObjektDetail'
import { NurEigeneAnsicht } from './AnsichtAlsHinweis'

/** Akte eines eigenen privaten Objekts (/privat/immobilien/objekte/:id). */
export function PrivatObjektDetail() {
  return (
    <NurEigeneAnsicht>
      <ObjektDetail privat />
    </NurEigeneAnsicht>
  )
}
