import type { CLIClient } from '../client';

export async function handleStatusCommand(client: CLIClient) {
  try {
    const health = await client.health.check.query();
    console.log(`fluxaOS is running`);
    console.log(`  Status: ${health.status}`);
    console.log(`  Timestamp: ${health.timestamp}`);
  } catch {
    console.error('fluxaOS server not reachable at configured URL');
    process.exit(1);
  }
}
