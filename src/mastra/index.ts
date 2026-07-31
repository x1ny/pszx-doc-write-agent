import { Mastra } from '@mastra/core/mastra';

import { documentAgent } from './agents/document-agent';
import { buildStyleProfileWorkflow } from './document/build-style-profile-workflow';
import { documentMemoryStorage } from './memory';

export const mastra = new Mastra({
  storage: documentMemoryStorage,
  agents: { documentAgent },
  workflows: { buildStyleProfileWorkflow },
});
