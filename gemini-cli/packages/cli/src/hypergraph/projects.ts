import { Entity, Id, Mapping, Type } from "@graphprotocol/hypergraph";

import {
	queryPublic,
	type QueryPublicParams,
} from "./queryPublic.js";

class Project extends Entity.Class<Project>("Project")({
	name: Type.String,
	description: Type.optional(Type.String),
	xUrl: Type.optional(Type.String),
}) {}

export const ProjectSchema = Project as unknown as Entity.AnyNoContext;

export type ProjectSummary = {
	id: string;
	name: string;
	description: string | null;
	xUrl: string | null;
};

export type ProjectQueryOptions = Omit<
	QueryPublicParams<typeof ProjectSchema>,
	"space" | "first" | "mapping"
>;

export const PROJECT_MAPPING: Mapping.Mapping = {
	Project: {
		typeIds: [Id("484a18c5-030a-499c-b0f2-ef588ff16d50")],
		properties: {
			name: Id("a126ca53-0c8e-48d5-b888-82c734c38935"),
			description: Id("9b1f76ff-9711-404c-861e-59dc3fa7d037"),
			xUrl: Id("0d625978-4b3c-4b57-a86f-de45c997c73c"),
		},
	},
};

export const GEO_PUBLIC_SPACE_ID = "771d83c2-3e3f-4603-b1c8-9d89b5e8b5b2";

export async function fetchProjects(
	spaceId: string,
	first = 40,
	options?: ProjectQueryOptions,
): Promise<ProjectSummary[]> {
	const { data } = await queryPublic(ProjectSchema, {
		...options,
		space: spaceId,
		first,
		mapping: PROJECT_MAPPING,
	});

	return data.map((project: Entity.Entity<typeof ProjectSchema>) => ({
		id: project.id,
		name: project.name,
		description: project.description ?? null,
		xUrl: project.xUrl ?? null,
	}));
}
