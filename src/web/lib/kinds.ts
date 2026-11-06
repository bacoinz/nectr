import type { FolderDTO } from "../../shared/api-types";

// Project kinds (constants.ts PROJECT_KINDS) as the owner and the guests read them.

export type Kind = FolderDTO["kind"];

export const KIND_LABEL: Record<Kind, string> = { release: "Álbum / EP", wip: "WIP", live: "Projeto live", other: "Outra pasta" };
/** The small word above a project's name. */
export const KIND_EYEBROW: Record<Kind, string> = { release: "Projeto", wip: "WIP", live: "Projeto live", other: "Pasta" };

/** A release (album, EP, single) shows its cover; every other project, and every folder, its icon. */
export const isRelease = (f: { parentId: string | null; kind: Kind }) => !f.parentId && f.kind === "release";
