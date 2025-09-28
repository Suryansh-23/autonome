/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HypergraphDataProvider,
  HypergraphProject,
  HypergraphSearchOptions,
} from '@google/gemini-cli-core';
import {
  fetchProjects,
  GEO_PUBLIC_SPACE_ID,
  type ProjectSummary,
} from './index.js';

/**
 * Implementation of HypergraphDataProvider that integrates with the CLI's hypergraph functionality
 */
export function createHypergraphDataProvider(
  spaceId?: string,
): HypergraphDataProvider {
  const activeSpaceId = spaceId || GEO_PUBLIC_SPACE_ID;

  return {
    async searchProjects(
      query: string,
      options?: HypergraphSearchOptions,
    ): Promise<HypergraphProject[]> {
      const startTime = Date.now();
      const searchTerms = query.toLowerCase().trim();
      const maxResults = options?.maxResults || 10;
      const includeEmpty = options?.includeEmpty ?? false;

      console.info('[hypergraph-provider] Starting project search', {
        query,
        searchTerms,
        maxResults,
        includeEmpty,
        spaceId: activeSpaceId,
        timestamp: new Date().toISOString(),
      });

      try {
        // Fetch projects from the hypergraph
        console.debug(
          '[hypergraph-provider] Fetching projects from hypergraph...',
        );
        const projects: ProjectSummary[] = await fetchProjects(
          activeSpaceId,
          Math.max(maxResults * 3, 100), // Fetch more than needed to allow for filtering
        );

        console.info('[hypergraph-provider] Raw projects fetched:', {
          totalProjects: projects.length,
          spaceId: activeSpaceId,
        });

        // Log project details for debugging
        console.debug(
          '[hypergraph-provider] Project details:',
          projects.slice(0, 5).map((p) => ({
            id: p.id,
            name: p.name,
            hasDescription: !!p.description,
            hasUrl: !!p.xUrl,
          })),
        );

        // Filter projects based on search query
        console.debug('[hypergraph-provider] Applying search filters...');
        const filteredProjects = projects.filter((project) => {
          // Skip projects without descriptions if includeEmpty is false
          if (!includeEmpty && !project.description) {
            return false;
          }

          // Search in name and description
          const nameMatch = project.name.toLowerCase().includes(searchTerms);
          const descriptionMatch = project.description
            ? project.description.toLowerCase().includes(searchTerms)
            : false;

          return nameMatch || descriptionMatch;
        });

        console.info('[hypergraph-provider] Search filtering completed:', {
          filteredCount: filteredProjects.length,
          originalCount: projects.length,
          searchTerms,
        });

        // Sort by relevance (name matches first, then description matches)
        const sortedProjects = filteredProjects.sort((a, b) => {
          const aNameMatch = a.name.toLowerCase().includes(searchTerms);
          const bNameMatch = b.name.toLowerCase().includes(searchTerms);

          if (aNameMatch && !bNameMatch) return -1;
          if (!aNameMatch && bNameMatch) return 1;

          // If both or neither match name, sort by name alphabetically
          return a.name.localeCompare(b.name);
        });

        // Limit results
        const limitedResults = sortedProjects.slice(0, maxResults);

        const searchDuration = Date.now() - startTime;
        console.info('[hypergraph-provider] Search completed successfully:', {
          finalResultCount: limitedResults.length,
          durationMs: searchDuration,
          query,
        });

        // Log final results for transparency
        console.debug(
          '[hypergraph-provider] Final results:',
          limitedResults.map((p) => ({
            name: p.name,
            hasDescription: !!p.description,
            matchType: p.name.toLowerCase().includes(searchTerms)
              ? 'name'
              : 'description',
          })),
        );

        // Convert to the expected format
        return limitedResults.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          xUrl: project.xUrl,
        }));
      } catch (error) {
        const searchDuration = Date.now() - startTime;
        console.error('[hypergraph-provider] Search failed:', {
          error: error instanceof Error ? error.message : String(error),
          query,
          durationMs: searchDuration,
          spaceId: activeSpaceId,
          errorDetails: error,
        });
        throw error;
      }
    },

    getSpaceId(): string {
      console.debug('[hypergraph-provider] Returning space ID:', activeSpaceId);
      return activeSpaceId;
    },
  };
}
