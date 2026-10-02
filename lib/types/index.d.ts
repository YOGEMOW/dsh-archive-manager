/**
 * dsh-archive-manager — Host half.
 *
 * DeepSeek Harness archives a Session by adding its id to the registry-global
 * `archivedSessionIds` set. Everything else about an archived Session is
 * ordinary session storage, and the Harness deliberately ships **no deletion
 * or retention API** ("Nothing deletes session files" — session-persistence-jsonl).
 *
 * This plugin adds the two things that are missing around that archive set:
 *
 *  1. a Host route that describes the archived Sessions richly enough for a
 *     management page (title, project, timestamps, on-disk footprint, live
 *     state), and
 *  2. permanent deletion: unarchive → detach from its Workspace accounting →
 *     remove the Session directory and its projection-cache row, letting the
 *     SQLite search index reconcile itself on its next pass.
 *
 * The Host half deliberately imports nothing from `@deepseek-ai/*` at runtime:
 * a third-party plugin resolves its own dependencies, and the DSH packages are
 * provided by the application, not by the profile. Only Node built-ins and the
 * cordis context are used.
 */
import { type ArchivedSessionView } from './shared/model.ts';
export declare const name = "dsh-archive-manager";
/** Route prefix owned by this plugin. */
export declare const ROUTE_PREFIX = "/dsh-archive-manager";
/** Injectable configuration (all optional). */
export interface Config {
    /**
     * Refuse to delete a Session whose Agent is running a turn. Defaults to
     * `true`. Idle Sessions that merely sit in memory are deletable: the archive
     * record then stays behind as the tombstone that keeps the workspace hiding
     * them until the Host process releases them.
     */
    skipRunningSessions?: boolean;
    /** @deprecated Use {@link Config.skipRunningSessions}; kept for existing configs. */
    skipLiveSessions?: boolean;
    /** Maximum number of Sessions deleted per request. Defaults to 500. */
    maxDeleteBatch?: number;
}
interface SessionHeaderLike {
    readonly id: string;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly parentSession?: string;
    readonly isSeeded?: boolean;
}
interface SessionTitleSnapshotLike {
    readonly title: string;
    readonly updatedAt?: number;
}
type SessionTitleObservationResultLike = {
    readonly sessionId: string;
    readonly status: 'fulfilled';
    readonly value: {
        readonly title?: SessionTitleSnapshotLike;
    };
} | {
    readonly sessionId: string;
    readonly status: 'rejected';
    readonly reason?: unknown;
};
interface SessionPersistenceSnapshotLike {
    readonly header: SessionHeaderLike;
}
interface SessionPersistenceLike {
    stat(id: string, options?: unknown): Promise<SessionPersistenceSnapshotLike | undefined>;
    /** Present on the shipped JSONL backend; not part of the abstract seam. */
    locate?(meta: SessionHeaderLike): {
        readonly path?: string;
    } | undefined;
}
interface SessionQueryLike {
    readTitleSnapshots?(sessionIds: readonly string[], signal?: AbortSignal): Promise<readonly SessionTitleObservationResultLike[]>;
    readTitle?(sessionId: string, signal?: AbortSignal): Promise<SessionTitleSnapshotLike | undefined>;
}
interface WorkspaceLike {
    readonly id: string;
    readonly path: string;
    readonly title: string;
    readonly sessionIds: readonly string[];
}
interface WorkspaceRegistryLike {
    readonly archivedSessionIds: readonly string[];
    list(): WorkspaceLike[];
    unarchiveSession(sessionId: string): Promise<void>;
}
interface SessionsLike {
    get(id: string): {
        readonly header: SessionHeaderLike;
    } | undefined;
}
interface AgentLike {
    /** `'running'` while a turn is executing; anything else is loaded-but-idle. */
    readonly status?: string;
}
interface AgentsLike {
    get(id: string): AgentLike | undefined;
}
/** One table of a mounted storage domain. */
interface StorageTableLike {
    delete(key: string): void | Promise<void>;
}
interface StorageDomainLike {
    table(name: string): StorageTableLike | undefined;
}
interface StorageDomainHubLike {
    get(name: string): StorageDomainLike | undefined;
}
interface LoggerLike {
    info?(message: string): void;
    warn?(message: string): void;
    debug?(message: string): void;
}
interface HostContext {
    effect(callback: () => (() => void | Promise<void>) | void, label?: string): void;
    inject(services: string[], callback: (ctx: HostContext) => void): void;
    get(name: string): unknown;
    /** Cordis event emit; `api-session/*` names are forwarded to every client. */
    emit?(name: string, ...args: unknown[]): void;
    /** Cordis waterfall dispatch, used for the Harness' own activity providers. */
    waterfall?(name: string, ...args: unknown[]): Promise<unknown>;
    logger?: LoggerLike;
}
/** Resolve the Harness home the same way `@deepseek-ai/dsh-home-paths` does. */
export declare function resolveHarnessHome(env?: NodeJS.ProcessEnv): string;
/** The sessions root a JSONL persistence backend is configured with. */
export declare function sessionsRoot(env?: NodeJS.ProcessEnv): string;
/** Locate one Session's directory, preferring the persistence backend's own answer. */
export declare function locateSessionDir(sessionId: string, header: SessionHeaderLike | undefined, persistence: SessionPersistenceLike | undefined, env?: NodeJS.ProcessEnv): Promise<string | null>;
interface DeleteOutcome {
    readonly sessionId: string;
    readonly status: 'deleted' | 'skipped-running' | 'missing' | 'failed';
    readonly detail?: string;
    /** The Session is still loaded in the Host process after its log was removed. */
    readonly residue?: boolean;
}
interface HostServices {
    readonly registry: WorkspaceRegistryLike | undefined;
    readonly query: SessionQueryLike | undefined;
    readonly persistence: SessionPersistenceLike | undefined;
    readonly sessions: SessionsLike | undefined;
    readonly agents: AgentsLike | undefined;
    readonly storageDomain?: StorageDomainHubLike;
    readonly log: LoggerLike | undefined;
    /**
     * Active work for one Session, in the Harness' own vocabulary
     * (`turn` / `job` / `subagent` / `schedule`) — the answer the workspace
     * registry itself uses to decide whether a Session may be archived.
     */
    readonly readActivity?: (sessionId: string) => Promise<readonly string[]>;
    /**
     * Publish the forwarded `api-session/removed` event. `@deepseek-ai/dsh-api-remotes`
     * forwards it to every connected browser, where the Session controller drops
     * the row from its list snapshot — the only way a file-level deletion can
     * reach an already-connected client without a reload.
     */
    readonly announceRemoved?: (sessionId: string) => void;
}
/** Assemble the archived-session views for the management page. */
export declare function listArchivedSessions(services: HostServices, env?: NodeJS.ProcessEnv): Promise<ArchivedSessionView[]>;
/**
 * Permanently delete archived Sessions.
 *
 * Three rules, each of which exists because of a failure mode this plugin hit
 * in practice:
 *
 * 1. **Never unarchive while the Session is loaded.** DSH hides archived rows
 *    from the workspace, so dropping the archive id is what made a deleted
 *    Session "come back" in the sidebar. The id is released only once the
 *    Session is gone from the Host process too — then nothing can resurrect it.
 * 2. **Announce the removal.** The browser's Session list is a snapshot: a file
 *    disappearing produces no frame, so the client keeps the row. Emitting the
 *    forwarded `api-session/removed` event removes it live, in every window.
 * 3. **Skip only what is actually running.** `ctx.sessions` holds *loaded*
 *    Sessions, including idle ones; the running question is the Agent's
 *    `status`, exactly as the Session controller answers it.
 */
export declare function deleteArchivedSessions(services: HostServices, ids: readonly string[], options?: {
    skipRunning: boolean;
    maxBatch: number;
    env?: NodeJS.ProcessEnv;
}): Promise<DeleteOutcome[]>;
/**
 * Release the archive records of Sessions whose logs are already gone.
 *
 * `deleteArchivedSessions` keeps such a record only while the Session is still
 * loaded (the record is what keeps the workspace hiding it). Once the Host
 * process has released it, the record is pure residue and can be dropped —
 * but only then, or the row would reappear.
 */
export declare function purgeArchiveRecords(services: HostServices, ids: readonly string[], env?: NodeJS.ProcessEnv): Promise<Array<{
    sessionId: string;
    status: 'purged' | 'kept' | 'failed';
    detail?: string;
}>>;
/**
 * Register the archive-manager HTTP surface.
 * @param ctx - Host context that may acquire the web server and session services.
 * @param config - Optional loader configuration.
 */
export declare function apply(ctx: HostContext, config?: Config): void;
export {};
