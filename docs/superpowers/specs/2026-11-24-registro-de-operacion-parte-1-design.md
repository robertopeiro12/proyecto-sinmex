# Registro de Operación, parte 1 — diseño

Fecha: 2026-11-24 · Rama: `feature/registro-operacion` (desde `main`) · Portal + backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`):
- **Módulo de Producción e Inventarios 2026-11-16 (fuente)**, sección "Submódulo: Registro de Operación".
- **Respuestas del cliente 2026-11-18 Inventarios y Producción (fuente)**: envíos restan en quien manda (2), descuentos
  con nombre del trabajador (3), Entradas/Compras reemplaza a "Producción del día" (7).
- Issue **#162 (T-81)**: catálogo de motivos de merma.

## Para qué

Tercer paso del módulo de Producción e Inventarios. Producción anota todo lo que entra y sale del almacén (lo que no es
venta ni carga de vendedor). Son los datos que después leerán los inventarios de producto terminado (*Inventario de PT
con Ventas / con Recargas*, pasos siguientes) y el reporte *Información de Producción*. En esta parte **solo se captura**;
nadie lee todavía estos registros para calcular inventario.

**Parte 1 (este documento):** Entradas/Compras, Envíos a sucursal, Merma de almacén (con el catálogo de motivos),
Consumo y Descuentos. **Parte 2 (otro PR):** Retiro de merma con autorización de Administración, y Recargas movida a
esta pantalla con el diseño nuevo.

## Lo que dice el cliente (no se cambia sin preguntarle)

- **C1.** Cada registro elige **primero la sucursal**; ninguno aplica a las dos.
- **C2. Entradas/Compras:** producto terminado que entra al almacén, por producción propia o por compra a proveedores
  (refrescos, jugos). Por producto y presentación. Fecha elegible; por lo general hoy, puede ser un día anterior.
  Reemplaza a "Producción del día" (respuesta 7: hoy no hay registro de producción en el portal viejo).
- **C3. Envíos a sucursal:** salida del almacén de una sucursal a otra (sobre todo TJ → MX; a veces al revés). En el
  almacén que manda **resta** como Envío; en el que recibe **entra** como Entrada/Compra (respuesta 2). Fecha de hoy, o
  máximo un día anterior.
- **C4. Merma de almacén:** piezas dañadas en el almacén (malos lotes, mal estado, caducadas). Desde Producción siempre
  es merma de almacén. Con **motivo**: Producto dañado / mal estado · Caducado por fecha · Merma general antes de
  caducidad · Lote en mal estado. Fecha: hoy por omisión, puede ser anterior.
- **C5. Consumo:** lo que se toma a diario el personal de producción (y administración). Hoy por omisión o anterior.
- **C6. Descuentos:** producto que se le descuenta por nómina a un trabajador de producción o administración; se anota
  **el nombre del trabajador** (respuesta 3). Roberto: el nombre se escribe a mano por ahora.
- **C7.** "Estas operaciones se tienen que agregar en los perfiles de los usuarios": cada operación con su permiso.

## Decisiones de Roberto (2026-11-24)

- **R1.** Una pantalla *Producción → Registro de Operación* con una pestaña por operación.
- **R2.** **Catálogo de motivos de merma ahora** (T-81, lado portal/backend), sembrado con los 4 motivos del cliente; la
  merma de almacén lo usa. La app (merma de cliente y del vehículo con motivo) la hace Mario después.
- **R3.** Entradas distinguen **Producción** o **Compra** (sin datos del proveedor).
- **R4.** Dos PRs; Recargas (movida y rediseñada, avisando a Mario) y Retiro de merma van en la parte 2.

## Decisiones mías (se pueden cambiar)

- **D1. Una operación = una captura con varias líneas.** Como una carga: se elige sucursal, fecha y los datos de la
  operación, y se escriben las piezas de todas las presentaciones que hagan falta en una rejilla (todos los productos
  activos agrupados por tamaño, se avanza con TAB, como pide el cliente para Recarga). Piezas enteras > 0; 0 o vacío =
  sin línea. Al menos una línea.
- **D2. Datos.** Tabla `operacion_almacen` (`sucursal_id`, `tipo` ∈ `entrada|envio|merma|consumo|descuento`, `fecha`,
  `origen` ∈ `produccion|compra` solo en entrada, `sucursal_destino_id` solo en envío y distinta de la sucursal,
  `motivo_merma_id` solo en merma, `trabajador` 1..120 solo en descuento, `comentario` opcional ≤ 300,
  `capturo_usuario_id`, `actualizado_por_usuario_id`, tiempos, `deleted_at`) con checks por tipo, y
  `operacion_almacen_linea` (`operacion_id`, `presentacion_id`, `piezas > 0`, única por operación y presentación).
  El check de `tipo` se deja preparado para que la parte 2 agregue `retiro_merma`.
- **D3. Envío = una fila.** Se guarda una vez con origen (`sucursal_id`) y destino. La pestaña Entradas de la sucursal
  destino lo muestra como renglón "Envío desde TJ" (solo lectura ahí; se corrige desde el origen).
- **D4. Corregir y dar de baja:** se puede editar (reemplaza líneas y datos, anota `actualizado_por_usuario_id`) y dar
  de baja (lógica, con `useConfirmar`) con las mismas reglas de fecha de su tipo. Sin días futuros (hoy de Tijuana).
- **D5. Permisos** (migración): `operacion.entrada`, `operacion.envio`, `operacion.merma`, `operacion.consumo`,
  `operacion.descuento` (grupo Produccion/Almacen) y `motivo_merma.gestionar` (grupo General). Ver y capturar una
  pestaña pide su permiso; sin él la pestaña no aparece. Los asigna el cliente.
- **D6. Alcance de sucursal** como Corte: un usuario atado solo registra en la suya (otra = 404 al leer una operación,
  403 al pedir otra sucursal); un General elige con el selector global; con "Todas" se pide elegir una. En un envío, el
  destino puede ser cualquier otra sucursal viva.
- **D7. Motivos de merma** (`motivo_merma`): nombre único entre vivos, casillas **aplica a almacén / cliente / vehículo**,
  baja lógica, `creado_en`/`actualizado_en` con `set_actualizado_en()` (como `motivo_visita`). Portal *Catálogo → Motivos
  de merma* (`PantallaCatalogo`, como Motivos de visita). La merma de almacén solo ofrece motivos vivos con "almacén"; una
  merma ya guardada conserva su motivo aunque se dé de baja. Semilla: los 4 motivos con las tres casillas prendidas. El
  pull a la tablet es de Mario (T-81).
- **D8. Producción del día se retira:** la migración copia cada (fecha, sucursal) viva de `produccion` a una operación
  `entrada` con `origen = 'produccion'` y sus líneas (capturó = quien capturó la primera fila). La tabla `produccion` se
  queda sin borrar. Se quitan los endpoints `/produccion` y la pantalla; `/produccion/produccion-del-dia` redirige a
  Registro de Operación (pestaña Entradas, conservando `?sucursal`).
- **D9. Menú de Producción:** Recarga · Corte · Inventario por vendedor (si ya está) · **Registro de Operación** ·
  Almacenes (pronto). Se quita "Peticiones" (el cliente: "se van a eliminar") y "Producción del día".
- **D10. Pantalla:** por pestaña, la lista de las operaciones del día elegido (hora de captura, quién, piezas totales, y
  según el tipo origen / destino / motivo / trabajador; Editar y Eliminar), con fecha (Hoy · Ayer · día) y el botón
  "Registrar …" que abre la captura en pantalla completa ("← Volver a Registro de Operación"). Cabe a 1366 px.

## Decisiones tras la revisión del diseño (mías)

- **D11. Permiso viejo.** La migración da `operacion.entrada` a todo perfil (`perfil_permiso`) y excepción
  (`usuario_permiso`, con su `habilitado`) que hoy tenga `almacen_general.gestionar`; ese permiso se queda en el catálogo
  sin uso. El Administrador General recibe el catálogo completo como siempre.
- **D12. La copia de `produccion` es única** (en la migración): solo filas vivas; una operación por (fecha, sucursal),
  `capturo_usuario_id` = el de la fila más antigua del grupo. Después nadie escribe en `produccion`.
- **D13. Fechas.** Entrada, merma, consumo y **descuento**: cualquier día hasta hoy de Tijuana, al crear, editar y dar de
  baja. Envío: **hoy o ayer**, también para editar y dar de baja; después queda de solo lectura.
- **D14. Envío visto desde el destino.** `GET ?tipo=entrada&sucursal=MX` incluye los envíos vivos con destino MX (marcados
  `envio: { origen }`), con el permiso `operacion.entrada`, aunque el usuario no alcance la sucursal de origen. Ahí no se
  editan ni se dan de baja: solo desde el origen (con `operacion.envio`).
- **D15. Permiso según el tipo.** Un solo recurso `/operaciones-almacen`; el servicio exige el permiso del tipo
  (`operacion.<tipo>`) consultando `PermisosRepository` (la misma resolución que el guard y `/auth/me`), en listar, ver,
  crear, editar y dar de baja. Con prueba por tipo.
- **D16. Motivos:** la baja se permite aunque haya mermas con ese motivo (las guardadas lo conservan); sin mínimo.
- **D17. Menú:** "Inventario por vendedor" no se toca aquí (llega con #164). Se quita "Peticiones" de Producción y su
  página placeholder.
- **D18. Topes:** máximo 200 líneas por operación y 100 000 piezas por línea (400 con mensaje).

## Contrato (resumen)

`GET /operaciones-almacen?sucursal&fecha&tipo`, `GET|PUT|DELETE /operaciones-almacen/:id`, `POST /operaciones-almacen`
(cuerpo: `tipo`, `sucursal`, `fecha`, datos del tipo, `lineas: {presentacionId, piezas}[]`). `GET|POST|PATCH|DELETE
/motivos-merma`. Errores en español, 400 con el motivo (fecha fuera de su regla, destino = origen, motivo inexistente o
sin "almacén", trabajador vacío, sin líneas, presentación inexistente). Tipos duplicados en `apps/portal/src/lib/`.

## Fuera de alcance

Retiro de merma y Recargas (parte 2), cualquier cálculo de inventario con estos datos, el pull de motivos a la tablet y
la merma con motivo en la app (Mario), Procesos (merma/descuentos que captura la oficina).

## Nube

Una migración (tablas nuevas, permisos, semilla de motivos y la copia de `produccion`). **Backend y portal juntos**
(el portal nuevo ya no llama a `/produccion`, que el backend retiró). Protocolo de push de `CLAUDE.md` más:

- **Antes del push**, además del pre-flight de la migración (cada una da 0: filas de `produccion` con `piezas > 100000` y
  fechas/sucursales con más de 200 filas), contar los grants vivos de `almacen_general.gestionar`
  (`select count(*) from perfil_permiso pp join permiso p on p.id = pp.permiso_id where p.clave = 'almacen_general.gestionar'
  and pp.deleted_at is null;` y lo mismo con `usuario_permiso`), para compararlos después con `operacion.entrada`. Anotar
  también cuántas entradas va a crear la copia (`select count(*) from (select distinct fecha, sucursal_id from produccion
  where deleted_at is null) t;`) y la hora del push.
- **Avisar a Mario** que no corra un backend viejo contra `sinmex dev` durante el push: escribiría en `produccion` y la
  copia es **única**.
- **Después del push (post-flight)**: `select count(*) from produccion where greatest(created_at, updated_at,
  coalesce(deleted_at, created_at)) > '<hora del push>';` debe dar 0 (lo que se escriba en `produccion` después se pierde),
  y los grants vivos de `operacion.entrada` (perfiles y usuarios) deben ser al menos los conteos de antes.

## Pruebas

pgTAP de los checks por tipo; unit de reglas puras (fechas por tipo, validación de la captura, plan de líneas); e2e de
cada tipo (alta, edición, baja, permisos por tipo, alcance, envío visto en Entradas del destino, motivo sin "almacén"
rechazado, copia de `produccion` en la migración); portal: pestañas por permiso, captura con TAB, lista por tipo,
redirect de Producción del día, catálogo de motivos. Navegador a 1366 y 1920 px.
