import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// La marca martinezsebastian al final de la línea: los corchetes `< >` de su
// logo con una barra que gira dentro (/ - \ |), cada fotograma sustituyendo
// al anterior en la misma celda, como el spinner de Claude Code, y su color
// recorriendo el degradado de acento de la web (#7cc4ff → #c084fc).
//
// Es una capa de toda la fila: se pinta a la derecha si tras la línea
// (`lineWidth`) queda sitio, y envía al hooks module el ancho de la fila,
// que Claude Code no le dice.

// `show`: pintar la marca; sin ella la capa solo mide.
export type BrandProps = { isWorking: boolean; lineWidth: number; show: boolean }

type State = { step: number }

const TICK_MS = 80
const FRAMES = ['/', '-', '\\', '|']
// Pasos para un ciclo completo de color.
const COLOR_STEPS = 24
// Los dos acentos de la paleta, en RGB.
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const FROM = rgb(PALETTE.acc)
const TO = rgb(PALETTE.acc2)
const WIDTH = 3
const GAP = 1 // espacio mínimo entre la línea y la marca

// El color de la barra: va y vuelve entre los dos acentos.
const tint = (step: number) => {
  const t = (1 - Math.cos(((step % COLOR_STEPS) / COLOR_STEPS) * 2 * Math.PI)) / 2
  return `#${FROM.map((c, i) => Math.round(c + (TO[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// El último ancho enviado, para no repetirlo.
let sentWidth = -1

export default function Brand(props: BrandProps, surface: ClientSurface<State>): RenderElement {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ step: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s) surface.setState({ step: s.step + 1 })
    })
  }

  if (surface.columns > 0 && surface.columns !== sentWidth) {
    sentWidth = surface.columns
    surface.post({ width: surface.columns })
  }

  if (!props.show || surface.columns - props.lineWidth < WIDTH + GAP) return <Text>{''}</Text>

  const step = surface.state?.step ?? 0
  const glyph = FRAMES[step % FRAMES.length]
  const color = tint(step)
  return (
    <Box width="100%" justifyContent="flex-end">
      <Text>
        <Text bold color={PALETTE.fg}>{'<'}</Text>
        <Text color={color}>{glyph}</Text>
        <Text bold color={PALETTE.fg}>{'>'}</Text>
      </Text>
    </Box>
  )
}
