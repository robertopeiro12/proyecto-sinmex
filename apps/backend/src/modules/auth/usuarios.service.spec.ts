import { ConflictException } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import type { EditarUsuarioDto } from './dto/editar-usuario.dto';
import type { PasswordService } from './password.service';
import type { MatrizPerfiles, PerfilesService } from './perfiles.service';
import type { PermisosRepository } from './permisos.repository';
import type { UsuarioBase, UsuariosRepository } from './usuarios.repository';

/**
 * D7 del spec ("no dejar sin ningun Administrador General activo"), probada
 * aqui de forma unitaria con el repositorio mockeado -- es aritmetica pura
 * sobre un conteo, no necesita Postgres. Se movio aqui desde
 * usuarios.e2e-spec.ts: las dos pruebas e2e originales bajaban
 * TEMPORALMENTE a todos los "Administrador General" activos de la base para
 * forzar "queda exactamente uno", una escritura global que podia tumbar
 * pruebas de OTROS archivos de e2e corriendo en paralelo (Jest sin
 * `maxWorkers` en jest-e2e.json). El e2e conserva solo lo que SI es
 * integracion real: auto-baja y camino feliz.
 *
 * Mismo estilo de dobles a mano que permisos.guard.spec.ts: objetos
 * `{...} as unknown as Tipo`, sin libreria de mocking.
 */

const USUARIO_ID_ACTOR = 'actor-general'; // quien hace la peticion -- General, sin sucursal
const ID_EDITADO = 'usuario-maestro-unico';
const ID_PERFIL_MAESTRO = 'perfil-maestro';
const ID_PERFIL_NO_MAESTRO = 'perfil-auxiliar';

const actualMaestro: UsuarioBase = {
  id: ID_EDITADO,
  login: 'admin',
  nombre: 'Admin',
  perfil: 'Administrador General',
  perfilId: ID_PERFIL_MAESTRO,
  sucursalId: null,
  sucursalCodigo: null,
};

const dtoBajaAPerfilNoMaestro: EditarUsuarioDto = {
  login: 'admin',
  nombre: 'Admin',
  perfilId: ID_PERFIL_NO_MAESTRO,
  permisosMarcados: [],
};

/** Repo doble: solo los metodos que editar()/eliminar() llaman en este camino. */
const repoCon = (activosConPerfil: number): UsuariosRepository =>
  ({
    obtener: () => Promise.resolve(actualMaestro),
    buscarSucursalUsuario: () => Promise.resolve({ id: null, codigo: null }),
    contarActivosConPerfil: () => Promise.resolve(activosConPerfil),
    actualizar: () => Promise.resolve(actualMaestro),
    darDeBaja: () => Promise.resolve(undefined),
  }) as unknown as UsuariosRepository;

/** Matriz doble: un unico perfil destino, NO maestro. */
const perfilesConDestinoNoMaestro = (): PerfilesService =>
  ({
    obtenerMatriz: () =>
      Promise.resolve({
        permisos: [],
        perfiles: [
          {
            id: ID_PERFIL_NO_MAESTRO,
            nombre: 'Auxiliar Administrativo',
            esMaestro: false,
            permisos: [],
          },
        ],
      } satisfies MatrizPerfiles),
  }) as unknown as PerfilesService;

const permisosRepoDoble: PermisosRepository = {
  permisosDe: () => Promise.resolve(new Set<string>()),
} as unknown as PermisosRepository;

const passwordDoble: PasswordService = {
  hashear: () => Promise.resolve('hash-de-prueba'),
} as unknown as PasswordService;

describe('UsuariosService (D7: ultimo Administrador General activo)', () => {
  describe('editar()', () => {
    it('rechaza con ConflictException si es el ultimo activo (activos <= 1)', async () => {
      const service = new UsuariosService(
        repoCon(1),
        perfilesConDestinoNoMaestro(),
        permisosRepoDoble,
        passwordDoble,
      );

      await expect(
        service.editar(USUARIO_ID_ACTOR, ID_EDITADO, dtoBajaAPerfilNoMaestro),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('continua (no rechaza por esta regla) si quedan otros activos', async () => {
      const service = new UsuariosService(
        repoCon(2),
        perfilesConDestinoNoMaestro(),
        permisosRepoDoble,
        passwordDoble,
      );

      await expect(
        service.editar(USUARIO_ID_ACTOR, ID_EDITADO, dtoBajaAPerfilNoMaestro),
      ).resolves.toMatchObject({ id: ID_EDITADO });
    });
  });

  describe('eliminar()', () => {
    it('rechaza con ConflictException si es el ultimo activo (activos <= 1)', async () => {
      const service = new UsuariosService(
        repoCon(1),
        perfilesConDestinoNoMaestro(),
        permisosRepoDoble,
        passwordDoble,
      );

      await expect(
        service.eliminar(USUARIO_ID_ACTOR, ID_EDITADO),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('continua (no rechaza por esta regla) si quedan otros activos', async () => {
      const service = new UsuariosService(
        repoCon(2),
        perfilesConDestinoNoMaestro(),
        permisosRepoDoble,
        passwordDoble,
      );

      await expect(
        service.eliminar(USUARIO_ID_ACTOR, ID_EDITADO),
      ).resolves.toBeUndefined();
    });
  });
});
