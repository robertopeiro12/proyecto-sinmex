import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'es_publico';

/** Exceptua un endpoint del guard global de sesion. */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
