// Colores corporativos de martinezsebastian: el tema oscuro del kit trama-ui
// que usa la web (C:/COMPARTIDO/martinezsebastian, node_modules/trama-ui).

export const PALETTE = {
  fg: '#e8ecf4', // texto
  mut: '#9aa3b5', // texto secundario: separadores, detalles, horas
  acc: '#7cc4ff', // acento principal: etiquetas
  acc2: '#c084fc', // acento secundario: el modelo
  ok: '#3ddc84',
  warn: '#ffb020',
  bad: '#ff5470',
} as const

// Mezcla dos colores `#rrggbb`: `t` 0 es `from`, 1 es `to`.
export const mix = (from: string, to: string, t: number): string => {
  const k = Math.min(Math.max(t, 0), 1)
  const ch = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(ch(from, i) + (ch(to, i) - ch(from, i)) * k).toString(16).padStart(2, '0')).join('')}`
}

// Gris oscuro de un dato que pesa poco: sube hacia su color al pesar más.
export const DIM = '#4a5163'
