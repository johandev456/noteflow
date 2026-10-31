export interface LlmPreset {
  label: string;
  baseUrl: string;
  model: string;
}

/** DeepSeek and Kimi presets arrive in Phase 5, once their current IDs are verified. */
export const LLM_PRESETS = {
  qwen: {
    label: 'Qwen (Alibaba Model Studio, international)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '' },
} satisfies Record<string, LlmPreset>;

export type LlmPresetId = keyof typeof LLM_PRESETS;
