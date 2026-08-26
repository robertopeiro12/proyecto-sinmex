# Portal Web (JAWA)

Portal de administración (Next.js). Scaffold de T-03: layout, navegación y páginas placeholder.

## Desarrollo

Desde la raíz del repo:

```
npm run portal        # levanta el portal en http://localhost:3001
```

Estructura: App Router en `src/app/`, navegación en `src/components/layout/nav-config.ts`.
Las pantallas reales se agregan en sus tickets (T-09, T-10, T-12, …).

## Pruebas de pantalla (T-65)

Vitest + Testing Library, sin infraestructura nueva. Una pantalla se prueba renderizándola
completa (no solo sus piezas sueltas) y mockeando la capa de red en `src/lib/*.ts` — el mismo
límite que ya usaba `useCatalogo.test.tsx` al mockear `cargar`, ahora aplicado al componente
compuesto. `@/components/auth/auth-provider` también se mockea (su propia carga de sesión vía
`GET /auth/me` es un problema aparte de la pantalla).

Se descartó Playwright contra un stack real (backend + Postgres + navegador) para esto: detecta
más, pero exige un job de CI nuevo tipo `backend-ci.yml` y es más lento/frágil. Queda como opción
para un puñado de flujos críticos de humo, no como la base de cobertura de cada pantalla.

Ver `src/components/sucursales/pantalla-sucursales.test.tsx` como referencia: carga con y sin
permiso de gestión, error de carga, alta, edición y el mensaje de error del servidor en un 409.
