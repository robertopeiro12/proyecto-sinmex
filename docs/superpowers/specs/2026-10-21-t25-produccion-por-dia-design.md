# T-25 · Registro de Producción por día — Diseño

**Fecha:** 2026-10-21 · **Estado:** aprobado en conversación por Roberto · **Issue:** #25
**Fuentes (vault):** [[Producción]], [[Sistema Jawa (fuente)]] (§Producción), [[Respuestas del cliente 2026-10 (fuente)]]
(preguntas 1, 3 y 4), [[Respuestas del cliente 2026-08 (fuente)]] (Almacén General), [[Fórmula de inventario]].

## 1. Para qué

Que producción registre cuántas piezas se hicieron cada día, para que después el inventario de producto terminado
(T-24) y el Almacén General (T-63) las sumen. Hoy se lleva en Excel / a mano (cliente, 2026-10-20).

## 2. Lo que dijo el cliente (fuente de verdad)

- *"Esta sección se utilizará para registrar la producción por día"*; *"Que se pueda registrar la producción de días
  anteriores"*; *"Que se pueda modificar la producción de un día"*; campos Fecha, Producto, Cantidad y **Total**
  ([[Sistema Jawa (fuente)]]).
- **Por sabor y por tamaño** (pregunta 1, 2026-10-20): "120 de Jamaica de 500 ml y 80 de 600 ml".
- **Solo Tijuana produce**; Mexicali tendrá su propio almacén y "solamente recibe" (pregunta 4). La producción es una
  entrada del **Almacén General** de Tijuana (pregunta 3 y la fórmula de inventario).
- El Almacén General "lo van a alimentar de información el personal de producción y/o administración" (agosto).

## 3. Decisiones

| Tema | Decisión | De dónde sale |
|---|---|---|
| Qué se captura | Piezas por **presentación** (sabor + tamaño) por día, con el total del día. | Fuente + pregunta 1 |
| Fecha | Por omisión **hoy**; se pueden capturar **días anteriores**; no días futuros (hoy en Tijuana). | Fuente ("default hoy, permite días anteriores") |
| Modificar | Elegir un día ya capturado muestra lo guardado y se corrige; se guarda el día completo de una vez. | Fuente |
| Sucursal | Cada registro guarda su sucursal. El cliente dice que solo Tijuana produce; la pantalla no bloquea otra sucursal (no lo pidió), pero el texto de la pantalla habla de la producción de la planta. Con "Todas las sucursales" pide elegir una. | Pregunta 4; decisión técnica de Claude para no rehacer con Ensenada |
| Permiso | **`almacen_general.gestionar`** (ya existe, grupo Produccion/Almacen): registrar la producción es registrar una entrada del Almacén General. No se crea un permiso nuevo. | Lista de permisos de julio + agosto + pregunta 3 |
| Fuera de alcance | Inventario (T-24), almacenes, envíos a Mexicali y retornos (T-63), envases (preguntas 6–7 sin respuesta). | Issues #24 y #63 |

> [!warning] Pendiente de confirmar con el cliente
> Quién captura exactamente (almacenista o jefe de producción) no cambia este diseño: lo decide el perfil que reciba
> `almacen_general.gestionar` en *Perfiles y Permisos*.

## 4. Datos (migración nueva)

Tabla `produccion`:

- `id` uuid, `fecha` date, `sucursal_id` → `sucursal`, `presentacion_id` → `presentacion`, `piezas` int `> 0`,
  `capturo_usuario_id` → `usuario`, `actualizado_por_usuario_id` (nullable), `created_at`, `updated_at`, `deleted_at`.
- **Una fila viva por día, sucursal y presentación:** índice único parcial `(fecha, sucursal_id, presentacion_id) where
  deleted_at is null`.
- Sin fechas futuras: lo valida el servidor con "hoy en Tijuana" (como Tesorería), no un check de la base.
- Nombre de la migración con timestamp único (revisar `ls supabase/migrations` y la rama de Mario).

## 5. Backend (`modules/produccion/`, donde ya viven las cargas de T-27)

- `GET /produccion?fecha=YYYY-MM-DD&sucursal=XX` → `{ fecha, sucursal, lineas: [{ presentacionId, producto,
  presentacion, piezas }], totalPiezas, capturadoPor, actualizadoEn }` con **todas las presentaciones activas** (las que
  no tienen registro salen con `piezas: 0`) más las inactivas que sí tengan piezas ese día (para no esconder lo
  capturado). Permiso `almacen_general.gestionar`.
- `PUT /produccion` con `{ fecha, sucursal, lineas: [{ presentacionId, piezas }] }` → reemplaza el día en una
  transacción: crea o actualiza las que traen piezas > 0, da de baja (`deleted_at`) las que vienen en 0 o ya no vienen.
  Guarda `capturo_usuario_id` al crear y `actualizado_por_usuario_id` al corregir. Rechaza (400) fecha futura, piezas
  negativas o no enteras, presentación inexistente o repetida en la petición. Responde lo mismo que el `GET`.
- Alcance de sucursal como el resto: un usuario atado solo ve y captura la suya (otra sucursal = 404).
- Las reglas puras (validar líneas, decidir qué se crea/actualiza/borra) en `reglas-produccion.ts`, con pruebas
  unitarias; e2e del `GET`/`PUT` con Postgres real.

## 6. Portal

- Menú *Producción → Producción del día* (`/produccion/produccion-del-dia`), arriba de Recarga. Pantalla con las piezas
  comunes de la UI: `EncabezadoPantalla` ("Producción del día" / "Las piezas que se hicieron cada día, por sabor y
  tamaño."), `Campo` de fecha (máximo hoy en Tijuana), tabla común con una fila por presentación (producto, presentación,
  casilla de piezas) y el **Total** abajo, botón **Guardar**. Avisos con `Aviso` ("Producción guardada.", errores del
  servidor tal cual). Sin permiso o sin sucursal: `EstadoPantalla`.
- Cambiar de fecha con cambios sin guardar pregunta con `useConfirmar` ("¿Descartar los cambios?").
- Debe caber a 1366 px sin desplazamiento horizontal.

## 7. Pruebas y revisión

- Backend: unitarias de `reglas-produccion.ts`; e2e del `GET` (presentaciones sin registro en 0, inactivas con piezas)
  y del `PUT` (crear, corregir, poner en 0 da de baja, fecha futura 400, otra sucursal 404, permiso 403); pgTAP del
  índice único parcial y del check de piezas.
- Portal: pruebas de la pantalla (carga, total, guardar, corregir, fecha futura deshabilitada, confirmar al cambiar de
  fecha con cambios).
- `npm test`/`test:e2e` del backend, pruebas del portal, `tsc`, lint y `next build` limpios.
- Navegador a 1366 px contra la base local (usuarios `revision` y `revision-tj`).
- Vault: [[Producción]] (implementado en T-25), [[Estado del proyecto]] y bitácora. CLAUDE.md: bloque corto de T-25.
- **Nube:** la migración se sube a `sinmex dev` después del merge con el protocolo de push (pre-flight: tabla nueva,
  nada que contar).
