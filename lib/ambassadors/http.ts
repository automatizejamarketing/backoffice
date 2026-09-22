import { NextResponse } from "next/server";
import { ZodError } from "zod";
export function mutationError(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Revise os campos informados." },
      { status: 400 },
    );
  // Drizzle wraps database failures with query text; never return that text.
  if (
    error instanceof Error &&
    !("cause" in error) &&
    error.constructor === Error
  )
    return NextResponse.json({ error: error.message }, { status: 409 });
  console.error(
    "Ambassador operation failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    { error: "Não foi possível salvar. Tente novamente." },
    { status: 500 },
  );
}
