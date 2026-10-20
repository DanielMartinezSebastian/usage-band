import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionUsage } from 'claude-code'

const HINT: RenderPropsOf['PromptHint'] = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

const HOUR = 3_600_000

const usage = (rateLimits: SessionUsage['rateLimits'], percent?: number): SessionUsage => ({
  startedAt: 0,
  context: { window: 1_000_000, tokens: percent == null ? undefined : percent * 10_000, percent },
  rateLimits,
  cost: { usd: 0.42 },
})

// Answers what the plugin reads beneath it; `reading` returns the current usage.
const answerSession = (on: On, reading: () => SessionUsage, saved: Record<string, unknown> = {}) => {
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on, saved)
  on('session.usage', () => ({ value: reading() }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { model: 'opus', effortLevel: 'high' } }))
  on('session.version', () => ({ value: { version: '2.1.302' } }))
  return clock
}

const mount = ($: Engine, props = HINT) =>
  $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'PromptHint', props })

type Mounted = Awaited<ReturnType<typeof mount>>

// `inClient`: la key del Client donde buscar (el nombre del modelo, una barra).
const text = (ui: Mounted, pattern: RegExp, inClient?: string) =>
  ui.find({ type: 'Text', text: pattern, ...(inClient ? { in: inClient } : {}) })

const FULL = () =>
  usage(
    [
      { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(Date.now() + 2 * HOUR + 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 93, resetsAt: new Date(Date.now() + 80 * HOUR).toISOString() },
    ],
    32,
  )

test('línea mínima: modelo, contexto, coste y límites con sus colores', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($)

  expect((await text(ui, /^Opus 5\.5$/, 'model-name'))?.props.color).toBe('#c084fc')
  expect((await text(ui, /^32%$/))?.props.color).toBe('#3ddc84')
  expect((await text(ui, /^\$0\.4$/))?.props.color).toBe('#e8ecf4')
  expect((await text(ui, /^42%$/))?.props.color).toBe('#3ddc84')
  expect((await text(ui, /^93%$/))?.props.color).toBe('#ff5470')
  // Solo la ventana de 5 h lleva su hora de reinicio en la línea.
  expect(await ui.findAll({ type: 'Text', text: /^ \d\d:\d\d$/ })).toHaveLength(1)
  await ui.unmount()
})

// Lo que hace el hover con un detalle: oculto no tiene columnas; revelado, las
// gana, y el Client se construye. `settle` espera a que termine.
const reveal = async (ui: Mounted, key: string, columns: number, settle = true) => {
  await ui.resize({ columns: 0, rows: 0, in: `detail-${key}` })
  await ui.resize({ columns, rows: 1, in: `detail-${key}` })
  if (settle) await ui.advance(400)
}

test('cada métrica y el modelo tienen su detalle para el hover', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($)

  const details: [string, RegExp][] = [
    ['ctx', /680k libres \(68%\) · 320k usados de 1M/],
    ['five', /reinicia \d\d:\d\d · faltan 2h\dm/],
    ['week', /reinicia (dom|lun|mar|mié|jue|vie|sáb) \d\d:\d\d · faltan 3d\d+h/],
    ['model', /esfuerzo high · ventana 1M · estilo default · claude-opus-5-5 · ajuste "opus" · Claude Code 2\.1\.302/],
  ]
  for (const [key, pattern] of details) {
    await reveal(ui, key, 160)
    expect(await text(ui, pattern, `detail-${key}`)).toBeDefined()
  }
  await ui.unmount()
})

test('cada detalle se abre desde la etiqueta de su métrica, hacia la derecha', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($)

  const line = 'Opus 5.5 · ctx 32% · $0.4 · 5h 42% 14:16 ⊘ off · wk 93%'
  const layers = await ui.findAll({ type: 'Box' })
  const lefts = layers.filter(b => b.props.position === 'absolute').map(b => b.props.left)
  // Cada detalle tiene dos capas (salida y hover) en el mismo sitio; la de
  // medición y las del modelo empiezan en 0.
  expect([...new Set(lefts)].sort((a, b) => Number(a) - Number(b))).toEqual([
    0,
    line.indexOf('ctx'),
    line.indexOf('5h'),
    line.indexOf('wk'),
  ])
  await ui.unmount()
})

test('al revelarse, el detalle se construye de izquierda a derecha y su barra se llena', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($)

  await reveal(ui, 'five', 80, false)
  // Recién revelado: aún no se ve nada del contenido.
  expect(await text(ui, /5h/, 'detail-five')).toBeUndefined()
  await ui.advance(48)
  // A medio barrido: ya está la etiqueta, pero no el final.
  expect(await text(ui, /^5h $/, 'detail-five')).toBeDefined()
  expect(await text(ui, /faltan/, 'detail-five')).toBeUndefined()
  await ui.advance(400)
  // Construido: la barra llena hasta el 42 % y el texto entero, sin cursor.
  expect(await text(ui, /▌/, 'detail-five')).toBeUndefined()
  expect(await text(ui, /^███████░{9} 42%$/, 'detail-five')).toBeDefined()
  expect(await text(ui, /^ · reinicia \d\d:\d\d · faltan 2h\dm/, 'detail-five')).toBeDefined()
  await ui.unmount()
})

test('el brillo del modelo está apagado: el nombre no cambia mientras Claude trabaja', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($, { ...HINT, isWorking: true })

  await ui.advance(160)
  expect((await text(ui, /^Opus 5\.5$/, 'model-name'))?.props.color).toBe('#c084fc')
  expect(await ui.findAll({ type: 'Text', text: /^.$/, in: 'model-name' })).toHaveLength(0)
  await ui.unmount()
})

test('colorea en amarillo entre el 70 % y el 90 %', async ($, on) => {
  answerSession(on, () => usage([{ kind: 'five_hour', percentUsed: 75 }]))
  const ui = await mount($)

  expect((await text(ui, /^75%$/))?.props.color).toBe('#ffb020')
  await ui.unmount()
})

test('en los últimos 10 minutos la hora de reinicio pasa a cuenta atrás', async ($, on) => {
  answerSession(on, () =>
    usage([{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(Date.now() + 5 * 60_000).toISOString() }]),
  )
  const ui = await mount($)

  expect((await text(ui, /^ [45]:\d\d$/))?.props.color).toBe('#ffb020')
  await ui.unmount()
})

test('un porcentaje que cambia sube contando hasta el nuevo valor', async ($, on) => {
  let current = usage([{ kind: 'five_hour', percentUsed: 40 }])
  answerSession(on, () => current)
  const ui = await mount($)
  expect(await text(ui, /^40%$/)).toBeDefined()

  current = usage([{ kind: 'five_hour', percentUsed: 60 }])
  await ui.redraw()
  // Recién cambiado: en negrita y aún por debajo del valor nuevo.
  const counting = await text(ui, /^\d+%$/)
  expect(counting?.props.bold).toBe(true)
  expect(Number(counting?.text.replace('%', ''))).toBeLessThan(60)
  await ui.unmount()
})

test('sin lecturas de límites muestra solo modelo y coste', async ($, on) => {
  answerSession(on, () => usage([]))
  const ui = await mount($)

  expect(await text(ui, /^Opus 5\.5$/, 'model-name')).toBeDefined()
  expect(await text(ui, /%$/)).toBeUndefined()
  await ui.unmount()
})

const mountAt = ($: Engine, columns: number) =>
  $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'PromptHint',
    props: HINT,
    viewport: { columns, rows: 30 },
  })

test('al ocultarse, el detalle se retira de derecha a izquierda', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($)

  await reveal(ui, 'five', 80)
  // Abierto: la capa de salida está vacía.
  expect(await text(ui, /5h/, 'exit-five')).toBeUndefined()
  // El puntero se va: la superficie oculta el detalle y la capa de salida
  // lo redibuja entero.
  await ui.resize({ columns: 0, rows: 0, in: 'detail-five' })
  await ui.advance(16)
  expect(await text(ui, /faltan/, 'exit-five')).toBeDefined()
  // A medio camino ya se ha ido el final, pero sigue la etiqueta.
  await ui.advance(64)
  expect(await text(ui, /faltan/, 'exit-five')).toBeUndefined()
  expect(await text(ui, /^5h $/, 'exit-five')).toBeDefined()
  // Al acabar no queda nada.
  await ui.advance(400)
  expect(await text(ui, /5h/, 'exit-five')).toBeUndefined()
  await ui.unmount()
})

test('responsive: en estrecho quita coste, versión del modelo y semana, por ese orden', async ($, on) => {
  answerSession(on, FULL)
  // La línea completa mide 49; a 40 caben "Opus · ctx 32% · 5h 42% 14:16 · wk 93%" (38).
  const ui = await mountAt($, 40)

  expect(await text(ui, /^Opus$/, 'model-name')).toBeDefined()
  expect(await text(ui, /^\$0\.4$/)).toBeUndefined()
  expect(await text(ui, /^32%$/)).toBeDefined()
  expect(await text(ui, /^93%$/)).toBeDefined()
  await ui.unmount()
})

test('responsive: muy estrecho deja el modelo corto y la ventana de 5 h con su hora', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mountAt($, 20)

  expect(await text(ui, /^Opus$/, 'model-name')).toBeDefined()
  expect(await text(ui, /^42%$/)).toBeDefined()
  expect(await text(ui, /^ \d\d:\d\d$/)).toBeDefined()
  expect(await text(ui, /^32%$/)).toBeUndefined()
  expect(await text(ui, /^93%$/)).toBeUndefined()
  // Ni la versión corta cabe: el detalle del 5h rota sus datos de uno en uno,
  // sin barra.
  await reveal(ui, 'five', 18)
  expect(await text(ui, /^ · \d\d:\d\d$/, 'detail-five')).toBeDefined()
  await ui.advance(2000)
  expect(await text(ui, /^ · 2h\dm$/, 'detail-five')).toBeDefined()
  await ui.advance(2000)
  expect(await text(ui, /^ · 58% libre$/, 'detail-five')).toBeDefined()
  await ui.unmount()
})

test('responsive: a media anchura el detalle usa sus textos cortos en vez de cortarse', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mountAt($, 40)

  // Sin barra y con los datos en corto: hora, lo que falta y lo libre.
  await reveal(ui, 'five', 33)
  expect(await text(ui, /^ · \d\d:\d\d · 2h\dm · 58% libre$/, 'detail-five')).toBeDefined()
  await ui.unmount()
})

test('la marca: vacía en reposo, gira mientras Claude trabaja y al pasar el ratón', async ($, on) => {
  answerSession(on, FULL)
  const glyph = /^[/\\|-]$/
  const ui = await mountAt($, 120)
  // La copia del hover está oculta (sin columnas) hasta que el puntero la revela.
  await ui.resize({ columns: 0, rows: 0, in: 'brand-hover' })

  // En reposo: `< >` vacía, y la copia oculta quieta.
  expect(await text(ui, /^ $/, 'brand')).toBeDefined()
  const hidden = (await text(ui, glyph, 'brand-hover'))?.text
  await ui.advance(400)
  expect(await text(ui, glyph, 'brand')).toBeUndefined()
  expect((await text(ui, glyph, 'brand-hover'))?.text).toBe(hidden)

  // Hover: revelada, la copia gira.
  await ui.resize({ columns: 3, rows: 1, in: 'brand-hover' })
  const seen = new Set<string>()
  for (let i = 0; i < 4; i++) {
    seen.add((await text(ui, glyph, 'brand-hover'))?.text ?? '')
    await ui.advance(80)
  }
  expect([...seen].sort()).toEqual(['-', '/', '\\', '|'].sort())

  // Trabajando: la de la línea gira y cambia de color.
  await ui.redraw({ ...HINT, isWorking: true })
  const before = await text(ui, glyph, 'brand')
  await ui.advance(240)
  const after = await text(ui, glyph, 'brand')
  expect(after?.text).not.toBe(before?.text)
  expect(after?.props.color).not.toBe('#c084fc')
  await ui.unmount()
})

test('la marca siempre se ve: va encima de todo y los detalles acaban antes', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mountAt($, 120)

  const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')
  // La última capa absoluta de la fila es la marca, en las 3 últimas columnas.
  const brand = boxes.filter(b => b.props.width === 3).at(-1)
  expect(brand?.props.left).toBe(117)
  // Ningún detalle (ni su capa de salida) llega a la marca ni a su separación.
  for (const b of boxes) {
    if (b === brand || b.props.width === 3 || b.props.width === '100%') continue
    if (typeof b.props.width === 'number') expect(Number(b.props.left) + b.props.width).toBeLessThanOrEqual(116)
  }
  await ui.unmount()
})

test('la marca no se pinta si tras la línea no queda sitio', async ($, on) => {
  answerSession(on, FULL)
  // A 40 columnas la línea se compacta a «Opus · ctx 32% · 5h 42% 14:16 ·
  // wk 93%» (38): no caben la marca y su separación.
  const ui = await mountAt($, 40)
  expect(await ui.find({ key: 'brand' })).toBeUndefined()
  await ui.unmount()
})

test('el ancho medido (sin el indicador de Claude Code) ajusta la línea', async ($, on) => {
  answerSession(on, FULL)
  // La terminal mide 176, pero delante va el indicador del modo: quedan 40.
  const ui = await mountAt($, 176)
  expect(await text(ui, /^\$0\.4$/)).toBeDefined()
  await ui.resize({ columns: 40, rows: 1, in: 'measure' })
  expect(await text(ui, /^\$0\.4$/)).toBeUndefined()
  expect(await text(ui, /^Opus$/, 'model-name')).toBeDefined()
  await ui.unmount()
})

test('la configuración guardada quita tramos, la hora de reinicio y la marca, y cambia los umbrales', async ($, on) => {
  answerSession(on, FULL, { config: { cost: false, week: false, fiveReset: false, brand: false, limitWarn: 30, limitCrit: 40 } })
  const ui = await mountAt($, 120)

  expect(await text(ui, /^\$0\.4$/)).toBeUndefined()
  expect(await text(ui, /^93%$/)).toBeUndefined()
  expect(await text(ui, /^ \d\d:\d\d$/)).toBeUndefined()
  expect(await ui.find({ key: 'brand' })).toBeUndefined()
  // 42 % pasa a alarma con el umbral en 40 %.
  expect((await text(ui, /^42%$/))?.props.color).toBe('#ff5470')
  await ui.unmount()
})

test('/usage-band abre el panel: cada opción se guarda y se aplica a la línea', async ($, on) => {
  answerSession(on, FULL)
  const panel = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-band-config',
    props: { title: 'usage-band', isFocused: true, bodyColumns: 60 } as RenderPropsOf['Pane'],
  })
  expect(await panel.find({ key: 'cost' })).toBeDefined()
  expect(await panel.find({ key: 'limitWarn' })).toBeDefined()
  // El letrero de la cabecera, con su degradado de arriba abajo.
  expect((await panel.find({ type: 'Text', text: /^▄█ ▄▄ ▄▄▀▄▄/ }))?.props.color).toBe('#7cc4ff')
  expect((await panel.find({ type: 'Text', text: /^ +██▄▀▀ ██ ██/ }))?.props.color).toBe('#c084fc')

  // Quitar el importe y subir el aviso de los límites.
  await panel.press({ key: 'cost' })
  await panel.press({ key: 'limitWarn-up' })
  // El panel muestra lo guardado: el importe desmarcado y el aviso en 75 %.
  expect(await panel.find({ type: 'Text', text: /^ 75 % +$/ })).toBeDefined()

  // Y la línea, dibujada después, ya no lleva importe.
  const line = await mountAt($, 120)
  expect(await text(line, /^\$0\.4$/)).toBeUndefined()
  await line.unmount()

  // Restablecer vuelve a los valores por defecto.
  await panel.press({ key: 'reset' })
  expect(await panel.find({ type: 'Text', text: /^ 70 % +$/ })).toBeDefined()
  const restored = await mountAt($, 120)
  expect(await text(restored, /^\$0\.4$/)).toBeDefined()
  await restored.unmount()
  await panel.unmount()
})

test('el letrero no sale si el panel es más estrecho que él', async ($, on) => {
  answerSession(on, FULL)
  const panel = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-band-config',
    props: { title: 'usage-band', isFocused: true, bodyColumns: 30 } as RenderPropsOf['Pane'],
  })
  expect(await panel.find({ type: 'Text', text: /^▄█ ▄▄/ })).toBeUndefined()
  expect(await panel.find({ key: 'cost' })).toBeDefined()
  await panel.unmount()
})

test('el orden elegido cambia la posición de los tramos en la línea', async ($, on) => {
  answerSession(on, FULL, { config: { order: ['five', 'week', 'model', 'ctx', 'cost'] } })
  const ui = await mount($)

  // 5h va primero: su detalle se abre en la columna 0.
  const lefts = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute').map(b => b.props.left)
  const line = '5h 42% 14:16 ⊘ off · wk 93% · Opus 5.5 · ctx 32% · $0.4'
  expect(new Set(lefts)).toEqual(new Set([0, line.indexOf('wk'), line.indexOf('Opus'), line.indexOf('ctx')]))
  await ui.unmount()
})

test('el interruptor «piloto» de la línea enciende y apaga el piloto automático', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mountAt($, 160)

  // Pegado tras la hora de la ventana de 5 h: prohibido y «off», gris.
  expect((await text(ui, /^⊘ off$/))?.props.color).toBe('#9aa3b5')
  await ui.press({ key: 'auto' })
  await ui.redraw()
  // Encendido: el bucle y «on», en verde.
  expect((await text(ui, /^⟳ on$/))?.props.color).toBe('#3ddc84')
  await ui.unmount()
})

test('un estilo predefinido cambia los tramos de golpe', async ($, on) => {
  answerSession(on, FULL)
  const panel = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-band-config',
    props: { title: 'usage-band', isFocused: true, bodyColumns: 120 } as RenderPropsOf['Pane'],
  })
  await panel.press({ key: 'preset-min' })
  const line = await mountAt($, 120)
  // Mínimo: solo la ventana de 5 h con su hora.
  expect(await text(line, /^42%$/)).toBeDefined()
  expect(await text(line, /^32%$/)).toBeUndefined()
  expect(await text(line, /^\$0\.4$/)).toBeUndefined()
  expect(await line.find({ key: 'model-name' })).toBeUndefined()
  await line.unmount()
  await panel.unmount()
})

test('al llegar al límite: diálogo para decidir y, con el piloto automático, sigue solo al reiniciarse', async ($, on) => {
  const resetsAt = new Date(Date.now() + 60_000).toISOString()
  const atLimit = usage([{ kind: 'five_hour', percentUsed: 100, resetsAt }], 32)
  const clock = answerSession(on, () => atLimit)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  await $.session.measure({
    context: atLimit.context,
    rateLimits: atLimit.rateLimits,
    changed: ['rateLimits'],
  } as Parameters<typeof $.session.measure>[0])
  expect(opened).toContain('usage-band-limit')

  // El diálogo explica el límite; «a» enciende el piloto automático.
  const dialog = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'usage-band-limit',
    props: { title: 'Límite alcanzado', isFocused: true, bodyColumns: 100 } as RenderPropsOf['Pane'],
  })
  expect(await dialog.find({ type: 'Text', text: /Has llegado al límite de la ventana de 5 h/ })).toBeDefined()
  await dialog.press({ key: 'auto-on' })
  await dialog.unmount()

  // La línea pone el temporizador; al reiniciarse (con su margen) envía el prompt.
  const line = await mountAt($, 160)
  expect(sent).toHaveLength(0)
  await clock.advance(100_000)
  expect(sent.some(t => /continúa con la tarea/.test(t))).toBe(true)
  await line.unmount()
})

// El parpadeo sigue la hora real (Date.now): el test espera de verdad entre
// lecturas, con el temporizador del entorno de tests.
declare const setTimeout: (fn: () => void, ms: number) => unknown

test('con el límite alcanzado y el piloto encendido, su «on» parpadea', async ($, on) => {
  const resetsAt = new Date(Date.now() + 60 * 60_000).toISOString()
  const atLimit = usage([{ kind: 'five_hour', percentUsed: 100, resetsAt }], 32)
  answerSession(on, () => atLimit, { config: { autoContinue: true } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: atLimit.context,
    rateLimits: atLimit.rateLimits,
    changed: ['rateLimits'],
  } as Parameters<typeof $.session.measure>[0])

  const ui = await mountAt($, 160)
  // Alterna cada medio segundo entre normal y atenuado, en negrita.
  const states = new Set<boolean>()
  for (let i = 0; i < 4; i++) {
    const pilot = await text(ui, /^⟳ on$/)
    expect(pilot?.props.bold).toBe(true)
    states.add(Boolean(pilot?.props.dimColor))
    await new Promise<void>(resolve => setTimeout(() => resolve(), 260))
    await ui.redraw()
  }
  expect([...states].sort()).toEqual([false, true])
  await ui.unmount()
})

test('con el límite alcanzado y el piloto apagado, su «off» se queda en rojo sin parpadear', async ($, on) => {
  const resetsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  const atLimit = usage([{ kind: 'five_hour', percentUsed: 100, resetsAt }], 32)
  answerSession(on, () => atLimit)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: atLimit.context,
    rateLimits: atLimit.rateLimits,
    changed: ['rateLimits'],
  } as Parameters<typeof $.session.measure>[0])

  const ui = await mountAt($, 160)
  for (let i = 0; i < 3; i++) {
    const pilot = await text(ui, /^⊘ off$/)
    expect(pilot?.props.color).toBe('#ff5470')
    expect(pilot?.props.dimColor).toBeFalsy()
    await new Promise<void>(resolve => setTimeout(() => resolve(), 260))
    await ui.redraw()
  }
  await ui.unmount()
})

test('la rama git del entorno va a la izquierda de la marca y los detalles acaban antes', async ($, on) => {
  answerSession(on, FULL)
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: 'feature/rama\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.CwdChanged', () => ({}))
  const ui = await mountAt($, 120)
  await $.classic.CwdChanged({ old_cwd: 'C:/', new_cwd: 'C:/repo' })
  await ui.advance(10)

  expect(calls[0]).toEqual(['git', 'branch', '--show-current'])
  expect(await text(ui, /^feature\/rama$/)).toBeDefined()
  // «⎇ feature/rama» (14) termina una columna antes de la marca (117).
  const branch = await ui.find({ key: 'branch' })
  expect(branch?.props.left).toBe(120 - 3 - 1 - 14)
  const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.position === 'absolute')
  for (const b of boxes) {
    if (b === branch || b.props.width === 3 || b.props.width === '100%' || b.props.key === 'branch') continue
    if (typeof b.props.width === 'number') expect(Number(b.props.left) + b.props.width).toBeLessThanOrEqual(101)
  }
  await ui.unmount()
})

test('fuera de un repo git no hay rama', async ($, on) => {
  answerSession(on, FULL)
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('classic.CwdChanged', () => ({}))
  const ui = await mountAt($, 120)
  await $.classic.CwdChanged({ old_cwd: 'C:/', new_cwd: 'C:/tmp' })
  await ui.advance(10)
  expect(await ui.find({ key: 'branch' })).toBeUndefined()
  expect(await ui.find({ key: 'brand' })).toBeDefined()
  await ui.unmount()
})

test('con subagentes en marcha los corchetes cambian de color y el interior solo gira si la principal trabaja', async ($, on) => {
  answerSession(on, FULL)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const glyph = /^[/\|-]$/
  const bracket = async () => (await text(ui, /^<$/, 'brand'))?.props.color
  const ui = await mountAt($, 120)
  expect(await bracket()).toBe('#e8ecf4')

  // Un subagente en segundo plano: los corchetes recorren el degradado, el
  // interior sigue vacío.
  await $.turn.start({ text: 'busca', turnId: 'sub-1', agentId: 'agent-1' })
  await ui.redraw(HINT)
  const colors = new Set<string>()
  for (let i = 0; i < 4; i++) {
    colors.add(String(await bracket()))
    await ui.advance(240)
  }
  expect(colors.size).toBeGreaterThan(1)
  expect(colors.has('#e8ecf4')).toBe(false)
  expect(await text(ui, /^ $/, 'brand')).toBeDefined()
  expect(await text(ui, glyph, 'brand')).toBeUndefined()

  // La principal además trabaja: también gira el interior.
  await ui.redraw({ ...HINT, isWorking: true })
  const before = (await text(ui, glyph, 'brand'))?.text
  await ui.advance(80)
  expect((await text(ui, glyph, 'brand'))?.text).not.toBe(before)

  // El subagente acaba: los corchetes vuelven a su color.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'sub-1', agentId: 'agent-1', reason: 'answer' })
  await ui.redraw(HINT)
  expect(await bracket()).toBe('#e8ecf4')
  await ui.unmount()
})
