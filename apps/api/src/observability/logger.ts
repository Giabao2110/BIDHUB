export function log(event: string, fields: Record<string, unknown> = {}) {
  // Callers must pass operational metadata only, never request bodies or headers.
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
}
