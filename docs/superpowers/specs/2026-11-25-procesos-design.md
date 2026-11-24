# Operación → Procesos — diseño (PR A: pantalla y las 5 pestañas nuevas)

Fecha: 2026-11-25 · Rama: `feature/procesos` · Portal + backend (Roberto). La tablet no cambia.

Fuentes (vault, `90-Fuentes/`): **Módulo de Producción e Inventarios 2026-11-16** (Inventario de PT con Ventas: merma,
consumo, promociones y descuentos "del submódulo de Procesos"; Registro de Operación → Mermas: "Si es del módulo de
Operación, submódulo de Merma debemos seleccionar si es de Almacén o de un cliente en específico"), **Respuestas del
cliente 2026-11-18** (6: "administración registre el descuento del vendedor en submódulo de Procesos en un apartado
nuevo que sea Descuentos […] solamente cuando sean descuentos"), `10-Dominio/Sistema viejo del cliente.md` (Procesos:
por cliente, pestañas Ventas · Notas · Merma · Cambios · Consumos · Promoción; merma con producto recibido, casilla
"Merma Almacén", número de mermas y producto entregado al cliente).

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
- **R3.** Descuentos por faltante: se elige vendedor y día y se **precargan las piezas que le faltaron según el corte**
  (editable antes de guardar).

## Decisiones mías
- **D0. Cliente arriba, como el viejo** ("Seleccionar cliente"): un buscador de cliente de la sucursal encima de las
  pestañas; lo usan Ventas, Notas, Merma (de cliente), Cambios y Promoción. Consumos y Descuentos no lo usan (piden su
  vendedor u Oficina). Si una pestaña que lo necesita no tiene cliente elegido, dice "Elige un cliente".
- **D1. Pantalla** *Operación → Procesos* (`/operacion/procesos`, hoy "pronto"), sucursal del menú lateral, una pestaña
  por tipo, lista del día (hoy o anteriores) + "Registrar …" en pantalla completa con rejilla por tamaño y TAB, como el
  Registro de Operación. Permisos por pestaña: `proceso.merma`, `proceso.cambio`, `proceso.consumo`,
  `proceso.promocion`, `proceso.descuento` (grupo Operacion Comercial).
- **D2. Datos.** Tabla nueva `proceso_oficina` (`tipo`, `sucursal_id`, `fecha`, `cliente_id` null, `vendedor_id` null =
  Oficina, `merma_de` `cliente|almacen` solo en merma, `comentario`, `capturo_usuario_id`, tiempos, `deleted_at`) y
  `proceso_oficina_linea` (`presentacion_id`, `sentido` `recibido|entregado`, `piezas` 1..100000). Checks por tipo.
- **D3. Por tipo.**
  - *Merma*: "De un cliente" (cliente obligatorio) o "De almacén" (sin cliente); líneas **recibido** (dañadas) y
    **entregado** (reposición buena, cualquier sabor del mismo tamaño). De almacén solo recibido.
  - *Cambios*: cliente obligatorio; **recibido** (buenas que devuelve) y **entregado** (otro sabor); por cada tamaño el
    total recibido = total entregado (cambio físico 1 a 1, "mismo tamaño").
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
pgTAP de checks; unit de reglas (cambio 1 a 1 por tamaño, precarga de faltantes); e2e por tipo (alta, edición, baja,
permisos, alcance) y que una merma/cambio/promoción/consumo con vendedor cambia su corte y una con Oficina no; portal:
pestañas por permiso, captura por tipo, precarga de descuentos. Navegador a 1366 px.
