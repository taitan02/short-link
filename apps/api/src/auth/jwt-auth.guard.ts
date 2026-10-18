import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedRequest, IS_PUBLIC } from './auth.decorators';

export interface AccessTokenPayload {
  sub: string;
}

// Registered globally: a new route is protected unless it explicitly says @Public().
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      // Algorithm pinned so a token can't pick its own (e.g. "none").
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        algorithms: ['HS256'],
      });
      request.user = { id: payload.sub };
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
