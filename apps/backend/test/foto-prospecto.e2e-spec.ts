// PRIMER import, a proposito: pone FOTOS_DIR antes de que `app.module.ts` lea la
// configuracion. Ver el aviso de ese archivo — moverlo mas abajo hace que las
// pruebas escriban en el directorio de desarrollo.
import { FOTOS_DIR_PRUEBA } from './apoyo-fotos-dir';

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
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
import { CONTRATO_ACTUAL } from './../src/modules/sincronizacion/contrato';
import type { RespuestaPush } from './../src/modules/sincronizacion/contrato';
import { TAMANO_MAX_FOTO_BYTES } from './../src/modules/cartera-clientes/foto-prospecto';

/**
 * La foto del prospecto de punta a punta (T-40): `POST /sync/foto/:clave` y
 * `GET /clientes/:id/foto`.
 *
 * > [!danger] La prueba que de verdad importa esta en el bloque 4
 * > **Que una foto que falla no se lleve el prospecto.** Es el fallo que todo
 * > este diseno existe para prevenir, y el unico cuyo sintoma en produccion
 * > seria un cliente potencial perdido en silencio. Si algun dia hay que borrar
 * > pruebas de este archivo, esa es la ultima.
 *
 * Y la segunda en importancia, el bloque 1: **subir dos veces la misma clave
 * deja un solo archivo**. La idempotencia de este canal no es codigo, es como se
 * nombra el archivo (`<clave>.jpg`); esta prueba es lo que impide que alguien
 * meta un timestamp o un contador en el nombre y lo rompa sin darse cuenta.
 *
 * Archivo propio y no dentro de `prospectos.e2e-spec.ts` porque el canal es otro
 * (codigos HTTP, no el contrato del lote) y las fixtures tambien: esto necesita
 * un directorio de fotos temporal y un usuario del portal, que a esa suite no le
 * sirven de nada.
 */

// El PID pegado al timestamp: Jest corre los archivos en paralelo, en procesos
// distintos, y dos suites que arranquen en el mismo milisegundo compartirian
// prefijo — el afterAll de una borraria filas que la otra necesita.
const SUFIJO = `${Date.now()}-${process.pid}`;
const LOGIN_VENDEDOR = `e2e-foto-v-${SUFIJO}`;
const LOGIN_VENDEDOR_AJENO = `e2e-foto-va-${SUFIJO}`;
const LOGIN_PORTAL = `e2e-foto-p-${SUFIJO}`;
const LOGIN_PORTAL_AJENO = `e2e-foto-pa-${SUFIJO}`;
const PASSWORD = 'contrasena-de-prueba';
const PREFIJO = `ZZ-foto-${SUFIJO}`;

/**
 * Un JPEG minimo pero valido: SOI (`FF D8 FF`) + relleno + EOI (`FF D9`).
 *
 * Se construye a mano en vez de leer un .jpg de verdad del disco: la validacion
 * del servidor es de bytes de firma, asi que un archivo binario en el repo no
 * probaria nada mas y habria que mantenerlo.
 */
const jpeg = (relleno = 'foto'): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(relleno, 'utf8'),
    Buffer.from([0xff, 0xd9]),
  ]);

interface FilaCliente {
  id: string;
  nombre: string;
  telefono: string;
  encargado: string | null;
  tipo: string;
  tipo_negocio_id: string | null;
  comentarios: string | null;
  foto_archivo: string | null;
  foto_subida_en: Date | null;
}

interface DetalleCliente {
  id: string;
  nombre: string;
  tieneFoto: boolean;
  fotoSubidaEn: string | null;
}

describe('Foto del prospecto (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;

  let sucursalId: string;
  let sucursalAjenaId: string;
  let vendedorId: string;
  let vendedorAjenoId: string;
  let tipoNegocioId: string;
  let bearer: string;
  let bearerAjeno: string;
  let cookie: string;
  let cookieAjena: string;
  const usuarioIds: string[] = [];

  /* ---------------------------------------------------------------- */
  /* Ayudas                                                            */
  /* ---------------------------------------------------------------- */

  const push = (operaciones: unknown[], token = bearer) =>
    request(app.getHttpServer())
      .post('/sync/push')
      .set('Authorization', `Bearer ${token}`)
      .send({ contrato: CONTRATO_ACTUAL, operaciones });

  const subirFoto = (clave: string, cuerpo: Buffer, token = bearer) =>
    request(app.getHttpServer())
      .post(`/sync/foto/${clave}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/jpeg')
      .send(cuerpo);

  /**
   * Da de alta un prospecto por el `push` y devuelve su clave y su id de cliente.
   *
   * Pasa por la API de verdad en vez de insertar a mano porque el orden que el
   * diseno exige —la foto **despues** de que el prospecto fue aceptado— depende
   * de que `sync_operacion.entidad_id` quede apuntando al cliente, y eso lo hace
   * el despachador. Sembrarlo a mano probaria otra cosa.
   */
  const altaProspecto = async (
    nombre: string,
    token = bearer,
  ): Promise<{ clave: string; clienteId: string }> => {
    // La clave es un uuid v4 porque eso es lo que genera la tablet
    // (`expo-crypto.randomUUID`) y lo que acaba nombrando el archivo.
    const clave = randomUUID();
    const res = await push(
      [
        {
          clave,
          tipo: 'prospecto',
          fecha_operacion: '2026-09-18',
          ocurrido_en: '2026-09-18T18:03:22.000Z',
          datos: {
            nombre: `${PREFIJO} ${nombre}`,
            telefono: '6641112233',
            encargado: 'Don Aaron',
            tipo_negocio_id: tipoNegocioId,
            comentarios: 'Quiere probar jamaica',
            lat: 32.5149,
            lng: -117.0382,
            foto: null,
          },
        },
      ],
      token,
    ).expect(200);

    expect((res.body as RespuestaPush).resultados[0].estado).toBe('aplicada');

    const fila = await db
      .selectFrom('sync_operacion')
      .select(['entidad_tabla', 'entidad_id'])
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirstOrThrow();
    expect(fila.entidad_tabla).toBe('cliente');

    return { clave, clienteId: fila.entidad_id as string };
  };

  const filaCliente = (id: string): Promise<FilaCliente> =>
    db
      .selectFrom('cliente')
      .select([
        'id',
        'nombre',
        'telefono',
        'encargado',
        'tipo',
        'tipo_negocio_id',
        'comentarios',
        'foto_archivo',
        'foto_subida_en',
      ])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  /** Todo lo que hay en FOTOS_DIR cuyo nombre empiece por esa clave. */
  const archivosDe = async (clave: string): Promise<string[]> =>
    (await fs.readdir(FOTOS_DIR_PRUEBA)).filter((n) => n.startsWith(clave));

  const contenido = (archivo: string): Promise<Buffer> =>
    fs.readFile(join(FOTOS_DIR_PRUEBA, archivo));

  const iniciarSesionPortal = async (login: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ login, password: PASSWORD })
      .expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const acceso = cookies.find((c) => c.startsWith('jawa_access='));
    if (!acceso) throw new Error('El login no devolvio cookie de acceso.');
    return acceso.split(';')[0];
  };

  /* ---------------------------------------------------------------- */
  /* Fixtures                                                          */
  /* ---------------------------------------------------------------- */

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(OPCIONES_NEST);
    configurarApp(app);
    await app.init();
    db = app.get<Database>(DB_CONNECTION);

    const sucursales = await db
      .selectFrom('sucursal')
      .select(['id', 'codigo'])
      .where('deleted_at', 'is', null)
      .orderBy('codigo')
      .execute();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
    sucursalId = sucursales[0].id;
    sucursalAjenaId = sucursales[1].id;

    const hash = await app.get(PasswordService).hashear(PASSWORD);

    vendedorId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR,
          nombre: 'Vendedor de la foto',
          password_hash: hash,
          sucursal_id: sucursalId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    vendedorAjenoId = (
      await db
        .insertInto('vendedor')
        .values({
          login: LOGIN_VENDEDOR_AJENO,
          nombre: 'Vendedor de la otra sucursal',
          password_hash: hash,
          sucursal_id: sucursalAjenaId,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    tipoNegocioId = (
      await db
        .insertInto('tipo_negocio')
        .values({ nombre: `${PREFIJO} Taqueria` })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    // Usuarios del portal. `Administrador General` es hoy el unico perfil con
    // catalogo completo (T-08a), aunque para LEER la foto basta con la sesion.
    const { id: perfilId } = await db
      .selectFrom('perfil')
      .select('id')
      .where('nombre', '=', 'Administrador General')
      .executeTakeFirstOrThrow();

    for (const [login, suc] of [
      [LOGIN_PORTAL, null],
      // Atado a la OTRA sucursal: es el 403 por alcance.
      [LOGIN_PORTAL_AJENO, sucursalAjenaId],
    ] as const) {
      const { id } = await db
        .insertInto('usuario')
        .values({
          login,
          nombre: login,
          password_hash: hash,
          perfil_id: perfilId,
          sucursal_id: suc,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      usuarioIds.push(id);
    }

    const login = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN_VENDEDOR, password: PASSWORD })
      .expect(200);
    bearer = (login.body as { tokenAcceso: string }).tokenAcceso;

    const loginAjeno = await request(app.getHttpServer())
      .post('/auth/app/login')
      .send({ login: LOGIN_VENDEDOR_AJENO, password: PASSWORD })
      .expect(200);
    bearerAjeno = (loginAjeno.body as { tokenAcceso: string }).tokenAcceso;

    cookie = await iniciarSesionPortal(LOGIN_PORTAL);
    cookieAjena = await iniciarSesionPortal(LOGIN_PORTAL_AJENO);
  });

  afterAll(async () => {
    // Orden inverso a las llaves foraneas.
    await db
      .deleteFrom('sync_operacion')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('cliente')
      .where('nombre', 'like', `${PREFIJO}%`)
      .execute();
    await db
      .deleteFrom('tipo_negocio')
      .where('id', '=', tipoNegocioId)
      .execute();
    await db
      .deleteFrom('sesion_vendedor')
      .where('vendedor_id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    await db
      .deleteFrom('vendedor')
      .where('id', 'in', [vendedorId, vendedorAjenoId])
      .execute();
    if (usuarioIds.length > 0) {
      await db
        .deleteFrom('sesion_refresh')
        .where('usuario_id', 'in', usuarioIds)
        .execute();
      await db.deleteFrom('usuario').where('id', 'in', usuarioIds).execute();
    }
    await app.close();

    // El directorio temporal de fotos completo: son bytes de prueba y no los
    // quiere nadie en /tmp.
    await fs.rm(FOTOS_DIR_PRUEBA, { recursive: true, force: true });
  });

  /* ---------------------------------------------------------------- */
  /* 1. Camino feliz e idempotencia                                    */
  /* ---------------------------------------------------------------- */

  it('sube la foto de un prospecto ya sincronizado y la anota en su fila', async () => {
    const { clave, clienteId } = await altaProspecto('Con Foto');
    const bytes = jpeg('la foto del lugar');

    const res = await subirFoto(clave, bytes).expect(200);
    expect(res.body).toMatchObject({ clave });
    expect(
      new Date((res.body as { subida_en: string }).subida_en).getTime(),
    ).toBeGreaterThan(0);

    // El archivo, con el nombre que sale de la clave y los bytes exactos.
    expect(await archivosDe(clave)).toEqual([`${clave}.jpg`]);
    expect(await contenido(`${clave}.jpg`)).toEqual(bytes);

    // Y las dos columnas. `foto_archivo` es el NOMBRE, no una ruta: la ruta es
    // configuracion del despliegue y cambia con el hosting.
    const fila = await filaCliente(clienteId);
    expect(fila.foto_archivo).toBe(`${clave}.jpg`);
    expect(fila.foto_subida_en).not.toBeNull();
  });

  /**
   * La idempotencia de este canal **sale gratis**: la clave de la URL es la misma
   * llave de idempotencia de la operacion del prospecto, asi que el archivo se
   * llama igual las dos veces y la segunda sobreescribe.
   *
   * Esta prueba es lo que impide que alguien meta un timestamp, un contador o un
   * uuid nuevo en el nombre del archivo — cada foto quedaria duplicada en el
   * disco en cada reintento de una WiFi mala, y nadie lo notaria hasta que el
   * volumen se llenara.
   */
  it('subir dos veces la misma clave deja UN SOLO archivo', async () => {
    const { clave, clienteId } = await altaProspecto('Reenviada');

    await subirFoto(clave, jpeg('primer intento')).expect(200);
    const segunda = jpeg('segundo intento, la wifi se cayo a medias');
    await subirFoto(clave, segunda).expect(200);

    // Un solo archivo, y es el segundo contenido. Tampoco quedan temporales
    // `.parcial` sueltos.
    expect(await archivosDe(clave)).toEqual([`${clave}.jpg`]);
    expect(await contenido(`${clave}.jpg`)).toEqual(segunda);

    // Y un solo cliente: el reenvio de la foto no toca la cartera.
    expect(
      await db
        .selectFrom('cliente')
        .select('id')
        .where('nombre', '=', `${PREFIJO} Reenviada`)
        .execute(),
    ).toHaveLength(1);
    expect((await filaCliente(clienteId)).foto_archivo).toBe(`${clave}.jpg`);
  });

  /* ---------------------------------------------------------------- */
  /* 2. Resolucion de la clave                                         */
  /* ---------------------------------------------------------------- */

  it('una clave que el servidor no conoce es 404', async () => {
    // Cubre tambien la operacion RECHAZADA: por el contrato §7 un rechazo no
    // deja fila, asi que para el servidor es indistinguible de "nunca llego".
    // La tablet deja la foto pendiente y reintenta cuando el prospecto entre.
    const res = await subirFoto(randomUUID(), jpeg()).expect(404);
    expect((res.body as { message: string }).message).toMatch(/Sincroniza/);
  });

  it('una clave que no es un uuid es 400, y no toca el disco', async () => {
    // El nombre del archivo sale de la clave. Esta es la primera barrera contra
    // un `../..` en la URL; la segunda esta en `nombreArchivoFoto`.
    await request(app.getHttpServer())
      .post('/sync/foto/no-es-un-uuid')
      .set('Authorization', `Bearer ${bearer}`)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg())
      .expect(400);

    expect(await archivosDe('no-es-un-uuid')).toEqual([]);
  });

  it('la foto de un prospecto de OTRO vendedor es 403', async () => {
    // El alta la hace el vendedor ajeno; la foto la intenta el del token.
    const { clave, clienteId } = await altaProspecto('De Otro', bearerAjeno);

    const res = await subirFoto(clave, jpeg()).expect(403);
    expect((res.body as { message: string }).message).toMatch(/no es tuya/);

    // Ni archivo ni columna: no se escribe nada de una operacion ajena.
    expect(await archivosDe(clave)).toEqual([]);
    expect((await filaCliente(clienteId)).foto_archivo).toBeNull();
  });

  it('una operacion que no es un prospecto es 409', async () => {
    // Se siembra a mano: lo que se prueba es la comprobacion de `tipo`, y armar
    // una venta completa por el push traeria folios, lineas y precios a una
    // prueba que no habla de nada de eso.
    const clave = randomUUID();
    await db
      .insertInto('sync_operacion')
      .values({
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        clave_idempotencia: clave,
        tipo: 'venta',
        contrato: CONTRATO_ACTUAL,
        fecha_operacion: '2026-09-18',
        ocurrido_en: new Date(),
        datos: JSON.stringify({}),
        entidad_tabla: 'venta_nota',
        entidad_id: randomUUID(),
      })
      .execute();

    const res = await subirFoto(clave, jpeg()).expect(409);
    expect((res.body as { message: string }).message).toMatch(
      /solo un prospecto/,
    );
    expect(await archivosDe(clave)).toEqual([]);
  });

  it('un prospecto aceptado pero sin proyectar es 409', async () => {
    // `entidad_id` nulo: no hay fila `cliente` a la que la foto pertenezca, asi
    // que no hay donde anotarla. La tablet reintenta en la siguiente
    // sincronizacion.
    const clave = randomUUID();
    await db
      .insertInto('sync_operacion')
      .values({
        vendedor_id: vendedorId,
        sucursal_id: sucursalId,
        clave_idempotencia: clave,
        tipo: 'prospecto',
        contrato: CONTRATO_ACTUAL,
        fecha_operacion: '2026-09-18',
        ocurrido_en: new Date(),
        datos: JSON.stringify({}),
      })
      .execute();

    const res = await subirFoto(clave, jpeg()).expect(409);
    expect((res.body as { message: string }).message).toMatch(
      /todavia no esta proyectado/,
    );
    expect(await archivosDe(clave)).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* 3. Tamano y formato                                               */
  /* ---------------------------------------------------------------- */

  it('una foto de mas de 2 MB es 413 y no deja archivo', async () => {
    const { clave, clienteId } = await altaProspecto('Muy Pesada');

    // Un JPEG valido de verdad, solo enorme: lo que se prueba es el tope, no el
    // formato. Si se rechazara por formato, el 413 estaria pasando por el motivo
    // equivocado.
    const enorme = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(TAMANO_MAX_FOTO_BYTES + 1),
      Buffer.from([0xff, 0xd9]),
    ]);

    await subirFoto(clave, enorme).expect(413);

    expect(await archivosDe(clave)).toEqual([]);
    expect((await filaCliente(clienteId)).foto_archivo).toBeNull();
  });

  it('un contenido que no es JPEG es 415, aunque el Content-Type lo diga', async () => {
    const { clave, clienteId } = await altaProspecto('No Es Jpeg');

    // Firma de PNG, cabecera `image/jpeg`. Sin la comprobacion de contenido esto
    // quedaria guardado como `.jpg` y el portal mostraria una imagen rota meses
    // despues, sin ninguna pista de donde salio.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await subirFoto(clave, png).expect(415);

    expect(await archivosDe(clave)).toEqual([]);
    expect((await filaCliente(clienteId)).foto_archivo).toBeNull();
  });

  it('un JPEG cortado a medias es 415: empieza bien y no acaba', async () => {
    const { clave } = await altaProspecto('Cortada');
    // El sintoma de una subida que se quedo sin WiFi.
    await subirFoto(clave, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])).expect(
      415,
    );
    expect(await archivosDe(clave)).toEqual([]);
  });

  /* ---------------------------------------------------------------- */
  /* 4. AISLAMIENTO DEL FALLO — la prueba que de verdad importa        */
  /* ---------------------------------------------------------------- */

  /**
   * **Una foto que falla no se lleva el prospecto.**
   *
   * Es la razon de ser de todo el diseno: la foto va por un canal aparte del
   * lote del `push` justamente para que una imagen pesada, corrupta o a medias
   * **no rechace el alta**. Si esto se rompiera, el sintoma en produccion seria
   * un cliente potencial perdido en silencio — nadie relacionaria "no pude subir
   * la foto" con "el prospecto no esta en la cartera".
   *
   * Se comprueban las tres cosas que tendrian que seguir intactas:
   * la fila `cliente` con todos sus datos, las dos columnas de foto en nulo, y el
   * buzon con su proyeccion — mas que el reintento posterior SI entra.
   */
  it('una foto que falla NO se lleva el prospecto', async () => {
    const { clave, clienteId } = await altaProspecto('Sobrevive');
    const antes = await filaCliente(clienteId);

    // Cuatro formas distintas de que la foto falle, una detras de otra.
    await subirFoto(clave, Buffer.from('esto no es una foto')).expect(415);
    await subirFoto(clave, Buffer.alloc(0)).expect(415);
    await subirFoto(
      clave,
      Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.alloc(TAMANO_MAX_FOTO_BYTES + 1),
        Buffer.from([0xff, 0xd9]),
      ]),
    ).expect(413);
    await subirFoto(clave, jpeg(), bearerAjeno).expect(403);

    // 1. El prospecto sigue ahi, entero y sin un solo campo movido.
    const despues = await filaCliente(clienteId);
    expect(despues).toEqual(antes);
    expect(despues.tipo).toBe('prospecto');

    // 2. Las columnas de la foto siguen en nulo: el fallo no dejo un rastro que
    // hiciera creer al portal que hay una foto que servir.
    expect(despues.foto_archivo).toBeNull();
    expect(despues.foto_subida_en).toBeNull();

    // 3. El buzon sigue con su proyeccion intacta: la operacion del prospecto
    // sigue aceptada, asi que la tablet no la reenvia ni la marca en error.
    const buzon = await db
      .selectFrom('sync_operacion')
      .select(['entidad_tabla', 'entidad_id'])
      .where('clave_idempotencia', '=', clave)
      .executeTakeFirstOrThrow();
    expect(buzon).toEqual({ entidad_tabla: 'cliente', entidad_id: clienteId });

    // 4. Y no quedo basura en el disco, ni un `.parcial`.
    expect(await archivosDe(clave)).toEqual([]);

    // 5. El reintento con una foto buena entra, sobre el MISMO prospecto: el
    // fallo era recuperable y no costo nada.
    const buena = jpeg('a la quinta va la buena');
    await subirFoto(clave, buena).expect(200);
    const final = await filaCliente(clienteId);
    expect(final.id).toBe(antes.id);
    expect(final.foto_archivo).toBe(`${clave}.jpg`);
    expect(await contenido(`${clave}.jpg`)).toEqual(buena);
  });

  /* ---------------------------------------------------------------- */
  /* 5. Los dos actores no se mezclan (T-06)                           */
  /* ---------------------------------------------------------------- */

  it('la subida no acepta la cookie del portal: es un endpoint de la app', async () => {
    const { clave } = await altaProspecto('Cookie En Sync');
    await request(app.getHttpServer())
      .post(`/sync/foto/${clave}`)
      .set('Cookie', cookie)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg())
      .expect(401);
    expect(await archivosDe(clave)).toEqual([]);
  });

  it('la subida sin token es 401', async () => {
    await request(app.getHttpServer())
      .post(`/sync/foto/${randomUUID()}`)
      .set('Content-Type', 'image/jpeg')
      .send(jpeg())
      .expect(401);
  });

  /* ---------------------------------------------------------------- */
  /* 6. El portal la ve                                                */
  /* ---------------------------------------------------------------- */

  describe('GET /clientes/:id/foto', () => {
    it('sirve el archivo tal cual al usuario del portal', async () => {
      const { clave, clienteId } = await altaProspecto('Para El Portal');
      const bytes = jpeg('lo que vera el administrador');
      await subirFoto(clave, bytes).expect(200);

      const res = await request(app.getHttpServer())
        .get(`/clientes/${clienteId}/foto`)
        .set('Cookie', cookie)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      // Privado y sin cache compartido: es un negocio de la cartera.
      expect(res.headers['cache-control']).toMatch(/private/);
      expect(res.body).toEqual(bytes);
    });

    it('el detalle avisa de que hay foto, para no dibujar hueco sin ella', async () => {
      const { clave, clienteId } = await altaProspecto('Detalle Con Foto');
      const sinFoto = await altaProspecto('Detalle Sin Foto');

      const antes = await request(app.getHttpServer())
        .get(`/clientes/${clienteId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(antes.body as DetalleCliente).toMatchObject({
        tieneFoto: false,
        fotoSubidaEn: null,
      });

      await subirFoto(clave, jpeg()).expect(200);

      const despues = await request(app.getHttpServer())
        .get(`/clientes/${clienteId}`)
        .set('Cookie', cookie)
        .expect(200);
      const detalle = despues.body as DetalleCliente;
      expect(detalle.tieneFoto).toBe(true);
      expect(detalle.fotoSubidaEn).not.toBeNull();

      // El nombre del archivo NO viaja al portal: es la clave de idempotencia de
      // la sincronizacion y el portal no tiene por que conocerla.
      expect(JSON.stringify(detalle)).not.toContain(clave);

      // Y el de al lado, sin foto, sigue diciendo que no tiene.
      const otro = await request(app.getHttpServer())
        .get(`/clientes/${sinFoto.clienteId}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(otro.body as DetalleCliente).toMatchObject({ tieneFoto: false });
    });

    it('un prospecto sin foto es 404', async () => {
      const { clienteId } = await altaProspecto('Sin Foto');
      await request(app.getHttpServer())
        .get(`/clientes/${clienteId}/foto`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('si la columna apunta a un archivo que ya no esta, es 404 y no un 500', async () => {
      // El caso que predice `Despliegue y topologia`: el respaldo de la base NO
      // respalda las fotos, asi que la base puede saber de una foto que el disco
      // perdio. Tiene que salir como "no tiene foto", no como un stream roto a
      // mitad de la respuesta.
      const { clave, clienteId } = await altaProspecto('Archivo Perdido');
      await subirFoto(clave, jpeg()).expect(200);
      await fs.rm(join(FOTOS_DIR_PRUEBA, `${clave}.jpg`));

      await request(app.getHttpServer())
        .get(`/clientes/${clienteId}/foto`)
        .set('Cookie', cookie)
        .expect(404);
    });

    it('no acepta el Bearer del vendedor: es un endpoint del portal', async () => {
      const { clave, clienteId } = await altaProspecto('Bearer En Portal');
      await subirFoto(clave, jpeg()).expect(200);

      await request(app.getHttpServer())
        .get(`/clientes/${clienteId}/foto`)
        .set('Authorization', `Bearer ${bearer}`)
        .expect(401);
    });

    it('un usuario de otra sucursal recibe 403, no la foto', async () => {
      const { clave, clienteId } = await altaProspecto('Fuera De Alcance');
      await subirFoto(clave, jpeg()).expect(200);

      // Misma doctrina de alcance que `GET /clientes/:id` (T-09/T-11): se compara
      // contra la sucursal del cliente ya leido. La regla vive una sola vez.
      await request(app.getHttpServer())
        .get(`/clientes/${clienteId}/foto`)
        .set('Cookie', cookieAjena)
        .expect(403);
    });
  });
});
