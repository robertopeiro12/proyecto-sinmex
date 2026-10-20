import { describe, expect, it } from "vitest";
import {
  coordenadaAEnviar,
  domicilioSinGuardar,
  etiquetaOrigenUbicacion,
  muestraBotonUbicar,
} from "./ubicacion-cliente";

const GOOGLE = { lat: 32.5251, lng: -117.0213, origen: "geocodificada" as const };
const NADA = { lat: null, lng: null, origen: null };

describe("etiquetaOrigenUbicacion (T-72, D6)", () => {
  it("sin coordenada en los campos: Sin ubicación", () => {
    expect(etiquetaOrigenUbicacion("", " ", GOOGLE)).toBe("Sin ubicación");
    expect(etiquetaOrigenUbicacion("", "", NADA)).toBe("Sin ubicación");
  });

  it("la coordenada guardada dice su origen", () => {
    expect(etiquetaOrigenUbicacion("32.5251", "-117.0213", GOOGLE)).toBe("Ubicada por Google");
    expect(
      etiquetaOrigenUbicacion("32.5149", "-117.0382", { lat: 32.5149, lng: -117.0382, origen: "gps" }),
    ).toBe("GPS de la tablet");
    expect(
      etiquetaOrigenUbicacion("32.5", "-117", { lat: 32.5, lng: -117, origen: "manual" }),
    ).toBe("Capturada a mano");
  });

  it("una coordenada distinta de la guardada es una captura a mano", () => {
    expect(etiquetaOrigenUbicacion("32.53", "-117.0213", GOOGLE)).toBe("Capturada a mano");
    expect(etiquetaOrigenUbicacion("32.5", "-117", NADA)).toBe("Capturada a mano");
  });
});

describe("muestraBotonUbicar (T-72, D6)", () => {
  it("sin coordenada y con domicilio, sí", () => {
    expect(muestraBotonUbicar("", "", "Av. Revolución 1234")).toBe(true);
  });

  it("con coordenada o sin domicilio, no", () => {
    expect(muestraBotonUbicar("32.5", "-117", "Av. Revolución 1234")).toBe(false);
    expect(muestraBotonUbicar("", "", null)).toBe(false);
    expect(muestraBotonUbicar("", "", "   ")).toBe(false);
  });
});

describe("domicilioSinGuardar (T-72)", () => {
  it("el campo igual al guardado (sin contar espacios) está guardado", () => {
    expect(domicilioSinGuardar("Av. Revolución 1234", "Av. Revolución 1234")).toBe(false);
    expect(domicilioSinGuardar(" Av. Revolución 1234 ", "Av. Revolución 1234")).toBe(false);
  });

  it("un domicilio escrito y no guardado, no", () => {
    expect(domicilioSinGuardar("Av. Revolución 1250", "Av. Revolución 1234")).toBe(true);
    expect(domicilioSinGuardar("Av. Revolución 1234", null)).toBe(true);
  });
});

describe("coordenadaAEnviar (T-72)", () => {
  const VACIOS = { lat: "", lng: "" };

  it("alta: el número, u omitida si está vacía", () => {
    expect(coordenadaAEnviar({ lat: "32.5", lng: "-117" }, null)).toEqual({ lat: 32.5, lng: -117 });
    expect(coordenadaAEnviar(VACIOS, null)).toEqual({ lat: undefined, lng: undefined });
  });

  it("edición sin tocar los campos: se omite, aunque estuvieran vacíos", () => {
    expect(coordenadaAEnviar(VACIOS, VACIOS)).toEqual({});
    expect(coordenadaAEnviar({ lat: "32.5", lng: "-117" }, { lat: "32.5", lng: "-117" })).toEqual({});
  });

  it("edición con cambios: las dos, y vaciarla manda null para borrarla", () => {
    expect(coordenadaAEnviar({ lat: "32.53", lng: "-117" }, { lat: "32.5", lng: "-117" })).toEqual({
      lat: 32.53,
      lng: -117,
    });
    expect(coordenadaAEnviar(VACIOS, { lat: "32.5", lng: "-117" })).toEqual({ lat: null, lng: null });
  });
});
