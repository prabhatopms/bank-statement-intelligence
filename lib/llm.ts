import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

export function getLLMModel(provider: string, model: string) {
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return anthropic(model || 'claude-sonnet-4-20250514');
    case 'openai':
      return openai(model || 'gpt-4o');
    case 'google':
      return google(model || 'gemini-1.5-pro');
    default:
      return openai(model || 'gpt-4o');
  }
}
