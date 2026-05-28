import DB, { type SchemaToDocumentTypes } from "goldfishdb";
import { COLAB_GOLDFISHDB_PATH } from "../consts/paths";

import { schema1 } from "./schema/initial_schema_1";
import { schema2 } from "./schema/add_settings_2";
import { schema3 } from "./schema/add_llama_settings_3";
import { schema4 } from "./schema/remove_dropdown_setting_4";
import { schema5 } from "./schema/add_github_settings_5";
import { schema6 } from "./schema/add_analytics_settings_6";
import { schema7 } from "./schema/add_colab_cloud_settings_7";

const currentSchema = schema7;

export type CurrentDocumentTypes = SchemaToDocumentTypes<typeof currentSchema>;

const db = new DB<typeof currentSchema>().init({
  schemaHistory: [
    { v: 1, schema: schema1, migrationSteps: false },
    { v: 2, schema: schema2, migrationSteps: false },
    { v: 3, schema: schema3, migrationSteps: false },
    { v: 4, schema: schema4, migrationSteps: false },
    { v: 5, schema: schema5, migrationSteps: false },
    { v: 6, schema: schema6, migrationSteps: false },
    { v: 7, schema: schema7, migrationSteps: false },
  ],
  db_folder: COLAB_GOLDFISHDB_PATH,
  passphrase: 'colab-dev-encryption-key'
});

export default db;
