import type { On } from 'claude-code'

// La rama git del directorio donde corre la sesión, a la izquierda de la marca.
// No hay dato de la sesión para ella, así que se pregunta a git: al empezar,
// tras cada Bash (un checkout), al cambiar de directorio (un worktree), al
// acabar cada turno y cada minuto (lo cambiado desde fuera de Claude).
// Fuera de un repo, o sin git, no hay rama y no se pinta.

export const branchState: { name: string | undefined } = { name: undefined }

// Una rama larga se corta por la derecha con «…».
export const BRANCH_MAX = 24
export const branchText = (name: string) =>
  `⎇ ${[...name].length > BRANCH_MAX ? [...name].slice(0, BRANCH_MAX - 1).join('') + '…' : name}`

type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string }>

const git = async (run: Run, argv: string[]) => {
  try {
    const { exitCode, stdout } = await run(['git', ...argv])
    return exitCode === 0 ? stdout.trim() : undefined
  } catch {
    return undefined
  }
}

// Lee la rama actual; con HEAD separado, el commit corto. `true` si cambió.
export const readBranch = async (run: Run) => {
  const name = (await git(run, ['branch', '--show-current'])) || (await git(run, ['rev-parse', '--short', 'HEAD']))
  const value = name || undefined
  if (value === branchState.name) return false
  branchState.name = value
  return true
}

export const registerBranch = (on: On) => {
  // Sin hacer esperar a la herramienta ni al cambio: la rama llega después.
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    next(e).finally(() => {
      void readBranch(argv => $.process.run(argv)).then(changed => changed && $.ui.invalidate('ui.render'))
    }),
  )

  on('classic.CwdChanged', ($, e, next) =>
    next(e).finally(() => {
      void readBranch(argv => $.process.run(argv)).then(changed => changed && $.ui.invalidate('ui.render'))
    }),
  )
}
