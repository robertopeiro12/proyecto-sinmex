import { Injectable } from '@nestjs/common';
import { PerfilesService, type MatrizPerfiles } from './perfiles.service';

@Injectable()
export class UsuariosService {
  constructor(private readonly perfiles: PerfilesService) {}

  /**
   * D5 del spec: NO se expone GET /perfiles a quien administra usuarios
   * (ese endpoint exige perfil.gestionar, D3 de T-08b, a proposito). Se
   * reutiliza DIRECTO obtenerMatriz() -- ya trae exactamente lo que el
   * formulario de Usuarios necesita para precargar la matriz (D3): cada
   * perfil con su lista de claves efectivas, el maestro ya expandido al
   * catalogo completo.
   */
  async catalogoPerfiles(): Promise<MatrizPerfiles> {
    return this.perfiles.obtenerMatriz();
  }
}
