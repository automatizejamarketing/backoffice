"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CreditsControlProps {
  userId: string;
  credits: number;
}

const QUICK_ADD = [10, 50, 100] as const;
const QUICK_SUB = [10, 50, 100] as const;

export function CreditsControl({ userId, credits: initialCredits }: CreditsControlProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [credits, setCredits] = useState(initialCredits);
  const [customAmount, setCustomAmount] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const adjustInFlightRef = useRef(false);

  useEffect(() => {
    setCredits(initialCredits);
  }, [initialCredits]);

  const adjustCredits = async (amount: number) => {
    if (adjustInFlightRef.current) {
      return;
    }
    adjustInFlightRef.current = true;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/users/${userId}/credits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });

      if (response.ok) {
        const result = await response.json();
        setCredits(result.credits);
        startTransition(() => {
          router.refresh();
        });
      } else {
        console.error("Failed to update credits");
      }
    } catch (error) {
      console.error("Error updating credits:", error);
    } finally {
      adjustInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const applyCustomAmount = async (sign: 1 | -1) => {
    const raw = customAmount.trim().replace(",", ".");
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0) {
      return;
    }
    await adjustCredits(sign * n);
    setCustomAmount("");
  };

  const getBadgeVariant = (): "default" | "destructive" | "secondary" => {
    if (credits > 0) return "default";
    if (credits < 0) return "destructive";
    return "secondary";
  };

  const formatCredits = (n: number) =>
    new Intl.NumberFormat("pt-BR").format(n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Créditos
        </CardTitle>
        <CardDescription>
          Ajuste o saldo de créditos do usuário (alterações ficam registradas)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Saldo atual:</span>
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold tabular-nums">
                {formatCredits(credits)}
              </span>
              <Badge variant={getBadgeVariant()}>
                {credits > 0 ? "Positivo" : credits < 0 ? "Negativo" : "Zero"}
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              Ajuste rápido (adicionar):
            </span>
            <div className="flex flex-wrap gap-2">
              {QUICK_ADD.map((n) => (
                <Button
                  key={`add-${n}`}
                  variant="outline"
                  size="sm"
                  onClick={() => adjustCredits(n)}
                  disabled={isSaving || isPending}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  +{n}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              Ajuste rápido (remover):
            </span>
            <div className="flex flex-wrap gap-2">
              {QUICK_SUB.map((n) => (
                <Button
                  key={`sub-${n}`}
                  variant="outline"
                  size="sm"
                  onClick={() => adjustCredits(-n)}
                  disabled={isSaving || isPending}
                >
                  <Minus className="h-3 w-3 mr-1" />-{n}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="custom-credits" className="text-sm font-medium">
              Valor personalizado
            </Label>
            <div className="flex flex-wrap gap-2 items-end">
              <Input
                id="custom-credits"
                type="text"
                inputMode="numeric"
                placeholder="Ex: 25"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                disabled={isSaving || isPending}
                className="max-w-[140px]"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => void applyCustomAmount(1)}
                disabled={isSaving || isPending}
              >
                <Plus className="h-3 w-3 mr-1" />
                Adicionar
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void applyCustomAmount(-1)}
                disabled={isSaving || isPending}
              >
                <Minus className="h-3 w-3 mr-1" />
                Remover
              </Button>
            </div>
          </div>

          {(isSaving || isPending) && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isSaving ? "Salvando..." : "Atualizando..."}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
