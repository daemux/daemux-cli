/**
 * Enhanced Channel Type Definitions
 * Rich message types, attachment schemas, and the EnhancedChannel interface
 * for multi-channel communication support.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Message Content Types
// ---------------------------------------------------------------------------

export const ChannelMessageTypeSchema = z.enum([
  'text',
  'photo',
  'audio',
  'video',
  'voice',
  'video_note',
  'document',
  'sticker',
  'location',
  'contact',
  'animation',
]);

export type ChannelMessageType = z.infer<typeof ChannelMessageTypeSchema>;

// ---------------------------------------------------------------------------
// Attachment Schema
// ---------------------------------------------------------------------------

export const ChannelAttachmentSchema = z.object({
  type: ChannelMessageTypeSchema,
  /** Remote URL or file ID if available */
  url: z.string().optional(),
  /** Local file path if downloaded */
  filePath: z.string().optional(),
  /** Raw buffer data */
  data: z.instanceof(Buffer).optional(),
  /** MIME type */
  mimeType: z.string().optional(),
  /** Original filename */
  fileName: z.string().optional(),
  /** File size in bytes */
  fileSize: z.number().optional(),
  /** Duration in seconds (audio/video/voice/video_note) */
  duration: z.number().optional(),
  /** Width in pixels (photo/video/video_note/sticker) */
  width: z.number().optional(),
  /** Height in pixels (photo/video/video_note/sticker) */
  height: z.number().optional(),
});

export type ChannelAttachment = z.infer<typeof ChannelAttachmentSchema>;

// ---------------------------------------------------------------------------
// Rich Channel Message (extends existing ChannelMessage pattern)
// ---------------------------------------------------------------------------

export const RichChannelMessageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelType: z.string(),
  messageType: ChannelMessageTypeSchema,
  senderId: z.string(),
  senderName: z.string().optional(),
  senderUsername: z.string().optional(),
  /** Text content or caption */
  content: z.string(),
  /** Attached media */
  attachments: z.array(ChannelAttachmentSchema).default([]),
  /** ID of the message being replied to */
  replyToId: z.string().optional(),
  /** Thread/topic ID */
  threadId: z.string().optional(),
  /** Unix timestamp in milliseconds */
  timestamp: z.number(),
  /** Is this from a group chat? */
  isGroup: z.boolean().default(false),
  /** Group/chat title */
  chatTitle: z.string().optional(),
  /** Raw provider-specific metadata */
  metadata: z.record(z.unknown()).default({}),
});

export type RichChannelMessage = z.infer<typeof RichChannelMessageSchema>;

// ---------------------------------------------------------------------------
// Send Options
// ---------------------------------------------------------------------------

export const ChannelSendOptionsSchema = z.object({
  /** Attachments to send */
  attachments: z.array(z.object({
    type: ChannelMessageTypeSchema,
    data: z.instanceof(Buffer),
    fileName: z.string(),
    mimeType: z.string().optional(),
  })).optional(),
  /** Message ID to reply to */
  replyToId: z.string().optional(),
  /** Thread/topic ID */
  threadId: z.string().optional(),
  /** Text formatting mode */
  parseMode: z.enum(['text', 'markdown', 'html']).default('text'),
});

export type ChannelSendOptions = z.infer<typeof ChannelSendOptionsSchema>;

// ---------------------------------------------------------------------------
// Channel Events
// ---------------------------------------------------------------------------

export type ChannelEventHandler = {
  connected: () => void | Promise<void>;
  disconnected: (reason?: string) => void | Promise<void>;
  error: (error: Error) => void | Promise<void>;
  message: (message: RichChannelMessage) => void | Promise<void>;
};

export type ChannelEventType = keyof ChannelEventHandler;

// ---------------------------------------------------------------------------
// Enhanced Channel Interface
// ---------------------------------------------------------------------------

export interface EnhancedChannel {
  /** Unique channel instance ID */
  readonly id: string;
  /** Channel type identifier (e.g., 'telegram', 'discord') */
  readonly type: string;
  /** Whether the channel is currently connected */
  readonly connected: boolean;

  /** Connect to the channel service */
  connect(config: Record<string, unknown>): Promise<void>;
  /** Disconnect from the channel service */
  disconnect(): Promise<void>;

  /** Send a text message */
  sendText(
    chatId: string,
    text: string,
    options?: ChannelSendOptions,
  ): Promise<string>;

  /** Send a media attachment */
  sendMedia(
    chatId: string,
    attachment: {
      type: ChannelMessageType;
      data: Buffer;
      fileName: string;
      mimeType?: string;
      caption?: string;
    },
    options?: ChannelSendOptions,
  ): Promise<string>;

  /** Download a file attachment by its remote ID/URL */
  downloadAttachment(
    fileId: string,
  ): Promise<{ data: Buffer; mimeType?: string; fileName?: string }>;

  /** Register an event handler */
  on<E extends ChannelEventType>(
    event: E,
    handler: ChannelEventHandler[E],
  ): () => void;
}
