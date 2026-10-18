import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle, hours, minutes } from '@nestjs/throttler';
import { UserResponseDto } from '../users/users.dto';
import { Public } from './auth.decorators';
import { AccessTokenDto, LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@ApiTooManyRequestsResponse()
@Public()
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Per IP: slows bulk account creation without blocking a shared office network.
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: hours(1) } })
  register(@Body() dto: RegisterDto): Promise<UserResponseDto> {
    return this.auth.register(dto);
  }

  // Per IP, with a lockout once exceeded, to make online password guessing impractical.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: minutes(1), blockDuration: minutes(5) } })
  login(@Body() dto: LoginDto): Promise<AccessTokenDto> {
    return this.auth.login(dto);
  }
}
