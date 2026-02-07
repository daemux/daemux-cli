/**
 * Audio Transcription Module
 * Provider interface and OpenAI implementation for speech-to-text.
 * Used by channel adapters to transcribe voice/audio messages.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Transcription Interfaces
// ---------------------------------------------------------------------------

export interface TranscriptionOptions {
  /** Model to use (default: gpt-4o-transcribe) */
  model?: string;
  /** Language hint (ISO 639-1) */
  language?: string;
  /** Response format */
  responseFormat?: 'text' | 'json' | 'verbose_json';
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(
    audio: Buffer,
    fileName: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// Response Validation Schema
// ---------------------------------------------------------------------------

const TranscriptionResultSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Retry Configuration
// ---------------------------------------------------------------------------

const RETRYABLE_STATUSES = [429, 500, 502, 503];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// OpenAI Transcription Provider
// ---------------------------------------------------------------------------

export class OpenAITranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai';
  private apiKey: string;
  private baseUrl: string;

  constructor(config: { apiKey: string; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  }

  async transcribe(
    audio: Buffer,
    fileName: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    const model = options?.model ?? 'gpt-4o-transcribe';
    const responseFormat = options?.responseFormat ?? 'json';
    const normalizedFileName = normalizeAudioExtension(fileName);

    const response = await this.fetchWithRetry(audio, normalizedFileName, model, responseFormat, options);

    if (responseFormat === 'text') {
      return { text: await response.text() };
    }

    return TranscriptionResultSchema.parse(await response.json());
  }

  private async fetchWithRetry(
    audio: Buffer,
    fileName: string,
    model: string,
    responseFormat: string,
    options?: TranscriptionOptions,
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const formData = new FormData();
      const mimeType = resolveAudioMimeType(fileName);
      formData.append('file', new Blob([audio], { type: mimeType }), fileName);
      formData.append('model', model);
      formData.append('response_format', responseFormat);
      if (options?.language) {
        formData.append('language', options.language);
      }

      const response = await fetch(
        `${this.baseUrl}/audio/transcriptions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: formData,
          signal: AbortSignal.timeout(120_000),
        },
      );

      if (response.ok) {
        return response;
      }

      if (attempt < MAX_RETRIES && RETRYABLE_STATUSES.includes(response.status)) {
        lastError = new Error(
          `Transcription failed (${response.status}), retrying (${attempt + 1}/${MAX_RETRIES})`,
        );
        continue;
      }

      const errorText = await response.text().catch(() => 'unknown error');
      throw new Error(
        `Transcription failed (${response.status}): ${errorText}`,
      );
    }

    throw lastError ?? new Error('Transcription failed after retries');
  }
}

// ---------------------------------------------------------------------------
// Audio Extension Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize audio file extensions for OpenAI transcription API compatibility.
 * Telegram sends voice messages as .oga (Ogg Opus), which OpenAI rejects.
 * Map unsupported extensions to their supported equivalents.
 *
 * OpenAI supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 */
const EXTENSION_MAP: Record<string, string> = {
  '.oga': '.ogg',
  '.opus': '.ogg',
  '.wma': '.mp3',
  '.aac': '.m4a',
  '.3gp': '.mp4',
};

function normalizeAudioExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return `${fileName}.ogg`;

  const ext = fileName.slice(dotIndex).toLowerCase();
  const mapped = EXTENSION_MAP[ext];
  if (!mapped) return fileName;

  return fileName.slice(0, dotIndex) + mapped;
}

/**
 * Resolve MIME type from file extension for the Blob.
 * Setting the correct MIME type helps OpenAI identify the audio format.
 */
const MIME_MAP: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.mpga': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
};

function resolveAudioMimeType(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return 'audio/ogg';

  const ext = fileName.slice(dotIndex).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTranscriptionProvider(
  config: { apiKey: string; baseUrl?: string },
): TranscriptionProvider {
  return new OpenAITranscriptionProvider(config);
}
