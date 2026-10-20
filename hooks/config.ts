// Lo que se personaliza desde `/usage-band`, guardado en `$.store` (dura entre
// sesiones). Lo que falte o no sea válido toma el valor por defecto.

// Los tramos de la línea que se pueden ordenar.
export type Segment = 'model' | 'ctx' | 'cost' | 'five' | 'week'
export const SEGMENTS: Segment[] = ['model', 'ctx', 'cost', 'five', 'week']

export type Config = {
  // Tramos de la línea.
  model: boolean
  ctx: boolean
  cost: boolean
  five: boolean
  fiveReset: boolean // la hora de reinicio junto al 5h
  week: boolean
  brand: boolean
  auto: boolean // el interruptor del piloto automático en la línea
  // En qué orden van los tramos.
  order: Segment[]
  // Animaciones.
  count: boolean // un porcentaje que cambia sube contando
  pulse: boolean // un límite al 90 % o más pulsa
  countdown: boolean // cuenta atrás y "ventana nueva"
  wipe: boolean // los detalles entran y salen con barrido y la barra se llena
  spin: boolean // la marca gira al pensar y al pasar el ratón
  shimmer: boolean // brillo sobre el nombre del modelo al pensar
  // Avisos y protección.
  alert: boolean // notificación al pasar de `alertAt` y cuando se puede seguir
  guard: boolean // aviso al enviar un prompt pasado `guardAt`
  compact: boolean // compactar al terminar un turno pasado `compactAt` de contexto
  autoContinue: boolean // piloto automático: al llegar al límite, seguir solo cuando se reinicie
  // Umbrales (porcentajes).
  limitWarn: number
  limitCrit: number
  ctxWarn: number
  ctxCrit: number
  alertAt: number
  guardAt: number
  compactAt: number
}

export const DEFAULTS: Config = {
  model: true,
  ctx: true,
  cost: true,
  five: true,
  fiveReset: true,
  week: true,
  brand: true,
  auto: true,
  order: [...SEGMENTS],
  count: true,
  pulse: true,
  countdown: true,
  wipe: true,
  spin: true,
  shimmer: false,
  alert: true,
  guard: true,
  compact: false,
  autoContinue: false,
  limitWarn: 70,
  limitCrit: 90,
  ctxWarn: 50,
  ctxCrit: 80,
  alertAt: 80,
  guardAt: 95,
  compactAt: 85,
}

// Estilos de un solo botón: qué tramos se ven.
export const PRESETS: { key: string; hotkey: string; name: string; set: Partial<Config> }[] = [
  {
    key: 'preset-full',
    hotkey: 'u',
    name: 'Completo',
    set: { model: true, ctx: true, cost: true, five: true, fiveReset: true, week: true, brand: true, auto: true },
  },
  {
    key: 'preset-limits',
    hotkey: 'v',
    name: 'Solo límites',
    set: { model: false, ctx: false, cost: false, five: true, fiveReset: true, week: true, brand: true, auto: true },
  },
  {
    key: 'preset-min',
    hotkey: 'w',
    name: 'Mínimo',
    set: { model: false, ctx: false, cost: false, five: true, fiveReset: true, week: false, brand: false, auto: false },
  },
]

export const STORE_KEY = 'config'

export type Toggle = { [K in keyof Config]: Config[K] extends boolean ? K : never }[keyof Config]
export type Threshold = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config]

// Lo guardado, con los valores por defecto donde falte o no sea válido. Cada
// aviso queda por debajo de su alarma, y el orden tiene cada tramo una vez.
export const readConfig = (raw: unknown): Config => {
  const saved = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const config: Config = { ...DEFAULTS, order: [...DEFAULTS.order] }
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const value = saved[key]
    if (typeof DEFAULTS[key] === 'boolean' && typeof value === 'boolean') (config as Record<string, unknown>)[key] = value
    if (typeof DEFAULTS[key] === 'number' && typeof value === 'number' && value >= 5 && value <= 100) {
      ;(config as Record<string, unknown>)[key] = Math.round(value)
    }
  }
  const order = Array.isArray(saved.order) ? saved.order.filter((s): s is Segment => SEGMENTS.includes(s as Segment)) : []
  config.order = [...new Set([...order, ...SEGMENTS])]
  if (config.limitWarn >= config.limitCrit) config.limitWarn = Math.max(config.limitCrit - 5, 5)
  if (config.ctxWarn >= config.ctxCrit) config.ctxWarn = Math.max(config.ctxCrit - 5, 5)
  return config
}

// El orden con un tramo movido un puesto (-1 antes, +1 después).
export const move = (order: Segment[], segment: Segment, by: -1 | 1): Segment[] => {
  const i = order.indexOf(segment)
  const j = i + by
  if (i < 0 || j < 0 || j >= order.length) return order
  const moved = [...order]
  ;[moved[i], moved[j]] = [moved[j]!, moved[i]!]
  return moved
}
