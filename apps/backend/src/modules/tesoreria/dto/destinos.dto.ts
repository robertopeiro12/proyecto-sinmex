import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class GuardarDestinoDto {
  @IsUUID(undefined, { message: 'La sucursal no es válida.' })
  sucursalId!: string;

  @IsIn(['efectivo', 'transferencia', 'cheque'], {
    message: 'El método debe ser efectivo, transferencia o cheque.',
  })
  metodo!: 'efectivo' | 'transferencia' | 'cheque';

  @IsUUID(undefined, { message: 'La cuenta no es válida.' })
  cuentaId!: string;

  @Matches(RE_FECHA, {
    message: 'La fecha "desde" debe tener el formato AAAA-MM-DD.',
  })
  desde!: string;
}

export class ListarDestinosDto {
  @IsOptional()
  @IsString()
  sucursal?: string;
}
