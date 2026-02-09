/**
 * Barrel export for all test mocks.
 * Import from 'tests/mocks' to access shared mock infrastructure.
 */

export {
  createMockAgentRegistry,
  makeAgentDef,
  makeSubagentRecord,
  type MockRegistryOptions,
  type SpawnCall,
} from './agent-registry';

export {
  createMockAgentExecutor,
  type MockAgentExecutor,
  type ExecutorCall,
} from './agent-executor';

export {
  createMockMessageBus,
  type MockMessageBus,
} from './message-bus';

export {
  MockLLMProvider,
  createMockLLMProvider,
  createReadyMockProvider,
} from './mock-llm-provider';

export {
  MockAnthropicClient,
  createMockAnthropicClient,
  createTextResponse,
  createToolUseResponse,
  createMaxTokensResponse,
} from './anthropic-client';
