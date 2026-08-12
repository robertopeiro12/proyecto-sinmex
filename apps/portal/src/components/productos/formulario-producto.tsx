"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useEnvioFormulario } from "@/components/catalogo/use-envio-formulario";
import { crearProducto, editarProducto, type Producto } from "@/lib/productos";

interface Props {
  producto: Producto | null;
  alGuardar: () => void;
  alCancelar: () => void;
}

/** Una fila del editor. `id` ausente = presentacion nueva. */
interface FilaPresentacion {
  id?: string;
  volumen: string;
  /** Clave estable de React: las filas nuevas no tienen id de base todavia. */
  clave: string;
}

const filaVacia = (): FilaPresentacion => ({
  volumen: "",
  clave: crypto.randomUUID(),
});

export function FormularioProducto({ producto, alGuardar, alCancelar }: Props) {
  const esAlta = producto === null;
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [filas, setFilas] = useState<FilaPresentacion[]>(
    producto?.presentaciones.map((p) => ({
      id: p.id,
      volumen: p.volumen,
      clave: p.id,
    })) ?? [filaVacia()],
  );
  const { enviando, error, enviar } = useEnvioFormulario(
    "No se pudo guardar el producto.",
  );

  const cambiarVolumen = (clave: string, volumen: string) =>
    setFilas((previas) =>
      previas.map((f) => (f.clave === clave ? { ...f, volumen } : f)),
    );

  const quitarFila = (clave: string) =>
    setFilas((previas) => previas.filter((f) => f.clave !== clave));

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();

    // Las filas en blanco se descartan en vez de mandarse: son ruido de una
    // fila recien agregada que el usuario no lleno, no un error suyo.
    const presentaciones = filas
      .map((f) => ({ id: f.id, volumen: f.volumen.trim() }))
      .filter((p) => p.volumen !== "");

    await enviar(
      () =>
        producto
          ? editarProducto(producto.id, { nombre, activo, presentaciones })
          : crearProducto({
              nombre,
              presentaciones: presentaciones.map(({ volumen }) => ({ volumen })),
            }),
      alGuardar,
    );
  }

  // El navegador no puede exigir "al menos una presentacion con texto" con
  // `required`, asi que el boton se desactiva. El servidor lo vuelve a exigir
  // igual (D8): esto es comodidad, no la regla.
  const hayAlgunVolumen = filas.some((f) => f.volumen.trim() !== "");

  return (
    <form
      onSubmit={alEnviar}
      className="mb-6 flex flex-col gap-4 rounded-md border p-4"
    >
      <h2 className="text-sm font-semibold">
        {esAlta ? "Nuevo producto" : `Editar ${producto.nombre}`}
      </h2>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nombre" className="text-sm font-medium">
          Nombre del producto
        </label>
        <input
          id="nombre"
          name="nombre"
          required
          maxLength={80}
          disabled={enviando}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Presentaciones</legend>
        {filas.map((fila) => (
          <div key={fila.clave} className="flex items-center gap-2">
            <input
              aria-label="Descripción del volumen"
              maxLength={40}
              disabled={enviando}
              placeholder="500 ml"
              value={fila.volumen}
              onChange={(e) => cambiarVolumen(fila.clave, e.target.value)}
              className="flex-1 rounded-md border px-3 py-2 text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              // Nunca dejar cero filas: el usuario se quedaria sin dónde
              // escribir y el formulario sin salida.
              disabled={enviando || filas.length === 1}
              onClick={() => quitarFila(fila.clave)}
            >
              Quitar
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enviando}
            onClick={() => setFilas((previas) => [...previas, filaVacia()])}
          >
            Agregar presentación
          </Button>
        </div>
      </fieldset>

      {!esAlta && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activo}
            disabled={enviando}
            onChange={(e) => setActivo(e.target.checked)}
          />
          Activo
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando || !hayAlgunVolumen}>
          {enviando ? "Guardando…" : "Guardar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={enviando}
          onClick={alCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
