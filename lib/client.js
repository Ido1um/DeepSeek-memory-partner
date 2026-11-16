window.__ModuleLoader__.load({
  id: '@local/dsmp',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const React = require('react');
    const h = React.createElement;
    const inject = ['slots'];

    function DsmpIcon(props) {
      const size = Number(props && props.size) || 18;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      },
        h('path', { d: 'M12 3.2c-3.6 0-6.2 2.4-6.2 5.5 0 1.5.6 2.6 1.5 3.5-1 .6-1.7 1.7-1.7 3 0 1.9 1.6 3.3 3.9 3.3h.7c.6 1.3 1.9 2.2 3.5 2.2 2.1 0 3.7-1.5 3.7-3.5 0-.6-.2-1.2-.4-1.7 1.2-.9 2-2.4 2-4.1 0-1.6-.8-3-2-3.9' }),
        h('path', { d: 'M9.5 9.5h.01M14.5 9.5h.01M9.2 14.2c.8.9 1.7 1.3 2.8 1.3s2-.4 2.8-1.3' })
      );
    }

    // 统一走 DSH 主题令牌：所有页签的底色/文字/边框都继承系统主题，
    // 只有「记忆」页签的 .dsmp-wb 容器再覆盖同名变量（同样映射到 DSH 令牌）。
    const colors = {
      accent: 'var(--wb-accent, var(--dsw-alias-brand-primary, #4c8dff))',
      accentSoft: 'var(--wb-accent-soft, var(--dsw-alias-interactive-bg-hover-accent, rgba(76,141,255,.14)))',
      border: 'var(--wb-line, var(--dsw-alias-border-l1, rgba(127,127,127,.20)))',
      borderStrong: 'var(--wb-line-strong, var(--dsw-alias-border-l2, rgba(127,127,127,.34)))',
      soft: 'var(--wb-soft, var(--dsw-alias-fill-muted, rgba(127,127,127,.06)))',
      bubble: 'var(--wb-panel2, var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)))',
      userBubble: 'var(--wb-accent-soft, var(--dsw-alias-interactive-bg-hover-accent, rgba(76,141,255,.16)))',
      danger: 'var(--wb-bad, var(--dsw-alias-state-error-primary, #e06c75))',
      ok: 'var(--wb-ok, var(--dsw-alias-state-success-primary, #3fb950))',
      warn: 'var(--wb-warn, var(--dsw-alias-state-warn-primary, #d29922))'
    };

    const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    /** Shell-level names shared by every tab; filled from /api/dsmp/status. */
    const shell = { label: '记忆面板', role: '' };

    // Electron/custom-protocol renderers do not always send Sec-Fetch-Site, so
    // the host cannot accept "same-origin" alone. Fetch the write token once and
    // attach it to every mutating DSMP call; GETs stay untouched.
    const nativeFetch = (input, init) => window.fetch(input, init);
    let writeTokenValue = '';
    let writeTokenPending = null;
    function loadWriteToken() {
      if (writeTokenValue) return Promise.resolve(writeTokenValue);
      if (!writeTokenPending) {
        writeTokenPending = nativeFetch('/api/dsmp/status', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => { writeTokenValue = (data && data.writeToken) || ''; return writeTokenValue; })
          .catch(() => '')
          .finally(() => { writeTokenPending = null; });
      }
      return writeTokenPending;
    }
    async function apiFetch(input, init) {
      const opts = init ? { ...init } : {};
      const method = String(opts.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const token = await loadWriteToken();
        if (token) opts.headers = { ...(opts.headers || {}), 'x-dsmp-token': token };
      }
      return nativeFetch(input, opts);
    }

    // Uncaught client errors otherwise blank the whole panel with no trace.
    // Report them to the host so the next reproduction leaves a log we can read.
    let clientErrorHooksInstalled = false;
    function reportClientError(kind, err, extra) {
      try {
        let message = '';
        let stack = '';
        if (err && typeof err === 'object') {
          message = String(err.message || err);
          stack = String(err.stack || '');
        } else {
          message = String(err || '');
        }
        const body = JSON.stringify({
          kind: String(kind || 'error'),
          message: message.slice(0, 2000),
          stack: stack.slice(0, 8000),
          at: Date.now(),
          href: (typeof location !== 'undefined' ? String(location.href) : ''),
          extra: extra || null
        });
        apiFetch('/api/dsmp/client-error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        }).catch(() => {});
      } catch {
        /* reporting must never throw */
      }
    }
    function installClientErrorHooks() {
      if (clientErrorHooksInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
      clientErrorHooksInstalled = true;
      window.addEventListener('error', (ev) => {
        reportClientError('window.error', (ev && ev.error) || (ev && ev.message), {
          filename: ev && ev.filename, lineno: ev && ev.lineno, colno: ev && ev.colno
        });
      });
      window.addEventListener('unhandledrejection', (ev) => {
        reportClientError('unhandledrejection', ev && ev.reason);
      });
    }

    const styles = {
      page: {
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 26px 16px',
        color: 'inherit',
        boxSizing: 'border-box',
        overflow: 'hidden'
      },
      header: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 2 },
      title: { fontSize: 19, fontWeight: 650, margin: 0, letterSpacing: '.01em' },
      hint: { fontSize: 12, opacity: .55 },
      chips: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 2px' },
      chip: {
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        opacity: .9
      },
      tabs: { display: 'flex', gap: 2, margin: '10px 0 14px', borderBottom: `1px solid ${colors.border}` },
      tab: {
        padding: '8px 11px',
        border: 'none',
        borderBottom: '2px solid transparent',
        marginBottom: -1,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
        opacity: .6
      },
      tabActive: {
        padding: '8px 11px',
        border: 'none',
        borderBottom: `2px solid ${colors.accent}`,
        marginBottom: -1,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        opacity: 1
      },
      button: {
        padding: '7px 12px',
        borderRadius: 9,
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12.5
      },
      buttonPrimary: {
        padding: '7px 15px',
        borderRadius: 9,
        border: '1px solid transparent',
        background: colors.accent,
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12.5,
        fontWeight: 600
      },
      input: {
        padding: '7px 10px',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: 'var(--wb-panel2, var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)))',
        color: 'inherit',
        font: 'inherit',
        fontSize: 12.5,
        outline: 'none',
        // Without border-box a `width: 100%` control is wider than its card by
        // padding + border, which pushed the persona select/textarea out of view.
        boxSizing: 'border-box',
        maxWidth: '100%'
      },
      toolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
      status: { fontSize: 11.5, opacity: .55, padding: '2px 0 8px' },
      list: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px 0' },
      body: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' },
      scroll: {
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingRight: 6,
        scrollbarGutter: 'stable'
      },
      empty: {
        margin: 'auto',
        textAlign: 'center',
        opacity: .5,
        fontSize: 13,
        lineHeight: 1.9,
        padding: '40px 12px'
      },
      error: { color: colors.danger, fontSize: 12, margin: '4px 0 8px' },
      dayDivider: {
        fontSize: 11,
        opacity: .45,
        textAlign: 'center',
        margin: '6px 0 0',
        letterSpacing: '.05em'
      },
      metaColumn: { fontSize: 11, opacity: .55, lineHeight: 1.5, paddingTop: 4, minWidth: 44 },
      kindBadge: {
        display: 'inline-block',
        marginTop: 2,
        padding: '1px 5px',
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        fontSize: 10
      },
      subTabs: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
      subTab: {
        border: `1px solid ${colors.border}`,
        background: 'transparent',
        color: 'inherit',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer'
      },
      subTabActive: {
        border: `1px solid ${colors.accent}`,
        background: colors.userBubble,
        color: 'inherit',
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer'
      },
      factRow: { borderTop: `1px dashed ${colors.border}`, padding: '6px 0', fontSize: 13, lineHeight: 1.6 },
      dim: { opacity: .6, fontSize: 11 },
      card: {
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '16px 18px',
        marginBottom: 14,
        background: 'var(--wb-panel, var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06)))',
        boxShadow: 'var(--wb-shadow, none)',
        // Cards live inside a flex column; without this a wide child (select or
        // long path text) stretches the card past the panel edge.
        boxSizing: 'border-box',
        minWidth: 0,
        maxWidth: '100%'
      },
      row: { display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', fontSize: 13 },
      label: { width: 92, flex: '0 0 auto', opacity: .62, fontSize: 12 },
      value: { flex: '1 1 auto', wordBreak: 'break-all', lineHeight: 1.55 },
      mono: { fontFamily: monoFont, fontSize: 12 },

      // ---- 记忆页签外壳（对齐旧 7351：左导航 + topbar + 内容区） ----
      wbShell: {
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        gap: 0,
        margin: 0,
        padding: '10px 14px 12px',
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        background: 'var(--wb-bg, var(--dsw-alias-bg-base, transparent))',
        color: 'var(--wb-text, inherit)',
        fontSize: 13.5,
        lineHeight: 1.6,
        boxSizing: 'border-box'
      },
      wbSide: {
        width: 208,
        flex: '0 0 208px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 10px 10px 0',
        borderRight: `1px solid ${colors.border}`,
        minHeight: 0,
        overflowY: 'auto',
        scrollbarGutter: 'stable'
      },
      wbBrand: {
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '.02em',
        padding: '4px 10px 10px',
        color: 'var(--wb-text, inherit)'
      },
      wbBrandHint: { fontSize: 10.5, opacity: .5, fontWeight: 400, marginTop: 2 },
      wbNavGroup: { fontSize: 10, letterSpacing: '.12em', opacity: .42, padding: '12px 10px 4px', textTransform: 'uppercase' },
      wbNavItem: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        padding: '7px 10px',
        borderRadius: 8,
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12.5,
        lineHeight: 1.4
      },
      wbNavActive: {
        background: 'var(--wb-hover, var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)))',
        boxShadow: `inset 2px 0 0 ${colors.accent}`,
        fontWeight: 600
      },
      wbSideFoot: { marginTop: 'auto', padding: '10px 10px 2px', fontSize: 10.5, opacity: .45, lineHeight: 1.6 },
      wbMain: { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', paddingLeft: 18 },
      wbTopbar: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '2px 0 10px',
        borderBottom: `1px solid ${colors.border}`,
        marginBottom: 12
      },
      wbTopTitle: { fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: '.01em' },
      wbTopHint: { fontSize: 11, opacity: .5 },
      wbTopSpacer: { flex: '1 1 auto' },
      wbPanel: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingRight: 6, scrollbarGutter: 'stable' },
      wbNote: { fontSize: 11, color: 'var(--wb-accent, #4c8dff)', minHeight: 14 },
      wbGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 },
      wbStat: {
        border: `1px solid ${colors.border}`,
        background: 'var(--wb-panel2, var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)))',
        borderRadius: 10,
        padding: '10px 12px',
        minWidth: 0
      },
      wbStatLabel: { fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .5 },
      wbStatValue: { fontSize: 19, fontWeight: 650, fontFamily: monoFont, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis' },
      wbTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      wbTh: { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${colors.borderStrong}`, fontSize: 11, opacity: .6, fontWeight: 500, whiteSpace: 'nowrap' },
      wbTd: { padding: '6px 8px', borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' },
      wbTdNum: { padding: '6px 8px', borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top', textAlign: 'right', fontFamily: monoFont, whiteSpace: 'nowrap' },
      wbTscroll: { overflowX: 'auto', marginTop: 6 },
      wbSectionTitle: { fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', opacity: .55, marginBottom: 8 },

      // ---- chat shell (DSH chat surface) ----
      shell: {
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'transparent'
      },
      rail: {
        width: 212,
        flex: '0 0 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${colors.border}`,
        background: colors.soft
      },
      railCollapsed: {
        width: 46,
        flex: '0 0 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '10px 0',
        borderRight: `1px solid ${colors.border}`,
        background: colors.soft
      },
      railHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        padding: '11px 10px 8px 12px'
      },
      railTitle: { fontSize: 11.5, fontWeight: 600, opacity: .62, letterSpacing: '.04em' },
      railList: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
      railItem: {
        textAlign: 'left',
        border: '1px solid transparent',
        background: 'transparent',
        color: 'inherit',
        borderRadius: 9,
        padding: '7px 8px',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12.5,
        lineHeight: 1.4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      },
      railItemActive: {
        textAlign: 'left',
        border: `1px solid ${colors.border}`,
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
        color: 'inherit',
        borderRadius: 9,
        padding: '7px 8px',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 12.5,
        lineHeight: 1.4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      },
      railName: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      railMeta: { fontSize: 10.5, opacity: .48, fontFamily: monoFont },
      main: { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' },
      chatHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border}`,
        minHeight: 40
      },
      linkBtn: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        opacity: .5,
        fontSize: 11.5,
        cursor: 'pointer',
        padding: '2px 4px',
        borderRadius: 6
      },
      linkBtnOn: {
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        color: 'inherit',
        opacity: .9,
        fontSize: 11.5,
        cursor: 'pointer',
        padding: '2px 7px',
        borderRadius: 6
      },
      linkBtnDanger: {
        border: 'none',
        background: 'transparent',
        color: colors.danger,
        fontSize: 11.5,
        cursor: 'pointer',
        padding: '2px 4px',
        borderRadius: 6
      },
      inlineInput: {
        flex: '1 1 220px',
        minWidth: 120,
        border: `1px solid ${colors.borderStrong}`,
        background: 'transparent',
        color: 'inherit',
        borderRadius: 7,
        padding: '4px 8px',
        font: 'inherit',
        fontSize: 13,
        outline: 'none'
      },
      chatTitle: { fontSize: 13, fontWeight: 600 },
      dot: { width: 7, height: 7, borderRadius: 999, background: colors.ok, display: 'inline-block', flex: '0 0 auto' },
      dotBusy: { width: 7, height: 7, borderRadius: 999, background: colors.warn, display: 'inline-block', flex: '0 0 auto' },
      thread: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '18px 18px 6px' },
      threadInner: { maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 },
      msgRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
      msgRowUser: { display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'flex-end' },
      avatar: {
        width: 26,
        height: 26,
        flex: '0 0 auto',
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.accent
      },
      msgBody: { minWidth: 0, maxWidth: '86%', display: 'flex', flexDirection: 'column', gap: 6 },
      who: { fontSize: 11.5, fontWeight: 600, opacity: .78, display: 'flex', gap: 7, alignItems: 'baseline' },
      when: { fontSize: 10.5, opacity: .45, fontWeight: 400 },
      text: { fontSize: 13.5, lineHeight: 1.72, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      bubbleUser: {
        background: colors.userBubble,
        border: '1px solid rgba(76,141,255,.20)',
        borderRadius: '12px 12px 4px 12px',
        padding: '9px 13px',
        maxWidth: '78%',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.65,
        fontSize: 13.5
      },
      toolLine: { fontSize: 11, opacity: .5 },
      composer: {
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        borderRadius: 12,
        margin: '4px 16px 12px',
        padding: '8px 10px 6px'
      },
      composerInner: { maxWidth: 760, margin: '0 auto' },
      composerRow: { display: 'flex', alignItems: 'flex-end', gap: 4 },
      textarea: {
        flex: '1 1 auto',
        minHeight: 38,
        maxHeight: 160,
        resize: 'none',
        padding: '7px 4px',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: 13.5,
        lineHeight: 1.6
      },
      iconBtn: {
        width: 30,
        height: 30,
        flex: '0 0 auto',
        borderRadius: 8,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'inherit',
        opacity: .6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0
      },
      sendBtn: {
        width: 32,
        height: 32,
        flex: '0 0 auto',
        borderRadius: 9,
        border: 'none',
        background: colors.accent,
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0
      },
      hintRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        fontSize: 10.5,
        opacity: .45,
        padding: '2px 2px 0'
      },
      bar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '7px 16px 9px',
        borderTop: `1px solid ${colors.border}`,
        fontSize: 11,
        opacity: .62
      }
    };

    function modeText(mode) {
      if (mode === 'qq') return 'QQ 通道在线';
      if (mode === 'degraded') return '桥接在线 · 账号未确认';
      return '本地模式（不依赖 QQ）';
    }

    function Row(props) {
      return h('div', { style: styles.row },
        h('span', { style: styles.label }, props.label),
        h('span', { style: { ...styles.value, ...(props.mono ? styles.mono : {}) } }, props.children)
      );
    }

    /** Accepts ms or ISO; the workbench mixes both (window rows vs event logs). */
    function fmtTime(value) {
      const n = typeof value === 'number' ? value : Date.parse(String(value || ''));
      if (!Number.isFinite(n) || !n) return '—';
      const d = new Date(n);
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    const INJECTED_PREFIXES = [
      'Current runtime context',
      '<system-reminder>',
      'Time sampled while preparing'
    ];

    // The session log also carries the host's context injections as "user"
    // messages. The host now marks ours with origin=panel; the id/prefix checks
    // are fallbacks for sessions mirrored before that field existed.
    function visibleMessage(message) {
      if (!message || message.role !== 'user') return true;
      if (message.origin === 'panel') return true;
      if (message.origin === 'host') return false;
      if (String(message.id || '').startsWith('dsmp-')) return true;
      const text = String(message.text || '');
      return !INJECTED_PREFIXES.some((prefix) => text.startsWith(prefix));
    }

    function bodyOf(message) {
      if (!message) return '';
      return message.displayText || message.text || '';
    }

    /**
     * One picture in a bubble. Panel uploads are addressed by sha1 (served
     * straight from the media library); mirrored turns only carry a DSH
     * attachment ref, so the bytes are fetched and turned into a blob URL.
     */
    function MediaThumb(props) {
      const item = props.item || {};
      const [src, setSrc] = React.useState(item.url || (item.sha1 ? `/api/dsmp/media/file?sha1=${item.sha1}&kind=image` : ''));
      const [broken, setBroken] = React.useState(false);

      React.useEffect(() => {
        // Keep this effect keyed to the attachment only. Adding `src` here made
        // React run the cleanup as soon as setSrc fired, revoking the blob URL
        // that the <img> was about to use — the picture then showed as broken.
        if (item.sha1 || item.url || !item.attachmentId) return undefined;
        let alive = true;
        let objectUrl = '';
        (async () => {
          try {
            const res = await apiFetch('/api/dsmp/media/attachment', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ref: item })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            if (!alive) {
              URL.revokeObjectURL(url);
              return;
            }
            objectUrl = url;
            setSrc(url);
          } catch {
            if (alive) setBroken(true);
          }
        })();
        return () => {
          alive = false;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      }, [item.attachmentId]);

      const box = {
        width: props.size || 132,
        height: props.size || 132,
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        background: colors.soft,
        objectFit: 'cover',
        display: 'block'
      };
      if (broken) return h('div', { style: { ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: .6 } }, '图片已失效');
      if (!src) return h('div', { style: { ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, opacity: .6 } }, '加载中…');
      return h('img', { src, alt: item.name || item.alt || '图片', style: box, onError: () => setBroken(true) });
    }

    function ImageStrip(props) {
      const list = props.images || [];
      if (!list.length) return null;
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: props.text ? 6 : 0 } },
        list.map((item, index) => h(MediaThumb, { key: item.sha1 || item.attachmentId || index, item, size: 132 })));
    }

    /**
     * Voice strip (P1): QQ 收到的语音由 bridge 自动存进语音库，这里直接播；
     * 本地也能上传。点「发这条」按当前模式真实发送或只入队。
     */
    function VoiceCard(props) {
      const items = props.items || [];
      const sourceLabel = (item) => {
        if (item.source === 'qq') return 'QQ';
        if (item.source === 'qq-outbound') return 'QQ · 她说';
        if (item.source === 'panel-upload') return '本地上传';
        return item.source || '本地';
      };
      const isOut = (item) => item.direction === 'out';
      const outItems = items.filter(isOut);
      const inItems = items.filter((item) => !isOut(item));
      const textLabel = (item) => {
        if (item.text) return item.textSource === 'stt' ? `（识别）${item.text}` : item.text;
        return '（没有原文）';
      };
      const row = (item, keyPrefix) => h('div', { key: `${keyPrefix}-${item.sha1}`, style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('audio', {
            controls: true,
            preload: 'none',
            src: `/api/dsmp/media/file?sha1=${item.sha1}&kind=voice`,
            style: { height: 30, maxWidth: 240 }
          }),
          h('span', { style: { fontSize: 11, opacity: .7 } },
            `${item.alt || item.name || item.sha1.slice(0, 8)} · ${sourceLabel(item)}`
            + ` · ${Math.max(1, Math.round((item.bytes || 0) / 1024))} KB`
            + (item.duration ? ` · ${item.duration}s` : '')
            + (item.at ? ` · ${String(item.at).slice(5, 16).replace('T', ' ')}` : '')),
          h('button', { style: styles.button, onClick: () => props.onQueue(item) }, '发这条')
        ),
        isOut(item)
          ? h('div', { style: { fontSize: 12, opacity: item.text ? .9 : .55, paddingLeft: 2 } }, textLabel(item))
          : null
      );
      const group = (title, list, prefix) => (list.length
        ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { fontSize: 11, opacity: .6, marginBottom: 4 } }, `${title} · ${list.length}`),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, list.slice(0, 4).map((item) => row(item, prefix))))
        : null);
      return h('div', { style: { ...styles.card, padding: '8px 10px' } },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 12, opacity: .75 } }, '语音库（她发出去的会带原文；主人发来的只听）'),
          h('span', { style: styles.chip }, `${items.length} 条`),
          props.onRefresh ? h('button', { style: styles.button, onClick: () => props.onRefresh() }, '刷新') : null
        ),
        items.length
          ? h('div', null,
              group('她说过的', outItems, 'out'),
              group('主人发来的', inItems, 'in'))
          : h('div', { style: { marginTop: 6, fontSize: 12, opacity: .6 } }, '还没有语音文件：QQ 收到语音会自动出现在这里，也可以从下面「上传语音」放一条'),
        props.note ? h('div', { style: { marginTop: 6, fontSize: 11, opacity: .75 } }, props.note) : null
      );
    }

    function bubbleStyle(role) {
      return {
        alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
        maxWidth: '78%',
        padding: '9px 12px',
        borderRadius: 12,
        background: role === 'user' ? colors.userBubble : colors.bubble,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.55
      };
    }

    function ChatIcon(props) {
      const size = Number(props && props.size) || 15;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, props.children);
    }

    function ImageIcon() {
      return h(ChatIcon, null,
        h('rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 3 }),
        h('circle', { cx: 8.5, cy: 10, r: 1.6 }),
        h('path', { d: 'M20.5 16l-5-5-4.2 4.2L9 13l-5.5 5.5' })
      );
    }

    function MicIcon() {
      return h(ChatIcon, null,
        h('rect', { x: 9, y: 3, width: 6, height: 10, rx: 3 }),
        h('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0' }),
        h('path', { d: 'M12 17.5V21' })
      );
    }

    function SendIcon() {
      return h(ChatIcon, { size: 16 },
        h('path', { d: 'M12 19V5' }),
        h('path', { d: 'M5.5 11.5L12 5l6.5 6.5' })
      );
    }

    function PlusIcon() {
      return h(ChatIcon, { size: 14 },
        h('path', { d: 'M12 5v14' }),
        h('path', { d: 'M5 12h14' })
      );
    }

    function ChevronLeftIcon() {
      return h(ChatIcon, { size: 14 }, h('path', { d: 'M14.5 6.5L9 12l5.5 5.5' }));
    }

    function ChevronRightIcon() {
      return h(ChatIcon, { size: 14 }, h('path', { d: 'M9.5 6.5L15 12l-5.5 5.5' }));
    }

    function ChatTab() {
      const [sessions, setSessions] = React.useState([]);
      const [sessionId, setSessionId] = React.useState('');
      const [data, setData] = React.useState(null);
      const [draft, setDraft] = React.useState('');
      const [sending, setSending] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [memory, setMemory] = React.useState(null);
      const [inbox, setInbox] = React.useState([]);
      const [pending, setPending] = React.useState([]);
      const [voices, setVoices] = React.useState([]);
      const [voiceNote, setVoiceNote] = React.useState('');
      // The QQ conversation key is configured per install; never hardcode an owner id.
      const [channelKey, setChannelKey] = React.useState('');
      React.useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const res = await apiFetch('/api/dsmp/status', { cache: 'no-store' });
            const payload = await res.json();
            if (alive && payload && payload.ok) setChannelKey(String(payload.channelKey || ''));
          } catch (err) {
            /* status is advisory; the composer still works for test sessions */
          }
        })();
        return () => { alive = false; };
      }, []);
      const listRef = React.useRef(null);
      const atBottomRef = React.useRef(true);
      const sessionsRef = React.useRef([]);
      const cursorRef = React.useRef(0);
      const historyCursorRef = React.useRef('');
      const historyMoreRef = React.useRef(false);
      const loadingOlderRef = React.useRef(false);
      const [hasOlder, setHasOlder] = React.useState(false);
      const isLiveRef = React.useRef(false);
      const fileRef = React.useRef(null);
      const voiceRef = React.useRef(null);

      /**
       * Upload pictures into the media library. They are addressed by sha1 from
       * then on, so the send call only carries hashes — and re-sending the same
       * picture costs nothing.
       */
      const uploadFiles = React.useCallback(async (fileList) => {
        // QQ 会话不支持从面板发图（bridge 只转发文字），粘贴/拖入也要挡住。
        if (isLiveRef.current) {
          setError('当前对话是 QQ 会话，暂不支持从面板发图');
          return;
        }
        const files = Array.from(fileList || []).filter((file) => file && /^image\//.test(file.type || ''));
        if (!files.length) return;
        setError(null);
        for (const file of files) {
          try {
            const res = await apiFetch(`/api/dsmp/media/upload?kind=image&name=${encodeURIComponent(file.name || 'panel-image')}`, {
              method: 'POST',
              headers: { 'content-type': file.type || 'application/octet-stream' },
              body: file
            });
            const payload = await res.json();
            if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
            setPending((current) => [...current, { sha1: payload.sha1, name: file.name || payload.sha1, preview: URL.createObjectURL(file) }]);
          } catch (err) {
            setError(String(err && err.message ? err.message : err));
          }
        }
      }, []);

      const loadInbox = React.useCallback(async () => {
        const res = await apiFetch('/api/dsmp/inbox?limit=5', { cache: 'no-store' });
        const payload = await res.json();
        if (payload && payload.ok) setInbox(payload.messages || []);
      }, []);

      const loadVoices = React.useCallback(async () => {
        const res = await apiFetch('/api/dsmp/media/list?kind=voice&limit=8', { cache: 'no-store' });
        const payload = await res.json();
        if (payload && payload.ok) setVoices(payload.items || []);
      }, []);

      const uploadVoice = React.useCallback(async (file) => {
        if (!file) return;
        setError(null);
        try {
          const res = await apiFetch(`/api/dsmp/media/upload?kind=voice&name=${encodeURIComponent(file.name || 'panel-voice')}`, {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream' },
            body: file
          });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
          await loadVoices();
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      }, [loadVoices]);

      const queueVoice = React.useCallback(async (item) => {
        setError(null);
        try {
          const res = await apiFetch('/api/dsmp/voice/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: channelKey, sha1: item.sha1, label: item.name || '面板语音' })
          });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
          setVoiceNote(payload.dryRun ? `已入队（测试期不发出）：${item.name || item.sha1.slice(0, 8)}` : `已发送：${item.name || item.sha1.slice(0, 8)}`);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      }, [channelKey]);
      async function simulateInbound() {
        setError(null);
        try {
          const res = await apiFetch('/api/dsmp/inbound', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: channelKey, messages: ['【测试】来自 QQ 的一句话'], origin: 'panel-sim' })
          });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
          await loadInbox();
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      }

      const loadSessions = React.useCallback(async () => {
        const res = await apiFetch('/api/dsmp/chat/sessions', { cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
        const list = payload.sessions || [];
        // Pull the bound conversation in from the history index: the chat route
        // only lists test sessions, but the rail should still show "the current
        // chat" and keep it pinned on top.
        try {
          const hres = await apiFetch('/api/dsmp/history/sessions?limit=60', { cache: 'no-store' });
          const hdata = await hres.json();
          const bound = (hdata && hdata.items || []).find((row) => row && row.bound);
          if (bound && bound.sessionId) {
            const existing = list.find((row) => row.id === bound.sessionId);
            if (existing) {
              existing.live = true;
              if (!existing.title) existing.title = `${shell.role || '她'}（当前对话）`;
            } else {
              list.push({
                id: bound.sessionId,
                title: `${shell.role || '她'}（当前对话）`,
                busy: false,
                attached: false,
                messages: 0,
                lastAt: bound.mtime || 0,
                live: true
              });
            }
            list.sort((a, b) => Number(b.live ? 1 : 0) - Number(a.live ? 1 : 0) || (b.lastAt || 0) - (a.lastAt || 0));
          }
        } catch (err) {
          // history index unavailable — the rail still works with test sessions
        }
        setSessions(list);
        sessionsRef.current = list;
        setSessionId((current) => current || (list.length ? list[0].id : ''));
        return list;
      }, []);

      const loadMessages = React.useCallback(async (id, { silent = false, older = false } = {}) => {
        if (!id) return;
        if (!silent) cursorRef.current = 0;
        const row = (sessionsRef.current || []).find((item) => item && item.id === id);
        if (row && row.live) {
          // QQ 会话会随轮转拆成多份日志；scope=qq 把这些日志按时间合成一条
          // 连续记录，和 QQ 里看到的一致。向上滚动时用 before 取更早一页。
          const params = new URLSearchParams({ scope: 'qq', limit: '120' });
          if (older && historyCursorRef.current) params.set('before', historyCursorRef.current);
          const res = await apiFetch(`/api/dsmp/history?${params.toString()}`, { cache: 'no-store' });
          const payload = await res.json();
          if (res.ok && payload && payload.ok !== false) {
            const messages = (payload.items || []).map((item) => ({
              id: item.id,
              role: item.role === 'assistant' ? 'assistant' : 'user',
              text: item.displayText || '',
              at: item.at,
              images: item.images || []
            }));
            historyMoreRef.current = Boolean(payload.hasMore);
            setHasOlder(Boolean(payload.hasMore));
            if (!older && messages.length) historyCursorRef.current = messages[0].id;
            setData((prev) => {
              const base = prev && prev.messages ? prev.messages : [];
              const map = new Map();
              for (const message of [...messages, ...base]) {
                if (message && message.id && !map.has(message.id)) map.set(message.id, message);
              }
              const merged = [...map.values()].sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
              return { ok: true, busy: false, live: true, total: payload.total, messages: merged };
            });
            return;
          }
        }
        const before = cursorRef.current || 0;
        const res = await apiFetch(`/api/dsmp/chat/messages?sessionId=${encodeURIComponent(id)}&after=${before}`, { cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
        // 增量轮询：after>0 且服务端确实返回了新消息时，接到已有列表后面；否则整屏替换。
        const fresh = (payload && payload.messages) || [];
        if (payload.lastIdx) cursorRef.current = payload.lastIdx;
        if (!silent || before === 0 || !fresh.length) {
          setData(payload);
        } else {
          setData((prev) => ({
            ...payload,
            messages: [...((prev && prev.messages) || []), ...fresh].slice(-200)
          }));
        }
      }, []);

      React.useEffect(() => {
        loadSessions().catch((err) => setError(String(err && err.message ? err.message : err)));
      }, [loadSessions]);

      React.useEffect(() => {
        loadInbox().catch(() => { /* channel strip is best-effort */ });
        const timer = setInterval(() => { loadInbox().catch(() => {}); }, 5000);
        return () => clearInterval(timer);
      }, [loadInbox]);

      React.useEffect(() => {
        loadVoices().catch(() => { /* voice strip is best-effort */ });
      }, [loadVoices]);

      React.useEffect(() => {
        if (!sessionId) return undefined;
        cursorRef.current = 0;
        loadMessages(sessionId).catch((err) => setError(String(err && err.message ? err.message : err)));
        const timer = setInterval(() => {
          loadMessages(sessionId, { silent: true }).catch(() => { /* keep the last good view */ });
        }, 2500);
        return () => clearInterval(timer);
      }, [sessionId, loadMessages]);

      React.useEffect(() => {
        const el = listRef.current;
        if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
      });

      async function createSession() {
        setError(null);
        try {
          const res = await apiFetch('/api/dsmp/chat/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: '面板自测' })
          });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
          await loadSessions();
          setSessionId(payload.sessionId);
          await loadMessages(payload.sessionId);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        }
      }

      async function send() {
        const text = draft.trim();
        const images = pending.map((item) => item.sha1);
        if ((!text && !images.length) || sending) return;
        if (!sessionId) {
          setError('还没有会话，先点「新建会话」。');
          return;
        }
        setSending(true);
        setError(null);
        atBottomRef.current = true;
        try {
          const res = await apiFetch('/api/dsmp/chat/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, text, images })
          });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.error) || `HTTP ${res.status}`);
          if (payload.memory) setMemory(payload.memory);
          setNotice(payload.via === 'local'
            ? (payload.notice || '面板直连 DSH · 同一会话，账本由 DSMP 记录')
            : '');
          setDraft('');
          setPending([]);
          await loadMessages(sessionId);
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
        } finally {
          setSending(false);
        }
      }

      const messages = ((data && data.messages) || []).filter(visibleMessage);
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

      const [showVoices, setShowVoices] = React.useState(false);
      const [renaming, setRenaming] = React.useState(null);
      const [renameText, setRenameText] = React.useState('');
      const [armedDelete, setArmedDelete] = React.useState(null);
      const [collapsed, setCollapsed] = React.useState(() => {
        try { return localStorage.getItem('dsmp.rail.collapsed') === '1'; } catch { return false; }
      });
      const toggleRail = () => {
        setCollapsed((value) => {
          const next = !value;
          try { localStorage.setItem('dsmp.rail.collapsed', next ? '1' : '0'); } catch { /* ignore */ }
          return next;
        });
      };
      const current = sessions.find((item) => item.id === sessionId) || null;
      const groups = [];
      for (const message of messages) {
        const day = dayOf(message.at);
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.items.push(message);
        else groups.push({ day: day, items: [message] });
      }
      const currentTitle = current ? (current.title || '未命名会话') : '未命名会话';

      const saveRename = () => {
        const title = renameText.trim();
        if (!renaming || !title) return;
        apiFetch('/api/dsmp/chat/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: renaming, title })
        })
          .then((res) => res.json())
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || '改名失败');
            setRenaming(null);
            setRenameText('');
            loadSessions();
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      };

      const removeSession = () => {
        const target = armedDelete;
        if (!target) return;
        apiFetch('/api/dsmp/chat/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: target })
        })
          .then((res) => res.json())
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || '删除失败');
            setArmedDelete(null);
            setSessionId('');
            loadSessions();
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      };

      const memoryLine = memory && memory.skipped === 'live-forward'
        ? '面板直发 · 记忆由 bridge 注入'
        : (memory && memory.dataPresent
          ? '记忆已注入 · 事实 ' + memory.facts + ' 条 · 卡 ' + memory.cardChars + ' 字'
          : '本条消息未带事实卡');
      const liveItem = sessions.find((row) => row && row.id === sessionId);
      const isLive = Boolean(liveItem && liveItem.live);
      isLiveRef.current = isLive;
      return h('div', { style: styles.body },
        h('div', { style: styles.shell },
          collapsed
            ? h('aside', { style: styles.railCollapsed },
                h('button', {
                  style: styles.iconBtn,
                  title: '展开会话栏',
                  onClick: toggleRail
                }, h(ChevronRightIcon)),
                h('button', {
                  style: styles.iconBtn,
                  title: '新建会话',
                  onClick: createSession
                }, h(PlusIcon))
              )
            : h('aside', { style: styles.rail },
                h('div', { style: styles.railHead },
                  h('span', { style: styles.railTitle }, '会话'),
                  h('span', { style: { flex: '1 1 auto' } }),
                  h('button', {
                    style: styles.iconBtn,
                    title: '收起会话栏',
                    onClick: toggleRail
                  }, h(ChevronLeftIcon)),
                  h('button', {
                    style: styles.iconBtn,
                    title: '新建会话',
                    onClick: createSession
                  }, h(PlusIcon))
                ),
                h('div', { style: styles.railList },
                  sessions.length
                    ? sessions.map((item) => h('button', {
                        key: item.id,
                        style: item.id === sessionId ? styles.railItemActive : styles.railItem,
                        onClick: () => { setSessionId(item.id); setError(null); }
                      },
                        h('span', { style: styles.railName }, (item.live ? '▍' : '') + (item.title || '未命名会话')),
                        h('span', { style: styles.railMeta }, (item.live ? '当前 · ' : '') + item.id.slice(-8) + (item.busy ? ' · 回复中' : ''))
                      ))
                    : h('div', { style: { ...styles.dim, padding: '8px 4px' } }, '还没有会话')
                )
              ),
          h('div', { style: styles.main },
            h('div', { style: styles.chatHead },
              data && data.busy ? h('span', { style: styles.dotBusy }) : h('span', { style: styles.dot }),
              renaming === sessionId
                ? h('input', {
                    style: styles.inlineInput,
                    value: renameText,
                    autoFocus: true,
                    placeholder: '新的会话名',
                    onChange: (event) => setRenameText(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') saveRename();
                      if (event.key === 'Escape') { setRenaming(null); setRenameText(''); }
                    }
                  })
                : h('span', { style: styles.chatTitle }, currentTitle),
              data && data.testMode ? h('span', { style: styles.chip }, '测试会话') : null,
              isLive ? h('span', { style: styles.chip }, '当前 · QQ') : null,
              sessionId ? h('span', { style: { ...styles.dim, fontFamily: monoFont, fontSize: 10.5 } }, sessionId.slice(-8)) : null,
              renaming === sessionId
                ? h('button', { style: styles.linkBtnOn, onClick: saveRename }, '保存')
                : (sessionId && !isLive
                    ? h('button', {
                        style: styles.linkBtn,
                        title: '重命名会话',
                        onClick: () => { setRenaming(sessionId); setRenameText(currentTitle); setArmedDelete(null); }
                      }, '重命名')
                    : null),
              renaming === sessionId
                ? h('button', { style: styles.linkBtn, onClick: () => { setRenaming(null); setRenameText(''); } }, '取消')
                : (sessionId && !isLive
                    ? h('button', {
                        style: armedDelete === sessionId ? styles.linkBtnDanger : styles.linkBtn,
                        title: '从面板移除（会话日志保留）',
                        onClick: () => (armedDelete === sessionId ? removeSession() : setArmedDelete(sessionId))
                      }, armedDelete === sessionId ? '确认删除' : '删除')
                    : null),
              h('span', { style: { flex: '1 1 auto' } }),
              data && data.busy ? h('span', { style: styles.dim }, `${shell.role || '她'}正在回复…`) : null
            ),
            h('div', {
              ref: listRef,
              onScroll: (event) => {
                const el = event.target;
                atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                if (el.scrollTop < 60 && historyMoreRef.current && !loadingOlderRef.current && sessionId) {
                  loadingOlderRef.current = true;
                  loadMessages(sessionId, { older: true })
                    .catch(() => {})
                    .finally(() => { loadingOlderRef.current = false; });
                }
              },
              style: styles.thread
            },
              h('div', { style: styles.threadInner },
                hasOlder
                  ? h('div', { style: { textAlign: 'center', fontSize: 11, opacity: .5, padding: '2px 0 10px' } }, '↑ 向上滚动加载更早的记录')
                  : null,
                messages.length
                  ? groups.map((group) => h('div', { key: group.day, style: { display: 'flex', flexDirection: 'column', gap: 14 } },
                      h('div', { style: styles.dayDivider }, group.day),
                      group.items.map((message) => (message.role === 'user'
                        ? h('div', { key: message.id, style: styles.msgRowUser },
                            h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, maxWidth: '78%' } },
                              h(ImageStrip, { images: message.images, text: Boolean(bodyOf(message)) }),
                              bodyOf(message) ? h('div', { style: styles.bubbleUser }, bodyOf(message)) : null,
                              h('span', { style: styles.when }, clockOf(message.at))
                            )
                          )
                        : h('div', { key: message.id, style: styles.msgRow },
                            h('div', { style: styles.avatar }, h(DsmpIcon, { size: 14 })),
                            h('div', { style: styles.msgBody },
                              h('div', { style: styles.who },
                                h('span', null, shell.role || '她'),
                                h('span', { style: styles.when }, clockOf(message.at))
                              ),
                              h(ImageStrip, { images: message.images, text: Boolean(bodyOf(message)) }),
                              bodyOf(message) ? h('div', { style: styles.text }, bodyOf(message)) : null
                            )
                          )
                      ))
                    ))
                  : h('div', { style: styles.empty },
                      h('div', null, sessionId ? '这个会话还没有消息' : '还没有打开的会话'),
                      h('div', { style: { fontSize: 12, opacity: .8, marginTop: 6 } },
                        sessionId
                          ? '在下面输入第一句；「模拟入站」可以走一遍 QQ 入站流程。'
                          : '点左上角 ＋ 新建一个会话。')
                    )
              )
            ),
            error ? h('div', { style: { ...styles.error, margin: '0 18px 6px' } }, error) : null,
            notice ? h('div', { style: { ...styles.dim, margin: '0 18px 6px' } }, notice) : null,
            h('div', { style: styles.composer },
              h('div', { style: styles.composerInner },
                pending.length
                  ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '2px 2px 8px' } },
                      pending.map((item, index) => h('div', { key: item.sha1 + index, style: { position: 'relative' } },
                        h('img', {
                          src: item.preview,
                          alt: item.name,
                          style: { width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid ' + colors.border }
                        }),
                        h('button', {
                          style: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, lineHeight: '14px', padding: 0, borderRadius: 999, border: '1px solid ' + colors.border, background: colors.soft, color: 'inherit', cursor: 'pointer', fontSize: 12 },
                          title: '移除',
                          onClick: () => setPending((list) => list.filter((_, i) => i !== index))
                        }, '×')
                      )))
                  : null,
                h('div', { style: styles.composerRow },
                  h('input', {
                    ref: fileRef,
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/webp,image/gif',
                    multiple: true,
                    style: { display: 'none' },
                    onChange: (event) => { uploadFiles(event.target.files); event.target.value = ''; }
                  }),
                  h('button', {
                    style: { ...styles.iconBtn, opacity: !sessionId || sending || isLive ? .35 : .6 },
                    disabled: !sessionId || sending || isLive,
                    title: isLive ? '当前对话是 QQ 会话，暂不支持从面板发图' : '添加图片（也可粘贴、拖入）',
                    onClick: () => fileRef.current && fileRef.current.click()
                  }, h(ImageIcon)),
                  h('input', {
                    ref: voiceRef,
                    type: 'file',
                    accept: 'audio/*',
                    style: { display: 'none' },
                    onChange: (event) => { uploadVoice(event.target.files && event.target.files[0]); event.target.value = ''; }
                  }),
                  h('button', {
                    style: styles.iconBtn,
                    title: '上传一段语音到本地库',
                    onClick: () => voiceRef.current && voiceRef.current.click()
                  }, h(MicIcon)),
                  h('textarea', {
                    style: styles.textarea,
                    rows: 1,
                    value: draft,
                    placeholder: sessionId
                    ? (isLive ? `和${shell.role || '她'}说点什么…（面板直发，不发 QQ）` : `和${shell.role || '她'}说点什么…`)
                    : '先新建一个会话',
                    disabled: !sessionId || sending,
                    onChange: (event) => setDraft(event.target.value),
                    onPaste: (event) => {
                      const files = event.clipboardData && event.clipboardData.files;
                      if (files && files.length) { event.preventDefault(); uploadFiles(files); }
                    },
                    onDragOver: (event) => event.preventDefault(),
                    onDrop: (event) => { event.preventDefault(); uploadFiles(event.dataTransfer && event.dataTransfer.files); },
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
                    }
                  }),
                  h('button', {
                    style: { ...styles.sendBtn, opacity: !sessionId || sending ? .4 : 1 },
                    disabled: !sessionId || sending,
                    title: '发送',
                    onClick: send
                  }, h(SendIcon))
                ),
                h('div', { style: styles.hintRow },
                  h('span', null, isLive ? '面板直发 · 经 bridge 进同一会话，不发 QQ' : memoryLine + (lastAssistant && lastAssistant.model ? ' · ' + lastAssistant.model : '')),
                  h('span', null, 'Enter 发送 · Shift+Enter 换行')
                )
              )
            ),
            h('div', { style: styles.bar },
              h('span', null, 'QQ 通道'),
              h('span', { style: styles.chip }, inbox.length ? '入站 ' + inbox.length + ' 条' : '无入站'),
              h('button', {
                style: { ...styles.button, padding: '2px 8px', fontSize: 11 },
                onClick: simulateInbound
              }, '模拟入站'),
              h('span', { style: { flex: '1 1 auto' } }),
              voiceNote ? h('span', null, voiceNote) : null,
              h('button', {
                style: { ...styles.button, padding: '2px 8px', fontSize: 11 },
                onClick: () => setShowVoices((value) => !value)
              }, showVoices ? '收起语音库' : '语音库')
            ),
            showVoices
              ? h('div', { style: { padding: '0 16px 12px' } },
                  h(VoiceCard, { items: voices, onQueue: queueVoice, onRefresh: loadVoices, note: '' })
                )
              : null
          )
        )
      );
    }

    function dayOf(at) {
      if (!at) return '未知日期';
      const d = new Date(at);
      if (Number.isNaN(d.getTime())) return '未知日期';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function clockOf(at) {
      if (!at) return '';
      const d = new Date(at);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    const KIND_LABEL = { qq: 'QQ', panel: '面板', bot: '笔记' };

    function HistoryTab() {
      const [sessions, setSessions] = React.useState([]);
      const [sessionId, setSessionId] = React.useState('');
      const [items, setItems] = React.useState([]);
      const [total, setTotal] = React.useState(0);
      const [hasMore, setHasMore] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [applied, setApplied] = React.useState('');
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [meta, setMeta] = React.useState(null);
      const listRef = React.useRef(null);
      const prevHeightRef = React.useRef(0);
      const stickBottomRef = React.useRef(true);

      const loadSessions = React.useCallback(() => {
        apiFetch('/api/dsmp/history/sessions?limit=60', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || '读取会话列表失败');
            const list = data.items || [];
            setSessions(list);
            // 默认看「QQ 全部会话」：轮转把记录拆成多份后，单会话看起来会缺。
            const preferred = list.find((row) => row.bound) || list[0];
            setSessionId((current) => current || (preferred ? '__qq__' : ''));
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      }, []);

      const loadPage = React.useCallback((target, before, text) => {
        if (!target) return;
        setLoading(true);
        setError(null);
        const el = listRef.current;
        if (el) prevHeightRef.current = el.scrollHeight;
        if (!before) stickBottomRef.current = true;
        const merged = target === '__qq__';
        const params = merged
          ? new URLSearchParams({ scope: 'qq', limit: '40' })
          : new URLSearchParams({ sessionId: target, limit: '40' });
        if (before) params.set('before', before);
        if (text) params.set('q', text);
        apiFetch('/api/dsmp/history?' + params.toString(), { cache: 'no-store' })
          .then(async (res) => {
            const data = await res.json();
            if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || ('HTTP ' + res.status));
            setTotal(data.total || 0);
            setHasMore(Boolean(data.hasMore));
            setMeta({ frames: data.frames, truncated: data.truncated, sessionId: data.sessionId, merged: data.merged, sessions: (data.sessions || []).length });
            setItems((current) => (before ? [...data.items, ...current] : data.items));
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)))
          .finally(() => setLoading(false));
      }, []);

      React.useEffect(() => { loadSessions(); }, [loadSessions]);
      React.useEffect(() => {
        if (sessionId) loadPage(sessionId, '', applied);
      }, [sessionId, applied, loadPage]);

      const groups = React.useMemo(() => {
        const out = [];
        for (const item of items) {
          const day = dayOf(item.at);
          const last = out[out.length - 1];
          if (last && last.day === day) last.items.push(item);
          else out.push({ day, items: [item] });
        }
        return out;
      }, [items]);

      React.useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        if (stickBottomRef.current) {
          el.scrollTop = el.scrollHeight;
          stickBottomRef.current = false;
          return;
        }
        const delta = el.scrollHeight - prevHeightRef.current;
        if (delta > 0) el.scrollTop += delta;
      }, [items]);

      return h('div', { style: styles.body },
        h('div', { style: styles.toolbar },
          h('select', {
            style: { ...styles.input, flex: '1 1 240px' },
            value: sessionId,
            onChange: (event) => setSessionId(event.target.value)
          }, [
            h('option', { key: '__qq__', value: '__qq__' }, 'QQ 全部会话（合并）'),
            ...sessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
              `${s.sessionId.slice(-8)} · ${(s.cwd || '').split(/[\\/]/).slice(-1)[0] || '未知目录'}${s.bound ? ' · 当前' : ''}${s.test ? ' · 测试' : ''}`))
          ]),
          h('input', {
            style: { ...styles.input, flex: '1 1 180px' },
            placeholder: '搜索这段话…',
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') setApplied(query.trim()); }
          }),
          h('button', { style: styles.button, onClick: () => setApplied(query.trim()) }, '搜索'),
          applied ? h('button', {
            style: styles.button,
            onClick: () => { setQuery(''); setApplied(''); }
          }, '清除') : null
        ),
        h('div', { style: styles.status },
          meta
            ? (meta.merged
              ? `共 ${total} 条 · 合并 ${meta.sessions} 个会话${applied ? ` · 匹配「${applied}」` : ''}`
              : `共 ${total} 条 · ${meta.frames} 帧${meta.truncated ? ' · 末尾未写完' : ''}${applied ? ` · 匹配「${applied}」` : ''}`)
            : (sessions.length ? '读取中…' : '没有会话记录')
        ),
        h('div', {
          ref: listRef,
          onScroll: (event) => {
            const el = event.target;
            if (el.scrollTop < 80 && hasMore && !loading) {
              loadPage(sessionId, items.length ? items[0].id : '', applied);
            }
          },
          style: styles.list
        },
          hasMore
            ? h('div', { style: { display: 'flex', justifyContent: 'center', padding: '6px 0 10px', fontSize: 11, opacity: .5 } },
                loading ? '正在加载更早的消息…' : '↑ 向上滚动加载更早的消息')
            : h('div', { style: { padding: '4px 0 10px', fontSize: 11, opacity: .32, textAlign: 'center' } }, '已经到最早一条'),
          groups.map((group) => h('div', { key: group.day },
            h('div', { style: styles.dayDivider }, group.day),
            group.items.map((item) => h('div', {
              key: item.id,
              style: {
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                margin: '6px 0',
                justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start'
              }
            },
              h('div', { style: { ...styles.metaColumn, textAlign: item.role === 'user' ? 'right' : 'left' } },
                h('div', null, clockOf(item.at))
              ),
              h('div', {
                style: {
                  ...bubbleStyle(item.role),
                  maxWidth: '72%'
                }
              },
                item.displayText ? h('div', { style: { whiteSpace: 'pre-wrap' } }, item.displayText) : null,
                item.images && item.images.length
                  ? h(ImageStrip, { images: item.images, text: item.displayText })
                  : null
              )
            ))
          )),
          !items.length && !loading ? h('div', { style: styles.empty }, sessions.length ? '没有匹配的消息' : '还没有会话记录') : null
        ),
        error ? h('div', { style: styles.error }, error) : null
      );
    }

    const MEMORY_VIEWS = [
      ['overview', '概览'],
      ['card', '事实卡'],
      ['facts', '长期事实'],
      ['context', '上下文与轮转'],
      ['sessions', '会话与策略'],
      ['config', '生效配置'],
      ['window', '窗口回放'],
      ['episodes', '情境索引'],
      ['topics', '主题簇'],
      ['recall', '检索调试'],
      ['usage', '消费账单'],
      ['media', '媒体墙'],
      ['graph', '记忆星图'],
      ['export', '导出'],
      ['folds', '折叠记录'],
      ['claims', '待确认'],
      ['disputes', '待裁决'],
      ['activation', '激活开关'],
      ['monthly', '月摘要']
    ];

    // 左侧导航分组：星图置顶（最常用），其余 运行 → 记忆 → 工具，和旧 7351 的侧栏观感一致。
    const MEMORY_GROUPS = [
      ['', ['graph']],
      ['运行', ['overview', 'context', 'sessions', 'config', 'folds']],
      ['记忆', ['card', 'facts', 'topics', 'window', 'episodes', 'usage', 'monthly']],
      ['工具', ['recall', 'media', 'export', 'claims', 'disputes', 'activation']]
    ];

    const WB_STYLE_ID = 'dsmp-workbench-style';

    // 记忆页签容器：同样只把颜色变量映射到 DSH 主题令牌，深浅色由系统主题
    // 自动切换（不再自己维护两套硬编码色板）。
    const WB_CSS = `
.dsmp-wb {
  --wb-bg: var(--dsw-alias-bg-base, #0e1014);
  --wb-panel: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-1, #151920));
  --wb-panel2: var(--dsw-alias-bg-layer-2, #1a1f28);
  --wb-line: var(--dsw-alias-border-l1, #242b36);
  --wb-line-strong: var(--dsw-alias-border-l2, #2f3846);
  --wb-text: var(--dsw-alias-label-primary, #e7eaf0);
  --wb-muted: var(--dsw-alias-label-secondary, #a3adbe);
  --wb-dim: var(--dsw-alias-label-tertiary, #8892a4);
  --wb-accent: var(--dsw-alias-brand-primary, #4cc2a6);
  --wb-accent-soft: var(--dsw-alias-interactive-bg-hover-accent, rgba(76,194,166,.14));
  --wb-on-accent: var(--dsw-alias-label-primary-foreground, #0e1014);
  --wb-warn: var(--dsw-alias-state-warn-primary, #e3b341);
  --wb-bad: var(--dsw-alias-state-error-primary, #e06c75);
  --wb-ok: var(--dsw-alias-state-success-primary, #4cc38a);
  --wb-hover: var(--dsw-alias-interactive-bg-hover, #1f2531);
  --wb-soft: var(--dsw-alias-fill-muted, rgba(76,194,166,.03));
  --wb-shadow: var(--dsw-elevation-prominent, 0 1px 0 rgba(0,0,0,.25));
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
}
.dsmp-wb ::-webkit-scrollbar { width: 10px; height: 10px; }
.dsmp-wb ::-webkit-scrollbar-thumb { background: var(--wb-line-strong); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.dsmp-wb ::-webkit-scrollbar-track { background: transparent; }
.dsmp-wb button:hover { background: var(--wb-hover); }
.dsmp-wb table { font-variant-numeric: tabular-nums; }
.dsmp-wb .wb-mono { font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace; }
`;

    function useWorkbenchStyle() {
      React.useEffect(() => {
        if (document.getElementById(WB_STYLE_ID)) return;
        const tag = document.createElement('style');
        tag.id = WB_STYLE_ID;
        tag.textContent = WB_CSS;
        document.head.appendChild(tag);
      }, []);
    }

    // ---- 星图：从旧 7351 starmap.js 移植的 canvas 3D 力导向图 ----
    // 只有这一块用 canvas；数据仍来自服务端 graphView（事实/人物/主题/日期 + links）。
    const STAR_PAL = {
      hard: '#7fe3c3', long: '#7fb4ff', general: '#e2c886', temp: '#9aa2ad',
      person: '#ffa06a', topic: '#a7c0d4', date: '#c9a7ff'
    };
    const STAR_TIER_COLORS = { hard: '#0f7a63', long: '#2f6f9f', general: '#8a6d2f', temp: '#8a8f98' };

    function starSeed(nodes) {
      const n = nodes.length || 1;
      nodes.forEach((node, i) => {
        const k = i + 1;
        const r = 120 + 40 * Math.cbrt(k);
        const phi = Math.acos(1 - (2 * k) / (n + 1));
        const theta = Math.PI * (1 + Math.sqrt(5)) * k;
        node.x = r * Math.sin(phi) * Math.cos(theta);
        node.y = r * Math.cos(phi) * 0.82;
        node.z = r * Math.sin(phi) * Math.sin(theta);
        node.vx = node.vy = node.vz = 0;
      });
    }

    function starStep(nodes, links, maxR) {
      const L = 128;
      const K = 5200;
      const G = 0.0012;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dz = a.z - b.z;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            dz = (Math.random() - 0.5) * 2;
            d2 = dx * dx + dy * dy + dz * dz || 1;
          }
          const d = Math.sqrt(d2);
          const f = (K / Math.max(L, d2)) * G;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          const fz = (dz / d) * f;
          a.vx += fx; a.vy += fy; a.vz += fz;
          b.vx -= fx; b.vy -= fy; b.vz -= fz;
        }
      }
      for (const link of links) {
        const a = link.a;
        const b = link.b;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const f = 0.01;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
        b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
      for (const node of nodes) {
        node.vx *= 0.87; node.vy *= 0.87; node.vz *= 0.87;
        const v = Math.hypot(node.vx, node.vy, node.vz);
        if (v > 14) {
          const s = 14 / v;
          node.vx *= s; node.vy *= s; node.vz *= s;
        }
        node.x += node.vx; node.y += node.vy; node.z += node.vz;
        const r = Math.hypot(node.x, node.y, node.z);
        const limit = node.type === 'date' ? maxR * 0.98 : maxR;
        if (r > limit) {
          const s = limit / r;
          node.x *= s; node.y *= s; node.z *= s;
        }
        if (node.type === 'date') {
          // 日期节点钉在外壳上，形成一个「截止日」的壳层
          const rr = Math.hypot(node.x, node.y, node.z) || 1;
          node.x = (node.x / rr) * maxR * 0.86;
          node.y = (node.y / rr) * maxR * 0.86;
          node.z = (node.z / rr) * maxR * 0.1;
        }
      }
    }

    function buildStarSim(data) {
      const nodes = (data.nodes || []).map((node) => ({ ...node }));
      const ids = new Map(nodes.map((node) => [node.id, node]));
      const links = (data.links || [])
        .map((link) => ({ ...link, a: ids.get(link.a), b: ids.get(link.b) }))
        .filter((link) => link.a && link.b);
      starSeed(nodes);
      let maxR = 180;
      for (let i = 0; i < 240; i += 1) {
        starStep(nodes, links, maxR);
        if (i === 60) maxR = nodes.reduce((sum, node) => Math.max(sum, Math.hypot(node.x, node.y, node.z)), 120);
      }
      maxR = nodes.reduce((sum, node) => Math.max(sum, Math.hypot(node.x, node.y, node.z)), 120);
      return { nodes, links, ids, maxR: Math.max(160, maxR), signature: `${nodes.length}:${nodes[0] ? nodes[0].id : ''}` };
    }

    const STAR_STARS = (() => {
      const out = [];
      let seed = 20261111;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      };
      for (let i = 0; i < 1200; i += 1) {
        out.push({ x: rnd(), y: rnd(), r: 0.2 + rnd() * 1.1, a: 0.08 + rnd() * 0.5 });
      }
      return out;
    })();

    function StarMap(props) {
      const data = props.data || {};
      const onPick = props.onPick;
      const wrapRef = React.useRef(null);
      const canvasRef = React.useRef(null);
      const simRef = React.useRef(null);
      const viewRef = React.useRef({ yaw: 0.25, pitch: -0.18, zoom: 1, auto: true, idleAt: 0, hover: null, drag: false, lastX: 0, lastY: 0 });
      const [maxed, setMaxed] = React.useState(false);
      const [auto, setAuto] = React.useState(true);
      const [filter, setFilter] = React.useState('all');
      const [detail, setDetail] = React.useState(null);
      const [meta, setMeta] = React.useState({ shown: 0, links: 0 });

      React.useEffect(() => { viewRef.current.auto = auto; }, [auto]);

      React.useEffect(() => {
        if (!maxed) return undefined;
        const onKey = (ev) => { if (ev.key === 'Escape') setMaxed(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [maxed]);

      React.useEffect(() => {
        const sim = buildStarSim(data);
        simRef.current = sim;
        setMeta((prev) => (prev.shown === sim.nodes.length && prev.links === sim.links.length
          ? prev
          : { shown: sim.nodes.length, links: sim.links.length }));
      }, [data]);

      React.useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return undefined;
        const ctx = canvas.getContext('2d');
        let raf = 0;
        let disposed = false;

        const resize = () => {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const w = Math.max(280, wrap.clientWidth || 600);
          const h = Math.max(320, wrap.clientHeight || 560);
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);

        const visibleOf = () => {
          const sim = simRef.current;
          if (!sim) return { nodes: [], links: [] };
          if (filter === 'all') return sim;
          const keep = new Set();
          for (const node of sim.nodes) {
            if (node.type !== 'fact') continue;
            const isHard = node.tier === 'hard';
            const isTask = /待办|计划|截止|提醒|要做/.test(`${node.value || ''}${node.label || ''}`);
            if ((filter === 'hard' && isHard) || (filter === 'task' && isTask)) keep.add(node.id);
          }
          for (const link of sim.links) {
            if (keep.has(link.a.id) || keep.has(link.b.id)) {
              keep.add(link.a.id);
              keep.add(link.b.id);
            }
          }
          return { nodes: sim.nodes.filter((node) => keep.has(node.id)), links: sim.links };
        };

        const draw = () => {
          if (disposed) return;
          const sim = simRef.current;
          const view = viewRef.current;
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          const now = performance.now();
          if (view.auto && !view.drag && now - view.idleAt > 1200) view.yaw += 0.0022;
          const cosY = Math.cos(view.yaw);
          const sinY = Math.sin(view.yaw);
          const cosP = Math.cos(view.pitch);
          const sinP = Math.sin(view.pitch);
          const viewK = Math.max(0.6, Math.min(2.4, Math.min(w, h) / 620));
          const f = 900;
          const sphereR = Math.max(160, Math.min(900, (sim ? sim.maxR : 220) * 0.46 / viewK));
          const scale = (Math.min(w, h) * 0.42) / sphereR;
          const cx = w / 2;
          const cy = h * 0.46;
          // 背景
          const bg = ctx.createRadialGradient(cx, cy * 0.82, 20, cx, cy, Math.max(w, h) * 0.72);
          bg.addColorStop(0, '#0b1119');
          bg.addColorStop(0.6, '#070b11');
          bg.addColorStop(1, '#04060a');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          for (const star of STAR_STARS) {
            ctx.globalAlpha = star.a;
            ctx.fillStyle = '#cfe3ff';
            ctx.beginPath();
            ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          if (!sim) return;
          const visible = visibleOf();
          const shown = new Set(visible.nodes.map((node) => node.id));
          const project = (node) => {
            const x1 = node.x * cosY - node.z * sinY;
            const z1 = node.x * sinY + node.z * cosY;
            const y1 = node.y * cosP - z1 * sinP;
            const z2 = node.y * sinP + z1 * cosP;
            const s = (f / Math.max(120, f + z2)) * view.zoom * viewK * scale;
            return { x: cx + x1 * s, y: cy + y1 * s, z: z2, s };
          };
          const points = new Map();
          for (const node of visible.nodes) points.set(node.id, project(node));
          // 垂直重心校正：按事实节点的投影均值，把星云挪到画布 44% 高度。
          // 只靠固定 cy 会因力导向分布/自转视角而整体偏下，这里每帧按实际投影对齐。
          let shiftY = 0;
          const factYs = [];
          for (const [id, p] of points) {
            const node = sim.ids && sim.ids.get(id);
            if (node && node.type === 'fact') factYs.push(p.y);
          }
          if (factYs.length) {
            shiftY = h * 0.44 - factYs.reduce((a, b) => a + b, 0) / factYs.length;
            for (const p of points.values()) p.y += shiftY;
          }
          view.shiftY = shiftY;
          // 连线
          for (const link of sim.links) {
            if (!points.has(link.a.id) || !points.has(link.b.id)) continue;
            const a = points.get(link.a.id);
            const b = points.get(link.b.id);
            const hot = view.hover && (view.hover === link.a.id || view.hover === link.b.id);
            const depth = Math.max(0, Math.min(1, (a.z + b.z) / (2 * 600) + 0.5));
            ctx.strokeStyle = hot ? 'rgba(124,227,195,.75)' : `rgba(124,170,210,${0.035 + depth * 0.4})`;
            ctx.lineWidth = hot ? 1.4 : 0.8;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - Math.min(40, Math.hypot(b.x - a.x, b.y - a.y) * 0.08);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(mx, my, b.x, b.y);
            ctx.stroke();
          }
          // 节点（按 z 排序，远的先画）
          const order = [...visible.nodes].sort((a, b) => points.get(b.id).z - points.get(a.id).z);
          for (const node of order) {
            const p = points.get(node.id);
            const hovered = view.hover === node.id;
            const base = node.type === 'fact' ? Math.max(4, Math.min(12, (Number(node.size) || 10) * 0.55)) : (Number(node.size) || 14) * 0.5;
            const radius = Math.max(0.8, Math.min(6.5, base * 0.28 * (hovered ? 1.9 : 1)));
            const color = node.type === 'person' || node.type === 'topic' || node.type === 'date'
              ? STAR_PAL[node.type]
              : (STAR_PAL[node.tier] || STAR_TIER_COLORS[node.tier] || '#9aa2ad');
            if (node.type === 'person' || node.type === 'date' || hovered) {
              ctx.beginPath();
              ctx.fillStyle = hovered ? 'rgba(124,227,195,.22)' : 'rgba(160,200,230,.12)';
              ctx.arc(p.x, p.y, radius * 3.4, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = node.expired || node.invalid ? 0.38 : 1;
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            const showLabel = node.type === 'person' || node.type === 'topic' || node.type === 'date' || hovered;
            if (showLabel) {
              ctx.font = `${hovered ? 11.5 : 9.5}px ui-monospace, SFMono-Regular, Consolas, monospace`;
              ctx.fillStyle = hovered ? '#e7eaf0' : 'rgba(200,214,232,.72)';
              ctx.textAlign = 'center';
              ctx.fillText(String(node.label || '').slice(0, 14), p.x, p.y - radius - 4);
            }
          }
          // hover 命中提示
          if (view.hover) {
            const node = sim.ids && sim.ids.get(view.hover);
            if (node) {
              const p = points.get(node.id);
              if (p) {
                ctx.font = '11px system-ui, sans-serif';
                ctx.fillStyle = 'rgba(231,234,240,.92)';
                ctx.textAlign = 'left';
                ctx.fillText(`${node.label || node.id} · ${node.tier || node.type}${node.score != null ? ` · ${Math.round(node.score)}` : ''}`, p.x + 10, p.y + 4);
              }
            }
          }
        };

        const loop = () => {
          draw();
          raf = requestAnimationFrame(loop);
        };
        loop();

        const pointAt = (ev) => {
          const rect = canvas.getBoundingClientRect();
          return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        };
        const hitTest = (x, y) => {
          const sim = simRef.current;
          if (!sim) return null;
          const view = viewRef.current;
          const w = canvas.clientWidth;
          const h = canvas.clientHeight;
          const viewK = Math.max(0.6, Math.min(2.4, Math.min(w, h) / 620));
          const sphereR = Math.max(160, Math.min(900, sim.maxR * 0.46 / viewK));
          const scale = (Math.min(w, h) * 0.42) / sphereR;
          const cx = w / 2;
          const cy = h * 0.46;
          const cosY = Math.cos(view.yaw);
          const sinY = Math.sin(view.yaw);
          const cosP = Math.cos(view.pitch);
          const sinP = Math.sin(view.pitch);
          let best = null;
          for (const node of sim.nodes) {
            const x1 = node.x * cosY - node.z * sinY;
            const z1 = node.x * sinY + node.z * cosY;
            const y1 = node.y * cosP - z1 * sinP;
            const z2 = node.y * sinP + z1 * cosP;
            const s = (900 / Math.max(120, 900 + z2)) * view.zoom * viewK * scale;
            const px = cx + x1 * s;
            const py = cy + y1 * s + (view.shiftY || 0);
            if (Math.hypot(px - x, py - y) < 22) {
              if (!best || z2 < best.z) best = { node, z: z2 };
            }
          }
          return best && best.node;
        };

        const onDown = (ev) => {
          const view = viewRef.current;
          view.drag = true;
          view.lastX = ev.clientX;
          view.lastY = ev.clientY;
          view.idleAt = performance.now();
          canvas.setPointerCapture(ev.pointerId);
        };
        const onMove = (ev) => {
          const view = viewRef.current;
          if (view.drag) {
            const dx = ev.clientX - view.lastX;
            const dy = ev.clientY - view.lastY;
            view.yaw -= dx * 0.006;
            view.pitch = Math.max(-1.15, Math.min(1.15, view.pitch + dy * 0.005));
            view.lastX = ev.clientX;
            view.lastY = ev.clientY;
            view.idleAt = performance.now();
            return;
          }
          const p = pointAt(ev);
          const node = hitTest(p.x, p.y);
          const view2 = viewRef.current;
          view2.hover = node ? node.id : null;
          canvas.style.cursor = node ? 'pointer' : 'grab';
        };
        const onUp = (ev) => {
          const view = viewRef.current;
          const moved = Math.hypot(ev.clientX - view.lastX, ev.clientY - view.lastY);
          view.drag = false;
          view.idleAt = performance.now();
          if (moved > 4) return;
          const p = pointAt(ev);
          const node = hitTest(p.x, p.y);
          if (!node) return;
          setDetail(node);
          if (node.type === 'fact' && node.factId && onPick) onPick(node.factId);
        };
        const onWheel = (ev) => {
          ev.preventDefault();
          const view = viewRef.current;
          view.zoom = Math.max(0.45, Math.min(2.4, view.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
          view.idleAt = performance.now();
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        const onLeave = () => { viewRef.current.hover = null; };
        canvas.addEventListener('pointerleave', onLeave);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => {
          disposed = true;
          cancelAnimationFrame(raf);
          ro.disconnect();
          canvas.removeEventListener('pointerdown', onDown);
          canvas.removeEventListener('pointermove', onMove);
          canvas.removeEventListener('pointerup', onUp);
          canvas.removeEventListener('pointerleave', onLeave);
          canvas.removeEventListener('wheel', onWheel);
        };
      }, [data, filter, auto, maxed, onPick]);

      const reload = () => {
        simRef.current = buildStarSim(data);
        setMeta({ shown: (data.nodes || []).length, links: (data.links || []).length });
      };
      const boxStyle = maxed
        ? { position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--wb-bg, #0e1014)', padding: 18, display: 'flex', flexDirection: 'column', borderRadius: 0, overflow: 'hidden' }
        : { ...styles.card, padding: 0, overflow: 'hidden' };
      return h('div', { style: boxStyle },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '12px 14px', borderBottom: `1px solid ${colors.border}` } },
          h('button', { style: styles.linkBtn, onClick: reload }, '重排'),
          h('button', {
            style: auto ? styles.linkBtnOn : styles.linkBtn,
            onClick: () => { setAuto(!auto); viewRef.current.idleAt = performance.now(); }
          }, auto ? '自转 ✓' : '自转'),
          h('select', {
            style: { ...styles.input, width: 130, height: 30, padding: '3px 8px' },
            value: filter,
            onChange: (e) => setFilter(e.target.value)
          },
            h('option', { value: 'all' }, '全部事实'),
            h('option', { value: 'hard' }, '只看硬事实'),
            h('option', { value: 'task' }, '待办/计划')),
          h('div', { style: { flex: '1 1 auto' } }),
          h('div', { style: styles.wbTopHint }, `${meta.shown} 颗星 · ${meta.links} 条引力线`),
          h('button', { style: styles.linkBtn, onClick: () => setMaxed(!maxed) }, maxed ? '退出全屏' : '全屏')
        ),
        h('div', { ref: wrapRef, style: maxed ? { flex: '1 1 auto', minHeight: 0 } : { height: 'clamp(380px, 56vh, 560px)' } },
          h('canvas', { ref: canvasRef, style: { display: 'block', width: '100%', height: '100%', touchAction: 'none' } })
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '8px 14px', borderTop: `1px solid ${colors.border}`, fontSize: 11 } },
          ...['hard', 'long', 'general', 'temp'].map((tier) => h('span', { key: tier, style: { display: 'inline-flex', alignItems: 'center', gap: 5, opacity: .8 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 999, background: STAR_PAL[tier], display: 'inline-block' } }),
            ({ hard: '硬事实', long: '长期', general: '一般', temp: '临时' })[tier])),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, opacity: .8 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 999, background: STAR_PAL.person, display: 'inline-block' } }), '人物'),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, opacity: .8 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 999, background: STAR_PAL.topic, display: 'inline-block' } }), '主题'),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, opacity: .8 } },
            h('span', { style: { width: 8, height: 8, borderRadius: 999, background: STAR_PAL.date, display: 'inline-block' } }), '截止日'),
          h('span', { style: { ...styles.wbTopHint, marginLeft: 'auto' } }, detail
            ? `${detail.label || detail.id}${detail.tier ? ` · ${detail.tier}` : ''}${detail.score != null ? ` · ${Math.round(detail.score)}` : ''}（点击事实节点看详情）`
            : '拖拽旋转 · 滚轮缩放 · 点节点看详情')
        ),
        maxed ? null : h('div', { style: { padding: '0 14px 12px' } },
          h('div', { style: { ...styles.wbTopHint, lineHeight: 1.7 } },
            '颜色按档位：青 hard、蓝 long、褐 general、灰 temp；橙是人、浅蓝是主题、紫是截止日。'
            + '布局用球面斥力 + 连线弹簧，日期节点钉在外壳上。'))
      );
    }

    function MemoryTab(props) {
      const onRefresh = props.onRefresh;
      const pending = (props.status && props.status.disputes && props.status.disputes.pending) || 0;
      const [view, setView] = React.useState('overview');
      const [windowFocus, setWindowFocus] = React.useState(null);
      const [data, setData] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const [error, setError] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [applied, setApplied] = React.useState('');
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState('');
      const [editing, setEditing] = React.useState(null);
      const [history, setHistory] = React.useState(null);
      const [factFilter, setFactFilter] = React.useState('all');
      const [factLimit, setFactLimit] = React.useState(50);
      const [windowSessions, setWindowSessions] = React.useState([]);
      const [factDetail, setFactDetail] = React.useState(null);
      const [cardChars, setCardChars] = React.useState(1500);
      const [mediaKind, setMediaKind] = React.useState('image');
      const [exportWindow, setExportWindow] = React.useState(false);
      const [recallLimit, setRecallLimit] = React.useState(10);
      const [floorDraft, setFloorDraft] = React.useState('');
      const [billDays, setBillDays] = React.useState(14);
      const [billScope, setBillScope] = React.useState('all');
      const [billSession, setBillSession] = React.useState('all');
      const [billTurn, setBillTurn] = React.useState('all');
      const [configDraft, setConfigDraft] = React.useState(null);
      const [policyKey, setPolicyKey] = React.useState('');
      const etagRef = React.useRef('');
      useWorkbenchStyle();

      const load = React.useCallback((target, text) => {
        setLoading(true);
        setError('');
        const parts = [];
        if (target === 'recall') {
          parts.push(`q=${encodeURIComponent(text || '')}`, `limit=${recallLimit}`);
        } else if (target === 'window') {
          if (windowFocus && windowFocus.sessionId) {
            parts.push(`sessionId=${encodeURIComponent(windowFocus.sessionId)}`);
            if (Number(windowFocus.from) > 0) parts.push(`from=${windowFocus.from}`);
            if (Number(windowFocus.to) > 0) parts.push(`to=${windowFocus.to}`);
          }
          parts.push('limit=200');
        } else if (target === 'card') {
          parts.push(`maxChars=${cardChars}`);
        } else if (target === 'media') {
          parts.push(`kind=${mediaKind}`, 'limit=60');
        } else if (target === 'export') {
          parts.push(`window=${exportWindow ? 1 : 0}`);
        } else if (target === 'usage') {
          parts.push(`days=${billDays}`, `scope=${encodeURIComponent(billScope)}`, `session=${encodeURIComponent(billSession)}`, `turn=${encodeURIComponent(billTurn)}`);
        }
        const extra = parts.length ? `&${parts.join('&')}` : '';
        apiFetch(`/api/dsmp/workbench?view=${target}${extra}`, { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || !body || body.ok === false) throw new Error((body && body.error) || `HTTP ${res.status}`);
            etagRef.current = body.etag || '';
            setData(body);
          })
          .catch((err) => { setData(null); setError(String(err && err.message ? err.message : err)); })
          .finally(() => setLoading(false));
      }, [windowFocus, recallLimit, cardChars, mediaKind, exportWindow, billDays, billScope, billSession, billTurn]);

      const write = React.useCallback(async (body) => {
        setBusy(body.id || body.action || 'write');
        setNote('');
        try {
          const res = await apiFetch('/api/dsmp/workbench/write', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, ifMatch: etagRef.current || undefined })
          });
          const out = await res.json();
          if (res.status === 409 && out && out.code === 'DSMP_STALE') {
            setNote('数据已更新，已刷新');
            load(view, applied);
            return null;
          }
          if (!res.ok || out.ok === false) throw new Error(out.error || `HTTP ${res.status}`);
          const noteOf = {
            claims: '已处理这条候选',
            dispute: '已裁决',
            'desired-save': '草稿已保存（只留在面板，未写桥接）',
            apply: '已写入桥接配置（默认等下次重启生效）'
          };
          setNote(noteOf[body.action] || '已写入记忆');
          load(view, applied);
          if (body.action === 'dispute' && onRefresh) onRefresh();
          return out;
        } catch (err) {
          setError(String(err && err.message ? err.message : err));
          return null;
        } finally {
          setBusy('');
        }
      }, [view, applied, load, onRefresh]);

      React.useEffect(() => { load(view, applied); }, [view, applied, load]);

      // The window view needs the session list to switch between conversations;
      // it is one extra small request and is cached for the lifetime of the tab.
      React.useEffect(() => {
        if (view !== 'window' || windowSessions.length) return;
        apiFetch('/api/dsmp/workbench?view=window-sessions', { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setWindowSessions(body.sessions || []);
          })
          .catch(() => {});
      }, [view, windowSessions.length]);

      React.useEffect(() => { setFactDetail(null); }, [view]);

      // 生效配置：服务端 desired 是「桥接配置 + 面板草稿」的合并结果，进入视图时
      // 拷一份到本地 draft，只有点保存才写 desired 文件。
      React.useEffect(() => {
        if (view === 'config' && data && data.desired) setConfigDraft(data.desired);
      }, [view, data]);

      function openFactDetail(id) {
        apiFetch(`/api/dsmp/workbench?view=fact&id=${encodeURIComponent(id)}`, { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setFactDetail(body);
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)));
      }

      function renderFacts(d) {
        const rows = d.rows || [];
        if (!rows.length) return h('div', { style: styles.empty }, '还没有长期事实。');
        const grades = d.grades || {};
        const filters = [
          ['all', `全部 ${d.count}`],
          ['core', `核心 ${grades.core || 0}`],
          ['important', `重要 ${grades.important || 0}`],
          ['normal', `一般 ${grades.normal || 0}`],
          ['expired', `旧事 ${d.expired || 0}`],
          ['invalidated', `已作废 ${d.invalidated || 0}`]
        ];
        const filtered = rows.filter((row) => {
          if (factFilter === 'all') return true;
          if (factFilter === 'expired') return row.expired && !row.invalidated;
          if (factFilter === 'invalidated') return row.invalidated;
          if (row.expired || row.invalidated) return false;
          return row.grade === factFilter;
        });
        const shown = filtered.slice(0, factLimit);
        return h('div', null,
          h('div', { style: styles.dim },
            `共 ${d.count} 条 · 现存 ${d.active} · 核心 ${grades.core || 0} · 重要 ${grades.important || 0} · 一般 ${grades.normal || 0} · 旧事 ${d.expired || 0} · 已作废 ${d.invalidated || 0}`),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' } },
            ...filters.map(([key, label]) => h('button', {
              key,
              style: factFilter === key ? styles.linkBtnOn : styles.linkBtn,
              onClick: () => { setFactFilter(key); setFactLimit(50); }
            }, label))
          ),
          ...shown.map((row) => h('div', { key: row.id, style: styles.factRow },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
              h('span', {
                style: { flex: '0 0 auto', minWidth: 36, textAlign: 'center', borderRadius: 6, padding: '2px 4px', fontSize: 12, fontWeight: 600, color: '#101418', background: row.gradeColor || '#8a8f98' }
              }, String(Number(row.score) || 0)),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', null, row.value || row.text || row.id),
                h('div', { style: styles.dim },
                  `${row.gradeLabel || ''} · ${row.tier || '—'} · ${row.slotLabel || row.slot || '—'} · ${row.topicTitle || row.topicId || '—'} · ${row.author || '—'} · 提到 ${row.hits || 0} 次 · 最近 ${row.ageDays || 0} 天`
                    + (row.expired ? ' · 已过期' : '')
                    + (row.invalidated ? ' · 已作废' : '')
                    + (row.at ? ` · ${String(row.at).slice(0, 10)}` : '')
                )
              )
            ),
            editing && editing.id === row.id
              ? h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
                h('input', {
                  style: { ...styles.input, flex: 1, minWidth: 160 },
                  value: editing.value,
                  onChange: (e) => setEditing({ id: row.id, value: e.target.value, reason: editing.reason }),
                  placeholder: '新的值'
                }),
                h('input', {
                  style: { ...styles.input, flex: 1, minWidth: 120 },
                  value: editing.reason,
                  onChange: (e) => setEditing({ ...editing, reason: e.target.value }),
                  placeholder: '原因（可空）'
                }),
                h('button', { style: styles.linkBtnOn, disabled: busy === row.id, onClick: async () => {
                  const out = await write({ action: 'fact-edit', id: row.id, value: editing.value, reason: editing.reason });
                  if (out) setEditing(null);
                } }, '保存'),
                h('button', { style: styles.linkBtn, onClick: () => setEditing(null) }, '取消')
              )
              : h('div', { style: { display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' } },
                h('button', { style: styles.linkBtn, onClick: () => setEditing({ id: row.id, value: row.value || row.text || '', reason: '' }) }, '编辑'),
                row.invalidated
                  ? h('button', { style: styles.linkBtnOn, disabled: busy === row.id, onClick: () => write({ action: 'fact', id: row.id, op: 'reinstate' }) }, '恢复')
                  : h('button', { style: styles.linkBtnDanger, disabled: busy === row.id, onClick: () => write({ action: 'fact', id: row.id, op: 'invalidate', reason: '面板作废' }) }, '作废'),
                h('button', { style: styles.linkBtn, onClick: () => {
                  apiFetch(`/api/dsmp/workbench?view=history&id=${encodeURIComponent(row.id)}`, { cache: 'no-store' })
                    .then(async (res) => {
                      const body = await res.json();
                      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
                      setHistory({ id: row.id, items: body.items || [] });
                    })
                    .catch((err) => setError(String(err && err.message ? err.message : err)));
                } }, '历史'),
                h('button', { style: styles.linkBtn, onClick: () => openFactDetail(row.id) }, '详情'),
                h('select', {
                  style: { ...styles.linkBtnOn, padding: '1px 4px' },
                  value: '',
                  onChange: (e) => {
                    const tier = e.target.value;
                    if (tier) write({ action: 'fact', id: row.id, op: 'manual', tier, score: Number(row.score) || 50 });
                  },
                  title: '手动调档（非 hard 按档位半衰期衰减）'
                },
                  h('option', { value: '' }, '调档…'),
                  ...['hard', 'long', 'general', 'temp'].map((tier) => h('option', { key: tier, value: tier }, tier))
                ),
                h('button', { style: styles.linkBtn, onClick: () => {
                  const raw = window.prompt('调分（1-100）', String(row.score || 50));
                  const n = Number(raw);
                  if (Number.isFinite(n) && n >= 1 && n <= 100) write({ action: 'fact', id: row.id, op: 'manual', tier: row.tier || 'general', score: n });
                } }, '调分'),
                h('button', { style: styles.linkBtn, onClick: () => write({ action: 'fact', id: row.id, op: 'reset' }) }, '还原'),
                row.status === 'merged' ? h('button', { style: styles.linkBtn, onClick: () => write({ action: 'fact', id: row.id, op: 'unmerge' }) }, '拆开') : null
              ),
            history && history.id === row.id
              ? h('div', { style: { ...styles.card, marginTop: 6, padding: 8 } },
                h('div', { style: styles.dim }, `修订链 ${history.items.length} 条`),
                ...history.items.slice(-8).map((ev, i) => h('div', { key: i, style: { fontSize: 12, marginTop: 3 } },
                  `${String(ev.at || '').slice(0, 16).replace('T', ' ')} · ${ev.ev || '?'} · ${String(ev.value || '').slice(0, 60)}${ev.reason ? ` · ${ev.reason}` : ''}`
                )),
                h('button', { style: { ...styles.linkBtn, marginTop: 6 }, onClick: () => setHistory(null) }, '收起')
              )
              : null,
            factDetail && factDetail.id === row.id
              ? h('div', { style: { ...styles.card, marginTop: 6, padding: 8 } },
                h('div', { style: styles.dim },
                  `档位 ${(factDetail.fact && factDetail.fact.tier) || '—'} · 状态 ${factDetail.invalidated ? '已作废' : ((factDetail.fact && factDetail.fact.status) || 'active')}`
                    + ` · 分数 ${factDetail.importance && factDetail.importance.score != null ? factDetail.importance.score : '—'}`
                    + ` · I ${factDetail.fact && factDetail.fact.I != null ? factDetail.fact.I : '—'}`
                ),
                factDetail.importance
                  ? h('pre', { style: { ...styles.mono, whiteSpace: 'pre-wrap', margin: '6px 0 0', opacity: .78 } }, JSON.stringify(factDetail.importance, null, 1))
                  : null,
                factDetail.debug
                  ? h('pre', { style: { ...styles.mono, whiteSpace: 'pre-wrap', margin: '6px 0 0', opacity: .78 } }, JSON.stringify(factDetail.debug, null, 1))
                  : null,
                h('button', { style: { ...styles.linkBtn, marginTop: 6 }, onClick: () => setFactDetail(null) }, '收起')
              )
              : null
          )),
          filtered.length > shown.length
            ? h('button', { style: styles.linkBtn, onClick: () => setFactLimit(factLimit + 50) },
              `显示更多（还有 ${filtered.length - shown.length} 条）`)
            : null
        );
      }

      function renderDisputes(d) {
        const rows = d.items || [];
        if (!rows.length) return h('div', { style: styles.empty }, '没有待裁决的冲突。');
        return h('div', null,
          h('div', { style: styles.dim }, `待裁决 ${d.pending ?? rows.length} 条 · 她写的优先，抽取器只补充`),
          ...rows.map((row) => h('div', { key: row.id, style: styles.factRow },
            h('div', null, `她：${row.selfValue || '—'}`),
            h('div', null, `补充：${row.value || '—'}`),
            h('div', { style: styles.dim },
              `${row.slot || '—'} · ${row.topicId || '—'} · ${row.quote ? `「${String(row.quote).slice(0, 40)}」` : '无引文'}`
                + (row.createdAt ? ` · ${String(row.createdAt).slice(0, 10)}` : '')
            ),
            h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
              h('button', { style: styles.linkBtnOn, disabled: busy === row.id,
                onClick: () => write({ action: 'dispute', id: row.id, decision: 'keep_self' }) }, '保留她的'),
              h('button', { style: styles.linkBtnOn, disabled: busy === row.id,
                onClick: () => write({ action: 'dispute', id: row.id, decision: 'use_extract' }) }, '采用补充'),
              h('button', { style: styles.linkBtn, disabled: busy === row.id,
                onClick: () => {
                  const value = window.prompt('合并成什么？', String(row.value || row.selfValue || ''));
                  if (value && value.trim()) write({ action: 'dispute', id: row.id, decision: 'merge', value: value.trim() });
                } }, '合并'),
              h('button', { style: styles.linkBtnDanger, disabled: busy === row.id,
                onClick: () => write({ action: 'dispute', id: row.id, decision: 'dismiss' }) }, '忽略')
            )
          ))
        );
      }

      function renderMonthly(d) {
        const index = d.index || {};
        if (!d.text) {
          return h('div', null,
            h('div', { style: styles.empty }, '还没有月摘要。日终维护会自动生成；如果长期事实都是旧的，也可能是 30 天内没有可留下的事。'),
            h('div', { style: { ...styles.dim, marginTop: 6 } }, '月摘要在轮转时进入交接，排在「最近一天原话」和「七天摘要」之后，最多 700 字。')
          );
        }
        return h('div', null,
          h('div', { style: styles.dim },
            `${d.chars} 字 · ${index.facts || 0} 条 · ${index.month || 'rolling'}`
              + (index.updatedAt ? ` · 更新 ${String(index.updatedAt).slice(0, 16).replace('T', ' ')}` : '')),
          h('pre', { style: { ...styles.mono, whiteSpace: 'pre-wrap', margin: '8px 0 0', lineHeight: 1.7 } }, d.text),
          h('div', { style: { ...styles.dim, marginTop: 8 } }, '这是轮转交接里的第四层，只在轮转时注入，平时不进上下文。')
        );
      }

      function renderClaims(d) {
        if (!d.rows || !d.rows.length) return h('div', { style: styles.empty }, '没有待确认的纠正候选。');
        return h('div', null,
          h('div', { style: styles.dim }, `待确认 ${d.count} 条`),
          ...d.rows.map((row) => h('div', { key: row.id, style: styles.factRow },
            h('div', null, row.quote || row.suggestedValue || row.id),
            h('div', { style: styles.dim },
              `${row.topicName || row.topicId || '—'} · ${row.slot || '—'} · ${row.program || ''}`
                + (row.at ? ` · ${String(row.at).slice(0, 10)}` : '')
            ),
            h('div', { style: { display: 'flex', gap: 4, marginTop: 5 } },
              h('button', { style: styles.linkBtnOn, disabled: busy === row.id, onClick: () => write({ action: 'claims', id: row.id, value: row.suggestedValue || undefined }) }, '确认'),
              h('button', { style: styles.linkBtnDanger, disabled: busy === row.id, onClick: () => write({ action: 'claims', id: row.id, decision: 'reject', reason: '面板驳回' }) }, '驳回')
            )
          ))
        );
      }

      function renderActivation(d) {
        const cfg = d.config || {};
        const keys = ['enabled', 'emit', 'rankInInject', 'recordRetrieved', 'toneResidue', 'toneSummary', 'matchTokens'];
        return h('div', null,
          h('div', { style: styles.dim }, `文件：${d.file || '（未创建）'}`),
          h('div', { style: styles.card },
            ...keys.map((key) => h('div', { key, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' } },
              h('span', null, key),
              h('button', {
                style: cfg[key] ? styles.linkBtnOn : styles.linkBtn,
                disabled: busy === 'activation',
                onClick: () => write({ action: 'activation', [key]: !cfg[key] })
              }, cfg[key] ? '开' : '关')
            )),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 2px', flexWrap: 'wrap' } },
              h('span', { style: { flex: '0 0 auto' } }, 'salienceFloor'),
              h('input', {
                style: { ...styles.input, width: 92 },
                type: 'number',
                min: 0,
                max: 100,
                value: floorDraft === '' ? String(cfg.salienceFloor || 0) : floorDraft,
                onChange: (e) => setFloorDraft(e.target.value)
              }),
              h('button', {
                style: styles.linkBtnOn,
                disabled: busy === 'activation',
                onClick: () => {
                  const n = Number(floorDraft === '' ? (cfg.salienceFloor || 0) : floorDraft);
                  write({ action: 'activation', salienceFloor: Number.isFinite(n) ? n : 0 });
                  setFloorDraft('');
                }
              }, '保存'),
              h('span', { style: styles.dim }, '激活阈值；0 表示不启用')
            )
          ),
          h('div', { style: { ...styles.dim, marginTop: 6 } }, '这些开关影响注入与排序；改动立即落盘，引擎按 mtime 热读。')
        );
      }

      function renderTopics(d) {
        if (!d.rows || !d.rows.length) return h('div', { style: styles.empty }, '还没有主题。');
        return h('div', null,
          h('div', { style: { ...styles.dim, marginBottom: 8 } },
            `${d.count} 个主题 · 未归类事实 ${d.orphans || 0} 条（按 slot 折叠，同槽最多列 3 条）`),
          ...d.rows.map((row) => h('div', { key: row.id, style: styles.card },
            h('div', { style: { fontSize: 14, fontWeight: 600 } },
              `${row.title} · ${row.facts} 条${row.multiSlots ? ` · 多值 ${row.multiSlots} 槽` : ''}`),
            row.parent ? h('div', { style: styles.dim }, `父主题：${row.parent}`) : null,
            ...(row.slots || []).map((slot) => h('div', { key: slot.slot || '-', style: { marginTop: 7 } },
              h('div', { style: { fontSize: 12, fontWeight: 600 } },
                `${slot.label}${slot.multi ? `（${slot.count} 条）` : ''}`),
              ...(slot.items || []).map((item, index) => h('div', {
                key: item.id || `${slot.slot}-${index}`,
                style: { ...styles.dim, marginLeft: 10, marginTop: 2 }
              }, `${item.value}${item.expired ? ' · 旧事' : ''}${item.invalidated ? ' · 已作废' : ''} · ${item.author}`)),
              slot.capped ? h('div', { style: { ...styles.dim, marginLeft: 10 } }, `…另 ${slot.capped} 条（去长期事实里看全部）`) : null
            ))
          ))
        );
      }

      function renderWindow(d) {
        const focused = !!(windowFocus && String(d.sessionId || '') === windowFocus.sessionId);
        const range = focused ? `第 ${windowFocus.from || '…'}–${windowFocus.to || '…'} 轮` : '';
        const reset = focused
          ? h('button', { style: styles.linkBtn, onClick: () => setWindowFocus(null) }, '看最近')
          : null;
        if (!d.turns || !d.turns.length) {
          return h('div', null,
            focused ? h('div', { style: styles.card },
              h('div', { style: styles.dim }, `这段情境（${range}）在窗口账本里没有可展开的记录。`), reset)
              : null,
            h('div', { style: styles.empty }, '这个会话还没有窗口记录。')
          );
        }
        return h('div', null,
          focused ? h('div', { style: { ...styles.dim, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('span', null, `正在看情境段：${range}（命中 ${d.matched} 轮）`), reset) : null,
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' } },
            h('select', {
              style: { ...styles.input, minWidth: 230 },
              value: windowFocus ? windowFocus.sessionId : '',
              onChange: (e) => {
                const sid = e.target.value;
                setWindowFocus(sid ? { sessionId: sid, from: 0, to: 0 } : null);
              }
            },
              h('option', { value: '' }, '最近一轮所在的会话'),
              ...windowSessions.map((s) => h('option', { key: s.sessionId, value: s.sessionId },
                `${String(s.sessionId).replace(/^session-/, '').slice(0, 8)} · ${s.key || '—'} · ${s.turns} 轮`))
            )
          ),
          h('div', { style: styles.dim }, `会话 ${String(d.sessionId || '').replace(/^session-/, '').slice(0, 8) || '—'} · ${d.total} 轮（显示 ${d.turns.length} 轮）`),
          ...d.turns.slice().reverse().map((turn) => h('div', { key: turn.turn, style: styles.card },
            h('div', { style: styles.dim }, `#${turn.turn} · ${String(turn.at).slice(0, 16).replace('T', ' ')} · ${turn.model || '—'}`),
            h('div', { style: { marginTop: 4 } }, h('strong', null, '主人：'), turn.owner || '（无原文）'),
            turn.spoken ? h('div', { style: { marginTop: 4 } }, h('strong', null, '她说：'), turn.spoken) : null,
            turn.thought ? h('div', { style: { ...styles.dim, marginTop: 4 } }, `当时的想法：${turn.thought.slice(0, 160)}`) : null,
            turn.feels && turn.feels.length
              ? h('div', { style: { ...styles.dim, marginTop: 4 } }, `语气：${turn.feels.map((f) => f.text).filter(Boolean).join('；')}`)
              : null,
            turn.blocks ? h('div', { style: styles.dim }, `窗口块 ${turn.blocks}`) : null,
            turn.mediaRefs && turn.mediaRefs.length
              ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 } },
                ...turn.mediaRefs.map((m) => h('img', {
                  key: m.sha1,
                  src: `/api/dsmp/media/file?sha1=${m.sha1}&kind=${m.kind || 'image'}`,
                  title: m.alt || '',
                  alt: m.alt || '',
                  style: { width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: `1px solid ${colors.border}` }
                })))
              : null
          ))
        );
      }

      function renderEpisodes(d) {
        if (!d.episodes || !d.episodes.length) return h('div', { style: styles.empty }, '还没有情境段。');
        return h('div', null,
          ...d.episodes.map((row) => {
            const range = Array.isArray(row.turns) ? `${row.turns[0]}–${row.turns[1]} 轮` : `${row.turns || 0} 轮`;
            const heading = row.title || row.day || String(row.at).slice(0, 10);
            return h('div', { key: row.id, style: styles.card },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, heading),
              h('div', { style: styles.dim }, `${row.day || String(row.at).slice(0, 10)} · ${range}${row.summarized === false ? ' · 未摘要' : ''}`),
              h('div', { style: { marginTop: 4 } }, row.scene || row.summary || '（未摘要）'),
              row.topics && row.topics.length ? h('div', { style: styles.dim }, `主题：${row.topics.join('、')}`) : null,
              row.facts ? h('div', { style: styles.dim }, `抽取 ${row.facts} 条事实`) : null,
              row.sessionId && Array.isArray(row.turns) && row.turns[0]
                ? h('div', { style: { marginTop: 6 } },
                  h('button', {
                    style: styles.linkBtnOn,
                    onClick: () => {
                      setWindowFocus({ sessionId: row.sessionId, from: row.turns[0], to: row.turns[1] });
                      setView('window');
                    }
                  }, '展开原文'))
                : null
            );
          })
        );
      }

      function renderUsage(d) {
        const fmt = (n) => Number(n || 0).toLocaleString('en-US');
        const money = (n) => `¥${Number(n || 0).toFixed(3)}`;
        const pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;
        const totals = d.totals || {};
        const kinds = d.byKind || [];
        const kindOf = (name) => kinds.find((row) => row.kind === name) || { calls: 0, cost: 0 };
        const KIND_LABEL = { owner: '主人触发', wake: '唤醒/派生', unknown: '未知/旧记录', setup: '初始化' };
        const KIND_ORDER = ['owner', 'wake', 'unknown', 'setup'];
        const scopes = d.scopes || [];
        const sessions = d.bySession || [];
        const T = (label, nums, rows) => h('div', { style: { ...styles.card, overflow: 'hidden' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 2 } },
            h('div', { style: { fontSize: 13.5, fontWeight: 650 } }, label),
            h('div', { style: styles.wbTopHint }, '金额按模型与时刻（峰谷/节假日）现算')),
          h('div', { style: styles.wbTscroll },
            h('table', { style: styles.wbTable },
              h('thead', null, h('tr', null, nums.map((n) => h('th', { key: n, style: styles.wbTh }, n)))),
              h('tbody', null, rows.map((cells, i) => h('tr', { key: i }, cells.map((cell, j) => h('td', {
                key: j,
                style: j === 0 ? styles.wbTd : styles.wbTdNum
              }, cell)))))))
        );
        const stat = (label, value, hint) => h('div', { style: styles.wbStat },
          h('div', { style: styles.wbStatLabel }, label),
          h('div', { style: { ...styles.wbStatValue, color: 'var(--wb-text, inherit)' } }, value),
          hint ? h('div', { style: { ...styles.wbTopHint, marginTop: 2 } }, hint) : null
        );
        return h('div', null,
          // ---- 筛选 ----
          h('div', { style: styles.card },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { style: { ...styles.dim, minWidth: 26 } }, '范围'),
              h('select', {
                style: { ...styles.input, width: 110 },
                value: billDays,
                onChange: (e) => setBillDays(Number(e.target.value))
              }, ...[7, 14, 30, 90].map((n) => h('option', { key: n, value: n }, `最近 ${n} 天`))),
              h('select', {
                style: { ...styles.input, minWidth: 150, maxWidth: 240 },
                value: billScope,
                onChange: (e) => setBillScope(e.target.value)
              },
                h('option', { value: 'all' }, '全部会话范围'),
                ...scopes.map((row) => h('option', { key: row.key, value: row.key }, `${row.key}（${row.calls} 次）`))),
              h('select', {
                style: { ...styles.input, minWidth: 140, maxWidth: 220 },
                value: billSession,
                onChange: (e) => setBillSession(e.target.value)
              },
                h('option', { value: 'all' }, '全部会话 id'),
                ...sessions.map((row) => h('option', { key: row.sessionId, value: row.sessionId }, `${String(row.sessionId).slice(0, 18)}（${row.calls}）`))),
              h('select', {
                style: { ...styles.input, width: 150 },
                value: billTurn,
                onChange: (e) => setBillTurn(e.target.value)
              },
                h('option', { value: 'all' }, '全部轮次类型'),
                ...KIND_ORDER.map((kind) => h('option', { key: kind, value: kind }, KIND_LABEL[kind]))),
              h('button', { style: styles.buttonPrimary, onClick: () => load('usage', applied) }, '刷新')
            ),
            h('div', { style: { ...styles.wbTopHint, marginTop: 8 } },
              `价目表 ${d.priceVersion || '—'} · 只统计 k=turn 的逐轮采样；k=base（${fmt(d.baselineRows || 0)} 行）是会话基线，不计费。`)
          ),
          // ---- 轮次类型 ----
          h('div', { style: styles.wbGrid },
            ...KIND_ORDER.map((kind) => {
              const row = kindOf(kind);
              return stat(KIND_LABEL[kind], money(row.cost), `${fmt(row.calls)} 次调用 · ${fmt(row.tokens)} tokens`);
            })
          ),
          // ---- 总计 ----
          h('div', { style: styles.card },
            h('div', { style: styles.wbSectionTitle }, '总计'),
            h('div', { style: styles.wbGrid },
              stat('总花费', money(totals.cost)),
              stat('调用', fmt(totals.calls)),
              stat('tokens', fmt(totals.tokens)),
              stat('输入', fmt((totals.cacheHit || 0) + (totals.cacheMiss || 0) + (totals.cacheWrite || 0))),
              stat('缓存命中率', pct(totals.hitRate)),
              stat('输出', fmt(totals.output))
            )
          ),
          // ---- 按天 ----
          T('按天', ['日期', '调用', '输入', '缓存命中', '输出', '花费'],
            (d.byDay || []).map((row) => [
              row.day,
              fmt(row.calls),
              fmt((row.cacheHit || 0) + (row.cacheMiss || 0) + (row.cacheWrite || 0)),
              fmt(row.cacheHit),
              fmt(row.output),
              money(row.cost)
            ])),
          // ---- 按会话 ----
          T('按会话', ['会话 id', '调用', 'tokens', '主人触发', '唤醒', '未知', '花费'],
            sessions.map((row) => [
              String(row.sessionId),
              fmt(row.calls),
              fmt(row.tokens),
              money(row.ownerCost),
              money(row.wakeCost),
              money(row.unknownCost),
              money(row.cost)
            ])),
          // ---- 按模型 ----
          T('按模型', ['模型', '调用', 'tokens', '花费'],
            (d.byModel || []).map((row) => [row.model, fmt(row.calls), fmt(row.tokens), money(row.cost)])),
          // ---- 记忆侧 ----
          h('div', { style: styles.card },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
              h('div', { style: { fontSize: 13.5, fontWeight: 650 } }, '记忆侧模型用量'),
              h('div', { style: styles.wbTopHint }, 'logs/memory-usage.jsonl：轮转交接 / 事实卡 / 日终抽取 / 情境摘要 / 条目抽取')),
            h('div', { style: { ...styles.wbGrid, marginTop: 10 } },
              stat('记忆调用', fmt((d.memory && d.memory.totals && d.memory.totals.calls) || 0),
                (d.memory && d.memory.totals && d.memory.totals.fail) ? `${d.memory.totals.fail} 次失败` : ''),
              stat('记忆花费', money((d.memory && d.memory.totals && d.memory.totals.cost) || 0)),
              stat('记忆输入', fmt((d.memory && d.memory.totals && d.memory.totals.input) || 0)),
              stat('记忆输出', fmt((d.memory && d.memory.totals && d.memory.totals.output) || 0))
            ),
            d.memory && d.memory.byCaller && d.memory.byCaller.length
              ? h('div', { style: styles.wbTscroll },
                h('table', { style: styles.wbTable },
                  h('thead', null, h('tr', null,
                    ['调用方', '调用', '失败', '输入', '缓存命中', '输出', '花费'].map((n) => h('th', { key: n, style: styles.wbTh }, n)))),
                  h('tbody', null, d.memory.byCaller.map((row) => h('tr', { key: row.caller },
                    h('td', { style: styles.wbTd }, row.caller),
                    h('td', { style: styles.wbTdNum }, fmt(row.calls)),
                    h('td', { style: styles.wbTdNum }, fmt(row.fail)),
                    h('td', { style: styles.wbTdNum }, fmt(row.input)),
                    h('td', { style: styles.wbTdNum }, fmt(row.cacheHit)),
                    h('td', { style: styles.wbTdNum }, fmt(row.output)),
                    h('td', { style: styles.wbTdNum }, money(row.cost)))))))
              : h('div', { style: { ...styles.dim, marginTop: 8 } }, '记忆侧还没有记账（logs/memory-usage.jsonl 不存在或窗口内无记录）。')
          ),
          h('div', { style: { ...styles.wbTopHint, padding: '2px 2px 10px', lineHeight: 1.7 } },
            '口径：聊天侧读 <记忆目录>/logs/token-usage.jsonl，只算 k=turn；记忆侧读 logs/memory-usage.jsonl，caller 即用途。'
            + '金额按 DeepSeek 官方价目表（空闲/高峰）现算，未记账的历史回合会显示 ¥0.000。')
        );
      }

      function renderRecall(d) {
        return h('div', null,
          h('div', { style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
            h('input', {
              style: { ...styles.input, flex: 1, minWidth: 180 },
              value: query,
              placeholder: '问一句，比如「主人的生日」',
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') setApplied(query); }
            }),
            h('select', {
              style: { ...styles.input, width: 104 },
              value: recallLimit,
              onChange: (e) => { setRecallLimit(Number(e.target.value)); setApplied(query); }
            }, ...[4, 6, 10].map((n) => h('option', { key: n, value: n }, `top ${n}`))),
            h('button', { style: styles.buttonPrimary, onClick: () => setApplied(query) }, '检索')
          ),
          h('div', { style: styles.dim }, `命中 ${d.count} 条${d.query ? ` · 查询「${d.query}」` : ''}`),
          d.explain && d.explain.length
            ? h('div', { style: { ...styles.card, marginTop: 8 } },
              h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 2 } }, '问法路由'),
              ...d.explain.map((line, i) => h('div', { key: i, style: { ...styles.dim, fontFamily: monoFont, marginTop: 2 } }, String(line)))
            )
            : null,
          ...(d.rows || []).map((row, index) => h('div', { key: row.id || index, style: styles.factRow },
            h('div', null, `${index + 1}. ${row.value || row.text || ''}`),
            h('div', { style: styles.dim },
              `${row.slotLabel || row.slot || '—'} · ${row.topicId || '—'} · ${row.author || '—'}`
                + (row.expired ? ' · 旧事' : '')
                + (row.score !== undefined ? ` · score ${row.score}` : '')
            )
          ))
        );
      }

      function renderOverview(d) {
        const facts = d.facts || {};
        const tiers = facts.byTier || {};
        const mem = d.memory || {};
        const size = d.sizes || {};
        const kb = (n) => `${Math.max(1, Math.round(Number(n || 0) / 1024))} KB`;
        return h('div', null,
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '记忆总量'),
            h(Row, { label: '长期事实' }, `${facts.total || 0} 条 · 现存 ${facts.active || 0} · 旧事 ${facts.expired || 0} · 已作废 ${facts.invalidated || 0}`),
            h(Row, { label: '按档位' }, `hard ${tiers.hard || 0} · long ${tiers.long || 0} · general ${tiers.general || 0} · temp ${tiers.temp || 0}`),
            h(Row, { label: '主题 / 情境' }, `${d.topics || 0} 个主题 · ${d.episodes || 0} 段情境`),
            h(Row, { label: '窗口' }, `${(d.window && d.window.sessions) || 0} 个会话 · ${(d.window && d.window.turns) || 0} 轮 · 待确认 ${d.claims || 0}`),
            h(Row, { label: '媒体' }, `${(d.media && d.media.images) || 0} 张图 · ${(d.media && d.media.voice) || 0} 条语音`)
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '引擎与租约'),
            h(Row, { label: '写者' }, `${mem.owner || '—'} · 下一轮 #${mem.nextTurn != null ? mem.nextTurn : '—'}${mem.lastDailyAt ? ` · 日终 ${fmtTime(mem.lastDailyAt)}` : ''}`),
            h(Row, { label: '租约' }, d.lease ? `${d.lease.owner || '—'} · ${d.lease.live ? '有效' : '无效'} · TTL ${d.lease.ttlMs || 0}ms` : '—'),
            h(Row, { label: '引擎' }, d.engine ? `${d.engine.running ? '运行中' : '停止'}${d.engine.lastTickAt ? ` · tick ${fmtTime(d.engine.lastTickAt)}` : ''}` : '—'),
            h(Row, { label: '桥接' }, d.bridge ? (d.bridge.ok ? `${d.bridge.mode || '—'} · ${d.bridge.alive ? '在线' : '离线'} · ${d.bridge.role || ''}` : `不可用：${d.bridge.error || ''}`) : '—')
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '存储'),
            h(Row, { label: '长期事实' }, kb(size['longterm.jsonl'])),
            h(Row, { label: '情境段' }, kb(size.episodes)),
            h(Row, { label: '主题' }, kb(size['topics.jsonl'])),
            h(Row, { label: '媒体索引' }, kb(size['media.jsonl'])),
            h(Row, { label: '语音索引' }, kb(size['voice.jsonl']))
          ),
          (d.selfCheck || []).length
            ? h('div', { style: styles.card },
              h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '自检'),
              ...d.selfCheck.map((item) => h(Row, {
                key: item.id || item.name || item.label,
                label: item.label || item.name || item.id || '项'
              }, `${item.ok ? '正常' : '异常'}${item.detail ? ` · ${item.detail}` : ''}`)))
            : null
        );
      }

      function renderCard(d) {
        const sizes = [800, 1500, 3000, 6000];
        return h('div', null,
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('span', { style: styles.dim }, '预算'),
            ...sizes.map((n) => h('button', {
              key: n,
              style: cardChars === n ? styles.linkBtnOn : styles.linkBtn,
              onClick: () => setCardChars(n)
            }, `${n} 字`))
          ),
          h('div', { style: styles.dim }, `${d.chars} 字 · 收录 ${d.included} 条 · 挤出 ${d.dropped} 条 · ${d.groups} 组 · 事实库 ${d.facts} 条`),
          d.droppedIds && d.droppedIds.length
            ? h('div', { style: { ...styles.dim, marginTop: 2 } }, `挤出：${d.droppedIds.slice(0, 8).join('、')}${d.droppedIds.length > 8 ? ' …' : ''}`)
            : null,
          h('pre', { style: { ...styles.mono, whiteSpace: 'pre-wrap', margin: '8px 0 0', lineHeight: 1.7 } }, d.text || '（空卡）'),
          h('div', { style: { ...styles.dim, marginTop: 8 } }, '这里与线上注入同源：同一份事实、同一个主题树、同一套预算裁剪。')
        );
      }

      function renderContext(d) {
        const rows = d.sessions || [];
        return h('div', null,
          h('div', { style: styles.card },
            h(Row, { label: '上下文窗口' }, `${d.windowTokens || 0} tokens`),
            h(Row, { label: '轮转阈值' }, `${d.threshold || 0}（${Math.round((d.ratio || 0) * 100)}%）`),
            h(Row, { label: '交接上限' }, `${d.handoverMaxChars || 0} 字`),
            h(Row, { label: '窗口 / 日终' }, `${d.windowDays || 0} 天 · ${d.dailyAt || '—'} · 写者 ${d.owner || '—'}`),
            h(Row, { label: '上次日终' }, fmtTime(d.lastDailyAt))
          ),
          rows.length ? null : h('div', { style: styles.empty }, '还没有 token 用量记录。'),
          ...rows.map((row) => h('div', { key: row.key, style: styles.card },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' } },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, row.key || '—'),
              h('div', { style: { ...styles.dim, color: row.over ? colors.danger : 'inherit' } }, `${row.pct || 0}%`)
            ),
            h(Row, { label: '峰值 tokens' }, `${row.max5 || 0}${row.stale ? '（估算）' : ''} · ${row.rounds || 0} 轮`),
            h(Row, { label: '会话' }, `${String(row.sessionId || '').replace(/^session-/, '').slice(0, 8)} · ${row.turns || 0} 轮 · ${fmtTime(row.lastAt)}`),
            h(Row, { label: '策略' }, `${row.policy || '—'}${row.folded ? ' · 已折叠' : ''}${row.foldedReason ? `（${row.foldedReason}）` : ''}`)
          ))
        );
      }

      function renderSessions(d) {
        const rows = d.sessions || [];
        const pct = (n) => Math.max(0, Math.min(100, Number(n) || 0));
        return h('div', null,
          h('div', { style: styles.card },
            h(Row, { label: '轮转阈值' }, `${d.threshold || 0} tokens（窗口 ${d.windowTokens || 0} · ${Math.round((d.ratio || 0) * 100)}%）`),
            h(Row, { label: '交接上限' }, `${d.handoverMaxChars || 0} 字 · 窗口 ${d.windowDays || 0} 天 · 日终 ${d.dailyAt || '—'}`),
            h(Row, { label: '说明' }, '轮转只由 bridge 执行，这里只读；策略在「生效配置」里改。')
          ),
          rows.length ? null : h('div', { style: styles.empty }, '还没有会话映射。'),
          ...rows.map((row) => h('div', { key: row.key, style: styles.card },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, row.key || '—'),
              h('div', { style: { ...styles.dim, color: row.over ? colors.danger : 'inherit' } }, `${row.pct || 0}%`)),
            h('div', { style: { height: 6, background: colors.soft, borderRadius: 3, margin: '6px 0 8px', overflow: 'hidden' } },
              h('div', {
                style: {
                  width: `${pct(row.pct)}%`,
                  height: 6,
                  background: row.over ? colors.danger : colors.accent
                }
              })),
            h(Row, { label: '会话' }, `${String(row.sessionId || '').replace(/^session-/, '').slice(0, 8) || '—'} · ${row.turns || 0} 轮（计费 ${row.rounds || 0} 轮）`),
            h(Row, { label: '上下文' }, `峰值 ${row.max5 || 0}${row.stale ? '（估算）' : ''} tokens`),
            h(Row, { label: '注入策略' }, `${row.injectPolicy || row.policy || 'full'} · ${row.folded ? '已折叠' : '未折叠'}${row.foldedReason ? `（${row.foldedReason}）` : ''}`),
            h(Row, { label: '最近' }, fmtTime(row.lastAt))
          ))
        );
      }

      function renderConfig(d) {
        const draft = configDraft || d.desired || {};
        const patch = (key, value) => setConfigDraft({ ...draft, [key]: value });
        const patchScoring = (key, value) => setConfigDraft({ ...draft, scoring: { ...(draft.scoring || {}), [key]: value } });
        const patchPolicy = (key, value) => setConfigDraft({ ...draft, policies: { ...(draft.policies || {}), [key]: value } });
        const labelStyle = { width: 165, fontSize: 12, opacity: .7 };
        const numField = (label, key, scoring) => h('div', { key: key, style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
          h('div', { style: labelStyle }, label),
          h('input', {
            style: { ...styles.input, flex: 1, minWidth: 80 },
            value: scoring
              ? ((draft.scoring && draft.scoring[key] !== undefined) ? String(draft.scoring[key]) : '')
              : (draft[key] === undefined || draft[key] === null ? '' : String(draft[key])),
            onChange: (e) => (scoring ? patchScoring(key, e.target.value) : patch(key, e.target.value))
          }));
        const checkField = (label, key) => h('label', { key: key, style: { display: 'flex', alignItems: 'center', gap: 8, margin: '5px 0', fontSize: 12.5 } },
          h('input', { type: 'checkbox', checked: Boolean(draft[key]), onChange: (e) => patch(key, e.target.checked) }),
          label);
        const policies = draft.policies || {};
        const saveDraft = () => write({ action: 'desired-save', values: draft });
        const applyDraft = async (restart) => {
          if (restart && typeof window !== 'undefined' && window.confirm
            && !window.confirm('立即重启 QQ 机器人让配置生效？重启期间 QQ 会断线约 1 分钟。')) return;
          const saved = await write({ action: 'desired-save', values: draft });
          if (!saved) return;
          const out = await write({ action: 'apply', restart: Boolean(restart) });
          if (out && out.restart && out.restart.ok === false) {
            setError(`配置已写入，但重启失败：${JSON.stringify(out.restart.detail || out.restart)}`);
          }
        };
        return h('div', null,
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '生效配置（memory.*）'),
            h('div', { style: styles.dim }, `桥接真源：${d.file || '—'}${d.savedAt ? ` · 草稿保存于 ${fmtTime(d.savedAt)}` : ''}`),
            d.bridgeError ? h('div', { style: { color: colors.danger, marginTop: 4 } }, `桥接配置不可读：${d.bridgeError}`) : null,
            h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
              h('button', { style: styles.button, onClick: saveDraft, disabled: busy === 'desired-save' }, '保存草稿'),
              h('button', { style: styles.button, onClick: () => applyDraft(false), disabled: Boolean(busy) }, '应用到桥接（稍后重启）'),
              h('button', { style: styles.buttonPrimary, onClick: () => applyDraft(true), disabled: Boolean(busy) }, '应用并立即重启 QQ')),
            h('div', { style: { ...styles.dim, marginTop: 6 } }, '默认只保存草稿；「应用」会备份 config.json 后写 memory.*，重启需二次确认。')
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '窗口与日终'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
              h('div', { style: labelStyle }, '数据目录'),
              h('input', { style: { ...styles.input, flex: 1 }, value: draft.dir || '', onChange: (e) => patch('dir', e.target.value) })),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
              h('div', { style: labelStyle }, '日终时间 HH:MM'),
              h('input', { style: { ...styles.input, width: 120 }, value: draft.dailyAt || '', onChange: (e) => patch('dailyAt', e.target.value) })),
            checkField('记忆写入启用', 'enabled'),
            numField('窗口天数', 'windowDays'),
            numField('单条消息上限（字）', 'maxCharsPerMessage'),
            numField('交接摘要上限（字）', 'handoverMaxChars'),
            numField('事实卡预算（字）', 'profileMaxChars'),
            numField('单键最大条目', 'maxEntriesPerKey'),
            checkField('同键更新时重新注入', 'reinjectOnUpdate'),
            checkField('允许作废事实', 'invalidateEnabled')
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '轮转'),
            numField('上下文窗口 tokens', 'contextWindowTokens'),
            numField('阈值比例（0.1–0.95）', 'rotationThresholdRatio'),
            numField('冷却毫秒', 'rotationCooldownMs'),
            numField('最小轮转 tokens', 'minRotateTokens'),
            h('div', { style: styles.dim }, 'DSMP 引擎已关闭自动轮转，轮转由 bridge 按这份配置执行。')
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '打分'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' } },
              h('div', { style: labelStyle }, '模式'),
              h('select', {
                style: { ...styles.input, minWidth: 140 },
                value: (draft.scoring && draft.scoring.mode) || 'shadow',
                onChange: (e) => patchScoring('mode', e.target.value)
              }, ...['off', 'shadow', 'on'].map((mode) => h('option', { key: mode, value: mode }, mode)))),
            ...(d.scoringKeys || []).map((key) => numField(key, key, true))
          ),
          h('div', { style: styles.card },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '注入策略（按会话 key）'),
            Object.keys(policies).length
              ? h('div', null, ...Object.entries(policies).map(([key, value]) => h('div', {
                key,
                style: { display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }
              },
                h('div', { style: { flex: 1, fontSize: 12, wordBreak: 'break-all' } }, key),
                h('select', {
                  style: { ...styles.input, width: 100 },
                  value: value,
                  onChange: (e) => patchPolicy(key, e.target.value)
                }, ...(d.policyStates || ['off', 'log', 'full']).map((state) => h('option', { key: state, value: state }, state))),
                h('button', {
                  style: styles.linkBtn,
                  onClick: () => {
                    const next = { ...policies };
                    delete next[key];
                    setConfigDraft({ ...draft, policies: next });
                  }
                }, '删除'))))
              : h('div', { style: styles.dim }, '没有覆盖策略，全部用桥接默认（full）。'),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
              h('input', {
                style: { ...styles.input, flex: 1, minWidth: 200 },
                placeholder: '会话 key，例如 private:<OWNER_QQ>',
                value: policyKey,
                onChange: (e) => setPolicyKey(e.target.value)
              }),
              h('button', {
                style: styles.button,
                onClick: () => {
                  const key = String(policyKey || '').trim();
                  if (!key) return;
                  patchPolicy(key, 'full');
                  setPolicyKey('');
                }
              }, '添加'))
          )
        );
      }

      function renderMedia(d) {
        const rows = d.rows || [];
        return h('div', null,
          h('div', { style: { display: 'flex', gap: 6, marginBottom: 8 } },
            ...['image', 'voice'].map((kind) => h('button', {
              key: kind,
              style: mediaKind === kind ? styles.linkBtnOn : styles.linkBtn,
              onClick: () => setMediaKind(kind)
            }, kind === 'image' ? '图片' : '语音'))),
          h('div', { style: styles.dim }, `共 ${d.count || 0} 条`),
          rows.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 } },
              ...rows.map((row) => {
                const src = row.url || (row.sha1
                  ? `/api/dsmp/media/file?sha1=${row.sha1}&kind=${row.kind === 'voice' ? 'voice' : 'image'}`
                  : '');
                const isVoice = row.kind === 'voice';
                return h('div', { key: row.sha1 || row.url || String(row.at), style: { width: 150, ...styles.card, marginBottom: 0, padding: 8 } },
                  isVoice
                    ? h('audio', { controls: true, preload: 'none', src, style: { width: '100%' } })
                    : h('img', {
                      src,
                      alt: row.alt || '',
                      title: '点击查看原图',
                      style: { width: '100%', height: 96, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in' },
                      onClick: () => window.open(src, '_blank')
                    }),
                  h('div', { style: { ...styles.dim, marginTop: 4, wordBreak: 'break-all' } }, `${row.day || ''} · ${Math.max(1, Math.round((Number(row.bytes) || 0) / 1024))} KB`),
                  h('div', { style: { ...styles.dim, wordBreak: 'break-word' } }, `${row.direction === 'out' ? '她说' : '主人'}${row.text ? `：${String(row.text)}` : ''}`)
                );
              }))
            : h('div', { style: styles.empty }, '媒体库是空的。')
        );
      }

      function renderGraph(d) {
        return h('div', null,
          h(StarMap, { data: d, onPick: (id) => openFactDetail(id) }),
          h('div', { style: { ...styles.wbTopHint, padding: '0 2px' } },
            `${(d.nodes || []).length} 节点 · ${(d.links || []).length} 链接${d.truncated ? ' · 已截断（按分数取前 240 条事实）' : ''}`
            + ` · ${Object.entries(d.byType || {}).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
        );
      }

      function renderFolds(d) {
        const rows = d.sessions || [];
        const fmt = (ms) => (ms ? new Date(Number(ms)).toLocaleString() : '—');
        const TBL = { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 };
        const TH = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,.25)', whiteSpace: 'nowrap', fontWeight: 500 };
        const TD = { padding: '4px 6px', borderBottom: '1px solid rgba(127,127,127,.12)', verticalAlign: 'top' };
        return h('div', null,
          h('div', { style: styles.card },
            h(Row, { label: '已折叠会话' }, String(d.folded || 0)),
            h(Row, { label: '会话总数' }, String(rows.length)),
            h(Row, { label: '折叠护栏日志' }, d.guard && d.guard.exists ? '有（logs/fold-guard.log）' : '暂无'),
            h('div', { style: { ...styles.dim, marginTop: 6 } }, '折叠只发生在她主动把一段对话收进长期记忆时；这里只是账本记录，不会改动事实。')
          ),
          rows.length
            ? h('table', { style: TBL },
              h('thead', null, h('tr', null,
                h('th', { style: TH }, '会话'),
                h('th', { style: TH }, '状态'),
                h('th', { style: TH }, '轮次'),
                h('th', { style: TH }, '会话日志导入'),
                h('th', { style: TH }, '折叠时间'),
                h('th', { style: TH }, '原因'),
                h('th', { style: TH }, '最近')
              )),
              h('tbody', null, ...rows.map((row) => h('tr', { key: row.key },
                h('td', { style: TD }, row.key),
                h('td', { style: TD }, row.folded ? '已折叠' : '正常'),
                h('td', { style: TD }, String(row.turns || 0)),
                h('td', { style: TD }, String(row.imported || 0)),
                h('td', { style: TD }, fmt(row.foldedAt)),
                h('td', { style: TD }, row.foldedReason || '—'),
                h('td', { style: TD }, fmt(row.lastAt))
              ))))
            : h('div', { style: styles.empty }, '还没有会话折叠记录。')
        );
      }

      function renderExport(d) {
        const counts = d.counts || {};
        const download = () => {
          const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `dsmp-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        };
        return h('div', null,
          h('div', { style: styles.card },
            h(Row, { label: '格式' }, d.format || '—'),
            h(Row, { label: '事实' }, String(counts.facts || 0)),
            h(Row, { label: '主题' }, String(counts.topics || 0)),
            h(Row, { label: '情境段' }, String(counts.episodes || 0)),
            h(Row, { label: '窗口会话' }, String(counts.windowSessions || 0)),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
              h('button', {
                style: exportWindow ? styles.linkBtnOn : styles.linkBtn,
                onClick: () => setExportWindow(!exportWindow)
              }, exportWindow ? '含窗口原文 ✓' : '含窗口原文'),
              h('button', { style: styles.buttonPrimary, onClick: download }, '下载 JSON')
            ),
            h('div', { style: { ...styles.dim, marginTop: 8 } }, '这是记忆内容的可读快照，适合备份与比对；换机请用设置页的「一键换机」。')
          )
        );
      }

      let content = null;
      if (!data) content = h('div', { style: styles.empty }, loading ? '读取中…' : '暂无数据。');
      else if (view === 'overview') content = renderOverview(data);
      else if (view === 'card') content = renderCard(data);
      else if (view === 'context') content = renderContext(data);
      else if (view === 'media') content = renderMedia(data);
      else if (view === 'graph') content = renderGraph(data);
      else if (view === 'export') content = renderExport(data);
      else if (view === 'folds') content = renderFolds(data);
      else if (view === 'facts') content = renderFacts(data);
      else if (view === 'disputes') content = renderDisputes(data);
      else if (view === 'monthly') content = renderMonthly(data);
      else if (view === 'claims') content = renderClaims(data);
      else if (view === 'activation') content = renderActivation(data);
      else if (view === 'topics') content = renderTopics(data);
      else if (view === 'window') content = renderWindow(data);
      else if (view === 'episodes') content = renderEpisodes(data);
      else if (view === 'usage') content = renderUsage(data);
      else if (view === 'sessions') content = renderSessions(data);
      else if (view === 'config') content = renderConfig(data);
      else content = renderRecall(data);

      const labelOf = (key) => (MEMORY_VIEWS.find(([k]) => k === key) || ['', key])[1];
      const HINTS = {
        overview: '记忆目录的健康与体量',
        card: '与线上注入同源的事实卡预览',
        facts: '全部事实：档位、分数、修订链与写操作',
        context: '上下文占用、轮转阈值与交接长度',
        sessions: '每个 QQ 会话的注入策略与折叠状态',
        config: '桥接生效配置（草稿 / 应用）',
        window: '窗口账本的逐轮原文与语气/媒体',
        episodes: '按天切出来的情境摘要',
        topics: '主题簇：同槽折叠，多值并列',
        recall: 'smart 检索的分项打分与空结果诊断',
        usage: '聊天与记忆两侧的 token 账单（人民币）',
        media: '图片与语音的内容寻址记录',
        graph: '人物 · 主题 · 截止日的三维星图',
        export: '记忆内容快照（JSON）',
        folds: '折叠发生记录与护栏',
        claims: '她说话里待确认的纠正候选',
        disputes: 'self 与 extract 冲突待裁决',
        activation: 'v10 激活/排序开关',
        monthly: '月摘要原文'
      };
      const switchView = (key) => {
        if (key === 'window') setWindowFocus(null);
        setFactDetail(null);
        setHistory(null);
        setView(key);
      };
      const navButton = (key) => h('button', {
        key,
        style: { ...styles.wbNavItem, ...(view === key ? styles.wbNavActive : null) },
        onClick: () => switchView(key)
      },
        h('span', { style: { flex: '1 1 auto' } }, labelOf(key)),
        key === 'disputes' && pending ? h('span', { style: { fontSize: 10, opacity: .7 } }, String(pending)) : null
      );

      return h('div', { style: styles.wbShell, className: 'dsmp-wb' },
        h('div', { style: styles.wbSide },
          h('div', { style: styles.wbBrand },
            shell.role ? `${shell.role} · 记忆` : '记忆',
            h('div', { style: styles.wbBrandHint }, '记忆工作台 · 已并入插件')
          ),
          ...MEMORY_GROUPS.map(([group, keys]) => h('div', { key: group || 'top' },
            group ? h('div', { style: styles.wbNavGroup }, group) : null,
            ...keys.map(navButton)
          )),
          h('div', { style: styles.wbSideFoot },
            `v${(props.status && props.status.version) || '1.15.0'}`,
            h('br'),
            (props.status && props.status.memory && props.status.memory.writer === 'dsmp') ? '单写者：DSMP' : '只读投影',
            h('br'),
            `事实 ${(props.status && props.status.memory && props.status.memory.facts) || '—'}`
          )
        ),
        h('div', { style: styles.wbMain },
          h('div', { style: styles.wbTopbar },
            h('h3', { style: styles.wbTopTitle }, labelOf(view)),
            h('span', { style: styles.wbTopHint }, HINTS[view] || ''),
            h('div', { style: styles.wbTopSpacer }),
            note ? h('span', { style: styles.wbNote }, note) : null,
            busy ? h('span', { style: styles.wbTopHint }, '写入中…') : null,
            h('button', {
              style: styles.button,
              onClick: () => { load(view, applied); if (onRefresh) onRefresh(); }
            }, '刷新')
          ),
          error ? h('div', { style: styles.error }, `读取失败：${error}`) : null,
          h('div', { style: styles.wbPanel },
            loading ? h('div', { style: { ...styles.wbTopHint, padding: '4px 0 8px' } }, '读取中…') : null,
            content
          )
        )
      );
    }

    function ModelCard() {
      const [catalog, setCatalog] = React.useState(null);
      const [provider, setProvider] = React.useState('');
      const [model, setModel] = React.useState('');
      const [note, setNote] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      React.useEffect(() => {
        apiFetch('/api/dsmp/models', { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setCatalog(body);
            setProvider(body.current ? body.current.provider : '');
            setModel(body.current ? body.current.model : '');
          })
          .catch((err) => setNote(`读取失败：${err.message}`));
      }, []);

      const providers = (catalog && catalog.providers) || [];
      const active = providers.find((item) => item.id === provider);
      const models = (active && active.models) || [];

      function save() {
        setBusy(true);
        setNote('');
        apiFetch('/api/dsmp/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider, model })
        })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setCatalog(body);
            setNote('已保存：下一轮对话生效');
          })
          .catch((err) => setNote(`保存失败：${err.message}`))
          .finally(() => setBusy(false));
      }

      return h('div', { style: styles.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '模型与 API'),
        h(Row, { label: '面板与 QQ 生效' }, catalog && catalog.effective ? `${catalog.effective.provider} / ${catalog.effective.model}` : '读取中…', true),
        h(Row, { label: '宿主默认' }, catalog && catalog.host ? `${catalog.host.provider} / ${catalog.host.model}` : '未设置', true),
        h('div', { style: { ...styles.dim, marginTop: 2 } }, '面板直连与 QQ 会话都用「生效」这一行；宿主默认只影响没有指定模型的会话。'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' } },
          h('select', {
            style: { ...styles.input, minWidth: 180 },
            value: provider,
            onChange: (e) => {
              const next = e.target.value;
              setProvider(next);
              const first = ((providers.find((item) => item.id === next) || {}).models || [])[0];
              setModel(first ? first.id : '');
            }
          }, providers.map((item) => h('option', { key: item.id, value: item.id }, `${item.name || item.id}（${item.id}）`))),
          h('select', {
            style: { ...styles.input, minWidth: 200 },
            value: model,
            onChange: (e) => setModel(e.target.value)
          }, models.map((item) => h('option', { key: item.id, value: item.id }, `${item.name || item.id}（${item.id}）`)))
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', { style: styles.buttonPrimary, onClick: save, disabled: busy || !provider || !model }, busy ? '保存中…' : '保存并生效'),
          h('button', {
            style: styles.button,
            disabled: busy || !provider || !model,
            title: '把宿主默认模型改成这一对（影响所有没有指定模型的会话，含 DSH 主界面）',
            onClick: () => {
              setBusy(true);
              setNote('');
              apiFetch('/api/dsmp/models', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider, model, applyToHost: true })
              })
                .then(async (res) => {
                  const body = await res.json();
                  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
                  setCatalog(body);
                  const applied = body.hostApplied;
                  setNote(applied && applied.ok ? '已写入宿主默认：新会话都会用它' : `宿主默认未改：${(applied && applied.error) || '未知原因'}`);
                })
                .catch((err) => setNote(`写入失败：${err.message}`))
                .finally(() => setBusy(false));
            }
          }, '设为宿主默认'),
          note ? h('span', { style: styles.dim }, note) : null
        ),
        h('div', { style: styles.dim }, '「保存并生效」只改本插件（面板直连 / QQ 会话）；「设为宿主默认」会改 DSH 全局默认。')
      );
    }

    function PersonaCard() {
      const [roles, setRoles] = React.useState([]);
      const [active, setActive] = React.useState('');
      const [name, setName] = React.useState('');
      const [content, setContent] = React.useState('');
      const [note, setNote] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [armed, setArmed] = React.useState(false);

      const loadRole = React.useCallback((roleName) => {
        apiFetch(`/api/dsmp/roles?name=${encodeURIComponent(roleName)}`, { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setRoles((body.roles || []).filter((row) => !/^readme$/i.test(row.name)));
            setActive((body.current && body.current.name) || '');
            setName(body.name || roleName);
            setContent(body.content || '');
            setNote('');
            setArmed(false);
          })
          .catch((err) => setNote(`读取失败：${err.message}`));
      }, []);

      React.useEffect(() => {
        apiFetch('/api/dsmp/roles', { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setRoles((body.roles || []).filter((row) => !/^readme$/i.test(row.name)));
            setActive((body.current && body.current.name) || '');
            // Default to the card that is actually in use, not whatever happens
            // to sort first in the folder.
            const preferred = (body.current && body.current.name) || '';
            const rows = body.roles || [];
            const hit = (preferred && rows.find((row) => row && row.name === preferred)) || rows[0];
            if (hit) loadRole(hit.name);
          })
          .catch((err) => setNote(`读取失败：${err.message}`));
      }, [loadRole]);

      function save() {
        setBusy(true);
        setNote('');
        apiFetch('/api/dsmp/roles', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, content })
        })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setRoles((body.roles || []).filter((row) => !/^readme$/i.test(row.name)));
            setNote(`已保存 ${body.chars} 字（原文件已备份）`);
          })
          .catch((err) => setNote(`保存失败：${err.message}`))
          .finally(() => setBusy(false));
      }

      function remove() {
        if (!armed) {
          setArmed(true);
          setNote('再点一次「确认删除」：原文件会留 .bak-dsmp-* 备份，记忆目录里的镜像也会一起清掉');
          return;
        }
        setBusy(true);
        setNote('');
        apiFetch(`/api/dsmp/roles?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            const rows = (body.roles || []).filter((row) => !/^readme$/i.test(row.name));
            setRoles(rows);
            setArmed(false);
            const cleared = (body.mirror && body.mirror.removed) || [];
            setNote(`已删除 ${name}（原文件已备份）；镜像清理 ${cleared.length} 个`);
            const next = rows.find((row) => row.name === ((body.current && body.current.name) || '')) || rows[0];
            if (next) loadRole(next.name);
          })
          .catch((err) => setNote(`删除失败：${err.message}`))
          .finally(() => setBusy(false));
      }

      return h('div', { style: styles.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '人设卡'),
        h(Row, { label: '当前角色' }, active ? `${active}（bridge current-role.json）` : '—'),
        h('select', {
          style: { ...styles.input, width: '100%', margin: '8px 0' },
          value: name,
          onChange: (e) => loadRole(e.target.value)
        }, roles.map((item) => h('option', { key: item.name, value: item.name }, `${item.name}（${item.size} B）${item.name === active ? ' · 当前' : ''}`))),
        h('textarea', {
          style: { ...styles.input, width: '100%', minHeight: 160, resize: 'vertical', lineHeight: 1.6 },
          value: content,
          onChange: (e) => setContent(e.target.value)
        }),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', rowGap: 6, marginTop: 8, minWidth: 0 } },
          h('button', { style: styles.buttonPrimary, onClick: save, disabled: busy || !content.trim() }, busy ? '保存中…' : '保存人设卡'),
          h('button', {
            style: armed ? styles.linkBtnDanger : styles.button,
            onClick: remove,
            disabled: busy || !name || name === active,
            title: name === active ? '不能删除当前正在使用的人设卡' : '删除这张卡'
          }, armed ? '确认删除' : '删除'),
          h('span', { style: { ...styles.dim, minWidth: 0, overflowWrap: 'anywhere' } }, `${content.length} 字 · 上限 30000`),
          note ? h('span', { style: { ...styles.dim, minWidth: 0, flex: '1 1 180px', overflowWrap: 'anywhere' } }, note) : null
        )
      );
    }

    function UsageCard() {
      const [data, setData] = React.useState(null);
      const [note, setNote] = React.useState('');
      React.useEffect(() => {
        apiFetch('/api/dsmp/workbench?view=usage', { cache: 'no-store' })
          .then(async (res) => {
            const body = await res.json();
            if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
            setData(body);
          })
          .catch((err) => setNote(`读取失败：${err.message}`));
      }, []);
      return h('div', { style: styles.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '消费（只统计 k=turn，不含基线）'),
        data ? h('div', null,
          h(Row, { label: '计费回合' }, `${data.turns} 轮（日志 ${data.totalRows} 行）`),
          h(Row, { label: '输入 / 缓存 / 输出' }, `${data.input} / ${data.cached} / ${data.output}`),
          h(Row, { label: '费用（估算）' }, data.cost ? String(data.cost) : '未记账')
        ) : h('div', { style: styles.dim }, note || '读取中…')
      );
    }

    function ServicesCard({ status }) {
      const [list, setList] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState('');
      const [detail, setDetail] = React.useState('');
      const legacy = Boolean(status && status.ui && status.ui.legacyWorkbench);

      const load = React.useCallback(() => {
        apiFetch('/api/dsmp/services', { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || '读取服务状态失败');
            setList(data.services || []);
          })
          .catch((err) => setNote(String(err && err.message ? err.message : err)));
      }, []);

      React.useEffect(() => { load(); }, [load]);

      const act = (name, action) => {
        setBusy(name + ':' + action);
        setNote('');
        setDetail('');
        apiFetch('/api/dsmp/services', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, name })
        })
          .then((res) => res.json())
          .then((data) => {
            if (!data || data.ok === false) {
              const head = (data && data.error) || (action === 'start' ? '启动失败' : '关闭失败');
              const tail = (data && data.tail ? String(data.tail) : '').trim();
              setDetail(tail);
              throw new Error(head + (data && data.code ? `（退出码 ${data.code}）` : ''));
            }
            if (data.list) setList(data.list.services || []);
            setNote(data.note || (action === 'start' ? '已启动' : '已关闭'));
          })
          .catch((err) => setNote(String(err && err.message ? err.message : err)))
          .finally(() => setBusy(''));
      };

      const viewLog = (name) => {
        apiFetch('/api/dsmp/services?log=' + encodeURIComponent(name), { cache: 'no-store' })
          .then((res) => res.json())
          .then((data) => {
            const text = String((data && data.text) || '').trim();
            setDetail(text ? text.slice(-4000) : '（日志为空）');
          })
          .catch((err) => setDetail(String(err && err.message ? err.message : err)));
      };

      return h('div', { style: styles.card },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
          h('div', { style: { fontSize: 12.5, fontWeight: 600, opacity: .8 } }, '本地服务'),
          h('span', { style: { flex: '1 1 auto' } }),
          h('button', { style: styles.linkBtn, onClick: load }, '刷新')
        ),
        (list || []).filter((item) => item.name !== 'workbench' || legacy).map((item) => h('div', { key: item.name, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' } },
          h('span', { style: item.running ? styles.dot : { ...styles.dot, opacity: .25 } }),
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', { style: { fontSize: 12.8 } }, item.label),
            h('div', { style: { ...styles.dim, fontSize: 10.5 } }, item.running ? ('运行中 · ' + item.hint) : ('未运行 · ' + item.hint))
          ),
          h('button', {
            style: styles.linkBtnOn,
            disabled: Boolean(busy) || !item.scriptExists,
            onClick: () => act(item.name, 'start')
          }, busy === item.name + ':start' ? '启动中…' : '启动'),
          h('button', {
            style: styles.linkBtn,
            disabled: Boolean(busy),
            onClick: () => act(item.name, 'stop')
          }, busy === item.name + ':stop' ? '关闭中…' : '关闭'),
          h('button', { style: { ...styles.linkBtn, opacity: .7 }, title: '查看脚本日志', onClick: () => viewLog(item.name) }, '日志')
        )),
        h('div', { style: { ...styles.dim, fontSize: 10.5, marginTop: 4 } },
          'ComfyUI / GPT-SoVITS 由 bridge 在空闲 10 分钟后自动关闭；面板只做手动开关。'),
        note ? h('div', { style: { ...styles.dim, fontSize: 11, marginTop: 4 } }, note) : null,
        detail ? h('pre', {
          style: {
            margin: '6px 0 0', padding: 8, borderRadius: 6, background: colors.soft,
            fontSize: 10.5, lineHeight: 1.5, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap'
          }
        }, detail) : null
      );
    }

    function WorkbenchButton({ status, onRefresh }) {
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState('');
      // 过渡开关：7351 入口默认关（能力已并入记忆页签）；需要对照时改 settings.ui.legacyWorkbench=true。
      if (!(status && status.ui && status.ui.legacyWorkbench)) return null;
      const url = (status && status.workbench && status.workbench.url) || 'http://127.0.0.1:7351';
      const running = Boolean(status && status.workbench && status.workbench.http === 200);
      async function openIt() {
        if (running) {
          window.open(url, '_blank', 'noopener');
          return;
        }
        setBusy(true);
        setNote('');
        try {
          const res = await apiFetch('/api/dsmp/services', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'start', name: 'workbench' })
          });
          const out = await res.json();
          if (!res.ok || out.ok === false) throw new Error(out.error || `HTTP ${res.status}`);
          setNote('已启动');
          if (onRefresh) onRefresh();
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          setNote(String(err && err.message ? err.message : err));
        } finally {
          setBusy(false);
        }
      }
      return h('span', null,
        h('button', { style: styles.linkBtnOn, disabled: busy, onClick: openIt }, running ? '打开记忆工作台' : '启动记忆工作台'),
        h('span', { style: { ...styles.dim, marginLeft: 8 } },
          busy ? '启动中…' : (note || (running ? '运行中 · ' + url : '未启动 · 点击会在插件内拉起 7351')))
      );
    }

    function MoveCard(props) {
      const status = props.status;
      const [info, setInfo] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState('');
      const [error, setError] = React.useState('');
      const [pack, setPack] = React.useState(null);
      const [preview, setPreview] = React.useState(null);
      const [targetDir, setTargetDir] = React.useState((status && status.memory && status.memory.dir) || '');
      const [machineName, setMachineName] = React.useState('');

      const loadInfo = React.useCallback(() => {
        apiFetch('/api/dsmp/machine', { cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => { if (d && d.ok !== false) setInfo(d); })
          .catch(() => {});
      }, []);
      React.useEffect(() => { loadInfo(); }, [loadInfo]);

      const exportPack = () => {
        setBusy('export'); setError(''); setNote(''); setPreview(null);
        apiFetch('/api/dsmp/machine/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `dsmp-move-${new Date().toISOString().slice(0, 10)}.zip` })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setNote(`换机包已生成：${d.file}（${(d.bytes / 1024 / 1024).toFixed(2)} MB，${d.files} 个文件）`);
            loadInfo();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const pickFile = (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        setBusy('upload'); setError(''); setNote(''); setPreview(null);
        apiFetch(`/api/dsmp/machine/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setPack(d);
            return apiFetch('/api/dsmp/machine/import', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ file: d.file, targetDir, machineName, dryRun: true })
            });
          })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setPreview(d);
            setNote('预检通过：下面是对账结果，确认无误再点「确认导入」');
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const confirmImport = () => {
        if (!pack) return;
        setBusy('import'); setError(''); setNote('');
        apiFetch('/api/dsmp/machine/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: pack.file, targetDir, machineName, overwrite: Boolean(preview && preview.targetExists) })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setNote(`导入完成：记忆 ${d.memoryFiles || 0} 个文件、会话 ${d.sessionFiles || 0} 个文件；新工作区 ${d.newCwd}`);
            setPreview(null);
            loadInfo();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const m = (info && info.machine) || null;
      return h('div', { style: styles.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '一键换机'),
        h(Row, { label: '本机' }, m ? `${m.name} · ${String(m.machineId).slice(0, 8)}…` : '未登记（导出时自动生成）', true),
        h(Row, { label: '绑定会话' }, m && m.boundSessionId ? m.boundSessionId : '—', true),
        h(Row, { label: '心跳' }, info && info.lock && info.lock.heartbeatAt ? new Date(info.lock.heartbeatAt).toLocaleString() : '—'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' } },
          h('button', { style: styles.button, onClick: exportPack, disabled: Boolean(busy) }, busy === 'export' ? '打包中…' : '导出换机包'),
          h('label', { style: { ...styles.button, cursor: 'pointer' } },
            busy === 'upload' ? '读取中…' : '选择换机包…',
            h('input', {
              type: 'file',
              accept: '.zip,application/zip',
              style: { display: 'none' },
              onChange: pickFile,
              disabled: Boolean(busy)
            })
          )
        ),
        h(Row, { label: '导入到' },
          h('input', {
            style: styles.input,
            value: targetDir,
            onChange: (e) => setTargetDir(e.target.value),
            placeholder: '新机器上的记忆目录，如 <DSMP_MEMORY_DIR>'
          }), true),
        h(Row, { label: '新机器名' },
          h('input', {
            style: styles.input,
            value: machineName,
            onChange: (e) => setMachineName(e.target.value),
            placeholder: '可留空，默认用当前计算机名'
          }), true),
        preview ? h('div', { style: { border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 10px', margin: '8px 0', fontSize: 12, lineHeight: 1.6 } },
          h('div', null, `包来源：${preview.sourceMachine || '—'} · ${preview.oldCwd || '—'}`),
          h('div', null, `记忆 ${preview.memoryFiles} · 会话 ${preview.sessions} · 人设 ${preview.roleFiles} · 设置 ${preview.hasSettings ? '有' : '无'}`),
          h('div', null, `新工作区：${preview.newCwd}`),
          h('div', null, preview.targetExists ? '⚠ 目标目录已存在，确认导入会先备份再替换' : '目标目录不存在，将新建'),
          h('button', { style: styles.button, onClick: confirmImport, disabled: Boolean(busy), marginTop: 6 },
            busy === 'import' ? '导入中…' : '确认导入')
        ) : null,
        note ? h('div', { style: { fontSize: 12, opacity: .75, margin: '6px 0' } }, note) : null,
        error ? h('div', { style: styles.error }, error) : null
      );
    }

    function BackupCard(props) {
      const [info, setInfo] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [note, setNote] = React.useState('');
      const [error, setError] = React.useState('');
      const [preview, setPreview] = React.useState(null);
      const [dirDraft, setDirDraft] = React.useState(null);

      const load = React.useCallback(() => {
        apiFetch('/api/dsmp/backup', { cache: 'no-store' })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok !== false) {
              setInfo(d);
              setDirDraft((prev) => (prev === null ? String(d.configured || '') : prev));
            }
          })
          .catch(() => {});
      }, []);
      React.useEffect(() => { load(); }, [load]);

      const runNow = () => {
        setBusy('now'); setError(''); setNote(''); setPreview(null);
        apiFetch('/api/dsmp/backup/now', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ env: 'panel' })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            const mb = (d.backup.bytes / 1024 / 1024).toFixed(2);
            setNote(`已备份：${d.backup.name}（${mb} MB，${d.backup.files || '?'} 个文件）${d.removed && d.removed.length ? `；清理旧包 ${d.removed.length} 份` : ''}`);
            load();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const pickDir = () => {
        setBusy('pick'); setError(''); setNote('');
        apiFetch('/api/dsmp/backup/pick-dir', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            if (d.cancelled) { setNote('已取消选择'); return; }
            setDirDraft(d.path);
            setNote(`已选择：${d.path}（点「保存路径」生效）`);
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const saveDir = () => {
        setBusy('dir'); setError(''); setNote('');
        apiFetch('/api/dsmp/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backup: { dir: String(dirDraft || '').trim() } })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setNote('备份目录已保存；下一次备份会写到新目录');
            load();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const resetDir = () => {
        setDirDraft(''); setBusy('dir'); setError(''); setNote('');
        apiFetch('/api/dsmp/settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ backup: { dir: '' } })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setNote('已恢复默认备份目录');
            load();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const askRestore = (item) => {
        setBusy('preview'); setError(''); setNote(''); setPreview(null);
        apiFetch('/api/dsmp/backup/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: item.file, dryRun: true })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setPreview({ item, plan: d.plan });
            setNote('预检通过：恢复会把现有记忆目录整体改名备份，再替换成包里的内容。');
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const confirmRestore = () => {
        if (!preview) return;
        setBusy('restore'); setError(''); setNote('');
        apiFetch('/api/dsmp/backup/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: preview.item.file, overwrite: true })
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
            setNote(`恢复完成：记忆 ${d.restored.memoryFiles} · 人设 ${d.restored.roleFiles} · 工作区 ${d.restored.workspaceFiles}；旧目录留在 ${d.safetyDir}`);
            setPreview(null);
            load();
          })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''));
      };

      const items = (info && info.items) || [];
      return h('div', { style: styles.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '备份与恢复'),
        h(Row, { label: '备份目录' }, (info && info.root) || '读取中…', true),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 2px' } },
          h('input', {
            style: { ...styles.input, flex: '1 1 260px', minWidth: 180 },
            value: dirDraft === null ? '' : dirDraft,
            placeholder: `默认：${(info && info.defaultRoot) || '<DSH_HOME>/dsmp/backups'}`,
            onChange: (e) => setDirDraft(e.target.value)
          }),
          h('button', { style: styles.button, onClick: pickDir, disabled: Boolean(busy) }, busy === 'pick' ? '选择中…' : '浏览…'),
          h('button', { style: styles.button, onClick: saveDir, disabled: Boolean(busy) || dirDraft === null }, busy === 'dir' ? '保存中…' : '保存路径'),
          h('button', { style: styles.linkBtnOn, onClick: resetDir, disabled: Boolean(busy) }, '恢复默认')
        ),
        h('div', { style: { fontSize: 11, opacity: .65, margin: '2px 0 8px' } },
          '留空=用默认目录；自定义目录会在首次备份时自动创建。'),
        h(Row, { label: '已有备份' }, `${(info && info.count) || 0} 份 · 只保留最近 ${(info && info.keep) || 2} 份`),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' } },
          h('button', { style: styles.button, onClick: runNow, disabled: Boolean(busy) },
            busy === 'now' ? '备份中…' : '立即备份'),
          h('button', { style: styles.linkBtnOn, onClick: load, disabled: Boolean(busy) }, '刷新列表')
        ),
        items.slice(0, 5).map((item) => h('div', {
          key: item.file,
          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: `1px solid ${colors.border}`, fontSize: 12 }
        },
          h('span', { style: { flex: 1, wordBreak: 'break-all' } },
            `${item.name} · ${(item.bytes / 1024 / 1024).toFixed(2)} MB · ${new Date(item.at).toLocaleString()}`),
          h('button', { style: styles.linkBtnOn, disabled: Boolean(busy), onClick: () => askRestore(item) }, '恢复…')
        )),
        !items.length ? h('div', { style: { fontSize: 12, opacity: .7 } }, '还没有备份，点「立即备份」生成第一份。') : null,
        preview ? h('div', { style: { border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 10px', margin: '8px 0', fontSize: 12, lineHeight: 1.6 } },
          h('div', null, `包内：记忆 ${preview.plan.memoryFiles} · 人设 ${preview.plan.roleFiles} · 工作区 ${preview.plan.workspaceFiles}`),
          h('div', null, `来源：${preview.plan.source || '—'} · ${preview.plan.createdAt || '—'}`),
          h('div', { style: { opacity: .75 } }, '⚠ 确认后会先把当前记忆目录改名为 .before-restore-*，再替换；不删除任何东西。'),
          h('button', { style: { ...styles.button, marginTop: 6 }, onClick: confirmRestore, disabled: Boolean(busy) },
            busy === 'restore' ? '恢复中…' : '确认恢复')
        ) : null,
        note ? h('div', { style: { fontSize: 12, opacity: .75, margin: '6px 0', wordBreak: 'break-all' } }, note) : null,
        error ? h('div', { style: styles.error }, error) : null
      );
    }

    function DiagnosticsCard() {
      const [open, setOpen] = React.useState(false);
      const [data, setData] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [err, setErr] = React.useState('');
      const load = React.useCallback(async () => {
        setBusy(true);
        setErr('');
        try {
          const res = await apiFetch('/api/dsmp/diagnostics', { cache: 'no-store' });
          const body = await res.json();
          if (!res.ok || !body || body.ok === false) throw new Error((body && body.error) || `HTTP ${res.status}`);
          setData(body);
        } catch (e) {
          setErr(String(e && e.message ? e.message : e));
        } finally {
          setBusy(false);
        }
      }, []);
      React.useEffect(() => { if (open && !data && !busy) load(); }, [open, data, busy, load]);
      const portText = (row) => `${row.port} ${row.state === 'open' ? '通' : row.state === 'refused' ? '未监听' : row.state}`;
      return h('div', { style: styles.card },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
          h('button', { style: styles.linkBtnOn, onClick: () => setOpen(!open) }, open ? '收起诊断' : '诊断与自检'),
          h('span', { style: styles.dim }, data ? `更新于 ${String(data.at || '').slice(11, 19)}` : '端口 / 租约 / 锁 / 日志尾部')
        ),
        open ? h('div', { style: { marginTop: 8 } },
          busy ? h('div', { style: styles.dim }, '读取中…') : null,
          err ? h('div', { style: styles.error }, err) : null,
          data ? h('div', null,
            h('div', { style: styles.row },
              h('span', { style: styles.label }, '端口'),
              h('span', { style: styles.value }, (data.ports || []).map(portText).join(' · '))
            ),
            h('div', { style: styles.row },
              h('span', { style: styles.label }, '租约'),
              h('span', { style: styles.value }, data.lease ? `owner=${data.lease.owner || '?'} · live=${Boolean(data.lease.live)} · mine=${Boolean(data.lease.mine)}` : '—')
            ),
            h('div', { style: styles.row },
              h('span', { style: styles.label }, '残留锁'),
              h('span', { style: styles.value }, (data.locks || []).length ? `${data.locks.length} 个（死锁会在下次写入口抢占）` : '无')
            ),
            h('div', { style: styles.row },
              h('span', { style: styles.label }, '临时标记'),
              h('span', { style: styles.value }, (data.transient || []).length ? data.transient.map((row) => row.label).join('、') : '无')
            ),
            h('div', { style: styles.row },
              h('span', { style: styles.label }, '自检'),
              h('span', { style: styles.value }, (data.selfCheck || []).map((row) => `${row.ok ? '✓' : '✗'} ${row.label}`).join(' · '))
            ),
            (data.logs || []).map((row) => h('div', { key: row.file, style: { marginTop: 6 } },
              h('div', { style: styles.dim }, `${row.name} · ${String(row.at || '').slice(0, 19).replace('T', ' ')}`),
              h('pre', { style: { ...styles.mono, whiteSpace: 'pre-wrap', margin: '2px 0 0', maxHeight: 150, overflow: 'auto' } }, row.tail)
            ))
          ) : null,
          h('div', { style: { marginTop: 8 } },
            h('button', { style: styles.button, onClick: load, disabled: busy }, busy ? '读取中…' : '重新读取')
          )
        ) : null
      );
    }

    function SettingsTab(props) {
      const status = props.status;
      const s = (status && status.settings) || {};
      const qq = (status && status.qq) || {};
      const privateList = Array.isArray(qq.allowPrivate) ? qq.allowPrivate : [];
      const groupList = Array.isArray(qq.allowGroups) ? qq.allowGroups : [];
      const scopeText = privateList.length || groupList.length
        ? `私聊 ${privateList.length} 人 · 群 ${groupList.length} 个`
        : '未配置（bridge 会拒绝所有会话）';
      const sendText = status && status.mode === 'qq' && qq.ok
        ? '经 QQ bridge 实时收发'
        : (s.test && s.test.enabled ? '测试模式（只写本地账本）' : '面板直连 DSH（不经过 QQ）');
      const pendingDisputes = (status && status.disputes && status.disputes.pending) || 0;
      const monthly = (status && status.monthly) || {};
      const selfWrite = (s.memory && s.memory.selfWrite) || {};
      return h('div', { style: styles.scroll },
        h('div', { style: styles.card },
          h(Row, { label: '运行状态' }, status ? modeText(status.mode) : '读取中…'),
          h(Row, { label: '版本' }, status ? `${status.packageName} ${status.version}` : '—'),
          h(Row, { label: '当前角色' }, status && status.panel ? `${status.panel.role.name}（${status.panel.role.source}）` : '—'),
          h(Row, { label: '侧栏名称' }, status && status.panel ? status.panel.label : '—'),
          h(Row, { label: '桥接' }, status && status.bridge ? `${status.bridge.url} · TCP ${status.bridge.tcp} · HTTP ${status.bridge.http || '—'}` : '—', true)
        ),
        h(ServicesCard, { status }),
        h(DiagnosticsCard, null),
        h(BackupCard, null),
        h(MoveCard, { status }),
        h(ModelCard, null),
        h(PersonaCard, null),
        h('div', { style: styles.card },
          h(Row, { label: '记忆' },
            h('span', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              h('button', { style: styles.linkBtnOn, onClick: () => { if (props.onOpenMemory) props.onOpenMemory(); } }, '打开速览'),
              h(WorkbenchButton, { status, onRefresh: props.reload })
            )
          ),
          h(Row, { label: '记忆速览' }, '面板内 19 个视图：概览 / 事实卡 / 长期事实 / 上下文与轮转 / 会话与策略 / 生效配置 / 窗口回放 / 情境索引 / 主题簇 / 检索调试 / 消费账单 / 媒体墙 / 星图 / 导出 / 折叠记录 / 待确认 / 待裁决 / 激活开关 / 月摘要'),
          h(Row, { label: '待裁决' }, pendingDisputes ? `${pendingDisputes} 条（打开速览 → 待裁决）` : '0 条'),
          h(Row, { label: '月摘要' }, monthly.chars
            ? `${monthly.chars} 字 · ${monthly.facts || 0} 条 · ${String(monthly.updatedAt || '').slice(0, 16).replace('T', ' ')}`
            : '尚未生成（日终自动）'),
          h(Row, { label: '自写配额' }, `${selfWrite.maxPerDay || 20} 条/天 · 总 ${selfWrite.maxTotal || 600}`),
          h(Row, { label: '记忆目录' }, status && status.memory ? `${status.memory.dir}${status.memory.exists ? '' : '（不存在）'}` : '—', true),
          h(Row, { label: '长期事实' }, status && status.memory ? `${(status.memory.longtermBytes / 1024).toFixed(1)} KB · ${status.memory.stateFiles} 个 state 文件` : '—')
        ),
        h(UsageCard, null),
        h('div', { style: styles.card },
          h(Row, { label: '设置文件' }, s.version ? `schema v${s.version}` : '—'),
          h(Row, { label: '人设目录' }, (s.roles && s.roles.dir) || '—', true),
          h(Row, { label: 'QQ 白名单' }, scopeText, true)
        ),
        h('div', { style: styles.card },
          h(Row, { label: 'QQ 通道' }, status && status.qq
            ? (status.qq.ok
              ? `在线 · ${status.qq.role || '—'} · 账号${status.qq.snowluma && status.qq.snowluma.accountOnline ? '在线' : '离线'}`
              : `不可用：${status.qq.error || '未知错误'}`)
            : '—'),
          h(Row, { label: '发送方式' }, sendText),
          h(Row, { label: '语音转写' }, status && status.stt
            ? (status.stt.enabled
              ? `${status.stt.provider || 'sensevoice-local'} · ${status.stt.phase || '未加载'}${status.stt.available ? '' : '（不可用）'}`
              : '已关闭')
            : '不可用'),
          h(Row, { label: '会话 key' }, (s.channel && s.channel.key) || '—', true)
        ),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
          h('button', { style: styles.button, onClick: props.reload, disabled: props.loading }, props.loading ? '刷新中…' : '刷新状态')
        ),
        status && status.error ? h('div', { style: styles.error }, status.error) : null
      );
    }

    const QQ_SECTIONS = [
      ['overview', '概览'], ['persona', '人设'], ['sim', '仿真'], ['sessions', '会话'],
      ['slang', '黑话'], ['access', '访问'], ['usage', '花费'], ['ops', '运维']
    ];
    const qqTable = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
    const qqTh = { textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--wb-line, rgba(127,127,127,.35))', whiteSpace: 'nowrap', opacity: .7, fontWeight: 600 };
    const qqTd = { padding: '4px 6px', borderBottom: '1px solid var(--wb-line, rgba(127,127,127,.15))', verticalAlign: 'top' };
    const qqPre = { margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto', background: 'rgba(127,127,127,.08)', padding: 8, borderRadius: 6 };
    function qqChip(text, tone) {
      return h('span', { style: Object.assign({}, styles.chip, tone ? { borderColor: tone, color: tone } : null) }, text);
    }
    function qqObjLine(obj) {
      if (!obj || typeof obj !== 'object') return '—';
      return Object.entries(obj).map(([k, v]) => k + '=' + (v && typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' · ') || '—';
    }
    function qqTime(ms) {
      if (!ms) return '—';
      try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch { return String(ms); }
    }
    function QqChannelTab() {
      const [channel, setChannel] = React.useState(null);
      const [section, setSection] = React.useState('overview');
      const [sec, setSec] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [loadingSec, setLoadingSec] = React.useState(false);
      const [wlPriv, setWlPriv] = React.useState('');
      const [wlGroup, setWlGroup] = React.useState('');
      const [testKind, setTestKind] = React.useState('private');
      const [testId, setTestId] = React.useState('<OWNER_QQ>');
      const [testMsg, setTestMsg] = React.useState('');
      const [testConfirm, setTestConfirm] = React.useState('');
      const [restartConfirm, setRestartConfirm] = React.useState('');

      const loadChannel = React.useCallback(async () => {
        try {
          const res = await apiFetch('/api/dsmp/qq/channel', { cache: 'no-store' });
          const j = await res.json();
          if (!res.ok || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + res.status));
          setChannel(j);
        } catch (err) { setError(String(err && err.message ? err.message : err)); }
      }, []);
      const loadSection = React.useCallback(async (name) => {
        setLoadingSec(true);
        try {
          const res = await apiFetch('/api/dsmp/qq/' + name, { cache: 'no-store' });
          const j = await res.json();
          if (!res.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
          setSec(j);
          if (j && j.ok === false) setError(j.error || j.code || '桥接读取失败');
          else setError(null);
        } catch (err) { setError(String(err && err.message ? err.message : err)); }
        finally { setLoadingSec(false); }
      }, []);
      React.useEffect(() => { loadChannel(); }, [loadChannel]);
      React.useEffect(() => { loadSection(section); }, [section, loadSection]);
      const refreshAll = async () => { await loadChannel(); await loadSection(section); };
      const gatewayPost = async (action, extra) => {
        setBusy(action);
        setError(null);
        try {
          const res = await apiFetch('/api/dsmp/qq/channel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(Object.assign({ action }, extra || {}))
          });
          const j = await res.json();
          if (!res.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
          if (j && j.ok === false) throw new Error(j.error || j.code || '操作失败');
          await refreshAll();
        } catch (err) { setError(String(err && err.message ? err.message : err)); }
        finally { setBusy(''); }
      };
      const qqWrite = async (op, extra) => {
        setBusy(op);
        setError(null);
        try {
          const res = await apiFetch('/api/dsmp/qq/write', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(Object.assign({ op }, extra || {}))
          });
          const j = await res.json();
          if (!res.ok) throw new Error((j && j.error) || ('HTTP ' + res.status));
          if (j && j.ok === false) throw new Error(j.error || j.code || '操作失败');
          await refreshAll();
          return j;
        } catch (err) { setError(String(err && err.message ? err.message : err)); return null; }
        finally { setBusy(''); }
      };

      const d = sec && sec.ok !== false ? sec : null;
      const profiles = (channel && channel.profiles) || [];
      const bridge = channel && channel.bridge;

      // ---------- 视觉：对齐 QQ bridge 控制台（深/浅色跟随系统） ----------
      const QC = {
        bg: 'var(--qc-bg)', surface: 'var(--qc-surface)', card: 'var(--qc-card)', border: 'var(--qc-border)',
        text: 'var(--qc-text)', muted: 'var(--qc-muted)', dim: 'var(--qc-dim)', accent: 'var(--qc-accent)',
        accentSoft: 'var(--qc-accent-soft)', accentFg: 'var(--qc-accent-fg)', accentBorder: 'var(--qc-accent-border)',
        ok: 'var(--qc-ok)', warn: 'var(--qc-warn)', bad: 'var(--qc-bad)',
        line: 'var(--qc-line)', input: 'var(--qc-input)',
        dangerBg: 'var(--qc-danger-bg)', dangerBorder: 'var(--qc-danger-border)',
        warnBg: 'var(--qc-warn-bg)', warnBorder: 'var(--qc-warn-border)'
      };
      const QC_STYLE_ID = 'dsmp-qq-console-style';
      // 颜色统一走 DSH 主题令牌：深浅色由系统主题切换，不再维护自己的两套色板。
      const QC_CSS = '.dsmp-qqc{' +
        '--qc-bg:var(--dsw-alias-bg-base,#0d1016);--qc-surface:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-layer-1,#141a24));--qc-card:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-layer-1,#171d28));--qc-border:var(--dsw-alias-border-l1,#242c3a);' +
        '--qc-text:var(--dsw-alias-label-primary,#e7ebf3);--qc-muted:var(--dsw-alias-label-secondary,#9aa5b8);--qc-dim:var(--dsw-alias-label-tertiary,#7d8798);--qc-accent:var(--dsw-alias-brand-primary,#6b86ff);' +
        '--qc-accent-soft:var(--dsw-alias-interactive-bg-hover-accent,#1b2440);--qc-accent-fg:var(--dsw-alias-brand-primary,#aabaff);--qc-accent-border:var(--dsw-alias-border-l1,#35426e);' +
        '--qc-ok:var(--dsw-alias-state-success-primary,#4cc38a);--qc-warn:var(--dsw-alias-state-warn-primary,#e3b341);--qc-bad:var(--dsw-alias-state-error-primary,#e06c75);--qc-line:var(--dsw-alias-border-subtle,rgba(255,255,255,.045));' +
        '--qc-input:var(--dsw-alias-input-bg,#10151d);--qc-danger-bg:var(--dsw-alias-state-error-secondary,rgba(224,108,117,.12));--qc-danger-border:var(--dsw-alias-state-danger-border,rgba(224,108,117,.4));' +
        '--qc-warn-bg:var(--dsw-alias-state-warn-secondary,rgba(227,179,65,.1));--qc-warn-border:var(--dsw-alias-state-warn-border,rgba(227,179,65,.35))}';
      React.useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById(QC_STYLE_ID)) return;
        const el = document.createElement('style');
        el.id = QC_STYLE_ID;
        el.textContent = QC_CSS;
        document.head.appendChild(el);
      }, []);
      const qBtn = (label, onClick, opts) => h('button', {
        key: (opts && opts.key) || (typeof label === 'string' ? label : undefined),
        disabled: !!(opts && opts.disabled),
        onClick,
        style: Object.assign({
          background: QC.surface, border: '1px solid ' + QC.border, borderRadius: 8,
          color: QC.text, padding: '6px 11px', fontSize: 12, lineHeight: 1.5, cursor: 'pointer',
          opacity: (opts && opts.disabled) ? 0.45 : 1
        }, (opts && opts.primary) ? { background: 'var(--dsw-alias-button-primary-fill, ' + QC.accent + ')', borderColor: 'var(--dsw-alias-button-primary-fill, ' + QC.accent + ')', color: 'var(--dsw-alias-label-primary-foreground, #fff)', fontWeight: 600 } : null, (opts && opts.style) || null)
      }, label);
      const qCard = (title, children, opts) => h('div', {
        key: (opts && opts.key) || title,
        style: { background: QC.card, border: '1px solid ' + QC.border, borderRadius: 12, padding: 16, marginBottom: 12, minWidth: 0 }
      },
        title ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          h('strong', { style: { fontSize: 13.5, fontWeight: 600, color: QC.text, letterSpacing: '-.2px' } }, title),
          (opts && opts.note) ? h('span', { style: { marginLeft: 'auto', fontSize: 10.5, color: QC.dim } }, opts.note) : null) : null,
        children);
      const qRow = (label, value, key) => h('div', {
        key: key || label,
        style: { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid ' + QC.line, fontSize: 12.5 }
      },
        h('span', { style: { color: QC.muted, flex: '0 0 auto' } }, label),
        h('span', { style: { marginLeft: 'auto', textAlign: 'right', color: QC.text, overflowWrap: 'anywhere', lineHeight: 1.6 } }, value));
      const qChip = (text, key) => h('span', {
        key: key || text,
        style: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, background: QC.accentSoft, border: '1px solid ' + QC.accentBorder, color: QC.accentFg, fontSize: 10.5, whiteSpace: 'nowrap' }
      }, text);
      const qBadge = (text, ok, key) => h('span', {
        key: key || text,
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: ok === false ? QC.bad : QC.muted, whiteSpace: 'nowrap' }
      },
        h('span', { style: { width: 6, height: 6, borderRadius: 999, background: ok === false ? QC.bad : (ok === true ? QC.ok : QC.dim) } }), text);
      const qPre = (text, key) => h('pre', {
        key,
        style: { margin: 0, padding: '10px 12px', background: QC.bg, border: '1px solid ' + QC.border, borderRadius: 8, color: QC.muted, fontSize: 11.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }
      }, text);
      const qTable = (heads, rows, key) => h('div', { key, style: { overflowX: 'auto' } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
          h('thead', null, h('tr', null, heads.map((hd) => h('th', { key: hd, style: { textAlign: 'left', fontSize: 10.5, fontWeight: 500, color: QC.dim, padding: '6px 8px', borderBottom: '1px solid ' + QC.border, whiteSpace: 'nowrap' } }, hd)))),
          h('tbody', null, rows.map((cells, ri) => h('tr', { key: ri },
            cells.map((cell, ci) => h('td', { key: ci, style: { padding: '7px 8px', borderBottom: '1px solid ' + QC.line, color: ci === 0 ? QC.text : QC.muted, verticalAlign: 'top', overflowWrap: 'anywhere' } }, cell)))))));
      const qMetrics = (items, key) => h('div', {
        key,
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(136px, 1fr))', gap: 10, marginBottom: 12 }
      }, items.map(([label, value, note]) => h('div', {
        key: label,
        style: { background: QC.surface, border: '1px solid ' + QC.border, borderRadius: 10, padding: '10px 12px', minWidth: 0 }
      },
        h('div', { style: { fontSize: 10.5, color: QC.dim, letterSpacing: '.2px' } }, label),
        h('div', { style: { fontSize: 20, fontWeight: 600, color: QC.text, margin: '3px 0 1px', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', overflowWrap: 'anywhere' } }, value),
        note ? h('div', { style: { fontSize: 10, color: QC.dim } }, note) : null)));
      const qInput = (width) => ({ background: QC.input, border: '1px solid ' + QC.border, borderRadius: 8, color: QC.text, padding: '6px 9px', fontSize: 12, width: width || undefined, outline: 'none' });

      const NAV_GROUPS = [
        { label: '总览', items: [['overview', '概览', '◈']] },
        { label: '消息', items: [['sessions', '会话', '▤'], ['slang', '黑话词库', '⌗']] },
        { label: '账号与权限', items: [['persona', '人设卡', '✎'], ['access', '访问与安全', '⊘'], ['usage', '用量与花费', '◇']] },
        { label: '仿真与运维', items: [['sim', '二代仿真', '◐'], ['ops', '调试与运维', '⚙']] }
      ];
      const SECTIONS = Object.fromEntries(QQ_SECTIONS.map(([id, label]) => [id, label]));
      const currentLabel = SECTIONS[section] || section;
      const bridgeOk = !!(bridge && bridge.alive);

      const overviewView = () => d ? [
        qMetrics([
          ['运行模式', d.mode || '—', '预设 ' + (d.mode === 'reserved2-agent' ? (d.ownerAgentPreset || 'qq-chat-agent') : (d.closedAgentPreset || '—'))],
          ['网关', (d.snowluma || {}).online ? '在线' : ((d.snowluma || {}).connected ? '半在线' : '离线'), (d.snowluma || {}).accountOnline ? '账号已登录' : '账号未登录'],
          ['角色', d.role || '—', '角色模式 ' + (d.roleMode || '—')],
          ['DSH', d.dshReady ? '就绪' : '未就绪', d.paused ? '桥接已暂停' : '运行中']
        ], 'ov-metrics'),
        qCard('运行状态', h('div', null,
          qRow('桥接地址', d.baseUrl || '—', 'base'),
          qRow('主人 QQ', String(d.ownerQQ || '—'), 'owner'),
          qRow('私聊白名单', (d.allowPrivate || []).join('、') || '（空）', 'priv'),
          qRow('群白名单', (d.allowGroups || []).join('、') || '（空）', 'grp'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 2px' } },
            h('span', { style: { fontSize: 11, color: QC.dim, alignSelf: 'center', marginRight: 2 } }, '运行模式'),
            [['reserved2', '二代仿真'], ['reserved2-agent', '二代 + Agent'], ['closed-agent', '封闭 Agent']].map(([m, label]) => qBtn(label, () => qqWrite('mode', { mode: m }), { key: 'm' + m, disabled: !!busy || d.mode === m, primary: d.mode === m }))),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 11, color: QC.dim, alignSelf: 'center', marginRight: 2 } }, '角色模式'),
            ['active', 'silent'].map((m) => qBtn(m, () => qqWrite('role-mode', { mode: m }), { key: 'r' + m, disabled: !!busy || d.roleMode === m, primary: d.roleMode === m })))
        ), { key: 'status', note: '改动立即生效' }),
        qCard('活动日志', qPre((d.activity || []).join('\n') || '（空）', 'act-pre'), { key: 'activity', note: '最新 ' + ((d.activity || []).length) + ' 条' })
      ] : [];

      const personaView = () => d ? [
        qCard('人设卡', h('div', null,
          qRow('当前角色', d.current || '—', 'cur'),
          qRow('限制', (d.limits && (d.limits.injectMaxChars + ' 字注入 · ' + d.limits.nameMax + ' 字名称 · ' + d.limits.contentMaxBytes + 'B 正文')) || '—', 'lim'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 } },
            (d.roles || []).map((name) => qBtn(name + (name === d.current ? ' · 当前' : ''), () => qqWrite('role', { role: name }), { key: name, disabled: !!busy || name === d.current, primary: name === d.current })))
        ), { key: 'roles', note: '点角色即切换' }),
        d.detail ? qCard('正文预览', h('div', null,
          h('div', { style: { fontSize: 11, color: QC.dim, marginBottom: 6 } }, '正文 ' + d.detail.chars + ' 字'),
          qPre(d.detail.preview || '（空）', 'pv'),
          (d.detail.warnings || []).length ? h('div', { style: { marginTop: 8, fontSize: 11.5, color: QC.warn } }, '提醒：' + d.detail.warnings.join('；')) : null), { key: 'detail' }) : null
      ] : [];

      const simView = () => (d && d.tools) ? [
        qMetrics([
          ['仿真', d.enabled ? '开启' : '关闭', '预设 ' + (d.agentPreset || '—')],
          ['工具', (d.tools.enabledCount || 0) + ' / ' + (d.tools.total || 0), '被关 ' + ((d.tools.disabled || []).length) + ' 个'],
          ['推荐', d.provideRecommendations ? '开' : '关', 'provideRecommendations']
        ], 'sim-metrics'),
        qCard('仿真开关', h('div', null,
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 } },
            qBtn(d.enabled ? '关闭二代仿真' : '开启二代仿真', () => qqWrite('socialV2', { patch: { enabled: !d.enabled } }), { key: 'tog', primary: !d.enabled })),
          qRow('关闭的工具', (d.tools.disabled || []).join('、') || '（无）', 'dis'),
          (d.tools.disabled || []).length ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
            h('span', { style: { fontSize: 11, color: QC.dim, alignSelf: 'center' } }, '点一下启用：'),
            d.tools.disabled.map((name) => qBtn(name, () => qqWrite('socialV2', { patch: { tools: { [name]: true } } }), { key: 'tool-' + name }))) : null
        ), { key: 'switch' }),
        qCard('参数', h('div', null,
          qRow('唤醒', qqObjLine(d.wake), 'wake'), qRow('发送', qqObjLine(d.send), 'send'), qRow('等待', qqObjLine(d.wait), 'wait'),
          qRow('上下文', qqObjLine(d.context), 'ctx'), qRow('媒体', qqObjLine(d.media), 'media'), qRow('语音', qqObjLine(d.voice), 'voice'),
          qRow('TTS', qqObjLine(d.tts), 'tts'), qRow('表情', qqObjLine(d.raw && d.raw.sticker), 'stk'),
          qRow('主动', qqObjLine(d.raw && d.raw.proactive), 'pro'), qRow('反馈', qqObjLine(d.raw && d.raw.feedback), 'fb')
        ), { key: 'params' })
      ] : [];

      const sessionsView = () => d ? [
        qCard('会话', qTable(['会话', 'DSH session', '唤醒', '未读', '最近', '最后唤醒', '她最后回复'],
          (d.rows || []).map((r) => [
            r.key + (r.owner ? ' · 主人' : ''),
            h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11 } }, (r.sessionId || '—').slice(0, 22)),
            (r.wakeMode || '—') + ' ×' + (r.wakeCount || 0),
            String(r.unread || 0),
            String(r.recent || 0),
            (r.lastWakeReason || '—') + ' · ' + qqTime(r.lastWakeAt),
            qqTime(r.lastAiReplyAt)
          ]), 'sess-tbl'), { key: 'sess', note: (d.count || 0) + ' 个会话' + ((d.orphanKeys || []).length ? ' · 未映射 ' + d.orphanKeys.length : '') })
      ] : [];

      const slangView = () => d ? [
        qCard('黑话词库', h('div', null,
          qRow('词条数', String(d.count || 0) + (d.writable ? ' · 可写' : ' · 只读'), 'cnt'),
          qRow('参数', qqObjLine(d.config), 'cfg'),
          h('div', { style: { marginTop: 10 } }, qTable(['词条', '含义', '用法', '状态', '次数'],
            (d.entries || []).map((e) => [e.content, e.meaning || '—', e.usage || '—', e.status || '—', String(e.count || 0)]), 'slang-tbl'))
        ), { key: 'slang' })
      ] : [];

      const saveWhitelist = (allowPatch) => {
        const priv = allowPatch.private || (d.allow.private || []).map(String);
        const groups = allowPatch.groups || (d.allow.groups || []).map(String);
        return qqWrite('whitelist', {
          allow: { private: priv, groups },
          deny: { private: d.deny.private || [], groups: d.deny.groups || [] },
          ownerQQ: d.ownerQQ
        });
      };
      const removeFrom = (list, value, field) => (list || []).map(String).filter((x) => x !== String(value)).map((x) => ({ [field]: x }));
      const accessView = () => (d && d.allow && d.deny) ? [
        qCard('白名单', h('div', null,
          h('div', { style: { fontSize: 11, color: QC.dim, marginBottom: 6 } }, '私聊'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 } },
            (d.allow.private || []).map((x) => h('span', { key: 'p' + x, style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
              qChip(String(x), 'pc' + x),
              qBtn('×', () => saveWhitelist({ private: removeFrom(d.allow.private, x) }), { key: 'pr' + x, disabled: !!busy, style: { padding: '2px 7px' } }))),
            h('input', { value: wlPriv, onChange: (e) => setWlPriv(e.target.value), placeholder: 'QQ 号', style: qInput(120) }),
            qBtn('添加', async () => { const r = await saveWhitelist({ private: [...(d.allow.private || []).map(String), wlPriv.trim()] }); if (r) setWlPriv(''); }, { key: 'addp', disabled: !!busy || !wlPriv.trim() })),
          h('div', { style: { fontSize: 11, color: QC.dim, marginBottom: 6 } }, '群聊'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 } },
            (d.allow.groups || []).map((x) => h('span', { key: 'g' + x, style: { display: 'inline-flex', gap: 4, alignItems: 'center' } },
              qChip(String(x), 'gc' + x),
              qBtn('×', () => saveWhitelist({ groups: removeFrom(d.allow.groups, x) }), { key: 'gr' + x, disabled: !!busy, style: { padding: '2px 7px' } }))),
            h('input', { value: wlGroup, onChange: (e) => setWlGroup(e.target.value), placeholder: '群号', style: qInput(120) }),
            qBtn('添加', async () => { const r = await saveWhitelist({ groups: [...(d.allow.groups || []).map(String), wlGroup.trim()] }); if (r) setWlGroup(''); }, { key: 'addg', disabled: !!busy || !wlGroup.trim() })),
          qRow('拒绝名单', '私聊 ' + ((d.deny.private || []).length) + ' · 群 ' + ((d.deny.groups || []).length), 'deny'),
          qRow('主人 QQ', String(d.ownerQQ || '—'), 'owner')
        ), { key: 'wl' }),
        qCard('安全', h('div', null,
          qRow('安全开关', qqObjLine(d.security), 'sec'),
          qRow('state 目录', d.stateDir ? ((d.stateDir.hardened ? '已收紧' : '未收紧') + ' · ' + d.stateDir.path) : '—', 'dir'),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 } },
            qBtn('切换拦截通知', () => qqWrite('security', { interceptNotify: !(d.security && d.security.interceptNotify !== false) }), { key: 'notify' }),
            qBtn('重试收紧 state 权限', () => qqWrite('security', { rehardenStateDir: true }), { key: 'reharden' })),
          h('div', { style: { marginTop: 8, fontSize: 11, color: QC.dim } }, '白名单/安全改动立即生效；bridge 会同步重建会话策略。')
        ), { key: 'sec' })
      ] : [];

      const usageView = () => (d && d.totals) ? [
        qMetrics([
          ['总花费', (d.symbol || '¥') + Number(d.totals.cost || 0).toFixed(3), '价目表 ' + (d.priceVersion || '—')],
          ['调用轮次', String(d.totals.turns || 0), '当前档 ' + (d.nowTier || '—')],
          ['Tokens', String(d.totals.totalTokens || 0), '约 ' + Math.round(Number(d.totals.totalTokens || 0) / 1000) + 'K'],
          ['缓存命中率', (Number(d.totals.cacheHitRate || 0) * 100).toFixed(1) + '%', 'cache hit']
        ], 'usage-metrics'),
        qCard('按会话', qTable(['会话', '轮次', 'Tokens', '花费', '模型'],
          (d.conversations || []).map((c) => [c.key, String(c.turns || 0), String(c.totalTokens || 0), (d.symbol || '¥') + Number(c.cost || 0).toFixed(3), (c.models || []).join('、') || '—']), 'usage-tbl'), { key: 'conv' }),
        qCard('口径', h('div', { style: { fontSize: 11.5, color: QC.muted, lineHeight: 1.7 } }, '记忆侧（轮转/抽取/日终）的花费在「记忆速览 → 消费账单」。'), { key: 'note' })
      ] : [];

      const opsView = () => d ? [
        qCard('诊断', h('div', null,
          qRow('桥接地址', d.baseUrl || '—'), qRow('模式 / 暂停', (d.mode || '—') + ' / ' + (d.paused ? '已暂停' : '运行中')),
          qRow('DSH 就绪', d.dshReady ? '是' : '否'), qRow('控制台令牌', d.tokenPresent ? '已配置' : '缺失'),
          qRow('会话数', String(d.conversationCount || 0))
        ), { key: 'diag' }),
        qCard('测试发送', h('div', null,
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('select', { value: testKind, onChange: (e) => setTestKind(e.target.value), style: qInput(null) },
              h('option', { value: 'private' }, '私聊'), h('option', { value: 'group' }, '群')),
            h('input', { value: testId, onChange: (e) => setTestId(e.target.value), placeholder: '目标 QQ/群号', style: qInput(120) }),
            h('input', { value: testMsg, onChange: (e) => setTestMsg(e.target.value), placeholder: '消息内容（≤500 字）', style: Object.assign(qInput(null), { flex: '1 1 220px' }) }),
            h('input', { value: testConfirm, onChange: (e) => setTestConfirm(e.target.value), placeholder: '输入 确认发送', style: qInput(110) }),
            qBtn('发送', async () => {
              const r = await qqWrite('test-send', { kind: testKind, id: Number(testId), message: testMsg, confirmText: testConfirm });
              if (r) { setTestMsg(''); setTestConfirm(''); }
            }, { key: 'send', disabled: !!busy || !testMsg.trim() || !testId.trim() || testConfirm !== '确认发送', primary: true })),
          h('div', { style: { marginTop: 8, fontSize: 11, color: QC.dim } }, '真实发到 QQ，需输入「确认发送」二次确认。')
        ), { key: 'test' }),
        qCard('重启桥接', h('div', null,
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { value: restartConfirm, onChange: (e) => setRestartConfirm(e.target.value), placeholder: '输入 确认重启', style: qInput(140) }),
            qBtn('重启 bridge', async () => {
              const r = await qqWrite('restart', { confirmText: restartConfirm });
              if (r) setRestartConfirm('');
            }, { key: 'restart', disabled: !!busy || restartConfirm !== '确认重启' })),
          h('div', { style: { marginTop: 8, fontSize: 11, color: QC.dim } }, '守护窗口会在约 5 秒后拉起。')
        ), { key: 'restart' }),
        qCard('活动日志', qPre((d.activity || []).join('\n') || '（空）', 'ops-act'), { key: 'actlog' }),
        qCard('旧控制台', h('div', { style: { fontSize: 11.5, color: QC.muted, lineHeight: 1.7 } },
          '过渡期仍可用：' + (d.baseUrl || '') + '（令牌在 bridge state/console-token，不在面板回显）。'), { key: 'legacy' })
      ] : [];

      const views = {
        overview: overviewView, persona: personaView, sim: simView, sessions: sessionsView,
        slang: slangView, access: accessView, usage: usageView, ops: opsView
      };
      const renderSection = views[section] || overviewView;
      const renderSectionSafe = () => {
        try {
          return renderSection();
        } catch (err) {
          reportClientError('qq.section.' + section, err);
          return h('div', {
            style: { color: QC.bad, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }
          }, '该分区渲染出错：' + String(err && err.message ? err.message : err));
        }
      };

      return h('div', {
        className: 'dsmp-qqc',
        style: {
          flex: '1 1 auto', minHeight: 0, display: 'flex',
          background: QC.bg, border: '1px solid ' + QC.border, borderRadius: 12,
          overflow: 'hidden', color: QC.text
        }
      },
        // 左侧控制台导航
        h('div', {
          style: { width: 200, flex: '0 0 200px', background: QC.surface, borderRight: '1px solid ' + QC.border, display: 'flex', flexDirection: 'column', minHeight: 0 }
        },
          h('div', { style: { padding: '16px 14px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 9 } },
              h('span', { style: { width: 26, height: 26, borderRadius: 8, background: QC.accentSoft, color: QC.accentFg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700 } }, 'Q'),
              h('div', null,
                h('div', { style: { fontSize: 15, fontWeight: 700, letterSpacing: '-.3px', color: QC.text } }, 'QQ Bridge'),
                h('div', { style: { fontSize: 10, color: QC.dim, marginTop: 2 } }, '桥接控制台')))),
          h('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '0 8px 8px' } },
            NAV_GROUPS.map((g) => h('div', { key: g.label },
              h('div', { style: { fontSize: 10, letterSpacing: '1px', color: QC.dim, margin: '12px 10px 5px' } }, g.label),
              g.items.map(([id, label, icon]) => h('button', {
                key: id,
                onClick: () => setSection(id),
                style: {
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '8px 10px', margin: '2px 0', border: 0, borderRadius: 8,
                  background: section === id ? QC.accentSoft : 'transparent',
                  color: section === id ? QC.accentFg : QC.muted,
                  fontSize: 12.5, textAlign: 'left', cursor: 'pointer',
                  fontWeight: section === id ? 600 : 400
                }
              }, h('span', { style: { width: 16, textAlign: 'center', fontSize: 14, opacity: .9 } }, icon), label))))),
          h('div', { style: { borderTop: '1px solid ' + QC.border, padding: '10px 14px 12px', fontSize: 10.5, color: QC.dim, lineHeight: 1.7 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { width: 6, height: 6, borderRadius: 999, background: bridgeOk ? QC.ok : QC.bad } }),
              'bridge ' + (bridge ? ':' + bridge.port : '—') + ' · ' + (bridgeOk ? '在线' : '离线')),
            h('div', null, (channel && channel.componentsPresent) ? 'components 已就位' : 'components 未就位'),
            h('div', null, ((channel && channel.active) || '—') + ' → ' + ((channel && channel.current) || '未运行')))),
        // 右侧工作区
        h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' } },
          h('div', {
            style: { height: 52, flex: '0 0 52px', borderBottom: '1px solid ' + QC.border, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', background: QC.surface }
          },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, color: QC.dim } },
              h('span', null, 'QQ 通道'),
              h('span', { style: { color: QC.border } }, '/'),
              h('span', { style: { color: QC.text, fontSize: 12 } }, currentLabel)),
            h('span', { style: { flex: 1 } }),
            qBadge('DSH ' + (d && d.dshReady ? '就绪' : '未就绪'), d ? d.dshReady : undefined),
            qBadge('账号 ' + (d && d.snowluma && d.snowluma.accountOnline ? '在线' : '离线'), d && d.snowluma ? d.snowluma.accountOnline : undefined),
            qBtn(busy ? '刷新中…' : '刷新', refreshAll, { key: 'refresh', disabled: !!busy })),
          h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '16px 20px 26px' } },
            h('div', { style: { maxWidth: 1080, margin: '0 auto' } },
              error ? h('div', {
                style: { background: QC.dangerBg, border: '1px solid ' + QC.dangerBorder, color: QC.bad, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12, lineHeight: 1.6 }
              }, error) : null,
              (!channel || !channel.componentsPresent) ? h('div', {
                style: { background: QC.warnBg, border: '1px solid ' + QC.warnBorder, color: QC.warn, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 11.5, lineHeight: 1.6 }
              },
                h('div', null, 'components 未就位：先跑 tools/dsmp-qq-migrate/apply-production.cmd，之后才能启停网关。'),
                h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 } },
                  qBtn('启动网关并连桥接', () => gatewayPost('boot', { to: (channel && channel.active) || '' }), { key: 'boot', disabled: !!busy || !channel || !channel.componentsPresent }),
                  qBtn('停止网关', () => gatewayPost('halt'), { key: 'halt', disabled: !!busy || !channel || !channel.componentsPresent }))) : null,
              channel ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 } },
                qChip('组件 ' + (channel.componentsPresent ? '已就位' : '未安装')),
                qChip('令牌 ' + (channel.tokenSet ? '已配置' : '缺失')),
                qChip('期望 ' + (channel.active || '—')),
                qChip('运行 ' + (channel.current || '—')),
                channel.lastSwitch ? qChip('上次切换 ' + (channel.lastSwitch.from || '—') + ' → ' + (channel.lastSwitch.to || '—')) : null,
                qBtn('启动网关并连桥接', () => gatewayPost('boot', { to: (channel && channel.active) || '' }), { key: 'boot2', disabled: !!busy || !channel.componentsPresent }),
                qBtn('停止网关', () => gatewayPost('halt'), { key: 'halt2', disabled: !!busy || !channel.componentsPresent })) : null,
              profiles.length ? qCard('网关', h('div', null,
                profiles.map((profile) => h('div', {
                  key: profile.name,
                  style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid ' + QC.line }
                },
                  qChip(profile.label || profile.name),
                  h('span', { style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, color: QC.muted } }, profile.httpUrl || ''),
                  profile.name === channel.active ? qChip('期望', 'e' + profile.name) : null,
                  profile.name === channel.current ? qChip('运行中', 'c' + profile.name) : null,
                  h('span', { style: { flex: 1 } }),
                  qBtn('契约自检', () => gatewayPost('probe', { name: profile.name }), { key: 'p' + profile.name, disabled: !!busy }),
                  qBtn('设为期望', () => gatewayPost('set-active', { name: profile.name }), { key: 's' + profile.name, disabled: !!busy })))
              ), { key: 'gw', note: '契约通过才允许切换' }) : null,
              loadingSec && !d ? h('div', { style: { fontSize: 12, color: QC.dim } }, '读取中…') : null,
              !loadingSec && !d && sec && sec.ok === false ? h('div', { style: { fontSize: 12, color: QC.bad } }, (sec.error || sec.code || '读取失败')) : null,
              d ? renderSectionSafe() : null)))
      );
    }


    class PanelErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        reportClientError('react.boundary', error, { componentStack: (info && info.componentStack) || '' });
      }
      render() {
        if (this.state.error) {
          return h('div', {
            style: { padding: 18, color: 'var(--dsw-alias-state-error-primary, #e06c75)', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }
          }, '面板渲染出错：' + String((this.state.error && this.state.error.message) || this.state.error));
        }
        return this.props.children;
      }
    }

    function DsmpPanel() {
      const [tab, setTab] = React.useState('chat');
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false);

      const reload = React.useCallback(() => {
        setLoading(true);
        setError(null);
        apiFetch('/api/dsmp/status', { cache: 'no-store' })
          .then(async (res) => {
            const data = await res.json();
            if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || `HTTP ${res.status}`);
            shell.label = '记忆面板';
            shell.role = (data.panel && data.panel.role && data.panel.role.name) || '';
            setStatus(data);
          })
          .catch((err) => setError(String(err && err.message ? err.message : err)))
          .finally(() => setLoading(false));
      }, []);

      // 自检结果是插件启动时算一次的缓存；「重新检查」必须真的让宿主重跑，
      // 否则只是把同一份缓存再取回来（看起来像按钮没反应）。
      const recheck = React.useCallback(async () => {
        try {
          await apiFetch('/api/dsmp/selfcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        } catch {
          /* 重跑失败时仍刷新一次状态，至少能看到旧结果 */
        }
        await reload();
      }, [reload]);

      React.useEffect(() => { reload(); }, [reload]);

      const tabs = [
        ['chat', '聊天'],
        ['history', '历史记录'],
        ['memory', ((status && status.disputes && status.disputes.pending) || 0)
          ? `记忆速览 (${status.disputes.pending})`
          : '记忆速览'],
        ['qq', 'QQ 通道'],
        ['settings', '设置']
      ];
      const failedSelf = ((status && status.selfCheck) || []).filter((row) => row && row.ok === false);

      return h('div', { style: styles.page },
        h('div', { style: styles.header },
          h('h1', { style: styles.title }, '记忆面板'),
          h('span', { style: styles.hint }, '对话 · 历史 · 记忆速览 · QQ 通道 · 设置')
        ),
        h('div', { style: styles.chips },
          h('span', { style: { ...styles.chip, color: status && status.mode === 'qq' ? colors.ok : 'inherit' } }, status ? modeText(status.mode) : '状态读取中'),
          h('span', { style: styles.chip }, status && status.panel ? status.panel.label : '记忆面板'),
          h('span', { style: styles.chip }, status ? `v${status.version}` : 'v—')
        ),
        h('div', { style: styles.tabs },
          tabs.map(([key, label]) => h('button', {
            key,
            style: tab === key ? styles.tabActive : styles.tab,
            onClick: () => setTab(key)
          }, label))
        ),
        error ? h('div', { style: styles.error }, `读取失败：${error}`) : null,
        failedSelf.length
          ? h('div', { style: { ...styles.error, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('span', null, `启动自检 ${failedSelf.length} 项待处理：${failedSelf.map((row) => row.label).join('、')}`),
            h('button', { style: styles.button, onClick: recheck }, '重新检查')
          )
          : null,
        h(PanelErrorBoundary, null,
          tab === 'chat'
            ? h(ChatTab, null)
            : tab === 'history'
              ? h(HistoryTab, null)
              : tab === 'memory'
                ? h(MemoryTab, { status, onRefresh: reload })
                : tab === 'settings'
                  ? h(SettingsTab, { status, reload, loading, onOpenMemory: () => setTab('memory') })
                  : h(QqChannelTab, null))
      );
    }

    function apply(ctx) {
      installClientErrorHooks();
      const disposers = [];
      disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'dsmp',
        order: 29,
        label: () => '记忆面板'
      }, DsmpIcon)));
      disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: 'dsmp'
      }, DsmpPanel)));
      return () => {
        for (const dispose of disposers) {
          try { dispose(); } catch { /* ignore double dispose */ }
        }
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});

