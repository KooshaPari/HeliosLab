// Analytics module with support for community and pro/team editions
import Mixpanel from "mixpanel";
import db from "../goldfishdb/db";

// Configuration for different analytics levels
interface AnalyticsConfig {
  community: {
    enabled: boolean;
    events: string[];
    anonymous: boolean;
  };
  registered: {
    enabled: boolean;
    events: string[];
    userId?: string;
  };
}

// Build-time injected values (replaced by postBuild.ts)
const MIXPANEL_TOKEN = "BUILD_TIME_MIXPANEL_TOKEN";

// Get user plan for analytics
const getUserPlan = (): 'community' | 'pro' | 'team' => {
  if (!isAuthenticated()) return 'community';
  if (isTeam()) return 'team';
  if (isPro()) return 'pro';
  return 'community';
};

// TODO: Replace with actual auth check when cloud features are implemented
const isAuthenticated = (): boolean => {
  return false; // Hardcoded for now, will connect to auth system later
};

const isPro = (): boolean => {
  // TODO: Check user subscription status
  return false;
};

const isTeam = (): boolean => {
  // TODO: Check team subscription status
  return false;
};

// Get or create unique anonymous ID for community edition
export const getUniqueId = () => {
  return String(Date.now() + Math.random());
};

// Initialize app settings if needed
const _settings = db.collection("appSettings").query()?.data || [];
if (!_settings.length || !_settings[0]?.distinctId) {
  console.log("Creating initial app settings");
  db.collection("appSettings").insert({
    distinctId: getUniqueId(),
    analyticsEnabled: false, // Default to disabled
    analyticsConsentPrompted: false, // Haven't asked user yet
    llama: { // Default llama.cpp settings
      enabled: true,
      baseUrl: "llama.cpp",
      model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
      temperature: 0.1,
      inlineEnabled: true,
    },
    github: {
      accessToken: "",
      username: "",
      connectedAt: 0,
      scopes: [],
    },
  } as any); // Type assertion to work around schema typing issue
}

const settings = (db.collection("appSettings").query()?.data || [])[0];

// Community events - basic anonymous metrics
const COMMUNITY_EVENTS = [
  'app_launch',
  'crash_report', 
  'version_check',
  'feature_discovery', // Which features are being discovered
  'performance_metric' // Anonymous performance data
];

// Pro/Team events - detailed tracking for registered users
const REGISTERED_EVENTS = [
  ...COMMUNITY_EVENTS,
  'feature_usage',
  'project_metrics',
  'collaboration_action',
  'sync_performed',
  'cloud_storage_used',
  'workspace_created',
  'settings_changed'
];

// Determine current analytics configuration
const getAnalyticsConfig = (): AnalyticsConfig => {
  const isUserAuthenticated = isAuthenticated();
  const analyticsOptIn = settings?.analyticsEnabled || false; // Explicit false default
  const hasToken = MIXPANEL_TOKEN && MIXPANEL_TOKEN !== "BUILD_TIME_MIXPANEL_TOKEN";
  
  return {
    community: {
      enabled: !isUserAuthenticated && analyticsOptIn && hasToken,
      events: COMMUNITY_EVENTS,
      anonymous: true
    },
    registered: {
      enabled: isUserAuthenticated && analyticsOptIn && hasToken, // Consent required for everyone!
      events: REGISTERED_EVENTS,
      userId: isUserAuthenticated ? settings?.userId : undefined
    }
  };
};

// Check if we should track a specific event
const shouldTrackEvent = (eventName: string): boolean => {
  const config = getAnalyticsConfig();
  
  if (isAuthenticated()) {
    return config.registered.enabled && config.registered.events.includes(eventName);
  } else {
    return config.community.enabled && config.community.events.includes(eventName);
  }
};

// Initialize Mixpanel if analytics is enabled and token is available
let mixpanel: any = null;
const config = getAnalyticsConfig();

if ((config.community.enabled || config.registered.enabled) && MIXPANEL_TOKEN && MIXPANEL_TOKEN !== "BUILD_TIME_MIXPANEL_TOKEN") {
  mixpanel = Mixpanel.init(MIXPANEL_TOKEN);
  
  // Set up user profile for authenticated users
  if (config.registered.enabled && config.registered.userId) {
    mixpanel.people.set(config.registered.userId, {
      plan: isPro() ? 'pro' : isTeam() ? 'team' : 'community',
      // Additional user properties will be added when auth is implemented
    });
  }
}

// Get client ID based on auth status
const getClientId = (): string => {
  const config = getAnalyticsConfig();
  if (config.registered.enabled && config.registered.userId) {
    return config.registered.userId;
  }
  return settings.distinctId;
};

// Core tracking function with event filtering
export const sendToMixpanel = async (event: string, properties: any) => {
  // Map old event names to new standardized ones
  const eventMapping: { [key: string]: string } = {
    'app open': 'app_launch',
    'update check': 'version_check',
    'update install': 'update_install',
    'commandPalette open': 'feature_usage',
    'tab open': 'feature_usage'
  };
  
  const standardizedEvent = eventMapping[event] || event;
  
  // Check if we should track this event based on user type
  if (!shouldTrackEvent(standardizedEvent)) {
    console.log(`Skipping analytics event (not enabled): ${standardizedEvent}`);
    return;
  }
  
  // Check if Mixpanel is available
  if (!mixpanel) {
    console.log(`Skipping analytics event (no token configured): ${standardizedEvent}`);
    return;
  }
  
  console.log(`Tracking event: ${standardizedEvent}`, properties);
  
  if (mixpanel) {
    const trackingData = {
      distinct_id: getClientId(),
      ...properties,
      // Add metadata
      plan: getUserPlan(), // Primary plan identifier
      is_authenticated: isAuthenticated(),
      is_pro: isPro(),
      is_team: isTeam(),
      tracking_version: '2.0.0'
    };
    
    // For community edition, strip any potentially identifying information
    if (!isAuthenticated()) {
      delete trackingData.email;
      delete trackingData.name;
      delete trackingData.userId;
      // Add any other PII fields to strip
    }
    
    mixpanel.track(standardizedEvent, trackingData);
  }
};

// Public tracking API with clear methods for different event types
export const track = {
  // Community events (anonymous)
  appLaunch: (props: {
    channel: string;
    appName: string;
    version: string;
    hash: string;
  }) => {
    sendToMixpanel("app_launch", {
      ...props,
      timestamp: new Date().toISOString()
    });
  },
  
  versionCheck: (props: {
    version: string;
    hash: string;
    updateAvailable: boolean;
    updateReady: boolean;
  }) => {
    sendToMixpanel("version_check", props);
  },
  
  updateInstall: (props: { triggeredBy: "user" | "auto" }) => {
    sendToMixpanel("update_install", props);
  },
  
  crashReport: (props: {
    error: string;
    stack?: string;
    context?: string;
  }) => {
    // Strip sensitive paths from stack traces
    const sanitizedStack = props.stack?.replace(/\/Users\/[^\/]+/g, '/Users/***');
    sendToMixpanel("crash_report", {
      ...props,
      stack: sanitizedStack
    });
  },
  
  performanceMetric: (props: {
    metric: string;
    value: number;
    context?: string;
  }) => {
    sendToMixpanel("performance_metric", props);
  },
  
  // Feature usage (maps to different event based on auth status)
  featureUsed: (props: {
    feature: string;
    action?: string;
    metadata?: any;
  }) => {
    sendToMixpanel("feature_usage", props);
  },
  
  // Pro/Team events (only tracked for authenticated users)
  projectMetrics: (props: {
    projectCount: number;
    totalSize?: number;
    activeProjects?: number;
  }) => {
    if (isAuthenticated()) {
      sendToMixpanel("project_metrics", props);
    }
  },
  
  syncPerformed: (props: {
    syncType: string;
    itemCount: number;
    duration: number;
    success: boolean;
  }) => {
    if (isAuthenticated()) {
      sendToMixpanel("sync_performed", props);
    }
  },
  
  workspaceCreated: (props: {
    workspaceType: string;
    source: string;
  }) => {
    if (isAuthenticated()) {
      sendToMixpanel("workspace_created", props);
    }
  }
};

// Settings management for analytics opt-in/out (legacy function - use setAnalyticsConsent instead)
export const updateAnalyticsConsent = (enabled: boolean) => {
  setAnalyticsConsent(enabled);
};

// Get current analytics status for UI
export const getAnalyticsStatus = () => {
  const config = getAnalyticsConfig();
  const hasToken = MIXPANEL_TOKEN && MIXPANEL_TOKEN !== "BUILD_TIME_MIXPANEL_TOKEN";
  
  return {
    enabled: config.community.enabled || config.registered.enabled,
    level: isAuthenticated() ? 'registered' : 'community',
    isAnonymous: !isAuthenticated(),
    eventsTracked: isAuthenticated() ? config.registered.events : config.community.events,
    hasToken: hasToken,
    userOptedIn: settings?.analyticsEnabled || false,
    userHasBeenPrompted: settings?.analyticsConsentPrompted || false
  };
};

// Check if user should be prompted for analytics opt-in
export const shouldPromptForAnalyticsConsent = (): boolean => {
  const hasToken = MIXPANEL_TOKEN && MIXPANEL_TOKEN !== "BUILD_TIME_MIXPANEL_TOKEN";
  const userHasBeenPrompted = settings?.analyticsConsentPrompted || false;
  
  // Prompt ALL users (community AND paying) if:
  // 1. Build has analytics token (official release)
  // 2. User hasn't been prompted before
  // GDPR/Privacy laws require consent from everyone, regardless of payment status
  return hasToken && !userHasBeenPrompted;
};

// Set analytics consent and mark as prompted
export const setAnalyticsConsent = (enabled: boolean) => {
  const settingsDoc = db.collection("appSettings").query()?.data?.[0];
  if (settingsDoc && settingsDoc.id) {
    db.collection("appSettings").update(settingsDoc.id, {
      analyticsEnabled: enabled,
      analyticsConsentPrompted: true
    });
  }
  
  // Re-initialize or destroy Mixpanel based on new consent
  if (!enabled && mixpanel) {
    mixpanel = null;
  } else if (enabled && !mixpanel && MIXPANEL_TOKEN && MIXPANEL_TOKEN !== "BUILD_TIME_MIXPANEL_TOKEN") {
    mixpanel = Mixpanel.init(MIXPANEL_TOKEN);
  }
};

// Legacy support - map old track methods
export const legacyTrack = {
  appOpen: track.appLaunch,
  checkForUpdate: track.versionCheck,
  installUpdateNow: track.updateInstall,
  commandPaletteOpen: (props: { fromShortcut: boolean }) => {
    track.featureUsed({ 
      feature: 'command_palette',
      action: 'open',
      metadata: props 
    });
  },
  tabOpen: (props: { type: "file" | "web" | "terminal" | "agent" }) => {
    track.featureUsed({
      feature: 'tab',
      action: 'open',
      metadata: props
    });
  }
};

// Export legacy track object for backwards compatibility
// TODO: Update all call sites to use new track methods
Object.assign(track, legacyTrack);