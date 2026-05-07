const SPINNER_STYLE_ID = "spinner-keyframes";

export const ensureSpinnerAnimation = (): void => {
	if (document.getElementById(SPINNER_STYLE_ID)) {
		return;
	}
	const style = document.createElement("style");
	style.id = SPINNER_STYLE_ID;
	style.innerHTML = `
    @keyframes spinner-rotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
	document.head.appendChild(style);
};
