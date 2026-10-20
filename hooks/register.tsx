import type { Register, RenderChildren, SessionRateLimit, Timer } from 'claude-code'

import { agentsRunning, registerAgents, resetAgents } from './agents'
import { branchState, branchText, readBranch, registerBranch } from './branch'
import { readConfig, STORE_KEY } from './config'
import type { Segment } from './config'
import type { DetailProps } from './detail-client'
import {
  CONTINUE_TEXT,
  isPending,
  LIMIT_PANE,
  limits,
  PENDING_KEY,
  registerLimits,
  RESUME_DELAY_MS,
  whenText,
  windowLabel,
} from './limits'
import { registerPanel } from './panel'
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
  warn: number,
  crit: number,
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
  return { key, label, pct: w.percentUsed, color: level(w.percentUsed, warn, crit), isLimit: true, resetsAt, details }
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
// lo mide una capa invisible que ocupa la fila entera (measure-client.tsx).
let measured: number | undefined

// El reloj rápido solo corre mientras alguna animación lo necesita.
let ticker: { ms: number; timer: Timer } | undefined

// El valor a mostrar de una métrica: sube contando cuando cambia (si
// `animate`).
const displayed = (m: Metric, now: number, animate: boolean) => {
  const prev = shown.get(m.key)
  shown.set(m.key, m.pct)
  if (!animate) {
    counting.delete(m.key)
    return { value: m.pct, isCounting: false }
  }
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
  // El comando /usage-band y su panel de configuración.
  registerPanel(on)
  // Avisos, protección y el diálogo del límite.
  registerLimits(on)
  // La rama git, junto a la marca.
  registerBranch(on)
  // Los subagentes en marcha, que colorean la marca.
  registerAgents(on)

  // turn.step es un evento en streaming: el hook es un generador que reenvía.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort != null) lastEffort = String(e.effort)
    return yield* next(e)
  })

  on('prompt.compose', ($, e, next) => {
    outputStyle = e.outputStyle?.name
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-band', description: 'Personaliza la línea de uso bajo el prompt' })
    ticker = undefined
    resetAgents()
    // Borra el aviso fijado bajo el prompt que dejó un diagnóstico anterior:
    // un $.ui.status se queda hasta que el mod lo quita.
    $.ui.status(undefined)
    // La cuenta atrás de las tarjetas avanza aunque no haya turnos.
    $.clock.every(60_000, () => {
      void readBranch(argv => $.process.run(argv)).finally(() => $.ui.invalidate('ui.render'))
    })
    // La rama se lee sin hacer esperar al arranque.
    void readBranch(argv => $.process.run(argv)).then(changed => changed && $.ui.invalidate('ui.render'))
    // Un límite alcanzado en una sesión anterior que aún espera su reinicio:
    // el render de la línea vuelve a poner su temporizador.
    const pending = await $.store.get(PENDING_KEY)
    limits.timer = undefined
    limits.pending = isPending(pending) ? pending : undefined
    return next(e)
  })

  on('ui.message', ($, e, next) => {
    const width = (e.data as { width?: unknown } | null)?.width
    if (e.element === 'measure' && typeof width === 'number') {
      if (width !== measured) {
        measured = width
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })

  // Cada medición: redibuja la línea y mira los límites. Pasado `alertAt`,
  // un aviso; al 100 %, una notificación y el diálogo para decidir si
  // encender el piloto automático. Una vez por ventana (por su hora de reinicio).
  on('session.measure', async ($, e, next) => {
    $.ui.invalidate('ui.render')
    if (!e.changed.includes('rateLimits')) return next(e)
    const config = readConfig(await $.store.get(STORE_KEY))
    for (const w of e.rateLimits) {
      if ((w.kind !== 'five_hour' && w.kind !== 'seven_day') || !w.resetsAt) continue
      const at = Date.parse(w.resetsAt)
      const label = windowLabel(w.kind)
      if (w.percentUsed >= 100) {
        if (limits.hit.get(w.kind) === at) continue
        limits.hit.set(w.kind, at)
        limits.pending = { kind: w.kind, at }
        await $.store.set(PENDING_KEY, limits.pending)
        if (config.alert) {
          void $.ui.notify(`Has llegado al límite de ${label}. Se reinicia ${whenText(at)}.`, { title: 'usage-band' })
        }
        await $.ui.open({ id: LIMIT_PANE, title: 'Límite alcanzado', focus: true, closeOnEscape: true })
      } else if (config.alert && w.percentUsed >= config.alertAt && limits.alerted.get(w.kind) !== at) {
        limits.alerted.set(w.kind, at)
        void $.ui.notify(`Llevas un ${Math.round(w.percentUsed)} % de ${label}. Se reinicia ${whenText(at)}.`, {
          title: 'usage-band',
        })
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [{ context, rateLimits, cost }, model, settings, version, saved] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.settings.read(),
      $.session.version(),
      $.store.get(STORE_KEY),
    ])
    // Lo personalizado con /usage-band.
    const config = readConfig(saved)
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
      !config.ctx || context.percent == null
        ? null
        : {
            key: 'ctx',
            label: 'ctx',
            pct: context.percent,
            color: level(context.percent, config.ctxWarn, config.ctxCrit),
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
    const { limitWarn, limitCrit } = config
    const fiveWindow = limitMetric('five', '5h', rateLimits.find(r => r.kind === 'five_hour'), false, limitWarn, limitCrit)
    const week = config.week
      ? limitMetric('week', 'wk', rateLimits.find(r => r.kind === 'seven_day'), true, limitWarn, limitCrit)
      : null

    // Ventana nueva: el reinicio que conocíamos ya pasó (la ventana se fue o
    // llegó otra con un reinicio posterior).
    if (lastFiveReset !== undefined && lastFiveReset <= now && fiveWindow?.resetsAt !== lastFiveReset) {
      flashUntil = now + FLASH_MS
    }
    lastFiveReset =
      fiveWindow?.resetsAt ?? (lastFiveReset !== undefined && lastFiveReset > now ? lastFiveReset : undefined)
    const five = config.five ? fiveWindow : null
    const isFlashing = config.five && config.countdown && now < flashUntil

    const metrics = [ctx, five, week].filter((m): m is Metric => m !== null)
    const values = new Map(metrics.map(m => [m.key, displayed(m, now, config.count)]))
    const isPulsing = config.pulse && metrics.some(m => m.isLimit && m.pct >= limitCrit)
    const isPulseDim = isPulsing && Math.floor(now / PULSE_MS) % 2 === 1
    // Con el límite alcanzado y el piloto encendido, su «on» parpadea: está
    // esperando al reinicio para seguir solo.
    const isPilotWaiting = config.autoContinue && limits.pending !== undefined
    const isPilotDim = isPilotWaiting && Math.floor(now / PULSE_MS) % 2 === 1
    // Con el límite alcanzado y el piloto apagado, su «off» se queda en rojo
    // (sin parpadear), para recordar que se puede encender.
    const pilotColor = config.autoContinue ? PALETTE.ok : limits.pending ? PALETTE.bad : PALETTE.mut
    const fiveLeft = five?.resetsAt !== undefined ? five.resetsAt - now : undefined
    const isCountdown = config.countdown && fiveLeft !== undefined && fiveLeft > 0 && fiveLeft <= COUNTDOWN_MS
    const isCounting = [...values.values()].some(v => v.isCounting)

    // El temporizador del límite: salta al reiniciarse (con un margen), avisa
    // de que se puede seguir y, con el piloto automático, envía el prompt.
    const pending = limits.pending
    if (!pending) {
      limits.timer?.timer.cancel()
      limits.timer = undefined
    } else if (limits.timer?.at !== pending.at) {
      limits.timer?.timer.cancel()
      limits.timer = {
        at: pending.at,
        timer: $.clock.after(Math.max(pending.at - now, 0) + RESUME_DELAY_MS, async () => {
          const latest = readConfig(await $.store.get(STORE_KEY))
          limits.pending = undefined
          limits.timer = undefined
          await $.store.delete(PENDING_KEY)
          await $.ui.close({ id: LIMIT_PANE })
          if (latest.alert || latest.autoContinue) {
            const what = latest.autoContinue ? ': sigo con la tarea.' : '.'
            void $.ui.notify(`Ya puedes seguir: ${windowLabel(pending.kind)} se ha reiniciado${what}`, {
              title: 'usage-band',
            })
          }
          if (latest.autoContinue) await $.prompt.submit({ text: CONTINUE_TEXT })
          $.ui.invalidate('ui.render')
        }),
      }
    }

    // El reloj más lento que aún mueve todas las animaciones en curso.
    const tickMs = isCounting
      ? 100
      : isPulsing || isPilotWaiting
        ? PULSE_MS
        : isCountdown || isFlashing
          ? 1000
          : undefined
    if (ticker?.ms !== tickMs) {
      ticker?.timer.cancel()
      ticker = tickMs === undefined ? undefined : { ms: tickMs, timer: $.clock.every(tickMs, () => $.ui.invalidate('ui.render')) }
    }

    // Client solo existe en la terminal y el escritorio, las superficies que
    // dibujan esta línea.
    if (e.surface === 'vscode' || e.surface === 'mobile') return next(e)
    const { Box, Text, Client, Button } = $.ui.resolve(e)
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
      if (!config.fiveReset) return null
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
    // El interruptor del piloto automático: un bucle encendido, una señal de
    // prohibido apagado.
    const AUTO = config.autoContinue ? '⟳ on' : '⊘ off'
    type Layout = { name?: string; ctx: boolean; cost: boolean; week: boolean; auto: boolean }
    // Lo que se quitó en /usage-band no está en ningún nivel.
    const layouts: Layout[] = (
      [
        { name: fullName, ctx: true, cost: true, week: true, auto: true },
        { name: fullName, ctx: true, cost: false, week: true, auto: true },
        { name: shortName, ctx: true, cost: false, week: true, auto: false },
        { name: shortName, ctx: true, cost: false, week: false, auto: false },
        { name: shortName, ctx: false, cost: false, week: false, auto: false },
        { ctx: false, cost: false, week: false, auto: false },
      ] as Layout[]
    ).map(l => ({
      ...l,
      name: config.model ? l.name : undefined,
      cost: l.cost && config.cost,
      auto: l.auto && config.auto,
    }))
    const metricWidth = (m: Metric) => m.label.length + 1 + pctText(m).length + (inline(m)?.text.length ?? 0)

    // Los tramos de la línea, en el orden elegido en /usage-band, con su ancho;
    // la métrica, si lo es. El interruptor del piloto automático va pegado
    // tras la ventana de 5 h (`glued`: sin separador delante, solo un espacio).
    type LinePiece = { key: string; width: number; metric?: Metric; glued?: boolean }
    const pieceOf = (segment: Segment, l: Layout): LinePiece[] => {
      if (segment === 'model') return l.name !== undefined ? [{ key: 'model', width: [...l.name].length }] : []
      if (segment === 'ctx') return l.ctx && ctx ? [{ key: 'ctx', width: metricWidth(ctx), metric: ctx }] : []
      if (segment === 'cost') return l.cost ? [{ key: 'cost', width: costText.length }] : []
      if (segment === 'week') return l.week && week ? [{ key: 'week', width: metricWidth(week), metric: week }] : []
      const auto = l.auto ? [{ key: 'auto', width: 1 + AUTO.length, glued: true }] : []
      if (five) return [{ key: 'five', width: metricWidth(five), metric: five }, ...auto]
      return isFlashing ? [{ key: 'flash', width: '5h ventana nueva'.length }, ...auto] : []
    }
    const pieces = (l: Layout): LinePiece[] => config.order.flatMap(segment => pieceOf(segment, l))
    const lineWidth = (l: Layout) =>
      pieces(l).reduce((n, p, i) => n + p.width + (i > 0 && !p.glued ? SEP : 0), 0)
    const layout =
      columns === undefined ? layouts[0]! : (layouts.find(l => lineWidth(l) <= columns) ?? layouts[layouts.length - 1]!)
    // La marca ocupa las últimas columnas si tras la línea queda sitio.
    const BRAND = 3
    // Con subagentes en marcha, los corchetes de la marca cambian de color.
    const hasAgents = agentsRunning() > 0
    const hasBrand = config.brand && columns !== undefined && columns - lineWidth(layout) >= BRAND + 1
    // La rama, a la izquierda de la marca (o al final, sin ella), si también
    // cabe; si no, la marca se queda sola.
    const branch = branchState.name !== undefined ? branchText(branchState.name) : undefined
    const branchWidth = branch !== undefined ? [...branch].length : 0
    const hasBranch =
      branch !== undefined &&
      columns !== undefined &&
      columns - lineWidth(layout) >= branchWidth + 1 + (hasBrand ? BRAND + 1 : 0)
    // Lo que ocupa el final de la fila: rama y marca, con un espacio entre ellas.
    const tail = (hasBrand ? BRAND : 0) + (hasBranch ? branchWidth + (hasBrand ? 1 : 0) : 0)

    // Columna donde empieza la etiqueta de cada métrica visible: el detalle se
    // abre ahí, hacia la derecha.
    const labelAt = new Map<string, number>()
    let x = 0
    pieces(layout).forEach((p, i) => {
      if (i > 0 && !p.glued) x += SEP
      labelAt.set(p.metric?.key ?? p.key, x)
      x += p.width
    })

    // Cada métrica forma un grupo de hover (`scope`) con su detalle: una capa
    // de una fila, absoluta, que empieza en la etiqueta de la métrica y cubre
    // hasta el final mientras el puntero está sobre la métrica o sobre la
    // propia capa. La línea es el único espacio que el motor deja dibujar
    // aquí, así que nada sale de ella.
    const segment = (m: Metric, isFirst: boolean) => {
      const v = values.get(m.key)!
      const isAlarm = m.isLimit && m.pct >= limitCrit
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

    // Sin color de fondo: la capa tapa lo de debajo pintando cada celda (el
    // Client del detalle rellena con espacios hasta el final de la fila).
    // Los detalles acaban antes de la rama y la marca (y su separación), que
    // siempre se ven.
    const detailEnd = columns !== undefined && tail > 0 ? columns - tail - 1 : columns
    const overlayWidth = (left: number) => (detailEnd !== undefined ? Math.max(detailEnd - left, 1) : undefined)

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
      if (detailEnd === undefined) {
        const l = levels[0]!
        return { left: at, cells: l.cells, mode: 'text', text: joined(parts, l.v) }
      }
      for (const l of levels) {
        if (width(l) <= detailEnd - at) return { left: at, cells: l.cells, mode: 'text', text: joined(parts, l.v) }
      }
      for (const l of levels) {
        if (width(l) <= detailEnd) {
          return { left: detailEnd - width(l), cells: l.cells, mode: 'text', text: joined(parts, l.v) }
        }
      }
      const shorts = parts.map(p => p[2])
      const longest = Math.max(0, ...shorts.map(t => t.length))
      return { left: Math.max(0, Math.min(at, detailEnd - (head + 3 + longest))), cells: 0, mode: 'rotate', parts: shorts }
    }

    // Lo que muestra un detalle tras su etiqueta según su plan: el texto
    // entero, o sus datos por turnos si no cabe.
    const restProps = (p: Plan) => (p.mode === 'rotate' ? { parts: p.parts } : { text: p.text })

    // Cada detalle son dos capas en el mismo sitio, dibujadas por el mismo
    // Client: la del hover, que se construye al revelarse, y la de salida,
    // siempre visible y vacía, que lo retira de derecha a izquierda cuando el
    // hover lo oculta. Todas las de salida van antes que todas las del hover,
    // para que un detalle abierto quede siempre por encima.
    type Layer = { key: string; left: number; props: Omit<DetailProps, 'id' | 'role' | 'animate'> }

    const exitLayer = (l: Layer) => (
      <Box position="absolute" top={0} left={l.left} width={overlayWidth(l.left) ?? '100%'}>
        <Client
          key={`exit-${l.key}`}
          module="./detail-client.tsx"
          width="100%"
          props={{ ...l.props, id: l.key, role: 'exit', animate: config.wipe }}
        />
      </Box>
    )

    // El detalle repite la etiqueta donde estaba, así la vista no tiene que
    // buscar dónde empieza.
    const hoverLayer = (l: Layer) =>
      overlay(l.key, l.left, [
        <Client key={`detail-${l.key}`} module="./detail-client.tsx" width="100%" props={{ ...l.props, id: l.key, animate: config.wipe }} />,
      ])

    const metricLayer = (m: Metric): Layer => {
      const head = m.label.length + 1 + `${r1(m.pct)}%`.length
      const p = plan(labelAt.get(m.key) ?? 0, head, m.details, true)
      return {
        key: m.key,
        left: p.left,
        props: { label: m.label, labelColor: PALETTE.acc, pct: m.pct, color: m.color, cells: p.cells, ...restProps(p) },
      }
    }

    const modelPlan = plan(labelAt.get('model') ?? 0, [...fullName].length, modelDetails, false)
    const layers: Layer[] = [
      ...metrics.filter(m => labelAt.has(m.key)).map(metricLayer),
      ...(layout.name !== undefined
        ? [{ key: 'model', left: modelPlan.left, props: { label: fullName, labelColor: PALETTE.acc2, ...restProps(modelPlan) } }]
        : []),
    ]

    // El interruptor del piloto automático: un clic lo enciende o lo apaga.
    const toggleAuto = async () => {
      await $.store.set(STORE_KEY, { ...config, autoContinue: !config.autoContinue })
      $.ui.toast(
        config.autoContinue ? 'Piloto automático apagado' : 'Piloto automático encendido: seguirá solo al reiniciarse el límite',
      )
      $.ui.invalidate('ui.render')
    }

    // Cada tramo de la línea; `isFirst` no lleva separador delante.
    const draw = (p: LinePiece, isFirst: boolean) => {
      if (p.metric) return segment(p.metric, isFirst)
      const lead = isFirst ? null : sep
      if (p.key === 'model') {
        return (
          <Box hover={{ scope: 'model' }} flexShrink={0}>
            {lead}
            <Client
              key="model-name"
              module="./shimmer-client.tsx"
              props={{ text: layout.name ?? '', color: PALETTE.acc2, isWorking: config.shimmer && e.props.isWorking }}
            />
          </Box>
        )
      }
      if (p.key === 'cost') {
        return (
          <Text>
            {lead}
            <Text color={PALETTE.fg}>{costText}</Text>
          </Text>
        )
      }
      if (p.key === 'flash') {
        return (
          <Text>
            {lead}
            <Text bold color={PALETTE.ok}>5h ventana nueva</Text>
          </Text>
        )
      }
      return (
        <Box flexDirection="row" flexShrink={0}>
          <Text> </Text>
          <Button key="auto" plain onPress={toggleAuto}>
            <Text color={pilotColor} bold={isPilotWaiting} dimColor={isPilotDim}>
              {AUTO}
            </Text>
          </Button>
        </Box>
      )
    }

    return (
      <Box key="usage" flexDirection="row" width="100%" height={1} overflow="hidden">
        {/* Capa invisible de toda la fila que mide su ancho real. */}
        <Box position="absolute" top={0} left={0} width="100%">
          <Client key="measure" module="./measure-client.tsx" props={null} width="100%" />
        </Box>
        {pieces(layout).map((p, i) => draw(p, i === 0))}
        {layers.map(exitLayer)}
        {layers.map(hoverLayer)}
        {hasBranch ? (
          <Box key="branch" position="absolute" top={0} left={columns! - tail} width={branchWidth}>
            <Text>
              <Text color={PALETTE.mut}>{branch!.slice(0, 2)}</Text>
              <Text color={PALETTE.fg}>{branch!.slice(2)}</Text>
            </Text>
          </Box>
        ) : null}
        {hasBrand ? (
          // La marca, en las últimas columnas y al final del árbol para que
          // ningún detalle ni barrido la tape: gira mientras Claude trabaja;
          // encima, una copia oculta que el hover revela y que gira mientras
          // se ve, para que también gire al pasar el ratón.
          <Box position="absolute" top={0} left={columns! - BRAND} width={BRAND} hover={{ scope: 'brand' }}>
            <Client key="brand" module="./brand-client.tsx" props={{ spin: config.spin && e.props.isWorking, agents: config.spin && hasAgents }} />
            <Box display="none" hover={{ display: 'flex', scope: 'brand' }} position="absolute" top={0} left={0}>
              <Client key="brand-hover" module="./brand-client.tsx" props={{ spin: config.spin, agents: config.spin && hasAgents }} />
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })
}
