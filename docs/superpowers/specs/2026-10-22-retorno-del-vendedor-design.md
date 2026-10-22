# Retorno del vendedor (captura del almacenista) — Diseño

**Fecha:** 2026-10-22 · **Estado:** aprobado en conversación por Roberto · **Relación:** pieza de captura de T-27 (#27,
pieza 3 "corte de inventario", de Mario) que T-24 (#24) necesita para su fórmula.
**Fuentes (vault):** [[Nuevo Sistema Jawa Sinmex Julio 2027 (fuente)]] (§Retorno y Reporte de Liquidación, "Piezas
Retorno Validadas", lista de permisos), [[Fórmula de inventario]] (decisión de Roberto 2026-10-21: el Almacén General
resta cargas − retornos), [[Inventario]] (carga y recarga de T-27).

## 1. Para qué

Que el almacenista registre en el portal **cuántas piezas regresa cada vendedor al final del día**, por presentación.
Con eso el inventario del Almacén General (T-24) puede restar *cargas − retornos*, y el corte de inventario de Mario
(T-27 pieza 3) puede comparar lo teórico contra este retorno validado.

## 2. Lo que dijeron las fuentes

- "Al final del día Producción cuenta el retorno y la merma, se firma el Formato de Almacén (marca Salida o Retorno)."
- "Piezas Retorno Validadas / Merma Retornada Validada: lo que el **almacenista** registra como real al cerrar el día."
- Permiso de la lista de julio: "Registrar/editar retorno de mercancía" (ya sembrado como `retorno.gestionar`).
- El inventario del día lo llena también el vendedor en papel (informativo); el que cuenta es el almacenista.

## 3. Decisiones

| Tema | Decisión | De dónde sale |
|---|---|---|
| Qué se captura | Piezas **buenas** que regresan, por **vendedor, día y presentación**. | Fuente ("Piezas Retorno Validadas") |
| Merma retornada | **Fuera** de esta pieza: la merma no vuelve al inventario vendible y su captura es de T-35 / T-27 pieza 2–3. | Fuente separa piezas y merma |
| Quién | El almacenista desde el portal, con el permiso **`retorno.gestionar`** (ya existe). | Fuente + permiso sembrado |
| Fecha | Por omisión hoy; días anteriores sí; futuro no (hoy en Tijuana). Igual que T-25. | Mismo criterio que la carga y la producción |
| Corregir | Elegir vendedor y día muestra lo guardado y se corrige; se guarda el día completo (0 = sin registro). | Fuente ("Registrar/editar retorno") |
| Sucursal | La del vendedor; alcance de sucursal como cargas (otra sucursal = 404). | Patrón de T-27 |
| La tablet | No cambia: el vendedor sigue sin capturar retorno. | Fuente (lo valida el almacenista) |

## 4. Datos (migración nueva)

Tabla `retorno`: `id`, `fecha` date, `vendedor_id` → `vendedor`, `sucursal_id` → `sucursal` (copia la del vendedor al
guardar), `presentacion_id` → `presentacion`, `piezas` int `> 0`, `capturo_usuario_id`, `actualizado_por_usuario_id`
(nullable), `created_at`, `updated_at`, `deleted_at`. **Una fila viva por día, vendedor y presentación** (índice único
parcial). Migración con timestamp único después de `20261023120000`.

## 5. Backend (`modules/produccion/`, junto a cargas y producción)

Mismo molde que la producción de T-25 (reglas puras, repositorio, servicio, controlador, DTO, e2e), reutilizando lo que
se pueda de `reglas-produccion.ts` (validación de fecha y líneas, plan crear/actualizar/borrar) sin copiarlo:

- `GET /retornos?fecha=YYYY-MM-DD&vendedor=<uuid>` → `{ fecha, vendedor: { id, nombre }, sucursal: { id, codigo },
  lineas: [{ presentacionId, producto, presentacion, activa, piezas, cargadas }], totalPiezas, actualizadoEn }`.
  `cargadas` = piezas de las cargas **aceptadas** de ese vendedor ese día (de T-27), solo como referencia en pantalla.
- `PUT /retornos` con `{ fecha, vendedor, lineas: [{ presentacionId, piezas }] }` → reemplaza el día en una transacción,
  con la fila del vendedor bloqueada (`for no key update`, como cargas). Rechaza (400) fecha futura y líneas inválidas.
- Permiso `retorno.gestionar`. Alcance de sucursal por el vendedor. Vendedor inexistente u otra sucursal = 404.
- **No se valida retorno ≤ cargado:** el almacenista registra lo que cuenta; el cuadre es del corte (T-27 pieza 3).

## 6. Portal

*Producción → Retorno* (`/produccion/retorno`), debajo de Recarga. Elegir **vendedor** (activos de la sucursal) y
**fecha**; tabla común con una fila por presentación (producto, presentación, **cargadas ese día** como referencia, casilla
de piezas retornadas) y el total; **Guardar**. Mismo comportamiento que *Producción del día* (confirmar al cambiar de
vendedor o fecha con cambios, no pedir fechas futuras, avisos comunes). `EncabezadoPantalla`: "Retorno" / "Las piezas que
regresa cada vendedor al final del día."

## 7. Pruebas y revisión

Como T-25: unitarias, e2e (permiso 403, otra sucursal 404, crear/corregir/0 da de baja, fecha futura 400, `cargadas`
refleja solo cargas aceptadas, dos guardados del mismo vendedor y día se serializan), pgTAP de la tabla, pruebas de la
pantalla, navegador a 1366 px contra la base local. CLAUDE.md y vault ([[Inventario]], bitácora, Estado). **Nota a Mario
en el PR**: esta es la captura del retorno validado que su corte (pieza 3) va a leer.

**Nube:** migración a `sinmex dev` después del merge con el protocolo de push (tabla nueva, nada que contar).
