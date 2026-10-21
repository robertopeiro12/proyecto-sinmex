# Portal UI Etapa 4 (Operación) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** pasar Registrar venta, Promociones y Ruta diaria a las piezas comunes de `components/ui/`, con los 2
`window.confirm` de Ruta diaria en `useConfirmar`.

**Arquitectura:** cambio de aspecto pantalla por pantalla, sin tocar reglas ni llamadas a la API. Referencias: un
formulario a pantalla completa ya migrado es `components/clientes/pantalla-clientes.tsx` (Etapa 2); un formulario con
campos comunes, `components/vehiculos/formulario-vehiculo.tsx`; avisos y confirmar, `components/tesoreria/pestana-saldos.tsx`
(Etapa 3).

**Tecnología:** Next.js 15, React 19, `@base-ui/react` 1.6, Tailwind 4, Vitest + Testing Library + `user-event`.

**Spec:** `docs/superpowers/specs/2026-10-21-portal-ui-etapa-4-operacion-design.md`

## Restricciones globales

- Solo `apps/portal` (y CLAUDE.md/vault en la Tarea 4). Nada de backend, base, app ni migraciones.
- No cambia ninguna regla, cálculo, llamada a la API ni texto de negocio (etiquetas, validaciones, mensajes del servidor,
  textos de "vacío"); se conservan ids de campos y `aria-label`.
- Piezas: solo lo que exporta `components/ui/` (`Pantalla`, `EncabezadoPantalla`, `EstadoPantalla`, `Aviso`, `Campo`,
  `Entrada`, `Lista`, `AreaTexto`, `Casilla`, `CajaTabla`, `Tabla`, `Th`, `Td`, `Fila`, `FilaVacia`, `Monto`,
  `useConfirmar`, `Button`). Sin `Card`. El título de la pantalla es el `h1` del encabezado; secciones con `h2`.
- Las líneas de descripción son las de la tabla §3.1 del spec, copiadas tal cual.
- Cada tarea termina con `npm test --workspace=apps/portal`, `npx tsc --noEmit -p apps/portal` y
  `npm run lint --workspace=apps/portal` limpios.

## Puntos a revisar

1. **Ruta diaria: cancelar "Descartar cambios"** al cambiar vendedor, fecha o sucursal deja todo igual (selección,
   filas, "Cambios sin guardar"). Prueba en la Tarea 3.
2. **Ruta diaria: dos cambios seguidos con la pregunta abierta** — solo cuenta el último (la anterior se contesta "no").
   Prueba en la Tarea 3.
3. **Editar venta comparte piezas con Registrar venta:** sus pruebas siguen pasando y su flujo no cambia. Tarea 1.
4. **Promociones a pantalla completa:** `h1` con el título del formulario y "← Volver a promociones"; volver no guarda.
   Prueba en la Tarea 2.
5. **Registrar venta a 1366 px** con varias líneas de productos: sin desplazamiento horizontal de la página. Navegador,
   Tarea 5.

---

### Tarea 1: Registrar venta

**Archivos:** Modificar `apps/portal/src/components/ventas/pantalla-registrar-venta.tsx`,
`campos-condiciones-venta.tsx`, `selector-repartidor.tsx`; pruebas `ventas/pantalla-registrar-venta.test.tsx` (y que
pasen `ventas/formulario-editar-venta.test.tsx`, `ventas/pantalla-ventas.test.tsx`).

- [ ] **Paso 1: Pruebas.** `heading` nivel 1 "Registrar venta" con la descripción §3.1; el aviso de posible duplicado
  sale como `Aviso` de advertencia (`role="status"`) con su texto de hoy; al grabar, la vista "Venta registrada" conserva
  folio, monto, status, "Si hay nota de papel, anota el folio en ella." y "Registrar otra", dentro de un `Aviso` de éxito.
- [ ] **Paso 2:** correr → FALLAN las nuevas.
- [ ] **Paso 3: Implementar.** `Pantalla` > `EncabezadoPantalla` en las dos vistas (captura y "Venta registrada"); los
  bloques en el mismo orden; `campos-condiciones-venta` y `selector-repartidor` con `Campo` + controles comunes (ids y
  etiquetas iguales); error con `Aviso tono="error"`.
- [ ] **Paso 4:** pruebas pasan (incluidas las de editar venta); verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 4: Registrar venta con encabezado, campos y avisos comunes`.

### Tarea 2: Promociones

**Archivos:** Modificar `apps/portal/src/components/catalogo/pantalla-catalogo.tsx` (solo el modo `"pantalla"`),
`promociones/pantalla-promociones.tsx`, `promociones/formulario-promocion.tsx`; pruebas
`catalogo/pantalla-catalogo.test.tsx`, `promociones/pantalla-promociones.test.tsx`, `promociones/formulario-promocion.test.tsx`.

**Interfaces:** `PantallaCatalogo` ya tiene `descripcion?`, `tituloFormulario?(item)` y `formularioEn`. En modo
`"pantalla"` con el formulario abierto debe pintar: "← Volver a {titulo en minúsculas}" + `EncabezadoPantalla` con
`tituloFormulario(item)` (si viene) + el formulario.

- [ ] **Paso 1: Pruebas.** `pantalla-catalogo.test.tsx`: el modo pantalla muestra `heading` nivel 1 con
  `tituloFormulario(item)`. Promociones: la lista lleva la descripción §3.1; "Nueva promoción" abre a pantalla completa
  con `h1` "Nueva promoción" y "← Volver a promociones" (volver no llama al servicio; Punto a revisar 4); editar muestra
  `h1` "Editar promoción".
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** El cambio del modo pantalla en `PantallaCatalogo`; Promociones pasa `descripcion` y
  `tituloFormulario` (`p ? "Editar promoción" : "Nueva promoción"`); `formulario-promocion.tsx` sin su `h2`, controles a
  `Campo` + comunes (ids y lógica de la regla iguales), error con `Aviso`.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 4: Promociones a pantalla completa con encabezado y campos comunes`.

### Tarea 3: Ruta diaria

**Archivos:** Modificar `apps/portal/src/components/rutas/pantalla-ruta-diaria.tsx`, `lista-ruta-diaria.tsx`,
`cartera-ruta.tsx`; pruebas `rutas/pantalla-ruta-diaria.test.tsx`, `rutas/lista-ruta-diaria.test.tsx`,
`rutas/cartera-ruta.test.tsx`.

- [ ] **Paso 1: Pruebas.**
  - Encabezado con la descripción §3.1.
  - Con cambios sin guardar, cambiar de vendedor abre `alertdialog` "¿Descartar los cambios de la ruta?" / "Hay cambios
    sin guardar en la ruta." / botón "Descartar cambios": confirmar aplica el vendedor nuevo; cancelar deja vendedor,
    filas y "Cambios sin guardar" igual (Punto a revisar 1). Lo mismo para la fecha.
  - Cambio de sucursal con el vendedor elegido fuera de la lista nueva y cambios sin guardar: pregunta; cancelar conserva
    el vendedor en la lista (comportamiento de hoy); confirmar lo suelta.
  - Dos cambios seguidos con la pregunta abierta: solo se aplica el último (Punto a revisar 2).
  - Las existentes que simulaban `window.confirm` pasan a la ventana.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** `Pantalla` > `EncabezadoPantalla`; selectores con `Campo`; avisos con `Aviso` en su tono
  ("Cambios sin guardar" `advertencia`, "Ruta guardada." `exito`, los demás `informacion`, error `error`), en su lugar de
  hoy. `puedeDescartar` asíncrona con `useConfirmar` (pinta `{ventana}`); los cambios se aplican solo si confirma, con
  los valores capturados al preguntar; el `.then` del cambio de sucursal conserva su guarda `vigente`. El aviso
  `beforeunload` no cambia. Listas de ruta y cartera en cajas con borde de 10 px (como `CajaTabla`), renglones separados
  por línea, títulos `h2`, botones `Button`, buscador con `Entrada`; orden y controles por renglón iguales.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 4: Ruta diaria con piezas comunes y confirmar al descartar cambios`.

### Tarea 4: Documentación

- [ ] `grep -rn "window.confirm" apps/portal/src/components` → solo Recarga (1) (más el comentario de `ui/confirmar.tsx`).
- [ ] CLAUDE.md, bloque "Portal UI": "Siguen con el estilo de antes" ya no lista pantallas propias del portal; solo queda
  la nota de que Recarga y Gastos son de Mario (Recarga conserva su `window.confirm`). Mencionar que el modo pantalla de
  `PantallaCatalogo` pinta el encabezado con `tituloFormulario`.
- [ ] Vault: sección corta de Etapa 4 en `20-Arquitectura/Portal Web.md` (`actualizado:` 2026-10-21) y bitácora
  `40-Equipo/Bitácora/2026-10-21.md` (qué cambió, sin migraciones, el portal queda completo salvo Recarga y Gastos, PR por
  abrir). Commit del vault **sin push**.
- [ ] **Commit** `Portal UI Etapa 4: CLAUDE.md al día; el portal entero usa las piezas comunes`.

### Tarea 5: Revisión en navegador (controlador)

- [ ] Backend 3010 contra la base local, portal con `.next` limpio; `revision` y `revision-tj` a 1366 y 1920 px:
  registrar una venta de prueba en local, Promociones (nueva, editar, volver), Ruta diaria (cambiar vendedor con cambios:
  cancelar y descartar). Hallazgos → una ola de arreglos con su revisión.
