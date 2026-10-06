import { CamposVentaDto } from './registrar-venta.dto';

/**
 * `PATCH /ventas/:id` (T-17 parte 2, §4.2): el ESTADO COMPLETO de lo editable.
 *
 * Sin cliente ni fecha: no se editan (si estan mal, se elimina y se registra
 * de nuevo). Sin precios: los pone el servidor; un `precioCentavos` en una
 * linea lo descarta el `whitelist` del ValidationPipe. `metodoPago` ausente en
 * contado = el del cobro de contado vigente, o transferencia.
 */
export class EditarVentaDto extends CamposVentaDto {}
