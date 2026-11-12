import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_CLIENTES_RUTA } from './ruta-diaria.dto';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `GET /rutas/semanales?sucursal=TJ`. Sin sucursal = la del usuario o "Todas". */
export class ConsultaRutasSemanalesDto {
  @IsOptional()
  @IsString()
  sucursal?: string;
}

/** `PATCH /rutas/semanales/:id`: el nombre, recortado, de 1 a 80 caracteres. */
export class RenombrarRutaSemanalDto {
  @Transform(recortar)
  @IsString({ message: 'El nombre de la ruta es obligatorio.' })
  @MinLength(1, { message: 'El nombre de la ruta es obligatorio.' })
  @MaxLength(80, { message: 'El nombre no puede pasar de 80 caracteres.' })
  nombre!: string;
}

/** `POST /rutas/semanales`: una ruta de un dia (1 = lunes ... 6 = sabado) y una sucursal. */
export class CrearRutaSemanalDto extends RenombrarRutaSemanalDto {
  @IsOptional()
  @IsString()
  sucursal?: string;

  @IsInt({ message: 'Elige el día de la semana.' })
  @Min(1, { message: 'El día debe ser de lunes a sábado.' })
  @Max(6, { message: 'El día debe ser de lunes a sábado.' })
  diaSemana!: number;
}

/**
 * `PUT /rutas/semanales/:id/clientes`: la lista COMPLETA, en orden (reemplazo,
 * como la ruta diaria). Vacia es valida.
 */
export class GuardarClientesRutaSemanalDto {
  @IsArray({ message: 'La ruta debe ser una lista de clientes.' })
  @ArrayMaxSize(MAX_CLIENTES_RUTA, {
    message: `Una ruta no puede pasar de ${MAX_CLIENTES_RUTA} clientes.`,
  })
  @IsUUID(undefined, {
    each: true,
    message: 'Uno de los clientes no es válido.',
  })
  clientes!: string[];
}
