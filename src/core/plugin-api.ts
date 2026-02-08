/**
 * Plugin API Implementation
 * Creates the 18-method plugin interface
 */

import type {
  AgentDefinition,
  AgentResult,
  Task,
  TaskStatus,
  LogLevel,
  MemoryEntry,
} from './types';

import type {
  PluginAPI,
  Channel,
  ChannelTarget,
  MCPConfig,
  MemoryProvider,
  LLMProvider,
  HookEvent,
  HookHandler,
} from './plugin-api-types';

// Re-export types
export * from './plugin-api-types';

// ---------------------------------------------------------------------------
// Plugin API Context
// ---------------------------------------------------------------------------

export interface PluginAPIContext {
  channels: Map<string, Channel>;
  mcpServers: Map<string, MCPConfig>;
  agents: Map<string, AgentDefinition>;
  memoryProviders: Map<string, MemoryProvider>;
  llmProviders: Map<string, LLMProvider>;
  hooks: Map<HookEvent, HookHandler[]>;
  taskManager: {
    create(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task;
    update(id: string, updates: Partial<Task>): Task;
    list(filter?: { status?: string; owner?: string }): Task[];
    get(id: string): Task | null;
  };
  stateManager: {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): void;
  };
  logger: {
    log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
  };
  spawnSubagent?: (
    agentName: string,
    task: string,
    options?: { timeout?: number; tools?: string[] }
  ) => Promise<AgentResult>;
}

// ---------------------------------------------------------------------------
// Plugin API Factory
// ---------------------------------------------------------------------------

export function createPluginAPI(context: PluginAPIContext): PluginAPI {
  return {
    // Registration
    registerChannel(channel: Channel): void {
      context.channels.set(channel.id, channel);
    },

    registerMCP(id: string, config: MCPConfig): void {
      context.mcpServers.set(id, config);
    },

    registerAgent(agent: AgentDefinition): void {
      context.agents.set(agent.name, agent);
    },

    registerMemory(provider: MemoryProvider): void {
      context.memoryProviders.set(provider.id, provider);
    },

    registerProvider(id: string, provider: LLMProvider): void {
      context.llmProviders.set(id, provider);
    },

    // Agent Operations
    async spawnSubagent(
      agentName: string,
      task: string,
      options?: { timeout?: number; tools?: string[] }
    ): Promise<AgentResult> {
      if (!context.spawnSubagent) {
        throw new Error('Subagent spawning not available');
      }
      return context.spawnSubagent(agentName, task, options);
    },

    listAgents(): AgentDefinition[] {
      return Array.from(context.agents.values());
    },

    getAgent(name: string): AgentDefinition | undefined {
      return context.agents.get(name);
    },

    // Task Operations
    async createTask(task: {
      subject: string;
      description: string;
      activeForm?: string;
      metadata?: Record<string, unknown>;
    }): Promise<Task> {
      return context.taskManager.create({
        ...task,
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: task.metadata ?? {},
        retryCount: 0,
      });
    },

    async updateTask(
      taskId: string,
      updates: {
        status?: TaskStatus;
        subject?: string;
        description?: string;
        activeForm?: string;
        owner?: string;
        addBlocks?: string[];
        addBlockedBy?: string[];
        metadata?: Record<string, unknown>;
      }
    ): Promise<Task> {
      const existing = context.taskManager.get(taskId);
      if (!existing) throw new Error(`Task ${taskId} not found`);

      const taskUpdates: Partial<Task> = {};

      if (updates.status !== undefined) taskUpdates.status = updates.status;
      if (updates.subject !== undefined) taskUpdates.subject = updates.subject;
      if (updates.description !== undefined) taskUpdates.description = updates.description;
      if (updates.activeForm !== undefined) taskUpdates.activeForm = updates.activeForm;
      if (updates.owner !== undefined) taskUpdates.owner = updates.owner;
      if (updates.metadata !== undefined) taskUpdates.metadata = updates.metadata;

      if (updates.addBlocks) {
        taskUpdates.blocks = [...existing.blocks, ...updates.addBlocks];
      }
      if (updates.addBlockedBy) {
        taskUpdates.blockedBy = [...existing.blockedBy, ...updates.addBlockedBy];
      }

      return context.taskManager.update(taskId, taskUpdates);
    },

    async listTasks(filter?: { status?: TaskStatus; owner?: string }): Promise<Task[]> {
      return context.taskManager.list(filter);
    },

    async getTask(taskId: string): Promise<Task | null> {
      return context.taskManager.get(taskId);
    },

    // Event Hooks
    on(event: HookEvent, handler: HookHandler): void {
      const handlers = context.hooks.get(event) ?? [];
      handlers.push(handler);
      context.hooks.set(event, handlers);
    },

    // Utilities
    async sendMessage(
      channelId: string,
      target: ChannelTarget,
      message: string
    ): Promise<string> {
      const channel = context.channels.get(channelId);
      if (!channel) throw new Error(`Channel ${channelId} not found`);
      return channel.send(target, message);
    },

    async searchMemory(
      query: string,
      options?: { provider?: string; limit?: number }
    ): Promise<MemoryEntry[]> {
      const providerId = options?.provider;
      const limit = options?.limit ?? 10;

      if (providerId) {
        const provider = context.memoryProviders.get(providerId);
        if (!provider) throw new Error(`Memory provider ${providerId} not found`);
        return provider.search(query, limit);
      }

      // Search all providers and combine results
      const results: MemoryEntry[] = [];
      for (const provider of context.memoryProviders.values()) {
        const providerResults = await provider.search(query, limit);
        results.push(...providerResults);
      }
      return results.slice(0, limit);
    },

    async getState<T>(key: string): Promise<T | undefined> {
      return context.stateManager.get<T>(key);
    },

    async setState<T>(key: string, value: T): Promise<void> {
      context.stateManager.set(key, value);
    },

    log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
      context.logger.log(level, message, data);
    },
  };
}
