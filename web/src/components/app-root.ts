import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Connection } from "../connection.js";
import type { ServerMessage, SessionInfo } from "@addon/shared";
import "./auth-view.js";
import "./session-list-view.js";
import "./session-view.js";

type View = "loading" | "auth" | "list" | "session";

@customElement("app-root")
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100dvh;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--secondary-text-color);
    }
  `;

  private connection = new Connection();

  @state() private view: View = "loading";
  @state() private session: SessionInfo | null = null;

  private unsubscribe?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = this.connection.onMessage((m) => this.handle(m));
    void this.init();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.connection.close();
  }

  private async init() {
    try {
      const status = await this.connection.getStatus();
      this.view = status.authenticated ? "list" : "auth";
    } catch {
      // Assume not authenticated if status can't be read.
      this.view = "auth";
    }
    this.connection.connect();
  }

  private handle(msg: ServerMessage) {
    if (msg.type === "session_created") {
      this.session = msg.session;
      this.view = "session";
    } else if (msg.type === "session_loaded") {
      this.session = msg.session;
      this.view = "session";
    }
  }

  private onAuthSuccess() {
    this.view = "list";
  }

  private onSessionStart(e: CustomEvent<{ cwd: string }>) {
    this.connection.send({ type: "new_session", cwd: e.detail.cwd });
  }

  private onLogout() {
    this.session = null;
    this.view = "auth";
  }

  private onGoBack() {
    this.session = null;
    this.view = "list";
  }

  render() {
    return html`
      <div data-testid="app-root" style="display:contents">
        ${this.renderView()}
      </div>
    `;
  }

  private renderView() {
    switch (this.view) {
      case "auth":
        return html`<auth-view
          .connection=${this.connection}
          @auth-success=${this.onAuthSuccess}
        ></auth-view>`;
      case "list":
        return html`<session-list-view
          .connection=${this.connection}
          @session-start=${this.onSessionStart}
          @logout=${this.onLogout}
        ></session-list-view>`;
      case "session":
        return this.session
          ? html`<session-view
              .connection=${this.connection}
              .session=${this.session}
              @go-back=${this.onGoBack}
            ></session-view>`
          : html`<div class="loading">Starting session…</div>`;
      default:
        return html`<div class="loading">Loading…</div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
