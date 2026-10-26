import { apiRoute } from "@/lib/api";
import { permissionsFor } from "@/lib/auth/permissions";

export const GET = apiRoute({}, async ({ user }) => ({ user, permissions: permissionsFor(user.role) }));
