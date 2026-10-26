import { notFound } from "next/navigation";
import { AppError } from "./errors";

/** Convert service-layer 404s into the Next.js not-found page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }
}
