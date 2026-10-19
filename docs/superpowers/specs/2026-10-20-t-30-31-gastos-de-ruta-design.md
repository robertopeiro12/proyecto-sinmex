# T-30 / T-31 · Gastos de la ruta y catálogo de campos de egreso (spec)

**Fecha:** 2026-10-20 · **Estado:** diseño aprobado en diálogo con Mario, falta su revisión de este texto.
**Issues:** #30 (completo) y #31 (la parte de la ruta). Es la pieza 6 del rediseño de la app (spec de T-37, "El rediseño completo, en piezas").
**Depende de:** T-28 ✅ y T-29 ✅ (Tesorería), T-37 ✅, T-39 ✅ (canal de fotos generalizado).
**Vault:** [[Compras y Egresos]], [[Tesorería]], [[Flujo de Efectivo]], [[Corte de caja]], [[App Tablet]].

## Para qué

En la ruta, el vendedor paga cosas con lo que cobra: hielo, gasolina, alguna reparación del carro y a veces un adelanto de su sueldo. Así lo dicen las fuentes del cliente: *"Tesorería = Cobranza – Gastos"*. Hoy la app no tiene dónde anotarlos: la entrada "Gastos" del menú dice "pendiente". Además, la operación `gasto` ya existe en el contrato, pero solo se guarda en el buzón, sin proyectar.

Con esta pieza:
- La oficina administra los **campos de egreso** (T-30).
- El vendedor registra sus gastos sin red.
- Esos gastos llegan a una tabla `gasto` y restan en Tesorería del mismo efectivo al que ya suma su cobranza.
- La oficina los consulta en el portal.

El corte (T-33) los va a leer de ahí.

## Respuestas de Mario (2026-10-20)

1. **Alcance:** esta pieza cubre los gastos de la ruta y el catálogo. Capturar, editar y borrar compras de oficina desde el portal, con cualquier método y días anteriores, queda para el siguiente ticket (el resto de T-31).
2. **Qué campos ve el vendedor:** cada campo trae la casilla **"Se usa en la app"**.
3. **Tesorería:** el gasto de la ruta **resta de la cuenta de efectivo de su sucursal**, que es la misma adonde T-29 suma la cobranza en efectivo, en la fecha del gasto.
4. **Comprobante:** la foto del ticket es **opcional**.

## Decisiones

**D1 · Tipos de egreso fijos.** Son tres: `produccion`, `operacion` y `financiero`, con las etiquetas "Producción", "Operación" y "Financiero".
- El cliente dijo que "ya deben de venir grabados" y no se crean desde la app ni el portal.
- Son un check (`tipo in (...)`) en la tabla de campos, no una tabla aparte.

**D2 · Catálogo `campo_egreso` (servidor).** Columnas:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | |
| `nombre` | text not null | check `btrim(nombre) <> ''` |
| `tipo` | text not null | check de D1 |
| `se_usa_en_app` | boolean not null | default false |
| `deleted_at` | timestamptz | baja lógica |
| `creado_en` | timestamptz | patrón de `motivo_visita` |
| `actualizado_en` | timestamptz | trigger `set_actualizado_en()` |

- Nombre único entre vivos: `uq_campo_egreso_nombre` sobre `lower(btrim(nombre)) where deleted_at is null`.
- **Semilla:**

| Nombre | Tipo | Se usa en la app |
|---|---|---|
| Envases | Producción | no |
| Celular | Operación | no |
| Gastos diversos | Operación | no |
| Ajustes x no cuadrar | Operación | no |
| Gasolina | Operación | **sí** |
| Hielo | Operación | **sí** |
| Reparación del vehículo | Operación | **sí** |
| Adelanto de sueldo | Operación | **sí** |

- **Baja:** es lógica, y se **rechaza con 409** si el campo tiene gastos vivos en el año calendario en curso (zona de Tijuana). El motivo dice: "Este campo tiene gastos este año; podrás darlo de baja el próximo año." Es la regla del cliente: "no se puede eliminar hasta el siguiente año".
- **Editar** el nombre, el tipo o la casilla siempre se puede. Los gastos ya registrados guardan una copia del nombre y del tipo (D4).
- Permiso nuevo **`campo_egreso.gestionar`**, en el grupo General.

**D3 · Portal: Catálogo › Campos de egreso.**
- Una pantalla de catálogo con las columnas Nombre, Tipo y "Se usa en la app".
- Un formulario con el nombre, el tipo (de los tres) y la casilla. La baja pide confirmación.
- Endpoints `GET`, `POST`, `PATCH` y `DELETE` en `/campos-egreso`, con el mismo patrón que Motivos de visita (T-39).

**D4 · Tabla `gasto` (servidor).** Columnas:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid pk | es **la clave de la operación**, adoptada como en T-39 |
| `sucursal_id` | uuid not null, FK | la del vendedor |
| `vendedor_id` | uuid, FK | **nulo** se reserva para las compras de oficina del siguiente ticket |
| `capturo_usuario_id` | uuid, FK | nulo por ahora |
| `campo_egreso_id` | uuid not null, FK | |
| `campo_nombre` | text not null | copia al proyectar |
| `tipo` | text not null | copia al proyectar; mismo check de D1 |
| `fecha` | date not null | el `fecha_operacion` del sobre; el día al que cuenta |
| `registrado_en` | timestamptz not null | |
| `monto` | numeric(14,2) not null | check `> 0` |
| `metodo` | text not null | check `in ('efectivo_cobranza_dia')`; el siguiente ticket lo amplía |
| `quien` | text | quién hizo el gasto; en la app, el nombre del vendedor al proyectar |
| `factura` | text not null | default `'N/A'` |
| `comentario` | text | hasta 200 caracteres |
| `foto_archivo` | text | con `foto_subida_en`; check de foto completa como `visita` |
| `foto_subida_en` | timestamptz | |
| `origen` | text not null | check `in ('app','portal')`; la tablet manda `app` |
| `deleted_at` | timestamptz | |
| `creado_en` | timestamptz | |

- Check: `origen = 'app'` exige `vendedor_id`.
- Índices sobre `(sucursal_id, fecha)`, `(vendedor_id, fecha)` y `(campo_egreso_id, fecha)`.

**D5 · Operación `gasto` en el push.** Ya existe en `TIPOS_OPERACION`; deja de guardarse sin proyectar. **`CONTRATO_ACTUAL` sigue en 1.**
- El sobre **no** lleva `cliente_id` (un gasto no es de un cliente) ni folio.
- Los datos:

```ts
export type DatosGasto = {
  campo_egreso_id: string;   // uuid
  monto_centavos: number;    // entero 1..999_999_999_999
  registrado_en: string;     // ISO-8601 con zona
  comentario?: string | null; // <= 200
};
```

- `prepararGasto` (`despacho-gasto.ts`) valida:
  - que la clave sea un uuid;
  - la forma de los datos.
  - Los textos se recortan y uno vacío cuenta como `null`.
  - Cualquier falla es `datos-invalidos`, con un motivo.
- La proyección es `GastosService.registrarGasto(datos, contexto, trx)`, en `modules/compras-egresos/` (ADR-0009). Inserta con `id = clave`, `metodo = 'efectivo_cobranza_dia'` y `origen = 'app'`, y copia el nombre y el tipo del campo.
- Rechazos nuevos, aditivos:
  - **`campo-egreso-inexistente`**: el id no existe. Un campo **dado de baja sí se acepta**, igual que el motivo de la visita.
  - **`gasto-id-ocupado`**, con un motivo neutro.
- **El servidor no revisa "se usa en la app".** La oficina puede cambiar la casilla mientras la tablet está sin red.
- **Operaciones `gasto` viejas en el buzón:** hoy ninguna tablet las manda (la pantalla no existe). Si hubiera, quedan en el buzón sin proyectar y sin relleno, como pasó con la jornada en T-38.
- **Orden del push:** `jornadas → prospectos → ventas → cobranzas → visitas → gastos → rutas`.

**D6 · El catálogo baja en el pull.** `catalogos.campos_egreso: {id, nombre, tipo, se_usa_en_app, activo}[]`. Es incremental por `actualizado_en`, y la baja viaja como `activo: 0`, igual que `motivos_visita`.

**D7 · Tesorería: el gasto de la ruta resta del efectivo de su sucursal.**
- `movimientosDeSaldo` (`tesoreria/reglas-saldo.ts`) recibe los gastos vivos con `metodo = 'efectivo_cobranza_dia'` del rango, agrupados por sucursal y fecha.
- Cada grupo es un movimiento **negativo** en la cuenta destino vigente de `(sucursal, 'efectivo')` en esa fecha, la misma regla `destinoDe` de la cobranza (T-29).
- Se **lee** de la tabla `gasto` y no se copia nada, como hace T-29 con la cobranza.
- Si no hay cuenta destino, el gasto entra a una lista **"sin cuenta"** paralela a la de cobranza sin destino, y la vista lo avisa igual.
- Hay un evento nuevo en `EventoTesoreria`: `{ tipo: 'gasto-ruta', fecha, cuentaId, monto, sucursal }`, con la etiqueta "Gastos de ruta". Agrupa el total del día, no cada gasto.
- La firma de `armarVista` gana `gastos` dentro de `extras`, sin romper a quien no lo pase.

**D8 · Tablet: datos locales (migración 015).**
- `campo_egreso`: réplica del pull.
- `gasto`: `id`, `campo_egreso_id`, `campo_nombre`, `monto_centavos`, `comentario`, `fecha`, `registrado_en`, los cuatro campos de foto (como `visita`), `sync_estado` y `sync_error`.
- Un repositorio `gastos.ts` con `registrar` (exige la jornada abierta, en una transacción), `delDia(vendedorId, fecha)`, `totalDelDia`, `pendientesDeSincronizar`, `marcarSincronizada` y `marcarError`.
- `fuente-gastos.ts`.
- **Fotos:** la cola combinada de T-39 gana la fuente de gastos. El canal `POST /sync/foto/:clave` acepta operaciones `gasto`, y el archivo se llama `gasto-<id>.jpg`.

**D9 · Tablet: pantalla "Gastos"** (sustituye a la entrada pendiente del menú).
- Arriba, **"Gastos de hoy"**: cada gasto con su campo, su monto, su hora y una pastilla de subida (por subir, subido, rechazado con su motivo). Abajo, el **total del día**.
- Botón **"Registrar gasto"**, que abre un formulario:
  - el **campo**, eligiendo entre los activos con `se_usa_en_app`, ordenados por nombre;
  - el **monto** en pesos, mayor que 0 y con dos decimales a lo más;
  - las **observaciones**, opcionales y de hasta 200 caracteres;
  - **"Tomar foto del ticket"**, opcional;
  - el método se muestra fijo: "Efectivo cobranza del día".
- **Guardar** queda deshabilitado mientras falte algo. Tiene guardia contra el doble toque (la lección de T-39). Al guardar, vuelve a la lista con el aviso "Gasto registrado".
- **Sin catálogo** (sin campos con la casilla), la pantalla lo dice y no deja registrar.
- **Con el día cerrado**, la entrada del menú queda deshabilitada como las demás y la pantalla tampoco deja registrar.
- La validación vive en la función pura `validarGasto(...)`, en `src/estado/gasto.ts`, con pruebas.
- El monto se convierte a centavos con una función pura y probada: la entrada "12.5" da 1250 y "12.345" se rechaza.
- **Un gasto grabado no se edita ni se borra en la app**, igual que la venta. Las correcciones serán desde el portal en el siguiente ticket.
- El botón de la ficha "Merma, promoción, consumo y gasto" cambia su texto a **"Merma, promoción y consumo"**, porque el gasto ya tiene su pantalla. Sigue pendiente de T-27.

**D10 · Portal: Finanzas › Gastos (consulta).**
- Una tabla con los filtros **desde/hasta** (por defecto, hoy en Tijuana), **sucursal** (con el filtro global), **vendedor** y **campo**.
- Las columnas son: Fecha, Hora, Sucursal, Vendedor, Campo, Tipo, Monto, Comentario y Ticket. La de Ticket tiene un ícono que abre la foto, servida con el mismo patrón que la foto del cliente en el portal.
- Debajo, el **total**.
- `GET /gastos?desde&hasta&sucursal&vendedor&campo` con permiso nuevo **`gasto.ver`** (Finanzas), el alcance de sucursal del usuario y un rango máximo de 366 días.
- `GET /gastos/:id/foto` con el mismo permiso y alcance. Otra sucursal da 404.
- Tiene que caber en una ventana de 1366 px.

## Fuera de alcance

- Capturar, editar y borrar compras de oficina en el portal, con cualquier método y días anteriores. Es lo que falta de T-31, en el siguiente ticket. Este spec ya deja la tabla y el servicio listos para eso.
- El corte de caja (T-33) y el Flujo de Efectivo (T-32): leerán la tabla `gasto`.
- Exportar a Excel la lista de gastos. Se agrega fácil con `exportarExcel` si se pide.

## Errores y casos límite

- **Campo dado de baja después de capturar sin red:** el gasto sube igual (D5).
- **La oficina apaga "se usa en la app"** mientras la tablet está sin red: el gasto ya capturado sube igual. El siguiente pull quita el campo de la lista.
- **Monto con más de dos decimales, 0 o negativo:** la tablet no deja guardar. Si llegara así, el servidor lo rechaza con `datos-invalidos`.
- **Reenvío** (`duplicada`): una sola fila y un solo archivo `gasto-<id>.jpg`.
- **Sucursal sin cuenta de efectivo configurada:** Tesorería muestra el gasto en "sin cuenta" y no lo pierde.
- **Gasto a una hora en que en UTC ya es otro día:** cuenta en `fecha_operacion` (el día de Tijuana), nunca re-derivado de UTC.

## Pruebas

- **Backend unit:**
  - `prepararGasto`, regla por regla;
  - `GastosService`;
  - la regla de baja del campo, con el borde de año en Tijuana;
  - `movimientosDeSaldo` con gastos: cuenta vigente, sin cuenta y varios días.
- **Backend e2e:**
  - push de un gasto con y sin foto;
  - campo dado de baja aceptado, e inexistente rechazado;
  - id ocupado y reenvío `duplicada`;
  - el pull trae los campos y la baja;
  - CRUD de campos con permiso, sin permiso, nombre duplicado y baja bloqueada por gastos del año;
  - `GET /gastos` con filtros, alcance, rango y la foto;
  - Tesorería resta el gasto de la cuenta de efectivo de la sucursal.
- **pgTAP:** los checks de `campo_egreso` y `gasto`, la semilla y los permisos.
- **Tablet (Jest):**
  - `validarGasto` y la conversión del monto;
  - el repositorio de gastos (incluido el día cerrado);
  - `fuentesDelPush` con el orden nuevo;
  - la migración 015.
- **Portal:** las pantallas de campos y de gastos, con el patrón de T-65.
- **Aceptación en el emulador:**
  1. Sin red, registrar "Gasolina $250.50" con foto y "Hielo $80".
  2. Comprobar que la lista muestra el total.
  3. Sincronizar.
  4. En Postgres: las dos filas y `gasto-<id>.jpg`.
  5. En el portal (o por API): Finanzas › Gastos las muestra y Tesorería resta $330.50 del efectivo de TJ.

## Memoria y documentos

- `CLAUDE.md`: bloque nuevo de gastos (T-30/T-31). También se corrige la línea TODO de `contrato.ts` que atribuye `gasto` a T-27.
- `docs/contrato-sincronizacion.md`: `gasto` deja de ser "sin proyectar"; se documentan `campos_egreso` en el pull y el canal de fotos.
- Vault, al terminar:
  - [[Compras y Egresos]], para cerrar dudas. "Efectivo cobranza del día" en Tesorería es la cuenta destino del efectivo de la sucursal.
  - [[Tesorería]] y [[Corte de caja]].
  - Estado del proyecto y la bitácora.

## Nota de la rama

La migración del servidor se llama `20261020120000_gastos_ruta.sql`, con un timestamp único (ver el [PR #139](https://github.com/robertopeiro12/proyecto-sinmex/pull/139)). La migración local de la tablet es la **015**, porque la 014 ya es de T-72.
