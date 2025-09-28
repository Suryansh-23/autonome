/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';

/**
 * Callback for accessing hypergraph project data
 * This allows the CLI package to inject the hypergraph functionality into the core tool
 */
export interface HypergraphDataProvider {
  /**
   * Searches for projects in the hypergraph that match the given query
   * @param query - Search terms to find relevant projects
   * @param options - Additional search options
   * @returns Promise resolving to matching projects with their details
   */
  searchProjects(
    query: string,
    options?: HypergraphSearchOptions,
  ): Promise<HypergraphProject[]>;

  /**
   * Gets the space ID being used for hypergraph queries
   * @returns The current space ID
   */
  getSpaceId(): string;
}

export interface HypergraphSearchOptions {
  /** Maximum number of results to return */
  maxResults?: number;
  /** Whether to include projects without descriptions */
  includeEmpty?: boolean;
}

export interface HypergraphProject {
  id: string;
  name: string;
  description: string | null;
  xUrl: string | null;
}

/**
 * Parameters for the HypergraphSearch tool
 */
export interface HypergraphSearchToolParams {
  /**
   * The search query to find relevant projects in the hypergraph protocol
   */
  query: string;
  /**
   * Maximum number of results to return (default: 10)
   */
  maxResults?: number;
}

class HypergraphSearchToolInvocation extends BaseToolInvocation<
  HypergraphSearchToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: HypergraphSearchToolParams,
    private readonly hypergraphProvider?: HypergraphDataProvider,
  ) {
    super(params);
  }

  getDescription(): string {
    const displayQuery =
      this.params.query.length > 100
        ? this.params.query.substring(0, 97) + '...'
        : this.params.query;
    return `Searching protocol hypergraph for: "${displayQuery}"`;
  }

  override async shouldConfirmExecute(): Promise<
    ToolCallConfirmationDetails | false
  > {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Hypergraph Search`,
      prompt: `Search the protocol hypergraph for projects matching: "${this.params.query}"`,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    const query = this.params.query.trim();
    const maxResults = this.params.maxResults || 10;

    console.info('[hypergraph-search] Starting search for protocol projects');
    console.debug('[hypergraph-search] Search parameters:', {
      query,
      maxResults,
      timestamp: new Date().toISOString(),
    });

    if (!query) {
      const errorMessage = 'Search query cannot be empty';
      console.error('[hypergraph-search] Error:', errorMessage);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (!this.hypergraphProvider) {
      const errorMessage =
        'Hypergraph data provider not available. This feature requires the CLI package integration.';
      console.warn('[hypergraph-search] Provider not available:', errorMessage);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }

    try {
      const spaceId = this.hypergraphProvider.getSpaceId();
      console.info('[hypergraph-search] Using hypergraph space:', spaceId);

      console.debug(
        '[hypergraph-search] Executing search against protocol hypergraph...',
      );

      const projects = await this.hypergraphProvider.searchProjects(query, {
        maxResults,
        includeEmpty: false, // Exclude projects without descriptions for better search results
      });

      const searchDuration = Date.now() - startTime;
      console.info('[hypergraph-search] Search completed successfully', {
        resultsCount: projects.length,
        durationMs: searchDuration,
        query,
      });

      if (projects.length === 0) {
        console.info(
          '[hypergraph-search] No projects found matching query:',
          query,
        );
        const noResultsMessage = `No projects found in the protocol hypergraph matching "${query}". The hypergraph contains projects integrated into our protocol ecosystem.`;
        return {
          llmContent: noResultsMessage,
          returnDisplay: noResultsMessage,
        };
      }

      // Log detailed results for transparency
      console.debug(
        '[hypergraph-search] Found projects:',
        projects.map((p) => ({
          id: p.id,
          name: p.name,
          hasDescription: !!p.description,
          hasUrl: !!p.xUrl,
        })),
      );

      // Format the results for display and LLM consumption
      const resultsText = this.formatSearchResults(projects, query, spaceId);
      const displayText = `Found ${projects.length} protocol project${projects.length === 1 ? '' : 's'} matching "${query}"`;

      console.info('[hypergraph-search] Results formatted for response', {
        projectCount: projects.length,
        totalCharacters: resultsText.length,
      });

      return {
        llmContent: resultsText,
        returnDisplay: displayText,
      };
    } catch (error: unknown) {
      const searchDuration = Date.now() - startTime;
      const errorMessage = `Hypergraph search failed: ${getErrorMessage(error)}`;

      console.error('[hypergraph-search] Search failed:', {
        error: errorMessage,
        query,
        durationMs: searchDuration,
        errorDetails: error,
      });

      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }

  private formatSearchResults(
    projects: HypergraphProject[],
    query: string,
    spaceId: string,
  ): string {
    console.debug('[hypergraph-search] Formatting results for display');

    const header = `# Protocol Hypergraph Search Results

**Query:** "${query}"
**Space ID:** ${spaceId}
**Results:** ${projects.length} project${projects.length === 1 ? '' : 's'} found
**Source:** Protocol-integrated projects from the hypergraph ecosystem

---

`;

    const projectEntries = projects.map((project, index) => {
      console.debug(`[hypergraph-search] Formatting project ${index + 1}:`, {
        id: project.id,
        name: project.name,
        hasDescription: !!project.description,
        hasUrl: !!project.xUrl,
      });

      let entry = `## ${index + 1}. ${project.name}\n\n`;
      entry += `**Project ID:** ${project.id}\n`;

      if (project.description) {
        entry += `**Description:** ${project.description}\n`;
      }

      if (project.xUrl) {
        entry += `**X URL:** ${project.xUrl}\n`;
      }

      entry += '\n---\n\n';
      return entry;
    });

    const footer = `*This data comes from the protocol hypergraph, which indexes projects integrated into our ecosystem. These are verified protocol-participating projects, not general web search results.*`;

    const fullText = header + projectEntries.join('') + footer;

    console.debug('[hypergraph-search] Results formatting complete:', {
      totalLength: fullText.length,
      sections: {
        header: header.length,
        projects: projectEntries.join('').length,
        footer: footer.length,
      },
    });

    return fullText;
  }
}

/**
 * Tool for searching protocol projects in the hypergraph
 *
 * This tool provides access to projects that are integrated into the protocol ecosystem,
 * serving as a secondary search store alongside regular web search. It's particularly
 * useful for finding protocol-specific projects, dApps, and ecosystem participants.
 */
export class HypergraphSearchTool extends BaseDeclarativeTool<
  HypergraphSearchToolParams,
  ToolResult
> {
  static readonly Name: string = 'hypergraph_search';

  constructor(
    private readonly config: Config,
    private readonly hypergraphProvider?: HypergraphDataProvider,
  ) {
    super(
      HypergraphSearchTool.Name,
      'Hypergraph Search',
      'Searches for projects in the protocol hypergraph - a curated database of protocol-integrated projects and ecosystem participants. Use this to find dApps, tools, and other projects that are part of the protocol ecosystem, as opposed to general web content.',
      Kind.Search,
      {
        properties: {
          query: {
            description:
              'Search terms to find relevant projects in the protocol hypergraph. The search will match against project names and descriptions.',
            type: 'string',
          },
          maxResults: {
            description:
              'Maximum number of projects to return (default: 10, max: 50)',
            type: 'number',
            minimum: 1,
            maximum: 50,
          },
        },
        required: ['query'],
        type: 'object',
      },
    );
  }

  protected override validateToolParamValues(
    params: HypergraphSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }

    if (
      params.maxResults &&
      (params.maxResults < 1 || params.maxResults > 50)
    ) {
      return "The 'maxResults' parameter must be between 1 and 50.";
    }

    return null;
  }

  protected createInvocation(
    params: HypergraphSearchToolParams,
  ): ToolInvocation<HypergraphSearchToolParams, ToolResult> {
    console.debug('[hypergraph-search] Creating tool invocation:', {
      query: params.query,
      maxResults: params.maxResults,
      hasProvider: !!this.hypergraphProvider,
    });

    return new HypergraphSearchToolInvocation(
      this.config,
      params,
      this.hypergraphProvider,
    );
  }
}
