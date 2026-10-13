# T-50 · Reporte de Kilometraje (+ T-15, exportación a Excel) — Diseño

**Issues:** [#50](https://github.com/robertopeiro12/proyecto-sinmex/issues/50) y
[#15](https://github.com/robertopeiro12/proyecto-sinmex/issues/15) (T-50 depende de T-15). Al cerrar se cierra
también [#38](https://github.com/robertopeiro12/proyecto-sinmex/issues/38) (su tercer criterio esperaba este reporte).
**Fecha:** 2026-10-13 · **Estado:** propuesto, pendiente de revisión de Roberto
**Base:** `Estadísticas y Reportes.md`, `Rutas.md` y `Vehículo.md` del vault; T-38 (tabla `jornada`,
`rutas/jornadas.service.ts`); T-09 (`resolverAlcance`); permiso `reportes.ver` (T-05).

## 1. Para qué

Fuentes del cliente (vault, `Estadísticas y Reportes.md`):

> **Reporte Kilometraje (v2.0)**: por selección de fechas, la información capturada en el portal desde la app.
> Columnas: Vehículo · Kilometraje Inicial · Kilometraje Final · Kilómetros. El kilometraje inicial es el que
> registra el vendedor al iniciar el día en la app; el final, al finalizar el día seleccionado.

Issue #50: "Como administrador, quiero un reporte de kilometraje por vehículo y rango (km inicial, final y
diferencia) para controlar el uso de las unidades. […] Exportable a Excel." Issue #15: "un mecanismo común de
exportación a Excel para reutilizarlo en reportes y nómina […] encabezados, totales y rangos de fecha […]
integrable desde cualquier reporte del portal."

Desde T-38 cada jornada **cerrada** que sube la tablet queda en `jornada` (vendedor, vehículo, sucursal, fecha,
`km_inicial`, `km_final`, ambos `numeric(10,1)`). Falta verla y exportarla.

**Reparto:** Portal = Roberto. **No se toca `apps/tablet`** ni el contrato de sincronización.

## 2. Decisiones de producto (Roberto, 2026-10-13)

| Tema | Decisión |
|---|---|
| Qué es un renglón | **Una jornada** (día × vehículo × vendedor), agrupadas por vehículo, con **total por vehículo** y gran total |
| Excel | **T-15 se hace dentro de T-50**: utilidad reutilizable; el reporte es el primero en usarla |
| Saltos | **Se marcan**: si una jornada empieza distinto a como terminó la anterior del mismo vehículo, el renglón se resalta con la diferencia con signo, y sale como columna "Salto" en el Excel |
| Lo que no entra | Los otros reportes ya tienen issue (#49, #51, #47); comparar contra el km de alta del vehículo va como idea a T-64 (#64); gráficas/guardar/correo no se piden |

## 3. Pantallas

### 3.1 Información → Reportes

`/informacion/reportes` deja de ser placeholder: una lista de los reportes disponibles con su descripción. Hoy
uno: **Kilometraje** → `/informacion/reportes/kilometraje`. Sin `reportes.ver`: "No tienes permiso para ver
reportes" (en las dos rutas).

### 3.2 Reporte de Kilometraje

**Filtros:** "Desde" y "Hasta" (por defecto del día 1 del mes actual a hoy, en hora de Tijuana), **Vehículo**
(opcional; "Todos" por defecto; la lista es la del catálogo de vehículos del alcance, incluidos los
desactivados) y el filtro global **"Por sucursal"**. Botón **"Consultar"**: nada se pide antes. Si "Desde" es
posterior a "Hasta", el aviso "La fecha inicial no puede ser posterior a la final." y no se consulta.

**Tabla**, agrupada por vehículo (orden: nombre del vehículo, luego placas) y dentro por fecha (luego por
vendedor):

| Fecha | Vendedor | Km inicial | Km final | Kilómetros | Salto |
|---|---|---|---|---|---|
| 01/10/2026 | Juan Pérez | 10,000.0 | 10,250.0 | 250.0 | |
| 02/10/2026 | Pedro López | 10,400.0 | 10,520.0 | 120.0 | **+150.0** |
| **Total Nissan-01 (ABC-123)** | | | | **370.0** | **+150.0** |

- Encabezado de cada grupo: nombre del vehículo y placas (y "(desactivado)" si `activo = false`).
- **Kilómetros** = `km_final − km_inicial` de la jornada. **Total del vehículo** = suma de sus kilómetros.
  **Salto del total** = suma de sus saltos (con signo).
- **Salto** de una jornada = `km_inicial` − `km_final` de la **jornada anterior del mismo vehículo** (por
  fecha y, en empate, hora de cierre), **buscada aunque caiga antes del rango**. Si es 0 o no hay jornada
  anterior: celda vacía. Si es distinto de 0: el renglón se resalta y la celda dice "+150.0" o "−30.0"
  (negativo = el odómetro "retrocedió": captura sospechosa). Un `title` explica: "Empezó 150.0 km distinto a
  como terminó la jornada anterior de este vehículo (01/10/2026)."
- **Gran total** al final: kilómetros y saltos de todo lo mostrado.
- Sin resultados: "No hay jornadas cerradas en ese rango."
- Solo jornadas **cerradas** (las únicas que guarda T-38) y vivas (`deleted_at is null`). Un vehículo
  **desactivado** sí aparece.
- Botón **"Exportar a Excel"**: deshabilitado hasta tener resultados; exporta exactamente lo mostrado (§4.3).

## 4. Diseño técnico

### 4.1 Servidor — `GET /reportes/kilometraje`

Módulo existente `apps/backend/src/modules/estadisticas/` (hoy stub; es el slug del vault "Estadísticas y
Reportes"): `reporte-kilometraje.controller.ts`, `.service.ts`, `.repository.ts` y una regla pura
`reglas-kilometraje.ts`.

- `@RequierePermiso('reportes.ver')`. Sesión de portal (no `@SoloApp()`).
- Query: `desde`, `hasta` (`AAAA-MM-DD`, obligatorias), `vehiculo` (uuid, opcional), `sucursal` (código, como
  los catálogos). Validación (400): fechas con formato y existentes; `desde ≤ hasta`; rango de **366 días como
  máximo** ("El rango no puede pasar de un año."); `vehiculo` uuid válido.
- Alcance: `resolverAlcance(sucursalDelUsuario, sucursalPedida)` sobre `jornada.sucursal_id` (que T-38 ya iguala
  a la del vehículo y la del vendedor). Un `vehiculo` de otra sucursal fuera del alcance simplemente no trae
  filas (no se revela que existe).
- **SQL**: una consulta con ventana. Se toman las jornadas vivas de los vehículos del alcance (y del `vehiculo`
  pedido) con `fecha ≤ hasta`; `lag(km_final) over (partition by vehiculo_id order by fecha, cerrada_en, id)`
  da el final de la anterior; **después** se filtra `fecha ≥ desde`. Así el primer día del rango se compara con
  la última jornada previa.
- Respuesta (camelCase), kilómetros en **décimas de km enteras** (las columnas son `numeric(10,1)`; se
  convierte en SQL con `round(km * 10)::int`, nunca `parseFloat * 10` en JS):

```ts
interface ReporteKilometraje {
  desde: string; hasta: string;
  vehiculos: Array<{
    vehiculoId: string; nombre: string; placas: string | null; activo: boolean;
    jornadas: Array<{
      jornadaId: string; fecha: string;            // AAAA-MM-DD
      vendedor: string;                             // nombre del vendedor
      kmInicialDecimas: number; kmFinalDecimas: number;
      kilometrosDecimas: number;                    // final − inicial
      saltoDecimas: number | null;                  // null = sin anterior; 0 = sin salto
      fechaAnterior: string | null;                 // fecha de la jornada con la que se comparó
    }>;
    totalKilometrosDecimas: number; totalSaltoDecimas: number;
  }>;
  totalKilometrosDecimas: number; totalSaltoDecimas: number;
}
```

- La regla pura `armarReporte(filas)` agrupa, ordena y suma; el SQL solo trae filas planas con
  `km_final_anterior` y `fecha_anterior`. Así los totales y el salto se prueban sin base.
- Sin migración: la tabla y el permiso ya existen.

### 4.2 Portal — pantallas

- `app/(portal)/informacion/reportes/page.tsx` (lista) y `app/(portal)/informacion/reportes/kilometraje/page.tsx`.
- `lib/reportes.ts`: tipos y `obtenerReporteKilometraje(filtros)` con el cliente HTTP existente (`lib/api.ts`).
- `components/reportes/pantalla-kilometraje.tsx` (filtros + estados) y `tabla-kilometraje.tsx` (grupos, totales,
  saltos resaltados). Formato de km: `1,234.5` (miles con coma, un decimal), en una función `formatearKm`.
- Permisos por `GET /auth/me`, como las demás pantallas. Filtro de sucursal: el mismo mecanismo de las demás
  pantallas (`?sucursal=` desde el selector global). La lista de vehículos: el endpoint del catálogo de
  vehículos que ya usa el portal.

### 4.3 Portal — utilidad de Excel (T-15) — `apps/portal/src/lib/excel/`

- **Librería: `exceljs`** (dependencia del workspace del portal). La alternativa SheetJS publicada en npm
  (`xlsx`) está congelada en una versión con avisos de seguridad; `exceljs` está mantenida y escribe `.xlsx`
  con estilos.
- **Carga diferida:** `await import('exceljs')` solo al exportar, para no engordar el bundle de todas las
  pantallas.
- API:

```ts
type TipoColumna = 'texto' | 'numero' | 'pesos' | 'fecha';
interface ColumnaExcel { encabezado: string; ancho?: number; tipo: TipoColumna; decimales?: number }
type Celda = string | number | null;           // 'fecha' recibe 'AAAA-MM-DD'
interface FilaExcel { celdas: Celda[]; tipo?: 'normal' | 'subtotal' | 'total' | 'grupo'; resaltada?: boolean }
interface DefinicionExcel {
  titulo: string;                               // fila 1, negrita
  filtros: Array<[etiqueta: string, valor: string]>; // filas 2..n: "Rango: 01/10/2026 a 13/10/2026", "Sucursal: TJ"
  columnas: ColumnaExcel[];
  filas: FilaExcel[];
  nombreArchivo: string;                        // sin extensión
}
construirLibro(def): Promise<ArrayBuffer>      // pura respecto al DOM: se prueba leyendo el archivo de vuelta
exportarExcel(def): Promise<void>              // construirLibro + descarga (Blob + <a download>)
```

- Números como **números** (no texto) con su formato (`#,##0.0`, `$#,##0.00`); fechas como fecha de Excel
  (`dd/mm/yyyy`); filas `subtotal`/`total` en negrita con borde superior; `grupo` en negrita (encabezado de un
  vehículo); `resaltada` con fondo amarillo claro; encabezados en negrita con fondo gris y la fila de
  encabezados **congelada**.
- Nombre del archivo del reporte: `kilometraje_<desde>_a_<hasta>.xlsx`.

## 5. Lo que NO entra

- Otros reportes: Ventas (#49), Clientes nuevos (#51), Nómina (#47). Usarán `lib/excel` (nota en el PR).
- Comparar contra `vehiculo.km_inicial` del alta: idea anotada en T-64 (#64).
- Gráficas, guardar reportes, enviarlos por correo: no los pidió el cliente; sin issue.
- Jornadas **abiertas** (T-43 todavía no las sube).
- Tocar la app de tablet.

## 6. Pruebas

- **Unitarias (backend):** `armarReporte` — agrupación y orden; kilómetros y totales; salto sin anterior
  (`null`), anterior fuera del rango, salto positivo, negativo y 0; empate de fecha entre dos jornadas del mismo
  vehículo (orden por `cerrada_en`). Validación de filtros (fechas, orden, rango > 366 días, uuid).
- **e2e (backend, Postgres local):** permiso (403 sin `reportes.ver`); rango; filtro por vehículo; sucursal
  (general con `?sucursal=`, y usuario de una sola sucursal que no ve la otra); excluye jornadas borradas;
  salto contra una jornada anterior al rango; vehículo desactivado aparece; 400 de fechas inválidas, invertidas
  y rango > 1 año; décimas exactas (p. ej. 10,000.5 → 100005).
- **Portal (Vitest + Testing Library):** `construirLibro` — abrir el `ArrayBuffer` con `exceljs` y comprobar
  título, filtros, encabezados, números como números, formatos, subtotales/total en negrita y fila resaltada;
  `formatearKm`; la pantalla — sin permiso, filtros por defecto, aviso de fechas invertidas, tabla con grupos,
  totales y salto resaltado, "sin resultados", y que "Exportar a Excel" llama `exportarExcel` con la definición
  esperada (mock).
- **A mano:** en el navegador contra el Postgres **local** con jornadas sembradas (incluido un salto), y abrir el
  `.xlsx` descargado.

## 7. Documentación al terminar

- `CLAUDE.md`: bloque corto **Reportes y Excel (T-50/T-15)** — `GET /reportes/kilometraje`, décimas de km, cómo
  se calcula el salto, y que todo reporte exporta con `lib/excel` (carga diferida de `exceljs`).
- Vault: `Estadísticas y Reportes.md` (Reporte Kilometraje implementado, saltos), `Estado del proyecto.md`
  (T-50, T-15, #38) y la bitácora. Sin ADR: no hay decisión de arquitectura nueva más allá de la librería, que
  se anota en `Stack tecnológico` como dependencia del portal.
- GitHub al cerrar: #50, #15 y #38 con sus casillas; comentario en #64 con la idea de comparar contra el km del
  alta; comentario en #49/#51/#47 de que la utilidad de Excel ya existe.

## 8. Riesgos y notas

- En `sinmex dev` hay 0 jornadas hoy: el reporte saldrá vacío hasta que la tablet de Mario cierre jornadas con
  la versión de T-38.
- Si un vendedor usa **dos vehículos el mismo día** no es posible hoy (una jornada viva por vendedor y día,
  `uq_jornada_vendedor_fecha`); si dos vendedores usan **el mismo vehículo el mismo día**, salen dos renglones
  y el salto se calcula en el orden de cierre.
- `exceljs` agrega peso solo cuando se exporta (carga diferida).
