/**
 * Error Classification
 * Maps raw error messages to user-friendly messages for channel responses.
 */

const ERROR_PATTERNS: Array<{ test: (lower: string) => boolean; message: string }> = [
  {
    test: (s) => s.includes('credential') || s.includes('authorized'),
    message: 'Bot API credentials are not configured correctly.',
  },
  {
    test: (s) => s.includes('authentication') || s.includes('401') || s.includes('invalid api key'),
    message: 'Bot authentication failed. Please check your API key.',
  },
  {
    test: (s) => s.includes('rate limit') || s.includes('429'),
    message: 'Rate limited. Please try again in a moment.',
  },
  {
    test: (s) => s.includes('overloaded') || s.includes('529'),
    message: 'The AI service is currently overloaded. Please try again shortly.',
  },
];

const DEFAULT_ERROR_MESSAGE = 'An error occurred while processing your message.';

/**
 * Classify a raw error message into a user-friendly string.
 * Used by both ChannelRouter (legacy mode) and ChatSession (dialog mode).
 */
export function classifyError(errorMsg: string): string {
  const lower = errorMsg.toLowerCase();
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(lower)) return pattern.message;
  }
  return DEFAULT_ERROR_MESSAGE;
}
