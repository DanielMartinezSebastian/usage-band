import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// La marca martinezsebastian al final de la línea: sus corchetes `< >` con un
// punto que gira dentro, en el degradado de acento de la web (#7cc4ff →
// #c084fc). Gira despacio en reposo y rápido mientras Claude trabaja.
//
// Es una capa de toda la fila: se pinta a la derecha si tras la línea
// (`lineWidth`) queda sitio, y envía al hooks module el ancho de la fila,
// que Claude Code no le dice.

// `show`: pintar la marca; sin ella la capa solo mide.
export type BrandProps = { isWorking: boolean; lineWidth: number; show: boolean }

type State = { frame: number }

const TICK_MS = 100
const IDLE_EVERY = 4 // en reposo, un paso cada 4 ticks
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// Los dos acentos de la paleta, en RGB.
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const FROM = rgb(PALETTE.acc)
const TO = rgb(PALETTE.acc2)
const WIDTH = 3
const GAP = 1 // espacio mínimo entre la línea y la marca

// El color del punto: va y vuelve entre los dos acentos.
const tint = (frame: number) => {
  const t = (1 - Math.cos((frame / FRAMES.length) * Math.PI)) / 2
  return `#${FROM.map((c, i) => Math.round(c + (TO[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// Los últimos datos, para que el reloj sepa a qué ritmo girar; los ticks,
// fuera del estado para no redibujar en los que no avanza; y el último ancho
// enviado, para no repetirlo.
let isWorking = false
let ticks = 0
let sentWidth = -1

export default function Brand(props: BrandProps, surface: ClientSurface<State>): RenderElement {
  isWorking = props.isWorking
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ frame: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      ticks += 1
      if (s && (isWorking || ticks % IDLE_EVERY === 0)) surface.setState({ frame: (s.frame + 1) % (FRAMES.length * 2) })
    })
  }

  if (surface.columns > 0 && surface.columns !== sentWidth) {
    sentWidth = surface.columns
    surface.post({ width: surface.columns })
  }

  if (!props.show || surface.columns - props.lineWidth < WIDTH + GAP) return <Text>{''}</Text>

  const frame = surface.state?.frame ?? 0
  return (
    <Box width="100%" justifyContent="flex-end">
      <Text>
        <Text bold color={PALETTE.fg}>{'<'}</Text>
        <Text color={tint(frame)}>{FRAMES[frame % FRAMES.length]}</Text>
        <Text bold color={PALETTE.fg}>{'>'}</Text>
      </Text>
    </Box>
  )
}
