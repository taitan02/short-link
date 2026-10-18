import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { Env } from '../config/env';
import { UserResponseDto } from '../users/users.dto';
import { UsersService, toUserResponse } from '../users/users.service';
import { AccessTokenDto, LoginDto, RegisterDto } from './auth.dto';
import { AccessTokenPayload } from './jwt-auth.guard';

// The library defaults are argon2id with m=19 MiB, t=2, p=1: the OWASP-recommended baseline.
// Raising memoryCost hardens hashes but costs RAM per concurrent login.

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly ttlSeconds: number;
  // Verified against when the email is unknown, so a miss costs the same as a wrong password
  // and response time doesn't reveal which emails are registered.
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('JWT_TTL_SECONDS', { infer: true });
  }

  async onModuleInit() {
    this.dummyHash = await hash('dummy-password-for-timing');
  }

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.users.create(dto.email, await hash(dto.password));
    return toUserResponse(user);
  }

  async login(dto: LoginDto): Promise<AccessTokenDto> {
    const user = await this.users.findByEmail(dto.email);
    const valid = await verify(user?.passwordHash ?? this.dummyHash, dto.password);
    if (!user || !valid) throw new UnauthorizedException('Invalid email or password');

    const payload: AccessTokenPayload = { sub: user.id };
    return {
      accessToken: await this.jwt.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.ttlSeconds,
    };
  }
}
