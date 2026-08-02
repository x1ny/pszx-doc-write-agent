import {
  applyLocalEdit,
  getDocumentSnapshot,
  streamDocumentToPlate,
  writeMarkdownToPlate,
} from './editor-tools';
import { proposeArticleOutline } from './article-outline';
import { simulateDocumentDataRefresh } from './data-refresh';
import { getCurrentTime, verifyKnowledgeBase } from './knowledge';
import { simulateLeaderStyleAnalysis } from './leader-style';
import { analyzeStyleProfileTool } from './style-profile';

// 这是 agent 与前端之间的组装边界，具体业务逻辑仍归属于各自的功能模块。
export const clientTools = {
  streamDocumentToPlate,
  writeMarkdownToPlate,
  applyLocalEdit,
  getDocumentSnapshot,
};

export {
  applyLocalEdit,
  getDocumentSnapshot,
  streamDocumentToPlate,
  writeMarkdownToPlate,
};
export { analyzeStyleProfileTool };
export { proposeArticleOutline } from './article-outline';
export { simulateDocumentDataRefresh } from './data-refresh';
export { getCurrentTime, verifyKnowledgeBase } from './knowledge';
export { simulateLeaderStyleAnalysis } from './leader-style';

export const serverTools = {
  proposeArticleOutline,
  simulateLeaderStyleAnalysis,
  simulateDocumentDataRefresh,
  analyzeStyleProfile: analyzeStyleProfileTool,
  verifyKnowledgeBase,
  getCurrentTime,
};
