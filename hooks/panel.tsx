import type { On, RenderChildren } from 'claude-code'

import { BANNER, BANNER_WIDTH, bannerColor } from './banner'
import { DEFAULTS, move, PRESETS, readConfig, STORE_KEY } from './config'
import type { Config, Segment, Threshold, Toggle } from './config'
import { PALETTE } from './palette'

// `/usage-band`: un panel para personalizar la línea. Cada opción es un botón
// con su tecla (o Tab y Enter); un cambio se guarda en `$.store` y la línea se
// redibuja al momento. Esc o «Cerrar» lo cierran. El comando se registra en el
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
  ['auto', '8', 'Interruptor piloto'],
]

const ANIMATIONS: [Toggle, string, string][] = [
  ['count', 'a', 'Conteo'],
  ['pulse', 'b', 'Pulso de alarma'],
  ['countdown', 'c', 'Cuenta atrás'],
  ['wipe', 'd', 'Barrido de detalles'],
  ['spin', 'e', 'Giro de la marca'],
  ['shimmer', 'f', 'Brillo del modelo'],
]

const ALERTS: [Toggle, string, string][] = [
  ['alert', 'o', 'Notificaciones'],
  ['guard', 'p', 'Aviso al enviar'],
  ['compact', 's', 'Compactar contexto'],
  ['autoContinue', 't', 'Piloto automático'],
]

// Umbral, su tecla para bajar y para subir ('' sin tecla), y su nombre.
const THRESHOLDS: [Threshold, string, string, string][] = [
  ['limitWarn', 'g', 'h', 'Color límites: aviso'],
  ['limitCrit', 'i', 'j', 'Color límites: alarma'],
  ['ctxWarn', 'k', 'l', 'Color contexto: aviso'],
  ['ctxCrit', 'm', 'n', 'Color contexto: alarma'],
  ['alertAt', 'x', 'y', 'Notificar desde'],
  ['guardAt', '9', '0', 'Avisar al enviar desde'],
  ['compactAt', '', '', 'Compactar desde'],
]

const SEGMENT_NAMES: Record<Segment, string> = {
  model: 'Modelo',
  ctx: 'Contexto',
  cost: 'Importe',
  five: 'Ventana 5 h',
  week: 'Semana',
}

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
      <Button
        key={key}
        plain
        hotkey={hotkey || undefined}
        onPress={() => save({ ...config, [key]: !config[key] })}
      >
        <Text color={config[key] ? PALETTE.ok : PALETTE.mut}>{config[key] ? '[x]' : '[ ]'}</Text> {name}
      </Button>
    )

    const threshold = ([key, down, up, name]: [Threshold, string, string, string]) => (
      <Box key={key} flexDirection="row">
        <Text>{name.padEnd(23)}</Text>
        <Text color={PALETTE.acc}>{`${config[key]} %`.padStart(5)}  </Text>
        <Button
          key={`${key}-down`}
          plain
          hotkey={down || undefined}
          onPress={() => save({ ...config, [key]: config[key] - STEP })}
        >
          −
        </Button>
        <Text> </Text>
        <Button key={`${key}-up`} plain hotkey={up || undefined} onPress={() => save({ ...config, [key]: config[key] + STEP })}>
          +
        </Button>
      </Box>
    )

    // Un tramo en su puesto, con flechas para moverlo antes o después.
    const ordered = (segment: Segment, i: number) => (
      <Box key={`order-${segment}`} flexDirection="row">
        <Text color={PALETTE.mut}>{`${i + 1}.`} </Text>
        <Text>{SEGMENT_NAMES[segment].padEnd(13)}</Text>
        <Button key={`up-${segment}`} plain onPress={() => save({ ...config, order: move(config.order, segment, -1) })}>
          ↑
        </Button>
        <Text> </Text>
        <Button key={`down-${segment}`} plain onPress={() => save({ ...config, order: move(config.order, segment, 1) })}>
          ↓
        </Button>
      </Box>
    )

    const heading = (text: string) => (
      <Text bold color={PALETTE.acc2}>
        {text}
      </Text>
    )

    // Una columna del panel; las columnas bajan de línea si no caben.
    const column = (children: RenderChildren[]) => (
      <Box flexDirection="column" marginRight={3} marginBottom={1}>
        {children}
      </Box>
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
        <Box flexDirection="row" flexWrap="wrap">
          {column([heading('Línea'), ...LINE.map(toggle)])}
          {column([heading('Orden'), ...config.order.map(ordered)])}
          {column([heading('Animaciones'), ...ANIMATIONS.map(toggle)])}
          {column([heading('Avisos y protección'), ...ALERTS.map(toggle)])}
          {column([heading('Umbrales'), ...THRESHOLDS.map(threshold)])}
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold color={PALETTE.acc2}>
            Estilos{' '}
          </Text>
          {PRESETS.flatMap(p => [
            <Button key={p.key} hotkey={p.hotkey} onPress={() => save({ ...config, ...p.set })}>
              {p.name}
            </Button>,
            <Text> </Text>,
          ])}
        </Box>
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
        <Text color={PALETTE.mut}>
          Tecla de cada opción a su izquierda · Tab y Enter para el resto · Esc cierra · se guarda solo
        </Text>
      </Box>
    )
  })
}
