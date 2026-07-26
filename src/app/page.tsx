import { AgentChat } from "@/components/agent-chat"
import { PlateEditor } from "@/components/editor/plate-editor"
import { DocumentEditorProvider } from "@/components/editor/document-editor-context"

export default function Page() {
  return (
    <DocumentEditorProvider>
      <main className="flex min-h-svh flex-col bg-muted/20 lg:flex-row">
        <div className="min-h-[44rem] min-w-0 flex-1 lg:h-svh">
          <PlateEditor />
        </div>
        <aside className="flex w-full shrink-0 items-center border-t bg-background p-4 lg:h-svh lg:w-[600px] lg:border-t-0 lg:border-l lg:p-5">
          <AgentChat />
        </aside>
      </main>
    </DocumentEditorProvider>
  )
}


