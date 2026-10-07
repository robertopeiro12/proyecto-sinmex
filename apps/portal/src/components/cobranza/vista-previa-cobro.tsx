import { describirAplicacion, type NotaPorCobrar, type PlanDeCobro } from "@/lib/cobranzas";
import { formatearPesos } from "@/lib/ventas";

/** El orden del servidor: fecha y luego folio, comparados como texto. */
function porFechaYFolio(a: NotaPorCobrar, b: NotaPorCobrar): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.folio !== b.folio) return a.folio < b.folio ? -1 : 1;
  return 0;
}

/**
 * §3.3: por nota marcada, cuánto recibe y cómo queda; luego lo que iría a otras
 * notas y a saldo a favor. Lo calculó el servidor con la misma regla que la
 * tablet: aquí solo se pinta.
 */
export function VistaPreviaCobro({ plan, palomeadas }: { plan: PlanDeCobro; palomeadas: NotaPorCobrar[] }) {
  const recibe = new Map(plan.aplicaciones.map((a) => [a.notaId, a]));
  const otras = plan.aplicaciones.filter((a) => !a.palomeada);
  return (
    <div role="region" aria-label="Vista previa" className="flex flex-col gap-1 rounded-md bg-muted p-3 text-sm">
      <p className="font-medium">Así quedaría:</p>
      <ul className="list-inside list-disc">
        {[...palomeadas].sort(porFechaYFolio).map((n) => {
          const a = recibe.get(n.id);
          return <li key={n.id}>{a ? describirAplicacion(a) : `${n.folio} sin pago`}</li>;
        })}
      </ul>
      {otras.length > 0 && (
        <>
          <p className="font-medium">A otras notas del cliente:</p>
          <ul className="list-inside list-disc">
            {otras.map((a) => (
              <li key={a.notaId}>{describirAplicacion(a)}</li>
            ))}
          </ul>
        </>
      )}
      {plan.saldoFavorCentavos > 0 && <p>A saldo a favor: {formatearPesos(plan.saldoFavorCentavos)}</p>}
    </div>
  );
}
