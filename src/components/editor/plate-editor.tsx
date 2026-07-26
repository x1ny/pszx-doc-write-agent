'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Code2,
  FileDown,
  FilePlus2,
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
import { MarkdownPlugin } from '@platejs/markdown';
import { normalizeStaticValue, type Value } from 'platejs';
import type { Descendant } from 'platejs';
import { Plate, useEditorRef, usePlateEditor } from 'platejs/react';

import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit';
import { Editor, EditorContainer } from '@/components/ui/editor';
import { FloatingToolbar } from '@/components/ui/floating-toolbar';
import { MarkToolbarButton } from '@/components/ui/mark-toolbar-button';
import { Toolbar, ToolbarButton, ToolbarGroup } from '@/components/ui/toolbar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  useDocumentEditor,
  type DocumentBlock,
  type LocalEdit,
} from '@/components/editor/document-editor-context';

export function PlateEditor({ onClose }: { onClose?: () => void }) {
  const {
    appendToPrompt,
    registerDocumentReader,
    registerLocalEditApplier,
    registerMarkdownWriter,
  } = useDocumentEditor();
  const editor = usePlateEditor({
    plugins: [...BasicNodesKit, MarkdownPlugin, DocxExportPlugin],
    value,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('未命名文档');
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(true);
  useEffect(() => {
    return registerMarkdownWriter((markdown) => {
      try {
        const nodes = editor
          .getApi(MarkdownPlugin)
          .markdown.deserialize(markdown);

        editor.tf.setValue(nodes as Value);
      } catch {
        // 流式输入可能暂时停留在未闭合的 Markdown 语法中，等待下一段内容。
      }
    });
  }, [editor, registerMarkdownWriter]);

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
    }));

    const unregisterApplier = registerLocalEditApplier((edit: LocalEdit) => {
      const nodeEntry = editor.api.node(edit.path);
      const node = nodeEntry?.[0];

      if (!node || !('children' in node)) {
        return { success: false, message: '找不到目标段落' };
      }

      const currentText = editor.api.string(edit.path);

      if (currentText !== edit.expectedText) {
        return { success: false, message: '目标内容已经发生变化，请重新检索' };
      }

      const targetStart = currentText.indexOf(edit.targetText);

      if (targetStart < 0) {
        return { success: false, message: '找不到要替换的目标文字' };
      }

      const points = Array.from(
        editor.api.positions({ at: edit.path, unit: 'character' })
      );
      const start = points[targetStart];
      const end = points[targetStart + edit.targetText.length];

      if (!start || !end) {
        return { success: false, message: '无法定位目标段落范围' };
      }

      editor.tf.select({ anchor: start, focus: end });
      editor.tf.delete();
      editor.tf.insertText(edit.replacement);

      return { success: true };
    });

    return () => {
      unregisterReader();
      unregisterApplier();
    };
  }, [editor, registerDocumentReader, registerLocalEditApplier]);

  async function handleImport(file: File) {
    setIsImporting(true);
    try {
      const result = await importDocx(editor, await file.arrayBuffer());
      editor.tf.setValue(result.nodes as Value);
      setFilename(file.name.replace(/\.docx$/i, '') || '导入的文档');
    } finally {
      setIsImporting(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      await editor.tf.docxExport.exportAndDownload(filename || '未命名文档');
    } finally {
      setIsExporting(false);
    }
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
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
            {isImporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}
            导入
          </Button>
          <Button size="sm" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <FileDown data-icon="inline-start" />}
            导出 DOCX
          </Button>
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
        <EditorToolbar onNew={handleNew} />
        {showSelectionToolbar && (
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
            <Editor className="py-8" variant="fullWidth" placeholder="开始输入文档内容…" />
          </div>
        </EditorContainer>
      </Plate>
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

function EditorToolbar({ onNew }: { onNew: () => void }) {
  const editor = useEditorRef();

  return (
    <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b bg-background px-4">
      <Toolbar className="min-w-max gap-1">
        <ToolbarGroup>
          <ToolbarButton tooltip="撤销" onClick={() => editor.tf.undo()}>
            <Undo2 data-icon="inline-start" />
          </ToolbarButton>
          <ToolbarButton tooltip="重做" onClick={() => editor.tf.redo()}>
            <Redo2 data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarGroup>
          <ToolbarButton tooltip="新建文档" onClick={onNew}>
            <FilePlus2 data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup>
          <ToolbarButton tooltip="标题 1" onClick={() => editor.tf.toggleBlock('h1')}>H1</ToolbarButton>
          <ToolbarButton tooltip="标题 2" onClick={() => editor.tf.toggleBlock('h2')}>H2</ToolbarButton>
          <ToolbarButton tooltip="标题 3" onClick={() => editor.tf.toggleBlock('h3')}>H3</ToolbarButton>
          <ToolbarButton tooltip="引用" onClick={() => editor.tf.toggleBlock('blockquote')}>❝</ToolbarButton>
          <ToolbarButton tooltip="水平线" onClick={() => editor.tf.insertNodes({ type: 'hr', children: [{ text: '' }] })}>
            <Minus data-icon="inline-start" />
          </ToolbarButton>
        </ToolbarGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarGroup>
          <MarkToolbarButton nodeType="bold" tooltip="加粗">B</MarkToolbarButton>
          <MarkToolbarButton nodeType="italic" tooltip="斜体">I</MarkToolbarButton>
          <MarkToolbarButton nodeType="underline" tooltip="下划线">U</MarkToolbarButton>
          <MarkToolbarButton nodeType="strikethrough" tooltip="删除线">S</MarkToolbarButton>
          <MarkToolbarButton nodeType="code" tooltip="行内代码">
            <Code2 data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="highlight" tooltip="荧光标记">
            <Highlighter data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="sup" tooltip="上标">
            <Superscript data-icon="inline-start" />
          </MarkToolbarButton>
          <MarkToolbarButton nodeType="sub" tooltip="下标">
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
