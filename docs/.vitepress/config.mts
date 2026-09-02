import { defineConfig } from "vitepress";

export default defineConfig({
	title: "Project",
	description: "Documentation",
	themeConfig: {
		nav: [
			{ text: "Home", link: "/" },
			{ text: "Journeys", link: "/journeys/" },
			{ text: "Stories", link: "/stories/" },
			{ text: "Operations", link: "/operations/" },
			{ text: "Demo", link: "/demo/" },
			{ text: "Traceability", link: "/traceability/" },
		],
		sidebar: {
			"/journeys/": [
				{
					text: "Journeys",
					items: [
						{ text: "Overview", link: "/journeys/" },
						{ text: "Quick Start", link: "/journeys/quick-start" },
						{ text: "Core Integration", link: "/journeys/core-integration" },
						{ text: "Production Setup", link: "/journeys/production-setup" },
					],
				},
			],
			"/stories/": [
				{
					text: "Stories",
					items: [
						{ text: "Overview", link: "/stories/" },
						{ text: "Hello World", link: "/stories/hello-world" },
						{ text: "Integration", link: "/stories/integration" },
					],
				},
			],
			"/operations/": [
				{
					text: "Operations",
					items: [
						{ text: "Overview", link: "/operations/" },
						{ text: "Runbook", link: "/operations/runbook" },
						{ text: "Incident Response", link: "/operations/incident-response" },
						{ text: "Migration", link: "/operations/HELIOSLAB_MIGRATION" },
					],
				},
			],
			"/demo/": [
				{
					text: "Demo",
					items: [
						{ text: "Overview", link: "/demo/" },
						{ text: "On-device", link: "/demo/on-device" },
					],
				},
			],
			"/traceability/": [
				{
					text: "Traceability",
					items: [{ text: "Overview", link: "/traceability/" }],
				},
			],
		},
	},
});
