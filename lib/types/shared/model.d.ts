/**
 * Pure, dependency-free model shared by the Host half and the browser half of
 * dsh-archive-manager. Everything here is deterministic so it can be unit
 * tested with `node --test` without a running Harness.
 */
/** One archived Session as this plugin presents it. */
export interface ArchivedSessionView {
    readonly sessionId: string;
    /** Session title; `null` when the Session has no title projection yet. */
    readonly title: string | null;
    /** Session working directory (the project path); `null` for cwd-less Sessions. */
    readonly cwd: string | null;
    /** Owning Workspace id, when a Workspace accounts for this Session. */
    readonly workspaceId: string | null;
    /** Owning Workspace display title, when known. */
    readonly workspaceTitle: string | null;
    /** Session creation time, epoch milliseconds. */
    readonly createdAt: number;
    /** Last known activity time, epoch milliseconds. */
    readonly updatedAt: number;
    /** On-disk footprint of the Session directory in bytes, when measurable. */
    readonly bytes: number | null;
    /** Parent Session id, for subagent-origin Sessions. */
    readonly parentSessionId: string | null;
    /** The Session's log still exists on disk (the Host could read its header). */
    readonly persisted: boolean;
    /** The Session is loaded in the Host process right now. */
    readonly live: boolean;
    /** An Agent is running a turn for this Session right now. */
    readonly running: boolean;
    /** Active work kinds reported by the Harness (`turn`/`job`/`subagent`/`schedule`). */
    readonly activity: readonly string[];
}
/**
 * A row whose log is gone from disk but that is still held by the archive set
 * (a tombstone that keeps the sidebar hiding it) and/or by the Host process.
 */
export declare function isResidue(session: ArchivedSessionView): boolean;
/** A group of archived Sessions shown under one project heading. */
export interface ArchiveGroup {
    /** `__none__` for the "no project" group, otherwise the Workspace id. */
    readonly key: string;
    /** Heading text: the Workspace title, or the localized "no project" label. */
    readonly title: string;
    readonly sessions: readonly ArchivedSessionView[];
}
/** Sort order of the archived list. */
export type ArchiveSort = 'updated' | 'created' | 'title';
/** Chat scope: every archived chat, only chats inside a project, or only those without one. */
export type ArchiveScope = 'all' | 'project' | 'none';
/** Project filter: every Session, only cwd-less Sessions, or one Workspace. */
export type ArchiveProjectFilter = '__all__' | '__none__' | string;
/** Filter + sort request the browser half sends (all fields optional). */
export interface ArchiveQuery {
    readonly search?: string;
    readonly sort?: ArchiveSort;
    readonly project?: ArchiveProjectFilter;
    readonly scope?: ArchiveScope;
}
export declare const NO_PROJECT_KEY = "__none__";
export declare const ALL_PROJECTS_KEY = "__all__";
/**
 * Encode an arbitrary string as one safe path segment, mirroring the Harness
 * session-persistence layout so a Session directory can be found without the
 * persistence backend handing us a path.
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export declare function encodeSegment(raw: string): string;
/**
 * Build the human-navigable project directory name for a working directory,
 * mirroring `projectKey` in the Harness JSONL persistence backend: separator
 * runs collapse to one `-`, unsafe code units use the `~XXXX` escape, and the
 * result is wrapped in `--` and bounded to 251 characters.
 * @param cwd - the Session working directory.
 * @returns the project directory name beneath the sessions root.
 */
export declare function projectKey(cwd: string): string;
/** Display title for a row: the Session title, or `fallback` when it has none. */
export declare function sessionDisplayTitle(session: ArchivedSessionView, fallback: string): string;
/**
 * Apply the browser half's query to the archived list.
 * @param sessions - every archived Session the Host knows about.
 * @param query - search text, sort order and project filter.
 * @returns the filtered, sorted list (a new array).
 */
export declare function selectArchivedSessions(sessions: readonly ArchivedSessionView[], query?: ArchiveQuery): ArchivedSessionView[];
/**
 * Group the selected Sessions for display. Sessions whose Workspace is unknown
 * (or that belong to no Workspace) fall into one trailing "no project" group.
 * @param sessions - the already filtered and sorted list.
 * @param noProjectTitle - localized heading for the cwd-less/unknown group.
 * @returns groups in list order, with the "no project" group last.
 */
export declare function groupArchivedSessions(sessions: readonly ArchivedSessionView[], noProjectTitle: string): ArchiveGroup[];
/**
 * Distinct project choices for the project menu, derived from the full archived
 * list so the menu never depends on the current search.
 * @param sessions - every archived Session.
 * @returns one option per owning Workspace, plus the "no project" option.
 */
export declare function projectOptions(sessions: readonly ArchivedSessionView[]): Array<{
    key: string;
    title: string;
}>;
/**
 * Human-readable byte count, matching the Harness' own fileSizeText wording
 * closely enough for a management page.
 * @param bytes - non-negative byte count.
 * @returns a short label such as `1.4 MB`.
 */
export declare function formatBytes(bytes: number): string;
