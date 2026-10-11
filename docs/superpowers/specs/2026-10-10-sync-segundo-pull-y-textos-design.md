# Tablet · segundo pull tras subir y tres textos que confunden (spec)

**Fecha:** 2026-10-10 · **Rama:** `fix/sync-segundo-pull-y-textos` desde `main` `e3fa44d` (PR #112)
**Origen:** revisión de errores de la app en el emulador (2026-10-10, Pixel 7 / Android 16, backend local, Postgres local 35/35).
**Decisiones:** D1…D4 las tomó el agente el 2026-10-10 bajo la instrucción de Mario *"lánzalos por subagent driven"*. Cada una dice qué cuesta si está mal.

## Qué se rompe hoy (medido)

**E4 · Una venta a crédito recién subida no aparece para cobrar hasta la segunda sincronización.** Secuencia medida: venta a crédito `TJ261010DM01` grabada → *Sincronizar ahora* → alerta *"Se bajaron 0 registro(s) y se subieron 1"*; `nota_pendiente` local = 0 filas; la pantalla de Cobranza dice *"Este cliente no tiene notas pendientes"*. Segunda sincronización sin cambios en medio → *"Se bajaron 1 registro(s) y se subieron 0"*; ahora sí aparece `TJ261010DM01` con saldo $280.00. Lo mismo tras un cobro (el saldo nuevo baja hasta la siguiente). Causa: `apps/tablet/src/sincronizacion/motor.ts` corre **pull antes de push a propósito** (líneas 19-22: si se corta la red a la mitad, mejor tener catálogos frescos que haber subido y quedarse con datos viejos). Esa razón es válida; lo que falta es un pull **después** del push.

**E5 · Tres textos que confunden al vendedor.**
- 5.1 `Catálogos bajados: 2026-10-10T18:02:54.922Z` en dos pantallas: el menú de la jornada (`app/(jornada)/index.tsx`) y la lista de clientes (`app/(jornada)/operacion/index.tsx`). Es la cadena ISO cruda que devuelve `catalogos.frescuraCatalogos()` (`src/datos/repositorios/catalogos.ts:390`, `min(sincronizado_en)`), en **UTC**: 18:02Z son las 11:02 en Tijuana.
- 5.2 En *Abrir el día*, el error *"El kilometraje inicial debe ser un numero mayor o igual a cero."* se queda en pantalla después de corregir el valor a uno válido (captura s07); `setError(null)` solo corre dentro de `abrir()`. Mismo patrón en *Cerrar el día*.
- 5.3 En *Cobranza*, la ayuda de *Fecha de pago* dice *"Entre 2026-10-10 y 2026-10-10."* cuando la nota es de hoy.

## Decisiones

**D1 · Segundo pull al final de la sincronización, solo si hubo algo que subir.** En `motor.ts`, después del push y de las fotos, si `push.aplicadas > 0` o se subió al menos una foto, se vuelve a llamar `bajar(token)` (incremental, por cursor: barato). Sus filas se **suman** a `resultado.pull.filas` y actualizan el cursor como siempre. El orden pull → push → fotos se conserva (la razón documentada sigue valiendo). Si el segundo pull falla, la sincronización **sigue siendo `ok`** (lo subido ya está a salvo y el siguiente pull lo trae); se registra en el resultado como `pullPosterior: 'fallo'` (campo nuevo, opcional) para que la tarjeta pueda decirlo si algún día hace falta, pero no se cambia ningún texto por eso ahora. Pruebas en `motor.spec.ts`: (a) con push de 1 aplicada, `api.pull` se llama dos veces y `filas` suma; (b) con push de 0 aplicadas y sin fotos, `api.pull` se llama una vez; (c) si el segundo pull lanza, `ok` sigue `true`. *Si está mal:* costo de una petición extra por sincronización con subidas; se quita la llamada.

**D2 · Fecha y hora legibles y en hora local.** Helper puro `formatearMomento(iso: string): string` en `apps/tablet/src/ui/` (junto a `cifra.ts`) que devuelve `AAAA-MM-DD HH:mm` en la **hora local del dispositivo** (la misma que usa `reloj.hoy()` en `src/datos/reloj.ts`, que ya decide el día con `getDate()` local y no UTC). Se implementa con `getFullYear/getMonth/getDate/getHours/getMinutes` del `Date` local, **sin `Intl`**: no depende de los datos de zona horaria del motor JS y la prueba es determinista en Node fijando la zona (`TZ`) o construyendo la fecha con componentes locales. `null` → `'nunca'`. Se usa en las dos pantallas de 5.1 (`Catálogos bajados: 2026-10-10 11:02`). *Si está mal:* es presentación; se cambia el formato en un solo sitio.

**D3 · El error se borra al corregir.** En `app/abrir-dia.tsx` y `app/(jornada)/cerrar-dia.tsx`, `onChangeText` del kilometraje hace `setError(null)` además de guardar el texto. Prueba de pantalla con el patrón de las pruebas existentes de esas pantallas (si no las hay, prueba del comportamiento mínimo con `@testing-library/react-native` como en `apps/tablet/app/**/*.spec.tsx` si existen; si no existe infraestructura de pruebas de pantalla, se anota en el reporte y no se inventa).

**D4 · Ayuda de la fecha de pago.** En `app/(jornada)/operacion/[clienteId]/cobranza.tsx`, cuando `nota.fecha === hoy` la ayuda dice *"Solo hoy (2026-10-10)."*; si no, se queda *"Entre {nota.fecha} y {hoy}."*. Función pura `ayudaRangoFecha(desde, hasta)` con prueba, para no probar la pantalla entera.

## Restricciones globales (van en el plan)

- Código en español, identificadores sin acentos, mensajes al usuario con acentos. Comentarios que explican *por qué*.
- Solo `apps/tablet/`. Sin cambios de contrato ni de backend ni migraciones locales de SQLite.
- `npm run typecheck --workspace=apps/tablet`, `npm run lint --workspace=apps/tablet`, `npm test --workspace=apps/tablet` en verde; los conteos los mide el implementador contra la línea base, no se escriben en el plan.
- Los implementadores no despachan subagentes, no empujan, no mergean.

## Fuera de alcance

Proyección local de la nota a crédito sin servidor (el servidor sigue siendo la fuente), textos de la tarjeta de sincronización, T-44.
