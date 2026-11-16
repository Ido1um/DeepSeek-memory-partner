/**
 * Panel turn lifecycle.
 *
 * The cross-instance lock, the in-memory busy marker and the ledger record are
 * one unit: a panel send that fails before `beginTurn` (or whose `composeChatPrompt`
 * throws) must still release everything, otherwise the session is stuck for the
 * 180s TTL. Keeping the three pieces together here also makes the failure paths
 * unit-testable without booting the plugin host.
 */
export function createPanelTurns({ panelLock, panelBusy, panelTurns }) {
  const forget = (sessionId) => {
    try {
      panelLock.release(sessionId);
    } catch {
      /* release is best-effort: a missing lock file is the desired end state */
    }
    panelBusy.delete(sessionId);
    const rec = panelTurns.get(sessionId) || null;
    panelTurns.delete(sessionId);
    return rec;
  };

  return {
    /** Register the turn before anything that can throw. */
    open(sessionId, { key = '', at = Date.now() } = {}) {
      const rec = { key: String(key || ''), reply: '', at, ledger: false };
      panelTurns.set(sessionId, rec);
      return rec;
    },
    /** Only a successful ledger `beginTurn` may be finished at turn/end. */
    markLedger(sessionId, ok) {
      const rec = panelTurns.get(sessionId);
      if (rec) rec.ledger = Boolean(ok);
      return rec || null;
    },
    recordReply(sessionId, text) {
      const rec = panelTurns.get(sessionId);
      if (rec && text) rec.reply = text;
      return rec || null;
    },
    get(sessionId) {
      return panelTurns.get(sessionId) || null;
    },
    /**
     * Release lock + busy + record. `shouldFinish` tells the caller whether a
     * ledger finishTurn is owed (record existed AND the ledger begin succeeded).
     */
    close(sessionId, { reason = 'completed', reply = null, finish = true } = {}) {
      const rec = forget(sessionId);
      const shouldFinish = Boolean(finish && rec && rec.ledger && rec.key);
      return { rec, shouldFinish, reply: reply == null ? (rec ? rec.reply : '') : reply };
    }
  };
}
