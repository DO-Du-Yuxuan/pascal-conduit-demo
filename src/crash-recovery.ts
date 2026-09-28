import { encodeUnifiedProject } from "./domain/unified-project";
import { useOverlayStore } from "./domain/store";

type RecoverySnapshot = {
  project: { raw: Record<string, unknown>; projectId?: string | null; revisionSha256?: string } | null;
  overlay: Parameters<typeof encodeUnifiedProject>[1] | null;
};

export function encodeRecoveryProject(snapshot: RecoverySnapshot) {
  if (!snapshot.project || !snapshot.overlay) return null;
  return encodeUnifiedProject(snapshot.project.raw, snapshot.overlay);
}

type RecoverySnapshotCache = { project: ReturnType<typeof encodeUnifiedProject>; snapshotAt: string; projectId: string | null; sourceSha: string | null };
let lastSuccessfulSnapshot: RecoverySnapshotCache | null = null;
let lastProjectReference = useOverlayStore.getState().project;
let lastOverlayReference = useOverlayStore.getState().overlay;

function cacheRecoveryProject(snapshot: RecoverySnapshot) {
  const project = encodeRecoveryProject(snapshot);
  if (project) lastSuccessfulSnapshot = { project, snapshotAt: new Date().toISOString(), projectId: snapshot.project?.projectId ?? null, sourceSha: snapshot.project?.revisionSha256 ?? null };
  return project;
}

// Cache only committed document-reference changes; preview updates do not encode
// large projects on every animation frame.
useOverlayStore.subscribe((state) => {
  if (state.project === lastProjectReference && state.overlay === lastOverlayReference) return;
  lastProjectReference = state.project;
  lastOverlayReference = state.overlay;
  try { cacheRecoveryProject(state); } catch (error) { console.error("[recovery-snapshot-cache-failed]", error); }
});

export function getLastSuccessfulRecoverySnapshot() {
  return lastSuccessfulSnapshot;
}

export function createRecoveryDownloadSnapshot() {
  const state = useOverlayStore.getState();
  try {
    const project = cacheRecoveryProject(state);
    if (project && lastSuccessfulSnapshot) return { ...lastSuccessfulSnapshot, usedFallback: false };
  } catch (error) {
    console.error("[recovery-snapshot-current-encode-failed]", error);
  }
  return lastSuccessfulSnapshot ? { ...lastSuccessfulSnapshot, usedFallback: true } : null;
}

export type CrashDiagnosticInput = {
  error: Error;
  componentStack: string;
  buildLabel: string;
  url: string;
  userAgent: string;
  projectId: string | null;
  sourceSha: string | null;
  projectDirty: boolean;
  overlayDirty: boolean;
  occurredAt?: string;
  recoverySnapshotAt?: string | null;
  recoveryUsedFallback?: boolean;
  recoveryProjectId?: string | null;
  recoverySourceSha?: string | null;
};

export function buildCrashDiagnostic(input: CrashDiagnosticInput) {
  let url = input.url;
  try {
    const parsed = new URL(input.url);
    // Keep the location useful for routing while avoiding query strings and fragments
    // that commonly contain credentials or private drawing identifiers.
    url = `${parsed.origin}${parsed.pathname}`;
  } catch { /* Keep a non-URL value usable in tests and unusual webviews. */ }
  return {
    reportType: "pascal-conduit-demo-render-crash",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    buildLabel: input.buildLabel,
    url,
    userAgent: input.userAgent,
    error: { name: input.error.name, message: input.error.message, stack: input.error.stack ?? "" },
    componentStack: input.componentStack,
    project: {
      projectId: input.projectId,
      sourceSha: input.sourceSha,
      projectDirty: input.projectDirty,
      overlayDirty: input.overlayDirty,
    },
    recoverySnapshot: {
      snapshotAt: input.recoverySnapshotAt ?? null,
      usedFallback: input.recoveryUsedFallback ?? false,
      projectId: input.recoveryProjectId ?? null,
      sourceSha: input.recoverySourceSha ?? null,
    },
    reactErrorUrl: /Minified React error #185\b/.test(input.error.message) ? "https://react.dev/errors/185" : null,
  };
}

export function explainReactError(message: string) {
  return /(?:Minified React error #185\b|Maximum update depth exceeded)/.test(message)
    ? "React 检测到组件更新深度超限：某个状态更新反复触发重新渲染，形成循环。诊断报告中的组件栈可定位相关组件，调用栈中的 bundle 行列可结合构建提交号和 source map 对应到源码。"
    : "页面组件渲染时抛出了未捕获错误。诊断报告中的错误调用栈、React 组件栈和构建提交号可帮助定位源码。";
}
