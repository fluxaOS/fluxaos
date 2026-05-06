import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

let checkpointer: PostgresSaver | null = null;

export async function getCheckpointer(): Promise<PostgresSaver> {
  if (checkpointer) return checkpointer;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL required for LangGraph PostgresSaver checkpointer'
    );
  }

  checkpointer = PostgresSaver.fromConnString(connectionString);
  await checkpointer.setup();
  return checkpointer;
}

export async function closeCheckpointer(): Promise<void> {
  if (checkpointer) {
    await checkpointer.end();
    checkpointer = null;
  }
}
