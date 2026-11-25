# Rediseño app del vendedor — Pieza 7: Impresión de notas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imprimir la nota de venta (LIQUIDADA / ABONADO / CRÉDITO) al grabar una venta y al cobrar, reimprimir desde Ventas / Cobranza, y elegir la impresora en el menú.

**Architecture:** El contenido del ticket se arma con una **función pura** que devuelve renglones de texto de ancho fijo (32 columnas para papel de 58 mm, 48 para 80 mm), probada contra las maquetas 25–27. Un **controlador de impresión** recibe esos renglones; en esta pieza el único controlador es `expo-print` (HTML monoespaciado → servicio de impresión de Android), que funciona con cualquier impresora que tenga plugin de impresión, y queda la interfaz lista para un controlador ESC/POS por Bluetooth cuando Mario diga qué impresora es. Para reimprimir notas que no se vendieron en esta tablet, el pull de notas pendientes trae renglones, promociones, vendedor, quién atendió, sucursal y hora.

**Tech Stack:** Expo 57 (`expo-print ~57.0.1`, nativo: APK nuevo), NestJS (pull), SQLite local.

**Spec:** `docs/superpowers/specs/2026-11-18-rediseno-app-vendedor-design.md` §9 (un botón graba e imprime), §10 (al cobrar se reimprime), §12 (la nota impresa), §16-bis "Reimpresión". Maquetas 25–27.

## Global Constraints

- Rama `feature/rediseno-pieza-1-cascara`; sin PR (un solo PR al final). Nunca tocar `JAWA ANDROID/proyecto-sinmex`.
- Contrato aditivo (`CONTRATO_ACTUAL` sigue en 1), dos `contrato.ts` + `docs/contrato-sincronizacion.md` en el mismo commit.
- **Lo grabado nunca depende de la impresión:** si imprimir falla o se cancela, la venta/cobro ya está grabado, se avisa ("No se pudo imprimir. Puedes reimprimir desde Ventas / Cobranza.") y se sigue.
- Blanco y negro, monoespaciado, sin logos ni imágenes.
- Folio con el formato de siempre (12 caracteres).
- Iconos SVG; textos de las maquetas.
- Depende de las piezas 2 (`venta.atendio_nombre`, `venta.abono_centavos`) y 5 (pantalla Ventas / Cobranza con detalle).

## Decisiones tomadas sin respuesta de Mario

1. **Controlador `expo-print`** (diálogo de impresión de Android) mientras no se sepa la impresora. ESC/POS directo queda como controlador futuro detrás de la misma interfaz.
2. **Papel de 58 mm por omisión** (32 columnas); en "Seleccionar impresora" se elige 58 u 80 mm y se recuerda en el dispositivo.
3. La nota liquidada **no** lleva espacio de firma (la pregunta sigue abierta).

## Review Focus

1. Nombres largos de producto o cliente que no caben en el ancho: se cortan a la columna sin romper el renglón ni la alineación de importes. → prueba en Task 1.
2. Venta solo de promoción ($0.00): "LIQUIDADA", Pagó $0.00. → Task 1.
3. Cobro que reparte en varias notas: se reimprime cada nota tocada. → Task 4.
4. Nota de otra tablet sin renglones en el pull viejo (tablet que aún no sincroniza el pull nuevo): se imprime con lo que hay y una línea "Detalle no disponible en esta tablet". → Task 1 y 3.
5. Impresión cancelada por el vendedor en el diálogo: no se trata como error grave. → Task 2.

---

### Task 1: Armado puro del ticket

**Files:**
- Create: `apps/tablet/src/impresion/ticket.ts` (+ spec)

**Interfaces:**
- Produces:
  - `interface DatosTicket { sucursal: string; folio: string; momento: MomentoISO; cliente: string; atendio: string | null; vendedor: string; renglones: { cantidad: number; etiqueta: string; precioCentavos: number; importeCentavos: number }[]; promociones: { cantidad: number; etiqueta: string; texto: string }[]; totalCentavos: number; abonos: { fecha: FechaISO; montoCentavos: number }[]; saldoCentavos: number; reimpresion: { momento: MomentoISO; cobro: string } | null; detalleDisponible: boolean }`
  - `type EstadoTicket = 'LIQUIDADA' | 'ABONADO' | 'CRÉDITO'`; `estadoTicket(d: DatosTicket): EstadoTicket` (saldo 0 → LIQUIDADA; saldo = total y sin abonos → CRÉDITO; si no ABONADO).
  - `armarTicket(d: DatosTicket, columnas: 32 | 48): string[]` — renglones en el orden de la maqueta: "JAWA", sucursal, "NOTA DE VENTA", Folio, Fecha (`18 nov 2026 · 11:58`), Cliente, Atendió (si hay), Vendedor, separador, encabezado "Cant Producto P.U. Importe", renglones, promociones ("PROMO 0.00" y su frase en renglones debajo, cortada por palabras), separador, Piezas (pagadas + promoción), TOTAL; con LIQUIDADA "Pagó" y "Saldo pendiente $0.00"; con ABONADO/CRÉDITO la lista "Abonos" (fecha e importe), "SALDO PENDIENTE", el estado en grande (renglón centrado entre marcas), y para ABONADO/CRÉDITO tres renglones en blanco + raya + "Firma de quien recibe"; con reimpresión "Reimpresión <fecha · hora>" y "Cobró <nombre>"; al final "Gracias por su compra".
- Montos con dos decimales sin signo de pesos en la tabla (`216.00`) y con signo en totales (`$804.00`).

- [ ] **Step 1: Failing tests** con los datos de la maqueta 25 (LIQUIDADA, 12 Jamaica 500 ml a 18.00, … total 804.00, 4 Mango 500 ml PROMO con su frase), 26 (ABONADO, abono 300.00, saldo 504.00, firma) y 27 (reimpresión con dos abonos, saldo 304.00, "Cobró Juan Pérez"); comparar el arreglo completo de renglones a 32 columnas (escribir el esperado a mano, una vez); ningún renglón pasa de `columnas`; nombre de 60 caracteres se corta; total 0 → LIQUIDADA; `detalleDisponible: false` → renglón "Detalle no disponible en esta tablet" en lugar de la tabla.
- [ ] **Step 2: Run** `npm test --workspace=apps/tablet -- ticket`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** suite, typecheck, lint. PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 7: armado del ticket de la nota`

---

### Task 2: Controlador de impresión y "Seleccionar impresora"

**Files:**
- Modify: `apps/tablet/package.json` (agregar `expo-print` con `npx expo install expo-print` desde `apps/tablet`), `apps/tablet/app.json` si hace falta
- Create: `apps/tablet/src/impresion/controlador.ts` (interfaz + `crearControladorExpoPrint`), `apps/tablet/src/impresion/html.ts` (puro: renglones → HTML monoespaciado en blanco y negro, ancho según papel) (+ spec)
- Create: `apps/tablet/src/impresion/preferencia.ts` (puro + almacén: papel 58/80 recordado con `expo-secure-store` o la tabla local de ajustes si existe) (+ spec de la parte pura)
- Modify: `apps/tablet/app/(jornada)/impresora.tsx` (pantalla real: papel 58/80, "Imprimir prueba", explicación de que se usa la impresora configurada en Android)

**Interfaces:**
- Produces: `interface ControladorImpresion { imprimir(renglones: string[]): Promise<ResultadoImpresion> }`; `type ResultadoImpresion = { ok: true } | { ok: false; motivo: 'cancelada' | 'fallo'; detalle?: string }`; `renglonesAHtml(renglones: string[], papel: 58 | 80): string`; `leerPapel(): Promise<58 | 80>`, `guardarPapel(p: 58 | 80): Promise<void>`.
- `useImpresion()` hook (en `src/impresion/usar-impresion.ts`) que junta preferencia + controlador y expone `imprimirTicket(d: DatosTicket): Promise<ResultadoImpresion>`.

- [ ] **Step 1: Failing tests** de `renglonesAHtml` (escapa `<`, `&`; respeta espacios; ancho 58/80) y de la parte pura de preferencia (valor por omisión 58; valor desconocido → 58).
- [ ] **Step 2–4:** implement, suite/typecheck/lint PASS. `expo-print` es nativo: anotar en el reporte que hace falta APK nuevo.
- [ ] **Step 5: Commit** — `Rediseño pieza 7: controlador de impresión y Seleccionar impresora`
- [ ] **Step 6 (controlador, emulador):** recompilar el APK (`expo run:android`), "Imprimir prueba" abre el diálogo de Android con el ticket de prueba (guardar como PDF basta en el emulador).

---

### Task 3: El pull trae el detalle de la nota para reimprimir

**Files:**
- Modify: `apps/backend/src/modules/sincronizacion/sincronizacion.repository.ts` (`notasPendientes`), los dos `contrato.ts`, `docs/contrato-sincronizacion.md` (+ e2e del pull)
- Create: `apps/tablet/src/datos/migraciones/024-nota-detalle.ts` (+ spec) con `nota_pendiente.detalle_json text` (y lo que haga falta), `catalogos.ts` (`COLUMNAS.nota_pendiente`)

**Interfaces:**
- Produces (contrato, aditivo, opcional): `NotaPendientePull.detalle?: { lineas: { presentacion_id: string; etiqueta: string; cantidad: number; cantidad_promocion: number; precio_centavos: number }[]; promociones: { presentacion_id: string; etiqueta: string; cantidad: number; texto: string }[]; vendedor_nombre: string | null; atendio: string | null; sucursal_nombre: string; creada_en: string }` — líneas y promociones **vivas** (`deleted_at is null`), etiqueta "Producto volumen".
- Tablet guarda `detalle_json` tal cual (texto) y lo lee al reimprimir.

- [ ] **Step 1: Failing tests** — e2e: el pull de una nota a crédito con dos líneas y una promoción trae `detalle` con esos valores; una línea borrada en el portal no viene; tablet: el snapshot guarda `detalle_json` y una nota sin `detalle` deja `null`.
- [ ] **Step 2–4:** implement; backend unit + e2e del pull; tablet suite/typecheck/lint PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 7: el pull trae el detalle de la nota para reimprimir`

---

### Task 4: Imprimir al grabar, al cobrar y reimprimir

**Files:**
- Create: `apps/tablet/src/impresion/datos-ticket.ts` (+ spec): arma `DatosTicket` desde la base local
- Modify: `venta.tsx` (botón "Grabar e imprimir"), `cobranza.tsx` ("Grabar e imprimir"; reimprime cada nota tocada por el reparto), la pantalla de detalle de Ventas / Cobranza de la pieza 5 (botón "Reimprimir")

**Interfaces:**
- Produces: `ticketDeVenta(bd, ventaId): DatosTicket | null` (venta local: renglones de `venta_linea` + `venta_promocion`, `atendio_nombre`, abono al vender como abono de hoy, saldo = total − abono para crédito); `ticketDeNota(bd, notaPendienteId, reimpresion): DatosTicket | null` (nota del pull: `detalle_json` si hay, si no `detalleDisponible: false`; abonos de `abonos_json`; si la nota es de una venta de esta tablet y aún no tiene `detalle_json`, usar la venta local **por folio**).

- [ ] **Step 1: Failing tests** de `ticketDeVenta` (contado, crédito, abonada, solo promoción) y `ticketDeNota` (con detalle, sin detalle, venta local por folio) contra la base de prueba (`depsDePrueba`).
- [ ] **Step 2–4:** implement; pantallas: imprimir después de grabar; un fallo o cancelación muestra el aviso y no deshace nada; suite/typecheck/lint PASS.
- [ ] **Step 5: Commit** — `Rediseño pieza 7: imprimir al grabar, al cobrar y reimprimir`
- [ ] **Step 6 (controlador, emulador):** venta liquidada, abonada y a crédito imprimen; cobro de una nota la reimprime con el abono nuevo y "Cobró"; Reimprimir desde Ventas / Cobranza.

---

### Task 5: Cierre

- [ ] Suites completas (tablet, backend unit + e2e, portal), docs (`CLAUDE.md`, README de la tablet, contrato), bóveda (Estado del proyecto, App Tablet). Push de la rama, **sin PR**.
