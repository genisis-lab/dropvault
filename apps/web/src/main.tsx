import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { ThemeProvider } from "./lib/theme";
import { LayoutProvider } from "./lib/layout";
import "./index.css";

const queryClient = new QueryClient();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/service-worker.js?v=4").catch(() => {}),
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <LayoutProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </QueryClientProvider>
      </LayoutProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
