import {
  type JSXElement,
  createSignal,
  onMount,
  For,
  Show,
} from "solid-js";
import { type CustomSettingsComponentProps } from "../../../src/renderers/ivde/settings/PluginSettings";
import { SettingsPaneFormSection } from "../../../src/renderers/ivde/settings/forms";

// Unified token type - works for OAuth, site tokens, or workspace tokens
interface WebflowToken {
  id: string;
  token: string;
  label?: string;  // User-friendly name (site name, workspace name, or "OAuth Token")
  type: 'oauth' | 'site' | 'workspace';
  siteId?: string;
  workspaceId?: string;
  scopes?: string[];
  status: 'idle' | 'validating' | 'valid' | 'invalid';
  error?: string;
}

// Message types for plugin communication
type PluginMessage =
  | { type: 'validateToken'; id: string; token: string }
  | { type: 'tokenValidated'; id: string; label: string; tokenType: 'oauth' | 'site' | 'workspace'; siteId?: string; workspaceId?: string; scopes?: string[] }
  | { type: 'tokenInvalid'; id: string; error: string }
  | { type: 'startBrowserAuth' }
  | { type: 'browserAuthComplete'; token: string }
  | { type: 'browserAuthFailed'; error: string };

const WebflowTokenManager = (props: CustomSettingsComponentProps): JSXElement => {
  const [tokens, setTokens] = createSignal<WebflowToken[]>([]);
  const [newToken, setNewToken] = createSignal('');
  const [isAuthenticating, setIsAuthenticating] = createSignal(false);

  // Load tokens on mount and check for .env tokens
  onMount(async () => {
    const savedTokens = await props.getState<WebflowToken[]>('tokens') || [];
    setTokens(savedTokens);

    // Ask plugin to check for existing .env token
    await props.sendMessage({ type: 'loadEnvToken' });
  });

  // Listen for messages from plugin
  props.onMessage((msg: unknown) => {
    const message = msg as PluginMessage;

    if (message.type === 'tokenValidated') {
      setTokens(tkns => tkns.map(t =>
        t.id === message.id
          ? {
              ...t,
              status: 'valid' as const,
              label: message.label,
              type: message.tokenType,
              siteId: message.siteId,
              workspaceId: message.workspaceId,
              scopes: message.scopes,
            }
          : t
      ));
      saveTokens();
    } else if (message.type === 'tokenInvalid') {
      setTokens(tkns => tkns.map(t =>
        t.id === message.id
          ? { ...t, status: 'invalid' as const, error: message.error }
          : t
      ));
      saveTokens();
    } else if (message.type === 'browserAuthComplete') {
      setIsAuthenticating(false);
      // Add the new OAuth token
      const id = generateId();
      const oauthToken: WebflowToken = {
        id,
        token: message.token,
        type: 'oauth',
        status: 'validating',
      };
      setTokens(tkns => [...tkns, oauthToken]);
      saveTokens();
      // Validate it
      props.sendMessage({ type: 'validateToken', id, token: message.token });
    } else if (message.type === 'browserAuthFailed') {
      setIsAuthenticating(false);
    }
  });

  const saveTokens = async () => {
    await props.setState('tokens', tokens());
  };

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const addToken = async () => {
    const token = newToken().trim();
    if (!token) return;

    const id = generateId();
    const newTkn: WebflowToken = {
      id,
      token,
      type: 'site', // Default, will be updated after validation
      status: 'validating',
    };

    setTokens(tkns => [...tkns, newTkn]);
    setNewToken('');
    await saveTokens();

    // Ask plugin to validate and determine token type
    await props.sendMessage({ type: 'validateToken', id, token });
  };

  const removeToken = async (id: string) => {
    setTokens(tkns => tkns.filter(t => t.id !== id));
    await saveTokens();
  };

  const startBrowserAuth = async () => {
    console.log('[WebflowTokenManager] startBrowserAuth clicked');
    setIsAuthenticating(true);
    console.log('[WebflowTokenManager] Sending startBrowserAuth message...');
    await props.sendMessage({ type: 'startBrowserAuth' });
    console.log('[WebflowTokenManager] Message sent');
  };

  const inputStyle = {
    background: '#2b2b2b',
    'border-radius': '4px',
    border: '1px solid #212121',
    color: '#d9d9d9',
    outline: 'none',
    cursor: 'text',
    display: 'block',
    'font-family': "'Fira Code', 'SF Mono', Monaco, monospace",
    'font-size': '12px',
    padding: '8px 9px',
    'line-height': '14px',
    flex: '1',
    'min-width': '0',
  };

  const buttonStyle = {
    background: '#5e5e5e',
    border: '1px solid #363636',
    'border-radius': '4px',
    color: '#ebebeb',
    cursor: 'pointer',
    padding: '8px 12px',
    'font-size': '12px',
    'flex-shrink': '0',
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: '#4353ff',
    border: '1px solid #3343ee',
  };

  const removeButtonStyle = {
    ...buttonStyle,
    background: '#4a2626',
    padding: '4px 8px',
    'font-size': '11px',
  };

  const TokenStatus = (status: 'idle' | 'validating' | 'valid' | 'invalid') => {
    if (status === 'validating') return <span style="color: #ff9800;">⏳</span>;
    if (status === 'valid') return <span style="color: #51cf66;">✓</span>;
    if (status === 'invalid') return <span style="color: #ff6b6b;">✗</span>;
    return null;
  };

  const TokenTypeLabel = (type: 'oauth' | 'site' | 'workspace') => {
    const styles: Record<string, { bg: string; text: string; label: string }> = {
      oauth: { bg: '#1a3a1a', text: '#51cf66', label: 'OAuth' },
      site: { bg: '#1a2a3a', text: '#4dabf7', label: 'Site' },
      workspace: { bg: '#3a2a1a', text: '#f0ad4e', label: 'Workspace' },
    };
    const style = styles[type];
    return (
      <span style={`
        font-size: 9px;
        padding: 2px 4px;
        border-radius: 3px;
        background: ${style.bg};
        color: ${style.text};
        text-transform: uppercase;
        font-weight: 600;
      `}>
        {style.label}
      </span>
    );
  };

  const validTokens = () => tokens().filter(t => t.status === 'valid');
  const hasValidToken = () => validTokens().length > 0;

  return (
    <>
      <SettingsPaneFormSection label="Webflow Connection">
        <div style="padding: 12px 16px;">
          {/* Connected status */}
          <Show when={hasValidToken()}>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding: 10px 12px; background: #1a3a1a; border-radius: 6px; border: 1px solid #2a4a2a;">
              <span style="color: #51cf66; font-size: 16px;">✓</span>
              <div>
                <div style="font-size: 12px; color: #51cf66; font-weight: 500;">
                  Connected to Webflow
                </div>
                <div style="font-size: 11px; color: #888; margin-top: 2px;">
                  {validTokens().length} active token{validTokens().length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          </Show>

          <Show when={!hasValidToken()}>
            <div style="font-size: 11px; color: #888; margin-bottom: 12px;">
              Connect to Webflow to sync components, manage assets, and deploy to Webflow Cloud.
            </div>
          </Show>

          {/* Browser auth button */}
          <button
            type="button"
            style={{
              ...hasValidToken() ? buttonStyle : primaryButtonStyle,
              width: '100%',
              padding: hasValidToken() ? '10px' : '12px',
              'font-size': hasValidToken() ? '12px' : '13px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              gap: '8px',
              opacity: isAuthenticating() ? '0.7' : '1',
              cursor: isAuthenticating() ? 'wait' : 'pointer',
              'margin-bottom': '8px',
            }}
            onClick={startBrowserAuth}
            disabled={isAuthenticating()}
          >
            <Show when={isAuthenticating()} fallback={
              hasValidToken() ? <>+ Add Another Account</> : <>🔗 Connect with Webflow</>
            }>
              ⏳ Authenticating in browser...
            </Show>
          </button>

          <Show when={isAuthenticating()}>
            <div style="font-size: 11px; color: #888; text-align: center; margin-bottom: 12px;">
              This may take 10-30 seconds to open the browser.<br/>
              Complete authentication in your browser and this window will update automatically.
            </div>
          </Show>

          <Show when={!hasValidToken() && !isAuthenticating()}>
            <div style="text-align: center; font-size: 11px; color: #666; margin-bottom: 12px;">
              or paste an API token below
            </div>
          </Show>

          {/* Existing tokens */}
          <For each={tokens()}>
            {(token) => (
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    {TokenStatus(token.status)}
                    {TokenTypeLabel(token.type)}
                    <span style="font-size: 12px; color: #d9d9d9; font-weight: 500;">
                      {token.label || 'Verifying...'}
                    </span>
                  </div>
                  <div style="font-size: 10px; color: #666; font-family: monospace; margin-top: 2px; overflow: hidden; text-overflow: ellipsis;">
                    {token.token.substring(0, 20)}...
                  </div>
                  <Show when={token.scopes && token.scopes.length > 0}>
                    <div style="font-size: 9px; color: #555; margin-top: 4px;">
                      Scopes: {token.scopes!.slice(0, 3).join(', ')}{token.scopes!.length > 3 ? ` +${token.scopes!.length - 3} more` : ''}
                    </div>
                  </Show>
                  <Show when={token.error}>
                    <div style="font-size: 10px; color: #ff6b6b; margin-top: 2px;">
                      {token.error}
                    </div>
                  </Show>
                </div>
                <button
                  type="button"
                  style={removeButtonStyle}
                  onClick={() => removeToken(token.id)}
                >
                  Remove
                </button>
              </div>
            )}
          </For>

          {/* Add token manually */}
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <input
              type="password"
              placeholder="Paste API token..."
              value={newToken()}
              onInput={(e) => setNewToken(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToken()}
              style={inputStyle}
            />
            <button
              type="button"
              style={buttonStyle}
              onClick={addToken}
              disabled={!newToken().trim()}
            >
              Add
            </button>
          </div>

          <div style="font-size: 10px; color: #666; margin-top: 8px;">
            Get tokens from <a href="https://webflow.com/dashboard" target="_blank" style="color: #4dabf7;">Site Settings → Apps & Integrations → API Access</a>
          </div>
        </div>
      </SettingsPaneFormSection>
    </>
  );
};

export default WebflowTokenManager;
