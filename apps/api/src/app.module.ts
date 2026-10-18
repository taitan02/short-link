import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@short-link/prisma';
import { LoggerModule } from 'nestjs-pino';
import { Env, validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { LinksModule } from './links/links.module';
import { RedirectModule } from './redirect/redirect.module';

// The header is client-controlled and ends up in every log line, so anything that could
// inject into logs or blow up their size is replaced with a fresh id.
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

@Module({
  imports: [
    // .env files are loaded by the dev script (node --env-file-if-exists), never by the app, so
    // tests and containers only ever see the environment they were explicitly given.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty' }
              : undefined,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // Default serializers log all headers and the client IP; keep only what debugging needs.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        },
      }),
    }),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('DATABASE_URL', { infer: true }),
    }),
    HealthModule,
    LinksModule,
    // Last: its GET /:code catch-all must not shadow other single-segment routes.
    RedirectModule,
  ],
})
export class AppModule {}
