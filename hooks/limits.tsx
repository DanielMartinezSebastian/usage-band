import type { On, Timer } from 'claude-code'

import { agentTurnEnded } from './agents'
import { readConfig, STORE_KEY } from './config'
import { PALETTE } from './palette'

// Avisos, protección y piloto automático.
//
// - Aviso: notificación del sistema al pasar de `alertAt` en la ventana de
//   5 h o en la semana, y «ya puedes seguir» cuando el límite se reinicia.
// - Protección: un aviso al enviar un prompt pasado `guardAt`, y compactar la
//   conversación al terminar un turno pasado `compactAt` de contexto.
// - Límite: al llegar al 100 %, una notificación y un diálogo para decidir si
//   encender el piloto automático; con él encendido, al reiniciarse el límite se
//   envía solo un prompt para seguir.
//
// La detección del límite va en el `session.measure` de register.tsx y el
// temporizador del reinicio en su render de la línea (cada evento admite un
// solo hook por mod); aquí, el estado compartido, el diálogo y el resto.

export const LIMIT_PANE = 'usage-band-limit'
export const PENDING_KEY = 'pending'
// Margen tras la hora de reinicio, para que el límite ya se haya levantado.
export const RESUME_DELAY_MS = 30_000
export const CONTINUE_TEXT = 'El límite de uso ya se ha reiniciado: continúa con la tarea donde la dejaste.'

export type Pending = { kind: string; at: number }

// Estado compartido entre los hooks de este mod.
export const limits = {
  // El límite alcanzado que espera a reiniciarse (también en `$.store`).
  pending: undefined as Pending | undefined,
  // El temporizador que salta al reiniciarse, y para qué hora está puesto.
  timer: undefined as { at: number; timer: Timer } | undefined,
  // Por ventana, el reinicio para el que ya se avisó o se detectó el límite:
  // un aviso por ventana y no uno por medición.
  alerted: new Map<string, number>(),
  hit: new Map<string, number>(),
}

export const windowLabel = (kind: string) => (kind === 'seven_day' ? 'la semana' : 'la ventana de 5 h')

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// «a las 19:20», o «el vie a las 23:23» si no es hoy.
export const whenText = (at: number) => {
  const d = new Date(at)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? `a las ${time}` : `el ${DAYS[d.getDay()]} a las ${time}`
}

export const leftText = (at: number) => {
  const m = Math.max(Math.round((at - Date.now()) / 60_000), 0)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export const isPending = (raw: unknown): raw is Pending =>
  raw !== null &&
  typeof raw === 'object' &&
  typeof (raw as Pending).kind === 'string' &&
  typeof (raw as Pending).at === 'number'

export const registerLimits = (on: On) => {
  // Protección al enviar: un aviso, sin frenar el prompt.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command) return next(e)
    const config = readConfig(await $.store.get(STORE_KEY))
    if (!config.guard) return next(e)
    const { rateLimits } = await $.session.usage()
    const worst = rateLimits
      .filter(w => (w.kind === 'five_hour' || w.kind === 'seven_day') && w.percentUsed >= config.guardAt)
      .sort((a, b) => b.percentUsed - a.percentUsed)[0]
    if (worst) {
      const at = worst.resetsAt ? ` Se reinicia ${whenText(Date.parse(worst.resetsAt))}.` : ''
      $.ui.toast(
        worst.percentUsed >= 100
          ? `Has llegado al límite de ${windowLabel(worst.kind)}.${at}`
          : `Vas al ${Math.round(worst.percentUsed)} % de ${windowLabel(worst.kind)}.${at}`,
      )
    }
    return next(e)
  })

  // Contexto: compactar al terminar un turno pasado el umbral.
  on('turn.complete', async ($, e, next) => {
    // Un subagente que acaba (agents.ts): la marca recupera su color.
    if (agentTurnEnded(e)) $.ui.invalidate('ui.render')
    const result = await next(e)
    if (e.agentId || e.reason !== 'answer') return result
    const config = readConfig(await $.store.get(STORE_KEY))
    const { context } = await $.session.usage()
    if (config.compact && (context.percent ?? 0) >= config.compactAt) {
      $.ui.toast(`Contexto al ${Math.round(context.percent ?? 0)} %: compactando la conversación`)
      // Fuera del turno que acaba: compactar se rechaza mientras corre uno.
      $.clock.after(500, () => void $.session.compact().catch(() => undefined))
    }
    return result
  })

  // El diálogo del límite: qué pasa y qué hacer con el piloto automático.
  on('ui.render', { component: 'Pane', requestId: LIMIT_PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const config = readConfig(await $.store.get(STORE_KEY))
    const pending = limits.pending

    const choose = async (autoContinue: boolean) => {
      await $.store.set(STORE_KEY, { ...config, autoContinue })
      $.ui.invalidate('ui.render')
      await $.ui.close({ id: LIMIT_PANE })
    }

    if (!pending) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color={PALETTE.ok}>No hay ningún límite alcanzado.</Text>
          <Button key="close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: LIMIT_PANE })}>
            Cerrar
          </Button>
        </Box>
      )
    }

    const when = whenText(pending.at)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={PALETTE.bad}>
          Has llegado al límite de {windowLabel(pending.kind)}.
        </Text>
        <Text>
          Se reinicia {when} <Text color={PALETTE.mut}>(faltan {leftText(pending.at)})</Text>
        </Text>
        <Text> </Text>
        <Text>
          Piloto automático:{' '}
          <Text color={config.autoContinue ? PALETTE.ok : PALETTE.mut}>
            {config.autoContinue ? '● encendido' : '○ apagado'}
          </Text>
        </Text>
        <Text color={PALETTE.mut}>
          Encendido, al reiniciarse enviará solo: «{CONTINUE_TEXT}»
        </Text>
        <Text> </Text>
        <Box flexDirection="row">
          <Button key="auto-on" hotkey="a" variant="primary" onPress={() => choose(true)}>
            Encender piloto: seguir {when}
          </Button>
          <Text> </Text>
          <Button key="auto-off" hotkey="n" onPress={() => choose(false)}>
            No, solo avísame
          </Button>
        </Box>
        <Text color={PALETTE.mut}>a encender piloto · n solo avisar · Esc cerrar · también con «piloto» en la línea</Text>
      </Box>
    )
  })
}
