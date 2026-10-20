import type { ClientSurface, RenderElement } from 'claude-code'

// Una capa invisible de toda la fila que mide su ancho real y se lo envía al
// hooks module: Claude Code pinta delante su indicador de modo (`⏵⏵ auto mode
// on`) y no dice cuánto ocupa.

// El último ancho enviado, para no repetirlo.
let sentWidth = -1

export default function Measure(_props: null, surface: ClientSurface<undefined>): RenderElement {
  if (surface.columns > 0 && surface.columns !== sentWidth) {
    sentWidth = surface.columns
    surface.post({ width: surface.columns })
  }
  return <surface.elements.Text>{''}</surface.elements.Text>
}
