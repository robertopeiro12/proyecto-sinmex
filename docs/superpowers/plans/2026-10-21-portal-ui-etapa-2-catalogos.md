# Portal UI Etapa 2 (Catálogos) — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDO: superpowers:subagent-driven-development (recomendado) o
> superpowers:executing-plans, tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** pasar los 10 catálogos del portal a las piezas comunes de la Etapa 1, con el formulario corto en una ventana y
los largos (Clientes, Usuarios) a pantalla completa, y quitar sus 6 `window.confirm`.

**Arquitectura:** una pieza nueva `Ventana` (base-ui `Dialog`) en `components/ui/`; `PantallaCatalogo` se rehace con
`EncabezadoPantalla` + tabla común + `Ventana` y gana baja opcional, y la usan 6 catálogos; Clientes y Usuarios siguen con
pantalla propia pero cambian la lista por el formulario como `pantalla-ventas.tsx`; Perfiles y Precios solo cambian de marco.

**Tecnología:** Next.js 15, React 19, `@base-ui/react` 1.6, Tailwind, Vitest + Testing Library + `user-event`.

**Spec:** `docs/superpowers/specs/2026-10-21-portal-ui-etapa-2-catalogos-design.md`

## Restricciones globales

- Solo `apps/portal`. Nada de backend, base de datos, app de tablet ni migraciones.
- No cambia ningún texto de negocio: etiquetas de campos, validaciones, mensajes del servidor, textos de "vacío".
- Recarga y Gastos (de Mario) no se tocan. Tesorería y Ruta diaria tampoco (Etapas 3 y 4).
- Para confirmar: `useConfirmar()` de `components/ui/confirmar.tsx`, nunca `window.confirm`. La pantalla pinta `{ventana}`.
- Formatos y piezas: solo lo que exporta `components/ui/` (`Pantalla`, `EncabezadoPantalla`, `EstadoPantalla`, `Aviso`,
  `CajaTabla`, `Tabla`, `Th`, `Td`, `Fila`, `FilaVacia`, `Campo`, `Entrada`, `Lista`, `AreaTexto`, `Casilla`, `Button`).
- Las líneas de descripción son las de la tabla §4.1 del spec, copiadas tal cual.
- Cada tarea termina con `npm test --workspace=apps/portal`, `npx tsc --noEmit -p apps/portal` y
  `npm run lint --workspace=apps/portal` limpios.

## Puntos a revisar

1. **Esc o clic fuera con el formulario a medio guardar:** la ventana se cierra y la respuesta que llegue después no
   debe pintar nada ni lanzar un aviso de React por estado en componente desmontado. La tabla se recarga igual si guardó.
   Prueba en la Tarea 2.
2. **Pasar de "Editar A" a "Editar B"** sin cerrar no puede pasar (los botones se deshabilitan con la ventana abierta),
   pero cerrar A y abrir B debe mostrar los valores de B (el `key` por item). Prueba en la Tarea 2.
3. **Baja rechazada por el servidor (409 de Campos de egreso, "podrás darlo de baja el próximo año"; perfil con usuarios
   activos):** el mensaje del servidor se ve tal cual en un `Aviso` de error y la fila sigue ahí. Pruebas en las Tareas 2
   y 7.
4. **"← Volver" en Clientes y Usuarios con cambios sin guardar:** regresa sin preguntar (igual que Cancelar hoy) y la
   lista se ve recargada con el filtro de tipo y la sucursal intactos. Prueba en las Tareas 5 y 6.
5. **Rejilla ancha a 1366 px (Perfiles con 6+ perfiles, Precios con varias listas):** se desplaza dentro de su caja, la
   página no. Revisión en navegador, Tarea 8.

---

### Tarea 1: Pieza `Ventana`

**Archivos:**
- Crear: `apps/portal/src/components/ui/ventana.tsx`
- Prueba: `apps/portal/src/components/ui/ventana.test.tsx`

**Interfaces:**
- Produce: `export function Ventana(props: { abierta: boolean; alCerrar: () => void; titulo: string; ancho?: "normal" |
  "ancho"; children: ReactNode }): JSX.Element`

- [ ] **Paso 1: Pruebas que fallan** en `ventana.test.tsx`:
  - `"abierta muestra un dialog con su título"`: `getByRole("dialog", { name: "Editar Jamaica" })` y el contenido hijo.
  - `"cerrada no pinta nada"`: `queryByRole("dialog")` es null.
  - `"Esc llama a alCerrar"`: `usuario.keyboard("{Escape}")` → `alCerrar` llamado 1 vez.
  - `"el foco entra al primer campo"`: con un `<input aria-label="Nombre" />` de hijo, tras abrir `toHaveFocus()`.
- [ ] **Paso 2:** `npx vitest run src/components/ui/ventana.test.tsx` (desde `apps/portal`) → FALLA, no existe el módulo.
- [ ] **Paso 3: Implementar** con `Dialog` de `@base-ui/react/dialog` (`Root` controlado con `open` y `onOpenChange(abrir
  => !abrir && alCerrar())`, `Portal`, `Backdrop`, `Popup`, `Title`). Copiar las clases de fondo, sombra, radio y
  animación de `confirmar.tsx`. Ancho: `normal` = `w-[min(32rem,92vw)]`, `ancho` = `w-[min(44rem,92vw)]`.
  `max-h-[90dvh] overflow-y-auto` en el `Popup`. Título con `font-titulo text-[19px] font-bold`. Sin botones propios.
- [ ] **Paso 4:** la prueba pasa; las tres verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: pieza Ventana para formularios cortos`.

### Tarea 2: `PantallaCatalogo` y `TablaCatalogo` con las piezas comunes

**Archivos:**
- Modificar: `apps/portal/src/components/catalogo/pantalla-catalogo.tsx`, `apps/portal/src/components/catalogo/tabla-catalogo.tsx`
- Modificar: `apps/portal/src/components/{productos,vehiculos,sucursales,vendedores}/pantalla-*.tsx`,
  `apps/portal/src/components/promociones/pantalla-promociones.tsx`
- Prueba: crear `apps/portal/src/components/catalogo/pantalla-catalogo.test.tsx`; ajustar
  `catalogo/tabla-catalogo.test.tsx`, `sucursales/pantalla-sucursales.test.tsx`, `vendedores/pantalla-vendedores.test.tsx`,
  `promociones/pantalla-promociones.test.tsx`

**Interfaces:**
- Consume: `Ventana` (Tarea 1); `useConfirmar`, `OpcionesConfirmar` (`components/ui/confirmar.tsx`); `mensajeDe(err, porDefecto)` de
  `apps/portal/src/lib/api.ts`.
- Produce, props nuevas de `PantallaCatalogo<T>` (las de hoy se conservan):
  ```ts
  descripcion?: string;
  tituloFormulario?: (item: T | null) => string;      // obligatorio en modo "ventana"
  formularioEn?: "ventana" | "pantalla";              // "ventana" por omisión
  baja?: {
    etiqueta?: string;                                 // "Dar de baja" por omisión
    confirmar: (item: T) => OpcionesConfirmar;
    ejecutar: (item: T) => Promise<void>;
    mensajeError: string;                              // si el error no trae mensaje
  };
  ```
- `TablaCatalogo` conserva su API exacta (`items`, `columnas`, `vacio`, `acciones`).

- [ ] **Paso 1: Pruebas que fallan** en `pantalla-catalogo.test.tsx` (con un `T = { id: string; nombre: string }`, un
  formulario de prueba con un campo "Nombre" y botones Guardar/Cancelar, y `useAuth` simulado como en
  `pantalla-sucursales.test.tsx`):
  - `"muestra título, descripción y la tabla"`: `heading` nivel 1 con el título; el texto de `descripcion`; una fila por item.
  - `"sin permiso no hay alta, ni Editar, ni baja"`.
  - `"Nuevo abre la ventana con el título del formulario y Guardar la cierra y recarga"`: `dialog` con nombre
    `tituloFormulario(null)`; al guardar, `dialog` desaparece y `cargar` se llamó 2 veces.
  - `"Cancelar y Esc cierran sin recargar"`.
  - `"cerrar A y abrir B muestra los valores de B"` (Punto a revisar 2).
  - `"Esc a media petición cierra y la respuesta tardía no rompe"` (Punto a revisar 1): el guardar del formulario de
    prueba devuelve una promesa que se resuelve después de cerrar; no hay error en consola y `cargar` se vuelve a llamar.
  - `"modo pantalla cambia la lista por el formulario y ← Volver regresa"`: no hay `dialog`; botón `← Volver a
    {titulo en minúsculas}`; la tabla no está mientras el formulario está abierto.
  - `"baja confirmada ejecuta y recarga"`: clic en la etiqueta → `alertdialog` con el título de `confirmar(item)` → clic
    en su botón → `ejecutar(item)` 1 vez y `cargar` 2 veces.
  - `"baja cancelada no ejecuta"`.
  - `"baja rechazada muestra el mensaje del servidor y la fila sigue"` (Punto a revisar 3): `ejecutar` rechaza con un
    error de API de mensaje "Podrás darlo de baja el próximo año." → `getByRole("alert")` con ese texto.
- [ ] **Paso 2:** correr la prueba → FALLA.
- [ ] **Paso 3: Implementar.**
  - `PantallaCatalogo`: `Pantalla` > `EncabezadoPantalla` (`acciones` = botón de alta) > `Aviso` de error (carga o baja) >
    `EstadoPantalla tipo="cargando"` sin título mientras carga > `CajaTabla` con `TablaCatalogo`. Botones de fila: "Editar"
    y, con `baja`, el de baja (`"Eliminando…"` mientras corre; todos deshabilitados con formulario abierto o baja en curso).
    Modo `"ventana"`: `<Ventana abierta={edicion !== null} titulo={tituloFormulario(item)} alCerrar={cerrar}>` con el
    formulario dentro y el `key` por item de hoy. Modo `"pantalla"`: con formulario abierto, devuelve solo
    `Button variant="ghost"` "← Volver a {titulo.toLowerCase()}" + el formulario. Pinta `{ventana}` de `useConfirmar`.
  - `TablaCatalogo`: `Tabla` > `thead` con `Th` (y `Th` con `sr-only` "Acciones" alineado a la derecha) > `tbody` con
    `Fila`/`Td` y `FilaVacia columnas={…}` con `vacio`. `columna.className` va al `Td`.
  - Productos, Vehículos, Sucursales, Vendedores: pasan `descripcion` (§4.1) y `tituloFormulario` con el texto exacto
    del `h2` de su formulario (`p ? \`Editar ${p.nombre}\` : "Nuevo producto"`; Sucursales usa `codigo`). El `h2` de cada
    formulario se quita en la Tarea 3.
  - Promociones: `formularioEn="pantalla"`, sin `descripcion` (su etapa es la 4).
- [ ] **Paso 4:** ajustar las pruebas existentes: lo que buscaba el `heading` "Nueva sucursal"/"Nuevo vendedor" lo busca
  como `dialog` con ese nombre y consulta dentro con `within(dialog)`. Todas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: pantalla de catálogo con encabezado, tabla común, ventana y baja opcional`.

### Tarea 3: Formularios de Productos, Vehículos, Sucursales y Vendedores con campos comunes

**Archivos:**
- Modificar: `apps/portal/src/components/{productos,vehiculos,sucursales,vendedores}/formulario-*.tsx`
- Prueba: ajustar `sucursales/pantalla-sucursales.test.tsx`, `vendedores/pantalla-vendedores.test.tsx` solo si alguna
  consulta dependía del marcado viejo.

**Interfaces:**
- Consume: `Campo`, `Entrada`, `Lista`, `Casilla` de `components/ui/campo.tsx`. Props de los formularios sin cambio.

- [ ] **Paso 1:** en cada formulario, quitar el `h2` y las clases de caja del `<form>` (`mb-6 rounded-md border p-4`),
  dejando `flex flex-col gap-4`. Cada `Label`+`Input`/`select` pasa a `Campo id etiqueta [opcional] [ayuda] [error]` con su
  control común; los ids existentes se conservan (las pruebas consultan por etiqueta). Botones al final:
  `div className="flex justify-end gap-2"` con Cancelar (`outline`) y luego Guardar.
- [ ] **Paso 2:** las pruebas existentes pasan sin cambiar sus consultas por etiqueta (`getByLabelText`), salvo el texto
  "(opcional)" que ahora forma parte de la etiqueta: donde un `getByLabelText` exacto falle por eso, cambiar a regex.
- [ ] **Paso 3:** verificaciones globales limpias.
- [ ] **Paso 4: Commit** `Portal UI Etapa 2: formularios de catálogo con campos comunes`.

### Tarea 4: Campos de egreso y Motivos de visita a la pantalla compartida

**Archivos:**
- Modificar: `apps/portal/src/components/campos-egreso/pantalla-campos-egreso.tsx`,
  `apps/portal/src/components/campos-egreso/formulario-campo-egreso.tsx`,
  `apps/portal/src/components/motivos-visita/pantalla-motivos-visita.tsx`,
  `apps/portal/src/components/motivos-visita/formulario-motivo-visita.tsx`
- Prueba: `campos-egreso/pantalla-campos-egreso.test.tsx`, `motivos-visita/pantalla-motivos-visita.test.tsx`

**Interfaces:**
- Consume: `PantallaCatalogo` con `baja` (Tarea 2).

- [ ] **Paso 1: Cambiar las pruebas de baja** (hoy `vi.spyOn(window, "confirm")`) a la ventana:
  - Campos: clic "Eliminar" → `alertdialog` con nombre `¿Eliminar el campo "Hielo"?` y texto "Los gastos ya registrados lo
    conservan, pero las tablets dejarán de ofrecerlo." → clic "Eliminar campo" → `eliminarCampoEgreso("…")` 1 vez.
  - Motivos: igual con `¿Eliminar el motivo "…"?`, "Las visitas ya registradas lo conservan, pero las tablets dejarán de
    ofrecerlo." y "Eliminar motivo".
  - Los formularios se buscan dentro del `dialog` ("Nuevo campo", "Nuevo motivo").
  - La prueba del 409 de Campos sigue esperando el mensaje del servidor en un `alert`.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3:** cada pantalla queda como Productos: `PantallaCatalogo` con su `titulo`, `permiso`, `etiquetaAlta`,
  `vacio`, `mensajeError`, columnas de hoy, `descripcion` (§4.1), `tituloFormulario` (el texto del `h2` de hoy) y `baja`
  `{ etiqueta: "Eliminar", confirmar, ejecutar: (c) => eliminarCampoEgreso(c.id), mensajeError: "No se pudo eliminar el
  campo." }` (Motivos: `eliminarMotivoVisita`, "No se pudo eliminar el motivo."). Sus formularios: lo mismo que la Tarea 3.
  Los comentarios de cabecera de cada pantalla se conservan.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: Campos de egreso y Motivos de visita en la pantalla compartida, con confirmar`.

### Tarea 5: Clientes — lista común y formulario a pantalla completa

**Archivos:**
- Modificar: `apps/portal/src/components/clientes/pantalla-clientes.tsx`, `apps/portal/src/components/clientes/formulario-cliente.tsx`,
  `apps/portal/src/components/clientes/selector-tipo-negocio.tsx`, `apps/portal/src/components/clientes/filtro-tipo.tsx`
- Prueba: `clientes/pantalla-clientes.test.tsx`

**Interfaces:**
- Consume: `TablaCatalogo` (Tarea 2), `useConfirmar`, piezas de `components/ui/`. Props de `FormularioCliente` sin cambio.

- [ ] **Paso 1: Pruebas que fallan / ajustadas:**
  - `"la lista muestra encabezado con descripción y el filtro"`: `heading` nivel 1 "Clientes", la descripción §4.1 y el
    filtro Clientes/Prospectos.
  - `"Nuevo cliente cambia la lista por el formulario y ← Volver a clientes regresa"`: tras clic, no está la tabla, hay
    `heading` "Nuevo cliente" y botón "← Volver a clientes"; al picarlo vuelve la tabla, `crearCliente` no se llamó y el
    filtro de tipo de la URL sigue igual (Punto a revisar 4).
  - Las de "Dar de baja" y "Convertir": de `window.confirm` a `alertdialog` — `¿Dar de baja a "X"?` / "Se conserva su
    historial." / botón "Dar de baja"; `¿Convertir a "X" en Cliente?` / "No se puede deshacer." / botón "Convertir en
    cliente". Cancelar no llama al servicio.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** Sin edición: `Pantalla` > `EncabezadoPantalla` (titulo "Clientes", descripción,
  `acciones` = `FiltroTipo` + "Nuevo cliente") > `Aviso` de error > `CajaTabla` + `TablaCatalogo`. Con edición: devuelve
  `Pantalla` > `Button variant="ghost"` "← Volver a clientes" > `EncabezadoPantalla` con el texto que hoy pone el `h2` del
  formulario > `FormularioCliente` (su `h2` se quita). Las dos `window.confirm` → `confirmar(...)`. En el formulario, sus 4
  `fieldset` se quedan; controles a `Campo` + comunes, ids conservados.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: Clientes con lista común y formulario a pantalla completa`.

### Tarea 6: Usuarios — lista común y formulario a pantalla completa

**Archivos:**
- Modificar: `apps/portal/src/components/usuarios/pantalla-usuarios.tsx`, `apps/portal/src/components/usuarios/formulario-usuario.tsx`
- Prueba: `usuarios/pantalla-usuarios.test.tsx`

**Interfaces:** como la Tarea 5, con `FormularioUsuario` (props sin cambio). `MatrizPermisosUsuario` no cambia por dentro.

- [ ] **Paso 1: Pruebas:** encabezado con la descripción §4.1; "Nuevo usuario" cambia a pantalla completa con "← Volver a
  usuarios" (regresa sin guardar, sucursal intacta); "Dar de baja" con `alertdialog` `¿Dar de baja a "X"?` / "Ya no podrá
  entrar al portal." / botón "Dar de baja", y Cancelar no llama al servicio.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3:** mismo patrón que la Tarea 5 (los `EstadoPantalla` de hoy se conservan). Formulario: `h2` fuera, 4
  `fieldset` con campos comunes, ids conservados.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: Usuarios con lista común y formulario a pantalla completa`.

### Tarea 7: Perfiles y Precios — marco común

**Archivos:**
- Modificar: `apps/portal/src/components/perfiles/pantalla-perfiles.tsx`, `apps/portal/src/components/perfiles/columna-perfil.tsx`,
  `apps/portal/src/components/precios/pantalla-precios.tsx`
- Prueba: crear `apps/portal/src/components/perfiles/columna-perfil.test.tsx`

**Interfaces:** `ColumnaPerfil` conserva sus props (`perfil`, `alCambiar`).

- [ ] **Paso 1: Pruebas que fallan** en `columna-perfil.test.tsx`:
  - `"Dar de baja pregunta y, confirmado, da de baja"`: `alertdialog` `¿Dar de baja el perfil "Ventas"?` / "Solo se puede
    si ningún usuario activo lo tiene." / botón "Dar de baja" → `darDeBajaPerfil` 1 vez y `alCambiar` 1 vez.
  - `"Cancelar no da de baja"`.
  - `"el rechazo del servidor se muestra"` (Punto a revisar 3): `darDeBajaPerfil` rechaza con "Hay usuarios activos con
    este perfil. Reasígnalos antes de darlo de baja." → ese texto en un `alert`.
- [ ] **Paso 2:** correr → FALLAN.
- [ ] **Paso 3: Implementar.** `ColumnaPerfil`: `window.confirm` → `useConfirmar` (pinta `{ventana}`). Las dos pantallas:
  quitar `Card`/`CardHeader`/`CardContent`; `Pantalla` > `EncabezadoPantalla` (titulo de hoy, descripción §4.1) > la
  matriz dentro de `CajaTabla` (en lugar del `div overflow-x-auto`). La tabla de la matriz y sus celdas no cambian.
- [ ] **Paso 4:** pruebas pasan; verificaciones globales limpias.
- [ ] **Paso 5: Commit** `Portal UI Etapa 2: Perfiles y Precios con encabezado común y confirmar`.

### Tarea 8: Revisión en navegador y documentación

**Archivos:**
- Modificar: `CLAUDE.md` (bloque "Portal UI (piezas comunes, Etapa 1)")
- Vault: `../jawa-obsidian-memory/20-Arquitectura/Portal Web.md`,
  `40-Equipo/Bitácora/<fecha>.md`

- [ ] **Paso 1:** confirmar que no queda `window.confirm` en los catálogos:
  `grep -rn "window.confirm" apps/portal/src/components` → solo Tesorería (3), Ruta diaria (2) y Recarga (1).
- [ ] **Paso 2:** levantar portal y backend contra el Postgres **local** (no `sinmex dev`: apuntar `DATABASE_URL` de
  `.env.development` al local mientras tanto; puerto del backend 3010). `.next` limpio antes de empezar.
- [ ] **Paso 3:** en Chrome incógnito a **1366 y 1920 px**, usuario General y usuario atado a una sucursal: cada uno de los
  10 catálogos abre, crea o edita, cancela con Esc y con el botón; las bajas piden confirmar; Clientes y Usuarios vuelven
  con "← Volver"; Perfiles y Precios sin desplazamiento horizontal de la página (Punto a revisar 5). Promociones sigue
  funcionando en modo pantalla.
- [ ] **Paso 4:** CLAUDE.md: agregar `Ventana` a la lista de piezas, la regla "formulario corto → `Ventana`, de varios
  bloques → pantalla completa con ← Volver" y quitar de "Siguen con el estilo de antes" los catálogos, Perfiles y Precios.
- [ ] **Paso 5:** vault: nota de Portal Web y bitácora del día (qué cambió, sin migraciones, Etapas 3 y 4 pendientes).
  Commit y push del vault.
- [ ] **Paso 6: Commit** `Portal UI Etapa 2: CLAUDE.md explica la Ventana y la regla de formularios`.
