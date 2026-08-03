"use client"

import { AppSidebar } from "@/components/app-sidebar"
import { ChatHistoryProvider } from "@/components/chat-history-provider"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatHistoryProvider>
      <SidebarProvider className="h-svh min-h-0 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            <SidebarTrigger aria-label="切换历史会话侧边栏" />
          </header>
          <Separator />
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </ChatHistoryProvider>
  )
}
