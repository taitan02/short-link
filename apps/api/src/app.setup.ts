import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppExceptionFilter } from './common/app-exception.filter';
import { Env } from './config/env';

// Shared by main.ts and the e2e tests so tests exercise the same pipeline as production.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Makes req.ip the real client address (used by rate limiting) when behind N proxies.
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.use(helmet());
  // Bearer tokens, no cookies: credentials stay off, so CORS can't be abused for CSRF.
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  // Largest legitimate body is a 2 KB URL plus a few fields.
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AppExceptionFilter(app.getHttpAdapter()));

  // Registered before the router is initialized, so /docs wins over the GET /:code catch-all.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Short-link Platform API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
