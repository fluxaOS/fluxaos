import type {
  StageGraphInput,
  StageGraphResult,
  StageGraphRunner,
} from '@/core/ports/stage-graph-runner';
import { getCheckpointer } from './checkpoint-store';
import { runStageGraph } from './langgraph-stage-runner';

export class LangGraphStageGraphRunner implements StageGraphRunner {
  async run(
    input: StageGraphInput,
    threadId?: string
  ): Promise<StageGraphResult> {
    const checkpointer = await getCheckpointer();
    return runStageGraph(input, checkpointer, threadId);
  }
}
