/**
 * Swarm Approval Hooks
 * Allows gating swarm creation behind an approval mechanism.
 * Supports auto-approve (default) and interactive approval (e.g., Telegram).
 */

export interface ApprovalRequest {
  swarmId: string;
  task: string;
  agentCount: number;
  estimatedCost?: string;
}

export interface SwarmApprovalHook {
  requestApproval(request: ApprovalRequest): Promise<boolean>;
}

export class DefaultApprovalHook implements SwarmApprovalHook {
  async requestApproval(_request: ApprovalRequest): Promise<boolean> {
    return true;
  }
}

export interface InteractiveApprovalDeps {
  sendMessage: (msg: string) => Promise<void>;
  waitForResponse: () => Promise<string>;
}

export class InteractiveApprovalHook implements SwarmApprovalHook {
  private deps: InteractiveApprovalDeps;

  constructor(deps: InteractiveApprovalDeps) {
    this.deps = deps;
  }

  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    const costInfo = request.estimatedCost
      ? ` Estimated cost: ${request.estimatedCost}.`
      : '';

    const plural = request.agentCount === 1 ? '' : 's';
    const message =
      `Swarm needs ${request.agentCount} agent${plural} ` +
      `for: "${truncate(request.task, 100)}".${costInfo} Approve? (yes/no)`;

    await this.deps.sendMessage(message);
    const response = await this.deps.waitForResponse();

    return response.toLowerCase().startsWith('y');
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
