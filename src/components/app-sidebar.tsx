"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  AlertCircle,
  FilePenLine,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { useChatHistory } from "@/components/chat-history-provider"
import type { ChatThreadSummary } from "@/lib/chat-session"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
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
    deleteThread,
    historyError,
    isConversationBusy,
    isConversationLoading,
    refreshThreads,
    renameThread,
    resourceId,
    threads,
  } = useChatHistory()

  const [renameTarget, setRenameTarget] = useState<ChatThreadSummary | null>(
    null
  )
  const [renameValue, setRenameValue] = useState("")
  const [renameError, setRenameError] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ChatThreadSummary | null>(
    null
  )
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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

  function openRenameDialog(thread: ChatThreadSummary) {
    setRenameTarget(thread)
    setRenameValue(thread.title || "")
    setRenameError(null)
  }

  function closeRenameDialog(open: boolean) {
    if (!open && !isRenaming) {
      setRenameTarget(null)
      setRenameError(null)
    }
  }

  async function handleConfirmRename() {
    if (!renameTarget) {
      return
    }

    const title = renameValue.trim()

    if (!title) {
      setRenameError("标题不能为空")
      return
    }

    setIsRenaming(true)
    setRenameError(null)

    try {
      await renameThread(renameTarget.id, title)
      setRenameTarget(null)
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "重命名会话失败")
    } finally {
      setIsRenaming(false)
    }
  }

  function openDeleteDialog(thread: ChatThreadSummary) {
    setDeleteTarget(thread)
    setDeleteError(null)
  }

  function closeDeleteDialog(open: boolean) {
    if (!open && !isDeleting) {
      setDeleteTarget(null)
      setDeleteError(null)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) {
      return
    }

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await deleteThread(deleteTarget.id)

      if (deleteTarget.id === activeThreadId) {
        router.push("/")
      }

      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除会话失败")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
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
          <SidebarGroup className="transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
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
                          disabled={isConversationBusy || isConversationLoading}
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

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<SidebarMenuAction showOnHover />}
                            aria-label={`${title} 的更多操作`}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="right">
                            <DropdownMenuItem
                              onClick={() => openRenameDialog(thread)}
                            >
                              <Pencil aria-hidden="true" />
                              重命名
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => openDeleteDialog(thread)}
                            >
                              <Trash2 aria-hidden="true" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    )
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarRail />
      </Sidebar>

      <Dialog open={renameTarget !== null} onOpenChange={closeRenameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>为这个会话设置一个新的标题。</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input
              autoFocus
              value={renameValue}
              disabled={isRenaming}
              maxLength={100}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void handleConfirmRename()
                }
              }}
            />
            {renameError && (
              <p className="mt-2 text-sm text-destructive">{renameError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isRenaming}
                onClick={() => closeRenameDialog(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={isRenaming}
                onClick={() => void handleConfirmRename()}
              >
                {isRenaming ? "保存中…" : "保存"}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={closeDeleteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title || "未命名会话"}
              」吗？此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting}
                onClick={() => closeDeleteDialog(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
              >
                {isDeleting ? "删除中…" : "删除"}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
