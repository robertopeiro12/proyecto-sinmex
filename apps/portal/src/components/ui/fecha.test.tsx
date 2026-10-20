import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Fecha } from "./fecha";

describe("Fecha", () => {
  it("dd/mm/aaaa, con la fecha original en dateTime", () => {
    render(<Fecha valor="2024-03-04" />);
    expect(screen.getByText("04/03/2024")).toHaveAttribute("dateTime", "2024-03-04");
  });

  it("con hora: dd/mm/aaaa hh:mm", () => {
    render(<Fecha valor="2026-10-13 09:15" conHora />);
    expect(screen.getByText("13/10/2026 09:15")).toBeInTheDocument();
  });
});
