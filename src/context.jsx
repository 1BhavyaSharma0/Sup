import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { enqueue, getQueue, queueCount, removeQueue, setLocalProgress } from "./offline";

const Ctx = createContext(null);
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => read("ls_user"));
  const [token, setToken] = useState(() => localStorage.getItem("ls_token"));
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const tokenRef = useRef(token); tokenRef.current = token;

  const logout = useCallback(() => { setUser(null); setToken(null); localStorage.removeItem("ls_user"); localStorage.removeItem("ls_token"); }, []);

  const request = useCallback(async (url, options = {}) => {
    const isForm = options.body instanceof FormData;
    let res;
    try {
      res = await fetch(url, { ...options, headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {}), ...(options.headers || {}) } });
    } catch { throw Object.assign(new Error("You're offline or the server can't be reached."), { offline: true }); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && tokenRef.current) { logout(); throw new Error(data.error || "Please sign in again."); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: res.status });
    return data;
  }, [logout]);

  const setSession = d => { setUser(d.user); setToken(d.token); localStorage.setItem("ls_user", JSON.stringify(d.user)); localStorage.setItem("ls_token", d.token); };
  const auth = async (path, body) => { setLoading(true); try { setSession(await request(path, { method: "POST", body: JSON.stringify(body) })); } finally { setLoading(false); } };
  const login = (email, password) => auth("/api/auth/login", { email, password });
  const register = payload => auth("/api/auth/register", payload);
  const updateUser = u => { setUser(u); localStorage.setItem("ls_user", JSON.stringify(u)); };

  const refreshPending = useCallback(() => queueCount().then(setPending).catch(() => setPending(0)), []);
  useEffect(() => { refreshPending(); }, [refreshPending, user]);

  const queueAttempt = useCallback(async a => { await enqueue("attempt", a); refreshPending(); }, [refreshPending]);
  const queueProgress = useCallback(async p => { await enqueue("progress", p); if (p.course_id) await setLocalProgress(p.course_id, p.topic_id, p.completed, p.updated_at).catch(() => {}); refreshPending(); }, [refreshPending]);

  /** Uploads everything done offline. The server grades attempts and merges progress (newest wins). */
  const syncNow = useCallback(async () => {
    if (!tokenRef.current || user?.role !== "student" || !navigator.onLine) return null;
    const queue = await getQueue();
    if (!queue.length) return null;
    setSyncing(true);
    try {
      const attempts = queue.filter(i => i.type === "attempt").map(i => i.payload);
      const progress = queue.filter(i => i.type === "progress").map(i => i.payload);
      const out = await request("/api/sync", { method: "POST", body: JSON.stringify({ attempts, progress }) });
      await removeQueue(queue.map(i => i.id));
      const msg = `Synced ${out.attempts.length} quiz attempt${out.attempts.length === 1 ? "" : "s"} and ${out.progress.applied} progress update${out.progress.applied === 1 ? "" : "s"}.${out.failed.length ? ` ${out.failed.length} could not be saved (${out.failed[0].error}).` : ""}`;
      setSyncMsg(msg); refreshPending();
      return out;
    } catch (e) { if (!e.offline) setSyncMsg(`Sync failed: ${e.message}`); return null; }
    finally { setSyncing(false); }
  }, [request, user, refreshPending]);

  useEffect(() => {
    const on = () => { setOnline(true); syncNow(); }, off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    const timer = setInterval(() => { if (navigator.onLine) syncNow(); }, 60_000);
    syncNow();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(timer); };
  }, [syncNow]);

  return <Ctx.Provider value={{ user, token, loading, login, register, logout, request, updateUser, online, pending, syncing, syncMsg, clearSyncMsg: () => setSyncMsg(""), syncNow, queueAttempt, queueProgress, refreshPending }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
