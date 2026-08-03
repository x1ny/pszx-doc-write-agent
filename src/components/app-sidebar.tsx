"use client"

import { usePathname, useRouter } from "next/navigation"
import {
  AlertCircle,
  FilePenLine,
  MessageSquareText,
  Plus,
  RefreshCw,
} from "lucide-react"

import { useChatHistory } from "@/components/chat-history-provider"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

function formatThreadTime(value: string) {
  if (!value) {
    return "尚未发送消息"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { isMobile, setOpenMobile } = useSidebar()
  const {
    activeThreadId,
    createConversation,
    historyError,
    isConversationBusy,
    isConversationLoading,
    refreshThreads,
    resourceId,
    threads,
  } = useChatHistory()

  function closeMobileSidebar() {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  function handleCreateConversation() {
    if (pathname === "/") {
      createConversation()
    } else {
      router.push("/")
    }

    closeMobileSidebar()
  }

  function handleSelectConversation(threadId: string) {
    router.push(`/chat/${encodeURIComponent(threadId)}`)
    closeMobileSidebar()
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <FilePenLine aria-hidden="true" />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold">
              公文写作助手
            </span>
            <span className="block truncate text-xs text-sidebar-foreground/60">
              智能起草与编辑
            </span>
          </span>
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              variant="outline"
              tooltip="新建会话"
              disabled={isConversationBusy || isConversationLoading}
              onClick={handleCreateConversation}
            >
              <Plus aria-hidden="true" />
              <span>新建会话</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>历史会话</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!resourceId &&
                Array.from({ length: 5 }, (_, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}

              {historyError && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    tooltip="重新加载历史会话"
                    onClick={() => void refreshThreads()}
                  >
                    <AlertCircle aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-destructive">
                        {historyError}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-sidebar-foreground/60">
                        <RefreshCw aria-hidden="true" />
                        点击重试
                      </span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {resourceId &&
                threads.map((thread) => {
                  const title = thread.title || "未命名会话"

                  return (
                    <SidebarMenuItem key={thread.id}>
                      <SidebarMenuButton
                        size="lg"
                        isActive={thread.id === activeThreadId}
                        tooltip={title}
                        disabled={
                          isConversationBusy || isConversationLoading
                        }
                        onClick={() => handleSelectConversation(thread.id)}
                      >
                        <MessageSquareText aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{title}</span>
                          <span className="truncate text-xs font-normal text-sidebar-foreground/60">
                            {formatThreadTime(thread.updatedAt)}
                          </span>
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  )
}
