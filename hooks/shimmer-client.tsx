import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// El nombre del modelo, dibujado en la propia terminal: mientras Claude
// trabaja, tres letras más claras lo recorren con el reloj de la superficie.

export type ShimmerProps = { text: string; color: string; isWorking: boolean }

type State = { tick: number }

const TICK_MS = 80

// Los últimos datos, para que el reloj sepa si tiene que animar.
let isWorking = false

export default function Shimmer(props: ShimmerProps, surface: ClientSurface<State>): RenderElement {
  isWorking = props.isWorking
  const { Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ tick: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s && isWorking) surface.setState({ tick: s.tick + 1 })
    })
  }

  if (!props.isWorking) {
    return (
      <Text bold color={props.color}>
        {props.text}
      </Text>
    )
  }

  const chars = [...props.text]
  const pos = (surface.state?.tick ?? 0) % (chars.length + 6)
  return (
    <Text bold>
      {chars.map((c, i) => (
        <Text color={Math.abs(i - pos) <= 1 ? PALETTE.fg : props.color}>{c}</Text>
      ))}
    </Text>
  )
}
