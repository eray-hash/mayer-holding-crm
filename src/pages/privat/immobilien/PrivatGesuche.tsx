import { Gesuche } from '../../immobilien/Gesuche'
import { NurEigeneAnsicht } from './AnsichtAlsHinweis'

/** Gesuche der eigenen privaten Kunden, abgeglichen mit den eigenen Objekten (/privat/immobilien/gesuche). */
export function PrivatGesuche() {
  return (
    <NurEigeneAnsicht>
      <Gesuche privat />
    </NurEigeneAnsicht>
  )
}
