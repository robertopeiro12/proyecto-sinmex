"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Campo, Entrada } from "@/components/ui/campo";
import { Etiqueta } from "@/components/ui/etiqueta";
import { Ventana } from "@/components/ui/ventana";
import { MAX_RECADO, type FilaEditable } from "@/lib/rutas";

/**
 * "Clientes de la ruta: N" (spec §5.2): la ruta numerada, con ↑ / ↓, el recado bajo el
 * nombre y Quitar. Lo que agregó el vendedor lleva su etiqueta y NO se puede quitar
 * (T-37), solo reordenar. En solo lectura (día pasado) no hay botones.
 */
export function ListaRutaDiaria({
  filas,
  editable,
  onMover,
  onQuitar,
  onRecado,
}: {
  filas: FilaEditable[];
  editable: boolean;
  onMover: (desde: number, hasta: number) => void;
  onQuitar: (indice: number) => void;
  onRecado: (indice: number, texto: string) => void;
}) {
  const [recadoDe, setRecadoDe] = useState<number | null>(null);
  const filaRecado = recadoDe === null ? null : filas[recadoDe];

  return (
    <section aria-label="Clientes de la ruta" className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Clientes de la ruta: {filas.length}</h2>
      {filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {editable ? "Sin clientes. Escoge una ruta o agrégalos desde la cartera." : "Sin clientes."}
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-[10px] border">
          {filas.map((f, i) => (
            <li key={f.clienteId} className="flex items-start gap-2 px-3 py-1.5 text-sm">
              <span className="w-6 pt-1 text-right text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1 pt-1">
                <span className="font-medium">{f.clienteNombre}</span>
                {f.recado ? <p className="text-xs break-words text-muted-foreground">{f.recado}</p> : null}
              </div>
              {f.origen === "vendedor" ? <Etiqueta>agregada por el vendedor</Etiqueta> : null}
              {editable ? (
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Subir ${f.clienteNombre}`}
                    disabled={i === 0}
                    onClick={() => onMover(i, i - 1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Bajar ${f.clienteNombre}`}
                    disabled={i === filas.length - 1}
                    onClick={() => onMover(i, i + 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Recado para ${f.clienteNombre}`}
                    onClick={() => setRecadoDe(i)}
                  >
                    Recado
                  </Button>
                  {f.origen !== "vendedor" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Quitar ${f.clienteNombre}`}
                      onClick={() => onQuitar(i)}
                    >
                      Quitar
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <VentanaRecado
        key={recadoDe ?? "cerrada"}
        fila={filaRecado}
        alCerrar={() => setRecadoDe(null)}
        alGuardar={(texto) => {
          if (recadoDe !== null) onRecado(recadoDe, texto);
          setRecadoDe(null);
        }}
      />
    </section>
  );
}

function VentanaRecado({
  fila,
  alCerrar,
  alGuardar,
}: {
  fila: FilaEditable | null;
  alCerrar: () => void;
  alGuardar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(fila?.recado ?? "");
  const largo = texto.trim().length > MAX_RECADO;

  return (
    <Ventana abierta={fila !== null} alCerrar={alCerrar} titulo={`Recado para ${fila?.clienteNombre ?? ""}`}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!largo) alGuardar(texto);
        }}
      >
        <Campo
          id="recado-cliente"
          etiqueta="Recado"
          ayuda="Lo ve el vendedor en la app. Déjalo vacío para quitarlo."
          error={largo ? `El recado no puede pasar de ${MAX_RECADO} caracteres.` : null}
        >
          <Entrada
            autoComplete="off"
            placeholder="Ej. Vender solo de contado"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </Campo>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={largo}>
            Guardar recado
          </Button>
        </div>
      </form>
    </Ventana>
  );
}
