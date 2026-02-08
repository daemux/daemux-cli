/**
 * Retry Prompt Builder
 * Constructs a prompt with failure context prepended for task retries.
 */

export function buildRetryPrompt(
  description: string,
  failureContext: string | undefined,
  retryCount: number,
): string {
  if (!failureContext || retryCount <= 0) return description;

  return (
    `Previous attempt failed: ${failureContext}. ` +
    `This is attempt ${retryCount + 1}. Try a different approach.\n\n` +
    description
  );
}
