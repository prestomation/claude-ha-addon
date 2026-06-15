import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@material/web/button/text-button.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/iconbutton/icon-button.js";
import type { Connection } from "../connection.js";
import type {
  PermissionOption,
  SessionInfo,
  SessionMode,
  ServerMessage,
  TranscriptItem,
} from "@addon/shared";
import { appendItem, updateItem } from "../transcript.js";

interface PendingPermission {
  requestId: string;
  title: string;
  options: PermissionOption[];
}

@customElement("session-view")
export class SessionView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      box-sizing: border-box;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: max(env(safe-area-inset-top), 8px) 12px 8px;
      border-bottom: 1px solid var(--divider-color);
      background: var(--card-background-color);
    }
    header .controls {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    select {
      min-height: 36px;
      max-width: 40vw;
      border-radius: 8px;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      padding: 0 8px;
    }
    .modes {
      display: flex;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .modes button {
      min-height: 36px;
      min-width: 44px;
      border: none;
      background: var(--card-background-color);
      color: var(--secondary-text-color);
      cursor: pointer;
      font-size: 0.85rem;
      padding: 0 10px;
    }
    .modes button[aria-pressed="true"] {
      background: var(--primary-color);
      color: #fff;
    }
    .transcript {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .item {
      line-height: 1.5;
      word-break: break-word;
    }
    /* Only free-text messages preserve authored newlines; structured cards
       (tool_call, plan) must not, or template indentation renders as gaps. */
    .item[data-role="user"],
    .item[data-role="assistant"][data-kind="text"],
    .item[data-kind="thought"] {
      white-space: pre-wrap;
    }
    .item[data-role="user"] {
      align-self: flex-end;
      max-width: 85%;
      margin: 4px 0;
      padding: 7px 12px;
      border-radius: 14px;
      border-bottom-right-radius: 4px;
      background: var(--primary-color);
      color: #fff;
    }
    .item[data-role="assistant"][data-kind="text"] {
      align-self: stretch;
      background: transparent;
      color: var(--primary-text-color);
      padding: 2px 0;
    }
    .item[data-kind="thought"] {
      align-self: stretch;
      font-style: italic;
      color: var(--secondary-text-color);
      background: transparent;
      padding: 2px 0;
    }
    .item[data-kind="tool_call"] {
      align-self: stretch;
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 5px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
    }
    .tool-status {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--secondary-text-color);
    }
    .item[data-kind="plan"] {
      align-self: stretch;
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 6px 10px;
    }
    .plan-entry {
      display: flex;
      gap: 8px;
      padding: 1px 0;
    }
    .plan-entry[data-status="completed"] {
      color: var(--secondary-text-color);
      text-decoration: line-through;
    }
    .composer {
      position: sticky;
      bottom: 0;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      padding: 8px 12px max(env(safe-area-inset-bottom), 8px);
      border-top: 1px solid var(--divider-color);
      background: var(--card-background-color);
    }
    textarea {
      flex: 1;
      resize: none;
      min-height: 44px;
      max-height: 140px;
      border-radius: 12px;
      border: 1px solid var(--divider-color);
      background: var(--primary-background-color);
      color: var(--primary-text-color);
      padding: 11px 12px;
      font: inherit;
      box-sizing: border-box;
    }
    .composer md-filled-button {
      min-height: 44px;
    }
    .sheet-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: flex-end;
      z-index: 10;
    }
    .sheet {
      width: 100%;
      background: var(--card-background-color);
      border-top-left-radius: 16px;
      border-top-right-radius: 16px;
      padding: 20px 16px max(env(safe-area-inset-bottom), 20px);
      box-sizing: border-box;
    }
    .sheet h2 {
      font-size: 1.05rem;
      margin: 0 0 16px;
    }
    .sheet .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .sheet .actions md-filled-button,
    .sheet .actions md-outlined-button {
      min-height: 44px;
    }
  `;

  @property({ attribute: false }) connection!: Connection;
  @property({ attribute: false }) session!: SessionInfo;
  @property({ attribute: false }) transcript: TranscriptItem[] = [];

  @state() private running = false;
  @state() private permission: PendingPermission | null = null;

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.connection.onMessage((m) => this.handle(m));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  updated(): void {
    const t = this.renderRoot.querySelector<HTMLElement>(
      '[data-testid="transcript"]',
    );
    if (t) t.scrollTop = t.scrollHeight;
  }

  private get sessionId(): string {
    return this.session.id;
  }

  private handle(msg: ServerMessage) {
    switch (msg.type) {
      case "transcript_append":
        if (msg.sessionId !== this.sessionId) return;
        this.transcript = appendItem(this.transcript, msg.item);
        break;
      case "transcript_update":
        if (msg.sessionId !== this.sessionId) return;
        this.transcript = updateItem(
          this.transcript,
          msg.itemId,
          msg.patch,
        );
        break;
      case "mode_changed":
        if (msg.sessionId !== this.sessionId) return;
        this.session = { ...this.session, currentModeId: msg.modeId };
        break;
      case "model_changed":
        if (msg.sessionId !== this.sessionId) return;
        this.session = { ...this.session, currentModelId: msg.modelId };
        break;
      case "permission_request":
        if (msg.sessionId !== this.sessionId) return;
        this.permission = {
          requestId: msg.requestId,
          title: msg.title,
          options: msg.options,
        };
        break;
      case "turn_started":
        if (msg.sessionId !== this.sessionId) return;
        this.running = true;
        break;
      case "turn_done":
        if (msg.sessionId !== this.sessionId) return;
        this.running = false;
        break;
      case "session_loaded":
        if (msg.session.id !== this.sessionId) return;
        this.session = msg.session;
        this.transcript = msg.transcript;
        break;
      default:
        break;
    }
  }

  private goBack() {
    this.dispatchEvent(
      new CustomEvent("go-back", { bubbles: true, composed: true }),
    );
  }

  private onModelChange(e: Event) {
    const modelId = (e.target as HTMLSelectElement).value;
    this.session = { ...this.session, currentModelId: modelId };
    this.connection.send({
      type: "set_model",
      sessionId: this.sessionId,
      modelId,
    });
  }

  private setMode(modeId: SessionMode) {
    this.session = { ...this.session, currentModeId: modeId };
    this.connection.send({ type: "set_mode", sessionId: this.sessionId, modeId });
  }

  private get input(): HTMLTextAreaElement | null {
    return this.renderRoot.querySelector<HTMLTextAreaElement>(
      '[data-testid="composer-input"]',
    );
  }

  private sendPrompt() {
    const el = this.input;
    const text = el?.value?.trim() ?? "";
    if (!text) return;
    const item: TranscriptItem = {
      id: `local-user-${Date.now()}`,
      role: "user",
      kind: "text",
      text,
    };
    this.transcript = appendItem(this.transcript, item);
    this.connection.send({ type: "prompt", sessionId: this.sessionId, text });
    if (el) el.value = "";
  }

  private onComposerKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.sendPrompt();
    }
  }

  private cancel() {
    this.connection.send({ type: "cancel", sessionId: this.sessionId });
  }

  private respondPermission(optionId: string | null) {
    if (!this.permission) return;
    this.connection.send({
      type: "permission_response",
      sessionId: this.sessionId,
      requestId: this.permission.requestId,
      optionId,
    });
    this.permission = null;
  }

  private firstOptionId(prefix: "allow" | "reject"): string | undefined {
    return this.permission?.options.find((o) => o.kind.startsWith(prefix))?.optionId;
  }

  render() {
    return html`
      <div data-testid="session-view" style="display:contents">
        ${this.renderHeader()}
        <div class="transcript" data-testid="transcript">
          ${this.transcript.map((i) => this.renderItem(i))}
        </div>
        ${this.renderComposer()} ${this.renderPermission()}
      </div>
    `;
  }

  private renderHeader() {
    const mode = this.session.currentModeId;
    return html`
      <header>
        <md-icon-button data-testid="back-button" @click=${this.goBack}>
          <span aria-hidden="true">&#8592;</span>
        </md-icon-button>
        <div class="controls">
          <select
            data-testid="model-select"
            .value=${this.session.currentModelId}
            @change=${this.onModelChange}
          >
            ${this.session.models.map(
              (m) => html`
                <option
                  data-testid="model-option"
                  data-value=${m.id}
                  value=${m.id}
                  ?selected=${m.id === this.session.currentModelId}
                >
                  ${m.name}
                </option>
              `,
            )}
          </select>
          <div class="modes" role="group" aria-label="Mode">
            <button
              data-testid="mode-auto"
              aria-pressed=${mode === "default"}
              @click=${() => this.setMode("default")}
            >
              Auto
            </button>
            <button
              data-testid="mode-plan"
              aria-pressed=${mode === "plan"}
              @click=${() => this.setMode("plan")}
            >
              Plan
            </button>
          </div>
        </div>
      </header>
    `;
  }

  private renderItem(item: TranscriptItem) {
    let body;
    if (item.kind === "tool_call") {
      body = html`<span>${item.title}</span
        ><span class="tool-status">${item.status}</span>`;
    } else if (item.kind === "plan") {
      body = html`${item.entries.map(
        (e) => html`
          <div class="plan-entry" data-status=${e.status}>
            <span>${e.status === "completed" ? "✓" : "•"}</span>
            <span>${e.content}</span>
          </div>
        `,
      )}`;
    } else {
      body = item.text;
    }
    return html`
      <div
        class="item"
        data-testid="transcript-item"
        data-role=${item.role}
        data-kind=${item.kind}
      >
        ${body}
      </div>
    `;
  }

  private renderComposer() {
    return html`
      <div class="composer">
        <textarea
          data-testid="composer-input"
          placeholder="Message Claude…"
          rows="1"
          @keydown=${this.onComposerKey}
        ></textarea>
        ${this.running
          ? html`<md-filled-button
              data-testid="composer-stop"
              @click=${this.cancel}
              >Stop</md-filled-button
            >`
          : html`<md-filled-button
              data-testid="composer-send"
              @click=${this.sendPrompt}
              >Send</md-filled-button
            >`}
      </div>
    `;
  }

  private renderPermission() {
    if (!this.permission) return nothing;
    return html`
      <div class="sheet-backdrop" @click=${() => this.respondPermission(null)}>
        <div
          class="sheet"
          data-testid="permission-sheet"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <h2>${this.permission.title}</h2>
          <div class="actions">
            ${this.permission.options.map((o) => {
              const isAllow = o.kind.startsWith("allow");
              const isReject = o.kind.startsWith("reject");
              // The first allow / first reject option carry the canonical
              // test ids; remaining options keep their value for fine selection.
              const testid =
                isAllow && o.optionId === this.firstOptionId("allow")
                  ? "permission-allow"
                  : isReject && o.optionId === this.firstOptionId("reject")
                    ? "permission-deny"
                    : undefined;
              return isAllow
                ? html`<md-filled-button
                    data-testid=${testid ?? nothing}
                    data-value=${o.optionId}
                    @click=${() => this.respondPermission(o.optionId)}
                    >${o.name}</md-filled-button
                  >`
                : html`<md-outlined-button
                    data-testid=${testid ?? nothing}
                    data-value=${o.optionId}
                    @click=${() => this.respondPermission(o.optionId)}
                    >${o.name}</md-outlined-button
                  >`;
            })}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-view": SessionView;
  }
}
