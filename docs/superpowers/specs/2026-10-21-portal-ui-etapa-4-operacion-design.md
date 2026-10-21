# Portal · UI parejo, Etapa 4 (Operación) — Diseño

**Fecha:** 2026-10-21 · **Estado:** aprobado en conversación por Roberto
**Base:** Etapas [1](2026-10-20-portal-ui-etapa-1-design.md), [2](2026-10-21-portal-ui-etapa-2-catalogos-design.md) y
[3](2026-10-21-portal-ui-etapa-3-finanzas-reportes-design.md) (PRs #144, #145, #146). Sin ticket de GitHub.

## 1. Para qué y alcance

Última etapa: las tres pantallas de Operación que faltan pasan a las piezas comunes de `components/ui/`.

- **Registrar venta** (`ventas/pantalla-registrar-venta.tsx`, `campos-condiciones-venta.tsx`, `selector-repartidor.tsx`;
  `tabla-productos-venta.tsx` y `buscador-cliente.tsx` ya usan piezas comunes y también los usa editar venta).
- **Promociones** (`promociones/pantalla-promociones.tsx`, `formulario-promocion.tsx`).
- **Ruta diaria** (`rutas/pantalla-ruta-diaria.tsx`, `lista-ruta-diaria.tsx`, `cartera-ruta.tsx`) y sus 2
  `window.confirm`.

Al terminar solo queda el `window.confirm` de **Recarga** (de Mario). Recarga y Gastos no se tocan.

**Qué no cambia:** reglas, cálculos, endpoints, backend, base, app, textos de negocio (etiquetas, validaciones, mensajes
del servidor, textos de "vacío"), el flujo de capturar una venta, la regla de promociones y cómo se arma y guarda la ruta.

## 2. Decisiones (Roberto, 2026-10-21)

| Tema | Decisión |
|---|---|
| Partición | Un solo PR con las 3 pantallas. |
| Promociones | El formulario es largo: **pantalla completa** (regla de la Etapa 2), con título grande y "← Volver a promociones" como Clientes. |
| Ruta diaria | "Hay cambios sin guardar en la ruta. ¿Descartarlos?" pasa a `useConfirmar` en los 2 lugares (cambiar vendedor/fecha y cambio de sucursal). El aviso propio del navegador al cerrar la pestaña (`beforeunload`) se queda: no se puede reemplazar. |

## 3. Reglas que aplican (las mismas de la Etapa 3)

`Pantalla` > `EncabezadoPantalla` (título + línea de §3.1); sin `Card`; estados con `EstadoPantalla`; errores con
`Aviso tono="error"`, éxitos con `Aviso tono="exito"`, avisos neutros con `tono="informacion"` y advertencias con
`tono="advertencia"`; campos con `Campo` + `Entrada`/`Lista`/`AreaTexto`/`Casilla` conservando ids, etiquetas y
validaciones; confirmar con `useConfirmar()`; botones del formulario con el orden de su modo (pantalla completa: Guardar
primero, como editar venta y Clientes).

### 3.1 Líneas de descripción

| Pantalla | Descripción |
|---|---|
| Registrar venta | Captura una venta de la oficina: cliente, productos, condiciones y quién la entrega. |
| Promociones | Los regalos por compra que la app aplica sola en cada venta. |
| Ruta diaria | Los clientes que visita cada vendedor en un día, en el orden en que los atiende. |

## 4. Registrar venta

- Encabezado común; los bloques de hoy se quedan en el mismo orden.
- `campos-condiciones-venta.tsx` y `selector-repartidor.tsx` a `Campo` + controles comunes (los usa también editar venta:
  sus pruebas deben seguir pasando).
- El aviso de posible venta duplicada con `Aviso tono="advertencia"`; el error con `Aviso tono="error"`; el éxito (si
  lo hay hoy) con `Aviso tono="exito"`. Mismos textos.

## 5. Promociones

- Lista: `PantallaCatalogo` ya pone encabezado y tabla comunes; se le pasa su `descripcion` (§3.1) y `tituloFormulario`.
- **Modo pantalla de `PantallaCatalogo`:** con el formulario abierto pinta "← Volver a …" **y** `EncabezadoPantalla`
  con `tituloFormulario(item)` (hoy solo pinta el botón y el formulario trae su propio `h2`). Así queda igual que Clientes
  y Usuarios. Promociones es la única que usa ese modo.
- `formulario-promocion.tsx`: se quita su `h2` ("Nueva promoción" / "Editar promoción", que pasa a `tituloFormulario`);
  controles a `Campo` + comunes conservando ids y la lógica de la regla; error con `Aviso`.

## 6. Ruta diaria

- Encabezado común; selectores de vendedor y fecha con `Campo`; los botones de hoy ("Guardar", "Cargar ruta anterior",
  etc.) se quedan. Los avisos ("Ruta guardada.", "Se cargó la ruta del …", "Este vendedor no tiene una ruta anterior.")
  con `Aviso` en su tono; "Cambios sin guardar" con `tono="advertencia"`.
- `lista-ruta-diaria.tsx` y `cartera-ruta.tsx`: su aspecto con las piezas comunes (caja con borde de 10 px, títulos
  `h2`, controles comunes); su comportamiento (arrastrar u ordenar, agregar de la cartera) no cambia.
- **Confirmar:** `useConfirmar` con título "¿Descartar los cambios de la ruta?", descripción "Hay cambios sin guardar en la
  ruta." y botón "Descartar cambios". `puedeDescartar` pasa a ser asíncrona; mientras se pregunta, el vendedor y la fecha
  elegidos no cambian (los selectores son controlados). En el cambio de sucursal, la pregunta se hace dentro del `.then`
  respetando la guarda `vigente` de hoy.

## 7. Pruebas y revisión

- Las pruebas existentes siguen pasando; las que simulan `window.confirm` pasan a la ventana (`alertdialog`).
- Pruebas nuevas: encabezados con su descripción; Promociones abre a pantalla completa con `h1` del título y "← Volver";
  Ruta diaria pregunta antes de descartar al cambiar de vendedor, de fecha y de sucursal (confirmar y cancelar; al cancelar
  no cambia nada).
- `npm test --workspace=apps/portal`, `tsc --noEmit`, lint y `next build` limpios.
- Navegador a **1366 y 1920 px** contra la base local (usuarios `revision` y `revision-tj`).
- Al terminar: CLAUDE.md ("Siguen con el estilo de antes" queda vacío salvo Recarga y Gastos) y el vault.

## 8. Fuera de alcance

Cambiar la captura de ventas, la regla de promociones o cómo se arma la ruta; Recarga y Gastos; Ruta semanal (aún no
existe).
