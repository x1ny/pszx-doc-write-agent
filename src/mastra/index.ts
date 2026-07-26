import { Mastra } from '@mastra/core/mastra';

import { documentAgent } from './agents/document-agent';

export const mastra = new Mastra({
  agents: { documentAgent },
});
