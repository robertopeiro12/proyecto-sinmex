# Retiro de merma con autorización — diseño (Registro de Operación, parte 2)

Fecha: 2026-11-25 · Rama: `feature/retiro-merma` (desde `main`) · Portal + backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`): **Módulo de Producción e Inventarios 2026-11-16 (fuente)** (Registro de Operación →
Retiro de Mermas; Inventario de PT con Ventas → Merma acumulada y Retiro de merma).

## Para qué

Las piezas de merma se juntan en el almacén hasta que se tiran. El cliente audita esa merma (sobre todo la de Mexicali:
"para que no nos metan un gol"): Producción anota lo que se va a tirar y **Administración lo valida físicamente** antes de
que cuente. El retiro autorizado es el que restará en la *Merma acumulada* del Inventario de PT con Ventas (paso futuro;
aquí nadie lo lee todavía).

## Lo que dice el cliente

- **C1.** "Retiro de Mermas: son las piezas que se van a tirar a la basura y que físicamente las validamos en
  administración."
- **C2.** "Debe registrar por default el día actual o seleccionar días anteriores."
- **C3.** "Se tiene que validar, entonces debemos poner un tipo de validación o autorización por parte de Administración
  para que se pueda tomar como registro efectivo. Esto es para validar lo teórico que sucede en el portal web vs lo que
  sucede en la realidad."
- **C4.** "Merma Acumulada: es la merma del día anterior + la merma del día – retiro de mermas" (para después).

## Decisiones de Roberto

- **R1 (2026-11-18).** Funciona como las Peticiones de borrar pago: uno pide y otro autoriza.
- **R2 (2026-11-24).** Autoriza quien tiene **`peticiones.gestionar`** (el mismo permiso de las peticiones de pagos).
- **R3 (2026-11-24).** Un retiro **rechazado se corrige y se reenvía**: al editarlo vuelve a *Pendiente*.

## Decisiones mías

- **D1. Es una operación más.** `operacion_almacen.tipo` admite `retiro_merma` (el check `ck_operacion_almacen_tipo` se
  amplía); se captura igual que las demás (rejilla de productos por tamaño con TAB, `lineas` por presentación). Fecha:
  hoy o cualquier día anterior (la misma regla que merma/consumo). Pestaña **"Retiro de merma"** al final del Registro de
  Operación, con el permiso nuevo **`operacion.retiro_merma`** (pedir, corregir, eliminar).
- **D2. Estado.** Columnas nuevas en `operacion_almacen`, solo para `retiro_merma` (check: nulas en los demás tipos):
  `estado` (`pendiente` | `autorizado` | `rechazado`), `resuelto_por_usuario_id`, `resuelto_en`, `motivo_rechazo`
  (1..300, solo y obligatorio en `rechazado`). Nace `pendiente`.
- **D3. Quién toca qué.**
  - Producción (`operacion.retiro_merma`): crea; edita y elimina mientras esté **pendiente o rechazado**; editar un
    rechazado lo regresa a **pendiente** y limpia el motivo y la resolución. Un **autorizado no se toca** (409).
  - Administración (`peticiones.gestionar`): **autoriza** o **rechaza con motivo** un retiro **pendiente** de su alcance de
    sucursal. Autorizar/rechazar uno que ya no está pendiente = 409 con el estado actual. Puede ser la misma persona
    que lo pidió (como en las peticiones de pagos).
  - Concurrencia: autorizar, rechazar, editar y eliminar bloquean la fila (`for update`) y deciden sobre lo bloqueado.
- **D4. Dónde se autoriza.** *Operación → Peticiones* gana una sección **"Retiro de merma"** (debajo de las de pagos o
  como pestaña de la pantalla, lo que encaje con `bandeja-peticiones`): los retiros **pendientes** de las sucursales que
  alcanza el usuario, con sucursal, fecha, quién lo pidió y cuándo, piezas totales y productos; botones **Autorizar** y
  **Rechazar** (pide el motivo en una `Ventana`). Endpoints nuevos: `GET /operaciones-almacen/retiros-pendientes?sucursal`,
  `POST /operaciones-almacen/:id/autorizar`, `POST /operaciones-almacen/:id/rechazar` (`{ motivo }`), con
  `@RequierePermiso('peticiones.gestionar')`.
- **D5. En la pestaña** la lista del día muestra el estado con `Etiqueta` (Pendiente amarillo, Autorizado verde,
  Rechazado rojo con el motivo debajo) y quién lo resolvió y cuándo; Editar/Eliminar solo si no está autorizado.
- **D6. Sin cálculo.** Nada suma ni resta todavía (lo leerá el Inventario de PT con Ventas, solo los autorizados).

## Nube

Una migración (ampliar el check de tipo, columnas nuevas con sus checks, permiso `operacion.retiro_merma`). Pre-flight:
nada que contar (no hay filas `retiro_merma`; las columnas nacen nulas y los checks las aceptan en los demás tipos).
Backend y portal juntos.

## Pruebas

pgTAP de los checks de estado; unit de reglas (transiciones permitidas); e2e: crear, editar pendiente, editar rechazado
→ pendiente, autorizado intocable (409), autorizar/rechazar con y sin permiso, alcance de sucursal, autorizar dos veces
(409), rechazar sin motivo (400); portal: pestaña por permiso, estados en la lista, sección de Peticiones con autorizar y
rechazar (motivo obligatorio). Navegador a 1366 px.
