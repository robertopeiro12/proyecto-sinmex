import type { Metadata } from "next";
import { FormularioLogin } from "@/components/auth/formulario-login";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Entrar · JAWA" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">JAWA</CardTitle>
          <p className="text-sm text-muted-foreground">Portal de administración</p>
        </CardHeader>
        <CardContent>
          <FormularioLogin />
        </CardContent>
      </Card>
    </div>
  );
}
