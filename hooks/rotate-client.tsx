import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// El resto de un detalle cuando ni su versión corta cabe en la fila: muestra
// sus datos de uno en uno, por turnos, con el reloj de la propia superficie.

// `pad`: ancho a ocupar (con espacios) para tapar lo que hay debajo.
export type RotateProps = { parts: string[]; pad: number }

type State = { tick: number }

const EVERY_MS = 2000

export default function Rotate(props: RotateProps, surface: ClientSurface<State>): RenderElement {
  const { Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ tick: 0 })
    surface.every(EVERY_MS, () => {
      const s = surface.state
      if (s) surface.setState({ tick: s.tick + 1 })
    })
  }

  const n = Math.max(props.parts.length, 1)
  const part = props.parts[(surface.state?.tick ?? 0) % n] ?? ''
  return (
    <Text color={PALETTE.mut} wrap="truncate-end">
      {` · ${part}`.padEnd(props.pad)}
    </Text>
  )
}
