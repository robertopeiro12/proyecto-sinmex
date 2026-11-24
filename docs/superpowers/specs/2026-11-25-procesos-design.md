# Operación → Procesos — diseño (PR A: pantalla y las 5 pestañas nuevas)

Fecha: 2026-11-25 · Rama: `feature/procesos` · Portal + backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`): **Módulo de Producción e Inventarios 2026-11-16** (Inventario de PT con Ventas: merma,
consumo, promociones y descuentos "del submódulo de Procesos"; Registro de Operación → Mermas: "Si es del módulo de
Operación, submódulo de Merma debemos seleccionar si es de Almacén o de un cliente en específico"), **Respuestas del
cliente 2026-11-18** (6: "administración registre el descuento del vendedor en submódulo de Procesos en un apartado
nuevo que sea Descuentos […] solamente cuando sean descuentos"), `10-Dominio/Sistema viejo del cliente.md` (Procesos:
por cliente, pestañas Ventas · Notas · Merma · Cambios · Consumos · Promoción; merma con producto recibido, casilla
"Merma Almacén", número de mermas y producto entregado al cliente).

Revisión del Procesos viejo en vivo (2026-11-25): `10-Dominio/Sistema viejo del cliente.md` § "Procesos a detalle".
Lo nuestro **se parece en qué pide y qué permite, no en cómo se ve** (Roberto): mismas pestañas y datos, con nuestra
captura por tamaño (varios productos de un jalón), fecha (pedida en "Cambios v2.0") y la lista de lo capturado del día,
que el viejo no tiene.

## Para qué
Registro de Operación es lo que **Producción** anota del **almacén**. Procesos es lo que **Administración** captura de lo
que pasó **en la calle** (clientes y vendedores): mermas, cambios, consumos, promociones y descuentos que no llegaron
por la app o que hay que corregir. Ambos alimentarán el Inventario de PT con Ventas; lo que se capture **a nombre de un
vendedor** cuenta además en su camioneta (corte e Inventario por vendedor).

## Decisiones de Roberto (2026-11-25)
- **R1 (cambiada el mismo día).** Procesos **como el viejo, todo dentro**: pestañas **Ventas** (= Registrar venta) ·
  **Notas** (= Ventas + Facturas + Cobranza juntas: buscar, filtrar por factura/pendiente, detalle, historial de abonos,
  abonar, editar, eliminar) · **Merma · Cambios · Consumos · Promoción · Descuentos**. Registrar venta, Ventas,
  Facturas y Cobranza salen del menú de Operación (sus direcciones redirigen a su pestaña). **Cuentas por Cobrar**
  (reporte) y **Promociones** (configuración de reglas) se quedan donde están. Se entrega en **dos PRs**: (A) la
  pantalla de Procesos con las 5 pestañas nuevas; (B) mover Ventas y juntar Notas, con su propio diseño basado en la
  pestaña Notas del viejo y en las pantallas actuales.
- **R2.** Cada captura (salvo Descuentos) elige **vendedor u Oficina**, como Registrar venta: con vendedor cuenta en su
  camioneta (corte e Inventario por vendedor); con Oficina, solo en el almacén.
- **R4 (tras revisar el viejo).** Merma de cliente y Cambios: **el total entregado tiene que ser igual al total
  recibido**, de cualquier producto y tamaño (como el viejo: "Revisar las cantidades!!"). Si no cuadra = 400 y el portal
  no deja guardar.
- **R3.** Descuentos por faltante: se elige vendedor y día y se **precargan las piezas que le faltaron según el corte**
  (editable antes de guardar).

## Decisiones mías
- **D0. Cliente arriba, como el viejo** ("Seleccionar cliente"): una tarjeta con el buscador de clientes **de la
  sucursal** (clientes vivos; prospectos también, porque la app ya les vende) y, al elegir uno, sus datos en pastillas:
  tipo de negocio, días de crédito, **cuánto debe y en cuántas notas** (la misma regla de "nota con saldo" de Cuentas por
  Cobrar), última compra y sus promociones vigentes (texto de `promociones-texto`). El cliente elegido se conserva al
  cambiar de pestaña. Lo usan Ventas, Notas (PR B), Merma (de cliente), Cambios y Promoción; Consumos y Descuentos no.
  Una pestaña que lo necesita sin cliente dice "Elige un cliente arriba.". Con "Todas" en el menú lateral la pantalla
  pide elegir sucursal (como Registro de Operación).
- **D1. Pantalla (boceto aprobado por Roberto, `img/2026-11-25-procesos-boceto-merma.png`).** *Operación → Procesos*
  (`/operacion/procesos`, hoy "pronto"). Encabezado "Procesos" + "Lo que la oficina captura de cada cliente: ventas,
  notas, merma, cambios, consumos y promoción."; tarjeta de cliente; pestañas Ventas · Notas · Merma · Cambios ·
  Consumos · Promoción · Descuentos (Ventas y Notas llegan en el PR B: en el A no se pintan). Cada pestaña es **la
  captura arriba y la lista abajo**, en la misma vista (no pantalla aparte):
  - Opciones en una fila: (solo Merma) "Merma de: Este cliente | Almacén" con `SelectorSegmentado`; "Fecha: Hoy · mar 25
    nov | Otro día" (Otro día abre un campo de fecha, hoy o anteriores); "¿Quién?" = vendedor de la sucursal u
    **Oficina** (en Merma la etiqueta es "¿Quién la recogió?").
  - Captura **por listas de productos, no rejilla por tamaño**: Merma y Cambios llevan dos cajas lado a lado con una
    flecha →: **"Recibí dañado"** (rojo suave; en Cambios "Me regresó") y **"Le entregué"** (verde suave), cada una con
    renglones producto · tamaño · piezas · ✕ y "+ Agregar producto" (buscador de presentaciones activas de la sucursal;
    una presentación una vez por caja). El total de piezas en el encabezado de cada caja. Consumos, Promoción y
    Descuentos llevan una sola caja ("Productos").
  - **Barra de cuadre** (Merma de cliente y Cambios): verde "✓ Cuadra: recibió 5 y se le entregaron 5."; amarilla
    "Recibió 5 y llevas 3 entregadas — faltan 2." (o "sobran 2"); con amarilla, Guardar se deshabilita.
  - Comentario opcional (≤ 300), "Limpiar" y "Guardar <tipo>". Editar desde la lista carga el registro arriba con
    "Guardar cambios" / "Cancelar".
  - Lista **"<Tipo> de <fecha> de este cliente"** (o de la sucursal en Consumos, Descuentos y Merma de almacén): Hora ·
    Quién (vendedor u "Oficina") · Recibido / Entregado (pastillas "Horchata 500 ml · 5" roja/verde) o Productos ·
    Capturó · Editar · Eliminar (`useConfirmar`). Muestra la fecha elegida arriba.
  - Cabe a 1366 px sin desplazamiento lateral. Piezas comunes de `components/ui/`.
  - Permisos por pestaña: `proceso.merma`, `proceso.cambio`, `proceso.consumo`, `proceso.promocion`,
    `proceso.descuento` (grupo Operacion Comercial, con su ⓘ). Sin permiso, la pestaña no sale.
- **D2. Datos.** Tabla nueva `proceso_oficina` (`tipo`, `sucursal_id`, `fecha`, `cliente_id` null, `vendedor_id` null =
  Oficina, `merma_de` `cliente|almacen` solo en merma, `comentario`, `capturo_usuario_id`, tiempos, `deleted_at`) y
  `proceso_oficina_linea` (`presentacion_id`, `sentido` `recibido|entregado`, `piezas` 1..100000). Checks por tipo.
- **D3. Por tipo.**
  - *Merma*: "De un cliente" (cliente obligatorio) o "De almacén" (sin cliente); líneas **recibido** (dañadas) y
    **entregado** (reposición buena, de cualquier producto). Con cliente, **el total entregado = el total recibido**
    (R4). De almacén solo recibido.
  - *Cambios*: cliente obligatorio; **recibido** (buenas que devuelve) y **entregado** (otro producto); **el total
    entregado = el total recibido** (R4), sin importar el tamaño.
  - *Consumos*: sin cliente; solo **entregado** (piezas que se tomaron).
  - *Promoción*: cliente obligatorio; solo **entregado** (piezas regaladas fuera de una venta).
  - *Descuentos*: vendedor obligatorio (sin Oficina), sin cliente; solo **entregado** = piezas que se le descuentan;
    precarga = faltantes positivos de piezas del corte de ese vendedor y día (por presentación). Sin corte hecho = aviso
    y nada que precargar.
- **D4. Camioneta (corte e Inventario por vendedor).** Con vendedor, se suman a la cuenta del corte del día como las de
  la app: merma recibida/entregada, **cambios recibidos/entregados** (hoy en 0: Procesos es su primera fuente),
  promoción (regaladas) y consumo. Los **descuentos no cambian la cuenta** (son la consecuencia del faltante). Un solo
  lugar: `movimientosDelDia` en `produccion/cortes.repository.ts` suma también `proceso_oficina`.
- **D5.** Editar y eliminar con las mismas reglas de fecha (hoy o anteriores), alcance de sucursal como Registro de
  Operación, eliminar con `useConfirmar`. Nada se autoriza.

## Nube
Una migración (tablas nuevas, checks, permisos). Pre-flight: nada que contar. Backend y portal juntos.

## Pruebas
pgTAP de checks; unit de reglas (total entregado = recibido en merma de cliente y cambios, precarga de faltantes); e2e por tipo (alta, edición, baja,
permisos, alcance) y que una merma/cambio/promoción/consumo con vendedor cambia su corte y una con Oficina no; portal:
pestañas por permiso, captura por tipo, precarga de descuentos. Navegador a 1366 px.
