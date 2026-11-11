# Ruta Diaria parte 2 — revisión de notas en la tarde — diseño

Fecha: 2026-11-11 · Portal (Roberto) + backend · Sin cambios en la tablet.

## 1. Para qué

En la tarde, cuando el vendedor regresa, Administración revisa qué papeles de notas le entregó: las **asignadas que no
cobró** y sus **ventas a crédito del día**. Al día siguiente el tío ve en el Flujo diario cuántas notas no regresaron.
Hoy el portal solo revisa las ventas a crédito del día (casilla "Entregada", 2026-11-09) y no sabe de notas asignadas
(la parte 1 las creó).

Fuentes:
- Cómo lo hace el viejo: vault `10-Dominio/Sistema viejo del cliente.md`, sección "El corte de la tarde".
- Respuestas del tío: vault `90-Fuentes/Respuestas del cliente 2026-11-11 Revisión de notas (fuente).md` (R-1, R-2) y
  `Respuestas del cliente 2026-11-10 Rutas (fuente).md` R-3.3 (nombres de las listas).
- Diagrama aprobado por Roberto y enviado al tío: "Así quedaría la revisión de notas" (PDF).

## 2. Reglas (del tío y del viejo)

1. **Tres listas** en la revisión de un vendedor y un día:
   - **"Notas Asignadas Cobradas"**: notas asignadas ese día que hoy tienen saldo 0. Solo se ven.
   - **"Notas Asignadas NO cobradas por Entregar"**: asignadas ese día con saldo > 0 (incluye abonadas). Con casilla.
   - **"Notas Nuevas x Cobrar Entregadas"**: ventas a crédito de ese vendedor ese día con saldo > 0. Con casilla.
2. **Las casillas vienen palomeadas** (sin revisar = palomeada en pantalla); Administración quita la palomita a lo que no
   le dieron. Al guardar, cada nota de las dos listas con casilla queda `entregada` = sí/no.
3. **Solo se piden notas que todavía deben algo** (R-2): una nota pagada el mismo día, la haya cobrado quien sea, no sale
   en "Nuevas" ni en "Asignadas NO cobradas". Una asignada pagada sale en "Cobradas".
4. **No hace falta que el vendedor haya cerrado su día** (R-1): se revisa con lo que ya está en el servidor.
5. **Se puede corregir al día siguiente** (R-1): el día de hoy y el de ayer (de Tijuana) se pueden guardar las veces que
   haga falta; días anteriores son solo consulta. *Decisión del agente* (lo confirmó Roberto como suposición): el mismo
   límite hoy/ayer que ya usa el Dashboard.
6. **"Notas de Ventas NO Entregadas"**: lo que se guardó sin palomita (de las dos listas), con su saldo.
7. En el **Flujo diario** (y el Dashboard), la columna "Notas de ventas" dice **cuántas notas NO se entregaron**,
   **en rojo** si es > 0; "0" si se revisó y todo llegó; **vacía** (solo el botón) si ese día no se ha revisado.

## 3. Datos

Migración nueva (timestamp único): en `nota_asignada` columnas nulas `papel_entregado boolean`, `papel_revisado_en
timestamptz`, `papel_revisado_por_usuario_id uuid references usuario`, con el check `(papel_entregado is null) =
(papel_revisado_en is null)` (igual que `venta_nota`). Las ventas a crédito del día siguen usando
`venta_nota.papel_entregado` (2026-11-09). Revisar el papel **no** mueve `updated_at` de `nota_asignada` si el pull no lo
necesita: *decisión del agente*: la tablet no usa el papel, así que el update de papel no debe hacer que la fila vuelva a
bajar (si el trigger lo movería, se acepta: es inofensivo; documentarlo).

Una nota que en ese día es **nueva y asignada** al mismo vendedor (caso raro) sale solo como asignada.

## 4. Backend (`modules/estadisticas/`, junto a lo de 2026-11-09)

- El detalle de vendedor y día (`/dashboard/vendedor` y `/reportes/flujo-diario/vendedor`) gana:
  `asignadasCobradas[]`, `asignadasPorEntregar[]` (con `entregada: boolean | null`) y los `notasCredito[]` existentes
  filtrados a saldo > 0 (la casilla ya existe). Cada nota: `ventaNotaId`, `folio`, `cliente`, `totalCentavos`,
  `pendienteCentavos`, `entregada`.
- `PUT /dashboard/notas-entregadas` acepta además `asignadas: { ventaNotaId, entregada }[]` y una `fecha` (hoy o ayer de
  Tijuana; otra = 400). Valida que cada nota sea de ese vendedor y esa fecha; todo o nada. Permiso `nota_papel.revisar`.
- La fila del Flujo diario / Dashboard (`FilaVendedorDia`) gana `notasNoEntregadas: number | null`: `null` si el día
  tiene notas por revisar y ninguna se ha revisado; si no, cuántas quedaron en "no". Los tipos duplicados del portal
  cambian juntos.

## 5. Portal

- **Dashboard → ventana de notas del vendedor** y **Flujo diario → pestaña de notas** usan el mismo componente: las tres
  listas con sus nombres (§2), las casillas palomeadas por defecto, "Guardar revisión" y "Cancelar" como hoy, y debajo
  "Notas de Ventas NO Entregadas". En el Flujo diario se puede guardar si el día es hoy o ayer y hay permiso; si no, solo
  consulta.
- Columna "Notas de ventas": el número (rojo si > 0) junto al botón que abre la ventana.
- Piezas de `components/ui/`; nada recarga la página.

## 6. Fuera de alcance

El dinero del corte (ya se ve en el detalle, no se captura, como en el viejo), el corte de mercancía de Producción
(T-27 pieza 3), la tablet.
