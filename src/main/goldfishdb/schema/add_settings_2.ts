import DB from "goldfishdb";

const { collection, string, boolean, object, array, record, number, defaultOpts, schema } =
  DB.v1.schemaType;

export const schema2 = schema({
  v: 1,
  stores: {
    workspaces: collection({
      name: string({ required: true, internal: false }),
      color: string({ required: true, internal: false }),
      // Really a relation to projects/projects
      // This gives us sorted projects for the workspace, and lets us share projects across workspaces
      projectIds: array(string(defaultOpts), {
        required: true,
        internal: false,
      }),
      visible: boolean({ required: true, internal: false }),
      windows: array(
        object(
          {
            id: string({ required: true, internal: false }),
            ui: object(
              {
                showSidebar: boolean({ required: true, internal: false }),
                sidebarWidth: number({ required: true, internal: false }),
              },
              { required: true, internal: false },
            ),
            // The window box dimensions
            position: object(
              {
                // Todo (yoav): do we need screen name or id or something here
                x: number({ required: true, internal: false }),
                y: number({ required: true, internal: false }),
                width: number({ required: true, internal: false }),
                height: number({ required: true, internal: false }),
              },
              { required: true, internal: false },
            ),
            // Folder expansions in the window
            expansions: array(string(defaultOpts), {
              required: true,
              internal: false,
            }),
            // Nested object arrays of panes, paneContainers in the window
            // Root pane is the default object
            // Todo (yoav): allow setting a default object
            rootPane: object({}, defaultOpts),
            currentPaneId: string({ required: true, internal: false }),
            // Tabs in the window (referenced by panes)
            // Note: we filter out preview tabs from this list
            // Todo (yoav): would be nice to define the shape of the tabs here, but they're keyed by id so we need a record type
            // Tabs: object({}, {internal: false, required: true}),
            tabs: record(
              {
                id: string({ ...defaultOpts, required: true }),
                path: string({ ...defaultOpts, required: true }),
                isPreview: boolean({ ...defaultOpts, required: true }),
                paneId: string({ ...defaultOpts, required: true }),
                url: string(defaultOpts),
              },
              { ...defaultOpts, required: true },
            ),
          },
          defaultOpts,
        ),
        { required: true, internal: false },
      ),
    }),
    // Projects
    projects: collection({
      name: string(defaultOpts),
      // Absolute root path to custom directory for this project
      path: string(defaultOpts),
      // Todo (yoav): would be nice to have a keyValue type that you can put at the collection or nested levels
      // And just define the shape of keys and/or values. But for this we can get away with just having an array
      // Of string paths
      // Todo (yoav): move this to nested in workspace per window
      expansions: array(string(defaultOpts), defaultOpts),
    }),
    tokens: collection({
      name: string({ ...defaultOpts, required: true }), // Webflow
      url: string(defaultOpts), // https://webflow.com (matched against the slate url)
      endpoint: string({ ...defaultOpts, required: true }), // https://api.webflow.com
      token: string({ ...defaultOpts, required: true }),
    }),
    // Note: until we support KeyValue collections, we'll just store a single settings collection item and have that be the settings
    appSettings: collection({
      distinctId: string({ required: true, internal: false }),
    }),
    // FileMeta: collection({
    //   ExpansionMap: object({})
    // }),
    // Windows: collection({}),
  },
});
