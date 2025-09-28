import type { Entity } from '@graphprotocol/hypergraph';

import {
  GEO_PUBLIC_SPACE_ID,
  PROJECT_MAPPING,
  ProjectSchema,
} from './projects.js';
import { queryPublic, type QueryPublicParams } from './queryPublic.js';

export { fetchProjects, GEO_PUBLIC_SPACE_ID } from './projects.js';
export type { ProjectQueryOptions, ProjectSummary } from './projects.js';
export type { QueryPublicParams, QueryPublicResult } from './queryPublic.js';

export type ProjectEntity = Entity.Entity<typeof ProjectSchema>;

export type ProjectEntitiesParams = Omit<
  QueryPublicParams<typeof ProjectSchema>,
  'mapping'
>;

export default async function getProjectEntities(
  params?: ProjectEntitiesParams,
): Promise<ProjectEntity[]> {
  const { space, ...rest } = params ?? {};

  const { data } = await queryPublic(ProjectSchema, {
    ...rest,
    space: space ?? GEO_PUBLIC_SPACE_ID,
    mapping: PROJECT_MAPPING,
  });

  return data;
}
