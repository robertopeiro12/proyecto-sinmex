# Roadmap · Tickets para completar la App de Tablet — ejecución con subagentes

> **Qué es este documento.** No es un plan de implementación de un ticket: es el **programa** que
> dice en qué orden se toman los tickets, qué toca cada uno, cómo se ejecuta cada uno con
> subagentes y **qué modelo** usa cada tarea. Cada ticket, cuando se tome, pasa por su propio
> `brainstorming → spec → writing-plans → subagent-driven-development`, igual que T-10…T-13.
>
> **Estado:** propuesto (2026-09-12). Nada de esto se ejecuta hasta que Mario lo apruebe.

**Base:** `main` en `a7c1ca8` (T-13 mergeado). Decisión de arquitectura que rige todos los
tickets: `ADR-0009 Proyección de operaciones sincronizadas a los módulos de dominio` (vault,
`propuesto`).

---

## 1. Principios de ejecución

1. **Un ticket a la vez.** Nunca dos tickets en implementación simultánea.
2. **Una tarea a la vez dentro del ticket, cada una con un subagente fresco.** El subagente no
   hereda la conversación: recibe un *brief* (el texto de su tarea extraído del plan), las
   interfaces que toca y las restricciones globales. Nada más.
3. **Toda tarea pasa revisión** (cumplimiento del spec + calidad) por **otro** subagente fresco,
   y todo ticket termina con una **revisión final de la rama completa**.
4. **El modelo lo decide el tipo de tarea, no el ticket** (sección 3). Un ticket grande tiene
   tareas baratas; uno pequeño puede tener una tarea que exige el modelo más capaz.
5. **El controlador (la sesión principal) no escribe código.** Coordina, decide las
   ambigüedades y las anota en el *ledger*. Si él arreglara algo, ese arreglo no pasaría revisión.
6. **El agente nunca mergea, nunca empuja migraciones a `sinmex dev` y nunca toca `main`.**

---

## 2. El ciclo de un ticket

| Fase | Qué produce | Quién la hace | Modelo | Puerta de salida |
|---|---|---|---|---|
| **0. Rama y línea base** | `feature/t-NN-slug` desde `main` actualizado; Supabase local al día (regla de `CLAUDE.md`); conteos reales de pruebas anotados | Controlador | — | Suites en verde antes de tocar nada |
| **1. Digest de contexto** | Un archivo con lo relevante del vault (módulo, reglas, entidades, ADRs), del issue (criterios) y del código (archivos, patrones, tablas) | Subagente fresco | `sonnet` | El archivo existe; el controlador lo lee en vez de leer 20 notas |
| **2. Brainstorming + spec** | `docs/superpowers/specs/AAAA-MM-DD-t-NN-*-design.md` con decisiones D1…Dn | **Controlador con Mario** (un subagente no puede preguntarle a nadie) | sesión (`opus`) | **Mario aprueba el spec** |
| **3. Plan de implementación** | `docs/superpowers/plans/AAAA-MM-DD-t-NN-*.md` con tareas y **código completo** (el estilo de T-12) | Subagente fresco con `writing-plans` | `opus` | Escaneo de conflictos del controlador, sin hallazgos abiertos |
| **4. Ejecución por tareas** | Commits en la rama, una tarea por vez | Implementador fresco + revisor fresco por tarea | Según sección 3 | Cada tarea: spec ✅ y calidad aprobada |
| **5. Revisión final de rama** | Hallazgos de toda la rama + triage de los *minor* diferidos | Subagente fresco | `opus` (ver 3.3) | Sin Critical/Important abiertos |
| **6. Cierre** | Vault actualizado (nota del módulo, `Estado del proyecto`, bitácora) + descripción del PR | Subagente fresco | `sonnet` | Archivos escritos y revisados por el controlador |
| **7. PR** | Rama empujada y PR abierto contra la base que toque (sección 5) | Controlador | — | **Autorización de Mario para empujar y abrir PR**; revisión cruzada y merge los hace el otro dev |

---

## 3. Qué modelo usa cada tarea

La regla viene de `subagent-driven-development`:

> *"Use the least powerful model that can handle each role… When the task's plan text contains
> the complete code to write, the implementation is transcription plus testing: use the cheapest
> tier for that implementer… Use a mid-tier model as the floor for reviewers and for implementers
> working from prose descriptions."*

Lo que la hace aplicable aquí: **los planes de este equipo llevan el código completo** (T-12:
4 500 líneas, 13 tareas). Eso vuelve viable `haiku` para buena parte de la implementación.

### 3.1 Implementador por tipo de tarea

| Tipo de tarea | Ejemplos en este proyecto | Implementador | Revisor |
|---|---|---|---|
| **Migración SQL + prueba pgTAP**, con el SQL completo en el plan | `jornada`, `visita`, `sync_operacion_id`, índices únicos, permisos nuevos | `haiku` | `sonnet` |
| **Función pura + pruebas unitarias**, código completo | status inicial de venta, saldo derivado, semana/mes, comisión, efectividad, cuadre de inventario | `haiku` | `sonnet` |
| **Cambio mecánico repetido en varios archivos** (se agrupa en **una** tarea) | tipos del contrato duplicados `apps/backend` ↔ `apps/tablet`, códigos de rechazo, DTOs | `haiku` | `sonnet` |
| **Endpoint completo**: repository + service + controller + e2e, con permisos y alcance por sucursal | `GET/PUT /rutas-diarias`, CRUD de campos de tesorería/egresos | `sonnet` | `sonnet` |
| **Proyección de un tipo de operación** (ADR-0009): servicio de dominio llamado desde `push` dentro de la transacción | `registrarVenta`, `registrarCobranza`, `registrarGasto` | `sonnet` | **`opus`** (dinero, saldos, transacciones) |
| **Tablet: migración local + repositorio SQLite + pruebas en Node** | ventas locales, cobranzas locales, ruta del día | `sonnet` | `sonnet` |
| **Tablet: pantalla** con el sistema de diseño (ADR-0008, regla de acciones opuestas) | `venta.tsx`, `cobranza.tsx`, `cerrar-dia.tsx` | `sonnet` | `sonnet` |
| **Cambio estructural o concurrente** | refactor de `push` a una transacción por operación (T-16), versión por fila (T-43) | **`opus`** | **`opus`** |
| **Integración nativa o de hardware** | mapas y GPS (T-41), impresora térmica (T-48), tareas en segundo plano (T-44) | **`opus`**, precedido de un *spike* | `opus` |
| **Digest de contexto** (fase 1) y **cierre de vault** (fase 6) | — | `sonnet` | controlador |
| **Plan de implementación** (fase 3) | — | `opus` | controlador |

### 3.2 Cuando una tarea no pasa la revisión

| Ronda | Quién arregla | Modelo |
|---|---|---|
| 1–3 | **El mismo implementador**, que conserva su contexto | el mismo |
| 4–5 | **Implementador fresco**, un nivel arriba | `haiku → sonnet → opus → fable` |
| Re-revisión de cada ronda | Revisor fresco, solo sobre el diff del arreglo | `sonnet` |
| Tras la 5.ª | El controlador adjudica cada hallazgo y lo anota como `Ruling:` en el ledger | — |

### 3.3 Revisión final de la rama

**Siempre `opus`.** En **T-16** (fundación de ADR-0009) y **T-43** (motor de conflictos) se
propone `fable` como techo. Ojo con el costo: el 2026-09-12 dos subagentes en `fable` se
cortaron por límite de sesión a mitad de trabajo; si eso vuelve a pasar en una revisión final,
se relanza en `opus`.

**Por qué no se recorta esta fase**, con evidencia del propio proyecto
(`Estado del proyecto`, vault):

- **T-12**: *"Bug crítico de diseño (D5 del spec), encontrado en la revisión FINAL de toda la
  rama"*, después de que todas las revisiones por tarea pasaran.
- **T-13**: *"Hallazgos de la revisión FINAL de toda la rama, corregidos antes del PR"*.
- **T-10**: el 409 engañoso salió *"en revisión, no en el brief original"*.

---

## 4. Restricciones globales (van en el plan de **cada** ticket)

Heredadas de los planes anteriores y de lo que salió mal en ellos:

- **Rama:** `feature/t-NN-slug`. Código en español, **sin acentos en identificadores** (sí en
  mensajes al usuario); comentarios que explican *por qué*. Respuestas de la API en camelCase.
  Baja siempre lógica; `deleted_at` nunca sale en una respuesta.
- **Docker:** en esta máquina el daemon es **Docker Desktop**, no Colima — los planes de T-12 y
  T-13 copiaron "Colima" y está mal aquí. Confirmar con `docker context ls` antes de asumirlo.
- **Supabase local al día después de cada `git pull`** (`migration up --local`), regla nueva de
  `CLAUDE.md`.
- **Nunca apuntar a `sinmex dev` durante la implementación.** `.env.test` va al Postgres local.
  (Incidente de T-09: una verificación "local" creó una sucursal de prueba en la nube.)
- **Los conteos de pruebas no se escriben en el plan.** El implementador mide la línea base y
  compara contra ella. (T-10 los escribió a mano y salieron mal.)
- **Flakiness de e2e ya existente** (hallada en T-12): se reporta como `DONE_WITH_CONCERNS`, no
  se reintenta a ciegas ni se "arregla" dentro de otra tarea.
- **ADR-0009 es obligatorio** para toda operación que suba la tablet: la proyecta el módulo de
  dominio dueño, dentro de una transacción por operación; una rechazada no deja fila; código de
  rechazo específico, nunca genérico.
- **El contrato solo crece de forma aditiva** (tipos nuevos, campos opcionales) sin subir
  `CONTRATO_ACTUAL`. Los tipos se cambian **en los dos archivos a la vez**
  (`apps/backend/src/modules/sincronizacion/contrato.ts` y `apps/tablet/src/sincronizacion/contrato.ts`)
  y en `docs/contrato-sincronizacion.md`.
- **Dinero en centavos enteros en el cable**; `numeric(12,2)` en Postgres, convertido con
  `dinero.ts`. `fecha_operacion` la calcula la tablet y el servidor no la re-deriva.
- **Los implementadores no despachan subagentes**, no empujan, no mergean.

---

## 5. Ramas apiladas mientras los PR esperan revisión

Los tickets dependen unos de otros (T-38, T-20 y T-39 necesitan código de T-16), y el merge lo
hace el otro dev cuando revisa. Esperar cada merge detendría el programa; apilar sin regla repite
el problema que el vault ya documentó:

> *"T-03 se mergeó **con squash**. Si se repite aquí, los commits de la rama mergeada dejan de
> existir en `main` y **la siguiente PR de la pila muestra diffs fantasma y conflictos**, en
> cascada."* — `Estado del proyecto`, próximos pasos.

**Regla propuesta:**

- La rama de un ticket sale de `main` **si sus dependencias ya están mergeadas**; si no, sale de
  la rama de la dependencia y su PR apunta a esa rama.
- **Máximo 3 PR abiertos a la vez.** Con 3 abiertos se pausa el programa hasta que se mergee uno.
- Tras cada merge con squash: `git rebase --onto main <rama-mergeada>` sobre la siguiente y
  `push --force-with-lease` **a esa rama de feature** (nunca a `main`). Lo hace el controlador,
  con autorización.

---

## 6. Orden de los tickets

Salido de las dependencias declaradas en los issues (`gh issue list`, 2026-09-12). Se incluyen
los tickets del portal/backend **solo** en la parte que la app necesita.

| # | Ticket | Tamaño | Depende de (issue) | Parte que se hace | Bloqueo abierto |
|---|---|---|---|---|---|
| 1 | **T-16** Venta (app) | L | T-12 ✅ #81 · T-10 ✅ #74 · T-14 ✅ #72 | completo + fundación ADR-0009 | — |
| 2 | **T-20** Cobranza / abono (app) | M | T-16 | completo | — |
| 3 | **T-17** Registrar, modificar y eliminar venta (portal) | L | T-12 ✅ · T-10 ✅ · T-05 ✅ | completo (backend + portal) | Folio de las ventas capturadas en el portal (ver ficha) |
| 4 | **T-38** Jornada y kilometraje (app) | M | T-04 ✅ · T-11 ✅ · T-16 | completo | — |
| 5 | **T-40** Prospectos (app) | S | T-12 ✅ · T-04 ✅ | sin foto | Foto: ¿Supabase Storage? |
| 6 | **T-37** Ruta diaria | M | T-12 ✅ | **backend + tablet**; pantalla del portal según respuesta | ¿Quién hace la UI del portal? |
| 7 | **T-39** Visita sin venta (app) | M | T-16 · T-37 | completo | Motivos cerrados o con "otro" (cliente) |
| 8 | **T-45** Comisión | M | T-16 · T-12 ✅ | backend + cálculo local en tablet | ¿Congelada o recalculada? (cliente) |
| 9 | **T-46** Efectividad de ruta | S | T-37 · T-16 | backend + cálculo local en tablet | — |
| 10 | **T-41** GPS y mapa (app) | L | T-12 ✅ · T-37 | **spike + ADR de mapas antes del spec** | Proveedor/API key de mapas; GPS por visita o continuo (el criterio dice *"detecta vueltas personales"*, que exige continuo) |
| 11 | **T-28** Tesorería: campos + saldo inicial | M | T-05 ✅ · T-03 ✅ | backend | UI del portal |
| 12 | **T-29** Tesorería: depósitos, retiros, traspasos | M | T-28 | backend | UI del portal |
| 13 | **T-30** Egresos: campos + tipos | M | T-05 ✅ · T-28 | backend + catálogo en `pull` | UI del portal |
| 14 | **T-31** Registrar gasto | M | T-30 · T-29 | backend + captura en tablet | UI del portal |
| 15 | **T-24** Inventario PT y envases | M | T-10 ✅ · T-16 | backend + **ADR del modelo de inventario** | Sabor o presentación (cliente) |
| 16 | **T-25** Producción por día | M | T-10 ✅ | backend | UI del portal |
| 17 | **T-26** Recarga a vendedores | M | T-25 · T-11 ✅ | backend + carga del día en `pull` | UI del portal |
| 18 | **T-27** Inventario de repartidor, cuadre en 0 (app) | L | T-16 · T-24 (y T-26 en la práctica: sin carga no hay inventario inicial) | completo | — |
| 19 | **T-33** Cierre del día (app) | L | T-20 · T-27 · T-31 (y T-45/T-46 para mostrar comisión y efectividad) | completo, **ver conflicto abajo** | Conflicto issue ↔ vault |
| 20 | **T-43** Motor de sincronización + conflictos | L | T-07 ✅ · T-16 · T-20 · T-27 | completo | — |
| 21 | **T-44** Sync intermedia 11:00 / 14:00 (app) | S | T-43 | completo | — |
| 22 | **T-48** Impresión térmica del corte (app) | M | T-33 · T-45 · T-46 | **spike con impresora real** | Modelo de impresora; el vault avisa que puede requerir salir del *managed workflow* de Expo |

**Fuera de este roadmap** (la app no los necesita): T-15, T-19, T-21, T-22, T-23, T-32,
T-34, T-35, T-36, T-47, T-49…T-59, T-62, T-63, T-64 y T-60 (endurecimiento final). Notas:
T-35 (captura de merma en el portal) no es necesario porque T-27 captura en la tablet; T-34
(eliminar cobranza con autorización) es el complemento de T-20 del lado del portal.

---

## 7. Fichas por ticket

Cada ficha dice qué entra, dónde vive según ADR-0009, qué debe fijar el spec y cuántas tareas se
esperan con su nivel de modelo. Las tareas son estimaciones para dimensionar; el plan de cada
ticket las fija.

### 1 · T-16 Venta (L)

- **Criterios del issue:** búsqueda incremental de cliente con productos y notas pendientes;
  total = cantidad × precio del cliente, con folio y semana/mes automáticos; grabado local listo
  para sincronizar.
- **Backend:** **fundación de ADR-0009** — `push` pasa a una transacción por operación, con
  despachador por `tipo`; la clasificación de colisión de folio sale del `catch` y se hace
  después del rollback. Módulo `ventas-cobranza/` con `VentasService.registrarVenta` →
  `venta_nota` + `venta_nota_detalle`. Migración: `sync_operacion_id` en `venta_nota`.
- **Tablet:** migración local (ventas y líneas), repositorio que llama a `folios.emitir()`
  **dentro de la misma transacción**, `venta.tsx`, el motor de sync sube ventas.
- **Decidido con Mario (2026-09-12):** (a) T-16 **muestra** las notas pendientes y T-20 las cobra,
  también desde la pantalla de venta, como operaciones `cobranza` separadas; (b) el precio de cada
  línea es **el de la nota firmada** (el que manda la tablet); (c) una venta grabada en la tablet
  **nunca se edita ni se anula**: se corrige desde el portal (**T-17**, añadido al roadmap).
- **`registrarVenta` se diseña para las dos puertas desde el día uno:** T-17 lo reutiliza desde el
  portal (ADR-0009 §2.2).
- **El spec debe fijar también:** la forma de `datos` de `venta`; los
  códigos de rechazo nuevos; si una venta de contado genera también su `cobranza_abono`.
- **Ya decidido por el vault:** contado → `pagada`, crédito → `pendiente`, promoción →
  `promocion`; `# de nota` obligatorio; promoción por línea, no suma al importe.
- **Limpieza incluida:** las pantallas placeholder citan tickets de una numeración vieja
  (`visita-sin-venta.tsx` dice T-33 y es **T-39**; `prospectos.tsx` dice T-24 y es **T-40**;
  `ruta.tsx` dice T-34 y es **T-41**; `registros.tsx` dice T-22, ticket de cuentas por cobrar del
  portal, cuando esa pantalla es de **T-27/T-31**). Se corrigen con los números de GitHub.
- **Tareas (~15):** 4 `haiku` (independizar `92_folios_test.sql` de los datos locales —
  hallazgo de la línea base—, migración, función pura de status/semana/mes, tipos del contrato) ·
  8 `sonnet` (servicio de ventas, e2e de `push`, repositorio y migración de la tablet, motor,
  pantalla, pruebas de pantalla, cierre) · 1 `opus` (refactor transaccional de `push`).
  Revisión final: `fable` (techo) u `opus`.

### 2 · T-20 Cobranza / abono (M)

- **Criterios:** notas pendientes/abonadas con saldo; liquidación o abono parcial; grabado
  offline que alimenta corte y tesorería.
- **Backend:** `CobranzasService.registrarCobranza` → `cobranza_abono`; status
  `pendiente → abonado → pagada`; **saldo derivado** (monto − Σ abonos, regla del vault);
  método de pago por defecto `efectivo` desde la app. Respeta el orden del lote (una cobranza
  sobre una nota vendida en el mismo lote).
- **Tablet:** `cobranza.tsx`, actualización local de `nota_pendiente`.
- **Consignación (decidido en T-16):** el cobro de notas también se ofrece desde la pantalla de
  venta, como operaciones `cobranza` separadas en el mismo lote, cada una con su clave.
- **El spec debe fijar:** qué hace `saldo_pendiente` (foto del momento del abono, nunca fuente);
  rechazos `nota-no-encontrada` y `monto-excede-saldo`.
- **Tareas (~9):** 2 `haiku` · 6 `sonnet` (la de proyección con revisor `opus`) · cierre.

### 3 · T-17 Registrar, modificar y eliminar venta — Portal (L)

- **Por qué entra:** decisión del 2026-09-12 en el spec de T-16 — una venta grabada en la tablet
  nunca se edita, así que **el portal es el único camino para corregirla**. Sus dependencias
  (T-12, T-10, T-05) ya están mergeadas.
- **Criterios del issue:** registrar con los mismos campos que la app (la fecha permite días
  pasados); modificar y eliminar buscando por fecha, cliente o `# de nota`; corregir el bug v2.0 de
  que el monto en $ no sumaba en ventas creadas desde el portal.
- **Backend:** reutiliza `VentasService.registrarVenta` de T-16 con `contexto.usuarioId` y
  `syncOperacionId = null` ("un solo servicio, dos puertas", ADR-0009 §2.2); agrega
  `modificarVenta` y `eliminarVenta` (baja lógica) en `ventas-cobranza/`; endpoints con
  `@RequierePermiso` y alcance por sucursal; permiso nuevo con el patrón de migración de T-13.
- **Portal:** búsqueda por fecha, cliente o `# de nota`; formulario con los mismos campos que la
  app; baja con confirmación; pruebas de pantalla con el patrón de T-65.
- **El spec debe fijar:**
  - **El folio de una venta capturada en el portal.** ADR-0001 y ADR-0007 dicen que el folio lo
    emite la tablet; ADR-0009 §2.2 dice que desde el portal lo emite el servidor. Si el servidor
    emite con el segmento del repartidor elegido, su contador **no conoce** los números que ese
    vendedor ya usó offline ese día, y la tablet chocaría (`folio-duplicado`) al sincronizar. Hay
    que elegir entre una numeración separada para el portal o no foliar las ventas de oficina.
  - **Qué se puede modificar de una venta que vino de la tablet**, con `sync_operacion` intacta
    como bitácora, y cómo le llega el cambio a la tablet (`notas_pendientes` en el `pull`).
  - **Modificar o eliminar una venta con abonos** (T-20): bloquearlo, o exigir primero eliminar
    la cobranza (T-34, fuera del roadmap).
- **Tareas (~14):** 3 `haiku` · 9 `sonnet` (endpoints, búsqueda, formulario, pruebas de pantalla) ·
  1 `opus` (reglas de edición con abonos y folio) · cierre. Revisión final `opus`.
- **Desbloquea, fuera de este roadmap:** T-19, T-21, T-32, T-35, T-49, T-52, T-57.

### 4 · T-38 Jornada y kilometraje (M)

- **Criterios:** vehículo + km inicial obligatorio para operar (ya existe); km final
  obligatorio antes de enviar el corte; km del día = final − inicial para el reporte.
- **Backend:** tabla `jornada` (vendedor, vehículo, `fecha_operacion`, km inicial, km final,
  `sync_operacion_id`) — **no** en `vehiculo`, como manda la nota `Vehículo` del vault. `rutas/`
  `JornadasService.cerrarJornada` proyecta el `tipo: 'jornada'` que el contrato ya acepta.
- **Tablet:** `cerrar-dia.tsx` (hoy un placeholder de 112 líneas) exige el km final.
- **Límite conocido:** el buzón es de solo escritura, así que solo suben jornadas **cerradas**
  hasta T-43.
- **Tareas (~7):** 2 `haiku` · 5 `sonnet`.

### 5 · T-40 Prospectos (S)

- **Backend:** tipo de push nuevo `prospecto` → `ClientesService.crearProspecto`
  (`cliente.tipo = 'prospecto'`); `domicilio` deja de ser obligatorio **solo** para prospectos;
  el catálogo de **tipos de negocio** entra al `pull` (hoy no baja).
- **Tablet:** `prospectos.tsx` con coordenadas del dispositivo (permiso de ubicación nuevo).
- **Fuera por ahora:** la foto, hasta que el equipo decida el alcance de Supabase (Storage).
- **Tareas (~6):** 2 `haiku` · 4 `sonnet`.

### 6 · T-37 Ruta diaria (M)

- **Backend:** endpoints de asignación por vendedor y fecha con orden; permiso propio de *Ruta
  Diaria* (patrón de migración de permiso de T-13); alcance por sucursal con `resolverAlcance`;
  la ruta del día entra al `pull`. La tabla `ruta` ya existe.
- **Tablet:** tabla local de ruta y la lista ordenada en la jornada.
- **Portal:** según la respuesta sobre quién hace la UI. Si nadie: API + pgTAP + e2e.
- **Tareas (~8):** 2 `haiku` · 6 `sonnet`.

### 7 · T-39 Visita sin venta (M)

- **Backend:** tabla `visita` (cliente, `fecha_operacion`, hora, motivo, persona que atendió,
  lat/lng opcionales, `sync_operacion_id`); `rutas/VisitasService.registrarVisita` proyecta el
  `tipo: 'ruta'`. Hora y nombre obligatorios para *no estaba el encargado* y *cerrado*.
- **Tablet:** `visita-sin-venta.tsx`.
- **Tareas (~7):** 2 `haiku` · 5 `sonnet`.

### 8 · T-45 Comisión (M) y 9 · T-46 Efectividad (S)

- **T-45:** función pura (monto × % / 100; promoción = $0); agregado por periodo y vendedor.
  Dónde se guarda depende de la pregunta al cliente. En la tablet, la comisión del día se calcula
  local con el `pct_comision` que ya baja en `pull`.
- **T-46:** vendidos / asignados a partir de la ruta y las ventas del día; local en la tablet
  para el cierre, en backend para el portal.
- **Tareas:** T-45 ~5 (3 `haiku`, 2 `sonnet`) · T-46 ~4 (2 `haiku`, 2 `sonnet`).

### 10 · T-41 GPS y mapa (L)

- **Antes del spec:** un *spike* `opus` (desechable) para probar mapa + ubicación en segundo
  plano en el teléfono de prueba, y un **ADR de mapas** (proveedor, API key, costo) — hoy está en
  *Decisiones pendientes* del vault.
- **Backend:** puntos GPS por visita o tabla de rastreo, según la granularidad elegida; km
  diarios recorridos.
- **Tareas (~12):** 1 spike `opus` · 3 `haiku` · 6 `sonnet` · 2 `opus` (módulo nativo, segundo
  plano).

### 11–14 · T-28, T-29, T-30, T-31 Tesorería y gastos (M cada uno)

- **T-28:** `tesoreria/` — campos (Efectivo, Caja Chica, bancos) y saldo inicial.
- **T-29:** libro de movimientos de tesorería; traspaso = dos movimientos atómicos; saldo
  derivado; cobranza y gastos escriben aquí **desde sus servicios, dentro de la misma
  transacción** (encaja con ADR-0009).
- **T-30:** `compras-egresos/` — tres tipos de egreso fijos, campos por tipo (no se borran con
  operaciones), semilla *Ajustes x no cuadrar*; los campos de Operación bajan en `pull`.
- **T-31:** `GastosService.registrarGasto` sirve al portal y al `push` (`tipo: 'gasto'`); desde
  la tablet el método es fijo *Efectivo cobranza del día* (regla del vault).
- **Tareas:** ~6–9 cada uno, mayoría `sonnet`, migraciones y semillas `haiku`, proyección de
  `gasto` con revisor `opus`.

### 15–18 · T-24, T-25, T-26, T-27 Inventario (M, M, M, L)

- **T-24:** **ADR del modelo de inventario** (tarea `opus`) — la propuesta del vault es un
  libro de movimientos; tabla `movimiento_inventario`; inventario PT y envases a una fecha como
  consulta derivada.
- **T-25:** la producción del día escribe movimientos `produccion`.
- **T-26:** carga inicial y recarga por vendedor; **la carga del día entra al `pull`** para que
  la tablet conozca su inventario inicial.
- **T-27:** la tablet captura retorno, merma (3 tipos), cambios físicos y consumo (**antes** de
  enviar el sobrante); `MovimientosService.registrarMovimiento`; cuadre en 0 como función pura con
  la fórmula detallada (teórico vs. validado). **Regla de acciones opuestas obligatoria** (ADR-0008).
- **Tareas:** T-24 ~9 · T-25 ~6 · T-26 ~7 · T-27 ~12.

### 19 · T-33 Cierre del día (L)

- **Conflicto a resolver en el spec.** Los criterios del issue piden *Caja Final = Caja Inicial +
  Cobranza − Gastos* y el **flujo de preguntas para diferencias**. La regla `Corte de caja` del vault dice
  que ese corte **lo genera la administración desde Tesorería**, con el *Monto Real* que entrega
  el repartidor. **Propuesta:** la app hace el **cierre del vendedor** (km final, cobranza −
  gastos = tesorería, ventas por presentación, comisión, efectividad, inventario en 0) y lo guarda
  como foto; el flujo de diferencias va al portal, en Tesorería.
- **Tareas (~10):** 3 `haiku` · 6 `sonnet` · 1 `opus` (consistencia del resumen con lo
  proyectado).

### 20 · T-43 Motor de conflictos (L) y 21 · T-44 Sync 11:00/14:00 (S)

- **T-43:** versión por fila en las tablas que bajan en `pull` (la *"solución correcta a largo
  plazo"* según ADR-0006), `pull` por versión, reconciliación de folios y cobranzas, frescura del
  snapshot. Punto de partida en el vault: operaciones de la tablet solo se agregan; en catálogos
  gana el portal. Spec y revisión final con `fable` u `opus`.
- **T-44:** tarea en segundo plano (nativa) o recordatorio; configurable; sube la jornada abierta
  gracias a la versión de T-43.
- **Tareas:** T-43 ~12 (4 `opus`) · T-44 ~5.

### 22 · T-48 Impresión térmica (M)

- **Antes del spec:** spike con la impresora real. Sin el aparato no se toma.
- **Tareas (~8):** 1 spike `opus` · resto `sonnet`.

---

## 8. Cómo sobrevive el programa a sesiones largas

- **Una sesión de Claude por ticket.** Al empezar, lee este roadmap, el spec y el plan del
  ticket; nada de la conversación anterior.
- **Ledger por plan** en `.superpowers/sdd/<plan>/progress.md` (lo crea `sdd-workspace`, se
  ignora solo). Una tarea con `Task N: complete` **no se vuelve a despachar**, aunque la sesión
  se haya compactado.
- **Tablero del programa:** la columna de la sección 6 se actualiza en este archivo al cerrar
  cada ticket (PR abierto, mergeado), y `Estado del proyecto` en el vault lo refleja.

---

## 9. Antes de arrancar T-16

1. **Aprobación de este roadmap.**
2. **Autorización permanente** para empujar la rama de cada ticket y abrir su PR, **sin
   mergear**. Sin ella, cada ticket se detiene en la fase 7 hasta que la des.
3. **Dos archivos sin commit** en `feature/diseno-app-responsivo`, que ya está mergeada en
   `main` (#76): el cambio a `CLAUDE.md` (actualizar Supabase local tras cada pull) y **este
   roadmap**. Hay que llevarlos a `main` antes de sacar `feature/t-16-*`, o viajarán dentro del PR
   de T-16.
4. **El commit `ae3269a` del vault (ADR-0009) no está empujado.** El otro dev no puede ver la
   decisión sobre la que se construye T-16.
5. **Limpieza, no bloqueante:**
   - La tabla de `Estado del proyecto` todavía muestra T-10, T-11, T-18 y T-12 con "PR abierto"
     (los cuatro están mergeados: #74, #75, #77, #81), y los issues #6, #7, #10 y #14 siguen
     abiertos con sus PR mergeados.
   - La numeración vieja de tickets no está solo en las pantallas placeholder: `App Tablet.md`
     del vault (líneas 209-210) dice *"mapas/GPS (T-34), impresión (T-38), cámara para prospecto
     (T-24)"*; son **T-41, T-48 y T-40**. Probablemente de ahí la copiaron las pantallas; se
     corrigen juntas.

Las preguntas abiertas de las fichas **no bloquean T-16**; cada una se resuelve antes del spec
del ticket que la necesita.
