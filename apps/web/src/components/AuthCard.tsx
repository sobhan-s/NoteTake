import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

export interface AuthCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
          {subtitle ? (
            <p className="text-sm text-zinc-500">{subtitle}</p>
          ) : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
