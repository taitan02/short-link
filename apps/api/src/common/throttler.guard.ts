import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest } from '../auth/auth.decorators';

// Runs after JwtAuthGuard. Authenticated traffic is limited per account so users behind one
// NAT don't share a bucket, and an attacker can't dodge limits by rotating IPs with one token.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: AuthenticatedRequest): Promise<string> {
    return Promise.resolve(req.user ? `user:${req.user.id}` : `ip:${req.ip}`);
  }
}
