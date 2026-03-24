declare module "goldfishdb" {
  import type {
    CollectionSchemaInternalProperties,
    CollectionStore,
    CollectionStoreSchema,
    CollectionMethods as CollectionMethodsBase,
    DBConfig,
    NestedSchemaType,
    SchemaArrayType,
    SchemaBooleanType,
    SchemaDefinition,
    SchemaDefinitionDefault,
    SchemaDefinitionWithDefaults,
    SchemaNumberType,
    SchemaObjectType,
    SchemaPropertyType,
    SchemaRecordType,
    SchemaStringType,
    StoreSchemaToDocumentType,
  } from "../../../node_modules/goldfishdb/src/core/types";

  export type {
    DBConfig,
    SchemaDefinition,
    SchemaDefinitionDefault,
    SchemaDefinitionWithDefaults,
  };

  export type SchemaToDocumentTypes<
    SchemaDef extends { stores: Record<string, unknown> },
  > = {
    [StoreName in keyof SchemaDef["stores"]]: SchemaDef["stores"][StoreName] extends CollectionStore<
      infer StoreSchema extends CollectionStoreSchema
    >
      ? StoreSchemaToDocumentType<StoreSchema>
      : never;
  };

  type CollectionMethods<TDocument> = CollectionMethodsBase<TDocument>;

  type SchemaTypeFactory = {
    schema: <
      I extends SchemaDefinitionWithDefaults,
      O extends SchemaDefinition<I["stores"]>,
    >(
      schemaDefinition: I,
    ) => O;
    collection: <Schema>(
      nestedSchema: Schema,
    ) => CollectionStore<CollectionSchemaInternalProperties<Schema>>;
    record: <
      Req extends boolean,
      Int extends boolean,
      Schema extends NestedSchemaType,
    >(
      objectSchema: Schema,
      opts: { required: Req; internal: Int },
    ) => SchemaRecordType<Schema> & { required: Req; internal: Int };
    object: <
      Req extends boolean,
      Int extends boolean,
      Schema extends NestedSchemaType,
    >(
      objectSchema: Schema,
      opts: { required: Req; internal: Int },
    ) => SchemaObjectType<Schema> & { required: Req; internal: Int };
    array: <
      Req extends boolean,
      Int extends boolean,
      Schema extends SchemaPropertyType,
    >(
      arraySchema: Schema,
      opts: { required: Req; internal: Int },
    ) => SchemaArrayType<Schema> & { required: Req; internal: Int };
    string: <Req extends boolean, Int extends boolean>(
      opts: { required: Req; internal: Int },
    ) => SchemaStringType & { required: Req; internal: Int };
    number: <Req extends boolean, Int extends boolean>(
      opts: { required: Req; internal: Int },
    ) => SchemaNumberType & { required: Req; internal: Int };
    boolean: <Req extends boolean, Int extends boolean>(
      opts: { required: Req; internal: Int },
    ) => SchemaBooleanType & { required: Req; internal: Int };
    timestamp: <Req extends boolean, Int extends boolean>(
      opts: { required: Req; internal: Int },
    ) => SchemaNumberType & { required: Req; internal: Int };
    defaultOpts: { required: false; internal: false };
  };

  class DB<CurrentSchema extends SchemaDefinitionWithDefaults = SchemaDefinitionWithDefaults> {
    static readonly v1: {
      schemaType: SchemaTypeFactory;
    };

    collection: <StoreName extends keyof SchemaToDocumentTypes<CurrentSchema>>(
      storeName: StoreName,
    ) => CollectionMethods<SchemaToDocumentTypes<CurrentSchema>[StoreName]>;
    init(config: DBConfig): this;
    close(): void;
  }

  export default DB;
}
