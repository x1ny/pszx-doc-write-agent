/**
 * 兼容旧导入路径。
 *
 * 新代码应从 src/mastra/document 下按业务能力导入；这里仅作为迁移期间的
 * 统一出口，避免已有脚本和外部调用方因目录调整立即失效。
 */
export * from '../document/article-outline';
export * from '../document/data-refresh';
export * from '../document/editor-tools';
export * from '../document/knowledge';
export * from '../document/leader-style';
export * from '../document/style-profile';
export * from '../document/tools';
