import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// La marca martinezsebastian al final de la línea: los corchetes `< >` de su
// logo con un glifo dentro que se transforma como el spinner de Claude Code:
// una secuencia de formas de estrella (· ✢ ✳ ✶ ✻ ✽) que va y vuelve, cada
// fotograma sustituyendo al anterior en la misma celda. Mientras Claude
// trabaja se anima y su color recorre el degradado de acento de la web
// (#7cc4ff → #c084fc); en reposo se queda quieta en ✻.
//
// Es una capa de toda la fila: se pinta a la derecha si tras la línea
// (`lineWidth`) queda sitio, y envía al hooks module el ancho de la fila,
// que Claude Code no le dice.

// `show`: pintar la marca; sin ella la capa solo mide.
export type BrandProps = { isWorking: boolean; lineWidth: number; show: boolean }

type State = { step: number }

const TICK_MS = 120
// Ida y vuelta: · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢
const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽']
const FRAMES = [...GLYPHS, ...GLYPHS.slice(1, -1).reverse()]
const IDLE = '✻'
// Los dos acentos de la paleta, en RGB.
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const FROM = rgb(PALETTE.acc)
const TO = rgb(PALETTE.acc2)
const WIDTH = 3
const GAP = 1 // espacio mínimo entre la línea y la marca

// El color del glifo: va y vuelve entre los dos acentos en un ciclo completo
// de fotogramas.
const tint = (step: number) => {
  const t = (1 - Math.cos(((step % FRAMES.length) / FRAMES.length) * 2 * Math.PI)) / 2
  return `#${FROM.map((c, i) => Math.round(c + (TO[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// Los últimos datos, para que el reloj sepa si animar; y el último ancho
// enviado, para no repetirlo.
let isWorking = false
let sentWidth = -1

export default function Brand(props: BrandProps, surface: ClientSurface<State>): RenderElement {
  isWorking = props.isWorking
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ step: 0 })
    // En reposo no avanza: ningún redibujo.
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s && isWorking) surface.setState({ step: s.step + 1 })
    })
  }

  if (surface.columns > 0 && surface.columns !== sentWidth) {
    sentWidth = surface.columns
    surface.post({ width: surface.columns })
  }

  if (!props.show || surface.columns - props.lineWidth < WIDTH + GAP) return <Text>{''}</Text>

  const step = surface.state?.step ?? 0
  const glyph = props.isWorking ? FRAMES[step % FRAMES.length] : IDLE
  const color = props.isWorking ? tint(step) : PALETTE.acc2
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
