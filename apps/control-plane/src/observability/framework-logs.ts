const NEST_BOOTSTRAP: ReadonlySet<string> = new Set([
  'InstanceLoader',
  'NestApplication',
  'NestFactory',
  'RouterExplorer',
  'RoutesResolver',
  'WebSocketsController',
]);

export function isFrameworkChatter(message: unknown, context?: string): boolean {
  if (context !== undefined) return NEST_BOOTSTRAP.has(context);
  return typeof message === 'string' && message.startsWith('Server listening at ');
}
