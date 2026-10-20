import type { ClientSurface, RenderElement } from 'claude-code'

import { PALETTE } from './palette'

// Un detalle del hover, dibujado en la propia terminal. Está oculto (sin
// columnas) hasta que el hover lo revela; al revelarse su contenido se
// construye de izquierda a derecha, como una diapositiva que entra, y su
// barra se llena desde cero a la vez. Si sus datos no caben enteros
// (`parts`), los muestra de uno en uno por turnos.
//
// La salida: cuando el puntero se va, la superficie oculta el detalle al
// instante. Por eso cada detalle tiene una segunda instancia (`role: 'exit'`)
// en una capa siempre visible, vacía en reposo: al ocultarse el detalle le
// deja lo que se veía y ella lo retira de derecha a izquierda, dejando ver la
// línea de debajo. Se avisan por estado compartido del módulo, sin pasar por
// el hooks module, para que no haya un hueco entre las dos.

export type DetailProps = {
  id: string
  role?: 'exit'
  label: string
  labelColor: string
  // Si la etiqueta va en negrita, como en la línea (el importe no lo va).
  labelBold?: boolean
  // Con barra: el porcentaje, su color y las celdas de la barra (0, sin barra).
  pct?: number
  color?: string
  cells?: number
  // El texto tras la etiqueta, o sus datos por turnos si no cabe entero.
  text?: string
  parts?: string[]
}

type State = { tick: number; isVisible: boolean; openedAt: number; turn: number }

type Piece = { text: string; color: string; bold?: boolean }

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
// Lo último que mostró cada detalle: el dato del turno y cuántos caracteres.
const lastShown = new Map<string, { rest: string; shown: number }>()
// Las salidas pendientes o en curso, por detalle: lo que había a la vista al
// ocultarse y, una vez empezada, el tick de la capa de salida en que empezó.
const exits = new Map<string, { rest: string; from: number; start?: number }>()

// Las piezas del detalle, en orden, con su estilo; `fill` de 0 a 1 es cuánto
// se ha llenado la barra.
const piecesOf = (props: DetailProps, rest: string, fill: number): Piece[] => {
  // La etiqueta lleva un espacio detrás solo si sigue la barra (el resto ya
  // empieza por ` · `).
  const pieces: Piece[] = [
    { text: props.pct !== undefined ? `${props.label} ` : props.label, color: props.labelColor, bold: props.labelBold ?? true },
  ]
  if (props.pct !== undefined) {
    const pct = props.pct * ease(fill)
    // El porcentaje ocupa siempre el ancho del valor final, para que nada se
    // desplace mientras cuenta.
    const final = `${Math.round(props.pct * 10) / 10}%`
    const label = fill < 1 ? `${Math.round(pct)}%`.padStart(final.length) : final
    const cells = props.cells ?? 0
    pieces.push({ text: `${cells > 0 ? `${bar(pct, cells)} ` : ''}${label}`, color: props.color ?? PALETTE.fg })
  }
  if (rest) pieces.push({ text: ` · ${rest}`, color: PALETTE.mut })
  return pieces
}

// Los primeros `shown` caracteres de las piezas, con su estilo.
const cut = (surface: ClientSurface<State>, pieces: Piece[], shown: number) => {
  const { Text } = surface.elements
  const out: RenderElement[] = []
  let used = 0
  for (const p of pieces) {
    if (used >= shown) break
    const take = [...p.text].slice(0, shown - used).join('')
    out.push(
      <Text color={p.color} bold={p.bold}>
        {take}
      </Text>,
    )
    used += [...take].length
  }
  return { out, used }
}

// La capa de salida: vacía, salvo mientras retira un detalle que se ocultó.
const Exit = (props: DetailProps, surface: ClientSurface<State>): RenderElement => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ tick: 0, isVisible: true, openedAt: 0, turn: 0 })
    surface.every(TICK_MS, () => {
      const s = surface.state
      const ex = exits.get(props.id)
      if (!s || !ex) return
      if (ex.start === undefined) ex.start = s.tick
      surface.setState({ ...s, tick: s.tick + 1 })
    })
  }
  const s = surface.state
  const ex = exits.get(props.id)
  if (!s || !ex || ex.start === undefined) return <Text>{''}</Text>
  const t = ((s.tick - ex.start) * TICK_MS) / WIPE_MS
  if (t >= 1) {
    exits.delete(props.id)
    return <Text>{''}</Text>
  }
  // Se retira de derecha a izquierda: lo que deja libre muestra la línea.
  const shown = Math.floor(ex.from * (1 - ease(t)))
  return <Text wrap="truncate-end">{cut(surface, piecesOf(props, ex.rest, 1), shown).out}</Text>
}

export default function Detail(props: DetailProps, surface: ClientSurface<State>): RenderElement {
  if (props.role === 'exit') return Exit(props, surface)

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
    // Revelado: empieza a construirse y cancela una salida en curso.
    // Ocultado: deja a la capa de salida lo que se veía.
    const last = lastShown.get(props.id)
    if (isVisible) exits.delete(props.id)
    else if (last && last.shown > 0) exits.set(props.id, { rest: last.rest, from: last.shown })
    surface.setState({ ...surface.state, isVisible, openedAt: surface.state.tick, turn: 0 })
  }
  rotating.set(surface, (props.parts?.length ?? 0) > 1)

  const s = surface.state
  const ms = s ? elapsed(s) : Infinity
  const parts = props.parts ?? []
  const rest = parts.length > 0 ? parts[(s?.turn ?? 0) % parts.length]! : (props.text ?? '')
  const pieces = piecesOf(props, rest, Math.min(ms / FILL_MS, 1))

  // Barrido: del contenido se ven los primeros `shown` caracteres; el resto de
  // la fila queda en blanco, tapando la línea de debajo.
  const length = pieces.reduce((n, p) => n + [...p.text].length, 0)
  const { out, used } = cut(surface, pieces, Math.floor(length * ease(ms / WIPE_MS)))
  if (isVisible) lastShown.set(props.id, { rest, shown: used })
  out.push(<Text>{' '.repeat(Math.max(surface.columns - used, 0))}</Text>)

  return <Text wrap="truncate-end">{out}</Text>
}
