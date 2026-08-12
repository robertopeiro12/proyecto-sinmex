import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { OPCIONES_NEST, configurarApp } from './../src/configurar-app';
import {
  DB_CONNECTION,
  type Database,
} from './../src/database/database.tokens';
import { PasswordService } from './../src/modules/auth/password.service';

interface PresentacionRespuesta {
  id: string;
  volumen: string;
}
interface ProductoRespuesta {
  id: string;
  nombre: string;
  activo: boolean;
  presentaciones: PresentacionRespuesta[];
}

const SUFIJO = Date.now();
const LOGIN_ADMIN = `e2e-prod-adm-${SUFIJO}`;
const LOGIN_SIN_PERMISO = `e2e-prod-sin-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';

// Prefijo reservado: la limpieza de afterAll borra por `nombre like`. Sin el,
// una corrida que deje basura envenena la siguiente con 409 inesperados.
const PREFIJO = `ZZ-e2e-${SUFIJO}`;

describe('Productos (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const usuarioIds: string[] = [];
  let cookieAdmin: string;
  let cookieSinPermiso: string;

  const iniciarSesion = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /**
   * Crea un usuario con el perfil indicado. `Administrador General` recibe el
   * catalogo completo de permisos por diseño (D1 de T-08a); los otros 5
   * perfiles estan VACIOS hasta T-08b, asi que sirven como "usuario sin
   * permiso" sin tener que montar nada.
   */
  const crearUsuario = async (login: string, perfil: string): Promise<void> => {
    const hash = await app.get(PasswordService).hashear(PASSWORD);
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', perfil)
      .executeTakeFirstOrThrow();
    const { id } = await db
      .insertInto('usuario')
      .values({
        login,
        nombre: login,
        password_hash: hash,
        perfil_id: perfilId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    usuarioIds.push(id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    await crearUsuario(LOGIN_ADMIN, 'Administrador General');
    await crearUsuario(LOGIN_SIN_PERMISO, 'Auxiliar Administrativo');
    cookieAdmin = await iniciarSesion(LOGIN_ADMIN);
    cookieSinPermiso = await iniciarSesion(LOGIN_SIN_PERMISO);
  });

  afterAll(async () => {
    const ids = await db
      .selectFrom('producto')
      .select('id')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    const productoIds = ids.map((f) => f.id);
    if (productoIds.length > 0) {
      await db
        .deleteFrom('presentacion')
        .where('producto_id', 'in', productoIds)
        .execute();
      await db.deleteFrom('producto').where('id', 'in', productoIds).execute();
    }
    if (usuarioIds.length > 0) {
      // `iniciarSesion` deja una fila en `sesion_refresh`: hay que borrarla
      // antes que el usuario o el FK truena (mismo orden que
      // sucursales.e2e-spec.ts).
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();
  });

  it('crea un producto con sus presentaciones', async () => {
    const res = await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Jamaica`,
        presentaciones: [{ volumen: '500 ml' }, { volumen: '1 Litro' }],
      })
      .expect(201);

    const producto = res.body as ProductoRespuesta;
    expect(producto.nombre).toBe(`${PREFIJO} Jamaica`);
    expect(producto.activo).toBe(true);
    expect(producto.presentaciones.map((p) => p.volumen).sort()).toEqual([
      '1 Litro',
      '500 ml',
    ]);
    expect(producto).not.toHaveProperty('deleted_at');
  });

  it('lista los productos con sus presentaciones', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Horchata`,
        presentaciones: [{ volumen: '355 ml' }],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/productos')
      .set('Cookie', cookieAdmin)
      .expect(200);

    const productos = res.body as ProductoRespuesta[];
    const horchata = productos.find((p) => p.nombre === `${PREFIJO} Horchata`);
    expect(horchata?.presentaciones).toHaveLength(1);
  });

  // Defiende D5: si alguien le pone el candado al GET, Ventas e Inventario se
  // quedan sin catalogo.
  it('deja listar aunque el usuario no tenga producto.gestionar', async () => {
    await request(app.getHttpServer())
      .get('/productos')
      .set('Cookie', cookieSinPermiso)
      .expect(200);
  });

  it('rechaza crear sin el permiso producto.gestionar', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieSinPermiso)
      .send({
        nombre: `${PREFIJO} Prohibida`,
        presentaciones: [{ volumen: '500 ml' }],
      })
      .expect(403);
  });

  it('rechaza un nombre duplicado con 409', async () => {
    const cuerpo = {
      nombre: `${PREFIJO} Tamarindo`,
      presentaciones: [{ volumen: '500 ml' }],
    };
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send(cuerpo)
      .expect(201);

    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send(cuerpo)
      .expect(409);
  });

  it('rechaza un nombre duplicado que solo cambia en mayusculas', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Limonada`,
        presentaciones: [{ volumen: '500 ml' }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} LIMONADA`,
        presentaciones: [{ volumen: '500 ml' }],
      })
      .expect(409);
  });

  it('rechaza un producto sin presentaciones con 400', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({ nombre: `${PREFIJO} Vacia`, presentaciones: [] })
      .expect(400);
  });

  // El volumen repetido se atrapa en el servicio, ANTES de tocar la base, asi
  // que esta prueba no ejercita la transaccion: comprueba que un 400 no deja
  // rastro. La transaccion (D7) sigue haciendo falta como ultima linea —el
  // unique de la base es quien de verdad decide y dos peticiones concurrentes
  // pueden colarse por la ventana entre la validacion y el insert— pero eso no
  // se puede provocar desde una prueba e2e secuencial, y fingir que si seria
  // peor que no probarlo.
  it('un alta rechazada no deja el producto a medias', async () => {
    await request(app.getHttpServer())
      .post('/productos')
      .set('Cookie', cookieAdmin)
      .send({
        nombre: `${PREFIJO} Atomica`,
        presentaciones: [{ volumen: '500 ml' }, { volumen: '500 ml' }],
      })
      .expect(400);

    const res = await request(app.getHttpServer())
      .get('/productos')
      .set('Cookie', cookieAdmin)
      .expect(200);
    const productos = res.body as ProductoRespuesta[];
    expect(
      productos.find((p) => p.nombre === `${PREFIJO} Atomica`),
    ).toBeUndefined();
  });

  it('rechaza un token de la app de tablet', async () => {
    await request(app.getHttpServer())
      .get('/productos')
      .set('Authorization', 'Bearer no-soy-un-token-del-portal')
      .expect(401);
  });

  describe('PATCH', () => {
    /** Crea un producto y devuelve su cuerpo, para no repetirlo en cada caso. */
    const crearProducto = async (
      nombre: string,
      volumenes: string[],
    ): Promise<ProductoRespuesta> => {
      const res = await request(app.getHttpServer())
        .post('/productos')
        .set('Cookie', cookieAdmin)
        .send({
          nombre,
          presentaciones: volumenes.map((volumen) => ({ volumen })),
        })
        .expect(201);
      return res.body as ProductoRespuesta;
    };

    it('cambia el nombre y conserva las presentaciones', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat1`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Pat1 renombrada`,
          presentaciones: producto.presentaciones.map((p) => ({
            id: p.id,
            volumen: p.volumen,
          })),
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.nombre).toBe(`${PREFIJO} Pat1 renombrada`);
      expect(actualizado.presentaciones).toHaveLength(1);
    });

    it('agrega una presentacion nueva sin tocar las existentes', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat2`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [
            { id: producto.presentaciones[0].id, volumen: '500 ml' },
            { volumen: '1 Litro' },
          ],
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.presentaciones.map((p) => p.volumen).sort()).toEqual([
        '1 Litro',
        '500 ml',
      ]);
      // La existente conserva su id: no se recreo.
      expect(
        actualizado.presentaciones.some(
          (p) => p.id === producto.presentaciones[0].id,
        ),
      ).toBe(true);
    });

    it('da de baja la presentacion que el payload omite', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat3`, [
        '500 ml',
        '1 Litro',
      ]);
      const sobrevive = producto.presentaciones.find(
        (p) => p.volumen === '500 ml',
      )!;

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [{ id: sobrevive.id, volumen: '500 ml' }],
        })
        .expect(200);

      expect((res.body as ProductoRespuesta).presentaciones).toHaveLength(1);
    });

    // D1: la baja es logica. Un borrado fisico haria que la fila desaparezca
    // del pull incremental de T-07 y la tablet se la quedaria para siempre.
    it('la baja de una presentacion es logica, no fisica', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat4`, [
        '500 ml',
        '1 Litro',
      ]);
      const sobrevive = producto.presentaciones.find(
        (p) => p.volumen === '500 ml',
      )!;
      const quitada = producto.presentaciones.find(
        (p) => p.volumen === '1 Litro',
      )!;

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          presentaciones: [{ id: sobrevive.id, volumen: '500 ml' }],
        })
        .expect(200);

      const fila = await db
        .selectFrom('presentacion')
        .select(['id', 'deleted_at'])
        .where('id', '=', quitada.id)
        .executeTakeFirst();

      expect(fila).toBeDefined();
      expect(fila?.deleted_at).not.toBeNull();
    });

    it('desactiva un producto sin tocar sus presentaciones', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat5`, ['500 ml']);

      const res = await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: producto.nombre,
          activo: false,
          presentaciones: [
            { id: producto.presentaciones[0].id, volumen: '500 ml' },
          ],
        })
        .expect(200);

      const actualizado = res.body as ProductoRespuesta;
      expect(actualizado.activo).toBe(false);
      expect(actualizado.presentaciones).toHaveLength(1);
    });

    it('rechaza quedarse sin presentaciones con 400', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat6`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieAdmin)
        .send({ nombre: producto.nombre, presentaciones: [] })
        .expect(400);
    });

    it('rechaza una presentacion de otro producto con 400', async () => {
      const uno = await crearProducto(`${PREFIJO} Pat7a`, ['500 ml']);
      const otro = await crearProducto(`${PREFIJO} Pat7b`, ['1 Litro']);

      await request(app.getHttpServer())
        .patch(`/productos/${uno.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: uno.nombre,
          presentaciones: [
            { id: otro.presentaciones[0].id, volumen: '1 Litro' },
          ],
        })
        .expect(400);
    });

    it('rechaza renombrar a un nombre que ya existe con 409', async () => {
      await crearProducto(`${PREFIJO} Pat8a`, ['500 ml']);
      const otro = await crearProducto(`${PREFIJO} Pat8b`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${otro.id}`)
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Pat8a`,
          presentaciones: [
            { id: otro.presentaciones[0].id, volumen: '500 ml' },
          ],
        })
        .expect(409);
    });

    it('rechaza editar sin el permiso producto.gestionar', async () => {
      const producto = await crearProducto(`${PREFIJO} Pat9`, ['500 ml']);

      await request(app.getHttpServer())
        .patch(`/productos/${producto.id}`)
        .set('Cookie', cookieSinPermiso)
        .send({
          nombre: `${PREFIJO} Pat9 hackeada`,
          presentaciones: [
            { id: producto.presentaciones[0].id, volumen: '500 ml' },
          ],
        })
        .expect(403);
    });

    it('responde 404 con un id que no existe', async () => {
      await request(app.getHttpServer())
        .patch('/productos/99999999-9999-9999-9999-999999999999')
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Fantasma`,
          presentaciones: [{ volumen: '500 ml' }],
        })
        .expect(404);
    });

    it('responde 400 con un id mal formado', async () => {
      await request(app.getHttpServer())
        .patch('/productos/no-soy-un-uuid')
        .set('Cookie', cookieAdmin)
        .send({
          nombre: `${PREFIJO} Malformada`,
          presentaciones: [{ volumen: '500 ml' }],
        })
        .expect(400);
    });
  });
});
