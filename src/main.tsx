import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./i18n";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider } from "./context/ThemeContext";

document.addEventListener("contextmenu", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
