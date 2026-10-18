import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Shared by main.ts and the e2e tests so tests exercise the same pipeline as production.
export function configureApp(app: NestExpressApplication): void {
  // Largest legitimate body is a 2 KB URL plus a few fields.
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Registered before the router is initialized, so /docs wins over the GET /:code catch-all.
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Short-link Platform API').setVersion('0.1.0').build(),
  );
  SwaggerModule.setup('docs', app, document);
}
