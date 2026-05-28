> [!NOTE]
> We believe in shipping early and often.
> Now that **we're using co(lab) to build all of Blackboard's projects internally including Electrobun and co(lab) itself** we decided to open source it and make the Developer Preview available for download for early feedback.

>[!IMPORTANT]
> **Some of the listed features are in early development**, and our FTU and onboarding could use some love.
> We invite the **brave** to download the developer preview as we prep for v1 and **give us feedback** on how co(lab) could best help you do your best deep work


# Co(lab)

A hybrid web browser + local code editor for deep work.

## Demo

[![Co(lab) Demo](https://img.youtube.com/vi/WWTCqGmE86w/maxresdefault.jpg)](https://www.youtube.com/watch?v=WWTCqGmE86w)

**Co(lab)** combines a powerful code editor with an integrated browser. At Blackboard Technologies we think about startups night and day. Co(lab) is our flagship product, built with [Electrobun](https://github.com/blackboardsh/electrobun), and we hope to make it the ultimate startup building environment.

## Features

- **Unified Development Environment**: Local code editor powered by Monaco and Bun combined with a tinkerer's web browser in the same window, multi-tab, multi-pane.
- **Web Browser**: Open Chromium or Webkit tabs. Isolate your online accounts in their own workspaces. Smart bookmarks and easy to edit preload scripts for customizing your browsing experience.
- **A new way to folder**: Files and Folders are a primary concept. Arrange projects, notes, git repos, and bookmarks the way you actually use them.
- **Git Integration**: Visual git interface with staging, commits, and branch management
- **Plugin Architecture**: Extensible system for custom functionality for the ultimate browsing, coding, and tightly integrated workflows.
- **Privacy-First Analytics**: Optional, opt-in analytics.

## Installation

### Download

Visit [blackboard.sh/colab/](https://blackboard.sh/colab/) to download the latest release for your platform. (Currently shipping Mac ARM only).

### Build from Source

```bash
# Clone the repository
git clone https://github.com/blackboardsh/colab.git
cd colab

# Install dependencies
bun install

# Build and run
bun run dev
```

## Development

Co(lab) is built with [Electrobun](https://github.com/blackboardsh/electrobun), a modern alternative to Electron.

### Prerequisites

- Node.js 18+
- Bun runtime

### Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build:stable
```

### Project Structure

- `src/main/` - Main process code
- `src/renderers/` - Renderer process UI
- `src/shared/` - Shared utilities and types
- `scripts/` - Build and deployment scripts

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Areas for Contribution

- Plugin development and architecture
- UI/UX improvements
- Performance optimizations
- Documentation and examples
- Testing and quality assurance

## Roadmap

- **Plugin Ecosystem**: Extensible architecture for community plugins
- **Cloud Sync**: Optional settings and project synchronization
- **Team Collaboration**: Real-time collaborative editing features
- **AI Integration**: Code completion and assistance features

## Technology

Co(lab) is powered by:

- **[Electrobun](https://github.com/blackboardsh/electrobun)**: Modern desktop app framework
- **[SolidJS](https://solidjs.com)**: Reactive UI library
- **[Monaco Editor](https://microsoft.github.io/monaco-editor/)**: VS Code's editor engine
- **[TypeScript](https://typescriptlang.org)**: Type-safe development

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Website**: [blackboard.sh/colab/](https://blackboard.sh/colab/)
- **Issues**: [GitHub Issues](https://github.com/blackboardsh/colab/issues)
- **Discussion**: [Discord](https://discord.gg/ueKE4tjaCE)

---

**Co(lab)** is developed by [Blackboard Technologies Inc.](https://blackboard.sh)
