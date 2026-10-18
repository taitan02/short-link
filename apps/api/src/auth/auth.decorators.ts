import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface AuthUser {
  id: string;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const IS_PUBLIC = 'isPublic';

/** Opts a route out of the global JwtAuthGuard. Everything else requires a valid token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  // Only reachable from a @Public() route; fail loudly rather than run a query scoped to
  // `undefined`.
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
