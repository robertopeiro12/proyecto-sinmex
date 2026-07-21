# proyecto-sinmex (JAWA)

Este repo es el código del sistema **JAWA**: distribución de bebidas (Té de Jazmín,
Jamaica, Horchata, Limonada, Tamarindo, etc.), con App de Tablet para vendedores/
repartidores y Portal Web para administración.

## Memoria del proyecto (Obsidian vault — fuente de verdad)

El conocimiento de negocio y arquitectura **no vive en este repo**. Vive en un vault de
Obsidian separado, versionado en git, compartido entre los 2 desarrolladores y los
agentes de IA:

- Repo: https://github.com/brg8607/jawa-obsidian-memory
- Ruta local (convención): carpeta hermana de esta, `../jawa-obsidian-memory`

**Antes de trabajar en cualquier tarea de dominio o arquitectura, lee
`../jawa-obsidian-memory/AGENTS.md`** — es el contrato completo de cómo navegar y,
sobre todo, cómo mantener esa memoria actualizada.

Resumen de las reglas de oro del vault (el detalle está en su `AGENTS.md`):

- Una idea, una nota. Enlaza con `[[ ]]` en vez de duplicar contenido.
- Toda nota lleva frontmatter (`tipo`, `estado`, `actualizado`, etc.).
- `90-Fuentes/` es solo lectura — nunca editar.
- Decisión técnica relevante → crear un ADR en `30-Decisiones/`.
- Tras cambios de código relevantes, actualiza la nota de dominio/arquitectura afectada
  y `00-Inicio/Estado del proyecto.md` en el vault.
- No inventes: si algo no está confirmado, márcalo como pendiente en vez de asumir.

Si `../jawa-obsidian-memory` no existe en esta máquina, avisa al usuario en vez de
asumir o inventar contexto de negocio.

## Estructura del repo (monorepo, npm workspaces)

```
proyecto-sinmex/
├── apps/
│   ├── backend/   — NestJS (T-02). Módulos en src/modules/, uno por módulo de dominio
│   │                (mismos slugs que el vault: ventas-cobranza, tesoreria, etc.).
│   ├── portal/    — Next.js (T-03, pendiente)
│   └── tablet/    — React Native/Expo (T-04, pendiente)
├── supabase/      — migraciones (T-01)
├── .env.example   — plantilla de variables; .env.development es local, nunca se sube
└── package.json   — raíz del workspace
```

## Comandos

Desde la raíz del repo (no entres a `apps/backend` a mano, usa los scripts del workspace):

```
npm install                  # instala todo el monorepo (un solo node_modules)
npm run backend               # levanta el backend en modo dev (watch)
npm run lint --workspace=apps/backend
npm run build --workspace=apps/backend
npm test --workspace=apps/backend
```

Health check una vez levantado: `GET http://localhost:3000/health`.

CI (`.github/workflows/backend-ci.yml`) corre lint + build + test en cada push/PR que toque
`apps/backend/**`.
