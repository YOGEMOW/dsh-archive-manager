window.__ModuleLoader__.load({ id: "dsh-archive-manager", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/shared/model.ts
		const NO_PROJECT_KEY = "__none__";
		const ALL_PROJECTS_KEY = "__all__";
		/** Display title for a row: the Session title, or `fallback` when it has none. */
		function sessionDisplayTitle(session, fallback) {
			const title = session.title?.trim();
			return title !== void 0 && title.length > 0 ? title : fallback;
		}
		/** Case-insensitive substring match over title, directory and session id. */
		function matchesQuery(session, needle) {
			if (needle.length === 0) return true;
			return `${session.title ?? ""}\n${session.cwd ?? ""}\n${session.sessionId}`.toLowerCase().includes(needle);
		}
		/** True when a Session survives the project filter. */
		function matchesProject(session, project) {
			if (project === "__all__") return true;
			if (project === "__none__") return session.workspaceId === null;
			return session.workspaceId === project;
		}
		/** True when a Session survives the chat-scope filter. */
		function matchesScope(session, scope) {
			if (scope === "project") return session.cwd !== null;
			if (scope === "none") return session.cwd === null;
			return true;
		}
		/** Compare two Sessions according to the requested sort order. */
		function compareSessions(a, b, sort) {
			if (sort === "created") return b.createdAt - a.createdAt || a.sessionId.localeCompare(b.sessionId);
			if (sort === "title") {
				const at = (a.title ?? "").toLowerCase();
				const bt = (b.title ?? "").toLowerCase();
				return at.localeCompare(bt) || b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId);
			}
			return b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId);
		}
		/**
		* Apply the browser half's query to the archived list.
		* @param sessions - every archived Session the Host knows about.
		* @param query - search text, sort order and project filter.
		* @returns the filtered, sorted list (a new array).
		*/
		function selectArchivedSessions(sessions, query = {}) {
			const needle = (query.search ?? "").trim().toLowerCase();
			const project = query.project ?? "__all__";
			const scope = query.scope ?? "all";
			const sort = query.sort ?? "updated";
			return sessions.filter((session) => matchesScope(session, scope) && matchesProject(session, project) && matchesQuery(session, needle)).sort((a, b) => compareSessions(a, b, sort));
		}
		/**
		* Group the selected Sessions for display. Sessions whose Workspace is unknown
		* (or that belong to no Workspace) fall into one trailing "no project" group.
		* @param sessions - the already filtered and sorted list.
		* @param noProjectTitle - localized heading for the cwd-less/unknown group.
		* @returns groups in list order, with the "no project" group last.
		*/
		function groupArchivedSessions(sessions, noProjectTitle) {
			const groups = /* @__PURE__ */ new Map();
			for (const session of sessions) {
				const key = session.workspaceId ?? "__none__";
				const bucket = groups.get(key);
				if (bucket === void 0) groups.set(key, [session]);
				else bucket.push(session);
			}
			const ordered = [];
			for (const [key, bucket] of groups) {
				if (key === "__none__") continue;
				const first = bucket[0];
				ordered.push({
					key,
					title: first?.workspaceTitle !== null && first?.workspaceTitle !== void 0 ? first.workspaceTitle : key,
					sessions: bucket
				});
			}
			const none = groups.get(NO_PROJECT_KEY);
			if (none !== void 0) ordered.push({
				key: NO_PROJECT_KEY,
				title: noProjectTitle,
				sessions: none
			});
			return ordered;
		}
		/**
		* Distinct project choices for the project menu, derived from the full archived
		* list so the menu never depends on the current search.
		* @param sessions - every archived Session.
		* @returns one option per owning Workspace, plus the "no project" option.
		*/
		function projectOptions(sessions) {
			const seen = /* @__PURE__ */ new Map();
			let hasNone = false;
			for (const session of sessions) {
				if (session.workspaceId === null) {
					hasNone = true;
					continue;
				}
				if (!seen.has(session.workspaceId)) seen.set(session.workspaceId, session.workspaceTitle ?? session.workspaceId);
			}
			const options = [...seen].map(([key, title]) => ({
				key,
				title
			})).sort((a, b) => a.title.localeCompare(b.title));
			if (hasNone) options.push({
				key: NO_PROJECT_KEY,
				title: ""
			});
			return options;
		}
		/**
		* Human-readable byte count, matching the Harness' own fileSizeText wording
		* closely enough for a management page.
		* @param bytes - non-negative byte count.
		* @returns a short label such as `1.4 MB`.
		*/
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes < 0) return "—";
			if (bytes < 1024) return `${Math.round(bytes)} B`;
			const units = [
				"KB",
				"MB",
				"GB",
				"TB"
			];
			let value = bytes / 1024;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			const digits = value < 10 ? 1 : 0;
			return `${value.toFixed(digits)} ${units[unit] ?? "TB"}`;
		}
		//#endregion
		//#region \0dsh-archive-css:src/client/ArchiveManager.module.css.mjs
		const css = ".Bs7WzW_page{height:100%;min-height:0;color:var(--dsw-alias-label-primary);flex-direction:column;font-size:14px;display:flex}.Bs7WzW_head{justify-content:space-between;align-items:center;gap:12px;padding:4px 2px 14px;display:flex}.Bs7WzW_title{letter-spacing:.2px;margin:0;font-size:20px;font-weight:600;line-height:28px}.Bs7WzW_deleteAll{height:30px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:0;border-radius:8px;align-items:center;gap:6px;padding:0 10px;font-size:13px;font-weight:500;display:inline-flex}.Bs7WzW_deleteAll:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}.Bs7WzW_deleteAll:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}.Bs7WzW_toolbar{align-items:center;gap:8px;padding-bottom:14px;display:flex}.Bs7WzW_search{flex:auto;min-width:0;position:relative}.Bs7WzW_searchIcon{color:var(--dsw-alias-label-secondary);pointer-events:none;display:inline-flex;position:absolute;top:50%;transform:translateY(-50%)}.Bs7WzW_searchIcon:not(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){left:10px}.Bs7WzW_searchIcon:-webkit-any(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){right:10px}.Bs7WzW_searchIcon:is(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){right:10px}.Bs7WzW_searchInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);width:100%;height:32px;color:var(--dsw-alias-label-primary);font:inherit;border-radius:16px;outline:none;padding:0 12px 0 32px;font-size:13px}.Bs7WzW_searchInput::placeholder{color:var(--dsw-alias-label-secondary)}.Bs7WzW_searchInput:focus{border-color:var(--dsw-alias-border-l2)}.Bs7WzW_menuAnchor{flex:none;position:relative}.Bs7WzW_menuButton{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);max-width:190px;height:32px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:16px;align-items:center;gap:6px;padding:0 10px;font-size:13px;display:inline-flex}.Bs7WzW_menuButton:hover{background:var(--dsw-alias-bg-layer-2)}.Bs7WzW_menuLabel{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.Bs7WzW_menuSurface{z-index:20;top:calc(100% + 6px);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);border-radius:10px;min-width:180px;max-height:280px;padding:4px;position:absolute;overflow-y:auto;box-shadow:0 8px 24px #0000001f}.Bs7WzW_menuSurface:not(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){left:0}.Bs7WzW_menuSurface:-webkit-any(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){right:0}.Bs7WzW_menuSurface:is(:lang(ae),:lang(ar),:lang(arc),:lang(bcc),:lang(bqi),:lang(ckb),:lang(dv),:lang(fa),:lang(glk),:lang(he),:lang(ku),:lang(mzn),:lang(nqo),:lang(pnb),:lang(ps),:lang(sd),:lang(ug),:lang(ur),:lang(yi)){right:0}.Bs7WzW_menuOption{width:100%;color:var(--dsw-alias-label-primary);font:inherit;text-align:start;cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:space-between;align-items:center;gap:8px;padding:7px 8px;font-size:13px;display:flex}.Bs7WzW_menuOption:hover{background:var(--dsw-alias-bg-layer-2)}.Bs7WzW_menuOption[data-active=true]{font-weight:600}.Bs7WzW_body{flex:auto;min-height:0;padding-bottom:8px;overflow-y:auto}.Bs7WzW_group+.Bs7WzW_group{margin-top:18px}.Bs7WzW_groupHead{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;padding:0 2px 8px;font-size:13px;display:flex}.Bs7WzW_groupTitle{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.Bs7WzW_groupCount{color:var(--dsw-alias-label-secondary);flex:none;margin-inline-start:auto;font-size:12px}.Bs7WzW_list{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;margin:0;padding:0;list-style:none;overflow:hidden}.Bs7WzW_row{align-items:center;gap:10px;padding:9px 12px;display:flex}.Bs7WzW_row+.Bs7WzW_row{border-top:1px solid var(--dsw-alias-border-l1)}.Bs7WzW_rowMain{flex:auto;min-width:0}.Bs7WzW_rowTitleLine{align-items:center;gap:6px;min-width:0;display:flex}.Bs7WzW_rowTitle{text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;overflow:hidden}.Bs7WzW_badge{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);color:var(--dsw-alias-state-success-primary);border-radius:999px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}.Bs7WzW_rowTime{color:var(--dsw-alias-label-secondary);margin-top:1px;font-size:12px;line-height:17px}.Bs7WzW_badgeLoaded{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}.Bs7WzW_residueHint{color:var(--dsw-alias-label-secondary);padding:0 2px 8px;font-size:12px;line-height:17px}.Bs7WzW_rowActions{flex:none;align-items:center;gap:4px;display:flex}.Bs7WzW_iconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;justify-content:center;align-items:center;display:inline-flex}.Bs7WzW_iconButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}.Bs7WzW_secondaryButton{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:8px;align-items:center;padding:0 10px;font-size:12px;display:inline-flex}.Bs7WzW_secondaryButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.Bs7WzW_iconButton:disabled,.Bs7WzW_secondaryButton:disabled,.Bs7WzW_menuButton:disabled{opacity:.5;cursor:default}.Bs7WzW_state{text-align:center;color:var(--dsw-alias-label-secondary);flex-direction:column;justify-content:center;align-items:center;gap:8px;padding:56px 24px;display:flex}.Bs7WzW_stateIcon{color:var(--dsw-alias-label-secondary)}.Bs7WzW_stateTitle{color:var(--dsw-alias-label-primary);font-size:14px}.Bs7WzW_stateHint{max-width:340px;font-size:12px;line-height:18px}.Bs7WzW_retryButton{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;border-radius:8px;margin-top:4px;padding:0 12px;font-size:12px}.Bs7WzW_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}";
		const tagId = "dsh-archive-manager/ArchiveManager.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-archive-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ArchiveManager_module_css_default = {
			"badge": "Bs7WzW_badge",
			"badgeLoaded": "Bs7WzW_badgeLoaded",
			"body": "Bs7WzW_body",
			"deleteAll": "Bs7WzW_deleteAll",
			"group": "Bs7WzW_group",
			"groupCount": "Bs7WzW_groupCount",
			"groupHead": "Bs7WzW_groupHead",
			"groupTitle": "Bs7WzW_groupTitle",
			"head": "Bs7WzW_head",
			"iconButton": "Bs7WzW_iconButton",
			"list": "Bs7WzW_list",
			"menuAnchor": "Bs7WzW_menuAnchor",
			"menuButton": "Bs7WzW_menuButton",
			"menuLabel": "Bs7WzW_menuLabel",
			"menuOption": "Bs7WzW_menuOption",
			"menuSurface": "Bs7WzW_menuSurface",
			"page": "Bs7WzW_page",
			"residueHint": "Bs7WzW_residueHint",
			"retryButton": "Bs7WzW_retryButton",
			"row": "Bs7WzW_row",
			"rowActions": "Bs7WzW_rowActions",
			"rowMain": "Bs7WzW_rowMain",
			"rowTime": "Bs7WzW_rowTime",
			"rowTitle": "Bs7WzW_rowTitle",
			"rowTitleLine": "Bs7WzW_rowTitleLine",
			"search": "Bs7WzW_search",
			"searchIcon": "Bs7WzW_searchIcon",
			"searchInput": "Bs7WzW_searchInput",
			"secondaryButton": "Bs7WzW_secondaryButton",
			"state": "Bs7WzW_state",
			"stateHint": "Bs7WzW_stateHint",
			"stateIcon": "Bs7WzW_stateIcon",
			"stateTitle": "Bs7WzW_stateTitle",
			"title": "Bs7WzW_title",
			"toolbar": "Bs7WzW_toolbar",
			"visuallyHidden": "Bs7WzW_visuallyHidden"
		};
		//#endregion
		//#region src/client/ArchiveManagerSection.tsx
		/**
		* The archived-chats page: search, scope/project filters, grouped rows, and the
		* two destructive-free actions (`unarchive`, `delete`) plus `delete all`.
		*
		* Data comes from this plugin's own Host route rather than from the client
		* workspace store, because the Harness' session projections carry neither a
		* title-with-timestamp pair nor an on-disk footprint, and because deletion is
		* a Host-side capability that has no client model at all.
		*/
		/** Route prefix registered by the Host half. */
		const ROUTE = "/dsh-archive-manager";
		/**
		* Section entry point. The shell passes a workspace selector hook as a standard
		* prop; because a hook cannot be called conditionally, the live variant renders
		* only when that prop exists, and the page itself then takes the derived
		* revision as an ordinary value.
		* @param props - localized copy, the locale service, and the workspace selector hook.
		* @returns the archived-chats page.
		*/
		function ArchiveManagerSection(props) {
			const useWorkspaces = props.useWorkspaces;
			if (useWorkspaces === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchivePage, {
				...props,
				revision: ""
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LiveArchivePage, {
				...props,
				useWorkspaces
			});
		}
		/** Reads the archive set out of the workspace snapshot, so sidebar changes land here too. */
		function LiveArchivePage(props) {
			const revision = String(props.useWorkspaces((state) => {
				const ids = state?.archivedSessionIds;
				return Array.isArray(ids) ? ids.join("|") : "";
			}) ?? "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchivePage, {
				...props,
				revision
			});
		}
		/** Replace `{name}` placeholders in a localized template. */
		function fill(template, values) {
			return template.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match);
		}
		/** POST a JSON body to this plugin's Host route and surface route failures. */
		async function postJson(path, body) {
			const response = await fetch(ROUTE + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			const payload = await response.json().catch(() => void 0);
			if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`);
			return payload;
		}
		/** Read the archived list from the Host. */
		async function fetchArchived(signal) {
			const response = await fetch(`${ROUTE}/archived`, {
				signal,
				headers: { accept: "application/json" }
			});
			const payload = await response.json().catch(() => void 0);
			if (!response.ok || payload?.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`);
			return {
				sessions: payload.sessions ?? [],
				total: payload.total ?? 0
			};
		}
		/** A localized tag for `Intl` formatting, read from the active locale. */
		function resolveLocaleTag(locale) {
			try {
				const active = locale?.getSnapshot?.()?.active;
				if (typeof active === "string" && active.length > 0) return active;
			} catch {}
			if (typeof navigator !== "undefined" && typeof navigator.language === "string") return navigator.language;
			return "zh-CN";
		}
		/** A small, self-contained pill dropdown: DSH styling, no shared menu state. */
		function SelectMenu(props) {
			const { label, options, activeKey, onPick, disabled = false } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const anchor = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				const onPointerDown = (event) => {
					const node = anchor.current;
					if (node !== null && event.target instanceof Node && !node.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
				};
			}, [open]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ArchiveManager_module_css_default.menuAnchor,
				ref: anchor,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: ArchiveManager_module_css_default.menuButton,
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					disabled,
					onClick: () => setOpen((value) => !value),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: ArchiveManager_module_css_default.menuLabel,
						children: label
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 })]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: ArchiveManager_module_css_default.menuSurface,
					role: "listbox",
					"aria-label": label,
					children: options.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "option",
						"aria-selected": option.key === activeKey,
						"data-active": option.key === activeKey,
						className: ArchiveManager_module_css_default.menuOption,
						onClick: () => {
							setOpen(false);
							onPick(option.key);
						},
						children: option.title
					}, option.key))
				}) : null]
			});
		}
		/**
		* The page itself: search, filters, grouping and the row actions.
		* @param props - localized copy, the locale service and the archive-set revision.
		* @returns the archived-chats page.
		*/
		function ArchivePage(props) {
			const { t, locale, revision, sessionRefresh } = props;
			const [sessions, setSessions] = (0, react.useState)([]);
			const [phase, setPhase] = (0, react.useState)("loading");
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [query, setQuery] = (0, react.useState)("");
			const [scope, setScope] = (0, react.useState)("all");
			const [project, setProject] = (0, react.useState)(ALL_PROJECTS_KEY);
			const [busy, setBusy] = (0, react.useState)(false);
			const [pending, setPending] = (0, react.useState)(null);
			const [acknowledged, setAcknowledged] = (0, react.useState)(false);
			const [purging, setPurging] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				const controller = new AbortController();
				try {
					const payload = await fetchArchived(controller.signal);
					setSessions(payload.sessions);
					setPhase("ready");
					setError(null);
				} catch (cause) {
					if (controller.signal.aborted) return;
					setPhase("error");
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh, revision]);
			(0, react.useEffect)(() => {
				try {
					sessionRefresh?.();
				} catch {}
			}, [sessionRefresh]);
			const localeTag = resolveLocaleTag(locale);
			const timeFormat = (0, react.useMemo)(() => new Intl.DateTimeFormat(localeTag, {
				year: "numeric",
				month: "numeric",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit"
			}), [localeTag]);
			const content = (0, react.useMemo)(() => sessions.filter((session) => session.persisted), [sessions]);
			const residue = (0, react.useMemo)(() => sessions.filter((session) => !session.persisted), [sessions]);
			const selected = (0, react.useMemo)(() => selectArchivedSessions(content, {
				search: query,
				scope,
				project
			}), [
				content,
				query,
				scope,
				project
			]);
			const groups = (0, react.useMemo)(() => groupArchivedSessions(selected, t("group.none")), [selected, t]);
			const projects = (0, react.useMemo)(() => projectOptions(content), [content]);
			const scopeOptions = (0, react.useMemo)(() => [
				{
					key: "all",
					title: t("scope.all")
				},
				{
					key: "project",
					title: t("scope.project")
				},
				{
					key: "none",
					title: t("scope.none")
				}
			], [t]);
			const projectOptionsList = (0, react.useMemo)(() => [{
				key: ALL_PROJECTS_KEY,
				title: t("project.all")
			}, ...projects.map((option) => ({
				key: option.key,
				title: option.key === "__none__" ? t("project.none") : option.title
			}))], [projects, t]);
			const scopeLabel = scopeOptions.find((option) => option.key === scope)?.title ?? t("scope.all");
			const projectLabel = projectOptionsList.find((option) => option.key === project)?.title ?? t("project.all");
			const runDelete = (0, react.useCallback)(async (ids) => {
				if (ids.length === 0) return;
				setBusy(true);
				setNotice(null);
				try {
					const payload = await postJson("/delete", { sessionIds: ids });
					const skipped = payload.outcomes.filter((outcome) => outcome.status === "skipped-running").length;
					const failed = payload.outcomes.filter((outcome) => outcome.status === "failed").length;
					const residueCount = payload.outcomes.filter((outcome) => outcome.residue === true).length;
					const parts = [fill(t("toast.deleted"), { n: payload.deleted })];
					if (skipped > 0) parts.push(fill(t("toast.skippedRunning"), { n: skipped }));
					if (residueCount > 0) parts.push(fill(t("toast.residue"), { n: residueCount }));
					if (failed > 0) parts.push(fill(t("toast.failed"), { n: failed }));
					setNotice({
						tone: failed > 0 ? "error" : "info",
						text: parts.join(" · ")
					});
					await refresh();
				} catch (cause) {
					setNotice({
						tone: "error",
						text: fill(t("toast.error"), { message: cause instanceof Error ? cause.message : String(cause) })
					});
				} finally {
					setBusy(false);
				}
			}, [refresh, t]);
			const runPurge = (0, react.useCallback)(async (ids) => {
				if (ids.length === 0) return;
				setPurging(true);
				setNotice(null);
				try {
					const payload = await postJson("/purge-records", { sessionIds: ids });
					const kept = payload.outcomes.filter((outcome) => outcome.status === "kept").length;
					const parts = [fill(t("toast.purged"), { n: payload.purged })];
					if (kept > 0) parts.push(fill(t("toast.kept"), { n: kept }));
					setNotice({
						tone: "info",
						text: parts.join(" · ")
					});
					await refresh();
				} catch (cause) {
					setNotice({
						tone: "error",
						text: fill(t("toast.error"), { message: cause instanceof Error ? cause.message : String(cause) })
					});
				} finally {
					setPurging(false);
				}
			}, [refresh, t]);
			const runUnarchive = (0, react.useCallback)(async (ids) => {
				if (ids.length === 0) return;
				setBusy(true);
				setNotice(null);
				try {
					await postJson("/unarchive", { sessionIds: ids });
					setNotice({
						tone: "info",
						text: fill(t("toast.unarchived"), { n: ids.length })
					});
					await refresh();
				} catch (cause) {
					setNotice({
						tone: "error",
						text: fill(t("toast.error"), { message: cause instanceof Error ? cause.message : String(cause) })
					});
				} finally {
					setBusy(false);
				}
			}, [refresh, t]);
			const filtering = query.trim().length > 0 || scope !== "all" || project !== "__all__";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: ArchiveManager_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: ArchiveManager_module_css_default.head,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: ArchiveManager_module_css_default.title,
							children: t("nav")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: ArchiveManager_module_css_default.deleteAll,
							disabled: busy || content.length === 0,
							onClick: () => {
								setAcknowledged(false);
								setPending({
									ids: content.map((session) => session.sessionId),
									all: true
								});
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 14 }), t("header.deleteAll")]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ArchiveManager_module_css_default.toolbar,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ArchiveManager_module_css_default.search,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ArchiveManager_module_css_default.searchIcon,
									"aria-hidden": "true",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, { size: 14 })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: ArchiveManager_module_css_default.searchInput,
									type: "search",
									value: query,
									placeholder: t("search.placeholder"),
									"aria-label": t("search.placeholder"),
									onChange: (event) => setQuery(event.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectMenu, {
								label: scopeLabel,
								options: scopeOptions,
								activeKey: scope,
								disabled: busy,
								onPick: (key) => setScope(key)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SelectMenu, {
								label: projectLabel,
								options: projectOptionsList,
								activeKey: project,
								disabled: busy,
								onPick: setProject
							})
						]
					}),
					notice !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: ArchiveManager_module_css_default.stateHint,
						role: "status",
						style: {
							paddingBottom: 10,
							color: notice.tone === "error" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)"
						},
						children: notice.text
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: ArchiveManager_module_css_default.body,
						children: [
							phase === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ArchiveManager_module_css_default.state,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: ArchiveManager_module_css_default.stateIcon,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconLoadingOutlineRegular, { size: 20 })
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: ArchiveManager_module_css_default.stateTitle,
									children: t("state.loading")
								})]
							}) : null,
							phase === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ArchiveManager_module_css_default.state,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ArchiveManager_module_css_default.stateIcon,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 24 })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ArchiveManager_module_css_default.stateTitle,
										children: t("state.error")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ArchiveManager_module_css_default.stateHint,
										children: error
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: ArchiveManager_module_css_default.retryButton,
										onClick: () => {
											setPhase("loading");
											refresh();
										},
										children: t("state.retry")
									})
								]
							}) : null,
							phase === "ready" && groups.length === 0 && residue.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: ArchiveManager_module_css_default.state,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: ArchiveManager_module_css_default.stateIcon,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 24 })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ArchiveManager_module_css_default.stateTitle,
										children: filtering ? t("empty.filtered") : t("empty.none")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ArchiveManager_module_css_default.stateHint,
										children: filtering ? t("empty.filteredHint") : t("empty.noneHint")
									}),
									filtering ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: ArchiveManager_module_css_default.retryButton,
										onClick: () => {
											setQuery("");
											setScope("all");
											setProject(ALL_PROJECTS_KEY);
										},
										children: [
											t("scope.all"),
											" · ",
											t("project.all")
										]
									}) : null
								]
							}) : null,
							phase === "ready" ? groups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: ArchiveManager_module_css_default.group,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: ArchiveManager_module_css_default.groupHead,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ArchiveManager_module_css_default.groupTitle,
											children: group.title
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: ArchiveManager_module_css_default.groupCount,
											children: fill(t("group.count"), { n: group.sessions.length })
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
									className: ArchiveManager_module_css_default.list,
									children: group.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
										className: ArchiveManager_module_css_default.row,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: ArchiveManager_module_css_default.rowMain,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: ArchiveManager_module_css_default.rowTitleLine,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ArchiveManager_module_css_default.rowTitle,
													title: session.title ?? void 0,
													children: sessionDisplayTitle(session, t("row.untitled"))
												}), session.running ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ArchiveManager_module_css_default.badge,
													children: t("row.running")
												}) : session.live ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: ArchiveManager_module_css_default.badgeLoaded,
													children: t("row.loaded")
												}) : null]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: ArchiveManager_module_css_default.rowTime,
												children: [
													session.updatedAt > 0 ? timeFormat.format(new Date(session.updatedAt)) : "—",
													session.bytes !== null ? ` · ${formatBytes(session.bytes)}` : "",
													session.cwd !== null ? ` · ${session.cwd}` : ""
												]
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: ArchiveManager_module_css_default.rowActions,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: ArchiveManager_module_css_default.iconButton,
												title: session.running ? t("row.deleteRunningHint") : t("row.delete"),
												"aria-label": `${t("row.delete")} ${sessionDisplayTitle(session, t("row.untitled"))}`,
												disabled: busy || session.running,
												onClick: () => {
													setAcknowledged(false);
													setPending({
														ids: [session.sessionId],
														all: false
													});
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 16 })
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: ArchiveManager_module_css_default.secondaryButton,
												disabled: busy,
												onClick: () => {
													runUnarchive([session.sessionId]);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUnarchiveOutlineRegular, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: { marginInlineStart: 4 },
													children: t("row.unarchive")
												})]
											})]
										})]
									}, session.sessionId))
								})]
							}, group.key)) : null,
							phase === "ready" && residue.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: ArchiveManager_module_css_default.group,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: ArchiveManager_module_css_default.groupHead,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOffOutlineRegular, { size: 14 }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ArchiveManager_module_css_default.groupTitle,
												children: t("residue.title")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: ArchiveManager_module_css_default.groupCount,
												children: fill(t("group.count"), { n: residue.length })
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: ArchiveManager_module_css_default.residueHint,
										children: t("residue.hint")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
										className: ArchiveManager_module_css_default.list,
										children: residue.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
											className: ArchiveManager_module_css_default.row,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: ArchiveManager_module_css_default.rowMain,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: ArchiveManager_module_css_default.rowTitleLine,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ArchiveManager_module_css_default.rowTitle,
														title: session.title ?? void 0,
														children: sessionDisplayTitle(session, t("row.untitled"))
													}), session.live ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: ArchiveManager_module_css_default.badgeLoaded,
														children: t("row.loaded")
													}) : null]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: ArchiveManager_module_css_default.rowTime,
													children: session.live ? t("residue.needsRestart") : t("residue.releasable")
												})]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: ArchiveManager_module_css_default.rowActions,
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: ArchiveManager_module_css_default.secondaryButton,
													disabled: busy || purging || session.live,
													title: session.live ? t("residue.needsRestart") : t("residue.release"),
													onClick: () => {
														runPurge([session.sessionId]);
													},
													children: t("residue.release")
												})
											})]
										}, session.sessionId))
									})
								]
							}, "__residue__") : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.RiskConfirmation, {
						open: pending !== null,
						title: fill(pending?.all === true ? t("confirm.deleteAllTitle") : t("confirm.deleteTitle"), { n: pending?.ids.length ?? 0 }),
						description: t("confirm.body"),
						acknowledgeLabel: t("confirm.ack"),
						confirmLabel: t("confirm.confirm"),
						cancelLabel: t("confirm.cancel"),
						closeLabel: t("confirm.close"),
						acknowledged,
						disabled: busy,
						onAcknowledgedChange: setAcknowledged,
						onCancel: () => {
							setPending(null);
							setAcknowledged(false);
						},
						onConfirm: () => {
							const target = pending;
							setPending(null);
							setAcknowledged(false);
							if (target !== null) runDelete(target.ids);
						}
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Dictionaries for the archive-manager page. Both locales are mandatory: the
		* shell re-projects every `label` thunk on a language switch, so the page must
		* be able to answer in either.
		*/
		const zh = {
			nav: "已归档的聊天",
			"header.deleteAll": "全部删除",
			"search.placeholder": "搜索已归档的聊天",
			"scope.all": "全部聊天",
			"scope.project": "有项目的聊天",
			"scope.none": "无项目的聊天",
			"project.all": "所有项目",
			"project.none": "无项目",
			"group.none": "无项目",
			"group.count": "{n} 个聊天",
			"row.unarchive": "取消归档",
			"row.delete": "删除",
			"row.deleteRunningHint": "会话正在运行，先停止再删除",
			"row.untitled": "未命名会话",
			"row.running": "运行中",
			"row.loaded": "已加载",
			"state.loading": "正在读取已归档的聊天…",
			"state.error": "读取已归档的聊天失败",
			"state.retry": "重试",
			"empty.none": "还没有已归档的聊天",
			"empty.noneHint": "在会话行的“⋯”菜单里选择归档，会话就会出现在这里。",
			"empty.filtered": "没有匹配的聊天",
			"empty.filteredHint": "换一个关键词，或把筛选条件改回“全部聊天 / 所有项目”。",
			"confirm.deleteTitle": "删除 {n} 个已归档会话？",
			"confirm.deleteAllTitle": "删除全部 {n} 个已归档会话？",
			"confirm.body": "会话日志与投影缓存会从磁盘永久删除，无法恢复。",
			"confirm.ack": "我明白此操作无法撤销",
			"confirm.confirm": "永久删除",
			"confirm.cancel": "取消",
			"confirm.close": "关闭",
			"toast.deleted": "已永久删除 {n} 个会话",
			"toast.unarchived": "已取消归档 {n} 个会话",
			"toast.skippedRunning": "{n} 个会话正在运行，已跳过",
			"toast.residue": "{n} 个会话仍驻留内存，已保留其归档记录以继续隐藏",
			"toast.failed": "{n} 个会话删除失败",
			"toast.purged": "已清理 {n} 条归档记录",
			"toast.kept": "{n} 条记录暂不可清理",
			"toast.error": "操作失败：{message}",
			"residue.title": "已删除的残留记录",
			"residue.hint": "这些会话的日志已删除，但归档记录还留着——正是它让工作区继续隐藏这些行。会话仍驻留内存时不能清理，重启 DSH 后再清理即可。",
			"residue.needsRestart": "会话仍驻留内存，重启 DSH 后可清理该记录",
			"residue.releasable": "日志已删除，可以清理这条归档记录",
			"residue.release": "清理记录"
		};
		const en = {
			nav: "Archived chats",
			"header.deleteAll": "Delete all",
			"search.placeholder": "Search archived chats",
			"scope.all": "All chats",
			"scope.project": "Chats in projects",
			"scope.none": "Chats without a project",
			"project.all": "All projects",
			"project.none": "No project",
			"group.none": "No project",
			"group.count": "{n} chats",
			"row.unarchive": "Unarchive",
			"row.delete": "Delete",
			"row.deleteRunningHint": "This session is running — stop it before deleting",
			"row.untitled": "Untitled session",
			"row.running": "Running",
			"row.loaded": "Loaded",
			"state.loading": "Reading archived chats…",
			"state.error": "Could not read archived chats",
			"state.retry": "Retry",
			"empty.none": "No archived chats yet",
			"empty.noneHint": "Archive a session from its “⋯” menu and it shows up here.",
			"empty.filtered": "No chats match",
			"empty.filteredHint": "Try another keyword, or reset the filters to “All chats / All projects”.",
			"confirm.deleteTitle": "Delete {n} archived sessions?",
			"confirm.deleteAllTitle": "Delete all {n} archived sessions?",
			"confirm.body": "Session logs and projection caches are erased from disk permanently. This cannot be undone.",
			"confirm.ack": "I understand this cannot be undone",
			"confirm.confirm": "Delete permanently",
			"confirm.cancel": "Cancel",
			"confirm.close": "Close",
			"toast.deleted": "Permanently deleted {n} sessions",
			"toast.unarchived": "Unarchived {n} sessions",
			"toast.skippedRunning": "Skipped {n} running sessions",
			"toast.residue": "{n} sessions are still in memory — their archive records were kept so the workspace keeps hiding them",
			"toast.failed": "{n} sessions could not be deleted",
			"toast.purged": "Released {n} archive records",
			"toast.kept": "{n} records could not be released yet",
			"toast.error": "Request failed: {message}",
			"residue.title": "Deleted records still held",
			"residue.hint": "These sessions’ logs are gone, but their archive records remain — that record is what keeps the workspace hiding these rows. A record cannot be released while the session is still loaded; restart DSH first.",
			"residue.needsRestart": "Still loaded in memory — restart DSH to release this record",
			"residue.releasable": "The log is gone; this archive record can be released",
			"residue.release": "Release record"
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-archive-manager — browser half.
		*
		* Registers one settings page, `已归档的聊天 / Archived chats`, into the
		* settings shell's `settings.section` sunburst, using the id the shell already
		* reserves an archive glyph for (`archived-sessions`).
		*
		* Built by tsdown into the `window.__ModuleLoader__` factory artifact at
		* `client/client.js`; the only externals are the loader module table's react
		* entries and `@deepseek-ai/dsh-client-ui-primitives`.
		*/
		/** Locale namespace owned by this plugin. */
		const NS = "dsh-archive-manager";
		/** Settings-section id the shell maps to the archive glyph. */
		const SECTION_ID = "archived-sessions";
		const name = "dsh-archive-manager";
		/**
		* `slots` and `locale` are the whole surface this half needs; the workspace
		* snapshot arrives as a standard prop of `settings.section`, so no extra
		* service has to be required (a missing one would unmount the page entirely).
		* The Session controller is reached through a NESTED injection instead: the
		* page works without it, but uses its baseline refresh to reconcile rows whose
		* logs disappeared before this plugin announced removals.
		*/
		const inject = ["slots", "locale"];
		/**
		* Register the archived-chats settings page.
		* @param ctx - the client cordis context of this plugin's package.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-archive-manager: dictionaries");
			const t = ctx.locale.bind(NS);
			let sessions;
			ctx.inject(["sessions"], (scoped) => {
				sessions = scoped.get?.("sessions") ?? scoped.sessions;
			});
			const sessionRefresh = () => {
				try {
					sessions?.refresh?.();
				} catch {}
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: SECTION_ID,
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({
					t,
					locale: ctx.locale,
					sessionRefresh
				})
			}, () => (0, react.createElement)(ArchiveManagerSection, {
				t,
				locale: ctx.locale,
				sessionRefresh
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map