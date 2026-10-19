import { connection } from "next/server";
import { ConfigError } from "@/lib/env";

/** Run a route handler body at request time and turn thrown errors into JSON responses. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  await connection();
  try {
    const data = await fn();
    return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof ConfigError ? 503 : 500;
    console.error("[api]", message);
    return Response.json({ error: message }, { status });
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
