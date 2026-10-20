import type { On } from 'claude-code'

// Los subagentes que corren ahora: cada turno de un agente (`agentId`) cuenta
// desde su `turn.start` hasta su `turn.complete`, que llega también si se
// interrumpe. Con alguno en marcha, los corchetes de la marca cambian de color.

const running = new Set<string>()

export const agentsRunning = () => running.size

export const resetAgents = () => running.clear()

// El fin del turno de un agente. Lo llama el único hook de `turn.complete` del
// mod (limits.tsx): el motor no deja registrar dos sin matcher. `true` si ya no
// queda ninguno y hay que redibujar.
export const agentTurnEnded = (e: { turnId: string; agentId?: string }) =>
  e.agentId !== undefined && running.delete(e.turnId) && running.size === 0

export const registerAgents = (on: On) => {
  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId && !running.has(e.turnId)) {
      running.add(e.turnId)
      if (running.size === 1) $.ui.invalidate('ui.render')
    }
    return result
  })
}
