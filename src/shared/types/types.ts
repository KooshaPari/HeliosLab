import type ts from "typescript";

export interface PostMessageShowContextMenu {
  type: "show_context_menu";
  data: {
    menuItems: (
      | {
          label: string;
          visible?: boolean;
          portalMessage: {
            type: string;
            data: {};
          };
        }
      | {
          type: "separator";
          visible?: boolean;
        }
    )[];
  };
}

// Note: React provides a React.ChangeEvent<T> similar to this
// We need it for things like MouseEvents and InputEvents that for some reason
// Don't define target or currentTarget directly
export type DomEventWithTarget<Ev, El = Element> = Ev & {
  // The element that the event listener is attached
  currentTarget: El;
  // The element that dispatched the event which could be any element
  // Depending on how we're bubbling. it could even be the document itself
  target: EventTarget;
};

export interface FileNodeType {
  type: "file";
  name: string;
  path: string;
  persistedContent: string;
  isDirty: boolean;
  model: any;
  // Keep track of all the open editors
  editors: Record<string, any>;
  // Track whether file contents have been loaded (vs just discovered via file watcher)
  isCached?: boolean;
  // Track if this is a binary file
  isBinary?: boolean;
  // Track how many bytes were loaded (if loadedBytes < totalBytes, it's partial)
  loadedBytes?: number;
  // Track total file size
  totalBytes?: number;
}

export interface FolderNodeType {
  type: "dir";
  name: string;
  path: string;
  children: string[];
}

// This File is different from the FileTree File
export type CachedFileType = FolderNodeType | FileNodeType;

export type PreviewFileNodeType = FileNodeType;

export type SlateType =
  | {
      v: 1;
      name: string;
      // Todo (yoav): [blocking] url should be in config
      type: "web";
      url: string;
      icon: string;
      config: {
        renderer?: "cef" | "system";
      };
    }
  | {
      v: 1;
      name: string;
      type: "project";
      // Todo (yoav): [blocking] why do we need url on a project?
      url: string;
      icon: string;
      config: any;
    }
  | {
      v: 1;
      name: string;
      type: "agent";
      icon: string;
      config: {
        model?: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        repeatPenalty?: number;
        aiSettings?: {
          temperature?: number;
          maxTokens?: number;
          topP?: number;
          repeatPenalty?: number;
        };
        chatHistories?: {
          id: string;
          title: string;
          messages: {
            role: "user" | "assistant";
            content: string;
            timestamp: number;
          }[];
          createdAt: number;
          updatedAt: number;
        }[];
        systemPrompt?: string;
        conversationHistory?: {
          role: "user" | "assistant";
          content: string;
          timestamp: number;
        }[];
      };
    }
  | {
      // Not stored in .colab.json, based on subfolder
      type: "devlink";
    }
  | {
      v: 1;
      name: string;
      type: "repo";
      icon: string;
      config: {
        gitUrl?: string;
      };
    };

export interface ProjectType {
  id: string;
  name: string;
  // Slates: { [relativePath: string]: Slate };
  path: string;
}

export type PreviewFolderNodeType = Omit<FolderNodeType, "children"> & {
  isExpanded: boolean;
  previewChildren: PreviewFileTreeType[];
  slate?: SlateType;
};

export type PreviewFileTreeType = CachedFileType | PreviewFolderNodeType;

export type WebflowSitesResponseType = {
  _id: string;
  name: string;
  shortName: string;
}[];

// Note: the easiest way to get types here is to create a union of all the possible event and response types
export type ParsedResponseType =
  | ts.server.protocol.ProjectLoadingStartEvent
  | ts.server.protocol.ProjectLoadingFinishEvent
  | ts.server.protocol.TelemetryEvent
  | ts.server.protocol.DiagnosticEvent
  | ts.server.protocol.RequestCompletedEvent
  | ts.server.protocol.SemanticDiagnosticsSyncResponse
  | ts.server.protocol.SyntacticDiagnosticsSyncResponse
  | ts.server.protocol.CompletionsResponse
  | (ts.server.protocol.QuickInfoResponse & { command: "quickinfo" })
  | (ts.server.protocol.DefinitionResponse & { command: "findSourceDefinition" });

export type PanePathType = number[];
