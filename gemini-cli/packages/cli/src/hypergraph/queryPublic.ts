import { Graph } from "@graphprotocol/grc-20";
import {
	Entity,
	Mapping,
	store,
	TypeUtils,
} from "@graphprotocol/hypergraph";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

const RELATION_EDGE_TYPE_ID = "8f151ba4-de20-4e3c-9cb4-99ddf96f48f1";

const ENTITIES_QUERY_DOCUMENT_LEVEL_0 = `
  query entities($spaceId: UUID!, $typeIds: [UUID!]!, $first: Int, $filter: EntityFilter!) {
    entities(
      filter: {
        and: [
          {
            relations: {
              some: {
                typeId: { is: "${RELATION_EDGE_TYPE_ID}" },
                toEntityId: { in: $typeIds }
              }
            },
            spaceIds: { in: [$spaceId] }
          },
          $filter
        ]
      }
      first: $first
    ) {
      id
      name
      valuesList(filter: { spaceId: { is: $spaceId } }) {
        propertyId
        string
        boolean
        number
        time
        point
      }
    }
  }
`;

const ENTITIES_QUERY_DOCUMENT_LEVEL_1 = `
  query entities(
    $spaceId: UUID!
    $typeIds: [UUID!]!
    $relationTypeIdsLevel1: [UUID!]!
    $first: Int
    $filter: EntityFilter!
  ) {
    entities(
      first: $first
      filter: {
        and: [
          {
            relations: {
              some: {
                typeId: { is: "${RELATION_EDGE_TYPE_ID}" },
                toEntityId: { in: $typeIds }
              }
            },
            spaceIds: { in: [$spaceId] }
          },
          $filter
        ]
      }
    ) {
      id
      name
      valuesList(filter: { spaceId: { is: $spaceId } }) {
        propertyId
        string
        boolean
        number
        time
        point
      }
      relationsList(
        filter: { spaceId: { is: $spaceId }, typeId: { in: $relationTypeIdsLevel1 } }
      ) {
        toEntity {
          id
          name
          valuesList(filter: { spaceId: { is: $spaceId } }) {
            propertyId
            string
            boolean
            number
            time
            point
          }
        }
        typeId
      }
    }
  }
`;

const ENTITIES_QUERY_DOCUMENT_LEVEL_2 = `
  query entities(
    $spaceId: UUID!
    $typeIds: [UUID!]!
    $relationTypeIdsLevel1: [UUID!]!
    $relationTypeIdsLevel2: [UUID!]!
    $first: Int
    $filter: EntityFilter!
  ) {
    entities(
      first: $first
      filter: {
        and: [
          {
            relations: {
              some: {
                typeId: { is: "${RELATION_EDGE_TYPE_ID}" },
                toEntityId: { in: $typeIds }
              }
            },
            spaceIds: { in: [$spaceId] }
          },
          $filter
        ]
      }
    ) {
      id
      name
      valuesList(filter: { spaceId: { is: $spaceId } }) {
        propertyId
        string
        boolean
        number
        time
        point
      }
      relationsList(
        filter: { spaceId: { is: $spaceId }, typeId: { in: $relationTypeIdsLevel1 } }
      ) {
        toEntity {
          id
          name
          valuesList(filter: { spaceId: { is: $spaceId } }) {
            propertyId
            string
            boolean
            number
            time
            point
          }
          relationsList(
            filter: { spaceId: { is: $spaceId }, typeId: { in: $relationTypeIdsLevel2 } }
          ) {
            toEntity {
              id
              name
              valuesList(filter: { spaceId: { is: $spaceId } }) {
                propertyId
                string
                boolean
                number
                time
                point
              }
            }
            typeId
          }
        }
        typeId
      }
    }
  }
`;

export type GraphqlEntityValue = {
	propertyId: string;
	string: string;
	boolean: boolean;
	number: number;
	time: string;
	point: string;
};

export type RecursiveQueryEntity = {
	id: string;
	name: string;
	valuesList?: GraphqlEntityValue[];
	relationsList?: {
		toEntity: RecursiveQueryEntity;
		typeId: string;
	}[];
};

export type EntityQueryResult = {
	entities: RecursiveQueryEntity[];
};

export type QueryPublicParams<S extends Entity.AnyNoContext> = {
	enabled?: boolean;
	space?: string;
	filter?: Entity.EntityFilter<Schema.Schema.Type<S>>;
	include?: {
		[K in keyof Schema.Schema.Type<S>]?: Record<string, Record<string, never>>;
	};
	first?: number;
	mapping?: Mapping.Mapping;
	graphApiOrigin?: string;
};

export type QueryPublicResult<S extends Entity.AnyNoContext> = {
	data: Entity.Entity<S>[];
	invalidEntities: Record<string, unknown>[];
	raw: EntityQueryResult | null;
};

export async function queryPublic<S extends Entity.AnyNoContext>(
	type: S,
	params?: QueryPublicParams<S>,
): Promise<QueryPublicResult<S>> {
	const {
		enabled = true,
		filter,
		include,
		space: spaceFromParams,
		first = 100,
		mapping: mappingOverride,
		graphApiOrigin,
	} = params ?? {};

	if (!enabled) {
		return { data: [], invalidEntities: [], raw: null };
	}

	const snapshot = store.getSnapshot();
	const mapping = mappingOverride ?? snapshot.context.mapping;
	const space = spaceFromParams ?? snapshot.context.spaces?.[0]?.id;

	if (!space) {
		throw new Error(
			"Space id is required. Provide it via params.space or ensure a space is selected in the Hypergraph store.",
		);
	}

	// @ts-expect-error TODO should use the actual type instead of the name in the mapping
	const typeName = type.name;
	const mappingEntry = mapping?.[typeName];

	if (!mappingEntry) {
		throw new Error(
			`Mapping entry for ${typeName ?? "unknown type"} not found`,
		);
	}

	const { relationTypeIdsLevel1, relationTypeIdsLevel2 } =
		collectRelationTypeIds(type, include, mappingEntry, mapping);

	const queryDocument = selectQueryDocument(
		relationTypeIdsLevel1.length,
		relationTypeIdsLevel2.length,
	);

	const variables = {
		spaceId: space,
		typeIds: mappingEntry?.typeIds ?? [],
		relationTypeIdsLevel1,
		relationTypeIdsLevel2,
		first,
		filter: filter ? translateFilterToGraphql(filter, type, mapping) : {},
	} satisfies Record<string, unknown>;

	const endpoint = `${graphApiOrigin ?? Graph.TESTNET_API_ORIGIN}/graphql`;

	const raw = await requestGraphql<EntityQueryResult>(
		endpoint,
		queryDocument,
		variables,
	);
	const { data, invalidEntities } = parseResult(
		raw,
		type,
		mappingEntry,
		mapping,
	);

	return { data, invalidEntities, raw };
}

function selectQueryDocument(level1Count: number, level2Count: number) {
	if (level2Count > 0) {
		return ENTITIES_QUERY_DOCUMENT_LEVEL_2;
	}
	if (level1Count > 0) {
		return ENTITIES_QUERY_DOCUMENT_LEVEL_1;
	}
	return ENTITIES_QUERY_DOCUMENT_LEVEL_0;
}

type RelationTypeIds = {
	relationTypeIdsLevel1: string[];
	relationTypeIdsLevel2: string[];
};

function collectRelationTypeIds<S extends Entity.AnyNoContext>(
	type: S,
	include: QueryPublicParams<S>["include"],
	mappingEntry: Mapping.MappingEntry,
	mapping: Mapping.Mapping,
): RelationTypeIds {
	const relationTypeIdsLevel1: string[] = [];
	const relationTypeIdsLevel2: string[] = [];

	for (const key in mappingEntry?.relations ?? {}) {
		if (include?.[key] && mappingEntry?.relations?.[key]) {
			relationTypeIdsLevel1.push(mappingEntry.relations[key]);
			const field = type.fields[key];
			if (!field) {
				continue;
			}
			// @ts-expect-error TODO find a better way to access the relation type name
			const typeName2 = field.value.name;
			const mappingEntry2 = mapping[typeName2];
			if (!mappingEntry2) {
				continue;
			}
			for (const key2 in mappingEntry2?.relations ?? {}) {
				if (include?.[key]?.[key2] && mappingEntry2.relations?.[key2]) {
					relationTypeIdsLevel2.push(mappingEntry2.relations[key2]);
				}
			}
		}
	}

	return { relationTypeIdsLevel1, relationTypeIdsLevel2 };
}

function parseResult<S extends Entity.AnyNoContext>(
	queryData: EntityQueryResult,
	type: S,
	mappingEntry: Mapping.MappingEntry,
	mapping: Mapping.Mapping,
) {
	const decode = Schema.decodeUnknownEither(type);
	const data: Entity.Entity<S>[] = [];
	const invalidEntities: Record<string, unknown>[] = [];

	for (const queryEntity of queryData.entities) {
		let rawEntity: Record<string, string | boolean | number | unknown[] | Date> = {
			id: queryEntity.id,
		};

		for (const [key, value] of Object.entries(mappingEntry?.properties ?? {})) {
			const property = queryEntity.valuesList?.find(
				(candidate) => candidate.propertyId === value,
			);
			if (property) {
				rawEntity[key] = convertPropertyValue(property, key, type);
			}
		}

		rawEntity = {
			...rawEntity,
			...convertRelations(queryEntity, type, mappingEntry, mapping),
		};

		const decodeResult = decode({
			...rawEntity,
			__deleted: false,
			__version: "",
		});

		if (Either.isRight(decodeResult)) {
			data.push({ ...decodeResult.right, __schema: type });
		} else {
			invalidEntities.push(rawEntity);
		}
	}

	return { data, invalidEntities };
}

function convertPropertyValue(
	property: GraphqlEntityValue,
	key: string,
	type: Entity.AnyNoContext,
): string | boolean | number | Date {
	if (
		TypeUtils.isBooleanOrOptionalBooleanType(type.fields[key]) &&
		property.boolean !== undefined
	) {
		return Boolean(property.boolean);
	}
	if (
		TypeUtils.isPointOrOptionalPointType(type.fields[key]) &&
		property.point !== undefined
	) {
		return property.point;
	}
	if (
		TypeUtils.isDateOrOptionalDateType(type.fields[key]) &&
		property.time !== undefined
	) {
		return property.time;
	}
	if (
		TypeUtils.isNumberOrOptionalNumberType(type.fields[key]) &&
		property.number !== undefined
	) {
		return Number(property.number);
	}
	return property.string;
}

function convertRelations<S extends Entity.AnyNoContext>(
	queryEntity: RecursiveQueryEntity,
	type: S,
	mappingEntry: Mapping.MappingEntry,
	mapping: Mapping.Mapping,
) {
	const rawEntity: Record<string, string | boolean | number | unknown[] | Date> = {};

	for (const [key, relationId] of Object.entries(
		mappingEntry?.relations ?? {},
	)) {
		const properties = (queryEntity.relationsList ?? []).filter(
			(entry) => entry.typeId === relationId,
		);
		if (properties.length === 0) {
			rawEntity[key] = [] as unknown[];
			continue;
		}

		const field = type.fields[key];
		if (!field) {
			// @ts-expect-error TODO: properly access the type.name
			console.error(`Field ${key} not found in ${type.name}`);
			continue;
		}

		// @ts-expect-error TODO: properly access the type.name
		const annotations = field.ast.rest[0].type.to.annotations;

		const relationTypeName =
			annotations[
				Object.getOwnPropertySymbols(annotations).find(
					(sym) => sym.description === "effect/annotation/Identifier",
				)!
			];

		const relationMappingEntry = mapping[relationTypeName];
		if (!relationMappingEntry) {
			console.error(
				`Relation mapping entry for ${relationTypeName as string} not found`,
			);
			continue;
		}

		const newRelationEntities = properties.map((propertyEntry) => {
			// @ts-expect-error TODO: properly access the type.name
			const nestedType = field.value;

			let nestedRawEntity: Record<string, string | boolean | number | unknown[] | Date> = {
				id: propertyEntry.toEntity.id,
				name: propertyEntry.toEntity.name,
				__deleted: false,
				__version: "",
			};

			for (const [propertyKey, propertyId] of Object.entries(
				relationMappingEntry?.properties ?? {},
			)) {
				const property = propertyEntry.toEntity.valuesList?.find(
					(candidate) => candidate.propertyId === propertyId,
				);
				if (property) {
					nestedRawEntity[propertyKey] = convertPropertyValue(
						property,
						propertyKey,
						nestedType,
					);
				}
			}

			nestedRawEntity = {
				...nestedRawEntity,
				...convertRelations(
					propertyEntry.toEntity,
					nestedType,
					relationMappingEntry,
					mapping,
				),
			};

			return nestedRawEntity;
		});

		if (rawEntity[key]) {
			rawEntity[key] = [
				...(rawEntity[key] as unknown[]),
				...newRelationEntities,
			];
		} else {
			rawEntity[key] = newRelationEntities;
		}
	}

	return rawEntity;
}

type GraphqlFilterEntry =
	| {
			values: {
				some:
					| {
							propertyId: { is: string };
							string:
								| { is: string }
								| { startsWith: string }
								| { endsWith: string }
								| { includes: string };
						}
					| {
							propertyId: { is: string };
							boolean: { is: boolean };
						}
					| {
							propertyId: { is: string };
							number:
								| { is: string }
								| { greaterThan: string }
								| { lessThan: string };
						};
			};
	  }
	| {
			not: GraphqlFilterEntry;
	  }
	| {
			or: GraphqlFilterEntry[];
	  }
	| {
			and: GraphqlFilterEntry[];
	  }
	| { [k: string]: never };

function translateFilterToGraphql<S extends Entity.AnyNoContext>(
	filter: QueryPublicParams<S>["filter"],
	type: S,
	mapping: Mapping.Mapping,
): GraphqlFilterEntry {
	if (!filter) {
		return {};
	}

	// @ts-expect-error TODO should use the actual type instead of the name in the mapping
	const typeName = type.name;

	const mappingEntry = mapping[typeName];
	if (!mappingEntry) {
		throw new Error(`Mapping entry for ${typeName} not found`);
	}

	const graphqlFilter: GraphqlFilterEntry[] = [];

	for (const [fieldName, fieldFilter] of Object.entries(filter)) {
		if (fieldName === "or" && Array.isArray(fieldFilter)) {
			graphqlFilter.push({
				or: fieldFilter.map((childFilter) =>
					translateFilterToGraphql(childFilter, type, mapping),
				),
			});
			continue;
		}

		if (fieldName === "not" && fieldFilter) {
			graphqlFilter.push({
				not: translateFilterToGraphql(
					fieldFilter as QueryPublicParams<S>["filter"],
					type,
					mapping,
				),
			});
			continue;
		}

		if (!fieldFilter) {
			continue;
		}

		const propertyId = mappingEntry?.properties?.[fieldName];

		if (propertyId) {
			const stringFilter = fieldFilter as {
				is?: string;
				startsWith?: string;
				endsWith?: string;
				contains?: string;
			};
			const hasStringCondition =
				stringFilter.is !== undefined ||
				stringFilter.startsWith !== undefined ||
				stringFilter.endsWith !== undefined ||
				stringFilter.contains !== undefined;

			if (
				TypeUtils.isStringOrOptionalStringType(type.fields[fieldName]) &&
				hasStringCondition
			) {
				const stringClause =
					stringFilter.is !== undefined
						? { is: stringFilter.is }
					: stringFilter.startsWith !== undefined
						? { startsWith: stringFilter.startsWith }
					: stringFilter.endsWith !== undefined
						? { endsWith: stringFilter.endsWith }
					: { includes: stringFilter.contains as string };

				graphqlFilter.push({
					values: {
						some: {
							propertyId: { is: propertyId },
							string: stringClause,
						},
					},
				});
			}

			const booleanFilter = fieldFilter as { is?: boolean };
			if (
				TypeUtils.isBooleanOrOptionalBooleanType(type.fields[fieldName]) &&
				booleanFilter.is !== undefined
			) {
				graphqlFilter.push({
					values: {
						some: {
							propertyId: { is: propertyId },
							boolean: { is: booleanFilter.is },
						},
					},
				});
			}

			const numberFilter = fieldFilter as {
				is?: number;
				greaterThan?: number;
				lessThan?: number;
			};
			const hasNumberCondition =
				numberFilter.is !== undefined ||
				numberFilter.greaterThan !== undefined ||
				numberFilter.lessThan !== undefined;

			if (
				TypeUtils.isNumberOrOptionalNumberType(type.fields[fieldName]) &&
				hasNumberCondition
			) {
				graphqlFilter.push({
					values: {
						some: {
							propertyId: { is: propertyId },
							number:
								numberFilter.is !== undefined
									? { is: Graph.serializeNumber(numberFilter.is) }
									: numberFilter.greaterThan !== undefined
										? {
												greaterThan: Graph.serializeNumber(
													numberFilter.greaterThan,
												),
											}
										: {
												lessThan: Graph.serializeNumber(
													numberFilter.lessThan as number,
												),
											},
						},
					},
				});
			}
		}
	}

	if (graphqlFilter.length === 1) {
		return graphqlFilter[0];
	}

	if (graphqlFilter.length === 0) {
		return {};
	}

	return {
		and: graphqlFilter,
	};
}

async function requestGraphql<T>(
	endpoint: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`GraphQL request failed with status ${response.status}: ${body}`,
		);
	}

	const payload: { data?: T; errors?: { message: string }[] } =
		await response.json();

	if (payload.errors?.length) {
		throw new Error(payload.errors.map((error) => error.message).join("\n"));
	}

	if (!payload.data) {
		throw new Error("GraphQL response contained no data");
	}

	return payload.data;
}
