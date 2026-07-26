import { DocumentEditorProvider } from '@/components/editor/document-editor-context';
import { PlateEditor } from '@/components/editor/plate-editor';

export default function Page() {
  return (
    <DocumentEditorProvider>
      <div className="h-screen w-full">
        <PlateEditor />
      </div>
    </DocumentEditorProvider>
  );
}

