import { DocumentWorkspace } from "@/components/document-workspace"
import { DocumentEditorProvider } from "@/components/editor/document-editor-context"

export default function Page() {
  return (
    <DocumentEditorProvider>
      <DocumentWorkspace />
    </DocumentEditorProvider>
  )
}

