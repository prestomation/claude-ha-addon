import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/text-button.js";
import type { Connection } from "../connection.js";
import type { WorkingDir } from "@addon/shared";

@customElement("session-list-view")
export class SessionListView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      box-sizing: border-box;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: max(env(safe-area-inset-top), 12px) 16px 12px;
      border-bottom: 1px solid var(--divider-color);
    }
    h1 {
      font-size: 1.2rem;
      margin: 0;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dir {
      width: 100%;
      text-align: left;
      min-height: 56px;
      padding: 12px 16px;
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-card-border-radius);
      background: var(--card-background-color);
      color: var(--primary-text-color);
      cursor: pointer;
      box-sizing: border-box;
    }
    .dir[aria-pressed="true"] {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 1px var(--primary-color);
    }
    .dir .label {
      font-weight: 500;
    }
    .dir .path {
      display: block;
      font-size: 0.85rem;
      color: var(--secondary-text-color);
      word-break: break-all;
    }
    .empty {
      color: var(--secondary-text-color);
      text-align: center;
      margin-top: 32px;
    }
    footer {
      padding: 12px 16px max(env(safe-area-inset-bottom), 12px);
      border-top: 1px solid var(--divider-color);
    }
    md-filled-button {
      width: 100%;
      min-height: 44px;
    }
  `;

  @property({ attribute: false }) connection!: Connection;

  @state() private dirs: WorkingDir[] = [];
  @state() private selected: string | null = null;
  @state() private error = "";

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    try {
      const res = await this.connection.getDirs();
      this.dirs = res.dirs;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private select(path: string) {
    this.selected = path;
  }

  private startSession() {
    if (!this.selected) return;
    this.dispatchEvent(
      new CustomEvent("session-start", {
        detail: { cwd: this.selected },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async logout() {
    try {
      await this.connection.logout();
    } catch {
      /* still emit logout so the UI returns to auth */
    }
    this.dispatchEvent(
      new CustomEvent("logout", { bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      <div data-testid="session-list-view" style="display:contents">
        <header>
          <h1>Working directories</h1>
          <md-text-button
            data-testid="logout-button"
            @click=${this.logout}
          >
            Log out
          </md-text-button>
        </header>
        <div class="list">
          ${this.dirs.length === 0
            ? html`<p class="empty">
                ${this.error || "No working directories configured."}
              </p>`
            : this.dirs.map(
                (d) => html`
                  <button
                    class="dir"
                    data-testid="dir-option"
                    data-path=${d.path}
                    aria-pressed=${this.selected === d.path}
                    @click=${() => this.select(d.path)}
                  >
                    <span class="label">${d.label}</span>
                    <span class="path">${d.path}</span>
                  </button>
                `,
              )}
        </div>
        <footer>
          <md-filled-button
            data-testid="start-session"
            ?disabled=${!this.selected}
            @click=${this.startSession}
          >
            Start session
          </md-filled-button>
        </footer>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-list-view": SessionListView;
  }
}
