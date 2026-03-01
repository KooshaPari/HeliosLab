import DB from "goldfishdb";

const { collection, string, boolean, object, array, record, number, defaultOpts, schema } =
  DB.v1.schemaType;

export const schema8 = schema({
  v: 1,
  stores: {
    workspaces: collection({
      name: string({ required: true, internal: false }),
      color: string({ required: true, internal: false }),
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
            position: object(
              {
                x: number({ required: true, internal: false }),
                y: number({ required: true, internal: false }),
                width: number({ required: true, internal: false }),
                height: number({ required: true, internal: false }),
              },
              { required: true, internal: false },
            ),
            expansions: array(string(defaultOpts), {
              required: true,
              internal: false,
            }),
            rootPane: object({}, defaultOpts),
            currentPaneId: string({ required: true, internal: false }),
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
    projects: collection({
      name: string(defaultOpts),
      path: string(defaultOpts),
      expansions: array(string(defaultOpts), defaultOpts),
    }),
    tokens: collection({
      name: string({ ...defaultOpts, required: true }),
      url: string(defaultOpts),
      endpoint: string({ ...defaultOpts, required: true }),
      token: string({ ...defaultOpts, required: true }),
    }),
    appSettings: collection({
      distinctId: string({ required: true, internal: false }),
      analyticsEnabled: boolean({ required: false, internal: false }),
      analyticsConsentPrompted: boolean({ required: false, internal: false }),
      userId: string({ required: false, internal: false }),
      llama: object(
        {
          enabled: boolean({ required: false, internal: false }),
          baseUrl: string({ required: false, internal: false }),
          model: string({ required: false, internal: false }),
          temperature: number({ required: false, internal: false }),
          inlineEnabled: boolean({ required: false, internal: false }),
        },
        { required: false, internal: false },
      ),
      github: object(
        {
          accessToken: string(defaultOpts),
          username: string(defaultOpts),
          connectedAt: number(defaultOpts),
          scopes: array(string(defaultOpts), defaultOpts),
        },
        defaultOpts,
      ),
      colabCloud: object(
        {
          accessToken: string(defaultOpts),
          refreshToken: string(defaultOpts),
          userId: string(defaultOpts),
          email: string(defaultOpts),
          name: string(defaultOpts),
          emailVerified: boolean(defaultOpts),
          connectedAt: number(defaultOpts),
          syncPassphrase: string(defaultOpts),
        },
        defaultOpts,
      ),
    }),
    // ── Helios collections (added in schema v8) ──
    helios_settings: collection({
      rendererEngine: string({ required: true, internal: false }),
      hotSwapPreferred: boolean({ required: true, internal: false }),
    }),
    helios_lanes: collection({
      workspaceId: string({ required: true, internal: false }),
      laneId: string({ required: true, internal: false }),
      sessionId: string(defaultOpts),
      terminalId: string(defaultOpts),
      transport: string({ required: true, internal: false }),
      state: string({ required: true, internal: false }),
      lastUpdated: string({ required: true, internal: false }),
    }),
    helios_audit: collection({
      timestamp: string({ required: true, internal: false }),
      action: string({ required: true, internal: false }),
      workspaceId: string({ required: true, internal: false }),
      laneId: string(defaultOpts),
      sessionId: string(defaultOpts),
      detail: string({ required: true, internal: false }),
    }),
  },
});
