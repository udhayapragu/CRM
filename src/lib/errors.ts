export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "BAD_REQUEST",
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what = "Resource") => new AppError(`${what} not found`, 404, "NOT_FOUND");
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new AppError(msg, 403, "FORBIDDEN");
export const unauthorized = () => new AppError("Authentication required", 401, "UNAUTHORIZED");
export const conflict = (msg: string) => new AppError(msg, 409, "CONFLICT");
