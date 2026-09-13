import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '../../database/schema';
import {
  normalizarSucursalPedida,
  resolverAlcance,
} from '../sucursales/alcance-sucursal';
import { VentaRechazada } from '../ventas-cobranza/venta-rechazada';
import { VentasService } from '../ventas-cobranza/ventas.service';
import {
  CONTRATO_ACTUAL,
  CONTRATO_MINIMO,
  type RespuestaPull,
  type RespuestaPush,
  type ResultadoOperacion,
} from './contrato';
import {
  CODIGO_POR_RAZON,
  esColisionDeFolio,
  prepararProyeccion,
  type Proyeccion,
} from './despacho';
import type { PullDto, PushDto } from './dto/sincronizacion.dto';
import {
  claveReportable,
  hoyEnTijuana,
  normalizarOperacion,
  tipoReportable,
  type OperacionNormalizada,
} from './operaciones';
import {
  SincronizacionRepository,
  type EntidadProyectada,
  type ResultadoGuardado,
  type VendedorConSucursal,
} from './sincronizacion.repository';

/**
 * Cuanto se retrasa el cursor respecto al reloj del servidor.
 *
 * Una transaccion que ya fijo su `updated_at` pero todavia no hizo commit no es
 * visible en esta lectura. Con un cursor exactamente igual a `now()`, esa fila
 * quedaria para siempre por debajo del corte y **no se descargaria nunca**. Con
 * el retraso vuelve a caer dentro de la siguiente ventana. Reenviar de mas es
 * inofensivo: la tablet aplica el snapshot con upsert.
 *
 * TODO: T-43 — el motor de conflictos sustituira esto por una version por fila.
 */
const RETRASO_CURSOR_MS = 5_000;

@Injectable()
export class SincronizacionService {
  constructor(
    private readonly repo: SincronizacionRepository,
    // ADR-0009: sincronizacion despacha a los modulos de dominio, nunca al reves.
    private readonly ventas: VentasService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Pull                                                              */
  /* ---------------------------------------------------------------- */

  async pull(vendedorId: string, dto: PullDto): Promise<RespuestaPull> {
    exigirContrato(dto.contrato);

    const vendedor = await this.vendedorEnAlcance(vendedorId, dto.sucursal);
    const desde = interpretarDesde(dto.desde);

    const ahora = await this.repo.ahora();
    const cursor = new Date(ahora.getTime() - RETRASO_CURSOR_MS);
    const hoy = hoyEnTijuana(ahora);

    const [
      sucursales,
      vendedores,
      vehiculos,
      productos,
      presentaciones,
      clientes,
      notasPendientes,
    ] = await Promise.all([
      this.repo.sucursales(vendedor.sucursal_id, desde),
      this.repo.vendedores(vendedor.id, desde),
      this.repo.vehiculos(vendedor.sucursal_id, desde),
      this.repo.productos(desde),
      this.repo.presentaciones(desde),
      this.repo.clientes(vendedor.sucursal_id, desde),
      this.repo.notasPendientes(vendedor.sucursal_id, desde),
    ]);

    // Los precios van completos o no van: ver `RespuestaPull.catalogos.precios`.
    const hayQueMandarPrecios =
      desde === null ||
      (await this.repo.preciosCambiaron(vendedor.sucursal_id, desde));
    const precios = hayQueMandarPrecios
      ? await this.repo.precios(vendedor.sucursal_id, hoy)
      : [];

    return {
      contrato: CONTRATO_ACTUAL,
      servidor_en: ahora.toISOString(),
      desde: desde === null ? null : desde.toISOString(),
      completo: desde === null,
      cursor: cursor.toISOString(),
      vendedor: {
        id: vendedor.id,
        login: vendedor.login,
        nombre: vendedor.nombre,
        // T-14: la tablet emite el folio offline, pero **no decide** su segmento
        // de vendedor — solo baja su propia ficha, asi que no puede saber si
        // comparte iniciales con un companero. Se lo manda el servidor.
        folio_segmento: vendedor.folio_segmento,
      },
      sucursal: {
        id: vendedor.sucursal_id,
        codigo: vendedor.sucursal_codigo,
        nombre: vendedor.sucursal_nombre,
      },
      catalogos: {
        sucursales,
        vendedores,
        vehiculos,
        productos,
        presentaciones,
        clientes,
        precios,
      },
      notas_pendientes: notasPendientes,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Push                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Recibe el lote del dia.
   *
   * **Ni todo-o-nada ni exito falso.** Si 3 de 50 operaciones no pasan
   * validacion, las 47 buenas entran y la respuesta nombra las 3 con su motivo.
   * La unica excepcion es el alcance: un lote que intenta escribir por otro
   * vendedor o en otra sucursal no es un fallo parcial, es un cliente que no
   * deberia estar mandando eso, y se responde 403 sin guardar nada.
   *
   * **Una transaccion por operacion** (T-16, ADR-0009 §2.3). Cada operacion
   * entra al buzon y, si su `tipo` tiene modulo de dominio, se proyecta a sus
   * tablas en la misma transaccion: o queda todo, o no queda nada. Las
   * anteriores del lote ya hicieron commit, asi que un error inesperado a mitad
   * de lote no las pierde y el reintento de la tablet las recibe como
   * `duplicada`. Se aplican **en el orden del lote**: una cobranza de T-20 sobre
   * una venta del mismo lote necesita que la venta ya este.
   */
  async push(vendedorId: string, dto: PushDto): Promise<RespuestaPush> {
    exigirContrato(dto.contrato);

    const vendedor = await this.vendedorEnAlcance(vendedorId, dto.sucursal);
    const hoy = hoyEnTijuana(await this.repo.ahora());

    // 1. Validar todo el lote ANTES de escribir nada. Asi un intento de escribir
    //    fuera del alcance no deja media docena de operaciones ya guardadas.
    const pendientes: { posicion: number; op: OperacionNormalizada }[] = [];
    const resultados = new Map<number, ResultadoOperacion>();
    const clavesVistas = new Set<string>();

    dto.operaciones.forEach((cruda, posicion) => {
      const clave = claveReportable(cruda, posicion);
      const tipo = tipoReportable(cruda);
      const r = normalizarOperacion(cruda, vendedor.id, hoy, {
        // El folio que trae la operacion se coteja contra lo que el servidor
        // sabe por su cuenta: la sucursal sale del token (T-09, el cliente
        // propone y el servidor dispone) y el segmento lo asigno el servidor.
        sucursal: vendedor.sucursal_codigo,
        segmentoFolio: vendedor.folio_segmento,
      });

      if (r.ok === 'ajena') {
        throw new ForbiddenException(
          'No puedes sincronizar operaciones de otro vendedor.',
        );
      }

      if (r.ok === false) {
        resultados.set(posicion, {
          clave,
          tipo,
          estado: 'rechazada',
          codigo: r.codigo,
          motivo: r.motivo,
        });
        return;
      }

      // Dos operaciones del mismo lote con la misma clave: la segunda se
      // rechaza en vez de "resolverse" como duplicada. Un duplicado dentro de
      // un mismo envio no es un reintento, es un bug del cliente, y llamarlo
      // duplicada lo escondería.
      if (clavesVistas.has(r.operacion.clave)) {
        resultados.set(posicion, {
          clave,
          tipo,
          estado: 'rechazada',
          codigo: 'clave-repetida-en-el-lote',
          motivo: `La clave ${r.operacion.clave} viene mas de una vez en este lote.`,
        });
        return;
      }
      clavesVistas.add(r.operacion.clave);
      pendientes.push({ posicion, op: r.operacion });
    });

    // 2. El alcance de los clientes referenciados, en una sola consulta.
    const clienteIds = [
      ...new Set(
        pendientes
          .map(({ op }) => op.clienteId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const enAlcance = await this.repo.clientesEnAlcance(
      vendedor.sucursal_id,
      clienteIds,
    );

    // 3. Aplicar lo que quedo en pie, en el orden del lote.
    for (const { posicion, op } of pendientes) {
      if (op.clienteId !== null && !enAlcance.has(op.clienteId)) {
        // Esto SI es un rechazo por operacion y no un 403: el vendedor puede
        // tener en su tablet un cliente que el portal movio de sucursal o dio
        // de baja mientras el estaba en ruta. No es un intento de escapar del
        // alcance, es un snapshot viejo.
        resultados.set(posicion, {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: 'cliente-fuera-de-alcance',
          motivo: `El cliente ${op.clienteId} no existe o no es de tu sucursal.`,
        });
        continue;
      }

      // La forma de `datos` se valida despues del alcance y antes de abrir la
      // transaccion: no toca la base, y `clientesEnAlcance` sigue siendo una
      // sola consulta para todo el lote.
      const preparada = prepararProyeccion(op);
      if (preparada.ok === false) {
        resultados.set(posicion, {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: preparada.codigo,
          motivo: preparada.motivo,
        });
        continue;
      }

      resultados.set(
        posicion,
        await this.aplicar(vendedor, dto.contrato, op, preparada.proyeccion),
      );
    }

    const lista = dto.operaciones.map(
      (_, posicion) => resultados.get(posicion) as ResultadoOperacion,
    );

    return {
      contrato: CONTRATO_ACTUAL,
      recibido_en: new Date().toISOString(),
      resumen: {
        recibidas: lista.length,
        aplicadas: lista.filter((r) => r.estado === 'aplicada').length,
        duplicadas: lista.filter((r) => r.estado === 'duplicada').length,
        rechazadas: lista.filter((r) => r.estado === 'rechazada').length,
      },
      resultados: lista,
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * UNA operacion: buzon + proyeccion en la misma transaccion (ADR-0009 §2.3).
   *
   * El `catch` esta **fuera** de `enTransaccion` a proposito. Cuando llega ahi,
   * Kysely ya hizo `rollback`: nada de la operacion quedo escrito, y las
   * consultas de la clasificacion corren con la conexion normal. Con el `23505`
   * de un folio no hay otra forma: Postgres aborta la transaccion entera y
   * cualquier consulta posterior con el mismo `trx` fallaria (D10).
   */
  private async aplicar(
    vendedor: VendedorConSucursal,
    contrato: number,
    op: OperacionNormalizada,
    proyeccion: Proyeccion | null,
  ): Promise<ResultadoOperacion> {
    try {
      const guardado = await this.repo.enTransaccion(
        async (trx): Promise<ResultadoGuardado> => {
          const buzon = await this.repo.guardarOperacion(
            vendedor.id,
            vendedor.sucursal_id,
            contrato,
            op,
            trx,
          );
          // Ya estaba: no se proyecta otra vez. Es lo que hace seguro reenviar.
          if (buzon.duplicada || proyeccion === null) return buzon;

          const entidad = await this.proyectar(proyeccion, vendedor, op, trx);
          await this.repo.marcarProyectada(buzon.id, entidad, trx);
          return buzon;
        },
      );

      return {
        clave: op.clave,
        tipo: op.tipo,
        estado: guardado.duplicada ? 'duplicada' : 'aplicada',
        id_servidor: guardado.id,
      };
    } catch (error) {
      if (error instanceof VentaRechazada) {
        return {
          clave: op.clave,
          tipo: op.tipo,
          estado: 'rechazada',
          codigo: CODIGO_POR_RAZON[error.razon],
          motivo: error.message,
        };
      }
      if (esColisionDeFolio(error)) {
        return this.clasificarColision(vendedor, op);
      }
      // Cualquier otro error es un bug: sale como 500, igual que antes de T-16.
      throw error;
    }
  }

  /**
   * El despachador (ADR-0009 §2.1): cada `tipo` lo proyecta el modulo de
   * dominio dueno. Ningun INSERT a una tabla de negocio se escribe en
   * `sincronizacion/`.
   */
  private async proyectar(
    proyeccion: Proyeccion,
    vendedor: VendedorConSucursal,
    op: OperacionNormalizada,
    trx: Transaction<DB>,
  ): Promise<EntidadProyectada> {
    switch (proyeccion.tipo) {
      case 'venta': {
        const { id } = await this.ventas.registrarVenta(
          proyeccion.venta,
          {
            sucursalId: vendedor.sucursal_id,
            // Tal cual lo mando la tablet: el servidor no re-deriva el dia de UTC.
            fechaOperacion: op.fechaOperacion,
            vendedorId: vendedor.id,
            folio: op.folio,
            usuarioId: null,
          },
          trx,
        );
        return { tabla: 'venta_nota', id };
      }
    }
  }

  /**
   * **Colision de folios** (T-14), clasificada despues del rollback (T-16).
   *
   * No se acepta en silencio: el folio es con lo que se cotejan las notas
   * fisicas, y dos operaciones distintas con el mismo folio harian ese cotejo
   * imposible para siempre. Se rechaza **por operacion**: el resto de la jornada
   * del vendedor entra igual.
   *
   * > [!danger] Primero la clave
   * > Un reenvio legitimo que se solapa con el primero trae la misma clave Y el
   * > mismo folio, y puede chocar contra el unique del folio antes de ver la
   * > fila (sin commit) de la otra peticion. Si esa clave ya existe, era un
   * > reenvio: `duplicada`, no colision. Traducir todo `23505` a
   * > `folio-duplicado` dejaria esos reintentos en error para siempre.
   */
  private async clasificarColision(
    vendedor: VendedorConSucursal,
    op: OperacionNormalizada,
  ): Promise<ResultadoOperacion> {
    const propia = await this.repo.buscarPorClave(vendedor.id, op.clave);
    if (propia) {
      return {
        clave: op.clave,
        tipo: op.tipo,
        estado: 'duplicada',
        id_servidor: propia.id,
      };
    }

    const dueno = op.folio ? await this.repo.duenoDelFolio(op.folio) : null;
    return {
      clave: op.clave,
      tipo: op.tipo,
      estado: 'rechazada',
      codigo: 'folio-duplicado',
      motivo:
        dueno && dueno.vendedorId !== vendedor.id
          ? `El folio ${op.folio} ya lo uso otro vendedor. Hay que reasignarle un folio a esta operacion.`
          : `El folio ${op.folio} ya esta usado por otra operacion.`,
    };
  }

  /**
   * El vendedor del token, comprobando de paso que la sucursal que pide (si
   * pide alguna) es la suya.
   *
   * Reutiliza `resolverAlcance()` de T-09 tal cual: el cliente propone, el
   * servidor dispone. Un vendedor siempre esta atado a una sucursal
   * (`vendedor.sucursal_id` es NOT NULL), asi que nunca cae en la rama de
   * "usuario General" y pedir otra sucursal siempre es 403.
   */
  private async vendedorEnAlcance(
    vendedorId: string,
    sucursalPedida: string | undefined,
  ): Promise<VendedorConSucursal> {
    const vendedor = await this.repo.buscarVendedor(vendedorId);
    // El guard valido la FIRMA del token, no que el vendedor siga existiendo ni
    // que siga activo. Un token vivo de alguien dado de baja llega hasta aqui.
    if (!vendedor || !vendedor.activo) {
      throw new UnauthorizedException('Sesion invalida.');
    }

    resolverAlcance(
      vendedor.sucursal_codigo,
      normalizarSucursalPedida(sucursalPedida),
    );

    return vendedor;
  }
}

/**
 * El contrato es lo primero que se comprueba, antes que la sesion o los datos.
 *
 * Si la tablet y el servidor no hablan la misma version, cualquier otro error
 * seria una pista falsa: el problema no es el dato, es que uno de los dos se
 * quedo atras. Y el mensaje dice **cual** de los dos, porque quien lo va a leer
 * esta en el negocio con una tablet en la mano.
 */
function exigirContrato(contrato: number): void {
  if (!Number.isInteger(contrato)) {
    throw new BadRequestException('El contrato debe ser un entero.');
  }
  if (contrato > CONTRATO_ACTUAL) {
    throw new ConflictException({
      codigo: 'contrato-incompatible',
      message: `La tablet habla el contrato ${contrato} y este servidor llega al ${CONTRATO_ACTUAL}. Actualiza el servidor.`,
      contrato_servidor: CONTRATO_ACTUAL,
      contrato_minimo: CONTRATO_MINIMO,
    });
  }
  if (contrato < CONTRATO_MINIMO) {
    throw new ConflictException({
      codigo: 'contrato-incompatible',
      message: `La tablet habla el contrato ${contrato} y este servidor ya no lo acepta (minimo ${CONTRATO_MINIMO}). Actualiza la app.`,
      contrato_servidor: CONTRATO_ACTUAL,
      contrato_minimo: CONTRATO_MINIMO,
    });
  }
}

/**
 * El cursor del pull incremental.
 *
 * Un `desde` ilegible es 400 y no "vuelco completo por si acaso": tratarlo como
 * completo escondería un bug del cliente detras de una sincronizacion lenta que
 * nadie relacionaria con nada.
 */
function interpretarDesde(crudo: string | undefined): Date | null {
  if (crudo === undefined || crudo.trim() === '') return null;
  const instante = new Date(crudo);
  if (Number.isNaN(instante.getTime())) {
    throw new BadRequestException(
      'El parametro `desde` debe ser un instante ISO-8601 (usa el `cursor` del pull anterior).',
    );
  }
  return instante;
}
