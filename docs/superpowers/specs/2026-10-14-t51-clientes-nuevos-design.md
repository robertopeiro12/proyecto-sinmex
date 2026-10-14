# T-51 · Reporte de Clientes nuevos (Portal) — Diseño

**Issue:** [#51](https://github.com/robertopeiro12/proyecto-sinmex/issues/51) (depende de T-12 y T-15, mergeados).
**Fecha:** 2026-10-14 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Estadísticas y Reportes.md`, `Cartera de Clientes.md` y `Cliente.md` del vault; T-12 (`cartera-clientes/`,
alta de cliente), T-70 (convertir prospecto en cliente), T-50/T-49 (`modules/estadisticas/`, `validarRango`, pantallas
de reporte, tabla que cabe desde 1366 px); T-15 (`apps/portal/src/lib/excel/`); T-09 (`resolverAlcance`).

## 1. Para qué

Fuente del cliente (`Cambios v2.0`, Información → Reportes):

> Incluir reporte de Clientes. Tal cual está el reporte de Promoción, en donde se incluyan los clientes nuevos
> registrados de acuerdo al rango de fechas. En la información a mostrar, en lugar de "vendedor" que sea "Usuario".

Issue #51: "Como administrador, quiero listar los clientes nuevos por rango de fechas para dar seguimiento al
crecimiento de la cartera." Criterios:

- [ ] Lista de clientes nuevos por rango.
- [ ] Usa el término 'Usuario' (v2.0) en vez de 'vendedor'.
- [ ] Exportable a Excel; filtro por sucursal.

**Hallazgo:** `cliente` no guarda **quién** lo dio de alta ni **cuándo** un prospecto se convirtió en cliente (solo
`created_at` del registro). Sin eso no hay columna "Usuario" ni fecha correcta para un prospecto convertido.

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`** ni el contrato de sincronización.

## 2. Decisiones de producto (Roberto, 2026-10-14)

| Tema | Decisión |
|---|---|
| Usuario y fecha de alta | **Empezar a guardarlos**: cada cliente registra cuándo quedó como cliente y qué usuario del portal lo dio de alta (alta directa o conversión de prospecto). Los que ya existen: fecha = creación del registro, Usuario "—" |
| Prospecto convertido | Cuenta como cliente nuevo **el día que se convirtió**, con el usuario que lo convirtió |
| Ubicación y permiso | **Información → Reportes → Clientes nuevos**, con `reportes.ver` (donde lo ubicó el cliente) |
| Lo que no entra | Conteo por usuario, gráfica de crecimiento, quién prospectó en la tablet |

## 3. Reglas

- **Universo:** `cliente.tipo = 'cliente'` cuya **fecha de alta** cae en el rango. Un cliente **dado de baja**
  después (`deleted_at` no nulo) **sí aparece**, marcado "(dado de baja)": fue un cliente nuevo en ese rango. Los
  prospectos sin convertir no aparecen.
- **Fecha de alta** = `coalesce(alta_cliente_en, created_at)`, convertida a **fecha de Tijuana**
  (`(… at time zone 'America/Tijuana')::date`). Un alta a las 19:00 de Tijuana cuenta ese día, no el siguiente.
- **Usuario** = `usuario.nombre` de `alta_cliente_usuario_id`; nulo → "—".
- **Sucursal** = la del cliente. Alcance con `resolverAlcance(usuario.codigo, normalizarSucursalPedida(q.sucursal))`.
- **Rango** obligatorio, máximo 366 días, con `validarRango` de T-50 (mismos mensajes).
- **Orden:** fecha de alta asc, luego nombre (`localeCompare(…, 'es')`).

## 4. Backend

### 4.1 Migración

`supabase/migrations/20261014140000_cliente_alta.sql`:

```sql
alter table cliente
  add column alta_cliente_en timestamptz,
  add column alta_cliente_usuario_id uuid references usuario(id) on delete set null,
  add constraint ck_cliente_alta_usuario_con_fecha
    check (alta_cliente_usuario_id is null or alta_cliente_en is not null);
```

- **No rellena datos**: el reporte usa `coalesce(alta_cliente_en, created_at)`. Así cubre también clientes creados por
  otros caminos (semillas, pruebas).
- **`on delete set null`:** el portal da de baja usuarios con `deleted_at`, pero las suites e2e borran sus usuarios de
  verdad (a veces antes que sus clientes); sin esto, un alta hecha en una prueba bloquearía esa limpieza. Si un usuario
  se borra, el cliente se queda sin Usuario ("—").
- **Pre-flight para la nube:** no aplica. Solo agrega dos columnas nulas y un `check` que las filas existentes cumplen
  por construcción (ambas nulas). `migration list` antes y después, como siempre.
- pgTAP: las columnas existen, son nulas por defecto, el check rechaza usuario sin fecha, y la FK a `usuario`.
- `npm run db:types` regenera `schema.d.ts` con las dos columnas.

### 4.2 Dónde se llenan

- **Alta en el portal** (`ClientesService.crear` → `ClientesRepository.crear`): si `tipo = 'cliente'`,
  `alta_cliente_en = now()` y `alta_cliente_usuario_id = usuarioId`. Si `tipo = 'prospecto'`, ambas nulas.
- **Convertir prospecto** (`ClientesService.convertirACliente` → `ClientesRepository.convertirACliente`):
  `set({ tipo: 'cliente', alta_cliente_en: now(), alta_cliente_usuario_id: usuarioId })`.
- El prospecto de la tablet (`crearProspecto`) no cambia: nace prospecto, sin alta.
- Ninguna otra ruta cambia `tipo`.

### 4.3 Endpoint

`GET /reportes/clientes-nuevos?desde&hasta&sucursal` en `modules/estadisticas/` (mismo `ReportesController`), con
`@RequierePermiso('reportes.ver')`. Archivos: `reporte-clientes-nuevos.repository.ts`,
`reporte-clientes-nuevos.service.ts`, `reglas-clientes-nuevos.ts` (+ `.spec.ts`), `dto/reporte-clientes-nuevos.dto.ts`.

```ts
type ReporteClientesNuevos = {
  desde: string; hasta: string;
  clientes: ClienteNuevo[];
  total: number;
};
type ClienteNuevo = {
  id: string;
  fechaAlta: string;            // 'AAAA-MM-DD' de Tijuana
  nombre: string;
  sucursalCodigo: string;
  tipoNegocio: string | null;
  listaPrecio: string | null;
  telefono: string;
  encargado: string | null;
  usuario: string | null;       // null = no se sabe ("—")
  dadoDeBaja: boolean;
};
```

### 4.4 Pruebas

- Unitarias de las reglas: orden (fecha, luego nombre), total, lista vacía.
- e2e contra Postgres local (sucursal propia de la suite, ordenada después de TJ y sin chocar con `ZA`–`ZH`, `ZQ`, `ZV`):
  - `POST /clientes` con tipo cliente guarda `alta_cliente_en` y el usuario; con tipo prospecto, nulas;
  - `POST /clientes/:id/convertir-a-cliente` guarda fecha y usuario de la conversión;
  - el reporte: prospecto sin convertir fuera; dado de baja dentro y marcado; cliente sin `alta_cliente_en` usa
    `created_at` y Usuario `null`; prospecto creado hace días y convertido hoy cuenta hoy;
  - límite de medianoche de Tijuana: un alta a las 06:30 UTC del día D+1 (= 23:30 del día D en Tijuana) cae en D;
  - alcance (atado a una sucursal no ve otra; pedir otra → 403), sin `reportes.ver` → 403, sin sesión → 401, rango
    inválido/invertido/> 1 año → 400.

## 5. Portal

### 5.1 Ruta y lista de reportes

`/informacion/reportes/clientes-nuevos`: server component delgado con `key={sucursal}` + `PantallaClientesNuevos`.
`components/reportes/lista-reportes.tsx` agrega el enlace "Clientes nuevos" con su descripción. Cliente HTTP y Excel en
`apps/portal/src/lib/reporte-clientes-nuevos.ts`.

### 5.2 Filtros

- Desde / Hasta, por defecto del día 1 del mes a hoy (Tijuana), como Kilometraje.
- Atajos **Hoy / Esta semana / Este mes** reutilizando `rangoSemana` y `rangoMes` de `lib/reporte-ventas.ts` (no se
  copian).
- **Mostrar** (siempre activo) y **Exportar a Excel** (deshabilitado sin resultados o mientras carga). Nada se consulta
  al abrir. Fechas invertidas → "La fecha inicial no puede ser posterior a la final." y no consulta.

### 5.3 Tabla (cabe desde 1366 px)

- Una sola `<table>` `table-fixed`, letra 13 px, mismo relleno horizontal en todas las celdas, encabezado fijo.
- Columnas: Fecha de alta · Cliente · Sucursal · Tipo de negocio · Lista de precios · Teléfono · Encargado · Usuario.
- **Anchos medidos en el navegador** sobre el texto real para que quepa sin desplazarse desde **1366 px** de ventana
  (≈1012 px de caja); Cliente es la columna flexible. Textos largos con `truncate` y `title`.
- "(dado de baja)" junto al nombre; Usuario `null` → "—"; Tipo de negocio / Lista / Encargado nulos → "—".
- Arriba: "Del dd/mm/aaaa al dd/mm/aaaa · Sucursal: …" (lo consultado) y "N clientes nuevos" (singular "1 cliente
  nuevo").

### 5.4 Estados

Sesión cargando → "Cargando…"; sin `reportes.ver` → "No tienes permiso para ver reportes" (sin peticiones); sin
resultados → "No hay clientes nuevos en ese rango."; error → mensaje del servidor en `role="alert"`; reconsultar →
"Actualizando…" con la tabla atenuada; solo la última consulta escribe.

### 5.5 Excel

`exportarExcel` con lo consultado: título "Clientes nuevos"; filtros Rango y Sucursal; las 8 columnas (Fecha de alta
tipo `fecha`); fila `total` "Total: N clientes nuevos" al final; archivo `clientes-nuevos_<desde>_a_<hasta>`.

### 5.6 Pruebas de pantalla

Atajos, fechas invertidas, "—" y "(dado de baja)", alineación (`table-fixed`, relleno en toda celda, cada fila suma el
número de columnas), respuesta vieja no pisa a la nueva (probada en RED una vez), Excel de lo consultado, sin permiso →
mensaje y ninguna petición, sesión cargando → "Cargando…".

### 5.7 Prueba a mano

Navegador contra la base **local**: alta en el portal y conversión de un prospecto (para ver el Usuario), cliente dado
de baja, nombres largos; medir a 1366 y 1440 px; Excel abierto; capturas.

## 6. Vault (al terminar)

- `Cliente.md`: campos nuevos (fecha y usuario de alta como cliente).
- `Estadísticas y Reportes.md`: callout de T-51.
- `Estado del proyecto.md`: fila T-51. Bitácora del día. Sin ADR.

## 7. Fuera de alcance

- Conteo de altas por usuario, gráfica de crecimiento de la cartera.
- Quién prospectó al cliente en la tablet (está en la bitácora de sincronización; se puede agregar después).
- Rellenar el usuario de los clientes que ya existen (no hay de dónde sacarlo).
