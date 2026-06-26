import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json" assert { type: "json" };

// HeliosLab desktop shell — Electrobun wrapping pheno-* Rust core via sidecar
export default {
    "app": {
        "name": "HeliosLab",
        "identifier": "org.phenotype.helioslab",
        "version": packageJson.version,
        "icon": "assets/brand/app.ico",
    },
    "build": {
        "bun": {
            "entrypoint": "src/main/helioslab.ts",
            "external": []
        },
        "views": {
            helioslab: {
                entrypoint: "src/renderers/helioslab/index.ts",
            },
            // Legacy colab views retained for reference
            bunny: {
                entrypoint: "src/renderers/bunny/index.ts",
            },
            ivde: {
                entrypoint: "src/renderers/ivde/index.ts",
            },
        },
        "copy": {
            "src/renderers/helioslab/index.html": "views/helioslab/index.html",
            "src/renderers/ivde/index.html": "views/ivde/index.html",
            "src/renderers/ivde/styles/": "views/ivde/styles/",
            "assets/custom.editor.worker.js": "views/ivde/custom.editor.worker.js",
            "assets/": "views/assets/",
            "node_modules/@xterm/xterm/css/xterm.css": "views/ivde/xterm.css",
            "src/renderers/bunny/index.html": "views/bunny/index.html",
            "src/renderers/bunny/index.css": "views/bunny/index.css",
            "assets/bunny.png": "views/bunny/assets/bunny.png",
            "assets/brand/": "views/assets/brand/"
        },
        "mac": {
            "codesign": false,
            "notarize": false,
            "bundleCEF": false,
            "entitlements": {}
        },
        watch: [],
        watchIgnore: [
            'assets/licenses.html'
        ]
    },
    "runtime": {
        exitOnLastWindowClosed: true
    },
    "release": {
        "baseUrl": "https://helioslab.phenotype.org/releases/"
    }
} satisfies ElectrobunConfig;

