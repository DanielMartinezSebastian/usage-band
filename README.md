# usage-band

Mod de Claude Code que dibuja bajo el prompt (componente `PromptHint`) el uso de la sesión y del plan, con un detalle por métrica al pasar el ratón.

```
Opus 5.5 · ctx 32% · $0.4 · 5h 42% 14:16 · wk 31%
```

## Instalación

En el prompt de una sesión de Claude Code en la terminal:

```
/plugin install usage-band --marketplace DanielMartinezSebastian/usage-band
```

Responde `y` para añadir el marketplace y elige el ámbito (el de usuario, el primero, lo carga en todas tus sesiones). Desde una shell:

```
claude plugin install usage-band --marketplace DanielMartinezSebastian/usage-band
```

En la app de escritorio, donde `/plugin` no funciona: pulsa + junto al cuadro del prompt, Plugins, Add marketplace con `DanielMartinezSebastian/usage-band` y luego Add plugin.

Necesita una suscripción Pro o Max de claude.ai para los datos de la ventana de 5 h y de la semana; sin ella solo muestra el modelo, el contexto y el coste. El hover y las animaciones necesitan una terminal que informe del ratón (el modo fullscreen de Claude Code).

Para desarrollarlo desde una copia local, apunta `env.CLAUDE_CODE_PLUGIN_DIRS` en `~/.claude/settings.json` a la carpeta del repositorio; así sustituyó al antiguo statusLine del autor.

## Estado (2026-10-20)

**Línea**
- Modelo (magenta), `ctx` %, coste (cian), `5h` % + hora de reinicio (tenue), `wk` %.
- Colores corporativos (`hooks/palette.ts`, tema oscuro del kit trama-ui de la web): modelo en acento secundario `#c084fc`, etiquetas en acento `#7cc4ff`, coste en texto `#e8ecf4`, separadores, horas y detalles en secundario `#9aa3b5`; brillo del modelo en `#e8ecf4`.
- Umbrales con los estados del kit: `#3ddc84` / `#ffb020` / `#ff5470` (límites a 70/90 %, contexto a 50/80 %); cuenta atrás en `#ffb020`, "ventana nueva" en `#3ddc84`.

**Hover** (CSS de la superficie: `hover` + `scope`, capa `position: absolute` de una fila)
- Cada tramo (modelo, ctx, 5h, wk) abre su propio detalle desde su etiqueta hacia la derecha, sin desplazar nada.
- Sin color de fondo: el texto se rellena con espacios hasta el final de la fila para tapar lo de debajo.
- Modelo: id, alias de settings, ventana, esfuerzo (de `turn.step`), estilo (de `prompt.compose`), thinking/fast si están activos, versión de Claude Code.
- ctx: usados/total y libres. 5h y wk: reinicia, faltan, % usado/libre.

**Animaciones**
- Conteo cuando un % cambia (600 ms, negrita).
- Pulso rojo/tenue en un límite ≥ 90 %.
- Cuenta atrás `m:ss` en los últimos 10 min de la ventana de 5 h; destello verde "ventana nueva" al reiniciarse.
- Brillo blanco que recorre el nombre del modelo mientras Claude trabaja (`shimmer-client.tsx`).
- Al revelarse, cada detalle se construye de izquierda a derecha en 180 ms (solo el contenido, sin cursor), y su barra se llena desde 0 en 200 ms (`detail-client.tsx`: detecta el paso de 0 a >0 columnas; dibuja etiqueta, barra, texto y la rotación).
- Al ocultarse, el detalle se retira de derecha a izquierda en 180 ms dejando ver la línea. La superficie oculta el detalle al instante, así que cada detalle tiene una segunda capa siempre visible y vacía (`role: 'exit'`, mismo Client) que recibe lo que se veía por estado compartido del módulo, sin pasar por el hooks module.

**Responsive**: si la línea no cabe se quita, por orden, el coste, la versión del modelo, la semana, el contexto y el modelo; la ventana de 5 h y su hora siempre quedan. Cada detalle tiene sus datos ordenados por importancia y en tres versiones (larga, media, corta); se usa la más rica que quepa: barra 16 + textos largos → textos medios → barra 8 + cortos → sin barra. Primero abierto desde su etiqueta; si no cabe, más a la izquierda; si ni la versión corta cabe, sus datos rotan de uno en uno cada 2 s (dentro de `detail-client.tsx`).

## Marca martinezsebastian

`brand-client.tsx` dibuja en las últimas columnas de la línea los corchetes `< >` del logo de la web con una barra dentro: vacía (`< >`) en reposo; gira (`/ - \ |`, 80 ms) cambiando de color en el degradado de acento (#7cc4ff → #c084fc) mientras Claude trabaja y al pasar el ratón. El hover no avisa al mod, así que encima va una copia oculta que el hover revela y que solo gira mientras se ve (su región tiene columnas). Siempre se ve: va al final del árbol (encima de los detalles y de sus barridos) y los detalles acaban una columna antes de ella. Se quita con `SHOW_BRAND = false` en `register.tsx`. El ancho real de la fila lo mide una capa aparte (`measure-client.tsx`).

La técnica de Claude Code (investigada, su código no es público): no es una imagen, son caracteres sustituidos en la misma celda a intervalo fijo, con una secuencia de fotogramas fija en el código; el `✻` recuerda al logo de Anthropic, por eso parece que el logo "respira".

Pendiente: queda un puntito `·` en la fila de debajo. Parece de Claude Code (asociado a `⏵⏵ auto mode on`), no del mod: no se ha confirmado.

## Lo que se aprendió de la API (Claude Code 2.1.302)

- La línea bajo el prompt solo deja dibujar en su propia fila: lo que sale de ella se corta.
- Un `Client` no recibe hover en la terminal del usuario (solo clics), pero su reloj `surface.every` sí funciona. Por eso el hover es CSS y los Clients solo animan.
- Delante de la línea Claude Code pinta su indicador de modo (`⏵⏵ auto mode on`), que no llega en las props y no cabe en `viewport.columns`. El ancho real lo mide la marca: una capa `position: absolute` de toda la fila con un Client que envía `surface.columns` por `post` → `ui.message`. La fila va con `height={1}` para que nada salte a una segunda línea.
- El hover CSS no avisa al mod; un Client oculto sí se vuelve a dibujar al revelarse (cambio de tamaño).
- `$` no se puede guardar en una variable; `turn.step` exige `async function*` con `return yield* next(e)`.

## Desarrollo

```
claude plugin test <carpeta>
claude plugin validate <carpeta>
npx -p typescript@5.6.3 tsc -p <carpeta>
```
