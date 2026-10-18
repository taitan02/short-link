import { Prisma } from './generated/prisma/client';

// Node socket errors, surfaced as the error code when the pg adapter cannot reach the server.
const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);
// Prisma's own codes: can't reach server, timed out, connection closed, pool timeout.
const PRISMA_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024']);
// SQLSTATEs (reported by the pg adapter under P2039): too many connections, query canceled by
// statement_timeout, admin/crash shutdown, server starting up or shutting down.
const UNAVAILABLE_SQLSTATES = new Set(['53300', '57014', '57P01', '57P02', '57P03']);

function sqlState(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const adapterError: unknown = error.meta?.driverAdapterError;
  if (typeof adapterError !== 'object' || adapterError === null || !('cause' in adapterError)) {
    return undefined;
  }
  const cause: unknown = adapterError.cause;
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : undefined;
}

/**
 * Returns why a query failed when the database is unreachable or refusing work (an error code or
 * SQLSTATE), or undefined for anything else: bugs, constraint violations. Callers answer 503
 * instead of 500 for these, and queue jobs simply retry.
 */
export function databaseUnavailableReason(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientInitializationError) return 'initialization';
  // pg-pool raises this plain Error when the server drops a live connection (e.g. during a
  // shutdown); Prisma passes it through unwrapped. Observed in the Postgres-outage experiment.
  if (error instanceof Error && error.message === 'Connection terminated unexpectedly') {
    return 'connection-terminated';
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  if (CONNECTION_ERROR_CODES.has(error.code) || PRISMA_UNAVAILABLE_CODES.has(error.code)) {
    return error.code;
  }
  const state = sqlState(error);
  // Class 08: connection exceptions.
  if (state !== undefined && (state.startsWith('08') || UNAVAILABLE_SQLSTATES.has(state))) {
    return state;
  }
  return undefined;
}
