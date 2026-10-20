import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// La marca martinezsebastian: los corchetes `< >` de su logo con una barra
// dentro. Con `spin` la barra gira (/ - \ |), cada fotograma sustituyendo al
// anterior en la misma celda, como el spinner de Claude Code, y su color
// recorre el degradado de acento de la web (#7cc4ff → #c084fc); sin él los
// corchetes quedan vacíos. La copia del hover está oculta hasta que el puntero la
// revela, y solo gira mientras se ve (su región tiene columnas).

export type BrandProps = { spin: boolean }

type State = { step: number }

const TICK_MS = 80
const FRAMES = ['/', '-', '\\', '|']
// Pasos para un ciclo completo de color.
const COLOR_STEPS = 24
// Los dos acentos de la paleta, en RGB.
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const FROM = rgb(PALETTE.acc)
const TO = rgb(PALETTE.acc2)

// El color de la barra: va y vuelve entre los dos acentos.
const tint = (step: number) => {
  const t = (1 - Math.cos(((step % COLOR_STEPS) / COLOR_STEPS) * 2 * Math.PI)) / 2
  return `#${FROM.map((c, i) => Math.round(c + (TO[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`
}

// Si cada instancia debe girar ahora (hay dos: la de la línea y la del hover).
const spinning = new WeakMap<object, boolean>()

export default function Brand(props: BrandProps, surface: ClientSurface<State>): RenderElement {
  const { Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ step: 0 })
    // Cada instancia guarda si debe girar en su propio estado de reloj: solo
    // avanza mientras gira y se ve; si no, ningún redibujo.
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s && spinning.get(surface) && surface.columns > 0) surface.setState({ step: s.step + 1 })
    })
  }
  spinning.set(surface, props.spin)

  const step = surface.state?.step ?? 0
  return (
    <Text>
      <Text bold color={PALETTE.fg}>{'<'}</Text>
      <Text color={props.spin ? tint(step) : PALETTE.acc2}>{props.spin ? FRAMES[step % FRAMES.length] : ' '}</Text>
      <Text bold color={PALETTE.fg}>{'>'}</Text>
    </Text>
  )
}
