import { useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { VorlagenListe } from '../../components/VorlagenListe'

export function VorlagenPageFinanzierungen() {
  const { kind } = useParams()
  const { state } = useApp()
  return <VorlagenListe kategorie={kind ?? 'vollmacht'} vorlagen={state.vorlagenFinanzierungen} />
}
