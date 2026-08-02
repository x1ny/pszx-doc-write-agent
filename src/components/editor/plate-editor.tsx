'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Code2,
  FileDown,
  FilePlus2,
  FileText,
  FileUp,
  Highlighter,
  Loader2,
  MessageSquareQuote,
  Minus,
  Redo2,
  Subscript,
  Superscript,
  Undo2,
  X,
} from 'lucide-react';
import { importDocx, DocxExportPlugin } from '@platejs/docx-io';
import { AI_PREVIEW_KEY, BaseAIPlugin } from '@platejs/ai';
import {
  AIChatPlugin,
  AIPlugin,
  streamInsertChunk,
} from '@platejs/ai/react';
import { MarkdownPlugin } from '@platejs/markdown';
import {
  normalizeStaticValue,
  type Descendant,
  type TRange,
  type Value,
} from 'platejs';
import { Plate, useEditorRef, usePlateEditor } from 'platejs/react';

import { createLocalEditApplier } from '@/components/editor/local-edit';
import { OfficialDocumentExportDialog } from '@/components/editor/official-document-export-dialog';
import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button';
import { Toolbar, ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  useDocumentEditor,
  type DocumentBlock,
  type DocumentStreamController,
} from '@/components/editor/document-editor-context';
import {
  validateAndExtractOfficialDocumentBody,
  type OfficialDocumentValidationResult,
} from '@/lib/official-document';

type ActiveDocumentStream = {
  operationId: string;
  originalSelection: TRange | null;
  originalValue: Value;
  hasContent: boolean;
};

export function PlateEditor({ onClose }: { onClose?: () => void }) {
  const {
    appendToPrompt,
    isDocumentStreaming,
    registerDocumentImporter,
    registerDocumentReader,
    registerDocumentStreamController,
    registerLocalEditApplier,
  } = useDocumentEditor();
  const editor = usePlateEditor({
    plugins: [
      ...BasicNodesKit,
      MarkdownPlugin,
      AIPlugin,
      AIChatPlugin,
      DocxExportPlugin,
    ],
    value,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('未命名文档');
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isOfficialExportOpen, setIsOfficialExportOpen] = useState(false);
  const [officialDocumentValidation, setOfficialDocumentValidation] =
    useState<OfficialDocumentValidationResult | null>(null);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(true);
  const activeDocumentStreamRef = useRef<ActiveDocumentStream | null>(null);

  useEffect(() => {
    function resetStreamingState() {
      editor.getApi(AIChatPlugin).aiChat.stop();
    }

    function hasPreviewNodes() {
      return editor.api.some({
        at: [],
        match: (node) =>
          'children' in node && Boolean(node[AI_PREVIEW_KEY]),
      });
    }

    function restoreOriginalDocument(stream: ActiveDocumentStream) {
      editor
        .getTransforms(BaseAIPlugin)
        .ai.discardPreview();

      editor.tf.withoutSaving(() => {
        editor.tf.setValue(structuredClone(stream.originalValue));

        if (stream.originalSelection) {
          editor.tf.select(structuredClone(stream.originalSelection));
        } else {
          editor.tf.deselect();
        }
      });
    }

    const controller: DocumentStreamController = {
      begin(operationId) {
        if (activeDocumentStreamRef.current) {
          throw new Error('已有文档正在流式写入');
        }

        resetStreamingState();

        const stream: ActiveDocumentStream = {
          operationId,
          originalSelection: editor.selection
            ? structuredClone(editor.selection)
            : null,
          originalValue: structuredClone(editor.children as Value),
          hasContent: false,
        };
        const previewStarted = editor
          .getTransforms(BaseAIPlugin)
          .ai.beginPreview({ originalBlocks: stream.originalValue });

        if (!previewStarted) {
          throw new Error('编辑器中已有未完成的 AI 写入预览');
        }

        try {
          editor.tf.withoutSaving(() => {
            editor.tf.setValue(
              normalizeStaticValue([
                {
                  [AI_PREVIEW_KEY]: true,
                  children: [{ text: '' }],
                  type: 'p',
                },
              ])
            );
            editor.tf.select({
              anchor: { path: [0, 0], offset: 0 },
              focus: { path: [0, 0], offset: 0 },
            });
          });
          editor.setOption(AIChatPlugin, '_blockChunks', '');
          editor.setOption(AIChatPlugin, '_blockPath', null);
          editor.setOption(AIChatPlugin, '_mdxName', null);
          editor.setOption(AIChatPlugin, 'streaming', true);
          activeDocumentStreamRef.current = stream;
        } catch (error) {
          restoreOriginalDocument(stream);
          resetStreamingState();
          throw error;
        }
      },
      append(operationId, chunk) {
        const stream = activeDocumentStreamRef.current;

        if (!stream || stream.operationId !== operationId) {
          throw new Error('文档流式写入会话已经失效');
        }

        if (!chunk) {
          return;
        }

        if (chunk.trim().length > 0) {
          stream.hasContent = true;
        }

        editor.tf.withoutSaving(() => {
          editor.tf.withScrolling(() => {
            streamInsertChunk(editor, chunk);
          });
        });
      },
      commit(operationId) {
        const stream = activeDocumentStreamRef.current;

        if (!stream || stream.operationId !== operationId) {
          throw new Error('文档流式写入会话已经失效');
        }

        if (!stream.hasContent || !hasPreviewNodes()) {
          throw new Error('模型没有生成可写入的 Markdown 内容');
        }

        const accepted = editor
          .getTransforms(BaseAIPlugin)
          .ai.acceptPreview();

        if (!accepted) {
          throw new Error('无法提交文档流式写入预览');
        }

        resetStreamingState();
        activeDocumentStreamRef.current = null;
      },
      abort(operationId) {
        const stream = activeDocumentStreamRef.current;

        if (!stream || stream.operationId !== operationId) {
          return;
        }

        const previewNodesExist = hasPreviewNodes();
        const canceled = editor
          .getTransforms(BaseAIPlugin)
          .ai.cancelPreview();

        if (!canceled || !previewNodesExist) {
          restoreOriginalDocument(stream);
        }

        resetStreamingState();
        activeDocumentStreamRef.current = null;
      }
    };

    return registerDocumentStreamController(controller);
  }, [editor, registerDocumentStreamController]);

  useEffect(() => {
    function getText(node: Descendant): string {
      return 'text' in node
        ? String(node.text)
        : (node.children as Descendant[]).map((child) => getText(child)).join('');
    }

    function collectBlocks(
      nodes: Descendant[],
      parentPath: number[] = [],
      blocks: DocumentBlock[] = []
    ) {
      nodes.forEach((node, index) => {
        const path = [...parentPath, index];

        if ('children' in node && typeof node.type === 'string') {
          blocks.push({ path, type: node.type, text: getText(node) });
          collectBlocks(node.children as Descendant[], path, blocks);
        }
      });

      return blocks;
    }

    const unregisterReader = registerDocumentReader(() => ({
      blocks: collectBlocks(editor.children as Descendant[]),
      markdown: editor
        .getApi(MarkdownPlugin)
        .markdown.serialize({ value: editor.children as Descendant[] }),
    }));

    const unregisterApplier = registerLocalEditApplier(
      createLocalEditApplier(editor)
    );

    return () => {
      unregisterReader();
      unregisterApplier();
    };
  }, [editor, registerDocumentReader, registerLocalEditApplier]);

  const importDocument = useCallback(async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    let nodes: Value;

    if (extension === 'docx') {
      const result = await importDocx(editor, await file.arrayBuffer());
      nodes = result.nodes as Value;
    } else if (extension === 'md' || extension === 'markdown') {
      nodes = editor
        .getApi(MarkdownPlugin)
        .markdown.deserialize(await file.text()) as Value;
    } else if (extension === 'txt') {
      nodes = normalizeStaticValue(
        (await file.text()).replace(/\r\n?/g, '\n').split('\n').map((text) => ({
          children: [{ text }],
          type: 'p',
        }))
      );
    } else {
      throw new Error('暂不支持该文件格式，请选择 DOCX、Markdown 或 TXT 文件');
    }

    editor.tf.setValue(nodes);
    setFilename(
      file.name.replace(/\.(docx|md|markdown|txt)$/i, '') || '导入的文档'
    );
  }, [editor]);

  useEffect(() => registerDocumentImporter(importDocument), [
    importDocument,
    registerDocumentImporter,
  ]);

  async function handleImport(file: File) {
    setIsImporting(true);
    try {
      if (hasDocumentContent() && !window.confirm('导入文档将替换当前内容，确定继续吗？')) {
        return;
      }

      await importDocument(file);
    } finally {
      setIsImporting(false);
    }
  }

  function hasDocumentContent() {
    return (editor.children as Descendant[]).some((node, index) => {
      if ('type' in node && node.type !== 'p') {
        return true;
      }

      return editor.api.string([index]).trim().length > 0;
    });
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      await editor.tf.docxExport.exportAndDownload(filename || '未命名文档');
    } finally {
      setIsExporting(false);
    }
  }

  function handleOfficialDocumentExport() {
    setOfficialDocumentValidation(
      validateAndExtractOfficialDocumentBody(
        editor.children as Descendant[]
      )
    );
    setIsOfficialExportOpen(true);
  }

  function handleNew() {
    editor.tf.setValue(value);
    setFilename('未命名文档');
  }

  function handleAddSelectionToPrompt(text: string) {
    appendToPrompt(text);
    setShowSelectionToolbar(false);
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-muted/30">
      {false && (
        <div
          className="fixed z-50 -translate-x-1/2"
          style={{ top: 0, left: 0 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button size="sm" onClick={() => {}}>
            <MessageSquareQuote data-icon="inline-start" />
            鍔犲叆杈撳叆妗?          </Button>
        </div>
      )}
      <div className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FilePlus2 data-icon="inline-start" />
          </div>
          <input
            aria-label="文档名称"
            className="min-w-0 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            placeholder="未命名文档"
            disabled={isDocumentStreaming}
          />
          {isDocumentStreaming && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              正在流式写入
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.target.value = '';
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting || isDocumentStreaming}
          >
            {isImporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}
            导入
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" />}
              openOnHover
              delay={80}
              closeDelay={150}
              disabled={isExporting || isDocumentStreaming}
            >
              {isExporting ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <FileDown data-icon="inline-start" />
              )}
              导出
              <ChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => void handleExport()}>
                  <FileDown />
                  普通 DOCX 文件
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleOfficialDocumentExport}>
                  <FileText />
                  红头文件
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="关闭文档编辑器"
            >
              <X />
            </Button>
          )}
        </div>
      </div>
      <Plate editor={editor}>
        <EditorToolbar onNew={handleNew} disabled={isDocumentStreaming} />
        {showSelectionToolbar && !isDocumentStreaming && (
          <SelectionFloatingToolbar onAdd={handleAddSelectionToPrompt} />
        )}
        <EditorContainer
          className="min-h-0 flex-1 bg-muted/30 px-8 py-8"
          onScroll={() => setShowSelectionToolbar(false)}
          onMouseUp={() => setShowSelectionToolbar(true)}
        >
          {false && (
            <div
              className="hidden"
              style={{ top: 0, left: 0 }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <Button size="sm" onClick={() => {}}>
                <MessageSquareQuote data-icon="inline-start" />
                加入输入框
              </Button>
            </div>
          )}
          <div className="min-h-full w-full rounded-sm bg-background shadow-sm ring-1 ring-border/60">
            <Editor
              className="py-8"
              variant="fullWidth"
              placeholder="开始输入文档内容…"
              disabled={isDocumentStreaming}
              readOnly={isDocumentStreaming}
            />
          </div>
        </EditorContainer>
      </Plate>
      <OfficialDocumentExportDialog
        filename={filename}
        open={isOfficialExportOpen}
        validation={officialDocumentValidation}
        onOpenChange={setIsOfficialExportOpen}
      />
    </section>
  );
}

function SelectionFloatingToolbar({ onAdd }: { onAdd: (text: string) => void }) {
  const editor = useEditorRef();

  function handleAdd() {
    const text = editor.api.string().trim();

    if (text) {
      onAdd(text);
    }
  }

  return (
    <FloatingToolbar>
      <ToolbarButton
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleAdd}
      >
        <MessageSquareQuote data-icon="inline-start" />
        加入输入框
      </ToolbarButton>
    </FloatingToolbar>
  );
}

function EditorToolbar({
  disabled,
  onNew,
}: {
  disabled?: boolean;
  onNew: () => void;
}) {
  const editor = useEditorRef();

  return (
    <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b bg-background px-4">
      <Toolbar className="min-w-max gap-1">
        <ToolbarGroup>
          <ToolbarButton
            tooltip="撤销"
            onClick={() => editor.tf.undo()}
            disabled={disabled}
          >
            <Undo2 data-icon="inline-start" />
          </ToolbarButton>
          <ToolbarButton
            tooltip="重做"
            onClick={() => editor.tf.redo()}
            disabled={disabled}
          >
            <Redo2 data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarGroup>
          <ToolbarButton tooltip="新建文档" onClick={onNew} disabled={disabled}>
            <FilePlus2 data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup>
          <ToolbarButton tooltip="标题 1" onClick={() => editor.tf.toggleBlock('h1')} disabled={disabled}>H1</ToolbarButton>
          <ToolbarButton tooltip="标题 2" onClick={() => editor.tf.toggleBlock('h2')} disabled={disabled}>H2</ToolbarButton>
          <ToolbarButton tooltip="标题 3" onClick={() => editor.tf.toggleBlock('h3')} disabled={disabled}>H3</ToolbarButton>
          <ToolbarButton tooltip="引用" onClick={() => editor.tf.toggleBlock('blockquote')} disabled={disabled}>❝</ToolbarButton>
          <ToolbarButton tooltip="水平线" onClick={() => editor.tf.insertNodes({ type: 'hr', children: [{ text: '' }] })} disabled={disabled}>
            <Minus data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarGroup>
          <MarkToolbarButton nodeType="bold" tooltip="加粗" disabled={disabled}>B</MarkToolbarButton>
          <MarkToolbarButton nodeType="italic" tooltip="斜体" disabled={disabled}>I</MarkToolbarButton>
          <MarkToolbarButton nodeType="underline" tooltip="下划线" disabled={disabled}>U</MarkToolbarButton>
          <MarkToolbarButton nodeType="strikethrough" tooltip="删除线" disabled={disabled}>S</MarkToolbarButton>
          <MarkToolbarButton nodeType="code" tooltip="行内代码" disabled={disabled}>
            <Code2 data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="highlight" tooltip="荧光标记" disabled={disabled}>
            <Highlighter data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="sup" tooltip="上标" disabled={disabled}>
            <Superscript data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="sub" tooltip="下标" disabled={disabled}>
            <Subscript data-icon="inline-start" />
          </MarkToolbarButton>
        </ToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
      </Toolbar>
    </div>
  );
}

const value = normalizeStaticValue([
  {
    children: [{ text: '' }],
    type: 'p',
  },
]);
