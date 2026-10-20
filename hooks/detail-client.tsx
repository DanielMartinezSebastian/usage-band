import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// Un detalle del hover, dibujado en la propia terminal. Está oculto (sin
// columnas) hasta que el hover lo revela; al revelarse su contenido se
// construye de izquierda a derecha, como una diapositiva que entra, y su
// barra se llena desde cero a la vez. Si sus datos
// no caben enteros (`parts`), los muestra de uno en uno por turnos.

export type DetailProps = {
  label: string
  labelColor: string
  // Con barra: el porcentaje, su color y las celdas de la barra (0, sin barra).
  pct?: number
  color?: string
  cells?: number
  // El texto tras la etiqueta, o sus datos por turnos si no cabe entero.
  text?: string
  parts?: string[]
}

type State = { tick: number; isVisible: boolean; openedAt: number; turn: number }

const TICK_MS = 16
const WIPE_MS = 180
const FILL_MS = 200
const TURN_MS = 2000

const ease = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3

const bar = (pct: number, cells: number) => {
  const filled = Math.round((Math.min(pct, 100) / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

const elapsed = (s: State) => (s.tick - s.openedAt) * TICK_MS
const isAnimating = (s: State) => s.isVisible && elapsed(s) < Math.max(WIPE_MS, FILL_MS)

// Si cada instancia rota sus datos ahora.
const rotating = new WeakMap<object, boolean>()

export default function Detail(props: DetailProps, surface: ClientSurface<State>): RenderElement {
  const { Text } = surface.elements
  const isVisible = surface.columns > 0

  if (surface.state === undefined) {
    surface.setState({ tick: 0, isVisible, openedAt: 0, turn: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      if (s && isAnimating(s)) surface.setState({ ...s, tick: s.tick + 1 })
    })
    surface.every(TURN_MS, () => {
      const s = surface.state
      if (s && s.isVisible && rotating.get(surface)) surface.setState({ ...s, turn: s.turn + 1 })
    })
  } else if (isVisible !== surface.state.isVisible) {
    // Revelado u ocultado: al revelarse empieza a construirse.
    surface.setState({ ...surface.state, isVisible, openedAt: surface.state.tick, turn: 0 })
  }
  rotating.set(surface, (props.parts?.length ?? 0) > 1)

  const s = surface.state
  const ms = s ? elapsed(s) : Infinity

  // Las piezas del detalle, en orden, con su estilo.
  const pieces: { text: string; color: string; bold?: boolean }[] = [
    { text: `${props.label} `, color: props.labelColor, bold: true },
  ]
  if (props.pct !== undefined) {
    const t = Math.min(ms / FILL_MS, 1)
    const pct = props.pct * ease(t)
    // El porcentaje ocupa siempre el ancho del valor final, para que nada se
    // desplace mientras cuenta.
    const final = `${Math.round(props.pct * 10) / 10}%`
    const label = t < 1 ? `${Math.round(pct)}%`.padStart(final.length) : final
    const cells = props.cells ?? 0
    pieces.push({ text: `${cells > 0 ? `${bar(pct, cells)} ` : ''}${label}`, color: props.color ?? PALETTE.fg })
  }
  const parts = props.parts ?? []
  const rest = parts.length > 0 ? parts[(s?.turn ?? 0) % parts.length]! : (props.text ?? '')
  if (rest) pieces.push({ text: ` · ${rest}`, color: PALETTE.mut })

  // Barrido: del contenido se ven los primeros `shown` caracteres; el resto de
  // la fila queda en blanco, tapando la línea de debajo.
  const width = surface.columns
  const length = pieces.reduce((n, p) => n + [...p.text].length, 0)
  const shown = Math.floor(length * ease(ms / WIPE_MS))
  const out: RenderElement[] = []
  let used = 0
  for (const p of pieces) {
    if (used >= shown) break
    const chars = [...p.text]
    const take = chars.slice(0, shown - used).join('')
    out.push(
      <Text color={p.color} bold={p.bold}>
        {take}
      </Text>,
    )
    used += [...take].length
  }
  const blank = Math.max(width - used, 0)
  out.push(<Text>{' '.repeat(blank)}</Text>)

  return <Text wrap="truncate-end">{out}</Text>
}
