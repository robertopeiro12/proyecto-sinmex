import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Placeholder({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">Próximamente</p>
      </CardContent>
    </Card>
  );
}
