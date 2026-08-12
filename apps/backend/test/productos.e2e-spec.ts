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
});
