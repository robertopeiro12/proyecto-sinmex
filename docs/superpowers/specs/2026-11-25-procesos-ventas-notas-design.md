# Operación → Procesos (PR B): Ventas y Notas — diseño

Fecha: 2026-11-25 · Rama: `feature/procesos-ventas-notas` · Portal (+ un ajuste chico de backend). Sin migración. La
tablet no cambia. Continúa `2026-11-25-procesos-design.md` (PR A, #169 y ajustes #172).

## Fuentes
- Cliente: *Nuevo Sistema Jawa Julio 2027* — "**Procesos:** capturar venta desde el portal, ver todas las ventas por
  fecha/folio/cliente, editar/eliminar, capturar mermas, promociones, consumos." *Cambios v2.0* — quitar "Tipo de pago"
  de la venta de Procesos (JAWA ya no lo tiene).
- Sistema viejo (`10-Dominio/Sistema viejo del cliente.md` § "Procesos a detalle", revisado en vivo el 2026-11-25):
  pestañas Ventas · Notas; Notas = buscar folio, casillas Factura y Pendiente de pago, Folio · Cliente · Fecha ·
  Detalle · Pendiente · Total · Historial de abonos · Abonar · Editar · Eliminar.
- Portal actual: *Registrar venta* (`components/ventas/pantalla-registrar-venta.tsx`), *Ventas*
  (`pantalla-ventas.tsx`, `detalle-venta.tsx`, `formulario-editar-venta.tsx`), *Facturas* (`components/facturas/`),
  *Cobranza* (`components/cobranza/`). Sus reglas de negocio (T-17, T-19, T-21, T-34) **no cambian**.
- Boceto aprobado por Roberto: `img/2026-11-25-procesos-boceto-notas.png` (estilo del boceto 2 de Procesos).

## Decisiones de Roberto (2026-11-25)
- **R1.** Procesos todo dentro, como el viejo: pestañas **Ventas · Notas** antes de Merma. *Registrar venta, Ventas,
  Facturas y Cobranza* salen del menú; sus direcciones redirigen. *Cuentas por Cobrar* y *Promociones* se quedan.
- **R2.** Notas junta Ventas + Facturas + Cobranza según el boceto. "Basarse en lo que dice el tío y cómo está el portal
  actual".
- **R3.** Cobrar: el botón de la barra dice **"Cobrar N notas…"**, abre el recuadro de cobro y **se oculta** mientras
  está abierto; **Cancelar** y **Grabar pago** juntos abajo a la derecha, después de "Así queda".

## Diseño
- **D1. Ventas** = el formulario de *Registrar venta* de hoy dentro de la pestaña, con el **cliente de arriba** (sin su
  propio buscador; sin cliente: "Elige un cliente arriba."). Mismo permiso `venta.registrar`, mismas reglas (folio de
  oficina, control de inventario, promociones libres, sin firma). Tras grabar, ofrece "Ver en Notas" y limpia el
  formulario. La sucursal es la del menú lateral (con "Todas" pide elegirla, como el resto de Procesos).
- **D2. Notas** (boceto):
  - Filtros en una fila: buscador **"Folio o # de nota"** + `SelectorSegmentado` **Con saldo** (por omisión) · **Por
    facturar** · **Todas**; con **Todas** aparece `FiltroFechas` (Desde/Hasta + atajos, botón Mostrar; por omisión este
    mes), porque el cliente pide "ver todas las ventas por fecha".
  - Con cliente elegido: sus notas. **Sin cliente**: solo se puede buscar por folio o # de nota, o usar **Todas** con
    fechas para toda la sucursal (como la pantalla *Ventas* de hoy); Con saldo y Por facturar dicen "Elige un cliente
    arriba.".
  - Tabla: ☐ · Folio · Fecha · # nota · Vendedor ("Oficina" si no tiene) · Total · **Saldo** (ámbar si > 0) · Status ·
    Factura (número, "Pendiente" o "N/A") · **Ver ›**. Orden: fecha y folio, más vieja primero en Con saldo; más nueva
    primero en Todas.
  - **Ver ›** abre el detalle de hoy (`detalle-venta.tsx`: productos, historial de abonos, firma, Editar, Eliminar,
    Cuenta perdida) dentro de la pestaña, con "← Volver a Notas" (pantalla completa, como hoy). Al volver, la lista se
    recarga.
  - Casillas: solo notas **del cliente elegido** (sin cliente no hay casillas). Al palomear sale la barra
    "**N notas** · saldo $X" con **Anotar factura** (si tiene `venta.asignar_factura` y todas las marcadas son
    facturables: `pendiente`) y **Cobrar N notas…** (si tiene `cobranza.registrar` y alguna tiene saldo).
  - **Cobrar**: el recuadro de cobro de *Cobranza* de hoy (`cobranza-cliente.tsx` / `registrar-pago.tsx` /
    `vista-previa-cobro.tsx`): monto, método, cobró (Oficina o vendedor), fecha, vista previa "Así queda" y, si el
    cliente tiene saldo a favor, **Usar saldo a favor** (`aplicar-saldo-favor.tsx`). Botonera según R3. Mismo backend
    (`/cobranzas/vista-previa`, `POST /cobranzas`, `/cobranzas/saldo-favor`), mismas reglas (409 si una nota ya no tiene
    saldo).
  - **Anotar factura**: la ventana de *Facturas* de hoy (número de factura para las marcadas, mismo backend
    `/facturas/asignar`). Corregir o quitar una factura ya anotada: desde el detalle de la nota o con el buscador de
    facturas de hoy dentro de una `Ventana` "Buscar factura" (enlace junto a los filtros, con `venta.asignar_factura`).
  - La línea del cliente de arriba suma **"A favor $X"** si tiene saldo a favor.
- **D3. Backend (lo mínimo).** `GET /ventas` (`BuscarVentasDto`) gana `folio` (exacto, sin mayúsculas/espacios),
  `filtro` = `con_saldo` | `por_facturar` | `todas` (por omisión `todas`, que conserva el comportamiento de hoy) y cada
  resultado trae `factura: { estado: 'N/A'|'pendiente'|'facturada'; numero: string|null }` y el vendedor. `con_saldo` =
  la regla de "nota con saldo" ya existente (no se duplica); `por_facturar` = `factura = 'pendiente'`. Con `con_saldo` o
  `por_facturar` no se aplican fechas y se exige `clienteId`. Sin cambios de permisos.
- **D4. Menú y redirecciones.** `nav-config.ts` quita Registrar venta, Ventas, Facturas y Cobranza.
  `/operacion/registrar-venta` → `/operacion/procesos?pestana=ventas`; `/operacion/ventas` y `/operacion/facturas` →
  `?pestana=notas`; `/operacion/cobranza?cliente&nota` → `?pestana=notas&cliente=<id>&nota=<id>` (cliente elegido y esa
  nota palomeada; lo usa el botón **Cobrar** de *Cuentas por Cobrar*). Conservan `?sucursal`. La pantalla de Procesos
  lee `pestana`, `cliente` y `nota` de la URL al entrar.
- **D5. Permisos por pestaña:** Ventas = `venta.registrar`; Notas = sesión (la búsqueda de ventas no pide permiso hoy),
  con Cobrar/Anotar factura/Editar/Eliminar según sus permisos de siempre.

## Fuera de alcance
Cambiar reglas de cobro, factura o edición; Cuentas por Cobrar; la tablet.

## Pruebas
e2e de `GET /ventas` con `folio`, `filtro` y `factura`; portal: pestañas por permiso, Ventas con el cliente de arriba,
Notas (filtros, sin cliente, casillas, barra, cobrar con la botonera de R3, anotar factura, Ver › y volver),
redirecciones (incluida la de Cuentas por Cobrar), las pruebas de las pantallas viejas que se muevan. Navegador a 1366 px.
