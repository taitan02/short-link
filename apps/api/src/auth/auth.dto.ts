import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // Length over composition rules (NIST 800-63B). The cap bounds hashing cost per request.
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No MinLength: login must not reveal the password policy of existing accounts.
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class AccessTokenDto {
  accessToken!: string;
  tokenType!: 'Bearer';
  /** Seconds until the token expires. */
  expiresIn!: number;
}
