/**
 * Error Classification Unit Tests
 * Tests mapping of raw error messages to user-friendly strings.
 */

import { describe, it, expect } from 'bun:test';
import { classifyError } from '../../src/core/error-classify';

describe('classifyError', () => {
  describe('Credential errors', () => {
    it('should match "credential" keyword', () => {
      expect(classifyError('Missing credential for API'))
        .toBe('Bot API credentials are not configured correctly.');
    });

    it('should match "authorized" keyword', () => {
      expect(classifyError('Not authorized to access this resource'))
        .toBe('Bot API credentials are not configured correctly.');
    });

    it('should be case-insensitive', () => {
      expect(classifyError('CREDENTIAL ERROR FOUND'))
        .toBe('Bot API credentials are not configured correctly.');
    });
  });

  describe('Authentication errors', () => {
    it('should match "authentication" keyword', () => {
      expect(classifyError('Authentication failed for user'))
        .toBe('Bot authentication failed. Please check your API key.');
    });

    it('should match "401" status code', () => {
      expect(classifyError('HTTP error 401 from server'))
        .toBe('Bot authentication failed. Please check your API key.');
    });

    it('should match "invalid api key" phrase', () => {
      expect(classifyError('Error: Invalid API Key provided'))
        .toBe('Bot authentication failed. Please check your API key.');
    });
  });

  describe('Rate limit errors', () => {
    it('should match "rate limit" phrase', () => {
      expect(classifyError('Rate limit exceeded, retry after 30s'))
        .toBe('Rate limited. Please try again in a moment.');
    });

    it('should match "429" status code', () => {
      expect(classifyError('HTTP 429 Too Many Requests'))
        .toBe('Rate limited. Please try again in a moment.');
    });
  });

  describe('Overloaded errors', () => {
    it('should match "overloaded" keyword', () => {
      expect(classifyError('Service is overloaded, please wait'))
        .toBe('The AI service is currently overloaded. Please try again shortly.');
    });

    it('should match "529" status code', () => {
      expect(classifyError('HTTP 529 Service Overloaded'))
        .toBe('The AI service is currently overloaded. Please try again shortly.');
    });
  });

  describe('Default / unknown errors', () => {
    it('should return default message for unknown errors', () => {
      expect(classifyError('Something completely unexpected happened'))
        .toBe('An error occurred while processing your message.');
    });

    it('should return default message for empty string', () => {
      expect(classifyError(''))
        .toBe('An error occurred while processing your message.');
    });

    it('should return default message for generic network error', () => {
      expect(classifyError('ECONNREFUSED 127.0.0.1:3000'))
        .toBe('An error occurred while processing your message.');
    });
  });

  describe('Pattern priority', () => {
    it('should match "credential" before "authentication"', () => {
      // "credential" pattern comes first in the array
      expect(classifyError('credential authentication failure'))
        .toBe('Bot API credentials are not configured correctly.');
    });

    it('should match "authorized" before "401"', () => {
      expect(classifyError('Not authorized - 401'))
        .toBe('Bot API credentials are not configured correctly.');
    });
  });
});
