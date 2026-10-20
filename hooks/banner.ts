import { PALETTE } from './palette'

// El letrero «usage band» de la cabecera del panel, en bloques.
export const BANNER = [
  '▄█ ▄▄ ▄▄▀▄▄ ██▀▄▄ ▄█▀   ▄█▀',
  '██ ██ ██    ██ ██ ██    ██ ',
  '██ ██  ▀▀▄▄ ██▀██ ██▀█▄ ██▀',
  '██ ██ ▄▄ ██ ██ ██ ██ ██ ██ ',
  '▀▀▄▀▀ ▀▀▄▀▀ ██ ██ ▀█▄██ ▀█▄',
  '                    ██▀▄  ██▀▄▄ ▄█▀█▄ ██▀█▄',
  '                    ██ ██ ██ ██ ██ ██ ██ ██',
  '                    ██▀█▄ ██▀██ ██ ██ ██ ██',
  '                    ██ ██ ██ ██ ██ ██ ██ ██',
  '                    ██▄▀▀ ██ ██ ██ ██ ██▄█▀',
]

// Lo que mide la línea más ancha del letrero.
export const BANNER_WIDTH = Math.max(...BANNER.map(l => [...l].length))

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const FROM = rgb(PALETTE.acc)
const TO = rgb(PALETTE.acc2)

// El color de cada fila: un degradado de arriba abajo entre los dos acentos.
export const bannerColor = (row: number) => {
  const t = BANNER.length > 1 ? row / (BANNER.length - 1) : 0
  return `#${FROM.map((c, i) => Math.round(c + (TO[i]! - c) * t).toString(16).padStart(2, '0')).join('')}`
}
