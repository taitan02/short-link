import {
  DynamicModule,
  FactoryProvider,
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const DATABASE_OPTIONS = Symbol('DATABASE_OPTIONS');

export interface DatabaseOptions {
  url: string;
  /** pg pool size (node-postgres defaults to 10). */
  poolMax?: number;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_OPTIONS) options: DatabaseOptions) {
    super({
      adapter: new PrismaPg({
        connectionString: options.url,
        max: options.poolMax,
        // Fail fast instead of letting requests (redirects especially) hang on a sick database.
        connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000,
      }),
    });
  }

  // Not onModuleDestroy: Nest runs every onModuleDestroy before any shutdown hook, so the pool
  // would close while requests and queue jobs are still finishing. Apps stop taking work in
  // beforeApplicationShutdown, which is guaranteed to run before this.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}

@Global()
@Module({})
export class PrismaModule {
  static forRootAsync(
    options: Pick<FactoryProvider<DatabaseOptions>, 'useFactory' | 'inject'>,
  ): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: DATABASE_OPTIONS, ...options }, PrismaService],
      exports: [PrismaService],
    };
  }
}
