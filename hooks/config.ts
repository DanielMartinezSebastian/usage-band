// Lo que se personaliza desde `/usage-band`, guardado en `$.store` (dura entre
// sesiones). Lo que falte o no sea válido toma el valor por defecto.

export type Config = {
  // Tramos de la línea.
  model: boolean
  ctx: boolean
  cost: boolean
  five: boolean
  fiveReset: boolean // la hora de reinicio junto al 5h
  week: boolean
  brand: boolean
  // Animaciones.
  count: boolean // un porcentaje que cambia sube contando
  pulse: boolean // un límite al 90 % o más pulsa
  countdown: boolean // cuenta atrás y "ventana nueva"
  wipe: boolean // los detalles entran y salen con barrido y la barra se llena
  spin: boolean // la marca gira al pensar y al pasar el ratón
  shimmer: boolean // brillo sobre el nombre del modelo al pensar
  // Umbrales de color (porcentaje de aviso y de alarma).
  limitWarn: number
  limitCrit: number
  ctxWarn: number
  ctxCrit: number
}

export const DEFAULTS: Config = {
  model: true,
  ctx: true,
  cost: true,
  five: true,
  fiveReset: true,
  week: true,
  brand: true,
  count: true,
  pulse: true,
  countdown: true,
  wipe: true,
  spin: true,
  shimmer: false,
  limitWarn: 70,
  limitCrit: 90,
  ctxWarn: 50,
  ctxCrit: 80,
}

export const STORE_KEY = 'config'

export type Toggle = { [K in keyof Config]: Config[K] extends boolean ? K : never }[keyof Config]
export type Threshold = Exclude<keyof Config, Toggle>

// Lo guardado, con los valores por defecto donde falte o no sea válido. Cada
// aviso queda por debajo de su alarma.
export const readConfig = (raw: unknown): Config => {
  const saved = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const config = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    const value = saved[key]
    if (typeof DEFAULTS[key] === 'boolean' && typeof value === 'boolean') (config as Record<string, unknown>)[key] = value
    if (typeof DEFAULTS[key] === 'number' && typeof value === 'number' && value >= 5 && value <= 100) {
      ;(config as Record<string, unknown>)[key] = Math.round(value)
    }
  }
  if (config.limitWarn >= config.limitCrit) config.limitWarn = Math.max(config.limitCrit - 5, 5)
  if (config.ctxWarn >= config.ctxCrit) config.ctxWarn = Math.max(config.ctxCrit - 5, 5)
  return config
}
