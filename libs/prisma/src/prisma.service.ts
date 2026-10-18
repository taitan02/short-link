import {
  DynamicModule,
  FactoryProvider,
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const DATABASE_URL = Symbol('DATABASE_URL');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(DATABASE_URL) databaseUrl: string) {
    super({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        // Fail fast instead of letting requests (redirects especially) hang on a sick database.
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
      }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({})
export class PrismaModule {
  static forRootAsync(
    options: Pick<FactoryProvider<string>, 'useFactory' | 'inject'>,
  ): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: DATABASE_URL, ...options }, PrismaService],
      exports: [PrismaService],
    };
  }
}
