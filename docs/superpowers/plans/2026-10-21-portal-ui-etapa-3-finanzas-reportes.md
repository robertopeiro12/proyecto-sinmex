# Portal UI Etapa 3 (Finanzas e informes) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** pasar Tesorería, Flujo de Efectivo, Cuentas por Cobrar, Reporte de Ventas, la lista de Reportes y Clientes
nuevos a las piezas comunes de `components/ui/`, con los formularios de Tesorería en `Ventana` y sus 3 `window.confirm`
en `useConfirmar`.

**Arquitectura:** cambio de aspecto pantalla por pantalla, sin tocar cálculos ni llamadas a la API. Referencia de cómo
quedó un reporte ya migrado: `apps/portal/src/components/reportes/pantalla-kilometraje.tsx` (Etapa 1: `Pantalla`,
`EncabezadoPantalla`, `EstadoPantalla`, `FiltroFechas` con `acciones={<BotonExcel …/>}`, `CajaTabla`). Referencia de un
catálogo con `Ventana` y baja confirmada: `components/catalogo/pantalla-catalogo.tsx` (Etapa 2).

**Tecnología:** Next.js 15, React 19, `@base-ui/react` 1.6, Tailwind 4, Vitest + Testing Library + `user-event`.

**Spec:** `docs/superpowers/specs/2026-10-21-portal-ui-etapa-3-finanzas-reportes-design.md`

## Restricciones globales

- Solo `apps/portal`. Nada de backend, base de datos, app de tablet ni migraciones.
- No cambia ningún cálculo, número, columna, llamada a la API, definición de Excel (`lib/excel/`) ni texto de negocio
  (etiquetas, validaciones, mensajes del servidor, textos de "vacío").
- Cada pantalla conserva cuándo consulta hoy (al entrar y/o al picar **Mostrar**).
- Piezas: solo lo que exporta `components/ui/` (`Pantalla`, `EncabezadoPantalla`, `EstadoPantalla`, `Aviso`,
  `FiltroFechas`, `BotonExcel`, `CajaTabla`, `Tabla`, `Th`, `Td`, `TdMonto`, `Fila`, `FilaVacia`, `FilaTotal`,
  `FilaGrupo`, `Monto`, `Fecha`, `Campo`, `Entrada`, `Lista`, `Casilla`, `Pestanas`, `Ventana`, `useConfirmar`, `Button`).
- Se quitan `Card`/`CardHeader`/`CardTitle`/`CardContent` de las pantallas tocadas; el título pasa a `h1` del encabezado.
- Las líneas de descripción son las de la tabla §3.1 del spec, copiadas tal cual.
- Se conservan los `aria-label` de las tablas y los ids de los campos.
- Cada tarea termina con `npm test --workspace=apps/portal`, `npx tsc --noEmit -p apps/portal` y
  `npm run lint --workspace=apps/portal` limpios.

## Puntos a revisar

1. **Editar un movimiento mientras el de arriba tiene algo escrito:** "Registrar operación" no pierde lo capturado ni
   cambia de título al abrir/cerrar la ventana de edición. Prueba en la Tarea 2.
2. **Volver a la pestaña Tesorería tras guardar en Movimientos o Saldos:** la vista vuelve a consultar su rango (el
   mecanismo `activa` de hoy), con `conservarMontadas`. Prueba en la Tarea 1.
3. **Rechazo del servidor al eliminar (409 cuenta que recibe cobranza; 403 cuenta general sin ser General):** el mensaje
   del servidor sale tal cual y la fila sigue. Prueba en la Tarea 3.
4. **Rango inválido o sin sucursal elegida:** `FiltroFechas` muestra su error común y no consulta; las pantallas que hoy
   piden sucursal muestran `EstadoPantalla tipo="elige-sucursal"`. Pruebas en las Tareas 5–8.
5. **Reporte de Ventas a 1366 px:** la tabla conserva `table-fixed`, `colgroup` y `min-w`; se desplaza en su caja y la
   página no. Revisión en navegador, Tarea 9.

---

### Tarea 1: Tesorería — marco, pestañas comunes y vista principal

**Archivos:**
- Modificar: `apps/portal/src/components/tesoreria/pantalla-tesoreria.tsx`, `apps/portal/src/components/tesoreria/pestana-vista.tsx`
- Prueba: `tesoreria/pantalla-tesoreria.test.tsx`, `tesoreria/pestana-vista.test.tsx`

**Interfaces:**
- Consume: `Pestanas({ pestanas: { valor, etiqueta, contenido }[], valorInicial?, conservarMontadas?, etiqueta? })` de
  `components/ui/pestanas.tsx` (leerlo: cómo avisa del cambio de pestaña); `FiltroFechas({ id, desde, hasta, onCambio,
  onMostrar, deshabilitado?, children?, acciones? })`.
- Las pestañas hijas (`PestanaMovimientos`, `PestanaCuentas`, `PestanaSaldos`) conservan sus props.

- [ ] **Paso 1: Pruebas.** En `pantalla-tesoreria.test.tsx`: `heading` nivel 1 "Tesorería" con la descripción §3.1; las
  pestañas son `role="tab"` de las permitidas y nada más; la de `?vista=` arranca elegida; cambiar de pestaña escribe
  `?vista=` en la URL; volver a "Tesorería" después de abrir otra pestaña vuelve a consultar (Punto a revisar 2). Ajustar
  las existentes que dependían de los botones hechos a mano.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar.** `PantallaTesoreria`: `Pantalla` > `EncabezadoPantalla` > `Pestanas` con
  `conservarMontadas` (la vista no se desmonta; Cuentas/Saldos/Movimientos pueden montarse al abrirse como hoy, solo si
  `Pestanas` lo permite sin cambiar su API; si no, quedan montadas y lo dice el informe). Los estados de hoy ("Cargando…",
  sin permiso) con `EstadoPantalla titulo="Tesorería"`. `PestanaVista`: `FiltroFechas id="teso"` (conserva `activa`), las
  tablas "Tesorería por cuenta" y "Movimientos del rango" con `CajaTabla`/`Tabla`/`TdMonto`/`FilaTotal`, errores con
  `Aviso`.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Tesorería con encabezado, pestañas comunes y vista con filtro común`.

### Tarea 2: Tesorería — Movimientos (registrar fijo, editar en ventana)

**Archivos:**
- Modificar: `apps/portal/src/components/tesoreria/pestana-movimientos.tsx`, `apps/portal/src/components/tesoreria/formulario-movimiento.tsx`
- Prueba: `tesoreria/pestana-movimientos.test.tsx`

**Interfaces:**
- `FormularioMovimiento` conserva sus props (`cuentas`, `movimiento`, `alGuardar`, `alCancelar?`); su `h3` sale cuando
  va dentro de la ventana (el título lo pone `Ventana`) — prop nueva `sinTitulo?: boolean` o equivalente.

- [ ] **Paso 1: Pruebas.**
  - `"Editar abre una ventana con el formulario de edición y el de arriba sigue diciendo Registrar operación"`: `dialog`
    con nombre "Editar depósito" (o el tipo del movimiento); el formulario fijo conserva lo que tenía escrito
    (Punto a revisar 1).
  - `"guardar la edición cierra la ventana y recarga la lista"`.
  - `"Eliminar pide confirmar"`: `alertdialog` `¿Eliminar el depósito de $X del dd/mm/aaaa?` con descripción "No se
    puede deshacer." y botón "Eliminar movimiento"; confirmado llama al servicio; Cancelar no.
  - Las existentes que usaban `vi.spyOn(window, "confirm")` pasan a la ventana.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** Arriba: `FormularioMovimiento` solo para registrar (`movimiento={null}`, `key` fijo).
  Edición: `Ventana abierta={editando !== null} titulo={…}` con `FormularioMovimiento movimiento={editando}`; al guardar
  `setEditando(null)` y recargar. Filtro "Desde/Hasta" con `FiltroFechas id="movs"` (consulta como hoy); tabla común con
  montos alineados. Campos del formulario con `Campo` + controles comunes.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Movimientos de Tesorería con registro fijo, edición en ventana y confirmar`.

### Tarea 3: Tesorería — Cuentas, Saldos y Destinos

**Archivos:**
- Modificar: `apps/portal/src/components/tesoreria/pestana-cuentas.tsx`, `formulario-cuenta-tesoreria.tsx`,
  `pestana-saldos.tsx`, `seccion-destinos.tsx` (todos en `components/tesoreria/`)
- Prueba: `tesoreria/pestana-cuentas.test.tsx`, `tesoreria/pestana-saldos.test.tsx`, `tesoreria/seccion-destinos.test.tsx`

**Interfaces:** `PantallaCatalogo` (Etapa 2) si encaja sin cambiar su API; si no, `useCatalogo` + `Ventana` +
`useConfirmar` a mano con el mismo aspecto.

- [ ] **Paso 1: Pruebas.**
  - Cuentas: "Nueva cuenta"/"Editar" abren `dialog`; "Eliminar" → `alertdialog` `¿Eliminar la cuenta "X"?` / "Su historia
    se conserva, pero ya no aparecerá en la Tesorería." / "Eliminar cuenta"; un 409 o 403 del servidor sale en un
    `alert` con su mensaje y la fila sigue (Punto a revisar 3).
  - Saldos: "Eliminar" un saldo → `alertdialog` `¿Eliminar el saldo de "X" del dd/mm/aaaa?` / "La Tesorería volverá a
    usar el anterior." / "Eliminar saldo"; confirmar y cancelar.
  - Destinos: las existentes siguen pasando.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** Cuentas: tabla común, alta/edición en `Ventana`, formulario con campos comunes (sin `h2`
  propio). Saldos: fecha con `Campo`, tablas "Saldos del día" y "Saldos fijados" a la tabla común (la rejilla sigue
  editable en su lugar, guarda en lote como hoy), `useConfirmar`. Destinos: tabla común y `Lista`.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Cuentas, Saldos y Destinos de Tesorería con piezas comunes y confirmar`.

### Tarea 4: Flujo de Efectivo

**Archivos:** Modificar `apps/portal/src/components/flujo-efectivo/pantalla-flujo-efectivo.tsx`; prueba
`flujo-efectivo/pantalla-flujo-efectivo.test.tsx`.

- [ ] **Paso 1: Pruebas.** `heading` nivel 1 "Flujo de Efectivo" con la descripción §3.1; el filtro tiene los atajos
  "Hoy", "Ayer", "Esta semana", "Este mes"; rango invertido muestra "La fecha inicial no puede ser posterior a la final."
  y no consulta (Punto a revisar 4); las 4 tablas conservan sus nombres accesibles; "Exportar a Excel" exporta con la
  definición de hoy.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar** como Kilometraje: `Pantalla` > `EncabezadoPantalla` > `FiltroFechas id="flujo"
  acciones={<BotonExcel …/>}` > `Aviso` > tablas en `CajaTabla` (`TdMonto`, `FilaTotal`; `% de cobro` y textos tal
  cual). Estados con `EstadoPantalla`.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Flujo de Efectivo con filtro, Excel y tablas comunes`.

### Tarea 5: Cuentas por Cobrar

**Archivos:** Modificar `apps/portal/src/components/cuentas-por-cobrar/pantalla-cuentas-por-cobrar.tsx`,
`tabla-cuentas-por-cobrar.tsx`; prueba `cuentas-por-cobrar/pantalla-cuentas-por-cobrar.test.tsx`.

- [ ] **Paso 1: Pruebas.** Encabezado con la descripción §3.1; sin sucursal muestra el texto común de "elige sucursal"
  (si hoy la pide); la fila de un cliente se despliega y pliega como hoy; Excel como hoy.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar.** Encabezado con `BotonExcel` en `acciones`; su filtro con `Campo` + control común; tabla y
  detalle desplegable con la tabla común (`Fila interactiva` en la que se despliega, `aria-expanded` como hoy).
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Cuentas por Cobrar con encabezado, Excel y tabla común`.

### Tarea 6: Reporte de Ventas

**Archivos:** Modificar `apps/portal/src/components/reporte-ventas/pantalla-reporte-ventas.tsx`,
`tabla-reporte-ventas.tsx`; prueba `reporte-ventas/pantalla-reporte-ventas.test.tsx`.

- [ ] **Paso 1: Pruebas.** Encabezado con la descripción §3.1; filtro con atajos y la lista de repartidor como hijo de
  `FiltroFechas`; rango invertido no consulta; Excel como hoy.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar.** `FiltroFechas id="rv"` con `children` = `Campo` + `Lista` del repartidor y
  `acciones={<BotonExcel …/>}`; las dos tablas con `Tabla`/`Th`/`Td`/`TdMonto`/`FilaGrupo`/`FilaTotal`, **conservando**
  `table-fixed`, el `colgroup` y el `min-w-[61rem]` de T-49 (Punto a revisar 5).
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: Reporte de Ventas con filtro común y tablas comunes`.

### Tarea 7: Reportes (lista) y Clientes nuevos

**Archivos:** Modificar `apps/portal/src/components/reportes/lista-reportes.tsx`, `pantalla-clientes-nuevos.tsx`,
`tabla-clientes-nuevos.tsx`; pruebas `reportes/lista-reportes.test.tsx`, `reportes/pantalla-clientes-nuevos.test.tsx`.

- [ ] **Paso 1: Pruebas.** Lista: `heading` nivel 1 "Reportes" con su descripción §3.1, un enlace por reporte permitido
  con su explicación de hoy. Clientes nuevos: encabezado, atajos de fecha, rango invertido no consulta, Excel como hoy.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar.** Lista: `Pantalla` > `EncabezadoPantalla` > lista sencilla (cada reporte: nombre como
  enlace + su explicación de hoy, en una caja con borde de 10 px como `CajaTabla`, tono suave al pasar el mouse).
  Clientes nuevos: como Kilometraje (`FiltroFechas id="cn"` + `BotonExcel`, tabla común).
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 3: lista de Reportes y Clientes nuevos con piezas comunes`.

### Tarea 8: Documentación

**Archivos:** `CLAUDE.md` (bloque "Portal UI"); vault `../jawa-obsidian-memory/20-Arquitectura/Portal Web.md` y
`40-Equipo/Bitácora/<fecha>.md`.

- [ ] **Paso 1:** `grep -rn "window.confirm" apps/portal/src/components` → solo Ruta diaria (2) y Recarga (1).
- [ ] **Paso 2:** CLAUDE.md: quitar Tesorería, Reporte de Ventas, Clientes nuevos, Flujo y Cuentas por Cobrar de "Siguen
  con el estilo de antes" (quedan Registrar venta, Promociones, Ruta diaria; Recarga y Gastos de Mario) y anotar la
  regla de Movimientos (registro fijo + edición en ventana) si aporta.
- [ ] **Paso 3:** vault: sección corta de Etapa 3 en Portal Web y bitácora del día. Commit del vault **sin push**.
- [ ] **Paso 4: Commit** `Portal UI Etapa 3: CLAUDE.md al día con finanzas e informes`.

### Tarea 9: Revisión en navegador (controlador)

- [ ] Backend en 3010 contra el Postgres local, portal con `.next` limpio (ver memoria "usuarios de prueba en local").
- [ ] A 1366 y 1920 px con `revision` y `revision-tj`: Tesorería (las 4 pestañas, registrar y editar un movimiento,
  eliminar con confirmar y cancelar), Flujo, Cuentas por Cobrar, Reporte de Ventas, Reportes y Clientes nuevos; sin
  desplazamiento horizontal de la página. Hallazgos → una ola de arreglos con su revisión.
