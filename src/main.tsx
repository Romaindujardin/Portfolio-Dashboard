import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Always enable dark mode by adding the 'dark' class to <html>
document.documentElement.classList.add("dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
