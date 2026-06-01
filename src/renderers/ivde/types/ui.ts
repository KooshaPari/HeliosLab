export type ReloadableWebviewElement = {
	reload: () => void;
};

export type WebviewDidNavigateEvent = {
	detail: string;
};

export type AnalyticsStatus = {
	enabled: boolean;
	level: string;
	isAnonymous: boolean;
	hasToken: boolean;
	userOptedIn: boolean;
	userHasBeenPrompted: boolean;
};
