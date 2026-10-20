import type { ClientSurface, RenderElement } from 'claude-code'

// La barra de un detalle, dibujada en la propia terminal. El detalle está
// oculto (sin tamaño) hasta que el hover lo revela; cuando la región pasa a
// tener columnas, la barra se llena desde cero hasta el valor.

// `cells`: ancho de la barra; 0 deja solo el porcentaje (ventana estrecha).
export type BarProps = { pct: number; color: string; cells: number }

type State = { tick: number; isVisible: boolean; openedAt: number }

const TICK_MS = 40
const FILL_MS = 400

const isFilling = (s: State) => s.isVisible && (s.tick - s.openedAt) * TICK_MS < FILL_MS

const bar = (pct: number, cells: number) => {
  const filled = Math.round((Math.min(pct, 100) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export default function Bar(props: BarProps, surface: ClientSurface<State>): RenderElement {
  const { Text } = surface.elements
  const isVisible = surface.columns > 0

  if (surface.state === undefined) {
    surface.setState({ tick: 0, isVisible, openedAt: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s && isFilling(s)) surface.setState({ ...s, tick: s.tick + 1 })
    })
  } else if (isVisible !== surface.state.isVisible) {
    // Revelado u ocultado: al revelarse empieza a llenarse.
    surface.setState({ ...surface.state, isVisible, openedAt: surface.state.tick })
  }

  const s = surface.state
  const t = s ? Math.min(((s.tick - s.openedAt) * TICK_MS) / FILL_MS, 1) : 1
  const eased = 1 - (1 - t) ** 3
  const pct = props.pct * eased
  // El porcentaje ocupa siempre el ancho del valor final, para que el texto
  // que sigue no se desplace mientras cuenta.
  const final = `${Math.round(props.pct * 10) / 10}%`
  const label = t < 1 ? `${Math.round(pct)}%`.padStart(final.length) : final

  return (
    <Text color={props.color}>
      {props.cells > 0 ? `${bar(pct, props.cells)} ` : ''}
      {label}
    </Text>
  )
}
