# Pendiente: usage-band con muchas sesiones a la vez

Estado: **por valorar** (informe del 2026-10-21, nada implementado).

El mod se diseñó pensando en una sola sesión. Con varias abiertas (se vieron 11
procesos `claude`) el rendimiento está bien, pero los avisos y el piloto
automático se duplican.

## Rendimiento: bien

Por sesión: redibujo cada 60 s, un `git branch` por minuto y tras cada Bash, y
reloj rápido solo durante animaciones. Con 11 sesiones son ~11 llamadas cortas a
git por minuto y ninguna de red. No hace falta tocarlo.

## Problemas

1. **Avisos repetidos.** `limits.alerted` y `limits.hit` viven en la memoria de
   cada sesión: al pasar `alertAt` o llegar al 100 %, cada sesión manda su
   notificación y abre su diálogo «Límite alcanzado». Igual con «Ya puedes
   seguir» al reiniciarse.
2. **Piloto automático (el serio).**
   - `autoContinue` está en la config compartida de `$.store`: encenderlo en una
     sesión lo enciende en todas.
   - `pending` también es compartido y cada sesión lo lee en `session.start`.
     Al reiniciarse, cada sesión enviaría `CONTINUE_TEXT`, también las que no
     tenían nada a medias o se abrieron durante el límite.
   - Resultado: N sesiones gastando cuota a la vez justo al empezar la ventana.
   - En `settings.json` hay `autoContinueAtUsageLimit: true`, al parecer el
     autocontinuar nativo de Claude Code (sin comprobar). Con el piloto
     encendido podría enviarse dos veces.
3. **% de 5h/wk viejos en sesiones paradas.** El límite es de la cuenta, pero
   cada sesión solo ve la lectura de sus propias peticiones.
4. **Escrituras simultáneas en la config.** Cada cambio reescribe el objeto
   entero (el panel y `choose()` del diálogo, con una config leída antes); dos
   cambios casi a la vez pueden perder uno. Raro en la práctica.

## Qué compartir y qué no

| Dato | Ahora | Debería |
|---|---|---|
| Config de `/usage-band` | compartida | compartida (igual) |
| Avisos (umbral, límite, reinicio) | uno por sesión | compartidos: el primero lo apunta en `$.store` y el resto calla |
| Última lectura de 5h/wk | por sesión | compartida con su hora; cada sesión muestra la más reciente |
| Límite pendiente | compartido | compartido, solo para la hora de reinicio |
| Piloto automático | compartido | **por sesión**: solo sigue la sesión cortada a medias por el límite, con unos segundos de desfase entre sesiones |
| Rama, subagentes, ctx, animaciones | por sesión | por sesión (igual) |

Límite técnico: `$.store` es un único JSON por plugin, sin bloqueo ni aviso de
cambios. Solo vale para escrituras poco frecuentes (un aviso, una lectura de
límites como mucho por minuto); las demás sesiones lo ven en su siguiente
redibujado (≤ 60 s).

## Orden propuesto

1. Comprobar qué hace exactamente `autoContinueAtUsageLimit`.
2. Piloto por sesión (`$.state` o memoria del módulo, por defecto desde la config).
3. Avisos sin repetir (clave en `$.store` por ventana y hora de reinicio).
4. Compartir la lectura de límites (con su hora, escritura limitada a 1/min).
