import type { Register, RenderChildren, SessionRateLimit, Timer } from 'claude-code'

import { PALETTE } from './palette'

// Línea mínima bajo el prompt (modelo · ctx · coste · 5h · wk). Cada métrica
// tiene su propio hover: una capa de una fila, absoluta y opaca, con el
// detalle, para no desplazar nada.
//
// Animaciones (por tiempo o por evento; el hover no avisa al mod):
// - un porcentaje que cambia sube contando hasta el nuevo valor;
// - un límite al 90 % o más pulsa entre rojo y rojo tenue;
// - en los últimos 10 min de la ventana de 5 h la hora pasa a cuenta atrás,
//   y al reiniciarse la ventana destella "ventana nueva".

const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const BAR = 16
const COUNT_MS = 600
const PULSE_MS = 500
const COUNTDOWN_MS = 10 * 60_000
const FLASH_MS = 4000

const pad = (n: number) => String(n).padStart(2, '0')

const r1 = (n: number) => Math.round(n * 10) / 10

const clockTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

const timeLeft = (d: Date) => {
  const s = Math.floor((d.getTime() - Date.now()) / 1000)
  if (s <= 0) return 'ya'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600)}h`
}

// 9:42 hasta el reinicio.
const countdown = (ms: number) => {
  const s = Math.max(Math.ceil(ms / 1000), 0)
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

const level = (pct: number, warn: number, crit: number) =>
  pct >= crit ? PALETTE.bad : pct >= warn ? PALETTE.warn : PALETTE.ok

const bar = (pct: number) => {
  const filled = Math.round((Math.min(pct, 100) / 100) * BAR)
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}

const tokens = (n: number) => (n >= 1_000_000 ? `${r1(n / 1_000_000)}M` : `${Math.round(n / 1000)}k`)

// "claude-opus-5-5" -> "Opus 5.5"
const modelName = (id: string) => {
  const parts = id.replace(/^claude-/, '').replace(/\[.*\]$/, '').split('-')
  const name = parts.filter(p => !/^\d+$/.test(p))
  const version = parts.filter(p => /^\d+$/.test(p) && p.length < 3)
  if (name.length === 0) return id
  const label = name.map(p => p[0]!.toUpperCase() + p.slice(1)).join(' ')
  return version.length ? `${label} ${version.join('.')}` : label
}

// Una métrica de la línea: su etiqueta, su porcentaje, cuándo reinicia (si es
// un límite) y las partes de su detalle.
// Un dato del detalle en tres versiones, de larga a corta.
type Part = [long: string, medium: string, short: string]

const part = (long: string, medium = long, short = medium): Part => [long, medium, short]

type Metric = {
  key: string
  label: string
  pct: number
  color: string
  isLimit: boolean
  resetsAt?: number
  // Ordenados por importancia: lo que se recorta es siempre lo último.
  details: Part[]
}

const limitMetric = (
  key: string,
  label: string,
  w: SessionRateLimit | undefined,
  withDay: boolean,
): Metric | null => {
  if (!w) return null
  const details: Part[] = []
  let resetsAt: number | undefined
  if (w.resetsAt) {
    const d = new Date(w.resetsAt)
    resetsAt = d.getTime()
    const when = `${withDay ? `${DAYS[d.getDay()]} ` : ''}${clockTime(d)}`
    const left = timeLeft(d)
    details.push(part(`reinicia ${when}`, when), part(`faltan ${left}`, `faltan ${left}`, left))
  }
  const free = `${r1(100 - w.percentUsed)}% libre`
  details.push(part(`${r1(w.percentUsed)}% usado · ${free}`, free))
  return { key, label, pct: w.percentUsed, color: level(w.percentUsed, 70, 90), isLimit: true, resetsAt, details }
}

// Lo que el motor solo cuenta al trabajar: el esfuerzo de la última petición
// del hilo principal (sigue a /effort) y el estilo de salida del prompt.
// Se pierde al recargar el mod y vuelve con el siguiente turno.
let lastEffort: string | undefined
let outputStyle: string | undefined

// Estado de las animaciones, por métrica.
const shown = new Map<string, number>()
const counting = new Map<string, { from: number; to: number; start: number }>()
let lastFiveReset: number | undefined
let flashUntil = 0

// El ancho real de la fila. Claude Code pinta delante su propio indicador
// (`⏵⏵ auto mode on`, que cambia con el modo) y no dice cuánto mide, así que
// lo mide la marca, una capa que ocupa la fila entera.
let measured: number | undefined

// La marca martinezsebastian al final de la línea (brand-client.tsx), en
// pausa: la capa sigue midiendo el ancho real, pero no se pinta.
const SHOW_BRAND = false

// El reloj rápido solo corre mientras alguna animación lo necesita.
let ticker: { ms: number; timer: Timer } | undefined

// El valor a mostrar de una métrica: sube contando cuando cambia.
const displayed = (m: Metric, now: number) => {
  const prev = shown.get(m.key)
  shown.set(m.key, m.pct)
  if (prev !== undefined && prev !== m.pct) {
    const running = counting.get(m.key)
    const from = running ? running.from + (running.to - running.from) * Math.min((now - running.start) / COUNT_MS, 1) : prev
    counting.set(m.key, { from, to: m.pct, start: now })
  }
  const anim = counting.get(m.key)
  if (!anim) return { value: m.pct, isCounting: false }
  const t = (now - anim.start) / COUNT_MS
  if (t >= 1) {
    counting.delete(m.key)
    return { value: m.pct, isCounting: false }
  }
  const eased = 1 - (1 - t) ** 3
  return { value: anim.from + (anim.to - anim.from) * eased, isCounting: true }
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

export const register: Register = on => {
  // turn.step es un evento en streaming: el hook es un generador que reenvía.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort != null) lastEffort = String(e.effort)
    return yield* next(e)
  })

  on('prompt.compose', ($, e, next) => {
    outputStyle = e.outputStyle?.name
    return next(e)
  })

  on('session.start', ($, e, next) => {
    ticker = undefined
    // Borra el aviso fijado bajo el prompt que dejó un diagnóstico anterior:
    // un $.ui.status se queda hasta que el mod lo quita.
    $.ui.status(undefined)
    // La cuenta atrás de las tarjetas avanza aunque no haya turnos.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('ui.message', ($, e, next) => {
    const width = (e.data as { width?: unknown } | null)?.width
    if (e.element === 'brand' && typeof width === 'number') {
      if (width !== measured) {
        measured = width
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [{ context, rateLimits, cost }, model, settings, version] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.settings.read(),
      $.session.version(),
    ])
    const now = Date.now()

    // Detalle del modelo: con qué está configurada la sesión.
    const alias = str(settings.model)
    const effort = lastEffort ?? str(settings.effortLevel)
    // Ordenado por importancia: lo que se recorta es siempre lo último.
    const modelDetails = [
      part(`esfuerzo ${effort ?? 'por defecto'}`, `esf. ${effort ?? 'def.'}`),
      part(`ventana ${tokens(context.window)}`, tokens(context.window)),
      part(`estilo ${outputStyle ?? str(settings.outputStyle) ?? 'default'}`),
      settings.alwaysThinkingEnabled === true ? part('thinking siempre', 'thinking') : undefined,
      settings.fastMode === true ? part('fast mode', 'fast') : undefined,
      part(model),
      alias && alias !== model ? part(`ajuste "${alias}"`) : undefined,
      part(`Claude Code ${version.version}`, `v${version.version}`),
    ].filter((d): d is Part => d !== undefined)

    const ctx: Metric | null =
      context.percent == null
        ? null
        : {
            key: 'ctx',
            label: 'ctx',
            pct: context.percent,
            color: level(context.percent, 50, 80),
            isLimit: false,
            details: [
              part(
                `${tokens(Math.max(context.window - (context.tokens ?? 0), 0))} libres (${r1(100 - context.percent)}%)`,
                `${tokens(Math.max(context.window - (context.tokens ?? 0), 0))} libres`,
              ),
              part(
                `${tokens(context.tokens ?? 0)} usados de ${tokens(context.window)}`,
                `${tokens(context.tokens ?? 0)}/${tokens(context.window)}`,
              ),
            ],
          }
    const five = limitMetric('five', '5h', rateLimits.find(r => r.kind === 'five_hour'), false)
    const week = limitMetric('week', 'wk', rateLimits.find(r => r.kind === 'seven_day'), true)

    // Ventana nueva: el reinicio que conocíamos ya pasó (la ventana se fue o
    // llegó otra con un reinicio posterior).
    if (lastFiveReset !== undefined && lastFiveReset <= now && five?.resetsAt !== lastFiveReset) {
      flashUntil = now + FLASH_MS
    }
    lastFiveReset = five?.resetsAt ?? (lastFiveReset !== undefined && lastFiveReset > now ? lastFiveReset : undefined)
    const isFlashing = now < flashUntil

    const metrics = [ctx, five, week].filter((m): m is Metric => m !== null)
    const values = new Map(metrics.map(m => [m.key, displayed(m, now)]))
    const isPulsing = metrics.some(m => m.isLimit && m.pct >= 90)
    const isPulseDim = isPulsing && Math.floor(now / PULSE_MS) % 2 === 1
    const fiveLeft = five?.resetsAt !== undefined ? five.resetsAt - now : undefined
    const isCountdown = fiveLeft !== undefined && fiveLeft > 0 && fiveLeft <= COUNTDOWN_MS
    const isCounting = [...values.values()].some(v => v.isCounting)

    // El reloj más lento que aún mueve todas las animaciones en curso.
    const tickMs = isCounting ? 100 : isPulsing ? PULSE_MS : isCountdown || isFlashing ? 1000 : undefined
    if (ticker?.ms !== tickMs) {
      ticker?.timer.cancel()
      ticker = tickMs === undefined ? undefined : { ms: tickMs, timer: $.clock.every(tickMs, () => $.ui.invalidate('ui.render')) }
    }

    // Client solo existe en la terminal y el escritorio, las superficies que
    // dibujan esta línea.
    if (e.surface === 'vscode' || e.surface === 'mobile') return next(e)
    const { Box, Text, Client } = $.ui.resolve(e)
    // El ancho de la fila: el medido si lo hay (descuenta el indicador de
    // Claude Code), si no el de la terminal.
    const columns = e.viewport ? Math.min(measured ?? e.viewport.columns, e.viewport.columns) : undefined
    const SEP = 3
    const sep = <Text color={PALETTE.mut}> · </Text>

    // Lo que acompaña al 5h en la línea: la hora de reinicio, la cuenta atrás
    // o el aviso de ventana nueva.
    const inline = (m: Metric): { text: string; color: string; bold?: boolean } | null => {
      if (m.key !== 'five') return null
      if (isFlashing) return { text: ' ventana nueva', color: PALETTE.ok, bold: true }
      if (m.resetsAt === undefined) return null
      if (isCountdown) return { text: ` ${countdown(m.resetsAt - now)}`, color: PALETTE.warn }
      return { text: ` ${clockTime(new Date(m.resetsAt))}`, color: PALETTE.mut }
    }

    const pctText = (m: Metric) => {
      const v = values.get(m.key)!
      return `${v.isCounting ? Math.round(v.value) : r1(m.pct)}%`
    }

    // Responsive: si la línea no cabe, se va recortando por orden de
    // importancia hasta que quepa; la ventana de 5 h y su hora siempre quedan.
    // 1. sin coste · 2. modelo sin versión · 3. sin semana · 4. sin contexto
    // 5. sin modelo.
    const fullName = modelName(model)
    const shortName = fullName.split(' ')[0] ?? fullName
    const costText = `$${r1(cost?.usd ?? 0)}`
    type Layout = { name?: string; ctx: boolean; cost: boolean; week: boolean }
    const layouts: Layout[] = [
      { name: fullName, ctx: true, cost: true, week: true },
      { name: fullName, ctx: true, cost: false, week: true },
      { name: shortName, ctx: true, cost: false, week: true },
      { name: shortName, ctx: true, cost: false, week: false },
      { name: shortName, ctx: false, cost: false, week: false },
      { ctx: false, cost: false, week: false },
    ]
    const metricWidth = (m: Metric) => m.label.length + 1 + pctText(m).length + (inline(m)?.text.length ?? 0)
    // Los tramos de la línea en orden, con su ancho; la métrica, si lo es.
    const pieces = (l: Layout) =>
      [
        l.name !== undefined ? { width: [...l.name].length } : null,
        l.ctx && ctx ? { width: metricWidth(ctx), metric: ctx } : null,
        l.cost ? { width: costText.length } : null,
        five ? { width: metricWidth(five), metric: five } : null,
        isFlashing && !five ? { width: '5h ventana nueva'.length } : null,
        l.week && week ? { width: metricWidth(week), metric: week } : null,
      ].filter((p): p is { width: number; metric?: Metric } => p !== null)
    const lineWidth = (l: Layout) => {
      const ps = pieces(l)
      return ps.reduce((n, p) => n + p.width, 0) + SEP * Math.max(ps.length - 1, 0)
    }
    const layout =
      columns === undefined ? layouts[0]! : (layouts.find(l => lineWidth(l) <= columns) ?? layouts[layouts.length - 1]!)
    // Columna donde empieza la etiqueta de cada métrica visible: el detalle se
    // abre ahí, hacia la derecha.
    const labelAt = new Map<string, number>()
    let x = 0
    pieces(layout).forEach((p, i) => {
      if (i > 0) x += SEP
      if (p.metric) labelAt.set(p.metric.key, x)
      x += p.width
    })

    // Cada métrica forma un grupo de hover (`scope`) con su detalle: una capa
    // de una fila, absoluta, que empieza en la etiqueta de la métrica y cubre
    // hasta el final mientras el puntero está sobre la métrica o sobre la
    // propia capa. La línea es el único espacio que el motor deja dibujar
    // aquí, así que nada sale de ella.
    const segment = (m: Metric, isFirst: boolean) => {
      const v = values.get(m.key)!
      const isAlarm = m.isLimit && m.pct >= 90
      const extra = inline(m)
      return (
        <Box flexDirection="row" flexShrink={0} hover={{ scope: m.key }}>
          {isFirst ? null : sep}
          <Text bold color={PALETTE.acc}>{m.label} </Text>
          <Text color={m.color} bold={v.isCounting} dimColor={isAlarm && isPulseDim}>
            {pctText(m)}
          </Text>
          {extra ? (
            <Text color={extra.color} bold={extra.bold}>
              {extra.text}
            </Text>
          ) : null}
        </Box>
      )
    }

    // Sin color de fondo: la capa tapa lo de debajo pintando cada celda, con
    // el texto rellenado de espacios hasta el final de la fila.
    const overlayWidth = (left: number) => (columns !== undefined ? Math.max(columns - left, 1) : undefined)
    const fill = (text: string, left: number, used: number) => {
      const width = overlayWidth(left)
      return width === undefined ? text : text.padEnd(Math.max(width - used, 0))
    }

    const overlay = (scope: string, left: number, children: RenderChildren[]) => (
      <Box
        display="none"
        hover={{ display: 'flex', scope }}
        position="absolute"
        top={0}
        left={left}
        width={overlayWidth(left) ?? '100%'}
        flexDirection="row"
        overflow="hidden"
      >
        {children}
      </Box>
    )

    // Cómo se ajusta un detalle a la fila, de más rico a más compacto: barra
    // de 16 con textos largos, textos medios, barra de 8 con textos cortos,
    // sin barra. Primero se prueba abierto desde su etiqueta; si no cabe, más
    // a la izquierda; si ni así, sus datos rotan de uno en uno.
    const LEVELS = [
      { cells: 16, v: 0 },
      { cells: 16, v: 1 },
      { cells: 8, v: 2 },
      { cells: 0, v: 2 },
    ] as const
    // Sin barra (el modelo): solo los textos, de largos a cortos.
    const TEXT_LEVELS = [
      { cells: 0, v: 0 },
      { cells: 0, v: 1 },
      { cells: 0, v: 2 },
    ] as const
    type Level = { cells: number; v: number }
    type Plan =
      | { left: number; cells: number; mode: 'text'; text: string }
      | { left: number; cells: number; mode: 'rotate'; parts: string[] }

    const joined = (parts: Part[], v: number) => parts.map(p => p[v]!).join(' · ')

    // `head`: lo que va antes del texto (etiqueta y porcentaje, o el nombre);
    // `bars`: si lleva barra.
    const plan = (at: number, head: number, parts: Part[], bars: boolean): Plan => {
      const levels: readonly Level[] = bars ? LEVELS : TEXT_LEVELS
      const width = (l: Level) =>
        head + (l.cells > 0 ? l.cells + 1 : 0) + 3 + joined(parts, l.v).length
      if (columns === undefined) {
        const l = levels[0]!
        return { left: at, cells: l.cells, mode: 'text', text: joined(parts, l.v) }
      }
      for (const l of levels) {
        if (width(l) <= columns - at) return { left: at, cells: l.cells, mode: 'text', text: joined(parts, l.v) }
      }
      for (const l of levels) {
        if (width(l) <= columns) {
          return { left: columns - width(l), cells: l.cells, mode: 'text', text: joined(parts, l.v) }
        }
      }
      const shorts = parts.map(p => p[2])
      const longest = Math.max(0, ...shorts.map(t => t.length))
      return { left: Math.max(0, Math.min(at, columns - (head + 3 + longest))), cells: 0, mode: 'rotate', parts: shorts }
    }

    // El texto del detalle: fijo, o rotando si no cabe entero.
    const rest = (key: string, p: Plan, used: number) =>
      p.mode === 'rotate' ? (
        <Client
          key={`rotate-${key}`}
          module="./rotate-client.tsx"
          props={{ parts: p.parts, pad: Math.max((overlayWidth(p.left) ?? 0) - used, 0) }}
        />
      ) : (
        <Text color={PALETTE.mut} wrap="truncate-end">
          {fill(` · ${p.text}`, p.left, used)}
        </Text>
      )

    // El detalle repite la etiqueta donde estaba, así la vista no tiene que
    // buscar dónde empieza. La barra es un Client: se llena al revelarse.
    const detail = (m: Metric) => {
      const pct = `${r1(m.pct)}%`.length
      const head = m.label.length + 1 + pct
      const p = plan(labelAt.get(m.key) ?? 0, head, m.details, true)
      const used = head + (p.cells > 0 ? p.cells + 1 : 0)
      return overlay(m.key, p.left, [
        <Text bold color={PALETTE.acc}>{m.label} </Text>,
        <Client key={`bar-${m.key}`} module="./bar-client.tsx" props={{ pct: m.pct, color: m.color, cells: p.cells }} />,
        rest(m.key, p, used),
      ])
    }

    const visible = metrics.filter(m => labelAt.has(m.key))
    const modelPlan = plan(0, [...fullName].length, modelDetails, false)
    const modelDetail =
      layout.name !== undefined
        ? overlay('model', modelPlan.left, [
            <Text bold color={PALETTE.acc2}>{fullName}</Text>,
            rest('model', modelPlan, [...fullName].length),
          ])
        : null

    // Si cada tramo es el primero de la línea (sin separador delante).
    let isFirst = true
    const lead = () => {
      const wasFirst = isFirst
      isFirst = false
      return wasFirst
    }

    return (
      <Box key="usage" flexDirection="row" width="100%" height={1} overflow="hidden">
        {/* La marca: una capa de toda la fila, debajo de lo demás, que mide el
            ancho real y, si SHOW_BRAND, se pinta a la derecha si queda sitio. */}
        <Box position="absolute" top={0} left={0} width="100%">
          <Client
            key="brand"
            module="./brand-client.tsx"
            props={{ isWorking: e.props.isWorking, lineWidth: lineWidth(layout), show: SHOW_BRAND }}
            width="100%"
          />
        </Box>
        {layout.name !== undefined && lead() ? (
          <Box hover={{ scope: 'model' }} flexShrink={0}>
            <Client
              key="model-name"
              module="./shimmer-client.tsx"
              props={{ text: layout.name, color: PALETTE.acc2, isWorking: e.props.isWorking }}
            />
          </Box>
        ) : null}
        {layout.ctx && ctx ? segment(ctx, lead()) : null}
        {layout.cost ? (
          <Text>
            {lead() ? null : sep}
            <Text color={PALETTE.fg}>{costText}</Text>
          </Text>
        ) : null}
        {five ? segment(five, lead()) : null}
        {isFlashing && !five ? (
          <Text>
            {lead() ? null : sep}
            <Text bold color={PALETTE.ok}>5h ventana nueva</Text>
          </Text>
        ) : null}
        {layout.week && week ? segment(week, lead()) : null}
        {visible.map(detail)}
        {modelDetail}
      </Box>
    )
  })
}
