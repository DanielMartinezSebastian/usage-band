import type { On } from 'claude-code'

import { BANNER, BANNER_WIDTH, bannerColor } from './banner'
import { DEFAULTS, readConfig, STORE_KEY } from './config'
import type { Config, Threshold, Toggle } from './config'
import { PALETTE } from './palette'

// `/usage-band`: un panel para personalizar la línea. Cada opción es un botón
// con su tecla; un cambio se guarda en `$.store` y la línea se redibuja al
// momento. Esc o «Cerrar» lo cierran. El comando se registra en el
// `session.start` de register.tsx (el evento admite un solo hook por mod).

const PANE = 'usage-band-config'

const LINE: [Toggle, string, string][] = [
  ['model', '1', 'Modelo'],
  ['ctx', '2', 'Contexto'],
  ['cost', '3', 'Importe'],
  ['five', '4', 'Ventana 5 h'],
  ['fiveReset', '5', 'Hora de reinicio'],
  ['week', '6', 'Semana'],
  ['brand', '7', 'Marca < >'],
]

const ANIMATIONS: [Toggle, string, string][] = [
  ['count', 'a', 'Conteo'],
  ['pulse', 'b', 'Pulso al 90 %'],
  ['countdown', 'c', 'Cuenta atrás'],
  ['wipe', 'd', 'Barrido de detalles'],
  ['spin', 'e', 'Giro de la marca'],
  ['shimmer', 'f', 'Brillo del modelo'],
]

// Umbral, su tecla para bajar y para subir, y su nombre.
const THRESHOLDS: [Threshold, string, string, string][] = [
  ['limitWarn', 'g', 'h', 'Límites: aviso'],
  ['limitCrit', 'i', 'j', 'Límites: alarma'],
  ['ctxWarn', 'k', 'l', 'Contexto: aviso'],
  ['ctxCrit', 'm', 'n', 'Contexto: alarma'],
]

const STEP = 5

export const registerPanel = (on: On) => {
  on('command.run', { command: 'usage-band' }, async $ => {
    await $.ui.open({ id: PANE, title: 'usage-band', focus: true, closeOnEscape: true })
    return { text: 'Panel de usage-band abierto (Esc para cerrar).' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const config = readConfig(await $.store.get(STORE_KEY))

    // Guarda el cambio y redibuja el panel y la línea.
    const save = async (changed: Config) => {
      await $.store.set(STORE_KEY, readConfig(changed))
      $.ui.invalidate('ui.render')
    }

    const toggle = ([key, hotkey, name]: [Toggle, string, string]) => (
      <Button key={key} plain hotkey={hotkey} onPress={() => save({ ...config, [key]: !config[key] })}>
        <Text color={config[key] ? PALETTE.ok : PALETTE.mut}>{config[key] ? '[x]' : '[ ]'}</Text> {name}
      </Button>
    )

    const threshold = ([key, down, up, name]: [Threshold, string, string, string]) => (
      <Box key={key} flexDirection="row">
        <Text>{name.padEnd(17)}</Text>
        <Text color={PALETTE.acc}>{`${config[key]} %`.padStart(5)}  </Text>
        <Button key={`${key}-down`} plain hotkey={down} onPress={() => save({ ...config, [key]: config[key] - STEP })}>
          −
        </Button>
        <Text> </Text>
        <Button key={`${key}-up`} plain hotkey={up} onPress={() => save({ ...config, [key]: config[key] + STEP })}>
          +
        </Button>
      </Box>
    )

    const heading = (text: string) => (
      <Text bold color={PALETTE.acc2}>
        {text}
      </Text>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        {/* El letrero, solo si cabe entero en el panel. */}
        {e.props.bodyColumns >= BANNER_WIDTH + 2 ? (
          <Box flexDirection="column" marginBottom={1}>
            {BANNER.map((row, i) => (
              <Text color={bannerColor(i)}>{row}</Text>
            ))}
          </Box>
        ) : null}
        {heading('Línea')}
        {LINE.map(toggle)}
        <Text> </Text>
        {heading('Animaciones')}
        {ANIMATIONS.map(toggle)}
        <Text> </Text>
        {heading('Umbrales de color')}
        {THRESHOLDS.map(threshold)}
        <Text> </Text>
        <Box flexDirection="row">
          <Button key="reset" hotkey="r" onPress={() => save(DEFAULTS)}>
            Restablecer
          </Button>
          <Text> </Text>
          <Button key="close" hotkey="q" variant="primary" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
            Cerrar
          </Button>
        </Box>
        <Text color={PALETTE.mut}>Tecla de cada opción a su izquierda · Esc cierra · se guarda solo</Text>
      </Box>
    )
  })
}
