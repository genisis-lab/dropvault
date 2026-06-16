import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import App from "./App"
import { ToastProvider } from "./components/Toast"
import { ThemeProvider } from "./lib/theme"
import { LayoutProvider } from "./lib/layout"
import "./lib/adminKeepForeverEnhancer"
import "./index.css"

const queryClient = new QueryClient()

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
)
