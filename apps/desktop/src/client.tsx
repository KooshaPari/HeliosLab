import { render } from "solid-js/web";
import App from "./index.tsx";

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
