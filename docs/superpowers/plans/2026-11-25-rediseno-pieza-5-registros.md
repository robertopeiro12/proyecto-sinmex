# Rediseño app del vendedor — Pieza 5: Registros (Ventas / Cobranza) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantalla "Ventas / Cobranza" del menú: registro del día (lo más nuevo arriba), filtros abajo Todo / Ventas del día / Cobranza / Notas pendientes, y el detalle de cada movimiento de solo lectura.

**Architecture:** Solo tablet, sin migración ni contrato. Un módulo puro arma el registro a partir de ventas, cobros y la lista de "notas que trae" (la misma regla que el número de la ruta, extraída a una función que devuelve la lista y de la que el conteo sale). Las pantallas solo pintan.

**Tech Stack:** Expo Router + SQLite.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §11 "Ventas / Cobranza (M17, M18)" y §16-bis "Registros". Maquetas 17 y 18. La pantalla de Merma / Cambios es de la pieza 4.

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`; sin PR. Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Sin migración local, sin cambios al servidor ni al contrato.
- Iconos SVG; dinero con `pesos()`; hora con `formatearHora` (`src/ui/momento.ts`).
- **Una sola regla de "notas que trae"**: `queTraePorCliente` debe contarse a partir de la lista nueva; no se re-deriva en otro lado (CLAUDE.md, notas asignadas).
- Lo grabado no se edita. El botón **Reimprimir** no se pinta hasta la pieza 7.

## Decisiones de diseño

1. El registro muestra lo hecho **en esta tablet** hoy (ventas y cobros); los cobros de la oficina no salen.
2. Tipos y textos del renglón: "Venta contado", "Venta crédito", "Venta abonó $300.00" (con `abono_centavos` de la pieza 2), "Cobro nota <folio>" (folio de `nota_pendiente` por `venta_nota_id`; sin nota local, "Cobro"). Monto: total de la venta o monto del cobro.
3. Encabezado "Hoy · N movimientos" con la suma de lo que el filtro muestra.

## Review Focus

1. Venta a crédito de hoy ya bajada como `nota_pendiente` no sale dos veces en "Notas pendientes" (misma regla del conteo de la ruta). → Task 1.
2. Cobro que repartió en varias notas: un renglón por cobro con su monto total; el detalle lista cada nota y lo aplicado. → Task 1 y 2.
3. Día sin movimientos: mensaje "Aún no hay movimientos hoy." en cada filtro. → Task 2.
4. Venta en `error` de subida: se ve con su pastilla. → Task 2.

---

### Task 1: Datos y reglas del registro

**Files:**
- Modify: `apps/tablet/src/datos/repositorios/cobranzas.ts` (+ spec): `delDiaDelVendedor(vendedorId, fecha = hoy): Cobranza[]` (orden por `grabada_en`)
- Modify: `apps/tablet/src/datos/repositorios/notas-asignadas.ts` (+ spec): `queTraeDelVendedor(vendedorId): NotaQueTrae[]` con la regla actual de `queTraePorCliente`, y `queTraePorCliente` reescrito como conteo de esa lista (sus pruebas actuales siguen pasando sin cambios)
- Modify: `apps/tablet/src/datos/repositorios/ventas.ts` (+ spec): `detalle(ventaId): { venta: Venta; lineas: { etiqueta: string; cantidad: number; cantidadPromocion: number; precioCentavos: number; importeCentavos: number }[]; promociones: { etiqueta: string; cantidad: number; texto: string }[] } | null`
- Create: `apps/tablet/src/estado/registros.ts` (+ spec)

**Interfaces:**
- Produces: `interface NotaQueTrae { origen: 'asignada' | 'nueva'; clienteId: string; folio: string; ventaNotaId: string | null; ventaId: string | null; saldoCentavos: number; fecha: FechaISO }` (nueva sin pull: saldo = total − abono al vender).
- Produces en `registros.ts`: `type FiltroRegistro = 'todo' | 'ventas' | 'cobranza' | 'pendientes'`; `interface RenglonRegistro { clave: string; tipo: 'venta' | 'cobro' | 'nota'; id: string; hora: string | null; cliente: string; texto: string; montoCentavos: number; estado: EstadoSubida | null }`; `armarRegistro({ ventas, cobros, notas, nombreCliente, folioDeNota }, filtro): { renglones: RenglonRegistro[]; total: number }` — orden por hora descendente; "pendientes" lista `notas` (texto "Nota <folio>", monto = saldo).

- [ ] **Step 1: Failing tests** — `delDiaDelVendedor` solo del vendedor y del día; `queTraeDelVendedor` con los mismos casos que hoy prueba `queTraePorCliente` (asignada con saldo, venta a crédito local, misma venta ya bajada por folio sin contar doble, asignada liquidada hoy fuera, contado fuera) y que el conteo por cliente coincide; `detalle` con renglones, promociones y etiqueta; `armarRegistro` con los textos de la maqueta 17 ("Venta contado", "Venta crédito", "Venta abonó $300.00", "Cobro nota TJ261103JP07"), orden descendente, cada filtro y el total.
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 5: datos y reglas del registro de ventas y cobranza`

---

### Task 2: Pantallas del registro y del detalle

**Files:**
- Move: `apps/tablet/app/(jornada)/registros.tsx` → `apps/tablet/app/(jornada)/registros/index.tsx`; Create: `apps/tablet/app/(jornada)/registros/[tipo]/[id].tsx`; actualizar `_layout.tsx` (Stack.Screen; el índice con `headerShown: false` dentro de `MarcoMenu clave="registros"`, el detalle con "atrás")
- Create si hace falta: `apps/tablet/src/estado/detalle-registro.ts` (+ spec) para los textos del detalle

Pantallas (maquetas 17 y 18):
- **Registro**: `MarcoMenu`; tarjeta "Hoy · N movimientos" con la suma; lista con hora, cliente, texto y monto, pastilla de subida; filtros fijos abajo Todo / Ventas del día / Cobranza / Notas pendientes; tocar un renglón abre el detalle (una nota pendiente abre su venta si es de esta tablet, si no la hoja del cliente).
- **Detalle de venta**: folio, cliente, hora, renglones "24 × Jamaica 500 ml $432.00", promociones "(promoción) $0.00" con su frase, Total, "Pagó $X" y "Quedó a crédito $Y" (contado: pagó todo; crédito: 0; abonada: el abono), "Atendió", "Vendedor", "Sincronizada Sí/No".
- **Detalle de cobro**: cliente, hora, monto, método, y por cada nota del reparto: folio, aplicado y saldo después.

- [ ] **Step 1: Failing tests** de lo puro de los textos del detalle ("Quedó a crédito $940.00", "Sincronizada Sí").
- [ ] **Step 2–4:** implement; suite, typecheck, lint → PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 5: pantalla de ventas y cobranza del día`
- [ ] **Step 6 (controlador, emulador):** con una venta de contado, una a crédito, una abonada y un cobro: el registro, los filtros, los detalles.

---

### Task 3: Cierre

- [ ] Suites; `CLAUDE.md` (bloque de notas asignadas: `queTraeDelVendedor` como la regla única), README de la tablet; bóveda (Estado del proyecto). Push de la rama, **sin PR**.
