import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaService, User } from '@short-link/prisma';
import { UserResponseDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(email: string, passwordHash: string): Promise<User> {
    try {
      return await this.prisma.user.create({ data: { email, passwordHash } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async getProfile(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return toUserResponse(user);
  }
}

export function toUserResponse(user: User): UserResponseDto {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}
