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
const answerSession = (on: On, reading: () => SessionUsage) => {
  mock.clock(on, { now: Date.now() })
  on('session.usage', () => ({ value: reading() }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { model: 'opus', effortLevel: 'high' } }))
  on('session.version', () => ({ value: { version: '2.1.302' } }))
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

  const line = 'Opus 5.5 · ctx 32% · $0.4 · 5h 42% 14:16 · wk 93%'
  const layers = await ui.findAll({ type: 'Box' })
  const lefts = layers.filter(b => b.props.position === 'absolute').map(b => b.props.left)
  // La capa de medición y la del modelo empiezan en 0.
  expect(lefts.sort((a, b) => Number(a) - Number(b))).toEqual([
    0,
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
  // Recién revelado: el borde del barrido va delante y la barra aún no está.
  expect(await text(ui, /^▌$/, 'detail-five')).toBeDefined()
  expect(await text(ui, /42%$/, 'detail-five')).toBeUndefined()
  await ui.advance(80)
  // A medio barrido: ya se ve la etiqueta y el borde sigue avanzando.
  expect(await text(ui, /^5h $/, 'detail-five')).toBeDefined()
  expect(await text(ui, /^▌$/, 'detail-five')).toBeDefined()
  await ui.advance(400)
  // Construido: sin borde, la barra llena hasta el 42 % y el texto entero.
  expect(await text(ui, /^▌$/, 'detail-five')).toBeUndefined()
  expect(await text(ui, /^███████░{9} 42%$/, 'detail-five')).toBeDefined()
  expect(await text(ui, /^ · reinicia \d\d:\d\d · faltan 2h\dm/, 'detail-five')).toBeDefined()
  await ui.unmount()
})

test('el nombre del modelo brilla mientras Claude trabaja', async ($, on) => {
  answerSession(on, FULL)
  const ui = await mount($, { ...HINT, isWorking: true })

  await ui.advance(160)
  const letters = await ui.findAll({ type: 'Text', text: /^.$/, in: 'model-name' })
  expect(letters.some(l => l.props.color === '#e8ecf4')).toBe(true)
  expect(letters.some(l => l.props.color === '#c084fc')).toBe(true)
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

test('la marca no se pinta si tras la línea no queda sitio', async ($, on) => {
  answerSession(on, FULL)
  // La línea mide 49: a 51 columnas no caben la marca y su separación.
  const ui = await mountAt($, 51)
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
