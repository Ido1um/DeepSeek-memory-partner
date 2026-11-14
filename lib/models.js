/**
 * Model / API catalog for the settings tab.
 *
 * The host owns the authoritative registry (`ctx.llm` and `ctx.agentDefaultModel`),
 * so DSMP never parses cordis.patch.yml for this: whatever providers are actually
 * mounted is exactly what the panel offers.
 */

function safeGet(ctx, service) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(service) : undefined;
  } catch {
    return undefined;
  }
}

export function currentSelection(ctx) {
  const svc = safeGet(ctx, 'agentDefaultModel');
  if (!svc || typeof svc.currentSelection !== 'function') return null;
  try {
    const sel = svc.currentSelection();
    if (!sel) return null;
    return {
      provider: String(sel.provider || ''),
      model: String(sel.model || ''),
      reasoningEffort: sel.reasoningEffort ? String(sel.reasoningEffort) : ''
    };
  } catch {
    return null;
  }
}

export function listProviders(ctx) {
  const llm = safeGet(ctx, 'llm');
  if (!llm || typeof llm.listProviders !== 'function') return [];
  try {
    return (llm.listProviders() || []).map((p) => ({ id: String(p.id), name: String(p.name || p.id) }));
  } catch {
    return [];
  }
}

export async function listModels(ctx, provider) {
  const llm = safeGet(ctx, 'llm');
  if (!llm || typeof llm.listModels !== 'function') return { models: [], error: 'llm service unavailable' };
  try {
    const models = await llm.listModels(provider);
    return {
      models: (models || []).map((m) => ({
        id: String(m.id),
        name: String(m.name || m.id),
        description: m.description ? String(m.description) : '',
        inputModalities: Array.isArray(m.inputModalities) ? m.inputModalities.map(String) : []
      }))
    };
  } catch (err) {
    return { models: [], error: String(err && err.message ? err.message : err) };
  }
}

/**
 * Full catalog: every mounted provider with the models it advertises, plus the
 * host default selection and DSMP's own override (if the owner picked one).
 */
export async function modelCatalog(ctx, settings) {
  const providers = listProviders(ctx);
  const enriched = [];
  for (const provider of providers) {
    const { models, error } = await listModels(ctx, provider.id);
    enriched.push({ ...provider, models, ...(error ? { error } : {}) });
  }
  const host = currentSelection(ctx);
  const override = {
    provider: settings && settings.chat ? String(settings.chat.provider || '') : '',
    model: settings && settings.chat ? String(settings.chat.model || '') : ''
  };
  // 面板与 QQ 会话真正用的是 override（面板直连/新建会话时显式传 agentOptions），
  // 宿主默认只在没有 override 时兜底。旧字段 current 保留 = 生效值，避免客户端旧版本错乱。
  const effective = override.provider && override.model ? { provider: override.provider, model: override.model } : host;
  return {
    ok: true,
    providers: enriched,
    host,
    override,
    effective,
    current: effective,
    at: new Date().toISOString()
  };
}

/** Resolve the agentOptions a new DSMP session should be created with. */
export function agentOptionsFor(settings, explicit) {
  const provider = String((explicit && explicit.provider) || (settings.chat && settings.chat.provider) || '');
  const model = String((explicit && explicit.model) || (settings.chat && settings.chat.model) || '');
  const out = {};
  if (provider) out.provider = provider;
  if (model) out.model = model;
  return out;
}
