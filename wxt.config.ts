import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'NoteFlow',
    description: 'Live tab-audio transcription with AI-structured notes and Notion export.',
    permissions: ['tabCapture', 'offscreen', 'sidePanel', 'storage', 'activeTab'],
    host_permissions: [
      'https://api.deepgram.com/*',
      'wss://api.deepgram.com/*',
      'https://dashscope-intl.aliyuncs.com/*',
      'https://ap-southeast-1.maas.qwencloudapi.com/*',
      'https://api.notion.com/*',
    ],
    // Custom LLM endpoints: the options page asks for the specific origin when saving.
    optional_host_permissions: ['https://*/*'],
    action: { default_title: 'Open NoteFlow' },
    commands: {
      'toggle-recording': {
        suggested_key: { default: 'Alt+Shift+N' },
        description: 'Start / stop recording',
      },
    },
  },
});
