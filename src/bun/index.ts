import { BrowserWindow } from "electrobun/bun";

const window = new BrowserWindow({
  title: "test",
  url: "https://colab.dev",
  frame: {
    width: 500,
    height: 500,
    x: 100,
    y: 100,
  },
});

console.log("hi");
