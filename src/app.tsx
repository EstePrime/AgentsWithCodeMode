import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { MCPServersState } from "agents";
import type { ChatAgent } from "./server";
import {
  Badge,
  Button,
  Empty,
  Input,
  InputArea,
  Loader,
  Sidebar,
  Surface,
  Switch,
  Text,
  Tooltip,
  TooltipProvider
} from "@cloudflare/kumo";
import { useSidebar } from "@cloudflare/kumo/components/sidebar";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  CheckCircleIcon,
  XCircleIcon,
  BrainIcon,
  CaretDownIcon,
  BugIcon,
  PlugsConnectedIcon,
  PlusIcon,
  SignInIcon,
  XIcon,
  WrenchIcon,
  PaperclipIcon,
  ImageIcon
} from "@phosphor-icons/react";

// ── Attachment helpers ────────────────────────────────────────────────

interface Attachment {
  id: string;
  file: File;
  preview: string;
  mediaType: string;
}

function createAttachment(file: File): Attachment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    preview: URL.createObjectURL(file),
    mediaType: file.type || "application/octet-stream"
  };
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Tooltip content={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Button
        variant="secondary"
        shape="square"
        icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        onClick={toggle}
        aria-label="Toggle theme"
      />
    </Tooltip>
  );
}

// ── Tool rendering ────────────────────────────────────────────────────

function ToolPartView({
  part,
  addToolApprovalResponse
}: {
  part: UIMessage["parts"][number];
  addToolApprovalResponse: (response: {
    id: string;
    approved: boolean;
  }) => void;
}) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  // Completed
  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <div className="font-mono">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.output, null, 2)}
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  // Needs approval
  if ("approval" in part && part.state === "approval-requested") {
    const approvalId = (part.approval as { id?: string })?.id;
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-3 rounded-xl ring-2 ring-kumo-warning">
          <div className="flex items-center gap-2 mb-2">
            <GearIcon size={14} className="text-kumo-warning" />
            <Text size="sm" bold>
              Approval needed: {toolName}
            </Text>
          </div>
          <div className="font-mono mb-3">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.input, null, 2)}
            </Text>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<CheckCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) {
                  addToolApprovalResponse({ id: approvalId, approved: true });
                }
              }}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<XCircleIcon size={14} />}
              onClick={() => {
                if (approvalId) {
                  addToolApprovalResponse({ id: approvalId, approved: false });
                }
              }}
            >
              Reject
            </Button>
          </div>
        </Surface>
      </div>
    );
  }

  // Rejected / denied
  if (
    part.state === "output-denied" ||
    ("approval" in part &&
      (part.approval as { approved?: boolean })?.approved === false)
  ) {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <XCircleIcon size={14} className="text-kumo-danger" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Rejected</Badge>
          </div>
        </Surface>
      </div>
    );
  }

  // Executing
  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  return null;
}

// ── Main chat ─────────────────────────────────────────────────────────

function Chat() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toasts = useKumoToastManager();
  const { toggleSidebar } = useSidebar();
  const [mcpState, setMcpState] = useState<MCPServersState>({
    prompts: [],
    resources: [],
    servers: {},
    tools: []
  });
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [isAddingServer, setIsAddingServer] = useState(false);

  const agent = useAgent<ChatAgent>({
    agent: "ChatAgent",
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    ),
    onMcpUpdate: useCallback((state: MCPServersState) => {
      setMcpState(state);
    }, []),
    onMessage: useCallback(
      (message: MessageEvent) => {
        try {
          const data = JSON.parse(String(message.data));
          if (data.type === "scheduled-task") {
            toasts.add({
              title: "Scheduled task completed",
              description: data.description,
              timeout: 0
            });
          }
        } catch {
          // Not JSON or not our event
        }
      },
      [toasts]
    )
  });

  const handleAddServer = async () => {
    if (!mcpName.trim() || !mcpUrl.trim()) return;
    setIsAddingServer(true);
    try {
      await agent.stub.addServer(mcpName.trim(), mcpUrl.trim());
      setMcpName("");
      setMcpUrl("");
    } catch (e) {
      console.error("Failed to add MCP server:", e);
    } finally {
      setIsAddingServer(false);
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    try {
      await agent.stub.removeServer(serverId);
    } catch (e) {
      console.error("Failed to remove MCP server:", e);
    }
  };

  const serverEntries = Object.entries(mcpState.servers);
  const mcpToolCount = mcpState.tools.length;

  const {
    messages,
    sendMessage,
    clearHistory,
    addToolApprovalResponse,
    stop,
    status
  } = useAgentChat({
    agent,
    onToolCall: async (event) => {
      if (
        "addToolOutput" in event &&
        event.toolCall.toolName === "getUserTimezone"
      ) {
        event.addToolOutput({
          toolCallId: event.toolCall.toolCallId,
          output: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localTime: new Date().toLocaleTimeString()
          }
        });
      }
    }
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Re-focus the input after streaming ends
  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setAttachments((prev) => [...prev, ...images.map(createAttachment)]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;
    setInput("");

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mediaType: string; url: string }
    > = [];
    if (text) parts.push({ type: "text", text });

    for (const att of attachments) {
      const dataUri = await fileToDataUri(att.file);
      parts.push({ type: "file", mediaType: att.mediaType, url: dataUri });
    }

    for (const att of attachments) URL.revokeObjectURL(att.preview);
    setAttachments([]);

    sendMessage({ role: "user", parts });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, attachments, isStreaming, sendMessage]);

  return (
    <>
      {/* Main content */}
      <div
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-kumo-elevated"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-50 m-2 flex items-center justify-center rounded-xl border-2 border-dashed border-kumo-brand bg-kumo-elevated/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-kumo-brand">
              <ImageIcon size={40} />
              <Text variant="heading3">Drop images here</Text>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="shrink-0 border-b border-kumo-line bg-kumo-base px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold text-kumo-default">
                <span className="mr-2">⛅</span>Agent Starter
              </h1>
              <Badge variant="secondary">
                <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
                AI Chat
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <CircleIcon
                  size={8}
                  weight="fill"
                  className={
                    connected ? "text-kumo-success" : "text-kumo-danger"
                  }
                />
                <Text size="xs" variant="secondary">
                  {connected ? "Connected" : "Disconnected"}
                </Text>
              </div>
              <div className="flex items-center gap-1.5">
                <Tooltip content="Debug mode">
                  <div className="flex items-center gap-1">
                    <BugIcon size={14} className="text-kumo-inactive" />
                    <Switch
                      checked={showDebug}
                      onCheckedChange={setShowDebug}
                      size="sm"
                      aria-label="Toggle debug mode"
                    />
                  </div>
                </Tooltip>
              </div>
              <ThemeToggle />
              <Tooltip content="MCP Servers">
                <Button
                  variant="secondary"
                  icon={<PlugsConnectedIcon size={16} />}
                  onClick={toggleSidebar}
                >
                  MCP
                  {mcpToolCount > 0 && (
                    <Badge variant="primary" className="ml-1.5">
                      <WrenchIcon size={10} className="mr-0.5" />
                      {mcpToolCount}
                    </Badge>
                  )}
                </Button>
              </Tooltip>
              <Tooltip content="Clear conversation">
                <Button
                  variant="secondary"
                  shape="square"
                  icon={<TrashIcon size={16} />}
                  onClick={clearHistory}
                  aria-label="Clear conversation"
                />
              </Tooltip>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-5 px-5 py-6">
            {messages.length === 0 && (
              <Empty
                icon={<ChatCircleDotsIcon size={32} />}
                title="Start a conversation"
                contents={
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      "What's the weather in Paris?",
                      "What timezone am I in?",
                      "Calculate 5000 * 3",
                      "Remind me in 5 minutes to take a break"
                    ].map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        disabled={isStreaming}
                        onClick={() => {
                          sendMessage({
                            role: "user",
                            parts: [{ type: "text", text: prompt }]
                          });
                        }}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              />
            )}

            {messages.map((message: UIMessage, index: number) => {
              const isUser = message.role === "user";
              const isLastAssistant =
                message.role === "assistant" && index === messages.length - 1;

              return (
                <div key={message.id} className="space-y-2">
                  {showDebug && (
                    <pre className="max-h-64 overflow-auto rounded-lg bg-kumo-control p-3 text-[11px] text-kumo-subtle">
                      {JSON.stringify(message, null, 2)}
                    </pre>
                  )}

                  {/* Tool parts */}
                  {message.parts.filter(isToolUIPart).map((part) => (
                    <ToolPartView
                      key={part.toolCallId}
                      part={part}
                      addToolApprovalResponse={addToolApprovalResponse}
                    />
                  ))}

                  {/* Reasoning parts */}
                  {message.parts
                    .filter(
                      (part) =>
                        part.type === "reasoning" &&
                        (part as { text?: string }).text?.trim()
                    )
                    .map((part, i) => {
                      const reasoning = part as {
                        type: "reasoning";
                        text: string;
                        state?: "streaming" | "done";
                      };
                      const isDone = reasoning.state === "done" || !isStreaming;
                      return (
                        <div key={i} className="flex justify-start">
                          <details
                            className="max-w-[85%] w-full"
                            open={!isDone}
                          >
                            <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-2 text-sm">
                              <BrainIcon
                                size={14}
                                className="text-purple-400"
                              />
                              <span className="font-medium text-kumo-default">
                                Reasoning
                              </span>
                              {isDone ? (
                                <span className="text-xs text-kumo-success">
                                  Complete
                                </span>
                              ) : (
                                <span className="text-xs text-kumo-brand">
                                  Thinking...
                                </span>
                              )}
                              <CaretDownIcon
                                size={14}
                                className="ml-auto text-kumo-inactive"
                              />
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-kumo-control px-3 py-2 text-xs text-kumo-default whitespace-pre-wrap">
                              {reasoning.text}
                            </pre>
                          </details>
                        </div>
                      );
                    })}

                  {/* Image parts */}
                  {message.parts
                    .filter(
                      (part): part is Extract<typeof part, { type: "file" }> =>
                        part.type === "file" &&
                        (part as { mediaType?: string }).mediaType?.startsWith(
                          "image/"
                        ) === true
                    )
                    .map((part, i) => (
                      <div
                        key={`file-${i}`}
                        className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                      >
                        <img
                          src={part.url}
                          alt="Attachment"
                          className="max-h-64 rounded-xl border border-kumo-line object-contain"
                        />
                      </div>
                    ))}

                  {/* Text parts */}
                  {message.parts
                    .filter((part) => part.type === "text")
                    .map((part, i) => {
                      const text = (part as { type: "text"; text: string })
                        .text;
                      if (!text) return null;

                      if (isUser) {
                        return (
                          <div key={i} className="flex justify-end">
                            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-kumo-contrast px-4 py-2.5 leading-relaxed text-kumo-inverse">
                              {text}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base leading-relaxed text-kumo-default">
                            <Streamdown
                              className="sd-theme rounded-2xl rounded-bl-md p-3"
                              plugins={{ code }}
                              controls={false}
                              isAnimating={isLastAssistant && isStreaming}
                            >
                              {text}
                            </Streamdown>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}

            {/* Typing indicator when waiting for first tokens */}
            {status === "submitted" && (
              <div className="flex justify-start">
                <Surface className="flex items-center gap-2 rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader size="sm" />
                  <Text size="xs" variant="secondary">
                    Thinking…
                  </Text>
                </Surface>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-kumo-line bg-kumo-base">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="mx-auto max-w-3xl px-5 py-4"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="group relative overflow-hidden rounded-lg border border-kumo-line bg-kumo-control"
                  >
                    <img
                      src={att.preview}
                      alt={att.file.name}
                      className="h-16 w-16 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-kumo-contrast/80 p-0.5 text-kumo-inverse opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Remove ${att.file.name}`}
                    >
                      <XIcon size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm transition-shadow focus-within:border-transparent focus-within:ring-2 focus-within:ring-kumo-ring">
              <Tooltip content="Attach images">
                <Button
                  type="button"
                  variant="ghost"
                  shape="square"
                  aria-label="Attach images"
                  icon={<PaperclipIcon size={18} />}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!connected || isStreaming}
                  className="mb-0.5"
                />
              </Tooltip>
              <InputArea
                ref={textareaRef}
                value={input}
                onValueChange={setInput}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
                onPaste={handlePaste}
                placeholder={
                  attachments.length > 0
                    ? "Add a message or send images…"
                    : "Send a message…"
                }
                disabled={!connected || isStreaming}
                rows={1}
                className="max-h-40 flex-1 resize-none bg-transparent! outline-none! ring-0! shadow-none! focus:ring-0!"
              />
              {isStreaming ? (
                <Tooltip content="Stop generation">
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop generation"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                    className="mb-0.5"
                  />
                </Tooltip>
              ) : (
                <Tooltip content="Send message">
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send message"
                    disabled={
                      (!input.trim() && attachments.length === 0) || !connected
                    }
                    icon={<PaperPlaneRightIcon size={18} />}
                    className="mb-0.5"
                  />
                </Tooltip>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* MCP Sidebar (right side) */}
      <Sidebar>
        <Sidebar.Header>
          <div className="flex items-center gap-2">
            <PlugsConnectedIcon size={16} className="text-kumo-accent" />
            <Text size="sm" bold>
              MCP Servers
            </Text>
            {serverEntries.length > 0 && (
              <Badge variant="secondary">{serverEntries.length}</Badge>
            )}
          </div>
        </Sidebar.Header>

        <Sidebar.Content>
          <div className="space-y-4 p-4">
            {/* Add Server Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddServer();
              }}
              className="space-y-2"
            >
              <Input
                aria-label="Server name"
                placeholder="Server name"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                size="sm"
              />
              <div className="flex gap-2">
                <Input
                  aria-label="Server URL"
                  placeholder="https://mcp.example.com"
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  size="sm"
                  className="flex-1 font-mono"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  icon={
                    isAddingServer ? (
                      <Loader size="sm" />
                    ) : (
                      <PlusIcon size={14} />
                    )
                  }
                  disabled={
                    isAddingServer || !mcpName.trim() || !mcpUrl.trim()
                  }
                >
                  Add
                </Button>
              </div>
            </form>

            {/* Server List */}
            {serverEntries.length > 0 && (
              <Sidebar.Group>
                <Sidebar.GroupLabel>Connected</Sidebar.GroupLabel>
                <div className="mt-1 space-y-1.5">
                  {serverEntries.map(([id, server]) => (
                    <Surface
                      key={id}
                      className="flex items-start justify-between rounded-lg p-2.5 ring ring-kumo-line"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-kumo-default">
                            {server.name}
                          </span>
                          <Badge
                            variant={
                              server.state === "ready"
                                ? "primary"
                                : server.state === "failed"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {server.state}
                          </Badge>
                        </div>
                        <span className="mt-0.5 block truncate font-mono text-xs text-kumo-subtle">
                          {server.server_url}
                        </span>
                        {server.state === "failed" && server.error && (
                          <span className="mt-0.5 block text-xs text-kumo-danger">
                            {server.error}
                          </span>
                        )}
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1">
                        {server.state === "authenticating" &&
                          server.auth_url && (
                            <Button
                              variant="primary"
                              size="sm"
                              icon={<SignInIcon size={12} />}
                              onClick={() =>
                                window.open(
                                  server.auth_url as string,
                                  "oauth",
                                  "width=600,height=800"
                                )
                              }
                            >
                              Auth
                            </Button>
                          )}
                        <Tooltip content="Remove server">
                          <Button
                            variant="ghost"
                            size="sm"
                            shape="square"
                            aria-label="Remove server"
                            icon={<TrashIcon size={12} />}
                            onClick={() => handleRemoveServer(id)}
                          />
                        </Tooltip>
                      </div>
                    </Surface>
                  ))}
                </div>
              </Sidebar.Group>
            )}

            {/* Empty server state */}
            {serverEntries.length === 0 && (
              <Empty
                icon={<PlugsConnectedIcon size={24} />}
                title="No servers"
                contents={
                  <Text size="xs" variant="secondary">
                    Add an MCP server above to get started.
                  </Text>
                }
              />
            )}
          </div>
        </Sidebar.Content>

        {/* Tool Summary Footer */}
        {mcpToolCount > 0 && (
          <Sidebar.Footer>
            <div className="flex items-center gap-2 px-4 py-2">
              <WrenchIcon size={14} className="text-kumo-subtle" />
              <Text size="xs" variant="secondary">
                {mcpToolCount} tool{mcpToolCount !== 1 ? "s" : ""} available
              </Text>
            </div>
          </Sidebar.Footer>
        )}
      </Sidebar>
    </>
  );
}

export default function App() {
  return (
    <Toasty>
      <TooltipProvider>
        <Sidebar.Provider side="right" defaultOpen={false} collapsible="offcanvas" className="h-screen overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-screen flex-1 items-center justify-center gap-2 text-kumo-inactive">
                <Loader size="sm" />
                <span>Loading…</span>
              </div>
            }
          >
            <Chat />
          </Suspense>
        </Sidebar.Provider>
      </TooltipProvider>
    </Toasty>
  );
}
