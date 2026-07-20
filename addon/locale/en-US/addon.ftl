prefs-title = Zopilot
sidebar-title = Zopilot
sidebar-toggle-tooltip = Toggle Zopilot sidebar
sidebar-close = Close sidebar
sidebar-reload = Reload Zopilot
sidebar-reload-confirm = Reloading will interrupt the current response, but the content already received will be kept. Continue?
sidebar-reload-failed = Zopilot could not be reloaded. The current plugin instance is still available.
sidebar-history = Conversation history
sidebar-archived-sessions = Archived sessions
sidebar-new-chat = New chat
sidebar-no-sessions = No sessions yet
sidebar-no-archived-sessions = No archived sessions
sidebar-session-time-now = Just now
sidebar-session-time-minutes =
    { $count ->
        [one] 1 minute ago
       *[other] { $count } minutes ago
    }
sidebar-session-time-hours =
    { $count ->
        [one] 1 hour ago
       *[other] { $count } hours ago
    }
sidebar-session-time-days =
    { $count ->
        [one] 1 day ago
       *[other] { $count } days ago
    }
sidebar-session-time-weeks =
    { $count ->
        [one] 1 week ago
       *[other] { $count } weeks ago
    }
sidebar-delete-session = Archive session
sidebar-restore-session = Unarchive session
sidebar-add-context = Add attachment
sidebar-prompts = Prompts
sidebar-prompt-empty = No custom prompts
sidebar-attachment-upload = Add attachment
sidebar-attachment-picker-title = Choose PDF or image
sidebar-attachment-context = Attached files
sidebar-attachment-remove = Remove attachment
sidebar-input-placeholder = Ask about the current workspace
sidebar-send = Send
sidebar-stop = Stop
sidebar-model-name = Local Codex
sidebar-reasoning-depth = Reasoning effort
sidebar-no-item-selected = No item selected
sidebar-untitled-item = Untitled item
sidebar-multiple-items-selected =
    { $count ->
        [one] 1 item selected
       *[other] { $count } items selected
    }
sidebar-welcome-message = How should we approach this paper?
sidebar-welcome-use = Use
sidebar-welcome-prompt-hint = to insert a custom prompt
sidebar-welcome-attachment-hint = to add PDF/image attachments
sidebar-welcome-input = Type
sidebar-welcome-mention-hint = to select papers in subcategories
sidebar-loading-conversation = Loading the current workspace conversation...
sidebar-unavailable-message = Select a library or regular category, or open a PDF reader tab.
sidebar-backend-starting = Working...
sidebar-trace-running = Thinking...
sidebar-trace-collapsed = Completed
sidebar-trace-waiting = Waiting for model response...
sidebar-trace-reasoning-summary = Reasoning summary
sidebar-trace-notice = Notice
sidebar-trace-tool-running = Running
sidebar-trace-tool-completed = Completed
sidebar-trace-tool-failed = Failed
sidebar-trace-tool-arguments = Arguments
sidebar-trace-tool-result = Result
sidebar-trace-tool-error = Error
sidebar-backend-status-disconnected = Provider not connected
sidebar-pdf-helper-not-installed = PDF helper is not installed. Open Zopilot Settings > Dependencies and install the latest helper ({ $latest }) before sending.
sidebar-pdf-helper-update-required = PDF helper needs an update. Installed: { $installed }, latest: { $latest }. Open Zopilot Settings > Dependencies and click Update.
sidebar-pdf-helper-unsupported = PDF helper is not available on this platform. { $reason }
sidebar-pdf-helper-check-failed = Zopilot could not check the PDF helper. Open Zopilot Settings > Dependencies and run Check.
sidebar-backend-empty-response = Provider completed the turn without a final text response.
sidebar-backend-error = Provider request failed.
sidebar-codex-starting = Starting local Codex...
sidebar-codex-status-checking = Connecting...
sidebar-codex-status-disconnected = Codex CLI not connected
codex-diagnostic-cli-not-found = Codex CLI not found
codex-diagnostic-app-server-unavailable = Codex app-server unavailable
codex-diagnostic-not-logged-in = Codex CLI not logged in
codex-diagnostic-command-timeout = Codex command timed out
codex-diagnostic-permission-denied = Codex CLI permission denied
codex-diagnostic-unknown-error = Codex connection diagnosis failed
sidebar-codex-empty-response = Codex completed the turn without a final text response.
sidebar-codex-error = Codex connection failed.
sidebar-copy-text = Copy text
sidebar-edit-composer = Edit again
sidebar-resend = Resend
sidebar-status-error = Error
sidebar-status-interrupted = Interrupted
sidebar-chat-workspace = Workspace
sidebar-workspace-current = Current workspace
sidebar-workspace-tooltip = Current workspace: { $label } · { $type }
sidebar-workspace-choose = Choose workspace
sidebar-workspace-unavailable = Workspace unavailable
sidebar-workspace-level = Workspace
sidebar-workspace-item = Item
sidebar-workspace-collection = Category
sidebar-workspace-subcollection = Subcategory
sidebar-workspace-library = Library
sidebar-workspace-my-library = My Library
sidebar-workspace-toggle-collections = Expand or collapse categories
sidebar-workspace-expand-all = Expand all levels
sidebar-workspace-collapse-all = Collapse all levels
sidebar-mention-limit = Up to 10 sources per message
sidebar-context-remove = Remove context
sidebar-item-context-empty = No matching attachments or notes
sidebar-item-context-default-source = Default source
sidebar-item-context-open = Open item context
sidebar-item-context-file-unavailable = File unavailable
sidebar-item-context-unsupported = Unsupported
sidebar-item-context-note-unavailable = Note unavailable — remove to continue
sidebar-untitled-note = Untitled note
sidebar-paper-key = Paper key
sidebar-parent-key = Parent item
sidebar-attachment-key = Attachment
sidebar-unavailable-context = Unavailable
