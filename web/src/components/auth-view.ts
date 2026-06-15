import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "@material/web/textfield/filled-text-field.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/text-button.js";
import type { Connection } from "../connection.js";

type Tab = "oauth" | "apikey";

@customElement("auth-view")
export class AuthView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      box-sizing: border-box;
      padding: max(env(safe-area-inset-top), 24px) 16px
        max(env(safe-area-inset-bottom), 24px);
      align-items: center;
      justify-content: center;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: var(--card-background-color);
      border-radius: var(--ha-card-border-radius);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
      padding: 24px 20px;
      box-sizing: border-box;
    }
    h1 {
      font-size: 1.4rem;
      margin: 0 0 20px;
      color: var(--primary-text-color);
      text-align: center;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
    }
    .tab {
      flex: 1;
      min-height: 44px;
      border: none;
      border-radius: 8px;
      background: var(--secondary-background-color);
      color: var(--secondary-text-color);
      font-size: 0.95rem;
      cursor: pointer;
    }
    .tab[aria-selected="true"] {
      background: var(--primary-color);
      color: #fff;
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    md-filled-text-field {
      width: 100%;
    }
    md-filled-button,
    md-text-button {
      min-height: 44px;
    }
    .hint {
      color: var(--secondary-text-color);
      font-size: 0.9rem;
      margin: 0;
    }
    a[data-testid="oauth-url"] {
      color: var(--primary-color);
      word-break: break-all;
    }
    .error {
      color: var(--error-color);
      font-size: 0.9rem;
      min-height: 1.2em;
    }
  `;

  @property({ attribute: false }) connection!: Connection;

  @state() private tab: Tab = "oauth";
  @state() private error = "";
  @state() private busy = false;
  @state() private oauthUrl = "";
  @state() private flowId = "";

  private selectTab(tab: Tab) {
    this.tab = tab;
    this.error = "";
  }

  private async startOAuth() {
    this.error = "";
    this.busy = true;
    try {
      const res = await this.connection.oauthStart();
      this.oauthUrl = res.url;
      this.flowId = res.flowId;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private async completeOAuth() {
    const input = this.renderRoot.querySelector<HTMLInputElement>(
      '[data-testid="oauth-code-input"]',
    );
    const code = input?.value?.trim() ?? "";
    if (!code) {
      this.error = "Enter the authorization code.";
      return;
    }
    this.error = "";
    this.busy = true;
    try {
      const res = await this.connection.oauthComplete(this.flowId, code);
      if (!res.ok) throw new Error(res.error ?? "Sign in failed.");
      this.emitSuccess();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private async submitApiKey() {
    const input = this.renderRoot.querySelector<HTMLInputElement>(
      '[data-testid="apikey-input"]',
    );
    const key = input?.value?.trim() ?? "";
    if (!key) {
      this.error = "Enter an API key.";
      return;
    }
    this.error = "";
    this.busy = true;
    try {
      const res = await this.connection.loginApiKey(key);
      if (!res.ok) throw new Error(res.error ?? "Sign in failed.");
      this.emitSuccess();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private emitSuccess() {
    this.dispatchEvent(
      new CustomEvent("auth-success", { bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      <div class="card" data-testid="auth-view">
        <h1>Sign in to Claude Code</h1>
        <div class="tabs" role="tablist">
          <button
            class="tab"
            role="tab"
            data-testid="auth-tab-oauth"
            aria-selected=${this.tab === "oauth"}
            @click=${() => this.selectTab("oauth")}
          >
            OAuth
          </button>
          <button
            class="tab"
            role="tab"
            data-testid="auth-tab-apikey"
            aria-selected=${this.tab === "apikey"}
            @click=${() => this.selectTab("apikey")}
          >
            API key
          </button>
        </div>

        ${this.tab === "oauth" ? this.renderOAuth() : this.renderApiKey()}

        <div class="error" data-testid="auth-error">${this.error}</div>
      </div>
    `;
  }

  private renderOAuth() {
    return html`
      <div class="panel">
        <md-filled-button
          data-testid="oauth-start"
          ?disabled=${this.busy}
          @click=${this.startOAuth}
        >
          Start sign in
        </md-filled-button>
        ${this.oauthUrl
          ? html`
              <p class="hint">
                Open this link, authorize, then paste the code below.
              </p>
              <a
                data-testid="oauth-url"
                href=${this.oauthUrl}
                target="_blank"
                rel="noopener noreferrer"
                >${this.oauthUrl}</a
              >
              <md-filled-text-field
                data-testid="oauth-code-input"
                label="Authorization code"
              ></md-filled-text-field>
              <md-filled-button
                data-testid="oauth-complete"
                ?disabled=${this.busy}
                @click=${this.completeOAuth}
              >
                Submit code
              </md-filled-button>
            `
          : nothing}
      </div>
    `;
  }

  private renderApiKey() {
    return html`
      <div class="panel">
        <md-filled-text-field
          data-testid="apikey-input"
          type="password"
          label="API key"
        ></md-filled-text-field>
        <md-filled-button
          data-testid="apikey-submit"
          ?disabled=${this.busy}
          @click=${this.submitApiKey}
        >
          Sign in
        </md-filled-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auth-view": AuthView;
  }
}
